import { useTranslation } from 'react-i18next';
import { useActionCenterHistory } from '@/api/hooks/useActionCenter';
import { QueryError, Skeleton } from '@/components/feedback';
import { Accordion, Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime, formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { ActionCenterProjectedImpact, ActionCenterRecommendation } from '@/types/actionCenter';

interface RecommendationDetailsProps {
  recommendation: ActionCenterRecommendation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCost(impact: ActionCenterProjectedImpact): string | null {
  if (impact.cost_minor == null || impact.currency == null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: impact.currency,
    }).format(impact.cost_minor / 100);
  } catch {
    return `${impact.cost_minor} ${impact.currency}`;
  }
}

export function RecommendationDetails({
  recommendation,
  open,
  onOpenChange,
}: RecommendationDetailsProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const history = useActionCenterHistory(recommendation.id, open);
  const impact = recommendation.projected_impact;
  const impactValues = impact
    ? [
        impact.energy_wh == null ? null : formatEnergy(impact.energy_wh),
        formatCost(impact),
        impact.time_s == null ? null : formatDurationSecondsAsMinutes(impact.time_s),
        impact.risk_level,
      ].filter((value): value is string => value != null)
    : [];

  return (
    <Accordion
      title={t('actionCenter.card.details', 'Evidence, scoring, and outcomes')}
      open={open}
      onOpenChange={onOpenChange}
      badge={<Badge variant="neutral">{recommendation.evidence.length}</Badge>}
      className="mt-4"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section aria-label={t('actionCenter.details.evidence', 'Evidence')}>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('actionCenter.details.evidence', 'Evidence')}
          </h4>
          <div className="mt-2 space-y-2">
            {recommendation.evidence.map((evidence) => (
              <div key={evidence.id} className="rounded-lg bg-white/[0.03] p-3">
                <p className="text-sm text-[var(--text-primary)]">{evidence.summary}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {evidence.provenance.source} · {evidence.provenance.record_id} ·{' '}
                  {evidence.observed_at
                    ? formatDateTime(evidence.observed_at)
                    : t('actionCenter.details.timestampUnknown', 'Timestamp unknown')}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-label={t('actionCenter.details.impact', 'Projected impact')}>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('actionCenter.details.impact', 'Projected impact')}
          </h4>
          {impact == null || impactValues.length === 0 ? (
            <Text as="p" variant="bodySm" className="mt-2">
              {t(
                'actionCenter.details.noImpact',
                'No defensible energy, cost, time, or risk projection is available.',
              )}
            </Text>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {impactValues.map((value) => <Badge key={value} variant="info">{value}</Badge>)}
            </div>
          )}
          {(impact?.basis ?? []).map((basis) => (
            <p key={basis} className="mt-2 text-xs text-[var(--text-muted)]">{basis}</p>
          ))}
        </section>

        <section aria-label={t('actionCenter.details.scoring', 'Scoring basis')}>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('actionCenter.details.scoring', 'Scoring basis')}
          </h4>
          <p className="mt-2 text-xs font-medium text-cyan-200">
            {t('actionCenter.details.rankScore', 'Rank {{score}}', {
              score: recommendation.rank.score,
            })}
          </p>
          {[...recommendation.rank.basis, ...recommendation.confidence.basis].map((basis) => (
            <p key={basis} className="mt-1 text-xs text-[var(--text-muted)]">• {basis}</p>
          ))}
        </section>

        <section aria-label={t('actionCenter.details.limitations', 'Limitations')}>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('actionCenter.details.limitations', 'Limitations')}
          </h4>
          {recommendation.limitations.map((limitation) => (
            <p key={limitation} className="mt-2 text-xs text-amber-200">• {limitation}</p>
          ))}
        </section>
      </div>

      <section className="mt-5 border-t border-white/[0.06] pt-4" aria-label={t('actionCenter.history.title', 'Action history')}>
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          {t('actionCenter.history.title', 'Action history')}
        </h4>
        {history.isLoading ? (
          <Skeleton lines={2} className="mt-2" />
        ) : history.error ? (
          <QueryError
            error={history.error}
            onRetry={() => void history.refetch()}
            resourceName={t('actionCenter.history.resource', 'Action history')}
          />
        ) : (history.data?.items ?? []).length === 0 ? (
          <Text as="p" variant="bodySm" className="mt-2">
            {t('actionCenter.history.empty', 'No actions have been recorded yet.')}
          </Text>
        ) : (
          <div className="mt-2 space-y-2">
            {history.data?.items.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[var(--text-secondary)]">
                  {t(`actionCenter.action.${event.action}`, event.action)} ·{' '}
                  {t(`actionCenter.state.${event.from_state}`, event.from_state)} →{' '}
                  {t(`actionCenter.state.${event.to_state}`, event.to_state)} ·{' '}
                  {t(`actionCenter.outcome.${event.outcome}`, event.outcome)}
                </span>
                <span className="text-[var(--text-muted)]">{formatDateTime(event.occurred_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Accordion>
  );
}
