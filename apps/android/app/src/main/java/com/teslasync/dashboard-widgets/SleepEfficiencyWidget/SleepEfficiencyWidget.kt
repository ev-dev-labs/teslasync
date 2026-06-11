// The native Jetpack Compose + Material 3 Sleep Efficiency dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the title + Moon
// icon + freshness header for the standard footprint, or a header-less frame for the 1×N compact
// footprint) wrapping the web `WidgetGaugeHero`: a radial gauge of the sleep-efficiency percentage
// (coloured by the efficiency band) and — when the footprint is wider than a single column — the three
// stats beneath it (average daily drain, total sleep hours, wake events). When no card resolves it shows
// the friendly "No sleep efficiency data" empty state. All data flows through the shared
// [SleepEfficiencyWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves through
// the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SleepEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sleepefficiency

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private val GAUGE_SIZE_STANDARD = 104.dp
private val GAUGE_SIZE_COMPACT = 72.dp
private val SKELETON_HEADER_HEIGHT = 14.dp
private val SKELETON_GAUGE_HEIGHT = 96.dp
private const val SKELETON_HEADER_WIDTH_FRACTION = 0.5f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [SleepEfficiencyWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A
 * dashboard host supplies [source] (an adapter over the shared S7/S8 data layer), an optional
 * [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement. [logger] defaults
 * to the app's `LocalDataContainer` redacting logger.
 *
 * @param source the cache-then-network seam (vehicles + sleep-efficiency adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SleepEfficiencyWidget(
    source: SleepEfficiencySource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: SleepEfficiencySize = SleepEfficiencyRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SleepEfficiencyRegistration.ID,
) {
    val viewModel: SleepEfficiencyWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SleepEfficiencyWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    SleepEfficiencyWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the header over the
 * gauge hero, or the "No sleep efficiency data" empty state. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] drives number grouping (tests pin a deterministic
 * locale).
 */
@Composable
fun SleepEfficiencyWidgetContent(
    state: UiState<SleepEfficiencySnapshot?>,
    size: SleepEfficiencySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> SleepEfficiencyLoading()
            state.isError -> SleepEfficiencyError(state = state, onRetry = onRefresh)
            else -> SleepEfficiencyLoaded(state = state, size = size, onRefresh = onRefresh, locale = locale)
        }
    }
}

@Composable
private fun SleepEfficiencyLoaded(
    state: UiState<SleepEfficiencySnapshot?>,
    size: SleepEfficiencySize,
    onRefresh: () -> Unit,
    locale: Locale,
) {
    SleepEfficiencyHeader(state = state, size = size, onRefresh = onRefresh)
    val labels = rememberSleepEfficiencyLabels()
    val snapshot = state.data
    if (snapshot != null) {
        val display =
            remember(snapshot, size, labels, locale) {
                SleepEfficiencyProjection.project(snapshot, labels, size.isCompact, locale)
            }
        SleepEfficiencyHero(display = display, size = size)
    } else {
        SleepEfficiencyEmpty()
    }
}

@Composable
private fun SleepEfficiencyHeader(
    state: UiState<*>,
    size: SleepEfficiencySize,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!size.isCompact) {
            Icon(
                imageVector = SleepEfficiencyGlyphs.Moon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(
                stringResource(R.string.translation_widget_sleepEfficiency_title),
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
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
private fun SleepEfficiencyHero(
    display: SleepEfficiencyDisplay,
    size: SleepEfficiencySize,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = display.efficiencyValue,
            max = SleepEfficiencyProjection.EFFICIENCY_MAX,
            label = display.efficiencyLabel,
            unit = display.efficiencyUnit,
            color = bandColor(display.band),
            size = if (size.isCompact) GAUGE_SIZE_COMPACT else GAUGE_SIZE_STANDARD,
            decimals = display.efficiencyDecimals,
        )
        if (display.stats.isNotEmpty()) {
            SleepEfficiencyStatRow(stats = display.stats)
        }
    }
}

@Composable
private fun SleepEfficiencyStatRow(stats: List<SleepEfficiencyStat>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Top,
    ) {
        stats.forEach { stat -> SleepEfficiencyStatCell(stat = stat) }
    }
}

@Composable
private fun SleepEfficiencyStatCell(stat: SleepEfficiencyStat) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        MetricLabel(stat.label)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Heading(stat.value, level = HeadingLevel.Sub)
            stat.unit?.let { unit -> Caption(unit) }
        }
    }
}

@Composable
private fun SleepEfficiencyEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_sleepEfficiency_noData),
        icon = SleepEfficiencyGlyphs.Moon,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SleepEfficiencyLoading() {
    val label = stringResource(R.string.translation_widget_sleepEfficiency_title)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_HEADER_WIDTH_FRACTION, height = SKELETON_HEADER_HEIGHT)
        Skeleton(height = SKELETON_GAUGE_HEIGHT, rounded = true)
    }
}

@Composable
private fun SleepEfficiencyError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = state.toQueryErrorKind(),
            resourceName = stringResource(R.string.translation_widget_sleepEfficiency_title),
            onRetry = onRetry,
        )
    }
}

/**
 * Builds the localized [SleepEfficiencyLabels] from the i18n catalog (P1/S10) — the five
 * `widget.sleepEfficiency.*` keys the web component reads via `t('widget.…')`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberSleepEfficiencyLabels(): SleepEfficiencyLabels {
    val efficiency = stringResource(R.string.translation_widget_sleepEfficiency_efficiency)
    val avgDrain = stringResource(R.string.translation_widget_sleepEfficiency_avgDrain)
    val totalSleep = stringResource(R.string.translation_widget_sleepEfficiency_totalSleep)
    val hours = stringResource(R.string.translation_widget_sleepEfficiency_hours)
    val wakeEvents = stringResource(R.string.translation_widget_sleepEfficiency_wakeEvents)
    return remember(efficiency, avgDrain, totalSleep, hours, wakeEvents) {
        SleepEfficiencyLabels(
            efficiency = efficiency,
            avgDrain = avgDrain,
            totalSleep = totalSleep,
            hours = hours,
            wakeEvents = wakeEvents,
        )
    }
}

/** Maps an [EfficiencyBand] onto its semantic color (web `efficiencyColor`). */
@Composable
private fun bandColor(band: EfficiencyBand): Color =
    when (band) {
        EfficiencyBand.Good -> TeslaTokens.status.success
        EfficiencyBand.Fair -> TeslaTokens.status.warning
        EfficiencyBand.Poor -> TeslaTokens.status.danger
    }

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Monochrome and recoloured at render time by the
 * [Icon] tint — the same approach as the sibling ProjectedRangeWidget.
 */
private object SleepEfficiencyGlyphs {
    /** lucide `moon` — a crescent (title icon + empty-state icon). */
    val Moon: ImageVector =
        sleepVector("SleepEfficiencyMoon") {
            moveTo(12f, 3f)
            arcToRelative(6f, 6f, 0f, isMoreThanHalf = false, isPositiveArc = false, dx1 = 9f, dy1 = 9f)
            arcToRelative(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, dx1 = -9f, dy1 = -9f)
            close()
        }
}

private fun sleepVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
