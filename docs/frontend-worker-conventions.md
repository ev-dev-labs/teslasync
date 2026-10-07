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
- Do not run full-repository lint or build. Use targeted checks only when
  allowed by the assignment. Record exact commands, exit codes, and output;
  source inspection or old receipts are not runtime acceptance.
- Update `.agent-status\<item-id>.txt` at start, every three minutes, and
  immediately before release: `UTC timestamp | current step | files touched`.
- Target a bounded item under 15 minutes. Stop and report a concrete blocker
  rather than looping. The orchestrator enforces the 25-minute stuck limit.
- No questions: make reasonable scoped decisions and report assumptions.
  Never bypass a safety/authentication prompt or run a production mutation.

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
