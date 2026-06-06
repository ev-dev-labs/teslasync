using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>Builders for the generated contract types used by the widget source/mapper tests.</summary>
internal static class WidgetTestData
{
    public static GeneratedApi.Vehicle MakeVehicle(
        long id,
        string displayName,
        string vin,
        DateTimeOffset? archivedAt = null) =>
        new(
            CreatedAt: DateTimeOffset.UnixEpoch,
            DisplayName: displayName,
            EnrolledAt: DateTimeOffset.UnixEpoch,
            Id: id,
            TeslaId: id,
            Timezone: "UTC",
            UpdatedAt: DateTimeOffset.UnixEpoch,
            Vin: vin,
            ArchivedAt: archivedAt);

    public static GeneratedApi.VehicleState MakeState(
        long vehicleId,
        long battery = 72,
        double ratedRangeMeters = 320_000,
        bool charging = true,
        double chargerPowerWatts = 11_000,
        bool locked = true,
        string state = "online",
        double latitude = 37.5,
        double longitude = -122.3) =>
        new(
            BatteryLevel: battery,
            ChargeRate: 0,
            ChargerPower: chargerPowerWatts,
            IdealRange: ratedRangeMeters,
            InsideTemp: 21,
            IsCharging: charging,
            IsClimateOn: false,
            IsLocked: locked,
            Latitude: latitude,
            Longitude: longitude,
            Odometer: 1_000_000,
            OutsideTemp: 15,
            Power: 0,
            RatedRange: ratedRangeMeters,
            SentryMode: true,
            SoftwareVersion: "2026.4",
            Speed: 0,
            State: state,
            TimeToFullCharge: 2.5,
            VehicleId: vehicleId);
}
