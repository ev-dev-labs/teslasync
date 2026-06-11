using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the trip-replay map surface's UI-thread-free logic — the drive-position JSON parse
/// adapter (the <c>{positions:[…]}</c> drive body + bare-array + numeric-string coercion), the ported
/// <c>@/lib/geo</c> helpers (haversine, the <c>(0,0)</c>-rejecting validity test, the ≥ 10 m "meaningful route"
/// detection, the first-valid anchor, the nearest-sample seek scan, the speed-band colour ramp, the playhead
/// bearing), the projection (web <c>hasRoute</c> / <c>trail</c> / <c>speedSegments</c> / <c>startPos</c> /
/// <c>endPos</c> / <c>centerPos</c>), the cache-then-network result mapper, the drive-resolving data source
/// (explicit drive id, primary-vehicle → latest-drive chain, disabled-when-no-vehicle short-circuit, offline
/// fallback), the state-holder view-model's full state matrix (loading / ready / empty / stale / offline / error)
/// plus the playhead seat (<c>currentIndex</c> clamp + <c>onSeekToIndex</c> seek), the i18n facade key coverage,
/// the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/trips/components/TripReplayMap.tsx). The WinUI view itself is exercised by the app build; its
/// per-state branch selection is driven entirely by the view-model <see cref="TripReplayMapState"/> asserted here.
/// </summary>
public sealed class TripReplayMapTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // A real route: three fixes ~111 m apart on a meridian, with rising speeds spanning three colour bands.
    private const string RouteJson =
        """
        {
          "id": 55,
          "positions": [
            {"latitude":47.6000,"longitude":-122.3,"speed":10,"timestamp":"2026-04-04T10:00:00Z"},
            {"latitude":47.6010,"longitude":-122.3,"speed":45,"timestamp":"2026-04-04T10:01:00Z"},
            {"latitude":47.6020,"longitude":-122.3,"speed":80,"timestamp":"2026-04-04T10:02:00Z"}
          ]
        }
        """;

    // A stationary single-fix drive: every coordinate is within ~1 m of the first.
    private const string StationaryJson =
        """
        {
          "id": 7,
          "positions": [
            {"latitude":47.6000,"longitude":-122.3,"speed":0,"timestamp":"2026-04-04T10:00:00Z"},
            {"latitude":47.60001,"longitude":-122.3,"speed":0,"timestamp":"2026-04-04T10:00:30Z"}
          ]
        }
        """;

    // ---- JSON parse adapter ---------------------------------------------------------

    [Fact]
    public void Position_parses_coordinate_speed_and_timestamp()
    {
        using var doc = JsonDocument.Parse(
            """{"latitude":47.61,"longitude":-122.33,"speed":12.5,"timestamp":"2026-04-04T10:00:00Z"}""");

        var p = TripPositionSample.FromJson(doc.RootElement);

        Assert.Equal(47.61, p.Latitude);
        Assert.Equal(-122.33, p.Longitude);
        Assert.Equal(12.5, p.SpeedMps);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), p.TimestampUtc);
    }

    [Fact]
    public void Position_falls_back_to_created_at_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"latitude":1.0,"longitude":2.0,"created_at":"2026-04-04T11:00:00Z"}""");

        var p = TripPositionSample.FromJson(doc.RootElement);

        Assert.Null(p.SpeedMps);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), p.TimestampUtc);
    }

    [Fact]
    public void Position_missing_coordinate_is_nan_and_invalid()
    {
        using var doc = JsonDocument.Parse("""{"speed":5}""");

        var p = TripPositionSample.FromJson(doc.RootElement);

        Assert.True(double.IsNaN(p.Latitude));
        Assert.True(double.IsNaN(p.Longitude));
        Assert.False(TripReplayGeo.IsValidLatLng(p.Latitude, p.Longitude));
    }

    [Fact]
    public void Data_parses_positions_from_the_drive_body()
    {
        var data = Route();

        Assert.Equal(3, data.Positions.Count);
        Assert.Equal(47.6000, data.Positions[0].Latitude);
        Assert.Equal(80, data.Positions[2].SpeedMps);
    }

    [Fact]
    public void Data_parses_a_bare_positions_array()
    {
        using var doc = JsonDocument.Parse("""[{"latitude":1.0,"longitude":2.0,"speed":3}]""");
        var data = TripReplayMapData.FromJson(doc.RootElement);

        var row = Assert.Single(data.Positions);
        Assert.Equal(1.0, row.Latitude);
        Assert.Equal(3, row.SpeedMps);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("123")]
    [InlineData("{}")]
    [InlineData("{\"id\":1}")]
    [InlineData("[]")]
    public void Data_is_empty_for_a_non_array_or_missing_positions_body(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(TripReplayMapData.FromJson(doc.RootElement).Positions);
    }

    [Fact]
    public void Data_coerces_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"positions":[{"latitude":"3.5","longitude":"4.5","speed":"22"}]}""");
        var row = Assert.Single(TripReplayMapData.FromJson(doc.RootElement).Positions);

        Assert.Equal(3.5, row.Latitude);
        Assert.Equal(4.5, row.Longitude);
        Assert.Equal(22, row.SpeedMps);
    }

    // ---- Geo helpers (ported @/lib/geo) --------------------------------------------

    [Fact]
    public void Haversine_matches_a_known_short_distance()
    {
        // 0.001° of latitude ≈ 111 m on a meridian.
        double d = TripReplayGeo.HaversineMeters(47.6000, -122.3, 47.6010, -122.3);
        Assert.InRange(d, 105, 118);
    }

    [Theory]
    [InlineData(0.0, 0.0, false)]       // canonical "no GPS fix" sentinel is rejected
    [InlineData(91.0, 0.0, false)]      // out of latitude bounds
    [InlineData(0.0, 181.0, false)]     // out of longitude bounds
    [InlineData(47.6, -122.3, true)]
    public void IsValidLatLng_matches_the_web_rules(double lat, double lng, bool expected) =>
        Assert.Equal(expected, TripReplayGeo.IsValidLatLng(lat, lng));

    [Fact]
    public void IsValidLatLng_rejects_non_finite_coordinates()
    {
        Assert.False(TripReplayGeo.IsValidLatLng(double.NaN, 1));
        Assert.False(TripReplayGeo.IsValidLatLng(1, double.PositiveInfinity));
    }

    [Fact]
    public void HasMeaningfulRoute_is_true_when_two_fixes_exceed_ten_metres()
    {
        Assert.True(TripReplayGeo.HasMeaningfulRoute(Route().Positions));
        Assert.False(TripReplayGeo.HasMeaningfulRoute(Stationary().Positions));
    }

    [Fact]
    public void HasMeaningfulRoute_is_false_for_empty_or_all_invalid()
    {
        Assert.False(TripReplayGeo.HasMeaningfulRoute(Array.Empty<TripPositionSample>()));
        var invalid = new[] { new TripPositionSample(0, 0, null, null), new TripPositionSample(0, 0, null, null) };
        Assert.False(TripReplayGeo.HasMeaningfulRoute(invalid));
    }

    [Fact]
    public void FirstValidIndex_skips_invalid_leading_fixes()
    {
        var positions = new[]
        {
            new TripPositionSample(0, 0, null, null),
            new TripPositionSample(double.NaN, double.NaN, null, null),
            new TripPositionSample(47.6, -122.3, null, null),
        };
        Assert.Equal(2, TripReplayGeo.FirstValidIndex(positions));
        Assert.Equal(-1, TripReplayGeo.FirstValidIndex(Array.Empty<TripPositionSample>()));
    }

    [Fact]
    public void NearestSampleIndex_returns_the_closest_position()
    {
        var positions = Route().Positions;

        // Closest to the last fix (47.6020).
        Assert.Equal(2, TripReplayGeo.NearestSampleIndex(positions, 47.6021, -122.3));

        // Closest to the first fix (47.6000).
        Assert.Equal(0, TripReplayGeo.NearestSampleIndex(positions, 47.5999, -122.3));

        // Empty list never throws.
        Assert.Equal(0, TripReplayGeo.NearestSampleIndex(Array.Empty<TripPositionSample>(), 1, 1));
    }

    [Theory]
    [InlineData(10.0, TripReplayGeo.SpeedLowColorHex)]
    [InlineData(45.0, TripReplayGeo.SpeedMedColorHex)]
    [InlineData(80.0, TripReplayGeo.SpeedHighColorHex)]
    [InlineData(120.0, TripReplayGeo.SpeedOverColorHex)]
    public void SpeedColor_bands_match_the_web_thresholds(double speed, string expected) =>
        Assert.Equal(expected, TripReplayGeo.SpeedColorHex(speed));

    [Fact]
    public void ComputeHeading_is_zero_north_and_ninety_east()
    {
        double north = TripReplayGeo.ComputeHeadingDegrees(
            new TripPositionSample(0, 0, null, null), new TripPositionSample(1, 0, null, null));
        double east = TripReplayGeo.ComputeHeadingDegrees(
            new TripPositionSample(0, 0, null, null), new TripPositionSample(0, 1, null, null));

        Assert.InRange(north, 0, 0.001);
        Assert.InRange(east, 89.99, 90.01);
    }

    // ---- Projection (viewport + trail + segments + markers) ------------------------

    [Fact]
    public void Projection_of_a_route_builds_trail_segments_and_endpoints()
    {
        var display = TripReplayMapProjection.Project(Route(), Localizer);

        Assert.True(display.HasRoute);
        Assert.True(display.FitToTrail);
        Assert.Equal(TripReplayMapProjection.RouteZoom, display.Zoom);
        Assert.Equal(3, display.Trail.Count);
        Assert.Equal(2, display.Segments.Count); // n-1 legs
        Assert.False(display.ShowStationaryBanner);
        Assert.Null(display.AnchorPos);

        // Web parity: centerPos = startPos; start/end are the trail endpoints.
        Assert.Equal(47.6000, display.CenterLatitude, 4);
        Assert.Equal(47.6000, display.StartPos!.Value.Lat, 4);
        Assert.Equal(47.6020, display.EndPos!.Value.Lat, 4);

        // Web parity: each leg is coloured by the *current* sample's speed (45 → cyan, 80 → amber).
        Assert.Equal(TripReplayGeo.SpeedMedColorHex, display.Segments[0].ColorHex);
        Assert.Equal(TripReplayGeo.SpeedHighColorHex, display.Segments[1].ColorHex);
    }

    [Fact]
    public void Projection_of_a_stationary_drive_shows_anchor_and_banner()
    {
        var display = TripReplayMapProjection.Project(Stationary(), Localizer);

        Assert.False(display.HasRoute);
        Assert.True(display.ShowStationaryBanner);
        Assert.Empty(display.Segments);
        Assert.Empty(display.Trail);
        Assert.Null(display.StartPos);
        Assert.NotNull(display.AnchorPos);
        Assert.Equal(TripReplayMapProjection.AnchorZoom, display.Zoom);

        // Web parity: centerPos = anchorPoint when there is no startPos.
        Assert.Equal(47.6000, display.CenterLatitude, 4);
        Assert.Equal(47.6000, display.AnchorPos!.Value.Lat, 4);
    }

    [Fact]
    public void Projection_with_no_positions_defaults_the_center_and_hides_overlays()
    {
        var display = TripReplayMapProjection.Project(null, Localizer);

        Assert.False(display.HasContent);
        Assert.False(display.HasRoute);
        Assert.False(display.ShowStationaryBanner);
        Assert.Empty(display.Trail);
        Assert.Null(display.StartPos);
        Assert.Null(display.AnchorPos);
        Assert.Equal(TripReplayMapProjection.DefaultCenterLatitude, display.CenterLatitude);
        Assert.Equal(TripReplayMapProjection.DefaultCenterLongitude, display.CenterLongitude);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(RouteJson);

        var cached = TripReplayMapResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Positions.Count);

        var offline = TripReplayMapResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Positions.Count);

        var loaded = TripReplayMapResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, TripReplayMapResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, TripReplayMapResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TripReplayMapResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_the_route()
    {
        var vm = NewViewModel(
            RepositoryResult<TripReplayMapData>.Loading(),
            RepositoryResult<TripReplayMapData>.Loaded(Route(), Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Ready, vm.State);
        Assert.True(vm.Display.HasRoute);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_empty_body_is_whole_surface_empty()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
        Assert.False(vm.Display.HasContent);
    }

    [Fact]
    public async Task ViewModel_positions_without_a_route_stays_ready_with_the_banner()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Loaded(Stationary(), Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Ready, vm.State);
        Assert.True(vm.Display.ShowStationaryBanner);
        Assert.False(vm.HasPlayhead); // no route → no playhead
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_chip()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Cached(Route(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRoute);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_chip()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.OfflineCached(
            Route(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRoute);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_retry_state()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TripReplayMapState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.Display.HasContent);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
        Assert.False(string.IsNullOrEmpty(vm.ErrorText));
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeSource(RepositoryResult<TripReplayMapData>.Loaded(Route(), Now));
        using var vm = new TripReplayMapViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(TripReplayMapState.Ready, vm.State);
    }

    [Fact]
    public async Task ViewModel_status_announcement_tracks_the_state()
    {
        var stale = NewViewModel(RepositoryResult<TripReplayMapData>.Cached(Route(), Now, stale: true));
        await stale.LoadAsync();
        Assert.Equal(stale.StaleLabel, stale.StatusAnnouncement);

        var ready = NewViewModel(RepositoryResult<TripReplayMapData>.Loaded(Route(), Now));
        await ready.LoadAsync();
        Assert.Null(ready.StatusAnnouncement);
    }

    // ---- View-model playhead (web currentIndex ⇄ onSeekToIndex) --------------------

    [Fact]
    public async Task ViewModel_current_index_clamps_to_the_resolved_positions()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Loaded(Route(), Now));
        await vm.LoadAsync();

        vm.CurrentIndex = 99;
        Assert.Equal(2, vm.CurrentIndex); // 3 positions → max index 2

        vm.CurrentIndex = -5;
        Assert.Equal(0, vm.CurrentIndex);

        Assert.True(vm.HasPlayhead);
        Assert.Equal(47.6000, vm.CurrentLocation!.Value.Lat, 4);
    }

    [Fact]
    public async Task ViewModel_seek_to_coordinate_moves_the_playhead_and_raises_seek()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Loaded(Route(), Now));
        await vm.LoadAsync();

        int? seeked = null;
        vm.SeekRequested += (_, idx) => seeked = idx;

        // A tap nearest the final fix should seek to index 2.
        vm.RequestSeekToCoordinate(47.6021, -122.3);

        Assert.Equal(2, seeked);
        Assert.Equal(2, vm.CurrentIndex);
        Assert.Equal(47.6020, vm.CurrentLocation!.Value.Lat, 4);
    }

    [Fact]
    public async Task ViewModel_no_playhead_when_no_route()
    {
        var vm = NewViewModel(RepositoryResult<TripReplayMapData>.Loaded(Stationary(), Now));
        await vm.LoadAsync();

        Assert.False(vm.HasPlayhead);
        Assert.Null(vm.CurrentLocation);
        Assert.Equal(0, vm.CurrentHeading);
    }

    // ---- Repository source (engine + fake client + vehicle source) -----------------

    [Fact]
    public async Task Source_resolves_primary_then_chains_drive_list_latest_detail()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":11,"start_ts":"2026-04-01T08:00:00Z"},{"id":55,"start_ts":"2026-04-04T10:00:00Z"}]""");
        using var detail = JsonDocument.Parse(RouteJson);

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement.Clone())
            .ReturnsValue(detail.RootElement.Clone());
        var source = new TripReplayMapSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Positions.Count);
        Assert.Equal(2, api.Requests.Count);

        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));

        // Newest by start_ts → id 55, read by path parameter.
        Assert.Equal(Operations.Drives.Detail, api.Requests[1].OperationId);
        Assert.Equal("55", api.Requests[1].PathParams!["driveID"]);
    }

    [Fact]
    public async Task Source_explicit_drive_id_skips_vehicle_and_list_resolution()
    {
        using var detail = JsonDocument.Parse(RouteJson);
        var api = new FakeApiClient().ReturnsValue(detail.RootElement.Clone());
        var source = new TripReplayMapSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: null, driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Drives.Detail, request.OperationId);
        Assert.Equal("42", request.PathParams!["driveID"]);
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new TripReplayMapSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new TripReplayMapSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
        Assert.Equal(Operations.Drives.List, Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_drive_with_no_positions_yields_empty()
    {
        using var detail = JsonDocument.Parse("""{"id":42,"positions":[]}""");
        var api = new FakeApiClient().ReturnsValue(detail.RootElement.Clone());
        var source = new TripReplayMapSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var detail = JsonDocument.Parse(RouteJson);
        var options = NewOptions();
        var engine = NewEngine();

        var ok = new TripReplayMapSource(
            new FakeVehicleSource(null), new FakeApiClient().ReturnsValue(detail.RootElement.Clone()),
            engine, options, driveId: 42);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new TripReplayMapSource(
            new FakeVehicleSource(null), new FakeApiClient().Throws(new HttpRequestException("offline")),
            engine, options, driveId: 42);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Positions.Count);
    }

    // ---- i18n facade coverage + accessibility + registry + diagnostics -------------

    [Fact]
    public void Every_surface_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = TripReplayMapProjection.Project(Route(), recorder);
        _ = TripReplayMapRegistration.StartLabel(recorder);
        _ = TripReplayMapRegistration.EndLabel(recorder);
        _ = TripReplayMapRegistration.AnchorLabel(recorder);
        _ = TripReplayMapRegistration.PlayheadLabel(recorder);
        _ = TripReplayMapRegistration.StaleLabel(recorder);
        _ = TripReplayMapRegistration.OfflineLabel(recorder);
        _ = TripReplayMapRegistration.RetryLabel(recorder);
        _ = TripReplayMapRegistration.LoadingLabel(recorder);
        _ = TripReplayMapRegistration.ErrorText(recorder);

        // The three web-source keys, plus the map label, marker labels and chrome keys, resolve through the facade.
        Assert.Contains("replay.map.noPositions", recorder.Keys);
        Assert.Contains("replay.map.stationaryRouteTitle", recorder.Keys);
        Assert.Contains("replay.map.stationaryRouteBody", recorder.Keys);
        Assert.Contains("replay.map.label", recorder.Keys);
        Assert.Contains("replay.map.startLabel", recorder.Keys);
        Assert.Contains("replay.map.endLabel", recorder.Keys);
        Assert.Contains("replay.map.anchorLabel", recorder.Keys);
        Assert.Contains("replay.map.playheadLabel", recorder.Keys);
        Assert.Contains("mqtt.stale", recorder.Keys);
        Assert.Contains("common.offline", recorder.Keys);
        Assert.Contains("common.retry", recorder.Keys);
        Assert.Contains("common.loading", recorder.Keys);
        Assert.Contains("error.loadFailed", recorder.Keys);
    }

    [Fact]
    public void Source_keys_carry_the_web_fallback_copy()
    {
        Assert.Equal("No position data available for this drive", TripReplayMapRegistration.NoPositions(Localizer));
        Assert.Equal("Route can't be plotted", TripReplayMapRegistration.StationaryRouteTitle(Localizer));
        Assert.StartsWith("Only one GPS coordinate", TripReplayMapRegistration.StationaryRouteBody(Localizer));
    }

    [Fact]
    public void Map_and_marker_labels_are_present_for_accessibility()
    {
        var display = TripReplayMapProjection.Project(Route(), Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.MapLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(display.RouteSummary));
        Assert.False(string.IsNullOrWhiteSpace(TripReplayMapRegistration.StartLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(TripReplayMapRegistration.EndLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(TripReplayMapRegistration.PlayheadLabel(Localizer)));
    }

    [Fact]
    public void Registration_exposes_a_stable_slug()
    {
        Assert.Equal("TripReplayMap", TripReplayMapRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new TripReplayMapDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=TripReplayMap", line);
        Assert.DoesNotContain("47.6", line, StringComparison.Ordinal);
    }

    // ---- helpers -------------------------------------------------------------------

    private static TripReplayMapData Route() => Parse(RouteJson);

    private static TripReplayMapData Stationary() => Parse(StationaryJson);

    private static TripReplayMapData Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return TripReplayMapData.FromJson(doc.RootElement);
    }

    private static TripReplayMapViewModel NewViewModel(params RepositoryResult<TripReplayMapData>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<TripReplayMapData>>> Collect(
        IAsyncEnumerable<RepositoryResult<TripReplayMapData>> stream)
    {
        var list = new List<RepositoryResult<TripReplayMapData>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource : ITripReplayMapSource
    {
        private readonly IReadOnlyList<RepositoryResult<TripReplayMapData>> _results;

        public FakeSource(params RepositoryResult<TripReplayMapData>[] results) => _results = results;

        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<TripReplayMapData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
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
