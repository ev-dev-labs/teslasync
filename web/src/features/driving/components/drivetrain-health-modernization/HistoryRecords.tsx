import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { DataTable, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SourceBoundary } from './SourceBoundary';
import type { DriveChartRow, MotorChartRow } from './model';

interface Props {
  motorRows: MotorChartRow[];
  driveRows: DriveChartRow[];
  motorState: DataState<unknown>;
  drivesState: DataState<unknown>;
  motorLoading: boolean;
  drivesLoading: boolean;
}
type IndexedMotor = MotorChartRow & { recordKey: number };
type IndexedDrive = DriveChartRow & { recordKey: number };

export function HistoryRecords({ motorRows, driveRows, motorState, drivesState, motorLoading, drivesLoading }: Props) {
  const { t } = useTranslation();
  const { formatTemperature, formatPower, formatDistance } = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const motorColumns: Column<IndexedMotor>[] = [
    { key: 'time', header: t('drivetrain.col.time', 'Time'), render: row => row.time || '—' },
    { key: 'stator', header: t('drivetrain.col.stator', 'Stator'), render: row => formatTemperature(row.stator) },
    { key: 'statorRel', header: t('drivetrain.col.statorRel', 'Rear-Left'), render: row => formatTemperature(row.statorRel) },
    { key: 'statorRer', header: t('drivetrain.col.statorRer', 'Rear-Right'), render: row => formatTemperature(row.statorRer) },
    { key: 'torque', header: t('drivetrain.col.torque', 'Torque (Nm)'), render: row => row.torque != null ? `${fmtNumber(row.torque)} Nm` : '—' },
    { key: 'speed', header: t('drivetrain.modernization.unavailablePowerSignal', 'Direct power signal (not supplied)'), render: () => '—' },
    { key: 'axle', header: t('drivetrain.modernization.axle', 'Axle speed (RPM)'), render: row => row.axle != null ? `${fmtInt(row.axle)} RPM` : '—' },
  ];
  const driveColumns: Column<IndexedDrive>[] = [
    { key: 'date', header: t('drivetrain.col.date', 'Date'), render: row => row.date },
    { key: 'powerMax', header: t('drivetrain.peakPower', 'Peak Power'), render: row => formatPower(row.powerMax) },
    { key: 'powerMin', header: t('drivetrain.regen', 'Regen'), render: row => formatPower(row.powerMin) },
    { key: 'outsideTemp', header: t('drivetrain.outsideTemp', 'Outside Temp'), render: row => formatTemperature(row.outsideTemp) },
    { key: 'distance', header: t('drivetrain.totalDistance', 'Total Distance'), render: row => formatDistance(row.distance) },
  ];
  const label = t('drivetrain.modernization.historyRecords', 'History record details');
  return <LayoutCard title={label}>
    <SourceBoundary state={motorState} label={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
      loading={motorLoading} empty={motorRows.length === 0} emptyMessage={t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}>
      <DataTable tableId="drivetrain-health:motor-history" variant="embedded"
        data={motorRows.map((row, recordKey) => ({ ...row, recordKey }))} columns={motorColumns}
        keyExtractor={row => row.recordKey} caption={t('drivetrain.modernization.motorRecords', 'Motor history records')}
        pagination mobileColumns={['time', 'stator', 'torque']}
        mobilePresentation={{ roles: { time: 'title', stator: 'primary', torque: 'meta' },
          displayValue: (row, key) => {
            if (key === 'time') return row.time;
            if (key === 'stator' || key === 'statorRel' || key === 'statorRer') return formatTemperature(row[key]);
            if (key === 'torque') return row.torque != null ? `${fmtNumber(row.torque)} Nm` : '—';
            if (key === 'axle') return row.axle != null ? `${fmtInt(row.axle)} RPM` : '—';
            return '—';
          },
        }} />
    </SourceBoundary>
    <SourceBoundary state={drivesState} label={t('drivetrain.powerOutput', 'Power Output History')}
      loading={drivesLoading} empty={driveRows.length === 0} emptyMessage={t('drivetrain.noStats', 'No drive statistics available yet')}>
      <DataTable tableId="drivetrain-health:drive-history" variant="embedded"
        data={driveRows.map((row, recordKey) => ({ ...row, recordKey }))} columns={driveColumns}
        keyExtractor={row => row.recordKey} caption={t('drivetrain.modernization.driveRecords', 'Included drive records')}
        pagination mobileColumns={['date', 'powerMax', 'outsideTemp']}
        mobilePresentation={{ roles: { date: 'title', powerMax: 'primary', outsideTemp: 'meta' },
          displayValue: (row, key) => {
            if (key === 'date') return row.date;
            if (key === 'powerMax' || key === 'powerMin') return formatPower(row[key]);
            if (key === 'outsideTemp') return formatTemperature(row.outsideTemp);
            if (key === 'distance') return formatDistance(row.distance);
            return '—';
          },
        }} />
    </SourceBoundary>
    <Text as="p" variant="bodySm">{t('drivetrain.modernization.recordScope', 'These details contain every field of the plotted records, including unknown signals. Motor history retains source order; drives retain chronological order and the existing 30-record cap.')}</Text>
  </LayoutCard>;
}
