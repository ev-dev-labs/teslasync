---
description: "Phase-50 / Prompt 0009 — F8: Redaction Layer"
---

# Phase-50 / Prompt 0009 — F8: Redaction Layer

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0009-F8-redaction.log |
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

> **Depends on:** F1 (decorator slot)
> **Pattern:** P5 (decorator chain), Strategy.RedactionPolicy()
> **Reads:** ADR-015 §I4 (zero egress) + privacy ADRs

## Why

Cloud providers see whatever we send. Without a structured redactor,
a single accidental `%v` of a vehicle state floods OpenAI with VINs,
GPS coords, addresses, and emails. The redactor sits in the
decorator chain (P5) so every cloud call is sanitized by default;
each Strategy explicitly opts data classes back in via
`RedactionPolicy.Allow{...}` only when needed.

## Design

### D9.1 PII classes

```go
type PIIClass string
const (
    ClassVIN          PIIClass = "vin"
    ClassEmail        PIIClass = "email"
    ClassPhone        PIIClass = "phone"
    ClassLatLong      PIIClass = "latlong"   // GPS coordinates pair
    ClassStreetAddr   PIIClass = "address"
    ClassIPAddress    PIIClass = "ip"
    ClassUserID       PIIClass = "userid"
    ClassVehicleName  PIIClass = "vehname"   // user-set vehicle name often = "Joe's Tesla"
    ClassPlate        PIIClass = "plate"
    ClassCreditCard   PIIClass = "cc"        // defensive
    ClassSSN          PIIClass = "ssn"       // defensive
)
```

### D9.2 Detector

`internal/ai/redact/detect.go`:

- VIN: 17-char `[A-HJ-NPR-Z0-9]{17}` (no I, O, Q).
- Email: RFC 5322 simplified.
- Phone: E.164 + common US formats.
- Lat/long: `[-]?\d{1,3}\.\d{4,}, ?[-]?\d{1,3}\.\d{4,}` AND
  presence-checked against canonical lat/long tuples extracted from
  message context (so we catch JSON `{"lat":..,"lng":..}` shape too).
- Street address: token model — number + street name token + suffix
  (St/Ave/Blvd/...). Conservative; favors false negatives.
- IP: IPv4 + IPv6 (excluding RFC1918 — those are infra, not PII).
- Plate: state-specific patterns; opt-in via class.
- CC/SSN: Luhn / SSA pattern; defensive only.

Each detector returns `[]Span{Start,End,Class,Score}`.

### D9.3 Replacer

`internal/ai/redact/replace.go`:

```go
type Policy struct {
    Allow []PIIClass            // explicit allow-list per Strategy
    Mode  Mode                  // RedactedTokens | RedactedTags | Truncate
}

type Mode int
const (
    ModeRedactedTokens Mode = iota // "[VIN]", "[EMAIL]"
    ModeRedactedTags                // "<vin id='1'/>" (round-trippable)
    ModeTruncate                    // drop class entirely
)

// Apply runs detectors over text, removes/replaces classes NOT in Allow.
// Returns (cleanText, manifest) where manifest maps token IDs back to
// originals so Strategy can stitch the LLM's response back to user-visible
// values (round-trip).
func Apply(text string, p Policy) (cleanText string, m Manifest)
```

`Manifest` lives only in-process; never persisted, never sent to provider.

### D9.4 Redaction decorator

`internal/ai/provider/redact_decorator.go`:

```go
// Wraps every Provider call. Pulls Policy from ctx (set by dispatcher
// from Strategy.RedactionPolicy()). For local/loopback providers the
// decorator is bypassed (configurable; default ON for cloud,
// configurable for local with safe default ON).
func RedactDecorator(get func(ctx context.Context) Policy) Decorator
```

### D9.5 Strategy hook

```go
type Strategy interface {
    // ... existing ...
    RedactionPolicy() redact.Policy
}
```

Defaults: `Allow: []` (everything redacted), `Mode: RedactedTags` (round-trippable).

Common per-feature policies live in `internal/ai/redact/policies.go`:
- `PolicyChatbot` allows nothing — bot must use round-trip tokens.
- `PolicyDigest` allows `ClassVehicleName` (digest names the car).
- `PolicyAlertBuilder` allows nothing — IDs flow via tools, not text.

### D9.6 Round-trip helper

`internal/ai/redact/roundtrip.go`:

```go
// Restore replaces "<vin id='1'/>" tokens in LLM output with the
// original VIN values from manifest. Used by Strategies whose answers
// will be shown to the same user the data came from.
func Restore(text string, m Manifest) string
```

### D9.7 Redaction-bypass audit

The redact decorator records `redacted_classes` and `bypass=false|true`
on every call into `ai_call_log` (extend F3 schema with two columns).
A daily report flags any feature whose >0% of calls bypass redaction
unexpectedly.

## Tasks

1. Detectors + tests with curated fixtures (each class).
2. Replacer + manifest + round-trip + tests.
3. Decorator + tests with mock provider.
4. Strategy hook wiring through dispatcher (set ctx value).
5. Extend F3 schema:
   `ALTER TABLE ai_call_log ADD COLUMN redacted_classes TEXT[] NOT NULL DEFAULT '{}', ADD COLUMN redaction_bypass BOOL NOT NULL DEFAULT false;`
6. Bypass report query + admin endpoint.
7. Migration `000202_ai_call_log_redaction.up.sql`.

## Allowed files

- `internal/ai/redact/**`
- `internal/ai/provider/redact_decorator.go` (+ test)
- `internal/ai/dispatch/dispatch.go` (set ctx value)
- `migrations/000202_*.up.sql`, `.down.sql`
- `internal/database/ai_call_log_repo.go` (extend)
- `internal/api/ai_admin_handler.go` (bypass report)

## Verification

```
go test -race ./internal/ai/redact/... ./internal/ai/provider/...
goose up
# Manual smoke:
# - Send a chat with VIN/email in message → ai_call_log row should
#   show redacted_classes={vin,email}, request to provider should
#   contain tokens, not originals.
```

## Deliverable

Log + ADR-015 footer.

## Forward dependency

Every Strategy must define `RedactionPolicy()`; default empty allow
list inherits from base struct.

