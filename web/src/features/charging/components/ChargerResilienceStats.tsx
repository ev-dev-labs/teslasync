import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from './operationalbrief-all/ChargingSummaryBrief';
import { HelpTooltip } from '@/components/ui';
import { EmptyState, QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DataState } from '@/api/dataState';
import type { analyzeChargerResilience } from '../lib/chargerResilience';

interface Props {
  summary: ReturnType<typeof analyzeChargerResilience>;
  state: DataState<unknown>;
  loading: boolean;
}

export function ChargerResilienceStats({ summary, state, loading }: Props) {
  const { t } = useTranslation();
  const { fmtPercent, fmtNumber } = useNumberFormatting();
  const available = state.hasData && summary.sites.length > 0;
  const metrics: StatMetric[] = [
    {
      metricId: 'number', occurrenceId: 'resilience-score',
      label: t('chargerResilience.score', 'Resilience Score'),
      rawValue: available ? summary.resilienceScore : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) },
      context: <div className="flex flex-wrap items-center gap-1">
        {t('chargerResilience.scoreHint', 'out of 100')}
        <HelpTooltip
          i18nKey="help.chargerResilience.score"
          defaultValue="A composite of three things: how much energy is NOT concentrated in your top site (40%), how often an alternate site has actually been used rather than just being available on paper (30%), and how many effectively-equal sites your charging behaves like (30%)."
        />
      </div>,
    },
    {
      metricId: 'number', occurrenceId: 'effective-sites',
      label: t('chargerResilience.effectiveSites', 'Effective Site Count'),
      rawValue: available ? summary.effectiveSiteCount : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) },
      context: <div className="flex flex-wrap items-center gap-1">
        {t('chargerResilience.effectiveSitesHint', '{{n}} locations seen', { n: state.hasData ? summary.sites.length : '—' })}
        <HelpTooltip
          i18nKey="help.chargerResilience.effectiveSites"
          defaultValue="The reciprocal of the energy-weighted Herfindahl-Hirschman Index (1/HHI) — the number of equally-sized sites this portfolio behaves like. Usually smaller than a raw count of distinct locations, because a handful of those were only visited once."
        />
      </div>,
    },
    {
      metricId: 'percent', occurrenceId: 'top-site-dependency',
      label: t('chargerResilience.topDependency', 'Top-Site Dependency'),
      rawValue: available ? summary.topSiteDependencyPct : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: summary.topSite?.label ?? t('chargerResilience.none', 'None yet'),
    },
    {
      metricId: 'percent', occurrenceId: 'fallback-coverage',
      label: t('chargerResilience.fallback', 'Fallback Coverage'),
      rawValue: available ? summary.fallbackCoveragePct : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: t('chargerResilience.fallbackHint', 'sessions charged elsewhere'),
    },
  ];

  return <ChargingSummaryBrief
    id="charger-resilience-metrics"
    title={t('chargerResilience.kpis', 'Charger resilience metrics')}
    metrics={metrics}
    loading={loading}
    retained={state.hasData && (state.refreshError != null || state.isRefreshBlocked)}
    footer={state.fatalError
      ? <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
      : !state.hasData && !loading
        ? <EmptyState
          message={t('chargerResilience.historyUnavailable', 'Charging history has not loaded. Retry this source or reconnect to continue.')}
          action={state.retry ? { label: t('error.retry', 'Retry'), onClick: state.retry } : undefined}
        />
        : undefined}
    period={{
      kind: 'unknown',
      label: t('dataSources.labels.chargingHistory', 'Charging history'),
      reason: t('chargerResilience.loadedHistory', 'Calculated from returned charging history, not a complete time-range guarantee.'),
    }}
  />;
}
