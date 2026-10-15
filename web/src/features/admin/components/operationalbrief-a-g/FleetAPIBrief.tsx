import type { StatMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import type { useFleetAPIPage } from '../../hooks/useFleetAPIPage';
import { AdminSummary } from './AdminSummary';

export function FleetAPIBrief({ controller }: { controller: ReturnType<typeof useFleetAPIPage> }) {
  const { t, fmtInt, pollingConfig, catalog, totalCount, enabledCount, autoCount, apiSuspended, apiStatusKnown,
    settingsState, pollingState, kpiLoading } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;
  const metrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'status', label: t('fleetApi.kpis.apiStatus', 'API status'),
      rawValue: apiStatusKnown && pollingKnown
        ? apiSuspended ? t('fleetApi.status.suspended', 'Suspended')
          : pollingConfig.auto_polling_enabled ? t('fleetApi.status.polling', 'Polling enabled')
            : t('fleetApi.status.onDemand', 'On demand only')
        : undefined,
      context: t('fleetApi.kpis.apiStatusHint', 'Automatic Fleet API polling') },
    { metricId: 'count', occurrenceId: 'enabled', label: t('fleetApi.kpis.endpointsEnabled', 'Endpoints enabled'),
      rawValue: pollingKnown ? enabledCount : undefined,
      display: { countTotal: totalCount, formatter: raw => ({ value: `${fmtInt(raw)} / ${fmtInt(totalCount)}`, unit: '' }) },
      context: pollingKnown ? t('fleetApi.kpis.endpointsHint', '{{count}} selected for polling', { count: autoCount }) : undefined },
    { metricId: 'count', occurrenceId: 'selected', label: t('fleetApi.summary.selected', 'Selected for polling'),
      rawValue: pollingKnown ? autoCount : undefined },
  ];
  return <FadeIn><AdminSummary metrics={metrics} testId="fleet-api-summary"
    eyebrow={t('fleetApi.pageTitle', 'Fleet API settings')} title={t('fleetApi.kpis.label', 'Fleet API summary')}
    description={t('fleetApi.summary.source', 'API status uses application settings and polling configuration. Enabled and selected-for-polling counts use the returned endpoint catalog, independent of the endpoint table filters.')}
    scope={t('fleetApi.summary.scope', 'Settings and polling snapshots; no shared observation time is reported.')}
    sourceStatus={settingsState.status === 'stale' || pollingState.status === 'stale' ? 'stale'
      : settingsState.isRefreshing || pollingState.isRefreshing ? 'refreshing'
        : apiStatusKnown && pollingKnown ? 'ready' : 'partial'} loading={kpiLoading} /></FadeIn>;
}
