// The native Jetpack Compose + Material 3 Guard Mode dashboard surface — a parity port of
// web/src/features/dashboard/widgets/GuardModeWidget.tsx. It mirrors the web `WidgetShell` (skeleton while
// loading, a retry surface on hard error, otherwise a title + shield icon + freshness header) wrapping one
// of: the compact hero (armed/disarmed shield + status badge + an "{n} events" count badge), the full
// view (a status card — shield + Armed/Disarmed + "Sensitivity: x · Auto-panic" + an ON/OFF badge — above
// the newest-first recent-events feed or a friendly "No guard events" empty state), or the "No guard data"
// empty surface when no guard config has resolved. All data flows through the shared
// [GuardModeWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n catalog
// and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/GuardModeWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.guardmode

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

private const val EM_DASH = "\u2014"
private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4

/**
 * Stateful entry point. Binds the combined guard feed via [source] into a [GuardModeWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (a [StoreGuardModeSource] over the shared S8 Guard data layer) and a unique
 * [instanceKey] per placement.
 *
 * @param source the combined cache-then-network guard seam (a [StoreGuardModeSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun GuardModeWidget(
    source: GuardModeSource,
    modifier: Modifier = Modifier,
    size: GuardModeSize = GuardModeRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = GuardModeRegistration.ID,
) {
    val viewModel: GuardModeWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { GuardModeWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    GuardModeWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the compact hero / full status-card + feed body, or the "No guard data" empty
 * surface when no config resolved. [nowMillis] is injectable for deterministic relative-time in tests.
 */
@Composable
fun GuardModeWidgetContent(
    state: UiState<GuardModeSnapshot>,
    size: GuardModeSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberGuardModeStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, size, strings, nowMillis) {
                    snapshot?.config?.let {
                        GuardModeProjection.project(it, snapshot.events, size, strings, nowMillis)
                    }
                }
            LoadedChrome(state, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<GuardModeSnapshot>,
    display: GuardModeDisplay?,
    onRefresh: () -> Unit,
    strings: GuardModeStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when {
                display == null -> GuardModeEmpty(strings)
                display.isCompact -> CompactHero(display)
                else -> FullView(display, strings)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<GuardModeSnapshot>,
    onRefresh: () -> Unit,
    strings: GuardModeStrings,
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
            DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Compact hero (1×N): shield + status badge + event-count badge --
@Composable
private fun CompactHero(display: GuardModeDisplay) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                DataDisplayGlyphs.Shield,
                contentDescription = null,
                size = IconSize.Md,
                tint = statusTint(display.statusIsArmed),
            )
            Badge(display.statusLabel, variant = statusVariant(display.statusIsArmed))
        }
        Badge(display.eventCountText, variant = eventCountVariant(display.eventCountIsActive))
    }
}

// -- Full view (2×N+): status card + recent-events feed --
@Composable
private fun FullView(
    display: GuardModeDisplay,
    strings: GuardModeStrings,
) {
    StatusCard(display)
    if (display.hasItems) {
        GuardEventFeed(display.items)
    } else {
        GuardEventsEmpty(strings)
    }
}

@Composable
private fun StatusCard(display: GuardModeDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                DataDisplayGlyphs.Shield,
                contentDescription = null,
                size = IconSize.Lg,
                tint = statusTint(display.statusIsArmed),
            )
            Column {
                Subhead(display.statusLabel)
                Caption(display.sensitivitySubtitle)
            }
        }
        Badge(display.onOffLabel, variant = statusVariant(display.statusIsArmed))
    }
}

@Composable
private fun GuardEventFeed(rows: List<GuardEventRow>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = row.title,
                        time = row.relativeTime,
                        subtitle = row.subtitle,
                        icon = glyphVector(row.glyph),
                        accent = toneColor(row.tone),
                    ),
                isLast = index == rows.lastIndex,
                modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
            )
        }
    }
}

@Composable
private fun GuardEventsEmpty(strings: GuardModeStrings) {
    EmptyState(
        message = strings.noEventsMessage,
        icon = DataDisplayGlyphs.Shield,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun GuardModeEmpty(strings: GuardModeStrings) {
    EmptyState(
        message = strings.noDataMessage,
        icon = DataDisplayGlyphs.Shield,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

@Composable
private fun statusTint(isArmed: Boolean): Color = if (isArmed) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant

private fun statusVariant(isArmed: Boolean): BadgeVariant = if (isArmed) BadgeVariant.Success else BadgeVariant.Neutral

private fun eventCountVariant(isActive: Boolean): BadgeVariant = if (isActive) BadgeVariant.Warning else BadgeVariant.Neutral

private fun glyphVector(glyph: GuardEventGlyph): ImageVector =
    when (glyph) {
        // Approximations of the web Lucide icons from the shared glyph set (Android has no bundled Lucide):
        // Move→MapPin (location change), Unlock→Lock (no open-lock glyph), CarFront→Gauge (driving),
        // Siren→Bell (alarm), FlaskConical→Info (test/diagnostic).
        GuardEventGlyph.Location -> DataDisplayGlyphs.MapPin
        GuardEventGlyph.Lock -> DataDisplayGlyphs.Lock
        GuardEventGlyph.Drive -> DataDisplayGlyphs.Gauge
        GuardEventGlyph.Eye -> TeslaGlyphs.Eye
        GuardEventGlyph.Siren -> FeedbackGlyphs.Bell
        GuardEventGlyph.Flask -> DataDisplayGlyphs.Info
        GuardEventGlyph.Shield -> DataDisplayGlyphs.Shield
    }

@Composable
private fun toneColor(tone: GuardEventTone): Color =
    when (tone) {
        GuardEventTone.Warning -> TeslaTokens.status.warning
        GuardEventTone.Critical -> TeslaTokens.status.danger
        GuardEventTone.Info -> TeslaTokens.status.info
        GuardEventTone.Accent -> MaterialTheme.colorScheme.primary
        GuardEventTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Ticks the wall clock every 30s so relative-time labels (e.g. "5m ago") stay current. */
@Composable
fun rememberNowMillis(): Long {
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
 * Builds the localized [GuardModeStrings] from the i18n catalog (P1/S10): the title, the armed/disarmed
 * and ON/OFF words, the sensitivity/auto-panic labels, the "events" word, the acknowledged/unacknowledged
 * subtitles, the two empty messages, the header refresh/refreshing/offline microcopy, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberGuardModeStrings(): GuardModeStrings {
    val title = stringResource(R.string.translation_widget_guardMode)
    val armed = stringResource(R.string.translation_widget_guardArmed)
    val disarmed = stringResource(R.string.translation_widget_guardDisarmed)
    val on = stringResource(R.string.translation_widget_guardOn)
    val off = stringResource(R.string.translation_widget_guardOff)
    val sensitivity = stringResource(R.string.translation_widget_guardSensitivity)
    val autoPanic = stringResource(R.string.translation_widget_guardAutoPanic)
    val eventsWord = stringResource(R.string.translation_widget_guardEvents)
    val acknowledged = stringResource(R.string.translation_widget_guardAcknowledged)
    val unacknowledged = stringResource(R.string.translation_widget_guardUnacknowledged)
    val noEvents = stringResource(R.string.translation_widget_guardNoEvents)
    val noData = stringResource(R.string.translation_widget_noGuardData)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        armed,
        disarmed,
        on,
        off,
        sensitivity,
        autoPanic,
        eventsWord,
        acknowledged,
        unacknowledged,
        noEvents,
        noData,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        GuardModeStrings(
            title = title,
            armed = armed,
            disarmed = disarmed,
            on = on,
            off = off,
            sensitivityLabel = sensitivity,
            autoPanicLabel = autoPanic,
            eventsWord = eventsWord,
            acknowledged = acknowledged,
            unacknowledged = unacknowledged,
            noEventsMessage = noEvents,
            noDataMessage = noData,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
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
