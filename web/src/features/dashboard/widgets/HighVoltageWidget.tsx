import { useTranslation } from 'react-i18next';
import { Battery, RefreshCw } from 'lucide-react';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTicker } from '@/hooks/useTicker';
import { KVList } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, Caption, Code, IconButton, Subhead, Text } from '@/components/ui';
import { normalizeSignalKind } from '@/lib/signalKind';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

const SIGNALS = ['PackVoltage', 'PackCurrent', 'IsolationResistance', 'Hvil', 'BMSState', 'DCDCEnable'] as const;
const ENUMS: Partial<Record<typeof SIGNALS[number], readonly string[]>> = {
  Hvil: ['OK', 'Fault'],
  BMSState: ['Standby', 'Drive', 'Support', 'Charge', 'FEIM', 'ClearFault', 'Fault', 'Weld', 'Test'],
};

function readEvidence(raw: unknown, name: typeof SIGNALS[number], now: number) {
  const entry = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const value = entry.value;
  const number = typeof value === 'number' ? knownNumber(value) : null;
  const kind = normalizeSignalKind(entry.kind);
  const values = ENUMS[name];
  const valid = values ? (kind === 'int' || kind === 'string') && typeof value === 'string' && values.includes(value)
    : name === 'DCDCEnable' ? kind === 'bool' && typeof value === 'boolean'
      : number != null && (kind === 'float' || (kind === 'int' && Number.isSafeInteger(number)))
        && (name === 'PackCurrent' || number >= 0);
  const timestamp = typeof entry.ts === 'string' ? entry.ts : typeof entry.timestamp === 'string' ? entry.timestamp : null;
  const parsed = timestamp != null ? Date.parse(timestamp) : Number.NaN;
  const at = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
  const age = typeof entry.age_ms === 'number' ? knownNumber(entry.age_ms) : null;
  const source = typeof entry.source === 'string' ? entry.source : null;
  const stale = at != null && (now - at >= 120_000 || source === 'stale' || (age != null && age >= 120_000));
  const fresh = valid && at != null && !stale && (source === 'l1' || source === 'l2')
    && (entry.age_ms == null || (age != null && age >= 0));
  return { name, value, number, valid, timestamp, at, source, stale, fresh };
}

export default function HighVoltageWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const selected = vehicleId ?? config?.vehicleId;
  const id = typeof selected === 'number' && Number.isSafeInteger(selected) && selected > 0 ? selected : undefined;
  // This existing typed reader preserves source/age evidence that useLiveSignals normalizes away.
  const query = useVehicleLiveSignals(id, { refetchInterval: 5_000 });
  useTicker(id != null);
  const pack = usePackPresentation();
  const compact = size.cols <= 1;
  const snapshot = query.data?.vehicle_id === id && id != null ? query.data : undefined;
  const rows = SIGNALS.map(name => readEvidence(snapshot?.signals?.[name], name, Date.now()));
  const observed = rows.some(row => row.valid && row.at != null);
  const state = useDataState({ ...query, data: snapshot }, {
    provenance: 'live', maxAgeMs: 120_000, partial: observed && rows.some(row => !row.fresh),
  });
  const retained = state.status === 'stale' || state.isRefreshBlocked;
  const stale = rows.some(row => row.stale) || retained;
  const classified = rows.some(row => row.valid && (row.fresh || row.stale));
  const latest = rows.reduce((at, row) => Math.max(at, row.valid && (row.fresh || row.stale) ? row.at ?? 0 : 0), 0);
  const refresh = () => { if (id) void query.refetch(); };
  const unknown = t('common.unknown', 'Unknown');
  const labels = [
    t('dashboardWidgets.battery.highVoltage.voltage', 'Pack voltage'),
    t('dashboardWidgets.battery.highVoltage.current', 'Pack current'),
    t('dashboardWidgets.battery.highVoltage.isolation', 'Isolation resistance'),
    t('dashboardWidgets.battery.highVoltage.interlock', 'HV interlock'),
    t('dashboardWidgets.battery.highVoltage.bms', 'BMS state'),
    t('dashboardWidgets.battery.highVoltage.dcdc', 'DC/DC enabled'),
  ];
  const units = ['V', 'A', 'Ω', '', '', ''];
  const display = (row: typeof rows[number], index: number) => !row.valid ? unknown
    : row.number != null ? `${fmtNumber(row.number)} ${units[index]}`
      : typeof row.value === 'boolean' ? row.value ? t('common.yes', 'Yes') : t('common.no', 'No')
        : String(row.value);
  const safetyNote = t('dashboardWidgets.battery.highVoltage.safetyNote', 'Reported telemetry is not an inspection, alarm, or proof of electrical safety.');
  const context = (
    <div className="min-w-0 space-y-2">
      {!id ? <EmptyState variant="informational"
        message={t('dashboardWidgets.battery.highVoltage.selectVehicle', 'Select a vehicle to inspect high-voltage telemetry.')} />
        : state.fatalError ? <QueryError compact error={state.fatalError} onRetry={refresh} />
          : query.isLoading ? <Skeleton className="h-8 w-full" />
            : !observed ? <EmptyState variant="informational"
              message={t('dashboardWidgets.battery.highVoltage.noEvidence', 'No valid timestamped high-voltage observations for this vehicle.')} /> : null}
      <Caption as="p">{safetyNote}</Caption>
    </div>
  );
  const headline = <WidgetBigNumber animated={false} label={labels[0]} unit="V"
    value={rows[0].valid && rows[0].at != null ? fmtNumber(rows[0].number) : null}
    subtitle={t('dashboardWidgets.battery.highVoltage.lastReported', 'Last reported; freshness is shown with each signal.')} />;
  const schematicLabel = t('dashboardWidgets.battery.highVoltage.schematic', 'High-voltage pack schematic');
  const schematic = (
    <figure className="min-w-0 space-y-2" aria-label={schematicLabel}>
      <Subhead>{t('dashboardWidgets.battery.highVoltage.pack', 'High-voltage pack')}</Subhead>
      <div role="img" aria-label={schematicLabel}
        className={cn('grid grid-cols-10 gap-1 border border-[var(--border-strong)] p-2', pack === 'v7' ? 'rounded-none' : 'rounded-lg')}>
        {/* Geometry only, never observations or a fill scale. */}
        {Array.from({ length: 10 }, (_, index) => <span key={index} aria-hidden="true"
          className={cn('h-8 border border-[var(--border-subtle)] bg-[var(--surface-2)]', pack === 'v7' ? 'rounded-none' : 'rounded-sm')} />)}
      </div>
      <Caption as="figcaption">{t('dashboardWidgets.battery.highVoltage.schematicNote', 'Schematic only — not cell readings or the vehicle’s module layout.')}</Caption>
    </figure>
  );
  const readingsLabel = t('dashboardWidgets.battery.highVoltage.readings', 'Reported signals & source evidence');
  const readings = (
    <section className="min-w-0 space-y-2" aria-label={readingsLabel}>
      <Subhead>{readingsLabel}</Subhead>
      <ul data-app-part="list" className={cn('grid min-w-0 gap-x-4 gap-y-3', !compact && 'grid-cols-1 @md:grid-cols-2')}>
        {rows.map((row, index) => (
          <li key={row.name} className="min-w-0 space-y-1 border-b border-[var(--border-subtle)] pb-2">
            <Caption as="p">{labels[index]}</Caption>
            {query.isLoading ? <Skeleton className="h-5 w-24" /> : <Text as="p" variant="body" className="tabular-nums">{display(row, index)}</Text>}
            <Code as="p" className="break-all">{row.name}</Code>
            <Badge size="sm" variant={row.stale || retained ? 'warning' : 'neutral'}>
              {!row.valid ? t('dashboardWidgets.battery.highVoltage.invalid', 'No valid reading')
                : retained ? t('dashboardWidgets.battery.highVoltage.retained', 'Retained observation')
                  : row.stale ? t('dashboardWidgets.battery.highVoltage.stale', 'Stale observation')
                    : row.fresh ? t('dashboardWidgets.battery.highVoltage.fresh', 'Fresh observation')
                      : t('dashboardWidgets.battery.highVoltage.freshnessUnknown', 'Freshness unknown')}
            </Badge>
            <Caption as="p">
              {row.at != null ? <time dateTime={row.timestamp ?? undefined}>{formatDateTime(new Date(row.at))}</time>
                : t('dashboardWidgets.battery.highVoltage.timeUnknown', 'Observation time unknown')}
            </Caption>
            <Caption as="p">{t('dashboardWidgets.battery.highVoltage.source', 'Source: {{source}}', { source: row.source ?? unknown })}</Caption>
          </li>
        ))}
      </ul>
      <Caption as="p">{t('dashboardWidgets.battery.highVoltage.currentNote', 'Signed current is shown as reported; direction is not inferred.')}</Caption>
      <Caption as="p">{t('dashboardWidgets.battery.highVoltage.historyNote', 'Isolation resistance and HV interlock have no established signal-log history. This view shows live-source observations only.')}</Caption>
    </section>
  );
  const configurationLabel = t('dashboardWidgets.battery.highVoltage.configuration', 'Configuration & capability evidence');
  const configuration = (
    <section className="min-w-0 space-y-2" aria-label={configurationLabel}>
      <Subhead>{configurationLabel}</Subhead>
      <KVList wrap layout={compact ? 'stacked' : 'responsive'} items={[
        { id: 'desired', label: t('dashboardWidgets.battery.highVoltage.desired', 'Desired subscription'), value: unknown },
        { id: 'applied', label: t('dashboardWidgets.battery.highVoltage.applied', 'Applied to vehicle'), value: unknown },
        { id: 'support', label: t('dashboardWidgets.battery.highVoltage.support', 'Vehicle support'), value: unknown },
      ]} />
      <Caption as="p">{t('dashboardWidgets.battery.highVoltage.evidenceNote', 'Server intent and routing are not vehicle configuration, support, or delivery receipts. Missing readings do not prove a vehicle is unsupported.')}</Caption>
    </section>
  );
  const body = <InstrumentPresentation family="pack-map" compact={compact} icon={<Battery aria-hidden="true" />}
    headline={headline} context={context} instrument={<div className="min-w-0 space-y-4">{schematic}{readings}</div>}
    details={configuration}>
    <div className="min-w-0 space-y-4">{context}{headline}{schematic}{readings}{configuration}</div>
  </InstrumentPresentation>;
  return (
    <WidgetShell title={t('dashboardWidgets.battery.highVoltage.title', 'High-voltage overview')} icon={<Battery />}
      dataState={{ ...state, status: !id || (query.isSuccess && !snapshot) ? 'unavailable' : state.status, fatalError: null }}
      loadingContent={body} updatedAt={classified ? latest : undefined} isFetching={query.isFetching}
      isStale={stale || (classified && rows.some(row => !row.fresh))}
      isError={query.isError} onRefresh={id ? refresh : undefined} refreshIntervalMs={5_000}
      actions={<IconButton icon={<RefreshCw aria-hidden="true" />} className="min-h-11 min-w-11"
        label={t('dashboardWidgets.battery.highVoltage.refresh', 'Refresh high-voltage signals')}
        onClick={refresh} disabled={!id || query.isFetching} busy={query.isFetching} />}>
      {body}
    </WidgetShell>
  );
}
