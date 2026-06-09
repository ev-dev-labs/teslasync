using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The mutually-exclusive lifecycle state the drive-detail <see cref="HeroGaugesViewModel"/> can be in — the
/// native superset of the branches the web drive-detail Hero Gauges renders
/// (web/src/features/driving/components/drive-detail/HeroGauges.tsx). The web component is a pure child of the
/// drive-detail page (it takes <c>drive: DriveDetail</c> and <c>stats: DriveStats</c> and always renders the
/// row of radial gauges, because the page only mounts it once the drive has loaded). The native surface binds
/// its own cache-then-network read of the drive, so it owns the full loading / loaded / empty / error / stale /
/// offline matrix the P2 state contract requires. Every value maps onto a visible surface (never a blank panel).
/// </summary>
public enum HeroGaugesState
{
    /// <summary>Initial fetch with no cached snapshot — render the gauge skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh drive snapshot — render the four (or five) radial gauges.</summary>
    Loaded,

    /// <summary>The request resolved but carried no drive — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a gauge renders its value arc with — the native mirror of the literal neon hue the
/// web source passes each <c>RadialGauge</c> (<c>#00f0ff</c> cyan, <c>#a855f7</c> purple, <c>#f59e0b</c> amber,
/// <c>#ef4444</c> red, <c>#10b981</c> green). Kept WinUI-free so the projection can assign and the tests can
/// assert the per-gauge colour without a UI host; the view maps each value to a themed chart brush at render
/// time.
/// </summary>
public enum HeroGaugeAccent
{
    /// <summary>Cyan (web <c>#00f0ff</c>) — the distance gauge.</summary>
    Cyan,

    /// <summary>Purple (web <c>#a855f7</c>) — the max-speed gauge.</summary>
    Purple,

    /// <summary>Amber (web <c>#f59e0b</c>) — the duration gauge.</summary>
    Amber,

    /// <summary>Red (web <c>#ef4444</c>) — the consumption gauge.</summary>
    Red,

    /// <summary>Green (web <c>#10b981</c>) — the efficiency gauge.</summary>
    Green,
}

/// <summary>
/// The canonical SI inputs the web drive-detail Hero Gauges consumes — the native mirror of the
/// <c>drive: DriveDetail</c> fields plus the three <c>DriveStats</c> values the web source actually reads
/// (<c>maxSpd</c>, <c>consumptionWhKm</c>, <c>efficiencyPctPer100</c>; see
/// web/src/features/driving/components/drive-detail/useDriveDetailData.ts). Held as raw SI (meters, seconds,
/// m/s, watt-hours, watts, battery percent) so the projection converts at the display boundary exactly like the
/// web component does with <c>useUnits()</c>. WinUI-free so the derivation is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a real drive backed the figures (web <c>drive != null</c>).</param>
/// <param name="DistanceM">Drive distance in meters, SI (web <c>drive.distanceM</c>).</param>
/// <param name="DurationS">Drive duration in seconds, SI (web <c>drive.durationS</c>).</param>
/// <param name="MaxSpeedMps">Maximum speed in m/s, SI, or null (web <c>drive.maxSpeedMps</c>).</param>
/// <param name="EnergyUsedWh">Energy used in watt-hours, SI, or null (web <c>drive.energyUsedWh</c>).</param>
/// <param name="AvgPowerW">Average power in watts, SI, or null (web <c>drive.avgPowerW</c>).</param>
/// <param name="StartBatteryPct">Battery percent at drive start, or null (web <c>drive.startBatteryPct</c>).</param>
/// <param name="EndBatteryPct">Battery percent at drive end, or null (web <c>drive.endBatteryPct</c>).</param>
/// <param name="FallbackAvgPowerKw">Mean per-row telemetry power in kW used only when no aggregate power is
/// present (web <c>chartData.reduce(power) / length</c>).</param>
public sealed record DriveGauges(
    bool HasData,
    double DistanceM,
    double DurationS,
    double? MaxSpeedMps,
    double? EnergyUsedWh,
    double? AvgPowerW,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double FallbackAvgPowerKw)
{
    /// <summary>The no-drive snapshot — the parse fallback for an absent/non-object body (web <c>drive == null</c>).</summary>
    public static DriveGauges Empty { get; } = new(false, 0, 0, null, null, null, null, null, 0);

    /// <summary>
    /// Project a <c>GET /drives/{driveID}</c> JSON object into the canonical SI inputs — the native port of the
    /// fields the web drive-detail data hook reads off the drive. A non-object or property-less body yields
    /// <see cref="Empty"/>. Parsing is null-tolerant (the web <c>?? 0</c>) so a partial row never throws. The
    /// <see cref="FallbackAvgPowerKw"/> mirrors the web chart-data average power: the mean of the per-row
    /// <c>power</c> values (already kW from the API's <c>PackVoltage × PackCurrent / 1000</c> derivation) over the
    /// embedded telemetry array, or zero when telemetry is absent (positions carry no power, so the web average
    /// collapses to zero).
    /// </summary>
    /// <param name="element">The parsed drive-detail JSON body.</param>
    /// <returns>The canonical SI inputs, or <see cref="Empty"/> when there is no drive.</returns>
    public static DriveGauges FromDriveJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.EnumerateObject().MoveNext())
        {
            return Empty;
        }

        bool isDrive = DriveGaugesJson.Has(element, "id")
            || DriveGaugesJson.Has(element, "distance_m")
            || DriveGaugesJson.Has(element, "duration_s")
            || DriveGaugesJson.Has(element, "start_ts");
        if (!isDrive)
        {
            return Empty;
        }

        return new DriveGauges(
            HasData: true,
            DistanceM: DriveGaugesJson.GetDouble(element, "distance_m") ?? 0,
            DurationS: DriveGaugesJson.GetDouble(element, "duration_s") ?? 0,
            MaxSpeedMps: DriveGaugesJson.GetDouble(element, "max_speed_mps"),
            EnergyUsedWh: DriveGaugesJson.GetDouble(element, "energy_used_wh"),
            AvgPowerW: DriveGaugesJson.GetDouble(element, "avg_power_w"),
            StartBatteryPct: DriveGaugesJson.GetDouble(element, "start_battery_pct"),
            EndBatteryPct: DriveGaugesJson.GetDouble(element, "end_battery_pct"),
            FallbackAvgPowerKw: MeanTelemetryPowerKw(element));
    }

    private static double MeanTelemetryPowerKw(JsonElement drive)
    {
        // web parity: chartData is built from drive.telemetry when present, else drive.positions. Positions carry
        // no per-row power, so the web fallback average (chartData.reduce(power) / length) is non-zero only when
        // the telemetry array has rows. The per-row "power" is already kW (the API derives PackVoltage ×
        // PackCurrent / 1000 before serializing).
        if (!drive.TryGetProperty("telemetry", out var telemetry) || telemetry.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }

        int count = 0;
        double sum = 0;
        foreach (var row in telemetry.EnumerateArray())
        {
            count++;
            sum += DriveGaugesJson.GetDouble(row, "power") ?? 0;
        }

        return count > 0 ? sum / count : 0;
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the drive-detail Hero Gauges — the numeric getter
/// tolerates a numeric or numeric-string field and rejects NaN/Infinity, so a partial or schema-drifted drive
/// row never aborts the projection (web parity: the data hook tolerates undefined fields with <c>?? 0</c>).
/// WinUI-free.
/// </summary>
internal static class DriveGaugesJson
{
    /// <summary>True when <paramref name="obj"/> is an object carrying a property named <paramref name="name"/>.</summary>
    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready radial gauge — the native analogue of one web <c>&lt;RadialGauge&gt;</c>. Holds
/// the localized label, the numeric value and its full-sweep maximum (so the view's gauge arc matches the web
/// sweep), the literal unit suffix, the fixed decimal precision, the categorical accent (so the value arc colour
/// matches the web neon hue) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized gauge label (web <c>RadialGauge label</c>).</param>
/// <param name="Value">The numeric value the gauge displays (web <c>RadialGauge value</c>).</param>
/// <param name="Max">The value mapped to a full sweep (web <c>RadialGauge max</c>).</param>
/// <param name="Unit">The literal unit suffix (web <c>RadialGauge unit</c>).</param>
/// <param name="Decimals">Fraction digits for the rendered value (web <c>Number.isInteger(clamped) ? 0 : precision</c>).</param>
/// <param name="Accent">The categorical value-arc accent (web <c>RadialGauge color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the gauge.</param>
public sealed record HeroGauge(
    string Label,
    double Value,
    double Max,
    string Unit,
    int Decimals,
    HeroGaugeAccent Accent,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the drive-detail Hero Gauges — the native analogue of everything
/// the web component composes before returning its row of <c>&lt;RadialGauge&gt;</c>s. Holds the gauges (four
/// always, plus the efficiency gauge when the drive carries both battery endpoints), the data flag and the
/// surface's accessible name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a real drive backed the figures.</param>
/// <param name="Gauges">The display-ready radial gauges, in web order.</param>
/// <param name="AutomationName">The composed Narrator name for the whole surface.</param>
public sealed record HeroGaugesDisplay(
    bool HasData,
    IReadOnlyList<HeroGauge> Gauges,
    string AutomationName);

/// <summary>
/// Pure projection from the raw <see cref="DriveGauges"/> SI inputs to the gauge display model — the native port
/// of the render logic in web/src/features/driving/components/drive-detail/HeroGauges.tsx. The gauges reproduce
/// the web call sites one-for-one: the value each <c>RadialGauge</c> receives
/// (<c>round(toDistanceDisplay(distanceM))</c>, <c>round(maxSpd)</c>, <c>round(durationS / 60)</c>,
/// <c>round(toEfficiencyDisplay(consumptionWhKm))</c>, <c>efficiencyPctPer100</c>) and the same
/// <c>max(value × 1.5, floor)</c> ceilings (distance 100, duration 60 min, consumption 300) or fixed maxima
/// (max-speed <c>toSpeedDisplay(250)</c>, efficiency 30). All unit conversion happens here through
/// <see cref="UnitConverters"/> so changing the user's display unit re-projects correctly; every translatable
/// label resolves through the i18n facade using the keys the web source passes to <c>t()</c>. WinUI-free —
/// unit-tested without a UI host.
/// </summary>
public static class HeroGaugesProjection
{
    /// <summary>Headroom factor applied to a gauge value to derive its full-sweep maximum (web <c>× 1.5</c>).</summary>
    public const double GaugeHeadroom = 1.5;

    /// <summary>Full-sweep floor for the distance gauge (web <c>Math.max(..., 100)</c>).</summary>
    public const double DistanceFloor = 100;

    /// <summary>The raw value the web feeds <c>convertSpeedFromSI</c> for the max-speed gauge ceiling (web <c>250</c>).</summary>
    public const double MaxSpeedCeilingMps = 250;

    /// <summary>Full-sweep floor (minutes) for the duration gauge (web <c>Math.max(..., 60)</c>).</summary>
    public const double DurationFloorMinutes = 60;

    /// <summary>Full-sweep floor for the consumption gauge (web <c>Math.max(..., 300)</c>).</summary>
    public const double ConsumptionFloor = 300;

    /// <summary>Fixed full-sweep maximum for the efficiency gauge (web <c>max={30}</c>).</summary>
    public const double EfficiencyMax = 30;

    /// <summary>Kilometres per mile (web consumption imperial factor <c>× 1.609344</c>).</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>Global display precision the web <c>RadialGauge</c> falls back to for non-integer values (web <c>getGlobalPrecision()</c>).</summary>
    public const int DisplayPrecision = 2;

    /// <summary>The literal duration unit suffix the web grid passes the duration gauge.</summary>
    public const string DurationUnitSuffix = "min";

    private const double SecondsPerMinute = 60;
    private const double SecondsPerHour = 3600;
    private const double WattsPerKilowatt = 1000;

    /// <summary>Project <paramref name="drive"/> into the gauge display model using the user's units + i18n facade.</summary>
    /// <param name="drive">The canonical SI drive inputs.</param>
    /// <param name="units">The user's unit preference (distance + speed drive the conversions and suffixes).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The display-ready gauges plus the data flag and accessible name.</returns>
    public static HeroGaugesDisplay Project(DriveGauges drive, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(drive);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool imperial = units.Distance == DistanceUnit.Mi;

        double distanceDisplay = UnitConverters.DistanceFromSi(drive.DistanceM, units.Distance);
        var distance = Gauge(
            localizer.GetString("driveDetail.distance", "Distance"),
            Round(distanceDisplay),
            Math.Max(distanceDisplay * GaugeHeadroom, DistanceFloor),
            UnitLabels.Label(units.Distance),
            HeroGaugeAccent.Cyan);

        double maxSpeedDisplay = drive.MaxSpeedMps is { } mps ? UnitConverters.SpeedFromSi(mps, units.Speed) : 0;
        var maxSpeed = Gauge(
            localizer.GetString("driveDetail.maxSpeed", "Max Speed"),
            Round(maxSpeedDisplay),
            UnitConverters.SpeedFromSi(MaxSpeedCeilingMps, units.Speed),
            UnitLabels.Label(units.Speed),
            HeroGaugeAccent.Purple);

        double durationMinutes = drive.DurationS / SecondsPerMinute;
        var duration = Gauge(
            localizer.GetString("driveDetail.duration", "Duration"),
            Round(durationMinutes),
            Math.Max(durationMinutes * GaugeHeadroom, DurationFloorMinutes),
            DurationUnitSuffix,
            HeroGaugeAccent.Amber);

        double consumptionWhKm = ConsumptionWhKm(drive);
        double consumptionDisplay = imperial ? consumptionWhKm * KmPerMile : consumptionWhKm;
        var consumption = Gauge(
            localizer.GetString("driveDetail.consumption", "Consumption"),
            Round(consumptionDisplay),
            Math.Max(consumptionDisplay * GaugeHeadroom, ConsumptionFloor),
            imperial ? "Wh/mi" : "Wh/km",
            HeroGaugeAccent.Red);

        var gauges = new List<HeroGauge>(5) { distance, maxSpeed, duration, consumption };

        double? efficiency = EfficiencyPctPer100(drive, units);
        if (efficiency is { } pct)
        {
            gauges.Add(Gauge(
                localizer.GetString("driveDetail.efficiency", "Efficiency"),
                Math.Round(pct, DisplayPrecision, MidpointRounding.AwayFromZero),
                EfficiencyMax,
                imperial ? "%/100mi" : "%/100km",
                HeroGaugeAccent.Green));
        }

        return new HeroGaugesDisplay(
            drive.HasData,
            gauges,
            localizer.GetString("driveDetail.gauges.aria", "Drive statistics"));
    }

    /// <summary>
    /// The drive's energy consumption in Wh/km — the native port of the web <c>consumptionWhKm</c> derivation:
    /// energy is the reported <c>energyUsedWh</c>, or <c>|avgPower| × hours × 1000</c> where average power is the
    /// reported <c>avgPowerW</c> (kW) or the telemetry mean; consumption is energy over distance in km, or zero
    /// when the drive covered no distance.
    /// </summary>
    /// <param name="drive">The canonical SI drive inputs.</param>
    /// <returns>The consumption in watt-hours per kilometre.</returns>
    public static double ConsumptionWhKm(DriveGauges drive)
    {
        ArgumentNullException.ThrowIfNull(drive);

        double durationHours = drive.DurationS / SecondsPerHour;
        double avgPowerKw = drive.AvgPowerW is { } watts ? watts / WattsPerKilowatt : drive.FallbackAvgPowerKw;
        double energyWh = drive.EnergyUsedWh ?? (Math.Abs(avgPowerKw) * durationHours * WattsPerKilowatt);
        return drive.DistanceM > 0 ? energyWh / (drive.DistanceM / 1000.0) : 0;
    }

    /// <summary>
    /// The drive's battery efficiency in percent per 100 display-distance units — the native port of the web
    /// <c>efficiencyPctPer100</c>: <c>(startBatteryPct - endBatteryPct) / displayDistance × 10</c> when the drive
    /// covered distance and carries both battery endpoints, otherwise <see langword="null"/> (the web hides the
    /// gauge).
    /// </summary>
    /// <param name="drive">The canonical SI drive inputs.</param>
    /// <param name="units">The user's unit preference (distance drives the denominator conversion).</param>
    /// <returns>The efficiency value, or <see langword="null"/> when it cannot be computed.</returns>
    public static double? EfficiencyPctPer100(DriveGauges drive, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(drive);
        ArgumentNullException.ThrowIfNull(units);

        if (drive.DistanceM > 0 && drive.StartBatteryPct is { } start && drive.EndBatteryPct is { } end)
        {
            double displayDistance = UnitConverters.DistanceFromSi(drive.DistanceM, units.Distance);
            if (displayDistance != 0)
            {
                return (start - end) / displayDistance * 10.0;
            }
        }

        return null;
    }

    private static double Round(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

    private static HeroGauge Gauge(string label, double value, double max, string unit, HeroGaugeAccent accent)
    {
        int decimals = DecimalsFor(value, max);
        string formatted = ScalarFormatters.FormatNumber(value, decimals);
        string automation = string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, formatted)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, formatted, unit);
        return new HeroGauge(label, value, max, unit, decimals, accent, automation);
    }

    // web RadialGauge: d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision()). The web passes no
    // explicit decimals, so an integer (clamped) value shows none and a fractional one shows the global precision.
    private static int DecimalsFor(double value, double max)
    {
        double ceiling = max <= 0 ? value : max;
        double clamped = Math.Clamp(value, 0, ceiling);
        return clamped == Math.Floor(clamped) ? 0 : DisplayPrecision;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto projected
/// <c>RepositoryResult&lt;DriveGauges&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class HeroGaugesResultMapper
{
    /// <summary>Project <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The same emission with its drive body projected into a <see cref="DriveGauges"/>.</returns>
    public static RepositoryResult<DriveGauges> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DriveGauges Parse() => raw.HasValue ? DriveGauges.FromDriveJson(raw.Value) : DriveGauges.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DriveGauges>.Loading(),
            LoadStatus.Cached => RepositoryResult<DriveGauges>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DriveGauges>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DriveGauges>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DriveGauges>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DriveGauges>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DriveGauges>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
