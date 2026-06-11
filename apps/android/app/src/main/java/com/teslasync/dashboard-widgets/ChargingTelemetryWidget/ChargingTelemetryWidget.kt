// The native Jetpack Compose + Material 3 Charging Telemetry dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx. It mirrors the web `WidgetShell`
// (a full skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the title +
// gauge icon + freshness header for the standard/wide footprint, or a freshness-overlaid frame for
// the compact footprint) wrapping either the live charging stat grid (voltage / current / power /
// phases, plus an efficiency stat and a charger-type badge + rolling power sparkline when wide), the
// compact charging hero (1×N), or — when the pack is not charging / no telemetry resolved — the
// friendly "Not currently charging" empty state. All data flows through the shared
// [ChargingTelemetryWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves
// through the i18n catalog and the compact hero / refresh control carry TalkBack labels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingtelemetry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

private val SPARKLINE_HEIGHT = 28.dp
private val HERO_MIN_HEIGHT = 44.dp
private val HEADER_SKELETON_HEIGHT = 14.dp
private const val HEADER_SKELETON_WIDTH_FRACTION = 0.5f
private const val LOADING_STAT_SKELETON_COUNT = 4
private const val MIN_SPARKLINE_POINTS = 1

/**
 * Stateful entry point. Collects the shared [ChargingTelemetryWidgetViewModel] state + accumulated
 * power series, records the one-shot `view.opened` diagnostic, and renders the surface for the given
 * [size]. A dashboard host supplies the view-model (wired via [ChargingTelemetryWidgetViewModel.create]).
 */
@Composable
fun ChargingTelemetryWidget(
    viewModel: ChargingTelemetryWidgetViewModel,
    modifier: Modifier = Modifier,
    size: ChargingTelemetrySize = ChargingTelemetryRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val powerHistory by viewModel.powerHistory.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    ChargingTelemetryWidgetContent(
        state = state,
        powerHistory = powerHistory,
        size = size,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → full skeleton, hard error → retry) and otherwise the
 * compact / standard / wide charging body or the "Not currently charging" empty state. [powerHistory]
 * is the rolling watt series the wide sparkline draws.
 */
@Composable
fun ChargingTelemetryWidgetContent(
    state: UiState<ChargingTelemetrySnapshot?>,
    powerHistory: List<Double>,
    size: ChargingTelemetrySize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = rememberChargingTelemetryLabels()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(state, onRetry, modifier)
        else -> {
            val display =
                remember(state.data, size, labels) {
                    ChargingTelemetryProjection.project(state.data, size, labels)
                }
            LoadedChrome(
                state = state,
                display = display,
                powerHistory = powerHistory,
                onRetry = onRetry,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<ChargingTelemetrySnapshot?>,
    display: ChargingTelemetryDisplay,
    powerHistory: List<Double>,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    if (display.isCompact) {
        CompactChrome(state = state, display = display, modifier = modifier)
        return
    }
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRetry = onRetry)
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (display.isCharging) {
                StandardBody(display = display, powerHistory = powerHistory)
            } else {
                NotChargingEmpty()
            }
        }
    }
}

@Composable
private fun CompactChrome(
    state: UiState<ChargingTelemetrySnapshot?>,
    display: ChargingTelemetryDisplay,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.sm)) {
        if (display.isCharging) {
            CompactHero(display = display, modifier = Modifier.align(Alignment.Center))
        } else {
            NotChargingEmpty(modifier = Modifier.align(Alignment.Center))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
            modifier = Modifier.align(Alignment.TopEnd),
        )
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<ChargingTelemetrySnapshot?>,
    onRetry: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = GaugeIcon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_chargingTelemetry_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
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
            onClick = onRetry,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun StandardBody(
    display: ChargingTelemetryDisplay,
    powerHistory: List<Double>,
) {
    ChargingStatGrid(stats = display.stats, columns = display.statColumns)
    if (display.isWide) {
        WideExtras(display = display, powerHistory = powerHistory)
    }
}

@Composable
private fun ChargingStatGrid(
    stats: List<ChargingTelemetryStat>,
    columns: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(columns).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowStats.forEach { stat ->
                    StatCard(
                        label = stat.label,
                        value = stat.value,
                        unit = stat.unit,
                        icon = glyphVector(stat.glyph),
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(columns - rowStats.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun WideExtras(
    display: ChargingTelemetryDisplay,
    powerHistory: List<Double>,
) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (display.hasChargerBadge) {
            Badge(
                text = display.chargerBadgeText,
                variant = chargerBadgeVariant(display.chargerType),
                modifier = Modifier.semantics { contentDescription = display.chargerBadgeText },
            )
        }
        if (powerHistory.size > MIN_SPARKLINE_POINTS) {
            BoxWithConstraints(modifier = Modifier.weight(1f)) {
                Sparkline(
                    data = powerHistory,
                    color = TeslaTokens.status.success,
                    width = maxWidth,
                    height = SPARKLINE_HEIGHT,
                )
            }
        }
    }
}

@Composable
private fun CompactHero(
    display: ChargingTelemetryDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = BatteryChargingIcon,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.success,
        )
        MetricValue(display.heroPowerText)
        Caption(display.heroSummaryText)
    }
}

@Composable
private fun NotChargingEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_widget_chargingTelemetry_notCharging),
        icon = PlugIcon,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_widget_chargingTelemetry_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = HEADER_SKELETON_HEIGHT, rounded = true, widthFraction = HEADER_SKELETON_WIDTH_FRACTION)
        StatGridSkeleton(count = LOADING_STAT_SKELETON_COUNT)
    }
}

@Composable
private fun ErrorChrome(
    state: UiState<ChargingTelemetrySnapshot?>,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.md), contentAlignment = Alignment.Center) {
        QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
    }
}

@Composable
private fun rememberChargingTelemetryLabels(): ChargingTelemetryLabels =
    ChargingTelemetryLabels(
        voltage = stringResource(R.string.translation_widget_chargingTelemetry_voltage),
        current = stringResource(R.string.translation_widget_chargingTelemetry_current),
        power = stringResource(R.string.translation_widget_chargingTelemetry_power),
        phases = stringResource(R.string.translation_widget_chargingTelemetry_phases),
        efficiency = stringResource(R.string.translation_widget_chargingTelemetry_efficiency),
        charger = stringResource(R.string.translation_widget_chargingTelemetry_charger),
    )

/** The web `Badge` variant for a charger family (web `chargerType === 'DC' ? 'warning' : 'neutral'`). */
private fun chargerBadgeVariant(chargerType: ChargerType?): BadgeVariant =
    when (chargerType) {
        ChargerType.Dc -> BadgeVariant.Warning
        else -> BadgeVariant.Neutral
    }

/** Maps a pure [ChargingTelemetryGlyph] onto the locally-authored `lucide`-equivalent vector. */
private fun glyphVector(glyph: ChargingTelemetryGlyph): ImageVector =
    when (glyph) {
        ChargingTelemetryGlyph.Bolt -> ZapIcon
        ChargingTelemetryGlyph.Gauge -> GaugeIcon
        ChargingTelemetryGlyph.BatteryCharging -> BatteryChargingIcon
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

// ── Locally-authored stroked icons (the web `lucide-react` Zap / Gauge / BatteryCharging / Plug) ──
// Authored here because the app's shared icon set has no equivalents and the shared glyph objects are
// out of this surface's allowed files (the same approach as the sibling BatteryCellsWidget's Cpu glyph).
// Each is a 24×24 stroked vector recolored at render time by [Icon]/[StatCard]/[EmptyState]'s tint.

private fun lucideIcon(
    name: String,
    block: PathBuilder.() -> Unit,
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
                pathBuilder = block,
            )
        }.build()

/** lucide `zap` — the lightning-bolt polygon. */
private val ZapIcon: ImageVector =
    lucideIcon("Zap") {
        moveTo(13f, 2f)
        lineTo(3f, 14f)
        lineTo(12f, 14f)
        lineTo(11f, 22f)
        lineTo(21f, 10f)
        lineTo(12f, 10f)
        close()
    }

/** lucide `gauge` — the dial arc with a needle. */
private val GaugeIcon: ImageVector =
    lucideIcon("Gauge") {
        moveTo(12f, 14f)
        lineToRelative(4f, -4f)
        moveTo(3.34f, 19f)
        arcToRelative(10f, 10f, 0f, true, true, 17.32f, 0f)
    }

/** lucide `battery-charging` — the battery body, terminal and inner bolt. */
private val BatteryChargingIcon: ImageVector =
    lucideIcon("BatteryCharging") {
        moveTo(15f, 7f)
        horizontalLineToRelative(1f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
        verticalLineToRelative(6f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
        horizontalLineToRelative(-2f)
        moveTo(6f, 7f)
        horizontalLineTo(4f)
        arcToRelative(2f, 2f, 0f, false, false, -2f, 2f)
        verticalLineToRelative(6f)
        arcToRelative(2f, 2f, 0f, false, false, 2f, 2f)
        horizontalLineToRelative(1f)
        moveTo(11f, 7f)
        lineToRelative(-3f, 5f)
        horizontalLineToRelative(4f)
        lineToRelative(-3f, 5f)
        moveTo(22f, 11f)
        verticalLineTo(13f)
    }

/** lucide `plug` — the two prongs, body and cord. */
private val PlugIcon: ImageVector =
    lucideIcon("Plug") {
        moveTo(12f, 22f)
        verticalLineToRelative(-5f)
        moveTo(9f, 8f)
        verticalLineTo(2f)
        moveTo(15f, 8f)
        verticalLineTo(2f)
        moveTo(18f, 8f)
        verticalLineToRelative(5f)
        arcToRelative(4f, 4f, 0f, false, true, -4f, 4f)
        horizontalLineToRelative(-4f)
        arcToRelative(4f, 4f, 0f, false, true, -4f, -4f)
        verticalLineTo(8f)
        close()
    }
