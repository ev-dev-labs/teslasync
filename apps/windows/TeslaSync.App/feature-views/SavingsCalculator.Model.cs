using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="SavingsCalculatorViewModel"/> can be in — the native union of the branches
/// the web Gas-vs-Electric savings calculator participates in
/// (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx). The web component is presentational:
/// its parent <c>CostAnalysisPage</c> owns the charging-sessions query and only mounts the calculator once at
/// least one session resolves (otherwise the page renders its own "No Charging Data" empty state). This
/// self-contained surface additionally renders that query's lifecycle as explicit loading / loaded / empty /
/// error / stale / offline branches so no surface is ever hidden. <see cref="Empty"/> mirrors the parent's
/// gate (no charging sessions to derive a comparison from).
/// </summary>
public enum SavingsCalculatorState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) aggregate with charging sessions to compare.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no charging sessions to derive a comparison from — the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached aggregate exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached aggregate older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached aggregate remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charging session reduced to exactly the fields the web cost-analysis aggregation reads
/// (web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts +
/// charging-curve/helpers.ts <c>distanceAddedM</c>). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws. <see cref="EnergyWh"/> is the SI energy added in
/// watt-hours (web <c>total_energy_added_wh</c>); odometers are SI meters. WinUI-free so the parse is
/// unit-tested without a UI host.
/// </summary>
public sealed record SavingsChargingSession(
    double EnergyWh,
    double? Cost,
    double? OdometerStartM,
    double? OdometerEndM,
    DateTimeOffset? StartedAt)
{
    /// <summary>
    /// Distance added during the session in SI meters — the web <c>distanceAddedM</c>: the positive odometer
    /// delta, or 0 when either odometer is absent or the delta is not positive (web returns null there and the
    /// aggregate coerces it with <c>?? 0</c>).
    /// </summary>
    public double DistanceAddedMeters =>
        OdometerStartM is { } start && OdometerEndM is { } end && end - start > 0 ? end - start : 0;

    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<SavingsChargingSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SavingsChargingSession>();
        }

        var list = new List<SavingsChargingSession>(element.GetArrayLength());
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
    public static SavingsChargingSession FromJson(JsonElement obj) => new(
        EnergyWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
        Cost: GetDouble(obj, "cost_decimal"),
        OdometerStartM: GetDouble(obj, "start_odometer_m"),
        OdometerEndM: GetDouble(obj, "end_odometer_m"),
        StartedAt: GetDate(obj, "started_at"));

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

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The three user-editable calculator assumptions — the native mirror of the web component's
/// <c>gasPrice</c> / <c>mpg</c> / <c>electricityRate</c> props (seeded by <c>DEFAULT_*</c> in
/// cost-analysis/constants.ts and reset by the "Reset Defaults" button). Pure data so the recomputation is
/// unit-tested without a UI host.
/// </summary>
public sealed record SavingsCalculatorInputs(double GasPrice, double Mpg, double ElectricityRate)
{
    /// <summary>Default pump price in $/gallon (web <c>DEFAULT_GAS_PRICE</c>).</summary>
    public const double DefaultGasPrice = 3.5;

    /// <summary>Default gas-car economy in miles-per-gallon (web <c>DEFAULT_MPG</c>).</summary>
    public const double DefaultMpg = 30;

    /// <summary>Default electricity price in $/kWh (web <c>DEFAULT_ELECTRICITY_RATE</c>).</summary>
    public const double DefaultElectricityRate = 0.13;

    /// <summary>The seeded defaults the surface starts at and the "Reset Defaults" button restores.</summary>
    public static SavingsCalculatorInputs Default { get; } = new(DefaultGasPrice, DefaultMpg, DefaultElectricityRate);

    /// <summary>Parse a gas-price field (web <c>Number(value) || 0</c>: blank / non-numeric / zero → 0).</summary>
    public static double ParseGasPrice(string? text) => ParseOr(text, 0);

    /// <summary>Parse an electricity-rate field (web <c>Number(value) || 0</c>).</summary>
    public static double ParseElectricityRate(string? text) => ParseOr(text, 0);

    /// <summary>Parse an MPG field (web <c>Number(value) || 1</c>: blank / non-numeric / zero → 1).</summary>
    public static double ParseMpg(string? text) => ParseOr(text, 1);

    // Web onChange coercion: `Number(value) || fallback`. JavaScript's `||` treats 0, NaN and the empty-string
    // coercion as falsy, so a blank, non-numeric or zero entry falls back. Float style matches Number()'s
    // decimal/exponent/sign handling (and rejects grouping commas, as Number() does).
    private static double ParseOr(string? text, double fallback) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value != 0
            ? value
            : fallback;
}

/// <summary>
/// The charging-cost aggregate the comparison is derived from — the native slice of the web <c>coreStats</c>
/// memo (web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts) the calculator depends on:
/// the summed actual cost, the summed energy in kWh, the summed odometer-delta distance in SI meters, the
/// number of distinct calendar months charged (the monthly-savings divisor), and the session count (the
/// presence gate). Pure data so the aggregation is unit-tested without a UI host.
/// </summary>
public sealed record SavingsCostAggregate(
    double TotalCostUsd,
    double TotalEnergyKwh,
    double TotalDistanceM,
    int MonthCount,
    int SessionCount)
{
    /// <summary>True when there is at least one session — the web gate where <c>coreStats</c> is non-null.</summary>
    public bool HasData => SessionCount > 0;

    /// <summary>The all-zero aggregate — the loading / no-session scaffold.</summary>
    public static SavingsCostAggregate Empty { get; } = new(0, 0, 0, 0, 0);

    /// <summary>
    /// Reduce a charging-session list to its cost aggregate — a faithful port of the web <c>coreStats</c>
    /// (totalCost, totalEnergy via <c>convertEnergyFromSI(Σwh,'kWh')</c>, totalDistanceM via the odometer
    /// deltas) plus the <c>monthlyData</c> bucket count used as the monthly-savings divisor.
    /// </summary>
    public static SavingsCostAggregate Aggregate(IReadOnlyList<SavingsChargingSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return Empty;
        }

        double cost = 0;
        double energyWh = 0;
        double distanceM = 0;
        var months = new HashSet<string>(StringComparer.Ordinal);

        foreach (var session in sessions)
        {
            cost += session.Cost ?? 0;
            energyWh += session.EnergyWh;
            distanceM += session.DistanceAddedMeters;
            if (session.StartedAt is { } started)
            {
                // Web buckets monthlyData by `${year}-${month}` of the session start; the count is the
                // monthly-savings divisor. We key off the parsed instant's own year/month for determinism.
                months.Add(string.Create(CultureInfo.InvariantCulture, $"{started.Year:D4}-{started.Month:D2}"));
            }
        }

        return new SavingsCostAggregate(
            TotalCostUsd: cost,
            TotalEnergyKwh: UnitConverters.EnergyFromSi(energyWh, EnergyUnit.Kwh),
            TotalDistanceM: distanceM,
            MonthCount: months.Count,
            SessionCount: sessions.Count);
    }
}

/// <summary>
/// The gas-versus-electric comparison the four readout cards show — the native port of the web
/// <c>gasComparison</c> memo (useCostAnalysisData.ts). Every figure is a plain monetary amount in the account
/// currency; the per-distance figures carry the display distance unit. Pure data so the maths is unit-tested
/// without a UI host.
/// </summary>
public sealed record SavingsGasComparison(
    double GasCost,
    double EvCost,
    double ActualCost,
    double Savings,
    double MonthlySavings,
    double YearlySavings,
    double CostPerDistanceGas,
    double CostPerDistanceEv)
{
    /// <summary>1 mile = 1609.344 m — the web literal the meters→miles step divides by.</summary>
    public const double MetersPerMile = 1609.344;

    /// <summary>The all-zero comparison (the empty / no-session scaffold).</summary>
    public static SavingsGasComparison Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>
    /// Compute the comparison from the aggregate, the user assumptions and the display distance unit — a
    /// faithful port of the web <c>gasComparison</c> memo. The web derives its <c>distMiles</c> as
    /// <c>convertDistanceFromSI(totalDistanceM / 1609.344, unitPrefs.distance)</c> (it composes the meters→miles
    /// step with the SI distance converter); we reproduce that composition verbatim with
    /// <see cref="UnitConverters.DistanceFromSi(double, DistanceUnit)"/> so the figures match the web source.
    /// </summary>
    public static SavingsGasComparison Compute(
        SavingsCostAggregate aggregate,
        SavingsCalculatorInputs inputs,
        DistanceUnit distanceUnit)
    {
        ArgumentNullException.ThrowIfNull(aggregate);
        ArgumentNullException.ThrowIfNull(inputs);

        double distDisplay = UnitConverters.DistanceFromSi(aggregate.TotalDistanceM / MetersPerMile, distanceUnit);
        double gallonsNeeded = inputs.Mpg != 0 ? distDisplay / inputs.Mpg : 0;
        double gasCost = gallonsNeeded * inputs.GasPrice;
        double evCost = aggregate.TotalEnergyKwh * inputs.ElectricityRate;
        double monthlySavings = aggregate.MonthCount > 0
            ? (gasCost - evCost) / Math.Max(aggregate.MonthCount, 1)
            : 0;

        return new SavingsGasComparison(
            GasCost: gasCost,
            EvCost: evCost,
            ActualCost: aggregate.TotalCostUsd,
            Savings: gasCost - aggregate.TotalCostUsd,
            MonthlySavings: monthlySavings,
            YearlySavings: monthlySavings * 12,
            CostPerDistanceGas: distDisplay > 0 ? gasCost / distDisplay : 0,
            CostPerDistanceEv: distDisplay > 0 ? aggregate.TotalCostUsd / distDisplay : 0);
    }
}

/// <summary>
/// The fully projected, render-ready view of the savings calculator — every localized label, the formatted
/// monetary readouts for the four comparison cards, the distance-unit suffix, the comparison-vs-empty gate and
/// the Narrator names. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SavingsCalculatorDisplay(
    bool HasComparison,
    string Title,
    string InputsLabel,
    string ComparisonLabel,
    string GasPriceLabel,
    string MpgLabel,
    string ElectricityRateLabel,
    string GasPriceUnit,
    string MpgUnit,
    string ElectricityRateUnit,
    string ResetLabel,
    string GasCostLabel,
    string GasCostValueText,
    string GasCostPerDistanceText,
    string EvCostLabel,
    string EvCostValueText,
    string EvCostPerDistanceText,
    string TotalSavingsLabel,
    string TotalSavingsValueText,
    string OverPeriodLabel,
    string MonthlySavingsLabel,
    string MonthlySavingsValueText,
    string YearlySavingsText,
    string NoDataMessage,
    string DistanceUnitLabel,
    string GasCostAutomationName,
    string EvCostAutomationName,
    string TotalSavingsAutomationName,
    string MonthlySavingsAutomationName,
    string ComparisonAutomationName);

/// <summary>
/// Pure projection from a <see cref="SavingsCostAggregate"/> + the user assumptions to the render-ready
/// <see cref="SavingsCalculatorDisplay"/> — the native port of the layout maths + <c>t()</c> composition in
/// web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx. The currency formatting mirrors
/// the web's <c>${fmtNumber(x, 2)}</c> / <c>${fmtNumber(x, 3)}/{unit}</c> / <c>~${fmtNumber(x, 0)} / year</c>
/// readouts exactly (en-US grouping, web <c>safeNumber</c> coercion of non-finite values to 0). Every label
/// resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SavingsCalculatorProjection
{
    private const int CostPrecision = 2;
    private const int RatePrecision = 3;
    private const int YearPrecision = 0;

    /// <summary>Project the aggregate + assumptions into the render-ready display via the i18n facade.</summary>
    /// <param name="aggregate">The cost aggregate (or <see cref="SavingsCostAggregate.Empty"/> while loading).</param>
    /// <param name="inputs">The current user assumptions (gas price, MPG, electricity rate).</param>
    /// <param name="distanceUnit">The display distance unit (drives the conversion and the per-distance suffix).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web hardcodes "$"; default "$").</param>
    public static SavingsCalculatorDisplay Project(
        SavingsCostAggregate aggregate,
        SavingsCalculatorInputs inputs,
        DistanceUnit distanceUnit,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(aggregate);
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? SavingsCalculatorRegistration.DefaultCurrencySymbol
            : currencySymbol;
        string unit = UnitLabels.Label(distanceUnit);

        var comparison = SavingsGasComparison.Compute(aggregate, inputs, distanceUnit);

        string gasCostLabel = SavingsCalculatorRegistration.GasCostLabel(localizer);
        string evCostLabel = SavingsCalculatorRegistration.EvCostLabel(localizer);
        string totalSavingsLabel = SavingsCalculatorRegistration.TotalSavingsLabel(localizer);
        string overPeriodLabel = SavingsCalculatorRegistration.OverPeriodLabel(localizer);
        string monthlySavingsLabel = SavingsCalculatorRegistration.MonthlySavingsLabel(localizer);
        string perYearLabel = SavingsCalculatorRegistration.PerYearLabel(localizer);

        string gasCostValue = Currency(comparison.GasCost, symbol, CostPrecision);
        string gasPerDistance = PerDistance(comparison.CostPerDistanceGas, symbol, unit);
        string evCostValue = Currency(comparison.EvCost, symbol, CostPrecision);
        string evPerDistance = PerDistance(comparison.CostPerDistanceEv, symbol, unit);
        string totalSavingsValue = Currency(comparison.Savings, symbol, CostPrecision);
        string monthlySavingsValue = Currency(comparison.MonthlySavings, symbol, CostPrecision);
        string yearlyText = string.Concat("~", Currency(comparison.YearlySavings, symbol, YearPrecision), " ", perYearLabel);

        string gasAria = string.Create(CultureInfo.CurrentCulture, $"{gasCostLabel}: {gasCostValue}, {gasPerDistance}");
        string evAria = string.Create(CultureInfo.CurrentCulture, $"{evCostLabel}: {evCostValue}, {evPerDistance}");
        string totalAria = string.Create(CultureInfo.CurrentCulture, $"{totalSavingsLabel}: {totalSavingsValue}, {overPeriodLabel}");
        string monthlyAria = string.Create(CultureInfo.CurrentCulture, $"{monthlySavingsLabel}: {monthlySavingsValue}, {yearlyText}");
        string comparisonLabel = SavingsCalculatorRegistration.ComparisonLabel(localizer);
        string comparisonAria = aggregate.HasData
            ? string.Create(CultureInfo.CurrentCulture, $"{comparisonLabel}. {gasAria}. {evAria}. {totalAria}. {monthlyAria}")
            : string.Create(CultureInfo.CurrentCulture, $"{comparisonLabel}. {SavingsCalculatorRegistration.NoDataMessage(localizer)}");

        return new SavingsCalculatorDisplay(
            HasComparison: aggregate.HasData,
            Title: SavingsCalculatorRegistration.Title(localizer),
            InputsLabel: SavingsCalculatorRegistration.InputsLabel(localizer),
            ComparisonLabel: comparisonLabel,
            GasPriceLabel: SavingsCalculatorRegistration.GasPriceLabel(localizer),
            MpgLabel: SavingsCalculatorRegistration.MpgLabel(localizer),
            ElectricityRateLabel: SavingsCalculatorRegistration.ElectricityRateLabel(localizer),
            GasPriceUnit: SavingsCalculatorRegistration.GasPriceUnit,
            MpgUnit: SavingsCalculatorRegistration.MpgUnit,
            ElectricityRateUnit: SavingsCalculatorRegistration.ElectricityRateUnit,
            ResetLabel: SavingsCalculatorRegistration.ResetLabel(localizer),
            GasCostLabel: gasCostLabel,
            GasCostValueText: gasCostValue,
            GasCostPerDistanceText: gasPerDistance,
            EvCostLabel: evCostLabel,
            EvCostValueText: evCostValue,
            EvCostPerDistanceText: evPerDistance,
            TotalSavingsLabel: totalSavingsLabel,
            TotalSavingsValueText: totalSavingsValue,
            OverPeriodLabel: overPeriodLabel,
            MonthlySavingsLabel: monthlySavingsLabel,
            MonthlySavingsValueText: monthlySavingsValue,
            YearlySavingsText: yearlyText,
            NoDataMessage: SavingsCalculatorRegistration.NoDataMessage(localizer),
            DistanceUnitLabel: unit,
            GasCostAutomationName: gasAria,
            EvCostAutomationName: evAria,
            TotalSavingsAutomationName: totalAria,
            MonthlySavingsAutomationName: monthlyAria,
            ComparisonAutomationName: comparisonAria);
    }

    // Web `$${fmtNumber(value, decimals)}`: en-US grouped, fixed fraction digits, with the currency symbol.
    // safeNumber coerces a non-finite value to 0 so the readout never degrades to the em-dash.
    private static string Currency(double value, string symbol, int decimals) =>
        ScalarFormatters.FormatCurrency(Safe(value), symbol, decimals);

    // Web `$${fmtNumber(costPerDist, 3)}/{distanceUnit}`.
    private static string PerDistance(double value, string symbol, string unit) =>
        string.Concat(Currency(value, symbol, RatePrecision), "/", unit);

    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto computed
/// <c>RepositoryResult&lt;SavingsCostAggregate&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Parsing the sessions and reducing them
/// to the aggregate happens here so the view never sees raw JSON. Kept pure so the parse-aggregate-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class SavingsCalculatorResultMapper
{
    /// <summary>Parse and aggregate <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<SavingsCostAggregate> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SavingsCostAggregate Aggregate() =>
            SavingsCostAggregate.Aggregate(
                raw.HasValue ? SavingsChargingSession.ParseList(raw.Value) : Array.Empty<SavingsChargingSession>());

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SavingsCostAggregate>.Loading(),
            LoadStatus.Cached => RepositoryResult<SavingsCostAggregate>.Cached(Aggregate(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<SavingsCostAggregate>.Refreshing(Aggregate(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<SavingsCostAggregate>.Loaded(Aggregate(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<SavingsCostAggregate>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<SavingsCostAggregate>.OfflineCached(Aggregate(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<SavingsCostAggregate>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The registry metadata, i18n keys and glyph for the savings-calculator surface. Every web <c>t()</c> call in
/// SavingsCalculator.tsx maps to a <c>GetString</c> here (so the keys are asserted in tests and resolved for
/// real in the app); native-superset chrome (loading / empty / stale / offline / retry) reuses the shared
/// <c>common.*</c> + <c>costAnalysis.empty.*</c> catalog keys where they exist and falls back to English for
/// the rest, exactly as the i18n facade contract guarantees. The input unit suffixes ("$/gal", "mpg", "$/kWh")
/// are unit notation the web hardcodes as the <c>suffix</c> prop, not localizable copy, and are kept verbatim.
/// </summary>
public static class SavingsCalculatorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "savings-calculator";

    /// <summary>Surface category (matches the web charging feature).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SavingsCalculator";

    /// <summary>The default currency symbol (web hardcodes "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "Calculator" glyph — native stand-in for the web Lucide <c>Calculator</c> icon.</summary>
    public const string TitleGlyph = "\uE1D0";

    /// <summary>Gas-price field unit suffix (web hardcoded <c>suffix="$/gal"</c>).</summary>
    public const string GasPriceUnit = "$/gal";

    /// <summary>MPG field unit suffix (web hardcoded <c>suffix="mpg"</c>).</summary>
    public const string MpgUnit = "mpg";

    /// <summary>Electricity-rate field unit suffix (web hardcoded <c>suffix="$/kWh"</c>).</summary>
    public const string ElectricityRateUnit = "$/kWh";

    /// <summary>"Gas vs Electric Savings Calculator" panel title (web <c>costAnalysis.calculator.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.title", "Gas vs Electric Savings Calculator");

    /// <summary>"Your Assumptions" inputs heading (web <c>costAnalysis.calculator.inputs</c>).</summary>
    public static string InputsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.inputs", "Your Assumptions");

    /// <summary>"Comparison" heading (web <c>costAnalysis.calculator.comparison</c>).</summary>
    public static string ComparisonLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.comparison", "Comparison");

    /// <summary>"Gas Price ($/gal)" field label (web <c>costAnalysis.calculator.gasPrice</c>).</summary>
    public static string GasPriceLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.gasPrice", "Gas Price ($/gal)");

    /// <summary>"Gas Car MPG" field label (web <c>costAnalysis.calculator.mpg</c>).</summary>
    public static string MpgLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.mpg", "Gas Car MPG");

    /// <summary>"Electricity Rate ($/kWh)" field label (web <c>costAnalysis.calculator.elecRate</c>).</summary>
    public static string ElectricityRateLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.elecRate", "Electricity Rate ($/kWh)");

    /// <summary>"Reset Defaults" button label (web <c>costAnalysis.calculator.reset</c>).</summary>
    public static string ResetLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.reset", "Reset Defaults");

    /// <summary>"Gas Cost (equivalent)" card label (web <c>costAnalysis.calculator.gasCost</c>).</summary>
    public static string GasCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.gasCost", "Gas Cost (equivalent)");

    /// <summary>"EV Cost (actual)" card label (web <c>costAnalysis.calculator.evCost</c>).</summary>
    public static string EvCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.evCost", "EV Cost (actual)");

    /// <summary>"Total Savings" card label (web <c>costAnalysis.calculator.totalSavings</c>).</summary>
    public static string TotalSavingsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.totalSavings", "Total Savings");

    /// <summary>"over selected period" caption (web <c>costAnalysis.calculator.overPeriod</c>).</summary>
    public static string OverPeriodLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.overPeriod", "over selected period");

    /// <summary>"Monthly Savings" card label (web <c>costAnalysis.calculator.monthlySavings</c>).</summary>
    public static string MonthlySavingsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.monthlySavings", "Monthly Savings");

    /// <summary>"/ year" caption (web <c>costAnalysis.calculator.perYear</c>).</summary>
    public static string PerYearLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.perYear", "/ year");

    /// <summary>"Not enough data for comparison" message (web <c>costAnalysis.calculator.noData</c>).</summary>
    public static string NoDataMessage(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.calculator.noData", "Not enough data for comparison");

    /// <summary>Whole-surface empty title (web page <c>costAnalysis.empty.title</c>).</summary>
    public static string EmptyTitle(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.empty.title", "No Charging Data");

    /// <summary>Whole-surface empty message (web page <c>costAnalysis.empty.message</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "translation.costAnalysis.empty.message",
            "Start charging your vehicle to see cost analysis and savings trends.");

    /// <summary>Loading announcement (shared <c>common.loading</c>).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.loading", "Loading...");

    /// <summary>Retry affordance label (shared <c>common.retry</c>).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.retry", "Retry");

    /// <summary>Refresh affordance label (shared <c>common.refresh</c>).</summary>
    public static string RefreshLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.refresh", "Refresh");

    /// <summary>Stale freshness chip label (shared <c>common.stale</c>).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.stale", "Stale");

    /// <summary>Offline freshness chip label (shared <c>common.offline</c>).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.offline", "Offline");

    /// <summary>Hard-error surface message (native-superset chrome).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("translation.costAnalysis.error", "Couldn't load your charging cost data");

    /// <summary>Offline surface message (native-superset chrome).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "translation.costAnalysis.offline",
            "You're offline - showing your last cached charging cost data");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the savings-calculator surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost figure, currency amount, VIN or
/// assumption value — so a diagnostics line can never leak account data. Thread-safe.
/// </summary>
public sealed class SavingsCalculatorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SavingsCalculatorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SavingsCalculator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SavingsCalculatorRegistration.Slug}");
    }
}
