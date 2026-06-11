// The native Jetpack Compose + Material 3 Range Bar dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RangeBarWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a retry surface on hard failure, otherwise a freshness header) wrapping one of the two
// bodies the web renders: the compact 1×1 rated-range hero (a big number + a "{unit} rated" label) or —
// when wider — the standard layout (a Rated-Range bar over an Ideal-Range bar plus the EPA-variance line),
// with a friendly empty state when no range payload exists. All data flows through the shared
// [RangeBarWidgetViewModel]; SI metres are converted to the user's distance unit at this render boundary
// via the live [io.teslasync.android.data.UnitFormatter]. The view never performs HTTP. Every string
// resolves through the i18n catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RangeBarWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.rangebar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

private const val LOADING_TITLE_FRACTION = 0.35f
private const val LOADING_HERO_FRACTION = 0.6f
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_HERO_HEIGHT = 32.dp
private val LOADING_BAR_HEIGHT = 32.dp
private val HERO_MIN_HEIGHT = 44.dp
private const val COMPACT_HERO_DECIMALS = 0

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [RangeBarWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live [units] formatter, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * Vehicles data layer), an optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey]
 * per placement.
 *
 * @param source the cache-then-network Vehicles seam (`VehiclesRepository`/`VehiclesStore` adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RangeBarWidget(
    source: RangeBarSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: RangeBarSize = RangeBarRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = RangeBarRegistration.ID,
) {
    val viewModel: RangeBarWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { RangeBarWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    RangeBarWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact / standard
 * body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [prefs] supplies the SI-metre → display-unit conversion; [locale]
 * drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun RangeBarWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    prefs: UnitPref,
    size: RangeBarSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberRangeBarStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> RangeBarLoading(size = size, label = stringResource(R.string.translation_a11y_loading))
            state.isError -> RangeBarError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, size, prefs, strings, locale) {
                        RangeBarProjection.project(state.data?.state, size, prefs, strings, locale)
                    }
                if (size.isCompact) {
                    RangeBarCompact(state = state, display = display, locale = locale)
                } else {
                    RangeBarStandard(state = state, display = display, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun RangeBarStandard(
    state: UiState<*>,
    display: RangeBarDisplay,
    onRefresh: () -> Unit,
) {
    RangeBarHeader(title = display.title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        RangeBarBars(display = display)
    } else {
        RangeBarEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun RangeBarCompact(
    state: UiState<*>,
    display: RangeBarDisplay,
    locale: Locale,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    if (display.hasData) {
        RangeBarHero(display = display, locale = locale)
    } else {
        RangeBarEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun RangeBarHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.regen,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
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
private fun RangeBarBars(display: RangeBarDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = display.standardContentDescription },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        MetricBar(
            value = display.ratedValue,
            max = display.maxValue,
            label = display.ratedLabel,
            valueText = display.ratedSublabel,
            color = TeslaTokens.chart.regen,
        )
        MetricBar(
            value = display.idealValue,
            max = display.maxValue,
            label = display.idealLabel,
            valueText = display.idealSublabel,
            color = TeslaTokens.chart.power,
        )
        if (display.epaVisible) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Caption("${display.epaLabel} ${display.epaValueText}")
            }
        }
    }
}

@Composable
private fun RangeBarHero(
    display: RangeBarDisplay,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (reduceMotion) {
            MetricValue(display.compactValueText)
        } else {
            AnimatedNumber(value = display.compactRatedValue, decimals = COMPACT_HERO_DECIMALS, locale = locale)
        }
        MetricLabel(display.compactUnitLabel)
    }
}

@Composable
private fun RangeBarEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RangeBarLoading(
    size: RangeBarSize,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (size.isCompact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_HERO_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun RangeBarError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [RangeBarStrings] from the i18n catalog (P1/S10) — the six `widget.*` keys the web
 * component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberRangeBarStrings(): RangeBarStrings {
    val range = stringResource(R.string.translation_widget_rangeBar)
    val rated = stringResource(R.string.translation_widget_rated)
    val ratedRange = stringResource(R.string.translation_widget_ratedRange)
    val idealRange = stringResource(R.string.translation_widget_idealRange)
    val epaComparison = stringResource(R.string.translation_widget_epaComparison)
    val noRange = stringResource(R.string.translation_widget_noRange)
    return remember(range, rated, ratedRange, idealRange, epaComparison, noRange) {
        RangeBarStrings(
            range = range,
            rated = rated,
            ratedRange = ratedRange,
            idealRange = idealRange,
            epaComparison = epaComparison,
            noRange = noRange,
        )
    }
}
