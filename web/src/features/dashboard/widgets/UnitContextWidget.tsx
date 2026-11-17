import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { Badge, Caption, Code, Icon, MetricValue, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { SourceContent, type SourceState } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTicker } from '@/hooks/useTicker';
import { INTERVALS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function observation(raw: unknown, now: number) {
  const entry = raw != null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
  const timestamp = typeof entry?.ts === 'string' ? entry.ts : entry?.timestamp;
  const instant = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  return {
    present: entry != null,
    // The codec emits canonical short enum strings, not numeric unit measurements.
    value: entry?.kind === 'ValueKindEnum' && typeof entry.value === 'string' ? entry.value : null,
    at: Number.isFinite(instant) && instant > 0 && instant <= now ? instant : null,
    source: typeof entry?.source === 'string' ? entry.source : null,
    age: typeof entry?.age_ms === 'number' && Number.isFinite(entry.age_ms) && entry.age_ms >= 0
      ? entry.age_ms : null,
  };
}

export default function UnitContextWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const requestedId = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id ?? 0;
  const id = Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : 0;
  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: INTERVALS.REALTIME });
  const source = id > 0 ? liveQuery : vehiclesQuery;
  const state = useDataState<unknown>(source);
  useTicker(id > 0 && liveQuery.data != null);
  const compact = size.cols <= 1;
  const unknown = t('common.unknown', 'Unknown');
  const distance = t('dashboardWidgets.telemetry.unitContext.distance', 'Distance');
  const labels: Record<string, string> = {
    Miles: t('dashboardWidgets.telemetry.unitContext.miles', 'Miles'),
    Kilometers: t('dashboardWidgets.telemetry.unitContext.kilometers', 'Kilometers'),
    Fahrenheit: t('dashboardWidgets.telemetry.unitContext.fahrenheit', 'Fahrenheit'),
    Celsius: t('dashboardWidgets.telemetry.unitContext.celsius', 'Celsius'),
    Psi: t('dashboardWidgets.telemetry.unitContext.psi', 'PSI'),
    Bar: t('dashboardWidgets.telemetry.unitContext.bar', 'Bar'),
    Distance: distance,
    Percent: t('dashboardWidgets.telemetry.unitContext.percent', 'Percent'),
  };
  const definitions = [
    { field: 'SettingDistanceUnit', label: distance, values: ['Miles', 'Kilometers'] },
    { field: 'SettingTemperatureUnit', label: t('dashboardWidgets.telemetry.unitContext.temperature', 'Temperature'), values: ['Fahrenheit', 'Celsius'] },
    { field: 'SettingTirePressureUnit', label: t('dashboardWidgets.telemetry.unitContext.pressure', 'Tire pressure'), values: ['Psi', 'Bar'] },
    { field: 'SettingChargeUnit', label: t('dashboardWidgets.telemetry.unitContext.charge', 'Charge'), values: ['Distance', 'Percent'] },
  ];
  const now = Date.now();
  const hasSnapshot = id > 0 && liveQuery.data?.vehicle_id === id;
  const signals: Record<string, unknown> = hasSnapshot ? liveQuery.data?.signals ?? {} : {};
  const rows = definitions.map(definition => {
    const reading = observation(signals[definition.field], now);
    const value = reading.value != null && definition.values.includes(reading.value)
      ? labels[reading.value] : null;
    const retained = reading.present && (state.refreshError != null || state.isRefreshBlocked || state.status === 'stale');
    const stale = reading.source === 'stale' || (reading.at != null && now - reading.at > 120_000)
      || (reading.age != null && reading.age > 120_000);
    const fresh = value != null && !retained && !stale && reading.at != null && reading.age != null && reading.source === 'l1';
    const status = !reading.present ? hasSnapshot
      ? t('dashboardWidgets.telemetry.unitContext.notObserved', 'Not observed') : t('dashboardWidgets.telemetry.unitContext.unknownContext', 'Unknown context')
      : retained ? t('dashboardWidgets.telemetry.unitContext.retained', 'Retained observation')
      : value == null ? t('dashboardWidgets.telemetry.unitContext.unknownContext', 'Unknown context')
      : stale ? t('dashboardWidgets.telemetry.unitContext.stale', 'Stale observation')
      : fresh ? t('dashboardWidgets.telemetry.unitContext.fresh', 'Fresh observation')
      : t('dashboardWidgets.telemetry.unitContext.freshnessUnknown', 'Freshness unknown');
    return { ...definition, ...reading, display: value ?? unknown, status, warning: retained || stale };
  });
  const sourceState: SourceState = state.fatalError ? 'error'
    : state.status === 'initial' ? 'loading'
    : state.refreshError || state.isRefreshBlocked || state.status === 'stale' ? 'retained'
    : rows.some(row => row.present) ? 'ready' : 'empty';
  const title = t('dashboardWidgets.telemetry.unitContext.title', 'Signal unit context');
  const refresh = () => { void source.refetch(); };
  const sourceNotice = (
    <div data-data-state={state.status} aria-busy={sourceState === 'loading' || state.isRefreshing}>
      <SourceContent
        state={sourceState}
        label={title}
        emptyMessage={t('dashboardWidgets.telemetry.unitContext.noObservations', 'No unit-setting observations are available for this vehicle.')}
        emptyContent={<Caption as="p">{id > 0
          ? t('dashboardWidgets.telemetry.unitContext.noObservations', 'No unit-setting observations are available for this vehicle.')
          : t('dashboardWidgets.telemetry.unitContext.noVehicle', 'Select a vehicle to inspect its unit context.')}</Caption>}
        loadingContent={<Caption as="p">{t('dashboardWidgets.telemetry.unitContext.loading', 'Loading unit-setting evidence…')}</Caption>}
        errorMessage={t('dashboardWidgets.telemetry.unitContext.error', 'Unit-setting evidence could not be loaded.')}
        error={state.fatalError}
        errorRecovery={{ onRetry: source.isFetching ? undefined : refresh }}
        retainedMessage={t('dashboardWidgets.telemetry.unitContext.retainedNotice', 'Previously loaded unit settings remain visible; the latest refresh is unconfirmed.')}
      >{null}</SourceContent>
    </div>
  );
  const headline = (
    <div className="min-w-0">
      <MetricValue>{t('dashboardWidgets.telemetry.unitContext.headline', 'Unit context')}</MetricValue>
      <Caption>{t('dashboardWidgets.telemetry.unitContext.subtitle', 'Telemetry preferences')}</Caption>
    </div>
  );
  const settings = (
    <ul data-app-part="list" className={cn('m-0 grid min-w-0 list-none gap-x-4 p-0', !compact && '@md:grid-cols-2')}
      aria-label={t('dashboardWidgets.telemetry.unitContext.subtitle', 'Telemetry preferences')}>
      {rows.map(row => (
        <li key={row.field} aria-label={row.label} className="min-w-0 space-y-2 border-b border-[var(--border-subtle)] py-3">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <Text variant="label">{row.label}</Text>
            {sourceState === 'loading' ? <Skeleton className="h-5 w-16" /> : <Text variant="body" mono>{row.display}</Text>}
          </div>
          <Badge variant={row.warning ? 'warning' : 'neutral'}>{row.status}</Badge>
          <Caption as="p">{t('dashboardWidgets.telemetry.unitContext.observedAt', 'Observed: {{timestamp}}', {
            timestamp: row.at == null ? unknown : formatDateTime(row.at),
          })}</Caption>
          {!compact && <Code className="block break-all">{row.field}</Code>}
        </li>
      ))}
    </ul>
  );
  const details = (
    <div className="min-w-0 space-y-2">
      <Text as="p" variant="bodySm">{t('dashboardWidgets.telemetry.unitContext.normalization', 'Normalization context: Unknown')}</Text>
      <Caption as="p">{t('dashboardWidgets.telemetry.unitContext.historyNote', 'Live preferences do not confirm the unit context used for normalization. A vehicle unit-history reader is not available here.')}</Caption>
      <Caption as="p">{t('dashboardWidgets.telemetry.unitContext.note', 'Unit settings are ingestion metadata; missing context must not be silently guessed.')}</Caption>
      <Caption as="p">{t('dashboardWidgets.telemetry.unitContext.supportNote', 'Vehicle support and applied subscription state remain unknown; configuration is not observation evidence.')}</Caption>
    </div>
  );
  return (
    <WidgetShell
      title={title}
      icon={<Icon icon={Settings2} size="sm" />}
      updatedAt={source.dataUpdatedAt}
      isFetching={source.isFetching}
      isStale={source.isStale}
      isError={source.isError}
      onRefresh={refresh}
      refreshIntervalMs={id > 0 ? INTERVALS.REALTIME : undefined}
      footer={<Caption>{t('dashboardWidgets.telemetry.unitContext.source', 'Source: vehicle live signal snapshot, not application display preferences.')}</Caption>}
    >
      <InstrumentPresentation family="status" compact={compact}
        icon={<Icon icon={Settings2} size="xl" />} headline={headline}
        context={sourceNotice} instrument={settings} details={details}>
        <div className={cn('flex min-w-0 flex-col', compact ? 'gap-2' : 'gap-4')}>
          {sourceNotice}
          {headline}
          {settings}
          {details}
        </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
