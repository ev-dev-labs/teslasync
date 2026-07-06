/**
 * Behavioural coverage for the Channels metadata + payload helpers.
 *
 * Exercises every runtime export of `channelMeta.ts`:
 *   - CHANNEL_TYPES / FIELD_HELP catalog integrity + cross-consistency
 *   - getChannelMeta (each kind + the webhook fallback for unknown kinds)
 *   - isSecretField (secret vs. plaintext classification + the password-field
 *     invariant)
 *   - channelToFormConfig (every kind branch, null-safety, corrupt-kind guard)
 *   - buildChannelPayload (every kind branch, id inclusion, and the two hardened
 *     edge cases: blank/negative SMTP port and array-shaped webhook headers)
 */

import { describe, expect, it } from 'vitest';

import type { NotificationChannel } from '@/api/types';
import {
  CHANNEL_TYPES,
  FIELD_HELP,
  buildChannelPayload,
  channelToFormConfig,
  getChannelMeta,
  isSecretField,
  type ChannelType,
} from './channelMeta';

const KNOWN_KINDS: ChannelType[] = [
  'discord', 'slack', 'telegram', 'email', 'webhook', 'ntfy', 'pushover',
];

const FIELD_TYPES = new Set(['url', 'password', 'text', 'email']);

/** Access a discriminated-union payload as a flat record for assertions. */
const asRec = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

/** Fully-typed channel fixtures — one per kind. */
const channels: Record<ChannelType, NotificationChannel> = {
  discord: {
    id: 1, name: 'Ops Discord', kind: 'discord', enabled: true,
    created_at: 'c', updated_at: 'u',
    webhook_url: 'https://discord.com/api/webhooks/abc', username: null, avatar_url: null,
  },
  slack: {
    id: 2, name: 'Slack', kind: 'slack', enabled: true,
    created_at: 'c', updated_at: 'u',
    webhook_url: 'https://hooks.slack.com/services/xyz', channel: null, username: null,
  },
  telegram: {
    id: 3, name: 'TG', kind: 'telegram', enabled: true,
    created_at: 'c', updated_at: 'u',
    bot_token: '123:ABC', chat_id: '-1001',
  },
  email: {
    id: 4, name: 'Email', kind: 'email', enabled: true,
    created_at: 'c', updated_at: 'u',
    smtp_host: 'smtp.example.com', smtp_port: 2525,
    smtp_username: 'alerts@example.com', smtp_password: 's3cret',
    from_address: 'alerts@example.com', to_addresses: ['a@x.com', 'b@y.com'],
    use_tls: true,
  },
  webhook: {
    id: 5, name: 'Hook', kind: 'webhook', enabled: true,
    created_at: 'c', updated_at: 'u',
    url: 'https://example.com/hook', method: 'POST',
    headers: { Authorization: 'Bearer t' }, body_template: '{"text":"{{message}}"}',
  },
  ntfy: {
    id: 6, name: 'ntfy', kind: 'ntfy', enabled: true,
    created_at: 'c', updated_at: 'u',
    server_url: 'https://ntfy.sh', topic: 'teslasync', priority: 3,
    username: null, password: null,
  },
  pushover: {
    id: 7, name: 'Push', kind: 'pushover', enabled: true,
    created_at: 'c', updated_at: 'u',
    user_key: 'u1', app_token: 'a1', device: null, priority: 0,
  },
};

describe('CHANNEL_TYPES catalog', () => {
  it('covers exactly the seven supported kinds with no duplicates', () => {
    const values = CHANNEL_TYPES.map((c) => c.value);
    expect(values).toEqual(KNOWN_KINDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('gives every entry a renderable icon, a hex color, and typed fields', () => {
    for (const meta of CHANNEL_TYPES) {
      expect(typeof meta.label).toBe('string');
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      // lucide icons are forwardRef objects or functions — both are callable/usable.
      expect(meta.icon).toBeTruthy();
      expect(Array.isArray(meta.fields)).toBe(true);
      expect(meta.fields.length).toBeGreaterThan(0);
      for (const f of meta.fields) {
        expect(f.key.length).toBeGreaterThan(0);
        expect(f.i18nKey).toContain('notifications.channels.fields.');
        expect(f.label.length).toBeGreaterThan(0);
        expect(FIELD_TYPES.has(f.type)).toBe(true);
      }
    }
  });

  it('has no duplicate field keys within a single provider', () => {
    for (const meta of CHANNEL_TYPES) {
      const keys = meta.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('FIELD_HELP', () => {
  it('provides an i18n key and non-empty content for every documented field', () => {
    const entries = Object.entries(FIELD_HELP);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, help] of entries) {
      expect(help.i18nKey).toContain('help.fields.channels.');
      expect(help.content.length).toBeGreaterThan(0);
    }
  });

  it('reuses the webhookUrl help copy for both webhook_url and url aliases', () => {
    expect(FIELD_HELP.url.i18nKey).toBe(FIELD_HELP.webhook_url.i18nKey);
    expect(FIELD_HELP.url.content).toBe(FIELD_HELP.webhook_url.content);
  });
});

describe('getChannelMeta', () => {
  it('resolves the correct provider for each known kind', () => {
    expect(getChannelMeta('discord').label).toBe('Discord');
    expect(getChannelMeta('email').value).toBe('email');
    for (const kind of KNOWN_KINDS) {
      expect(getChannelMeta(kind).value).toBe(kind);
    }
  });

  it('falls back to the webhook provider for an unknown or empty kind', () => {
    expect(getChannelMeta('does-not-exist').value).toBe('webhook');
    expect(getChannelMeta('').value).toBe('webhook');
  });
});

describe('isSecretField', () => {
  it('classifies token/key/password fields as secret', () => {
    expect(isSecretField('bot_token')).toBe(true);
    expect(isSecretField('app_token')).toBe(true);
    expect(isSecretField('user_key')).toBe(true);
    expect(isSecretField('smtp_password')).toBe(true);
  });

  it('treats non-credential fields (and empty input) as plaintext', () => {
    expect(isSecretField('webhook_url')).toBe(false);
    expect(isSecretField('chat_id')).toBe(false);
    expect(isSecretField('topic')).toBe(false);
    expect(isSecretField('smtp_host')).toBe(false);
    expect(isSecretField('')).toBe(false);
  });

  it('marks every password-typed catalog field as secret (UI masking invariant)', () => {
    const passwordFields = CHANNEL_TYPES.flatMap((c) => c.fields).filter((f) => f.type === 'password');
    expect(passwordFields.length).toBeGreaterThan(0);
    for (const f of passwordFields) {
      expect(isSecretField(f.key)).toBe(true);
    }
  });
});

describe('channelToFormConfig', () => {
  it('flattens discord/slack webhook channels', () => {
    expect(channelToFormConfig(channels.discord)).toEqual({
      webhook_url: 'https://discord.com/api/webhooks/abc',
    });
    expect(channelToFormConfig(channels.slack)).toEqual({
      webhook_url: 'https://hooks.slack.com/services/xyz',
    });
  });

  it('flattens telegram, ntfy, and pushover credentials', () => {
    expect(channelToFormConfig(channels.telegram)).toEqual({ bot_token: '123:ABC', chat_id: '-1001' });
    expect(channelToFormConfig(channels.ntfy)).toEqual({ server_url: 'https://ntfy.sh', topic: 'teslasync' });
    expect(channelToFormConfig(channels.pushover)).toEqual({ user_key: 'u1', app_token: 'a1' });
  });

  it('stringifies the SMTP port and joins recipients for email', () => {
    const cfg = channelToFormConfig(channels.email);
    expect(cfg.smtp_port).toBe('2525');
    expect(cfg.to_addresses).toBe('a@x.com, b@y.com');
    expect(cfg.smtp_host).toBe('smtp.example.com');
  });

  it('serialises webhook headers to JSON', () => {
    const cfg = channelToFormConfig(channels.webhook);
    expect(cfg.url).toBe('https://example.com/hook');
    expect(JSON.parse(cfg.headers)).toEqual({ Authorization: 'Bearer t' });
  });

  it('tolerates a null recipients list and null headers without throwing', () => {
    const email = { ...channels.email, to_addresses: undefined } as unknown as NotificationChannel;
    expect(channelToFormConfig(email).to_addresses).toBe('');
    const hook = { ...channels.webhook, headers: undefined } as unknown as NotificationChannel;
    expect(channelToFormConfig(hook).headers).toBe('{}');
  });

  it('returns an empty config (never undefined) for a corrupt/unknown kind', () => {
    const corrupt = { ...channels.discord, kind: 'mystery' } as unknown as NotificationChannel;
    expect(channelToFormConfig(corrupt)).toEqual({});
  });
});

describe('buildChannelPayload', () => {
  it('includes an id only when one is supplied', () => {
    const withId = asRec(buildChannelPayload('discord', 'D', true, { webhook_url: 'x' }, 42));
    expect(withId.id).toBe(42);
    const withoutId = asRec(buildChannelPayload('discord', 'D', true, { webhook_url: 'x' }));
    expect('id' in withoutId).toBe(false);
  });

  it('builds discord/slack/telegram payloads with defaults for missing config', () => {
    expect(asRec(buildChannelPayload('discord', 'D', true, {}))).toMatchObject({
      kind: 'discord', name: 'D', enabled: true, webhook_url: '', username: null, avatar_url: null,
    });
    expect(asRec(buildChannelPayload('slack', 'S', false, {}))).toMatchObject({
      kind: 'slack', enabled: false, webhook_url: '', channel: null, username: null,
    });
    expect(asRec(buildChannelPayload('telegram', 'T', true, { bot_token: 'b' }))).toMatchObject({
      kind: 'telegram', bot_token: 'b', chat_id: '',
    });
  });

  it('parses a valid SMTP port and splits/trims recipients', () => {
    const p = asRec(buildChannelPayload('email', 'E', true, {
      smtp_port: '465', to_addresses: 'a@x.com, b@y.com,',
    }));
    expect(p.smtp_port).toBe(465);
    expect(p.to_addresses).toEqual(['a@x.com', 'b@y.com']);
    expect(p.use_tls).toBe(true);
  });

  it('falls back to port 587 for blank, non-numeric, negative, or missing ports', () => {
    expect(asRec(buildChannelPayload('email', 'E', true, { smtp_port: '' })).smtp_port).toBe(587);
    expect(asRec(buildChannelPayload('email', 'E', true, { smtp_port: 'abc' })).smtp_port).toBe(587);
    expect(asRec(buildChannelPayload('email', 'E', true, { smtp_port: '-1' })).smtp_port).toBe(587);
    expect(asRec(buildChannelPayload('email', 'E', true, {})).smtp_port).toBe(587);
  });

  it('normalises the webhook method and rejects unsupported verbs', () => {
    expect(asRec(buildChannelPayload('webhook', 'W', true, { method: 'put' })).method).toBe('PUT');
    expect(asRec(buildChannelPayload('webhook', 'W', true, { method: 'get' })).method).toBe('GET');
    expect(asRec(buildChannelPayload('webhook', 'W', true, { method: 'delete' })).method).toBe('POST');
    expect(asRec(buildChannelPayload('webhook', 'W', true, {})).method).toBe('POST');
  });

  it('accepts an object header map but ignores malformed or array-shaped JSON', () => {
    expect(asRec(buildChannelPayload('webhook', 'W', true, { headers: '{"A":"B"}' })).headers).toEqual({ A: 'B' });
    expect(asRec(buildChannelPayload('webhook', 'W', true, { headers: 'not-json' })).headers).toEqual({});
    // Arrays are typeof 'object' but must not become a header map.
    expect(asRec(buildChannelPayload('webhook', 'W', true, { headers: '["a","b"]' })).headers).toEqual({});
  });

  it('applies the ntfy server default and pushover defaults', () => {
    const ntfy = asRec(buildChannelPayload('ntfy', 'N', true, { topic: 'cars' }));
    expect(ntfy).toMatchObject({ server_url: 'https://ntfy.sh', topic: 'cars', priority: 3 });
    const push = asRec(buildChannelPayload('pushover', 'P', true, { user_key: 'u', app_token: 'a' }));
    expect(push).toMatchObject({ user_key: 'u', app_token: 'a', device: null, priority: 0 });
  });

  it('produces a payload whose kind round-trips through getChannelMeta for every kind', () => {
    for (const kind of KNOWN_KINDS) {
      const payload = asRec(buildChannelPayload(kind, 'name', true, {}));
      expect(payload.kind).toBe(kind);
      expect(getChannelMeta(String(payload.kind)).value).toBe(kind);
    }
  });
});
