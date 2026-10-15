// security_events state changes plus legacy alert-shaped entries. Unknown
// backend event types keep their raw token instead of losing the row.
export const EVENT_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'info'> = {
  vehicle_moved: 'danger',
  unauthorized_unlock: 'danger',
  unauthorized_drive: 'danger',
  sentry_triggered: 'warning',
  manual_panic: 'danger',
  test_alert: 'info',
  locked: 'info',
  sentry_mode: 'warning',
  valet_mode_enabled: 'info',
};

const EVENT_LABEL_KEYS: Record<string, [string, string]> = {
  vehicle_moved: ['guard.eventVehicleMoved', 'Vehicle moved'],
  unauthorized_unlock: ['guard.eventUnauthorizedUnlock', 'Unauthorized unlock'],
  unauthorized_drive: ['guard.eventUnauthorizedDrive', 'Unauthorized drive'],
  sentry_triggered: ['guard.eventSentryTriggered', 'Sentry triggered'],
  manual_panic: ['guard.eventManualPanic', 'Manual panic'],
  test_alert: ['guard.eventTestAlert', 'Test alert'],
  locked: ['guard.eventLocked', 'Lock state changed'],
  sentry_mode: ['guard.eventSentryMode', 'Sentry mode'],
  valet_mode_enabled: ['guard.eventValetMode', 'Valet mode'],
};

export function eventLabelKey(type: string): [string, string] {
  return EVENT_LABEL_KEYS[type] ?? [`guard.event.${type}`, type];
}
