# Expanding to Central Oklahoma

**Short answer: yes, and the architecture is better prepared for it than most of
this system's other parts. Four things break, three of them cheaply fixable. The
binding constraint is storage, and it is a billing decision, not a design one.**

## What is there today

| | |
|---|---|
| Properties | 87,399 — **all in Oklahoma County**, north metro only |
| Geometry | `properties.location` populated on **100%** of rows |
| Routable doors | 4,797 (`okc_launch_cut`), 30 zones, 30 territories |
| Database | 891 MB on the **free plan**, whose ceiling is 500 MB |
| Cost today | $0/month (confirmed against the billing API) |

Note `parcel_geometry` is null on every row — the live geometry column is
`location`. Anything new should read `location`.

## What already scales cleanly

`roofiq_rebuild_launch_cut(p_zones, p_top)` is genuinely well built for this:

- **No geography is hardcoded in its selection.** It takes
  `where sales_priority_band in ('A1','A2') and location is not null`. Add
  Cleveland or Canadian County properties and they flow in with no code change.
- **Zones are derived, not fixed.** `st_clusterkmeans(geom, p_zones)` re-clusters
  from whatever is present; widen the footprint and raise `p_zones`.
- **Territory identity survives re-clustering.** Territories are matched on the
  zone *number* parsed out of the name, not the whole string, specifically so a
  moving dominant-city label does not create duplicates and strand the rep
  assigned to that zone. That is the hard part of this problem and it is already
  handled.
- **Geocoding is not a blocker.** Every existing property has coordinates.

So the expansion is mostly a data-volume exercise, not a rewrite.

## The four things that break

### 1. Storage — the binding constraint

All-in cost is about **10.2 KB per property** (891 MB / 87,399), spread across
`properties` (4.6 KB), `property_storm_summary`, `owner_entities`,
`property_hail_events`, `sales_rank_v4_shadow` and the rest.

Central Oklahoma — the seven-county OKC metro — is on the order of 600,000+
housing units, roughly **7× the current footprint**. That projects to **~6 GB**.
(Housing-unit counts here are from general knowledge, not a census lookup; treat
the multiplier as the load-bearing number, not the precise total.)

The database is already 391 MB **over** the free plan's 500 MB ceiling, which is
why `pipeline_storage_guard()` returns `safe:false` and MRMS ingestion has
written nothing since 2026-09-07. Expansion cannot start from here. A paid plan
is the prerequisite for everything else on this page.

### 2. Bands are percentiles, so expansion re-ranks the doors reps already have

This is the subtle one and the one most likely to cause a bad week.

`roofiq_shadow_score_v5()` bands with
`percent_rank() over (partition by organization_id order by dmg)`. The bands are
**fixed proportions of whatever is in the table**, not absolute damage
thresholds:

| Band | Share |
|---|---|
| A1 | 1.53% |
| A2 | 3.95% |
| B | 14.83% |
| C | 29.63% |
| D | 50.05% |

A1+A2 is always the top ~5.5%. That has two consequences:

- The launch cut would grow from 4,797 to roughly **33,000 doors** at 600k
  properties — not because more roofs are damaged, but because 5.5% of a bigger
  number is bigger. `p_top` (default 300) and `p_zones` (default 30) both need
  to move with it or the "top 300" loses its meaning.
- **Which** doors are A1 is entirely relative. If Central Oklahoma has taken
  worse hail than the north metro, today's A1 doors get displaced and fall out
  of the cut.

And falling out of the cut is not cosmetic. `roofiq_rebuild_launch_cut` does:

```sql
delete from lead_assignments a
where a.organization_id = v_org
  and not exists (select 1 from okc_launch_cut c where c.property_id = a.property_id);
```

**A door a rep knocked, with a follow-up booked, can silently lose its
assignment** because a hailstorm two counties away out-ranked it. This is already
true of every rebuild today; expansion makes it far more likely.

*Fix:* band within a geographic partition rather than org-wide — `partition by
organization_id, county` (or by metro area) — so a Cleveland County surge cannot
demote an Edmond lead. Alternatively, protect worked leads from the delete by
exempting any property with an activity or an open assignment. Both are small
changes. Note that banding per-partition is not the same mistake as batching the
refresh: the partition is a real population boundary, not an arbitrary slice.

### 3. County and zone naming are hardcoded to Oklahoma County

In the territory insert:

```sql
insert into territories (organization_id, name, county, geometry, ...)
select v_org, z.zone_name, 'Oklahoma', z.geom, ...
```

Every territory created in Cleveland, Canadian or Logan County would be
**labelled Oklahoma County**. The zone name is likewise fixed to the
`'OKC Launch · Zone NN · <city>'` convention.

*Fix:* derive county from the zone's dominant property county, the same way the
city is already derived. Small and mechanical.

### 4. City values are dirty, and zone names are voted on by city

Zone names pick the most common city in the cluster. But the city column has
casing duplicates — `Oklahoma City` (48,502) alongside `OKLAHOMA CITY` (964),
`Edmond` (27,215) alongside `EDMOND` (43) — plus obvious junk (`AUSTIN`,
`ATLANTA`, `GERMANTOWN`, `TULSA`), which look like owner mailing addresses that
leaked into the site-address field. 72 raw values normalise to 68.

At current scale the vote survives it. Across seven counties with far more
city names in play, casing variants can split a vote and misname a zone.

*Fix:* normalise on write, and vote on the normalised value. Worth doing before
expansion rather than after — 7× the rows is 7× the cleanup.

## Is there a free path?

**No — and not only for the expansion. There is no free way to unblock what is
already there.** This was checked rather than assumed, and all four reclaim
avenues came back empty:

| Avenue | Finding |
|---|---|
| Dead-tuple bloat | **None.** No table has >1,000 dead tuples; autovacuum is current. |
| Unused indexes | **None worth having.** Every index over 1 MB is being scanned except one 3.6 MB primary key. |
| Oversized columns | `properties.score_breakdown` is 738 bytes on every row — **61.5 MB**, 38% of the average row. But five functions reference it, including `opportunity_property_detail`. It is in use, not dead weight. |
| Duplicate tables | `property_storm_summary` (73 MB) and `property_storm_summaries` (49 MB) look redundant, but both are live: their indexes take 170,643 and 581,915 scans. |

Best case is roughly **65 MB** of reclaim against a **391 MB** gap, and the
largest piece of it is load-bearing. The 891 MB is real data.

### The pruning trap

The obvious move — delete the bottom bands — does not work, and it is worth
understanding why before someone tries it.

Bands are **percentiles**, not absolute damage thresholds. Band D is 50.05% of
the table *by definition*. Delete all 43,747 D properties and the remaining
43,652 are re-ranked on the next refresh, and **a new bottom 50% becomes D**.
You can do that forever and never converge. Pruning by band only works if the
bands are first frozen to absolute score cutoffs, which is a change to the
scoring contract.

### The arithmetic on expansion

Central Oklahoma at ~600,000 properties against a 500 MB ceiling allows
**0.87 KB per property, all-in** — geometry, storm history, owner records,
scoring shadow tables and every index. Today's figure is 10.2 KB. That is not a
tuning gap; it is **roughly 12× off**. Switching to another free Postgres tier
does not change it, since those ceilings are the same order of magnitude.

### What it actually costs

This is a ~$25/month problem, not a free one. Supabase Pro includes 8 GB, which
covers the ~6 GB projection with headroom and unblocks the current stall
immediately. (Confirm current pricing directly — it could not be reached from
the environment this was written in.)

### The one architecture that would stretch further

If staying free mattered more than anything else, the shape that works is
**score wide, store thin**: enrich fully only the A1/A2 slice reps actually
route, and keep a minimal row for everything else that exists solely to compute
percentiles. At 600k properties that is roughly 33k enriched plus 567k thin.

It is a real architecture, and it is also a real rewrite — a second narrow
property table, a two-tier enrichment pipeline, and scoring that reads across
both. Given the goal of preserving the current architecture, paying for storage
is the cheaper answer by a wide margin.

## Recommended order

1. **Move off the free plan.** Nothing else can proceed; ingestion is stalled
   today at 891 MB against 500 MB.
2. **Let the backlog drain** and confirm `pipeline_storage_guard()` flips to
   `safe:true`, so you are expanding from a healthy pipeline rather than a
   stalled one.
3. **Fix banding partition and the assignment delete** (risk 2). Do this
   *before* loading new geography, so the first rebuild at scale does not
   reshuffle live routes.
4. **Normalise city, derive county** (risks 3 and 4). Cheap, and cheaper now.
5. **Load one adjacent county** — Cleveland (Norman) is the obvious first, being
   contiguous and storm-exposed. Rebuild with `p_zones` scaled to roughly keep
   today's ~160 doors per zone, and verify that existing north-metro assignments
   survived.
6. **Then the rest**, county at a time, checking assignment churn after each.

## What does not need to change

The scoring model itself, the learning loop, the field console, the storm map
and the territory-matching logic are all geography-agnostic already. This is a
data and partitioning exercise, not an architectural rewrite — which is a good
position to be in.
