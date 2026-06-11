// The native Jetpack Compose + Material 3 Media History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MediaHistoryWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a title + list-music icon + freshness header)
// wrapping either the compact last-track row (1×N: music icon + "title — artist", or the "No tracks
// played" message) or — when wider — a newest-first track feed (music-iconed rows tinted green while
// playing, muted otherwise) or a friendly empty state. All data flows through the shared
// [MediaHistoryWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element carries a TalkBack label.
//
// The Lucide `Music` and `ListMusic` glyphs the web uses have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as `components/ui/TeslaGlyphs` and the
// sibling CommandHistoryWidget), keeping the iconography faithful without a feature-wide dependency.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MediaHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mediahistory

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
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
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
private const val NOTE_HEAD_RADIUS = 3f
private const val LIST_NOTE_HEAD_RADIUS = 2f

/** Localized, zone-aware absolute-date formatter for track rows older than a day (web `formatDateTime`). */
private val EVENT_DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point. Binds the shared media-history feed via [source] into a
 * [MediaHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (a [StoreMediaHistorySource] over the shared
 * S8 Vehicles + VehicleSystems layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network media-history seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MediaHistoryWidget(
    source: MediaHistorySource,
    modifier: Modifier = Modifier,
    size: MediaHistorySize = MediaHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MediaHistoryRegistration.ID,
) {
    val viewModel: MediaHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { MediaHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    MediaHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the compact last-track row / wide track feed / empty body. [nowMillis] is
 * injectable for deterministic relative-time rendering in tests.
 */
@Composable
fun MediaHistoryWidgetContent(
    state: UiState<List<MediaTrackEntry>>,
    size: MediaHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberMediaHistoryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val entries = state.data ?: emptyList()
            val display =
                remember(entries, size, strings, nowMillis) {
                    MediaHistoryProjection.project(entries, size, strings, nowMillis)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<MediaTrackEntry>>,
    size: MediaHistorySize,
    display: MediaHistoryDisplay,
    onRefresh: () -> Unit,
    strings: MediaHistoryStrings,
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
                !display.hasItems -> MediaHistoryEmpty(strings)
                size.isCompact -> CompactRow(display)
                else -> MediaFeed(display.items)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<List<MediaTrackEntry>>,
    onRefresh: () -> Unit,
    strings: MediaHistoryStrings,
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
            MediaListMusicGlyph,
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
private fun CompactRow(display: MediaHistoryDisplay) {
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
            MediaMusicGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        BodyText(display.compactText, modifier = Modifier.weight(1f), maxLines = 1)
    }
}

@Composable
private fun MediaFeed(rows: List<MediaTrackRow>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = row.title,
                        time = row.relativeTime,
                        subtitle = row.subtitle,
                        icon = MediaMusicGlyph,
                        accent = toneColor(row.tone),
                    ),
                isLast = index == rows.lastIndex,
                modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
            )
        }
    }
}

@Composable
private fun MediaHistoryEmpty(strings: MediaHistoryStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = MediaListMusicGlyph,
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
private fun toneColor(tone: MediaPlaybackTone): Color =
    when (tone) {
        MediaPlaybackTone.Playing -> TeslaTokens.status.success
        MediaPlaybackTone.Idle -> MaterialTheme.colorScheme.onSurfaceVariant
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
 * Builds the localized [MediaHistoryStrings] from the i18n catalog (P1/S10): the title + empty message,
 * the header refresh/refreshing/offline microcopy, the row event-time formatter (web
 * `WidgetEventFeed.formatRelativeTime` — just-now / minutes / hours / absolute date), and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberMediaHistoryStrings(): MediaHistoryStrings {
    val title = stringResource(R.string.translation_widget_mediaHistory)
    val empty = stringResource(R.string.translation_widget_noMediaPlayed)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(title, empty, refresh, refreshing, offline, justNow, seconds, minutes, hours, days, weeks) {
        MediaHistoryStrings(
            title = title,
            emptyMessage = empty,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatEventTime = { time ->
                when (time) {
                    MediaEventTime.Unknown -> EM_DASH
                    MediaEventTime.JustNow -> justNow
                    is MediaEventTime.MinutesAgo -> minutes.format(time.value)
                    is MediaEventTime.HoursAgo -> hours.format(time.value)
                    is MediaEventTime.Absolute -> formatAbsolute(time.epochMillis)
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

/** The web Lucide `Music` glyph: a stem + flag with two note heads (the per-track marker). */
private val MediaMusicGlyph: ImageVector =
    strokedGlyph("MediaMusic") {
        moveTo(9f, 18f)
        lineTo(9f, 5f)
        lineTo(21f, 3f)
        lineTo(21f, 16f)
        circlePath(6f, 18f, NOTE_HEAD_RADIUS)
        circlePath(18f, 16f, NOTE_HEAD_RADIUS)
    }

/** The web Lucide `ListMusic` glyph: three list rows beside a single note (the header / empty marker). */
private val MediaListMusicGlyph: ImageVector =
    strokedGlyph("MediaListMusic") {
        moveTo(3f, 6f)
        lineTo(14f, 6f)
        moveTo(3f, 12f)
        lineTo(14f, 12f)
        moveTo(3f, 18f)
        lineTo(10f, 18f)
        moveTo(18f, 17f)
        lineTo(18f, 6f)
        lineTo(21f, 5f)
        circlePath(16f, 17f, LIST_NOTE_HEAD_RADIUS)
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
