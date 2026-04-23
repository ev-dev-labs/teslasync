/**
 * Typed notification channel definitions.
 *
 * Replaces the loose `config: Record<string, any>` shape previously used on
 * NotificationChannel with a discriminated union keyed by `kind`. Each channel
 * kind gets a dedicated interface with explicitly typed fields (no jsonb blobs).
 */

export type NotificationChannelKind =
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'email'
  | 'webhook'
  | 'ntfy'
  | 'pushover';

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

export type NotificationChannel =
  | (NotificationChannelDiscord & { kind: 'discord' });
