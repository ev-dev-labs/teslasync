import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Home, Power, Clock, RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber } from '@/lib/numberFormat';
import { latestNumeric, latestText } from '@/lib/signalObservation';
import { useSignalObservations } from '@/api/hooks/useTelemetry';

import {
  PowerTrendPanel, RuntimePanel, HoursTrendPanel, StopReasonPanel, SignalSnapshotPanel,
  POWERSHARE_SIGNALS, SERIES_LIMIT, buildSeries, humanizeEnum, seriesPeak, statusNeon,
  type SnapshotRow,
} from '../components/powershare';

/**
 * Powershare — bidirectional power-sharing cockpit. Five cold signals
 * (PowershareStatus/Type/StopReason/HoursLeft/InstantaneousPowerKW) are read
 * from `/signals/observations` (router.go:4170); the numeric pair is pulled as
 * a short series to drive the trend charts. All display formatting happens at
 * this render boundary — the API returns raw values.
 */
export default function PowersharePage() {
  const { t } = useTranslation();
  usePageTitle(t('powershare.title', 'Powershare'));

  const { vehicleId: selectedId } = useSelectedVehicle();
  const vehicleId = selectedId ?? undefined;

  const statusQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.status, limit: 1 });
  const typeQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.type, limit: 1 });
  const stopQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.stopReason, limit: 1 });
  const hoursQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.hoursLeft, limit: SERIES_LIMIT });
  const powerQ = useSignalObservations(vehicleId, { signal_name: POWERSHARE_SIGNALS.power, limit: SERIES_LIMIT });

  const status = latestText(statusQ.data);
  const shareType = latestText(typeQ.data);
  const stopReason = latestText(stopQ.data);
  const hoursLeft = latestNumeric(hoursQ.data);
  const powerKw = latestNumeric(powerQ.data);

  const powerSeries = useMemo(() => buildSeries(powerQ.data), [powerQ.data]);
  const hoursSeries = useMemo(() => buildSeries(hoursQ.data), [hoursQ.data]);
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
        value: powerKw != null ? `${fmtNumber(powerKw, 2)} kW` : '—',
        ts: powerQ.data?.[0]?.ts ?? null },
      { key: 'hours', label: t('powershare.kpi.hoursRemaining', 'Hours Remaining'),
        value: hoursLeft != null ? `${fmtNumber(hoursLeft, 1)} h` : '—',
        ts: hoursQ.data?.[0]?.ts ?? null },
      { key: 'stop', label: t('powershare.stopReason.title', 'Stop Reason'),
        value: humanizeEnum(stopReason, POWERSHARE_SIGNALS.stopReason) ?? '—',
        ts: stopQ.data?.[0]?.ts ?? null },
    ],
    [t, status, shareType, powerKw, hoursLeft, stopReason,
      statusQ.data, typeQ.data, powerQ.data, hoursQ.data, stopQ.data],
  );

  const snapshotLoading = [statusQ, typeQ, stopQ, hoursQ, powerQ].every((q) => q.isLoading);
  const snapshotError = [statusQ, typeQ, stopQ, hoursQ, powerQ].map((q) => q.error).find(Boolean);
  const runtimeError = statusQ.error ?? typeQ.error ?? powerQ.error ?? hoursQ.error;
  const runtimeLoading = statusQ.isLoading || typeQ.isLoading || powerQ.isLoading || hoursQ.isLoading;

  const actions = (
    <div className="flex items-center gap-2">
      <VehicleSelect />
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
      <PageContainer title={title} subtitle={subtitle} actions={<VehicleSelect />}>
        <EmptyState /* no-action: page precondition — no vehicle in scope yet */
          icon={<Zap className="h-8 w-8" />}
          message={t('powershare.noVehicle', 'Select a vehicle to view its Powershare telemetry.')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={title}
      subtitle={subtitle}
      actions={actions}
      query={[statusQ, typeQ, stopQ, hoursQ, powerQ]}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('powershare.kpi.sectionLabel', 'Powershare metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('powershare.kpi.status', 'Status')}
            value={humanizeEnum(status, POWERSHARE_SIGNALS.status) ?? '—'}
            icon={<Zap className="h-5 w-5" />}
            color={statusNeon(status)}
            subtitle={t('powershare.kpi.statusSub', 'Current sharing state')}
          />
          <MetricCard
            label={t('powershare.kpi.type', 'Type')}
            value={humanizeEnum(shareType, POWERSHARE_SIGNALS.type) ?? '—'}
            icon={<Home className="h-5 w-5" />}
            color="blue"
            subtitle={t('powershare.kpi.typeSub', 'Powershare destination')}
          />
          <MetricCard
            label={t('powershare.kpi.outputPower', 'Output Power')}
            value={powerKw != null ? `${fmtNumber(powerKw, 2)} kW` : '—'}
            icon={<Power className="h-5 w-5" />}
            color="amber"
            subtitle={t('powershare.kpi.outputPowerSub', 'Instantaneous power draw')}
          />
          <MetricCard
            label={t('powershare.kpi.hoursRemaining', 'Hours Remaining')}
            value={hoursLeft != null ? `${fmtNumber(hoursLeft, 1)} h` : '—'}
            icon={<Clock className="h-5 w-5" />}
            color="cyan"
            subtitle={t('powershare.kpi.hoursRemainingSub', 'Runtime at current output')}
          />
        </section>
      </FadeIn>

      {/* 2 — Hero output-power trend + live-session side panel */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('powershare.output.sectionLabel', 'Powershare output and live session')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <PowerTrendPanel
            points={powerSeries}
            isLoading={powerQ.isLoading}
            error={powerQ.error}
            onRetry={() => powerQ.refetch()}
          />
          <RuntimePanel
            status={status}
            shareType={shareType}
            powerKw={powerKw}
            hoursLeft={hoursLeft}
            powerPeak={powerPeak}
            hoursPeak={hoursPeak}
            isLoading={runtimeLoading}
            error={runtimeError}
            onRetry={refetchAll}
          />
        </section>
      </FadeIn>

      {/* 3 — Runtime trend + stop reason */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('powershare.detail.sectionLabel', 'Powershare runtime trend and stop reason')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5"
        >
          <HoursTrendPanel
            points={hoursSeries}
            isLoading={hoursQ.isLoading}
            error={hoursQ.error}
            onRetry={() => hoursQ.refetch()}
          />
          <StopReasonPanel
            reason={stopReason}
            isLoading={stopQ.isLoading}
            error={stopQ.error}
            onRetry={() => stopQ.refetch()}
          />
        </section>
      </FadeIn>

      {/* 4 — Raw signal snapshot */}
      <FadeIn delay={0.3}>
        <SignalSnapshotPanel
          rows={snapshotRows}
          isLoading={snapshotLoading}
          error={snapshotError}
          onRetry={refetchAll}
        />
      </FadeIn>
    </PageContainer>
  );
}
