package io.teslasync.android.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import io.teslasync.android.BuildConfig
import io.teslasync.android.TeslaSyncApplication
import io.teslasync.shared.core.auth.AuthException
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.CodeVerifierUtil

/**
 * Transparent trampoline that performs the OIDC authorize round-trip with AppAuth + Chrome Custom
 * Tabs and reports the captured redirect back through the [AuthRedirectCoordinator].
 *
 * The shared core builds the full authorize URL (with the PKCE `code_challenge`, `state`, `nonce`);
 * this activity parses it into an equivalent AppAuth [AuthorizationRequest], launches AppAuth's
 * managed Custom Tab via the Activity Result API, and on return reassembles the success callback URI
 * (or maps a cancellation / OAuth error). AppAuth's own redirect receiver — registered for the
 * `appAuthRedirectScheme` manifest value — catches the redirect and routes it here. No token
 * or redirect material is logged.
 */
class AuthorizationActivity : ComponentActivity() {
    private val authService by lazy { AuthorizationService(this) }

    private val resultLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            onAuthorizationResult(result.data)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) {
            // Re-created while the Custom Tab is foregrounded; the result callback will resume us.
            return
        }
        val authorizeUrl = intent.getStringExtra(EXTRA_AUTHORIZE_URL)
        if (authorizeUrl.isNullOrBlank()) {
            coordinator().deliverError(AuthException.Transport("Authorization request was missing its URL"))
            finish()
        } else {
            startAuthorization(authorizeUrl)
        }
    }

    override fun onDestroy() {
        authService.dispose()
        super.onDestroy()
    }

    private fun startAuthorization(authorizeUrl: String) {
        val request =
            try {
                buildRequest(OidcAuthorizeUrl.parse(authorizeUrl))
            } catch (e: IllegalArgumentException) {
                coordinator().deliverError(AuthException.Transport("Authorization request URL was invalid", e))
                finish()
                return
            }
        resultLauncher.launch(authService.getAuthorizationRequestIntent(request))
    }

    private fun onAuthorizationResult(data: Intent?) {
        val coordinator = coordinator()
        val response = data?.let { AuthorizationResponse.fromIntent(it) }
        val failure = data?.let { AuthorizationException.fromIntent(it) }
        when {
            response != null ->
                coordinator.deliverSuccess(
                    OidcAuthorizeUrl.callbackUri(
                        redirectUri = response.request.redirectUri.toString(),
                        code = response.authorizationCode.orEmpty(),
                        state = response.state.orEmpty(),
                    ),
                )
            isUserCancellation(failure) -> coordinator.deliverCancellation()
            failure != null -> coordinator.deliverError(toAuthException(failure))
            else -> coordinator.deliverCancellation()
        }
        finish()
    }

    private fun buildRequest(params: OidcAuthorizeParams): AuthorizationRequest {
        val serviceConfig =
            AuthorizationServiceConfiguration(
                Uri.parse(params.authorizationEndpoint),
                Uri.parse(BuildConfig.OIDC_TOKEN_ENDPOINT),
            )
        val builder =
            AuthorizationRequest
                .Builder(serviceConfig, params.clientId, params.responseType, Uri.parse(params.redirectUri))
                .setState(params.state)
                // AppAuth requires a syntactically valid verifier to emit a PKCE challenge, but the
                // REAL verifier stays in the shared core (which performs the token exchange). We reuse
                // only the core's challenge so the authorize request and the later exchange agree; the
                // verifier generated here is never transmitted (AppAuth sends just the code_challenge).
                .setCodeVerifier(
                    CodeVerifierUtil.generateRandomCodeVerifier(),
                    params.codeChallenge,
                    params.codeChallengeMethod,
                )
        if (params.scope.isNotEmpty()) builder.setScope(params.scope)
        params.nonce?.let { builder.setNonce(it) }
        return builder.build()
    }

    private fun isUserCancellation(failure: AuthorizationException?): Boolean =
        failure != null &&
            failure.type == AuthorizationException.TYPE_GENERAL_ERROR &&
            (
                failure.code == AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code ||
                    failure.code == AuthorizationException.GeneralErrors.PROGRAM_CANCELED_AUTH_FLOW.code
            )

    private fun toAuthException(failure: AuthorizationException): AuthException =
        if (failure.type == AuthorizationException.TYPE_OAUTH_AUTHORIZATION_ERROR) {
            AuthException.OAuth(failure.error ?: "authorization_error", failure.errorDescription)
        } else {
            AuthException.Transport(failure.errorDescription ?: "Authorization failed", failure)
        }

    private fun coordinator(): AuthRedirectCoordinator = (application as TeslaSyncApplication).container.authRedirectCoordinator

    companion object {
        /** Intent extra carrying the shared-core authorize URL to open. */
        const val EXTRA_AUTHORIZE_URL: String = "io.teslasync.android.auth.AUTHORIZE_URL"

        /** Starts the browser round-trip for [authorizeUrl] from a non-activity context. */
        fun start(
            context: Context,
            authorizeUrl: String,
        ) {
            val intent =
                Intent(context, AuthorizationActivity::class.java)
                    .putExtra(EXTRA_AUTHORIZE_URL, authorizeUrl)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }
}
