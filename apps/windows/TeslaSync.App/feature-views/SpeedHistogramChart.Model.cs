using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="SpeedHistogramChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Speed-Histogram chart (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx). The web
/// component is a pure child of the Drive-Detail page that draws an empty "No telemetry data available"
/// placeholder when its <c>speedHistData</c> prop is empty; the native feature-view owns its
/// cache-then-network drive-telemetry read and therefore renders the full state matrix. Every branch maps
/// onto a visible surface; none is hidden. <see cref="Empty"/> mirrors the web <c>speedHistData.length === 0</c>
/// gate (no vehicle, no drive, or a drive with no telemetry samples) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum SpeedHistogramChartState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive with at least one populated speed bucket to plot.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, or a drive with no telemetry — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached telemetry exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached histogram older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached histogram remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive-telemetry sample reduced to the single field the Speed-Histogram chart reads — the SI
/// <c>speed</c> in metres-per-second (web <c>chartData[i].speed = convertSpeedFromSI(tp.speed ?? 0)</c>).
/// Parsing is null-tolerant so a partial row never throws; a missing / non-numeric speed is kept null and the
/// projection counts it as the web's <c>?? 0</c> (the bottom speed bucket), so every sample still contributes
/// to the histogram denominator exactly as the web hook does.
/// </summary>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null when the row carries no numeric speed.</param>
public sealed record SpeedHistogramSample(double? SpeedMps)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<SpeedHistogramSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SpeedHistogramSample>();
        }

        var list = new List<SpeedHistogramSample>(element.GetArrayLength());
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
    public static SpeedHistogramSample FromJson(JsonElement obj) => new(GetDouble(obj, "speed"));

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
}

/// <summary>
/// One projected, render-ready histogram bar — the native analogue of a single web <c>SpeedHistogramBucket</c>
/// (<c>{ range, pct }</c>) plus the view-only fields the WinUI renderer needs. Holds the bucket
/// <see cref="Range"/> label (display-unit edges, e.g. "0–20"), the integer <see cref="Pct"/> percentage of
/// the drive in that bucket, its formatted <see cref="PctLabel"/> (e.g. "20%"), the pre-normalized
/// <see cref="HeightRatio"/> (0..1 against the tallest bar) the view scales into pixels, and a spoken
/// <see cref="AutomationName"/>. Pure data so the geometry is unit-tested without a UI host.
/// </summary>
/// <param name="Range">Display-unit bucket label (web <c>range</c>, e.g. "0–20" or "120+").</param>
/// <param name="Pct">Whole-percent share of the drive spent in this speed bucket (web <c>pct</c>).</param>
/// <param name="PctLabel">Formatted percentage readout shown above the bar (e.g. "20%").</param>
/// <param name="HeightRatio">Bar height as a 0..1 ratio of the tallest bucket (view scales to pixels).</param>
/// <param name="AutomationName">Spoken summary of the bar (range + percentage).</param>
public sealed record SpeedHistogramBar(
    string Range,
    int Pct,
    string PctLabel,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// The fully projected speed-distribution histogram — the native analogue of the web recharts
/// <c>BarChart</c>. Holds the populated <see cref="Bars"/> (web <c>speedHistData</c>, empty buckets already
/// dropped), the <see cref="MaxPct"/> the bars are normalized against and the localized
/// <see cref="BarSeriesName"/> (web bar <c>name = "% of drive"</c>). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record SpeedHistogramChartModel(
    IReadOnlyList<SpeedHistogramBar> Bars,
    int MaxPct,
    string BarSeriesName)
{
    /// <summary>True when there is at least one populated bucket to plot (web <c>speedHistData.length &gt; 0</c>).</summary>
    public bool HasBars => Bars.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the Speed-Histogram surface — the native analogue of everything
/// the web component hands to its <c>ChartContainer</c>. Carries the always-present chrome strings (title /
/// accessible summary / empty message), the tabular data-view column labels (web <c>dataColumns</c>: range /
/// pct), the <see cref="HasData"/> gate (web <c>speedHistData.length &gt; 0</c>) and the normalized chart.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedHistogramChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string RangeColumnLabel,
    string PctColumnLabel,
    string DataTableLabel,
    SpeedHistogramChartModel Chart)
{
    /// <summary>
    /// Project the histogram into the single bar <see cref="ChartSeries"/> the WinUI data-table fallback
    /// (web <c>ChartContainer</c> <c>dataColumns</c>) tabulates: one point per bucket (X = ordinal index, Y =
    /// percentage, label = range), named for the web pct column ("% of drive"). Returns an empty list when
    /// there is no data so the data view stays blank rather than throwing.
    /// </summary>
    public IReadOnlyList<ChartSeries> ToChartSeries()
    {
        if (!HasData)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(Chart.Bars.Count);
        for (int i = 0; i < Chart.Bars.Count; i++)
        {
            var bar = Chart.Bars[i];
            points.Add(new ChartPoint(i, bar.Pct, bar.Range));
        }

        return new[]
        {
            new ChartSeries(Chart.BarSeriesName, points)
            {
                Kind = ChartSeriesKind.Bar,
                Role = ChartRole.Power, // web fill #a855f7 == the power chart brush
                Unit = "%",
                Decimals = 0,
            },
        };
    }
}

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>speedHistData</c> memo in web/src/features/driving/components/drive-detail/useDriveDetailData.ts. Each
/// sample's SI speed is converted to the user's display unit (web <c>convertSpeedFromSI</c>, a null speed
/// counting as 0), bucketed into the seven fixed display-unit ranges (0-20 / 20-40 / 40-60 / 60-80 / 80-100 /
/// 100-120 / 120+), and each populated bucket becomes a bar whose percentage is
/// <c>round(count / total * 100)</c> (empty buckets dropped). The bucket edge labels render through the unit
/// module's number formatter at the user's global precision (web <c>fmtNumber</c>, default two fraction
/// digits). Every chrome string resolves through the i18n facade.
/// </summary>
public static class SpeedHistogramChartProjection
{
    /// <summary>Design-token brush for the bars (web <c>fill="#a855f7"</c> == exact <c>TsChartPowerBrush</c>).</summary>
    public const string BarBrushKey = "TsChartPowerBrush";

    /// <summary>Web global formatter default <c>maximumFractionDigits</c> (<c>_globalPrecision = 2</c>).</summary>
    public const int DefaultPrecision = 2;

    // Web parity: the seven fixed bucket edges, expressed in the user's display unit (km/h or mph) because the
    // bucketed speed is already converted. The final bucket is open-ended (web max 9999 → "{min}+").
    private static readonly (double Min, double Max)[] BucketDefs =
    {
        (0, 20),
        (20, 40),
        (40, 60),
        (60, 80),
        (80, 100),
        (100, 120),
        (120, 9999),
    };

    private const double OpenBucketMax = 9999;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (the projection counts every sample).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>) — bucketing + label precision.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static SpeedHistogramChartDisplay Project(
        IReadOnlyList<SpeedHistogramSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var chart = BuildChart(samples, units, localizer);

        return new SpeedHistogramChartDisplay(
            HasData: chart.HasBars,
            Title: localizer.GetString("driveDetail.speedHistogram", "Speed Histogram"),
            AriaLabel: localizer.GetString("driveDetail.speedHistogram.aria", "Speed-bucket distribution histogram"),
            EmptyMessage: localizer.GetString("driveDetail.noChartData", "No telemetry data available"),
            RangeColumnLabel: localizer.GetString("driveDetail.col.range", "Speed range"),
            PctColumnLabel: localizer.GetString("driveDetail.col.pct", "% of drive"),
            DataTableLabel: localizer.GetString("driveDetail.speedHistogram.dataTable", "Show data table"),
            Chart: chart);
    }

    /// <summary>Project the empty (no drive / no telemetry) display using the localizer.</summary>
    public static SpeedHistogramChartDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<SpeedHistogramSample>(), units, localizer);
    }

    private static SpeedHistogramChartModel BuildChart(
        IReadOnlyList<SpeedHistogramSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        string seriesName = string.Create(
            CultureInfo.CurrentCulture,
            $"% {localizer.GetString("driveDetail.ofDrive", "of drive")}");

        int total = samples.Count;
        if (total == 0)
        {
            return new SpeedHistogramChartModel(Array.Empty<SpeedHistogramBar>(), 0, seriesName);
        }

        // Web parity: count every sample into its display-unit bucket; a null speed counts as 0 (?? 0), which
        // lands in the bottom bucket, and every sample still contributes to the denominator.
        var counts = new int[BucketDefs.Length];
        foreach (var sample in samples)
        {
            double speed = sample.SpeedMps is { } mps ? UnitConverters.SpeedFromSi(mps, units.Speed) : 0;
            int idx = BucketIndex(speed);
            if (idx >= 0)
            {
                counts[idx]++;
            }
        }

        int precision = units.Precision ?? DefaultPrecision;

        // Web parity: drop empty buckets, then pct = round(count / total * 100).
        var pcts = new int[BucketDefs.Length];
        int maxPct = 0;
        int populated = 0;
        for (int i = 0; i < BucketDefs.Length; i++)
        {
            if (counts[i] <= 0)
            {
                continue;
            }

            int pct = (int)Math.Round((double)counts[i] / total * 100, MidpointRounding.AwayFromZero);
            pcts[i] = pct;
            maxPct = Math.Max(maxPct, pct);
            populated++;
        }

        var bars = new List<SpeedHistogramBar>(populated);
        for (int i = 0; i < BucketDefs.Length; i++)
        {
            if (counts[i] <= 0)
            {
                continue;
            }

            int pct = pcts[i];
            string range = BucketLabel(i, precision);
            string pctLabel = ScalarFormatters.FormatPercentage(pct, 0);
            double ratio = maxPct > 0 ? Math.Clamp((double)pct / maxPct, 0.0, 1.0) : 0.0;
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1} {2}",
                range,
                pctLabel,
                localizer.GetString("driveDetail.ofDrive", "of drive"));
            bars.Add(new SpeedHistogramBar(range, pct, pctLabel, ratio, automation));
        }

        return new SpeedHistogramChartModel(bars, maxPct, seriesName);
    }

    // Web parity: defs.findIndex(def => speed >= def.min && speed < def.max).
    private static int BucketIndex(double speed)
    {
        for (int i = 0; i < BucketDefs.Length; i++)
        {
            if (speed >= BucketDefs[i].Min && speed < BucketDefs[i].Max)
            {
                return i;
            }
        }

        return -1;
    }

    // Web parity: range = max >= 9999 ? `${fmtNumber(min)}+` : `${fmtNumber(min)}–${fmtNumber(max)}` (en dash).
    private static string BucketLabel(int index, int precision)
    {
        var (min, max) = BucketDefs[index];
        string minLabel = ScalarFormatters.FormatNumber(min, precision);
        if (max >= OpenBucketMax)
        {
            return string.Concat(minLabel, "+");
        }

        return string.Concat(minLabel, "\u2013", ScalarFormatters.FormatNumber(max, precision));
    }
}

/// <summary>
/// Canonical registry metadata for the Speed-Histogram surface — the native mirror of the web drive-detail
/// feature component (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx). Hosting binds
/// this surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class SpeedHistogramChartRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "speed-histogram-chart";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SpeedHistogramChart";

    /// <summary>Localized surface title (web "Speed Histogram").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.speedHistogram", "Speed Histogram");
    }
}

/// <summary>
/// PII-safe diagnostics for the Speed-Histogram surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, bucket, percentage, sample
/// count, VIN, vehicle id or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SpeedHistogramChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SpeedHistogramChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SpeedHistogramChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedHistogramChartRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-telemetry <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SpeedHistogramSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>speedHistData.length &gt; 0</c> gate (the web empty-placeholder branch) is applied by the view-model,
/// not here, so an empty trace still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SpeedHistogramChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SpeedHistogramSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SpeedHistogramSample> Parse() =>
            raw.HasValue ? SpeedHistogramSample.ParseList(raw.Value) : Array.Empty<SpeedHistogramSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
