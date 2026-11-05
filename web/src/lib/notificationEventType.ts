const EVENT_TYPE_FALLBACKS: Readonly<Record<string, string>> = {
  system: 'System',
  alert: 'Alert',
  automation: 'Automation',
  schedule: 'Schedule',
  test: 'Test',
  other: 'Other',
  unknown: 'Unknown',
  'alert.rule': 'Alert rule',
  'automation.notify': 'Automation',
  'digest.fsd_weekly': 'Weekly FSD digest',
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
    : 'Other';
}

export function notificationEventTypeLabel(value: string | null | undefined, t: TFunction): string {
  const labels: Record<string, string> = {
    'alert.rule': t('notifications.report.values.alertRule', 'Alert rule'),
    'automation.notify': t('notifications.report.values.automation', 'Automation'),
    'digest.fsd.weekly': t('notifications.report.values.digest.fsd.weekly', 'Weekly FSD digest'),
    'system.telemetry.outage': t('notifications.report.values.system.telemetry.outage', 'System telemetry outage'),
    'system.telemetry.recovery': t('notifications.report.values.system.telemetry.recovery', 'System telemetry recovery'),
    'system.mqtt.outage': t('notifications.report.values.system.mqtt.outage', 'System MQTT outage'),
    'system.mqtt.recovery': t('notifications.report.values.system.mqtt.recovery', 'System MQTT recovery'),
    'system.database.outage': t('notifications.report.values.system.database.outage', 'System database outage'),
    'system.database.recovery': t('notifications.report.values.system.database.recovery', 'Database recovery'),
    'system.redis.outage': t('notifications.report.values.system.redis.outage', 'System Redis outage'),
    'system.redis.recovery': t('notifications.report.values.system.redis.recovery', 'System Redis recovery'),
    'system.tesla_api.outage': t('notifications.report.values.system.tesla_api.outage', 'System Tesla API outage'),
    'system.tesla_api.recovery': t('notifications.report.values.system.tesla_api.recovery', 'System Tesla API recovery'),
    'system.worker.outage': t('notifications.report.values.system.worker.outage', 'System worker outage'),
    'system.worker.recovery': t('notifications.report.values.system.worker.recovery', 'System worker recovery'),
    'place.enter': t('notifications.report.values.placeEnter', 'Place arrival'),
    'place.exit': t('notifications.report.values.placeExit', 'Place departure'),
    system: t('notifications.report.values.system', 'System'),
    alert: t('notifications.report.values.alert', 'Alert rules'),
    automation: t('notifications.report.values.automation', 'Automation'),
    schedule: t('notifications.report.values.schedule', 'Schedules'),
    test: t('notifications.report.values.test', 'Tests'),
    unknown: t('notifications.report.values.unknown', 'Unattributed'),
  };
  const key = value === 'digest.fsd_weekly' ? 'digest.fsd.weekly'
    : value === 'alert.computed_metric' || value === 'alert.polling' ? 'alert.rule'
    : value === 'test.alert_rule' || value === 'test.channel' ? 'test'
    : value === 'automation.failure' ? 'automation'
    : value === 'schedule.due' ? 'schedule'
    : value === 'system.web_push' ? 'system'
    : value;
  return key ? Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : t('notifications.report.values.other', 'Other') : t('notifications.report.values.unknown', 'Unattributed');
}

export function notificationSeverityLabel(value: string | null | undefined, t: TFunction): string {
  switch (value) {
    case 'info': return t('notifications.inbox.filter.severity.info', 'Info');
    case 'warn':
    case 'warning': return t('notifications.inbox.filter.severity.warn', 'Warn');
    case 'critical': return t('notifications.inbox.filter.severity.critical', 'Critical');
    default: return value || '';
  }
}
import type { TFunction } from 'i18next';
