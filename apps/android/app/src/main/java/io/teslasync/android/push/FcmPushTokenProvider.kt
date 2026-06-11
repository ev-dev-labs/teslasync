package io.teslasync.android.push

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The production [PushTokenProvider] over Firebase Cloud Messaging (P3/A6, ADR-009). It bridges the
 * callback-based `FirebaseMessaging` `Task` API to coroutines.
 *
 * When the default FirebaseApp is not configured on this install (credential provisioning is
 * P5/H5-0001 scope), `FirebaseMessaging.getInstance()` throws — this is surfaced as a
 * [PushChannelUnavailableException] so the registration service parks gracefully rather than crashing.
 */
class FcmPushTokenProvider : PushTokenProvider {
    override suspend fun currentToken(): PushChannel {
        val messaging = messagingOrUnavailable()
        val token = awaitToken(messaging)
        if (token.isNullOrBlank()) {
            throw PushChannelUnavailableException("Firebase Cloud Messaging returned an empty token")
        }
        return PushChannel(token)
    }

    override suspend fun deleteToken() {
        val messaging = runCatching { FirebaseMessaging.getInstance() }.getOrNull() ?: return
        suspendCancellableCoroutine { continuation ->
            messaging.deleteToken().addOnCompleteListener { continuation.resume(Unit) }
        }
    }

    private fun messagingOrUnavailable(): FirebaseMessaging =
        try {
            FirebaseMessaging.getInstance()
        } catch (e: IllegalStateException) {
            throw PushChannelUnavailableException("Firebase Cloud Messaging is not configured on this install", e)
        }

    private suspend fun awaitToken(messaging: FirebaseMessaging): String? =
        suspendCancellableCoroutine { continuation ->
            messaging.token.addOnCompleteListener { task ->
                continuation.resume(if (task.isSuccessful) task.result else null)
            }
        }
}
