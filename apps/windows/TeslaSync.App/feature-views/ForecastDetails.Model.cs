using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="ForecastDetailsViewModel"/> can be in — the native
/// union of the loading / loaded / empty / error / stale / offline branches the surface renders. The web
/// component (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx) is presentational (it
/// receives a resolved <c>CostForecastData</c> as a prop and performs no fetching), so the native
/// feature-view owns its own cost-forecast read and therefore renders the full state matrix the P2 contract
/// mandates. Every branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the
/// web's <c>forecastData === undefined</c> case, where all three panels fall back to their own empty copy.
/// </summary>
public enum ForecastDetailsState
{
    /// <summary>Initial fetch with no cached snapshot — render the three-panel skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) carrying a cost-forecast payload.</summary>
    Loaded,

    /// <summary>The request resolved with no forecast payload — every panel shows its own empty copy.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charging-source category of the cost-forecast breakdown (web <c>CostBreakdownData.home</c> /
/// <c>.supercharger</c>), narrowed to the two fields the web <c>ForecastDetails</c> reads: <see cref="Percent"/>
/// is the donut wedge's 0..100 share (web <c>pct</c>) and <see cref="AvgCostPerKwh"/> is the per-kWh price the
/// legend renders (web <c>avg_cost_per_kwh</c>). Both are plain account-currency / dimensionless figures that
/// need no unit conversion.
/// </summary>
public sealed record ForecastCategory(double Percent, double AvgCostPerKwh)
{
    /// <summary>An all-zero category — the parse fallback for an absent breakdown sub-object.</summary>
    public static ForecastCategory Zero { get; } = new(0, 0);
}

/// <summary>The home-vs-supercharger split of the cost-forecast breakdown (web <c>CostBreakdownData</c>).</summary>
public sealed record ForecastBreakdown(ForecastCategory Home, ForecastCategory Supercharger)
{
    /// <summary>An all-zero breakdown — the parse fallback when the <c>breakdown</c> object is absent.</summary>
    public static ForecastBreakdown Zero { get; } = new(ForecastCategory.Zero, ForecastCategory.Zero);
}

/// <summary>
/// The gas-versus-EV comparison block of the cost forecast (web <c>GasComparisonData</c>) — the six figures
/// the web savings panel reads. <see cref="AvgKmPerMonth"/> is rendered as a dimensionless count exactly as
/// the web does (<c>fmtNumber(avg_km_per_month, 0)</c> with a literal "km/mo" label), so no distance
/// conversion is applied at this boundary; the remaining five are plain account-currency amounts.
/// </summary>
public sealed record ForecastGasComparison(
    double AvgKmPerMonth,
    double GasCostPerMonth,
    double EvCostPerMonth,
    double MonthlySavings,
    double AnnualSavings,
    double LifetimeSavings)
{
    /// <summary>An all-zero comparison — the parse fallback when the <c>gas_comparison</c> object is absent.</summary>
    public static ForecastGasComparison Zero { get; } = new(0, 0, 0, 0, 0, 0);
}

/// <summary>
/// The slice of <c>GET /analytics/cost-forecast</c> the surface consumes — the breakdown, gas-comparison and
/// insights the web <c>ForecastDetails</c> reads off its <c>forecastData</c> prop. Every numeric field is
/// <c>safe()</c>-coerced at parse time (web renders a finite number or falls through to zero) so a missing /
/// NaN / non-numeric field never throws and never shows NaN. Parsing is null-tolerant so a partial or
/// schema-drifted body degrades to zeros rather than failing.
/// </summary>
public sealed record CostForecastSnapshot(
    ForecastBreakdown Breakdown,
    ForecastGasComparison GasComparison,
    IReadOnlyList<string> Insights,
    bool HasData)
{
    /// <summary>An all-absent snapshot — the parse fallback for an absent / non-object / non-forecast body.</summary>
    public static CostForecastSnapshot Empty { get; } =
        new(ForecastBreakdown.Zero, ForecastGasComparison.Zero, Array.Empty<string>(), false);

    /// <summary>Project a <c>GET /analytics/cost-forecast</c> JSON object into a tolerant forecast snapshot.</summary>
    public static CostForecastSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // A populated CostForecastData object always carries these keys; their presence is what gates the
        // panels (web renders whatever forecastData prop it receives). An empty object is filtered to Empty by
        // the source before it reaches here.
        bool isForecast = element.TryGetProperty("breakdown", out _)
            || element.TryGetProperty("gas_comparison", out _)
            || element.TryGetProperty("insights", out _);
        if (!isForecast)
        {
            return Empty;
        }

        return new CostForecastSnapshot(
            Breakdown: ParseBreakdown(element),
            GasComparison: ParseGasComparison(element),
            Insights: ParseInsights(element),
            HasData: true);
    }

    private static ForecastBreakdown ParseBreakdown(JsonElement root)
    {
        if (!root.TryGetProperty("breakdown", out var breakdown) || breakdown.ValueKind != JsonValueKind.Object)
        {
            return ForecastBreakdown.Zero;
        }

        return new ForecastBreakdown(ParseCategory(breakdown, "home"), ParseCategory(breakdown, "supercharger"));
    }

    private static ForecastCategory ParseCategory(JsonElement breakdown, string name)
    {
        if (!breakdown.TryGetProperty(name, out var category) || category.ValueKind != JsonValueKind.Object)
        {
            return ForecastCategory.Zero;
        }

        return new ForecastCategory(
            Percent: Safe(GetDouble(category, "pct")),
            AvgCostPerKwh: Safe(GetDouble(category, "avg_cost_per_kwh")));
    }

    private static ForecastGasComparison ParseGasComparison(JsonElement root)
    {
        if (!root.TryGetProperty("gas_comparison", out var gas) || gas.ValueKind != JsonValueKind.Object)
        {
            return ForecastGasComparison.Zero;
        }

        return new ForecastGasComparison(
            AvgKmPerMonth: Safe(GetDouble(gas, "avg_km_per_month")),
            GasCostPerMonth: Safe(GetDouble(gas, "gas_cost_per_month")),
            EvCostPerMonth: Safe(GetDouble(gas, "ev_cost_per_month")),
            MonthlySavings: Safe(GetDouble(gas, "monthly_savings")),
            AnnualSavings: Safe(GetDouble(gas, "annual_savings")),
            LifetimeSavings: Safe(GetDouble(gas, "lifetime_savings")));
    }

    private static IReadOnlyList<string> ParseInsights(JsonElement root)
    {
        if (!root.TryGetProperty("insights", out var insights) || insights.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(insights.GetArrayLength());
        foreach (var item in insights.EnumerateArray())
        {
            // web insights is string[]; keep string entries verbatim and skip any non-string drift.
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } text)
            {
                list.Add(text);
            }
        }

        return list.Count == 0 ? Array.Empty<string>() : list;
    }

    // web `safe`: a finite number passes through; everything else (null / NaN / infinity / non-number) -> 0.
    private static double Safe(double? value) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0;

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready breakdown segment — the native analogue of a single donut wedge plus its
/// legend row (web <c>&lt;Pie&gt;</c> data entry + the legend rows underneath). <see cref="Name"/> is the
/// localized connector-type label; <see cref="Percent"/> is its raw 0..100 share sizing the wedge;
/// <see cref="CostPerKwhText"/> is the formatted per-kWh price the legend shows on the right;
/// <see cref="ColorIndex"/> is the categorical palette index (0 = home, 1 = supercharger, matching the web
/// green/amber ordering); and <see cref="AutomationName"/> is the spoken "<c>{name}, {cost}/kWh</c>".
/// </summary>
public sealed record ForecastBreakdownSegment(
    string Name,
    double Percent,
    string CostPerKwhText,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of <c>ForecastDetails</c> — every localized label, the formatted
/// monetary readouts, the breakdown segments, the insight list and the empty copy for each panel. Pure data,
/// so the projection is unit-tested without a UI host. <see cref="HasData"/> gates the breakdown + savings
/// panels (web renders them whenever <c>forecastData</c> is present); the insights panel is gated separately
/// on <c>Insights.Count &gt; 0</c> (web <c>(forecastData?.insights ?? []).length &gt; 0</c>).
/// </summary>
public sealed record ForecastDetailsDisplay(
    bool HasData,
    string BreakdownTitle,
    IReadOnlyList<ForecastBreakdownSegment> Segments,
    string ChartSummary,
    string NoBreakdownMessage,
    string SavingsTitle,
    double MonthlySavingsValue,
    string MonthlySavingsText,
    string MonthlySavingsLabel,
    string AnnualLabel,
    string AnnualText,
    string LifetimeLabel,
    string LifetimeText,
    string GasCostLabel,
    string GasCostText,
    string EvCostLabel,
    string EvCostText,
    string AvgKmLabel,
    string AvgKmText,
    string NoSavingsMessage,
    string SavingsAutomationName,
    string InsightsTitle,
    IReadOnlyList<string> Insights,
    string NoInsightsMessage,
    string CurrencySymbol);

/// <summary>
/// Pure projection from a parsed <see cref="CostForecastSnapshot"/> to the render-ready
/// <see cref="ForecastDetailsDisplay"/> — the native port of the layout maths + <c>t()</c> composition in
/// web/src/features/charging/components/cost-analysis/ForecastDetails.tsx. Every label resolves through the
/// i18n facade using the same keys the web source feeds into <c>t(...)</c>; the per-kWh prices round to three
/// decimals (web <c>precision={3}</c>), the savings figures to whole units (web savings <c>decimals/precision
/// 0</c>), the monthly gas/EV costs to two decimals (web <c>Currency</c> default), and the average distance is
/// a dimensionless count (web <c>fmtNumber(..., 0)</c>). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ForecastDetailsProjection
{
    /// <summary>The default currency symbol when the host supplies none (web <c>useFormatting</c> default).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Per-kWh price decimals (web <c>&lt;Currency precision={3} /&gt;</c>).</summary>
    public const int CostPerKwhPrecision = 3;

    /// <summary>Savings figure decimals (web monthly/annual/lifetime render with 0 decimals).</summary>
    public const int SavingsPrecision = 0;

    /// <summary>Monthly gas/EV cost decimals (web <c>&lt;Currency /&gt;</c> default precision).</summary>
    public const int MonthlyCostPrecision = 2;

    /// <summary>i18n key for the "Charging Breakdown" panel heading.</summary>
    public const string BreakdownTitleKey = "costAnalysis.forecast.breakdown";

    /// <summary>i18n key for the "Gas vs EV Savings" panel heading.</summary>
    public const string SavingsTitleKey = "costAnalysis.forecast.savings";

    /// <summary>i18n key for the "Insights" panel heading.</summary>
    public const string InsightsTitleKey = "costAnalysis.forecast.insights";

    /// <summary>i18n key for the breakdown panel's empty copy.</summary>
    public const string NoBreakdownKey = "costAnalysis.forecast.noBreakdown";

    /// <summary>i18n key for the "Monthly Savings" eyebrow.</summary>
    public const string MonthlySavingsKey = "costAnalysis.forecast.monthlySavings";

    /// <summary>i18n key for the "Annual" savings label.</summary>
    public const string AnnualKey = "costAnalysis.forecast.annual";

    /// <summary>i18n key for the "Lifetime" savings label.</summary>
    public const string LifetimeKey = "costAnalysis.forecast.lifetime";

    /// <summary>i18n key for the "Gas cost/mo" label.</summary>
    public const string GasCostKey = "costAnalysis.forecast.gasCost";

    /// <summary>i18n key for the "EV cost/mo" label.</summary>
    public const string EvCostKey = "costAnalysis.forecast.evCost";

    /// <summary>i18n key for the "Avg km/mo" label.</summary>
    public const string AvgKmKey = "costAnalysis.forecast.avgKm";

    /// <summary>i18n key for the savings panel's empty copy.</summary>
    public const string NoSavingsKey = "costAnalysis.forecast.noSavings";

    /// <summary>i18n key for the insights panel's empty copy.</summary>
    public const string NoInsightsKey = "costAnalysis.forecast.noInsights";

    /// <summary>i18n key for the "Home" connector label (web <c>t('Home')</c>).</summary>
    public const string HomeKey = "Home";

    /// <summary>i18n key for the "Supercharger" connector label (web <c>t('Supercharger')</c>).</summary>
    public const string SuperchargerKey = "Supercharger";

    /// <summary>Project <paramref name="data"/> into the render-ready forecast-details display.</summary>
    public static ForecastDetailsDisplay Project(CostForecastSnapshot data, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrEmpty(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        string breakdownTitle = localizer.GetString(BreakdownTitleKey, "Charging Breakdown");
        string savingsTitle = localizer.GetString(SavingsTitleKey, "Gas vs EV Savings");
        string insightsTitle = localizer.GetString(InsightsTitleKey, "Insights");

        IReadOnlyList<ForecastBreakdownSegment> segments = data.HasData
            ? BuildSegments(data.Breakdown, localizer, symbol)
            : Array.Empty<ForecastBreakdownSegment>();
        string chartSummary = BuildChartSummary(segments);

        var gas = data.GasComparison;
        string monthlySavingsText = Currency(gas.MonthlySavings, symbol, SavingsPrecision);
        string annualText = Currency(gas.AnnualSavings, symbol, SavingsPrecision);
        string lifetimeText = Currency(gas.LifetimeSavings, symbol, SavingsPrecision);
        string gasCostText = Currency(gas.GasCostPerMonth, symbol, MonthlyCostPrecision);
        string evCostText = Currency(gas.EvCostPerMonth, symbol, MonthlyCostPrecision);
        string avgKmText = ScalarFormatters.FormatNumber(gas.AvgKmPerMonth, 0);

        string monthlySavingsLabel = localizer.GetString(MonthlySavingsKey, "Monthly Savings");
        string annualLabel = localizer.GetString(AnnualKey, "Annual");
        string lifetimeLabel = localizer.GetString(LifetimeKey, "Lifetime");
        string gasCostLabel = localizer.GetString(GasCostKey, "Gas cost/mo");
        string evCostLabel = localizer.GetString(EvCostKey, "EV cost/mo");
        string avgKmLabel = localizer.GetString(AvgKmKey, "Avg km/mo");

        string savingsAria = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}", monthlySavingsLabel, monthlySavingsText);

        return new ForecastDetailsDisplay(
            HasData: data.HasData,
            BreakdownTitle: breakdownTitle,
            Segments: segments,
            ChartSummary: chartSummary,
            NoBreakdownMessage: localizer.GetString(NoBreakdownKey, "Breakdown will appear once charging data is available."),
            SavingsTitle: savingsTitle,
            MonthlySavingsValue: gas.MonthlySavings,
            MonthlySavingsText: monthlySavingsText,
            MonthlySavingsLabel: monthlySavingsLabel,
            AnnualLabel: annualLabel,
            AnnualText: annualText,
            LifetimeLabel: lifetimeLabel,
            LifetimeText: lifetimeText,
            GasCostLabel: gasCostLabel,
            GasCostText: gasCostText,
            EvCostLabel: evCostLabel,
            EvCostText: evCostText,
            AvgKmLabel: avgKmLabel,
            AvgKmText: avgKmText,
            NoSavingsMessage: localizer.GetString(NoSavingsKey, "Savings data will appear once driving history is available."),
            SavingsAutomationName: savingsAria,
            InsightsTitle: insightsTitle,
            Insights: data.Insights,
            NoInsightsMessage: localizer.GetString(NoInsightsKey, "Insights will appear as more data is collected."),
            CurrencySymbol: symbol);
    }

    private static IReadOnlyList<ForecastBreakdownSegment> BuildSegments(
        ForecastBreakdown breakdown,
        ILocalizer localizer,
        string symbol)
    {
        // Web renders both rows unconditionally (Home then Supercharger) whenever forecastData is present,
        // colouring home green (index 0) and supercharger amber (index 1).
        return
        [
            BuildSegment(localizer.GetString(HomeKey, "Home"), breakdown.Home, 0, symbol),
            BuildSegment(localizer.GetString(SuperchargerKey, "Supercharger"), breakdown.Supercharger, 1, symbol),
        ];
    }

    private static ForecastBreakdownSegment BuildSegment(string name, ForecastCategory category, int colorIndex, string symbol)
    {
        string costText = Currency(category.AvgCostPerKwh, symbol, CostPerKwhPrecision) + "/kWh";
        return new ForecastBreakdownSegment(
            Name: name,
            Percent: category.Percent,
            CostPerKwhText: costText,
            ColorIndex: colorIndex,
            AutomationName: $"{name}, {costText}");
    }

    private static string BuildChartSummary(IReadOnlyList<ForecastBreakdownSegment> segments)
    {
        if (segments.Count == 0)
        {
            return string.Empty;
        }

        var parts = new List<string>(segments.Count);
        foreach (var segment in segments)
        {
            parts.Add($"{segment.Name} {ScalarFormatters.FormatPercentage(segment.Percent, 0)}");
        }

        return string.Join(", ", parts);
    }

    private static string Currency(double value, string symbol, int precision) =>
        ScalarFormatters.FormatCurrency(value, symbol, precision);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CostForecastSnapshot&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class CostForecastResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CostForecastSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CostForecastSnapshot Parse() =>
            raw.HasValue ? CostForecastSnapshot.FromJson(raw.Value) : CostForecastSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CostForecastSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<CostForecastSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CostForecastSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<CostForecastSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<CostForecastSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CostForecastSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CostForecastSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the <c>ForecastDetails</c> surface — the native mirror of the web component
/// (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx, rendered inside the charging
/// cost-analysis experience). Centralises the stable id, category and diagnostics slug so the view and
/// view-model stay free of literal identifiers.
/// </summary>
public static class ForecastDetailsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "forecast-details";

    /// <summary>Surface category (matches the web charging feature).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ForecastDetails";
}

/// <summary>
/// PII-safe diagnostics for the <c>ForecastDetails</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, savings figure, currency amount
/// or VIN — so a diagnostics line can never leak account data. Thread-safe.
/// </summary>
public sealed class ForecastDetailsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ForecastDetailsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ForecastDetails</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ForecastDetailsRegistration.Slug}");
    }
}
