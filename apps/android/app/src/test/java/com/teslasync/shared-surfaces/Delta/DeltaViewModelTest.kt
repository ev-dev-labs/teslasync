// Tests [DeltaViewModel] against the [StaticDeltaUnitSource] seam — covering the state-holder binding the
// P3 contract mandates: the metric-default context before any subscriber, the live context routed from
// the bound source while observed, a settings change re-emitting a fresh context (web `useUnits` /
// `useFormatting` re-deriving from `useSettings`), and the one-shot PII-safe `view.opened` diagnostic
// (slug only, no metric value). The framework-free model is covered by DeltaModelTest. Runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DeltaViewModelTest {
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

    @Test
    fun contextDefaultsToMetricBeforeAnySubscriber() =
        runTest(UnconfinedTestDispatcher()) {
            val model = DeltaViewModel(StaticDeltaUnitSource(), RecordingLogger(), backgroundScope)
            assertEquals(DeltaUnitContext.DEFAULT, model.context.value)
        }

    @Test
    fun contextReflectsTheBoundSourceWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val source = StaticDeltaUnitSource(MutableStateFlow(imperialEuro()))
            val model = DeltaViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.context.collect {} }
            advanceUntilIdle()

            assertEquals("€", model.context.value.currencySymbol)
            assertEquals(DistanceUnitPref.MI, model.context.value.prefs.distance)
        }

    @Test
    fun contextReEmitsWhenSettingsChange() =
        runTest(UnconfinedTestDispatcher()) {
            val flow = MutableStateFlow(DeltaUnitContext.DEFAULT)
            val model = DeltaViewModel(StaticDeltaUnitSource(flow), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.context.collect {} }
            advanceUntilIdle()
            assertEquals("$", model.context.value.currencySymbol)

            flow.value = imperialEuro()
            advanceUntilIdle()

            assertEquals("€", model.context.value.currencySymbol)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = DeltaViewModel(StaticDeltaUnitSource(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("Delta", opened.first().fields["surface"])
        }

    private fun imperialEuro(): DeltaUnitContext =
        DeltaUnitContext.fromSettings(
            buildJsonObject {
                put("unit_of_length", "mi")
                put("currency_symbol", "€")
            },
        )
}
