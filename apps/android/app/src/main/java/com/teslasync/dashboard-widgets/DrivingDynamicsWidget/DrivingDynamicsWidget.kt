// The native Jetpack Compose + Material 3 Driving Dynamics dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, a retry surface on a hard error, otherwise a freshness
// header) wrapping one of the web's three bodies: the compact max-g hero (1×N — big number + "Max g" +
// a Smooth/Aggressive badge), the standard layout (three Accel / Brake / Lateral radial gauges + a
// driving-style severity badge) or — when three-plus columns wide — the standard layout plus the
// acceleration-distribution histogram, with a friendly empty state when no dynamics are recorded. All
// data flows through the shared [DrivingDynamicsWidgetViewModel] (P1/S8); the view never performs HTTP.
// G-forces are dimensionless, so no SI conversion happens here — only number formatting. Every string
// resolves through the i18n catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivingDynamicsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingdynamics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale

private val GAUGE_SIZE = 84.dp
private val HISTOGRAM_HEIGHT = 132.dp
private val HERO_MIN_HEIGHT = 44.dp
private val LOADING_NUMBER_HEIGHT = 32.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_BODY_HEIGHT = 96.dp
private const val LOADING_TITLE_FRACTION = 0.45f
private const val LOADING_NUMBER_FRACTION = 0.5f

/**
 * Stateful entry point. Binds the shared vehicles + dynamics + distribution feeds via [source] into a
 * [DrivingDynamicsWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * data layer), an optional [vehicleId] (web `WidgetProps.vehicleId`; `null`/non-positive uses the first
 * enrolled vehicle), and a unique [instanceKey] per placement.
 */
@Composable
fun DrivingDynamicsWidget(
    source: DrivingDynamicsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: DrivingDynamicsSize = DrivingDynamicsRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DrivingDynamicsRegistration.ID,
) {
    val viewModel: DrivingDynamicsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { DrivingDynamicsWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DrivingDynamicsWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard / wide body, with a freshness chip that reflects refreshing/stale/offline. [locale] drives
 * number grouping (tests pin a deterministic locale).
 */
@Composable
fun DrivingDynamicsWidgetContent(
    state: UiState<DrivingDynamicsBundle>,
    size: DrivingDynamicsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    val strings = rememberDrivingDynamicsStrings()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                DrivingDynamicsLoading(compact = size.isCompact, label = stringResource(R.string.translation_a11y_loading))
            state.isError -> DrivingDynamicsError(onRetry = onRefresh)
            else -> {
                val display = remember(state.data, strings, locale) { DrivingDynamicsProjection.project(state.data, strings, locale) }
                if (size.isCompact) {
                    DrivingDynamicsCompact(state = state, display = display)
                } else {
                    DrivingDynamicsStandard(state = state, display = display, size = size, title = strings.title, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun DrivingDynamicsCompact(
    state: UiState<DrivingDynamicsBundle>,
    display: DrivingDynamicsDisplay,
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
        DrivingDynamicsHero(display = display)
    } else {
        DrivingDynamicsEmpty(message = display.noDataMessage)
    }
}

@Composable
private fun DrivingDynamicsHero(display: DrivingDynamicsDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.maxGText)
        MetricLabel(display.maxGLabel)
        Badge(
            text = display.compactWord,
            variant = if (display.smooth) BadgeVariant.Success else BadgeVariant.Warning,
        )
    }
}

@Composable
private fun DrivingDynamicsStandard(
    state: UiState<DrivingDynamicsBundle>,
    display: DrivingDynamicsDisplay,
    size: DrivingDynamicsSize,
    title: String,
    onRefresh: () -> Unit,
) {
    DrivingDynamicsHeader(title = title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        DrivingDynamicsBody(display = display, wide = size.isWide)
    } else {
        DrivingDynamicsEmpty(message = display.noDataMessage)
    }
}

@Composable
private fun DrivingDynamicsHeader(
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
            imageVector = DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
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
private fun DrivingDynamicsBody(
    display: DrivingDynamicsDisplay,
    wide: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.Top,
        ) {
            DrivingGauge(display.accel)
            DrivingGauge(display.brake)
            DrivingGauge(display.lateral)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Badge(text = display.severityWord, variant = severityVariant(display.severity))
        }
        if (wide) {
            DrivingHistogram(bars = display.histogram, title = display.distributionTitle, emptyMessage = display.noDataMessage)
        }
    }
}

@Composable
private fun DrivingGauge(reading: GaugeReading) {
    RadialGauge(
        value = reading.value,
        max = G_MAX,
        label = reading.label,
        color = toneColor(reading.tone),
        size = GAUGE_SIZE,
        decimals = 2,
    )
}

@Composable
private fun DrivingHistogram(
    bars: List<HistogramBar>,
    title: String,
    emptyMessage: String,
) {
    val series =
        remember(bars) {
            listOf(
                ChartSeries(
                    key = "count",
                    label = title,
                    values = bars.map { it.count },
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(0),
                ),
            )
        }
    val xLabels = remember(bars) { bars.map { it.rangeLabel } }
    val description = "$title, ${bars.size}"
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(title)
        BarChartWrapper(
            series = series,
            xLabels = xLabels,
            modifier = Modifier.fillMaxWidth().heightIn(min = HISTOGRAM_HEIGHT).semantics { contentDescription = description },
            height = HISTOGRAM_HEIGHT,
            emptyMessage = emptyMessage,
        )
    }
}

@Composable
private fun DrivingDynamicsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DrivingDynamicsLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_BODY_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun DrivingDynamicsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The standard severity badge variant — the web `SEVERITY_COLORS` four-way ramp via the matching `BadgeVariant`. */
private fun severityVariant(tone: GForceTone): BadgeVariant =
    when (tone) {
        GForceTone.Calm -> BadgeVariant.Success
        GForceTone.Normal -> BadgeVariant.Info
        GForceTone.Sporty -> BadgeVariant.Warning
        GForceTone.Aggressive -> BadgeVariant.Danger
    }

/** The per-theme status color for a g-force [tone] — the native analogue of the web `gaugeColor` ramp. */
@Composable
private fun toneColor(tone: GForceTone): Color =
    when (tone) {
        GForceTone.Calm -> TeslaTokens.status.success
        GForceTone.Normal -> TeslaTokens.status.info
        GForceTone.Sporty -> TeslaTokens.status.warning
        GForceTone.Aggressive -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [DrivingDynamicsStrings] from the i18n catalog (P1/S10) — the nine
 * `widget.drivingDynamics.*` keys the web component reads. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberDrivingDynamicsStrings(): DrivingDynamicsStrings {
    val title = stringResource(R.string.translation_widget_drivingDynamics_title)
    val maxG = stringResource(R.string.translation_widget_drivingDynamics_maxG)
    val smooth = stringResource(R.string.translation_widget_drivingDynamics_smooth)
    val aggressive = stringResource(R.string.translation_widget_drivingDynamics_aggressive)
    val noData = stringResource(R.string.translation_widget_drivingDynamics_noData)
    val accel = stringResource(R.string.translation_widget_drivingDynamics_accel)
    val brake = stringResource(R.string.translation_widget_drivingDynamics_brake)
    val lateral = stringResource(R.string.translation_widget_drivingDynamics_lateral)
    val distribution = stringResource(R.string.translation_widget_drivingDynamics_distribution)
    return remember(title, maxG, smooth, aggressive, noData, accel, brake, lateral, distribution) {
        DrivingDynamicsStrings(
            title = title,
            maxG = maxG,
            smooth = smooth,
            aggressive = aggressive,
            noData = noData,
            accel = accel,
            brake = brake,
            lateral = lateral,
            distribution = distribution,
        )
    }
}

// ── Previews — one per rendered state (content / wide / compact / empty / loading / error / offline). ──

private fun previewDynamics(): JsonElement =
    buildJsonObject {
        put("max_acceleration_g", 0.32)
        put("max_braking_g", 0.28)
        put("max_cornering_g", 0.21)
        put("avg_acceleration_g", 0.18)
        put("avg_braking_g", 0.12)
        put("smoothness_score", 78.0)
    }

private fun previewDistribution(): JsonElement =
    buildJsonObject {
        put(
            "values",
            buildJsonArray {
                add(3.0)
                add(8.0)
                add(14.0)
                add(9.0)
                add(4.0)
                add(2.0)
            },
        )
    }

private fun previewBundle(): DrivingDynamicsBundle = DrivingDynamicsBundle(previewDynamics(), previewDistribution())

@Preview(name = "DrivingDynamics · standard", showBackground = true)
@Composable
private fun DrivingDynamicsStandardPreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewBundle(), fetchedAt = System.currentTimeMillis()),
            size = DrivingDynamicsSize(cols = 2, rows = 4),
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · wide (histogram)", showBackground = true)
@Composable
private fun DrivingDynamicsWidePreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewBundle(), fetchedAt = System.currentTimeMillis()),
            size = DrivingDynamicsSize(cols = 4, rows = 6),
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · compact", showBackground = true)
@Composable
private fun DrivingDynamicsCompactPreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewBundle(), fetchedAt = System.currentTimeMillis()),
            size = DrivingDynamicsSize(cols = 1, rows = 2),
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · empty", showBackground = true)
@Composable
private fun DrivingDynamicsEmptyPreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = DrivingDynamicsBundle(JsonNull, null), fetchedAt = System.currentTimeMillis()),
            size = DrivingDynamicsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · loading", showBackground = true)
@Composable
private fun DrivingDynamicsLoadingPreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState.loading(),
            size = DrivingDynamicsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · error", showBackground = true)
@Composable
private fun DrivingDynamicsErrorPreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = DrivingDynamicsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DrivingDynamics · offline (cached)", showBackground = true)
@Composable
private fun DrivingDynamicsOfflinePreview() {
    TeslaSyncTheme {
        DrivingDynamicsWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewBundle(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = DrivingDynamicsSize(cols = 2, rows = 4),
            onRefresh = {},
        )
    }
}
