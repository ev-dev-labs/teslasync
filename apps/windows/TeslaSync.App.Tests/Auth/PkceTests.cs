using TeslaSync.App.Core.Auth;
using Xunit;

namespace TeslaSync.App.Tests.Auth;

public sealed class PkceTests
{
    private static readonly OidcConfig TestConfig = new(
        clientId: "teslasync-windows",
        redirectUri: "teslasync://oauth/callback",
        authorizationEndpoint: "https://auth.test/application/o/authorize/",
        tokenEndpoint: "https://auth.test/application/o/token/",
        revocationEndpoint: "https://auth.test/application/o/revoke/");

    [Fact]
    public void GenerateProducesAnS256PairDerivedFromTheVerifier()
    {
        var pkce = Pkce.Generate(TestRandom.Fixed(0x00, 0x01, 0x02, 0x03));
        Assert.Equal("S256", pkce.Method);
        Assert.Equal(43, pkce.Verifier.Length);
        Assert.Equal(Pkce.ChallengeFor(pkce.Verifier), pkce.Challenge);
    }

    [Fact]
    public void ChallengeMatchesTheRfc7636KnownAnswerVector()
    {
        // RFC 7636 Appendix B fixed verifier → challenge.
        const string verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        const string expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        Assert.Equal(expectedChallenge, Pkce.ChallengeFor(verifier));
    }

    [Fact]
    public void GenerateIsDeterministicForAFixedRandomSource()
    {
        var a = Pkce.Generate(TestRandom.Fixed(0xab));
        var b = Pkce.Generate(TestRandom.Fixed(0xab));
        Assert.Equal(a.Verifier, b.Verifier);
        Assert.Equal(a.Challenge, b.Challenge);
    }

    [Fact]
    public void GenerateIsRandomAcrossCallsWithTheSecureSource()
    {
        var a = Pkce.Generate();
        var b = Pkce.Generate();
        Assert.NotEqual(a.Verifier, b.Verifier);
    }

    [Fact]
    public void RandomUrlTokenIsUrlSafeAndPaddingFree()
    {
        var token = Pkce.RandomUrlToken(TestRandom.Fixed(0xff, 0x00, 0x10));
        Assert.NotEmpty(token);
        Assert.All(token, c => Assert.True(char.IsLetterOrDigit(c) || c is '-' or '_', $"unexpected char in {token}"));
    }

    [Fact]
    public void BuildAuthorizeUrlIncludesAllRequiredPkceParameters()
    {
        var pkce = Pkce.Generate(TestRandom.Fixed(0x07));
        var url = AuthorizeRequest.BuildAuthorizeUrl(TestConfig, pkce, state: "the-state", nonce: "the-nonce");
        var query = ParseQuery(new Uri(url).Query);

        Assert.StartsWith(TestConfig.AuthorizationEndpoint, url, StringComparison.Ordinal);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal(TestConfig.ClientId, query["client_id"]);
        Assert.Equal(TestConfig.RedirectUri, query["redirect_uri"]);
        Assert.Equal("openid profile email offline_access", query["scope"]);
        Assert.Equal("the-state", query["state"]);
        Assert.Equal("the-nonce", query["nonce"]);
        Assert.Equal(pkce.Challenge, query["code_challenge"]);
        Assert.Equal("S256", query["code_challenge_method"]);
    }

    private static Dictionary<string, string> ParseQuery(string rawQuery)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var query = rawQuery.StartsWith('?') ? rawQuery[1..] : rawQuery;
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=', StringComparison.Ordinal);
            var key = Uri.UnescapeDataString(eq >= 0 ? pair[..eq] : pair);
            var value = eq >= 0 ? Uri.UnescapeDataString(pair[(eq + 1)..]) : string.Empty;
            result[key] = value;
        }

        return result;
    }

    [Fact]
    public void BuildAuthorizeUrlAppendsWithAmpersandWhenEndpointAlreadyHasQuery()
    {
        var config = new OidcConfig(
            clientId: "c",
            redirectUri: "app://cb",
            authorizationEndpoint: "https://auth.test/authorize?tenant=main",
            tokenEndpoint: "https://auth.test/token");
        var url = AuthorizeRequest.BuildAuthorizeUrl(config, Pkce.Generate(TestRandom.Fixed(1)), "s", "n");
        Assert.StartsWith("https://auth.test/authorize?tenant=main&", url, StringComparison.Ordinal);
    }

    [Fact]
    public void ParseRedirectReturnsCodeAndStateForAValidCallback()
    {
        var parsed = AuthorizeRequest.ParseRedirect(
            "teslasync://oauth/callback?code=the-code&state=the-state",
            TestConfig);
        Assert.Equal("the-code", parsed.Code);
        Assert.Equal("the-state", parsed.State);
    }

    [Fact]
    public void ParseRedirectRejectsAMismatchedRedirectTarget()
    {
        Assert.Throws<RedirectMismatchException>(() =>
            AuthorizeRequest.ParseRedirect("https://evil.test/callback?code=x&state=y", TestConfig));
    }

    [Fact]
    public void ParseRedirectSurfacesAProviderError()
    {
        var ex = Assert.Throws<OAuthException>(() =>
            AuthorizeRequest.ParseRedirect(
                "teslasync://oauth/callback?error=access_denied&error_description=nope",
                TestConfig));
        Assert.Equal("access_denied", ex.Error);
        Assert.Equal("nope", ex.Description);
    }

    [Fact]
    public void ParseRedirectRejectsDuplicateStateParameters()
    {
        Assert.Throws<InvalidResponseException>(() =>
            AuthorizeRequest.ParseRedirect("teslasync://oauth/callback?code=x&state=a&state=b", TestConfig));
    }

    [Fact]
    public void ParseRedirectRejectsAMissingCode()
    {
        Assert.Throws<InvalidResponseException>(() =>
            AuthorizeRequest.ParseRedirect("teslasync://oauth/callback?state=a", TestConfig));
    }
}
