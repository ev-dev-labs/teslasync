namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The SI vehicle state a Windows widget (P2/W8-0003) projects into ambient content. It mirrors the
/// API state endpoint (metres, watts, °C) plus the identity fields (name, VIN) the list endpoint
/// carries, and an <see cref="ObservedAt"/> stamp so the projection can derive a live/stale/offline
/// marker. Every dynamic field is nullable and stays null when the source did not report it, so the
/// projection always renders an explicit unknown rather than a fabricated value.
/// </summary>
public sealed record WidgetVehicleSnapshot
{
    /// <summary>The vehicle id (used to build the per-vehicle deep link).</summary>
    public long VehicleId { get; init; }

    /// <summary>The vehicle display name.</summary>
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>The vehicle VIN (redacted by the privacy layer before display).</summary>
    public string? Vin { get; init; }

    /// <summary>State of charge, percent (0–100).</summary>
    public double? BatteryLevel { get; init; }

    /// <summary>Rated range in metres (SI).</summary>
    public double? RatedRangeMeters { get; init; }

    /// <summary>True while the vehicle is actively charging.</summary>
    public bool? IsCharging { get; init; }

    /// <summary>Charger power in watts (SI).</summary>
    public double? ChargerPowerWatts { get; init; }

    /// <summary>Estimated time to a full charge, in hours.</summary>
    public double? TimeToFullChargeHours { get; init; }

    /// <summary>True when the vehicle is locked.</summary>
    public bool? IsLocked { get; init; }

    /// <summary>True when sentry mode is armed.</summary>
    public bool? SentryMode { get; init; }

    /// <summary>True when climate is running.</summary>
    public bool? IsClimateOn { get; init; }

    /// <summary>Cabin temperature in °C (SI).</summary>
    public double? InsideTempCelsius { get; init; }

    /// <summary>The coarse lifecycle state (<c>online</c>/<c>asleep</c>/<c>offline</c>/<c>driving</c>/<c>charging</c>).</summary>
    public string? State { get; init; }

    /// <summary>Last known latitude (suppressed by the privacy layer unless explicitly allowed).</summary>
    public double? Latitude { get; init; }

    /// <summary>Last known longitude (suppressed by the privacy layer unless explicitly allowed).</summary>
    public double? Longitude { get; init; }

    /// <summary>When this state was last refreshed (cache fetch time or live receive time), or null.</summary>
    public DateTimeOffset? ObservedAt { get; init; }
}
