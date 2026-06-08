package io.teslasync.shared.core.auth

/**
 * Immutable OIDC public-client configuration for the Authorization-Code-with-PKCE
 * flow against Authentik (ADR-008, P0/0009 runbook). A native app is a **public**
 * client — there is intentionally no client secret.
 *
 * Endpoints are supplied explicitly (they come from the provider's discovery
 * document); this type does not guess them from an issuer so a misconfigured tenant
 * fails loudly rather than silently hitting the wrong URL.
 *
 * @property clientId the per-platform public client id (e.g. `teslasync-android`).
 * @property redirectUri the exact, pre-registered redirect URI (App/Universal Link
 *   or custom scheme) the authorization response returns to.
 * @property authorizationEndpoint absolute URL of the provider authorize endpoint.
 * @property tokenEndpoint absolute URL of the provider token endpoint.
 * @property revocationEndpoint absolute URL of the provider revocation endpoint, or
 *   `null` when the tenant does not expose one (sign-out then only clears storage).
 * @property scopes requested scopes; `offline_access` is required to obtain a
 *   refresh token.
 */
public class OidcConfig(
    public val clientId: String,
    public val redirectUri: String,
    public val authorizationEndpoint: String,
    public val tokenEndpoint: String,
    public val revocationEndpoint: String? = null,
    public val scopes: List<String> = DEFAULT_SCOPES,
) {
    public companion object {
        /** openid + identity scopes, plus offline_access for a refresh token. */
        public val DEFAULT_SCOPES: List<String> =
            listOf("openid", "profile", "email", "offline_access")
    }
}
