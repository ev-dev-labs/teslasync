import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useTeslaExclusive } from '@/api/hooks/useTeslaPhysics';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { Grid, PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { ExclusiveReport } from '@/types/teslaPhysics';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export const TESLA_ONLY_FEATURES = [
  { slug: 'clocks', title: 'Three clocks' },
  { slug: 'life-tape', title: 'Life tape' },
  { slug: 'contradictions', title: 'Contradiction courtroom' },
  { slug: 'meters', title: 'Trip-meter genealogy' },
  { slug: 'unknown', title: 'Unknown OS' },
  { slug: 'car-kept-living', title: 'Car kept living' },
  { slug: 'logbook', title: 'Tesla-language logbook' },
  { slug: 'firmware-epochs', title: 'Firmware epochs' },
  { slug: 'charge-port', title: 'Charge-port courtroom' },
  { slug: 'black-box', title: 'Black box last 90s' },
  { slug: 'dictionary', title: 'Owner physics dictionary' },
  { slug: 'vault', title: 'Resale/service physics vault' },
  { slug: 'modes', title: 'Mode physics laws' },
  { slug: 'nervous-system', title: 'Homelab nervous system' },
  { slug: 'range', title: 'Range disagreement' },
] as const;

export type TeslaOnlySlug = (typeof TESLA_ONLY_FEATURES)[number]['slug'];

function unknownText(t: Translate) {
  return t('teslaOnly.unknown', 'unknown');
}

function secondsLabel(value: number | null | undefined, t: Translate) {
  if (value == null) return unknownText(t);
  return `${fmtNumber(value, 0)} s`;
}

export default function TeslaOnlyPage() {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const location = useLocation();
  const slug = location.pathname.replace(/^\/tesla-only\/?/, '');
  const feature = TESLA_ONLY_FEATURES.find((item) => item.slug === slug);
  usePageTitle(feature?.title ?? t('teslaOnly.title', 'TeslaSync only'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const query = useTeslaExclusive(vehicleIdStr);
  const state = useDataState(query, { provenance: 'live' });
  const report = state.data;
  const { formatDistance, formatEnergy } = useUnits();

  return (
    <PageContainer
      title={feature?.title ?? t('teslaOnly.title', 'TeslaSync only')}
      subtitle={report ? undefined : t('teslaOnly.subtitle', 'Physics Tesla app, TeslaMate, and Tessie cannot own.')}
      contextActions={<VehicleSelect />}
      query={query}
    >
      <StaleRefreshWarning state={state} />
      {!feature && (
        <div className="mb-4 flex flex-wrap gap-2">
          {TESLA_ONLY_FEATURES.map((item) => (
            <Link key={item.slug} to={`/tesla-only/${item.slug}`}>
              <Badge variant="neutral" size="sm">{item.title}</Badge>
            </Link>
          ))}
        </div>
      )}
      {feature && (
        <Text as="p" variant="caption" className="mb-4">
          <Link to="/tesla-only">{t('teslaOnly.hub', 'All TeslaSync-only physics')}</Link>
        </Text>
      )}
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : report ? (
        <div className="space-y-4">
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
        <Text as="p" variant="caption">{t('teslaOnly.empty', 'Select a vehicle to load TeslaSync-only physics.')}</Text>
      )}
    </PageContainer>
  );
}

function show(slug: string, want: TeslaOnlySlug) {
  return slug === '' || slug === want;
}

function Honesty({ text }: { text: string }) {
  return <Text as="p" variant="caption">{text}</Text>;
}

function ClocksPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const latest = report.clocks.latest;
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.clocks', 'Three clocks')}</PanelTitle>
      <Honesty text={report.clocks.honesty} />
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.eventTime', 'Event time')} value={latest ? formatDateTime(latest.event_time) : unknownText(t)} color="cyan" />
        <MetricCard label={t('teslaOnly.ingestTime', 'Ingest time')} value={latest?.ingest_time ? formatDateTime(latest.ingest_time) : unknownText(t)} color="amber" />
        <MetricCard label={t('teslaOnly.displayTime', 'Display time')} value={latest ? formatDateTime(latest.display_time) : unknownText(t)} color="purple" />
      </Grid>
    </GlassPanel>
  );
}

function LifeTapePanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.lifeTape', 'Life tape')}</PanelTitle>
      <Honesty text={report.life_tape.honesty} />
      <div className="flex flex-wrap gap-2">
        {report.life_tape.segments.length === 0 ? (
          <Badge variant="neutral" size="sm">{unknownText(t)}</Badge>
        ) : report.life_tape.segments.slice(-12).map((segment) => (
          <Badge key={`${segment.state}-${segment.started_at}`} variant={segment.state === 'unknown' ? 'warning' : 'info'} size="sm">
            {segment.state} · {fmtNumber(segment.duration_s / 60, 1)} min
          </Badge>
        ))}
      </div>
    </GlassPanel>
  );
}

function ContradictionPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.contradictions', 'Contradiction courtroom')}</PanelTitle>
      <Honesty text={report.contradictions.honesty} />
      {report.contradictions.findings.length === 0 ? (
        <Text as="p" variant="caption">{t('teslaOnly.noContradictions', 'No contradictions in the window. Complete still latched is expected.')}</Text>
      ) : report.contradictions.findings.map((finding) => (
        <Text as="p" key={`${finding.kind}-${finding.at}`} variant="caption">
          {formatDateTime(finding.at)} — {finding.detail}
        </Text>
      ))}
    </GlassPanel>
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
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.meters', 'Trip-meter genealogy')}</PanelTitle>
      <Honesty text={meters.honesty} />
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.odometer', 'Odometer')} value={meters.odometer_m == null ? unknownText(t) : formatDistance(meters.odometer_m, { precision: 1 })} color="cyan" />
        <MetricCard label={t('teslaOnly.drivingMeter', 'Driving trip meter')} value={meters.driving_distance_m == null ? unknownText(t) : formatDistance(meters.driving_distance_m, { precision: 1 })} color="green" />
        <MetricCard label={t('teslaOnly.fsdMeter', 'FSD trip meter')} value={meters.fsd_distance_m == null ? unknownText(t) : formatDistance(meters.fsd_distance_m, { precision: 1 })} color="purple" />
      </Grid>
      {meters.resets.map((reset) => (
        <Text as="p" key={`${reset.meter}-${reset.at}`} variant="caption">
          {reset.meter} {t('teslaOnly.reset', 'reset')} ({reset.cause}{reset.unknown ? `, ${unknownText(t)}` : ''}) {formatDateTime(reset.at)}
        </Text>
      ))}
    </GlassPanel>
  );
}

function UnknownPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.unknownOS', 'Unknown OS')}</PanelTitle>
      <Honesty text={report.unknown_os.honesty} />
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
    </GlassPanel>
  );
}

function CarKeptLivingPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const living = report.car_kept_living;
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.carKeptLiving', 'Car kept living')}</PanelTitle>
      <Honesty text={living.honesty} />
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
      {living.notes.map((note) => (
        <Text as="p" key={note} variant="caption">{note}</Text>
      ))}
    </GlassPanel>
  );
}

function LogbookPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.logbook', 'Tesla-language logbook')}</PanelTitle>
      <Honesty text={report.logbook.honesty} />
      {report.logbook.entries.length === 0 ? (
        <Text as="p" variant="caption">{unknownText(t)}</Text>
      ) : report.logbook.entries.slice(-20).map((entry) => (
        <Text as="p" key={`${entry.kind}-${entry.id}-${entry.word}-${entry.at}`} variant="caption">
          {entry.word} · {formatDateTime(entry.at)}
        </Text>
      ))}
    </GlassPanel>
  );
}

function EpochsPanel({
  report, t, formatDistance,
}: {
  report: ExclusiveReport;
  t: Translate;
  formatDistance: (meters: number, opts?: { precision?: number }) => string;
}) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.epochs', 'Firmware epochs of this VIN')}</PanelTitle>
      <Honesty text={report.firmware_epochs.honesty} />
      {report.firmware_epochs.epochs.map((epoch) => (
        <Text as="p" key={`${epoch.version}-${epoch.started_at}`} variant="caption">
          {epoch.version} · {epoch.fsd_meter_start_m == null || epoch.fsd_meter_end_m == null
            ? unknownText(t)
            : `${formatDistance(epoch.fsd_meter_start_m, { precision: 1 })} → ${formatDistance(epoch.fsd_meter_end_m, { precision: 1 })}`}
        </Text>
      ))}
    </GlassPanel>
  );
}

function PortPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.portCourt', 'Charge-port courtroom')}</PanelTitle>
      <Honesty text={report.charge_port_court.honesty} />
      {report.charge_port_court.evidence.slice(-8).map((row) => (
        <Text as="p" key={row.at} variant="caption">
          {formatDateTime(row.at)} · {row.charge_state || unknownText(t)} · {row.latch || unknownText(t)}
        </Text>
      ))}
    </GlassPanel>
  );
}

function BlackBoxPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.blackBox', 'Black box last 90s')}</PanelTitle>
      <Honesty text={report.black_box.honesty} />
      <Badge variant="info" size="sm">{report.black_box.trigger}</Badge>
      <Text as="p" variant="caption">
        {t('teslaOnly.frames', '{{count}} frames', { count: report.black_box.frames.length })}
      </Text>
    </GlassPanel>
  );
}

function DictionaryPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const dict = report.dictionary;
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.dictionary', 'Owner physics dictionary')}</PanelTitle>
      <Honesty text={dict.honesty} />
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.unplug', 'Complete → unplug')} value={secondsLabel(dict.typical_complete_unplug_s, t)} color="amber" />
        <MetricCard label={t('teslaOnly.parkDwell', 'Park confirm dwell')} value={secondsLabel(dict.park_confirm_dwell_s, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.unscheduled', 'Complete without schedule')} value={dict.complete_without_schedule == null ? unknownText(t) : String(dict.complete_without_schedule)} color="purple" />
      </Grid>
    </GlassPanel>
  );
}

function VaultPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const vault = report.vault;
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.vault', 'Resale/service physics vault')}</PanelTitle>
      <Honesty text={vault.honesty} />
      <Text as="p" variant="caption">{vault.certificate.integrity_sha256}</Text>
      <Text as="p" variant="caption">
        {t('teslaOnly.unknownHours', 'Unknown')}: {vault.unknown_hours == null ? unknownText(t) : `${fmtNumber(vault.unknown_hours, 1)} h`}
      </Text>
      <div className="flex flex-wrap gap-2">
        {vault.firmware_versions.map((version) => (
          <Badge key={version} variant="neutral" size="sm">{version}</Badge>
        ))}
      </div>
    </GlassPanel>
  );
}

function ModesPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  const modes = report.modes;
  const modeLabel = (value: boolean | null, on: string, off: string) => (
    value == null ? unknownText(t) : value ? on : off
  );
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.modes', 'Mode physics laws')}</PanelTitle>
      <Honesty text={modes.honesty} />
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">Valet: {modeLabel(modes.valet, 'on', 'off')}</Badge>
        <Badge variant="neutral" size="sm">Service: {modeLabel(modes.service, 'on', 'off')}</Badge>
        <Badge variant="neutral" size="sm">Transport: {modeLabel(modes.transport, 'on', 'off')}</Badge>
      </div>
      {modes.forbidden.map((rule) => (
        <Text as="p" key={rule} variant="caption">{rule}</Text>
      ))}
    </GlassPanel>
  );
}

function NervousPanel({ report, t }: { report: ExclusiveReport; t: Translate }) {
  return (
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.nervous', 'Homelab nervous system')}</PanelTitle>
      <Honesty text={report.nervous_system.honesty} />
      <div className="flex flex-wrap gap-2">
        {report.nervous_system.nerves.map((nerve) => (
          <Badge
            key={nerve.field}
            variant={nerve.status === 'contradicting' ? 'warning' : nerve.status === 'alive' ? 'success' : 'neutral'}
            size="sm"
          >
            {nerve.field}: {nerve.status}
          </Badge>
        ))}
      </div>
    </GlassPanel>
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
    <GlassPanel className="space-y-2 p-4 sm:p-5">
      <PanelTitle>{t('teslaOnly.range', 'Range disagreement')}</PanelTitle>
      <Honesty text={range.honesty} />
      <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={3}>
        <MetricCard label={t('teslaOnly.rated', 'Rated')} value={dist(range.rated_range_m)} color="cyan" />
        <MetricCard label={t('teslaOnly.typical', 'Typical')} value={dist(range.est_range_m)} color="green" />
        <MetricCard label={t('teslaOnly.ideal', 'Ideal')} value={dist(range.ideal_range_m)} color="purple" />
        <MetricCard label={t('teslaOnly.energy', 'Energy remaining')} value={range.energy_remaining_wh == null ? unknownText(t) : formatEnergy(range.energy_remaining_wh)} color="amber" />
      </Grid>
      <Text as="p" variant="caption">
        {t('teslaOnly.noTrueRange', 'No true range. Recent Wh/km: {{value}}', {
          value: range.recent_wh_per_km == null ? unknownText(t) : fmtNumber(range.recent_wh_per_km, 0),
        })}
      </Text>
      {range.true_range_m != null ? (
        <Text as="p" variant="caption">{t('teslaOnly.trueRangeBug', 'true_range must stay empty')}</Text>
      ) : null}
    </GlassPanel>
  );
}
