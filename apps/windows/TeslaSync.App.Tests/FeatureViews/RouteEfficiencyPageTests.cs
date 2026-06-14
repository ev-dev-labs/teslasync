using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RouteEfficiencyPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/RouteEfficiencyPage.tsx) with its loading / empty / error / success matrix,
/// the tolerant route parser, the SI Wh/km → Wh/mi efficiency + distance formatting at the display boundary, the
/// ported <c>efficiencyVariant</c> / summary / <c>chartData</c> / <c>RouteCard</c> helpers, the nineteen manifest
/// i18n keys, the view-model state matrix, and the generated-client feed's request shaping (web
/// <c>useRouteEfficiency</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="RouteEfficiencyDisplay"/> flags asserted here.
/// </summary>
public sealed class RouteEfficiencyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The nineteen i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData",
        "routeEfficiency.avg",
        "routeEfficiency.avgEfficiency",
        "routeEfficiency.avgLabel",
        "routeEfficiency.best",
        "routeEfficiency.bestEfficiency",
        "routeEfficiency.bestLabel",
        "routeEfficiency.col.route",
        "routeEfficiency.comparison",
        "routeEfficiency.comparison.aria",
        "routeEfficiency.metrics",
        "routeEfficiency.mostDrivenLabel",
        "routeEfficiency.routes",
        "routeEfficiency.subtitle",
        "routeEfficiency.title",
        "routeEfficiency.totalTrips",
        "routeEfficiency.trips",
        "routeEfficiency.worst",
        "routeEfficiency.worstLabel",
    ];

    private static RouteSummaryModel SampleRoute(
        string start = "Home",
        string end = "Work",
        int trips = 12,
        double avgDistanceKm = 20,
        double avg = 150,
        double best = 120,
        double worst = 200) =>
        new(start, end, trips, avgDistanceKm, avg, best, worst);

    private static RouteEfficiencyModel SuccessModel(IReadOnlyList<RouteSummaryModel>? routes = null)
    {
        var list = routes ?? [SampleRoute()];
        var snapshot = new RouteEfficiencySnapshot(list.Count > 0, list, list.Count, SumTrips(list));
        return new RouteEfficiencyModel(snapshot, false, null);
    }

    private static int SumTrips(IReadOnlyList<RouteSummaryModel> routes)
    {
        int total = 0;
        foreach (var r in routes)
        {
            total += r.TripCount;
        }

        return total;
    }

    private static RouteEfficiencyDisplay Project(RouteEfficiencyModel model, UnitPref? units = null) =>
        RouteEfficiencyProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    // ---- i18n key coverage (all 19 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();
        RouteEfficiencyProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        RouteEfficiencyProjection.Project(RouteEfficiencyModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_nineteen_unique_keys() =>
        Assert.Equal(19, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- State matrix (loading / empty / error / success) --------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(RouteEfficiencyModel.Initial);

        Assert.Equal(RouteEfficiencyState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_routes()
    {
        var model = new RouteEfficiencyModel(RouteEfficiencySnapshot.Empty, false, null);

        var display = Project(model);

        Assert.Equal(RouteEfficiencyState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = new RouteEfficiencyModel(RouteEfficiencySnapshot.Empty, false, "network down");

        var display = Project(model);

        Assert.Equal(RouteEfficiencyState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_routes_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(RouteEfficiencyState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Summary tiles (GlassPanel1) -----------------------------------------------

    [Fact]
    public void Summary_projects_four_tiles_routes_trips_best_avg()
    {
        var routes = new[]
        {
            SampleRoute(trips: 8, avg: 150, best: 120, worst: 210),
            SampleRoute(start: "A", end: "B", trips: 4, avg: 170, best: 140, worst: 230),
        };

        var display = Project(SuccessModel(routes));

        Assert.Equal(4, display.SummaryStats.Count);
        Assert.Equal(2, display.SummaryStats[0].Value);   // routes count
        Assert.Equal(12, display.SummaryStats[1].Value);  // total trips (8 + 4)
        Assert.Equal(120, display.SummaryStats[2].Value);  // best = min best efficiency (rounded)
        Assert.Equal(160, display.SummaryStats[3].Value);  // avg = mean(150, 170)
        Assert.Equal("Routes", display.SummaryStats[0].Label);
        Assert.Contains("Wh/km", display.SummaryStats[2].Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Summary_converts_efficiency_to_imperial_wh_per_mile()
    {
        var display = Project(SuccessModel([SampleRoute(best: 100, avg: 100)]), UnitPref.Imperial);

        Assert.Equal("Wh/mi", display.EfficiencyUnit);
        // 100 Wh/km * 1.609344 = 160.9344 -> rounded 161
        Assert.Equal(161, display.SummaryStats[2].Value);
        Assert.Contains("Wh/mi", display.SummaryStats[2].Label, StringComparison.Ordinal);
    }

    // ---- efficiencyVariant bands ---------------------------------------------------

    [Theory]
    [InlineData(120, StatusKind.Success)]
    [InlineData(139.9, StatusKind.Success)]
    [InlineData(150, StatusKind.Info)]
    [InlineData(179.9, StatusKind.Info)]
    [InlineData(200, StatusKind.Warning)]
    [InlineData(219.9, StatusKind.Warning)]
    [InlineData(260, StatusKind.Danger)]
    public void EfficiencyStatus_follows_the_web_color_bands(double whPerKm, StatusKind expected) =>
        Assert.Equal(expected, RouteEfficiencyProjection.EfficiencyStatus(whPerKm));

    [Fact]
    public void EfficiencyUnit_reflects_the_distance_preference()
    {
        Assert.Equal("Wh/km", RouteEfficiencyProjection.EfficiencyUnit(UnitPref.Metric));
        Assert.Equal("Wh/mi", RouteEfficiencyProjection.EfficiencyUnit(UnitPref.Imperial));
    }

    // ---- Comparison chart (Route-Efficiency-Comparison + BarChart) -----------------

    [Fact]
    public void Comparison_sorts_by_avg_limits_to_ten_and_builds_three_series()
    {
        var routes = Enumerable.Range(0, 14)
            .Select(i => SampleRoute(start: $"S{i}", end: $"E{i}", avg: 260 - i, best: 100 + i, worst: 300 - i))
            .ToList();

        var display = Project(SuccessModel(routes));
        var chart = display.Comparison;

        Assert.True(chart.Visible);
        Assert.Equal(10, chart.Rows.Count);
        // Sorted ascending by avg efficiency: the lowest-avg route (i=13, avg=247) comes first.
        Assert.True(chart.Rows[0].Avg <= chart.Rows[1].Avg);
        Assert.Equal(3, chart.Series.Count);
        Assert.All(chart.Series, series => Assert.Equal(ChartSeriesKind.Bar, series.Kind));
        Assert.Contains("Wh/km", chart.BestSeriesLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Comparison_is_hidden_when_a_single_route_is_present()
    {
        var display = Project(SuccessModel([SampleRoute()]));

        Assert.False(display.Comparison.Visible);
        Assert.True(display.Comparison.HasData);
        Assert.Single(display.Comparison.Rows);
    }

    [Fact]
    public void Comparison_truncates_long_route_names_to_ten_characters_per_side()
    {
        var routes = new[]
        {
            SampleRoute(start: "SuperLongOriginName", end: "AlsoVeryLongDestination"),
            SampleRoute(start: "B", end: "C"),
        };

        var display = Project(SuccessModel(routes));
        var name = display.Comparison.Rows.First(r => r.Name.StartsWith("SuperLong", StringComparison.Ordinal)).Name;

        Assert.Equal("SuperLongO\u2192AlsoVeryLo", name);
    }

    // ---- Route cards (GlassPanel2) -------------------------------------------------

    [Fact]
    public void RouteCards_project_one_per_route_with_badge_and_meta()
    {
        var routes = new[]
        {
            SampleRoute(start: "Home", end: "Work", trips: 12, avgDistanceKm: 20, avg: 150),
            SampleRoute(start: "Gym", end: "Mall", trips: 3, avg: 230),
        };

        var display = Project(SuccessModel(routes));

        Assert.Equal(2, display.RouteCards.Count);
        Assert.Equal("Home \u2192 Work", display.RouteCards[0].Title);
        Assert.Equal(StatusKind.Info, display.RouteCards[0].BadgeStatus);   // avg 150 -> info
        Assert.Equal(StatusKind.Danger, display.RouteCards[1].BadgeStatus); // avg 230 -> danger
        Assert.Contains("12 trips", display.RouteCards[0].Meta, StringComparison.Ordinal);
        Assert.Contains("km", display.RouteCards[0].Meta, StringComparison.Ordinal);
        Assert.Contains("Wh/km", display.RouteCards[0].BadgeText, StringComparison.Ordinal);
    }

    [Fact]
    public void RouteCard_distance_converts_to_imperial_miles()
    {
        var display = Project(SuccessModel([SampleRoute(avgDistanceKm: 100)]), UnitPref.Imperial);

        // 100 km -> ~62.1 mi
        Assert.Contains("mi", display.RouteCards[0].Meta, StringComparison.Ordinal);
        Assert.Contains("62.1", display.RouteCards[0].Meta, StringComparison.Ordinal);
    }

    // ---- Metric bars (GlassPanel4) -------------------------------------------------

    [Fact]
    public void MetricBars_project_four_bars_with_token_brushes()
    {
        var routes = new[]
        {
            SampleRoute(trips: 9, avg: 150, best: 120, worst: 210),
            SampleRoute(start: "A", end: "B", trips: 2, avg: 180, best: 150, worst: 260),
        };

        var display = Project(SuccessModel(routes));

        Assert.Equal(4, display.MetricBars.Count);
        Assert.Equal("Best Efficiency", display.MetricBars[0].Label);
        Assert.Equal("TsColorSuccessBrush", display.MetricBars[0].AccentBrushKey);
        Assert.Equal("TsColorDangerBrush", display.MetricBars[2].AccentBrushKey);
        Assert.Equal("Most Driven Route", display.MetricBars[3].Label);
        Assert.Equal(9, display.MetricBars[3].Value); // first route's trip count
        Assert.Contains("trips", display.MetricBars[3].ValueText, StringComparison.Ordinal);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_routes_and_totals_from_snake_case()
    {
        var json = Json(
            "{\"routes\":[{\"start_location\":\"Home\",\"end_location\":\"Work\",\"trip_count\":12," +
            "\"avg_distance_km\":20.5,\"avg_efficiency\":150,\"best_efficiency\":120,\"worst_efficiency\":200}]," +
            "\"total_routes\":1,\"total_trips\":12}");

        var snapshot = RouteEfficiencySnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Single(snapshot.Routes);
        Assert.Equal("Home", snapshot.Routes[0].StartLocation);
        Assert.Equal(12, snapshot.Routes[0].TripCount);
        Assert.Equal(20.5, snapshot.Routes[0].AvgDistanceKm);
        Assert.Equal(1, snapshot.TotalRoutes);
        Assert.Equal(12, snapshot.TotalTrips);
    }

    [Fact]
    public void Snapshot_tolerates_camel_case_aliases()
    {
        var json = Json(
            "{\"routes\":[{\"startLocation\":\"A\",\"endLocation\":\"B\",\"tripCount\":3," +
            "\"avgDistanceKm\":5,\"avgEfficiency\":160,\"bestEfficiency\":140,\"worstEfficiency\":190}]}");

        var snapshot = RouteEfficiencySnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Equal("A", snapshot.Routes[0].StartLocation);
        Assert.Equal(3, snapshot.Routes[0].TripCount);
        Assert.Equal(160, snapshot.Routes[0].AvgEfficiencyWhKm);
    }

    [Fact]
    public void Snapshot_is_empty_for_non_object_or_missing_routes()
    {
        Assert.False(RouteEfficiencySnapshot.FromJson(Json("null")).HasData);
        Assert.False(RouteEfficiencySnapshot.FromJson(Json("[]")).HasData);
        Assert.False(RouteEfficiencySnapshot.FromJson(Json("{\"routes\":[]}")).HasData);
    }

    // ---- Generated-client feed (web useRouteEfficiency) ----------------------------

    [Fact]
    public async Task ClientFeed_requests_route_efficiency_scoped_to_the_vehicle()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"routes\":[{\"start_location\":\"H\",\"end_location\":\"W\"}]}"));
        var feed = new RouteEfficiencyClientFeed(api, vehicleId: 7);

        await feed.FetchAsync(default);

        Assert.Equal("get_api_v1_analytics_route_efficiency", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.False(api.Requests[0].Query!.ContainsKey("start"));
    }

    [Fact]
    public async Task ClientFeed_appends_the_range_to_the_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"routes\":[]}"));
        var feed = new RouteEfficiencyClientFeed(api, vehicleId: 5, start: "2026-01-01", end: "2026-06-01");

        await feed.FetchAsync(default);

        Assert.Equal("2026-01-01", api.Requests[0].Query!["start"]?.ToString());
        Assert.Equal("2026-06-01", api.Requests[0].Query!["end"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new RouteEfficiencyClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_success_from_the_feed()
    {
        var snapshot = new RouteEfficiencySnapshot(true, [SampleRoute()], 1, 12);
        var vm = new RouteEfficiencyPageViewModel(new FakeFeed(snapshot), Localizer);

        await vm.LoadAsync();

        Assert.Equal(RouteEfficiencyState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_feed_failure()
    {
        var vm = new RouteEfficiencyPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(RouteEfficiencyState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        var snapshot = new RouteEfficiencySnapshot(true, [SampleRoute(best: 100, avg: 100)], 1, 12);
        var vm = new RouteEfficiencyPageViewModel(new FakeFeed(snapshot), Localizer);
        await vm.LoadAsync();

        Assert.Equal("Wh/km", vm.Display.EfficiencyUnit);
        vm.Units = UnitPref.Imperial;
        Assert.Equal("Wh/mi", vm.Display.EfficiencyUnit);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new RouteEfficiencyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RouteEfficiencyPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("RouteEfficiency", RouteEfficiencyRegistration.RouteName);
        Assert.Equal("route-efficiency", RouteEfficiencyRegistration.Route);
        Assert.Equal("get_api_v1_analytics_route_efficiency", RouteEfficiencyRegistration.RouteOperation);
        Assert.Equal("Route Efficiency", RouteEfficiencyRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed(RouteEfficiencySnapshot snapshot) : IRouteEfficiencyFeed
    {
        public int FetchCount { get; private set; }

        public Task<RouteEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingFeed : IRouteEfficiencyFeed
    {
        public Task<RouteEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
