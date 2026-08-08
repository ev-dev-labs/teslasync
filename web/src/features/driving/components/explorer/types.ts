import type { UnitFormatter } from '@/hooks/useUnits';

export interface ExplorerSectionState {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export interface ExplorerDistanceDisplay {
  formatDistance: UnitFormatter;
}
