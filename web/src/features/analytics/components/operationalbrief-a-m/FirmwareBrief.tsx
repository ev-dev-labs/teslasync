import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError } from '@/components/feedback';
import { HelpTooltip } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { FirmwareImpact, FirmwareImpactSummary } from '../../lib/firmwareImpact';
import type { FirmwareImpactState } from '../firmware-impact-modernization/firmwareImpactState';

export function FirmwareBrief({ summary, best, worst, state, onRetry }: {
  summary: FirmwareImpactSummary; best: FirmwareImpact | null; worst: FirmwareImpact | null;
  state: FirmwareImpactState; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const testedLabel = t('firmwareImpact.tested', 'Updates tested');
  const testedHelp = t('firmwareImpact.modernization.testedHelp', 'Each install splits returned drives into before and after windows clipped at neighboring installs. Welch’s t-test compares consumption samples without assuming equal variance. This observational comparison does not isolate a firmware effect.');
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'firmware-updates-tested', rawValue: state.hasInputs ? summary.impacts.length : null,
      label: testedLabel, context: t('firmwareImpact.skipped', '{{n}} skipped for thin data', { n: summary.skipped }), description: testedHelp },
    { metricId: 'count', occurrenceId: 'firmware-significant-comparisons', rawValue: state.hasInputs ? summary.significantCount : null,
      label: t('firmwareImpact.modernization.significant', 'Significant comparisons'),
      context: t('firmwareImpact.significantHint', 'p < 0.05 with a non-trivial effect') },
    { metricId: 'efficiency', occurrenceId: 'firmware-best', rawValue: state.hasInputs && best ? best.deltaWhPerKm / 1000 : null,
      label: t('firmwareImpact.best', 'Biggest gain'),
      display: { formatter: raw => ({ value: `${Math.round(raw * 1000 * 10) / 10}`, unit: 'Wh/km' }) },
      context: best?.version ?? t('firmwareImpact.none', 'None detected') },
    { metricId: 'efficiency', occurrenceId: 'firmware-worst', rawValue: state.hasInputs && worst ? worst.deltaWhPerKm / 1000 : null,
      label: t('firmwareImpact.worst', 'Biggest regression'),
      display: { formatter: raw => ({ value: `+${Math.round(raw * 1000 * 10) / 10}`, unit: 'Wh/km' }) },
      context: worst?.version ?? t('firmwareImpact.none', 'None detected') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const limits = t('firmwareImpact.modernization.historyLimit', 'Comparisons use only the histories returned by the existing endpoints, not guaranteed complete vehicle history. Each nominal window spans 30 days before or after an install and is clipped at neighboring installs.');
  return <div id="firmware-impact-counts" className="space-y-3">
    <OperationalBrief compact title={t('firmwareImpact.kpis', 'Firmware impact metrics')}
      eyebrow={t('firmwareImpact.title', 'Firmware impact')} description={limits}
      metrics={operationalMetrics} loading={state.loading}
      statusLabel={state.loading ? t('analytics.brief.loading', 'Loading evidence')
        : !state.hasInputs ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : state.retained ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={state.retained || state.fatalError ? 'warning' : 'neutral'}
      scope={<span>{t('firmwareImpact.modernization.period', 'Returned history · install-centered windows')}</span>}
      provenance={limits}
      actions={state.hasInputs ? <HelpTooltip size="xs" i18nKey="firmwareImpact.modernization.testedHelp"
        defaultValue={testedHelp} ariaLabel={t('metricCard.moreInfoAbout', 'More info about {{label}}', { label: testedLabel })} /> : undefined}
    />
    {state.fatalError ? <QueryError error={state.fatalError} onRetry={onRetry} />
      : !state.loading && !state.hasInputs ? <EmptyState
        message={t('firmwareImpact.modernization.waiting', 'Waiting for both drive history and software updates.')}
        action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }} /> : null}
  </div>;
}
