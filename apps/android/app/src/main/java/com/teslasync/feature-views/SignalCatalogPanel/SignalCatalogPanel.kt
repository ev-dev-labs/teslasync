// The native Jetpack Compose + Material 3 SignalCatalogPanel feature view — a parity port of
// web/src/features/telemetry/components/SignalCatalogPanel.tsx. The web component is a staleness-aware
// catalog browser over the live-signals feed: four summary StatCards (total / active / stale / never), a
// search field, all/stale/active filter pills, staleness/A-Z/category sort pills, and a paginated table of
// Status · Signal · Last Value · Last Updated · Time Since, with a "Refreshes every 5s" caption and a
// "Last refreshed" relative footer. This native port keeps that composition and surfaces every state the P3
// contract mandates (loading / empty / filtered-empty / content / stale / offline / error) by binding the
// shared Telemetry feed (P1/S8) through a [SignalCatalogPanelViewModel]: a freshness chip + 5-second
// auto-refresh covers stale/offline, a `QueryError` covers a hard failure with no cache, and the last-known
// rows stay visible while stale. Values are the raw SI the backend serves (Phase-42); the view performs no
// HTTP. Every visible string resolves through the P1/S10 i18n catalog and the search field carries a
// TalkBack label.
//
// Parity note — the optional web `selection` checkbox column (used only by SignalsWorkspacePage) is out of
// scope here: its add/remove accessibility labels have no key in the P1/S10 catalog and this surface's
// allowed-files forbid adding resources, so shipping it would either hard-code English (covenant #5) or fail
// the "every i18n key resolves" criterion. The read-only catalog — the SignalGapDetectorPage usage and the
// surface's primary composition — is shipped here at full parity.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalCatalogPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcatalogpanel

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
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
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Web `useSignalGaps` `refetchInterval: REALTIME` — every 5s the feed re-polls and `now` recomputes. */
private const val REFRESH_INTERVAL_MS = 5_000L

/** Web `Array.from({ length: 8 })` loading skeleton rows. */
private const val SKELETON_ROW_COUNT = 8

/** Web summary `FadeIn delay={0.05}` ≈ 50 ms. */
private const val SUMMARY_FADE_DELAY_MS = 50

private val SKELETON_ROW_HEIGHT = 48.dp

/**
 * Stateful entry point. Binds the shared Telemetry feed via [source] into a [SignalCatalogPanelViewModel],
 * records the one-shot `view.opened` diagnostic, collects the projected [state], and renders. A host page
 * supplies the [source] (an adapter over the shared S7/S8 Telemetry layer), the selected [vehicleId] (web
 * parent's vehicle picker), and the optional [title] / [showSummary] / [headerExtra] the web props expose.
 *
 * @param source the cache-then-network Telemetry seam (`TelemetryRepository`/`TelemetryStore` adapter).
 * @param vehicleId the selected vehicle; a non-positive id renders the empty state (web disabled query).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalCatalogPanel(
    source: SignalCatalogPanelSource,
    vehicleId: Long,
    modifier: Modifier = Modifier,
    title: String? = null,
    showSummary: Boolean = true,
    headerExtra: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SIGNAL_CATALOG_PANEL_SLUG,
) {
    val viewModel: SignalCatalogPanelViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SignalCatalogPanelViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = signalCatalogStrings()

    SignalCatalogPanelContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
        title = title,
        showSummary = showSummary,
        headerExtra = headerExtra,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the summary cards
 * (when enabled) and the search/filter/sort controls (web's always-present chrome). Stale (non-error) data
 * auto-refreshes immediately, and a 5-second ticker re-polls + recomputes staleness so the "Refreshes every
 * 5s" promise holds. The body picks the same branch the web ternary does, extended with the mandated error
 * branch: a hard failure with no cached rows shows `QueryError` with retry; an empty resolved feed shows the
 * friendly empty state; a filter that matches nothing shows the "no match" message; otherwise the paginated
 * table renders. [onRefresh] backs the ticker, the stale auto-refresh, and the error retry.
 */
@Composable
fun SignalCatalogPanelContent(
    state: SignalCatalogPanelState,
    strings: SignalCatalogStrings,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    showSummary: Boolean = true,
    headerExtra: (@Composable () -> Unit)? = null,
) {
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_INTERVAL_MS)
            nowMillis = System.currentTimeMillis()
            onRefresh()
        }
    }
    LaunchedEffect(state.isStale, state.isFetching, state.isError) {
        if (state.isStale && !state.isFetching && !state.isError) onRefresh()
    }

    var search by remember { mutableStateOf("") }
    var filterMode by remember { mutableStateOf(CatalogFilterMode.All) }
    var sortMode by remember { mutableStateOf(CatalogSortMode.Staleness) }

    val rows = remember(state.response) { SignalCatalogProjection.projectRows(state.response) }
    val summary = remember(rows, nowMillis) { SignalCatalogProjection.summarize(rows, nowMillis) }
    val visible =
        remember(rows, search, filterMode, sortMode, nowMillis) {
            SignalCatalogProjection.visibleRows(rows, search, filterMode, sortMode, nowMillis)
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (showSummary) {
            SignalCatalogSummary(summary = summary, strings = strings)
        }
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            SignalCatalogHeader(title = title, strings = strings, state = state, headerExtra = headerExtra)
            SignalCatalogControls(
                search = search,
                onSearchChange = { search = it },
                filterMode = filterMode,
                onFilterModeChange = { filterMode = it },
                sortMode = sortMode,
                onSortModeChange = { sortMode = it },
                strings = strings,
            )
            SignalCatalogBody(
                state = state,
                strings = strings,
                rowCount = rows.size,
                visible = visible,
                nowMillis = nowMillis,
                onRetry = onRefresh,
            )
        }
    }
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SignalCatalogSummary(
    summary: CatalogSummary,
    strings: SignalCatalogStrings,
) {
    FadeIn(delayMs = SUMMARY_FADE_DELAY_MS) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                StatCard(
                    label = strings.statTotal,
                    value = formatCount(summary.total),
                    icon = ARROW_UP_DOWN_GLYPH,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    label = strings.statActive,
                    value = formatCount(summary.active),
                    icon = FeedbackGlyphs.Refresh,
                    modifier = Modifier.weight(1f),
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                StatCard(
                    label = strings.statStale,
                    value = formatCount(summary.stale),
                    icon = DataDisplayGlyphs.AlertTriangle,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    label = strings.statNever,
                    value = formatCount(summary.never),
                    icon = DataDisplayGlyphs.AlertTriangle,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SignalCatalogHeader(
    title: String?,
    strings: SignalCatalogStrings,
    state: SignalCatalogPanelState,
    headerExtra: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            SectionTitle(title, modifier = Modifier.weight(1f))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        headerExtra?.invoke()
        if (state.updatedAtMillis != null || state.isFetching || state.isError) {
            DataFreshness(
                updatedAtMillis = state.updatedAtMillis?.takeIf { it > 0 },
                isFetching = state.isFetching,
                isStale = state.isStale,
                isError = state.isError,
                compact = true,
            )
        }
        Icon(
            FeedbackGlyphs.Refresh,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(strings.refreshInterval)
    }
}

// ── Controls (search + filter pills + sort pills) ───────────────────────────────────────────────────────

@Composable
private fun SignalCatalogControls(
    search: String,
    onSearchChange: (String) -> Unit,
    filterMode: CatalogFilterMode,
    onFilterModeChange: (CatalogFilterMode) -> Unit,
    sortMode: CatalogSortMode,
    onSortModeChange: (CatalogSortMode) -> Unit,
    strings: SignalCatalogStrings,
) {
    Column(
        modifier = Modifier.padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Input(
            value = search,
            onValueChange = onSearchChange,
            label = strings.filterHint,
            leadingIcon = FormsGlyphs.Search,
            modifier = Modifier.semantics { contentDescription = strings.filterAria },
        )
        PillRow(icon = FormsGlyphs.Filter) {
            PillButton(strings.filterAll, filterMode == CatalogFilterMode.All) { onFilterModeChange(CatalogFilterMode.All) }
            PillButton(strings.filterStaleOnly, filterMode == CatalogFilterMode.Stale) { onFilterModeChange(CatalogFilterMode.Stale) }
            PillButton(strings.filterActiveOnly, filterMode == CatalogFilterMode.Active) { onFilterModeChange(CatalogFilterMode.Active) }
        }
        PillRow(icon = ARROW_UP_DOWN_GLYPH) {
            PillButton(strings.sortMostStale, sortMode == CatalogSortMode.Staleness) { onSortModeChange(CatalogSortMode.Staleness) }
            PillButton(strings.sortAlpha, sortMode == CatalogSortMode.Alpha) { onSortModeChange(CatalogSortMode.Alpha) }
            PillButton(strings.sortCategory, sortMode == CatalogSortMode.Category) { onSortModeChange(CatalogSortMode.Category) }
        }
    }
}

@Composable
private fun PillRow(
    icon: ImageVector,
    content: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

@Composable
private fun PillButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Button(
        label = label,
        onClick = onClick,
        variant = if (selected) ButtonVariant.Secondary else ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )
}

// ── Body (state matrix) ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SignalCatalogBody(
    state: SignalCatalogPanelState,
    strings: SignalCatalogStrings,
    rowCount: Int,
    visible: List<SignalCatalogRow>,
    nowMillis: Long,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.padding(top = Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when {
            state.isError && rowCount == 0 ->
                QueryError(
                    kind = state.errorKind ?: QueryErrorKind.Network,
                    resourceName = strings.resourceName,
                    onRetry = onRetry,
                    modifier = Modifier.fillMaxWidth(),
                )

            state.isFetching && rowCount == 0 ->
                LoadingSkeleton()

            rowCount == 0 ->
                EmptyState(
                    message = strings.noData,
                    icon = DataDisplayGlyphs.Wifi,
                    modifier = Modifier.fillMaxWidth(),
                )

            visible.isEmpty() ->
                FilteredEmpty(strings.noMatch)

            else ->
                SignalCatalogTable(rows = visible, strings = strings, nowMillis = nowMillis)
        }

        if (state.updatedAtMillis != null && state.updatedAtMillis > 0) {
            LastRefreshed(strings = strings, updatedAtMillis = state.updatedAtMillis, nowMillis = nowMillis)
        }
    }
}

@Composable
private fun LoadingSkeleton() {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(height = SKELETON_ROW_HEIGHT)
        }
    }
}

@Composable
private fun FilteredEmpty(message: String) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl3),
        contentAlignment = Alignment.Center,
    ) {
        Caption(message)
    }
}

@Composable
private fun LastRefreshed(
    strings: SignalCatalogStrings,
    updatedAtMillis: Long,
    nowMillis: Long,
) {
    val age = SignalCatalogProjection.lastRefreshedAge(updatedAtMillis, nowMillis)
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        HelperText("${strings.lastRefreshed}: ${freshnessAgeLabel(age)}")
    }
}

// ── Table ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SignalCatalogTable(
    rows: List<SignalCatalogRow>,
    strings: SignalCatalogStrings,
    nowMillis: Long,
) {
    val total = rows.size
    val pageCount = maxOf(1, (total + SIGNAL_CATALOG_PAGE_SIZE - 1) / SIGNAL_CATALOG_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * SIGNAL_CATALOG_PAGE_SIZE
    val pageRows = if (total == 0) emptyList() else rows.subList(from, minOf(from + SIGNAL_CATALOG_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current
    val dateFormatter =
        remember { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()) }

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            {
                Pagination(
                    page = current,
                    pageSize = SIGNAL_CATALOG_PAGE_SIZE,
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
        }

    DataTable(
        columns = signalCatalogColumns(strings, nowMillis, dateFormatter),
        rows = pageRows,
        keyOf = { it.name },
        emptyText = strings.noMatch,
        footer = footer,
    )
}

/**
 * The five-column layout the web `columns` array defines — Status badge, monospace Signal, monospace Last
 * Value, absolute Last Updated, and the staleness-colored relative Time Since. Headers arrive
 * already-localized; the cells derive their staleness against [nowMillis].
 */
private fun signalCatalogColumns(
    strings: SignalCatalogStrings,
    nowMillis: Long,
    dateFormatter: DateTimeFormatter,
): List<TableColumn<SignalCatalogRow>> =
    listOf(
        TableColumn(key = COL_STATUS, header = strings.colStatus, weight = COL_STATUS_WEIGHT) { row ->
            StatusBadgeCell(row, nowMillis, strings)
        },
        TableColumn(key = COL_SIGNAL, header = strings.colSignal, weight = COL_SIGNAL_WEIGHT) { row ->
            CodeText(row.name)
        },
        TableColumn(key = COL_VALUE, header = strings.colValue, weight = COL_VALUE_WEIGHT) { row ->
            CodeText(row.value)
        },
        TableColumn(key = COL_LAST_UPDATED, header = strings.colLastUpdated, weight = COL_LAST_UPDATED_WEIGHT) { row ->
            Caption(row.timestampMillis?.let { dateFormatter.format(Instant.ofEpochMilli(it)) } ?: EM_DASH)
        },
        TableColumn(key = COL_TIME_SINCE, header = strings.colTimeSince, weight = COL_TIME_SINCE_WEIGHT, alignEnd = true) { row ->
            TimeSinceCell(row, nowMillis)
        },
    )

@Composable
private fun StatusBadgeCell(
    row: SignalCatalogRow,
    nowMillis: Long,
    strings: SignalCatalogStrings,
) {
    val category = SignalCatalogProjection.categoryOf(row.timestampMillis, nowMillis)
    Badge(
        text = SignalCatalogProjection.badgeLabel(category, strings),
        variant = badgeVariant(category),
        dot = true,
    )
}

@Composable
private fun TimeSinceCell(
    row: SignalCatalogRow,
    nowMillis: Long,
) {
    val age = SignalCatalogProjection.stalenessAge(row.timestampMillis, nowMillis)
    if (age == null) {
        MonoText(EM_DASH, MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val bucket = SignalCatalogProjection.stalenessBucketOf(row.timestampMillis, nowMillis)
    MonoText(freshnessAgeLabel(age), stalenessColor(bucket))
}

@Composable
private fun MonoText(
    text: String,
    color: Color,
) {
    Text(
        text = text,
        color = color,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

// ── Shared mappers + helpers ────────────────────────────────────────────────────────────────────────────

private fun badgeVariant(category: SignalCategory): BadgeVariant =
    when (category) {
        SignalCategory.Active -> BadgeVariant.Success
        SignalCategory.Stale -> BadgeVariant.Danger
        SignalCategory.Never -> BadgeVariant.Neutral
    }

@Composable
private fun stalenessColor(bucket: StalenessBucket): Color =
    when (bucket) {
        StalenessBucket.Active -> TeslaTokens.status.success
        StalenessBucket.Aging -> TeslaTokens.status.warning
        StalenessBucket.Stale -> TeslaTokens.status.danger
        StalenessBucket.NeverReceived -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps a [FreshnessAge] bucket to its localized label through the P1/S10 `freshness.*` keys. */
@Composable
private fun freshnessAgeLabel(age: FreshnessAge): String =
    when (age) {
        FreshnessAge.Unknown -> EM_DASH
        FreshnessAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is FreshnessAge.Seconds -> stringResource(R.string.translation_freshness_seconds, age.value)
        is FreshnessAge.Minutes -> stringResource(R.string.translation_freshness_minutes, age.value)
        is FreshnessAge.Hours -> stringResource(R.string.translation_freshness_hours, age.value)
        is FreshnessAge.Days -> stringResource(R.string.translation_freshness_days, age.value)
        is FreshnessAge.Weeks -> stringResource(R.string.translation_freshness_weeks, age.value)
    }

/** Locale-grouped integer formatting for the summary counts — the native analogue of the web `fmtInt`. */
private fun formatCount(value: Int): String = NumberFormat.getIntegerInstance(Locale.getDefault()).format(value.toLong())

/**
 * Resolves the localized [SignalCatalogStrings] from the i18n catalog (P1/S10). The web component reads the
 * `signalGap.*` keys via `t(...)`; the staleness badge labels reuse the existing `common.active` /
 * `mqtt.stale` / `signalGap.neverReceived` keys (no new resource is added — outside this surface's allowed
 * files). Compose compares the returned data class structurally, so an equal instance never forces work.
 */
@Composable
private fun signalCatalogStrings(): SignalCatalogStrings =
    SignalCatalogStrings(
        statTotal = stringResource(R.string.translation_signalGap_totalSignals),
        statActive = stringResource(R.string.translation_signalGap_active),
        statStale = stringResource(R.string.translation_signalGap_stale),
        statNever = stringResource(R.string.translation_signalGap_neverReceived),
        colStatus = stringResource(R.string.translation_signalGap_status),
        colSignal = stringResource(R.string.translation_signalGap_signal),
        colValue = stringResource(R.string.translation_signalGap_lastValue),
        colLastUpdated = stringResource(R.string.translation_signalGap_lastUpdated),
        colTimeSince = stringResource(R.string.translation_signalGap_timeSince),
        filterHint = stringResource(R.string.translation_signalGap_filterPlaceholder), // parity:allow i18n key name
        filterAria = stringResource(R.string.translation_signalGap_filterLabel),
        filterAll = stringResource(R.string.translation_signalGap_all),
        filterStaleOnly = stringResource(R.string.translation_signalGap_staleOnly),
        filterActiveOnly = stringResource(R.string.translation_signalGap_activeOnly),
        sortMostStale = stringResource(R.string.translation_signalGap_mostStale),
        sortAlpha = stringResource(R.string.translation_signalGap_az),
        sortCategory = stringResource(R.string.translation_signalGap_category),
        refreshInterval = stringResource(R.string.translation_signalGap_refreshInterval),
        lastRefreshed = stringResource(R.string.translation_signalGap_lastRefreshed),
        noData = stringResource(R.string.translation_signalGap_noData),
        noMatch = stringResource(R.string.translation_signalGap_noMatch),
        badgeActive = stringResource(R.string.translation_common_active),
        badgeStale = stringResource(R.string.translation_mqtt_stale),
        badgeNever = stringResource(R.string.translation_signalGap_neverReceived),
        resourceName = stringResource(R.string.translation_signalGap_title),
    )

private const val COL_STATUS_WEIGHT = 1.1f
private const val COL_SIGNAL_WEIGHT = 1.6f
private const val COL_VALUE_WEIGHT = 1.4f
private const val COL_LAST_UPDATED_WEIGHT = 1.6f
private const val COL_TIME_SINCE_WEIGHT = 1.2f

/**
 * The web `ArrowUpDown` lucide glyph — a two-headed sort arrow (up on the left, down on the right). Authored
 * here as a 24×24 stroked vector (the data-display/ui glyph sets carry no up-down combo); recolored at render
 * time by [Icon]'s tint.
 */
private val ARROW_UP_DOWN_GLYPH: ImageVector =
    ImageVector
        .Builder(
            name = "ArrowUpDown",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(7f, 4f)
                lineTo(7f, 20f)
                moveTo(3f, 8f)
                lineTo(7f, 4f)
                lineTo(11f, 8f)
                moveTo(17f, 20f)
                lineTo(17f, 4f)
                moveTo(13f, 16f)
                lineTo(17f, 20f)
                lineTo(21f, 16f)
            }
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    SignalCatalogStrings(
        statTotal = "Total Signals",
        statActive = "Active (<30s)",
        statStale = "Stale (>5min)",
        statNever = "Never Received",
        colStatus = "Status",
        colSignal = "Signal",
        colValue = "Last Value",
        colLastUpdated = "Last Updated",
        colTimeSince = "Time Since",
        filterHint = "Filter by signal name\u2026",
        filterAria = "Filter signals",
        filterAll = "All",
        filterStaleOnly = "Stale Only",
        filterActiveOnly = "Active Only",
        sortMostStale = "Most Stale",
        sortAlpha = "A-Z",
        sortCategory = "Category",
        refreshInterval = "Refreshes every 5s",
        lastRefreshed = "Last refreshed",
        noData = "No signal data available",
        noMatch = "No signals match current filters",
        badgeActive = "Active",
        badgeStale = "Stale",
        badgeNever = "Never Received",
        resourceName = "Signal Gaps",
    )

private fun previewResponse(): VehicleLiveSignalsResponse =
    VehicleLiveSignalsResponse(
        vehicleId = 1L,
        signals =
            mapOf(
                "VehicleSpeed" to
                    buildJsonObject {
                        put("value", 64)
                        put("timestamp", "2026-06-11T11:59:40Z")
                    },
                "Gear" to JsonPrimitive("D"),
                "BatteryLevel" to
                    buildJsonObject {
                        put("value", 82)
                        put("timestamp", "2026-06-11T10:30:00Z")
                    },
            ),
    )

private fun previewState(
    response: VehicleLiveSignalsResponse?,
    isFetching: Boolean = false,
    isStale: Boolean = false,
    isError: Boolean = false,
    errorKind: QueryErrorKind? = null,
): SignalCatalogPanelState =
    SignalCatalogPanelState(
        response = response,
        updatedAtMillis = if (response != null || isError) 1L else null,
        isFetching = isFetching,
        isStale = isStale,
        isError = isError,
        errorKind = errorKind,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun SignalCatalogPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCatalogPanelContent(previewState(previewResponse()), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SignalCatalogPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCatalogPanelContent(previewState(response = null, isFetching = true), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SignalCatalogPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCatalogPanelContent(previewState(VehicleLiveSignalsResponse(vehicleId = 1L)), PREVIEW_STRINGS, onRefresh = {})
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun SignalCatalogPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCatalogPanelContent(
            previewState(previewResponse(), isStale = true, isError = true, errorKind = QueryErrorKind.Network),
            PREVIEW_STRINGS,
            onRefresh = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalCatalogPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCatalogPanelContent(
            previewState(response = null, isError = true, errorKind = QueryErrorKind.Network),
            PREVIEW_STRINGS,
            onRefresh = {},
        )
    }
}
