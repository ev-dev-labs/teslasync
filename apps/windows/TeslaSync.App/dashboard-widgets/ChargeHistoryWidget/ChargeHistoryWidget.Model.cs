using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargeHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargeHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 1</c> — fewer than two charging sessions) — the friendly
/// "No charge sessions yet" empty state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ChargeHistoryState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least two charging sessions to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or fewer than two sessions — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charging session from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts). Only the single field the web <c>ChargeHistoryWidget</c> chart reads is
/// projected: the SI energy added in watt-hours (<c>total_energy_added_wh</c>, converted to kWh at the
/// display boundary). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so
/// a partial row never throws.
/// </summary>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
public sealed record ChargeHistorySession(double EnergyAddedWh)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<ChargeHistorySession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargeHistorySession>();
        }

        var list = new List<ChargeHistorySession>(element.GetArrayLength());
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
    public static ChargeHistorySession FromJson(JsonElement obj) =>
        new(GetDouble(obj, "total_energy_added_wh") ?? 0);

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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx (note: the web compact test keys off
/// <em>columns only</em>, unlike most surfaces which also gate on rows).
/// </summary>
public readonly record struct ChargeHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ChargeHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): hide the title and chart, show the stats only.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>,
/// the optional <see cref="Unit"/> suffix (<c>kWh</c>), and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
public sealed record ChargeHistorySummaryStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the recent charge history for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// summary stats and the area-chart energy series (already in kWh, chronological order). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargeHistoryDisplay(
    bool IsCompact,
    bool HasData,
    IReadOnlyList<ChargeHistorySummaryStat> Stats,
    IReadOnlyList<double> ChartEnergies,
    string ChartSeriesName,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw charging-session list to the display model — the native port of the
/// <c>chartData</c> / <c>stats</c> <c>useMemo</c> work and the <c>hasData</c> / <c>isCompact</c> gating in
/// web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx. Energy is converted from SI watt-hours to
/// kWh exactly as the web <c>convertEnergyFromSI(_, 'kWh')</c> does (a fixed <c>wh / 1000</c>, never the
/// user's unit preference); every label resolves through the i18n facade.
/// </summary>
public static class ChargeHistoryProjection
{
    /// <summary>Segoe Fluent "BarChart4" glyph for the surface header / empty state (web <c>BarChart3</c>).</summary>
    public const string HeaderGlyph = "\uE9D9";

    /// <summary>The energy unit the chart and stats are expressed in (web literal <c>'kWh'</c>).</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>Watt-hours per kilowatt-hour (web <c>convertEnergyFromSI(_, 'kWh')</c> divides by this).</summary>
    public const double WattHoursPerKwh = 1000.0;

    /// <summary>The most-recent sessions retained for the chart (web query <c>limit=10</c>).</summary>
    public const int WindowLimit = 10;

    /// <summary>Project <paramref name="sessions"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static ChargeHistoryDisplay Project(
        IReadOnlyList<ChargeHistorySession> sessions,
        ChargeHistorySize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: the query caps at the 10 most-recent sessions (the backend orders started_at DESC,
        // so the first 10 rows are the newest), then the chart reverses them into chronological order.
        int take = Math.Min(sessions.Count, WindowLimit);
        var energies = new List<double>(take);
        for (int i = take - 1; i >= 0; i--)
        {
            energies.Add(sessions[i].EnergyAddedWh / WattHoursPerKwh);
        }

        // Web parity: hasData = chartData.length > 1 — a single session is not enough to draw a trend.
        bool hasData = energies.Count > 1;
        var stats = hasData ? BuildStats(energies, localizer) : new List<ChargeHistorySummaryStat>();

        return new ChargeHistoryDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            Stats: stats,
            ChartEnergies: energies,
            ChartSeriesName: EnergyUnit,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static List<ChargeHistorySummaryStat> BuildStats(
        List<double> energies, ILocalizer localizer)
    {
        double total = 0;
        foreach (double kwh in energies)
        {
            total += kwh;
        }

        double avg = total / energies.Count;

        string totalLabel = localizer.GetString("widget.chargeHistory.total", "Total");
        string avgLabel = localizer.GetString("widget.chargeHistory.avg", "Avg");
        string totalValue = Fmt(total, 1);
        string avgValue = Fmt(avg, 1);

        return new List<ChargeHistorySummaryStat>(2)
        {
            new(totalLabel, totalValue, EnergyUnit, AutomationName(totalLabel, totalValue)),
            new(avgLabel, avgValue, EnergyUnit, AutomationName(avgLabel, avgValue)),
        };
    }

    private static string AutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, EnergyUnit);

    private static IEnumerable<string> AutomationParts(IReadOnlyList<ChargeHistorySummaryStat> stats)
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
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ChargeHistorySession&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model, not here,
/// so a populated-but-too-short list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargeHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ChargeHistorySession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ChargeHistorySession> Parse() =>
            raw.HasValue ? ChargeHistorySession.ParseList(raw.Value) : Array.Empty<ChargeHistorySession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ChargeHistorySession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
