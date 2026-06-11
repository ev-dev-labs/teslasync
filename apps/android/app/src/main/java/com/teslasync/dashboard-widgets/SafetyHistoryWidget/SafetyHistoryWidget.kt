// The native Jetpack Compose + Material 3 Safety History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a title + alert-octagon icon + freshness header)
// wrapping either the compact 30-day count row (1×N: octagon + "N events (30d)" with a "most-common trend"
// subline, or the "No safety events" message) or — when wider — the three-stat header (Events 30d / Most
// Common / Trend) above a newest-first ADAS event feed (severity-toned, glyph-marked rows) or a friendly
// empty state. All data flows through the shared [SafetyHistoryWidgetViewModel]; the view never performs
// HTTP. Every chrome string resolves through the i18n catalog and every interactive element carries a
// TalkBack label.
//
// The Lucide `ShieldAlert`, `Navigation`, and `CarFront` glyphs the web uses have no shared-set equivalent,
// so they are authored here as 24×24 stroked vectors (the same approach as `components/ui/TeslaGlyphs` and
// the sibling MediaHistoryWidget), keeping the iconography faithful without a feature-wide dependency.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SafetyHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.safetyhistory

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
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
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
private const val EXCLAMATION_DOT_Y = 16f

/** Localized, zone-aware absolute-date formatter for event rows older than a day (web `formatDateTime`). */
private val EVENT_DATE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point. Binds the shared safety-history feed via [source] into a
 * [SafetyHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface for
 * the given [size]. A dashboard host supplies [source] (a [StoreSafetyHistorySource] over the shared S8
 * Vehicles + VehicleSystems layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network safety-history seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SafetyHistoryWidget(
    source: SafetyHistorySource,
    modifier: Modifier = Modifier,
    size: SafetyHistorySize = SafetyHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SafetyHistoryRegistration.ID,
) {
    val viewModel: SafetyHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SafetyHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SafetyHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title + freshness
 * header over the compact count row / wide three-stat + feed body. [nowMillis] is injectable for
 * deterministic relative-time rendering in tests.
 */
@Composable
fun SafetyHistoryWidgetContent(
    state: UiState<List<SafetyEntry>>,
    size: SafetyHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    val strings = rememberSafetyHistoryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val entries = state.data ?: emptyList()
            val display =
                remember(entries, size, strings, nowMillis) {
                    SafetyHistoryProjection.project(entries, size, strings, nowMillis)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<SafetyEntry>>,
    size: SafetyHistorySize,
    display: SafetyHistoryDisplay,
    onRefresh: () -> Unit,
    strings: SafetyHistoryStrings,
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
            if (size.isCompact) {
                if (display.hasEvents) CompactView(display) else SafetyHistoryEmpty(strings)
            } else {
                SafetyStatRow(display, strings)
                if (display.items.isEmpty()) SafetyHistoryEmpty(strings) else SafetyEventFeed(display.items)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<List<SafetyEntry>>,
    onRefresh: () -> Unit,
    strings: SafetyHistoryStrings,
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
            DataDisplayGlyphs.AlertOctagon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
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
private fun SafetyStatRow(
    display: SafetyHistoryDisplay,
    strings: SafetyHistoryStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatCard(
            label = strings.totalLabel,
            value = display.totalEventsText,
            modifier = Modifier.weight(1f),
        )
        StatCard(
            label = strings.mostCommonLabel,
            value = display.stats.mostCommon,
            modifier = Modifier.weight(1f),
        )
        StatCard(
            label = strings.trendLabel,
            value = display.stats.trend.symbol,
            sublabel = trendSublabel(display.stats.trend),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun CompactView(display: SafetyHistoryDisplay) {
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
            DataDisplayGlyphs.AlertOctagon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
        Column(modifier = Modifier.weight(1f)) {
            BodyText(display.compactPrimaryText, maxLines = 1)
            display.compactSecondaryText?.let { Caption(it) }
        }
    }
}

@Composable
private fun SafetyEventFeed(rows: List<SafetyEventRow>) {
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
private fun SafetyHistoryEmpty(strings: SafetyHistoryStrings) {
    EmptyState(
        message = strings.noEventsMessage,
        icon = DataDisplayGlyphs.AlertOctagon,
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

/** The web StatCard "Trend" sublabel: ↑ → Increasing, ↓ → Decreasing, → / — → Stable. */
@Composable
private fun trendSublabel(trend: SafetyTrend): String =
    when (trend) {
        SafetyTrend.Up -> stringResource(R.string.translation_widget_trendUp)
        SafetyTrend.Down -> stringResource(R.string.translation_widget_trendDown)
        SafetyTrend.Flat, SafetyTrend.Unknown -> stringResource(R.string.translation_widget_trendFlat)
    }

private fun glyphVector(glyph: SafetyEventGlyph): ImageVector =
    when (glyph) {
        SafetyEventGlyph.AlertOctagon -> DataDisplayGlyphs.AlertOctagon
        SafetyEventGlyph.AlertTriangle -> DataDisplayGlyphs.AlertTriangle
        SafetyEventGlyph.ShieldAlert -> SafetyShieldAlertGlyph
        SafetyEventGlyph.Navigation -> SafetyNavigationGlyph
        SafetyEventGlyph.CarFront -> SafetyCarFrontGlyph
    }

@Composable
private fun toneColor(tone: SafetyEventTone): Color =
    when (tone) {
        SafetyEventTone.Critical -> TeslaTokens.status.danger
        SafetyEventTone.Warning -> TeslaTokens.status.warning
        SafetyEventTone.Info -> TeslaTokens.status.info
        SafetyEventTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
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
 * Builds the localized [SafetyHistoryStrings] from the i18n catalog (P1/S10): the title, the "events" word
 * + empty message, the three stat labels, the header refresh/refreshing/offline microcopy, the row
 * event-time formatter (web `WidgetEventFeed.formatRelativeTime` — just-now / minutes / hours / absolute
 * date), and the `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberSafetyHistoryStrings(): SafetyHistoryStrings {
    val title = stringResource(R.string.translation_widget_safetyHistory)
    val eventsWord = stringResource(R.string.translation_widget_safetyEvents)
    val noEvents = stringResource(R.string.translation_widget_noSafetyEvents)
    val total = stringResource(R.string.translation_widget_safetyTotal)
    val mostCommon = stringResource(R.string.translation_widget_safetyMostCommon)
    val trend = stringResource(R.string.translation_widget_safetyTrend)
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
        eventsWord,
        noEvents,
        total,
        mostCommon,
        trend,
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
        SafetyHistoryStrings(
            title = title,
            eventsWord = eventsWord,
            noEventsMessage = noEvents,
            totalLabel = total,
            mostCommonLabel = mostCommon,
            trendLabel = trend,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatEventTime = { time ->
                when (time) {
                    SafetyEventTime.Unknown -> EM_DASH
                    SafetyEventTime.JustNow -> justNow
                    is SafetyEventTime.MinutesAgo -> minutes.format(time.value)
                    is SafetyEventTime.HoursAgo -> hours.format(time.value)
                    is SafetyEventTime.Absolute -> formatAbsolute(time.epochMillis)
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

/** The web Lucide `ShieldAlert` glyph: a shield outline with an inset exclamation mark (FCW marker). */
private val SafetyShieldAlertGlyph: ImageVector =
    strokedGlyph("SafetyShieldAlert") {
        moveTo(12f, 3f)
        lineTo(19f, 6f)
        lineTo(19f, 12f)
        curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
        curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
        lineTo(5f, 6f)
        close()
        moveTo(12f, 8f)
        lineTo(12f, 13f)
        dot(12f, EXCLAMATION_DOT_Y)
    }

/** The web Lucide `Navigation` glyph: a paper-plane arrow (lane-departure marker). */
private val SafetyNavigationGlyph: ImageVector =
    strokedGlyph("SafetyNavigation") {
        moveTo(3f, 11f)
        lineTo(22f, 2f)
        lineTo(13f, 21f)
        lineTo(11f, 13f)
        close()
    }

/** The web Lucide `CarFront` glyph: a car front silhouette (blind-spot marker). */
private val SafetyCarFrontGlyph: ImageVector =
    strokedGlyph("SafetyCarFront") {
        rect(3f, 10f, 21f, 18f)
        moveTo(5f, 10f)
        lineTo(7f, 6f)
        lineTo(17f, 6f)
        lineTo(19f, 10f)
        dot(7f, 14f)
        dot(17f, 14f)
        moveTo(6f, 18f)
        lineTo(6f, 20f)
        moveTo(18f, 18f)
        lineTo(18f, 20f)
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}
