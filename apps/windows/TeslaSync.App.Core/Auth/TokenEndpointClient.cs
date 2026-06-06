using System.Text.Json;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Talks to the OAuth 2.0 token + revocation endpoints (Authentik). This is a
/// deliberately separate client from the TeslaSync API client: those endpoints are
/// absolute provider URLs using <c>application/x-www-form-urlencoded</c> requests,
/// whereas the API client is JSON and hard-prefixes <c>/api/v1</c> against the API host.
/// </summary>
public interface ITokenEndpointClient
{
    /// <summary>Exchanges an authorization <paramref name="code"/> (+ PKCE verifier) for tokens.</summary>
    Task<TokenGrant> ExchangeAuthorizationCodeAsync(
        string code,
        string codeVerifier,
        CancellationToken cancellationToken = default);

    /// <summary>Redeems a <paramref name="refreshToken"/> for a new token grant.</summary>
    Task<TokenGrant> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default);

    /// <summary>Best-effort revoke of <paramref name="token"/> (<c>token_type_hint</c> = <paramref name="hint"/>).</summary>
    Task RevokeAsync(string token, string hint, CancellationToken cancellationToken = default);
}

/// <summary>
/// <see cref="ITokenEndpointClient"/> over a raw <see cref="HttpClient"/>. Posts
/// form-encoded grants to <see cref="OidcConfig.TokenEndpoint"/>, validates the OAuth
/// response, and maps provider errors to <see cref="OAuthException"/> while transport
/// failures become <see cref="TransportException"/>. The supplied <see cref="HttpClient"/>
/// must <b>not</b> attach bearer credentials (these are public-client, unauthenticated
/// endpoints).
/// </summary>
public sealed class HttpTokenEndpointClient : ITokenEndpointClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _client;
    private readonly OidcConfig _config;

    /// <summary>Creates a client posting to <paramref name="config"/>'s provider endpoints.</summary>
    public HttpTokenEndpointClient(HttpClient client, OidcConfig config)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(config);
        _client = client;
        _config = config;
    }

    /// <inheritdoc />
    public Task<TokenGrant> ExchangeAuthorizationCodeAsync(
        string code,
        string codeVerifier,
        CancellationToken cancellationToken = default) =>
        TokenRequestAsync(
            new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code,
                ["code_verifier"] = codeVerifier,
                ["redirect_uri"] = _config.RedirectUri,
                ["client_id"] = _config.ClientId,
            },
            cancellationToken);

    /// <inheritdoc />
    public Task<TokenGrant> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default) =>
        TokenRequestAsync(
            new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refreshToken,
                ["client_id"] = _config.ClientId,
                ["scope"] = string.Join(' ', _config.Scopes),
            },
            cancellationToken);

    /// <inheritdoc />
    public async Task RevokeAsync(string token, string hint, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_config.RevocationEndpoint))
        {
            return;
        }

        HttpResponseMessage response;
        try
        {
            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["token"] = token,
                ["token_type_hint"] = hint,
                ["client_id"] = _config.ClientId,
            });
            response = await _client.PostAsync(_config.RevocationEndpoint, content, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException e)
        {
            throw new TransportException("Token revocation request failed", e);
        }

        using (response)
        {
            // RFC 7009: a successful revocation responds 200; treat anything else as a
            // best-effort failure the caller may ignore.
            if (!response.IsSuccessStatusCode)
            {
                throw new TransportException($"Token revocation returned HTTP {(int)response.StatusCode}");
            }
        }
    }

    private async Task<TokenGrant> TokenRequestAsync(
        IReadOnlyDictionary<string, string> form,
        CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            using var content = new FormUrlEncodedContent(form);
            response = await _client.PostAsync(_config.TokenEndpoint, content, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException e)
        {
            throw new TransportException("Token endpoint request failed", e);
        }

        using (response)
        {
            string body;
            try
            {
                body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HttpRequestException e)
            {
                throw new TransportException("Failed to read token endpoint response", e);
            }

            if (!response.IsSuccessStatusCode)
            {
                var oauthError = DecodeOrNull<OAuthErrorResponse>(body);
                if (oauthError?.Error is { Length: > 0 } error)
                {
                    throw new OAuthException(error, oauthError.ErrorDescription);
                }

                throw new TransportException($"Token endpoint returned HTTP {(int)response.StatusCode}");
            }

            var parsed = DecodeOrNull<TokenResponse>(body)
                ?? throw new InvalidResponseException("Token response was not valid JSON");
            return ToGrantOrThrow(parsed);
        }
    }

    private static TokenGrant ToGrantOrThrow(TokenResponse response)
    {
        if (string.IsNullOrEmpty(response.AccessToken))
        {
            throw new InvalidResponseException("Token response missing access_token");
        }

        if (response.TokenType is { Length: > 0 } type
            && !string.Equals(type, "Bearer", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidResponseException($"Unsupported token_type: {type}");
        }

        if (response.ExpiresIn is not { } ttl || ttl <= 0)
        {
            throw new InvalidResponseException("Token response missing a positive expires_in");
        }

        return new TokenGrant(
            response.AccessToken,
            string.IsNullOrEmpty(response.RefreshToken) ? null : response.RefreshToken,
            string.IsNullOrEmpty(response.IdToken) ? null : response.IdToken,
            ttl);
    }

    private static T? DecodeOrNull<T>(string body)
        where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(body, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
