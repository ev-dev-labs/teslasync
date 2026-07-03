/**
 * Classify an arbitrary JSON feature-flag value into a display bucket.
 *
 * Feature-flag values are stored as opaque JSON (`unknown`), so both the
 * KPI band (FlagStatsBand) and the composition breakdown
 * (FlagCompositionPanel) need a single, shared rule for turning a value
 * into a stable kind label. Keeping the classifier here avoids two
 * subtly-different `typeof` ladders drifting apart.
 */
export type FlagValueKind =
  | 'boolean'
  | 'number'
  | 'string'
  | 'object'
  | 'array'
  | 'null';

/** Stable display order for the composition breakdown. */
export const FLAG_VALUE_KINDS: readonly FlagValueKind[] = [
  'boolean',
  'number',
  'string',
  'object',
  'array',
  'null',
] as const;

export function classifyFlagValue(value: unknown): FlagValueKind {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind === 'boolean') return 'boolean';
  if (kind === 'number') return 'number';
  if (kind === 'string') return 'string';
  return 'object';
}
