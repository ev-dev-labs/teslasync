using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class CommandPaletteFilterTests
{
    private static readonly IReadOnlyList<CommandItem> Items =
    [
        new("dash", "Dashboard"),
        new("charge", "Charging Sessions", "View charge history"),
        new("battery", "Battery Health", Keywords: ["degradation", "soh"]),
        new("settings", "Settings"),
    ];

    [Fact]
    public void EmptyQuery_ReturnsInputOrder()
    {
        var result = CommandPaletteFilter.Filter(Items, "  ");
        Assert.Equal(Items.Count, result.Count);
        Assert.Equal("dash", result[0].Id);
    }

    [Fact]
    public void ExactPrefix_RanksAboveSubsequence()
    {
        var result = CommandPaletteFilter.Filter(Items, "ba");
        Assert.Equal("battery", result[0].Id);
    }

    [Fact]
    public void Subtitle_Matches()
    {
        var result = CommandPaletteFilter.Filter(Items, "history");
        Assert.Single(result);
        Assert.Equal("charge", result[0].Id);
    }

    [Fact]
    public void Keyword_Matches()
    {
        var result = CommandPaletteFilter.Filter(Items, "soh");
        Assert.Single(result);
        Assert.Equal("battery", result[0].Id);
    }

    [Fact]
    public void Subsequence_Matches()
    {
        Assert.True(CommandPaletteFilter.IsSubsequence("Dashboard", "dsb"));
        Assert.False(CommandPaletteFilter.IsSubsequence("Dashboard", "zzz"));
    }

    [Fact]
    public void NoMatch_ReturnsEmpty()
    {
        var result = CommandPaletteFilter.Filter(Items, "zzzzz");
        Assert.Empty(result);
    }
}
