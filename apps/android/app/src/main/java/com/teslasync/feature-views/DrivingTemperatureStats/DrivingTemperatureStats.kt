// The native Jetpack Compose + Material 3 DrivingTemperatureStats feature view — a parity port of
// web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx. The web component renders a
// `GlassPanel` with a section title and, when an inside or outside cabin/ambient temperature reading exists,
// a responsive grid of six `MetricCard`s (Inside/Outside × Min/Avg/Max); otherwise a friendly `EmptyState`
// ("No temperature stats"). This port keeps that contract: the panel + title always render, the six cards
// each carry an accessible label + value + unit subtitle and never collapse to a blank box, and the grid
// reflows at the web Tailwind `md` (768dp -> 3 cols) and `lg` (1024dp -> 6 cols) breakpoints from a 2-col
// base. A skeleton branch (opt-in `loading` flag the owning analytics page threads) preserves the loading
// affordance the page's `useFleetAnalytics` query implies; its default (`false`) is the web's exact contract.
//
// Every derivation flows through the pure [DrivingTemperatureStatsProjection]; the composable is a thin
// render layer that binds the two web data sources — `useTranslation` (the generated i18n catalog, P1/S10)
// and `useUnits` (the live temperature display preference + locale from the data container, P1/S8) — and
// records the one-shot `view.opened` diagnostic (P1/S11) on first composition. The card labels, the empty
// message, and the loading announcement all resolve through the catalog (`analytics.driving.*` + `a11y.*`
// keys); there is no English literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingTemperatureStats) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtemperaturestats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the six cards lay out in a single row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `md` breakpoint (768px): at or above this width the cards lay out three-per-row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

private const val GRID_COLUMNS_LG: Int = 6
private const val GRID_COLUMNS_MD: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** The six temperature tiles (Inside/Outside × Min/Avg/Max), matching the web component's fixed card set. */
private const val CARD_COUNT: Int = 6

/** Each loading tile mirrors a resolved MetricCard's height so the skeleton grid does not jump on resolve. */
private val SKELETON_HEIGHT: Dp = 88.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `DrivingTemperatureStats({ data })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live unit preference + locale
 * from the data container (web `useUnits`, P1/S8), projects the [temperature] reading onto a
 * [DrivingTemperatureStatsDisplay] via the pure [DrivingTemperatureStatsProjection], and renders.
 *
 * @param temperature the inside/outside reading the owning Driving tab extracts from its `FleetAnalytics`
 *   query (web `data?.drive_analytics?.temperature`), or `null` when the analytics payload has none.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingTemperatureStats(
    temperature: DrivingTemperature?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingTemperatureStatsDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val display =
        remember(temperature, loading, prefs.temperature, prefs.locale) {
            DrivingTemperatureStatsProjection.project(
                temperature = temperature,
                loading = loading,
                tempUnit = prefs.temperature,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    DrivingTemperatureStatsContent(
        display = display,
        strings = drivingTemperatureStatsStrings(),
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful
 * entry, the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun drivingTemperatureStatsStrings(): DrivingTemperatureStatsStrings =
    DrivingTemperatureStatsStrings(
        title = stringResource(R.string.translation_analytics_driving_tempStats),
        insideMin = stringResource(R.string.translation_analytics_driving_insideMin),
        insideAvg = stringResource(R.string.translation_analytics_driving_insideAvg),
        insideMax = stringResource(R.string.translation_analytics_driving_insideMax),
        outsideMin = stringResource(R.string.translation_analytics_driving_outsideMin),
        outsideAvg = stringResource(R.string.translation_analytics_driving_outsideAvg),
        outsideMax = stringResource(R.string.translation_analytics_driving_outsideMax),
        noData = stringResource(R.string.translation_analytics_driving_noTempStats),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + section title;
 * then the skeleton grid while [DrivingTemperatureStatsDisplay.loading] is true (web's parent-implied
 * loading), the six MetricCards when a reading exists (web `insideTemp || outsideTemp`), or the empty state
 * otherwise. Every card is always present and carries an accessible label, value, and unit subtitle, so no
 * surface is ever hidden or blank.
 */
@Composable
fun DrivingTemperatureStatsContent(
    display: DrivingTemperatureStatsDisplay,
    strings: DrivingTemperatureStatsStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        SectionTitle(strings.title)
        Spacer(modifier = Modifier.height(Spacing.md))
        when {
            display.loading -> TemperatureLoadingGrid(loadingLabel = strings.loadingLabel)
            display.hasData -> TemperatureGrid(display = display, strings = strings)
            else -> EmptyState(message = strings.noData)
        }
    }
}

/**
 * The resolved branch — six MetricCards in the responsive grid. The min/avg/max accents reproduce the web
 * `color="cyan" | "green" | "amber"` props via the semantic design tokens (info / success / warning), and
 * each card's subtitle is the unit symbol (web `subtitle={tempUnit}`).
 */
@Composable
private fun TemperatureGrid(
    display: DrivingTemperatureStatsDisplay,
    strings: DrivingTemperatureStatsStrings,
) {
    val cyan = TeslaTokens.status.info
    val green = TeslaTokens.status.success
    val amber = TeslaTokens.status.warning
    val unit = display.unitLabel
    val cards =
        listOf<@Composable (Modifier) -> Unit>(
            { cardModifier -> TemperatureCard(strings.insideMin, display.insideMin, unit, cyan, cardModifier) },
            { cardModifier -> TemperatureCard(strings.insideAvg, display.insideAvg, unit, green, cardModifier) },
            { cardModifier -> TemperatureCard(strings.insideMax, display.insideMax, unit, amber, cardModifier) },
            { cardModifier -> TemperatureCard(strings.outsideMin, display.outsideMin, unit, cyan, cardModifier) },
            { cardModifier -> TemperatureCard(strings.outsideAvg, display.outsideAvg, unit, green, cardModifier) },
            { cardModifier -> TemperatureCard(strings.outsideMax, display.outsideMax, unit, amber, cardModifier) },
        )
    TemperatureResponsiveGrid(cards = cards)
}

/** A single temperature MetricCard: the web `<MetricCard label value subtitle icon color />`. */
@Composable
private fun TemperatureCard(
    label: String,
    value: String,
    unit: String,
    accent: Color,
    modifier: Modifier,
) {
    MetricCard(
        label = label,
        value = value,
        subtitle = unit,
        icon = DrivingTemperatureStatsGlyphs.Thermometer,
        accent = accent,
        modifier = modifier,
    )
}

/**
 * The loading branch — six skeleton tiles in the same responsive grid as the resolved cards. The grid
 * carries a single TalkBack "Loading" content description so the loading state is announced rather than read
 * as six empty boxes.
 */
@Composable
private fun TemperatureLoadingGrid(loadingLabel: String) {
    val skeleton: @Composable (Modifier) -> Unit = { cardModifier ->
        Skeleton(modifier = cardModifier, height = SKELETON_HEIGHT)
    }
    TemperatureResponsiveGrid(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        cards = List(CARD_COUNT) { skeleton },
    )
}

/**
 * Lays out the [cards] as the web responsive grid: six-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:6`),
 * three-per-row at or above [GRID_MD_MIN_WIDTH] (`md:3`), and two-per-row below it (`default:2`). Each card
 * fills its column via [Modifier.weight]; a partial trailing row is padded with weighted spacers so the
 * cards keep a uniform width. Cells are spaced by `Spacing.md`, the native expression of the web `gap-3`.
 */
@Composable
private fun TemperatureResponsiveGrid(
    cards: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
                else -> GRID_COLUMNS_BASE
            }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card -> card(Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The Thermometer glyph this surface needs. The web uses lucide `Thermometer`; Android ships no equivalent
 * without the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their
 * lucide ports — it is authored here as a 24×24 stroked vector (a stem with a rounded bulb) faithful to the
 * lucide shape.
 */
private object DrivingTemperatureStatsGlyphs {
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 2.5f)
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

    /** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (the bulb). */
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Resolved — °C", showBackground = true)
@Composable
private fun DrivingTemperatureStatsResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTemperatureStatsContent(
            display =
                DrivingTemperatureStatsDisplay(
                    loading = false,
                    hasData = true,
                    unitLabel = "\u00B0C",
                    insideMin = "18.5",
                    insideAvg = "21.0",
                    insideMax = "24.3",
                    outsideMin = "9.1",
                    outsideAvg = "14.6",
                    outsideMax = "22.8",
                ),
            strings = drivingTemperatureStatsStrings(),
        )
    }
}

@Preview(name = "Resolved — °F (single absent reading)", showBackground = true)
@Composable
private fun DrivingTemperatureStatsFahrenheitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTemperatureStatsContent(
            display =
                DrivingTemperatureStatsDisplay(
                    loading = false,
                    hasData = true,
                    unitLabel = "\u00B0F",
                    insideMin = "65.3",
                    insideAvg = "69.8",
                    insideMax = "75.7",
                    outsideMin = EM_DASH,
                    outsideAvg = EM_DASH,
                    outsideMax = EM_DASH,
                ),
            strings = drivingTemperatureStatsStrings(),
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingTemperatureStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTemperatureStatsContent(
            display =
                DrivingTemperatureStatsDisplay(
                    loading = true,
                    hasData = false,
                    unitLabel = "\u00B0C",
                    insideMin = EM_DASH,
                    insideAvg = EM_DASH,
                    insideMax = EM_DASH,
                    outsideMin = EM_DASH,
                    outsideAvg = EM_DASH,
                    outsideMax = EM_DASH,
                ),
            strings = drivingTemperatureStatsStrings(),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingTemperatureStatsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTemperatureStatsContent(
            display =
                DrivingTemperatureStatsDisplay(
                    loading = false,
                    hasData = false,
                    unitLabel = "\u00B0C",
                    insideMin = EM_DASH,
                    insideAvg = EM_DASH,
                    insideMax = EM_DASH,
                    outsideMin = EM_DASH,
                    outsideAvg = EM_DASH,
                    outsideMax = EM_DASH,
                ),
            strings = drivingTemperatureStatsStrings(),
        )
    }
}
