import type { ReactNode } from 'react';
import type { PackAppearance } from '../types';

export type LineAppearance = PackAppearance;

export interface LineMetric {
  label: string;
  value: string | null;
  unit?: string;
}

export interface LineTelemetryProps {
  appearance: LineAppearance;
  compact: boolean;
  context: ReactNode;
  headline: LineMetric;
  details: readonly LineMetric[];
  chart: ReactNode;
  sourceBoundary: (content: ReactNode) => ReactNode;
}
