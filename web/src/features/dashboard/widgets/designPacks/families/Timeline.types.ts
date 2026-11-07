import type { ReactNode } from 'react';
import type { PackAppearance } from '../types';

export interface TimelineSlots {
  feed: string;
  row: string;
}

export interface TimelinePresentationProps {
  appearance: PackAppearance;
  compact?: boolean;
  render: (slots: TimelineSlots) => ReactNode;
}
