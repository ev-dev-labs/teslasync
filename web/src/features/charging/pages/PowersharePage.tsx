import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, RefreshCw } from 'lucide-react';

import { Grid, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui';
import { StatStrip, type StatMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, StaleRefreshWarning } from '@/components/feedback';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { latestNumeric, latestText } from '@/lib/signalObservation';
import { useSignalObservations } from '@/api/hooks/useTelemetry';

import {
  POWERSHARE_SIGNALS, SERIES_LIMIT, buildSeries, humanizeEnum, seriesPeak,
  type SnapshotRow,
} from '../components/powershare';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { TrendCard } from '../components/powershare-modernization/TrendCard';
import { RuntimeCard } from '../components/powershare-modernization/RuntimeCard';
import { StopReasonCard } from '../components/powershare-modernization/StopReasonCard';
import { SnapshotCard } from '../components/powershare-modernization/SnapshotCard';

const outputColumns = { default: 1, xl: 3 };
const detailColumns = { default: 1, xl: 2 };

/**
 * Powershare — bidirectional power-sharing cockpit. Five cold signals
 * (PowershareStatus/Type/StopReason/HoursLeft/InstantaneousPowerKW) are read
 * from `/signals/observations` (router.go:4170); the numeric pair is pulled as
 * a short series to drive the trend charts. All display formatting happens at
 * this render boundary — the API returns raw values.
 */
export default function PowersharePage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('powershare.title', 'Powershare'));

  const { vehicleId: selectedId } = useSelectedVehicle();
  const vehicleId = selectedId ?? undefined;

  const statusQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.status, limit: 1 });
  const typeQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.type, limit: 1 });
  const stopQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.stopReason, limit: 1 });
  const hoursQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.hoursLeft, limit: SERIES_LIMIT });
  const powerQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.power, limit: SERIES_LIMIT });
  const statusState = useDataState(statusQ, { provenance: 'historical' });
  const typeState = useDataState(typeQ, { provenance: 'historical' });
  const stopState = useDataState(stopQ, { provenance: 'historical' });
  const hoursState = useDataState(hoursQ, { provenance: 'historical' });
  const powerState = useDataState(powerQ, { provenance: 'historical' });
  const runtimeState = combineDataStates([statusState, typeState, powerState, hoursState]);
  const snapshotState = combineDataStates([statusState, typeState, stopState, powerState, hoursState]);

  const status = latestText(safeArray(statusState.data));
  const shareType = latestText(safeArray(typeState.data));
  const stopReason = latestText(safeArray(stopState.data));
  const hoursLeft = knownNumber(latestNumeric(safeArray(hoursState.data)));
  const powerKw = knownNumber(latestNumeric(safeArray(powerState.data)));

  const powerSeries = useMemo(() => buildSeries(safeArray(powerQ.data)), [powerQ.data]);
  const hoursSeries = useMemo(() => buildSeries(safeArray(hoursQ.data)), [hoursQ.data]);
  const powerPeak = seriesPeak(powerSeries);
  const hoursPeak = seriesPeak(hoursSeries);

  const refetchAll = () => {
    statusQ.refetch();
    typeQ.refetch();
    stopQ.refetch();
    hoursQ.refetch();
    powerQ.refetch();
  };

  const snapshotRows = useMemo<SnapshotRow[]>(
    () => [
      { key: 'status', label: t('powershare.kpi.status', 'Status'),
        value: humanizeEnum(status, POWERSHARE_SIGNALS.status) ?? '—',
        ts: statusQ.data?.[0]?.ts ?? null },
      { key: 'type', label: t('powershare.kpi.type', 'Type'),
        value: humanizeEnum(shareType, POWERSHARE_SIGNALS.type) ?? '—',
        ts: typeQ.data?.[0]?.ts ?? null },
      { key: 'power', label: t('powershare.kpi.outputPower', 'Output Power'),
        value: powerKw != null ? `${fmtNumber(powerKw)} kW` : '—',
        ts: powerQ.data?.[0]?.ts ?? null },
      { key: 'hours', label: t('powershare.kpi.hoursRemaining', 'Hours Remaining'),
        value: hoursLeft != null ? `${fmtNumber(hoursLeft)} h` : '—',
        ts: hoursQ.data?.[0]?.ts ?? null },
      { key: 'stop', label: t('powershare.stopReason.title', 'Stop Reason'),
        value: humanizeEnum(stopReason, POWERSHARE_SIGNALS.stopReason) ?? '—',
        ts: stopQ.data?.[0]?.ts ?? null },
    ],
    [t, status, shareType, powerKw, hoursLeft, stopReason,
      statusQ.data, typeQ.data, powerQ.data, hoursQ.data, stopQ.data, fmtNumber],
  );

  const snapshotLoading = [statusState, typeState, stopState, hoursState, powerState].every((state) => !state.hasData)
    && [statusQ, typeQ, stopQ, hoursQ, powerQ].some((q) => q.isLoading);
  const runtimeLoading = [statusState, typeState, hoursState, powerState].every((state) => !state.hasData)
    && [statusQ, typeQ, hoursQ, powerQ].some((q) => q.isLoading);
  const metrics: StatMetric[] = [
    {
      metricId: 'status', occurrenceId: 'status',
      label: t('powershare.kpi.status', 'Status'),
      rawValue: humanizeEnum(status, POWERSHARE_SIGNALS.status),
      description: t('powershare.kpi.statusSub', 'Current sharing state'),
      context: t('powershare.kpi.statusSub', 'Current sharing state'),
    },
    {
      metricId: 'text', occurrenceId: 'type',
      label: t('powershare.kpi.type', 'Type'),
      rawValue: humanizeEnum(shareType, POWERSHARE_SIGNALS.type),
      description: t('powershare.kpi.typeSub', 'Powershare destination'),
      context: t('powershare.kpi.typeSub', 'Powershare destination'),
    },
    {
      metricId: 'text', occurrenceId: 'output-power',
      label: t('powershare.kpi.outputPower', 'Output Power'),
      rawValue: powerKw != null ? `${fmtNumber(powerKw)} kW` : null,
      description: t('powershare.kpi.outputPowerSub', 'Instantaneous power draw'),
      context: t('powershare.kpi.outputPowerSub', 'Instantaneous power draw'),
    },
    {
      metricId: 'text', occurrenceId: 'hours-remaining',
      label: t('powershare.kpi.hoursRemaining', 'Hours Remaining'),
      rawValue: hoursLeft != null ? `${fmtNumber(hoursLeft)} h` : null,
      description: t('powershare.kpi.hoursRemainingSub', 'Runtime at current output'),
      context: t('powershare.kpi.hoursRemainingSub', 'Runtime at current output'),
    },
  ];
  const recordedTimes = snapshotRows
    .map(row => row.ts == null ? Number.NaN : Date.parse(row.ts))
    .filter(Number.isFinite);
  const oldestRecordedAt = recordedTimes.length ? new Date(Math.min(...recordedTimes)).toISOString() : null;

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        onClick={refetchAll}
        aria-label={t('powershare.refresh', 'Refresh Powershare data')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  const title = t('powershare.title', 'Powershare');
  const subtitle = t(
    'powershare.subtitle',
    'Monitor your vehicle’s bidirectional power sharing — status, output, remaining runtime, and stop conditions.',
  );

  if (vehicleId == null) {
    return (
      <PageLayout title={title} subtitle={subtitle}>
        <EmptyState /* no-action: page precondition — no vehicle in scope yet */
          icon={<Zap className="h-8 w-8" />}
          message={t('powershare.noVehicle', 'Select a vehicle to view its Powershare telemetry.')}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={title}
      subtitle={subtitle}
      secondaryActions={actions}
      query={[statusQ, typeQ, stopQ, hoursQ, powerQ]}
      dataSources={snapshotState.status === 'partial' ? [
        { id: 'status', label: t('powershare.kpi.status', 'Status'), query: statusQ },
        { id: 'type', label: t('powershare.kpi.type', 'Type'), query: typeQ },
        { id: 'stop', label: t('powershare.stopReason.title', 'Stop Reason'), query: stopQ },
        { id: 'power', label: t('powershare.kpi.outputPower', 'Output Power'), query: powerQ },
        { id: 'hours', label: t('powershare.kpi.hoursRemaining', 'Hours Remaining'), query: hoursQ },
      ] : undefined}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('powershare.kpi.sectionLabel', 'Powershare metrics')}
        >
          <StatStrip
            id="powershare-metrics"
            metrics={metrics}
            retained={snapshotState.status === 'stale'}
            period={{
              kind: 'snapshot',
              label: t('powershare.snapshot.subtitle', 'Latest raw Powershare telemetry'),
              observedAt: oldestRecordedAt,
              provenance: t('powershare.modernization.observationContext', 'Latest recorded observations; the trends show up to 48 recent readings per signal, not a complete time range.'),
            }}
          />
        </section>
      </FadeIn>

      {/* 2 — Hero output-power trend + live-session side panel */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('powershare.output.sectionLabel', 'Powershare output and live session')}
        >
          <Grid cols={outputColumns}>
          <div className="min-w-0 xl:col-span-2">
          <StaleRefreshWarning state={powerState} />
          <TrendCard
            kind="power"
            points={powerSeries}
            isLoading={powerQ.isLoading && !powerState.hasData}
            error={powerState.fatalError}
            onRetry={() => powerQ.refetch()}
          />
          </div>
          <div className="min-w-0">
          <RuntimeCard
            status={status}
            shareType={shareType}
            powerKw={powerKw}
            hoursLeft={hoursLeft}
            powerPeak={powerPeak}
            hoursPeak={hoursPeak}
            isLoading={runtimeLoading}
            error={runtimeState.fatalError}
            onRetry={refetchAll}
          />
          </div>
          </Grid>
        </section>
      </FadeIn>

      {/* 3 — Runtime trend + stop reason */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('powershare.detail.sectionLabel', 'Powershare runtime trend and stop reason')}
        >
          <Grid cols={detailColumns}>
          <div className="min-w-0">
          <StaleRefreshWarning state={hoursState} />
          <TrendCard
            kind="hours"
            points={hoursSeries}
            isLoading={hoursQ.isLoading && !hoursState.hasData}
            error={hoursState.fatalError}
            onRetry={() => hoursQ.refetch()}
          />
          </div>
          <div className="min-w-0">
          <StaleRefreshWarning state={stopState} />
          <StopReasonCard
            reason={stopReason}
            isLoading={stopQ.isLoading && !stopState.hasData}
            error={stopState.fatalError}
            onRetry={() => stopQ.refetch()}
          />
          </div>
          </Grid>
        </section>
      </FadeIn>

      {/* 4 — Raw signal snapshot */}
      <FadeIn delay={0.3}>
        <StaleRefreshWarning state={statusState} />
        <StaleRefreshWarning state={typeState} />
        <SnapshotCard
          rows={snapshotRows}
          isLoading={snapshotLoading}
          error={snapshotState.fatalError}
          onRetry={refetchAll}
        />
      </FadeIn>
    </PageLayout>
  );
}
