using System.Globalization;
using System.Text.Json;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The four mutually-exclusive top-level data states the <c>DrivetrainHealthPage</c> renders — the native union
/// of the web page's branches (web/src/features/driving/pages/DrivetrainHealthPage.tsx): the
/// <see cref="Loading"/> skeleton while <c>useDrivetrainHealth</c> is first in flight, the retriable
/// <see cref="Error"/> surface (the native-parity addition over the web's <c>error={null}</c>), the
/// friendly <see cref="Empty"/> surface for the web <c>health ? … : &lt;EmptyState/&gt;</c> gate, and the
/// populated <see cref="Success"/> composition. None is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum DrivetrainHealthPageState
{
    /// <summary>The drivetrain-health query is in flight and no snapshot has arrived yet.</summary>
    Loading,

    /// <summary>A resolved snapshot with no drivetrain-health body — the friendly empty surface.</summary>
    Empty,

    /// <summary>The drivetrain-health read failed with no cached snapshot — the retry affordance.</summary>
    Error,

    /// <summary>A resolved snapshot carrying a drivetrain-health body — the full composition.</summary>
    Success,
}

/// <summary>
/// One parsed recent-drive row from <c>GET /drives?vehicle_id={id}</c> (web <c>useDrives</c>), narrowed to the
/// fields the Drivetrain-Health page's <c>chartData</c> / <c>peakPower</c> memos read. Every distance/power
/// field is SI (meters, watts) exactly as stored — conversion happens only at the render boundary. Parsing is
/// null-tolerant so a partial wire object never throws.
/// </summary>
/// <param name="StartTs">Drive start timestamp (web <c>startTs</c>).</param>
/// <param name="DistanceM">Drive distance in SI meters (web <c>distanceM</c>).</param>
/// <param name="OutsideTempAvgC">Average outside temperature in SI Celsius, or null (web <c>outsideTempAvgC</c>).</param>
/// <param name="AvgPowerW">Average drive power in SI watts, or null (web <c>avgPowerW</c>).</param>
public sealed record DrivetrainDriveSample(
    DateTimeOffset StartTs,
    double DistanceM,
    double? OutsideTempAvgC,
    double? AvgPowerW)
{
    /// <summary>Project one drive JSON object into a tolerant sample (mirrors the web <c>Drive</c> interface).</summary>
    public static DrivetrainDriveSample FromJson(JsonElement element) => new(
        StartTs: DrivetrainHealthJson.Date(element, "start_ts") ?? default,
        DistanceM: DrivetrainHealthJson.Double(element, "distance_m") ?? 0,
        OutsideTempAvgC: DrivetrainHealthJson.Double(element, "outside_temp_avg_c"),
        AvgPowerW: DrivetrainHealthJson.Double(element, "avg_power_w"));
}

/// <summary>
/// One parsed motor-history row from <c>GET /motor?vehicle_id={id}&amp;limit={limit}</c> (web
/// <c>useMotorHistory</c>), narrowed to the fields the page's <c>motorChartData</c> memo reads. Temperatures
/// are SI Celsius and torques SI newton-metres; every field is nullable so a missing key becomes a chart gap
/// rather than a misleading zero.
/// </summary>
/// <param name="Ts">Raw ISO sample timestamp, or null (web <c>ts</c>).</param>
/// <param name="MotorTempCFront">Front-motor temperature in SI Celsius, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCRear">Rear-motor temperature in SI Celsius, or null (web <c>motor_temp_c_rear</c>).</param>
/// <param name="InverterTempC">Inverter temperature in SI Celsius, or null (web <c>inverter_temp_c</c>).</param>
/// <param name="TorqueNmFront">Front-axle torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
public sealed record DrivetrainMotorSample(
    string? Ts,
    double? MotorTempCFront,
    double? MotorTempCRear,
    double? InverterTempC,
    double? TorqueNmFront,
    double? TorqueNmRear)
{
    /// <summary>Project one motor-history JSON object into a tolerant sample.</summary>
    public static DrivetrainMotorSample FromJson(JsonElement element) => new(
        Ts: DrivetrainHealthJson.String(element, "ts"),
        MotorTempCFront: DrivetrainHealthJson.Double(element, "motor_temp_c_front"),
        MotorTempCRear: DrivetrainHealthJson.Double(element, "motor_temp_c_rear"),
        InverterTempC: DrivetrainHealthJson.Double(element, "inverter_temp_c"),
        TorqueNmFront: DrivetrainHealthJson.Double(element, "torque_nm_front"),
        TorqueNmRear: DrivetrainHealthJson.Double(element, "torque_nm_rear"));
}

/// <summary>
/// The lifetime driving-stats slice the page reads from <c>GET /drives/stats?vehicle_id={id}</c> (web
/// <c>useDrivingStats</c>), narrowed to the fields the Drivetrain-Health children consume (the
/// <c>HealthGaugeGrid</c> drive-statistics tile, the <c>ThermalLoadPanel</c> Drives / Regen tiles and the
/// <c>DetailCards</c> Regen-Energy / CO₂ rows). The unit-named figures stay in the web's raw form (km, km/h,
/// Wh, kg) and are converted only at the render boundary. Snake_case keys match the Go handler's wire shape.
/// </summary>
/// <param name="TotalDrives">Lifetime drive count (web <c>totalDrives</c>).</param>
/// <param name="TotalDistanceKm">Lifetime distance in km the children feed to <c>convertDistanceFromSI</c> (web <c>totalDistanceKm</c>).</param>
/// <param name="AvgSpeedKmh">Average speed in km/h (web <c>avgSpeedKmh</c>).</param>
/// <param name="TopSpeedKmh">Top speed in km/h (web <c>topSpeedKmh</c>).</param>
/// <param name="RegenRatio">Regen ratio as a 0..1 fraction (web <c>regenRatio</c>).</param>
/// <param name="RegenEnergyWh">Lifetime regen energy in Wh, or null (web <c>regenEnergyWh</c>).</param>
/// <param name="Co2SavedKg">Lifetime CO₂ saved in kg, or null (web <c>co2SavedKg</c>).</param>
public sealed record DrivetrainStatsSlice(
    double TotalDrives,
    double TotalDistanceKm,
    double AvgSpeedKmh,
    double TopSpeedKmh,
    double RegenRatio,
    double? RegenEnergyWh,
    double? Co2SavedKg)
{
    /// <summary>Project a <c>/drives/stats</c> JSON object into a tolerant slice, or null when the body is not an object.</summary>
    public static DrivetrainStatsSlice? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DrivetrainStatsSlice(
            TotalDrives: DrivetrainHealthJson.Double(element, "total_drives") ?? 0,
            TotalDistanceKm: DrivetrainHealthJson.Double(element, "total_distance_km") ?? 0,
            AvgSpeedKmh: DrivetrainHealthJson.Double(element, "avg_speed_kmh") ?? 0,
            TopSpeedKmh: DrivetrainHealthJson.Double(element, "top_speed_kmh") ?? 0,
            RegenRatio: DrivetrainHealthJson.Double(element, "regen_ratio") ?? 0,
            RegenEnergyWh: DrivetrainHealthJson.Double(element, "regen_energy_wh"),
            Co2SavedKg: DrivetrainHealthJson.Double(element, "co2_saved_kg"));
    }
}

/// <summary>
/// The fully parsed five-source snapshot the page binds to — the native analogue of everything the web page's
/// hooks return before the JSX builds its child props: the drivetrain-health body (the gating read, web
/// <c>useDrivetrainHealth</c>), the recent-drives list (web <c>useDrives</c>), the lifetime driving stats (web
/// <c>useDrivingStats</c>), the motor-history series (web <c>useMotorHistory</c>) and the latest live-motor
/// reading (web <c>useMotorLatest</c>). <see cref="HasHealth"/> reproduces the web <c>health ?</c> truthiness
/// gate — the four temperatures, motor status and overall health seed every health child. Parsing is
/// null-tolerant so a partial body never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="HasHealth">Whether the drivetrain-health read returned a body (web <c>health</c> truthy).</param>
/// <param name="FrontMotorTempC">Front-motor temperature in SI Celsius, or null (web <c>frontMotorTempC</c>).</param>
/// <param name="RearMotorTempC">Rear-motor temperature in SI Celsius, or null (web <c>rearMotorTempC</c>).</param>
/// <param name="InverterTempC">Inverter temperature in SI Celsius, or null (web <c>inverterTempC</c>).</param>
/// <param name="BatteryTempC">Battery temperature in SI Celsius, or null (web <c>batteryTempC</c>).</param>
/// <param name="MotorStatus">Live motor-state label (web <c>motorStatus</c>); empty when absent.</param>
/// <param name="OverallHealth">Overall drivetrain condition (web <c>overallHealth ?? 'good'</c>).</param>
/// <param name="Drives">The parsed recent-drive rows (web <c>useDrives</c>).</param>
/// <param name="Stats">The lifetime driving stats, or null when the query returned no object (web <c>stats</c> undefined).</param>
/// <param name="MotorHistory">The parsed motor-history rows (web <c>useMotorHistory</c>).</param>
/// <param name="MotorLatest">The latest live-motor reading, or null when absent (web <c>motorLatest</c>).</param>
public sealed record DrivetrainHealthPageData(
    bool HasHealth,
    double? FrontMotorTempC,
    double? RearMotorTempC,
    double? InverterTempC,
    double? BatteryTempC,
    string MotorStatus,
    DrivetrainHealth OverallHealth,
    IReadOnlyList<DrivetrainDriveSample> Drives,
    DrivetrainStatsSlice? Stats,
    IReadOnlyList<DrivetrainMotorSample> MotorHistory,
    TeslaSync.App.FeatureViews.MotorLiveReading? MotorLatest)
{
    /// <summary>The empty snapshot (web disabled / no-vehicle query) — drives the page's empty surface.</summary>
    public static DrivetrainHealthPageData Empty { get; } = new(
        false,
        null,
        null,
        null,
        null,
        string.Empty,
        DrivetrainHealth.Good,
        Array.Empty<DrivetrainDriveSample>(),
        null,
        Array.Empty<DrivetrainMotorSample>(),
        null);

    /// <summary>Compose the snapshot from the five independent reads' raw JSON bodies.</summary>
    /// <param name="health">The drivetrain-health JSON body (web <c>useDrivetrainHealth</c>).</param>
    /// <param name="drives">The recent-drives JSON array (web <c>useDrives</c>).</param>
    /// <param name="stats">The lifetime driving-stats JSON body (web <c>useDrivingStats</c>).</param>
    /// <param name="motorHistory">The motor-history JSON array (web <c>useMotorHistory</c>).</param>
    /// <param name="motorLatest">The latest live-motor JSON body (web <c>useMotorLatest</c>).</param>
    /// <returns>A tolerant, fully parsed snapshot.</returns>
    public static DrivetrainHealthPageData Compose(
        JsonElement health,
        JsonElement drives,
        JsonElement stats,
        JsonElement motorHistory,
        JsonElement motorLatest)
    {
        bool hasHealth = health.ValueKind == JsonValueKind.Object;

        return new DrivetrainHealthPageData(
            HasHealth: hasHealth,
            FrontMotorTempC: hasHealth ? DrivetrainHealthJson.Double(health, "front_motor_temp_c") : null,
            RearMotorTempC: hasHealth ? DrivetrainHealthJson.Double(health, "rear_motor_temp_c") : null,
            InverterTempC: hasHealth ? DrivetrainHealthJson.Double(health, "inverter_temp_c") : null,
            BatteryTempC: hasHealth ? DrivetrainHealthJson.Double(health, "battery_temp_c") : null,
            MotorStatus: (hasHealth ? DrivetrainHealthJson.String(health, "motor_status") : null) ?? string.Empty,
            OverallHealth: ParseHealth(hasHealth ? DrivetrainHealthJson.String(health, "overall_health") : null),
            Drives: ParseDrives(drives),
            Stats: DrivetrainStatsSlice.FromJson(stats),
            MotorHistory: ParseMotorHistory(motorHistory),
            MotorLatest: TeslaSync.App.FeatureViews.MotorLiveReading.FromResponse(motorLatest));
    }

    /// <summary>Map the web <c>HealthStatus</c> string onto the canonical level, defaulting to good (web <c>?? 'good'</c>).</summary>
    public static DrivetrainHealth ParseHealth(string? value) => value switch
    {
        "critical" => DrivetrainHealth.Critical,
        "warning" => DrivetrainHealth.Warning,
        _ => DrivetrainHealth.Good,
    };

    private static IReadOnlyList<DrivetrainDriveSample> ParseDrives(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("drives", out var inner))
        {
            array = inner;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DrivetrainDriveSample>();
        }

        var list = new List<DrivetrainDriveSample>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(DrivetrainDriveSample.FromJson(item));
            }
        }

        return list;
    }

    private static IReadOnlyList<DrivetrainMotorSample> ParseMotorHistory(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DrivetrainMotorSample>();
        }

        var list = new List<DrivetrainMotorSample>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(DrivetrainMotorSample.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>The parsed snapshot plus the page lifecycle flags (loading / error) the projection folds into a state.</summary>
/// <param name="Data">The parsed five-source snapshot.</param>
/// <param name="Loading">Whether the gating drivetrain-health read is still in flight.</param>
/// <param name="ErrorDetail">An optional hard-failure detail (the error branch), or null.</param>
public sealed record DrivetrainHealthPageModel(DrivetrainHealthPageData Data, bool Loading, string? ErrorDetail);

/// <summary>
/// The web <c>HEALTH_SCORE</c> map (good → 95, warning → 60, critical → 25) — the single source of the 0..100
/// drivetrain-health score every health child renders (web/src/features/driving/components/drivetrain-health/
/// constants.ts). Kept UI-free so the mapping is unit-tested headlessly.
/// </summary>
public static class DrivetrainHealthScore
{
    /// <summary>Resolve the web <c>HEALTH_SCORE[overallHealth]</c> figure for a health level.</summary>
    /// <param name="level">The drivetrain health level.</param>
    /// <returns>The 0..100 score (good → 95, warning → 60, critical → 25).</returns>
    public static double ForLevel(DrivetrainHealth level) => level switch
    {
        DrivetrainHealth.Warning => 60,
        DrivetrainHealth.Critical => 25,
        _ => 95,
    };
}

/// <summary>Null-tolerant readers for the snake_case wire JSON (the native contract client does not camelCase).</summary>
internal static class DrivetrainHealthJson
{
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
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
}

/// <summary>
/// PII-safe diagnostics for the <c>DrivetrainHealthPage</c> surface (P1/S11). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a temperature, score, address or health level — so a
/// diagnostics line can never leak a user's drivetrain record. Thread-safe.
/// </summary>
public sealed class DrivetrainHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink invoked with each diagnostics line.</param>
    public DrivetrainHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivetrainHealthPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivetrainHealthRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DrivetrainHealthPage</c> feature surface — the native mirror of the web page
/// at <c>web/src/features/driving/pages/DrivetrainHealthPage.tsx</c> (route <c>/drivetrain-health</c>, nav name
/// <c>DrivetrainHealth</c>). Holds the route name, the five generated operation ids it binds to, the
/// diagnostics slug and the empty-surface glyph.
/// </summary>
public static class DrivetrainHealthRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DrivetrainHealthPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c> → <c>drivetrain-health</c>).</summary>
    public const string RouteName = "DrivetrainHealth";

    /// <summary>The generated operation id for the drivetrain-health read (web <c>useDrivetrainHealth</c>).</summary>
    public const string DrivetrainHealthOperation = "get_api_v1_drivetrain_health";

    /// <summary>The generated operation id for the recent-drives read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = "get_api_v1_drives";

    /// <summary>The generated operation id for the lifetime driving-stats read (web <c>useDrivingStats</c>).</summary>
    public const string DrivingStatsOperation = "get_api_v1_drives_stats";

    /// <summary>The generated operation id for the motor-history read (web <c>useMotorHistory</c>).</summary>
    public const string MotorHistoryOperation = "get_api_v1_motor";

    /// <summary>The generated operation id for the latest live-motor read (web <c>useMotorLatest</c>).</summary>
    public const string MotorLatestOperation = "get_api_v1_motor_latest";

    /// <summary>The default motor-history window the web page requests (<c>useMotorHistory(vehicleId, 200)</c>).</summary>
    public const int MotorHistoryLimit = 200;

    /// <summary>Segoe Fluent glyph for the page-level empty surface (Repair / drivetrain).</summary>
    public const string EmptyGlyph = "\uE950";
}
