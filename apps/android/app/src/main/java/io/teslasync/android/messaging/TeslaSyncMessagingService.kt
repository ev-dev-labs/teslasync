package io.teslasync.android.messaging

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.teslasync.android.TeslaSyncApplication
import io.teslasync.android.push.PushContainer
import io.teslasync.android.push.PushPayloadParser

/**
 * The FCM entry point (P3/A6, ADR-009). Firebase delivers a token refresh to [onNewToken] and a push
 * message to [onMessageReceived]; both are forwarded to the process [PushContainer] reached through the
 * application. This service is intentionally thin — all logic (registration, payload routing, the
 * deliver-vs-suppress policy) lives in the headless, unit-tested core.
 *
 * Per ADR-009 the app never holds a background stream for liveness: foreground live data uses SSE,
 * background updates arrive only through these FCM callbacks.
 */
class TeslaSyncMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // The token itself is read back from the provider during re-registration; it is never logged.
        pushContainer()?.onNewToken()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val payload =
            PushPayloadParser.parse(
                data = message.data,
                notificationTitle = message.notification?.title,
                notificationBody = message.notification?.body,
            )
        pushContainer()?.onMessage(payload)
    }

    private fun pushContainer(): PushContainer? = (application as? TeslaSyncApplication)?.container?.push
}
