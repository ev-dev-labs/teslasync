// The native Jetpack Compose + Material 3 TemperatureMetricCards feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx. The web component
// renders a `StaggerContainer` responsive grid (Tailwind `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`) of
// `MetricCard`s: one per temperature sensor (value + percent-of-max subtitle, or an em-dash + "No data" when
// the reading is absent), then a Health Score tile and a Peak Power tile. This port keeps that contract: the
// grid reflows at the web `sm` (640dp → 3 cols) and `lg` (1024dp → 6 cols) breakpoints from a 2-col base,
// each card carries an accessible merged label and never collapses to a blank box, and the cards animate in
// with the shared stagger (web `StaggerContainer` + `StaggerItem`). A skeleton branch (opt-in `loading` flag
// the owning Drivetrain Health page threads) preserves the loading affordance the page's query implies; its
// default (`false`) is the web's exact contract. When no sensor is present the surface renders a friendly
// empty state rather than the lone Health/Peak tiles, mirroring the page's `health ? … : <EmptyState/>` gate.
//
// Every derivation flows through the pure [TemperatureMetricCardsProjection]; the composable is a thin render
// layer that binds the two web data sources — `useTranslation` (the generated i18n catalog, P1/S10) and
// `useUnits` (the live temperature display preference + locale from the data container, P1/S8) — and records
// the one-shot `view.opened` diagnostic (P1/S11) on first composition. The four card strings the component
// owns plus the loading announcement all resolve through the catalog (`drivetrain.*` + `a11y.loading` keys);
// there is no English literal in the shipped composables (sensor labels arrive resolved from the host,
// exactly as the web parent passes its built `sensors` array in).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TemperatureMetricCards) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturemetriccards

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
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the cards lay out six-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 6
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The full card set at the `lg` breakpoint (four sensors + Health Score + Peak Power) sizes the skeleton. */
private const val LOADING_TILE_COUNT: Int = 6

/** Each loading tile mirrors a resolved MetricCard's height so the skeleton grid does not jump on resolve. */
private val SKELETON_HEIGHT: Dp = 88.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web
 * `TemperatureMetricCards({ sensors, overallHealth, healthScore, peakPower })`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), reads the live unit preference + locale from the
 * data container (web `useUnits`, P1/S8), projects the props onto a [TemperatureMetricCardsDisplay] via the
 * pure [TemperatureMetricCardsProjection], and renders.
 *
 * @param sensors the temperature sensors the owning page builds (web `sensors`); each carries a resolved
 *   label, an SI-Celsius reading (or `null`), a rated max, and a glyph.
 * @param overallHealth the drivetrain health status driving the Health Score tile's accent (web `overallHealth`).
 * @param healthScore the 0..100 score shown on the Health Score tile (web `healthScore`).
 * @param peakPowerKw the peak power in kilowatts shown on the Peak Power tile (web `peakPower`).
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TemperatureMetricCards(
    sensors: List<TempSensor>,
    overallHealth: DrivetrainHealthStatus,
    healthScore: Int,
    peakPowerKw: Double,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TemperatureMetricCardsDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val strings = temperatureMetricCardsStrings()
    val display =
        remember(sensors, overallHealth, healthScore, peakPowerKw, loading, prefs, strings) {
            TemperatureMetricCardsProjection.project(
                sensors = sensors,
                overallHealth = overallHealth,
                healthScore = healthScore,
                peakPowerKw = peakPowerKw,
                prefs = prefs,
                strings = strings,
                loading = loading,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    TemperatureMetricCardsContent(display = display, strings = strings, modifier = modifier)
}

/**
 * Resolves the four card strings this surface owns plus the loading announcement from the generated catalog
 * (P1/S10). Exposed so the stateful entry, the previews, and any host share one source of strings.
 */
@Composable
fun temperatureMetricCardsStrings(): TemperatureMetricCardsStrings =
    TemperatureMetricCardsStrings(
        ofMax = stringResource(R.string.translation_drivetrain_ofMax),
        noData = stringResource(R.string.translation_drivetrain_noData),
        healthScore = stringResource(R.string.translation_drivetrain_healthScore),
        peakPower = stringResource(R.string.translation_drivetrain_peakPower),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Renders the skeleton grid while
 * [TemperatureMetricCardsDisplay.loading] is true (the page-implied loading), the card grid when a sensor
 * exists, or the empty state otherwise. Every card is always present and carries an accessible merged label,
 * so no surface is ever hidden or blank.
 */
@Composable
fun TemperatureMetricCardsContent(
    display: TemperatureMetricCardsDisplay,
    strings: TemperatureMetricCardsStrings,
    modifier: Modifier = Modifier,
) {
    when {
        display.loading -> TemperatureMetricsLoadingGrid(loadingLabel = strings.loadingLabel, modifier = modifier)
        display.hasData -> TemperatureMetricsGrid(cards = display.cards, modifier = modifier)
        else -> EmptyState(message = strings.noData, modifier = modifier)
    }
}

/**
 * The resolved branch — the cards in the web responsive stagger grid. Each card fills its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so the cards keep a uniform
 * width. Cells are spaced by `Spacing.md`, the native expression of the web `gap-3`, and each card is wrapped
 * in a [StaggerItem] so siblings animate in sequence (web `StaggerContainer` + `StaggerItem`).
 */
@Composable
private fun TemperatureMetricsGrid(
    cards: List<TemperatureMetricCard>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        StaggerContainer(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEachIndexed { rowIndex, rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEachIndexed { colIndex, card ->
                        StaggerItem(index = rowIndex * columns + colIndex, modifier = Modifier.weight(1f)) {
                            TemperatureMetric(card = card, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single card: the web `<MetricCard label value subtitle icon color />` with a merged TalkBack label. */
@Composable
private fun TemperatureMetric(
    card: TemperatureMetricCard,
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
 * The loading branch — [LOADING_TILE_COUNT] skeleton tiles in the same responsive grid as the resolved
 * cards. The grid carries a single TalkBack "Loading" content description so the loading state is announced
 * rather than read as several empty boxes.
 */
@Composable
private fun TemperatureMetricsLoadingGrid(
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

/** Resolves the responsive column count from the available [width] (web `grid-cols-2 sm:3 lg:6`). */
private fun columnsFor(width: Dp): Int =
    when {
        width >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
        width >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
        else -> GRID_COLUMNS_BASE
    }

/** Maps a card's accent identity onto the active theme tokens (web neon `green`/`amber`/`red`/`purple`). */
@Composable
private fun accentFor(color: TemperatureMetricColor): Color =
    when (color) {
        TemperatureMetricColor.Green -> TeslaTokens.status.success
        TemperatureMetricColor.Amber -> TeslaTokens.status.warning
        TemperatureMetricColor.Red -> TeslaTokens.status.danger
        TemperatureMetricColor.Purple -> TeslaTokens.chart.power
    }

/** Maps a card's glyph identity onto the hand-authored lucide [ImageVector]. */
private fun glyphFor(icon: TemperatureMetricIcon): ImageVector =
    when (icon) {
        TemperatureMetricIcon.Motor -> TemperatureMetricCardsGlyphs.Zap
        TemperatureMetricIcon.Inverter -> TemperatureMetricCardsGlyphs.Cpu
        TemperatureMetricIcon.Battery -> TemperatureMetricCardsGlyphs.BatteryCharging
        TemperatureMetricIcon.Heart -> TemperatureMetricCardsGlyphs.Heart
        TemperatureMetricIcon.Power -> TemperatureMetricCardsGlyphs.Zap
    }

/**
 * The four lucide glyphs the cards need. The web uses `lucide-react` (`Zap`, `Cpu`, `BatteryCharging`,
 * `Heart`); Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly
 * as the sibling surfaces do for their lucide ports — each is authored here as a 24×24 round-capped stroked
 * vector faithful to the lucide shape, recolored at render time by `MetricCard`'s accent tint.
 */
private object TemperatureMetricCardsGlyphs {
    /** lucide `zap` — a lightning bolt (motor sensors + the Peak Power tile). */
    val Zap: ImageVector =
        stroked("TemperatureMetricCardsZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `cpu` — a processor outline, inner die, and eight edge pins (the inverter sensor). */
    val Cpu: ImageVector =
        stroked("TemperatureMetricCardsCpu") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(9f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 15f)
            lineTo(9f, 15f)
            close()
            moveTo(9f, 2f)
            lineTo(9f, 4f)
            moveTo(15f, 2f)
            lineTo(15f, 4f)
            moveTo(9f, 20f)
            lineTo(9f, 22f)
            moveTo(15f, 20f)
            lineTo(15f, 22f)
            moveTo(2f, 9f)
            lineTo(4f, 9f)
            moveTo(2f, 15f)
            lineTo(4f, 15f)
            moveTo(20f, 9f)
            lineTo(22f, 9f)
            moveTo(20f, 15f)
            lineTo(22f, 15f)
        }

    /** lucide `battery-charging` — a battery body, terminal, and inner bolt (the battery sensor). */
    val BatteryCharging: ImageVector =
        stroked("TemperatureMetricCardsBatteryCharging") {
            moveTo(3f, 8f)
            lineTo(15f, 8f)
            lineTo(15f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(18f, 11f)
            lineTo(18f, 13f)
            moveTo(9.5f, 9.5f)
            lineTo(6.5f, 12.5f)
            lineTo(9f, 12.5f)
            lineTo(8f, 15f)
        }

    /** lucide `heart` — the Health Score tile accent. */
    val Heart: ImageVector =
        stroked("TemperatureMetricCardsHeart") {
            moveTo(12f, 21f)
            lineTo(10.55f, 19.7f)
            curveTo(5.4f, 15.1f, 2f, 12.1f, 2f, 8.5f)
            curveTo(2f, 5.4f, 4.4f, 3f, 7.5f, 3f)
            curveTo(9.2f, 3f, 10.9f, 3.8f, 12f, 5.1f)
            curveTo(13.1f, 3.8f, 14.8f, 3f, 16.5f, 3f)
            curveTo(19.6f, 3f, 22f, 5.4f, 22f, 8.5f)
            curveTo(22f, 12.1f, 18.6f, 15.1f, 13.45f, 19.7f)
            close()
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

private fun previewSensors(): List<TempSensor> =
    listOf(
        TempSensor(label = "Front Motor", value = 82.0, maxTemp = 150.0, icon = TemperatureMetricIcon.Motor),
        TempSensor(label = "Rear Motor", value = 104.0, maxTemp = 150.0, icon = TemperatureMetricIcon.Motor),
        TempSensor(label = "Inverter", value = 108.0, maxTemp = 120.0, icon = TemperatureMetricIcon.Inverter),
        TempSensor(label = "Battery", value = null, maxTemp = 60.0, icon = TemperatureMetricIcon.Battery),
    )

@Preview(name = "Resolved — sensors + health + peak", showBackground = true, widthDp = 720)
@Composable
private fun TemperatureMetricCardsResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = temperatureMetricCardsStrings()
        TemperatureMetricCardsContent(
            display =
                TemperatureMetricCardsProjection.project(
                    sensors = previewSensors(),
                    overallHealth = DrivetrainHealthStatus.Warning,
                    healthScore = 60,
                    peakPowerKw = 187.0,
                    prefs = UnitFormatter.default().prefs,
                    strings = strings,
                    loading = false,
                    locale = resolveDisplayLocale(null),
                ),
            strings = strings,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 720)
@Composable
private fun TemperatureMetricCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = temperatureMetricCardsStrings()
        TemperatureMetricCardsContent(
            display = TemperatureMetricCardsDisplay(loading = true, hasData = false, cards = emptyList()),
            strings = strings,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 720)
@Composable
private fun TemperatureMetricCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val strings = temperatureMetricCardsStrings()
        TemperatureMetricCardsContent(
            display = TemperatureMetricCardsDisplay(loading = false, hasData = false, cards = emptyList()),
            strings = strings,
        )
    }
}
