using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargeCostTrackerViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargeCostTrackerWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData</c> gate (no charging
/// sessions inside the 30-day window) in addition to an empty HTTP body.
/// </summary>
public enum ChargeCostTrackerState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with sessions to summarise.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no in-window sessions — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The user's monetary + fuel display preferences the surface needs to price energy — the native
/// analogue of the web <c>useFormatting</c> inputs derived from <c>useSettings</c>
/// (web/src/hooks/useFormatting.ts): the per-kWh electricity rate, currency symbol, decimal precision,
/// and the gasoline-comparison inputs. The view-model owns one instance and re-projects when it changes.
/// </summary>
/// <param name="CostPerKwh">Electricity rate per kWh (web <c>settings.base_cost_per_kwh ?? 0.12</c>).</param>
/// <param name="CurrencySymbol">Currency symbol (web <c>settings.currency_symbol</c> or "$").</param>
/// <param name="DecimalPrecision">Default fraction digits (web <c>settings.decimal_precision</c> or 2).</param>
/// <param name="GasEfficiencyMpg">Gas vehicle efficiency in mpg (web <c>settings.gas_efficiency_mpg ?? 0</c>).</param>
/// <param name="GasPricePerUnit">Gasoline price per unit (web <c>settings.gas_price_per_unit ?? 0</c>).</param>
/// <param name="GasUnit">Whether the gas price is per gallon or per litre (web <c>settings.gas_unit</c>).</param>
public sealed record ChargeCostTrackerSettings(
    double CostPerKwh = ChargeCostTrackerSettings.DefaultCostPerKwh,
    string CurrencySymbol = "$",
    int DecimalPrecision = 2,
    double GasEfficiencyMpg = 0,
    double GasPricePerUnit = 0,
    ChargeCostTrackerGasUnit GasUnit = ChargeCostTrackerGasUnit.Gallon)
{
    /// <summary>Default electricity rate when settings carry none (web <c>?? 0.12</c>).</summary>
    public const double DefaultCostPerKwh = 0.12;

    /// <summary>The all-default preference bundle ($0.12/kWh, "$", 2 dp, no gas comparison).</summary>
    public static ChargeCostTrackerSettings Default { get; } = new();

    /// <summary>The currency symbol with the web's blank/whitespace → "$" fallback applied.</summary>
    public string ResolvedSymbol => string.IsNullOrWhiteSpace(CurrencySymbol) ? "$" : CurrencySymbol;

    /// <summary>The decimal precision floored at zero (web <c>Math.floor</c>, non-negative).</summary>
    public int ResolvedPrecision => DecimalPrecision < 0 ? 0 : DecimalPrecision;
}

/// <summary>The unit the gasoline price is quoted in (web <c>settings.gas_unit</c>).</summary>
public enum ChargeCostTrackerGasUnit
{
    /// <summary>Price per US gallon (the web default).</summary>
    Gallon,

    /// <summary>Price per litre — gallons are converted before applying the price.</summary>
    Liter,
}

/// <summary>
/// One charging session from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts). Only the three fields the web <c>computeMetrics</c> reads are projected:
/// the SI energy added, the optional recorded cost, and the start instant (used for the 30-day window).
/// Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="StartedAt">Session start (web <c>started_at</c>); null when absent/unparseable.</param>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
/// <param name="Cost">
/// The recorded session cost (web <c>s.cost</c>); null when absent, which routes to the kWh-rate
/// estimate. The wire field is <c>cost</c> exactly as the web component reads it — the API serialises
/// per-session cost under <c>cost_decimal</c>, so this is normally absent and the estimate path runs,
/// matching the web's observable totals (reproduced verbatim, never silently "fixed").
/// </param>
public sealed record ChargeCostTrackerSession(
    DateTimeOffset? StartedAt,
    double EnergyAddedWh,
    double? Cost)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<ChargeCostTrackerSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargeCostTrackerSession>();
        }

        var list = new List<ChargeCostTrackerSession>(element.GetArrayLength());
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
    public static ChargeCostTrackerSession FromJson(JsonElement obj) => new(
        StartedAt: GetTimestamp(obj, "started_at"),
        EnergyAddedWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
        Cost: GetDouble(obj, "cost"));

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

    private static DateTimeOffset? GetTimestamp(JsonElement obj, string name)
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> logic in
/// web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx.
/// </summary>
public readonly record struct ChargeCostTrackerSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargeCostTrackerSize Default => new(2, 2);

    /// <summary>True at a single 1×1 cell (web <c>isCompact</c>): show the big total-cost number.</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True at two or more rows (web <c>isTall</c>): add the cost-per-distance + gas-savings tiles.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// The aggregated 30-day cost figures — the native port of the web <c>CostMetrics</c> computed by
/// <c>computeMetrics</c>. <see cref="CostPerDistance"/> and <see cref="GasSavings"/> are nullable to
/// mirror the web's "—" / "configure gas price" branches.
/// </summary>
/// <param name="TotalKwh">Total energy added across the window in kWh.</param>
/// <param name="TotalCost">Total cost (recorded session cost, else kWh × rate).</param>
/// <param name="CostPerDistance">Cost per display-distance unit, or null when undefined.</param>
/// <param name="GasSavings">Estimated gasoline cost minus EV cost, or null when gas is unconfigured.</param>
/// <param name="SessionCount">Number of in-window sessions summed.</param>
/// <param name="TotalDistanceMi">Rough distance estimate (kWh × 3.5) the web reuses as the cost basis.</param>
public sealed record ChargeCostTrackerMetrics(
    double TotalKwh,
    double TotalCost,
    double? CostPerDistance,
    double? GasSavings,
    int SessionCount,
    double TotalDistanceMi)
{
    /// <summary>An all-zero, no-session snapshot — the projection basis before any data resolves.</summary>
    public static ChargeCostTrackerMetrics Empty { get; } = new(0, 0, null, null, 0, 0);

    /// <summary>True when at least one in-window session was summed (web <c>hasData</c>).</summary>
    public bool HasData => SessionCount > 0;
}

/// <summary>
/// One projected, display-ready metric tile (the native counterpart of the web <c>MetricCard</c>):
/// localized label, pre-formatted value, optional subtitle, the resolved Fluent glyph, the accent
/// brush token key, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted primary value.</param>
/// <param name="Subtitle">An optional pre-formatted caption line, or null.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon.</param>
/// <param name="AccentBrushKey">The design-token brush key tinting the icon.</param>
/// <param name="AutomationName">The Narrator name combining label, value and subtitle.</param>
public sealed record ChargeCostTrackerTile(
    string Label,
    string Value,
    string? Subtitle,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the charge-cost summary for one footprint — the native
/// analogue of everything the web component computes before returning JSX. Pure data so the projection
/// is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when there is at least one in-window session (web <c>hasData</c>).</param>
/// <param name="IsCompact">True at the 1×1 footprint (big-number layout).</param>
/// <param name="IsTall">True at two or more rows (the extra tile row is shown).</param>
/// <param name="CompactValue">The big total-cost value (0 decimals) for the compact layout.</param>
/// <param name="CompactLabel">The "30-day cost" caption for the compact layout.</param>
/// <param name="CompactAutomationName">The Narrator name for the compact big number.</param>
/// <param name="Energy">The Total Energy tile.</param>
/// <param name="Cost">The Total Cost tile.</param>
/// <param name="CostPerDistance">The cost-per-distance tile (only when <see cref="IsTall"/>).</param>
/// <param name="GasSavings">The vs-gas-savings tile (only when <see cref="IsTall"/>).</param>
/// <param name="FooterLeft">The non-tall footer's left cost-per-distance text.</param>
/// <param name="FooterRight">The non-tall footer's right savings text (may be empty).</param>
/// <param name="EmptyMessage">The localized empty-state message.</param>
public sealed record ChargeCostTrackerDisplay(
    bool HasData,
    bool IsCompact,
    bool IsTall,
    string CompactValue,
    string CompactLabel,
    string CompactAutomationName,
    ChargeCostTrackerTile Energy,
    ChargeCostTrackerTile Cost,
    ChargeCostTrackerTile? CostPerDistance,
    ChargeCostTrackerTile? GasSavings,
    string FooterLeft,
    string FooterRight,
    string EmptyMessage);

/// <summary>
/// Pure projection from raw charging sessions to the display model — the native port of the web
/// <c>computeMetrics</c> plus the <c>useFormatting</c> cost helpers and the JSX assembly in
/// web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx. SI energy/distance is converted to
/// the user's display unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class ChargeCostTrackerProjection
{
    /// <summary>Rough efficiency the web reuses to back-derive distance from energy (web <c>AVG_MI_PER_KWH</c>).</summary>
    public const double AvgMiPerKwh = 3.5;

    /// <summary>Litres per US gallon (web <c>FUEL.GALLONS_TO_LITERS</c>).</summary>
    public const double GallonsToLiters = 3.78541;

    /// <summary>The trailing window the web query scopes to (<c>start = 30 days ago</c>).</summary>
    public const int WindowDays = 30;

    /// <summary>The page size the web query caps at (<c>limit=100</c>).</summary>
    public const int MaxSessions = 100;

    private const string EmDash = "\u2014";

    private const string GlyphDollar = "\uE1D3";   // money (title + cost tile)
    private const string GlyphEnergy = "\uE945";   // lightning / energy
    private const string GlyphFuel = "\uE950";     // gauge (cost per distance)
    private const string GlyphSavings = "\uE896";  // downward arrow (gas savings)

    private const string AccentCyan = "TsColorInfoBrush";      // web "cyan"
    private const string AccentGreen = "TsColorSuccessBrush";  // web "green" / emerald
    private const string AccentAmber = "TsColorWarningBrush";  // web "amber"

    /// <summary>The header / empty-state glyph (web <c>DollarSign</c>).</summary>
    public const string HeaderGlyph = GlyphDollar;

    /// <summary>The accent brush tinting the header icon (web emerald).</summary>
    public const string HeaderAccentBrushKey = AccentGreen;

    /// <summary>
    /// Aggregate <paramref name="sessions"/> into the 30-day cost figures — the native port of the web
    /// <c>computeMetrics</c>. The 30-day window + 100-session cap (the web query's <c>start</c> +
    /// <c>limit</c>) are applied client-side relative to <paramref name="now"/> because the generated
    /// charging-sessions endpoint scopes by vehicle only.
    /// </summary>
    public static ChargeCostTrackerMetrics ComputeMetrics(
        IReadOnlyList<ChargeCostTrackerSession> sessions,
        ChargeCostTrackerSettings settings,
        UnitPref units,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);

        var windowed = WindowSessions(sessions, now);

        double totalKwh = 0;
        double totalCost = 0;
        foreach (var s in windowed)
        {
            double energy = UnitConverters.EnergyFromSi(s.EnergyAddedWh, EnergyUnit.Kwh);
            totalKwh += energy;

            // Web parity: prefer the recorded session cost, otherwise estimate from kWh × rate.
            totalCost += s.Cost is { } recorded ? recorded : energy * settings.CostPerKwh;
        }

        // Rough distance estimate (~3.5 mi/kWh). Web parity: this miles-magnitude value is then fed to
        // helpers whose parameter is SI metres, so convertDistanceFromSI treats it as metres. The quirk
        // is reproduced verbatim — see CostPerDistanceUnit / EstimateGasCost.
        double totalDistanceMi = totalKwh * AvgMiPerKwh;

        double? costPerDistance = CostPerDistanceUnit(totalKwh, totalDistanceMi, settings, units);
        double? gasCost = EstimateGasCost(totalDistanceMi, settings);
        double? gasSavings = gasCost is { } gas ? gas - totalCost : null;

        return new ChargeCostTrackerMetrics(
            totalKwh,
            totalCost,
            costPerDistance,
            gasSavings,
            windowed.Count,
            totalDistanceMi);
    }

    /// <summary>Project <paramref name="metrics"/> for <paramref name="size"/> using the user's units, rate and currency.</summary>
    public static ChargeCostTrackerDisplay Project(
        ChargeCostTrackerMetrics metrics,
        ChargeCostTrackerSettings settings,
        UnitPref units,
        ChargeCostTrackerSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string distanceUnitLabel = UnitLabels.Label(units.Distance);
        string kwhUnit = localizer.GetString("widget.chargeCost.kwh", "kWh");

        // Compact big-number total cost (web formatCurrency(totalCost, 0) + "30-day cost").
        string compactValue = FormatCurrency(metrics.TotalCost, settings, 0);
        string compactLabel = localizer.GetString("widget.chargeCost.monthly", "30-day cost");
        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}, {1}", compactValue, compactLabel);

        // Total Energy tile.
        string energyLabel = localizer.GetString("widget.chargeCost.totalEnergy", "Total Energy");
        string energyValue = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(metrics.TotalKwh, 1), kwhUnit);
        string energySubtitle = Fill(
            localizer.GetString("widget.chargeCost.sessions", "{{count}} sessions"),
            metrics.SessionCount.ToString(CultureInfo.InvariantCulture));
        var energyTile = Tile(energyLabel, energyValue, energySubtitle, GlyphEnergy, AccentCyan);

        // Total Cost tile.
        string costLabel = localizer.GetString("widget.chargeCost.totalCost", "Total Cost");
        string costValue = FormatCurrency(metrics.TotalCost, settings);
        string costSubtitle = string.Format(
            CultureInfo.CurrentCulture, "{0}/{1}", FormatCurrency(settings.CostPerKwh, settings), kwhUnit);
        var costTile = Tile(costLabel, costValue, costSubtitle, GlyphDollar, AccentGreen);

        // Cost-per-distance + gas-savings tiles (only rendered when tall).
        ChargeCostTrackerTile? costPerDistanceTile = null;
        ChargeCostTrackerTile? gasSavingsTile = null;
        if (size.IsTall)
        {
            string cpdLabel = Fill(
                localizer.GetString("widget.chargeCost.costPerDistance", "Cost / {{unit}}"), distanceUnitLabel);
            string cpdValue = metrics.CostPerDistance is { } cpd ? FormatCurrency(cpd, settings, 3) : EmDash;
            costPerDistanceTile = Tile(cpdLabel, cpdValue, null, GlyphFuel, AccentAmber);

            string gasLabel = localizer.GetString("widget.chargeCost.gasSavings", "vs Gas Savings");
            string gasValue = metrics.GasSavings is { } gs ? FormatCurrency(gs, settings) : EmDash;
            string gasSubtitle = metrics.GasSavings is not null
                ? localizer.GetString("widget.chargeCost.savingsNote", "30-day estimate")
                : localizer.GetString("widget.chargeCost.configureGas", "Set gas price in settings");
            gasSavingsTile = Tile(gasLabel, gasValue, gasSubtitle, GlyphSavings, AccentGreen);
        }

        // Non-tall footer line (web small two-column row).
        string footerLeft = metrics.CostPerDistance is { } cpdFooter
            ? string.Format(CultureInfo.CurrentCulture, "{0}/{1}", FormatCurrency(cpdFooter, settings, 3), distanceUnitLabel)
            : EmDash;
        string footerRight = metrics.GasSavings is { } gsFooter
            ? Fill(localizer.GetString("widget.chargeCost.saved", "Saved {{amount}} vs gas"), FormatCurrency(gsFooter, settings))
            : string.Empty;

        string emptyMessage = localizer.GetString("widget.chargeCost.noData", "No charge data");

        return new ChargeCostTrackerDisplay(
            HasData: metrics.HasData,
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            CompactValue: compactValue,
            CompactLabel: compactLabel,
            CompactAutomationName: compactAutomationName,
            Energy: energyTile,
            Cost: costTile,
            CostPerDistance: costPerDistanceTile,
            GasSavings: gasSavingsTile,
            FooterLeft: footerLeft,
            FooterRight: footerRight,
            EmptyMessage: emptyMessage);
    }

    /// <summary>
    /// Cost per the user's display-distance unit — the native port of <c>useFormatting.costPerDistanceUnit</c>.
    /// Web parity: <paramref name="distanceMValue"/> is the miles-magnitude estimate passed straight into
    /// the SI-metres parameter, so it is converted as though it were metres (the web's behaviour).
    /// </summary>
    public static double? CostPerDistanceUnit(
        double kwh, double distanceMValue, ChargeCostTrackerSettings settings, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);

        if (distanceMValue <= 0)
        {
            return null;
        }

        double cost = kwh * settings.CostPerKwh;
        double distance = UnitConverters.DistanceFromSi(distanceMValue, units.Distance);
        return distance > 0 ? cost / distance : null;
    }

    /// <summary>
    /// Estimated gasoline cost — the native port of <c>useFormatting.estimateGasCost</c>. Returns null
    /// when mpg, price or distance is non-positive. Web parity: <paramref name="distanceMValue"/> is the
    /// miles-magnitude estimate converted to miles as though it were metres.
    /// </summary>
    public static double? EstimateGasCost(double distanceMValue, ChargeCostTrackerSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        double mpg = settings.GasEfficiencyMpg;
        double gasPrice = settings.GasPricePerUnit;
        if (mpg <= 0 || gasPrice <= 0 || distanceMValue <= 0)
        {
            return null;
        }

        double distanceMi = UnitConverters.DistanceFromSi(distanceMValue, DistanceUnit.Mi);
        double gallonsUsed = distanceMi / mpg;
        return settings.GasUnit == ChargeCostTrackerGasUnit.Liter
            ? gallonsUsed * GallonsToLiters * gasPrice
            : gallonsUsed * gasPrice;
    }

    /// <summary>Format a currency amount — the native port of <c>useFormatting.formatCurrency</c>.</summary>
    public static string FormatCurrency(double amount, ChargeCostTrackerSettings settings, int? decimals = null)
    {
        ArgumentNullException.ThrowIfNull(settings);
        int d = decimals ?? settings.ResolvedPrecision;
        return ScalarFormatters.FormatCurrency(amount, settings.ResolvedSymbol, d < 0 ? 0 : d);
    }

    private static List<ChargeCostTrackerSession> WindowSessions(
        IReadOnlyList<ChargeCostTrackerSession> sessions, DateTimeOffset now)
    {
        var cutoff = now.AddDays(-WindowDays);
        var inWindow = new List<ChargeCostTrackerSession>(sessions.Count);
        foreach (var s in sessions)
        {
            // Web parity: the query's start= filter keeps sessions whose start is within the window.
            // A row without a parseable start is kept (the contract endpoint never omits started_at).
            if (s.StartedAt is not { } ts || ts >= cutoff)
            {
                inWindow.Add(s);
            }
        }

        if (inWindow.Count <= MaxSessions)
        {
            return inWindow;
        }

        // Web parity: limit=100 keeps the 100 most-recent sessions.
        inWindow.Sort(static (a, b) => Nullable.Compare(b.StartedAt, a.StartedAt));
        return inWindow.GetRange(0, MaxSessions);
    }

    private static ChargeCostTrackerTile Tile(
        string label, string value, string? subtitle, string glyph, string accentBrushKey) =>
        new(label, value, subtitle, glyph, accentBrushKey, AutomationName(label, value, subtitle));

    private static string AutomationName(string label, string value, string? subtitle) =>
        string.IsNullOrEmpty(subtitle)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, subtitle);

    // Substitute the one interpolation token a string carries, accepting both the catalog's {0} form and
    // the web fallbacks' {{count}}/{{unit}}/{{amount}} form so production and headless tests both resolve.
    private static string Fill(string template, string value) =>
        template
            .Replace("{0}", value, StringComparison.Ordinal)
            .Replace("{{count}}", value, StringComparison.Ordinal)
            .Replace("{{unit}}", value, StringComparison.Ordinal)
            .Replace("{{amount}}", value, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ChargeCostTrackerSession&gt;&gt;</c>, preserving every
/// freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
/// matrix. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargeCostTrackerResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ChargeCostTrackerSession> Parse() =>
            raw.HasValue ? ChargeCostTrackerSession.ParseList(raw.Value) : Array.Empty<ChargeCostTrackerSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
