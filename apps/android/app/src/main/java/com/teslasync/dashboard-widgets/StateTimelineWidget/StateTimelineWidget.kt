// The native Jetpack Compose + Material 3 State Timeline dashboard surface — a parity port of
// web/src/features/dashboard/widgets/StateTimelineWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a title + clock icon + freshness header) wrapping
// the three bodies the web renders by footprint: the compact legend (1×N — the stacked share bar + up to
// five state dots with percent), the standard layout (the stacked share bar + a per-state row list with
// duration + percent), and the wide layout (the standard layout plus the 24h state-transition stripe), with
// a friendly empty state when no positive-time state is recorded. All data flows through the shared
// [StateTimelineWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/StateTimelineWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.statetimeline

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val LOADING_ROW_COUNT = 3

private val STACKED_BAR_HEIGHT = 20.dp
private val STRIPE_HEIGHT = 16.dp
private val ROW_MIN_HEIGHT = 44.dp
private val ROW_DOT = 10.dp
private val LEGEND_DOT = 8.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private const val LOADING_TITLE_FRACTION = 0.4f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [StateTimelineWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared P1/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + state-summary + timeline adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StateTimelineWidget(
    source: StateTimelineSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: StateTimelineSize = StateTimelineRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = StateTimelineRegistration.ID,
) {
    val viewModel: StateTimelineWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { StateTimelineWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    StateTimelineWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact / standard
 * / wide body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [locale] drives the percent grouping.
 */
@Composable
fun StateTimelineWidgetContent(
    state: UiState<StateTimelineSnapshot>,
    size: StateTimelineSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberStateTimelineStrings()
    val palette = rememberStateTimelinePalette()
    val formatAge = rememberFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> StateTimelineLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> StateTimelineError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, size, strings, locale) {
                        StateTimelineProjection.project(
                            snapshot = state.data ?: StateTimelineSnapshot(null, null),
                            size = size,
                            strings = strings,
                            locale = locale,
                        )
                    }
                if (size.isCompact) {
                    StateTimelineCompact(state = state, display = display, palette = palette, formatAge = formatAge)
                } else {
                    StateTimelineStandard(
                        state = state,
                        display = display,
                        palette = palette,
                        strings = strings,
                        formatAge = formatAge,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }
}

@Composable
private fun StateTimelineCompact(
    state: UiState<StateTimelineSnapshot>,
    display: StateTimelineDisplay,
    palette: StateTimelinePalette,
    formatAge: (FreshnessAge) -> String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            formatAge = formatAge,
        )
    }
    if (display.hasData) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StackedBar(display = display, palette = palette)
            CompactLegend(segments = display.compactSegments, palette = palette)
        }
    } else {
        StateTimelineEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun StateTimelineStandard(
    state: UiState<StateTimelineSnapshot>,
    display: StateTimelineDisplay,
    palette: StateTimelinePalette,
    strings: StateTimelineStrings,
    formatAge: (FreshnessAge) -> String,
    onRefresh: () -> Unit,
) {
    StateTimelineHeader(state = state, strings = strings, formatAge = formatAge, onRefresh = onRefresh)
    if (display.hasData) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StackedBar(display = display, palette = palette)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                display.segments.forEach { segment -> StateRow(segment = segment, palette = palette) }
            }
            if (display.showStripe) {
                TimelineStripe(display = display, palette = palette)
            }
        }
    } else {
        StateTimelineEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun StateTimelineHeader(
    state: UiState<*>,
    strings: StateTimelineStrings,
    formatAge: (FreshnessAge) -> String,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.Clock,
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
            formatAge = formatAge,
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

/**
 * The always-shown horizontal share bar — the web `StackedBar`. Each positive-percent slice is weighted by
 * its share and clipped into a single pill; zero-percent slices are skipped (a zero Compose weight is
 * illegal and the slice would be invisible anyway). The whole bar carries the folded a11y phrase.
 */
@Composable
private fun StackedBar(
    display: StateTimelineDisplay,
    palette: StateTimelinePalette,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(STACKED_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .clearAndSetSemantics { contentDescription = display.stackedBarContentDescription },
    ) {
        display.segments.forEach { segment ->
            if (segment.pct > 0.0) {
                Box(
                    modifier =
                        Modifier
                            .weight(segment.pct.toFloat())
                            .fillMaxHeight()
                            .background(palette.colorFor(segment.state)),
                )
            }
        }
    }
}

@Composable
private fun StateRow(
    segment: StateSegment,
    palette: StateTimelinePalette,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = segment.rowContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(modifier = Modifier.size(ROW_DOT).clip(CircleShape).background(palette.colorFor(segment.state)))
            BodyText(segment.label, maxLines = 1)
        }
        Caption(segment.durationText)
        Badge(text = segment.pctText, variant = BadgeVariant.Neutral)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CompactLegend(
    segments: List<StateSegment>,
    palette: StateTimelinePalette,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        segments.forEach { segment ->
            Row(
                modifier =
                    Modifier
                        .heightIn(min = ROW_MIN_HEIGHT)
                        .clearAndSetSemantics { contentDescription = segment.legendContentDescription },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(palette.colorFor(segment.state)))
                Caption(segment.label)
                Caption(segment.pctLegendText)
            }
        }
    }
}

/**
 * The wide-only 24h state-transition stripe — the web `TimelineStripe`. A localized caption over a weighted,
 * clipped bar of the recent transitions (slices < 0.5% already dropped by the projection). The whole stripe
 * carries the folded a11y phrase.
 */
@Composable
private fun TimelineStripe(
    display: StateTimelineDisplay,
    palette: StateTimelinePalette,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(display.timelineLabel)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(STRIPE_HEIGHT)
                    .clip(RoundedCornerShape(Radius.sm))
                    .clearAndSetSemantics { contentDescription = display.stripeContentDescription },
        ) {
            display.stripe.forEach { segment ->
                if (segment.pct > 0.0) {
                    Box(
                        modifier =
                            Modifier
                                .weight(segment.pct.toFloat())
                                .fillMaxHeight()
                                .background(palette.colorFor(segment.state)),
                    )
                }
            }
        }
    }
}

@Composable
private fun StateTimelineEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.Clock,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun StateTimelineLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (!compact) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        }
        Skeleton(height = STACKED_BAR_HEIGHT, rounded = true)
        if (!compact) {
            repeat(LOADING_ROW_COUNT) { Skeleton(height = LOADING_TITLE_HEIGHT) }
        }
    }
}

@Composable
private fun StateTimelineError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme state palette — the native analogue of the web `STATE_COLORS` table, mapped to design
 * tokens (never raw hex in render code): driving→info(cyan), charging→success(green), asleep→chart.power
 * (purple), idle→warning(amber), offline→danger(red), unknown→muted (web `?? '#6b7280'`). Token colors are
 * read once in [rememberStateTimelinePalette] (a composable) and captured here so the bar/rows/legend can
 * resolve a state color inside non-composable lambdas.
 */
private class StateTimelinePalette(
    val driving: Color,
    val charging: Color,
    val asleep: Color,
    val idle: Color,
    val offline: Color,
    val muted: Color,
) {
    fun colorFor(state: String): Color =
        when (state.lowercase(Locale.US)) {
            "driving" -> driving
            "charging" -> charging
            "asleep" -> asleep
            "idle" -> idle
            "offline" -> offline
            else -> muted
        }
}

@Composable
private fun rememberStateTimelinePalette(): StateTimelinePalette {
    val driving = TeslaTokens.status.info
    val charging = TeslaTokens.status.success
    val idle = TeslaTokens.status.warning
    val offline = TeslaTokens.status.danger
    val asleep = TeslaTokens.chart.power
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    return remember(driving, charging, idle, offline, asleep, muted) {
        StateTimelinePalette(
            driving = driving,
            charging = charging,
            asleep = asleep,
            idle = idle,
            offline = offline,
            muted = muted,
        )
    }
}

/**
 * Builds the localized [StateTimelineStrings] from the i18n catalog (P1/S10): the five
 * `widget.stateTimeline.*` keys the web component reads, plus the dynamic state-label resolver. The web
 * state key (`t('widget.stateTimeline.state.{state}', state)`) has no catalog entries, so it falls back to
 * the raw state name rendered capitalized — reproduced here by first-letter capitalization.
 */
@Composable
private fun rememberStateTimelineStrings(): StateTimelineStrings {
    val title = stringResource(R.string.translation_widget_stateTimeline_title)
    val timelineLabel = stringResource(R.string.translation_widget_stateTimeline_timeline)
    val noData = stringResource(R.string.translation_widget_stateTimeline_noData)
    val hour = stringResource(R.string.translation_widget_stateTimeline_hr)
    val minute = stringResource(R.string.translation_widget_stateTimeline_min)
    return remember(title, timelineLabel, noData, hour, minute) {
        StateTimelineStrings(
            title = title,
            timelineLabel = timelineLabel,
            noData = noData,
            hourSuffix = hour,
            minuteSuffix = minute,
            stateLabel = { raw -> raw.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() } },
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip shows (`translation_freshness_*`), shared
 * with the sibling widgets. Kept separate from [StateTimelineStrings] because it is a render-only concern
 * (the body carries no relative times), so the pure projection stays free of it.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}
