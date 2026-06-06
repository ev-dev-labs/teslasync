using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Verifies the SI→display widget projection: unit conversion, charge/lock/status labels, the
/// freshness marker (live/stale/offline), null safety, and the privacy-first VIN/location gating.
/// </summary>
public sealed class WidgetProjectionTests
{
    private static readonly RouteRegistry Registry = new();
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static WidgetVehicleSnapshot FullSnapshot(DateTimeOffset observedAt) => new()
    {
        VehicleId = 7,
        DisplayName = "Model 3",
        Vin = "5YJ3E1EA7KF000316",
        BatteryLevel = 72,
        RatedRangeMeters = 320_000,
        IsCharging = true,
        ChargerPowerWatts = 11_000,
        IsLocked = true,
        SentryMode = true,
        State = "online",
        Latitude = 37.5,
        Longitude = -122.3,
        ObservedAt = observedAt,
    };

    private static WidgetView Project(WidgetVehicleSnapshot snapshot, WidgetPrivacyOptions? privacy = null) =>
        WidgetProjection.Project(snapshot, UnitPref.Metric, privacy ?? WidgetPrivacyOptions.Default, Now, Registry);

    [Fact]
    public void Projects_core_fields_for_a_fresh_snapshot()
    {
        var view = Project(FullSnapshot(Now.AddSeconds(-30)));

        Assert.Equal(7, view.VehicleId);
        Assert.Equal("Model 3", view.DisplayName);
        Assert.Equal("Online", view.StatusLabel);
        Assert.Equal("72%", view.BatteryText);
        Assert.Equal(72, view.BatteryPercent);
        Assert.Equal("#22D3EE", view.AccentColor);
        Assert.Contains("km", view.RangeText, StringComparison.Ordinal);
        Assert.StartsWith("Charging", view.ChargeStateText, StringComparison.Ordinal);
        Assert.True(view.IsCharging);
        Assert.Equal("Locked", view.LockStateText);
        Assert.Equal(FreshnessStatus.Fresh, view.Freshness);
        Assert.Equal("Live", view.FreshnessLabel);
        Assert.Equal(4, view.Actions.Count);
    }

    [Fact]
    public void Hides_vin_and_location_by_default()
    {
        var view = Project(FullSnapshot(Now.AddSeconds(-30)));

        Assert.False(view.ShowVin);
        Assert.Null(view.VinText);
        Assert.False(view.ShowLocation);
        Assert.Null(view.LocationText);
    }

    [Fact]
    public void Reveals_masked_vin_and_location_only_when_privacy_allows()
    {
        var privacy = new WidgetPrivacyOptions { HideVin = false, HideLocation = false };

        var view = Project(FullSnapshot(Now.AddSeconds(-30)), privacy);

        Assert.True(view.ShowVin);
        Assert.Equal(WidgetRedaction.Mask + "0316", view.VinText);
        Assert.True(view.ShowLocation);
        Assert.Equal("37.50, -122.30", view.LocationText);
    }

    [Fact]
    public void Low_battery_uses_the_danger_accent()
    {
        var snapshot = FullSnapshot(Now.AddSeconds(-30)) with { BatteryLevel = 15 };

        Assert.Equal("#EF4444", Project(snapshot).AccentColor);
    }

    [Theory]
    [InlineData(-30, FreshnessStatus.Fresh, "Live")]
    [InlineData(-300, FreshnessStatus.Stale, "Stale")]
    [InlineData(-900, FreshnessStatus.Offline, "Offline")]
    public void Maps_the_freshness_marker_from_observed_age(int ageSeconds, FreshnessStatus expected, string label)
    {
        var view = Project(FullSnapshot(Now.AddSeconds(ageSeconds)));

        Assert.Equal(expected, view.Freshness);
        Assert.Equal(label, view.FreshnessLabel);
    }

    [Fact]
    public void Empty_snapshot_renders_explicit_unknowns_not_fabricated_values()
    {
        var view = Project(new WidgetVehicleSnapshot { VehicleId = 7 });

        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, view.BatteryText);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, view.RangeText);
        Assert.Equal("Charge unknown", view.ChargeStateText);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, view.LockStateText);
        Assert.Equal("Unknown", view.StatusLabel);
        Assert.Equal(FreshnessStatus.Unknown, view.Freshness);
        Assert.Equal("No data", view.FreshnessLabel);
        Assert.False(view.IsCharging);
    }

    [Fact]
    public void Not_charging_state_is_explicit()
    {
        var snapshot = FullSnapshot(Now.AddSeconds(-30)) with { IsCharging = false };

        Assert.Equal("Not charging", Project(snapshot).ChargeStateText);
    }
}
