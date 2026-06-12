using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>EnergyFlowPage</c> surface — the native mirror of the data
/// states the web page renders (web/src/features/battery/pages/EnergyFlowPage.tsx). The web page drives its
/// top-level state off the historical energy query (web <c>statsLoading</c> / <c>!stats</c>) and overlays the
/// real-time <c>useEnergyFlow</c> reading inside the success layout. In precedence order: the loading shimmer
/// (web <c>isLoading</c>), the generic failure surface, the "no energy flow data" empty state, or the six-section
/// success layout. Per-region visibility is still driven by the projected flags so each branch renders exactly as
/// the web composes it; this enum is the top-level summary the ledger / Narrator key off.
/// </summary>
public enum EnergyFlowState
{
    /// <summary>The historical energy query is in flight (web <c>statsLoading</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no stats (web <c>!stats</c>, incl. no vehicle selected) — the empty state shows.</summary>
    Empty,

    /// <summary>The historical query failed — a retryable error surface shows (web <c>statsError</c>).</summary>
    Error,

    /// <summary>The query produced stats (web <c>stats</c> present) — the six energy sections render.</summary>
    Success,
}

/// <summary>
/// The real-time power-flow reading — the native mirror of the web <c>EnergyFlowData</c>
/// (web/src/types/energy.ts), read from <c>GET /vehicles/{vehicleID}/energy/flow</c> (web <c>useEnergyFlow</c>).
/// Every field is nullable on the wire; parsing is null-tolerant and unwraps the platform <c>{data:…}</c>
/// envelope. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyFlowReading(
    double? DcChargingPower,
    double? AcChargingPower,
    double? EnergyRemaining,
    double? PackVoltage,
    double? PackCurrent,
    double? Soc,
    string? ChargeState)
{
    /// <summary>The all-null reading (the default before any live frame arrives).</summary>
    public static EnergyFlowReading Empty { get; } = new(null, null, null, null, null, null, null);

    /// <summary>Read the flow reading from JSON, tolerating missing / null fields and the <c>{data:…}</c> envelope.</summary>
    public static EnergyFlowReading FromJson(JsonElement root)
    {
        JsonElement o = EnergyFlowJson.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new EnergyFlowReading(
            DcChargingPower: EnergyFlowJson.Double(o, "dc_charging_power"),
            AcChargingPower: EnergyFlowJson.Double(o, "ac_charging_power"),
            EnergyRemaining: EnergyFlowJson.Double(o, "energy_remaining"),
            PackVoltage: EnergyFlowJson.Double(o, "pack_voltage"),
            PackCurrent: EnergyFlowJson.Double(o, "pack_current"),
            Soc: EnergyFlowJson.Double(o, "soc"),
            ChargeState: EnergyFlowJson.Str(o, "charge_state"));
    }
}

/// <summary>
/// One day's energy rollup — the native mirror of the web <c>DailyBreakdownEntry</c>: the date stamp, the
/// SI watt-hours used, the SI metres driven, the SI Wh/m efficiency and the cost. Field names mirror the Go
/// API's snake_case JSON tags (energy_handler.go); parsing is null-tolerant. Pure data.
/// </summary>
public sealed record EnergyDailyEntry(
    string? Date,
    double EnergyWh,
    double DistanceM,
    double EfficiencyWhPerM,
    double Cost)
{
    /// <summary>Read one daily entry from a JSON object, tolerating missing / null fields.</summary>
    public static EnergyDailyEntry FromJson(JsonElement o) => new(
        Date: EnergyFlowJson.Str(o, "date"),
        EnergyWh: EnergyFlowJson.Double(o, "energy_wh") ?? 0,
        DistanceM: EnergyFlowJson.Double(o, "distance_m") ?? 0,
        EfficiencyWhPerM: EnergyFlowJson.Double(o, "efficiency_wh_per_m") ?? 0,
        Cost: EnergyFlowJson.Double(o, "cost") ?? 0);
}

/// <summary>
/// The historical energy rollup — the native mirror of the web <c>EnergyStatsResponse</c>
/// (GET /vehicles/{vehicleID}/energy?days=N). <see cref="HasData"/> records whether the server returned a
/// response (the web <c>stats</c> presence test). The tolerant parser unwraps the platform <c>{data:…}</c>
/// envelope so the snake_case wire shape (SI units) round-trips losslessly. Pure data.
/// </summary>
public sealed record EnergyStatsReading(
    bool HasData,
    long VehicleId,
    int PeriodDays,
    double TotalEnergyUsedWh,
    double TotalEnergyChargedWh,
    double TotalWh,
    double TotalCost,
    double TotalDistanceM,
    double AvgEfficiencyWhPerM,
    double Co2SavedKg,
    IReadOnlyList<EnergyDailyEntry> DailyBreakdown)
{
    /// <summary>The empty rollup (no response yet) — the default local-state feed result.</summary>
    public static EnergyStatsReading Empty { get; } = new(
        false, 0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<EnergyDailyEntry>());

    /// <summary>Read the energy rollup from JSON, tolerating missing / null fields and the <c>{data:…}</c> envelope.</summary>
    public static EnergyStatsReading FromJson(JsonElement root)
    {
        JsonElement o = EnergyFlowJson.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var daily = new List<EnergyDailyEntry>();
        if (o.TryGetProperty("daily_breakdown", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    daily.Add(EnergyDailyEntry.FromJson(element));
                }
            }
        }

        return new EnergyStatsReading(
            HasData: true,
            VehicleId: EnergyFlowJson.Long(o, "vehicle_id") ?? 0,
            PeriodDays: (int)(EnergyFlowJson.Long(o, "period_days") ?? 0),
            TotalEnergyUsedWh: EnergyFlowJson.Double(o, "total_energy_used_wh") ?? 0,
            TotalEnergyChargedWh: EnergyFlowJson.Double(o, "total_energy_charged_wh") ?? 0,
            TotalWh: EnergyFlowJson.Double(o, "total_wh") ?? 0,
            TotalCost: EnergyFlowJson.Double(o, "total_cost") ?? 0,
            TotalDistanceM: EnergyFlowJson.Double(o, "total_distance_m") ?? 0,
            AvgEfficiencyWhPerM: EnergyFlowJson.Double(o, "avg_efficiency_wh_per_m") ?? 0,
            Co2SavedKg: EnergyFlowJson.Double(o, "co2_saved_kg") ?? 0,
            DailyBreakdown: daily);
    }
}

/// <summary>
/// The data port the <see cref="EnergyFlowPageViewModel"/> reads through — the native parity of the web page's two
/// queries: the historical rollup (<c>GET /vehicles/{id}/energy?days=N</c>) that drives the page state, and the
/// real-time <c>useEnergyFlow</c> reading (<c>GET /vehicles/{id}/energy/flow</c>) overlaid on the flow diagram.
/// The view never performs HTTP itself; the default <see cref="EmptyEnergyFlowFeed"/> resolves to the empty state,
/// and the generated-client-backed <see cref="EnergyFlowClientFeed"/> binds to the generated OpenAPI contract
/// client (ADR-004). A failing stats fetch throws so the view-model surfaces the retryable error branch.
/// </summary>
public interface IEnergyFlowFeed
{
    /// <summary>Resolve the historical energy rollup for the trailing <paramref name="days"/> window (web stats query).</summary>
    Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken);

    /// <summary>Resolve the latest real-time power-flow reading (web <c>useEnergyFlow</c>).</summary>
    Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty reading (the empty data state).</summary>
public sealed class EmptyEnergyFlowFeed : IEnergyFlowFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyEnergyFlowFeed Instance { get; } = new();

    private EmptyEnergyFlowFeed()
    {
    }

    /// <inheritdoc />
    public Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(EnergyStatsReading.Empty);
    }

    /// <inheritdoc />
    public Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(EnergyFlowReading.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>EnergyFlowPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/battery/pages/EnergyFlowPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="VehicleSelected">Whether a vehicle is selected (web <c>activeId != null</c>).</param>
/// <param name="Loading">Whether the stats query is in flight with no data yet (web <c>statsLoading</c>).</param>
/// <param name="HasError">Whether the stats query failed.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="HasStats">Whether the stats query produced a response (web <c>stats</c>).</param>
/// <param name="Stats">The historical energy rollup (web <c>stats</c>).</param>
/// <param name="Flow">The real-time power-flow reading (web <c>flow</c>).</param>
public sealed record EnergyFlowModel(
    bool VehicleSelected,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool HasStats,
    EnergyStatsReading Stats,
    EnergyFlowReading Flow)
{
    /// <summary>The initial model — first load, no vehicle resolved yet, no data.</summary>
    public static EnergyFlowModel Initial { get; } = new(
        VehicleSelected: false,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        HasStats: false,
        Stats: EnergyStatsReading.Empty,
        Flow: EnergyFlowReading.Empty);
}

/// <summary>One historical summary tile (web <c>MetricCard</c>): the label, formatted value, unit sub-line and accent glyph.</summary>
public sealed record EnergyMetricTile(string Label, string Value, string Sublabel, string Glyph);

/// <summary>One flow-diagram node (web Grid / Motor / DC / AC / HVAC / Accessories <c>GlassPanel</c>): a label and a value/state line.</summary>
public sealed record EnergyFlowNode(string Label, string Value);

/// <summary>One flow-diagram edge (web <c>FlowArrow</c> Charging / Driving): a label, a formatted value and an active flag (web <c>isActive</c>).</summary>
public sealed record EnergyFlowEdge(string Label, string Value, bool Active);

/// <summary>One efficiency-metrics sub-card (web Section 5 <c>GlassPanel</c>): a label, value and a status badge.</summary>
public sealed record EnergyEfficiencyTile(string Label, string Value, string BadgeText, StatusKind BadgeStatus);

/// <summary>One projected history table column descriptor (web <c>Column</c>): the row-value key, the localized header and whether the values are numeric.</summary>
public sealed record EnergyHistoryColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected, render-ready history row (web table <c>render</c> output): the formatted cells keyed by column.</summary>
public sealed record EnergyHistoryRowDisplay(string Key, string Date, string Energy, string Distance, string Efficiency);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every number formatted at the display
/// boundary via the shared SI formatters. Holds the always-visible page header, the four data-state flags, the
/// real-time energy-flow diagram (nodes + edges + SOC gauge + charge-state badge), the six historical summary
/// tiles, the three chart series + their per-chart empty bodies, the three efficiency-metrics sub-cards and the
/// daily-energy history table. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record EnergyFlowDisplay(
    EnergyFlowState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowContent,

    // Section 1 — real-time energy flow diagram (GlassPanel1..8)
    string FlowDiagramTitle,
    bool ChargeStateVisible,
    string ChargeStateText,
    StatusKind ChargeStateStatus,
    EnergyFlowNode Grid,
    EnergyFlowEdge ChargingEdge,
    string BatteryLabel,
    double BatterySoc,
    string BatterySocUnit,
    bool EnergyRemainingVisible,
    string EnergyRemainingText,
    EnergyFlowEdge DrivingEdge,
    EnergyFlowNode Motor,
    EnergyFlowNode DcPower,
    EnergyFlowNode AcPower,
    EnergyFlowNode Hvac,
    EnergyFlowNode Accessories,

    // Section 2 — six historical summary tiles (Total-Energy..Period)
    EnergyMetricTile TotalEnergy,
    EnergyMetricTile TotalCharged,
    EnergyMetricTile Distance,
    EnergyMetricTile Efficiency,
    EnergyMetricTile Co2Saved,
    EnergyMetricTile Period,

    // Section 3 — daily energy usage area chart (GlassPanel15)
    string DailyEnergyTitle,
    IReadOnlyList<ChartSeries> DailyEnergySeries,
    bool HasDailyEnergy,
    string NoDailyEnergyMessage,

    // Section 4 — daily distance + efficiency bar charts (GlassPanel16/17)
    string DailyDistanceTitle,
    IReadOnlyList<ChartSeries> DailyDistanceSeries,
    bool HasDailyDistance,
    string NoDailyDistanceMessage,
    string DailyEfficiencyTitle,
    IReadOnlyList<ChartSeries> DailyEfficiencySeries,
    bool HasDailyEfficiency,
    string NoEfficiencyMessage,

    // Section 5 — efficiency metrics (GlassPanel18 + three sub-cards 19/20/21)
    string EfficiencyMetricsTitle,
    EnergyEfficiencyTile EfficiencyCard,
    EnergyEfficiencyTile Co2Card,
    EnergyEfficiencyTile AvgPerDayCard,

    // Section 6 — daily energy history table (GlassPanel22)
    string DailyHistoryTitle,
    IReadOnlyList<EnergyHistoryColumn> HistoryColumns,
    IReadOnlyList<EnergyHistoryRowDisplay> HistoryRows,
    bool HasHistory,
    string HistoryEmptyMessage,
    string HistoryTableEmptyMessage,

    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="EnergyFlowModel"/> to its <see cref="EnergyFlowDisplay"/> — the native port
/// of the render logic in web/src/features/battery/pages/EnergyFlowPage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names (the web uses the English string as the i18next key);
/// SI quantities format at the display boundary through <see cref="UnitFormatters"/> (web <c>useUnits</c>) and
/// counts through <see cref="NumberFormatting"/> (web <c>fmtNumber</c>), so the C# output matches the web truth.
/// Every chrome string is resolved on every projection so the i18n contract holds in every data state. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class EnergyFlowProjection
{
    /// <summary>The per-day row limit the web requests; mirrored for parity with the trailing-window query.</summary>
    public const int DefaultDays = 7;

    private const string SocUnit = "%";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and unit preference.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference, applied at the render boundary (web <c>useUnits</c>).</param>
    /// <param name="now">The reference instant for date formatting.</param>
    public static EnergyFlowDisplay Project(EnergyFlowModel model, ILocalizer localizer, UnitPref units, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        // ── Header (web PageContainer title + subtitle) — resolved on every projection ─────────────────────
        string title = localizer.GetString("Energy Flow", "Energy Flow");
        string subtitle = localizer.GetString("Power distribution and energy analysis", "Power distribution and energy analysis");
        string retryLabel = localizer.GetString("Retry", "Retry");

        // ── Section / metric chrome (resolved unconditionally so every key is recorded in every state) ─────
        string flowDiagramTitle = localizer.GetString("Energy Flow Diagram", "Energy Flow Diagram");
        string gridLabel = localizer.GetString("Grid", "Grid");
        string chargingLabel = localizer.GetString("Charging", "Charging");
        string batteryLabel = localizer.GetString("Battery", "Battery");
        string drivingLabel = localizer.GetString("Driving", "Driving");
        string motorLabel = localizer.GetString("Motor", "Motor");
        string noLiveData = localizer.GetString("No live data", "No live data");
        string naLabel = localizer.GetString("N/A", "N/A");
        string dcLabel = localizer.GetString("DC Power", "DC Power");
        string acLabel = localizer.GetString("AC Power", "AC Power");
        string hvacLabel = localizer.GetString("HVAC", "HVAC");
        string accessoriesLabel = localizer.GetString("Accessories", "Accessories");
        string kwLabel = localizer.GetString("kW", "kW");
        string kwhLabel = localizer.GetString("kWh", "kWh");

        string totalEnergyLabel = localizer.GetString("Total Energy", "Total Energy");
        string totalChargedLabel = localizer.GetString("Total Charged", "Total Charged");
        string distanceLabel = localizer.GetString("Distance", "Distance");
        string efficiencyLabel = localizer.GetString("Efficiency", "Efficiency");
        string co2Label = localizer.GetString("CO\u2082 Saved", "CO\u2082 Saved");
        string periodLabel = localizer.GetString("Period", "Period");
        string kgLabel = localizer.GetString("kg", "kg");
        string daysLabel = localizer.GetString("days", "days");

        string dailyEnergyTitle = localizer.GetString("Daily Energy Usage", "Daily Energy Usage");
        string energySeriesLabel = localizer.GetString("Energy", "Energy");
        string dailyDistanceTitle = localizer.GetString("Daily Distance", "Daily Distance");
        string dailyEfficiencyTitle = localizer.GetString("Daily Efficiency", "Daily Efficiency");
        string efficiencyMetricsTitle = localizer.GetString("Efficiency Metrics", "Efficiency Metrics");
        string dailyHistoryTitle = localizer.GetString("Daily Energy History", "Daily Energy History");
        string dateHeader = localizer.GetString("Date", "Date");

        string excellentLabel = localizer.GetString("Excellent", "Excellent");
        string goodLabel = localizer.GetString("Good", "Good");
        string highLabel = localizer.GetString("High", "High");
        string noDataLabel = localizer.GetString("No Data", "No Data");
        string kgCo2Label = localizer.GetString("kg CO\u2082", "kg CO\u2082");
        string perDayLabel = localizer.GetString("per day", "per day");
        string avgPerDayLabel = localizer.GetString("Avg Energy/Day", "Avg Energy/Day");

        string noDailyEnergyMessage = localizer.GetString("No daily energy data available.", "No daily energy data available.");
        string noDailyDistanceMessage = localizer.GetString("No daily distance data available.", "No daily distance data available.");
        string noEfficiencyMessage = localizer.GetString("No efficiency data available.", "No efficiency data available.");
        string noEnergyRecords = localizer.GetString("No energy records found.", "No energy records found.");
        string noHistoryMessage = localizer.GetString("No energy history records available.", "No energy history records available.");
        string emptyTitle = localizer.GetString("No Data", "No Data");
        string emptyMessage = localizer.GetString(
            "No energy flow data available for this vehicle and time range.",
            "No energy flow data available for this vehicle and time range.");

        // ── State machine (web isLoading → !stats error/empty → success) ───────────────────────────────────
        EnergyFlowState state;
        if (model.Loading)
        {
            state = EnergyFlowState.Loading;
        }
        else if (model.HasError && !model.HasStats)
        {
            state = EnergyFlowState.Error;
        }
        else if (!model.HasStats)
        {
            state = EnergyFlowState.Empty;
        }
        else
        {
            state = EnergyFlowState.Success;
        }

        string loadFailed = localizer.GetString("Failed to load data", "Failed to load data");
        string errorText = state == EnergyFlowState.Error && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Section 1 — real-time flow diagram (always rendered in the success layout, web null-safe) ──────
        EnergyFlowReading flow = model.Flow;
        double chargePower = (flow.DcChargingPower ?? 0) + (flow.AcChargingPower ?? 0);
        double batterySoc = flow.Soc ?? 0;

        string? chargeState = string.IsNullOrWhiteSpace(flow.ChargeState) ? null : flow.ChargeState;
        bool chargeStateVisible = chargeState is not null;
        string chargeStateText = chargeState is null ? string.Empty : localizer.GetString(chargeState, chargeState);
        StatusKind chargeStateStatus = string.Equals(chargeState, "Charging", StringComparison.Ordinal)
            ? StatusKind.Success
            : StatusKind.Neutral;

        var chargingEdge = new EnergyFlowEdge(
            chargingLabel,
            $"{NumberFormatting.Format(Math.Abs(chargePower), units.Locale, 1)} {kwLabel}",
            Math.Abs(chargePower) > 0.01);

        bool energyRemainingVisible = flow.EnergyRemaining is not null;
        string energyRemainingText = energyRemainingVisible
            ? $"{NumberFormatting.Format(flow.EnergyRemaining!.Value, units.Locale, 1)} {kwhLabel}"
            : string.Empty;

        var drivingEdge = new EnergyFlowEdge(drivingLabel, naLabel, Active: false);

        var dcNode = new EnergyFlowNode(dcLabel, $"{NumberFormatting.Format(flow.DcChargingPower ?? 0, units.Locale, 1)} {kwLabel}");
        var acNode = new EnergyFlowNode(acLabel, $"{NumberFormatting.Format(flow.AcChargingPower ?? 0, units.Locale, 1)} {kwLabel}");

        // ── Section 2 — six historical summary tiles ───────────────────────────────────────────────────────
        EnergyStatsReading stats = model.Stats;
        string distanceUnit = UnitLabels.Label(units.Distance);
        string efficiencyUnit = $"Wh/{distanceUnit}";

        double avgEfficiency = EfficiencyForDisplay(stats.AvgEfficiencyWhPerM, units.Distance);
        double avgEnergyPerDay = stats.PeriodDays > 0 ? stats.TotalEnergyUsedWh / stats.PeriodDays : 0;

        var totalEnergyTile = new EnergyMetricTile(
            totalEnergyLabel, UnitFormatters.FormatEnergy(stats.TotalEnergyUsedWh, units), string.Empty, EnergyFlowRegistration.GlyphEnergy);
        var totalChargedTile = new EnergyMetricTile(
            totalChargedLabel, UnitFormatters.FormatEnergy(stats.TotalEnergyChargedWh, units), string.Empty, EnergyFlowRegistration.GlyphCharged);
        var distanceTile = new EnergyMetricTile(
            distanceLabel, UnitFormatters.FormatDistance(stats.TotalDistanceM, units), distanceUnit, EnergyFlowRegistration.GlyphDistance);
        var efficiencyTile = new EnergyMetricTile(
            efficiencyLabel, NumberFormatting.Format(avgEfficiency, units.Locale, 0), efficiencyUnit, EnergyFlowRegistration.GlyphEfficiency);
        var co2Tile = new EnergyMetricTile(
            co2Label, NumberFormatting.Format(stats.Co2SavedKg, units.Locale, 1), kgLabel, EnergyFlowRegistration.GlyphCo2);
        var periodTile = new EnergyMetricTile(
            periodLabel, NumberFormatting.Format(stats.PeriodDays, units.Locale, 0), daysLabel, EnergyFlowRegistration.GlyphPeriod);

        // ── Section 3/4 — chart series (SI values plotted, web parity) ─────────────────────────────────────
        IReadOnlyList<EnergyDailyEntry> daily = stats.DailyBreakdown;

        var energyPoints = new List<ChartPoint>(daily.Count);
        var distancePoints = new List<ChartPoint>(daily.Count);
        for (int i = 0; i < daily.Count; i++)
        {
            string dateLabel = FormatDate(daily[i].Date, now);
            energyPoints.Add(new ChartPoint(i, daily[i].EnergyWh, dateLabel));
            distancePoints.Add(new ChartPoint(i, daily[i].DistanceM, dateLabel));
        }

        var efficiencyPoints = new List<ChartPoint>();
        int effIndex = 0;
        foreach (var d in daily)
        {
            if (d.EfficiencyWhPerM > 0)
            {
                efficiencyPoints.Add(new ChartPoint(effIndex++, EfficiencyForDisplay(d.EfficiencyWhPerM, units.Distance), FormatDate(d.Date, now)));
            }
        }

        bool hasDailyEnergy = energyPoints.Count > 0;
        bool hasDailyDistance = distancePoints.Count > 0;
        bool hasDailyEfficiency = efficiencyPoints.Count > 0;

        IReadOnlyList<ChartSeries> energySeries = hasDailyEnergy
            ? new[] { new ChartSeries(energySeriesLabel, energyPoints) { Kind = ChartSeriesKind.Area, Role = ChartRole.Energy, Decimals = 0 } }
            : Array.Empty<ChartSeries>();
        IReadOnlyList<ChartSeries> distanceSeries = hasDailyDistance
            ? new[] { new ChartSeries($"{distanceLabel} ({distanceUnit})", distancePoints) { Kind = ChartSeriesKind.Bar, ColorIndex = 1, Decimals = 0 } }
            : Array.Empty<ChartSeries>();
        IReadOnlyList<ChartSeries> efficiencySeries = hasDailyEfficiency
            ? new[] { new ChartSeries(efficiencyUnit, efficiencyPoints) { Kind = ChartSeriesKind.Bar, Role = ChartRole.Temperature, Decimals = 0 } }
            : Array.Empty<ChartSeries>();

        // ── Section 5 — efficiency metrics sub-cards ───────────────────────────────────────────────────────
        double excellentThreshold = units.Distance == DistanceUnit.Km ? 150 : 240;
        double goodThreshold = units.Distance == DistanceUnit.Km ? 200 : 320;

        (string badgeText, StatusKind badgeStatus) = avgEfficiency switch
        {
            0.0 => (noDataLabel, StatusKind.Neutral),
            var v when v < excellentThreshold => (excellentLabel, StatusKind.Success),
            var v when v < goodThreshold => (goodLabel, StatusKind.Warning),
            _ => (highLabel, StatusKind.Danger),
        };

        var efficiencyCard = new EnergyEfficiencyTile(
            efficiencyUnit, NumberFormatting.Format(avgEfficiency, units.Locale, 0), badgeText, badgeStatus);
        var co2Card = new EnergyEfficiencyTile(
            co2Label, NumberFormatting.Format(stats.Co2SavedKg, units.Locale, 1), kgCo2Label, StatusKind.Success);
        var avgPerDayCard = new EnergyEfficiencyTile(
            avgPerDayLabel, UnitFormatters.FormatEnergy(avgEnergyPerDay, units), perDayLabel, StatusKind.Info);

        // ── Section 6 — daily energy history table ─────────────────────────────────────────────────────────
        var historyColumns = new EnergyHistoryColumn[]
        {
            new("date", dateHeader, IsNumeric: false),
            new("energy", energySeriesLabel, IsNumeric: true),
            new("distance", $"{distanceLabel} ({distanceUnit})", IsNumeric: true),
            new("efficiency", efficiencyUnit, IsNumeric: true),
        };

        var rows = new List<EnergyHistoryRowDisplay>(daily.Count);
        foreach (var d in SortByDateDescending(daily))
        {
            rows.Add(new EnergyHistoryRowDisplay(
                Key: d.Date ?? string.Empty,
                Date: FormatDate(d.Date, now),
                Energy: UnitFormatters.FormatEnergy(d.EnergyWh, units),
                Distance: UnitFormatters.FormatDistance(d.DistanceM, units),
                Efficiency: NumberFormatting.Format(EfficiencyRaw(d.EfficiencyWhPerM, units.Distance), units.Locale, 0)));
        }

        bool hasHistory = rows.Count > 0;

        return new EnergyFlowDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == EnergyFlowState.Loading,
            ShowError: state == EnergyFlowState.Error,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: state == EnergyFlowState.Empty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowContent: state == EnergyFlowState.Success,
            FlowDiagramTitle: flowDiagramTitle,
            ChargeStateVisible: chargeStateVisible,
            ChargeStateText: chargeStateText,
            ChargeStateStatus: chargeStateStatus,
            Grid: new EnergyFlowNode(gridLabel, string.Empty),
            ChargingEdge: chargingEdge,
            BatteryLabel: batteryLabel,
            BatterySoc: batterySoc,
            BatterySocUnit: SocUnit,
            EnergyRemainingVisible: energyRemainingVisible,
            EnergyRemainingText: energyRemainingText,
            DrivingEdge: drivingEdge,
            Motor: new EnergyFlowNode(motorLabel, noLiveData),
            DcPower: dcNode,
            AcPower: acNode,
            Hvac: new EnergyFlowNode(hvacLabel, naLabel),
            Accessories: new EnergyFlowNode(accessoriesLabel, naLabel),
            TotalEnergy: totalEnergyTile,
            TotalCharged: totalChargedTile,
            Distance: distanceTile,
            Efficiency: efficiencyTile,
            Co2Saved: co2Tile,
            Period: periodTile,
            DailyEnergyTitle: dailyEnergyTitle,
            DailyEnergySeries: energySeries,
            HasDailyEnergy: hasDailyEnergy,
            NoDailyEnergyMessage: noDailyEnergyMessage,
            DailyDistanceTitle: dailyDistanceTitle,
            DailyDistanceSeries: distanceSeries,
            HasDailyDistance: hasDailyDistance,
            NoDailyDistanceMessage: noDailyDistanceMessage,
            DailyEfficiencyTitle: dailyEfficiencyTitle,
            DailyEfficiencySeries: efficiencySeries,
            HasDailyEfficiency: hasDailyEfficiency,
            NoEfficiencyMessage: noEfficiencyMessage,
            EfficiencyMetricsTitle: efficiencyMetricsTitle,
            EfficiencyCard: efficiencyCard,
            Co2Card: co2Card,
            AvgPerDayCard: avgPerDayCard,
            DailyHistoryTitle: dailyHistoryTitle,
            HistoryColumns: historyColumns,
            HistoryRows: rows,
            HasHistory: hasHistory,
            HistoryEmptyMessage: noHistoryMessage,
            HistoryTableEmptyMessage: noEnergyRecords,
            AutomationName: title);
    }

    /// <summary>Web <c>avgEfficiency</c>: SI Wh/m → integer Wh/km or Wh/mi (rounded half away from zero).</summary>
    public static double EfficiencyForDisplay(double whPerMeter, DistanceUnit distance) =>
        Math.Round(EfficiencyRaw(whPerMeter, distance), MidpointRounding.AwayFromZero);

    /// <summary>Web per-row efficiency: SI Wh/m → Wh/km (×1000) or Wh/mi (×1609.344), unrounded.</summary>
    public static double EfficiencyRaw(double whPerMeter, DistanceUnit distance) =>
        distance == DistanceUnit.Km ? whPerMeter * 1000.0 : whPerMeter * 1609.344;

    /// <summary>Web <c>formatDateShort</c>: "MMM d" (or em dash for null / unparseable).</summary>
    public static string FormatDate(string? raw, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return DateTimeFormatting.DefaultEmptyDisplay;
        }

        if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed))
        {
            return DateTimeFormatting.Format(parsed, DateTimeVariant.Short, now);
        }

        return DateTimeFormatting.DefaultEmptyDisplay;
    }

    // Web sorts the history rows date-descending by default (useSortToggle('date','desc')).
    private static List<EnergyDailyEntry> SortByDateDescending(IReadOnlyList<EnergyDailyEntry> entries)
    {
        var copy = new List<EnergyDailyEntry>(entries);
        copy.Sort(static (a, b) => string.Compare(b.Date, a.Date, StringComparison.Ordinal));
        return copy;
    }
}

/// <summary>
/// Canonical metadata for the <c>EnergyFlowPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/battery/pages/EnergyFlowPage.tsx</c> (route <c>/energy-flow</c>, nav name <c>EnergyFlow</c>).
/// </summary>
public static class EnergyFlowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyFlowPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>EnergyFlow</c>).</summary>
    public const string RouteName = "EnergyFlow";

    /// <summary>The generated OpenAPI operation id for the real-time flow read (web <c>useEnergyFlow</c>).</summary>
    public const string OperationFlow = "get_api_v1_vehicles_vehicleID_energy_flow";

    /// <summary>The generated OpenAPI operation id for the historical energy rollup (web stats query).</summary>
    public const string OperationStats = "get_api_v1_vehicles_vehicleID_energy";

    /// <summary>The Segoe Fluent Icons glyph for the empty state (web <c>Zap</c> icon).</summary>
    public const string EmptyGlyph = "\uE945"; // Power / energy

    /// <summary>Total-energy accent glyph (web <c>Zap</c>).</summary>
    public const string GlyphEnergy = "\uE945";

    /// <summary>Total-charged accent glyph (web <c>Plug</c>).</summary>
    public const string GlyphCharged = "\uEC4C"; // Power plug

    /// <summary>Distance accent glyph (web <c>Car</c>).</summary>
    public const string GlyphDistance = "\uE804"; // Car / vehicle

    /// <summary>Efficiency accent glyph (web <c>Gauge</c>).</summary>
    public const string GlyphEfficiency = "\uE9D9"; // Speed / gauge

    /// <summary>CO₂-saved accent glyph (web <c>Leaf</c>).</summary>
    public const string GlyphCo2 = "\uE909"; // World / eco

    /// <summary>Period accent glyph (web <c>Calendar</c>).</summary>
    public const string GlyphPeriod = "\uE787"; // Calendar

    /// <summary>The localized page title (web <c>t('Energy Flow')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Energy Flow", "Energy Flow");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>EnergyFlowPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, SOC, charge state or energy
/// value — so a diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class EnergyFlowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyFlowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyFlowPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }

    private const string Slug = EnergyFlowRegistration.Slug;
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers shared by the EnergyFlow parsers — mirrors the sibling
/// feature-view helpers. Unwraps the platform <c>{data:…}</c> envelope and coerces numbers / strings without
/// throwing on missing or mistyped fields.
/// </summary>
internal static class EnergyFlowJson
{
    public static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            return data;
        }

        return root;
    }

    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static double? Double(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}
