/**
 * Lightweight Helix usage card for Settings.
 *
 * Live "Usage today" card on the Helix settings panel. Reads the
 * `/ai/usage/today` endpoint via `useAiUsageToday()`
 * (TanStack Query, polled at INTERVALS.STANDARD) and renders the
 * three top-line metrics (tokens in, tokens out, estimated cost in
 * the user's locale currency).
 *
 * Empty / loading / error states all degrade to the long-em-dash
 * placeholder so the visual layout stays stable while the data
 * arrives. The "no per-feature toggle" rule is enforced
 * server-side by the `__usage__` meta-feature guard, so this card
 * does NOT need its own withAiFeature wrapper.
 *
 * The detailed operator-grade card (with feature breakdown, recent
 * calls, etc.) lives in `features/system/components/status/AiUsageCard`.
 * This Settings card is the lightweight "at a glance" surface — a
 * deeper drill-down already exists on the System status page.
 */

import { useTranslation } from 'react-i18next'
import { Caption, Subhead } from '@/components/ui'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'
import { useFormatting } from '@/hooks/useFormatting'
import { fmtInt } from '@/lib/numberFormat'

const PLACEHOLDER = '—'

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) return 0
  return mc / 1_000_000
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return PLACEHOLDER
  return fmtInt(n)
}

export function AIUsageCard() {
  const { t } = useTranslation('settings')
  const { formatCurrency } = useFormatting()
  const { data, isLoading, isError } = useAiUsageToday()

  const tokensIn = !data || isError ? PLACEHOLDER : formatCount(data.input_tokens)
  const tokensOut = !data || isError ? PLACEHOLDER : formatCount(data.output_tokens)
  const cost =
    !data || isError ? PLACEHOLDER : formatCurrency(microCentsToDollars(data.cost_micro_cents))

  return (
    <section
      className="rounded-md border border-[var(--border-subtle)] p-4 space-y-1"
      aria-label={t('ai.settings.usage.title', 'Usage today')}
      data-testid="ai-usage-card"
    >
      <Subhead>{t('ai.settings.usage.title', 'Usage today')}</Subhead>
      <div className="grid grid-cols-3 gap-3 text-xs text-[var(--text-secondary)]">
        <UsageCell
          label={t('ai.settings.usage.tokensIn', 'Tokens in')}
          value={tokensIn}
          isLoading={isLoading}
        />
        <UsageCell
          label={t('ai.settings.usage.tokensOut', 'Tokens out')}
          value={tokensOut}
          isLoading={isLoading}
        />
        <UsageCell
          label={t('ai.settings.usage.cost', 'Estimated cost')}
          value={cost}
          isLoading={isLoading}
        />
      </div>
      <Caption>
        {data && data.call_count > 0
          ? `${formatCount(data.call_count)} ${t('ai.settings.usage.liveSuffix', 'Helix calls today.')}`
          : t(
              'ai.settings.usage.placeholder',
              'Usage populates as features run. Live numbers arrive in a follow-up update.',
            )}
      </Caption>
    </section>
  )
}

function UsageCell({
  label,
  value,
  isLoading,
}: {
  label: string
  value: string
  isLoading: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span
        className="text-sm font-medium text-[var(--text-primary)]"
        data-testid="ai-usage-value"
        aria-busy={isLoading || undefined}
      >
        {value}
      </span>
    </div>
  )
}
