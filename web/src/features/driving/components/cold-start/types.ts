export interface ColdStartSectionState {
  isLoading: boolean;
  retained?: boolean;
  error: unknown;
  onRetry: () => void;
}
