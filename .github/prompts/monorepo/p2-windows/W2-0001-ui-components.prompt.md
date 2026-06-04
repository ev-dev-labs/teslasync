---
description: "P2/W2-0001 — WinUI Fluent UI primitives"
---

# P2 · W2-0001 — Fluent UI component primitives

> **Severity:** Foundational component library · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Components/UI/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE |
| Blocks | W2-0002..W2-0005, W3 shell, W7 pages |
| ADR refs | ADR-002, ADR-005, ADR-011, ADR-012, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; web source `web/src/components/ui/` |
| Log | `../logs/p2-w2-0001-ui-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement complete Fluent/WinUI equivalents for the shared web `ui` component category so pages consume a native, tokenized component library instead of ad-hoc controls.

## Spec

Implement these concrete components in `Components/UI` with XAML/C# APIs, MVVM-friendly dependency properties, tokenized styling, loading/disabled/focus states, Narrator labels, and no hardcoded user-facing strings:
- `TsButton` wrapping WinUI `Button`/`HyperlinkButton` patterns with primary, secondary, subtle, destructive, icon, loading, and split/action variants.
- `TsBadge` / `TsStatusPill` with semantic status resources and high-contrast fallbacks.
- `TsCard`, `TsCardHeader`, `TsCardFooter` using Fluent `Card`-style surfaces and tokenized corner/elevation.
- `TsInput`, `TsTextarea`, `TsCheckbox`, `TsToggle`, `TsSlider`, `TsRangeSlider` using WinUI input controls with validation states.
- `TsModal` and `TsConfirmDialog` using `ContentDialog` with safe focus restore.
- `TsPopover`, `TsDrawer`, `TsTooltip`, `TsHelpTooltip`, `TsContextMenu` using WinUI flyouts/teaching tips/menu flyouts.
- `TsSelect`, `TsTabs`, `TsTabNav`, `TsAccordion`, `TsPagination` using `ComboBox`, `TabView`/`NavigationView`-appropriate patterns.
- `TsGlassPanel` mapping web `GlassPanel` to Mica/Acrylic/Card materials from W1 tokens.
- `TsDataTable`, column chooser, bulk bar, row expansion, keyboard sorting, selection, resizing, and pagination using WinUI `DataGrid`/CommunityToolkit controls pinned by `apps/versions.lock.md`.
- `TsCommandPalette`, `TsThemePicker`, `TsCopyButton`, `TsMaskedValue`, `TsEditableText`, `TsPrintButton`, `TsFullscreenButton`, `TsLightbox`, typography primitives (`Heading`, `Text`, `PageTitle`, `SectionTitle`, `PanelTitle`, `Caption`, etc.).

## Implementation steps

1. Log preflight and verify W0/W1 DONE.
2. Survey `web/src/components/ui/index.ts` and existing Windows component folders.
3. Create one exported component class/control per primitive; shared styling belongs in ResourceDictionaries under `apps/windows/**`.
4. Use CommunityToolkit.Mvvm for command binding; no business logic in code-behind beyond control behavior.
5. Add component samples/tests proving visual states: default, hover, pressed, disabled, focused, validation error, high contrast.
6. Ensure every component exposes AutomationProperties and keyboard navigation.
7. Log component inventory and run the full gate.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w2-0001-ui-components.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('TsButton','TsBadge','TsCard','TsInput','TsModal','TsSelect','TsTabs','TsGlassPanel','TsToggle','TsTooltip','TsDataTable','TsTextarea','TsCommandPalette','TsThemePicker')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_UI_COMPONENTS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Every listed `ui` component exists as a native WinUI/Fluent component.
- [ ] Components use W1 tokens and system high-contrast resources; no web pixel-cloning.
- [ ] DataTable supports sorting, selection, expansion, pagination, resizing, and keyboard use.
- [ ] All components have loading/disabled/focus/error states where applicable.
- [ ] Build, format, test, placeholder, and component-inventory gates are green.

## Out of Scope

- No charts, maps, data-display, feedback, or page implementations.
- No direct web/React imports or WebView rendering.
- No generated W7 page edits.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w2-0001-ui-components.log
git commit -m "feat(apps/windows): add Fluent UI primitives (P2/W2-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
