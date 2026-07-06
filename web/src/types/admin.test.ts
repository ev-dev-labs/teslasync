/**
 * admin.ts — contract tests for the admin/system API view-models.
 *
 * This module is *type-only*: every export is an `interface`, a string-literal
 * union, or a re-exported changelog type — all erased at runtime, and (because
 * `tsconfig.json` excludes `*.test.ts` and vitest transpiles with esbuild) never
 * type-checked here. A smoke import proves nothing, so — following the repo
 * convention for type modules (see
 * features/charging/components/charging-curve/types.test.ts) — this suite pins
 * each contract with REAL runtime assertions:
 *
 *   • Behaviour-rich shapes are driven through their ACTUAL producers/consumers
 *     (the api-keys helpers, the security-access helpers + typeGuards, the
 *     My-Activity analytics reducer, and the `camelCaseKeys` transport shim) so
 *     the assertions verify the logic that DEPENDS on each field rather than a
 *     hand-typed echo of the interface.
 *   • The remaining transport contracts are locked with typed fixtures plus
 *     runtime checks on their discriminants, `| null` unions, and optional
 *     fields; the changelog re-exports are validated against the real generated
 *     `CHANGELOG` constant (which also proves the `export type … from …`
 *     re-export path in admin.ts resolves).
 *
 * No network, no DOM state — pure structural + producer assertions, so no
 * MSW/QueryClient harness is needed.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import { camelCaseKeys } from '@/lib/resilience';
import { asNonEmptyString, asBoolean, asFiniteNumber } from '@/lib/typeGuards';
import { isKeyExpired, isRecentlyUsed, summarizeKeys } from '@/features/admin/components/api-keys/helpers';
import {
  PERMISSION_ORDER,
  PERMISSION_META,
  FALLBACK_PERMISSION_META,
  permissionMeta,
  type ApiKeyPermission,
} from '@/features/admin/components/api-keys/constants';
import {
  parseWindowState,
  doorClosed,
  allWindowsClosed,
  isSentryActive,
  computeSecurityStats,
  deriveTimeline,
  buildSentryBuckets,
  computeSentryUptime,
  findLastLockChange,
} from '@/features/admin/components/security-access/helpers';
import { deriveMyActivityAnalytics } from '@/features/system/components/my-activity/myActivityAnalytics';
import { CHANGELOG } from '@/generated/changelog';

import type {
  APIKey,
  APICallLog,
  APICallLogStats,
  BackupConfig,
  BackupRun,
  ComponentStatus,
  SystemHealthComponent,
  SystemHealth,
  MaintenanceState,
  MaintenanceUpdateInput,
  AuditLogEntry,
  WebErrorsSummaryEntry,
  WebErrorsSummary,
  UserActivityEntry,
  SecurityEvent,
  TableInfo,
  DBStats,
  MigrationInfo,
  MigrationStatus,
  ConnectionPool,
  ExportJob,
  VehicleState,
  StateTransition,
  Alert,
  AlertRule,
  AlertRuleSeverity,
  AlertRuleOp,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
  ChatMessage,
  RoadmapItem,
  RoadmapPhase,
  ChangelogEntry,
  ChangelogChange,
  ChangelogChangeType,
  ChangelogBadge,
} from '@/types/admin';

const NOW = Date.parse('2025-01-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

/* ══════════════════════════════════════════════════════════════════════════
 *  APIKey — driven through the api-keys helpers/constants that consume it
 * ══════════════════════════════════════════════════════════════════════════ */

function makeKey(overrides: Partial<APIKey> = {}): APIKey {
  return {
    id: 'k1',
    name: 'CI token',
    keyPrefix: 'tsk_ab12',
    permissions: 'read',
    createdAt: iso(NOW - 30 * DAY),
    lastUsedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('APIKey (via isKeyExpired / isRecentlyUsed)', () => {
  it('treats a null expiry as never-expiring and a past expiry as expired', () => {
    expect(isKeyExpired(makeKey({ expiresAt: null }), NOW)).toBe(false);
    expect(isKeyExpired(makeKey({ expiresAt: iso(NOW - DAY) }), NOW)).toBe(true);
    expect(isKeyExpired(makeKey({ expiresAt: iso(NOW + DAY) }), NOW)).toBe(false);
  });

  it('classifies recent use only inside the rolling window', () => {
    expect(isRecentlyUsed(makeKey({ lastUsedAt: null }), undefined, NOW)).toBe(false);
    expect(isRecentlyUsed(makeKey({ lastUsedAt: iso(NOW - DAY) }), undefined, NOW)).toBe(true);
    expect(isRecentlyUsed(makeKey({ lastUsedAt: iso(NOW - 10 * DAY) }), undefined, NOW)).toBe(false);
  });

  it('summarizes a mixed key list across every permission level', () => {
    const keys: APIKey[] = [
      makeKey({ id: 'k1', permissions: 'read', expiresAt: null, lastUsedAt: iso(NOW - DAY) }),
      makeKey({ id: 'k2', permissions: 'admin', expiresAt: iso(NOW - DAY), lastUsedAt: null }),
      makeKey({ id: 'k3', permissions: 'read-write', expiresAt: iso(NOW + DAY), lastUsedAt: iso(NOW - 10 * DAY) }),
    ];

    expect(summarizeKeys(keys, NOW)).toEqual({
      total: 3,
      active: 2,
      expired: 1,
      admin: 1,
      recentlyUsed: 1,
      byPermission: { read: 1, 'read-write': 1, admin: 1 },
    });
  });

  it('tolerates an empty list without NaN / Infinity', () => {
    const summary = summarizeKeys([], NOW);
    expect(summary.total).toBe(0);
    expect(summary.byPermission).toEqual({ read: 0, 'read-write': 0, admin: 0 });
  });

  it('exposes the three permission levels the union documents', () => {
    expect(PERMISSION_ORDER).toEqual(['read', 'read-write', 'admin']);
    expect(permissionMeta('read').labelFallback).toBe('Read');
    // An API-supplied string outside the union falls back safely.
    expect(permissionMeta('totally-unknown')).toBe(FALLBACK_PERMISSION_META);
    expect(FALLBACK_PERMISSION_META).toBe(PERMISSION_META.read);
    expectTypeOf<APIKey['permissions']>().toEqualTypeOf<ApiKeyPermission>();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  SecurityEvent — the mixed `string | boolean | null` unions, driven through
 *  the security-access helpers + the canonical typeGuards that narrow them.
 * ══════════════════════════════════════════════════════════════════════════ */

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: '1',
    locked: true,
    sentryMode: 'SentryModeStateOff',
    doorState: 'closed',
    fdWindow: 'closed',
    fpWindow: 'closed',
    rdWindow: 'closed',
    rpWindow: 'closed',
    homelinkNearby: false,
    guestMode: false,
    homelinkDeviceCount: 0,
    guestModeMobileAccessState: null,
    driverSeatOccupied: false,
    centerDisplay: 'off',
    speedLimitMode: false,
    valetModeEnabled: false,
    serviceMode: false,
    pairedPhoneKeyCount: 2,
    lightsHazardsActive: false,
    lightsHighBeams: false,
    lightsTurnSignal: null,
    driverSeatBelt: 'Buckled',
    passengerSeatBelt: 'Unbuckled',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SecurityEvent window/door/sentry unions', () => {
  it('parseWindowState narrows strings but survives a boolean-in-string field', () => {
    expect(parseWindowState('closed')).toBe('Closed');
    expect(parseWindowState('0')).toBe('Closed');
    expect(parseWindowState('WindowStateVenting')).toBe('Venting');
    expect(parseWindowState('open')).toBe('Open');
    // The whole reason these fields are typed `string | boolean | null`: a raw
    // boolean must NOT crash `.toLowerCase()` — it degrades to 'Unknown'.
    expect(parseWindowState(false)).toBe('Unknown');
    expect(parseWindowState(true)).toBe('Unknown');
    expect(parseWindowState(null)).toBe('Unknown');
  });

  it('doorClosed accepts bool / number / string / object door signals', () => {
    expect(doorClosed(null)).toBe(true);
    expect(doorClosed(false)).toBe(true);
    expect(doorClosed(true)).toBe(false);
    expect(doorClosed(0)).toBe(true);
    expect(doorClosed('closed')).toBe(true);
    expect(doorClosed('open')).toBe(false);
  });

  it('isSentryActive reads native bool and string enum values', () => {
    expect(isSentryActive(true)).toBe(true);
    expect(isSentryActive(false)).toBe(false);
    expect(isSentryActive('SentryModeStateOff')).toBe(false);
    expect(isSentryActive('SentryModeStateArmed')).toBe(true);
    expect(isSentryActive(null)).toBe(false);
  });

  it('allWindowsClosed only when every window narrows to Closed', () => {
    expect(allWindowsClosed(makeEvent())).toBe(true);
    expect(allWindowsClosed(makeEvent({ fdWindow: 'open' }))).toBe(false);
    expect(allWindowsClosed(undefined)).toBe(true);
  });

  it('computeSecurityStats aggregates lock/door/window/homelink/guest counts', () => {
    const history: SecurityEvent[] = [
      makeEvent({ id: '1', locked: true, doorState: 'closed', homelinkNearby: false, guestMode: true, createdAt: '2024-01-01T00:00:00Z' }),
      makeEvent({ id: '2', locked: false, doorState: 'open', fdWindow: 'open', homelinkNearby: true, guestMode: false, createdAt: '2024-01-01T01:00:00Z' }),
    ];

    expect(computeSecurityStats(history)).toEqual({
      lockEvents: 1,
      doorOpenCount: 1,
      windowOpenCount: 1,
      homelinkCount: 1,
      guestCount: 1,
      total: 2,
    });
    // An empty history is a distinct "no data" state, not a zeroed object.
    expect(computeSecurityStats([])).toBeNull();
  });

  it('deriveTimeline emits a semantic lock event with the right variant', () => {
    const events: SecurityEvent[] = [
      makeEvent({ id: '1', locked: true, createdAt: '2024-01-01T00:00:00Z' }),
      makeEvent({ id: '2', locked: false, createdAt: '2024-01-01T01:00:00Z' }),
    ];
    const timeline = deriveTimeline(events);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].kind).toBe('lock');
    expect(timeline[0].id).toBe('lock-2');
    expect(timeline[0].variant).toBe('negative'); // unlocked => negative
    expect(deriveTimeline([])).toEqual([]);
  });

  it('buildSentryBuckets / computeSentryUptime split a day by sentry state', () => {
    const events: SecurityEvent[] = [
      makeEvent({ id: '1', sentryMode: 'SentryModeStateArmed', createdAt: '2024-01-01T00:00:00Z' }),
      makeEvent({ id: '2', sentryMode: 'SentryModeStateOff', createdAt: '2024-01-01T06:00:00Z' }),
    ];

    expect(buildSentryBuckets(events)).toEqual([{ date: '2024-01-01', sentryOn: 1, sentryOff: 1 }]);
    expect(computeSentryUptime(events)).toBe(50);
    expect(computeSentryUptime([])).toBe(0);
  });

  it('findLastLockChange returns the timestamp preceding the first toggle', () => {
    const events: SecurityEvent[] = [
      makeEvent({ id: '1', locked: true, createdAt: '2024-01-01T00:00:00Z' }),
      makeEvent({ id: '2', locked: false, createdAt: '2024-01-01T01:00:00Z' }),
    ];
    expect(findLastLockChange(events)).toBe('2024-01-01T00:00:00Z');
    expect(findLastLockChange([])).toBeUndefined();
  });
});

describe('SecurityEvent typeGuards (canonical narrowers)', () => {
  it('asNonEmptyString keeps only non-empty strings', () => {
    expect(asNonEmptyString('closed')).toBe('closed');
    expect(asNonEmptyString('')).toBeNull();
    expect(asNonEmptyString(true)).toBeNull();
    expect(asNonEmptyString(null)).toBeNull();
  });

  it('asBoolean / asFiniteNumber reject the wrong runtime kind', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean('true')).toBeNull();
    expect(asFiniteNumber(3)).toBe(3);
    expect(asFiniteNumber(Number.NaN)).toBeNull();
    expect(asFiniteNumber('3')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  UserActivityEntry — driven through deriveMyActivityAnalytics
 * ══════════════════════════════════════════════════════════════════════════ */

function makeActivity(overrides: Partial<UserActivityEntry> = {}): UserActivityEntry {
  return {
    id: 1,
    ts: '2024-04-04T10:00:00Z',
    action: 'login',
    entity_type: 'vehicle',
    entity_id: '1',
    detail: null,
    ip: null,
    user_agent: null,
    ...overrides,
  };
}

describe('UserActivityEntry (via deriveMyActivityAnalytics)', () => {
  it('null / undefined payload yields an all-empty analytics object', () => {
    const analytics = deriveMyActivityAnalytics(null, null);

    expect(analytics.kpis.total).toBe(0);
    expect(analytics.kpis.actionTypes).toBe(0);
    expect(analytics.kpis.entitiesTouched).toBe(0);
    expect(analytics.kpis.lastActivityTs).toBeNull();
    expect(analytics.topActions).toEqual([]);
    expect(analytics.byCategory).toEqual([]);
    expect(analytics.byHour).toHaveLength(24);
  });

  it('derives KPIs, top actions and categories from real entries', () => {
    const entries: UserActivityEntry[] = [
      makeActivity({ id: 1, ts: '2024-04-04T10:00:00Z', action: 'login', entity_type: 'vehicle', entity_id: '1' }),
      makeActivity({ id: 2, ts: '2024-04-04T14:00:00Z', action: 'login', entity_type: 'charging_session', entity_id: '5' }),
    ];
    const analytics = deriveMyActivityAnalytics(entries, null);

    expect(analytics.kpis.total).toBe(2);
    expect(analytics.kpis.actionTypes).toBe(1); // both "login"
    expect(analytics.kpis.entitiesTouched).toBe(2); // vehicle:1 + charging_session:5
    expect(analytics.kpis.lastActivityTs).toBe('2024-04-04T14:00:00Z');
    expect(analytics.topActions[0]).toMatchObject({ key: 'login', count: 2, percent: 100 });
    expect(analytics.byCategory.map((s) => s.key).sort()).toEqual(['charging_session', 'vehicle']);
  });

  it('null entity_type is bucketed as "other", not a distinct entity', () => {
    const analytics = deriveMyActivityAnalytics([makeActivity({ entity_type: null, entity_id: null })], null);
    expect(analytics.kpis.entitiesTouched).toBe(0);
    expect(analytics.byCategory[0].key).toBe('__other__');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Transport dual-shape (snake_case wire -> camelCaseKeys) contracts
 * ══════════════════════════════════════════════════════════════════════════ */

describe('WebErrorsSummary (camelCaseKeys dual shape)', () => {
  it('exposes both snake_case and camelCase keys after transform', () => {
    const entry: WebErrorsSummaryEntry = { name: 'TypeError', route: '/drives', count: 3 };
    const wire = { window_seconds: 3600, total: 5, top: [entry], as_of: '2024-01-01T00:00:00Z' };

    const summary = camelCaseKeys(wire) as unknown as WebErrorsSummary;

    expect(summary.window_seconds).toBe(3600);
    expect(summary.windowSeconds).toBe(3600);
    expect(summary.as_of).toBe('2024-01-01T00:00:00Z');
    expect(summary.asOf).toBe('2024-01-01T00:00:00Z');
    expect(summary.total).toBe(5);
    expect(summary.top).toHaveLength(1);
    expect(summary.top[0]).toEqual({ name: 'TypeError', route: '/drives', count: 3 });
  });
});

describe('APICallLogStats (mixed camel scalars + snake maps)', () => {
  it('maps snake wire to the camel scalars while preserving snake breakdown maps', () => {
    const wire = {
      total_calls: 1000,
      error_rate: 2.5,
      avg_duration_ms: 42,
      last_24h: 120,
      error_count: 25,
      by_method: { GET: 800, POST: 200 },
      by_service: { fleet: 700, telemetry: 300 },
    };

    const stats = camelCaseKeys(wire) as unknown as APICallLogStats;

    // Scalars are read camelCase by TeslaApiUsageCard.
    expect(stats.totalCalls).toBe(1000);
    expect(stats.errorRate).toBe(2.5);
    expect(stats.avgDurationMs).toBe(42);
    expect(stats.last24h).toBe(120);
    expect(stats.errorCount).toBe(25);
    // Grouped breakdowns are read snake_case and must survive untouched.
    expect(stats.by_method).toEqual({ GET: 800, POST: 200 });
    expect(stats.by_service).toEqual({ fleet: 700, telemetry: 300 });
  });
});

describe('MaintenanceState / MaintenanceUpdateInput', () => {
  it('preserves the snake_case maintenance fields the FE reads', () => {
    const wire = {
      mode: 'maintenance',
      maintenance_message: 'Upgrading TimescaleDB',
      maintenance_until: '2024-01-01T02:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      updated_by: 'admin@teslasync',
      source: 'db',
      env_override_mode: '',
    };

    const state = camelCaseKeys(wire) as unknown as MaintenanceState;

    expect(state.mode).toBe('maintenance');
    expect(state.maintenance_message).toBe('Upgrading TimescaleDB');
    expect(state.maintenance_until).toBe('2024-01-01T02:00:00Z');
    expect(state.source).toBe('db');
  });

  it('MaintenanceUpdateInput accepts a null "until" clear-request', () => {
    const clear: MaintenanceUpdateInput = { mode: 'ok', message: undefined, until: null };
    const schedule: MaintenanceUpdateInput = { mode: 'degraded', message: 'Slow', until: '2024-01-01T02:00:00Z' };

    expect(clear.mode).toBe('ok');
    expect(clear.until).toBeNull();
    expect(schedule.until).toBe('2024-01-01T02:00:00Z');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  SystemHealth + ComponentStatus (extensible status union)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('SystemHealth / SystemHealthComponent / ComponentStatus', () => {
  it('carries a per-component status map and the maintenance banner fields', () => {
    const db: SystemHealthComponent = { status: 'healthy', consecutiveFailures: 0, lastError: null, details: {} };
    const tesla: SystemHealthComponent = {
      status: 'unknown',
      consecutiveFailures: 3,
      lastError: 'timeout',
      details: { last_check: 0 },
    };
    const health: SystemHealth = {
      status: 'degraded',
      components: { db, tesla_api: tesla },
      databaseSize: '1.2 GB',
      tableCount: 42,
      mode: 'maintenance',
      maintenance_message: 'Nightly vacuum',
      maintenance_until: '2024-01-01T02:00:00Z',
      maintenance_updated_at: '2024-01-01T00:00:00Z',
      source: 'env',
    };

    expect(health.status).toBe('degraded');
    expect(health.components.db.status).toBe('healthy');
    expect(health.components.tesla_api.consecutiveFailures).toBe(3);
    expect(health.tableCount).toBe(42);
    expect(health.mode).toBe('maintenance');
    expect(health.source).toBe('env');
  });

  it('ComponentStatus keeps literal autocomplete yet accepts new backend keys', () => {
    const canonical: ComponentStatus = 'healthy';
    const legacy: ComponentStatus = 'ok';
    // The `(string & {})` fallback lets a brand-new status flow through without
    // a coordinated FE/BE type migration.
    const future: ComponentStatus = 'rehydrating';

    expect(canonical).toBe('healthy');
    expect(legacy).toBe('ok');
    expect(future).toBe('rehydrating');
    expectTypeOf<SystemHealthComponent['status']>().toEqualTypeOf<ComponentStatus>();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Alerts — the two intentionally-divergent severity unions + the op union
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Alert / AlertRule severity + operator unions', () => {
  it('Alert.severity is the {info,warning,critical} set', () => {
    const alert: Alert = {
      id: 'a1',
      title: 'Low battery',
      message: 'SoC below 20%',
      severity: 'warning',
      type: 'battery',
      isRead: false,
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(['info', 'warning', 'critical']).toContain(alert.severity);
    expect(alert.isRead).toBe(false);
  });

  it('AlertRule.severity uses "warn" (NOT "warning") and supports range ops', () => {
    const rule: AlertRule = {
      id: 1,
      name: 'Cabin overheat',
      description: null,
      enabled: true,
      vehicle_id: null,
      signal_name: 'inside_temp_c',
      op: 'between',
      value_num: null,
      value_text: null,
      value_bool: null,
      value_min: 40,
      value_max: 60,
      severity: 'warn',
      cooldown_min: 15,
      msg_template: null,
      include_title: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    expect(rule.severity).toBe('warn');
    expect(['info', 'warn', 'critical']).toContain(rule.severity);
    expect(rule.op).toBe('between');
    expect(rule.value_min).toBe(40);
    expect(rule.value_max).toBe(60);
    // The two severity unions are deliberately different — document it in types.
    const ruleSev: AlertRuleSeverity = 'warn';
    const alertOp: AlertRuleOp = 'outside';
    expect(ruleSev).toBe('warn');
    expect(['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']).toContain(alertOp);
    expectTypeOf<AlertRule['severity']>().toEqualTypeOf<AlertRuleSeverity>();
    expectTypeOf<AlertRule['op']>().toEqualTypeOf<AlertRuleOp>();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Notifications
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Notification contracts', () => {
  it('NotificationChannel type is one of the seven transports', () => {
    const channel: NotificationChannel = {
      id: 'c1',
      name: 'Ops Discord',
      type: 'discord',
      config: { webhook_url: 'https://discord/x' },
      enabled: true,
    };
    expect(['discord', 'slack', 'telegram', 'email', 'webhook', 'ntfy', 'pushover']).toContain(channel.type);
    expect(channel.config.webhook_url).toContain('discord');
  });

  it('NotificationLog status + NotificationStats counters', () => {
    const log: NotificationLog = { id: 'l1', status: 'sent', channelId: 'c1', title: 'Charge complete', createdAt: '2024-01-01T00:00:00Z' };
    const stats: NotificationStats = { sent: 10, failed: 2, pending: 1, enabledChannels: 3, totalChannels: 4 };

    expect(['sent', 'failed', 'pending']).toContain(log.status);
    expect(stats.sent + stats.failed + stats.pending).toBe(13);
    expect(stats.enabledChannels).toBeLessThanOrEqual(stats.totalChannels);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Database / migration / pool
 * ══════════════════════════════════════════════════════════════════════════ */

describe('DB inspection contracts', () => {
  it('TableInfo allows a null lastVacuum; DBStats nests the rows', () => {
    const never: TableInfo = { name: 'signal_log', schema: 'public', rowCount: 9_000_000, sizeBytes: 5_000_000, indexCount: 3, lastVacuum: null };
    const vacuumed: TableInfo = { ...never, name: 'drives', lastVacuum: '2024-01-01T00:00:00Z' };
    const stats: DBStats = { tables: [never, vacuumed], tableCount: 2, databaseSize: '5 GB' };

    expect(never.lastVacuum).toBeNull();
    expect(vacuumed.lastVacuum).toBe('2024-01-01T00:00:00Z');
    expect(stats.tables).toHaveLength(2);
    expect(stats.tables[0].name).toBe('signal_log');
  });

  it('MigrationStatus surfaces the dirty flag and pending count', () => {
    const applied: MigrationInfo = { version: '000185', name: 'si_canonical', appliedAt: '2024-01-01T00:00:00Z' };
    const status: MigrationStatus = { currentVersion: '000185', dirty: false, pending: 2, migrations: [applied] };

    expect(status.dirty).toBe(false);
    expect(status.pending).toBe(2);
    expect(status.migrations[0].version).toBe('000185');
  });

  it('ConnectionPool exposes the pgx pool gauges', () => {
    const pool: ConnectionPool = { maxOpen: 25, open: 8, inUse: 3, idle: 5, waitCount: 0, waitDurationMs: 0 };
    expect(pool.inUse + pool.idle).toBe(pool.open);
    expect(pool.open).toBeLessThanOrEqual(pool.maxOpen);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Export / vehicle-state / api-log / backup / audit / chat
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Operational record contracts', () => {
  it('ExportJob discriminants with nullable counts', () => {
    const job: ExportJob = { id: 'e1', type: 'drives', format: 'csv', status: 'ready', recordCount: null, fileSize: null, createdAt: '2024-01-01T00:00:00Z' };
    expect(['drives', 'charging', 'analytics', 'backup']).toContain(job.type);
    expect(['csv', 'json']).toContain(job.format);
    expect(['queued', 'processing', 'ready', 'failed']).toContain(job.status);
    expect(job.recordCount).toBeNull();
  });

  it('VehicleState + StateTransition timeline row', () => {
    const state: VehicleState = { state: 'driving', since: '2024-01-01T00:00:00Z', vehicleId: '7' };
    const transition: StateTransition = { state: 'charging', startedAt: '2024-01-01T00:00:00Z', endedAt: null, durationSeconds: 1800 };
    expect(state.vehicleId).toBe('7');
    expect(transition.endedAt).toBeNull();
    expect(transition.durationSeconds).toBe(1800);
  });

  it('APICallLog keeps nullable request/response/error bodies', () => {
    const call: APICallLog = {
      id: 'req1',
      method: 'GET',
      url: '/api/v1/vehicles',
      statusCode: 200,
      durationMs: 12,
      requestBody: null,
      responseBody: '[]',
      error: null,
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(call.statusCode).toBe(200);
    expect(call.requestBody).toBeNull();
    expect(call.error).toBeNull();
  });

  it('BackupConfig + BackupRun provider/status unions', () => {
    const config: BackupConfig = {
      id: 'b1',
      name: 'Nightly',
      enabled: true,
      backupType: 'full',
      frequencyDays: 1,
      maxRetention: 7,
      provider: 's3',
      providerConfig: { bucket: 'ts-backups' },
      compress: true,
      encrypt: true,
      lastRunAt: null,
      nextRunAt: '2024-01-02T00:00:00Z',
    };
    const run: BackupRun = { id: 'r1', configId: 'b1', status: 'completed', backupType: 'full', fileSize: 1024, createdAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:05:00Z', durationMs: 300000 };

    expect(['full', 'incremental']).toContain(config.backupType);
    expect(['local', 's3', 'azure', 'gcs']).toContain(config.provider);
    expect(config.providerConfig.bucket).toBe('ts-backups');
    expect(['completed', 'failed', 'running', 'queued']).toContain(run.status);
    expect(run.durationMs).toBe(300000);
  });

  it('AuditLogEntry + ChatMessage role', () => {
    const audit: AuditLogEntry = { id: 'au1', action: 'delete', resource: 'api_key', details: 'k2', createdAt: '2024-01-01T00:00:00Z' };
    const message: ChatMessage = { id: 'm1', sessionId: 's1', role: 'assistant', content: 'Hi', createdAt: '2024-01-01T00:00:00Z' };
    expect(audit.action).toBe('delete');
    expect(['user', 'assistant']).toContain(message.role);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  Roadmap + Changelog re-exports (validated against the real generated data)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('RoadmapItem / RoadmapPhase', () => {
  it('phase is one of the four lifecycle stages', () => {
    const item: RoadmapItem = { title: 'SI cutover', description: 'Canonical units', phase: 'current', features: ['drives', 'charging'] };
    const phases: RoadmapPhase[] = ['done', 'current', 'next', 'future'];
    expect(phases).toContain(item.phase);
    expect(item.features).toHaveLength(2);
  });
});

describe('Changelog types re-exported through @/types/admin', () => {
  it('the real CHANGELOG conforms to the re-exported ChangelogEntry shape', () => {
    expect(Array.isArray(CHANGELOG)).toBe(true);
    expect(CHANGELOG.length).toBeGreaterThan(0);

    const entry: ChangelogEntry = CHANGELOG[0];
    const badges: ChangelogBadge[] = ['latest', 'stable', 'beta'];
    const types: ChangelogChangeType[] = ['added', 'changed', 'fixed', 'removed', 'deprecated', 'security'];

    expect(typeof entry.version).toBe('string');
    expect(typeof entry.date).toBe('string');
    expect(badges).toContain(entry.badge);
    expect(Array.isArray(entry.changes)).toBe(true);

    for (const e of CHANGELOG) {
      for (const change of e.changes) {
        const c: ChangelogChange = change;
        expect(types).toContain(c.type);
        expect(typeof c.text).toBe('string');
      }
    }
  });
});
