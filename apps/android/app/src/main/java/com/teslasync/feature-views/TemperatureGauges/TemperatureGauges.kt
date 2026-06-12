// The native Jetpack Compose + Material 3 TemperatureGauges feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx. The web component wraps a
// `GlassPanel` in a `FadeIn` (delay 0.15s); inside, a section title ("Temperature Gauges", with a Thermometer
// glyph) sits above a responsive grid (`Grid cols={{ default: 2, md: 4 }}`) of one `RadialGauge` per sensor,
// each with a "Max: N°U" caption beneath. This port keeps that contract exactly: the panel + title always
// render, every gauge carries an accessible label + value and never collapses to a blank box, and the grid
// reflows at the web Tailwind `md` (768dp) breakpoint from a 2-col base to 4 columns.
//
// Every derivation flows through the pure [TemperatureGaugesProjection] (see TemperatureGaugesModel.kt); this
// composable is a thin render layer that binds the two web data sources — `useTranslation` (the generated
// i18n catalog, P1/S10: the title + the "Max" caption label) and `useUnits` (the live temperature display
// preference + locale + precision from the shared S8 data container) — maps the web severity hues onto the
// design tokens (P1/S9), and records the one-shot `view.opened` diagnostic (P1/S11) on first composition. The
// sensor labels arrive already-resolved on each [TempSensorInput] (the web reads them from the `sensor` prop
// the owning page supplies), so no English literal lives in this file outside the tooling-only previews.
//
// Web parity has only the resolved branch on this child; the loading / error / stale / offline lifecycle is
// owned by the drive-detail page (a separate surface). Following the shipped DrivingTemperatureStats
// precedent, this port additionally renders a skeleton grid behind an opt-in `loading` flag the owning page
// threads while its query is first in flight, and a friendly empty state when no sensors are present — its
// defaults (`loading = false`, a non-empty list) reproduce the web's exact contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TemperatureGauges) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturegauges

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
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
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref

/** Web RadialGauge size on the drivetrain-health page — matches the sibling drive-detail gauges (110dp). */
private val GAUGE_SIZE: Dp = 110.dp

/** Web Tailwind `md` breakpoint (768px): at or above this width the gauges lay out four-per-row (`md:4`). */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

private const val GRID_COLUMNS_MD: Int = 4
private const val GRID_COLUMNS_BASE: Int = 2

/** Skeleton tiles shown while the owning query is in flight — the standard drivetrain sensor count. */
private const val LOADING_GAUGE_COUNT: Int = 4

/** Web `<FadeIn delay={0.15}>` — 150ms entrance stagger. */
private const val FADE_DELAY_MS: Int = 150

/**
 * Stateful entry point — the faithful 1:1 port of the web `TemperatureGauges({ sensors })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live temperature preference +
 * locale + precision from the shared data container (web `useUnits`, P1/S8), projects the [sensors] onto a
 * [TemperatureGaugesDisplay] via the pure [TemperatureGaugesProjection], and renders inside a [FadeIn].
 *
 * @param sensors the temperature sensors the owning drive-detail page extracts from its drivetrain-health
 *   query (web `sensors` prop); each carries an already-resolved label, an SI Celsius reading (or `null`), and
 *   an SI Celsius ceiling. An empty list renders the friendly empty state, so the surface is never blank.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TemperatureGauges(
    sensors: List<TempSensorInput>,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TemperatureGaugesDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val precision = prefs.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION
    val display =
        remember(sensors, loading, prefs.temperature, precision, prefs.locale) {
            TemperatureGaugesProjection.project(
                sensors = sensors,
                loading = loading,
                tempUnit = prefs.temperature,
                precision = precision,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    FadeIn(delayMs = FADE_DELAY_MS) {
        TemperatureGaugesContent(
            display = display,
            strings = temperatureGaugesStrings(),
            modifier = modifier,
        )
    }
}

/**
 * Resolves the surface's localized strings from the generated catalog (P1/S10). Exposed so the stateful
 * entry, the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun temperatureGaugesStrings(): TemperatureGaugesStrings =
    TemperatureGaugesStrings(
        title = stringResource(R.string.translation_drivetrain_tempGauges),
        maxLabel = stringResource(R.string.translation_drivetrain_maxLabel),
        noData = stringResource(R.string.translation_drivetrain_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + the titled
 * header; then the skeleton grid while [TemperatureGaugesDisplay.loading] is true (the owning page's implied
 * loading), the gauge grid when at least one sensor exists, or the empty state otherwise. Every gauge is
 * always present and carries an accessible label + value, so no surface is ever hidden or blank.
 */
@Composable
fun TemperatureGaugesContent(
    display: TemperatureGaugesDisplay,
    strings: TemperatureGaugesStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        TemperatureGaugesHeader(title = strings.title)
        Spacer(modifier = Modifier.height(Spacing.md))
        when {
            display.loading -> TemperatureLoadingGrid(loadingLabel = strings.loadingLabel)
            display.hasData -> TemperatureGaugeGrid(gauges = display.gauges, maxLabel = strings.maxLabel)
            else -> EmptyState(message = strings.noData, icon = TemperatureGaugesGlyphs.Thermometer)
        }
    }
}

/** The panel heading — the web `<h3><Thermometer/> {title}</h3>` rendered as a Thermometer glyph + title. */
@Composable
private fun TemperatureGaugesHeader(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = TemperatureGaugesGlyphs.Thermometer,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionTitle(title)
    }
}

/**
 * The resolved branch — one [RadialGauge] per sensor in the responsive grid, each above its "Max: N°U"
 * caption. The severity accent reproduces the web `tempSeverityColor` hue via the semantic design tokens, and
 * the value renders at the gauge's [TempGauge.decimals] exactly as the web RadialGauge does.
 */
@Composable
private fun TemperatureGaugeGrid(
    gauges: List<TempGauge>,
    maxLabel: String,
) {
    val cells =
        gauges.map { gauge ->
            @Composable { cellModifier: Modifier ->
                TemperatureGaugeCell(gauge = gauge, maxLabel = maxLabel, modifier = cellModifier)
            }
        }
    TemperatureResponsiveGrid(cells = cells)
}

/** A single gauge tile: the RadialGauge above the localized "Max: N°U" caption (web `flex flex-col items-center`). */
@Composable
private fun TemperatureGaugeCell(
    gauge: TempGauge,
    maxLabel: String,
    modifier: Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = gauge.value,
            max = gauge.max,
            label = gauge.label,
            unit = gauge.unit,
            color = tempGaugeColor(gauge.accent),
            size = GAUGE_SIZE,
            decimals = gauge.decimals,
        )
        Caption("$maxLabel: ${gauge.maxValueLabel}")
    }
}

/**
 * The loading branch — [LOADING_GAUGE_COUNT] gauge-sized skeleton tiles in the same responsive grid as the
 * resolved gauges. The grid carries a single TalkBack "Loading" content description so the loading state is
 * announced rather than read as several empty boxes.
 */
@Composable
private fun TemperatureLoadingGrid(loadingLabel: String) {
    val skeleton: @Composable (Modifier) -> Unit = { cellModifier ->
        Skeleton(modifier = cellModifier, height = GAUGE_SIZE, rounded = true)
    }
    TemperatureResponsiveGrid(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        cells = List(LOADING_GAUGE_COUNT) { skeleton },
    )
}

/**
 * Lays out the [cells] as the web responsive grid: four-per-row at or above [GRID_MD_MIN_WIDTH] (`md:4`) and
 * two-per-row below it (`default:2`). Each cell fills its column via [Modifier.weight]; a partial trailing row
 * is padded with weighted spacers so the gauges keep a uniform column width. Cells are spaced by `Spacing.lg`,
 * the native expression of the web `gap={6}`.
 */
@Composable
private fun TemperatureResponsiveGrid(
    cells: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            cells.chunked(columns).forEach { rowCells ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    rowCells.forEach { cell -> cell(Modifier.weight(1f)) }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Maps a [TempGaugeAccent] to a design-token color (P1/S9). The web `tempSeverityColor` hexes map onto the
 * semantic palette: good `#10b981` -> the success token, warning `#f59e0b` -> the warning token, critical
 * `#ef4444` -> the danger token, and the null-reading grey `#6b7280` -> the muted `onSurfaceVariant` role — so
 * no raw hex or Tailwind class survives into the view, and the accent tracks the active theme.
 */
@Composable
private fun tempGaugeColor(accent: TempGaugeAccent): Color =
    when (accent) {
        TempGaugeAccent.Good -> TeslaTokens.status.success
        TempGaugeAccent.Warning -> TeslaTokens.status.warning
        TempGaugeAccent.Critical -> TeslaTokens.status.danger
        TempGaugeAccent.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The Thermometer glyph this surface needs. The web uses lucide `Thermometer`; Android ships no equivalent
 * without the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their
 * lucide ports — it is authored here as a 24×24 stroked vector (a stem with a rounded bulb) faithful to the
 * lucide shape.
 */
private object TemperatureGaugesGlyphs {
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

/** Tooling-only sample sensors covering all four severity accents (good / warning / critical / unknown). */
private val previewSensors =
    listOf(
        TempSensorInput(label = "Front Motor", valueC = 92.0, maxTempC = 150.0),
        TempSensorInput(label = "Rear Motor", valueC = 105.0, maxTempC = 150.0),
        TempSensorInput(label = "Inverter", valueC = 108.0, maxTempC = 120.0),
        TempSensorInput(label = "Battery", valueC = null, maxTempC = 60.0),
    )

private val previewStrings =
    TemperatureGaugesStrings(
        title = "Temperature Gauges",
        maxLabel = "Max",
        noData = "No data",
        loadingLabel = "Loading",
    )

@Preview(name = "Resolved — °C", showBackground = true)
@Composable
private fun TemperatureGaugesCelsiusPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureGaugesContent(
            display =
                TemperatureGaugesProjection.project(
                    sensors = previewSensors,
                    loading = false,
                    tempUnit = TemperatureUnitPref.CELSIUS,
                    precision = DEFAULT_PRECISION,
                    locale = resolveDisplayLocale(null),
                ),
            strings = previewStrings,
        )
    }
}

@Preview(name = "Resolved — °F", showBackground = true)
@Composable
private fun TemperatureGaugesFahrenheitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureGaugesContent(
            display =
                TemperatureGaugesProjection.project(
                    sensors = previewSensors,
                    loading = false,
                    tempUnit = TemperatureUnitPref.FAHRENHEIT,
                    precision = DEFAULT_PRECISION,
                    locale = resolveDisplayLocale(null),
                ),
            strings = previewStrings,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TemperatureGaugesLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureGaugesContent(
            display = TemperatureGaugesDisplay(loading = true, hasData = false, gauges = emptyList()),
            strings = previewStrings,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TemperatureGaugesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureGaugesContent(
            display =
                TemperatureGaugesProjection.project(
                    sensors = emptyList(),
                    loading = false,
                    tempUnit = TemperatureUnitPref.CELSIUS,
                    precision = DEFAULT_PRECISION,
                    locale = resolveDisplayLocale(null),
                ),
            strings = previewStrings,
        )
    }
}
