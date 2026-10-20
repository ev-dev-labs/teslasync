# Frontend modernization worker conventions

Read `docs\frontend-design-contract.md` before touching UI, and the mission
sections relevant to your assigned item. Paths are relative to the Git root;
the frontend package is `web`. `migration-queue.md` is orchestrator-owned.

- Do only the assigned item and its explicit owned files. Never run Git,
  edit the queue, or change another worker's files.
- Actively reduce visual noise: replace neon, glow, saturated decoration,
  and pure-white styling with restrained semantic tokens. Matching an old
  theme is not a reason to retain noisy presentation.
- Preserve every existing feature, source, action, section, user setting,
  and SI wire/cache value. Convert only at the display boundary. Unknown
  data is not zero, and fixtures never enter the real app.
- Reuse the current primitives, composites, layouts, query policy, data
  trust, workspace selection, formatting, and localization mechanisms.
  Do not introduce competing libraries or legacy unit helpers.
- A page item never edits shared components, configuration, routing,
  styles, catalogs, or the design contract. Report shared changes instead.
  Only a designated design-architect item may change the contract.
- Use category barrels in features and concrete internal imports inside
  shared components. Keep all loading, empty, error, stale/offline, keyboard,
  focus, reduced-motion, and mobile behavior.
- Run tests only for files changed by your item:
  `vitest run <file> --pool=forks --maxWorkers=2`. Explicitly list multiple
  changed test files; never run an unselected suite or unrelated selectors.
  No-change workers do not launch new tests. Scoped lint and typing remain
  allowed when assigned; full tests, full lint, and builds belong exclusively
  to the orchestrator at phase gates, one command at a time, never parallel.
- Redirect all command output to `logs\<item-id>.log` at the Git root.
  Append command names and exit codes without replacing earlier output.
  Never attach to background shell output or stream it through `Tee-Object`.
  Read only a summary or the last 50 lines. Preserve earlier evidence files.
- Update `.agent-status\<item-id>.txt` at start, every three minutes, and
  immediately before release: `UTC timestamp | current step | files touched`.
- Target a bounded item under 15 minutes. Stop and report a concrete blocker
  rather than looping. The orchestrator enforces the 25-minute stuck limit.
- No questions: make reasonable scoped decisions and report assumptions.
  Never bypass a safety/authentication prompt or run a production mutation.

## Queue and resource discipline

- Dispatch only an item already present in `migration-queue.md`. Verification,
  provenance, revalidation, and repair work must also have a queued item;
  after a failed check, add one scoped fix item before dispatching it.
- Keep at most 32 actual concurrent workers. Reservations and delivered idle
  workers are not running workers. On restart or reconciliation, reset real
  zombie `[~]` items to `[ ]`; stop running agents whose work is not queued.
- If a process reports out-of-memory, stop that specific process ID, reduce
  worker concurrency to 16, and restore 32 after ten clean completions.
  Do not stop unrelated shared-host processes.
- Finish or stop already-running full checks before a new gate. Full test,
  lint, and build gates are serialized in the orchestrator, not workers.
- These resource rules supersede earlier assignments. Do not restart the
  migration, redo completed items, weaken gates, or bypass startup guards.

Implementation workers return exactly one of:

```text
DONE | <item> | files: <list> | shared change needed: <note or none>
DONE | <item> | no change needed: <reason>
FAILED | <item> | <reason>
```

Audit and QA workers instead return their findings with exact file/line
citations, evidence limits, and a complete owned-file list. Audit workers may
write only their assigned report and heartbeat; they never change source.

## Phase 0 audit report

Read mission sections 0 and 1, plus the relevant responsive, accessibility,
state, architecture, and visual-quality sections. Audit only the assigned
mounted page and its page-specific presentation/data dependencies. The
foundations item instead owns the explicitly assigned application-wide
foundation inspection. Target ten minutes, with a hard stop before 20 minutes.

Write one valid JSON report at `docs\frontend-audits\<item-id>.json`, with:

```text
item, page, routes, purpose, primaryGoal, dataSources, components,
duplicatedPatterns, responsive, accessibility, states, visualIssues,
architectureIssues, priority, requiredSharedChanges,
competingImplementations, preservation, evidenceLimits, filesRead
```

`dataSources` identifies hooks, actual known endpoints and source ownership.
`components` identifies existing primitives/composites/layouts/domain owners.
Each issue includes the actual `file`, `line`, `rule`, `detail`, proposed
`fix`, `owner` (page/shared/integration), and confidence. Shared requirements
include `name`, existing owner file (or explicit missing owner), concrete
props/variants/states, `usedBy`, and `dependsOn`. Deduplicate in your report.
`preservation` includes source SHA-256, current line count, section names and
counts, actions, and data behavior that must survive modernization.
`filesRead` contains the actual inspected paths, not a hypothetical graph.

Use source evidence, not assumptions. Mark runtime, visual, keyboard, contrast,
and viewport behavior unverified unless actually exercised. Historical
acceptance is context, not current proof. Include unknown backend behavior
without guessing units or inventing capabilities. The foundations report uses
the same fields where applicable and adds its tooling/build/query/theme
findings; no full-repository lint/build runs during this audit.

Return `DONE | <item-id> | files: docs\frontend-audits\<item-id>.json | shared change needed: <brief note or none>`.

## Development-only QA tooling

Use package-supported Node >=26. From the repository root:

```powershell
node web\scripts\frontend-qa.mjs --help
node web\scripts\frontend-qa.mjs routes
node web\scripts\frontend-qa.mjs scan --path src/features/battery
node --test web\scripts\__tests__\frontend-qa.test.mjs
```

Browser commands require an already running, authorized application in
`E2E_BASE_URL`; reuse `E2E_STORAGE_STATE` and the existing Playwright
`chromium-smoke` configuration. Never use mocks for route acceptance.

```powershell
node web\scripts\frontend-qa.mjs capture --route /battery --theme dark
node web\scripts\frontend-qa.mjs capture --route /battery --theme light
node web\scripts\frontend-qa.mjs overflow --route /battery
node web\scripts\frontend-qa.mjs overflow --route-map <authorized-route-map.json>
```

Capture covers 375, 768, 1440 and 1920 pixels. Overflow covers all ten
mission widths. Parameter routes need real authorized mappings; unresolved
routes are blocked, not silently skipped. The runner verifies mounted
application mode, captures full-page and fixed-height main-scroll sections,
and rejects authentication redirects, loading, failed and blank views.
Artifacts and Playwright cache stay in ignored `qa-screenshots\`.
`E2E_SENSITIVE=1` disables capture. Non-read requests are blocked.

Exit 0 means the bounded command passed; 1 means findings; 2 means blocked
or invalid input. Style scans are static candidates, not visual acceptance.
Every detected finding stays in the report. `forced-colors-accessibility-review`
identifies only bounded standard CSS system-color utilities under an exact
`forced-colors` variant, including nested chains such as `forced-colors:hover`.
This is MDC-041 source review, not OS high-contrast or accessibility acceptance.
Normal-mode system colors, unknown names, numeric/hex/rgb arbitrary values,
decorative glow and nonstandard icon imports remain candidate violations and
keep exit 1. Calc/viewport candidates require separate source/design review;
they are not reclassified. Token-reference review and token-owner exemptions
retain their existing behavior. Exit 0 can contain review findings; inspect
the full report rather than treating it as visual or accessibility approval.
Focused tooling tests do not establish browser, accessibility or application
acceptance. Record actual command output and acceptance limitations.

Import `web\e2e\fixtures\frontend-modernization.ts` only from tests or
stories. Use its raw extreme values, long text and lazy row factory without
injecting them into production hooks, API responses or application data.
