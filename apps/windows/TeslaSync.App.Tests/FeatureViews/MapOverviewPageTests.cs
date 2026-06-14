using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Maps;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MapOverviewPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/maps/pages/MapOverviewPage.tsx), the tolerant vehicle / position / location parsers, the
/// four-state matrix (loading / empty / error / success), the SI display conversions at the boundary, the GPS
/// trail + route-playback derivation, and the generated-client feed's request shaping (web <c>useVehicles</c> +
/// the three inline position / location queries). The WinUI view is exercised by the app build; its per-region
/// visibility is driven entirely by the <see cref="MapOverviewDisplay"/> flags asserted here.
/// </summary>
public sealed class MapOverviewPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 35 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "error.loadFailed", "mapOverview.atHome", "mapOverview.atWork", "mapOverview.autoRefresh",
        "mapOverview.colHeading", "mapOverview.colLat", "mapOverview.colLon", "mapOverview.colSpeed",
        "mapOverview.colTime", "mapOverview.currentSpeed", "mapOverview.distanceUnitValue", "mapOverview.geofences",
        "mapOverview.heading", "mapOverview.homelinkNearby", "mapOverview.lastUpdated", "mapOverview.latLon",
        "mapOverview.locationDetails", "mapOverview.locations", "mapOverview.navRoute", "mapOverview.no",
        "mapOverview.noGps", "mapOverview.noHistory", "mapOverview.noLocation", "mapOverview.odometer",
        "mapOverview.pageTitle", "mapOverview.playbackLabel", "mapOverview.quickLinks", "mapOverview.recentHistory",
        "mapOverview.recentPlayback", "mapOverview.speedUnitValue", "mapOverview.subtitle", "mapOverview.title",
        "mapOverview.unknown", "mapOverview.vehicle", "mapOverview.yes",
    ];

    private static PositionRecord Pos(
        long id = 1,
        double lat = 37.7749,
        double lon = -122.4194,
        double? speed = 10,
        double? power = 5000,
        double? heading = 90,
        double odometer = 100000,
        double battery = 72,
        string? createdAt = "2026-06-12T11:59:00Z") =>
        new(id, lat, lon, speed, power, heading, odometer, battery, createdAt);

    private static LocationSnapshot Snap(bool? home = true, bool? work = false, bool homelink = true) =>
        new(home, work, homelink, false, "Home", "2026-06-12T11:59:00Z");

    private static MapOverviewSnapshot Full(
        PositionRecord? latest = null,
        IReadOnlyList<PositionRecord>? history = null,
        LocationSnapshot? location = null) =>
        new(
            new[] { new MapVehicleRef(7, "My Model 3"), new MapVehicleRef(8, "Garage Y") },
            latest ?? Pos(),
            history ?? new[] { Pos() },
            location ?? Snap());

    private static MapOverviewModel SuccessModel(MapOverviewSnapshot? snapshot = null, string mapStyle = "dark") =>
        new(snapshot ?? Full(), false, false, false, null, null, 7, mapStyle);

    private static MapOverviewDisplay Project(MapOverviewModel model, UnitPref? units = null) =>
        MapOverviewProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 35 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = MapOverviewProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = MapOverviewProjection.Project(MapOverviewModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_thirty_five_unique_keys() =>
        Assert.Equal(35, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four-state matrix ---------------------------------------------------------

    [Fact]
    public void State_loading_when_fleet_in_flight()
    {
        var display = Project(MapOverviewModel.Initial);

        Assert.Equal(MapOverviewState.Loading, display.State);
        Assert.True(display.PageLoading);
        Assert.True(display.MetricsLoading);
    }

    [Fact]
    public void State_error_when_a_query_failed()
    {
        var model = SuccessModel() with { AnyError = "boom", VehiclesError = "boom" };

        var display = Project(model);

        Assert.Equal(MapOverviewState.Error, display.State);
        Assert.True(display.ShowErrorBanner);
        Assert.Equal("boom", display.PageError);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_empty_when_resolved_without_valid_gps()
    {
        var snapshot = Full(latest: Pos(lat: 0, lon: 0), history: Array.Empty<PositionRecord>());
        var display = Project(SuccessModel(snapshot));

        Assert.Equal(MapOverviewState.Empty, display.State);
        Assert.False(display.HasValidLocation);
        Assert.True(display.ShowNoGpsBanner);
        Assert.Equal(
            "GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.",
            display.NoGpsBannerText);
    }

    [Fact]
    public void State_success_when_valid_location_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(MapOverviewState.Success, display.State);
        Assert.True(display.HasValidLocation);
        Assert.False(display.ShowNoVehicle);
        Assert.Equal(37.7749, display.MapCenterLat);
        Assert.Equal(-122.4194, display.MapCenterLng);
        Assert.Equal("My Model 3", display.MarkerLabel);
    }

    [Fact]
    public void No_vehicle_guard_when_resolved_without_a_selection()
    {
        var model = new MapOverviewModel(MapOverviewSnapshot.Empty, false, false, false, null, null, null, "dark");

        var display = Project(model);

        Assert.True(display.ShowNoVehicle);
    }

    [Fact]
    public void Marker_falls_back_to_vehicle_label_when_name_missing()
    {
        var snapshot = new MapOverviewSnapshot(
            new[] { new MapVehicleRef(7, null) }, Pos(), new[] { Pos() }, Snap());

        var display = Project(SuccessModel(snapshot));

        Assert.Equal("Vehicle", display.MarkerLabel);
    }

    // ---- Metric cards (Current-Speed / Heading / Lat-Lon / Last-Updated) -----------

    [Fact]
    public void Metric_cards_project_speed_heading_latlon_and_last_updated()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Metrics.Count);
        Assert.Contains("36.0 km/h", display.Metrics[0].Value, StringComparison.Ordinal); // 10 m/s -> 36 km/h
        Assert.Equal("90\u00B0", display.Metrics[1].Value);
        Assert.Equal("37.7749, -122.4194", display.Metrics[2].Value);
        Assert.NotEqual("\u2014", display.Metrics[3].Value);
        Assert.Equal("Auto-refreshes every 15 s", display.Metrics[3].Subtitle);
    }

    [Fact]
    public void Metric_speed_converts_to_imperial_at_the_display_boundary()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Contains("22.4 mph", display.Metrics[0].Value, StringComparison.Ordinal); // 10 m/s -> 22.37 mph
    }

    [Fact]
    public void Metric_heading_and_latlon_em_dash_when_absent()
    {
        var snapshot = Full(latest: Pos(lat: 0, lon: 0, heading: null));
        var display = Project(SuccessModel(snapshot));

        Assert.Equal("\u2014", display.Metrics[1].Value); // heading
        Assert.Equal("\u2014", display.Metrics[2].Value); // lat/lon
    }

    // ---- Location details (At Home / At Work / HomeLink / Odometer) ----------------

    [Fact]
    public void Location_details_project_tri_state_badges_and_odometer()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasLocationDetails);
        Assert.Equal(4, display.LocationDetails.Count);
        Assert.Equal("Yes", display.LocationDetails[0].BadgeText);    // at home (true)
        Assert.Equal("No", display.LocationDetails[1].BadgeText);     // at work (false)
        Assert.Equal("Yes", display.LocationDetails[2].BadgeText);    // homelink (true)
        Assert.Contains("100.0 km", display.LocationDetails[3].ValueText, StringComparison.Ordinal); // 100000 m
        Assert.False(display.LocationDetails[3].ShowBadge);
    }

    [Fact]
    public void Location_detail_tri_state_is_unknown_when_snapshot_missing()
    {
        var snapshot = new MapOverviewSnapshot(
            new[] { new MapVehicleRef(7, "My Model 3") }, Pos(), new[] { Pos() }, Location: null);
        var display = Project(SuccessModel(snapshot));

        Assert.Equal("Unknown", display.LocationDetails[0].BadgeText);
        Assert.Equal("Unknown", display.LocationDetails[1].BadgeText);
    }

    [Fact]
    public void Odometer_converts_to_imperial_miles()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Contains("62.1 mi", display.LocationDetails[3].ValueText, StringComparison.Ordinal); // 100000 m
    }

    // ---- Recent location history table ---------------------------------------------

    [Fact]
    public void History_rows_project_five_columns_with_si_speed()
    {
        var history = new[] { Pos(id: 1), Pos(id: 2, lat: 0, lon: 0, heading: null) };
        var display = Project(SuccessModel(Full(history: history)));

        Assert.True(display.HasHistory);
        Assert.Equal(2, display.HistoryRows.Count);
        Assert.Equal("37.77490", display.HistoryRows[0].Lat);
        Assert.Contains("36.0 km/h", display.HistoryRows[0].Speed, StringComparison.Ordinal);
        Assert.Equal("90\u00B0", display.HistoryRows[0].Heading);
        Assert.Equal("\u2014", display.HistoryRows[1].Lat);     // (0,0) -> em-dash
        Assert.Equal("\u2014", display.HistoryRows[1].Heading); // null -> em-dash
    }

    [Fact]
    public void History_empty_when_no_samples()
    {
        var display = Project(SuccessModel(Full(history: Array.Empty<PositionRecord>())));

        Assert.False(display.HasHistory);
        Assert.Empty(display.HistoryRows);
        Assert.Equal("No location history found.", display.HistoryEmptyMessage);
    }

    // ---- GPS trail + route playback ------------------------------------------------

    [Fact]
    public void Trail_excludes_zero_coordinates()
    {
        var history = new[] { Pos(id: 1), Pos(id: 2, lat: 0, lon: 0), Pos(id: 3, lat: 37.8, lon: -122.5) };
        var display = Project(SuccessModel(Full(history: history)));

        Assert.Equal(2, display.Trail.Count);
    }

    [Fact]
    public void Playback_sorts_ascending_by_timestamp_and_needs_two_points()
    {
        var history = new[]
        {
            Pos(id: 1, createdAt: "2026-06-12T11:59:00Z"),
            Pos(id: 2, lat: 37.8, lon: -122.5, createdAt: "2026-06-12T11:50:00Z"),
        };
        var display = Project(SuccessModel(Full(history: history)));

        Assert.True(display.ShowPlayback);
        Assert.Equal(2, display.PlaybackPoints.Count);
        Assert.True(display.PlaybackPoints[0].TimestampMs <= display.PlaybackPoints[1].TimestampMs);
    }

    [Fact]
    public void Playback_hidden_with_a_single_point()
    {
        var display = Project(SuccessModel(Full(history: new[] { Pos() })));

        Assert.False(display.ShowPlayback);
    }

    // ---- Quick links + map style ---------------------------------------------------

    [Fact]
    public void Quick_links_project_three_routed_buttons()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.QuickLinks.Count);
        Assert.Equal("Navigation Route", display.QuickLinks[0].Label);
        Assert.Equal(MapOverviewProjection.NavigationRouteName, display.QuickLinks[0].Route);
        Assert.Equal(MapOverviewProjection.GeofencesRouteName, display.QuickLinks[1].Route);
        Assert.Equal(MapOverviewProjection.LocationsRouteName, display.QuickLinks[2].Route);
    }

    [Theory]
    [InlineData("satellite", "satellite")]
    [InlineData("STREETS", "streets")]
    [InlineData("bogus", "dark")]
    public void Map_style_id_is_normalized(string input, string expected)
    {
        var display = Project(SuccessModel(mapStyle: input));

        Assert.Equal(expected, display.MapStyleId);
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void Vehicle_parser_reads_snake_case_and_tolerates_missing_name()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"M3"},{"id":8}]""");

        var vehicles = MapOverviewSnapshot.ParseVehicles(doc.RootElement);

        Assert.Equal(2, vehicles.Count);
        Assert.Equal("M3", vehicles[0].DisplayName);
        Assert.Null(vehicles[1].DisplayName);
    }

    [Fact]
    public void Position_parser_reads_si_snake_case_wire_shape()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"latitude":37.77,"longitude":-122.41,"speed":12.5,"heading":180,"odometer":50000,"battery_level":80,"created_at":"2026-06-12T10:00:00Z"}]""");

        var positions = MapOverviewSnapshot.ParsePositions(doc.RootElement);

        Assert.Single(positions);
        Assert.Equal(37.77, positions[0].Latitude);
        Assert.Equal(12.5, positions[0].SpeedMps);
        Assert.Equal(50000, positions[0].OdometerM);
        Assert.True(positions[0].HasValidLocation);
    }

    [Fact]
    public void Location_parser_reads_snake_case_and_camelCase_aliases()
    {
        using var snake = JsonDocument.Parse("""{"located_at_home":true,"located_at_work":false,"homelink_nearby":true}""");
        using var camel = JsonDocument.Parse("""{"locatedAtHome":false,"locatedAtWork":true}""");

        var fromSnake = MapOverviewSnapshot.ParseLocation(snake.RootElement);
        var fromCamel = MapOverviewSnapshot.ParseLocation(camel.RootElement);

        Assert.True(fromSnake!.LocatedAtHome);
        Assert.False(fromSnake.LocatedAtWork);
        Assert.True(fromSnake.HomelinkNearby);
        Assert.False(fromCamel!.LocatedAtHome);
        Assert.True(fromCamel.LocatedAtWork);
    }

    [Fact]
    public void Parsers_return_empty_or_null_for_wrong_kinds()
    {
        using var obj = JsonDocument.Parse("{}");
        using var arr = JsonDocument.Parse("[]");

        Assert.Empty(MapOverviewSnapshot.ParseVehicles(obj.RootElement));
        Assert.Empty(MapOverviewSnapshot.ParsePositions(obj.RootElement));
        Assert.Null(MapOverviewSnapshot.ParseLocation(arr.RootElement));
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_requests_vehicles_positions_and_location_with_correct_shaping()
    {
        var api = new StubApiClient(MapResponder);
        var feed = new MapOverviewClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(CancellationToken.None);
        var latest = await feed.FetchLatestPositionAsync(7, CancellationToken.None);
        var history = await feed.FetchPositionHistoryAsync(7, CancellationToken.None);
        var location = await feed.FetchLocationSnapshotAsync(7, CancellationToken.None);

        Assert.Single(vehicles);
        Assert.NotNull(latest);
        Assert.Single(history);
        Assert.NotNull(location);

        var vehiclesReq = api.Requests[0];
        Assert.Equal(MapOverviewRegistration.VehiclesOperation, vehiclesReq.OperationId);

        var latestReq = api.Requests[1];
        Assert.Equal(MapOverviewRegistration.PositionsOperation, latestReq.OperationId);
        Assert.Equal("7", latestReq.PathParams!["vehicleID"]);
        Assert.Equal(1, latestReq.Query!["limit"]);

        var historyReq = api.Requests[2];
        Assert.Equal(50, historyReq.Query!["limit"]);

        var locationReq = api.Requests[3];
        Assert.Equal(MapOverviewRegistration.LocationSnapshotOperation, locationReq.OperationId);
        Assert.Equal(7L, locationReq.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Feed_latest_is_null_when_no_positions()
    {
        var api = new StubApiClient(_ => "[]");
        var feed = new MapOverviewClientFeed(api);

        var latest = await feed.FetchLatestPositionAsync(7, CancellationToken.None);

        Assert.Null(latest);
    }

    [Fact]
    public async Task Feed_propagates_failure_as_error()
    {
        var api = new StubApiClient(_ => null);
        var feed = new MapOverviewClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(CancellationToken.None));
    }

    // ---- View-model orchestration --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_fleet_auto_selects_first_and_loads_vehicle_data()
    {
        var feed = new RecordingFeed();
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(7L, vm.SelectedVehicleId);
        Assert.Equal(MapOverviewState.Success, vm.State);
        Assert.True(vm.Display.HasValidLocation);
        Assert.Equal(1, feed.VehicleCalls);
        Assert.Equal(7L, feed.LastVehicleData);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_reloads_that_vehicles_data()
    {
        var feed = new RecordingFeed();
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(8);

        Assert.Equal(8L, vm.SelectedVehicleId);
        Assert.Equal(8L, feed.LastVehicleData);
    }

    [Fact]
    public async Task ViewModel_set_map_style_reprojects_without_refetch()
    {
        var feed = new RecordingFeed();
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);
        await vm.LoadAsync();
        int before = feed.LatestCalls;

        vm.SetMapStyle("satellite");

        Assert.Equal("satellite", vm.Display.MapStyleId);
        Assert.Equal(before, feed.LatestCalls); // no refetch
    }

    [Fact]
    public async Task ViewModel_refresh_latest_refetches_only_the_latest_position()
    {
        var feed = new RecordingFeed();
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);
        await vm.LoadAsync();
        int historyBefore = feed.HistoryCalls;
        int latestBefore = feed.LatestCalls;

        await vm.RefreshLatestAsync();

        Assert.Equal(latestBefore + 1, feed.LatestCalls);
        Assert.Equal(historyBefore, feed.HistoryCalls); // history not refetched
    }

    [Fact]
    public async Task ViewModel_swallows_location_snapshot_failure()
    {
        var feed = new RecordingFeed { ThrowOnLocation = true };
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.False(vm.IsError);                       // location failure not surfaced
        Assert.Equal(MapOverviewState.Success, vm.State);
    }

    [Fact]
    public async Task ViewModel_surfaces_fleet_error()
    {
        var feed = new RecordingFeed { ThrowOnVehicles = true };
        using var vm = new MapOverviewPageViewModel(feed, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.True(vm.IsError);
        Assert.NotNull(vm.VehiclesError);
        Assert.Equal(MapOverviewState.Error, vm.State);
    }

    private static string? MapResponder(ApiRequest request)
    {
        if (request.OperationId == MapOverviewRegistration.VehiclesOperation)
        {
            return """[{"id":7,"display_name":"M3"}]""";
        }

        if (request.OperationId == MapOverviewRegistration.PositionsOperation)
        {
            return """[{"id":1,"latitude":37.77,"longitude":-122.41,"speed":10,"heading":90,"odometer":1000,"battery_level":50,"created_at":"2026-06-12T10:00:00Z"}]""";
        }

        if (request.OperationId == MapOverviewRegistration.LocationSnapshotOperation)
        {
            return """{"located_at_home":true,"homelink_nearby":false}""";
        }

        return "[]";
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

    private sealed class RecordingFeed : IMapOverviewFeed
    {
        public int VehicleCalls { get; private set; }

        public int LatestCalls { get; private set; }

        public int HistoryCalls { get; private set; }

        public long? LastVehicleData { get; private set; }

        public bool ThrowOnVehicles { get; init; }

        public bool ThrowOnLocation { get; init; }

        public Task<IReadOnlyList<MapVehicleRef>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehicleCalls++;
            if (ThrowOnVehicles)
            {
                throw new ApiException("fleet down");
            }

            IReadOnlyList<MapVehicleRef> vehicles = new[] { new MapVehicleRef(7, "Seven"), new MapVehicleRef(8, "Eight") };
            return Task.FromResult(vehicles);
        }

        public Task<PositionRecord?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken)
        {
            LatestCalls++;
            LastVehicleData = vehicleId;
            return Task.FromResult<PositionRecord?>(Pos());
        }

        public Task<IReadOnlyList<PositionRecord>> FetchPositionHistoryAsync(long vehicleId, CancellationToken cancellationToken)
        {
            HistoryCalls++;
            IReadOnlyList<PositionRecord> history = new[] { Pos() };
            return Task.FromResult(history);
        }

        public Task<LocationSnapshot?> FetchLocationSnapshotAsync(long vehicleId, CancellationToken cancellationToken)
        {
            if (ThrowOnLocation)
            {
                throw new ApiException("no snapshot");
            }

            return Task.FromResult<LocationSnapshot?>(Snap());
        }
    }

    private sealed class StubApiClient : IApiClient
    {
        private readonly Func<ApiRequest, string?> _responder;

        public StubApiClient(Func<ApiRequest, string?> responder) => _responder = responder;

        public List<ApiRequest> Requests { get; } = new();

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The stub resolves operations through SendAsync only.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            string? json = _responder(request);
            if (json is null)
            {
                throw new ApiException("stub failure");
            }

            using var doc = JsonDocument.Parse(json);
            object boxed = doc.RootElement.Clone();
            return Task.FromResult((T)boxed);
        }
    }
}
