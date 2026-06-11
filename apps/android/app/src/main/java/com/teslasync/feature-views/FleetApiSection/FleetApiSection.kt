// The native Jetpack Compose + Material 3 Fleet API devtools feature view — a parity port of
// web/src/features/admin/components/devtools/FleetApiSection.tsx (+ ToolCard / ResultPanel /
// TelemetryErrorsPanel / SignalConfigModal). It reproduces the web composition: a Setup Wizard
// (7-step onboarding with progress, step indicators, auto-detection and Prev/Mark Complete/Next) above
// a stack of nine Fleet API tool cards (config, partner registration, partner public-key verification,
// public-key setup, vehicle key pairing, telemetry subscribe + signal picker, telemetry config + the
// 4-state errors panel, fleet status, and vehicle data). Every data source flows through the shared
// [FleetApiSectionViewModel] (P1/S8) — the view performs no HTTP. Every string resolves through the
// P1/S10 catalog via [rememberFleetApiLabels]; loading / empty / error / stale / offline states each
// render; interactive controls carry TalkBack labels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetApiSection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located composables + helpers; `LargeClass`-style
// length is inherent to a faithful port of an 828-line web component with nine tools.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.fleetapi

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private val ICON_BOX_SIZE = 40.dp
private val PROGRESS_BAR_HEIGHT = 8.dp
private val RESULT_MAX_HEIGHT = 240.dp
private val PEM_MAX_HEIGHT = 192.dp
private const val SURFACE_ALPHA = 0.04f
private const val OVERLAY_ALPHA = 0.6f
private const val ACCENT_WASH_ALPHA = 0.08f

/* ═══════════════════════════════════════════════════════════════════════
   Stateful entry point
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Stateful entry point. Collects the shared [FleetApiSectionViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model (wired via
 * [FleetApiSectionViewModel.create]).
 */
@Composable
fun FleetApiSection(
    viewModel: FleetApiSectionViewModel,
    modifier: Modifier = Modifier,
) {
    val config by viewModel.fleetApiInfo.collectAsStateWithLifecycle()
    val status by viewModel.publicKeyStatus.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicleOptions.collectAsStateWithLifecycle()
    val wizard by viewModel.wizard.collectAsStateWithLifecycle()
    val actions by viewModel.actions.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    FleetApiSectionContent(
        config = config,
        status = status,
        vehicles = vehicles,
        wizard = wizard,
        actions = actions,
        callbacks =
            FleetApiCallbacks(
                onRefreshConfig = viewModel::refreshConfig,
                onRefreshStatus = viewModel::refreshStatus,
                onRefreshVehicles = viewModel::refreshVehicles,
                onRegisterPartner = viewModel::registerPartner,
                onVerifyPartnerKey = viewModel::verifyPartnerKey,
                onGenerateKeypair = viewModel::generateKeypair,
                onDeleteKeypair = viewModel::deleteKeypair,
                onUploadPublicKey = viewModel::uploadPublicKey,
                onSubscribeTelemetry = viewModel::subscribeTelemetry,
                onGetTelemetryConfig = viewModel::getTelemetryConfig,
                onGetTelemetryErrors = viewModel::getTelemetryErrors,
                onDeleteTelemetryConfig = viewModel::deleteTelemetryConfig,
                onCheckFleetStatus = viewModel::checkFleetStatus,
                onFetchVehicleData = viewModel::fetchVehicleData,
                onSelectStep = viewModel::selectStep,
                onNextStep = viewModel::nextStep,
                onPreviousStep = viewModel::previousStep,
                onMarkStepComplete = viewModel::markCurrentStepComplete,
            ),
        modifier = modifier,
    )
}

/** Bundles every action callback the surface needs so the stateless content takes one parameter. */
@Suppress("LongParameterList")
data class FleetApiCallbacks(
    val onRefreshConfig: () -> Unit,
    val onRefreshStatus: () -> Unit,
    val onRefreshVehicles: () -> Unit,
    val onRegisterPartner: (String) -> Unit,
    val onVerifyPartnerKey: (String) -> Unit,
    val onGenerateKeypair: () -> Unit,
    val onDeleteKeypair: () -> Unit,
    val onUploadPublicKey: (String) -> Unit,
    val onSubscribeTelemetry: (TelemetrySubscribeRequest) -> Unit,
    val onGetTelemetryConfig: (String) -> Unit,
    val onGetTelemetryErrors: (String) -> Unit,
    val onDeleteTelemetryConfig: (String) -> Unit,
    val onCheckFleetStatus: (List<String>) -> Unit,
    val onFetchVehicleData: (VehicleDataKind, String) -> Unit,
    val onSelectStep: (Int) -> Unit,
    val onNextStep: () -> Unit,
    val onPreviousStep: () -> Unit,
    val onMarkStepComplete: () -> Unit,
) {
    companion object {
        /** No-op callbacks for previews / tests that only assert rendering. */
        val NONE: FleetApiCallbacks =
            FleetApiCallbacks(
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                {},
                { _, _ -> },
                {},
                {},
                {},
                {},
            )
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Stateless content
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Stateless renderer — the unit/UI-test entry point. Reproduces the web two-section layout: the Setup
 * Wizard above the Fleet API tool stack. Local input state (domain / pem / vin / hostname / port /
 * CA cert / selected signals) lives here via `rememberSaveable`, mirroring the web `useState`.
 */
@Composable
fun FleetApiSectionContent(
    config: UiState<FleetApiInfo>,
    status: UiState<PublicKeyStatus>,
    vehicles: UiState<List<VehicleOption>>,
    wizard: WizardDisplay,
    actions: Map<FleetApiActionId, ToolActionState>,
    callbacks: FleetApiCallbacks,
    modifier: Modifier = Modifier,
) {
    val labels = rememberFleetApiLabels()
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        // Setup Wizard
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SectionTitle(labels.setupWizard, modifier = Modifier.semantics { heading() })
            OnboardingWorkflow(config = config, status = status, wizard = wizard, callbacks = callbacks, labels = labels)
        }
        // Fleet API tools
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SectionTitle(labels.toolsTitle, modifier = Modifier.semantics { heading() })
            FleetApiConfigTool(config, callbacks.onRefreshConfig, labels)
            PartnerRegistrationTool(actions[FleetApiActionId.RegisterPartner], callbacks.onRegisterPartner, labels)
            PartnerPublicKeyTool(actions[FleetApiActionId.VerifyPartnerKey], callbacks.onVerifyPartnerKey, labels)
            PublicKeySetupTool(status, actions, callbacks, labels)
            VehicleKeyPairingTool(config, labels)
            FleetTelemetrySubscribeTool(vehicles, actions[FleetApiActionId.SubscribeTelemetry], callbacks.onSubscribeTelemetry, labels)
            FleetTelemetryConfigTool(vehicles, actions, callbacks, labels)
            FleetStatusTool(vehicles, actions[FleetApiActionId.FleetStatus], callbacks.onCheckFleetStatus, labels)
            VehicleDataTools(vehicles, actions, callbacks.onFetchVehicleData, labels)
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Onboarding wizard
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun OnboardingWorkflow(
    config: UiState<FleetApiInfo>,
    status: UiState<PublicKeyStatus>,
    wizard: WizardDisplay,
    callbacks: FleetApiCallbacks,
    labels: FleetApiLabels,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        val error = config.hasError || status.hasError
        if (error) {
            AlertBanner(message = labels.loadFailed, tone = Tone.Danger)
        }
        // Progress bar
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Caption(labels.progress)
                Caption("${wizard.completedCount} / ${wizard.totalCount} (${wizard.progressPercent}%)")
            }
            ProgressBar(fraction = wizard.progressPercent / 100f)
        }
        // Step indicators
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            wizard.steps.forEachIndexed { index, step ->
                val done = wizard.completed[step] == true
                val variant =
                    when {
                        done -> BadgeVariant.Success
                        index == wizard.currentIndex -> BadgeVariant.Info
                        else -> BadgeVariant.Neutral
                    }
                Box(modifier = Modifier.clickableStep { callbacks.onSelectStep(index) }) {
                    Badge(text = labels.stepLabelText(step), variant = variant, dot = index == wizard.currentIndex)
                }
            }
        }
        // Step content
        GlassPanel {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                IconBox(
                    icon = if (wizard.isCurrentComplete) IconCheck else stepIcon(wizard.currentStep),
                    accent = if (wizard.isCurrentComplete) IconAccent.Green else IconAccent.Cyan,
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    val stepNumber =
                        stringResource(R.string.translation_devtools_onboarding_stepLabel, (wizard.currentIndex + 1).toString())
                    PanelTitle(
                        "$stepNumber: ${labels.stepLabelText(wizard.currentStep)}",
                        modifier = Modifier.semantics { heading() },
                    )
                    Caption(labels.stepDescText(wizard.currentStep))
                }
            }
            Row(
                modifier = Modifier.padding(top = Spacing.sm),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    label = labels.previous,
                    onClick = callbacks.onPreviousStep,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled = wizard.canGoPrevious,
                    leadingIcon = IconChevronLeft,
                )
                Button(
                    label = if (wizard.isCurrentComplete) labels.completed else labels.markComplete,
                    onClick = callbacks.onMarkStepComplete,
                    variant = if (wizard.isCurrentComplete) ButtonVariant.Secondary else ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = IconCheck,
                )
                Button(
                    label = labels.next,
                    onClick = callbacks.onNextStep,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled = wizard.canGoNext,
                    leadingIcon = IconChevronRight,
                )
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Fleet API Config
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun FleetApiConfigTool(
    config: UiState<FleetApiInfo>,
    onRefresh: () -> Unit,
    labels: FleetApiLabels,
) {
    ToolCard(
        icon = IconSettings,
        accent = IconAccent.Cyan,
        title = labels.config,
        description = labels.configDesc,
        freshness = config.freshness(),
        onRefresh = onRefresh,
    ) {
        when {
            config.isLoading -> SkeletonLines(4)
            config.isError -> AlertBanner(message = labels.loadFailed, tone = Tone.Danger)
            else -> {
                val info = config.data ?: return@ToolCard
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    FieldChip(label = labels.baseUrl, value = info.baseUrl, copyLabels = labels)
                    FieldChip(label = labels.clientId, value = info.clientId, copyLabels = labels)
                    KeyValuePanel(label = labels.authStatus) {
                        if (info.authenticated) {
                            Badge(text = labels.authenticated, variant = BadgeVariant.Success, dot = true)
                        } else {
                            Badge(text = labels.notAuthenticated, variant = BadgeVariant.Danger, dot = true)
                        }
                    }
                    KeyValuePanel(label = labels.regions) {
                        if (info.regions.isEmpty()) {
                            BodyText(FLEET_API_EM_DASH)
                        } else {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                                info.regions.forEach { Badge(text = it, variant = BadgeVariant.Info) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Partner Registration
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun PartnerRegistrationTool(
    action: ToolActionState?,
    onRegister: (String) -> Unit,
    labels: FleetApiLabels,
) {
    var domain by rememberSaveable { mutableStateOf("") }
    ToolCard(icon = IconGlobe, accent = IconAccent.Green, title = labels.partnerReg, description = labels.partnerRegDesc) {
        AlertBanner(message = labels.prerequisitesDesc, title = labels.prerequisites, tone = Tone.Warning)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(labels.opensslCommands)
            CommandRow(OPENSSL_GEN_COMMAND, labels)
            CommandRow(OPENSSL_PUB_COMMAND, labels)
        }
        Input(value = domain, onValueChange = { domain = it }, label = labels.domain, leadingIcon = IconGlobe)
        Button(
            label = labels.register,
            onClick = { onRegister(domain) },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            loading = action?.isRunning == true,
            leadingIcon = IconPlay,
        )
        ResultPanel(title = labels.partnerReg, state = resultOf(action), labels = labels)
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Partner Public Key verification
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun PartnerPublicKeyTool(
    action: ToolActionState?,
    onVerify: (String) -> Unit,
    labels: FleetApiLabels,
) {
    var domain by rememberSaveable { mutableStateOf("") }
    ToolCard(icon = IconShield, accent = IconAccent.Cyan, title = labels.partnerKeyTitle, description = labels.partnerKeyDesc) {
        Input(value = domain, onValueChange = { domain = it }, label = labels.domain, leadingIcon = IconGlobe)
        Button(
            label = labels.verify,
            onClick = { onVerify(domain) },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = domain.isNotBlank(),
            loading = action?.isRunning == true,
            leadingIcon = IconPlay,
        )
        val response = action?.response
        if (action is ToolActionState.Done && response != null) {
            val verification = PartnerKeyVerification.from(response)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (verification.remoteFound) {
                    Badge(text = labels.keyRegistered, variant = BadgeVariant.Success, dot = true)
                } else {
                    Badge(text = labels.keyNotFound, variant = BadgeVariant.Danger, dot = true)
                }
                if (verification.remoteFound && verification.localConfigured) {
                    if (verification.matchesLocal) {
                        Badge(text = labels.matchesLocal, variant = BadgeVariant.Success, dot = true)
                    } else {
                        Badge(text = labels.mismatch, variant = BadgeVariant.Warning, dot = true)
                    }
                }
                if (verification.remoteFound && !verification.localConfigured) {
                    Badge(text = labels.noLocal, variant = BadgeVariant.Neutral)
                }
            }
            if (verification.publicKey.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(labels.pemLabel)
                    PreBlock(verification.publicKey, maxHeight = PEM_MAX_HEIGHT)
                }
            }
            ResultPanel(title = labels.rawResponse, state = ResultPanelState.from(response, hasRun = true), labels = labels)
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Public Key setup
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun PublicKeySetupTool(
    status: UiState<PublicKeyStatus>,
    actions: Map<FleetApiActionId, ToolActionState>,
    callbacks: FleetApiCallbacks,
    labels: FleetApiLabels,
) {
    var pem by rememberSaveable { mutableStateOf("") }
    ToolCard(
        icon = IconKey,
        accent = IconAccent.Purple,
        title = labels.publicKey,
        description = labels.publicKeyDesc,
        freshness = status.freshness(),
        onRefresh = callbacks.onRefreshStatus,
    ) {
        when {
            status.isLoading -> SkeletonLines(3)
            status.isError -> AlertBanner(message = labels.loadFailed, tone = Tone.Danger)
            else -> {
                val keyStatus = status.data ?: return@ToolCard
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption("${labels.status}:")
                    if (keyStatus.configured) {
                        Badge(text = labels.configured, variant = BadgeVariant.Success, dot = true)
                    } else {
                        Badge(text = labels.notConfigured, variant = BadgeVariant.Warning, dot = true)
                    }
                }
                if (keyStatus.fingerprint.isNotEmpty()) {
                    CodeRow(IconFingerprint, keyStatus.fingerprint, labels)
                }
                if (keyStatus.wellKnownUrl.isNotEmpty()) {
                    CodeRow(IconLink, keyStatus.wellKnownUrl, labels)
                }
                AlertBanner(message = labels.privateKeyWarning, tone = Tone.Warning)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Button(
                        label = labels.generateKeypair,
                        onClick = callbacks.onGenerateKeypair,
                        variant = ButtonVariant.Primary,
                        size = ButtonSize.Sm,
                        loading = actions[FleetApiActionId.GenerateKeypair]?.isRunning == true,
                        leadingIcon = IconKey,
                    )
                    Button(
                        label = labels.deleteKeypair,
                        onClick = callbacks.onDeleteKeypair,
                        variant = ButtonVariant.Danger,
                        size = ButtonSize.Sm,
                        loading = actions[FleetApiActionId.DeleteKeypair]?.isRunning == true,
                        leadingIcon = IconTrash,
                    )
                }
                ResultPanel(
                    title = labels.generateKeypair,
                    state = resultOf(actions[FleetApiActionId.GenerateKeypair]),
                    labels = labels,
                    idleMessage = labels.keypairIdle,
                )
                ResultPanel(
                    title = labels.deleteKeypair,
                    state = resultOf(actions[FleetApiActionId.DeleteKeypair]),
                    labels = labels,
                )
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(labels.uploadPem)
                    Textarea(
                        value = pem,
                        onValueChange = { pem = it },
                        hint = labels.pemPlaceholder, // parity:allow i18n input hint label
                        minLines = 4,
                    )
                    Button(
                        label = labels.uploadKey,
                        onClick = { callbacks.onUploadPublicKey(pem) },
                        variant = ButtonVariant.Secondary,
                        size = ButtonSize.Sm,
                        loading = actions[FleetApiActionId.UploadPublicKey]?.isRunning == true,
                        leadingIcon = IconUpload,
                    )
                    ResultPanel(
                        title = labels.uploadKey,
                        state = resultOf(actions[FleetApiActionId.UploadPublicKey]),
                        labels = labels,
                        idleMessage = labels.uploadIdle,
                    )
                }
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Vehicle Key Pairing
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun VehicleKeyPairingTool(
    config: UiState<FleetApiInfo>,
    labels: FleetApiLabels,
) {
    val hostname = config.data?.hostname ?: FLEET_API_DEFAULT_HOSTNAME
    val pairingUrl = pairingUrlFor(hostname)
    ToolCard(icon = IconCar, accent = IconAccent.Green, title = labels.keyPairing, description = labels.keyPairingDesc) {
        CodeRow(IconLink, pairingUrl, labels)
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radius.md))
                    .background(TeslaTokens.status.info.copy(alpha = ACCENT_WASH_ALPHA))
                    .padding(Spacing.sm),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(labels.pairingInstructions)
                PairingStep(labels.pairingStep1)
                PairingStep(labels.pairingStep2)
                PairingStep(labels.pairingStep3)
            }
        }
    }
}

@Composable
private fun PairingStep(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.Top) {
        Icon(imageVector = IconChevronRight, contentDescription = null, size = IconSize.Xs, tint = TeslaTokens.status.info)
        Caption(text, modifier = Modifier.weight(1f))
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Fleet Telemetry Subscribe
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun FleetTelemetrySubscribeTool(
    vehicles: UiState<List<VehicleOption>>,
    action: ToolActionState?,
    onSubscribe: (TelemetrySubscribeRequest) -> Unit,
    labels: FleetApiLabels,
) {
    var vin by rememberSaveable { mutableStateOf("") }
    var hostname by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf("443") }
    var caCert by rememberSaveable { mutableStateOf("") }
    var modalOpen by rememberSaveable { mutableStateOf(false) }
    var selected by remember { mutableStateOf<List<SelectedSignal>>(emptyList()) }
    val interval = selected.firstOrNull()?.interval ?: TelemetrySignalCatalog.DEFAULT_INTERVAL_SECONDS

    ToolCard(icon = IconRadio, accent = IconAccent.Cyan, title = labels.telemetrySub, description = labels.telemetrySubDesc) {
        VehicleSelect(vehicles, vin, { vin = it }, labels)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Input(
                value = hostname,
                onValueChange = { hostname = it },
                label = labels.hostname,
                leadingIcon = IconServer,
                modifier = Modifier.weight(1f),
            )
            Input(
                value = port,
                onValueChange = { port = it },
                label = labels.port,
                leadingIcon = IconNetwork,
                modifier = Modifier.weight(1f),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(labels.caCert)
            Textarea(
                value = caCert,
                onValueChange = { caCert = it },
                hint = labels.caCertPlaceholder, // parity:allow i18n input hint label
                minLines = 3,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = "${labels.configureSignals} (${selected.size})",
                onClick = { modalOpen = true },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = IconSettings,
            )
            HelperText("${labels.intervalLabel}: ${interval}s")
        }
        Button(
            label = labels.subscribe,
            onClick = {
                onSubscribe(
                    TelemetrySubscribeRequest(
                        vin = vin,
                        hostname = hostname,
                        port = port.toIntOrNull() ?: 0,
                        caCert = caCert.ifBlank { null },
                        fields = selected.map { it.name },
                        intervalSeconds = interval,
                        fieldIntervals = selected.filter { it.interval != interval }.associate { it.name to it.interval },
                    ),
                )
            },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            loading = action?.isRunning == true,
            leadingIcon = IconPlay,
        )
        ResultPanel(title = labels.telemetrySub, state = resultOf(action), labels = labels)
    }
    if (modalOpen) {
        SignalConfigModal(
            initial = selected,
            initialInterval = interval,
            labels = labels,
            onDismiss = { modalOpen = false },
            onApply = { signals ->
                selected = signals
                modalOpen = false
            },
        )
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Fleet Telemetry Config (+ errors panel)
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun FleetTelemetryConfigTool(
    vehicles: UiState<List<VehicleOption>>,
    actions: Map<FleetApiActionId, ToolActionState>,
    callbacks: FleetApiCallbacks,
    labels: FleetApiLabels,
) {
    var vin by rememberSaveable { mutableStateOf("") }
    val vinSelected = vin.isNotEmpty()
    val errorsAction = actions[FleetApiActionId.GetTelemetryErrors]
    ToolCard(icon = IconSatellite, accent = IconAccent.Purple, title = labels.telemetryConfig, description = labels.telemetryConfigDesc) {
        VehicleSelect(vehicles, vin, { vin = it }, labels)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Button(
                label = labels.getConfig,
                onClick = { callbacks.onGetTelemetryConfig(vin) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = vinSelected,
                loading = actions[FleetApiActionId.GetTelemetryConfig]?.isRunning == true,
                leadingIcon = IconEye,
            )
            Button(
                label = labels.viewErrors,
                onClick = { callbacks.onGetTelemetryErrors(vin) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = vinSelected,
                loading = errorsAction?.isRunning == true,
                leadingIcon = IconWarn,
            )
            Button(
                label = labels.deleteConfig,
                onClick = { callbacks.onDeleteTelemetryConfig(vin) },
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
                enabled = vinSelected,
                loading = actions[FleetApiActionId.DeleteTelemetryConfig]?.isRunning == true,
                leadingIcon = IconTrash,
            )
        }
        ResultPanel(
            title = labels.telemetryConfig,
            state = resultOf(actions[FleetApiActionId.GetTelemetryConfig]),
            labels = labels,
            idleMessage = labels.configIdle,
        )
        ResultPanel(
            title = labels.deleteConfig,
            state = resultOf(actions[FleetApiActionId.DeleteTelemetryConfig]),
            labels = labels,
        )
        TelemetryErrorsPanel(
            state =
                TelemetryErrorsPanelState.from(
                    loading = errorsAction?.isRunning == true,
                    response = errorsAction?.response,
                    hasRun = errorsAction is ToolActionState.Done,
                ),
            labels = labels,
        )
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Fleet Status
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun FleetStatusTool(
    vehicles: UiState<List<VehicleOption>>,
    action: ToolActionState?,
    onCheck: (List<String>) -> Unit,
    labels: FleetApiLabels,
) {
    val vins = vehicles.data?.map { it.vin } ?: emptyList()
    ToolCard(icon = IconBolt, accent = IconAccent.Green, title = labels.fleetStatus, description = labels.fleetStatusDesc) {
        Button(
            label = labels.checkFleetStatus,
            onClick = { onCheck(vins) },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = vins.isNotEmpty(),
            loading = action?.isRunning == true,
            leadingIcon = IconPlay,
        )
        ResultPanel(title = labels.fleetStatus, state = resultOf(action), labels = labels)
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Tool: Vehicle Data
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun VehicleDataTools(
    vehicles: UiState<List<VehicleOption>>,
    actions: Map<FleetApiActionId, ToolActionState>,
    onFetch: (VehicleDataKind, String) -> Unit,
    labels: FleetApiLabels,
) {
    var vin by rememberSaveable { mutableStateOf("") }
    val lastDone =
        listOf(
            FleetApiActionId.VehicleNearbyCharging,
            FleetApiActionId.VehicleReleaseNotes,
            FleetApiActionId.VehicleRecentAlerts,
            FleetApiActionId.VehicleServiceData,
        ).mapNotNull { actions[it] as? ToolActionState.Done }.lastOrNull()
    ToolCard(icon = IconCar, accent = IconAccent.Cyan, title = labels.vehicleData, description = labels.vehicleDataDesc) {
        VehicleSelect(vehicles, vin, { vin = it }, labels)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            VehicleDataButton(labels.nearbyCharging, IconLocation, actions[FleetApiActionId.VehicleNearbyCharging]) {
                onFetch(VehicleDataKind.NearbyCharging, vin)
            }
            VehicleDataButton(labels.releaseNotes, IconFileCode, actions[FleetApiActionId.VehicleReleaseNotes]) {
                onFetch(VehicleDataKind.ReleaseNotes, vin)
            }
            VehicleDataButton(labels.recentAlerts, IconWarn, actions[FleetApiActionId.VehicleRecentAlerts]) {
                onFetch(VehicleDataKind.RecentAlerts, vin)
            }
            VehicleDataButton(labels.serviceData, IconWrench, actions[FleetApiActionId.VehicleServiceData]) {
                onFetch(VehicleDataKind.ServiceData, vin)
            }
        }
        if (lastDone != null) {
            ResultPanel(title = labels.vehicleData, state = ResultPanelState.from(lastDone.response, hasRun = true), labels = labels)
        }
    }
}

@Composable
private fun VehicleDataButton(
    label: String,
    icon: ImageVector,
    action: ToolActionState?,
    onClick: () -> Unit,
) {
    Button(
        label = label,
        onClick = onClick,
        variant = ButtonVariant.Secondary,
        size = ButtonSize.Sm,
        loading = action?.isRunning == true,
        leadingIcon = icon,
    )
}

/* ═══════════════════════════════════════════════════════════════════════
   Shared tool building blocks
   ═══════════════════════════════════════════════════════════════════════ */

/** The web `ToolCard`: a GlassPanel with an accent icon box, title + description, optional freshness chip. */
@Composable
private fun ToolCard(
    icon: ImageVector,
    accent: IconAccent,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    freshness: FreshnessChipState? = null,
    onRefresh: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
            IconBox(icon = icon, accent = accent)
            Column(modifier = Modifier.weight(1f)) {
                PanelTitle(title, modifier = Modifier.semantics { heading() })
                Caption(description)
            }
            if (freshness != null) {
                DataFreshness(
                    updatedAtMillis = freshness.fetchedAt,
                    isFetching = freshness.refreshing,
                    isStale = freshness.stale,
                    isError = freshness.error,
                    compact = true,
                    fetchingLabel = stringResource(R.string.translation_freshness_updating),
                    errorLabel = stringResource(R.string.translation_freshness_error),
                )
            }
            if (onRefresh != null) {
                IconButton(
                    imageVector = FeedbackGlyphs.Refresh,
                    contentDescription = stringResource(R.string.translation_common_refresh),
                    onClick = onRefresh,
                    enabled = freshness?.refreshing != true,
                    size = IconSize.Sm,
                )
            }
        }
        Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            content()
        }
    }
}

/** A snapshot of the freshness flags for a query-backed tool header chip. */
private data class FreshnessChipState(
    val fetchedAt: Long?,
    val refreshing: Boolean,
    val stale: Boolean,
    val error: Boolean,
)

private fun UiState<*>.freshness(): FreshnessChipState =
    FreshnessChipState(fetchedAt = fetchedAt?.takeIf { it > 0 }, refreshing = refreshing, stale = stale, error = hasError)

@Composable
private fun IconBox(
    icon: ImageVector,
    accent: IconAccent,
) {
    Box(
        modifier =
            Modifier
                .width(ICON_BOX_SIZE)
                .heightIn(min = ICON_BOX_SIZE)
                .clip(RoundedCornerShape(Radius.md))
                .background(accent.color().copy(alpha = ACCENT_WASH_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg, tint = accent.color())
    }
}

/** The accent palette for tool/step icons (web `ICON_COLOR_MAP`). */
private enum class IconAccent { Cyan, Green, Purple, Amber }

@Composable
private fun IconAccent.color(): Color =
    when (this) {
        IconAccent.Cyan -> TeslaTokens.status.info
        IconAccent.Green -> TeslaTokens.status.success
        IconAccent.Purple -> MaterialTheme.colorScheme.tertiary
        IconAccent.Amber -> TeslaTokens.status.warning
    }

@Composable
private fun KeyValuePanel(
    label: String,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Caption(label)
        Box(modifier = Modifier.padding(top = Spacing.xs)) { content() }
    }
}

@Composable
private fun FieldChip(
    label: String,
    value: String,
    copyLabels: FleetApiLabels,
) {
    KeyValuePanel(label = label) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            CodeText(value.ifEmpty { FLEET_API_EM_DASH }, modifier = Modifier.weight(1f, fill = false))
            if (value.isNotEmpty()) {
                CopyButton(text = value, copyLabel = copyLabels.copy, copiedLabel = copyLabels.copied, iconOnly = true)
            }
        }
    }
}

@Composable
private fun CommandRow(
    command: String,
    labels: FleetApiLabels,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OVERLAY_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        CodeText(command, modifier = Modifier.weight(1f))
        CopyButton(text = command, copyLabel = labels.copy, copiedLabel = labels.copied, iconOnly = true)
    }
}

@Composable
private fun CodeRow(
    icon: ImageVector,
    text: String,
    labels: FleetApiLabels,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OVERLAY_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
        CodeText(text, modifier = Modifier.weight(1f))
        CopyButton(text = text, copyLabel = labels.copy, copiedLabel = labels.copied, iconOnly = true)
    }
}

@Composable
private fun VehicleSelect(
    vehicles: UiState<List<VehicleOption>>,
    vin: String,
    onSelect: (String) -> Unit,
    labels: FleetApiLabels,
) {
    val options = (vehicles.data ?: emptyList()).map { SelectOption(value = it.vin, label = it.label) }
    Select(
        options = options,
        selectedValue = vin.ifBlank { null },
        onSelect = onSelect,
        label = labels.vehicle,
        emptyLabel = labels.selectVehicle,
        enabled = !vehicles.isLoading,
    )
}

/* ═══════════════════════════════════════════════════════════════════════
   Result panel (web ResultPanel)
   ═══════════════════════════════════════════════════════════════════════ */

/** Project a tool action into its result-panel surface (web `data`/`error`/`idle` logic). */
private fun resultOf(action: ToolActionState?): ResultPanelState = ResultPanelState.from(action?.response, action is ToolActionState.Done)

@Composable
private fun ResultPanel(
    title: String,
    state: ResultPanelState,
    labels: FleetApiLabels,
    idleMessage: String? = null,
) {
    val background =
        when (state) {
            is ResultPanelState.Failure -> TeslaTokens.status.danger.copy(alpha = ACCENT_WASH_ALPHA)
            is ResultPanelState.Data -> TeslaTokens.status.success.copy(alpha = ACCENT_WASH_ALPHA)
            ResultPanelState.Idle -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SURFACE_ALPHA)
        }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(background)
                .padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(title)
            if (state is ResultPanelState.Data) {
                CopyButton(text = state.prettyJson, copyLabel = labels.copy, copiedLabel = labels.copied, iconOnly = true)
            }
        }
        when (state) {
            is ResultPanelState.Failure -> BodyText(state.message, color = TeslaTokens.status.danger)
            is ResultPanelState.Data -> PreBlock(state.prettyJson, maxHeight = RESULT_MAX_HEIGHT)
            ResultPanelState.Idle -> HelperText(idleMessage ?: labels.noResult)
        }
    }
}

@Composable
private fun PreBlock(
    text: String,
    maxHeight: androidx.compose.ui.unit.Dp,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = maxHeight)
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OVERLAY_ALPHA))
                .verticalScroll(rememberScrollState())
                .padding(Spacing.sm),
    ) {
        CodeText(text)
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Telemetry errors panel (web TelemetryErrorsPanel) — 5 states
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun TelemetryErrorsPanel(
    state: TelemetryErrorsPanelState,
    labels: FleetApiLabels,
) {
    val title = labels.telemetryErrors
    when (state) {
        TelemetryErrorsPanelState.Idle ->
            PanelSurface(SURFACE_ALPHA) {
                Caption(title)
                HelperText(labels.errorsIdle)
            }

        TelemetryErrorsPanelState.Loading ->
            PanelSurface(SURFACE_ALPHA) {
                Caption(title)
                SkeletonLines(3)
            }

        is TelemetryErrorsPanelState.Failure ->
            PanelSurface(alpha = ACCENT_WASH_ALPHA, danger = true) {
                Caption(title)
                BodyText(state.message, color = TeslaTokens.status.danger)
            }

        is TelemetryErrorsPanelState.Empty ->
            PanelSurface(SURFACE_ALPHA) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption(title)
                    Badge(
                        text = if (state.ok) "0" else "?",
                        variant = if (state.ok) BadgeVariant.Success else BadgeVariant.Warning,
                        dot = true,
                    )
                }
                BodyText(labels.errorsEmpty)
                val raw = state.rawJson
                if (raw != null) {
                    var expanded by remember { mutableStateOf(false) }
                    HelperText(
                        labels.errorsRaw,
                        modifier = Modifier.clickableStep { expanded = !expanded },
                    )
                    if (expanded) {
                        PreBlock(raw, maxHeight = RESULT_MAX_HEIGHT)
                    }
                }
            }

        is TelemetryErrorsPanelState.Rows ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                TelemetryErrorsTable(state.rows, labels)
                val json = remember(state.rows) { FleetApiJson.pretty(telemetryErrorsToJson(state.rows)) }
                CopyButton(
                    text = json,
                    copyLabel = labels.downloadErrors,
                    copiedLabel = labels.copied,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
    }
}

@Composable
private fun TelemetryErrorsTable(
    rows: List<TelemetryErrorRow>,
    labels: FleetApiLabels,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(labels.timestamp, modifier = Modifier.weight(1.4f))
            Caption(labels.code, modifier = Modifier.weight(1f))
            Caption(labels.message, modifier = Modifier.weight(1.6f))
        }
        rows.forEach { row ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Radius.sm))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SURFACE_ALPHA))
                        .padding(horizontal = Spacing.xs, vertical = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(row.timestamp.ifEmpty { FLEET_API_EM_DASH }, modifier = Modifier.weight(1.4f))
                Box(modifier = Modifier.weight(1f)) {
                    if (row.code.isNotEmpty()) {
                        Badge(text = row.code, variant = BadgeVariant.Danger)
                    } else {
                        Caption(FLEET_API_EM_DASH)
                    }
                }
                Caption(row.message.ifEmpty { FLEET_API_EM_DASH }, modifier = Modifier.weight(1.6f))
            }
        }
    }
}

@Composable
private fun PanelSurface(
    alpha: Float,
    danger: Boolean = false,
    content: @Composable () -> Unit,
) {
    val color = if (danger) TeslaTokens.status.danger else MaterialTheme.colorScheme.surfaceVariant
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(color.copy(alpha = alpha))
                .padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        content()
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Signal config modal (web SignalConfigModal)
   ═══════════════════════════════════════════════════════════════════════ */

/** One selected telemetry signal + its per-field sampling interval (web `{ name, interval }`). */
data class SelectedSignal(
    val name: String,
    val interval: Int,
)

@Composable
private fun SignalConfigModal(
    initial: List<SelectedSignal>,
    initialInterval: Int,
    labels: FleetApiLabels,
    onDismiss: () -> Unit,
    onApply: (List<SelectedSignal>) -> Unit,
) {
    var selectedNames by remember { mutableStateOf(initial.map { it.name }.toSet()) }
    var intervalText by rememberSaveable { mutableStateOf(initialInterval.toString()) }
    Modal(onDismissRequest = onDismiss, title = labels.configureSignals, closeLabel = labels.cancel) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Input(
                value = intervalText,
                onValueChange = { intervalText = it },
                label = labels.intervalLabel,
                keyboardType = KeyboardType.Number,
            )
            TelemetrySignalCatalog.categories.forEach { category ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(category.category)
                    category.fields.forEach { field ->
                        Checkbox(
                            checked = field in selectedNames,
                            onCheckedChange = { checked ->
                                selectedNames = if (checked) selectedNames + field else selectedNames - field
                            },
                            label = field,
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(label = labels.cancel, onClick = onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                Button(
                    label = labels.apply,
                    onClick = {
                        val interval = intervalText.toIntOrNull() ?: TelemetrySignalCatalog.DEFAULT_INTERVAL_SECONDS
                        onApply(selectedNames.map { SelectedSignal(it, interval) })
                    },
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = IconCheck,
                )
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   Small shared pieces
   ═══════════════════════════════════════════════════════════════════════ */

@Composable
private fun ProgressBar(fraction: Float) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = PROGRESS_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .heightIn(min = PROGRESS_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(TeslaTokens.status.info),
        )
    }
}

@Composable
private fun SkeletonLines(count: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        repeat(count) { Skeleton(height = 14.dp, rounded = true) }
    }
}

private fun Modifier.clickableStep(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

private fun telemetryErrorsToJson(rows: List<TelemetryErrorRow>): kotlinx.serialization.json.JsonElement =
    kotlinx.serialization.json.JsonArray(
        rows.map { row ->
            kotlinx.serialization.json.buildJsonObject {
                put("timestamp", kotlinx.serialization.json.JsonPrimitive(row.timestamp))
                put("code", kotlinx.serialization.json.JsonPrimitive(row.code))
                put("message", kotlinx.serialization.json.JsonPrimitive(row.message))
            }
        },
    )

/* ═══════════════════════════════════════════════════════════════════════
   i18n labels (P1/S10) — every rendered string resolves here
   ═══════════════════════════════════════════════════════════════════════ */

/** Every localized string the surface renders, resolved at the Compose boundary (P1/S10 facade). */
data class FleetApiLabels(
    val setupWizard: String,
    val toolsTitle: String,
    val loadFailed: String,
    val progress: String,
    val previous: String,
    val next: String,
    val completed: String,
    val markComplete: String,
    val config: String,
    val configDesc: String,
    val baseUrl: String,
    val clientId: String,
    val authStatus: String,
    val authenticated: String,
    val notAuthenticated: String,
    val regions: String,
    val partnerReg: String,
    val partnerRegDesc: String,
    val prerequisites: String,
    val prerequisitesDesc: String,
    val opensslCommands: String,
    val domain: String,
    val register: String,
    val partnerKeyTitle: String,
    val partnerKeyDesc: String,
    val verify: String,
    val keyRegistered: String,
    val keyNotFound: String,
    val matchesLocal: String,
    val mismatch: String,
    val noLocal: String,
    val pemLabel: String,
    val rawResponse: String,
    val publicKey: String,
    val publicKeyDesc: String,
    val status: String,
    val configured: String,
    val notConfigured: String,
    val privateKeyWarning: String,
    val generateKeypair: String,
    val deleteKeypair: String,
    val keypairIdle: String,
    val uploadPem: String,
    val pemPlaceholder: String, // parity:allow i18n input hint label
    val uploadKey: String,
    val uploadIdle: String,
    val keyPairing: String,
    val keyPairingDesc: String,
    val pairingInstructions: String,
    val pairingStep1: String,
    val pairingStep2: String,
    val pairingStep3: String,
    val telemetrySub: String,
    val telemetrySubDesc: String,
    val vehicle: String,
    val selectVehicle: String,
    val hostname: String,
    val port: String,
    val caCert: String,
    val caCertPlaceholder: String, // parity:allow i18n input hint label
    val configureSignals: String,
    val intervalLabel: String,
    val subscribe: String,
    val telemetryConfig: String,
    val telemetryConfigDesc: String,
    val getConfig: String,
    val viewErrors: String,
    val deleteConfig: String,
    val configIdle: String,
    val telemetryErrors: String,
    val timestamp: String,
    val code: String,
    val message: String,
    val errorsIdle: String,
    val errorsEmpty: String,
    val errorsRaw: String,
    val downloadErrors: String,
    val fleetStatus: String,
    val fleetStatusDesc: String,
    val checkFleetStatus: String,
    val vehicleData: String,
    val vehicleDataDesc: String,
    val nearbyCharging: String,
    val releaseNotes: String,
    val recentAlerts: String,
    val serviceData: String,
    val noResult: String,
    val cancel: String,
    val apply: String,
    val copy: String,
    val copied: String,
    val stepLabels: Map<OnboardingStepId, String>,
    val stepDescriptions: Map<OnboardingStepId, String>,
) {
    /** The localized label for [step] (web `ONBOARDING_STEPS[].label`). */
    fun stepLabelText(step: OnboardingStepId): String = stepLabels[step] ?: step.slug

    /** The localized description for [step] (web `ONBOARDING_STEPS[].desc`). */
    fun stepDescText(step: OnboardingStepId): String = stepDescriptions[step] ?: step.slug
}

/** Resolves every [FleetApiLabels] string from the P1/S10 catalog at the Compose boundary. */
@Composable
private fun rememberFleetApiLabels(): FleetApiLabels =
    FleetApiLabels(
        setupWizard = stringResource(R.string.translation_devtools_fleet_setupWizard),
        toolsTitle = stringResource(R.string.translation_devtools_fleet_toolsTitle),
        loadFailed = stringResource(R.string.translation_error_loadFailed),
        progress = stringResource(R.string.translation_Progress),
        previous = stringResource(R.string.translation_Previous),
        next = stringResource(R.string.translation_Next),
        completed = stringResource(R.string.translation_Completed),
        markComplete = stringResource(R.string.translation_Mark_Complete),
        config = stringResource(R.string.translation_Config),
        configDesc = stringResource(R.string.translation_Config_Desc),
        baseUrl = stringResource(R.string.translation_Base_Url),
        clientId = stringResource(R.string.translation_Client_Id),
        authStatus = stringResource(R.string.translation_Auth_Status),
        authenticated = stringResource(R.string.translation_Authenticated),
        notAuthenticated = stringResource(R.string.translation_Not_Authenticated),
        regions = stringResource(R.string.translation_Regions),
        partnerReg = stringResource(R.string.translation_Partner_Reg),
        partnerRegDesc = stringResource(R.string.translation_Partner_Reg_Desc),
        prerequisites = stringResource(R.string.translation_Prerequisites),
        prerequisitesDesc = stringResource(R.string.translation_Prerequisites_Desc),
        opensslCommands = stringResource(R.string.translation_Openssl_Commands),
        domain = stringResource(R.string.translation_Domain),
        register = stringResource(R.string.translation_Register),
        partnerKeyTitle = stringResource(R.string.translation_devtools_partnerKey_title),
        partnerKeyDesc = stringResource(R.string.translation_devtools_partnerKey_desc),
        verify = stringResource(R.string.translation_devtools_partnerKey_verify),
        keyRegistered = stringResource(R.string.translation_devtools_partnerKey_keyRegistered),
        keyNotFound = stringResource(R.string.translation_devtools_partnerKey_keyNotFound),
        matchesLocal = stringResource(R.string.translation_devtools_partnerKey_matchesLocal),
        mismatch = stringResource(R.string.translation_devtools_partnerKey_mismatch),
        noLocal = stringResource(R.string.translation_devtools_partnerKey_noLocal),
        pemLabel = stringResource(R.string.translation_devtools_partnerKey_pemLabel),
        rawResponse = stringResource(R.string.translation_devtools_partnerKey_rawResponse),
        publicKey = stringResource(R.string.translation_Public_Key),
        publicKeyDesc = stringResource(R.string.translation_Public_Key_Desc),
        status = stringResource(R.string.translation_Status),
        configured = stringResource(R.string.translation_Configured),
        notConfigured = stringResource(R.string.translation_Not_Configured),
        privateKeyWarning = stringResource(R.string.translation_Private_Key_Warning),
        generateKeypair = stringResource(R.string.translation_Generate_Keypair),
        deleteKeypair = stringResource(R.string.translation_Delete_Keypair),
        keypairIdle = stringResource(R.string.translation_devtools_keypairIdle),
        uploadPem = stringResource(R.string.translation_Upload_Pem),
        pemPlaceholder = stringResource(R.string.translation_Pem_Placeholder), // parity:allow i18n input hint label
        uploadKey = stringResource(R.string.translation_Upload_Key),
        uploadIdle = stringResource(R.string.translation_devtools_uploadIdle),
        keyPairing = stringResource(R.string.translation_Key_Pairing),
        keyPairingDesc = stringResource(R.string.translation_Key_Pairing_Desc),
        pairingInstructions = stringResource(R.string.translation_Pairing_Instructions),
        pairingStep1 = stringResource(R.string.translation_devtools_fleet_pairingStep1),
        pairingStep2 = stringResource(R.string.translation_devtools_fleet_pairingStep2),
        pairingStep3 = stringResource(R.string.translation_devtools_fleet_pairingStep3),
        telemetrySub = stringResource(R.string.translation_Telemetry_Sub),
        telemetrySubDesc = stringResource(R.string.translation_Telemetry_Sub_Desc),
        vehicle = stringResource(R.string.translation_Vehicle),
        selectVehicle = stringResource(R.string.translation_Select_Vehicle),
        hostname = stringResource(R.string.translation_Hostname),
        port = stringResource(R.string.translation_Port),
        caCert = stringResource(R.string.translation_Ca_Cert),
        caCertPlaceholder = stringResource(R.string.translation_Ca_Cert_Placeholder), // parity:allow i18n input hint label
        configureSignals = stringResource(R.string.translation_Configure_Signals),
        intervalLabel = stringResource(R.string.translation_Interval_Label),
        subscribe = stringResource(R.string.translation_Subscribe),
        telemetryConfig = stringResource(R.string.translation_Telemetry_Config),
        telemetryConfigDesc = stringResource(R.string.translation_Telemetry_Config_Desc),
        getConfig = stringResource(R.string.translation_Get_Config),
        viewErrors = stringResource(R.string.translation_View_Errors),
        deleteConfig = stringResource(R.string.translation_Delete_Config),
        configIdle = stringResource(R.string.translation_devtools_configIdle),
        telemetryErrors = stringResource(R.string.translation_widget_telemetryErrors_title),
        timestamp = stringResource(R.string.translation_Timestamp),
        code = stringResource(R.string.translation_Code),
        message = stringResource(R.string.translation_Message),
        errorsIdle = stringResource(R.string.translation_devtools_errorsIdle),
        errorsEmpty = stringResource(R.string.translation_devtools_errorsEmpty),
        errorsRaw = stringResource(R.string.translation_devtools_errorsRaw),
        downloadErrors = stringResource(R.string.translation_Download_Errors),
        fleetStatus = stringResource(R.string.translation_Fleet_Status),
        fleetStatusDesc = stringResource(R.string.translation_Check_fleet_status_for_all_vehicles),
        checkFleetStatus = stringResource(R.string.translation_Check_Fleet_Status),
        vehicleData = stringResource(R.string.translation_Vehicle_Data),
        vehicleDataDesc = stringResource(R.string.translation_Vehicle_Data_Desc),
        nearbyCharging = stringResource(R.string.translation_Nearby_Charging),
        releaseNotes = stringResource(R.string.translation_Release_Notes),
        recentAlerts = stringResource(R.string.translation_Recent_Alerts),
        serviceData = stringResource(R.string.translation_Service_Data),
        noResult = stringResource(R.string.translation_devtools_noResult),
        cancel = stringResource(R.string.translation_Cancel),
        apply = stringResource(R.string.translation_Apply),
        copy = stringResource(R.string.translation_Copy),
        copied = stringResource(R.string.translation_Copied),
        stepLabels =
            mapOf(
                OnboardingStepId.Account to stringResource(R.string.translation_devtools_onboarding_account_label),
                OnboardingStepId.Application to stringResource(R.string.translation_devtools_onboarding_application_label),
                OnboardingStepId.Keypair to stringResource(R.string.translation_devtools_onboarding_keypair_label),
                OnboardingStepId.Register to stringResource(R.string.translation_devtools_onboarding_register_label),
                OnboardingStepId.Auth to stringResource(R.string.translation_devtools_onboarding_auth_label),
                OnboardingStepId.Pair to stringResource(R.string.translation_devtools_onboarding_pair_label),
                OnboardingStepId.Telemetry to stringResource(R.string.translation_devtools_onboarding_telemetry_label),
            ),
        stepDescriptions =
            mapOf(
                OnboardingStepId.Account to stringResource(R.string.translation_devtools_onboarding_account_desc),
                OnboardingStepId.Application to stringResource(R.string.translation_devtools_onboarding_application_desc),
                OnboardingStepId.Keypair to stringResource(R.string.translation_devtools_onboarding_keypair_desc),
                OnboardingStepId.Register to stringResource(R.string.translation_devtools_onboarding_register_desc),
                OnboardingStepId.Auth to stringResource(R.string.translation_devtools_onboarding_auth_desc),
                OnboardingStepId.Pair to stringResource(R.string.translation_devtools_onboarding_pair_desc),
                OnboardingStepId.Telemetry to stringResource(R.string.translation_devtools_onboarding_telemetry_desc),
            ),
    )

private fun stepIcon(step: OnboardingStepId): ImageVector =
    when (step) {
        OnboardingStepId.Account -> IconKeyRound
        OnboardingStepId.Application -> IconFileCode
        OnboardingStepId.Keypair -> IconKey
        OnboardingStepId.Register -> IconGlobe
        OnboardingStepId.Auth -> IconShield
        OnboardingStepId.Pair -> IconLink
        OnboardingStepId.Telemetry -> IconRadio
    }

/* ═══════════════════════════════════════════════════════════════════════
   Locally-authored stroked icons (the web `lucide-react` glyphs)
   The app's shared glyph objects are out of this surface's allowed files, so — exactly as the sibling
   dashboard-widgets do — the needed 24×24 stroked vectors are authored here and recolored at render.
   ═══════════════════════════════════════════════════════════════════════ */

private fun lucideIcon(
    name: String,
    block: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = block,
            )
        }.build()

private val IconSettings: ImageVector =
    lucideIcon("Settings") {
        moveTo(12f, 9f)
        arcToRelative(3f, 3f, 0f, true, true, 0f, 6f)
        arcToRelative(3f, 3f, 0f, true, true, 0f, -6f)
        close()
        moveTo(12f, 2f)
        lineTo(12f, 5f)
        moveTo(12f, 19f)
        lineTo(12f, 22f)
        moveTo(2f, 12f)
        lineTo(5f, 12f)
        moveTo(19f, 12f)
        lineTo(22f, 12f)
    }

private val IconGlobe: ImageVector =
    lucideIcon("Globe") {
        moveTo(12f, 3f)
        arcToRelative(9f, 9f, 0f, true, true, 0f, 18f)
        arcToRelative(9f, 9f, 0f, true, true, 0f, -18f)
        close()
        moveTo(3f, 12f)
        lineTo(21f, 12f)
        moveTo(12f, 3f)
        arcToRelative(14f, 14f, 0f, false, true, 0f, 18f)
        arcToRelative(14f, 14f, 0f, false, true, 0f, -18f)
        close()
    }

private val IconShield: ImageVector =
    lucideIcon("Shield") {
        moveTo(12f, 3f)
        lineTo(20f, 6f)
        lineTo(20f, 11f)
        curveTo(20f, 16f, 16f, 20f, 12f, 21f)
        curveTo(8f, 20f, 4f, 16f, 4f, 11f)
        lineTo(4f, 6f)
        close()
    }

private val IconKey: ImageVector =
    lucideIcon("Key") {
        moveTo(15f, 7f)
        arcToRelative(4f, 4f, 0f, true, true, 0f, 8f)
        arcToRelative(4f, 4f, 0f, true, true, 0f, -8f)
        close()
        moveTo(11f, 11f)
        lineTo(3f, 19f)
        moveTo(6f, 16f)
        lineTo(8f, 18f)
    }

private val IconKeyRound: ImageVector =
    lucideIcon("KeyRound") {
        moveTo(15f, 4f)
        arcToRelative(5f, 5f, 0f, true, true, -4.5f, 7f)
        lineTo(4f, 17.5f)
        lineTo(4f, 21f)
        lineTo(7.5f, 21f)
        lineTo(11f, 17.5f)
        close()
    }

private val IconCar: ImageVector =
    lucideIcon("Car") {
        moveTo(5f, 11f)
        lineTo(7f, 6f)
        lineTo(17f, 6f)
        lineTo(19f, 11f)
        lineTo(19f, 16f)
        lineTo(5f, 16f)
        close()
        moveTo(7.5f, 16f)
        arcToRelative(1.5f, 1.5f, 0f, true, true, 0f, 0.01f)
        close()
        moveTo(16.5f, 16f)
        arcToRelative(1.5f, 1.5f, 0f, true, true, 0f, 0.01f)
        close()
    }

private val IconRadio: ImageVector =
    lucideIcon("Radio") {
        moveTo(12f, 11f)
        arcToRelative(1f, 1f, 0f, true, true, 0f, 2f)
        arcToRelative(1f, 1f, 0f, true, true, 0f, -2f)
        close()
        moveTo(8f, 8f)
        arcToRelative(6f, 6f, 0f, false, false, 0f, 8f)
        moveTo(16f, 8f)
        arcToRelative(6f, 6f, 0f, false, true, 0f, 8f)
    }

private val IconSatellite: ImageVector =
    lucideIcon("Satellite") {
        moveTo(4f, 14f)
        lineTo(10f, 20f)
        lineTo(13f, 17f)
        lineTo(7f, 11f)
        close()
        moveTo(14f, 10f)
        lineTo(20f, 4f)
        moveTo(13f, 7f)
        arcToRelative(4f, 4f, 0f, false, true, 4f, 4f)
    }

private val IconBolt: ImageVector =
    lucideIcon("Bolt") {
        moveTo(13f, 2f)
        lineTo(4f, 14f)
        lineTo(11f, 14f)
        lineTo(10f, 22f)
        lineTo(20f, 9f)
        lineTo(13f, 9f)
        close()
    }

private val IconLink: ImageVector =
    lucideIcon("Link") {
        moveTo(10f, 13f)
        arcToRelative(3f, 3f, 0f, false, false, 4f, 0f)
        lineTo(17f, 10f)
        arcToRelative(3f, 3f, 0f, false, false, -4f, -4f)
        lineTo(11f, 8f)
        moveTo(14f, 11f)
        arcToRelative(3f, 3f, 0f, false, false, -4f, 0f)
        lineTo(7f, 14f)
        arcToRelative(3f, 3f, 0f, false, false, 4f, 4f)
        lineTo(13f, 16f)
    }

private val IconFileCode: ImageVector =
    lucideIcon("FileCode") {
        moveTo(6f, 3f)
        lineTo(14f, 3f)
        lineTo(19f, 8f)
        lineTo(19f, 21f)
        lineTo(6f, 21f)
        close()
        moveTo(10f, 12f)
        lineTo(8f, 14f)
        lineTo(10f, 16f)
        moveTo(14f, 12f)
        lineTo(16f, 14f)
        lineTo(14f, 16f)
    }

private val IconCheck: ImageVector =
    lucideIcon("Check") {
        moveTo(20f, 6f)
        lineTo(9f, 17f)
        lineTo(4f, 12f)
    }

private val IconWarn: ImageVector =
    lucideIcon("Warn") {
        moveTo(12f, 3f)
        lineTo(22f, 20f)
        lineTo(2f, 20f)
        close()
        moveTo(12f, 9f)
        lineTo(12f, 14f)
        moveTo(12f, 17f)
        lineToRelative(0.01f, 0f)
    }

private val IconPlay: ImageVector =
    lucideIcon("Play") {
        moveTo(6f, 4f)
        lineTo(20f, 12f)
        lineTo(6f, 20f)
        close()
    }

private val IconUpload: ImageVector =
    lucideIcon("Upload") {
        moveTo(4f, 16f)
        lineTo(4f, 20f)
        lineTo(20f, 20f)
        lineTo(20f, 16f)
        moveTo(12f, 16f)
        lineTo(12f, 4f)
        moveTo(7f, 9f)
        lineTo(12f, 4f)
        lineTo(17f, 9f)
    }

private val IconTrash: ImageVector =
    lucideIcon("Trash") {
        moveTo(4f, 7f)
        lineTo(20f, 7f)
        moveTo(9f, 7f)
        lineTo(9f, 4f)
        lineTo(15f, 4f)
        lineTo(15f, 7f)
        moveTo(6f, 7f)
        lineTo(7f, 20f)
        lineTo(17f, 20f)
        lineTo(18f, 7f)
    }

private val IconChevronLeft: ImageVector =
    lucideIcon("ChevronLeft") {
        moveTo(15f, 6f)
        lineTo(9f, 12f)
        lineTo(15f, 18f)
    }

private val IconChevronRight: ImageVector =
    lucideIcon("ChevronRight") {
        moveTo(9f, 6f)
        lineTo(15f, 12f)
        lineTo(9f, 18f)
    }

private val IconServer: ImageVector =
    lucideIcon("Server") {
        moveTo(4f, 4f)
        lineTo(20f, 4f)
        lineTo(20f, 9f)
        lineTo(4f, 9f)
        close()
        moveTo(4f, 13f)
        lineTo(20f, 13f)
        lineTo(20f, 18f)
        lineTo(4f, 18f)
        close()
    }

private val IconNetwork: ImageVector =
    lucideIcon("Network") {
        moveTo(9f, 3f)
        lineTo(15f, 3f)
        lineTo(15f, 7f)
        lineTo(9f, 7f)
        close()
        moveTo(12f, 7f)
        lineTo(12f, 12f)
        moveTo(5f, 17f)
        lineTo(19f, 17f)
        moveTo(5f, 17f)
        lineTo(5f, 12f)
        lineTo(19f, 12f)
        lineTo(19f, 17f)
    }

private val IconFingerprint: ImageVector =
    lucideIcon("Fingerprint") {
        moveTo(7f, 9f)
        arcToRelative(6f, 6f, 0f, false, true, 10f, 0f)
        moveTo(9f, 12f)
        arcToRelative(4f, 4f, 0f, false, true, 6f, 0f)
        moveTo(12f, 14f)
        lineTo(12f, 19f)
    }

private val IconLocation: ImageVector =
    lucideIcon("Location") {
        moveTo(12f, 3f)
        arcToRelative(6f, 6f, 0f, false, true, 6f, 6f)
        curveTo(18f, 14f, 12f, 21f, 12f, 21f)
        curveTo(12f, 21f, 6f, 14f, 6f, 9f)
        arcToRelative(6f, 6f, 0f, false, true, 6f, -6f)
        close()
        moveTo(12f, 7f)
        arcToRelative(2f, 2f, 0f, true, true, 0f, 4f)
        arcToRelative(2f, 2f, 0f, true, true, 0f, -4f)
        close()
    }

private val IconEye: ImageVector =
    lucideIcon("Eye") {
        moveTo(2f, 12f)
        curveTo(5f, 6f, 19f, 6f, 22f, 12f)
        curveTo(19f, 18f, 5f, 18f, 2f, 12f)
        close()
        moveTo(12f, 9f)
        arcToRelative(3f, 3f, 0f, true, true, 0f, 6f)
        arcToRelative(3f, 3f, 0f, true, true, 0f, -6f)
        close()
    }

private val IconWrench: ImageVector =
    lucideIcon("Wrench") {
        moveTo(14f, 7f)
        arcToRelative(4f, 4f, 0f, false, false, -5f, 5f)
        lineTo(4f, 17f)
        lineTo(7f, 20f)
        lineTo(12f, 15f)
        arcToRelative(4f, 4f, 0f, false, false, 5f, -5f)
        lineTo(14f, 10f)
        lineTo(14f, 7f)
        close()
    }

/* ═══════════════════════════════════════════════════════════════════════
   Previews
   ═══════════════════════════════════════════════════════════════════════ */

private fun previewVehicles(): List<VehicleOption> =
    listOf(VehicleOption("5YJ3E1EA1KF000001", "Model 3"), VehicleOption("7SAYGDEE9PF000002", "Model Y"))

private fun previewInfo(): FleetApiInfo = FleetApiInfo("https://fleet.tesla.com", "abc-123", true, listOf("na", "eu"), "app.example.com")

private fun previewStatus(): PublicKeyStatus = PublicKeyStatus(true, "SHA256:ab12", "https://app.example.com/.well-known/key")

private fun previewWizard(): WizardDisplay =
    WizardProjection.project(WizardInputs(mapOf(OnboardingStepId.Account to true, OnboardingStepId.Keypair to true), 2))

@Preview(name = "Fleet API Section — content", showBackground = true, heightDp = 1600)
@Composable
private fun FleetApiSectionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetApiSectionContent(
            config = UiState(UiPhase.Content, data = previewInfo(), fetchedAt = 1L),
            status = UiState(UiPhase.Content, data = previewStatus(), fetchedAt = 1L),
            vehicles = UiState(UiPhase.Content, data = previewVehicles(), fetchedAt = 1L),
            wizard = previewWizard(),
            actions = emptyMap(),
            callbacks = FleetApiCallbacks.NONE,
        )
    }
}

@Preview(name = "Fleet API Section — loading", showBackground = true, heightDp = 1200)
@Composable
private fun FleetApiSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetApiSectionContent(
            config = UiState(UiPhase.Loading),
            status = UiState(UiPhase.Loading),
            vehicles = UiState(UiPhase.Loading),
            wizard = WizardProjection.project(WizardInputs(emptyMap(), 0)),
            actions = emptyMap(),
            callbacks = FleetApiCallbacks.NONE,
        )
    }
}
