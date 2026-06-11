// The native Jetpack Compose + Material 3 Odometer Counter dashboard surface — a parity port of
// web/src/features/dashboard/widgets/OdometerCounterWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise — on the expanded footprint — a
// gauge-iconed "Odometer" title + freshness header) wrapping one of the bodies the web ternary renders:
// the compact number-only count-up (1×1), the expanded "Total Odometer" count-up, plus — when wide — the
// "Total Driven" / "Unit" breakdown grid, or a friendly empty state when no odometer is decoded. All data
// flows through the shared [OdometerCounterWidgetViewModel] (P1/S8); the view never performs HTTP. The SI
// odometer is converted to the user's unit at this render boundary via the live [UnitFormatter] (web
// `useUnits()`), every string resolves through the i18n catalog (P1/S10), and the refresh control carries a
// TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/OdometerCounterWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.odometercounter

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared vehicles + vehicle-state + driving-stats feeds via [source] into an
 * [OdometerCounterWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 data layer), the grid [size]
 * (web `WidgetProps.size`), an optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique
 * [instanceKey] per placement.
 */
@Composable
fun OdometerCounterWidget(
    source: OdometerCounterSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: OdometerCounterSize = OdometerCounterRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = OdometerCounterRegistration.ID,
) {
    val viewModel: OdometerCounterWidgetViewModel =
        viewModel(key = instanceKey, factory = OdometerCounterWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    OdometerCounterWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the count-up body over
 * the freshness header. [prefs] supplies the SI→display distance conversion at the render boundary; [size]
 * selects the compact (number-only) vs expanded vs wide (expanded + breakdown grid) layout (web `size`).
 */
@Composable
fun OdometerCounterWidgetContent(
    state: UiState<OdometerSnapshot>,
    prefs: UnitPref,
    size: OdometerCounterSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    val strings = rememberOdometerCounterStrings()
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> OdometerLoading()
            state.isError -> OdometerError(state = state, resourceName = strings.title, onRetry = onRefresh)
            else -> OdometerLoaded(state = state, prefs = prefs, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun OdometerLoaded(
    state: UiState<OdometerSnapshot>,
    prefs: UnitPref,
    size: OdometerCounterSize,
    strings: OdometerCounterStrings,
    onRefresh: () -> Unit,
) {
    val compact = OdometerCounterRegistration.isCompact(size)
    val snapshot = state.data ?: OdometerSnapshot(odometerMeters = null, totalDistanceKm = null)
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        OdometerHeader(
            title = if (compact) null else strings.title,
            state = state,
            onRefresh = onRefresh,
        )
        Box(
            modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            if (snapshot.odometerMeters != null) {
                val display = remember(snapshot, prefs) { OdometerCounterProjection.project(snapshot, prefs) }
                if (compact) {
                    OdometerCompact(display = display)
                } else {
                    OdometerExpanded(display = display, isWide = OdometerCounterRegistration.isWide(size), strings = strings)
                }
            } else {
                EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Gauge, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun OdometerHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = DataDisplayGlyphs.Gauge,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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

/** Compact (1×1) body — the rolling odometer count-up over its unit label (web `CompactView`). */
@Composable
private fun OdometerCompact(display: OdometerCounterDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "${display.odometerText} ${display.unit}" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(value = display.odometerValue, decimals = ODOMETER_DECIMALS)
        MetricLabel(text = display.unit)
    }
}

/**
 * Expanded body — the "Total Odometer" label over the rolling count-up (with the unit suffix), plus the
 * "Total Driven" / "Unit" breakdown grid when [isWide] (web `ExpandedView` + `isWide` grid).
 */
@Composable
private fun OdometerExpanded(
    display: OdometerCounterDisplay,
    isWide: Boolean,
    strings: OdometerCounterStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clearAndSetSemantics { contentDescription = "${strings.total}, ${display.odometerText} ${display.unit}" },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricLabel(text = strings.total)
            AnimatedNumber(value = display.odometerValue, decimals = ODOMETER_DECIMALS, suffix = " ${display.unit}")
        }
        if (isWide) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                MetricCard(
                    label = strings.totalDriven,
                    value = display.totalDrivenText,
                    icon = DataDisplayGlyphs.ArrowUp,
                    accent = TeslaTokens.status.success,
                    modifier = Modifier.weight(1f),
                )
                MetricCard(
                    label = strings.unit,
                    value = display.unit,
                    icon = FormsGlyphs.Calendar,
                    accent = TeslaTokens.status.warning,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun OdometerLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_LABEL_FRACTION, height = LOADING_LABEL_HEIGHT)
        Skeleton(height = LOADING_VALUE_HEIGHT, rounded = true)
    }
}

@Composable
private fun OdometerError(
    state: UiState<OdometerSnapshot>,
    resourceName: String,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind =
                classifyQueryError(
                    status = state.httpStatus,
                    online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                    transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
                ),
            resourceName = resourceName,
            onRetry = onRetry,
        )
    }
}

/**
 * Builds the localized [OdometerCounterStrings] from the i18n catalog (P1/S10) — the five `widget.odometer.*`
 * keys the web component reads via `t('widget.odometer.…')`. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberOdometerCounterStrings(): OdometerCounterStrings {
    val title = stringResource(R.string.translation_widget_odometer_title)
    val noData = stringResource(R.string.translation_widget_odometer_noData)
    val total = stringResource(R.string.translation_widget_odometer_total)
    val totalDriven = stringResource(R.string.translation_widget_odometer_totalDriven)
    val unit = stringResource(R.string.translation_widget_odometer_unit)
    return remember(title, noData, total, totalDriven, unit) {
        OdometerCounterStrings(
            title = title,
            noData = noData,
            total = total,
            totalDriven = totalDriven,
            unit = unit,
        )
    }
}

private val BODY_MIN_HEIGHT: Dp = 88.dp
private val LOADING_LABEL_HEIGHT: Dp = 12.dp
private val LOADING_VALUE_HEIGHT: Dp = 36.dp
private const val LOADING_LABEL_FRACTION: Float = 0.4f
private const val ODOMETER_DECIMALS: Int = 0

// ── Previews — one per rendered state (expanded / wide / compact / empty / loading / error / offline). ──

private fun previewSnapshot(): OdometerSnapshot = OdometerSnapshot(odometerMeters = 402_336.0, totalDistanceKm = 80_467.2)

@Preview(name = "OdometerCounter · expanded", showBackground = true)
@Composable
private fun OdometerCounterExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterRegistration.defaultSize,
        )
    }
}

@Preview(name = "OdometerCounter · wide", showBackground = true)
@Composable
private fun OdometerCounterWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterSize(cols = 2, rows = 2),
        )
    }
}

@Preview(name = "OdometerCounter · compact", showBackground = true)
@Composable
private fun OdometerCounterCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterSize(cols = 1, rows = 1),
        )
    }
}

@Preview(name = "OdometerCounter · empty", showBackground = true)
@Composable
private fun OdometerCounterEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = OdometerSnapshot(null, null), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterRegistration.defaultSize,
        )
    }
}

@Preview(name = "OdometerCounter · loading", showBackground = true)
@Composable
private fun OdometerCounterLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Loading),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterRegistration.defaultSize,
        )
    }
}

@Preview(name = "OdometerCounter · error", showBackground = true)
@Composable
private fun OdometerCounterErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OdometerCounterWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = UnitFormatter.default().prefs,
            size = OdometerCounterRegistration.defaultSize,
        )
    }
}

private const val PREVIEW_NOW: Long = 1_780_000_000_000L
