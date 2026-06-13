using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One parsed drive row from <c>GET /drives?vehicle_id={id}</c> (web <c>useDrives</c>; generated
/// <see cref="TeslaSync.Windows.Generated.Api.Drive"/>). Every distance/speed/power/energy field is SI
/// (meters, m/s, watts, watt-hours) exactly as stored — conversion happens only at the render boundary.
/// Parsing is null-tolerant so a partial wire object never throws.
/// </summary>
public sealed record DriveSample(
    long Id,
    DateTimeOffset StartTs,
    DateTimeOffset? EndTs,
    double DistanceM,
    double DurationS,
    double? MaxSpeedMps,
    double? AvgSpeedMps,
    long? StartBatteryPct,
    long? EndBatteryPct,
    string? StartAddress,
    string? EndAddress,
    double? OutsideTempAvgC,
    double? AvgPowerW,
    double? EnergyUsedWh)
{
    /// <summary>Project one drive JSON object into a tolerant sample (mirrors the web <c>Drive</c> interface).</summary>
    public static DriveSample FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DriveSample(0, default, null, 0, 0, null, null, null, null, null, null, null, null, null);
        }

        return new DriveSample(
            Id: DriveScoreJson.Long(element, "id") ?? 0,
            StartTs: DriveScoreJson.Date(element, "start_ts") ?? default,
            EndTs: DriveScoreJson.Date(element, "end_ts"),
            DistanceM: DriveScoreJson.Double(element, "distance_m") ?? 0,
            DurationS: DriveScoreJson.Double(element, "duration_s") ?? 0,
            MaxSpeedMps: DriveScoreJson.Double(element, "max_speed_mps"),
            AvgSpeedMps: DriveScoreJson.Double(element, "avg_speed_mps"),
            StartBatteryPct: DriveScoreJson.Long(element, "start_battery_pct"),
            EndBatteryPct: DriveScoreJson.Long(element, "end_battery_pct"),
            StartAddress: DriveScoreJson.String(element, "start_address"),
            EndAddress: DriveScoreJson.String(element, "end_address"),
            OutsideTempAvgC: DriveScoreJson.Double(element, "outside_temp_avg_c"),
            AvgPowerW: DriveScoreJson.Double(element, "avg_power_w"),
            EnergyUsedWh: DriveScoreJson.Double(element, "energy_used_wh"));
    }
}

/// <summary>
/// The optional server-side drive-score envelope from <c>GET /drives/score</c> (web <c>useDriveScore</c> →
/// <c>DriveScore</c> in web/src/types/driving.ts). It is best-effort: when the read is absent or fails the page
/// falls back to the client-computed averages, so every field is nullable / defaulted.
/// </summary>
public sealed record ApiDriveScore(
    double? Overall,
    double? Efficiency,
    double? Smoothness,
    double? SpeedDiscipline,
    string? Grade,
    int? TotalDrives,
    string? Trend)
{
    /// <summary>Parse the score JSON object, or null when the body is not an object.</summary>
    public static ApiDriveScore? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ApiDriveScore(
            Overall: DriveScoreJson.Double(element, "overall"),
            Efficiency: DriveScoreJson.Double(element, "efficiency"),
            Smoothness: DriveScoreJson.Double(element, "smoothness"),
            SpeedDiscipline: DriveScoreJson.Double(element, "speedDiscipline") ?? DriveScoreJson.Double(element, "speed_discipline"),
            Grade: DriveScoreJson.String(element, "grade"),
            TotalDrives: (int?)DriveScoreJson.Long(element, "totalDrives") ?? (int?)DriveScoreJson.Long(element, "total_drives"),
            Trend: DriveScoreJson.String(element, "trend"));
    }
}

/// <summary>
/// The two-source snapshot the page binds to: the parsed drive list (primary, web <c>useDrives</c>) plus the
/// optional server score (web <c>useDriveScore</c>). <see cref="HasData"/> is true once at least one drive is
/// present — the score alone never satisfies the page because every panel is computed from the drives.
/// </summary>
public sealed record DriveScoreSnapshot(IReadOnlyList<DriveSample> Drives, ApiDriveScore? Score)
{
    /// <summary>The empty snapshot (web disabled / no-vehicle query).</summary>
    public static DriveScoreSnapshot Empty { get; } = new(Array.Empty<DriveSample>(), null);

    /// <summary>True when at least one drive row is present.</summary>
    public bool HasData => Drives.Count > 0;

    /// <summary>Compose the snapshot from the two independent reads.</summary>
    public static DriveScoreSnapshot Compose(IReadOnlyList<DriveSample>? drives, ApiDriveScore? score) =>
        new(drives ?? Array.Empty<DriveSample>(), score);
}

/// <summary>The parsed snapshot plus the page lifecycle flags (loading / error) the projection folds into a state.</summary>
public sealed record DriveScoreModel(DriveScoreSnapshot Snapshot, bool Loading, string? ErrorDetail);

/// <summary>The four top-level data states (web loading / empty / error / success branches).</summary>
public enum DriveScoreState
{
    Loading,
    Empty,
    Error,
    Success,
}

/// <summary>
/// One drive's computed 0–100 score (web <c>scoreDrive</c>). <see cref="Total"/> is the sum of the three
/// category sub-scores (efficiency /40, smoothness /30, speed /30); <see cref="WhPerKm"/> is the derived SI
/// consumption used by the consumption columns.
/// </summary>
public readonly record struct ComputedScore(int Total, int Efficiency, int Smoothness, int Speed, string Grade, double WhPerKm);

/// <summary>One scored drive: the sample plus its <see cref="ComputedScore"/>.</summary>
public readonly record struct ScoredDrive(DriveSample Drive, ComputedScore Score);

/// <summary>
/// Pure scoring + grading maths — a 1:1 port of the web <c>scoreDrive</c> / grade ladder so a drive scores the
/// same number on Windows as it does on the web. No UI, no i18n: fully unit-testable.
/// </summary>
public static class ScoreMath
{
    private const double MphPerMps = 2.2369362920544;

    /// <summary>Score one drive into its category sub-scores, total, grade and SI consumption.</summary>
    public static ComputedScore ScoreDrive(DriveSample d)
    {
        double battUsed = (d.StartBatteryPct ?? 50) - (d.EndBatteryPct ?? 45);
        double energyKwh = d.EnergyUsedWh is { } wh ? wh / 1000.0 : (battUsed / 100.0) * 75.0;
        double distanceKm = d.DistanceM / 1000.0;
        double whPerKm = distanceKm > 0 ? (energyKwh * 1000.0) / distanceKm : 200.0;

        double effScore = Math.Max(0, Math.Min(40, 40 - (whPerKm - 130) / 3.0));
        double avgPowerKw = d.AvgPowerW is { } pw ? pw / 1000.0 : 30.0;
        double smoothScore = Math.Max(0, Math.Min(30, 30 - avgPowerKw / 3.0));
        double maxSpeedMph = d.MaxSpeedMps is { } ms ? ms * MphPerMps : 80.0;
        double speedScore = Math.Max(0, Math.Min(30, 30 - Math.Max(0, maxSpeedMph - 90) / 2.0));

        int total = (int)Math.Round(effScore + smoothScore + speedScore, MidpointRounding.AwayFromZero);
        return new ComputedScore(
            total,
            (int)Math.Round(effScore, MidpointRounding.AwayFromZero),
            (int)Math.Round(smoothScore, MidpointRounding.AwayFromZero),
            (int)Math.Round(speedScore, MidpointRounding.AwayFromZero),
            GradeFromTotal(total),
            Math.Round(whPerKm, MidpointRounding.AwayFromZero));
    }

    /// <summary>The web grade ladder (90 A+, 80 A, 70 B, 60 C, 50 D, else F).</summary>
    public static string GradeFromTotal(double total) =>
        total >= 90 ? "A+"
        : total >= 80 ? "A"
        : total >= 70 ? "B"
        : total >= 60 ? "C"
        : total >= 50 ? "D"
        : "F";

    /// <summary>Web <c>gradeVariant</c> → semantic status (A+/A success, B info, C warning, else danger).</summary>
    public static StatusKind GradeStatus(string grade) => grade switch
    {
        "A+" or "A" => StatusKind.Success,
        "B" => StatusKind.Info,
        "C" => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>Web <c>scoreTextClass</c> → status for a numeric score (≥80 success, ≥60 warning, else danger).</summary>
    public static StatusKind ScoreStatus(double? score) => score switch
    {
        null => StatusKind.Neutral,
        >= 80 => StatusKind.Success,
        >= 60 => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>Categorical chart palette index for a grade (drives the trend-line + gauge colours).</summary>
    public static int GradeColorIndex(string grade) => grade switch
    {
        "A+" or "A" => 1,
        "B" => 0,
        "C" => 3,
        "D" => 6,
        _ => 5,
    };
}

/// <summary>Null-tolerant readers for the snake_case drive JSON (no camelCaseKeys transform on native).</summary>
internal static class DriveScoreJson
{
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static long? Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)Math.Round(d, MidpointRounding.AwayFromZero),
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? s = v.GetString();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        return null;
    }

    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto;
        }

        return null;
    }

    /// <summary>The drives list wire shape is either a bare array or <c>{ "drives": [...] }</c>.</summary>
    public static IReadOnlyList<DriveSample> ParseDrives(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("drives", out var inner))
        {
            array = inner;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveSample>();
        }

        var list = new List<DriveSample>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            list.Add(DriveSample.FromJson(item));
        }

        return list;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DriveScorePage</c> surface (P1/S11). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a score, distance, address or grade — so a
/// diagnostics line can never leak a user's driving record. Thread-safe.
/// </summary>
public sealed class DriveScoreDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveScoreDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveScorePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveScoreRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DriveScorePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/driving/pages/DriveScorePage.tsx</c> (route <c>/drive-score</c>, nav name
/// <c>DriveScore</c>). Holds the route name, the two generated operation ids it binds to, the diagnostics slug
/// and the empty-surface glyph.
/// </summary>
public static class DriveScoreRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveScorePage";

    /// <summary>The navigation route name (matches <c>RouteTable</c> → <c>drive-score</c>).</summary>
    public const string RouteName = "DriveScore";

    /// <summary>The generated operation id for the drive list read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = "get_api_v1_drives";

    /// <summary>The generated operation id for the optional server score read (web <c>useDriveScore</c>).</summary>
    public const string ScoreOperation = "get_api_v1_drives_score";

    /// <summary>Segoe Fluent glyph for the page-level empty surface (Speedometer).</summary>
    public const string EmptyGlyph = DriveScoreProjection.GaugeGlyph;
}
