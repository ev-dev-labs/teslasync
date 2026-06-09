using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ChargingDetailViewModel"/> can be in — the native
/// union of the branches the web Charging-detail surface renders once its fleet-analytics query resolves
/// (web/src/features/analytics/components/analytics/ChargingDetailSection.tsx). The web component is a pure
/// child of the analytics page (it takes <c>data: FleetAnalytics | undefined</c>); the native surface binds
/// its own cache-then-network read of <c>/analytics/fleet</c>, so it owns the full loading / loaded / empty
/// / error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible surface
/// (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/>, <see cref="Offline"/> and
/// <see cref="Empty"/> all render the four charging panels (each with its own per-section empty state,
/// the web parity), while <see cref="Loading"/> shows the section skeletons and <see cref="Error"/> the
/// retry surface.
/// </summary>
public enum ChargingDetailState
{
    /// <summary>Initial fetch with no cached snapshot — render the section skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one populated section.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no brands, types, monthly rows or cost stats.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charger-brand leaderboard row from <c>charging_analytics.charger_brands</c> — the native mirror of
/// the web <c>{ brand: string; count: number }</c> shape (web/src/api/types.ts). Parsing is null-tolerant so
/// a partial row never throws.
/// </summary>
public sealed record ChargingDetailBrand(string Brand, double Count);

/// <summary>
/// One charger-type usage row from <c>charging_analytics.charger_types</c> — the native mirror of the web
/// <c>{ type: string; count: number }</c> shape.
/// </summary>
public sealed record ChargingDetailChargerType(string Type, double Count);

/// <summary>
/// One monthly-trend point from <c>charging_analytics.monthly_trend</c> — the three series the web
/// <c>ComposedChart</c> draws (energy area, average-power line, sessions bar) plus the month label. The wire
/// row also carries cost / gas_cost / savings, which this surface does not chart; they are ignored here.
/// </summary>
public sealed record ChargingDetailMonthPoint(string Month, double Energy, double AvgPower, double Sessions);

/// <summary>
/// The charging cost five-number summary from <c>charging_analytics.cost_stats</c> (web <c>StatsSummary</c>,
/// of which this surface shows min / avg / median / max). Presence — not value — gates the cost cards: the
/// web renders the cards whenever <c>cost_stats</c> exists, even when every figure is zero.
/// </summary>
public sealed record ChargingDetailCostStats(double Min, double Avg, double Median, double Max);

/// <summary>
/// The charging-analytics slice of <c>GET /analytics/fleet</c> the web Charging-detail section reads
/// (<c>data.charging_analytics</c>). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial body never throws and an absent array/object simply yields the empty case
/// (web parity: <c>?? []</c> / the per-section empty state). WinUI-free so the parse is unit-tested without a
/// UI host.
/// </summary>
public sealed record ChargingDetailAnalytics(
    IReadOnlyList<ChargingDetailBrand> Brands,
    IReadOnlyList<ChargingDetailChargerType> ChargerTypes,
    IReadOnlyList<ChargingDetailMonthPoint> MonthlyTrend,
    ChargingDetailCostStats? CostStats)
{
    /// <summary>An all-empty snapshot — the parse fallback for an absent/non-object body.</summary>
    public static ChargingDetailAnalytics Empty { get; } = new(
        Array.Empty<ChargingDetailBrand>(),
        Array.Empty<ChargingDetailChargerType>(),
        Array.Empty<ChargingDetailMonthPoint>(),
        null);

    /// <summary>True when at least one of the four sections has something to render.</summary>
    public bool HasAnyData =>
        Brands.Count > 0 || ChargerTypes.Count > 0 || MonthlyTrend.Count > 0 || CostStats is not null;

    /// <summary>
    /// Project the <c>/analytics/fleet</c> JSON object's <c>charging_analytics</c> child into a tolerant
    /// snapshot (web <c>data?.charging_analytics</c>). A non-object body or a missing child yields
    /// <see cref="Empty"/>.
    /// </summary>
    public static ChargingDetailAnalytics FromFleetJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("charging_analytics", out var ca) ||
            ca.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new ChargingDetailAnalytics(
            Brands: ReadBrands(ca),
            ChargerTypes: ReadChargerTypes(ca),
            MonthlyTrend: ReadMonthly(ca),
            CostStats: ReadCostStats(ca));
    }

    private static IReadOnlyList<ChargingDetailBrand> ReadBrands(JsonElement ca)
    {
        if (!ChargingDetailJson.TryGetArray(ca, "charger_brands", out var arr))
        {
            return Array.Empty<ChargingDetailBrand>();
        }

        var list = new List<ChargingDetailBrand>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new ChargingDetailBrand(
                ChargingDetailJson.GetString(item, "brand") ?? string.Empty,
                ChargingDetailJson.GetDouble(item, "count") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<ChargingDetailChargerType> ReadChargerTypes(JsonElement ca)
    {
        if (!ChargingDetailJson.TryGetArray(ca, "charger_types", out var arr))
        {
            return Array.Empty<ChargingDetailChargerType>();
        }

        var list = new List<ChargingDetailChargerType>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new ChargingDetailChargerType(
                ChargingDetailJson.GetString(item, "type") ?? string.Empty,
                ChargingDetailJson.GetDouble(item, "count") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<ChargingDetailMonthPoint> ReadMonthly(JsonElement ca)
    {
        if (!ChargingDetailJson.TryGetArray(ca, "monthly_trend", out var arr))
        {
            return Array.Empty<ChargingDetailMonthPoint>();
        }

        var list = new List<ChargingDetailMonthPoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new ChargingDetailMonthPoint(
                ChargingDetailJson.GetString(item, "month") ?? string.Empty,
                ChargingDetailJson.GetDouble(item, "energy") ?? 0,
                ChargingDetailJson.GetDouble(item, "avg_power") ?? 0,
                ChargingDetailJson.GetDouble(item, "sessions") ?? 0));
        }

        return list;
    }

    private static ChargingDetailCostStats? ReadCostStats(JsonElement ca)
    {
        if (!ca.TryGetProperty("cost_stats", out var cs) || cs.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargingDetailCostStats(
            ChargingDetailJson.GetDouble(cs, "min") ?? 0,
            ChargingDetailJson.GetDouble(cs, "avg") ?? 0,
            ChargingDetailJson.GetDouble(cs, "median") ?? 0,
            ChargingDetailJson.GetDouble(cs, "max") ?? 0);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Charging-detail surface — every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body never aborts the parse (web
/// parity: the React component tolerates undefined and renders the per-section empty state). WinUI-free so
/// the parse is unit-tested without a UI host.
/// </summary>
internal static class ChargingDetailJson
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

    /// <summary>True when <paramref name="name"/> is a JSON array; yields it via <paramref name="array"/>.</summary>
    public static bool TryGetArray(JsonElement obj, string name, out JsonElement array)
    {
        if (obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(name, out var prop)
            && prop.ValueKind == JsonValueKind.Array)
        {
            array = prop;
            return true;
        }

        array = default;
        return false;
    }
}

/// <summary>
/// One projected, render-ready proportional bar — the native analogue of a web leaderboard / cost-by-type
/// bar. <see cref="Value"/> over <see cref="Max"/> is the fill fraction (the web inline-width percentage);
/// <see cref="ValueText"/> is the right-hand readout the web shows; <see cref="AccentBrushKey"/> is a design
/// token key the view resolves (so this stays WinUI-free). Pure data.
/// </summary>
public sealed record ChargingDetailBarRow(
    string Label,
    double Value,
    double Max,
    string ValueText,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected cost card — the native analogue of a web <c>MetricCard</c> (label + pre-formatted currency
/// value + accent). Pure data.
/// </summary>
public sealed record ChargingDetailCostCard(
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected monthly-trend row — the raw series values (so the view builds the three chart series) plus
/// the already-formatted cell text for the accessible data table. Pure data.
/// </summary>
public sealed record ChargingDetailMonthRow(
    string Month,
    double Energy,
    double AvgPower,
    double Sessions,
    string EnergyText,
    string AvgPowerText,
    string SessionsText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the charging-detail surface — everything the web component
/// computes (the brand leaderboard with its per-bar percentage, the monthly-trend series, the four cost
/// cards and the cost-by-charger-type bars) plus the localized section titles, the per-section empty
/// messages and the chart series labels. Each <c>HasX</c> flag drives that section's content-vs-empty
/// branch (the web ternary). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChargingDetailDisplay(
    string BrandsTitle,
    IReadOnlyList<ChargingDetailBarRow> Brands,
    bool HasBrands,
    string NoBrandsMessage,
    string MonthlyTitle,
    IReadOnlyList<ChargingDetailMonthRow> Monthly,
    bool HasMonthly,
    string NoMonthlyMessage,
    string EnergySeriesLabel,
    string AvgPowerSeriesLabel,
    string SessionsSeriesLabel,
    string MonthlyChartAriaLabel,
    string CostTitle,
    IReadOnlyList<ChargingDetailCostCard> CostCards,
    bool HasCostStats,
    string NoCostStatsMessage,
    string TypesTitle,
    IReadOnlyList<ChargingDetailBarRow> ChargerTypes,
    bool HasChargerTypes,
    string NoChargerTypesMessage,
    bool HasAnyData,
    string AutomationName)
{
    /// <summary>An all-empty display (every section shows its empty state) for the loading/empty fallback.</summary>
    public static ChargingDetailDisplay Project(ChargingDetailAnalytics data, string currencySymbol, ILocalizer localizer) =>
        ChargingDetailProjection.Project(data, currencySymbol, localizer);
}

/// <summary>
/// Pure projection from a raw <see cref="ChargingDetailAnalytics"/> to its <see cref="ChargingDetailDisplay"/>
/// — the native port of the <c>useMemo</c> + render logic in
/// web/src/features/analytics/components/analytics/ChargingDetailSection.tsx. The brand leaderboard bar
/// fractions (<c>count / maxCount</c>) and the cost-by-type fractions (<c>count / totalSessions</c>) reproduce
/// the web inline widths; currency renders through <see cref="ScalarFormatters.FormatCurrency"/> (the web
/// <c>formatCurrency(value, 2)</c>) and counts/percentages through <see cref="ScalarFormatters.FormatNumber"/>
/// (the web <c>fmtInt</c>). Every label resolves through the i18n facade using the same keys the web source
/// passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class ChargingDetailProjection
{
    /// <summary>Accent token for the green charger-brand leaderboard bars (web <c>bg-neon-green</c>).</summary>
    public const string BrandAccentKey = "TsColorSuccessBrush";

    private const string CostMinAccentKey = "TsColorSuccessBrush";  // web color="green"
    private const string CostAvgAccentKey = "TsColorInfoBrush";     // web color="cyan"
    private const string CostMedianAccentKey = "TsChartPowerBrush"; // web color="purple"
    private const string CostMaxAccentKey = "TsColorWarningBrush";  // web color="amber"

    /// <summary>Project <paramref name="data"/> using the user's <paramref name="currencySymbol"/> + i18n facade.</summary>
    public static ChargingDetailDisplay Project(
        ChargingDetailAnalytics data,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        string brandsTitle = localizer.GetString("analytics.charging.chargerBrands", "Charger Brands");
        string monthlyTitle = localizer.GetString("analytics.charging.monthlyTrend", "Monthly Charging Trend");
        string costTitle = localizer.GetString("analytics.charging.costAnalysis", "Cost Analysis");
        string typesTitle = localizer.GetString("analytics.charging.costByType", "Cost by Charger Type");

        var brands = BuildBrandLeaderboard(data.Brands, localizer);
        var monthly = BuildMonthly(data.MonthlyTrend, localizer);
        var costCards = BuildCostCards(data.CostStats, symbol, localizer);
        var types = BuildChargerTypes(data.ChargerTypes, localizer);

        string energyLabel = localizer.GetString("analytics.charging.energykWh", "Energy (kWh)");
        string avgPowerLabel = localizer.GetString("analytics.charging.avgPowerkW", "Avg Power (kW)");
        string sessionsLabel = localizer.GetString("analytics.charging.sessions", "Sessions");
        string chartAria = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            monthlyTitle);

        return new ChargingDetailDisplay(
            BrandsTitle: brandsTitle,
            Brands: brands,
            HasBrands: brands.Count > 0,
            NoBrandsMessage: localizer.GetString("analytics.charging.noBrands", "No charger brand data"),
            MonthlyTitle: monthlyTitle,
            Monthly: monthly,
            HasMonthly: monthly.Count > 0,
            NoMonthlyMessage: localizer.GetString("analytics.charging.noMonthly", "No monthly data"),
            EnergySeriesLabel: energyLabel,
            AvgPowerSeriesLabel: avgPowerLabel,
            SessionsSeriesLabel: sessionsLabel,
            MonthlyChartAriaLabel: chartAria,
            CostTitle: costTitle,
            CostCards: costCards,
            HasCostStats: costCards.Length > 0,
            NoCostStatsMessage: localizer.GetString("analytics.charging.noCostStats", "No cost statistics"),
            TypesTitle: typesTitle,
            ChargerTypes: types,
            HasChargerTypes: types.Count > 0,
            NoChargerTypesMessage: localizer.GetString("analytics.charging.noCostByType", "No charger type data"),
            HasAnyData: data.HasAnyData,
            AutomationName: localizer.GetString("analytics.charging.detailAria", "Charging analytics detail"));
    }

    private static IReadOnlyList<ChargingDetailBarRow> BuildBrandLeaderboard(
        IReadOnlyList<ChargingDetailBrand> brands,
        ILocalizer localizer)
    {
        if (brands.Count == 0)
        {
            return Array.Empty<ChargingDetailBarRow>();
        }

        // web: maxCount = brands.reduce(max, 0) || 1
        double maxCount = 0;
        foreach (var b in brands)
        {
            double c = Safe(b.Count);
            if (c > maxCount)
            {
                maxCount = c;
            }
        }

        if (maxCount <= 0)
        {
            maxCount = 1;
        }

        string sessionsWord = localizer.GetString("analytics.charging.sessions", "sessions");

        var rows = new List<ChargingDetailBarRow>(brands.Count);
        for (int i = 0; i < brands.Count; i++)
        {
            var b = brands[i];
            double count = Safe(b.Count);
            string countText = ScalarFormatters.FormatNumber(count, 0);
            string label = string.Format(CultureInfo.CurrentCulture, "#{0} {1}", i + 1, b.Brand);

            rows.Add(new ChargingDetailBarRow(
                Label: label,
                Value: count,
                Max: maxCount,
                ValueText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", countText, sessionsWord),
                AccentBrushKey: BrandAccentKey,
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, countText, sessionsWord)));
        }

        return rows;
    }

    private static IReadOnlyList<ChargingDetailMonthRow> BuildMonthly(
        IReadOnlyList<ChargingDetailMonthPoint> monthly,
        ILocalizer localizer)
    {
        if (monthly.Count == 0)
        {
            return Array.Empty<ChargingDetailMonthRow>();
        }

        string energyLabel = localizer.GetString("analytics.charging.energykWh", "Energy (kWh)");
        string avgPowerLabel = localizer.GetString("analytics.charging.avgPowerkW", "Avg Power (kW)");
        string sessionsLabel = localizer.GetString("analytics.charging.sessions", "Sessions");

        var rows = new List<ChargingDetailMonthRow>(monthly.Count);
        foreach (var m in monthly)
        {
            string energyText = ScalarFormatters.FormatNumber(Safe(m.Energy), 1);
            string avgPowerText = ScalarFormatters.FormatNumber(Safe(m.AvgPower), 1);
            string sessionsText = ScalarFormatters.FormatNumber(Safe(m.Sessions), 0);

            rows.Add(new ChargingDetailMonthRow(
                Month: m.Month,
                Energy: Safe(m.Energy),
                AvgPower: Safe(m.AvgPower),
                Sessions: Safe(m.Sessions),
                EnergyText: energyText,
                AvgPowerText: avgPowerText,
                SessionsText: sessionsText,
                AutomationName: string.Format(
                    CultureInfo.CurrentCulture,
                    "{0}: {1} {2}, {3} {4}, {5} {6}",
                    m.Month,
                    energyText, energyLabel,
                    avgPowerText, avgPowerLabel,
                    sessionsText, sessionsLabel)));
        }

        return rows;
    }

    private static ChargingDetailCostCard[] BuildCostCards(
        ChargingDetailCostStats? costStats,
        string symbol,
        ILocalizer localizer)
    {
        if (costStats is null)
        {
            return Array.Empty<ChargingDetailCostCard>();
        }

        return new[]
        {
            Card(localizer.GetString("analytics.charging.minCost", "Min Cost"), costStats.Min, CostMinAccentKey, symbol),
            Card(localizer.GetString("analytics.charging.avgCost", "Avg Cost"), costStats.Avg, CostAvgAccentKey, symbol),
            Card(localizer.GetString("analytics.charging.medianCost", "Median Cost"), costStats.Median, CostMedianAccentKey, symbol),
            Card(localizer.GetString("analytics.charging.maxCost", "Max Cost"), costStats.Max, CostMaxAccentKey, symbol),
        };
    }

    private static ChargingDetailCostCard Card(string label, double value, string accentKey, string symbol)
    {
        string text = ScalarFormatters.FormatCurrency(Safe(value), symbol, 2);
        return new ChargingDetailCostCard(
            Label: label,
            Value: text,
            AccentBrushKey: accentKey,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, text));
    }

    private static IReadOnlyList<ChargingDetailBarRow> BuildChargerTypes(
        IReadOnlyList<ChargingDetailChargerType> types,
        ILocalizer localizer)
    {
        if (types.Count == 0)
        {
            return Array.Empty<ChargingDetailBarRow>();
        }

        // web: totalSessions = chargerTypes.reduce((s, x) => s + safe(x.count), 0)
        double totalSessions = 0;
        foreach (var ct in types)
        {
            totalSessions += Safe(ct.Count);
        }

        var rows = new List<ChargingDetailBarRow>(types.Count);
        for (int i = 0; i < types.Count; i++)
        {
            var ct = types[i];
            double count = Safe(ct.Count);
            double pct = totalSessions > 0 ? count / totalSessions * 100 : 0;
            string countText = ScalarFormatters.FormatNumber(count, 0);
            string pctText = ScalarFormatters.FormatPercentage(pct, 0);
            string valueText = string.Format(CultureInfo.CurrentCulture, "{0} ({1})", countText, pctText);

            rows.Add(new ChargingDetailBarRow(
                Label: ct.Type,
                Value: count,
                Max: totalSessions > 0 ? totalSessions : 1,
                ValueText: valueText,
                AccentBrushKey: ChartPalette.KeyForIndex(i),
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", ct.Type, valueText)));
        }

        return rows;
    }

    // web `safe`: a non-finite value (undefined/NaN) is treated as 0.
    private static double Safe(double value) => double.IsNaN(value) || double.IsInfinity(value) ? 0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ChargingDetailAnalytics&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingDetailResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<ChargingDetailAnalytics> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingDetailAnalytics Parse() =>
            raw.HasValue ? ChargingDetailAnalytics.FromFleetJson(raw.Value) : ChargingDetailAnalytics.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingDetailAnalytics>.Loading(),
            LoadStatus.Cached => RepositoryResult<ChargingDetailAnalytics>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingDetailAnalytics>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ChargingDetailAnalytics>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ChargingDetailAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ChargingDetailAnalytics>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ChargingDetailAnalytics>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Charging-detail feature surface — the native mirror of the web component at
/// web/src/features/analytics/components/analytics/ChargingDetailSection.tsx. The surface reads the same
/// fleet-analytics endpoint the web analytics page feeds the section.
/// </summary>
public static class ChargingDetailRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "charging-detail-section";

    /// <summary>Surface category.</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingDetailSection";

    /// <summary>
    /// The trailing window the surface requests from <c>/analytics/fleet</c>. The web analytics page feeds
    /// this section from a range-bound query; the standalone native surface uses the same 30-day default the
    /// dashboard fleet-analytics widgets request.
    /// </summary>
    public const int DefaultDays = 30;

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("analytics.charging.detailTitle", "Charging Detail");
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging-detail surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a brand, charger type, cost or session
/// count — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingDetailDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingDetailDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingDetailSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingDetailRegistration.Slug}");
    }
}
