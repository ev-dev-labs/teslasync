using TeslaSync.App.Core.Auth;
using Xunit;

namespace TeslaSync.App.Tests.Auth;

public sealed class TokenModelTests
{
    [Theory]
    [InlineData(939, false)]
    [InlineData(940, true)]
    [InlineData(941, true)]
    [InlineData(1_000, true)]
    public void IsExpiringWithinUsesTheSkewWindow(long now, bool expiring)
    {
        var tokens = new TokenSet("a", "r", null, expiresAtEpochSeconds: 1_000);
        Assert.Equal(expiring, tokens.IsExpiringWithin(skewSeconds: 60, nowEpochSeconds: now));
    }

    [Fact]
    public void ToTokenSetKeepsTheRotatedRefreshToken()
    {
        var grant = new TokenGrant("access", "rotated-refresh", "id", 600);
        var set = grant.ToTokenSet(previousRefresh: "old", nowEpochSeconds: 100);
        Assert.Equal("rotated-refresh", set.RefreshToken);
        Assert.Equal(700, set.ExpiresAtEpochSeconds);
    }

    [Fact]
    public void ToTokenSetFallsBackToThePreviousRefreshWhenNotRotated()
    {
        var grant = new TokenGrant("access", refreshToken: null, idToken: null, 600);
        var set = grant.ToTokenSet(previousRefresh: "old-refresh", nowEpochSeconds: 100);
        Assert.Equal("old-refresh", set.RefreshToken);
    }

    [Fact]
    public void ToTokenSetThrowsWhenNoRefreshIsAvailable()
    {
        var grant = new TokenGrant("access", refreshToken: null, idToken: null, 600);
        Assert.Throws<InvalidResponseException>(() => grant.ToTokenSet(previousRefresh: null, nowEpochSeconds: 0));
    }
}
