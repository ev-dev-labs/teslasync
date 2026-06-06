using TeslaSync.App.Core.Units;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>Tests for the <see cref="DateTimeFormatting"/> behavior port (TsDateTime).</summary>
public sealed class DateTimeFormattingTests
{
    private static readonly DateTimeOffset Now = new(2026, 4, 4, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Format_Null_ReturnsEmDash()
    {
        Assert.Equal("\u2014", DateTimeFormatting.Format(null, DateTimeVariant.Full, Now));
        Assert.Equal("\u2014", DateTimeFormatting.Format(null, DateTimeVariant.Relative, Now));
    }

    [Theory]
    [InlineData(30, "Just now")]
    [InlineData(0, "Just now")]
    [InlineData(59, "Just now")]
    public void Format_Relative_UnderOneMinute_IsJustNow(int secondsAgo, string expected)
    {
        var value = Now.AddSeconds(-secondsAgo);
        Assert.Equal(expected, DateTimeFormatting.Format(value, DateTimeVariant.Relative, Now));
    }

    [Fact]
    public void Format_Relative_MinutesAndHours()
    {
        Assert.Equal("5m ago", DateTimeFormatting.Format(Now.AddMinutes(-5), DateTimeVariant.Relative, Now));
        Assert.Equal("59m ago", DateTimeFormatting.Format(Now.AddMinutes(-59), DateTimeVariant.Relative, Now));
        Assert.Equal("3h ago", DateTimeFormatting.Format(Now.AddHours(-3), DateTimeVariant.Relative, Now));
        Assert.Equal("23h ago", DateTimeFormatting.Format(Now.AddHours(-23), DateTimeVariant.Relative, Now));
    }

    [Fact]
    public void Format_Relative_BeyondADay_FallsBackToAbsolute()
    {
        string result = DateTimeFormatting.Format(Now.AddDays(-2), DateTimeVariant.Relative, Now);
        Assert.DoesNotContain("ago", result);
        Assert.Contains("Apr", result);
    }

    [Fact]
    public void Format_DateVariant_RendersMonthDayYear()
    {
        var value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero).ToLocalTime();
        string result = DateTimeFormatting.Format(value, DateTimeVariant.Date, Now);
        Assert.Contains("Apr", result);
        Assert.Contains("2026", result);
    }

    [Fact]
    public void Format_ShortVariant_OmitsYear()
    {
        var value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero).ToLocalTime();
        string result = DateTimeFormatting.Format(value, DateTimeVariant.Short, Now);
        Assert.Contains("Apr", result);
        Assert.DoesNotContain("2026", result);
    }
}
