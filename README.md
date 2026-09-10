# Roof-IQ

Hail-storm roofing lead intelligence and door-knock routing for the Oklahoma City
metro.

RoofIQ takes storm radar data and county assessor records, scores each parcel for
damage likelihood and closeability, groups parcels into walkable zones, and hands
reps an ordered route to knock — then tracks what happened at each door.

## Data model

| Entity | Purpose |
| --- | --- |
| `Zone` | A walkable cluster of parcels, with aggregate lead counts, pipeline value and hail statistics |
| `Lead` | One parcel: storm evidence, assessor value, closeability band, route position, and rep outcome |
| `Permit` | Jurisdiction roofing permits, matched against leads to spot roofs already replaced |
| `User` | App users, `admin` or `user` |

Leads are ranked globally by expected value and bucketed into closeability bands
from **A1** (act now) through **C2**. Scoring inputs include hail diameter,
distance to the radar core cell, number of radar sweeps over the parcel, a
composite damage index, and the days remaining to file an insurance claim.

## Where the application lives

The running application is a [Base44](https://base44.com) app
(`6a9f85552fba8482b6a0e371`), whose source is stored on Base44 rather than in this
repository. This repository holds documentation of the data model and of changes
made to the app.

## Documentation

- [Upgrades — September 2026](./docs/upgrades-2026-09.md) — data health, rep field
  workflow, manager dashboard, roof measurement and permit matching
- [Data quality audit](./docs/data-quality-audit.md) — defects found in the launch
  dataset and how each was resolved
