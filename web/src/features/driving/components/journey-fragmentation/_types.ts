import type { JourneyFragmentationResult } from '../../lib/journeyFragmentation';
import type { DataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';

export interface JourneyFragmentationSectionProps {
  result: JourneyFragmentationResult;
  loading?: boolean;
  state?: DataState<Drive[]>;
}

export function percent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;
}

export function count(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : String(value);
}
