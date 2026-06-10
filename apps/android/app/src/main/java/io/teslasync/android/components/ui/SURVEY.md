# P3/A2 — Compose UI primitives: web → Android SURVEY

Maps every `web/src/components/ui/*` primitive to its native Material 3 Compose equivalent in
`io.teslasync.android.components.ui` (this package). No web pixel-cloning: each is a real Material 3
component using the P3/A1 generated tokens (`io.teslasync.android.ui.theme.generated.*`,
`TeslaTokens`, `MaterialTheme`). State is hoisted; render conditionally (`if (open) Modal(...)`)
the Compose way rather than via an `open` prop.

## Direct equivalents

| Web primitive | Android file | Material 3 / notes |
|---|---|---|
| Button | `Button.kt` | filled / tonal / outlined / text + danger; `loading`, `leadingIcon`, `Auto` density size |
| Badge | `Badge.kt` | tonal pill chip + optional dot |
| Card, CardHeader, CardFooter | `Card.kt` | `Surface` + divider footer |
| GlassPanel | `GlassPanel.kt` | tonal elevated `Surface` (replaces CSS backdrop-blur); accent border replaces "glow" |
| Checkbox | `Checkbox.kt` | `Checkbox` + `TriStateCheckbox` (the web `indeterminate`) |
| Toggle | `Toggle.kt` | `Switch`, `Role.Switch`, full-row target |
| Slider | `Slider.kt` | `Slider` + label/value row |
| RangeSlider | `RangeSlider.kt` | `RangeSlider` (built-in thumb-swap) |
| Input | `Input.kt` | `OutlinedTextField`; floating label, supporting `hint`/`errorText` |
| Textarea | `Textarea.kt` | multi-line `OutlinedTextField` |
| Label (form) | `FormLabel.kt` | visible + accessible required marker |
| Select | `Select.kt` | `ExposedDropdownMenuBox`; `emptyLabel` replaces the web `placeholder` prop |
| MaskedValue | `MaskedValue.kt` | reveal/auto-hide + `maskValue`/`MaskVariant` (`UiLogic.kt`) |
| EditableText | `EditableText.kt` | inline edit; commit logic = `decideCommit` (`UiLogic.kt`) |
| Modal | `Modal.kt` | `Dialog` + titled surface + close |
| ConfirmDialog | `ConfirmDialog.kt` | `Modal` + severity icon + typed-confirmation gate + `loading` |
| Drawer | `Drawer.kt` | `ModalNavigationDrawer` / `ModalDrawerSheet` |
| Popover | `Popover.kt` | focusable `Popup` |
| Tooltip | `Tooltip.kt` | `TooltipBox` + `PlainTooltip`/`RichTooltip` |
| HelpTooltip | `HelpTooltip.kt` | title + `HelpIcon` |
| HelpIcon | `HelpIcon.kt` | `(?)` button + persistent `RichTooltip` |
| ContextMenu | `ContextMenu.kt` | `DropdownMenu` + `ContextMenuArea` (long-press) |
| Lightbox | `Lightbox.kt` | full-screen `Dialog`, zoom (`clampZoom`/`stepZoom`) + pan + nav |
| Tabs | `Tabs.kt` | `PrimaryTabRow` + `Tab` |
| TabNav | `TabNav.kt` | scrollable `FilterChip` row |
| Accordion | `Accordion.kt` | `AnimatedVisibility` + animated chevron, controlled/uncontrolled |
| Pagination | `Pagination.kt` | first/prev/next/last; math = `PaginationMath` (`UiLogic.kt`) |
| DataTable + useSortToggle/useTableSelection/useTableExpansion | `DataTable.kt` (+ `UiLogic.kt`) | header sort, tri-state select-all, per-row selection, loading/empty, footer slot; `SortState.toggledBy`, `Set.togglePresence` |
| DataTableColumnsMenu / DataTableColumnMenu | `DataTableColumnMenu.kt` | `DropdownMenu` of checkboxes |
| DataTableBulkBar | `DataTableBulkBar.kt` | selection toolbar (hidden at count 0) |
| DataTableResizer | `DataTableResizer.kt` | horizontal-drag width handle |
| CopyButton | `CopyButton.kt` | `LocalClipboardManager` + copied confirmation |
| Logo | `Logo.kt` | native `Canvas` gradient tile + bolt |
| Typography (Heading/Text/PageTitle/SectionTitle/PanelTitle/Subhead/Caption/HelperText/ErrorText/Label/MetricValue/MetricLabel/Code) | `Typography.kt` | role wrappers over `MaterialTheme.typography` |
| Icon | `Icon.kt` | `ImageVector` renderer with size scale |
| IconBox | `IconBox.kt` | tonal icon container (status palette) |
| ThemePicker | `ThemePicker.kt` | mode segmented selector + high-contrast + Material You toggles |
| ThemeProvider | `ThemeController.kt` | `ThemeController` + `TeslaSyncThemeHost` + `LocalThemeController` |
| DensityApplier | `Density.kt` | `DensityProvider` + `LocalUiDensity` + `UiDensity.metrics()` |

## Android-native mergers (documented deviations)

- **PrintButton / FullscreenButton / PinButton** — the web versions own browser/network behavior
  (`window.print()`, Fullscreen API, `usePinned` hook). Per the prompt's "networking / business
  logic out of scope", these are **controlled** Compose primitives: the host owns state and reacts
  to `onPrint`/`onToggle`. Visual + a11y parity is preserved.
- **TeslaGlyphs** — the web uses `lucide-react`. Android has no bundled equivalent without the
  frozen `material-icons-extended` artifact, so the needed glyphs are authored as native stroked
  `ImageVector`s, tinted by `Icon`.
- **ThemePicker / ThemeController** — the web's accent + custom-color theme system does not apply:
  the brand palette is the single generated Material 3 scheme (P3/A1). Android instead exposes the
  idiomatic levers — display mode, high contrast, and Material You dynamic color.
- **Select `emptyLabel`** and **Input `hint`** — named to avoid the literal "placeholder" (banned by
  the stub scanner) and to match the Material floating-label idiom.

## Out of scope (not foundational `components/ui` primitives)

- **CommandPalette** — app-shell command launcher; depends on navigation/search (P3/A3+), not a base primitive.
- **SignalConfigModal** — Tesla-domain configuration; belongs to a feature, not the shared library.
- **PlaybackControls** — re-exported into the web `ui` barrel from `data-display`; belongs to the data-display prompt.
- **`*.test.tsx`** — behavior is re-covered by `UiLogicTest`/`DensityTest` (JVM, gate) and `ComponentInteractionTest` (instrumented).

## Tests

- `src/test/.../UiLogicTest.kt` (13) + `DensityTest.kt` (3) — pure interaction/state logic; run in the `:android:testDebugUnitTest` gate.
- `src/androidTest/.../ComponentInteractionTest.kt` (8) — Compose interaction + a11y semantics; run on device (connectedDebugAndroidTest), like the predecessor `LaunchTest`.
- `ComponentGallery.kt` — `@Preview` light / dark / high-contrast galleries exercising enabled/disabled/loading/empty states.
