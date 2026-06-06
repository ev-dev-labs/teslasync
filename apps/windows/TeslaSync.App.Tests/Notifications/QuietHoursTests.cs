using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the quiet-hours window, including midnight wrap-around (P2/W8-0001).</summary>
public sealed class QuietHoursTests
{
    [Fact]
    public void Disabled_is_never_quiet() =>
        Assert.False(new QuietHours(false, new TimeOnly(22, 0), new TimeOnly(7, 0)).IsQuiet(new TimeOnly(23, 0)));

    [Theory]
    [InlineData(12, 0, true)]
    [InlineData(9, 0, true)]
    [InlineData(16, 59, true)]
    [InlineData(17, 0, false)]
    [InlineData(8, 59, false)]
    public void Same_day_window(int hour, int minute, bool expected) =>
        Assert.Equal(expected, new QuietHours(true, new TimeOnly(9, 0), new TimeOnly(17, 0)).IsQuiet(new TimeOnly(hour, minute)));

    [Theory]
    [InlineData(23, 0, true)]
    [InlineData(2, 30, true)]
    [InlineData(6, 59, true)]
    [InlineData(7, 0, false)]
    [InlineData(12, 0, false)]
    [InlineData(21, 59, false)]
    public void Wrap_around_midnight_window(int hour, int minute, bool expected) =>
        Assert.Equal(expected, new QuietHours(true, new TimeOnly(22, 0), new TimeOnly(7, 0)).IsQuiet(new TimeOnly(hour, minute)));

    [Fact]
    public void Equal_start_and_end_is_never_quiet() =>
        Assert.False(new QuietHours(true, new TimeOnly(8, 0), new TimeOnly(8, 0)).IsQuiet(new TimeOnly(8, 0)));

    [Fact]
    public void Start_is_inclusive_end_is_exclusive()
    {
        var window = new QuietHours(true, new TimeOnly(22, 0), new TimeOnly(7, 0));
        Assert.True(window.IsQuiet(new TimeOnly(22, 0)));
        Assert.False(window.IsQuiet(new TimeOnly(7, 0)));
    }
}
