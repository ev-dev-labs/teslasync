using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DriveAnalyticsSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Drive-Analytics section (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx).
/// The web component is a pure child of the Driving-Dynamics page that receives an already date-filtered
/// <c>filteredDrives</c> array; the native feature-view owns its own cache-then-network drive-list read plus
/// the date range, so it renders the full state matrix. Every branch maps onto a visible surface; none is
/// hidden. <see cref="Empty"/> mirrors an empty <c>filteredDrives</c> (no drives in the selected range) and
/// is distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum DriveAnalyticsSectionState
{
    /// <summary>Initial fetch with no cached drive list — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive list with at least one drive in the selected range.</summary>
    Loaded,

    /// <summary>No drives resolved for the selected range — render the friendly empty surfaces.</summary>
    Empty,

    /// <summary>The request failed and no cached drive list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached drive list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached drive list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive reduced to the four fields the Drive-Analytics section reads — the SI <c>start_ts</c>
/// (date filter + recency ordering + power-profile label), <c>distance_m</c> in metres
/// (acceleration X axis), <c>avg_speed_mps</c> in metres-per-second (speed-distribution bucketing) and
/// <c>avg_power_w</c> in watts (acceleration / power-profile Y). Mirrors the web <c>Drive</c> SI fields
/// (<c>startTs</c> / <c>distanceM</c> / <c>avgSpeedMps</c> / <c>avgPowerW</c> in <c>@/types/driving</c>).
/// Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="StartTs">Drive start instant, or null (web <c>start_ts</c>).</param>
/// <param name="DistanceM">Distance travelled in SI metres, or null (web <c>distance_m</c>).</param>
/// <param name="AvgSpeedMps">Average speed in SI metres-per-second, or null (web <c>avg_speed_mps</c>).</param>
/// <param name="AvgPowerW">Average power in SI watts, or null (web <c>avg_power_w</c>).</param>
public sealed record DriveAnalyticsSample(
    DateTimeOffset? StartTs,
    double? DistanceM,
    double? AvgSpeedMps,
    double? AvgPowerW)
{
    /// <summary>The drive's UTC calendar day (web <c>startTs.slice(0, 10)</c>), or null when undated.</summary>
    public DateOnly? StartDate => StartTs is { } ts ? DateOnly.FromDateTime(ts.UtcDateTime) : null;

    /// <summary>Parse a drive-list JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<DriveAnalyticsSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveAnalyticsSample>();
        }

        var list = new List<DriveAnalyticsSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive-list JSON object into a tolerant sample.</summary>
    public static DriveAnalyticsSample FromJson(JsonElement obj) => new(
        GetDateTime(obj, "start_ts"),
        GetDouble(obj, "distance_m"),
        GetDouble(obj, "avg_speed_mps"),
        GetDouble(obj, "avg_power_w"));

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
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// One projected speed-distribution bucket — the native analogue of a web <c>speedDistribution</c> entry
/// (<c>{ range, count }</c>) plus the spoken summary the WinUI renderer needs. Pure data so the bucketing
/// is unit-tested without a UI host.
/// </summary>
/// <param name="Range">Display label, e.g. "0–30 km/h" (web <c>`${b.label} ${speedUnit}`</c>).</param>
/// <param name="Count">Number of drives whose average speed falls in this bucket (web <c>count</c>).</param>
/// <param name="AutomationName">Spoken summary of the bar (range + drive count).</param>
public sealed record SpeedDistributionBucket(string Range, int Count, string AutomationName);

/// <summary>
/// The fully projected speed-distribution histogram — the native analogue of the web recharts
/// <c>BarChart</c>. Carries every (always five) bucket, the <see cref="MaxCount"/> the bars normalize
/// against, the localized bar <see cref="SeriesName"/> (web bar <c>name = "Drives"</c>) and the
/// <see cref="HasData"/> gate (at least one drive carried an average speed). Pure data.
/// </summary>
/// <param name="Buckets">The five display-unit speed buckets (web <c>speedDistribution</c>).</param>
/// <param name="MaxCount">The tallest bucket count (bars normalize against this).</param>
/// <param name="SeriesName">Localized bar series name (web "Drives").</param>
/// <param name="HasData">True when at least one drive carried an average speed.</param>
public sealed record SpeedDistributionModel(
    IReadOnlyList<SpeedDistributionBucket> Buckets,
    int MaxCount,
    string SeriesName,
    bool HasData)
{
    /// <summary>Project the buckets into the single bar <see cref="ChartSeries"/> the chart + data view draw.</summary>
    public IReadOnlyList<ChartSeries> ToChartSeries()
    {
        if (Buckets.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(Buckets.Count);
        for (int i = 0; i < Buckets.Count; i++)
        {
            points.Add(new ChartPoint(i, Buckets[i].Count, Buckets[i].Range));
        }

        return new[]
        {
            new ChartSeries(SeriesName, points)
            {
                Kind = ChartSeriesKind.Bar,
                Role = ChartRole.Speed,
                Decimals = 0,
            },
        };
    }
}

/// <summary>
/// One projected acceleration-pattern point — a single drive plotted by display-unit trip distance (X)
/// and peak power in kW (Y). Mirrors a web <c>accelPatterns</c> entry
/// (<c>{ distance: round(toDistanceDisplay(distanceM)), powerMax: avgPowerW / 1000 }</c>). Pure data.
/// </summary>
/// <param name="DistanceDisplay">Trip distance in the user's display unit, rounded (web <c>distance</c>).</param>
/// <param name="PowerKw">Peak power in kW (web <c>powerMax</c>).</param>
/// <param name="AutomationName">Spoken summary of the point (distance + power).</param>
public sealed record AccelerationPoint(double DistanceDisplay, double PowerKw, string AutomationName);

/// <summary>
/// The fully projected acceleration-patterns scatter — the native analogue of the web recharts
/// <c>ScatterChart</c>. Carries every plotted <see cref="Points"/>, the <see cref="AveragePowerKw"/> the web
/// draws as a reference line, the active <see cref="DistanceUnit"/> for the X axis, the localized
/// <see cref="SeriesName"/> (web scatter <c>name = "Drives"</c>) and the <see cref="HasData"/> gate. Pure data.
/// </summary>
/// <param name="Points">The plotted per-drive points (web <c>accelPatterns</c>).</param>
/// <param name="AveragePowerKw">Mean peak power (web <c>ReferenceLine</c> y), or null when empty.</param>
/// <param name="DistanceUnit">Active distance unit label for the X axis (web <c>distanceUnit</c>).</param>
/// <param name="SeriesName">Localized scatter series name (web "Drives").</param>
/// <param name="HasData">True when at least one drive carried an average power.</param>
public sealed record AccelerationPatternsModel(
    IReadOnlyList<AccelerationPoint> Points,
    double? AveragePowerKw,
    string DistanceUnit,
    string SeriesName,
    bool HasData)
{
    /// <summary>Project the points into the single scatter <see cref="ChartSeries"/> the chart + data view draw.</summary>
    public IReadOnlyList<ChartSeries> ToChartSeries()
    {
        if (Points.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(Points.Count);
        foreach (var p in Points)
        {
            points.Add(new ChartPoint(p.DistanceDisplay, p.PowerKw));
        }

        return new[]
        {
            new ChartSeries(SeriesName, points)
            {
                Kind = ChartSeriesKind.Scatter,
                Role = ChartRole.Power,
                Unit = "kW",
                Decimals = 1,
            },
        };
    }

    /// <summary>The mean-power reference line (web amber <c>ReferenceLine</c>), or none when empty.</summary>
    public IReadOnlyList<ChartAnnotation> ToAnnotations(string averageLabel)
    {
        if (AveragePowerKw is not { } avg)
        {
            return Array.Empty<ChartAnnotation>();
        }

        return new[]
        {
            new ChartAnnotation("avg", ChartAnnotationKind.HorizontalLine, avg) { Label = averageLabel },
        };
    }
}

/// <summary>
/// One projected power-profile point — a recent drive plotted by ordinal position (X) with its peak (web
/// <c>powerMax</c>) and regen (web <c>powerMin</c>, always 0) power in kW. Mirrors a web <c>powerProfile</c>
/// entry (<c>{ index, label: formatDateShort(startTs), powerMax: (avgPowerW ?? 0) / 1000, powerMin: 0 }</c>).
/// Pure data.
/// </summary>
/// <param name="Index">1-based ordinal of the drive within the recent window (web <c>index</c>).</param>
/// <param name="Label">Short start-date label (web <c>formatDateShort(startTs)</c>).</param>
/// <param name="PowerMaxKw">Peak power in kW (web <c>powerMax</c>).</param>
/// <param name="PowerMinKw">Regen power in kW, always 0 (web <c>powerMin</c>).</param>
/// <param name="AutomationName">Spoken summary of the point (date + peak / regen power).</param>
public sealed record PowerProfilePoint(
    int Index,
    string Label,
    double PowerMaxKw,
    double PowerMinKw,
    string AutomationName);

/// <summary>
/// The fully projected power-profile dual-area chart — the native analogue of the web recharts
/// <c>AreaChart</c>. Carries every plotted <see cref="Points"/> (web's last 20 drives), the localized
/// peak / regen series names (web area <c>name = "Max Power (kW)" / "Regen Power (kW)"</c>) and the
/// <see cref="HasData"/> gate. Pure data.
/// </summary>
/// <param name="Points">The recent-drive points (web <c>powerProfile</c>).</param>
/// <param name="MaxSeriesName">Localized peak-power series name (web "Max Power (kW)").</param>
/// <param name="RegenSeriesName">Localized regen-power series name (web "Regen Power (kW)").</param>
/// <param name="HasData">True when at least one drive is in the recent window.</param>
public sealed record PowerProfileModel(
    IReadOnlyList<PowerProfilePoint> Points,
    string MaxSeriesName,
    string RegenSeriesName,
    bool HasData)
{
    /// <summary>Project the points into the peak + regen area <see cref="ChartSeries"/> the chart + data view draw.</summary>
    public IReadOnlyList<ChartSeries> ToChartSeries()
    {
        if (Points.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var max = new List<ChartPoint>(Points.Count);
        var regen = new List<ChartPoint>(Points.Count);
        foreach (var p in Points)
        {
            max.Add(new ChartPoint(p.Index, p.PowerMaxKw, p.Label));
            regen.Add(new ChartPoint(p.Index, p.PowerMinKw, p.Label));
        }

        return new[]
        {
            new ChartSeries(MaxSeriesName, max)
            {
                Kind = ChartSeriesKind.Area,
                Role = ChartRole.Power,
                Unit = "kW",
                Decimals = 1,
            },
            new ChartSeries(RegenSeriesName, regen)
            {
                Kind = ChartSeriesKind.Area,
                Role = ChartRole.Regen,
                Unit = "kW",
                Decimals = 1,
            },
        };
    }

    /// <summary>The web <c>ReferenceLine y={0}</c> baseline annotation (none when there is nothing to plot).</summary>
    public IReadOnlyList<ChartAnnotation> ToAnnotations() =>
        HasData
            ? new[] { new ChartAnnotation("zero", ChartAnnotationKind.HorizontalLine, 0) }
            : Array.Empty<ChartAnnotation>();
}

/// <summary>
/// The fully projected, render-ready view of the Drive-Analytics section — the native analogue of everything
/// the web component composes across its three <c>ChartContainer</c>s. Carries the always-present section
/// title plus each chart's chrome strings (title / subtitle / accessible summary / empty message / data-table
/// column labels), the three projected chart models and the <see cref="HasData"/> gate (at least one chart
/// carries data — web's non-empty <c>filteredDrives</c>). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record DriveAnalyticsSectionDisplay(
    bool HasData,
    int DriveCount,
    string Title,
    string StartLabel,
    string EndLabel,
    string AverageLabel,
    DriveAnalyticsChartChrome SpeedDistributionChrome,
    SpeedDistributionModel SpeedDistribution,
    DriveAnalyticsChartChrome AccelerationChrome,
    AccelerationPatternsModel Acceleration,
    DriveAnalyticsChartChrome PowerProfileChrome,
    PowerProfileModel PowerProfile);

/// <summary>
/// The always-present chrome strings for one chart card (the web <c>ChartContainer</c> title / subtitle /
/// <c>ariaLabel</c> / empty message / data-table column labels). Kept separate from the data model so the
/// card renders its header, empty surface and accessible data table whether or not the chart has points.
/// </summary>
/// <param name="Title">Card heading (web <c>ChartContainer title</c>).</param>
/// <param name="Subtitle">Supporting sub-heading (web <c>ChartContainer subtitle</c>).</param>
/// <param name="AriaLabel">Accessible chart summary (web <c>ChartContainer ariaLabel</c>).</param>
/// <param name="EmptyMessage">Friendly empty-state message.</param>
/// <param name="DataTableLabel">Label for the accessible data-table toggle.</param>
/// <param name="XColumnLabel">Header for the X column of the accessible data table.</param>
public sealed record DriveAnalyticsChartChrome(
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    string DataTableLabel,
    string XColumnLabel);

/// <summary>
/// Pure projection from the raw drive list to the display model — the native port of the three
/// <c>useMemo</c> blocks in
/// web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx. The drives are first
/// date-filtered to the selected range (web page-level <c>filteredDrives</c>), then folded into the three
/// charts: a speed-bucket histogram (display-unit buckets 0-30 / 30-60 / 60-90 / 90-120 / 120+), a
/// peak-power-vs-distance scatter with a mean reference line, and a last-20-drives peak / regen dual-area.
/// Speed / distance read through the unit module at the display boundary; every chrome string resolves
/// through the i18n facade.
/// </summary>
public static class DriveAnalyticsSectionProjection
{
    /// <summary>The number of recent drives the power profile plots (web <c>slice(-20)</c>).</summary>
    public const int PowerProfileWindow = 20;

    // Web parity: SPEED_BUCKETS_RANGES — SI bounds with display-unit labels. The final bucket is open-ended.
    private static readonly (double Min, double Max, string Label)[] SpeedBuckets =
    {
        (0, 30, "0\u201330"),
        (30, 60, "30\u201360"),
        (60, 90, "60\u201390"),
        (90, 120, "90\u2013120"),
        (120, double.PositiveInfinity, "120+"),
    };

    /// <summary>Project <paramref name="samples"/> filtered to <paramref name="range"/> for <paramref name="units"/>.</summary>
    /// <param name="samples">The full drive list (the projection applies the date filter itself).</param>
    /// <param name="range">The selected inclusive date range (web <c>startDate</c> / <c>endDate</c>).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static DriveAnalyticsSectionDisplay Project(
        IReadOnlyList<DriveAnalyticsSample> samples,
        DateRange range,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var filtered = Filter(samples, range);

        var speed = BuildSpeedDistribution(filtered, units, localizer);
        var accel = BuildAcceleration(filtered, units, localizer);
        var power = BuildPowerProfile(filtered, localizer);

        return new DriveAnalyticsSectionDisplay(
            HasData: speed.HasData || accel.HasData || power.HasData,
            DriveCount: filtered.Count,
            Title: localizer.GetString("dynamics.driveAnalytics", "Drive Analytics"),
            StartLabel: localizer.GetString("dynamics.range.start", "Start"),
            EndLabel: localizer.GetString("dynamics.range.end", "End"),
            AverageLabel: localizer.GetString("dynamics.avg", "Avg"),
            SpeedDistributionChrome: new DriveAnalyticsChartChrome(
                localizer.GetString("dynamics.speedDistribution", "Speed Distribution"),
                localizer.GetString("dynamics.speedDistDesc", "Drives grouped by average speed"),
                localizer.GetString("dynamics.speedDistribution.aria", "Speed-bucket drive count distribution bar chart"),
                localizer.GetString("dynamics.noData", "No drives in the selected range"),
                localizer.GetString("dynamics.speedDistribution.dataTable", "Show data table"),
                localizer.GetString("dynamics.col.range", "Speed range")),
            SpeedDistribution: speed,
            AccelerationChrome: new DriveAnalyticsChartChrome(
                localizer.GetString("dynamics.accelPatterns", "Acceleration Patterns"),
                localizer.GetString("dynamics.accelPatternsDesc", "Peak power vs trip distance"),
                localizer.GetString("dynamics.accelPatterns.aria", "Per-drive scatter chart of peak power versus trip distance"),
                localizer.GetString("dynamics.noData", "No drives in the selected range"),
                localizer.GetString("dynamics.accelPatterns.dataTable", "Show data table"),
                localizer.GetString("dynamics.distance", "Distance")),
            Acceleration: accel,
            PowerProfileChrome: new DriveAnalyticsChartChrome(
                localizer.GetString("dynamics.powerProfile", "Power Profile"),
                localizer.GetString("dynamics.powerProfileDesc", "Peak & regen power for recent drives"),
                localizer.GetString("dynamics.powerProfile.aria", "Recent-drives peak and regen power dual-area chart"),
                localizer.GetString("dynamics.noData", "No drives in the selected range"),
                localizer.GetString("dynamics.powerProfile.dataTable", "Show data table"),
                localizer.GetString("dynamics.col.drive", "Drive")),
            PowerProfile: power);
    }

    /// <summary>Project the empty (no drives) display for the given range, units and localizer.</summary>
    public static DriveAnalyticsSectionDisplay Empty(DateRange range, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<DriveAnalyticsSample>(), range, units, localizer);
    }

    // Web parity: filteredDrives = drives.filter(d => startDate <= startTs.slice(0,10) <= endDate). An
    // undated drive (no start_ts) is excluded, matching the web's `?? ''` never satisfying the bounds.
    private static List<DriveAnalyticsSample> Filter(
        IReadOnlyList<DriveAnalyticsSample> samples, DateRange range)
    {
        var normalized = range.Normalized();
        var result = new List<DriveAnalyticsSample>(samples.Count);
        foreach (var sample in samples)
        {
            if (sample.StartDate is { } day && day >= normalized.Start && day <= normalized.End)
            {
                result.Add(sample);
            }
        }

        return result;
    }

    private static SpeedDistributionModel BuildSpeedDistribution(
        List<DriveAnalyticsSample> filtered, UnitPref units, ILocalizer localizer)
    {
        string unitLabel = UnitLabels.Label(units.Speed);
        string seriesName = localizer.GetString("dynamics.drives", "Drives");
        string ofLabel = localizer.GetString("dynamics.col.drives", "Drives");

        var counts = new int[SpeedBuckets.Length];
        int total = 0;
        foreach (var sample in filtered)
        {
            if (sample.AvgSpeedMps is not { } mps)
            {
                continue;
            }

            // Web parity: spd = toSpeedDisplay(avgSpeedMps); bounds run through the SAME converter
            // (toSpeedDisplay(r.min) / toSpeedDisplay(r.max)) — reproduced verbatim, open-ended last bucket.
            double spd = UnitConverters.SpeedFromSi(mps, units.Speed);
            for (int i = 0; i < SpeedBuckets.Length; i++)
            {
                double lo = UnitConverters.SpeedFromSi(SpeedBuckets[i].Min, units.Speed);
                double hi = double.IsPositiveInfinity(SpeedBuckets[i].Max)
                    ? double.PositiveInfinity
                    : UnitConverters.SpeedFromSi(SpeedBuckets[i].Max, units.Speed);
                if (spd >= lo && spd < hi)
                {
                    counts[i]++;
                    total++;
                    break;
                }
            }
        }

        int maxCount = 0;
        var buckets = new List<SpeedDistributionBucket>(SpeedBuckets.Length);
        for (int i = 0; i < SpeedBuckets.Length; i++)
        {
            string range = string.Concat(SpeedBuckets[i].Label, " ", unitLabel);
            string automation = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", range, counts[i], ofLabel);
            buckets.Add(new SpeedDistributionBucket(range, counts[i], automation));
            maxCount = Math.Max(maxCount, counts[i]);
        }

        return new SpeedDistributionModel(buckets, maxCount, seriesName, total > 0);
    }

    private static AccelerationPatternsModel BuildAcceleration(
        List<DriveAnalyticsSample> filtered, UnitPref units, ILocalizer localizer)
    {
        string unitLabel = UnitLabels.Label(units.Distance);
        string seriesName = localizer.GetString("dynamics.drives", "Drives");
        string powerLabel = localizer.GetString("dynamics.peakPower", "Peak Power");

        var points = new List<AccelerationPoint>();
        double sum = 0;
        foreach (var sample in filtered)
        {
            if (sample.AvgPowerW is not { } watts)
            {
                continue;
            }

            double distance = Math.Round(UnitConverters.DistanceFromSi(sample.DistanceM ?? 0, units.Distance), MidpointRounding.AwayFromZero);
            double powerKw = watts / 1000.0;
            sum += powerKw;
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}, {2} {3} kW",
                ScalarFormatters.FormatNumber(distance, 0),
                unitLabel,
                powerLabel,
                ScalarFormatters.FormatNumber(powerKw, 1));
            points.Add(new AccelerationPoint(distance, powerKw, automation));
        }

        double? average = points.Count > 0 ? sum / points.Count : null;
        return new AccelerationPatternsModel(points, average, unitLabel, seriesName, points.Count > 0);
    }

    private static PowerProfileModel BuildPowerProfile(
        List<DriveAnalyticsSample> filtered, ILocalizer localizer)
    {
        string maxName = localizer.GetString("dynamics.maxPower", "Max Power (kW)");
        string regenName = localizer.GetString("dynamics.regenPower", "Regen Power (kW)");
        string maxLabel = localizer.GetString("dynamics.col.maxKw", "Max kW");
        string regenLabel = localizer.GetString("dynamics.col.regenKw", "Regen kW");

        int start = Math.Max(0, filtered.Count - PowerProfileWindow);
        var points = new List<PowerProfilePoint>(filtered.Count - start);
        for (int i = start; i < filtered.Count; i++)
        {
            var sample = filtered[i];
            double powerMax = (sample.AvgPowerW ?? 0) / 1000.0;
            string label = FormatDateShort(sample.StartTs);
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1} {2}, {3} {4}",
                label,
                maxLabel,
                ScalarFormatters.FormatNumber(powerMax, 1),
                regenLabel,
                ScalarFormatters.FormatNumber(0, 1));
            points.Add(new PowerProfilePoint(i - start + 1, label, powerMax, 0, automation));
        }

        return new PowerProfileModel(points, maxName, regenName, points.Count > 0);
    }

    // Web parity: formatDateShort — { month: 'short', day: 'numeric' } (e.g. "Apr 4"); null -> em dash.
    private static string FormatDateShort(DateTimeOffset? ts) =>
        ts is { } value
            ? value.UtcDateTime.ToString("MMM d", CultureInfo.InvariantCulture)
            : "\u2014";
}

/// <summary>
/// Canonical registry metadata for the Drive-Analytics surface — the native mirror of the web
/// driving-dynamics feature component
/// (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx). Hosting binds this
/// surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class DriveAnalyticsSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "drive-analytics-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveAnalyticsSection";

    /// <summary>Localized surface title (web "Drive Analytics").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.driveAnalytics", "Drive Analytics");
    }
}

/// <summary>
/// PII-safe diagnostics for the Drive-Analytics surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, distance, power, drive count,
/// VIN, vehicle id or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveAnalyticsSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveAnalyticsSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveAnalyticsSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveAnalyticsSectionRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-list <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DriveAnalyticsSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// date-filter + empty gate are applied by the projection, not here, so an empty trace still flows through
/// with its freshness intact. Kept pure so the parse-and-preserve contract is unit-tested.
/// </summary>
public static class DriveAnalyticsSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s drive-list payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<DriveAnalyticsSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DriveAnalyticsSample> Parse() =>
            raw.HasValue ? DriveAnalyticsSample.ParseList(raw.Value) : Array.Empty<DriveAnalyticsSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
