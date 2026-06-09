using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DriveOverviewChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Drive-Overview chart (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx). The web
/// component is a pure child of the Drive-Detail page that draws an empty "No telemetry data available"
/// placeholder when its <c>chartData</c> prop holds one sample or fewer; the native feature-view owns its
/// cache-then-network drive-telemetry read and therefore renders the full state matrix. Every branch maps
/// onto a visible surface; none is hidden. <see cref="Empty"/> mirrors the web <c>chartData.length &gt; 1</c>
/// gate (no vehicle, no drive, or a curve too short to plot) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum DriveOverviewChartState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive trace with at least two samples to plot.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, or a curve too short to plot — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached trace exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached trace older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached trace remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive-telemetry sample projected from the per-drive telemetry response (web
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>, generated <c>DriveTelemetryReading</c>). Only the
/// fields the web Drive-Overview chart reads are kept: the timestamp (X axis), the SI <c>speed</c> in m/s,
/// the derived <c>power</c> in kW, the SOC source <c>battery_level</c> (web <c>battery: batteryLevel ?? 0</c>),
/// the optional <c>usable_soc</c>, and the three SI range metrics in metres (<c>ideal_range</c> /
/// <c>est_range</c> / <c>rated_range</c>). Parsing is null-tolerant so a partial row never throws and a
/// missing metric stays null (the chart connects across the gap, mirroring the web <c>connectNulls</c>).
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
/// <param name="PowerKw">Drivetrain power in kW, or null (web <c>power</c>).</param>
/// <param name="BatteryPct">Battery state-of-charge %, or null (web <c>batteryLevel</c>).</param>
/// <param name="UsableSocPct">Usable state-of-charge %, or null (web <c>usableSoc</c>).</param>
/// <param name="IdealRangeM">Ideal range in SI metres, or null (web <c>idealRange</c>).</param>
/// <param name="EstRangeM">Estimated range in SI metres, or null (web <c>estRange</c>).</param>
/// <param name="RatedRangeM">Rated range in SI metres, or null (web <c>ratedRange</c>).</param>
public sealed record DriveOverviewSample(
    DateTimeOffset? TimestampUtc,
    double? SpeedMps,
    double? PowerKw,
    double? BatteryPct,
    double? UsableSocPct,
    double? IdealRangeM,
    double? EstRangeM,
    double? RatedRangeM)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<DriveOverviewSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveOverviewSample>();
        }

        var list = new List<DriveOverviewSample>(element.GetArrayLength());
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
    public static DriveOverviewSample FromJson(JsonElement obj) => new(
        // Web parity: the hook reads `tp.createdAt ?? tp.created_at ?? tp.timestamp`; the Go telemetry
        // handler emits `created_at`, so try `timestamp` first then `created_at`.
        GetDateTime(obj, "timestamp") ?? GetDateTime(obj, "created_at"),
        GetDouble(obj, "speed"),
        GetDouble(obj, "power"),
        GetDouble(obj, "battery_level"),
        GetDouble(obj, "usable_soc"),
        GetDouble(obj, "ideal_range"),
        GetDouble(obj, "est_range"),
        GetDouble(obj, "rated_range"));

    private static double? GetDouble(JsonElement obj, string name)
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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String when DateTimeOffset.TryParse(
                v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts) => ts,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready point of the drive trace — the native analogue of a single web
/// <c>ChartDataPoint</c>. Holds the X-axis <see cref="TimeLabel"/> (24-hour local <c>HH:mm</c>), the raw
/// display-unit metrics (already converted — for the tooltip / automation summary) and the pre-normalized
/// ratios the view scales into pixels: <see cref="SpeedRatio"/> / <see cref="IdealRangeRatio"/> /
/// <see cref="EstRangeRatio"/> / <see cref="SocRatio"/> / <see cref="UsableSocRatio"/> on the shared left
/// axis (the web hidden "speed" axis) and <see cref="PowerRatio"/> on the right power axis (the web "power"
/// axis). A null ratio is a gap the view connects across (web <c>connectNulls</c>). Pure data so the
/// geometry is unit-tested without a UI host.
/// </summary>
public sealed record DriveOverviewChartPoint(
    string TimeLabel,
    double SpeedDisplay,
    double PowerKw,
    double SocPct,
    double? IdealRangeDisplay,
    double? EstRangeDisplay,
    double? UsableSocPct,
    double SpeedRatio,
    double? IdealRangeRatio,
    double? EstRangeRatio,
    double SocRatio,
    double? UsableSocRatio,
    double PowerRatio);

/// <summary>
/// One legend row — the native analogue of a web <c>ChartLegend</c> entry: the series swatch (solid or
/// dashed), its localized <see cref="Label"/>, and the formatted Mean / Max / Min readouts. Pure data so the
/// view binds <see cref="ColorBrushKey"/> to a design-token brush and reads the Narrator
/// <see cref="AutomationName"/>.
/// </summary>
/// <param name="Label">Localized series label (web "Speed", "Range (ideal)", …).</param>
/// <param name="ColorBrushKey">Design-token brush key tinting the swatch / label.</param>
/// <param name="Dashed">True for the dashed range series (web <c>dash: true</c>).</param>
/// <param name="Mean">Formatted mean readout (web "Mean: …").</param>
/// <param name="Max">Formatted max readout (web "Max: …").</param>
/// <param name="Min">Formatted min readout (web "Min: …").</param>
/// <param name="AutomationName">Spoken summary of the row (label + mean/max/min).</param>
public sealed record DriveOverviewLegendItem(
    string Label,
    string ColorBrushKey,
    bool Dashed,
    string Mean,
    string Max,
    string Min,
    string AutomationName);

/// <summary>
/// The fully projected drive-overview chart — the native analogue of the web recharts <c>ComposedChart</c>
/// (a speed <c>Area</c> + optional dashed ideal/est range <c>Line</c>s + a SOC <c>Line</c> + optional usable
/// SOC <c>Line</c> on the shared left axis, plus a power <c>Line</c> on the right axis). Holds the normalized
/// <see cref="Points"/>, the per-series presence flags (the web conditional <c>chartData.some(...)</c>
/// gates), the localized series names (carrying the active speed / distance unit), the left / right axis
/// bound labels, and a spoken automation summary. Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record DriveOverviewChartModel(
    IReadOnlyList<DriveOverviewChartPoint> Points,
    bool HasIdealRange,
    bool HasEstRange,
    bool HasUsableSoc,
    string SpeedSeriesName,
    string IdealRangeSeriesName,
    string EstRangeSeriesName,
    string SocSeriesName,
    string UsableSocSeriesName,
    string PowerSeriesName,
    string LeftAxisMaxLabel,
    string PowerAxisMaxLabel,
    string PowerAxisMinLabel,
    string AutomationName)
{
    /// <summary>True when there are at least two samples to plot (web <c>chartData.length &gt; 1</c>).</summary>
    public bool HasPoints => Points.Count > 1;
}

/// <summary>
/// The fully projected, render-ready view of the Drive Overview surface — the native analogue of everything
/// the web component computes before returning its <c>ChartContainer</c> + <c>ChartLegend</c>. Carries the
/// always-present chrome strings (title / chart aria / empty message), the <see cref="HasData"/> gate
/// (web <c>chartData.length &gt; 1</c>), the normalized chart and the rich Mean/Max/Min legend. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record DriveOverviewChartDisplay(
    bool HasData,
    string Title,
    string ChartAriaLabel,
    string EmptyMessage,
    DriveOverviewChartModel Chart,
    IReadOnlyList<DriveOverviewLegendItem> Legend);

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>chartData</c> mapping (<c>convertSpeedFromSI</c> / <c>convertDistanceFromSI</c>), the composed-chart
/// series with their conditional <c>chartData.some(...)</c> gates and the <c>ChartLegend</c> Mean / Max / Min
/// statistics in web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx (+ useDriveDetailData.ts).
/// Speed is converted from SI m/s and the three range metrics from SI metres to the user's display units;
/// SOC, usable SOC and power keep their native units (%, %, kW). The web's two recharts Y axes are
/// reproduced by pre-normalizing every metric to a 0..1 ratio (the speed / range / SOC / usable-SOC share a
/// left axis scaled to their joint maximum; power gets a right axis spanning zero so regen dips below the
/// drive power). Every label resolves through the i18n facade; series colours map onto the shared chart
/// design-token brushes.
/// </summary>
public static class DriveOverviewChartProjection
{
    /// <summary>Design-token brush for the speed area (web <c>#3b82f6</c> = exact <c>TsChartSpeedBrush</c>).</summary>
    public const string SpeedBrushKey = "TsChartSpeedBrush";

    /// <summary>Design-token brush for the ideal-range line (web <c>#c084fc</c> light violet ≈ <c>TsChart07Brush</c>).</summary>
    public const string IdealRangeBrushKey = "TsChart07Brush";

    /// <summary>Design-token brush for the est-range line (web <c>#a855f7</c> = exact <c>TsChartPowerBrush</c>).</summary>
    public const string EstRangeBrushKey = "TsChartPowerBrush";

    /// <summary>Design-token brush for the SOC line (web <c>#84cc16</c> lime ≈ semantic <c>TsChartBatteryBrush</c>).</summary>
    public const string SocBrushKey = "TsChartBatteryBrush";

    /// <summary>Design-token brush for the usable-SOC line (web <c>#22d3ee</c> cyan ≈ <c>TsChartRegenBrush</c>).</summary>
    public const string UsableSocBrushKey = "TsChartRegenBrush";

    /// <summary>Design-token brush for the power line (web <c>#f59e0b</c> amber = exact <c>TsChartEnergyBrush</c>).</summary>
    public const string PowerBrushKey = "TsChartEnergyBrush";

    /// <summary>The power-axis unit suffix (web right <c>YAxis unit=" kW"</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Web global formatter default <c>maximumFractionDigits</c> (<c>_globalPrecision = 2</c>).</summary>
    public const int DefaultPrecision = 2;

    private const int IntegerPrecision = 0;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (chronological; the projection preserves order).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static DriveOverviewChartDisplay Project(
        IReadOnlyList<DriveOverviewSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var chart = BuildChart(samples, units, localizer);
        var legend = BuildLegend(samples, units, localizer);

        return new DriveOverviewChartDisplay(
            HasData: chart.HasPoints,
            Title: localizer.GetString("driveDetail.driveChart", "Drive Overview"),
            ChartAriaLabel: localizer.GetString(
                "driveDetail.driveChart.aria",
                "Drive overview composed chart of speed, range, SOC and power over time"),
            EmptyMessage: localizer.GetString("driveDetail.noChartData", "No telemetry data available"),
            Chart: chart,
            Legend: legend);
    }

    /// <summary>Project the empty (no drive / too-short curve) display using the localizer.</summary>
    public static DriveOverviewChartDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<DriveOverviewSample>(), units, localizer);
    }

    private static DriveOverviewChartModel BuildChart(
        IReadOnlyList<DriveOverviewSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        // Web parity: the conditional series render only when at least one sample carries the metric
        // (chartData.some(d => d.idealRange !== null) etc.). The est line falls back to rated_range.
        bool hasIdeal = false;
        bool hasEst = false;
        bool hasUsable = false;

        // First pass: convert to display units and find the shared left-axis maximum (speed / range / SOC /
        // usable-SOC, the web hidden "speed" YAxis) plus the power-axis bounds (the web right "power" YAxis).
        var speedDisplay = new double[samples.Count];
        var socPct = new double[samples.Count];
        var powerKw = new double[samples.Count];
        var idealDisplay = new double?[samples.Count];
        var estDisplay = new double?[samples.Count];
        var usablePct = new double?[samples.Count];

        double leftMax = 0;
        double powerMin = 0;
        double powerMax = 0;

        for (int i = 0; i < samples.Count; i++)
        {
            var s = samples[i];

            // Web: speed = convertSpeedFromSI(tp.speed ?? 0), battery = tp.batteryLevel ?? 0, power = tp.power ?? 0.
            double speed = s.SpeedMps is { } mps ? UnitConverters.SpeedFromSi(mps, units.Speed) : 0;
            double soc = s.BatteryPct ?? 0;
            double power = s.PowerKw ?? 0;
            speedDisplay[i] = speed;
            socPct[i] = soc;
            powerKw[i] = power;
            leftMax = Math.Max(leftMax, Math.Max(speed, soc));

            if (s.IdealRangeM is { } im)
            {
                double d = UnitConverters.DistanceFromSi(im, units.Distance);
                idealDisplay[i] = d;
                leftMax = Math.Max(leftMax, d);
                hasIdeal = true;
            }

            // Web est line: dataKey = some(estRange) ? 'estRange' : 'ratedRange'; legend uses estRange ?? ratedRange.
            double? estOrRated = s.EstRangeM ?? s.RatedRangeM;
            if (estOrRated is { } em)
            {
                double d = UnitConverters.DistanceFromSi(em, units.Distance);
                estDisplay[i] = d;
                leftMax = Math.Max(leftMax, d);
                hasEst = true;
            }

            if (s.UsableSocPct is { } us)
            {
                usablePct[i] = us;
                leftMax = Math.Max(leftMax, us);
                hasUsable = true;
            }

            powerMin = Math.Min(powerMin, power);
            powerMax = Math.Max(powerMax, power);
        }

        double leftAxisMax = leftMax > 0 ? leftMax : 1;
        double powerAxisMin = Math.Min(0, powerMin);
        double powerAxisMax = Math.Max(0, powerMax);
        if (powerAxisMax <= powerAxisMin)
        {
            powerAxisMax = powerAxisMin + 1;
        }

        double powerRange = powerAxisMax - powerAxisMin;

        var points = new List<DriveOverviewChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            var s = samples[i];
            string label = s.TimestampUtc is { } ts
                ? ts.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture)
                : string.Empty;

            points.Add(new DriveOverviewChartPoint(
                TimeLabel: label,
                SpeedDisplay: speedDisplay[i],
                PowerKw: powerKw[i],
                SocPct: socPct[i],
                IdealRangeDisplay: idealDisplay[i],
                EstRangeDisplay: estDisplay[i],
                UsableSocPct: usablePct[i],
                SpeedRatio: Ratio(speedDisplay[i], leftAxisMax),
                IdealRangeRatio: idealDisplay[i] is { } id ? Ratio(id, leftAxisMax) : null,
                EstRangeRatio: estDisplay[i] is { } ed ? Ratio(ed, leftAxisMax) : null,
                SocRatio: Ratio(socPct[i], leftAxisMax),
                UsableSocRatio: usablePct[i] is { } up ? Ratio(up, leftAxisMax) : null,
                PowerRatio: Math.Clamp((powerKw[i] - powerAxisMin) / powerRange, 0.0, 1.0)));
        }

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);

        return new DriveOverviewChartModel(
            Points: points,
            HasIdealRange: hasIdeal,
            HasEstRange: hasEst,
            HasUsableSoc: hasUsable,
            SpeedSeriesName: $"{localizer.GetString("driveDetail.speed", "Speed")} ({speedUnit})",
            IdealRangeSeriesName: $"{localizer.GetString("driveDetail.rangeIdeal", "Range ideal")} ({distanceUnit})",
            EstRangeSeriesName: $"{localizer.GetString("driveDetail.rangeEst", "Range est.")} ({distanceUnit})",
            SocSeriesName: $"{localizer.GetString("driveDetail.soc", "SOC")} %",
            UsableSocSeriesName: $"{localizer.GetString("driveDetail.usableSoc", "Usable SOC")} %",
            PowerSeriesName: $"{localizer.GetString("driveDetail.power", "Power")} {PowerUnit}",
            LeftAxisMaxLabel: Fmt(leftAxisMax, IntegerPrecision),
            PowerAxisMaxLabel: $"{Fmt(powerAxisMax, IntegerPrecision)} {PowerUnit}",
            PowerAxisMinLabel: $"{Fmt(powerAxisMin, IntegerPrecision)} {PowerUnit}",
            AutomationName: ChartAutomationName(points.Count, units, localizer));
    }

    private static List<DriveOverviewLegendItem> BuildLegend(
        IReadOnlyList<DriveOverviewSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        var legend = new List<DriveOverviewLegendItem>(6);
        if (samples.Count <= 1)
        {
            // Web parity: the rich legend renders only with chartData.length > 1.
            return legend;
        }

        int precision = units.Precision ?? DefaultPrecision;
        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);

        // Web parity (statFn): speed/power are never-null (?? 0) so every sample counts; SOC counts only
        // strictly-positive battery; the range / usable-SOC series count only their non-null samples.
        var speedStat = Stat(samples.Select(s => (double?)(s.SpeedMps is { } m ? UnitConverters.SpeedFromSi(m, units.Speed) : 0)));
        var idealStat = Stat(samples.Select(s => s.IdealRangeM is { } m ? UnitConverters.DistanceFromSi(m, units.Distance) : (double?)null));
        var estStat = Stat(samples.Select(s => (s.EstRangeM ?? s.RatedRangeM) is { } m ? UnitConverters.DistanceFromSi(m, units.Distance) : (double?)null));
        var socStat = Stat(samples.Select(s => s.BatteryPct is { } b && b > 0 ? b : (double?)null));
        var usableStat = Stat(samples.Select(s => s.UsableSocPct));
        var powerStat = Stat(samples.Select(s => (double?)(s.PowerKw ?? 0)));

        if (speedStat is { } sp)
        {
            AddItem(legend, localizer.GetString("driveDetail.speed", "Speed"), SpeedBrushKey, dashed: false,
                $"{Fmt(sp.Mean, precision)} {speedUnit}", $"{Fmt(sp.Max, precision)} {speedUnit}", $"{Fmt(sp.Min, IntegerPrecision)} {speedUnit}", localizer);
        }

        if (idealStat is { } id)
        {
            AddItem(legend, localizer.GetString("driveDetail.rangeIdeal", "Range (ideal)"), IdealRangeBrushKey, dashed: true,
                $"{Fmt(id.Mean, IntegerPrecision)} {distanceUnit}", $"{Fmt(id.Max, IntegerPrecision)} {distanceUnit}", $"{Fmt(id.Min, IntegerPrecision)} {distanceUnit}", localizer);
        }

        if (estStat is { } es)
        {
            AddItem(legend, localizer.GetString("driveDetail.rangeEst", "Range (est.)"), EstRangeBrushKey, dashed: true,
                $"{Fmt(es.Mean, IntegerPrecision)} {distanceUnit}", $"{Fmt(es.Max, IntegerPrecision)} {distanceUnit}", $"{Fmt(es.Min, IntegerPrecision)} {distanceUnit}", localizer);
        }

        if (socStat is { } so)
        {
            AddItem(legend, localizer.GetString("driveDetail.soc", "SOC"), SocBrushKey, dashed: false,
                Pct(so.Mean, precision), Pct(so.Max, precision), Pct(so.Min, precision), localizer);
        }

        if (usableStat is { } us)
        {
            AddItem(legend, localizer.GetString("driveDetail.usableSoc", "Usable SOC"), UsableSocBrushKey, dashed: false,
                Pct(us.Mean, precision), Pct(us.Max, precision), Pct(us.Min, precision), localizer);
        }

        if (powerStat is { } po)
        {
            AddItem(legend, localizer.GetString("driveDetail.power", "Power"), PowerBrushKey, dashed: false,
                $"{Fmt(po.Mean, precision)} {PowerUnit}", $"{Fmt(po.Max, precision)} {PowerUnit}", $"{Fmt(po.Min, precision)} {PowerUnit}", localizer);
        }

        return legend;
    }

    private static void AddItem(
        List<DriveOverviewLegendItem> legend,
        string label,
        string brushKey,
        bool dashed,
        string mean,
        string max,
        string min,
        ILocalizer localizer)
    {
        string meanLabel = localizer.GetString("driveDetail.stat.mean", "Mean");
        string maxLabel = localizer.GetString("driveDetail.stat.max", "Max");
        string minLabel = localizer.GetString("driveDetail.stat.min", "Min");
        string automation = string.Format(
            CultureInfo.CurrentCulture,
            "{0}. {1}: {2}. {3}: {4}. {5}: {6}",
            label, meanLabel, mean, maxLabel, max, minLabel, min);
        legend.Add(new DriveOverviewLegendItem(label, brushKey, dashed, mean, max, min, automation));
    }

    private static string ChartAutomationName(int sampleCount, UnitPref units, ILocalizer localizer)
    {
        string template = localizer.GetString(
            "driveDetail.driveChart.summary",
            "Drive overview: speed, range, SOC and power over {0} samples");
        return string.Format(CultureInfo.CurrentCulture, template, sampleCount.ToString(CultureInfo.CurrentCulture));
    }

    private static double Ratio(double value, double max) => Math.Clamp(value / max, 0.0, 1.0);

    private static string Pct(double value, int precision) => ScalarFormatters.FormatPercentage(value, precision);

    // Web parity: fmtNumber / fmtInt coerce NaN / ±∞ to 0 (safeNumber) then render with fixed fraction digits.
    private static string Fmt(double value, int precision)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, precision);
    }

    // Web parity (statFn): drop null/NaN samples; an empty set yields no stat (the series is omitted).
    private static SeriesStat? Stat(IEnumerable<double?> values)
    {
        double sum = 0;
        double max = double.NegativeInfinity;
        double min = double.PositiveInfinity;
        int count = 0;
        foreach (var v in values)
        {
            if (v is not { } d || double.IsNaN(d) || double.IsInfinity(d))
            {
                continue;
            }

            sum += d;
            max = Math.Max(max, d);
            min = Math.Min(min, d);
            count++;
        }

        return count == 0 ? null : new SeriesStat(sum / count, max, min);
    }

    private readonly record struct SeriesStat(double Mean, double Max, double Min);
}

/// <summary>
/// Canonical registry metadata for the Drive Overview surface — the native mirror of the web drive-detail
/// feature component (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx). Hosting binds
/// this surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class DriveOverviewChartRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "drive-overview-chart";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveOverviewChart";

    /// <summary>Localized surface title (web "Drive Overview").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.driveChart", "Drive Overview");
    }
}

/// <summary>
/// PII-safe diagnostics for the Drive Overview surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, range, SOC, power figure,
/// sample count, VIN, vehicle id or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveOverviewChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveOverviewChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveOverviewChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveOverviewChartRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-telemetry <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DriveOverviewSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>chartData.length &gt; 1</c> gate (the web empty-placeholder branch) is applied by the view-model, not
/// here, so a short / empty trace still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DriveOverviewChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<DriveOverviewSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DriveOverviewSample> Parse() =>
            raw.HasValue ? DriveOverviewSample.ParseList(raw.Value) : Array.Empty<DriveOverviewSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
