using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Maps;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LocationsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/maps/pages/LocationsPage.tsx), the tolerant visited-locations parser, the four-state matrix
/// (loading / empty / error / success), the SI display formatting at the boundary, the client-side search filter
/// + pagination, and the generated-client feed's request shaping (web <c>useQuery(['visited-locations', …])</c>).
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="LocationsDisplay"/> flags asserted here.
/// </summary>
public sealed class LocationsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 28 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "All Locations", "Avg Visit", "Clear search", "Hours", "Last", "Locations", "Most Visited",
        "No locations", "No locations match your search", "No time-spent data available",
        "No visited location data", "No visited locations recorded yet",
        "Places you've been \u2014 ranked by frequency", "Search by address\u2026",
        "Top Locations by Time Spent (hours)", "Top Locations by Visits", "Total Time", "Total Visits",
        "Unique Cities", "Unique Places", "Visited Locations", "Visits", "avg",
        "locations.aiAutoName.applied", "locations.empty.cta", "locations.filterLabel.search", "total", "visits",
    ];

    private static VisitedLocation Loc(
        long id = 1,
        string name = "Home, Seattle",
        double visits = 10,
        double durationS = 36000,
        string? last = "2026-06-01T08:00:00Z") =>
        new(id, name, visits, durationS, last);

    private static IReadOnlyList<VisitedLocation> SampleLocations() =>
    [
        Loc(1, "Home, Seattle", 10, 36000, "2026-06-01T08:00:00Z"),
        Loc(2, "Work, Seattle", 8, 28800, "2026-06-02T09:00:00Z"),
        Loc(3, "Gym, Bellevue", 5, 9000, "2026-06-03T18:00:00Z"),
    ];

    private static LocationsModel SuccessModel(IReadOnlyList<VisitedLocation>? locations = null, string search = "", int page = 1) =>
        new(new LocationsSnapshot(locations ?? SampleLocations()), false, null, search, page, LocationsModel.DefaultPageSize);

    private static LocationsDisplay Project(LocationsModel model, UnitPref? units = null) =>
        LocationsProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 28 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = LocationsProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = LocationsProjection.Project(LocationsModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_eight_unique_keys() =>
        Assert.Equal(28, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(LocationsModel.Initial);

        Assert.Equal(LocationsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_locations()
    {
        var model = new LocationsModel(LocationsSnapshot.Empty, false, null, string.Empty, 1, LocationsModel.DefaultPageSize);
        var display = Project(model);

        Assert.Equal(LocationsState.Empty, display.State);
        // The web renders the full page chrome (cards + charts + list) even when empty — content shows, with the
        // list's own friendly empty surface.
        Assert.True(display.ShowContent);
        Assert.False(display.ListHasLocations);
        Assert.Equal("No visited locations recorded yet", display.ListEmptyMessage);
        Assert.Equal("View drives", display.ListEmptyActionLabel);
        Assert.False(display.ListEmptyActionIsClear);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = new LocationsModel(LocationsSnapshot.Empty, false, "network down", string.Empty, 1, LocationsModel.DefaultPageSize);
        var display = Project(model);

        Assert.Equal(LocationsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_locations_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(LocationsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ListHasLocations);
    }

    // ---- Summary metric cards ------------------------------------------------------

    [Fact]
    public void Metric_cards_project_six_tiles_with_web_aggregations()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.Metrics.Count);

        Assert.Equal("Unique Places", display.Metrics[0].Label);
        Assert.Equal("3", display.Metrics[0].Value);

        Assert.Equal("Unique Cities", display.Metrics[1].Label);
        Assert.Equal("2", display.Metrics[1].Value);   // {Seattle, Bellevue}

        Assert.Equal("Total Visits", display.Metrics[2].Label);
        Assert.Equal("23", display.Metrics[2].Value);  // 10 + 8 + 5

        Assert.Equal("Total Time", display.Metrics[3].Label);

        Assert.Equal("Most Visited", display.Metrics[4].Label);
        Assert.Equal("Home, Seattle", display.Metrics[4].Value);

        Assert.Equal("Avg Visit", display.Metrics[5].Label);
    }

    [Fact]
    public void Most_visited_falls_back_to_em_dash_when_top_location_unnamed()
    {
        var display = Project(SuccessModel([Loc(1, string.Empty, 4, 100, null)]));

        Assert.Equal("\u2014", display.Metrics[4].Value);
    }

    [Fact]
    public void Unique_cities_ignores_unknown_and_blank()
    {
        var locations = new[]
        {
            Loc(1, "A, Unknown", 1, 1, null),
            Loc(2, "B", 1, 1, null),
            Loc(3, string.Empty, 1, 1, null),
        };
        var display = Project(SuccessModel(locations));

        // "Unknown" and blank are excluded; "B" (no comma) counts as its own city.
        Assert.Equal("1", display.Metrics[1].Value);
    }

    // ---- Charts --------------------------------------------------------------------

    [Fact]
    public void Charts_have_data_with_brand_roles()
    {
        var display = Project(SuccessModel());

        Assert.True(display.VisitsChart.HasData);
        Assert.Equal(3, display.VisitsChart.Points.Count);
        Assert.Equal(ChartRole.Battery, display.VisitsChart.Role);   // web #10b981 green
        Assert.Equal(10, display.VisitsChart.Points[0].Y);           // top visit count

        Assert.True(display.TimeChart.HasData);
        Assert.Equal(ChartRole.Power, display.TimeChart.Role);       // web #a855f7 purple
        Assert.Equal(10, display.TimeChart.Points[0].Y);             // 36000s / 3600 = 10h
    }

    [Fact]
    public void Visits_chart_caps_at_fifteen_bars()
    {
        var many = Enumerable.Range(1, 30).Select(i => Loc(i, $"P{i}", 30 - i, 100, null)).ToArray();
        var display = Project(SuccessModel(many));

        Assert.Equal(LocationsProjection.VisitsChartLimit, display.VisitsChart.Points.Count);
        Assert.Equal(LocationsProjection.TimeChartLimit, display.TimeChart.Points.Count);
    }

    [Fact]
    public void Charts_empty_when_no_locations()
    {
        var model = new LocationsModel(LocationsSnapshot.Empty, false, null, string.Empty, 1, LocationsModel.DefaultPageSize);
        var display = Project(model);

        Assert.False(display.VisitsChart.HasData);
        Assert.False(display.TimeChart.HasData);
        Assert.Equal("No visited location data", display.VisitsChart.EmptyMessage);
        Assert.Equal("No time-spent data available", display.TimeChart.EmptyMessage);
    }

    // ---- All-locations list: rows, search, pagination ------------------------------

    [Fact]
    public void Rows_project_rank_name_and_visit_count()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.Rows.Count);
        Assert.Equal("#1", display.Rows[0].Rank);
        Assert.Equal("Home, Seattle", display.Rows[0].Name);
        Assert.Equal("10", display.Rows[0].VisitCountText);
        Assert.Contains("visits", display.Rows[0].Stats, StringComparison.Ordinal);
    }

    [Fact]
    public void Search_filters_rows_by_address_case_insensitively()
    {
        var display = Project(SuccessModel(search: "bellevue"));

        Assert.True(display.ListHasLocations);
        Assert.True(display.ListHasMatches);
        Assert.Single(display.Rows);
        Assert.Equal("Gym, Bellevue", display.Rows[0].Name);
        Assert.True(display.ShowFilterChip);
        Assert.Contains("Search", display.FilterChipLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Search_with_no_match_shows_the_search_empty_surface()
    {
        var display = Project(SuccessModel(search: "nowhere"));

        Assert.True(display.ListHasLocations);
        Assert.False(display.ListHasMatches);
        Assert.Empty(display.Rows);
        Assert.Equal("No locations match your search", display.ListEmptyMessage);
        Assert.Equal("Clear search", display.ListEmptyActionLabel);
        Assert.True(display.ListEmptyActionIsClear);
    }

    [Fact]
    public void Pagination_total_matches_web_formula_on_a_partial_page()
    {
        var display = Project(SuccessModel());

        // locations.Count (3) < pageSize (50) -> (page-1)*pageSize + count = 3.
        Assert.Equal(3, display.TotalItems);
        Assert.Equal(50, display.PageSize);
        Assert.Equal(1, display.Page);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Parser_reads_snake_case_wire_shape_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            [{"id":1,"address_name":"Home","visit_count":10,"total_duration_s":3600,"last_visited":"2026-06-01T08:00:00Z"},
             {"id":2,"address_name":"Work"}]
            """);

        var locations = LocationsSnapshot.ParseLocations(doc.RootElement);

        Assert.Equal(2, locations.Count);
        Assert.Equal(1, locations[0].Id);
        Assert.Equal("Home", locations[0].AddressName);
        Assert.Equal(10, locations[0].VisitCount);
        Assert.Equal(3600, locations[0].TotalDurationS);
        Assert.Equal(0, locations[1].VisitCount);
        Assert.Null(locations[1].LastVisited);
    }

    [Fact]
    public void Parser_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(LocationsSnapshot.ParseLocations(doc.RootElement));
    }

    [Fact]
    public void Average_duration_is_zero_without_visits() =>
        Assert.Equal(0, Loc(1, "X", 0, 5000, null).AverageDurationS);

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_requests_locations_scoped_to_vehicle_with_paging()
    {
        var api = new StubApiClient(_ => """[{"id":1,"address_name":"Home","visit_count":3,"total_duration_s":900}]""");
        var feed = new LocationsClientFeed(api, vehicleId: 42);

        var snapshot = await feed.FetchAsync(offset: 50, limit: 50, CancellationToken.None);

        Assert.True(snapshot.HasData);
        Assert.Single(snapshot.Locations);
        Assert.Single(api.Requests);
        var request = api.Requests[0];
        Assert.Equal(LocationsRegistration.ListOperation, request.OperationId);
        Assert.Equal(42L, request.Query!["vehicle_id"]);
        Assert.Equal(50, request.Query!["limit"]);
        Assert.Equal(50, request.Query!["offset"]);
    }

    [Fact]
    public async Task Feed_propagates_failure_as_error()
    {
        var api = new StubApiClient(_ => null);
        var feed = new LocationsClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(0, 50, CancellationToken.None));
    }

    // ---- View-model paging ---------------------------------------------------------

    [Fact]
    public async Task ViewModel_recomputes_offset_on_page_change()
    {
        var feed = new RecordingFeed();
        using var vm = new LocationsPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        Assert.Equal((0, 50), feed.LastCall);

        await vm.GoToPageAsync(3);
        Assert.Equal(3, vm.Page);
        Assert.Equal((100, 50), feed.LastCall);   // (3 - 1) * 50
    }

    [Fact]
    public async Task ViewModel_search_filters_without_refetch()
    {
        var feed = new RecordingFeed();
        using var vm = new LocationsPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        Assert.Equal(1, feed.Calls);

        vm.Search = "Bellevue";

        Assert.Equal(1, feed.Calls);   // no refetch
        Assert.Single(vm.Display.Rows);
        Assert.Equal("Gym, Bellevue", vm.Display.Rows[0].Name);
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

    private sealed class RecordingFeed : ILocationsFeed
    {
        public int Calls { get; private set; }

        public (int Offset, int Limit) LastCall { get; private set; }

        public Task<LocationsSnapshot> FetchAsync(int offset, int limit, CancellationToken cancellationToken)
        {
            Calls++;
            LastCall = (offset, limit);
            return Task.FromResult(new LocationsSnapshot(SampleLocations()));
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
