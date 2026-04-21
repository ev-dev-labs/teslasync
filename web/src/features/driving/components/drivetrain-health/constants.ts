import type { ReactNode } from 'react';

export type HealthStatus = 'good' | 'warning' | 'critical';

export const HEALTH_SCORE: Record<HealthStatus, number> = {
  good: 95,
  warning: 60,
  critical: 25,
};

export const HEALTH_COLOR: Record<HealthStatus, string> = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

export const HEALTH_GLOW: Record<HealthStatus, 'green' | 'cyan' | 'purple' | 'none'> = {
  good: 'green',
  warning: 'cyan',
  critical: 'purple',
};

export interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

export interface ChartDataPoint {
  date: string;
  powerMax: number;
  powerMin: number;
  outsideTemp: number | null;
  distance: number;
}

export interface MotorChartDataPoint {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: number | null;
  axle: number | null;
}

export interface Recommendation {
  key: string;
  text: string;
  priority: 'high' | 'medium' | 'low';
}
