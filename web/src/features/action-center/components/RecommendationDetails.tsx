import { useTranslation } from 'react-i18next';
import { useActionCenterHistory } from '@/api/hooks/useActionCenter';
import { QueryError, Skeleton } from '@/components/feedback';
import {
  OperationalNarrativeDetails,
} from '@/components/data-display';
import { Accordion, Badge, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime, formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { ActionCenterProjectedImpact, ActionCenterRecommendation } from '@/types/actionCenter';
import type { OperationalNarrative } from '@/types/operationalNarrative';

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
  const provenanceLabels: Record<string, string> = {
    notification_logs: t(
      'actionCenter.provenance.notification_logs',
      'Alert delivery history',
    ),
    charging_sessions: t(
      'actionCenter.provenance.charging_sessions',
      'Charging history',
    ),
    command_logs: t(
      'actionCenter.provenance.command_logs',
      'Vehicle command history',
    ),
    drives: t(
      'actionCenter.provenance.drives',
      'Completed drive history',
    ),
    fleet_maintenance_work_orders: t(
      'actionCenter.provenance.fleet_maintenance_work_orders',
      'Fleet maintenance work orders',
    ),
    signal_log: t(
      'actionCenter.provenance.signal_log',
      'Telemetry history',
    ),
    status_incidents: t(
      'actionCenter.provenance.status_incidents',
      'System incident history',
    ),
    tesla_battery_passport_ledger: t(
      'actionCenter.provenance.tesla_battery_passport_ledger',
      'Issued Battery Passports',
    ),
  };
  const sourceLabel = (source: string) =>
    provenanceLabels[source] ??
    source
      .replace(/_/g, ' ')
      .replace(/^./, (character) => character.toUpperCase());
  const uniqueSources = Array.from(
    new Set(recommendation.evidence.map((item) => item.provenance.source)),
  );
  const narrative: OperationalNarrative = {
    whatChanged: recommendation.summary,
    whyItMatters: recommendation.rationale,
    confidence: {
      label: recommendation.confidence.label,
      score: recommendation.confidence.score,
      basis: recommendation.confidence.basis,
    },
    likelyCause: null,
    recommendedResponse: recommendation.title,
    limitations: recommendation.limitations,
    evidence: recommendation.evidence.map((evidence) => ({
      id: evidence.id,
      summary: evidence.summary,
      observedAt: evidence.observed_at,
      provenance: {
        source: sourceLabel(evidence.provenance.source),
        recordId: evidence.provenance.record_id,
      },
    })),
    provenance: uniqueSources.map((source) => ({
      source: sourceLabel(source),
      method: t(
        'actionCenter.provenance.method',
        'Ranked from persisted evidence without synthetic substitutes.',
      ),
    })),
  };

  return (
    <Accordion
      title={t('actionCenter.card.details', 'Evidence, scoring, and outcomes')}
      open={open}
      onOpenChange={onOpenChange}
      badge={<Badge variant="neutral">{recommendation.evidence.length}</Badge>}
      className="mt-4"
    >
      <OperationalNarrativeDetails narrative={narrative} />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section aria-label={t('actionCenter.details.impact', 'Projected impact')}>
          <PanelTitle>
            {t('actionCenter.details.impact', 'Projected impact')}
          </PanelTitle>
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
            <Text key={basis} as="p" size="xs" color="muted" className="mt-2">
              {basis}
            </Text>
          ))}
        </section>

        <section aria-label={t('actionCenter.details.scoring', 'Scoring basis')}>
          <PanelTitle>
            {t('actionCenter.details.scoring', 'Scoring basis')}
          </PanelTitle>
          <Text as="p" size="xs" weight="semibold" className="mt-2 text-cyan-300">
            {t('actionCenter.details.rankScore', 'Rank {{score}}', {
              score: recommendation.rank.score,
            })}
          </Text>
          {recommendation.rank.basis.map((basis) => (
            <Text key={basis} as="p" size="xs" color="muted" className="mt-1">
              {basis}
            </Text>
          ))}
        </section>
      </div>

      <section className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-label={t('actionCenter.history.title', 'Action history')}>
        <PanelTitle>
          {t('actionCenter.history.title', 'Action history')}
        </PanelTitle>
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
                <Text as="span" size="xs" color="secondary">
                  {t(`actionCenter.action.${event.action}`, event.action)} ·{' '}
                  {t(`actionCenter.state.${event.from_state}`, event.from_state)} →{' '}
                  {t(`actionCenter.state.${event.to_state}`, event.to_state)} ·{' '}
                  {t(`actionCenter.outcome.${event.outcome}`, event.outcome)}
                </Text>
                <Text as="span" size="xs" color="muted">
                  {formatDateTime(event.occurred_at)}
                </Text>
              </div>
            ))}
          </div>
        )}
      </section>
    </Accordion>
  );
}
