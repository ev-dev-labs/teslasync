// The native Jetpack Compose + Material 3 EventHistoryTable feature view — a parity port of
// web/src/features/admin/components/security-access/EventHistoryTable.tsx. The web component is purely
// presentational: its parent (`SecurityAccessPage` via `useSecurityEvents`) loads the `SecurityEvent[]` and
// passes it down with an `isLoading` flag, and the component renders a `FadeIn` + `GlassPanel` titled
// "Security Event History" containing either an 8-line `Skeleton` (while loading) or a sortable, paginated
// `DataTable` of five columns — Time, Lock, Sentry, Doors, Windows — with a "No security events recorded
// yet." empty message. It performs no fetching.
//
// This native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). The host supplies the events through
// the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the `/security`
// feed), so the feature view also renders every lifecycle state that layer can carry — loading skeleton, hard
// error with retry, empty, content, and stale/offline (cached "last known" with a freshness chip + silent
// auto-refresh) — without ever fetching. The loading + content + empty branches reproduce the web component
// exactly. A web-parity overload that takes the raw `history` list + `isLoading` flag is also provided for
// hosts that already hold the loaded events, mirroring the web props 1:1.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EventHistoryTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventhistorytable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

private const val FADE_DELAY_MS: Int = 300
private const val SKELETON_LINES: Int = 8

// Relative column widths: the (no-wrap) timestamp gets the most room, the two badge columns the least.
private const val TIME_WEIGHT: Float = 2.2f
private const val LOCK_WEIGHT: Float = 1.3f
private const val SENTRY_WEIGHT: Float = 1.3f
private const val DOORS_WEIGHT: Float = 1.7f
private const val WINDOWS_WEIGHT: Float = 1.7f

/**
 * Stateful entry point — records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the shared `/security` feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP. Owns the table sort state (the web `createdAt`
 * sortable column).
 *
 * @param state the cache-then-network projection of the vehicle's `SecurityEvent[]` (web `useSecurityEvents`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EventHistoryTable(
    state: UiState<List<SecurityEvent>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordEventHistoryTableOpened(logger) }
    var sortState by remember { mutableStateOf(SortState()) }
    EventHistoryTableContent(
        state = state,
        onRetry = onRetry,
        sortState = sortState,
        onSortChange = { sortState = sortState.toggledBy(it) },
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ history, isLoading }` props, for hosts that already hold
 * the loaded list. `isLoading` maps to the loading skeleton; a resolved-but-empty list maps to the empty
 * message; a non-empty list maps to the populated table — the exact three body states the web source expresses.
 * Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun EventHistoryTable(
    history: List<SecurityEvent>,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(history, isLoading) {
            val phase =
                when {
                    isLoading -> UiPhase.Loading
                    history.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = history)
        }
    EventHistoryTable(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * `FadeIn` + `GlassPanel` + titled body: an 8-line skeleton while loading, otherwise the sortable, paginated
 * [DataTable] (which itself shows the "No security events recorded yet." message when empty — web parity). It
 * adds the lifecycle chrome the host's feed implies: a hard-error retry surface and a freshness chip that
 * reflects refreshing/stale/offline; stale (non-error) data silently auto-refreshes. [locale]/[zoneId] format
 * each row's timestamp.
 */
@Composable
fun EventHistoryTableContent(
    state: UiState<List<SecurityEvent>>,
    onRetry: () -> Unit,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: EventHistoryStrings = rememberEventHistoryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val title = stringResource(R.string.translation_admin_security_eventHistory)
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            SectionTitle(title, modifier = Modifier.padding(bottom = Spacing.md))
            when {
                state.isLoading -> EventHistoryLoading()
                state.isError -> EventHistoryError(onRetry = onRetry)
                else ->
                    EventHistoryBody(
                        state = state,
                        sortState = sortState,
                        onSortChange = onSortChange,
                        strings = strings,
                        locale = locale,
                        zoneId = zoneId,
                        title = title,
                    )
            }
        }
    }
}

/**
 * The populated/empty table body — sorts the events (web `createdAt` column), pages them at
 * [EVENT_HISTORY_PAGE_SIZE], projects the visible page, and renders the shared [DataTable]. A freshness chip is
 * shown above the table whenever the feed is refreshing/stale/offline; the table always renders (empty rows
 * surface the localized empty message rather than a blank box).
 */
@Composable
private fun EventHistoryBody(
    state: UiState<List<SecurityEvent>>,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    strings: EventHistoryStrings,
    locale: Locale,
    zoneId: ZoneId,
    title: String,
) {
    val events = state.data.orEmpty()
    val sorted = remember(events, sortState) { sortEvents(events, sortState) }
    val total = sorted.size
    var page by remember(total) { mutableIntStateOf(1) }
    val rows =
        remember(sorted, page, strings, locale, zoneId) {
            val visible =
                if (total == 0) {
                    emptyList()
                } else {
                    val bounds = PaginationMath.sliceBounds(page, EVENT_HISTORY_PAGE_SIZE, total)
                    sorted.subList(bounds.first, bounds.last + 1)
                }
            EventHistoryProjection.project(
                events = visible,
                strings = strings,
                formatTime = { iso -> EventHistoryTimeFormatting.format(iso, zoneId, locale) },
            )
        }

    if (state.stale || state.refreshing || state.hasError) {
        EventHistoryFreshness(state = state)
    }

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            { EventHistoryPagination(page = page, total = total, onPageChange = { page = it }) }
        } else {
            null
        }

    DataTable(
        columns = eventHistoryColumns(rememberEventHistoryColumnHeaders()),
        rows = rows,
        keyOf = { it.id },
        modifier = Modifier.semantics { contentDescription = title },
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = stringResource(R.string.translation_admin_security_noEvents),
        footer = footer,
    )
}

/**
 * The five web columns: a sortable no-wrap muted `createdAt` timestamp, the Lock + Sentry status badges, and
 * the green/amber Doors + Windows status text. Cell content is already localized + resolved by the projection,
 * so each renderer is a thin map from an [EventHistoryRow] to a shared primitive.
 */
private fun eventHistoryColumns(headers: EventHistoryColumnHeaders): List<TableColumn<EventHistoryRow>> =
    listOf(
        TableColumn(key = SORT_KEY_TIME, header = headers.time, weight = TIME_WEIGHT, sortable = true) { row ->
            Caption(row.time)
        },
        TableColumn(key = "locked", header = headers.lock, weight = LOCK_WEIGHT) { row ->
            Badge(text = row.lock.label, variant = badgeVariantOf(row.lock.tone))
        },
        TableColumn(key = "sentryMode", header = headers.sentry, weight = SENTRY_WEIGHT) { row ->
            Badge(text = row.sentry.label, variant = badgeVariantOf(row.sentry.tone))
        },
        TableColumn(key = "doorState", header = headers.doors, weight = DOORS_WEIGHT) { row ->
            StatusCell(row.door)
        },
        TableColumn(key = "windows", header = headers.windows, weight = WINDOWS_WEIGHT) { row ->
            StatusCell(row.window)
        },
    )

/** A Doors/Windows cell — green when the state is closed (safe), amber otherwise (web `text-green-400` / `-amber-400`). */
@Composable
private fun StatusCell(cell: StatusText) {
    BodyText(text = cell.text, color = statusColor(cell.closed))
}

/** Maps the semantic [StatusText.closed] flag to the green/amber status token (never a raw hex in render code). */
@Composable
private fun statusColor(closed: Boolean): Color = if (closed) TeslaTokens.status.success else TeslaTokens.status.warning

/** Maps the projection's semantic [BadgeTone] to the shared [BadgeVariant]. */
private fun badgeVariantOf(tone: BadgeTone): BadgeVariant =
    when (tone) {
        BadgeTone.Success -> BadgeVariant.Success
        BadgeTone.Danger -> BadgeVariant.Danger
        BadgeTone.Neutral -> BadgeVariant.Neutral
    }

/** First-load body — the web `<Skeleton lines={8} />`, with an accessible "loading" description. */
@Composable
private fun EventHistoryLoading() {
    val label = stringResource(R.string.translation_common_loading)
    SkeletonLines(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        lines = SKELETON_LINES,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent for the feed's failure state. */
@Composable
private fun EventHistoryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip surfacing refreshing/stale/offline over the cached table (ADR-013). */
@Composable
private fun EventHistoryFreshness(state: UiState<List<SecurityEvent>>) {
    val formatAge = rememberEventHistoryFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/** Pagination footer — the web `DataTable` page controls at [EVENT_HISTORY_PAGE_SIZE]. */
@Composable
private fun EventHistoryPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = EVENT_HISTORY_PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            context.getString(R.string.translation_pagination_showing, start, end, count)
        },
    )
}

/** The five already-localized column headers — the web `t('admin.security.col.*')` strings. */
data class EventHistoryColumnHeaders(
    val time: String,
    val lock: String,
    val sentry: String,
    val doors: String,
    val windows: String,
)

/** Resolves the five `translation_admin_security_col_*` catalog entries (P1/S10). */
@Composable
fun rememberEventHistoryColumnHeaders(): EventHistoryColumnHeaders =
    EventHistoryColumnHeaders(
        time = stringResource(R.string.translation_admin_security_col_time),
        lock = stringResource(R.string.translation_admin_security_col_lock),
        sentry = stringResource(R.string.translation_admin_security_col_sentry),
        doors = stringResource(R.string.translation_admin_security_col_doors),
        windows = stringResource(R.string.translation_admin_security_col_windows),
    )

/** Resolves the five per-row `translation_admin_security_*` cell labels the projection folds in (P1/S10). */
@Composable
fun rememberEventHistoryStrings(): EventHistoryStrings =
    EventHistoryStrings(
        locked = stringResource(R.string.translation_admin_security_locked),
        unlocked = stringResource(R.string.translation_admin_security_unlocked),
        on = stringResource(R.string.translation_admin_security_on),
        off = stringResource(R.string.translation_admin_security_off),
        closed = stringResource(R.string.translation_admin_security_closed),
    )

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberEventHistoryFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_EVENTS =
    listOf(
        SecurityEvent(
            id = "1",
            createdAt = "2026-04-04T14:30:00Z",
            locked = true,
            sentryMode = SignalValue.StringValue("SentryModeStateOn"),
            doorState = SignalValue.StringValue("Closed"),
            fdWindow = SignalValue.StringValue("Closed"),
            fpWindow = SignalValue.StringValue("Closed"),
            rdWindow = SignalValue.StringValue("Closed"),
            rpWindow = SignalValue.StringValue("Closed"),
        ),
        SecurityEvent(
            id = "2",
            createdAt = "2026-04-04T13:00:00Z",
            locked = false,
            sentryMode = SignalValue.BoolValue(false),
            doorState = SignalValue.StringValue("Front Left Open"),
            fdWindow = SignalValue.StringValue("Open"),
            fpWindow = SignalValue.StringValue("Closed"),
            rdWindow = SignalValue.StringValue("Vent"),
            rpWindow = SignalValue.StringValue("Closed"),
        ),
        SecurityEvent(
            id = "3",
            createdAt = "2026-04-04T12:00:00Z",
            locked = null,
            sentryMode = SignalValue.Absent,
            doorState = SignalValue.Absent,
            fdWindow = SignalValue.Absent,
            fpWindow = SignalValue.Absent,
            rdWindow = SignalValue.Absent,
            rpWindow = SignalValue.Absent,
        ),
    )

@Preview(name = "Data", showBackground = true)
@Composable
private fun EventHistoryTableDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EventHistoryTableContent(
            state = UiState(UiPhase.Content, data = PREVIEW_EVENTS),
            onRetry = {},
            sortState = SortState(),
            onSortChange = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun EventHistoryTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EventHistoryTableContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            sortState = SortState(),
            onSortChange = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun EventHistoryTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EventHistoryTableContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            sortState = SortState(),
            onSortChange = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun EventHistoryTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EventHistoryTableContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            sortState = SortState(),
            onSortChange = {},
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun EventHistoryTableOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EventHistoryTableContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_EVENTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            sortState = SortState(),
            onSortChange = {},
        )
    }
}
