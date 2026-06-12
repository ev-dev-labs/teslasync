// The native Jetpack Compose + Material 3 Backend Status feature view — a parity port of
// web/src/features/system/components/status/BackendStatusSection.tsx. The web component wraps an
// `AccordionSection` (Server icon + title + description + `{ok}/{n} healthy` badge, default-open) around a
// loading-skeleton shell, then three sub-sections: a `DataTable` of component health (Status / Component /
// Latency / Failures / Last Check, with the last three sortable and the table paginated), a five-tile
// connection-pool `StatCard` grid (shown only when a pool resolved), and a runtime `KVList` (Go Version /
// Uptime / Goroutines / OS / Arch, shown only when the system block or version resolved).
//
// This surface keeps that contract end to end. The primary entry binds the shared P1/S8 AdminStore +
// SettingsStore through [BackendStatusSectionViewModel], records the one-shot PII-safe `view.opened`
// diagnostic, projects the composed cache-then-network `Resource` onto the shared [UiState], drives the web
// `refetchInterval` (a 30 s live poll paused while the screen is not STARTED — the
// `refetchIntervalInBackground:false` analogue), and renders every lifecycle state the layer can carry:
// loading (skeletons), content, empty, hard error with retry, and stale/offline ("last known" + chip). It
// performs NO HTTP itself. A stateless content renderer gives hosts / tests / previews a fetch-free entry.
//
// i18n: every catalog-backed label resolves through the P1/S10 facade (`stringResource`); the dozen labels
// the web reads via natural-language keys that are ABSENT from the catalog (so i18next renders the key
// verbatim in every locale) are reproduced verbatim in [rememberBackendStatusSectionStrings] and flagged
// there — the same key-as-default parity precedent the sibling surfaces set, never silent drift.
//
// Icon note: the web uses the lucide `Database` (pool tiles) and `Activity` (in-use) glyphs, which the shared
// Android glyph set has no equivalent for; `Server` (a backend store) and `Pulse` (an activity line) are the
// closest analogues — the same substitution precedent the sibling UptimeMonitorWidget (Gauge for Activity)
// and MQTTStatusWidget (Wifi for Radio) set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendStatusSection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendstatussection

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.delay
import java.util.Locale

/** The web `useQuery` `refetchInterval` (health 30 s; version 60 s). Unified at the tighter 30 s live poll. */
private const val BACKEND_STATUS_REFRESH_INTERVAL_MS: Long = 30_000L

/** Component-table page size (the web `DataTable pagination`). Health components are few, so 1 page is typical. */
private const val COMPONENT_PAGE_SIZE: Int = 10

private const val CHEVRON_EXPANDED_ROTATION = 180f
private val LOADING_BLOCK_TALL = 192.dp
private val LOADING_BLOCK_SHORT = 128.dp

/**
 * Primary entry — the faithful native binding of the web component's three hooks. Binds the shared P1/S8
 * AdminStore + SettingsStore via [BackendStatusSectionViewModel], records the one-shot `view.opened`
 * diagnostic, collects the composed feed lifecycle-aware, and re-fetches every
 * [BACKEND_STATUS_REFRESH_INTERVAL_MS] while the screen is STARTED. It performs no HTTP — the stores and
 * their repositories do (ADR-002).
 *
 * @param admin the shared P1/S8 holder porting the `useAdmin` domain (`/system/health` + `/dev-tools/runtime-info`).
 * @param settings the shared P1/S8 holder porting the `useSettings` domain (`/system/version`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey a unique key per placement so multiple hosts each get their own view-model.
 */
@Composable
fun BackendStatusSection(
    admin: AdminStore,
    settings: SettingsStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = BACKEND_STATUS_SECTION_SLUG,
) {
    val source = remember(admin, settings) { admin.asBackendStatusSectionSource(settings) }
    val viewModel: BackendStatusSectionViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { BackendStatusSectionViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(viewModel, lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(BACKEND_STATUS_REFRESH_INTERVAL_MS)
                viewModel.refresh()
            }
        }
    }

    BackendStatusSectionContent(state = state, onRefresh = viewModel::refresh, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * `AccordionSection` shell (default-open, Server icon + title + description + healthy badge + chevron) above
 * a freshness chip + refresh control, then switches the body: two skeletons while a first load is in flight,
 * a `QueryError` retry surface on a hard error, the friendly empty state when nothing resolved, otherwise the
 * three sub-sections. Stale (non-error) data auto-refreshes via [onRefresh]; stale/refreshing/offline keeps
 * the cached body visible and shows the freshness chip so "last known" is never presented as live.
 */
@Composable
fun BackendStatusSectionContent(
    state: UiState<BackendStatusData>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: BackendStatusSectionStrings = rememberBackendStatusSectionStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    var open by remember { mutableStateOf(true) }
    var sortState by remember { mutableStateOf(SortState()) }
    val formatAge = rememberBackendStatusFreshnessFormatter()
    val data = state.data
    val display =
        remember(data, sortState, strings, locale) {
            data?.let { BackendStatusProjection.project(it, strings, sortState, locale) }
        }

    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        BackendStatusHeader(
            open = open,
            onToggle = { open = !open },
            state = state,
            badgeLabel = display?.badgeLabel,
            allHealthy = display?.allHealthy ?: false,
            strings = strings,
            onRefresh = onRefresh,
            formatAge = formatAge,
        )
        AnimatedVisibility(visible = open) {
            Column {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
                    when {
                        state.isLoading -> BackendStatusLoading(strings = strings)
                        state.isError -> BackendStatusError(state = state, onRetry = onRefresh)
                        state.isEmpty || display == null -> BackendStatusEmpty(strings = strings)
                        else ->
                            BackendStatusBody(
                                display = display,
                                sortState = sortState,
                                onSortChange = { key -> sortState = sortState.toggledBy(key) },
                                strings = strings,
                            )
                    }
                }
            }
        }
    }
}

@Composable
private fun BackendStatusHeader(
    open: Boolean,
    onToggle: () -> Unit,
    state: UiState<BackendStatusData>,
    badgeLabel: String?,
    allHealthy: Boolean,
    strings: BackendStatusSectionStrings,
    onRefresh: () -> Unit,
    formatAge: (FreshnessAge) -> String,
) {
    val rotation by animateFloatAsState(
        targetValue = if (open) CHEVRON_EXPANDED_ROTATION else 0f,
        label = "backend-status-chevron",
    )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClickLabel = strings.title, onClick = onToggle)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = NavGlyphs.Server,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        Column(modifier = Modifier.weight(1f)) {
            PanelTitle(strings.title, modifier = Modifier.semantics { heading() })
            Caption(strings.description)
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshing,
            errorLabel = strings.offline,
            formatAge = formatAge,
        )
        if (badgeLabel != null) {
            Badge(text = badgeLabel, variant = if (allHealthy) BadgeVariant.Success else BadgeVariant.Warning)
        }
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refresh,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Sm,
            modifier = Modifier.rotate(rotation),
        )
    }
}

@Composable
private fun BackendStatusBody(
    display: BackendStatusDisplay,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    strings: BackendStatusSectionStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = display.contentDescription },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        BackendStatusSubsection(title = strings.componentHealth) {
            ComponentTable(rows = display.rows, sortState = sortState, onSortChange = onSortChange, strings = strings)
        }
        display.poolStats?.let { stats ->
            BackendStatusSubsection(title = strings.databaseConnectionPool) {
                PoolStatGrid(stats = stats)
            }
        }
        display.runtimeItems?.let { items ->
            BackendStatusSubsection(title = strings.systemRuntime) {
                KVList(items = items.map { KVItem(it.label, it.value) })
            }
        }
    }
}

@Composable
private fun BackendStatusSubsection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Subhead(title, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
private fun ComponentTable(
    rows: List<ComponentRowView>,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    strings: BackendStatusSectionStrings,
) {
    val columns = remember(strings) { backendStatusColumns(strings) }
    val total = rows.size
    val pageCount = maxOf(1, (total + COMPONENT_PAGE_SIZE - 1) / COMPONENT_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * COMPONENT_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + COMPONENT_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val showingPattern = stringResource(R.string.translation_pagination_showing)

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.name },
        modifier = Modifier.fillMaxWidth(),
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = strings.noComponentsFound,
        footer =
            if (total > COMPONENT_PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = COMPONENT_PAGE_SIZE,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = firstLabel,
                        previousLabel = previousLabel,
                        nextLabel = nextLabel,
                        lastLabel = lastLabel,
                        showingText = { start, end, count -> showingPattern.format(start, end, count) },
                    )
                }
            } else {
                null
            },
    )
}

/** Builds the five component-table columns (web `componentColumns`); only name/latency/failures are sortable. */
private fun backendStatusColumns(strings: BackendStatusSectionStrings): List<TableColumn<ComponentRowView>> =
    listOf(
        TableColumn(key = BackendStatusColumns.STATUS, header = strings.colStatus, weight = STATUS_WEIGHT) { row ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(statusToneIcon(row.tone), contentDescription = null, size = IconSize.Xs, tint = statusToneColor(row.tone))
                Text(row.status, style = MaterialTheme.typography.labelMedium, color = statusToneColor(row.tone))
            }
        },
        TableColumn(key = BackendStatusColumns.NAME, header = strings.colComponent, weight = NAME_WEIGHT, sortable = true) { row ->
            Text(
                row.name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        },
        TableColumn(key = BackendStatusColumns.LATENCY, header = strings.colLatency, weight = NUMERIC_WEIGHT, sortable = true) { row ->
            Caption(row.latencyText)
        },
        TableColumn(key = BackendStatusColumns.FAILURES, header = strings.colFailures, weight = NUMERIC_WEIGHT, sortable = true) { row ->
            Text(
                row.failuresText,
                style = MaterialTheme.typography.bodyMedium,
                color = if (row.failuresIsError) TeslaTokens.status.danger else MaterialTheme.colorScheme.onSurface,
            )
        },
        TableColumn(key = BackendStatusColumns.LAST_CHECK, header = strings.colLastCheck, weight = TIME_WEIGHT) { row ->
            Caption(row.lastCheckText)
        },
    )

@Composable
private fun PoolStatGrid(stats: List<PoolStat>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        stats.chunked(POOL_GRID_COLUMNS).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowStats.forEach { stat ->
                    StatCard(
                        label = stat.label,
                        value = stat.value,
                        icon = poolStatIcon(stat.key),
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(POOL_GRID_COLUMNS - rowStats.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun BackendStatusLoading(strings: BackendStatusSectionStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = LOADING_BLOCK_TALL)
        Skeleton(height = LOADING_BLOCK_SHORT)
    }
}

@Composable
private fun BackendStatusError(
    state: UiState<BackendStatusData>,
    onRetry: () -> Unit,
) {
    QueryError(kind = queryErrorKindOf(state), onRetry = onRetry, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun BackendStatusEmpty(strings: BackendStatusSectionStrings) {
    EmptyState(message = strings.emptyMessage, icon = NavGlyphs.Server, modifier = Modifier.fillMaxWidth())
}

/** Web `getStatusIcon` analogue: CheckCircle (ok) / AlertTriangle (degraded + default) / AlertOctagon (down). */
private fun statusToneIcon(tone: StatusTone): ImageVector =
    when (tone) {
        StatusTone.Ok -> DataDisplayGlyphs.CheckCircle
        StatusTone.Warn -> DataDisplayGlyphs.AlertTriangle
        StatusTone.Down -> DataDisplayGlyphs.AlertOctagon
        StatusTone.Neutral -> DataDisplayGlyphs.AlertTriangle
    }

/** Web `statusTextClass` analogue: green / amber / red / muted. */
@Composable
private fun statusToneColor(tone: StatusTone): Color =
    when (tone) {
        StatusTone.Ok -> TeslaTokens.status.success
        StatusTone.Warn -> TeslaTokens.status.warning
        StatusTone.Down -> TeslaTokens.status.danger
        StatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Pool-tile leading glyph — Server stands in for the web `Database`, Pulse for `Activity` (no shared equivalent). */
private fun poolStatIcon(key: String): ImageVector =
    when (key) {
        "in_use" -> NavGlyphs.Pulse
        "idle" -> DataDisplayGlyphs.Clock
        "wait_count" -> DataDisplayGlyphs.Gauge
        else -> NavGlyphs.Server
    }

/**
 * Folds a [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface (identical to the
 * sibling surfaces): network/timeout ⇒ offline, circuit-open ⇒ transient back-pressure, and an HTTP status
 * selects the not-found / unauthorized / server bucket.
 */
private fun queryErrorKindOf(state: UiState<BackendStatusData>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Resolves the surface labels. Catalog-backed keys (Status / Component / Latency / Failures / healthy / Open
 * / Idle / Uptime / Goroutines, plus the common refresh / loading / offline / no-data chrome) resolve through
 * the P1/S10 facade. The remaining labels are the web's NATURAL-LANGUAGE keys that are ABSENT from the
 * catalog — i18next renders the key verbatim in every locale — so they are reproduced verbatim here to hold
 * exact display parity, the same key-as-default precedent the sibling UptimeMonitorWidget documents. They are
 * isolated below and never silent drift: each is the literal the web itself renders.
 */
@Composable
fun rememberBackendStatusSectionStrings(): BackendStatusSectionStrings {
    val healthy = stringResource(R.string.translation_healthy)
    val colStatus = stringResource(R.string.translation_Status)
    val colComponent = stringResource(R.string.translation_Component)
    val colLatency = stringResource(R.string.translation_Latency)
    val colFailures = stringResource(R.string.translation_Failures)
    val openLabel = stringResource(R.string.translation_Open)
    val idle = stringResource(R.string.translation_Idle)
    val uptime = stringResource(R.string.translation_Uptime)
    val goroutines = stringResource(R.string.translation_Goroutines)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val loading = stringResource(R.string.translation_common_loading)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    return remember(
        healthy,
        colStatus,
        colComponent,
        colLatency,
        colFailures,
        openLabel,
        idle,
        uptime,
        goroutines,
        refresh,
        refreshing,
        offline,
        loading,
        emptyMessage,
    ) {
        BackendStatusSectionStrings(
            // Catalog-absent natural-language keys (web i18next key-as-default) — verbatim parity reproductions.
            title = "Backend Status",
            description = "Component health, database pool, and runtime info",
            componentHealth = "Component Health",
            databaseConnectionPool = "Database Connection Pool",
            systemRuntime = "System Runtime",
            noComponentsFound = "No components found",
            colLastCheck = "Last Check",
            maxOpen = "Max Open",
            inUse = "In Use",
            waitCount = "Wait Count",
            goVersion = "Go Version",
            osArch = "OS / Arch",
            // Catalog-backed keys (resolved through the P1/S10 facade).
            healthy = healthy,
            colStatus = colStatus,
            colComponent = colComponent,
            colLatency = colLatency,
            colFailures = colFailures,
            open = openLabel,
            idle = idle,
            uptime = uptime,
            goroutines = goroutines,
            refresh = refresh,
            refreshing = refreshing,
            offline = offline,
            loading = loading,
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * Maps a [FreshnessAge] bucket to its localized header-chip string (the `translation_freshness_*` catalog
 * keys) — the render-only concern the sibling surfaces resolve the same way, kept out of the pure projection.
 */
@Composable
private fun rememberBackendStatusFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val STATUS_WEIGHT = 1.4f
private const val NAME_WEIGHT = 1.6f
private const val NUMERIC_WEIGHT = 1f
private const val TIME_WEIGHT = 1.8f
private const val POOL_GRID_COLUMNS = 2

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DATA =
    BackendStatusData(
        health =
            HealthSnapshot(
                components =
                    listOf(
                        ComponentRow("database", "ok", 1.4, 0, "2026-06-11T12:00:00Z"),
                        ComponentRow("mqtt", "ok", 0.8, 0, "2026-06-11T12:00:00Z"),
                        ComponentRow("tesla_api", "degraded", 142.0, 3, "2026-06-11T11:59:30Z"),
                        ComponentRow("fleet_telemetry", "down", 0.0, 11, ""),
                    ),
                system = SystemRuntime(goVersion = "go1.25", uptimeSeconds = 271_440, goroutines = 84),
            ),
        pool = PoolSnapshot(maxOpen = 25, open = 7, inUse = 2, idle = 5, waitCount = 0),
        version = VersionSnapshot(goVersion = "go1.25", os = "linux", arch = "amd64", uptimeSeconds = null, goroutines = null),
    )

@Preview(name = "Backend status — content", showBackground = true)
@Composable
private fun BackendStatusContentPreview() {
    TeslaSyncTheme {
        BackendStatusSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA, fetchedAt = 1_000L),
            onRefresh = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Backend status — loading", showBackground = true)
@Composable
private fun BackendStatusLoadingPreview() {
    TeslaSyncTheme {
        BackendStatusSectionContent(state = UiState(phase = UiPhase.Loading), onRefresh = {}, locale = Locale.US)
    }
}

@Preview(name = "Backend status — empty", showBackground = true)
@Composable
private fun BackendStatusEmptyPreview() {
    TeslaSyncTheme {
        BackendStatusSectionContent(
            state = UiState(phase = UiPhase.Empty, data = BackendStatusData(null, null, null)),
            onRefresh = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Backend status — error", showBackground = true)
@Composable
private fun BackendStatusErrorPreview() {
    TeslaSyncTheme {
        BackendStatusSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Backend status — offline (stale)", showBackground = true)
@Composable
private fun BackendStatusOfflinePreview() {
    TeslaSyncTheme {
        BackendStatusSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA, fetchedAt = 1_000L, stale = true, errorKind = ErrorKind.Network),
            onRefresh = {},
            locale = Locale.US,
        )
    }
}
