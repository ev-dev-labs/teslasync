using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class MaskedValueFormatterTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_RendersEmDash(string? value)
    {
        Assert.Equal("—", MaskedValueFormatter.Mask(value, MaskVariant.Token));
    }

    [Fact]
    public void Token_RevealsLastFour()
    {
        var masked = MaskedValueFormatter.Mask("abcdefgh", MaskVariant.Token);
        Assert.EndsWith("efgh", masked);
        Assert.StartsWith("••••", masked);
        Assert.Equal(8, masked.Length);
    }

    [Fact]
    public void Token_RespectsShowLastOverride()
    {
        var masked = MaskedValueFormatter.Mask("abcdefgh", MaskVariant.Token, showLast: 2);
        Assert.EndsWith("gh", masked);
        Assert.Equal("••••••gh", masked);
    }

    [Fact]
    public void Full_MasksEverything()
    {
        var masked = MaskedValueFormatter.Mask("secret", MaskVariant.Full);
        Assert.Equal("••••••", masked);
    }

    [Fact]
    public void Email_KeepsDomainAndFirstChar()
    {
        var masked = MaskedValueFormatter.Mask("driver@example.com", MaskVariant.Email);
        Assert.StartsWith("d", masked);
        Assert.EndsWith("@example.com", masked);
        Assert.Contains("•", masked);
    }

    [Fact]
    public void Vin_RevealsLastFour()
    {
        var masked = MaskedValueFormatter.Mask("5YJ3E1EA7KF000001", MaskVariant.Vin);
        Assert.EndsWith("0001", masked);
    }
}
