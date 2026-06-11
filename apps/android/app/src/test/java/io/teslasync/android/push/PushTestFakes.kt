package io.teslasync.android.push

/** A [PushTokenProvider] fake: returns a configurable token (or signals unavailable) and counts deletes. */
class FakePushTokenProvider(
    var token: String? = "token-a",
) : PushTokenProvider {
    var deleteCount = 0

    override suspend fun currentToken(): PushChannel {
        val current = token ?: throw PushChannelUnavailableException("no token configured")
        return PushChannel(current)
    }

    override suspend fun deleteToken() {
        deleteCount += 1
    }
}

/** A [DeviceRegistrationClient] fake: records calls and returns configurable results. */
class FakeDeviceRegistrationClient : DeviceRegistrationClient {
    val registered = mutableListOf<DeviceRegistrationRequest>()
    val unregistered = mutableListOf<String>()
    var nextResponse: Result<DeviceRegistrationResponse> = Result.success(DeviceRegistrationResponse(id = "reg-1"))
    var unregisterResult: Result<Unit> = Result.success(Unit)

    override suspend fun register(request: DeviceRegistrationRequest): Result<DeviceRegistrationResponse> {
        registered.add(request)
        return nextResponse
    }

    override suspend fun unregister(registrationId: String): Result<Unit> {
        unregistered.add(registrationId)
        return unregisterResult
    }
}

/** A fixed [PushEnvironment] for tests. */
fun testPushEnvironment(): PushEnvironment =
    StaticPushEnvironment(
        appVersion = "0.1.0",
        locale = "en-US",
        stableDeviceId = "device-xyz",
    )
