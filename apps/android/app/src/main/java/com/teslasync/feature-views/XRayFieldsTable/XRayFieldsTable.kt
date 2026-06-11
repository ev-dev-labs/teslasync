// The native Jetpack Compose + Material 3 XRayFieldsTable feature view — a parity port of
// web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx. The web component is purely
// presentational: its parent (the Ingest X-Ray page) loads the per-field `IngestXRayFieldStat[]` for one
// vehicle/window and passes it down with a `loading` flag. The component renders the shared `<DataTable>`
// (field / sample_count / last_seen_at / value_kind), sortable on every column via `useSortToggle`, with a
// "No samples in this window" `emptyMessage` when nothing arrived.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its only
// web hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and `useSortToggle`, mapped to the
// hoisted [SortState] + `toggledBy`). The host supplies the rows through the shared P1/S8 state-holder
// layer as a [UiState] (the cache-then-network projection of the X-Ray feed), so this feature view also
// renders every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. The empty + content branches reproduce the
// web component exactly. A web-parity overload that takes the raw `(rows, loading)` props is also provided
// for hosts that already hold the list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/XRayFieldsTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xrayfieldstable

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The web `DataTable` `pagination={{ defaultPageSize: 50 }}` page size. */
private const val XRAY_PAGE_SIZE = 50

// Column weights — the relative horizontal share each column gets in the responsive Material table. The
// signal `field` is the widest (web `font-mono` identifiers can be long); the numeric count is narrowest.
private const val WEIGHT_FIELD = 2.2f
private const val WEIGHT_SAMPLE_COUNT = 1.0f
private const val WEIGHT_LAST_SEEN = 1.4f
private const val WEIGHT_VALUE_KIND = 1.2f

/**
 * The already-localized strings the table renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary
 * and are passed down, keeping the table free of any English literal.
 */
data class XRayFieldsTableStrings(
    val field: String,
    val samples: String,
    val lastSeen: String,
    val kind: String,
    val empty: String,
    val loading: String,
)

/**
 * Stateful entry point for the Ingest X-Ray per-field table. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared X-Ray feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the per-field `IngestXRayFieldStat[]`.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun XRayFieldsTable(
    state: UiState<List<IngestXRayFieldStat>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordXRayFieldsTableOpened(logger) }
    XRayFieldsTableContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ rows, loading })` props, for hosts that already
 * hold the loaded list. Projects them onto a [UiState] via [XRayFieldsTableProjection.projectUiState]
 * (content / loading / empty), then renders. Records `view.opened` like the stateful entry. There is no
 * fetch behind it, so it offers no retry affordance.
 */
@Composable
fun XRayFieldsTable(
    rows: List<IngestXRayFieldStat>,
    loading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordXRayFieldsTableOpened(logger) }
    val state = remember(rows, loading) { XRayFieldsTableProjection.projectUiState(rows, loading) }
    XRayFieldsTableContent(state = state, onRetry = {}, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's empty/content branches (the "No samples in this window" message when nothing arrived,
 * otherwise the sortable [DataTable]) and adds the lifecycle chrome the host's feed implies: a "Loading…"
 * table while a first load is in flight, a hard-error retry surface, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * The sort is hoisted here (web `useSortToggle('sample_count','desc')`); [locale]/[zoneId] format the
 * sample counts and the rare absolute `last_seen_at` fall-through.
 */
@Composable
fun XRayFieldsTableContent(
    state: UiState<List<IngestXRayFieldStat>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: XRayFieldsTableStrings = rememberXRayFieldsTableStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    var sortState by remember { mutableStateOf(SortState(XRAY_COL_SAMPLE_COUNT, SortDirection.Desc)) }
    val nowMillis = remember(state.fetchedAt, state.data) { System.currentTimeMillis() }
    val formatAge = rememberXRayFreshnessFormatter()
    val formatLastSeen = rememberXRayLastSeenFormatter(nowMillis, zoneId, locale)
    val formatCount: (Long) -> String =
        remember(locale) { { count -> XRayFieldsTableProjection.formatSampleCount(count, locale) } }

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                XRayFieldsTableTable(
                    rows = emptyList(),
                    strings = strings,
                    formatLastSeen = formatLastSeen,
                    formatCount = formatCount,
                    sortState = sortState,
                    onSortChange = { sortState = sortState.toggledBy(it) },
                    emptyText = strings.loading,
                )

            state.isError -> XRayFieldsTableError(onRetry = onRetry)

            state.isEmpty -> XRayFieldsTableEmpty(strings = strings)

            else -> {
                if (state.stale || state.refreshing || state.hasError) {
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
                XRayFieldsTableTable(
                    rows = XRayFieldsTableProjection.sortRows(state.data ?: emptyList(), sortState),
                    strings = strings,
                    formatLastSeen = formatLastSeen,
                    formatCount = formatCount,
                    sortState = sortState,
                    onSortChange = { sortState = sortState.toggledBy(it) },
                    emptyText = strings.empty,
                )
            }
        }
    }
}

/**
 * Builds the four-column field-stats table the web component defines. Headers arrive already-localized so
 * this helper carries no English literal. The `field` cell uses [CodeText] (web `font-mono`); the count is
 * right-aligned grouped text (web `fmtInt` + `align: 'right'`); `last_seen_at` is a relative label (web
 * `<TimeStamp format="relative" />`); `value_kind` is a neutral [Badge] via
 * [XRayFieldsTableProjection.formatValueKind] (web `<Badge variant="neutral">`). Every column is sortable.
 */
private fun xrayColumns(
    strings: XRayFieldsTableStrings,
    formatLastSeen: (String) -> String,
    formatCount: (Long) -> String,
): List<TableColumn<IngestXRayFieldStat>> =
    listOf(
        TableColumn(key = XRAY_COL_FIELD, header = strings.field, weight = WEIGHT_FIELD, sortable = true) {
            CodeText(it.field)
        },
        TableColumn(
            key = XRAY_COL_SAMPLE_COUNT,
            header = strings.samples,
            weight = WEIGHT_SAMPLE_COUNT,
            sortable = true,
            alignEnd = true,
        ) {
            Caption(formatCount(it.sampleCount))
        },
        TableColumn(key = XRAY_COL_LAST_SEEN, header = strings.lastSeen, weight = WEIGHT_LAST_SEEN, sortable = true) {
            Caption(formatLastSeen(it.lastSeenAt))
        },
        TableColumn(key = XRAY_COL_VALUE_KIND, header = strings.kind, weight = WEIGHT_VALUE_KIND, sortable = true) {
            Badge(text = XRayFieldsTableProjection.formatValueKind(it.valueKind), variant = BadgeVariant.Neutral)
        },
    )

/**
 * The paginated, sortable field table — the native [DataTable] with a client-side page window (web
 * `pagination.defaultPageSize = 50`). With no rows the table shows [emptyText] beneath its header chrome
 * (the loading message during a first load, or the "no samples" message), reproducing the web
 * `emptyMessage`. The pagination footer appears only once the row count exceeds a page. The header sort
 * affordances are wired through [sortState] / [onSortChange] (web `sortKey` / `sortDir` / `onSort`).
 */
@Composable
private fun XRayFieldsTableTable(
    rows: List<IngestXRayFieldStat>,
    strings: XRayFieldsTableStrings,
    formatLastSeen: (String) -> String,
    formatCount: (Long) -> String,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    emptyText: String,
) {
    val columns = remember(strings, formatLastSeen, formatCount) { xrayColumns(strings, formatLastSeen, formatCount) }
    val total = rows.size
    val pageCount = maxOf(1, (total + XRAY_PAGE_SIZE - 1) / XRAY_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * XRAY_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + XRAY_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.field },
        modifier = Modifier.fillMaxWidth(),
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = emptyText,
        footer =
            if (total > XRAY_PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = XRAY_PAGE_SIZE,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = firstLabel,
                        previousLabel = previousLabel,
                        nextLabel = nextLabel,
                        lastLabel = lastLabel,
                        showingText = { start, end, count ->
                            context.getString(R.string.translation_pagination_showing, start, end, count)
                        },
                    )
                }
            } else {
                null
            },
    )
}

/**
 * Empty state — web parity: the "No samples in this window" message. A telemetry-signal glyph keeps the
 * panel from collapsing to a blank box; [EmptyState] exposes the message as its accessibility label so the
 * section is announced even when it holds no rows.
 */
@Composable
private fun XRayFieldsTableEmpty(strings: XRayFieldsTableStrings) {
    EmptyState(
        message = strings.empty,
        icon = DataDisplayGlyphs.Wifi,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun XRayFieldsTableError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [XRayFieldsTableStrings] from the i18n catalog (P1/S10): the `admin.xray.fields.*`
 * keys the web component reads through `useTranslation`. Resolved once at the Compose boundary so the rest
 * of the surface stays free of any English literal.
 */
@Composable
private fun rememberXRayFieldsTableStrings(): XRayFieldsTableStrings {
    val field = stringResource(R.string.translation_admin_xray_fields_cols_field)
    val samples = stringResource(R.string.translation_admin_xray_fields_cols_count)
    val lastSeen = stringResource(R.string.translation_admin_xray_fields_cols_lastSeen)
    val kind = stringResource(R.string.translation_admin_xray_fields_cols_kind)
    val empty = stringResource(R.string.translation_admin_xray_fields_empty)
    val loading = stringResource(R.string.translation_admin_xray_fields_loading)
    return remember(field, samples, lastSeen, kind, empty, loading) {
        XRayFieldsTableStrings(
            field = field,
            samples = samples,
            lastSeen = lastSeen,
            kind = kind,
            empty = empty,
            loading = loading,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberXRayFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Localized relative `last_seen_at` formatter — the native render of web `<TimeStamp format="relative" />`.
 * Buckets each ISO stamp against [nowMillis] via [XRayFieldsTableProjection.lastSeenRelative], then maps the
 * bucket to a `translation_freshness_*` string; the rare `>= 7d` case formats an absolute date in [zoneId]
 * / [locale] (web fall-through to `formatDate`), and an unparseable stamp renders the em dash (web "—").
 */
@Composable
private fun rememberXRayLastSeenFormatter(
    nowMillis: Long,
    zoneId: ZoneId,
    locale: Locale,
): (String) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(nowMillis, zoneId, locale, justNow, minutes, hours, days) {
        { iso ->
            when (val relative = XRayFieldsTableProjection.lastSeenRelative(iso, nowMillis)) {
                XRayLastSeen.Invalid -> EM_DASH
                XRayLastSeen.JustNow -> justNow
                is XRayLastSeen.Minutes -> minutes.format(relative.value)
                is XRayLastSeen.Hours -> hours.format(relative.value)
                is XRayLastSeen.Days -> days.format(relative.value)
                is XRayLastSeen.Absolute -> XRayLastSeenFormatting.absolute(relative.epochMillis, zoneId, locale)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    XRayFieldsTableStrings(
        field = "Field",
        samples = "Samples",
        lastSeen = "Last seen",
        kind = "Kind",
        empty = "No samples in this window. Try widening the window or confirm the vehicle is publishing.",
        loading = "Loading\u2026",
    )

private val PREVIEW_ROWS =
    listOf(
        IngestXRayFieldStat(field = "VehicleSpeed", sampleCount = 12_345, lastSeenAt = "2026-06-11T14:21:30Z", valueKind = 5),
        IngestXRayFieldStat(field = "Soc", sampleCount = 980, lastSeenAt = "2026-06-11T14:18:00Z", valueKind = 3),
        IngestXRayFieldStat(field = "Location", sampleCount = 64, lastSeenAt = "2026-06-11T13:55:00Z", valueKind = 10),
        IngestXRayFieldStat(field = "ChargeState", sampleCount = 5, lastSeenAt = "2026-06-10T09:00:00Z", valueKind = 1),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun XRayFieldsTableContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayFieldsTableContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_ROWS),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun XRayFieldsTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayFieldsTableContent(state = UiState.loading(), onRetry = {}, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun XRayFieldsTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayFieldsTableContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun XRayFieldsTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayFieldsTableContent(state = UiState(phase = UiPhase.Error), onRetry = {}, strings = PREVIEW_STRINGS)
    }
}
