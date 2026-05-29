import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import {
  GlassPanel,
  IconBox,
  Button,
  Toggle,
  Badge,
  Input,
  Select,
  type SelectOption,
} from '@/components/ui'
import { Spinner, EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import {
  useQuietHours,
  useSaveQuietHours,
  useDeleteQuietHours,
} from '@/api/hooks/useNotifications'
import type { QuietHoursWindow, QuietHoursWindowInput } from '@/api/hooks/useNotifications'

// Quiet hours / Do-Not-Disturb settings panel.
//
// CRUD over /api/v1/notifications/quiet-hours. Per-user; uses the
// caller's ForwardAuth subject server-side. Each row defines a local-
// time window (HH:MM start + end + IANA timezone), a weekday bitmask
// (Sun=1..Sat=64), and a list of severities that bypass the gate.

const SEVERITY_CHOICES: ReadonlyArray<{ value: 'info' | 'warn' | 'critical'; labelKey: string; fallback: string }> = [
  { value: 'critical', labelKey: 'quietHours.severity.critical', fallback: 'Critical' },
  { value: 'warn', labelKey: 'quietHours.severity.warn', fallback: 'Warning' },
  { value: 'info', labelKey: 'quietHours.severity.info', fallback: 'Info' },
]

// Weekday bit positions match models.QuietHoursWeekday* on the server:
// Sun=1<<0..Sat=1<<6. Order matches Date#getDay().
const WEEKDAYS: ReadonlyArray<{ bit: number; key: string; fallback: string }> = [
  { bit: 1 << 0, key: 'quietHours.weekday.sun', fallback: 'Sun' },
  { bit: 1 << 1, key: 'quietHours.weekday.mon', fallback: 'Mon' },
  { bit: 1 << 2, key: 'quietHours.weekday.tue', fallback: 'Tue' },
  { bit: 1 << 3, key: 'quietHours.weekday.wed', fallback: 'Wed' },
  { bit: 1 << 4, key: 'quietHours.weekday.thu', fallback: 'Thu' },
  { bit: 1 << 5, key: 'quietHours.weekday.fri', fallback: 'Fri' },
  { bit: 1 << 6, key: 'quietHours.weekday.sat', fallback: 'Sat' },
]

const DEFAULT_BYPASS = ['critical']
const ALL_WEEKDAYS = 127

interface DraftWindow {
  id?: number
  enabled: boolean
  start_local: string
  end_local: string
  timezone: string
  weekdays: number
  bypass_severities: string[]
}

function makeDraft(initial?: QuietHoursWindow): DraftWindow {
  if (initial) {
    return {
      id: initial.id,
      enabled: initial.enabled,
      start_local: initial.start_local,
      end_local: initial.end_local,
      timezone: initial.timezone,
      weekdays: initial.weekdays,
      bypass_severities: initial.bypass_severities ?? [],
    }
  }
  let tz = 'UTC'
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    tz = 'UTC'
  }
  return {
    enabled: true,
    start_local: '23:00',
    end_local: '07:00',
    timezone: tz,
    weekdays: ALL_WEEKDAYS,
    bypass_severities: [...DEFAULT_BYPASS],
  }
}

function listTimezones(currentTz: string): SelectOption[] {
  // Intl.supportedValuesOf may not exist on older browsers; fall back
  // to a small curated list plus the user's resolved timezone.
  const fallback = [
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
  ]
  let zones: string[] = fallback
  const intlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  if (typeof intlAny.supportedValuesOf === 'function') {
    try {
      zones = intlAny.supportedValuesOf('timeZone')
    } catch {
      zones = fallback
    }
  }
  if (currentTz && !zones.includes(currentTz)) {
    zones = [currentTz, ...zones]
  }
  return zones.map((z) => ({ value: z, label: z }))
}

interface ValidationResult {
  ok: boolean
  message?: string
  field?: 'start_local' | 'end_local' | 'timezone' | 'weekdays' | 'bypass_severities'
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function validateDraft(d: DraftWindow): ValidationResult {
  if (!HHMM.test(d.start_local)) return { ok: false, field: 'start_local', message: 'invalid' }
  if (!HHMM.test(d.end_local)) return { ok: false, field: 'end_local', message: 'invalid' }
  if (d.start_local === d.end_local) return { ok: false, field: 'end_local', message: 'equal' }
  if (!d.timezone) return { ok: false, field: 'timezone', message: 'required' }
  if (d.weekdays <= 0 || d.weekdays > 127) return { ok: false, field: 'weekdays', message: 'required' }
  if (d.bypass_severities.length === 0) {
    // Allowed — empty bypass means everything is deferred during the
    // window. Still pass — server accepts empty array.
  }
  return { ok: true }
}

function summarizeWindow(w: QuietHoursWindow): string {
  return `${w.start_local} → ${w.end_local} (${w.timezone})`
}

// formatNextChange returns a short human label for the next time the
// supplied window changes state ("starts at 23:00", "ends at 07:00"
// etc). Pure: caller passes `now` so test code can pin the clock.
export function nextWindowChangeLabel(w: QuietHoursWindow, now: Date): string | null {
  if (!w.enabled) return null
  const today = now.getDay() // 0=Sun..6=Sat
  const todayBit = 1 << today
  const onToday = (w.weekdays & todayBit) !== 0
  if (!onToday) return null
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const start = parseHHMM(w.start_local)
  const end = parseHHMM(w.end_local)
  if (start == null || end == null) return null
  const wraps = end <= start
  if (wraps) {
    if (minutesNow < end) return `ends at ${w.end_local}`
    if (minutesNow >= start) return `ends tomorrow at ${w.end_local}`
    return `starts at ${w.start_local}`
  }
  if (minutesNow < start) return `starts at ${w.start_local}`
  if (minutesNow < end) return `ends at ${w.end_local}`
  return `starts tomorrow at ${w.start_local}`
}

function parseHHMM(s: string): number | null {
  if (!HHMM.test(s)) return null
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

// QuietHoursPanelProps lets a sibling AI surface (the
// quiet-hours-suggestion advisor on QuietHoursPage) seed the
// "Add window" form with a typed draft via "Apply to form". The
// seed is applied imperatively when its identity changes — the
// panel always retains the user's manual control over the Save
// button and the canonical write path.
//
// `onSeedConsumed` is fired AFTER the seed has been copied into
// local form state so the parent can clear its own pending-seed
// pointer and keep the React data flow one-way (no infinite
// re-seeding loop).
export interface QuietHoursPanelProps {
  seedDraft?: QuietHoursWindowInput | null
  onSeedConsumed?: () => void
}

export function QuietHoursPanel(props: QuietHoursPanelProps = {}) {
  const { seedDraft, onSeedConsumed } = props
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: rawWindows, isLoading } = useQuietHours()
  const save = useSaveQuietHours()
  const remove = useDeleteQuietHours()
  const windows = useMemo(() => rawWindows ?? [], [rawWindows])

  const [draft, setDraft] = useState<DraftWindow | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Apply a seedDraft from the AI advisor exactly once per
  // identity. The "Apply to form" handler in
  // <AIQuietHoursSuggestion> forwards a typed
  // QuietHoursWindowInput through `seedDraft`; the panel copies
  // the typed scalars into local form state so the user can
  // tweak the proposed values and then press the canonical Save
  // button. The Save button is the sole write path; the AI
  // surface never persists state directly.
  const lastConsumedSeed = useRef<QuietHoursWindowInput | null>(null)
  useEffect(() => {
    if (!seedDraft) return
    if (lastConsumedSeed.current === seedDraft) return
    lastConsumedSeed.current = seedDraft
    setEditingId(null)
    const base = makeDraft()
    setDraft({
      enabled: seedDraft.enabled ?? true,
      start_local: seedDraft.start_local ?? base.start_local,
      end_local: seedDraft.end_local ?? base.end_local,
      timezone: seedDraft.timezone ?? base.timezone,
      weekdays: seedDraft.weekdays ?? ALL_WEEKDAYS,
      bypass_severities: [...(seedDraft.bypass_severities ?? DEFAULT_BYPASS)],
    })
    setValidationError(null)
    onSeedConsumed?.()
  }, [seedDraft, onSeedConsumed])

  const tzOptions = useMemo(
    () => listTimezones(draft?.timezone ?? 'UTC'),
    [draft?.timezone],
  )

  const startEdit = (w: QuietHoursWindow) => {
    setEditingId(w.id)
    setDraft(makeDraft(w))
    setValidationError(null)
  }

  const startCreate = () => {
    setEditingId(null)
    setDraft(makeDraft())
    setValidationError(null)
  }

  const cancel = () => {
    setDraft(null)
    setEditingId(null)
    setValidationError(null)
  }

  const submit = () => {
    if (!draft) return
    const v = validateDraft(draft)
    if (!v.ok) {
      const messages: Record<string, string> = {
        start_local: t('quietHours.error.startInvalid', 'Start must be HH:MM (24-hour).'),
        end_local: v.message === 'equal'
          ? t('quietHours.error.endEqual', 'End must differ from start.')
          : t('quietHours.error.endInvalid', 'End must be HH:MM (24-hour).'),
        timezone: t('quietHours.error.timezoneRequired', 'Timezone is required.'),
        weekdays: t('quietHours.error.weekdaysRequired', 'Pick at least one weekday.'),
        bypass_severities: t('quietHours.error.bypassRequired', 'Pick at least one severity.'),
      }
      setValidationError(messages[v.field ?? 'start_local'] ?? messages.start_local)
      return
    }
    setValidationError(null)
    const payload: QuietHoursWindowInput & { id?: number } = {
      enabled: draft.enabled,
      start_local: draft.start_local,
      end_local: draft.end_local,
      timezone: draft.timezone,
      weekdays: draft.weekdays,
      bypass_severities: draft.bypass_severities,
    }
    if (draft.id) payload.id = draft.id
    save.mutate(payload, {
      onSuccess: () => {
        toast.success(
          payload.id
            ? t('toast.quietHours.updated', 'Quiet hours window updated')
            : t('toast.quietHours.created', 'Quiet hours window created'),
        )
        cancel()
      },
      onError: (err: Error) => {
        toast.error(t('toast.quietHours.saveError', 'Failed to save quiet hours window'), err.message)
      },
    })
  }

  const removeWindow = (w: QuietHoursWindow) => {
    remove.mutate(w.id, {
      onSuccess: () => {
        toast.success(t('toast.quietHours.deleted', 'Quiet hours window removed'))
      },
      onError: (err: Error) => {
        toast.error(t('toast.quietHours.deleteError', 'Failed to delete quiet hours window'), err.message)
      },
    })
  }

  const toggleWeekday = (bit: number) => {
    if (!draft) return
    setDraft({ ...draft, weekdays: draft.weekdays ^ bit })
  }

  const toggleSeverity = (sev: string) => {
    if (!draft) return
    const has = draft.bypass_severities.includes(sev)
    setDraft({
      ...draft,
      bypass_severities: has
        ? draft.bypass_severities.filter((s) => s !== sev)
        : [...draft.bypass_severities, sev],
    })
  }

  const now = new Date()

  return (
    <FadeIn delay={0.135}>
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBox color="purple">
              <Moon className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('quietHours.title', 'Quiet hours / Do-Not-Disturb')}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {t('quietHours.subtitle', 'Defer non-critical notifications during sleep, meetings, or other time-of-day windows.')}
              </p>
            </div>
          </div>
          {!draft && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={startCreate}
              data-testid="quiet-hours-add"
            >
              {t('quietHours.addWindow', 'Add window')}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Spinner size="sm" />
            <span>{t('quietHours.loading', 'Loading quiet-hours windows…')}</span>
          </div>
        ) : windows.length === 0 && !draft ? (
          <EmptyState
            /* no-action: empty inbox state — primary CTA already lives in the panel header */
            icon={<Moon className="h-10 w-10" />}
            message={t('quietHours.empty', 'No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings.')}
          />
        ) : (
          <ul className="space-y-3" data-testid="quiet-hours-list">
            {windows.map((w) => {
              const nextLabel = nextWindowChangeLabel(w, now)
              return (
                <li
                  key={w.id}
                  className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-4 space-y-2"
                  data-testid={`quiet-hours-row-${w.id}`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <Badge variant={w.enabled ? 'success' : 'neutral'}>
                        {w.enabled ? t('quietHours.enabled', 'Enabled') : t('quietHours.disabled', 'Disabled')}
                      </Badge>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {summarizeWindow(w)}
                      </span>
                      {nextLabel && (
                        <span className="text-xs text-[var(--text-muted)]">{nextLabel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => startEdit(w)}
                      >
                        {t('quietHours.edit', 'Edit')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => removeWindow(w)}
                        disabled={remove.isPending}
                      >
                        {t('quietHours.delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map(({ bit, key, fallback }) => {
                      const on = (w.weekdays & bit) !== 0
                      return (
                        <span
                          key={bit}
                          className={
                            on
                              ? 'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-300/10 text-purple-300 ring-1 ring-purple-300/30'
                              : 'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]'
                          }
                        >
                          {t(key, fallback)}
                        </span>
                      )
                    })}
                  </div>
                  {w.bypass_severities.length > 0 && (
                    <div className="text-xs text-[var(--text-muted)]">
                      {t('quietHours.bypassLabel', 'Always allow:')}{' '}
                      {w.bypass_severities.map((s) => (
                        <Badge key={s} variant="warning" className="ml-1">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {draft && (
          <div
            className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-4 space-y-4"
            data-testid="quiet-hours-form"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {editingId
                  ? t('quietHours.form.editTitle', 'Edit window')
                  : t('quietHours.form.addTitle', 'New quiet-hours window')}
              </h3>
              <Toggle
                checked={draft.enabled}
                onChange={(v) => setDraft({ ...draft, enabled: v })}
                label={t('quietHours.form.enabled', 'Enabled')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="qh-start" className="block text-xs text-[var(--text-muted)] mb-1">
                  {t('quietHours.form.start', 'Start')}
                </label>
                <Input
                  id="qh-start"
                  type="time"
                  value={draft.start_local}
                  onChange={(e) => setDraft({ ...draft, start_local: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="qh-end" className="block text-xs text-[var(--text-muted)] mb-1">
                  {t('quietHours.form.end', 'End')}
                </label>
                <Input
                  id="qh-end"
                  type="time"
                  value={draft.end_local}
                  onChange={(e) => setDraft({ ...draft, end_local: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label htmlFor="qh-tz" className="block text-xs text-[var(--text-muted)] mb-1">
                {t('quietHours.form.timezone', 'Timezone (IANA)')}
              </label>
              <Select
                id="qh-tz"
                value={draft.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                options={tzOptions}
              />
            </div>

            <div>
              <span className="block text-xs text-[var(--text-muted)] mb-2">
                {t('quietHours.form.weekdays', 'Weekdays')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(({ bit, key, fallback }) => {
                  const on = (draft.weekdays & bit) !== 0
                  return (
                    <button
                      key={bit}
                      type="button"
                      onClick={() => toggleWeekday(bit)}
                      className={
                        on
                          ? 'inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-purple-300/15 text-purple-300 ring-1 ring-purple-300/40 transition-colors'
                          : 'inline-flex items-center px-3 py-1 rounded-md text-xs text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)] hover:ring-purple-300/40 transition-colors'
                      }
                      aria-pressed={on}
                      data-testid={`qh-weekday-${bit}`}
                    >
                      {t(key, fallback)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="block text-xs text-[var(--text-muted)] mb-2">
                {t('quietHours.form.bypass', 'Always allow these severities through')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITY_CHOICES.map(({ value, labelKey, fallback }) => {
                  const on = draft.bypass_severities.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleSeverity(value)}
                      className={
                        on
                          ? 'inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-amber-300/15 text-amber-300 ring-1 ring-amber-300/40 transition-colors'
                          : 'inline-flex items-center px-3 py-1 rounded-md text-xs text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)] hover:ring-amber-300/40 transition-colors'
                      }
                      aria-pressed={on}
                      data-testid={`qh-severity-${value}`}
                    >
                      {t(labelKey, fallback)}
                    </button>
                  )
                })}
              </div>
            </div>

            {validationError && (
              <p className="text-xs text-rose-300" role="alert" data-testid="quiet-hours-error">
                {validationError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <Button
                variant="secondary"
                size="sm"
                icon={<X className="h-4 w-4" />}
                onClick={cancel}
              >
                {t('quietHours.form.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Check className="h-4 w-4" />}
                onClick={submit}
                disabled={save.isPending}
                data-testid="quiet-hours-save"
              >
                {editingId ? t('quietHours.form.update', 'Update') : t('quietHours.form.create', 'Create')}
              </Button>
            </div>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
