package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthBrowser
import io.teslasync.shared.core.auth.RedirectResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/**
 * Process-wide bridge between the shared-core [AuthBrowser.authorize] suspend call and the
 * Android `Activity` that drives the system browser round-trip ([AuthorizationActivity]).
 *
 * The core builds the full authorize URL (PKCE challenge, `state`, `nonce`); the only thing the
 * platform owns is opening that URL in a Chrome Custom Tab and capturing the redirect. [authorize]
 * registers a one-shot [CompletableDeferred], runs the [launch] side effect (start the browser
 * activity), and suspends until the activity reports the outcome via [deliverSuccess] /
 * [deliverError] / [deliverCancellation].
 *
 * Only one authorization can be outstanding at a time; starting a new one supersedes (cancels) any
 * stale pending request. All `pending` mutations are guarded by a non-suspending monitor so the
 * coroutine side ([authorize]) and the main-thread activity callbacks never race. No token or
 * redirect material is logged here.
 */
class AuthRedirectCoordinator {
    private val lock = Any()
    private var pending: CompletableDeferred<RedirectResult>? = null

    /**
     * Suspends until the browser round-trip started by [launch] reports a result. Returns the
     * captured [RedirectResult] on success; rethrows the delivered error (an [AuthCanceledException]
     * for a user dismissal). If [launch] itself throws, the pending request is cleared and the
     * error propagates.
     */
    @Suppress("TooGenericExceptionCaught") // Any launch failure must clear the pending request, then rethrow.
    suspend fun authorize(launch: () -> Unit): RedirectResult {
        val deferred = CompletableDeferred<RedirectResult>()
        synchronized(lock) {
            pending?.cancel(CancellationException("Superseded by a newer authorization request"))
            pending = deferred
        }
        try {
            launch()
        } catch (t: Throwable) {
            clear(deferred)
            throw t
        }
        try {
            return deferred.await()
        } finally {
            clear(deferred)
        }
    }

    /** Resumes the pending [authorize] with a successful [callbackUri]. Returns true if one was waiting. */
    fun deliverSuccess(callbackUri: String): Boolean = complete { it.complete(RedirectResult(callbackUri)) }

    /** Fails the pending [authorize] with [error]. Returns true if one was waiting. */
    fun deliverError(error: Throwable): Boolean = complete { it.completeExceptionally(error) }

    /** Fails the pending [authorize] with an [AuthCanceledException]. Returns true if one was waiting. */
    fun deliverCancellation(): Boolean = deliverError(AuthCanceledException())

    private fun complete(block: (CompletableDeferred<RedirectResult>) -> Unit): Boolean {
        val target = synchronized(lock) { pending }
        return if (target != null) {
            block(target)
            true
        } else {
            false
        }
    }

    private fun clear(deferred: CompletableDeferred<RedirectResult>) {
        synchronized(lock) {
            if (pending === deferred) pending = null
        }
    }
}
