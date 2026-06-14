using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>FleetComparePage</c>'s UI-thread-free logic — the roster + per-vehicle
/// JSON parse adapters (vehicles / state / stats / cost / monthly), the side-by-side projection (status cards,
/// the winner-highlighted lifetime table with SI→display conversion, the merged monthly-distance and
/// drives-per-month series, the key highlights), the state-holder view-model's per-state transitions (loading /
/// content / single-vehicle / error / offline) plus its auto-select and reprojection-on-selection logic, the
/// registration metadata, the PII-safe diagnostics, and the page string-key coverage. Mirrors the web spec
/// (web/src/features/analytics/pages/FleetComparePage.tsx).
/// </summary>
public sealed class FleetComparePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the page renders (web key names) — the 43 declared parity strings.</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "comparison.avgEfficiency", "comparison.avgSpeed", "comparison.banner.toPeriodCta",
        "comparison.banner.toPeriodPrefix", "comparison.battery", "comparison.batteryDiff",
        "comparison.chargeSessions", "comparison.chargingCost", "comparison.co2Diff", "comparison.co2Saved",
        "comparison.costDiff", "comparison.currentStatus", "comparison.drivesPerMonth",
        "comparison.drivesPerMonth.aria", "comparison.efficiencyDiff", "comparison.highlights",
        "comparison.lifetimeNote", "comparison.locked", "comparison.metric", "comparison.monthlyDistance",
        "comparison.monthlyDistance.aria", "comparison.noDrivesData", "comparison.noMonthlyData",
        "comparison.range", "comparison.regenRatio", "comparison.security", "comparison.selectVehicle",
        "comparison.sentry", "comparison.status", "comparison.subtitle", "comparison.temp", "comparison.title",
        "comparison.topSpeed", "comparison.totalDistance", "comparison.totalDrives", "comparison.totalEnergy",
        "comparison.unknown", "comparison.unlocked", "comparison.vehicleA", "comparison.vehicleB",
        "fleetCompare.singleVehicle.body", "fleetCompare.singleVehicle.cta", "fleetCompare.singleVehicle.title",
    ];

    // ---- Parse adapters ------------------------------------------------------------

    [Fact]
    public void ParseVehicles_reads_roster_rows()
    {
        const string json = """
        [{"id":1,"display_name":"Model 3","vin":"VIN1","model":"Model 3","trim_badging":"Performance","state":"online"},
         {"id":2,"vin":"VIN2","model":"Model Y","state":"asleep"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var refs = FleetCompareData.ParseVehicles(doc.RootElement);

        Assert.Equal(2, refs.Count);
        Assert.Equal(1, refs[0].Id);
        Assert.Equal("Model 3", refs[0].Name);
        Assert.Equal("Performance", refs[0].Trim);
        Assert.Equal("online", refs[0].State);
        Assert.Equal("VIN2", refs[1].Name); // display_name || vin
    }

    [Fact]
    public void ParseVehicles_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total":0}""");
        Assert.Empty(FleetCompareData.ParseVehicles(doc.RootElement));
    }

    [Fact]
    public void ParseState_reads_state_envelope()
    {
        const string json = """
        {"state":{"vehicle_id":1,"battery_level":72,"rated_range":320000,"inside_temp":21.5,"outside_temp":9,"is_locked":true,"sentry_mode":true,"state":"online"},"live":true}
        """;
        using var doc = JsonDocument.Parse(json);

        var state = FleetCompareData.ParseState(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(72, state!.BatteryLevel);
        Assert.Equal(320000, state.RatedRangeMeters);
        Assert.Equal(21.5, state.InsideTempC);
        Assert.Equal(9, state.OutsideTempC);
        Assert.True(state.IsLocked);
        Assert.True(state.SentryMode);
        Assert.Equal("online", state.VehicleState);
    }

    [Fact]
    public void ParseState_reads_top_level_fallback_shape()
    {
        using var doc = JsonDocument.Parse("""{"battery_level":40,"rated_range":150000}""");
        var state = FleetCompareData.ParseState(doc.RootElement);
        Assert.NotNull(state);
        Assert.Equal(40, state!.BatteryLevel);
    }

    [Fact]
    public void ParseState_returns_null_without_usable_state()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        Assert.Null(FleetCompareData.ParseState(doc.RootElement));
    }

    [Fact]
    public void ParseStats_reads_snake_case_fields()
    {
        const string json = """
        {"total_drives":120,"total_distance_km":3450.5,"avg_efficiency_wh_km":152,"avg_speed_kmh":48,"top_speed_kmh":135,"regen_ratio":0.23,"co2_saved_kg":410}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = FleetCompareData.ParseStats(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(120, stats!.TotalDrives);
        Assert.Equal(3450.5, stats.TotalDistanceKm);
        Assert.Equal(152, stats.AvgEfficiencyWhKm);
        Assert.Equal(48, stats.AvgSpeedKmh);
        Assert.Equal(135, stats.TopSpeedKmh);
        Assert.Equal(0.23, stats.RegenRatio);
        Assert.Equal(410, stats.Co2SavedKg);
    }

    [Fact]
    public void ParseCost_reads_tco_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_cost":612.4,"total_wh":4500000,"total_sessions":88}""");
        var cost = FleetCompareData.ParseCost(doc.RootElement);
        Assert.NotNull(cost);
        Assert.Equal(612.4, cost!.TotalChargingCost);
        Assert.Equal(4500000, cost.TotalWh);
        Assert.Equal(88, cost.TotalSessions);
    }

    [Fact]
    public void ParseMonthly_unwraps_months_envelope()
    {
        const string json = """
        {"vehicle_id":1,"months":[{"year_month":"2026-01","total_km":300,"drive_count":12},{"year_month":"2026-02","total_km":250,"drive_count":9}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var months = FleetCompareData.ParseMonthly(doc.RootElement);

        Assert.Equal(2, months.Count);
        Assert.Equal("2026-01", months[0].YearMonth);
        Assert.Equal(300, months[0].TotalKm);
        Assert.Equal(12, months[0].DriveCount);
    }

    // ---- Projection: status cards --------------------------------------------------

    [Fact]
    public void Projection_status_card_formats_locked_online_vehicle()
    {
        var data = TwoVehicleData();
        var display = FleetCompareProjection.Project(data, 1, 2, UnitPref.Metric, Localizer);

        var card = display.CardA;
        Assert.True(card.HasVehicle);
        Assert.True(card.IsOnline);
        Assert.True(card.HasBattery);
        Assert.Equal(StatusKind.Success, card.BatteryTier); // 72% > 50
        Assert.Equal("72%", card.BatteryText);
        Assert.Equal(0.72, card.BatteryFraction, 3);
        Assert.True(card.IsLocked);
        Assert.Equal(StatusKind.Success, card.SecurityTier);
        Assert.True(card.SentryOn);
        Assert.Contains("km", card.RangeText);
        Assert.Equal("online", card.StatusText);
    }

    [Fact]
    public void Projection_status_card_handles_unlocked_offline_vehicle()
    {
        var data = TwoVehicleData();
        var display = FleetCompareProjection.Project(data, 1, 2, UnitPref.Metric, Localizer);

        var card = display.CardB;
        Assert.True(card.HasVehicle);
        Assert.False(card.IsOnline);
        Assert.False(card.IsLocked);
        Assert.Equal(StatusKind.Danger, card.SecurityTier);
        Assert.Equal(StatusKind.Warning, card.BatteryTier); // 30% (>20, <=50)
    }

    [Fact]
    public void Projection_unselected_side_renders_select_vehicle_card()
    {
        var data = TwoVehicleData();
        var display = FleetCompareProjection.Project(data, 1, null, UnitPref.Metric, Localizer);
        Assert.False(display.CardB.HasVehicle);
        Assert.Equal("Vehicle B", display.NameB);
    }

    [Theory]
    [InlineData(70, StatusKind.Success)]
    [InlineData(30, StatusKind.Warning)]
    [InlineData(10, StatusKind.Danger)]
    public void BatteryTier_follows_web_ladder(double level, StatusKind expected) =>
        Assert.Equal(expected, FleetCompareProjection.BatteryTier(level));

    // ---- Projection: comparison table ----------------------------------------------

    [Fact]
    public void Projection_builds_ten_comparison_rows()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        Assert.Equal(10, display.Rows.Count);
    }

    [Fact]
    public void Projection_total_drives_higher_wins_for_a()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        var row = FindRow(display, "Total Drives");
        Assert.True(row.IsWinnerA);  // 120 > 60
        Assert.False(row.IsWinnerB);
    }

    [Fact]
    public void Projection_charging_cost_lower_wins_for_b()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        var row = FindRow(display, "Charging Cost");
        Assert.False(row.IsWinnerA); // A 600 vs B 300 → lower wins → B
        Assert.True(row.IsWinnerB);
    }

    [Fact]
    public void Projection_neutral_metric_has_no_winner()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        var row = FindRow(display, "Avg Speed");
        Assert.False(row.IsWinnerA);
        Assert.False(row.IsWinnerB);
    }

    [Fact]
    public void Projection_converts_distance_and_efficiency_for_imperial()
    {
        var metric = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        Assert.Equal("3,000 km", FindRow(metric, "Total Distance").ValueA);
        Assert.Equal("150 Wh/km", FindRow(metric, "Avg Efficiency").ValueA);

        var imperial = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Imperial, Localizer);
        Assert.Contains("mi", FindRow(imperial, "Total Distance").ValueA);
        Assert.Contains("Wh/mi", FindRow(imperial, "Avg Efficiency").ValueA);
    }

    [Fact]
    public void Winner_ties_on_equal_values()
    {
        Assert.Equal((false, false), FleetCompareProjection.Winner(5, 5, FleetCompareWinnerSemantic.Higher));
        Assert.Equal((true, false), FleetCompareProjection.Winner(6, 5, FleetCompareWinnerSemantic.Higher));
        Assert.Equal((false, true), FleetCompareProjection.Winner(6, 5, FleetCompareWinnerSemantic.Lower));
    }

    // ---- Projection: charts, highlights, options -----------------------------------

    [Fact]
    public void Projection_builds_merged_month_series_for_both_vehicles()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);

        Assert.True(display.MonthlyHasData);
        Assert.Equal(2, display.MonthlySeries.Count);
        Assert.All(display.MonthlySeries, s => Assert.Equal(2, s.Points.Count)); // 2 aligned months
        Assert.True(display.DrivesHasData);
        Assert.Equal(2, display.DrivesSeries.Count);
        Assert.Equal(ChartSeriesKind.Line, display.MonthlySeries[0].Kind);
        Assert.Equal(ChartSeriesKind.Bar, display.DrivesSeries[0].Kind);
    }

    [Fact]
    public void Projection_charts_empty_without_monthly_data()
    {
        var data = new FleetCompareData(
            [Vehicle(1, "A", "online"), Vehicle(2, "B", "online")],
            [Bundle(1, State(50, true, true, "online"), Stats(), Cost(), []), Bundle(2, State(50, false, false, "online"), Stats(), Cost(), [])]);

        var display = FleetCompareProjection.Project(data, 1, 2, UnitPref.Metric, Localizer);
        Assert.False(display.MonthlyHasData);
        Assert.False(display.DrivesHasData);
    }

    [Fact]
    public void Projection_builds_four_highlights()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);
        Assert.Equal(4, display.Highlights.Count);
        Assert.Contains(display.Highlights, h => h.Value.Contains("vs", StringComparison.Ordinal));
    }

    [Fact]
    public void Projection_cross_disables_selected_vehicle_in_opposite_list()
    {
        var display = FleetCompareProjection.Project(TwoVehicleData(), 1, 2, UnitPref.Metric, Localizer);

        // OptionsA disables the B selection (id 2); OptionsB disables the A selection (id 1).
        Assert.Contains(display.OptionsA, o => o.Id == 2 && o.Disabled);
        Assert.Contains(display.OptionsB, o => o.Id == 1 && o.Disabled);
        Assert.Contains(display.OptionsA, o => o.Id == 1 && !o.Disabled);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loaded_auto_selects_first_two_vehicles()
    {
        using var vm = NewViewModel(Loaded(TwoVehicleData()));
        await vm.LoadAsync();

        Assert.Equal(FleetCompareState.Content, vm.State);
        Assert.Equal(1, vm.SelectedA);
        Assert.Equal(2, vm.SelectedB);
        Assert.True(vm.HasContent);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_single_vehicle_shows_single_vehicle_state()
    {
        var data = new FleetCompareData([Vehicle(1, "Solo", "online")], [Bundle(1, State(60, true, false, "online"), Stats(), Cost(), [])]);
        using var vm = NewViewModel(Loaded(data));
        await vm.LoadAsync();

        Assert.Equal(FleetCompareState.SingleVehicle, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_empty_response_shows_single_vehicle_state()
    {
        using var vm = NewViewModel(RepositoryResult<FleetCompareData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(FleetCompareState.SingleVehicle, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_shows_error()
    {
        using var vm = NewViewModel(RepositoryResult<FleetCompareData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FleetCompareState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_with_chip()
    {
        var offline = RepositoryResult<FleetCompareData>.OfflineCached(TwoVehicleData(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));
        using var vm = NewViewModel(offline);
        await vm.LoadAsync();

        Assert.Equal(FleetCompareState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_select_reprojects_without_refetch()
    {
        using var vm = NewViewModel(Loaded(ThreeVehicleData()));
        await vm.LoadAsync();
        Assert.Equal(1, vm.SelectedA);

        vm.SelectA(3);
        Assert.Equal(3, vm.SelectedA);
        Assert.Equal(3, vm.Display.SelectedA);
        Assert.Equal(1, vm.Attempts); // no extra load
    }

    [Fact]
    public async Task ViewModel_select_ignores_value_equal_to_other_side()
    {
        using var vm = NewViewModel(Loaded(ThreeVehicleData()));
        await vm.LoadAsync(); // A=1, B=2

        vm.SelectA(2); // equals B → ignored
        Assert.Equal(1, vm.SelectedA);
    }

    // ---- Registration / diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_metadata()
    {
        Assert.Equal("FleetCompare", FleetCompareRegistration.RouteName);
        Assert.Equal("vehicle-comparison", FleetCompareRegistration.RoutePath);
        Assert.Equal("FleetComparePage", FleetCompareRegistration.Slug);
        Assert.Equal("vehicles", FleetCompareRegistration.VehiclesRoute);
        Assert.Equal("period-compare", FleetCompareRegistration.PeriodCompareRoute);
        Assert.Equal("Fleet Comparison", FleetCompareRegistration.Title(Localizer));
        Assert.Equal("Compare two vehicles side by side", FleetCompareRegistration.Subtitle(Localizer));
        Assert.Contains("second vehicle", FleetCompareRegistration.SingleVehicleTitle(Localizer), StringComparison.Ordinal);
        Assert.Equal("Manage vehicles", FleetCompareRegistration.SingleVehicleCta(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FleetCompareDiagnostics(lines.Add);
        diagnostics.RecordViewOpened();
        Assert.Equal("view.opened slug=FleetComparePage", Assert.Single(lines));
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void ResultMapper_is_identity()
    {
        var raw = RepositoryResult<FleetCompareData>.Loaded(TwoVehicleData(), Now);
        Assert.Same(raw, FleetCompareResultMapper.Map(raw));
    }

    // ---- String coverage -----------------------------------------------------------

    [Fact]
    public void RequiredStringKeys_count_is_43_and_unique()
    {
        Assert.Equal(43, RequiredStringKeys.Length);
        Assert.Equal(43, new HashSet<string>(RequiredStringKeys).Count);
    }

    [Fact]
    public void Projection_and_registration_record_data_layer_string_keys()
    {
        var recorder = new RecordingLocalizer();

        // Cover the status-card branches: locked/online (v1), unlocked/offline (v2), unknown status (v3 blank
        // state) and the select-vehicle empty card (no B selection); plus both efficiency-unit branches.
        FleetCompareProjection.Project(CoverageData(), 1, 2, UnitPref.Metric, recorder);
        FleetCompareProjection.Project(CoverageData(), 3, null, UnitPref.Metric, recorder);
        FleetCompareProjection.Project(CoverageData(), 1, 2, UnitPref.Imperial, recorder);

        FleetCompareRegistration.Title(recorder);
        FleetCompareRegistration.Subtitle(recorder);
        FleetCompareRegistration.SingleVehicleTitle(recorder);
        FleetCompareRegistration.SingleVehicleBody(recorder);
        FleetCompareRegistration.SingleVehicleCta(recorder);

        foreach (var key in DataLayerStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    /// <summary>The subset of the 43 parity strings the headless data layer (projection + registration) emits.</summary>
    private static readonly string[] DataLayerStringKeys =
    [
        "comparison.title", "comparison.subtitle", "comparison.vehicleA", "comparison.vehicleB",
        "comparison.selectVehicle", "comparison.locked", "comparison.unlocked", "comparison.unknown",
        "comparison.totalDrives", "comparison.totalDistance", "comparison.avgEfficiency", "comparison.avgSpeed",
        "comparison.topSpeed", "comparison.regenRatio", "comparison.co2Saved", "comparison.chargingCost",
        "comparison.totalEnergy", "comparison.chargeSessions", "comparison.batteryDiff",
        "comparison.efficiencyDiff", "comparison.costDiff", "comparison.co2Diff",
        "fleetCompare.singleVehicle.title", "fleetCompare.singleVehicle.body", "fleetCompare.singleVehicle.cta",
    ];

    // ---- Builders ------------------------------------------------------------------

    private static FleetCompareVehicleRef Vehicle(long id, string name, string state) =>
        new(id, name, "Model 3", "Performance", state);

    private static FleetCompareVehicleState State(double battery, bool locked, bool sentry, string state) =>
        new(battery, 320000, 21.5, 9, locked, sentry, state);

    private static FleetCompareStats Stats(
        double drives = 120, double distKm = 3000, double effWhKm = 150, double avgKmh = 48,
        double topKmh = 135, double regen = 0.2, double co2 = 400) =>
        new(drives, distKm, effWhKm, avgKmh, topKmh, regen, co2);

    private static FleetCompareCost Cost(double cost = 600, double wh = 4_000_000, double sessions = 80) =>
        new(cost, wh, sessions);

    private static FleetCompareVehicleBundle Bundle(
        long id,
        FleetCompareVehicleState? state,
        FleetCompareStats? stats,
        FleetCompareCost? cost,
        IReadOnlyList<FleetCompareMonthlyBucket> monthly) =>
        new(id, state, stats, cost, monthly);

    private static IReadOnlyList<FleetCompareMonthlyBucket> Months(double km, double drives) =>
    [
        new("2026-01", km, drives),
        new("2026-02", km / 2, drives / 2),
    ];

    private static FleetCompareData TwoVehicleData() => new(
        [Vehicle(1, "Model 3", "online"), Vehicle(2, "Model Y", "asleep")],
        [
            Bundle(1, State(72, true, true, "online"), Stats(drives: 120), Cost(cost: 600), Months(300, 12)),
            Bundle(2, State(30, false, false, "asleep"), Stats(drives: 60), Cost(cost: 300), Months(200, 8)),
        ]);

    private static FleetCompareData ThreeVehicleData() => new(
        [Vehicle(1, "A", "online"), Vehicle(2, "B", "online"), Vehicle(3, "C", "online")],
        [
            Bundle(1, State(72, true, false, "online"), Stats(), Cost(), Months(300, 12)),
            Bundle(2, State(50, false, false, "online"), Stats(), Cost(), Months(200, 8)),
            Bundle(3, State(40, true, false, "online"), Stats(), Cost(), Months(150, 6)),
        ]);

    private static FleetCompareData CoverageData() => new(
        [Vehicle(1, "Model 3", "online"), Vehicle(2, "Model Y", "asleep"), new(3, "", "Model S", "", "")],
        [
            Bundle(1, State(72, true, true, "online"), Stats(), Cost(), Months(300, 12)),
            Bundle(2, State(30, false, false, "asleep"), Stats(), Cost(), Months(200, 8)),
            Bundle(3, State(40, true, false, ""), Stats(), Cost(), Months(150, 6)),
        ]);

    private static FleetCompareRow FindRow(FleetCompareDisplay display, string metric)
    {
        foreach (var row in display.Rows)
        {
            if (row.Metric == metric)
            {
                return row;
            }
        }

        throw new Xunit.Sdk.XunitException($"row '{metric}' not found");
    }

    private static RepositoryResult<FleetCompareData> Loaded(FleetCompareData data) =>
        RepositoryResult<FleetCompareData>.Loaded(data, Now);

    private static FleetComparePageViewModel NewViewModel(params RepositoryResult<FleetCompareData>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeSource(params RepositoryResult<FleetCompareData>[] emissions) : IFleetCompareSource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetCompareData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
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
