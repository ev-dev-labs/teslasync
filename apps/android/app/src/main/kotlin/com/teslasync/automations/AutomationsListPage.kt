// The native Jetpack Compose + Material 3 AutomationsListPage surface — a parity port of
// web/src/features/automations/pages/AutomationsListPage.tsx, the automations hub. It reproduces the page's
// panels (the four stat tiles, the filter panel, the Quick-Start preset gallery, and the automation list /
// empty state), every data state (loading / empty / error / content) for the list, history, and preset feeds,
// and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [AutomationsListPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, wires the SAF import picker + the deep-link navigator, collects
// the feeds + interaction snapshot); [AutomationsListPageContent] is the stateless render layer driven entirely
// by the collected [io.teslasync.android.data.UiState]s + [AutomationsInteraction] + [AutomationsListActions].
// All derivation lives in the framework-free model (AutomationsListPageModel.kt); this file resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.automations

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
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
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val FADE_STEP_MS = 30
private const val IMPORT_MIME = "application/json"

/** The page's interaction callbacks, wired to the [AutomationsListPageViewModel] (web event handlers). */
data class AutomationsListActions(
    val onStatusFilter: (AutomationStatusFilter) -> Unit,
    val onSearch: (String) -> Unit,
    val onTogglePresets: () -> Unit,
    val onClearFilters: () -> Unit,
    val onToggle: (Long, Boolean) -> Unit,
    val onReEnable: (Long) -> Unit,
    val onDelete: (Long) -> Unit,
    val onTestRun: (Long) -> Unit,
    val onImportClick: () -> Unit,
    val onDismissImportError: () -> Unit,
    val onCreate: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AutomationsListPageViewModel] over the supplied [source] (the host wires the
 * shared S8 holders via [automationsListSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun AutomationsListPage(
    source: AutomationsListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AutomationsListPageViewModel =
        viewModel(
            key = AutomationsListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AutomationsListPageViewModel(source, logger) } },
        )
    AutomationsListPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun AutomationsListPage(
    viewModel: AutomationsListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val historyState by viewModel.historyState.collectAsStateWithLifecycle()
    val presetsState by viewModel.presetsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val busyIds by viewModel.busyIds.collectAsStateWithLifecycle()
    val importing by viewModel.importing.collectAsStateWithLifecycle()
    val importError by viewModel.importError.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val deepLinkRouter = LocalDeepLinkRouter.current
    val importLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri != null) {
                val text =
                    runCatching {
                        context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                    }.getOrNull()
                viewModel.importFromText(text)
            }
        }

    val actions =
        remember(viewModel, importLauncher, deepLinkRouter) {
            AutomationsListActions(
                onStatusFilter = viewModel::setStatusFilter,
                onSearch = viewModel::setSearch,
                onTogglePresets = viewModel::togglePresets,
                onClearFilters = viewModel::clearFilters,
                onToggle = viewModel::toggle,
                onReEnable = viewModel::reEnable,
                onDelete = viewModel::delete,
                onTestRun = viewModel::testRun,
                onImportClick = { importLauncher.launch(IMPORT_MIME) },
                onDismissImportError = viewModel::dismissImportError,
                onCreate = { deepLinkRouter?.request(AutomationsListPageRegistration.BUILDER_DEEP_LINK) },
                onRetry = viewModel::retry,
            )
        }

    AutomationsListPageContent(
        state = state,
        historyState = historyState,
        presetsState = presetsState,
        interaction = interaction,
        busyIds = busyIds,
        importing = importing,
        importError = importError,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: header, import-error banner, stats, filters, warning, presets, list, activity feed. */
@Composable
fun AutomationsListPageContent(
    state: UiState<AutomationsData>,
    historyState: UiState<AutomationHistoryListResponse>,
    presetsState: UiState<AutomationPresetsResponse>,
    interaction: AutomationsInteraction,
    busyIds: Set<Long>,
    importing: Boolean,
    importError: AutomationImportError?,
    actions: AutomationsListActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data ?: AutomationsData.EMPTY
    val filtered =
        remember(data.automations, interaction.statusFilter, interaction.search) {
            filterAutomations(data.automations, interaction.statusFilter, interaction.search)
        }
    val sorted = remember(filtered, data.pins) { sortByPins(filtered, data.pins) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AutomationsHeader(importing = importing, onImport = actions.onImportClick, onCreate = actions.onCreate)

        if (state.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                icon = AutomationsGlyphs.AlertTriangle,
                action =
                    BannerAction(
                        stringResource(R.string.translation_error_retry),
                        actions.onRetry,
                    ),
            )
        }

        importError?.let { error ->
            val reason = importErrorReason(error)
            AlertBanner(
                message = stringResource(R.string.translation_automations_importFailedWithReason, reason),
                tone = Tone.Danger,
                icon = AutomationsGlyphs.AlertTriangle,
                onClose = actions.onDismissImportError,
            )
        }

        FadeIn { AutomationsStatsSection(stats = data.stats, loading = state.isLoading) }

        FadeIn(delayMs = FADE_STEP_MS) {
            AutomationsFiltersPanel(
                interaction = interaction,
                filteredCount = filtered.size,
                totalCount = data.automations.size,
                actions = actions,
            )
        }

        if (data.stats.autoDisabled > 0) {
            FadeIn(delayMs = FADE_STEP_MS) {
                AlertBanner(
                    message = stringResource(R.string.translation_automations_autoDisabledWarning, data.stats.autoDisabled),
                    tone = Tone.Danger,
                    icon = AutomationsGlyphs.AlertTriangle,
                )
            }
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            AutomationsPresetsPanel(
                expanded = interaction.presetsExpanded,
                presetsState = presetsState,
                onToggle = actions.onTogglePresets,
            )
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            AutomationsListSection(
                allCount = data.automations.size,
                filtered = filtered,
                sorted = sorted,
                vehicleNames = data.vehicleNames,
                busyIds = busyIds,
                actions = actions,
            )
        }

        AutomationActivityFeed(state = historyState)
    }
}

@Composable
private fun AutomationsHeader(
    importing: Boolean,
    onImport: () -> Unit,
    onCreate: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_automations_title))
            BodyText(
                stringResource(R.string.translation_automations_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = stringResource(R.string.translation_automations_import),
                onClick = onImport,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = AutomationsGlyphs.Upload,
                enabled = !importing,
                loading = importing,
            )
            Button(
                label = stringResource(R.string.translation_automations_create),
                onClick = onCreate,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Plus,
            )
        }
    }
}

// ── Stats (Total / Active / Disabled / Auto-Disabled) ───────────────────────────────────────────────────────

@Composable
private fun AutomationsStatsSection(
    stats: AutomationStats,
    loading: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            StatCard(
                label = stringResource(R.string.translation_automations_stats_total),
                value = stats.total.toString(),
                modifier = Modifier.weight(1f),
                icon = AutomationsGlyphs.ListFilter,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_automations_stats_active),
                value = stats.active.toString(),
                modifier = Modifier.weight(1f),
                icon = AutomationsGlyphs.Power,
                loading = loading,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            StatCard(
                label = stringResource(R.string.translation_automations_stats_disabled),
                value = stats.disabled.toString(),
                modifier = Modifier.weight(1f),
                icon = AutomationsGlyphs.Pause,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_automations_stats_autoDisabled),
                value = stats.autoDisabled.toString(),
                modifier = Modifier.weight(1f),
                icon = AutomationsGlyphs.ShieldOff,
                loading = loading,
            )
        }
    }
}

// ── Filters panel (GlassPanel5) ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun AutomationsFiltersPanel(
    interaction: AutomationsInteraction,
    filteredCount: Int,
    totalCount: Int,
    actions: AutomationsListActions,
) {
    val statusAria = stringResource(R.string.translation_automations_filterStatus)
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                AutomationsGlyphs.ListFilter,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(modifier = Modifier.weight(1f).semantics { contentDescription = statusAria }) {
                Select(
                    options = statusFilterOptions(),
                    selectedValue = interaction.statusFilter.wire,
                    onSelect = { actions.onStatusFilter(AutomationStatusFilter.fromWire(it)) },
                )
            }
            if (interaction.statusFilter != AutomationStatusFilter.All || interaction.search.isNotBlank()) {
                Badge(text = "$filteredCount / $totalCount", variant = BadgeVariant.Neutral)
            }
        }
        Input(
            value = interaction.search,
            onValueChange = actions.onSearch,
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            hint = stringResource(R.string.translation_automations_search),
            singleLine = true,
        )
    }
}

@Composable
private fun statusFilterOptions(): List<SelectOption> =
    listOf(
        SelectOption(AutomationStatusFilter.All.wire, stringResource(R.string.translation_automations_filters_all)),
        SelectOption(AutomationStatusFilter.Active.wire, stringResource(R.string.translation_automations_stats_active)),
        SelectOption(AutomationStatusFilter.Disabled.wire, stringResource(R.string.translation_automations_stats_disabled)),
        SelectOption(
            AutomationStatusFilter.AutoDisabled.wire,
            stringResource(R.string.translation_automations_stats_autoDisabled),
        ),
    )

// ── Preset gallery (GlassPanel6) ────────────────────────────────────────────────────────────────────────────

@Composable
private fun AutomationsPresetsPanel(
    expanded: Boolean,
    presetsState: UiState<AutomationPresetsResponse>,
    onToggle: () -> Unit,
) {
    val toggleAria = stringResource(R.string.translation_automations_presets_toggleAria)
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggle)
                    .semantics { contentDescription = toggleAria },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Icon(
                AutomationsGlyphs.Sparkles,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(stringResource(R.string.translation_automations_presets_title))
            Caption(stringResource(R.string.translation_automations_presets_hint))
            Spacer(modifier = Modifier.weight(1f))
            Caption(
                stringResource(
                    if (expanded) {
                        R.string.translation_automations_presets_collapse
                    } else {
                        R.string.translation_automations_presets_expand
                    },
                ),
            )
        }
        if (expanded) {
            AutomationPresetGallery(state = presetsState, modifier = Modifier.padding(top = Spacing.md))
        }
    }
}

// ── Automation list / empty states (GlassPanel7) ────────────────────────────────────────────────────────────

@Composable
private fun AutomationsListSection(
    allCount: Int,
    filtered: List<Automation>,
    sorted: List<Automation>,
    vehicleNames: Map<Long, String>,
    busyIds: Set<Long>,
    actions: AutomationsListActions,
) {
    if (filtered.isNotEmpty()) {
        val cardActions =
            remember(actions) {
                AutomationCardActions(
                    onToggle = actions.onToggle,
                    onReEnable = actions.onReEnable,
                    onDelete = actions.onDelete,
                    onTestRun = actions.onTestRun,
                )
            }
        StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            sorted.forEachIndexed { index, automation ->
                StaggerItem(index = index) {
                    AutomationCard(
                        automation = automation,
                        vehicleName = automation.vehicleId?.let { vehicleNames[it] },
                        busy = busyIds.contains(automation.id),
                        actions = cardActions,
                    )
                }
            }
        }
    } else {
        GlassPanel(padding = PanelPadding.Lg) {
            if (allCount == 0) {
                EmptyState(
                    message = stringResource(R.string.translation_automations_empty),
                    icon = AutomationsGlyphs.Zap,
                    action =
                        EmptyStateAction(
                            label = stringResource(R.string.translation_automations_empty_cta),
                            onClick = actions.onCreate,
                        ),
                )
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_automations_noMatch),
                    icon = AutomationsGlyphs.Zap,
                    action =
                        EmptyStateAction(
                            label = stringResource(R.string.translation_automations_noMatch_cta),
                            onClick = actions.onClearFilters,
                        ),
                )
            }
        }
    }
}

// ── Import error reason mapping (web `importFailedWithReason` message) ───────────────────────────────────────

@Composable
private fun importErrorReason(error: AutomationImportError): String =
    when (error) {
        AutomationImportError.TypedEnvelopeRequired ->
            stringResource(R.string.translation_automations_importTypedEnvelopeRequired)
        is AutomationImportError.Failed ->
            error.reason ?: stringResource(R.string.translation_automations_importUnknownError)
    }

// ── Timestamp formatting (shared by the card + the activity feed) ───────────────────────────────────────────

/**
 * Format an RFC-3339 / ISO-8601 [iso] stamp to a localized medium date-time, or null when absent/unparseable.
 * Tolerates both offset-bearing (`…+00:00`) and `Z`-suffixed instants.
 */
internal fun formatAutomationTimestamp(
    iso: String?,
    locale: Locale,
): String? {
    if (iso.isNullOrBlank()) return null
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale)
    return runCatching { OffsetDateTime.parse(iso).format(formatter) }
        .recoverCatching { Instant.parse(iso).atOffset(ZoneOffset.UTC).format(formatter) }
        .getOrNull()
}
