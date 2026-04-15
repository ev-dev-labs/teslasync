/**
 * Safely extract a human-readable message from an unknown error.
 * React Query errors are typed as `unknown` — this normalises
 * Error objects, strings, and arbitrary values into a string.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}
