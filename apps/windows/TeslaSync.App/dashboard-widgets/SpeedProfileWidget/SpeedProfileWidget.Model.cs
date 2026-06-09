using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SpeedProfileViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SpeedProfileWidget</c> renders
/// through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/SpeedProfileWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c> gate
/// (<c>hasData = chartData.length &gt; 0 &amp;&amp; chartData.some(d =&gt; d.frequency &gt; 0)</c> is false —
/// no vehicle resolved, or no speed bucket has any readings) — the friendly "No speed data" surface —
/// distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum SpeedProfileState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with at least one non-empty speed bucket.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no bucket has readings — render the "No speed data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One speed-distribution bucket the widget reads from <c>GET /analytics/speed-profile</c> — the native
/// mirror of the web <c>SpeedBucket</c> (web/src/api/types.ts). Field names mirror the Go API's snake_case
/// JSON tags (and the camelCase forms the web client's transform layers on). Only the three fields the web
/// <c>buildChartData</c> reads are kept: the <see cref="SpeedBucket"/> range label (<c>speed_bucket</c>),
/// the <see cref="Readings"/> count (<c>readings</c>) and the legacy kilowatt power key
/// (<c>avg_power_kw</c>) the web efficiency overlay reads — see <see cref="AvgPowerKw"/>. Parsing is
/// null-tolerant so a partial row never throws.
/// </summary>
/// <param name="SpeedBucket">The raw bucket range label, e.g. "15-30" or "75+" (web <c>speed_bucket</c>).</param>
/// <param name="Readings">Sample count in this bucket, or 0 (web <c>readings ?? 0</c>).</param>
/// <param name="AvgPowerKw">
/// The web efficiency overlay value, read from the legacy <c>avg_power_kw</c> / <c>avgPowerKw</c> keys
/// (web <c>b.avg_power_kw ?? b.avgPowerKw ?? 0</c>). The SI backend emits <c>avg_power_w</c> instead
/// (internal/api/speedprofile/handler.go), so this is <see langword="null"/> against the live API and the
/// overlay degrades to 0 — the documented graceful-degradation path reproduced verbatim for display parity.
/// </param>
public sealed record SpeedProfileBucket(string SpeedBucket, double Readings, double? AvgPowerKw)
{
    /// <summary>Project a single distribution-bucket JSON object into a tolerant row.</summary>
    public static SpeedProfileBucket FromJson(JsonElement obj) => new(
        GetString(obj, "speed_bucket") ?? GetString(obj, "speedBucket") ?? string.Empty,
        GetDouble(obj, "readings") ?? 0,
        GetDouble(obj, "avg_power_kw") ?? GetDouble(obj, "avgPowerKw"));

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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The speed-profile snapshot the widget consumes — the native mirror of the web <c>SpeedProfileData</c>
/// slice the component reads (web/src/api/types.ts): the <see cref="Distribution"/> histogram and the SI
/// <see cref="OptimalSpeedMps"/> (the "sweet spot" the web converts to the user's speed unit). The other
/// response fields (categories / points / avg / peak) are not read by this widget and are skipped. A
/// non-object body parses to <see langword="null"/> (the web <c>data</c> being undefined → the empty
/// surface); any object — even one with an empty distribution — yields a usable snapshot, and the
/// projection's <c>hasData</c> gate then decides between content and the empty state.
/// </summary>
/// <param name="Distribution">The per-bucket speed histogram (web <c>data.distribution</c>).</param>
/// <param name="OptimalSpeedMps">The most-efficient speed in SI m/s, or 0 (web <c>data.optimalSpeedMps</c>).</param>
public sealed record SpeedProfileData(
    IReadOnlyList<SpeedProfileBucket> Distribution,
    double OptimalSpeedMps)
{
    /// <summary>An empty snapshot (no buckets, no optimal speed) — the pre-load projection seed.</summary>
    public static SpeedProfileData Empty { get; } = new(Array.Empty<SpeedProfileBucket>(), 0);

    /// <summary>
    /// Project a <c>GET /analytics/speed-profile</c> response into the snapshot, or <see langword="null"/>
    /// when the body is not an object (web <c>!data</c> → the empty surface). Reads the snake_case wire
    /// shape (with camelCase fallbacks) so the client transform is irrelevant to the parse.
    /// </summary>
    public static SpeedProfileData? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var buckets = new List<SpeedProfileBucket>();
        if (root.TryGetProperty("distribution", out var dist) && dist.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in dist.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    buckets.Add(SpeedProfileBucket.FromJson(item));
                }
            }
        }

        double optimal = ReadDouble(root, "optimal_speed_mps") ?? ReadDouble(root, "optimalSpeedMps") ?? 0;
        if (double.IsNaN(optimal) || double.IsInfinity(optimal))
        {
            optimal = 0;
        }

        return new SpeedProfileData(buckets, optimal);
    }

    private static double? ReadDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> / <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/SpeedProfileWidget.tsx.
/// </summary>
public readonly record struct SpeedProfileSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SpeedProfileSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): summary stats only, no chart/title.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three+ columns (web <c>isWide = size.cols &gt;= 3</c>): the wider axis-tick treatment.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready summary stat (Most Common / Peak Freq / Sweet Spot) — the native analogue
/// of a web <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted
/// <see cref="Value"/>, the optional <see cref="Unit"/> suffix (the speed unit, absent for the Peak Freq
/// percentage) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record SpeedProfileStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected histogram column — the native analogue of a web <c>ChartDatum</c> after unit conversion.
/// Holds the converted <see cref="Bucket"/> range label (already in the user's speed unit), the
/// <see cref="Frequency"/> percentage (0..100) and the <see cref="Efficiency"/> overlay value. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedProfileChartPoint(string Bucket, double Frequency, double Efficiency);

/// <summary>
/// The fully projected, render-ready view of the speed profile for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX (the <c>buildChartData</c>
/// histogram, the <c>peakFreq</c> / <c>peakBucket</c> / <c>sweetSpot</c> derivations, the <c>stats</c> row
/// and the <c>isCompact</c> / <c>isEmpty</c> gating). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record SpeedProfileDisplay(
    bool IsCompact,
    bool IsEmpty,
    IReadOnlyList<SpeedProfileStat> Stats,
    IReadOnlyList<SpeedProfileChartPoint> Points,
    string FrequencySeriesName,
    string EfficiencySeriesName,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="SpeedProfileData"/> to the display model — the native port of the
/// <c>buildChartData</c> / <c>formatBucketLabel</c> / <c>findSweetSpot</c> / <c>peakFreq</c> /
/// <c>peakBucket</c> / <c>sweetSpot</c> <c>useMemo</c> work and the <c>isCompact</c> / <c>hasData</c>
/// gating in web/src/features/dashboard/widgets/SpeedProfileWidget.tsx. Speed values convert to the user's
/// unit at the display boundary via <see cref="UnitConverters.SpeedFromSi"/> (the native
/// <c>convertSpeedFromSI</c>); every label resolves through the i18n facade.
/// </summary>
public static class SpeedProfileProjection
{
    /// <summary>Segoe Fluent "pulse/activity" glyph for the header / empty state (web lucide <c>Activity</c>).</summary>
    public const string HeaderGlyph = "\uE95E";

    /// <summary>The chart-palette brush key the header icon shares with the frequency bars (web <c>text-neon-cyan</c> / series 0).</summary>
    public const string HeaderAccentBrushKey = "TsChart01Brush";

    /// <summary>Palette index for the frequency histogram bars (web flat indigo <c>#6366f1</c> → brand series 0).</summary>
    public const int FrequencyColorIndex = 0;

    /// <summary>Palette index for the efficiency-overlay line (web amber <c>#f59e0b</c> → brand series 1).</summary>
    public const int EfficiencyColorIndex = 1;

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer + units for every label/value.</summary>
    /// <param name="data">The speed-profile snapshot (drives the histogram + sweet spot).</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="units">The user's unit preference (drives the speed conversion + unit label).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static SpeedProfileDisplay Project(
        SpeedProfileData data,
        SpeedProfileSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        SpeedUnit speedUnit = units.Speed;
        string speedUnitLabel = UnitLabels.Label(speedUnit);

        var points = BuildChartData(data, speedUnit);
        bool hasData = points.Count > 0 && HasAnyFrequency(points);

        double peakFreq = PeakFrequency(points);
        string peakBucket = PeakBucket(points, peakFreq);
        string sweetSpot = SweetSpot(data, points, speedUnit);

        var stats = BuildStats(size.IsCompact, peakBucket, peakFreq, sweetSpot, speedUnitLabel, localizer);

        return new SpeedProfileDisplay(
            IsCompact: size.IsCompact,
            IsEmpty: !hasData,
            Stats: stats,
            Points: points,
            FrequencySeriesName: localizer.GetString("widget.speedProfile.frequency", "Frequency"),
            EfficiencySeriesName: localizer.GetString("widget.speedProfile.efficiency", "Wh/mi"),
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    /// <summary>
    /// Build the histogram — the native port of the web <c>buildChartData</c>: convert each bucket's range
    /// label to the user's speed unit, derive its frequency as a percentage of total readings, and read the
    /// efficiency overlay from the legacy <c>avg_power_kw</c> key (0 against the SI backend, web parity).
    /// </summary>
    public static IReadOnlyList<SpeedProfileChartPoint> BuildChartData(SpeedProfileData data, SpeedUnit speedUnit)
    {
        ArgumentNullException.ThrowIfNull(data);

        double totalReadings = 0;
        foreach (var bucket in data.Distribution)
        {
            totalReadings += bucket.Readings;
        }

        var points = new List<SpeedProfileChartPoint>(data.Distribution.Count);
        foreach (var bucket in data.Distribution)
        {
            string label = FormatBucketLabel(bucket.SpeedBucket, speedUnit);
            double frequency = totalReadings > 0 ? (bucket.Readings / totalReadings) * 100 : 0;
            double efficiency = bucket.AvgPowerKw ?? 0;
            points.Add(new SpeedProfileChartPoint(label, frequency, efficiency));
        }

        return points;
    }

    /// <summary>
    /// Convert a raw bucket range label to the user's speed unit — the native port of the web
    /// <c>formatBucketLabel</c>: a "lo-hi" range becomes "<c>fmtInt(toSpeedDisplay(lo))-…(hi)</c>", an
    /// "N+" open bucket becomes "<c>fmtInt(toSpeedDisplay(N))+</c>", anything else passes through. The web
    /// applies <c>convertSpeedFromSI</c> to the raw boundary numbers verbatim, so the native mirrors that
    /// exact transform (<see cref="UnitConverters.SpeedFromSi"/>) for display parity.
    /// </summary>
    public static string FormatBucketLabel(string bucket, SpeedUnit speedUnit)
    {
        if (string.IsNullOrEmpty(bucket))
        {
            return bucket;
        }

        var parts = bucket.Split('-');
        if (parts.Length == 2)
        {
            double? lo = ParseLeadingNumber(parts[0]);
            double? hi = ParseLeadingNumber(parts[1]);
            if (lo is { } l && hi is { } h)
            {
                return $"{FormatInt(ToSpeedDisplay(l, speedUnit))}-{FormatInt(ToSpeedDisplay(h, speedUnit))}";
            }
        }

        double? num = ParseLeadingNumber(bucket);
        if (num is { } n)
        {
            return $"{FormatInt(ToSpeedDisplay(n, speedUnit))}+";
        }

        return bucket;
    }

    private static bool HasAnyFrequency(IReadOnlyList<SpeedProfileChartPoint> points)
    {
        foreach (var p in points)
        {
            if (p.Frequency > 0)
            {
                return true;
            }
        }

        return false;
    }

    private static double PeakFrequency(IReadOnlyList<SpeedProfileChartPoint> points)
    {
        double max = 0;
        foreach (var p in points)
        {
            if (p.Frequency > max)
            {
                max = p.Frequency;
            }
        }

        return max;
    }

    private static string PeakBucket(IReadOnlyList<SpeedProfileChartPoint> points, double peakFreq)
    {
        // Web parity: chartData.find(d => d.frequency === peakFreq)?.bucket ?? '—'.
        foreach (var p in points)
        {
            if (p.Frequency == peakFreq)
            {
                return p.Bucket;
            }
        }

        return EmDash;
    }

    private static string SweetSpot(
        SpeedProfileData data, IReadOnlyList<SpeedProfileChartPoint> points, SpeedUnit speedUnit)
    {
        // Web parity: the API's optimalSpeedMps is genuine SI m/s, so toSpeedDisplay converts it directly.
        double optimal = data.OptimalSpeedMps;
        if (optimal > 0)
        {
            return FormatInt(ToSpeedDisplay(optimal, speedUnit));
        }

        return FindSweetSpot(points);
    }

    private static string FindSweetSpot(IReadOnlyList<SpeedProfileChartPoint> points)
    {
        // Web parity: the bucket with the lowest positive efficiency, or '—' when none has an overlay value.
        SpeedProfileChartPoint? best = null;
        foreach (var p in points)
        {
            if (p.Efficiency > 0 && (best is null || p.Efficiency < best.Efficiency))
            {
                best = p;
            }
        }

        return best?.Bucket ?? EmDash;
    }

    private static List<SpeedProfileStat> BuildStats(
        bool isCompact, string peakBucket, double peakFreq, string sweetSpot, string speedUnit, ILocalizer localizer)
    {
        string mostCommonLabel = localizer.GetString("widget.speedProfile.mostCommon", "Most Common");
        string sweetSpotLabel = localizer.GetString("widget.speedProfile.sweetSpot", "Sweet Spot");

        // Web parity: compact stats = [Most Common, Sweet Spot]; standard adds Peak Freq between them.
        var stats = new List<SpeedProfileStat>(3)
        {
            Stat(mostCommonLabel, peakBucket, speedUnit),
        };

        if (!isCompact)
        {
            string peakFreqLabel = localizer.GetString("widget.speedProfile.peakFreq", "Peak Freq");
            string peakFreqValue = $"{ScalarFormatters.FormatNumber(peakFreq, 1)}%";
            stats.Add(Stat(peakFreqLabel, peakFreqValue, null));
        }

        stats.Add(Stat(sweetSpotLabel, sweetSpot, speedUnit));
        return stats;
    }

    private static SpeedProfileStat Stat(string label, string value, string? unit)
    {
        string automation = string.IsNullOrEmpty(unit)
            ? $"{label}: {value}"
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
        return new SpeedProfileStat(label, value, unit, automation);
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<SpeedProfileStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    private static double ToSpeedDisplay(double value, SpeedUnit speedUnit) =>
        UnitConverters.SpeedFromSi(value, speedUnit);

    private static string FormatInt(double value) => ScalarFormatters.FormatNumber(value, 0);

    /// <summary>
    /// Port of JavaScript <c>parseFloat</c> for the bucket-boundary parse: reads the leading numeric prefix
    /// of <paramref name="text"/> (so "75+" → 75, "15" → 15), returning null when no number leads. This is
    /// what the web <c>formatBucketLabel</c> relies on for the open-ended "N+" bucket.
    /// </summary>
    private static double? ParseLeadingNumber(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        int i = 0;
        int n = text.Length;
        while (i < n && char.IsWhiteSpace(text[i]))
        {
            i++;
        }

        int start = i;
        if (i < n && (text[i] == '+' || text[i] == '-'))
        {
            i++;
        }

        bool sawDigit = false;
        while (i < n && text[i] >= '0' && text[i] <= '9')
        {
            i++;
            sawDigit = true;
        }

        if (i < n && text[i] == '.')
        {
            i++;
            while (i < n && text[i] >= '0' && text[i] <= '9')
            {
                i++;
                sawDigit = true;
            }
        }

        if (!sawDigit)
        {
            return null;
        }

        if (i < n && (text[i] == 'e' || text[i] == 'E'))
        {
            int afterMantissa = i;
            i++;
            if (i < n && (text[i] == '+' || text[i] == '-'))
            {
                i++;
            }

            bool expDigit = false;
            while (i < n && text[i] >= '0' && text[i] <= '9')
            {
                i++;
                expDigit = true;
            }

            if (!expDigit)
            {
                i = afterMantissa;
            }
        }

        string slice = text[start..i];
        return double.TryParse(slice, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;SpeedProfileData&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body is not an object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>data</c> being undefined.
/// Object bodies (even ones with an empty distribution) parse to a usable snapshot and the projection's
/// <c>hasData</c> gate then decides between content and the empty surface. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SpeedProfileResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<SpeedProfileData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SpeedProfileData? Parse() => raw.HasValue ? SpeedProfileData.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SpeedProfileData>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<SpeedProfileData>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SpeedProfileData>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<SpeedProfileData>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SpeedProfileData>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<SpeedProfileData>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<SpeedProfileData>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<SpeedProfileData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<SpeedProfileData>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<SpeedProfileData>.Empty(raw.FetchedAt),
            _ => RepositoryResult<SpeedProfileData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
