// The native Jetpack Compose + Material 3 Service Health feature view — a parity port of
// web/src/features/system/components/status/ServiceHealthSection.tsx. The web surface is a single polling
// `useQuery(getTelemetryStatus, refetchInterval: 2s)` rendered inside an AccordionSection disclosure: a
// loading branch (Skeleton), an error branch (QueryError), an empty branch (no telemetry payload), and a
// content branch with two header badges (Enabled/Disabled + "{activeCount} streaming") over four MetricCards
// — Mode, Vehicles Connected, Total Signals, Avg Signals/s — and a sortable, paginated DataTable of
// streaming vehicles (VIN / Status / Signals / Signals-per-second / Latency / Last Received).
//
// This surface keeps that contract exactly and renders every state the P3 checklist requires: loading
// (Skeleton), content (metrics + table), empty (payload not an object ⇒ a friendly empty state, never a
// blank box), hard error (QueryError + retry), and — through the ADR-013 cache-then-network freshness
// contract — stale + offline (cached metrics + table kept visible with a freshness chip in the header + a
// single auto-refresh, mirroring the web 2s refetch cadence). The disclosure chrome (a GlassPanel with a
// clickable icon/title/description/badges/chevron header over a faded-in body) is reproduced inline from
// native primitives + design tokens (P1/S9), never ported Tailwind, exactly as the sibling self-contained
// HealthProbesSection surface does.
//
// All data flows through the shared [ServiceHealthSectionViewModel] (P1/S8); the view performs NO HTTP.
// Every string resolves through the i18n facade (P1/S10) via [resolveServiceHealthText] — catalog-backed
// keys (Mode, Status, Signals, Latency, Streaming, Idle, VIN, streaming, the pagination labels) localize,
// and the web's natural-key fallbacks (Service Health, the metric titles, …) fall back to the key text
// exactly as react-i18next does, so the on-screen text matches the web verbatim. The raw mode + per-vehicle
// timestamps are data shown verbatim (web `{data.mode}` / `formatDateTime`), not translatable copy. The
// Satellite + Zap glyphs reuse the shared component-layer vectors; Radio + TrendingUp are local lucide-style
// vectors (the shared layer carries no match), mirroring HealthProbesSection's local HeartPulse. Every
// interactive element carries a TalkBack label. `view.opened` is emitted once via the redacting logger.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ServiceHealthSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.servicehealth

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberMotionDurationMs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point. Binds the `/telemetry` feed seam via [source] into a [ServiceHealthSectionViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live cache-then-network state, and renders the
 * surface. A system-status host supplies [source] (typically `serviceHealthSource { … }`); [logger] defaults
 * to the process logger from the data container.
 */
@Composable
fun ServiceHealthSection(
    source: ServiceHealthSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ServiceHealthSectionViewModel =
        viewModel(
            key = ServiceHealthSectionRegistration.ID,
            factory = ServiceHealthSectionViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberServiceHealthStrings()
    ServiceHealthSectionContent(
        state = state,
        strings = strings,
        modifier = modifier,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the web
 * AccordionSection chrome (a [GlassPanel] with no built-in padding so the header click target and the divider
 * span full width) with an always-present header over a body that mounts only while [open]. The body switches
 * on the cache-then-network [UiState]: loading ⇒ Skeleton, hard error ⇒ [QueryError], empty ⇒ a friendly
 * [EmptyState], otherwise the metrics grid + vehicles table. Stale (non-error) data auto-refreshes exactly
 * once, mirroring the web 2s refetch cadence; offline keeps the cached content with a freshness chip.
 */
@Composable
fun ServiceHealthSectionContent(
    state: UiState<ServiceHealthData>,
    strings: ServiceHealthStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
    defaultOpen: Boolean = true,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    var open by rememberSaveable { mutableStateOf(defaultOpen) }
    val data = state.data ?: ServiceHealthData.EMPTY
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        ServiceHealthHeader(
            strings = strings,
            state = state,
            data = data,
            open = open,
            onToggle = { open = !open },
        )
        if (open) {
            ServiceHealthBody(state = state, data = data, strings = strings, onRetry = onRetry)
        }
    }
}

/**
 * The clickable disclosure header — the web `role="button"` row. A single merged button node so TalkBack
 * announces the title + description together; [stateDescription] carries the web `aria-expanded` and the
 * click label carries the expand/collapse action. The leading Satellite glyph is tinted with the info accent
 * (web `text-cyan-400`); the trailing chevron rotates with [open] (web `open && 'rotate-180'`), honoring
 * reduced motion via [rememberMotionDurationMs]. The Enabled/Disabled + streaming-count badges (plus a
 * freshness chip when stale/refreshing/offline) appear only while there is content to describe (web `data ?`).
 */
@Composable
private fun ServiceHealthHeader(
    strings: ServiceHealthStrings,
    state: UiState<ServiceHealthData>,
    data: ServiceHealthData,
    open: Boolean,
    onToggle: () -> Unit,
) {
    val durationMs = rememberMotionDurationMs(MotionDurations.normal)
    val rotation by animateFloatAsState(
        targetValue = if (open) CHEVRON_OPEN_DEGREES else CHEVRON_CLOSED_DEGREES,
        animationSpec = tween(durationMs),
        label = "serviceHealthChevron",
    )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = strings.actionLabel(open), onClick = onToggle)
                .padding(horizontal = Spacing.xl, vertical = Spacing.lg)
                .semantics(mergeDescendants = true) { stateDescription = strings.stateLabel(open) },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = MapsGlyphs.Satellite,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            Caption(strings.description)
        }
        if (state.isContent) {
            ServiceHealthBadges(data = data, state = state, strings = strings)
        }
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.rotate(rotation),
        )
    }
}

/**
 * The header chip cluster — the web `<Badge dot>Enabled/Disabled</Badge><Badge>{activeCount} streaming</Badge>`
 * pair. A freshness chip is appended only when the cached content is not perfectly fresh (stale / refreshing /
 * offline), honestly surfacing the ADR-013 freshness state without removing any web parity in the fresh case.
 */
@Composable
private fun ServiceHealthBadges(
    data: ServiceHealthData,
    state: UiState<ServiceHealthData>,
    strings: ServiceHealthStrings,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Badge(
            text = if (data.enabled) strings.enabled else strings.disabled,
            variant = ServiceHealthProjection.enabledBadgeVariant(data.enabled),
            dot = true,
        )
        Badge(text = "${data.activeCount} ${strings.streamingSuffix}", variant = BadgeVariant.Info)
        if (state.stale || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }
    }
}

/**
 * The revealed body — the web `{open && (<FadeIn>…)}`. A hairline top divider precedes the per-state content,
 * faded in (web `FadeIn`). Only called while expanded.
 */
@Composable
private fun ServiceHealthBody(
    state: UiState<ServiceHealthData>,
    data: ServiceHealthData,
    strings: ServiceHealthStrings,
    onRetry: () -> Unit,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                when {
                    state.isLoading -> ServiceHealthLoading(strings = strings)
                    state.isError -> ServiceHealthError(state = state, strings = strings, onRetry = onRetry)
                    state.isEmpty -> EmptyState(message = strings.emptyHint, modifier = Modifier.fillMaxWidth())
                    else -> ServiceHealthContent(data = data, strings = strings)
                }
            }
        }
    }
}

/** The web `isLoading` branch — a tall skeleton block (web `<Skeleton className="h-48"/>`), label exposed. */
@Composable
private fun ServiceHealthLoading(strings: ServiceHealthStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = METRICS_SKELETON_HEIGHT)
        Skeleton(height = TABLE_SKELETON_HEIGHT)
    }
}

/** The web `error` branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun ServiceHealthError(
    state: UiState<ServiceHealthData>,
    strings: ServiceHealthStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = serviceHealthErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.title,
        onRetry = onRetry,
    )
}

/** The web success branch — the four MetricCards over the streaming-vehicles table. */
@Composable
private fun ServiceHealthContent(
    data: ServiceHealthData,
    strings: ServiceHealthStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        ServiceHealthMetrics(data = data, strings = strings)
        ServiceHealthVehiclesTable(rows = data.vehicles, strings = strings)
    }
}

/**
 * The four summary MetricCards — the web `<Grid cols={{default:2, md:4}}>`. Rendered as a two-column grid on
 * phones (the `default: 2`): Mode (cyan/Radio), Vehicles Connected (green/Satellite), Total Signals
 * (purple/Zap), Avg Signals/s (cyan/TrendingUp). A blank mode falls back to the em dash so the tile is never
 * empty (the repo's missing-value convention).
 */
@Composable
private fun ServiceHealthMetrics(
    data: ServiceHealthData,
    strings: ServiceHealthStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = strings.mode,
                value = data.mode.ifBlank { EM_DASH },
                modifier = Modifier.weight(1f),
                icon = ServiceHealthGlyphs.Radio,
                accent = TeslaTokens.status.info,
            )
            MetricCard(
                label = strings.vehiclesConnected,
                value = ServiceHealthProjection.formatCount(data.activeCount.toLong()),
                modifier = Modifier.weight(1f),
                icon = MapsGlyphs.Satellite,
                accent = TeslaTokens.status.success,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = strings.totalSignals,
                value = ServiceHealthProjection.formatCount(data.totalSignals),
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                accent = TeslaTokens.chart.power,
            )
            MetricCard(
                label = strings.avgSignalsPerSecond,
                value = data.avgSignalsPerSecond,
                modifier = Modifier.weight(1f),
                icon = ServiceHealthGlyphs.TrendingUp,
                accent = TeslaTokens.status.info,
            )
        }
    }
}

/**
 * The streaming-vehicles table — the web sortable + paginated `<DataTable>`. The Signals column is sortable
 * (web `sortable` on `signal_count`) and the rows are paginated client-side; an empty fleet shows the
 * friendly "No vehicles connected" copy (web `emptyMessage`). Sort + page state are local UI state, exactly
 * as the web table owns them internally.
 */
@Composable
private fun ServiceHealthVehiclesTable(
    rows: List<ServiceVehicleRow>,
    strings: ServiceHealthStrings,
) {
    var sortState by remember { mutableStateOf(SortState()) }
    val sorted = ServiceHealthProjection.sortVehicles(rows, sortState)
    val total = sorted.size
    val pageCount = maxOf(1, (total + VEHICLES_PAGE_SIZE - 1) / VEHICLES_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * VEHICLES_PAGE_SIZE
    val visible = if (total == 0) emptyList() else sorted.subList(from, minOf(from + VEHICLES_PAGE_SIZE, total))

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
                    pageSize = VEHICLES_PAGE_SIZE,
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
        columns = serviceHealthColumns(strings),
        rows = visible,
        keyOf = { it.vin },
        sortState = sortState,
        onSortChange = { sortState = sortState.toggledBy(it) },
        emptyText = strings.noVehicles,
        footer = footer,
    )
}

/**
 * The six-column layout the web `vehicleColumns` array defines — monospace VIN, a Streaming/Idle status
 * badge, the sortable Signals count, signals-per-second, latency, and the formatted Last Received timestamp.
 * Headers arrive already-localized.
 */
private fun serviceHealthColumns(strings: ServiceHealthStrings): List<TableColumn<ServiceVehicleRow>> =
    listOf(
        TableColumn(key = COL_VIN_KEY, header = strings.colVin) { CodeText(it.vin) },
        TableColumn(key = COL_STATUS_KEY, header = strings.colStatus) {
            Badge(
                text = if (it.isStreaming) strings.rowStreaming else strings.rowIdle,
                variant = ServiceHealthProjection.streamingBadgeVariant(it.isStreaming),
                dot = true,
            )
        },
        TableColumn(key = SERVICE_HEALTH_SIGNAL_COUNT_KEY, header = strings.colSignals, sortable = true, alignEnd = true) {
            Caption(ServiceHealthProjection.formatCount(it.signalCount))
        },
        TableColumn(key = COL_THROUGHPUT_KEY, header = strings.colSignalsPerSecond, alignEnd = true) {
            Caption(ServiceHealthProjection.formatThroughput(it.signalsPerSecond))
        },
        TableColumn(key = COL_LATENCY_KEY, header = strings.colLatency, alignEnd = true) {
            Caption(ServiceHealthProjection.formatLatency(it.latencyMs))
        },
        TableColumn(key = COL_LAST_RECEIVED_KEY, header = strings.colLastReceived) {
            Caption(ServiceHealthProjection.formatLastReceived(it.lastReceived))
        },
    )

/**
 * The localized strings the composable renders — resolved once at the render boundary (all by-name with the
 * web `t(key, default)` fallback) and handed to the stateless content as a framework-free bundle so the view
 * stays a thin render layer. [actionLabel] / [stateLabel] pick the open/closed variant so the header's
 * accessibility affordances track the toggle.
 */
data class ServiceHealthStrings(
    val title: String,
    val description: String,
    val enabled: String,
    val disabled: String,
    val streamingSuffix: String,
    val mode: String,
    val vehiclesConnected: String,
    val totalSignals: String,
    val avgSignalsPerSecond: String,
    val colVin: String,
    val colStatus: String,
    val colSignals: String,
    val colSignalsPerSecond: String,
    val colLatency: String,
    val colLastReceived: String,
    val rowStreaming: String,
    val rowIdle: String,
    val noVehicles: String,
    val emptyHint: String,
    val loading: String,
    val expandAction: String,
    val collapseAction: String,
    val expandedState: String,
    val collapsedState: String,
) {
    /** The TalkBack action label for the toggle in its current [open] state (web `role="button"` intent). */
    fun actionLabel(open: Boolean): String = if (open) collapseAction else expandAction

    /** The TalkBack state description for the current [open] state (web `aria-expanded`). */
    fun stateLabel(open: Boolean): String = if (open) expandedState else collapsedState
}

/** The English-fallback bundle (every key text), used by previews + UI tests and as the catalog-miss path. */
fun serviceHealthFallbackStrings(): ServiceHealthStrings =
    ServiceHealthStrings(
        title = ServiceHealthKeys.TITLE,
        description = ServiceHealthKeys.DESCRIPTION,
        enabled = ServiceHealthKeys.ENABLED,
        disabled = ServiceHealthKeys.DISABLED,
        streamingSuffix = ServiceHealthKeys.STREAMING_SUFFIX,
        mode = ServiceHealthKeys.MODE,
        vehiclesConnected = ServiceHealthKeys.VEHICLES_CONNECTED,
        totalSignals = ServiceHealthKeys.TOTAL_SIGNALS,
        avgSignalsPerSecond = ServiceHealthKeys.AVG_SIGNALS_PER_SECOND,
        colVin = ServiceHealthKeys.COL_VIN,
        colStatus = ServiceHealthKeys.COL_STATUS,
        colSignals = ServiceHealthKeys.COL_SIGNALS,
        colSignalsPerSecond = ServiceHealthKeys.COL_SIGNALS_PER_SECOND,
        colLatency = ServiceHealthKeys.COL_LATENCY,
        colLastReceived = ServiceHealthKeys.COL_LAST_RECEIVED,
        rowStreaming = ServiceHealthKeys.ROW_STREAMING,
        rowIdle = ServiceHealthKeys.ROW_IDLE,
        noVehicles = ServiceHealthKeys.NO_VEHICLES,
        emptyHint = ServiceHealthKeys.EMPTY_HINT,
        loading = ServiceHealthKeys.LOADING,
        expandAction = ServiceHealthKeys.EXPAND_ACTION,
        collapseAction = ServiceHealthKeys.COLLAPSE_ACTION,
        expandedState = ServiceHealthKeys.EXPANDED_STATE,
        collapsedState = ServiceHealthKeys.COLLAPSED_STATE,
    )

/** Resolves the localized bundle once at the render boundary; remembered against [Context] (locale change). */
@Composable
private fun rememberServiceHealthStrings(): ServiceHealthStrings {
    val context = LocalContext.current
    return remember(context) { resolveServiceHealthStrings(context) }
}

/** Pure resolver — maps every key through [resolveServiceHealthText] (catalog ⇒ localized, else key text). */
internal fun resolveServiceHealthStrings(context: Context): ServiceHealthStrings =
    ServiceHealthStrings(
        title = resolveServiceHealthText(context, ServiceHealthKeys.TITLE),
        description = resolveServiceHealthText(context, ServiceHealthKeys.DESCRIPTION),
        enabled = resolveServiceHealthText(context, ServiceHealthKeys.ENABLED),
        disabled = resolveServiceHealthText(context, ServiceHealthKeys.DISABLED),
        streamingSuffix = resolveServiceHealthText(context, ServiceHealthKeys.STREAMING_SUFFIX),
        mode = resolveServiceHealthText(context, ServiceHealthKeys.MODE),
        vehiclesConnected = resolveServiceHealthText(context, ServiceHealthKeys.VEHICLES_CONNECTED),
        totalSignals = resolveServiceHealthText(context, ServiceHealthKeys.TOTAL_SIGNALS),
        avgSignalsPerSecond = resolveServiceHealthText(context, ServiceHealthKeys.AVG_SIGNALS_PER_SECOND),
        colVin = resolveServiceHealthText(context, ServiceHealthKeys.COL_VIN),
        colStatus = resolveServiceHealthText(context, ServiceHealthKeys.COL_STATUS),
        colSignals = resolveServiceHealthText(context, ServiceHealthKeys.COL_SIGNALS),
        colSignalsPerSecond = resolveServiceHealthText(context, ServiceHealthKeys.COL_SIGNALS_PER_SECOND),
        colLatency = resolveServiceHealthText(context, ServiceHealthKeys.COL_LATENCY),
        colLastReceived = resolveServiceHealthText(context, ServiceHealthKeys.COL_LAST_RECEIVED),
        rowStreaming = resolveServiceHealthText(context, ServiceHealthKeys.ROW_STREAMING),
        rowIdle = resolveServiceHealthText(context, ServiceHealthKeys.ROW_IDLE),
        noVehicles = resolveServiceHealthText(context, ServiceHealthKeys.NO_VEHICLES),
        emptyHint = resolveServiceHealthText(context, ServiceHealthKeys.EMPTY_HINT),
        loading = resolveServiceHealthText(context, ServiceHealthKeys.LOADING),
        expandAction = resolveServiceHealthText(context, ServiceHealthKeys.EXPAND_ACTION),
        collapseAction = resolveServiceHealthText(context, ServiceHealthKeys.COLLAPSE_ACTION),
        expandedState = resolveServiceHealthText(context, ServiceHealthKeys.EXPANDED_STATE),
        collapsedState = resolveServiceHealthText(context, ServiceHealthKeys.COLLAPSED_STATE),
    )

/**
 * Reproduces react-i18next's `t(key)` against the Android catalog: looks up `translation_<sanitized-key>`,
 * returning the localized resource when present and falling back to [key] when absent (the web behaviour).
 * `getIdentifier` is the only way to attempt a key that may be absent, so `DiscouragedApi` is suppressed;
 * release builds keep resource names (shrinking is off) so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
internal fun resolveServiceHealthText(
    context: Context,
    key: String,
): String {
    val resourceName = "translation_" + key.replace(NON_RESOURCE_CHARS, "_")
    val id = context.resources.getIdentifier(resourceName, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

private const val EM_DASH = "\u2014"
private const val CHEVRON_OPEN_DEGREES = 180f
private const val CHEVRON_CLOSED_DEGREES = 0f
private const val VEHICLES_PAGE_SIZE = 10
private val METRICS_SKELETON_HEIGHT = 120.dp
private val TABLE_SKELETON_HEIGHT = 192.dp
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

private const val COL_VIN_KEY = "vin"
private const val COL_STATUS_KEY = "status"
private const val COL_THROUGHPUT_KEY = "signals_per_second"
private const val COL_LATENCY_KEY = "latency_ms"
private const val COL_LAST_RECEIVED_KEY = "last_received"

// ── Local glyphs — the web `Radio` + `TrendingUp` (lucide). Authored as 24×24 stroked vectors because the
// shared component layer carries no Radio/TrendingUp glyph (mirrors HealthProbesSection's local HeartPulse).
// Satellite + Zap reuse the shared MapsGlyphs.Satellite / DataDisplayGlyphs.Bolt vectors. ──

private object ServiceHealthGlyphs {
    /** Concentric broadcast arcs around a center dot (lucide `radio`) — the Mode metric icon. */
    val Radio: ImageVector =
        serviceHealthStroked("ServiceHealthRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveTo(5.5f, 13.9f, 5.5f, 10.1f, 7.8f, 7.7f)
            moveTo(10f, 12f)
            arcTo(2f, 2f, 0f, false, true, 14f, 12f)
            arcTo(2f, 2f, 0f, false, true, 10f, 12f)
            close()
            moveTo(16.2f, 7.8f)
            curveTo(18.5f, 10.1f, 18.5f, 13.9f, 16.2f, 16.3f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.2f, 19.1f, 19.1f)
        }

    /** An upward trend line with an arrowhead (lucide `trending-up`) — the Avg Signals/s metric icon. */
    val TrendingUp: ImageVector =
        serviceHealthStroked("ServiceHealthTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    private fun serviceHealthStroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = GLYPH_SIZE,
                defaultHeight = GLYPH_SIZE,
                viewportWidth = GLYPH_VIEWPORT,
                viewportHeight = GLYPH_VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = GLYPH_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews — one per rendered state (content / stale-offline / empty / loading / error) ──

private const val PREVIEW_NOW = 1_700_000_000_000L

private fun previewVehicles(): List<ServiceVehicleRow> =
    listOf(
        ServiceVehicleRow(
            vin = "5YJ3E1EA7KF000001",
            isStreaming = true,
            signalCount = 18_240L,
            signalsPerSecond = 4.2,
            latencyMs = 38.0,
            lastReceived = "2023-11-14T22:13:20Z",
        ),
        ServiceVehicleRow(
            vin = "5YJ3E1EA7KF000002",
            isStreaming = true,
            signalCount = 9_110L,
            signalsPerSecond = 2.7,
            latencyMs = 55.0,
            lastReceived = "2023-11-14T22:12:58Z",
        ),
        ServiceVehicleRow(
            vin = "5YJ3E1EA7KF000003",
            isStreaming = false,
            signalCount = 412L,
            signalsPerSecond = 0.0,
            latencyMs = 0.0,
            lastReceived = "",
        ),
    )

private fun previewData(): ServiceHealthData =
    ServiceHealthData(
        enabled = true,
        mode = "fleet_telemetry",
        totalSignals = 27_762L,
        avgSignalsPerSecond = "6.9",
        vehicles = previewVehicles(),
        resolved = true,
    )

private fun previewContent(stale: Boolean = false): UiState<ServiceHealthData> =
    UiState(
        phase = UiPhase.Content,
        data = previewData(),
        fetchedAt = PREVIEW_NOW,
        stale = stale,
        errorKind = if (stale) ErrorKind.Network else null,
    )

@Preview(name = "ServiceHealth · content", showBackground = true)
@Composable
private fun ServiceHealthContentPreview() {
    TeslaSyncTheme {
        ServiceHealthSectionContent(state = previewContent(), strings = serviceHealthFallbackStrings())
    }
}

@Preview(name = "ServiceHealth · offline", showBackground = true)
@Composable
private fun ServiceHealthOfflinePreview() {
    TeslaSyncTheme {
        ServiceHealthSectionContent(state = previewContent(stale = true), strings = serviceHealthFallbackStrings())
    }
}

@Preview(name = "ServiceHealth · empty", showBackground = true)
@Composable
private fun ServiceHealthEmptyPreview() {
    TeslaSyncTheme {
        ServiceHealthSectionContent(
            state = UiState(phase = UiPhase.Empty, data = ServiceHealthData.EMPTY, fetchedAt = 1L),
            strings = serviceHealthFallbackStrings(),
        )
    }
}

@Preview(name = "ServiceHealth · loading", showBackground = true)
@Composable
private fun ServiceHealthLoadingPreview() {
    TeslaSyncTheme {
        ServiceHealthSectionContent(state = UiState(phase = UiPhase.Loading), strings = serviceHealthFallbackStrings())
    }
}

@Preview(name = "ServiceHealth · error", showBackground = true)
@Composable
private fun ServiceHealthErrorPreview() {
    TeslaSyncTheme {
        ServiceHealthSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            strings = serviceHealthFallbackStrings(),
        )
    }
}
