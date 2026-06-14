using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PeriodComparePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/analytics/pages/PeriodComparePage.tsx), the tolerant period-stats / vehicles parsers, the
/// view-model's four-state matrix (loading / empty / error / success) and the generated-client feed's request
/// shaping (web <c>useVehicles</c> + the two <c>GET /analytics/period-stats</c> queries). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the <see cref="PeriodCompareDisplay"/>
/// flags asserted here.
/// </summary>
public sealed class PeriodComparePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 34 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "compare.allTime", "compare.avgEfficiency", "compare.banner.toFleetCta", "compare.banner.toFleetPrefix",
        "compare.change", "compare.chartTitle", "compare.co2Saved", "compare.declined", "compare.empty",
        "compare.energyUsed", "compare.higher", "compare.improved", "compare.insightCost", "compare.insightDistance",
        "compare.insightEfficiency", "compare.insights", "compare.last30", "compare.last7", "compare.last90",
        "compare.lastYear", "compare.less", "compare.lower", "compare.metric", "compare.more", "compare.pctChange",
        "compare.periodA", "compare.periodB", "compare.subtitle", "compare.tableTitle", "compare.title",
        "compare.totalCost", "compare.totalDistance", "compare.totalDrives", "compare.vehicle",
    ];

    private static PeriodStats StatsA() => new(
        TotalDistanceKm: 1000, TotalDrives: 50, EnergyUsedKwh: 300, AvgEfficiencyWhPerKm: 200, TotalCost: 120.5, Co2SavedKg: 120);

    private static PeriodStats StatsB() => new(
        TotalDistanceKm: 2000, TotalDrives: 80, EnergyUsedKwh: 500, AvgEfficiencyWhPerKm: 180, TotalCost: 200, Co2SavedKg: 240);

    private static IReadOnlyList<PeriodCompareVehicle> TwoVehicles() =>
    [
        new PeriodCompareVehicle(1, "Model 3", "VIN1"),
        new PeriodCompareVehicle(2, "Model Y", "VIN2"),
    ];

    private static PeriodCompareModel SuccessModel() => new(
        Vehicles: TwoVehicles(),
        SelectedVehicleId: 1,
        PeriodADays: 30,
        PeriodBDays: 90,
        StatsA: StatsA(),
        StatsB: StatsB(),
        IsLoading: false,
        HasError: false,
        ErrorDetail: null);

    // ---- i18n key coverage (all 34 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = PeriodCompareProjection.Project(SuccessModel(), recorder, UnitPref.Metric);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (including metric labels + insight direction words) are resolved on every projection
        // regardless of data state; visibility is gated separately.
        _ = PeriodCompareProjection.Project(PeriodCompareModel.Initial, recorder, UnitPref.Metric);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_first_query_in_flight()
    {
        var display = PeriodCompareProjection.Project(PeriodCompareModel.Initial, Localizer, UnitPref.Metric);

        Assert.Equal(PeriodCompareState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_vehicle_or_data()
    {
        var model = PeriodCompareModel.Initial with { IsLoading = false };
        var display = PeriodCompareProjection.Project(model, Localizer, UnitPref.Metric);

        Assert.Equal(PeriodCompareState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.Empty(display.Metrics);
    }

    [Fact]
    public void State_error_shows_banner_and_hides_content()
    {
        var model = PeriodCompareModel.Initial with { IsLoading = false, HasError = true, ErrorDetail = "network down" };
        var display = PeriodCompareProjection.Project(model, Localizer, UnitPref.Metric);

        Assert.Equal(PeriodCompareState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorBannerText);
    }

    [Fact]
    public void State_success_when_both_periods_present()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);

        Assert.Equal(PeriodCompareState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowEmpty);
    }

    // ---- Metric cards (web MetricCard ×6) ------------------------------------------

    [Fact]
    public void Metrics_project_six_cards_with_labels_values_and_deltas()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);

        Assert.Equal(6, display.Metrics.Count);

        var distance = display.Metrics[0];
        Assert.Equal("Total Distance", distance.Label);
        Assert.Equal("1,000.00 km", distance.ValueText);
        Assert.Equal("Period B: 2,000.00 km", distance.SubtitleText);
        Assert.Equal("-50.0%", distance.DeltaText);
        Assert.False(distance.DeltaPositive);

        Assert.Equal("Total Drives", display.Metrics[1].Label);
        Assert.Equal("50.00", display.Metrics[1].ValueText); // no unit suffix
        Assert.Equal("Avg Efficiency", display.Metrics[3].Label);
        Assert.Equal("200.00 Wh/km", display.Metrics[3].ValueText);
        Assert.Equal("120.50 $", display.Metrics[4].ValueText);
    }

    [Fact]
    public void Metrics_convert_distance_and_efficiency_to_imperial_units()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Imperial);

        // 1000 km -> 621.37 mi; efficiency label switches to Wh/mi.
        Assert.Equal("621.37 mi", display.Metrics[0].ValueText);
        Assert.EndsWith("Wh/mi", display.Metrics[3].ValueText);
    }

    // ---- Side-by-side bar chart ----------------------------------------------------

    [Fact]
    public void Chart_projects_two_series_over_six_metric_categories()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);

        Assert.Equal("Period A", display.ChartSeriesAName);
        Assert.Equal("Period B", display.ChartSeriesBName);
        Assert.Equal(6, display.ChartCategories.Count);
        Assert.Equal("Total Distance", display.ChartCategories[0]);
        Assert.Equal(1000, display.Metrics[0].ChartA);
        Assert.Equal(2000, display.Metrics[0].ChartB);
    }

    // ---- Comparison table (web DataTable) ------------------------------------------

    [Fact]
    public void Table_projects_six_rows_with_change_arrow_and_badge_tone()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);

        Assert.Equal(6, display.Rows.Count);

        var distance = display.Rows[0];
        Assert.Equal("Total Distance", distance.Metric);
        Assert.Equal("1,000.00", distance.PeriodA);
        Assert.Equal("2,000.00", distance.PeriodB);
        Assert.Equal("\u2193 1,000.00", distance.ChangeText); // down arrow + absolute delta
        Assert.False(distance.ChangePositive);
        Assert.Equal("-50.0%", distance.PctChange);
        Assert.Equal(StatusKind.Danger, distance.PctStatus);
    }

    // ---- Insights ------------------------------------------------------------------

    [Fact]
    public void Insights_project_three_lines_with_direction_words()
    {
        var display = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);

        Assert.Equal(3, display.Insights.Count);
        Assert.Contains("less", display.Insights[0]);       // distance declined A vs B
        Assert.Contains("improved", display.Insights[1]);   // efficiency improved (200 > 180 Wh/km)
        Assert.Contains("lower", display.Insights[2]);      // cost lower in A
    }

    [Fact]
    public void Insights_are_empty_until_both_periods_resolve()
    {
        var display = PeriodCompareProjection.Project(PeriodCompareModel.Initial, Localizer, UnitPref.Metric);

        Assert.Empty(display.Insights);
    }

    // ---- Disambiguation banner -----------------------------------------------------

    [Fact]
    public void Banner_shown_for_multi_vehicle_accounts_only()
    {
        var multi = PeriodCompareProjection.Project(SuccessModel(), Localizer, UnitPref.Metric);
        Assert.True(multi.ShowBanner);
        Assert.Equal("Looking to compare two vehicles instead?", multi.BannerPrefix);
        Assert.Equal("Open Fleet comparison \u2192", multi.BannerCta);

        var single = PeriodCompareProjection.Project(
            SuccessModel() with { Vehicles = [new PeriodCompareVehicle(1, "Model 3", "VIN1")] }, Localizer, UnitPref.Metric);
        Assert.False(single.ShowBanner);
    }

    [Fact]
    public void PctChange_returns_em_dash_when_baseline_is_zero()
    {
        var (value, positive) = PeriodCompareProjection.PctChange(5, 0);
        Assert.Equal("\u2014", value);
        Assert.True(positive);
    }

    // ---- Tolerant JSON parsers -----------------------------------------------------

    [Fact]
    public void PeriodStats_parses_snake_case_envelope()
    {
        var stats = PeriodStats.FromJson(Json(
            "{\"total_distance\":1000,\"total_drives\":50,\"energy_used\":300,\"avg_efficiency\":200,\"total_cost\":120.5,\"co2_saved\":120}"));

        Assert.Equal(1000, stats.TotalDistanceKm);
        Assert.Equal(50, stats.TotalDrives);
        Assert.Equal(300, stats.EnergyUsedKwh);
        Assert.Equal(200, stats.AvgEfficiencyWhPerKm);
        Assert.Equal(120.5, stats.TotalCost);
        Assert.Equal(120, stats.Co2SavedKg);
    }

    [Fact]
    public void PeriodStats_falls_back_to_zero_for_non_object()
    {
        Assert.Equal(PeriodStats.Zero, PeriodStats.FromJson(Json("[]")));
    }

    [Fact]
    public void Vehicles_parse_skips_malformed_rows_and_falls_back_label()
    {
        var vehicles = PeriodCompareVehicle.ParseList(Json(
            "[{\"id\":1,\"display_name\":\"Model 3\"},{\"vin\":\"VIN9\"},{\"id\":3}]"));

        Assert.Equal(2, vehicles.Count);
        Assert.Equal("Model 3", vehicles[0].Label);
        Assert.Equal("Vehicle 3", vehicles[1].Label); // id 3, no name/vin
    }

    // ---- Generated-client feed (web useVehicles + the two period-stats queries) ----

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new PeriodCompareClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task ClientFeed_stats_sends_snake_case_vehicle_and_days_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_distance\":1000}"));
        var feed = new PeriodCompareClientFeed(api);

        _ = await feed.FetchStatsAsync(7, 30, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_period_stats", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(30, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_stats_parses_the_envelope()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_distance\":42,\"total_drives\":3,\"co2_saved\":5}"));
        var feed = new PeriodCompareClientFeed(api);

        var stats = await feed.FetchStatsAsync(1, 0, default);

        Assert.Equal(42, stats.TotalDistanceKm);
        Assert.Equal(3, stats.TotalDrives);
        Assert.Equal(5, stats.Co2SavedKg);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_starts_in_the_loading_state()
    {
        using var vm = new PeriodComparePageViewModel(EmptyPeriodCompareFeed.Instance, Localizer);

        Assert.Equal(PeriodCompareState.Loading, vm.State);
        Assert.True(vm.Display.ShowLoading);
    }

    [Fact]
    public async Task ViewModel_empty_feed_resolves_to_the_empty_state()
    {
        using var vm = new PeriodComparePageViewModel(EmptyPeriodCompareFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(PeriodCompareState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.Null(vm.SelectedVehicleId);
    }

    [Fact]
    public async Task ViewModel_loads_into_success_and_selects_the_first_vehicle()
    {
        var feed = new FakeFeed { Vehicles = TwoVehicles(), Stats = (_, _) => StatsA() };
        using var vm = new PeriodComparePageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(PeriodCompareState.Success, vm.State);
        Assert.Equal(1, vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(6, vm.Display.Metrics.Count);
        // first load fetches both periods for the selected vehicle.
        Assert.Contains((1L, 30), feed.StatsCalls);
        Assert.Contains((1L, 90), feed.StatsCalls);
    }

    [Fact]
    public async Task ViewModel_vehicles_failure_is_the_error_state()
    {
        var feed = new FakeFeed { VehiclesError = new InvalidOperationException("offline") };
        using var vm = new PeriodComparePageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(PeriodCompareState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_period_stats_failure_is_the_error_state()
    {
        var feed = new FakeFeed { Vehicles = TwoVehicles(), StatsError = new InvalidOperationException("boom") };
        using var vm = new PeriodComparePageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(PeriodCompareState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_refetches_both_periods()
    {
        var feed = new FakeFeed { Vehicles = TwoVehicles(), Stats = (_, _) => StatsA() };
        using var vm = new PeriodComparePageViewModel(feed, Localizer);
        await vm.LoadAsync();
        feed.StatsCalls.Clear();

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2, vm.SelectedVehicleId);
        Assert.Contains((2L, 30), feed.StatsCalls);
        Assert.Contains((2L, 90), feed.StatsCalls);
    }

    [Fact]
    public async Task ViewModel_period_change_refetches_with_the_new_window()
    {
        var feed = new FakeFeed { Vehicles = TwoVehicles(), Stats = (_, _) => StatsA() };
        using var vm = new PeriodComparePageViewModel(feed, Localizer);
        await vm.LoadAsync();
        feed.StatsCalls.Clear();

        await vm.SetPeriodADaysAsync(7);

        Assert.Equal(7, vm.PeriodADays);
        Assert.Contains((1L, 7), feed.StatsCalls);
    }

    [Fact]
    public void ViewModel_notify_opened_records_a_pii_safe_diagnostic()
    {
        var events = new List<string>();
        var diagnostics = new PeriodCompareDiagnostics(events.Add);
        using var vm = new PeriodComparePageViewModel(EmptyPeriodCompareFeed.Instance, Localizer, diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=PeriodComparePage", events);
    }

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private sealed class FakeFeed : IPeriodCompareFeed
    {
        public IReadOnlyList<PeriodCompareVehicle> Vehicles { get; init; } = Array.Empty<PeriodCompareVehicle>();

        public Exception? VehiclesError { get; init; }

        public Exception? StatsError { get; init; }

        public Func<long, int, PeriodStats> Stats { get; init; } = (_, _) => PeriodStats.Zero;

        public List<(long VehicleId, int Days)> StatsCalls { get; } = new();

        public Task<IReadOnlyList<PeriodCompareVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return VehiclesError is not null
                ? Task.FromException<IReadOnlyList<PeriodCompareVehicle>>(VehiclesError)
                : Task.FromResult(Vehicles);
        }

        public Task<PeriodStats> FetchStatsAsync(long vehicleId, int days, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            StatsCalls.Add((vehicleId, days));
            return StatsError is not null
                ? Task.FromException<PeriodStats>(StatsError)
                : Task.FromResult(Stats(vehicleId, days));
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
