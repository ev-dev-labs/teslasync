---
description: "Phase-50 / Prompt 0007 — F6: Eval Harness"
---

# Phase-50 / Prompt 0007 — F6: Eval Harness

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0007-F6-eval-harness.log |
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

> **Depends on:** F0, F1, F4 (strategy interface), mock provider
> **Patterns:** P8 (eval as data), D6 (CI gating), D15 (deterministic mock)

## Why

LLMs regress silently. Without a reproducible eval harness, a model
swap, prompt tweak, or library upgrade can degrade quality with no
warning. The harness gives us a Git-tracked golden suite and a CI
gate so we can refactor with confidence.

## Design

### D7.1 Golden format

`internal/ai/strategies/<feature>/goldens.yaml`:

```yaml
# example: chatbot
- name: range_question
  input:
    user_message: "How far can I drive on a full charge?"
    context_overrides:
      vehicle_state:
        battery_level: 100
        range_meters: 500000
  expect:
    must_call_tools: ["query_battery_status"]
    must_not_call_tools: ["create_alert"]
    answer_must_contain: ["310", "miles"]      # OR predicate (locale dependent? settings injected)
    answer_must_not_contain: ["I don't know"]
    judge_rubric: |
      Score 1-5 on: factual accuracy (uses provided range), tone (friendly,
      concise), avoids hallucination. Pass = score >= 4.
    judge_pass_threshold: 4
```

### D7.2 Runner

`cmd/ai-eval/main.go`:

```
ai-eval --feature chatbot-llm                # one feature
ai-eval --all                                # full suite
ai-eval --all --judge-model gpt-4o           # use real judge
ai-eval --all --output junit.xml             # CI format
ai-eval --record golden.yaml                 # human-in-loop record mode
```

Runner steps per golden:
1. Load Strategy for feature (P4).
2. Build StrategyInput from golden.input + context_overrides.
3. Build Dispatcher with **mock provider keyed by sha256(prompt)**
   (D15). If no canned response exists for the hash, fail with
   "missing canned: <hash>". Canned responses live in
   `internal/ai/strategies/<feature>/canned/<hash>.yaml`. Recording
   mode hits the real provider and saves the canned file.
4. Run dispatcher; capture: tool calls, tool args, final answer,
   token usage.
5. Apply assertions: tool sets, regex/contains checks.
6. If `judge_rubric` present, optionally invoke LLM-as-judge (a
   second dispatcher run with a fixed judge prompt + seeded model
   per R6).
7. Emit pass/fail row + aggregate.

### D7.3 CI integration (D6)

- PR runs: `make ai-eval-fast` — uses canned responses only, no
  network. Advisory (does not block merge). Posts a comment with
  pass-rate delta.
- main runs: `make ai-eval-full` — recording mode disabled, uses
  canned. Blocks merge to main if pass-rate drops > 5pt.
- Nightly: `make ai-eval-judged` — runs LLM-as-judge against canned
  outputs to detect drift in human-acceptability of the SAME
  outputs.

### D7.4 Deterministic mock provider (D15)

`internal/ai/provider/mock/canned.go`:

```go
// Mock returns canned responses by sha256 hash of the request.
// Populated from goldens at startup. Misses panic in test, soft-fail
// in eval-record mode.
type Mock struct {
    hashes map[string]ChatResponse
    record bool
}
```

The hash includes: `model`, `temperature`, `messages` (canonicalised
JSON), `tool_specs` (sorted by name). Mock is the ONLY provider used
in unit tests + the default eval mode.

### D7.5 Judge prompt template (R6 mitigation)

`internal/ai/eval/judge_prompt.tmpl`:

```
You are a strict QA reviewer. Given the user question, the assistant
answer, and the rubric, output JSON:

{ "score": <1-5 integer>, "reason": "..." }

Use temperature=0, seed=42. Never modify the rubric.
```

Judge model + seed pinned in CI config so two consecutive judge runs
on the same answer produce identical scores (R6 mitigation).

## Tasks

1. Golden YAML schema + JSON-Schema validator (`tools/eval-schema-check`).
2. Mock provider canned-response loader.
3. Eval runner with the four modes above.
4. Judge prompt + judge runner with seeded provider.
5. CI workflow `.github/workflows/ai-eval.yml` running fast on PRs,
   full on main, judged nightly.
6. Seed `chatbot-llm` golden file with 5 starter cases (covers happy
   path, tool-call, tool-call-then-answer, refusal, ambiguous).

## Allowed files

- `cmd/ai-eval/**`
- `internal/ai/eval/**`
- `internal/ai/provider/mock/canned.go` (extend mock)
- `internal/ai/strategies/chatbot-llm/goldens.yaml`
- `internal/ai/strategies/chatbot-llm/canned/*.yaml`
- `tools/eval-schema-check/**`
- `.github/workflows/ai-eval.yml`
- `Makefile` (3 targets)

## Verification

```
make ai-eval-fast          # exit 0 with seeded chatbot goldens
go run ./tools/eval-schema-check  # exit 0
```

## Deliverable

Log + ADR-015 footer. Eval results table embedded in log.

## Forward dependency

Every later strategy MUST land its `goldens.yaml` in the same slice;
final-gate prompt asserts every registered feature has ≥3 goldens.

