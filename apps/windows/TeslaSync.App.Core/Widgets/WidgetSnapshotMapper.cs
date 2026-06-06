using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// Maps the generated contract types (P2/W8-0003) into the SI <see cref="WidgetVehicleSnapshot"/> the
/// projection consumes. The identity fields (name, VIN) come from the vehicle list entry and the
/// dynamic fields from the state entry; either may be absent. Values stay SI (metres, watts, °C) — the
/// display unit is applied later, at the projection boundary.
/// </summary>
public static class WidgetSnapshotMapper
{
    /// <summary>Builds a snapshot from a cached vehicle and/or state, stamped with <paramref name="observedAt"/>.</summary>
    public static WidgetVehicleSnapshot From(
        GeneratedApi.Vehicle? vehicle,
        GeneratedApi.VehicleState? state,
        DateTimeOffset? observedAt)
    {
        long vehicleId = state?.VehicleId ?? vehicle?.Id ?? 0;

        return new WidgetVehicleSnapshot
        {
            VehicleId = vehicleId,
            DisplayName = vehicle?.DisplayName ?? string.Empty,
            Vin = vehicle?.Vin,
            BatteryLevel = state is null ? (double?)null : state.BatteryLevel,
            RatedRangeMeters = state?.RatedRange,
            IsCharging = state?.IsCharging,
            ChargerPowerWatts = state?.ChargerPower,
            TimeToFullChargeHours = state?.TimeToFullCharge,
            IsLocked = state?.IsLocked,
            SentryMode = state?.SentryMode,
            IsClimateOn = state?.IsClimateOn,
            InsideTempCelsius = state?.InsideTemp,
            State = state?.State,
            Latitude = state?.Latitude,
            Longitude = state?.Longitude,
            ObservedAt = observedAt ?? state?.Since,
        };
    }
}
