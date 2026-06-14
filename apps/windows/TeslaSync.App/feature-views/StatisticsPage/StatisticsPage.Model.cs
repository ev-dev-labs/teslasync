using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="StatisticsPageViewModel"/> can be in — the native
/// union of the loading / success / empty / error branches the web <c>StatisticsPage</c> renders through
/// <c>PageContainer</c> (web/src/features/analytics/pages/StatisticsPage.tsx). The page-level branch is driven by
/// the primary <c>period-stats</c> read (web <c>statsQuery</c>): <see cref="Empty"/> models <c>!stats</c> (no
/// vehicle selected or no period-stats object), and <see cref="Error"/> models the query's <c>error</c> channel.
/// The four secondary reads (battery health, mileage, state summary, fleet comparison) keep their own in-content
/// empty affordances; none collapses a region silently.
/// </summary>
public enum StatisticsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A resolved period-stats object — render every panel + chart (web success).</summary>
    Loaded,

    /// <summary>No vehicle resolved or no period-stats object — render the full-page empty affordance (web <c>!stats</c>).</summary>
    Empty,

    /// <summary>The period-stats request failed with no cached snapshot — render the failure surface + retry.</summary>
    Error,
}

/// <summary>
/// The primary vehicle identity the page reads from <c>GET /vehicles</c> (web <c>useSelectedVehicle</c>,
/// defaulting to the first vehicle). Only the <see cref="Id"/> used to scope the per-vehicle reads is kept;
/// parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
public sealed record StatisticsVehicle(long Id)
{
    /// <summary>Resolve the first usable vehicle id from a <c>GET /vehicles</c> array (web <c>vehicles?.[0]</c>).</summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <returns>The first object entry's id projected, or <see langword="null"/> when none is available.</returns>
    public static StatisticsVehicle? FromVehiclesArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                long id = StatisticsJson.Long(element, "id") ?? 0;
                if (id > 0)
                {
                    return new StatisticsVehicle(id);
                }
            }
        }

        return null;
    }
}

/// <summary>
/// The lifetime period rollup from <c>GET /analytics/period-stats</c> (web <c>statsQuery</c> →
/// <c>PeriodStats</c>). Field names mirror the Go API's snake_case JSON tags. Distance is SI kilometres and
/// efficiency is SI Wh/km — both converted to the user's display unit only at projection time.
/// </summary>
/// <param name="TotalDistanceKm">Lifetime distance, SI kilometres (web <c>total_distance</c>).</param>
/// <param name="TotalDrives">Total number of drives (web <c>total_drives</c>).</param>
/// <param name="EnergyUsedKwh">Total energy consumed, kWh (web <c>energy_used</c>).</param>
/// <param name="AvgEfficiencyWhKm">Average efficiency, SI Wh/km (web <c>avg_efficiency</c>).</param>
/// <param name="TotalCost">Total cost in the user's currency (web <c>total_cost</c>).</param>
/// <param name="Co2SavedKg">CO₂ saved, kilograms (web <c>co2_saved</c>).</param>
public sealed record StatisticsPeriodStats(
    double TotalDistanceKm,
    long TotalDrives,
    double EnergyUsedKwh,
    double AvgEfficiencyWhKm,
    double TotalCost,
    double Co2SavedKg)
{
    /// <summary>Project a <c>GET /analytics/period-stats</c> JSON object, or <see langword="null"/> for a non-object body.</summary>
    /// <param name="element">The parsed period-stats body.</param>
    /// <returns>The parsed period stats, or <see langword="null"/> (web <c>!stats</c>) when the body is not an object.</returns>
    public static StatisticsPeriodStats? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new StatisticsPeriodStats(
            TotalDistanceKm: StatisticsJson.Double(element, "total_distance") ?? 0,
            TotalDrives: StatisticsJson.Long(element, "total_drives") ?? 0,
            EnergyUsedKwh: StatisticsJson.Double(element, "energy_used") ?? 0,
            AvgEfficiencyWhKm: StatisticsJson.Double(element, "avg_efficiency") ?? 0,
            TotalCost: StatisticsJson.Double(element, "total_cost") ?? 0,
            Co2SavedKg: StatisticsJson.Double(element, "co2_saved") ?? 0);
    }
}

/// <summary>
/// The battery-health rollup from <c>GET /analytics/battery-health</c> (web <c>useBatteryHealthAnalytics</c>).
/// Only the five fields the panel renders are kept (web <c>current_soh</c>, <c>estimated_capacity</c>,
/// <c>degradation_rate_yr</c>, <c>total_cycles</c>, <c>battery_age_months</c>).
/// </summary>
/// <param name="CurrentSoh">State of health, percent (web <c>current_soh</c>).</param>
/// <param name="EstimatedCapacityKwh">Estimated usable capacity, kWh (web <c>estimated_capacity</c>).</param>
/// <param name="DegradationRateYr">Annual degradation rate, percent/yr (web <c>degradation_rate_yr</c>).</param>
/// <param name="TotalCycles">Total charge cycles (web <c>total_cycles</c>).</param>
/// <param name="BatteryAgeMonths">Battery age in months (web <c>battery_age_months</c>).</param>
public sealed record StatisticsBatteryHealth(
    double CurrentSoh,
    double EstimatedCapacityKwh,
    double DegradationRateYr,
    long TotalCycles,
    long BatteryAgeMonths)
{
    /// <summary>Project a <c>GET /analytics/battery-health</c> JSON object, or <see langword="null"/> for a non-object body.</summary>
    /// <param name="element">The parsed battery-health body.</param>
    /// <returns>The parsed rollup, or <see langword="null"/> (web <c>batteryHealth</c> falsy) for a non-object body.</returns>
    public static StatisticsBatteryHealth? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new StatisticsBatteryHealth(
            CurrentSoh: StatisticsJson.Double(element, "current_soh") ?? 0,
            EstimatedCapacityKwh: StatisticsJson.Double(element, "estimated_capacity") ?? 0,
            DegradationRateYr: StatisticsJson.Double(element, "degradation_rate_yr") ?? 0,
            TotalCycles: StatisticsJson.Long(element, "total_cycles") ?? 0,
            BatteryAgeMonths: StatisticsJson.Long(element, "battery_age_months") ?? 0);
    }
}

/// <summary>
/// The mileage rollup from <c>GET /mileage/stats</c> (web <c>useMileageStats</c>). Only the three fields the
/// summary renders are kept; distances are SI kilometres (web <c>lifetime_km</c>, <c>last_30d_km</c>).
/// </summary>
/// <param name="LifetimeKm">Lifetime distance, SI kilometres (web <c>lifetime_km</c>).</param>
/// <param name="Last30dKm">Trailing-30-day distance, SI kilometres (web <c>last_30d_km</c>).</param>
/// <param name="DriveCountLifetime">Lifetime drive count (web <c>drive_count_lifetime</c>).</param>
public sealed record StatisticsMileage(
    double LifetimeKm,
    double Last30dKm,
    long DriveCountLifetime)
{
    /// <summary>Project a <c>GET /mileage/stats</c> JSON object, or <see langword="null"/> for a non-object body.</summary>
    /// <param name="element">The parsed mileage body.</param>
    /// <returns>The parsed rollup, or <see langword="null"/> (web <c>mileage</c> falsy) for a non-object body.</returns>
    public static StatisticsMileage? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new StatisticsMileage(
            LifetimeKm: StatisticsJson.Double(element, "lifetime_km") ?? 0,
            Last30dKm: StatisticsJson.Double(element, "last_30d_km") ?? 0,
            DriveCountLifetime: StatisticsJson.Long(element, "drive_count_lifetime") ?? 0);
    }
}

/// <summary>
/// One state-distribution bucket from <c>GET /vehicle-states/summary</c> (web <c>useStateSummary</c>). The web
/// reads minutes via a <c>totalMin ?? total_min</c> fallback; the null-tolerant reader mirrors that by trying
/// the snake key then the camelCase alias.
/// </summary>
/// <param name="State">The FSM state name (web <c>state</c>).</param>
/// <param name="TotalMinutes">Minutes spent in that state (web <c>totalMin ?? total_min</c>).</param>
public sealed record StatisticsStateSlice(string State, double TotalMinutes)
{
    /// <summary>Project a <c>GET /vehicle-states/summary</c> array into a tolerant slice list (web <c>safeArray</c>).</summary>
    /// <param name="root">The parsed summary body.</param>
    /// <returns>The parsed slices in source order; empty when the body is not an array.</returns>
    public static IReadOnlyList<StatisticsStateSlice> FromArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var slices = new List<StatisticsStateSlice>();
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? state = StatisticsJson.String(element, "state");
            if (string.IsNullOrWhiteSpace(state))
            {
                continue;
            }

            double minutes = StatisticsJson.Double(element, "total_min") ?? 0;
            slices.Add(new StatisticsStateSlice(state.Trim(), minutes));
        }

        return slices;
    }
}

/// <summary>
/// One per-vehicle comparison row from <c>GET /analytics/fleet</c> (web <c>useFleetAnalytics</c> →
/// <c>fleet.vehicle_comparison</c>). Distance is SI kilometres and energy is kWh (web <c>distance</c>,
/// <c>energy</c>); the display name falls back to <c>Vehicle {id}</c> when absent (web <c>v.name ?? `Vehicle ${v.id}`</c>).
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
/// <param name="Name">The display name, or <see langword="null"/> when absent (web <c>name</c>).</param>
/// <param name="DistanceKm">Window distance, SI kilometres (web <c>distance</c>).</param>
/// <param name="EnergyKwh">Window energy, kWh (web <c>energy</c>).</param>
public sealed record StatisticsComparison(long Id, string? Name, double DistanceKm, double EnergyKwh)
{
    /// <summary>Project a <c>GET /analytics/fleet</c> object into its <c>vehicle_comparison</c> rows (web fleet hook).</summary>
    /// <param name="root">The parsed fleet body.</param>
    /// <returns>The parsed comparison rows in source order; empty when none are present.</returns>
    public static IReadOnlyList<StatisticsComparison> FromFleet(JsonElement root)
    {
        var array = StatisticsJson.Array(root, "vehicle_comparison");
        if (array is null)
        {
            return [];
        }

        var rows = new List<StatisticsComparison>();
        foreach (var element in array.Value.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            rows.Add(new StatisticsComparison(
                Id: StatisticsJson.Long(element, "id") ?? 0,
                Name: StatisticsJson.String(element, "name"),
                DistanceKm: StatisticsJson.Double(element, "distance") ?? 0,
                EnergyKwh: StatisticsJson.Double(element, "energy") ?? 0));
        }

        return rows;
    }
}

/// <summary>
/// The resolved reading cached by the source: the primary <see cref="PeriodStats"/> (nullable; its presence is
/// the page-level success/empty discriminator, web <c>!stats</c>) plus the four secondary reads
/// (<see cref="BatteryHealth"/>, <see cref="Mileage"/>, <see cref="States"/>, <see cref="Comparisons"/>) that
/// each render their own in-content empty state. Serialized to the cache as JSON so the cache-then-network read
/// round-trips losslessly.
/// </summary>
/// <param name="PeriodStats">The lifetime period rollup, or <see langword="null"/> when none resolved.</param>
/// <param name="BatteryHealth">The battery-health rollup, or <see langword="null"/> when absent.</param>
/// <param name="Mileage">The mileage rollup, or <see langword="null"/> when absent.</param>
/// <param name="States">The state-distribution slices (empty when absent).</param>
/// <param name="Comparisons">The per-vehicle comparison rows (empty when absent).</param>
public sealed record StatisticsSnapshot(
    StatisticsPeriodStats? PeriodStats,
    StatisticsBatteryHealth? BatteryHealth,
    StatisticsMileage? Mileage,
    IReadOnlyList<StatisticsStateSlice> States,
    IReadOnlyList<StatisticsComparison> Comparisons)
{
    /// <summary>The "nothing resolved" snapshot — the parse / loading fallback.</summary>
    public static StatisticsSnapshot Empty { get; } = new(null, null, null, [], []);

    /// <summary>True when the primary period-stats object resolved (web <c>stats</c> truthy → page success).</summary>
    [JsonIgnore]
    public bool HasData => PeriodStats is not null;
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of one web <c>&lt;MetricCard&gt;</c>. Holds a
/// stable <see cref="Key"/> (for parity assertions), the localized <see cref="Label"/>, the already-formatted
/// <see cref="Value"/>, the token brush key for the accent rail and a Narrator automation name. Pure data.
/// </summary>
/// <param name="Key">Stable identity used by the view + parity tests.</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted display value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="AutomationName">The composed "label: value" Narrator name.</param>
public sealed record StatisticsMetric(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected pie slice for the state-distribution chart — the native analogue of one web
/// <c>&lt;Cell&gt;</c>. <see cref="Percentage"/> is the rounded share (0..100) the web computes; the
/// <see cref="ColorIndex"/> is the categorical palette slot the native pie colours by.
/// </summary>
/// <param name="Name">The state name (web slice <c>name</c>).</param>
/// <param name="Percentage">The rounded share of total minutes, 0..100 (web slice <c>value</c>).</param>
/// <param name="ColorIndex">The categorical palette index for the wedge.</param>
public sealed record StatisticsSlice(string Name, double Percentage, int ColorIndex);

/// <summary>
/// One projected comparison bar pair for the vehicle-comparison chart — the native analogue of one web
/// <c>compData</c> row. Distance is already converted to the display unit and rounded (web
/// <c>Math.round(fromKm(v.distance))</c>); energy is rounded kWh (web <c>Math.round(v.energy)</c>).
/// </summary>
/// <param name="Name">The vehicle label (web <c>v.name ?? `Vehicle ${v.id}`</c>).</param>
/// <param name="Distance">The display-unit distance, rounded (web <c>distance</c>).</param>
/// <param name="Energy">The energy in kWh, rounded (web <c>energy</c>).</param>
public sealed record StatisticsComparisonBar(string Name, double Distance, double Energy);

/// <summary>
/// The fully projected, render-ready view of the page — the native analogue of everything the web component
/// computes before returning JSX. Holds the localized header, the eight period tiles, the battery-health group
/// (gauge + four tiles or its empty message), the state-distribution chart group, the mileage group (four tiles
/// or its empty message), the vehicle-comparison chart group and the page-level empty / failure labels. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record StatisticsDisplay(
    StatisticsState State,
    string Title,
    string Subtitle,
    string AutomationName,
    IReadOnlyList<StatisticsMetric> PeriodMetrics,
    string BatteryHealthTitle,
    bool HasBattery,
    double GaugeValue,
    string GaugeLabel,
    string GaugeUnit,
    IReadOnlyList<StatisticsMetric> BatteryMetrics,
    string NoBatteryMessage,
    string StateDistributionTitle,
    string StateDistributionAria,
    IReadOnlyList<StatisticsSlice> StateSlices,
    string NoStatesMessage,
    string MileageTitle,
    bool HasMileage,
    IReadOnlyList<StatisticsMetric> MileageMetrics,
    string NoMileageMessage,
    string VehicleComparisonTitle,
    string VehicleComparisonAria,
    string DistanceSeriesName,
    string EnergySeriesName,
    IReadOnlyList<StatisticsComparisonBar> Comparisons,
    string SingleVehicleMessage,
    string NoDataTitle,
    string NoDataMessage,
    string ErrorText,
    string RetryText)
{
    /// <summary>True when the loading skeleton should be shown (web <c>isLoading</c>).</summary>
    [JsonIgnore]
    public bool ShowLoading => State == StatisticsState.Loading;

    /// <summary>True when the failure surface should be shown (web query <c>error</c>).</summary>
    [JsonIgnore]
    public bool ShowError => State == StatisticsState.Error;

    /// <summary>True when the full-page empty affordance should be shown (web <c>!stats</c>).</summary>
    [JsonIgnore]
    public bool ShowEmpty => State == StatisticsState.Empty;

    /// <summary>True when the content region (all panels + charts) should be shown (web success).</summary>
    [JsonIgnore]
    public bool ShowContent => State == StatisticsState.Loaded;

    /// <summary>True when the state-distribution chart has at least one slice (web <c>stateData.length &gt; 0</c>).</summary>
    [JsonIgnore]
    public bool HasStates => StateSlices.Count > 0;

    /// <summary>True when the comparison chart has more than one vehicle (web <c>compData.length &gt; 1</c>).</summary>
    [JsonIgnore]
    public bool HasComparison => Comparisons.Count > 1;
}

/// <summary>
/// Pure projection from a raw <see cref="StatisticsSnapshot"/> to the <see cref="StatisticsDisplay"/> — the
/// native port of everything the web component renders. SI is converted to the user's display unit here (and
/// only here, web <c>fromKm</c> / <c>whPerKmToDisplay</c>); every label resolves through the i18n facade with
/// the same web key names.
/// </summary>
public static class StatisticsProjection
{
    /// <summary>Accent rail brush for web <c>color="cyan"</c> tiles.</summary>
    public const string CyanAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Accent rail brush for web <c>color="green"</c> tiles.</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent rail brush for web <c>color="amber"</c> tiles.</summary>
    public const string AmberAccentBrushKey = "TsColorWarningBrush";

    /// <summary>Accent rail brush for web <c>color="red"</c> tiles.</summary>
    public const string RedAccentBrushKey = "TsColorDangerBrush";

    /// <summary>Accent rail brush for web <c>color="purple"</c> tiles.</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    /// <summary>1 mile = 1.609344 km exactly (web <c>KM_PER_MILE</c>), used for the Wh/km→Wh/mi efficiency rescale.</summary>
    public const double KmPerMile = 1.609344;

    private const double MetersPerKm = 1000.0;
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="snapshot"/> in <paramref name="state"/> using the user's units + currency.</summary>
    /// <param name="snapshot">The resolved reading.</param>
    /// <param name="state">The lifecycle state to render.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="currencySymbol">The currency symbol for cost tiles (web <c>useFormatting()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static StatisticsDisplay Project(
        StatisticsSnapshot snapshot,
        StatisticsState state,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        DistanceUnit distanceUnit = units.Distance;
        string distanceLabel = UnitLabels.Label(distanceUnit);
        string efficiencyUnit = distanceUnit == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

        return new StatisticsDisplay(
            State: state,
            Title: localizer.GetString("statistics.title", "Statistics"),
            Subtitle: localizer.GetString("statistics.subtitle", "Lifetime vehicle statistics and records"),
            AutomationName: localizer.GetString("statistics.title", "Statistics"),
            PeriodMetrics: ProjectPeriodMetrics(snapshot.PeriodStats, distanceUnit, distanceLabel, efficiencyUnit, symbol, localizer),
            BatteryHealthTitle: localizer.GetString("statistics.batteryHealth", "Battery Health"),
            HasBattery: snapshot.BatteryHealth is not null,
            GaugeValue: snapshot.BatteryHealth is { } health ? Math.Round(health.CurrentSoh) : 0,
            GaugeLabel: localizer.GetString("statistics.health", "Health"),
            GaugeUnit: "%",
            BatteryMetrics: ProjectBatteryMetrics(snapshot.BatteryHealth, localizer),
            NoBatteryMessage: localizer.GetString("statistics.noBattery", "No battery health data available"),
            StateDistributionTitle: localizer.GetString("statistics.stateDistribution", "State Distribution"),
            StateDistributionAria: localizer.GetString("statistics.stateDistribution.aria", "Vehicle state distribution pie chart"),
            StateSlices: ProjectStateSlices(snapshot.States),
            NoStatesMessage: localizer.GetString("statistics.noStates", "No state distribution data"),
            MileageTitle: localizer.GetString("statistics.mileage", "Mileage Summary"),
            HasMileage: snapshot.Mileage is not null,
            MileageMetrics: ProjectMileageMetrics(snapshot.Mileage, distanceUnit, distanceLabel, localizer),
            NoMileageMessage: localizer.GetString("statistics.noMileage", "No mileage data available"),
            VehicleComparisonTitle: localizer.GetString("statistics.vehicleComparison", "Vehicle Comparison"),
            VehicleComparisonAria: localizer.GetString(
                "statistics.vehicleComparison.aria",
                "Distance and energy bar chart comparing all vehicles in the fleet"),
            DistanceSeriesName: $"{localizer.GetString("statistics.distance", "Distance")} ({distanceLabel})",
            EnergySeriesName: localizer.GetString("statistics.energy", "Energy (kWh)"),
            Comparisons: ProjectComparisons(snapshot.Comparisons, distanceUnit),
            SingleVehicleMessage: localizer.GetString("statistics.singleVehicle", "Add more vehicles to compare"),
            NoDataTitle: localizer.GetString("statistics.noData", "No Data"),
            NoDataMessage: localizer.GetString("statistics.noDataMsg", "No statistics available for this vehicle."),
            ErrorText: localizer.GetString("error.loadFailed", "Failed to load data"),
            RetryText: localizer.GetString("common.retry", "Retry"));
    }

    private static IReadOnlyList<StatisticsMetric> ProjectPeriodMetrics(
        StatisticsPeriodStats? stats,
        DistanceUnit distanceUnit,
        string distanceLabel,
        string efficiencyUnit,
        string symbol,
        ILocalizer localizer)
    {
        var s = stats ?? new StatisticsPeriodStats(0, 0, 0, 0, 0, 0);

        double avgDriveDistanceKm = s.TotalDrives > 0 ? s.TotalDistanceKm / s.TotalDrives : 0;
        double effDisplay = distanceUnit == DistanceUnit.Mi ? s.AvgEfficiencyWhKm * KmPerMile : s.AvgEfficiencyWhKm;

        string totalDistance = $"{ScalarFormatters.FormatNumber(FromKm(s.TotalDistanceKm, distanceUnit), 0)} {distanceLabel}";
        string totalDrives = ScalarFormatters.FormatNumber(s.TotalDrives, 0);
        string totalEnergy = $"{ScalarFormatters.FormatNumber(s.EnergyUsedKwh, 2)} kWh";
        string totalCost = ScalarFormatters.FormatCurrency(s.TotalCost, symbol, 0);
        string co2Saved = $"{ScalarFormatters.FormatNumber(s.Co2SavedKg, 2)} kg";
        string avgDriveDistance = $"{ScalarFormatters.FormatNumber(FromKm(avgDriveDistanceKm, distanceUnit), 2)} {distanceLabel}";
        string avgEfficiency = $"{ScalarFormatters.FormatNumber(effDisplay, 2)} {efficiencyUnit}";
        string costPerKm = s.TotalDistanceKm > 0
            ? ScalarFormatters.FormatCurrency(s.TotalCost / s.TotalDistanceKm, symbol, 3)
            : EmDash;

        return
        [
            Metric("totalDistance", localizer.GetString("statistics.totalDistance", "Total Distance"), totalDistance, CyanAccentBrushKey),
            Metric("totalDrives", localizer.GetString("statistics.totalDrives", "Total Drives"), totalDrives, GreenAccentBrushKey),
            Metric("totalEnergy", localizer.GetString("statistics.totalEnergy", "Total Energy"), totalEnergy, AmberAccentBrushKey),
            Metric("totalCost", localizer.GetString("statistics.totalCost", "Total Cost"), totalCost, RedAccentBrushKey),
            Metric("co2Saved", localizer.GetString("statistics.co2Saved", "CO\u2082 Saved"), co2Saved, GreenAccentBrushKey),
            Metric("avgDriveDistance", localizer.GetString("statistics.avgDriveDistance", "Avg Drive Distance"), avgDriveDistance, CyanAccentBrushKey),
            Metric("avgEfficiency", localizer.GetString("statistics.avgEfficiency", "Avg Efficiency"), avgEfficiency, GreenAccentBrushKey),
            Metric("costPerKm", localizer.GetString("statistics.costPerKm", "Cost per km"), costPerKm, AmberAccentBrushKey),
        ];
    }

    private static IReadOnlyList<StatisticsMetric> ProjectBatteryMetrics(StatisticsBatteryHealth? health, ILocalizer localizer)
    {
        var h = health ?? new StatisticsBatteryHealth(0, 0, 0, 0, 0);

        string capacity = $"{ScalarFormatters.FormatNumber(h.EstimatedCapacityKwh, 1)} kWh";
        string degradation = $"{ScalarFormatters.FormatNumber(h.DegradationRateYr, 2)}%/yr";
        string cycles = ScalarFormatters.FormatNumber(h.TotalCycles, 0);
        string age = $"{ScalarFormatters.FormatNumber(h.BatteryAgeMonths, 0)} mo";

        return
        [
            Metric("capacity", localizer.GetString("statistics.capacity", "Capacity"), capacity, CyanAccentBrushKey),
            Metric("degradation", localizer.GetString("statistics.degradation", "Degradation"), degradation, AmberAccentBrushKey),
            Metric("cycles", localizer.GetString("statistics.cycles", "Cycles"), cycles, PurpleAccentBrushKey),
            Metric("age", localizer.GetString("statistics.age", "Age"), age, GreenAccentBrushKey),
        ];
    }

    private static IReadOnlyList<StatisticsMetric> ProjectMileageMetrics(
        StatisticsMileage? mileage,
        DistanceUnit distanceUnit,
        string distanceLabel,
        ILocalizer localizer)
    {
        var m = mileage ?? new StatisticsMileage(0, 0, 0);
        double dailyAvgKm = m.Last30dKm / 30.0;

        string totalMileage = $"{ScalarFormatters.FormatNumber(FromKm(m.LifetimeKm, distanceUnit), 0)} {distanceLabel}";
        string dailyAvg = $"{ScalarFormatters.FormatNumber(FromKm(dailyAvgKm, distanceUnit), 2)} {distanceLabel}";
        string drives = ScalarFormatters.FormatNumber(m.DriveCountLifetime, 0);
        string yearly = $"{ScalarFormatters.FormatNumber(FromKm(dailyAvgKm * 365.0, distanceUnit), 0)} {distanceLabel}";

        return
        [
            Metric("totalMileage", localizer.GetString("statistics.totalMileage", "Total Distance"), totalMileage, CyanAccentBrushKey),
            Metric("dailyAvg", localizer.GetString("statistics.dailyAvg", "Daily Average (30d)"), dailyAvg, GreenAccentBrushKey),
            Metric("totalDrives", localizer.GetString("statistics.totalDrives", "Total Drives"), drives, PurpleAccentBrushKey),
            Metric("yearlyProjection", localizer.GetString("statistics.yearlyProjection", "Yearly Projection"), yearly, AmberAccentBrushKey),
        ];
    }

    private static List<StatisticsSlice> ProjectStateSlices(IReadOnlyList<StatisticsStateSlice> slices)
    {
        if (slices.Count == 0)
        {
            return [];
        }

        double total = 0;
        foreach (var slice in slices)
        {
            total += slice.TotalMinutes;
        }

        double denominator = Math.Max(total, 1);
        var projected = new List<StatisticsSlice>(slices.Count);
        for (var i = 0; i < slices.Count; i++)
        {
            double percentage = Math.Round(slices[i].TotalMinutes / denominator * 100);
            projected.Add(new StatisticsSlice(slices[i].State, percentage, i));
        }

        return projected;
    }

    private static List<StatisticsComparisonBar> ProjectComparisons(
        IReadOnlyList<StatisticsComparison> comparisons,
        DistanceUnit distanceUnit)
    {
        if (comparisons.Count == 0)
        {
            return [];
        }

        var bars = new List<StatisticsComparisonBar>(comparisons.Count);
        foreach (var row in comparisons)
        {
            string name = string.IsNullOrWhiteSpace(row.Name)
                ? string.Format(CultureInfo.CurrentCulture, "Vehicle {0}", row.Id)
                : row.Name.Trim();
            double distance = Math.Round(FromKm(row.DistanceKm, distanceUnit));
            double energy = Math.Round(row.EnergyKwh);
            bars.Add(new StatisticsComparisonBar(name, distance, energy));
        }

        return bars;
    }

    private static double FromKm(double km, DistanceUnit to) => UnitConverters.DistanceFromSi(km * MetersPerKm, to);

    private static StatisticsMetric Metric(string key, string label, string value, string accentBrushKey) =>
        new(key, label, value, accentBrushKey, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Canonical registry metadata for the Statistics surface — the native mirror of the web route entry (route
/// <c>/statistics</c>, nav name <c>Statistics</c>, group Analytics). The shell page factory binds this surface
/// under the same route name; the source uses the operation ids + window helpers below.
/// </summary>
public static class StatisticsRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("Statistics", …)).</summary>
    public const string RouteName = "Statistics";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "statistics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StatisticsPage";

    /// <summary>The shared cache key for the assembled statistics snapshot.</summary>
    public const string CacheKey = "analytics:statistics";

    /// <summary>The generated operation id for the primary period-stats read (web <c>/analytics/period-stats</c>).</summary>
    public const string PeriodStatsOperation = "get_api_v1_analytics_period_stats";

    /// <summary>The generated operation id for the mileage read (web <c>/mileage/stats</c>).</summary>
    public const string MileageStatsOperation = "get_api_v1_mileage_stats";

    /// <summary>The generated operation id for the state-summary read (web <c>/vehicle-states/summary</c>).</summary>
    public const string StateSummaryOperation = "get_api_v1_vehicle_states_summary";

    /// <summary>The trailing fleet window in days the page requests (web <c>useFleetAnalytics(30, startDate)</c>).</summary>
    public const int FleetWindowDays = 30;

    /// <summary>The fleet-comparison lookback in days the default <c>from</c> uses (web <c>defaultStart</c> = one year).</summary>
    private const int FleetStartDaysAgo = 365;

    /// <summary>Glyph for the page-level empty state (web <c>BarChart3</c> lucide icon).</summary>
    public const string NoDataGlyph = "\uE9D2";

    /// <summary>Glyph for the no-battery in-content empty state (web <c>Battery</c> lucide icon).</summary>
    public const string NoBatteryGlyph = "\uE83F";

    /// <summary>Glyph for the no-states in-content empty state (web <c>Clock</c> lucide icon).</summary>
    public const string NoStatesGlyph = "\uE823";

    /// <summary>Glyph for the no-mileage / single-vehicle in-content empty state (web <c>Car</c> lucide icon).</summary>
    public const string NoMileageGlyph = "\uE804";

    /// <summary>The default fleet-comparison <c>start</c> bound (web <c>defaultStart</c>: today minus one year, yyyy-MM-dd).</summary>
    /// <param name="now">The current instant the window is computed against.</param>
    /// <returns>The ISO date string the fleet read passes as <c>start</c>.</returns>
    public static string FleetStartDate(DateTimeOffset now) =>
        now.UtcDateTime.Date.AddDays(-FleetStartDaysAgo).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The localized page title (web <c>statistics.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("statistics.title", "Statistics");
    }
}

/// <summary>
/// PII-safe diagnostics for the Statistics surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or vehicle name — so a diagnostics
/// line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class StatisticsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public StatisticsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatisticsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatisticsRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="StatisticsPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="StatisticsSnapshot"/> readings — the native analogue of the
/// web page's <c>statsQuery</c> + <c>useBatteryHealthAnalytics</c> + <c>useMileageStats</c> +
/// <c>useStateSummary</c> + <c>useFleetAnalytics</c> composition. The view never performs HTTP itself.
/// </summary>
public interface IStatisticsSource
{
    /// <summary>Stream the cache-then-network statistics snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<StatisticsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IStatisticsSource"/> — resolves every read to the empty snapshot (the page-level empty
/// state). The shell uses this until a host wires the generated-client-backed <see cref="StatisticsSource"/>.
/// </summary>
public sealed class EmptyStatisticsSource : IStatisticsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyStatisticsSource Instance { get; } = new();

    private EmptyStatisticsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<StatisticsSnapshot>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<StatisticsSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>Null-tolerant JSON readers shared by the statistics parsers (snake_case primary, camelCase fallback).</summary>
internal static class StatisticsJson
{
    public static JsonElement? Array(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object
        && Property(parent, name) is { ValueKind: JsonValueKind.Array } array
            ? array
            : null;

    public static string? String(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        return v?.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    }

    public static long? Long(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetInt64(out var n) => n,
            JsonValueKind.Number when e.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(e.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static double? Double(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(e.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static JsonElement? Property(JsonElement parent, string snakeName)
    {
        if (parent.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (parent.TryGetProperty(snakeName, out var direct))
        {
            return direct;
        }

        string camel = ToCamelCase(snakeName);
        return !string.Equals(camel, snakeName, StringComparison.Ordinal) && parent.TryGetProperty(camel, out var alt)
            ? alt
            : null;
    }

    private static string ToCamelCase(string snake)
    {
        if (!snake.Contains('_', StringComparison.Ordinal))
        {
            return snake;
        }

        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return snake;
        }

        var builder = new System.Text.StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            string part = parts[i];
            builder.Append(char.ToUpperInvariant(part[0]));
            if (part.Length > 1)
            {
                builder.Append(part, 1, part.Length - 1);
            }
        }

        return builder.ToString();
    }
}
