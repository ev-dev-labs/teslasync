/**
 * AICostCapSpendBar — live "today" spend bar for Helix.
 *
 * Shows how close the user is to their daily $ cap. The cost-cap
 * decorator on the backend rejects new calls once the cap is reached;
 * this bar lets the user see it coming. Rendered only in cloud mode AND
 * when `capCents > 0` (the parent gates this).
 *
 * Colour rules (color is never the only signal — the numeric readout and
 * hint text carry the same meaning):
 *   pct <  80  → cyan  (informational)
 *   pct >= 80  → amber (warn — same threshold as the backend "warn")
 *   pct >= 100 → rose  (critical — calls are now being rejected)
 *
 * Reads from `/ai/usage/today` via the shared hook so the value matches
 * `AIUsageCard` exactly.
 */

import { useTranslation } from 'react-i18next'
import { GlassPanel, Caption, HelperText, Text } from '@/components/ui'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'

type SpendLevel = 'ok' | 'warn' | 'critical'

const FILL_CLASS: Record<SpendLevel, string> = {
  ok: 'bg-cyan-300',
  warn: 'bg-amber-300',
  critical: 'bg-rose-300',
}

const TEXT_CLASS: Record<SpendLevel, string> = {
  ok: 'text-cyan-300',
  warn: 'text-amber-300',
  critical: 'text-rose-300',
}

/**
 * Coerce a possibly null / undefined / NaN / Infinity value to a finite
 * number, falling back to 0. Guards the bar against a corrupt usage
 * payload rendering `width: NaN%` or an out-of-range `aria-valuenow`.
 */
function toFinite(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

export function AICostCapSpendBar({ capCents }: { capCents: number }) {
  const { t } = useTranslation('settings')
  const { data, isLoading, isError } = useAiUsageToday()

  // Backend stores spend in micro-cents (1e-4 cent). Cap is supplied in
  // whole cents. Convert both to dollars for display. Every input is
  // coerced to a finite, non-negative number so a corrupt payload can
  // never yield a `NaN%` width or an out-of-range progress value.
  const safeCapCents = Math.max(0, toFinite(capCents))
  const todayMicroCents = Math.max(0, toFinite(data?.cost_micro_cents))
  const capMicroCents = safeCapCents * 10_000 // 1 cent = 10_000 micro-cents
  const pct =
    capMicroCents > 0
      ? Math.min(100, Math.max(0, (todayMicroCents / capMicroCents) * 100))
      : 0
  const todayDollars = todayMicroCents / 1_000_000
  const capDollars = safeCapCents / 100

  const level: SpendLevel = pct >= 100 ? 'critical' : pct >= 80 ? 'warn' : 'ok'

  // Readout copy. On a failed fetch we must NOT surface a falsely
  // reassuring "$0.00" — the cap is still enforced server-side, we just
  // can't show today's number. Loading and error each get their own
  // state so the panel is never a blank/misleading placeholder.
  const readout = isLoading
    ? t('ai.settings.costCap.loading', 'Loading…')
    : isError
      ? t('ai.settings.costCap.unavailable', 'Spend unavailable')
      : t('ai.settings.costCap.amount', '${{spent}} / ${{cap}}', {
          spent: todayDollars.toFixed(2),
          cap: capDollars.toFixed(2),
          defaultValue: `$${todayDollars.toFixed(2)} / $${capDollars.toFixed(2)}`,
        })
  const readoutClass = isError ? 'text-[var(--text-muted)]' : TEXT_CLASS[level]

  return (
    <GlassPanel
      className="space-y-2 p-4"
      data-testid="ai-cost-cap-spend-bar"
      data-spend-level={level}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Caption>{t('ai.settings.costCap.todayTitle', 'Today’s Helix spend')}</Caption>
        <Text size="xs" weight="medium" className={readoutClass}>
          {readout}
        </Text>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t('ai.settings.costCap.barLabel', 'Helix cost cap usage')}
      >
        <div
          className={`h-full transition-all duration-slow ${FILL_CLASS[level]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isError && (
        <HelperText>
          {t(
            'ai.settings.costCap.unavailableHint',
            'Could not load today’s spend. The cap is still enforced server-side.',
          )}
        </HelperText>
      )}
      {!isError && level === 'critical' && (
        <HelperText>
          {t(
            'ai.settings.costCap.criticalHint',
            'Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it.',
          )}
        </HelperText>
      )}
      {!isError && level === 'warn' && (
        <HelperText>
          {t(
            'ai.settings.costCap.warnHint',
            'You are nearing today’s cap. Calls will pause once you reach it.',
          )}
        </HelperText>
      )}
    </GlassPanel>
  )
}
