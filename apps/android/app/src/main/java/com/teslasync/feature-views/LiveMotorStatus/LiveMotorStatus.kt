// The native Jetpack Compose + Material 3 LiveMotorStatus feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx. The web component renders a
// `GlassPanel` titled with a Cog icon and, when a `motorLatest` snapshot exists, a top grid of four summary
// tiles (Shift State, Power, Regen, Source) plus a bottom grid of nine `InlineMetric`s (front/rear axle RPM,
// front/rear torque, four temperatures, and HV isolation), falling back to a friendly `EmptyState`
// ("No live motor telemetry yet") when no snapshot is present. This port keeps that contract: the panel +
// title always render, the top grid reflows 2 → 4 columns at the web `sm` breakpoint and the bottom grid
// 2 → 3 → 4 at the web `sm`/`lg` breakpoints, each summary value and each metric icon carries the web's
// semantic accent (cyan / purple / green / amber / red / the dynamic HV-isolation color) via the design
// tokens, and the empty branch never collapses to a blank box. A skeleton branch (opt-in `loading` flag the
// owning page threads) preserves the loading affordance the page's `/motor/latest` query implies; its
// default (`false`) is the web's exact contract.
//
// Every derivation flows through the pure [LiveMotorStatusProjection]; the composable is a thin render layer
// that binds the two web data sources — `useTranslation` (the generated i18n catalog, P1/S10) and `useUnits`
// (the live temperature display preference + locale + precision from the data container, P1/S8) — and
// records the one-shot `view.opened` diagnostic (P1/S11) on first composition. The title, every label, and
// the empty / loading messages resolve through the catalog (`drivetrain.*` + `a11y.loading` keys); the only
// non-key strings are the unit suffixes the web itself hard-codes (`kW`, `Nm`, `RPM`, `kΩ`) and the em-dash
// fallback, so there is no English UI copy literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveMotorStatus) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livemotorstatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
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

/** Web `<FadeIn delay={0.22}>` → 220ms entry delay. */
private const val LIVE_FADE_DELAY_MS: Int = 220

/** Tailwind `sm` (640px) breakpoint — the web `sm:grid-cols-4` / `sm:grid-cols-3` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Tailwind `lg` (1024px) breakpoint — the web bottom-grid `lg:grid-cols-4` reflow. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

private const val GRID_COLUMNS_BASE: Int = 2
private const val SUMMARY_COLUMNS_SM: Int = 4
private const val METRIC_COLUMNS_SM: Int = 3
private const val METRIC_COLUMNS_LG: Int = 4

/** Loading chrome: tile-height bars for the summary grid, thinner bars for the metric rows. */
private val SKELETON_TILE_HEIGHT: Dp = 64.dp
private val SKELETON_ROW_HEIGHT: Dp = 20.dp
private const val SUMMARY_SKELETON_COUNT: Int = 2
private const val METRIC_SKELETON_COUNT: Int = 4

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveMotorStatus({ motorLatest, isolationResistance
 * })`. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live unit
 * preference + locale from the data container (web `useUnits`, P1/S8), projects the [motor] snapshot +
 * [isolationResistance] onto a [LiveMotorStatusDisplay] via the pure [LiveMotorStatusProjection], and renders.
 *
 * @param motor the latest motor snapshot the owning Drivetrain Health page decodes from its `/motor/latest`
 *   query (web `motorLatest`), or `null` when none is cached — which selects the empty state.
 * @param isolationResistance the HV isolation resistance in kΩ (web `isolationResistance`), or `null` when
 *   unavailable; drives both the HV-isolation value and its health-colored icon.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveMotorStatus(
    motor: MotorLive?,
    isolationResistance: Double?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveMotorStatusDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val display =
        remember(motor, isolationResistance, loading, prefs) {
            LiveMotorStatusProjection.project(
                motor = motor,
                isolationResistance = isolationResistance,
                loading = loading,
                prefs = prefs,
                locale = resolveDisplayLocale(prefs.locale),
            )
        }
    LiveMotorStatusContent(display = display, strings = liveMotorStatusStrings(), modifier = modifier)
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful
 * entry, the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun liveMotorStatusStrings(): LiveMotorStatusStrings =
    LiveMotorStatusStrings(
        title = stringResource(R.string.translation_drivetrain_liveMotor),
        shiftState = stringResource(R.string.translation_drivetrain_shiftState),
        power = stringResource(R.string.translation_drivetrain_power),
        regen = stringResource(R.string.translation_drivetrain_regen),
        source = stringResource(R.string.translation_drivetrain_source),
        rpmFront = stringResource(R.string.translation_drivetrain_rpmFront),
        rpmRear = stringResource(R.string.translation_drivetrain_rpmRear),
        torqueFront = stringResource(R.string.translation_drivetrain_torqueFront),
        torqueRear = stringResource(R.string.translation_drivetrain_torqueRear),
        motorTempFront = stringResource(R.string.translation_drivetrain_motorTempFront),
        motorTempRear = stringResource(R.string.translation_drivetrain_motorTempRear),
        inverterTemp = stringResource(R.string.translation_drivetrain_inverterTemp),
        batteryTemp = stringResource(R.string.translation_drivetrain_batteryTemp),
        isolationResistance = stringResource(R.string.translation_drivetrain_isolationResistance),
        noData = stringResource(R.string.translation_drivetrain_noLiveMotor),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + Cog title;
 * then the skeleton chrome while [LiveMotorStatusDisplay.loading] is true (web's parent-implied loading), the
 * two metric grids when a snapshot exists (web `hasData`), or the empty state otherwise. No surface is ever
 * hidden or blank.
 */
@Composable
fun LiveMotorStatusContent(
    display: LiveMotorStatusDisplay,
    strings: LiveMotorStatusStrings,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier, delayMs = LIVE_FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            MotorHeader(title = strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                display.loading -> LoadingChrome(loadingLabel = strings.loadingLabel)
                display.hasData -> {
                    SummaryGrid(tiles = display.summary, strings = strings)
                    Spacer(modifier = Modifier.height(Spacing.md))
                    MetricsGrid(metrics = display.metrics, strings = strings)
                }
                else -> EmptyState(message = strings.noData)
            }
        }
    }
}

/** The web header row: the Cog icon beside the localized "Live Motor Status" section title. */
@Composable
private fun MotorHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = LiveMotorStatusGlyphs.Cog,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * The top summary grid — the web `Grid cols={{ default: 2, sm: 4 }}`. Picks 4 columns at or above the `sm`
 * breakpoint, else 2, and lays the four tiles out as weighted rows so every tile shares a uniform width.
 */
@Composable
private fun SummaryGrid(
    tiles: List<MotorSummaryTile>,
    strings: LiveMotorStatusStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) SUMMARY_COLUMNS_SM else GRID_COLUMNS_BASE
        ResponsiveCellGrid(columns = columns, items = tiles) { tile, cellModifier ->
            SummaryTileCell(
                label = summaryLabel(tile.key, strings),
                value = tile.value,
                accent = tile.accent,
                modifier = cellModifier,
            )
        }
    }
}

/**
 * One summary tile — the web `rounded-lg border` cell: a centered label over a bold, accent-colored value.
 * The accent color is computed per tile (web `text-{color}-400`), so the value `Text` reads it directly the
 * way the sibling LiveVehicleState cell does.
 */
@Composable
private fun SummaryTileCell(
    label: String,
    value: String,
    accent: MotorAccent,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(label)
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = accentColor(accent),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The bottom metric grid — the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. Picks 4 columns at or above
 * the `lg` breakpoint, 3 at `sm`, else 2, and lays the nine inline metrics out as weighted rows.
 */
@Composable
private fun MetricsGrid(
    metrics: List<MotorMetric>,
    strings: LiveMotorStatusStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> METRIC_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> METRIC_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        ResponsiveCellGrid(columns = columns, items = metrics) { metric, cellModifier ->
            MetricCell(
                icon = metricGlyph(metric.key),
                label = metricLabel(metric.key, strings),
                value = metric.value,
                accent = metric.accent,
                modifier = cellModifier,
            )
        }
    }
}

/**
 * One inline metric — the web `InlineMetric`: an accent-tinted icon, the value, then the label, all
 * lightweight (no card border, muted text). The icon carries the per-metric accent (web `text-{color}-400`
 * / the dynamic HV-isolation color); the label takes the remaining width so a long label wraps rather than
 * truncating the value.
 */
@Composable
private fun MetricCell(
    icon: ImageVector,
    label: String,
    value: String,
    accent: MotorAccent,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = accentColor(accent))
        Caption(value)
        Caption(label, modifier = Modifier.weight(1f))
    }
}

/**
 * The loading branch — a set of skeleton bars (two tile-height, four row-height) carrying a single TalkBack
 * "Loading" content description, so the loading state is announced rather than read as a stack of empty
 * boxes. No metric label leaks while loading.
 */
@Composable
private fun LoadingChrome(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SUMMARY_SKELETON_COUNT) { Skeleton(height = SKELETON_TILE_HEIGHT) }
        repeat(METRIC_SKELETON_COUNT) { Skeleton(height = SKELETON_ROW_HEIGHT) }
    }
}

/**
 * Lays the [items] out as the web responsive grid: [columns]-per-row, each cell filling its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so cells keep a uniform width.
 * Cells are spaced by `Spacing.sm`, the native expression of the web `gap-3`.
 */
@Composable
private fun <T> ResponsiveCellGrid(
    columns: Int,
    items: List<T>,
    modifier: Modifier = Modifier,
    cell: @Composable (T, Modifier) -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item -> cell(item, Modifier.weight(1f)) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/** Resolves a [MotorAccent] to its design-token color so no hex literal leaks into the view. */
@Composable
private fun accentColor(accent: MotorAccent): Color =
    when (accent) {
        MotorAccent.Cyan -> TeslaTokens.status.info
        MotorAccent.Purple -> TeslaTokens.chart.power
        MotorAccent.Green -> TeslaTokens.status.success
        MotorAccent.Amber -> TeslaTokens.status.warning
        MotorAccent.Red -> TeslaTokens.status.danger
        MotorAccent.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
        MotorAccent.Primary -> MaterialTheme.colorScheme.onSurface
    }

/** Maps a summary tile onto its generated i18n label (web `t('drivetrain.<key>')`). */
private fun summaryLabel(
    key: MotorSummaryKey,
    strings: LiveMotorStatusStrings,
): String =
    when (key) {
        MotorSummaryKey.ShiftState -> strings.shiftState
        MotorSummaryKey.Power -> strings.power
        MotorSummaryKey.Regen -> strings.regen
        MotorSummaryKey.Source -> strings.source
    }

/** Maps an inline metric onto its generated i18n label (web `t('drivetrain.<key>')`). */
private fun metricLabel(
    key: MotorMetricKey,
    strings: LiveMotorStatusStrings,
): String =
    when (key) {
        MotorMetricKey.RpmFront -> strings.rpmFront
        MotorMetricKey.RpmRear -> strings.rpmRear
        MotorMetricKey.TorqueFront -> strings.torqueFront
        MotorMetricKey.TorqueRear -> strings.torqueRear
        MotorMetricKey.MotorTempFront -> strings.motorTempFront
        MotorMetricKey.MotorTempRear -> strings.motorTempRear
        MotorMetricKey.InverterTemp -> strings.inverterTemp
        MotorMetricKey.BatteryTemp -> strings.batteryTemp
        MotorMetricKey.HvIsolation -> strings.isolationResistance
    }

/** Maps an inline metric onto its lucide-equivalent glyph (web `Activity` / `Zap` / `Thermometer` / `Shield`). */
private fun metricGlyph(key: MotorMetricKey): ImageVector =
    when (key) {
        MotorMetricKey.RpmFront, MotorMetricKey.RpmRear -> LiveMotorStatusGlyphs.Activity
        MotorMetricKey.TorqueFront, MotorMetricKey.TorqueRear -> LiveMotorStatusGlyphs.Zap
        MotorMetricKey.MotorTempFront,
        MotorMetricKey.MotorTempRear,
        MotorMetricKey.InverterTemp,
        MotorMetricKey.BatteryTemp,
        -> LiveMotorStatusGlyphs.Thermometer
        MotorMetricKey.HvIsolation -> LiveMotorStatusGlyphs.Shield
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun previewDisplay(): LiveMotorStatusDisplay =
    LiveMotorStatusDisplay(
        loading = false,
        hasData = true,
        summary =
            listOf(
                MotorSummaryTile(MotorSummaryKey.ShiftState, "D", MotorAccent.Cyan),
                MotorSummaryTile(MotorSummaryKey.Power, "42.50 $KW_UNIT", MotorAccent.Purple),
                MotorSummaryTile(MotorSummaryKey.Regen, "0.00 $KW_UNIT", MotorAccent.Green),
                MotorSummaryTile(MotorSummaryKey.Source, "telemetry", MotorAccent.Primary),
            ),
        metrics =
            listOf(
                MotorMetric(MotorMetricKey.RpmFront, "1,240 $RPM_UNIT", MotorAccent.Cyan),
                MotorMetric(MotorMetricKey.RpmRear, "1,238 $RPM_UNIT", MotorAccent.Purple),
                MotorMetric(MotorMetricKey.TorqueFront, "180.00 $NM_UNIT", MotorAccent.Cyan),
                MotorMetric(MotorMetricKey.TorqueRear, "175.00 $NM_UNIT", MotorAccent.Purple),
                MotorMetric(MotorMetricKey.MotorTempFront, "48.00 \u00B0C", MotorAccent.Red),
                MotorMetric(MotorMetricKey.MotorTempRear, "47.00 \u00B0C", MotorAccent.Red),
                MotorMetric(MotorMetricKey.InverterTemp, "52.00 \u00B0C", MotorAccent.Amber),
                MotorMetric(MotorMetricKey.BatteryTemp, "31.00 \u00B0C", MotorAccent.Green),
                MotorMetric(MotorMetricKey.HvIsolation, "640.00 $ISOLATION_UNIT", MotorAccent.Green),
            ),
    )

private fun emptyDisplay(): LiveMotorStatusDisplay =
    LiveMotorStatusDisplay(loading = false, hasData = false, summary = emptyList(), metrics = emptyList())

@Preview(name = "Data — narrow", showBackground = true)
@Composable
private fun LiveMotorStatusDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveMotorStatusContent(display = previewDisplay(), strings = liveMotorStatusStrings())
    }
}

@Preview(name = "Data — wide (4-col)", showBackground = true, widthDp = 1100)
@Composable
private fun LiveMotorStatusWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveMotorStatusContent(display = previewDisplay(), strings = liveMotorStatusStrings())
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LiveMotorStatusLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveMotorStatusContent(display = emptyDisplay().copy(loading = true), strings = liveMotorStatusStrings())
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun LiveMotorStatusEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveMotorStatusContent(display = emptyDisplay(), strings = liveMotorStatusStrings())
    }
}
