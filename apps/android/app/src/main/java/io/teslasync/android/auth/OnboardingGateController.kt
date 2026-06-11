package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.data.repo.OnboardingRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Backs the navigation shell's `OnboardingGate` seam with the shared-core onboarding status
 * (`GET /onboarding/status`, ADR-013 cache-then-network). When a session becomes signed in it reads
 * the gate and exposes whether first-run onboarding is still [required]; on sign-out it resets so a
 * fresh session re-evaluates. The fetch fails open — an error leaves the flag unchanged rather than
 * trapping the user in onboarding — matching the web hook's "assume not complete on failure" intent
 * while never forcing onboarding on a hard infrastructure error.
 */
class OnboardingGateController(
    private val onboarding: OnboardingRepository,
    private val sessionState: StateFlow<AuthState>,
    private val scope: CoroutineScope,
) {
    private val mutableRequired = MutableStateFlow(false)

    /** Whether the freshly signed-in session must complete onboarding before its destination. */
    val required: StateFlow<Boolean> = mutableRequired.asStateFlow()

    private var started = false

    /** Begins reacting to session state. Idempotent. */
    fun start() {
        if (started) return
        started = true
        scope.launch {
            sessionState.collect { core ->
                when (core) {
                    is AuthState.SignedIn -> refresh()
                    AuthState.SignedOut -> mutableRequired.value = false
                    else -> Unit
                }
            }
        }
    }

    private fun refresh() {
        scope.launch {
            onboarding.status().collect { resource ->
                resource.cached?.let { mutableRequired.value = !it.isComplete }
            }
        }
    }
}
