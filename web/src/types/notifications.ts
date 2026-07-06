/**
 * Typed notification channel definitions.
 *
 * Replaces the loose `config: Record<string, any>` shape previously used on
 * NotificationChannel with a discriminated union keyed by `kind`. Each channel
 * kind gets a dedicated interface with explicitly typed fields (no jsonb blobs).
 */

/**
 * Canonical, ordered list of every supported notification channel kind — the
 * single runtime source of truth. `NotificationChannelKind` is derived from
 * this tuple (via `as const`) so the compile-time union and the runtime list
 * can never drift, mirroring the `VEHICLE_STATES → VEHICLE_STATUSES` pattern in
 * `@/api/types`. Iterate this for provider dropdowns / payload validation
 * instead of hand-maintaining a parallel array.
 */
export const NOTIFICATION_CHANNEL_KINDS = [
  'discord',
  'slack',
  'telegram',
  'email',
  'webhook',
  'ntfy',
  'pushover',
] as const;

export type NotificationChannelKind = (typeof NOTIFICATION_CHANNEL_KINDS)[number];

/**
 * Runtime type guard for an untrusted `kind` value (a raw API payload, a form
 * field, a query param) before it is narrowed to `NotificationChannelKind`.
 * Rejects `null` / `undefined` / non-string input so a malformed channel is
 * caught at the boundary rather than trusted as a valid discriminant
 * downstream (where a `switch (ch.kind)` would silently fall through).
 */
export function isNotificationChannelKind(
  value: unknown,
): value is NotificationChannelKind {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_CHANNEL_KINDS as readonly string[]).includes(value)
  );
}

export interface NotificationChannelBase {
  id: number;
  name: string;
  kind: NotificationChannelKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannelDiscord extends NotificationChannelBase {
  kind: 'discord';
  webhook_url: string;
  username: string | null;
  avatar_url: string | null;
}

export interface NotificationChannelSlack extends NotificationChannelBase {
  kind: 'slack';
  webhook_url: string;
  channel: string | null;
  username: string | null;
}

export interface NotificationChannelTelegram extends NotificationChannelBase {
  kind: 'telegram';
  bot_token: string;
  chat_id: string;
}

export interface NotificationChannelEmail extends NotificationChannelBase {
  kind: 'email';
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_address: string;
  to_addresses: string[];
  use_tls: boolean;
}

export interface NotificationChannelWebhook extends NotificationChannelBase {
  kind: 'webhook';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body_template: string;
}

export interface NotificationChannelNtfy extends NotificationChannelBase {
  kind: 'ntfy';
  server_url: string;
  topic: string;
  priority: 1 | 2 | 3 | 4 | 5;
  username: string | null;
  password: string | null;
}

export interface NotificationChannelPushover extends NotificationChannelBase {
  kind: 'pushover';
  user_key: string;
  app_token: string;
  device: string | null;
  priority: -2 | -1 | 0 | 1 | 2;
}

export type NotificationChannel =
  | (NotificationChannelDiscord & { kind: 'discord' })
  | (NotificationChannelSlack & { kind: 'slack' })
  | (NotificationChannelTelegram & { kind: 'telegram' })
  | (NotificationChannelEmail & { kind: 'email' })
  | (NotificationChannelWebhook & { kind: 'webhook' })
  | (NotificationChannelNtfy & { kind: 'ntfy' })
  | (NotificationChannelPushover & { kind: 'pushover' });
