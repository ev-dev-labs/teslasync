using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Driving-Dynamics page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the
/// page tolerates undefined fields with <c>?? 0</c>). WinUI-free so the parse is unit-tested without a UI host.
/// Reads the snake_case wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class DynamicsJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The first non-null numeric value across <paramref name="names"/> (snake_case then camelCase).</summary>
    public static double? Double(JsonElement obj, string snake, string camel) =>
        Double(obj, snake) ?? Double(obj, camel);

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or null when absent / non-boolean.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    /// <summary>The string value of <paramref name="name"/>, or null when absent / non-string.</summary>
    public static string? Text(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return prop.GetString();
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    /// <summary>Enumerate the array property <paramref name="name"/>, or an empty sequence when absent.</summary>
    public static IEnumerable<JsonElement> Array(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(name, out var prop)
            && prop.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in prop.EnumerateArray())
            {
                yield return item;
            }
        }
    }
}

/// <summary>
/// One motor telemetry reading from <c>GET /motor</c> / <c>GET /motor/latest</c> (web <c>MotorSnapshot</c>),
/// narrowed to the fields the Driving-Dynamics page reads. Torque is N·m, RPM is rev/min, temperature is SI
/// Celsius, power and regen are kW (the wire already carries kW for these two fields — web parity: rendered
/// verbatim with a "kW" suffix, never re-converted). Pure data — no WinUI types.
/// </summary>
public sealed record MotorReading(
    DateTimeOffset? Ts,
    double? TorqueFront,
    double? TorqueRear,
    double? RpmFront,
    double? RpmRear,
    double? TempFrontC,
    double? TempRearC,
    double? PowerKw,
    double? RegenKw,
    string? ShiftState)
{
    /// <summary>Project a single motor JSON object into a tolerant reading (non-object → null).</summary>
    public static MotorReading? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MotorReading(
            Ts: DynamicsJson.Instant(element, "ts") ?? DynamicsJson.Instant(element, "created_at"),
            TorqueFront: DynamicsJson.Double(element, "torque_nm_front", "torqueNmFront"),
            TorqueRear: DynamicsJson.Double(element, "torque_nm_rear", "torqueNmRear"),
            RpmFront: DynamicsJson.Double(element, "motor_rpm_front", "motorRpmFront"),
            RpmRear: DynamicsJson.Double(element, "motor_rpm_rear", "motorRpmRear"),
            TempFrontC: DynamicsJson.Double(element, "motor_temp_c_front", "motorTempCFront"),
            TempRearC: DynamicsJson.Double(element, "motor_temp_c_rear", "motorTempCRear"),
            PowerKw: DynamicsJson.Double(element, "power_kw", "powerKw"),
            RegenKw: DynamicsJson.Double(element, "regen_kw", "regenKw"),
            ShiftState: DynamicsJson.Text(element, "shift_state") ?? DynamicsJson.Text(element, "shiftState"));
    }

    /// <summary>The latest snapshot of a <c>GET /motor/latest</c> body (object → reading, else null).</summary>
    public static MotorReading? FromResponse(JsonElement element) => FromJson(element);

    /// <summary>Front + rear torque (web <c>torque_nm_front + torque_nm_rear</c>), nulls treated as zero.</summary>
    public double TorqueTotal => (TorqueFront ?? 0) + (TorqueRear ?? 0);

    /// <summary>The hotter of the two motor temperatures in °C, or null when both are absent (web <c>Math.max</c>).</summary>
    public double? MotorTempC
    {
        get
        {
            if (TempFrontC is null && TempRearC is null)
            {
                return null;
            }

            return Math.Max(TempFrontC ?? double.NegativeInfinity, TempRearC ?? double.NegativeInfinity);
        }
    }

    /// <summary>Parse a <c>GET /motor</c> JSON array into the tolerant reading list (non-array body → empty).</summary>
    public static IReadOnlyList<MotorReading> ParseHistory(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<MotorReading>();
        }

        var readings = new List<MotorReading>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (MotorReading.FromJson(item) is { } reading)
            {
                readings.Add(reading);
            }
        }

        return readings;
    }
}

/// <summary>
/// One drive row from <c>GET /drives</c> (web <c>Drive</c>), narrowed to the fields the Driving-Dynamics page
/// reads (the Speed &amp; Gear and Drive-Analytics sections). Distance is SI meters, speed is SI m/s and power
/// is SI watts exactly as the API stores them; conversion happens at the display boundary only. Pure data.
/// </summary>
public sealed record DriveRow(
    long Id,
    DateTimeOffset? StartTs,
    double DistanceM,
    double? AvgSpeedMps,
    double? MaxSpeedMps,
    double? AvgPowerW)
{
    /// <summary>Project a single drive JSON object into a tolerant drive record.</summary>
    public static DriveRow FromJson(JsonElement element)
    {
        return new DriveRow(
            Id: DynamicsJson.Long(element, "id") ?? 0,
            StartTs: DynamicsJson.Instant(element, "start_ts") ?? DynamicsJson.Instant(element, "startTs"),
            DistanceM: DynamicsJson.Double(element, "distance_m", "distanceM") ?? 0,
            AvgSpeedMps: DynamicsJson.Double(element, "avg_speed_mps", "avgSpeedMps"),
            MaxSpeedMps: DynamicsJson.Double(element, "max_speed_mps", "maxSpeedMps"),
            AvgPowerW: DynamicsJson.Double(element, "avg_power_w", "avgPowerW"));
    }

    /// <summary>The inclusive <c>yyyy-MM-dd</c> day of the drive start (web <c>startTs?.slice(0, 10)</c>).</summary>
    public string StartDay => StartTs?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty;

    /// <summary>Parse a <c>GET /drives</c> JSON array into the tolerant drive list (non-array body → empty).</summary>
    public static IReadOnlyList<DriveRow> ParseDrives(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<DriveRow>();
        }

        var drives = new List<DriveRow>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                drives.Add(DriveRow.FromJson(item));
            }
        }

        return drives;
    }
}

/// <summary>
/// The latest drive-dynamics telemetry from <c>GET /drive-dynamics/latest</c> (web <c>useDriveDynamicsLatest</c>):
/// the lateral / longitudinal acceleration (g) the G-Force panel reads and the pedal-position / brake telemetry
/// the Pedal-Usage panel reads. Every field is nullable so a partial body degrades each readout to a dash.
/// </summary>
public sealed record DriveDynamicsReading(
    double? LateralAcceleration,
    double? LongitudinalAcceleration,
    double? PedalPosition,
    double? BrakePedalPosition,
    bool? BrakePedalActive)
{
    /// <summary>The zero-information reading (no g-force / pedal data) — every section falls back to empty.</summary>
    public static DriveDynamicsReading Empty { get; } = new(null, null, null, null, null);

    /// <summary>Project the <c>GET /drive-dynamics/latest</c> JSON object into a tolerant reading.</summary>
    public static DriveDynamicsReading FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new DriveDynamicsReading(
            LateralAcceleration: DynamicsJson.Double(element, "lateral_acceleration", "lateralAcceleration"),
            LongitudinalAcceleration: DynamicsJson.Double(element, "longitudinal_acceleration", "longitudinalAcceleration"),
            PedalPosition: DynamicsJson.Double(element, "pedal_position", "pedalPosition"),
            BrakePedalPosition: DynamicsJson.Double(element, "brake_pedal_position", "brakePedalPosition"),
            BrakePedalActive: DynamicsJson.Bool(element, "brake_pedal_active") ?? DynamicsJson.Bool(element, "brakePedalActive"));
    }

    /// <summary>True when at least one g-force axis is present (web <c>hasAny</c> in GForcePanel).</summary>
    public bool HasGForce => LateralAcceleration is not null || LongitudinalAcceleration is not null;

    /// <summary>The combined g magnitude (web <c>sqrt(lat² + long²)</c>), null unless both axes are present.</summary>
    public double? CombinedG =>
        LateralAcceleration is { } lat && LongitudinalAcceleration is { } lon
            ? Math.Sqrt((lat * lat) + (lon * lon))
            : null;

    /// <summary>True when any pedal signal is present (web <c>hasAny</c> in PedalUsage).</summary>
    public bool HasPedal => PedalPosition is not null || BrakePedalPosition is not null || BrakePedalActive is not null;
}

/// <summary>
/// The autopilot / cruise readout the page composes from three reads (web <c>AutopilotSection</c>): the current
/// SI m/s speed from <c>GET /vehicles/{id}/state</c>, the SI m/s cruise set-speed from the
/// <c>CruiseSetSpeed</c> signal-observation, and the bar-count follow distance parsed from the
/// <c>CruiseFollowDistance</c> enum observation. Every field is nullable.
/// </summary>
public sealed record AutopilotReading(double? SpeedMps, double? CruiseSetMps, string? FollowDistance)
{
    /// <summary>The zero-information autopilot reading — the section falls back to empty.</summary>
    public static AutopilotReading Empty { get; } = new(null, null, null);

    /// <summary>True when any of the three values is present (web <c>hasAny</c> in AutopilotSection).</summary>
    public bool HasAny => SpeedMps is not null || CruiseSetMps is not null || FollowDistance is not null;

    /// <summary>
    /// Peel the bar-count suffix off a Tesla <c>FollowDistance7</c> enum string (web <c>parseFollowDistance</c>);
    /// returns the raw string when it carries no trailing digits, or null when absent.
    /// </summary>
    public static string? ParseFollowDistance(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        int i = raw.Length;
        while (i > 0 && char.IsDigit(raw[i - 1]))
        {
            i--;
        }

        string digits = raw[i..];
        return digits.Length > 0 ? digits : raw;
    }
}

/// <summary>One pattern indicator row in the Driving-Coach section (web <c>patterns</c> map item).</summary>
public sealed record CoachPattern(string Key, double Value, double Lo, double Hi);

/// <summary>One weekly-trend point in the Driving-Coach section (web <c>weekly_trend</c> item).</summary>
public sealed record CoachWeeklyPoint(string Week, double Score);

/// <summary>One recommendation in the Driving-Coach section (web <c>recommendations</c> item).</summary>
public sealed record CoachRecommendation(string Impact, string Tip);

/// <summary>One per-drive score row in the Driving-Coach section (web <c>per_drive_scores</c> item).</summary>
public sealed record CoachDriveScore(long DriveId, string Date, double Score, string Style, double Efficiency, double Distance);

/// <summary>
/// The driving-coach rollup from <c>GET /analytics/driving-coach</c> (web <c>DrivingCoachData</c>,
/// <c>useDrivingCoach</c>). Efficiency is Wh/km and the score / percentage fields are dimensionless. Parsing is
/// null-tolerant so a partial body never throws. Pure data — no WinUI types.
/// </summary>
public sealed record CoachData(
    double OverallScore,
    double EfficiencyWhKm,
    double BestEfficiencyWhKm,
    int TotalDrivesAnalyzed,
    int EfficientCount,
    int ModerateCount,
    int AggressiveCount,
    double HardAccelPct,
    double HardBrakePct,
    double HighwayPct,
    double ShortTripPct,
    double ColdStartPct,
    IReadOnlyList<CoachWeeklyPoint> WeeklyTrend,
    IReadOnlyList<CoachRecommendation> Recommendations,
    IReadOnlyList<CoachDriveScore> PerDriveScores)
{
    /// <summary>Project the <c>GET /analytics/driving-coach</c> JSON object into a tolerant rollup (non-object → null).</summary>
    public static CoachData? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        int StyleCount(string key)
        {
            if (element.TryGetProperty("style_breakdown", out var sb) && sb.ValueKind == JsonValueKind.Object)
            {
                return (int)(DynamicsJson.Double(sb, key) ?? 0);
            }

            return 0;
        }

        double Pattern(string key)
        {
            if (element.TryGetProperty("patterns", out var p) && p.ValueKind == JsonValueKind.Object)
            {
                return DynamicsJson.Double(p, key) ?? 0;
            }

            return 0;
        }

        var weekly = new List<CoachWeeklyPoint>();
        foreach (var w in DynamicsJson.Array(element, "weekly_trend"))
        {
            weekly.Add(new CoachWeeklyPoint(
                DynamicsJson.Text(w, "week") ?? string.Empty,
                DynamicsJson.Double(w, "score") ?? 0));
        }

        var recs = new List<CoachRecommendation>();
        foreach (var r in DynamicsJson.Array(element, "recommendations"))
        {
            recs.Add(new CoachRecommendation(
                DynamicsJson.Text(r, "impact") ?? "low",
                DynamicsJson.Text(r, "tip") ?? string.Empty));
        }

        var scores = new List<CoachDriveScore>();
        foreach (var s in DynamicsJson.Array(element, "per_drive_scores"))
        {
            scores.Add(new CoachDriveScore(
                DynamicsJson.Long(s, "drive_id") ?? 0,
                DynamicsJson.Text(s, "date") ?? string.Empty,
                DynamicsJson.Double(s, "score") ?? 0,
                DynamicsJson.Text(s, "style") ?? "moderate",
                DynamicsJson.Double(s, "efficiency") ?? 0,
                DynamicsJson.Double(s, "distance") ?? 0));
        }

        return new CoachData(
            OverallScore: DynamicsJson.Double(element, "overall_score", "overallScore") ?? 0,
            EfficiencyWhKm: DynamicsJson.Double(element, "efficiency_wh_km", "efficiencyWhKm") ?? 0,
            BestEfficiencyWhKm: DynamicsJson.Double(element, "best_efficiency_wh_km", "bestEfficiencyWhKm") ?? 0,
            TotalDrivesAnalyzed: (int)(DynamicsJson.Double(element, "total_drives_analyzed", "totalDrivesAnalyzed") ?? 0),
            EfficientCount: StyleCount("efficient"),
            ModerateCount: StyleCount("moderate"),
            AggressiveCount: StyleCount("aggressive"),
            HardAccelPct: Pattern("hard_accel_pct"),
            HardBrakePct: Pattern("hard_brake_pct"),
            HighwayPct: Pattern("highway_pct"),
            ShortTripPct: Pattern("short_trip_pct"),
            ColdStartPct: Pattern("cold_start_pct"),
            WeeklyTrend: weekly,
            Recommendations: recs,
            PerDriveScores: scores);
    }
}

/// <summary>
/// Cross-section motor statistics computed from the motor history (web <c>computeMotorStats</c>). Drives the
/// Motor-Efficiency-Insights, Summary-Stats and Driving-Tips sections. Pure data — no WinUI types.
/// </summary>
public sealed record MotorStats(
    int TotalReadings,
    double AvgTorque,
    double MaxTorque,
    double AvgMotorTemp,
    double MaxMotorTemp,
    double AvgPower,
    double PeakPower,
    double MinPower,
    double PeakRegen,
    double HighTorquePct)
{
    /// <summary>Compute the cross-section stats from the motor history, or null when there are no readings.</summary>
    public static MotorStats? Compute(IReadOnlyList<MotorReading> history)
    {
        if (history.Count == 0)
        {
            return null;
        }

        var torques = new List<double>();
        var motorTemps = new List<double>();
        var powers = new List<double>();
        var regens = new List<double>();

        foreach (var r in history)
        {
            if (r.TorqueFront is not null || r.TorqueRear is not null)
            {
                torques.Add((r.TorqueFront ?? 0) + (r.TorqueRear ?? 0));
            }

            if (r.MotorTempC is { } temp && !double.IsInfinity(temp))
            {
                motorTemps.Add(temp);
            }

            if (r.PowerKw is { } p)
            {
                powers.Add(p);
            }

            if (r.RegenKw is { } rg)
            {
                regens.Add(rg);
            }
        }

        static double Avg(List<double> a) => a.Count > 0 ? a.Sum() / a.Count : 0;
        static double Max(List<double> a) => a.Count > 0 ? a.Max() : 0;
        static double Min(List<double> a) => a.Count > 0 ? a.Min() : 0;

        double highTorquePct = torques.Count > 0
            ? (double)torques.Count(t => t > 200) / torques.Count * 100
            : 0;

        return new MotorStats(
            TotalReadings: history.Count,
            AvgTorque: Avg(torques),
            MaxTorque: Max(torques),
            AvgMotorTemp: Avg(motorTemps),
            MaxMotorTemp: Max(motorTemps),
            AvgPower: Avg(powers),
            PeakPower: Max(powers),
            MinPower: Min(powers),
            PeakRegen: Max(regens),
            HighTorquePct: highTorquePct);
    }

    /// <summary>The semantic throttle style from average power (web <c>getThrottleStyle</c>).</summary>
    public ThrottleStyle Style =>
        AvgPower < 20 ? ThrottleStyle.Conservative
        : AvgPower < 80 ? ThrottleStyle.Moderate
        : ThrottleStyle.Aggressive;
}

/// <summary>The throttle-style band derived from average power (web <c>ThrottleStyle</c>).</summary>
public enum ThrottleStyle
{
    /// <summary>Average power &lt; 20 kW — gentle, range-maximising inputs.</summary>
    Conservative,

    /// <summary>Average power 20–80 kW — typical mixed driving.</summary>
    Moderate,

    /// <summary>Average power ≥ 80 kW — spirited, energy-hungry driving.</summary>
    Aggressive,
}

/// <summary>
/// The composite snapshot the page binds to: the seven web data sources the Driving-Dynamics page and its
/// children read — the latest motor reading (primary, gates loading → success exactly as the web page gates on
/// <c>motorLoading</c>), the motor history, the drive list, the driving-coach rollup, the latest drive-dynamics
/// telemetry and the autopilot reading. <see cref="Loaded"/> flips true once a fetch completes.
/// </summary>
public sealed record DrivingDynamicsSnapshot(
    bool Loaded,
    MotorReading? MotorLatest,
    IReadOnlyList<MotorReading> MotorHistory,
    IReadOnlyList<DriveRow> Drives,
    CoachData? Coach,
    DriveDynamicsReading DriveDynamics,
    AutopilotReading Autopilot)
{
    /// <summary>The empty snapshot (no fetch completed) — the page-level loading surface.</summary>
    public static DrivingDynamicsSnapshot Empty { get; } = new(
        false,
        null,
        System.Array.Empty<MotorReading>(),
        System.Array.Empty<DriveRow>(),
        null,
        DriveDynamicsReading.Empty,
        AutopilotReading.Empty);

    /// <summary>Compose a loaded snapshot from the seven parsed reads (every section degrades independently).</summary>
    public static DrivingDynamicsSnapshot Compose(
        MotorReading? motorLatest,
        IReadOnlyList<MotorReading> motorHistory,
        IReadOnlyList<DriveRow> drives,
        CoachData? coach,
        DriveDynamicsReading driveDynamics,
        AutopilotReading autopilot) =>
        new(true, motorLatest, motorHistory, drives, coach, driveDynamics, autopilot);
}

/// <summary>The seven-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IDrivingDynamicsFeed
{
    /// <summary>Fetch every Driving-Dynamics source for the active vehicle over the active date range.</summary>
    Task<DrivingDynamicsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyDrivingDynamicsFeed : IDrivingDynamicsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDrivingDynamicsFeed Instance { get; } = new();

    private EmptyDrivingDynamicsFeed()
    {
    }

    /// <inheritdoc />
    public Task<DrivingDynamicsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(DrivingDynamicsSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / error / success).</summary>
public enum DrivingDynamicsState
{
    /// <summary>The primary motor query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>The primary motor query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The motor query resolved — the full page content (each section shows its own empty state).</summary>
    Success,
}
