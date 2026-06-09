using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="EnergyStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>EnergyStatsWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData = !!data</c>
/// gate (the energy summary response is absent) — the friendly "No energy data available" empty state —
/// distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum EnergyStatsState
{
    /// <summary>Initial fetch with no cached summary — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) energy summary — render the big number / chart + stats.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or the summary response was absent — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached summary exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached summary older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached summary remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One day of the energy summary's daily breakdown (web <c>DailyEnergy</c> in web/src/types/energy.ts). Only
/// the two fields the web <c>EnergyStatsWidget</c> plots are kept: the calendar <see cref="Date"/> bucket and
/// the SI energy in watt-hours (<c>energy_wh ?? 0</c>). Field names mirror the Go API's snake_case JSON tags.
/// </summary>
/// <param name="Date">Raw <c>date</c> bucket string (the chart X value), or the empty string.</param>
/// <param name="EnergyWh">Daily energy used in watt-hours (web <c>energy_wh ?? 0</c>).</param>
public sealed record EnergyStatsDailyEntry(string Date, double EnergyWh);

/// <summary>
/// The parsed energy summary (web <c>EnergyStats</c> in web/src/types/energy.ts), holding the SI totals the
/// web <c>EnergyStatsWidget</c> reads: total energy used / charged (Wh), the lifetime <c>total_wh</c> (Wh)
/// powering the compact big number, the total cost, the average efficiency (Wh per meter) and the CO₂ saved
/// (kg), plus the daily breakdown for the area chart. Parsing is null-tolerant — every numeric field defaults
/// to 0 exactly as the web's <c>?? 0</c> guards do — so a partial row never throws.
/// </summary>
/// <param name="TotalEnergyUsedWh">Total energy used in watt-hours (web <c>total_energy_used_wh ?? 0</c>).</param>
/// <param name="TotalEnergyChargedWh">Total energy charged in watt-hours (web <c>total_energy_charged_wh ?? 0</c>).</param>
/// <param name="TotalWh">Lifetime energy in watt-hours powering the compact number (web <c>total_wh ?? 0</c>).</param>
/// <param name="TotalCost">Total cost in the user's currency (web <c>total_cost ?? 0</c>).</param>
/// <param name="AvgEfficiencyWhPerM">Average efficiency in watt-hours per meter (web <c>avg_efficiency_wh_per_m ?? 0</c>).</param>
/// <param name="Co2SavedKg">CO₂ saved in kilograms (web <c>co2_saved_kg ?? 0</c>).</param>
/// <param name="DailyBreakdown">Per-day energy breakdown for the area chart (web <c>daily_breakdown ?? []</c>).</param>
public sealed record EnergyStatsData(
    double TotalEnergyUsedWh,
    double TotalEnergyChargedWh,
    double TotalWh,
    double TotalCost,
    double AvgEfficiencyWhPerM,
    double Co2SavedKg,
    IReadOnlyList<EnergyStatsDailyEntry> DailyBreakdown)
{
    /// <summary>A zero summary with no daily breakdown (mapper fallback for a malformed object body).</summary>
    public static EnergyStatsData Empty { get; } = new(0, 0, 0, 0, 0, 0, Array.Empty<EnergyStatsDailyEntry>());

    /// <summary>
    /// Parse the energy summary JSON object into a tolerant model, or null when the body is not an object
    /// (web <c>!data</c> → the empty surface). Mirrors the snake_case wire shape.
    /// </summary>
    public static EnergyStatsData? FromResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new EnergyStatsData(
            GetDouble(element, "total_energy_used_wh") ?? 0,
            GetDouble(element, "total_energy_charged_wh") ?? 0,
            GetDouble(element, "total_wh") ?? 0,
            GetDouble(element, "total_cost") ?? 0,
            GetDouble(element, "avg_efficiency_wh_per_m") ?? 0,
            GetDouble(element, "co2_saved_kg") ?? 0,
            ParseDaily(element));
    }

    private static IReadOnlyList<EnergyStatsDailyEntry> ParseDaily(JsonElement element)
    {
        if (!element.TryGetProperty("daily_breakdown", out var array) || array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EnergyStatsDailyEntry>();
        }

        var list = new List<EnergyStatsDailyEntry>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new EnergyStatsDailyEntry(
                GetString(item, "date") ?? string.Empty,
                GetDouble(item, "energy_wh") ?? 0));
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> / <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/EnergyStatsWidget.tsx.
/// </summary>
public readonly record struct EnergyStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static EnergyStatsSize Default => new(2, 4);

    /// <summary>True at one column (web <c>isCompact = size.cols &lt;= 1</c>): show the compact big number only.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three+ columns (web <c>isWide = size.cols &gt;= 3</c>): add Total Cost + Net Energy in a 3-up grid.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready stat from the summary grid — the native analogue of a web
/// <c>StatGridItem</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/> (already
/// carrying its own unit for the energy stats, e.g. "42.5 kWh"), the optional <see cref="Unit"/> suffix (the
/// efficiency unit, "kg", or the currency symbol) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record EnergyStatsStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// One projected daily energy point — the native analogue of a web <c>chartData</c> entry. Holds the raw
/// <see cref="Date"/> bucket (the web chart's X value), a tolerant axis <see cref="Label"/> ("MMM d" when the
/// bucket parses, otherwise the raw string) and the daily energy in watt-hours (<see cref="EnergyWh"/>, the
/// value the web area plots). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyStatsChartPoint(string Date, string Label, double EnergyWh);

/// <summary>
/// The fully projected, render-ready view of the energy summary for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the compact big
/// number (in kWh) and its unit, the summary stats, the daily area points, the chart's series + accessible
/// names and whether there is chart data. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyStatsDisplay(
    bool IsCompact,
    bool IsWide,
    bool IsEmpty,
    bool HasChartData,
    IReadOnlyList<EnergyStatsStat> Stats,
    IReadOnlyList<EnergyStatsChartPoint> ChartPoints,
    int StatColumns,
    double CompactValueKwh,
    string CompactValueText,
    string CompactUnitLabel,
    string CompactAutomationName,
    string ChartSeriesName,
    string ChartAccessibleName,
    string ChartValueUnit);

/// <summary>
/// Pure projection from the parsed energy summary to the display model — the native port of the
/// <c>chartData</c> / <c>stats</c> / <c>toEfficiencyDisplay</c> <c>useMemo</c> work and the <c>isCompact</c> /
/// <c>isWide</c> / <c>hasData</c> / <c>hasChartData</c> gating in
/// web/src/features/dashboard/widgets/EnergyStatsWidget.tsx. Energy is read directly as SI watt-hours and
/// formatted in kWh at the display boundary (web's <c>useUnits</c> pins <c>DEFAULT_ENERGY_PREF = 'kWh'</c>
/// regardless of the metric/imperial distance toggle); efficiency is converted to the user's distance unit
/// (web multiplies Wh/m by 1609.344 for miles, else by 1000 for km); every label resolves through the i18n
/// facade.
/// </summary>
public static class EnergyStatsProjection
{
    /// <summary>Segoe Fluent "lightning bolt" glyph for the surface header / empty state (web <c>Zap</c>).</summary>
    public const string HeaderGlyph = "\uE945";

    /// <summary>The amber chart brush key the header icon and daily-energy area share (web <c>#f59e0b</c>).</summary>
    public const string HeaderAccentBrushKey = "TsChartEnergyBrush";

    /// <summary>Meters per kilometer (web <c>toEfficiencyDisplay</c> multiplies Wh/m by this for Wh/km).</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Meters per mile (web <c>toEfficiencyDisplay</c> multiplies Wh/m by this for Wh/mi).</summary>
    public const double MetersPerMile = 1609.344;

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer for every label.</summary>
    /// <param name="data">The parsed energy summary, or null for the empty surface (web <c>!data</c>).</param>
    /// <param name="size">The widget footprint (drives the compact + wide branches).</param>
    /// <param name="units">The user's unit preference (drives the Wh/mi vs Wh/km efficiency conversion + label).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static EnergyStatsDisplay Project(
        EnergyStatsData? data,
        EnergyStatsSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string compactUnit = UnitLabels.Label(EnergyUnit.Kwh);
        string seriesName = localizer.GetString("widget.energyStats.dailyUsage", "Daily Usage");
        string accessibleName = localizer.GetString("widget.energyStats.energyKwh", "Energy (kWh)");

        if (data is null)
        {
            return new EnergyStatsDisplay(
                IsCompact: size.IsCompact,
                IsWide: size.IsWide,
                IsEmpty: true,
                HasChartData: false,
                Stats: Array.Empty<EnergyStatsStat>(),
                ChartPoints: Array.Empty<EnergyStatsChartPoint>(),
                StatColumns: size.IsWide ? 3 : 2,
                CompactValueKwh: 0,
                CompactValueText: ScalarFormatters.FormatNumber(0, 0),
                CompactUnitLabel: compactUnit,
                CompactAutomationName: string.Empty,
                ChartSeriesName: seriesName,
                ChartAccessibleName: accessibleName,
                ChartValueUnit: compactUnit);
        }

        bool miles = units.Distance == DistanceUnit.Mi;

        // Web parity: useUnits() hardcodes energy to kWh (DEFAULT_ENERGY_PREF) independent of the distance
        // toggle, so energy is always formatted in kWh while the distance unit drives the efficiency unit.
        var energyPref = units with { Energy = EnergyUnit.Kwh };

        string efficiencyUnit = miles
            ? localizer.GetString("widget.energyStats.unitMi", "Wh/mi")
            : localizer.GetString("widget.energyStats.unitKm", "Wh/km");

        var points = BuildChartPoints(data.DailyBreakdown);
        var stats = BuildStats(data, size.IsWide, miles, efficiencyUnit, energyPref, localizer);

        double compactKwh = UnitConverters.EnergyFromSi(data.TotalWh, EnergyUnit.Kwh);
        string compactText = ScalarFormatters.FormatNumber(compactKwh, 0);

        return new EnergyStatsDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            IsEmpty: false,
            HasChartData: points.Count > 0,
            Stats: stats,
            ChartPoints: points,
            StatColumns: size.IsWide ? 3 : 2,
            CompactValueKwh: compactKwh,
            CompactValueText: compactText,
            CompactUnitLabel: compactUnit,
            CompactAutomationName: string.Format(EnUs, "{0} {1}", compactText, compactUnit),
            ChartSeriesName: seriesName,
            ChartAccessibleName: accessibleName,
            ChartValueUnit: compactUnit);
    }

    /// <summary>Convert an SI Wh-per-meter efficiency into the user's display unit (web <c>toEfficiencyDisplay</c>).</summary>
    public static double ToEfficiencyDisplay(double whPerMeter, bool miles) =>
        whPerMeter * (miles ? MetersPerMile : MetersPerKm);

    private static List<EnergyStatsChartPoint> BuildChartPoints(IReadOnlyList<EnergyStatsDailyEntry> daily)
    {
        // Web parity: chartData = dailyBreakdown.map(d => ({ date: d.date, energy: d.energy_wh ?? 0 })) — every
        // day is plotted, in order, with no filtering.
        var points = new List<EnergyStatsChartPoint>(daily.Count);
        foreach (var entry in daily)
        {
            points.Add(new EnergyStatsChartPoint(entry.Date, FormatDayLabel(entry.Date), entry.EnergyWh));
        }

        return points;
    }

    private static List<EnergyStatsStat> BuildStats(
        EnergyStatsData data,
        bool isWide,
        bool miles,
        string efficiencyUnit,
        UnitPref energyPref,
        ILocalizer localizer)
    {
        string usedLabel = localizer.GetString("widget.energyStats.totalUsed", "Total Used");
        string usedValue = UnitFormatters.FormatEnergy(data.TotalEnergyUsedWh, energyPref, 1);

        string chargedLabel = localizer.GetString("widget.energyStats.totalCharged", "Total Charged");
        string chargedValue = UnitFormatters.FormatEnergy(data.TotalEnergyChargedWh, energyPref, 1);

        string efficiencyLabel = localizer.GetString("widget.energyStats.avgEfficiency", "Avg Efficiency");
        string efficiencyValue = ScalarFormatters.FormatNumber(ToEfficiencyDisplay(data.AvgEfficiencyWhPerM, miles), 1);

        string co2Label = localizer.GetString("widget.energyStats.co2Saved", "CO\u2082 Saved");
        string co2Unit = localizer.GetString("widget.energyStats.unitKg", "kg");
        string co2Value = ScalarFormatters.FormatNumber(data.Co2SavedKg, 1);

        var items = new List<EnergyStatsStat>(isWide ? 6 : 4)
        {
            new(usedLabel, usedValue, null, MeasureName(usedLabel, usedValue, null)),
            new(chargedLabel, chargedValue, null, MeasureName(chargedLabel, chargedValue, null)),
            new(efficiencyLabel, efficiencyValue, efficiencyUnit, MeasureName(efficiencyLabel, efficiencyValue, efficiencyUnit)),
            new(co2Label, co2Value, co2Unit, MeasureName(co2Label, co2Value, co2Unit)),
        };

        if (isWide)
        {
            string costLabel = localizer.GetString("widget.energyStats.totalCost", "Total Cost");
            string costUnit = localizer.GetString("widget.energyStats.unitCost", "$");
            string costValue = ScalarFormatters.FormatNumber(data.TotalCost, 2);

            string netLabel = localizer.GetString("widget.energyStats.netBalance", "Net Energy");
            string netValue = UnitFormatters.FormatEnergy(data.TotalEnergyChargedWh - data.TotalEnergyUsedWh, energyPref, 1);

            items.Add(new EnergyStatsStat(costLabel, costValue, costUnit, MeasureName(costLabel, costValue, costUnit)));
            items.Add(new EnergyStatsStat(netLabel, netValue, null, MeasureName(netLabel, netValue, null)));
        }

        return items;
    }

    private static string MeasureName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(EnUs, "{0}: {1}", label, value)
            : string.Format(EnUs, "{0}: {1} {2}", label, value, unit);

    private static string FormatDayLabel(string date)
    {
        if (string.IsNullOrEmpty(date))
        {
            return date;
        }

        string candidate = date.Length >= 10 ? date[..10] : date;
        if (DateTime.TryParseExact(candidate, "yyyy-MM-dd", EnUs, DateTimeStyles.None, out var day))
        {
            return day.ToString("MMM d", EnUs);
        }

        if (DateTimeOffset.TryParse(date, EnUs, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
        {
            return dto.ToString("MMM d", EnUs);
        }

        return date;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;EnergyStatsData&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class EnergyStatsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<EnergyStatsData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        EnergyStatsData Parse() =>
            raw.HasValue ? EnergyStatsData.FromResponse(raw.Value) ?? EnergyStatsData.Empty : EnergyStatsData.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<EnergyStatsData>.Loading(),
            LoadStatus.Cached => RepositoryResult<EnergyStatsData>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<EnergyStatsData>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<EnergyStatsData>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<EnergyStatsData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<EnergyStatsData>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<EnergyStatsData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
