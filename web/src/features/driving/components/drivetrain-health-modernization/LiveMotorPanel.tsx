import { useTranslation } from 'react-i18next';
import type { MotorSnapshot } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup, type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { Badge, DataTable, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SourceBoundary } from './SourceBoundary';
import { finite, motorPowerSI } from './model';

interface Props {
  motorLatest?: MotorSnapshot | null;
  isolationResistance: number | null | undefined;
  state: DataState<unknown>;
  loading: boolean;
  connected: boolean;
}
interface DetailRow { key: string; label: string; value: string }

export function LiveMotorPanel({ motorLatest, isolationResistance, state, loading, connected }: Props) {
  const { t } = useTranslation();
  const { unitPrefs, formatPower, formatTemperature } = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const preferences = { units: unitPrefs, currency: { kind: 'symbol' as const, value: '$' } };
  const scalar = (value: number | null | undefined, unit: string, integer = false) =>
    finite(value) != null ? `${integer ? fmtInt(value ?? 0) : fmtNumber(value ?? 0)} ${unit}` : '—';
  const text = (value: string | null | undefined) => value?.trim() || '—';
  const isolation = finite(isolationResistance);
  // Preserve the live hook's existing <=0 sentinel policy. It cannot
  // distinguish an unobserved default 0 from a measured value.
  const isolationValue = isolation != null && isolation > 0 ? isolation : null;
  const metrics: StatMetric[] = [
    {
      metricId: 'text',
      occurrenceId: 'shift',
      label: t('drivetrain.shiftState', 'Shift State'),
      rawValue: motorLatest?.shift_state,
    },
    {
      metricId: 'power',
      occurrenceId: 'power',
      label: t('drivetrain.power', 'Power'),
      rawValue: motorPowerSI(motorLatest?.power_kw),
    },
    {
      metricId: 'power',
      occurrenceId: 'regen',
      label: t('drivetrain.regen', 'Regen'),
      rawValue: motorPowerSI(motorLatest?.regen_kw),
    },
    {
      metricId: 'text',
      occurrenceId: 'source',
      label: t('drivetrain.source', 'Source'),
      rawValue: motorLatest?.source,
    },
    {
      metricId: 'text',
      occurrenceId: 'rpm-front',
      label: t('drivetrain.rpmFront', 'Front Motor RPM'),
      rawValue: finite(motorLatest?.motor_rpm_front) != null
        ? scalar(motorLatest?.motor_rpm_front, 'RPM', true) : null,
    },
    {
      metricId: 'text',
      occurrenceId: 'rpm-rear',
      label: t('drivetrain.rpmRear', 'Rear Motor RPM'),
      rawValue: finite(motorLatest?.motor_rpm_rear) != null
        ? scalar(motorLatest?.motor_rpm_rear, 'RPM', true) : null,
    },
    {
      metricId: 'text',
      occurrenceId: 'torque-front',
      label: t('drivetrain.torqueFront', 'Front Torque'),
      rawValue: finite(motorLatest?.torque_nm_front) != null
        ? scalar(motorLatest?.torque_nm_front, 'Nm') : null,
    },
    {
      metricId: 'text',
      occurrenceId: 'torque-rear',
      label: t('drivetrain.torqueRear', 'Rear Torque'),
      rawValue: finite(motorLatest?.torque_nm_rear) != null
        ? scalar(motorLatest?.torque_nm_rear, 'Nm') : null,
    },
    {
      metricId: 'temperature',
      occurrenceId: 'temp-front',
      label: t('drivetrain.motorTempFront', 'Front Motor Temp'),
      rawValue: finite(motorLatest?.motor_temp_c_front),
    },
    {
      metricId: 'temperature',
      occurrenceId: 'temp-rear',
      label: t('drivetrain.motorTempRear', 'Rear Motor Temp'),
      rawValue: finite(motorLatest?.motor_temp_c_rear),
    },
    {
      metricId: 'temperature',
      occurrenceId: 'inverter',
      label: t('drivetrain.inverterTemp', 'Inverter Temp'),
      rawValue: finite(motorLatest?.inverter_temp_c),
    },
    {
      metricId: 'temperature',
      occurrenceId: 'battery',
      label: t('drivetrain.batteryTemp', 'Battery Temp'),
      rawValue: finite(motorLatest?.battery_temp_c),
    },
    {
      metricId: 'text',
      occurrenceId: 'isolation',
      label: t('drivetrain.isolationResistance', 'HV Isolation'),
      rawValue: isolationValue != null ? scalar(isolationValue, 'kΩ') : null,
      context: isolationValue == null ? t('drivetrain.modernization.unknown', 'Unknown')
        : isolationValue >= 500 ? t('drivetrain.modernization.isolationHigh', '500 kΩ or above')
          : isolationValue >= 100 ? t('drivetrain.modernization.isolationMiddle', '100–499 kΩ')
            : t('drivetrain.modernization.isolationLow', 'Below 100 kΩ'),
    },
  ];
  // All thirteen original record fields are reachable on phones, not only
  // the four headline metrics. DataTable owns mobile details and exports.
  const values = [
    text(motorLatest?.shift_state), formatPower(motorPowerSI(motorLatest?.power_kw)),
    formatPower(motorPowerSI(motorLatest?.regen_kw)), text(motorLatest?.source),
    scalar(motorLatest?.motor_rpm_front, 'RPM', true), scalar(motorLatest?.motor_rpm_rear, 'RPM', true),
    scalar(motorLatest?.torque_nm_front, 'Nm'), scalar(motorLatest?.torque_nm_rear, 'Nm'),
    formatTemperature(finite(motorLatest?.motor_temp_c_front)), formatTemperature(finite(motorLatest?.motor_temp_c_rear)),
    formatTemperature(finite(motorLatest?.inverter_temp_c)), formatTemperature(finite(motorLatest?.battery_temp_c)),
    scalar(isolationValue, 'kΩ'),
  ];
  const details: DetailRow[] = metrics.map((metric, index) => ({
    key: metric.occurrenceId ?? String(index), label: metric.label ?? '—', value: values[index],
  }));
  const columns: Column<DetailRow>[] = [
    { key: 'label', header: t('drivetrain.modernization.field', 'Field'), render: row => row.label },
    { key: 'value', header: t('drivetrain.modernization.reading', 'Reading'), render: row => row.value },
  ];
  const period: StatPeriod = {
    kind: 'snapshot',
    label: t('drivetrain.liveMotor', 'Live Motor Status'),
    observedAt: motorLatest?.ts?.trim() || null,
    provenance: t(
      'drivetrain.modernization.motorSnapshotScope',
      'Latest returned motor snapshot; reported source: {{source}}. Observation freshness and continuous coverage are not established. HV isolation comes from the separate live signal state.',
      { source: motorLatest?.source?.trim() || t('drivetrain.modernization.unknown', 'Unknown') },
    ),
  };
  return <LayoutCard title={t('drivetrain.liveMotor', 'Live Motor Status')}>
    <Badge variant={connected ? 'success' : 'neutral'}>
      {connected ? t('drivetrain.realTime', 'Real-time telemetry active') : t('drivetrain.modernization.liveNotConnected', 'Live telemetry connection not established')}
    </Badge>
    <SourceBoundary state={state} label={t('drivetrain.liveMotor', 'Live Motor Status')}
      loading={loading} empty={!motorLatest} emptyMessage={t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}>
      <StatGroup metrics={metrics} preferences={preferences}
        period={period}
        retained={state.hasData} />
      <DataTable tableId="drivetrain-health:live-details" variant="embedded" data={details} columns={columns}
        keyExtractor={row => row.key} caption={t('drivetrain.modernization.liveDetails', 'Live motor record details')}
        mobileColumns={['label', 'value']} mobilePresentation={{
          roles: { label: 'title', value: 'primary' },
          displayValue: (row, key) => key === 'label' ? row.label : row.value,
        }} />
    </SourceBoundary>
    <Text as="p" variant="bodySm">{t('drivetrain.modernization.isolationPolicy', 'HV isolation bands are 500 kΩ and 100 kΩ. Non-positive readings use the existing unknown policy.')}</Text>
  </LayoutCard>;
}
