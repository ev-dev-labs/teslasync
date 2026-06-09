using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="SavingsSlideViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/analytics/components/review/SavingsSlide.tsx) is a presentational slide that simply
/// receives a resolved <c>YearReview</c> as a prop; the native feature-view owns its own year-review read and
/// therefore renders the full state matrix the P2 contract mandates. Every branch maps onto a visible
/// surface — none is ever hidden. <see cref="Empty"/> mirrors a year with no review payload at all (rather
/// than an empty HTTP body).
/// </summary>
public enum SavingsSlideState
{
    /// <summary>Initial fetch with no cached snapshot — render the slide skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with a year-review payload to show.</summary>
    Loaded,

    /// <summary>The request resolved but carries no year-review payload — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The savings slice of <c>GET /analytics/year-review</c> the surface consumes — the two figures the web
/// <c>SavingsSlide</c> reads off its <c>data</c> prop (<c>gas_savings</c> and <c>total_charging_cost</c>).
/// Both are <c>safe()</c>-coerced at parse time (web <c>isFinite(v) ? v : 0</c>) so a missing / NaN / non-numeric
/// field renders as a literal zero exactly as the web does when the parent object is present. Parsing is
/// null-tolerant so a partial or schema-drifted body never throws. Both figures are plain monetary amounts in
/// the account currency and need no unit conversion.
/// </summary>
public sealed record SavingsSnapshot(double GasSavings, double TotalChargingCost, bool HasData)
{
    /// <summary>An all-absent snapshot — the parse fallback for an absent / non-object / non-review body.</summary>
    public static SavingsSnapshot Empty { get; } = new(0, 0, false);

    /// <summary>
    /// The equivalent cost of driving a gas car (web <c>gasCostEquiv = gas_savings + total_charging_cost</c>):
    /// the savings versus gas plus what the electricity actually cost.
    /// </summary>
    public double GasCostEquiv => GasSavings + TotalChargingCost;

    /// <summary>Project a <c>GET /analytics/year-review</c> JSON object into a tolerant savings snapshot.</summary>
    public static SavingsSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // A populated YearReview object always carries these keys; their presence is what gates the slide
        // (web renders whatever data prop it receives — even an all-zero year — and only the page above shows
        // the "no data" surface). An empty object is filtered to Empty by the source before it reaches here.
        bool isReview = element.TryGetProperty("gas_savings", out _)
            || element.TryGetProperty("total_charging_cost", out _)
            || element.TryGetProperty("year", out _);
        if (!isReview)
        {
            return Empty;
        }

        return new SavingsSnapshot(
            GasSavings: Safe(GetDouble(element, "gas_savings")),
            TotalChargingCost: Safe(GetDouble(element, "total_charging_cost")),
            HasData: true);
    }

    // web `safe`: a finite number passes through; everything else (null / NaN / ∞ / non-number) becomes 0.
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
/// The fully projected, render-ready view of the savings slide — every localized label, the formatted
/// monetary readouts, the count-up target, the electric-versus-gas bar fraction, the "cups of coffee" note
/// and the Narrator names. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="SavingsValue">The raw savings amount the hero number counts up to (web <c>data.gas_savings</c>).</param>
/// <param name="SavingsValueText">The hero savings formatted as currency (also the count-up's final frame).</param>
/// <param name="YouSavedLabel">Localized "You saved" eyebrow.</param>
/// <param name="VsGasLabel">Localized "vs. driving a gas car" caption.</param>
/// <param name="GasCostLabel">Localized "Gas would cost" bar label.</param>
/// <param name="GasCostValueText">The gas-equivalent cost formatted as currency.</param>
/// <param name="ElectricCostLabel">Localized "Electric cost" bar label.</param>
/// <param name="ElectricCostValueText">The electricity cost formatted as currency.</param>
/// <param name="ElectricFraction">The electric bar's clamped 0..1 fill versus the gas-equivalent cost.</param>
/// <param name="CupsOfCoffee">The whole number of $5 coffees the savings equate to (web <c>round(gas_savings / 5)</c>).</param>
/// <param name="SavingsNote">The localized, interpolated "That's N cups of coffee!" note.</param>
/// <param name="CurrencySymbol">The currency symbol the monetary readouts use.</param>
/// <param name="SavingsAutomationName">Narrator name for the hero savings number.</param>
/// <param name="GasBarAutomationName">Narrator name for the gas comparison bar.</param>
/// <param name="ElectricBarAutomationName">Narrator name for the electric comparison bar.</param>
/// <param name="SummaryAutomationName">Narrator name for the slide as a whole.</param>
public sealed record SavingsDisplay(
    double SavingsValue,
    string SavingsValueText,
    string YouSavedLabel,
    string VsGasLabel,
    string GasCostLabel,
    string GasCostValueText,
    string ElectricCostLabel,
    string ElectricCostValueText,
    double ElectricFraction,
    int CupsOfCoffee,
    string SavingsNote,
    string CurrencySymbol,
    string SavingsAutomationName,
    string GasBarAutomationName,
    string ElectricBarAutomationName,
    string SummaryAutomationName);

/// <summary>
/// Pure projection from a parsed <see cref="SavingsSnapshot"/> to the render-ready <see cref="SavingsDisplay"/>
/// — the native port of the layout maths + <c>t()</c> composition in
/// web/src/features/analytics/components/review/SavingsSlide.tsx. Every label resolves through the i18n
/// facade; the monetary figures are rounded and grouped exactly once here; the electric bar fraction is pure
/// ratio maths. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SavingsProjection
{
    /// <summary>Dollars per coffee the savings note divides by (web <c>gas_savings / 5</c>).</summary>
    public const double CupDivisor = 5.0;

    /// <summary>The default currency symbol when the host supplies none (web hardcodes "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>i18n key for the "You saved" eyebrow.</summary>
    public const string YouSavedKey = "translation.yearReview.youSaved";

    /// <summary>i18n key for the "vs. driving a gas car" caption.</summary>
    public const string VsGasKey = "translation.yearReview.vsGas";

    /// <summary>i18n key for the "Gas would cost" bar label.</summary>
    public const string GasCostKey = "translation.yearReview.gasCost";

    /// <summary>i18n key for the "Electric cost" bar label.</summary>
    public const string ElectricCostKey = "translation.yearReview.electricCost";

    /// <summary>i18n key for the interpolated "That's {0} cups of coffee!" note.</summary>
    public const string SavingsNoteKey = "translation.yearReview.savingsNote";

    /// <summary>Project <paramref name="data"/> into the render-ready savings display.</summary>
    public static SavingsDisplay Project(SavingsSnapshot data, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrEmpty(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;

        double savings = data.GasSavings;
        double gasCostEquiv = data.GasCostEquiv;
        double electricCost = data.TotalChargingCost;
        double fraction = gasCostEquiv > 0 ? Math.Clamp(electricCost / gasCostEquiv, 0.0, 1.0) : 0.0;
        int cups = (int)Math.Round(savings / CupDivisor, MidpointRounding.AwayFromZero);

        string youSaved = localizer.GetString(YouSavedKey, "You saved");
        string vsGas = localizer.GetString(VsGasKey, "vs. driving a gas car");
        string gasCostLabel = localizer.GetString(GasCostKey, "Gas would cost");
        string electricCostLabel = localizer.GetString(ElectricCostKey, "Electric cost");
        string noteTemplate = localizer.GetString(SavingsNoteKey, "That's {0} cups of coffee!");

        string savingsValueText = Currency(savings, symbol);
        string gasCostValueText = Currency(gasCostEquiv, symbol);
        string electricCostValueText = Currency(electricCost, symbol);
        string note = string.Format(CultureInfo.CurrentCulture, noteTemplate, cups);

        string savingsAria = string.Format(CultureInfo.CurrentCulture, "{0} {1}", youSaved, savingsValueText);
        string gasAria = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", gasCostLabel, gasCostValueText);
        string electricAria = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", electricCostLabel, electricCostValueText);
        string summaryAria = string.Format(CultureInfo.CurrentCulture, "{0} {1} {2}", youSaved, savingsValueText, vsGas);

        return new SavingsDisplay(
            SavingsValue: savings,
            SavingsValueText: savingsValueText,
            YouSavedLabel: youSaved,
            VsGasLabel: vsGas,
            GasCostLabel: gasCostLabel,
            GasCostValueText: gasCostValueText,
            ElectricCostLabel: electricCostLabel,
            ElectricCostValueText: electricCostValueText,
            ElectricFraction: fraction,
            CupsOfCoffee: cups,
            SavingsNote: note,
            CurrencySymbol: symbol,
            SavingsAutomationName: savingsAria,
            GasBarAutomationName: gasAria,
            ElectricBarAutomationName: electricAria,
            SummaryAutomationName: summaryAria);
    }

    // web `$${Math.round(x)}`: the figure is rounded to whole units (away-from-zero, matching JS Math.round for
    // the non-negative monetary amounts) then rendered with the symbol and en-US grouping.
    private static string Currency(double value, string symbol) =>
        ScalarFormatters.FormatCurrency(Math.Round(value, MidpointRounding.AwayFromZero), symbol, 0);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;SavingsSnapshot&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class SavingsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<SavingsSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SavingsSnapshot Parse() =>
            raw.HasValue ? SavingsSnapshot.FromJson(raw.Value) : SavingsSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SavingsSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<SavingsSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<SavingsSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<SavingsSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<SavingsSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<SavingsSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<SavingsSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Savings slide — the native mirror of the web component
/// (web/src/features/analytics/components/review/SavingsSlide.tsx, rendered inside the Year-in-Review story).
/// Centralises the stable id, category and diagnostics slug so the view and view-model stay free of literal
/// identifiers.
/// </summary>
public static class SavingsSlideRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "savings-slide";

    /// <summary>Surface category (matches the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SavingsSlide";
}

/// <summary>
/// PII-safe diagnostics for the Savings slide (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a savings figure, currency amount, VIN or year — so
/// a diagnostics line can never leak account data. Thread-safe.
/// </summary>
public sealed class SavingsSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SavingsSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SavingsSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SavingsSlideRegistration.Slug}");
    }
}
