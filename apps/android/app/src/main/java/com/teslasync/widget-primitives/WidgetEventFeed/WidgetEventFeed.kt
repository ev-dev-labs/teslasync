// The native Jetpack Compose + Material 3 WidgetEventFeed primitive — a parity port of the shared web
// building block web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx. It is a PURE PRESENTATIONAL
// feed: the parent (a dashboard widget such as SentryEventLog) owns the [EventFeedItem] list; this primitive
// reproduces the web composition exactly — sort the items newest-first, cap them at the per-footprint limit
// (web `maxItems ?? (compact ? 3 : 10)`), render a [TimelineItem] per row with a relative-time label, or the
// friendly "No events yet" empty state when the capped list is empty. It performs NO HTTP and binds no data
// store (the web hooks `useTranslation` / `useDateFormat` are presentation facades, not data ports), so —
// like the sibling HistoryListRow / BatteryDelta primitives — there is no Source/ViewModel; the pure logic
// lives in WidgetEventFeedModel.kt and this file is a thin render layer over it.
//
// Web → native mappings (documented per honesty covenant #9, not silently dropped):
//   • web `EventFeedItem.color` (a CSS string) → [EventFeedItem.accent] (a Compose [Color]); the parent
//     resolves its own accent, exactly as it passes its own hex to the web component.
//   • web `EventFeedItem.icon` (an arbitrary `ReactNode`) → [EventFeedItem.icon] (an [ImageVector]?); a
//     `null` icon renders the TimelineItem's neutral dot marker (the same fallback the shared TimelineItem
//     already ships).
//   • web `EventFeedItem.href` (a router `<Link>`) → routed through the host-supplied [onNavigate]
//     (the NavController), exactly as the web `<Link>` relies on its router context.
//   • the absolute ≥ 24h fallback (web `formatDateTime`) is rendered with the DEVICE locale + zone (Android
//     system settings); the web threads the app's settings timezone — a documented deviation for this
//     store-less primitive, consistent with the sibling TimeStamp surface's locale handling.
//
// Accessibility: each row is one merged TalkBack node whose spoken label folds the title, subtitle and
// relative time into a single phrase (so a feed reads row-by-row, not field-by-field), while a navigable row
// keeps its activate action + Button role. The empty state is announced by the shared EmptyState. Every
// string resolves through the P1/S10 catalog (`translation_widget_noEvents`, `translation_freshness_*`);
// there are no English literals here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetEventFeed) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgeteventfeed

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val NOW_TICK_MS = 30_000L
private val PREVIEW_HEIGHT = 260.dp

/**
 * One feed entry — the native analogue of the web `EventFeedItem`. The [timestamp] is the raw ISO-8601 wire
 * string (parsed + relative-formatted by the primitive, exactly as the web component does); [accent] is the
 * marker colour the parent resolves (web `color`), and [icon] the marker glyph (web `icon`, `null` → the
 * neutral dot). [severity] mirrors the web optional union for contract parity (the render does not branch on
 * it), and [href] makes the row navigate through the host's navigator.
 */
data class EventFeedItem(
    val id: String,
    val title: String,
    val timestamp: String,
    val accent: Color,
    val icon: ImageVector? = null,
    val subtitle: String? = null,
    val severity: EventSeverity? = null,
    val href: String? = null,
)

/**
 * Stateful entry point — the faithful port of the web `WidgetEventFeed`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), then renders the feed. Performs no HTTP; [logger] defaults to the
 * process logger. For a host that renders the feed inside a list and does not want a per-mount diagnostic,
 * [WidgetEventFeedContent] is the diagnostics-free render seam.
 *
 * @param items the feed entries (web `items`) — the parent owns and supplies them.
 * @param maxItems explicit row cap (web `maxItems`); when null the [compact] default applies.
 * @param compact whether to use the compact 3-row cap (web `compact`, default false → 10 rows).
 * @param emptyMessage optional empty-state copy (web `emptyMessage`); defaults to the catalog "No events yet".
 * @param emptyIcon optional empty-state glyph (web `emptyIcon`).
 * @param onNavigate host navigator invoked with an item's `href` when its row is tapped (the web `<Link>`).
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 */
@Composable
fun WidgetEventFeed(
    items: List<EventFeedItem>,
    modifier: Modifier = Modifier,
    maxItems: Int? = null,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    onNavigate: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetEventFeedDiagnostics.recordViewOpened(logger) }
    WidgetEventFeedContent(
        items = items,
        modifier = modifier,
        maxItems = maxItems,
        compact = compact,
        emptyMessage = emptyMessage,
        emptyIcon = emptyIcon,
        onNavigate = onNavigate,
    )
}

/**
 * Stateless renderer for both surface states — the preview / UI-test entry point and the list-friendly seam
 * (it emits no diagnostics, so a host rendering the feed in a list never fires a per-mount `view.opened`).
 * Orders + caps the items through the pure model, renders the newest-first [TimelineItem] feed or the shared
 * [EmptyState]. [nowMillis] is injected (default: a 30s-ticking clock) so relative-time labels stay current
 * and tests pin them deterministically.
 */
@Composable
fun WidgetEventFeedContent(
    items: List<EventFeedItem>,
    modifier: Modifier = Modifier,
    maxItems: Int? = null,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    onNavigate: (String) -> Unit = {},
    nowMillis: Long = rememberNowMillis(),
) {
    val limit = eventFeedLimit(maxItems, compact)
    val ordered = remember(items, limit) { orderEventFeed(items, limit) { parseEpochMillis(it.timestamp) } }
    val formatRelative = rememberEventRelativeFormatter()
    val emptyText = emptyMessage ?: stringResource(R.string.translation_widget_noEvents)

    if (ordered.isEmpty()) {
        Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            EmptyState(message = emptyText, icon = emptyIcon)
        }
        return
    }

    Column(modifier = modifier.fillMaxHeight().verticalScroll(rememberScrollState())) {
        ordered.forEachIndexed { index, item ->
            val relative = formatRelative(eventRelativeTime(parseEpochMillis(item.timestamp), nowMillis))
            val description = listOfNotNull(item.title, item.subtitle, relative).joinToString(A11Y_SEPARATOR)
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = item.title,
                        time = relative,
                        subtitle = item.subtitle,
                        icon = item.icon,
                        accent = item.accent,
                        onClick = item.href?.let { href -> { onNavigate(href) } },
                    ),
                isLast = index == ordered.lastIndex,
                modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
            )
        }
    }
}

/**
 * Builds the relative-time formatter that maps an [EventRelativeTime] tier onto a localized label: the
 * freshness catalog keys (P1/S10) for the under-a-day tiers, and a device locale + zone absolute date+time
 * for [EventRelativeTime.Absolute] (web `formatDateTime`). Memoized over the resolved strings + formatter so
 * it is stable across recompositions.
 */
@Composable
private fun rememberEventRelativeFormatter(): (EventRelativeTime) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val zone = ZoneId.systemDefault()
    val absolute =
        remember {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault())
        }
    return remember(justNow, minutes, hours, absolute, zone) {
        { age ->
            when (age) {
                EventRelativeTime.Unknown -> EM_DASH
                EventRelativeTime.JustNow -> justNow
                is EventRelativeTime.Minutes -> minutes.format(age.value)
                is EventRelativeTime.Hours -> hours.format(age.value)
                is EventRelativeTime.Absolute -> absolute.format(Instant.ofEpochMilli(age.epochMillis).atZone(zone))
            }
        }
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

// ── Previews — one per rendered state (content / compact / navigable / empty) ──────────────────────────

private val PREVIEW_NOW: Long = parseEpochMillis("2026-06-06T12:05:00Z") ?: 0L

private fun sampleItems(): List<EventFeedItem> =
    listOf(
        EventFeedItem(
            id = "1",
            title = "Charging started",
            timestamp = "2026-06-06T11:05:00Z",
            accent = Color(0xFF34D399),
            icon = DataDisplayGlyphs.Bolt,
            subtitle = "Home",
        ),
        EventFeedItem(
            id = "2",
            title = "Drive completed",
            timestamp = "2026-06-06T11:50:00Z",
            accent = Color(0xFF22D3EE),
            icon = DataDisplayGlyphs.MapPin,
            subtitle = "Office \u2192 Home",
        ),
        EventFeedItem(
            id = "3",
            title = "Sentry event",
            timestamp = "2026-06-06T11:20:00Z",
            accent = Color(0xFFF59E0B),
            icon = DataDisplayGlyphs.Shield,
        ),
        EventFeedItem(
            id = "4",
            title = "Software update",
            timestamp = "2026-06-06T11:35:00Z",
            accent = Color(0xFFA78BFA),
            icon = DataDisplayGlyphs.Info,
            href = "/updates/4",
        ),
    )

@Preview(name = "WidgetEventFeed · content", showBackground = true)
@Composable
private fun WidgetEventFeedContentPreview() {
    TeslaSyncTheme {
        Box(modifier = Modifier.height(PREVIEW_HEIGHT)) {
            WidgetEventFeedContent(items = sampleItems(), nowMillis = PREVIEW_NOW)
        }
    }
}

@Preview(name = "WidgetEventFeed · compact", showBackground = true)
@Composable
private fun WidgetEventFeedCompactPreview() {
    TeslaSyncTheme {
        Box(modifier = Modifier.height(PREVIEW_HEIGHT)) {
            WidgetEventFeedContent(items = sampleItems(), compact = true, nowMillis = PREVIEW_NOW)
        }
    }
}

@Preview(name = "WidgetEventFeed · empty", showBackground = true)
@Composable
private fun WidgetEventFeedEmptyPreview() {
    TeslaSyncTheme {
        Box(modifier = Modifier.height(PREVIEW_HEIGHT)) {
            WidgetEventFeedContent(items = emptyList(), emptyIcon = DataDisplayGlyphs.History, nowMillis = PREVIEW_NOW)
        }
    }
}
