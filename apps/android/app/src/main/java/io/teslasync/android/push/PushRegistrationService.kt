package io.teslasync.android.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Orchestrates FCM device registration with TeslaSync (P3/A6, ADR-009): it requests a token from the
 * [PushTokenProvider], registers it with the backend `/api/v1/devices` contract, re-registers when the
 * token changes or after an auth change, and unregisters on sign-out (and after a revoke failure). It
 * is headless and fully testable — the token provider, backend client, local store, device facts and
 * clock are all injected.
 *
 * A single [Mutex] serializes register / renew / unregister so an auth-driven renewal can never race a
 * concurrent sign-out cleanup. Failures never crash the host: a missing token or a rejected
 * registration parks the state in [PushRegistrationState.Failed] with a PII-free reason, and an
 * unregister always clears local state even when the backend revoke fails.
 */
class PushRegistrationService(
    private val tokenProvider: PushTokenProvider,
    private val client: DeviceRegistrationClient,
    private val store: PushRegistrationStore,
    private val environment: PushEnvironment,
    private val diagnostics: PushDiagnostics,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow<PushRegistrationState>(PushRegistrationState.Unregistered)

    /** The current observable registration state (PII-safe). */
    val state: StateFlow<PushRegistrationState> = mutableState.asStateFlow()

    /** Requests a token and registers (upserts) this device with the backend. */
    suspend fun register(): PushRegistrationState = mutex.withLock { registerLocked() }

    /**
     * Re-registers when the token changed or no prior registration exists; otherwise leaves the
     * existing registration in place (no backend round-trip).
     */
    suspend fun renew(): PushRegistrationState = mutex.withLock { renewLocked() }

    /** Unregisters this device with the backend (best-effort) and clears the token and local metadata. */
    suspend fun unregister() {
        mutex.withLock { unregisterLocked() }
    }

    /**
     * Reacts to an authentication change: a sign-in renews/registers the channel for the session; a
     * sign-out unregisters and clears it.
     */
    suspend fun onAuthChanged(signedIn: Boolean) {
        mutex.withLock {
            if (signedIn) renewLocked() else unregisterLocked()
        }
    }

    private suspend fun registerLocked(): PushRegistrationState {
        setState(PushRegistrationState.Registering)
        val channel = currentChannelOrNull() ?: return failed("channel_unavailable")
        return registerChannel(channel)
    }

    private suspend fun renewLocked(): PushRegistrationState {
        val channel = currentChannelOrNull() ?: return failed("channel_unavailable")
        val existing = store.load()
        val fingerprint = PushRedaction.fingerprint(channel.token)
        return when {
            existing != null && existing.channelFingerprint == fingerprint -> {
                setState(PushRegistrationState.Registered(existing.registrationId, fingerprint))
            }

            else -> {
                setState(PushRegistrationState.Registering)
                registerChannel(channel)
            }
        }
    }

    private suspend fun registerChannel(channel: PushChannel): PushRegistrationState {
        val request =
            DeviceRegistrationRequest(
                platform = environment.platform,
                pushProvider = environment.pushProvider,
                channelUri = channel.token,
                appVersion = environment.appVersion,
                locale = environment.locale,
                deviceId = environment.stableDeviceId,
                capabilities = environment.capabilities,
                channelExpiresAt = null,
            )
        return client.register(request).fold(
            onSuccess = { response -> onRegistered(channel, response) },
            onFailure = { error ->
                diagnostics.recordFailure("register_rejected", error)
                failed("register_rejected")
            },
        )
    }

    private suspend fun onRegistered(
        channel: PushChannel,
        response: DeviceRegistrationResponse,
    ): PushRegistrationState {
        val fingerprint = PushRedaction.fingerprint(channel.token)
        store.save(
            PushRegistrationRecord(
                registrationId = response.id,
                platform = environment.platform,
                appVersion = environment.appVersion,
                channelFingerprint = fingerprint,
                registeredAtMillis = clock(),
            ),
        )
        diagnostics.recordRegister()
        return setState(PushRegistrationState.Registered(response.id, fingerprint))
    }

    private suspend fun unregisterLocked() {
        val existing = store.load()
        if (existing != null) {
            client
                .unregister(existing.registrationId)
                .onFailure { error -> diagnostics.recordFailure("unregister_revoke_failed", error) }
        }
        // Removing the token and clearing local state is best-effort but always runs, so a signed-out
        // device never keeps a live registration even when the backend revoke failed.
        tokenProvider.deleteToken()
        store.clear()
        diagnostics.recordUnregister()
        setState(PushRegistrationState.Unregistered)
    }

    private suspend fun currentChannelOrNull(): PushChannel? =
        try {
            tokenProvider.currentToken()
        } catch (e: PushChannelUnavailableException) {
            diagnostics.recordFailure("channel_unavailable", e)
            null
        }

    private fun failed(reason: String): PushRegistrationState = setState(PushRegistrationState.Failed(reason))

    private fun setState(next: PushRegistrationState): PushRegistrationState {
        mutableState.value = next
        return next
    }
}
