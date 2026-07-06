/**
 * Contract + behaviour coverage for the notification channel type module.
 *
 * `notifications.ts` is mostly declarative, but it now also carries two pieces
 * of live behaviour the Channels feature leans on:
 *
 *   - `NOTIFICATION_CHANNEL_KINDS` — the canonical, ordered runtime list of
 *     every supported provider (the single source of truth the union derives
 *     from), and
 *   - `isNotificationChannelKind`  — the boundary guard that validates an
 *     untrusted `kind` before it is trusted as a discriminant.
 *
 * These tests lock the runtime list to its seven members, exercise every
 * branch of the guard (accept / reject / non-string / narrowing), and pin a
 * representative fixture for each channel interface so an incompatible field
 * change trips both the runtime assertions here and `tsc`. A local
 * `primaryEndpoint` switch additionally proves the discriminated union narrows
 * correctly for every declared kind and that the fixture set is exhaustive.
 */

import { describe, it, expect } from 'vitest';

import {
  NOTIFICATION_CHANNEL_KINDS,
  isNotificationChannelKind,
} from './notifications';
import type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationChannelBase,
  NotificationChannelDiscord,
  NotificationChannelSlack,
  NotificationChannelTelegram,
  NotificationChannelEmail,
  NotificationChannelWebhook,
  NotificationChannelNtfy,
  NotificationChannelPushover,
} from './notifications';

// ── Representative fixtures — one per interface ────────────────────────────
// Explicitly typed (not `satisfies`) so excess-property checking applies and
// every exported interface is referenced.

const base: NotificationChannelBase = {
  id: 1,
  name: 'Ops',
  kind: 'discord',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
};

const discord: NotificationChannelDiscord = {
  id: 1,
  name: 'Ops Discord',
  kind: 'discord',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  webhook_url: 'https://discord.com/api/webhooks/abc',
  username: null,
  avatar_url: null,
};

const slack: NotificationChannelSlack = {
  id: 2,
  name: 'Slack',
  kind: 'slack',
  enabled: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  webhook_url: 'https://hooks.slack.com/services/xyz',
  channel: '#alerts',
  username: 'teslasync',
};

const telegram: NotificationChannelTelegram = {
  id: 3,
  name: 'Telegram',
  kind: 'telegram',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  bot_token: '123456:ABC-DEF',
  chat_id: '-1001234567890',
};

const email: NotificationChannelEmail = {
  id: 4,
  name: 'Email',
  kind: 'email',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_username: 'alerts@example.com',
  smtp_password: 's3cret',
  from_address: 'alerts@example.com',
  to_addresses: ['you@example.com', 'ops@example.com'],
  use_tls: true,
};

const webhook: NotificationChannelWebhook = {
  id: 5,
  name: 'Webhook',
  kind: 'webhook',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  url: 'https://example.com/hook',
  method: 'POST',
  headers: { Authorization: 'Bearer token' },
  body_template: '{"text":"{{message}}"}',
};

const ntfy: NotificationChannelNtfy = {
  id: 6,
  name: 'ntfy',
  kind: 'ntfy',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  server_url: 'https://ntfy.sh',
  topic: 'teslasync',
  priority: 3,
  username: null,
  password: null,
};

const pushover: NotificationChannelPushover = {
  id: 7,
  name: 'Pushover',
  kind: 'pushover',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  user_key: 'u1v2w3',
  app_token: 'a1b2c3',
  device: null,
  priority: 0,
};

const channels: NotificationChannel[] = [
  discord,
  slack,
  telegram,
  email,
  webhook,
  ntfy,
  pushover,
];

/**
 * Exercises the discriminated union: narrowing on `ch.kind` must expose the
 * kind-specific fields with no casts. The `never` default keeps the switch
 * provably exhaustive.
 */
function primaryEndpoint(ch: NotificationChannel): string {
  switch (ch.kind) {
    case 'discord':
      return ch.webhook_url;
    case 'slack':
      return ch.webhook_url;
    case 'telegram':
      return ch.chat_id;
    case 'email':
      return ch.from_address;
    case 'webhook':
      return ch.url;
    case 'ntfy':
      return `${ch.server_url}/${ch.topic}`;
    case 'pushover':
      return ch.user_key;
    default: {
      const _exhaustive: never = ch;
      return _exhaustive;
    }
  }
}

describe('NOTIFICATION_CHANNEL_KINDS', () => {
  it('enumerates exactly the seven supported providers in declared order', () => {
    expect(NOTIFICATION_CHANNEL_KINDS).toEqual([
      'discord',
      'slack',
      'telegram',
      'email',
      'webhook',
      'ntfy',
      'pushover',
    ]);
    expect(NOTIFICATION_CHANNEL_KINDS).toHaveLength(7);
  });

  it('has no duplicate entries', () => {
    const unique = new Set<string>(NOTIFICATION_CHANNEL_KINDS);
    expect(unique.size).toBe(NOTIFICATION_CHANNEL_KINDS.length);
  });

  it('contains each individually addressable provider', () => {
    expect(NOTIFICATION_CHANNEL_KINDS).toContain('discord');
    expect(NOTIFICATION_CHANNEL_KINDS).toContain('email');
    expect(NOTIFICATION_CHANNEL_KINDS).toContain('webhook');
    expect(NOTIFICATION_CHANNEL_KINDS).toContain('pushover');
  });
});

describe('isNotificationChannelKind', () => {
  it.each([...NOTIFICATION_CHANNEL_KINDS])('accepts the canonical kind "%s"', (kind) => {
    expect(isNotificationChannelKind(kind)).toBe(true);
  });

  it('rejects unknown, adjacent, or mis-cased strings', () => {
    expect(isNotificationChannelKind('sms')).toBe(false);
    expect(isNotificationChannelKind('push')).toBe(false);
    expect(isNotificationChannelKind('')).toBe(false);
    // guard is intentionally case-sensitive — the API emits lowercase kinds.
    expect(isNotificationChannelKind('Discord')).toBe(false);
    // and does not trim — a padded value is not a valid discriminant.
    expect(isNotificationChannelKind(' discord ')).toBe(false);
  });

  it('rejects non-string input without throwing', () => {
    expect(isNotificationChannelKind(null)).toBe(false);
    expect(isNotificationChannelKind(undefined)).toBe(false);
    expect(isNotificationChannelKind(0)).toBe(false);
    expect(isNotificationChannelKind(3)).toBe(false);
    expect(isNotificationChannelKind(true)).toBe(false);
    expect(isNotificationChannelKind({})).toBe(false);
    expect(isNotificationChannelKind([])).toBe(false);
    expect(isNotificationChannelKind(['discord'])).toBe(false);
  });

  it('narrows an unknown value so it can drive a typed assignment', () => {
    const raw: unknown = 'webhook';
    expect(isNotificationChannelKind(raw)).toBe(true);
    if (isNotificationChannelKind(raw)) {
      const narrowed: NotificationChannelKind = raw;
      expect(narrowed).toBe('webhook');
    }
  });

  it('filters a mixed payload list down to valid kinds only', () => {
    const incoming: unknown[] = ['discord', 'sms', 42, null, 'ntfy', 'Discord'];
    const valid = incoming.filter(isNotificationChannelKind);
    expect(valid).toEqual(['discord', 'ntfy']);
  });
});

describe('channel interface contracts', () => {
  it('models a base channel with the shared identity/audit fields', () => {
    expect(base.id).toBe(1);
    expect(base.enabled).toBe(true);
    expect(isNotificationChannelKind(base.kind)).toBe(true);
    expect(base.created_at).toBe('2024-01-01T00:00:00Z');
  });

  it('models a Discord webhook channel with nullable presentation fields', () => {
    expect(discord.kind).toBe('discord');
    expect(discord.webhook_url).toContain('discord.com');
    // username / avatar_url are explicitly nullable, not optional.
    expect(discord.username).toBeNull();
    expect(discord.avatar_url).toBeNull();
  });

  it('models a Slack channel that carries a target channel + display name', () => {
    expect(slack.kind).toBe('slack');
    expect(slack.channel).toBe('#alerts');
    expect(slack.username).toBe('teslasync');
    expect(slack.enabled).toBe(false);
  });

  it('models a Telegram channel keyed by bot token + chat id', () => {
    expect(telegram.kind).toBe('telegram');
    expect(telegram.bot_token).toContain(':');
    expect(telegram.chat_id).toBe('-1001234567890');
  });

  it('models an Email channel with a numeric port and a typed recipient list', () => {
    expect(email.smtp_port).toBe(587);
    expect(typeof email.smtp_port).toBe('number');
    expect(email.to_addresses).toHaveLength(2);
    expect(email.to_addresses).toEqual(['you@example.com', 'ops@example.com']);
    expect(email.use_tls).toBe(true);
  });

  it('constrains a Webhook channel to an allowed HTTP method + header map', () => {
    expect(['GET', 'POST', 'PUT']).toContain(webhook.method);
    expect(webhook.headers).toEqual({ Authorization: 'Bearer token' });
    expect(webhook.body_template).toContain('{{message}}');
  });

  it('bounds ntfy priority within 1–5 and allows anonymous auth', () => {
    expect(ntfy.priority).toBeGreaterThanOrEqual(1);
    expect(ntfy.priority).toBeLessThanOrEqual(5);
    expect(ntfy.username).toBeNull();
    expect(ntfy.password).toBeNull();
  });

  it('bounds Pushover priority within the -2…2 emergency range', () => {
    expect(pushover.priority).toBeGreaterThanOrEqual(-2);
    expect(pushover.priority).toBeLessThanOrEqual(2);
    expect(pushover.user_key).toBe('u1v2w3');
    expect(pushover.device).toBeNull();
  });
});

describe('NotificationChannel discriminated union', () => {
  it.each(channels)('narrows "$kind" to its kind-specific primary endpoint', (ch) => {
    const endpoint = primaryEndpoint(ch);
    expect(typeof endpoint).toBe('string');
    expect(endpoint.length).toBeGreaterThan(0);
  });

  it('resolves the documented primary endpoint per kind', () => {
    expect(primaryEndpoint(discord)).toBe('https://discord.com/api/webhooks/abc');
    expect(primaryEndpoint(telegram)).toBe('-1001234567890');
    expect(primaryEndpoint(email)).toBe('alerts@example.com');
    expect(primaryEndpoint(webhook)).toBe('https://example.com/hook');
    expect(primaryEndpoint(ntfy)).toBe('https://ntfy.sh/teslasync');
    expect(primaryEndpoint(pushover)).toBe('u1v2w3');
  });

  it('covers every declared kind exactly once (fixtures are exhaustive)', () => {
    const fixtureKinds = channels.map((ch) => ch.kind).sort();
    expect(fixtureKinds).toEqual([...NOTIFICATION_CHANNEL_KINDS].sort());
    for (const ch of channels) {
      expect(isNotificationChannelKind(ch.kind)).toBe(true);
    }
  });
});
