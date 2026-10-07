# Help, onboarding and release notes

How TeslaSync explains itself. This document is the contract for the surfaces
delivered under HELP-01 … HELP-12; it exists so the next person to touch these
files knows which decisions are load-bearing and which are just current copy.

The guiding rule for all of it:

> **The app may explain itself at any time. It may interrupt only when the user
> asked to be interrupted.**

---

## 1. Onboarding is opt-in and task-specific (HELP-01)

**Removed:** the automatic dashboard tour. It used to open a seven-step
spotlight 1.5 seconds after any user with a linked vehicle landed on `/`.

**Replaced with:** `web/src/lib/onboardingTasks.ts` — a registry of single-task
hints rendered by `<TaskOnboardingHost>` (mounted once in `App.tsx`).

A hint appears only when **all** of these hold:

| Gate | Where |
|---|---|
| The user is on the route where the task is performed | `routeMatch` |
| Observed state says the task is outstanding | `isRelevant(ctx)` |
| The task is not completed or dismissed **at its current version** | `teslasync:onboarding-task:v{n}:{id}` |
| The user has not opted out | `teslasync:onboarding-task:opt-out` |
| No hint has been shown in the last 6 hours | `teslasync:onboarding-task:last-shown` |
| The user is not "experienced" | `isExperiencedUser()` |

`isExperiencedUser` is true past **any** of: 30 days since first use, 25 drives,
or 2 completed tours. It also returns `true` for a missing context — unknown
means *do not interrupt*.

The context is read from the **TanStack Query cache only** (`useTaskOnboarding`),
never fetched. Onboarding must not be a background load on every route for every
user forever, and "only what this page already loaded" is a free, honest proxy
for "relevant to what the user is doing". Unknown state (`-1` sentinels) never
produces a hint.

Tours still exist and are still complete — they are reachable from the tour
launcher (help button, command palette, settings card). No tour declares an
`autoStart` predicate; `features/onboarding/__tests__/tours.test.ts` fails if one
ever does again.

**Adding a task:** append to `ONBOARDING_TASKS` with a unique id, `version: 1`, a
`routeMatch`, a prerequisite sentence, exactly one action pointing at a route
declared in `ROUTE_REGISTRY`, and an `isRelevant` predicate that is false for a
fully-configured install. The governance test enforces every one of those.

---

## 2. Empty states explain themselves (HELP-02)

`web/src/lib/emptyStateGuidance.ts` holds the four answers every empty panel
owes the user:

1. **Meaning** — what "nothing here" actually means.
2. **Prerequisite** — what must be true before data can exist.
3. **Likely cause** — why it is empty on a *healthy* install.
4. **One action** — the single most useful next step.

Rendered by `<ActionableEmptyState guidanceId="…">`, or — for a surface that
already has established copy — by `<EmptyStateGuidanceDetails>` alone, which
adds the prerequisite/cause rows without rewriting the existing title and CTA.
`NoVehicleSelected` (≈20 pages) adopts it this second way.

Rules the governance test enforces:

- Exactly **one** action. Two CTAs is a decision, and a user staring at an empty
  panel has already failed to make one.
- `action.to` must be a route in `ROUTE_REGISTRY` — no dead ends.
- The likely-cause sentence describes the **system**, never the reader. `/\byou
  (forgot|failed|did not)\b/` is a test failure.
- The panel shell always renders. Hiding a section is what created the ambiguity
  this pattern exists to remove.

---

## 3. Contextual definitions (HELP-03)

`web/src/lib/helpGlossary.ts` defines SOC, rated range, degradation, phantom
drain, efficiency and signal freshness — the six terms users *recognise* and
then misread.

Every entry carries three parts, not one:

- `definition` — what the term means.
- `howMeasured` — where **our** number comes from, so the user can judge how far
  to trust it.
- `aliases` — the words the user actually types ("vampire drain", "wh/km").

Two surfaces, deliberately:

- `<GlossaryTerm term="soc">` — inline, via the shared `<HelpTooltip>` (keyboard,
  pointer and touch reachable, `<dfn>` semantics). Self-gates on the user's
  contextual-help preference.
- `<HelpGlossaryPanel>` on `/help` — the **deterministic baseline**. Always
  available, no preference, no hover, no AI.

Where the app already shipped a vetted string, the glossary reuses that key
(`help.vampireDrain.body`, `help.battery.degradationRate`,
`help.lifetime.avgEfficiency`, `help.signal.stale`, `help.battery.soh`) so the
two surfaces cannot disagree and translators get the glossary for free.

---

## 4. Unavailable data is diagnosed, not shrugged at (HELP-04)

`web/src/lib/dataUnavailability.ts` classifies six causes that look identical on
screen and need completely different responses:

| Reason | Data state | Response |
|---|---|---|
| `vehicle_asleep` | `stale` | Nothing — normal, and waking costs range |
| `vehicle_offline` | `stale` | Wait for connectivity |
| `permission` | `unsupported` | Request access; retrying cannot help |
| `retention` | `unsupported` | Shorten the range or change policy |
| `ingestion_lag` | `stale` | Wait; check pipeline if the gap grows |
| `filter_scope` | `partial` | Widen the range / clear filters |
| `service_outage` | `unavailable` | Check status; recovers on its own |

It maps onto the **existing** `DataStateKind` contract so the visual language
does not fork. Classification priority is load-bearing and tested:
permission → outage → retention → asleep/offline → lag → filters. It returns
`null` rather than inventing a cause, in which case the caller falls back to the
governed empty-state guidance.

---

## 5. Errors point somewhere (HELP-05)

`web/src/lib/errorHelpLinks.ts` maps each `ErrorKind` to ranked destinations
across four families: **status**, **config**, **diagnostics**, **runbook**.

- In-app targets are validated against `ROUTE_REGISTRY` by the test.
- Runbooks live in the repository, not the SPA, so they are emitted **only** when
  `VITE_DOCS_BASE_URL` is set to an absolute `http(s)` base. Unset ⇒ no runbook
  link, rather than a guessed 404. The referenced paths are asserted to exist on
  disk.
- Capped at four links: a wall of eight is the same dead end with extra steps.

Rendered by `<ErrorHelpLinks error={…} />`, which shows each destination *with
the reason it is relevant* so the user chooses instead of guessing.

---

## 6. The help index (HELP-06)

`web/src/lib/helpIndex.ts` is built from data that already exists — the
generated route registry, the glossary, the empty-state registry, the onboarding
tasks and the unavailability taxonomy — so it cannot drift from the surfaces it
describes.

**Determinism is the product requirement.** No network, no AI, no clock, no
randomness; ties break on `id` ascending, so the result of a query never depends
on how the index happened to be assembled. The RAG assistant layers *alongside*
it and never replaces it: help still works with `ai_mode='off'`, offline, and on
a locked-down install.

`<HelpSearch>` is a combobox over a listbox with roving
`aria-activedescendant` — ↓/↑ move, Enter navigates, Escape clears, and DOM focus
never leaves the input so the query stays editable throughout.

---

## 7. Release notes (HELP-07)

`CHANGELOG.md` is the single source of truth. `scripts/buildChangelog.mjs`
generates `src/generated/changelog.ts`; `web/src/lib/releaseNotes.ts` derives the
product view from that. There is no second hand-maintained document, because
there is no way to keep two of them in sync.

Each release answers: **what changed**, **who is affected**, **is action
needed**, **version and date**.

Audience and action-needed are inferred by keyword. The inference is
deliberately biased toward over-reporting "action needed": a false alarm costs
thirty seconds, a missed migration costs an outage. `removed`, `deprecated` and
`security` entries are always flagged regardless of wording. Action items are
hoisted above features in the summary so an operator does not scroll past twenty
bullets to find the migration.

---

## 8. Support bundle (HELP-08)

`web/src/lib/supportBundle.ts`. The construction rule is the security control:

> **The bundle is built by explicit projection, never by spreading.**

There is no `...rest`, no `Object.assign`, no passthrough of an API response.
Adding a field requires editing that file, which is where the redaction tests
live. Every free-text value additionally goes through `lib/privacy` +
`lib/routeTemplate`.

**Included:** app version and release channel · browser *family and major
version* (never the raw user-agent) · capability flags · bucketed viewport ·
aggregate health per service · redacted error digests with route **templates** ·
trace IDs.

**Never included, permanently:** VIN · coordinates · tokens, keys, credentials ·
e-mail addresses and account names · raw console or server logs · request and
response bodies · vehicle names.

Trace IDs survive only if they match `^[0-9a-f]{16,32}$` — a trace ID is safe
precisely because it is meaningless without the server's trace store, so anything
that is not opaque hex is *dropped* rather than redacted.

`findForbiddenContent()` is exported so tests and future producers assert against
one list instead of two. The `/help` page shows the full bundle before it is
copied or downloaded.

---

## 9. Report a problem (HELP-09)

`web/src/lib/problemReport.ts` → `POST /api/v1/feedback` (existing endpoint;
deterministic delivery and audit already provided by the durable row, the
per-submitter throttle, the recorded submitter + IP, and the acceptance log).

- **Route template, never the raw path.** `/drives/91827` → `/drives/:id`.
- **Diagnostics are opt-in and previewed.** The exact JSON is rendered before
  send; consent defaults to off and resets on close.
- **Closed attachment policy**, exported as data so the UI renders the policy the
  builder enforces: console tail `never`, files `never`, screenshots `never`,
  server logs `never`, e-mail `never`.
- The user's own free text is redacted too — people paste bearer tokens and VINs
  into bug reports constantly, and the report lands in an admin queue.

**Backend (`internal/api/feedback`)** now normalises `page_route` server-side via
`webvitals.NormalizeRoute`. A feedback row is durable, visible to every admin with
queue access, and forwardable verbatim into a GitHub issue — a raw pathname puts
share tokens and VINs into all three at once. Normalising server-side means an
older SPA build or a scripted POST cannot bypass it. An empty value stays empty:
"unknown" and "the dashboard" are different facts.

---

## 10. Permission explanations (HELP-10)

`web/src/lib/permissionGuidance.ts` distinguishes five blocks that render
identically and need different responses: `unauthenticated`, `forbidden`,
`open_mode`, `feature_disabled`, `read_only`.

Each answers: what the server decided · **who can change it** · what to say when
you ask. The steps are concrete and ordered — "ask an administrator" is not
guidance, it is a shrug. Explicit server codes (`AUTH_MODE_OPEN`,
`OPERATIONAL_MODE_READ_ONLY`) beat the SPA's cached belief about the deployment.

---

## 11. Dashboard presets (HELP-11)

`web/src/lib/dashboardPresets.ts` curates four role presets — owner, fleet
operator, energy analyst, maintainer — over the **existing** widget registry.

- **Compose, never duplicate.** A preset is an ordered list of widget ids plus a
  stated rationale, not another saved dashboard.
- **Persist the preference, not a copy.** Only the chosen role id is stored, so
  improving a preset improves it for everyone who chose it rather than freezing a
  snapshot at click time.
- The module stays data-only (no registry import) so the picker does not pull the
  widget catalogue and its lazy chunks into the help route. Widget ids **and
  their labels** are asserted against `WIDGET_REGISTRY` in the test, which is
  what makes the duplicated label safe.

---

## 12. Demo mode (HELP-12)

`web/src/lib/demoMode.ts`. Fail-closed on every axis:

1. **Never on by default.** `VITE_DEMO_MODE` must be exactly `'true'` — `'1'`,
   `'yes'` and `'TRUE'` are rejected, so a sloppy env file cannot enable it.
2. **Isolated source.** Also requires `VITE_DEMO_API_BASE`, non-empty and
   different from `/api/v1`. Without it the guard refuses to enable rather than
   point synthetic UI at real endpoints.
3. **Isolated storage and cache.** `demoStorageKey()` and `demoQueryKey()`
   namespace everything and **throw** when demo mode is off — a demo key in a
   production session means the boundary has already been crossed, and silently
   returning the real key would hide that. `purgeDemoStorage()` only ever touches
   prefixed keys.
4. **Unmistakable.** `<DemoModeBanner>` is persistent, top-of-viewport, and not
   dismissible. A dismissed warning is an absent warning.

`assertDemoModeEnabled()` guards any code path that produces synthetic data,
turning a silent data-integrity bug into a loud crash in the one build where it
can be noticed.

---

## Where things live

```
web/src/lib/
  onboardingTasks.ts      HELP-01   task registry + suppression rules
  emptyStateGuidance.ts   HELP-02   governed empty-state copy
  helpGlossary.ts         HELP-03   definitions + provenance
  dataUnavailability.ts   HELP-04   six-cause classifier
  errorHelpLinks.ts       HELP-05   error → status/config/diagnostics/runbook
  helpIndex.ts            HELP-06   deterministic searchable index
  releaseNotes.ts         HELP-07   derived from the canonical changelog
  supportBundle.ts        HELP-08   privacy-safe bundle + redaction contract
  problemReport.ts        HELP-09   sanitised submission + attachment policy
  permissionGuidance.ts   HELP-10   access blocks + request-access steps
  dashboardPresets.ts     HELP-11   role presets + preference
  demoMode.ts             HELP-12   fail-closed demo guard

web/src/components/feedback/   ActionableEmptyState, DataUnavailableNotice,
                               ErrorHelpLinks, PermissionGuidanceNotice,
                               DemoModeBanner, ProblemReportModal
web/src/components/ui/         GlossaryTerm
web/src/features/onboarding/   useTaskOnboarding, TaskOnboardingHint/Host
web/src/features/system/components/help-index/   HelpSearch, glossary,
                               release notes, support bundle, preset panels
web/src/api/hooks/useSupport.ts   useSupportBundle, useSubmitProblemReport
internal/api/feedback/handler.go  server-side page_route normalisation
```
