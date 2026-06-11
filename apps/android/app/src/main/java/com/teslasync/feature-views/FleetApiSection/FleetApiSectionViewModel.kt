// UI-thread-free state holder backing the Fleet API devtools surface — the native port of the web
// component's hook composition (web/src/features/admin/components/devtools/FleetApiSection.tsx). It binds
// the shared dev-tools + vehicle-options ports (P1/S8) and the persisted onboarding store, projecting
// the two cached queries (fleet-api-info, public-key-status) and the vehicle list onto the shared
// [UiState] surface, driving the onboarding wizard (progress + auto-detection + step navigation), and
// running every per-tool mutation through a keyed action map (the web `useMutation` analogue). The view
// never performs HTTP — it only collects state and calls the trigger methods. Every diagnostic is
// PII-safe (action id names only; never a VIN, domain, or PEM).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetApiSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetapi

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** Stable identifier for each per-tool action, keying the action-state map + the PII-safe diagnostic. */
enum class FleetApiActionId {
    RegisterPartner,
    VerifyPartnerKey,
    GenerateKeypair,
    DeleteKeypair,
    UploadPublicKey,
    SubscribeTelemetry,
    GetTelemetryConfig,
    GetTelemetryErrors,
    DeleteTelemetryConfig,
    FleetStatus,
    VehicleNearbyCharging,
    VehicleReleaseNotes,
    VehicleRecentAlerts,
    VehicleServiceData,
}

/** The lifecycle of one per-tool action — the native analogue of a web `useMutation` (idle → pending → data). */
sealed interface ToolActionState {
    data object Idle : ToolActionState

    data object Running : ToolActionState

    data class Done(
        override val response: FleetApiResponse,
    ) : ToolActionState

    /** True while the action is in flight (web `mutation.isPending`) — drives button spinners. */
    val isRunning: Boolean get() = this is Running

    /** The completed response, or `null` when not yet run (web `mutation.data`). */
    val response: FleetApiResponse? get() = (this as? Done)?.response
}

/** A non-throwing query failure carrying the upstream message (for the freshness chip + AlertBanner). */
class FleetApiQueryException(
    message: String,
) : Exception(message)

/**
 * Lifecycle-aware state holder for the Compose [FleetApiSection]. Owns no networking: the two cached
 * queries + vehicle list flow through [BaseFeedViewModel.asUiState] (so the screen stays a stateless
 * Composable), the wizard combines the persisted completion map with the focused step, and each tool
 * action runs through [runAction] into the keyed [actions] map. Keypair mutations invalidate the
 * public-key-status query exactly like the web `queryClient.invalidateQueries`.
 *
 * @param devTools the dev-tools port (shared adapter ↔ test fake); never performs HTTP in the view.
 * @param vehicles the vehicle-options port (web `useVehicleOptions`).
 * @param onboarding the persisted onboarding-completion store (web `localStorage`).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param now wall-clock seam for freshness stamps; tests inject a fixed instant.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@Suppress("LongParameterList")
class FleetApiSectionViewModel(
    private val devTools: FleetApiDevToolsPort,
    private val vehicles: VehicleOptionsPort,
    private val onboarding: FleetApiOnboardingStore,
    logger: Logger,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val configResource = MutableStateFlow<Resource<FleetApiInfo>>(loadingResource())
    private val statusResource = MutableStateFlow<Resource<PublicKeyStatus>>(loadingResource())
    private val vehiclesResource = MutableStateFlow<Resource<List<VehicleOption>>>(loadingResource())
    private val currentStepIndex = MutableStateFlow(0)
    private val actionStates = MutableStateFlow<Map<FleetApiActionId, ToolActionState>>(emptyMap())
    private var viewOpenedRecorded = false

    /** The `fleet-api-info` query as [UiState] (loading / content / error / stale-offline). Never empty. */
    val fleetApiInfo: StateFlow<UiState<FleetApiInfo>> = configResource.asUiState { false }

    /** The `public-key-status` query as [UiState] (loading / content / error / stale-offline). Never empty. */
    val publicKeyStatus: StateFlow<UiState<PublicKeyStatus>> = statusResource.asUiState { false }

    /** The selectable vehicle list as [UiState] (loading / content / empty / error). */
    val vehicleOptions: StateFlow<UiState<List<VehicleOption>>> = vehiclesResource.asUiState { it.isEmpty() }

    /** The render-ready onboarding wizard view, combining the persisted completion map + focused step. */
    val wizard: StateFlow<WizardDisplay> =
        combine(currentStepIndex, onboarding.completed) { index, completed ->
            WizardProjection.project(WizardInputs(completed, index))
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = WizardProjection.project(WizardInputs(onboarding.completed.value, currentStepIndex.value)),
        )

    /** The per-tool action states keyed by [FleetApiActionId] (web `useMutation` results). */
    val actions: StateFlow<Map<FleetApiActionId, ToolActionState>> = actionStates.asStateFlow()

    init {
        loadConfig()
        loadStatus()
        loadVehicles()
        observeAutoDetect()
    }

    // ── queries ────────────────────────────────────────────────────────────

    /** Re-runs the `fleet-api-info` load (the freshness chip refresh affordance). */
    fun refreshConfig() {
        logger.info("fleetApi.refresh", mapOf("query" to "config"))
        loadConfig()
    }

    /** Re-runs the `public-key-status` load (refresh + post-mutation invalidation). */
    fun refreshStatus() {
        logger.info("fleetApi.refresh", mapOf("query" to "status"))
        loadStatus()
    }

    /** Re-runs the vehicle-options load (refresh affordance). */
    fun refreshVehicles() {
        logger.info("fleetApi.refresh", mapOf("query" to "vehicles"))
        loadVehicles()
    }

    private fun loadConfig() =
        launch {
            val previous = configResource.value.cached
            configResource.value = Resource.Loading(previous, now(), previous != null)
            configResource.value = devTools.fleetApiInfo().toQueryResource(previous) { FleetApiInfo.from(it) }
        }

    private fun loadStatus() =
        launch {
            val previous = statusResource.value.cached
            statusResource.value = Resource.Loading(previous, now(), previous != null)
            statusResource.value = devTools.publicKeyStatus().toQueryResource(previous) { PublicKeyStatus.from(it) }
        }

    private fun loadVehicles() =
        launch {
            val previous = vehiclesResource.value.cached
            vehiclesResource.value = Resource.Loading(previous, now(), previous != null)
            vehiclesResource.value =
                vehicles.vehicleOptions().fold(
                    onSuccess = { Resource.Success(it, now(), false) },
                    onFailure = { error -> Resource.Error(previous, now(), previous != null, error) },
                )
        }

    /** Fold a dev-tools query response into a cache-then-network [Resource] preserving the [previous] cache. */
    private fun <T> FleetApiResponse.toQueryResource(
        previous: T?,
        project: (FleetApiResponse) -> T,
    ): Resource<T> =
        if (isError) {
            Resource.Error(previous, now(), previous != null, FleetApiQueryException(error ?: "error"))
        } else {
            Resource.Success(project(this), now(), false)
        }

    // ── onboarding wizard ──────────────────────────────────────────────────

    /** Focuses step [index] (web step-indicator tap → `setCurrentStep`). */
    fun selectStep(index: Int) {
        currentStepIndex.value = index.coerceIn(0, OnboardingStepId.ordered.lastIndex)
    }

    /** Advances the focused step (web Next button). */
    fun nextStep() {
        currentStepIndex.update { (it + 1).coerceAtMost(OnboardingStepId.ordered.lastIndex) }
    }

    /** Returns to the previous focused step (web Previous button). */
    fun previousStep() {
        currentStepIndex.update { (it - 1).coerceAtLeast(0) }
    }

    /** Marks the focused step complete + advances (web `markComplete`); persists the merged map. */
    fun markCurrentStepComplete() {
        logger.info("fleetApi.wizard.markComplete")
        val (merged, next) = WizardProjection.markComplete(onboarding.completed.value, currentStepIndex.value)
        currentStepIndex.value = next
        launch { onboarding.save(merged) }
    }

    /** Folds the auto-detected completions (web effect) into the persisted store whenever they change. */
    private fun observeAutoDetect() =
        launch {
            combine(fleetApiInfo, publicKeyStatus) { info, status ->
                (status.data?.configured == true) to (info.data?.authenticated == true)
            }.collect { (configured, authenticated) ->
                val merged = WizardProjection.autoDetect(onboarding.completed.value, configured, authenticated)
                if (merged != onboarding.completed.value) onboarding.save(merged)
            }
        }

    // ── per-tool actions (web useMutation) ─────────────────────────────────

    /** Runs `register-partner` for [domain] (web Partner Registration tool). */
    fun registerPartner(domain: String) = runAction(FleetApiActionId.RegisterPartner) { devTools.registerPartner(domain) }

    /** Runs `partner-public-key` verification for [domain] (web Partner Public Key tool). */
    fun verifyPartnerKey(domain: String) = runAction(FleetApiActionId.VerifyPartnerKey) { devTools.partnerPublicKey(domain) }

    /** Generates a keypair, then invalidates the public-key-status query (web `invalidateQueries`). */
    fun generateKeypair() = runAction(FleetApiActionId.GenerateKeypair, onSuccess = ::loadStatus) { devTools.generateKeypair() }

    /** Deletes the keypair, then invalidates the public-key-status query. */
    fun deleteKeypair() = runAction(FleetApiActionId.DeleteKeypair, onSuccess = ::loadStatus) { devTools.deletePublicKey() }

    /** Uploads a [pem] public key, then invalidates the public-key-status query. */
    fun uploadPublicKey(pem: String) =
        runAction(FleetApiActionId.UploadPublicKey, onSuccess = ::loadStatus) { devTools.uploadPublicKey(pem) }

    /** Subscribes to Fleet Telemetry with [request] (web Telemetry Subscribe tool). */
    fun subscribeTelemetry(request: TelemetrySubscribeRequest) =
        runAction(FleetApiActionId.SubscribeTelemetry) { devTools.subscribeTelemetry(request) }

    /** Fetches the Fleet Telemetry config for [vin] (web Telemetry Config tool). */
    fun getTelemetryConfig(vin: String) = runAction(FleetApiActionId.GetTelemetryConfig) { devTools.telemetryConfig(vin) }

    /** Fetches the Fleet Telemetry errors for [vin] (web Telemetry Config tool errors panel). */
    fun getTelemetryErrors(vin: String) = runAction(FleetApiActionId.GetTelemetryErrors) { devTools.telemetryErrors(vin) }

    /** Deletes the Fleet Telemetry config for [vin] (web Telemetry Config tool). */
    fun deleteTelemetryConfig(vin: String) = runAction(FleetApiActionId.DeleteTelemetryConfig) { devTools.deleteTelemetryConfig(vin) }

    /** Checks fleet status for [vins] (web Fleet Status tool). */
    fun checkFleetStatus(vins: List<String>) = runAction(FleetApiActionId.FleetStatus) { devTools.fleetStatus(vins) }

    /** Fetches one of the per-vehicle data endpoints for [vin] (web Vehicle Data tools). */
    fun fetchVehicleData(
        kind: VehicleDataKind,
        vin: String,
    ) = runAction(vehicleDataActionId(kind)) { devTools.vehicleData(kind, vin) }

    private fun runAction(
        id: FleetApiActionId,
        onSuccess: () -> Unit = {},
        block: suspend () -> FleetApiResponse,
    ) {
        if (actionStates.value[id]?.isRunning == true) return
        logger.info("fleetApi.action", mapOf("id" to id.name))
        setAction(id, ToolActionState.Running)
        launch {
            val response = block()
            setAction(id, ToolActionState.Done(response))
            if (!response.isError) onSuccess()
        }
    }

    private fun setAction(
        id: FleetApiActionId,
        state: ToolActionState,
    ) {
        actionStates.update { it + (id to state) }
    }

    // ── diagnostics ────────────────────────────────────────────────────────

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no fleet data. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to FleetApiSectionRegistration.SLUG))
    }

    private fun <T> loadingResource(): Resource<T> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun vehicleDataActionId(kind: VehicleDataKind): FleetApiActionId =
        when (kind) {
            VehicleDataKind.NearbyCharging -> FleetApiActionId.VehicleNearbyCharging
            VehicleDataKind.ReleaseNotes -> FleetApiActionId.VehicleReleaseNotes
            VehicleDataKind.RecentAlerts -> FleetApiActionId.VehicleRecentAlerts
            VehicleDataKind.ServiceData -> FleetApiActionId.VehicleServiceData
        }

    companion object {
        /**
         * Wire the surface from the shared dev-tools + vehicle-options ports (P1/S8) and the persisted
         * onboarding store. The holder runs on `viewModelScope`; a custom scope is a test-only concern.
         */
        fun create(
            devTools: FleetApiDevToolsPort,
            vehicles: VehicleOptionsPort,
            onboarding: FleetApiOnboardingStore,
            logger: Logger,
        ): FleetApiSectionViewModel = FleetApiSectionViewModel(devTools, vehicles, onboarding, logger)
    }
}
