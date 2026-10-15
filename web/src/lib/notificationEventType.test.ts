import { describe, expect, it } from 'vitest';
import { notificationEventTypeFallback } from './notificationEventType';

describe('notificationEventTypeFallback', () => {
  it.each([
    ['system.mqtt.outage', 'System MQTT outage'],
    ['system.tesla_api.recovery', 'System Tesla API recovery'],
    ['system.redis.recovery', 'System Redis recovery'],
    ['digest.fsd.weekly', 'Digest FSD weekly'],
    ['system', 'System'],
  ])('uses authored casing for %s', (value, expected) => {
    expect(notificationEventTypeFallback(value)).toBe(expected);
  });

  it.each(['Custom.APIReady_event', 'FSD_CUSTOM', '', '__proto__'])(
    'preserves unknown backend identifiers: %s',
    value => {
      expect(notificationEventTypeFallback(value)).toBe(value);
    },
  );
});
