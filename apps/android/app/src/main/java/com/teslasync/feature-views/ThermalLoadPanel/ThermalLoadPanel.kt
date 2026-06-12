// The native Jetpack Compose + Material 3 ThermalLoadPanel feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx. The web component renders a
// `GlassPanel` with an Activity-icon "Thermal Load Indicators" header over a stack of `MetricBar`s (one per
// drivetrain thermal sensor: each bar fills `value/maxTemp`, is tinted by `tempSeverityColor`, and shows the
// formatted temperature beside it) followed by a responsive 2 / 4-column grid of four `InlineMetric`s (peak
// power, average power, drive count, regen ratio). This port keeps that contract: the panel + header always
// render, every bar/metric is present with a real value (or an em dash, never a blank box), and the grid
// reflows at the web Tailwind `sm` (640dp -> 4 cols) breakpoint from a 2-col base. The resolved body fades in
// exactly as the web `<FadeIn delay={0.2}>` wrapper does.
//
// Every derivation flows through the pure [ThermalLoadPanelProjection]; the composable is a thin render layer
// that binds the two web data sources — `useTranslation` (the generated i18n catalog, P1/S10) and `useUnits`
// (the live temperature preference + locale from the data container, P1/S8) — and records the one-shot
// `view.opened` diagnostic (P1/S11) on first composition. The header, the four metric labels, the empty
// message, and the loading announcement all resolve through the catalog (`drivetrain.*` + `common.*` + `a11y.*`
// keys); there is no English literal in this file. The sensor accents map the web `tempSeverityColor` hues onto
// the semantic status palette (good -> success, warning -> warning, critical -> danger, unknown -> muted), so
// light / dark / high-contrast all stay consistent (P1/S9).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ThermalLoadPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.thermalloadpanel

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
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
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

/** Web Tailwind `sm` breakpoint (640px): at or above this width the four metrics lay out four-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_WIDE: Int = 4
private const val GRID_COLUMNS_BASE: Int = 2

/** Web `<FadeIn delay={0.2}>` — the resolved body fades in after a 200ms delay. */
private const val FADE_DELAY_MS: Int = 200

/** Skeleton bars shown while loading — one per typical drivetrain sensor (front/rear motor, inverter, battery). */
private const val SKELETON_BAR_COUNT: Int = 4

/** Skeleton metric tiles shown while loading — one per resolved InlineMetric. */
private const val SKELETON_METRIC_COUNT: Int = 4

/** Each loading bar mirrors a resolved MetricBar's footprint (label row + 8dp track) so resolve does not jump. */
private val SKELETON_BAR_HEIGHT: Dp = 28.dp

/** Each loading metric tile mirrors a resolved InlineMetric's height. */
private val SKELETON_METRIC_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `ThermalLoadPanel({ sensors, peakPower, avgPowerMax,
 * stats })`. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live unit
 * preference + locale from the data container (web `useUnits`, P1/S8), projects the inputs onto a
 * [ThermalLoadDisplay] via the pure [ThermalLoadPanelProjection], and renders.
 *
 * @param sensors the drivetrain thermal sensors the owning page extracts from its drivetrain query.
 * @param peakPowerW the peak drive power in SI watts (web `peakPower`), or `null` when unavailable.
 * @param avgPowerW the average drive power in SI watts (web `avgPowerMax`), or `null` when unavailable.
 * @param stats the lifetime driving stats summary (web `stats`), or `null` when absent.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ThermalLoadPanel(
    sensors: List<ThermalSensor>,
    peakPowerW: Double?,
    avgPowerW: Double?,
    stats: DrivingStatsSummary?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ThermalLoadPanelDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val inputs = ThermalLoadInputs(sensors = sensors, peakPowerW = peakPowerW, avgPowerW = avgPowerW, stats = stats)
    val display =
        remember(inputs, loading, prefs) {
            ThermalLoadPanelProjection.project(
                inputs = inputs,
                loading = loading,
                prefs = prefs,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    ThermalLoadPanelContent(display = display, strings = thermalLoadPanelStrings(), modifier = modifier)
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful entry,
 * the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun thermalLoadPanelStrings(): ThermalLoadPanelStrings =
    ThermalLoadPanelStrings(
        title = stringResource(R.string.translation_drivetrain_thermalMetrics),
        peakPower = stringResource(R.string.translation_drivetrain_peakPower),
        avgPower = stringResource(R.string.translation_drivetrain_avgPower),
        drives = stringResource(R.string.translation_drivetrain_drivesLabel),
        regenRatio = stringResource(R.string.translation_drivetrain_regenRatio),
        noData = stringResource(R.string.translation_common_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * The localized labels this surface resolves once (P1/S10) and hands to the renderer. Keeping the strings
 * injectable lets the stateless content composable be exercised in a UI test without a resources host.
 *
 * @property title the panel heading (`drivetrain.thermalMetrics`, "Thermal Load Indicators").
 * @property peakPower the peak-power metric label (`drivetrain.peakPower`, "Peak Power").
 * @property avgPower the average-power metric label (`drivetrain.avgPower`, "Avg Power").
 * @property drives the drive-count metric label (`drivetrain.drivesLabel`, "Drives").
 * @property regenRatio the regen-ratio metric label (`drivetrain.regenRatio`, "Regen Ratio").
 * @property noData the empty-state message (`common.noData`, "No data available").
 * @property loadingLabel the TalkBack announcement for the skeleton chrome (`a11y.loading`, "Loading").
 */
data class ThermalLoadPanelStrings(
    val title: String,
    val peakPower: String,
    val avgPower: String,
    val drives: String,
    val regenRatio: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + Activity header;
 * then the skeleton chrome while [ThermalLoadDisplay.loading] is true (web's parent-implied loading), a friendly
 * empty state when there is nothing to show, or the resolved bars + metrics body otherwise. No surface is ever
 * hidden or blank.
 */
@Composable
fun ThermalLoadPanelContent(
    display: ThermalLoadDisplay,
    strings: ThermalLoadPanelStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        ThermalLoadHeader(title = strings.title)
        Spacer(modifier = Modifier.height(Spacing.lg))
        when {
            display.loading -> ThermalLoadLoading(loadingLabel = strings.loadingLabel)
            !display.hasContent -> EmptyState(message = strings.noData)
            else -> FadeIn(delayMs = FADE_DELAY_MS) { ThermalLoadBody(display = display, strings = strings) }
        }
    }
}

/**
 * The panel header — the web `<h3>` with its Activity icon and the "Thermal Load Indicators" title. The icon
 * is decorative (the title carries the accessible name), tinted with the muted on-surface color to mirror the
 * web `text-[var(--text-muted)]` heading.
 */
@Composable
private fun ThermalLoadHeader(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            ThermalLoadPanelGlyphs.Activity,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionTitle(title)
    }
}

/**
 * The resolved body — the web `<div className="space-y-4">` bar stack (rendered only when sensors exist) over
 * the `mt-6 grid grid-cols-2 sm:grid-cols-4` metrics grid. The metrics always render (the four web
 * InlineMetrics), so the body is never empty when [ThermalLoadDisplay.hasContent] is true.
 */
@Composable
private fun ThermalLoadBody(
    display: ThermalLoadDisplay,
    strings: ThermalLoadPanelStrings,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        if (display.bars.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                display.bars.forEach { bar -> ThermalSensorBar(bar) }
            }
            Spacer(modifier = Modifier.height(Spacing.xl2))
        }
        ThermalMetricsGrid(metrics = display.metrics, strings = strings)
    }
}

/** A single sensor row — the web `<MetricBar value max color sublabel />` tinted by its severity bucket. */
@Composable
private fun ThermalSensorBar(bar: ThermalBar) {
    MetricBar(
        value = bar.value,
        max = bar.maxTemp,
        label = bar.label,
        valueText = bar.readout,
        color = severityColor(bar.severity),
    )
}

/**
 * The four InlineMetrics in the web responsive grid: four-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:4`) and
 * two-per-row below it (`default:2`). Each cell fills its column via [Modifier.weight]; a partial trailing row
 * is padded with weighted spacers so cells keep a uniform width. Cells are spaced by `Spacing.lg` (web `gap-4`).
 */
@Composable
private fun ThermalMetricsGrid(
    metrics: List<ThermalInlineMetric>,
    strings: ThermalLoadPanelStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_WIDE else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            metrics.chunked(columns).forEach { rowMetrics ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    rowMetrics.forEach { metric -> ThermalMetricCell(metric = metric, strings = strings, modifier = Modifier.weight(1f)) }
                    repeat(columns - rowMetrics.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** One InlineMetric cell — binds the [ThermalMetricKind] to its icon (P1/S9) and localized label (P1/S10). */
@Composable
private fun ThermalMetricCell(
    metric: ThermalInlineMetric,
    strings: ThermalLoadPanelStrings,
    modifier: Modifier = Modifier,
) {
    InlineMetric(
        icon = metricIcon(metric.kind),
        value = metric.value,
        label = metricLabel(metric.kind, strings),
        modifier = modifier,
    )
}

/**
 * The loading branch — skeleton bars over a skeleton metric row, in the resolved layout's shape. The column
 * carries a single TalkBack "Loading" content description so the state is announced rather than read as a stack
 * of empty boxes.
 */
@Composable
private fun ThermalLoadLoading(loadingLabel: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        repeat(SKELETON_BAR_COUNT) { Skeleton(height = SKELETON_BAR_HEIGHT) }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            repeat(SKELETON_METRIC_COUNT) { Skeleton(modifier = Modifier.weight(1f), height = SKELETON_METRIC_HEIGHT) }
        }
    }
}

/** Maps a metric kind to its glyph — web `Zap` / `TrendingUp` / `Activity` / `Shield`. */
private fun metricIcon(kind: ThermalMetricKind): ImageVector =
    when (kind) {
        ThermalMetricKind.PeakPower -> ThermalLoadPanelGlyphs.Zap
        ThermalMetricKind.AvgPower -> ThermalLoadPanelGlyphs.TrendingUp
        ThermalMetricKind.Drives -> ThermalLoadPanelGlyphs.Activity
        ThermalMetricKind.RegenRatio -> ThermalLoadPanelGlyphs.Shield
    }

/** Maps a metric kind to its localized label (P1/S10). */
private fun metricLabel(
    kind: ThermalMetricKind,
    strings: ThermalLoadPanelStrings,
): String =
    when (kind) {
        ThermalMetricKind.PeakPower -> strings.peakPower
        ThermalMetricKind.AvgPower -> strings.avgPower
        ThermalMetricKind.Drives -> strings.drives
        ThermalMetricKind.RegenRatio -> strings.regenRatio
    }

/**
 * Maps a [ThermalSeverity] onto a semantic design-token color (P1/S9), reproducing the web `tempSeverityColor`
 * hues: good -> success (emerald), warning -> warning (amber), critical -> danger (red), unknown -> the muted
 * on-surface color (web grey).
 */
@Composable
private fun severityColor(severity: ThermalSeverity): Color =
    when (severity) {
        ThermalSeverity.Good -> TeslaTokens.status.success
        ThermalSeverity.Warning -> TeslaTokens.status.warning
        ThermalSeverity.Critical -> TeslaTokens.status.danger
        ThermalSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The glyphs this surface needs. The web uses lucide `Activity` / `Zap` / `TrendingUp` / `Shield`; Android ships
 * no equivalent without the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces do
 * for their lucide ports — they are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object ThermalLoadPanelGlyphs {
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    val Zap: ImageVector =
        stroked("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    val TrendingUp: ImageVector =
        stroked("TrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
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

private val SAMPLE_BARS =
    listOf(
        ThermalBar("frontMotor", "Front Motor", 78.0, 150.0, ThermalSeverity.Good, "78.0\u00B0C"),
        ThermalBar("rearMotor", "Rear Motor", 104.0, 150.0, ThermalSeverity.Warning, "104.0\u00B0C"),
        ThermalBar("inverter", "Inverter", 108.0, 120.0, ThermalSeverity.Critical, "108.0\u00B0C"),
        ThermalBar("battery", "Battery", 0.0, 60.0, ThermalSeverity.Unknown, EM_DASH),
    )

private val SAMPLE_METRICS =
    listOf(
        ThermalInlineMetric(ThermalMetricKind.PeakPower, "247 kW"),
        ThermalInlineMetric(ThermalMetricKind.AvgPower, "118.5 kW"),
        ThermalInlineMetric(ThermalMetricKind.Drives, "1,284"),
        ThermalInlineMetric(ThermalMetricKind.RegenRatio, "18.7%"),
    )

private val EMPTY_METRICS =
    listOf(
        ThermalInlineMetric(ThermalMetricKind.PeakPower, EM_DASH),
        ThermalInlineMetric(ThermalMetricKind.AvgPower, EM_DASH),
        ThermalInlineMetric(ThermalMetricKind.Drives, EM_DASH),
        ThermalInlineMetric(ThermalMetricKind.RegenRatio, EM_DASH),
    )

@Preview(name = "Resolved", showBackground = true)
@Composable
private fun ThermalLoadPanelResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ThermalLoadPanelContent(
            display = ThermalLoadDisplay(loading = false, bars = SAMPLE_BARS, metrics = SAMPLE_METRICS, hasContent = true),
            strings = thermalLoadPanelStrings(),
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ThermalLoadPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ThermalLoadPanelContent(
            display = ThermalLoadDisplay(loading = true, bars = emptyList(), metrics = SAMPLE_METRICS, hasContent = true),
            strings = thermalLoadPanelStrings(),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ThermalLoadPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ThermalLoadPanelContent(
            display = ThermalLoadDisplay(loading = false, bars = emptyList(), metrics = EMPTY_METRICS, hasContent = false),
            strings = thermalLoadPanelStrings(),
        )
    }
}
