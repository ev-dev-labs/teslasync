// Off-device unit tests for [PressureViewModel] over a controllable fake [PressureSource] (the
// :android:testReleaseUnitTest gate). They cover the metric-default state before the seam emits, binding a
// provided formatter, reflecting a live unit-preference change for the holder's lifetime (the reason the seam
// is a Flow), the static-source factory, and the PII-safe one-shot `view.opened` diagnostic. Mirrors the web
// Pressure component's `useUnits()` binding (web/src/components/data-display/format/Pressure.tsx); the
// framework-free model is covered by PressureModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PressureUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PressureViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    /** A fake units seam whose [Flow] the test fully controls (real adapter ↔ test fake, never the network). */
    private class FakePressureSource(
        private val flow: Flow<UnitFormatter>,
    ) : PressureSource {
        override fun units(): Flow<UnitFormatter> = flow
    }

    /** A psi-preference formatter (the metric default already represents bar). */
    private fun psiFormatter(): UnitFormatter =
        UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_pressure", "psi") }))

    @Test
    fun stateStartsMetricDefaultBeforeSourceEmits() =
        runTest(UnconfinedTestDispatcher()) {
            // A seam that has not emitted yet stands in for an unresolved preference — the metric default.
            val model = PressureViewModel(FakePressureSource(MutableSharedFlow()), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(UnitFormatter.default().prefs, model.state.value.prefs)
        }

    @Test
    fun bindsFormatterFromSource() =
        runTest(UnconfinedTestDispatcher()) {
            val model = PressureViewModel(FakePressureSource(MutableStateFlow(psiFormatter())), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(PressureUnitPref.PSI, model.state.value.prefs.pressure)
        }

    @Test
    fun reflectsLiveUnitPreferenceChange() =
        runTest(UnconfinedTestDispatcher()) {
            val flow = MutableStateFlow(UnitFormatter.default())
            val model = PressureViewModel(FakePressureSource(flow), RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(PressureUnitPref.BAR, model.state.value.prefs.pressure)

            // The seam is bound for the holder's lifetime — a later settings change re-renders the value in place.
            flow.value = psiFormatter()
            advanceUntilIdle()
            assertEquals(PressureUnitPref.PSI, model.state.value.prefs.pressure)
        }

    @Test
    fun staticSourceEmitsProvidedFormatter() =
        runTest(UnconfinedTestDispatcher()) {
            val model = PressureViewModel(staticPressureSource(psiFormatter()), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(PressureUnitPref.PSI, model.state.value.prefs.pressure)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = PressureViewModel(staticPressureSource(UnitFormatter.default()), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("Pressure", opened.first().fields["surface"])
        }
}
