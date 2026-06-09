using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="TirePressureHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>TirePressureHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 0</c> — no timestamped TPMS row) — the friendly
/// "No tire pressure history" empty state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum TirePressureHistoryState
{
    /// <summary>Initial fetch with no cached history — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one timestamped TPMS row to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no timestamped rows — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One TPMS-timeline row from the <c>GET /tire-pressure</c> change feed (web <c>TirePressureReading</c> in
/// web/src/types/vehicle-systems.ts). Only the five fields the web <c>TirePressureHistoryWidget</c> chart
/// reads are projected: the row timestamp and the four corner pressures in SI kilopascals (web
/// <c>frontLeft</c> / <c>frontRight</c> / <c>rearLeft</c> / <c>rearRight</c>, read here under the canonical
/// snake_case wire names <c>front_left</c> / <c>front_right</c> / <c>rear_left</c> / <c>rear_right</c> the Go
/// List handler emits — the web reads the <c>camelCaseKeys</c> aliases of the very same fields).
/// <para>
/// Timestamp note: the web reads <c>d.timestamp</c>, but the Go List handler
/// (<c>internal/api/tirepressure/handler.go</c>) emits the timeline timestamp under <c>created_at</c> and
/// <c>ts</c> (identical values) and never under <c>timestamp</c>. To plot real data we resolve the timestamp
/// tolerantly — <c>created_at</c> → <c>ts</c> → <c>timestamp</c> — mirroring the ClimateHistory predecessor's
/// <c>created_at ?? timestamp</c> resolution while honouring the field the backend actually sends.
/// </para>
/// Parsing is null-tolerant so a partial row never throws: an absent / non-numeric pressure parses to
/// <see langword="null"/> (the web <c>toPressureValue</c> null guard → a gap the chart bridges), and a row
/// with no timestamp is dropped during projection (the web <c>filter((d) =&gt; d.timestamp)</c>).
/// </summary>
/// <param name="TimestampRaw">Row timestamp string (backend <c>created_at</c>/<c>ts</c>; web <c>timestamp</c>), or null.</param>
/// <param name="FrontLeftKpa">Front-left pressure in SI kilopascals (web <c>frontLeft</c>), or null.</param>
/// <param name="FrontRightKpa">Front-right pressure in SI kilopascals (web <c>frontRight</c>), or null.</param>
/// <param name="RearLeftKpa">Rear-left pressure in SI kilopascals (web <c>rearLeft</c>), or null.</param>
/// <param name="RearRightKpa">Rear-right pressure in SI kilopascals (web <c>rearRight</c>), or null.</param>
public sealed record TirePressureSample(
    string? TimestampRaw,
    double? FrontLeftKpa,
    double? FrontRightKpa,
    double? RearLeftKpa,
    double? RearRightKpa)
{
    /// <summary>Parse a <c>GET /tire-pressure</c> JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<TirePressureSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TirePressureSample>();
        }

        var list = new List<TirePressureSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single TPMS-timeline JSON object into a tolerant row.</summary>
    public static TirePressureSample FromJson(JsonElement obj) => new(
        ReadTimestamp(obj),
        ReadDouble(obj, "front_left"),
        ReadDouble(obj, "front_right"),
        ReadDouble(obj, "rear_left"),
        ReadDouble(obj, "rear_right"));

    // The Go List handler sets row["created_at"] = ts (and row["ts"] = ts); the web type declares
    // `timestamp`. Resolve in that order so the real backend shape and the web contract both work.
    private static string? ReadTimestamp(JsonElement obj)
    {
        string? createdAt = ReadString(obj, "created_at");
        if (!string.IsNullOrEmpty(createdAt))
        {
            return createdAt;
        }

        string? ts = ReadString(obj, "ts");
        if (!string.IsNullOrEmpty(ts))
        {
            return ts;
        }

        string? timestamp = ReadString(obj, "timestamp");
        return string.IsNullOrEmpty(timestamp) ? null : timestamp;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? ReadDouble(JsonElement obj, string name)
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx (note: the web compact test keys off
/// <em>columns only</em>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct TirePressureHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static TirePressureHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): hide the title and chart, show the stats only.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/> ("FL"/"FR"/"RL"/"RR"), the formatted
/// latest <see cref="Value"/> (a one-decimal pressure or the em dash), the optional <see cref="Unit"/>
/// suffix (<c>kPa</c> / <c>psi</c> / <c>bar</c>), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record TirePressureSummaryStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the tire-pressure history for one footprint and unit preference
/// — the native analogue of everything the web component computes via <c>useMemo</c> before returning JSX.
/// Holds the four summary stats and the four line-chart series (FL / FR / RL / RR, already converted to the
/// display pressure unit and ordered chronologically) plus the recommended-range reference lines. Each series
/// carries a <see cref="ChartPoint"/> only where that reading is present, so the chart bridges gaps exactly
/// like the web Recharts <c>connectNulls</c>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True at a single column: render the stats only, no chart.</param>
/// <param name="HasData">Whether any timestamped row exists (web <c>hasData = chartData.length &gt; 0</c>).</param>
/// <param name="Stats">The FL / FR / RL / RR latest-value summary stats (empty when <paramref name="HasData"/> is false).</param>
/// <param name="FrontLeftPoints">Front-left series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="FrontRightPoints">Front-right series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="RearLeftPoints">Rear-left series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="RearRightPoints">Rear-right series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="FrontLeftSeriesName">Localized front-left series name ("FL").</param>
/// <param name="FrontRightSeriesName">Localized front-right series name ("FR").</param>
/// <param name="RearLeftSeriesName">Localized rear-left series name ("RL").</param>
/// <param name="RearRightSeriesName">Localized rear-right series name ("RR").</param>
/// <param name="RecommendedLowDisplay">Recommended-range lower bound in the display unit (web "Min" line).</param>
/// <param name="RecommendedHighDisplay">Recommended-range upper bound in the display unit (web "Max" line).</param>
/// <param name="ShowRecommendedLow">Whether the "Min" line falls inside the plotted data domain (Recharts discard-on-overflow parity).</param>
/// <param name="ShowRecommendedHigh">Whether the "Max" line falls inside the plotted data domain.</param>
/// <param name="MinLabel">Localized "Min" reference-line label.</param>
/// <param name="MaxLabel">Localized "Max" reference-line label.</param>
/// <param name="CompactAutomationName">Narrator name summarising the stat row (compact layout).</param>
public sealed record TirePressureHistoryDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<TirePressureSummaryStat> Stats,
    IReadOnlyList<ChartPoint> FrontLeftPoints,
    IReadOnlyList<ChartPoint> FrontRightPoints,
    IReadOnlyList<ChartPoint> RearLeftPoints,
    IReadOnlyList<ChartPoint> RearRightPoints,
    string FrontLeftSeriesName,
    string FrontRightSeriesName,
    string RearLeftSeriesName,
    string RearRightSeriesName,
    double RecommendedLowDisplay,
    double RecommendedHighDisplay,
    bool ShowRecommendedLow,
    bool ShowRecommendedHigh,
    string MinLabel,
    string MaxLabel,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw TPMS-timeline list to the display model — the native port of the
/// <c>buildChartData</c> / <c>stats</c> / <c>latestNonNull</c> <c>useMemo</c> work, the <c>hasData</c> /
/// <c>isCompact</c> gating, and the recommended-range reference lines in
/// web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx. Rows with no timestamp are dropped, the
/// rest are sorted chronologically by their timestamp string (the web <c>localeCompare</c>), and each corner
/// reading is converted from SI kilopascals to the user's display unit exactly as the web
/// <c>usePressureFormat().toPressureValue</c> (<c>convertPressureFromSI(_, unitPrefs.pressure)</c>) does.
/// Every label resolves through the i18n facade.
/// <para>
/// Recommended range: the web positions its two dashed reference lines via
/// <c>toPressureValue(RECOMMENDED_RANGE_BAR.{low,high} * 100_000)</c>. That arithmetic is a unit error — it
/// scales bar → pascals (×100 000) and then feeds the value to a <em>kilopascal</em> converter, landing the
/// lines at ≈2400 / 2800 bar, far outside any real tire-pressure axis, so Recharts' default
/// <c>ifOverflow="discard"</c> silently drops them. This port instead carries the recommended range in
/// canonical SI kilopascals (<see cref="RecommendedLowKpa"/> / <see cref="RecommendedHighKpa"/> = 240 / 280
/// kPa = 2.4 / 2.8 bar ≈ 35 / 41 psi — the web's own documented intent), converts it with the same
/// <see cref="UnitConverters.PressureFromSi"/> used for the data, and marks each line visible only when it
/// falls inside the plotted data domain — reproducing Recharts' discard-on-overflow semantics while making
/// the recommended-range overlay the registry promises actually render for in-band data.
/// </para>
/// </summary>
public static class TirePressureHistoryProjection
{
    /// <summary>Segoe Fluent "Tire Pressure" glyph for the surface header / empty state (web <c>CircleDot</c>).</summary>
    public const string HeaderGlyph = "\uE950";

    /// <summary>The em dash the web renders for an absent latest value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Pressure fraction digits for the summary stats (web <c>fmtNumber(val, 1)</c>).</summary>
    public const int PressurePrecision = 1;

    /// <summary>Recommended-range lower bound in SI kilopascals (web <c>RECOMMENDED_RANGE_BAR.low</c> = 2.4 bar).</summary>
    public const double RecommendedLowKpa = 240.0;

    /// <summary>Recommended-range upper bound in SI kilopascals (web <c>RECOMMENDED_RANGE_BAR.high</c> = 2.8 bar).</summary>
    public const double RecommendedHighKpa = 280.0;

    /// <summary>Categorical palette index for the front-left series (web <c>#3b82f6</c> blue).</summary>
    public const int FrontLeftColorIndex = 0;

    /// <summary>Categorical palette index for the front-right series (web <c>#06b6d4</c> cyan).</summary>
    public const int FrontRightColorIndex = 1;

    /// <summary>Categorical palette index for the rear-left series (web <c>#22c55e</c> green).</summary>
    public const int RearLeftColorIndex = 2;

    /// <summary>Categorical palette index for the rear-right series (web <c>#a855f7</c> purple).</summary>
    public const int RearRightColorIndex = 3;

    /// <summary>Project <paramref name="samples"/> for <paramref name="size"/> / <paramref name="units"/> using the localizer for every label.</summary>
    public static TirePressureHistoryDisplay Project(
        IReadOnlyList<TirePressureSample> samples,
        TirePressureHistorySize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: keep rows with a timestamp, then sort chronologically by the timestamp string
        // (the web localeCompare; OrderBy is a stable sort like JS Array.sort, so equal timestamps keep
        // their original order).
        var timestamped = new List<TirePressureSample>(samples.Count);
        foreach (var sample in samples)
        {
            if (!string.IsNullOrEmpty(sample.TimestampRaw))
            {
                timestamped.Add(sample);
            }
        }

        var ordered = timestamped.OrderBy(static s => s.TimestampRaw, StringComparer.Ordinal).ToList();

        var flPoints = new List<ChartPoint>(ordered.Count);
        var frPoints = new List<ChartPoint>(ordered.Count);
        var rlPoints = new List<ChartPoint>(ordered.Count);
        var rrPoints = new List<ChartPoint>(ordered.Count);
        double? latestFl = null;
        double? latestFr = null;
        double? latestRl = null;
        double? latestRr = null;
        double domainMin = double.PositiveInfinity;
        double domainMax = double.NegativeInfinity;

        for (int i = 0; i < ordered.Count; i++)
        {
            AddPoint(ordered[i].FrontLeftKpa, i, units, flPoints, ref latestFl, ref domainMin, ref domainMax);
            AddPoint(ordered[i].FrontRightKpa, i, units, frPoints, ref latestFr, ref domainMin, ref domainMax);
            AddPoint(ordered[i].RearLeftKpa, i, units, rlPoints, ref latestRl, ref domainMin, ref domainMax);
            AddPoint(ordered[i].RearRightKpa, i, units, rrPoints, ref latestRr, ref domainMin, ref domainMax);
        }

        bool hasData = ordered.Count > 0;
        string unit = UnitLabels.Label(units.Pressure);
        string flLabel = localizer.GetString("widget.tirePressureHistory.fl", "FL");
        string frLabel = localizer.GetString("widget.tirePressureHistory.fr", "FR");
        string rlLabel = localizer.GetString("widget.tirePressureHistory.rl", "RL");
        string rrLabel = localizer.GetString("widget.tirePressureHistory.rr", "RR");

        var stats = hasData
            ? new List<TirePressureSummaryStat>(4)
            {
                BuildStat(flLabel, latestFl, unit),
                BuildStat(frLabel, latestFr, unit),
                BuildStat(rlLabel, latestRl, unit),
                BuildStat(rrLabel, latestRr, unit),
            }
            : new List<TirePressureSummaryStat>();

        double recommendedLow = UnitConverters.PressureFromSi(RecommendedLowKpa, units.Pressure);
        double recommendedHigh = UnitConverters.PressureFromSi(RecommendedHighKpa, units.Pressure);
        bool hasDomain = domainMax >= domainMin;

        return new TirePressureHistoryDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            Stats: stats,
            FrontLeftPoints: flPoints,
            FrontRightPoints: frPoints,
            RearLeftPoints: rlPoints,
            RearRightPoints: rrPoints,
            FrontLeftSeriesName: flLabel,
            FrontRightSeriesName: frLabel,
            RearLeftSeriesName: rlLabel,
            RearRightSeriesName: rrLabel,
            RecommendedLowDisplay: recommendedLow,
            RecommendedHighDisplay: recommendedHigh,
            ShowRecommendedLow: hasDomain && recommendedLow >= domainMin && recommendedLow <= domainMax,
            ShowRecommendedHigh: hasDomain && recommendedHigh >= domainMin && recommendedHigh <= domainMax,
            MinLabel: localizer.GetString("widget.tirePressureHistory.min", "Min"),
            MaxLabel: localizer.GetString("widget.tirePressureHistory.max", "Max"),
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static void AddPoint(
        double? kpa,
        int index,
        UnitPref units,
        List<ChartPoint> points,
        ref double? latest,
        ref double domainMin,
        ref double domainMax)
    {
        if (!IsFinite(kpa))
        {
            return;
        }

        double v = UnitConverters.PressureFromSi(kpa!.Value, units.Pressure);
        points.Add(new ChartPoint(index, v));
        latest = v;
        domainMin = Math.Min(domainMin, v);
        domainMax = Math.Max(domainMax, v);
    }

    // Web parity: val != null ? fmtNumber(val, 1) : '—', with the pressure unit suffix.
    private static TirePressureSummaryStat BuildStat(string label, double? displayValue, string unit)
    {
        bool present = IsFinite(displayValue);
        string value = present ? ScalarFormatters.FormatNumber(displayValue, PressurePrecision) : EmDash;
        string automation = present
            ? string.Create(CultureInfo.CurrentCulture, $"{label}: {value} {unit}")
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {value}");
        return new TirePressureSummaryStat(label, value, unit, automation);
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<TirePressureSummaryStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    private static bool IsFinite(double? value) =>
        value is { } d && !double.IsNaN(d) && !double.IsInfinity(d);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TirePressureSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model, not here, so a
/// populated-but-untimestamped list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TirePressureHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<TirePressureSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TirePressureSample> Parse() =>
            raw.HasValue ? TirePressureSample.ParseList(raw.Value) : Array.Empty<TirePressureSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TirePressureSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TirePressureSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TirePressureSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TirePressureSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
