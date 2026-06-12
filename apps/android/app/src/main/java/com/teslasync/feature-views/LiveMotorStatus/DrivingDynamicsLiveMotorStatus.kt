// The native Jetpack Compose + Material 3 driving-dynamics LiveMotorStatus feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx. The web component renders a
// `GlassPanel` titled "Live Motor Status" and, when a `motorLatest` snapshot exists, a `Grid cols={{ default:
// 2, md: 4 }}` of four cells: three RadialGauges (Torque over 1000 Nm, Front RPM over 18000, Motor
// temperature over 200° — each with a value caption below) and a Shift-State Badge (a gear glyph + the gear
// state), falling back to a friendly `EmptyState` ("Awaiting live motor data") when no snapshot is present.
// This port keeps that contract: the panel + title always render, the grid reflows 2 → 4 columns at the web
// `md` (768dp) breakpoint, each gauge carries the web's semantic accent (blue / purple / amber) via the
// design tokens, the shift badge switches success ↔ neutral on `shift_state === 'D'`, and the empty branch
// never collapses to a blank box. A skeleton branch (opt-in `loading` flag the owning page threads) preserves
// the loading affordance the page's `/motor/latest` query implies; its default (`false`) is the web's exact
// contract.
//
// Every derivation flows through the pure [DrivingDynamicsLiveMotorStatusProjection]
// (see DrivingDynamicsLiveMotorStatusModel.kt, whose header documents the two-surface name collision and the
// reuse of the shipped drivetrain-health predecessor's [MotorLive] + [LiveMotorStatusGlyphs] + number
// formatter); this composable is a thin render layer that binds the web data sources — `useTranslation` (the
// generated i18n catalog, P1/S10) and the live temperature display preference (web `useUnits`, read from the
// S8 unit-formatter store, P1/S8) — and records the one-shot `view.opened` diagnostic (P1/S11) on first
// composition. The title, every gauge label, the shift fallback, and the empty / loading messages resolve
// through the catalog (`dynamics.*` + `a11y.loading` keys); the only non-key strings are the unit suffixes the
// web itself hard-codes (`Nm`, `RPM`) and the degree label from the unit preference, so there is no English UI
// copy literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveMotorStatus) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livemotorstatus.drivingdynamics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
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
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.livemotorstatus.LiveMotorStatusGlyphs
import io.teslasync.android.featureviews.livemotorstatus.MotorLive
import io.teslasync.android.featureviews.livemotorstatus.resolveDisplayLocale
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `<RadialGauge size={120}>` — the driving-dynamics gauge diameter. */
private val GAUGE_SIZE: Dp = 120.dp

/** Tailwind `md` (768px) breakpoint — the web `Grid cols={{ default: 2, md: 4 }}` reflow. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

private const val GRID_COLUMNS_BASE: Int = 2
private const val GRID_COLUMNS_MD: Int = 4

/** Loading chrome: two tile-height skeleton bars approximating the resolved two-row gauge grid. */
private val SKELETON_TILE_HEIGHT: Dp = 120.dp
private const val SKELETON_ROW_COUNT: Int = 2

/** One responsive grid cell — either a RadialGauge or the Shift-State badge tile (web's four cells). */
private sealed interface MotorCell {
    data class Gauge(
        val gauge: MotorGauge,
    ) : MotorCell

    data class Shift(
        val tile: MotorShiftTile,
    ) : MotorCell
}

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveMotorStatus({ motorLatest, toTemperatureDisplay,
 * tempUnit })`. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live
 * temperature preference + locale from the data container (web `useUnits` / the `toTemperatureDisplay` +
 * `tempUnit` props the owning page threads in, P1/S8), projects the [motor] snapshot onto a
 * [DrivingDynamicsLiveMotorStatusDisplay] via the pure [DrivingDynamicsLiveMotorStatusProjection], and renders.
 *
 * @param motor the latest motor snapshot the owning Driving-Dynamics page decodes from its `/motor/latest`
 *   query (web `motorLatest`), or `null` when none is cached — which selects the empty state.
 * @param modifier layout modifier applied to the surface's FadeIn wrapper.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingDynamicsLiveMotorStatus(
    motor: MotorLive?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingDynamicsLiveMotorStatusDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val strings = drivingDynamicsLiveMotorStatusStrings()
    val display =
        remember(motor, loading, prefs, strings) {
            DrivingDynamicsLiveMotorStatusProjection.project(
                motor = motor,
                strings = strings,
                prefs = prefs,
                locale = resolveDisplayLocale(prefs.locale),
                loading = loading,
            )
        }
    DrivingDynamicsLiveMotorStatusContent(display = display, strings = strings, modifier = modifier)
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful entry,
 * the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun drivingDynamicsLiveMotorStatusStrings(): DrivingDynamicsLiveMotorStatusStrings =
    DrivingDynamicsLiveMotorStatusStrings(
        title = stringResource(R.string.translation_dynamics_liveMotor),
        torque = stringResource(R.string.translation_dynamics_torque),
        rpmFront = stringResource(R.string.translation_dynamics_rpmFront),
        motorTemp = stringResource(R.string.translation_dynamics_motorTemp),
        shiftState = stringResource(R.string.translation_dynamics_shiftState),
        awaiting = stringResource(R.string.translation_dynamics_awaiting),
        unknown = stringResource(R.string.translation_dynamics_unknown),
        noData = stringResource(R.string.translation_dynamics_noLiveMotor),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + title; then the
 * skeleton chrome while [DrivingDynamicsLiveMotorStatusDisplay.loading] is true (web's parent-implied loading),
 * the four-cell gauge grid when a snapshot exists (web `motorLatest != null`), or the empty state otherwise.
 * No surface is ever hidden or blank.
 */
@Composable
fun DrivingDynamicsLiveMotorStatusContent(
    display: DrivingDynamicsLiveMotorStatusDisplay,
    strings: DrivingDynamicsLiveMotorStatusStrings,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            SectionTitle(strings.title, modifier = Modifier.semantics { heading() })
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                display.loading -> LoadingChrome(loadingLabel = strings.loadingLabel)
                display.hasData -> MotorGrid(gauges = display.gauges, shift = display.shift)
                else -> EmptyState(message = strings.noData)
            }
        }
    }
}

/**
 * The four-cell grid — the web `Grid cols={{ default: 2, md: 4 }} gap={6}`. Picks 4 columns at or above the
 * `md` breakpoint, else 2, and lays the three gauges plus the shift tile out as weighted rows so every cell
 * shares a uniform width.
 */
@Composable
private fun MotorGrid(
    gauges: List<MotorGauge>,
    shift: MotorShiftTile?,
    modifier: Modifier = Modifier,
) {
    val cells: List<MotorCell> =
        buildList {
            gauges.forEach { add(MotorCell.Gauge(it)) }
            shift?.let { add(MotorCell.Shift(it)) }
        }
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            cells.chunked(columns).forEach { rowCells ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    rowCells.forEach { cell -> MotorCellContent(cell = cell, modifier = Modifier.weight(1f)) }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Dispatches a [MotorCell] to its renderer — a gauge cell or the shift-state tile. */
@Composable
private fun MotorCellContent(
    cell: MotorCell,
    modifier: Modifier = Modifier,
) {
    when (cell) {
        is MotorCell.Gauge -> GaugeCell(gauge = cell.gauge, modifier = modifier)
        is MotorCell.Shift -> ShiftCell(tile = cell.tile, modifier = modifier)
    }
}

/**
 * One gauge cell — the web `flex flex-col items-center gap-2`: the shared [RadialGauge] (its accent resolved
 * to a design token) over the formatted value caption.
 */
@Composable
private fun GaugeCell(
    gauge: MotorGauge,
    modifier: Modifier = Modifier,
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
            unit = gauge.unit.ifBlank { null },
            color = gaugeColor(gauge.accent),
            size = GAUGE_SIZE,
            decimals = gauge.decimals,
        )
        Caption(gauge.caption)
    }
}

/**
 * The shift-state cell — the web fourth `flex flex-col items-center gap-3` cell: a gauge-sized box centering a
 * [Badge] (the gear glyph + the gear state, success when in Drive else neutral) over the "Shift State" caption.
 */
@Composable
private fun ShiftCell(
    tile: MotorShiftTile,
    modifier: Modifier = Modifier,
) {
    val variant = if (tile.isDrive) BadgeVariant.Success else BadgeVariant.Neutral
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Box(modifier = Modifier.size(GAUGE_SIZE), contentAlignment = Alignment.Center) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = LiveMotorStatusGlyphs.Cog,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = badgeTint(variant),
                )
                Badge(text = tile.value, variant = variant)
            }
        }
        Caption(tile.label)
    }
}

/**
 * The loading branch — tile-height skeleton bars carrying a single TalkBack "Loading" content description, so
 * the loading state is announced rather than read as a stack of empty boxes. No gauge label leaks while loading.
 */
@Composable
private fun LoadingChrome(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_ROW_COUNT) { Skeleton(height = SKELETON_TILE_HEIGHT) }
    }
}

/**
 * Maps a [MotorGaugeAccent] to a design-token color (P1/S9). The web RadialGauge hex colors map to the brand
 * palette: blue `#3b82f6` → the info token, purple `#a855f7` → the chart power hue, amber `#f59e0b` → the
 * warning token — so no Tailwind class or raw hex survives into the view.
 */
@Composable
private fun gaugeColor(accent: MotorGaugeAccent): Color =
    when (accent) {
        MotorGaugeAccent.Torque -> TeslaTokens.status.info
        MotorGaugeAccent.Rpm -> TeslaTokens.chart.power
        MotorGaugeAccent.Temp -> TeslaTokens.status.warning
    }

/** Tints the shift-state gear glyph to match its [Badge] foreground (success green, else the neutral muted hue). */
@Composable
private fun badgeTint(variant: BadgeVariant): Color =
    if (variant == BadgeVariant.Success) {
        TeslaTokens.status.success
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val previewStrings =
    DrivingDynamicsLiveMotorStatusStrings(
        title = "Live Motor Status",
        torque = "Torque",
        rpmFront = "Front RPM",
        motorTemp = "Motor",
        shiftState = "Shift State",
        awaiting = "Awaiting data",
        unknown = "Unknown",
        noData = "Awaiting live motor data",
        loadingLabel = "Loading",
    )

private fun previewDisplay(): DrivingDynamicsLiveMotorStatusDisplay =
    DrivingDynamicsLiveMotorStatusDisplay(
        loading = false,
        hasData = true,
        gauges =
            listOf(
                MotorGauge(previewStrings.torque, 355.0, 1000.0, NM_UNIT, 0, "355.00 $NM_UNIT", MotorGaugeAccent.Torque),
                MotorGauge(previewStrings.rpmFront, 1240.0, 18000.0, RPM_UNIT, 0, "1,240 $RPM_UNIT", MotorGaugeAccent.Rpm),
                MotorGauge(previewStrings.motorTemp, 48.0, 200.0, "\u00B0C", 0, "48.0\u00B0C", MotorGaugeAccent.Temp),
            ),
        shift = MotorShiftTile(previewStrings.shiftState, "D", isDrive = true),
    )

private fun emptyDisplay(): DrivingDynamicsLiveMotorStatusDisplay =
    DrivingDynamicsLiveMotorStatusDisplay(loading = false, hasData = false, gauges = emptyList(), shift = null)

@Preview(name = "Data — narrow (2-col)", showBackground = true)
@Composable
private fun DrivingDynamicsLiveMotorStatusDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingDynamicsLiveMotorStatusContent(display = previewDisplay(), strings = previewStrings)
    }
}

@Preview(name = "Data — wide (4-col)", showBackground = true, widthDp = 1100)
@Composable
private fun DrivingDynamicsLiveMotorStatusWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingDynamicsLiveMotorStatusContent(display = previewDisplay(), strings = previewStrings)
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingDynamicsLiveMotorStatusLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingDynamicsLiveMotorStatusContent(display = emptyDisplay().copy(loading = true), strings = previewStrings)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingDynamicsLiveMotorStatusEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingDynamicsLiveMotorStatusContent(display = emptyDisplay(), strings = previewStrings)
    }
}
