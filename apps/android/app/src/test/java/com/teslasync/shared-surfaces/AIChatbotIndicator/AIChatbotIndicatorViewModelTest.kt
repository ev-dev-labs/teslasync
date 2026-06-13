// Off-device unit tests for [AIChatbotIndicatorViewModel] over a controllable fake [AIChatbotIndicatorSource]
// gate (the :android:testReleaseUnitTest gate). They cover the fail-closed initial state before the gate
// resolves (the badge hidden while web settings load), an enabled gate making the surface visible, a disabled
// gate hiding it, the gate flipping for the holder's lifetime, and the PII-safe one-shot `view.opened`
// diagnostic. Mirrors the web component's `withAiFeature('chatbot-llm', …)` visibility gate
// (web/src/components/ai/AIChatbotIndicator.tsx). The framework-free model is covered by
// AIChatbotIndicatorModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIChatbotIndicatorViewModelTest {
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

    /** A fake gate seam whose [Flow] the test fully controls (real adapter ↔ test fake, never the network). */
    private class FakeGateSource(
        private val gate: Flow<Boolean>,
    ) : AIChatbotIndicatorSource {
        override fun featureEnabled(): Flow<Boolean> = gate
    }

    @Test
    fun stateStartsHiddenFailClosedBeforeGateResolves() =
        runTest(UnconfinedTestDispatcher()) {
            // A gate that has not emitted yet stands in for the unresolved web settings query.
            val model =
                AIChatbotIndicatorViewModel(FakeGateSource(MutableSharedFlow<Boolean>()), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertFalse(model.state.value.gateEnabled)
            assertEquals(IndicatorSurface.Hidden, classifyIndicator(model.state.value))
        }

    @Test
    fun enabledGateMakesSurfaceVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = MutableStateFlow(false)
            val model = AIChatbotIndicatorViewModel(FakeGateSource(gate), RecordingLogger(), backgroundScope)

            gate.value = true
            advanceUntilIdle()

            assertTrue(model.state.value.gateEnabled)
            assertEquals(IndicatorSurface.Visible, classifyIndicator(model.state.value))
        }

    @Test
    fun disabledGateHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = MutableStateFlow(true)
            val model = AIChatbotIndicatorViewModel(FakeGateSource(gate), RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(IndicatorSurface.Visible, classifyIndicator(model.state.value))

            // The gate is bound for the holder's lifetime — a later disable hides the chip (web `withAiFeature`).
            gate.value = false
            advanceUntilIdle()
            assertEquals(IndicatorSurface.Hidden, classifyIndicator(model.state.value))
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = AIChatbotIndicatorViewModel(FakeGateSource(MutableStateFlow(false)), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("AIChatbotIndicator", opened.first().fields["surface"])
        }
}
