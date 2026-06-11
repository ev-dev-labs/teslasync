package io.teslasync.android.push

import io.teslasync.shared.core.auth.AuthState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Binds the [PushRegistrationService] to the shared auth state machine (P3/A6, ADR-009): a sign-in
 * (re)registers this device's FCM token with the backend, a sign-out unregisters it. A transparent
 * token refresh ([AuthState.SignedIn] → [AuthState.Refreshing] → [AuthState.SignedIn]) is treated as
 * "still signed in", so [distinctUntilChanged] collapses it to a single transition and a refresh never
 * unregisters the device.
 *
 * It is the auth-lifecycle analogue of [io.teslasync.android.data.live.AppLifecycleSseBinder]: a
 * headless observer started once from the process [io.teslasync.android.TeslaSyncApplication].
 */
class PushRegistrationCoordinator(
    private val service: PushRegistrationService,
    private val authState: StateFlow<AuthState>,
    private val scope: CoroutineScope,
) {
    private var started = false

    /** Begins observing auth state. Idempotent; call once from the app process. */
    fun start() {
        if (started) return
        started = true
        scope.launch {
            authState
                .map(::isSignedIn)
                .distinctUntilChanged()
                .collect { signedIn -> service.onAuthChanged(signedIn) }
        }
    }

    private fun isSignedIn(state: AuthState): Boolean = state is AuthState.SignedIn || state is AuthState.Refreshing
}
