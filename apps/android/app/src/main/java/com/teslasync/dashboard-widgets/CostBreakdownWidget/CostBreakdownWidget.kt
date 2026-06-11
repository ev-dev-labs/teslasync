// The native Jetpack Compose + Material 3 Cost Breakdown dashboard surface — a parity port of
// web/src/features/dashboard/widgets/CostBreakdownWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of the two
// bodies the web renders: the compact monthly-total hero (1×N — big number + "saved vs gas" subtitle +
// "Saving" badge) or — when wider — the standard layout (a cost-by-month donut ring, a ranked monthly
// list, and the Total Cost / Cost-per-distance / Gas Savings stat cards), with a friendly empty state
// when no months are recorded. All data flows through the shared [CostBreakdownWidgetViewModel]; SI cost
// figures are converted + currency-formatted at this render boundary via the live
// [CostBreakdownDisplayPrefs]. The view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CostBreakdownWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costbreakdown

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.charts.paletteColor
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
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
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
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val HERO_MIN_HEIGHT = 44.dp
private val ROW_MIN_HEIGHT = 44.dp
private val DONUT_HEIGHT = 140.dp
private val LOADING_BAR_HEIGHT = 32.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_NUMBER_FRACTION = 0.6f
private const val BAR_ALPHA = 0.15f

// Donut ring geometry — web `Pie innerRadius="55%" outerRadius="85%" paddingAngle={2}`.
private const val DONUT_OUTER_FRACTION = 0.85f
private const val DONUT_INNER_FRACTION = 0.55f
private const val DONUT_GAP_DEGREES = 2f
private const val FULL_CIRCLE_DEGREES = 360f
private const val DONUT_START_DEGREES = -90f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [CostBreakdownWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A
 * dashboard host supplies [source] (an adapter over the shared S7/S8 data layer), an optional
 * [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + analytics + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostBreakdownWidget(
    source: CostBreakdownSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: CostBreakdownSize = CostBreakdownRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CostBreakdownRegistration.ID,
) {
    val viewModel: CostBreakdownWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { CostBreakdownWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    CostBreakdownWidgetContent(
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
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display conversion +
 * currency formatting; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun CostBreakdownWidgetContent(
    state: UiState<JsonElement>,
    prefs: CostBreakdownDisplayPrefs,
    size: CostBreakdownSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberCostBreakdownStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                CostBreakdownLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> CostBreakdownError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        CostBreakdownProjection.project(parseCostBreakdown(state.data), prefs, strings, locale)
                    }
                if (size.isCompact) {
                    CostBreakdownCompact(state = state, display = display, locale = locale)
                } else {
                    CostBreakdownStandard(state = state, display = display, title = strings.title, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun CostBreakdownCompact(
    state: UiState<JsonElement>,
    display: CostBreakdownDisplay,
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
        CostBreakdownHero(display = display, locale = locale)
    } else {
        CostBreakdownEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun CostBreakdownHero(
    display: CostBreakdownDisplay,
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
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (reduceMotion) {
                MetricValue(ChartFormat.number(display.monthlyTotalValue, display.monthlyTotalDecimals, locale))
            } else {
                AnimatedNumber(value = display.monthlyTotalValue, decimals = display.monthlyTotalDecimals, locale = locale)
            }
            Caption(display.currencySymbol, modifier = Modifier.padding(bottom = Spacing.xs))
        }
        MetricLabel(display.monthlyTotalLabel)
        display.savedSubtitle?.let { Caption(it) }
        if (display.showSavingBadge) {
            Badge(
                text = display.savingBadgeText,
                variant = BadgeVariant.Success,
                modifier = Modifier.padding(top = Spacing.xs),
            )
        }
    }
}

@Composable
private fun CostBreakdownStandard(
    state: UiState<JsonElement>,
    display: CostBreakdownDisplay,
    title: String,
    onRefresh: () -> Unit,
) {
    CostBreakdownHeader(title = title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        CostBreakdownBody(display = display)
    } else {
        CostBreakdownEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun CostBreakdownHeader(
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
            NavGlyphs.Chart,
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
private fun CostBreakdownBody(display: CostBreakdownDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        CostDonut(segments = display.donutSegments, contentDescription = display.donutContentDescription)
        CostRankedList(rows = display.rankedRows)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            CostStatTile(card = display.totalCostCard, icon = FormsGlyphs.Tag)
            CostStatTile(card = display.costPerDistCard, icon = DataDisplayGlyphs.Bolt)
            CostStatTile(card = display.gasSavingsCard, icon = DataDisplayGlyphs.TrendingDown)
        }
    }
}

@Composable
private fun RowScope.CostStatTile(
    card: CostStatCard,
    icon: ImageVector,
) {
    StatCard(
        label = card.label,
        value = card.value,
        modifier = Modifier.weight(1f),
        icon = icon,
        sublabel = card.sublabel,
    )
}

@Composable
private fun CostRankedList(rows: List<RankedCostRow>) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        rows.forEachIndexed { index, row -> CostRankedRow(rank = index + 1, row = row) }
    }
}

@Composable
private fun CostRankedRow(
    rank: Int,
    row: RankedCostRow,
) {
    val barColor = paletteColor(row.colorIndex).copy(alpha = BAR_ALPHA)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription }
                .drawBehind {
                    if (row.barFraction > 0f) {
                        drawRect(color = barColor, size = Size(size.width * row.barFraction, size.height))
                    }
                },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(rank.toString())
            BodyText(text = row.label, modifier = Modifier.weight(1f), maxLines = 1)
            BodyText(text = row.formattedValue)
        }
    }
}

@Composable
private fun CostDonut(
    segments: List<DonutSegment>,
    contentDescription: String,
) {
    val colors = segments.map { paletteColor(it.colorIndex) }
    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DONUT_HEIGHT)
                .semantics { this.contentDescription = contentDescription },
    ) {
        val total = segments.sumOf { it.value }
        if (total <= 0.0) return@Canvas
        val radius = size.minDimension / 2f
        val thickness = radius * (DONUT_OUTER_FRACTION - DONUT_INNER_FRACTION)
        val ringRadius = radius * (DONUT_OUTER_FRACTION + DONUT_INNER_FRACTION) / 2f
        val center = Offset(size.width / 2f, size.height / 2f)
        val topLeft = Offset(center.x - ringRadius, center.y - ringRadius)
        val arcSize = Size(ringRadius * 2f, ringRadius * 2f)
        val gap = if (segments.size > 1) DONUT_GAP_DEGREES else 0f
        val sweepBudget = FULL_CIRCLE_DEGREES - gap * segments.size
        var startAngle = DONUT_START_DEGREES
        segments.forEachIndexed { index, segment ->
            val sweep = (segment.value / total).toFloat() * sweepBudget
            drawArc(
                color = colors[index],
                startAngle = startAngle,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = thickness),
            )
            startAngle += sweep + gap
        }
    }
}

@Composable
private fun CostBreakdownEmpty(message: String) {
    EmptyState(
        message = message,
        icon = NavGlyphs.Chart,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun CostBreakdownLoading(
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
            Skeleton(height = DONUT_HEIGHT, rounded = true)
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun CostBreakdownError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [CostBreakdownStrings] from the i18n catalog (P1/S10) — the nine
 * `widget.costBreakdown.*` keys the web component reads via `t('widget.costBreakdown.…')`. The two
 * parameterized templates ([CostBreakdownStrings.savedVsGas] / [CostBreakdownStrings.costPerDist]) are
 * fetched raw and formatted inside the pure projection. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberCostBreakdownStrings(): CostBreakdownStrings {
    val title = stringResource(R.string.translation_widget_costBreakdown_title)
    val monthlyTotal = stringResource(R.string.translation_widget_costBreakdown_monthlyTotal)
    val savedVsGas = stringResource(R.string.translation_widget_costBreakdown_savedVsGas)
    val saving = stringResource(R.string.translation_widget_costBreakdown_saving)
    val noData = stringResource(R.string.translation_widget_costBreakdown_noData)
    val totalCost = stringResource(R.string.translation_widget_costBreakdown_totalCost)
    val costPerDist = stringResource(R.string.translation_widget_costBreakdown_costPerDist)
    val gasSavings = stringResource(R.string.translation_widget_costBreakdown_gasSavings)
    val lifetime = stringResource(R.string.translation_widget_costBreakdown_lifetime)
    return remember(title, monthlyTotal, savedVsGas, saving, noData, totalCost, costPerDist, gasSavings, lifetime) {
        CostBreakdownStrings(
            title = title,
            monthlyTotal = monthlyTotal,
            savedVsGas = savedVsGas,
            saving = saving,
            noData = noData,
            totalCost = totalCost,
            costPerDist = costPerDist,
            gasSavings = gasSavings,
            lifetime = lifetime,
        )
    }
}
