// File hosts the BatteryGauge Compose surface (stateful + stateless + per-state previews); named after
// the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope

/**
 * The native Android (Jetpack Compose / Material 3) Battery Level dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx`. It mirrors the web `WidgetShell`
 * (skeleton while loading, a retry surface on hard error, otherwise a title-less header carrying the
 * freshness chip) wrapping the web `WidgetGaugeHero` (a radial state-of-charge gauge, color-banded
 * green/amber/red, with a "⚡ Charging" indicator) or, when the backend has no decodable state, a
 * friendly "No battery data" empty state. All data flows through the [BatteryGaugeWidgetViewModel]
 * (P1/S8); the view performs no HTTP. Every string resolves from `strings.xml` (P1/S10) and the gauge,
 * charging indicator, refresh control, and empty/error surfaces all carry TalkBack descriptions.
 *
 * @param viewModel the state holder bound to the shared vehicles + vehicle-state feeds.
 * @param size the grid footprint; a 1×1 footprint shrinks the gauge and hides the charging line.
 */
@Composable
fun BatteryGaugeWidget(
    viewModel: BatteryGaugeWidgetViewModel,
    modifier: Modifier = Modifier,
    size: BatteryGaugeSize = BatteryGaugeRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.battery.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    BatteryGaugeWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Battery Level panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over the cached reading). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun BatteryGaugeWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    size: BatteryGaugeSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxSize()) {
        when {
            state.isLoading -> BatteryGaugeLoading()
            state.isError -> BatteryGaugeError(state = state, onRetry = onRetry)
            else -> BatteryGaugeLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun BatteryGaugeLoaded(
    state: UiState<VehicleStateEnvelope>,
    size: BatteryGaugeSize,
    onRefresh: () -> Unit,
) {
    val envelope = state.data
    val snapshot = remember(envelope) { envelope?.let { BatteryGaugeProjection.snapshotOf(it.state) } }
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BatteryGaugeHeader(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            if (snapshot == null) {
                BatteryGaugeEmpty()
            } else {
                BatteryGaugeHero(snapshot = snapshot, size = size)
            }
        }
    }
}

@Composable
private fun BatteryGaugeHeader(
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Spacer(modifier = Modifier.weight(1f))
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
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
private fun BatteryGaugeHero(
    snapshot: BatteryGaugeSnapshot,
    size: BatteryGaugeSize,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        RadialGauge(
            value = snapshot.gaugeValue,
            max = BatteryGaugeSnapshot.GAUGE_MAX,
            label = stringResource(R.string.translation_widget_battery),
            unit = BatteryGaugeSnapshot.GAUGE_UNIT,
            color = batteryGaugeColor(snapshot.statusLevel),
            size = if (size.isCompact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE,
        )
        if (!size.isCompact && snapshot.isCharging) {
            ChargingIndicator()
        }
    }
}

/**
 * The "⚡ Charging" indicator (web `state.is_charging && <p className="animate-pulse">…`). A bolt glyph
 * plus the localized label in the success color, gently pulsing — the pulse is suppressed when the
 * platform requests reduced motion. Exposes one merged TalkBack description.
 */
@Composable
private fun ChargingIndicator() {
    val label = stringResource(R.string.translation_widget_charging)
    val reduceMotion = rememberReducedMotion()
    val alpha = if (reduceMotion) FULL_ALPHA else chargingPulseAlpha()
    Row(
        modifier =
            Modifier
                .padding(top = Spacing.xs)
                .graphicsLayer { this.alpha = alpha }
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
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = TeslaTokens.status.success,
        )
    }
}

@Composable
private fun chargingPulseAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "charging")
    val alpha by transition.animateFloat(
        initialValue = CHARGING_MIN_ALPHA,
        targetValue = FULL_ALPHA,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = CHARGING_PULSE_MS),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "charging-alpha",
    )
    return alpha
}

@Composable
private fun BatteryGaugeEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noBattery),
        icon = DataDisplayGlyphs.Battery,
    )
}

@Composable
private fun BatteryGaugeLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Spacer(modifier = Modifier.weight(1f))
        Box(modifier = Modifier.size(STANDARD_GAUGE_SIZE)) {
            Skeleton(height = STANDARD_GAUGE_SIZE, rounded = true)
        }
        Skeleton(widthFraction = LOADING_LABEL_FRACTION, height = LOADING_LABEL_HEIGHT)
        Spacer(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun BatteryGaugeError(
    state: UiState<VehicleStateEnvelope>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = queryErrorKindFor(state),
        resourceName = stringResource(R.string.translation_widget_battery),
        onRetry = onRetry,
    )
}

/** Maps a [BatteryStatusLevel] band onto a design token (P1/S9) — the web `batteryColor()` hex values. */
@Composable
private fun batteryGaugeColor(level: BatteryStatusLevel): Color =
    when (level) {
        BatteryStatusLevel.Good -> TeslaTokens.status.success
        BatteryStatusLevel.Warning -> TeslaTokens.status.warning
        BatteryStatusLevel.Critical -> TeslaTokens.status.danger
        BatteryStatusLevel.Unknown -> MaterialTheme.colorScheme.surfaceVariant
    }

private val STANDARD_GAUGE_SIZE: Dp = 120.dp
private val COMPACT_GAUGE_SIZE: Dp = 84.dp
private val LOADING_LABEL_HEIGHT: Dp = 12.dp
private const val LOADING_LABEL_FRACTION: Float = 0.4f
private const val CHARGING_MIN_ALPHA: Float = 0.4f
private const val FULL_ALPHA: Float = 1f
private const val CHARGING_PULSE_MS: Int = 900

// ── Previews — one per rendered state (loading / content / charging / critical / empty / error / offline) ──

private fun sampleState(
    batteryLevel: Long,
    isCharging: Boolean,
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = 0.0,
        insideTemp = 21.0,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 18.0,
        power = 0.0,
        ratedRange = 0.0,
        sentryMode = false,
        softwareVersion = "2024.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1,
    )

private fun contentState(
    batteryLevel: Long,
    isCharging: Boolean,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<VehicleStateEnvelope> =
    UiState(
        phase = UiPhase.Content,
        data = VehicleStateEnvelope(state = sampleState(batteryLevel, isCharging), live = true),
        fetchedAt = 1_000L,
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "BatteryGauge · content", showBackground = true)
@Composable
private fun BatteryGaugeContentPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(state = contentState(72, isCharging = false), size = BatteryGaugeRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "BatteryGauge · charging", showBackground = true)
@Composable
private fun BatteryGaugeChargingPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(state = contentState(43, isCharging = true), size = BatteryGaugeRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "BatteryGauge · critical", showBackground = true)
@Composable
private fun BatteryGaugeCriticalPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(state = contentState(12, isCharging = false), size = BatteryGaugeRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "BatteryGauge · empty", showBackground = true)
@Composable
private fun BatteryGaugeEmptyPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = VehicleStateEnvelope(state = null, live = false), fetchedAt = 1_000L),
            size = BatteryGaugeRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "BatteryGauge · loading", showBackground = true)
@Composable
private fun BatteryGaugeLoadingPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(state = UiState.loading(), size = BatteryGaugeRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "BatteryGauge · error", showBackground = true)
@Composable
private fun BatteryGaugeErrorPreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = BatteryGaugeRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "BatteryGauge · offline (stale cache)", showBackground = true)
@Composable
private fun BatteryGaugeOfflinePreview() {
    TeslaSyncTheme {
        BatteryGaugeWidgetContent(
            state = contentState(58, isCharging = false, stale = true, errorKind = ErrorKind.Network),
            size = BatteryGaugeRegistration.DEFAULT_SIZE,
        )
    }
}
