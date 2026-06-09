using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="DetailedStatisticsViewModel"/> can be in — the native
/// superset of the branches the web Detailed-Statistics panel renders
/// (web/src/features/charging/components/charging-list/DetailedStatistics.tsx). The web component is a pure
/// child of the Charging-History page (it takes already-computed <c>stats</c> + <c>enhanced</c> props); the
/// native surface binds its own cache-then-network read of the charging sessions, so it owns the full
/// loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. Every value maps
/// onto a visible surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/>,
/// <see cref="Offline"/> and <see cref="Empty"/> all render the six statistic cells (the web grid is always
/// visible, falling back to zeroed / em-dash cells when there are no sessions), while <see cref="Loading"/>
/// shows the per-cell skeletons and <see cref="Error"/> the retry surface.
/// </summary>
public enum DetailedStatisticsState
{
    /// <summary>Initial fetch with no cached snapshot — render the per-cell skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging sessions — the cells render zeroed (web parity).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The six aggregate charging figures the web Detailed-Statistics panel shows — the native mirror of the web
/// <c>ChargingStats</c> + <c>EnhancedStats</c> shapes
/// (web/src/features/charging/components/charging-list/helpers.ts) and of the <c>computeStats</c> /
/// <c>computeEnhancedStats</c> reductions the Charging-History page runs over its charging-sessions query.
/// Reproduced verbatim for parity:
/// <list type="bullet">
/// <item><c>TotalSessions</c> is the session count (web <c>stats.count</c>).</item>
/// <item><c>AvgDurationMin</c> is the mean of each session's fractional-minute duration (web
/// <c>enhanced.avgDuration = totalDuration / count</c>; a session with no end or a non-positive span counts
/// as 0, the web <c>durationMinutes</c>). Left unrounded — the web rounds only the minute part at display.</item>
/// <item><c>AvgPowerKw</c> averages <c>peak_power_w / 1000</c> across only the sessions with a non-zero peak
/// power (web <c>withPower</c> filter + <c>Math.max(withPower.length, 1)</c> divisor).</item>
/// <item><c>TopChargerType</c> / <c>TopChargerCount</c> are the most-common <c>charger_type</c> (falling back
/// to "AC/Home" for a blank type, the web <c>charger_type || 'AC/Home'</c>) and its occurrence count, with the
/// first-seen type winning a tie (the web stable descending sort).</item>
/// <item><c>TotalCost</c> sums <c>cost_decimal</c>; <c>AvgCostPerKwh</c> is <c>TotalCost</c> over the total
/// energy in kWh (<c>Σ total_energy_added_wh / 1000</c>), or 0 when no energy was added (web
/// <c>totalEnergy &gt; 0 ? totalCost / totalEnergy : 0</c>).</item>
/// </list>
/// WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
public sealed record ChargingDetailedStats(
    int TotalSessions,
    double AvgDurationMin,
    double AvgPowerKw,
    string TopChargerType,
    int TopChargerCount,
    double TotalCost,
    double AvgCostPerKwh)
{
    /// <summary>The fallback charger label for a blank <c>charger_type</c> (web <c>charger_type || 'AC/Home'</c>).</summary>
    public const string DefaultChargerType = "AC/Home";

    /// <summary>The no-sessions snapshot — the parse fallback for an absent/non-array body (web <c>stats === null</c>).</summary>
    public static ChargingDetailedStats Empty { get; } = new(0, 0, 0, string.Empty, 0, 0, 0);

    /// <summary>True when at least one charging session contributed to the figures (web <c>stats !== null</c>).</summary>
    public bool HasData => TotalSessions > 0;

    /// <summary>
    /// Reduce a <c>GET /charging-sessions</c> JSON array into the six detailed figures — the native port of the
    /// web <c>computeStats</c> + <c>computeEnhancedStats</c>. A non-array body or an empty array yields
    /// <see cref="Empty"/>. Parsing is null-tolerant (the web <c>?? 0</c>) so a partial row never throws.
    /// </summary>
    public static ChargingDetailedStats FromSessionsJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        double totalEnergyWh = 0;
        double totalCost = 0;
        double sumPeakPowerW = 0;
        int withPowerCount = 0;
        double totalDurationMin = 0;

        // Tally charger types in first-seen order so a tie resolves to the earliest type (the web stable sort).
        var order = new List<string>();
        var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            totalEnergyWh += DetailedStatsJson.GetDouble(item, "total_energy_added_wh") ?? 0;
            totalCost += DetailedStatsJson.GetDouble(item, "cost_decimal") ?? 0;

            // web: withPower = sessions.filter(s => s.peak_power_w) — a null OR zero peak power is excluded.
            double peakPowerW = DetailedStatsJson.GetDouble(item, "peak_power_w") ?? 0;
            if (peakPowerW != 0)
            {
                sumPeakPowerW += peakPowerW;
                withPowerCount++;
            }

            totalDurationMin += DurationMinutes(
                DetailedStatsJson.GetString(item, "started_at"),
                DetailedStatsJson.GetString(item, "ended_at"));

            string? rawType = DetailedStatsJson.GetString(item, "charger_type");
            string typeKey = string.IsNullOrEmpty(rawType) ? DefaultChargerType : rawType;
            if (typeCounts.TryGetValue(typeKey, out int existing))
            {
                typeCounts[typeKey] = existing + 1;
            }
            else
            {
                typeCounts[typeKey] = 1;
                order.Add(typeKey);
            }
        }

        if (count == 0)
        {
            return Empty;
        }

        // web avgPower: Σ(peak_power_w of withPower) / max(withPower.length, 1), then /1000 to kW.
        double avgPowerKw = sumPeakPowerW / Math.Max(withPowerCount, 1) / 1000.0;

        // web avgCostPerKwh: totalCost / (Σ total_energy_added_wh / 1000) when there is energy, else 0.
        double totalEnergyKwh = totalEnergyWh / 1000.0;
        double avgCostPerKwh = totalEnergyKwh > 0 ? totalCost / totalEnergyKwh : 0;

        double avgDurationMin = count > 0 ? totalDurationMin / count : 0;

        string topType = string.Empty;
        int topCount = 0;
        foreach (string key in order)
        {
            if (typeCounts[key] > topCount)
            {
                topCount = typeCounts[key];
                topType = key;
            }
        }

        return new ChargingDetailedStats(
            TotalSessions: count,
            AvgDurationMin: avgDurationMin,
            AvgPowerKw: avgPowerKw,
            TopChargerType: topType,
            TopChargerCount: topCount,
            TotalCost: totalCost,
            AvgCostPerKwh: avgCostPerKwh);
    }

    // web durationMinutes(): no start/end / unparseable / non-positive span -> 0; else fractional minutes
    // (NOT rounded — the web rounds only the minute part inside formatDurationMinutes at display time).
    private static double DurationMinutes(string? startedAt, string? endedAt)
    {
        if (string.IsNullOrEmpty(startedAt)
            || string.IsNullOrEmpty(endedAt)
            || !TryParseInstant(startedAt, out var start)
            || !TryParseInstant(endedAt, out var end))
        {
            return 0;
        }

        double milliseconds = (end - start).TotalMilliseconds;
        return milliseconds <= 0 ? 0 : milliseconds / 60000.0;
    }

    private static bool TryParseInstant(string? value, out DateTimeOffset instant) =>
        DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out instant);
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Detailed-Statistics surface — every getter returns
/// a nullable / fallback rather than throwing so a partial or schema-drifted session row never aborts the
/// reduction (web parity: the page tolerates undefined fields with <c>?? 0</c>). WinUI-free so the parse is
/// unit-tested without a UI host.
/// </summary>
internal static class DetailedStatsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready statistic cell — the native analogue of one web grid cell (a bold, accent-tinted
/// value over a small muted label). <see cref="AccentBrushKey"/> is a design-token resource key the view
/// resolves to a brush; <see cref="AutomationName"/> is the spoken "label, value" the cell exposes to Narrator.
/// Pure data so every value is asserted headlessly.
/// </summary>
public sealed record DetailedStatCell(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Detailed-Statistics panel — the title plus the six cells the
/// web component draws. The grid is always populated (web parity: the cells render zeroed / em-dash when there
/// are no sessions), so <see cref="Cells"/> always has six entries; <see cref="HasData"/> only reflects whether
/// real sessions backed the figures. Pure data.
/// </summary>
public sealed record DetailedStatisticsDisplay(
    string Title,
    IReadOnlyList<DetailedStatCell> Cells,
    bool HasData,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingDetailedStats"/> to its <see cref="DetailedStatisticsDisplay"/>
/// — the native port of the render logic in
/// web/src/features/charging/components/charging-list/DetailedStatistics.tsx. The six cells reproduce the web
/// call sites one-for-one: the session count as a grouped integer (web <c>AnimatedNumber</c> settled value),
/// the average duration through <see cref="FormatDuration"/> (web <c>formatDuration</c>), the average power as
/// <c>{n} kW</c> at two decimals (web <c>fmtWithUnit(stats.avgPower, 'kW')</c>), the top charger verbatim with
/// its occurrence count suffix, and the total / per-kWh cost through the currency formatter (web
/// <c>&lt;Currency&gt;</c> at the default and 3-decimal precisions). The accent tints mirror the web Tailwind
/// classes (purple/amber/emerald). Every translatable label resolves through the i18n facade using the same
/// keys the web source passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class DetailedStatisticsProjection
{
    /// <summary>The em dash shown where a value is unavailable (web <c>FALLBACK</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The multiplication sign suffixed onto the top-charger count (web <c>{count}×</c>).</summary>
    public const string Times = "\u00D7";

    /// <summary>The power unit the web suffixes onto the average charge power (web <c>fmtWithUnit(..,'kW')</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Decimal places for the average power (the web global <c>fmtNumber</c> default).</summary>
    public const int PowerPrecision = 2;

    /// <summary>Decimal places for the total cost (web <c>&lt;Currency&gt;</c> default).</summary>
    public const int CostPrecision = 2;

    /// <summary>Decimal places for the per-kWh cost (web <c>&lt;Currency precision={3}&gt;</c>).</summary>
    public const int CostPerKwhPrecision = 3;

    /// <summary>Token brush key for the primary (un-tinted) cell values (web <c>text-[var(--text-primary)]</c>).</summary>
    public const string AccentPrimary = "TsColorTextPrimaryBrush";

    /// <summary>Token brush key for the average-power value (web <c>text-purple-300</c>).</summary>
    public const string AccentPower = "TsChartPowerBrush";

    /// <summary>Token brush key for the total-cost value (web <c>text-amber-300</c>).</summary>
    public const string AccentCost = "TsColorWarningBrush";

    /// <summary>Token brush key for the per-kWh value (web <c>text-emerald-300</c>).</summary>
    public const string AccentCostPerKwh = "TsColorSuccessBrush";

    /// <summary>Project <paramref name="stats"/> using the user's <paramref name="currencySymbol"/> + i18n facade.</summary>
    public static DetailedStatisticsDisplay Project(
        ChargingDetailedStats stats,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        string title = localizer.GetString("charging.stats.detailedStatistics", "Detailed Statistics");

        string topChargerLabel = localizer.GetString("charging.stats.topCharger", "Top Charger");
        string topChargerCellLabel = stats.HasData
            ? string.Create(CultureInfo.CurrentCulture, $"{topChargerLabel} ({stats.TopChargerCount}{Times})")
            : topChargerLabel;
        string topChargerValue = stats.HasData && !string.IsNullOrEmpty(stats.TopChargerType)
            ? stats.TopChargerType
            : EmDash;

        var cells = new[]
        {
            Cell(
                localizer.GetString("charging.stats.totalSessions", "Total Sessions"),
                ScalarFormatters.FormatNumber(stats.TotalSessions, 0),
                AccentPrimary),
            Cell(
                localizer.GetString("charging.stats.avgDuration", "Avg Duration"),
                FormatDuration(stats.AvgDurationMin),
                AccentPrimary),
            Cell(
                localizer.GetString("charging.stats.avgPower", "Avg Power"),
                string.Create(
                    CultureInfo.CurrentCulture,
                    $"{ScalarFormatters.FormatNumber(stats.AvgPowerKw, PowerPrecision)} {PowerUnit}"),
                AccentPower),
            Cell(
                topChargerCellLabel,
                topChargerValue,
                AccentPrimary),
            Cell(
                localizer.GetString("charging.stats.totalCost", "Total Cost"),
                ScalarFormatters.FormatCurrency(stats.TotalCost, symbol, CostPrecision),
                AccentCost),
            Cell(
                localizer.GetString("charging.stats.avgCostPerKwh", "Avg $/kWh"),
                ScalarFormatters.FormatCurrency(stats.AvgCostPerKwh, symbol, CostPerKwhPrecision),
                AccentCostPerKwh),
        };

        return new DetailedStatisticsDisplay(
            Title: title,
            Cells: cells,
            HasData: stats.HasData,
            AutomationName: title);
    }

    /// <summary>
    /// Format an average duration in minutes as the web <c>formatDurationMinutes</c> does: a negative or
    /// non-finite span yields the em-dash fallback; otherwise whole hours plus the rounded remainder minutes,
    /// dropping the hours segment when it is zero ("1h 05m" style collapses to "5m").
    /// </summary>
    public static string FormatDuration(double minutes)
    {
        if (double.IsNaN(minutes) || double.IsInfinity(minutes) || minutes < 0)
        {
            return EmDash;
        }

        long hours = (long)Math.Floor(minutes / 60.0);
        long mins = (long)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);

        return hours > 0
            ? string.Create(CultureInfo.CurrentCulture, $"{hours}h {mins}m")
            : string.Create(CultureInfo.CurrentCulture, $"{mins}m");
    }

    private static DetailedStatCell Cell(string label, string value, string accentBrushKey)
    {
        string automation = string.Create(CultureInfo.CurrentCulture, $"{label}: {value}");
        return new DetailedStatCell(label, value, accentBrushKey, automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto reduced
/// <c>RepositoryResult&lt;ChargingDetailedStats&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve contract
/// is unit-tested without a network or cache.
/// </summary>
public static class DetailedStatsResultMapper
{
    /// <summary>Reduce <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<ChargingDetailedStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingDetailedStats Parse() =>
            raw.HasValue ? ChargingDetailedStats.FromSessionsJson(raw.Value) : ChargingDetailedStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingDetailedStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<ChargingDetailedStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingDetailedStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ChargingDetailedStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ChargingDetailedStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ChargingDetailedStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ChargingDetailedStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Detailed-Statistics surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-list/DetailedStatistics.tsx. The surface aggregates the same
/// charging sessions the Charging-History page feeds the panel.
/// </summary>
public static class DetailedStatisticsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "detailed-statistics";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DetailedStatistics";

    /// <summary>Segoe Fluent "trending up" glyph standing in for the web Lucide <c>TrendingUp</c> heading icon.</summary>
    public const string TrendingUpGlyph = "\uE70E";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.stats.detailedStatistics", "Detailed Statistics");
    }
}

/// <summary>
/// PII-safe diagnostics for the Detailed-Statistics surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, cost or charger name —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DetailedStatisticsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DetailedStatisticsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DetailedStatistics</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DetailedStatisticsRegistration.Slug}");
    }
}
