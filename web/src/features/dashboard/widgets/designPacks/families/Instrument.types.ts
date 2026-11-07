import type { ReactNode } from 'react';
import type { PackAppearance, WidgetFamily } from '../types';

export interface InstrumentReading {
  value: number | null;
  max: number;
  label: string;
  unit?: string;
  color?: string;
}

export interface InstrumentPresentationProps {
  appearance: PackAppearance;
  family: WidgetFamily;
  compact?: boolean;
  headline?: ReactNode;
  reading?: InstrumentReading;
  icon?: ReactNode;
  context?: ReactNode;
  instrument?: ReactNode;
  details?: ReactNode;
}
