package io.teslasync.android.push

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [PushRegistrationCoordinator]. A fake auth [MutableStateFlow] drives a real
 * service (over fakes) so the auth-lifecycle binding is verified: sign-in registers, sign-out
 * unregisters, and a transparent refresh does not drop the registration (P3/A6, ADR-009).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistrationCoordinatorTest {
    private fun signedIn(): AuthState.SignedIn = AuthState.SignedIn(TokenSet("a", "r", null, 9_999L))

    private fun service(
        provider: FakePushTokenProvider,
        client: FakeDeviceRegistrationClient,
    ): PushRegistrationService =
        PushRegistrationService(
            tokenProvider = provider,
            client = client,
            store = InMemoryPushRegistrationStore(),
            environment = testPushEnvironment(),
            diagnostics = PushDiagnostics(NoopLogger),
        )

    @Test
    fun signInRegistersAndSignOutUnregisters() =
        runTest {
            val client = FakeDeviceRegistrationClient()
            val service = service(FakePushTokenProvider("token-a"), client)
            val authState = MutableStateFlow<AuthState>(AuthState.SignedOut)

            PushRegistrationCoordinator(service, authState, backgroundScope).start()
            runCurrent()

            authState.value = signedIn()
            runCurrent()
            assertTrue(service.state.value is PushRegistrationState.Registered)

            authState.value = AuthState.SignedOut
            runCurrent()
            assertEquals(PushRegistrationState.Unregistered, service.state.value)
            assertEquals(listOf("reg-1"), client.unregistered)
        }

    @Test
    fun aTransparentRefreshDoesNotReRegisterOrDrop() =
        runTest {
            val client = FakeDeviceRegistrationClient()
            val service = service(FakePushTokenProvider("token-a"), client)
            val authState = MutableStateFlow<AuthState>(AuthState.SignedOut)

            PushRegistrationCoordinator(service, authState, backgroundScope).start()
            runCurrent()
            authState.value = signedIn()
            runCurrent()
            authState.value = AuthState.Refreshing(TokenSet("a2", "r2", null, 9_999L))
            runCurrent()

            assertTrue(service.state.value is PushRegistrationState.Registered)
            assertEquals(1, client.registered.size)
            assertTrue(client.unregistered.isEmpty())
        }
}
