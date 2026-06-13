using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Sharing;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SharedDrivePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/sharing/pages/SharedDrivePage.tsx), the tolerant v1/v2 share-payload normalizer
/// (web <c>normalizeSharedDriveData</c>), the three-state matrix (loading / unavailable / success), the seven
/// conditional stat cards + vehicle badge + two chart panels + no-route fallback (the manifest's eleven panels),
/// the SI display-boundary unit conversions, the twenty <c>share.*</c> strings, and the generated-client feed's
/// request shaping (web <c>useSharedDrive</c>). The WinUI view is exercised by the app build; its per-section
/// visibility is driven entirely by the <see cref="SharedDrivePageDisplay"/> flags asserted here.
/// </summary>
public sealed class SharedDrivePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 20 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "share.avgSpeed",
        "share.battery",
        "share.distance",
        "share.duration",
        "share.efficiency",
        "share.elevGain",
        "share.elevTooltipLabel",
        "share.elevation",
        "share.elevation.aria",
        "share.expired.description",
        "share.expired.home",
        "share.expired.title",
        "share.footer",
        "share.header",
        "share.learnMore",
        "share.maxSpeed",
        "share.noMapData",
        "share.speed",
        "share.speed.aria",
        "share.speedTooltipLabel",
    ];

    private static readonly SharedDriveData FullData = new(
        Title: "SF to LA Road Trip",
        Description: "A scenic coastal drive",
        Drive: new SharedDriveInfo(
            Date: "2026-01-01",
            DistanceM: 12_000,
            DurationS: 1_800,
            StartAddress: "Home",
            EndAddress: "Office",
            StartBattery: 80,
            EndBattery: 60,
            ElevationGain: 150,
            ElevationLoss: 100,
            MaxSpeedMps: 30,
            AvgSpeedMps: 18,
            EfficiencyWhPerM: 0.15),
        Vehicle: new SharedVehicle("Model 3", "Pearl White"),
        MapPoints:
        [
            new SharedMapPoint(47.6, -122.3),
            new SharedMapPoint(47.65, -122.25),
            new SharedMapPoint(47.7, -122.2),
        ],
        ElevationProfile:
        [
            new SharedElevationPoint(0, 10),
            new SharedElevationPoint(1_000, 20),
        ],
        SpeedProfile:
        [
            new SharedSpeedPoint(0, 10),
            new SharedSpeedPoint(1_000, 20),
        ]);

    private static SharedDrivePageModel SuccessModel(SharedDriveData? data = null) =>
        new(new SharedDriveSnapshot(data ?? FullData), false, null);

    private static SharedDrivePageDisplay Project(SharedDrivePageModel model, UnitPref? units = null) =>
        SharedDrivePageProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ── i18n key coverage (all 20 manifest strings) ─────────────────────────────────

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_unique_keys() =>
        Assert.Equal(20, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = SharedDrivePageProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SharedDrivePageProjection.Project(SharedDrivePageModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_unavailable_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SharedDrivePageProjection.Project(
            new SharedDrivePageModel(SharedDriveSnapshot.Empty, false, "expired"),
            UnitPref.Metric,
            recorder,
            Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Expired_strings_use_the_web_fallback_copy()
    {
        var display = Project(new SharedDrivePageModel(SharedDriveSnapshot.Empty, false, "expired"));

        Assert.Equal("Share Link Unavailable", display.ExpiredTitle);
        Assert.Equal("This shared drive link has expired or been revoked.", display.ExpiredDescription);
        Assert.Equal("Go to TeslaSync", display.ExpiredHomeLabel);
    }

    // ── Three data states ────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_share_query_in_flight()
    {
        var display = Project(SharedDrivePageModel.Initial);

        Assert.Equal(SharedDriveState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowExpired);
    }

    [Fact]
    public void State_empty_when_resolved_without_data()
    {
        var display = Project(new SharedDrivePageModel(SharedDriveSnapshot.Empty, false, null));

        Assert.Equal(SharedDriveState.Empty, display.State);
        Assert.True(display.ShowExpired);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_read_failed_like_an_expired_link()
    {
        var display = Project(new SharedDrivePageModel(SharedDriveSnapshot.Empty, false, "404"));

        Assert.Equal(SharedDriveState.Empty, display.State);
        Assert.True(display.ShowExpired);
    }

    [Fact]
    public void State_success_when_a_shared_drive_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(SharedDriveState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowExpired);
        Assert.False(display.ShowLoading);
    }

    // ── Title block ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_block_carries_the_title_description_date_and_route()
    {
        var display = Project(SuccessModel());

        Assert.Equal("SF to LA Road Trip", display.Title);
        Assert.Equal("A scenic coastal drive", display.Description);
        Assert.Equal("2026-01-01", display.DateText);
        Assert.Equal("Home \u2192 Office", display.RouteText);
    }

    [Fact]
    public void Route_text_is_null_without_both_endpoints()
    {
        var data = FullData with { Drive = FullData.Drive with { EndAddress = null } };

        Assert.Null(Project(SuccessModel(data)).RouteText);
    }

    // ── Panels 1-7: stat cards (visibility + values) ─────────────────────────────────

    [Fact]
    public void All_seven_stat_cards_are_visible_with_full_data()
    {
        var display = Project(SuccessModel());

        Assert.True(display.Distance.Visible);
        Assert.True(display.Duration.Visible);
        Assert.True(display.Efficiency.Visible);
        Assert.True(display.Battery.Visible);
        Assert.True(display.MaxSpeed.Visible);
        Assert.True(display.AvgSpeed.Visible);
        Assert.True(display.ElevationGain.Visible);
    }

    [Fact]
    public void Stat_cards_format_metric_values_at_the_display_boundary()
    {
        var display = Project(SuccessModel());

        Assert.Equal("12.0 km", display.Distance.Value);
        Assert.Equal("30m", display.Duration.Value);
        Assert.Equal("150 Wh/km", display.Efficiency.Value);
        Assert.Equal("80% \u2192 60%", display.Battery.Value);
        Assert.Equal("108 km/h", display.MaxSpeed.Value);
        Assert.Equal("65 km/h", display.AvgSpeed.Value);
        Assert.Equal("150 m", display.ElevationGain.Value);
    }

    [Fact]
    public void Stat_cards_format_imperial_values_at_the_display_boundary()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("7.5 mi", display.Distance.Value);
        Assert.Equal("241 Wh/mi", display.Efficiency.Value);
        Assert.Equal("492 ft", display.ElevationGain.Value);
        Assert.Equal("67 mph", display.MaxSpeed.Value);
    }

    [Fact]
    public void Duration_under_an_hour_renders_minutes_only()
    {
        var data = FullData with { Drive = FullData.Drive with { DurationS = 300 } };

        Assert.Equal("5m", Project(SuccessModel(data)).Duration.Value);
    }

    [Fact]
    public void Duration_over_an_hour_renders_hours_and_minutes()
    {
        var data = FullData with { Drive = FullData.Drive with { DurationS = 5_400 } };

        Assert.Equal("1h 30m", Project(SuccessModel(data)).Duration.Value);
    }

    [Fact]
    public void Optional_stat_cards_hide_when_their_measure_is_absent()
    {
        var data = FullData with
        {
            Drive = FullData.Drive with
            {
                EfficiencyWhPerM = null,
                StartBattery = null,
                EndBattery = null,
                MaxSpeedMps = null,
                AvgSpeedMps = null,
                ElevationGain = null,
            },
        };

        var display = Project(SuccessModel(data));

        Assert.True(display.Distance.Visible);
        Assert.True(display.Duration.Visible);
        Assert.False(display.Efficiency.Visible);
        Assert.False(display.Battery.Visible);
        Assert.False(display.MaxSpeed.Visible);
        Assert.False(display.AvgSpeed.Visible);
        Assert.False(display.ElevationGain.Visible);
    }

    [Fact]
    public void Battery_hides_when_only_one_endpoint_is_present()
    {
        var data = FullData with { Drive = FullData.Drive with { EndBattery = null } };

        Assert.False(Project(SuccessModel(data)).Battery.Visible);
    }

    // ── Panel 8: vehicle badge ───────────────────────────────────────────────────────

    [Fact]
    public void Vehicle_badge_shows_the_branded_model_and_colour()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ShowVehicle);
        Assert.Equal("Tesla Model 3", display.VehicleTitle);
        Assert.Equal("Pearl White", display.VehicleColor);
    }

    [Fact]
    public void Vehicle_badge_hides_without_a_vehicle()
    {
        var data = FullData with { Vehicle = null };

        Assert.False(Project(SuccessModel(data)).ShowVehicle);
    }

    // ── Panels 9-10: elevation + speed charts ────────────────────────────────────────

    [Fact]
    public void Elevation_chart_is_shown_with_converted_metric_points()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ShowElevation);
        Assert.Equal("Elevation Profile", display.ElevationTitle);
        Assert.Equal("Shared drive elevation profile area chart by distance", display.ElevationAria);
        Assert.Equal("m", display.ElevationUnit);
        Assert.Equal(new[] { new ChartPoint(0, 10), new ChartPoint(1, 20) }, display.ElevationData);
    }

    [Fact]
    public void Speed_chart_is_shown_with_converted_metric_points()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ShowSpeed);
        Assert.Equal("Speed Profile", display.SpeedTitle);
        Assert.Equal("Shared drive speed profile line chart by distance", display.SpeedAria);
        Assert.Equal("km/h", display.SpeedUnit);
        Assert.Equal(new[] { new ChartPoint(0, 36), new ChartPoint(1, 72) }, display.SpeedData);
    }

    [Fact]
    public void Elevation_chart_converts_to_feet_for_imperial_viewers()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("ft", display.ElevationUnit);
        Assert.Equal(10 / 0.3048, display.ElevationData[0].Y, 6);
    }

    [Fact]
    public void Charts_hide_when_their_profiles_are_empty()
    {
        var data = FullData with
        {
            ElevationProfile = Array.Empty<SharedElevationPoint>(),
            SpeedProfile = Array.Empty<SharedSpeedPoint>(),
        };

        var display = Project(SuccessModel(data));

        Assert.False(display.ShowElevation);
        Assert.False(display.ShowSpeed);
        Assert.Empty(display.ElevationData);
        Assert.Empty(display.SpeedData);
    }

    // ── Panel 11: no-route fallback ──────────────────────────────────────────────────

    [Fact]
    public void No_route_fallback_shows_only_when_map_and_both_charts_are_empty()
    {
        var bare = FullData with
        {
            MapPoints = Array.Empty<SharedMapPoint>(),
            ElevationProfile = Array.Empty<SharedElevationPoint>(),
            SpeedProfile = Array.Empty<SharedSpeedPoint>(),
        };

        var display = Project(SuccessModel(bare));

        Assert.True(display.ShowNoData);
        Assert.Equal("Route data is not available for this shared drive.", display.NoMapDataMessage);
        Assert.False(display.ShowMap);
    }

    [Fact]
    public void No_route_fallback_hidden_when_any_section_has_data()
    {
        Assert.False(Project(SuccessModel()).ShowNoData);
    }

    // ── Hero map (MapContainer + Polyline + start/end CircleMarkers) ──────────────────

    [Fact]
    public void Map_renders_the_trail_centre_and_endpoints()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ShowMap);
        Assert.Equal(3, display.Trail.Count);
        Assert.Equal(7, display.Zoom);
        Assert.Equal(new GeoPoint(47.65, -122.25), display.Center);
        Assert.Equal(new GeoPoint(47.6, -122.3), display.StartMarker);
        Assert.Equal(new GeoPoint(47.7, -122.2), display.EndMarker);
        Assert.Equal("Start", display.StartLabel);
        Assert.Equal("End", display.EndLabel);
    }

    [Fact]
    public void Map_hides_with_a_single_or_no_coordinate()
    {
        var single = FullData with { MapPoints = [new SharedMapPoint(47.6, -122.3)] };

        var display = Project(SuccessModel(single));

        Assert.False(display.ShowMap);
        Assert.Null(display.EndMarker);
    }

    // ── Tolerant v1/v2 normalizer (web normalizeSharedDriveData) ─────────────────────

    [Fact]
    public void Share_payload_parses_the_v2_si_envelope()
    {
        var data = SharedDriveData.FromJson(Json(
            """
            {
              "payload_version": "v2",
              "title": "Trip",
              "description": "Desc",
              "drive": {
                "date": "2026-01-01",
                "distance_m": 12000,
                "duration_s": 1800,
                "max_speed_mps": 30,
                "avg_speed_mps": 18,
                "efficiency_wh_per_m": 0.15,
                "start_battery": 80,
                "end_battery": 60,
                "elevation_gain": 150
              },
              "vehicle": { "model": "Model 3", "color": "Red" },
              "map_points": [ { "lat": 1, "lng": 2 } ],
              "elevation_profile": [ { "distance_m": 1000, "elevation_m": 20 } ],
              "speed_profile": [ { "distance_m": 1000, "speed_mps": 25 } ]
            }
            """));

        Assert.NotNull(data);
        Assert.Equal("Trip", data!.Title);
        Assert.Equal(12_000, data.Drive.DistanceM);
        Assert.Equal(1_800, data.Drive.DurationS);
        Assert.Equal(30, data.Drive.MaxSpeedMps);
        Assert.Equal(0.15, data.Drive.EfficiencyWhPerM);
        Assert.Equal("Model 3", data.Vehicle!.Model);
        Assert.Equal(new SharedElevationPoint(1_000, 20), data.ElevationProfile[0]);
        Assert.Equal(new SharedSpeedPoint(1_000, 25), data.SpeedProfile[0]);
    }

    [Fact]
    public void Share_payload_upgrades_the_legacy_v1_envelope_to_si()
    {
        var data = SharedDriveData.FromJson(Json(
            """
            {
              "title": "Trip",
              "drive": {
                "date": "2026-01-01",
                "distance_km": 12,
                "duration_min": 30,
                "max_speed_kmh": 108,
                "avg_speed_kmh": 64.8,
                "efficiency_wh_km": 150
              },
              "map_points": [ { "lat": 1, "lng": 2 } ],
              "elevation_profile": [ { "distance_km": 1, "elevation_m": 20 } ],
              "speed_profile": [ { "distance_km": 1, "speed_kmh": 90 } ]
            }
            """));

        Assert.NotNull(data);
        Assert.Equal(12_000, data!.Drive.DistanceM);
        Assert.Equal(1_800, data.Drive.DurationS);
        Assert.Equal(30, data.Drive.MaxSpeedMps);
        Assert.Equal(18, data.Drive.AvgSpeedMps);
        Assert.Equal(0.15, data.Drive.EfficiencyWhPerM!.Value, 6);
        Assert.Equal(new SharedElevationPoint(1_000, 20), data.ElevationProfile[0]);
        Assert.Equal(1_000, data.SpeedProfile[0].DistanceM);
        Assert.Equal(25, data.SpeedProfile[0].SpeedMps);
    }

    [Fact]
    public void Share_payload_from_a_non_object_or_driveless_body_is_null()
    {
        Assert.Null(SharedDriveData.FromJson(Json("[]")));
        Assert.Null(SharedDriveData.FromJson(Json("null")));
        Assert.Null(SharedDriveData.FromJson(Json("{\"error\":\"expired\"}")));
    }

    // ── Generated-client feed request shaping (web useSharedDrive) ────────────────────

    [Fact]
    public async Task Client_feed_reads_the_share_token()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            "{\"payload_version\":\"v2\",\"title\":\"T\",\"drive\":{\"date\":\"d\",\"distance_m\":1,\"duration_s\":1}}"));
        var feed = new SharedDrivePageClientFeed(api);

        var snapshot = await feed.FetchAsync("tok123", CancellationToken.None);

        Assert.True(snapshot.HasData);
        Assert.Single(api.Requests);
        Assert.Equal(SharedDrivePageRegistration.ShareOperation, api.Requests[0].OperationId);
        Assert.Equal("tok123", api.Requests[0].PathParams![SharedDrivePageRegistration.TokenParam]);
    }

    [Fact]
    public async Task Client_feed_never_fetches_for_an_empty_token()
    {
        var api = new FakeApiClient();
        var feed = new SharedDrivePageClientFeed(api);

        var snapshot = await feed.FetchAsync(string.Empty, CancellationToken.None);

        Assert.False(snapshot.HasData);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_snapshot()
    {
        var snapshot = await EmptySharedDrivePageFeed.Instance.FetchAsync("tok", CancellationToken.None);

        Assert.False(snapshot.HasData);
    }

    // ── View-model state folding ─────────────────────────────────────────────────────

    [Fact]
    public async Task View_model_folds_a_resolved_drive_into_the_success_state()
    {
        var vm = new SharedDrivePageViewModel(
            new StubFeed(new SharedDriveSnapshot(FullData)),
            Localizer,
            "tok",
            clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(SharedDriveState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task View_model_surfaces_a_failed_read_as_the_unavailable_state()
    {
        var vm = new SharedDrivePageViewModel(new ThrowingFeed(), Localizer, "tok", clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(SharedDriveState.Empty, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowExpired);
    }

    [Fact]
    public void View_model_exposes_its_token_and_registration_operation()
    {
        var vm = new SharedDrivePageViewModel(
            EmptySharedDrivePageFeed.Instance,
            Localizer,
            "abc",
            clock: () => Now);

        Assert.Equal("abc", vm.Token);
        Assert.Equal("get_api_v1_share_token", SharedDrivePageRegistration.ShareOperation);
        Assert.Equal("SharedDrive", SharedDrivePageRegistration.RouteName);
    }

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class StubFeed(SharedDriveSnapshot snapshot) : ISharedDrivePageFeed
    {
        public Task<SharedDriveSnapshot> FetchAsync(string token, CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingFeed : ISharedDrivePageFeed
    {
        public Task<SharedDriveSnapshot> FetchAsync(string token, CancellationToken cancellationToken) =>
            throw new ApiException("expired", 404);
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
