// The native Jetpack Compose + Material 3 Command History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/CommandHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + terminal icon + freshness
// header) wrapping either the compact last-command row (1×N: terminal icon + command name + a
// success/failed/pending badge) or — when wider — a newest-first command feed (status-iconed rows) or a
// friendly empty state. All data flows through the shared [CommandHistoryWidgetViewModel]; the view never
// performs HTTP. Every string resolves through the i18n catalog and every interactive element carries a
// TalkBack label.
//
// The Lucide `Terminal` and `XCircle` glyphs the web uses have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as `components/ui/TeslaGlyphs` et al.),
// keeping the iconography faithful without adding a feature-wide dependency.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CommandHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val EM_DASH = "\u2014"
private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4
private val MIN_TOUCH_TARGET = 44.dp
private const val GLYPH_STROKE_WIDTH = 2f
private const val GLYPH_VIEWPORT = 24f

/** Localized, zone-aware absolute-date formatter for command rows older than a day (web `formatDateTime`). */
private val EVENT_DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point. Binds the shared command-history feed via [source] into a
 * [CommandHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (a [StoreCommandHistorySource] over the shared
 * S8 Commands + active-vehicle layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network command-history seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandHistoryWidget(
    source: CommandHistorySource,
    modifier: Modifier = Modifier,
    size: CommandHistorySize = CommandHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CommandHistoryRegistration.ID,
) {
    val viewModel: CommandHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { CommandHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    CommandHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the compact last-command row / wide command feed / empty body. [nowMillis] is
 * injectable for deterministic relative-time rendering in tests.
 */
@Composable
fun CommandHistoryWidgetContent(
    state: UiState<List<CommandLogEntry>>,
    size: CommandHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberCommandHistoryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val entries = state.data ?: emptyList()
            val display =
                remember(entries, size, strings, nowMillis) {
                    CommandHistoryProjection.project(entries, size, strings, nowMillis)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<CommandLogEntry>>,
    size: CommandHistorySize,
    display: CommandHistoryDisplay,
    onRefresh: () -> Unit,
    strings: CommandHistoryStrings,
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
                !display.hasItems -> CommandHistoryEmpty(strings)
                size.isCompact -> CompactRow(display)
                else -> CommandFeed(display.items)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<List<CommandLogEntry>>,
    onRefresh: () -> Unit,
    strings: CommandHistoryStrings,
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
            CommandTerminalGlyph,
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
private fun CompactRow(display: CommandHistoryDisplay) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            CommandTerminalGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        BodyText(display.compactCommandName, modifier = Modifier.weight(1f), maxLines = 1)
        Badge(text = display.compactBadgeLabel, variant = badgeVariant(display.compactBadgeTone))
    }
}

@Composable
private fun CommandFeed(rows: List<CommandRow>) {
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
private fun CommandHistoryEmpty(strings: CommandHistoryStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = CommandTerminalGlyph,
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

private fun badgeVariant(tone: CommandBadgeTone): BadgeVariant =
    when (tone) {
        CommandBadgeTone.Success -> BadgeVariant.Success
        CommandBadgeTone.Danger -> BadgeVariant.Danger
        CommandBadgeTone.Warning -> BadgeVariant.Warning
    }

private fun glyphVector(glyph: CommandStatusGlyph): ImageVector =
    when (glyph) {
        CommandStatusGlyph.Check -> DataDisplayGlyphs.CheckCircle
        CommandStatusGlyph.Cross -> CommandXCircleGlyph
        CommandStatusGlyph.Clock -> DataDisplayGlyphs.Clock
        CommandStatusGlyph.Terminal -> CommandTerminalGlyph
    }

@Composable
private fun toneColor(tone: CommandStatusTone): Color =
    when (tone) {
        CommandStatusTone.Success -> TeslaTokens.status.success
        CommandStatusTone.Danger -> TeslaTokens.status.danger
        CommandStatusTone.Warning -> TeslaTokens.status.warning
        CommandStatusTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
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
 * Builds the localized [CommandHistoryStrings] from the i18n catalog (P1/S10): the title + empty message,
 * the success/failed/pending badge labels, the header refresh/refreshing/offline microcopy, the row
 * event-time formatter (web `WidgetEventFeed.formatRelativeTime` — just-now / minutes / hours / absolute
 * date), and the `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberCommandHistoryStrings(): CommandHistoryStrings {
    val title = stringResource(R.string.translation_widget_commandHistory)
    val empty = stringResource(R.string.translation_widget_noCommands)
    val success = stringResource(R.string.translation_widget_commandSuccess)
    val failed = stringResource(R.string.translation_widget_commandFailed)
    val pending = stringResource(R.string.translation_widget_commandPending)
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
        empty,
        success,
        failed,
        pending,
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
        CommandHistoryStrings(
            title = title,
            emptyMessage = empty,
            successLabel = success,
            failedLabel = failed,
            pendingLabel = pending,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatEventTime = { time ->
                when (time) {
                    CommandEventTime.Unknown -> EM_DASH
                    CommandEventTime.JustNow -> justNow
                    is CommandEventTime.MinutesAgo -> minutes.format(time.value)
                    is CommandEventTime.HoursAgo -> hours.format(time.value)
                    is CommandEventTime.Absolute -> formatAbsolute(time.epochMillis)
                }
            },
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

/** Locale/zone-aware absolute date for a >24h row; an unformattable instant renders the em dash. */
private fun formatAbsolute(epochMillis: Long): String =
    runCatching { EVENT_DATE_FORMATTER.format(Instant.ofEpochMilli(epochMillis)) }.getOrDefault(EM_DASH)

// ── Authored Lucide glyphs (no shared-set equivalent) ────────────────────────────────────────────────

/** The web Lucide `Terminal` glyph: a `>` prompt chevron above an underscore. */
private val CommandTerminalGlyph: ImageVector =
    strokedGlyph("CommandTerminal") {
        moveTo(4f, 17f)
        lineTo(10f, 11f)
        lineTo(4f, 5f)
        moveTo(12f, 19f)
        lineTo(20f, 19f)
    }

/** The web Lucide `XCircle` glyph: an X inside a circle (the failed-command marker, pairs with CheckCircle). */
private val CommandXCircleGlyph: ImageVector =
    strokedGlyph("CommandXCircle") {
        circlePath(12f, 12f, 9f)
        moveTo(15f, 9f)
        lineTo(9f, 15f)
        moveTo(9f, 9f)
        lineTo(15f, 15f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circlePath(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
