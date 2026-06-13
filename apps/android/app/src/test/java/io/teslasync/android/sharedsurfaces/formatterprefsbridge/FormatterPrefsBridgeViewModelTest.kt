// Off-device unit tests for the FormatterPrefsBridge state holder: the permanent settings subscription folded
// into the published [FormatterPrefsState] (web `_globalLocale`/`_globalPrecision`), the guarded apply that only
// records on a real change (web `setGlobalLocale`/`setGlobalPrecision` via the `lastLocale`/`lastDecimals`
// refs), the defense-in-depth settings-changed refetch (web `subscribe(TOPICS.SETTINGS_CHANGED)`), and the
// one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FormatterPrefsBridgeViewModelTest {
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = FormatterPrefsBridgeViewModel(FakeSource(), logger, backgroundScope)
            vm.onViewOpened()
            vm.onViewOpened()
            advanceUntilIdle()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(FormatterPrefsBridgeRegistration.SLUG, opened.first().fields["surface"])
        }

    @Test
    fun startsAtMetricDefaultsThenExposesResolvedPrefs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = FormatterPrefsBridgeViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            // Before any document the bridge holds the metric defaults the web globals start at.
            assertFalse(vm.formatterPrefs.value.resolved)
            assertEquals("en-US", vm.formatterPrefs.value.prefs.locale)
            assertEquals(2, vm.formatterPrefs.value.prefs.decimalPrecision)

            source.settings.value =
                Resource.Success(
                    data =
                        buildJsonObject {
                            put("locale", "de-DE")
                            put("decimal_precision", 3)
                            put("unit_of_length", "mi")
                        },
                    fetchedAt = 1_000L,
                    stale = false,
                )
            advanceUntilIdle()

            val prefs = vm.formatterPrefs.value
            assertTrue(prefs.resolved)
            assertEquals("de-DE", prefs.prefs.locale)
            assertEquals(3, prefs.prefs.decimalPrecision)
            assertEquals(DistanceUnitPref.MI, prefs.prefs.unitPref.distance)
        }

    @Test
    fun appliedDiagnosticFiresOncePerDistinctResolveAndNotWhileUnresolved() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource()
            val vm = FormatterPrefsBridgeViewModel(source, logger, backgroundScope)
            advanceUntilIdle()
            // Unresolved (loading, no cache) ⇒ no apply, and never a leaked locale/precision value.
            assertEquals(0, appliedCount(logger))

            source.settings.value = success(precision = 2, fetchedAt = 1_000L)
            advanceUntilIdle()
            assertEquals(1, appliedCount(logger))

            // Identical refetch (same prefs, newer stamp) ⇒ guarded, no re-apply.
            source.settings.value = success(precision = 2, fetchedAt = 2_000L)
            advanceUntilIdle()
            assertEquals(1, appliedCount(logger))

            // Changed precision ⇒ a fresh apply.
            source.settings.value = success(precision = 4, fetchedAt = 3_000L)
            advanceUntilIdle()
            assertEquals(2, appliedCount(logger))

            assertEquals(FormatterPrefsBridgeRegistration.SLUG, applied(logger).first().fields["surface"])
            assertTrue(
                logger.records.none { record ->
                    record.fields.values.any { it == "de-DE" || it == "2" || it == "4" }
                },
            )
        }

    @Test
    fun settingsChangedSignalTriggersRefetch() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource()
            val vm = FormatterPrefsBridgeViewModel(source, logger, backgroundScope)
            advanceUntilIdle()
            assertEquals(0, refreshCount(logger))

            source.changed.emit(Unit)
            advanceUntilIdle()
            assertEquals(1, refreshCount(logger))

            source.changed.emit(Unit)
            advanceUntilIdle()
            assertEquals(2, refreshCount(logger))
            assertEquals(FormatterPrefsBridgeRegistration.SLUG, refreshes(logger).first().fields["surface"])
        }

    // ── fakes / helpers ──────────────────────────────────────────────────────────────
    private fun success(
        precision: Int,
        fetchedAt: Long,
    ): Resource<JsonElement> =
        Resource.Success(
            data =
                buildJsonObject {
                    put("locale", "en-US")
                    put("decimal_precision", precision)
                },
            fetchedAt = fetchedAt,
            stale = false,
        )

    private fun applied(logger: RecordingLogger) = logger.records.filter { it.event == "formatterPrefsBridge.applied" }

    private fun appliedCount(logger: RecordingLogger) = applied(logger).size

    private fun refreshes(logger: RecordingLogger) = logger.records.filter { it.event == "formatterPrefsBridge.refresh" }

    private fun refreshCount(logger: RecordingLogger) = refreshes(logger).size

    private class FakeSource(
        val settings: MutableStateFlow<Resource<JsonElement>> =
            MutableStateFlow(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
        val changed: MutableSharedFlow<Unit> = MutableSharedFlow(extraBufferCapacity = 8),
    ) : FormatterPrefsBridgeSource {
        override fun settings(): Flow<Resource<JsonElement>> = settings

        override fun settingsChanged(): Flow<Unit> = changed
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }
}
