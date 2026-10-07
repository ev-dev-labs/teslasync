# OperationalBrief migration queue

**Execution: PAUSED by user. Do not dispatch, validate, or resume automatically.**
The classification below is provisional and unfinished. No worker was launched
from this new queue; all attempts remain zero. Preserve the queue and worktree.

This file is the authoritative dispatch queue. Re-read it before every decision.
The historical tracker contains 393 mixed tasks, with 241 already done. Its task
count is not a page count. Already-done work is excluded, and overlapping groups
are deduplicated. `[x]` means source work and its handoff are complete, not that
the final lint, regression, build, or browser gates have passed.

Maximum concurrent workers: 32. One item per worker. Each attempt has an absolute
20-minute deadline; at most two attempts. The orchestrator does not migrate pages.
Shared source dependencies go first; integration waits for its affected pages.
Workers must not edit other items, shared configuration, routing, styles, or
catalogs, and must not run full-repository lint/build or publish changes.

Classification is being reconciled from the immutable tracker snapshot and
existing source-release evidence. No validation or commit task will be dispatched.

| Status | Type | Path | Attempts | Note |
| --- | --- | --- | --- | --- |
| [ ] | page | `web\src\features\dashboard\pages\DashboardPage.tsx` | 0 | id=dashboard-page; tracker=brief-dashboard-all,page-migrate-dashboard; finish only concrete remaining source gaps; preserve existing migration |
| [ ] | page | `web\src\features\dashboard\pages\GlancePage.tsx` | 0 | id=glance-page; tracker=brief-dashboard-all; finish only concrete remaining source gaps; preserve existing migration |
| [ ] | page | `web\src\features\dashboard\pages\QuickStatsPage.tsx` | 0 | id=quick-stats-page; tracker=brief-dashboard-all; finish only concrete remaining source gaps; preserve existing migration |
| [ ] | page | `web\src\features\settings\pages\SettingsPage.tsx` | 0 | id=settings-title; tracker=brief-atomic-settings-namespace; proven title namespace collision: both title calls must reuse canonical routes.settings; no catalog changes |
| [ ] | integration | `web\e2e\operationalbrief-contracts\battery-cycle-stress.supported.spec.ts` | 0 | id=intake-cycle; tracker=brief-atomic-browser-cycle,brief-regression-battery; affected CycleStressPage source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\e2e\operationalbrief-contracts\battery-charge-advisor.supported.spec.ts` | 0 | id=intake-advisor; tracker=brief-atomic-browser-advisor,brief-regression-battery; affected ChargeAdvisorPage source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\e2e\operationalbrief-contracts\specialized-home-energy.supported.spec.ts` | 0 | id=intake-home; tracker=brief-atomic-browser-home,brief-regression-specialized; affected HomeEnergy source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\e2e\operationalbrief-contracts\specialized-resale.supported.spec.ts` | 0 | id=intake-resale; tracker=brief-atomic-browser-resale,brief-regression-specialized; affected resale pages source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\e2e\operationalbrief-contracts\specialized-diagnostics.supported.spec.ts` | 0 | id=intake-diagnostics; tracker=brief-atomic-browser-diagnostics,brief-regression-specialized; affected diagnostics pages source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\e2e\operationalbrief-contracts\vehicle-systems-preconditioning.supported.spec.ts` | 0 | id=intake-preconditioning; tracker=brief-atomic-browser-preconditioning,brief-regression-vehicle-systems; affected PreconditioningEffectivenessPage source already done; intake released pair, copies and source map only |
| [ ] | integration | `web\src\features\settings\pages\SafetyPage.tsx` | 0 | id=intake-safety; tracker=brief-atomic-safety-copy; page source released; intake corrected documentation copy and unchanged original tests |
| [ ] | integration | `web\src\features\charging\pages\TeslaChargingSessionsPage.tsx` | 0 | id=intake-charging-copy; tracker=brief-atomic-charging-copy,brief-atomic-charging-population; page source released; receipt is under repository files, not session files; preserve unknown active-session eligibility |
| [ ] | integration | `web\src\features\settings\pages\SettingsPage.tsx` | 0 | id=intake-settings; requires=settings-title; tracker=brief-atomic-tour-copy; intake canonical Show tours release plus subsequent documented title correction |
| [ ] | integration | `.agents\state.md` | 0 | id=close-dashboard; requires=dashboard-page,glance-page,quick-stats-page; tracker=operationalbrief-appwide-inventory,brief-dashboard-all; seal exact 38-band and three-root source map; report only, do not edit state or queue |
| [ ] | integration | `web\src\i18n\en.json` | 0 | id=integrate-catalog; requires=dashboard-page,glance-page,quick-stats-page,settings-title,intake-safety,intake-charging-copy,intake-settings; tracker=brief-catalog-conflict-analysis,page-statstrip-core-integration; report deduplicated shared requests only; orchestrator applies shared changes once |

## Exclusions and reconciliation

- All 241 already-done tracker entries are excluded.
- Validation tasks are excluded from dispatch and belong to the final lint and
  validation loop. No historical partial test run is treated as final acceptance.
- `commit-frontend-prerequisites` is excluded. Do not stage, commit, push, or deploy.
- Source-complete shared contracts overlap the already-done shared production
  integration/library acceptance. They are not new shared-component migrations.
- Page groups overlapping the 39 source-closed partitions are deduplicated against
  those already-done entries. Only real existing paths may be dispatched.
- Existing thin-page tasks have current page sizes of 33-115 lines, below their
  300-line requirement; no repeat rewrite is queued.
- Powershare power-unit evidence remains explicitly unknown. Preserve existing
  behavior; do not guess a scaling factor or fabricate upstream unit proof.

The detailed per-tracker classification receipt is being compiled in the session
artifacts. Classification and execution counts must be printed from actual rows.
