// File hosts the BatteryRadialGauge Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.batteryradialgauge

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope

/**
 * The native Android (Jetpack Compose / Material 3) Battery Radial Gauge dashboard surface — a parity
 * port of `web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx`. It mirrors the web
 * `WidgetShell` (skeleton while loading, a retry surface on error, otherwise a title + battery glyph +
 * freshness header) wrapping the web `WidgetGaugeHero`: a color-banded radial gauge of the state of
 * charge, an optional charge-limit overlay arc, the Level/Limit stat row on the large footprint, and a
 * charging indicator — or a friendly empty state when no vehicle state is decoded. All data flows
 * through the [BatteryRadialGaugeWidgetViewModel] (P1/S8); the view performs no HTTP. Every string
 * resolves from `strings.xml` (P1/S10), and the surface emits the P1/S11 `view.opened` event on appear.
 *
 * @param viewModel the state holder bound to the shared vehicles + vehicle-state feeds.
 * @param size the grid footprint; controls the title, gauge diameter and stat row (web `isCompact`/`isLarge`).
 */
@Composable
fun BatteryRadialGaugeWidget(
    viewModel: BatteryRadialGaugeWidgetViewModel,
    modifier: Modifier = Modifier,
    size: BatteryRadialGaugeSize = BatteryRadialGaugeRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    BatteryRadialGaugeWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Battery Radial Gauge panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over cached state). Hoisted out of
 * the ViewModel so it is preview- and screenshot-testable for each state.
 *
 * @param chargeLimitSoc the optional configured charge limit (0–100). The web reads this opportunistically
 *   from an extended state payload; the strongly-typed [VehicleState] envelope does not surface it, so the
 *   bound widget passes `null` and the limit ring/stat stay hidden until the shared contract carries it.
 *   Previews and UI tests pass a value to exercise the ring + Limit stat branch.
 */
@Composable
fun BatteryRadialGaugeWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    size: BatteryRadialGaugeSize,
    modifier: Modifier = Modifier,
    chargeLimitSoc: Double? = null,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> BatteryRadialGaugeLoading()
            state.isError -> BatteryRadialGaugeErrorState(state = state, onRetry = onRetry)
            else ->
                BatteryRadialGaugeLoaded(
                    state = state,
                    size = size,
                    chargeLimitSoc = chargeLimitSoc,
                    onRefresh = onRefresh,
                )
        }
    }
}

@Composable
private fun BatteryRadialGaugeLoaded(
    state: UiState<VehicleStateEnvelope>,
    size: BatteryRadialGaugeSize,
    chargeLimitSoc: Double?,
    onRefresh: () -> Unit,
) {
    val display =
        remember(state.data, size, chargeLimitSoc) {
            BatteryRadialGaugeProjection.project(state.data?.state, chargeLimitSoc, size)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BatteryRadialGaugeHeader(
            title = if (display.showTitle) stringResource(R.string.translation_widget_batteryRadial) else null,
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        BatteryRadialGaugeBody(display = display)
    }
}

@Composable
private fun BatteryRadialGaugeHeader(
    title: String?,
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.battery,
            )
            Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = title == null,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun BatteryRadialGaugeBody(display: BatteryRadialGaugeDisplay) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(vertical = Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        if (display.hasState) {
            BatteryRadialGaugeContentColumn(display = display)
        } else {
            EmptyState(
                message = stringResource(R.string.translation_widget_noBattery),
                icon = DataDisplayGlyphs.Battery,
            )
        }
    }
}

@Composable
private fun BatteryRadialGaugeContentColumn(display: BatteryRadialGaugeDisplay) {
    val gaugeSize = if (display.isCompact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BatteryGauge(display = display, gaugeSize = gaugeSize)
        if (display.showStats) {
            GaugeStatsRow(stats = display.stats)
        }
        if (display.isCharging) {
            ChargingIndicator(label = stringResource(R.string.translation_widget_charging))
        }
    }
}

@Composable
private fun BatteryGauge(
    display: BatteryRadialGaugeDisplay,
    gaugeSize: Dp,
    modifier: Modifier = Modifier,
) {
    val gaugeLabel = if (display.isCompact) "" else stringResource(R.string.translation_widget_battery)
    Box(modifier = modifier, contentAlignment = Alignment.TopCenter) {
        RadialGauge(
            value = display.batteryLevel,
            max = BATTERY_MAX_PERCENT,
            label = gaugeLabel,
            unit = BATTERY_PERCENT_UNIT,
            color = batteryBandColor(display.colorBand),
            size = gaugeSize,
            decimals = STAT_DECIMALS,
        )
        if (display.showChargeLimitRing) {
            ChargeLimitRing(
                fraction = display.chargeLimitRingFraction,
                gaugeSize = gaugeSize,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        }
    }
}

/**
 * The thin overlay arc marking the charge-limit position on the gauge — the Android port of the web
 * `ChargeLimitRing` SVG. Drawn on the same radius as the [RadialGauge] track (gauge stroke matched) so
 * the marker sits exactly over the value arc; purely decorative, so it exposes no screen-reader node.
 */
@Composable
private fun ChargeLimitRing(
    fraction: Float,
    gaugeSize: Dp,
    modifier: Modifier = Modifier,
) {
    val ringColor = MaterialTheme.colorScheme.onSurface.copy(alpha = RING_ALPHA)
    Canvas(modifier = modifier.size(gaugeSize)) {
        val gaugeStrokePx = GAUGE_STROKE.toPx()
        val diameter = size.minDimension - gaugeStrokePx
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        drawArc(
            color = ringColor,
            startAngle = RING_START_ANGLE,
            sweepAngle = RING_FULL_SWEEP * fraction,
            useCenter = false,
            topLeft = topLeft,
            size = Size(diameter, diameter),
            style = Stroke(width = RING_STROKE.toPx(), cap = StrokeCap.Round),
        )
    }
}

@Composable
private fun GaugeStatsRow(stats: List<GaugeStat>) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.Top,
    ) {
        stats.forEach { stat -> GaugeStatItem(stat = stat) }
    }
}

@Composable
private fun GaugeStatItem(stat: GaugeStat) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Caption(text = gaugeStatLabel(stat.kind))
        BodyText(text = "${ChartFormat.number(stat.value, STAT_DECIMALS)}${stat.unit}", maxLines = 1)
    }
}

@Composable
private fun gaugeStatLabel(kind: GaugeStatKind): String =
    stringResource(
        when (kind) {
            GaugeStatKind.Level -> R.string.translation_widget_level
            GaugeStatKind.ChargeLimit -> R.string.translation_widget_chargeLimit
        },
    )

/**
 * The "⚡ Charging" indicator (web `state.is_charging` branch): a bolt glyph + label that gently pulses,
 * honoring reduced motion ([rememberReducedMotion]) by rendering at full opacity with no animation.
 */
@Composable
private fun ChargingIndicator(label: String) {
    val pulseAlpha = chargingPulseAlpha(rememberReducedMotion())
    Row(
        modifier =
            Modifier
                .graphicsLayer { alpha = pulseAlpha }
                .semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Xs,
            tint = TeslaTokens.status.success,
        )
        Caption(text = label)
    }
}

@Composable
private fun chargingPulseAlpha(reduce: Boolean): Float {
    if (reduce) return 1f
    val transition = rememberInfiniteTransition(label = "charging-pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = CHARGING_PULSE_MIN_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(CHARGING_PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "charging-pulse-alpha",
    )
    return alpha
}

@Composable
private fun batteryBandColor(band: BatteryColorBand): Color =
    when (band) {
        BatteryColorBand.Green -> TeslaTokens.status.success
        BatteryColorBand.Amber -> TeslaTokens.status.warning
        BatteryColorBand.Red -> TeslaTokens.status.danger
        BatteryColorBand.Unknown -> MaterialTheme.colorScheme.surfaceVariant
    }

@Composable
private fun BatteryRadialGaugeLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Skeleton(height = LOADING_GAUGE_SIZE, widthFraction = LOADING_WIDTH_FRACTION, rounded = true)
    }
}

@Composable
private fun BatteryRadialGaugeErrorState(
    state: UiState<VehicleStateEnvelope>,
    onRetry: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_widget_batteryRadial),
            onRetry = onRetry,
        )
    }
}

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

private val COMPACT_GAUGE_SIZE = 70.dp
private val STANDARD_GAUGE_SIZE = 100.dp
private val BODY_MIN_HEIGHT = 120.dp
private val LOADING_GAUGE_SIZE = 96.dp
private val GAUGE_STROKE = 8.dp
private val RING_STROKE = 2.dp
private const val BATTERY_MAX_PERCENT = 100.0
private const val STAT_DECIMALS = 0
private const val LOADING_WIDTH_FRACTION = 0.6f
private const val RING_ALPHA = 0.25f
private const val RING_START_ANGLE = -90f
private const val RING_FULL_SWEEP = 360f
private const val CHARGING_PULSE_MIN_ALPHA = 0.45f
private const val CHARGING_PULSE_MS = 900

// ── Previews — one per rendered state (content / large+charging / empty / loading / error) ──────────

private fun previewState(
    level: Long,
    charging: Boolean,
): VehicleState =
    VehicleState(
        batteryLevel = level,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = 0.0,
        insideTemp = 21.0,
        isCharging = charging,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 15.0,
        power = 0.0,
        ratedRange = 350.0,
        sentryMode = false,
        softwareVersion = "2024.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )

@Preview(name = "BatteryRadialGauge · content", showBackground = true)
@Composable
private fun BatteryRadialGaugeContentPreview() {
    TeslaSyncTheme {
        BatteryRadialGaugeWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = VehicleStateEnvelope(state = previewState(72, charging = false), live = true),
                    fetchedAt = System.currentTimeMillis(),
                ),
            size = BatteryRadialGaugeRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "BatteryRadialGauge · large + charging + limit", showBackground = true)
@Composable
private fun BatteryRadialGaugeLargePreview() {
    TeslaSyncTheme {
        BatteryRadialGaugeWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = VehicleStateEnvelope(state = previewState(18, charging = true), live = true),
                    fetchedAt = System.currentTimeMillis(),
                ),
            size = BatteryRadialGaugeSize(cols = 2, rows = 2),
            chargeLimitSoc = 80.0,
        )
    }
}

@Preview(name = "BatteryRadialGauge · empty", showBackground = true)
@Composable
private fun BatteryRadialGaugeEmptyPreview() {
    TeslaSyncTheme {
        BatteryRadialGaugeWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Empty,
                    data = VehicleStateEnvelope(state = null, live = false),
                    fetchedAt = System.currentTimeMillis(),
                ),
            size = BatteryRadialGaugeRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "BatteryRadialGauge · loading", showBackground = true)
@Composable
private fun BatteryRadialGaugeLoadingPreview() {
    TeslaSyncTheme {
        BatteryRadialGaugeWidgetContent(state = UiState.loading(), size = BatteryRadialGaugeRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "BatteryRadialGauge · error", showBackground = true)
@Composable
private fun BatteryRadialGaugeErrorPreview() {
    TeslaSyncTheme {
        BatteryRadialGaugeWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = BatteryRadialGaugeRegistration.DEFAULT_SIZE,
        )
    }
}
