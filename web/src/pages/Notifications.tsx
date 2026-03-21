import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, Plus, Trash2, TestTube, ToggleLeft, ToggleRight,
  Send, MessageSquare, Mail, Webhook, Hash, Megaphone, Smartphone,
  CheckCircle, XCircle, Clock, BarChart3, X, Pencil, ChevronDown, ChevronUp,
  Loader2, PlayCircle,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getNotificationChannels, createNotificationChannel, updateNotificationChannel,
  deleteNotificationChannel, toggleNotificationChannel, testNotificationChannel,
  getNotificationLogs, getNotificationStats,
  NotificationChannel, NotificationLog,
} from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, EmptyState } from '../components/ui'
import { useToast } from '../components/Toast'

interface TestResult {
  status: 'success' | 'failed'
  message: string
  latency: number
  time: Date
}

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

function formatTestTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Notifications() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showForm, setShowForm] = useState(false)
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({})
  const [testingAll, setTestingAll] = useState(false)

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
    mutationFn: async (channelId: number) => {
      const start = performance.now()
      const data = await testNotificationChannel(channelId)
      const latency = Math.round(performance.now() - start)
      return { data, latency, channelId }
    },
    onSuccess: ({ data, latency, channelId }) => {
      const ch = channels.find(c => c.id === channelId)
      const name = ch?.name ?? 'Channel'
      const type = ch?.type ?? 'channel'
      if (data?.success) {
        setTestResults(prev => ({ ...prev, [channelId]: { status: 'success', message: `Test sent successfully via ${type} in ${latency}ms`, latency, time: new Date() } }))
        toast.success(`${name}: test sent successfully!`)
      } else {
        setTestResults(prev => ({ ...prev, [channelId]: { status: 'failed', message: data?.error || 'Unknown error', latency, time: new Date() } }))
        toast.error(`${name}: test failed`, data?.error || 'Unknown error')
      }
    },
    onError: (_err, channelId) => {
      const name = channels.find(c => c.id === channelId)?.name ?? 'Channel'
      setTestResults(prev => ({ ...prev, [channelId]: { status: 'failed', message: String(_err), latency: 0, time: new Date() } }))
      toast.error(`${name}: test failed`)
    },
  })

  const handleTestAll = useCallback(async () => {
    const enabledChannels = channels.filter(c => c.enabled)
    if (enabledChannels.length === 0) {
      toast.error('No enabled channels to test')
      return
    }
    setTestingAll(true)
    for (const ch of enabledChannels) {
      try {
        const start = performance.now()
        const data = await testNotificationChannel(ch.id)
        const latency = Math.round(performance.now() - start)
        if (data?.success) {
          setTestResults(prev => ({ ...prev, [ch.id]: { status: 'success', message: `Test sent via ${ch.type} in ${latency}ms`, latency, time: new Date() } }))
        } else {
          setTestResults(prev => ({ ...prev, [ch.id]: { status: 'failed', message: data?.error || 'Unknown error', latency, time: new Date() } }))
        }
      } catch (err) {
        setTestResults(prev => ({ ...prev, [ch.id]: { status: 'failed', message: String(err), latency: 0, time: new Date() } }))
      }
    }
    setTestingAll(false)
    toast.success(`Tested ${enabledChannels.length} channels`)
  }, [channels, toast])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notification Center"
        subtitle="Manage notification channels, view delivery logs, and monitor delivery stats"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestAll}
              disabled={testingAll || channels.filter(c => c.enabled).length === 0}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-neon-green/10 text-neon-green hover:bg-neon-green/20 border border-neon-green/20 transition-colors disabled:opacity-50"
            >
              {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {testingAll ? 'Testing...' : 'Test All'}
            </button>
            <button
              onClick={() => { setEditingChannel(null); setShowForm(true) }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 border border-neon-cyan/20 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Channel
            </button>
          </div>
        }
      />

      {/* Stats cards */}
      <FadeIn>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Sent', value: stats.sent, icon: CheckCircle, color: 'text-neon-green', bg: 'bg-neon-green/10', ring: 'ring-neon-green/20' },
              { label: 'Failed', value: stats.failed, icon: XCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', ring: 'ring-neon-red/20' },
              { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-neon-amber', bg: 'bg-neon-amber/10', ring: 'ring-neon-amber/20' },
              { label: 'Active Channels', value: `${stats.enabled_channels}/${stats.total_channels}`, icon: Bell, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', ring: 'ring-neon-cyan/20' },
            ].map(s => (
              <GlassPanel key={s.label} className="p-4 flex items-center gap-3">
                <div className={clsx('rounded-xl p-2.5 ring-1', s.bg, s.ring)}>
                  <s.icon className={clsx('h-5 w-5', s.color)} />
                </div>
                <div>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
                </div>
              </GlassPanel>
            ))}
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
            const result = testResults[ch.id]
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
                          <span className={clsx(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                            ch.enabled ? 'bg-neon-green/10 text-neon-green' : 'bg-white/5 text-[var(--text-muted)]'
                          )}>
                            <span className={clsx('h-1.5 w-1.5 rounded-full', ch.enabled ? 'bg-neon-green animate-pulse' : 'bg-gray-600')} />
                            {ch.enabled ? 'Active' : 'Disabled'}
                          </span>
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
                    <button
                      onClick={() => testMut.mutate(ch.id)}
                      disabled={isTestingThis}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors disabled:opacity-50"
                    >
                      {isTestingThis ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <TestTube className="h-3.5 w-3.5" />
                      )}
                      {isTestingThis ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => { setEditingChannel(ch); setShowForm(true) }}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete "${ch.name}"?`)) deleteMut.mutate(ch.id) }}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-neon-red/70 hover:bg-neon-red/10 transition-colors ml-auto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Test result inline */}
                  {result && (
                    <div className={clsx(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                      result.status === 'success' ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'
                    )}>
                      {result.status === 'success' ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{result.status === 'success' ? `✅ ${result.message}` : `❌ ${result.message}`}</span>
                    </div>
                  )}

                  {/* Last test status */}
                  {result && (
                    <span className="text-xs text-[var(--text-muted)]">
                      Last tested: {formatTestTimeAgo(result.time)} — {result.status === 'success' ? '✅' : '❌'} {result.status === 'success' ? `OK (${result.latency}ms)` : 'Failed'}
                    </span>
                  )}
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

      {/* Test All Results Summary */}
      {Object.keys(testResults).length > 0 && (
        <FadeIn delay={0.12}>
          <GlassPanel className="overflow-x-auto">
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--glass-border)' }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <TestTube className="h-4 w-4 text-neon-cyan" /> Test Results Summary
              </h3>
              <button
                onClick={() => setTestResults({})}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Clear
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  {['Channel', 'Status', 'Latency', 'Message', 'Tested At'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(testResults).map(([idStr, res]) => {
                  const id = Number(idStr)
                  const ch = channels.find(c => c.id === id)
                  const meta = ch ? getChannelMeta(ch.type) : null
                  const CIcon = meta?.icon ?? Bell
                  return (
                    <tr key={id} className="border-b last:border-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CIcon className="h-3.5 w-3.5" style={{ color: meta?.color ?? 'var(--text-muted)' }} />
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{ch?.name ?? `#${id}`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          res.status === 'success' ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'
                        )}>
                          {res.status === 'success' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {res.status === 'success' ? 'OK' : 'Failed'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{res.latency}ms</td>
                      <td className="px-4 py-3 text-xs max-w-[250px] truncate" style={{ color: 'var(--text-tertiary)' }}>{res.message}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>{res.time.toLocaleTimeString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </GlassPanel>
        </FadeIn>
      )}

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
                        {new Date(log.created_at).toLocaleString()}
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
                        <span className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          log.status === 'sent' && 'bg-neon-green/10 text-neon-green',
                          log.status === 'failed' && 'bg-neon-red/10 text-neon-red',
                          log.status === 'pending' && 'bg-neon-amber/10 text-neon-amber',
                        )}>
                          {log.status === 'sent' && <CheckCircle className="h-3 w-3" />}
                          {log.status === 'failed' && <XCircle className="h-3 w-3" />}
                          {log.status === 'pending' && <Clock className="h-3 w-3" />}
                          {log.status}
                        </span>
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="glass-panel p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-2" style={{ background: `${meta.color}15` }}>
              <meta.icon className="h-5 w-5" style={{ color: meta.color }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {isEdit ? 'Edit Channel' : 'Add Channel'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type selector */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Channel Type</label>
              <div className="grid grid-cols-4 gap-2">
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
          <label className="flex items-center gap-3 cursor-pointer">
            <button type="button" onClick={() => setEnabled(!enabled)}>
              {enabled ? <ToggleRight className="h-6 w-6 text-neon-green" /> : <ToggleLeft className="h-6 w-6 text-[var(--text-muted)]" />}
            </button>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>

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
              <button
                type="button"
                onClick={() => testMut.mutate()}
                disabled={testMut.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                style={{ color: 'var(--text-secondary)' }}
              >
                {testMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4" />
                )}
                {testMut.isPending ? 'Testing...' : 'Test Connection'}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-white/5 transition-colors" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="rounded-xl px-5 py-2 text-sm font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 border border-neon-cyan/20 transition-colors disabled:opacity-50"
            >
              {(createMut.isPending || updateMut.isPending) ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
