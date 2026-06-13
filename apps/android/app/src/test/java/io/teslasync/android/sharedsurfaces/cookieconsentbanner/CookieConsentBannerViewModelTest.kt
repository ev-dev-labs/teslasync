// Tests [CookieConsentBannerViewModel] against the requirement + consent seam — covering the contract the view
// depends on: the requirement re-shares onto a lifecycle-aware [io.teslasync.android.data.UiState] seeded as
// loading, an emitted gate surfaces as content/error, the per-user decision re-publishes the store and flips
// after accept/decline, the actions persist (web `setConsent`) and log slug-only PII-safe events, and the
// one-shot `view.opened` fires exactly once with the surface slug (never the user's decision). The framework-free
// projection is covered by CookieConsentBannerProjectionTest. Runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CookieConsentBannerViewModelTest {
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

    private class FakeConsentPersistence(
        initial: String? = null,
    ) : ConsentPersistence {
        var value: String? = initial

        override fun read(): String? = value

        override fun write(value: String?) {
            this.value = value
        }
    }

    private val stamp = 1_700_000_000_000L

    private fun source(
        persistence: FakeConsentPersistence = FakeConsentPersistence(),
        feed: () -> Flow<Resource<Boolean>> = { flowOf(Resource.Success(true, stamp, false)) },
    ): CookieConsentBannerSource = cookieConsentBannerSource(CookieConsentStore(persistence), feed)

    @Test
    fun requirementSeedsAsLoadingBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val model = CookieConsentBannerViewModel(source(), RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its cold-start loading seed.
            assertTrue(model.requirement.value.isLoading)
        }

    @Test
    fun requirementReflectsASuccessfulGate() =
        runTest(UnconfinedTestDispatcher()) {
            val model = CookieConsentBannerViewModel(source(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.requirement.collect {} }
            advanceUntilIdle()

            val state = model.requirement.value
            assertTrue(state.isContent)
            assertEquals(true, state.data)
        }

    @Test
    fun requirementReflectsAHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val errored =
                source(feed = {
                    flowOf(Resource.Error<Boolean>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x")))
                })
            val model = CookieConsentBannerViewModel(errored, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.requirement.collect {} }
            advanceUntilIdle()

            assertTrue(model.requirement.value.isError)
        }

    @Test
    fun acceptPersistsAndFlipsTheDecisionAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val persistence = FakeConsentPersistence()
            val logger = RecordingLogger()
            val model = CookieConsentBannerViewModel(source(persistence), logger, backgroundScope)

            model.accept()

            assertEquals("accepted", persistence.value)
            assertEquals(ConsentDecision.Accepted, model.consent.value)
            val accept = logger.records.filter { it.event == "cookieConsent.accept" }
            assertEquals(1, accept.size)
            assertEquals(mapOf("surface" to "CookieConsentBanner"), accept.single().fields)
        }

    @Test
    fun declinePersistsAndFlipsTheDecisionAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val persistence = FakeConsentPersistence()
            val logger = RecordingLogger()
            val model = CookieConsentBannerViewModel(source(persistence), logger, backgroundScope)

            model.decline()

            assertEquals("declined", persistence.value)
            assertEquals(ConsentDecision.Declined, model.consent.value)
            val decline = logger.records.filter { it.event == "cookieConsent.decline" }
            assertEquals(1, decline.size)
            assertEquals(mapOf("surface" to "CookieConsentBanner"), decline.single().fields)
        }

    @Test
    fun refreshLogsASlugOnlyEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CookieConsentBannerViewModel(source(), logger, backgroundScope)

            model.refresh()

            val refresh = logger.records.filter { it.event == "cookieConsent.refresh" }
            assertEquals(1, refresh.size)
            assertEquals(mapOf("surface" to "CookieConsentBanner"), refresh.single().fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CookieConsentBannerViewModel(source(), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("CookieConsentBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
