using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Core.Vehicles;

/// <summary>
/// SI vehicle state for the hero card (matches the API state endpoint, all SI:
/// metres, °C, watts). Nullable fields stay null when not reported.
/// </summary>
/// <param name="BatteryLevel">State of charge, percent.</param>
/// <param name="RatedRangeMeters">Rated range in metres (SI).</param>
/// <param name="InsideTempCelsius">Cabin temperature in °C (SI).</param>
/// <param name="OutsideTempCelsius">Ambient temperature in °C (SI).</param>
/// <param name="OdometerMeters">Odometer in metres (SI).</param>
/// <param name="PowerWatts">Instantaneous power in watts (SI).</param>
/// <param name="IsLocked">Locked.</param>
/// <param name="SentryMode">Sentry armed.</param>
/// <param name="SoftwareVersion">Firmware version string.</param>
public readonly record struct VehicleHeroState(
    double? BatteryLevel = null,
    double? RatedRangeMeters = null,
    double? InsideTempCelsius = null,
    double? OutsideTempCelsius = null,
    double? OdometerMeters = null,
    double? PowerWatts = null,
    bool? IsLocked = null,
    bool? SentryMode = null,
    string? SoftwareVersion = null);

/// <summary>One resolved gauge for the hero card (value + scale + unit label).</summary>
/// <param name="Value">Display value (already converted).</param>
/// <param name="Max">Scale maximum so the arc fills meaningfully.</param>
/// <param name="UnitLabel">Display unit suffix.</param>
public readonly record struct HeroGauge(double Value, double Max, string UnitLabel);

/// <summary>
/// Display-boundary conversion for the vehicle hero card (port of the web
/// <c>VehicleHeroCard</c> SI→display logic). Reads SI directly and converts using
/// <c>useUnits()</c>-equivalent <see cref="UnitPref"/>. Phase-48 compliant: never
/// stores or returns unit-suffixed SI fields. Pure + headless.
/// </summary>
public static class VehicleHeroMetrics
{
    /// <summary>Battery gauge (always 0–100%).</summary>
    public static HeroGauge Battery(VehicleHeroState s) =>
        new(Math.Round(s.BatteryLevel ?? 0), 100, "%");

    /// <summary>
    /// Range gauge. Scale maxes at ~644 km / 400 mi so a long-range pack fills the
    /// arc without overflowing.
    /// </summary>
    public static HeroGauge Range(VehicleHeroState s, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);
        double value = Math.Round(UnitConverters.DistanceFromSi(s.RatedRangeMeters ?? 0, pref.Distance));
        double max = pref.Distance == DistanceUnit.Km ? 644 : 400;
        return new HeroGauge(value, max, UnitLabels.Label(pref.Distance));
    }

    /// <summary>Inside-temperature gauge.</summary>
    public static HeroGauge InsideTemp(VehicleHeroState s, UnitPref pref) =>
        TempGauge(s.InsideTempCelsius, pref);

    /// <summary>Outside-temperature gauge.</summary>
    public static HeroGauge OutsideTemp(VehicleHeroState s, UnitPref pref) =>
        TempGauge(s.OutsideTempCelsius, pref);

    /// <summary>Odometer in the user's display distance unit (rounded).</summary>
    public static double OdometerDisplay(VehicleHeroState s, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);
        return Math.Round(UnitConverters.DistanceFromSi(s.OdometerMeters ?? 0, pref.Distance));
    }

    /// <summary>Power in kW (display convention for the hero stat).</summary>
    public static double PowerKilowatts(VehicleHeroState s) =>
        UnitConverters.PowerFromSi(s.PowerWatts ?? 0, PowerUnit.Kw);

    /// <summary>Battery gauge accent: cyan above 20%, red at or below 20%.</summary>
    public static string BatteryColor(double batteryLevel) =>
        batteryLevel > 20 ? "#22D3EE" : "#EF4444";

    private static HeroGauge TempGauge(double? celsius, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);
        double value = Math.Round(UnitConverters.TemperatureFromSi(celsius ?? 0, pref.Temperature));
        double max = pref.Temperature == TemperatureUnit.Celsius ? 50 : 122;
        return new HeroGauge(value, max, UnitLabels.Label(pref.Temperature));
    }
}
