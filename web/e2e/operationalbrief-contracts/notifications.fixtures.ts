import { expect, type Page } from '@playwright/test';
import type {
  AlertRule, NotificationChannel, NotificationLog, NotificationReport, NotificationStats, QuietHoursWindow,
} from '../../src/api/types';
import { fulfillApiFixture, installApiMocks, seedBrowserState } from '../mockApi';

export const NOW = '2026-08-26T16:00:00.000Z';
export const PERIOD = {
  from: '2026-08-26', to: '2026-08-26',
  from_instant: '2026-08-26T00:00:00.000Z',
  to_exclusive: '2026-08-27T00:00:00.000Z', timezone: 'UTC',
};
export const INBOX_ROUTE = '/notifications/inbox?time_scope=custom&from=2026-08-26&to=2026-08-26&view=flat&size=25';

export function notificationRows(archived = false): NotificationLog[] {
  return Array.from({ length: 83 }, (_, index) => ({
    id: (archived ? 2000 : 1000) + index,
    channel_id: null, alert_id: null,
    title: `Synthetic ${archived ? 'archived' : 'active'} notification ${index + 1}`,
    message: 'Recorded synthetic evidence; no inferred delivery timestamp.',
    status: 'triggered',
    severity: archived
      ? [' CRITICAL ', ' Warn ', ' INFO ', 'unclassified'][index % 4]
      : ['critical', 'warn', 'info', 'unclassified'][index % 4],
    event_type: 'system.telemetry_recovered', error: '',
    created_at: new Date(Date.parse(NOW) - (index + 1) * 60_000).toISOString(),
    sent_at: null,
    read_at: index % 2 === 0 ? null : NOW,
    archived_at: archived ? NOW : null,
  }));
}

export const deliveryRows: NotificationLog[] = [
  { id: 301, channel_id: 1, alert_id: 71, title: 'Synthetic measured delivery', message: 'Measured zero is valid.',
    status: 'sent', severity: 'critical', error: '', event_type: 'alert.battery_low',
    created_at: '2026-08-26T15:30:00.000Z', sent_at: '2026-08-26T15:30:00.000Z',
    latency_ms: 0, read_at: null },
  { id: 302, channel_id: 1, alert_id: 72, title: 'Synthetic derived delivery', message: 'Two-second derived latency.',
    status: 'sent', severity: 'warn', error: '', event_type: 'alert.battery_low',
    created_at: '2026-08-26T15:40:00.000Z', sent_at: '2026-08-26T15:40:02.000Z', read_at: NOW },
  { id: 303, channel_id: 1, alert_id: 73, title: 'Synthetic failed attempt', message: 'Failure has no usable latency.',
    status: 'failed', severity: 'info', error: 'Synthetic transport failure',
    created_at: '2026-08-26T15:45:00.000Z', sent_at: null },
  { id: 304, channel_id: 1, alert_id: 74, title: 'Synthetic DND attempt', message: 'Excluded from delivery SLO.',
    status: 'deferred_dnd', severity: 'warn', error: '',
    created_at: '2026-08-26T15:50:00.000Z', sent_at: null },
];

export const analysisRows: NotificationLog[] = deliveryRows.slice(0, 3).map((row, index) => ({
  id: 400 + index, channel_id: null, alert_id: row.alert_id,
  title: row.title, message: row.message, status: 'triggered', severity: row.severity,
  event_type: 'alert.battery_low', error: '', created_at: row.created_at, sent_at: null,
  ...(index < 2 ? { read_at: row.read_at } : {}),
}));

export const ruleRows: AlertRule[] = Array.from({ length: 4 }, (_, index) => ({
  id: 71 + index, name: `Synthetic rule ${index + 1}`, enabled: index < 3,
  signal_name: 'BatteryLevel', op: 'lt', value_num: 20,
  severity: index === 0 ? 'critical' : index === 1 ? 'warn' : 'info',
  cooldown_min: 10, trigger_mode: 'once', all_vehicles: true, vehicle_ids: [],
  kind: index === 3 ? 'computed_metric' : 'signal', channel_ids: [],
  snoozed_until: index === 0 ? '2026-08-27T16:00:00.000Z' : null,
  created_at: NOW, updated_at: NOW,
}));

export const quietRows: QuietHoursWindow[] = [
  { id: 1, user_id: 'synthetic-user', enabled: true, start_local: '00:00', end_local: '23:59',
    timezone: 'UTC', weekdays: 127, bypass_severities: ['critical'], created_at: NOW, updated_at: NOW },
  { id: 2, user_id: 'synthetic-user', enabled: false, start_local: '00:00', end_local: '23:59',
    timezone: 'UTC', weekdays: 127, bypass_severities: ['info'], created_at: NOW, updated_at: NOW },
];

export const channelStats: NotificationStats = {
  total_sent: 17, sent: 17, failed: 0, pending: 3, total_channels: 5, enabled_channels: 2,
};

export const channelRows: NotificationChannel[] = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1, name: `Synthetic delivery channel ${index + 1}`, kind: 'webhook',
  enabled: index < 2, created_at: NOW, updated_at: NOW,
  url: 'https://notifications.example.invalid/synthetic', method: 'POST',
  headers: {}, body_template: '{{message}}',
}));

export function activityReport(zero = false): NotificationReport {
  return {
    ...PERIOD, triggered: zero ? 0 : 120, deliveries: zero ? 0 : 310,
    outbound_http_calls: zero ? 0 : 401, uncorrelated_deliveries: zero ? 0 : 10,
    by_source: zero ? [] : [{ key: 'alert', count: 120 }],
    by_type: zero ? [] : [{ key: 'alert.battery_low', count: 120 }],
    by_severity: zero ? [] : [{ key: 'critical', count: 80 }, { key: 'warn', count: 40 }],
    by_channel: zero ? [] : [{ key: 'email', count: 310 }],
    by_status: zero ? [] : [{ key: 'sent', count: 310 }],
    daily: zero ? [] : [{ day: PERIOD.from, triggered: 120, deliveries: 310 }],
  };
}

export interface NotificationFixtureOptions {
  emptyBacklog?: boolean;
  deliveries?: NotificationLog[];
  report?: NotificationReport;
  reportUnavailable?: boolean;
  rules?: AlertRule[];
  quiet?: QuietHoursWindow[];
  reportGate?: Promise<void>;
}

export async function installNotificationFixtures(
  page: Page, theme: 'light' | 'dark', path: string, options: NotificationFixtureOptions = {},
) {
  expect(process.env.E2E_MOCKS, 'This contract requires the strict synthetic API harness').not.toBe('0');
  await page.clock.setFixedTime(new Date(NOW));
  await seedBrowserState(page, theme, path);
  await page.addInitScript(() => {
    localStorage.setItem('teslasync.notifications.markOnOpen', 'false');
    localStorage.setItem('teslasync.notifications.markOnClick', 'false');
    localStorage.setItem('teslasync-web-push-prefs', JSON.stringify({ alerts: true, exportStatus: false }));
    localStorage.setItem('teslasync:notification-sound-prefs:v1', JSON.stringify({
      master: false, volume: 0.6,
      perCategory: { critical_alert: true, warning_alert: true, info_alert: false,
        charge_complete: true, drive_complete: false, automation_run: false, achievement: false },
    }));
  });
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Notification contracts require installApiMocks');
  const ledger: { path: string; params: URLSearchParams }[] = [];
  const control = { failStats: false, statsRequests: 0 };
  const active = options.emptyBacklog ? [] : notificationRows();
  const archived = options.emptyBacklog ? [] : notificationRows(true);
  await page.route(/\/api\/v1\/notifications\/logs(?:\?|$)/, async route => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    ledger.push({ path: '/notifications/logs', params });
    const view = params.get('view');
    if (params.get('archived') === 'all') {
      expect(['inbox', 'deliveries']).toContain(view);
      expect(params.get('limit')).toBe('1000');
      expect(params.has('before_id')).toBe(false);
      await fulfillApiFixture(route, mocks, {
        json: view === 'deliveries' ? options.deliveries ?? deliveryRows
          : options.deliveries?.length === 0 ? [] : analysisRows,
      });
      return;
    }
    let rows = params.get('archived') === 'true' ? archived : active;
    if (params.has('severity')) rows = rows.filter(row => params.get('severity')!.split(',').includes(row.severity ?? ''));
    if (params.has('q')) rows = rows.filter(row => `${row.title} ${row.message}`.toLowerCase().includes(params.get('q')!.toLowerCase()));
    if (params.has('read')) rows = rows.filter(row => Boolean(row.read_at) === (params.get('read') === 'true'));
    if (params.has('from')) rows = rows.filter(row => Date.parse(row.created_at) >= Date.parse(params.get('from')!));
    if (params.has('to_exclusive')) rows = rows.filter(row => Date.parse(row.created_at) < Date.parse(params.get('to_exclusive')!));
    if (params.get('count_only') === 'true') {
      await fulfillApiFixture(route, mocks, { json: { total: rows.length } });
      return;
    }
    expect(params.get('grouped')).not.toBe('true');
    const offset = Number(params.get('offset') ?? 0);
    const limit = Number(params.get('limit') ?? 50);
    await fulfillApiFixture(route, mocks, { json: rows.slice(offset, offset + limit) });
  });
  await page.route(/\/api\/v1\/notifications\/report\?/, async route => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    ledger.push({ path: '/notifications/report', params });
    expect(Date.parse(params.get('from_instant') ?? '')).toBe(Date.parse(PERIOD.from_instant));
    expect(Date.parse(params.get('to_exclusive') ?? '')).toBe(Date.parse(PERIOD.to_exclusive));
    expect(params.get('timezone')).toBe(PERIOD.timezone);
    await options.reportGate;
    await fulfillApiFixture(route, mocks, options.reportUnavailable
      ? { status: 503, json: { error: 'Synthetic historical report unavailable' } }
      : { json: options.report ?? activityReport() });
  });
  await page.route(/\/api\/v1\/notifications\/stats$/, async route => {
    expect(route.request().method()).toBe('GET');
    control.statsRequests += 1;
    await fulfillApiFixture(route, mocks, control.failStats
      ? { status: 503, json: { error: 'Synthetic statistics refresh unavailable' } }
      : { json: channelStats });
  });
  await page.route(/\/api\/v1\/notifications\/?$/, async route => {
    expect(route.request().method()).toBe('GET');
    await fulfillApiFixture(route, mocks, { json: channelRows });
  });
  await page.route(/\/api\/v1\/alerts\/rules$/, async route => {
    expect(route.request().method()).toBe('GET');
    await fulfillApiFixture(route, mocks, { json: options.rules ?? ruleRows });
  });
  await page.route(/\/api\/v1\/notifications\/quiet-hours\/?$/, async route => {
    expect(route.request().method()).toBe('GET');
    await fulfillApiFixture(route, mocks, { json: { windows: options.quiet ?? quietRows } });
  });
  return { mocks, ledger, control };
}
