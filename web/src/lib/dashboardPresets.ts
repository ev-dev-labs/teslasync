/**
 * Curated dashboard presets by role (HELP-11).
 *
 * The dashboard already supports arbitrary widget layouts, which means a new
 * user's first decision is "which of a hundred widgets do I want?" — a
 * question they cannot answer yet. Presets answer it for the four roles this
 * product actually serves.
 *
 * Two constraints shape the design:
 *
 *  1. **Compose, never duplicate.** A preset is a *curation* — an ordered list
 *     of widget ids that already exist in the widget registry, plus a stated
 *     rationale. It is not another saved dashboard, so choosing a preset does
 *     not create a second dashboard to keep in sync, and switching presets
 *     does not orphan the previous one.
 *  2. **Persist the preference, not a copy.** Only the chosen preset id is
 *     stored. The widget composition always comes from this file, so improving
 *     a preset improves it for everyone who selected it instead of freezing a
 *     snapshot at the moment they clicked.
 *
 * Widget ids are validated against `features/dashboard/widgets/registry` by
 * `lib/__tests__/dashboardPresets.test.ts` — including the human labels, so a
 * renamed widget fails the test rather than silently drifting. The registry is
 * imported ONLY by that test: this module stays data-only so selecting a
 * preset does not pull the entire widget catalogue (and its lazy chunks) into
 * whatever route renders the picker.
 */

export type DashboardPresetRole = 'owner' | 'fleet_operator' | 'energy_analyst' | 'maintainer'

export interface PresetWidget {
  /** Widget id as declared in the dashboard widget registry. */
  widgetId: string
  /** Registry `name`, mirrored here so the picker needs no registry import. */
  labelFallback: string
}

export interface DashboardPreset {
  role: DashboardPresetRole
  nameKey: string
  nameFallback: string
  /** Who this is for, in one sentence. */
  audienceKey: string
  audienceFallback: string
  /** Why these widgets and not others. */
  rationaleKey: string
  rationaleFallback: string
  widgets: readonly PresetWidget[]
}

export const DASHBOARD_ROLE_PRESETS: readonly DashboardPreset[] = [
  {
    role: 'owner',
    nameKey: 'dashboardPresets.owner.name',
    nameFallback: 'Owner',
    audienceKey: 'dashboardPresets.owner.audience',
    audienceFallback: 'One or two personal vehicles, checked a few times a day.',
    rationaleKey: 'dashboardPresets.owner.rationale',
    rationaleFallback:
      'Answers the four questions an owner actually opens the app for: how full is it, is it charging, is it locked, and where is it.',
    widgets: [
      { widgetId: 'vehicle-hero', labelFallback: 'Vehicle Card' },
      { widgetId: 'battery-gauge', labelFallback: 'Battery Level' },
      { widgetId: 'charge-status', labelFallback: 'Charge Status' },
      { widgetId: 'climate-status', labelFallback: 'Climate' },
      { widgetId: 'security-status', labelFallback: 'Security' },
      { widgetId: 'location-map', labelFallback: 'Vehicle Location Map' },
      { widgetId: 'recent-drives', labelFallback: 'Recent Drives' },
      { widgetId: 'quick-nav', labelFallback: 'Quick Navigation' },
    ],
  },
  {
    role: 'fleet_operator',
    nameKey: 'dashboardPresets.fleetOperator.name',
    nameFallback: 'Fleet operator',
    audienceKey: 'dashboardPresets.fleetOperator.audience',
    audienceFallback: 'Several vehicles and drivers, watched throughout the day.',
    rationaleKey: 'dashboardPresets.fleetOperator.rationale',
    rationaleFallback:
      'Leads with exceptions rather than detail: what needs attention now, which vehicles are reporting, and what has moved.',
    widgets: [
      { widgetId: 'fleet-stats', labelFallback: 'Fleet Stats' },
      { widgetId: 'alert-feed', labelFallback: 'Alert Feed' },
      { widgetId: 'vehicle-hero-card', labelFallback: 'Vehicle Hero Card' },
      { widgetId: 'recent-drives-list', labelFallback: 'Recent Drives List' },
      { widgetId: 'charge-history', labelFallback: 'Charge History' },
      { widgetId: 'geofence-status', labelFallback: 'Geofence Status' },
      { widgetId: 'command-quick-actions', labelFallback: 'Quick Actions' },
      { widgetId: 'uptime-monitor', labelFallback: 'Uptime Monitor' },
    ],
  },
  {
    role: 'energy_analyst',
    nameKey: 'dashboardPresets.energyAnalyst.name',
    nameFallback: 'Energy analyst',
    audienceKey: 'dashboardPresets.energyAnalyst.audience',
    audienceFallback: 'Cost, efficiency and battery trends over weeks and months.',
    rationaleKey: 'dashboardPresets.energyAnalyst.rationale',
    rationaleFallback:
      'Every widget here is a trend or a total. Live vehicle state is deliberately absent — it is noise at this timescale.',
    widgets: [
      { widgetId: 'energy-flow', labelFallback: 'Energy Flow' },
      { widgetId: 'drive-efficiency-chart', labelFallback: 'Drive Efficiency Chart' },
      { widgetId: 'charge-cost-tracker', labelFallback: 'Charge Cost Tracker' },
      { widgetId: 'charge-session-chart', labelFallback: 'Charge Session Chart' },
      { widgetId: 'cost-breakdown', labelFallback: 'Cost Breakdown' },
      { widgetId: 'battery-degradation-trend', labelFallback: 'Battery Degradation Trend' },
      { widgetId: 'regen-efficiency', labelFallback: 'Regen Braking' },
      { widgetId: 'monthly-mileage', labelFallback: 'Monthly Mileage' },
    ],
  },
  {
    role: 'maintainer',
    nameKey: 'dashboardPresets.maintainer.name',
    nameFallback: 'Maintainer',
    audienceKey: 'dashboardPresets.maintainer.audience',
    audienceFallback: 'Whoever keeps this install running.',
    rationaleKey: 'dashboardPresets.maintainer.rationale',
    rationaleFallback:
      'Pipeline health, not vehicle data: if ingestion, the broker or exports are unhealthy, every other widget in the app is lying.',
    widgets: [
      { widgetId: 'system-health', labelFallback: 'System Health' },
      { widgetId: 'signal-health', labelFallback: 'Signal Health' },
      { widgetId: 'telemetry-errors', labelFallback: 'Telemetry Errors' },
      { widgetId: 'mqtt-status', labelFallback: 'MQTT Status' },
      { widgetId: 'export-status', labelFallback: 'Export Status' },
      { widgetId: 'backup-monitor', labelFallback: 'Backup Monitor' },
      { widgetId: 'api-usage', labelFallback: 'API Usage' },
      { widgetId: 'uptime-monitor', labelFallback: 'Uptime Monitor' },
    ],
  },
] as const

const PRESET_BY_ROLE: ReadonlyMap<DashboardPresetRole, DashboardPreset> = new Map(
  DASHBOARD_ROLE_PRESETS.map((preset) => [preset.role, preset]),
)

export function getDashboardPreset(role: string): DashboardPreset | null {
  return PRESET_BY_ROLE.get(role as DashboardPresetRole) ?? null
}

/** Ordered widget ids for a role — what a consumer applies to a layout. */
export function presetWidgetIds(role: string): string[] {
  return getDashboardPreset(role)?.widgets.map((widget) => widget.widgetId) ?? []
}

/**
 * Does a live widget list match a role preset?
 *
 * Compares as a SET, not a sequence: reordering widgets on the grid does not
 * change which preset the dashboard is showing, and users drag things around
 * constantly. Adding or removing a widget does change it — at that point the
 * layout is the user's own, not the preset's, and claiming otherwise is the
 * stale-marker bug this function exists to prevent.
 */
export function layoutMatchesPreset(
  role: string,
  widgetIds: readonly string[] | null | undefined,
): boolean {
  const expected = presetWidgetIds(role)
  if (expected.length === 0) return false
  if (!Array.isArray(widgetIds)) return false

  const actual = new Set(widgetIds)
  if (actual.size !== expected.length) return false
  return expected.every((id) => actual.has(id))
}

/**
 * The role the CURRENT layout actually matches, or null.
 *
 * Derived rather than remembered. A persisted "applied" marker goes stale the
 * moment the user hits undo, switches dashboard, hydrates a different layout
 * from the backend, or removes a single widget — and the Help panel would keep
 * claiming "Selected" for a layout that no longer exists.
 */
export function resolveAppliedPresetRole(
  widgetIds: readonly string[] | null | undefined,
): DashboardPresetRole | null {
  for (const preset of DASHBOARD_ROLE_PRESETS) {
    if (layoutMatchesPreset(preset.role, widgetIds)) return preset.role
  }
  return null
}

// ─── Preference persistence ─────────────────────────────────────────────────

export const DASHBOARD_PRESET_PREFERENCE_KEY = 'teslasync:dashboard-preset:v1'

/**
 * The role whose composition is actually live on the active dashboard.
 *
 * Deliberately separate from the preference above. Picking a preset in the
 * Help panel records an *intent*; the dashboard is what turns that intent into
 * widgets. Collapsing the two into one key made the picker claim "Selected"
 * for a role that had never been applied to anything — which is exactly the
 * defect this split fixes.
 */
export const DASHBOARD_PRESET_APPLIED_KEY = 'teslasync:dashboard-preset-applied:v1'

/** Event fired when the preference changes, so open surfaces can react. */
export const DASHBOARD_PRESET_CHANGED_EVENT = 'teslasync:dashboard-preset:changed'

/** Event fired once a role's composition has been written to the dashboard. */
export const DASHBOARD_PRESET_APPLIED_EVENT = 'teslasync:dashboard-preset:applied'

function isRole(value: unknown): value is DashboardPresetRole {
  return typeof value === 'string' && PRESET_BY_ROLE.has(value as DashboardPresetRole)
}

function readRole(key: string): DashboardPresetRole | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return isRole(raw) ? raw : null
  } catch {
    return null
  }
}

function writeRole(key: string, role: DashboardPresetRole | null, eventName: string): void {
  if (typeof window === 'undefined') return
  try {
    if (role === null) window.localStorage.removeItem(key)
    else if (isRole(role)) window.localStorage.setItem(key, role)
  } catch {
    // Storage is unavailable (quota, private mode, hardened browser). The
    // event below still fires so any open surface updates for this session,
    // but nothing is durable: the next page load reads no preference and the
    // panel shows "Use this preset" again. Fail-closed by design — a
    // preference we cannot persist must not be presented as if we had.
  }
  try {
    window.dispatchEvent(
      new CustomEvent<{ role: DashboardPresetRole | null }>(eventName, { detail: { role } }),
    )
  } catch {
    /* CustomEvent unavailable — non-fatal */
  }
}

/**
 * The selected preset role, or null when the user has not chosen one.
 *
 * Never falls back to a default role: an unset preference means "the user has
 * not decided", which is different from "the user chose owner", and silently
 * inventing a choice would make the picker lie about the current state.
 */
export function getDashboardPresetPreference(): DashboardPresetRole | null {
  return readRole(DASHBOARD_PRESET_PREFERENCE_KEY)
}

/**
 * Persists the chosen role. Passing null clears the preference.
 *
 * Preference only — it does NOT queue an application. Callers that represent a
 * user *selecting* a preset should use {@link chooseDashboardPreset}, which
 * records both the preference and the one-shot request.
 */
export function setDashboardPresetPreference(role: DashboardPresetRole | null): void {
  writeRole(DASHBOARD_PRESET_PREFERENCE_KEY, role, DASHBOARD_PRESET_CHANGED_EVENT)
}

/**
 * The user picked a preset: remember it, and queue exactly one application.
 *
 * Passing null clears the preference and drops any queued application — a user
 * who unchooses a preset must not have it applied on their next visit.
 */
export function chooseDashboardPreset(
  role: DashboardPresetRole | null,
): DashboardPresetRequest | null {
  setDashboardPresetPreference(role)
  if (role === null) {
    clearPendingDashboardPreset()
    return null
  }
  return requestDashboardPresetApplication(role)
}

/**
 * The role whose widgets are actually live on the dashboard, or null.
 *
 * Reads the marker the dashboard last wrote. Prefer
 * {@link resolveAppliedPresetRole} where the current widget list is available:
 * the marker is a cache, and a cache of "what the layout looks like" goes
 * stale on undo, dashboard switch, backend hydration, or any manual widget
 * edit. {@link reconcileAppliedPresetRole} keeps the two honest.
 */
export function getAppliedDashboardPresetRole(): DashboardPresetRole | null {
  return readRole(DASHBOARD_PRESET_APPLIED_KEY)
}

/** Records that a role's composition has been written to the active dashboard. */
export function setAppliedDashboardPresetRole(role: DashboardPresetRole | null): void {
  writeRole(DASHBOARD_PRESET_APPLIED_KEY, role, DASHBOARD_PRESET_APPLIED_EVENT)
}

/**
 * Re-derive the applied marker from the layout that is actually on screen and
 * persist any correction.
 *
 * Called by the dashboard whenever its widget set can have changed — undo,
 * redo, switch, backend hydration, add/remove widget. Returns the truthful
 * role so the caller can use it without a second read.
 *
 * Writes only on an actual change, so this is safe to call on every render
 * pass without spamming storage or the change event.
 */
export function reconcileAppliedPresetRole(
  widgetIds: readonly string[] | null | undefined,
): DashboardPresetRole | null {
  const truth = resolveAppliedPresetRole(widgetIds)
  if (truth !== getAppliedDashboardPresetRole()) {
    setAppliedDashboardPresetRole(truth)
  }
  return truth
}

/**
 * One-shot adoption request.
 *
 * This is the load-bearing separation. There are THREE distinct facts here and
 * collapsing any two of them produces a bug:
 *
 *   1. **Preference** (`…-preset:v1`) — durable. "The user likes the owner
 *      preset." Survives customisation; drives the Help panel's chosen state.
 *   2. **Applied** (`…-preset-applied:v1`) — derived from the live widget set.
 *      "The layout on screen right now IS the owner composition." Goes false
 *      the instant the user removes a widget or undoes.
 *   3. **Pending request** (this key) — a one-shot instruction. "The user just
 *      asked for the owner preset to be applied." Consumed exactly once.
 *
 * The previous implementation had only (1) and (2) and derived "pending" as
 * `preference !== applied`. Because (2) is derived from the live layout, that
 * expression became permanently true the moment a user customised anything:
 * every subsequent DashboardPage mount saw "pending" and silently re-applied
 * the preset — restoring deleted widgets, reversing undo, and overwriting a
 * different dashboard the user had switched to. Navigation alone must never
 * mutate a layout.
 *
 * The `nonce` makes each selection a distinguishable event, so re-choosing the
 * same role after customising is a genuinely new request rather than a no-op,
 * and so tests can assert "exactly one new application was queued".
 */
export interface DashboardPresetRequest {
  role: DashboardPresetRole
  /** Opaque, unique per user selection. */
  nonce: string
}

export const DASHBOARD_PRESET_PENDING_KEY = 'teslasync:dashboard-preset-pending:v1'

/** Event fired when a one-shot application is requested. */
export const DASHBOARD_PRESET_REQUESTED_EVENT = 'teslasync:dashboard-preset:requested'

function makeNonce(): string {
  // Uniqueness only has to hold within a browser profile; collisions would at
  // worst merge two identical requests, which is harmless.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Queue a one-shot application of `role`.
 *
 * Called when the user picks a preset, and again when they explicitly ask to
 * re-apply one after customising. Never called by navigation, mounting, or
 * layout reconciliation.
 */
export function requestDashboardPresetApplication(
  role: DashboardPresetRole,
): DashboardPresetRequest | null {
  if (typeof window === 'undefined' || !isRole(role)) return null
  const request: DashboardPresetRequest = { role, nonce: makeNonce() }
  try {
    window.localStorage.setItem(DASHBOARD_PRESET_PENDING_KEY, JSON.stringify(request))
  } catch {
    // Storage unavailable. The request is NOT queued: `consumePending…` reads
    // the stored record, so with nothing written the dashboard applies
    // nothing — including on the event dispatched immediately below.
    //
    // That is the correct outcome, not a gap. A request that cannot be
    // persisted also cannot be marked consumed, so honouring it from the
    // event payload would re-apply the preset on every subsequent mount —
    // exactly the defect the one-shot record exists to prevent. Failing
    // closed costs the user one click; failing open costs them their layout.
  }
  try {
    // The detail is informational only — for logging and for surfaces that
    // want to react without a storage read. It is deliberately NOT the
    // instruction: `consumePendingDashboardPreset()` reads and clears the
    // stored record, and that read-and-clear is what makes double
    // consumption impossible. Consumers must never apply from `detail`.
    window.dispatchEvent(
      new CustomEvent<DashboardPresetRequest>(DASHBOARD_PRESET_REQUESTED_EVENT, {
        detail: request,
      }),
    )
  } catch {
    /* CustomEvent unavailable — non-fatal */
  }
  return request
}

/** Read the pending request without consuming it. */
export function peekPendingDashboardPreset(): DashboardPresetRequest | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PRESET_PENDING_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      isRole((parsed as DashboardPresetRequest).role) &&
      typeof (parsed as DashboardPresetRequest).nonce === 'string'
    ) {
      return parsed as DashboardPresetRequest
    }
    return null
  } catch {
    return null
  }
}

/** Drop any pending request without applying it. */
export function clearPendingDashboardPreset(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DASHBOARD_PRESET_PENDING_KEY)
  } catch {
    /* non-fatal */
  }
}

/**
 * Read and clear the pending request in one step.
 *
 * Clearing BEFORE the caller applies is deliberate: a request that is consumed
 * and then fails to apply is dropped, which is strictly safer than one that
 * survives and re-applies on every subsequent mount — the exact failure mode
 * this record replaces.
 */
export function consumePendingDashboardPreset(): DashboardPresetRequest | null {
  const request = peekPendingDashboardPreset()
  if (request) clearPendingDashboardPreset()
  return request
}

/**
 * True only while an unconsumed, user-initiated application is queued.
 *
 * Deliberately does NOT consult the applied marker. "The layout no longer
 * matches my preference" is not a request to change it — it is usually the
 * user having customised on purpose.
 */
export function hasPendingDashboardPreset(): boolean {
  return peekPendingDashboardPreset() !== null
}
