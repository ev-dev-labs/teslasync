package io.teslasync.android.featureviews.vehiclesettingstab

import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSetting
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Drives [VehicleSettingsTabViewModel] over a controllable fake [VehicleSettingsTabSource] (the adapter the
 * surface binds the shared S8 store through), covering: the resolver feed loading into rows, the edit ->
 * dirty diff, the validated save that PUTs the typed value / clears the draft / refreshes the feed / toasts,
 * the blank + invalid-date validation short-circuits, the override-guarded reset DELETE, the save-failure
 * toast, the `mute_until` RFC3339 round-trip on save, and the PII-safe `view.opened` / save / refresh
 * diagnostics (surface slug only, never a value). The view never performs HTTP — every read + mutation flows
 * through the fake source.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSettingsTabViewModelTest {
    @Test
    fun loadsTheResolverPayloadIntoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(defaultPayload())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertEquals(VehicleSettingsTabStatus.Ready, display.status)
            assertEquals(VEHICLE_SETTING_DESCRIPTORS.size, display.rows.size)
            assertEquals(EffectiveSettingSource.OVERRIDE, display.rows.first { it.key == "nickname" }.source)
        }

    @Test
    fun editingMarksTheRowDirty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(defaultPayload())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit("nickname", "Stardust")
            advanceUntilIdle()

            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertTrue(display.rows.first { it.key == "nickname" }.isDirty)
        }

    @Test
    fun savingAValidDraftUpsertsClearsTheDraftRefreshesAndToasts() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(defaultPayload()))
            val vm = viewModel(src)
            val events = collectEvents(vm)
            advanceUntilIdle()

            vm.edit("nickname", "Stardust")
            vm.save("nickname")
            advanceUntilIdle()

            assertEquals("nickname" to JsonPrimitive("Stardust"), src.upserts.single())
            // The draft is cleared on success so the row follows the refreshed effective value (no longer dirty).
            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertFalse(display.rows.first { it.key == "nickname" }.isDirty)
            assertTrue("the feed must be re-collected after a save", src.settingsCollections >= 2)
            assertTrue(events.any { it is UiEvent.Message && it.messageKey == VEHICLE_SETTINGS_SAVED_KEY })
        }

    @Test
    fun savingABlankDraftSurfacesRequiredAndDoesNotUpsert() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(defaultPayload()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit("nickname", "")
            vm.save("nickname")
            advanceUntilIdle()

            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertEquals(
                VehicleSettingValidation.Required,
                display.rows.first { it.key == "nickname" }.validation,
            )
            assertTrue(src.upserts.isEmpty())
        }

    @Test
    fun savingAnInvalidTimestampSurfacesInvalidDateAndDoesNotUpsert() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(muteOverridePayload()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit("mute_until", "not-a-date")
            vm.save("mute_until")
            advanceUntilIdle()

            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertEquals(
                VehicleSettingValidation.InvalidDate,
                display.rows.first { it.key == "mute_until" }.validation,
            )
            assertTrue(src.upserts.isEmpty())
        }

    @Test
    fun muteUntilSaveForwardsAParseableRfc3339Instant() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(muteOverridePayload()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit("mute_until", "2025-06-15T12:30")
            vm.save("mute_until")
            advanceUntilIdle()

            val (key, value) = src.upserts.single()
            assertEquals("mute_until", key)
            assertFalse(runCatching { Instant.parse(value.jsonPrimitive.contentOrNull) }.isFailure)
        }

    @Test
    fun resetIsGuardedToOverrideRowsAndDeletesWhenAllowed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(defaultPayload()))
            val vm = viewModel(src)
            val events = collectEvents(vm)
            advanceUntilIdle()

            // mute_until resolves to 'default' -> the reset is guarded and performs no DELETE.
            vm.reset("mute_until")
            advanceUntilIdle()
            assertTrue(src.resets.isEmpty())

            // nickname resolves to 'override' -> the reset DELETEs and toasts.
            vm.reset("nickname")
            advanceUntilIdle()
            assertEquals(listOf("nickname"), src.resets)
            assertTrue(events.any { it is UiEvent.Message && it.messageKey == VEHICLE_SETTINGS_RESET_KEY })
        }

    @Test
    fun aFailedSaveToastsTheErrorAndKeepsTheDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(success(defaultPayload()), upsertResult = Result.failure(ApiError.Network()))
            val vm = viewModel(src)
            val events = collectEvents(vm)
            advanceUntilIdle()

            vm.edit("nickname", "Stardust")
            vm.save("nickname")
            advanceUntilIdle()

            assertTrue(events.any { it is UiEvent.Message && it.messageKey == VEHICLE_SETTINGS_SAVE_FAILED_KEY })
            // A failure clears nothing — the draft is retained so the user can retry.
            val display = VehicleSettingsTabProjection.project(vm.state.value)
            assertTrue(display.rows.first { it.key == "nickname" }.isDirty)
        }

    @Test
    fun recordViewOpenedEmitsTheSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(defaultPayload())), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "VehicleSettingsTab"), opened.single().second)
        }

    @Test
    fun mutationsAndRefreshAreLoggedWithoutAnyValue() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(defaultPayload())), logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.edit("nickname", "Stardust")
            vm.save("nickname")
            vm.reset("nickname")
            vm.refresh()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "vehicleSettings.save" })
            assertTrue(logger.events.any { it.first == "vehicleSettings.reset" })
            assertTrue(logger.events.any { it.first == "vehicleSettings.refresh" })
            // PII-safe: only the surface slug (and an error kind on failure) is ever recorded — never a value.
            assertTrue(logger.events.all { (_, fields) -> fields.keys.all { it == "surface" || it == "kind" } })
            assertFalse(logger.events.any { it.second.containsKey("value") })
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: VehicleSettingsTabSource,
        logger: Logger = RecordingLogger(),
    ): VehicleSettingsTabViewModel = VehicleSettingsTabViewModel(source, logger, backgroundScope)

    private fun TestScope.collectEvents(vm: VehicleSettingsTabViewModel): List<UiEvent> {
        val events = mutableListOf<UiEvent>()
        backgroundScope.launch { vm.state.collect {} }
        backgroundScope.launch { vm.events.collect { events += it } }
        return events
    }

    /** A fake whose feed re-reads its (mutable) resource on every (re)collection, so a refresh is observed. */
    private class FakeSource(
        var settings: Resource<VehicleSettingsResponse>,
        var upsertResult: Result<Unit> = Result.success(Unit),
        var resetResult: Result<Unit> = Result.success(Unit),
    ) : VehicleSettingsTabSource {
        val upserts = mutableListOf<Pair<String, JsonElement>>()
        val resets = mutableListOf<String>()
        var settingsCollections = 0

        override fun settings(): Flow<Resource<VehicleSettingsResponse>> =
            flow {
                settingsCollections += 1
                emit(settings)
            }

        override suspend fun upsert(
            key: String,
            value: JsonElement,
        ): Result<Unit> = upsertResult.also { upserts += key to value }

        override suspend fun reset(key: String): Result<Unit> = resetResult.also { resets += key }
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

        fun setting(
            key: String,
            value: JsonElement,
            source: EffectiveSettingSource,
        ): EffectiveSetting = EffectiveSetting(key = key, value = value, source = source)

        fun defaultPayload(): VehicleSettingsResponse =
            VehicleSettingsResponse(
                listOf(
                    setting("nickname", JsonPrimitive("Snowball"), EffectiveSettingSource.OVERRIDE),
                    setting("mute_until", JsonNull, EffectiveSettingSource.DEFAULT),
                    setting("charge_cost_tariff_id", JsonPrimitive(""), EffectiveSettingSource.DEFAULT),
                    setting("units_distance", JsonPrimitive("mi"), EffectiveSettingSource.USER),
                    setting("units_temperature", JsonPrimitive("F"), EffectiveSettingSource.USER),
                    setting("units_energy", JsonPrimitive("kWh"), EffectiveSettingSource.DEFAULT),
                ),
            )

        fun muteOverridePayload(): VehicleSettingsResponse =
            VehicleSettingsResponse(
                listOf(
                    setting("nickname", JsonPrimitive("Snowball"), EffectiveSettingSource.OVERRIDE),
                    setting("mute_until", JsonPrimitive("2025-12-31T23:59:00.000Z"), EffectiveSettingSource.OVERRIDE),
                    setting("charge_cost_tariff_id", JsonPrimitive(""), EffectiveSettingSource.DEFAULT),
                    setting("units_distance", JsonPrimitive("mi"), EffectiveSettingSource.USER),
                    setting("units_temperature", JsonPrimitive("F"), EffectiveSettingSource.USER),
                    setting("units_energy", JsonPrimitive("kWh"), EffectiveSettingSource.DEFAULT),
                ),
            )
    }
}
