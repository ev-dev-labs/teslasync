using TeslaSync.App.Core.Units;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>Edge-case tests for the SI/scalar formatters beyond the golden vectors.</summary>
public sealed class FormatterEdgeCaseTests
{
    [Fact]
    public void FormatDistance_NullOrNonFinite_ReturnsEmDash()
    {
        Assert.Equal("\u2014", UnitFormatters.FormatDistance(null, UnitPref.Metric));
        Assert.Equal("\u2014", UnitFormatters.FormatDistance(double.NaN, UnitPref.Metric));
        Assert.Equal("\u2014", UnitFormatters.FormatDistance(double.PositiveInfinity, UnitPref.Metric));
    }

    [Fact]
    public void FormatDistance_HonorsCustomEmptyDisplay()
    {
        var pref = UnitPref.Metric with { EmptyDisplay = "n/a" };
        Assert.Equal("n/a", UnitFormatters.FormatDistance(null, pref));
    }

    [Fact]
    public void FormatTemperature_HasNoSpaceBeforeUnit()
    {
        // 25 °C metric, default precision 1.
        Assert.Equal("25.0\u00B0C", UnitFormatters.FormatTemperature(25, UnitPref.Metric));
    }

    [Fact]
    public void FormatDistance_GroupsThousands()
    {
        // 1,234,567 m → 1234.567 km, precision 1 → "1,234.6 km".
        Assert.Equal("1,234.6 km", UnitFormatters.FormatDistance(1_234_567, UnitPref.Metric));
    }

    [Fact]
    public void FormatDistance_RoundsHalfAwayFromZero()
    {
        // 1250 m = 1.25 km → precision 1 rounds half up to "1.3 km".
        Assert.Equal("1.3 km", UnitFormatters.FormatDistance(1250, UnitPref.Metric));
    }

    [Fact]
    public void FormatDistance_PrecisionOverride_Wins()
    {
        Assert.Equal("1.250 km", UnitFormatters.FormatDistance(1250, UnitPref.Metric, precision: 3));
    }

    [Fact]
    public void FormatEnergy_ImperialConvertsWhToKwh()
    {
        // 1500 Wh → imperial kWh, default energy precision 2 → "1.50 kWh".
        Assert.Equal("1.50 kWh", UnitFormatters.FormatEnergy(1500, UnitPref.Imperial));
    }

    [Fact]
    public void FormatSpeed_NegativeValuePreservesSign()
    {
        // -10 m/s metric km/h: -36 km/h, precision 0.
        Assert.Equal("-36 km/h", UnitFormatters.FormatSpeed(-10, UnitPref.Metric));
    }

    [Fact]
    public void ScalarFormatters_PercentageAndCurrency()
    {
        Assert.Equal("87%", ScalarFormatters.FormatPercentage(87));
        Assert.Equal("12.5%", ScalarFormatters.FormatPercentage(12.5, precision: 1));
        Assert.Equal("$1,250.00", ScalarFormatters.FormatCurrency(1250));
        Assert.Equal("\u20AC9.99", ScalarFormatters.FormatCurrency(9.99, symbol: "\u20AC"));
    }

    [Fact]
    public void ScalarFormatters_VoltageCurrentNumber()
    {
        Assert.Equal("400.0 V", ScalarFormatters.FormatVoltage(400));
        Assert.Equal("16.0 A", ScalarFormatters.FormatCurrent(16));
        Assert.Equal("1,000", ScalarFormatters.FormatNumber(1000));
        Assert.Equal("\u2014", ScalarFormatters.FormatNumber(null));
    }

    [Fact]
    public void ScalarFormatters_Clock()
    {
        Assert.Equal("45s", ScalarFormatters.FormatClock(45));
        Assert.Equal("12m 30s", ScalarFormatters.FormatClock(750));
        Assert.Equal("1h 05m", ScalarFormatters.FormatClock(3900));
        Assert.Equal("\u2014", ScalarFormatters.FormatClock(null));
    }

    [Theory]
    [InlineData(DistanceUnit.Km, "km")]
    [InlineData(DistanceUnit.Mi, "mi")]
    [InlineData(DistanceUnit.Ft, "ft")]
    public void UnitLabels_RoundTrip(DistanceUnit unit, string label)
    {
        Assert.Equal(label, UnitLabels.Label(unit));
        Assert.Equal(unit, UnitLabels.DistanceFromLabel(label));
    }
}
