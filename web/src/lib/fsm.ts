/** FSM state display configurations for frontend rendering. */

export interface StateConfig {
  label: string;
  color: string;
  variant: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  icon?: string;
}

// Vehicle lifecycle states
export const vehicleStates: Record<string, StateConfig> = {
  unknown: { label: 'Unknown', color: '#6b7280', variant: 'neutral' },
  online: { label: 'Online', color: '#22c55e', variant: 'success' },
  asleep: { label: 'Asleep', color: '#a855f7', variant: 'info' },
  driving: { label: 'Driving', color: '#3b82f6', variant: 'info' },
  charging: { label: 'Charging', color: '#f59e0b', variant: 'warning' },
  offline: { label: 'Offline', color: '#ef4444', variant: 'danger' },
};

// Charging session states
export const chargingStates: Record<string, StateConfig> = {
  pending: { label: 'Pending', color: '#6b7280', variant: 'neutral' },
  connecting: { label: 'Connecting', color: '#3b82f6', variant: 'info' },
  charging: { label: 'Charging', color: '#f59e0b', variant: 'warning' },
  completing: { label: 'Completing', color: '#22c55e', variant: 'success' },
  completed: { label: 'Completed', color: '#22c55e', variant: 'success' },
  failed: { label: 'Failed', color: '#ef4444', variant: 'danger' },
};

// Charging sub-states
export const chargingSubStates: Record<string, StateConfig> = {
  'charging.starting': { label: 'Starting', color: '#6b7280', variant: 'neutral' },
  'charging.ramping': { label: 'Ramping Up', color: '#3b82f6', variant: 'info' },
  'charging.steady': { label: 'Steady', color: '#22c55e', variant: 'success' },
  'charging.tapering': { label: 'Tapering', color: '#f59e0b', variant: 'warning' },
  'charging.complete': { label: 'Complete', color: '#22c55e', variant: 'success' },
};

// Trip states
export const tripStates: Record<string, StateConfig> = {
  started: { label: 'Started', color: '#3b82f6', variant: 'info' },
  in_progress: { label: 'In Progress', color: '#22c55e', variant: 'success' },
  paused: { label: 'Paused', color: '#f59e0b', variant: 'warning' },
  completed: { label: 'Completed', color: '#6b7280', variant: 'neutral' },
  cancelled: { label: 'Cancelled', color: '#ef4444', variant: 'danger' },
};

// Export job states
export const exportStates: Record<string, StateConfig> = {
  queued: { label: 'Queued', color: '#6b7280', variant: 'neutral' },
  validating: { label: 'Validating', color: '#3b82f6', variant: 'info' },
  processing: { label: 'Processing', color: '#f59e0b', variant: 'warning' },
  uploading: { label: 'Uploading', color: '#3b82f6', variant: 'info' },
  completed: { label: 'Completed', color: '#22c55e', variant: 'success' },
  failed: { label: 'Failed', color: '#ef4444', variant: 'danger' },
};

// Notification states
export const notificationStates: Record<string, StateConfig> = {
  pending: { label: 'Pending', color: '#6b7280', variant: 'neutral' },
  sending: { label: 'Sending', color: '#3b82f6', variant: 'info' },
  sent: { label: 'Sent', color: '#22c55e', variant: 'success' },
  failed: { label: 'Failed', color: '#ef4444', variant: 'danger' },
  retrying: { label: 'Retrying', color: '#f59e0b', variant: 'warning' },
};

// Shared neutral fallback so unresolved keys collapse onto a single,
// well-formed StateConfig. Kept as one module-level singleton so the hot
// path (rendering many rows with an unknown state) allocates nothing.
const unknownState: StateConfig = { label: 'Unknown', color: '#6b7280', variant: 'neutral' };

/**
 * Safely resolve a raw state key against one of the display-config maps above.
 *
 * Returns the matching {@link StateConfig}, or a neutral "Unknown" fallback when
 * `state` is nullish, not a registered key, or an inherited `Object.prototype`
 * member (e.g. `"toString"`, `"constructor"`, `"__proto__"`). A plain
 * `map[state]` lookup returns those inherited members as if they were configs,
 * so callers reading `.variant` off a function would render garbage — the
 * `hasOwnProperty` guard prevents that. The result is never `undefined`, so
 * `getStateConfig(vehicleStates, apiState).label` is always safe to read.
 *
 * @param map           one of the exported state maps
 * @param state         raw state string from the API (may be null/undefined)
 * @param fallbackLabel label for the unresolved case (defaults to "Unknown")
 */
export function getStateConfig(
  map: Record<string, StateConfig>,
  state: string | null | undefined,
  fallbackLabel = 'Unknown',
): StateConfig {
  if (typeof state === 'string' && Object.prototype.hasOwnProperty.call(map, state)) {
    return map[state];
  }
  // Reuse the singleton for the common default; only allocate when a caller
  // supplies a custom (e.g. translated) label.
  return fallbackLabel === unknownState.label ? unknownState : { ...unknownState, label: fallbackLabel };
}
