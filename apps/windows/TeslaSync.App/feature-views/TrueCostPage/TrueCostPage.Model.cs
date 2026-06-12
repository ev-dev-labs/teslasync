using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The user's fuel-volume preference used to label the equivalent-gas price line — the native mirror of
/// the web <c>settings.gas_unit ?? 'gallon'</c> gate in
/// web/src/features/analytics/pages/TrueCostPage.tsx. Both labels resolve from the string catalog so
/// either unit reads correctly regardless of which one is active.
/// </summary>
public enum GasUnit
{
    /// <summary>US gallon (web default).</summary>
    Gallon,

    /// <summary>Litre.</summary>
    Liter,
}

/// <summary>
/// The lifecycle state the <see cref="TrueCostPageViewModel"/> can be in — the native union of the four
/// web data states (<c>loading</c> / <c>empty</c> / <c>error</c> / <c>success</c>) plus the
/// cached/stale/offline freshness branches the cache-then-network engine emits. The page renders the full
/// hero-cards + charts + breakdown layout for <see cref="Loaded"/>, <see cref="Stale"/> and
/// <see cref="Offline"/> (web <c>tco ?</c> truthy); a populated-but-charging-empty response still renders
/// success because the TCO endpoint returns a populated object even with no charging history (the per-chart
/// "no monthly data" body covers an empty breakdown). Only a genuinely empty response collapses to
/// <see cref="Empty"/> (web <c>tco</c> null), and a failed first read with no cache to <see cref="Error"/>.
/// </summary>
public enum TrueCostState
{
    /// <summary>Initial fetch with no cached snapshot — the page-level loading body (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A snapshot with cost data — render hero cards, charts and the savings breakdown.</summary>
    Loaded,

    /// <summary>A genuinely empty response — render the page-level empty state (web <c>tco</c> null).</summary>
    Empty,

    /// <summary>The first read failed with no cache — render the error banner (web <c>error</c>).</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One month of the cost rollup (web <c>MonthlyCostEntry</c> in web/src/types/analytics.ts). Parsing is
/// null-tolerant so a partial row never throws. <see cref="EnergyWh"/> is SI watt-hours; the costs are
/// already in the account currency. Pure data — no WinUI types.
/// </summary>
/// <param name="Month">The <c>YYYY-MM</c> label (web <c>entry.month ?? '—'</c>).</param>
/// <param name="EvCost">The EV charging cost for the month (web <c>ev_cost ?? 0</c>).</param>
/// <param name="EquivGasCost">The equivalent gas cost for the month (web <c>equiv_gas_cost ?? 0</c>).</param>
/// <param name="CumulativeSavings">Running EV-vs-gas savings through the month (web <c>cumulative_savings ?? 0</c>).</param>
/// <param name="EnergyWh">SI energy charged that month (web <c>energy_wh ?? 0</c>).</param>
public sealed record TrueCostMonth(
    string Month,
    double EvCost,
    double EquivGasCost,
    double CumulativeSavings,
    double EnergyWh);

/// <summary>
/// The total-cost-of-ownership rollup from <c>GET /analytics/tco?vehicle_id=…</c> (web
/// <c>useCostBreakdown</c>, shape <c>CostBreakdown</c> in web/src/types/analytics.ts). Field names mirror
/// the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws.
/// <see cref="TotalWh"/> is SI watt-hours and <see cref="TotalKm"/> is kilometres; both are restated to the
/// user's display unit only at projection time. Pure data — no WinUI types.
/// </summary>
public sealed record TrueCostBreakdown(
    double TotalChargingCost,
    double TotalWh,
    int TotalSessions,
    double TotalKm,
    string FirstDate,
    string LastDate,
    double EquivalentGasCost,
    double TotalSavings,
    double MonthlySavings,
    double CostPerKmEv,
    double CostPerKmIce,
    double MaintenanceSavingsEstimate,
    double MonthsOfOwnership,
    double GasPrice,
    double GasEfficiencyMpg,
    IReadOnlyList<TrueCostMonth> MonthlyBreakdown)
{
    private const string EmDash = "\u2014";

    /// <summary>An all-zero snapshot with no months — the parse fallback for an absent/non-object body.</summary>
    public static TrueCostBreakdown Empty { get; } = new(
        0, 0, 0, 0, EmDash, EmDash, 0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<TrueCostMonth>());

    /// <summary>True when there is at least one monthly breakdown row (web <c>monthlyBreakdown.length &gt; 0</c>).</summary>
    public bool HasMonthlyData => MonthlyBreakdown.Count > 0;

    /// <summary>Project a <c>GET /analytics/tco</c> JSON object into a tolerant snapshot.</summary>
    public static TrueCostBreakdown FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TrueCostBreakdown(
            TotalChargingCost: GetDouble(element, "total_charging_cost") ?? 0,
            TotalWh: GetDouble(element, "total_wh") ?? 0,
            TotalSessions: (int)Math.Round(GetDouble(element, "total_sessions") ?? 0, MidpointRounding.AwayFromZero),
            TotalKm: GetDouble(element, "total_km") ?? 0,
            FirstDate: GetString(element, "first_date") ?? EmDash,
            LastDate: GetString(element, "last_date") ?? EmDash,
            EquivalentGasCost: GetDouble(element, "equivalent_gas_cost") ?? 0,
            TotalSavings: GetDouble(element, "total_savings") ?? 0,
            MonthlySavings: GetDouble(element, "monthly_savings") ?? 0,
            CostPerKmEv: GetDouble(element, "cost_per_km_ev") ?? 0,
            CostPerKmIce: GetDouble(element, "cost_per_km_ice") ?? 0,
            MaintenanceSavingsEstimate: GetDouble(element, "maintenance_savings_estimate") ?? 0,
            MonthsOfOwnership: GetDouble(element, "months_of_ownership") ?? 0,
            GasPrice: GetDouble(element, "gas_price") ?? 0,
            GasEfficiencyMpg: GetDouble(element, "gas_efficiency_mpg") ?? 0,
            MonthlyBreakdown: GetMonths(element, "monthly_breakdown"));
    }

    private static IReadOnlyList<TrueCostMonth> GetMonths(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TrueCostMonth>();
        }

        var list = new List<TrueCostMonth>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new TrueCostMonth(
                Month: GetString(item, "month") ?? EmDash,
                EvCost: GetDouble(item, "ev_cost") ?? 0,
                EquivGasCost: GetDouble(item, "equiv_gas_cost") ?? 0,
                CumulativeSavings: GetDouble(item, "cumulative_savings") ?? 0,
                EnergyWh: GetDouble(item, "energy_wh") ?? 0));
        }

        return list;
    }

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
/// One projected, display-ready hero stat card (the native counterpart of the web hero <c>GlassPanel</c> +
/// <c>StatCard</c>): the localized label, the already-formatted value, the sub-line, the resolved Fluent
/// glyph and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record TrueCostStat(string Label, string Value, string Sublabel, string Glyph, string AutomationName);

/// <summary>
/// One projected savings-breakdown sub-card (the native counterpart of the three cards inside the web
/// "Savings Breakdown" <c>GlassPanel</c>): a label, an already-formatted value and a sub-line. Pure data.
/// </summary>
public sealed record TrueCostBreakdownCard(string Label, string Value, string Sublabel);

/// <summary>
/// The fully projected, render-ready view of the TCO rollup — the native analogue of everything the web
/// page computes before returning JSX. Holds the localized header, the four hero stat cards, the three
/// chart titles + ARIA summaries + bound <see cref="ChartSeries"/>, the two cost-per-km chips, the three
/// savings-breakdown cards, and the localized empty / no-monthly-data messages. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record TrueCostDisplay(
    string Title,
    string Subtitle,
    TrueCostStat TotalEvCost,
    TrueCostStat EquivGasCost,
    TrueCostStat TotalSavings,
    TrueCostStat MonthlySavings,
    string CumulativeTitle,
    string CumulativeAria,
    IReadOnlyList<ChartSeries> CumulativeSeries,
    string CostPerKmTitle,
    string CostPerKmAria,
    IReadOnlyList<ChartSeries> CostPerKmSeries,
    string CostPerKmEvChipValue,
    string CostPerKmEvChipLabel,
    string CostPerKmIceChipValue,
    string CostPerKmIceChipLabel,
    string MonthlyTitle,
    string MonthlyAria,
    IReadOnlyList<ChartSeries> MonthlySeries,
    string SavingsBreakdownTitle,
    TrueCostBreakdownCard FuelSavings,
    TrueCostBreakdownCard MaintenanceSavings,
    TrueCostBreakdownCard TotalEstimatedSavings,
    bool HasMonthlyData,
    string NoMonthlyDataMessage,
    string NoDataMessage);

/// <summary>
/// Pure projection from a raw <see cref="TrueCostBreakdown"/> to the render-ready <see cref="TrueCostDisplay"/>
/// — the native port of the JSX-time computation in
/// web/src/features/analytics/pages/TrueCostPage.tsx (hero stat cards, the cumulative-savings area series,
/// the cost-per-km comparison bars + chips, the monthly EV-vs-gas bars, and the savings-breakdown cards).
/// Currency is formatted via the C# behavior port (<see cref="ScalarFormatters"/>); SI energy and distance
/// are restated to the user's display unit here (and only here) via <see cref="UnitFormatters"/>; every
/// label resolves through the i18n facade with the web key names.
/// </summary>
public static class TrueCostProjection
{
    /// <summary>The default currency fraction digits (web <c>useFormatting</c> <c>decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>The per-kilometre cost fraction digits (web <c>Currency precision={3}</c>).</summary>
    public const int PerKmPrecision = 3;

    // Segoe Fluent Icons glyphs (web lucide icons: Zap / Fuel / Leaf / TrendingUp / DollarSign).
    private const string EvGlyph = "\uE945";        // Lightning (web Zap)
    private const string GasGlyph = "\uE950";       // Gauge (web Fuel)
    private const string SavingsGlyph = "\uE909";   // Eco / leaf (web Leaf)
    private const string MonthlyGlyph = "\uE9D9";   // Trending up (web TrendingUp)

    /// <summary>Project <paramref name="data"/> using the user's units, currency and fuel-volume preference.</summary>
    public static TrueCostDisplay Project(
        TrueCostBreakdown data,
        UnitPref units,
        string currencySymbol,
        int currencyPrecision,
        GasUnit gasUnit,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = currencyPrecision < 0 ? 0 : currencyPrecision;

        // Both fuel-volume labels are resolved so either preference reads correctly (web ternary).
        string gallonLabel = localizer.GetString("common.unit.gallon", "gal");
        string literLabel = localizer.GetString("common.unit.liter", "L");
        string gasUnitLabel = gasUnit == GasUnit.Liter ? literLabel : gallonLabel;

        string title = localizer.GetString("tco.title", "True Cost of Ownership");
        string subtitle = localizer.GetString(
            "tco.subtitle", "Compare your EV running costs against an equivalent gas vehicle");

        // ---- Hero stat cards (web four GlassPanel + StatCard) ----
        var totalEvCost = Stat(
            localizer.GetString("tco.totalEvCost", "Total EV Cost"),
            Currency(data.TotalChargingCost, symbol, precision),
            string.Format(
                CultureInfo.CurrentCulture,
                "{0} \u00B7 {1} {2}",
                UnitFormatters.FormatEnergy(data.TotalWh, units),
                ScalarFormatters.FormatNumber(data.TotalSessions, 0),
                localizer.GetString("tco.sessions", "sessions")),
            EvGlyph);

        var equivGasCost = Stat(
            localizer.GetString("tco.equivGasCost", "Equiv. Gas Cost"),
            Currency(data.EquivalentGasCost, symbol, precision),
            string.Format(
                CultureInfo.CurrentCulture,
                "@ {0}/{1} \u00B7 {2} MPG",
                Currency(data.GasPrice, symbol, precision),
                gasUnitLabel,
                ScalarFormatters.FormatNumber(data.GasEfficiencyMpg, 0)),
            GasGlyph);

        var totalSavings = Stat(
            localizer.GetString("tco.totalSavings", "Total Savings"),
            Currency(data.TotalSavings, symbol, precision),
            Fill(
                localizer.GetString("tco.overMonths", "Over {0} months"),
                ScalarFormatters.FormatNumber(data.MonthsOfOwnership, 0)),
            SavingsGlyph);

        var monthlySavings = Stat(
            localizer.GetString("tco.monthlySavings", "Monthly Savings"),
            Currency(data.MonthlySavings, symbol, precision),
            localizer.GetString("tco.plusMaintenance", "+ ~$50/mo maintenance savings"),
            MonthlyGlyph);

        // ---- Cumulative savings area series (web AreaChart cumulative_savings) ----
        string cumulativeTitle = localizer.GetString("tco.cumulativeSavings", "Cumulative Savings Over Time");
        IReadOnlyList<ChartSeries> cumulativeSeries;
        if (data.MonthlyBreakdown.Count > 0)
        {
            var cumulativePoints = new List<ChartPoint>(data.MonthlyBreakdown.Count);
            for (int i = 0; i < data.MonthlyBreakdown.Count; i++)
            {
                cumulativePoints.Add(new ChartPoint(i, data.MonthlyBreakdown[i].CumulativeSavings, data.MonthlyBreakdown[i].Month));
            }

            cumulativeSeries = new[]
            {
                new ChartSeries(cumulativeTitle, cumulativePoints)
                {
                    Kind = ChartSeriesKind.Area,
                    Role = ChartRole.Battery,
                    Decimals = 0,
                },
            };
        }
        else
        {
            cumulativeSeries = Array.Empty<ChartSeries>();
        }

        // ---- Cost per km comparison bars + chips (web BarChart cost + two Currency chips) ----
        string evCategory = localizer.GetString("tco.evElectric", "EV (Electric)");
        string iceCategory = localizer.GetString("tco.iceGas", "ICE (Gas)");
        var costPerKmSeries = new[]
        {
            new ChartSeries(
                localizer.GetString("tco.costKm", "Cost/km"),
                new[]
                {
                    new ChartPoint(0, data.CostPerKmEv, evCategory),
                    new ChartPoint(1, data.CostPerKmIce, iceCategory),
                })
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 0,
                Decimals = PerKmPrecision,
            },
        };

        // ---- Monthly EV vs gas bars (web BarChart ev_cost + equiv_gas_cost) ----
        string evCostName = localizer.GetString("tco.evCost", "EV Cost");
        string gasEquivName = localizer.GetString("tco.gasEquiv", "Gas Equiv.");
        IReadOnlyList<ChartSeries> monthlySeries;
        if (data.MonthlyBreakdown.Count > 0)
        {
            var evPoints = new List<ChartPoint>(data.MonthlyBreakdown.Count);
            var gasPoints = new List<ChartPoint>(data.MonthlyBreakdown.Count);
            for (int i = 0; i < data.MonthlyBreakdown.Count; i++)
            {
                var m = data.MonthlyBreakdown[i];
                evPoints.Add(new ChartPoint(i, m.EvCost, m.Month));
                gasPoints.Add(new ChartPoint(i, m.EquivGasCost, m.Month));
            }

            monthlySeries = new[]
            {
                new ChartSeries(evCostName, evPoints) { Kind = ChartSeriesKind.Bar, Role = ChartRole.Speed, Decimals = 0 },
                new ChartSeries(gasEquivName, gasPoints) { Kind = ChartSeriesKind.Bar, ColorIndex = 4, Decimals = 0 },
            };
        }
        else
        {
            monthlySeries = Array.Empty<ChartSeries>();
        }

        // ---- Savings breakdown cards (web three sub-cards) ----
        var fuelSavings = new TrueCostBreakdownCard(
            localizer.GetString("tco.fuelSavings", "Fuel Savings"),
            Currency(data.TotalSavings, symbol, precision),
            localizer.GetString("tco.electricityVsGas", "Electricity vs gasoline"));

        var maintenanceSavings = new TrueCostBreakdownCard(
            localizer.GetString("tco.maintenanceSavings", "Maintenance Savings (Est.)"),
            Currency(data.MaintenanceSavingsEstimate, symbol, precision),
            localizer.GetString("tco.noOilChanges", "No oil changes, less brake wear"));

        var totalEstimated = new TrueCostBreakdownCard(
            localizer.GetString("tco.totalEstSavings", "Total Estimated Savings"),
            Currency(data.TotalSavings + data.MaintenanceSavingsEstimate, symbol, precision),
            string.Format(
                CultureInfo.CurrentCulture,
                "{0} \u00B7 {1} \u2192 {2}",
                UnitFormatters.FormatDistance(data.TotalKm * 1000, units, 0),
                data.FirstDate,
                data.LastDate));

        return new TrueCostDisplay(
            Title: title,
            Subtitle: subtitle,
            TotalEvCost: totalEvCost,
            EquivGasCost: equivGasCost,
            TotalSavings: totalSavings,
            MonthlySavings: monthlySavings,
            CumulativeTitle: cumulativeTitle,
            CumulativeAria: localizer.GetString("tco.cumulativeSavings.aria", "Cumulative EV-vs-gas savings area chart over time"),
            CumulativeSeries: cumulativeSeries,
            CostPerKmTitle: localizer.GetString("tco.costPerKm", "Cost per Kilometer"),
            CostPerKmAria: localizer.GetString("tco.costPerKm.aria", "Cost per kilometer bar chart comparing EV electricity to gas"),
            CostPerKmSeries: costPerKmSeries,
            CostPerKmEvChipValue: Currency(data.CostPerKmEv, symbol, PerKmPrecision),
            CostPerKmEvChipLabel: localizer.GetString("tco.perKmEv", "per km (EV)"),
            CostPerKmIceChipValue: Currency(data.CostPerKmIce, symbol, PerKmPrecision),
            CostPerKmIceChipLabel: localizer.GetString("tco.perKmGas", "per km (Gas)"),
            MonthlyTitle: localizer.GetString("tco.monthlyEvVsGas", "Monthly EV vs Gas Cost"),
            MonthlyAria: localizer.GetString("tco.monthlyEvVsGas.aria", "Monthly EV vs gas cost comparison bar chart"),
            MonthlySeries: monthlySeries,
            SavingsBreakdownTitle: localizer.GetString("tco.savingsBreakdown", "Savings Breakdown"),
            FuelSavings: fuelSavings,
            MaintenanceSavings: maintenanceSavings,
            TotalEstimatedSavings: totalEstimated,
            HasMonthlyData: data.HasMonthlyData,
            NoMonthlyDataMessage: localizer.GetString("tco.noMonthlyData", "No monthly data available yet"),
            NoDataMessage: localizer.GetString(
                "tco.noData", "No data available. Start charging to see your cost analysis."));
    }

    /// <summary>Format a currency amount — the native port of <c>useFormatting.formatCurrency</c>.</summary>
    public static string Currency(double amount, string symbol, int decimals) =>
        ScalarFormatters.FormatCurrency(amount, string.IsNullOrWhiteSpace(symbol) ? "$" : symbol, decimals < 0 ? 0 : decimals);

    private static TrueCostStat Stat(string label, string value, string sublabel, string glyph) =>
        new(label, value, sublabel, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, sublabel));

    // Substitute the one interpolation token a string carries, accepting both the catalog's {0} form and
    // the web fallback's {{months}} form so production and headless tests both resolve.
    private static string Fill(string template, string value) =>
        template
            .Replace("{0}", value, StringComparison.Ordinal)
            .Replace("{{months}}", value, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;TrueCostBreakdown&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class TrueCostResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<TrueCostBreakdown> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        TrueCostBreakdown Parse() => raw.HasValue ? TrueCostBreakdown.FromJson(raw.Value) : TrueCostBreakdown.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<TrueCostBreakdown>.Loading(),
            LoadStatus.Cached => RepositoryResult<TrueCostBreakdown>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TrueCostBreakdown>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<TrueCostBreakdown>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<TrueCostBreakdown>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<TrueCostBreakdown>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<TrueCostBreakdown>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The data port the <see cref="TrueCostPageViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useCostBreakdown</c> hook. It yields the cache-then-network sequence of parsed
/// TCO snapshots for the scoped vehicle. The view never performs HTTP; the repository-backed
/// <see cref="TrueCostBreakdownSource"/> (or a test fake) drives this.
/// </summary>
public interface ITrueCostBreakdownSource
{
    /// <summary>Stream the cache-then-network TCO snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<TrueCostBreakdown>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="ITrueCostBreakdownSource"/> — resolves every read to the empty data state. It is
/// the parameterless-constructed page's feed (the navigation host wires the repository-backed source via
/// <see cref="TrueCostBreakdownSource"/>), mirroring how the other W7 pages default to an empty feed until a
/// data adapter is supplied.
/// </summary>
public sealed class EmptyTrueCostBreakdownSource : ITrueCostBreakdownSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTrueCostBreakdownSource Instance { get; } = new();

    private EmptyTrueCostBreakdownSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TrueCostBreakdown>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<TrueCostBreakdown>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Canonical metadata for the True Cost of Ownership page — the native mirror of the web route
/// <c>/analytics/tco</c> (nav name <c>TrueCostOwnership</c>). The shell page factory registers the surface
/// under <see cref="RouteName"/>; the title / subtitle resolve through the i18n facade with the web key
/// names.
/// </summary>
public static class TrueCostRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "TrueCostOwnership";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TrueCostPage";

    /// <summary>The localized page title (web <c>tco.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("tco.title", "True Cost of Ownership");
    }

    /// <summary>The localized page subtitle (web <c>tco.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "tco.subtitle", "Compare your EV running costs against an equivalent gas vehicle");
    }
}

/// <summary>
/// PII-safe diagnostics for the True Cost page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a cost figure, vehicle id or VIN — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TrueCostDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TrueCostDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TrueCostPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TrueCostRegistration.Slug}");
    }
}
