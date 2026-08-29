/**
 * Shared per-section state for the FSD Insights page.
 *
 * Every panel on the page renders its own shell in all four states, so the
 * page passes one of these to each section instead of hiding sections.
 */
export interface FsdSectionState {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when no vehicle is selected, which is a recoverable state, not an error. */
  noVehicle: boolean;
}
