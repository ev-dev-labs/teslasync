import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useTeslaExclusive } from '@/api/hooks/useTeslaPhysics';
import { DataProvenanceBadge, MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  SectionTitle,
  Text,
  type Column,
} from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dateFormat';
import { Icons } from '@/lib/icons';
import { fmtNumber } from '@/lib/numberFormat';
import type { ExclusiveReport } from '@/types/teslaPhysics';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export const TESLA_ONLY_FEATURES = [
  { slug: 'clocks', title: 'Three Clocks', icon: Icons.clock, color: 'text-cyan-400', description: 'Event, ingest, and display time. Ingest stays unknown if not stored.' },
  { slug: 'life-tape', title: 'Life Tape', icon: Icons.activity, color: 'text-violet-400', description: 'Every second is Park, Neutral, Drive, Charge, or Unknown — not GPS.' },
  { slug: 'contradictions', title: 'Contradiction Court', icon: Icons.fingerprint, color: 'text-amber-400', description: 'Gear=P with speed is a contradiction. Complete still latched is not.' },
  { slug: 'meters', title: 'Trip-Meter Genealogy', icon: Icons.timer, color: 'text-purple-400', description: 'Odometer and FSD trip meters. A drop is a reset. Null is not zero.' },
  { slug: 'unknown', title: 'Unknown OS', icon: Icons.sparkles, color: 'text-amber-400', description: 'Unknown hours are a budget, never a measured zero of missing physics.' },
  { slug: 'car-kept-living', title: 'Car Kept Living', icon: Icons.heart, color: 'text-rose-400', description: 'After MQTT or carbon loss: queued, replayed event time, never-received.' },
  { slug: 'logbook', title: 'Tesla-Language Logbook', icon: Icons.history, color: 'text-indigo-400', description: 'Park, Drive, Neutral, Charging, Complete, Disconnected — Tesla words.' },
  { slug: 'firmware-epochs', title: 'Firmware Epochs', icon: Icons.cpu, color: 'text-cyan-400', description: 'Each software version as this VIN physics baseline, not fleet proof.' },
  { slug: 'charge-port', title: 'Charge-Port Court', icon: Icons.bolt, color: 'text-amber-400', description: 'Latch, door, pack current, and ChargeState as one evidence chain.' },
  { slug: 'black-box', title: 'Black Box 90s', icon: Icons.archive, color: 'text-indigo-400', description: 'High-resolution samples in the 90s before Park, unplug, or a gap.' },
  { slug: 'dictionary', title: 'Owner Dictionary', icon: Icons.network, color: 'text-teal-400', description: 'This car Complete-to-unplug, Park dwell, and unscheduled Complete.' },
  { slug: 'vault', title: 'Physics Vault', icon: Icons.archive, color: 'text-emerald-400', description: 'Hashed session boundaries, unknown hours, firmware, etiquette dwells.' },
  { slug: 'modes', title: 'Mode Laws', icon: Icons.radar, color: 'text-orange-400', description: 'Valet, Service, Transport laws. Unknown mode stays unknown.' },
  { slug: 'nervous-system', title: 'Nervous System', icon: Icons.activity, color: 'text-cyan-400', description: 'BMS, Gear, latch, and trip meters: alive, silent, or contradicting.' },
  { slug: 'range', title: 'Range Disagreement', icon: Icons.bolt, color: 'text-lime-400', description: 'Rated, typical, ideal, and energy remaining. Never a true range.' },
] as const;

export type TeslaOnlySlug = (typeof TESLA_ONLY_FEATURES)[number]['slug'];

const LIFE_TAPE_TONES: Record<string, string> = {
  confirmed_park: 'bg-emerald-400',
  park: 'bg-emerald-400',
  drive: 'bg-cyan-400',
  reverse: 'bg-violet-400',
  neutral_rolling: 'bg-amber-400',
  charging: 'bg-lime-400',
  complete_still_plugged: 'bg-teal-400',
  plugged_not_charging: 'bg-sky-400',
  unplugged: 'bg-zinc-400',
  unknown: 'bg-amber-500/70',
};

function unknownText(t: Translate) {
  return t('teslaOnly.unknown', 'unknown');
}

function secondsLabel(value: number | null | undefined, t: Translate) {
  if (value == null) return unknownText(t);
  return `${fmtNumber(value, 0)} s`;
}

function show(slug: string, want: TeslaOnlySlug) {
  return slug === want;
}

export default function TeslaOnlyPage() {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const location = useLocation();
  const slug = location.pathname.replace(/^\/tesla-only\/?/, '');
  const feature = TESLA_ONLY_FEATURES.find((item) => item.slug === slug);
  const title = feature?.title ?? t('teslaOnly.title', 'Tesla Physics');
  usePageTitle(title);
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const query = useTeslaExclusive(vehicleIdStr);
  const state = useDataState(query, { provenance: 'historical' });
  const report = state.data;
  const { formatDistance, formatEnergy } = useUnits();

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={title} />;
  }

  return (
    <PageContainer
      title={title}
      subtitle={feature?.description ?? t('teslaOnly.subtitle', 'Gear, charge, park, and meters as Tesla language.')}
      copyLink
      contextActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge
            provenance={state.provenance}
            status={state.status}
            updatedAt={state.updatedAt}
          />
          <VehicleSelect />
        </div>
      )}
      query={query}
    >
      <StaleRefreshWarning state={state} label={title} />
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : report ? (
        <div className="space-y-6">
          {feature ? (
            <Text as="p" size="sm" color="secondary">
              <Link
                to="/tesla-only"
                className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
              >
                {t('teslaOnly.hub', 'All Tesla physics')}
              </Link>
            </Text>
          ) : (
            <HubOverview report={report} t={t} />
          )}
          {show(slug, 'clocks') && <ClocksPanel report={report} t={t} />}
          {show(slug, 'life-tape') && <LifeTapePanel report={report} t={t} />}
          {show(slug, 'contradictions') && <ContradictionPanel report={report} t={t} />}
          {show(slug, 'meters') && <MetersPanel report={report} t={t} formatDistance={formatDistance} />}
          {show(slug, 'unknown') && <UnknownPanel report={report} t={t} />}
          {show(slug, 'car-kept-living') && <CarKeptLivingPanel report={report} t={t} />}
          {show(slug, 'logbook') && <LogbookPanel report={report} t={t} />}
          {show(slug, 'firmware-epochs') && <EpochsPanel report={report} t={t} formatDistance={formatDistance} />}
          {show(slug, 'charge-port') && <PortPanel report={report} t={t} />}
          {show(slug, 'black-box') && <BlackBoxPanel report={report} t={t} />}
          {show(slug, 'dictionary') && <DictionaryPanel report={report} t={t} />}
          {show(slug, 'vault') && <VaultPanel report={report} t={t} />}
          {show(slug, 'modes') && <ModesPanel report={report} t={t} />}
          {show(slug, 'nervous-system') && <NervousPanel report={report} t={t} />}
          {show(slug, 'range') && <RangePanel report={report} t={t} formatDistance={formatDistance} formatEnergy={formatEnergy} />}
        </div>
      ) : (
        {/* no-action: exclusive physics has not arrived yet; VehicleSelect is already in the header */}
        <EmptyState
          title={title}
          message={t('teslaOnly.empty', 'Select a vehicle to load Tesla physics.')}
        />
      )}
    </PageContainer>
  );
}

function PhysicsPanel({
  title,
  honesty,
  children,
}: {
  title: string;
  honesty: string;
  children: ReactNode;
}) {
  return (
    <FadeIn>
      <GlassPanel className="space-y-4 p-4 sm:p-5">
        <div>
          <PanelTitle>{title}</PanelTitle>
          <Text as="p" size="sm" color="secondary" className="mt-1.5 max-w-3xl leading-relaxed">
            {honesty}
          </Text>
        </div>
        {children}
      </GlassPanel>
    </FadeIn>
  );
}

function HubOverview({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const firmware = report.firmware_epochs.epochs[0]?.version;
  return (
    <FadeIn>
      <section aria-label={t('teslaOnly.kpis', 'Tesla physics summary')} className="space-y-6">
        <Grid cols={{ default: 2, xl: 4 }} gap={4}>
          <MetricCard
            label={t('teslaOnly.views', 'Physics views')}
            value={TESLA_ONLY_FEATURES.length}
            color="cyan"
          />
          <MetricCard
            label={t('teslaOnly.unknownHours', 'Unknown')}
            value={report.unknown_os.unknown_hours == null ? unknownText(t) : `${fmtNumber(report.unknown_os.unknown_hours, 1)} h`}
            color="amber"
          />
          <MetricCard
            label={t('teslaOnly.contradictionCount', 'Contradictions')}
            value={report.contradictions.findings.length}
            color="purple"
          />
          <MetricCard
            label={t('teslaOnly.firmware', 'Firmware')}
            value={firmware || unknownText(t)}
            color="green"
          />
        </Grid>
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <SectionTitle>{t('teslaOnly.hub', 'All Tesla physics')}</SectionTitle>
            <Badge variant="neutral" size="sm" className="tabular-nums">{TESLA_ONLY_FEATURES.length}</Badge>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
            {TESLA_ONLY_FEATURES.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.slug}>
                  <Link
                    to={`/tesla-only/${item.slug}`}
                    className={cn(
                      'group block h-full rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] p-4',
                      'hover:border-[var(--glass-border-strong,rgba(255,255,255,0.18))] hover:bg-[var(--surface-2)]',
                      'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
                      'transition-colors',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          'border border-[var(--glass-border)] bg-white/[0.04]',
                          item.color,
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Text as="div" size="sm" weight="medium" color="primary">{item.title}</Text>
                        <Text as="p" variant="bodySm" className="mt-1 line-clamp-2 leading-relaxed">
                          {item.description}
                        </Text>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </FadeIn>
  );
}

function ClocksPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const latest = report.clocks.latest;
  const columns: Column<NonNullable<ExclusiveReport['clocks']['samples']>[number]> = [
    { key: 'event', header: t('teslaOnly.eventTime', 'Event time'), render: (row) => formatDateTime(row.event_time) },
    { key: 'ingest', header: t('teslaOnly.ingestTime', 'Ingest time'), render: (row) => (row.ingest_time ? formatDateTime(row.ingest_time) : unknownText(t)) },
    { key: 'display', header: t('teslaOnly.displayTime', 'Display time'), render: (row) => formatDateTime(row.display_time) },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.clocks', 'Three Clocks')} honesty={report.clocks.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.eventTime', 'Event time')} value={latest ? formatDateTime(latest.event_time) : unknownText(t)} color="cyan" />
        <MetricCard label={t('teslaOnly.ingestTime', 'Ingest time')} value={latest?.ingest_time ? formatDateTime(latest.ingest_time) : unknownText(t)} color="amber" />
        <MetricCard label={t('teslaOnly.displayTime', 'Display time')} value={latest ? formatDateTime(latest.display_time) : unknownText(t)} color="purple" />
      </Grid>
      {report.clocks.samples.length > 0 && (
        <DataTable
          tableId="physics:clocks"
          columns={columns}
          data={report.clocks.samples}
          keyExtractor={(row) => row.event_time}
          emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
        />
      )}
    </PhysicsPanel>
  );
}

function LifeTapePanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const segments = report.life_tape.segments;
  const columns: Column<(typeof segments)[number]> = [
    { key: 'state', header: t('teslaOnly.state', 'State'), render: (row) => row.state },
    { key: 'duration', header: t('teslaOnly.duration', 'Duration'), render: (row) => `${fmtNumber(row.duration_s / 60, 1)} min`, align: 'right' },
    { key: 'started', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.started_at) },
    { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (row) => formatDateTime(row.ended_at) },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.lifeTape', 'Life Tape')} honesty={report.life_tape.honesty}>
      {segments.length === 0 ? (
        <Text as="p" size="sm" color="secondary">{unknownText(t)}</Text>
      ) : (
        <>
          <div
            className="flex h-3 overflow-hidden rounded-pill border border-[var(--border-default)] bg-[var(--surface-2)]"
            role="img"
            aria-label={t('teslaOnly.lifeTape', 'Life Tape')}
          >
            {segments.map((segment) => (
              <div
                key={`${segment.state}-${segment.started_at}`}
                className={cn('h-full min-w-px', LIFE_TAPE_TONES[segment.state] ?? 'bg-zinc-400')}
                style={{ flexGrow: Math.max(segment.duration_s, 1), flexBasis: 0 }}
                title={`${segment.state} · ${fmtNumber(segment.duration_s / 60, 1)} min`}
              />
            ))}
          </div>
          <DataTable
            tableId="physics:life-tape"
            columns={columns}
            data={segments.slice(-24)}
            keyExtractor={(row) => `${row.state}-${row.started_at}`}
            emptyMessage={unknownText(t)}
          />
        </>
      )}
    </PhysicsPanel>
  );
}

function ContradictionPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const findings = report.contradictions.findings;
  const columns: Column<(typeof findings)[number]> = [
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.at) },
    { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (row) => row.kind },
    { key: 'detail', header: t('teslaOnly.detail', 'Detail'), render: (row) => row.detail },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.contradictions', 'Contradiction Court')} honesty={report.contradictions.honesty}>
      {findings.length === 0 ? (
        <Text as="p" size="sm" color="secondary">
          {t('teslaOnly.noContradictions', 'No contradictions in the window. Complete still latched is expected.')}
        </Text>
      ) : (
        <DataTable
          tableId="physics:contradictions"
          columns={columns}
          data={findings}
          keyExtractor={(row) => `${row.kind}-${row.at}`}
          emptyMessage={t('teslaOnly.noContradictions', 'No contradictions in the window. Complete still latched is expected.')}
        />
      )}
    </PhysicsPanel>
  );
}

function MetersPanel({
  report, t, formatDistance,
}: {
  report: ExclusiveReport;
  t: Translate;
  formatDistance: (meters: number, opts?: { precision?: number }) => string;
}) {
  const meters = report.meters;
  const columns: Column<(typeof meters.resets)[number]> = [
    { key: 'meter', header: t('teslaOnly.meter', 'Meter'), render: (row) => row.meter },
    { key: 'cause', header: t('teslaOnly.cause', 'Cause'), render: (row) => `${row.cause}${row.unknown ? `, ${unknownText(t)}` : ''}` },
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.at) },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.meters', 'Trip-Meter Genealogy')} honesty={meters.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.odometer', 'Odometer')} value={meters.odometer_m == null ? unknownText(t) : formatDistance(meters.odometer_m, { precision: 1 })} color="cyan" />
        <MetricCard label={t('teslaOnly.drivingMeter', 'Driving trip meter')} value={meters.driving_distance_m == null ? unknownText(t) : formatDistance(meters.driving_distance_m, { precision: 1 })} color="green" />
        <MetricCard label={t('teslaOnly.fsdMeter', 'FSD trip meter')} value={meters.fsd_distance_m == null ? unknownText(t) : formatDistance(meters.fsd_distance_m, { precision: 1 })} color="purple" />
      </Grid>
      {meters.resets.length > 0 && (
        <DataTable
          tableId="physics:meters"
          columns={columns}
          data={meters.resets}
          keyExtractor={(row) => `${row.meter}-${row.at}`}
          emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
        />
      )}
    </PhysicsPanel>
  );
}

function UnknownPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <PhysicsPanel title={t('teslaOnly.unknownOS', 'Unknown OS')} honesty={report.unknown_os.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.window', 'Window')} value={`${fmtNumber(report.unknown_os.window_hours, 1)} h`} color="cyan" />
        <MetricCard label={t('teslaOnly.sampled', 'Sampled')} value={report.unknown_os.sample_hours == null ? unknownText(t) : `${fmtNumber(report.unknown_os.sample_hours, 1)} h`} color="green" />
        <MetricCard label={t('teslaOnly.unknownHours', 'Unknown')} value={report.unknown_os.unknown_hours == null ? unknownText(t) : `${fmtNumber(report.unknown_os.unknown_hours, 1)} h`} color="amber" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        {report.unknown_os.budgets.map((budget) => (
          <Badge key={budget.kind} variant={budget.unknown ? 'warning' : 'success'} size="sm">
            {budget.kind}: {fmtNumber(budget.hours, 1)} h
          </Badge>
        ))}
      </div>
    </PhysicsPanel>
  );
}

function CarKeptLivingPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const living = report.car_kept_living;
  const columns: Column<{ note: string }> = [
    { key: 'note', header: t('teslaOnly.detail', 'Detail'), render: (row) => row.note },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.carKeptLiving', 'Car Kept Living')} honesty={living.honesty}>
      <div className="flex flex-wrap gap-2">
        <Badge variant={living.mqtt_connected == null ? 'neutral' : living.mqtt_connected ? 'success' : 'warning'} size="sm">
          {living.mqtt_connected == null
            ? t('teslaOnly.mqttUnknown', 'MQTT state unknown')
            : living.mqtt_connected
              ? t('teslaOnly.mqttUp', 'MQTT connected')
              : t('teslaOnly.mqttDown', 'MQTT not connected')}
        </Badge>
        <Badge variant="neutral" size="sm">
          {t('teslaOnly.queued', 'Queued')}: {living.queued_count == null ? unknownText(t) : living.queued_count}
        </Badge>
        {living.replay_preserves_event_time ? (
          <Badge variant="info" size="sm">{t('teslaOnly.replay', 'Replay keeps event time')}</Badge>
        ) : null}
      </div>
      {living.notes.length > 0 && (
        <DataTable
          tableId="physics:car-kept-living"
          columns={columns}
          data={living.notes.map((note) => ({ note }))}
          keyExtractor={(row) => row.note}
          emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
        />
      )}
    </PhysicsPanel>
  );
}

function LogbookPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const entries = report.logbook.entries;
  const columns: Column<(typeof entries)[number]> = [
    { key: 'word', header: t('teslaOnly.word', 'Word'), render: (row) => row.word },
    { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (row) => row.kind },
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.at) },
    { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (row) => (row.ended_at ? formatDateTime(row.ended_at) : unknownText(t)) },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.logbook', 'Tesla-Language Logbook')} honesty={report.logbook.honesty}>
      <DataTable
        tableId="physics:logbook"
        columns={columns}
        data={entries.slice(-40)}
        keyExtractor={(row) => `${row.kind}-${row.id}-${row.word}-${row.at}`}
        emptyMessage={unknownText(t)}
      />
    </PhysicsPanel>
  );
}

function EpochsPanel({
  report, t, formatDistance,
}: {
  report: ExclusiveReport;
  t: Translate;
  formatDistance: (meters: number, opts?: { precision?: number }) => string;
}) {
  const epochs = report.firmware_epochs.epochs;
  const columns: Column<(typeof epochs)[number]> = [
    { key: 'version', header: t('teslaOnly.version', 'Version'), render: (row) => row.version },
    {
      key: 'fsd',
      header: t('teslaOnly.fsdMeter', 'FSD trip meter'),
      render: (row) => (row.fsd_meter_start_m == null || row.fsd_meter_end_m == null
        ? unknownText(t)
        : `${formatDistance(row.fsd_meter_start_m, { precision: 1 })} → ${formatDistance(row.fsd_meter_end_m, { precision: 1 })}`),
    },
    { key: 'started', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.started_at) },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.epochs', 'Firmware Epochs')} honesty={report.firmware_epochs.honesty}>
      <DataTable
        tableId="physics:firmware-epochs"
        columns={columns}
        data={epochs}
        keyExtractor={(row) => `${row.version}-${row.started_at}`}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
      />
    </PhysicsPanel>
  );
}

function PortPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const evidence = report.charge_port_court.evidence;
  const columns: Column<(typeof evidence)[number]> = [
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.at) },
    { key: 'state', header: t('teslaOnly.chargeState', 'Charge state'), render: (row) => row.charge_state || unknownText(t) },
    { key: 'latch', header: t('teslaOnly.latch', 'Latch'), render: (row) => row.latch || unknownText(t) },
    {
      key: 'door',
      header: t('teslaOnly.door', 'Door'),
      render: (row) => (row.door_open == null ? unknownText(t) : row.door_open ? t('teslaOnly.open', 'Open') : t('teslaOnly.closed', 'Closed')),
    },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.portCourt', 'Charge-Port Court')} honesty={report.charge_port_court.honesty}>
      <DataTable
        tableId="physics:charge-port"
        columns={columns}
        data={evidence.slice(-24)}
        keyExtractor={(row) => row.at}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
      />
    </PhysicsPanel>
  );
}

function BlackBoxPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const box = report.black_box;
  const columns: Column<(typeof box.frames)[number]> = [
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (row) => formatDateTime(row.at) },
    { key: 'state', header: t('teslaOnly.chargeState', 'Charge state'), render: (row) => row.charge_state || unknownText(t) },
    { key: 'latch', header: t('teslaOnly.latch', 'Latch'), render: (row) => row.latch || unknownText(t) },
    {
      key: 'current',
      header: t('teslaOnly.packCurrent', 'Pack current'),
      render: (row) => (row.pack_current_a == null ? unknownText(t) : `${fmtNumber(row.pack_current_a, 1)} A`),
      align: 'right',
    },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.blackBox', 'Black Box 90s')} honesty={box.honesty}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="info" size="sm">{box.trigger}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.frames', '{{count}} frames', { count: box.frames.length })}</Badge>
      </div>
      <DataTable
        tableId="physics:black-box"
        columns={columns}
        data={box.frames}
        keyExtractor={(row) => row.at}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
      />
    </PhysicsPanel>
  );
}

function DictionaryPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const dict = report.dictionary;
  return (
    <PhysicsPanel title={t('teslaOnly.dictionary', 'Owner Dictionary')} honesty={dict.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.unplug', 'Complete → unplug')} value={secondsLabel(dict.typical_complete_unplug_s, t)} color="amber" />
        <MetricCard label={t('teslaOnly.parkDwell', 'Park confirm dwell')} value={secondsLabel(dict.park_confirm_dwell_s, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.unscheduled', 'Complete without schedule')} value={dict.complete_without_schedule == null ? unknownText(t) : String(dict.complete_without_schedule)} color="purple" />
      </Grid>
    </PhysicsPanel>
  );
}

function VaultPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const vault = report.vault;
  return (
    <PhysicsPanel title={t('teslaOnly.vault', 'Physics Vault')} honesty={vault.honesty}>
      <Grid cols={{ default: 1, md: 2 }} gap={3}>
        <MetricCard
          label={t('teslaOnly.unknownHours', 'Unknown')}
          value={vault.unknown_hours == null ? unknownText(t) : `${fmtNumber(vault.unknown_hours, 1)} h`}
          color="amber"
        />
        <MetricCard
          label={t('teslaOnly.integrity', 'Integrity')}
          value={vault.certificate.integrity_sha256}
          color="green"
        />
      </Grid>
      <div className="flex flex-wrap gap-2">
        {vault.firmware_versions.map((version) => (
          <Badge key={version} variant="neutral" size="sm">{version}</Badge>
        ))}
      </div>
    </PhysicsPanel>
  );
}

function ModesPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const modes = report.modes;
  const modeLabel = (value: boolean | null, on: string, off: string) => (
    value == null ? unknownText(t) : value ? on : off
  );
  const columns: Column<{ rule: string }> = [
    { key: 'rule', header: t('teslaOnly.laws', 'Mode laws'), render: (row) => row.rule },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.modes', 'Mode Laws')} honesty={modes.honesty}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">Valet: {modeLabel(modes.valet, 'on', 'off')}</Badge>
        <Badge variant="neutral" size="sm">Service: {modeLabel(modes.service, 'on', 'off')}</Badge>
        <Badge variant="neutral" size="sm">Transport: {modeLabel(modes.transport, 'on', 'off')}</Badge>
      </div>
      <DataTable
        tableId="physics:modes"
        columns={columns}
        data={modes.forbidden.map((rule) => ({ rule }))}
        keyExtractor={(row) => row.rule}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
      />
    </PhysicsPanel>
  );
}

function NervousPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const nerves = report.nervous_system.nerves;
  const columns: Column<(typeof nerves)[number]> = [
    { key: 'field', header: t('teslaOnly.field', 'Signal'), render: (row) => row.field },
    { key: 'status', header: t('teslaOnly.status', 'Status'), render: (row) => row.status },
    { key: 'detail', header: t('teslaOnly.detail', 'Detail'), render: (row) => row.detail },
  ];
  return (
    <PhysicsPanel title={t('teslaOnly.nervous', 'Nervous System')} honesty={report.nervous_system.honesty}>
      <div className="flex flex-wrap gap-2">
        {nerves.map((nerve) => (
          <Badge
            key={nerve.field}
            variant={nerve.status === 'contradicting' ? 'warning' : nerve.status === 'alive' ? 'success' : 'neutral'}
            size="sm"
          >
            {nerve.field}: {nerve.status}
          </Badge>
        ))}
      </div>
      <DataTable
        tableId="physics:nervous-system"
        columns={columns}
        data={nerves}
        keyExtractor={(row) => row.field}
        emptyMessage={t('teslaOnly.emptyList', 'Nothing in this window.')}
      />
    </PhysicsPanel>
  );
}

function RangePanel({
  report, t, formatDistance, formatEnergy,
}: {
  report: ExclusiveReport;
  t: Translate;
  formatDistance: (meters: number, opts?: { precision?: number }) => string;
  formatEnergy: (wh: number) => string;
}) {
  const range = report.range;
  const dist = (value: number | null) => (value == null ? unknownText(t) : formatDistance(value, { precision: 1 }));
  return (
    <PhysicsPanel title={t('teslaOnly.range', 'Range Disagreement')} honesty={range.honesty}>
      <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={3}>
        <MetricCard label={t('teslaOnly.rated', 'Rated')} value={dist(range.rated_range_m)} color="cyan" />
        <MetricCard label={t('teslaOnly.typical', 'Typical')} value={dist(range.est_range_m)} color="green" />
        <MetricCard label={t('teslaOnly.ideal', 'Ideal')} value={dist(range.ideal_range_m)} color="purple" />
        <MetricCard label={t('teslaOnly.energy', 'Energy remaining')} value={range.energy_remaining_wh == null ? unknownText(t) : formatEnergy(range.energy_remaining_wh)} color="amber" />
      </Grid>
      <Text as="p" size="sm" color="secondary">
        {t('teslaOnly.noTrueRange', 'No true range. Recent Wh/km: {{value}}', {
          value: range.recent_wh_per_km == null ? unknownText(t) : fmtNumber(range.recent_wh_per_km, 0),
        })}
      </Text>
      {range.true_range_m != null ? (
        <Text as="p" size="sm" color="secondary">{t('teslaOnly.trueRangeBug', 'true_range must stay empty')}</Text>
      ) : null}
    </PhysicsPanel>
  );
}
