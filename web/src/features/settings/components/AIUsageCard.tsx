/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * Live usage card. F2 mounts the placeholder shell so the panel
 * surface is "complete" once the user enables AI; the F3 slice
 * (`useAiUsage()`) wires the real numbers from `/ai/usage`.
 *
 * Until F3 lands the numbers render as `—` and the call-out
 * mentions that usage starts populating once a feature actually
 * runs. We deliberately do NOT wrap this in `withAiFeature` —
 * the Settings page is the opt-in surface and must always render.
 */

import { useTranslation } from 'react-i18next'
import { Caption, Subhead } from '@/components/ui'

export function AIUsageCard() {
  const { t } = useTranslation('settings')
  return (
    <section
      className="rounded-md border border-[var(--border-subtle)] p-4 space-y-1"
      aria-label={t('ai.settings.usage.title', 'Usage today')}
      data-testid="ai-usage-card"
    >
      <Subhead>{t('ai.settings.usage.title', 'Usage today')}</Subhead>
      <div className="grid grid-cols-3 gap-3 text-xs text-[var(--text-secondary)]">
        <UsageCell label={t('ai.settings.usage.tokensIn', 'Tokens in')} />
        <UsageCell label={t('ai.settings.usage.tokensOut', 'Tokens out')} />
        <UsageCell label={t('ai.settings.usage.cost', 'Estimated cost')} />
      </div>
      <Caption>
        {t(
          'ai.settings.usage.placeholder',
          'Usage populates as features run. Live numbers arrive in a follow-up update.',
        )}
      </Caption>
    </section>
  )
}

function UsageCell({ label }: { label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span
        className="text-sm font-medium text-[var(--text-primary)]"
        data-testid="ai-usage-value"
      >
        —
      </span>
    </div>
  )
}
