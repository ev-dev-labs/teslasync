// The native Jetpack Compose + Material 3 LiveSignalTail feature view — a parity port of
// web/src/features/telemetry/components/LiveSignalTail.tsx. The web component is the presentational tail of
// the signals workspace: a name filter over a sortable/paginated DataTable of incoming SSE signal events
// (Time / Signal / Value / Type / Freshness), four stat cards (rate / buffer / unique / filtered), and
// Pause/Auto-scroll/Clear controls, with a friendly "Waiting for signals…" / "No signals match filter"
// empty state. This native port keeps that composition and additionally surfaces the live-pipeline states
// the P3 contract mandates (loading / empty / error / stale / offline) by binding the shared live stream
// (P1/S8) through a [LiveSignalTailViewModel]: a freshness chip + a wire-health indicator cover
// stale/offline, a `QueryError` covers a down wire with nothing buffered, and the last-known rows stay
// visible while stale/offline. Values are the raw SI the backend serves (Phase-42); the view performs no
// HTTP. Every visible string resolves through the i18n catalog and every control carries a TalkBack name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveSignalTail) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignaltail

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessIndicator
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.datadisplay.LiveIndicator
import io.teslasync.android.components.datadisplay.LiveIndicatorVariant
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.DataContainer
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val CLOCK_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")

/** Web `formatTime(entry.timestamp)`: the wall-clock time of a receipt stamp in the device's zone. */
private fun formatClock(millis: Long): String =
    Instant
        .ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .toLocalTime()
        .format(CLOCK_FORMATTER)

/**
 * Stateful entry point. Binds the shared live pipeline (P1/S8) via [liveSignalTailSource] into a
 * [LiveSignalTailViewModel], records the one-shot `view.opened` diagnostic, collects the projected [state],
 * and renders. A host page may override the [bufferMax] (web `tailMax`) and the per-placement [instanceKey].
 *
 * @param bufferMax the tail buffer cap (web `useLiveSignalStream` `tailMax`, default [DEFAULT_BUFFER_MAX]).
 * @param instanceKey distinguishes multiple placements so each keeps its own buffer.
 */
@Composable
fun LiveSignalTail(
    modifier: Modifier = Modifier,
    bufferMax: Int = DEFAULT_BUFFER_MAX,
    instanceKey: String = LIVE_SIGNAL_TAIL_SLUG,
) {
    val container: DataContainer = LocalDataContainer.current
    val source =
        remember(container) {
            liveSignalTailSource(container.liveSessionStore, container.selectedVehicleStore)
        }
    val viewModel: LiveSignalTailViewModel =
        viewModel(
            key = instanceKey,
            factory =
                viewModelFactory {
                    initializer { LiveSignalTailViewModel(source, container.logger, bufferMax) }
                },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberLiveSignalTailStrings()

    LiveSignalTailContent(
        state = state,
        strings = strings,
        onPauseToggle = viewModel::togglePause,
        onClear = viewModel::clear,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the title, the
 * filter field, the controls, and (web `showStats`) the four stat cards, then switches the body the same way
 * the web tail does, extended with the mandated loading/error branches: a down wire with nothing buffered
 * shows `QueryError` with retry; otherwise the table renders (its own footer message covers the loading,
 * waiting, and filtered-empty sub-states). Stale data auto-refreshes (web parent's 1 s poll). [onRetry]
 * backs the stale auto-refresh and the error retry; the filter/auto-scroll are local view state.
 */
@Composable
fun LiveSignalTailContent(
    state: LiveSignalTailState,
    strings: LiveSignalTailStrings,
    onPauseToggle: () -> Unit,
    onClear: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.isStale, state.isConnecting) {
        if (state.isStale && !state.isConnecting) onRetry()
    }

    var filter by remember { mutableStateOf("") }
    var autoScroll by remember { mutableStateOf(true) }
    val filtered = remember(state.entries, filter) { LiveSignalTailProjection.filterEntries(state.entries, filter) }

    FadeIn(modifier = modifier) {
        GlassPanel {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                LiveSignalTailHeader(
                    state = state,
                    strings = strings,
                    filter = filter,
                    onFilterChange = { filter = it },
                    paused = state.paused,
                    onPauseToggle = onPauseToggle,
                    autoScroll = autoScroll,
                    onAutoScrollToggle = { autoScroll = !autoScroll },
                    onClear = onClear,
                )
                LiveSignalTailStats(state = state, filteredCount = filtered.size, strings = strings)
                LiveSignalTailBodyContent(
                    state = state,
                    strings = strings,
                    filtered = filtered,
                    autoScroll = autoScroll,
                    onRetry = onRetry,
                )
            }
        }
    }
}

@Composable
private fun LiveSignalTailHeader(
    state: LiveSignalTailState,
    strings: LiveSignalTailStrings,
    filter: String,
    onFilterChange: (String) -> Unit,
    paused: Boolean,
    onPauseToggle: () -> Unit,
    autoScroll: Boolean,
    onAutoScrollToggle: () -> Unit,
    onClear: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(LiveSignalTailGlyphs.Radio, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
            SectionTitle(strings.title, modifier = Modifier.weight(1f))
            ConnectionChips(state)
        }
        Input(
            value = filter,
            onValueChange = onFilterChange,
            label = strings.filterHint,
            leadingIcon = FormsGlyphs.Search,
            modifier = Modifier.semantics { contentDescription = strings.filterLabel },
        )
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = if (paused) strings.resume else strings.pause,
                onClick = onPauseToggle,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = if (paused) DataDisplayGlyphs.Play else DataDisplayGlyphs.Pause,
            )
            Button(
                label = strings.autoScroll,
                onClick = onAutoScrollToggle,
                variant = if (autoScroll) ButtonVariant.Primary else ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.ArrowDown,
            )
            Button(
                label = strings.clear,
                onClick = onClear,
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
                leadingIcon = LiveSignalTailGlyphs.Trash,
            )
        }
    }
}

@Composable
private fun ConnectionChips(state: LiveSignalTailState) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        LiveIndicator(status = state.status, variant = LiveIndicatorVariant.Dot)
        if (state.showFreshnessChip) {
            DataFreshness(
                updatedAtMillis = state.updatedAtMillis,
                isFetching = state.isConnecting,
                isStale = state.isStale,
                isError = state.isOffline,
                compact = true,
            )
        }
    }
}

@Composable
private fun LiveSignalTailStats(
    state: LiveSignalTailState,
    filteredCount: Int,
    strings: LiveSignalTailStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatCard(
                label = strings.sigPerSec,
                value = state.rate.toString(),
                icon = LiveSignalTailGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = strings.bufferSize,
                value = state.entries.size.toString(),
                unit = "/ ${state.bufferMax}",
                icon = LiveSignalTailGlyphs.ArrowUpDown,
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatCard(
                label = strings.uniqueSignals,
                value = state.uniqueSignals.toString(),
                icon = LiveSignalTailGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = strings.filtered,
                value = filteredCount.toString(),
                icon = LiveSignalTailGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun LiveSignalTailBodyContent(
    state: LiveSignalTailState,
    strings: LiveSignalTailStrings,
    filtered: List<LiveSignalEntry>,
    autoScroll: Boolean,
    onRetry: () -> Unit,
) {
    when (state.body) {
        LiveSignalTailBody.Error ->
            QueryError(
                kind = LiveSignalTailProjection.errorKind(),
                resourceName = strings.title,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )

        else ->
            LiveSignalTailTable(
                rows = filtered,
                strings = strings,
                loading = state.body == LiveSignalTailBody.Loading,
                emptyText = if (state.hasEntries) strings.noMatch else strings.waiting,
                autoScroll = autoScroll,
            )
    }
}

@Composable
private fun LiveSignalTailTable(
    rows: List<LiveSignalEntry>,
    strings: LiveSignalTailStrings,
    loading: Boolean,
    emptyText: String,
    autoScroll: Boolean,
) {
    val total = rows.size
    val pageCount = PaginationMath.pageCount(total, LIVE_SIGNAL_TAIL_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    LaunchedEffect(total, autoScroll) { if (autoScroll) page = 1 }
    val current = page.coerceIn(1, pageCount)
    val bounds = PaginationMath.sliceBounds(current, LIVE_SIGNAL_TAIL_PAGE_SIZE, total)
    val visible = if (total == 0) emptyList() else rows.subList(bounds.first, bounds.last + 1)

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            {
                Pagination(
                    page = current,
                    pageSize = LIVE_SIGNAL_TAIL_PAGE_SIZE,
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
        columns = liveSignalTailColumns(strings),
        rows = visible,
        keyOf = { it.id },
        loading = loading,
        emptyText = emptyText,
        footer = footer,
    )
}

/**
 * The five-column layout the web `columns` array defines — Time (monospace clock), Signal (monospace name),
 * Value (monospace, type-toned), Type (badge), and Freshness (per-row indicator dot). Headers arrive
 * already-localized.
 */
private fun liveSignalTailColumns(strings: LiveSignalTailStrings): List<TableColumn<LiveSignalEntry>> =
    listOf(
        TableColumn(key = COL_TIME, header = strings.time, weight = TIME_WEIGHT) { CodeText(formatClock(it.timestampMillis)) },
        TableColumn(key = COL_SIGNAL, header = strings.signal, weight = SIGNAL_WEIGHT) { CodeText(it.name) },
        TableColumn(key = COL_VALUE, header = strings.value, weight = VALUE_WEIGHT) { ValueCell(it) },
        TableColumn(key = COL_TYPE, header = strings.type, weight = TYPE_WEIGHT) {
            Badge(text = it.type.wire, variant = LiveSignalTailProjection.badgeVariant(it.type))
        },
        TableColumn(key = COL_FRESHNESS, header = strings.freshness, weight = FRESHNESS_WEIGHT) {
            FreshnessIndicator(timestampMillis = it.timestampMillis, showLabel = false)
        },
    )

@Composable
private fun ValueCell(entry: LiveSignalEntry) {
    Text(
        text = entry.value,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = valueColor(entry.type),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Type-toned Value color — web `TYPE_VALUE_COLOR`: number=info, string=success, boolean=warning. */
@Composable
private fun valueColor(type: SignalValueType): Color =
    when (type) {
        SignalValueType.Number -> TeslaTokens.status.info
        SignalValueType.Boolean -> TeslaTokens.status.warning
        SignalValueType.Text -> TeslaTokens.status.success
    }

/**
 * Resolves the localized [LiveSignalTailStrings] from the i18n catalog (P1/S10) — the `liveMonitor.*` keys
 * the web component reads via `t(...)`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberLiveSignalTailStrings(): LiveSignalTailStrings {
    val title = stringResource(R.string.translation_liveMonitor_title)
    val time = stringResource(R.string.translation_liveMonitor_time)
    val signal = stringResource(R.string.translation_liveMonitor_signal)
    val value = stringResource(R.string.translation_liveMonitor_value)
    val type = stringResource(R.string.translation_liveMonitor_type)
    val freshness = stringResource(R.string.translation_liveMonitor_freshness)
    val filterHint = stringResource(R.string.translation_liveMonitor_filterPlaceholder) // parity:allow i18n key name
    val filterLabel = stringResource(R.string.translation_liveMonitor_filterLabel)
    val resume = stringResource(R.string.translation_liveMonitor_resume)
    val pause = stringResource(R.string.translation_liveMonitor_pause)
    val autoScroll = stringResource(R.string.translation_liveMonitor_autoScroll)
    val clear = stringResource(R.string.translation_liveMonitor_clear)
    val sigPerSec = stringResource(R.string.translation_liveMonitor_sigPerSec)
    val bufferSize = stringResource(R.string.translation_liveMonitor_bufferSize)
    val uniqueSignals = stringResource(R.string.translation_liveMonitor_uniqueSignals)
    val filtered = stringResource(R.string.translation_liveMonitor_filtered)
    val waiting = stringResource(R.string.translation_liveMonitor_waiting)
    val noMatch = stringResource(R.string.translation_liveMonitor_noMatch)
    return remember(
        title,
        time,
        signal,
        value,
        type,
        freshness,
        filterHint,
        filterLabel,
        resume,
        pause,
        autoScroll,
        clear,
        sigPerSec,
        bufferSize,
        uniqueSignals,
        filtered,
        waiting,
        noMatch,
    ) {
        LiveSignalTailStrings(
            title = title,
            time = time,
            signal = signal,
            value = value,
            type = type,
            freshness = freshness,
            filterHint = filterHint,
            filterLabel = filterLabel,
            resume = resume,
            pause = pause,
            autoScroll = autoScroll,
            clear = clear,
            sigPerSec = sigPerSec,
            bufferSize = bufferSize,
            uniqueSignals = uniqueSignals,
            filtered = filtered,
            waiting = waiting,
            noMatch = noMatch,
        )
    }
}

// ── Column weights (the 5 web columns, tuned for a phone-width table) ───────────────────────────────────
private const val TIME_WEIGHT = 1.3f
private const val SIGNAL_WEIGHT = 1.7f
private const val VALUE_WEIGHT = 1.4f
private const val TYPE_WEIGHT = 1.1f
private const val FRESHNESS_WEIGHT = 0.9f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    LiveSignalTailStrings(
        title = "Live Monitor",
        time = "Time",
        signal = "Signal",
        value = "Value",
        type = "Type",
        freshness = "Freshness",
        filterHint = "Filter by signal name…",
        filterLabel = "Filter signals",
        resume = "Resume",
        pause = "Pause",
        autoScroll = "Auto-scroll",
        clear = "Clear",
        sigPerSec = "Signals / sec",
        bufferSize = "Buffer Size",
        uniqueSignals = "Unique Signals",
        filtered = "Filtered",
        waiting = "Waiting for signals…",
        noMatch = "No signals match filter",
    )

private fun previewEntries(): List<LiveSignalEntry> {
    val base = System.currentTimeMillis()
    return listOf(
        LiveSignalEntry(3L, base, "VehicleSpeed", "64", SignalValueType.Number),
        LiveSignalEntry(2L, base - 400L, "Gear", "D", SignalValueType.Text),
        LiveSignalEntry(1L, base - 900L, "Locked", "true", SignalValueType.Boolean),
    )
}

private fun previewState(
    entries: List<LiveSignalEntry>,
    status: LiveConnectionStatus,
    isStale: Boolean = false,
): LiveSignalTailState =
    LiveSignalTailState(
        entries = entries,
        rate = entries.size,
        paused = false,
        bufferMax = DEFAULT_BUFFER_MAX,
        status = status,
        isStale = isStale,
        updatedAtMillis = if (entries.isEmpty()) null else System.currentTimeMillis(),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LiveSignalTailLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalTailContent(
            previewState(emptyList(), LiveConnectionStatus.Unknown),
            PREVIEW_STRINGS,
            onPauseToggle = {},
            onClear = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun LiveSignalTailEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalTailContent(
            previewState(emptyList(), LiveConnectionStatus.Connected),
            PREVIEW_STRINGS,
            onPauseToggle = {},
            onClear = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun LiveSignalTailDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalTailContent(
            previewState(previewEntries(), LiveConnectionStatus.Connected),
            PREVIEW_STRINGS,
            onPauseToggle = {},
            onClear = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Stale", showBackground = true)
@Composable
private fun LiveSignalTailStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalTailContent(
            previewState(previewEntries(), LiveConnectionStatus.Connected, isStale = true),
            PREVIEW_STRINGS,
            onPauseToggle = {},
            onClear = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun LiveSignalTailErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveSignalTailContent(
            previewState(emptyList(), LiveConnectionStatus.Disconnected),
            PREVIEW_STRINGS,
            onPauseToggle = {},
            onClear = {},
            onRetry = {},
        )
    }
}
