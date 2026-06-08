using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DriveEfficiencyChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DriveEfficiencyChartWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>displayData.length === 0</c> — no drive yielded a usable efficiency sample in the last 30
/// days) — the friendly "No efficiency data yet" empty state — distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum DriveEfficiencyChartState
{
    /// <summary>Initial fetch with no cached drives — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) yielding at least one daily efficiency point.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no usable efficiency samples — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive projected from the drive list (web <c>Drive</c> in web/src/api/types.ts). Only the five fields
/// the web <c>DriveEfficiencyChartWidget</c> reads to estimate efficiency are kept: the SI distance in
/// meters (<c>distance_m</c>), the SI energy used in watt-hours (<c>energy_used_wh</c>), the start/end
/// state-of-charge percentages (<c>start_soc_pct</c> / <c>end_soc_pct</c>, used for the battery fallback),
/// and the <c>start_ts</c> instant — kept both as the raw ISO string (for the <c>slice(0, 10)</c> date-key
/// grouping the web does) and as a parsed instant (for the 30-day cutoff). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="DistanceM">Distance travelled in meters (web <c>distance_m ?? 0</c>).</param>
/// <param name="EnergyUsedWh">Energy used in watt-hours, or null (web <c>energy_used_wh</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct</c>).</param>
/// <param name="StartTimestamp">Raw <c>start_ts</c> ISO string used for the date-key slice, or null.</param>
/// <param name="StartInstant">Parsed <c>start_ts</c> instant used for the 30-day cutoff, or null.</param>
public sealed record DriveEfficiencyDrive(
    double DistanceM,
    double? EnergyUsedWh,
    double? StartSocPct,
    double? EndSocPct,
    string? StartTimestamp,
    DateTimeOffset? StartInstant)
{
    /// <summary>Parse a drive-list JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<DriveEfficiencyDrive> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveEfficiencyDrive>();
        }

        var list = new List<DriveEfficiencyDrive>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive JSON object into a tolerant row.</summary>
    public static DriveEfficiencyDrive FromJson(JsonElement obj) => new(
        GetDouble(obj, "distance_m") ?? 0,
        GetDouble(obj, "energy_used_wh"),
        GetDouble(obj, "start_soc_pct"),
        GetDouble(obj, "end_soc_pct"),
        GetString(obj, "start_ts"),
        GetDateTime(obj, "start_ts"));

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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx.
/// </summary>
public readonly record struct DriveEfficiencyChartSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static DriveEfficiencyChartSize Default => new(2, 4);

    /// <summary>
    /// True at a single cell (web <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>): hide
    /// the title, chart and legend, showing the summary stats only.
    /// </summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>, the
/// optional <see cref="Unit"/> suffix (<c>Wh/mi</c> / <c>Wh/km</c>, absent for the Trend percentage) and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record DriveEfficiencyChartStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected daily efficiency point — the native analogue of a web <c>DailyEfficiency</c> after unit
/// conversion. Holds the source <see cref="Date"/> bucket (YYYY-MM-DD), the formatted axis
/// <see cref="Label"/> ("MMM d"), the daily-average <see cref="Efficiency"/> and the optional 7-day
/// <see cref="RollingAvg"/> — both already in the user's display unit (Wh/mi or Wh/km). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record DriveEfficiencyDailyPoint(string Date, string Label, double Efficiency, double? RollingAvg);

/// <summary>
/// One legend entry — a series swatch and its localized name (web's two-dot legend: "Daily" + "7-day avg").
/// Pure data so the view binds <see cref="ColorBrushKey"/> to a chart-palette brush that matches the series.
/// </summary>
public sealed record DriveEfficiencyLegendItem(string Label, string ColorBrushKey);

/// <summary>
/// The fully projected, render-ready view of the drive-efficiency chart for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// summary stats, the daily efficiency points (already in display units, chronological), the localized
/// series names, the overall-average reference line and the legend. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record DriveEfficiencyChartDisplay(
    bool IsCompact,
    bool IsEmpty,
    IReadOnlyList<DriveEfficiencyChartStat> Stats,
    IReadOnlyList<DriveEfficiencyDailyPoint> Points,
    string EfficiencyUnit,
    bool HasReferenceLine,
    double ReferenceValue,
    string DailySeriesName,
    string RollingSeriesName,
    IReadOnlyList<DriveEfficiencyLegendItem> Legend,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw drive list to the display model — the native port of the
/// <c>estimateEfficiency</c> / <c>buildDailyEfficiency</c> / <c>displayData</c> / <c>stats</c>
/// <c>useMemo</c> work and the <c>isCompact</c> / <c>isEmpty</c> gating in
/// web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx. Efficiency is estimated in Wh/km then
/// converted to the user's distance unit at the display boundary (web multiplies by 1.609344 for miles);
/// every label resolves through the i18n facade; the daily / rolling series colours map onto the shared
/// chart palette so the legend stays consistent with the plotted series.
/// </summary>
public static class DriveEfficiencyChartProjection
{
    /// <summary>Segoe Fluent "trending up" glyph for the surface header / empty state (web <c>TrendingUp</c>).</summary>
    public const string HeaderGlyph = "\uE9D2";

    /// <summary>The chart-palette brush key the header icon and daily series share (web <c>palette.series[0]</c>, cyan).</summary>
    public const string HeaderAccentBrushKey = "TsChart01Brush";

    /// <summary>Most-recent drives retained before the 30-day filter (web query <c>limit=60</c>).</summary>
    public const int QueryLimit = 60;

    /// <summary>Trailing window (in days) the chart covers (web <c>cutoff = now - 30 days</c>).</summary>
    public const int WindowDays = 30;

    /// <summary>Rolling-average window size in days (web <c>buildDailyEfficiency(_, 7, _)</c>).</summary>
    public const int RollingWindow = 7;

    /// <summary>Minimum rolling-window samples before an average is emitted (web <c>window.length &gt;= 2</c>).</summary>
    public const int RollingMinSamples = 2;

    /// <summary>Meters per kilometer (web <c>convertDistanceFromSI(_, 'km')</c> divides distance by this).</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Smallest drive (km) that contributes an efficiency sample (web <c>distanceKm &lt; 0.8</c> skip).</summary>
    public const double MinDistanceKm = 0.8;

    /// <summary>Lower plausibility bound for a Wh/km sample (web <c>whPerKm &lt; 30</c> reject).</summary>
    public const double MinWhPerKm = 30.0;

    /// <summary>Upper plausibility bound for a Wh/km sample (web <c>whPerKm &gt; 500</c> reject).</summary>
    public const double MaxWhPerKm = 500.0;

    /// <summary>Usable fraction of pack energy assumed in the SoC fallback (web <c>battUsed * 0.75</c>).</summary>
    public const double BatteryUsableFraction = 0.75;

    /// <summary>Watt-hours per battery percent of a nominal pack in the SoC fallback (web <c>* 1000</c>).</summary>
    public const double WhPerSocPercent = 1000.0;

    /// <summary>Miles per kilometer (web <c>* 1.609344</c> when the distance unit is miles).</summary>
    public const double MilesPerKm = 1.609344;

    /// <summary>Palette index for the daily-efficiency area series (web <c>palette.series[0]</c>).</summary>
    public const int DailyColorIndex = 0;

    /// <summary>Palette index for the 7-day rolling-average line series (web amber overlay).</summary>
    public const int RollingColorIndex = 1;

    /// <summary>Distance points before the trend split is computed (web <c>displayData.length &lt; 4</c>).</summary>
    public const int TrendMinPoints = 4;

    private const string EmDash = "\u2014";
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>
    /// Estimate Wh/km for a single drive — the native port of the web <c>estimateEfficiency</c>: prefer the
    /// measured <c>energy_used_wh / distanceKm</c>, else fall back to <c>(battUsed * 0.75 * 1000) /
    /// distanceKm</c> from the start/end SoC delta. Returns null for tiny drives (&lt; 0.8 km) or
    /// implausible samples (outside 30..500 Wh/km), exactly as the web does.
    /// </summary>
    public static double? EstimateEfficiencyWhPerKm(DriveEfficiencyDrive drive)
    {
        ArgumentNullException.ThrowIfNull(drive);

        double distanceKm = drive.DistanceM / MetersPerKm;

        // Web parity: `!distanceKm || distanceKm < 0.8` — skip tiny (and zero / non-finite) drives.
        if (!(distanceKm >= MinDistanceKm))
        {
            return null;
        }

        if (drive.EnergyUsedWh is { } energy && energy > 0)
        {
            double whPerKm = energy / distanceKm;
            return InRange(whPerKm) ? whPerKm : null;
        }

        // Fallback: estimate from the battery percentage delta.
        if (drive.StartSocPct is not { } startBatt || drive.EndSocPct is not { } endBatt)
        {
            return null;
        }

        double battUsed = startBatt - endBatt;
        if (battUsed <= 0)
        {
            return null;
        }

        double fallback = (battUsed * BatteryUsableFraction * WhPerSocPercent) / distanceKm;
        return InRange(fallback) ? fallback : null;
    }

    /// <summary>Project <paramref name="drives"/> for <paramref name="size"/> using the localizer for every label.</summary>
    /// <param name="drives">The drive list, newest-first (the backend orders <c>started_at DESC</c>).</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="units">The user's unit preference (drives the Wh/mi vs Wh/km conversion + label).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant for the 30-day cutoff.</param>
    public static DriveEfficiencyChartDisplay Project(
        IReadOnlyList<DriveEfficiencyDrive> drives,
        DriveEfficiencyChartSize size,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool miles = units.Distance == DistanceUnit.Mi;
        string efficiencyUnit = miles
            ? localizer.GetString("widget.driveEfficiencyChart.unitMi", "Wh/mi")
            : localizer.GetString("widget.driveEfficiencyChart.unitKm", "Wh/km");

        var points = BuildDaily(drives, miles, now);
        bool isEmpty = points.Count == 0;

        double? overallAvg = isEmpty ? null : Round1(Mean(points, static p => p.Efficiency));
        double? bestDay = isEmpty ? null : MinOf(points);
        double? trend = ComputeTrend(points);

        var stats = BuildStats(overallAvg, bestDay, trend, efficiencyUnit, localizer);
        var legend = BuildLegend(localizer);

        string daily = localizer.GetString("widget.driveEfficiencyChart.daily", "Daily");
        string rolling = localizer.GetString("widget.driveEfficiencyChart.rolling", "7-day avg");

        return new DriveEfficiencyChartDisplay(
            IsCompact: size.IsCompact,
            IsEmpty: isEmpty,
            Stats: stats,
            Points: points,
            EfficiencyUnit: efficiencyUnit,

            // Web parity: the overall-average reference line renders whenever there is data to anchor it to.
            HasReferenceLine: !isEmpty && overallAvg is { },
            ReferenceValue: overallAvg ?? 0,
            DailySeriesName: $"{daily} ({efficiencyUnit})",
            RollingSeriesName: $"{rolling} ({efficiencyUnit})",
            Legend: legend,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static List<DriveEfficiencyDailyPoint> BuildDaily(
        IReadOnlyList<DriveEfficiencyDrive> drives, bool miles, DateTimeOffset now)
    {
        DateTimeOffset cutoff = now.AddDays(-WindowDays);

        // Web parity: the query caps at the 60 most-recent drives (backend orders started_at DESC), then the
        // component filters those to the last 30 days. We sort newest-first defensively so the cap matches
        // regardless of transport ordering.
        var recent = new List<DriveEfficiencyDrive>(drives.Count);
        foreach (var drive in drives)
        {
            if (drive.StartInstant is { } && !string.IsNullOrEmpty(drive.StartTimestamp))
            {
                recent.Add(drive);
            }
        }

        recent.Sort(static (a, b) => b.StartInstant!.Value.CompareTo(a.StartInstant!.Value));

        var byDate = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        int considered = 0;
        foreach (var drive in recent)
        {
            if (considered >= QueryLimit)
            {
                break;
            }

            considered++;
            if (drive.StartInstant!.Value < cutoff)
            {
                continue;
            }

            double? eff = EstimateEfficiencyWhPerKm(drive);
            if (eff is not { } whPerKm)
            {
                continue;
            }

            string dateKey = DateKey(drive.StartTimestamp!);
            if (byDate.TryGetValue(dateKey, out var bucket))
            {
                bucket.Add(whPerKm);
            }
            else
            {
                byDate[dateKey] = new List<double>(1) { whPerKm };
            }
        }

        // Sort the day buckets ascending (web `[...byDate.entries()].sort(([a],[b]) => a.localeCompare(b))`).
        var sortedKeys = new List<string>(byDate.Keys);
        sortedKeys.Sort(StringComparer.Ordinal);

        // Unrounded daily averages (Wh/km) feed the rolling window; rounding happens at the display boundary.
        var dailyAvgKm = new double[sortedKeys.Count];
        for (int i = 0; i < sortedKeys.Count; i++)
        {
            var values = byDate[sortedKeys[i]];
            double sum = 0;
            foreach (double v in values)
            {
                sum += v;
            }

            dailyAvgKm[i] = sum / values.Count;
        }

        double factor = miles ? MilesPerKm : 1.0;
        var result = new List<DriveEfficiencyDailyPoint>(sortedKeys.Count);
        for (int i = 0; i < sortedKeys.Count; i++)
        {
            int windowStart = Math.Max(0, i - RollingWindow + 1);
            int windowCount = i - windowStart + 1;
            double? rollingKm = null;
            if (windowCount >= RollingMinSamples)
            {
                double sum = 0;
                for (int w = windowStart; w <= i; w++)
                {
                    sum += dailyAvgKm[w];
                }

                rollingKm = sum / windowCount;
            }

            double efficiency = Round1(Round1(dailyAvgKm[i]) * factor);
            double? rolling = rollingKm is { } rk ? Round1(Round1(rk) * factor) : null;

            result.Add(new DriveEfficiencyDailyPoint(
                Date: sortedKeys[i],
                Label: FormatDayLabel(sortedKeys[i]),
                Efficiency: efficiency,
                RollingAvg: rolling));
        }

        return result;
    }

    private static List<DriveEfficiencyChartStat> BuildStats(
        double? overallAvg, double? bestDay, double? trend, string efficiencyUnit, ILocalizer localizer)
    {
        string avgLabel = localizer.GetString("widget.driveEfficiencyChart.avg", "Avg");
        string avgValue = overallAvg is { } a ? Fmt(a, 0) : EmDash;

        string bestLabel = localizer.GetString("widget.driveEfficiencyChart.best", "Best day");
        string bestValue = bestDay is { } b ? Fmt(b, 0) : EmDash;

        string trendLabel = localizer.GetString("widget.driveEfficiencyChart.trend", "Trend");
        string trendValue = trend is { } t ? FormatTrend(t) : EmDash;

        return new List<DriveEfficiencyChartStat>(3)
        {
            new(avgLabel, avgValue, efficiencyUnit, MeasureAutomationName(avgLabel, avgValue, efficiencyUnit)),
            new(bestLabel, bestValue, efficiencyUnit, MeasureAutomationName(bestLabel, bestValue, efficiencyUnit)),
            new(trendLabel, trendValue, null, $"{trendLabel}: {trendValue}"),
        };
    }

    private static List<DriveEfficiencyLegendItem> BuildLegend(ILocalizer localizer)
    {
        // Web parity: legend order is daily then 7-day avg; swatches match the plotted series' palette index.
        return new List<DriveEfficiencyLegendItem>(2)
        {
            new(localizer.GetString("widget.driveEfficiencyChart.daily", "Daily"), ChartPalette.KeyForIndex(DailyColorIndex)),
            new(localizer.GetString("widget.driveEfficiencyChart.rolling", "7-day avg"), ChartPalette.KeyForIndex(RollingColorIndex)),
        };
    }

    private static double? ComputeTrend(List<DriveEfficiencyDailyPoint> points)
    {
        if (points.Count < TrendMinPoints)
        {
            return null;
        }

        int mid = points.Count / 2;
        double sumFirst = 0;
        double sumSecond = 0;
        for (int i = 0; i < mid; i++)
        {
            sumFirst += points[i].Efficiency;
        }

        for (int i = mid; i < points.Count; i++)
        {
            sumSecond += points[i].Efficiency;
        }

        double avgFirst = sumFirst / mid;
        double avgSecond = sumSecond / (points.Count - mid);

        // Web: Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10 → percentage to one decimal.
        return JsRound(((avgSecond - avgFirst) / avgFirst) * 1000.0) / 10.0;
    }

    private static string MeasureAutomationName(string label, string value, string unit) =>
        string.Equals(value, EmDash, StringComparison.Ordinal)
            ? $"{label}: {value}"
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);

    private static string FormatTrend(double trend)
    {
        // Web parity: `${trend > 0 ? '+' : ''}${trend}%` — JS number stringification drops a trailing ".0".
        string sign = trend > 0 ? "+" : string.Empty;
        return sign + trend.ToString("0.#", EnUs) + "%";
    }

    private static string FormatDayLabel(string dateKey)
    {
        // Web: fmtShortDate(date + 'T00:00:00') → local-midnight date rendered "MMM d". The key is already the
        // calendar date, so format its components directly (no timezone shift), matching the web result.
        if (DateTime.TryParseExact(dateKey, "yyyy-MM-dd", EnUs, DateTimeStyles.None, out var dt))
        {
            return dt.ToString("MMM d", EnUs);
        }

        return dateKey;
    }

    private static string DateKey(string startTimestamp) =>
        startTimestamp.Length >= 10 ? startTimestamp[..10] : startTimestamp;

    private static bool InRange(double whPerKm) => whPerKm >= MinWhPerKm && whPerKm <= MaxWhPerKm;

    private static double Mean(List<DriveEfficiencyDailyPoint> points, Func<DriveEfficiencyDailyPoint, double> selector)
    {
        double sum = 0;
        foreach (var point in points)
        {
            sum += selector(point);
        }

        return sum / points.Count;
    }

    private static double MinOf(List<DriveEfficiencyDailyPoint> points)
    {
        double min = points[0].Efficiency;
        for (int i = 1; i < points.Count; i++)
        {
            if (points[i].Efficiency < min)
            {
                min = points[i].Efficiency;
            }
        }

        return min;
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<DriveEfficiencyChartStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    /// <summary>Round to one decimal exactly as the web <c>Math.round(value * 10) / 10</c> does.</summary>
    private static double Round1(double value) => JsRound(value * 10.0) / 10.0;

    /// <summary>JS <c>Math.round</c> semantics: round half toward positive infinity.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce NaN / ±∞ to 0 (web <c>safeNumber</c>)
    /// then render with fixed <paramref name="decimals"/> fraction digits and en-US grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DriveEfficiencyDrive&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>isEmpty</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model after
/// projection, not here, so an empty list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DriveEfficiencyChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DriveEfficiencyDrive> Parse() =>
            raw.HasValue ? DriveEfficiencyDrive.ParseList(raw.Value) : Array.Empty<DriveEfficiencyDrive>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
