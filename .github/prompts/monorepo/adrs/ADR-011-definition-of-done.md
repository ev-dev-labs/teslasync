# ADR-011 — Definition of Done: "no stub / no skeleton / polished" made checkable

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The mandate forbids stubs, skeleton pages, placeholder screens, and lazy work. The
db-refactor proved agents *will* stub unless "done" is mechanically defined. We need a
DoD that a gate can verify, not a subjective "looks finished."

## Decision

A UI prompt is **DONE** only when ALL hold (verified in `=== PARITY ===` + `=== GATE ===`):

1. **100% manifest coverage** — every panel, chart, map, metric, and string in the
   prompt's parity-manifest unit is implemented with real data binding (ADR-006).
2. **All three data states** per data source — loading (native progress/shimmer), empty
   (native EmptyState), error (native error + retry). No blank panels.
3. **No forbidden placeholders** — a lint/grep gate rejects: `TODO`, `FIXME`,
   `NotImplementedException`, `TODO()`, `fatalError("unimpl")`, `// Coming soon`,
   `Text("Placeholder")`, empty `Box {}`/`EmptyView()` used as a panel body, and
   commented-out panels.
4. **Localized** — zero hardcoded user-facing strings (ADR-014).
5. **Accessible** — meets the per-platform a11y baseline (ADR-015).
6. **Polish gate green** — strict linter/formatter + analyzer pass (ADR-010).
7. **Native components only** — uses platform/shared design-system components, no ad-hoc
   one-offs where a system/shared component exists (mirrors the web "no raw HTML" rule).

A program (P2/P3/P4) is DONE only when its parity ledger is 100% and all platform gates
are green on `main`.

## Consequences

- ✅ "Polished, no stubs" is enforced by data + lint, not opinion.
- ✅ Reviewers and the runner can fail a prompt objectively.
- ⚠️ The placeholder-grep gate needs a curated, per-language pattern list (authored in P0,
  refined per platform). False positives are resolved by implementing, not by suppressing.

## Alternatives rejected

- **Trust-the-agent DoD:** the exact failure db-refactor encountered.
