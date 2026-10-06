import { useTranslation } from 'react-i18next';
import { Activity, MapPin, Plug, Zap } from 'lucide-react';
import { type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { Badge, Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import type { ChargerHealthSummary } from '../../lib/chargerHealth';
import { ChargerHealthSourceNotice } from './ChargerHealthSourceNotice';

interface ChargerHealthStatsProps {
  summary: ChargerHealthSummary;
  state: DataState<unknown>;
  loading: boolean;
}

export function ChargerHealthStats({ summary, state, loading }: ChargerHealthStatsProps) {
  const { t } = useTranslation();
  const judged = summary.sites.filter(site => site.status !== 'unknown');
  const hasBenchmarks = state.hasData && judged.length > 0;
  // The specialist returns hours; the shared duration formatter accepts seconds.
  // This is a render-boundary operand only: no cached/source value is changed.
  const totalHoursLost = summary.sites.reduce((sum, site) => sum + site.hoursLostPerYear, 0);
  const noSource = t('chargerHealth.metrics.noSource', 'Charging sessions have not been loaded.');
  const missing = state.hasData
    ? t('chargerHealth.metrics.missing', 'No location has enough clean sessions for a health benchmark.')
    : noSource;
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('chargerHealth.metrics.period', 'Returned charging history'),
    reason: t('chargerHealth.metrics.window', 'The existing sessions endpoint returns an observed history window, not a guaranteed lifetime or calendar-year total.'),
  };
  const metrics: StatMetric[] = [
    {
      metricId: 'count',
      occurrenceId: 'charger-health-sites',
      label: t('chargerHealth.sites', 'Locations Tracked'),
      rawValue: state.hasData ? summary.sites.length : null,
      missingReason: noSource,
      description: t('help.chargerHealth.sites',
        'Each location is judged only against itself. Comparing a home wall box to a Supercharger would be meaningless, so instead every site establishes its own demonstrated ceiling from its cleanest past sessions, and recent sessions are measured against that. Sessions that sat mostly above the taper threshold are excluded, because a slow charge from 80 % is physics, not a fault.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <MapPin className="h-4 w-4" aria-hidden="true" />
        {state.hasData
          ? t('chargerHealth.sessionsHint', '{{n}} scorable sessions', { n: summary.usableSessions })
          : noSource}
      </span>,
    },
    {
      metricId: 'count',
      occurrenceId: 'charger-health-underperforming',
      label: t('chargerHealth.degraded', 'Underperforming'),
      rawValue: hasBenchmarks ? summary.degradedCount : null,
      missingReason: missing,
      description: t('chargerHealth.metrics.underperformingMethod', 'Counts slipping and degraded sites among locations with enough clean sessions; unrated locations are not healthy by default.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Activity className="h-4 w-4" aria-hidden="true" />
        <Badge variant={hasBenchmarks ? summary.degradedCount > 0 ? 'danger' : 'success' : 'neutral'} size="sm">
          {t('chargerHealth.degradedHint', 'sites below their own baseline')}
        </Badge>
      </span>,
    },
    {
      metricId: 'power',
      occurrenceId: 'charger-health-fastest',
      label: t('chargerHealth.fastest', 'Fastest Site'),
      rawValue: state.hasData ? summary.fastestSite?.baselineW : null,
      missingReason: missing,
      description: t('chargerHealth.metrics.fastestMethod', 'Highest demonstrated baseline among rated locations, not a charger nameplate rating or directly measured health.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Zap className="h-4 w-4" aria-hidden="true" />
        {summary.fastestSite?.label ?? t('chargerHealth.none', 'None yet')}
      </span>,
    },
    {
      metricId: 'duration',
      occurrenceId: 'charger-health-time-lost',
      label: t('chargerHealth.timeLost', 'Time Lost per Year'),
      rawValue: hasBenchmarks ? totalHoursLost * 3600 : null,
      missingReason: missing,
      display: { precision: 0 },
      description: t('chargerHealth.metrics.timeLostMethod', 'Annualized estimate from observed usage and persistent shortfall at rated sites. It is not a measured annual total; unbenchmarked sites are excluded.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Plug className="h-4 w-4" aria-hidden="true" />
        <Badge variant={hasBenchmarks ? totalHoursLost > 0 ? 'warning' : 'success' : 'neutral'} size="sm">
          {t('chargerHealth.timeLostHint', 'extra plugged-in hours from shortfall')}
        </Badge>
      </span>,
    },
  ];
  return <ChargingSummaryBrief
    id="charger-health-metrics"
    title={t('chargerHealth.kpis', 'Charger health metrics')}
    metrics={metrics}
    period={period}
    loading={loading}
    retained={state.hasData && state.status === 'stale'}
    secondary={<Text as="p" variant="bodySm">
      {t('chargerHealth.metrics.inferred', 'Health is inferred from session energy and duration against each location’s own baseline, not directly measured charger condition. Cold packs, tapering and missing observations can limit the conclusion.')}
    </Text>}
    footer={<ChargerHealthSourceNotice state={state} />}
  />;
}
