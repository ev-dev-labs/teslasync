---
description: "Phase-50 / Prompt 9999 — Final Gate"
---

# Phase-50 / Prompt 9999 — Final Gate

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-9999-final-gate.log` |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no `return nil`, `// TODO`, `panic("not impl")`
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - `git status` outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| `=== PREFLIGHT ===` | Branch, predecessor logs, and dirty-tree check. |
| `=== SURVEY ===` | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| `=== REASONING ===` | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| `=== CHANGES ===` | Summary of production, test, registry, i18n, prompt, and golden changes. |
| `=== GATE ===` | Full command transcripts with EXIT markers. |
| `=== COMMIT ===` | git add/commit transcript, or blocked-log-only commit transcript. |
| `=== AI-OFF CONTRACT ===` | ADR-015 footer with evidence for every invariant this slice touches. |
| `=== STATUS ===` | Final `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in `=== PREFLIGHT ===`.
3. Survey the current code and document the baseline in `=== SURVEY ===` before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into `=== GATE ===`.
6. If any gate fails, stop with `STATUS=BLOCKED` and commit only the log.

<!-- BEGIN: HX (Helix UX) FINAL-GATE ADDENDUM -->
## Helix UX (HX) project-wide invariants

After all per-feature slices have landed, the final gate MUST also
prove the Helix UX scaffold contract (Phase-50/HX, see any per-slice
prompt under "## Helix UX scaffolding") holds project-wide. These
checks supplement, but do not replace, the existing W1 wiring gates.

Run these targeted scans (no broad `"AI"` bans — feature verbs and
domain text legitimately contain the substring):

~~~powershell
# 1. Every non-internal AI feature component imports the shared
#    AIFeatureCard scaffold. Components that legitimately render
#    a non-card affordance (chat surfaces, voice/watch surfaces,
#    image-generation surfaces) are exempt; list them in
#    `web/src/components/ai/__hx_scaffold_exemptions.ts`.
$wired = Get-ChildItem 'web/src/components/ai/AI*.tsx' |
  Where-Object { $_.Name -notmatch '^(AIFeatureCard|AIThinkingIndicator|AIChatbotIndicator|AiLimitBanner|AiOutputPanel|ConfirmDialog)\.tsx$' }
$missing = $wired | ForEach-Object {
  if (-not (Select-String -Path $_.FullName -Pattern "from '@/components/ai/AIFeatureCard'" -Quiet)) { $_.Name }
}
# Expected: $missing is empty OR every entry is in the exemption list.

# 2. The HelixMark glyph owns assistant-identity slots — lucide
#    `Bot` MUST NOT appear in components/ai/* or in the Avatar
#    bot-kind path. Other Bot usages (e.g. notification "Bot
#    Token" labels) are fine.
Select-String -Path 'web/src/components/ai/*.tsx','web/src/components/data-display/Avatar.tsx' -Pattern "from 'lucide-react'.*\bBot\b|\bimport \{.*\bBot\b.*\} from 'lucide-react'" |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: 0

# 3. AIFeatureCard paints the universal CTA. Verify the card emits
#    the literal "helix.askHelix" / "helix.thinking" i18n keys
#    (or their resolved English strings "Ask Helix" / "Helix is
#    thinking…").
Select-String -Path 'web/src/components/ai/AIFeatureCard.tsx' -Pattern 'helix\.askHelix|Ask Helix' |
  Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path 'web/src/components/ai/AIFeatureCard.tsx' -Pattern 'helix\.thinking|Helix is thinking' |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: both > 0.

# 4. Targeted stale-copy scan: legacy "AI calls today" / "AI usage"
#    strings are gone (the rebrand replaced them with the Helix-
#    branded equivalents). New slices MUST NOT re-introduce them.
Select-String -Path 'web/src/**/*.tsx','web/src/i18n/*.json' -Pattern '"AI calls today"|"AI usage"|"No AI calls"|"AI is thinking"' |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: 0

# 5. Tests locate the universal CTA via unanchored regexes — no
#    test in the repo asserts on `/^Ask Helix$/i` (which would be
#    fragile against the per-feature aria-label suffix).
Select-String -Path 'web/src/**/__tests__/AI*.tsx','web/src/**/*.test.tsx' -Pattern "/\^Ask Helix\$/" |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: 0
~~~

If a slice legitimately needs a non-card AI surface (chat bubbles,
voice-mode mic, image-gen previews, watch-face responses), add it to
`web/src/components/ai/__hx_scaffold_exemptions.ts` with a one-line
comment explaining the affordance. The final-gate scan reads that
exemption list when computing the `$missing` set above.
<!-- END: HX (Helix UX) FINAL-GATE ADDENDUM -->

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains `EXIT=0` and `STATUS=DONE` on their own lines, the ADR-015 footer is present with evidence, the Helix UX (HX) project-wide invariants above all hold, and `git status --short` contains only allowed files before commit.

## Commit

Use a conventional commit for this slice and include the required trailer:

~~~text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

## Blocked Path

If a predecessor is missing, verification cannot run, or any gate fails, write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Commit only the blocked log and include the command output that proves the blocker.

> **Read first:** [ADR-015](../adrs/ADR-015-ai-off-contract.md), [Methodology](./0000-methodology.prompt.md)
> **Depends on:** every prior slice 0001–0064 reporting STATUS=DONE
> **Cannot be skipped — Phase-50 is not closed without this slice green.**

## Why

Per ADR-015 §I11 (final-gate proof), Phase-50 must end with an
auditable proof that the AI-Off Contract holds end-to-end. This
slice is a **verification-only** slice — no production code changes,
only test infrastructure + the audit report.

## Tasks

### 1. Pre-flight: every prior slice landed cleanly

```
ls .github/prompts/db-refactor/logs/phase-50-*.log | wc -l
# expect: 64

grep -L 'STATUS=DONE' .github/prompts/db-refactor/logs/phase-50-*.log
# expect: empty (every log ends DONE)

grep -L '=== AI-OFF CONTRACT ===' .github/prompts/db-refactor/logs/phase-50-*.log
# expect: empty (every log includes the footer)
```

### 2. Build matrix

```
go build ./...                 # exit 0
go vet ./...                   # exit 0
go test -race ./...            # exit 0
go run ./tools/aivet           # exit 0
go run ./tools/aigen --check   # exit 0
go run ./tools/eval-schema-check  # exit 0

cd web
npx tsc --noEmit               # exit 0
npm run lint                   # exit 0  (custom ai-component-must-be-wrapped clean)
npm test -- --run              # exit 0
npm run build                  # exit 0
```

### 3. Eval gate

```
make ai-eval-fast              # exit 0
# Per-feature pass rate >= 80% on canned goldens
```

### 4. AI-Off Contract invariant suite (the heart of this slice)

Three NEW test files exercise EVERY invariant for EVERY registered
feature:

#### 4a. `internal/ai/guard/contract_test.go` — backend invariants

```go
// internal/ai/guard/contract_test.go
func TestAIOffContract_AllFeatures(t *testing.T) {
    setMode(t, "off")
    require.NoError(t, features.CoverageOK())  // every feature has surface metadata

    for id, f := range features.Registry {
        t.Run(id, func(t *testing.T) {
            // I1 default-off
            require.False(t, settings.AIFeatureEnabled(id))

            // I6 404 routes — every BACKEND route from registry returns 404
            for _, route := range f.Routes.Backend {
                resp := httptest.Do(route)  // parses "METHOD /path"
                require.Equal(t, 404, resp.Code, "route=%s", route)
            }

            // I7 per-feature opt-in: with mode=local + feature off → still 404
            setMode(t, "local")
            for _, route := range f.Routes.Backend {
                resp := httptest.Do(route)
                require.Equal(t, 404, resp.Code, "route=%s (local, feature off)", route)
            }
            setMode(t, "off")

            // I9 keys never leak
            settingsResp := httptest.Get("/api/v1/settings")
            require.NotContains(t, settingsResp.Body.String(), "ai_provider_config")
            require.NotContains(t, settingsResp.Body.String(), "api_key")

            // I4 zero egress: ai_call_log row count == 0 for this user
            require.Zero(t, db.Count("ai_call_log", "user_id=?", testUserID))

            // I12 background jobs: no rows produced by feature's jobs
            for _, jobName := range f.Routes.JobNames {
                runJobOnce(t, jobName)
                require.Zero(t, jobMutationsTouchedRows(t, jobName), "job %s mutated rows in off mode", jobName)
            }
        })
    }
}

// I12 baseline endpoint parity: every baseline route returns identical JSON
// (modulo timestamps + IDs) under off vs. all-AI-on.
func TestBaselineEndpointParity(t *testing.T) {
    routes := loadBaselineRouteList(t)  // generated from internal/api/router.go
    setMode(t, "off");   offSnap := snapshotAllRoutes(t, routes)
    setMode(t, "cloud"); enableEverything(t); onSnap := snapshotAllRoutes(t, routes)
    diff := compareSnapshots(offSnap, onSnap, ignoreFields("timestamp","id","etag"))
    require.Empty(t, diff, "baseline endpoint shape changed when AI on: %v", diff)
}

// I4 (egress side): block all known provider hostnames; assert no
// outbound request observed during a 5-minute soak with mode=off.
func TestZeroProviderEgress_OffMode(t *testing.T) {
    intercept := installProviderHostInterceptor(t, []string{
        "api.openai.com", "api.anthropic.com", "*.openai.azure.com",
        "ollama:11434", "localhost:11434", "127.0.0.1:11434",
    })
    setMode(t, "off")
    runWorkloadSoak(t, 5*time.Minute)  // exercises all baseline endpoints + all jobs
    require.Empty(t, intercept.Calls(), "outbound provider call observed in off mode: %v", intercept.Calls())
}
```

#### 4b. `tests/ai-off-contract.spec.ts` — Playwright frontend invariants

```ts
test.describe('AI-off contract', () => {
  test.beforeAll(setAiMode('off'));

  // Provider-host network interceptor — fails on first hit.
  test.beforeEach(async ({ context }) => {
    context.on('request', req => {
      const url = req.url();
      if (/openai\.com|anthropic\.com|:11434/.test(url)) {
        throw new Error(`forbidden provider call in off mode: ${url}`);
      }
    });
  });

  // I5 — for EVERY registered feature, walk EVERY frontend route and
  // assert the feature's UI test ID is absent.
  for (const [id, f] of Object.entries(AI_FEATURES)) {
    for (const route of f.routes.frontend) {
      test(`I5 — ${id} hidden on ${route}`, async ({ page }) => {
        await page.goto(route);
        for (const tid of f.routes.uiTestIDs) {
          await expect(page.getByTestId(tid)).toHaveCount(0);
        }
      });
    }
  }

  // I3 — every baseline page renders without error
  test('I3 — baseline routes render', async ({ page }) => {
    for (const route of BASELINE_ROUTES) {  // ALL ~130 routes from router
      await page.goto(route);
      await expect(page.locator('[data-error-boundary]')).toHaveCount(0);
      await expect(page.locator('[data-status="5"]')).toHaveCount(0);
    }
  });

  // I12 — service worker has no AI chunks in off mode
  test('I12 — service worker manifest excludes ai-* chunks', async ({ page }) => {
    await page.goto('/');
    const manifest = await page.evaluate(() => fetch('/sw-manifest.json').then(r => r.json()));
    expect(manifest.precache.filter((url: string) => /\bai[-/]/.test(url))).toEqual([]);
  });

  // I12 — client storage contains no ai.* keys
  test('I12 — client storage has no ai.* keys', async ({ page }) => {
    await page.goto('/dashboard');
    const keys = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    expect(keys.filter(k => k.startsWith('ai.'))).toEqual([]);
  });
});
```

#### 4c. Push-fanout suppression test (I12)

```go
func TestPushFanout_AiKindsSuppressed_OffMode(t *testing.T) {
    setMode(t, "off")
    sub := db.InsertPushSubscription(testUserID, "ai_anomaly_explanation")
    fanout.Send(t.Context(), Payload{Kind: "ai_anomaly_explanation", Body: "..."})
    require.Zero(t, fakeWebPushClient.Sent(sub.ID))
}
```

### 5. Audit report

Generate `.github/prompts/db-refactor/logs/phase-50-9999-final-gate.log`
including:

```
=== PHASE-50 FINAL GATE REPORT ===

Slices completed:        64 / 64
Goldens passing:         <X> / <Y>  (>=80% per feature)
Registry coverage:       PASS (every feature has Routes/UI/Jobs metadata)
ai_call_log rows in off: 0
/api/v1/ai/* in off:     0 (404 for every registered route)
Baseline routes:         130 / 130 render without error
Baseline endpoint parity:PASS (snapshot diff empty)
Provider-host egress:    0 calls in 5-min off soak
SW manifest ai chunks:   0
Client storage ai.* keys:0
AI background job execs: 0 in off mode
AI push deliveries:      0 in off mode
Type-system gate:        PASS (aivet + aigen + ESLint)

=== AI-OFF CONTRACT (per-invariant proof) ===
I1 default-off:     PASS  (settings query returns ai_mode='off' for fresh user)
I2 three modes:     PASS  (constraint enforced at DB; tested)
I3 baseline intact: PASS  (130 routes, 0 errors)
I4 zero egress:     PASS  (ai_call_log=0; provider-host interceptor=0; 5-min soak)
I5 hidden UI:       PASS  (every feature × every frontend route × every testID = absent)
I6 404 routes:      PASS  (every registered backend route returns 404)
I7 per-feature:     PASS  (default ai_features={}; toggle off → 404 even with mode=local)
I8 data survives:   PASS  (caches persist after off→on→off→on round trip)
I9 keys never leak: PASS  (settings DTO redacted; verified via string match in 3 modes)
I10 type system:    PASS  (aivet + aigen + ESLint clean; CoverageOK passes)
I11 final-gate:     PASS  (this report)
I12 client/bg:      PASS  (SW=clean, storage=clean, jobs=skipped, push=suppressed, parity=clean)

=== STATUS === EXIT=0 STATUS=DONE
```

### 6. Tag and announce

- `git tag phase-50-final-gate`
- Append a short summary to `CHANGELOG.md` under
  `## Unreleased — feat: ai adoption (opt-in)`.

## Allowed files

- `internal/ai/guard/contract_test.go`
- `internal/ai/guard/baseline_parity_test.go`
- `internal/ai/guard/egress_interceptor_test.go`
- `internal/jobs/push_fanout_test.go` (extend with off-mode test)
- `tests/ai-off-contract.spec.ts`
- `tests/baseline-routes.json` (generated from router walk)
- `CHANGELOG.md`
- `.github/prompts/db-refactor/logs/phase-50-9999-final-gate.log`

NO production source changes. Any production diff in this slice ⇒
STATUS=BLOCKED — fix the relevant feature slice instead.

Note: feature-route metadata is NOT a file in this slice — it lives
in `internal/ai/features/registry.go` and is contributed by each
feature slice (see methodology §"Mandatory per-slice metadata
contribution"). The final-gate test reads it directly from the Go
registry; there is no separate `ai-feature-routes.json` to maintain.

## Verification

The slice is its own verification. Exit 0 on every step in §1–§4
plus a complete report in §5 ⇒ STATUS=DONE.

## Forward dependency

None. This is the terminal slice for Phase-50.

