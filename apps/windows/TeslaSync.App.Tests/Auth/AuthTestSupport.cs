using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Tests.Auth;

/// <summary>A deterministic byte source so verifier/state/nonce are reproducible in tests.</summary>
internal static class TestRandom
{
    public static Func<int, byte[]> Fixed(params int[] fill) =>
        size =>
        {
            var bytes = new byte[size];
            for (var i = 0; i < size; i++)
            {
                bytes[i] = (byte)fill[i % fill.Length];
            }

            return bytes;
        };
}

/// <summary>A scripted <see cref="IAuthBrowser"/> that returns a pre-set callback URI.</summary>
internal sealed class FakeAuthBrowser : IAuthBrowser
{
    private readonly string _callbackUri;
    private readonly Exception? _throw;

    public FakeAuthBrowser(string callbackUri) => _callbackUri = callbackUri;

    public FakeAuthBrowser(Exception toThrow)
    {
        _throw = toThrow;
        _callbackUri = string.Empty;
    }

    public string? LastAuthorizeUrl { get; private set; }

    public Task<RedirectResult> AuthorizeAsync(string authorizeUrl, CancellationToken cancellationToken = default)
    {
        LastAuthorizeUrl = authorizeUrl;
        if (_throw is not null)
        {
            throw _throw;
        }

        return Task.FromResult(new RedirectResult(_callbackUri));
    }
}

/// <summary>A scriptable <see cref="ITokenEndpointClient"/> for deterministic auth tests.</summary>
internal sealed class FakeTokenEndpointClient : ITokenEndpointClient
{
    public Func<string, string, TokenGrant>? OnExchange { get; set; }

    public Func<string, TokenGrant>? OnRefresh { get; set; }

    public int ExchangeCount { get; private set; }

    public int RefreshCount { get; private set; }

    public int RevokeCount { get; private set; }

    public string? LastRevokedToken { get; private set; }

    public Task<TokenGrant> ExchangeAuthorizationCodeAsync(
        string code,
        string codeVerifier,
        CancellationToken cancellationToken = default)
    {
        ExchangeCount++;
        var grant = (OnExchange ?? DefaultExchange)(code, codeVerifier);
        return Task.FromResult(grant);
    }

    public Task<TokenGrant> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        RefreshCount++;
        if (OnRefresh is null)
        {
            throw new TransportException("No refresh script configured");
        }

        return Task.FromResult(OnRefresh(refreshToken));
    }

    public Task RevokeAsync(string token, string hint, CancellationToken cancellationToken = default)
    {
        RevokeCount++;
        LastRevokedToken = token;
        return Task.CompletedTask;
    }

    public static TokenGrant Grant(string access, string? refresh, long ttl = 600) =>
        new(access, refresh, null, ttl);

    private static TokenGrant DefaultExchange(string code, string verifier) => Grant("access-1", "refresh-1");
}
