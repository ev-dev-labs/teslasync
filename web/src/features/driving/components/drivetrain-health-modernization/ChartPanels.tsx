import { useTranslation } from 'react-i18next';
import { CardGrid } from '@/components/layout/layout-reference';
import type { DataState } from '@/api/dataState';
import type { DriveChartRow, MotorChartRow } from './model';
import { StatorHistory } from './StatorHistory';
import { TorqueHistory } from './TorqueHistory';
import { TemperatureHistory } from './TemperatureHistory';
import { PowerHistory } from './PowerHistory';

interface Props {
  motorRows: MotorChartRow[];
  driveRows: DriveChartRow[];
  motorState: DataState<unknown>;
  drivesState: DataState<unknown>;
  motorLoading: boolean;
  drivesLoading: boolean;
}

export function ChartPanels({ motorRows, driveRows, motorState, drivesState, motorLoading, drivesLoading }: Props) {
  const { t } = useTranslation();
  return (
    <CardGrid
      label={t('drivetrain.modernization.charts', 'Motor, temperature and power history charts')}
      items={[
        {
          id: 'stator-history',
          size: 'half',
          content: <StatorHistory rows={motorRows} state={motorState} loading={motorLoading} />,
        },
        {
          id: 'torque-history',
          size: 'half',
          content: <TorqueHistory rows={motorRows} state={motorState} loading={motorLoading} />,
        },
        {
          id: 'temperature-trend',
          size: 'half',
          content: <TemperatureHistory rows={driveRows} state={drivesState} loading={drivesLoading} />,
        },
        {
          id: 'power-output',
          size: 'half',
          content: <PowerHistory rows={driveRows} state={drivesState} loading={drivesLoading} />,
        },
      ]}
    />
  );
}
