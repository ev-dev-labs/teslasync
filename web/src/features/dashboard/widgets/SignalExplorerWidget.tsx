import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio, RefreshCw, Search } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAvailableSignals } from '@/api/hooks/useSignals';
import { useFleetTelemetryCoverage } from '@/api/hooks/useFleetTelemetry';
import { useSignalHistory, useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import type { DataState } from '@/api/dataState';
import type { SignalKind, SignalValue } from '@/api/types';
import { Button, Caption, Input, PanelTitle, Select, Text } from '@/components/ui';
import { SourceContent, type SourceState } from '@/components/layout';
import { Timeline } from '@/components/data-display';
import {
  EmbeddedChart, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ChartTooltip, CHART_COLORS, axisTick, chartGrid,
} from '@/components/charts';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { normalizeSignalKind } from '@/lib/signalKind';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { useTimelineStyles } from './designPacks/useTimelineStyles';
import type { WidgetProps } from './types';

function sourceState(state: DataState<unknown>, hasContent: boolean): SourceState {
  if (state.fatalError) return 'error';
  if (state.status === 'initial') return 'loading';
  if (state.refreshError || state.isRefreshBlocked || state.status === 'stale') return 'retained';
  return hasContent ? 'ready' : 'empty';
}

function typedValue(kind: SignalKind, value: unknown): SignalValue {
  if (kind === 'float' || kind === 'int') {
    return typeof value === 'number' && Number.isFinite(value)
      && (kind !== 'int' || Number.isSafeInteger(value)) ? value : null;
  }
  if (kind === 'bool') return typeof value === 'boolean' ? value : null;
  if (kind === 'string') return typeof value === 'string' ? value : null;
  if (kind === 'time') return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  return null;
}

function observation(raw: unknown) {
  const entry = raw != null && typeof raw === 'object' && 'value' in raw
    ? raw as Record<string, unknown> : null;
  const kind = normalizeSignalKind(entry?.kind, entry?.value);
  const timestamp = entry?.ts ?? entry?.timestamp;
  const instant = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  return {
    kind,
    isEnum: entry?.kind === 'ValueKindEnum',
    value: typedValue(kind, entry?.value),
    at: Number.isFinite(instant) && instant > 0 && instant <= Date.now() ? instant : null,
    source: typeof entry?.source === 'string' ? entry.source : null,
    age: typeof entry?.age_ms === 'number' && Number.isFinite(entry.age_ms) && entry.age_ms >= 0
      ? entry.age_ms : null,
  };
}

export default function SignalExplorerWidget({ vehicleId, size, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const vehiclesState = useDataState(vehiclesQuery);
  const id = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id ?? 0;
  const compact = size.cols <= 1;
  const range = useRangeState();
  const { formatDateTime, formatTime } = useDateFormat();
  const units = useUnits();
  const { formatPressureValue } = usePressureFormat();
  const { fmtNumber } = useNumberFormatting();
  const appearance = useTimelineStyles();
  const [selection, setSelection] = useState<{ vehicle: number; configured: string; field: string; child: string } | null>(null);
  const [search, setSearch] = useState('');
  const catalogQuery = useAvailableSignals(id);
  const coverageQuery = useFleetTelemetryCoverage();
  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  const catalogState = useDataState(catalogQuery);
  const coverageState = useDataState(coverageQuery);
  const liveState = useDataState(liveQuery, { provenance: 'live' });
  const catalog = catalogQuery.data?.signals ?? [];
  const routes = useMemo(() => new Map(
    (coverageQuery.data?.categories ?? []).flatMap(category => category.fields ?? [])
      .map(route => [route.field, route] as const),
  ), [coverageQuery.data]);
  const configuredField = typeof config?.signalName === 'string' ? config.signalName
    : typeof config?.signal === 'string' ? config.signal : '';
  const localSelection = selection?.vehicle === id && selection.configured === configuredField ? selection : null;
  const requested = localSelection?.field ?? configuredField;
  // An explicitly configured field is never silently replaced by a different measurement.
  const field = requested ? catalog.find(item => item.name === requested)
    ?? (routes.has(requested) ? catalog.find(item => item.is_compound && requested.startsWith(item.name)) : undefined)
    : catalog.find(item => item.name === 'BatteryLevel') ?? catalog[0];
  const signals = liveQuery.data?.signals ?? {};
  const childNames = useMemo(() => field?.is_compound
    ? [...new Set([...routes.keys(), ...Object.keys(liveQuery.data?.signals ?? {})])]
      .filter(name => name.startsWith(field.name) && (name !== field.name || routes.has(name))).sort()
    : field ? [field.name] : [], [field, routes, liveQuery.data]);
  const requestedChild = localSelection?.child || (field?.is_compound && requested !== field.name ? requested : '');
  const selectedChild = childNames.includes(requestedChild) ? requestedChild : childNames[0] ?? '';
  const route = routes.get(selectedChild);
  const dropped = route?.destination === 'drop';
  const historyAvailable = !field?.is_setting_unit && !dropped
    && (route?.destination === 'signal_log' || route?.also_signal_log === true);
  const historyQuery = useSignalHistory(id, historyAvailable ? selectedChild : '', 24, range);
  const historyState = useDataState(historyQuery, { provenance: 'historical' });
  const history = historyQuery.data?.data ?? [];
  const unknown = t('common.unknown', 'Unknown');
  const current = observation(signals[selectedChild]);
  const firstTypedPoint = history.find(point => normalizeSignalKind(point.kind, point.value) !== 'unknown');
  const historyKind = normalizeSignalKind(firstTypedPoint?.kind, firstTypedPoint?.value);
  const effectiveKind = current.kind !== 'unknown' ? current.kind
    : historyKind !== 'unknown' ? historyKind : field?.value_kind;
  const numeric = effectiveKind === 'float' || effectiveKind === 'int';
  const enumHistory = current.isEnum || history.some(point => point.kind === 'ValueKindEnum');
  const matches = catalog.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const options = field && !matches.includes(field) ? [field, ...matches] : matches;

  function formatValue(value: SignalValue, kind: SignalKind, name = selectedChild): string {
    if (value == null) return unknown;
    if (typeof value === 'boolean') return value ? t('common.yes', 'Yes') : t('common.no', 'No');
    if (typeof value === 'string') return kind === 'time' ? formatDateTime(value)
      : value || t('dashboardWidgets.driving.signalExplorer.emptyText', '(empty text)');
    if (name === 'ChargeRateMilePerHour') return `${units.formatDistance(value)}/h`;
    switch (field?.unit_kind) {
      case 'distance': return units.formatDistance(value);
      case 'speed': return units.formatSpeed(value);
      case 'temperature': return units.formatTemperature(value);
      case 'pressure': return formatPressureValue(value);
      case 'charge': return value >= 0 && value <= 100 ? `${fmtNumber(value, 1)} %` : unknown;
    }
    // These fixed-wire fields are normalized by units.IsFixedKiloToBaseField.
    // Other UnitKindNone readings remain raw; name suffixes do not prove SI.
    if (['ACChargingPower', 'DCChargingPower'].includes(name)) return units.formatPower(value);
    if (['ACChargingEnergyIn', 'DCChargingEnergyIn', 'LifetimeEnergyChargedKwh',
      'LifetimeDcChargeEnergyKwh', 'NominalFullPackEnergyKwh'].includes(name)) return units.formatEnergy(value);
    if (name === 'PackCurrent' || name === 'ChargeAmps') return `${fmtNumber(value, 1)} A`;
    if (name === 'PackVoltage' || name === 'ChargerVoltage') return `${fmtNumber(value, 1)} V`;
    return fmtNumber(value, kind === 'int' ? 0 : 2);
  }

  function freshness(reading: ReturnType<typeof observation>, name: string) {
    if (routes.get(name)?.destination === 'drop') return t('dashboardWidgets.driving.signalExplorer.dropped', 'Dropped; unavailable');
    if (reading.value == null || reading.at == null || reading.source == null || reading.source === 'unknown'
      || (field?.unit_kind === 'charge' && typeof reading.value === 'number' && (reading.value < 0 || reading.value > 100))) {
      return t('dashboardWidgets.driving.signalExplorer.freshnessUnknown', 'Freshness unknown');
    }
    if (liveState.refreshError || liveState.isRefreshBlocked) return t('dashboardWidgets.driving.signalExplorer.retained', 'Retained snapshot');
    if (reading.source === 'log') return t('dashboardWidgets.driving.signalExplorer.historical', 'Historical fallback');
    if (reading.source === 'stale' || Date.now() - reading.at > 120_000 || (reading.age ?? 0) > 120_000) {
      return t('dashboardWidgets.driving.signalExplorer.stale', 'Stale observation');
    }
    return reading.source === 'l1' || reading.source === 'l2'
      ? t('dashboardWidgets.driving.signalExplorer.fresh', 'Fresh observation')
      : t('dashboardWidgets.driving.signalExplorer.freshnessUnknown', 'Freshness unknown');
  }

  const historyRows = useMemo(() => history.map(point => {
    const kind = normalizeSignalKind(point.kind, point.value);
    const value = typedValue(kind, point.value);
    return { ...point, instant: Date.parse(point.ts), value: typeof value === 'number'
      && !(field?.unit_kind === 'charge' && (value < 0 || value > 100)) ? value : null };
  }), [history, field?.unit_kind]);
  const plot = useMemo(() => historyRows.filter(point => Number.isFinite(point.instant))
    .sort((a, b) => a.instant - b.instant), [historyRows]);
  const busy = catalogQuery.isFetching || coverageQuery.isFetching || liveQuery.isFetching
    || (historyAvailable && historyQuery.isFetching) || (id <= 0 && vehiclesQuery.isFetching);
  function refresh() {
    if (id > 0) void catalogQuery.refetch();
    else void vehiclesQuery.refetch();
    void coverageQuery.refetch();
    if (id > 0) void liveQuery.refetch();
    if (historyAvailable) void historyQuery.refetch();
  }

  const catalogLabel = t('dashboardWidgets.driving.signalExplorer.catalog', 'Signal inventory');
  const liveLabel = t('dashboardWidgets.driving.signalExplorer.current', 'Current observation');
  const historyLabel = t('dashboardWidgets.driving.signalExplorer.history', 'Signal history');
  const evidenceLabel = t('dashboardWidgets.driving.signalExplorer.evidence', 'Routing and evidence');
  const controls = (
    <section aria-label={catalogLabel} className="min-w-0 space-y-3">
      <PanelTitle>{catalogLabel}</PanelTitle>
      <SourceContent state={id > 0 ? sourceState(catalogState, catalog.length > 0) : sourceState(vehiclesState, false)}
        label={catalogLabel} error={id > 0 ? catalogState.fatalError : vehiclesState.fatalError}
        errorMessage={id > 0 ? t('dashboardWidgets.driving.signalExplorer.catalogError', 'Signal inventory could not be loaded.')
          : t('dashboardWidgets.driving.signalExplorer.vehicleError', 'Vehicle inventory could not be loaded.')}
        emptyMessage={id > 0 ? t('dashboardWidgets.driving.signalExplorer.catalogEmpty', 'No catalog fields are available.')
          : t('dashboardWidgets.driving.signalExplorer.vehicleRequired', 'Select a vehicle to explore its signal evidence.')}
        errorRecovery={{ onRetry: () => { if (id > 0) void catalogQuery.refetch(); else void vehiclesQuery.refetch(); } }}>
        <Input label={t('dashboardWidgets.driving.signalExplorer.search', 'Search catalog')} value={search}
          onChange={event => setSearch(event.target.value)} icon={<Search aria-hidden="true" className="size-4" />} />
        <Select label={t('dashboardWidgets.driving.signalExplorer.field', 'Signal field')} value={field?.name ?? ''}
          placeholder={!field ? t('dashboardWidgets.driving.signalExplorer.choose', 'Choose a catalog field') : undefined}
          options={options.map(item => ({ value: item.name, label: item.name }))}
          onChange={event => setSelection({ vehicle: id, configured: configuredField, field: event.target.value, child: '' })} />
        {matches.length === 0 && <Caption role="status">{t('dashboardWidgets.driving.signalExplorer.noMatches', 'No matching catalog fields.')}</Caption>}
        {requested && !field && <Text variant="bodySm" role="status">
          {t('dashboardWidgets.driving.signalExplorer.configuredMissing', 'Configured field is not in this catalog: {{field}}', { field: requested })}
        </Text>}
        {field?.is_compound && <Select label={t('dashboardWidgets.driving.signalExplorer.child', 'Compound child')} value={selectedChild}
          options={childNames.map(name => ({ value: name, label: name }))}
          placeholder={childNames.length ? undefined : unknown} disabled={!childNames.length}
          onChange={event => setSelection({ vehicle: id, configured: configuredField, field: field.name, child: event.target.value })} />}
        <Caption>{t('dashboardWidgets.driving.signalExplorer.inventoryCount', '{{count}} catalog definitions; not proof of vehicle support.', { count: catalog.length })}</Caption>
      </SourceContent>
    </section>
  );
  const observations = (
    <section aria-label={liveLabel} className="min-w-0 space-y-3">
      <PanelTitle>{liveLabel}</PanelTitle>
      <SourceContent state={id > 0 ? sourceState(liveState, Boolean(field && childNames.length)) : 'empty'}
        label={liveLabel} error={liveState.fatalError}
        errorMessage={t('dashboardWidgets.driving.signalExplorer.liveError', 'Live signal evidence could not be loaded.')}
        emptyMessage={t('dashboardWidgets.driving.signalExplorer.observationEmpty', 'Choose a field; unobserved compound children require the routing inventory.')}
        errorRecovery={{ onRetry: () => { void liveQuery.refetch(); } }}>
        <ul aria-label={liveLabel} className={cn('min-w-0 overflow-y-auto', compact ? 'max-h-56' : 'max-h-80', appearance?.feed)}>
          {childNames.map(name => {
            const reading = observation(signals[name]);
            const rowDropped = routes.get(name)?.destination === 'drop';
            return <li key={name} data-signal-field={name}
              className={cn('flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--border-subtle)] py-3 last:border-0', appearance?.row)}>
              <div className="min-w-0 flex-1 basis-32">
                <Text mono variant="bodySm" className="break-words">{name}</Text>
                <Caption className="block">{freshness(reading, name)}</Caption>
                <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.observedAt', 'Observed: {{time}}', {
                  time: reading.at != null ? formatDateTime(reading.at) : unknown,
                })}</Caption>
                <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.source', 'Source: {{source}}', { source: reading.source ?? unknown })}</Caption>
              </div>
              <Text mono variant="bodySm" weight="semibold" className="max-w-full break-words text-end">
                {rowDropped ? unknown : formatValue(reading.value, reading.kind, name)}
              </Text>
            </li>;
          })}
        </ul>
        <Caption>{t('dashboardWidgets.driving.signalExplorer.freshnessNote', 'Freshness is per signal, not the catalog or request time. Legacy scalars and invalid timestamps remain unknown.')}</Caption>
      </SourceContent>
    </section>
  );
  const historySection = (
    <section aria-label={historyLabel} className="min-w-0 space-y-3">
      <PanelTitle>{historyLabel}</PanelTitle>
      <Caption>{formatDateTime(range.startInstant)} — {formatDateTime(range.endInstantExclusive)}</Caption>
      <SourceContent state={historyAvailable ? sourceState(historyState, history.length > 0) : 'empty'}
        label={historyLabel} error={historyState.fatalError}
        errorMessage={t('dashboardWidgets.driving.signalExplorer.historyError', 'Signal history could not be loaded.')}
        emptyMessage={!historyAvailable
          ? field?.is_setting_unit ? t('dashboardWidgets.driving.signalExplorer.unitHistory', 'Unit settings use a separate unit-history source, not signal_log.')
            : dropped ? t('dashboardWidgets.driving.signalExplorer.dropped', 'Dropped; unavailable')
              : route ? t('dashboardWidgets.driving.signalExplorer.noHistory', 'No signal_log route; generic history is unavailable for this field.')
                : t('dashboardWidgets.driving.signalExplorer.historyUnknown', 'History eligibility is unknown until routing evidence is available.')
          : t('dashboardWidgets.driving.signalExplorer.historyEmpty', 'No recorded samples in the selected workspace range.')}
        errorRecovery={{ onRetry: () => { if (historyAvailable) void historyQuery.refetch(); } }}>
        {numeric && !enumHistory ? <EmbeddedChart title={historyLabel} ariaLabel={`${selectedChild} — ${historyLabel}`}
          height={compact ? 180 : 240} empty={plot.length === 0} toolbar={false}
          data={historyRows} dataColumns={[
            { key: 'ts', label: t('dashboardWidgets.driving.signalExplorer.timestamp', 'Timestamp'), format: value => Number.isFinite(Date.parse(String(value))) ? formatDateTime(String(value)) : unknown },
            { key: 'value', label: t('dashboardWidgets.driving.signalExplorer.value', 'Value'), format: value => formatValue(typeof value === 'number' ? value : null, 'float') },
            { key: 'ingest_origin', label: t('dashboardWidgets.driving.signalExplorer.origin', 'Ingest origin') },
            { key: 'source_emitted_at', label: t('dashboardWidgets.driving.signalExplorer.emitted', 'Source emitted at') },
            { key: 'received_at', label: t('dashboardWidgets.driving.signalExplorer.received', 'Received at') },
            { key: 'normalization_version', label: t('dashboardWidgets.driving.signalExplorer.normalization', 'Normalization version') },
          ]}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={plot}>
              <CartesianGrid {...chartGrid} />
              <XAxis type="number" scale="time" dataKey="instant" tick={axisTick}
                domain={[Date.parse(range.startInstant), Date.parse(range.endInstantExclusive)]}
                tickFormatter={value => formatTime(Number(value))} />
              <YAxis tick={axisTick} width={90} domain={['auto', 'auto']} tickFormatter={value => formatValue(Number(value), 'float')} />
              <Tooltip content={<ChartTooltip labelFormatter={value => formatDateTime(Number(value))}
                formatter={value => [formatValue(typeof value === 'number' ? value : null, 'float'), selectedChild]} />} />
              <Line type="linear" dataKey="value" name={selectedChild} stroke={CHART_COLORS[0]}
                dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </EmbeddedChart> : <div className={cn('overflow-y-auto', compact ? 'max-h-56' : 'max-h-80')}>
          <Timeline label={`${selectedChild} — ${historyLabel}`} chronology="oldest-first" items={history.map(point => ({
            title: formatValue(typedValue(normalizeSignalKind(point.kind, point.value), point.value), normalizeSignalKind(point.kind, point.value)),
            time: Number.isFinite(Date.parse(point.ts)) ? formatDateTime(point.ts) : unknown,
            subtitle: t('dashboardWidgets.driving.signalExplorer.historyProvenance', 'Origin: {{origin}} · Emitted: {{emitted}} · Received: {{received}}', {
              origin: point.ingest_origin ?? unknown,
              emitted: point.source_emitted_at ? formatDateTime(point.source_emitted_at) : unknown,
              received: point.received_at ? formatDateTime(point.received_at) : unknown,
            }),
          }))} />
        </div>}
        {plot.length < historyRows.length && numeric && !enumHistory && <Caption role="status">
          {t('dashboardWidgets.driving.signalExplorer.invalidTimes', '{{count}} samples have invalid timestamps and cannot be plotted.', { count: historyRows.length - plot.length })}
        </Caption>}
        <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.samples', '{{count}} recorded samples returned. Server limits may truncate the selected range.', { count: history.length })}</Caption>
        <Caption>{t('dashboardWidgets.driving.signalExplorer.historyNote', 'Recorded changes only; gaps are not zero, and history does not prove a live observation.')}</Caption>
      </SourceContent>
    </section>
  );
  const details = (
    <section aria-label={evidenceLabel} className="min-w-0 space-y-3">
      <PanelTitle>{evidenceLabel}</PanelTitle>
      <SourceContent state={sourceState(coverageState, routes.size > 0)} label={evidenceLabel}
        error={coverageState.fatalError} errorRecovery={{ onRetry: () => { void coverageQuery.refetch(); } }}
        errorMessage={t('dashboardWidgets.driving.signalExplorer.routingError', 'Routing evidence could not be loaded.')}
        emptyMessage={t('dashboardWidgets.driving.signalExplorer.routingEmpty', 'No routing evidence is available.')}>
        <Text variant="bodySm">{t('dashboardWidgets.driving.signalExplorer.destination', 'Routing destination: {{destination}}', { destination: route?.destination ?? unknown })}</Text>
        <Text variant="bodySm">{t('dashboardWidgets.driving.signalExplorer.desired', 'Desired subscription: {{desired}}', {
          desired: route ? route.subscribed ? t('common.yes', 'Yes') : t('common.no', 'No') : unknown,
        })}</Text>
        <Text variant="bodySm">{t('dashboardWidgets.driving.signalExplorer.valueKind', 'Value type: {{kind}}', { kind: enumHistory ? 'enum' : effectiveKind ?? unknown })}</Text>
      </SourceContent>
      <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.capabilityNote', 'Applied configuration and vehicle support: unknown. Definitions, desired subscriptions and routes are not capability evidence.')}</Caption>
      <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.unitNote', 'Known units follow display preferences. Fields without verified physical-unit normalization retain the raw reported value; no unit is inferred from a proto name.')}</Caption>
    </section>
  );

  return (
    <WidgetShell title={t('dashboardWidgets.driving.signalExplorer.title', 'Universal signal explorer')} icon={<Radio />}
      actions={<Button variant="ghost" size="sm" disabled={busy} onClick={refresh}
        aria-label={t('dashboardWidgets.driving.signalExplorer.refresh', 'Refresh signal evidence')}>
        <RefreshCw aria-hidden="true" className="size-4" />
      </Button>}>
      <div className="h-full min-h-0 overflow-y-auto" aria-busy={busy}>
        <InstrumentPresentation family="list" compact={compact} icon={<Radio aria-hidden="true" />}
          headline={<div className="min-w-0"><Text variant="body" weight="semibold">{field?.name ?? t('dashboardWidgets.driving.signalExplorer.explore', 'Explore signals')}</Text>
            <Caption className="block">{t('dashboardWidgets.driving.signalExplorer.chooseNote', 'Choose a field; inspect observed evidence, not assumed support.')}</Caption></div>}
          context={controls} instrument={<div className="min-w-0 space-y-5">{observations}{historySection}</div>} details={details}>
          <div className="min-w-0 space-y-5">{controls}{observations}{historySection}{details}</div>
        </InstrumentPresentation>
      </div>
    </WidgetShell>
  );
}
