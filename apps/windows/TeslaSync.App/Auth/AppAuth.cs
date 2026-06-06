using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Auth;

/// <summary>
/// Composition root for Windows authentication (ADR-008). Wires the OIDC public-client
/// <see cref="OidcConfig"/> (Authentik <c>teslasync-windows</c> native client) to the
/// shared <see cref="AuthService"/> core over the WinUI-specific
/// <see cref="WebAuthenticationBrowser"/> and Credential-Locker-backed
/// <see cref="PasswordVaultTokenStore"/>, and routes <c>teslasync://oauth/...</c>
/// protocol activations back into the awaiting sign-in.
///
/// <para>
/// The Authentik host is read from the <c>TESLASYNC_AUTH_HOST</c> environment variable
/// (with a sane local default) so a deployment can point the desktop client at its own
/// tenant without a rebuild. Endpoint paths follow the authentik native-client runbook.
/// </para>
/// </summary>
public static class AppAuth
{
    /// <summary>Authentik public client id for the Windows desktop app.</summary>
    public const string ClientId = "teslasync-windows";

    /// <summary>Custom-scheme OAuth redirect; must match the registered native-client URI.</summary>
    public const string RedirectUri = "teslasync://oauth/callback";

    private const string AuthHostEnvVar = "TESLASYNC_AUTH_HOST";
    private const string DefaultAuthHost = "auth.teslasync.local";

    private static readonly HttpClient HttpClient = new();
    private static readonly WebAuthenticationBrowser BrowserInstance = new();
    private static readonly Lazy<AuthService> LazyService = new(CreateService);

    /// <summary>The shared authentication service (lazily constructed, process-singleton).</summary>
    public static AuthService Service => LazyService.Value;

    /// <summary>True when there is a live signed-in session.</summary>
    public static bool IsAuthenticated => Service.State.IsAuthenticated;

    /// <summary>
    /// Rehydrates any persisted session from the Credential Locker. Safe to call once at
    /// startup; failures (e.g. no package identity in an unpackaged dev run) leave the
    /// app signed out rather than crashing.
    /// </summary>
    public static async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await Service.RestoreAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Best-effort restore; an unreadable store simply means "signed out".
        }
    }

    /// <summary>
    /// Routes a protocol activation URI. Returns <see langword="true"/> when
    /// <paramref name="uri"/> is an OAuth callback (<c>teslasync://oauth/...</c>) that was
    /// delivered to an awaiting sign-in, so the caller can suppress normal deep-link routing.
    /// </summary>
    public static bool TryHandleActivation(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        return IsOAuthCallback(uri) && BrowserInstance.TryComplete(uri);
    }

    /// <summary>True when <paramref name="uri"/> is the app's OAuth callback URI.</summary>
    public static bool IsOAuthCallback(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        return uri.Scheme.Equals("teslasync", StringComparison.OrdinalIgnoreCase)
            && uri.Host.Equals("oauth", StringComparison.OrdinalIgnoreCase);
    }

    private static AuthService CreateService()
    {
        var config = BuildConfig();
        var tokenClient = new HttpTokenEndpointClient(HttpClient, config);
        var store = new PasswordVaultTokenStore(config.ClientId);
        return new AuthService(tokenClient, store, config, BrowserInstance);
    }

    private static OidcConfig BuildConfig()
    {
        var host = Environment.GetEnvironmentVariable(AuthHostEnvVar);
        if (string.IsNullOrWhiteSpace(host))
        {
            host = DefaultAuthHost;
        }

        var baseUrl = $"https://{host}/application/o";
        return new OidcConfig(
            clientId: ClientId,
            redirectUri: RedirectUri,
            authorizationEndpoint: $"{baseUrl}/authorize/",
            tokenEndpoint: $"{baseUrl}/token/",
            revocationEndpoint: $"{baseUrl}/revoke/");
    }
}
