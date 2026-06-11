// The native Jetpack Compose + Material 3 Lifetime Stats dashboard surface — a parity port of
// web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of the bodies
// the web renders: the compact lifetime-distance hero (1×N — big animated number + "{unit} lifetime"
// caption), the standard 2-up stat grid (Total Distance / Total Drives / Total Energy / CO₂ Saved), or —
// when wide — the 4-up grid that folds in Total Cost / Ownership Days / Avg Daily Distance, with a
// friendly empty state when no lifetime totals have accrued. All data flows through the shared
// [LifetimeStatsWidgetViewModel]; SI figures are converted + currency-formatted at this render boundary
// via the live [LifetimeStatsDisplayPrefs]. The view never performs HTTP. Every string resolves through
// the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LifetimeStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.lifetimestats

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

// Authored glyph geometry (the curated icon sets have no trophy / leaf analogue).
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [LifetimeStatsWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A
 * dashboard host supplies [source] (an adapter over the shared S7/S8 data layer), an optional
 * [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + analytics + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle
 *   (and the fleet-wide totals when there is none).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LifetimeStatsWidget(
    source: LifetimeStatsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: LifetimeStatsSize = LifetimeStatsRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LifetimeStatsRegistration.ID,
) {
    val viewModel: LifetimeStatsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LifetimeStatsWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    LifetimeStatsWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard / wide body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display conversion +
 * currency formatting; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun LifetimeStatsWidgetContent(
    state: UiState<JsonElement>,
    prefs: LifetimeStatsDisplayPrefs,
    size: LifetimeStatsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberLifetimeStatsStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                LifetimeStatsLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> LifetimeStatsError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        LifetimeStatsProjection.project(parseLifetimeStats(state.data), prefs, strings, locale)
                    }
                if (size.isCompact) {
                    LifetimeStatsCompact(state = state, display = display, locale = locale)
                } else {
                    LifetimeStatsStandard(state = state, display = display, size = size, title = strings.title, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun LifetimeStatsCompact(
    state: UiState<JsonElement>,
    display: LifetimeStatsDisplay,
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
        LifetimeStatsHero(display = display, locale = locale)
    } else {
        LifetimeStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun LifetimeStatsHero(
    display: LifetimeStatsDisplay,
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
private fun LifetimeStatsStandard(
    state: UiState<JsonElement>,
    display: LifetimeStatsDisplay,
    size: LifetimeStatsSize,
    title: String,
    onRefresh: () -> Unit,
) {
    LifetimeStatsHeader(title = title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        LifetimeStatGrid(
            items = display.statsFor(size.isWide),
            columns = if (size.isWide) WIDE_GRID_COLS else STANDARD_GRID_COLS,
        )
    } else {
        LifetimeStatsEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun LifetimeStatsHeader(
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
            LifetimeStatsGlyphs.Trophy,
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
private fun LifetimeStatGrid(
    items: List<LifetimeStatItem>,
    columns: Int,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        items.chunked(columns).forEach { rowItems ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowItems.forEach { item -> LifetimeStatTile(item = item, modifier = Modifier.weight(1f)) }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun LifetimeStatTile(
    item: LifetimeStatItem,
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
private fun LifetimeStatsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = LifetimeStatsGlyphs.Trophy,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LifetimeStatsLoading(
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
private fun LifetimeStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [LifetimeStatsStrings] from the i18n catalog (P1/S10) — the ten
 * `widget.lifetimeStats.*` keys the web component reads via `t('widget.lifetimeStats.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberLifetimeStatsStrings(): LifetimeStatsStrings {
    val title = stringResource(R.string.translation_widget_lifetimeStats_title)
    val totalDistance = stringResource(R.string.translation_widget_lifetimeStats_totalDistance)
    val totalDrives = stringResource(R.string.translation_widget_lifetimeStats_totalDrives)
    val totalEnergy = stringResource(R.string.translation_widget_lifetimeStats_totalEnergy)
    val co2Saved = stringResource(R.string.translation_widget_lifetimeStats_co2Saved)
    val totalCost = stringResource(R.string.translation_widget_lifetimeStats_totalCost)
    val ownershipDays = stringResource(R.string.translation_widget_lifetimeStats_ownershipDays)
    val avgDailyDistance = stringResource(R.string.translation_widget_lifetimeStats_avgDailyDistance)
    val lifetime = stringResource(R.string.translation_widget_lifetimeStats_lifetime)
    val noData = stringResource(R.string.translation_widget_lifetimeStats_noData)
    return remember(
        title,
        totalDistance,
        totalDrives,
        totalEnergy,
        co2Saved,
        totalCost,
        ownershipDays,
        avgDailyDistance,
        lifetime,
        noData,
    ) {
        LifetimeStatsStrings(
            title = title,
            totalDistance = totalDistance,
            totalDrives = totalDrives,
            totalEnergy = totalEnergy,
            co2Saved = co2Saved,
            totalCost = totalCost,
            ownershipDays = ownershipDays,
            avgDailyDistance = avgDailyDistance,
            lifetime = lifetime,
            noData = noData,
        )
    }
}

/** Maps a pure [LifetimeStatIcon] case onto a curated glyph (web lucide icon → native vector). */
private fun iconFor(icon: LifetimeStatIcon): ImageVector =
    when (icon) {
        LifetimeStatIcon.Distance -> NavGlyphs.Route
        LifetimeStatIcon.Drives -> NavGlyphs.Car
        LifetimeStatIcon.Energy -> DataDisplayGlyphs.Bolt
        LifetimeStatIcon.Co2 -> LifetimeStatsGlyphs.Leaf
        LifetimeStatIcon.Cost -> FormsGlyphs.Tag
        LifetimeStatIcon.OwnershipDays -> FormsGlyphs.Calendar
        LifetimeStatIcon.AvgDailyDistance -> NavGlyphs.Route
    }

/**
 * The two stroked vectors this surface needs that the shared icon sets do not provide: the [Trophy]
 * (the widget's signature glyph — header + empty state, web `Trophy`) and the [Leaf] (the CO₂-saved
 * tile, web `Leaf`). Authored as 24×24 monochrome vectors recolored at render time by `Icon`'s tint —
 * the same approach the bundled `DataDisplayGlyphs` / `NavGlyphs` sets use, since Android ships no
 * lucide equivalent without the frozen `material-icons-extended` artifact.
 */
private object LifetimeStatsGlyphs {
    val Trophy: ImageVector =
        glyph("Trophy") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            curveTo(17f, 12.3f, 14.8f, 14f, 12f, 14f)
            curveTo(9.2f, 14f, 7f, 12.3f, 7f, 9f)
            close()
            moveTo(7f, 5f)
            lineTo(4.5f, 5f)
            curveTo(2.8f, 5f, 2.8f, 8.5f, 5f, 8.5f)
            lineTo(7f, 8.5f)
            moveTo(17f, 5f)
            lineTo(19.5f, 5f)
            curveTo(21.2f, 5f, 21.2f, 8.5f, 19f, 8.5f)
            lineTo(17f, 8.5f)
            moveTo(12f, 14f)
            lineTo(12f, 18f)
            moveTo(8.5f, 20f)
            lineTo(15.5f, 20f)
            moveTo(10f, 18f)
            lineTo(14f, 18f)
        }

    val Leaf: ImageVector =
        glyph("Leaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 11f, 4f, 20f, 4f)
            curveTo(20f, 13f, 13f, 20f, 4f, 20f)
            close()
            moveTo(4f, 20f)
            lineTo(14f, 10f)
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
