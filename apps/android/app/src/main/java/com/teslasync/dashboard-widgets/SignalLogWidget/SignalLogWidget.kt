// The native Jetpack Compose + Material 3 Signal Log dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SignalLogWidget.tsx. It mirrors the web `WidgetShell` (skeleton while
// loading, a retry surface on hard error, otherwise a title + scroll-log icon + freshness header with a
// Pause/Resume action) wrapping either the compact signals/sec hero (1×N) or — when wider — a newest-first
// feed of raw signal observations (a source-toned chip, the signal name, its formatted value, and a
// relative time) or a friendly empty state. The Pause action freezes the feed in place (web `pausedDataRef`)
// while live data keeps flowing underneath. All data flows through the shared [SignalLogWidgetViewModel];
// the view never performs HTTP. Every string resolves through the i18n catalog and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalLogWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signallog

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import kotlinx.coroutines.delay

private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4

/**
 * Stateful entry point. Binds the shared Vehicles + Telemetry feeds via [source] into a
 * [SignalLogWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface for the
 * given [size]. A dashboard host supplies [source] (an adapter over the shared P1/S8 data layer), an
 * optional [vehicleId] override, and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network Vehicles + Telemetry seam.
 * @param vehicleId the explicitly configured vehicle, or `null` to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalLogWidget(
    source: SignalLogSource,
    modifier: Modifier = Modifier,
    size: SignalLogSize = SignalLogRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SignalLogRegistration.ID,
) {
    val viewModel: SignalLogWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SignalLogWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val rate by viewModel.rate.collectAsStateWithLifecycle()

    SignalLogWidgetContent(
        state = state,
        rate = rate,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title + freshness
 * header over the compact signals/sec hero ([rate]) or the wide observation feed. [nowMillis] is injectable
 * for deterministic relative-time rendering in tests.
 */
@Composable
fun SignalLogWidgetContent(
    state: UiState<List<SignalObservation>>,
    rate: Double,
    size: SignalLogSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberSignalLogStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> LoadedChrome(state, rate, size, onRefresh, strings, nowMillis, modifier)
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<SignalObservation>>,
    rate: Double,
    size: SignalLogSize,
    onRefresh: () -> Unit,
    strings: SignalLogStrings,
    nowMillis: Long,
    modifier: Modifier,
) {
    var paused by rememberSaveable { mutableStateOf(false) }
    val display =
        remember(state.data, strings, nowMillis) {
            SignalLogProjection.project(state.data ?: emptyList(), strings, nowMillis)
        }
    // Freeze the displayed feed while paused (web `pausedDataRef`): the effect only copies the live rows
    // forward while running, so pausing holds the last snapshot and resuming re-syncs to the latest.
    val displayedRows = remember { mutableStateOf(display.items) }
    LaunchedEffect(display.items, paused) {
        if (!paused) displayedRows.value = display.items
    }

    Column(modifier = modifier.fillMaxSize()) {
        SignalLogHeader(
            state = state,
            strings = strings,
            onRefresh = onRefresh,
            showPause = !size.isCompact,
            paused = paused,
            onTogglePause = { paused = !paused },
        )
        if (size.isCompact) {
            CompactRate(rate = rate, strings = strings, modifier = Modifier.fillMaxSize())
        } else {
            SignalFeedBody(rows = displayedRows.value, strings = strings, modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun SignalLogHeader(
    state: UiState<List<SignalObservation>>,
    strings: SignalLogStrings,
    onRefresh: () -> Unit,
    showPause: Boolean,
    paused: Boolean,
    onTogglePause: () -> Unit,
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
            DataDisplayGlyphs.History,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
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
        if (showPause) {
            IconButton(
                imageVector = if (paused) DataDisplayGlyphs.Play else DataDisplayGlyphs.Pause,
                contentDescription = if (paused) strings.resumeLabel else strings.pauseLabel,
                onClick = onTogglePause,
                size = IconSize.Sm,
            )
        }
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun CompactRate(
    rate: Double,
    strings: SignalLogStrings,
    modifier: Modifier,
) {
    val valueText = SignalLogProjection.roundedRate(rate).toString()
    val description = "${strings.title}: $valueText ${strings.signalsPerSecLabel}"
    Column(
        modifier =
            modifier
                .padding(Spacing.md)
                .clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MetricValue(valueText)
        MetricLabel(strings.signalsPerSecLabel)
    }
}

@Composable
private fun SignalFeedBody(
    rows: List<SignalLogRow>,
    strings: SignalLogStrings,
    modifier: Modifier,
) {
    if (rows.isEmpty()) {
        EmptyState(
            message = strings.noSignalsMessage,
            icon = DataDisplayGlyphs.History,
            modifier = modifier.padding(Spacing.md),
        )
    } else {
        Column(
            modifier =
                modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            rows.forEach { row -> SignalLogFeedRow(row) }
        }
    }
}

@Composable
private fun SignalLogFeedRow(row: SignalLogRow) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = row.contentDescription },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Badge(text = row.sourceLabel, variant = badgeVariant(row.tone))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(row.signalName, maxLines = 1)
            Caption(row.valueText)
        }
        HelperText(row.relativeTime)
    }
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

/** Maps an observation's source [SignalSourceTone] to the toned `Badge` variant (web `SOURCE_COLORS` accent). */
private fun badgeVariant(tone: SignalSourceTone): BadgeVariant =
    when (tone) {
        SignalSourceTone.Telemetry -> BadgeVariant.Success
        SignalSourceTone.Api -> BadgeVariant.Info
        SignalSourceTone.Manual -> BadgeVariant.Warning
        SignalSourceTone.Backfill -> BadgeVariant.Neutral
        SignalSourceTone.Other -> BadgeVariant.Neutral
    }

/** Ticks the wall clock every 30s so relative-time labels (e.g. "5m") stay current. */
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
 * Builds the localized [SignalLogStrings] from the i18n catalog (P1/S10): the title, the "signals/sec"
 * label, the Pause/Resume action labels, the empty-feed message, the header refresh/refreshing/offline
 * microcopy, and the `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberSignalLogStrings(): SignalLogStrings {
    val title = stringResource(R.string.translation_widget_signalLog_title)
    val signalsPerSec = stringResource(R.string.translation_widget_signalLog_signalsPerSec)
    val pause = stringResource(R.string.translation_widget_signalLog_pause)
    val resume = stringResource(R.string.translation_widget_signalLog_resume)
    val noSignals = stringResource(R.string.translation_widget_signalLog_noSignals)
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
        signalsPerSec,
        pause,
        resume,
        noSignals,
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
        SignalLogStrings(
            title = title,
            signalsPerSecLabel = signalsPerSec,
            pauseLabel = pause,
            resumeLabel = resume,
            noSignalsMessage = noSignals,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> SIGNAL_LOG_EM_DASH
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
