---
description: "Phase-50 / Prompt 0001 — F0: AI-Off Contract (BLOCKING foundation)"
---

# Phase-50 / Prompt 0001 — F0: AI-Off Contract (BLOCKING foundation)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0001-F0-ai-off-contract.log |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no eturn nil, // TODO, panic("not impl")
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - git status outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| === PREFLIGHT === | Branch, predecessor logs, and dirty-tree check. |
| === SURVEY === | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| === REASONING === | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| === CHANGES === | Summary of production, test, registry, i18n, prompt, and golden changes. |
| === GATE === | Full command transcripts with EXIT markers. |
| === COMMIT === | git add/commit transcript, or blocked-log-only commit transcript. |
| === AI-OFF CONTRACT === | ADR-015 footer with evidence for every invariant this slice touches. |
| === STATUS === | Final EXIT=<int> and STATUS=<DONE|BLOCKED> markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in === PREFLIGHT ===.
3. Survey the current code and document the baseline in === SURVEY === before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into === GATE ===.
6. If any gate fails, stop with STATUS=BLOCKED and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains EXIT=0 and STATUS=DONE on their own lines, the ADR-015 footer is present with evidence, and git status --short contains only allowed files before commit.

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

> **Read first:**
> - [ADR-015 — AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)
> - [Phase-50 Methodology](./0000-methodology.prompt.md) (especially P6, P9, D8)

## Why

Per ADR-015, AI is strictly additive. A user with `ai_mode='off'`
must see no AI UI surface, make no AI HTTP calls, and write no AI
rows to the database. This invariant is the binding constraint on
every subsequent slice in Phase-50. It must be enforced by the type
system (P6) and the feature registry (P9), not by code-review
discipline. **No AI feature slice may merge before this one.**

## Evidence (current state)

```
$ rg -l 'openai|anthropic|llm|ollama|embedding' --type go internal/
# (empty — no AI today)

$ psql -c "\d settings" | grep -E 'ai_'
# (empty — no AI columns)

$ rg 'useAiEnabled|withAiFeature' web/src
# (empty — hook + HOC do not exist)
```

## Design

### D1.1 Schema

Migration `000196_ai_settings.up.sql`:

```sql
ALTER TABLE settings
  ADD COLUMN ai_mode     TEXT  NOT NULL DEFAULT 'off'
    CHECK (ai_mode IN ('off','local','cloud')),
  ADD COLUMN ai_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN ai_provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN ai_cost_cap_cents INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN settings.ai_mode IS
  'AI feature gate. off (default) blocks all AI surfaces. local accepts only RFC1918/loopback providers. cloud allows any provider. See ADR-015.';
COMMENT ON COLUMN settings.ai_features IS
  'Per-feature opt-in map keyed by feature ID (registry P9). Default {} means every feature off.';
COMMENT ON COLUMN settings.ai_provider_config IS
  'Adapter-specific config (base_url, model, api_key_ref). Never returned to client when ai_mode=off (ADR-015 I9).';
COMMENT ON COLUMN settings.ai_cost_cap_cents IS
  'Daily cost cap in cents. 0 = unset (rate limiter still applies). See F9.';
```

Down migration drops the columns.

### D1.2 Feature registry (P9)

`internal/ai/features/registry.go`:

```go
package features

type Feature struct {
    ID          string  // canonical kebab-case e.g. "chatbot-llm"
    Name        string  // display name e.g. "LLM Chatbot"
    Description string  // one-line UX hint
    Tier        string  // "F"|"U"|"N"|"D"|"C"|"T"|"A"|"G"|"X"|"S"|"M"|"P"|"V"|"PU"|"GEN"|"ML"
    DefaultOn   bool    // always false in this phase (ADR-015 I7)
    NeedsRAG    bool    // true if feature requires F7 embeddings
    NeedsTools  bool    // true if feature mutates state via F4 tool registry
    NeedsStream bool    // true if feature uses F5 SSE streaming
}

var Registry = map[string]Feature{
    "chatbot-llm": {ID: "chatbot-llm", Name: "LLM Chatbot", Tier: "U", DefaultOn: false, NeedsTools: true, NeedsStream: true, NeedsRAG: true,
        Routes: RouteSet{
            Backend:  []string{"POST /api/v1/ai/chatbot"},
            Frontend: []string{"/chatbot"},
            UITestIDs: []string{"ai-feature-chatbot-llm"},
            JobNames: []string{},          // no background jobs
            PushKinds: []string{},
        }},
    // ... seeded by every later slice (F2 generates settings UI from this)
}

type RouteSet struct {
    Backend   []string  // method+path patterns; final-gate hits each with auth and asserts 404 in off
    Frontend  []string  // SPA routes hosting the feature; final-gate visits each with Playwright
    UITestIDs []string  // data-testid markers used by withAiFeature wrapper; absence asserted in off
    JobNames  []string  // background job IDs registered for this feature
    PushKinds []string  // push_subscription.kind values for this feature
}

func IsKnown(id string) bool { _, ok := Registry[id]; return ok }

// CoverageOK fails CI if a registered feature has no Routes/UITestIDs/JobNames
// (i.e. its final-gate coverage would be zero). Empty arrays must be explicit
// (signaling "this feature has none of this surface") not omitted.
func CoverageOK() error {
    for id, f := range Registry {
        if f.Routes.Backend == nil && f.Routes.Frontend == nil && f.Routes.JobNames == nil {
            return fmt.Errorf("feature %q has no surface metadata; final gate cannot prove off-mode contract", id)
        }
    }
    return nil
}
```

Each later feature slice MUST add its entry as part of the slice
diff. A feature without a registry entry is invisible to the
settings UI, the off-mode walker, and the eval harness.

### D1.3 Backend gate — `ai.GuardedHandler` middleware

`internal/ai/guard/guard.go`:

```go
package guard

import (
    "net/http"
    "github.com/ev-dev-labs/teslasync/internal/ai/features"
    "github.com/ev-dev-labs/teslasync/internal/database"
)

type Settings interface {
    AIMode(ctx context.Context, userID int64) (string, error)
    AIFeatureEnabled(ctx context.Context, userID int64, featureID string) (bool, error)
}

type Guard struct{ s Settings }

func New(s Settings) *Guard { return &Guard{s: s} }

// Wrap returns 404 unless ai_mode != 'off' AND ai_features[featureID] == true.
// 404 (not 403/503) is intentional per ADR-015 §I6 — the route is
// functionally non-existent for this user.
func (g *Guard) Wrap(featureID string, h http.HandlerFunc) http.HandlerFunc {
    if !features.IsKnown(featureID) {
        panic("unknown ai feature: " + featureID) // boot-time fail
    }
    return func(w http.ResponseWriter, r *http.Request) {
        userID := userIDFrom(r)
        mode, err := g.s.AIMode(r.Context(), userID)
        if err != nil || mode == "off" {
            http.NotFound(w, r); return
        }
        on, err := g.s.AIFeatureEnabled(r.Context(), userID, featureID)
        if err != nil || !on {
            http.NotFound(w, r); return
        }
        h(w, r)
    }
}
```

The `panic` on unknown feature ensures a misspelled ID is caught at
boot, not at the first request.

### D1.4 Backend vet check — registry coverage and route wrapping

`tools/aivet/main.go` parses `internal/api/router.go` and asserts:
1. Every route under `/api/v1/ai/` is registered via `guard.Wrap(...)`, not bare.
2. Every backend pattern in `features.Registry[id].Routes.Backend` exists in the router.
3. Every router pattern under `/api/v1/ai/` is owned by exactly one registry entry's `Routes.Backend` (no orphans, no duplicates).
4. `features.CoverageOK()` returns nil — every registered feature has surface metadata.

CI invokes `go run ./tools/aivet`. Failure of any check blocks merge.

### D1.5 Frontend hook — `useAiEnabled`

`web/src/hooks/useAiEnabled.ts`:

```ts
import { useSettings } from '@/hooks/useSettings';
import { AI_FEATURES } from '@/ai/features';
import type { AiFeatureId } from '@/ai/features';

export function useAiEnabled(feature: AiFeatureId): boolean {
  const { data } = useSettings();
  if (!data) return false;
  if (data.ai_mode === 'off') return false;
  if (!AI_FEATURES[feature]) return false; // unknown id
  return data.ai_features?.[feature] === true;
}
```

`web/src/ai/features.ts` is the TS-side mirror of the Go registry,
generated by `tools/aigen/main.go` (so the two cannot drift). The
generator is a step in `make generate` and a CI check.

### D1.6 Frontend HOC — `withAiFeature`

`web/src/components/ai/withAiFeature.tsx`:

```tsx
import { useAiEnabled } from '@/hooks/useAiEnabled';
import type { AiFeatureId } from '@/ai/features';
import type { ComponentType } from 'react';

export function withAiFeature<P extends object>(
  feature: AiFeatureId,
  Inner: ComponentType<P>
): ComponentType<P> {
  const Wrapped: ComponentType<P> = (props) => {
    const enabled = useAiEnabled(feature);
    if (!enabled) return null;
    return <Inner {...props} />;
  };
  Wrapped.displayName = `withAiFeature(${feature}, ${Inner.displayName ?? Inner.name})`;
  return Wrapped;
}
```

### D1.7 ESLint rule — `teslasync/ai-component-must-be-wrapped`

`web/eslint-rules/ai-component-must-be-wrapped.js`. Heuristic:
any component file under `web/src/features/**/ai/**/*.tsx` OR
any default-exported component whose name matches `/^Ai[A-Z]/` MUST
be the result of `withAiFeature(...)`. Failure: ESLint error.

### D1.8 Off-mode invariant tests

Two test suites:

1. `internal/ai/guard/off_mode_test.go` — for each registered feature
   route, with `ai_mode='off'`, GET → 404 expected.
2. `web/src/ai/__tests__/offMode.invariant.test.tsx` — for every
   registered feature, mount a tree containing the feature's main
   component with `ai_mode='off'` settings; assert nothing matching
   the feature's `data-ai-feature` test-id renders.

A third Playwright suite (`tests/ai-off-mode.spec.ts`) is added but
gated behind `RUN_PLAYWRIGHT=1` and only required by 9999 final
gate.

## Tasks

1. Write migration `000196_ai_settings.up.sql` + down.
2. Write Go feature registry (`internal/ai/features/registry.go`)
   with the seeded `chatbot-llm` entry only.
3. Write the `guard` package + tests.
4. Write the vet tool `tools/aivet`.
5. Write the TS-generator tool `tools/aigen` (Go program reading
   the Go registry, emitting `web/src/ai/features.ts`).
6. Wire `make generate` to call `aigen`.
7. Write the `useAiEnabled` hook + unit tests.
8. Write the `withAiFeature` HOC + unit tests.
9. Write the ESLint rule + unit tests + register in
   `web/eslint.config.js`.
10. Write the off-mode invariant test suites.
11. Update `internal/api/router.go` to construct the guard once at
    startup and inject into router setup.
12. Update `internal/database/settings_repo.go` to expose `AIMode`
    and `AIFeatureEnabled` methods.
13. Update Settings response DTO to NEVER include
    `ai_provider_config` when `ai_mode='off'` (ADR-015 §I9).

## Allowed files

- `migrations/000196_ai_settings.up.sql`, `.down.sql`
- `internal/ai/features/**` (new package)
- `internal/ai/guard/**` (new package)
- `tools/aivet/**` (new tool)
- `tools/aigen/**` (new tool)
- `internal/database/settings_repo.go` (add 2 methods + tests)
- `internal/api/router.go` (inject guard)
- `internal/api/settings_handler.go` (DTO redaction)
- `web/src/ai/**` (new dir for generated registry + types)
- `web/src/hooks/useAiEnabled.ts` (+ test)
- `web/src/components/ai/withAiFeature.tsx` (+ test)
- `web/eslint-rules/ai-component-must-be-wrapped.js` (+ test)
- `web/eslint.config.js` (register rule)
- `Makefile` (add `generate` step)
- `tests/ai-off-mode.spec.ts` (Playwright)
- `internal/ai/guard/off_mode_test.go`
- `web/src/ai/__tests__/offMode.invariant.test.tsx`

Any other file ⇒ STATUS=BLOCKED.

## Verification

```
goose up                              # exit 0
go test -race ./internal/ai/...        # exit 0
go run ./tools/aivet                   # exit 0
go run ./tools/aigen --check           # exit 0 (TS in sync)
cd web && npx tsc --noEmit             # exit 0
cd web && npm test -- --run useAiEnabled withAiFeature offMode.invariant
cd web && npx eslint . --max-warnings 0
```

Then:

```
# default-off check
psql -c "SELECT ai_mode, ai_features FROM settings LIMIT 1"
# expect: ai_mode = 'off', ai_features = '{}'

# 404 check (with seeded chatbot-llm route stub)
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/v1/ai/chatbot
# expect: 404
```

## Deliverable

Write `.github/prompts/db-refactor/logs/phase-50-0001-F0-ai-off-contract.log`
ending with:

```
=== AI-OFF CONTRACT ===
I1 default-off:     PASS  (psql shows ai_mode='off')
I5 hidden UI:       PASS  (offMode.invariant.test passes)
I6 404 routes:      PASS  (curl returns 404)
I10 type system:    PASS  (aivet exit 0, ESLint exit 0)
=======================

=== STATUS === EXIT=0 STATUS=DONE
```

## Forward dependency

Every later slice (0002–9999) reads the feature registry, wraps its
component with `withAiFeature`, and wraps its handler with
`guard.Wrap`. A slice that does not is rejected by `aivet` and
ESLint at CI time.

