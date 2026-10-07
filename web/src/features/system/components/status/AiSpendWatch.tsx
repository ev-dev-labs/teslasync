import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';

import { useAiSpendInsights } from '@/api/hooks/useAiUsage';
import { useDataState } from '@/hooks/useDataState';
import { useSettings } from '@/hooks/useSettings';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';

export function AiSpendWatch() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const enabled = settings?.ai_mode === 'local' || settings?.ai_mode === 'cloud';
  const query = useAiSpendInsights(enabled);
  const state = useDataState(query, { provenance: 'historical' });

  if (!enabled) return null;

  const data = state.data;
  const capMicroCents = (settings.ai_cost_cap_cents ?? 0) * 10_000;
  const capRisk = data?.projected_today_micro_cents != null
    && capMicroCents > 0
    && data.projected_today_micro_cents >= capMicroCents;
  const biggest = (data?.drivers ?? [])[0];
  const money = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value / 1_000_000);

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="ai-spend-watch">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-amber-300" aria-hidden="true" />
        <PanelTitle>{t('systemStatus.aiSpend.title', 'Helix spend watch')}</PanelTitle>
      </div>
      {state.status === 'initial' ? (
        <Skeleton height={88} className="rounded-xl" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => query.refetch()} />
      ) : data ? (
        <>
          <StaleRefreshWarning state={state} label={t('systemStatus.aiSpend.title', 'Helix spend watch')} />
          <Text as="p" variant="bodySm">
            {t('systemStatus.aiSpend.today', 'Audited today (UTC): {{amount}}', {
              amount: money(data.today_micro_cents),
            })}
            {' · '}
            {t('systemStatus.aiSpend.baseline', 'Prior 7-day daily average: {{amount}}', {
              amount: money(data.prior_daily_avg_micro_cents),
            })}
          </Text>
          {data.status === 'insufficient_history' ? (
            <Text as="p" variant="bodySm">
              {t(
                'systemStatus.aiSpend.insufficient',
                'Fewer than 3 active days in the prior week; there is not enough history for a pace comparison.',
              )}
            </Text>
          ) : data.status === 'no_spend_today' ? (
            <Text as="p" variant="bodySm">
              {t('systemStatus.aiSpend.quiet', 'No audited AI spend recorded today.')}
            </Text>
          ) : (
            <>
              {data.projected_today_micro_cents != null && (
                <Text as="p" variant="bodySm">
                  {t('systemStatus.aiSpend.projection', 'At the current pace: approximately {{amount}} by UTC midnight.', {
                    amount: money(data.projected_today_micro_cents),
                  })}
                </Text>
              )}
              {data.status === 'unusual_pace' && (
                <Text as="p" variant="bodySm" className="text-amber-300">
                  {t('systemStatus.aiSpend.unusual', 'Spend is pacing at least twice the prior-week daily average. This is an estimate, not a billing alert.')}
                </Text>
              )}
              {data.status === 'new_paid_spend' && (
                <Text as="p" variant="bodySm" className="text-amber-300">
                  {t('systemStatus.aiSpend.newPaid', 'Paid AI usage appeared today after a week of zero recorded spend. Check the contributing provider and model.')}
                </Text>
              )}
              {capRisk && (
                <Text as="p" variant="bodySm" className="text-amber-300">
                  {t('systemStatus.aiSpend.capRisk', 'At this pace you may reach the global daily cap ({{amount}}) before UTC midnight.', {
                    amount: money(capMicroCents),
                  })}
                </Text>
              )}
            </>
          )}
          {biggest && data.today_micro_cents > 0 && (
            <Text as="p" variant="caption">
              {t('systemStatus.aiSpend.driver', 'Largest observed contributor: {{feature}} via {{provider}} / {{model}} ({{amount}} today; {{baseline}} prior daily average).', {
                feature: biggest.feature_id,
                provider: biggest.provider,
                model: biggest.model,
                amount: money(biggest.today_micro_cents),
                baseline: money(biggest.prior_daily_avg_micro_cents),
              })}
            </Text>
          )}
          <Text as="p" variant="caption">
            {t(
              'systemStatus.aiSpend.caveat',
              'Based on recorded AI calls only. Delayed or missing audit records can undercount; projections assume today’s pace continues.',
            )}
          </Text>
        </>
      ) : null}
    </GlassPanel>
  );
}
