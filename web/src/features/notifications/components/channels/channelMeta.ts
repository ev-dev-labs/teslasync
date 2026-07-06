/**
 * Channel metadata + payload helpers shared across the Channels feature.
 *
 * Pure module (no JSX): the provider catalog (icons, brand colors, per-kind
 * form fields), plus the mapping helpers that translate a stored
 * `NotificationChannel` into editable form state and back into the
 * `NotificationChannelInput` the save endpoint expects.
 */

import {
  Hash, MessageSquare, Send, Mail, Webhook, Megaphone, Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type {
  NotificationChannel,
  NotificationChannelKind,
} from '@/api/types';
import type { NotificationChannelInput } from '@/api/hooks/useNotifications';

export type ChannelType = NotificationChannelKind;

export interface ChannelField {
  key: string;
  /** i18n key for the field label; `label` is the English fallback. */
  i18nKey: string;
  label: string;
  placeholder: string;
  type: 'url' | 'password' | 'text' | 'email';
}

export interface ChannelTypeMeta {
  value: ChannelType;
  label: string;
  icon: LucideIcon;
  color: string;
  fields: readonly ChannelField[];
}

/**
 * Field-level help copy keyed by form field name. Consumed by the modal's
 * `<Input help={FIELD_HELP[f.key]}>` so each credential input carries an
 * explanatory `(?)` tooltip.
 */
export const FIELD_HELP: Record<string, { i18nKey: string; content: string }> = {
  webhook_url: {
    i18nKey: 'help.fields.channels.webhookUrl',
    content: 'Full HTTPS endpoint that receives JSON-formatted alert payloads. Treat as a credential — anyone with this URL can post to your channel.',
  },
  bot_token: {
    i18nKey: 'help.fields.channels.botToken',
    content: 'Bot API credential issued by the messaging provider. Stored encrypted at rest; rotate immediately if leaked.',
  },
  chat_id: {
    i18nKey: 'help.fields.channels.chatId',
    content: 'Numeric ID of the conversation that should receive alerts. Group chats are negative; DMs are positive.',
  },
  smtp_host: {
    i18nKey: 'help.fields.channels.smtpHost',
    content: 'SMTP server hostname (no protocol prefix). Common providers: smtp.gmail.com, smtp.sendgrid.net, smtp.mailgun.org.',
  },
  smtp_port: {
    i18nKey: 'help.fields.channels.smtpPort',
    content: 'SMTP submission port. Use 587 for STARTTLS (most providers) or 465 for implicit TLS.',
  },
  smtp_password: {
    i18nKey: 'help.fields.channels.smtpPassword',
    content: 'SMTP password or app-specific password. Stored encrypted at rest. Many providers (Gmail, Microsoft 365) require an app password rather than your account password.',
  },
  url: {
    i18nKey: 'help.fields.channels.webhookUrl',
    content: 'Full HTTPS endpoint that receives JSON-formatted alert payloads. Treat as a credential — anyone with this URL can post to your channel.',
  },
  method: {
    i18nKey: 'help.fields.channels.method',
    content: 'HTTP method TeslaSync uses to deliver the payload. POST is the conventional choice; PUT/PATCH are supported for systems that require them.',
  },
  headers: {
    i18nKey: 'help.fields.channels.headersJson',
    content: 'Optional JSON object of extra headers to send with each delivery, e.g. {"Authorization": "******"}. Must be valid JSON.',
  },
  body_template: {
    i18nKey: 'help.fields.channels.bodyTemplate',
    content: 'Mustache-style template controlling the request body. Use {{message}}, {{title}}, {{severity}}, {{vehicle_name}} placeholders.',
  },
  server_url: {
    i18nKey: 'help.fields.channels.ntfyServer',
    content: 'Base URL of the ntfy server. Use https://ntfy.sh for the public free tier or your self-hosted instance.',
  },
  topic: {
    i18nKey: 'help.fields.channels.ntfyTopic',
    content: 'Topic name (channel) on the ntfy server. Anyone subscribed to this topic receives the alerts.',
  },
};

/** Provider catalog — the single source of truth for every supported channel kind. */
export const CHANNEL_TYPES: readonly ChannelTypeMeta[] = [
  { value: 'discord', label: 'Discord', icon: Hash, color: '#5865F2', fields: [
    { key: 'webhook_url', i18nKey: 'notifications.channels.fields.webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...', type: 'url' },
  ] },
  { value: 'slack', label: 'Slack', icon: MessageSquare, color: '#4A154B', fields: [
    { key: 'webhook_url', i18nKey: 'notifications.channels.fields.webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...', type: 'url' },
  ] },
  { value: 'telegram', label: 'Telegram', icon: Send, color: '#0088cc', fields: [
    { key: 'bot_token', i18nKey: 'notifications.channels.fields.botToken', label: 'Bot Token', placeholder: '123456:ABC-...', type: 'password' },
    { key: 'chat_id', i18nKey: 'notifications.channels.fields.chatId', label: 'Chat ID', placeholder: '-1001234567890', type: 'text' },
  ] },
  { value: 'email', label: 'Email', icon: Mail, color: '#EA4335', fields: [
    { key: 'smtp_host', i18nKey: 'notifications.channels.fields.smtpHost', label: 'SMTP Host', placeholder: 'smtp.gmail.com', type: 'text' },
    { key: 'smtp_port', i18nKey: 'notifications.channels.fields.smtpPort', label: 'SMTP Port', placeholder: '587', type: 'text' },
    { key: 'smtp_username', i18nKey: 'notifications.channels.fields.smtpUsername', label: 'SMTP Username', placeholder: 'alerts@example.com', type: 'text' },
    { key: 'smtp_password', i18nKey: 'notifications.channels.fields.smtpPassword', label: 'SMTP Password', placeholder: '••••••••', type: 'password' },
    { key: 'from_address', i18nKey: 'notifications.channels.fields.fromAddress', label: 'From Address', placeholder: 'alerts@example.com', type: 'email' },
    { key: 'to_addresses', i18nKey: 'notifications.channels.fields.toAddresses', label: 'Recipients (comma-separated)', placeholder: 'you@example.com,ops@example.com', type: 'text' },
  ] },
  { value: 'webhook', label: 'Webhook', icon: Webhook, color: '#FF6B35', fields: [
    { key: 'url', i18nKey: 'notifications.channels.fields.url', label: 'URL', placeholder: 'https://example.com/webhook', type: 'url' },
    { key: 'method', i18nKey: 'notifications.channels.fields.method', label: 'HTTP Method', placeholder: 'POST', type: 'text' },
    { key: 'headers', i18nKey: 'notifications.channels.fields.headers', label: 'Headers (JSON)', placeholder: '{"Authorization": "******"}', type: 'text' },
    { key: 'body_template', i18nKey: 'notifications.channels.fields.bodyTemplate', label: 'Body Template', placeholder: '{"text": "{{message}}"}', type: 'text' },
  ] },
  { value: 'ntfy', label: 'ntfy', icon: Megaphone, color: '#57A773', fields: [
    { key: 'server_url', i18nKey: 'notifications.channels.fields.serverUrl', label: 'Server URL', placeholder: 'https://ntfy.sh', type: 'url' },
    { key: 'topic', i18nKey: 'notifications.channels.fields.topic', label: 'Topic', placeholder: 'teslasync', type: 'text' },
  ] },
  { value: 'pushover', label: 'Pushover', icon: Smartphone, color: '#249DF1', fields: [
    { key: 'user_key', i18nKey: 'notifications.channels.fields.userKey', label: 'User Key', placeholder: 'u1v2w3...', type: 'password' },
    { key: 'app_token', i18nKey: 'notifications.channels.fields.appToken', label: 'App Token', placeholder: 'a1b2c3...', type: 'password' },
  ] },
];

/**
 * Stable fallback meta (the generic `webhook` provider) resolved by value so a
 * future reorder of `CHANNEL_TYPES` can't silently change what `getChannelMeta`
 * returns for an unknown kind.
 */
const FALLBACK_META: ChannelTypeMeta =
  CHANNEL_TYPES.find((c) => c.value === 'webhook') ?? CHANNEL_TYPES[0];

/** Resolve provider metadata by kind, falling back to the generic webhook meta. */
export function getChannelMeta(kind: string): ChannelTypeMeta {
  return CHANNEL_TYPES.find((c) => c.value === kind) ?? FALLBACK_META;
}

/** Fields whose values must never be shown in plaintext previews. */
export function isSecretField(key: string): boolean {
  return key.includes('token') || key.includes('key') || key.includes('password');
}

/** Flatten a stored channel into the flat `Record<string,string>` the form edits. */
export function channelToFormConfig(ch: NotificationChannel): Record<string, string> {
  switch (ch.kind) {
    case 'discord':
      return { webhook_url: ch.webhook_url };
    case 'slack':
      return { webhook_url: ch.webhook_url };
    case 'telegram':
      return { bot_token: ch.bot_token, chat_id: ch.chat_id };
    case 'email':
      return {
        smtp_host: ch.smtp_host,
        smtp_port: String(ch.smtp_port),
        smtp_username: ch.smtp_username,
        smtp_password: ch.smtp_password,
        from_address: ch.from_address,
        to_addresses: (ch.to_addresses ?? []).join(', '),
      };
    case 'webhook':
      return {
        url: ch.url,
        method: ch.method,
        headers: JSON.stringify(ch.headers ?? {}),
        body_template: ch.body_template,
      };
    case 'ntfy':
      return { server_url: ch.server_url, topic: ch.topic };
    case 'pushover':
      return { user_key: ch.user_key, app_token: ch.app_token };
    default: {
      // Corrupt/unknown kind (e.g. a malformed API payload): yield an empty
      // config so the card/modal renders a placeholder instead of returning
      // `undefined` and crashing callers that iterate the result. The `never`
      // binding keeps the switch exhaustive at compile time.
      const _exhaustive: never = ch;
      void _exhaustive;
      return {};
    }
  }
}

/** Build the typed save/update payload from flat form state. */
export function buildChannelPayload(
  kind: ChannelType,
  name: string,
  enabled: boolean,
  config: Record<string, string>,
  id?: number,
): NotificationChannelInput {
  const idPart = id !== undefined ? { id } : {};
  switch (kind) {
    case 'discord':
      return { ...idPart, kind: 'discord', name, enabled, webhook_url: config.webhook_url ?? '', username: null, avatar_url: null } as NotificationChannelInput;
    case 'slack':
      return { ...idPart, kind: 'slack', name, enabled, webhook_url: config.webhook_url ?? '', channel: null, username: null } as NotificationChannelInput;
    case 'telegram':
      return { ...idPart, kind: 'telegram', name, enabled, bot_token: config.bot_token ?? '', chat_id: config.chat_id ?? '' } as NotificationChannelInput;
    case 'email': {
      // `Number('')` is 0 (finite) and a blank/negative port is invalid SMTP,
      // so require a positive number before trusting the parsed value.
      const parsedPort = Number(config.smtp_port);
      const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587;
      return {
        ...idPart, kind: 'email', name, enabled,
        smtp_host: config.smtp_host ?? '',
        smtp_port: port,
        smtp_username: config.smtp_username ?? '',
        smtp_password: config.smtp_password ?? '',
        from_address: config.from_address ?? '',
        to_addresses: (config.to_addresses ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        use_tls: true,
      } as NotificationChannelInput;
    }
    case 'webhook': {
      let headers: Record<string, string> = {};
      try {
        const parsed = JSON.parse(config.headers || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) headers = parsed as Record<string, string>;
      } catch { headers = {}; }
      const method = (config.method ?? 'POST').toUpperCase();
      const safeMethod: 'GET' | 'POST' | 'PUT' = method === 'GET' || method === 'PUT' ? method : 'POST';
      return {
        ...idPart, kind: 'webhook', name, enabled,
        url: config.url ?? '',
        method: safeMethod,
        headers,
        body_template: config.body_template ?? '',
      } as NotificationChannelInput;
    }
    case 'ntfy':
      return {
        ...idPart, kind: 'ntfy', name, enabled,
        server_url: config.server_url ?? 'https://ntfy.sh',
        topic: config.topic ?? '',
        priority: 3, username: null, password: null,
      } as NotificationChannelInput;
    case 'pushover':
      return {
        ...idPart, kind: 'pushover', name, enabled,
        user_key: config.user_key ?? '',
        app_token: config.app_token ?? '',
        device: null, priority: 0,
      } as NotificationChannelInput;
  }
}
