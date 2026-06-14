// The native Jetpack Compose + Material 3 ThemePicker shared surface — a parity port of
// web/src/components/ui/ThemePicker.tsx (over web/src/components/ui/ThemeProvider.tsx). The web source is a
// controlled picker reading `useTheme()`: a Display Mode selector (the seven modes, each previewed by its
// surface-colour strip + a tone glyph), an Accent Color selector (the five brand themes plus an optional
// custom tile), and — when the custom theme is active — a primary/accent colour builder; each pick calls the
// matching `setTheme`/`setMode`/`setCustomColors` and raises a `toast.info`. The `showMode`, `showCustom`,
// and `compact` props gate the sections and density.
//
// This surface is the native equivalent. All state flows through the shared [ThemePickerViewModel] over the
// [ThemePickerSource] seam (the surface-owned `ThemeProvider` analogue) — the view performs NO HTTP and no
// persistence (ADR-002). The faithful mapping of the web behaviour:
//   • `useTheme()`'s `themeId`/`modeId`/`themes`/`modes` → the folded [ThemePickerData] the ViewModel emits;
//   • `setTheme`/`setMode`/`setCustomColors` → the ViewModel picks routed through the store;
//   • `useToast().info(...)` → the host [LocalToastController] (the native `@/components/feedback/Toast`),
//     read optionally so the picker is safe to host before a toast host is wired;
//   • the seven `t()` chrome strings → the generated i18n catalogue (P1/S10);
//   • the per-mode lucide glyph (Sun/Moon/Monitor/Sparkles) → the locally-authored [ThemePickerGlyphs];
//   • the `CheckCircle` selected marker → the shared `TeslaGlyphs.Check`;
//   • the entry animation → the shared `FadeIn` (reduced-motion aware).
//
// States reproduced: loading (a skeleton of the two sections while the persisted selection hydrates), content
// (the full picker with every web branch — `showMode`, the selected mode/theme markers, `showCustom`, the
// custom builder, and `compact` density), the defensive empty branch (a friendly state if the catalogue is
// ever empty — never in production, the catalogue is static brand data), a hard error with retry, and the
// stale/offline freshness chip over the cached selection. The persisted selection is the surface's only async
// dependency (web `ThemeProvider` hydrates it from `/settings` behind an `initialized` gate), so this matrix
// is honest rather than invented (covenant #9). The one-shot `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ThemePicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.toast.LocalToastController
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the rendered picker in any state. */
const val THEME_PICKER_TEST_TAG: String = "theme-picker"

/** Test tag prefix for a mode tile (`theme-picker-mode-<id>`) — used by the per-state + a11y UI tests. */
const val THEME_PICKER_MODE_TAG_PREFIX: String = "theme-picker-mode-"

/** Test tag prefix for an accent theme tile (`theme-picker-theme-<id>`). */
const val THEME_PICKER_THEME_TAG_PREFIX: String = "theme-picker-theme-"

/** Test tag on the custom colour builder panel, present when the custom theme is active. */
const val THEME_PICKER_CUSTOM_TAG: String = "theme-picker-custom"

private val SWATCH_SIZE: Dp = 24.dp
private val MODE_ICON_BOX: Dp = 32.dp
private val STRIP_SWATCH_W: Dp = 16.dp
private val STRIP_SWATCH_H: Dp = 8.dp
private val TILE_RADIUS: Dp = 12.dp
private val BUILDER_SWATCH: Dp = 28.dp
private val SKELETON_TILE_H: Dp = 56.dp
private const val RGB_MAX = 255f
private const val RGB_STEPS = 254
private const val SKELETON_LABEL_FRACTION = 0.3f
private const val SELECTED_FILL_ALPHA = 0.12f

// ── i18n strings (P1/S10) ────────────────────────────────────────────────────────────────────────────

/**
 * Localized chrome labels the surface folds into its output — every string the web routes through `t()` plus
 * the lifecycle copy (loading / error / freshness / empty). Built from `stringResource` at the render
 * boundary (tests pass a deterministic instance), keeping the model pure and locale-stable. The brand palette
 * names (`Neon Cyan`, `Dark`, …) are NOT here — they are catalogue data, exactly as the web `ThemeProvider`
 * holds them as literal `name` fields rather than `t()` keys.
 */
data class ThemePickerStrings(
    val surfaceLabel: String,
    val displayMode: String,
    val accentColor: String,
    val theme: String,
    val mode: String,
    val custom: String,
    val primary: String,
    val accent: String,
    val loading: String,
    val errorMessage: String,
    val retry: String,
    val stale: String,
    val offline: String,
    val noData: String,
) {
    /** True when every accessibility-critical label is present (no blank section/aria copy ships). */
    val hasAccessibilityLabels: Boolean
        get() = surfaceLabel.isNotBlank() && displayMode.isNotBlank() && accentColor.isNotBlank()
}

/** Builds the localized labels from the P1/S10 catalogue; tests pass a deterministic instance. */
@Composable
private fun rememberThemePickerStrings(): ThemePickerStrings =
    ThemePickerStrings(
        surfaceLabel = stringResource(R.string.translation_theme_subtitle),
        displayMode = stringResource(R.string.translation_theme_displayMode),
        accentColor = stringResource(R.string.translation_theme_accentColor),
        theme = stringResource(R.string.translation_theme_theme),
        mode = stringResource(R.string.translation_theme_mode),
        custom = stringResource(R.string.translation_theme_custom),
        primary = stringResource(R.string.translation_theme_primary),
        accent = stringResource(R.string.translation_theme_accent),
        loading = stringResource(R.string.translation_a11y_loading),
        errorMessage = stringResource(R.string.translation_error_loadFailed),
        retry = stringResource(R.string.translation_common_retry),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        noData = stringResource(R.string.translation_common_noData),
    )

/**
 * The picks the picker raises — grouped so the stateless renderer takes one parameter instead of five. The
 * stateful entry point fills these in (routing to the ViewModel + the toast host); previews pass the no-op
 * default so each state renders in isolation.
 */
class ThemePickerCallbacks(
    val onSelectBrand: (id: String, name: String) -> Unit = { _, _ -> },
    val onSelectMode: (id: String, name: String) -> Unit = { _, _ -> },
    val onSelectCustom: (primary: Long, accent: Long) -> Unit = { _, _ -> },
    val onCommitCustom: (primary: Long, accent: Long) -> Unit = { _, _ -> },
    val onRetry: () -> Unit = {},
)

// ── Stateful entry point ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point — the parity port of the web `<ThemePicker/>`. Binds the [ThemePickerViewModel],
 * records the one-shot `view.opened` diagnostic (P1/S11) on first composition, collects the folded
 * [UiState], and renders the picker. Each pick is routed to the ViewModel (persist + broadcast) and mirrored
 * to the host toast (web `toast.info`), then surfaced to the optional [onThemeChange]/[onModeChange]
 * callbacks (web `onChange`/`onModeChange`).
 *
 * @param viewModel the state holder bound to the shared theme preference store.
 * @param showMode render the Display Mode selector (web `showMode`, default true).
 * @param showCustom render the custom-colour tile + builder (web `showCustom`, default true).
 * @param compact denser grids for popover use (web `compact`, default false).
 * @param onThemeChange optional callback fired after any theme pick (web `onChange`).
 * @param onModeChange optional callback fired after any mode pick (web `onModeChange`).
 */
@Composable
fun ThemePicker(
    viewModel: ThemePickerViewModel,
    modifier: Modifier = Modifier,
    showMode: Boolean = true,
    showCustom: Boolean = true,
    compact: Boolean = false,
    onThemeChange: (String) -> Unit = {},
    onModeChange: (String) -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberThemePickerStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val toast = LocalToastController.current

    val callbacks =
        remember(viewModel, strings, toast) {
            ThemePickerCallbacks(
                onSelectBrand = { id, name ->
                    viewModel.selectTheme(id)
                    toast?.info("${strings.theme}: $name")
                    onThemeChange(id)
                },
                onSelectMode = { id, name ->
                    viewModel.selectMode(id)
                    toast?.info("${strings.mode}: $name")
                    onModeChange(id)
                },
                onSelectCustom = { primary, accent ->
                    viewModel.applyCustomColors(primary, accent)
                    toast?.info("${strings.theme}: ${strings.custom}")
                    onThemeChange(ThemePickerRegistration.CUSTOM_THEME_ID)
                },
                onCommitCustom = { primary, accent ->
                    viewModel.applyCustomColors(primary, accent)
                    onThemeChange(ThemePickerRegistration.CUSTOM_THEME_ID)
                },
                onRetry = viewModel::retry,
            )
        }

    ThemePickerContent(
        state = state,
        strings = strings,
        showMode = showMode,
        showCustom = showCustom,
        compact = compact,
        callbacks = callbacks,
        modifier = modifier,
    )
}

// ── Stateless renderer ───────────────────────────────────────────────────────────────────────────────

/**
 * Stateless picker — renders the surface in every phase the bound selection feed reports. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state. The root carries the surface landmark
 * label so screen readers announce the region.
 */
@Composable
fun ThemePickerContent(
    state: UiState<ThemePickerData>,
    strings: ThemePickerStrings,
    callbacks: ThemePickerCallbacks,
    modifier: Modifier = Modifier,
    showMode: Boolean = true,
    showCustom: Boolean = true,
    compact: Boolean = false,
) {
    val spacing = if (compact) Spacing.md else Spacing.lg
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(THEME_PICKER_TEST_TAG)
                .semantics { contentDescription = strings.surfaceLabel },
        verticalArrangement = Arrangement.spacedBy(spacing),
    ) {
        val freshness = freshnessOf(state)
        if (freshness != ThemePickerFreshness.Live) {
            FreshnessChip(freshness, strings)
        }
        when (state.phase) {
            UiPhase.Loading -> ThemePickerSkeleton(strings, compact)
            UiPhase.Error -> ThemePickerErrorState(strings, callbacks.onRetry)
            UiPhase.Empty -> EmptyState(message = strings.noData, icon = TeslaGlyphs.Info)
            UiPhase.Content ->
                state.data?.let { data ->
                    FadeIn {
                        ThemePickerSections(
                            data = data,
                            strings = strings,
                            showMode = showMode,
                            showCustom = showCustom,
                            compact = compact,
                            callbacks = callbacks,
                        )
                    }
                }
        }
    }
}

/** The two web sections (Display Mode + Accent Color) and the conditional custom builder. */
@Composable
private fun ThemePickerSections(
    data: ThemePickerData,
    strings: ThemePickerStrings,
    showMode: Boolean,
    showCustom: Boolean,
    compact: Boolean,
    callbacks: ThemePickerCallbacks,
) {
    val spacing = if (compact) Spacing.md else Spacing.lg
    Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
        if (showMode) {
            DisplayModeSection(data, strings, compact, callbacks.onSelectMode)
        }
        AccentColorSection(data, strings, showCustom, compact, callbacks)
        if (showCustom && data.isCustomSelected) {
            CustomColorBuilder(
                primary = data.selection.customPrimary,
                accent = data.selection.customAccent,
                strings = strings,
                onCommit = callbacks.onCommitCustom,
            )
        }
    }
}

// ── Display Mode section ─────────────────────────────────────────────────────────────────────────────

/** The web "Display Mode" grid — one selectable tile per mode (web `Object.values(allModes).map`). */
@Composable
private fun DisplayModeSection(
    data: ThemePickerData,
    strings: ThemePickerStrings,
    compact: Boolean,
    onSelectMode: (String, String) -> Unit,
) {
    SectionLabel(strings.displayMode)
    val columns = if (compact) 2 else 4
    WeightedGrid(items = data.modes, columns = columns, modifier = Modifier.selectableGroup()) { mode ->
        ModeTile(
            mode = mode,
            selected = data.isModeSelected(mode.id),
            onClick = { onSelectMode(mode.id, mode.name) },
        )
    }
}

/** One mode tile — the mode glyph in a tinted box, the name + the four-swatch palette strip, and a check. */
@Composable
private fun ModeTile(
    mode: ModeOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    SelectableTile(
        selected = selected,
        accent = MaterialTheme.colorScheme.primary,
        onClick = onClick,
        contentDescription = mode.name,
        modifier = Modifier.testTag(THEME_PICKER_MODE_TAG_PREFIX + mode.id),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(
                modifier =
                    Modifier
                        .size(MODE_ICON_BOX)
                        .clip(RoundedCornerShape(Spacing.sm))
                        .background(Color(mode.surface3))
                        .border(1.dp, Color(mode.glassBorder), RoundedCornerShape(Spacing.sm)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(modeGlyph(mode.id), contentDescription = null, size = IconSize.Sm, tint = Color(mode.textPrimary))
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(mode.name)
                SwatchStrip(mode.swatches)
            }
            SelectedCheck(selected, MaterialTheme.colorScheme.primary)
        }
    }
}

/** The four-colour preview strip the web renders under each mode name (`[bg, surface1, surface2, surface3]`). */
@Composable
private fun SwatchStrip(swatches: List<Long>) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs / 2)) {
        swatches.forEach { color ->
            Box(
                Modifier
                    .height(STRIP_SWATCH_H)
                    .width(STRIP_SWATCH_W)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color(color))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)),
            )
        }
    }
}

// ── Accent Color section ─────────────────────────────────────────────────────────────────────────────

/** The web "Accent Color" grid — the five brand themes plus an optional custom tile. */
@Composable
private fun AccentColorSection(
    data: ThemePickerData,
    strings: ThemePickerStrings,
    showCustom: Boolean,
    compact: Boolean,
    callbacks: ThemePickerCallbacks,
) {
    SectionLabel(strings.accentColor)
    val entries = data.themes + if (showCustom) listOf(data.customTheme(strings.custom)) else emptyList()
    val columns = if (compact) 2 else 3
    WeightedGrid(items = entries, columns = columns, modifier = Modifier.selectableGroup()) { option ->
        val isCustom = option.id == ThemePickerRegistration.CUSTOM_THEME_ID
        ThemeTile(
            option = option,
            selected = data.isThemeSelected(option.id),
            onClick = {
                if (isCustom) {
                    callbacks.onSelectCustom(option.primary, option.accent)
                } else {
                    callbacks.onSelectBrand(option.id, option.name)
                }
            },
        )
    }
}

/** One accent theme tile — a primary→accent gradient swatch, the name, and a check when selected. */
@Composable
private fun ThemeTile(
    option: ThemeOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val accent = Color(option.primary)
    SelectableTile(
        selected = selected,
        accent = accent,
        onClick = onClick,
        contentDescription = option.name,
        modifier = Modifier.testTag(THEME_PICKER_THEME_TAG_PREFIX + option.id),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Box(
                    Modifier
                        .size(SWATCH_SIZE)
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Color(option.primary), Color(option.accent)))),
                )
                SelectedCheck(selected, accent, modifier = Modifier.weight(1f), alignEnd = true)
            }
            Caption(option.name)
        }
    }
}

// ── Custom colour builder ────────────────────────────────────────────────────────────────────────────

/**
 * The web custom-colour builder, shown when the custom theme is active. Two channel editors (Primary +
 * Accent) each carry a live swatch, the `#RRGGBB` hex (web hex label), and R/G/B sliders. The sliders update
 * the live preview on drag and commit to the store on settle (web persists on every `onChange`; settling
 * avoids spamming persistence while keeping the preview live). Picking either commits both colours together,
 * exactly as the web `setCustomColors(primary, accent)` does.
 */
@Composable
private fun CustomColorBuilder(
    primary: Long,
    accent: Long,
    strings: ThemePickerStrings,
    onCommit: (Long, Long) -> Unit,
) {
    var primaryColor by remember(primary) { mutableStateOf(primary) }
    var accentColor by remember(accent) { mutableStateOf(accent) }

    Surface(
        modifier = Modifier.fillMaxWidth().testTag(THEME_PICKER_CUSTOM_TAG),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            ColorChannelEditor(
                label = strings.primary,
                color = primaryColor,
                onColorChange = { primaryColor = it },
                onCommit = { onCommit(primaryColor, accentColor) },
            )
            ColorChannelEditor(
                label = strings.accent,
                color = accentColor,
                onColorChange = { accentColor = it },
                onCommit = { onCommit(primaryColor, accentColor) },
            )
        }
    }
}

/** A single colour's editor: a live swatch + hex readout and one slider per R/G/B channel. */
@Composable
private fun ColorChannelEditor(
    label: String,
    color: Long,
    onColorChange: (Long) -> Unit,
    onCommit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(
                Modifier
                    .size(BUILDER_SWATCH)
                    .clip(RoundedCornerShape(Spacing.sm))
                    .background(Color(color))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Spacing.sm)),
            )
            MetricLabel(label, modifier = Modifier.weight(1f))
            CodeText(ThemeColor.hex(color))
        }
        ChannelSliderRow(color, onColorChange, onCommit)
    }
}

/** The three R/G/B sliders for one colour, each rebuilding the ARGB long on change and committing on settle. */
@Composable
private fun ChannelSliderRow(
    color: Long,
    onColorChange: (Long) -> Unit,
    onCommit: () -> Unit,
) {
    val r = ThemeColor.red(color)
    val g = ThemeColor.green(color)
    val b = ThemeColor.blue(color)
    Slider(
        value = r.toFloat(),
        onValueChange = { onColorChange(ThemeColor.fromRgb(it.toInt(), g, b)) },
        valueRange = 0f..RGB_MAX,
        steps = RGB_STEPS,
        label = "R",
        valueText = r.toString(),
        onValueChangeFinished = onCommit,
    )
    Slider(
        value = g.toFloat(),
        onValueChange = { onColorChange(ThemeColor.fromRgb(r, it.toInt(), b)) },
        valueRange = 0f..RGB_MAX,
        steps = RGB_STEPS,
        label = "G",
        valueText = g.toString(),
        onValueChangeFinished = onCommit,
    )
    Slider(
        value = b.toFloat(),
        onValueChange = { onColorChange(ThemeColor.fromRgb(r, g, it.toInt())) },
        valueRange = 0f..RGB_MAX,
        steps = RGB_STEPS,
        label = "B",
        valueText = b.toString(),
        onValueChangeFinished = onCommit,
    )
}

/** A selectable card with a tinted border + subtle fill when [selected] (web ghost-button selected state). */
@Composable
private fun SelectableTile(
    selected: Boolean,
    accent: Color,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val border = if (selected) accent else MaterialTheme.colorScheme.outlineVariant
    val fill =
        if (selected) {
            accent.copy(alpha = SELECTED_FILL_ALPHA).compositeOverSurface()
        } else {
            MaterialTheme.colorScheme.surface
        }
    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .semantics { this.contentDescription = contentDescription },
        shape = RoundedCornerShape(TILE_RADIUS),
        color = fill,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(if (selected) 1.5.dp else 1.dp, border),
    ) {
        Box(Modifier.padding(Spacing.md)) { content() }
    }
}

/** The web `CheckCircle` selected marker — shown only when [selected], tinted to the option's accent. */
@Composable
private fun SelectedCheck(
    selected: Boolean,
    accent: Color,
    modifier: Modifier = Modifier,
    alignEnd: Boolean = false,
) {
    if (!selected) {
        if (alignEnd) Spacer(modifier)
        return
    }
    val box = if (alignEnd) modifier else Modifier
    Box(modifier = box, contentAlignment = Alignment.CenterEnd) {
        Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm, tint = accent)
    }
}

/** A small uppercase-style section header (web `text-xs uppercase tracking-wider text-muted`). */
@Composable
private fun SectionLabel(text: String) {
    MetricLabel(text, modifier = Modifier.padding(bottom = Spacing.xs))
}

/** The stale/offline freshness chip the picker shows over cached selection (honest last-known). */
@Composable
private fun FreshnessChip(
    freshness: ThemePickerFreshness,
    strings: ThemePickerStrings,
) {
    val label = if (freshness == ThemePickerFreshness.Offline) strings.offline else strings.stale
    val tone = if (freshness == ThemePickerFreshness.Offline) StatusTone.Danger else StatusTone.Warning
    StatusPill(text = label, tone = tone, pulse = freshness == ThemePickerFreshness.Stale)
}

/** Loading chrome — skeleton section labels + tile rows while the persisted selection hydrates. */
@Composable
private fun ThemePickerSkeleton(
    strings: ThemePickerStrings,
    compact: Boolean,
) {
    val columns = if (compact) 2 else 3
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(2) {
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = STRIP_SWATCH_H, rounded = true)
            WeightedGrid(items = (0 until columns).toList(), columns = columns) {
                Skeleton(widthFraction = 1f, height = SKELETON_TILE_H, rounded = true)
            }
        }
    }
}

/** Hard-error chrome — a localized message + a retry affordance (web has no equivalent; this backs retry). */
@Composable
private fun ThemePickerErrorState(
    strings: ThemePickerStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            TeslaGlyphs.Warning,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        BodyText(strings.errorMessage, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(label = strings.retry, onClick = onRetry, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
    }
}

// ── Pure-ish view helpers ────────────────────────────────────────────────────────────────────────────

/** Maps the bound feed's [state] to the freshness chip — offline (cached after a failed read) > stale > live. */
private fun freshnessOf(state: UiState<*>): ThemePickerFreshness =
    when {
        state.isOffline && state.errorKind != null -> ThemePickerFreshness.Offline
        state.stale -> ThemePickerFreshness.Stale
        else -> ThemePickerFreshness.Live
    }

/** The locally-authored mode glyph (web lucide map: dark→Moon, light→Sun, oled/auto→Monitor, others→Sparkles). */
private fun modeGlyph(modeId: String): ImageVector =
    when (modeId) {
        "light", "sunset" -> ThemePickerGlyphs.Sun
        "dark" -> ThemePickerGlyphs.Moon
        "oled", "auto" -> ThemePickerGlyphs.Monitor
        else -> ThemePickerGlyphs.Sparkles
    }

/** Composites a translucent accent over the Material surface so a selected tile reads on any theme. */
@Composable
private fun Color.compositeOverSurface(): Color = compositeOver(MaterialTheme.colorScheme.surface)

/**
 * An even-column grid laid out as weighted [Row]s — a stable-API alternative to `LazyVerticalGrid` (the
 * picker must not scroll inside its host) and to experimental flow layouts. Trailing cells in the last row
 * are padded with weighted spacers so columns stay aligned (web CSS grid).
 */
@Composable
private fun <T> WeightedGrid(
    items: List<T>,
    columns: Int,
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.sm,
    itemContent: @Composable (T) -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing)) {
        items.chunked(columns).forEach { rowItems ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing)) {
                rowItems.forEach { item ->
                    Box(modifier = Modifier.weight(1f)) { itemContent(item) }
                }
                repeat(columns - rowItems.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// ── Local mode glyphs (lucide-equivalent, authored in-surface) ─────────────────────────────────────────

/**
 * The four mode glyphs the web maps from `lucide-react` (Sun / Moon / Monitor / Sparkles), authored here as
 * 24×24 stroked vectors so the surface needs no extra icon artifact. Each is monochrome and recolored to the
 * mode's `textPrimary` at render time by [Icon]'s tint.
 */
private object ThemePickerGlyphs {
    val Sun: ImageVector =
        stroked("Sun") {
            moveTo(12f, 4.5f)
            lineTo(12f, 6.5f)
            moveTo(12f, 17.5f)
            lineTo(12f, 19.5f)
            moveTo(4.5f, 12f)
            lineTo(6.5f, 12f)
            moveTo(17.5f, 12f)
            lineTo(19.5f, 12f)
            moveTo(6.7f, 6.7f)
            lineTo(8.1f, 8.1f)
            moveTo(15.9f, 15.9f)
            lineTo(17.3f, 17.3f)
            moveTo(17.3f, 6.7f)
            lineTo(15.9f, 8.1f)
            moveTo(8.1f, 15.9f)
            lineTo(6.7f, 17.3f)
            circle(12f, 12f, 3.2f)
        }
    val Moon: ImageVector =
        stroked("Moon") {
            moveTo(20f, 14.5f)
            curveTo(18.8f, 15.2f, 17.4f, 15.6f, 16f, 15.6f)
            curveTo(11.6f, 15.6f, 8f, 12f, 8f, 7.6f)
            curveTo(8f, 6.2f, 8.4f, 4.8f, 9.1f, 3.6f)
            curveTo(5.6f, 4.8f, 3.2f, 8.1f, 3.2f, 12f)
            curveTo(3.2f, 16.9f, 7.1f, 20.8f, 12f, 20.8f)
            curveTo(15.9f, 20.8f, 19.2f, 18.4f, 20f, 14.5f)
            close()
        }
    val Monitor: ImageVector =
        stroked("Monitor") {
            rect(3.5f, 4.5f, 20.5f, 16f)
            moveTo(9f, 20f)
            lineTo(15f, 20f)
            moveTo(12f, 16f)
            lineTo(12f, 20f)
        }
    val Sparkles: ImageVector =
        stroked("Sparkles") {
            moveTo(12f, 4f)
            lineTo(13.4f, 9.1f)
            lineTo(18.5f, 10.5f)
            lineTo(13.4f, 11.9f)
            lineTo(12f, 17f)
            lineTo(10.6f, 11.9f)
            lineTo(5.5f, 10.5f)
            lineTo(10.6f, 9.1f)
            close()
            moveTo(18f, 16f)
            lineTo(18.6f, 18.4f)
            lineTo(21f, 19f)
            lineTo(18.6f, 19.6f)
            lineTo(18f, 22f)
            lineTo(17.4f, 19.6f)
            lineTo(15f, 19f)
            lineTo(17.4f, 18.4f)
            close()
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()

    private fun PathBuilder.rect(
        left: Float,
        top: Float,
        right: Float,
        bottom: Float,
    ) {
        moveTo(left, top)
        lineTo(right, top)
        lineTo(right, bottom)
        lineTo(left, bottom)
        close()
    }

    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, false, true, cx + r, cy)
        arcTo(r, r, 0f, false, true, cx - r, cy)
        close()
    }
}

// ── Previews (tooling-only) ────────────────────────────────────────────────────────────────────────────

private fun previewStrings(): ThemePickerStrings =
    ThemePickerStrings(
        surfaceLabel = "Customize colors and display mode",
        displayMode = "Display Mode",
        accentColor = "Accent Color",
        theme = "Theme",
        mode = "Mode",
        custom = "Custom",
        primary = "Primary",
        accent = "Accent",
        loading = "Loading",
        errorMessage = "Failed to load data",
        retry = "Retry",
        stale = "Stale",
        offline = "Offline",
        noData = "No data available",
    )

private fun previewData(themeId: String = "neon-cyan"): ThemePickerData =
    ThemeCatalog.project(ThemePickerRegistration.DEFAULTS.copy(themeId = themeId))

@Composable
private fun PreviewPicker(
    state: UiState<ThemePickerData>,
    showCustom: Boolean = true,
    compact: Boolean = false,
) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Surface {
                ThemePickerContent(
                    state = state,
                    strings = previewStrings(),
                    callbacks = ThemePickerCallbacks(),
                    showCustom = showCustom,
                    compact = compact,
                    modifier = Modifier.padding(Spacing.md),
                )
            }
        }
    }
}

@Preview(name = "ThemePicker · content", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerContentPreview() = PreviewPicker(UiState(UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "ThemePicker · custom builder", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerCustomPreview() = PreviewPicker(UiState(UiPhase.Content, data = previewData("custom"), fetchedAt = PREVIEW_STAMP))

@Preview(name = "ThemePicker · compact (no custom)", showBackground = true, widthDp = 320)
@Composable
private fun ThemePickerCompactPreview() =
    PreviewPicker(
        UiState(UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_STAMP),
        showCustom = false,
        compact = true,
    )

@Preview(name = "ThemePicker · loading", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerLoadingPreview() = PreviewPicker(UiState.loading())

@Preview(name = "ThemePicker · empty", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerEmptyPreview() =
    PreviewPicker(UiState(UiPhase.Empty, data = ThemePickerData(ThemePickerRegistration.DEFAULTS, emptyList(), emptyList())))

@Preview(name = "ThemePicker · error", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerErrorPreview() = PreviewPicker(UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Unknown))

@Preview(name = "ThemePicker · offline", showBackground = true, widthDp = 420)
@Composable
private fun ThemePickerOfflinePreview() =
    PreviewPicker(
        UiState(
            UiPhase.Content,
            data = previewData(),
            fetchedAt = PREVIEW_STAMP,
            stale = true,
            errorKind = io.teslasync.android.data.ErrorKind.Network,
        ),
    )

private const val PREVIEW_STAMP: Long = 1_700_000_000_000L

/**
 * Convenience host binding the surface from the app's [LocalDataContainer] — the entry a screen uses to drop
 * the picker in without owning the ViewModel wiring. The host provides the shared [ThemePreferenceStore] and
 * the sanctioned [Logger]; here we bind the ViewModel via its factory over a [StoreThemePickerSource].
 */
@Composable
fun ThemePickerHost(
    store: ThemePreferenceStore,
    modifier: Modifier = Modifier,
    showMode: Boolean = true,
    showCustom: Boolean = true,
    compact: Boolean = false,
    onThemeChange: (String) -> Unit = {},
    onModeChange: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ThemePickerViewModel =
        viewModel(
            key = ThemePickerRegistration.ID,
            factory = ThemePickerViewModel.factory(StoreThemePickerSource(store), logger),
        )
    ThemePicker(
        viewModel = vm,
        modifier = modifier,
        showMode = showMode,
        showCustom = showCustom,
        compact = compact,
        onThemeChange = onThemeChange,
        onModeChange = onModeChange,
    )
}
