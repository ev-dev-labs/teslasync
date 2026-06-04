---
description: "P3/A0 — Android (Jetpack Compose / Material 3) app project scaffold"
---

# P3 · A0 · 0001 — Android app project scaffold

> **Severity:** Foundation (blocks all Android pages) · **Delegation:** FORBIDDEN
> The native Android app shell: a Compose / Material 3 project consuming the KMP shared
> core (P1/S3) as a Gradle module. No UI parity work here — just a buildable, testable app
> that launches to an empty themed scaffold.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/` (Gradle app module) |
| Allowed files | `apps/android/**`, `apps/settings.gradle.kts` Android include, version-catalog entry, the log file |
| Depends on | P0/0003 (version lock), P0/0001 (apps skeleton), P1/S3 (KMP core builds) |
| Blocks | every Android page (P3/A7) + A2..A6 phases |
| ADR refs | ADR-002, ADR-004, ADR-012 |
| Log | `../logs/p3-a0-0001-android-scaffold.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Stand up a buildable, testable, single-Activity Compose app pinned to the locked toolchain,
depending on `:core`, launching to a Material 3 themed empty `Scaffold` (no parity content).
The spine, not a stub: it compiles, installs, and passes an empty instrumented + unit suite.

## Spec

- **Stack (from version lock, P0/0003):** AGP + Kotlin 2.2.x, Compose BOM + Compose Compiler,
  Material 3 (incl. expressive where available), `minSdk`/`targetSdk` per the lock. Single
  `MainActivity` with `enableEdgeToEdge()` + `setContent`.
- **Module wiring:** `implementation(project(":core"))`; verify a value from `:core`'s
  `Platform` seam renders in a test (proves shared-core consumption end to end).
- **Theme:** apply `apps/design/generated/android/Theme.kt` tokens (P2/Android) — dynamic color
  opt-in, light/dark, typography from tokens. No hardcoded colors.
- **Quality:** ktlint/detekt clean; `lint` (Android) clean; one Compose preview + one
  instrumented test that launches the Activity.

## Implementation steps

1. Create the Gradle app module + `build.gradle.kts` (Compose enabled, `:core` dep).
2. `MainActivity` + `App()` composable → themed empty `Scaffold` with a top app bar shell.
3. Wire the generated theme tokens; confirm dark/light switch.
4. Add an instrumented launch test + a unit test asserting `:core` is reachable.
5. Run the gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if UNIT/ASM/LINT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] App assembles + installs; launch test green; `:core` value reachable in a test.
- [ ] Material 3 theme from generated tokens; dark/light + dynamic color verified.
- [ ] All versions from the lock/catalog; ktlint/detekt + Android lint clean; placeholder gate clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Navigation, auth, live data, and any page — each is its own later A-phase prompt.

## Commit

```powershell
git add apps/android apps/settings.gradle.kts .github/prompts/monorepo/logs/p3-a0-0001-android-scaffold.log
git commit -m "feat(apps/android): scaffold Compose/Material3 app consuming KMP core (P3/A0)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
