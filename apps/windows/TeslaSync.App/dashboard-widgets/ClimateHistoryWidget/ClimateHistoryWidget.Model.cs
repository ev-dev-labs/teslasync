using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ClimateHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ClimateHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 0</c> — no timestamped climate row) — the friendly
/// "No climate history" empty state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ClimateHistoryState
{
    /// <summary>Initial fetch with no cached history — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one timestamped climate row to chart.</summary>
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
/// One climate-timeline row from the <c>GET /climate</c> change feed (web <c>ClimateState</c> in
/// web/src/types/vehicle-systems.ts). Only the three fields the web <c>ClimateHistoryWidget</c> chart reads
/// are projected: the row timestamp (web <c>created_at ?? timestamp</c>) and the SI cabin / ambient
/// temperatures in degrees Celsius (web <c>insideTemp</c> / <c>outsideTemp</c>, read here under the
/// canonical snake_case wire names <c>inside_temp</c> / <c>outside_temp</c> the Go handler emits — the web
/// reads the <c>camelCaseKeys</c> aliases of the very same fields). Parsing is null-tolerant so a partial
/// row never throws: an absent / non-numeric temperature parses to <see langword="null"/> (the web
/// <c>!= null</c> guard → a gap the chart bridges), and a row with no timestamp is dropped during
/// projection (the web <c>filter((d) =&gt; d.created_at || d.timestamp)</c>).
/// </summary>
/// <param name="TimestampRaw">Row timestamp string (web <c>created_at ?? timestamp</c>), or null.</param>
/// <param name="InsideTempC">Cabin temperature in SI Celsius (web <c>insideTemp</c>), or null.</param>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius (web <c>outsideTemp</c>), or null.</param>
public sealed record ClimateHistorySample(string? TimestampRaw, double? InsideTempC, double? OutsideTempC)
{
    /// <summary>Parse a <c>GET /climate</c> JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<ClimateHistorySample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ClimateHistorySample>();
        }

        var list = new List<ClimateHistorySample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single climate-timeline JSON object into a tolerant row.</summary>
    public static ClimateHistorySample FromJson(JsonElement obj) => new(
        ReadTimestamp(obj),
        ReadDouble(obj, "inside_temp"),
        ReadDouble(obj, "outside_temp"));

    // Web parity: d.created_at ?? d.timestamp ?? '' — the first non-empty timestamp wins; both absent → null.
    private static string? ReadTimestamp(JsonElement obj)
    {
        string? createdAt = ReadString(obj, "created_at");
        if (!string.IsNullOrEmpty(createdAt))
        {
            return createdAt;
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
/// web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx (note: the web compact test keys off
/// <em>columns only</em>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ClimateHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ClimateHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): hide the title and chart, show the stats only.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/> ("Cabin" / "Outside"), the formatted
/// latest <see cref="Value"/> (an integer temperature or the em dash), the optional <see cref="Unit"/>
/// suffix (<c>°C</c> / <c>°F</c>), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ClimateHistorySummaryStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the climate history for one footprint and unit preference —
/// the native analogue of everything the web component computes via <c>useMemo</c> before returning JSX.
/// Holds the two summary stats and the two area-chart series (cabin / outside, already converted to the
/// display temperature unit and ordered chronologically). Each series carries a <see cref="ChartPoint"/>
/// only where that reading is present, so the chart bridges gaps exactly like the web Recharts
/// <c>connectNulls</c>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True at a single column: render the stats only, no chart.</param>
/// <param name="HasData">Whether any timestamped row exists (web <c>hasData = chartData.length &gt; 0</c>).</param>
/// <param name="Stats">The Cabin / Outside latest-value summary stats (empty when <paramref name="HasData"/> is false).</param>
/// <param name="InsidePoints">Cabin series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="OutsidePoints">Outside series points (ordinal X, display-unit Y), gaps omitted.</param>
/// <param name="InsideSeriesName">Localized cabin series name ("Cabin").</param>
/// <param name="OutsideSeriesName">Localized outside series name ("Outside").</param>
/// <param name="CompactAutomationName">Narrator name summarising the stat row (compact layout).</param>
public sealed record ClimateHistoryDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<ClimateHistorySummaryStat> Stats,
    IReadOnlyList<ChartPoint> InsidePoints,
    IReadOnlyList<ChartPoint> OutsidePoints,
    string InsideSeriesName,
    string OutsideSeriesName,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw climate-timeline list to the display model — the native port of the
/// <c>buildChartData</c> / <c>stats</c> / <c>latestInside</c> / <c>latestOutside</c> <c>useMemo</c> work and
/// the <c>hasData</c> / <c>isCompact</c> gating in
/// web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx. Rows with no timestamp are dropped, the rest
/// are sorted chronologically by their timestamp string (the web <c>localeCompare</c>), and each cabin /
/// outside reading is converted from SI Celsius to the user's display unit exactly as the web
/// <c>convertTempFromSI(_, unitPrefs.temperature)</c> does. Every label resolves through the i18n facade.
/// </summary>
public static class ClimateHistoryProjection
{
    /// <summary>Segoe Fluent "Temperature" glyph for the surface header / empty state (web <c>ThermometerSun</c>).</summary>
    public const string HeaderGlyph = "\uE9CA";

    /// <summary>The em dash the web renders for an absent latest value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Temperature fraction digits for the summary stats (web <c>fmtInt</c> = <c>fmtNumber(…, 0)</c>).</summary>
    public const int TemperaturePrecision = 0;

    /// <summary>
    /// Categorical palette index for the cabin (inside) series — a warm hue (TsChart02 ≈ #E69F00)
    /// reproducing the web inside gradient (<c>#f97316</c>).
    /// </summary>
    public const int InsideColorIndex = 1;

    /// <summary>
    /// Categorical palette index for the outside series — a cool hue (TsChart01 ≈ #0072B2)
    /// reproducing the web outside gradient (<c>#3b82f6</c>).
    /// </summary>
    public const int OutsideColorIndex = 0;

    /// <summary>Project <paramref name="samples"/> for <paramref name="size"/> / <paramref name="units"/> using the localizer for every label.</summary>
    public static ClimateHistoryDisplay Project(
        IReadOnlyList<ClimateHistorySample> samples,
        ClimateHistorySize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: keep rows with a timestamp, then sort chronologically by the timestamp string
        // (the web localeCompare; OrderBy is a stable sort like JS Array.sort, so equal timestamps keep
        // their original order).
        var timestamped = new List<ClimateHistorySample>(samples.Count);
        foreach (var sample in samples)
        {
            if (!string.IsNullOrEmpty(sample.TimestampRaw))
            {
                timestamped.Add(sample);
            }
        }

        var ordered = timestamped.OrderBy(static s => s.TimestampRaw, StringComparer.Ordinal).ToList();

        var insidePoints = new List<ChartPoint>(ordered.Count);
        var outsidePoints = new List<ChartPoint>(ordered.Count);
        double? latestInside = null;
        double? latestOutside = null;

        for (int i = 0; i < ordered.Count; i++)
        {
            if (IsFinite(ordered[i].InsideTempC))
            {
                double v = UnitConverters.TemperatureFromSi(ordered[i].InsideTempC!.Value, units.Temperature);
                insidePoints.Add(new ChartPoint(i, v));
                latestInside = v;
            }

            if (IsFinite(ordered[i].OutsideTempC))
            {
                double v = UnitConverters.TemperatureFromSi(ordered[i].OutsideTempC!.Value, units.Temperature);
                outsidePoints.Add(new ChartPoint(i, v));
                latestOutside = v;
            }
        }

        bool hasData = ordered.Count > 0;
        string unit = UnitLabels.Label(units.Temperature);
        string cabinLabel = localizer.GetString("widget.climateHistory.cabin", "Cabin");
        string outsideLabel = localizer.GetString("widget.climateHistory.outside", "Outside");

        var stats = hasData
            ? new List<ClimateHistorySummaryStat>(2)
            {
                BuildStat(cabinLabel, latestInside, unit),
                BuildStat(outsideLabel, latestOutside, unit),
            }
            : new List<ClimateHistorySummaryStat>();

        return new ClimateHistoryDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            Stats: stats,
            InsidePoints: insidePoints,
            OutsidePoints: outsidePoints,
            InsideSeriesName: cabinLabel,
            OutsideSeriesName: outsideLabel,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    // Web parity: latest != null ? fmtInt(latest) : '—', with the temperature unit suffix.
    private static ClimateHistorySummaryStat BuildStat(string label, double? displayValue, string unit)
    {
        bool present = IsFinite(displayValue);
        string value = present ? ScalarFormatters.FormatNumber(displayValue, TemperaturePrecision) : EmDash;
        string automation = present
            ? string.Create(CultureInfo.CurrentCulture, $"{label}: {value}{unit}")
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {value}");
        return new ClimateHistorySummaryStat(label, value, unit, automation);
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<ClimateHistorySummaryStat> stats)
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
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ClimateHistorySample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model, not here, so a
/// populated-but-untimestamped list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ClimateHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ClimateHistorySample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ClimateHistorySample> Parse() =>
            raw.HasValue ? ClimateHistorySample.ParseList(raw.Value) : Array.Empty<ClimateHistorySample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ClimateHistorySample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
