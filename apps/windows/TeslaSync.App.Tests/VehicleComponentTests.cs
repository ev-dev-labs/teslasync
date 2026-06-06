using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Vehicles;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class VehicleTwinPresentationTests
{
    [Theory]
    [InlineData(WindowPosition.Closed, "Closed")]
    [InlineData(WindowPosition.Open, "Open")]
    [InlineData(WindowPosition.Partial, "Partially open")]
    [InlineData(WindowPosition.Unknown, "Unknown")]
    public void WindowLabel_MatchesState(WindowPosition state, string expected) =>
        Assert.Equal(expected, VehicleTwinPresentation.WindowLabel(state));

    [Fact]
    public void WindowStroke_OpenIsAmber_ClosedIsGlass()
    {
        Assert.Equal(VehicleTwinPresentation.AmberOpen, VehicleTwinPresentation.WindowStroke(WindowPosition.Open));
        Assert.Equal(VehicleTwinPresentation.GlassStroke, VehicleTwinPresentation.WindowStroke(WindowPosition.Closed));
        Assert.Equal(VehicleTwinPresentation.Neutral, VehicleTwinPresentation.WindowStroke(WindowPosition.Unknown));
    }

    [Fact]
    public void DoorStroke_TriState()
    {
        Assert.Equal(VehicleTwinPresentation.AmberOpen, VehicleTwinPresentation.DoorStroke(true));
        Assert.Equal("#FFFFFF", VehicleTwinPresentation.DoorStroke(false));
        Assert.Equal(VehicleTwinPresentation.Neutral, VehicleTwinPresentation.DoorStroke(null));
    }

    [Fact]
    public void LockColorAndLabel_TriState()
    {
        Assert.Equal(VehicleTwinPresentation.LockedGreen, VehicleTwinPresentation.LockColor(true));
        Assert.Equal(VehicleTwinPresentation.UnlockedRed, VehicleTwinPresentation.LockColor(false));
        Assert.Equal(VehicleTwinPresentation.Neutral, VehicleTwinPresentation.LockColor(null));
        Assert.Equal("Locked", VehicleTwinPresentation.LockLabel(true));
        Assert.Equal("Unlocked", VehicleTwinPresentation.LockLabel(false));
        Assert.Equal("Unknown", VehicleTwinPresentation.LockLabel(null));
    }

    [Fact]
    public void SentryLabel_TriState()
    {
        Assert.Equal("Sentry on", VehicleTwinPresentation.SentryLabel(true));
        Assert.Equal("Sentry off", VehicleTwinPresentation.SentryLabel(false));
        Assert.Equal("Unknown", VehicleTwinPresentation.SentryLabel(null));
    }

    [Fact]
    public void StateLabel_UsesProvidedText()
    {
        Assert.Equal("Yes", VehicleTwinPresentation.StateLabel(true, "Yes", "No"));
        Assert.Equal("No", VehicleTwinPresentation.StateLabel(false, "Yes", "No"));
        Assert.Equal("Unknown", VehicleTwinPresentation.StateLabel(null, "Yes", "No"));
    }
}

public sealed class PaintPalettesTests
{
    [Theory]
    [InlineData("PearlWhiteMultiCoat", PaintPaletteId.PearlWhite)]
    [InlineData("pearl white", PaintPaletteId.PearlWhite)]
    [InlineData("white", PaintPaletteId.PearlWhite)]
    [InlineData("MidnightSilverMetallic", PaintPaletteId.MidnightSilver)]
    [InlineData("silver", PaintPaletteId.MidnightSilver)]
    [InlineData("DeepBlueMetallic", PaintPaletteId.DeepBlue)]
    [InlineData("blue", PaintPaletteId.DeepBlue)]
    [InlineData("SolidBlack", PaintPaletteId.SolidBlack)]
    [InlineData("obsidian black", PaintPaletteId.SolidBlack)]
    [InlineData("RedMultiCoat", PaintPaletteId.RedMulticoat)]
    [InlineData("red", PaintPaletteId.RedMulticoat)]
    public void InferFromTesla_MapsKnownCodes(string code, PaintPaletteId expected) =>
        Assert.Equal(expected, PaintPalettes.InferFromTesla(code).Id);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("MysteryColor")]
    public void InferFromTesla_UnknownFallsBackToPearlWhite(string? code) =>
        Assert.Equal(PaintPaletteId.PearlWhite, PaintPalettes.InferFromTesla(code).Id);

    [Fact]
    public void All_ContainsFivePalettes_WithUniqueIds()
    {
        Assert.Equal(5, PaintPalettes.All.Count);
        Assert.Equal(5, PaintPalettes.All.Select(p => p.Id).Distinct().Count());
    }

    [Fact]
    public void ById_RoundTrips()
    {
        foreach (var palette in PaintPalettes.All)
        {
            Assert.Equal(palette, PaintPalettes.ById(palette.Id));
        }
    }

    [Fact]
    public void SolidBlack_IsMarkedDark() => Assert.True(PaintPalettes.SolidBlack.IsDark);
}

public sealed class VehicleHeroMetricsTests
{
    [Fact]
    public void Battery_IsZeroToHundredScale()
    {
        var gauge = VehicleHeroMetrics.Battery(new VehicleHeroState(BatteryLevel: 73.4));
        Assert.Equal(73, gauge.Value);
        Assert.Equal(100, gauge.Max);
        Assert.Equal("%", gauge.UnitLabel);
    }

    [Fact]
    public void Range_Metric_Converts644Max()
    {
        var gauge = VehicleHeroMetrics.Range(new VehicleHeroState(RatedRangeMeters: 482_803), UnitPref.Metric);
        Assert.Equal(483, gauge.Value); // 482803 m ≈ 482.8 km
        Assert.Equal(644, gauge.Max);
        Assert.Equal("km", gauge.UnitLabel);
    }

    [Fact]
    public void Range_Imperial_Converts400Max()
    {
        var gauge = VehicleHeroMetrics.Range(new VehicleHeroState(RatedRangeMeters: 482_803), UnitPref.Imperial);
        Assert.Equal(300, gauge.Value); // 482803 m ≈ 300 mi
        Assert.Equal(400, gauge.Max);
        Assert.Equal("mi", gauge.UnitLabel);
    }

    [Fact]
    public void InsideTemp_Metric_HasFiftyMax()
    {
        var gauge = VehicleHeroMetrics.InsideTemp(new VehicleHeroState(InsideTempCelsius: 21.5), UnitPref.Metric);
        Assert.Equal(22, gauge.Value);
        Assert.Equal(50, gauge.Max);
        Assert.Equal("\u00B0C", gauge.UnitLabel);
    }

    [Fact]
    public void OutsideTemp_Imperial_Converts()
    {
        var gauge = VehicleHeroMetrics.OutsideTemp(new VehicleHeroState(OutsideTempCelsius: 0), UnitPref.Imperial);
        Assert.Equal(32, gauge.Value);
        Assert.Equal(122, gauge.Max);
        Assert.Equal("\u00B0F", gauge.UnitLabel);
    }

    [Fact]
    public void OdometerDisplay_ConvertsMetersToDisplayUnit()
    {
        double km = VehicleHeroMetrics.OdometerDisplay(new VehicleHeroState(OdometerMeters: 100_000), UnitPref.Metric);
        Assert.Equal(100, km);
        double mi = VehicleHeroMetrics.OdometerDisplay(new VehicleHeroState(OdometerMeters: 1_609_344), UnitPref.Imperial);
        Assert.Equal(1000, mi);
    }

    [Fact]
    public void PowerKilowatts_ConvertsWattsToKw() =>
        Assert.Equal(75, VehicleHeroMetrics.PowerKilowatts(new VehicleHeroState(PowerWatts: 75_000)));

    [Theory]
    [InlineData(50, "#22D3EE")]
    [InlineData(21, "#22D3EE")]
    [InlineData(20, "#EF4444")]
    [InlineData(5, "#EF4444")]
    public void BatteryColor_RedAtOrBelowTwenty(double level, string expected) =>
        Assert.Equal(expected, VehicleHeroMetrics.BatteryColor(level));

    [Fact]
    public void NullState_DefaultsToZero()
    {
        var gauge = VehicleHeroMetrics.Range(default, UnitPref.Metric);
        Assert.Equal(0, gauge.Value);
    }
}
