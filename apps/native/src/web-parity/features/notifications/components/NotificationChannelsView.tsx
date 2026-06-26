/**
 * NotificationChannelsView — React Native parity port of
 * web/src/features/notifications/components/NotificationChannelsView.tsx.
 *
 * Extracted channels CRUD that previously lived in NotificationsPage.
 * Renders inside the "Channels" tab so existing channel management
 * workflows stay reachable from /notifications without a route change.
 * The inbox lives in the "Inbox"/"Archived" tabs.
 *
 * Browser-only dependencies are reduced explicitly and documented in the
 * `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback?, params?)` that interpolates i18next-style
 *     `{{name}}` placeholders, preserving every translation key + intent.
 *   - `@/lib/cn`: dropped — native styling uses `StyleSheet` + tokens.
 *   - `@/components/ui` `Badge` / `Button` / `Input` / `Modal` / `Toggle`
 *     / `HelpIcon`, `@/components/data-display` `MetricCard`,
 *     `@/components/feedback` `EmptyState` / `Skeleton` / `useToast`, and
 *     `@/components/motion` `FadeIn`: no native parity port exists yet, so
 *     minimal native-safe equivalents are reproduced locally (the
 *     AlertMessageEditor / TeslaRegionPage "reproduce the dependency
 *     locally" precedent). `GlassPanel` uses the existing native primitive.
 *     The web `Modal` becomes a React Native `<Modal>`; the web `Toggle`
 *     becomes a Pressable switch; `HelpIcon` becomes a tap-to-reveal "?".
 *   - `lucide-react` icons: rendered as decorative `AppText` glyphs the
 *     same way sibling ports do (no SVG icon font dependency on native).
 *   - `./BrowserPushChannelCard`: browser push relies on the Notification
 *     API + PushManager + service workers, none of which exist in React
 *     Native, so it is reproduced locally as an explicit "Unavailable"
 *     card (contract rule 7 — native-safe unavailable state, documented).
 *   - DOM `e.target.value` / `e.preventDefault()`: TextInput `onChangeText`
 *     and argument-less press handlers replace the synthetic DOM events.
 */

import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {
  useNotificationChannels,
  useNotificationStats,
  useSaveChannel,
  useDeleteChannel,
  useToggleChannel,
  useTestChannel,
  type NotificationChannelInput,
} from '../../../api/hooks/useNotifications';
import type {
  NotificationChannel,
  NotificationChannelKind,
} from '../../../api/types';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{label}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () =>
      (key: string, fallback?: string, params?: NativeTParams) =>
        interpolate(fallback ?? key, params),
    [],
  );
}

/* ── native-safe useToast (web @/components/feedback/Toast) ── */

interface NativeToast {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

/**
 * The web `useToast()` enqueues a transient in-app toast. The native parity
 * layer has no Toast provider yet, so feedback bridges to React Native
 * `Alert.alert(title, message?)` (the TeslaRegionPage precedent),
 * preserving the component's `success(title)` / `error(title, message)`
 * call sites.
 */
function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

/* ── decorative glyphs (lucide-react icon stand-ins) ── */

const CHANNEL_GLYPH: Record<NotificationChannelKind, string> = {
  discord: '#', // Hash
  slack: '\uD83D\uDCAC', // 💬 MessageSquare
  telegram: '\u2708', // ✈ Send
  email: '\u2709', // ✉ Mail
  webhook: '\uD83D\uDD17', // 🔗 Webhook
  ntfy: '\uD83D\uDCE3', // 📣 Megaphone
  pushover: '\uD83D\uDCF1', // 📱 Smartphone
};

const BELL_GLYPH = '\uD83D\uDD14'; // 🔔 Bell / BellRing
const PLUS_GLYPH = '+'; // Plus
const TRASH_GLYPH = '\uD83D\uDDD1'; // 🗑 Trash2
const CHECK_GLYPH = '\u2713'; // ✓ CheckCircle
const CROSS_GLYPH = '\u2715'; // ✕ XCircle
const PENCIL_GLYPH = '\u270E'; // ✎ Pencil
const TESTTUBE_GLYPH = '\uD83E\uDDEA'; // 🧪 TestTube
const HELP_GLYPH = '?'; // HelpIcon affordance

/* ── native FadeIn stand-in (`@/components/motion` FadeIn) ── */

function FadeIn({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

/* ── native Badge stand-in (`@/components/ui` Badge) ── */

type BadgeVariant = 'success' | 'neutral' | 'warning';

function Badge({
  variant = 'neutral',
  children,
  testID,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={[styles.badge, badgeStyles[variant]]} testID={testID}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

/* ── native Button stand-in (`@/components/ui` Button) ── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

function Button({
  variant = 'primary',
  size = 'md',
  glyph,
  loading = false,
  disabled = false,
  onPress,
  children,
  style,
  testID,
  accessibilityLabel,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  glyph?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        buttonVariantStyles[variant],
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
        style,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' ? colors.background : colors.textPrimary
          }
          size="small"
        />
      ) : glyph ? (
        <AppText style={[styles.buttonGlyph, buttonTextStyles[variant]]}>
          {glyph}
        </AppText>
      ) : null}
      {children != null ? (
        <AppText
          style={[styles.buttonLabel, buttonTextStyles[variant]]}
          weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ── native HelpIcon stand-in (`@/components/ui` HelpIcon) ── */

/**
 * The web HelpIcon shows a "?" affordance revealing its content in a hover
 * tooltip. React Native has no hover, so the content becomes a tap-to-reveal
 * inline hint (and is exposed as the accessibility hint).
 */
function HelpHint({content, testID}: {content: string; testID?: string}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.helpWrap}>
      <Pressable
        accessibilityHint={content}
        accessibilityLabel={content}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [
          styles.helpButton,
          pressed && styles.helpButtonPressed,
        ]}
        testID={testID}>
        <AppText style={styles.helpGlyph}>{HELP_GLYPH}</AppText>
      </Pressable>
      {open ? (
        <View style={styles.helpBubble}>
          <AppText style={styles.helpBubbleText}>{content}</AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ── native Input stand-in (`@/components/ui` Input) ── */

interface FieldHelp {
  i18nKey: string;
  content: string;
}

function Input({
  label,
  help,
  type = 'text',
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  label: string;
  help?: FieldHelp;
  type?: 'text' | 'password' | 'url' | 'email';
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputLabelRow}>
        <AppText style={styles.inputLabel}>{label}</AppText>
        {help ? <HelpHint content={help.content} /> : null}
      </View>
      <TextInput
        autoCapitalize={type === 'email' || type === 'url' ? 'none' : 'sentences'}
        autoCorrect={false}
        keyboardType={
          type === 'email'
            ? 'email-address'
            : type === 'url'
              ? 'url'
              : 'default'
        }
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={type === 'password'}
        style={styles.input}
        testID={testID}
        value={value}
      />
    </View>
  );
}

/* ── native Toggle stand-in (`@/components/ui` Toggle) ── */

function Toggle({
  checked,
  onChange,
  label,
  testID,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      onPress={() => onChange(!checked)}
      style={styles.toggleRow}
      testID={testID}>
      <View style={[styles.toggleTrack, checked && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, checked && styles.toggleThumbOn]} />
      </View>
      {label != null ? (
        <AppText style={styles.toggleLabel}>{label}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ── native MetricCard stand-in (`@/components/data-display` MetricCard) ── */

type MetricColor = 'green' | 'red' | 'amber' | 'cyan';

const METRIC_COLOR: Record<MetricColor, string> = {
  green: colors.success,
  red: colors.danger,
  amber: colors.warning,
  cyan: colors.accent,
};

function MetricCard({
  label,
  value,
  glyph,
  color,
  testID,
}: {
  label: string;
  value: string | number;
  glyph: string;
  color: MetricColor;
  testID?: string;
}) {
  const tint = METRIC_COLOR[color];
  return (
    <GlassPanel style={styles.metricCard} testID={testID}>
      <View style={styles.metricHeader}>
        <AppText style={[styles.metricGlyph, {color: tint}]}>{glyph}</AppText>
        <AppText style={styles.metricLabel}>{label}</AppText>
      </View>
      <AppText style={[styles.metricValue, {color: tint}]} weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

/* ── native EmptyState stand-in (`@/components/feedback` EmptyState) ── */

function EmptyState({
  glyph,
  title,
  message,
  testID,
}: {
  glyph: string;
  title: string;
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      <AppText style={styles.emptyGlyph}>{glyph}</AppText>
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage}>{message}</AppText>
    </View>
  );
}

/* ── native Skeleton stand-in (`@/components/feedback` Skeleton) ── */

function Skeleton({height = 80}: {height?: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

/* ── native-safe BrowserPushChannelCard (web ./BrowserPushChannelCard) ── */

/**
 * Browser push registers THIS browser-device pairing with the server via the
 * Notification API + PushManager + a service worker — none of which exist in
 * React Native. The native parity surface keeps the card visible (so users
 * see browser push exists) but renders an explicit, honest "Unavailable"
 * state instead of the web subscribe/device-management workflow. Mobile
 * builds receive alerts through OS-level push channels, not browser push.
 */
function BrowserPushChannelCard({t}: {t: NativeTFunction}) {
  return (
    <GlassPanel style={styles.pushCard} testID="nc-browser-push-card">
      <View style={styles.pushHeader}>
        <View style={styles.pushHeaderLeft}>
          <View style={styles.pushIconBox}>
            <AppText style={styles.pushIconGlyph}>{BELL_GLYPH}</AppText>
          </View>
          <View style={styles.pushHeaderText}>
            <AppText style={styles.pushTitle} weight="semibold">
              {t('webpush.title', 'Browser push')}
            </AppText>
            <AppText style={styles.pushSubtitle}>
              {t(
                'webpush.subtitle',
                'Get OS-level notifications even when TeslaSync is closed.',
              )}
            </AppText>
          </View>
        </View>
        <Badge variant="warning" testID="nc-browser-push-status">
          {t('webpush.status.unsupported', 'Unavailable')}
        </Badge>
      </View>
      <View style={styles.pushNotice}>
        <AppText style={styles.pushNoticeGlyph}>{'\u26A0'}</AppText>
        <AppText style={styles.pushNoticeText}>
          {t(
            'webpush.unsupported.native',
            'Browser push relies on web service workers, which are unavailable in the native app. This device receives alerts through your configured notification channels and OS-level push.',
          )}
        </AppText>
      </View>
    </GlassPanel>
  );
}

/* ── field help catalog (ported verbatim) ── */

const FIELD_HELP: Record<string, FieldHelp> = {
  webhook_url: {
    i18nKey: 'help.fields.channels.webhookUrl',
    content:
      'Full HTTPS endpoint that receives JSON-formatted alert payloads. Treat as a credential — anyone with this URL can post to your channel.',
  },
  bot_token: {
    i18nKey: 'help.fields.channels.botToken',
    content:
      'Bot API credential issued by the messaging provider. Stored encrypted at rest; rotate immediately if leaked.',
  },
  chat_id: {
    i18nKey: 'help.fields.channels.chatId',
    content:
      'Numeric ID of the conversation that should receive alerts. Group chats are negative; DMs are positive.',
  },
  smtp_host: {
    i18nKey: 'help.fields.channels.smtpHost',
    content:
      'SMTP server hostname (no protocol prefix). Common providers: smtp.gmail.com, smtp.sendgrid.net, smtp.mailgun.org.',
  },
  smtp_port: {
    i18nKey: 'help.fields.channels.smtpPort',
    content:
      'SMTP submission port. Use 587 for STARTTLS (most providers) or 465 for implicit TLS.',
  },
  smtp_password: {
    i18nKey: 'help.fields.channels.smtpPassword',
    content:
      'SMTP password or app-specific password. Stored encrypted at rest. Many providers (Gmail, Microsoft 365) require an app password rather than your account password.',
  },
  url: {
    i18nKey: 'help.fields.channels.webhookUrl',
    content:
      'Full HTTPS endpoint that receives JSON-formatted alert payloads. Treat as a credential — anyone with this URL can post to your channel.',
  },
  method: {
    i18nKey: 'help.fields.channels.method',
    content:
      'HTTP method TeslaSync uses to deliver the payload. POST is the conventional choice; PUT/PATCH are supported for systems that require them.',
  },
  headers: {
    i18nKey: 'help.fields.channels.headersJson',
    content:
      'Optional JSON object of extra headers to send with each delivery, e.g. {"Authorization": "Bearer abc123"}. Must be valid JSON.',
  },
  body_template: {
    i18nKey: 'help.fields.channels.bodyTemplate',
    content:
      'Mustache-style template controlling the request body. Use {{message}}, {{title}}, {{severity}}, {{vehicle_name}} placeholders.',
  },
  server_url: {
    i18nKey: 'help.fields.channels.ntfyServer',
    content:
      'Base URL of the ntfy server. Use https://ntfy.sh for the public free tier or your self-hosted instance.',
  },
  topic: {
    i18nKey: 'help.fields.channels.ntfyTopic',
    content:
      'Topic name (channel) on the ntfy server. Anyone subscribed to this topic receives the alerts.',
  },
};

/* ── channel type catalog (ported; lucide icons -> glyphs) ── */

const CHANNEL_TYPES = [
  {
    value: 'discord',
    label: 'Discord',
    glyph: CHANNEL_GLYPH.discord,
    color: '#5865F2',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        placeholder: 'https://discord.com/api/webhooks/...',
        type: 'url',
      },
    ],
  },
  {
    value: 'slack',
    label: 'Slack',
    glyph: CHANNEL_GLYPH.slack,
    color: '#4A154B',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
        type: 'url',
      },
    ],
  },
  {
    value: 'telegram',
    label: 'Telegram',
    glyph: CHANNEL_GLYPH.telegram,
    color: '#0088cc',
    fields: [
      {key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-...', type: 'password'},
      {key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890', type: 'text'},
    ],
  },
  {
    value: 'email',
    label: 'Email',
    glyph: CHANNEL_GLYPH.email,
    color: '#EA4335',
    fields: [
      {key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com', type: 'text'},
      {key: 'smtp_port', label: 'SMTP Port', placeholder: '587', type: 'text'},
      {key: 'smtp_username', label: 'SMTP Username', placeholder: 'alerts@example.com', type: 'text'},
      {key: 'smtp_password', label: 'SMTP Password', placeholder: '••••••••', type: 'password'},
      {key: 'from_address', label: 'From Address', placeholder: 'alerts@example.com', type: 'email'},
      {
        key: 'to_addresses',
        label: 'Recipients (comma-separated)',
        placeholder: 'you@example.com,ops@example.com',
        type: 'text',
      },
    ],
  },
  {
    value: 'webhook',
    label: 'Webhook',
    glyph: CHANNEL_GLYPH.webhook,
    color: '#FF6B35',
    fields: [
      {key: 'url', label: 'URL', placeholder: 'https://example.com/webhook', type: 'url'},
      {key: 'method', label: 'HTTP Method', placeholder: 'POST', type: 'text'},
      {key: 'headers', label: 'Headers (JSON)', placeholder: '{"Authorization": "Bearer ..."}', type: 'text'},
      {key: 'body_template', label: 'Body Template', placeholder: '{"text": "{{message}}"}', type: 'text'},
    ],
  },
  {
    value: 'ntfy',
    label: 'ntfy',
    glyph: CHANNEL_GLYPH.ntfy,
    color: '#57A773',
    fields: [
      {key: 'server_url', label: 'Server URL', placeholder: 'https://ntfy.sh', type: 'url'},
      {key: 'topic', label: 'Topic', placeholder: 'teslasync', type: 'text'},
    ],
  },
  {
    value: 'pushover',
    label: 'Pushover',
    glyph: CHANNEL_GLYPH.pushover,
    color: '#249DF1',
    fields: [
      {key: 'user_key', label: 'User Key', placeholder: 'u1v2w3...', type: 'password'},
      {key: 'app_token', label: 'App Token', placeholder: 'a1b2c3...', type: 'password'},
    ],
  },
] as const;

type ChannelType = NotificationChannelKind;

export function getChannelMeta(kind: string) {
  return CHANNEL_TYPES.find(t => t.value === kind) ?? CHANNEL_TYPES[4];
}

function channelToFormConfig(ch: NotificationChannel): Record<string, string> {
  switch (ch.kind) {
    case 'discord':
      return {webhook_url: ch.webhook_url};
    case 'slack':
      return {webhook_url: ch.webhook_url};
    case 'telegram':
      return {bot_token: ch.bot_token, chat_id: ch.chat_id};
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
      return {server_url: ch.server_url, topic: ch.topic};
    case 'pushover':
      return {user_key: ch.user_key, app_token: ch.app_token};
  }
}

function buildChannelPayload(
  kind: ChannelType,
  name: string,
  enabled: boolean,
  config: Record<string, string>,
  id?: number,
): NotificationChannelInput {
  const idPart = id !== undefined ? {id} : {};
  switch (kind) {
    case 'discord':
      return {
        ...idPart,
        kind: 'discord',
        name,
        enabled,
        webhook_url: config.webhook_url ?? '',
        username: null,
        avatar_url: null,
      } as NotificationChannelInput;
    case 'slack':
      return {
        ...idPart,
        kind: 'slack',
        name,
        enabled,
        webhook_url: config.webhook_url ?? '',
        channel: null,
        username: null,
      } as NotificationChannelInput;
    case 'telegram':
      return {
        ...idPart,
        kind: 'telegram',
        name,
        enabled,
        bot_token: config.bot_token ?? '',
        chat_id: config.chat_id ?? '',
      } as NotificationChannelInput;
    case 'email': {
      const port = Number(config.smtp_port);
      return {
        ...idPart,
        kind: 'email',
        name,
        enabled,
        smtp_host: config.smtp_host ?? '',
        smtp_port: Number.isFinite(port) ? port : 587,
        smtp_username: config.smtp_username ?? '',
        smtp_password: config.smtp_password ?? '',
        from_address: config.from_address ?? '',
        to_addresses: (config.to_addresses ?? '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        use_tls: true,
      } as NotificationChannelInput;
    }
    case 'webhook': {
      let headers: Record<string, string> = {};
      try {
        const parsed = JSON.parse(config.headers || '{}');
        if (parsed && typeof parsed === 'object')
          headers = parsed as Record<string, string>;
      } catch {
        headers = {};
      }
      const method = (config.method ?? 'POST').toUpperCase();
      const safeMethod: 'GET' | 'POST' | 'PUT' =
        method === 'GET' || method === 'PUT' ? method : 'POST';
      return {
        ...idPart,
        kind: 'webhook',
        name,
        enabled,
        url: config.url ?? '',
        method: safeMethod,
        headers,
        body_template: config.body_template ?? '',
      } as NotificationChannelInput;
    }
    case 'ntfy':
      return {
        ...idPart,
        kind: 'ntfy',
        name,
        enabled,
        server_url: config.server_url ?? 'https://ntfy.sh',
        topic: config.topic ?? '',
        priority: 3,
        username: null,
        password: null,
      } as NotificationChannelInput;
    case 'pushover':
      return {
        ...idPart,
        kind: 'pushover',
        name,
        enabled,
        user_key: config.user_key ?? '',
        app_token: config.app_token ?? '',
        device: null,
        priority: 0,
      } as NotificationChannelInput;
  }
}

function ChannelFormModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useNativeTranslationFallback();
  const toast = useToast();
  const isEdit = !!channel;
  const [kind, setKind] = useState<ChannelType>(channel?.kind ?? 'discord');
  const [name, setName] = useState(channel?.name ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [config, setConfig] = useState<Record<string, string>>(
    channel ? channelToFormConfig(channel) : {},
  );
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  const meta = getChannelMeta(kind);
  const saveMut = useSaveChannel();
  const testMut = useTestChannel();

  const handleSubmit = () => {
    setFormError('');
    setTestResult(null);
    if (!name.trim()) {
      setFormError(t('notifications.channels.nameRequired', 'Name is required'));
      return;
    }
    const payload = buildChannelPayload(
      kind,
      name,
      enabled,
      config,
      isEdit && channel ? channel.id : undefined,
    );
    saveMut.mutate(payload, {
      onSuccess: () => {
        onSaved();
      },
      onError: e => setFormError(String(e)),
    });
  };

  const handleTest = () => {
    if (!isEdit || !channel) return;
    testMut.mutate(channel.id, {
      onSuccess: data => {
        if (data?.success) {
          setTestResult({
            success: true,
            message: t(
              'notifications.channels.testSuccess',
              'Test notification sent successfully!',
            ),
          });
          toast.success(t('notifications.channels.testSuccessShort', 'Test sent!'));
        } else {
          setTestResult({
            success: false,
            message:
              data?.error ||
              t('notifications.channels.testFailed', 'Test failed'),
          });
          toast.error(
            t('notifications.channels.testFailed', 'Test failed'),
            data?.error,
          );
        }
      },
      onError: () => {
        setTestResult({
          success: false,
          message: t('notifications.channels.testFailed', 'Test failed'),
        });
        toast.error(t('notifications.channels.testFailed', 'Test failed'));
      },
    });
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible
      testID="nc-form-modal">
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onClose}
        style={styles.backdrop}
        testID="nc-form-backdrop"
      />
      <View style={styles.modalCenter} pointerEvents="box-none">
        <View accessibilityViewIsModal style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle} weight="semibold">
              {isEdit
                ? t('notifications.channels.editTitle', 'Edit Channel')
                : t('notifications.channels.addTitle', 'Add Channel')}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.modalClose,
                pressed && styles.modalClosePressed,
              ]}
              testID="nc-form-close">
              <AppText style={styles.modalCloseGlyph}>{CROSS_GLYPH}</AppText>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.modalScroll}>
            <FadeIn style={styles.formStack}>
              {!isEdit ? (
                <View>
                  <AppText style={styles.fieldGroupLabel}>
                    {t('notifications.channels.typeLabel', 'Channel Type')}
                  </AppText>
                  <View style={styles.typeGrid}>
                    {CHANNEL_TYPES.map(ct => {
                      const selected = kind === ct.value;
                      return (
                        <Pressable
                          key={ct.value}
                          accessibilityRole="button"
                          accessibilityState={{selected}}
                          onPress={() => {
                            setKind(ct.value);
                            setConfig({});
                            setTestResult(null);
                          }}
                          style={[
                            styles.typeCard,
                            selected && styles.typeCardSelected,
                          ]}
                          testID={`nc-type-${ct.value}`}>
                          <AppText
                            style={[
                              styles.typeGlyph,
                              {
                                color: selected
                                  ? ct.color
                                  : colors.textSecondary,
                              },
                            ]}>
                            {ct.glyph}
                          </AppText>
                          <AppText
                            style={[
                              styles.typeLabel,
                              {
                                color: selected
                                  ? ct.color
                                  : colors.textSecondary,
                              },
                            ]}>
                            {ct.label}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <Input
                label={t('notifications.channels.nameLabel', 'Channel Name')}
                help={{
                  i18nKey: 'help.fields.channels.nameLabel',
                  content:
                    'Friendly identifier shown in the channel list and on alert delivery logs. Has no functional impact — pick anything memorable.',
                }}
                value={name}
                onChangeText={setName}
                placeholder={`${t(
                  'notifications.channels.namePlaceholderPrefix',
                  'My',
                )} ${meta.label}`}
                testID="nc-name-input"
              />

              <View style={styles.configStack}>
                <View style={styles.configHeader}>
                  <AppText style={styles.configHeaderText}>
                    {meta.label}{' '}
                    {t('notifications.channels.configLabel', 'Configuration')}
                  </AppText>
                  <HelpHint content="Provider-specific credentials and routing details. Required fields vary by channel type. All secrets are encrypted at rest." />
                </View>
                {meta.fields.map(f => (
                  <Input
                    key={f.key}
                    label={f.label}
                    help={FIELD_HELP[f.key]}
                    type={f.type === 'password' ? 'password' : 'text'}
                    value={config[f.key] ?? ''}
                    onChangeText={text =>
                      setConfig({...config, [f.key]: text})
                    }
                    placeholder={f.placeholder}
                    testID={`nc-field-${f.key}`}
                  />
                ))}
                <View style={styles.testHintRow}>
                  <HelpHint content='Use the "Send Test" button after saving to verify your configuration. Tests bypass severity filters but otherwise match real delivery.' />
                  <AppText style={styles.testHintText}>
                    {t(
                      'notifications.channels.testHint',
                      'Save then click "Send Test" to verify the configuration.',
                    )}
                  </AppText>
                </View>
              </View>

              <Toggle
                checked={enabled}
                onChange={setEnabled}
                label={
                  enabled
                    ? t('notifications.channels.enabled', 'Enabled')
                    : t('notifications.channels.disabled', 'Disabled')
                }
                testID="nc-enabled-toggle"
              />

              {testResult ? (
                <View
                  style={[
                    styles.testResult,
                    testResult.success
                      ? styles.testResultSuccess
                      : styles.testResultError,
                  ]}
                  testID="nc-test-result">
                  <AppText
                    style={[
                      styles.testResultGlyph,
                      {
                        color: testResult.success
                          ? colors.success
                          : colors.danger,
                      },
                    ]}>
                    {testResult.success ? CHECK_GLYPH : CROSS_GLYPH}
                  </AppText>
                  <AppText
                    style={[
                      styles.testResultText,
                      {
                        color: testResult.success
                          ? colors.success
                          : colors.danger,
                      },
                    ]}>
                    {testResult.message}
                  </AppText>
                </View>
              ) : null}

              {formError ? (
                <AppText style={styles.formError} testID="nc-form-error">
                  {formError}
                </AppText>
              ) : null}

              <View style={styles.formActions}>
                {isEdit ? (
                  <Button
                    variant="secondary"
                    glyph={TESTTUBE_GLYPH}
                    loading={testMut.isPending}
                    onPress={handleTest}
                    testID="nc-test-button">
                    {testMut.isPending
                      ? t('notifications.channels.testing', 'Testing…')
                      : t('notifications.channels.test', 'Test Connection')}
                  </Button>
                ) : null}
                <View style={styles.formActionsSpacer} />
                <Button variant="ghost" onPress={onClose} testID="nc-cancel-button">
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="primary"
                  loading={saveMut.isPending}
                  onPress={handleSubmit}
                  testID="nc-submit-button">
                  {saveMut.isPending
                    ? t('common.saving', 'Saving…')
                    : isEdit
                      ? t('common.update', 'Update')
                      : t('common.create', 'Create')}
                </Button>
              </View>
            </FadeIn>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function NotificationChannelsView() {
  const t = useNativeTranslationFallback();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] =
    useState<NotificationChannel | null>(null);

  const {data: channels = [], isLoading} = useNotificationChannels();
  const {data: stats} = useNotificationStats();
  const deleteMut = useDeleteChannel();
  const toggleMut = useToggleChannel();
  const testMut = useTestChannel();

  return (
    <View style={styles.root} testID="nc-root">
      <FadeIn>
        {stats ? (
          <View style={styles.statsGrid}>
            <MetricCard
              label={t('notifications.stats.sent', 'Total Sent')}
              value={stats.sent}
              glyph={CHECK_GLYPH}
              color="green"
              testID="nc-stat-sent"
            />
            <MetricCard
              label={t('notifications.stats.failed', 'Failed')}
              value={stats.failed}
              glyph={CROSS_GLYPH}
              color="red"
              testID="nc-stat-failed"
            />
            <MetricCard
              label={t('notifications.stats.pending', 'Pending')}
              value={stats.pending}
              glyph={BELL_GLYPH}
              color="amber"
              testID="nc-stat-pending"
            />
            <MetricCard
              label={t('notifications.stats.activeChannels', 'Active Channels')}
              value={`${stats.enabled_channels}/${stats.total_channels}`}
              glyph={BELL_GLYPH}
              color="cyan"
              testID="nc-stat-channels"
            />
          </View>
        ) : (
          <View style={styles.statsGrid}>
            {[1, 2, 3, 4].map(i => (
              <View key={i} style={styles.statSkeletonCell}>
                <Skeleton height={80} />
              </View>
            ))}
          </View>
        )}
      </FadeIn>

      <FadeIn style={styles.addRow}>
        <Button
          variant="primary"
          glyph={PLUS_GLYPH}
          onPress={() => {
            setEditingChannel(null);
            setShowForm(true);
          }}
          testID="nc-add-button">
          {t('notifications.channels.add', 'Add Channel')}
        </Button>
      </FadeIn>

      <FadeIn>
        <BrowserPushChannelCard t={t} />
      </FadeIn>

      <FadeIn>
        <View style={styles.channelGrid}>
          {isLoading
            ? [1, 2, 3].map(i => (
                <View key={i} style={styles.channelSkeletonCell}>
                  <Skeleton height={192} />
                </View>
              ))
            : null}

          {channels.map(ch => {
            const meta = getChannelMeta(ch.kind);
            const isTestingThis =
              testMut.isPending && testMut.variables === ch.id;
            const configPreview = channelToFormConfig(ch);
            return (
              <GlassPanel
                key={ch.id}
                style={[
                  styles.channelCard,
                  !ch.enabled && styles.channelCardDisabled,
                ]}
                testID={`nc-channel-${ch.id}`}>
                <View style={styles.channelHeader}>
                  <View style={styles.channelHeaderLeft}>
                    <View
                      style={[
                        styles.channelIconBox,
                        {
                          backgroundColor: `${meta.color}15`,
                          borderColor: `${meta.color}30`,
                        },
                      ]}>
                      <AppText
                        style={[styles.channelIconGlyph, {color: meta.color}]}>
                        {meta.glyph}
                      </AppText>
                    </View>
                    <View style={styles.channelHeaderText}>
                      <AppText style={styles.channelName} weight="semibold">
                        {ch.name}
                      </AppText>
                      <View style={styles.channelMetaRow}>
                        <AppText
                          style={[styles.channelKind, {color: meta.color}]}>
                          {ch.kind}
                        </AppText>
                        <Badge variant={ch.enabled ? 'success' : 'neutral'}>
                          {ch.enabled
                            ? t('notifications.channels.active', 'Active')
                            : t('notifications.channels.disabled', 'Disabled')}
                        </Badge>
                      </View>
                    </View>
                  </View>
                  <Toggle
                    checked={ch.enabled}
                    onChange={() =>
                      toggleMut.mutate(ch.id, {
                        onSuccess: () =>
                          toast.success(
                            ch.enabled
                              ? t(
                                  'notifications.channels.toggledOff',
                                  'Channel disabled',
                                )
                              : t(
                                  'notifications.channels.toggledOn',
                                  'Channel enabled',
                                ),
                          ),
                        onError: () =>
                          toast.error(
                            t(
                              'notifications.channels.toggleFailed',
                              'Failed to toggle channel',
                            ),
                          ),
                      })
                    }
                    testID={`nc-channel-toggle-${ch.id}`}
                  />
                </View>

                <View style={styles.configPreview}>
                  {Object.entries(configPreview)
                    .slice(0, 3)
                    .map(([k, v]) => (
                      <AppText
                        key={k}
                        numberOfLines={1}
                        style={styles.configPreviewRow}>
                        <AppText style={styles.configPreviewKey}>{k}:</AppText>{' '}
                        {k.includes('token') ||
                        k.includes('key') ||
                        k.includes('password')
                          ? '••••••••'
                          : v}
                      </AppText>
                    ))}
                </View>

                <View style={styles.channelActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    glyph={TESTTUBE_GLYPH}
                    loading={isTestingThis}
                    onPress={() =>
                      testMut.mutate(ch.id, {
                        onSuccess: data => {
                          if (data?.success)
                            toast.success(
                              `${ch.name}: ${t(
                                'notifications.channels.testSuccessShort',
                                'Test sent!',
                              )}`,
                            );
                          else
                            toast.error(
                              `${ch.name}: ${t(
                                'notifications.channels.testFailed',
                                'Test failed',
                              )}`,
                              data?.error,
                            );
                        },
                        onError: () =>
                          toast.error(
                            `${ch.name}: ${t(
                              'notifications.channels.testFailed',
                              'Test failed',
                            )}`,
                          ),
                      })
                    }
                    testID={`nc-channel-test-${ch.id}`}>
                    {isTestingThis
                      ? t('notifications.channels.testing', 'Testing…')
                      : t('notifications.channels.testShort', 'Test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    glyph={PENCIL_GLYPH}
                    onPress={() => {
                      setEditingChannel(ch);
                      setShowForm(true);
                    }}
                    testID={`nc-channel-edit-${ch.id}`}>
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    glyph={TRASH_GLYPH}
                    accessibilityLabel={t('common.delete', 'Delete')}
                    style={styles.channelDeleteButton}
                    onPress={() =>
                      deleteMut.mutate(ch.id, {
                        onSuccess: () =>
                          toast.success(
                            t(
                              'notifications.channels.deleted',
                              'Channel deleted',
                            ),
                          ),
                        onError: () =>
                          toast.error(
                            t(
                              'notifications.channels.deleteFailed',
                              'Failed to delete channel',
                            ),
                          ),
                      })
                    }
                    testID={`nc-channel-delete-${ch.id}`}
                  />
                </View>
              </GlassPanel>
            );
          })}

          {!isLoading && channels.length === 0 ? (
            <View style={styles.emptyCell}>
              <EmptyState
                glyph={BELL_GLYPH}
                title={t(
                  'notifications.channels.empty.title',
                  'No channels configured',
                )}
                message={t(
                  'notifications.channels.empty.message',
                  'Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more.',
                )}
                testID="nc-empty"
              />
            </View>
          ) : null}
        </View>
      </FadeIn>

      {showForm ? (
        <ChannelFormModal
          channel={editingChannel}
          onClose={() => {
            setShowForm(false);
            setEditingChannel(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditingChannel(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  /* stats */
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statSkeletonCell: {
    flexGrow: 1,
    flexBasis: '46%',
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  metricHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  metricLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: typography.title,
  },
  /* add row */
  addRow: {
    alignItems: 'flex-end',
  },
  /* channel grid */
  channelGrid: {
    gap: spacing.md,
  },
  channelSkeletonCell: {
    width: '100%',
  },
  channelCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  channelCardDisabled: {
    opacity: 0.6,
  },
  channelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  channelHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  channelIconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  channelIconGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  channelHeaderText: {
    flex: 1,
    gap: 2,
  },
  channelName: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  channelMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  channelKind: {
    fontSize: typography.caption,
    textTransform: 'capitalize',
  },
  configPreview: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    gap: 4,
    padding: spacing.sm,
  },
  configPreviewRow: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  configPreviewKey: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  channelActions: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  channelDeleteButton: {
    marginLeft: 'auto',
  },
  /* empty state */
  emptyCell: {
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 30,
    lineHeight: 36,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  emptyMessage: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  /* skeleton */
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    width: '100%',
  },
  /* browser push card */
  pushCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  pushHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pushHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  pushIconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  pushIconGlyph: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
  },
  pushHeaderText: {
    flex: 1,
    gap: 2,
  },
  pushTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  pushSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  pushNotice: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  pushNoticeGlyph: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 18,
  },
  pushNoticeText: {
    color: colors.warning,
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  /* badge */
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  /* button */
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  buttonSm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  buttonMd: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonGlyph: {
    fontSize: 13,
    lineHeight: 17,
  },
  buttonLabel: {
    fontSize: typography.caption,
  },
  /* input */
  inputGroup: {
    gap: spacing.xs,
  },
  inputLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.caption,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  /* toggle */
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 44,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  toggleThumb: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  toggleLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  /* help */
  helpWrap: {
    position: 'relative',
  },
  helpButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  helpButtonPressed: {
    borderColor: colors.borderAccent,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  helpBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxWidth: 260,
    padding: spacing.sm,
    position: 'absolute',
    top: 18,
    zIndex: 20,
  },
  helpBubbleText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  /* modal */
  backdrop: {
    backgroundColor: 'rgba(2, 6, 12, 0.72)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 560,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
  },
  modalClose: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  modalClosePressed: {
    backgroundColor: colors.surfaceHover,
  },
  modalCloseGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 20,
  },
  modalScroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  formStack: {
    gap: spacing.lg,
  },
  fieldGroupLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  typeCardSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  typeGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  typeLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  configStack: {
    gap: spacing.md,
  },
  configHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  configHeaderText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  testHintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  testHintText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 11,
  },
  testResult: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  testResultSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  testResultError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  testResultGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  testResultText: {
    flex: 1,
    fontSize: typography.caption,
  },
  formError: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  formActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  formActionsSpacer: {
    flex: 1,
  },
});

const badgeStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
  warning: {
    color: colors.warning,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>(
  {
    primary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    secondary: {
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    danger: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
    },
  },
);

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
  ghost: {
    color: colors.textSecondary,
  },
  danger: {
    color: colors.danger,
  },
});
