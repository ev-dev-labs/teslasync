# ADR-015 — Accessibility baseline per platform (WCAG + native APIs)

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

"Modern polished app" includes accessibility. Each OS has a first-class a11y stack and
store-review expectations. A consistent baseline must be defined and gated.

## Decision

Baseline target: **WCAG 2.2 AA** semantics realized through **native** a11y APIs:

| Concern | Windows (Fluent) | Android (Compose) | Apple (SwiftUI) |
|---|---|---|---|
| Labels/roles | AutomationProperties | `semantics { }` / contentDescription | `.accessibilityLabel`/traits |
| Screen reader | Narrator | TalkBack | VoiceOver |
| Focus order | XAML tab/focus | focus order modifiers | focus order |
| Contrast | Fluent high-contrast themes | M3 contrast + dynamic | Increase Contrast |
| Dynamic text | scaling | font scale | **Dynamic Type** |
| Motion | honor "reduce motion" | honor animator scale | honor Reduce Motion |
| Hit targets | ≥ platform min | ≥48dp | ≥44pt |

Every parity unit's prompt includes a11y requirements (labels for charts/maps, state
announcements for loading/empty/error). Charts expose an accessible data summary/table
alternative. The platform a11y analyzer/lint runs in the gate where available.

## Consequences

- ✅ Inclusive, store-compliant apps; consistent baseline across platforms.
- ✅ Charts/maps (the hardest a11y cases) get explicit accessible alternatives.
- ⚠️ Adds per-prompt a11y checklist items; automated a11y testing is partial — manual
  VoiceOver/TalkBack/Narrator passes scheduled in P5.
- ⚠️ Dynamic Type / font scaling must not break dense telemetry layouts; prompts specify
  scalable layouts, not fixed pixel grids.

## Alternatives rejected

- **A11y as a P5 afterthought only:** retrofitting is costlier and misses per-screen semantics.
