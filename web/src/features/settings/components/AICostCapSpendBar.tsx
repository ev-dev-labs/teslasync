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
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { MetricBar } from '@/components/data-display'
import { DataStateNotice } from '@/components/feedback'
import { deriveDataState } from '@/api/dataState'
import { gaugeTone } from '@/lib/tokens'

type SpendLevel = 'ok' | 'warn' | 'critical'

const FILL_COLOR: Record<SpendLevel, string> = {
  ok: gaugeTone.info,
  warn: gaugeTone.warning,
  critical: gaugeTone.danger,
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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('settings')
  const usageQuery = useAiUsageToday()
  const usageState = deriveDataState(usageQuery)
  const data = usageState.data
  const isLoading = usageState.status === 'initial'
  const isError = usageState.fatalError != null

  // Backend stores spend in micro-cents (1e-4 cent). Cap is supplied in
  // whole cents. Missing spend remains unknown; a measured negative value
  // retains the existing non-negative clamp.
  const safeCapCents = Math.max(0, toFinite(capCents))
  const cost = data?.cost_micro_cents
  const todayMicroCents =
    typeof cost === 'number' && Number.isFinite(cost) ? Math.max(0, cost) : null
  const capMicroCents = safeCapCents * 10_000 // 1 cent = 10_000 micro-cents
  const pct = todayMicroCents == null
    ? null
    : capMicroCents > 0
      ? Math.min(100, Math.max(0, (todayMicroCents / capMicroCents) * 100))
      : 0
  const todayDollars = todayMicroCents == null ? null : todayMicroCents / 1_000_000
  const capDollars = safeCapCents / 100

  const level: SpendLevel = pct != null && pct >= 100 ? 'critical' : pct != null && pct >= 80 ? 'warn' : 'ok'

  // Readout copy. On a failed fetch we must NOT surface a falsely
  // reassuring "$0.00" — the cap is still enforced server-side, we just
  // can't show today's number. Loading and error each get their own
  // state so the panel is never a blank/misleading placeholder.
  const readout = isLoading
    ? t('ai.settings.costCap.loading', 'Loading…')
    : isError || todayDollars == null
      ? t('ai.settings.costCap.unavailable', 'Spend unavailable')
      : t('ai.settings.costCap.amount', '${{spent}} / ${{cap}}', {
          spent: fmtNumber(todayDollars),
          cap: fmtNumber(capDollars),
          defaultValue: `$${fmtNumber(todayDollars)} / $${fmtNumber(capDollars)}`,
        })
  const readoutClass = isError || todayDollars == null ? 'text-[var(--text-muted)]' : TEXT_CLASS[level]

  return (
    <GlassPanel
      className="space-y-2 p-4"
      data-testid="ai-cost-cap-spend-bar"
      data-spend-level={todayMicroCents == null ? 'unknown' : level}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Caption>{t('ai.settings.costCap.todayTitle', 'Today’s Helix spend')}</Caption>
        <Text size="xs" weight="medium" className={readoutClass}>
          {readout}
        </Text>
      </div>
      <MetricBar
        value={pct}
        max={100}
        color={FILL_COLOR[level]}
        ariaLabel={t('ai.settings.costCap.barLabel', 'Helix cost cap usage')}
        showHeader={false}
        size="slim"
        fill="solid"
      />
      {usageState.status === 'stale' && <DataStateNotice state="stale" preserveSeverity />}
      {!isLoading && (isError || todayMicroCents == null) && (
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
