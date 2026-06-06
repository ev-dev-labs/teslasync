using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class RangeValueTests
{
    [Fact]
    public void Defaults_SpanFullRange()
    {
        var range = new RangeValue();
        Assert.Equal(0, range.Low);
        Assert.Equal(100, range.High);
        Assert.Equal(100, range.Span);
    }

    [Fact]
    public void Low_CannotExceedHigh()
    {
        var range = new RangeValue { High = 50 };
        range.Low = 80;
        Assert.Equal(50, range.Low);
    }

    [Fact]
    public void High_CannotDropBelowLow()
    {
        var range = new RangeValue { Low = 40 };
        range.High = 20;
        Assert.Equal(40, range.High);
    }

    [Fact]
    public void Step_SnapsValues()
    {
        var range = new RangeValue { Minimum = 0, Maximum = 100, Step = 10 };
        range.Low = 23;
        Assert.Equal(20, range.Low);
        range.High = 77;
        Assert.Equal(80, range.High);
    }

    [Fact]
    public void ShrinkingMaximum_ReclampsThumbs()
    {
        var range = new RangeValue { Low = 30, High = 90 };
        range.Maximum = 50;
        Assert.True(range.High <= 50);
        Assert.True(range.Low <= range.High);
    }
}
