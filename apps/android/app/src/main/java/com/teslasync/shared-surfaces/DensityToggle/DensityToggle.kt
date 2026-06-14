// The native Jetpack Compose + Material 3 DensityToggle shared surface — a parity port of
// web/src/components/forms/DensityToggle.tsx. The web surface is a controlled, presentational three-way
// Table / Compact / Comfortable selector for list pages, implementing the WAI-ARIA radiogroup pattern: each
// option is a `role="radio"` button carrying its density glyph + localized label, arrow keys move + commit the
// selection, and the caller owns the value (typically a URL param so the choice survives a refresh).
//
// This native surface keeps that contract end to end. The idiomatic Material 3 equivalent of the web segmented
// radiogroup is a SingleChoiceSegmentedButtonRow of SegmentedButtons: one connected, single-selection control
// whose active segment is highlighted, each segment showing the density glyph + label and committing through
// `onChange` on tap. The horizontal ArrowLeft / ArrowRight commit behaviour (web `onKeyDown`) is reproduced for
// hardware-keyboard / D-pad users via the pure [DensityToggleKeyboard]. It performs NO HTTP and binds NO data
// state holder (the web component fetches nothing — its only hook is `useTranslation`); see DensityToggleModel.kt
// for the honesty rationale and why the generic loading / error / stale / offline states belong to the owning
// list page, not a controlled selector. The chrome is composed from the shared ui atoms (Icon / Caption / Text)
// over platform tokens (P1/S9), so it stays correct across light / dark / high-contrast themes.
//
// Accessibility: the row carries the localized radiogroup name (web group `aria-label`), and every segment is an
// individually selectable target naming itself with its density label (web per-option `aria-label`) and
// announcing its selected state — the native equivalent of `role="radio" aria-checked`. The density glyphs are
// decorative (the label names the option). Every visible / spoken string resolves through the i18n facade
// (P1/S10): the four web labels resolve by-name with the English [DensityToggleDefaults] fallbacks (the web keys
// are not in the catalog; the web relies on i18next's default-value fallback), the native mirror of
// `t(key, default)`. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition, carrying
// only the surface slug. All branch selection flows through the pure DensityToggleModel.kt projection.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DensityToggle) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content, glyphs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.densitytoggle

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/** Stable root test tag for the segmented selector — used by the instrumented per-state + a11y UI tests. */
const val DENSITY_TOGGLE_TEST_TAG: String = "density-toggle"

/** Stable test tag for the empty-state caption (shown when the caller passes no options). */
const val DENSITY_TOGGLE_EMPTY_TAG: String = "density-toggle-empty"

/** The per-option test tag — the native mirror of the web `${testId}-${opt}` data-testid scheme. */
fun densityOptionTag(density: Density): String = "density-toggle-option-${density.id}"

/**
 * Stateful entry point — the faithful port of the web `DensityToggle`. Resolves the localized
 * [DensityToggleStrings] at the render boundary (P1/S10), records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, and renders the stateless [DensityToggleContent]. The surface owns no density
 * state — the caller holds [value] and commits through [onChange] (web's controlled contract); [logger] defaults
 * to the process logger so a host mounts it with just the controlled props.
 *
 * @param value the currently selected density (web `value`).
 * @param onChange invoked with the newly chosen density on tap or arrow-key commit (web `onChange`).
 * @param options the densities to offer, in order (web `options`, default table / compact / comfortable).
 * @param ariaLabel optional explicit accessible name for the group (web `ariaLabel`); null ⇒ the localized
 *   "List density".
 * @param testTag optional UI-test tag for the root (web `testId`); each option gets `-${density.id}`.
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun DensityToggle(
    value: Density,
    onChange: (Density) -> Unit,
    modifier: Modifier = Modifier,
    options: List<Density> = DEFAULT_DENSITY_OPTIONS,
    ariaLabel: String? = null,
    testTag: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DensityToggleDiagnostics.recordViewOpened(logger) }
    DensityToggleContent(
        value = value,
        onChange = onChange,
        strings = rememberDensityToggleStrings(),
        modifier = modifier,
        options = options,
        ariaLabel = ariaLabel,
        testTag = testTag,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point (no diagnostics, no data container). Projects the
 * controlled props + [strings] through [DensityToggleProjection] and draws either the empty caption (no options,
 * never a blank box) or the SingleChoiceSegmentedButtonRow of density segments. The row carries the radiogroup
 * accessible name; each segment names itself with its density label, highlights when selected, and commits its
 * density through [onChange]. Horizontal arrow keys cycle + commit the selection (web `onKeyDown`).
 */
@Composable
fun DensityToggleContent(
    value: Density,
    onChange: (Density) -> Unit,
    strings: DensityToggleStrings,
    modifier: Modifier = Modifier,
    options: List<Density> = DEFAULT_DENSITY_OPTIONS,
    ariaLabel: String? = null,
    testTag: String? = null,
) {
    val render =
        remember(value, options, strings, ariaLabel) {
            DensityToggleProjection.project(value, options, strings, ariaLabel)
        }
    val groupLabel = render.groupLabel
    val rootTag = testTag ?: DENSITY_TOGGLE_TEST_TAG

    if (render.isEmpty) {
        Caption(
            text = strings.noOptions,
            modifier =
                modifier
                    .testTag(DENSITY_TOGGLE_EMPTY_TAG)
                    .semantics { contentDescription = groupLabel },
        )
        return
    }

    SingleChoiceSegmentedButtonRow(
        modifier =
            modifier
                .testTag(rootTag)
                .semantics { contentDescription = groupLabel }
                .onPreviewKeyEvent { event ->
                    val target = arrowKeyOf(event)?.let { DensityToggleKeyboard.next(options, value, it) }
                    if (target != null && target != value) {
                        onChange(target)
                        true
                    } else {
                        false
                    }
                },
    ) {
        val count = render.options.size
        render.options.forEachIndexed { index, option ->
            val label = option.label
            val optionTag = testTag?.let { "$it-${option.density.id}" } ?: densityOptionTag(option.density)
            SegmentedButton(
                selected = option.selected,
                onClick = { onChange(option.density) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = count),
                modifier =
                    Modifier
                        .testTag(optionTag)
                        .semantics { contentDescription = label },
                icon = {
                    Icon(
                        imageVector = densityGlyph(option.density),
                        contentDescription = null,
                        size = IconSize.Sm,
                    )
                },
                label = { Text(label) },
            )
        }
    }
}

/**
 * Resolves the localized [DensityToggleStrings] at the render boundary. The web `density.*` keys are not in the
 * generated catalog, so each resolves by-name through the i18n facade ([resolveOptional] over
 * [Context.optionalString]) with the English [DensityToggleDefaults] fallback — the native mirror of i18next
 * `t(key, default)`.
 */
@Composable
private fun rememberDensityToggleStrings(): DensityToggleStrings {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val table = resolveOptional(lookup, KEY_DENSITY_TABLE, DensityToggleDefaults.TABLE)
    val compact = resolveOptional(lookup, KEY_DENSITY_COMPACT, DensityToggleDefaults.COMPACT)
    val comfortable = resolveOptional(lookup, KEY_DENSITY_COMFORTABLE, DensityToggleDefaults.COMFORTABLE)
    val groupLabel = resolveOptional(lookup, KEY_DENSITY_GROUP_LABEL, DensityToggleDefaults.GROUP_LABEL)
    val noOptions = resolveOptional(lookup, KEY_DENSITY_NO_OPTIONS, DensityToggleDefaults.NO_OPTIONS)
    return remember(table, compact, comfortable, groupLabel, noOptions) {
        DensityToggleStrings(
            table = table,
            compact = compact,
            comfortable = comfortable,
            groupLabel = groupLabel,
            noOptions = noOptions,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent, so `DiscouragedApi`
 * is suppressed; release builds keep resource names so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/** Maps a horizontal arrow key event to a [DensityToggleKey], or null for any other key / non-press event. */
private fun arrowKeyOf(event: KeyEvent): DensityToggleKey? =
    if (event.type != KeyEventType.KeyDown) {
        null
    } else {
        when (event.key) {
            Key.DirectionLeft -> DensityToggleKey.ArrowLeft
            Key.DirectionRight -> DensityToggleKey.ArrowRight
            else -> null
        }
    }

/** Selects the line glyph for a density — the native mirror of the web `ICONS` map (Table2 / Rows3 / Rows). */
private fun densityGlyph(density: Density): ImageVector =
    when (density) {
        Density.Table -> DensityGlyphs.Table
        Density.Compact -> DensityGlyphs.CompactRows
        Density.Comfortable -> DensityGlyphs.ComfortableRows
    }

// ── Glyphs ───────────────────────────────────────────────────────────────────────────────────────────────
// Android has no bundled lucide-react equivalent, so the three density glyphs are authored here as 24×24 stroked
// vectors (recolored at render time by the Icon tint), mirroring the approach in components.forms.FormsGlyphs:
//   Table       → a grid (one horizontal + one vertical divider) for the densest table view (web Table2).
//   CompactRows → three stacked rows (two dividers) for the compact list (web Rows3).
//   ComfortableRows → two roomy rows (one divider) for the comfortable list (web Rows).

private val GLYPH_DIMENSION: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE_WIDTH: Float = 2f
private const val GLYPH_EDGE_LOW: Float = 4f
private const val GLYPH_EDGE_HIGH: Float = 20f
private const val GLYPH_MID: Float = 12f
private const val GLYPH_THIRD_LOW: Float = 9f
private const val GLYPH_THIRD_HIGH: Float = 15f

private object DensityGlyphs {
    val Table: ImageVector =
        strokedGlyph("DensityTable") {
            box(GLYPH_EDGE_LOW, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH, GLYPH_EDGE_HIGH)
            horizontalLine(GLYPH_MID, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH)
            verticalLine(GLYPH_MID, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH)
        }

    val CompactRows: ImageVector =
        strokedGlyph("DensityCompact") {
            box(GLYPH_EDGE_LOW, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH, GLYPH_EDGE_HIGH)
            horizontalLine(GLYPH_THIRD_LOW, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH)
            horizontalLine(GLYPH_THIRD_HIGH, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH)
        }

    val ComfortableRows: ImageVector =
        strokedGlyph("DensityComfortable") {
            box(GLYPH_EDGE_LOW, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH, GLYPH_EDGE_HIGH)
            horizontalLine(GLYPH_MID, GLYPH_EDGE_LOW, GLYPH_EDGE_HIGH)
        }
}

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_DIMENSION,
            defaultHeight = GLYPH_DIMENSION,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.box(
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

/** Horizontal segment at [y] spanning ([x0], [x1]). */
private fun PathBuilder.horizontalLine(
    y: Float,
    x0: Float,
    x1: Float,
) {
    moveTo(x0, y)
    lineTo(x1, y)
}

/** Vertical segment at [x] spanning ([y0], [y1]). */
private fun PathBuilder.verticalLine(
    x: Float,
    y0: Float,
    y1: Float,
) {
    moveTo(x, y0)
    lineTo(x, y1)
}

// ── Previews — one per render branch (each density selected + the empty state). ─────────────────────────────

private val previewStrings =
    DensityToggleStrings(
        table = DensityToggleDefaults.TABLE,
        compact = DensityToggleDefaults.COMPACT,
        comfortable = DensityToggleDefaults.COMFORTABLE,
        groupLabel = DensityToggleDefaults.GROUP_LABEL,
        noOptions = DensityToggleDefaults.NO_OPTIONS,
    )

@Preview(name = "DensityToggle · each density selected", showBackground = true)
@Composable
private fun DensityToggleStatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(verticalArrangement = Arrangement.spacedBy(GLYPH_DIMENSION)) {
            DensityToggleContent(value = Density.Table, onChange = {}, strings = previewStrings)
            DensityToggleContent(value = Density.Compact, onChange = {}, strings = previewStrings)
            DensityToggleContent(value = Density.Comfortable, onChange = {}, strings = previewStrings)
        }
    }
}

@Preview(name = "DensityToggle · subset options", showBackground = true)
@Composable
private fun DensityToggleSubsetPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DensityToggleContent(
            value = Density.Comfortable,
            onChange = {},
            strings = previewStrings,
            options = listOf(Density.Compact, Density.Comfortable),
        )
    }
}

@Preview(name = "DensityToggle · empty", showBackground = true)
@Composable
private fun DensityToggleEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DensityToggleContent(
            value = Density.Table,
            onChange = {},
            strings = previewStrings,
            options = emptyList(),
        )
    }
}
