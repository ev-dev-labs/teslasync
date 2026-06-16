// The native Jetpack Compose + Material 3 SystemStatusPage system surface — a parity port of
// web/src/features/system/pages/SystemStatusPage.tsx, the operator-grade health dashboard. It reproduces the
// page's sections (the overall-health hero, the Health summary rows, and the Services / Database / Telemetry /
// Tesla-auth / Notifications / Workers / Backups / Tesla-API-usage / Recent-errors / System-info panels), every
// data state (loading / empty / error / content), and every visible string (resolved from the generated
// res/values catalog, ADR-014).
//
// Composition: [SystemStatusPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the combined feed); [SystemStatusPageContent] is the
// stateless render layer driven entirely by [UiState] + [SystemStatusActions]. All derivation lives in the
// framework-free model (SystemStatusPageModel.kt); this file only resolves i18n + draws. The seven shared reads
// are bound through the view-model (P1/S8); no HTTP touches the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.system.systemstatus

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

/** The page's interaction callbacks, wired to the [SystemStatusPageViewModel] (web event handlers). */
data class SystemStatusActions(
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

private const val FADE_STEP_MS = 40

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SystemStatusPageViewModel] over the supplied [source] (the host wires the four
 * shared Admin reads + Settings auth + a page-local Notifications holder + the Vehicles list). [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun SystemStatusPage(
    source: SystemStatusSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SystemStatusPageViewModel =
        viewModel(
            key = SystemStatusPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SystemStatusPageViewModel(source, logger) } },
        )
    SystemStatusPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] combined feed to the stateless content. */
@Composable
fun SystemStatusPage(
    viewModel: SystemStatusPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            SystemStatusActions(
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }

    SystemStatusPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, then the phase-appropriate surface (loading / empty / error / content). */
@Composable
fun SystemStatusPageContent(
    state: UiState<SystemStatusData>,
    actions: SystemStatusActions,
    modifier: Modifier = Modifier,
) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SystemStatusHeader(refreshing = state.refreshing, onRefresh = actions.onRefresh)

        when (state.phase) {
            io.teslasync.android.data.UiPhase.Loading -> SystemStatusLoadingState()
            io.teslasync.android.data.UiPhase.Error -> SystemStatusErrorState(onRetry = actions.onRetry)
            io.teslasync.android.data.UiPhase.Empty -> SystemStatusEmptyState()
            io.teslasync.android.data.UiPhase.Content ->
                SystemStatusContent(
                    data = state.data ?: SystemStatusData.EMPTY,
                    offline = state.isOffline,
                    numbers = numbers,
                    locale = locale,
                    actions = actions,
                )
        }
    }
}

@Composable
private fun SystemStatusHeader(
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    val refreshShortcut = stringResource(R.string.translation_Refresh__R_)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_System_Status), modifier = Modifier.semantics { heading() })
            BodyText(
                stringResource(R.string.translation_At_a_glance_health_for_your_TeslaSync_instance),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(R.string.translation_Refresh),
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            loading = refreshing,
            leadingIcon = SystemStatusGlyphs.RefreshCw,
            modifier = Modifier.semantics { contentDescription = refreshShortcut },
        )
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SystemStatusLoadingState() {
    GlassPanel {
        Box(modifier = Modifier.fillMaxWidth().padding(Spacing.xl2), contentAlignment = Alignment.Center) {
            Spinner(size = SpinnerSize.Lg)
        }
    }
}

@Composable
private fun SystemStatusEmptyState() {
    GlassPanel {
        EmptyState(
            message = stringResource(R.string.translation_No_data),
            icon = SystemStatusGlyphs.Activity,
        )
    }
}

@Composable
private fun SystemStatusErrorState(onRetry: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_No_data),
        tone = Tone.Danger,
        icon = SystemStatusGlyphs.AlertTriangle,
        action = BannerAction(stringResource(R.string.translation_Run_health_check), onRetry),
    )
}

// ── Content (success) ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SystemStatusContent(
    data: SystemStatusData,
    offline: Boolean,
    numbers: NumberFormat,
    locale: Locale,
    actions: SystemStatusActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (offline) {
            AlertBanner(
                message = stringResource(R.string.translation_No_data),
                tone = Tone.Warning,
                icon = SystemStatusGlyphs.AlertTriangle,
                action = BannerAction(stringResource(R.string.translation_Refresh), actions.onRetry),
            )
        }
        if (data.maintenanceActive) {
            MaintenanceBanner()
        }
        FadeIn { HealthSummaryPanel(data = data, numbers = numbers, onRunCheck = actions.onRefresh) }
        FadeIn(delayMs = FADE_STEP_MS) { ServicesPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { DatabasePanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { TelemetryPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { TeslaAuthPanel(data = data) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { NotificationsPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { WorkersPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { BackupsPanel(data = data, numbers = numbers) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { TeslaApiUsagePanel(data = data) }
        FadeIn(delayMs = FADE_STEP_MS * 9) { RecentErrorsPanel() }
        FadeIn(delayMs = FADE_STEP_MS * 10) { SystemInfoPanel(data = data) }
        FadeIn(delayMs = FADE_STEP_MS * 11) { StatusApiPanel() }
    }
}

@Composable
private fun MaintenanceBanner() {
    AlertBanner(
        title = stringResource(R.string.translation_Maintenance_mode_is_active),
        message = stringResource(R.string.translation_System_is_in_operator_set_maintenance_mode),
        tone = Tone.Info,
    )
}

@Composable
private fun HealthSummaryPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
    onRunCheck: () -> Unit,
) {
    SectionCard(title = stringResource(R.string.translation_Health), icon = SystemStatusGlyphs.Activity, accent = data.overallStatus.panelAccent()) {
        if (data.overallStatus != HealthTone.Healthy) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Icon(SystemStatusGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.warning)
                Caption(stringResource(R.string.translation_Needs_your_attention))
            }
        }
        HealthRow(
            label = stringResource(R.string.translation_Services),
            summary = "${numbers.format(data.servicesOk)} / ${numbers.format(data.servicesTotal)}",
            tone = if (data.servicesTotal == 0) HealthTone.Unknown else data.overallStatus,
        )
        HealthRow(label = stringResource(R.string.translation_Database), summary = data.databaseSize ?: noData(), tone = data.dbStatus)
        HealthRow(
            label = stringResource(R.string.translation_Telemetry),
            summary = "${numbers.format(data.vehicleCount)}",
            tone = data.telemetryTone,
        )
        HealthRow(label = stringResource(R.string.translation_Tesla_auth), summary = teslaSummary(data), tone = data.teslaAuthTone)
        HealthRow(
            label = stringResource(R.string.translation_Notifications),
            summary = data.notifSent?.let { numbers.format(it) } ?: noData(),
            tone = data.notifTone,
        )
        HealthRow(
            label = stringResource(R.string.translation_Workers),
            summary = "${numbers.format(data.workersHealthy)} / ${numbers.format(data.workersTotal)}",
            tone = data.workersTone,
        )
        Button(
            label = stringResource(R.string.translation_Run_health_check),
            onClick = onRunCheck,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun ServicesPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Services___components), icon = SystemStatusGlyphs.Server) {
        MetricRow(
            label = stringResource(R.string.translation_Services),
            value = "${numbers.format(data.servicesOk)} / ${numbers.format(data.servicesTotal)}",
        )
        if (data.components.isEmpty()) {
            HelperText(noData())
        } else {
            data.components.forEach { component ->
                Row(
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = component.name },
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusDot(tone = component.tone)
                    BodyText(component.name, modifier = Modifier.weight(1f))
                }
            }
        }
        LinkRow(stringResource(R.string.translation_Open_Live_Monitor))
    }
}

@Composable
private fun DatabasePanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Database___connections), icon = SystemStatusGlyphs.Database, accent = data.dbStatus.panelAccent()) {
        MetricRow(label = stringResource(R.string.translation_Latency), value = noData())
        MetricRow(label = stringResource(R.string.translation_Pool_acquired), value = noData())
        MetricRow(label = stringResource(R.string.translation_Pool_idle), value = noData())
        MetricRow(label = stringResource(R.string.translation_Tables), value = data.tableCount?.let { numbers.format(it) } ?: noData())
        MetricRow(label = stringResource(R.string.translation_Total_rows), value = noData())
        MetricRow(label = stringResource(R.string.translation_Storage_used), value = data.databaseSize ?: noData())
        HelperText(stringResource(R.string.translation_CPU____memory_bytes__and_disk_usage_need_a_new__system_resources_endpoint__Phase_2__))
        LinkRow(stringResource(R.string.translation_Open_DB_Health))
    }
}

@Composable
private fun TelemetryPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Telemetry_pipeline), icon = SystemStatusGlyphs.Zap, accent = data.telemetryTone.panelAccent()) {
        MetricRow(label = stringResource(R.string.translation_Telemetry), value = numbers.format(data.vehicleCount))
        if (data.vehicleCount == 0) {
            HelperText(stringResource(R.string.translation_Review_polling_cadence_or_vehicle_subscriptions))
        }
        LinkRow(stringResource(R.string.translation_Open_Live_Monitor))
    }
}

@Composable
private fun TeslaAuthPanel(data: SystemStatusData) {
    SectionCard(title = stringResource(R.string.translation_Tesla_auth), icon = SystemStatusGlyphs.ShieldCheck, accent = data.teslaAuthTone.panelAccent()) {
        when {
            data.teslaTokenExpired -> {
                StatusLine(tone = HealthTone.Unhealthy, text = stringResource(R.string.translation_Tesla_token_expired))
                HelperText(stringResource(R.string.translation_Refresh_to_avoid_disruption))
                Button(
                    label = stringResource(R.string.translation_Re_authenticate),
                    onClick = {},
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
            }
            data.teslaTokenExpiryDays != null && data.teslaTokenExpiryDays <= STALE_BACKUP_DAYS -> {
                StatusLine(
                    tone = HealthTone.Degraded,
                    text =
                        stringResource(
                            R.string.translation_Tesla_token_expires_in___days___day_s_,
                            data.teslaTokenExpiryDays.toString(),
                        ),
                )
                HelperText(stringResource(R.string.translation_Refresh_to_avoid_disruption))
                Button(
                    label = stringResource(R.string.translation_Re_authenticate),
                    onClick = {},
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
            }
            data.teslaConnected -> {
                StatusLine(tone = HealthTone.Healthy, text = stringResource(R.string.translation_Tesla_auth))
                HelperText(stringResource(R.string.translation_Sign_in_again_to_resume_Tesla_backed_features))
                Button(
                    label = stringResource(R.string.translation_Re_authenticate),
                    onClick = {},
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
            else -> {
                StatusLine(tone = HealthTone.Unhealthy, text = stringResource(R.string.translation_Tesla_account_not_connected))
                HelperText(stringResource(R.string.translation_Connect_your_Tesla_account_to_fetch_vehicle_data))
                Button(
                    label = stringResource(R.string.translation_Connect),
                    onClick = {},
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

@Composable
private fun NotificationsPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Notifications___audit), icon = SystemStatusGlyphs.Bell, accent = data.notifTone.panelAccent()) {
        MetricRow(
            label = stringResource(R.string.translation_Channels),
            value = channelsSummary(data, numbers),
        )
        MetricRow(label = stringResource(R.string.translation_Sent__lifetime_), value = data.notifSent?.let { numbers.format(it) } ?: noData())
        MetricRow(label = stringResource(R.string.translation_Failed), value = data.notifFailed?.let { numbers.format(it) } ?: noData())
        MetricRow(label = stringResource(R.string.translation_Pending), value = data.notifPending?.let { numbers.format(it) } ?: noData())
        MetricRow(label = stringResource(R.string.translation_Failures__recent_), value = data.notifFailed?.let { numbers.format(it) } ?: noData())
        LinkRow(stringResource(R.string.translation_Open_Notifications))
    }
}

@Composable
private fun WorkersPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Background_workers), icon = SystemStatusGlyphs.Cpu, accent = data.workersTone.panelAccent()) {
        MetricRow(
            label = stringResource(R.string.translation_Workers),
            value =
                if (data.workersTotal == 0) {
                    noData()
                } else {
                    "${numbers.format(data.workersHealthy)} / ${numbers.format(data.workersTotal)}"
                },
        )
        if (data.workersDown > 0) {
            StatusLine(
                tone = HealthTone.Degraded,
                text =
                    stringResource(
                        R.string.translation___down___of___total___workers_unhealthy,
                        data.workersDown.toString(),
                        data.workersTotal.toString(),
                    ),
            )
            HelperText(stringResource(R.string.translation_Review_polling_cadence_or_vehicle_subscriptions))
        }
    }
}

@Composable
private fun BackupsPanel(
    data: SystemStatusData,
    numbers: NumberFormat,
) {
    SectionCard(title = stringResource(R.string.translation_Backups), icon = SystemStatusGlyphs.Package) {
        MetricRow(label = stringResource(R.string.translation_Configured_schedules), value = numbers.format(data.backupConfigCount))
        MetricRow(label = stringResource(R.string.translation_Total_runs), value = numbers.format(data.backupTotalRuns))

        when {
            !data.hasBackupConfig -> {
                StatusLine(tone = HealthTone.Unknown, text = stringResource(R.string.translation_Not_configured))
                HelperText(stringResource(R.string.translation_Configure_a_schedule_or_run_one_now))
                Button(
                    label = stringResource(R.string.translation_Set_up_backups),
                    onClick = {},
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
            }
            !data.hasSuccessfulBackup -> {
                StatusLine(tone = HealthTone.Degraded, text = stringResource(R.string.translation_Configured___no_successful_run_yet))
                HelperText(stringResource(R.string.translation_Run_a_backup_or_check_the_schedule))
                LinkRow(stringResource(R.string.translation_Manage_backups))
            }
            else -> {
                BackupRecencyLine(data = data)
                MetricRow(
                    label = stringResource(R.string.translation_Last_successful_size),
                    value = formatBytes(data.lastSuccessfulSizeBytes),
                )
                LinkRow(stringResource(R.string.translation_Manage_backups))
                LinkRow(stringResource(R.string.translation_Manage))
            }
        }
        if (data.backupTotalRuns == 0 && data.hasBackupConfig) {
            HelperText(stringResource(R.string.translation_No_backups_recorded))
        }
    }
}

@Composable
private fun BackupRecencyLine(data: SystemStatusData) {
    val ageDays = backupAgeDays(data.lastSuccessfulBackupAt, System.currentTimeMillis())
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        MetricLabel(stringResource(R.string.translation_Last_successful))
        when {
            ageDays == null -> BodyText(noData())
            ageDays <= 0L -> BodyText(stringResource(R.string.translation_Last_backup__today))
            ageDays <= STALE_BACKUP_DAYS ->
                BodyText(stringResource(R.string.translation_Last_backup____days__d_ago, ageDays.toString()))
            else ->
                StatusLine(
                    tone = HealthTone.Degraded,
                    text = stringResource(R.string.translation_Last_backup_is___days___days_old, ageDays.toString()),
                )
        }
    }
}

@Composable
private fun TeslaApiUsagePanel(data: SystemStatusData) {
    SectionCard(title = stringResource(R.string.translation_Tesla_API_usage), icon = SystemStatusGlyphs.Activity) {
        MetricRow(
            label = stringResource(R.string.translation_Tesla_API_usage),
            value = stringResource(R.string.translation___cost___of___credit___estimated_this_period, noData(), noData()),
        )
        // Over-budget callout (web `apiOverBudget`) — wired for when the usage feed lands; shown only over budget.
        if (data.apiOverBudget) {
            StatusLine(
                tone = HealthTone.Degraded,
                text =
                    stringResource(
                        R.string.translation_Tesla_API_estimated_cost___cost___exceeds___credit___monthly_credit,
                        noData(),
                        noData(),
                    ),
            )
        }
        LinkRow(stringResource(R.string.translation_Open_Tesla_API_logs))
    }
}

@Composable
private fun RecentErrorsPanel() {
    SectionCard(title = stringResource(R.string.translation_Recent_errors), icon = SystemStatusGlyphs.Inbox) {
        HelperText(stringResource(R.string.translation_No_errors_recorded_recently_))
        LinkRow(stringResource(R.string.translation_Open_error_logs))
    }
}

@Composable
private fun SystemInfoPanel(data: SystemStatusData) {
    SectionCard(title = stringResource(R.string.translation_System_info), icon = SystemStatusGlyphs.Cpu) {
        Caption(stringResource(R.string.translation_Version__build__runtime))
        MetricRow(
            label = stringResource(R.string.translation_System_info),
            value = stringResource(R.string.translation_Current__v__current__, noData()),
        )
        // Update-available callout (web `hasUpdate`) — wired for when the update-check feed lands.
        if (data.updateAvailable) {
            StatusLine(
                tone = HealthTone.Degraded,
                text = stringResource(R.string.translation_Update_available___v__version__, noData()),
            )
        }
        Caption(stringResource(R.string.translation___count___since___uptime___ago, noData(), noData()))
        HelperText(stringResource(R.string.translation_Today_reflects_the_current_status__Day_level_historical_data_ships_with_the_backend_health_history_endpoint_in_Phase_2_))
        LinkRow(stringResource(R.string.translation_Release_notes))
    }
}

@Composable
private fun StatusApiPanel() {
    GlassPanel {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(SystemStatusGlyphs.Boxes, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            HelperText(stringResource(R.string.translation_Stable_Status_API_for_your_own_dashboards), modifier = Modifier.weight(1f))
        }
    }
}

// ── Reusable building blocks ────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SectionCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    accent: PanelAccent = PanelAccent.None,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth().semantics { contentDescription = title }, accent = accent) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            PanelTitle(title, modifier = Modifier.semantics { heading() })
        }
        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            content()
        }
    }
}

@Composable
private fun MetricRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetricLabel(label)
        MetricValue(value)
    }
}

@Composable
private fun HealthRow(
    label: String,
    summary: String,
    tone: HealthTone,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(tone = tone)
        BodyText(label, modifier = Modifier.weight(1f))
        Caption(summary)
    }
}

@Composable
private fun StatusLine(
    tone: HealthTone,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        StatusDot(tone = tone)
        BodyText(text)
    }
}

@Composable
private fun StatusDot(tone: HealthTone) {
    Icon(
        imageVector = SystemStatusGlyphs.Activity,
        contentDescription = null,
        size = IconSize.Xs,
        tint = tone.dotColor(),
    )
}

@Composable
private fun LinkRow(label: String) {
    Button(
        label = label,
        onClick = {},
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )
}

// ── Display helpers ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun noData(): String = stringResource(R.string.translation_No_data)

@Composable
private fun teslaSummary(data: SystemStatusData): String =
    when {
        data.teslaTokenExpired -> stringResource(R.string.translation_Tesla_token_expired)
        data.teslaTokenExpiryDays != null && data.teslaTokenExpiryDays <= STALE_BACKUP_DAYS ->
            stringResource(R.string.translation_Tesla_token_expires_in___days___day_s_, data.teslaTokenExpiryDays.toString())
        data.teslaConnected -> stringResource(R.string.translation_Tesla_auth)
        else -> stringResource(R.string.translation_Tesla_account_not_connected)
    }

@Composable
private fun channelsSummary(
    data: SystemStatusData,
    numbers: NumberFormat,
): String {
    val enabled = data.notifEnabledChannels
    val total = data.notifTotalChannels
    return if (enabled == null || total == null) {
        noData()
    } else {
        "${numbers.format(enabled)} / ${numbers.format(total)}"
    }
}

private fun formatBytes(bytes: Long?): String {
    if (bytes == null || bytes < 0) return EM_DASH
    if (bytes < BYTES_PER_UNIT) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB", "PB")
    var value = bytes / BYTES_PER_UNIT
    var unitIndex = 0
    while (value >= BYTES_PER_UNIT && unitIndex < units.size - 1) {
        value /= BYTES_PER_UNIT
        unitIndex++
    }
    return String.format(Locale.ROOT, "%.1f %s", value, units[unitIndex])
}

private const val BYTES_PER_UNIT = 1024.0

@Composable
private fun HealthTone.dotColor() =
    when (this) {
        HealthTone.Healthy -> TeslaTokens.status.success
        HealthTone.Degraded -> TeslaTokens.status.warning
        HealthTone.Unhealthy -> TeslaTokens.status.danger
        HealthTone.Maintenance -> TeslaTokens.status.info
        HealthTone.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun HealthTone.panelAccent(): PanelAccent =
    when (this) {
        HealthTone.Healthy -> PanelAccent.Success
        HealthTone.Degraded -> PanelAccent.Warning
        HealthTone.Unhealthy -> PanelAccent.Danger
        HealthTone.Maintenance -> PanelAccent.Info
        HealthTone.Unknown -> PanelAccent.None
    }
