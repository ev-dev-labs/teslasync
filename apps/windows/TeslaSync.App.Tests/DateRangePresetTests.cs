using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class DateRangePresetTests
{
    private static readonly DateOnly Today = new(2026, 6, 5); // a Friday

    [Fact]
    public void Today_IsSingleDay()
    {
        var r = DatePresets.Get("today")!.Resolve(Today);
        Assert.Equal(new DateRange(Today, Today), r);
        Assert.Equal(1, r.Days);
    }

    [Fact]
    public void Last7_IsInclusiveSevenDays()
    {
        var r = DatePresets.Get("7d")!.Resolve(Today);
        Assert.Equal(new DateOnly(2026, 5, 30), r.Start);
        Assert.Equal(Today, r.End);
        Assert.Equal(7, r.Days);
    }

    [Fact]
    public void MonthToDate_StartsFirstOfMonth()
    {
        var r = DatePresets.Get("mtd")!.Resolve(Today);
        Assert.Equal(new DateOnly(2026, 6, 1), r.Start);
        Assert.Equal(Today, r.End);
    }

    [Fact]
    public void QuarterToDate_StartsQuarterFirstMonth()
    {
        var r = DatePresets.Get("qtd")!.Resolve(Today);
        Assert.Equal(new DateOnly(2026, 4, 1), r.Start);
    }

    [Fact]
    public void LastMonth_SpansPreviousCalendarMonth()
    {
        var r = DatePresets.Get("lastMonth")!.Resolve(Today);
        Assert.Equal(new DateOnly(2026, 5, 1), r.Start);
        Assert.Equal(new DateOnly(2026, 5, 31), r.End);
    }

    [Fact]
    public void AllTime_StartsAtBaseline()
    {
        var r = DatePresets.Get("all")!.Resolve(Today);
        Assert.Equal(new DateOnly(2015, 1, 1), r.Start);
    }

    [Fact]
    public void Match_RoundTrips()
    {
        var range = DatePresets.Get("30d")!.Resolve(Today);
        Assert.Equal("30d", DatePresets.Match(range, Today));
        Assert.Null(DatePresets.Match(new DateRange(Today, Today.AddDays(2)), Today));
    }

    [Fact]
    public void ForIds_PreservesOrderAndSkipsUnknown()
    {
        var presets = DatePresets.ForIds(["all", "nope", "today"]);
        Assert.Equal(["all", "today"], presets.Select(p => p.Id));
    }

    [Fact]
    public void Range_InvalidWhenReversed_NormalizedSwaps()
    {
        var bad = new DateRange(new DateOnly(2026, 6, 5), new DateOnly(2026, 6, 1));
        Assert.False(bad.IsValid);
        Assert.True(bad.Normalized().IsValid);
    }
}
