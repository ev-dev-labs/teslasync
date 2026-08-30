import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, Clock3, LayoutDashboard } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui'
import {
  DASHBOARD_PRESET_APPLIED_EVENT,
  DASHBOARD_ROLE_PRESETS,
  chooseDashboardPreset,
  getAppliedDashboardPresetRole,
  getDashboardPresetPreference,
  peekPendingDashboardPreset,
  requestDashboardPresetApplication,
  type DashboardPreset,
  type DashboardPresetRole,
} from '@/lib/dashboardPresets'

/**
 * Curated dashboard presets by role (HELP-11).
 *
 * Shows what each preset contains before it is chosen — a preset the user
 * cannot inspect is just another mystery button. Selecting one records the
 * preference; the dashboard adopts it **in place** on the next visit (or
 * immediately if it is already open). It never clones a dashboard, so
 * switching roles leaves no orphaned copies behind and improvements to a
 * preset reach everyone who selected it.
 *
 * The card distinguishes **chosen** from **applied**, and from the case where
 * the two disagree. Claiming "Selected" for a role whose widgets were never
 * written to a dashboard is a lie the user discovers the moment they open the
 * dashboard and see their old layout — and claiming it for a role they did
 * not choose is a lie they discover the moment they tap it. See
 * {@link resolvePresetCardState}.
 */
export function DashboardPresetPanel() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<DashboardPresetRole | null>(() =>
    getDashboardPresetPreference(),
  )
  const [applied, setApplied] = useState<DashboardPresetRole | null>(() =>
    getAppliedDashboardPresetRole(),
  )
  const [pending, setPending] = useState<DashboardPresetRole | null>(
    () => peekPendingDashboardPreset()?.role ?? null,
  )

  // The dashboard performs the application AND reconciles the applied marker
  // against its live widget set, so this panel just follows. All three facts
  // are re-read together — reading only some of them is how `selected` and
  // `pending` drift apart across tabs and produce combinations the card would
  // otherwise have to guess at.
  useEffect(() => {
    const sync = () => {
      setSelected(getDashboardPresetPreference())
      setApplied(getAppliedDashboardPresetRole())
      setPending(peekPendingDashboardPreset()?.role ?? null)
    }
    window.addEventListener(DASHBOARD_PRESET_APPLIED_EVENT, sync)
    window.addEventListener('storage', sync)
    // Also re-read whenever this panel regains visibility: the user may have
    // gone to the dashboard, undone the preset, and come back — no event
    // reaches a backgrounded tab in that flow.
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener(DASHBOARD_PRESET_APPLIED_EVENT, sync)
      window.removeEventListener('storage', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const choose = useCallback((role: DashboardPresetRole) => {
    // Re-selecting the active preset clears it: the picker must be able to
    // return to "no preference", otherwise the first click is irreversible.
    setSelected((current) => {
      const next = current === role ? null : role
      chooseDashboardPreset(next)
      setPending(next)
      return next
    })
  }, [])

  /**
   * Explicit re-apply after the user has customised away from their preset.
   *
   * This is the ONLY way a preset gets re-applied once it has been adopted.
   * Navigation and remounting deliberately cannot do it — that behaviour used
   * to restore deleted widgets and reverse undo every time the user visited
   * the dashboard.
   */
  const reapply = useCallback((role: DashboardPresetRole) => {
    requestDashboardPresetApplication(role)
    setPending(role)
  }, [])

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="dashboard-preset-panel">
      <PanelTitle>{t('dashboardPresets.title', 'Dashboard presets')}</PanelTitle>
      <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
        {t(
          'dashboardPresets.subtitle',
          'Curated widget sets for the four ways this app is used. Choosing one updates your existing dashboard in place — it does not create another one, and it never overwrites changes you make afterwards.',
        )}
      </Text>

      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]">
        {DASHBOARD_ROLE_PRESETS.map((preset) => (
          <PresetCard
            key={preset.role}
            preset={preset}
            selected={selected === preset.role}
            applied={applied === preset.role}
            pending={pending === preset.role}
            onChoose={choose}
            onReapply={reapply}
          />
        ))}
      </div>

      <Link
        to="/"
        className="mt-3 inline-flex text-xs font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
        data-testid="dashboard-preset-open-dashboard"
      >
        {pending !== null
          ? t('dashboardPresets.applyOnDashboard', 'Open the dashboard to apply it')
          : t('dashboardPresets.openDashboard', 'Open the dashboard')}
      </Link>
    </GlassPanel>
  )
}

/**
 * Every combined state a preset card can be in.
 *
 * Exhaustive and explicit on purpose. The previous implementation computed
 * label, icon, `aria-pressed`, explanation and click outcome from three
 * independent booleans, and one combination disagreed with itself: with
 * `owner` applied but `energy_analyst` chosen, the owner card branched its
 * label on `applied` and read "Selected — tap to clear" while `aria-pressed`
 * was `false` and clicking branched on `selected`, which *re-selected* owner
 * and queued a mutation. The control announced one thing, looked like a
 * second, and did a third.
 *
 * Deriving one state first, then everything else from it, makes that class of
 * disagreement unrepresentable.
 */
export type PresetCardState =
  /** Not the user's preference and not on screen. */
  | 'idle'
  /** The user's preference, with an application queued. */
  | 'queued'
  /** The user's preference, and the live layout matches it. */
  | 'active'
  /** The live layout matches, but a DIFFERENT role is the user's preference. */
  | 'activeUnchosen'
  /** The user's preference, previously applied, layout has since diverged. */
  | 'diverged'

export function resolvePresetCardState(input: {
  selected: boolean
  applied: boolean
  pending: boolean
}): PresetCardState {
  const { selected, applied, pending } = input
  // `applied` is the strongest fact available: it is derived from the live
  // widget set, so when it is true the layout demonstrably matches right now.
  // It therefore outranks a queued request, which is only a statement about
  // the future. (The two overlap briefly — the dashboard consumes the request
  // before writing the layout, but another tab can observe both. Announcing
  // "applies next time you open it" about a layout already on screen would be
  // true and useless.)
  if (applied) return selected ? 'active' : 'activeUnchosen'
  // Not live. Chosen with a request queued means it is on its way; chosen
  // without one means it was applied and the user has since customised, undone
  // or switched dashboards.
  if (selected) return pending ? 'queued' : 'diverged'
  // A queued request for a role that is not the user's preference is torn
  // cross-tab state. Fall through to `idle` rather than invent a state: the
  // card then offers to choose the role, which is safe and accurate.
  return 'idle'
}

/**
 * What the primary button does, per state.
 *
 * `aria-pressed` mirrors `selected`, so "pressed" always means "this is my
 * chosen preset" — and `clear` is offered only where that is true. The label
 * below is derived from the same table, so it can never promise an action the
 * click does not perform.
 */
const PRIMARY_ACTION: Record<PresetCardState, 'choose' | 'clear'> = {
  idle: 'choose',
  queued: 'clear',
  active: 'clear',
  activeUnchosen: 'choose',
  diverged: 'clear',
}

function PresetCard({
  preset,
  selected,
  applied,
  pending,
  onChoose,
  onReapply,
}: {
  preset: DashboardPreset
  selected: boolean
  applied: boolean
  pending: boolean
  onChoose: (role: DashboardPresetRole) => void
  onReapply: (role: DashboardPresetRole) => void
}) {
  const { t } = useTranslation()
  const state = resolvePresetCardState({ selected, applied, pending })
  const action = PRIMARY_ACTION[state]

  const label =
    state === 'active'
      ? // The ONLY state that may claim "Selected": chosen AND live.
        t('dashboardPresets.selected', 'Selected — tap to clear')
      : state === 'queued'
        ? t('dashboardPresets.pending', 'Chosen — tap to clear')
        : state === 'diverged'
          ? t('dashboardPresets.chosenDiverged', 'Chosen — tap to clear')
          : t('dashboardPresets.choose', 'Use this preset')

  return (
    <div
      data-testid="dashboard-preset-card"
      data-preset-role={preset.role}
      data-selected={selected}
      data-applied={applied}
      data-card-state={state}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        selected
          ? 'border-[var(--theme-primary)]/50 bg-[rgba(var(--theme-primary-rgb),0.06)]'
          : 'border-[var(--glass-border)] bg-[var(--surface-1)]',
      )}
    >
      <div className="flex items-start gap-2">
        <LayoutDashboard
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <Text as="p" size="sm" weight="medium" color="primary">
            {t(preset.nameKey, preset.nameFallback)}
          </Text>
          <Text as="p" variant="bodySm" color="muted">
            {t(preset.audienceKey, preset.audienceFallback)}
          </Text>
        </div>
        {applied && (
          <Check
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
            aria-hidden
            data-testid={`preset-applied-${preset.role}`}
          />
        )}
        {state === 'queued' && (
          <Clock3
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
            aria-hidden
            data-testid={`preset-pending-${preset.role}`}
          />
        )}
      </div>

      <Text as="p" variant="bodySm" color="muted">
        {t(preset.rationaleKey, preset.rationaleFallback)}
      </Text>

      <div>
        <Text as="p" variant="caption">
          {t('dashboardPresets.includes', 'Includes')}
        </Text>
        <ul className="mt-1 flex flex-wrap gap-1">
          {preset.widgets.map((widget) => (
            <li
              key={widget.widgetId}
              data-preset-widget={widget.widgetId}
              className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-2xs text-[var(--text-muted)]"
            >
              {widget.labelFallback}
            </li>
          ))}
        </ul>
      </div>

      {state === 'queued' && (
        <Text
          as="p"
          variant="bodySm"
          color="muted"
          data-testid={`preset-pending-note-${preset.role}`}
        >
          {t(
            'dashboardPresets.pendingNote',
            'Chosen — applies to your dashboard next time you open it.',
          )}
        </Text>
      )}

      {state === 'diverged' && (
        <Text
          as="p"
          variant="bodySm"
          color="muted"
          data-testid={`preset-diverged-note-${preset.role}`}
        >
          {t(
            'dashboardPresets.divergedNote',
            'Your dashboard has changed since this preset was applied. Your changes are kept — re-apply only if you want the preset back.',
          )}
        </Text>
      )}

      {state === 'activeUnchosen' && (
        <Text
          as="p"
          variant="bodySm"
          color="muted"
          data-testid={`preset-active-unchosen-note-${preset.role}`}
        >
          {t(
            'dashboardPresets.activeUnchosenNote',
            'This is what your dashboard looks like right now, but a different preset is chosen.',
          )}
        </Text>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={selected ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onChoose(preset.role)}
          // Mirrors `selected`, so "pressed" always means "this is my chosen
          // preset" — and it is exactly the states where the label offers to
          // clear. `onChoose` is a toggle keyed on the same flag, so label,
          // announced state and outcome cannot disagree.
          aria-pressed={selected}
          data-primary-action={action}
          data-testid={`choose-preset-${preset.role}`}
        >
          {label}
        </Button>

        {state === 'diverged' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReapply(preset.role)}
            data-testid={`reapply-preset-${preset.role}`}
          >
            {t('dashboardPresets.reapply', 'Re-apply to my dashboard')}
          </Button>
        )}
      </div>
    </div>
  )
}
