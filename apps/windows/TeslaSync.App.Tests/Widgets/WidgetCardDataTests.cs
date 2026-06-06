using System.Text.Json;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>Verifies the Adaptive Card data payload binds every template key, including privacy gates and action slots.</summary>
public sealed class WidgetCardDataTests
{
    private static readonly RouteRegistry Registry = new();
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static JsonElement BuildData(WidgetPrivacyOptions privacy)
    {
        var snapshot = new WidgetVehicleSnapshot
        {
            VehicleId = 7,
            DisplayName = "Model 3",
            Vin = "5YJ3E1EA7KF000316",
            BatteryLevel = 72,
            RatedRangeMeters = 320_000,
            IsCharging = true,
            ChargerPowerWatts = 11_000,
            IsLocked = true,
            State = "online",
            Latitude = 37.5,
            Longitude = -122.3,
            ObservedAt = Now.AddSeconds(-30),
        };

        var view = WidgetProjection.Project(snapshot, UnitPref.Metric, privacy, Now, Registry);
        return JsonDocument.Parse(WidgetCardData.Build(view)).RootElement;
    }

    [Fact]
    public void Binds_the_status_and_metric_keys()
    {
        var data = BuildData(WidgetPrivacyOptions.Default);

        Assert.Equal("Model 3", data.GetProperty("displayName").GetString());
        Assert.Equal("Online", data.GetProperty("statusLabel").GetString());
        Assert.Equal("72%", data.GetProperty("batteryText").GetString());
        Assert.Equal(72, data.GetProperty("batteryPercent").GetDouble());
        Assert.Equal("Live", data.GetProperty("freshnessLabel").GetString());
        Assert.False(string.IsNullOrEmpty(data.GetProperty("lastUpdatedText").GetString()));
        Assert.Equal("#22D3EE", data.GetProperty("accentColor").GetString());
    }

    [Fact]
    public void Hides_vin_and_location_in_the_data_by_default()
    {
        var data = BuildData(WidgetPrivacyOptions.Default);

        Assert.False(data.GetProperty("showVin").GetBoolean());
        Assert.Equal(string.Empty, data.GetProperty("vinText").GetString());
        Assert.False(data.GetProperty("showLocation").GetBoolean());
        Assert.Equal(string.Empty, data.GetProperty("locationText").GetString());
    }

    [Fact]
    public void Reveals_masked_values_when_privacy_allows()
    {
        var data = BuildData(new WidgetPrivacyOptions { HideVin = false, HideLocation = false });

        Assert.True(data.GetProperty("showVin").GetBoolean());
        Assert.Equal(WidgetRedaction.Mask + "0316", data.GetProperty("vinText").GetString());
        Assert.True(data.GetProperty("showLocation").GetBoolean());
        Assert.Equal("37.50, -122.30", data.GetProperty("locationText").GetString());
    }

    [Fact]
    public void Binds_the_quick_action_slots()
    {
        var data = BuildData(WidgetPrivacyOptions.Default);

        Assert.True(data.GetProperty("hasOpenVehicle").GetBoolean());
        Assert.Equal("teslasync://app/vehicles/7", data.GetProperty("openVehicleUrl").GetString());
        Assert.False(string.IsNullOrEmpty(data.GetProperty("openVehicleTitle").GetString()));

        Assert.True(data.GetProperty("hasOpenCharging").GetBoolean());
        Assert.Equal("teslasync://app/charging", data.GetProperty("openChargingUrl").GetString());
        Assert.True(data.GetProperty("hasOpenLiveMap").GetBoolean());
        Assert.True(data.GetProperty("hasOpenCommands").GetBoolean());
    }
}
