---
description: "P4/P3 — Apple SwiftUI ui component library"
---

# P4 · P3 · 0001 — SwiftUI UI component library

> **Severity:** Foundation (blocks Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement the SwiftUI equivalents of the web `components/ui` category using HIG-native
> controls, generated tokens, materials, accessibility, and adaptive macOS+iOS behavior.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Components/UI/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P1-0001 shared facade, P4/P2-0001 design tokens |
| Blocks | P4/P3-0002..0005, P4/P4 app shell, every Apple page |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-014, ADR-015 |
| Log | `../logs/p4-p3-0001-ui-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create a complete reusable SwiftUI UI component library mirroring web `components/ui` with
native Apple controls and no app-code one-offs.

## Spec

Implement concrete components, previews, tests, and accessibility for:

- **Controls:** `TSButton`, `TSBadge`, `TSCard`, `TSCardHeader`, `TSCardFooter`, `TSCheckbox`,
  `TSTextField`, `TSSecureField`, `TSTextArea`, `TSSelect`, `TSPickerMenu`, `TSTabs`, `TSToggle`,
  `TSSlider`, `TSRangeSlider`, `TSStepper`, `TSDatePickerBridge`.
- **Surfaces:** `TSGlassPanel` using `.regularMaterial`, `TSStatusPill`, `TSIconBox`, `TSDrawer`,
  `TSModal`, `TSPopover`, `TSTooltip`, `TSHelpTooltip`, `TSAccordion`, `TSPagination`.
- **Data primitives:** `TSDataTable` with sort, selection, expansion, density, column menu,
  bulk bar, resizing; `TSContextMenu`, `TSCommandPalette`.
- **Utility:** `TSThemePicker`, `TSCopyButton`, `TSMaskedValue`, `TSEditableText`, `TSPrintButton`,
  `TSFullscreenButton`, `TSLightbox`, `TSLogo`.
- **Typography:** `TSHeading`, `TSText`, `TSPageTitle`, `TSSectionTitle`, `TSPanelTitle`,
  `TSSubhead`, `TSCaption`, `TSHelperText`, `TSErrorText`, `TSLabel`, `TSMetricValue`,
  `TSMetricLabel`, `TSCode`.
- **Platform behavior:** keyboard navigation and menus on macOS/iPad; 44pt hit targets and
  compact layouts on iPhone; no hardcoded user-facing strings.

## Implementation steps

1. Survey `web/src/components/ui/index.ts` and map each export to a SwiftUI component or documented
   native primitive in the log.
2. Implement components under `Components/UI`, using generated tokens and native controls/materials.
3. Add SwiftUI previews for light/dark, Dynamic Type, compact/regular width, and macOS/iOS idioms.
4. Add XCTest coverage for state, actions, formatting/accessibility labels, and DataTable sorting/selection.
5. Run the full Apple gate on iOS Simulator and macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] Every `components/ui` export listed above has a native SwiftUI equivalent or explicit wrapper.
- [ ] `TSGlassPanel` uses native materials; controls honor tokens, Dynamic Type, keyboard, pointer, VoiceOver.
- [ ] DataTable/CommandPalette/ContextMenu are real functional components, not visual shells.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Charts, maps, data-display, feedback/forms, page implementations, and navigation wiring.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p3-0001-ui-components.log
git commit -m "feat(apps/apple): add SwiftUI UI component library (P4/P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
