using TeslaSync.App.Core.Units;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>
/// Verifies the efficiency unit conversion + label that the unit-aware projections use to render the
/// backend-native <c>efficiency_wh_km</c> in the account's display distance unit (web parity: Wh/km for
/// metric, Wh/mi for imperial). Per-mile efficiency is larger than per-km because a mile is longer.
/// </summary>
public sealed class EfficiencyConverterTests
{
    [Fact]
    public void WhPerKm_to_metric_is_identity()
    {
        Assert.Equal(150.0, UnitConverters.EfficiencyFromWhPerKm(150.0, DistanceUnit.Km), 6);
    }

    [Fact]
    public void WhPerKm_to_imperial_scales_by_km_per_mile()
    {
        // 150 Wh/km * 1.609344 km/mi = 241.4016 Wh/mi
        Assert.Equal(241.4016, UnitConverters.EfficiencyFromWhPerKm(150.0, DistanceUnit.Mi), 4);
    }

    [Fact]
    public void Zero_is_zero_in_both_units()
    {
        Assert.Equal(0.0, UnitConverters.EfficiencyFromWhPerKm(0.0, DistanceUnit.Mi), 6);
        Assert.Equal(0.0, UnitConverters.EfficiencyFromWhPerKm(0.0, DistanceUnit.Km), 6);
    }

    [Theory]
    [InlineData(DistanceUnit.Km, "Wh/km")]
    [InlineData(DistanceUnit.Mi, "Wh/mi")]
    [InlineData(DistanceUnit.Ft, "Wh/km")]
    public void EfficiencyLabel_matches_distance_unit(DistanceUnit unit, string expected)
    {
        Assert.Equal(expected, UnitLabels.EfficiencyLabel(unit));
    }
}
