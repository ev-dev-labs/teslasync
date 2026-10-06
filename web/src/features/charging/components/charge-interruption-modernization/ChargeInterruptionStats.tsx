import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import { Badge, HelpTooltip } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { ChargeInterruptionSummary } from '../../lib/chargeInterruption';

interface ChargeInterruptionStatsProps {
  summary: ChargeInterruptionSummary | undefined;
  loading: boolean;
  retained: boolean;
  error: Error | null;
  unavailableReason?: string;
  onRetry: () => void;
}

/** Observed history only: the hook's existing 1,000-row cap is not a lifetime
 * aggregate or an analysis-range contract. No query/model changes live here. */
export function ChargeInterruptionStats({
  summary, loading, retained, error, onRetry, unavailableReason,
}: ChargeInterruptionStatsProps) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const missingReason = unavailableReason ?? t(
    'chargeInterruption.modernization.unavailable',
    'Charging history has not been loaded.',
  );
  const noEvidence = t(
    'chargeInterruption.modernization.noEvidence',
    'No evaluable sessions; this is the model prior, not an evidence-based estimate.',
  );
  const riskHelp = t(
    'help.chargeInterruption.overallRisk',
    'A Beta-Bayesian estimate, not a count of confirmed failures. Every signal used (missing end SoC, a stalled charge rate, a power collapse, an early abort) is circumstantial — each has an innocent explanation too. This number is a probability, weighted by how much evidence exists, never a verdict.',
  );
  const highestHelp = t(
    'help.chargeInterruption.highestRisk',
    'Ranked by the conservative (2.5th percentile) bound of the risk estimate, not the raw average — so a single unlucky session at a brand-new site can’t outrank a site with a real, well-evidenced pattern.',
  );
  const countDisplay = { precision: 0, units: { locale } };
  const riskDisplay = { precision, units: { locale } };
  const metrics: StatMetric[] = [
    {
      metricId: 'percent', occurrenceId: 'charge-interruption-overall-risk',
      label: t('chargeInterruption.overallRisk', 'Overall Risk'),
      rawValue: summary != null ? summary.overallPosteriorMean * 100 : undefined,
      description: riskHelp,
      missingReason,
      display: riskDisplay,
      context: (
        <div className="space-y-1">
          <span className="block">{t('chargeInterruption.overallRiskHint', 'pooled across {{n}} evaluable sessions', {
            n: summary?.evaluableSessions ?? '—',
          })}</span>
          {summary?.evaluableSessions === 0 ? <span className="block">{noEvidence}</span> : summary ? (
            <Badge variant={summary.overallPosteriorMean > 0.3 ? 'danger' : summary.overallPosteriorMean > 0.15 ? 'warning' : 'success'} size="sm">
              {summary.overallPosteriorMean > 0.3
                ? t('chargeInterruption.modernization.riskHigh', 'Higher modeled risk')
                : summary.overallPosteriorMean > 0.15
                  ? t('chargeInterruption.modernization.riskElevated', 'Elevated modeled risk')
                  : t('chargeInterruption.modernization.riskLower', 'Lower modeled risk')}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      metricId: 'count', occurrenceId: 'charge-interruption-suspected',
      label: t('chargeInterruption.suspected', 'Suspected Sessions'),
      rawValue: summary?.suspectedSessions,
      display: countDisplay, missingReason,
      description: t(
        'chargeInterruption.modernization.suspectedHelp',
        'Sessions flagged by at least one circumstantial signal, not confirmed interruptions.',
      ),
      context: t('chargeInterruption.suspectedHint', 'of {{n}} scoreable sessions', {
        n: summary?.evaluableSessions ?? '—',
      }),
    },
    {
      metricId: 'percent', occurrenceId: 'charge-interruption-highest-risk',
      label: t('chargeInterruption.highestRisk', 'Highest-Risk Site'),
      rawValue: summary?.highestRiskSite != null ? summary.highestRiskSite.posteriorMean * 100 : undefined,
      description: highestHelp,
      display: riskDisplay,
      missingReason: summary ? t('chargeInterruption.none', 'None yet') : missingReason,
      context: summary?.highestRiskSite?.label ?? t('chargeInterruption.none', 'None yet'),
    },
    {
      metricId: 'count', occurrenceId: 'charge-interruption-sites',
      label: t('chargeInterruption.sitesTracked', 'Sites Tracked'),
      rawValue: summary?.sites.length,
      display: countDisplay, missingReason,
      description: t(
        'chargeInterruption.modernization.sitesHelp',
        'Charging locations represented in the loaded history, including locations without scoreable evidence.',
      ),
      context: t('chargeInterruption.sitesTrackedHint', '{{n}} sessions total', {
        n: summary?.totalSessions ?? '—',
      }),
    },
    {
      metricId: 'count', occurrenceId: 'charge-interruption-loaded-sessions',
      label: t('chargeInterruption.modernization.loadedSessions', 'Loaded sessions'),
      rawValue: summary?.totalSessions,
      display: countDisplay, missingReason,
      description: t(
        'chargeInterruption.modernization.loadedHelp',
        'Number of sessions returned by the existing charging-history query, capped at 1,000. This is not a lifetime total.',
      ),
      context: t('chargeInterruption.modernization.loadedContext', 'Observed history · up to 1,000 sessions'),
    },
    {
      metricId: 'count', occurrenceId: 'charge-interruption-evaluable-sessions',
      label: t('chargeInterruption.modernization.evaluableSessions', 'Evaluable sessions'),
      rawValue: summary?.evaluableSessions,
      display: countDisplay, missingReason,
      description: t(
        'chargeInterruption.modernization.evaluableHelp',
        'Sessions admitted by the existing interruption model’s scoreability rules; this is the evidence denominator.',
      ),
      context: t(
        'chargeInterruption.modernization.evaluableContext',
        'Not every loaded session is scoreable',
      ),
    },
  ];

  return (
    <StatStrip
      id="charge-interruption-summary"
      title={t('chargeInterruption.kpis', 'Charge interruption metrics')}
      metrics={metrics}
      loading={loading}
      retained={retained}
      className="w-full min-w-0"
      period={{
        kind: 'unknown',
        label: t('chargeInterruption.modernization.period', 'Loaded charging history'),
        reason: t(
          'chargeInterruption.modernization.scope',
          'Selected vehicle · up to 1,000 returned sessions. Coverage and time bounds are not reported; this model does not use the workspace date range.',
        ),
      }}
      secondary={
        <div className="flex flex-wrap items-center gap-2">
          <span>{t('chargeInterruption.modernization.model', 'Indirect evidence, not a hardware diagnosis')}</span>
          <HelpTooltip
            i18nKey="help.chargeInterruption.overallRisk"
            defaultValue={riskHelp}
            ariaLabel={t('chargeInterruption.overallRisk', 'Overall Risk')}
          />
          <HelpTooltip
            i18nKey="help.chargeInterruption.highestRisk"
            defaultValue={highestHelp}
            ariaLabel={t('chargeInterruption.highestRisk', 'Highest-Risk Site')}
          />
        </div>
      }
      footer={error ? (
        <QueryError
          error={error}
          resourceName={t('chargeInterruption.modernization.source', 'Charging history')}
          onRetry={onRetry}
        />
      ) : undefined}
    />
  );
}
