using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="MonthlyMileageViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>MonthlyMileageWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 0 &amp;&amp; chartData.some(d =&gt; d.distance &gt; 0)</c> — no
/// month with any distance) — the friendly "No mileage data" empty state — distinct from a transport
/// failure (<see cref="Error"/>).
/// </summary>
public enum MonthlyMileageState
{
    /// <summary>Initial fetch with no cached months — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one month with distance to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no months with any distance — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One monthly mileage bucket projected from the <c>GET /mileage/monthly</c> envelope's <c>months</c>
/// array (web <c>MonthlyMileageBucket</c> in web/src/types/analytics.ts). Only the two fields the web
/// <c>MonthlyMileageWidget</c> chart reads are kept: the calendar month key (<c>year_month</c>, rendered
/// 'YYYY-MM') and the distance driven that month in kilometres (<c>total_km</c>, restated to SI metres at
/// projection time so the shared SI converter applies). Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial row never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="YearMonth">The 'YYYY-MM' calendar key, or empty string (web <c>year_month</c>).</param>
/// <param name="TotalKm">Distance driven that month in kilometres (web <c>total_km ?? 0</c>).</param>
public sealed record MonthlyMileageBucket(string YearMonth, double TotalKm)
{
    /// <summary>
    /// Parse the <c>GET /mileage/monthly</c> envelope (<c>{vehicle_id, months}</c>) into a tolerant list of
    /// buckets, preserving order. Mirrors the web hook's <c>select: (resp) =&gt; safeArray(resp?.months)</c>:
    /// a missing / non-array <c>months</c> yields an empty list.
    /// </summary>
    public static IReadOnlyList<MonthlyMileageBucket> ParseEnvelope(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("months", out var months) ||
            months.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MonthlyMileageBucket>();
        }

        var list = new List<MonthlyMileageBucket>(months.GetArrayLength());
        foreach (var item in months.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single month JSON object into a tolerant bucket.</summary>
    public static MonthlyMileageBucket FromJson(JsonElement obj) => new(
        GetString(obj, "year_month") ?? string.Empty,
        GetDouble(obj, "total_km") ?? 0);

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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> and <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx (note: this surface gates compact/wide on
/// the COLUMN count only).
/// </summary>
public readonly record struct MonthlyMileageSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static MonthlyMileageSize Default => new(2, 4);

    /// <summary>
    /// True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): hide the title and chart,
    /// showing the summary stats only.
    /// </summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>
    /// True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>): the chart axis labels use the
    /// roomier tick spacing.
    /// </summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>,
/// the optional <see cref="Unit"/> suffix (the distance unit), and a Narrator automation name. Pure data —
/// no WinUI types.
/// </summary>
public sealed record MonthlyMileageStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected, render-ready bar — the native analogue of a single web <c>BarDatum</c> + its
/// color-coded <c>&lt;Cell&gt;</c>. Holds the X-axis <see cref="MonthLabel"/> (short month name), the
/// display distance and its formatted text, whether it is the current calendar month
/// (<see cref="IsCurrent"/>, which the web tints accent-cyan vs. faint), the design-token
/// <see cref="ColorBrushKey"/> the bar fills with, the <see cref="HeightRatio"/> (0..1 of the tallest bar)
/// the view scales the bar to, and a Narrator automation name. Pure data so the geometry is unit-tested
/// without a UI host.
/// </summary>
public sealed record MonthlyMileageBar(
    string MonthLabel,
    double Distance,
    string ValueText,
    bool IsCurrent,
    string ColorBrushKey,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the monthly mileage chart for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// bars (already converted to the display unit, color-coded, chronological), the summary stats, the
/// resolved distance unit label, and the footprint flags. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record MonthlyMileageDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    string DistanceUnitLabel,
    string DistanceSeriesLabel,
    IReadOnlyList<MonthlyMileageStat> Stats,
    IReadOnlyList<MonthlyMileageBar> Bars,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw monthly-mileage list to the display model — the native port of the
/// <c>chartData</c> / <c>totalDistance</c> / <c>currentMonthDistance</c> <c>useMemo</c> work, the
/// current-month color-coding and the <c>hasData</c> / <c>isCompact</c> / <c>isWide</c> gating in
/// web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx. Distance is converted from the wire
/// kilometres to SI metres (<c>* 1000</c>) and then to the user's display unit exactly as the web
/// <c>convertDistanceFromSI(total_km * 1000, unit)</c> does; every label resolves through the i18n facade;
/// the current-month bar maps onto the shared accent design-token brush.
/// </summary>
public static class MonthlyMileageProjection
{
    /// <summary>Segoe Fluent "BarChart3" glyph for the surface header / empty state (web <c>BarChart3</c>).</summary>
    public const string HeaderGlyph = "\uE9D9";

    /// <summary>Design-token brush for the current calendar month's bar (web accent cyan <c>#22d3ee</c>).</summary>
    public const string CurrentBrushKey = "TsColorAccentBrush";

    /// <summary>Design-token brush for the other months' bars (web faint <c>rgba(255,255,255,0.1)</c>).</summary>
    public const string OtherBrushKey = "TsColorBorderBrush";

    /// <summary>Metres per kilometre — restates the wire <c>total_km</c> to SI before conversion.</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>The trailing window the chart shows (web <c>items.slice(-12)</c>).</summary>
    public const int WindowMonths = 12;

    /// <summary>
    /// Project <paramref name="buckets"/> for <paramref name="size"/> using the user's units and the
    /// localizer for every label, treating <paramref name="now"/> as the reference month for the
    /// current-month highlight.
    /// </summary>
    /// <param name="buckets">The monthly buckets, oldest-first (the backend orders by calendar month).</param>
    /// <param name="size">The widget footprint (drives the compact / wide branches).</param>
    /// <param name="units">The user's unit preference (the distance display unit).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant whose calendar month is highlighted.</param>
    public static MonthlyMileageDisplay Project(
        IReadOnlyList<MonthlyMileageBucket> buckets,
        MonthlyMileageSize size,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(buckets);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string distanceSeriesLabel = localizer.GetString("widget.monthlyMileage.distance", "Distance");
        string currentKey = CurrentMonthKey(now);
        string thisMonthLabel = localizer.GetString("widget.monthlyMileage.thisMonth", "This Month");

        var bars = BuildBars(buckets, distanceUnit, distanceUnitLabel, currentKey, thisMonthLabel);

        // Web parity: hasData = chartData.length > 0 && chartData.some(d => d.distance > 0).
        bool hasData = bars.Count > 0 && bars.Exists(b => b.Distance > 0);

        double totalDistance = 0;
        double currentMonthDistance = 0;
        foreach (var bar in bars)
        {
            totalDistance += bar.Distance;
            if (bar.IsCurrent)
            {
                currentMonthDistance = bar.Distance;
            }
        }

        IReadOnlyList<MonthlyMileageStat> stats = hasData
            ? BuildStats(currentMonthDistance, totalDistance, distanceUnitLabel, localizer)
            : Array.Empty<MonthlyMileageStat>();

        return new MonthlyMileageDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: hasData,
            DistanceUnitLabel: distanceUnitLabel,
            DistanceSeriesLabel: distanceSeriesLabel,
            Stats: stats,
            Bars: bars,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    /// <summary>
    /// Format a 'YYYY-MM' key to its short English month name (web <c>shortMonth</c>'s fixed Jan..Dec
    /// array, reproduced via the invariant culture's abbreviated month names). Falls back to the raw key
    /// when it is not a parseable 'YYYY-MM'.
    /// </summary>
    public static string ShortMonth(string iso)
    {
        if (string.IsNullOrEmpty(iso))
        {
            return iso;
        }

        var parts = iso.Split('-');
        if (parts.Length < 2 ||
            !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int month) ||
            month < 1 || month > 12)
        {
            return iso;
        }

        return CultureInfo.InvariantCulture.DateTimeFormat.AbbreviatedMonthNames[month - 1];
    }

    /// <summary>
    /// The 'YYYY-MM' key for <paramref name="now"/>'s calendar month (web <c>currentMonthKey</c>, which
    /// reads the reference clock's local year and month).
    /// </summary>
    public static string CurrentMonthKey(DateTimeOffset now) =>
        now.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    private static List<MonthlyMileageBar> BuildBars(
        IReadOnlyList<MonthlyMileageBucket> buckets,
        DistanceUnit distanceUnit,
        string distanceUnitLabel,
        string currentKey,
        string thisMonthLabel)
    {
        // Web parity: items.slice(-12) keeps the most-recent twelve buckets in chronological order.
        int start = Math.Max(0, buckets.Count - WindowMonths);
        int take = buckets.Count - start;

        var distances = new double[take];
        double max = 0;
        for (int i = 0; i < take; i++)
        {
            double value = UnitConverters.DistanceFromSi(buckets[start + i].TotalKm * MetersPerKm, distanceUnit);
            distances[i] = value;
            if (value > max)
            {
                max = value;
            }
        }

        var bars = new List<MonthlyMileageBar>(take);
        for (int i = 0; i < take; i++)
        {
            var bucket = buckets[start + i];
            bool isCurrent = string.Equals(bucket.YearMonth, currentKey, StringComparison.Ordinal);
            string monthLabel = ShortMonth(bucket.YearMonth);
            string valueText = Fmt(distances[i], 1);
            double ratio = max > 0 ? Math.Clamp(distances[i] / max, 0.0, 1.0) : 0.0;

            bars.Add(new MonthlyMileageBar(
                MonthLabel: monthLabel,
                Distance: distances[i],
                ValueText: valueText,
                IsCurrent: isCurrent,
                ColorBrushKey: isCurrent ? CurrentBrushKey : OtherBrushKey,
                HeightRatio: ratio,
                AutomationName: BarAutomationName(monthLabel, valueText, distanceUnitLabel, isCurrent, thisMonthLabel)));
        }

        return bars;
    }

    private static List<MonthlyMileageStat> BuildStats(
        double currentMonthDistance,
        double totalDistance,
        string distanceUnitLabel,
        ILocalizer localizer)
    {
        string thisMonthLabel = localizer.GetString("widget.monthlyMileage.thisMonth", "This Month");
        string total12mLabel = localizer.GetString("widget.monthlyMileage.total12m", "12-Mo Total");

        // Web parity: both stats use fmtInt (zero fraction digits) with the distance unit suffix.
        string thisMonthValue = Fmt(currentMonthDistance, 0);
        string total12mValue = Fmt(totalDistance, 0);

        return new List<MonthlyMileageStat>(2)
        {
            new(thisMonthLabel, thisMonthValue, distanceUnitLabel, StatAutomationName(thisMonthLabel, thisMonthValue, distanceUnitLabel)),
            new(total12mLabel, total12mValue, distanceUnitLabel, StatAutomationName(total12mLabel, total12mValue, distanceUnitLabel)),
        };
    }

    private static string StatAutomationName(string label, string value, string unit) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);

    private static string BarAutomationName(string month, string value, string unit, bool isCurrent, string thisMonthLabel) =>
        isCurrent
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}, {3}", month, value, unit, thisMonthLabel)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", month, value, unit);

    private static IEnumerable<string> AutomationParts(IReadOnlyList<MonthlyMileageStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmtInt</c> / <c>fmtNumber</c> does: coerce null / NaN / ±∞ to
    /// 0 (web <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and
    /// en-US grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions (the <c>GET /mileage/monthly</c>
/// envelope) onto parsed <c>RepositoryResult&lt;IReadOnlyList&lt;MonthlyMileageBucket&gt;&gt;</c>, preserving
/// every freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
/// matrix. The <c>hasData</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model,
/// not here, so an empty list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MonthlyMileageResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s envelope payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<MonthlyMileageBucket>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<MonthlyMileageBucket> Parse() =>
            raw.HasValue ? MonthlyMileageBucket.ParseEnvelope(raw.Value) : Array.Empty<MonthlyMileageBucket>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
