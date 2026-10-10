import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { BipolarBar } from '@/components/charts';
import { Caption, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const TORQUE_MAX = 600;

/* Regen absorbs far less than the drive limit puts down, so the two ends of
 * the torque scale are sized independently rather than mirrored. */
const TORQUE_REGEN_MAX = 250;

// Live poll cadence (ms) for the motor telemetry tile. Mirrors the 5s interval
// every other live-telemetry widget (door/window, live signals, energy flow)
// and the drivetrain/dynamics pages use, so the tile stays current instead of
// freezing on the first reading until a manual refresh.
const LIVE_REFRESH_MS = 5_000;

/**
 * Map an absolute torque magnitude (Nm) to a gauge colour: green below 200,
 * amber below 400, red at/above 400. Exported for unit testing.
 */
export function torqueColor(nm: number): string {
  if (nm < 200) return '#10b981';
  if (nm < 400) return '#f59e0b';
  return '#ef4444';
}

export default function MotorPerformanceWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;

  const query = useMotorLatest(vid ?? 0, LIVE_REFRESH_MS);
  const {
    data, isLoading, error,
    isFetching, isStale, isError,
    dataUpdatedAt, refetch,
  } = query;
  const trust = useDataState({
    ...query,
    data: data ?? (isLoading || isError ? undefined : null),
  }, { provenance: 'cached', maxAgeMs: 120_000 });

  const isCompact = size.cols <= 1;
  const torque = knownNumber(data?.di_torque);
  const statorTemp = data?.di_stator_temp ?? data?.motor_temp_c_front ?? null;
  const gear = data?.gear ?? data?.shift_state ?? null;
  // These extension fields are not declared by MotorSnapshot; narrow the
  // actual response rather than asserting that telemetry must be numeric.
  const lateralG = data && 'lateral_accel' in data ? knownNumber(data.lateral_accel) : null;
  const longitudinalG = data && 'longitudinal_accel' in data ? knownNumber(data.longitudinal_accel) : null;

  const readoutMetrics: StatMetric[] = [
    {
      metricId: 'temperature', occurrenceId: 'motor-stator-temperature', rawValue: statorTemp,
      label: t('widget.motorPerformance.statorTemp', 'Stator temp'),
      description: t('widget.motorPerformance.statorSource', 'Returned stator temperature in °C, falling back to the front motor temperature only when absent.'),
      display: { formatter: raw => ({ value: fmtNumber(toTemperatureDisplay(raw)), unit: tempUnit }) },
    },
    {
      metricId: 'status', occurrenceId: 'motor-gear-state', rawValue: gear,
      label: t('widget.motorPerformance.gearState', 'Gear state'),
      description: t('widget.motorPerformance.gearSource', 'Reported gear, falling back to shift state; an absent source remains unknown.'),
    },
    {
      metricId: 'number', occurrenceId: 'motor-lateral-readout', rawValue: lateralG,
      label: t('widget.motorPerformance.lateralG', 'Lateral G'),
      description: t('widget.motorPerformance.extensionUnitLimitation', 'Extension-field units are not established by the source contract. The existing g presentation is retained without rescaling; it is not verified SI acceleration.'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) },
    },
    {
      metricId: 'number', occurrenceId: 'motor-longitudinal-readout', rawValue: longitudinalG,
      label: t('widget.motorPerformance.longitudinalG', 'Longitudinal G'),
      description: t('widget.motorPerformance.extensionUnitLimitation', 'Extension-field units are not established by the source contract. The existing g presentation is retained without rescaling; it is not verified SI acceleration.'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) },
    },
  ];

  const gaugeColor = useMemo(() => torqueColor(Math.abs(torque ?? 0)), [torque]);
  const torqueOutsideScale = torque != null && (torque < -TORQUE_REGEN_MAX || torque > TORQUE_MAX);

  const shellProps = {
    loading: isLoading,
    error: trust.fatalError ? String(error) : null,
    dataState: trust,
    loadingContent: <Skeleton className="h-24 w-full" />,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.motorPerformance.title', 'Motor performance')} {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center gap-1 min-h-[44px]">
            <>
              <Caption>
                {t('widget.motorPerformance.gear', 'Gear')}
              </Caption>
              <Text variant="metricValue" className="[overflow-wrap:anywhere]">{gear ?? '—'}</Text>
              <Caption>
                {t('widget.motorPerformance.torque', 'Torque')}
              </Caption>
              <Text variant="metricValue" className="[overflow-wrap:anywhere]">
                {torque == null ? '—' : fmtNumber(torque)} {torque != null && t('widget.motorPerformance.nm', 'Nm')}
              </Text>
            </>
          {!data && <Caption>{t('widget.motorPerformance.noData', 'No motor data')}</Caption>}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.motorPerformance.title', 'Motor performance')}
      icon={<Zap className="h-3.5 w-3.5 text-yellow-400" />}
      {...shellProps}
    >
        <div className="flex min-w-0 flex-col gap-3">
          {torqueOutsideScale ? (
            <div className="min-w-0 space-y-1">
              <WidgetBigNumber
                value={fmtNumber(torque)}
                label={t('widget.motorPerformance.torque', 'Torque')}
                unit={t('widget.motorPerformance.nm', 'Nm')}
                animated={false}
              />
              <Caption className="block [overflow-wrap:anywhere]">
                {t('widget.motorPerformance.outsideScale', 'Reading outside displayed scale ({{min}} to {{max}} {{unit}})', {
                  min: fmtNumber(-TORQUE_REGEN_MAX), max: fmtNumber(TORQUE_MAX), unit: t('widget.motorPerformance.nm', 'Nm'),
                })}
              </Caption>
              <div className="flex flex-wrap justify-between gap-2">
                <Caption>{t('widget.motorPerformance.regen', 'Regen')}</Caption>
                <Caption>{t('widget.motorPerformance.drive', 'Drive')}</Caption>
              </div>
            </div>
          ) : <BipolarBar
            value={torque}
            max={TORQUE_MAX}
            min={TORQUE_REGEN_MAX}
            label={t('widget.motorPerformance.torque', 'Torque')}
            unit={` ${t('widget.motorPerformance.nm', 'Nm')}`}
            positiveColor={gaugeColor}
            negativeColor={gaugeColor}
            negativeLabel={t('widget.motorPerformance.regen', 'Regen')}
            positiveLabel={t('widget.motorPerformance.drive', 'Drive')}
          />}
          <DashboardSourceBrief metrics={readoutMetrics} state={trust}
            eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
            title={t('widget.motorPerformance.summaryTitle', 'Returned motor readouts')}
            description={t('widget.motorPerformance.summaryDescription', 'Temperature, categorical gear and two extension readings retain independent raw operands. Signed torque and its asymmetric regen/drive scale remain above.')}
            scope={t('widget.motorPerformance.summaryScope', 'Vehicle {{id}} · returned motor snapshot; continuous recording coverage and extension-field units are not established.', { id: vid ?? '—' })}
            testId="dashboard-motor-readouts-brief" />
          {!data && <Caption>{t('widget.motorPerformance.noData', 'No motor data')}</Caption>}
        </div>
    </WidgetShell>
  );
}
