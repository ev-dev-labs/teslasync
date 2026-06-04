---
description: "P3/A2 — Android Compose UI primitives mirroring web components/ui"
---

# P3 · A2 · 0001 — Compose UI component library

> **Severity:** Foundation UI (blocks page prompts) · **Delegation:** FORBIDDEN
> Build native Compose/Material 3 equivalents for the web `components/ui` category without web pixel-cloning or placeholder primitives.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/components/ui/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1 (theme tokens), P3/A0 |
| Blocks | P3/A2-0002..0005, P3/A3, every Android page |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p3-a2-0001-ui-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement the complete foundational Compose UI category that all Android pages will use instead of ad-hoc Material widgets.

## Spec

Implement real Material 3 components for every web UI primitive with native Android behavior:
- Surfaces/actions: `GlassPanel`→tonal `Surface`/`Card`, `Card`, `Button`, `CopyButton`, `PrintButton`, `FullscreenButton`, `PinButton`, `IconButton` wrappers, `Icon`, `IconBox`.
- Inputs: `Input`/`OutlinedTextField`, `Textarea`, `Checkbox`, `Toggle`/`Switch`, `Slider`, `RangeSlider`, `Select`/`ExposedDropdownMenuBox`, `MaskedValue`, `EditableText`.
- Overlays/navigation primitives: `Modal`/`AlertDialog`, `ConfirmDialog`, `Drawer`/`ModalNavigationDrawer`, `Popover`/`DropdownMenu`, `Tooltip`/`PlainTooltip`, `HelpTooltip`, `ContextMenu`, `Lightbox`, `Tabs`/`TabNav`.
- Data/table shell: `DataTable`, column menu/resizer, bulk bar, pagination controls, density applier, status pill, badge, label, typography wrappers.
- Branding and settings: `Logo`, `ThemePicker`, density/theme providers.
Every component must have loading/disabled/error where applicable, previews, accessibility semantics, 48dp touch targets, dark/light support, and tests.

## Implementation steps

1. Survey `web/src/components/ui` and enumerate each mapped component in the log.
2. Create stateless composables with stable parameters and Material 3 defaults from A1 tokens.
3. Implement interaction behavior for dialogs, menus, table sorting/selection/pagination, sliders, form fields, and copy/print/share helpers using Android APIs.
4. Add previews plus unit/Compose tests for enabled, disabled, error, loading, selection, and accessibility labels.
5. Run the gate and ensure no raw placeholders or TODOs remain.

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

- [ ] Every listed `components/ui` primitive has a native Compose equivalent or an explicitly implemented Android-native merger documented in SURVEY.
- [ ] Components use A1 tokens and Material 3 APIs, not hardcoded web CSS values.
- [ ] Compose tests cover core states and interactions; a11y semantics present.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Charts, maps, page implementations, business logic, networking, and auth.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a2-0001-ui-components.log
git commit -m "feat(apps/android): add Compose UI primitives (P3/A2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
