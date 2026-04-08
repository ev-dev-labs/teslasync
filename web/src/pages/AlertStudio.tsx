/**
 * AlertStudio — full-featured CEP rule editor page.
 *
 * Lists existing rules, provides a visual builder, template library,
 * and manages persistence via the /api/v1/alerts/rules endpoint.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getNotificationChannels,
  AlertRule,
  RuleConditionTree,
} from '../api'
import { PageHeader, GlassPanel, FadeIn, EmptyState, Skeleton } from '../components/ui'
import RuleBuilder from '../components/RuleBuilder'
import { useToast } from '../components/Toast'
import {
  Zap, Plus, Save, Trash2, Copy, Bell, BellOff,
  AlertTriangle, AlertCircle, Info, Battery, Gauge, Lock,
  Car, Droplets, Clock, Pencil, Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

// ─── Severity config ─────────────────────────────────────────────────────────

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', hex: '#00f0ff' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', hex: '#f59e0b' },
  critical: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', hex: '#ef4444' },
} as const

type Severity = keyof typeof severityConfig

// ─── Templates ───────────────────────────────────────────────────────────────

interface RuleTemplate {
  name: string
  icon: React.ElementType
  severity: Severity
  msg_template: string
  cooldown_min: number
  conditions: RuleConditionTree
}

const ruleTemplates: RuleTemplate[] = [
  {
    name: 'Battery Low (< 20%)',
    icon: Battery,
    severity: 'warning',
    msg_template: 'Battery at {{BatteryLevel}}%',
    cooldown_min: 30,
    conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '<', value: 20 }] },
  },
  {
    name: 'Battery Full (≥ 90%)',
    icon: Battery,
    severity: 'info',
    msg_template: 'Battery reached {{BatteryLevel}}%',
    cooldown_min: 60,
    conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '>=', value: 90 }] },
  },
  {
    name: 'Drive Started',
    icon: Car,
    severity: 'info',
    msg_template: 'Drive started — gear is {{Gear}}',
    cooldown_min: 5,
    conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'D' }] },
  },
  {
    name: 'Drive Ended',
    icon: Car,
    severity: 'info',
    msg_template: 'Drive ended — gear is {{Gear}}',
    cooldown_min: 5,
    conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'P' }] },
  },
  {
    name: 'Charge Complete',
    icon: Zap,
    severity: 'info',
    msg_template: 'Charging complete at {{BatteryLevel}}%',
    cooldown_min: 60,
    conditions: { op: 'AND', rules: [{ signal: 'ChargeState', compare: 'changed_to', value: 'Complete' }] },
  },
  {
    name: 'Speed Limit Exceeded',
    icon: Gauge,
    severity: 'warning',
    msg_template: 'Speed {{VehicleSpeed}} km/h exceeded limit',
    cooldown_min: 15,
    conditions: { op: 'AND', rules: [{ signal: 'VehicleSpeed', compare: '>', value: 120 }] },
  },
  {
    name: 'Car Unlocked While Parked',
    icon: Lock,
    severity: 'critical',
    msg_template: 'Vehicle is unlocked and parked!',
    cooldown_min: 30,
    conditions: {
      op: 'AND',
      rules: [
        { signal: 'Locked', compare: 'is_false' },
        { signal: 'Gear', compare: '==', value: 'P' },
      ],
    },
  },
  {
    name: 'Tire Pressure Low',
    icon: Droplets,
    severity: 'warning',
    msg_template: 'Low tire pressure detected',
    cooldown_min: 60,
    conditions: { op: 'AND', rules: [{ signal: 'TpmsHardWarnings', compare: 'is_true' }] },
  },
]

// ─── Empty editor state ──────────────────────────────────────────────────────

interface EditorState {
  id?: number
  name: string
  type: string
  severity: Severity
  cooldown_min: number
  msg_template: string
  conditions: RuleConditionTree
  notify_channels: number[]
  enabled: boolean
}

function freshEditor(): EditorState {
  return {
    name: '',
    type: 'custom',
    severity: 'info',
    cooldown_min: 15,
    msg_template: '',
    conditions: { op: 'AND', rules: [{ signal: '', compare: '==', value: '' }] },
    notify_channels: [],
    enabled: true,
  }
}

function ruleToEditor(rule: AlertRule): EditorState {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    severity: (rule.severity as Severity) ?? 'info',
    cooldown_min: rule.cooldown_min ?? 15,
    msg_template: rule.msg_template ?? '',
    conditions: (rule.conditions as RuleConditionTree | null) ?? { op: 'AND', rules: [{ signal: '', compare: '==', value: '' }] },
    notify_channels: rule.notify_channels ?? [],
    enabled: rule.enabled,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AlertStudio() {
  const queryClient = useQueryClient()
  const toast = useToast()

  // Queries
  const { data: rules, isLoading } = useQuery({ queryKey: ['alert-rules'], queryFn: getAlertRules })
  const { data: channels } = useQuery({ queryKey: ['notification-channels'], queryFn: getNotificationChannels })

  // Editor state
  const [editor, setEditor] = useState<EditorState>(freshEditor)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  const isEditing = selectedId !== null

  // Mutations
  const saveMut = useMutation({
    mutationFn: async (state: EditorState) => {
      const payload = {
        name: state.name,
        type: state.type || 'custom',
        enabled: state.enabled,
        threshold: 0,
        vehicle_id: null as number | null,
        conditions: state.conditions,
        severity: state.severity,
        cooldown_min: state.cooldown_min,
        msg_template: state.msg_template,
        notify_channels: state.notify_channels,
      }
      if (state.id) {
        return updateAlertRule(state.id, payload)
      }
      return createAlertRule(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(isEditing ? 'Rule updated' : 'Rule created')
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error('Failed to save rule'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAlertRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success('Rule deleted')
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error('Failed to delete rule'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateAlertRule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  // Handlers
  const handleSelectRule = useCallback((rule: AlertRule) => {
    setSelectedId(rule.id)
    setEditor(ruleToEditor(rule))
  }, [])

  const handleNewRule = useCallback(() => {
    setSelectedId(null)
    setEditor(freshEditor())
  }, [])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    setSelectedId(null)
    setEditor({
      name: tpl.name,
      type: 'custom',
      severity: tpl.severity,
      cooldown_min: tpl.cooldown_min,
      msg_template: tpl.msg_template,
      conditions: JSON.parse(JSON.stringify(tpl.conditions)),
      notify_channels: [],
      enabled: true,
    })
    setShowTemplates(false)
  }, [])

  // Filter CEP rules (have conditions)
  const cepRules = useMemo(() => (rules ?? []).filter(r => r.conditions), [rules])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Studio"
        subtitle="Create custom rules from any Fleet Telemetry signal"
        icon={<Zap className="h-6 w-6 text-neon-cyan" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text-primary)] bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              <Sparkles className="h-3.5 w-3.5 text-neon-amber" /> Templates
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 rounded-lg transition-colors"
              onClick={handleNewRule}
            >
              <Plus className="h-3.5 w-3.5" /> New Rule
            </button>
          </div>
        }
      />

      {/* Template library */}
      {showTemplates && (
        <FadeIn>
          <GlassPanel className="p-4">
            <p className="text-sm font-medium text-[var(--text-primary)] mb-3">Rule Templates</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {ruleTemplates.map(tpl => {
                const Icon = tpl.icon
                const sev = severityConfig[tpl.severity]
                return (
                  <button
                    key={tpl.name}
                    className="glass-panel p-3 text-left hover:border-neon-cyan/30 transition-all group"
                    onClick={() => handleCloneTemplate(tpl)}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={clsx('rounded-lg p-1.5', sev.bg)}>
                        <Icon className={clsx('h-3.5 w-3.5', sev.color)} />
                      </div>
                      <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-neon-cyan transition-colors">{tpl.name}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">{tpl.msg_template}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <Copy className="h-3 w-3 text-[var(--text-muted)]" />
                      <span className="text-[10px] text-[var(--text-muted)]">Click to use</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Rule list (sidebar) ────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-3">
          <GlassPanel className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">Rules</p>
              <span className="text-[10px] text-[var(--text-muted)]">{cepRules.length} rule{cepRules.length !== 1 ? 's' : ''}</span>
            </div>

            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            )}

            {!isLoading && cepRules.length === 0 && (
              <EmptyState
                icon={<Bell className="h-8 w-8 text-[var(--text-muted)]" />}
                title="No CEP rules yet"
                description="Create your first rule or pick a template above."
              />
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {cepRules.map(rule => {
                const sev = severityConfig[(rule.severity as Severity) ?? 'info'] ?? severityConfig.info
                const SevIcon = sev.icon
                const active = selectedId === rule.id
                return (
                  <button
                    key={rule.id}
                    className={clsx(
                      'w-full text-left glass-panel p-3 transition-all',
                      active ? 'border-neon-cyan/30 bg-neon-cyan/5' : 'hover:border-white/10',
                    )}
                    onClick={() => handleSelectRule(rule)}
                  >
                    <div className="flex items-center gap-2">
                      <SevIcon className={clsx('h-3.5 w-3.5 shrink-0', sev.color)} />
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{rule.name || 'Untitled'}</span>
                      <button
                        className="shrink-0"
                        onClick={e => { e.stopPropagation(); toggleMut.mutate({ id: rule.id, enabled: !rule.enabled }) }}
                        title={rule.enabled ? 'Disable' : 'Enable'}
                      >
                        {rule.enabled
                          ? <Bell className="h-3.5 w-3.5 text-neon-green" />
                          : <BellOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-muted)]">
                      {rule.last_fired_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatDateTime(rule.last_fired_at)}
                        </span>
                      )}
                      {(rule.fire_count ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" /> {rule.fire_count}×
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </GlassPanel>
        </div>

        {/* ── Rule editor (main) ─────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-4">
          <GlassPanel className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Pencil className="h-4 w-4 text-neon-cyan" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {isEditing ? 'Edit Rule' : 'New Rule'}
              </p>
            </div>

            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Name</label>
                <input
                  className="glass-input w-full"
                  placeholder="My alert rule"
                  value={editor.name}
                  onChange={e => setEditor(s => ({ ...s, name: e.target.value }))}
                />
              </div>

              {/* Severity */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Severity</label>
                <select
                  className="glass-input w-full"
                  value={editor.severity}
                  onChange={e => setEditor(s => ({ ...s, severity: e.target.value as Severity }))}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Cooldown + Message template */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Cooldown (minutes)</label>
                <input
                  type="number"
                  min={0}
                  className="glass-input w-full"
                  value={editor.cooldown_min}
                  onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  Message Template
                  <span className="text-[var(--text-muted)] ml-1 normal-case tracking-normal">{'Use {{SignalName}}'}</span>
                </label>
                <input
                  className="glass-input w-full"
                  placeholder="Battery at {{BatteryLevel}}%"
                  value={editor.msg_template}
                  onChange={e => setEditor(s => ({ ...s, msg_template: e.target.value }))}
                />
              </div>
            </div>

            {/* Notification channels */}
            {channels && channels.length > 0 && (
              <div className="mb-4">
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Notification Channels</label>
                <div className="flex flex-wrap gap-2">
                  {channels.map(ch => {
                    const isSelected = editor.notify_channels.includes(ch.id)
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        className={clsx(
                          'px-3 py-1.5 text-xs rounded-lg transition-colors border',
                          isSelected
                            ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                            : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:border-white/20',
                        )}
                        onClick={() => {
                          setEditor(s => ({
                            ...s,
                            notify_channels: isSelected
                              ? s.notify_channels.filter(id => id !== ch.id)
                              : [...s.notify_channels, ch.id],
                          }))
                        }}
                      >
                        {ch.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Condition builder */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">Conditions</label>
              <RuleBuilder
                value={editor.conditions}
                onChange={conditions => setEditor(s => ({ ...s, conditions }))}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors',
                  'bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30',
                  saveMut.isPending && 'opacity-60 pointer-events-none',
                )}
                onClick={() => saveMut.mutate(editor)}
                disabled={!editor.name.trim()}
              >
                <Save className="h-3.5 w-3.5" />
                {saveMut.isPending ? 'Saving…' : isEditing ? 'Update Rule' : 'Create Rule'}
              </button>

              {isEditing && (
                <button
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-neon-red/10 text-neon-red hover:bg-neon-red/20 transition-colors"
                  onClick={() => { if (editor.id) deleteMut.mutate(editor.id) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}

              <button
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors ml-auto"
                onClick={handleNewRule}
              >
                Reset
              </button>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  )
}
