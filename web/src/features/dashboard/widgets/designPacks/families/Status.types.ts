import type { ReactNode } from 'react';
import type { PackAppearance } from '../types';

export interface StatusPresentationProps {
  appearance: PackAppearance;
  compact?: boolean;
  headline: ReactNode;
  icon: ReactNode;
  details: ReactNode;
}
