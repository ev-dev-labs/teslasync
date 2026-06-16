// The native Jetpack Compose + Material 3 FleetAPIPage admin surface — a parity port of
// web/src/features/admin/pages/FleetAPIPage.tsx, the Tesla Fleet API polling / endpoint control panel. It
// reproduces the page's panels (the API-polling suspend toggle with its suspended banner, the per-endpoint
// toggle grid across the Polling / On-Demand / Commands groups, the telemetry-capture controls with the
// retention Select and the captured-signal summary, and the configured-endpoints list), every data state
// (loading / empty / success — plus an error + retry per section so no region is ever blank), and every
// visible string (resolved from the generated res/values catalog, ADR-014). The two web mutations
// (suspend/resume, save-polling-config) raise the same toast outcomes through a Material 3 Snackbar.
//
// Composition: [FleetAPIPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the four feeds + the updating flag, and pipes the
// toast outcomes to the SnackbarHost); [FleetAPIPageContent] is the stateless render layer driven entirely by
// the four [UiState] surfaces + [FleetApiActions]. All derivation lives in the framework-free model
// (FleetAPIPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.fleetapi

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.PollingConfig
import io.teslasync.shared.core.presentation.settings.VersionInfo
import java.text.NumberFormat
import java.util.Locale

/** The page's interaction callbacks, wired to the [FleetAPIPageViewModel] (web event handlers). */
data class FleetApiActions(
    val onToggleSuspend: (Boolean) -> Unit,
    val onToggleEndpoint: (String) -> Unit,
    val onRetention: (Int) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [FleetAPIPageViewModel] over the supplied [source] (the host wires the shared
 * [io.teslasync.shared.core.presentation.settings.SettingsStore] via [asFleetApiSource]). [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun FleetAPIPage(
    source: FleetApiSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: FleetAPIPageViewModel =
        viewModel(
            key = FleetApiRegistration.SLUG,
            factory = viewModelFactory { initializer { FleetAPIPageViewModel(source, logger) } },
        )
    FleetAPIPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds to the stateless content and pipes toast outcomes to a Snackbar. */
@Composable
fun FleetAPIPage(
    viewModel: FleetAPIPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val pollingConfig by viewModel.pollingConfig.collectAsStateWithLifecycle()
    val captureStats by viewModel.captureStats.collectAsStateWithLifecycle()
    val version by viewModel.version.collectAsStateWithLifecycle()
    val updating by viewModel.updating.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            FleetApiActions(
                onToggleSuspend = viewModel::setSuspended,
                onToggleEndpoint = viewModel::toggleEndpoint,
                onRetention = viewModel::setRetentionDays,
                onRetry = viewModel::retry,
            )
        }

    val snackbarHost = remember { SnackbarHostState() }
    FleetApiToastBridge(viewModel = viewModel, snackbarHost = snackbarHost)

    Box(modifier = modifier.fillMaxSize()) {
        FleetAPIPageContent(
            settings = settings,
            pollingConfig = pollingConfig,
            captureStats = captureStats,
            version = version,
            updating = updating,
            actions = actions,
        )
        SnackbarHost(snackbarHost, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

/**
 * Collects the view-model's one-shot toast outcomes and surfaces each as a Material 3 Snackbar, resolving every
 * message through the i18n catalog (ADR-014) — the native analogue of the web `toast.success/info/error` calls.
 */
@Composable
private fun FleetApiToastBridge(
    viewModel: FleetAPIPageViewModel,
    snackbarHost: SnackbarHostState,
) {
    val pollingUpdated = stringResource(R.string.translation_Polling_config_updated)
    val pollingFailed = stringResource(R.string.translation_Failed_to_update_polling_config)
    val apiSuspendedTitle = stringResource(R.string.translation_API_suspended)
    val apiSuspendedDetail = stringResource(R.string.translation_All_Tesla_API_calls_have_been_paused)
    val apiResumedTitle = stringResource(R.string.translation_API_resumed)
    val apiResumedDetail = stringResource(R.string.translation_Tesla_API_polling_has_been_re_enabled)
    val failedTitle = stringResource(R.string.translation_Failed)
    val suspendFailedDetail = stringResource(R.string.translation_Could_not_toggle_API_suspension)

    LaunchedEffect(viewModel, snackbarHost) {
        viewModel.toasts.collect { toast ->
            val message =
                when (toast) {
                    FleetApiToast.PollingUpdated -> pollingUpdated
                    FleetApiToast.PollingFailed -> pollingFailed
                    FleetApiToast.ApiSuspended -> "$apiSuspendedTitle: $apiSuspendedDetail"
                    FleetApiToast.ApiResumed -> "$apiResumedTitle: $apiResumedDetail"
                    FleetApiToast.SuspendFailed -> "$failedTitle: $suspendFailedDetail"
                }
            snackbarHost.showSnackbar(message)
        }
    }
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header + the three top-level panels, each driven by its own feed. */
@Composable
fun FleetAPIPageContent(
    settings: UiState<FleetApiSettings>,
    pollingConfig: UiState<PollingConfig>,
    captureStats: UiState<CaptureStats>,
    version: UiState<VersionInfo>,
    updating: Boolean,
    actions: FleetApiActions,
    modifier: Modifier = Modifier,
) {
    val pageName = stringResource(R.string.translation_Fleet_API)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = pageName },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_Fleet_API_Settings))
            HelperText(stringResource(R.string.translation_Control_Tesla_Fleet_API_polling__endpoint_toggles__and_telemetry_capture))
        }

        FadeIn(modifier = Modifier.fillMaxWidth()) {
            TeslaApiPollingPanel(state = settings, onToggleSuspend = actions.onToggleSuspend, onRetry = actions.onRetry)
        }

        FadeIn(modifier = Modifier.fillMaxWidth()) {
            ApiEndpointControlsPanel(
                pollingState = pollingConfig,
                captureState = captureStats,
                updating = updating,
                actions = actions,
            )
        }

        FadeIn(modifier = Modifier.fillMaxWidth()) { ApiEndpointsPanel(state = version, onRetry = actions.onRetry) }
    }
}

// ── Panel: Tesla API Polling (GlassPanel #2) + suspended banner (#3) ─────────────────────────────────────────

@Composable
private fun TeslaApiPollingPanel(
    state: UiState<FleetApiSettings>,
    onToggleSuspend: (Boolean) -> Unit,
    onRetry: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                state.isLoading -> SectionLoading()
                state.isError -> SectionError(onRetry)
                else -> {
                    val suspended = state.data?.apiSuspended ?: false
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconBox(tone = if (suspended) IconBoxTone.Danger else IconBoxTone.Success) {
                                Icon(
                                    if (suspended) FleetApiGlyphs.Pause else FleetApiGlyphs.Play,
                                    contentDescription = null,
                                    size = IconSize.Lg,
                                )
                            }
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                                SectionTitle(stringResource(R.string.translation_Tesla_API_Polling))
                                Caption(
                                    if (suspended) {
                                        stringResource(R.string.translation_All_Tesla_Fleet_API_calls_are_suspended)
                                    } else {
                                        stringResource(R.string.translation_Vehicle_data_is_being_polled_from_Tesla)
                                    },
                                )
                            }
                        }
                        Spacer(Modifier.width(Spacing.sm))
                        Toggle(
                            checked = !suspended,
                            onCheckedChange = { newChecked -> onToggleSuspend(!newChecked) },
                        )
                    }
                    if (suspended) {
                        SuspendedBanner()
                    }
                }
            }
        }
    }
}

@Composable
private fun SuspendedBanner() {
    GlassPanel(padding = PanelPadding.Sm, accent = PanelAccent.Danger) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                FleetApiGlyphs.Pause,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.error,
            )
            HelperText(
                stringResource(
                    R.string.translation_Polling_and_commands_are_paused__Token_refresh_continues_so_you_won_t_need_to_re_authenticate__Useful_when_your_vehicle_is_in_service_,
                ),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ── Panel: API Endpoint Controls (GlassPanel #4) + the toggle rows (#1), retention (#5), signals (#6) ─────────

@Composable
private fun ApiEndpointControlsPanel(
    pollingState: UiState<PollingConfig>,
    captureState: UiState<CaptureStats>,
    updating: Boolean,
    actions: FleetApiActions,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ApiEndpointControlsHeader(pollingState.data)

            when {
                pollingState.isLoading -> SectionLoading()
                pollingState.isError -> SectionError(actions.onRetry)
                else -> {
                    val config = pollingState.data
                    if (config != null) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                            EndpointGroup(
                                title = stringResource(R.string.translation_Polling_Endpoints),
                                keys = POLLING_ENDPOINT_KEYS,
                                config = config,
                                onToggle = actions.onToggleEndpoint,
                            )
                            EndpointGroup(
                                title = stringResource(R.string.translation_On_Demand_Endpoints),
                                keys = ON_DEMAND_ENDPOINT_KEYS,
                                config = config,
                                onToggle = actions.onToggleEndpoint,
                            )
                            EndpointGroup(
                                title = stringResource(R.string.translation_Commands),
                                keys = COMMAND_ENDPOINT_KEYS,
                                config = config,
                                onToggle = actions.onToggleEndpoint,
                            )
                            TelemetryCaptureSection(
                                config = config,
                                captureState = captureState,
                                updating = updating,
                                actions = actions,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ApiEndpointControlsHeader(config: PollingConfig?) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
        IconBox(tone = IconBoxTone.Primary) {
            Icon(FleetApiGlyphs.Shield, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(stringResource(R.string.translation_API_Endpoint_Controls))
            val subtitle = stringResource(R.string.translation_Toggle_individual_Tesla_Fleet_API_endpoints_on_or_off)
            val enabledWord = stringResource(R.string.translation_enabled)
            val countSuffix =
                config?.let { " (${it.enabledToggleCount()}/$TOTAL_TOGGLE_COUNT $enabledWord)" }.orEmpty()
            Caption(subtitle + countSuffix)
        }
    }
}

@Composable
private fun EndpointGroup(
    title: String,
    keys: List<String>,
    config: PollingConfig,
    onToggle: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Subhead(title)
        keys.forEach { key ->
            EndpointToggleRow(
                label = endpointLabel(key),
                desc = endpointDesc(key),
                enabled = config.isEnabled(key),
                onToggle = { onToggle(key) },
            )
        }
    }
}

/** One endpoint toggle row — the native mirror of the web `EndpointToggle` sub-component (GlassPanel #1). */
@Composable
private fun EndpointToggleRow(
    label: String,
    desc: String,
    enabled: Boolean,
    onToggle: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(label, maxLines = 1)
                HelperText(desc)
            }
            Spacer(Modifier.width(Spacing.sm))
            Toggle(checked = enabled, onCheckedChange = { onToggle() })
        }
    }
}

@Composable
private fun TelemetryCaptureSection(
    config: PollingConfig,
    captureState: UiState<CaptureStats>,
    updating: Boolean,
    actions: FleetApiActions,
) {
    val stats = captureState.data
    val mongoEnabled = stats?.mongodbEnabled == true
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Subhead(stringResource(R.string.translation_Telemetry_Capture))
            if (stats != null) {
                Badge(
                    text =
                        if (mongoEnabled) {
                            stringResource(R.string.translation_MongoDB_Connected)
                        } else {
                            stringResource(R.string.translation_MongoDB_Not_Configured)
                        },
                    variant = if (mongoEnabled) BadgeVariant.Success else BadgeVariant.Neutral,
                )
            }
        }

        EndpointToggleRow(
            label = stringResource(R.string.translation_Raw_Signal_Recording),
            desc =
                if (stats != null && !mongoEnabled) {
                    stringResource(R.string.translation_Set_MONGODB_ENABLED_true_and_configure_MONGODB_URI_to_enable)
                } else {
                    stringResource(R.string.translation_Capture_every_fleet_telemetry_signal_to_MongoDB_for_debugging)
                },
            enabled = config.isEnabled(KEY_TELEMETRY_CAPTURE),
            onToggle = { actions.onToggleEndpoint(KEY_TELEMETRY_CAPTURE) },
        )

        if (config.telemetryCapture && mongoEnabled) {
            RetentionRow(config = config, updating = updating, onRetention = actions.onRetention)
            if (stats.totalDocuments > 0) {
                SignalsCapturedChip(stats)
            }
        }
    }
}

/** The telemetry-capture retention control (GlassPanel #5). */
@Composable
private fun RetentionRow(
    config: PollingConfig,
    updating: Boolean,
    onRetention: (Int) -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(stringResource(R.string.translation_Retention_Period), maxLines = 1)
                HelperText(stringResource(R.string.translation_Auto_delete_captured_signals_after_this_many_days))
            }
            Spacer(Modifier.width(Spacing.sm))
            Select(
                options = retentionOptions(),
                selectedValue = config.effectiveRetentionDays().toString(),
                onSelect = { value -> onRetention(value.toIntOrNull() ?: DEFAULT_RETENTION_DAYS) },
                enabled = !updating,
                modifier = Modifier.width(RETENTION_SELECT_WIDTH),
            )
        }
    }
}

/** The captured-signal summary chip (GlassPanel #6). */
@Composable
private fun SignalsCapturedChip(stats: CaptureStats) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm, accent = PanelAccent.Info) {
        val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
        val count = NumberFormat.getIntegerInstance(locale).format(stats.totalDocuments)
        val vins = stats.distinctVins.size
        val capturedFrom = stringResource(R.string.translation_signals_captured_from)
        val vehicleWord = stringResource(R.string.translation_vehicle)
        val plural = if (vins != 1) "s" else ""
        Caption("$count $capturedFrom $vins $vehicleWord$plural")
    }
}

// ── Panel: API Endpoints (GlassPanel #7) + the configured-endpoint rows (#8) ─────────────────────────────────

@Composable
private fun ApiEndpointsPanel(
    state: UiState<VersionInfo>,
    onRetry: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                IconBox(tone = IconBoxTone.Info) {
                    Icon(FleetApiGlyphs.Globe, contentDescription = null, size = IconSize.Lg)
                }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    SectionTitle(stringResource(R.string.translation_API_Endpoints))
                    state.data?.let { version ->
                        Caption("v${version.chartVersion} · ${version.goVersion} · ${version.os}/${version.arch}")
                    }
                }
            }

            when {
                state.isLoading -> SectionLoading()
                state.isError -> SectionError(onRetry)
                state.isEmpty -> EndpointsEmptyState()
                else -> {
                    val version = state.data
                    if (version != null) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(FleetApiGlyphs.Link, contentDescription = null, size = IconSize.Sm)
                                Subhead(stringResource(R.string.translation_Configured_Endpoints))
                            }
                            CONFIGURED_ENDPOINT_KEYS.forEach { key ->
                                val url = version.endpoints[key]
                                if (!url.isNullOrEmpty()) {
                                    ConfiguredEndpointRow(label = configuredEndpointLabel(key), url = url)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One configured-endpoint row (GlassPanel #8). */
@Composable
private fun ConfiguredEndpointRow(
    label: String,
    url: String,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(label)
            Spacer(Modifier.width(Spacing.sm))
            CodeText(url, modifier = Modifier.weight(1f, fill = false))
        }
    }
}

@Composable
private fun EndpointsEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = FleetApiGlyphs.Activity,
    )
}

// ── Shared per-section data states ───────────────────────────────────────────────────────────────────────────

@Composable
private fun SectionLoading() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

@Composable
private fun SectionError(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            FleetApiGlyphs.Activity,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        ErrorText(stringResource(R.string.translation_Failed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

// ── i18n key → label/desc resolution (web inline endpoint arrays) ─────────────────────────────────────────────

/** The display label for an endpoint toggle key (web `pollingEndpoints`/`onDemandEndpoints`/`commandEndpoints`). */
@Composable
private fun endpointLabel(key: String): String =
    when (key) {
        KEY_VEHICLE_DISCOVERY, KEY_ON_DEMAND_VEHICLE_DISCOVERY -> stringResource(R.string.translation_Vehicle_Discovery)
        KEY_CHARGE_STATE, KEY_ON_DEMAND_CHARGE_STATE -> stringResource(R.string.translation_Charge_State)
        KEY_CLIMATE_STATE, KEY_ON_DEMAND_CLIMATE_STATE -> stringResource(R.string.translation_Climate_State)
        KEY_DRIVE_STATE, KEY_ON_DEMAND_DRIVE_STATE -> stringResource(R.string.translation_Drive_State)
        KEY_LOCATION_DATA, KEY_ON_DEMAND_LOCATION_DATA -> stringResource(R.string.translation_Location_Data)
        KEY_VEHICLE_STATE, KEY_ON_DEMAND_VEHICLE_STATE -> stringResource(R.string.translation_Vehicle_State)
        KEY_VEHICLE_CONFIG, KEY_ON_DEMAND_VEHICLE_CONFIG -> stringResource(R.string.translation_Vehicle_Config)
        KEY_NEARBY_CHARGING_SITES -> stringResource(R.string.translation_Nearby_Charging)
        KEY_RELEASE_NOTES -> stringResource(R.string.translation_Release_Notes)
        KEY_RECENT_ALERTS -> stringResource(R.string.translation_Recent_Alerts)
        KEY_SERVICE_DATA -> stringResource(R.string.translation_Service_Data)
        KEY_WAKE_UP -> stringResource(R.string.translation_Wake_Up)
        KEY_COMMANDS -> stringResource(R.string.translation_Vehicle_Commands)
        else -> key
    }

/** The description for an endpoint toggle key (web endpoint array `desc` field). */
@Composable
private fun endpointDesc(key: String): String =
    when (key) {
        KEY_VEHICLE_DISCOVERY -> stringResource(R.string.translation_List_vehicles_from_Tesla)
        KEY_ON_DEMAND_VEHICLE_DISCOVERY -> stringResource(R.string.translation_Sync_vehicles_from_Tesla)
        KEY_CHARGE_STATE, KEY_ON_DEMAND_CHARGE_STATE -> stringResource(R.string.translation_Battery___charging_data)
        KEY_CLIMATE_STATE, KEY_ON_DEMAND_CLIMATE_STATE -> stringResource(R.string.translation_Climate___temperature_data)
        KEY_DRIVE_STATE, KEY_ON_DEMAND_DRIVE_STATE -> stringResource(R.string.translation_Location___speed_data)
        KEY_LOCATION_DATA, KEY_ON_DEMAND_LOCATION_DATA -> stringResource(R.string.translation_GPS_coordinates)
        KEY_VEHICLE_STATE, KEY_ON_DEMAND_VEHICLE_STATE -> stringResource(R.string.translation_Locks__doors__odometer)
        KEY_VEHICLE_CONFIG, KEY_ON_DEMAND_VEHICLE_CONFIG -> stringResource(R.string.translation_Model__trim__options)
        KEY_NEARBY_CHARGING_SITES -> stringResource(R.string.translation_Supercharger_locations)
        KEY_RELEASE_NOTES -> stringResource(R.string.translation_Firmware_release_notes)
        KEY_RECENT_ALERTS -> stringResource(R.string.translation_Vehicle_alert_history)
        KEY_SERVICE_DATA -> stringResource(R.string.translation_Service_history___status)
        KEY_WAKE_UP -> stringResource(R.string.translation_Wake_vehicle_from_sleep)
        KEY_COMMANDS -> stringResource(R.string.translation_Lock__unlock__climate__etc_)
        else -> ""
    }

/** The display label for a configured-endpoint key (web API-Endpoints inline array). */
@Composable
private fun configuredEndpointLabel(key: String): String =
    when (key) {
        ENDPOINT_API -> stringResource(R.string.translation_API__Internal_)
        ENDPOINT_WEB -> stringResource(R.string.translation_Web_Frontend)
        ENDPOINT_OAUTH_CALLBACK -> stringResource(R.string.translation_OAuth_Callback)
        ENDPOINT_TESLA_API -> stringResource(R.string.translation_Tesla_Fleet_API)
        else -> key
    }

/** The retention-day Select options (web retention `options`), in web order. */
@Composable
private fun retentionOptions(): List<SelectOption> =
    RETENTION_DAY_OPTIONS.map { day -> SelectOption(value = day.toString(), label = retentionDayLabel(day)) }

@Composable
private fun retentionDayLabel(day: Int): String =
    when (day) {
        1 -> stringResource(R.string.translation_1_day)
        3 -> stringResource(R.string.translation_3_days)
        7 -> stringResource(R.string.translation_7_days)
        14 -> stringResource(R.string.translation_14_days)
        30 -> stringResource(R.string.translation_30_days)
        else -> day.toString()
    }

private val RETENTION_SELECT_WIDTH = 132.dp
