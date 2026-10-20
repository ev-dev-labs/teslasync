export interface DrivingRhythmSectionState {
  isLoading: boolean;
  /** Freshness of retained evidence, independent of complete API pagination. */
  retained: boolean;
  error: unknown;
  onRetry: () => void;
}
