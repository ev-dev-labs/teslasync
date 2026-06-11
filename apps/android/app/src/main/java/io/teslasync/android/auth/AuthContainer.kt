package io.teslasync.android.auth

import android.content.Context
import io.teslasync.android.BuildConfig
import io.teslasync.android.data.DataContainer
import io.teslasync.android.navigation.OnboardingGate
import io.teslasync.shared.core.auth.AndroidKeystoreTokenStore
import io.teslasync.shared.core.auth.AuthService
import io.teslasync.shared.core.auth.KtorTokenEndpointClient
import io.teslasync.shared.core.cache.DriverFactory
import io.teslasync.shared.core.cache.LocalCache
import io.teslasync.shared.core.data.repo.HttpOnboardingRepository
import io.teslasync.shared.core.diagnostics.Diagnostics
import io.teslasync.shared.core.net.ApiHttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

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

    /** Consent-gated, PII-redacting diagnostics (ADR-016); its logger is the only sanctioned logger. */
    private val diagnostics = Diagnostics.create()

    /**
     * The data-layer DI graph (ADR-013): the shared repositories + state holders bound to
     * lifecycle-aware ViewModels. Reached by the Compose tree via `LocalDataContainer`, it reuses the
     * same single [apiClient] (so 401 refresh stays centralised) and the offline cache cleared on
     * sign-out.
     */
    val data: DataContainer =
        DataContainer(
            api = apiClient,
            cacheStore = localCache.store,
            scope = scope,
            logger = diagnostics.logger,
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

    /** The shared, resilient API client whose only auth seam is the auth token provider. */
    val apiHttpClient: ApiHttpClient get() = apiClient

    /** Starts the auth + onboarding observers. Idempotent; call once from the app shell. */
    fun start() {
        authController.start()
        onboardingGateController.start()
    }
}
