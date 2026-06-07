using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargeSessionChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargeSessionChartWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 0</c> — no charging sessions at all) — the friendly
/// "No charge sessions yet" empty state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ChargeSessionChartState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one charging session to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no sessions — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The charger-type bucket a charging session is color-coded into — the native union of the web
/// <c>classifyChargerType</c> result ('home' | 'supercharger' | 'dc') in
/// web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx.
/// </summary>
public enum ChargerType
{
    /// <summary>Home / AC charging (web 'home', emerald).</summary>
    Home,

    /// <summary>Tesla Supercharger (web 'supercharger', red).</summary>
    Supercharger,

    /// <summary>DC fast charging (web 'dc', amber).</summary>
    Dc,
}

/// <summary>
/// One charging session projected from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts). Only the three fields the web <c>ChargeSessionChartWidget</c> chart reads are
/// kept: the SI energy added in watt-hours (<c>total_energy_added_wh</c>, converted to kWh at the display
/// boundary), the free-text <c>charger_type</c> (classified into a <see cref="ChargerType"/> bucket), and
/// the <c>started_at</c> instant used for the bar's date label. Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
/// <param name="ChargerType">Raw charger-type label, or null (web <c>charger_type</c>).</param>
/// <param name="StartedAt">Session start instant, or null (web <c>started_at</c>).</param>
public sealed record ChargeSessionChartSession(double EnergyAddedWh, string? ChargerType, DateTimeOffset? StartedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<ChargeSessionChartSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargeSessionChartSession>();
        }

        var list = new List<ChargeSessionChartSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static ChargeSessionChartSession FromJson(JsonElement obj) => new(
        GetDouble(obj, "total_energy_added_wh") ?? 0,
        GetString(obj, "charger_type"),
        GetDateTime(obj, "started_at"));

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
/// web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx (note: unlike most surfaces, this one
/// only collapses to compact when BOTH the column and row count are a single cell).
/// </summary>
public readonly record struct ChargeSessionChartSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ChargeSessionChartSize Default => new(2, 4);

    /// <summary>
    /// True at a single cell (web <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>): hide
    /// the title, chart and legend, showing the summary stats only.
    /// </summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>,
/// the optional <see cref="Unit"/> suffix (<c>kWh</c>, absent for the session count), and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ChargeSessionChartStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected, render-ready bar — the native analogue of a single web <c>ChartDatum</c> + its
/// color-coded <c>&lt;Cell&gt;</c>. Holds the X-axis <see cref="Label"/> (formatted date or
/// <c>#index</c> fallback), the energy in kWh and its formatted text, the classified <see cref="Type"/>
/// with its localized <see cref="TypeLabel"/> and the design-token <see cref="ColorBrushKey"/> the bar
/// fills with, the <see cref="HeightRatio"/> (0..1 of the tallest bar) the view scales the bar to, and a
/// Narrator automation name. Pure data so the geometry is unit-tested without a UI host.
/// </summary>
public sealed record ChargeSessionChartBar(
    string Label,
    double EnergyKwh,
    string ValueText,
    ChargerType Type,
    string TypeLabel,
    string ColorBrushKey,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// One legend entry — a charger-type swatch and its localized name (web's legend row of three colored
/// dots). Pure data so the view binds <see cref="ColorBrushKey"/> to a design-token brush.
/// </summary>
public sealed record ChargeSessionChartLegendItem(ChargerType Type, string Label, string ColorBrushKey);

/// <summary>
/// The fully projected, render-ready view of the recent charge-session chart for one footprint — the
/// native analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds
/// the bars (already in kWh, color-coded, chronological order), the summary stats and the legend. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargeSessionChartDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<ChargeSessionChartStat> Stats,
    IReadOnlyList<ChargeSessionChartBar> Bars,
    IReadOnlyList<ChargeSessionChartLegendItem> Legend,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw charging-session list to the display model — the native port of the
/// <c>chartData</c> / <c>stats</c> <c>useMemo</c> work, the <c>classifyChargerType</c> color-coding and the
/// <c>hasData</c> / <c>isCompact</c> gating in
/// web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx. Energy is converted from SI watt-hours
/// to kWh exactly as the web <c>convertEnergyFromSI(_, 'kWh')</c> does (a fixed <c>wh / 1000</c>, never the
/// user's unit preference); every label resolves through the i18n facade; bar colors map onto the shared
/// semantic design-token brushes.
/// </summary>
public static class ChargeSessionChartProjection
{
    /// <summary>Segoe Fluent "Lightning" glyph for the surface header / empty state (web <c>Zap</c>).</summary>
    public const string HeaderGlyph = "\uE945";

    /// <summary>The accent brush tinting the header icon (web emerald <c>text-emerald-400</c>).</summary>
    public const string HeaderAccentBrushKey = HomeBrushKey;

    /// <summary>The energy unit the chart and stats are expressed in (web literal <c>'kWh'</c>).</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>Watt-hours per kilowatt-hour (web <c>convertEnergyFromSI(_, 'kWh')</c> divides by this).</summary>
    public const double WattHoursPerKwh = 1000.0;

    /// <summary>The most-recent sessions retained for the chart (web query <c>limit=10</c>).</summary>
    public const int WindowLimit = 10;

    /// <summary>Design-token brush for home / AC charging (web <c>CHARGER_COLORS.home</c> emerald).</summary>
    public const string HomeBrushKey = "TsColorSuccessBrush";

    /// <summary>Design-token brush for Supercharger charging (web <c>CHARGER_COLORS.supercharger</c> red).</summary>
    public const string SuperchargerBrushKey = "TsColorDangerBrush";

    /// <summary>Design-token brush for DC fast charging (web <c>CHARGER_COLORS.dc</c> amber).</summary>
    public const string DcBrushKey = "TsColorWarningBrush";

    /// <summary>Classify a raw charger-type label into a bucket — the native port of <c>classifyChargerType</c>.</summary>
    public static ChargerType Classify(string? chargerType)
    {
        string ft = (chargerType ?? string.Empty).ToLowerInvariant();
        if (ft.Contains("supercharger", StringComparison.Ordinal) || ft.Contains("tesla", StringComparison.Ordinal))
        {
            return ChargerType.Supercharger;
        }

        if (ft.Length > 0 && ft != "<invalid>")
        {
            return ChargerType.Dc;
        }

        return ChargerType.Home;
    }

    /// <summary>The design-token brush key for a charger-type bucket (web <c>CHARGER_COLORS[type]</c>).</summary>
    public static string BrushKeyFor(ChargerType type) => type switch
    {
        ChargerType.Supercharger => SuperchargerBrushKey,
        ChargerType.Dc => DcBrushKey,
        _ => HomeBrushKey,
    };

    /// <summary>The i18n key for a charger-type label (web <c>widget.chargeSessionChart.type.{type}</c>).</summary>
    public static string TypeLabelKey(ChargerType type) => type switch
    {
        ChargerType.Supercharger => "widget.chargeSessionChart.type.supercharger",
        ChargerType.Dc => "widget.chargeSessionChart.type.dc",
        _ => "widget.chargeSessionChart.type.home",
    };

    /// <summary>The English fallback for a charger-type label (web <c>CHARGER_TYPE_LABEL[type]</c>).</summary>
    public static string TypeLabelFallback(ChargerType type) => type switch
    {
        ChargerType.Supercharger => "Supercharger",
        ChargerType.Dc => "DC Fast",
        _ => "Home / AC",
    };

    /// <summary>Project <paramref name="sessions"/> for <paramref name="size"/> using the localizer for every label.</summary>
    /// <param name="sessions">The charging sessions, newest-first (the backend orders <c>started_at DESC</c>).</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant for date formatting (Short ignores it; threaded for consistency).</param>
    public static ChargeSessionChartDisplay Project(
        IReadOnlyList<ChargeSessionChartSession> sessions,
        ChargeSessionChartSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        var bars = BuildBars(sessions, localizer, now);

        // Web parity: hasData = chartData.length > 0 — a single session is enough to chart.
        bool hasData = bars.Count > 0;
        IReadOnlyList<ChargeSessionChartStat> stats =
            hasData ? BuildStats(bars, localizer) : Array.Empty<ChargeSessionChartStat>();
        var legend = BuildLegend(localizer);

        return new ChargeSessionChartDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            Stats: stats,
            Bars: bars,
            Legend: legend,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static List<ChargeSessionChartBar> BuildBars(
        IReadOnlyList<ChargeSessionChartSession> sessions, ILocalizer localizer, DateTimeOffset now)
    {
        // Web parity: the query caps at the 10 most-recent sessions (the backend orders started_at DESC, so
        // the first 10 rows are the newest), then the chart reverses them into chronological order. The
        // label's #index fallback uses the pre-reverse index (web `.map((s, i) => … `#${i + 1}`).reverse()`).
        int take = Math.Min(sessions.Count, WindowLimit);
        var kwh = new double[take];
        double max = 0;
        for (int i = 0; i < take; i++)
        {
            double value = sessions[i].EnergyAddedWh / WattHoursPerKwh;
            kwh[i] = value;
            if (value > max)
            {
                max = value;
            }
        }

        var bars = new List<ChargeSessionChartBar>(take);
        for (int i = take - 1; i >= 0; i--)
        {
            var session = sessions[i];
            var type = Classify(session.ChargerType);
            string typeLabel = localizer.GetString(TypeLabelKey(type), TypeLabelFallback(type));
            string label = session.StartedAt is { } ts
                ? DateTimeFormatting.Format(ts, DateTimeVariant.Short, now)
                : string.Create(CultureInfo.InvariantCulture, $"#{i + 1}");
            string valueText = Fmt(kwh[i], 1);
            double ratio = max > 0 ? Math.Clamp(kwh[i] / max, 0.0, 1.0) : 0.0;

            bars.Add(new ChargeSessionChartBar(
                Label: label,
                EnergyKwh: kwh[i],
                ValueText: valueText,
                Type: type,
                TypeLabel: typeLabel,
                ColorBrushKey: BrushKeyFor(type),
                HeightRatio: ratio,
                AutomationName: BarAutomationName(label, valueText, typeLabel)));
        }

        return bars;
    }

    private static List<ChargeSessionChartStat> BuildStats(
        List<ChargeSessionChartBar> bars, ILocalizer localizer)
    {
        double total = 0;
        foreach (var bar in bars)
        {
            total += bar.EnergyKwh;
        }

        double avg = total / bars.Count;

        string totalLabel = localizer.GetString("widget.chargeSessionChart.total", "Total");
        string avgLabel = localizer.GetString("widget.chargeSessionChart.avg", "Avg");
        string sessionsLabel = localizer.GetString("widget.chargeSessionChart.sessions", "Sessions");

        string totalValue = Fmt(total, 1);
        string avgValue = Fmt(avg, 1);
        string sessionsValue = bars.Count.ToString(CultureInfo.CurrentCulture);

        return new List<ChargeSessionChartStat>(3)
        {
            new(totalLabel, totalValue, EnergyUnit, EnergyAutomationName(totalLabel, totalValue)),
            new(avgLabel, avgValue, EnergyUnit, EnergyAutomationName(avgLabel, avgValue)),

            // Web parity: the Sessions stat carries no unit suffix.
            new(sessionsLabel, sessionsValue, null, CountAutomationName(sessionsLabel, sessionsValue)),
        };
    }

    private static List<ChargeSessionChartLegendItem> BuildLegend(ILocalizer localizer)
    {
        // Web parity: legend order is home, supercharger, dc.
        var types = new[] { ChargerType.Home, ChargerType.Supercharger, ChargerType.Dc };
        var legend = new List<ChargeSessionChartLegendItem>(types.Length);
        foreach (var type in types)
        {
            legend.Add(new ChargeSessionChartLegendItem(
                type,
                localizer.GetString(TypeLabelKey(type), TypeLabelFallback(type)),
                BrushKeyFor(type)));
        }

        return legend;
    }

    private static string EnergyAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, EnergyUnit);

    private static string CountAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string BarAutomationName(string label, string value, string typeLabel) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}, {3}", label, value, EnergyUnit, typeLabel);

    private static IEnumerable<string> AutomationParts(IReadOnlyList<ChargeSessionChartStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmt</c> / <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0
    /// (web <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US
    /// grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ChargeSessionChartSession&gt;&gt;</c>, preserving every
/// freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
/// matrix. The <c>hasData</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model,
/// not here, so an empty list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargeSessionChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ChargeSessionChartSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ChargeSessionChartSession> Parse() =>
            raw.HasValue ? ChargeSessionChartSession.ParseList(raw.Value) : Array.Empty<ChargeSessionChartSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
