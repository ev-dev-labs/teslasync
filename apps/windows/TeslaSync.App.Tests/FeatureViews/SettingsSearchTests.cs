using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SettingsSearch</c> surface's UI-thread-free logic — the find-as-you-type
/// matcher (substring / keyword / fuzzy scoring + stable order), the deep-link target parser, the localizer
/// -built settings index, the state-holder view-model's full state matrix (idle / results / empty), the
/// result cap, the registry metadata, the i18n facade coverage, the a11y copy, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/settings/components/SettingsSearch.tsx + searchIndex.ts). The WinUI
/// view itself (SettingsSearch.cs) is exercised by the app build; its per-state branch selection is driven
/// entirely by the view-model <see cref="SettingsSearchState"/> asserted here. A cross-check confirms every
/// indexed entry deep-links to a real route in the native RouteTable.
/// </summary>
public sealed class SettingsSearchTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Matcher: fuzzy subsequence (web fuzzyMatch) --------------------------------

    [Theory]
    [InlineData("lng", "Language", true)]
    [InlineData("lang", "Language", true)]
    [InlineData("LNG", "language", true)]
    [InlineData("xyz", "Language", false)]
    [InlineData("", "Language", false)]
    [InlineData("a", "", false)]
    public void FuzzyMatch_matches_in_order_case_insensitively(string needle, string haystack, bool expected) =>
        Assert.Equal(expected, SettingsSearchMatcher.FuzzyMatch(needle, haystack));

    // ---- Matcher: scoring tiers + ordering (web searchSettings) ---------------------

    [Fact]
    public void Search_ranks_tiers_exact_prefix_substring_keyword_then_description()
    {
        var index = new[]
        {
            E("descOnly", "Power draw", "battery level shown here"), // desc substring → 300
            E("keyword", "Power draw", "nothing", "battery"),         // keyword substring → 400
            E("substring", "Show battery info", "x"),                 // title substring → 600
            E("prefix", "Battery health", "x"),                       // title prefix → 800
            E("exact", "battery", "x"),                               // exact title → 1000
        };

        var ranked = SettingsSearchMatcher.Search(index, "battery").Select(e => e.Id).ToList();

        Assert.Equal(new[] { "exact", "prefix", "substring", "keyword", "descOnly" }, ranked);
    }

    [Fact]
    public void Search_preserves_original_order_for_equal_scores()
    {
        var index = new[]
        {
            E("a", "alpha foo", "x"), // title substring "foo" → 600
            E("b", "beta foo", "x"),  // title substring "foo" → 600
        };

        var ranked = SettingsSearchMatcher.Search(index, "foo").Select(e => e.Id).ToList();

        Assert.Equal(new[] { "a", "b" }, ranked);
    }

    [Fact]
    public void Search_uses_fuzzy_only_when_no_substring_match()
    {
        var index = new[] { E("fuzzy", "Language", "interface language") };

        Assert.Single(SettingsSearchMatcher.Search(index, "lng")); // fuzzy title → 200
        Assert.Empty(SettingsSearchMatcher.Search(index, "qqq"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Search_returns_nothing_for_an_empty_or_whitespace_query(string query) =>
        Assert.Empty(SettingsSearchMatcher.Search(new[] { E("a", "Alpha", "x") }, query));

    // ---- Navigation target parser (web commit's href split) -------------------------

    [Theory]
    [InlineData("/settings#general", "/settings", "general")]
    [InlineData("/settings#appearance", "/settings", "appearance")]
    [InlineData("/tesla-account", "/tesla-account", null)]
    [InlineData("/integrations/helix", "/integrations/helix", null)]
    [InlineData("/settings#", "/settings", null)]
    public void NavigationTarget_splits_path_and_section(string href, string path, string? section)
    {
        var target = SettingsNavigationTarget.FromHref(href);

        Assert.Equal(href, target.Href);
        Assert.Equal(path, target.Path);
        Assert.Equal(section, target.Section);
        Assert.Equal(section is not null, target.HasSection);
    }

    [Fact]
    public void ResolveTarget_returns_the_entrys_deep_link()
    {
        var target = SettingsSearchViewModel.ResolveTarget(E("x", "Title", "Desc"));

        Assert.Equal("/settings", target.Path);
        Assert.Equal("x", target.Section);
    }

    // ---- Index source (web getSettingsIndex) ----------------------------------------

    [Fact]
    public void Index_builds_every_web_entry_with_unique_ids_and_usable_fields()
    {
        var index = new SettingsIndexSource(Localizer).BuildIndex();

        Assert.Equal(53, index.Count);
        Assert.Equal(index.Count, index.Select(e => e.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(index, e =>
        {
            Assert.False(string.IsNullOrWhiteSpace(e.Title));
            Assert.False(string.IsNullOrWhiteSpace(e.Description));
            Assert.StartsWith("/", e.Href, StringComparison.Ordinal);
        });

        Assert.Contains(index, e => e.Id == "general.language" && e.Title == "Language");
        Assert.Contains(index, e => e.Id == "helix.integration" && e.Href == "/integrations/helix");
        Assert.Contains(index, e => e.Id == "general.units.pressure" && e.Keywords.Contains("psi"));
    }

    [Fact]
    public void Index_resolves_titles_and_descriptions_through_the_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = new SettingsIndexSource(recorder).BuildIndex();

        Assert.Contains("search.entries.general.language.title", recorder.Keys);
        Assert.Contains("search.entries.general.language.desc", recorder.Keys);
        Assert.Contains("search.entries.helix.integration.title", recorder.Keys);
        Assert.Contains("search.entries.tesla.connect.desc", recorder.Keys);
    }

    [Fact]
    public void Every_indexed_entry_deep_links_to_a_real_native_route()
    {
        var registry = new RouteRegistry();
        var index = new SettingsIndexSource(Localizer).BuildIndex();

        foreach (var entry in index)
        {
            var match = registry.Match(entry.Target.Path);
            Assert.False(
                match.IsCatchAll,
                $"{entry.Id} -> {entry.Target.Path} fell through to the catch-all route");
        }
    }

    // ---- View-model state matrix (idle / results / empty) ---------------------------

    [Fact]
    public void ViewModel_starts_idle_with_a_closed_dropdown()
    {
        var vm = NewViewModel();

        Assert.Equal(SettingsSearchState.Idle, vm.State);
        Assert.False(vm.ShowDropdown);
        Assert.Empty(vm.Rows);
        Assert.Empty(vm.Matches);
        Assert.Null(vm.StatusAnnouncement);
        Assert.Equal(53, vm.IndexedCount);
    }

    [Fact]
    public void ViewModel_matching_query_lists_actionable_results()
    {
        var vm = NewViewModel();

        vm.SetQuery("language");

        Assert.Equal(SettingsSearchState.Results, vm.State);
        Assert.True(vm.HasMatches);
        Assert.True(vm.ShowDropdown);
        Assert.All(vm.Rows, r => Assert.False(r.IsNoResults));
        Assert.Contains(vm.Matches, e => e.Id == "general.language");
        Assert.Null(vm.StatusAnnouncement);
    }

    [Fact]
    public void ViewModel_no_match_shows_the_no_results_note()
    {
        // A deterministic index whose only entry cannot fuzzy-match the query.
        var vm = new SettingsSearchViewModel(
            new FakeIndexSource(new[] { E("only", "Alpha", "beta gamma") }), Localizer);

        vm.SetQuery("zzzz");

        Assert.Equal(SettingsSearchState.Empty, vm.State);
        Assert.False(vm.HasMatches);
        Assert.True(vm.ShowDropdown);
        var row = Assert.Single(vm.Rows);
        Assert.True(row.IsNoResults);
        Assert.Equal("No matching settings.", row.PrimaryText);
        Assert.Equal("No matching settings.", vm.StatusAnnouncement);
    }

    [Fact]
    public void ViewModel_whitespace_query_is_treated_as_no_matches()
    {
        var vm = NewViewModel();

        vm.SetQuery("   ");

        // web: showDropdown = query.length > 0, but searchSettings trims to "" → no matches.
        Assert.Equal(SettingsSearchState.Empty, vm.State);
        Assert.True(vm.ShowDropdown);
        Assert.True(Assert.Single(vm.Rows).IsNoResults);
    }

    [Fact]
    public void ViewModel_caps_results_at_the_max()
    {
        var entries = Enumerable.Range(0, 12)
            .Select(i => E($"e{i}", $"Item {i}", "desc", "common"))
            .ToArray();
        var vm = new SettingsSearchViewModel(new FakeIndexSource(entries), Localizer);

        vm.SetQuery("common"); // keyword hit on all 12

        Assert.Equal(SettingsSearchRegistration.MaxResults, vm.Matches.Count);
        Assert.Equal(SettingsSearchRegistration.MaxResults, vm.Rows.Count);
        Assert.Equal(SettingsSearchState.Results, vm.State);
    }

    [Fact]
    public void ViewModel_clear_returns_to_idle()
    {
        var vm = NewViewModel();
        vm.SetQuery("language");
        Assert.Equal(SettingsSearchState.Results, vm.State);

        vm.Clear();

        Assert.Equal(SettingsSearchState.Idle, vm.State);
        Assert.Empty(vm.Rows);
        Assert.Equal(string.Empty, vm.Query);
    }

    [Fact]
    public void ViewModel_rows_carry_title_and_description_for_results()
    {
        var vm = NewViewModel();

        vm.SetQuery("language");

        var row = vm.Rows.Single(r => r.Entry?.Id == "general.language");
        Assert.Equal("Language", row.PrimaryText);
        Assert.False(string.IsNullOrWhiteSpace(row.SecondaryText));
        Assert.False(row.IsNoResults);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_state_and_rows()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetQuery("language");

        Assert.Contains(nameof(SettingsSearchViewModel.State), raised);
        Assert.Contains(nameof(SettingsSearchViewModel.Rows), raised);
        Assert.Contains(nameof(SettingsSearchViewModel.Query), raised);
    }

    // ---- i18n facade coverage + a11y copy -------------------------------------------

    [Fact]
    public void Component_strings_resolve_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = SettingsSearchRegistration.PromptText(recorder);
        _ = SettingsSearchRegistration.AriaLabel(recorder);
        _ = SettingsSearchRegistration.NoResultsText(recorder);

        Assert.Contains("settings.search.placeholder", recorder.Keys);
        Assert.Contains("settings.search.label", recorder.Keys);
        Assert.Contains("settings.search.noResults", recorder.Keys);
    }

    [Fact]
    public void Component_strings_have_accessible_fallbacks_matching_the_web()
    {
        Assert.Equal("Search settings\u2026", SettingsSearchRegistration.PromptText(Localizer));
        Assert.Equal("Search settings", SettingsSearchRegistration.AriaLabel(Localizer));
        Assert.Equal("No matching settings.", SettingsSearchRegistration.NoResultsText(Localizer));
    }

    [Fact]
    public void ViewModel_exposes_localized_accessibility_strings()
    {
        var vm = NewViewModel();

        Assert.Equal("Search settings", vm.AriaLabel);
        Assert.Equal("Search settings\u2026", vm.PromptText);
        Assert.False(string.IsNullOrWhiteSpace(vm.NoResultsText));
    }

    // ---- Registry metadata + diagnostics (view.opened, PII-safe) --------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_defaults()
    {
        Assert.Equal("settings-search", SettingsSearchRegistration.Id);
        Assert.Equal("SettingsSearch", SettingsSearchRegistration.Slug);
        Assert.Equal(8, SettingsSearchRegistration.MaxResults);
        Assert.False(string.IsNullOrEmpty(SettingsSearchRegistration.SearchGlyph));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SettingsSearchDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SettingsSearch", Assert.Single(sink));
    }

    // ---- helpers --------------------------------------------------------------------

    private static SettingsSearchViewModel NewViewModel() =>
        new(new SettingsIndexSource(Localizer), Localizer);

    private static SettingsEntry E(string id, string title, string description, params string[] keywords) =>
        new(id, "/settings#" + id, "section", title, description, keywords);

    private sealed class FakeIndexSource : ISettingsIndexSource
    {
        private readonly IReadOnlyList<SettingsEntry> _entries;

        public FakeIndexSource(IReadOnlyList<SettingsEntry> entries) => _entries = entries;

        public IReadOnlyList<SettingsEntry> BuildIndex() => _entries;
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
