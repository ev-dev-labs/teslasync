using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>Verifies the widget privacy redaction hides VIN/location by default and masks when revealed.</summary>
public sealed class WidgetRedactionTests
{
    private const string SampleVin = "5YJ3E1EA7KF000316";

    [Fact]
    public void Vin_is_null_when_hidden()
    {
        Assert.Null(WidgetRedaction.Vin(SampleVin, hide: true));
    }

    [Fact]
    public void Vin_is_null_when_unset()
    {
        Assert.Null(WidgetRedaction.Vin(null, hide: false));
        Assert.Null(WidgetRedaction.Vin("   ", hide: false));
    }

    [Fact]
    public void Vin_reveals_only_the_masked_trailing_four_characters()
    {
        var result = WidgetRedaction.Vin(SampleVin, hide: false);

        Assert.Equal(WidgetRedaction.Mask + "0316", result);
        Assert.DoesNotContain("5YJ3", result, StringComparison.Ordinal);
    }

    [Fact]
    public void Vin_masks_a_short_value_entirely()
    {
        Assert.Equal(WidgetRedaction.Mask, WidgetRedaction.Vin("ABC", hide: false));
    }

    [Fact]
    public void Location_is_null_when_hidden_or_unavailable()
    {
        Assert.Null(WidgetRedaction.Location(37.123, -122.456, hide: true));
        Assert.Null(WidgetRedaction.Location(null, -122.456, hide: false));
        Assert.Null(WidgetRedaction.Location(double.NaN, 1, hide: false));
    }

    [Fact]
    public void Location_is_coarsened_to_two_fractional_digits_when_revealed()
    {
        Assert.Equal("37.12, -122.46", WidgetRedaction.Location(37.123456, -122.456789, hide: false));
    }
}
