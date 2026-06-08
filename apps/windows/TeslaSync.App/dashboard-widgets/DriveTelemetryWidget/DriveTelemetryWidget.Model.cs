using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DriveTelemetryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DriveTelemetryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>!latestDrive</c> gate (no vehicle
/// or no drive history) — the friendly "No recent drives" surface — distinct from a transport failure
/// (<see cref="Error"/>). A drive that resolves but has no telemetry samples stays <see cref="Loaded"/>
/// (the summary stats show, the chart area falls back to "No telemetry for this drive", mirroring the web
/// <c>chartData.length &gt; 0 ? chart : EmptyState</c> sub-gate).
/// </summary>
public enum DriveTelemetryState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved drive (fresh, or non-stale cache) with its summary stats + replay chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no drive history — render the empty state.</summary>
    Empty,

    /// <summary>The telemetry request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The latest drive projected from the drive-history list (web <c>Drive</c> in <c>@/types/driving</c>). Only
/// the fields the web <c>DriveTelemetryWidget</c> reads off <c>latestDrive</c> are kept: the SI
/// <c>distance_m</c> (converted to the user's distance unit at the display boundary), the SI
/// <c>duration_s</c> (rendered as whole minutes), the optional SI <c>energy_used_wh</c> (drives the
/// Efficiency stat), the <c>start_ts</c> (used to pick the newest drive, web's
/// <c>reduce((a, b) =&gt; a.startTs &gt; b.startTs ? a : b)</c>) and the optional <c>start_address</c>
/// (shown as a badge on the wide layout). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">Drive id (web <c>latestDrive.id</c>); 0 when absent.</param>
/// <param name="StartTs">Drive start instant used to pick the newest drive, or null (web <c>start_ts</c>).</param>
/// <param name="DistanceM">Distance in SI metres (web <c>distance_m</c>).</param>
/// <param name="DurationS">Duration in SI seconds (web <c>duration_s</c>).</param>
/// <param name="EnergyUsedWh">Energy used in SI watt-hours, or null when unknown (web <c>energy_used_wh</c>).</param>
/// <param name="StartAddress">Start address free-text, or null (web <c>start_address</c>).</param>
public sealed record DriveSummary(
    long Id,
    DateTimeOffset? StartTs,
    double DistanceM,
    long DurationS,
    double? EnergyUsedWh,
    string? StartAddress)
{
    /// <summary>Project a single drive JSON object into a tolerant summary row.</summary>
    public static DriveSummary FromJson(JsonElement obj) => new(
        GetLong(obj, "id") ?? 0,
        WidgetJson.GetDateTime(obj, "start_ts"),
        WidgetJson.GetDouble(obj, "distance_m") ?? 0,
        GetLong(obj, "duration_s") ?? 0,
        WidgetJson.GetDouble(obj, "energy_used_wh"),
        WidgetJson.GetString(obj, "start_address"));

    /// <summary>
    /// Resolve the newest drive from a drive-history JSON array by <c>start_ts</c> — the native port of the
    /// web <c>drives.reduce((a, b) =&gt; new Date(a.startTs) &gt; new Date(b.startTs) ? a : b)</c>. Returns
    /// <see langword="null"/> when the payload is not a non-empty array (web <c>list.length === 0</c>).
    /// </summary>
    public static DriveSummary? Latest(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        DriveSummary? best = null;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var drive = FromJson(item);

            // Web parity: the reduce keeps the first row on ties (strict `>`), so only a strictly newer
            // start_ts supersedes the running best; a null start_ts never wins over a dated one.
            if (best is null || IsNewer(drive.StartTs, best.StartTs))
            {
                best = drive;
            }
        }

        return best;
    }

    private static bool IsNewer(DateTimeOffset? candidate, DateTimeOffset? current)
    {
        if (candidate is not { } c)
        {
            return false;
        }

        return current is not { } cur || c > cur;
    }

    private static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One drive-telemetry sample projected from the per-drive telemetry response (web
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>). Only the fields the web replay chart reads are
/// kept: the timestamp (X axis), the SI <c>speed</c> in m/s (converted to the display speed unit), the
/// derived <c>power</c> in kW, the battery percent (<c>battery_level ?? soc</c>) and the
/// <c>elevation</c> in metres. Parsing is null-tolerant so a partial row never throws and a missing metric
/// becomes a gap the chart connects across (web <c>connectNulls</c>).
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
/// <param name="PowerKw">Drivetrain power in kW, or null (web <c>power</c>).</param>
/// <param name="BatteryPct">Battery state-of-charge %, or null (web <c>batteryLevel ?? soc</c>).</param>
/// <param name="Elevation">Elevation in metres, or null (web <c>elevation</c>).</param>
public sealed record DriveTelemetrySample(
    DateTimeOffset? TimestampUtc,
    double? SpeedMps,
    double? PowerKw,
    double? BatteryPct,
    double? Elevation)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<DriveTelemetrySample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveTelemetrySample>();
        }

        var list = new List<DriveTelemetrySample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive-telemetry JSON object into a tolerant sample.</summary>
    public static DriveTelemetrySample FromJson(JsonElement obj) => new(
        // Web parity: the component reads `p.timestamp`; the DriveTelemetryPoint type documents
        // `created_at` as the fallback and the Go /drives/{id}/telemetry handler emits `created_at`
        // (see internal/api/drives/detail.go), so try `timestamp` first then `created_at`.
        WidgetJson.GetDateTime(obj, "timestamp") ?? WidgetJson.GetDateTime(obj, "created_at"),
        WidgetJson.GetDouble(obj, "speed"),
        WidgetJson.GetDouble(obj, "power"),

        // Web parity: `batteryLevel ?? soc` — battery_level wins, soc is the fallback.
        WidgetJson.GetDouble(obj, "battery_level") ?? WidgetJson.GetDouble(obj, "soc"),
        WidgetJson.GetDouble(obj, "elevation"));
}

/// <summary>
/// The combined snapshot driving the surface — the resolved <see cref="LatestDrive"/> (web
/// <c>latestDrive</c>, from <c>useDrives</c>) plus its <see cref="Telemetry"/> samples (web
/// <c>useDriveTelemetry</c>). The drive gates the empty surface and feeds the summary stats; the telemetry
/// drives the speed / power / battery replay chart. Pure data so the projection is unit-tested without a UI
/// host or network.
/// </summary>
public sealed record DriveTelemetrySnapshot(
    DriveSummary LatestDrive,
    IReadOnlyList<DriveTelemetrySample> Telemetry);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> / <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx.
/// </summary>
public readonly record struct DriveTelemetrySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static DriveTelemetrySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): show the stats only.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>): show elevation + address.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>, the
/// optional <see cref="Unit"/> suffix (distance unit / "min" / "Wh/km" — absent for none here) and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record DriveTelemetryStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One legend entry — a series swatch and its localized name (web's legend row of colored dots). Pure data
/// so the view binds <see cref="ColorBrushKey"/> to a design-token brush.
/// </summary>
public sealed record DriveTelemetryLegendItem(string Label, string ColorBrushKey);

/// <summary>
/// One projected, render-ready point of the drive replay — the native analogue of a single web
/// <c>ChartDatum</c>. Holds the X-axis <see cref="TimeLabel"/> (24-hour local <c>HH:mm</c>, matching the
/// web), the raw display-unit metrics (<see cref="SpeedDisplay"/> already converted, <see cref="PowerKw"/>,
/// <see cref="BatteryPct"/>, <see cref="Elevation"/> — for the tooltip / automation summary) and the
/// pre-normalized ratios the view scales into pixels: <see cref="SpeedRatio"/> / <see cref="BatteryRatio"/>
/// / <see cref="ElevationRatio"/> on the shared left axis and <see cref="PowerRatio"/> on the right power
/// axis (the web's two Y axes). A null ratio is a gap the view connects across (web <c>connectNulls</c>).
/// Pure data so the geometry is unit-tested without a UI host.
/// </summary>
public sealed record DriveTelemetryChartPoint(
    string TimeLabel,
    double? SpeedDisplay,
    double? PowerKw,
    double? BatteryPct,
    double? Elevation,
    double? SpeedRatio,
    double? BatteryRatio,
    double? ElevationRatio,
    double? PowerRatio);

/// <summary>
/// The fully projected drive-replay chart — the native analogue of the web recharts <c>ComposedChart</c>
/// (a speed <c>Line</c> + dashed battery <c>Line</c> + optional elevation <c>Area</c> on the left axis and a
/// power <c>Area</c> on the right axis). Holds the normalized <see cref="Points"/>, the localized series
/// names, the left/right axis bound labels, whether the wide-only elevation series participates, and a
/// spoken automation summary. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DriveTelemetryChartModel(
    IReadOnlyList<DriveTelemetryChartPoint> Points,
    bool IsWide,
    string SpeedSeriesName,
    string PowerSeriesName,
    string BatterySeriesName,
    string ElevationSeriesName,
    string LeftAxisMaxLabel,
    string PowerAxisMaxLabel,
    string PowerAxisMinLabel,
    string AutomationName)
{
    /// <summary>True when there is at least one sample to plot (web <c>chartData.length &gt; 0</c>).</summary>
    public bool HasPoints => Points.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the latest drive for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Carries the summary stats,
/// the optional start-address badge, the replay chart and the legend. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record DriveTelemetryDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    IReadOnlyList<DriveTelemetryStat> Stats,
    string? StartAddress,
    DriveTelemetryChartModel Chart,
    IReadOnlyList<DriveTelemetryLegendItem> Legend,
    string CompactAutomationName)
{
    /// <summary>True when there is a replay curve to draw (web <c>chartData.length &gt; 0</c>).</summary>
    public bool HasChart => Chart.HasPoints;
}

/// <summary>
/// Pure projection from the combined drive snapshot to the display model — the native port of the
/// <c>chartData</c> / <c>stats</c> <c>useMemo</c> work and the <c>isCompact</c> / <c>isWide</c> gating in
/// web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx. Distance / speed are converted from SI to
/// the user's display units exactly as the web <c>convertDistanceFromSI</c> / <c>convertSpeedFromSI</c> do;
/// energy stays SI watt-hours (the Efficiency stat is Wh per display-distance). Every label resolves
/// through the i18n facade; series colors map onto the shared semantic chart design-token brushes.
/// </summary>
public static class DriveTelemetryProjection
{
    /// <summary>Segoe Fluent "Health" pulse glyph for the surface header (web lucide <c>Activity</c>).</summary>
    public const string HeaderGlyph = "\uE95E";

    /// <summary>Design-token brush for the speed line (web <c>palette.series[0]</c> cyan).</summary>
    public const string SpeedBrushKey = "TsChartSpeedBrush";

    /// <summary>Design-token brush for the power area / line (web <c>palette.series[1]</c> green).</summary>
    public const string PowerBrushKey = "TsChartPowerBrush";

    /// <summary>Design-token brush for the battery line (web amber <c>#f59e0b</c>).</summary>
    public const string BatteryBrushKey = "TsChartBatteryBrush";

    /// <summary>Design-token brush for the elevation area (web gray <c>#9ca3af</c>).</summary>
    public const string ElevationBrushKey = "TsColorTextMutedBrush";

    /// <summary>Headroom added above the tallest left-axis sample (web <c>domain={[0, 'dataMax + 10']}</c>).</summary>
    public const double LeftAxisHeadroom = 10.0;

    /// <summary>Seconds per minute (web <c>durationS / 60</c>).</summary>
    public const double SecondsPerMinute = 60.0;

    /// <summary>Project the empty (no drive) display for <paramref name="size"/> using the localizer.</summary>
    public static DriveTelemetryDisplay Empty(DriveTelemetrySize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new DriveTelemetryDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: false,
            Stats: Array.Empty<DriveTelemetryStat>(),
            StartAddress: null,
            Chart: EmptyChart(size, localizer),
            Legend: BuildLegend(size, localizer),
            CompactAutomationName: localizer.GetString("widget.driveTelemetry.empty", "No recent drives"));
    }

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> + <paramref name="units"/>.</summary>
    /// <param name="snapshot">The combined latest drive + telemetry samples.</param>
    /// <param name="size">The widget footprint (drives the compact / wide branches).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant (threaded for consistency; the HH:mm label ignores it).</param>
    public static DriveTelemetryDisplay Project(
        DriveTelemetrySnapshot snapshot,
        DriveTelemetrySize size,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var drive = snapshot.LatestDrive;
        var stats = BuildStats(drive, units, localizer);
        var chart = BuildChart(snapshot.Telemetry, size, units, localizer);

        // Web parity: the wide layout shows the start address as a badge when present.
        string? startAddress = size.IsWide && !string.IsNullOrWhiteSpace(drive.StartAddress)
            ? drive.StartAddress
            : null;

        return new DriveTelemetryDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: true,
            Stats: stats,
            StartAddress: startAddress,
            Chart: chart,
            Legend: BuildLegend(size, localizer),
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    /// <summary>The localized efficiency unit (web <c>unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'</c>).</summary>
    public static string EfficiencyUnit(UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        return "Wh/" + UnitLabels.Label(units.Distance);
    }

    private static List<DriveTelemetryStat> BuildStats(DriveSummary drive, UnitPref units, ILocalizer localizer)
    {
        string distanceUnit = UnitLabels.Label(units.Distance);
        double distanceDisplay = UnitConverters.DistanceFromSi(drive.DistanceM, units.Distance);

        string distanceLabel = localizer.GetString("widget.driveTelemetry.distance", "Distance");
        string distanceValue = Fmt(distanceDisplay, 1);

        string durationLabel = localizer.GetString("widget.driveTelemetry.duration", "Duration");
        string durationUnit = localizer.GetString("widget.driveTelemetry.min", "min");
        string durationValue = Fmt(drive.DurationS / SecondsPerMinute, 0);

        var stats = new List<DriveTelemetryStat>(3)
        {
            new(distanceLabel, distanceValue, distanceUnit, MeasureAutomationName(distanceLabel, distanceValue, distanceUnit)),
            new(durationLabel, durationValue, durationUnit, MeasureAutomationName(durationLabel, durationValue, durationUnit)),
        };

        // Web parity: the Efficiency stat appears only when energy_used_wh is present and distance > 0.
        if (drive.EnergyUsedWh is { } energyWh && drive.DistanceM > 0)
        {
            string efficiencyUnit = EfficiencyUnit(units);
            string efficiencyLabel = localizer.GetString("widget.driveTelemetry.efficiency", "Efficiency");
            string efficiencyValue = distanceDisplay > 0 ? Fmt(energyWh / distanceDisplay, 0) : EmDash;
            stats.Add(new DriveTelemetryStat(
                efficiencyLabel,
                efficiencyValue,
                efficiencyUnit,
                MeasureAutomationName(efficiencyLabel, efficiencyValue, efficiencyUnit)));
        }

        return stats;
    }

    private static DriveTelemetryChartModel BuildChart(
        IReadOnlyList<DriveTelemetrySample> telemetry,
        DriveTelemetrySize size,
        UnitPref units,
        ILocalizer localizer)
    {
        if (telemetry.Count == 0)
        {
            return EmptyChart(size, localizer);
        }

        bool isWide = size.IsWide;

        // First pass: convert speed to display units and find the axis bounds — the left "speed" axis is
        // shared by speed / battery / (wide) elevation (web yAxisId="speed", domain [0, dataMax + 10]); the
        // right axis carries power alone (web yAxisId="power").
        var speedDisplay = new double?[telemetry.Count];
        double leftDataMax = 0;
        double powerDataMin = 0;
        double powerDataMax = 0;
        bool anyPower = false;
        for (int i = 0; i < telemetry.Count; i++)
        {
            var sample = telemetry[i];
            if (sample.SpeedMps is { } mps)
            {
                double display = UnitConverters.SpeedFromSi(mps, units.Speed);
                speedDisplay[i] = display;
                leftDataMax = Math.Max(leftDataMax, display);
            }

            if (sample.BatteryPct is { } battery)
            {
                leftDataMax = Math.Max(leftDataMax, battery);
            }

            if (isWide && sample.Elevation is { } elevation)
            {
                leftDataMax = Math.Max(leftDataMax, elevation);
            }

            if (sample.PowerKw is { } power)
            {
                if (!anyPower)
                {
                    powerDataMin = power;
                    powerDataMax = power;
                    anyPower = true;
                }
                else
                {
                    powerDataMin = Math.Min(powerDataMin, power);
                    powerDataMax = Math.Max(powerDataMax, power);
                }
            }
        }

        double leftAxisMax = leftDataMax + LeftAxisHeadroom;

        // The power axis always spans zero (web area baseline) so regen (negative) dips below the drive
        // power; a flat / absent power series still yields a non-degenerate axis.
        double powerAxisMin = Math.Min(0, powerDataMin);
        double powerAxisMax = Math.Max(0, powerDataMax);
        if (powerAxisMax <= powerAxisMin)
        {
            powerAxisMax = powerAxisMin + 1;
        }

        double powerRange = powerAxisMax - powerAxisMin;

        var points = new List<DriveTelemetryChartPoint>(telemetry.Count);
        for (int i = 0; i < telemetry.Count; i++)
        {
            var sample = telemetry[i];
            string label = sample.TimestampUtc is { } ts
                ? ts.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture)
                : string.Empty;

            double? speedRatio = speedDisplay[i] is { } sd ? Math.Clamp(sd / leftAxisMax, 0.0, 1.0) : null;
            double? batteryRatio = sample.BatteryPct is { } bp ? Math.Clamp(bp / leftAxisMax, 0.0, 1.0) : null;
            double? elevationRatio = isWide && sample.Elevation is { } ev
                ? Math.Clamp(ev / leftAxisMax, 0.0, 1.0)
                : null;
            double? powerRatio = sample.PowerKw is { } pw
                ? Math.Clamp((pw - powerAxisMin) / powerRange, 0.0, 1.0)
                : null;

            points.Add(new DriveTelemetryChartPoint(
                TimeLabel: label,
                SpeedDisplay: speedDisplay[i],
                PowerKw: sample.PowerKw,
                BatteryPct: sample.BatteryPct,
                Elevation: sample.Elevation,
                SpeedRatio: speedRatio,
                BatteryRatio: batteryRatio,
                ElevationRatio: elevationRatio,
                PowerRatio: powerRatio));
        }

        return new DriveTelemetryChartModel(
            Points: points,
            IsWide: isWide,
            SpeedSeriesName: SpeedSeriesName(units, localizer),
            PowerSeriesName: localizer.GetString("widget.driveTelemetry.power", "Power (kW)"),
            BatterySeriesName: localizer.GetString("widget.driveTelemetry.battery", "Battery %"),
            ElevationSeriesName: localizer.GetString("widget.driveTelemetry.elevation", "Elevation"),
            LeftAxisMaxLabel: Fmt(leftAxisMax, 0),
            PowerAxisMaxLabel: Fmt(powerAxisMax, 0),
            PowerAxisMinLabel: Fmt(powerAxisMin, 0),
            AutomationName: ChartAutomationName(points.Count, units, localizer));
    }

    private static DriveTelemetryChartModel EmptyChart(DriveTelemetrySize size, ILocalizer localizer) => new(
        Points: Array.Empty<DriveTelemetryChartPoint>(),
        IsWide: size.IsWide,
        SpeedSeriesName: SpeedSeriesName(UnitPref.Metric, localizer),
        PowerSeriesName: localizer.GetString("widget.driveTelemetry.power", "Power (kW)"),
        BatterySeriesName: localizer.GetString("widget.driveTelemetry.battery", "Battery %"),
        ElevationSeriesName: localizer.GetString("widget.driveTelemetry.elevation", "Elevation"),
        LeftAxisMaxLabel: Fmt(LeftAxisHeadroom, 0),
        PowerAxisMaxLabel: Fmt(1, 0),
        PowerAxisMinLabel: Fmt(0, 0),
        AutomationName: localizer.GetString("widget.driveTelemetry.noTelemetry", "No telemetry for this drive"));

    private static List<DriveTelemetryLegendItem> BuildLegend(DriveTelemetrySize size, ILocalizer localizer)
    {
        // Web parity: legend order is Speed, Power, Battery, then Elevation only on the wide layout.
        var legend = new List<DriveTelemetryLegendItem>(4)
        {
            new(localizer.GetString("widget.driveTelemetry.speed", "Speed"), SpeedBrushKey),
            new(localizer.GetString("widget.driveTelemetry.power", "Power (kW)"), PowerBrushKey),
            new(localizer.GetString("widget.driveTelemetry.battery", "Battery %"), BatteryBrushKey),
        };

        if (size.IsWide)
        {
            legend.Add(new DriveTelemetryLegendItem(
                localizer.GetString("widget.driveTelemetry.elevation", "Elevation"), ElevationBrushKey));
        }

        return legend;
    }

    private static string SpeedSeriesName(UnitPref units, ILocalizer localizer)
    {
        // Web parity: the speed series name carries the active speed unit — `Speed (km/h)` / `Speed (mph)`.
        string speed = localizer.GetString("widget.driveTelemetry.speed", "Speed");
        return string.Create(CultureInfo.CurrentCulture, $"{speed} ({UnitLabels.Label(units.Speed)})");
    }

    private static string ChartAutomationName(int pointCount, UnitPref units, ILocalizer localizer)
    {
        string template = localizer.GetString(
            "widget.driveTelemetry.chartSummary",
            "Drive replay: {0}, {1}, {2} — {3} samples");
        return string.Format(
            CultureInfo.CurrentCulture,
            template,
            SpeedSeriesName(units, localizer),
            localizer.GetString("widget.driveTelemetry.power", "Power (kW)"),
            localizer.GetString("widget.driveTelemetry.battery", "Battery %"),
            pointCount.ToString(CultureInfo.CurrentCulture));
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<DriveTelemetryStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    private static string MeasureAutomationName(string label, string value, string unit) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);

    private const string EmDash = "\u2014";

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> / <c>fmtInt</c> does: coerce NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US
    /// grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw drive-telemetry <c>RepositoryResult&lt;JsonElement&gt;</c> emissions — combined
/// with the already-resolved latest drive — onto parsed
/// <c>RepositoryResult&lt;DriveTelemetrySnapshot&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline) so the view-model can render the full state matrix. Because the drive is
/// already resolved by the time the telemetry stream runs (web <c>latestDrive</c> is non-null), an
/// empty / absent telemetry payload still flows through as a populated snapshot with an empty curve (web
/// <c>chartData.length === 0</c> renders the stats + "No telemetry for this drive", never the whole-surface
/// empty state). Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DriveTelemetryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload, fold in <paramref name="latestDrive"/>, and preserve status.</summary>
    public static RepositoryResult<DriveTelemetrySnapshot> Map(
        RepositoryResult<JsonElement> raw,
        DriveSummary latestDrive)
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(latestDrive);

        DriveTelemetrySnapshot Parse() => new(
            latestDrive,
            raw.HasValue ? DriveTelemetrySample.ParseList(raw.Value) : Array.Empty<DriveTelemetrySample>());

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DriveTelemetrySnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DriveTelemetrySnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DriveTelemetrySnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DriveTelemetrySnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            // Web parity: the drive is resolved, so an empty telemetry response is a populated snapshot with
            // no curve — never the whole-surface empty state (that is gated earlier on `!latestDrive`).
            LoadStatus.Empty => RepositoryResult<DriveTelemetrySnapshot>.Loaded(
                new DriveTelemetrySnapshot(latestDrive, Array.Empty<DriveTelemetrySample>()),
                raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Offline => RepositoryResult<DriveTelemetrySnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DriveTelemetrySnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
