---
adr: 015-amendment
title: AI Subsystem Restructure In-Scope for Phase R
status: AMENDMENT
date: 2026-05-28
deciders:
  - User mandate ("we need to cover whole app" + maximalist scope selection 2026-05-28)
  - Copilot CLI agent (Claude Opus 4.7 xhigh)
amends: ADR-015 (AI-Off Contract)
scope: Phase R only (the repo restructure phase)
---

# ADR-015 Amendment: AI Subsystem Restructure In-Scope for Phase R

## Context

ADR-015 (AI-Off Contract; referenced at
`.github/ARCHITECTURE.md` ADR-010 §"OUT OF SCOPE",
`.github/workflows/ai-eval.yml`, `cmd/ai-eval/main.go`,
`internal/models/system.go`) carves the AI subsystem out of the
ongoing repo reorganization work. This carve-out was framed
broadly enough to also exclude file-move-only restructures of AI
support code.

User mandate on 2026-05-28 explicitly expanded the
repo-reorganization scope to "cover whole app" and selected the
MAXIMALIST scope option for Phase R via interactive form, which
includes the AI subsystem under
`ai_subsystem_policy=override`. The user's exact form
selection:

> `backend_scope` = internal/api, internal/database,
> internal/handler/v1, internal/models, internal/jobs,
> **internal/ai/tools**, internal/ai/api_handlers
>
> `frontend_scope` = features/dashboard/widgets, api/hooks,
> hooks, lib, **components/ai**, components/feedback,
> components/data-display
>
> `ai_subsystem_policy` = **override**

## Decision

For Phase R ONLY (the bounded-context restructure phase), the
ADR-015 carve-out is LIFTED for the following file moves:

- `internal/ai/tools/*.go` (109 files) → split into per-AI-capability
  subpackages per ADR-011 (e.g. `internal/ai/tools/nl/`,
  `internal/ai/tools/alert/`, `internal/ai/tools/charge/`, etc.).
- `internal/api/ai_*.go` (121 files) → moved into
  `internal/api/ai/*` subpackages as part of R2d (AI/admin wave).
- `web/src/components/ai/*.tsx` (61 files) → split into
  per-AI-feature subdirs per ADR-011 frontend rules.

## In-scope of this amendment (PURE file-moves)

- Package declaration changes (`package tools` →
  `package nl`, `package alert`, etc.)
- Import path updates throughout the codebase
- `git mv` operations preserving file content byte-for-byte
- Composition root updates (registry / Mount calls) to compose
  the new subpackage structure

## NOT in scope of this amendment (still ADR-015 owned)

- AI feature flag enforcement (`withAiFeature` HOC + ESLint rule
  `teslasync/ai-component-must-be-wrapped`)
- AI off-by-default contract (boot-time AI mode default, runtime
  guard wrapping)
- Any change to AI runtime behavior, prompts, tool semantics,
  provider selection, judge/eval, sampling, cost guards
- Any change to `internal/ai/provider/*` (the PROVIDER subsystem;
  only `internal/ai/tools/*` and `internal/api/ai_*` are in
  scope)
- AI evaluation tooling (`cmd/ai-eval`, `cmd/aigen`,
  `cmd/aivet`)

## Mandatory Phase R gates for AI files

In addition to the standard per-cluster gates (build / vet /
lint / test / fmt / arch-check), R2d (the AI/admin wave) MUST
also pass these AI-specific gates after the move:

1. **AI guard wrapping preserved.** Every `/api/v1/ai/*` route
   mount goes through the sanctioned AI guard middleware. Verify
   via:
   ```powershell
   make ai-vet
   # AND grep verify:
   rg --type go 'r\.(Get|Post|Put|Delete|Patch).*"/ai/' internal/api/
   # every match must be inside a chi.Router scope that has the
   # AI guard middleware in its With() chain
   ```
2. **AI off-by-default still works.** Smoke test with
   `AI_MODE=off` (default): no AI route returns 200 for an
   unauthenticated AI prompt request; every AI route returns
   the documented "AI disabled" response shape.
3. **`make ai-vet` exit 0.** This pre-existing target validates
   tool registry, prompt registry, and guard wiring. It MUST
   pass after every R2d commit and after every
   `internal/ai/tools/*` cluster commit.
4. **ai-eval workflow PASS.** The `.github/workflows/ai-eval.yml`
   workflow must remain green; if any cluster commit breaks it,
   STOP and fix before the next cluster.

## Rollback

If the AI restructure portion is judged a regression:

- Each AI cluster commit is a discrete `git revert <sha>` away
  from being reverted independently of the rest of Phase R.
- AI runtime is gated by feature flags; even if the package
  structure has temporary issues, `AI_MODE=off` (default)
  prevents user-visible impact.

## Sunset

This amendment is SCOPED TO PHASE R. After R14 (Phase R
complete), the original ADR-015 contract resumes in full force:
no AI subsystem restructure is permitted without a new
amendment.

## References

- ADR-011: `docs/architecture/adr/011-bounded-context-subpackages.md`
- Repo reorganization plan (live):
  session `plan.md` §16 + §18
- Repo reorganization plan (committed):
  `docs/architecture/repo-reorganization-plan.md`
- Existing ADR-015 references:
  - `.github/ARCHITECTURE.md` (referenced from ADR-010)
  - `.github/workflows/ai-eval.yml`
  - `cmd/ai-eval/main.go`
  - `internal/models/system.go` (`AIMode` field)
