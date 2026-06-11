package io.teslasync.android.auth

import io.teslasync.shared.core.auth.RedirectResult
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [AuthRedirectCoordinator] — the framework-free bridge between the shared-core
 * `AuthBrowser.authorize` suspend call and the Android redirect activity. The launch side effect is
 * captured and the outcomes are delivered directly, so the PKCE-launch and callback success / error
 * / cancellation paths are proven without any Android dependency.
 */
class AuthRedirectCoordinatorTest {
    @Test
    fun runsLaunchSideEffectThenSuspendsForRedirect() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            var launchedCount = 0
            var result: RedirectResult? = null
            val job =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    result = coordinator.authorize { launchedCount += 1 }
                }

            assertEquals(1, launchedCount)
            assertTrue(coordinator.deliverSuccess("io.teslasync.android://oauth2redirect?code=c&state=s"))
            job.join()

            assertEquals("io.teslasync.android://oauth2redirect?code=c&state=s", result?.callbackUri)
        }

    @Test
    fun deliverErrorRethrowsFromAuthorize() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            val outcomes = mutableListOf<Result<RedirectResult>>()
            val job =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    outcomes += runCatching { coordinator.authorize { } }
                }

            assertTrue(coordinator.deliverError(IllegalStateException("provider error")))
            job.join()

            // Coroutine stack-trace recovery may rethrow a copy, so assert type + message, not identity.
            val error = outcomes.single().exceptionOrNull()
            assertTrue(error is IllegalStateException)
            assertEquals("provider error", error?.message)
        }

    @Test
    fun deliverCancellationThrowsAuthCanceled() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            val outcomes = mutableListOf<Result<RedirectResult>>()
            val job =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    outcomes += runCatching { coordinator.authorize { } }
                }

            coordinator.deliverCancellation()
            job.join()

            assertTrue(outcomes.single().exceptionOrNull() is AuthCanceledException)
        }

    @Test
    fun deliveryWithNoPendingRequestReturnsFalse() {
        val coordinator = AuthRedirectCoordinator()
        assertFalse(coordinator.deliverSuccess("io.teslasync.android://oauth2redirect?code=c&state=s"))
        assertFalse(coordinator.deliverCancellation())
    }

    @Test
    fun newAuthorizeSupersedesAnEarlierPendingOne() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            val first = mutableListOf<Result<RedirectResult>>()
            val second = mutableListOf<Result<RedirectResult>>()
            val firstJob =
                launch(start = CoroutineStart.UNDISPATCHED) { first += runCatching { coordinator.authorize { } } }
            val secondJob =
                launch(start = CoroutineStart.UNDISPATCHED) { second += runCatching { coordinator.authorize { } } }

            assertTrue(coordinator.deliverSuccess("io.teslasync.android://oauth2redirect?code=c&state=s"))
            firstJob.join()
            secondJob.join()

            assertTrue("first request should have been superseded", first.single().isFailure)
            assertEquals(
                "io.teslasync.android://oauth2redirect?code=c&state=s",
                second.single().getOrNull()?.callbackUri,
            )
        }
}
