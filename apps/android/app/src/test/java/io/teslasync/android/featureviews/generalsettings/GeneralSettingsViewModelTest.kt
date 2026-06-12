package io.teslasync.android.featureviews.generalsettings

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.settings.CarPreferences
import io.teslasync.shared.core.presentation.settings.Vehicle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [GeneralSettingsViewModel] over a controllable fake [GeneralSettingsSource], covering every state
 * the surface renders (loading → content, the hard error, the stale/offline envelope), the lazy form
 * hydrate + edit → dirty diff (web nav-guard), the full-replace save that preserves unknown keys, the
 * "Sync from Car" success / no-change branches, the save-failure feedback, and the PII-safe `view.opened` /
 * save / sync diagnostics (P1/S11 — surface slug only, never a preference value). The view never performs
 * HTTP — every read + the save flow through the fake source.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GeneralSettingsViewModelTest {
    @Test
    fun loadsTheServerDocumentIntoTheForm() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(settings = success(document("mi"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val display = GeneralSettingsProjection.project(vm.state.value)
            assertEquals(GeneralSettingsStatus.Ready, display.status)
            assertEquals("mi", display.form.distanceUnit)
            assertFalse(display.isDirty)
        }

    @Test
    fun hardErrorWithNoCacheShowsErrorAndRetryRecovers() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(settings = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(GeneralSettingsStatus.Error, GeneralSettingsProjection.project(vm.state.value).status)

            src.settings = success(document("km"))
            vm.retry()
            advanceUntilIdle()
            assertEquals(GeneralSettingsStatus.Ready, GeneralSettingsProjection.project(vm.state.value).status)
        }

    @Test
    fun failingLoadWithCacheKeepsTheFormStaleOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    settings = Resource.Error(cached = document("mi"), fetchedAt = 5L, stale = true, error = ApiError.Timeout()),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val display = GeneralSettingsProjection.project(vm.state.value)
            assertEquals(GeneralSettingsStatus.Ready, display.status)
            assertEquals("mi", display.form.distanceUnit)
            assertTrue(display.stale)
            assertTrue(display.offline)
        }

    @Test
    fun editingMarksTheFormDirty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(settings = success(document("km"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit { it.copy(distanceUnit = "mi") }
            advanceUntilIdle()

            val display = GeneralSettingsProjection.project(vm.state.value)
            assertEquals("mi", display.form.distanceUnit)
            assertTrue(display.isDirty)
        }

    @Test
    fun saveSubmitsTheFormPreservingUnknownKeysAndSurfacesSaved() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(settings = success(documentWithExtra()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit { it.copy(language = "fr") }
            vm.save()
            advanceUntilIdle()

            assertEquals(GeneralSettingsFeedback.Saved, vm.state.value.feedback)
            val saved = src.saved.single() as JsonObject
            // The edited field is submitted…
            assertEquals("fr", saved["language"]?.jsonPrimitive?.contentOrNull)
            // …and the unknown server key is preserved (full-replace contract).
            assertEquals("neon-cyan", saved["theme"]?.jsonPrimitive?.contentOrNull)
        }

    @Test
    fun saveFailureSurfacesSaveFailedFeedback() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(settings = success(document("km")), saveResult = Result.failure(ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.save()
            advanceUntilIdle()

            assertEquals(GeneralSettingsFeedback.SaveFailed, vm.state.value.feedback)
        }

    @Test
    fun syncFromCarAppliesUnitsAndSurfacesUnitsSynced() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    settings = success(document("km")),
                    vehicles = success(listOf(Vehicle(id = 1, name = "Car", vin = "VIN"))),
                    car =
                        success(
                            CarPreferences(
                                distanceUnit = "DistanceUnitMiles",
                                temperatureUnit = "TemperatureUnitFahrenheit",
                                tirePressureUnit = "PressureUnitPsi",
                            ),
                        ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.syncFromCar()
            advanceUntilIdle()

            val feedback = vm.state.value.feedback
            assertTrue(feedback is GeneralSettingsFeedback.UnitsSynced)
            feedback as GeneralSettingsFeedback.UnitsSynced
            assertTrue(feedback.distanceMiles)
            assertTrue(feedback.temperatureFahrenheit)
            assertTrue(feedback.pressurePsi)
            assertEquals("mi", GeneralSettingsProjection.project(vm.state.value).form.distanceUnit)
        }

    @Test
    fun syncFromCarWithNoDetectableUnitsSurfacesNoChanges() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    settings = success(document("km")),
                    vehicles = success(listOf(Vehicle(id = 1, name = "Car", vin = "VIN"))),
                    car = success(CarPreferences()),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.syncFromCar()
            advanceUntilIdle()

            assertEquals(GeneralSettingsFeedback.NoChanges, vm.state.value.feedback)
            assertTrue("a no-change sync must not PUT", src.saved.isEmpty())
        }

    @Test
    fun clearFeedbackResetsTheTransientMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(settings = success(document("km"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            vm.save()
            advanceUntilIdle()
            assertEquals(GeneralSettingsFeedback.Saved, vm.state.value.feedback)

            vm.clearFeedback()
            advanceUntilIdle()
            assertNull(vm.state.value.feedback)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(settings = success(document("km"))), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "GeneralSettings"), opened.single().second)
        }

    @Test
    fun saveAndSyncAreLoggedWithoutAnyPreferenceValue() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src =
                FakeSource(
                    settings = success(document("km")),
                    vehicles = success(listOf(Vehicle(id = 1, name = "Car", vin = "VIN"))),
                    car = success(CarPreferences(distanceUnit = "DistanceUnitMiles")),
                )
            val vm = viewModel(src, logger = logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.save()
            vm.syncFromCar()
            vm.refresh()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "generalSettings.save" })
            assertTrue(logger.events.any { it.first == "generalSettings.sync" })
            assertTrue(logger.events.any { it.first == "generalSettings.refresh" })
            // PII-safe: only the surface slug (and an error kind on failure) is ever recorded.
            assertTrue(logger.events.all { (_, fields) -> fields.keys.all { it == "surface" || it == "kind" } })
            assertFalse(logger.events.any { it.second.containsKey("value") })
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: GeneralSettingsSource,
        logger: Logger = NoopLogger,
    ): GeneralSettingsViewModel = GeneralSettingsViewModel(source, logger, backgroundScope)

    /** A fake whose feeds re-read their (mutable) resources on every (re)collection, so a refresh is observed. */
    private class FakeSource(
        var settings: Resource<JsonElement>,
        var vehicles: Resource<List<Vehicle>> = success(emptyList()),
        var car: Resource<CarPreferences> = success(CarPreferences()),
        var saveResult: Result<JsonElement> = Result.success(Json.parseToJsonElement("{}")),
    ) : GeneralSettingsSource {
        val saved = mutableListOf<JsonElement>()

        override fun settings(): Flow<Resource<JsonElement>> = flow { emit(settings) }

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { emit(vehicles) }

        override fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>> = flow { emit(car) }

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> {
            saved += document
            return saveResult
        }
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

    private companion object {
        fun <T> success(value: T): Resource<T> = Resource.Success(value, fetchedAt = 1L, stale = false)

        fun document(distance: String): JsonElement = Json.parseToJsonElement("""{ "unit_of_length": "$distance" }""")

        fun documentWithExtra(): JsonElement =
            Json.parseToJsonElement("""{ "unit_of_length": "km", "language": "en", "theme": "neon-cyan" }""")
    }
}
