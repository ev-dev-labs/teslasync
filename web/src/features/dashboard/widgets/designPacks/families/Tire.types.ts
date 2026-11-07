import type { ReactNode } from 'react';
import type { PackAppearance } from '../types';

export interface TireReading {
  position: 'fl' | 'fr' | 'rl' | 'rr';
  label: string;
  value: string;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface TirePressurePresentationProps {
  appearance: PackAppearance;
  vehicle: ReactNode;
  tires: readonly TireReading[];
  summary: ReactNode;
  unit: string;
}
