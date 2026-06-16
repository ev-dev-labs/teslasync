package io.teslasync.android.charging.smartcharge

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * Drives [SmartChargePageViewModel] over a controllable fake [SmartChargePageSource], covering the history feed's
 * cache-then-network state matrix (loading / content / empty / error / no-vehicle), the optimize + apply mutations
 * (success populates the result / applied flag, failure surfaces the error message, both guard against re-entrancy
 * and missing prerequisites), and the PII-safe `view.opened` diagnostic — end to end through the real
 * `Resource → UiState` projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SmartChargePageViewModelTest {
    private val clock = Clock.fixed(Instant.parse("2024-01-15T10:00:00Z"), ZoneOffset.UTC)
    private val emptyArray: JsonElement = JsonArray(emptyList())

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

    private class FakeSource(
        val selected: MutableStateFlow<Long?> = MutableStateFlow(1L),
        var rate: List<Resource<JsonElement>> = listOf(Resource.Success(JsonArray(emptyList()), 0L, false)),
        var plans: List<Resource<JsonElement>> = listOf(Resource.Success(JsonArray(emptyList()), 0L, false)),
        var optimizeResult: Result<JsonElement> = Result.success(JsonArray(emptyList())),
        var applyResult: Result<JsonElement> = Result.success(JsonArray(emptyList())),
    ) : SmartChargePageSource {
        var optimizeCalls = 0
        var applyCalls = 0
        var lastOptimizeInput: OptimizeChargeInput? = null
        var lastApplyInput: ApplyScheduleInput? = null

        override fun selectedVehicleId(): StateFlow<Long?> = selected

        override fun ratePlans(): Flow<Resource<JsonElement>> = flow { rate.forEach { emit(it) } }

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> = flow { plans.forEach { emit(it) } }

        override suspend fun optimize(input: OptimizeChargeInput): Result<JsonElement> {
            optimizeCalls++
            lastOptimizeInput = input
            return optimizeResult
        }

        override suspend fun apply(input: ApplyScheduleInput): Result<JsonElement> {
            applyCalls++
            lastApplyInput = input
            return applyResult
        }
    }

    @Test
    fun historyContentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(plans = listOf(Resource.Success(history(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.plansState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.plansState.value.isContent)
            assertEquals(1, decodeChargePlans(vm.plansState.value.data).size)
        }

    @Test
    fun historyEmptyWhenNoPlans() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(plans = listOf(Resource.Success(emptyArray, 100L, false))))
            backgroundScope.launch { vm.plansState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.plansState.value.isEmpty)
        }

    @Test
    fun historyEmptyWhenNoVehicleSelected() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(selected = MutableStateFlow(null), plans = listOf(Resource.Success(history(), 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.plansState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.plansState.value.isEmpty)
        }

    @Test
    fun historyHardErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(plans = listOf(Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.plansState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.plansState.value.isError)
            assertTrue(vm.plansState.value.canRetry)
        }

    @Test
    fun optimizeSuccessStoresDecodedResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(optimizeResult = Result.success(Json.parseToJsonElement(OPTIMIZE_JSON)))
            val vm = viewModel(src)

            vm.optimize()
            advanceUntilIdle()

            assertEquals(7L, vm.interaction.value.result?.planId)
            assertFalse(vm.optimizing.value)
            assertNull(vm.optimizeError.value)
            assertEquals(1, src.optimizeCalls)
            assertEquals(1L, src.lastOptimizeInput?.vehicleId)
        }

    @Test
    fun optimizeWithoutVehicleIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(selected = MutableStateFlow(null))
            val vm = viewModel(src)

            vm.optimize()
            advanceUntilIdle()

            assertEquals(0, src.optimizeCalls)
            assertNull(vm.interaction.value.result)
        }

    @Test
    fun optimizeFailureSurfacesErrorMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(optimizeResult = Result.failure(ApiError.Http(503, "rate limited")))
            val vm = viewModel(src)

            vm.optimize()
            advanceUntilIdle()

            assertNull(vm.interaction.value.result)
            assertNotNull(vm.optimizeError.value)
            assertFalse(vm.optimizing.value)
        }

    @Test
    fun applySuccessSetsAppliedFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(optimizeResult = Result.success(Json.parseToJsonElement(OPTIMIZE_JSON)))
            val vm = viewModel(src)
            vm.optimize()
            advanceUntilIdle()

            vm.apply()
            advanceUntilIdle()

            assertTrue(vm.interaction.value.applied)
            assertEquals(7L, src.lastApplyInput?.planId)
        }

    @Test
    fun applyWithoutResultIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)

            vm.apply()
            advanceUntilIdle()

            assertEquals(0, src.applyCalls)
            assertFalse(vm.interaction.value.applied)
        }

    @Test
    fun formSettersUpdateInteraction() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            vm.setTargetSoc(90)
            vm.setRatePlan("sce-tou-d")
            vm.setMaxAmps(48)
            vm.setBatteryCapacity(100.0)
            vm.setDepartBy("2024-02-01T06:00")

            val state = vm.interaction.value
            assertEquals(90, state.targetSoc)
            assertEquals("sce-tou-d", state.ratePlanId)
            assertEquals(48, state.maxAmps)
            assertEquals(100.0, state.batteryCapacity, 0.0)
            assertEquals("2024-02-01T06:00", state.departBy)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SmartChargePage"), opened.single().second)
        }

    private fun history(): JsonElement =
        Json.parseToJsonElement(
            """[{"id":5,"vehicle_id":1,"target_soc":80,"scheduled_start":"2024-01-15T08:00:00Z",
               "scheduled_end":"2024-01-15T10:00:00Z","rate_plan":"pge-ev2a","estimated_cost":3.5,
               "savings":1.2,"status":"scheduled","created_at":"2024-01-14T12:00:00Z"}]""",
        )

    private fun TestScope.viewModel(
        source: SmartChargePageSource,
        logger: Logger = RecordingLogger(),
    ): SmartChargePageViewModel = SmartChargePageViewModel(source, logger, backgroundScope, clock)

    private companion object {
        const val OPTIMIZE_JSON = """
            {
              "plan_id": 7, "current_soc": 50, "target_soc": 80, "kwh_needed": 20,
              "estimated_duration_hours": 2,
              "schedule": {
                "start_time": "2024-01-15T08:00:00Z", "end_time": "2024-01-15T11:00:00Z",
                "rate_cents_kwh": 12, "estimated_cost": 2.4, "rate_tier": "OFF_PEAK"
              },
              "comparison": {
                "charge_now_cost": 5, "optimized_cost": 2.4, "savings": 2.6, "savings_percent": 52
              },
              "alternative_windows": [],
              "hourly_rates": []
            }
        """
    }
}
