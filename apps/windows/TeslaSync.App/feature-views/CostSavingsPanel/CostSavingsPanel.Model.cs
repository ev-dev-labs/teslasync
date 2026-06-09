using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="CostSavingsPanelViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx) is a presentational child of the
/// Drive-Detail page that receives a resolved <c>drive</c> + computed <c>stats</c> as props; the native
/// feature-view owns its own drive read and therefore renders the full state matrix the P2 contract mandates.
/// Every branch maps onto a visible surface — none is ever hidden. <see cref="Empty"/> mirrors a drive id that
/// resolves to no usable drive payload (rather than an empty HTTP body).
/// </summary>
public enum CostSavingsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with a drive to price.</summary>
    Loaded,

    /// <summary>The request resolved but carries no usable drive payload — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>The unit the gasoline price is quoted in (web <c>settings.gas_unit</c>).</summary>
public enum CostSavingsGasUnit
{
    /// <summary>Price per US gallon (the web default).</summary>
    Gallon,

    /// <summary>Price per litre — gallons are converted before applying the price.</summary>
    Liter,
}

/// <summary>
/// The user's monetary + fuel display preferences the surface needs to price energy — the native analogue of
/// the web <c>useFormatting</c> inputs derived from <c>useSettings</c> (web/src/hooks/useFormatting.ts): the
/// per-kWh electricity rate, currency symbol, decimal precision, and the gasoline-comparison inputs. The
/// view-model owns one instance and re-projects when it changes.
/// </summary>
/// <param name="CostPerKwh">Electricity rate per kWh (web <c>settings.base_cost_per_kwh ?? 0.12</c>).</param>
/// <param name="CurrencySymbol">Currency symbol (web <c>settings.currency_symbol</c> or "$").</param>
/// <param name="DecimalPrecision">Default fraction digits (web <c>settings.decimal_precision</c> or 2).</param>
/// <param name="GasEfficiencyMpg">Gas vehicle efficiency in mpg (web <c>settings.gas_efficiency_mpg ?? 0</c>).</param>
/// <param name="GasPricePerUnit">Gasoline price per unit (web <c>settings.gas_price_per_unit ?? 0</c>).</param>
/// <param name="GasUnit">Whether the gas price is per gallon or per litre (web <c>settings.gas_unit</c>).</param>
public sealed record CostSavingsSettings(
    double CostPerKwh = CostSavingsSettings.DefaultCostPerKwh,
    string CurrencySymbol = "$",
    int DecimalPrecision = 2,
    double GasEfficiencyMpg = 0,
    double GasPricePerUnit = 0,
    CostSavingsGasUnit GasUnit = CostSavingsGasUnit.Gallon)
{
    /// <summary>Default electricity rate when settings carry none (web <c>?? 0.12</c>).</summary>
    public const double DefaultCostPerKwh = 0.12;

    /// <summary>The all-default preference bundle ($0.12/kWh, "$", 2 dp, no gas comparison).</summary>
    public static CostSavingsSettings Default { get; } = new();

    /// <summary>The currency symbol with the web's blank/whitespace → "$" fallback applied.</summary>
    public string ResolvedSymbol => string.IsNullOrWhiteSpace(CurrencySymbol) ? "$" : CurrencySymbol;

    /// <summary>The decimal precision floored at zero (web <c>Math.floor</c>, non-negative).</summary>
    public int ResolvedPrecision => DecimalPrecision < 0 ? 0 : DecimalPrecision;
}

/// <summary>
/// The slice of <c>GET /drives/{driveID}</c> the surface consumes — the two figures the web
/// <c>CostSavingsPanel</c> reads off its props (<c>drive.distanceM</c> and the parent-computed
/// <c>stats.energyWh</c>), plus the inputs needed to reproduce the parent's <c>energyWh</c> derivation
/// (web useDriveDetailData.ts). The web drive endpoint returns a <c>DriveDetail</c> (the <c>Drive</c> aggregate
/// plus an embedded <c>telemetry</c> array), so the snapshot keeps the SI distance, duration, the optional
/// aggregate energy/power, and the per-row power series used by the telemetry fallback. Parsing is
/// null-tolerant so a partial or schema-drifted body never throws. All quantities are SI (metres, seconds,
/// watt-hours, watts).
/// </summary>
/// <param name="HasData">True when the payload is a real drive object (web parity: the parent only renders the panel for a resolved drive).</param>
/// <param name="DistanceM">Distance travelled in metres (web <c>drive.distanceM</c>, SI canonical).</param>
/// <param name="DurationS">Drive duration in seconds (web <c>drive.durationS</c>, SI canonical).</param>
/// <param name="EnergyUsedWh">Aggregate energy used in watt-hours (web <c>drive.energyUsedWh</c>); null routes to the power×duration fallback.</param>
/// <param name="AvgPowerW">Aggregate average power in watts (web <c>drive.avgPowerW</c>); null routes to the telemetry-average fallback.</param>
/// <param name="RowPowersKw">Per-row power in kilowatts (web <c>chartData[i].power</c>, telemetry preferred over positions); only used when both aggregates are absent.</param>
public sealed record DriveCostSnapshot(
    bool HasData,
    double DistanceM,
    double DurationS,
    double? EnergyUsedWh,
    double? AvgPowerW,
    IReadOnlyList<double> RowPowersKw)
{
    /// <summary>An all-absent snapshot — the parse fallback for an absent / non-object / non-drive body.</summary>
    public static DriveCostSnapshot Empty { get; } = new(false, 0, 0, null, null, Array.Empty<double>());

    /// <summary>
    /// Energy used in watt-hours — the native port of the parent hook's <c>energyWh</c> derivation
    /// (web useDriveDetailData.ts): the aggregate <c>energy_used_wh</c> when present, otherwise the absolute
    /// average power (kW) times the drive's duration (h) scaled to Wh. Average power prefers the aggregate
    /// <c>avg_power_w</c>, falling back to the mean of the per-row telemetry power series, then zero.
    /// </summary>
    public double EnergyWh
    {
        get
        {
            if (EnergyUsedWh is { } aggregate)
            {
                return aggregate;
            }

            double durationH = DurationS / 3600.0;
            double avgPowerKw = AvgPowerW is { } watts
                ? watts / 1000.0
                : RowPowersKw.Count > 0 ? Average(RowPowersKw) : 0.0;
            return Math.Abs(avgPowerKw) * durationH * 1000.0;
        }
    }

    /// <summary>Project a <c>GET /drives/{driveID}</c> JSON object into a tolerant cost snapshot.</summary>
    public static DriveCostSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // A populated Drive always carries an id and SI distance/duration; their presence is what gates the
        // panel (web renders the panel for any resolved drive — even a zero-energy one).
        bool isDrive = element.TryGetProperty("id", out _)
            || element.TryGetProperty("distance_m", out _)
            || element.TryGetProperty("duration_s", out _);
        if (!isDrive)
        {
            return Empty;
        }

        return new DriveCostSnapshot(
            HasData: true,
            DistanceM: GetDouble(element, "distance_m") ?? 0.0,
            DurationS: GetDouble(element, "duration_s") ?? 0.0,
            EnergyUsedWh: GetDouble(element, "energy_used_wh"),
            AvgPowerW: GetDouble(element, "avg_power_w"),
            RowPowersKw: ReadRowPowers(element));
    }

    // Web parity: chartData is built from `telemetry` when present, else `positions`; each row's power is
    // `power ?? 0`. The mean is taken over every row (including the zero-filled ones), so the row series keeps
    // a 0 for any row whose power is absent.
    private static IReadOnlyList<double> ReadRowPowers(JsonElement drive)
    {
        if (TryGetNonEmptyArray(drive, "telemetry", out var telemetry))
        {
            return MapPowers(telemetry);
        }

        if (TryGetNonEmptyArray(drive, "positions", out var positions))
        {
            return MapPowers(positions);
        }

        return Array.Empty<double>();
    }

    private static List<double> MapPowers(JsonElement array)
    {
        var powers = new List<double>(array.GetArrayLength());
        foreach (var row in array.EnumerateArray())
        {
            powers.Add(row.ValueKind == JsonValueKind.Object ? GetDouble(row, "power") ?? 0.0 : 0.0);
        }

        return powers;
    }

    private static bool TryGetNonEmptyArray(JsonElement element, string name, out JsonElement array)
    {
        if (element.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.Array &&
            value.GetArrayLength() > 0)
        {
            array = value;
            return true;
        }

        array = default;
        return false;
    }

    private static double Average(IReadOnlyList<double> values)
    {
        double sum = 0.0;
        for (int i = 0; i < values.Count; i++)
        {
            sum += values[i];
        }

        return sum / values.Count;
    }

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
/// One render-ready cost tile (web small centred column): a localized label, the formatted monetary/percentage
/// readout, an optional caption beneath it, the accent brush key tinting the value, and the Narrator name. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Label">The localized tile label (web <c>text-[10px]</c> caption).</param>
/// <param name="ValueText">The formatted headline value (web <c>text-lg font-bold</c>).</param>
/// <param name="Subtitle">The optional localized caption beneath the value (web <c>text-[9px]</c>), or null.</param>
/// <param name="ValueBrushKey">The design-token brush key tinting the value (web text-green/cyan/red/emerald-400).</param>
/// <param name="AutomationName">The Narrator name spoken for the tile.</param>
public sealed record CostSavingsTile(
    string Label,
    string ValueText,
    string? Subtitle,
    string ValueBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the cost-and-savings panel — the localized header title, the
/// always-present Trip-Cost tile, and the conditional Cost-per-distance / Gas-cost / Gas-savings / Savings-%
/// tiles, plus the empty-state message and the surface Narrator name. The web component conditionally renders
/// the distance tile (<c>drive.distanceM &gt; 0</c>) and the gas trio (<c>savings != null &amp;&amp; savings &gt; 0</c>);
/// those branches are reproduced by leaving the corresponding tiles null. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a drive is being priced (loaded / stale / offline content states).</param>
/// <param name="Title">The localized panel header ("Cost &amp; Savings").</param>
/// <param name="TripCost">The always-present Trip-Cost tile (null only in the empty state).</param>
/// <param name="CostPerDistance">The Cost-per-distance tile, or null when <c>distanceM &lt;= 0</c>.</param>
/// <param name="GasCostEquiv">The equivalent-gas-cost tile, or null when there is no positive saving.</param>
/// <param name="GasSavings">The vs-gas-savings tile, or null when there is no positive saving.</param>
/// <param name="SavingsPct">The savings-percentage tile, or null when there is no positive saving.</param>
/// <param name="EmptyMessage">The localized empty-state message (never a blank box).</param>
/// <param name="AriaLabel">The Narrator name summarising the surface.</param>
public sealed record CostSavingsDisplay(
    bool HasData,
    string Title,
    CostSavingsTile? TripCost,
    CostSavingsTile? CostPerDistance,
    CostSavingsTile? GasCostEquiv,
    CostSavingsTile? GasSavings,
    CostSavingsTile? SavingsPct,
    string EmptyMessage,
    string AriaLabel)
{
    /// <summary>The visible tiles, in web render order, with the conditional ones omitted when absent.</summary>
    public IReadOnlyList<CostSavingsTile> Tiles
    {
        get
        {
            var tiles = new List<CostSavingsTile>(5);
            if (TripCost is { } trip)
            {
                tiles.Add(trip);
            }

            if (CostPerDistance is { } cpd)
            {
                tiles.Add(cpd);
            }

            if (GasCostEquiv is { } gas)
            {
                tiles.Add(gas);
            }

            if (GasSavings is { } savings)
            {
                tiles.Add(savings);
            }

            if (SavingsPct is { } pct)
            {
                tiles.Add(pct);
            }

            return tiles;
        }
    }

    /// <summary>The render-ready empty display (no drive priced) for the surface's initial / empty state.</summary>
    public static CostSavingsDisplay Empty(ILocalizer localizer) =>
        CostSavingsProjection.Project(DriveCostSnapshot.Empty, CostSavingsSettings.Default, UnitPref.Metric, localizer);
}

/// <summary>
/// Pure projection from a parsed <see cref="DriveCostSnapshot"/> to the render-ready
/// <see cref="CostSavingsDisplay"/> — the native port of the cost maths + <c>t()</c> composition in
/// web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx and the <c>useFormatting</c> helpers it
/// calls (web/src/hooks/useFormatting.ts). Every label resolves through the i18n facade; the monetary figures
/// are grouped/rounded exactly once here; SI distance is converted to the user's display unit only here. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class CostSavingsProjection
{
    /// <summary>Litres per US gallon (web <c>FUEL.GALLONS_TO_LITERS</c>).</summary>
    public const double GallonsToLiters = 3.78541;

    /// <summary>Fraction digits for the cost-per-distance readout (web <c>formatCurrency(_, 3)</c>).</summary>
    public const int CostPerDistancePrecision = 3;

    /// <summary>The design-token brush key for the green money figures (web text-green-400 / text-emerald-400).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>The design-token brush key for the cyan cost-per-distance figure (web text-cyan-400).</summary>
    public const string InfoBrushKey = "TsColorInfoBrush";

    /// <summary>The design-token brush key for the red gas-cost figure (web text-red-400).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    private const string TitleKey = "driveDetail.costSavings";
    private const string TripCostKey = "driveDetail.tripCost";
    private const string AtRateKey = "driveDetail.atRate";
    private const string CostPerUnitKey = "driveDetail.costPerUnit";
    private const string GasCostEquivKey = "driveDetail.gasCostEquiv";
    private const string AtMpgKey = "driveDetail.atMpg";
    private const string GasSavingsKey = "driveDetail.gasSavings";
    private const string SavingsPctKey = "driveDetail.savingsPct";
    private const string EmptyKey = "driveDetail.costSavings.empty";

    private const string TitleFallback = "Cost & Savings";
    private const string EmptyFallback = "No cost data for this drive";

    /// <summary>Project <paramref name="snapshot"/> into the render-ready cost-and-savings display.</summary>
    public static CostSavingsDisplay Project(
        DriveCostSnapshot snapshot,
        CostSavingsSettings settings,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);

        if (!snapshot.HasData)
        {
            string emptyAria = string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, emptyMessage);
            return new CostSavingsDisplay(false, title, null, null, null, null, null, emptyMessage, emptyAria);
        }

        double costPerKwh = settings.CostPerKwh;
        double energyKwh = snapshot.EnergyWh / 1000.0;
        double evCost = energyKwh * costPerKwh;
        double? gasCost = EstimateGasCost(snapshot.DistanceM, settings);
        double? savings = gasCost is { } gas ? gas - evCost : null;

        string symbol = settings.ResolvedSymbol;
        int precision = settings.ResolvedPrecision;
        string distanceUnitLabel = UnitLabels.Label(units.Distance);

        // Trip Cost — always rendered (web formatEnergyCost(stats.energyWh / 1000)).
        string tripLabel = localizer.GetString(TripCostKey, "Trip Cost");
        string tripValue = FormatCurrency(evCost, settings, precision);
        string rateTemplate = localizer.GetString(AtRateKey, "at {{currencySymbol}}{{costPerKwh}}/kWh");
        string tripSubtitle = Fill(Fill(rateTemplate, "currencySymbol", symbol), "costPerKwh", Plain(costPerKwh));
        var tripCost = Tile(tripLabel, tripValue, tripSubtitle, SuccessBrushKey);

        // Cost / unit — only when the drive covered distance (web `drive.distanceM > 0`).
        CostSavingsTile? costPerDistance = null;
        if (snapshot.DistanceM > 0)
        {
            string cpuTemplate = localizer.GetString(CostPerUnitKey, "Cost / {{unit}}");
            string cpuLabel = Fill(cpuTemplate, "unit", distanceUnitLabel);
            double cpuValue = CostPerDistanceUnit(energyKwh, snapshot.DistanceM, settings, units) ?? 0.0;
            string cpuText = FormatCurrency(cpuValue, settings, CostPerDistancePrecision);
            costPerDistance = Tile(cpuLabel, cpuText, null, InfoBrushKey);
        }

        // Gas comparison trio — only when there is a positive saving (web `savings != null && savings > 0`).
        CostSavingsTile? gasCostEquiv = null;
        CostSavingsTile? gasSavings = null;
        CostSavingsTile? savingsPct = null;
        if (savings is { } sv && sv > 0 && gasCost is { } gasValue)
        {
            string gasLabel = localizer.GetString(GasCostEquivKey, "Gas Cost (equiv)");
            string gasValueText = FormatCurrency(gasValue, settings, precision);
            string mpgTemplate = localizer.GetString(AtMpgKey, "at {{mpg}} MPG");
            string gasSubtitle = Fill(mpgTemplate, "mpg", Plain(settings.GasEfficiencyMpg));
            gasCostEquiv = Tile(gasLabel, gasValueText, gasSubtitle, DangerBrushKey);

            string savingsLabel = localizer.GetString(GasSavingsKey, "vs Gas Savings");
            string savingsValueText = FormatCurrency(sv, settings, precision);
            gasSavings = Tile(savingsLabel, savingsValueText, null, SuccessBrushKey);

            string pctLabel = localizer.GetString(SavingsPctKey, "Savings %");
            string pctValue = ScalarFormatters.FormatPercentage(sv / gasValue * 100.0, 0);
            savingsPct = Tile(pctLabel, pctValue, null, SuccessBrushKey);
        }

        string aria = BuildAriaLabel(title, tripCost, gasSavings);

        return new CostSavingsDisplay(
            HasData: true,
            Title: title,
            TripCost: tripCost,
            CostPerDistance: costPerDistance,
            GasCostEquiv: gasCostEquiv,
            GasSavings: gasSavings,
            SavingsPct: savingsPct,
            EmptyMessage: emptyMessage,
            AriaLabel: aria);
    }

    /// <summary>
    /// Cost per the user's display-distance unit — the native port of <c>useFormatting.costPerDistanceUnit</c>.
    /// Returns null when the SI distance is non-positive or converts to zero.
    /// </summary>
    public static double? CostPerDistanceUnit(double kwh, double distanceM, CostSavingsSettings settings, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);

        if (distanceM <= 0)
        {
            return null;
        }

        double cost = kwh * settings.CostPerKwh;
        double distance = UnitConverters.DistanceFromSi(distanceM, units.Distance);
        return distance > 0 ? cost / distance : null;
    }

    /// <summary>
    /// Estimated gasoline cost — the native port of <c>useFormatting.estimateGasCost</c>. Returns null when
    /// mpg, price or distance is non-positive. The SI distance is converted to miles before applying the
    /// miles-based mpg, exactly as the web does.
    /// </summary>
    public static double? EstimateGasCost(double distanceM, CostSavingsSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        double mpg = settings.GasEfficiencyMpg;
        double gasPrice = settings.GasPricePerUnit;
        if (mpg <= 0 || gasPrice <= 0 || distanceM <= 0)
        {
            return null;
        }

        double distanceMi = UnitConverters.DistanceFromSi(distanceM, DistanceUnit.Mi);
        double gallonsUsed = distanceMi / mpg;
        return settings.GasUnit == CostSavingsGasUnit.Liter
            ? gallonsUsed * GallonsToLiters * gasPrice
            : gallonsUsed * gasPrice;
    }

    /// <summary>Format a currency amount — the native port of <c>useFormatting.formatCurrency</c>.</summary>
    public static string FormatCurrency(double amount, CostSavingsSettings settings, int? decimals = null)
    {
        ArgumentNullException.ThrowIfNull(settings);
        int d = decimals ?? settings.ResolvedPrecision;
        return ScalarFormatters.FormatCurrency(amount, settings.ResolvedSymbol, d < 0 ? 0 : d);
    }

    private static CostSavingsTile Tile(string label, string value, string? subtitle, string brushKey) =>
        new(label, value, subtitle, brushKey, AutomationName(label, value, subtitle));

    private static string AutomationName(string label, string value, string? subtitle) =>
        string.IsNullOrEmpty(subtitle)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, subtitle);

    private static string BuildAriaLabel(string title, CostSavingsTile tripCost, CostSavingsTile? gasSavings) =>
        gasSavings is { } savings
            ? string.Format(CultureInfo.CurrentCulture, "{0}. {1}. {2}", title, tripCost.AutomationName, savings.AutomationName)
            : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, tripCost.AutomationName);

    // Substitute one named interpolation token (web i18next `{{name}}` slots).
    private static string Fill(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);

    // Web i18next interpolates the raw JS number (String(value)); the shortest round-trip invariant form
    // matches that for the rate/mpg magnitudes (0.12, 30, 25.5, ...).
    private static string Plain(double value) => value.ToString(CultureInfo.InvariantCulture);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DriveCostSnapshot&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class CostSavingsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<DriveCostSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DriveCostSnapshot Parse() =>
            raw.HasValue ? DriveCostSnapshot.FromJson(raw.Value) : DriveCostSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DriveCostSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DriveCostSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DriveCostSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DriveCostSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DriveCostSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DriveCostSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DriveCostSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Cost-and-Savings panel — the native mirror of the web component
/// (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx, rendered inside the Drive-Detail
/// page). Centralises the stable id, category and diagnostics slug so the view and view-model stay free of
/// literal identifiers.
/// </summary>
public static class CostSavingsPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "cost-savings-panel";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "CostSavingsPanel";

    /// <summary>Localized display name (web header "Cost &amp; Savings").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.costSavings", "Cost & Savings");
    }
}

/// <summary>
/// PII-safe diagnostics for the Cost-and-Savings panel (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, energy figure, currency amount,
/// VIN or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CostSavingsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostSavingsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostSavingsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostSavingsPanelRegistration.Slug}");
    }
}
