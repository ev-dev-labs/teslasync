// The native Jetpack Compose + Material 3 RedisSignalViewerPage admin surface — a parity port of
// web/src/features/admin/pages/RedisSignalViewerPage.tsx, the operator tool that inspects (and purges) the Redis
// L2 live-signal cache per vehicle. It reproduces the page's six panels (the controls bar; the four Total /
// Numbers / Strings / Booleans stat cards; and the signals table panel), the persistent diagnostic chip strip,
// every data state (loading / empty / error / success) for both the `useVehicles` picker feed and the per-vehicle
// snapshot feed, the two destructive purges behind a typed-confirmation dialog, and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [RedisSignalViewerPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the four feeds + the interaction snapshot, and
// drains the one-shot purge toasts); [RedisSignalViewerContent] is the stateless render layer. The panels are
// private sub-composables; all derivation (categorization, filter/sort, counts, JSON projection) lives in the
// framework-free model (RedisSignalViewerPageModel.kt), so this file only resolves i18n + draws. The structured
// error/empty banner reuses the shared A3 [RedisDiagnosticEmptyState] feature view, exactly as the web page does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.redissignals

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MaskVariant
import io.teslasync.android.components.ui.MaskedValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.redisdiagnosticemptystate.DiagnosticError
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisDiagnosticEmptyState
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisSignalKeyEntry
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisSignalsMeta
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val FADE_STEP_MS = 40
private const val SKELETON_ROWS = 6
private const val PURGE_ALL_TYPED_TOKEN = "PURGE ALL"
private const val EM_DASH = "\u2014"

/** The page's interaction callbacks, wired to the [RedisSignalViewerPageViewModel] (web event handlers). */
data class RedisSignalViewerActions(
    val onVehicle: (Long?) -> Unit,
    val onSearch: (String) -> Unit,
    val onCategory: (String) -> Unit,
    val onAutoRefresh: (Boolean) -> Unit,
    val onRefresh: () -> Unit,
    val onRetryVehicles: () -> Unit,
    val onPurgeOne: (String) -> Unit,
    val onPurgeAll: () -> Unit,
    val onPurgeConfirm: () -> Unit,
    val onPurgeCancel: () -> Unit,
    val onSelectVehicle: (Long?) -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [RedisSignalViewerPageViewModel] over the supplied [source] (the host wires the
 * shared S8 Vehicles holder + the resilient client via [redisSignalViewerSource]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun RedisSignalViewerPage(
    source: RedisSignalViewerSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: RedisSignalViewerPageViewModel =
        viewModel(
            key = RedisSignalViewerPageRegistration.SLUG,
            factory = viewModelFactory { initializer { RedisSignalViewerPageViewModel(source, logger) } },
        )
    RedisSignalViewerPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content, draining toasts. */
@Composable
fun RedisSignalViewerPage(
    viewModel: RedisSignalViewerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val redisFeed by viewModel.redisFeed.collectAsStateWithLifecycle()
    val keysState by viewModel.keysState.collectAsStateWithLifecycle()

    val context = LocalContext.current
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, context) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                toastSeq += 1
                val item = ToastItem(id = toastSeq, message = resolveToastMessage(context, event), tone = toneOf(event.severity))
                toasts = enqueueToast(toasts, item, MAX_TOASTS)
            }
        }
    }
    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    val actions =
        remember(viewModel) {
            RedisSignalViewerActions(
                onVehicle = viewModel::setVehicle,
                onSearch = viewModel::setSearch,
                onCategory = viewModel::setCategoryFilter,
                onAutoRefresh = viewModel::setAutoRefresh,
                onRefresh = viewModel::refresh,
                onRetryVehicles = viewModel::refreshVehicles,
                onPurgeOne = viewModel::openPurgeOne,
                onPurgeAll = viewModel::openPurgeAll,
                onPurgeConfirm = viewModel::confirmPurge,
                onPurgeCancel = viewModel::cancelPurge,
                onSelectVehicle = viewModel::setVehicle,
            )
        }

    RedisSignalViewerContent(
        interaction = interaction,
        vehiclesState = vehiclesState,
        redisFeed = redisFeed,
        keysState = keysState,
        actions = actions,
        toasts = toasts,
        onToastDismiss = { id -> toasts = dismissToast(toasts, id) },
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the controls panel, the persistent diagnostic chips + the
 * stat grid (shown once a vehicle is selected), and the signals table panel — wrapped in a [Box] so the purge
 * confirm dialog + the toast host overlay the scrolling content.
 */
@Composable
fun RedisSignalViewerContent(
    interaction: RedisInteraction,
    vehiclesState: UiState<List<RedisVehicleOption>>,
    redisFeed: RedisFeed,
    keysState: UiState<List<RedisSignalKeyEntry>>,
    actions: RedisSignalViewerActions,
    toasts: List<ToastItem>,
    onToastDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val vehicles = vehiclesState.data ?: emptyList()
    val data = redisFeed.state.data
    val selectedLabel = remember(vehicles, interaction.vehicleId) { selectedVehicleLabel(vehicles, interaction.vehicleId) }

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            RedisHeader()

            // Panel 1 — the controls bar (picker + search + category + auto-refresh + refresh/purge actions).
            FadeIn {
                GlassPanel(padding = PanelPadding.Md) {
                    RedisControls(
                        interaction = interaction,
                        vehicles = vehicles,
                        vehiclesState = vehiclesState,
                        categoryCounts = data?.categoryCounts ?: emptyMap(),
                        isFetching = redisFeed.state.isLoading || redisFeed.state.refreshing,
                        selectedLabel = selectedLabel,
                        actions = actions,
                    )
                }
            }

            // Persistent diagnostic chips — visible whenever a vehicle is selected and the backend exposes meta.
            if (interaction.hasVehicle && data?.meta != null) {
                FadeIn(delayMs = FADE_STEP_MS) { RedisDiagnosticChips(data.meta) }
            }

            // Panels 2-5 — the Total / Numbers / Strings / Booleans stat cards (shown once a vehicle is selected).
            if (interaction.hasVehicle) {
                FadeIn(delayMs = FADE_STEP_MS) {
                    RedisStatGrid(
                        data = data,
                        showDash = redisFeed.state.isLoading || redisFeed.state.isError,
                    )
                }
            }

            // Panel 6 — the signals table panel (with its loading / empty / diagnostic / success states).
            FadeIn(delayMs = FADE_STEP_MS * 2) {
                GlassPanel(padding = PanelPadding.Md) {
                    RedisTablePanel(
                        interaction = interaction,
                        redisFeed = redisFeed,
                        keysState = keysState,
                        actions = actions,
                    )
                }
            }
        }

        if (interaction.isPurgeDialogOpen) {
            RedisPurgeDialog(interaction = interaction, actions = actions)
        }

        ToastHost(toasts = toasts, onDismiss = onToastDismiss, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun RedisHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_redis_title))
        BodyText(
            stringResource(R.string.translation_redis_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Panel 1: controls ───────────────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RedisControls(
    interaction: RedisInteraction,
    vehicles: List<RedisVehicleOption>,
    vehiclesState: UiState<List<RedisVehicleOption>>,
    categoryCounts: Map<SignalCategory, Int>,
    isFetching: Boolean,
    selectedLabel: String,
    actions: RedisSignalViewerActions,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        // Vehicle picker (web `useVehicles` select). The leading empty option clears the selection.
        val vehicleOptions =
            listOf(SelectOption(value = "", label = stringResource(R.string.translation_redis_selectVehicle))) +
                vehicles.map { SelectOption(value = it.id.toString(), label = it.label) }
        Select(
            options = vehicleOptions,
            selectedValue = interaction.vehicleId?.toString() ?: "",
            onSelect = { actions.onVehicle(it.toLongOrNull()) },
            emptyLabel = stringResource(R.string.translation_redis_selectVehicle),
        )
        // useVehicles hard-error affordance: a retry that re-collects the fleet feed (the bound source's error state).
        if (vehiclesState.isError) {
            Button(
                label = stringResource(R.string.translation_redis_refresh),
                onClick = actions.onRetryVehicles,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = io.teslasync.android.components.feedback.FeedbackGlyphs.Refresh,
            )
        }

        // Signal-name search filter.
        Input(
            value = interaction.search,
            onValueChange = actions.onSearch,
            label = stringResource(R.string.translation_redis_searchPlaceholder), // parity:allow i18n key literally named searchPlaceholder
            leadingIcon = FormsGlyphs.Search,
        )

        // Category filter with per-bucket counts.
        val categoryOptions =
            listOf(SelectOption(value = RedisInteraction.ALL_CATEGORIES, label = stringResource(R.string.translation_redis_allCategories))) +
                SignalCategory.entries.map { category ->
                    SelectOption(value = category.label, label = "${category.label} (${categoryCounts[category] ?: 0})")
                }
        Select(
            options = categoryOptions,
            selectedValue = interaction.categoryFilter,
            onSelect = actions.onCategory,
            emptyLabel = stringResource(R.string.translation_redis_allCategories),
        )

        // Auto-refresh toggle.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Toggle(checked = interaction.autoRefresh, onCheckedChange = actions.onAutoRefresh)
            Caption(stringResource(R.string.translation_redis_autoRefresh))
        }

        // Action buttons — refresh + the two destructive purges behind explicit confirmation. The web `title`
        // tooltips become TalkBack content descriptions on the destructive buttons.
        val purgeButtonTitle = stringResource(R.string.translation_redis_purgeButtonTitle)
        val purgeAllButtonTitle = stringResource(R.string.translation_redis_purgeAllButtonTitle)
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = stringResource(R.string.translation_redis_refresh),
                onClick = actions.onRefresh,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = interaction.hasVehicle && !isFetching,
                leadingIcon = FeedbackGlyphs.Refresh,
            )
            Button(
                label = stringResource(R.string.translation_redis_purgeButton),
                onClick = { actions.onPurgeOne(selectedLabel) },
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
                enabled = interaction.hasVehicle && !interaction.isPurging,
                leadingIcon = MapsGlyphs.Trash,
                modifier = Modifier.semantics { contentDescription = purgeButtonTitle },
            )
            Button(
                label = stringResource(R.string.translation_redis_purgeAllButton),
                onClick = actions.onPurgeAll,
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
                enabled = !interaction.isPurging,
                leadingIcon = MapsGlyphs.Trash,
                modifier = Modifier.semantics { contentDescription = purgeAllButtonTitle },
            )
        }
    }
}

// ── Persistent diagnostic chips ─────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RedisDiagnosticChips(meta: RedisSignalsMeta) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        val hybrid = meta.liveSignalStoreMode == "hybrid"
        Badge(
            text = stringResource(R.string.translation_redis_headerChip_mode, meta.liveSignalStoreMode),
            variant = if (hybrid) BadgeVariant.Success else BadgeVariant.Danger,
        )
        if (meta.vehicleVin.isNotBlank()) {
            Badge(text = meta.vehicleVin, variant = BadgeVariant.Neutral)
        }
        meta.l1LastSeenAt?.let { iso ->
            Badge(
                text = stringResource(R.string.translation_redis_headerChip_l1Seen, formatInstant(iso)),
                variant = BadgeVariant.Info,
            )
        }
    }
}

// ── Panels 2-5: stat grid ───────────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RedisStatGrid(
    data: RedisSignalsData?,
    showDash: Boolean,
) {
    val emDash = EM_DASH
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatCard(
            label = stringResource(R.string.translation_redis_totalSignals),
            value = if (showDash) emDash else (data?.signalCount ?: 0).toString(),
            icon = RedisSignalViewerGlyphs.Database,
            modifier = Modifier.statCellWidth(),
        )
        StatCard(
            label = stringResource(R.string.translation_redis_numbers),
            value = if (showDash) emDash else (data?.numberCount ?: 0).toString(),
            modifier = Modifier.statCellWidth(),
        )
        StatCard(
            label = stringResource(R.string.translation_redis_strings),
            value = if (showDash) emDash else (data?.stringCount ?: 0).toString(),
            modifier = Modifier.statCellWidth(),
        )
        StatCard(
            label = stringResource(R.string.translation_redis_booleans),
            value = if (showDash) emDash else (data?.booleanCount ?: 0).toString(),
            modifier = Modifier.statCellWidth(),
        )
    }
}

/** Two stat cards per row on a phone, four on a wider tablet — a responsive grid without a fixed column count. */
private fun Modifier.statCellWidth(): Modifier = this.fillMaxWidth(STAT_CELL_FRACTION)

private const val STAT_CELL_FRACTION = 0.46f

// ── Panel 6: table ──────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RedisTablePanel(
    interaction: RedisInteraction,
    redisFeed: RedisFeed,
    keysState: UiState<List<RedisSignalKeyEntry>>,
    actions: RedisSignalViewerActions,
) {
    val data = redisFeed.state.data
    val rows = data?.rows ?: emptyList()
    val filtered =
        remember(rows, interaction.search, interaction.categoryFilter) {
            filterRows(rows, interaction.search, interaction.categoryFilter)
        }

    when {
        !interaction.hasVehicle ->
            EmptyState(
                message = stringResource(R.string.translation_redis_selectPrompt),
                icon = RedisSignalViewerGlyphs.Database,
            )

        redisFeed.state.isLoading ->
            TableSkeleton(rows = SKELETON_ROWS, columns = 4)

        filtered.isEmpty() ->
            if (rows.isEmpty() || redisFeed.state.isError) {
                RedisDiagnosticEmptyState(
                    vehicleId = (interaction.vehicleId ?: 0L).toInt(),
                    meta = data?.meta,
                    onSelectVehicle = { id -> actions.onSelectVehicle(id.toLong()) },
                    error = redisFeed.error,
                    otherVehicleKeys = keysState.data ?: emptyList(),
                    keysUnavailable = keysState.isError || keysState.isLoading,
                )
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_redis_noMatch),
                    icon = FormsGlyphs.Search,
                )
            }

        else -> RedisSignalsTable(rows = filtered)
    }
}

@Composable
private fun RedisSignalsTable(rows: List<SignalRow>) {
    var sortState by remember { mutableStateOf(SortState(key = COL_NAME, direction = SortDirection.Asc)) }
    var page by remember(rows.size) { mutableIntStateOf(1) }

    val sorted =
        remember(rows, sortState) {
            sortRows(rows, sortState.key, sortState.direction == SortDirection.Asc)
        }
    val total = sorted.size
    val pageSize = RedisSignalViewerPageRegistration.PAGE_SIZE
    val pageCount = maxOf(1, (total + pageSize - 1) / pageSize)
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * pageSize
    val visible = if (total == 0) emptyList() else sorted.subList(from, minOf(from + pageSize, total))

    val maskedCoordLabel = stringResource(R.string.translation_redis_maskedCoord)
    val columns = redisColumns(maskedCoordLabel)

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    // Resolve the raw catalog format once at the composable boundary (ADR-014), then interpolate with String
    // args inside the non-composable Pagination callback — avoids a LocalContext resource read in the lambda and
    // keeps the %s format specifiers type-matched.
    val showingFormat = stringResource(R.string.translation_pagination_showing)

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.name },
        sortState = sortState,
        onSortChange = { key -> sortState = sortState.toggledBy(key) },
        footer =
            if (total > 0) {
                {
                    Pagination(
                        page = current,
                        pageSize = pageSize,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = firstLabel,
                        previousLabel = previousLabel,
                        nextLabel = nextLabel,
                        lastLabel = lastLabel,
                        showingText = { start, end, count ->
                            showingFormat.format(start.toString(), end.toString(), count.toString())
                        },
                    )
                }
            } else {
                null
            },
    )
}

/** The four-column layout the web `buildColumns` defines — Signal / Value (masked for coords) / Type / Category. */
@Composable
private fun redisColumns(maskedCoordLabel: String): List<TableColumn<SignalRow>> =
    listOf(
        TableColumn(key = COL_NAME, header = stringResource(R.string.translation_redis_signalName), sortable = true) {
            CodeText(it.name)
        },
        TableColumn(key = COL_VALUE, header = stringResource(R.string.translation_redis_value)) { row ->
            if (row.isLocation) {
                MaskedValue(
                    value = row.value,
                    variant = MaskVariant.Generic,
                    revealLabel = maskedCoordLabel,
                    hideLabel = maskedCoordLabel,
                    accessibleName = maskedCoordLabel,
                )
            } else {
                CodeText(row.value)
            }
        },
        TableColumn(key = COL_TYPE, header = stringResource(R.string.translation_redis_type), sortable = true) {
            Badge(text = it.type.wire, variant = typeBadgeVariant(it.type))
        },
        TableColumn(key = COL_CATEGORY, header = stringResource(R.string.translation_redis_category), sortable = true) {
            Badge(text = it.category.label, variant = categoryBadgeVariant(it.category))
        },
    )

/** Web `type === 'number' ? 'info' : type === 'boolean' ? 'warning' : 'neutral'`. */
private fun typeBadgeVariant(type: SignalType): BadgeVariant =
    when (type) {
        SignalType.Number -> BadgeVariant.Info
        SignalType.Boolean -> BadgeVariant.Warning
        else -> BadgeVariant.Neutral
    }

/** Web `CATEGORY_COLORS`: Battery→success, Charging→info, Driving→warning, Climate→danger, Other→neutral. */
private fun categoryBadgeVariant(category: SignalCategory): BadgeVariant =
    when (category) {
        SignalCategory.Battery -> BadgeVariant.Success
        SignalCategory.Charging -> BadgeVariant.Info
        SignalCategory.Driving -> BadgeVariant.Warning
        SignalCategory.Climate -> BadgeVariant.Danger
        SignalCategory.Other -> BadgeVariant.Neutral
    }

// ── Purge dialog ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RedisPurgeDialog(
    interaction: RedisInteraction,
    actions: RedisSignalViewerActions,
) {
    val isAll = interaction.purgeMode == PurgeMode.All
    ConfirmDialog(
        title =
            if (isAll) {
                stringResource(R.string.translation_redis_purgeAllTitle)
            } else {
                stringResource(R.string.translation_redis_purgeTitle, interaction.purgeTargetLabel)
            },
        message =
            if (isAll) {
                stringResource(R.string.translation_redis_purgeAllMessage)
            } else {
                stringResource(R.string.translation_redis_purgeMessage)
            },
        confirmLabel =
            if (isAll) {
                stringResource(R.string.translation_redis_purgeAllConfirm)
            } else {
                stringResource(R.string.translation_redis_purgeConfirm)
            },
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = actions.onPurgeConfirm,
        onCancel = actions.onPurgeCancel,
        severity = ConfirmSeverity.Danger,
        loading = interaction.isPurging,
        requireTypedConfirmation = if (isAll) PURGE_ALL_TYPED_TOKEN else null,
        typedConfirmationLabel = if (isAll) stringResource(R.string.translation_redis_purgeAllTypedLabel) else null,
    )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Web `selectedVehicle?.display_name || vin || \`Vehicle ${id}\``, or empty when nothing is selected. */
private fun selectedVehicleLabel(
    vehicles: List<RedisVehicleOption>,
    vehicleId: Long?,
): String {
    if (vehicleId == null) return ""
    return vehicles.firstOrNull { it.id == vehicleId }?.label ?: "Vehicle $vehicleId"
}

private val INSTANT_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)

/** Formats an ISO-8601 instant for the L1-last-seen chip (web `useDateFormat().formatTime`); raw on parse failure. */
private fun formatInstant(iso: String): String =
    runCatching {
        OffsetDateTime
            .parse(iso)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(INSTANT_FORMATTER)
    }.getOrDefault(iso)

/** Maps a one-shot purge [UiEvent.Message] to its localized toast text (ADR-014 — render boundary owns the lookup). */
private fun resolveToastMessage(
    context: Context,
    event: UiEvent.Message,
): String {
    fun arg(index: Int): String = event.args.getOrElse(index) { "" }
    return when (event.messageKey) {
        RedisToastKeys.PURGE_SUCCESS ->
            context.getString(R.string.translation_redis_purgeSuccess) + " — " +
                context.getString(R.string.translation_redis_purgeSuccessDetail, arg(0))

        RedisToastKeys.PURGE_NOOP ->
            context.getString(R.string.translation_redis_purgeNoOpTitle) + " — " +
                context.getString(R.string.translation_redis_purgeNoOpDetail, arg(0))

        RedisToastKeys.PURGE_ERROR -> {
            val title = context.getString(R.string.translation_redis_purgeError)
            if (arg(0).isBlank()) title else "$title: ${arg(0)}"
        }

        RedisToastKeys.PURGE_ALL_PARTIAL ->
            context.getString(R.string.translation_redis_purgeAllPartial) + " — " +
                context.getString(R.string.translation_redis_purgeAllPartialDetail, arg(0), arg(1))

        RedisToastKeys.PURGE_ALL_SUCCESS ->
            context.getString(R.string.translation_redis_purgeAllSuccess) + " — " +
                context.getString(R.string.translation_redis_purgeAllSuccessDetail, arg(0))

        else -> ""
    }
}

/** Folds the [UiEvent.Severity] onto the toast [Tone] (web toast severity). */
private fun toneOf(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }