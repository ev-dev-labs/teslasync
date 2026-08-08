export interface ColdStartSectionState {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}
