package io.teslasync.android.auth

import io.teslasync.android.BuildConfig
import io.teslasync.shared.core.auth.OidcConfig

/**
 * Builds the immutable [OidcConfig] from the build-time `BuildConfig` fields (injected from the
 * environment in `app/build.gradle.kts`, ADR-008). The native app is a public OAuth client — there
 * is no secret. An empty revocation endpoint maps to `null` so sign-out then only clears local
 * storage instead of posting to an unconfigured URL.
 */
object OidcConfigFactory {
    fun fromBuildConfig(): OidcConfig =
        OidcConfig(
            clientId = BuildConfig.OIDC_CLIENT_ID,
            redirectUri = BuildConfig.OIDC_REDIRECT_URI,
            authorizationEndpoint = BuildConfig.OIDC_AUTHORIZATION_ENDPOINT,
            tokenEndpoint = BuildConfig.OIDC_TOKEN_ENDPOINT,
            revocationEndpoint = BuildConfig.OIDC_REVOCATION_ENDPOINT.ifEmpty { null },
        )
}
