/**
 * orphan-allowlist — intentional ORPHAN hook waiver list.
 *
 * The hook coverage audit flags any file under `web/src/api/hooks/`
 * whose exported `use*` symbols
 * have ZERO production consumers. By default an ORPHAN status BLOCKS the
 * audit. Files listed here are exempted: the audit treats listed entries as
 * PASS and continues without erroring.
 *
 * Honesty Covenant rule 11 — "no dead code retention" — REQUIRES that any
 * file added here have a documented reason and (where applicable) a link
 * to a backlog issue tracking the future mount. Adding an entry without a
 * reason or without committing to a future cleanup IS dead-code retention
 * by stealth and SHOULD be rejected in code review.
 *
 * To remove an entry: either (a) wire the hook into a real consumer, or
 * (b) delete the hook file. Both choices are preferable to growing the
 * allowlist.
 *
 * Each entry's `file` is the bare filename relative to `web/src/api/hooks/`
 * (no leading path, no `.ts` extension assumed by callers — match exactly
 * as the hook coverage audit emits the name).
 */

export interface OrphanWaiver {
  /** Bare filename, e.g. 'useAlerts.ts'. Must match the audit's file column. */
  readonly file: string;
  /** Why this hook is allowed to ship without a production consumer. */
  readonly reason: string;
  /**
   * Tracking note for the future-mount work. Use a GitHub issue URL when
   * one exists; a TODO marker is acceptable while the backlog item is
   * still being filed.
   */
  readonly tracking: string;
}

export const INTENTIONAL_ORPHANS: readonly OrphanWaiver[] = [
  {
    file: 'useAlerts.ts',
    reason:
      'Domain-named re-export shim introduced in Phase-45 (PR #61, commit a2010406). ' +
      'Re-exports alert-specific symbols from useNotifications so future call sites ' +
      'can import from @/api/hooks/useAlerts without pulling notification-channel ' +
      'types. The shim has no callers today because every consumer (AlertsPage, ' +
      'AlertFeedWidget) still imports directly from useNotifications; the shim is ' +
      'kept available as the migration path.',
    tracking:
      'TODO(phase-43a): file backlog issue to migrate alert imports from ' +
      "`@/api/hooks/useNotifications` to `@/api/hooks/useAlerts` and remove this " +
      'waiver entry once migration is complete.',
  },
  {
    file: 'useDashboardLayouts.ts',
    reason:
      'Named-layout library hooks (useNamedDashboardLayouts / useCreateDashboardLayout / ' +
      'useUpdateDashboardLayout / useDeleteDashboardLayout / useApplyDashboardLayout) ' +
      'introduced in Phase-40/30 (commit 8009c98e2). The backend routes at ' +
      '/api/v1/dashboard/layouts/* are LIVE (see internal/api/router.go L963-970 and ' +
      'internal/api/dashboard_layout_handler.go) but the LayoutSwitcher UI in ' +
      'web/src/features/dashboard/components/LayoutSwitcher.tsx still operates on ' +
      'local-state SavedDashboard[] passed via props, not on the per-row backend ' +
      'library. The hooks are the missing client half of a half-finished feature.',
    tracking:
      'TODO(phase-43a): file backlog issue to wire LayoutSwitcher save-as-preset / ' +
      'apply-preset flow into the named-layout hooks. Out of scope for this prompt ' +
      "because integration touches features/dashboard/hooks/useDashboardLayout.ts " +
      '(839 lines), LayoutSwitcher.tsx, and DashboardPage.tsx beyond the prompt budget.',
  },
] as const;

/**
 * True iff the given hook filename is intentionally allowed to be ORPHAN.
 *
 * @param file - bare filename relative to `web/src/api/hooks/`, e.g. `useAlerts.ts`
 */
export function isIntentionalOrphan(file: string): boolean {
  // Defensive: the hook-coverage audit that consumes this predicate lives
  // outside the typed SPA build, so `file` can arrive empty/undefined from an
  // untyped caller. A blank name is never an intentional orphan — short-circuit
  // before scanning so the contract (exact bare-filename match) stays explicit.
  if (!file) return false;
  return INTENTIONAL_ORPHANS.some((entry) => entry.file === file);
}
