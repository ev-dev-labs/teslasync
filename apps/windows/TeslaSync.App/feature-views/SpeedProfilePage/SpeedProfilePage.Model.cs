using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The backend speed-profile rollup from <c>GET /analytics/speed-profile</c> (web <c>SpeedProfileData</c> in
/// web/src/types/driving.ts, hook <c>useSpeedProfile</c>), narrowed to the fields the page reads. Speed is SI
/// (meters per second) and the per-bucket reading count is dimensionless; every display-side conversion happens
/// at the render boundary, never here. Parsing is null-tolerant so a partial or schema-drifted body never throws
/// (web parity: the page tolerates undefined fields with <c>?? 0</c>). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedProfileSummary(
    double AvgSpeedMps,
    double PeakSpeedMps,
    double OptimalSpeedMps,
    IReadOnlyList<SpeedBucket> Distribution)
{
    /// <summary>Project the <c>GET /analytics/speed-profile</c> JSON object into a tolerant summary (non-object → null).</summary>
    public static SpeedProfileSummary? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SpeedProfileSummary(
            AvgSpeedMps: SpeedProfileJson.Double(element, "avg_speed_mps") ?? SpeedProfileJson.Double(element, "avgSpeedMps") ?? 0,
            PeakSpeedMps: SpeedProfileJson.Double(element, "peak_speed_mps") ?? SpeedProfileJson.Double(element, "peakSpeedMps") ?? 0,
            OptimalSpeedMps: SpeedProfileJson.Double(element, "optimal_speed_mps") ?? SpeedProfileJson.Double(element, "optimalSpeedMps") ?? 0,
            Distribution: ParseDistribution(element));
    }

    private static IReadOnlyList<SpeedBucket> ParseDistribution(JsonElement element)
    {
        if (!element.TryGetProperty("distribution", out var dist) || dist.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SpeedBucket>();
        }

        var buckets = new List<SpeedBucket>(dist.GetArrayLength());
        foreach (var item in dist.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                buckets.Add(SpeedBucket.FromJson(item));
            }
        }

        return buckets;
    }
}

/// <summary>
/// One speed-distribution bucket from the rollup's <c>distribution</c> array (web <c>SpeedBucket</c>). The
/// <see cref="Label"/> is the human bucket range literal ("0-15", "15-30", …) in the user's display-speed unit,
/// and <see cref="Readings"/> is the time-share weight the chart and detail cards render. Pure data.
/// </summary>
public sealed record SpeedBucket(string Label, int Readings)
{
    /// <summary>Project a single distribution JSON object into a tolerant bucket (snake_case with camelCase alias).</summary>
    public static SpeedBucket FromJson(JsonElement element)
    {
        string label = SpeedProfileJson.String(element, "speed_bucket")
            ?? SpeedProfileJson.String(element, "speedBucket")
            ?? string.Empty;
        int readings = (int)(SpeedProfileJson.Long(element, "readings") ?? 0);
        return new SpeedBucket(label, readings);
    }
}

/// <summary>
/// One drive row from <c>GET /drives</c> (web <c>Drive</c> in web/src/types/driving.ts, hook <c>useDrives</c>),
/// narrowed to the fields the client-side per-bucket efficiency table and the efficiency-vs-speed scatter read.
/// Distance is SI (meters), energy is SI (watt-hours) and speed is SI (meters per second) exactly as the API
/// stores them. Parsing is null-tolerant so a partial row never throws. Pure data — no WinUI types.
/// </summary>
public sealed record SpeedDrive(
    long Id,
    DateTimeOffset? StartTs,
    double DistanceM,
    double? EnergyUsedWh,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double? AvgSpeedMps)
{
    /// <summary>Project a single drive JSON object into a tolerant drive record.</summary>
    public static SpeedDrive FromJson(JsonElement element)
    {
        return new SpeedDrive(
            Id: SpeedProfileJson.Long(element, "id") ?? 0,
            StartTs: SpeedProfileJson.Instant(element, "start_ts") ?? SpeedProfileJson.Instant(element, "startTs"),
            DistanceM: SpeedProfileJson.Double(element, "distance_m") ?? SpeedProfileJson.Double(element, "distanceM") ?? 0,
            EnergyUsedWh: SpeedProfileJson.Double(element, "energy_used_wh") ?? SpeedProfileJson.Double(element, "energyUsedWh"),
            StartBatteryPct: SpeedProfileJson.Double(element, "start_battery_pct") ?? SpeedProfileJson.Double(element, "startBatteryPct"),
            EndBatteryPct: SpeedProfileJson.Double(element, "end_battery_pct") ?? SpeedProfileJson.Double(element, "endBatteryPct"),
            AvgSpeedMps: SpeedProfileJson.Double(element, "avg_speed_mps") ?? SpeedProfileJson.Double(element, "avgSpeedMps"));
    }

    /// <summary>
    /// The per-drive energy efficiency in watt-hours-per-kilometre (web <c>getEfficiency</c>): null without a
    /// positive distance; otherwise <c>energyUsedWh / km</c> when energy is positive, else the battery-derived
    /// estimate <c>(startPct - endPct) * 0.75 * 1000 / km</c> when battery was consumed, else null.
    /// </summary>
    public double? Efficiency()
    {
        if (!(DistanceM > 0))
        {
            return null;
        }

        double km = DistanceM / 1000.0;
        if (EnergyUsedWh is > 0)
        {
            return EnergyUsedWh.Value / km;
        }

        double battUsed = (StartBatteryPct ?? 0) - (EndBatteryPct ?? 0);
        if (battUsed > 0)
        {
            return battUsed * 0.75 * 1000 / km;
        }

        return null;
    }
}

/// <summary>
/// The two-source snapshot the page binds to: the backend speed-profile rollup (primary — its presence drives
/// the success/empty state, exactly as the web page gates on <c>data ?</c>) and the drive list (secondary —
/// feeds the client-side per-bucket efficiency table and the efficiency-vs-speed scatter). Mirrors the web page
/// handing both query results to its render body.
/// </summary>
public sealed record SpeedProfileSnapshot(
    bool HasData,
    SpeedProfileSummary Summary,
    IReadOnlyList<SpeedDrive> Drives)
{
    /// <summary>The zero summary used as the empty / fallback backing value.</summary>
    public static SpeedProfileSummary EmptySummary { get; } = new(0, 0, 0, Array.Empty<SpeedBucket>());

    /// <summary>The empty snapshot (no backend speed-profile object) — the page-level empty surface.</summary>
    public static SpeedProfileSnapshot Empty { get; } = new(false, EmptySummary, Array.Empty<SpeedDrive>());

    /// <summary>Compose a snapshot from the parsed summary (may be null) and the drive list.</summary>
    public static SpeedProfileSnapshot Compose(SpeedProfileSummary? summary, IReadOnlyList<SpeedDrive> drives) =>
        summary is { } s
            ? new SpeedProfileSnapshot(true, s, drives)
            : new SpeedProfileSnapshot(false, EmptySummary, drives);
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ISpeedProfileFeed
{
    /// <summary>Fetch the speed-profile rollup + drive list for the active vehicle.</summary>
    Task<SpeedProfileSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptySpeedProfileFeed : ISpeedProfileFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySpeedProfileFeed Instance { get; } = new();

    private EmptySpeedProfileFeed()
    {
    }

    /// <inheritdoc />
    public Task<SpeedProfileSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(SpeedProfileSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum SpeedProfileState
{
    /// <summary>The primary speed-profile query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no backend speed-profile object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary speed-profile query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The speed-profile rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A hero radial gauge (web <c>RadialGauge</c>). Pre-rounded value + display max + label + unit + role.</summary>
public sealed record SpeedGaugeDisplay(double Value, double Max, string Label, string Unit, ChartRole Role);

/// <summary>
/// A speed-bucket detail card (web per-bucket <c>GlassPanel</c> in the distribution grid). Every field is
/// pre-formatted at the display boundary; the efficiency block is only present when matching drives exist.
/// </summary>
public sealed record SpeedBucketCardDisplay(
    string Range,
    string Glyph,
    string TimeShareLabel,
    string TimeShareText,
    string TimeShareBrushKey,
    string DrivesLabel,
    string DrivesText,
    bool HasEfficiency,
    string AvgSpeedLabel,
    string AvgSpeedText,
    string EfficiencyLabel,
    string EfficiencyText,
    string EfficiencyBrushKey,
    string AutomationName);

/// <summary>The speed-distribution bar-chart projection (web <c>ChartContainer</c> + <c>BarChart</c>).</summary>
public sealed record SpeedDistributionChartDisplay(
    string Title,
    string AriaLabel,
    bool HasData,
    IReadOnlyList<ChartSeries> Series);

/// <summary>One colour-coded legend chip beneath the efficiency-vs-speed scatter (web bottom legend).</summary>
public sealed record SpeedScatterLegendDisplay(string Label, string BrushKey);

/// <summary>The efficiency-vs-speed scatter projection (web <c>ChartContainer</c> + <c>ScatterChart</c> + legend).</summary>
public sealed record SpeedScatterChartDisplay(
    string Title,
    string Subtitle,
    string AriaLabel,
    bool Visible,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<SpeedScatterLegendDisplay> Legend);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>SpeedProfilePage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI types —
/// so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedProfileDisplay(
    SpeedProfileState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<SpeedGaugeDisplay> Gauges,
    SpeedDistributionChartDisplay Distribution,
    IReadOnlyList<SpeedBucketCardDisplay> BucketCards,
    SpeedScatterChartDisplay Scatter,
    string InsightGlyph,
    string InsightTitle,
    string InsightText,
    bool InsightAvailable,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary speed-profile query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The
/// view-model fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record SpeedProfileModel(SpeedProfileSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary speed-profile query is in flight with no data yet.</summary>
    public static SpeedProfileModel Initial { get; } = new(SpeedProfileSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>SpeedProfilePage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass (web key names, verbatim).
/// </summary>
public sealed record SpeedProfileStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string AvgSpeed { get; init; }
    public required string PeakSpeed { get; init; }
    public required string OptimalSpeed { get; init; }
    public required string Distribution { get; init; }
    public required string DistributionAria { get; init; }
    public required string TimeSpent { get; init; }
    public required string TimeShare { get; init; }
    public required string Drives { get; init; }
    public required string EffVsSpeed { get; init; }
    public required string EffVsSpeedAria { get; init; }
    public required string Speed { get; init; }
    public required string Lower { get; init; }
    public required string Better { get; init; }
    public required string Efficient { get; init; }
    public required string Moderate { get; init; }
    public required string HighConsumption { get; init; }
    public required string InsightTitle { get; init; }
    public required string InsightText { get; init; }
    public required string NoData { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static SpeedProfileStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new SpeedProfileStrings
        {
            Title = localizer.GetString("speedProfile.title", "Speed Profile"),
            Subtitle = localizer.GetString("speedProfile.subtitle", "Speed distribution and driving pattern analysis"),
            AvgSpeed = localizer.GetString("speedProfile.avgSpeed", "Avg Speed"),
            PeakSpeed = localizer.GetString("speedProfile.peakSpeed", "Peak Speed"),
            OptimalSpeed = localizer.GetString("speedProfile.optimalSpeed", "Optimal Speed"),
            Distribution = localizer.GetString("speedProfile.distribution", "Speed Distribution"),
            DistributionAria = localizer.GetString(
                "speedProfile.distribution.aria",
                "Speed-bucket time-share distribution bar chart"),
            TimeSpent = localizer.GetString("speedProfile.timeSpent", "time"),
            TimeShare = localizer.GetString("speedProfile.timeShare", "Time"),
            Drives = localizer.GetString("speedProfile.drives", "Drives"),
            EffVsSpeed = localizer.GetString("speedProfile.effVsSpeed", "Efficiency vs Speed"),
            EffVsSpeedAria = localizer.GetString(
                "speedProfile.effVsSpeed.aria",
                "Per-drive efficiency versus speed scatter plot"),
            Speed = localizer.GetString("speedProfile.speed", "Speed"),
            Lower = localizer.GetString("speedProfile.lower", "Lower"),
            Better = localizer.GetString("speedProfile.better", "better"),
            Efficient = localizer.GetString("speedProfile.efficient", "Efficient"),
            Moderate = localizer.GetString("speedProfile.moderate", "Moderate"),
            HighConsumption = localizer.GetString("speedProfile.highConsumption", "High consumption"),
            InsightTitle = localizer.GetString("speedProfile.insightTitle", "Efficiency Insight"),
            InsightText = localizer.GetString(
                "speedProfile.insightText",
                "Drives around {0} {1} show the best energy efficiency. Reducing highway speed could improve efficiency by ~15%."),
            NoData = localizer.GetString("speedProfile.noData", "No speed profile data available yet"),
            ErrorTitle = localizer.GetString("speedProfile.error", "Unable to load speed profile"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="SpeedProfileModel"/> to its <see cref="SpeedProfileDisplay"/> — the native
/// port of the render logic in web/src/features/driving/pages/SpeedProfilePage.tsx and its <c>getEfficiency</c>
/// / <c>bucketColor</c> / <c>bucketTextClass</c> / <c>categoryIcon</c> / <c>scatterData</c> /
/// <c>bucketEfficiency</c> helpers. The branch precedence mirrors the web data lifecycle (loading → error →
/// empty → success); the backend rollup feeds the three hero gauges and the distribution bar chart, while the
/// drive list feeds the client-side per-bucket efficiency block and the efficiency-vs-speed scatter. Every label
/// resolves through the i18n facade using the same keys the web page uses and every SI value is converted at this
/// display boundary.
/// </summary>
public static class SpeedProfileProjection
{
    /// <summary>Segoe Fluent — Car (web low-speed <c>Car</c> category icon).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent — Market/up trend (web high-speed <c>TrendingUp</c> category icon).</summary>
    public const string TrendingUpGlyph = "\uECA8";

    /// <summary>Segoe Fluent — Speed gauge (web mid-speed <c>Gauge</c> category icon).</summary>
    public const string GaugeGlyph = "\uEC49";

    /// <summary>Segoe Fluent — LightningBolt (web insight <c>Zap</c> icon).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>1 mile = 1609.344 m exactly — Wh/km → Wh/mi factor (web <c>* 1.609344</c>).</summary>
    public const double MetersPerMile = 1609.344;

    /// <summary>Hero avg / optimal gauge ceiling: ~200 km/h in SI (web <c>max={toSpeedDisplay(55.56)}</c>).</summary>
    public const double AvgGaugeMaxMps = 55.56;

    /// <summary>Hero peak gauge ceiling: ~250 km/h in SI (web <c>max={toSpeedDisplay(69.44)}</c>).</summary>
    public const double PeakGaugeMaxMps = 69.44;

    /// <summary>The scatter renders only when more than three eligible drives exist (web <c>length &gt; 3</c>).</summary>
    public const int ScatterMinPoints = 3;

    private const int PercentPrecision = 1;
    private const int SpeedPrecision = 1;
    private const int EfficiencyPrecision = 0;
    private const int InsightSpeedPrecision = 0;

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SpeedProfileDisplay Project(SpeedProfileModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = SpeedProfileStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var data = snapshot.Summary;
        var drives = snapshot.Drives;

        SpeedProfileState state =
            model.Loading && !snapshot.HasData ? SpeedProfileState.Loading
            : model.ErrorDetail is not null ? SpeedProfileState.Error
            : !snapshot.HasData ? SpeedProfileState.Empty
            : SpeedProfileState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        string speedUnit = UnitLabels.Label(units.Speed);
        var gauges = BuildGauges(data, s, units, speedUnit);
        var distribution = BuildDistribution(data.Distribution, s);
        var bucketEfficiency = BuildBucketEfficiency(drives, data.Distribution, units);
        var bucketCards = BuildBucketCards(data.Distribution, bucketEfficiency, s, units, speedUnit);
        var scatter = BuildScatter(drives, s, units, speedUnit);

        bool insightAvailable = data.OptimalSpeedMps > 0;
        string insightText = insightAvailable
            ? string.Format(
                CultureInfo.CurrentCulture,
                s.InsightText,
                ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(data.OptimalSpeedMps, units.Speed), InsightSpeedPrecision),
                speedUnit)
            : s.NoData;

        return new SpeedProfileDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == SpeedProfileState.Loading,
            ShowError: state == SpeedProfileState.Error,
            ShowEmpty: state == SpeedProfileState.Empty,
            ShowContent: state == SpeedProfileState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoData,
            Gauges: gauges,
            Distribution: distribution,
            BucketCards: bucketCards,
            Scatter: scatter,
            InsightGlyph: ZapGlyph,
            InsightTitle: s.InsightTitle,
            InsightText: insightText,
            InsightAvailable: insightAvailable,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>Convert an SI efficiency (Wh/km) into the user's display efficiency (web <c>toEfficiencyDisplay</c>).</summary>
    public static double EfficiencyToDisplay(double whPerKm, UnitPref units) =>
        units.Distance == DistanceUnit.Mi ? whPerKm * MetersPerMile / 1000.0 : whPerKm;

    /// <summary>The display efficiency unit label (web <c>efficiencyUnit</c>): Wh/mi for miles, otherwise Wh/km.</summary>
    public static string EfficiencyUnit(UnitPref units) =>
        units.Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

    /// <summary>
    /// The semantic colour band of a bucket range (web <c>bucketTextClass</c>): 0/15 → success, 30/45 → info,
    /// 60/75 → warning, otherwise danger. Mirrors the web hard-coded speed-band palette.
    /// </summary>
    public static StatusKind BucketStatus(string range)
    {
        if (range.StartsWith('0') || range.Contains("15", StringComparison.Ordinal))
        {
            return StatusKind.Success;
        }

        if (range.StartsWith("30", StringComparison.Ordinal) || range.Contains("45", StringComparison.Ordinal))
        {
            return StatusKind.Info;
        }

        if (range.StartsWith("60", StringComparison.Ordinal) || range.Contains("75", StringComparison.Ordinal))
        {
            return StatusKind.Warning;
        }

        return StatusKind.Danger;
    }

    /// <summary>
    /// The semantic colour band of a bucket's average efficiency (web detail-card class): &lt;160 → success,
    /// &lt;220 → warning, otherwise danger (lower Wh is better).
    /// </summary>
    public static StatusKind EfficiencyStatus(double avgEff) =>
        avgEff < 160 ? StatusKind.Success
        : avgEff < 220 ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>
    /// The colour band of a single scatter point's efficiency (web inline <c>color</c>): &lt;140 success,
    /// &lt;200 info, &lt;260 warning, otherwise danger.
    /// </summary>
    public static StatusKind ScatterStatus(double displayEff) =>
        displayEff < 140 ? StatusKind.Success
        : displayEff < 200 ? StatusKind.Info
        : displayEff < 260 ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>The category glyph for a bucket range (web <c>categoryIcon</c>): low → car, high → trend, else gauge.</summary>
    public static string CategoryGlyph(string range)
    {
        if (range.Contains("30", StringComparison.Ordinal) || range.StartsWith('0'))
        {
            return CarGlyph;
        }

        if (range.Contains("60", StringComparison.Ordinal) || range.Contains("90", StringComparison.Ordinal))
        {
            return TrendingUpGlyph;
        }

        return GaugeGlyph;
    }

    /// <summary>
    /// Build the per-bucket average efficiency + average speed (web <c>bucketEfficiency</c>): for every drive
    /// with a positive average speed and a positive efficiency, place it in the first distribution bucket whose
    /// numeric bounds contain the display speed, accumulating the SI average speed and the Wh/km efficiency, then
    /// average each bucket. Keyed by the bucket label.
    /// </summary>
    public static IReadOnlyDictionary<string, BucketEfficiency> BuildBucketEfficiency(
        IReadOnlyList<SpeedDrive> drives,
        IReadOnlyList<SpeedBucket> ranges,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(ranges);
        ArgumentNullException.ThrowIfNull(units);

        var acc = new Dictionary<string, (double TotalEff, double TotalSpdMps, int Count)>(StringComparer.Ordinal);
        foreach (var d in drives)
        {
            if (d.AvgSpeedMps is not { } mps)
            {
                continue;
            }

            if (d.Efficiency() is not { } eff || !(eff > 0))
            {
                continue;
            }

            double speedDisplay = UnitConverters.SpeedFromSi(mps, units.Speed);
            foreach (var r in ranges)
            {
                var (lo, hi) = ParseBucketBounds(r.Label);
                if (lo is not { } low)
                {
                    continue;
                }

                if (speedDisplay >= low && speedDisplay < hi)
                {
                    acc.TryGetValue(r.Label, out var cur);
                    acc[r.Label] = (cur.TotalEff + eff, cur.TotalSpdMps + mps, cur.Count + 1);
                    break;
                }
            }
        }

        var result = new Dictionary<string, BucketEfficiency>(StringComparer.Ordinal);
        foreach (var kv in acc)
        {
            if (kv.Value.Count > 0)
            {
                result[kv.Key] = new BucketEfficiency(kv.Value.TotalEff / kv.Value.Count, kv.Value.TotalSpdMps / kv.Value.Count);
            }
        }

        return result;
    }

    /// <summary>Extract the numeric lower / upper bounds of a bucket label ("60-75" → 60, 75; open-ended → 999).</summary>
    public static (double? Lo, double Hi) ParseBucketBounds(string label)
    {
        if (string.IsNullOrEmpty(label))
        {
            return (null, 0);
        }

        var numbers = new List<double>(2);
        int i = 0;
        while (i < label.Length && numbers.Count < 2)
        {
            if (!char.IsDigit(label[i]))
            {
                i++;
                continue;
            }

            int start = i;
            while (i < label.Length && char.IsDigit(label[i]))
            {
                i++;
            }

            numbers.Add(double.Parse(label.AsSpan(start, i - start), CultureInfo.InvariantCulture));
        }

        if (numbers.Count == 0)
        {
            return (null, 0);
        }

        return (numbers[0], numbers.Count > 1 ? numbers[1] : 999);
    }

    private static IReadOnlyList<SpeedGaugeDisplay> BuildGauges(
        SpeedProfileSummary data, SpeedProfileStrings s, UnitPref units, string speedUnit)
    {
        double Display(double mps) => Math.Round(UnitConverters.SpeedFromSi(mps, units.Speed));

        return
        [
            new SpeedGaugeDisplay(Display(data.AvgSpeedMps), Display(AvgGaugeMaxMps), s.AvgSpeed, speedUnit, ChartRole.Speed),
            new SpeedGaugeDisplay(Display(data.PeakSpeedMps), Display(PeakGaugeMaxMps), s.PeakSpeed, speedUnit, ChartRole.Temperature),
            new SpeedGaugeDisplay(Display(data.OptimalSpeedMps), Display(AvgGaugeMaxMps), s.OptimalSpeed, speedUnit, ChartRole.Regen),
        ];
    }

    private static SpeedDistributionChartDisplay BuildDistribution(IReadOnlyList<SpeedBucket> distribution, SpeedProfileStrings s)
    {
        var points = new List<ChartPoint>(distribution.Count);
        for (int i = 0; i < distribution.Count; i++)
        {
            points.Add(new ChartPoint(i, distribution[i].Readings, distribution[i].Label));
        }

        var series = new List<ChartSeries>
        {
            new($"% {s.TimeSpent}", points) { Kind = ChartSeriesKind.Bar, Role = ChartRole.Speed },
        };

        return new SpeedDistributionChartDisplay(s.Distribution, s.DistributionAria, distribution.Count > 0, series);
    }

    private static List<SpeedBucketCardDisplay> BuildBucketCards(
        IReadOnlyList<SpeedBucket> distribution,
        IReadOnlyDictionary<string, BucketEfficiency> bucketEfficiency,
        SpeedProfileStrings s,
        UnitPref units,
        string speedUnit)
    {
        int totalReadings = 0;
        foreach (var b in distribution)
        {
            totalReadings += b.Readings;
        }

        string efficiencyUnit = EfficiencyUnit(units);
        var cards = new List<SpeedBucketCardDisplay>(distribution.Count);
        foreach (var bucket in distribution)
        {
            string range = bucket.Label;
            double pct = totalReadings > 0 ? (double)bucket.Readings / totalReadings * 100 : 0;
            string timeShare = $"{ScalarFormatters.FormatNumber(pct, PercentPrecision)}%";
            string drivesText = bucket.Readings.ToString(CultureInfo.InvariantCulture);

            bool hasEff = bucketEfficiency.TryGetValue(range, out var eff);
            string avgSpeedText = hasEff
                ? $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(eff.AvgSpeedMps, units.Speed), SpeedPrecision)} {speedUnit}"
                : EmDash;
            string efficiencyText = hasEff
                ? ScalarFormatters.FormatNumber(EfficiencyToDisplay(eff.AvgEff, units), EfficiencyPrecision)
                : EmDash;
            string efficiencyBrush = hasEff
                ? StatusResources.AccentBrushKey(EfficiencyStatus(eff.AvgEff))
                : StatusResources.AccentBrushKey(StatusKind.Neutral);

            string automation = hasEff
                ? $"{range}. {s.TimeShare} {timeShare}. {s.Drives} {drivesText}. {s.AvgSpeed} {avgSpeedText}. {efficiencyUnit} {efficiencyText}"
                : $"{range}. {s.TimeShare} {timeShare}. {s.Drives} {drivesText}";

            cards.Add(new SpeedBucketCardDisplay(
                Range: range,
                Glyph: CategoryGlyph(range),
                TimeShareLabel: s.TimeShare,
                TimeShareText: timeShare,
                TimeShareBrushKey: StatusResources.AccentBrushKey(BucketStatus(range)),
                DrivesLabel: s.Drives,
                DrivesText: drivesText,
                HasEfficiency: hasEff,
                AvgSpeedLabel: s.AvgSpeed,
                AvgSpeedText: avgSpeedText,
                EfficiencyLabel: efficiencyUnit,
                EfficiencyText: efficiencyText,
                EfficiencyBrushKey: efficiencyBrush,
                AutomationName: automation));
        }

        return cards;
    }

    private static SpeedScatterChartDisplay BuildScatter(
        IReadOnlyList<SpeedDrive> drives, SpeedProfileStrings s, UnitPref units, string speedUnit)
    {
        string efficiencyUnit = EfficiencyUnit(units);
        var points = new List<ChartPoint>();
        foreach (var d in drives)
        {
            if (d.AvgSpeedMps is not { } mps || mps == 0)
            {
                continue;
            }

            if (d.Efficiency() is not { } whPerKm || !(whPerKm > 0))
            {
                continue;
            }

            double speed = Math.Round(UnitConverters.SpeedFromSi(mps, units.Speed));
            double eff = Math.Round(EfficiencyToDisplay(whPerKm, units));
            points.Add(new ChartPoint(speed, eff));
        }

        bool visible = points.Count > ScatterMinPoints;
        var series = new List<ChartSeries>
        {
            new(s.Speed, points) { Kind = ChartSeriesKind.Scatter, Role = ChartRole.Speed, Unit = efficiencyUnit },
        };

        var legend = new List<SpeedScatterLegendDisplay>
        {
            new(s.Efficient, StatusResources.AccentBrushKey(StatusKind.Success)),
            new(s.Moderate, StatusResources.AccentBrushKey(StatusKind.Warning)),
            new(s.HighConsumption, StatusResources.AccentBrushKey(StatusKind.Danger)),
        };

        string subtitle = $"{s.Lower} {efficiencyUnit} = {s.Better}";
        return new SpeedScatterChartDisplay(s.EffVsSpeed, subtitle, s.EffVsSpeedAria, visible, series, legend);
    }
}

/// <summary>A bucket's averaged efficiency (Wh/km, SI) and averaged SI speed (m/s). Pure data.</summary>
public readonly record struct BucketEfficiency(double AvgEff, double AvgSpeedMps);

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Speed-Profile page — every getter returns a nullable
/// rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the snake_case
/// wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class SpeedProfileJson
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

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? String(JsonElement obj, string name)
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
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Speed-Profile page — the native mirror of the web page at
/// web/src/features/driving/pages/SpeedProfilePage.tsx (route <c>/speed-profile</c>, nav name <c>SpeedProfile</c>).
/// The page reads the same speed-profile rollup the web <c>useSpeedProfile</c> hook reads (generated operation
/// <c>get_api_v1_analytics_speed_profile</c>) plus the drive list the web <c>useDrives</c> hook reads (generated
/// operation <c>get_api_v1_drives</c>).
/// </summary>
public static class SpeedProfileRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "SpeedProfile";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SpeedProfilePage";

    /// <summary>The generated operation id for the speed-profile read (web <c>useSpeedProfile</c>).</summary>
    public const string SpeedProfileOperation = Operations.Analytics.SpeedProfile;

    /// <summary>The generated operation id for the drive-list read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = Operations.Drives.List;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Gauge</c>).</summary>
    public const string EmptyGlyph = SpeedProfileProjection.GaugeGlyph;

    /// <summary>The localized page title (web <c>t('speedProfile.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("speedProfile.title", "Speed Profile");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Speed-Profile surface — records only the <c>view.opened</c> event with the
/// surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class SpeedProfileDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public SpeedProfileDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedProfileRegistration.Slug}");
    }
}
