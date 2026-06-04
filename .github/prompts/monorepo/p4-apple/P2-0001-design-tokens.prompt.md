---
description: "P4/P2 — Apple design tokens generated as Tokens.swift"
---

# P4 · P2 · 0001 — Design tokens to Tokens.swift

> **Severity:** Foundation (blocks Apple component library) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Generate and apply SwiftUI/HIG-native tokens from `apps/design/tokens.json`:
> colors, typography, materials, spacing, radii, motion, and chart palette.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/design/generated/apple/Tokens.swift`, `apps/apple/TeslaSync/Design/` |
| Allowed files | `apps/apple/**`, `apps/design/generated/apple/**`, the log file |
| Depends on | P4/P0-0001, design token source in `apps/design/tokens.json` |
| Blocks | P4/P3 component library, P4/P4 app shell, all Apple pages |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-014, ADR-015 |
| Log | `../logs/p4-p2-0001-design-tokens.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Produce a complete `Tokens.swift` and Apple design layer that maps TeslaSync brand tokens to
native SwiftUI/HIG primitives while honoring light/dark appearances, Dynamic Type, accessibility
contrast, and the brand chart palette.

## Spec

- **Source of truth:** parse `apps/design/tokens.json`; do not hand-copy values into app code.
- **Color roles:** generate semantic SwiftUI `Color` roles for background, surface, text,
  accent, status, battery/charging/driving, borders, separators, and chart series.
- **Light/dark:** generated colors adapt through asset catalog or dynamic providers; verify both.
- **Typography:** map token scale to SF Dynamic Type styles (`Font`, `UIFont/NSFont` helpers),
  preserving hierarchy for PageTitle, SectionTitle, Caption, MetricValue, Label, Code.
- **Materials:** map web glass/elevation tokens to Apple materials (`.regularMaterial`,
  `.thinMaterial`) plus safe overlays; no hand-rolled blur hacks.
- **Layout tokens:** spacing, radius, stroke widths, animation durations/easing, chart colors.
- **Docs/tests:** add token generation test or snapshot that fails on drift between JSON and Swift.

## Implementation steps

1. Inspect `apps/design/tokens.json` and existing Apple workspace token hooks.
2. Implement or wire a deterministic generator that writes `apps/design/generated/apple/Tokens.swift`.
3. Add Swift extensions/types (`TSColor`, `TSTypography`, `TSSpacing`, `TSRadius`, `TSMotion`,
   `TSChartPalette`, `TSMaterial`) consumed by SwiftUI.
4. Add tests for token presence, light/dark resolution, Dynamic Type text styles, and chart palette length.
5. Run the full Apple gate on iOS Simulator and macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple apps/design/generated/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] `Tokens.swift` is generated from `apps/design/tokens.json` and checked for drift.
- [ ] Color, Font, material, spacing, radius, motion, and chart palette tokens are complete.
- [ ] Light/dark, Dynamic Type, Increase Contrast, and Reduce Motion are honored.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Component implementations and page layout; this phase only provides the design substrate.

## Commit

```powershell
git add apps/apple apps/design/generated/apple .github/prompts/monorepo/logs/p4-p2-0001-design-tokens.log
git commit -m "feat(apps/apple): generate SwiftUI design tokens (P4/P2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
