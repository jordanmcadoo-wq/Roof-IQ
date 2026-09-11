import { useEffect, useState } from 'react'
import { fetchLearningHealth } from '@/lib/outcomes'
import type { LearningHealth } from '@/lib/types'
import { Card, Empty, ErrorNote, Spinner } from '@/components/ui/primitives'

/**
 * Thresholds are not chosen here. ml_learning_health() computes
 * ready_for_training as labels >= 250 AND positives >= 50 AND negatives >= 50,
 * and these mirror that so the bars explain the flag the server already sets.
 * If the server rule changes, the flag and the bars would disagree visibly
 * rather than the screen quietly lying.
 */
const NEED_LABELS = 250
const NEED_EACH = 50

const TARGET_NAMES: Record<string, string> = {
  sold_90d: 'Sold within 90 days',
  damage_confirmed: 'Damage confirmed at inspection',
  inspection_set_30d: 'Inspection set within 30 days',
}

export default function Learning() {
  const [health, setHealth] = useState<LearningHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLearningHealth().then(setHealth).catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!health) return <div className="p-4"><Spinner label="Reading learning state" /></div>

  const targets = Object.entries(health.targets ?? {})

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">Model learning</h1>
        <p className="mt-1 text-sm text-ink-400">
          Every door a rep files with an outcome becomes a labelled training row.
          The model stays in shadow mode until a target has enough of them.
        </p>
      </div>

      {!targets.length ? (
        <Empty
          title="No labels yet"
          body={
            'Nothing has been filed from the field, so there is nothing to learn from. ' +
            'The first knock logged with an outcome starts this counter.'
          }
        />
      ) : (
        <div className="space-y-3">
          {targets.map(([target, t]) => (
            <Card key={target} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">{TARGET_NAMES[target] ?? target}</h2>
                  <p className="text-xs text-ink-400">{target}</p>
                </div>
                <span
                  className={
                    t.ready_for_training
                      ? 'shrink-0 rounded-lg bg-go-500/15 px-2 py-1 text-xs font-semibold text-go-400'
                      : 'shrink-0 rounded-lg bg-ink-700 px-2 py-1 text-xs font-semibold text-ink-300'
                  }
                >
                  {t.ready_for_training ? 'Ready to train' : 'Collecting'}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <Gate label="Labelled doors" have={t.labels} need={NEED_LABELS} />
                <Gate label="Positive outcomes" have={t.positives} need={NEED_EACH} />
                <Gate label="Negative outcomes" have={t.negatives} need={NEED_EACH} />
              </div>

              {!!t.models?.length && (
                <p className="mt-3 border-t border-ink-700 pt-3 text-xs text-ink-400">
                  {t.models.length} model version{t.models.length === 1 ? '' : 's'} on record;
                  latest {t.models[0]?.status ?? 'unknown'}.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        <h2 className="font-semibold">Why both sides matter</h2>
        <p className="mt-1 text-sm text-ink-300">
          A target needs {NEED_EACH} positives and {NEED_EACH} negatives, not just
          {' '}{NEED_LABELS} rows. A file of nothing but wins teaches the model that
          every house is a win. The codes that read like bad news — recent roof, renter,
          not interested — are what let it tell a good door from a bad one.
        </p>
        <p className="mt-2 text-sm text-ink-400">
          Total outcomes recorded: <strong className="text-ink-200 tabular-nums">
            {health.total_outcomes ?? 0}
          </strong>
          {health.mode ? ` · mode: ${health.mode.replace(/_/g, ' ')}` : ''}
        </p>
      </Card>
    </div>
  )
}

/**
 * One gate, one bar. Magnitude against a fixed target is a single-hue fill on a
 * recessive track, with the numbers stated directly rather than on a hover the
 * rep cannot trigger with a gloved thumb.
 */
function Gate({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = Math.min(100, need > 0 ? (have / need) * 100 : 0)
  const met = have >= need
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-300">{label}</span>
        <span className="tabular-nums text-ink-400">
          <strong className={met ? 'text-go-400' : 'text-ink-200'}>{have}</strong> / {need}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800"
        role="progressbar"
        aria-valuenow={have}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-label={`${label}: ${have} of ${need}`}
      >
        <div
          className={met ? 'h-full rounded-full bg-go-500' : 'h-full rounded-full bg-cool-500'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
