using TeslaSync.App.Core.Feedback;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class BannerStateTests
{
    [Fact]
    public void HiddenUntilConditionTrue()
    {
        var banner = new BannerState();
        Assert.False(banner.IsVisible);
        banner.Condition = true;
        Assert.True(banner.IsVisible);
    }

    [Fact]
    public void DismissHidesWhileConditionHolds()
    {
        var banner = new BannerState();
        banner.Condition = true;
        banner.Dismiss();
        Assert.True(banner.IsDismissed);
        Assert.False(banner.IsVisible);
    }

    [Fact]
    public void NonSticky_ReArmingClearsDismissal()
    {
        var banner = new BannerState(sticky: false);
        banner.Condition = true;
        banner.Dismiss();
        banner.Condition = false;
        banner.Condition = true;
        Assert.False(banner.IsDismissed);
        Assert.True(banner.IsVisible);
    }

    [Fact]
    public void Sticky_DismissalPersistsAcrossReArming()
    {
        var banner = new BannerState(sticky: true);
        banner.Condition = true;
        banner.Dismiss();
        banner.Condition = false;
        banner.Condition = true;
        Assert.True(banner.IsDismissed);
        Assert.False(banner.IsVisible);
    }

    [Fact]
    public void Reset_ClearsDismissal()
    {
        var banner = new BannerState(sticky: true);
        banner.Condition = true;
        banner.Dismiss();
        banner.Reset();
        Assert.True(banner.IsVisible);
    }
}
