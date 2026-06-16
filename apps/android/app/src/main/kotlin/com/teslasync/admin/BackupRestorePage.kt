// The native Jetpack Compose + Material 3 BackupRestorePage admin surface — a parity port of
// web/src/features/admin/pages/BackupRestorePage.tsx, the "Backup & Restore" management screen. It reproduces the
// web composition end to end: the page header (title + subtitle + Quick-Backup / New-Config actions), the four
// summary metric cards (Total Configs / Total Backups / Last Backup / Total Size), the configured-schedules
// panel (a definition-list row per config with its type / provider / frequency / schedule / options + trigger /
// edit / delete affordances), the backup-history panel (a row per run with its time / type / status / provider /
// file / size / records / duration + download / verify / preview affordances, plus the recent-errors strip), the
// create/edit modal with its dynamic provider settings, the delete-confirmation dialog, and the restore-preview
// modal. Both feeds are bound through the shared P1/S8 state-holder layer as [UiState]s, so each renders every
// declared lifecycle state — loading / empty / error+retry / success — without the view performing HTTP
// (ADR-002). Every visible string resolves from the platform catalog via `stringResource` / `getString`
// (ADR-014); every control carries an accessible name (ADR-015); sizes/dates format at the locale boundary (S5).
//
// Composition mirrors the sibling admin surfaces: [BackupRestorePage] is the stateful entry (constructs the
// view-model over the host-wired source, records `view.opened`, collects the feeds + interaction, owns the toast
// host); [BackupRestorePageContent] is the stateless renderer that is the preview entry point. All derivation
// lives in the framework-free model (BackupRestorePageModel.kt); this file resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + helpers + previews. `TooManyFunctions`/`LargeClass`/`LongMethod` reflect the surface's
// full parity (six panels + three modals).
@file:Suppress(
    "MatchingDeclarationName",
    "InvalidPackageDeclaration",
    "TooManyFunctions",
    "LargeClass",
    "LongMethod",
)

package io.teslasync.android.admin.backuprestore

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.feedback.dismissToast
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
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private val LABEL_WIDTH = 104.dp
private val SKELETON_METRIC_HEIGHT = 88.dp

/** The localized absolute date-time formatter for a run's timestamp (render-only; API 26+ `java.time`). */
private val RUN_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/** The page's interaction callbacks, wired to the [BackupRestorePageViewModel] (web event handlers). */
data class BackupRestoreActions(
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
    val onQuickBackup: () -> Unit,
    val onNewConfig: () -> Unit,
    val onEditConfig: (BackupConfig) -> Unit,
    val onDeleteConfig: (BackupConfig) -> Unit,
    val onTrigger: (Long) -> Unit,
    val onDownload: (Long) -> Unit,
    val onVerify: (Long) -> Unit,
    val onPreview: (Long) -> Unit,
    val onCloseModal: () -> Unit,
    val onSave: () -> Unit,
    val onFormName: (String) -> Unit,
    val onFormEnabled: (Boolean) -> Unit,
    val onFormBackupType: (String) -> Unit,
    val onFormProvider: (String) -> Unit,
    val onFormFrequency: (String) -> Unit,
    val onFormRetention: (String) -> Unit,
    val onFormCompress: (Boolean) -> Unit,
    val onFormEncrypt: (Boolean) -> Unit,
    val onProviderField: (String, String) -> Unit,
    val onCancelDelete: () -> Unit,
    val onConfirmDelete: () -> Unit,
    val onClosePreview: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [BackupRestorePageViewModel] over the supplied [source] (the host wires the
 * shared resilient client via [asBackupRestorePageSource]). The view-model is keyed by this surface's slug so it
 * is scoped to the navigation entry. [logger] defaults to the app's redacting logger.
 */
@Composable
fun BackupRestorePage(
    source: BackupRestorePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: BackupRestorePageViewModel =
        viewModel(
            key = BackupRestorePageRegistration.SLUG,
            factory = viewModelFactory { initializer { BackupRestorePageViewModel(source, logger) } },
        )
    BackupRestorePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records `view.opened`, binds the feeds + interaction, and owns the bottom-anchored toast host. */
@Composable
fun BackupRestorePage(
    viewModel: BackupRestorePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val configsState by viewModel.configsState.collectAsStateWithLifecycle()
    val runsState by viewModel.runsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    LaunchedEffect(viewModel, context) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                toastSeq += 1
                val item = ToastItem(id = toastSeq, message = resolveToastMessage(context, event.messageKey), tone = toneOf(event.severity))
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
        remember(viewModel, uriHandler) {
            BackupRestoreActions(
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
                onQuickBackup = viewModel::quickBackup,
                onNewConfig = viewModel::openCreate,
                onEditConfig = viewModel::openEdit,
                onDeleteConfig = viewModel::requestDelete,
                onTrigger = viewModel::trigger,
                onDownload = { runId -> uriHandler.openUri(backupDownloadUrl(runId)) },
                onVerify = viewModel::verify,
                onPreview = viewModel::openPreview,
                onCloseModal = viewModel::closeModal,
                onSave = viewModel::save,
                onFormName = { value -> viewModel.updateForm { it.copy(name = value) } },
                onFormEnabled = { value -> viewModel.updateForm { it.copy(enabled = value) } },
                onFormBackupType = { value -> viewModel.updateForm { it.copy(backupType = value) } },
                onFormProvider = viewModel::setProvider,
                onFormFrequency = { value -> viewModel.updateForm { it.copy(frequencyDays = clampFrequency(value)) } },
                onFormRetention = { value -> viewModel.updateForm { it.copy(maxRetention = clampRetention(value)) } },
                onFormCompress = { value -> viewModel.updateForm { it.copy(compress = value) } },
                onFormEncrypt = { value -> viewModel.updateForm { it.copy(encrypt = value) } },
                onProviderField = viewModel::setProviderField,
                onCancelDelete = viewModel::cancelDelete,
                onConfirmDelete = viewModel::confirmDelete,
                onClosePreview = viewModel::closePreview,
            )
        }

    BackupRestorePageContent(
        configsState = configsState,
        runsState = runsState,
        interaction = interaction,
        actions = actions,
        toasts = toasts,
        onToastDismiss = { id -> toasts = dismissToast(toasts, id) },
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the header + the four metric cards + the two glass panels (configs / history), with
 * the create/edit, delete, and restore-preview modals layered above and the toast host anchored to the bottom.
 * Hoisted out of the ViewModel so each state is preview- and screenshot-testable with hand-built inputs.
 */
@Composable
fun BackupRestorePageContent(
    configsState: UiState<JsonElement>,
    runsState: UiState<JsonElement>,
    interaction: BackupRestoreInteraction,
    actions: BackupRestoreActions,
    toasts: List<ToastItem>,
    onToastDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val configs = configsState.data?.asBackupConfigs() ?: emptyList()
    val runs = runsState.data?.asBackupRuns() ?: emptyList()

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            BackupHeader(quickRunning = interaction.quickRunning, onQuickBackup = actions.onQuickBackup, onNewConfig = actions.onNewConfig)

            if (configsState.hasError || runsState.hasError) {
                LoadErrorBanner()
            }

            StatsSection(configsState = configsState, runsState = runsState, configs = configs, runs = runs)

            ConfigurationsPanel(state = configsState, configs = configs, interaction = interaction, actions = actions)

            HistoryPanel(state = runsState, runs = runs, interaction = interaction, actions = actions)
        }

        ToastHost(
            toasts = toasts,
            onDismiss = onToastDismiss,
            modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.md),
        )
    }

    if (interaction.modalOpen) {
        ConfigFormModal(interaction = interaction, actions = actions)
    }
    interaction.deleteTarget?.let { target ->
        DeleteConfigDialog(target = target, deleting = interaction.deleting, actions = actions)
    }
    if (interaction.previewOpen) {
        RestorePreviewModal(interaction = interaction, onClose = actions.onClosePreview)
    }
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun BackupHeader(
    quickRunning: Boolean,
    onQuickBackup: () -> Unit,
    onNewConfig: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PageTitle(stringResource(R.string.translation_backup_title))
        BodyText(stringResource(R.string.translation_backup_subtitle), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = stringResource(R.string.translation_backup_quickBackup),
                onClick = onQuickBackup,
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                loading = quickRunning,
                leadingIcon = BackupGlyphs.Bolt,
            )
            Button(
                label = stringResource(R.string.translation_backup_newConfig),
                onClick = onNewConfig,
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = BackupGlyphs.Plus,
            )
        }
    }
}

/** The "failed to load data" banner shown above the panels while a feed carries an error (web `AlertBanner`). */
@Composable
private fun LoadErrorBanner() {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(BackupGlyphs.AlertCircle, contentDescription = null, tint = MaterialTheme.colorScheme.error)
        BodyText(stringResource(R.string.translation_error_loadFailed), color = MaterialTheme.colorScheme.error)
    }
}

// ── Stats (four metric cards) ───────────────────────────────────────────────────────────────────────────────

@Composable
private fun StatsSection(
    configsState: UiState<JsonElement>,
    runsState: UiState<JsonElement>,
    configs: List<BackupConfig>,
    runs: List<BackupRun>,
) {
    val loading = (configsState.isLoading || runsState.isLoading) && !configsState.hasData && !runsState.hasData
    if (loading) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(2) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Skeleton(modifier = Modifier.weight(1f), height = SKELETON_METRIC_HEIGHT, rounded = true)
                    Skeleton(modifier = Modifier.weight(1f), height = SKELETON_METRIC_HEIGHT, rounded = true)
                }
            }
        }
        return
    }

    val stats = backupStats(configs, runs)
    val lastBackup = stats.lastBackupAtMillis?.let(::relativeTime) ?: EM_DASH
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = stringResource(R.string.translation_backup_totalConfigs),
                value = formatCount(stats.totalConfigs),
                modifier = Modifier.weight(1f),
                icon = BackupGlyphs.Database,
                accent = MaterialTheme.colorScheme.primary,
            )
            MetricCard(
                label = stringResource(R.string.translation_backup_totalBackups),
                value = formatCount(stats.totalBackups),
                modifier = Modifier.weight(1f),
                icon = BackupGlyphs.Archive,
                accent = MaterialTheme.colorScheme.tertiary,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = stringResource(R.string.translation_backup_lastBackup),
                value = lastBackup,
                modifier = Modifier.weight(1f),
                icon = BackupGlyphs.Clock,
                accent = MaterialTheme.colorScheme.secondary,
            )
            MetricCard(
                label = stringResource(R.string.translation_backup_totalSize),
                value = formatBytes(stats.totalSizeBytes),
                modifier = Modifier.weight(1f),
                icon = BackupGlyphs.HardDrive,
                accent = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

// ── Panel 5: configurations ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ConfigurationsPanel(
    state: UiState<JsonElement>,
    configs: List<BackupConfig>,
    interaction: BackupRestoreInteraction,
    actions: BackupRestoreActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_backup_configurations))
        Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                state.isLoading -> PanelLoading()
                state.isError -> ErrorDisplay(
                    message = stringResource(R.string.translation_error_loadFailed),
                    onRetry = actions.onRetry,
                    modifier = Modifier.fillMaxWidth(),
                )
                state.isEmpty ->
                    EmptyState(
                        icon = BackupGlyphs.Database,
                        title = stringResource(R.string.translation_backup_noConfigs),
                        message = stringResource(R.string.translation_backup_noConfigsMessage),
                        action = EmptyStateAction(label = stringResource(R.string.translation_backup_newConfig), onClick = actions.onNewConfig),
                        modifier = Modifier.fillMaxWidth(),
                    )
                else ->
                    configs.forEachIndexed { index, config ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        ConfigRow(config = config, triggering = interaction.triggeringId == config.id, actions = actions)
                    }
            }
        }
    }
}

@Composable
private fun ConfigRow(
    config: BackupConfig,
    triggering: Boolean,
    actions: BackupRestoreActions,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_backup_name))
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    BodyText(config.name.ifBlank { EM_DASH })
                    if (!config.enabled) {
                        Badge(text = stringResource(R.string.translation_backup_disabled), variant = BadgeVariant.Neutral)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                IconButton(
                    imageVector = BackupGlyphs.Play,
                    contentDescription = stringResource(R.string.translation_backup_triggerNow),
                    onClick = { actions.onTrigger(config.id) },
                    enabled = !triggering,
                    size = IconSize.Md,
                )
                IconButton(
                    imageVector = BackupGlyphs.Pencil,
                    contentDescription = stringResource(R.string.translation_backup_edit),
                    onClick = { actions.onEditConfig(config) },
                    size = IconSize.Md,
                )
                IconButton(
                    imageVector = BackupGlyphs.Trash,
                    contentDescription = stringResource(R.string.translation_backup_delete),
                    onClick = { actions.onDeleteConfig(config) },
                    size = IconSize.Md,
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }

        LabeledField(stringResource(R.string.translation_backup_type)) {
            val isFull = config.backupType == BACKUP_TYPE_FULL
            Badge(
                text = stringResource(if (isFull) R.string.translation_backup_full else R.string.translation_backup_incremental),
                variant = if (isFull) BadgeVariant.Info else BadgeVariant.Warning,
            )
        }
        LabeledField(stringResource(R.string.translation_backup_provider)) {
            ProviderBadge(config.provider)
        }
        LabeledField(stringResource(R.string.translation_backup_frequency)) {
            BodyText(frequencyLabel(config.frequencyDays), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LabeledField(stringResource(R.string.translation_backup_schedule)) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption("${stringResource(R.string.translation_backup_lastRun)}: ${config.lastRunAtMillis?.let(::relativeTime) ?: EM_DASH}")
                Caption("${stringResource(R.string.translation_backup_nextRun)}: ${config.nextRunAtMillis?.let(::relativeTime) ?: EM_DASH}")
            }
        }
        if (config.compress || config.encrypt) {
            LabeledField(stringResource(R.string.translation_backup_options)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    if (config.compress) Badge(text = stringResource(R.string.translation_backup_compress), variant = BadgeVariant.Neutral)
                    if (config.encrypt) Badge(text = stringResource(R.string.translation_backup_encrypt), variant = BadgeVariant.Warning)
                }
            }
        }
    }
}

@Composable
private fun frequencyLabel(frequencyDays: Int): String =
    if (frequencyDays == 1) {
        stringResource(R.string.translation_backup_daily)
    } else {
        stringResource(R.string.translation_backup_everyNDays, frequencyDays.toString())
    }

// ── Panel 6: history ────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun HistoryPanel(
    state: UiState<JsonElement>,
    runs: List<BackupRun>,
    interaction: BackupRestoreInteraction,
    actions: BackupRestoreActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringResource(R.string.translation_backup_history))
            Button(
                label = stringResource(R.string.translation_backup_refresh),
                onClick = actions.onRefresh,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                state.isLoading -> PanelLoading()
                state.isError -> ErrorDisplay(
                    message = stringResource(R.string.translation_error_loadFailed),
                    onRetry = actions.onRetry,
                    modifier = Modifier.fillMaxWidth(),
                )
                state.isEmpty ->
                    EmptyState(
                        icon = BackupGlyphs.Clock,
                        title = stringResource(R.string.translation_backup_noRuns),
                        message = stringResource(R.string.translation_backup_noRunsMessage),
                        modifier = Modifier.fillMaxWidth(),
                    )
                else -> {
                    runs.forEachIndexed { index, run ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        RunRow(run = run, verifying = interaction.verifyingId == run.id, actions = actions)
                    }
                    val failed = recentFailedRuns(runs)
                    if (failed.isNotEmpty()) {
                        RecentErrors(failed)
                    }
                }
            }
        }
    }
}

@Composable
private fun RunRow(
    run: BackupRun,
    verifying: Boolean,
    actions: BackupRestoreActions,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_backup_time))
                BodyText(run.createdAtMillis?.let(::absoluteTime) ?: EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (run.status == RUN_STATUS_COMPLETED) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    IconButton(
                        imageVector = BackupGlyphs.Download,
                        contentDescription = stringResource(R.string.translation_backup_download),
                        onClick = { actions.onDownload(run.id) },
                        size = IconSize.Md,
                    )
                    IconButton(
                        imageVector = BackupGlyphs.ShieldCheck,
                        contentDescription = stringResource(R.string.translation_backup_verify),
                        onClick = { actions.onVerify(run.id) },
                        enabled = !verifying,
                        size = IconSize.Md,
                    )
                    IconButton(
                        imageVector = BackupGlyphs.Eye,
                        contentDescription = stringResource(R.string.translation_backup_preview),
                        onClick = { actions.onPreview(run.id) },
                        size = IconSize.Md,
                    )
                }
            }
        }

        LabeledField(stringResource(R.string.translation_backup_runType)) {
            Badge(text = run.runType.ifBlank { EM_DASH }, variant = runTypeVariant(run.runType))
        }
        LabeledField(stringResource(R.string.translation_backup_status)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Icon(statusGlyph(run.status), contentDescription = null, size = IconSize.Sm, tint = statusColor(run.status))
                Badge(text = run.status.ifBlank { EM_DASH }, variant = statusVariant(run.status))
            }
        }
        LabeledField(stringResource(R.string.translation_backup_provider)) {
            ProviderBadge(run.provider)
        }
        LabeledField(stringResource(R.string.translation_backup_file)) {
            CodeText(run.fileName ?: EM_DASH)
        }
        LabeledField(stringResource(R.string.translation_backup_size)) {
            BodyText(if (run.fileSize > 0L) formatBytes(run.fileSize) else EM_DASH)
        }
        LabeledField(stringResource(R.string.translation_backup_records)) {
            BodyText(if (run.recordCount > 0L) formatCount(run.recordCount) else EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LabeledField(stringResource(R.string.translation_backup_duration)) {
            BodyText(if (run.durationMs > 0L) formatDurationCompact(run.durationMs) else EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun RecentErrors(failed: List<BackupRun>) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        FieldLabelText(stringResource(R.string.translation_backup_recentErrors))
        failed.forEach { run ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(BackupGlyphs.AlertCircle, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.error)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText(run.fileName ?: "#${run.id}")
                    Caption(run.errorMessage.orEmpty())
                }
            }
        }
    }
}

// ── Create / edit modal ─────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ConfigFormModal(
    interaction: BackupRestoreInteraction,
    actions: BackupRestoreActions,
) {
    val form = interaction.form
    val title =
        if (interaction.isEditing) {
            stringResource(R.string.translation_backup_editConfig)
        } else {
            stringResource(R.string.translation_backup_newConfig)
        }
    Modal(onDismissRequest = actions.onCloseModal, title = title, closeLabel = stringResource(R.string.translation_common_close)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = form.name,
                onValueChange = actions.onFormName,
                label = stringResource(R.string.translation_backup_configName),
                hint = stringResource(R.string.translation_backup_configNamePlaceholder), // parity:allow web i18n key literally named configNamePlaceholder
            )
            Toggle(
                checked = form.enabled,
                onCheckedChange = actions.onFormEnabled,
                label = stringResource(R.string.translation_backup_enabled),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Select(
                    options = backupTypeOptions(),
                    selectedValue = form.backupType,
                    onSelect = actions.onFormBackupType,
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_backup_backupType),
                )
                Select(
                    options = PROVIDER_OPTIONS.map { SelectOption(value = it.value, label = it.label) },
                    selectedValue = form.provider,
                    onSelect = actions.onFormProvider,
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_backup_provider),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Input(
                    value = form.frequencyDays.toString(),
                    onValueChange = actions.onFormFrequency,
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_backup_frequencyDays),
                    keyboardType = KeyboardType.Number,
                )
                Input(
                    value = form.maxRetention.toString(),
                    onValueChange = actions.onFormRetention,
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_backup_maxRetention),
                    keyboardType = KeyboardType.Number,
                )
            }
            ProviderSettings(form = form, onProviderField = actions.onProviderField)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Toggle(checked = form.compress, onCheckedChange = actions.onFormCompress, label = stringResource(R.string.translation_backup_compress))
                Toggle(checked = form.encrypt, onCheckedChange = actions.onFormEncrypt, label = stringResource(R.string.translation_backup_encrypt))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            ) {
                Button(
                    label = stringResource(R.string.translation_common_cancel),
                    onClick = actions.onCloseModal,
                    variant = ButtonVariant.Outline,
                )
                Button(
                    label =
                        if (interaction.isEditing) {
                            stringResource(R.string.translation_backup_saveChanges)
                        } else {
                            stringResource(R.string.translation_backup_create)
                        },
                    onClick = actions.onSave,
                    variant = ButtonVariant.Primary,
                    enabled = form.canSave && !interaction.saving,
                    loading = interaction.saving,
                )
            }
        }
    }
}

@Composable
private fun ProviderSettings(
    form: ConfigFormState,
    onProviderField: (String, String) -> Unit,
) {
    val fields = PROVIDER_FIELDS[form.provider].orEmpty()
    GlassPanel(padding = PanelPadding.Md) {
        FieldLabelText(stringResource(R.string.translation_backup_providerSettings))
        Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            fields.forEach { field ->
                val value = form.providerConfig[field.key].orEmpty()
                val label = humanizeFieldKey(field.key)
                if (field.multiline) {
                    Textarea(
                        value = value,
                        onValueChange = { onProviderField(field.key, it) },
                        modifier = Modifier.fillMaxWidth(),
                        label = label,
                        hint = field.example,
                        required = field.required,
                    )
                } else {
                    Input(
                        value = value,
                        onValueChange = { onProviderField(field.key, it) },
                        modifier = Modifier.fillMaxWidth(),
                        label = label,
                        hint = field.example,
                        required = field.required,
                        visualTransformation = if (field.secret) PasswordVisualTransformation() else VisualTransformation.None,
                    )
                }
            }
        }
    }
}

// ── Delete confirmation ─────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DeleteConfigDialog(
    target: BackupConfig,
    deleting: Boolean,
    actions: BackupRestoreActions,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_backup_deleteConfig),
        message = stringResource(R.string.translation_backup_deleteConfigMessage, target.name),
        confirmLabel = stringResource(R.string.translation_backup_delete),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = actions.onConfirmDelete,
        onCancel = actions.onCancelDelete,
        severity = ConfirmSeverity.Danger,
        loading = deleting,
    )
}

// ── Restore preview modal ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RestorePreviewModal(
    interaction: BackupRestoreInteraction,
    onClose: () -> Unit,
) {
    Modal(
        onDismissRequest = onClose,
        title = stringResource(R.string.translation_backup_restorePreview),
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        val preview = interaction.previewData
        if (preview == null) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl2),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Spinner(size = SpinnerSize.Md)
                BodyText(stringResource(R.string.translation_backup_loadingPreview), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    val color = if (preview.checksumVerified) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                    Icon(BackupGlyphs.ShieldCheck, contentDescription = null, size = IconSize.Sm, tint = color)
                    BodyText(
                        if (preview.checksumVerified) {
                            stringResource(R.string.translation_backup_checksumVerified)
                        } else {
                            stringResource(R.string.translation_backup_checksumFailed)
                        },
                        color = color,
                    )
                }

                if (preview.metadata.isNotEmpty()) {
                    GlassPanel(padding = PanelPadding.Md) {
                        FieldLabelText(stringResource(R.string.translation_backup_metadata))
                        Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            preview.metadata.forEach { (key, value) ->
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Caption(key)
                                    CodeText(value)
                                }
                            }
                        }
                    }
                }

                if (preview.tables.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        FieldLabelText("${stringResource(R.string.translation_backup_tables)} (${preview.tables.size})")
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Caption(stringResource(R.string.translation_backup_table))
                            Caption(stringResource(R.string.translation_backup_rows))
                        }
                        preview.tables.forEach { table ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                CodeText(table.name)
                                BodyText(formatCount(table.rows))
                            }
                        }
                    }
                } else {
                    EmptyState(message = stringResource(R.string.translation_backup_noTables), modifier = Modifier.fillMaxWidth())
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(label = stringResource(R.string.translation_common_close), onClick = onClose, variant = ButtonVariant.Outline)
                }
            }
        }
    }
}

// ── Shared row helpers ──────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LabeledField(
    label: String,
    content: @Composable () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
        Caption(label, modifier = Modifier.width(LABEL_WIDTH))
        Column(modifier = Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun ProviderBadge(provider: String) {
    Badge(text = providerLabel(provider), variant = providerVariant(provider))
}

@Composable
private fun PanelLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(3) { Skeleton(modifier = Modifier.fillMaxWidth(), height = 56.dp, rounded = true) }
    }
}

@Composable
private fun backupTypeOptions(): List<SelectOption> =
    listOf(
        SelectOption(value = BACKUP_TYPE_FULL, label = stringResource(R.string.translation_backup_full)),
        SelectOption(value = "incremental", label = stringResource(R.string.translation_backup_incremental)),
    )

// ── Display-boundary helpers ────────────────────────────────────────────────────────────────────────────────

/** The absolute download URL for a run (web `${getApiBase()}/api/v1/backup/runs/{id}/download`, opened in the browser). */
private fun backupDownloadUrl(runId: Long): String = "${BuildConfig.API_BASE_URL.trimEnd('/')}/api/v1/backup/runs/$runId/download"

/** Locale-aware relative time (web `formatRelative`) — "5 minutes ago" in the device language. */
private fun relativeTime(millis: Long): String =
    DateUtils.getRelativeTimeSpanString(millis, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()

/** Locale-aware absolute date-time for a run's timestamp (web `TimeStamp`). */
private fun absoluteTime(millis: Long): String = RUN_TIME_FORMATTER.format(Instant.ofEpochMilli(millis))

private fun statusGlyph(status: String): ImageVector =
    when (status) {
        RUN_STATUS_COMPLETED -> BackupGlyphs.ShieldCheck
        RUN_STATUS_FAILED -> BackupGlyphs.AlertCircle
        else -> BackupGlyphs.Clock
    }

@Composable
private fun statusColor(status: String): Color =
    when (status) {
        RUN_STATUS_COMPLETED -> MaterialTheme.colorScheme.primary
        RUN_STATUS_FAILED -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun statusVariant(status: String): BadgeVariant =
    when (status) {
        RUN_STATUS_COMPLETED -> BadgeVariant.Success
        RUN_STATUS_FAILED -> BadgeVariant.Danger
        RUN_STATUS_RUNNING -> BadgeVariant.Info
        else -> BadgeVariant.Neutral
    }

private fun runTypeVariant(runType: String): BadgeVariant =
    when (runType) {
        "backup" -> BadgeVariant.Info
        "restore" -> BadgeVariant.Success
        "quick" -> BadgeVariant.Warning
        else -> BadgeVariant.Neutral
    }

private fun providerVariant(provider: String): BadgeVariant =
    when (provider) {
        "s3" -> BadgeVariant.Warning
        "azure" -> BadgeVariant.Info
        "gcs" -> BadgeVariant.Success
        else -> BadgeVariant.Neutral
    }

/** Resolves a one-shot toast i18n key to its localized text (ADR-014 — the render boundary owns the lookup). */
private fun resolveToastMessage(
    context: Context,
    messageKey: String,
): String =
    when (messageKey) {
        BackupRestoreToastKeys.CONFIG_CREATED -> context.getString(R.string.translation_backup_configCreated)
        BackupRestoreToastKeys.CONFIG_CREATE_FAILED -> context.getString(R.string.translation_backup_configCreateFailed)
        BackupRestoreToastKeys.CONFIG_UPDATED -> context.getString(R.string.translation_backup_configUpdated)
        BackupRestoreToastKeys.CONFIG_UPDATE_FAILED -> context.getString(R.string.translation_backup_configUpdateFailed)
        BackupRestoreToastKeys.CONFIG_DELETED -> context.getString(R.string.translation_backup_configDeleted)
        BackupRestoreToastKeys.CONFIG_DELETE_FAILED -> context.getString(R.string.translation_backup_configDeleteFailed)
        BackupRestoreToastKeys.TRIGGERED -> context.getString(R.string.translation_backup_triggered)
        BackupRestoreToastKeys.TRIGGER_FAILED -> context.getString(R.string.translation_backup_triggerFailed)
        BackupRestoreToastKeys.QUICK_STARTED -> context.getString(R.string.translation_backup_quickStarted)
        BackupRestoreToastKeys.QUICK_FAILED -> context.getString(R.string.translation_backup_quickFailed)
        BackupRestoreToastKeys.CHECKSUM_VERIFIED -> context.getString(R.string.translation_backup_checksumVerified)
        BackupRestoreToastKeys.CHECKSUM_MISMATCH -> context.getString(R.string.translation_backup_checksumMismatch)
        BackupRestoreToastKeys.VERIFY_FAILED -> context.getString(R.string.translation_backup_verifyFailed)
        else -> context.getString(R.string.translation_backup_previewFailed)
    }

private fun toneOf(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

// ── Previews — one per rendered state ───────────────────────────────────────────────────────────────────────

private fun sampleConfigs(): JsonElement =
    buildJsonArray {
        add(
            buildJsonObject {
                put("id", 1)
                put("name", "Daily full backup")
                put("enabled", true)
                put("backup_type", "full")
                put("frequency_days", 1)
                put("max_retention", 7)
                put("provider", "s3")
                put("compress", true)
                put("encrypt", true)
            },
        )
    }

private fun sampleRuns(): JsonElement =
    buildJsonArray {
        add(
            buildJsonObject {
                put("id", 11)
                put("run_type", "backup")
                put("status", "completed")
                put("provider", "s3")
                put("file_name", "backup-2024.tar.gz")
                put("file_size", 50_855_936L)
                put("record_count", 12_400L)
                put("duration_ms", 84_000L)
            },
        )
    }

private fun previewUiState(
    data: JsonElement,
    phase: io.teslasync.android.data.UiPhase,
): UiState<JsonElement> = UiState(phase = phase, data = data, fetchedAt = 1L)

@Composable
private fun PreviewHost(
    configsState: UiState<JsonElement>,
    runsState: UiState<JsonElement>,
    interaction: BackupRestoreInteraction = BackupRestoreInteraction(),
) {
    TeslaSyncTheme(dynamicColor = false) {
        BackupRestorePageContent(
            configsState = configsState,
            runsState = runsState,
            interaction = interaction,
            actions = previewActions(),
            toasts = emptyList(),
            onToastDismiss = {},
        )
    }
}

private fun previewActions(): BackupRestoreActions =
    BackupRestoreActions(
        onRefresh = {}, onRetry = {}, onQuickBackup = {}, onNewConfig = {}, onEditConfig = {}, onDeleteConfig = {},
        onTrigger = {}, onDownload = {}, onVerify = {}, onPreview = {}, onCloseModal = {}, onSave = {}, onFormName = {},
        onFormEnabled = {}, onFormBackupType = {}, onFormProvider = {}, onFormFrequency = {}, onFormRetention = {},
        onFormCompress = {}, onFormEncrypt = {}, onProviderField = { _, _ -> }, onCancelDelete = {}, onConfirmDelete = {},
        onClosePreview = {},
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun BackupRestoreContentPreview() {
    PreviewHost(
        configsState = previewUiState(sampleConfigs(), io.teslasync.android.data.UiPhase.Content),
        runsState = previewUiState(sampleRuns(), io.teslasync.android.data.UiPhase.Content),
    )
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun BackupRestoreEmptyPreview() {
    val empty = previewUiState(JsonArray(emptyList()), io.teslasync.android.data.UiPhase.Empty)
    PreviewHost(configsState = empty, runsState = empty)
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun BackupRestoreLoadingPreview() {
    PreviewHost(configsState = UiState.loading(), runsState = UiState.loading())
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun BackupRestoreErrorPreview() {
    val error: UiState<JsonElement> = UiState(phase = io.teslasync.android.data.UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network)
    PreviewHost(configsState = error, runsState = error)
}
