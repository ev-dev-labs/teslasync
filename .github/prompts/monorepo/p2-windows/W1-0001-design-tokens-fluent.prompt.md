---
description: "P2/W1-0001 — Windows design tokens to Fluent ResourceDictionaries"
---

# P2 · W1-0001 — Design tokens to Fluent theme resources

> **Severity:** Foundational design system · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/design/generated/windows/Tokens.xaml`, `apps/windows/TeslaSync.App/Themes/*.xaml` |
| Allowed files | `apps/windows/**`, `apps/design/generated/windows/**`, the log file |
| Depends on | W0-0001 DONE; `apps/design/tokens.json` frozen by P1 design system |
| Blocks | W2 component prompts, W3 shell, all W7 page prompts |
| ADR refs | ADR-002, ADR-005, ADR-011, ADR-012, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; `.github/instructions/prompt-engineering.instructions.md` |
| Log | `../logs/p2-w1-0001-design-tokens-fluent.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Generate and wire complete Fluent/WinUI theme ResourceDictionaries from `apps/design/tokens.json` so every Windows component can consume typed theme brushes, typography, chart colors, spacing, radius, elevation, and motion tokens without hardcoded values.

## Spec

- Read `apps/design/tokens.json`; do not hand-copy partial token sets.
- Generate `Tokens.xaml` under `apps/design/generated/windows/` with Windows theme resources for colors, typography, spacing, radii, elevation/material, motion durations/easings, semantic status colors, and the brand chart palette.
- Wire `Light`, `Dark`, and `HighContrast` dictionaries in `apps/windows/TeslaSync.App/Themes/` and merge them from `App.xaml` using WinUI `ResourceDictionary.ThemeDictionaries`.
- Map web glass tokens to Fluent materials: Mica for app/root surfaces, Acrylic for elevated transient panels, `ThemeShadow`/`Elevation` resources for depth. No hand-rolled blur/glass hacks.
- Use WinUI/Fluent resource types (`SolidColorBrush`, `FontFamily`, `x:Double`, `Thickness`, `CornerRadius`, `Duration`) with deterministic names (`TsColorAccentBrush`, `TsChart01Brush`, `TsTypeBodyFontSize`, etc.).
- Preserve OS accent/high-contrast behavior; do not force brand colors where Windows high-contrast system brushes must win.
- Add a small verification view/resource test under `apps/windows/**` that resolves representative tokens in light/dark/high-contrast.

## Implementation steps

1. Log `=== PREFLIGHT ===`; verify W0 log has `STATUS=DONE`, tree is clean except allowed files, and echo `dotnet --info`.
2. Log `=== SURVEY ===`; inspect `apps/design/tokens.json`, existing `App.xaml`, and Windows version pins.
3. Implement a deterministic token generator or generation target inside `apps/windows/**` and emit `apps/design/generated/windows/Tokens.xaml`.
4. Add light/dark/high-contrast ResourceDictionaries and merge them into the WinUI app.
5. Replace any newly introduced hardcoded app-level colors/typography with token resource references.
6. Log `=== CHANGES ===` with changed files and token category counts.
7. Run the gate; if Windows/.NET runner is missing, write STATUS=BLOCKED and commit only the log.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w1-0001-design-tokens-fluent.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$tokenText = Get-Content apps/design/generated/windows/Tokens.xaml -Raw
$required = @('TsChart01Brush','TsTypeBodyFontSize','HighContrast','Dark','Light','Mica','Acrylic')
$missing = @($required | Where-Object { $tokenText -notmatch [regex]::Escape($_) })
"MISSING_TOKEN_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] `Tokens.xaml` is generated from `apps/design/tokens.json`, not manually drifted.
- [ ] Light, dark, and high-contrast resources resolve in WinUI.
- [ ] Colors, typography, spacing, radii, material/elevation, motion, statuses, and chart palette are present.
- [ ] No hardcoded app-level colors/typography are introduced where a token exists.
- [ ] Build, format, placeholder, and token-marker gates are green.
- [ ] `EXIT=0` / `STATUS=DONE` (or BLOCKED only because no Windows/.NET runner exists).

## Out of Scope

- No component library implementation (W2).
- No navigation shell or pages.
- No changes outside `apps/windows/**` and generated Windows design artifacts.

## Commit

```powershell
git add apps/windows apps/design/generated/windows .github/prompts/monorepo/logs/p2-w1-0001-design-tokens-fluent.log
git commit -m "feat(apps/windows): generate Fluent design tokens (P2/W1-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
