// The native Jetpack Compose + Material 3 Charge Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ChargeStatusWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of
// three bodies the web ternary renders: the active-charge 2×2 metric grid (Power / Rate / Battery / Time
// to Full), the parked "Not Charging" hero (battery % · rated range), or a friendly empty state. All data
// flows through the shared [ChargeStatusWidgetViewModel]; SI values are converted to the user's unit at
// this render boundary via the live [io.teslasync.android.data.UnitFormatter]. The view never performs
// HTTP. Every string resolves through the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargeStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargestatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [ChargeStatusWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live [units] formatter, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S7/S8 Vehicles data layer), an
 * optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network Vehicles seam (`VehiclesRepository`/`VehiclesStore` adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargeStatusWidget(
    source: ChargeStatusSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = ChargeStatusRegistration.ID,
) {
    val viewModel: ChargeStatusWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ChargeStatusWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    ChargeStatusWidgetContent(
        state = state,
        prefs = formatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header
 * over the charging / not-charging / empty body. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [prefs] supplies the SI→display unit conversion at the render boundary.
 */
@Composable
fun ChargeStatusWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    prefs: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberChargeStatusStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> ChargeStatusLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> ChargeStatusError(onRetry = onRefresh)
            else -> {
                ChargeStatusHeader(state = state, onRefresh = onRefresh)
                val display =
                    remember(state.data, prefs, strings) {
                        ChargeStatusProjection.project(state.data?.state, prefs, strings)
                    }
                ChargeStatusBody(display = display)
            }
        }
    }
}

@Composable
private fun ChargeStatusHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.End),
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun ChargeStatusBody(display: ChargeStatusDisplay) {
    when (display) {
        is ChargeStatusDisplay.Charging -> ChargingContent(display)
        is ChargeStatusDisplay.NotCharging -> NotChargingContent(display)
        is ChargeStatusDisplay.NoData -> ChargeStatusEmpty(display)
    }
}

@Composable
private fun ChargingContent(display: ChargeStatusDisplay.Charging) {
    val strings = rememberChargeStatusStrings()
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = display.contentDescription },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                DataDisplayGlyphs.BatteryCharging,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            Heading(strings.charging, level = HeadingLevel.Sub, color = TeslaTokens.status.success)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCell(strings.power, display.powerText, TeslaTokens.status.success)
            MetricCell(strings.rate, display.rateText, MaterialTheme.colorScheme.onSurface)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCell(strings.battery, display.batteryText, MaterialTheme.colorScheme.onSurface)
            MetricCell(strings.timeToFull, display.timeToFullText, MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun RowScope.MetricCell(
    label: String,
    value: String,
    valueColor: Color,
) {
    Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(label)
        Heading(value, level = HeadingLevel.Sub, color = valueColor)
    }
}

@Composable
private fun NotChargingContent(display: ChargeStatusDisplay.NotCharging) {
    val strings = rememberChargeStatusStrings()
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = display.contentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Heading(strings.notCharging, level = HeadingLevel.Sub)
        Caption(display.summaryText)
    }
}

@Composable
private fun ChargeStatusEmpty(display: ChargeStatusDisplay.NoData) {
    EmptyState(
        message = display.contentDescription,
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ChargeStatusLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = 0.35f, height = 14.dp)
        Skeleton(height = 32.dp, rounded = true)
        Skeleton(height = 32.dp, rounded = true)
    }
}

@Composable
private fun ChargeStatusError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [ChargeStatusStrings] from the i18n catalog (P1/S10) — the seven `widget.*` keys the
 * web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberChargeStatusStrings(): ChargeStatusStrings {
    val charging = stringResource(R.string.translation_widget_charging)
    val power = stringResource(R.string.translation_widget_power)
    val rate = stringResource(R.string.translation_widget_rate)
    val battery = stringResource(R.string.translation_widget_battery)
    val timeToFull = stringResource(R.string.translation_widget_timeToFull)
    val notCharging = stringResource(R.string.translation_widget_notCharging)
    val noChargeData = stringResource(R.string.translation_widget_noChargeData)
    return remember(charging, power, rate, battery, timeToFull, notCharging, noChargeData) {
        ChargeStatusStrings(
            charging = charging,
            power = power,
            rate = rate,
            battery = battery,
            timeToFull = timeToFull,
            notCharging = notCharging,
            noChargeData = noChargeData,
        )
    }
}
