// Off-device unit tests for [WithAiFeatureViewModel] over a controllable fake [WithAiFeatureSource] gate (the
// :android:testReleaseUnitTest gate). They cover the fail-closed initial state before the gate resolves (the
// content hidden while web settings load), an enabled gate making the surface visible, a disabled gate hiding
// it, the gate flipping for the holder's lifetime, the bound feature being threaded to the source, and the
// PII-safe one-shot `view.opened` diagnostic. Mirrors the web component's `withAiFeature(feature, Inner)`
// visibility gate (web/src/components/ai/withAiFeature.tsx). The framework-free model is covered by
// WithAiFeatureModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package;
// `ktlint:standard:filename` / `MatchingDeclarationName` for the camelCase web-source file name (`withAiFeature`).
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.withaifeature

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
class WithAiFeatureViewModelTest {
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

    /** A fake gate seam whose [Flow] the test fully controls; records the feature it is asked to resolve. */
    private class FakeGateSource(
        private val gate: Flow<Boolean>,
    ) : WithAiFeatureSource {
        var requestedFeature: String? = null

        override fun aiEnabled(feature: String): Flow<Boolean> {
            requestedFeature = feature
            return gate
        }
    }

    @Test
    fun stateStartsHiddenFailClosedBeforeGateResolves() =
        runTest(UnconfinedTestDispatcher()) {
            // A gate that has not emitted yet stands in for the unresolved web settings query.
            val model =
                WithAiFeatureViewModel(
                    FakeGateSource(MutableSharedFlow<Boolean>()),
                    "chatbot-llm",
                    RecordingLogger(),
                    backgroundScope,
                )
            advanceUntilIdle()

            assertFalse(model.state.value.gateEnabled)
            assertEquals(GateSurface.Hidden, classifyGate(model.state.value))
        }

    @Test
    fun enabledGateMakesSurfaceVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = MutableStateFlow(false)
            val model = WithAiFeatureViewModel(FakeGateSource(gate), "chatbot-llm", RecordingLogger(), backgroundScope)

            gate.value = true
            advanceUntilIdle()

            assertTrue(model.state.value.gateEnabled)
            assertEquals(GateSurface.Visible, classifyGate(model.state.value))
        }

    @Test
    fun disabledGateHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = MutableStateFlow(true)
            val model = WithAiFeatureViewModel(FakeGateSource(gate), "chatbot-llm", RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(GateSurface.Visible, classifyGate(model.state.value))

            // The gate is bound for the holder's lifetime — a later disable hides the content (web `withAiFeature`).
            gate.value = false
            advanceUntilIdle()
            assertEquals(GateSurface.Hidden, classifyGate(model.state.value))
        }

    @Test
    fun gateIsResolvedForTheBoundFeature() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeGateSource(MutableStateFlow(false))
            WithAiFeatureViewModel(source, "nl-search", RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            // The view-model threads its bound feature id to the source (web `useAiEnabled(feature)`).
            assertEquals("nl-search", source.requestedFeature)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = WithAiFeatureViewModel(FakeGateSource(MutableStateFlow(false)), "chatbot-llm", logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("withAiFeature", opened.first().fields["surface"])
        }
}
