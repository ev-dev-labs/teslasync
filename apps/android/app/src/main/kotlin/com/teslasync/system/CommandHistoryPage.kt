// The native Jetpack Compose + Material 3 CommandHistoryPage system surface — a parity port of
// web/src/features/system/pages/CommandHistoryPage.tsx, the vehicle command audit log. It reproduces the page's
// panels (the four stat tiles — Commands-24h / Success-Rate / Most-Used / Last-Sent — the filter panel, and the
// paginated command timeline), every data state (loading / empty / error / content), and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [CommandHistoryPage] is the stateful entry (constructs the view-model over the host-wired source +
// app-scoped selection, records the one-shot `view.opened` diagnostic, collects the feeds + interaction snapshot);
// [CommandHistoryPageContent] is the stateless render layer driven entirely by [UiState] + the interaction
// snapshot + [CommandHistoryActions]. All derivation (parse / filter / stats / pagination) lives in the
// framework-free model (CommandHistoryPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.system.commandhistory

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import androidx.compose.ui.platform.LocalConfiguration
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.formatFreshnessAge
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Locale

/** The page's interaction callbacks, wired to the [CommandHistoryPageViewModel] (web event handlers). */
data class CommandHistoryActions(
    val onStatus: (StatusFilter) -> Unit,
    val onQuery: (String) -> Unit,
    val onPage: (Int) -> Unit,
    val onSelectVehicle: (Long) -> Unit,
    val onRetry: () -> Unit,
    val onBackToCommands: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [CommandHistoryPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 * [io.teslasync.shared.core.presentation.commands.CommandsStore]) and the app-scoped [selection].
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun CommandHistoryPage(
    source: CommandHistorySource,
    selection: SelectedVehicleStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: CommandHistoryPageViewModel =
        viewModel(
            key = CommandHistoryPageRegistration.SLUG,
            factory = viewModelFactory { initializer { CommandHistoryPageViewModel(source, selection, logger) } },
        )
    CommandHistoryPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun CommandHistoryPage(
    viewModel: CommandHistoryPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val commandsState by viewModel.commandsState.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val selectedId by viewModel.selectedId.collectAsStateWithLifecycle()

    // Web `<Link to="/commands">`: resolved through the system back-dispatcher — the sanctioned page-host
    // navigation seam (no `LocalNavController` is exposed to hosts; mirrors the ArchivedPage/GlancePage precedent).
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onBackToCommands: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    val actions =
        remember(viewModel, onBackToCommands) {
            CommandHistoryActions(
                onStatus = viewModel::setStatus,
                onQuery = viewModel::setQuery,
                onPage = viewModel::setPage,
                onSelectVehicle = viewModel::selectVehicle,
                onRetry = viewModel::retry,
                onBackToCommands = onBackToCommands,
            )
        }

    CommandHistoryPageContent(
        commandsState = commandsState,
        vehiclesState = vehiclesState,
        interaction = interaction,
        selectedId = selectedId,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + vehicle picker + back action), the optional error
 * banner, the stats strip, the filter panel, the command timeline, and the pagination control. Derivation runs
 * through the framework-free model; this layer only resolves i18n + draws so no region ever collapses to blank.
 */
@Composable
fun CommandHistoryPageContent(
    commandsState: UiState<List<CommandLogEntry>>,
    vehiclesState: UiState<List<CommandHistoryVehicle>>,
    interaction: CommandHistoryInteraction,
    selectedId: Long?,
    actions: CommandHistoryActions,
    modifier: Modifier = Modifier,
) {
    val commands = commandsState.data ?: emptyList()
    val now = remember(commandsState.fetchedAt) { System.currentTimeMillis() }
    val stats = remember(commands, now) { computeStats(commands, now) }

    // useDeferredValue parity: defer the search query so the input stays responsive while the heavier
    // timeline/stats chain re-derives; surface the web "Filtering…" pending indicator while they differ.
    val immediateQuery = interaction.query
    var deferredQuery by remember { mutableStateOf(immediateQuery) }
    LaunchedEffect(immediateQuery) {
        if (immediateQuery != deferredQuery) {
            delay(SEARCH_DEFER_MS)
            deferredQuery = immediateQuery
        }
    }
    val searchPending = immediateQuery != deferredQuery
    val effectiveFilters = remember(interaction.status, deferredQuery) {
        CommandHistoryFilters(status = interaction.status, query = deferredQuery)
    }
    val filtered = remember(commands, effectiveFilters) { filterCommands(commands, effectiveFilters) }
    val paginated = remember(filtered, interaction.page) { pageSlice(filtered, interaction.page) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        CommandHistoryHeader(
            vehicles = vehiclesState.data ?: emptyList(),
            selectedId = selectedId,
            onSelectVehicle = actions.onSelectVehicle,
            onBackToCommands = actions.onBackToCommands,
        )

        if (commandsState.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                icon = CommandHistoryGlyphs.XCircle,
                action = BannerAction(stringResource(R.string.translation_error_retry), actions.onRetry),
            )
        }

        FadeIn { CommandHistoryStatsSection(stats = stats, loading = commandsState.isLoading, now = now) }

        FadeIn(delayMs = FADE_STEP_MS) {
            CommandHistoryFiltersPanel(
                status = interaction.status,
                query = immediateQuery,
                searchPending = searchPending,
                onStatus = actions.onStatus,
                onQuery = actions.onQuery,
            )
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            CommandTimelinePanel(
                loading = commandsState.isLoading,
                hasFilters = interaction.filters.hasAny,
                filteredCount = filtered.size,
                rows = paginated,
                now = now,
            )
        }

        if (filtered.size > CommandHistoryPageRegistration.PAGE_SIZE) {
            FadeIn(delayMs = FADE_STEP_MS * 3) {
                CommandHistoryPagination(page = interaction.page, total = filtered.size, onPageChange = actions.onPage)
            }
        }
    }
}

// ── Header (title + subtitle + vehicle picker + back-to-Commands) ───────────────────────────────────────────

@Composable
private fun CommandHistoryHeader(
    vehicles: List<CommandHistoryVehicle>,
    selectedId: Long?,
    onSelectVehicle: (Long) -> Unit,
    onBackToCommands: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_commandHistory_title))
                BodyText(
                    text = stringResource(R.string.translation_commandHistory_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                label = stringResource(R.string.translation_commandHistory_backToCommands),
                onClick = onBackToCommands,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = CommandHistoryGlyphs.Gamepad2,
            )
        }
        if (vehicles.isNotEmpty()) {
            val selectVehicleLabel = stringResource(R.string.translation_commandHistory_selectVehicle)
            Select(
                options = vehicles.map { SelectOption(it.value, it.label) },
                selectedValue = selectedId?.toString(),
                onSelect = { value -> value.toLongOrNull()?.let(onSelectVehicle) },
                emptyLabel = selectVehicleLabel,
                modifier = Modifier.semantics { contentDescription = selectVehicleLabel },
            )
        }
    }
}

// ── Stats (Commands-24h / Success-Rate / Most-Used / Last-Sent) ─────────────────────────────────────────────

@Composable
private fun CommandHistoryStatsSection(
    stats: CommandStats,
    loading: Boolean,
    now: Long,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_commandHistory_total24h),
                value = stats.total24h.toString(),
                modifier = Modifier.weight(1f),
                icon = CommandHistoryGlyphs.Terminal,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_commandHistory_successRate),
                value = "${stats.successRate}%",
                modifier = Modifier.weight(1f),
                icon = CommandHistoryGlyphs.TrendingUp,
                loading = loading,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_commandHistory_mostUsed),
                value = stats.mostUsed?.let { formatCommandName(it) } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = CommandHistoryGlyphs.Award,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_commandHistory_lastSent),
                value = stats.lastCommandMillis?.let { relativeTimeText(it, now) } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = CommandHistoryGlyphs.Clock,
                loading = loading,
            )
        }
    }
}

// ── Filters panel (GlassPanel5) — status tabs + command search ──────────────────────────────────────────────

@Composable
private fun CommandHistoryFiltersPanel(
    status: StatusFilter,
    query: String,
    searchPending: Boolean,
    onStatus: (StatusFilter) -> Unit,
    onQuery: (String) -> Unit,
) {
    val tabs =
        listOf(
            TabNavItem("all", stringResource(R.string.translation_commandHistory_filterAll), CommandHistoryGlyphs.Terminal),
            TabNavItem("success", stringResource(R.string.translation_commandHistory_filterSuccess), CommandHistoryGlyphs.CheckCircle),
            TabNavItem("failed", stringResource(R.string.translation_commandHistory_filterFailed), CommandHistoryGlyphs.XCircle),
        )
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TabNav(items = tabs, selectedKey = status.key, onSelect = { key -> onStatus(StatusFilter.fromKey(key)) })
            val searchLabel = stringResource(R.string.translation_commandHistory_searchCommands)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    Input(
                        value = query,
                        onValueChange = onQuery,
                        hint = stringResource(R.string.translation_commandHistory_searchPlaceholder), // parity:allow web i18n key id contains 'searchPlaceholder', not a stub
                        leadingIcon = CommandHistoryGlyphs.Search,
                        modifier = Modifier.semantics { contentDescription = searchLabel },
                    )
                }
                if (searchPending) {
                    Spinner(
                        size = SpinnerSize.Sm,
                        accessibleLabel = stringResource(R.string.translation_filter_pending),
                    )
                }
            }
        }
    }
}

// ── Command timeline (GlassPanel6) — loading / empty / content ──────────────────────────────────────────────

@Composable
private fun CommandTimelinePanel(
    loading: Boolean,
    hasFilters: Boolean,
    filteredCount: Int,
    rows: List<CommandLogEntry>,
    now: Long,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                CommandHistoryGlyphs.History,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SectionTitle(stringResource(R.string.translation_commandHistory_timelineTitle), modifier = Modifier.weight(1f))
            Caption(stringResource(R.string.translation_commandHistory_showing, filteredCount))
        }

        Box(modifier = Modifier.fillMaxWidth().padding(top = Spacing.md)) {
            when {
                loading ->
                    Box(modifier = Modifier.fillMaxWidth().padding(Spacing.xl2), contentAlignment = Alignment.Center) {
                        Spinner(size = SpinnerSize.Md)
                    }
                rows.isEmpty() ->
                    EmptyState(
                        icon = CommandHistoryGlyphs.History,
                        message =
                            if (hasFilters) {
                                stringResource(R.string.translation_commandHistory_noFilterResults)
                            } else {
                                stringResource(R.string.translation_commandHistory_noCommands)
                            },
                    )
                else -> CommandTimelineList(rows = rows, now = now)
            }
        }
    }
}

@Composable
private fun CommandTimelineList(
    rows: List<CommandLogEntry>,
    now: Long,
) {
    val successColor = TeslaTokens.status.success
    val dangerColor = TeslaTokens.status.danger
    val entries =
        rows.map { entry ->
            TimelineEntry(
                title = formatCommandName(entry.command),
                time = relativeTimeText(entry.createdAtMillis, now),
                subtitle = buildSubtitle(entry),
                icon = if (entry.isSuccess) CommandHistoryGlyphs.CheckCircle else CommandHistoryGlyphs.XCircle,
                accent = if (entry.isSuccess) successColor else dangerColor,
            )
        }
    StaggerContainer { Timeline(items = entries) }
}

// ── Pagination ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun CommandHistoryPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = page,
        pageSize = CommandHistoryPageRegistration.PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            String.format(locale, showingTemplate, start.toString(), end.toString(), count.toString())
        },
    )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Relative "Xm/Xh/Xd ago" rendering — the shared freshness formatter (web `formatRelative`). */
private fun relativeTimeText(
    millis: Long,
    now: Long,
): String = formatFreshnessAge(relativeAge(computeAgeSeconds(millis, now)))

private const val FADE_STEP_MS = 50
private const val SEARCH_DEFER_MS = 180L
