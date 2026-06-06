using TeslaSync.App.Core.Auth;
using Xunit;

namespace TeslaSync.App.Tests.Auth;

public sealed class AuthServiceTests
{
    private const string Callback = "teslasync://oauth/callback?code=auth-code&state=";

    private static OidcConfig Config() => new(
        clientId: "teslasync-windows",
        redirectUri: "teslasync://oauth/callback",
        authorizationEndpoint: "https://auth.test/authorize",
        tokenEndpoint: "https://auth.test/token",
        revocationEndpoint: "https://auth.test/revoke");

    [Fact]
    public async Task SignInExchangesTheCodeAndBecomesSignedIn()
    {
        // The fake browser must echo the state the service generated; capture it by
        // letting the service build the URL, then crafting a matching callback.
        var store = new InMemoryTokenStore();
        var client = new FakeTokenEndpointClient
        {
            OnExchange = (_, _) => FakeTokenEndpointClient.Grant("access-1", "refresh-1", ttl: 600),
        };
        var browser = new StateEchoBrowser(Config());
        await using var service = new AuthService(client, store, Config(), browser, () => 1_000);

        var states = new List<AuthState>();
        service.StateChanged += (_, s) => states.Add(s);

        var tokens = await service.SignInAsync();

        Assert.Equal("access-1", tokens.AccessToken);
        Assert.Equal("refresh-1", tokens.RefreshToken);
        Assert.Equal(1_600, tokens.ExpiresAtEpochSeconds);
        Assert.Equal(1, client.ExchangeCount);
        Assert.Equal(1, store.SaveCount);
        Assert.IsType<AuthState.SignedIn>(service.State);
        Assert.Contains(states, s => s is AuthState.Authenticating);
        Assert.Contains(states, s => s is AuthState.SignedIn);
    }

    [Fact]
    public async Task SignInRejectsAMismatchedState()
    {
        var store = new InMemoryTokenStore();
        var client = new FakeTokenEndpointClient();
        var browser = new FakeAuthBrowser(Callback + "wrong-state");
        await using var service = new AuthService(client, store, Config(), browser);

        await Assert.ThrowsAsync<StateMismatchException>(() => service.SignInAsync());
        Assert.IsType<AuthState.Failed>(service.State);
        Assert.Equal(0, client.ExchangeCount);
    }

    [Fact]
    public async Task RestoreFromStorePopulatesSignedIn()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("a", "r", null, 5_000));
        await using var service = new AuthService(new FakeTokenEndpointClient(), store, Config(), new FakeAuthBrowser("x"));

        await service.RestoreAsync();

        var signedIn = Assert.IsType<AuthState.SignedIn>(service.State);
        Assert.Equal("a", signedIn.Tokens.AccessToken);
    }

    [Fact]
    public async Task RestoreFromEmptyStoreIsSignedOut()
    {
        await using var service = new AuthService(
            new FakeTokenEndpointClient(), new InMemoryTokenStore(), Config(), new FakeAuthBrowser("x"));

        await service.RestoreAsync();

        Assert.IsType<AuthState.SignedOut>(service.State);
    }

    [Fact]
    public async Task TokenProviderRefreshesProactivelyNearExpiry()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("old-access", "old-refresh", null, 1_050));
        var client = new FakeTokenEndpointClient
        {
            OnRefresh = _ => FakeTokenEndpointClient.Grant("new-access", "new-refresh", ttl: 600),
        };
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        var provider = service.AsTokenProvider();
        // now (1000) >= expiry(1050) - skew(60) → proactive refresh fires.
        var token = await provider.GetTokenAsync();

        Assert.Equal("new-access", token);
        Assert.Equal(1, client.RefreshCount);
    }

    [Fact]
    public async Task TokenProviderReturnsCurrentTokenWhenFresh()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("fresh-access", "r", null, 9_999));
        var client = new FakeTokenEndpointClient();
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        var token = await service.AsTokenProvider().GetTokenAsync();

        Assert.Equal("fresh-access", token);
        Assert.Equal(0, client.RefreshCount);
    }

    [Fact]
    public async Task OnUnauthorizedRefreshesAndReportsSuccess()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("stale-access", "old-refresh", null, 9_999));
        var client = new FakeTokenEndpointClient
        {
            OnRefresh = _ => FakeTokenEndpointClient.Grant("rotated-access", "rotated-refresh", ttl: 600),
        };
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();
        var provider = service.AsTokenProvider();

        var refreshed = await provider.OnUnauthorizedAsync("stale-access");

        Assert.True(refreshed);
        Assert.Equal("rotated-access", service.CurrentAccessToken);
        Assert.Equal(1, client.RefreshCount);
    }

    [Fact]
    public async Task OnUnauthorizedWithStaleTokenSkipsSecondRefresh()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("current-access", "r", null, 9_999));
        var client = new FakeTokenEndpointClient();
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        // A 401 from an already-superseded bearer must collapse to a no-op replay.
        var ok = await service.AsTokenProvider().OnUnauthorizedAsync("previous-access");

        Assert.True(ok);
        Assert.Equal(0, client.RefreshCount);
    }

    [Fact]
    public async Task RefreshInvalidGrantSignsOutAndClearsStore()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("a", "dead-refresh", null, 9_999));
        var client = new FakeTokenEndpointClient
        {
            OnRefresh = _ => throw new OAuthException("invalid_grant"),
        };
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        var ok = await service.AsTokenProvider().OnUnauthorizedAsync("a");

        Assert.False(ok);
        Assert.IsType<AuthState.SignedOut>(service.State);
        Assert.Null(await store.LoadAsync());
        Assert.True(store.ClearCount >= 1);
    }

    [Fact]
    public async Task RefreshTransportFailureKeepsTheSession()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("a", "r", null, 9_999));
        var client = new FakeTokenEndpointClient
        {
            OnRefresh = _ => throw new TransportException("network down"),
        };
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        var ok = await service.AsTokenProvider().OnUnauthorizedAsync("a");

        Assert.False(ok);
        Assert.IsType<AuthState.SignedIn>(service.State);
        Assert.Equal("a", service.CurrentAccessToken);
    }

    [Fact]
    public async Task SignOutRevokesAndClears()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("a", "the-refresh", null, 9_999));
        var client = new FakeTokenEndpointClient();
        await using var service = new AuthService(client, store, Config(), new FakeAuthBrowser("x"), () => 1_000);
        await service.RestoreAsync();

        await service.SignOutAsync();

        Assert.Equal(1, client.RevokeCount);
        Assert.Equal("the-refresh", client.LastRevokedToken);
        Assert.IsType<AuthState.SignedOut>(service.State);
        Assert.Null(await store.LoadAsync());
        Assert.Null(service.CurrentAccessToken);
    }

    [Fact]
    public async Task SignInPersistenceFailureSignsOut()
    {
        var store = new InMemoryTokenStore { FailNextSave = true };
        var client = new FakeTokenEndpointClient
        {
            OnExchange = (_, _) => FakeTokenEndpointClient.Grant("a", "r", ttl: 600),
        };
        var browser = new StateEchoBrowser(Config());
        await using var service = new AuthService(client, store, Config(), browser, () => 1_000);

        await Assert.ThrowsAsync<TransportException>(() => service.SignInAsync());
        Assert.IsType<AuthState.Failed>(service.State);
        Assert.Null(service.CurrentAccessToken);
    }

    /// <summary>A browser that echoes back the exact <c>state</c> the service put in the authorize URL.</summary>
    private sealed class StateEchoBrowser : IAuthBrowser
    {
        private readonly OidcConfig _config;

        public StateEchoBrowser(OidcConfig config) => _config = config;

        public Task<RedirectResult> AuthorizeAsync(string authorizeUrl, CancellationToken cancellationToken = default)
        {
            var state = ExtractState(authorizeUrl);
            return Task.FromResult(new RedirectResult(
                $"{_config.RedirectUri}?code=auth-code&state={state}"));
        }

        private static string ExtractState(string url)
        {
            foreach (var pair in new Uri(url).Query.TrimStart('?').Split('&'))
            {
                if (pair.StartsWith("state=", StringComparison.Ordinal))
                {
                    return Uri.UnescapeDataString(pair["state=".Length..]);
                }
            }

            return string.Empty;
        }
    }
}
