import type { ReactNode } from 'react';

import type { GlassPanelProps } from '@/components/ui';

export type HealthStatus = 'good' | 'warning' | 'critical';

/**
 * The glow accent a *real* health status carries on its <GlassPanel>. Derived
 * from GlassPanel's own `glow` prop union (with `'none'` excluded) so the two
 * can never drift: if GlassPanel renames/drops an accent this fails to compile
 * here, and a live status can never resolve to the empty `'none'` glow that
 * would silently drop the severity signal.
 */
export type HealthGlow = Exclude<NonNullable<GlassPanelProps['glow']>, 'none'>;

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

export const HEALTH_GLOW: Record<HealthStatus, HealthGlow> = {
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
