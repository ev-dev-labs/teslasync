---
description: "P3/A5 — Android data layer ViewModels consuming KMP StateFlow repositories"
---

# P3 · A5 · 0001 — Compose data layer and ViewModels

> **Severity:** Data foundation (blocks page parity) · **Delegation:** FORBIDDEN
> Bind Android UI to KMP shared state holders through lifecycle-aware Compose ViewModels and cache-then-network repositories per ADR-013.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` ViewModel bindings, repository adapters, UI state mappers |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P1 shared repositories/state holders/cache, P3/A2 components, P3/A3, P3/A4 |
| Blocks | all Android A7 page prompts |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a5-0001-data-layer-viewmodels.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create the Android-side data binding layer that turns shared-core `StateFlow` state holders into lifecycle-aware Compose screen state without duplicating networking/business logic.

## Spec

- Use AndroidX Lifecycle ViewModels with `viewModelScope`, `collectAsStateWithLifecycle`, `stateIn`, and immutable UI state models.
- Consume KMP shared repositories/state holders directly; Android module must not call `/api/v1` or own business repositories except thin platform adapters.
- Expose cache-then-network states from ADR-013: cached data immediately, refresh in progress, freshness timestamp, stale/offline labels, error with retry, empty.
- Provide common base patterns/utilities for page ViewModels: selected vehicle, refresh, pagination, filters, one-shot events, command confirmations, and redacted logging.
- Map shared SI values to display-ready state at the UI boundary using shared unit/format state; never store non-SI.

## Implementation steps

1. Survey shared-core state holders and web hook groups, then log Android ViewModel mapping by domain.
2. Implement ViewModel factories/DI entry points and lifecycle collection patterns.
3. Implement common UI state wrappers for loading, cached, refreshing, empty, stale, error, and retry.
4. Add tests with fake shared `StateFlow`s for cache-then-network, refresh, stale/offline, selected-vehicle, and errors.
5. Run the gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] Android ViewModels consume KMP `StateFlow` state holders and expose immutable Compose UI state.
- [ ] No Android page/component performs direct network calls or owns business logic.
- [ ] Cache-then-network, freshness, stale/offline, empty, loading, error, and retry states are tested.
- [ ] SI display boundary is respected; no legacy unit storage.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Individual page layouts, shared-core repository implementation, auth provider internals, SSE/push binding, widgets.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a5-0001-data-layer-viewmodels.log
git commit -m "feat(apps/android): bind KMP state holders to Compose ViewModels (P3/A5)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
