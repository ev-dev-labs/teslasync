// Off-device unit tests for [AIThinkingIndicatorViewModel] over a controllable fake [AIThinkingIndicatorSource]
// (the :android:testReleaseUnitTest gate). They cover the full-motion initial state before the preference
// resolves, a reduced-motion emission freezing the indicator, the preference flipping for the holder's lifetime
// (web `prefers-reduced-motion` toggled live), and the PII-safe one-shot `view.opened` diagnostic. Mirrors the
// web component's `motion-safe:` gating (web/src/components/ai/AIThinkingIndicator.tsx). The framework-free model
// is covered by AIThinkingIndicatorModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

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
class AIThinkingIndicatorViewModelTest {
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

    /** A fake reduced-motion seam whose [Flow] the test fully controls (real adapter ↔ test fake, never the OS). */
    private class FakeMotionSource(
        private val motion: Flow<Boolean>,
    ) : AIThinkingIndicatorSource {
        override fun reducedMotion(): Flow<Boolean> = motion
    }

    @Test
    fun stateStartsAnimatedBeforeThePreferenceResolves() =
        runTest(UnconfinedTestDispatcher()) {
            // A flow that has not emitted yet stands in for the unresolved platform preference — full motion.
            val model =
                AIThinkingIndicatorViewModel(
                    FakeMotionSource(MutableSharedFlow<Boolean>()),
                    RecordingLogger(),
                    backgroundScope,
                )
            advanceUntilIdle()

            assertFalse(model.state.value.reducedMotion)
            assertTrue(projectThinkingDots(model.state.value.reducedMotion).animated)
        }

    @Test
    fun reducedMotionEmissionFreezesTheIndicator() =
        runTest(UnconfinedTestDispatcher()) {
            val motion = MutableStateFlow(false)
            val model = AIThinkingIndicatorViewModel(FakeMotionSource(motion), RecordingLogger(), backgroundScope)

            motion.value = true
            advanceUntilIdle()

            assertTrue(model.state.value.reducedMotion)
            assertFalse(projectThinkingDots(model.state.value.reducedMotion).animated)
        }

    @Test
    fun preferenceTogglesForTheHoldersLifetime() =
        runTest(UnconfinedTestDispatcher()) {
            val motion = MutableStateFlow(true)
            val model = AIThinkingIndicatorViewModel(FakeMotionSource(motion), RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertTrue(model.state.value.reducedMotion)

            // The seam is bound for the holder's lifetime — a later change switches the render (web media query).
            motion.value = false
            advanceUntilIdle()
            assertFalse(model.state.value.reducedMotion)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = AIThinkingIndicatorViewModel(FakeMotionSource(MutableStateFlow(false)), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("AIThinkingIndicator", opened.first().fields["surface"])
        }
}
