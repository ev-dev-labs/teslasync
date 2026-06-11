// The native Jetpack Compose + Material 3 Automation History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + play icon + freshness
// header) wrapping either the compact success-rate hero (1×N) or — when wider — the success-rate badge
// header (toned by the rate, with the total-run count) above a newest-first run feed (status-iconed rows)
// or a friendly empty state. All data flows through the shared [AutomationHistoryWidgetViewModel]; the
// view never performs HTTP. Every string resolves through the i18n catalog and every interactive element
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/AutomationHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.automationhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
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
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import kotlinx.coroutines.delay

private const val EM_DASH = "\u2014"
private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4

/**
 * Stateful entry point. Binds the shared Automations history feed via [source] into an
 * [AutomationHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * Automations data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network history seam (`AutomationsRepository`/`AutomationsStore` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AutomationHistoryWidget(
    source: AutomationHistorySource,
    modifier: Modifier = Modifier,
    size: AutomationHistorySize = AutomationHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AutomationHistoryRegistration.ID,
) {
    val viewModel: AutomationHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { AutomationHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AutomationHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the compact hero / wide feed body. [nowMillis] is injectable for deterministic
 * relative-time rendering in tests.
 */
@Composable
fun AutomationHistoryWidgetContent(
    state: UiState<AutomationHistoryListResponse>,
    size: AutomationHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberAutomationHistoryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display =
                remember(state.data, size, strings, nowMillis) {
                    state.data?.let { AutomationHistoryProjection.project(it, size, strings, nowMillis) }
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<AutomationHistoryListResponse>,
    size: AutomationHistorySize,
    display: AutomationHistoryDisplay?,
    onRefresh: () -> Unit,
    strings: AutomationHistoryStrings,
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
            if (display == null) {
                AutomationHistoryEmpty()
            } else if (size.isCompact) {
                if (display.hasItems) CompactHero(display) else AutomationHistoryEmpty()
            } else {
                WideBody(display)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<AutomationHistoryListResponse>,
    onRefresh: () -> Unit,
    strings: AutomationHistoryStrings,
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
            DataDisplayGlyphs.Play,
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
private fun WideBody(display: AutomationHistoryDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Badge(
            text = display.badgeText,
            variant = badgeVariant(display.successRateTone),
            modifier = Modifier.semantics { contentDescription = display.badgeText },
        )
        Caption(display.totalRunsText)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    if (display.hasItems) {
        RunFeed(display.items)
    } else {
        AutomationHistoryEmpty()
    }
}

@Composable
private fun RunFeed(rows: List<AutomationRunRow>) {
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
private fun CompactHero(display: AutomationHistoryDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(display.compactValueText)
        MetricLabel(display.successRateLabel)
        if (display.lastRunRelative.isNotEmpty()) {
            Caption(display.lastRunRelative)
        }
    }
}

@Composable
private fun AutomationHistoryEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noAutomationRuns),
        icon = DataDisplayGlyphs.Play,
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

private fun badgeVariant(tone: SuccessRateTone): BadgeVariant =
    when (tone) {
        SuccessRateTone.Success -> BadgeVariant.Success
        SuccessRateTone.Warning -> BadgeVariant.Warning
        SuccessRateTone.Danger -> BadgeVariant.Danger
    }

private fun glyphVector(glyph: AutomationRunGlyph): ImageVector =
    when (glyph) {
        AutomationRunGlyph.Check -> DataDisplayGlyphs.CheckCircle
        AutomationRunGlyph.Cross -> TeslaGlyphs.Close
        AutomationRunGlyph.Clock -> DataDisplayGlyphs.Clock
        AutomationRunGlyph.Play -> DataDisplayGlyphs.Play
    }

@Composable
private fun toneColor(tone: AutomationRunTone): Color =
    when (tone) {
        AutomationRunTone.Success -> TeslaTokens.status.success
        AutomationRunTone.Danger -> TeslaTokens.status.danger
        AutomationRunTone.Warning -> TeslaTokens.status.warning
        AutomationRunTone.Info -> TeslaTokens.status.info
        AutomationRunTone.Accent -> MaterialTheme.colorScheme.primary
        AutomationRunTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
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
 * Builds the localized [AutomationHistoryStrings] from the i18n catalog (P1/S10): the title, the
 * "Success Rate" label, the "runs" word, the header refresh/refreshing/offline microcopy, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberAutomationHistoryStrings(): AutomationHistoryStrings {
    val title = stringResource(R.string.translation_widget_automationHistory)
    val successRate = stringResource(R.string.translation_widget_successRate)
    val runs = stringResource(R.string.translation_widget_totalRuns)
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
        successRate,
        runs,
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
        AutomationHistoryStrings(
            title = title,
            successRateLabel = successRate,
            runsWord = runs,
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
