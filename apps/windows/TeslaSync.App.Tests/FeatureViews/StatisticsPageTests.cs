using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatisticsPage</c> surface's Microsoft.UI-free logic — the tolerant parsers
/// (vehicle roster, period stats, battery health, mileage, state summary, fleet comparison), the SI→display
/// projection (distance / efficiency / cost / mileage with units + currency), the four-state view-model matrix
/// (loading / loaded / empty / error) and the registration metadata. The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="StatisticsDisplay"/> flags asserted
/// here. Mirrors the web spec (web/src/features/analytics/pages/StatisticsPage.tsx).
/// </summary>
public sealed class StatisticsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 32 statistics.* i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "statistics.age", "statistics.avgDriveDistance", "statistics.avgEfficiency", "statistics.batteryHealth",
        "statistics.capacity", "statistics.co2Saved", "statistics.costPerKm", "statistics.cycles",
        "statistics.dailyAvg", "statistics.degradation", "statistics.distance", "statistics.energy",
        "statistics.health", "statistics.mileage", "statistics.noBattery", "statistics.noData",
        "statistics.noDataMsg", "statistics.noMileage", "statistics.noStates", "statistics.singleVehicle",
        "statistics.stateDistribution", "statistics.stateDistribution.aria", "statistics.subtitle",
        "statistics.title", "statistics.totalCost", "statistics.totalDistance", "statistics.totalDrives",
        "statistics.totalEnergy", "statistics.totalMileage", "statistics.vehicleComparison",
        "statistics.vehicleComparison.aria", "statistics.yearlyProjection",
    ];

    private static StatisticsPeriodStats Period(
        double distanceKm = 1000,
        long drives = 40,
        double energyKwh = 234,
        double efficiencyWhKm = 150,
        double cost = 78,
        double co2 = 12.5) =>
        new(distanceKm, drives, energyKwh, efficiencyWhKm, cost, co2);

    private static StatisticsSnapshot Snapshot(
        StatisticsPeriodStats? period = null,
        StatisticsBatteryHealth? battery = null,
        StatisticsMileage? mileage = null,
        IReadOnlyList<StatisticsStateSlice>? states = null,
        IReadOnlyList<StatisticsComparison>? comparisons = null) =>
        new(period, battery, mileage, states ?? [], comparisons ?? []);

    private static StatisticsDisplay Project(StatisticsSnapshot snapshot, UnitPref? units = null, string symbol = "$") =>
        StatisticsProjection.Project(snapshot, StatisticsState.Loaded, units ?? UnitPref.Metric, symbol, Localizer);

    // ---- Vehicle parser ------------------------------------------------------------

    [Fact]
    public void Vehicle_picks_the_first_entry_with_a_positive_id()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"Garage Y"},{"id":9}]""");

        var vehicle = StatisticsVehicle.FromVehiclesArray(doc.RootElement);

        Assert.NotNull(vehicle);
        Assert.Equal(7, vehicle!.Id);
    }

    [Fact]
    public void Vehicle_is_null_for_an_empty_or_non_array_body()
    {
        using var empty = JsonDocument.Parse("[]");
        using var obj = JsonDocument.Parse("{}");

        Assert.Null(StatisticsVehicle.FromVehiclesArray(empty.RootElement));
        Assert.Null(StatisticsVehicle.FromVehiclesArray(obj.RootElement));
    }

    // ---- Period-stats parser -------------------------------------------------------

    [Fact]
    public void PeriodStats_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"total_distance":1234.5,"total_drives":42,"energy_used":456.7,"avg_efficiency":151,"total_cost":78.9,"co2_saved":33.3}
        """);

        var stats = StatisticsPeriodStats.FromJson(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(1234.5, stats!.TotalDistanceKm);
        Assert.Equal(42, stats.TotalDrives);
        Assert.Equal(456.7, stats.EnergyUsedKwh);
        Assert.Equal(151, stats.AvgEfficiencyWhKm);
        Assert.Equal(78.9, stats.TotalCost);
        Assert.Equal(33.3, stats.Co2SavedKg);
    }

    [Fact]
    public void PeriodStats_is_null_for_a_non_object_body()
    {
        using var array = JsonDocument.Parse("[]");
        Assert.Null(StatisticsPeriodStats.FromJson(array.RootElement));
    }

    // ---- Secondary parsers ---------------------------------------------------------

    [Fact]
    public void BatteryHealth_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"current_soh":91.6,"estimated_capacity":75,"degradation_rate_yr":2.5,"total_cycles":1234,"battery_age_months":18}
        """);

        var health = StatisticsBatteryHealth.FromJson(doc.RootElement);

        Assert.NotNull(health);
        Assert.Equal(91.6, health!.CurrentSoh);
        Assert.Equal(75, health.EstimatedCapacityKwh);
        Assert.Equal(2.5, health.DegradationRateYr);
        Assert.Equal(1234, health.TotalCycles);
        Assert.Equal(18, health.BatteryAgeMonths);
    }

    [Fact]
    public void Mileage_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""{"lifetime_km":5000,"last_30d_km":300,"drive_count_lifetime":200}""");

        var mileage = StatisticsMileage.FromJson(doc.RootElement);

        Assert.NotNull(mileage);
        Assert.Equal(5000, mileage!.LifetimeKm);
        Assert.Equal(300, mileage.Last30dKm);
        Assert.Equal(200, mileage.DriveCountLifetime);
    }

    [Fact]
    public void StateSlices_read_camelCase_and_snake_case_minutes()
    {
        using var camel = JsonDocument.Parse("""[{"state":"driving","totalMin":60},{"state":"parked","totalMin":40}]""");
        using var snake = JsonDocument.Parse("""[{"state":"driving","total_min":60}]""");

        var camelSlices = StatisticsStateSlice.FromArray(camel.RootElement);
        var snakeSlices = StatisticsStateSlice.FromArray(snake.RootElement);

        Assert.Equal(2, camelSlices.Count);
        Assert.Equal("driving", camelSlices[0].State);
        Assert.Equal(60, camelSlices[0].TotalMinutes);
        Assert.Equal(60, snakeSlices[0].TotalMinutes);
    }

    [Fact]
    public void StateSlices_are_empty_for_a_non_array_body()
    {
        using var obj = JsonDocument.Parse("{}");
        Assert.Empty(StatisticsStateSlice.FromArray(obj.RootElement));
    }

    [Fact]
    public void Comparisons_read_the_vehicle_comparison_array()
    {
        using var doc = JsonDocument.Parse("""
        {"vehicle_comparison":[{"id":1,"name":"Model 3","distance":1000,"energy":234},{"id":2,"distance":500,"energy":120}]}
        """);

        var rows = StatisticsComparison.FromFleet(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal("Model 3", rows[0].Name);
        Assert.Equal(1000, rows[0].DistanceKm);
        Assert.Null(rows[1].Name);
    }

    [Fact]
    public void Comparisons_are_empty_without_the_array()
    {
        using var doc = JsonDocument.Parse("""{"period_days":30}""");
        Assert.Empty(StatisticsComparison.FromFleet(doc.RootElement));
    }

    // ---- Projection: period panels -------------------------------------------------

    [Fact]
    public void Projection_emits_eight_period_panels_in_order()
    {
        var display = Project(Snapshot(Period()));

        Assert.Collection(
            display.PeriodMetrics,
            m => Assert.Equal("totalDistance", m.Key),
            m => Assert.Equal("totalDrives", m.Key),
            m => Assert.Equal("totalEnergy", m.Key),
            m => Assert.Equal("totalCost", m.Key),
            m => Assert.Equal("co2Saved", m.Key),
            m => Assert.Equal("avgDriveDistance", m.Key),
            m => Assert.Equal("avgEfficiency", m.Key),
            m => Assert.Equal("costPerKm", m.Key));
    }

    [Fact]
    public void Projection_assigns_the_web_period_accent_colours()
    {
        var d = Project(Snapshot(Period()));

        Assert.Equal(StatisticsProjection.CyanAccentBrushKey, Metric(d.PeriodMetrics, "totalDistance").AccentBrushKey);
        Assert.Equal(StatisticsProjection.GreenAccentBrushKey, Metric(d.PeriodMetrics, "totalDrives").AccentBrushKey);
        Assert.Equal(StatisticsProjection.AmberAccentBrushKey, Metric(d.PeriodMetrics, "totalEnergy").AccentBrushKey);
        Assert.Equal(StatisticsProjection.RedAccentBrushKey, Metric(d.PeriodMetrics, "totalCost").AccentBrushKey);
        Assert.Equal(StatisticsProjection.GreenAccentBrushKey, Metric(d.PeriodMetrics, "co2Saved").AccentBrushKey);
    }

    [Fact]
    public void Projection_converts_distance_to_metric_and_imperial()
    {
        var metric = Project(Snapshot(Period(distanceKm: 1000)), UnitPref.Metric);
        var imperial = Project(Snapshot(Period(distanceKm: 1000)), UnitPref.Imperial);

        Assert.Equal("1,000 km", Metric(metric.PeriodMetrics, "totalDistance").Value);
        Assert.Equal("621 mi", Metric(imperial.PeriodMetrics, "totalDistance").Value);
    }

    [Fact]
    public void Projection_rescales_efficiency_to_wh_per_mile_in_imperial()
    {
        var metric = Project(Snapshot(Period(efficiencyWhKm: 150)), UnitPref.Metric);
        var imperial = Project(Snapshot(Period(efficiencyWhKm: 150)), UnitPref.Imperial);

        Assert.Equal("150.00 Wh/km", Metric(metric.PeriodMetrics, "avgEfficiency").Value);
        Assert.Equal("241.40 Wh/mi", Metric(imperial.PeriodMetrics, "avgEfficiency").Value);
    }

    [Fact]
    public void Projection_formats_cost_and_cost_per_km()
    {
        var d = Project(Snapshot(Period(distanceKm: 1000, cost: 78)));

        Assert.Equal("$78", Metric(d.PeriodMetrics, "totalCost").Value);
        Assert.Equal("$0.078", Metric(d.PeriodMetrics, "costPerKm").Value);
    }

    [Fact]
    public void Projection_uses_em_dash_for_cost_per_km_without_distance()
    {
        var d = Project(Snapshot(Period(distanceKm: 0)));
        Assert.Equal("\u2014", Metric(d.PeriodMetrics, "costPerKm").Value);
    }

    [Fact]
    public void Projection_computes_average_drive_distance()
    {
        var d = Project(Snapshot(Period(distanceKm: 1000, drives: 40)));
        Assert.Equal("25.00 km", Metric(d.PeriodMetrics, "avgDriveDistance").Value);
    }

    [Fact]
    public void Projection_formats_energy_and_co2()
    {
        var d = Project(Snapshot(Period(energyKwh: 234, co2: 12.5)));
        Assert.Equal("234.00 kWh", Metric(d.PeriodMetrics, "totalEnergy").Value);
        Assert.Equal("12.50 kg", Metric(d.PeriodMetrics, "co2Saved").Value);
    }

    // ---- Projection: battery panel -------------------------------------------------

    [Fact]
    public void Projection_renders_the_battery_gauge_and_tiles()
    {
        var health = new StatisticsBatteryHealth(91.6, 75, 2.5, 1234, 18);
        var d = Project(Snapshot(Period(), battery: health));

        Assert.True(d.HasBattery);
        Assert.Equal(92, d.GaugeValue);
        Assert.Equal("75.0 kWh", Metric(d.BatteryMetrics, "capacity").Value);
        Assert.Equal("2.50%/yr", Metric(d.BatteryMetrics, "degradation").Value);
        Assert.Equal("1,234", Metric(d.BatteryMetrics, "cycles").Value);
        Assert.Equal("18 mo", Metric(d.BatteryMetrics, "age").Value);
    }

    [Fact]
    public void Projection_surfaces_the_no_battery_state()
    {
        var d = Project(Snapshot(Period(), battery: null));

        Assert.False(d.HasBattery);
        Assert.Equal("No battery health data available", d.NoBatteryMessage);
    }

    // ---- Projection: state distribution + mileage ----------------------------------

    [Fact]
    public void Projection_computes_state_distribution_percentages()
    {
        IReadOnlyList<StatisticsStateSlice> states =
        [
            new("driving", 60),
            new("parked", 40),
        ];
        var d = Project(Snapshot(Period(), states: states));

        Assert.True(d.HasStates);
        Assert.Collection(
            d.StateSlices,
            s => { Assert.Equal("driving", s.Name); Assert.Equal(60, s.Percentage); },
            s => { Assert.Equal("parked", s.Name); Assert.Equal(40, s.Percentage); });
    }

    [Fact]
    public void Projection_surfaces_the_no_states_state()
    {
        var d = Project(Snapshot(Period(), states: []));

        Assert.False(d.HasStates);
        Assert.Empty(d.StateSlices);
        Assert.Equal("No state distribution data", d.NoStatesMessage);
    }

    [Fact]
    public void Projection_renders_mileage_tiles()
    {
        var mileage = new StatisticsMileage(5000, 300, 200);
        var d = Project(Snapshot(Period(), mileage: mileage));

        Assert.True(d.HasMileage);
        Assert.Equal("5,000 km", Metric(d.MileageMetrics, "totalMileage").Value);
        Assert.Equal("10.00 km", Metric(d.MileageMetrics, "dailyAvg").Value);
        Assert.Equal("200", Metric(d.MileageMetrics, "totalDrives").Value);
        Assert.Equal("3,650 km", Metric(d.MileageMetrics, "yearlyProjection").Value);
    }

    [Fact]
    public void Projection_surfaces_the_no_mileage_state()
    {
        var d = Project(Snapshot(Period(), mileage: null));

        Assert.False(d.HasMileage);
        Assert.Equal("No mileage data available", d.NoMileageMessage);
    }

    // ---- Projection: vehicle comparison --------------------------------------------

    [Fact]
    public void Projection_requires_more_than_one_vehicle_to_compare()
    {
        IReadOnlyList<StatisticsComparison> one = [new(1, "A", 1000, 234)];
        IReadOnlyList<StatisticsComparison> two = [new(1, "A", 1000, 234), new(2, null, 500, 120)];

        Assert.False(Project(Snapshot(Period(), comparisons: one)).HasComparison);

        var d = Project(Snapshot(Period(), comparisons: two), UnitPref.Metric);
        Assert.True(d.HasComparison);
        Assert.Collection(
            d.Comparisons,
            b => { Assert.Equal("A", b.Name); Assert.Equal(1000, b.Distance); Assert.Equal(234, b.Energy); },
            b => { Assert.Equal("Vehicle 2", b.Name); Assert.Equal(500, b.Distance); });
    }

    [Fact]
    public void Projection_converts_comparison_distance_to_imperial()
    {
        IReadOnlyList<StatisticsComparison> two = [new(1, "A", 1000, 234), new(2, "B", 500, 120)];
        var d = Project(Snapshot(Period(), comparisons: two), UnitPref.Imperial);

        Assert.Equal(621, d.Comparisons[0].Distance);
        Assert.Equal("Distance (mi)", d.DistanceSeriesName);
    }

    // ---- Projection: strings -------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        StatisticsProjection.Project(StatisticsSnapshot.Empty, StatisticsState.Loaded, UnitPref.Metric, "$", recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- View-model: four-state matrix ---------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        using var vm = NewViewModel(RepositoryResult<StatisticsSnapshot>.Loaded(Snapshot(Period()), Now));

        Assert.Equal(StatisticsState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(StatisticsState.Loaded, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(8, vm.Display.PeriodMetrics.Count);
    }

    [Fact]
    public async Task ViewModel_classifies_a_no_data_snapshot_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<StatisticsSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(StatisticsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.False(vm.Display.ShowContent);
    }

    [Fact]
    public async Task ViewModel_treats_a_snapshot_without_period_stats_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<StatisticsSnapshot>.Loaded(StatisticsSnapshot.Empty, Now));

        await vm.LoadAsync();

        Assert.Equal(StatisticsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_failure()
    {
        using var vm = NewViewModel(
            RepositoryResult<StatisticsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(StatisticsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        using var vm = NewViewModel(RepositoryResult<StatisticsSnapshot>.Loaded(Snapshot(Period(distanceKm: 1000)), Now));

        await vm.LoadAsync();
        Assert.Equal("1,000 km", Metric(vm.Display.PeriodMetrics, "totalDistance").Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("621 mi", Metric(vm.Display.PeriodMetrics, "totalDistance").Value);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new StatisticsPageViewModel(
            new FakeStatisticsSource(), Localizer, diagnostics: new StatisticsDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=StatisticsPage", lines);
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_operations()
    {
        Assert.Equal("Statistics", StatisticsRegistration.RouteName);
        Assert.Equal("statistics", StatisticsRegistration.Route);
        Assert.Equal("get_api_v1_analytics_period_stats", StatisticsRegistration.PeriodStatsOperation);
        Assert.Equal("get_api_v1_mileage_stats", StatisticsRegistration.MileageStatsOperation);
        Assert.Equal("get_api_v1_vehicle_states_summary", StatisticsRegistration.StateSummaryOperation);
        Assert.Equal("Statistics", StatisticsRegistration.Title(Localizer));
    }

    [Fact]
    public void Registration_computes_the_one_year_fleet_start_window()
    {
        Assert.Equal("2025-06-12", StatisticsRegistration.FleetStartDate(Now));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static StatisticsMetric Metric(IReadOnlyList<StatisticsMetric> metrics, string key)
    {
        foreach (var metric in metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        throw new KeyNotFoundException(key);
    }

    private static StatisticsPageViewModel NewViewModel(params RepositoryResult<StatisticsSnapshot>[] emissions) =>
        new(new FakeStatisticsSource(emissions), Localizer, UnitPref.Metric, "$");

    private sealed class FakeStatisticsSource(params RepositoryResult<StatisticsSnapshot>[] emissions) : IStatisticsSource
    {
        public async IAsyncEnumerable<RepositoryResult<StatisticsSnapshot>> StreamAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
