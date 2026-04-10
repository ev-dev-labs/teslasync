import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, Plus, Trash2, TestTube, ToggleLeft, ToggleRight,
  Send, MessageSquare, Mail, Webhook, Hash, Megaphone, Smartphone,
  CheckCircle, XCircle, Clock, BarChart3, Pencil, ChevronDown, ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getNotificationChannels, createNotificationChannel, updateNotificationChannel,
  deleteNotificationChannel, toggleNotificationChannel, testNotificationChannel,
  getNotificationLogs, getNotificationStats,
  NotificationChannel, NotificationLog,
} from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, EmptyState, Badge, Button, MetricCard, Toggle, Modal } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../lib/dateFormat'

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
    { key: 'from', label: 'From Address', placeholder: 'alerts@example.com', type: 'email' },
    { key: 'to', label: 'Recipient', placeholder: 'you@example.com', type: 'email' },
    { key: 'password', label: 'SMTP Password', placeholder: '••••••••', type: 'password' },
  ] },
  { value: 'webhook', label: 'Webhook', icon: Webhook, color: '#FF6B35', fields: [
    { key: 'url', label: 'URL', placeholder: 'https://example.com/webhook', type: 'url' },
    { key: 'method', label: 'HTTP Method', placeholder: 'POST', type: 'text' },
    { key: 'headers', label: 'Headers (JSON)', placeholder: '{"Authorization": "Bearer ..."}', type: 'text' },
  ] },
  { value: 'ntfy', label: 'ntfy', icon: Megaphone, color: '#57A773', fields: [
    { key: 'server', label: 'Server URL', placeholder: 'https://ntfy.sh', type: 'url' },
    { key: 'topic', label: 'Topic', placeholder: 'teslasync', type: 'text' },
  ] },
  { value: 'pushover', label: 'Pushover', icon: Smartphone, color: '#249DF1', fields: [
    { key: 'user_key', label: 'User Key', placeholder: 'u1v2w3...', type: 'password' },
    { key: 'app_token', label: 'App Token', placeholder: 'a1b2c3...', type: 'password' },
  ] },
] as const

type ChannelType = typeof CHANNEL_TYPES[number]['value']

function getChannelMeta(type: string) {
  return CHANNEL_TYPES.find(t => t.value === type) ?? CHANNEL_TYPES[4]
}

export default function Notifications() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showForm, setShowForm] = useState(false)
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  const { data: channels = [], isLoading } = useQuery({ queryKey: ['notification-channels'], queryFn: getNotificationChannels })
  const { data: stats } = useQuery({ queryKey: ['notification-stats'], queryFn: getNotificationStats })
  const { data: logs = [] } = useQuery({ queryKey: ['notification-logs'], queryFn: () => getNotificationLogs(100), enabled: showLogs })

  const deleteMut = useMutation({
    mutationFn: deleteNotificationChannel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-channels'] })
      qc.invalidateQueries({ queryKey: ['notification-stats'] })
      toast.success('Channel deleted')
    },
    onError: () => toast.error('Failed to delete channel'),
  })
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => toggleNotificationChannel(id, enabled),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['notification-channels'] })
      qc.invalidateQueries({ queryKey: ['notification-stats'] })
      toast.success(`Channel ${variables.enabled ? 'enabled' : 'disabled'}`)
    },
    onError: () => toast.error('Failed to toggle channel'),
  })
  const testMut = useMutation({
    mutationFn: testNotificationChannel,
    onSuccess: (data, channelId) => {
      const name = channels.find(c => c.id === channelId)?.name ?? 'Channel'
      if (data?.success) {
        toast.success(`${name}: test sent successfully!`)
      } else {
        toast.error(`${name}: test failed`, data?.error || 'Unknown error')
      }
    },
    onError: (_err, channelId) => {
      const name = channels.find(c => c.id === channelId)?.name ?? 'Channel'
      toast.error(`${name}: test failed`)
    },
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notification Center"
        subtitle="Manage notification channels, view delivery logs, and monitor delivery stats"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditingChannel(null); setShowForm(true) }}>
            Add Channel
          </Button>
        }
      />

      {/* Stats cards */}
      <FadeIn>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Sent" value={stats.sent} icon={<CheckCircle className="h-4 w-4" />} color="green" />
            <MetricCard label="Failed" value={stats.failed} icon={<XCircle className="h-4 w-4" />} color="red" />
            <MetricCard label="Pending" value={stats.pending} icon={<Clock className="h-4 w-4" />} color="amber" />
            <MetricCard label="Active Channels" value={`${stats.enabled_channels}/${stats.total_channels}`} icon={<Bell className="h-4 w-4" />} color="cyan" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        )}
      </FadeIn>

      {/* Channel cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading && Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}

          {channels.map(ch => {
            const meta = getChannelMeta(ch.type)
            const Icon = meta.icon
            const isTestingThis = testMut.isPending && testMut.variables === ch.id
            return (
              <motion.div
                key={ch.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <GlassPanel className={clsx(
                  'p-5 space-y-4 transition-all duration-300',
                  ch.enabled ? 'ring-1 ring-white/[0.08]' : 'opacity-60'
                )}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl p-2.5 ring-1" style={{ background: `${meta.color}15`, borderColor: `${meta.color}30` }}>
                        <Icon className="h-5 w-5" style={{ color: meta.color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{ch.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs capitalize" style={{ color: meta.color }}>{ch.type}</span>
                          <Badge color={ch.enabled ? 'green' : 'neutral'} size="sm" dot>
                            {ch.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleMut.mutate({ id: ch.id, enabled: !ch.enabled })}
                      className="transition-colors shrink-0"
                      aria-label={ch.enabled ? 'Disable channel' : 'Enable channel'}
                    >
                      {ch.enabled ? (
                        <ToggleRight className="h-7 w-7 text-neon-green" />
                      ) : (
                        <ToggleLeft className="h-7 w-7 text-[var(--text-muted)]" />
                      )}
                    </button>
                  </div>

                  {/* Config preview */}
                  <div className="space-y-1 rounded-lg bg-white/[0.02] p-2.5">
                    {Object.entries(ch.config || {}).slice(0, 3).map(([k, v]) => (
                      <p key={k} className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{k}:</span>{' '}
                        {k.includes('token') || k.includes('key') || k.includes('password') ? '••••••••' : v}
                      </p>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<TestTube className="h-3.5 w-3.5" />}
                      loading={isTestingThis}
                      onClick={() => testMut.mutate(ch.id)}
                    >
                      {isTestingThis ? 'Testing...' : 'Test'}
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setEditingChannel(ch); setShowForm(true) }}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete "${ch.name}"?`)) deleteMut.mutate(ch.id) }} className="ml-auto" />
                  </div>
                </GlassPanel>
              </motion.div>
            )
          })}

          {!isLoading && channels.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                icon={<Bell className="h-8 w-8" />}
                title="No channels configured"
                description="Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more."
              />
            </div>
          )}
        </div>
      </FadeIn>

      {/* Delivery Log toggle */}
      <FadeIn delay={0.15}>
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-2 text-sm font-medium transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          <BarChart3 className="h-4 w-4" />
          Delivery Log
          {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </FadeIn>

      {/* Delivery Log table */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <GlassPanel className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                    {['Time', 'Channel', 'Title', 'Status', 'Error'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: NotificationLog) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const ch = channels.find(c => c.id === log.channel_id)
                            if (!ch) return `#${log.channel_id}`
                            const m = getChannelMeta(ch.type)
                            const CIcon = m.icon
                            return (
                              <>
                                <CIcon className="h-3.5 w-3.5" style={{ color: m.color }} />
                                <span className="text-sm">{ch.name}</span>
                              </>
                            )
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{log.title}</td>
                      <td className="px-4 py-3">
                        <Badge color={log.status === 'sent' ? 'green' : log.status === 'failed' ? 'red' : 'amber'} size="sm">
                          {log.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-neon-red/70 max-w-[200px] truncate">{log.error}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center" style={{ color: 'var(--text-tertiary)' }}>No delivery logs yet</td></tr>
                  )}
                </tbody>
              </table>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Channel Modal */}
      <AnimatePresence>
        {showForm && (
          <ChannelFormModal
            channel={editingChannel}
            onClose={() => { setShowForm(false); setEditingChannel(null) }}
            onSaved={() => {
              setShowForm(false)
              setEditingChannel(null)
              qc.invalidateQueries({ queryKey: ['notification-channels'] })
              qc.invalidateQueries({ queryKey: ['notification-stats'] })
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ChannelFormModal({ channel, onClose, onSaved }: { channel: NotificationChannel | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isEdit = !!channel
  const [type, setType] = useState<ChannelType>(channel?.type as ChannelType ?? 'discord')
  const [name, setName] = useState(channel?.name ?? '')
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)
  const [config, setConfig] = useState<Record<string, string>>(channel?.config ?? {})
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null)

  const meta = getChannelMeta(type)

  const createMut = useMutation({
    mutationFn: () => createNotificationChannel({ name, type, config, enabled }),
    onSuccess: () => { toast.success('Channel created'); onSaved() },
    onError: (e) => setError(String(e)),
  })
  const updateMut = useMutation({
    mutationFn: () => updateNotificationChannel(channel!.id, { name, type, config, enabled }),
    onSuccess: () => { toast.success('Channel updated'); onSaved() },
    onError: (e) => setError(String(e)),
  })
  const testMut = useMutation({
    mutationFn: () => {
      if (isEdit) return testNotificationChannel(channel!.id)
      // For new channels, save first then test
      return createNotificationChannel({ name, type, config, enabled })
        .then(ch => testNotificationChannel(ch.id))
    },
    onSuccess: (data) => {
      if (data?.success) {
        setTestResult({ success: true, message: 'Test notification sent successfully!' })
        toast.success('Test sent!')
      } else {
        setTestResult({ success: false, message: data?.error || 'Test failed' })
        toast.error('Test failed', data?.error)
      }
    },
    onError: (e) => {
      setTestResult({ success: false, message: String(e) })
      toast.error('Test failed')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setTestResult(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (isEdit) { updateMut.mutate() } else { createMut.mutate() }
  }

  return (
    <Modal open={true} onClose={onClose} title={isEdit ? 'Edit Channel' : 'Add Channel'}>
      <div className="space-y-5">

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type selector */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Channel Type</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {CHANNEL_TYPES.map(t => {
                  const TIcon = t.icon
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { setType(t.value); setConfig({}); setTestResult(null) }}
                      className={clsx(
                        'flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-medium transition-all border',
                        type === t.value ? 'border-neon-cyan/40 bg-neon-cyan/10' : 'border-transparent bg-white/5 hover:bg-white/10'
                      )}
                      style={{ color: type === t.value ? t.color : 'var(--text-secondary)' }}
                    >
                      <TIcon className="h-5 w-5" />
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Channel Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`My ${meta.label} Channel`}
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors focus:border-neon-cyan/50"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Dynamic config fields based on channel type */}
          <div className="space-y-3">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {meta.label} Configuration
            </label>
            {meta.fields.map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-medium mb-1 ml-1" style={{ color: 'var(--text-tertiary)' }}>{f.label}</label>
                <input
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={config[f.key] ?? ''}
                  onChange={e => setConfig({ ...config, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                />
              </div>
            ))}
          </div>

          {/* Enabled toggle */}
          <Toggle checked={enabled} onChange={setEnabled} label={enabled ? 'Enabled' : 'Disabled'} />

          {/* Test result */}
          {testResult && (
            <div className={clsx(
              'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm',
              testResult.success ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'
            )}>
              {testResult.success ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              {testResult.message}
            </div>
          )}

          {error && <p className="text-sm text-neon-red">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            {/* Test Connection button */}
            {isEdit && (
              <Button
                variant="secondary"
                icon={<TestTube className="h-4 w-4" />}
                loading={testMut.isPending}
                onClick={() => testMut.mutate()}
                type="button"
              >
                {testMut.isPending ? 'Testing...' : 'Test Connection'}
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button
              variant="primary"
              type="submit"
              loading={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
