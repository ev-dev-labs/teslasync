import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, AlertTriangle, Save, Info } from 'lucide-react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Skeleton } from '@/components/feedback/Skeleton'
import { useMaintenanceState, useUpdateMaintenance } from '@/api/hooks/useAdmin'
import type { MaintenanceState } from '@/types/admin'

/**
 * Phase-46 / Prompt 04 — Service Mode admin panel.
 *
 * Lets an authenticated operator set the top-of-app banner state
 * (mode + message + auto-clear time). Surfaces an env-override warning
 * when TESLASYNC_SYSTEM_MODE is set so the operator understands why a
 * "Save" might persist to the DB but not visibly take effect for users
 * until the env var is cleared.
 *
 * The "Preview" block renders the same copy structure as
 * <MaintenanceBanner> so the operator can see what users will see
 * before clicking Save.
 *
 * NOTE: this panel ships as a sub-component of AdminPage.tsx so the
 * existing /admin route automatically picks it up — no router change
 * required.
 */

const MODE_OPTIONS: Array<{ value: 'ok' | 'degraded' | 'maintenance'; label: string }> = [
  { value: 'ok', label: 'serviceMode.admin.modes.ok' },
  { value: 'degraded', label: 'serviceMode.admin.modes.degraded' },
  { value: 'maintenance', label: 'serviceMode.admin.modes.maintenance' },
]

const MESSAGE_MAX = 280

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Render as the value an <input type="datetime-local"> understands.
  // (yyyy-MM-ddTHH:mm in local time so the operator can pick a wall-clock
  //  time; we serialize back to ISO/UTC before POST.)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(local: string): string | null {
  if (!local.trim()) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function MaintenanceModePanel() {
  const { t } = useTranslation()
  const { data, isLoading } = useMaintenanceState()
  const updateMut = useUpdateMaintenance()

  const persisted = data as MaintenanceState | undefined
  const [mode, setMode] = useState<'ok' | 'degraded' | 'maintenance'>('ok')
  const [message, setMessage] = useState('')
  const [untilLocal, setUntilLocal] = useState('')

  // Hydrate the form whenever the upstream snapshot changes (initial
  // load, post-save refetch, or another operator's poll arriving). Don't
  // overwrite local edits while a mutation is in flight.
  useEffect(() => {
    if (!persisted || updateMut.isPending) return
    setMode(persisted.mode)
    setMessage(persisted.maintenance_message ?? '')
    setUntilLocal(toLocalInputValue(persisted.maintenance_until ?? null))
  }, [persisted, updateMut.isPending])

  const isEnvOverride = persisted?.source === 'env'
  const charsLeft = MESSAGE_MAX - message.length

  const previewBody = useMemo(() => {
    if (mode === 'ok') return ''
    if (message.trim()) return message.trim()
    return mode === 'maintenance'
      ? t('serviceMode.banner.defaultMaintenance', 'Maintenance is in progress. Live data may be paused.')
      : t('serviceMode.banner.defaultDegraded', 'Some features may be slow or unavailable while we work on it.')
  }, [mode, message, t])

  const handleSave = () => {
    updateMut.mutate({
      mode,
      message: message.trim().slice(0, MESSAGE_MAX),
      until: mode === 'ok' ? null : fromLocalInputValue(untilLocal),
    })
  }

  return (
    <GlassPanel className="p-6" data-testid="maintenance-mode-panel">
      <span className="text-base font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
        <Wrench className="w-5 h-5 text-neon-cyan" />
        {t('serviceMode.admin.title', 'Service Mode')}
      </span>
      <span className="text-xs text-[var(--text-muted)] mb-4 block">
        {t('serviceMode.admin.subtitle', 'Control the top-of-app banner shown to all users.')}
      </span>

      {isEnvOverride && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2 text-sm text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <span>
            {t('serviceMode.admin.envOverride', 'Environment variable TESLASYNC_SYSTEM_MODE={{mode}} is currently overriding the database value. Updates here will persist but won\'t affect users until the env override is cleared.', { mode: persisted?.env_override_mode ?? '' })}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="maintenance-mode" className="text-xs uppercase tracking-wide text-[var(--text-muted)] block mb-1">
              {t('serviceMode.admin.modeLabel', 'Mode')}
            </label>
            <Select
              id="maintenance-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'ok' | 'degraded' | 'maintenance')}
              options={MODE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.label, opt.value) }))}
            />
          </div>

          <div>
            <label htmlFor="maintenance-message" className="text-xs uppercase tracking-wide text-[var(--text-muted)] block mb-1">
              {t('serviceMode.admin.messageLabel', 'Banner message')}
            </label>
            <Textarea
              id="maintenance-message"
              rows={3}
              maxLength={MESSAGE_MAX}
              placeholder={t('serviceMode.banner.defaultMaintenance', 'Maintenance is in progress. Live data may be paused.')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={mode === 'ok'}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-[var(--text-muted)]">
                {t('serviceMode.admin.messageHelp', 'Up to 280 characters. Shown when mode is degraded or maintenance.')}
              </span>
              <span className="text-xs font-mono text-[var(--text-muted)]" data-testid="maintenance-mode-charcount">
                {charsLeft}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="maintenance-until" className="text-xs uppercase tracking-wide text-[var(--text-muted)] block mb-1">
              {t('serviceMode.admin.untilLabel', 'Auto-clear at (optional)')}
            </label>
            <Input
              id="maintenance-until"
              type="datetime-local"
              value={untilLocal}
              onChange={(e) => setUntilLocal(e.target.value)}
              disabled={mode === 'ok'}
            />
            <span className="text-xs text-[var(--text-muted)] block mt-1">
              {t('serviceMode.admin.untilHelp', 'ISO 8601 timestamp; SPA renders a countdown until then.')}
            </span>
          </div>

          {mode !== 'ok' && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-3">
              <span className="text-xs uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-1 mb-2">
                <Info className="h-3 w-3" aria-hidden />
                {t('serviceMode.admin.preview', 'Preview')}
              </span>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {mode === 'maintenance'
                  ? t('serviceMode.banner.maintenanceTitle', 'Scheduled maintenance')
                  : t('serviceMode.banner.degradedTitle', 'Service is degraded')}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">{previewBody}</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSave}
              disabled={updateMut.isPending}
              data-testid="maintenance-mode-save"
            >
              {updateMut.isPending
                ? t('serviceMode.admin.saving', 'Saving…')
                : t('serviceMode.admin.save', 'Save')}
            </Button>
          </div>
        </div>
      )}
    </GlassPanel>
  )
}

export default MaintenanceModePanel
