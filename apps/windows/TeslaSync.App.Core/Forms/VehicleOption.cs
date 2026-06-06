namespace TeslaSync.App.Core.Forms;

/// <summary>
/// Lightweight, presentation-ready vehicle descriptor used by the vehicle
/// pickers (<c>TsVehicleSelect</c>, <c>TsVehicleMultiSelect</c>). Decoupled from
/// the generated API model so the Core layer and its tests never depend on the
/// transport shape — the WinUI/repository layer maps the API record into this.
/// </summary>
public sealed record VehicleOption(
    long Id,
    string? DisplayName = null,
    string? Vin = null,
    string? Model = null);

/// <summary>
/// Pure label helpers for vehicle options. Ports the web <c>vehicleLabel</c>
/// rules so the native pickers read identically.
/// </summary>
public static class VehicleLabels
{
    /// <summary>Last four characters of a VIN, or null when too short / missing.</summary>
    public static string? LastFourVin(string? vin) =>
        string.IsNullOrEmpty(vin) || vin.Length < 4 ? null : vin[^4..];

    /// <summary>
    /// Short trigger label: display name, else VIN, else a numeric fallback
    /// using <paramref name="fallback"/> (e.g. "Vehicle 7").
    /// </summary>
    public static string Short(VehicleOption vehicle, string fallback = "Vehicle")
    {
        ArgumentNullException.ThrowIfNull(vehicle);
        if (!string.IsNullOrEmpty(vehicle.DisplayName))
        {
            return vehicle.DisplayName;
        }

        if (!string.IsNullOrEmpty(vehicle.Vin))
        {
            return vehicle.Vin;
        }

        return $"{fallback} {vehicle.Id}";
    }

    /// <summary>
    /// Detailed list label, mirroring the web multi-select rows:
    /// "Name — Model (VIN ...1234)" with graceful degradation when fields are
    /// missing or the name already equals the model.
    /// </summary>
    public static string Detailed(VehicleOption vehicle, string fallback = "Vehicle")
    {
        ArgumentNullException.ThrowIfNull(vehicle);
        var last4 = LastFourVin(vehicle.Vin);
        var baseName = !string.IsNullOrEmpty(vehicle.DisplayName)
            ? vehicle.DisplayName
            : !string.IsNullOrEmpty(vehicle.Model)
                ? vehicle.Model
                : $"{fallback} #{vehicle.Id}";

        if (last4 is null)
        {
            return !string.IsNullOrEmpty(vehicle.Model) ? $"{baseName} — {vehicle.Model}" : baseName;
        }

        if (string.IsNullOrEmpty(vehicle.Model) || vehicle.DisplayName == vehicle.Model)
        {
            return $"{baseName} (VIN ...{last4})";
        }

        return $"{baseName} — {vehicle.Model} (VIN ...{last4})";
    }
}
