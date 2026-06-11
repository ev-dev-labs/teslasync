// The native Jetpack Compose + Material 3 Year in Review dashboard surface — a parity port of
// web/src/features/dashboard/widgets/YearReviewWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of the bodies
// the web renders: the compact year-distance hero (1×N — big animated number + "{unit} in {year}"
// caption), the standard 2-up stat grid (Total Miles / Total Drives / Energy Used / CO₂ Saved / Best Month
// / Longest Drive), or — when wide — the 4-up grid that folds in Driving Time + Top Speed, with a friendly
// empty state when no annual data is available. All data flows through the shared
// [YearReviewWidgetViewModel]; SI figures are converted at this render boundary via the live
// [YearReviewDisplayPrefs]. The view never performs HTTP. Every string resolves through the i18n catalog
// and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/YearReviewWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.yearreview

import androidx.compose.foundation.layout.Arrangement
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
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.time.Year
import java.util.Locale

private val HERO_MIN_HEIGHT = 44.dp
private val LOADING_BAR_HEIGHT = 32.dp
private val LOADING_ROW_HEIGHT = 44.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_NUMBER_FRACTION = 0.6f

/** Web `WidgetStatGrid cols={isWide ? 4 : 2}` — the two grid column counts the standard/wide bodies use. */
private const val STANDARD_GRID_COLS = 2
private const val WIDE_GRID_COLS = 4

// Authored glyph geometry (the curated icon sets have no leaf / star / trending-up / timer analogue).
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [YearReviewWidgetViewModel], records the
 * one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + analytics + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle (and
 *   the empty surface when there is none — web `enabled: !!vehicleId`).
 * @param year the recap year (web `new Date().getFullYear()`); defaults to the current calendar year.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun YearReviewWidget(
    source: YearReviewSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: YearReviewSize = YearReviewRegistration.defaultSize,
    year: Int = Year.now().value,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = YearReviewRegistration.ID,
) {
    val viewModel: YearReviewWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { YearReviewWidgetViewModel(source, logger, year, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    YearReviewWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        year = year,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard / wide body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display conversion;
 * [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun YearReviewWidgetContent(
    state: UiState<JsonElement>,
    prefs: YearReviewDisplayPrefs,
    size: YearReviewSize,
    year: Int,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberYearReviewStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                YearReviewLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> YearReviewError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, year, locale) {
                        YearReviewProjection.project(parseYearReview(state.data), prefs, strings, year, locale)
                    }
                if (size.isCompact) {
                    YearReviewCompact(state = state, display = display, locale = locale)
                } else {
                    YearReviewStandard(state = state, display = display, size = size, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun YearReviewCompact(
    state: UiState<JsonElement>,
    display: YearReviewDisplay,
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
        YearReviewHero(display = display, locale = locale)
    } else {
        YearReviewEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun YearReviewHero(
    display: YearReviewDisplay,
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
            MetricValue(ChartFormat.number(display.compactValue, display.compactDecimals, locale))
        } else {
            AnimatedNumber(value = display.compactValue, decimals = display.compactDecimals, locale = locale)
        }
        Caption(display.compactCaption)
    }
}

@Composable
private fun YearReviewStandard(
    state: UiState<JsonElement>,
    display: YearReviewDisplay,
    size: YearReviewSize,
    onRefresh: () -> Unit,
) {
    YearReviewHeader(title = display.title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        YearReviewStatGrid(
            items = display.statsFor(size.isWide),
            columns = if (size.isWide) WIDE_GRID_COLS else STANDARD_GRID_COLS,
        )
    } else {
        YearReviewEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun YearReviewHeader(
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
            FormsGlyphs.Calendar,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.tertiary,
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
private fun YearReviewStatGrid(
    items: List<YearReviewStatItem>,
    columns: Int,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items.chunked(columns).forEach { rowItems ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowItems.forEach { item -> YearReviewStatTile(item = item, modifier = Modifier.weight(1f)) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun YearReviewStatTile(
    item: YearReviewStatItem,
    modifier: Modifier = Modifier,
) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = modifier,
        unit = item.unit,
        icon = iconFor(item.icon),
    )
}

@Composable
private fun YearReviewEmpty(message: String) {
    EmptyState(
        message = message,
        icon = FormsGlyphs.Calendar,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun YearReviewLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_BAR_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun YearReviewError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [YearReviewStrings] from the i18n catalog (P1/S10) — the eleven
 * `widget.yearReview.*` keys the web component reads via `t('widget.yearReview.…')`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberYearReviewStrings(): YearReviewStrings {
    val title = stringResource(R.string.translation_widget_yearReview_title)
    val totalDistance = stringResource(R.string.translation_widget_yearReview_totalDistance)
    val totalDrives = stringResource(R.string.translation_widget_yearReview_totalDrives)
    val energyUsed = stringResource(R.string.translation_widget_yearReview_energyUsed)
    val co2Saved = stringResource(R.string.translation_widget_yearReview_co2Saved)
    val busiestMonth = stringResource(R.string.translation_widget_yearReview_busiestMonth)
    val longestDrive = stringResource(R.string.translation_widget_yearReview_longestDrive)
    val drivingTime = stringResource(R.string.translation_widget_yearReview_drivingTime)
    val topSpeed = stringResource(R.string.translation_widget_yearReview_topSpeed)
    val inYear = stringResource(R.string.translation_widget_yearReview_inYear)
    val noData = stringResource(R.string.translation_widget_yearReview_noData)
    return remember(
        title,
        totalDistance,
        totalDrives,
        energyUsed,
        co2Saved,
        busiestMonth,
        longestDrive,
        drivingTime,
        topSpeed,
        inYear,
        noData,
    ) {
        YearReviewStrings(
            title = title,
            totalDistance = totalDistance,
            totalDrives = totalDrives,
            energyUsed = energyUsed,
            co2Saved = co2Saved,
            busiestMonth = busiestMonth,
            longestDrive = longestDrive,
            drivingTime = drivingTime,
            topSpeed = topSpeed,
            inYear = inYear,
            noData = noData,
        )
    }
}

/** Maps a pure [YearReviewStatIcon] case onto a curated glyph (web lucide icon → native vector). */
private fun iconFor(icon: YearReviewStatIcon): ImageVector =
    when (icon) {
        YearReviewStatIcon.Distance -> NavGlyphs.Route
        YearReviewStatIcon.Drives -> NavGlyphs.Car
        YearReviewStatIcon.Energy -> DataDisplayGlyphs.Bolt
        YearReviewStatIcon.Co2 -> YearReviewGlyphs.Leaf
        YearReviewStatIcon.BestMonth -> YearReviewGlyphs.Star
        YearReviewStatIcon.LongestDrive -> YearReviewGlyphs.TrendingUp
        YearReviewStatIcon.DrivingTime -> YearReviewGlyphs.Timer
        YearReviewStatIcon.TopSpeed -> YearReviewGlyphs.TrendingUp
    }

/**
 * The four stroked vectors this surface needs that the shared icon sets do not provide: the [Leaf] (the
 * CO₂-saved tile, web `Leaf`), the [Star] (the best-month tile, web `Star`), the [TrendingUp] (the
 * longest-drive + top-speed tiles, web `TrendingUp`), and the [Timer] (the driving-time tile, web
 * `Timer`). Authored as 24×24 monochrome vectors recolored at render time by `Icon`'s tint — the same
 * approach the bundled `DataDisplayGlyphs` / `NavGlyphs` sets use, since Android ships no lucide
 * equivalent without the frozen `material-icons-extended` artifact.
 */
private object YearReviewGlyphs {
    val Leaf: ImageVector =
        glyph("Leaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14f, 10f)
        }

    val Star: ImageVector =
        glyph("Star") {
            moveTo(12f, 3f)
            lineTo(14.6f, 8.6f)
            lineTo(20.5f, 9.3f)
            lineTo(16.2f, 13.5f)
            lineTo(17.3f, 19.5f)
            lineTo(12f, 16.6f)
            lineTo(6.7f, 19.5f)
            lineTo(7.8f, 13.5f)
            lineTo(3.5f, 9.3f)
            lineTo(9.4f, 8.6f)
            close()
        }

    val TrendingUp: ImageVector =
        glyph("TrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    val Timer: ImageVector =
        glyph("Timer") {
            moveTo(9.5f, 3f)
            lineTo(14.5f, 3f)
            moveTo(12f, 7f)
            arcTo(7f, 7f, 0f, true, true, 11.99f, 7f)
            close()
            moveTo(12f, 14f)
            lineTo(15.5f, 11.5f)
        }
}

private fun glyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
