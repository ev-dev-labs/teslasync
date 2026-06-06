using System.Text.Json.Serialization;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// The set of credentials held for a signed-in session. Serializable so it can be
/// persisted by an <see cref="ISecureTokenStore"/>. <see cref="ExpiresAtEpochSeconds"/>
/// is absolute wall-clock (seconds since epoch) computed from the grant's
/// <c>expires_in</c> at issue time.
/// </summary>
public sealed record TokenSet
{
    /// <summary>Creates a token set.</summary>
    [JsonConstructor]
    public TokenSet(string accessToken, string refreshToken, string? idToken, long expiresAtEpochSeconds)
    {
        AccessToken = accessToken;
        RefreshToken = refreshToken;
        IdToken = idToken;
        ExpiresAtEpochSeconds = expiresAtEpochSeconds;
    }

    /// <summary>The bearer access token sent on <c>/api/v1/*</c> requests.</summary>
    public string AccessToken { get; init; }

    /// <summary>The refresh token used to silently renew the session.</summary>
    public string RefreshToken { get; init; }

    /// <summary>The OIDC ID token (identity only), when issued.</summary>
    public string? IdToken { get; init; }

    /// <summary>Absolute access-token expiry, seconds since the Unix epoch.</summary>
    public long ExpiresAtEpochSeconds { get; init; }

    /// <summary>
    /// True when the access token has expired or will within <paramref name="skewSeconds"/>
    /// of <paramref name="nowEpochSeconds"/> — the trigger for a proactive refresh.
    /// </summary>
    public bool IsExpiringWithin(long skewSeconds, long nowEpochSeconds) =>
        nowEpochSeconds >= ExpiresAtEpochSeconds - skewSeconds;
}

/// <summary>
/// A successful token-endpoint grant, validated and decoded from the OAuth JSON
/// response. <see cref="RefreshToken"/> may be <see langword="null"/> when the
/// provider does not rotate on a refresh; the caller then retains the previous one.
/// </summary>
public sealed class TokenGrant
{
    /// <summary>Creates a validated token grant (also produced by the token endpoint client).</summary>
    public TokenGrant(string accessToken, string? refreshToken, string? idToken, long expiresInSeconds)
    {
        AccessToken = accessToken;
        RefreshToken = refreshToken;
        IdToken = idToken;
        ExpiresInSeconds = expiresInSeconds;
    }

    /// <summary>The freshly issued access token.</summary>
    public string AccessToken { get; }

    /// <summary>The rotated refresh token, or <see langword="null"/> when unchanged.</summary>
    public string? RefreshToken { get; }

    /// <summary>The ID token, when issued.</summary>
    public string? IdToken { get; }

    /// <summary>Access-token lifetime in seconds (provider <c>expires_in</c>).</summary>
    public long ExpiresInSeconds { get; }

    /// <summary>
    /// Converts this grant to an absolute-expiry <see cref="TokenSet"/>, falling back
    /// to <paramref name="previousRefresh"/> when the provider did not rotate the
    /// refresh token.
    /// </summary>
    public TokenSet ToTokenSet(string? previousRefresh, long nowEpochSeconds)
    {
        var refresh = RefreshToken ?? previousRefresh
            ?? throw new InvalidResponseException("Token grant did not include a refresh token");
        return new TokenSet(AccessToken, refresh, IdToken, nowEpochSeconds + ExpiresInSeconds);
    }
}

/// <summary>Raw OAuth 2.0 token-endpoint success response (RFC 6749 §5.1).</summary>
internal sealed class TokenResponse
{
    [JsonPropertyName("access_token")]
    public string? AccessToken { get; set; }

    [JsonPropertyName("refresh_token")]
    public string? RefreshToken { get; set; }

    [JsonPropertyName("id_token")]
    public string? IdToken { get; set; }

    [JsonPropertyName("token_type")]
    public string? TokenType { get; set; }

    [JsonPropertyName("expires_in")]
    public long? ExpiresIn { get; set; }

    [JsonPropertyName("scope")]
    public string? Scope { get; set; }
}

/// <summary>Raw OAuth 2.0 error response (RFC 6749 §5.2).</summary>
internal sealed class OAuthErrorResponse
{
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("error_description")]
    public string? ErrorDescription { get; set; }
}
