package io.teslasync.android.push

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [PushRegistrationService]. Fakes for the token provider, backend client and store
 * (no Firebase, no network) drive the orchestrator so its register / renew / unregister / auth-change
 * lifecycle and its failure handling are verified deterministically (P3/A6, ADR-009).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistrationServiceTest {
    private fun service(
        provider: PushTokenProvider,
        client: DeviceRegistrationClient,
        store: PushRegistrationStore,
    ): PushRegistrationService =
        PushRegistrationService(
            tokenProvider = provider,
            client = client,
            store = store,
            environment = testPushEnvironment(),
            diagnostics = PushDiagnostics(NoopLogger),
            clock = { 1_000L },
        )

    @Test
    fun registerSendsTheTokenAndStoresTheRecord() =
        runTest {
            val provider = FakePushTokenProvider("token-a")
            val client = FakeDeviceRegistrationClient()
            val store = InMemoryPushRegistrationStore()

            val state = service(provider, client, store).register()

            assertTrue(state is PushRegistrationState.Registered)
            assertEquals("reg-1", (state as PushRegistrationState.Registered).registrationId)
            assertEquals(1, client.registered.size)
            assertEquals("token-a", client.registered.first().channelUri)
            assertEquals(PushCapabilities.FCM_PROVIDER, client.registered.first().pushProvider)
            assertEquals("device-xyz", client.registered.first().deviceId)
            assertEquals("reg-1", store.load()?.registrationId)
        }

    @Test
    fun registerWithNoTokenFailsWithChannelUnavailableAndDoesNotCallBackend() =
        runTest {
            val client = FakeDeviceRegistrationClient()

            val state = service(FakePushTokenProvider(token = null), client, InMemoryPushRegistrationStore()).register()

            assertEquals(PushRegistrationState.Failed("channel_unavailable"), state)
            assertTrue(client.registered.isEmpty())
        }

    @Test
    fun registerRejectedByBackendFailsWithoutStoringARecord() =
        runTest {
            val client = FakeDeviceRegistrationClient().apply { nextResponse = Result.failure(ApiError.Http(status = 500)) }
            val store = InMemoryPushRegistrationStore()

            val state = service(FakePushTokenProvider("token-a"), client, store).register()

            assertEquals(PushRegistrationState.Failed("register_rejected"), state)
            assertNull(store.load())
        }

    @Test
    fun renewSkipsTheBackendWhenTheTokenIsUnchanged() =
        runTest {
            val provider = FakePushTokenProvider("token-a")
            val client = FakeDeviceRegistrationClient()
            val store = InMemoryPushRegistrationStore()
            val service = service(provider, client, store)

            service.register()
            client.nextResponse = Result.success(DeviceRegistrationResponse(id = "reg-2"))
            val state = service.renew()

            assertEquals("reg-1", (state as PushRegistrationState.Registered).registrationId)
            assertEquals(1, client.registered.size)
        }

    @Test
    fun renewReRegistersWhenTheTokenChanged() =
        runTest {
            val provider = FakePushTokenProvider("token-a")
            val client = FakeDeviceRegistrationClient()
            val service = service(provider, client, InMemoryPushRegistrationStore())

            service.register()
            provider.token = "token-b"
            client.nextResponse = Result.success(DeviceRegistrationResponse(id = "reg-2"))
            val state = service.renew()

            assertEquals("reg-2", (state as PushRegistrationState.Registered).registrationId)
            assertEquals(2, client.registered.size)
            assertEquals("token-b", client.registered.last().channelUri)
        }

    @Test
    fun signOutUnregistersDeletesTheTokenAndClearsLocalState() =
        runTest {
            val provider = FakePushTokenProvider("token-a")
            val client = FakeDeviceRegistrationClient()
            val store = InMemoryPushRegistrationStore()
            val service = service(provider, client, store)

            service.onAuthChanged(signedIn = true)
            service.onAuthChanged(signedIn = false)

            assertEquals(PushRegistrationState.Unregistered, service.state.value)
            assertEquals(listOf("reg-1"), client.unregistered)
            assertEquals(1, provider.deleteCount)
            assertNull(store.load())
        }

    @Test
    fun unregisterClearsLocalStateEvenWhenTheBackendRevokeFails() =
        runTest {
            val provider = FakePushTokenProvider("token-a")
            val client = FakeDeviceRegistrationClient()
            val store = InMemoryPushRegistrationStore()
            val service = service(provider, client, store)

            service.register()
            client.unregisterResult = Result.failure(ApiError.Http(status = 500))
            service.unregister()

            assertEquals(PushRegistrationState.Unregistered, service.state.value)
            assertEquals(1, provider.deleteCount)
            assertNull(store.load())
        }
}
