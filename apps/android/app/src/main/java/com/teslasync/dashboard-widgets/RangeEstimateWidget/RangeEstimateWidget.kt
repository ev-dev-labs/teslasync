// The native Jetpack Compose + Material 3 Range Estimate dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RangeEstimateWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of two bodies
// the web ternary renders: the stacked rated-range / ideal-range figures, or a friendly "No range data"
// empty state. All data flows through the shared [RangeEstimateWidgetViewModel]; SI range values are
// converted to the user's unit at this render boundary via the live [io.teslasync.android.data.UnitFormatter].
// The view never performs HTTP. Every string resolves through the i18n catalog and the refresh control
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RangeEstimateWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.rangeestimate

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
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

private const val LOADING_LABEL_WIDTH = 0.4f
private const val LOADING_RATED_WIDTH = 0.6f
private const val LOADING_IDEAL_WIDTH = 0.5f
private val LOADING_LABEL_HEIGHT = 10.dp
private val LOADING_RATED_HEIGHT = 26.dp
private val LOADING_IDEAL_HEIGHT = 22.dp

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [RangeEstimateWidgetViewModel],
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
fun RangeEstimateWidget(
    source: RangeEstimateSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = RangeEstimateRegistration.ID,
) {
    val viewModel: RangeEstimateWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { RangeEstimateWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    RangeEstimateWidgetContent(
        state = state,
        prefs = formatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header
 * over the ranges / empty body. Stale (non-error) data auto-refreshes, mirroring the web freshness
 * contract. [prefs] supplies the SI→display unit conversion at the render boundary.
 */
@Composable
fun RangeEstimateWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    prefs: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberRangeEstimateStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> RangeEstimateLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> RangeEstimateError(onRetry = onRefresh)
            else -> {
                RangeEstimateHeader(state = state, onRefresh = onRefresh)
                val display =
                    remember(state.data, prefs, strings) {
                        RangeEstimateProjection.project(state.data?.state, prefs, strings)
                    }
                RangeEstimateBody(display = display, strings = strings)
            }
        }
    }
}

@Composable
private fun RangeEstimateHeader(
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
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
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
private fun RangeEstimateBody(
    display: RangeEstimateDisplay,
    strings: RangeEstimateStrings,
) {
    when (display) {
        is RangeEstimateDisplay.Ranges -> RangesContent(display = display, strings = strings)
        is RangeEstimateDisplay.NoData -> RangeEstimateEmpty(display)
    }
}

@Composable
private fun RangesContent(
    display: RangeEstimateDisplay.Ranges,
    strings: RangeEstimateStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = display.contentDescription },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RangeRow(
            label = strings.ratedRange,
            value = display.ratedRangeText,
            level = HeadingLevel.Section,
            valueColor = TeslaTokens.status.info,
        )
        RangeRow(
            label = strings.idealRange,
            value = display.idealRangeText,
            level = HeadingLevel.Panel,
            valueColor = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun RangeRow(
    label: String,
    value: String,
    level: HeadingLevel,
    valueColor: Color,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        MetricLabel(label)
        Heading(value, level = level, color = valueColor)
    }
}

@Composable
private fun RangeEstimateEmpty(display: RangeEstimateDisplay.NoData) {
    EmptyState(
        message = display.contentDescription,
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RangeEstimateLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_LABEL_WIDTH, height = LOADING_LABEL_HEIGHT)
        Skeleton(widthFraction = LOADING_RATED_WIDTH, height = LOADING_RATED_HEIGHT, rounded = true)
        Skeleton(widthFraction = LOADING_LABEL_WIDTH, height = LOADING_LABEL_HEIGHT)
        Skeleton(widthFraction = LOADING_IDEAL_WIDTH, height = LOADING_IDEAL_HEIGHT, rounded = true)
    }
}

@Composable
private fun RangeEstimateError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [RangeEstimateStrings] from the i18n catalog (P1/S10) — the three `widget.*` keys the
 * web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberRangeEstimateStrings(): RangeEstimateStrings {
    val ratedRange = stringResource(R.string.translation_widget_ratedRange)
    val idealRange = stringResource(R.string.translation_widget_idealRange)
    val noRange = stringResource(R.string.translation_widget_noRange)
    return remember(ratedRange, idealRange, noRange) {
        RangeEstimateStrings(
            ratedRange = ratedRange,
            idealRange = idealRange,
            noRange = noRange,
        )
    }
}
