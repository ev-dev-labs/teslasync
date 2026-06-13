// The native Jetpack Compose + Material 3 QuickStatsGrid feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx. The web component is purely
// presentational: the owning Vehicle Detail page threads down the live `state` + `status`, and it renders a
// responsive grid (Tailwind `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`) of eight `MetricCard`s — Battery,
// Range, Odometer, Speed (with a driving / parked subtitle), Inside Temp, Outside Temp, Power, and State —
// its only data hooks being `useTranslation` (labels, P1/S10) and `useUnits` (display units + locale, P1/S8).
//
// This port keeps that contract exactly. The grid reproduces the web composition cell-for-cell, in source
// order, reflowing four-per-row at the web `lg` breakpoint (1024dp), three-per-row at `sm` (640dp), and
// two-per-row below it. Each cell fills its column via [Modifier.weight] and carries a merged TalkBack label,
// so no surface is ever hidden or blank. A skeleton branch (opt-in `loading` flag the owning page threads)
// preserves the page's loading affordance; when no live state is present the grid shows the localized empty
// message rather than a blank box. The cache-then-network states (error / stale / offline) are owned by the
// Vehicle Detail page, exactly as in the web source and the committed QuickMetrics / TemperatureMetricCards
// siblings, so they are not re-implemented here. The surface carries no motion (the web grid has none), so
// the reduced-motion contract is honored trivially.
//
// Every derivation flows through the pure [QuickStatsGridProjection]; this file is a thin render layer that
// resolves the i18n labels (P1/S10), the live unit preference + locale (P1/S8), the design-token accents
// (P1/S9), and the glyphs, then draws them. There is no English literal and no HTTP here. The one-shot
// `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuickStatsGrid) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quickstatsgrid

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web Tailwind `lg` breakpoint (1024px): at or above this width all eight cells lay out four-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cells lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 4
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The full eight-cell grid sizes the loading skeleton so it does not jump on resolve. */
private const val LOADING_TILE_COUNT: Int = 8

/** Each loading tile mirrors a resolved MetricCard's height so the skeleton grid does not jump on resolve. */
private val SKELETON_HEIGHT: Dp = 88.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `QuickStatsGrid({ state, status })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live unit preference + locale
 * from the data container (web `useUnits`, P1/S8), projects the props onto a [QuickStatsGridDisplay] via the
 * pure [QuickStatsGridProjection], and renders.
 *
 * @param state the live vehicle state the owning Vehicle Detail page threads in (web `state`), or `null` when
 *   no live state is available — `null` selects the empty branch.
 * @param status the vehicle's current status string rendered by the State cell (web `status`).
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun QuickStatsGrid(
    state: QuickStatsVehicleState?,
    status: String?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { QuickStatsGridDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val strings = quickStatsGridStrings()
    val display =
        remember(state, status, loading, prefs, strings) {
            QuickStatsGridProjection.project(
                state = state,
                status = status,
                prefs = prefs,
                strings = strings,
                loading = loading,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    QuickStatsGridContent(display = display, strings = strings, modifier = modifier)
}

/**
 * Resolves the eight cell labels, the two speed-subtitle states, the empty message, and the loading
 * announcement from the generated catalog (P1/S10). Exposed so the stateful entry, the previews, and any host
 * share one source of strings.
 */
@Composable
fun quickStatsGridStrings(): QuickStatsGridStrings =
    QuickStatsGridStrings(
        battery = stringResource(R.string.translation_common_battery),
        range = stringResource(R.string.translation_common_range),
        odometer = stringResource(R.string.translation_common_odometer),
        speed = stringResource(R.string.translation_common_speed),
        driving = stringResource(R.string.translation_common_driving),
        parked = stringResource(R.string.translation_common_parked),
        insideTemp = stringResource(R.string.translation_common_insideTemp),
        outsideTemp = stringResource(R.string.translation_common_outsideTemp),
        power = stringResource(R.string.translation_common_power),
        state = stringResource(R.string.translation_common_state),
        noData = stringResource(R.string.translation_common_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Renders the skeleton grid while
 * [QuickStatsGridDisplay.loading] is true (the page-implied loading), the eight-cell grid when live state is
 * present, or the localized empty state otherwise. Every branch is always present, so no surface is hidden.
 */
@Composable
fun QuickStatsGridContent(
    display: QuickStatsGridDisplay,
    strings: QuickStatsGridStrings,
    modifier: Modifier = Modifier,
) {
    when {
        display.loading -> QuickStatsLoadingGrid(loadingLabel = strings.loadingLabel, modifier = modifier)
        display.hasData -> QuickStatsCardGrid(cards = display.cards, modifier = modifier)
        else -> EmptyState(message = strings.noData, modifier = modifier)
    }
}

/**
 * The resolved branch — the eight cells in the web responsive grid. Each cell fills its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so the cells keep a uniform
 * width. Cells are spaced by [Spacing.md], the native expression of the web `gap-3`, and emitted in web
 * source order.
 */
@Composable
private fun QuickStatsCardGrid(
    cards: List<QuickStatCard>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card -> QuickStatTile(card = card, modifier = Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single cell: the web `<MetricCard label value subtitle icon color />` with a merged TalkBack label. */
@Composable
private fun QuickStatTile(
    card: QuickStatCard,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = card.label,
        value = card.value,
        subtitle = card.subtitle,
        icon = glyphFor(card.icon),
        accent = accentFor(card.color),
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = card.contentDescription },
    )
}

/**
 * The loading branch — [LOADING_TILE_COUNT] skeleton tiles in the same responsive grid as the resolved cells.
 * The grid carries a single TalkBack "Loading" content description so the loading state is announced rather
 * than read as several empty boxes.
 */
@Composable
private fun QuickStatsLoadingGrid(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
    ) {
        val columns = columnsFor(maxWidth)
        val rowCount = (LOADING_TILE_COUNT + columns - 1) / columns
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            repeat(rowCount) { rowIndex ->
                val tilesInRow = minOf(columns, LOADING_TILE_COUNT - rowIndex * columns)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    repeat(tilesInRow) { Skeleton(modifier = Modifier.weight(1f), height = SKELETON_HEIGHT) }
                    repeat(columns - tilesInRow) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the responsive column count from the available [width] (web `grid-cols-2 sm:3 lg:4`). */
private fun columnsFor(width: Dp): Int =
    when {
        width >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
        width >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
        else -> GRID_COLUMNS_BASE
    }

/** Maps a cell's accent identity onto the active theme tokens (web neon `green` / `cyan` / `purple`). */
@Composable
private fun accentFor(color: QuickStatColor): Color =
    when (color) {
        QuickStatColor.Green -> TeslaTokens.status.success
        QuickStatColor.Cyan -> TeslaTokens.status.info
        QuickStatColor.Purple -> TeslaTokens.chart.power
    }

/** Maps a cell's glyph identity onto a shared data-display glyph or the hand-authored lucide [ImageVector]. */
private fun glyphFor(icon: QuickStatIcon): ImageVector =
    when (icon) {
        QuickStatIcon.Battery -> DataDisplayGlyphs.Battery
        QuickStatIcon.Navigation -> QuickStatsGridGlyphs.Navigation
        QuickStatIcon.Car -> QuickStatsGridGlyphs.Car
        QuickStatIcon.Gauge -> DataDisplayGlyphs.Gauge
        QuickStatIcon.Thermometer -> QuickStatsGridGlyphs.Thermometer
        QuickStatIcon.Bolt -> DataDisplayGlyphs.Bolt
        QuickStatIcon.Activity -> QuickStatsGridGlyphs.Activity
    }

/**
 * The four lucide glyphs this surface needs that the shared data-display set does not carry. The web uses
 * lucide `Navigation`, `Car`, `Thermometer`, and `Activity`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — each
 * is authored here as a 24×24 round-capped stroked vector faithful to the lucide path. The Battery, Gauge,
 * and Bolt cells reuse the shared `DataDisplayGlyphs` set (Bolt is the codebase's sanctioned glyph for the
 * web `Zap`). Each is recolored at render time by `MetricCard`'s accent tint.
 */
private object QuickStatsGridGlyphs {
    /** lucide `navigation` — the Range cell (a pointing compass arrow). */
    val Navigation: ImageVector =
        stroked("QuickStatsGridNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** lucide `car` — the Odometer cell (a car body with two wheels). */
    val Car: ImageVector =
        stroked("QuickStatsGridCar") {
            moveTo(4f, 13f)
            lineTo(6.5f, 8f)
            lineTo(15f, 8f)
            lineTo(18.5f, 12f)
            moveTo(3f, 13f)
            lineTo(21f, 13f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(7.5f, 16f)
            lineTo(7.6f, 16f)
            moveTo(16.5f, 16f)
            lineTo(16.6f, 16f)
        }

    /** lucide `thermometer` — the Inside / Outside temperature cells (a stem above a bulb). */
    val Thermometer: ImageVector =
        stroked("QuickStatsGridThermometer") {
            moveTo(10f, 5f)
            lineTo(14f, 5f)
            moveTo(12f, 5f)
            lineTo(12f, 14f)
            moveTo(12f, 14f)
            curveTo(10.3f, 14f, 9f, 15.3f, 9f, 17f)
            curveTo(9f, 18.7f, 10.3f, 20f, 12f, 20f)
            curveTo(13.7f, 20f, 15f, 18.7f, 15f, 17f)
            curveTo(15f, 15.3f, 13.7f, 14f, 12f, 14f)
            close()
        }

    /** lucide `activity` — the State cell (the cardiac-pulse line). */
    val Activity: ImageVector =
        stroked("QuickStatsGridActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STATE =
    QuickStatsVehicleState(
        batteryLevel = 72.0,
        ratedRangeMeters = 412_000.0,
        odometerMeters = 18_000_000.0,
        speedMps = 27.0,
        insideTempCelsius = 21.5,
        outsideTempCelsius = 9.0,
        power = 85.0,
    )

@Preview(name = "Resolved — eight-cell grid", showBackground = true, widthDp = 420)
@Composable
private fun QuickStatsGridResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = quickStatsGridStrings()
        QuickStatsGridContent(
            display =
                QuickStatsGridProjection.project(
                    state = PREVIEW_STATE,
                    status = "driving",
                    prefs = UnitFormatter.default().prefs,
                    strings = strings,
                    loading = false,
                    locale = resolveDisplayLocale(null),
                ),
            strings = strings,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun QuickStatsGridLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = quickStatsGridStrings()
        QuickStatsGridContent(
            display = QuickStatsGridDisplay(loading = true, hasData = false, cards = emptyList()),
            strings = strings,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun QuickStatsGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = quickStatsGridStrings()
        QuickStatsGridContent(
            display = QuickStatsGridDisplay(loading = false, hasData = false, cards = emptyList()),
            strings = strings,
        )
    }
}
