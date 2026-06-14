using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Maps;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>NavigationRoutePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/maps/pages/NavigationRoutePage.tsx) with its loading / empty / error / success matrix, the
/// tolerant snapshot parsers, the SI m/s → display-speed and metres → display-distance conversions at the display
/// boundary, the ported <c>LocationStatusCard</c> / <c>TrafficDelayBadge</c> / <c>buildWaypoints</c> /
/// <c>chartData</c> / <c>presenceChartData</c> helpers, the sixty manifest i18n keys, the thirteen panels, the two
/// charts, the view-model state matrix, and the generated-client feed's request shaping (the three web queries).
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="NavigationDisplay"/> flags asserted here.
/// </summary>
public sealed class NavigationRoutePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The sixty i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData",
        "error.loadFailed",
        "nav.active",
        "nav.atHome",
        "nav.atWork",
        "nav.awayFromHome",
        "nav.chartDistanceV2",
        "nav.chartSpeedV2",
        "nav.col.destination",
        "nav.col.distance",
        "nav.col.eta",
        "nav.col.home",
        "nav.col.lat",
        "nav.col.lon",
        "nav.col.time",
        "nav.col.work",
        "nav.currentLocation",
        "nav.delay",
        "nav.destination",
        "nav.distanceRemaining",
        "nav.eta",
        "nav.gpsFixQuality",
        "nav.heading",
        "nav.headingValue",
        "nav.homeStatus",
        "nav.homelinkNearby",
        "nav.inactive",
        "nav.legendDistanceToArrivalV2",
        "nav.legendSpeedV2",
        "nav.locationHistory",
        "nav.locationUnavailable",
        "nav.metric.avgSpeed",
        "nav.metric.distance",
        "nav.metric.energyAtArrival",
        "nav.metric.eta",
        "nav.metric.trafficDelay",
        "nav.minutes",
        "nav.noActiveNav",
        "nav.noDestinations",
        "nav.noGps",
        "nav.noHistory",
        "nav.noPresence",
        "nav.noSnapshots",
        "nav.notAtWork",
        "nav.pageTitle",
        "nav.presenceChart",
        "nav.recentDestinations",
        "nav.refresh",
        "nav.routeLastUpdated",
        "nav.speedProfile",
        "nav.status",
        "nav.subtitle",
        "nav.trafficDelay",
        "nav.unknown",
        "nav.waypoints",
        "nav.workStatus",
        "nav.wp.distance",
        "nav.wp.name",
        "nav.wp.type",
        "navigation.noRoute",
    ];

    private static LocationSnapshotModel Snap(
        long id = 1,
        double? lat = 37.5,
        double? lon = -122.3,
        double? heading = 90,
        string? gps = "fix3d",
        double? speedMps = 20,
        string? dest = "Work",
        double? distM = 16093.44,
        double? minutes = 12,
        double? trafficS = 120,
        string? routeUpdated = "2026-06-01T10:00:00Z",
        bool? home = false,
        bool? work = false,
        bool? homelink = false,
        string? createdAt = "2026-06-01T10:00:00Z") =>
        new(id, lat, lon, heading, gps, speedMps, dest, distM, minutes, trafficS, routeUpdated, home, work, homelink, createdAt);

    private static NavigationModel SuccessModel(
        LocationSnapshotModel? latest = null,
        IReadOnlyList<LocationSnapshotModel>? history = null,
        double? energy = null) =>
        new(new NavigationSnapshot(latest ?? Snap(), history ?? [Snap()], energy), false, null);

    private static NavigationDisplay Project(NavigationModel model, UnitPref? units = null) =>
        NavigationProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    // ---- i18n key coverage (all 60 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();
        NavigationProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        NavigationProjection.Project(NavigationModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_sixty_unique_keys() =>
        Assert.Equal(60, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- State matrix (loading / empty / error / success) --------------------------

    [Fact]
    public void State_loading_when_queries_in_flight()
    {
        var display = Project(NavigationModel.Initial);

        Assert.Equal(NavigationRouteState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_snapshot_or_history()
    {
        var model = new NavigationModel(NavigationSnapshot.Empty, false, null);

        var display = Project(model);

        Assert.Equal(NavigationRouteState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = new NavigationModel(NavigationSnapshot.Empty, false, "network down");

        var display = Project(model);

        Assert.Equal(NavigationRouteState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
        Assert.Contains("Failed to load data", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_a_snapshot_is_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(NavigationRouteState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void History_only_snapshot_still_resolves_to_success()
    {
        var model = new NavigationModel(new NavigationSnapshot(null, [Snap()], null), false, null);

        Assert.Equal(NavigationRouteState.Success, Project(model).State);
    }

    // ---- Navigation status panel (GlassPanel1) -------------------------------------

    [Fact]
    public void Status_active_route_projects_fields_and_active_badge()
    {
        var display = Project(SuccessModel(Snap(dest: "Office", minutes: 18)));

        Assert.True(display.Status.HasActiveRoute);
        Assert.Equal("Active", display.Status.BadgeText);
        Assert.Equal(StatusKind.Success, display.Status.BadgeStatus);
        Assert.Equal("Office", display.Status.Destination.Value);
        Assert.Contains("18", display.Status.Eta.Value, StringComparison.Ordinal);
        Assert.Equal("Navigation Status", display.Status.Title);
    }

    [Fact]
    public void Status_inactive_route_shows_no_active_message()
    {
        var display = Project(SuccessModel(Snap(dest: null)));

        Assert.False(display.Status.HasActiveRoute);
        Assert.Equal("Inactive", display.Status.BadgeText);
        Assert.Equal(StatusKind.Neutral, display.Status.BadgeStatus);
        Assert.Contains("No active navigation", display.Status.NoActiveMessage, StringComparison.Ordinal);
    }

    // ---- GPS warning callout (web nav.noGps) ---------------------------------------

    [Fact]
    public void GpsWarning_shown_when_latest_has_no_valid_location()
    {
        var display = Project(SuccessModel(Snap(lat: 0, lon: 0)));

        Assert.True(display.ShowGpsWarning);
        Assert.Contains("GPS coordinates not available", display.GpsWarningText, StringComparison.Ordinal);
    }

    [Fact]
    public void GpsWarning_hidden_when_location_is_valid()
    {
        var display = Project(SuccessModel(Snap(lat: 37.5, lon: -122.3)));

        Assert.False(display.ShowGpsWarning);
    }

    // ---- Location status cards (GlassPanel2) ----------------------------------------

    [Fact]
    public void LocationCards_project_five_cards_with_presence_flags()
    {
        var display = Project(SuccessModel(Snap(gps: "fix3d", home: true, work: false)));

        Assert.Equal(5, display.LocationCards.Count);
        Assert.Equal("Current Location", display.LocationCards[0].Label);
        Assert.True(display.LocationCards[1].Active); // GPS fix3d -> locked
        Assert.Equal("Home Status", display.LocationCards[3].Label);
        Assert.True(display.LocationCards[3].Active); // located_at_home == true
        Assert.Equal("At Home", display.LocationCards[3].Value);
        Assert.False(display.LocationCards[4].Active); // not at work
    }

    [Fact]
    public void LocationCard_current_location_falls_back_when_invalid()
    {
        var display = Project(SuccessModel(Snap(lat: 0, lon: 0)));

        Assert.Equal("Location unavailable", display.LocationCards[0].Value);
        Assert.False(display.LocationCards[0].Active);
    }

    // ---- Route metrics (Distance / ETA / Traffic-Delay / Avg-Speed / Energy) --------

    [Fact]
    public void Metrics_project_five_cards()
    {
        var display = Project(SuccessModel(Snap(), [Snap(speedMps: 10), Snap(speedMps: 20)], energy: 85));

        Assert.Equal(5, display.Metrics.Count);
        Assert.Equal("Distance", display.Metrics[0].Label);
        Assert.Equal("Avg Speed", display.Metrics[3].Label);
        Assert.Equal("Energy at Arrival", display.Metrics[4].Label);
        Assert.Contains("85", display.Metrics[4].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Metrics_show_dashes_for_inactive_route_and_absent_energy()
    {
        var display = Project(SuccessModel(Snap(dest: null), energy: null));

        Assert.Equal("\u2014", display.Metrics[0].Value); // distance
        Assert.Equal("\u2014", display.Metrics[1].Value); // eta
        Assert.Equal("\u2014", display.Metrics[4].Value); // energy
    }

    [Fact]
    public void Metric_distance_converts_to_imperial_miles()
    {
        // 16093.44 m == 10 mi.
        var display = Project(SuccessModel(Snap(distM: 16093.44)), UnitPref.Imperial);

        Assert.Contains("mi", display.Metrics[0].Value, StringComparison.Ordinal);
        Assert.Contains("10", display.Metrics[0].Value, StringComparison.Ordinal);
    }

    // ---- Charts (speed-profile area, presence line) --------------------------------

    [Fact]
    public void SpeedChart_builds_two_area_series_from_history()
    {
        var history = new[] { Snap(speedMps: 10), Snap(speedMps: 20) };
        var display = Project(SuccessModel(history: history));

        Assert.True(display.SpeedChart.Visible);
        Assert.Equal(2, display.SpeedChart.Series.Count);
        Assert.All(display.SpeedChart.Series, s => Assert.Equal(ChartSeriesKind.Area, s.Kind));
        Assert.Equal(2, display.SpeedChart.Series[0].Points.Count);
    }

    [Fact]
    public void SpeedChart_is_empty_without_history()
    {
        var display = Project(SuccessModel(history: []));

        Assert.False(display.SpeedChart.Visible);
        Assert.Contains("No location history", display.SpeedChart.EmptyMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void PresenceChart_builds_three_line_series()
    {
        var display = Project(SuccessModel(history: [Snap(home: true), Snap(work: true)]));

        Assert.True(display.PresenceChart.Visible);
        Assert.Equal(3, display.PresenceChart.Series.Count);
        Assert.All(display.PresenceChart.Series, s => Assert.Equal(ChartSeriesKind.Line, s.Kind));
    }

    // ---- Waypoints (GlassPanel9) ----------------------------------------------------

    [Fact]
    public void Waypoints_active_route_projects_one_destination_row()
    {
        var display = Project(SuccessModel(Snap(dest: "Work")));

        Assert.True(display.Waypoints.Active);
        Assert.Single(display.Waypoints.Table.Rows);
        Assert.Equal("Work", display.Waypoints.Table.Rows[0].Values["name"]);
        Assert.Equal(3, display.Waypoints.Table.Columns.Count);
    }

    [Fact]
    public void Waypoints_inactive_route_is_marked_no_route()
    {
        var display = Project(SuccessModel(Snap(dest: null)));

        Assert.False(display.Waypoints.Active);
        Assert.Contains("No active route", display.Waypoints.NoRouteMessage, StringComparison.Ordinal);
    }

    // ---- Recent destinations (GlassPanel11) + history (GlassPanel13) ----------------

    [Fact]
    public void RecentDestinations_deduplicates_by_name()
    {
        var history = new[]
        {
            Snap(dest: "Work", createdAt: "2026-06-01T10:00:00Z"),
            Snap(dest: "Work", createdAt: "2026-06-01T09:00:00Z"),
            Snap(dest: "Home", createdAt: "2026-06-01T08:00:00Z"),
        };

        var display = Project(SuccessModel(history: history));

        Assert.Equal(2, display.RecentDestinations.Table.Rows.Count);
        Assert.Equal(4, display.RecentDestinations.Table.Columns.Count);
    }

    [Fact]
    public void LocationHistory_projects_one_row_per_snapshot()
    {
        var history = new[] { Snap(id: 1), Snap(id: 2), Snap(id: 3) };

        var display = Project(SuccessModel(history: history));

        Assert.Equal(3, display.LocationHistory.Table.Rows.Count);
        Assert.Equal(6, display.LocationHistory.Table.Columns.Count);
    }

    // ---- Helper bands --------------------------------------------------------------

    [Theory]
    [InlineData(0, StatusKind.Success)]
    [InlineData(299, StatusKind.Success)]
    [InlineData(300, StatusKind.Warning)]
    [InlineData(900, StatusKind.Warning)]
    [InlineData(901, StatusKind.Danger)]
    public void TrafficBadgeStatus_follows_the_web_bands(double seconds, StatusKind expected) =>
        Assert.Equal(expected, NavigationProjection.TrafficBadgeStatus(seconds));

    [Theory]
    [InlineData(0, "N")]
    [InlineData(90, "E")]
    [InlineData(180, "S")]
    [InlineData(270, "W")]
    public void HeadingToCardinal_maps_degrees(double deg, string expected) =>
        Assert.Equal(expected, NavigationProjection.HeadingToCardinal(deg));

    [Fact]
    public void HeadingToCardinal_em_dash_for_null() =>
        Assert.Equal("\u2014", NavigationProjection.HeadingToCardinal(null));

    [Theory]
    [InlineData("fix3d", "locked")]
    [InlineData("GpsValid", "locked")]
    [InlineData("nofix", "unlocked")]
    [InlineData("invalid", "unlocked")]
    [InlineData("weird", "unknown")]
    [InlineData(null, "unknown")]
    public void NormalizeGpsState_matches_web(string? raw, string expected) =>
        Assert.Equal(expected, NavigationProjection.NormalizeGpsState(raw));

    [Fact]
    public void AverageSpeed_means_positive_si_values_then_converts()
    {
        var history = new[] { Snap(speedMps: 10), Snap(speedMps: 20), Snap(speedMps: 0) };

        // mean of (10, 20) = 15 m/s -> 54 km/h.
        Assert.Equal(54, NavigationProjection.AverageSpeed(history, UnitPref.Metric));
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_snake_case_fields()
    {
        var json = Json(
            "{\"id\":7,\"latitude\":37.5,\"longitude\":-122.3,\"heading\":90,\"gps_state\":\"fix3d\"," +
            "\"speed_mph\":20,\"destination_name\":\"Work\",\"miles_to_arrival\":16093.44," +
            "\"minutes_to_arrival\":12,\"route_traffic_delay_s\":120,\"located_at_home\":true," +
            "\"located_at_work\":false,\"homelink_nearby\":true,\"created_at\":\"2026-06-01T10:00:00Z\"}");

        var model = LocationSnapshotModel.FromJson(json);

        Assert.Equal(7, model.Id);
        Assert.Equal(20, model.SpeedMps);
        Assert.Equal("Work", model.DestinationName);
        Assert.Equal(16093.44, model.DistanceToArrivalM);
        Assert.True(model.LocatedAtHome);
        Assert.False(model.LocatedAtWork);
        Assert.True(model.HasValidLocation);
        Assert.True(model.HasActiveRoute);
    }

    [Fact]
    public void ParseHistory_reads_an_array_and_tolerates_non_arrays()
    {
        var array = NavigationSnapshot.ParseHistory(Json("[{\"id\":1},{\"id\":2}]"));
        Assert.Equal(2, array.Count);

        Assert.Empty(NavigationSnapshot.ParseHistory(Json("null")));
        Assert.Empty(NavigationSnapshot.ParseHistory(Json("{}")));
    }

    [Fact]
    public void ParseLatest_is_null_for_non_objects()
    {
        Assert.Null(NavigationSnapshot.ParseLatest(Json("null")));
        Assert.Null(NavigationSnapshot.ParseLatest(Json("[]")));
        Assert.NotNull(NavigationSnapshot.ParseLatest(Json("{\"id\":1}")));
    }

    [Fact]
    public void ParseExpectedEnergy_reads_the_percentage()
    {
        Assert.Equal(85, NavigationSnapshot.ParseExpectedEnergy(Json("{\"expected_energy_pct_at_arrival\":85}")));
        Assert.Null(NavigationSnapshot.ParseExpectedEnergy(Json("{}")));
    }

    // ---- Generated-client feed (web three queries) ---------------------------------

    [Fact]
    public async Task ClientFeed_requests_three_reads_scoped_to_the_vehicle()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":1,\"destination_name\":\"Work\"}"));
        api.ReturnsValue(Json("[{\"id\":1}]"));
        api.ReturnsValue(Json("{\"expected_energy_pct_at_arrival\":80}"));
        var feed = new NavigationRouteClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal("get_api_v1_location_snapshots_latest", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_location_snapshots", api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_charging_telemetry_latest", api.Requests[2].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("200", api.Requests[1].Query!["limit"]?.ToString());
        Assert.Equal(80, snapshot.ExpectedEnergyPctAtArrival);
        Assert.NotNull(snapshot.Latest);
        Assert.Single(snapshot.History);
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_primary_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new NavigationRouteClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_charging_failure_to_an_absent_percentage()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":1,\"destination_name\":\"Work\"}"));
        api.ReturnsValue(Json("[{\"id\":1}]"));
        api.Throws(new ApiException("charging down", 503));
        var feed = new NavigationRouteClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.Null(snapshot.ExpectedEnergyPctAtArrival);
        Assert.NotNull(snapshot.Latest);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_success_from_the_feed()
    {
        var vm = new NavigationRoutePageViewModel(new FakeFeed(SuccessModel().Snapshot), Localizer);

        await vm.LoadAsync();

        Assert.Equal(NavigationRouteState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_feed_failure()
    {
        var vm = new NavigationRoutePageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(NavigationRouteState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        var vm = new NavigationRoutePageViewModel(new FakeFeed(SuccessModel(Snap(distM: 16093.44)).Snapshot), Localizer);
        await vm.LoadAsync();

        Assert.Contains("km", vm.Display.Metrics[0].Value, StringComparison.Ordinal);
        vm.Units = UnitPref.Imperial;
        Assert.Contains("mi", vm.Display.Metrics[0].Value, StringComparison.Ordinal);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new NavigationRouteDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NavigationRoutePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("NavigationRoute", NavigationRouteRegistration.RouteName);
        Assert.Equal("navigation", NavigationRouteRegistration.Route);
        Assert.Equal("get_api_v1_location_snapshots_latest", NavigationRouteRegistration.LatestOperation);
        Assert.Equal("get_api_v1_location_snapshots", NavigationRouteRegistration.HistoryOperation);
        Assert.Equal("get_api_v1_charging_telemetry_latest", NavigationRouteRegistration.ChargingOperation);
        Assert.Equal("Navigation & Route", NavigationRouteRegistration.Title(Localizer));
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

    private sealed class FakeFeed(NavigationSnapshot snapshot) : INavigationRouteFeed
    {
        public int FetchCount { get; private set; }

        public Task<NavigationSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingFeed : INavigationRouteFeed
    {
        public Task<NavigationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
