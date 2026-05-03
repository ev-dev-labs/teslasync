/**
 * NotificationChannelsView — extracted channels CRUD that previously lived in
 * NotificationsPage. Renders inside the "Channels" tab so existing channel
 * management workflows stay reachable from /notifications without a route
 * change. The inbox lives in the "Inbox"/"Archived" tabs.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell, Plus, Trash2, Send, MessageSquare, Mail, Webhook, Hash,
  Megaphone, Smartphone, CheckCircle, XCircle, Pencil, TestTube,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, GlassPanel, Input, Modal, Toggle } from '@/components/ui';
import { MetricCard } from '@/components/data-display/MetricCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { useToast } from '@/components/feedback/Toast';
import {
  useNotificationChannels, useNotificationStats,
  useSaveChannel, useDeleteChannel, useToggleChannel, useTestChannel,
  type NotificationChannelInput,
} from '@/api/hooks/useNotifications';
import type {
  NotificationChannel,
  NotificationChannelKind,
} from '@/api/types';
import { BrowserPushChannelCard } from './BrowserPushChannelCard';

const CHANNEL_TYPES = [
  { value: 'discord', label: 'Discord', icon: Hash, color: '#5865F2', fields: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...', type: 'url' },
  ] },
  { value: 'slack', label: 'Slack', icon: MessageSquare, color: '#4A154B', fields: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...', type: 'url' },
  ] },
  { value: 'telegram', label: 'Telegram', icon: Send, color: '#0088cc', fields: [
    { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-...', type: 'password' },
    { key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890', type: 'text' },
  ] },
  { value: 'email', label: 'Email', icon: Mail, color: '#EA4335', fields: [
    { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com', type: 'text' },
    { key: 'smtp_port', label: 'SMTP Port', placeholder: '587', type: 'text' },
    { key: 'smtp_username', label: 'SMTP Username', placeholder: 'alerts@example.com', type: 'text' },
    { key: 'smtp_password', label: 'SMTP Password', placeholder: '••••••••', type: 'password' },
    { key: 'from_address', label: 'From Address', placeholder: 'alerts@example.com', type: 'email' },
    { key: 'to_addresses', label: 'Recipients (comma-separated)', placeholder: 'you@example.com,ops@example.com', type: 'text' },
  ] },
  { value: 'webhook', label: 'Webhook', icon: Webhook, color: '#FF6B35', fields: [
    { key: 'url', label: 'URL', placeholder: 'https://example.com/webhook', type: 'url' },
    { key: 'method', label: 'HTTP Method', placeholder: 'POST', type: 'text' },
    { key: 'headers', label: 'Headers (JSON)', placeholder: '{"Authorization": "Bearer ..."}', type: 'text' },
    { key: 'body_template', label: 'Body Template', placeholder: '{"text": "{{message}}"}', type: 'text' },
  ] },
  { value: 'ntfy', label: 'ntfy', icon: Megaphone, color: '#57A773', fields: [
    { key: 'server_url', label: 'Server URL', placeholder: 'https://ntfy.sh', type: 'url' },
    { key: 'topic', label: 'Topic', placeholder: 'teslasync', type: 'text' },
  ] },
  { value: 'pushover', label: 'Pushover', icon: Smartphone, color: '#249DF1', fields: [
    { key: 'user_key', label: 'User Key', placeholder: 'u1v2w3...', type: 'password' },
    { key: 'app_token', label: 'App Token', placeholder: 'a1b2c3...', type: 'password' },
  ] },
] as const;

type ChannelType = NotificationChannelKind;

export function getChannelMeta(kind: string) {
  return CHANNEL_TYPES.find(t => t.value === kind) ?? CHANNEL_TYPES[4];
}

function channelToFormConfig(ch: NotificationChannel): Record<string, string> {
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
  }
}

function buildChannelPayload(
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
      const port = Number(config.smtp_port);
      return {
        ...idPart, kind: 'email', name, enabled,
        smtp_host: config.smtp_host ?? '',
        smtp_port: Number.isFinite(port) ? port : 587,
        smtp_username: config.smtp_username ?? '',
        smtp_password: config.smtp_password ?? '',
        from_address: config.from_address ?? '',
        to_addresses: (config.to_addresses ?? '').split(',').map(s => s.trim()).filter(Boolean),
        use_tls: true,
      } as NotificationChannelInput;
    }
    case 'webhook': {
      let headers: Record<string, string> = {};
      try {
        const parsed = JSON.parse(config.headers || '{}');
        if (parsed && typeof parsed === 'object') headers = parsed as Record<string, string>;
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

function ChannelFormModal({ channel, onClose, onSaved }: {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!channel;
  const [kind, setKind] = useState<ChannelType>(channel?.kind ?? 'discord');
  const [name, setName] = useState(channel?.name ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [config, setConfig] = useState<Record<string, string>>(
    channel ? channelToFormConfig(channel) : {},
  );
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const meta = getChannelMeta(kind);
  const saveMut = useSaveChannel();
  const testMut = useTestChannel();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setTestResult(null);
    if (!name.trim()) { setFormError(t('notifications.channels.nameRequired', 'Name is required')); return; }
    const payload = buildChannelPayload(kind, name, enabled, config, isEdit && channel ? channel.id : undefined);
    saveMut.mutate(payload, {
      onSuccess: () => { onSaved(); },
      onError: (e) => setFormError(String(e)),
    });
  };

  const handleTest = () => {
    if (!isEdit || !channel) return;
    testMut.mutate(channel.id, {
      onSuccess: (data) => {
        if (data?.success) {
          setTestResult({ success: true, message: t('notifications.channels.testSuccess', 'Test notification sent successfully!') });
          toast.success(t('notifications.channels.testSuccessShort', 'Test sent!'));
        } else {
          setTestResult({ success: false, message: data?.error || t('notifications.channels.testFailed', 'Test failed') });
          toast.error(t('notifications.channels.testFailed', 'Test failed'), data?.error);
        }
      },
      onError: () => {
        setTestResult({ success: false, message: t('notifications.channels.testFailed', 'Test failed') });
        toast.error(t('notifications.channels.testFailed', 'Test failed'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? t('notifications.channels.editTitle', 'Edit Channel') : t('notifications.channels.addTitle', 'Add Channel')}>
      <div className="space-y-5">
        <FadeIn>
          <div className="space-y-4">
            {!isEdit && (
              <div>
                <span className="block text-xs font-medium mb-2 text-[var(--text-secondary)]">
                  {t('notifications.channels.typeLabel', 'Channel Type')}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {CHANNEL_TYPES.map(ct => {
                    const TIcon = ct.icon;
                    return (
                      <GlassPanel
                        key={ct.value}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 text-xs font-medium cursor-pointer transition-all',
                          kind === ct.value ? 'border-neon-cyan/40 bg-neon-cyan/10' : 'hover:bg-[var(--surface-2)]',
                        )}
                        onClick={() => { setKind(ct.value); setConfig({}); setTestResult(null); }}
                      >
                        <TIcon className={cn('h-5 w-5', kind !== ct.value && 'text-[var(--text-secondary)]')} style={kind === ct.value ? { color: ct.color } : undefined} />
                        <span className={cn(kind !== ct.value && 'text-[var(--text-secondary)]')} style={kind === ct.value ? { color: ct.color } : undefined}>{ct.label}</span>
                      </GlassPanel>
                    );
                  })}
                </div>
              </div>
            )}

            <Input
              label={t('notifications.channels.nameLabel', 'Channel Name')}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`${t('notifications.channels.namePlaceholderPrefix', 'My')} ${meta.label}`}
            />

            <div className="space-y-3">
              <span className="block text-xs font-medium text-[var(--text-secondary)]">
                {meta.label} {t('notifications.channels.configLabel', 'Configuration')}
              </span>
              {meta.fields.map(f => (
                <Input
                  key={f.key}
                  label={f.label}
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={config[f.key] ?? ''}
                  onChange={e => setConfig({ ...config, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                />
              ))}
            </div>

            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label={enabled ? t('notifications.channels.enabled', 'Enabled') : t('notifications.channels.disabled', 'Disabled')}
            />

            {testResult && (
              <GlassPanel className={cn(
                'flex items-center gap-2 p-3 text-sm',
                testResult.success ? 'bg-neon-green/10 text-neon-green border-neon-green/20' : 'bg-neon-red/10 text-neon-red border-neon-red/20',
              )}>
                {testResult.success ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                <span>{testResult.message}</span>
              </GlassPanel>
            )}

            {formError && <span className="text-sm text-rose-300 block">{formError}</span>}

            <div className="flex items-center gap-3 pt-2">
              {isEdit && (
                <Button
                  variant="secondary"
                  icon={<TestTube className="h-4 w-4" />}
                  loading={testMut.isPending}
                  onClick={handleTest}
                >
                  {testMut.isPending ? t('notifications.channels.testing', 'Testing…') : t('notifications.channels.test', 'Test Connection')}
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
              <Button variant="primary" loading={saveMut.isPending} onClick={handleSubmit}>
                {saveMut.isPending
                  ? t('common.saving', 'Saving…')
                  : isEdit ? t('common.update', 'Update') : t('common.create', 'Create')}
              </Button>
            </div>
          </div>
        </FadeIn>
      </div>
    </Modal>
  );
}

export function NotificationChannelsView() {
  const { t } = useTranslation();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);

  const { data: channels = [], isLoading } = useNotificationChannels();
  const { data: stats } = useNotificationStats();
  const deleteMut = useDeleteChannel();
  const toggleMut = useToggleChannel();
  const testMut = useTestChannel();

  return (
    <div className="space-y-4">
      <FadeIn>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label={t('notifications.stats.sent', 'Total Sent')} value={stats.sent} icon={<CheckCircle className="h-4 w-4" />} color="green" />
            <MetricCard label={t('notifications.stats.failed', 'Failed')} value={stats.failed} icon={<XCircle className="h-4 w-4" />} color="red" />
            <MetricCard label={t('notifications.stats.pending', 'Pending')} value={stats.pending} icon={<Bell className="h-4 w-4" />} color="amber" />
            <MetricCard label={t('notifications.stats.activeChannels', 'Active Channels')} value={`${stats.enabled_channels}/${stats.total_channels}`} icon={<Bell className="h-4 w-4" />} color="cyan" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        )}
      </FadeIn>

      <FadeIn>
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => { setEditingChannel(null); setShowForm(true); }}
          >
            {t('notifications.channels.add', 'Add Channel')}
          </Button>
        </div>
      </FadeIn>

      <FadeIn>
        <BrowserPushChannelCard />
      </FadeIn>

      <FadeIn>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading && [1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}

          {channels.map(ch => {
            const meta = getChannelMeta(ch.kind);
            const Icon = meta.icon;
            const isTestingThis = testMut.isPending && testMut.variables === ch.id;
            const configPreview = channelToFormConfig(ch);
            return (
              <GlassPanel
                key={ch.id}
                className={cn(
                  'p-5 space-y-4 transition-all duration-normal',
                  ch.enabled ? 'ring-1 ring-white/[0.08]' : 'opacity-60',
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl p-2.5 ring-1" style={{ background: `${meta.color}15`, borderColor: `${meta.color}30` }}>
                      <Icon className="h-5 w-5" style={{ color: meta.color }} />
                    </div>
                    <div>
                      <span className="font-semibold text-[var(--text-primary)] block">{ch.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs capitalize" style={{ color: meta.color }}>{ch.kind}</span>
                        <Badge variant={ch.enabled ? 'success' : 'neutral'} size="sm">
                          {ch.enabled ? t('notifications.channels.active', 'Active') : t('notifications.channels.disabled', 'Disabled')}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Toggle
                    checked={ch.enabled}
                    onChange={() => toggleMut.mutate(ch.id, {
                      onSuccess: () => toast.success(ch.enabled
                        ? t('notifications.channels.toggledOff', 'Channel disabled')
                        : t('notifications.channels.toggledOn', 'Channel enabled')),
                      onError: () => toast.error(t('notifications.channels.toggleFailed', 'Failed to toggle channel')),
                    })}
                  />
                </div>

                <div className="space-y-1 rounded-lg bg-white/[0.02] p-2.5">
                  {Object.entries(configPreview).slice(0, 3).map(([k, v]) => (
                    <span key={k} className="text-xs truncate block text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--text-secondary)]">{k}:</span>{' '}
                      {k.includes('token') || k.includes('key') || k.includes('password') ? '••••••••' : v}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<TestTube className="h-3.5 w-3.5" />}
                    loading={isTestingThis}
                    onClick={() => testMut.mutate(ch.id, {
                      onSuccess: (data) => {
                        if (data?.success) toast.success(`${ch.name}: ${t('notifications.channels.testSuccessShort', 'Test sent!')}`);
                        else toast.error(`${ch.name}: ${t('notifications.channels.testFailed', 'Test failed')}`, data?.error);
                      },
                      onError: () => toast.error(`${ch.name}: ${t('notifications.channels.testFailed', 'Test failed')}`),
                    })}
                  >
                    {isTestingThis ? t('notifications.channels.testing', 'Testing…') : t('notifications.channels.testShort', 'Test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => { setEditingChannel(ch); setShowForm(true); }}
                  >
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    className="ml-auto"
                    onClick={() => deleteMut.mutate(ch.id, {
                      onSuccess: () => toast.success(t('notifications.channels.deleted', 'Channel deleted')),
                      onError: () => toast.error(t('notifications.channels.deleteFailed', 'Failed to delete channel')),
                    })}
                  />
                </div>
              </GlassPanel>
            );
          })}

          {!isLoading && channels.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                icon={<Bell className="h-8 w-8" />}
                title={t('notifications.channels.empty.title', 'No channels configured')}
                message={t('notifications.channels.empty.message', 'Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more.')}
              />
            </div>
          )}
        </div>
      </FadeIn>

      {showForm && (
        <ChannelFormModal
          channel={editingChannel}
          onClose={() => { setShowForm(false); setEditingChannel(null); }}
          onSaved={() => { setShowForm(false); setEditingChannel(null); }}
        />
      )}
    </div>
  );
}
