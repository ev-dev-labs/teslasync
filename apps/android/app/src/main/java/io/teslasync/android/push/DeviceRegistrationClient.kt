package io.teslasync.android.push

import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest

/**
 * The port the registration service uses to register and unregister this device with TeslaSync's
 * additive `/api/v1/devices` endpoint (P3/A6, ADR-009). It is a focused seam so the registration logic
 * is testable with a fake. Every method returns a non-throwing [Result].
 */
interface DeviceRegistrationClient {
    /** Registers (upserts) this device's channel; returns the backend registration response. */
    suspend fun register(request: DeviceRegistrationRequest): Result<DeviceRegistrationResponse>

    /**
     * Unregisters the device session identified by [registrationId] so the backend stops fanning push
     * to this channel. A `404` is treated as already-removed (idempotent sign-out cleanup).
     */
    suspend fun unregister(registrationId: String): Result<Unit>
}

/**
 * The single real [DeviceRegistrationClient] (P3/A6). It goes through the shared resilient
 * [ApiHttpClient] — so registration carries the A4 bearer token and the shared resilience handler, and
 * the `/api/v1` version segment is applied exactly once.
 *
 * The device-registration endpoint is an additive ADR-009 contract that the OpenAPI source-of-truth
 * does not yet expose (the backend route is provisioned in P5/H5-0001), so this client targets the
 * ADR-009 path directly via [DEVICES_PATH]; it is the one seam to migrate to a generated descriptor
 * the moment the contract is emitted.
 */
class HttpDeviceRegistrationClient(
    private val api: ApiHttpClient,
) : DeviceRegistrationClient {
    override suspend fun register(request: DeviceRegistrationRequest): Result<DeviceRegistrationResponse> =
        api
            .safeRequest<DeviceRegistrationResponse>(
                method = HttpMethodKind.POST,
                path = DEVICES_PATH,
                body = request,
            ).mapCatching { response ->
                require(response.id.isNotBlank()) { "Device registration returned no registration id" }
                response
            }

    override suspend fun unregister(registrationId: String): Result<Unit> =
        api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "$DEVICES_PATH/$registrationId",
            ).fold(
                onSuccess = { Result.success(Unit) },
                onFailure = { error -> if (isAlreadyRemoved(error)) Result.success(Unit) else Result.failure(error) },
            )

    private fun isAlreadyRemoved(error: Throwable): Boolean = error is ApiError.Http && error.status == NOT_FOUND

    private companion object {
        /** The additive ADR-009 device-registration route (the `/api/v1` prefix is added by the client). */
        const val DEVICES_PATH = "/devices"
        const val NOT_FOUND = 404
    }
}
