---
description: "P3/A1 — Android Material 3 theme generated from design tokens"
---

# P3 · A1 · 0001 — Design tokens → Material 3 Theme.kt

> **Severity:** Foundation (blocks Android component library + pages) · **Delegation:** FORBIDDEN
> Generate the Android Material 3 theme from `apps/design/tokens.json`: light/dark ColorScheme, dynamic color opt-in, typography, shapes, spacing, elevations, motion, and chart/status palettes.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` theme package + `apps/design/generated/android/**` token artifacts |
| Allowed files | `apps/android/**`, `apps/design/generated/android/**`, the log file |
| Depends on | P0/0003 (version lock), P0 design-token source, P3/A0 |
| Blocks | P3/A2 component library, P3/A3 shell/nav, every Android page |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p3-a1-0001-design-tokens-theme.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Produce a complete, platform-native Material 3 theme layer for Android from the shared design tokens, with no hardcoded brand colors in app code and no placeholder token values.

## Spec

- Read `apps/design/tokens.json` and generate Kotlin artifacts under `apps/design/generated/android/**` plus app-facing theme wrappers under `apps/android/**`.
- Implement `Theme.kt` using Material 3 `ColorScheme` for light and dark themes, `dynamicLightColorScheme` / `dynamicDarkColorScheme` opt-in on Android 12+, and TeslaSync brand fallback schemes from tokens.
- Implement `Typography` from token type ramp using Material 3 text styles; keep font-scale compatibility and avoid fixed-size telemetry layouts.
- Implement `Shapes`, spacing, elevation, motion-duration/easing, semantic status colors, and chart palette token accessors.
- Provide preview/demo composables that prove light, dark, dynamic-color disabled, and high-contrast-friendly variants.
- Ensure every value is generated or derived from tokens; do not float library versions outside the version lock.

## Implementation steps

1. Verify predecessor logs show STATUS=DONE and the tree is clean except allowed files.
2. Implement or update the token generation task for Android outputs.
3. Wire `TeslaSyncTheme` to choose dynamic color only when user/system setting enables it; default to token brand colors.
4. Add unit tests covering token parsing, light/dark role completeness, typography/shape mapping, and chart/status palette exposure.
5. Run the gate and record SURVEY/REASONING/CHANGES/GATE/COMMIT in the log.

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

- [ ] `TeslaSyncTheme` exposes complete Material 3 light/dark schemes and optional dynamic color fallback behavior.
- [ ] Typography, shapes, spacing, elevation, motion, status, and chart tokens come from generated Android artifacts.
- [ ] No hardcoded brand colors/typography in theme consumers; no placeholder token values.
- [ ] Unit tests, assemble, lint, detekt/ktlint, and placeholder gate are green.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Components, navigation, auth, data repositories, live data, pages, widgets, and release packaging.

## Commit

```powershell
git add apps/android apps/design/generated/android .github/prompts/monorepo/logs/p3-a1-0001-design-tokens-theme.log
git commit -m "feat(apps/android): generate Material3 theme from design tokens (P3/A1)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
