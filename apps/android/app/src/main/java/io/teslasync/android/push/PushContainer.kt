package io.teslasync.android.push

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import io.teslasync.android.notifications.AndroidNotificationChannels
import io.teslasync.android.notifications.AndroidSystemNotificationPresenter
import io.teslasync.android.notifications.DeepLinkRouter
import io.teslasync.android.notifications.DefaultForegroundBannerSink
import io.teslasync.android.notifications.ForegroundBannerSink
import io.teslasync.android.notifications.NotificationDispatcher
import io.teslasync.android.notifications.NotificationEnvironment
import io.teslasync.android.notifications.NotificationSettingsStore
import io.teslasync.android.notifications.SharedPreferencesNotificationSettingsStore
import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.Calendar

/**
 * Manual DI graph for the Android push pipeline (P3/A6, ADR-009), the push analogue of the auth
 * `AuthContainer` and the data `DataContainer`. It assembles the headless registration core (the FCM
 * token provider, the `/api/v1/devices` client, the local store and device facts) and the notification
 * pipeline (channels, dispatcher, foreground banner sink, OS presenter, deep-link router) and binds
 * registration to the auth state machine.
 *
 * Built once per process by [io.teslasync.android.TeslaSyncApplication] and also reached from the FCM
 * [io.teslasync.android.messaging.TeslaSyncMessagingService] via the application. The foreground gate,
 * runtime-permission grant and wall clock are read live so the dispatcher's policy always reflects the
 * current state; they are injected into the headless [NotificationDispatcher] for unit testing.
 *
 * @param api the shared resilient client (its only auth seam is the auth token provider).
 * @param authState the shared auth state machine the registration lifecycle follows.
 * @param scope the app-scoped coroutine scope the coordinator and message handling run in.
 * @param logger the single sanctioned redacting logger (ADR-016).
 */
class PushContainer(
    context: Context,
    api: ApiHttpClient,
    authState: StateFlow<AuthState>,
    private val scope: CoroutineScope,
    logger: Logger,
) {
    private val appContext = context.applicationContext
    private val diagnostics = PushDiagnostics(logger)

    /** The headless registration orchestrator (token lifecycle + backend register/unregister). */
    val registrationService =
        PushRegistrationService(
            tokenProvider = FcmPushTokenProvider(),
            client = HttpDeviceRegistrationClient(api),
            store = SharedPreferencesPushRegistrationStore(appContext),
            environment = AndroidPushEnvironment(appContext),
            diagnostics = diagnostics,
        )

    private val coordinator = PushRegistrationCoordinator(registrationService, authState, scope)

    /** The user's notification preferences (master/per-kind toggles, quiet hours, redaction). */
    val settingsStore: NotificationSettingsStore = SharedPreferencesNotificationSettingsStore(appContext)

    /** The foreground in-app banner sink the app shell renders. */
    val bannerSink: ForegroundBannerSink = DefaultForegroundBannerSink()

    /** The process bridge that feeds notification-tap deep links into the navigation graph. */
    val deepLinkRouter = DeepLinkRouter()

    /** The observable registration state (PII-safe). */
    val registrationState: StateFlow<PushRegistrationState> get() = registrationService.state

    private val dispatcher =
        NotificationDispatcher(
            settingsStore = settingsStore,
            bannerSink = bannerSink,
            systemPresenter = AndroidSystemNotificationPresenter(appContext),
            diagnostics = diagnostics,
            environment =
                NotificationEnvironment(
                    isForeground = ::isForeground,
                    isPermissionGranted = ::isPermissionGranted,
                    nowMinuteOfDay = ::nowMinuteOfDay,
                ),
        )

    private val channels = AndroidNotificationChannels(appContext)

    /** Creates the OS notification channels and starts observing auth state. Idempotent in effect. */
    fun start() {
        channels.create()
        coordinator.start()
    }

    /** Handles an FCM token refresh by re-registering the device (token fingerprint change). */
    fun onNewToken() {
        scope.launch { registrationService.renew() }
    }

    /** Routes a decoded push payload into the banner/OS-notification surfaces. */
    fun onMessage(payload: PushPayload) {
        scope.launch { dispatcher.dispatch(payload) }
    }

    private fun isForeground(): Boolean =
        ProcessLifecycleOwner
            .get()
            .lifecycle.currentState
            .isAtLeast(Lifecycle.State.STARTED)

    private fun isPermissionGranted(): Boolean = NotificationManagerCompat.from(appContext).areNotificationsEnabled()

    private fun nowMinuteOfDay(): Int {
        val calendar = Calendar.getInstance()
        return calendar.get(Calendar.HOUR_OF_DAY) * MINUTES_PER_HOUR + calendar.get(Calendar.MINUTE)
    }

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
