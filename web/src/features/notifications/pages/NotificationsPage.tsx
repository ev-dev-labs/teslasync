/**
 * NotificationsPage — manage notification channels, view delivery logs, and monitor stats.
 *
 * Full CRUD for channels (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover),
 * delivery log DataTable, and stats overview.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { SearchInput, FilterBar } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import {
  useNotificationChannels, useNotificationLogs, useNotificationStats,
  useSaveChannel, useDeleteChannel, useToggleChannel, useTestChannel,
  type NotificationChannelInput,
} from '@/api/hooks/useNotifications';
import type { NotificationChannel, NotificationChannelKind, NotificationLog } from '@/api/types';
import {
  Bell, Plus, Trash2, Send, MessageSquare, Mail, Webhook, Hash,
  Megaphone, Smartphone, CheckCircle, XCircle, Clock, BarChart3,
  Pencil, ChevronDown, ChevronUp, TestTube,
} from 'lucide-react';

// ─── Channel type definitions ────────────────────────────────────────────────

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

function getChannelMeta(kind: string) {
  return CHANNEL_TYPES.find(t => t.value === kind) ?? CHANNEL_TYPES[4];
}

/**
 * Extract the editable, flat string-keyed view of a typed channel for use in
 * the generic form state. The inverse of `buildChannelPayload`.
 */
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

/**
 * Build a typed, discriminated-union payload from the flat form state.
 * Mirrors the server-side NotificationChannelInput shape for each kind.
 */
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
        if (parsed && typeof parsed === 'object') headers = parsed as Record<string, string>;
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

// ─── Channel Form Modal ──────────────────────────────────────────────────────

function ChannelFormModal({ channel, onClose, onSaved, t }: {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSaved: () => void;
  t: (k: string) => string;
}) {
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
    if (!name.trim()) { setFormError(t('Name is required')); return; }
    const payload = buildChannelPayload(
      kind,
      name,
      enabled,
      config,
      isEdit && channel ? channel.id : undefined,
    );
    saveMut.mutate(payload, {
      onSuccess: () => { toast.success(isEdit ? t('Channel updated') : t('Channel created')); onSaved(); },
      onError: (e) => setFormError(String(e)),
    });
  };

  const handleTest = () => {
    if (!isEdit || !channel) return;
    testMut.mutate(channel.id, {
      onSuccess: (data) => {
        if (data?.success) {
          setTestResult({ success: true, message: t('Test notification sent successfully!') });
          toast.success(t('Test sent!'));
        } else {
          setTestResult({ success: false, message: data?.error || t('Test failed') });
          toast.error(t('Test failed'), data?.error);
        }
      },
      onError: () => {
        setTestResult({ success: false, message: t('Test failed') });
        toast.error(t('Test failed'));
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? t('Edit Channel') : t('Add Channel')}>
      <div className="space-y-5">
        <FadeIn>
          <div className="space-y-4">
            {/* Type selector */}
            {!isEdit && (
              <div>
                <span className="block text-xs font-medium mb-2 text-[var(--text-secondary)]">
                  {t('Channel Type')}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {CHANNEL_TYPES.map(ct => {
                    const TIcon = ct.icon;
                    return (
                      <GlassPanel
                        key={ct.value}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 text-xs font-medium cursor-pointer transition-all',
                          kind === ct.value ? 'border-neon-cyan/40 bg-neon-cyan/10' : 'hover:bg-white/10',
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

            {/* Name */}
            <Input
              label={t('Channel Name')}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`${t('My')} ${meta.label} ${t('Channel')}`}
            />

            {/* Dynamic config fields */}
            <div className="space-y-3">
              <span className="block text-xs font-medium text-[var(--text-secondary)]">
                {meta.label} {t('Configuration')}
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

            {/* Enabled toggle */}
            <Toggle checked={enabled} onChange={setEnabled} label={enabled ? t('Enabled') : t('Disabled')} />

            {/* Test result */}
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
                  {testMut.isPending ? t('Testing…') : t('Test Connection')}
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
              <Button
                variant="primary"
                loading={saveMut.isPending}
                onClick={handleSubmit}
              >
                {saveMut.isPending ? t('Saving…') : isEdit ? t('Update') : t('Create')}
              </Button>
            </div>
          </div>
        </FadeIn>
      </div>
    </Modal>
  );
}

// ─── Main page component ─────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Notifications'));
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logSearch, setLogSearch] = useState('');

  // Queries
  const { data: channels = [], isLoading, error } = useNotificationChannels();
  const { data: stats } = useNotificationStats();
  const { data: logs = [] } = useNotificationLogs();

  // Mutations
  const deleteMut = useDeleteChannel();
  const toggleMut = useToggleChannel();
  const testMut = useTestChannel();

  // Log table columns
  const logColumns: Column<NotificationLog>[] = useMemo(() => {
    const channelMap: Record<number, NotificationChannel> = {};
    channels.forEach(c => { channelMap[c.id] = c; });
    return [
      { key: 'time', header: t('Time'), render: (log) => <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{formatDateTime(log.created_at)}</span> },
      { key: 'channel', header: t('Channel'), render: (log) => {
        const ch = channelMap[log.channel_id];
        if (!ch) return <span className="text-[var(--text-primary)]">{`#${log.channel_id}`}</span>;
        const m = getChannelMeta(ch.kind);
        const CIcon = m.icon;
        return (
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <CIcon className="h-3.5 w-3.5" style={{ color: m.color }} />
            <span className="text-sm">{ch.name}</span>
          </div>
        );
      }},
      { key: 'title', header: t('Title'), render: (log) => <span className="text-sm text-[var(--text-primary)]">{log.title}</span> },
      { key: 'status', header: t('Status'), render: (log) => <Badge variant={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'} size="sm">{log.status}</Badge> },
      { key: 'error', header: t('Error'), render: (log) => <span className="text-xs text-neon-red/70 max-w-[200px] truncate block">{log.error}</span> },
    ];
  }, [channels, t]);

  // Channel name lookup for the search field accessor.
  const channelNames: Record<number, string> = useMemo(() => {
    const m: Record<number, string> = {};
    channels.forEach(c => { m[c.id] = c.name; });
    return m;
  }, [channels]);

  const logSearchFields = useMemo(
    () => [
      'title' as keyof NotificationLog,
      (log: NotificationLog) => channelNames[log.channel_id] ?? '',
    ],
    [channelNames],
  );
  const filteredLogs = useFilteredList(logs, logSearch, logSearchFields);

  return (
    <PageContainer
      title={t('Notification Center')}
      subtitle={t('Manage notification channels, view delivery logs, and monitor delivery stats')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditingChannel(null); setShowForm(true); }}>
          {t('Add Channel')}
        </Button>
      }
    >
      {/* ── Stats cards ──────────────────────────────────────────────── */}
      <FadeIn>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label={t('Total Sent')} value={stats.sent} icon={<CheckCircle className="h-4 w-4" />} color="green" />
            <MetricCard label={t('Failed')} value={stats.failed} icon={<XCircle className="h-4 w-4" />} color="red" />
            <MetricCard label={t('Pending')} value={stats.pending} icon={<Clock className="h-4 w-4" />} color="amber" />
            <MetricCard label={t('Active Channels')} value={`${stats.enabled_channels}/${stats.total_channels}`} icon={<Bell className="h-4 w-4" />} color="cyan" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        )}
      </FadeIn>

      {/* ── Channel cards ────────────────────────────────────────────── */}
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
                  'p-5 space-y-4 transition-all duration-300',
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
                          {ch.enabled ? t('Active') : t('Disabled')}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Toggle
                    checked={ch.enabled}
                    onChange={() => toggleMut.mutate(ch.id, {
                      onSuccess: () => toast.success(t(ch.enabled ? 'Channel disabled' : 'Channel enabled')),
                      onError: () => toast.error(t('Failed to toggle channel')),
                    })}
                  />
                </div>

                {/* Config preview */}
                <div className="space-y-1 rounded-lg bg-white/[0.02] p-2.5">
                  {Object.entries(configPreview).slice(0, 3).map(([k, v]) => (
                    <span key={k} className="text-xs truncate block text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--text-secondary)]">{k}:</span>{' '}
                      {k.includes('token') || k.includes('key') || k.includes('password') ? '••••••••' : v}
                    </span>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<TestTube className="h-3.5 w-3.5" />}
                    loading={isTestingThis}
                    onClick={() => testMut.mutate(ch.id, {
                      onSuccess: (data) => {
                        if (data?.success) toast.success(`${ch.name}: ${t('test sent successfully!')}`);
                        else toast.error(`${ch.name}: ${t('test failed')}`, data?.error);
                      },
                      onError: () => toast.error(`${ch.name}: ${t('test failed')}`),
                    })}
                  >
                    {isTestingThis ? t('Testing…') : t('Test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => { setEditingChannel(ch); setShowForm(true); }}
                  >
                    {t('Edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    className="ml-auto"
                    onClick={() => deleteMut.mutate(ch.id, {
                      onSuccess: () => toast.success(t('Channel deleted')),
                      onError: () => toast.error(t('Failed to delete channel')),
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
                title={t('No channels configured')}
                message={t('Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more.')}
              />
            </div>
          )}
        </div>
      </FadeIn>

      {/* ── Delivery Log toggle ──────────────────────────────────────── */}
      <FadeIn>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowLogs(!showLogs)}
          icon={<BarChart3 className="h-4 w-4" />}
        >
          {t('Delivery Log')}
          {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </FadeIn>

      {/* ── Delivery Log table ───────────────────────────────────────── */}
      {showLogs && (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6">
            <FilterBar className="mb-3">
              <SearchInput
                value={logSearch}
                onChange={setLogSearch}
                placeholder={t('Search by title or channel…')}
                className="w-full sm:w-72"
              />
            </FilterBar>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <DataTable
                columns={logColumns}
                data={filteredLogs}
                keyExtractor={(log) => log.id}
                pagination={{ defaultPageSize: 50 }}
                emptyMessage={
                  logSearch
                    ? t('No logs match your search')
                    : t('No delivery logs yet')
                }
              />
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Add/Edit Channel Modal ───────────────────────────────────── */}
      {showForm && (
        <ChannelFormModal
          channel={editingChannel}
          onClose={() => { setShowForm(false); setEditingChannel(null); }}
          onSaved={() => { setShowForm(false); setEditingChannel(null); }}
          t={t}
        />
      )}
    </PageContainer>
  );
}
