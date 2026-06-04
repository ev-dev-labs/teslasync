---
description: "P1/S3 — Kotlin Multiplatform shared-core project setup (Android + Apple)"
---

# P1 · S3 · 0001 — KMP shared-core project scaffold

> **Severity:** Foundation (blocks Android + Apple) · **Delegation:** FORBIDDEN
> The shared business-logic core consumed by Android (as a Gradle module) and Apple
> (as `shared.xcframework`). Windows does NOT consume this — it uses a generated C# client
> kept in lockstep via golden vectors (ADR-004, P1/S5).

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/` (KMP Gradle project) |
| Allowed files | `apps/shared/core/**`, `apps/shared/settings.gradle.kts`, version-catalog entry, the log file |
| Depends on | P0/0003 (version lock), P0/0001 (apps skeleton), P1/S1 (OpenAPI contract emitted) |
| Blocks | every Android (P3) + Apple (P4) prompt; later S-phases (net/SSE/units/auth/cache/presentation) |
| ADR refs | ADR-004, ADR-012 |
| Log | `../logs/p1-s3-0001-kmp-scaffold.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Stand up a buildable, testable KMP project with the agreed targets and source-set layout,
pinned to the locked toolchain — and NOTHING else (no models/net yet; those are later S-phases).
This is the spine, not a stub: it must compile and run an empty test suite green on all targets.

## Spec

**Targets:** `androidTarget()`, `iosArm64()`, `iosSimulatorArm64()`, `macosArm64()`
(+ `iosX64`/`macosX64` only if CI requires). Produce an XCFramework artifact for Apple
(`baseName = "Shared"`, static).

**Source sets:** `commonMain`/`commonTest`; `androidMain`; `appleMain` (shared by ios+macos)
with `iosMain`/`macosMain` leaves as needed. No platform leakage into `commonMain`.

**Versions:** pull EXACTLY from `apps/shared/versions.lock` / the Gradle version catalog
(Kotlin 2.2.x, etc. — P0/0003). Do not float versions. Kotlin `explicitApi()` ON.

**Dependencies (declared, not yet used):** kotlinx-coroutines, kotlinx-serialization,
kotlinx-datetime, Ktor client (engines: OkHttp for android, Darwin for apple) — wired in the
catalog so later S-phases just consume them. No Android UI / no SwiftUI here.

**Quality:** ktlint (or detekt) configured and clean; `expect/actual` platform-logger seam only.

## Implementation steps

1. Create the Gradle project + `build.gradle.kts` with the KMP plugin + targets above.
2. Configure the XCFramework task + a `assembleSharedXCFramework` Gradle task.
3. Add source-set tree with a trivial `commonMain` `Platform` `expect`/`actual` (name string)
   and a `commonTest` asserting it's non-empty — proof the multiplatform wiring works.
4. Register the module in `settings.gradle.kts`; add ktlint/detekt; enable `explicitApi()`.
5. Run the gate on all targets.

## Gate

```powershell
Push-Location apps/shared/core
./gradlew :core:allTests 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :core:assembleSharedXCFramework 2>&1 | Tee-Object $log -Append; "XCF_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew ktlintCheck 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/shared/core -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TEST/XCF/LINT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] `allTests` green on android + ios + macos source sets.
- [ ] `assembleSharedXCFramework` produces `Shared.xcframework`.
- [ ] All versions resolve from the lock/catalog; no version drift; `explicitApi()` on.
- [ ] ktlint/detekt clean; placeholder gate clean; no business logic beyond the wiring proof.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Models, networking, SSE, units, auth, cache, presentation — each is its own later S-phase.
Do not pre-build them here.

## Commit

```powershell
git add apps/shared/core apps/shared/settings.gradle.kts .github/prompts/monorepo/logs/p1-s3-0001-kmp-scaffold.log
git commit -m "feat(apps/shared): scaffold KMP shared-core (android+apple targets, XCFramework) (P1/S3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
