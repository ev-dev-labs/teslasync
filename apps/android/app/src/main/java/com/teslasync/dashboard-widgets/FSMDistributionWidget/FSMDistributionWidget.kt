// The native Jetpack Compose + Material 3 FSM State Distribution dashboard surface — a parity port of
// web/src/features/dashboard/widgets/FSMDistributionWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a title + branch icon + freshness header)
// wrapping one of the two bodies the web renders: the compact current-state hero (1×N — a state dot + the
// capitalized state name + the time-in-state) or — when wider — the standard layout (a time-in-state donut
// ring, a per-state legend with percentages, and a recent-transitions feed), with a friendly empty state
// when no positive-time state is recorded. All data flows through the shared
// [FSMDistributionWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FSMDistributionWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fsmdistribution

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
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
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Locale

private const val ARROW = "\u2192"
private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 3

private val DONUT_HEIGHT = 132.dp
private val HERO_MIN_HEIGHT = 44.dp
private val ROW_MIN_HEIGHT = 44.dp
private val HERO_DOT = 12.dp
private val LEGEND_DOT = 8.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_BAR_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_NUMBER_FRACTION = 0.55f

// Donut ring geometry — web `Pie innerRadius="55%" outerRadius="80%" paddingAngle={2}`.
private const val DONUT_OUTER_FRACTION = 0.80f
private const val DONUT_INNER_FRACTION = 0.55f
private const val DONUT_GAP_DEGREES = 2f
private const val FULL_CIRCLE_DEGREES = 360f
private const val DONUT_START_DEGREES = -90f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [FSMDistributionWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + fsm-stats + fsm-transitions adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FSMDistributionWidget(
    source: FSMDistributionSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: FSMDistributionSize = FSMDistributionRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FSMDistributionRegistration.ID,
) {
    val viewModel: FSMDistributionWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { FSMDistributionWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    FSMDistributionWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [nowMillis] is injectable for deterministic
 * relative-time rendering in tests; [locale] drives the percent grouping.
 */
@Composable
fun FSMDistributionWidgetContent(
    state: UiState<FSMDistributionSnapshot>,
    size: FSMDistributionSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberFSMDistributionStrings()
    val palette = rememberFSMStatePalette()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                FSMLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> FSMError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, size, strings, nowMillis, locale) {
                        FSMDistributionProjection.project(
                            snapshot = state.data ?: FSMDistributionSnapshot(null, null),
                            size = size,
                            strings = strings,
                            nowMillis = nowMillis,
                            locale = locale,
                        )
                    }
                if (size.isCompact) {
                    FSMCompact(state = state, display = display, palette = palette, strings = strings)
                } else {
                    FSMStandard(state = state, display = display, palette = palette, strings = strings, onRefresh = onRefresh)
                }
            }
        }
    }
}

@Composable
private fun FSMCompact(
    state: UiState<FSMDistributionSnapshot>,
    display: FSMDistributionDisplay,
    palette: FSMStatePalette,
    strings: FSMDistributionStrings,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            formatAge = strings.formatRelative,
        )
    }
    if (display.hasData) {
        FSMCompactHero(display = display, palette = palette)
    } else {
        FSMEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun FSMCompactHero(
    display: FSMDistributionDisplay,
    palette: FSMStatePalette,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Box(modifier = Modifier.size(HERO_DOT).clip(CircleShape).background(palette.colorFor(display.currentState)))
        BodyText(display.currentStateLabel, maxLines = 1)
        Caption(display.currentDuration)
    }
}

@Composable
private fun FSMStandard(
    state: UiState<FSMDistributionSnapshot>,
    display: FSMDistributionDisplay,
    palette: FSMStatePalette,
    strings: FSMDistributionStrings,
    onRefresh: () -> Unit,
) {
    FSMHeader(state = state, strings = strings, onRefresh = onRefresh)
    if (display.hasData) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FSMDonut(segments = display.segments, palette = palette, contentDescription = display.donutContentDescription)
            FSMLegend(segments = display.segments, palette = palette)
            if (display.transitions.isNotEmpty()) {
                FSMTransitions(label = display.recentTransitionsLabel, rows = display.transitions)
            }
        }
    } else {
        FSMEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun FSMHeader(
    state: UiState<*>,
    strings: FSMDistributionStrings,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            NavGlyphs.Workflow,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(
            strings.title,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = strings.formatRelative,
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
private fun FSMDonut(
    segments: List<FSMSegment>,
    palette: FSMStatePalette,
    contentDescription: String,
) {
    val colors = segments.map { palette.colorFor(it.state) }
    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DONUT_HEIGHT)
                .semantics { this.contentDescription = contentDescription },
    ) {
        val total = segments.sumOf { it.valueMs }
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
            val sweep = (segment.valueMs / total).toFloat() * sweepBudget
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FSMLegend(
    segments: List<FSMSegment>,
    palette: FSMStatePalette,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        segments.forEach { segment ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier.clearAndSetSemantics { contentDescription = "${segment.label} ${segment.pctText}" },
            ) {
                Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(palette.colorFor(segment.state)))
                Caption(segment.label)
                Caption(segment.pctText)
            }
        }
    }
}

@Composable
private fun FSMTransitions(
    label: String,
    rows: List<FSMTransitionRow>,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        rows.forEach { row -> FSMTransitionRowView(row = row) }
    }
}

@Composable
private fun FSMTransitionRowView(row: FSMTransitionRow) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Badge(text = row.fromLabel, variant = BadgeVariant.Neutral)
            Caption(ARROW)
            Badge(text = row.toLabel, variant = BadgeVariant.Neutral)
        }
        Caption(row.relativeTime)
    }
}

@Composable
private fun FSMEmpty(message: String) {
    EmptyState(
        message = message,
        icon = NavGlyphs.Workflow,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun FSMLoading(
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
            repeat(LOADING_BAR_COUNT) { Skeleton(height = LOADING_BAR_HEIGHT, rounded = true) }
        }
    }
}

@Composable
private fun FSMError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme state palette — the native analogue of the web `STATE_COLORS` table, mapped to
 * design tokens (never raw hex in render code): driving→info(cyan), charging→success(green),
 * asleep→chart.power(purple), idle→warning(amber), offline/unknown→muted. Token colors are read once in
 * [rememberFSMStatePalette] (a composable) and captured here so the donut/legend/hero can resolve a state
 * color inside non-composable lambdas.
 */
private class FSMStatePalette(
    val driving: Color,
    val charging: Color,
    val asleep: Color,
    val idle: Color,
    val muted: Color,
) {
    fun colorFor(state: String): Color =
        when (state.lowercase(Locale.US)) {
            "driving" -> driving
            "charging" -> charging
            "asleep" -> asleep
            "idle" -> idle
            "offline" -> muted
            else -> muted
        }
}

@Composable
private fun rememberFSMStatePalette(): FSMStatePalette {
    val driving = TeslaTokens.status.info
    val charging = TeslaTokens.status.success
    val idle = TeslaTokens.status.warning
    val asleep = TeslaTokens.chart.power
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    return remember(driving, charging, idle, asleep, muted) {
        FSMStatePalette(driving = driving, charging = charging, asleep = asleep, idle = idle, muted = muted)
    }
}

/** Ticks the wall clock every 30s so relative-time labels (e.g. "5m ago") stay current. */
@Composable
private fun rememberNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * Builds the localized [FSMDistributionStrings] from the i18n catalog (P1/S10): the five
 * `widget.fsmDistribution.*` keys the web component reads, the `translation_freshness_*`-backed relative
 * formatter shared with the freshness chip, and the dynamic state-label resolver. The web state key
 * (`t('widget.fsmDistribution.state.{state}', state)`) has no catalog entries, so it falls back to the raw
 * state name rendered capitalized — reproduced here by first-letter capitalization.
 */
@Composable
private fun rememberFSMDistributionStrings(): FSMDistributionStrings {
    val title = stringResource(R.string.translation_widget_fsmDistribution_title)
    val recentTransitions = stringResource(R.string.translation_widget_fsmDistribution_recentTransitions)
    val noData = stringResource(R.string.translation_widget_fsmDistribution_noData)
    val hour = stringResource(R.string.translation_widget_fsmDistribution_hr)
    val minute = stringResource(R.string.translation_widget_fsmDistribution_min)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(title, recentTransitions, noData, hour, minute, justNow, seconds, minutes, hours, days, weeks) {
        FSMDistributionStrings(
            title = title,
            recentTransitions = recentTransitions,
            noData = noData,
            hourSuffix = hour,
            minuteSuffix = minute,
            stateLabel = { raw -> raw.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() } },
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}
