package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No-device verification of the VehicleSpecsWidget's UI-thread-free logic — the entry projection
 * (Model/Trim/Paint/Wheels/Interior/Aux Battery/Car Version + decoded option chips), the web
 * `asString` value coercion, the OR-merge of the three configuration feeds, the vehicle resolution,
 * the registry bounds, and the view-model's per-state transitions (loading / content / empty / error
 * / stale-offline) plus the `view.opened` diagnostics. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSpecsWidgetTest {
    private val strings =
        VehicleSpecsStrings(
            title = "Vehicle Specs",
            model = "Model",
            trim = "Trim",
            paint = "Paint Color",
            wheels = "Wheels",
            interior = "Interior",
            auxBattery = "Aux Battery",
            carVersion = "Car Version",
            option = "Option",
            noData = "No specs available",
        )

    // ---- Projection: base entries (web `entries` useMemo) --------------------------

    @Test
    fun project_buildsSevenBaseEntriesFromSpecsAndConfig() {
        val data =
            VehicleSpecsData(
                specs =
                    obj(
                        "car_type" to "Model 3",
                        "trim_badging" to "Long Range",
                        "exterior_color" to "Pearl White",
                        "wheel_type" to "Aero 18",
                        "interior" to "Black",
                        "aux_battery_type" to "Li-ion",
                    ),
                options = null,
                config = obj("version" to "2024.8.9"),
            )

        val view = VehicleSpecsProjection.project(data, VehicleSpecsSize(2, 4), strings)

        assertFalse(view.isCompact)
        assertEquals(BASE_ENTRY_COUNT, view.entries.size)
        assertEquals(SpecEntry("Model", "Model 3"), view.entries[0])
        assertEquals(SpecEntry("Trim", "Long Range"), view.entries[1])
        assertEquals(SpecEntry("Paint Color", "Pearl White"), view.entries[2])
        assertEquals(SpecEntry("Wheels", "Aero 18"), view.entries[3])
        assertEquals(SpecEntry("Interior", "Black"), view.entries[4])
        assertEquals(SpecEntry("Aux Battery", "Li-ion"), view.entries[5])
        assertEquals(SpecEntry("Car Version", "2024.8.9", mono = true), view.entries[6])
    }

    @Test
    fun project_fallsBackToEmDashWhenEverySourceAbsent() {
        val view = VehicleSpecsProjection.project(VehicleSpecsData.EMPTY, VehicleSpecsSize(2, 4), strings)

        assertEquals(BASE_ENTRY_COUNT, view.entries.size)
        view.entries.forEach { assertEquals(VehicleSpecsProjection.EM_DASH, it.value) }
        assertTrue(view.entries[6].mono)
        assertEquals(VehicleSpecsProjection.EM_DASH, view.compactModel)
        assertEquals(VehicleSpecsProjection.EM_DASH, view.compactTrim)
    }

    @Test
    fun project_usesConfigFallbackAndInteriorColorFallback() {
        val data =
            VehicleSpecsData(
                specs = obj("interior_color" to "Cream"),
                options = null,
                config = obj("car_type" to "Model Y", "trim" to "Performance", "exterior_color" to "Red"),
            )

        val view = VehicleSpecsProjection.project(data, VehicleSpecsSize(2, 4), strings)

        assertEquals("Model Y", view.entries[0].value)
        assertEquals("Performance", view.entries[1].value)
        assertEquals("Red", view.entries[2].value)
        assertEquals("Cream", view.entries[4].value)
    }

    // ---- Projection: option chips (web `Object.keys(options).slice`) ----------------

    @Test
    fun project_appendsDecodedOptionChipsWithBadge() {
        val options =
            buildJsonObject {
                put("\$MTY07", "Mid Range Battery")
                put("EMPTY", "")
            }
        val data = VehicleSpecsData(specs = null, options = options, config = null)

        val view = VehicleSpecsProjection.project(data, VehicleSpecsSize(2, 4), strings)

        assertEquals(BASE_ENTRY_COUNT + 2, view.entries.size)
        assertEquals(SpecEntry("\$MTY07", "Mid Range Battery", badge = "Option"), view.entries[BASE_ENTRY_COUNT])
        // Empty decoded value falls back to the raw option key (web `decoded ?? key`).
        assertEquals(SpecEntry("EMPTY", "EMPTY", badge = "Option"), view.entries[BASE_ENTRY_COUNT + 1])
    }

    @Test
    fun project_capsOptionsAtEightWhenWideAndHidesThemWhenCompact() {
        val options = buildJsonObject { repeat(TEN) { put("opt$it", "v$it") } }

        val wide = VehicleSpecsProjection.project(VehicleSpecsData(null, options, null), VehicleSpecsSize(2, 4), strings)
        val compact = VehicleSpecsProjection.project(VehicleSpecsData(null, options, null), VehicleSpecsSize(1, 2), strings)

        assertEquals(BASE_ENTRY_COUNT + VehicleSpecsProjection.MAX_OPTIONS, wide.entries.size)
        assertTrue(compact.isCompact)
        assertEquals(BASE_ENTRY_COUNT, compact.entries.size)
    }

    @Test
    fun project_compactExposesModelAndTrim() {
        val data = VehicleSpecsData(obj("car_type" to "Model S", "trim_badging" to "Plaid"), null, null)

        val view = VehicleSpecsProjection.project(data, VehicleSpecsSize(1, 2), strings)

        assertTrue(view.isCompact)
        assertEquals("Model S", view.compactModel)
        assertEquals("Plaid", view.compactTrim)
    }

    // ---- Value coercion (web `asString`) -------------------------------------------

    @Test
    fun jsonString_matchesWebAsString() {
        assertEquals("hello", VehicleSpecsProjection.jsonString(JsonPrimitive("hello")))
        assertNull(VehicleSpecsProjection.jsonString(JsonPrimitive("")))
        assertEquals("75", VehicleSpecsProjection.jsonString(JsonPrimitive(SEVENTY_FIVE_INT)))
        assertEquals("75", VehicleSpecsProjection.jsonString(JsonPrimitive(SEVENTY_FIVE_DOUBLE)))
        assertEquals("75.5", VehicleSpecsProjection.jsonString(JsonPrimitive(SEVENTY_FIVE_POINT_FIVE)))
        assertNull(VehicleSpecsProjection.jsonString(JsonPrimitive(true)))
        assertNull(VehicleSpecsProjection.jsonString(JsonNull))
        assertNull(VehicleSpecsProjection.jsonString(null))
        assertNull(VehicleSpecsProjection.jsonString(buildJsonObject { put("a", "b") }))
    }

    // ---- Feed merge (web isLoading/isError/isStale = OR, updatedAt = max) -----------

    @Test
    fun combine_firstLoadingHidesPartialDataBehindSkeleton() {
        val merged =
            combineSpecsResources(
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
                Resource.Success(envelope("opt" to "x"), OLD, false),
                Resource.Success(obj("version" to "2024.1"), OLD, false),
            )

        assertTrue(merged is Resource.Loading)
        assertNull((merged as Resource.Loading).cached)
    }

    @Test
    fun combine_allSuccessMergesNewestStampAndOrStale() {
        val merged =
            combineSpecsResources(
                Resource.Success(envelope("car_type" to "Model 3"), OLD, false),
                Resource.Success(envelope("opt" to "x"), NOW, true),
                Resource.Success(obj("version" to "2024.1"), MID, false),
            )

        assertTrue(merged is Resource.Success)
        merged as Resource.Success
        assertEquals(NOW, merged.fetchedAt)
        assertTrue(merged.stale)
        assertNotNull(merged.data.specs)
        assertNotNull(merged.data.options)
        assertNotNull(merged.data.config)
        assertTrue(merged.data.hasAnyData)
    }

    @Test
    fun combine_errorWithPartialDataStaysOffline() {
        val merged =
            combineSpecsResources(
                Resource.Success(envelope("car_type" to "Model 3"), OLD, false),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                Resource.Success(obj("version" to "2024.1"), MID, false),
            )

        assertTrue(merged is Resource.Error)
        merged as Resource.Error
        assertNotNull(merged.cached)
        assertTrue(merged.stale)
        assertEquals(MID, merged.fetchedAt)
    }

    @Test
    fun combine_hardErrorWithoutDataHasNoCache() {
        val merged =
            combineSpecsResources(
                Resource.Error(null, null, false, ApiError.Timeout()),
                Resource.Error(null, null, false, ApiError.Network()),
                Resource.Error(null, null, false, ApiError.Network()),
            )

        assertTrue(merged is Resource.Error)
        assertNull((merged as Resource.Error).cached)
    }

    @Test
    fun combine_backgroundRefreshKeepsCachedValue() {
        val merged =
            combineSpecsResources(
                Resource.Loading(cached = envelope("car_type" to "Model 3"), fetchedAt = OLD, stale = false),
                Resource.Success(envelope("opt" to "x"), OLD, false),
                Resource.Success(obj("version" to "2024.1"), OLD, false),
            )

        assertTrue(merged is Resource.Loading)
        assertNotNull((merged as Resource.Loading).cached)
        assertTrue(merged.cached?.hasAnyData == true)
    }

    // ---- Vehicle resolution (web `vehicleId ?? vehicles?.[0]?.id` + `> 0`) ----------

    @Test
    fun resolveVehicleId_prefersExplicitThenActiveAndGatesNonPositive() {
        assertEquals(7L, resolveSpecsVehicleId(explicit = 7L, active = 3L))
        assertEquals(3L, resolveSpecsVehicleId(explicit = null, active = 3L))
        assertNull(resolveSpecsVehicleId(explicit = null, active = null))
        assertNull(resolveSpecsVehicleId(explicit = 0L, active = 5L))
        assertNull(resolveSpecsVehicleId(explicit = null, active = 0L))
        assertNull(resolveSpecsVehicleId(explicit = null, active = -5L))
    }

    // ---- Registry metadata + bounds (web registry vehicle.ts) ----------------------

    @Test
    fun registry_metadataAndBounds() {
        assertEquals("vehicle-specs", VehicleSpecsRegistration.ID)
        assertEquals("vehicle", VehicleSpecsRegistration.CATEGORY)
        assertEquals("VehicleSpecsWidget", VehicleSpecsRegistration.SLUG)
        assertEquals(VehicleSpecsSize(2, 4), VehicleSpecsRegistration.defaultSize)
        assertTrue(VehicleSpecsRegistration.withinBounds(VehicleSpecsSize(1, 2)))
        assertFalse(VehicleSpecsRegistration.withinBounds(VehicleSpecsSize(5, 40)))
        assertEquals(VehicleSpecsSize(1, 2), VehicleSpecsRegistration.clamp(VehicleSpecsSize(0, 0)))
        assertEquals(VehicleSpecsSize(4, 40), VehicleSpecsRegistration.clamp(VehicleSpecsSize(9, 99)))
        assertTrue(VehicleSpecsSize(1, 2).isCompact)
        assertFalse(VehicleSpecsSize(2, 4).isCompact)
    }

    // ---- View-model state matrix ---------------------------------------------------

    @Test
    fun viewModel_loadingOnlyStaysLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun viewModel_resolvedDataExposesContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false), Resource.Success(specsData(), NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(requireNotNull(state.data).hasAnyData)
            assertEquals(NOW, state.fetchedAt)
        }

    @Test
    fun viewModel_noSourceResolvedRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Success(VehicleSpecsData.EMPTY, NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun viewModel_hardErrorRendersErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun viewModel_errorWithCacheStaysStaleOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    Resource.Loading(null, null, false),
                    Resource.Error(specsData(), NOW, true, ApiError.Timeout()),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun viewModel_onAppearEmitsViewOpenedOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = VehicleSpecsViewModel(source(Resource.Success(specsData(), NOW, false)), logger, backgroundScope)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VehicleSpecsWidget", opened.single().second["slug"])
        }

    // ---- Helpers -------------------------------------------------------------------

    private fun obj(vararg pairs: Pair<String, String>): JsonObject = buildJsonObject { pairs.forEach { (key, value) -> put(key, value) } }

    private fun envelope(vararg pairs: Pair<String, String>): JsonObject = buildJsonObject { put("data", obj(*pairs)) }

    private fun specsData(): VehicleSpecsData = VehicleSpecsData(specs = obj("car_type" to "Model 3"), options = null, config = null)

    private fun source(vararg emissions: Resource<VehicleSpecsData>): VehicleSpecsSource =
        VehicleSpecsSource {
            flow { emissions.forEach { emit(it) } }
        }

    private fun TestScope.viewModel(vararg emissions: Resource<VehicleSpecsData>): VehicleSpecsViewModel =
        VehicleSpecsViewModel(source(*emissions), NoopLogger, backgroundScope)

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

    private companion object {
        const val BASE_ENTRY_COUNT = 7
        const val TEN = 10
        const val NOW = 1_700_000_000_000L
        const val MID = 1_500_000_000_000L
        const val OLD = 1_000_000_000_000L
        const val SEVENTY_FIVE_INT = 75
        const val SEVENTY_FIVE_DOUBLE = 75.0
        const val SEVENTY_FIVE_POINT_FIVE = 75.5
    }
}
