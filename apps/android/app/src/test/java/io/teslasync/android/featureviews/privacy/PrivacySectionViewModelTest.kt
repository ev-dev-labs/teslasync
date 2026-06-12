package io.teslasync.android.featureviews.privacy

import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [PrivacySectionViewModel]: the PII-safe `view.opened` diagnostic (P1/S11), the combine of the two
 * client feeds + the version policy onto the render surface, and the four mutations' store calls + one-shot
 * success toasts. The web source composes synchronous recent-pages/consent stores with a non-blocking
 * version query, so the holder's states are Loading (the pre-resolution frame) and Content (the resolved
 * snapshot + the version freshness envelope); a failed version feed never blanks the surface, it only
 * falls the consent body back to `requireConsent = false`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PrivacySectionViewModelTest {
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

    private class FakeRecentPages(
        initial: Int,
    ) : RecentPagesController {
        val countFlow = MutableStateFlow(initial)
        var clearCount = 0

        override fun count(): Flow<Int> = countFlow

        override suspend fun clear() {
            clearCount += 1
            countFlow.value = 0
        }
    }

    private class FakeConsent(
        initial: ConsentState,
    ) : CookieConsentStore {
        val consentFlow = MutableStateFlow(initial)
        val sets = mutableListOf<ConsentState>()

        override fun consent(): Flow<ConsentState> = consentFlow

        override suspend fun set(state: ConsentState) {
            sets += state
            consentFlow.value = state
        }
    }

    private class FakePolicy(
        initial: Resource<Boolean>,
    ) : ConsentPolicySource {
        val flow = MutableStateFlow(initial)
        var refreshCount = 0

        override fun requireConsent(): Flow<Resource<Boolean>> = flow

        override suspend fun refresh() {
            refreshCount += 1
        }
    }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = newViewModel(scope = backgroundScope, logger = logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "PrivacySection"), opened.single().second)
            // The surface's values are privacy-sensitive; the diagnostic carries nothing beyond the slug.
            assertEquals(setOf("surface"), opened.single().second.keys)
        }

    @Test
    fun initialStateIsLoadingBeforeTheStoresResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newViewModel(scope = backgroundScope)

            // WhileSubscribed keeps the initial value until the UI subscribes — the skeleton frame.
            assertEquals(PrivacyUiState.Loading, vm.state.value)
        }

    @Test
    fun resolvedStoresFoldIntoContentSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                newViewModel(
                    scope = backgroundScope,
                    recentPages = FakeRecentPages(initial = 7),
                    consent = FakeConsent(ConsentState.Accepted),
                    policy = FakePolicy(success(requireConsent = true)),
                )

            backgroundScope.launch { vm.state.collect {} }

            val content = vm.state.value as PrivacyUiState.Content
            assertEquals(7, content.snapshot.recentCount)
            assertEquals(ConsentState.Accepted, content.snapshot.consent)
            assertTrue(content.snapshot.requireConsent)
        }

    @Test
    fun clearRecentPagesWipesTheStoreAndToasts() =
        runTest(UnconfinedTestDispatcher()) {
            val recent = FakeRecentPages(initial = 4)
            val vm = newViewModel(scope = backgroundScope, recentPages = recent)
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { received += it } }

            vm.clearRecentPages()

            assertEquals(1, recent.clearCount)
            assertEquals(0, recent.countFlow.value)
            val message = received.filterIsInstance<UiEvent.Message>().single()
            assertEquals(PrivacySectionViewModel.MESSAGE_CLEARED, message.messageKey)
            assertEquals(UiEvent.Severity.Success, message.severity)
        }

    @Test
    fun consentMutationsPersistAndToast() =
        runTest(UnconfinedTestDispatcher()) {
            val consent = FakeConsent(ConsentState.Unknown)
            val vm = newViewModel(scope = backgroundScope, consent = consent)
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { received += it } }

            vm.acceptConsent()
            vm.declineConsent()
            vm.resetConsent()

            assertEquals(listOf(ConsentState.Accepted, ConsentState.Declined, ConsentState.Unknown), consent.sets)
            val keys = received.filterIsInstance<UiEvent.Message>().map { it.messageKey }
            assertEquals(
                listOf(
                    PrivacySectionViewModel.MESSAGE_ACCEPTED,
                    PrivacySectionViewModel.MESSAGE_DECLINED,
                    PrivacySectionViewModel.MESSAGE_RESET,
                ),
                keys,
            )
        }

    @Test
    fun versionErrorFallsBackToConsentNotRequiredButStaysVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                newViewModel(
                    scope = backgroundScope,
                    policy =
                        FakePolicy(
                            Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")),
                        ),
                )

            backgroundScope.launch { vm.state.collect {} }

            val content = vm.state.value as PrivacyUiState.Content
            // Web parity: a failed version response → requireConsent=false (bodyOff), panel never hidden.
            assertFalse(content.snapshot.requireConsent)
            assertTrue(content.version.hasError)
        }

    @Test
    fun refreshVersionRecollectsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val policy = FakePolicy(success(requireConsent = false))
            val vm = newViewModel(scope = backgroundScope, policy = policy)

            vm.refreshVersion()

            assertEquals(1, policy.refreshCount)
        }

    private fun newViewModel(
        scope: CoroutineScope,
        recentPages: RecentPagesController = FakeRecentPages(initial = 0),
        consent: CookieConsentStore = FakeConsent(ConsentState.Unknown),
        policy: ConsentPolicySource = FakePolicy(success(requireConsent = false)),
        logger: Logger = RecordingLogger(),
    ): PrivacySectionViewModel = PrivacySectionViewModel(recentPages, consent, policy, logger, scope = scope)

    private fun success(requireConsent: Boolean): Resource<Boolean> =
        Resource.Success(data = requireConsent, fetchedAt = NOW, stale = false)

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
