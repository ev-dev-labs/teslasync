// The native Jetpack Compose + Material 3 Software Update History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + download icon + freshness
// header) wrapping either the compact latest-version row (1×N: download icon + version + a status/"Current"
// badge) or — when wider — a newest-first update feed (status-iconed, status-tinted rows, the current
// installed version highlighted in the brand accent) or a friendly empty state. All data flows through the
// shared [SoftwareUpdateHistoryWidgetViewModel]; the view never performs HTTP. Every string resolves through
// the i18n catalog and every interactive element carries a TalkBack label.
//
// The Lucide `Download` and `ArrowDownCircle` glyphs the web uses have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as `components/datadisplay/DataDisplayGlyphs`
// and the sibling MediaHistoryWidget); the web `CheckCircle2` maps to `DataDisplayGlyphs.CheckCircle` and
// `Clock` to `DataDisplayGlyphs.Clock`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatehistory

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
private const val CIRCLE_RADIUS = 9f

/** Localized, zone-aware absolute-date formatter for update rows older than a day (web `formatDateTime`). */
private val EVENT_DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point. Binds the shared update-history feed via [source] into a
 * [SoftwareUpdateHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (a [StoreSoftwareUpdateHistorySource]
 * over the shared S8 Vehicles + VehicleSystems layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network update-history seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SoftwareUpdateHistoryWidget(
    source: SoftwareUpdateHistorySource,
    modifier: Modifier = Modifier,
    size: SoftwareUpdateHistorySize = SoftwareUpdateHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SoftwareUpdateHistoryRegistration.ID,
) {
    val viewModel: SoftwareUpdateHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SoftwareUpdateHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SoftwareUpdateHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title + freshness
 * header over the compact latest-version row / wide update feed / empty body. [nowMillis] is injectable for
 * deterministic relative-time rendering in tests.
 */
@Composable
fun SoftwareUpdateHistoryWidgetContent(
    state: UiState<List<SoftwareUpdateEntry>>,
    size: SoftwareUpdateHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberSoftwareUpdateHistoryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val entries = state.data ?: emptyList()
            val display =
                remember(entries, size, strings, nowMillis) {
                    SoftwareUpdateHistoryProjection.project(entries, size, strings, nowMillis)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<SoftwareUpdateEntry>>,
    size: SoftwareUpdateHistorySize,
    display: SoftwareUpdateHistoryDisplay,
    onRefresh: () -> Unit,
    strings: SoftwareUpdateHistoryStrings,
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
                !display.hasItems -> SoftwareUpdateHistoryEmpty(strings)
                size.isCompact -> CompactRow(display)
                else -> UpdateFeed(display.items)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<List<SoftwareUpdateEntry>>,
    onRefresh: () -> Unit,
    strings: SoftwareUpdateHistoryStrings,
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
            DownloadGlyph,
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
private fun CompactRow(display: SoftwareUpdateHistoryDisplay) {
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
            DownloadGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        BodyText(display.compactVersion, modifier = Modifier.weight(1f), maxLines = 1)
        Badge(text = display.compactBadgeText, variant = badgeVariant(display.compactBadgeTone))
    }
}

@Composable
private fun UpdateFeed(rows: List<SoftwareUpdateRow>) {
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
private fun SoftwareUpdateHistoryEmpty(strings: SoftwareUpdateHistoryStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = DownloadGlyph,
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

private fun badgeVariant(tone: SoftwareUpdateBadgeTone): BadgeVariant =
    when (tone) {
        SoftwareUpdateBadgeTone.Success -> BadgeVariant.Success
        SoftwareUpdateBadgeTone.Warning -> BadgeVariant.Warning
        SoftwareUpdateBadgeTone.Info -> BadgeVariant.Info
    }

private fun glyphVector(glyph: SoftwareUpdateGlyph): ImageVector =
    when (glyph) {
        SoftwareUpdateGlyph.Check -> DataDisplayGlyphs.CheckCircle
        SoftwareUpdateGlyph.ArrowDownCircle -> ArrowDownCircleGlyph
        SoftwareUpdateGlyph.Download -> DownloadGlyph
        SoftwareUpdateGlyph.Clock -> DataDisplayGlyphs.Clock
    }

@Composable
private fun toneColor(tone: SoftwareUpdateTone): Color =
    when (tone) {
        // Web `#22c55e` — an installed (non-current) build.
        SoftwareUpdateTone.Installed -> TeslaTokens.status.success
        // Web `#f59e0b` — installing.
        SoftwareUpdateTone.Installing -> TeslaTokens.status.warning
        // Web `#3b82f6` — downloading.
        SoftwareUpdateTone.Downloading -> TeslaTokens.chart.speed
        // Web `#6b7280` — available / unknown (DEFAULT_STATUS).
        SoftwareUpdateTone.Available -> MaterialTheme.colorScheme.onSurfaceVariant
        // Web `#a78bfa` — scheduled.
        SoftwareUpdateTone.Scheduled -> TeslaTokens.chart.power
        // Web `#22d3ee` — the current installed version, highlighted in the brand accent.
        SoftwareUpdateTone.Current -> MaterialTheme.colorScheme.primary
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
 * Builds the localized [SoftwareUpdateHistoryStrings] from the i18n catalog (P1/S10): the title + empty
 * message, the "Current" label, the `translation_widget_updateStatus` status formatter (web
 * `t('widget.updateStatus', status)`), the header refresh/refreshing/offline microcopy, the row event-time
 * formatter (web `WidgetEventFeed.formatRelativeTime` — just-now / minutes / hours / absolute date), and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberSoftwareUpdateHistoryStrings(): SoftwareUpdateHistoryStrings {
    val title = stringResource(R.string.translation_widget_softwareUpdateHistory)
    val current = stringResource(R.string.translation_widget_updateCurrent)
    val empty = stringResource(R.string.translation_widget_noUpdates)
    val statusTemplate = stringResource(R.string.translation_widget_updateStatus)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(title, current, empty, statusTemplate, refresh, refreshing, offline, justNow, seconds, minutes, hours, days, weeks) {
        SoftwareUpdateHistoryStrings(
            title = title,
            currentLabel = current,
            emptyMessage = empty,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatStatus = { status -> statusTemplate.format(status) },
            formatEventTime = { time ->
                when (time) {
                    SoftwareUpdateEventTime.Unknown -> EM_DASH
                    SoftwareUpdateEventTime.JustNow -> justNow
                    is SoftwareUpdateEventTime.MinutesAgo -> minutes.format(time.value)
                    is SoftwareUpdateEventTime.HoursAgo -> hours.format(time.value)
                    is SoftwareUpdateEventTime.Absolute -> formatAbsolute(time.epochMillis)
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

/** The web Lucide `Download` glyph: a tray with a down-arrow into it (header / compact / available marker). */
private val DownloadGlyph: ImageVector =
    strokedGlyph("Download") {
        moveTo(21f, 15f)
        lineTo(21f, 19f)
        lineTo(3f, 19f)
        lineTo(3f, 15f)
        moveTo(7f, 10f)
        lineTo(12f, 15f)
        lineTo(17f, 10f)
        moveTo(12f, 15f)
        lineTo(12f, 3f)
    }

/** The web Lucide `ArrowDownCircle` glyph: a circle with a downward arrow (installing / downloading marker). */
private val ArrowDownCircleGlyph: ImageVector =
    strokedGlyph("ArrowDownCircle") {
        circlePath(12f, 12f, CIRCLE_RADIUS)
        moveTo(8f, 12f)
        lineTo(12f, 16f)
        lineTo(16f, 12f)
        moveTo(12f, 8f)
        lineTo(12f, 16f)
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
