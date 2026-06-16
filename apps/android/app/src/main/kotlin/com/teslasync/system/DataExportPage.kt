// The native Jetpack Compose + Material 3 DataExportPage system surface — a parity port of
// web/src/features/system/pages/DataExportPage.tsx, the data-export console. It reproduces the page's panels
// (the four stat tiles, the GDPR account-export panel, the four-step export wizard incl. the column picker, the
// CSV/JSON format-info cards, the data-overview card, the export-history panel, and the scheduled-exports
// feature panel), every data state (loading / empty / error / content), and every visible string (resolved from
// the generated res/values catalog, ADR-014).
//
// Composition: [DataExportPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feeds + interaction snapshots, and turns the
// view-model's one-shot events into bottom toasts); [DataExportPageContent] is the stateless render layer driven
// entirely by [UiState] + the wizard/account snapshots + [DataExportActions]. All derivation lives in the
// framework-free model (DataExportPageModel.kt); this file only resolves i18n + draws. Byte sizes / relative
// times are formatted at this render boundary (S5); the page never stores or computes a non-SI value.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.system.dataexport

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.feedback.formatBytes
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val FADE_STEP_MS = 40
private const val TOAST_SEPARATOR = " \u2014 "

/** The page's interaction callbacks, wired to the [DataExportPageViewModel] (web event handlers). */
data class DataExportActions(
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
    val onSelectType: (ExportType) -> Unit,
    val onSelectFormat: (ExportFormat) -> Unit,
    val onSelectVehicle: (String) -> Unit,
    val onSelectPreset: (Int) -> Unit,
    val onToggleCustomRange: () -> Unit,
    val onCustomStart: (String) -> Unit,
    val onCustomEnd: (String) -> Unit,
    val onToggleColumn: (String) -> Unit,
    val onSelectAllColumns: () -> Unit,
    val onClearColumns: () -> Unit,
    val onSubmit: () -> Unit,
    val onAccountVehicle: (String) -> Unit,
    val onAccountStart: (String) -> Unit,
    val onAccountEnd: (String) -> Unit,
    val onAccountSubmit: () -> Unit,
    val onDownload: (ExportJobSummary) -> Unit,
)

/** Immutable bundle of the wizard/account snapshots + the two in-flight flags the content layer renders. */
data class DataExportForms(
    val wizard: DataExportWizard,
    val account: AccountExportForm,
    val columns: UiState<ExportColumnsResponse>,
    val submitting: Boolean,
    val accountSubmitting: Boolean,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DataExportPageViewModel] over the supplied [source] (the host wires the shared
 * S8 [io.teslasync.shared.core.presentation.exports.ExportsStore] + Vehicles holder via [bindDataExportSource]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun DataExportPage(
    source: DataExportSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DataExportPageViewModel =
        viewModel(
            key = DataExportPageRegistration.SLUG,
            factory = DataExportPageViewModel.factory(source, logger),
        )
    DataExportPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshots to the stateless content + toast host. */
@Composable
fun DataExportPage(
    viewModel: DataExportPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val columns by viewModel.columns.collectAsStateWithLifecycle()
    val wizard by viewModel.wizard.collectAsStateWithLifecycle()
    val account by viewModel.account.collectAsStateWithLifecycle()
    val submitting by viewModel.submitting.collectAsStateWithLifecycle()
    val accountSubmitting by viewModel.accountSubmitting.collectAsStateWithLifecycle()

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
        remember(viewModel, context) {
            DataExportActions(
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
                onSelectType = viewModel::setExportType,
                onSelectFormat = viewModel::setExportFormat,
                onSelectVehicle = viewModel::setWizardVehicle,
                onSelectPreset = viewModel::setPreset,
                onToggleCustomRange = viewModel::toggleCustomRange,
                onCustomStart = viewModel::setCustomStart,
                onCustomEnd = viewModel::setCustomEnd,
                onToggleColumn = viewModel::toggleColumnSelection,
                onSelectAllColumns = viewModel::selectAllColumns,
                onClearColumns = viewModel::clearColumns,
                onSubmit = viewModel::submitExport,
                onAccountVehicle = viewModel::setAccountVehicle,
                onAccountStart = viewModel::setAccountStart,
                onAccountEnd = viewModel::setAccountEnd,
                onAccountSubmit = viewModel::startAccountExport,
                onDownload = { job -> openDownload(context, job.id) },
            )
        }

    val forms =
        DataExportForms(
            wizard = wizard,
            account = account,
            columns = columns,
            submitting = submitting,
            accountSubmitting = accountSubmitting,
        )

    Box(modifier = modifier.fillMaxWidth()) {
        DataExportPageContent(state = state, forms = forms, actions = actions)
        ToastHost(toasts = toasts, onDismiss = { id -> toasts = dismissToast(toasts, id) }, modifier = Modifier.fillMaxWidth())
    }
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, then the loading / error / content surface. */
@Composable
fun DataExportPageContent(
    state: UiState<DataExportData>,
    forms: DataExportForms,
    actions: DataExportActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data ?: DataExportData.EMPTY
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DataExportHeader(onRefresh = actions.onRefresh)

        when {
            state.isLoading ->
                Spinner(
                    modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
                    size = SpinnerSize.Lg,
                    label = stringResource(R.string.translation_common_loading),
                )

            state.isError ->
                AlertBanner(
                    message = stringResource(R.string.translation_error_loadFailed),
                    tone = Tone.Danger,
                    icon = DataExportGlyphs.AlertCircle,
                    action = BannerAction(stringResource(R.string.translation_error_retry), actions.onRetry),
                )

            else -> DataExportBody(data = data, forms = forms, actions = actions, offline = state.isOffline)
        }
    }
}

/** The full content stack rendered once the jobs + vehicles feed resolves (web `PageContainer` children). */
@Composable
private fun DataExportBody(
    data: DataExportData,
    forms: DataExportForms,
    actions: DataExportActions,
    offline: Boolean,
) {
    if (offline) {
        AlertBanner(
            message = stringResource(R.string.translation_common_offline),
            tone = Tone.Warning,
            icon = DataExportGlyphs.AlertCircle,
            action = BannerAction(stringResource(R.string.translation_error_retry), actions.onRetry),
        )
    }
    FadeIn { StatsRow(jobs = data.jobs) }
    FadeIn(delayMs = FADE_STEP_MS) { AccountExportPanel(vehicles = data.vehicles, form = forms.account, submitting = forms.accountSubmitting, actions = actions) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { ExportWizard(vehicles = data.vehicles, wizard = forms.wizard, columns = forms.columns, submitting = forms.submitting, actions = actions) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { FormatInfoCards() }
    FadeIn(delayMs = FADE_STEP_MS * 4) { DataOverviewCard(jobs = data.jobs) }
    FadeIn(delayMs = FADE_STEP_MS * 5) { ExportHistoryPanel(jobs = data.jobs, vehicles = data.vehicles, actions = actions) }
    FadeIn(delayMs = FADE_STEP_MS * 6) { ScheduledFeaturePanel() }
}

@Composable
private fun DataExportHeader(onRefresh: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_dataExport_title))
            BodyText(
                stringResource(R.string.translation_dataExport_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(R.string.translation_dataExport_refresh),
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = DataExportGlyphs.Refresh,
        )
    }
}

// ── Stats row (Total-Exports / Total-Size / Most-Exported / Last-Export) ────────────────────────────────────

@Composable
private fun StatsRow(jobs: List<ExportJobSummary>) {
    val context = LocalContext.current
    val locale = currentLocale()
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    val stats = remember(jobs) { exportStats(jobs) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_Total_Exports),
                value = numbers.format(stats.totalExports.toLong()),
                modifier = Modifier.weight(1f),
                icon = DataExportGlyphs.Package,
            )
            StatCard(
                label = stringResource(R.string.translation_Total_Size),
                value = formatBytes(stats.totalSizeBytes.takeIf { it > 0L }) ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = DataExportGlyphs.HardDrive,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_Most_Exported),
                value = stats.mostExportedType,
                modifier = Modifier.weight(1f),
                icon = DataExportGlyphs.BarChart,
                sublabel = stringResource(R.string.translation_By_Count),
            )
            StatCard(
                label = stringResource(R.string.translation_Last_Export),
                value = relativeTime(context, stats.mostRecentCreatedAt),
                modifier = Modifier.weight(1f),
                icon = DataExportGlyphs.Clock,
            )
        }
    }
}

// ── Account export panel (GlassPanel1) ──────────────────────────────────────────────────────────────────────

@Composable
private fun AccountExportPanel(
    vehicles: List<Vehicle>,
    form: AccountExportForm,
    submitting: Boolean,
    actions: DataExportActions,
) {
    GlassPanel(accent = PanelAccent.Info) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
            Icon(DataExportGlyphs.Package, contentDescription = null, size = IconSize.Lg, tint = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(stringResource(R.string.translation_dataExport_account_title))
                BodyText(
                    stringResource(R.string.translation_dataExport_account_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val options = accountVehicleOptions(vehicles, stringResource(R.string.translation_dataExport_account_allVehicles))
            Select(
                options = options,
                selectedValue = form.vehicleId,
                onSelect = actions.onAccountVehicle,
                label = stringResource(R.string.translation_dataExport_account_vehicle),
            )
            Input(
                value = form.startDate,
                onValueChange = actions.onAccountStart,
                label = stringResource(R.string.translation_dataExport_account_startDate),
            )
            Input(
                value = form.endDate,
                onValueChange = actions.onAccountEnd,
                label = stringResource(R.string.translation_dataExport_account_endDate),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(DataExportGlyphs.AlertCircle, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            HelperText(stringResource(R.string.translation_dataExport_account_warning), modifier = Modifier.weight(1f))
            Button(
                label = stringResource(R.string.translation_dataExport_account_start),
                onClick = actions.onAccountSubmit,
                loading = submitting,
                leadingIcon = DataExportGlyphs.Download,
            )
        }
    }
}

// ── Export wizard (GlassPanel2) ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun ExportWizard(
    vehicles: List<Vehicle>,
    wizard: DataExportWizard,
    columns: UiState<ExportColumnsResponse>,
    submitting: Boolean,
    actions: DataExportActions,
) {
    GlassPanel(accent = PanelAccent.Info) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(DataExportGlyphs.FileDown, contentDescription = null, size = IconSize.Lg, tint = MaterialTheme.colorScheme.primary)
            SectionTitle(stringResource(R.string.translation_dataExport_wizardTitle))
        }
        WizardStep(title = stringResource(R.string.translation_dataExport_wizard_step1)) {
            ExportTypeSelector(selected = wizard.exportType, onSelect = actions.onSelectType)
        }
        WizardStep(title = stringResource(R.string.translation_dataExport_wizard_step2)) {
            FormatSelector(selected = wizard.exportFormat, onSelect = actions.onSelectFormat)
        }
        ColumnPickerSection(exportType = wizard.exportType, selectedColumns = wizard.selectedColumns, columns = columns, actions = actions)
        if (vehicles.isNotEmpty()) {
            WizardStep(title = stringResource(R.string.translation_dataExport_wizard_step3)) {
                Select(
                    options = wizardVehicleOptions(vehicles, stringResource(R.string.translation_All_Vehicles)),
                    selectedValue = wizard.vehicleId,
                    onSelect = actions.onSelectVehicle,
                    emptyLabel = stringResource(R.string.translation_dataExport_allVehicles),
                )
            }
        }
        WizardStep(title = stringResource(R.string.translation_dataExport_wizard_step4)) {
            DatePresetSelector(selected = wizard.presetDays, useCustom = wizard.useCustomRange, onSelect = actions.onSelectPreset)
            Button(
                label = stringResource(R.string.translation_dataExport_customRange),
                onClick = actions.onToggleCustomRange,
                variant = if (wizard.useCustomRange) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataExportGlyphs.Calendar,
                modifier = Modifier.padding(top = Spacing.sm),
            )
            if (wizard.useCustomRange) {
                CustomDateRange(start = wizard.customStart, end = wizard.customEnd, onStart = actions.onCustomStart, onEnd = actions.onCustomEnd)
            }
        }
        Button(
            label = stringResource(R.string.translation_Start_Export),
            onClick = actions.onSubmit,
            size = ButtonSize.Lg,
            loading = submitting,
            leadingIcon = DataExportGlyphs.Download,
            modifier = Modifier.padding(top = Spacing.sm),
        )
    }
}

@Composable
private fun WizardStep(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.padding(top = Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(title)
        content()
    }
}

@Composable
private fun ExportTypeSelector(
    selected: ExportType,
    onSelect: (ExportType) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ExportType.entries.forEach { type ->
            val label = stringResource(typeLabelRes(type))
            val active = type == selected
            GlassPanel(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .selectable(selected = active, role = Role.RadioButton) { onSelect(type) }
                        .semantics { contentDescription = label },
                padding = PanelPadding.Sm,
                accent = if (active) type.accent() else PanelAccent.None,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        type.glyph(),
                        contentDescription = null,
                        size = IconSize.Md,
                        tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        BodyText(label)
                        HelperText(stringResource(typeDescRes(type)))
                    }
                    if (active) {
                        Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

@Composable
private fun FormatSelector(
    selected: ExportFormat,
    onSelect: (ExportFormat) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Button(
            label = stringResource(R.string.translation_dataExport_formats_csv),
            onClick = { onSelect(ExportFormat.Csv) },
            variant = if (selected == ExportFormat.Csv) ButtonVariant.Primary else ButtonVariant.Outline,
            leadingIcon = DataExportGlyphs.FileSpreadsheet,
        )
        Button(
            label = stringResource(R.string.translation_dataExport_formats_json),
            onClick = { onSelect(ExportFormat.Json) },
            variant = if (selected == ExportFormat.Json) ButtonVariant.Primary else ButtonVariant.Outline,
            leadingIcon = DataExportGlyphs.FileJson,
        )
    }
}

@Composable
private fun DatePresetSelector(
    selected: Int,
    useCustom: Boolean,
    onSelect: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DatePreset.entries.forEach { preset ->
            val active = !useCustom && preset.days == selected
            Button(
                label = stringResource(presetLabelRes(preset)),
                onClick = { onSelect(preset.days) },
                variant = if (active) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun CustomDateRange(
    start: String,
    end: String,
    onStart: (String) -> Unit,
    onEnd: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Input(value = start, onValueChange = onStart, label = stringResource(R.string.translation_Start), modifier = Modifier.weight(1f))
        Input(value = end, onValueChange = onEnd, label = stringResource(R.string.translation_End), modifier = Modifier.weight(1f))
    }
}

// ── Column picker (GlassPanel10) ────────────────────────────────────────────────────────────────────────────

@Composable
private fun ColumnPickerSection(
    exportType: ExportType,
    selectedColumns: List<String>?,
    columns: UiState<ExportColumnsResponse>,
    actions: DataExportActions,
) {
    val catalogType = catalogTypeFor(exportType)
    if (catalogType.isEmpty()) return
    if (columns.isLoading) {
        WizardStep(title = stringResource(R.string.translation_dataExport_columns_title)) {
            Spinner(size = SpinnerSize.Sm)
        }
        return
    }
    if (columns.hasError) return
    val catalog = columns.data ?: return
    if (!supportsColumnPicker(catalogType, catalog)) return

    val all = allColumnNames(catalog)
    val required = requiredColumnNames(catalog)
    val effective = effectiveSelectedColumns(selectedColumns, all).toSet()
    val allSelected = isAllColumnsSelected(selectedColumns, all)

    WizardStep(title = stringResource(R.string.translation_dataExport_columns_title)) {
        GlassPanel(padding = PanelPadding.Md) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HelperText(stringResource(R.string.translation_dataExport_columns_helperText), modifier = Modifier.weight(1f))
                Button(
                    label = stringResource(R.string.translation_dataExport_columns_selectAll),
                    onClick = actions.onSelectAllColumns,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled = !allSelected,
                )
                Button(
                    label = stringResource(R.string.translation_dataExport_columns_clear),
                    onClick = actions.onClearColumns,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
            Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                catalog.columns.forEach { col ->
                    val isRequired = col.name in required
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = col.name in effective,
                            onCheckedChange = if (isRequired) null else { _ -> actions.onToggleColumn(col.name) },
                            label = col.label,
                            enabled = !isRequired,
                            modifier = Modifier.weight(1f),
                        )
                        if (isRequired) {
                            Badge(text = stringResource(R.string.translation_dataExport_columns_alwaysIncluded), variant = BadgeVariant.Warning)
                        }
                    }
                }
            }
        }
    }
}

// ── Format info cards (GlassPanel3 + GlassPanel4) ───────────────────────────────────────────────────────────

@Composable
private fun FormatInfoCards() {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        FormatInfoCard(
            modifier = Modifier.weight(1f),
            accent = PanelAccent.Info,
            glyph = DataExportGlyphs.FileSpreadsheet,
            title = stringResource(R.string.translation_dataExport_csvPreview),
            description = stringResource(R.string.translation_dataExport_csvDesc),
            sample = CSV_SAMPLE,
        )
        FormatInfoCard(
            modifier = Modifier.weight(1f),
            accent = PanelAccent.Primary,
            glyph = DataExportGlyphs.FileJson,
            title = stringResource(R.string.translation_dataExport_jsonPreview),
            description = stringResource(R.string.translation_dataExport_jsonDesc),
            sample = JSON_SAMPLE,
        )
    }
}

@Composable
private fun FormatInfoCard(
    accent: PanelAccent,
    glyph: ImageVector,
    title: String,
    description: String,
    sample: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, accent = accent, padding = PanelPadding.Sm) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(glyph, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
            PanelTitle(title)
        }
        BodyText(description, modifier = Modifier.padding(top = Spacing.xs), color = MaterialTheme.colorScheme.onSurfaceVariant)
        CodeText(sample, modifier = Modifier.padding(top = Spacing.sm))
    }
}

// ── Data overview card (GlassPanel9) ────────────────────────────────────────────────────────────────────────

@Composable
private fun DataOverviewCard(jobs: List<ExportJobSummary>) {
    val locale = currentLocale()
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    val overview = remember(jobs) { dataOverview(jobs) }
    GlassPanel {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(DataExportGlyphs.Database, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
            PanelTitle(stringResource(R.string.translation_dataExport_dataOverview))
        }
        if (overview.drives == 0L && overview.chargingSessions == 0L) {
            HelperText(stringResource(R.string.translation_dataExport_unavailable), modifier = Modifier.padding(top = Spacing.sm))
        } else {
            Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OverviewRow(glyph = DataExportGlyphs.Car, value = numbers.format(overview.drives), label = stringResource(R.string.translation_dataExport_drives))
                OverviewRow(glyph = DataExportGlyphs.Bolt, value = numbers.format(overview.chargingSessions), label = stringResource(R.string.translation_dataExport_chargingSessions))
            }
        }
    }
}

@Composable
private fun OverviewRow(
    glyph: ImageVector,
    value: String,
    label: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Icon(glyph, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText("$value $label", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Export history (GlassPanel11) ───────────────────────────────────────────────────────────────────────────

@Composable
private fun ExportHistoryPanel(
    jobs: List<ExportJobSummary>,
    vehicles: List<Vehicle>,
    actions: DataExportActions,
) {
    val activeJobs = remember(jobs) { activeJobCount(jobs) }
    val vehicleMap = remember(vehicles) { vehicles.associate { it.id to vehicleLabel(it) } }
    GlassPanel(padding = PanelPadding.None) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringResource(R.string.translation_dataExport_exportHistory))
            if (activeJobs > 0) {
                Badge(
                    text = "$activeJobs ${stringResource(R.string.translation_dataExport_active)}",
                    variant = BadgeVariant.Info,
                    dot = true,
                )
            }
            Box(modifier = Modifier.weight(1f))
            Button(
                label = stringResource(R.string.translation_dataExport_refresh),
                onClick = actions.onRefresh,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataExportGlyphs.Refresh,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (jobs.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_dataExport_noExportsMessage),
                icon = DataExportGlyphs.FileDown,
                title = stringResource(R.string.translation_dataExport_noExports),
            )
        } else {
            Column(modifier = Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                jobs.forEach { job ->
                    JobRow(job = job, vehicleName = job.vehicleId?.let { vehicleMap[it] ?: "#$it" }, onDownload = actions.onDownload)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                // Defensive empty caption mirroring the web DataTable `emptyMessage` (unreachable while jobs exist).
                if (jobs.isEmpty()) Caption(stringResource(R.string.translation_dataExport_noJobs))
            }
        }
    }
}

@Composable
private fun JobRow(
    job: ExportJobSummary,
    vehicleName: String?,
    onDownload: (ExportJobSummary) -> Unit,
) {
    val context = LocalContext.current
    val locale = currentLocale()
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    val type = remember(job.type) { ExportType.entries.firstOrNull { it.wire == job.type } }
    val format = remember(job.format) { ExportFormat.entries.firstOrNull { it.wire == job.format } }
    val status = remember(job.status) { ExportStatus.fromWire(job.status) }

    val typeLabel = type?.let { stringResource(typeLabelRes(it)) } ?: job.type
    val formatLabel = format?.let { stringResource(formatLabelRes(it)) } ?: job.format.uppercase(locale)
    val statusLabel = if (status == ExportStatus.Unknown) job.status else stringResource(statusLabelRes(status))

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            val typeHeader = stringResource(R.string.translation_Type)
            val formatHeader = stringResource(R.string.translation_Format)
            val statusHeader = stringResource(R.string.translation_Status)
            Badge(
                text = typeLabel,
                variant = (type?.badgeVariant() ?: BadgeVariant.Neutral),
                modifier = Modifier.semantics { contentDescription = "$typeHeader: $typeLabel" },
            )
            Badge(
                text = formatLabel.uppercase(locale),
                variant = (format?.badgeVariant() ?: BadgeVariant.Neutral),
                modifier = Modifier.semantics { contentDescription = "$formatHeader: $formatLabel" },
            )
            Badge(
                text = statusLabel,
                variant = status.badgeVariant(),
                modifier = Modifier.semantics { contentDescription = "$statusHeader: $statusLabel" },
            )
        }
        JobField(label = stringResource(R.string.translation_Vehicle), value = vehicleName ?: EM_DASH)
        JobField(label = stringResource(R.string.translation_Records), value = job.recordCount?.let { numbers.format(it) } ?: EM_DASH)
        JobField(label = stringResource(R.string.translation_Size), value = formatBytes(job.fileSize?.takeIf { it > 0L }) ?: EM_DASH)
        JobField(label = stringResource(R.string.translation_Duration), value = formatDuration(job.durationMs))
        JobField(label = stringResource(R.string.translation_Time), value = relativeTime(context, job.createdAt.takeIf { it.isNotBlank() }))
        when {
            status == ExportStatus.Ready ->
                Button(
                    label = stringResource(R.string.translation_Download),
                    onClick = { onDownload(job) },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = DataExportGlyphs.Download,
                )
            status == ExportStatus.Failed && !job.errorMessage.isNullOrBlank() ->
                ErrorText(job.errorMessage ?: "")
        }
    }
}

@Composable
private fun JobField(
    label: String,
    value: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Caption(label, modifier = Modifier.weight(1f))
        BodyText(value, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Scheduled exports feature panel (GlassPanel12) ──────────────────────────────────────────────────────────

@Composable
private fun ScheduledFeaturePanel() {
    GlassPanel {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(DataExportGlyphs.Calendar, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
            PanelTitle(stringResource(R.string.translation_dataExport_scheduled_feature))
        }
        BodyText(
            stringResource(R.string.translation_dataExport_scheduled_subtitle),
            modifier = Modifier.padding(top = Spacing.sm),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun currentLocale(): Locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT

private fun accountVehicleOptions(
    vehicles: List<Vehicle>,
    allLabel: String,
): List<SelectOption> =
    buildList {
        add(SelectOption(ACCOUNT_ALL_VEHICLES, allLabel))
        vehicles.forEach { add(SelectOption(it.id.toString(), vehicleLabel(it))) }
    }

private fun wizardVehicleOptions(
    vehicles: List<Vehicle>,
    allLabel: String,
): List<SelectOption> =
    buildList {
        add(SelectOption("", allLabel))
        vehicles.forEach { add(SelectOption(it.id.toString(), vehicleLabel(it))) }
    }

private fun typeLabelRes(type: ExportType): Int =
    when (type) {
        ExportType.Drives -> R.string.translation_dataExport_types_drives
        ExportType.Charging -> R.string.translation_dataExport_types_charging
        ExportType.Trips -> R.string.translation_dataExport_types_trips
        ExportType.Analytics -> R.string.translation_dataExport_types_analytics
        ExportType.FullBackup -> R.string.translation_dataExport_types_fullBackup
        ExportType.Maintenance -> R.string.translation_dataExport_types_maintenance
        ExportType.Energy -> R.string.translation_dataExport_types_energy
    }

private fun typeDescRes(type: ExportType): Int =
    when (type) {
        ExportType.Drives -> R.string.translation_dataExport_types_drivesDesc
        ExportType.Charging -> R.string.translation_dataExport_types_chargingDesc
        ExportType.Trips -> R.string.translation_dataExport_types_tripsDesc
        ExportType.Analytics -> R.string.translation_dataExport_types_analyticsDesc
        ExportType.FullBackup -> R.string.translation_dataExport_types_fullBackupDesc
        ExportType.Maintenance -> R.string.translation_dataExport_types_maintenanceDesc
        ExportType.Energy -> R.string.translation_dataExport_types_energyDesc
    }

private fun formatLabelRes(format: ExportFormat): Int =
    when (format) {
        ExportFormat.Csv -> R.string.translation_dataExport_formats_csv
        ExportFormat.Json -> R.string.translation_dataExport_formats_json
    }

private fun statusLabelRes(status: ExportStatus): Int =
    when (status) {
        ExportStatus.Queued -> R.string.translation_dataExport_status_queued
        ExportStatus.Processing -> R.string.translation_dataExport_status_processing
        ExportStatus.Ready -> R.string.translation_dataExport_status_ready
        ExportStatus.Failed -> R.string.translation_dataExport_status_failed
        ExportStatus.Expired -> R.string.translation_dataExport_status_expired
        ExportStatus.Unknown -> R.string.translation_dataExport_status_queued
    }

private fun presetLabelRes(preset: DatePreset): Int =
    when (preset) {
        DatePreset.Last7 -> R.string.translation_dataExport_presets_last7
        DatePreset.Last30 -> R.string.translation_dataExport_presets_last30
        DatePreset.Last90 -> R.string.translation_dataExport_presets_last90
        DatePreset.LastYear -> R.string.translation_dataExport_presets_lastYear
        DatePreset.AllTime -> R.string.translation_dataExport_presets_allTime
    }

private fun toneOf(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

private fun resolveToastMessage(
    context: Context,
    event: UiEvent.Message,
): String =
    when (event.messageKey) {
        EXPORT_STARTED_KEY ->
            context.getString(R.string.translation_Export_Started) + TOAST_SEPARATOR + context.getString(R.string.translation_Export_Started_Msg)
        EXPORT_FAILED_KEY ->
            context.getString(R.string.translation_Export_Failed) + TOAST_SEPARATOR + context.getString(R.string.translation_Export_Failed_Msg)
        else -> context.getString(R.string.translation_Export_Failed_Msg)
    }

/** Relative "x ago" stamp for an ISO instant (web `formatRelative`); null/unparseable → em-dash. */
private fun relativeTime(
    context: Context,
    iso: String?,
): String {
    val millis = iso?.let { parseInstantMillis(it) } ?: return EM_DASH
    return DateUtils
        .getRelativeTimeSpanString(millis, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
        .toString()
}

private fun parseInstantMillis(iso: String): Long? =
    runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()

/** Humanizes a whole-millisecond duration (web `formatDurationMsLong`); null → em-dash. */
private fun formatDuration(ms: Long?): String {
    if (ms == null || ms < 0L) return EM_DASH
    if (ms < MILLIS_PER_SECOND) return "${ms}ms"
    val totalSeconds = ms / MILLIS_PER_SECOND
    val minutes = totalSeconds / SECONDS_PER_MINUTE
    val seconds = totalSeconds % SECONDS_PER_MINUTE
    return if (minutes > 0) "${minutes}m ${seconds}s" else "${seconds}s"
}

private fun openDownload(
    context: Context,
    jobId: String,
) {
    val base = BuildConfig.API_BASE_URL.trimEnd('/')
    val url = "$base/api/v1/export/jobs/$jobId/download"
    runCatching {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}

private const val MILLIS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60L

private const val CSV_SAMPLE = "date,distance_m,efficiency_wh_per_m\n2025-01-15,45200,0.152\n2025-01-16,32800,0.148"
private const val JSON_SAMPLE = "[{ \"date\": \"2025-01-15\",\n   \"distance_m\": 45200,\n   \"efficiency\": 152 }]"
