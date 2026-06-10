package io.teslasync.shared.core.auth

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The set of credentials held for a signed-in session. Serializable so it can be
 * persisted by a [SecureTokenStore]. [expiresAtEpochSeconds] is absolute wall-clock
 * (seconds since epoch) computed from the grant's `expires_in` at issue time.
 */
@Serializable
public data class TokenSet(
    public val accessToken: String,
    public val refreshToken: String,
    public val idToken: String? = null,
    public val expiresAtEpochSeconds: Long,
) {
    /**
     * True when the access token has expired or will within [skewSeconds] of
     * [nowEpochSeconds] — the trigger for a proactive refresh.
     */
    public fun isExpiringWithin(
        skewSeconds: Long,
        nowEpochSeconds: Long,
    ): Boolean = nowEpochSeconds >= expiresAtEpochSeconds - skewSeconds
}

/**
 * A successful token-endpoint grant, validated and decoded from the OAuth JSON
 * response. [refreshToken] may be `null` when the provider does not rotate on a
 * refresh; the caller then retains the previous one.
 */
public class TokenGrant internal constructor(
    public val accessToken: String,
    public val refreshToken: String?,
    public val idToken: String?,
    public val expiresInSeconds: Long,
)

/** Lenient JSON for OAuth responses and token persistence (ignores unknown fields). */
public val defaultAuthJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

/** Raw OAuth 2.0 token-endpoint success response (RFC 6749 §5.1). */
@Serializable
internal class TokenResponse(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("id_token") val idToken: String? = null,
    @SerialName("token_type") val tokenType: String? = null,
    @SerialName("expires_in") val expiresIn: Long? = null,
    @SerialName("scope") val scope: String? = null,
)

/** Raw OAuth 2.0 error response (RFC 6749 §5.2). */
@Serializable
internal class OAuthErrorResponse(
    @SerialName("error") val error: String? = null,
    @SerialName("error_description") val errorDescription: String? = null,
)
