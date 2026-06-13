// Tests [InsightsEngineViewModel] against the [StaticInsightsFormattingSource] seam — covering the
// state-holder binding the P3 contract mandates: the default context before any subscriber, the live
// context routed from the bound source while observed, a settings change re-emitting a fresh context
// (web `useFormatting` re-deriving from `useSettings`), and the one-shot PII-safe `view.opened`
// diagnostic (slug only, no fleet data). The framework-free model is covered by
// InsightsEngineModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class InsightsEngineViewModelTest {
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
    fun formattingDefaultsBeforeAnySubscriber() =
        runTest(UnconfinedTestDispatcher()) {
            val model = InsightsEngineViewModel(StaticInsightsFormattingSource(), RecordingLogger(), backgroundScope)
            assertEquals(InsightsFormatting.DEFAULT, model.formatting.value)
        }

    @Test
    fun formattingReflectsTheBoundSourceWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val source = StaticInsightsFormattingSource(MutableStateFlow(euro()))
            val model = InsightsEngineViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.formatting.collect {} }
            advanceUntilIdle()

            assertEquals("€", model.formatting.value.currencySymbol)
            assertEquals(1, model.formatting.value.precision)
        }

    @Test
    fun formattingReEmitsWhenSettingsChange() =
        runTest(UnconfinedTestDispatcher()) {
            val flow = MutableStateFlow(InsightsFormatting.DEFAULT)
            val model = InsightsEngineViewModel(StaticInsightsFormattingSource(flow), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.formatting.collect {} }
            advanceUntilIdle()
            assertEquals("$", model.formatting.value.currencySymbol)

            flow.value = euro()
            advanceUntilIdle()

            assertEquals("€", model.formatting.value.currencySymbol)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = InsightsEngineViewModel(StaticInsightsFormattingSource(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("InsightsEngine", opened.first().fields["surface"])
        }

    private fun euro(): InsightsFormatting = InsightsFormatting(currencySymbol = "€", precision = 1, localeTag = "de-DE")
}
