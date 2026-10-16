import { IconButton } from '@/components/ui/IconButton';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import {
  GlassPanel,
  IconBox,
  Button,
  ConfirmDialog,
  ErrorText,
  PanelTitle,
  Heading,
  HelperText,
  Text,
  Toggle,
  Badge,
  Input,
  Select,
  type SelectOption,
} from '@/components/ui'
import { ListSkeleton, EmptyState } from '@/components/feedback'
import { VisuallyHidden } from '@/components/a11y'
import { FadeIn } from '@/components/motion'
import { SourceContent } from '@/components/layout'
import { deriveDataState } from '@/api/dataState'
import { useConfirm } from '@/hooks/useConfirm'
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard'
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
  const { t: tCommon } = useTranslation()
  const windowsQuery = useQuietHours()
  const windowsState = deriveDataState(windowsQuery)
  const { data: rawWindows } = windowsQuery
  const save = useSaveQuietHours()
  const remove = useDeleteQuietHours()
  const { confirm: confirmDelete, dialogProps: deleteDialogProps } = useConfirm()
  const { confirm: confirmReplace, dialogProps: replacementDialogProps } = useConfirm()
  const windows = useMemo(() => rawWindows ?? [], [rawWindows])

  const [draft, setDraft] = useState<DraftWindow | null>(null)
  const [initialDraft, setInitialDraft] = useState<DraftWindow | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [validationField, setValidationField] = useState<ValidationResult['field']>(undefined)
  const currentDraft = useRef(draft)
  const savingDraft = useRef<DraftWindow | null>(null)
  const [saveInFlight, setSaveInFlight] = useState(false)
  const setCurrentDraft = useCallback((next: DraftWindow | null) => {
    currentDraft.current = next
    setDraft(next)
  }, [])

  // Apply a seedDraft from the AI advisor exactly once per
  // identity. The "Apply to form" handler in
  // <AIQuietHoursSuggestion> forwards a typed
  // QuietHoursWindowInput through `seedDraft`; the panel copies
  // the typed scalars into local form state so the user can
  // tweak the proposed values and then press the canonical Save
  // button. The Save button is the sole write path; the AI
  // surface never persists state directly.
  const lastConsumedSeed = useRef<QuietHoursWindowInput | null>(null)
  const latestSeed = useRef(seedDraft)
  const tzOptions = useMemo(
    () => listTimezones(draft?.timezone ?? 'UTC'),
    [draft?.timezone],
  )

  const startEdit = async (w: QuietHoursWindow) => {
    if (savingDraft.current || save.isPending) return
    if (draftIsDirty && !await requestReplacement()) return
    if (savingDraft.current || save.isPending) return
    const nextDraft = makeDraft(w)
    setEditingId(w.id)
    setCurrentDraft(nextDraft)
    setInitialDraft(nextDraft)
    setValidationError(null)
    setValidationField(undefined)
  }

  const startCreate = () => {
    const nextDraft = makeDraft()
    setEditingId(null)
    setCurrentDraft(nextDraft)
    setInitialDraft(nextDraft)
    setValidationError(null)
    setValidationField(undefined)
  }

  const discardDraft = useCallback(() => {
    setCurrentDraft(null)
    setInitialDraft(null)
    setEditingId(null)
    setValidationError(null)
    setValidationField(undefined)
  }, [setCurrentDraft])
  const draftIsDirty = draft != null
    && initialDraft != null
    && JSON.stringify(draft) !== JSON.stringify(initialDraft)
  const requestReplacement = useCallback(async () => {
    if (!draftIsDirty) return true
    return confirmReplace({
      title: tCommon('forms.unsavedTitle', 'Unsaved changes'),
      message: t('quietHours.form.unsaved', 'You have unsaved quiet-hours changes. Discard them?'),
      variant: 'warning',
      confirmLabel: tCommon('forms.discard', 'Discard changes'),
      cancelLabel: tCommon('forms.keepEditing', 'Keep editing'),
    })
  }, [confirmReplace, draftIsDirty, t, tCommon])
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    draftIsDirty,
    discardDraft,
    {
      message: t(
        'quietHours.form.unsaved',
        'You have unsaved quiet-hours changes. Discard them?',
      ),
    },
  )

  useEffect(() => {
    latestSeed.current = seedDraft
    if (!seedDraft || saveInFlight || save.isPending) return
    if (lastConsumedSeed.current === seedDraft) return
    lastConsumedSeed.current = seedDraft
    const applySeed = async () => {
      if (draftIsDirty && !await requestReplacement()) {
        if (latestSeed.current === seedDraft) onSeedConsumed?.()
        return
      }
      if (latestSeed.current !== seedDraft || savingDraft.current || save.isPending) return
      const base = makeDraft()
      const seededDraft = {
        enabled: seedDraft.enabled ?? true,
        start_local: seedDraft.start_local ?? base.start_local,
        end_local: seedDraft.end_local ?? base.end_local,
        timezone: seedDraft.timezone ?? base.timezone,
        weekdays: seedDraft.weekdays ?? ALL_WEEKDAYS,
        bypass_severities: [...(seedDraft.bypass_severities ?? DEFAULT_BYPASS)],
      }
      setEditingId(null)
      setCurrentDraft(seededDraft)
      setInitialDraft(seededDraft)
      setValidationError(null)
      setValidationField(undefined)
      onSeedConsumed?.()
    }
    void applySeed()
  }, [seedDraft, onSeedConsumed, saveInFlight, save.isPending, draftIsDirty, requestReplacement, setCurrentDraft])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingDraft.current || save.isPending) return
    if (!draft) {
      setValidationError(t('quietHours.error.missingDraft', 'The quiet-hours draft is unavailable. Reopen the editor.'))
      setValidationField(undefined)
      return
    }
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
      setValidationField(v.field)
      return
    }
    setValidationError(null)
    setValidationField(undefined)
    const payload: QuietHoursWindowInput & { id?: number } = {
      enabled: draft.enabled,
      start_local: draft.start_local,
      end_local: draft.end_local,
      timezone: draft.timezone,
      weekdays: draft.weekdays,
      bypass_severities: draft.bypass_severities,
    }
    if (draft.id) payload.id = draft.id
    const submittedDraft = draft
    savingDraft.current = submittedDraft
    setSaveInFlight(true)
    save.mutate(payload, {
      onSuccess: (savedWindow) => {
        savingDraft.current = null
        setSaveInFlight(false)
        if (currentDraft.current === submittedDraft) discardDraft()
        else if (currentDraft.current) {
          const savedDraft = { ...submittedDraft, id: savedWindow.id }
          setCurrentDraft({ ...currentDraft.current, id: savedWindow.id })
          setInitialDraft(savedDraft)
          setEditingId(savedWindow.id)
        }
      },
      onError: () => {
        savingDraft.current = null
        setSaveInFlight(false)
        setValidationError(t('toast.quietHours.save.error', 'Failed to save quiet hours window'))
        setValidationField(undefined)
      },
    })
  }

  const removeWindow = async (w: QuietHoursWindow) => {
    const ok = await confirmDelete({
      title: t('quietHours.deleteConfirm.title', 'Delete this quiet-hours window?'),
      message: t(
        'quietHours.deleteConfirm.message',
        'Notifications will no longer be deferred during this window. This cannot be undone.',
      ),
      variant: 'danger',
      confirmLabel: t('quietHours.delete', 'Delete'),
    })
    if (!ok) return
    remove.mutate(w.id)
  }

  const toggleWeekday = (bit: number) => {
    if (!draft) return
    setCurrentDraft({ ...draft, weekdays: draft.weekdays ^ bit })
    if (validationField === 'weekdays') {
      setValidationError(null)
      setValidationField(undefined)
    }
  }

  const toggleSeverity = (sev: string) => {
    if (!draft) return
    const has = draft.bypass_severities.includes(sev)
    setCurrentDraft({
      ...draft,
      bypass_severities: has
        ? draft.bypass_severities.filter((s) => s !== sev)
        : [...draft.bypass_severities, sev],
    })
  }

  const now = new Date()
  const emptyWindowsContent = (
    <EmptyState
      /* no-action: the primary Add window action remains in the panel header */
      icon={<Moon className="h-10 w-10" />}
      message={t('quietHours.empty', 'No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings.')}
    />
  )

  return (
    <FadeIn delay={0.135}>
      <GlassPanel className="min-w-0 space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconBox color="purple">
              <Moon className="h-5 w-5" />
            </IconBox>
            <div className="min-w-0">
              <Heading level="section">
                {t('quietHours.title', 'Quiet hours / do-not-disturb')}
              </Heading>
              <HelperText>
                {t('quietHours.subtitle', 'Defer non-critical notifications during sleep, meetings, or other time-of-day windows.')}
              </HelperText>
            </div>
          </div>
          {!draft && (
            <Button
              variant="primary"
              wrapLabel
              size="sm"
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              icon={<Plus className="h-4 w-4" />}
              onClick={startCreate}
              data-testid="quiet-hours-add"
            >
              {t('quietHours.addWindow', 'Add window')}
            </Button>
          )}
        </div>

        <SourceContent
          state={windowsState.fatalError ? 'error' : windowsState.status === 'initial' ? 'loading' : windowsState.status === 'stale' ? 'retained' : windows.length === 0 && !draft ? 'empty' : 'ready'}
          label={t('quietHours.title', 'Quiet hours / do-not-disturb')}
          emptyMessage={t('quietHours.empty', 'No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings.')}
          errorMessage={t('quietHours.unavailable', 'Quiet-hours windows unavailable.')}
          error={windowsState.fatalError}
          errorRecovery={{ onRetry: () => void windowsQuery.refetch() }}
          loadingContent={
            <ListSkeleton
              rows={2}
              label={t('quietHours.loading', 'Loading quiet-hours Windows…')}
              testId="quiet-hours-loading"
            />
          }
          emptyContent={emptyWindowsContent}
        >
        {windows.length === 0 && !draft ? emptyWindowsContent : (
          <ul className="min-w-0 space-y-3" data-testid="quiet-hours-list">
            {windows.map((w) => {
              const nextLabel = nextWindowChangeLabel(w, now)
              return (
                <li
                  key={w.id}
                  className="min-w-0 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                  data-testid={`quiet-hours-row-${w.id}`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <Badge variant={w.enabled ? 'success' : 'neutral'}>
                        {w.enabled ? t('quietHours.enabled', 'Enabled') : t('quietHours.disabled', 'Disabled')}
                      </Badge>
                      <Text as="span" size="sm" weight="medium" color="primary" className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {summarizeWindow(w)}
                      </Text>
                      {nextLabel && (
                        <Text as="span" variant="caption" className="min-w-0 break-words">{nextLabel}</Text>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <IconButton icon={<Pencil className="h-3.5 w-3.5" />} label={t('quietHours.edit', 'Edit')} variant="secondary" onClick={() => void startEdit(w)} disabled={saveInFlight || save.isPending} />
                      {/* confirm-step: removeWindow asks in the shared ConfirmDialog before deleting */}
                      <IconButton icon={<Trash2 className="h-3.5 w-3.5" />} label={t('quietHours.delete', 'Delete')} onClick={() => void removeWindow(w)} busy={remove.isPending && remove.variables === w.id} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map(({ bit, key, fallback }) => {
                      const on = (w.weekdays & bit) !== 0
                      return (
                        <Text
                          as="span"
                          size="xs"
                          key={bit}
                          className={
                            on
                              ? 'inline-flex items-center rounded-md bg-[var(--surface-3)] px-2 py-0.5 text-[var(--text-primary)] ring-1 ring-[var(--border-strong)] forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]'
                              : 'inline-flex items-center rounded-md px-2 py-0.5 text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]'
                          }
                          weight={on ? 'medium' : undefined}
                        >
                          <span aria-hidden="true">{t(key, fallback)}</span>
                          <VisuallyHidden>
                            {t(key, fallback)}: {on ? t('quietHours.enabled', 'Enabled') : t('quietHours.disabled', 'Disabled')}
                          </VisuallyHidden>
                        </Text>
                      )
                    })}
                  </div>
                  {(w.bypass_severities ?? []).length > 0 && (
                    <Text as="div" variant="caption">
                      {t('quietHours.bypassLabel', 'Always allow:')}{' '}
                      {(w.bypass_severities ?? []).map((s) => {
                        const choice = SEVERITY_CHOICES.find(({ value }) => value === s)
                        return (
                          <Badge key={s} variant="warning" className="ms-1">
                            {choice ? t(choice.labelKey, choice.fallback) : s}
                          </Badge>
                        )
                      })}
                    </Text>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        </SourceContent>

        {draft && (
          <form
            onSubmit={submit}
            className="min-w-0 space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            data-testid="quiet-hours-form"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <PanelTitle>
                {editingId
                  ? t('quietHours.form.editTitle', 'Edit window')
                  : t('quietHours.form.addTitle', 'New quiet-hours window')}
              </PanelTitle>
              <Toggle
                checked={draft.enabled}
                onChange={(v) => setCurrentDraft({ ...draft, enabled: v })}
                label={t('quietHours.form.enabled', 'Enabled')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={t('quietHours.form.start', 'Start')}
                type="time"
                value={draft.start_local}
                onChange={(e) => {
                  setCurrentDraft({ ...draft, start_local: e.target.value })
                  if (validationField === 'start_local') {
                    setValidationError(null)
                    setValidationField(undefined)
                  }
                }}
                error={validationField === 'start_local' ? validationError ?? undefined : undefined}
              />
              <Input
                label={t('quietHours.form.end', 'End')}
                type="time"
                value={draft.end_local}
                onChange={(e) => {
                  setCurrentDraft({ ...draft, end_local: e.target.value })
                  if (validationField === 'end_local') {
                    setValidationError(null)
                    setValidationField(undefined)
                  }
                }}
                error={validationField === 'end_local' ? validationError ?? undefined : undefined}
              />
            </div>

            <Select
              label={t('quietHours.form.timezone', 'Timezone (IANA)')}
              value={draft.timezone}
              onChange={(e) => {
                setCurrentDraft({ ...draft, timezone: e.target.value })
                if (validationField === 'timezone') {
                  setValidationError(null)
                  setValidationField(undefined)
                }
              }}
              error={validationField === 'timezone' ? validationError ?? undefined : undefined}
              options={tzOptions}
            />

            <fieldset
              aria-describedby={validationField === 'weekdays' ? 'quiet-hours-weekdays-error' : undefined}
            >
              <Text as="legend" variant="caption" className="mb-2">
                {t('quietHours.form.weekdays', 'Weekdays')}
              </Text>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(({ bit, key, fallback }) => {
                  const on = (draft.weekdays & bit) !== 0
                  return (
                    <Button
                      key={bit}
                      type="button"
                      onClick={() => toggleWeekday(bit)}
                      variant={on ? 'primary' : 'outline'}
                      size="sm"
                      wrapLabel
                      className="min-h-11 min-w-11"
                      aria-pressed={on}
                      data-testid={`qh-weekday-${bit}`}
                    >
                      {t(key, fallback)}
                    </Button>
                  )
                })}
              </div>
              {validationField === 'weekdays' && validationError && (
                <ErrorText id="quiet-hours-weekdays-error" className="mt-2">
                  {validationError}
                </ErrorText>
              )}
            </fieldset>

            <fieldset>
              <Text as="legend" variant="caption" className="mb-2">
                {t('quietHours.form.bypass', 'Always allow these severities through')}
              </Text>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITY_CHOICES.map(({ value, labelKey, fallback }) => {
                  const on = draft.bypass_severities.includes(value)
                  return (
                    <Button
                      key={value}
                      type="button"
                      onClick={() => toggleSeverity(value)}
                      variant={on ? 'primary' : 'outline'}
                      size="sm"
                      wrapLabel
                      className="min-h-11 min-w-11"
                      aria-pressed={on}
                      data-testid={`qh-severity-${value}`}
                    >
                      {t(labelKey, fallback)}
                    </Button>
                  )
                })}
              </div>
            </fieldset>

            {validationError && validationField == null && (
              <ErrorText data-testid="quiet-hours-error">
                {validationError}
              </ErrorText>
            )}
            {validationError && validationField != null && (
              <VisuallyHidden
                liveRegion
                priority="assertive"
                data-testid="quiet-hours-error"
              >
                {validationError}
              </VisuallyHidden>
            )}

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-2">
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                wrapLabel
                icon={<X className="h-4 w-4" />}
                type="button"
                onClick={requestClose}
                disabled={saveInFlight || save.isPending}
              >
                {t('quietHours.form.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                wrapLabel
                icon={<Check className="h-4 w-4" />}
                type="submit"
                loading={saveInFlight || save.isPending}
                data-testid="quiet-hours-save"
              >
                {saveInFlight || save.isPending
                  ? t('quietHours.form.saving', 'Saving…')
                  : editingId
                    ? t('quietHours.form.update', 'Update')
                    : t('quietHours.form.create', 'Create')}
              </Button>
            </div>
          </form>
        )}
        {replacementDialogProps && <ConfirmDialog {...replacementDialogProps} />}
        {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
        {deleteDialogProps && <ConfirmDialog {...deleteDialogProps} />}
      </GlassPanel>
    </FadeIn>
  )
}
