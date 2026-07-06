/**
 * Centralized broadcast topic registry.
 *
 * String constants that mirror the discriminator values in {@link
 * BroadcastMessage} (see `./broadcast.ts`). Publishers and subscribers
 * reference these constants instead of inlining the raw string so a typo
 * in any one call-site is a TypeScript error rather than a silently
 * dropped message.
 *
 * ## Why a separate file?
 *
 * The {@link BroadcastMessage} discriminated union in `broadcast.ts`
 * enforces shape (and is the source of truth for runtime payload schema),
 * but it does not give names to the topics themselves. Without this
 * registry, every publisher / subscriber writes `'theme.changed'` as an
 * inline string — easy to typo, hard to grep when refactoring, and
 * impossible to enumerate for documentation / debug-tooling.
 *
 * ## Adding a new topic
 *
 *   1. Add the variant to the {@link BroadcastMessage} union in
 *      `./broadcast.ts` (this defines the wire payload).
 *   2. Add a constant to {@link TOPICS} below using the SAME string value.
 *   3. Reference the constant from publishers and subscribers.
 *
 * ## Settings-related topics specifically
 *
 * The constants below cover the surfaces that affect cross-tab visual
 * state in TeslaSync today: theme palette + mode, custom theme colors,
 * vehicle paint, and the `settings.changed` umbrella that fires whenever
 * `useSaveSettings` succeeds. Module-level formatter globals
 * (`numberFormat._globalLocale`, `_globalPrecision`) live behind the
 * `settings.changed` topic — components without a `useSettings()`
 * subscription rely on the `<FormatterPrefsBridge />` to keep them
 * current.
 */

import type { BroadcastMessage } from './broadcast'

/**
 * The full set of broadcast topic identifiers used by the app. The values
 * MUST match the `type` discriminator on {@link BroadcastMessage}.
 *
 * Typed as `const` so consumers get the exact string literal (not just
 * `string`) and so `TOPICS.X` can be used wherever a literal is required.
 */
export const TOPICS = {
  // ── Theme ────────────────────────────────────────────────────────────────
  /** Theme palette OR mode changed (themeId/modeId on payload). */
  THEME_CHANGED: 'theme.changed',
  /** Custom theme primary/accent colors changed. */
  THEME_CUSTOM_COLORS: 'theme.customColors',
  // ── Typography / fonts ───────────────────────────────────────────────────
  /**
   * Font family / size / line-height / letter-spacing / heading-weight
   * preference changed. Emitted by `<FontProvider />`; peer tabs re-read the
   * persisted `teslasync-font-*` keys and re-apply the CSS vars (the payload
   * is a hint only). Font sync is owned by `<FontProvider />`, NOT the
   * formatter bridge, so this topic is intentionally absent from
   * {@link FORMATTER_AFFECTING_TOPICS}.
   */
  FONT_CHANGED: 'font.changed',
  // ── Auth ─────────────────────────────────────────────────────────────────
  AUTH_LOGOUT: 'auth.logout',
  // ── Notifications ────────────────────────────────────────────────────────
  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_CLEARED: 'notifications.cleared',
  SNOOZE_CHANGED: 'snooze.changed',
  // ── First-run / discovery surfaces ───────────────────────────────────────
  CHANGELOG_SEEN: 'changelog.seen',
  TOUR_COMPLETED: 'tour.completed',
  TOUR_RESET: 'tour.reset',
  /**
   * A user clicked "Replay" on a tour from the Settings → Product tours
   * panel (or any other UI surface). Receivers
   * should clear their per-tour completion flag and start the tour. The
   * publisher already does this for the local tab; this topic exists so
   * peer tabs stay in sync.
   */
  TOUR_REPLAY_REQUESTED: 'tour.replay-requested',
  CHECKLIST_DISMISSED: 'checklist.dismissed',
  ONBOARDED: 'onboarded',
  ONBOARDING_SKIP_CHANGED: 'onboarding.skip.changed',
  INSTALL_DISMISSED: 'install.dismissed',
  // ── Per-vehicle visual prefs ─────────────────────────────────────────────
  VEHICLE_PAINT_CHANGED: 'vehicle.paint.changed',
  // ── Layout / saved-state ─────────────────────────────────────────────────
  DASHBOARD_LAYOUT: 'dashboard.layout',
  SAVED_VIEW_CHANGED: 'savedView.changed',
  // ── Form drafts ──────────────────────────────────────────────────────────
  FORM_DRAFT_ACQUIRED: 'formDraft.acquired',
  FORM_DRAFT_RELEASED: 'formDraft.released',
  FORM_DRAFT_COMMITTED: 'formDraft.committed',
  // ── Edit leases ──────────────────────────────────────────────────────────
  /** A tab is asking who currently owns the edit lease for a resource. */
  LEASE_REQUEST: 'lease.request',
  /** A tab is asserting it owns the edit lease (or has just taken over). */
  LEASE_GRANTED: 'lease.granted',
  /** A tab is releasing the edit lease (typically on unmount / tab close). */
  LEASE_RELEASED: 'lease.released',
  // ── TanStack Query ───────────────────────────────────────────────────────
  QUERY_INVALIDATE: 'queryInvalidate',
  // ── Settings ─────────────────────────────────────────────────────────────
  /**
   * Umbrella event for any AppSettings mutation (units, locale, decimals,
   * theme persistence, currency, etc). Subscribers should NOT trust the
   * payload `keys[]` for fine-grained dispatch — it's a hint for tracing
   * only. Always re-read from the source of truth (`useSettings`).
   */
  SETTINGS_CHANGED: 'settings.changed',
  // `satisfies` makes every value above a compile-time-checked
  // `BroadcastMessage` discriminator: a typo'd wire string (e.g.
  // 'theme.chnaged') becomes a `tsc` error here instead of a silently
  // dropped message. `as const` still wins for the inferred type, so
  // `Topic` remains the exact string-literal union.
} as const satisfies Record<string, BroadcastMessage['type']>

/**
 * Union of every concrete topic string. Use this as a parameter type when
 * a function takes "any topic" — narrower than `string`, broader than a
 * single literal.
 */
export type Topic = typeof TOPICS[keyof typeof TOPICS]

/**
 * Topics whose payload affects formatter / unit / theme rendering and so
 * must trigger a re-application of module-level globals (locale, decimal
 * precision) and a CSS-variable refresh in any tab that receives them.
 *
 * Used by `<FormatterPrefsBridge />` to know which messages to react to.
 */
export const FORMATTER_AFFECTING_TOPICS: ReadonlyArray<Topic> = [
  TOPICS.SETTINGS_CHANGED,
  TOPICS.THEME_CHANGED,
  TOPICS.THEME_CUSTOM_COLORS,
]
