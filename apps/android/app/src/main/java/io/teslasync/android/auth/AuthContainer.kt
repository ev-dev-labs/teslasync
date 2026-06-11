package io.teslasync.android.auth

import android.content.Context
import io.teslasync.android.BuildConfig
import io.teslasync.android.data.DataContainer
import io.teslasync.android.data.live.LiveFeed
import io.teslasync.android.data.live.LiveSessionStore
import io.teslasync.android.navigation.OnboardingGate
import io.teslasync.android.push.PushContainer
import io.teslasync.android.widgets.WidgetContainer
import io.teslasync.shared.core.auth.AndroidKeystoreTokenStore
import io.teslasync.shared.core.auth.AuthService
import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.KtorTokenEndpointClient
import io.teslasync.shared.core.cache.DriverFactory
import io.teslasync.shared.core.cache.LocalCache
import io.teslasync.shared.core.data.repo.HttpOnboardingRepository
import io.teslasync.shared.core.diagnostics.Diagnostics
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.sse.KtorSseTransport
import io.teslasync.shared.core.net.sse.SseClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * Manual dependency container for the auth + networking graph (ADR-008 / ADR-013). Built once per
 * process by [io.teslasync.android.TeslaSyncApplication] and reached from Compose via
 * `LocalAuthController` and from [AuthorizationActivity] via the application.
 *
 * It wires the shared-core pieces end to end: the Keystore-backed secure store, the Ktor token
 * endpoint client, and the Android Custom-Tabs [AndroidAuthBrowser] feed the shared [AuthService];
 * its `asTokenProvider()` is installed as the single [ApiHttpClient]'s auth seam so 401 refresh is
 * centralised and no page ever touches a token. The offline cache is cleared on sign-out so a
 * signed-out session can never surface the previous user's data.
 */
class AuthContainer(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Process-wide bridge consumed by [AuthorizationActivity] to resume the suspended authorize call. */
    val authRedirectCoordinator: AuthRedirectCoordinator = AuthRedirectCoordinator()

    private val oidcConfig = OidcConfigFactory.fromBuildConfig()
    private val browser =
        AndroidAuthBrowser(authRedirectCoordinator) { url -> AuthorizationActivity.start(appContext, url) }
    private val tokenStore = AndroidKeystoreTokenStore(appContext)
    private val tokenClient = KtorTokenEndpointClient(oidcConfig)
    private val authService = AuthService(tokenClient, tokenStore, oidcConfig, browser)
    private val session: AuthSession = RealAuthSession(authService)

    private val localCache = LocalCache(DriverFactory(appContext).createDriver())
    private val apiClient =
        ApiHttpClient(BuildConfig.API_BASE_URL) { tokenProvider = session.asTokenProvider() }
    private val onboardingRepository = HttpOnboardingRepository(apiClient, localCache.store)
    private val onboardingGateController = OnboardingGateController(onboardingRepository, session.state, scope)

    // The shared SSE live pipe (ADR-009), over the SAME auth token provider as the REST client so every
    // (re)connection carries the current bearer and a reconnect after a refresh picks up the new token.
    private val sseTransport = KtorSseTransport(BuildConfig.API_BASE_URL, session.asTokenProvider())
    private val sseClient = SseClient(sseTransport)

    // Whether the session may stream live data: SignedIn, or transparently Refreshing (a refresh must NOT
    // drop the stream). This gates AND re-auths the live subscription with no per-page token code: a fresh
    // sign-in / re-auth flips this back true and the store reopens the stream with the new credential.
    private val authenticated: StateFlow<Boolean> =
        session.state
            .map(::canStream)
            .stateIn(scope, SharingStarted.Eagerly, canStream(session.state.value))

    /** Consent-gated, PII-redacting diagnostics (ADR-016); its logger is the only sanctioned logger. */
    private val diagnostics = Diagnostics.create()

    /**
     * The app-scoped live-data pipeline holder (ADR-009): binds the shared [sseClient] to the app
     * foreground + the [authenticated] gate, with [reconnect][LiveSessionStore.reconnect] nudging a
     * token refresh. Built in the auth graph (it needs the session); `TeslaSyncApplication` binds it to
     * `ProcessLifecycleOwner` and `LiveViewModel` projects it per page.
     */
    private val liveSessionStore =
        LiveSessionStore(
            feed = LiveFeed(sseClient),
            authenticated = authenticated,
            scope = scope,
            logger = diagnostics.logger,
            onReauth = { session.asTokenProvider().token() },
        )

    /**
     * The data-layer DI graph (ADR-013): the shared repositories + state holders bound to
     * lifecycle-aware ViewModels. Reached by the Compose tree via `LocalDataContainer`, it reuses the
     * same single [apiClient] (so 401 refresh stays centralised) and the offline cache cleared on
     * sign-out. It also exposes the live-data pipeline holder (ADR-009) for `LiveViewModel` + the
     * process-lifecycle binder.
     */
    val data: DataContainer =
        DataContainer(
            api = apiClient,
            cacheStore = localCache.store,
            scope = scope,
            logger = diagnostics.logger,
            liveSessionStore = liveSessionStore,
        )

    /** The global auth state holder bound to the Compose UI. */
    val authController: AuthController =
        AuthController(
            session = session,
            scope = scope,
            onSignedOut = {
                localCache.logout()
                data.selectedVehicleStore.clear()
            },
        )

    /** The navigation shell's onboarding-gate seam, backed by the live onboarding status. */
    val onboardingGate: OnboardingGate = OnboardingGate { onboardingGateController.required.value }

    /**
     * The push pipeline DI graph (ADR-009): FCM device registration tied to the auth state machine plus
     * the notification channels/dispatcher/banner. It reuses the same single [apiClient] (so the
     * device-registration call carries the bearer + 401 refresh) and the shared redacting logger.
     * `TeslaSyncApplication` creates the channels and starts the registration coordinator; the FCM
     * service and the Compose shell reach it through the application.
     */
    val push: PushContainer by lazy {
        PushContainer(
            context = appContext,
            api = apiClient,
            authState = session.state,
            scope = scope,
            logger = diagnostics.logger,
        )
    }

    /** The shared, resilient API client whose only auth seam is the auth token provider. */
    val apiHttpClient: ApiHttpClient get() = apiClient

    /**
     * The home-screen widgets DI graph (P3/A8, ADR-009/013): the shared cache-then-network repositories
     * over the SAME single [apiClient] (so a widget refresh carries the bearer + 401 refresh) and the
     * SAME offline cache the app writes (so widgets show exactly what the app last cached). Exposes the
     * cache/freshness [reader][WidgetContainer.reader] and the WorkManager-driven
     * [refresher][WidgetContainer.refresher]; reached by the widget receivers / refresh worker through
     * the application. Lazy — only built once a widget is actually placed on a home screen.
     */
    val widgets: WidgetContainer by lazy {
        WidgetContainer(
            context = appContext,
            api = apiClient,
            cacheStore = localCache.store,
            selectedVehicleStore = data.selectedVehicleStore,
            unitFormatter = data.unitFormatter,
            logger = diagnostics.logger,
        )
    }

    /** Starts the auth + onboarding observers. Idempotent; call once from the app shell. */
    fun start() {
        authController.start()
        onboardingGateController.start()
    }

    /** Whether [state] may hold a live SSE stream: a valid (or transparently refreshing) session. */
    private fun canStream(state: AuthState): Boolean = state is AuthState.SignedIn || state is AuthState.Refreshing
}
