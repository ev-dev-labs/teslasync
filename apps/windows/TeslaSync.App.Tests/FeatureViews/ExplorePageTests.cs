using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Explore;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ExplorePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/explore/pages/ExplorePage.tsx): the two web data states (success / empty), the GlassPanel1
/// search + anchor strip, the categorised section bands, the recently-visited strip, the GlassPanel2 empty result
/// with "did you mean" suggestions, the per-item visibility gates (<c>minVehicles</c> / <c>requiresAuth</c>), the
/// catalogue filter / group helpers, the auth-mode parser and the view-model's state machine. The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the <see cref="ExploreDisplay"/>
/// flags asserted here.
/// </summary>
public sealed class ExplorePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 13 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "explore.anchorCountAria",
        "explore.empty.body",
        "explore.empty.clear",
        "explore.empty.didYouMean",
        "explore.empty.title",
        "explore.pageTitle",
        "explore.recent.heading",
        "explore.searchLabel",
        "explore.searchPlaceholder", // parity:allow i18n key ported verbatim from the web explore.searchPlaceholder key
        "explore.sectionsAriaLabel",
        "explore.subtitle.all",
        "explore.subtitle.filtered",
        "explore.title",
    ];

    private static ExploreModel Model(
        int vehicleCount = 0,
        bool isForwardAuth = false,
        string query = "",
        IReadOnlyList<string>? recentPaths = null) =>
        new(vehicleCount, isForwardAuth, query, recentPaths ?? Array.Empty<string>());

    // ---- i18n key coverage ----------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        ExploreProjection.Project(Model(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_required_keys_even_in_the_empty_state()
    {
        var recorder = new RecordingLocalizer();

        ExploreProjection.Project(Model(query: "zzqqxnomatch"), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Data-state matrix ----------------------------------------------------------

    [Fact]
    public void Projection_default_is_the_success_state_with_section_bands()
    {
        var display = ExploreProjection.Project(Model(), Localizer);

        Assert.Equal(ExploreState.Success, display.State);
        Assert.True(display.ShowSections);
        Assert.False(display.ShowEmpty);
        Assert.NotEmpty(display.Sections);
        Assert.NotEmpty(display.Anchors);
        Assert.True(display.TotalFeatures > 0);
        Assert.Equal(display.TotalFeatures, display.MatchCount);
    }

    [Fact]
    public void Projection_unmatched_query_is_the_empty_state_with_suggestions()
    {
        var display = ExploreProjection.Project(Model(query: "zzqqxnomatch"), Localizer);

        Assert.Equal(ExploreState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowSections);
        Assert.Empty(display.Sections);
        Assert.True(display.ShowSuggestions);
        Assert.NotEmpty(display.Suggestions);
        Assert.Equal(0, display.MatchCount);
        // web empty.title interpolates the query verbatim.
        Assert.Contains("zzqqxnomatch", display.EmptyTitle, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_matching_query_filters_to_a_subset()
    {
        var all = ExploreProjection.Project(Model(), Localizer);
        var filtered = ExploreProjection.Project(Model(query: "battery"), Localizer);

        Assert.Equal(ExploreState.Success, filtered.State);
        Assert.True(filtered.MatchCount > 0);
        Assert.True(filtered.MatchCount < all.TotalFeatures);
        Assert.Equal(all.TotalFeatures, filtered.TotalFeatures);
    }

    // ---- Panels / strings -----------------------------------------------------------

    [Fact]
    public void Projection_resolves_the_search_panel_strings()
    {
        var display = ExploreProjection.Project(Model(), Localizer);

        Assert.Equal("Explore features", display.Title);
        Assert.Equal("Explore features", display.WindowTitle);
        Assert.Equal("Filter features", display.SearchLabel);
        Assert.Equal(
            "Filter features by name, section, or description (press / to focus)",
            display.SearchHint);
        Assert.Equal("Jump to section", display.SectionsAriaLabel);
        Assert.Equal("Recently visited", display.RecentHeading);
    }

    [Fact]
    public void Projection_resolves_the_empty_panel_strings()
    {
        var display = ExploreProjection.Project(Model(query: "zzqqxnomatch"), Localizer);

        Assert.Equal("Did you mean", display.EmptyDidYouMean);
        Assert.Equal("Clear filter", display.EmptyClear);
        Assert.False(string.IsNullOrEmpty(display.EmptyBody));
    }

    [Fact]
    public void Projection_subtitle_switches_between_all_and_filtered()
    {
        var all = ExploreProjection.Project(Model(), Localizer);
        var filtered = ExploreProjection.Project(Model(query: "battery"), Localizer);

        Assert.Contains("Every feature in TeslaSync", all.Subtitle, StringComparison.Ordinal);
        Assert.Contains(all.TotalFeatures.ToString(System.Globalization.CultureInfo.CurrentCulture), all.Subtitle, StringComparison.Ordinal);

        Assert.Contains("battery", filtered.Subtitle, StringComparison.Ordinal);
        Assert.Contains("match", filtered.Subtitle, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_anchor_chips_carry_match_counts_and_aria()
    {
        var display = ExploreProjection.Project(Model(), Localizer);

        Assert.NotEmpty(display.Anchors);
        foreach (var anchor in display.Anchors)
        {
            Assert.True(anchor.Count > 0);
            Assert.Contains(anchor.Count.ToString(System.Globalization.CultureInfo.CurrentCulture), anchor.CountAria, StringComparison.Ordinal);
            Assert.Contains("features", anchor.CountAria, StringComparison.Ordinal);
        }
    }

    // ---- Catalogue gating -----------------------------------------------------------

    [Fact]
    public void Catalog_hides_minVehicles_entries_until_the_threshold_is_met()
    {
        var none = ExploreCatalog.BuildVisible(vehicleCount: 0, isForwardAuth: false, Localizer);
        var two = ExploreCatalog.BuildVisible(vehicleCount: 2, isForwardAuth: false, Localizer);

        Assert.DoesNotContain(none, e => e.Path == "vehicle-comparison");
        Assert.Contains(two, e => e.Path == "vehicle-comparison");
    }

    [Fact]
    public void Catalog_hides_requiresAuth_entries_outside_forward_auth()
    {
        var open = ExploreCatalog.BuildVisible(vehicleCount: 0, isForwardAuth: false, Localizer);
        var forwardAuth = ExploreCatalog.BuildVisible(vehicleCount: 0, isForwardAuth: true, Localizer);

        Assert.DoesNotContain(open, e => e.Path == "account/2fa");
        Assert.Contains(forwardAuth, e => e.Path == "account/2fa");
    }

    [Fact]
    public void Catalog_decorates_known_routes_with_their_blurbs()
    {
        var visible = ExploreCatalog.BuildVisible(vehicleCount: 1, isForwardAuth: false, Localizer);

        var vehicles = Assert.Single(visible, e => e.Path == "vehicles");
        Assert.Equal("Manage every Tesla on your account \u2014 VIN, options, status.", vehicles.Description);
    }

    // ---- Filter / group / recent / suggestions --------------------------------------

    [Fact]
    public void Filter_is_case_insensitive_and_and_tokened()
    {
        var visible = ExploreCatalog.BuildVisible(0, false, Localizer);

        var battery = ExploreCatalog.Filter(visible, "BATTERY");
        Assert.NotEmpty(battery);
        Assert.All(battery, e =>
            Assert.Contains("battery", $"{e.Label} {e.SectionTitle} {e.Description} {e.Path}".ToLowerInvariant(), StringComparison.Ordinal));

        // Two tokens must both match somewhere in the haystack.
        var both = ExploreCatalog.Filter(visible, "battery health");
        Assert.All(both, e =>
        {
            string hay = $"{e.Label} {e.SectionTitle} {e.Description} {e.Path}".ToLowerInvariant();
            Assert.Contains("battery", hay, StringComparison.Ordinal);
            Assert.Contains("health", hay, StringComparison.Ordinal);
        });

        Assert.Empty(ExploreCatalog.Filter(visible, "zzqqxnomatch"));
    }

    [Fact]
    public void Group_preserves_section_order_and_counts()
    {
        var visible = ExploreCatalog.BuildVisible(0, false, Localizer);
        var sections = ExploreCatalog.Group(visible);

        Assert.NotEmpty(sections);
        Assert.Equal(visible.Count, sections.Sum(s => s.Count));
        foreach (var section in sections)
        {
            Assert.Equal(section.Count, section.Entries.Count);
            Assert.False(string.IsNullOrEmpty(section.Slug));
        }
    }

    [Fact]
    public void ResolveRecent_maps_paths_to_visible_entries_dedupes_and_caps()
    {
        var visible = ExploreCatalog.BuildVisible(0, false, Localizer);
        var recent = ExploreCatalog.ResolveRecent(
            new[] { "vehicles", "vehicles", "/charging", "this-route-does-not-exist", "battery" },
            visible,
            limit: 6);

        Assert.Equal(new[] { "vehicles", "charging", "battery" }, recent.Select(r => r.Path));
    }

    [Fact]
    public void ResolveRecent_respects_the_limit()
    {
        var visible = ExploreCatalog.BuildVisible(0, false, Localizer);
        var recent = ExploreCatalog.ResolveRecent(
            new[] { "vehicles", "charging", "battery", "drives", "settings" },
            visible,
            limit: 2);

        Assert.Equal(2, recent.Count);
    }

    [Fact]
    public void ClosestEntries_suggests_the_nearest_visible_routes()
    {
        var visible = ExploreCatalog.BuildVisible(0, false, Localizer);

        var suggestions = ExploreCatalog.ClosestEntries("vehicels", visible, 5);

        Assert.NotEmpty(suggestions);
        Assert.True(suggestions.Count <= 5);
        Assert.Contains(suggestions, s => s.Path == "vehicles");
    }

    [Theory]
    [InlineData("Dashboard", "dashboard")]
    [InlineData("Battery & Energy", "battery-energy")]
    [InlineData("Maps & Location", "maps-location")]
    public void Slugify_lowercases_and_dashes_non_alphanumerics(string input, string expected) =>
        Assert.Equal(expected, ExploreCatalog.Slugify(input));

    // ---- Auth-mode parser -----------------------------------------------------------

    [Theory]
    [InlineData("{\"mode\":\"forward_auth\"}", true)]
    [InlineData("{\"auth_mode\":\"forward_auth\"}", true)]
    [InlineData("{\"mode\":\"open\"}", false)]
    [InlineData("{}", false)]
    [InlineData("[]", false)]
    public void ParseIsForwardAuth_reads_the_deployment_mode(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, ExploreClientFeed.ParseIsForwardAuth(doc.RootElement));
    }

    // ---- View-model -----------------------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_gating_reads_and_projects_success()
    {
        using var viewModel = new ExplorePageViewModel(
            new FakeExploreFeed(vehicleCount: 2, isForwardAuth: true),
            Localizer,
            new StaticExploreRecentSource(new[] { "vehicles", "charging" }));

        await viewModel.LoadAsync();

        Assert.Equal(ExploreState.Success, viewModel.State);
        Assert.Contains(viewModel.Display.Sections, s => s.Entries.Any(e => e.Path == "vehicle-comparison"));
        Assert.Contains(viewModel.Display.Sections, s => s.Entries.Any(e => e.Path == "account/2fa"));
        Assert.True(viewModel.Display.ShowRecent);
        Assert.Equal(2, viewModel.Display.RecentEntries.Count);
    }

    [Fact]
    public async Task ViewModel_setQuery_filters_and_clearQuery_restores()
    {
        using var viewModel = new ExplorePageViewModel(
            new FakeExploreFeed(vehicleCount: 0, isForwardAuth: false),
            Localizer,
            new StaticExploreRecentSource(new[] { "vehicles" }));

        await viewModel.LoadAsync();
        int total = viewModel.Display.TotalFeatures;

        viewModel.SetQuery("battery");
        Assert.Equal("battery", viewModel.Query);
        Assert.True(viewModel.Display.MatchCount < total);
        // web: the recently-visited strip is hidden while filtering.
        Assert.False(viewModel.Display.ShowRecent);

        viewModel.ClearQuery();
        Assert.Equal(string.Empty, viewModel.Query);
        Assert.Equal(total, viewModel.Display.MatchCount);
        Assert.True(viewModel.Display.ShowRecent);
    }

    [Fact]
    public async Task ViewModel_swallows_feed_failures_into_open_mode()
    {
        using var viewModel = new ExplorePageViewModel(new ThrowingExploreFeed(), Localizer);

        await viewModel.LoadAsync();

        // A failed gating read degrades to open mode: requiresAuth + minVehicles entries stay hidden, page still works.
        Assert.Equal(ExploreState.Success, viewModel.State);
        Assert.DoesNotContain(viewModel.Display.Sections, s => s.Entries.Any(e => e.Path == "account/2fa"));
        Assert.DoesNotContain(viewModel.Display.Sections, s => s.Entries.Any(e => e.Path == "vehicle-comparison"));
    }

    private sealed class FakeExploreFeed : IExploreFeed
    {
        private readonly int _vehicleCount;
        private readonly bool _isForwardAuth;

        public FakeExploreFeed(int vehicleCount, bool isForwardAuth)
        {
            _vehicleCount = vehicleCount;
            _isForwardAuth = isForwardAuth;
        }

        public Task<int> FetchVehicleCountAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicleCount);

        public Task<bool> FetchIsForwardAuthAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_isForwardAuth);
    }

    private sealed class ThrowingExploreFeed : IExploreFeed
    {
        public Task<int> FetchVehicleCountAsync(CancellationToken cancellationToken) =>
            Task.FromException<int>(new InvalidOperationException("vehicles unavailable"));

        public Task<bool> FetchIsForwardAuthAsync(CancellationToken cancellationToken) =>
            Task.FromException<bool>(new InvalidOperationException("auth-mode unavailable"));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
