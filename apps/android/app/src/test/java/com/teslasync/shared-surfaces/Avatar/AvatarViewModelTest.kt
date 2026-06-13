// Off-device unit tests for [AvatarViewModel] over a controllable fake [AvatarSource] (the
// :android:testReleaseUnitTest gate). They cover the anonymous initial state before the seam emits, binding a
// provided identity, reflecting a live presence transition for the holder's lifetime (the reason the seam is a
// Flow), the static-source factory, and the PII-safe one-shot `view.opened` diagnostic. Mirrors the web
// Avatar's prop-driven identity (web/src/components/data-display/Avatar.tsx); the framework-free model is
// covered by AvatarModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

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
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AvatarViewModelTest {
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

    /** A fake identity seam whose [Flow] the test fully controls (real adapter ↔ test fake, never the network). */
    private class FakeAvatarSource(
        private val flow: Flow<AvatarIdentity>,
    ) : AvatarSource {
        override fun identity(): Flow<AvatarIdentity> = flow
    }

    @Test
    fun stateStartsAnonymousBeforeSourceEmits() =
        runTest(UnconfinedTestDispatcher()) {
            // A seam that has not emitted yet stands in for an unresolved identity — the anonymous zero value.
            val model = AvatarViewModel(FakeAvatarSource(MutableSharedFlow()), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(AvatarIdentity(), model.state.value)
        }

    @Test
    fun bindsIdentityFromSource() =
        runTest(UnconfinedTestDispatcher()) {
            val identity = AvatarIdentity(userId = "u1", name = "John Doe", status = AvatarStatus.Online)
            val model = AvatarViewModel(FakeAvatarSource(MutableStateFlow(identity)), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(identity, model.state.value)
        }

    @Test
    fun reflectsLivePresenceTransition() =
        runTest(UnconfinedTestDispatcher()) {
            val flow = MutableStateFlow(AvatarIdentity(userId = "u1", name = "John", status = AvatarStatus.Online))
            val model = AvatarViewModel(FakeAvatarSource(flow), RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(AvatarStatus.Online, model.state.value.status)

            // The seam is bound for the holder's lifetime — a later presence change updates the dot in place.
            flow.value = flow.value.copy(status = AvatarStatus.Offline)
            advanceUntilIdle()
            assertEquals(AvatarStatus.Offline, model.state.value.status)
        }

    @Test
    fun staticSourceEmitsProvidedIdentity() =
        runTest(UnconfinedTestDispatcher()) {
            val identity = AvatarIdentity(name = "Cher")
            val model = AvatarViewModel(staticAvatarSource(identity), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(identity, model.state.value)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = AvatarViewModel(staticAvatarSource(AvatarIdentity()), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("Avatar", opened.first().fields["surface"])
        }
}
