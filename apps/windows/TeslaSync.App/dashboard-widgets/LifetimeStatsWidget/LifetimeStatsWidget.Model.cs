using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="LifetimeStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>LifetimeStatsWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web outer <c>{data ? … : &lt;EmptyState&gt;}</c>
/// gate (an absent response body / disabled-shaped read), not a value threshold — the lifetime endpoint
/// renders its grid for any populated object, even all-zero totals.
/// </summary>
public enum LifetimeStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with totals to show.</summary>
    Loaded,

    /// <summary>The response carried no object (null / empty body) — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The all-time lifetime rollup from <c>GET /analytics/lifetime</c> (web <c>useLifetimeStats</c>, shape
/// <c>LifetimeStats</c> in web/src/api/hooks/useAnalytics.ts). Only the fields the widget reads are
/// projected here; field names mirror the Go API's snake_case JSON tags
/// (<c>total_distance_km</c>, <c>total_drives</c>, <c>total_energy_kwh</c>, <c>co2_offset_kg</c>,
/// <c>total_charging_cost</c>, <c>ownership_days</c>). Parsing is null-tolerant so a partial body never
/// throws. Distance is kilometres — converted to the user's display unit only at projection time.
/// </summary>
public sealed record LifetimeStats(
    double TotalDistanceKm,
    long TotalDrives,
    double TotalEnergyKwh,
    double Co2OffsetKg,
    double TotalChargingCost,
    long OwnershipDays)
{
    /// <summary>An all-zero snapshot — the seed for the initial display and the parse fallback.</summary>
    public static LifetimeStats Empty { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>Project a <c>GET /analytics/lifetime</c> JSON object into a tolerant snapshot.</summary>
    public static LifetimeStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new LifetimeStats(
            TotalDistanceKm: GetDouble(element, "total_distance_km") ?? 0,
            TotalDrives: GetLong(element, "total_drives") ?? 0,
            TotalEnergyKwh: GetDouble(element, "total_energy_kwh") ?? 0,
            Co2OffsetKg: GetDouble(element, "co2_offset_kg") ?? 0,
            TotalChargingCost: GetDouble(element, "total_charging_cost") ?? 0,
            OwnershipDays: GetLong(element, "ownership_days") ?? 0);
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

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)Math.Round(d, MidpointRounding.AwayFromZero),
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx (<c>isCompact = cols &lt;= 1</c>,
/// <c>isWide = cols &gt;= 3</c>).
/// </summary>
public readonly record struct LifetimeStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static LifetimeStatsSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big animated distance number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): 4-up grid plus the extra totals.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>Stat-grid column count: 4 when wide, otherwise 2 (web <c>cols={isWide ? 4 : 2}</c>).</summary>
    public int GridColumns => IsWide ? 4 : 2;
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view. Holds the localized label, the
/// already-formatted value, the optional unit suffix, the resolved Fluent glyph, the categorical palette
/// index, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record LifetimeStatsStat(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the lifetime totals for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the stat tiles
/// (four core, plus three wide-only), and the compact big-number distance with its "{unit} lifetime"
/// caption. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record LifetimeStatsDisplay(
    bool IsCompact,
    bool IsWide,
    IReadOnlyList<LifetimeStatsStat> Stats,
    double CompactDistance,
    string CompactValue,
    string CompactLabel,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="LifetimeStats"/> to the display model — the native port of the
/// unit conversion + <c>coreStats</c> / <c>wideStats</c> <c>useMemo</c>s in
/// web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx. SI is converted to the user's display unit
/// here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class LifetimeStatsProjection
{
    /// <summary>Web Trophy → Segoe Fluent FavoriteStar (Segoe has no literal trophy glyph).</summary>
    public const string HeaderGlyph = "\uE735";

    private const string DistanceGlyph = "\uE9D2";  // web Route → trending-up (matches sibling distance glyph)
    private const string DrivesGlyph = "\uE804";    // web Car
    private const string EnergyGlyph = "\uE945";    // web Zap → lightning
    private const string Co2Glyph = "\uE909";       // web Leaf (CO₂) → World/globe (eco; no native leaf glyph)
    private const string CostGlyph = "\uE1D3";      // web DollarSign → money
    private const string OwnershipGlyph = "\uE787"; // web CalendarDays → Calendar

    private const string EnergyUnitLabel = "kWh";
    private const string Co2UnitLabel = "kg";

    /// <summary>
    /// Distance conversion DELIBERATELY diverges from the web source (covenant #9 — surfaced, not silent).
    /// The web widget feeds <c>total_distance_km * KM_TO_MI</c> (miles) into <c>convertDistanceFromSI</c>,
    /// which expects SI metres — a migration defect (the sibling AnalyticsSummaryWidget correctly uses
    /// <c>km * 1000</c>). The native port follows the documented SI contract and the accepted sibling so
    /// the headline distance is correct, not ~1609× too small. Logged in the gate artifact.
    /// </summary>
    public static LifetimeStatsDisplay Project(
        LifetimeStats data,
        LifetimeStatsSize size,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        double displayDistance = UnitConverters.DistanceFromSi(data.TotalDistanceKm * 1000.0, distanceUnit);
        double avgDailyDisplay = data.OwnershipDays > 0 ? displayDistance / data.OwnershipDays : 0;

        string distanceLabel = localizer.GetString("widget.lifetimeStats.totalDistance", "Total Distance");
        string drivesLabel = localizer.GetString("widget.lifetimeStats.totalDrives", "Total Drives");
        string energyLabel = localizer.GetString("widget.lifetimeStats.totalEnergy", "Total Energy");
        string co2Label = localizer.GetString("widget.lifetimeStats.co2Saved", "CO\u2082 Saved");
        string costLabel = localizer.GetString("widget.lifetimeStats.totalCost", "Total Cost");
        string ownershipLabel = localizer.GetString("widget.lifetimeStats.ownershipDays", "Ownership Days");
        string avgDailyLabel = localizer.GetString("widget.lifetimeStats.avgDailyDistance", "Avg Daily Distance");

        string distanceValue = ScalarFormatters.FormatNumber(displayDistance, 0);
        string drivesValue = ScalarFormatters.FormatNumber(data.TotalDrives, 0);
        string energyValue = ScalarFormatters.FormatNumber(data.TotalEnergyKwh, 1);
        string co2Value = ScalarFormatters.FormatNumber(data.Co2OffsetKg, 0);
        string costValue = ScalarFormatters.FormatCurrency(data.TotalChargingCost, symbol);
        string ownershipValue = ScalarFormatters.FormatNumber(data.OwnershipDays, 0);
        string avgDailyValue = ScalarFormatters.FormatNumber(avgDailyDisplay, 1);

        var stats = new List<LifetimeStatsStat>(7)
        {
            new(distanceLabel, distanceValue, distanceUnitLabel, DistanceGlyph, 0, StatAutomationName(distanceLabel, distanceValue, distanceUnitLabel)),
            new(drivesLabel, drivesValue, null, DrivesGlyph, 1, StatAutomationName(drivesLabel, drivesValue, null)),
            new(energyLabel, energyValue, EnergyUnitLabel, EnergyGlyph, 2, StatAutomationName(energyLabel, energyValue, EnergyUnitLabel)),
            new(co2Label, co2Value, Co2UnitLabel, Co2Glyph, 3, StatAutomationName(co2Label, co2Value, Co2UnitLabel)),
        };

        if (size.IsWide)
        {
            stats.Add(new(costLabel, costValue, null, CostGlyph, 4, StatAutomationName(costLabel, costValue, null)));
            stats.Add(new(ownershipLabel, ownershipValue, null, OwnershipGlyph, 5, StatAutomationName(ownershipLabel, ownershipValue, null)));
            stats.Add(new(avgDailyLabel, avgDailyValue, distanceUnitLabel, DistanceGlyph, 6, StatAutomationName(avgDailyLabel, avgDailyValue, distanceUnitLabel)));
        }

        double roundedDist = Math.Round(displayDistance, MidpointRounding.AwayFromZero);
        string compactValue = ScalarFormatters.FormatNumber(roundedDist, 0);
        string lifetimeWord = localizer.GetString("widget.lifetimeStats.lifetime", "lifetime");
        string compactLabel = string.Format(CultureInfo.CurrentCulture, "{0} {1}", distanceUnitLabel, lifetimeWord);
        string compactAutomationName = string.Format(CultureInfo.CurrentCulture, "{0} {1}", compactValue, compactLabel);

        return new LifetimeStatsDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            Stats: stats,
            CompactDistance: roundedDist,
            CompactValue: compactValue,
            CompactLabel: compactLabel,
            CompactAutomationName: compactAutomationName);
    }

    private static string StatAutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;LifetimeStats&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class LifetimeStatsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<LifetimeStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        LifetimeStats Parse() => raw.HasValue ? LifetimeStats.FromJson(raw.Value) : LifetimeStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<LifetimeStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<LifetimeStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<LifetimeStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<LifetimeStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<LifetimeStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<LifetimeStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<LifetimeStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
