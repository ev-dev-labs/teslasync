package io.teslasync.android.featureviews.fleetapi

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [FleetApiSectionViewModel] over controllable fakes, covering the query state matrix
 * (config / status / vehicles loading → content / error / empty), the per-tool action map (success +
 * failure), the keypair-mutation → status invalidation, the onboarding wizard navigation + persistence
 * + auto-detection, and the PII-safe `view.opened` diagnostic. Runs in the offline
 * :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetApiSectionViewModelTest {
    private class FakeDevTools : FleetApiDevToolsPort {
        var infoResponse: FleetApiResponse = FleetApiResponse.of(buildJsonObject { put("hostname", "app.example.com") })
        var statusResponse: FleetApiResponse = FleetApiResponse.of(buildJsonObject { put("configured", false) })
        var actionResponse: FleetApiResponse = FleetApiResponse.of(buildJsonObject { put("ok", true) })
        var infoCalls = 0
        var statusCalls = 0
        val actionCalls = mutableListOf<String>()

        override suspend fun fleetApiInfo(): FleetApiResponse = infoResponse.also { infoCalls++ }

        override suspend fun publicKeyStatus(): FleetApiResponse = statusResponse.also { statusCalls++ }

        override suspend fun registerPartner(domain: String): FleetApiResponse = actionResponse.also { actionCalls += "register" }

        override suspend fun partnerPublicKey(domain: String): FleetApiResponse = actionResponse.also { actionCalls += "verify" }

        override suspend fun generateKeypair(): FleetApiResponse = actionResponse.also { actionCalls += "generate" }

        override suspend fun uploadPublicKey(pem: String): FleetApiResponse = actionResponse.also { actionCalls += "upload" }

        override suspend fun deletePublicKey(): FleetApiResponse = actionResponse.also { actionCalls += "deleteKey" }

        override suspend fun subscribeTelemetry(request: TelemetrySubscribeRequest): FleetApiResponse =
            actionResponse.also { actionCalls += "subscribe" }

        override suspend fun telemetryConfig(vin: String): FleetApiResponse = actionResponse.also { actionCalls += "config" }

        override suspend fun telemetryErrors(vin: String): FleetApiResponse = actionResponse.also { actionCalls += "errors" }

        override suspend fun deleteTelemetryConfig(vin: String): FleetApiResponse = actionResponse.also { actionCalls += "deleteConfig" }

        override suspend fun fleetStatus(vins: List<String>): FleetApiResponse = actionResponse.also { actionCalls += "fleetStatus" }

        override suspend fun vehicleData(
            kind: VehicleDataKind,
            vin: String,
        ): FleetApiResponse = actionResponse.also { actionCalls += "vehicleData:${kind.name}" }
    }

    private class FakeVehicles(
        var result: Result<List<VehicleOption>>,
    ) : VehicleOptionsPort {
        override suspend fun vehicleOptions(): Result<List<VehicleOption>> = result
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private fun TestScope.viewModel(
        devTools: FleetApiDevToolsPort = FakeDevTools(),
        vehicles: VehicleOptionsPort = FakeVehicles(Result.success(emptyList())),
        onboarding: FleetApiOnboardingStore = InMemoryFleetApiOnboardingStore(),
        logger: Logger = RecordingLogger(),
    ): FleetApiSectionViewModel =
        FleetApiSectionViewModel(devTools, vehicles, onboarding, logger, now = { 1_000L }, scope = backgroundScope)

    @Test
    fun configLoadsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val devTools =
                FakeDevTools().apply {
                    infoResponse =
                        FleetApiResponse.of(
                            buildJsonObject {
                                put("baseUrl", "https://fleet")
                                put("authenticated", true)
                            },
                        )
                }
            val vm = viewModel(devTools = devTools)
            backgroundScope.launch { vm.fleetApiInfo.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.fleetApiInfo.value.phase)
            assertEquals(
                "https://fleet",
                vm.fleetApiInfo.value.data
                    ?.baseUrl,
            )
            assertTrue(
                vm.fleetApiInfo.value.data
                    ?.authenticated == true,
            )
        }

    @Test
    fun configErrorSurfacesErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val devTools = FakeDevTools().apply { infoResponse = FleetApiResponse.ofError("boom") }
            val vm = viewModel(devTools = devTools)
            backgroundScope.launch { vm.fleetApiInfo.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.fleetApiInfo.value.phase)
            assertTrue(vm.fleetApiInfo.value.hasError)
        }

    @Test
    fun vehiclesLoadContentThenEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vmContent = viewModel(vehicles = FakeVehicles(Result.success(listOf(VehicleOption("VIN1", "Model 3")))))
            backgroundScope.launch { vmContent.vehicleOptions.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vmContent.vehicleOptions.value.phase)
            assertEquals(
                1,
                vmContent.vehicleOptions.value.data
                    ?.size,
            )

            val vmEmpty = viewModel(vehicles = FakeVehicles(Result.success(emptyList())))
            backgroundScope.launch { vmEmpty.vehicleOptions.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vmEmpty.vehicleOptions.value.phase)
        }

    @Test
    fun registerPartnerProducesDoneResult() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.registerPartner("app.example.com")
            advanceUntilIdle()
            val state = vm.actions.value[FleetApiActionId.RegisterPartner]
            assertTrue(state is ToolActionState.Done)
            assertTrue((state as ToolActionState.Done).response.boolean("ok"))
        }

    @Test
    fun actionErrorProducesFailureResult() =
        runTest(UnconfinedTestDispatcher()) {
            val devTools = FakeDevTools().apply { actionResponse = FleetApiResponse.ofError("nope") }
            val vm = viewModel(devTools = devTools)
            advanceUntilIdle()
            vm.checkFleetStatus(listOf("VIN1"))
            advanceUntilIdle()
            val state = vm.actions.value[FleetApiActionId.FleetStatus] as ToolActionState.Done
            assertEquals(ResultPanelState.Failure("nope"), ResultPanelState.from(state.response, hasRun = true))
        }

    @Test
    fun generateKeypairInvalidatesStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val devTools = FakeDevTools()
            val vm = viewModel(devTools = devTools)
            backgroundScope.launch { vm.publicKeyStatus.collect {} }
            advanceUntilIdle()
            val initialStatusCalls = devTools.statusCalls
            vm.generateKeypair()
            advanceUntilIdle()
            assertTrue(devTools.actionCalls.contains("generate"))
            assertTrue(devTools.statusCalls > initialStatusCalls)
        }

    @Test
    fun wizardMarkCompletePersistsAndAdvances() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryFleetApiOnboardingStore()
            val vm = viewModel(onboarding = store)
            backgroundScope.launch { vm.wizard.collect {} }
            advanceUntilIdle()
            vm.markCurrentStepComplete()
            advanceUntilIdle()
            assertTrue(store.completed.value[OnboardingStepId.Account] == true)
            assertEquals(1, vm.wizard.value.currentIndex)
        }

    @Test
    fun wizardStepNavigation() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            backgroundScope.launch { vm.wizard.collect {} }
            advanceUntilIdle()
            vm.selectStep(3)
            advanceUntilIdle()
            assertEquals(3, vm.wizard.value.currentIndex)
            vm.previousStep()
            advanceUntilIdle()
            assertEquals(2, vm.wizard.value.currentIndex)
            vm.nextStep()
            advanceUntilIdle()
            assertEquals(3, vm.wizard.value.currentIndex)
        }

    @Test
    fun autoDetectPersistsFromQueries() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryFleetApiOnboardingStore()
            val devTools =
                FakeDevTools().apply {
                    infoResponse = FleetApiResponse.of(buildJsonObject { put("authenticated", true) })
                    statusResponse = FleetApiResponse.of(buildJsonObject { put("configured", true) })
                }
            viewModel(devTools = devTools, onboarding = store)
            advanceUntilIdle()
            assertTrue(store.completed.value[OnboardingStepId.Keypair] == true)
            assertTrue(store.completed.value[OnboardingStepId.Auth] == true)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)
            vm.recordViewOpened()
            vm.recordViewOpened()
            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "FleetApiSection"), opened.single().second)
        }

    @Test
    fun refreshConfigReloads() =
        runTest(UnconfinedTestDispatcher()) {
            val devTools = FakeDevTools()
            val vm = viewModel(devTools = devTools)
            backgroundScope.launch { vm.fleetApiInfo.collect {} }
            advanceUntilIdle()
            val before = devTools.infoCalls
            vm.refreshConfig()
            advanceUntilIdle()
            assertTrue(devTools.infoCalls > before)
        }
}
