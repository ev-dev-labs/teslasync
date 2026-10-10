const EVENT_TYPE_FALLBACKS: Readonly<Record<string, string>> = {
  system: 'System',
  alert: 'Alert',
  automation: 'Automation',
  schedule: 'Schedule',
  test: 'Test',
  other: 'Other',
  unknown: 'Unknown',
  'digest.fsd.weekly': 'Digest FSD weekly',
  'system.telemetry.outage': 'System telemetry outage',
  'system.telemetry.recovery': 'System telemetry recovery',
  'system.mqtt.outage': 'System MQTT outage',
  'system.mqtt.recovery': 'System MQTT recovery',
  'system.database.outage': 'System database outage',
  'system.database.recovery': 'System database recovery',
  'system.redis.outage': 'System Redis outage',
  'system.redis.recovery': 'System Redis recovery',
  'system.tesla_api.outage': 'System Tesla API outage',
  'system.tesla_api.recovery': 'System Tesla API recovery',
  'system.worker.outage': 'System worker outage',
  'system.worker.recovery': 'System worker recovery',
};

export function notificationEventTypeFallback(value: string): string {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPE_FALLBACKS, value)
    ? EVENT_TYPE_FALLBACKS[value]
    : value;
}
