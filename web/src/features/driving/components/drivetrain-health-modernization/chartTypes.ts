import type { DataState } from '@/api/dataState';
import type { DriveChartRow, MotorChartRow } from './model';

export interface MotorHistoryChartProps {
  rows: MotorChartRow[];
  state: DataState<unknown>;
  loading: boolean;
}

export interface DriveHistoryChartProps {
  rows: DriveChartRow[];
  state: DataState<unknown>;
  loading: boolean;
}
