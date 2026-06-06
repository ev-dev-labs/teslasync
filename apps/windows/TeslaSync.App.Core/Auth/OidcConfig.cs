using System.Collections.ObjectModel;

namespace TeslaSync.App.Core.Auth;

/// <summary>
/// Immutable OIDC public-client configuration for the Authorization-Code-with-PKCE
/// flow against Authentik (ADR-008, authentik-native-clients runbook). A native app
/// is a <b>public</b> client — there is intentionally no client secret.
///
/// Endpoints are supplied explicitly (they come from the provider's discovery
/// document); this type does not guess them from an issuer so a misconfigured tenant
/// fails loudly rather than silently hitting the wrong URL.
/// </summary>
public sealed class OidcConfig
{
    /// <summary>openid + identity scopes, plus offline_access for a refresh token.</summary>
    public static IReadOnlyList<string> DefaultScopes { get; } =
        new ReadOnlyCollection<string>(["openid", "profile", "email", "offline_access"]);

    /// <summary>Creates a config; throws when any required endpoint/value is missing.</summary>
    public OidcConfig(
        string clientId,
        string redirectUri,
        string authorizationEndpoint,
        string tokenEndpoint,
        string? revocationEndpoint = null,
        IReadOnlyList<string>? scopes = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        ArgumentException.ThrowIfNullOrWhiteSpace(redirectUri);
        ArgumentException.ThrowIfNullOrWhiteSpace(authorizationEndpoint);
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenEndpoint);

        ClientId = clientId;
        RedirectUri = redirectUri;
        AuthorizationEndpoint = authorizationEndpoint;
        TokenEndpoint = tokenEndpoint;
        RevocationEndpoint = revocationEndpoint;
        Scopes = scopes is { Count: > 0 } ? scopes : DefaultScopes;
    }

    /// <summary>The per-platform public client id (e.g. <c>teslasync-windows</c>).</summary>
    public string ClientId { get; }

    /// <summary>The exact, pre-registered redirect URI the authorization response returns to.</summary>
    public string RedirectUri { get; }

    /// <summary>Absolute URL of the provider authorize endpoint.</summary>
    public string AuthorizationEndpoint { get; }

    /// <summary>Absolute URL of the provider token endpoint.</summary>
    public string TokenEndpoint { get; }

    /// <summary>Absolute URL of the provider revocation endpoint, or <see langword="null"/>.</summary>
    public string? RevocationEndpoint { get; }

    /// <summary>Requested scopes; <c>offline_access</c> is required to obtain a refresh token.</summary>
    public IReadOnlyList<string> Scopes { get; }
}
