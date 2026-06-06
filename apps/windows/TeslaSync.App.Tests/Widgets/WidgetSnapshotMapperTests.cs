using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>Verifies the generated contract types map into the SI widget snapshot, including partial data.</summary>
public sealed class WidgetSnapshotMapperTests
{
    private static readonly DateTimeOffset Observed = DateTimeOffset.UnixEpoch.AddHours(1);

    [Fact]
    public void Maps_vehicle_identity_and_si_state()
    {
        var vehicle = WidgetTestData.MakeVehicle(7, "Model 3", "VIN0000007");
        var state = WidgetTestData.MakeState(7, battery: 80, ratedRangeMeters: 250_000, charging: false, state: "asleep");

        var snapshot = WidgetSnapshotMapper.From(vehicle, state, Observed);

        Assert.Equal(7, snapshot.VehicleId);
        Assert.Equal("Model 3", snapshot.DisplayName);
        Assert.Equal("VIN0000007", snapshot.Vin);
        Assert.Equal(80, snapshot.BatteryLevel);
        Assert.Equal(250_000, snapshot.RatedRangeMeters);
        Assert.False(snapshot.IsCharging);
        Assert.Equal("asleep", snapshot.State);
        Assert.Equal(Observed, snapshot.ObservedAt);
    }

    [Fact]
    public void State_only_leaves_identity_empty()
    {
        var snapshot = WidgetSnapshotMapper.From(null, WidgetTestData.MakeState(7), observedAt: null);

        Assert.Equal(7, snapshot.VehicleId);
        Assert.Equal(string.Empty, snapshot.DisplayName);
        Assert.Null(snapshot.Vin);
    }

    [Fact]
    public void Vehicle_only_has_no_dynamic_state()
    {
        var snapshot = WidgetSnapshotMapper.From(WidgetTestData.MakeVehicle(7, "Model 3", "VIN0000007"), null, Observed);

        Assert.Equal(7, snapshot.VehicleId);
        Assert.Null(snapshot.BatteryLevel);
        Assert.Null(snapshot.IsCharging);
        Assert.Equal(Observed, snapshot.ObservedAt);
    }
}
