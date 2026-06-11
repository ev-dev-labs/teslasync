// The native Jetpack Compose + Material 3 Vampire Drain dashboard surface — a parity port of
// web/src/features/dashboard/widgets/VampireDrainWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, otherwise the freshness header — battery glyph + title for the standard footprint,
// header-less chrome for the compact 1-column footprint — with a freshness chip + refresh control) wrapping
// the web body: on a compact (≤1-column) footprint a single large `${avg}%` `/day` stat colored by the
// `drainColor` band; otherwise the web `StatCard` (Avg Drain, "X%/day", event-count sublabel), the wide
// (≥3-column) daily-drain `Sparkline`, and the web `WidgetEventFeed` (newest-first recent drain events, each
// a battery marker colored by its drain band + a "battery% · duration · Sentry" title + a "%/day" subtitle +
// a relative time). When neither a stats card nor any event resolves it shows the friendly
// "No vampire drain data" empty state; when stats resolve but no events do, the feed shows its own
// "No recent drain events" empty state — both web behaviours. All data flows through the shared
// [VampireDrainWidgetViewModel] (P1/S8); the view performs no HTTP. Every string resolves through the
// i18n catalog (P1/S10) and the refresh control carries a TalkBack label; each feed row exposes one folded
// TalkBack phrase.
//
// Documented native deviations:
//   • Error handling matches the web source faithfully: the web widget does NOT pass `error` to
//     `WidgetShell` (its backend routes are deprecated and 404), so it never shows a full error screen —
//     it surfaces the failure as the header freshness chip (error tone) + the refresh (retry) control over
//     the friendly empty state, keeping any cached value visible (offline / last-known). This port does the
//     same: a cache-less hard failure renders the empty state with the error chip + refresh, never a
//     blanking QueryError body (unlike the sibling Regen widget, whose web source DOES pass `error`).
//   • Android has no bundled Lucide `BatteryWarning`; the curated [DataDisplayGlyphs.Battery] approximates
//     it for the header + per-event markers (the drain-band tint carries the warning semantics).
//   • The web sparkline is a fixed 260 px; the native sparkline fills the available width for a polished,
//     HIG-idiomatic wide footprint.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VampireDrainWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vampiredrain

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay
import java.util.Locale

private const val NOW_TICK_MS = 30_000L
private const val SKELETON_BAR_COUNT = 3
private const val SKELETON_HEADER_WIDTH_FRACTION = 0.5f
private val SKELETON_HEADER_HEIGHT = 14.dp
private val SKELETON_BAR_HEIGHT = 20.dp
private val BODY_MIN_HEIGHT = 44.dp
private val FEED_MIN_HEIGHT = 96.dp
private val SPARKLINE_HEIGHT = 36.dp

/**
 * Stateful entry point. Collects the shared [VampireDrainWidgetViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host supplies the
 * view-model (wired via [VampireDrainWidgetViewModel.factory] / [VampireDrainWidgetViewModel.create]).
 */
@Composable
fun VampireDrainWidget(
    viewModel: VampireDrainWidgetViewModel,
    modifier: Modifier = Modifier,
    size: VampireDrainSize = VampireDrainRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    VampireDrainWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Vampire Drain panel — renders every state the web widget does (loading skeleton, content,
 * empty, plus stale + offline via the header freshness chip over the cached payload). Stale (non-error)
 * data auto-refreshes (web TanStack stale refetch). Hoisted out of the ViewModel so each state is preview-
 * and screenshot-testable with hand-built [UiState] inputs. [nowMillis] is injectable for deterministic
 * relative-time in tests; [locale] pins number grouping.
 */
@Composable
fun VampireDrainWidgetContent(
    state: UiState<VampireDrainSnapshot>,
    size: VampireDrainSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val labels = rememberVampireDrainLabels()
    val title = stringResource(R.string.translation_widget_vampireDrain_title)
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        if (state.isLoading) {
            VampireDrainLoading(label = title)
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                VampireDrainHeader(state = state, title = title, compact = size.isCompact, labels = labels, onRefresh = onRefresh)
                val snapshot = state.data ?: VampireDrainSnapshot.EMPTY
                val display =
                    remember(snapshot, size, labels, nowMillis, locale) {
                        VampireDrainProjection.project(snapshot, size, labels, nowMillis, locale)
                    }
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    if (snapshot.hasData) {
                        VampireDrainBody(display = display, labels = labels)
                    } else {
                        VampireDrainEmpty()
                    }
                }
            }
        }
    }
}

@Composable
private fun VampireDrainHeader(
    state: UiState<*>,
    title: String,
    compact: Boolean,
    labels: VampireDrainLabels,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!compact) {
            Icon(
                imageVector = DataDisplayGlyphs.Battery,
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
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
            formatAge = labels.formatRelative,
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
private fun VampireDrainBody(
    display: VampireDrainDisplay,
    labels: VampireDrainLabels,
) {
    if (display.isCompact) {
        VampireDrainCompact(display = display, labels = labels)
    } else {
        VampireDrainStandard(display = display)
    }
}

@Composable
private fun VampireDrainCompact(
    display: VampireDrainDisplay,
    labels: VampireDrainLabels,
) {
    Column(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = display.avgPercentText,
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = bandColor(display.avgBand),
        )
        Caption(labels.perDay)
    }
}

@Composable
private fun VampireDrainStandard(display: VampireDrainDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatCard(
            label = stringResource(R.string.translation_widget_vampireDrain_avgDrain),
            value = display.avgValueText,
            icon = DataDisplayGlyphs.Battery,
            sublabel = display.sublabel,
            modifier = Modifier.fillMaxWidth(),
        )
        if (display.showSparkline) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_widget_vampireDrain_trend))
                BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                    Sparkline(
                        data = display.sparkline,
                        color = bandColor(display.avgBand),
                        width = maxWidth,
                        height = SPARKLINE_HEIGHT,
                    )
                }
            }
        }
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (display.hasEvents) {
                VampireDrainFeed(rows = display.events)
            } else {
                VampireDrainNoEvents()
            }
        }
    }
}

@Composable
private fun VampireDrainFeed(rows: List<VampireDrainEventRow>) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
    ) {
        rows.forEachIndexed { index, row ->
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = row.title,
                        time = row.relativeTime,
                        subtitle = row.subtitle,
                        icon = DataDisplayGlyphs.Battery,
                        accent = bandColor(row.band),
                    ),
                isLast = index == rows.lastIndex,
                modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
            )
        }
    }
}

@Composable
private fun VampireDrainNoEvents() {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = FEED_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_widget_vampireDrain_noEvents),
            icon = DataDisplayGlyphs.Battery,
        )
    }
}

@Composable
private fun VampireDrainEmpty() {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_widget_vampireDrain_noData),
            icon = DataDisplayGlyphs.Battery,
        )
    }
}

@Composable
private fun VampireDrainLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_HEADER_WIDTH_FRACTION, height = SKELETON_HEADER_HEIGHT)
        repeat(SKELETON_BAR_COUNT) {
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

/**
 * Builds the localized [VampireDrainLabels] from the i18n catalog (P1/S10) — the `widget.vampireDrain.*`
 * value keys the projection folds in (per-day / Sentry / hour / minute / event-count) plus the shared
 * `freshness.*` relative-time strings used by both the feed and the header chip. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberVampireDrainLabels(): VampireDrainLabels {
    val perDay = stringResource(R.string.translation_widget_vampireDrain_perDay)
    val sentry = stringResource(R.string.translation_widget_vampireDrain_sentry)
    val hour = stringResource(R.string.translation_widget_vampireDrain_hr)
    val minute = stringResource(R.string.translation_widget_vampireDrain_min)
    val eventCount = stringResource(R.string.translation_widget_vampireDrain_eventCount)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(perDay, sentry, hour, minute, eventCount, justNow, seconds, minutes, hours, days, weeks) {
        VampireDrainLabels(
            perDay = perDay,
            sentry = sentry,
            hour = hour,
            minute = minute,
            eventCountTemplate = eventCount,
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

/** Maps a [DrainBand] onto its semantic color (web `drainColor`: low → success, medium → warning, high → danger). */
@Composable
private fun bandColor(band: DrainBand): Color =
    when (band) {
        DrainBand.Low -> TeslaTokens.status.success
        DrainBand.Medium -> TeslaTokens.status.warning
        DrainBand.High -> TeslaTokens.status.danger
    }

// ── Previews — one per rendered state (standard / compact / wide+sparkline / no-events / empty / loading) ──

private fun previewSnapshot(eventCount: Int = 4): VampireDrainSnapshot =
    VampireDrainSnapshot(
        stats = VampireDrainStats(avgDrainRate = 0.085, totalHours = 36.0, eventCount = eventCount.toLong()),
        events =
            (1..eventCount).map { i ->
                VampireDrainEvent(
                    id = i.toLong(),
                    startDate = "2026-06-06T1%d:00:00Z".format(i.coerceAtMost(9)),
                    durationHours = 2.0 + i,
                    batteryLost = 3.0 + i,
                    drainRatePctPerHour = 0.05 * i,
                    sentryMode = i % 2 == 0,
                )
            },
    )

@Preview(name = "VampireDrain · standard", showBackground = true)
@Composable
private fun VampireDrainStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            size = VampireDrainRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

@Preview(name = "VampireDrain · compact", showBackground = true)
@Composable
private fun VampireDrainCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            size = VampireDrainSize(cols = 1, rows = 2),
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

@Preview(name = "VampireDrain · wide + sparkline", showBackground = true)
@Composable
private fun VampireDrainWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(eventCount = 6), fetchedAt = PREVIEW_NOW),
            size = VampireDrainSize(cols = 4, rows = 6),
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

@Preview(name = "VampireDrain · stats only (no events)", showBackground = true)
@Composable
private fun VampireDrainNoEventsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = VampireDrainSnapshot(stats = VampireDrainStats(0.02, 12.0, 0L), events = emptyList()),
                    fetchedAt = PREVIEW_NOW,
                ),
            size = VampireDrainRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

@Preview(name = "VampireDrain · empty", showBackground = true)
@Composable
private fun VampireDrainEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = VampireDrainSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
            size = VampireDrainRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

@Preview(name = "VampireDrain · loading", showBackground = true)
@Composable
private fun VampireDrainLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VampireDrainWidgetContent(
            state = UiState.loading(),
            size = VampireDrainRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
            locale = Locale.US,
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L
