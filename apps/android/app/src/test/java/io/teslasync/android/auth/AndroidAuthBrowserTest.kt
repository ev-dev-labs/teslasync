package io.teslasync.android.auth

import io.teslasync.shared.core.auth.RedirectResult
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [AndroidAuthBrowser]: it must hand the shared-core authorize URL to the
 * injected launcher and surface the redirect (or a user cancellation) the coordinator delivers,
 * satisfying the shared `AuthBrowser` contract without any Android framework.
 */
class AndroidAuthBrowserTest {
    @Test
    fun authorizeLaunchesUrlAndReturnsDeliveredRedirect() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            var launchedUrl: String? = null
            val browser = AndroidAuthBrowser(coordinator) { launchedUrl = it }
            var result: RedirectResult? = null

            val job =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    result = browser.authorize("https://auth.test/application/o/authorize/?state=s")
                }

            assertEquals("https://auth.test/application/o/authorize/?state=s", launchedUrl)
            coordinator.deliverSuccess("io.teslasync.android://oauth2redirect?code=c&state=s")
            job.join()
            assertEquals("io.teslasync.android://oauth2redirect?code=c&state=s", result?.callbackUri)
        }

    @Test
    fun authorizeSurfacesUserCancellationAsThrownException() =
        runTest {
            val coordinator = AuthRedirectCoordinator()
            val browser = AndroidAuthBrowser(coordinator) { }
            val outcomes = mutableListOf<Result<RedirectResult>>()

            val job =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    outcomes += runCatching { browser.authorize("https://auth.test/x") }
                }
            coordinator.deliverCancellation()
            job.join()

            assertTrue(outcomes.single().exceptionOrNull() is AuthCanceledException)
        }
}
