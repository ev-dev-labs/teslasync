using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The lifecycle state the <see cref="EnergyPageViewModel"/> can be in — the native union of the web page's
/// data states (web/src/features/battery/pages/EnergyPage.tsx). The energy-stats read is the spine: while it
/// loads with nothing cached the page shows the skeleton (<see cref="Loading"/>); a hard failure with no cache
/// shows the retry surface (<see cref="Error"/>, web <c>statsError</c> → <c>QueryError</c>); otherwise the full
/// hero + metrics + lifetime + savings + four charts + sessions layout renders (<see cref="Ready"/> /
/// <see cref="Stale"/> / <see cref="Offline"/>). A successful-but-empty stats response is still
/// <see cref="Ready"/> — the page never collapses to a blank surface; instead each panel shows its own empty
/// body (empty hero, empty chart, empty sessions table), mirroring the web page's per-section empty states.
/// </summary>
public enum EnergyState
{
    /// <summary>Initial energy-stats fetch with no cached snapshot — the page-level loading skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot — render the hero, metrics, charts and sessions (panels self-handle empties).</summary>
    Ready,

    /// <summary>The first energy-stats read failed with no cache — render the retry surface (web error).</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One day of the energy rollup (web <c>daily_breakdown</c> row / <c>EnergyStatsRow</c>). Every numeric is SI:
/// <see cref="EnergyWh"/> watt-hours, <see cref="EfficiencyWhPerM"/> watt-hours per metre,
/// <see cref="DistanceM"/> metres. Restated to the user's display unit only at projection time. Pure data.
/// </summary>
/// <param name="Date">The <c>YYYY-MM-DD</c> bucket label (web <c>date</c>).</param>
/// <param name="EnergyWh">SI energy added that day (web <c>energy_wh</c>).</param>
/// <param name="EfficiencyWhPerM">SI efficiency that day (web <c>efficiency_wh_per_m</c>).</param>
/// <param name="DistanceM">SI distance that day (web <c>distance_m</c>).</param>
public sealed record EnergyDailyPoint(string Date, double EnergyWh, double EfficiencyWhPerM, double DistanceM);

/// <summary>
/// The energy-stats rollup from <c>GET /vehicles/{vehicleID}/energy?days=30</c> (web <c>useEnergyStats</c>,
/// shape <c>EnergyStats</c>). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so
/// a partial body never throws. <see cref="TotalWh"/>/<see cref="TotalEnergyUsedWh"/> are SI watt-hours,
/// <see cref="TotalDistanceM"/> is metres and <see cref="AvgEfficiencyWhPerM"/> is watt-hours per metre. Pure
/// data — no WinUI types.
/// </summary>
public sealed record EnergyStats(
    double TotalWh,
    double TotalEnergyUsedWh,
    double TotalDistanceM,
    double AvgEfficiencyWhPerM,
    double? Co2SavedKg,
    IReadOnlyList<EnergyDailyPoint> DailyBreakdown)
{
    /// <summary>An all-zero snapshot with no daily rows — the parse fallback for an absent/non-object body.</summary>
    public static EnergyStats Empty { get; } = new(0, 0, 0, 0, null, Array.Empty<EnergyDailyPoint>());

    /// <summary>True when the stats carry no energy and no distance (web <c>hasNoEnergyData</c> stats half).</summary>
    public bool HasNoData => TotalWh == 0 && TotalEnergyUsedWh == 0 && TotalDistanceM == 0;

    /// <summary>Parse a <c>GET /vehicles/{id}/energy</c> JSON object into a tolerant snapshot.</summary>
    public static EnergyStats FromJson(JsonElement element)
    {
        var obj = JsonParse.Unwrap(element);
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new EnergyStats(
            TotalWh: JsonParse.Double(obj, "total_wh") ?? 0,
            TotalEnergyUsedWh: JsonParse.Double(obj, "total_energy_used_wh") ?? 0,
            TotalDistanceM: JsonParse.Double(obj, "total_distance_m") ?? 0,
            AvgEfficiencyWhPerM: JsonParse.Double(obj, "avg_efficiency_wh_per_m") ?? 0,
            Co2SavedKg: JsonParse.Double(obj, "co2_saved_kg"),
            DailyBreakdown: ParseDaily(obj));
    }

    private static IReadOnlyList<EnergyDailyPoint> ParseDaily(JsonElement obj)
    {
        if (!obj.TryGetProperty("daily_breakdown", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EnergyDailyPoint>();
        }

        var list = new List<EnergyDailyPoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new EnergyDailyPoint(
                Date: JsonParse.String(item, "date") ?? string.Empty,
                EnergyWh: JsonParse.Double(item, "energy_wh") ?? 0,
                EfficiencyWhPerM: JsonParse.Double(item, "efficiency_wh_per_m") ?? 0,
                DistanceM: JsonParse.Double(item, "distance_m") ?? 0));
        }

        return list;
    }
}

/// <summary>
/// One charging session from <c>GET /charging?vehicle_id=…&amp;limit=100</c> (web
/// <c>useChargingSessionsPaginated</c>, shape <c>ChargingSession</c>). SI on the wire: energy in watt-hours,
/// power in watts; cost is already in the account currency. Parsing is null-tolerant. Pure data.
/// </summary>
public sealed record EnergyChargingSession(
    long Id,
    DateTimeOffset StartedAt,
    double TotalEnergyAddedWh,
    double? CostDecimal,
    double? StartSocPct,
    double? EndSocPct,
    double? PeakPowerW,
    string? ChargerType)
{
    /// <summary>Parse a single charging-session JSON object into a tolerant record.</summary>
    public static EnergyChargingSession FromJson(JsonElement item) => new(
        Id: JsonParse.Long(item, "id") ?? 0,
        StartedAt: JsonParse.Date(item, "started_at") ?? DateTimeOffset.MinValue,
        TotalEnergyAddedWh: JsonParse.Double(item, "total_energy_added_wh") ?? 0,
        CostDecimal: JsonParse.Double(item, "cost_decimal"),
        StartSocPct: JsonParse.Double(item, "start_soc_pct"),
        EndSocPct: JsonParse.Double(item, "end_soc_pct"),
        PeakPowerW: JsonParse.Double(item, "peak_power_w"),
        ChargerType: JsonParse.String(item, "charger_type"));

    /// <summary>Parse a charging-sessions array (or <c>{data:[…]}</c> envelope) into a tolerant list.</summary>
    public static IReadOnlyList<EnergyChargingSession> FromArray(JsonElement element)
    {
        var arr = element;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                arr = data;
            }
            else if (element.TryGetProperty("sessions", out var sessions) && sessions.ValueKind == JsonValueKind.Array)
            {
                arr = sessions;
            }
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EnergyChargingSession>();
        }

        var list = new List<EnergyChargingSession>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The latest live-charging snapshot from <c>GET /charging-telemetry/latest?vehicle_id=…</c> (web
/// <c>useChargingTelemetryLatest</c>). Only the lifetime-energy figure the Lifetime Metrics panel reads is
/// modelled; the value is already in kWh on the wire (web renders it with a literal <c>kWh</c> suffix). Pure data.
/// </summary>
/// <param name="LifetimeEnergyUsedKwh">Lifetime energy consumed in kWh (web <c>lifetime_energy_used</c>), or null.</param>
public sealed record EnergyLiveCharging(double? LifetimeEnergyUsedKwh)
{
    /// <summary>An absent live snapshot (no lifetime figure) — the parse fallback for a null/empty response.</summary>
    public static EnergyLiveCharging Empty { get; } = new((double?)null);

    /// <summary>Parse a charging-telemetry-latest JSON object into a tolerant record.</summary>
    public static EnergyLiveCharging FromJson(JsonElement element)
    {
        var obj = JsonParse.Unwrap(element);
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new EnergyLiveCharging(JsonParse.Double(obj, "lifetime_energy_used"));
    }
}

/// <summary>Shared null-tolerant JSON readers (mirrors the web hooks' <c>?? 0</c> / optional-chaining guards).</summary>
internal static class JsonParse
{
    /// <summary>Unwrap a platform <c>{data:…}</c> envelope to the inner object when present.</summary>
    public static JsonElement Unwrap(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("data", out var data)
            && data.ValueKind == JsonValueKind.Object)
        {
            return data;
        }

        return element;
    }

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        var raw = String(obj, name);
        return DateTimeOffset.TryParse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d
            : null;
    }
}

/// <summary>One projected hero radial gauge (web <c>RadialGauge</c>). Values are already in display units.</summary>
public sealed record EnergyGauge(string Label, double Value, double Max, string Unit, int ColorIndex);

/// <summary>One projected quick-metric card (web metric strip cell): a localized label and a formatted value.</summary>
public sealed record EnergyMetricCard(string Label, string Value);

/// <summary>One projected lifetime-metrics sub-card (label, formatted value, descriptive sub-line).</summary>
public sealed record EnergyLifetimeCard(string Label, string Value, string Description);

/// <summary>One projected cost-vs-gas comparison card (web <c>CostComparisonCard</c>).</summary>
public sealed record EnergyCostCompare(
    string Label,
    string EvCostLabel,
    string EvCostValue,
    string GasLabel,
    string GasValue,
    string SavingText,
    string PercentLessText);

/// <summary>One projected charger-type legend row beside the breakdown pie (web breakdown list item).</summary>
public sealed record EnergyChargerRow(
    string Name,
    string SessionsText,
    string EnergyText,
    string CostText,
    string PerKwhText,
    int ColorIndex);

/// <summary>One declarative sessions-table column (web <c>Column&lt;ChargingSession&gt;</c>).</summary>
public sealed record EnergyColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected sessions-table row — the already-formatted cell values keyed by column.</summary>
public sealed record EnergySessionRow(
    long Id,
    string Date,
    string Energy,
    string Battery,
    string Power,
    string Type,
    string Cost,
    string PerKwh);

/// <summary>
/// The fully projected, render-ready view of the Energy page — the native analogue of everything the web page
/// computes before returning JSX. Holds the localized header, the four hero gauges (or the empty-hero message),
/// the six quick-metric cards, the two lifetime cards, the two cost-comparison cards, the four chart panels
/// (title + ARIA summary + bound <see cref="ChartSeries"/> / pie slices + per-chart <see cref="ChartState"/>),
/// the charger-breakdown legend rows, and the sessions table (columns + rows + empty message). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyDisplay(
    string Title,
    string Subtitle,
    string DocumentTitle,
    bool ShowEmptyHero,
    string EmptyHeroMessage,
    IReadOnlyList<EnergyGauge> Gauges,
    IReadOnlyList<EnergyMetricCard> Metrics,
    string LifetimeTitle,
    IReadOnlyList<EnergyLifetimeCard> LifetimeCards,
    IReadOnlyList<EnergyCostCompare> CostCompares,
    string EnergyCostTitle,
    string EnergyCostAria,
    IReadOnlyList<ChartSeries> EnergyCostSeries,
    ChartState EnergyCostState,
    string NoEnergyDataMessage,
    string EfficiencyTitle,
    string EfficiencyAria,
    IReadOnlyList<ChartSeries> EfficiencySeries,
    ChartState EfficiencyState,
    string NoEfficiencyDataMessage,
    string TimeOfDayTitle,
    string TimeOfDayAria,
    IReadOnlyList<ChartSeries> TimeOfDaySeries,
    ChartState TimeOfDayState,
    string OffPeakTip,
    string SolarTip,
    string ChargerBreakdownTitle,
    string ChargerBreakdownAria,
    IReadOnlyList<ChartPoint> ChargerSlices,
    IReadOnlyList<EnergyChargerRow> ChargerRows,
    ChartState ChargerBreakdownState,
    string NoDataMessage,
    string SessionsTitle,
    IReadOnlyList<EnergyColumn> SessionColumns,
    IReadOnlyList<EnergySessionRow> SessionRows,
    string SessionsEmptyMessage)
{
    /// <summary>True when the sessions table has at least one row (web <c>sessions.length &gt; 0</c>).</summary>
    public bool HasSessions => SessionRows.Count > 0;
}

/// <summary>
/// Pure projection from the three raw reads (energy stats, charging sessions, latest live charging) to the
/// render-ready <see cref="EnergyDisplay"/> — the native port of the JSX-time computation in
/// web/src/features/battery/pages/EnergyPage.tsx. SI energy/distance/power are restated to the user's display
/// unit here (and only here) via <see cref="UnitConverters"/> / <see cref="UnitFormatters"/>; currency is
/// formatted via <see cref="ScalarFormatters"/>; every label resolves through the i18n facade with the web key
/// names. The default 30-day window matches the web page's rolling range and the <c>days=30</c> stats query.
/// </summary>
public static class EnergyProjection
{
    /// <summary>The rolling window the page summarizes (web default range + <c>useEnergyStats(…, 30)</c>).</summary>
    public const int WindowDays = 30;

    private const double Co2PerWh = 0.42;          // web: totalEnergy * 0.42 kg CO2 fallback
    private const double GasCostPerMeter = 0.12;   // web: totalDistance * 0.12 gas-equivalent cost
    private const double MetersPerMile = 1609.344; // web efficiency restatement (Wh/mi)
    private const double EfficiencyGaugeMaxWhPerM = 300; // web RadialGauge max basis

    /// <summary>Project the three reads using the active units, currency symbol and currency precision.</summary>
    public static EnergyDisplay Project(
        EnergyStats stats,
        IReadOnlyList<EnergyChargingSession> sessions,
        EnergyLiveCharging live,
        UnitPref units,
        string currencySymbol,
        int currencyPrecision,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(live);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = currencyPrecision < 0 ? 0 : currencyPrecision;

        string energyUnit = UnitLabels.Label(units.Energy);
        string distanceUnit = UnitLabels.Label(units.Distance);
        bool imperial = units.Distance == DistanceUnit.Mi;
        string efficiencyUnit = imperial ? "Wh/mi" : "Wh/km";

        // ---- Derived metrics (web JSX-time computation) ----
        double totalEnergyWh = 0;
        double totalCost = 0;
        foreach (var s in sessions)
        {
            totalEnergyWh += s.TotalEnergyAddedWh;
            totalCost += s.CostDecimal ?? 0;
        }

        double avgEfficiency = stats.AvgEfficiencyWhPerM;
        double totalDistanceM = stats.TotalDistanceM;
        double co2Saved = stats.Co2SavedKg ?? (totalEnergyWh * Co2PerWh);

        double costPerMeter = totalDistanceM > 0 ? totalCost / totalDistanceM : 0;
        double costPerKwh = totalEnergyWh > 0 ? totalCost / (totalEnergyWh / 1000.0) : 0;
        double gasEquivalent = totalDistanceM * GasCostPerMeter;
        double monthlyProjectedCost = costPerMeter > 0 ? costPerMeter * (totalDistanceM / WindowDays) * 30 : 0;
        double yearlyProjectedCost = monthlyProjectedCost * 12;

        double energyDisplay = UnitConverters.EnergyFromSi(totalEnergyWh, units.Energy);
        double distanceDisplay = UnitConverters.DistanceFromSi(totalDistanceM, units.Distance);

        // ---- Empty-hero gate (web hasNoEnergyData) ----
        bool noSessions = sessions.Count == 0;
        bool showEmptyHero = noSessions && stats.HasNoData;

        // ---- Hero gauges (web four RadialGauges) ----
        double efficiencyValueWhPerM = avgEfficiency != 0
            ? avgEfficiency
            : (totalDistanceM > 0 ? (totalEnergyWh * 1000.0) / totalDistanceM : 0);
        var gauges = new List<EnergyGauge>(4)
        {
            new(
                localizer.GetString("energy.gauge.energyUsed", "Energy Used"),
                energyDisplay,
                Math.Max(energyDisplay * 1.3, 100),
                energyUnit,
                ColorIndex: 0),
            new(
                localizer.GetString("energy.gauge.efficiency", "Efficiency"),
                ToEfficiencyDisplay(efficiencyValueWhPerM, imperial),
                ToEfficiencyDisplay(EfficiencyGaugeMaxWhPerM, imperial),
                efficiencyUnit,
                ColorIndex: 1),
            new(
                localizer.GetString("energy.gauge.co2Saved", "CO\u2082 Saved"),
                co2Saved,
                Math.Max(co2Saved * 1.5, 50),
                "kg",
                ColorIndex: 2),
            new(
                localizer.GetString("energy.gauge.totalCost", "Total Cost"),
                totalCost,
                Math.Max(totalCost * 1.5, 50),
                symbol,
                ColorIndex: 3),
        };

        // ---- Quick metrics strip (web six metric cells) ----
        double costPerDistance = distanceDisplay > 0 ? totalCost / distanceDisplay : 0;
        var metrics = new List<EnergyMetricCard>(6)
        {
            new(
                Fill(localizer.GetString("energy.metric.costPerDist", "Cost per {unit}"), distanceUnit),
                ScalarFormatters.FormatCurrency(costPerDistance, symbol, precision)),
            new(
                localizer.GetString("energy.metric.costPerKwh", "Cost per kWh"),
                ScalarFormatters.FormatCurrency(costPerKwh, symbol, precision)),
            new(
                localizer.GetString("energy.metric.totalDistance", "Total Distance"),
                $"{ScalarFormatters.FormatNumber(distanceDisplay, 0)} {distanceUnit}"),
            new(
                localizer.GetString("energy.metric.sessions", "Sessions"),
                ScalarFormatters.FormatNumber(sessions.Count, 0)),
            new(
                localizer.GetString("energy.metric.monthlyEst", "Monthly Est."),
                ScalarFormatters.FormatCurrency(monthlyProjectedCost, symbol, precision)),
            new(
                localizer.GetString("energy.metric.yearlyEst", "Yearly Est."),
                ScalarFormatters.FormatCurrency(yearlyProjectedCost, symbol, precision)),
        };

        // ---- Lifetime metrics (web two sub-cards) ----
        string lifetimeValue = live.LifetimeEnergyUsedKwh is { } life
            ? $"{ScalarFormatters.FormatNumber(life, 0)} kWh"
            : UnitFormatters.DefaultEmptyDisplay;
        var lifetimeCards = new List<EnergyLifetimeCard>(2)
        {
            new(
                localizer.GetString("energy.lifetime.energyUsed", "Lifetime Energy Used"),
                lifetimeValue,
                localizer.GetString("energy.lifetime.energyUsedDesc", "Total energy consumed since vehicle delivery")),
            new(
                Fill(localizer.GetString("energy.lifetime.periodEnergy", "Last {days} Days"), WindowDays.ToString(CultureInfo.InvariantCulture)),
                $"{ScalarFormatters.FormatNumber(energyDisplay, 0)} {energyUnit}",
                localizer.GetString("energy.lifetime.periodEnergyDesc", "Energy added during selected date range")),
        };

        // ---- Cost vs gas comparison cards (web two CostComparisonCards) ----
        var costCompares = new List<EnergyCostCompare>(2)
        {
            BuildCompare(
                Fill(localizer.GetString("energy.cost_decimal.periodTotal", "{days}-Day Total"), WindowDays.ToString(CultureInfo.InvariantCulture)),
                totalCost,
                gasEquivalent,
                symbol,
                precision,
                localizer),
            BuildCompare(
                localizer.GetString("energy.cost_decimal.projectedAnnual", "Projected Annual"),
                yearlyProjectedCost,
                (gasEquivalent / WindowDays) * 365,
                symbol,
                precision,
                localizer),
        };

        // ---- Charts row 1: energy & cost daily + efficiency trend ----
        bool hasDaily = stats.DailyBreakdown.Count > 0;
        var energyCostSeries = BuildEnergyCostSeries(stats.DailyBreakdown, units, efficiencyUnit, localizer);
        var efficiencySeries = BuildEfficiencySeries(stats.DailyBreakdown, units, efficiencyUnit, distanceUnit, localizer);

        // ---- Charts row 2: time-of-day buckets + charger-type breakdown ----
        var buckets = BuildTimeOfDay(sessions, units, localizer);
        bool hasTimeOfDay = buckets.Count > 0;
        var timeOfDaySeries = BuildTimeOfDaySeries(buckets, localizer);

        var (chargerSlices, chargerRows) = BuildChargerBreakdown(sessions, units, symbol, precision, localizer);
        bool hasCharger = chargerRows.Count > 0;

        // ---- Sessions table (web DataTable, first 15) ----
        var sessionRows = BuildSessionRows(sessions, units, symbol, precision);

        return new EnergyDisplay(
            Title: localizer.GetString("energy.pageTitle", "Energy Intelligence"),
            Subtitle: localizer.GetString("energy.pageSubtitle", "Deep cost analytics, efficiency trends, savings projections, and consumption patterns"),
            DocumentTitle: localizer.GetString("energy.title", "Energy"),
            ShowEmptyHero: showEmptyHero,
            EmptyHeroMessage: localizer.GetString("energy.empty.hero", "No energy data yet \u2014 connect your vehicle and complete a drive or charging session to see efficiency, cost, and CO\u2082 savings."),
            Gauges: gauges,
            Metrics: metrics,
            LifetimeTitle: localizer.GetString("energy.lifetime.title", "Lifetime Metrics"),
            LifetimeCards: lifetimeCards,
            CostCompares: costCompares,
            EnergyCostTitle: localizer.GetString("energy.chart.energyCostDaily", "Energy & Cost Daily"),
            EnergyCostAria: localizer.GetString("energy.chart.energyCostDaily.aria", "Daily energy and efficiency composed chart with bars and a line"),
            EnergyCostSeries: energyCostSeries,
            EnergyCostState: hasDaily ? ChartState.Ready : ChartState.Empty,
            NoEnergyDataMessage: localizer.GetString("energy.chart.noEnergyData", "Connect vehicle to see energy data"),
            EfficiencyTitle: localizer.GetString("energy.chart.efficiencyTrend", "Efficiency Trend"),
            EfficiencyAria: localizer.GetString("energy.chart.efficiencyTrend.aria", "Daily efficiency and distance area chart"),
            EfficiencySeries: efficiencySeries,
            EfficiencyState: hasDaily ? ChartState.Ready : ChartState.Empty,
            NoEfficiencyDataMessage: localizer.GetString("energy.chart.noEfficiencyData", "No efficiency data yet"),
            TimeOfDayTitle: localizer.GetString("energy.chart.chargingByTime", "Charging by Time of Day"),
            TimeOfDayAria: localizer.GetString("energy.chart.chargingByTime.aria", "Charging energy and session count by time of day bar chart"),
            TimeOfDaySeries: timeOfDaySeries,
            TimeOfDayState: hasTimeOfDay ? ChartState.Ready : ChartState.Empty,
            OffPeakTip: localizer.GetString("energy.tip.offPeak", "Off-peak charging saves money"),
            SolarTip: localizer.GetString("energy.tip.solar", "Solar-optimal: 10am\u20133pm"),
            ChargerBreakdownTitle: localizer.GetString("energy.chart.chargerBreakdown", "Charger Type Breakdown"),
            ChargerBreakdownAria: localizer.GetString("energy.chart.chargerBreakdown.aria", "Charger type share pie chart"),
            ChargerSlices: chargerSlices,
            ChargerRows: chargerRows,
            ChargerBreakdownState: hasCharger ? ChartState.Ready : ChartState.Empty,
            NoDataMessage: localizer.GetString("common.noData", "No data available"),
            SessionsTitle: localizer.GetString("energy.sessions.title", "Recent Charging Sessions"),
            SessionColumns: BuildColumns(localizer),
            SessionRows: sessionRows,
            SessionsEmptyMessage: localizer.GetString("energy.sessions.empty", "No charging sessions recorded"));
    }

    private static double ToEfficiencyDisplay(double whPerM, bool imperial) =>
        imperial ? whPerM * MetersPerMile : whPerM * 1000.0;

    private static EnergyCostCompare BuildCompare(
        string label, double evCost, double gasCost, string symbol, int precision, ILocalizer localizer)
    {
        double savings = gasCost - evCost;
        double savingsPct = gasCost > 0 ? (savings / gasCost) * 100 : 0;
        return new EnergyCostCompare(
            Label: label,
            EvCostLabel: localizer.GetString("energy.cost_decimal.evCost", "EV Cost"),
            EvCostValue: ScalarFormatters.FormatCurrency(evCost, symbol, precision),
            GasLabel: localizer.GetString("energy.cost_decimal.gasEquivalent", "Gas Equivalent"),
            GasValue: ScalarFormatters.FormatCurrency(gasCost, symbol, precision),
            SavingText: string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                localizer.GetString("energy.cost_decimal.saving", "Saving"),
                ScalarFormatters.FormatCurrency(savings, symbol, precision)),
            PercentLessText: string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                ScalarFormatters.FormatPercentage(savingsPct, 0),
                localizer.GetString("energy.cost_decimal.less", "less")));
    }

    private static ChartSeries[] BuildEnergyCostSeries(
        IReadOnlyList<EnergyDailyPoint> daily, UnitPref units, string efficiencyUnit, ILocalizer localizer)
    {
        if (daily.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var energyPoints = new List<ChartPoint>(daily.Count);
        var efficiencyPoints = new List<ChartPoint>(daily.Count);
        bool imperial = units.Distance == DistanceUnit.Mi;
        for (int i = 0; i < daily.Count; i++)
        {
            energyPoints.Add(new ChartPoint(i, UnitConverters.EnergyFromSi(daily[i].EnergyWh, units.Energy), daily[i].Date));
            efficiencyPoints.Add(new ChartPoint(i, ToEfficiencyDisplay(daily[i].EfficiencyWhPerM, imperial), daily[i].Date));
        }

        return new[]
        {
            new ChartSeries(localizer.GetString("energy.chart.energy", "Energy"), energyPoints)
            {
                Kind = ChartSeriesKind.Bar,
                Role = ChartRole.Energy,
                Unit = UnitLabels.Label(units.Energy),
                Decimals = 0,
            },
            new ChartSeries(efficiencyUnit, efficiencyPoints)
            {
                Kind = ChartSeriesKind.Line,
                Role = ChartRole.Battery,
                Unit = efficiencyUnit,
                Decimals = 0,
            },
        };
    }

    private static ChartSeries[] BuildEfficiencySeries(
        IReadOnlyList<EnergyDailyPoint> daily, UnitPref units, string efficiencyUnit, string distanceUnit, ILocalizer localizer)
    {
        if (daily.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var efficiencyPoints = new List<ChartPoint>(daily.Count);
        var distancePoints = new List<ChartPoint>(daily.Count);
        bool imperial = units.Distance == DistanceUnit.Mi;
        for (int i = 0; i < daily.Count; i++)
        {
            efficiencyPoints.Add(new ChartPoint(i, ToEfficiencyDisplay(daily[i].EfficiencyWhPerM, imperial), daily[i].Date));
            distancePoints.Add(new ChartPoint(i, UnitConverters.DistanceFromSi(daily[i].DistanceM, units.Distance), daily[i].Date));
        }

        return new[]
        {
            new ChartSeries(efficiencyUnit, efficiencyPoints)
            {
                Kind = ChartSeriesKind.Area,
                Role = ChartRole.Battery,
                Unit = efficiencyUnit,
                Decimals = 0,
            },
            new ChartSeries(
                Fill(localizer.GetString("energy.chart.distance", "Distance ({unit})"), distanceUnit),
                distancePoints)
            {
                Kind = ChartSeriesKind.Area,
                Role = ChartRole.Energy,
                Unit = distanceUnit,
                Decimals = 0,
            },
        };
    }

    private static IReadOnlyList<TimeOfDayBucket> BuildTimeOfDay(
        IReadOnlyList<EnergyChargingSession> sessions, UnitPref units, ILocalizer localizer)
    {
        if (sessions.Count == 0)
        {
            return Array.Empty<TimeOfDayBucket>();
        }

        string[] labels =
        {
            localizer.GetString("energy.timeOfDay.night", "Night (0-6)"),
            localizer.GetString("energy.timeOfDay.morning", "Morning (6-12)"),
            localizer.GetString("energy.timeOfDay.afternoon", "Afternoon (12-18)"),
            localizer.GetString("energy.timeOfDay.evening", "Evening (18-24)"),
        };

        var counts = new int[4];
        var energy = new double[4];
        foreach (var s in sessions)
        {
            int hour = s.StartedAt.ToLocalTime().Hour;
            int idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
            counts[idx]++;
            energy[idx] += s.TotalEnergyAddedWh;
        }

        var list = new List<TimeOfDayBucket>(4);
        for (int i = 0; i < 4; i++)
        {
            list.Add(new TimeOfDayBucket(labels[i], counts[i], UnitConverters.EnergyFromSi(energy[i], units.Energy)));
        }

        return list;
    }

    private static ChartSeries[] BuildTimeOfDaySeries(
        IReadOnlyList<TimeOfDayBucket> buckets, ILocalizer localizer)
    {
        if (buckets.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var energyPoints = new List<ChartPoint>(buckets.Count);
        var countPoints = new List<ChartPoint>(buckets.Count);
        for (int i = 0; i < buckets.Count; i++)
        {
            energyPoints.Add(new ChartPoint(i, buckets[i].Energy, buckets[i].Name));
            countPoints.Add(new ChartPoint(i, buckets[i].Count, buckets[i].Name));
        }

        return new[]
        {
            new ChartSeries(localizer.GetString("energy.chart.energyKwh", "Energy (kWh)"), energyPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 4,
                Decimals = 1,
            },
            new ChartSeries(localizer.GetString("energy.chart.sessions", "Sessions"), countPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 2,
                Decimals = 0,
            },
        };
    }

    private static (IReadOnlyList<ChartPoint> Slices, IReadOnlyList<EnergyChargerRow> Rows) BuildChargerBreakdown(
        IReadOnlyList<EnergyChargingSession> sessions, UnitPref units, string symbol, int precision, ILocalizer localizer)
    {
        if (sessions.Count == 0)
        {
            return (Array.Empty<ChartPoint>(), Array.Empty<EnergyChargerRow>());
        }

        var order = new List<string>();
        var groups = new Dictionary<string, ChargerGroup>(StringComparer.Ordinal);
        foreach (var s in sessions)
        {
            string label = ChargerLabel(s.ChargerType);
            if (!groups.TryGetValue(label, out var group))
            {
                group = new ChargerGroup();
                groups[label] = group;
                order.Add(label);
            }

            group.Count++;
            group.EnergyWh += s.TotalEnergyAddedWh;
            group.Cost += s.CostDecimal ?? 0;
        }

        var slices = new List<ChartPoint>(order.Count);
        var rows = new List<EnergyChargerRow>(order.Count);
        string sessionsWord = localizer.GetString("energy.breakdown.sessions", "sessions");
        for (int i = 0; i < order.Count; i++)
        {
            string name = order[i];
            var group = groups[name];
            double energyWh = group.EnergyWh;
            double energyDisplay = UnitConverters.EnergyFromSi(energyWh, units.Energy);
            double perKwh = energyWh > 0 ? group.Cost / (energyWh / 1000.0) : 0;
            slices.Add(new ChartPoint(i, energyDisplay, name));
            rows.Add(new EnergyChargerRow(
                Name: name,
                SessionsText: $"{ScalarFormatters.FormatNumber(group.Count, 0)} {sessionsWord}",
                EnergyText: $"{ScalarFormatters.FormatNumber(energyDisplay, 0)} {UnitLabels.Label(units.Energy)}",
                CostText: ScalarFormatters.FormatCurrency(group.Cost, symbol, precision),
                PerKwhText: $"{ScalarFormatters.FormatCurrency(perKwh, symbol, 3)}/kWh",
                ColorIndex: i));
        }

        return (slices, rows);
    }

    private static IReadOnlyList<EnergySessionRow> BuildSessionRows(
        IReadOnlyList<EnergyChargingSession> sessions, UnitPref units, string symbol, int precision)
    {
        if (sessions.Count == 0)
        {
            return Array.Empty<EnergySessionRow>();
        }

        int take = Math.Min(15, sessions.Count);
        var rows = new List<EnergySessionRow>(take);
        for (int i = 0; i < take; i++)
        {
            var s = sessions[i];
            string startSoc = s.StartSocPct is { } ss ? $"{ScalarFormatters.FormatNumber(ss, 0)}%" : UnitFormatters.DefaultEmptyDisplay;
            string endSoc = s.EndSocPct is { } es ? $"{ScalarFormatters.FormatNumber(es, 0)}%" : UnitFormatters.DefaultEmptyDisplay;
            string power = s.PeakPowerW is { } pw
                ? $"{ScalarFormatters.FormatNumber(UnitConverters.PowerFromSi(pw, PowerUnit.Kw), 0)} kW"
                : UnitFormatters.DefaultEmptyDisplay;
            string cost = s.CostDecimal is { } c ? ScalarFormatters.FormatCurrency(c, symbol, precision) : UnitFormatters.DefaultEmptyDisplay;
            double energyKwh = UnitConverters.EnergyFromSi(s.TotalEnergyAddedWh, EnergyUnit.Kwh);
            string perKwh = s.CostDecimal is { } cd && energyKwh > 0
                ? ScalarFormatters.FormatCurrency(cd / energyKwh, symbol, precision)
                : UnitFormatters.DefaultEmptyDisplay;

            rows.Add(new EnergySessionRow(
                Id: s.Id,
                Date: s.StartedAt == DateTimeOffset.MinValue
                    ? UnitFormatters.DefaultEmptyDisplay
                    : s.StartedAt.ToLocalTime().ToString("d", CultureInfo.CurrentCulture),
                Energy: UnitFormatters.FormatEnergy(s.TotalEnergyAddedWh, units),
                Battery: $"{startSoc} \u2192 {endSoc}",
                Power: power,
                Type: ChargerLabel(s.ChargerType),
                Cost: cost,
                PerKwh: perKwh));
        }

        return rows;
    }

    private static EnergyColumn[] BuildColumns(ILocalizer localizer) => new[]
    {
        new EnergyColumn("date", localizer.GetString("energy.table.date", "Date"), false),
        new EnergyColumn("energy", localizer.GetString("energy.table.energy", "Energy"), true),
        new EnergyColumn("battery", localizer.GetString("energy.table.battery", "Battery"), false),
        new EnergyColumn("power", localizer.GetString("energy.table.power", "Power"), true),
        new EnergyColumn("type", localizer.GetString("energy.table.type", "Type"), false),
        new EnergyColumn("cost", localizer.GetString("energy.table.cost_decimal", "Cost"), true),
        new EnergyColumn("perKwh", localizer.GetString("energy.table.perKwh", "$/kWh"), true),
    };

    private static string ChargerLabel(string? chargerType)
    {
        if (!string.IsNullOrEmpty(chargerType) && chargerType.Contains("tesla", StringComparison.OrdinalIgnoreCase))
        {
            return "Supercharger";
        }

        return string.IsNullOrEmpty(chargerType) ? "Home/AC" : "DC Fast";
    }

    // Substitute the single interpolation token a localized template carries, accepting both the catalog's {0}
    // form and the web fallback's {{token}} / {token} forms so production and headless tests both resolve.
    private static string Fill(string template, string value) =>
        template
            .Replace("{0}", value, StringComparison.Ordinal)
            .Replace("{{unit}}", value, StringComparison.Ordinal)
            .Replace("{unit}", value, StringComparison.Ordinal)
            .Replace("{{days}}", value, StringComparison.Ordinal)
            .Replace("{days}", value, StringComparison.Ordinal);

    private sealed record TimeOfDayBucket(string Name, int Count, double Energy);

    private sealed class ChargerGroup
    {
        public int Count { get; set; }

        public double EnergyWh { get; set; }

        public double Cost { get; set; }
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed typed results,
/// preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render the full
/// state matrix. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class EnergyResultMapper
{
    /// <summary>Parse an energy-stats payload (when present) while preserving its status.</summary>
    public static RepositoryResult<EnergyStats> MapStats(RepositoryResult<JsonElement> raw) =>
        Map(raw, EnergyStats.FromJson, EnergyStats.Empty);

    /// <summary>Parse a charging-sessions payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<EnergyChargingSession>> MapSessions(RepositoryResult<JsonElement> raw) =>
        Map(raw, EnergyChargingSession.FromArray, Array.Empty<EnergyChargingSession>());

    /// <summary>Parse a latest-live-charging payload (when present) while preserving its status.</summary>
    public static RepositoryResult<EnergyLiveCharging> MapLive(RepositoryResult<JsonElement> raw) =>
        Map(raw, EnergyLiveCharging.FromJson, EnergyLiveCharging.Empty);

    private static RepositoryResult<T> Map<T>(RepositoryResult<JsonElement> raw, Func<JsonElement, T> parse, T empty)
    {
        ArgumentNullException.ThrowIfNull(raw);
        T Parse() => raw.HasValue ? parse(raw.Value) : empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<T>.Loading(),
            LoadStatus.Cached => RepositoryResult<T>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<T>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<T>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<T>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The energy-stats data port the <see cref="EnergyPageViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useEnergyStats</c> hook. It yields the cache-then-network sequence of parsed
/// stats snapshots for the scoped vehicle. The view never performs HTTP.
/// </summary>
public interface IEnergyStatsSource
{
    /// <summary>Stream the cache-then-network energy-stats snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<EnergyStats>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The charging-sessions data port (P1/S8) — the native analogue of the web <c>useChargingSessionsPaginated</c>
/// hook. It yields the cache-then-network sequence of parsed session lists for the scoped vehicle and window.
/// </summary>
public interface IChargingSessionsSource
{
    /// <summary>Stream the cache-then-network charging-session lists, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<EnergyChargingSession>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The latest-live-charging data port (P1/S8) — the native analogue of the web <c>useChargingTelemetryLatest</c>
/// hook. It yields the cache-then-network sequence of parsed live-charging snapshots for the scoped vehicle.
/// </summary>
public interface IChargingTelemetryLatestSource
{
    /// <summary>Stream the cache-then-network latest-live-charging snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<EnergyLiveCharging>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>The default empty energy-stats feed — yields a single empty result (the parameterless page's feed).</summary>
public sealed class EmptyEnergyStatsSource : IEnergyStatsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyEnergyStatsSource Instance { get; } = new();

    private EmptyEnergyStatsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergyStats>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<EnergyStats>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default empty charging-sessions feed — yields a single empty result.</summary>
public sealed class EmptyChargingSessionsSource : IChargingSessionsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChargingSessionsSource Instance { get; } = new();

    private EmptyChargingSessionsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<EnergyChargingSession>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default empty latest-live-charging feed — yields a single empty result.</summary>
public sealed class EmptyChargingTelemetryLatestSource : IChargingTelemetryLatestSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChargingTelemetryLatestSource Instance { get; } = new();

    private EmptyChargingTelemetryLatestSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergyLiveCharging>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<EnergyLiveCharging>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// Canonical metadata for the Energy page — the native mirror of the web route <c>/energy</c> (nav name
/// <c>Energy</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the title and
/// subtitle resolve through the i18n facade with the web key names.
/// </summary>
public static class EnergyRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "Energy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyPage";

    /// <summary>The localized page title (web <c>energy.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("energy.pageTitle", "Energy Intelligence");
    }

    /// <summary>The localized page subtitle (web <c>energy.pageSubtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "energy.pageSubtitle",
            "Deep cost analytics, efficiency trends, savings projections, and consumption patterns");
    }
}

/// <summary>
/// PII-safe diagnostics for the Energy page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never an energy figure, cost, vehicle id or VIN — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EnergyDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergyRegistration.Slug}");
    }
}
