// The native Jetpack Compose + Material 3 SignalHistoryTable feature view — a parity port of
// web/src/features/telemetry/components/SignalHistoryTable.tsx. The web component is purely presentational:
// its parent (SignalLogViewerPage / SignalExplorerPage / SignalsWorkspacePage) owns the page-global signal
// selector + the server-side query and passes the current page of `SignalLogEntry[]` down with
// `selectedSignals` / `page` / `pageSize` / `totalRows` / `onPageChange` / `loading`. The component renders a
// `FadeIn` + `GlassPanel` titled with an Activity icon + an optional "Page X · N total" meta badge, then
// either a 5-line `Skeleton` (loading), a sortless paginated `DataTable` (Timestamp / color-coded Signal /
// Value / Type badge) with raw-payload row expansion, or an `EmptyState`. It performs no fetching.
//
// This native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the P1/S10 i18n catalog, and `useDateFormat`, mapped to the platform
// Locale/ZoneId at the render boundary). The host supplies the page through the shared P1/S8 state-holder
// layer as a [UiState] (the cache-then-network projection of the `/signals/{id}/{name}/history` feed), so the
// feature view also renders every lifecycle state that layer can carry — loading skeleton, hard error with
// retry, empty, content, and stale/offline (cached "last known" with a freshness chip + silent auto-refresh)
// — without ever fetching. The loading + content + empty branches reproduce the web component exactly. A
// web-parity overload that takes the raw `({ rows, selectedSignals, page, pageSize, totalRows, loading })`
// props is also provided for hosts that already hold the loaded page, mirroring the web props 1:1.
//
// The shared native `DataTable` renders the four web columns; the web's expandable raw-payload feature (which
// the shared table does not express inline) is reproduced with an accessible per-row expand toggle that
// reveals the row's pretty-printed JSON (web `JSON.stringify(r, null, 2)`) directly beneath the table.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalHistoryTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalhistorytable

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

// Column weights — the relative horizontal share each column gets. The signal `field` (web `font-mono`
// identifier) and the no-wrap timestamp get the most room; the type badge + expand toggle the least.
private const val TIME_WEIGHT: Float = 2.0f
private const val SIGNAL_WEIGHT: Float = 2.2f
private const val VALUE_WEIGHT: Float = 1.6f
private const val TYPE_WEIGHT: Float = 1.1f
private const val EXPAND_WEIGHT: Float = 0.7f

// The web `loading ? [1,2,3,4,5].map(<Skeleton className="h-8" />)` — five 32 dp shimmer bars.
private const val SKELETON_ROWS: Int = 5
private val SKELETON_HEIGHT = 32.dp

// The web `<span className="h-2 w-2 rounded-full" />` per-signal color dot.
private val SIGNAL_DOT = 8.dp

// The web details column carries no header label; the toggle itself is the labeled affordance.
private const val COL_DETAILS: String = "details"
private const val EMPTY_HEADER: String = ""

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the shared signal-history feed can carry. The host owns the feed (P1/S8) and supplies
 * [onPageChange] (its server-side page setter) + [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the current [SignalHistoryData] page.
 * @param onPageChange re-queries the host at the chosen 1-based page (web `onPageChange`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param title overrides the panel title (web `title?` prop); defaults to the localized "Signal Log".
 * @param showHeaderMeta shows the "Page X · N total" badge (web `showHeaderMeta`, default true).
 * @param expandable enables the raw-payload row expansion (web `expandable`, default true).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalHistoryTable(
    state: UiState<SignalHistoryData>,
    onPageChange: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    showHeaderMeta: Boolean = true,
    expandable: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSignalHistoryTableOpened(logger) }
    SignalHistoryTableContent(
        state = state,
        onPageChange = onPageChange,
        onRetry = onRetry,
        modifier = modifier,
        titleOverride = title,
        showHeaderMeta = showHeaderMeta,
        expandable = expandable,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ rows, selectedSignals, page, pageSize, totalRows,
 * onPageChange, loading, title, showHeaderMeta, expandable })` props, for hosts that already hold the loaded
 * page. Projects them onto a [UiState] via [projectUiState] (content / loading / empty), then renders.
 * Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry
 * affordance.
 */
@Composable
fun SignalHistoryTable(
    rows: List<SignalLogEntry>,
    selectedSignals: List<String>,
    page: Int,
    pageSize: Int,
    totalRows: Int,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    title: String? = null,
    showHeaderMeta: Boolean = true,
    expandable: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(rows, selectedSignals, page, pageSize, totalRows, loading) {
            projectUiState(
                data =
                    SignalHistoryData(
                        rows = rows,
                        selectedSignals = selectedSignals,
                        page = page,
                        pageSize = pageSize,
                        totalRows = totalRows,
                    ),
                loading = loading,
            )
        }
    SignalHistoryTable(
        state = state,
        onPageChange = onPageChange,
        onRetry = {},
        modifier = modifier,
        title = title,
        showHeaderMeta = showHeaderMeta,
        expandable = expandable,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `FadeIn` +
 * `GlassPanel` + titled header, then picks the same branch the web ternary does, extended with the lifecycle
 * chrome the host's feed implies: a 5-line loading skeleton, a hard-error retry surface, the friendly empty
 * state, or the populated table (with a freshness chip above it whenever the feed is refreshing/stale/offline;
 * stale non-error data silently auto-refreshes). [locale]/[zoneId] format each row's timestamp (the web
 * `useDateFormat` binding).
 */
@Composable
fun SignalHistoryTableContent(
    state: UiState<SignalHistoryData>,
    onPageChange: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    titleOverride: String? = null,
    showHeaderMeta: Boolean = true,
    expandable: Boolean = true,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SignalHistoryStrings = rememberSignalHistoryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val data = state.data ?: SignalHistoryData.EMPTY
    val title = titleOverride ?: strings.title
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Md) {
            SignalHistoryHeader(title = title, data = data, showHeaderMeta = showHeaderMeta, strings = strings)
            when {
                state.isLoading -> SignalHistoryLoading()
                state.isError -> SignalHistoryError(onRetry = onRetry)
                data.rows.isEmpty() -> SignalHistoryEmpty(strings = strings)
                else ->
                    SignalHistoryBody(
                        state = state,
                        data = data,
                        expandable = expandable,
                        onPageChange = onPageChange,
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
 * The always-present panel header — the web `flex items-center gap-2 mb-3` row: an Activity-equivalent icon,
 * the [title], and (when [showHeaderMeta]) the right-aligned "Page X · N total" meta badge built from
 * [headerMeta] + [formatRowCount].
 */
@Composable
private fun SignalHistoryHeader(
    title: String,
    data: SignalHistoryData,
    showHeaderMeta: Boolean,
    strings: SignalHistoryStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.History,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        SectionTitle(title, modifier = Modifier.weight(1f))
        if (showHeaderMeta) {
            Caption(
                headerMeta(
                    pageLabel = strings.pageLabel,
                    page = data.page,
                    totalFormatted = formatRowCount(data.totalRows),
                    totalLabel = strings.totalLabel,
                ),
            )
        }
    }
}

/**
 * The populated table body — projects the current page of rows (web per-row `render` callbacks), shows a
 * freshness chip whenever the feed is refreshing/stale/offline, renders the shared [DataTable] (four web
 * columns + an optional accessible expand toggle), reveals each expanded row's raw JSON beneath the table,
 * and renders the server-side [Pagination] footer.
 */
@Composable
private fun SignalHistoryBody(
    state: UiState<SignalHistoryData>,
    data: SignalHistoryData,
    expandable: Boolean,
    onPageChange: (Int) -> Unit,
    strings: SignalHistoryStrings,
    locale: Locale,
    zoneId: ZoneId,
    title: String,
) {
    val rows =
        remember(data.rows, data.selectedSignals, locale, zoneId) {
            SignalHistoryProjection.project(
                entries = data.rows,
                selectedSignals = data.selectedSignals,
                formatTime = { iso -> SignalHistoryTimeFormatting.format(iso, zoneId, locale) },
            )
        }
    var expandedKeys by remember { mutableStateOf(emptySet<String>()) }

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.stale || state.refreshing || state.hasError) {
            SignalHistoryFreshness(state = state)
        }
        DataTable(
            columns =
                signalHistoryColumns(
                    strings = strings,
                    expandable = expandable,
                    expandedKeys = expandedKeys,
                    onToggle = { key -> expandedKeys = expandedKeys.toggle(key) },
                ),
            rows = rows,
            keyOf = { it.key },
            modifier = Modifier.semantics { contentDescription = title },
            emptyText = strings.emptyMessage,
        )
        if (expandable) {
            rows.filter { it.key in expandedKeys }.forEach { row ->
                RawPayload(row = row, detailsLabel = strings.detailsLabel)
            }
        }
        SignalHistoryPagination(
            page = data.page,
            pageSize = data.pageSize,
            total = data.totalRows,
            onPageChange = onPageChange,
        )
    }
}

/**
 * The four web columns (Timestamp / color-coded Signal / Value / Type badge) plus, when [expandable], a
 * trailing accessible expand toggle. Cell content is already localized + resolved by the projection, so each
 * renderer is a thin map from a [SignalHistoryRow] to a shared primitive.
 */
private fun signalHistoryColumns(
    strings: SignalHistoryStrings,
    expandable: Boolean,
    expandedKeys: Set<String>,
    onToggle: (String) -> Unit,
): List<TableColumn<SignalHistoryRow>> =
    buildList {
        add(TableColumn(key = COL_TIME, header = strings.timestampHeader, weight = TIME_WEIGHT) { Caption(it.time) })
        add(TableColumn(key = COL_SIGNAL, header = strings.signalHeader, weight = SIGNAL_WEIGHT) { SignalCell(it) })
        add(TableColumn(key = COL_VALUE, header = strings.valueHeader, weight = VALUE_WEIGHT) { CodeText(it.value) })
        add(
            TableColumn(key = COL_TYPE, header = strings.typeHeader, weight = TYPE_WEIGHT) { row ->
                Badge(text = typeLabel(row.valueType), variant = badgeVariantOf(row.valueType))
            },
        )
        if (expandable) {
            add(
                TableColumn(key = COL_DETAILS, header = EMPTY_HEADER, weight = EXPAND_WEIGHT, alignEnd = true) { row ->
                    ExpandToggle(
                        expanded = row.key in expandedKeys,
                        label = strings.detailsLabel,
                        onClick = { onToggle(row.key) },
                    )
                },
            )
        }
    }

/**
 * The Signal cell — a per-signal color dot (web `<span className="h-2 w-2 rounded-full" style={{ background
 * }} />`) plus the monospace signal name colored to match (web `style={{ color }}`). The color is the
 * dynamic per-series [paletteColor] (the documented dynamic-value styling exception); an unselected signal
 * (`colorIndex < 0`) gets no dot and the neutral on-surface color, exactly as the web `idx >= 0` branch does.
 */
@Composable
private fun SignalCell(row: SignalHistoryRow) {
    val selected = row.colorIndex >= 0
    val color = if (selected) paletteColor(row.colorIndex) else MaterialTheme.colorScheme.onSurface
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (selected) {
            Box(modifier = Modifier.size(SIGNAL_DOT).clip(CircleShape).background(color))
        }
        Text(
            text = row.signal,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The expand/collapse affordance — an accessible icon button announcing the row-details action. */
@Composable
private fun ExpandToggle(
    expanded: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    IconButton(
        imageVector = if (expanded) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
        contentDescription = label,
        onClick = onClick,
        size = IconSize.Sm,
    )
}

/**
 * The revealed raw payload of an expanded row — the web `<pre>{JSON.stringify(r, null, 2)}</pre>` rendered in
 * a tonal code block. The [detailsLabel] is attached as the block's accessibility label so the expanded
 * region is announced.
 */
@Composable
private fun RawPayload(
    row: SignalHistoryRow,
    detailsLabel: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = detailsLabel },
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        CodeText(row.rawJson, modifier = Modifier.fillMaxWidth().padding(Spacing.sm))
    }
}

/** The semantic badge variant for a value type — the web `TYPE_BADGE_VARIANT` map (number/string/boolean). */
private fun badgeVariantOf(type: ValueType): BadgeVariant =
    when (type) {
        ValueType.Number -> BadgeVariant.Info
        ValueType.String -> BadgeVariant.Success
        ValueType.Boolean -> BadgeVariant.Warning
    }

/** First-load body — the web five `<Skeleton className="h-8" />` bars, with an accessible "loading" label. */
@Composable
private fun SignalHistoryLoading() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_HEIGHT) }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent for the feed's failure state. */
@Composable
private fun SignalHistoryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The friendly empty state — the web `<EmptyState icon={<Activity/>} title="No data" message="No signal data
 * found for this query." />`. Never a blank box.
 */
@Composable
private fun SignalHistoryEmpty(strings: SignalHistoryStrings) {
    EmptyState(
        message = strings.emptyMessage,
        title = strings.emptyTitle,
        icon = DataDisplayGlyphs.History,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip surfacing refreshing/stale/offline over the cached table (ADR-013). */
@Composable
private fun SignalHistoryFreshness(state: UiState<SignalHistoryData>) {
    val formatAge = rememberSignalHistoryFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
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

/** Server-side pagination footer — the web `<Pagination page pageSize total onPageChange />`. */
@Composable
private fun SignalHistoryPagination(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = pageSize,
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

/**
 * Resolves the already-localized [SignalHistoryStrings] from the i18n catalog (P1/S10) — the web component's
 * `t(...)` calls. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
fun rememberSignalHistoryStrings(): SignalHistoryStrings {
    val title = stringResource(R.string.translation_widget_signalLog_title)
    val timestampHeader = stringResource(R.string.translation_Timestamp)
    val signalHeader = stringResource(R.string.translation_Signal)
    val valueHeader = stringResource(R.string.translation_Value)
    val typeHeader = stringResource(R.string.translation_Type)
    val pageLabel = stringResource(R.string.translation_Page)
    val totalLabel = stringResource(R.string.translation_total)
    val emptyTitle = stringResource(R.string.translation_common_noData)
    val emptyMessage = stringResource(R.string.translation_signalGap_noData)
    val detailsLabel = stringResource(R.string.translation_Details)
    return remember(
        title,
        timestampHeader,
        signalHeader,
        valueHeader,
        typeHeader,
        pageLabel,
        totalLabel,
        emptyTitle,
        emptyMessage,
        detailsLabel,
    ) {
        SignalHistoryStrings(
            title = title,
            timestampHeader = timestampHeader,
            signalHeader = signalHeader,
            valueHeader = valueHeader,
            typeHeader = typeHeader,
            pageLabel = pageLabel,
            totalLabel = totalLabel,
            emptyTitle = emptyTitle,
            emptyMessage = emptyMessage,
            detailsLabel = detailsLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSignalHistoryFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Immutable toggle of a key's presence in the expanded-rows set (web `expandedKeys` add/remove). */
private fun Set<String>.toggle(key: String): Set<String> = if (key in this) this - key else this + key

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    SignalHistoryStrings(
        title = "Signal Log",
        timestampHeader = "Timestamp",
        signalHeader = "Signal",
        valueHeader = "Value",
        typeHeader = "Type",
        pageLabel = "Page",
        totalLabel = "total",
        emptyTitle = "No data",
        emptyMessage = "No signal data found for this query.",
        detailsLabel = "Details",
    )

private fun previewData(): SignalHistoryData =
    SignalHistoryData(
        rows =
            listOf(
                SignalLogEntry("2026-06-11T11:59:40Z", "VehicleSpeed", valueNum = 64.0),
                SignalLogEntry("2026-06-11T11:59:38Z", "Gear", valueStr = "D"),
                SignalLogEntry("2026-06-11T11:59:36Z", "Locked", valueBool = true),
                SignalLogEntry("2026-06-11T11:59:34Z", "ChargeState", valueStr = "Charging"),
            ),
        selectedSignals = listOf("VehicleSpeed", "Gear", "Locked"),
        page = 1,
        pageSize = SIGNAL_HISTORY_PAGE_SIZE,
        totalRows = 128,
    )

private fun previewState(
    data: SignalHistoryData?,
    phase: UiPhase,
    stale: Boolean = false,
    fetchedAt: Long? = null,
    errorKind: ErrorKind? = null,
): UiState<SignalHistoryData> = UiState(phase = phase, data = data, stale = stale, fetchedAt = fetchedAt, errorKind = errorKind)

@Composable
private fun previewContent(state: UiState<SignalHistoryData>) {
    SignalHistoryTableContent(
        state = state,
        onPageChange = {},
        onRetry = {},
        locale = Locale.US,
        zoneId = ZoneOffset.UTC,
        strings = PREVIEW_STRINGS,
    )
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun SignalHistoryTableDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(previewData(), UiPhase.Content))
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SignalHistoryTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(SignalHistoryData.EMPTY, UiPhase.Loading))
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SignalHistoryTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(SignalHistoryData.EMPTY, UiPhase.Empty))
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalHistoryTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(previewState(null, UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun SignalHistoryTableOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewContent(
            previewState(
                previewData(),
                UiPhase.Content,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
    }
}
