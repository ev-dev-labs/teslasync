// The native Jetpack Compose + Material 3 Motor Performance dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header —
// with a bolt-iconed title on the standard footprint, header-less title on the compact footprint) wrapping
// the rendered content: on the standard footprint a torque radial gauge (colored by the torque band) over
// a two-column Stator Temp / Gear State / Lateral G / Longitudinal G stat grid; on the compact footprint
// the gear + torque read-outs — or, when no motor snapshot resolves, the friendly "No motor data" empty
// state. All data flows through the shared [MotorPerformanceWidgetViewModel] (P1/S8); the view never
// performs HTTP. The SI stator temperature is converted to the user's unit at this render boundary via the
// live [UnitFormatter] (web `useUnits()`), every string resolves through the i18n catalog (P1/S10), and the
// refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MotorPerformanceWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorperformance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val STANDARD_GAUGE_SIZE: Dp = 100.dp
private val COMPACT_GAUGE_SIZE: Dp = 70.dp
private val BODY_MIN_HEIGHT: Dp = 120.dp
private val SKELETON_HEADER_HEIGHT: Dp = 14.dp
private const val LOADING_HEADER_FRACTION = 0.5f
private const val LOADING_GAUGE_FRACTION = 0.7f
private const val GAUGE_DECIMALS = 0
private const val STAT_COLUMNS = 2

/**
 * Stateful entry point. Binds the shared vehicles + latest-motor feeds via [source] into a
 * [MotorPerformanceWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 data layer), the grid [size]
 * (web `WidgetProps.size`), an optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique
 * [instanceKey] per placement.
 */
@Composable
fun MotorPerformanceWidget(
    source: MotorPerformanceSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: MotorPerformanceSize = MotorPerformanceRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = MotorPerformanceRegistration.ID,
) {
    val viewModel: MotorPerformanceWidgetViewModel =
        viewModel(key = instanceKey, factory = MotorPerformanceWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    MotorPerformanceWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness header
 * over the gauge/grid (standard) or gear/torque read-outs (compact), or the empty state. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display temperature
 * conversion at the render boundary; [size] selects the compact vs standard layout (web `size.cols`).
 */
@Composable
fun MotorPerformanceWidgetContent(
    state: UiState<MotorSnapshot?>,
    prefs: UnitPref,
    size: MotorPerformanceSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMotorPerformanceStrings()
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> MotorPerformanceLoading(compact = size.isCompact)
            state.isError -> MotorPerformanceErrorState(state = state, onRetry = onRefresh)
            else -> MotorPerformanceLoaded(state = state, prefs = prefs, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun MotorPerformanceLoaded(
    state: UiState<MotorSnapshot?>,
    prefs: UnitPref,
    size: MotorPerformanceSize,
    strings: MotorPerformanceStrings,
    onRefresh: () -> Unit,
) {
    val compact = size.isCompact
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MotorPerformanceHeader(title = if (compact) null else strings.title, state = state, onRefresh = onRefresh)
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = BODY_MIN_HEIGHT)
                    .padding(vertical = Spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            val snapshot = state.data
            if (snapshot != null) {
                val display = remember(snapshot, prefs, strings) { MotorPerformanceProjection.project(snapshot, prefs, strings) }
                if (compact) {
                    MotorPerformanceCompact(display = display, strings = strings)
                } else {
                    MotorPerformanceStandard(display = display, strings = strings)
                }
            } else {
                EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Bolt)
            }
        }
    }
}

@Composable
private fun MotorPerformanceHeader(
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
                imageVector = DataDisplayGlyphs.Bolt,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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
private fun MotorPerformanceStandard(
    display: MotorPerformanceDisplay,
    strings: MotorPerformanceStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RadialGauge(
            value = display.gaugeValue,
            max = MotorPerformanceProjection.TORQUE_MAX,
            label = display.torqueText,
            unit = strings.nm,
            color = bandColor(display.band),
            size = STANDARD_GAUGE_SIZE,
            decimals = GAUGE_DECIMALS,
        )
        MotorStatGrid(stats = display.stats)
    }
}

@Composable
private fun MotorStatGrid(stats: List<MotorStat>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(STAT_COLUMNS).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                rowStats.forEach { stat ->
                    StatCard(
                        label = stat.label,
                        value = stat.value,
                        unit = stat.unit,
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(STAT_COLUMNS - rowStats.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun MotorPerformanceCompact(
    display: MotorPerformanceDisplay,
    strings: MotorPerformanceStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Caption(strings.gear)
        MetricValue(display.gearText)
        Caption(strings.torque, modifier = Modifier.padding(top = Spacing.xs))
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Subhead(display.torqueText)
            Caption(strings.nm)
        }
    }
}

@Composable
private fun MotorPerformanceLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
    ) {
        Skeleton(widthFraction = LOADING_HEADER_FRACTION, height = SKELETON_HEADER_HEIGHT)
        Skeleton(
            height = if (compact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE,
            widthFraction = LOADING_GAUGE_FRACTION,
            rounded = true,
        )
    }
}

@Composable
private fun MotorPerformanceErrorState(
    state: UiState<MotorSnapshot?>,
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
            resourceName = stringResource(R.string.translation_widget_motorPerformance_title),
            onRetry = onRetry,
        )
    }
}

/**
 * Folds a [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/** Maps a [TorqueBand] onto its semantic color (web `torqueColor`: low → green, medium → amber, high → red). */
@Composable
private fun bandColor(band: TorqueBand): Color =
    when (band) {
        TorqueBand.Low -> TeslaTokens.status.success
        TorqueBand.Medium -> TeslaTokens.status.warning
        TorqueBand.High -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [MotorPerformanceStrings] from the i18n catalog (P1/S10) — the nine
 * `widget.motorPerformance.*` keys the web component reads via `t('widget.motorPerformance.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberMotorPerformanceStrings(): MotorPerformanceStrings {
    val title = stringResource(R.string.translation_widget_motorPerformance_title)
    val gear = stringResource(R.string.translation_widget_motorPerformance_gear)
    val torque = stringResource(R.string.translation_widget_motorPerformance_torque)
    val nm = stringResource(R.string.translation_widget_motorPerformance_nm)
    val statorTemp = stringResource(R.string.translation_widget_motorPerformance_statorTemp)
    val gearState = stringResource(R.string.translation_widget_motorPerformance_gearState)
    val lateralG = stringResource(R.string.translation_widget_motorPerformance_lateralG)
    val longitudinalG = stringResource(R.string.translation_widget_motorPerformance_longitudinalG)
    val noData = stringResource(R.string.translation_widget_motorPerformance_noData)
    return remember(title, gear, torque, nm, statorTemp, gearState, lateralG, longitudinalG, noData) {
        MotorPerformanceStrings(
            title = title,
            gear = gear,
            torque = torque,
            nm = nm,
            statorTemp = statorTemp,
            gearState = gearState,
            lateralG = lateralG,
            longitudinalG = longitudinalG,
            noData = noData,
        )
    }
}

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ─────────

private fun previewMotor(): JsonElement =
    buildJsonObject {
        put("di_torque", 342.0)
        put("di_stator_temp", 64.0)
        put("gear", "D")
        put("lateral_accel", 0.18)
        put("longitudinal_accel", 0.42)
    }

private fun previewSnapshot(): MotorSnapshot = requireNotNull(MotorSnapshot.fromJson(previewMotor()))

@Preview(name = "MotorPerformance · content", showBackground = true)
@Composable
private fun MotorPerformanceContentPreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceRegistration.defaultSize,
        )
    }
}

@Preview(name = "MotorPerformance · compact", showBackground = true)
@Composable
private fun MotorPerformanceCompactPreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "MotorPerformance · empty", showBackground = true)
@Composable
private fun MotorPerformanceEmptyPreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = null, fetchedAt = System.currentTimeMillis()),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceRegistration.defaultSize,
        )
    }
}

@Preview(name = "MotorPerformance · loading", showBackground = true)
@Composable
private fun MotorPerformanceLoadingPreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state = UiState.loading(),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceRegistration.defaultSize,
        )
    }
}

@Preview(name = "MotorPerformance · error", showBackground = true)
@Composable
private fun MotorPerformanceErrorPreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceRegistration.defaultSize,
        )
    }
}

@Preview(name = "MotorPerformance · offline (cached)", showBackground = true)
@Composable
private fun MotorPerformanceOfflinePreview() {
    TeslaSyncTheme {
        MotorPerformanceWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            prefs = UnitFormatter.default().prefs,
            size = MotorPerformanceRegistration.defaultSize,
        )
    }
}
