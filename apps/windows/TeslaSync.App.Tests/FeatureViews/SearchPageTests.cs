using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SearchPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/SearchPage.tsx), the tolerant <c>{hits, query}</c> parser, the six-branch
/// state matrix (too-short / empty-prompt / error / loading / no-results / results), the canonical-order
/// grouping, the facet rail, the relative-time display formatting, and the generated-client feed's request
/// shaping (web <c>useGlobalSearch</c> over <c>GET /search</c>). The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="SearchDisplay"/> flags asserted here.
/// </summary>
public sealed class SearchPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    // The 22 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "search.empty.message", "search.empty.title", "search.error.message", "search.error.title",
        "search.filters.clear", "search.input.label", "search.noResults.message", "search.noResults.title",
        "search.placeholder", "search.section.alert", "search.section.automation", "search.section.charging", // parity:allow web i18n key search.placeholder ported verbatim
        "search.section.drive", "search.section.geofence", "search.section.location", "search.section.notification",
        "search.section.results", "search.section.trip", "search.section.vehicle", "search.title",
        "search.tooShort.message", "search.tooShort.title",
    ];

    private static SearchHit Hit(
        SearchHitType type,
        long id,
        string title,
        string? subtitle = null,
        string? url = null,
        string? when = null) =>
        new(type, id, title, subtitle, url ?? $"/{SearchTypes.Wire(type)}/{id}", 1.0, when);

    private static IReadOnlyList<SearchHit> SampleHits() =>
    [
        Hit(SearchHitType.Drive, 3, "Drive 3", "12 mi", url: "/drives/3", when: "2026-06-15T10:30:00Z"),
        Hit(SearchHitType.Vehicle, 1, "Model 3", "Red", url: "/vehicles/1"),
        Hit(SearchHitType.Vehicle, 2, "Model Y", url: "/vehicles/2"),
        Hit(SearchHitType.Charging, 4, "Supercharger", url: "/charging/4"),
    ];

    private static SearchModel Model(
        string query,
        IReadOnlyList<SearchHit>? hits = null,
        bool loading = false,
        string? error = null,
        IReadOnlyList<SearchHitType>? types = null) =>
        new(new SearchSnapshot(hits ?? Array.Empty<SearchHit>(), query), loading, error, query, types ?? Array.Empty<SearchHitType>());

    private static SearchDisplay Project(SearchModel model) => SearchProjection.Project(model, Localizer, Now);

    // ---- i18n key coverage (all 22 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SearchProjection.Project(Model("model", SampleHits()), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_required_keys_even_in_the_empty_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SearchProjection.Project(Model(string.Empty), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- State matrix --------------------------------------------------------------

    [Fact]
    public void Too_short_query_shows_the_too_short_panel()
    {
        var display = Project(Model("a"));

        Assert.Equal(SearchState.TooShort, display.State);
        Assert.True(display.ShowTooShort);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowResults);
        Assert.Equal("Type at least 2 characters", display.TooShortTitle);
    }

    [Fact]
    public void Empty_query_shows_the_start_typing_prompt()
    {
        var display = Project(Model("   "));

        Assert.Equal(SearchState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("Start typing to search", display.EmptyTitle);
    }

    [Fact]
    public void Error_shows_the_error_panel()
    {
        var display = Project(Model("model", error: "search service down"));

        Assert.Equal(SearchState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Search failed", display.ErrorTitle);
    }

    [Fact]
    public void Loading_without_prior_results_shows_the_skeleton()
    {
        var display = Project(Model("model", loading: true));

        Assert.Equal(SearchState.Loading, display.State);
        Assert.True(display.ShowLoading);
    }

    [Fact]
    public void Loading_with_prior_results_keeps_the_results_panel()
    {
        // web prior-data cache: while refetching with prior groups, the results stay (no skeleton).
        var display = Project(Model("model", SampleHits(), loading: true));

        Assert.Equal(SearchState.Results, display.State);
        Assert.True(display.ShowResults);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void No_results_shows_the_no_results_panel_with_the_query_interpolated()
    {
        var display = Project(Model("zzz"));

        Assert.Equal(SearchState.NoResults, display.State);
        Assert.True(display.ShowNoResults);
        Assert.Equal("No matches for \"zzz\". Try fewer characters or open the command palette.", display.NoResultsMessage);
    }

    [Fact]
    public void Results_state_renders_groups_in_canonical_display_order()
    {
        var display = Project(Model("model", SampleHits()));

        Assert.Equal(SearchState.Results, display.State);
        Assert.True(display.ShowResults);

        // Vehicle precedes Drive precedes Charging (web ALL_TYPES order) regardless of hit order.
        Assert.Equal(3, display.Groups.Count);
        Assert.Equal(SearchHitType.Vehicle, display.Groups[0].Type);
        Assert.Equal(SearchHitType.Drive, display.Groups[1].Type);
        Assert.Equal(SearchHitType.Charging, display.Groups[2].Type);

        Assert.Equal(2, display.Groups[0].Count);          // two vehicles
        Assert.Equal("2", display.Groups[0].CountText);
        Assert.Equal("Vehicles", display.Groups[0].Label);
        Assert.Equal("Model 3", display.Groups[0].Rows[0].Title);
        Assert.Equal("/vehicles/1", display.Groups[0].Rows[0].Url);
    }

    [Fact]
    public void Result_row_formats_the_relative_timestamp_at_the_display_boundary()
    {
        var display = Project(Model("model", [Hit(SearchHitType.Drive, 3, "Drive 3", when: "2026-06-15T10:30:00Z")]));

        var row = display.Groups[0].Rows[0];
        Assert.True(row.HasWhen);
        Assert.Equal("1h ago", row.WhenText);   // 12:00Z now - 10:30Z = 90 min
    }

    [Fact]
    public void Result_row_without_a_timestamp_hides_the_when_text()
    {
        var display = Project(Model("model", [Hit(SearchHitType.Vehicle, 1, "Model 3")]));

        Assert.False(display.Groups[0].Rows[0].HasWhen);
        Assert.Equal(string.Empty, display.Groups[0].Rows[0].WhenText);
    }

    // ---- Facet rail ----------------------------------------------------------------

    [Fact]
    public void Facets_render_all_nine_types_with_active_state_reflecting_the_filter()
    {
        var display = Project(Model("model", SampleHits(), types: [SearchHitType.Drive]));

        Assert.Equal(9, display.Facets.Count);
        Assert.True(display.ShowClearFilters);

        var drive = display.Facets.Single(f => f.Type == SearchHitType.Drive);
        Assert.True(drive.Active);
        Assert.Equal("Drives", drive.Label);

        Assert.All(display.Facets.Where(f => f.Type != SearchHitType.Drive), f => Assert.False(f.Active));
    }

    [Fact]
    public void Facets_hide_the_clear_affordance_when_no_filter_is_active()
    {
        var display = Project(Model("model", SampleHits()));

        Assert.False(display.ShowClearFilters);
        Assert.All(display.Facets, f => Assert.False(f.Active));
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Parser_reads_the_envelope_and_skips_unknown_types()
    {
        using var doc = JsonDocument.Parse(
            """
            {"query":"m3","hits":[
              {"type":"vehicle","id":1,"title":"Model 3","subtitle":"Red","url":"/vehicles/1","score":9.5,"when":"2026-06-01T08:00:00Z"},
              {"type":"unknown","id":2,"title":"Mystery","url":"/x/2","score":1},
              {"type":"drive","id":3,"title":"Drive 3","url":"/drives/3","score":4}
            ]}
            """);

        var snapshot = SearchSnapshot.ParseResponse(doc.RootElement);

        Assert.Equal("m3", snapshot.Query);
        Assert.Equal(2, snapshot.Hits.Count);   // unknown type dropped
        Assert.Equal(SearchHitType.Vehicle, snapshot.Hits[0].Type);
        Assert.Equal("Model 3", snapshot.Hits[0].Title);
        Assert.Equal("Red", snapshot.Hits[0].Subtitle);
        Assert.Equal("/vehicles/1", snapshot.Hits[0].Url);
        Assert.Equal(SearchHitType.Drive, snapshot.Hits[1].Type);
    }

    [Fact]
    public void Parser_tolerates_missing_optional_fields()
    {
        using var doc = JsonDocument.Parse("""{"hits":[{"type":"vehicle","id":1,"title":"Model 3","url":"/vehicles/1"}]}""");

        var snapshot = SearchSnapshot.ParseResponse(doc.RootElement);

        Assert.Single(snapshot.Hits);
        Assert.Null(snapshot.Hits[0].Subtitle);
        Assert.Null(snapshot.Hits[0].When);
        Assert.Equal(0, snapshot.Hits[0].Score);
        Assert.Equal(string.Empty, snapshot.Query);
    }

    [Fact]
    public void Parser_returns_empty_for_a_non_object_body()
    {
        using var doc = JsonDocument.Parse("[]");
        var snapshot = SearchSnapshot.ParseResponse(doc.RootElement);

        Assert.False(snapshot.HasData);
        Assert.Empty(snapshot.Hits);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_shapes_the_request_with_q_limit_and_joined_types()
    {
        var api = new StubApiClient(_ => """{"query":"model 3","hits":[{"type":"vehicle","id":1,"title":"Model 3","url":"/vehicles/1"}]}""");
        var feed = new SearchClientFeed(api);

        var snapshot = await feed.FetchAsync("model 3", [SearchHitType.Vehicle, SearchHitType.Drive], 25, CancellationToken.None);

        Assert.True(snapshot.HasData);
        Assert.Single(api.Requests);
        var request = api.Requests[0];
        Assert.Equal(SearchRegistration.SearchOperation, request.OperationId);
        Assert.Equal("model 3", request.Query!["q"]);
        Assert.Equal(25, request.Query!["limit"]);
        Assert.Equal("vehicle,drive", request.Query!["types"]);
    }

    [Fact]
    public async Task Feed_omits_the_types_parameter_when_no_facet_is_active()
    {
        var api = new StubApiClient(_ => """{"query":"m3","hits":[]}""");
        var feed = new SearchClientFeed(api);

        _ = await feed.FetchAsync("m3", Array.Empty<SearchHitType>(), 25, CancellationToken.None);

        var request = api.Requests[0];
        Assert.False(request.Query!.ContainsKey("types"));
        Assert.Equal("m3", request.Query!["q"]);
    }

    [Fact]
    public async Task Feed_propagates_failure_as_error()
    {
        var api = new StubApiClient(_ => null);
        var feed = new SearchClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync("model", Array.Empty<SearchHitType>(), 25, CancellationToken.None));
    }

    // ---- View-model gating ---------------------------------------------------------

    [Fact]
    public async Task ViewModel_does_not_fetch_below_the_minimum_query_length()
    {
        var feed = new RecordingSearchFeed();
        using var vm = new SearchPageViewModel(feed, Localizer, () => Now);

        await vm.SetQueryAsync("a");

        Assert.Equal(0, feed.Calls);
        Assert.Equal(SearchState.TooShort, vm.State);
    }

    [Fact]
    public async Task ViewModel_fetches_and_surfaces_results_at_the_minimum_length()
    {
        var feed = new RecordingSearchFeed();
        using var vm = new SearchPageViewModel(feed, Localizer, () => Now);

        await vm.SetQueryAsync("model");

        Assert.Equal(1, feed.Calls);
        Assert.Equal("model", feed.LastQuery);
        Assert.Equal(25, feed.LastLimit);
        Assert.Equal(SearchState.Results, vm.State);
        Assert.NotEmpty(vm.Display.Groups);
    }

    [Fact]
    public async Task ViewModel_toggling_a_facet_refetches_with_the_type_filter()
    {
        var feed = new RecordingSearchFeed();
        using var vm = new SearchPageViewModel(feed, Localizer, () => Now);

        await vm.SetQueryAsync("model");
        await vm.ToggleTypeAsync(SearchHitType.Vehicle);

        Assert.Equal(2, feed.Calls);
        Assert.Contains(SearchHitType.Vehicle, vm.ActiveTypes);
        Assert.Contains(SearchHitType.Vehicle, feed.LastTypes);
    }

    [Fact]
    public async Task ViewModel_clearing_filters_refetches_without_any_type()
    {
        var feed = new RecordingSearchFeed();
        using var vm = new SearchPageViewModel(feed, Localizer, () => Now);

        await vm.SetQueryAsync("model");
        await vm.ToggleTypeAsync(SearchHitType.Vehicle);
        await vm.ClearFiltersAsync();

        Assert.Equal(3, feed.Calls);
        Assert.Empty(vm.ActiveTypes);
        Assert.Empty(feed.LastTypes);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var sink = new List<string>();
        var diagnostics = new SearchDiagnostics(sink.Add);
        using var vm = new SearchPageViewModel(EmptySearchFeed.Instance, Localizer, () => Now, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SearchPage", Assert.Single(sink));
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

    private sealed class RecordingSearchFeed : ISearchFeed
    {
        public int Calls { get; private set; }

        public string LastQuery { get; private set; } = string.Empty;

        public IReadOnlyList<SearchHitType> LastTypes { get; private set; } = Array.Empty<SearchHitType>();

        public int LastLimit { get; private set; }

        public Task<SearchSnapshot> FetchAsync(string query, IReadOnlyList<SearchHitType> types, int limit, CancellationToken cancellationToken)
        {
            Calls++;
            LastQuery = query;
            LastTypes = types;
            LastLimit = limit;
            return Task.FromResult(new SearchSnapshot(SampleHits(), query));
        }
    }

    private sealed class StubApiClient : IApiClient
    {
        private readonly Func<ApiRequest, string?> _responder;

        public StubApiClient(Func<ApiRequest, string?> responder) => _responder = responder;

        public List<ApiRequest> Requests { get; } = [];

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
