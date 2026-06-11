// The native Jetpack Compose + Material 3 Mileage Stats dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MileageStatsWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header) wrapping one
// of the two bodies the web renders: the compact daily-average hero (1×N — a big distance number + a
// "{unit}/day" label) or — when wider — the standard layout (a stat grid of Daily / Weekly / Monthly Avg
// plus a Next Milestone projection), with a friendly empty state when no payload exists. All data flows
// through the shared [MileageStatsWidgetViewModel]; SI kilometres are converted to the user's distance
// unit at this render boundary via the live [UnitFormatter]. The view never performs HTTP. Every string
// resolves through the i18n catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MileageStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mileagestats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
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
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val HERO_MIN_HEIGHT = 44.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_HERO_HEIGHT = 32.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_HERO_FRACTION = 0.6f
private const val COMPACT_HERO_DECIMALS = 0
private const val STAT_COUNT = 4

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [MileageStatsWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement. [units] defaults to the app's
 * `LocalDataContainer` live formatter (web `useUnits`).
 *
 * @param source the cache-then-network seam (vehicles + mileage-stats adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MileageStatsWidget(
    source: MileageStatsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: MileageStatsSize = MileageStatsRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MileageStatsRegistration.ID,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val viewModel: MileageStatsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { MileageStatsWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    MileageStatsWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI-kilometre → display-unit
 * distance conversion; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun MileageStatsWidgetContent(
    state: UiState<JsonElement>,
    prefs: UnitPref,
    size: MileageStatsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMileageStatsStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                MileageStatsLoading(size = size, label = stringResource(R.string.translation_a11y_loading))

            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val display =
                    remember(state.data, size, prefs, strings, locale) {
                        MileageStatsProjection.project(parseMileageStats(state.data), size, strings, prefs, locale)
                    }
                if (size.isCompact) {
                    MileageStatsCompact(state = state, display = display, locale = locale)
                } else {
                    MileageStatsStandard(state = state, display = display, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun MileageStatsCompact(
    state: UiState<JsonElement>,
    display: MileageStatsDisplay,
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
        MileageStatsHero(display = display, locale = locale)
    } else {
        MileageStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun MileageStatsHero(
    display: MileageStatsDisplay,
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
            AnimatedNumber(value = display.compactDailyAvg, decimals = COMPACT_HERO_DECIMALS, locale = locale)
        }
        MetricLabel(display.compactUnitLabel)
    }
}

@Composable
private fun MileageStatsStandard(
    state: UiState<JsonElement>,
    display: MileageStatsDisplay,
    onRefresh: () -> Unit,
) {
    MileageStatsHeader(title = display.title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        MileageStatsStatGrid(stats = display.stats, columns = display.statGridColumns)
    } else {
        MileageStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun MileageStatsHeader(
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
            MileageStatsGlyphs.TrendingUp,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.battery,
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
            imageVector = MileageStatsGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun MileageStatsStatGrid(
    stats: List<MileageStatItem>,
    columns: Int,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item -> MileageStatTile(item = item) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun RowScope.MileageStatTile(item: MileageStatItem) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = Modifier.weight(1f),
        unit = item.unit,
        icon = item.icon.glyph(),
        trend = item.trend?.toStatTrend(),
    )
}

@Composable
private fun MileageStatsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = MileageStatsGlyphs.TrendingUp,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun MileageStatsLoading(
    size: MileageStatsSize,
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
            StatGridSkeleton(count = STAT_COUNT)
        }
    }
}

/**
 * Builds the localized [MileageStatsStrings] from the i18n catalog (P1/S10) — the eight
 * `widget.mileageStats.*` keys the web component reads via `t('widget.mileageStats.…')`. The `inMonths`
 * value is the raw `~%1$s mo` format template; the projection fills its single argument. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberMileageStatsStrings(): MileageStatsStrings {
    val title = stringResource(R.string.translation_widget_mileageStats_title)
    val dailyAvg = stringResource(R.string.translation_widget_mileageStats_dailyAvg)
    val weeklyAvg = stringResource(R.string.translation_widget_mileageStats_weeklyAvg)
    val monthlyAvg = stringResource(R.string.translation_widget_mileageStats_monthlyAvg)
    val nextMilestone = stringResource(R.string.translation_widget_mileageStats_nextMilestone)
    val inMonths = stringResource(R.string.translation_widget_mileageStats_inMonths)
    val day = stringResource(R.string.translation_widget_mileageStats_day)
    val noData = stringResource(R.string.translation_widget_mileageStats_noData)
    return remember(title, dailyAvg, weeklyAvg, monthlyAvg, nextMilestone, inMonths, day, noData) {
        MileageStatsStrings(
            title = title,
            dailyAvg = dailyAvg,
            weeklyAvg = weeklyAvg,
            monthlyAvg = monthlyAvg,
            nextMilestone = nextMilestone,
            inMonths = inMonths,
            day = day,
            noData = noData,
        )
    }
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
 * Maps a projected [MileageStatTrend] onto the shared [StatTrend] chip. `positive` is derived from the
 * direction here (web `positive: stat.trend === 'up'`), keeping the projection pure presentation data.
 */
private fun MileageStatTrend.toStatTrend(): StatTrend =
    StatTrend(
        direction =
            when (direction) {
                MileageTrendDirection.Up -> DeltaArrow.Up
                MileageTrendDirection.Down -> DeltaArrow.Down
                MileageTrendDirection.Flat -> DeltaArrow.Flat
            },
        text = text,
        positive = direction == MileageTrendDirection.Up,
    )

/** Resolves the stat marker to its self-contained line glyph. */
private fun MileageStatIcon.glyph(): ImageVector =
    when (this) {
        MileageStatIcon.DailyAvg -> MileageStatsGlyphs.Route
        MileageStatIcon.WeeklyAvg -> MileageStatsGlyphs.Calendar
        MileageStatIcon.MonthlyAvg -> MileageStatsGlyphs.TrendingUp
        MileageStatIcon.NextMilestone -> MileageStatsGlyphs.Target
    }

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render time
 * by the [Icon]/[StatCard] tint — the same approach as the sibling EnergyStatsWidget.
 */
private object MileageStatsGlyphs {
    /** lucide `trending-up` — the rising trend arrow (title icon, Monthly Avg tile, empty-state icon). */
    val TrendingUp: ImageVector =
        mileageVector("MileageStatsTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** lucide `route` — connected waypoints (Daily Avg tile). */
    val Route: ImageVector =
        mileageVector("MileageStatsRoute") {
            moveTo(6f, 19f)
            lineTo(14f, 19f)
            curveTo(16.2f, 19f, 18f, 17.2f, 18f, 15f)
            curveTo(18f, 12.8f, 16.2f, 11f, 14f, 11f)
            lineTo(10f, 11f)
            curveTo(7.8f, 11f, 6f, 9.2f, 6f, 7f)
            curveTo(6f, 4.8f, 7.8f, 3f, 10f, 3f)
            lineTo(18f, 3f)
        }

    /** lucide `calendar` — a month grid with two top tabs and a header rule (Weekly Avg tile). */
    val Calendar: ImageVector =
        mileageVector("MileageStatsCalendar") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
        }

    /** lucide `target` — concentric bullseye rings (Next Milestone tile). */
    val Target: ImageVector =
        mileageVector("MileageStatsTarget") {
            circle(12f, 12f, 9f)
            circle(12f, 12f, 5f)
            circle(12f, 12f, 1.5f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        mileageVector("MileageStatsRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

/** Appends a closed circle of radius [r] centred at ([cx], [cy]) as four cubic-Bézier quadrants. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = CIRCLE_BEZIER_K * r
    moveTo(cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    close()
}

/** Cubic-Bézier control-point ratio that approximates a circular quadrant (4/3·(√2−1)). */
private const val CIRCLE_BEZIER_K = 0.5522847f

private fun mileageVector(
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
