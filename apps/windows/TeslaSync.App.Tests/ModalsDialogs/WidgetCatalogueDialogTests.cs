using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the widget-catalogue dialog's UI-thread-free logic — the static catalogue (every web
/// <c>WIDGET_REGISTRY</c> entry, per-category membership, unique ids, renderable glyphs), the
/// <see cref="WidgetCatalogueProjection"/> (category-ordered grouping, the name/description/id + category-label
/// search filter, the visible count and the empty branch), the state-holder view-model's state matrix
/// (loading / loaded / empty, search reset on open + close, the active-widget set driving the Added badge + count,
/// the add → raise-and-close path and the already-added no-op), the registration metadata + i18n keys and the
/// diagnostics. The WinUI view itself (which references Microsoft.UI) is exercised by the app build; this project
/// asserts every state and branch the web spec
/// (web/src/features/dashboard/components/WidgetCatalogueDialog.tsx) renders, headlessly.
/// </summary>
public sealed class WidgetCatalogueDialogTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Catalogue integrity (web WIDGET_REGISTRY parity) -------------------------------

    [Fact]
    public void Catalogue_total_matches_web_registry()
    {
        Assert.Equal(118, WidgetCatalogue.Instance.Entries.Count);
    }

    [Theory]
    [InlineData(WidgetCategory.Vehicle, 16)]
    [InlineData(WidgetCategory.Battery, 10)]
    [InlineData(WidgetCategory.Energy, 9)]
    [InlineData(WidgetCategory.Driving, 13)]
    [InlineData(WidgetCategory.Charging, 13)]
    [InlineData(WidgetCategory.Climate, 4)]
    [InlineData(WidgetCategory.Tires, 2)]
    [InlineData(WidgetCategory.Security, 7)]
    [InlineData(WidgetCategory.Commands, 2)]
    [InlineData(WidgetCategory.Media, 2)]
    [InlineData(WidgetCategory.Telemetry, 5)]
    [InlineData(WidgetCategory.Analytics, 14)]
    [InlineData(WidgetCategory.Alerts, 2)]
    [InlineData(WidgetCategory.Automations, 2)]
    [InlineData(WidgetCategory.System, 12)]
    [InlineData(WidgetCategory.Maps, 5)]
    public void Catalogue_per_category_counts_match_web_registry(WidgetCategory category, int expected)
    {
        int actual = WidgetCatalogue.Instance.Entries.Count(e => e.Category == category);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Catalogue_ids_are_unique()
    {
        IReadOnlyList<WidgetCatalogueEntry> entries = WidgetCatalogue.Instance.Entries;
        Assert.Equal(entries.Count, entries.Select(e => e.Id).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Catalogue_entries_have_nonempty_fields_and_renderable_glyphs()
    {
        foreach (WidgetCatalogueEntry entry in WidgetCatalogue.Instance.Entries)
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.Id));
            Assert.False(string.IsNullOrWhiteSpace(entry.Name));
            Assert.False(string.IsNullOrWhiteSpace(entry.Description));

            // Segoe Fluent Icons glyphs are single Private-Use-Area code points (U+E000..U+F8FF).
            Assert.Single(entry.Glyph);
            char glyph = entry.Glyph[0];
            Assert.InRange(glyph, '\uE000', '\uF8FF');
        }
    }

    [Fact]
    public void Catalogue_every_category_is_represented()
    {
        foreach (WidgetCategory category in WidgetCatalogueProjection.CategoryOrder)
        {
            Assert.Contains(WidgetCatalogue.Instance.Entries, e => e.Category == category);
        }
    }

    // ---- Projection: grouping + ordering ------------------------------------------------

    [Fact]
    public void Group_orders_sections_by_category_declaration_order()
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Group(WidgetCatalogue.Instance.Entries, Localizer);

        WidgetCategory[] expected = WidgetCatalogueProjection.CategoryOrder.ToArray();
        Assert.Equal(expected, groups.Select(g => g.Category).ToArray());
    }

    [Fact]
    public void Group_keeps_entries_in_registry_order_within_a_category()
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Group(WidgetCatalogue.Instance.Entries, Localizer);

        WidgetCatalogueGroup vehicle = groups.First(g => g.Category == WidgetCategory.Vehicle);
        Assert.Equal("vehicle-hero", vehicle.Entries[0].Id);
        Assert.Equal("vehicle-hero-card", vehicle.Entries[1].Id);
    }

    [Fact]
    public void Project_without_search_returns_every_non_empty_category()
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Project(Sample(), Localizer, search: null);

        Assert.Equal(new[] { WidgetCategory.Vehicle, WidgetCategory.Battery }, groups.Select(g => g.Category).ToArray());
        Assert.Equal(3, WidgetCatalogueProjection.VisibleCount(groups));
    }

    [Theory]
    [InlineData("alpha", new[] { "a-one" })]
    [InlineData("gadget", new[] { "b-two" })]      // description match
    [InlineData("c-three", new[] { "c-three" })]   // id match
    [InlineData("ALPHA", new[] { "a-one" })]       // case-insensitive
    [InlineData("  beta  ", new[] { "b-two" })]    // trimmed
    [InlineData("zzz", new string[0])]              // no match
    public void Project_filters_by_name_description_or_id(string search, string[] expectedIds)
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Project(Sample(), Localizer, search);

        string[] ids = groups.SelectMany(g => g.Entries).Select(e => e.Id).OrderBy(x => x).ToArray();
        Assert.Equal(expectedIds.OrderBy(x => x).ToArray(), ids);
    }

    [Fact]
    public void Project_category_label_hit_returns_the_whole_section()
    {
        // The Vehicle fallback label is "Vehicle"; searching it surfaces every Vehicle widget even though none of
        // their names/descriptions contains "vehicle" (web categoryHit branch).
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Project(Sample(), Localizer, "vehicle");

        WidgetCatalogueGroup vehicle = Assert.Single(groups);
        Assert.Equal(WidgetCategory.Vehicle, vehicle.Category);
        Assert.Equal(new[] { "a-one", "b-two" }, vehicle.Entries.Select(e => e.Id).ToArray());
    }

    [Fact]
    public void Project_visible_count_sums_filtered_entries()
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Project(Sample(), Localizer, "a");   // alpha, gamma, b-two? "a" in haystacks

        Assert.Equal(WidgetCatalogueProjection.VisibleCount(groups), groups.Sum(g => g.Entries.Count));
    }

    // ---- ViewModel: state matrix --------------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading_until_opened()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);

        Assert.Equal(WidgetCatalogueState.Loading, vm.State);
        Assert.True(vm.IsLoading);

        vm.Open();

        Assert.Equal(WidgetCatalogueState.Loaded, vm.State);
        Assert.True(vm.HasGroups);
    }

    [Fact]
    public void ViewModel_search_narrows_to_empty_then_back()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();
        Assert.Equal(WidgetCatalogueState.Loaded, vm.State);

        vm.Search = "nonexistent";
        Assert.Equal(WidgetCatalogueState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.Equal(0, vm.VisibleCount);

        vm.Search = "alpha";
        Assert.Equal(WidgetCatalogueState.Loaded, vm.State);
        Assert.Equal(1, vm.VisibleCount);
    }

    [Fact]
    public void ViewModel_clear_search_restores_full_catalogue()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();
        vm.Search = "zzz";
        Assert.Equal(WidgetCatalogueState.Empty, vm.State);

        vm.ClearSearch();

        Assert.Equal(string.Empty, vm.Search);
        Assert.False(vm.IsFiltering);
        Assert.Equal(WidgetCatalogueState.Loaded, vm.State);
        Assert.Equal(3, vm.VisibleCount);
    }

    [Fact]
    public void ViewModel_open_resets_a_stale_search()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();
        vm.Search = "alpha";
        Assert.Equal("alpha", vm.Search);

        vm.Open();   // re-open

        Assert.Equal(string.Empty, vm.Search);
        Assert.False(vm.IsFiltering);
    }

    [Fact]
    public void ViewModel_close_resets_search()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();
        vm.Search = "beta";

        vm.Close();

        Assert.Equal(string.Empty, vm.Search);
    }

    [Fact]
    public void ViewModel_active_set_drives_added_state_count_and_subtitle()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.SetActiveWidgets(new[] { "a-one", "c-three" });
        vm.Open();

        Assert.Equal(2, vm.AddedCount);
        Assert.True(vm.IsAdded("a-one"));
        Assert.False(vm.IsAdded("b-two"));

        WidgetCatalogueEntry added = Sample().First(e => e.Id == "a-one");
        WidgetCatalogueEntry notAdded = Sample().First(e => e.Id == "b-two");
        Assert.Equal("Added", vm.AddButtonLabel(added));
        Assert.Equal("Add", vm.AddButtonLabel(notAdded));
        Assert.Equal("Add Beta widget", vm.AddAccessibleName(notAdded));

        // web subtitle: "{{added}} of {{total}} widgets are already on your layout."
        Assert.Contains("2 of 3", vm.Subtitle);
    }

    [Fact]
    public void ViewModel_add_not_added_raises_add_then_close()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();

        var events = new List<string>();
        vm.WidgetAddRequested += (_, id) => events.Add($"add:{id}");
        vm.CloseRequested += (_, _) => events.Add("close");

        bool added = vm.Add("b-two");

        Assert.True(added);
        Assert.Equal(new[] { "add:b-two", "close" }, events.ToArray());
    }

    [Fact]
    public void ViewModel_add_already_added_is_a_noop()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.SetActiveWidgets(new[] { "a-one" });
        vm.Open();

        var events = new List<string>();
        vm.WidgetAddRequested += (_, id) => events.Add(id);
        vm.CloseRequested += (_, _) => events.Add("close");

        bool added = vm.Add("a-one");

        Assert.False(added);
        Assert.Empty(events);
    }

    [Fact]
    public void ViewModel_result_count_interpolates_count_and_total()
    {
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer);
        vm.Open();
        vm.Search = "alpha";   // 1 match of 3 total

        // web resultCount: "{{count}} of {{total}} widgets match"
        Assert.Equal("1 of 3 widgets match", vm.ResultCountText);
    }

    [Fact]
    public void ViewModel_open_records_view_opened_diagnostic()
    {
        var sink = new List<string>();
        var diagnostics = new WidgetCatalogueDialogDiagnostics(sink.Add);
        var vm = new WidgetCatalogueDialogViewModel(new InMemoryCatalogue(Sample()), Localizer, diagnostics);

        vm.Open();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetCatalogueDialog", Assert.Single(sink));
    }

    // ---- Registration + i18n keys -------------------------------------------------------

    [Fact]
    public void Registration_exposes_slug_and_localized_copy()
    {
        Assert.Equal("WidgetCatalogueDialog", WidgetCatalogueRegistration.Slug);
        Assert.Equal("Widget catalogue", WidgetCatalogueRegistration.Title(Localizer));
        Assert.Equal("Search widgets", WidgetCatalogueRegistration.SearchLabel(Localizer));
        Assert.Equal("Search widgets by name, description, or category\u2026", WidgetCatalogueRegistration.SearchPrompt(Localizer));
        Assert.Equal("No widgets match your search", WidgetCatalogueRegistration.EmptyTitle(Localizer));
        Assert.Equal("Clear search", WidgetCatalogueRegistration.ClearSearch(Localizer));
        Assert.Equal("Added", WidgetCatalogueRegistration.Added(Localizer));
        Assert.Equal("Add", WidgetCatalogueRegistration.Add(Localizer));
    }

    [Fact]
    public void Registration_interpolates_parameterized_copy()
    {
        Assert.Equal(
            "Pick a widget to add to your dashboard. 4 of 118 widgets are already on your layout.",
            WidgetCatalogueRegistration.Subtitle(Localizer, 4, 118));
        Assert.Equal("7 of 118 widgets match", WidgetCatalogueRegistration.ResultCount(Localizer, 7, 118));
        Assert.Equal(
            "Try a different keyword, or clear the search to browse all 118 widgets.",
            WidgetCatalogueRegistration.EmptyBody(Localizer, 118));
        Assert.Equal("Add Battery Level widget", WidgetCatalogueRegistration.AddLabel(Localizer, "Battery Level"));
    }

    [Fact]
    public void Registration_i18n_keys_match_web_source()
    {
        string[] keys =
        {
            WidgetCatalogueRegistration.TitleKey,
            WidgetCatalogueRegistration.SubtitleKey,
            WidgetCatalogueRegistration.SearchPromptKey,
            WidgetCatalogueRegistration.SearchLabelKey,
            WidgetCatalogueRegistration.ResultCountKey,
            WidgetCatalogueRegistration.EmptyTitleKey,
            WidgetCatalogueRegistration.EmptyBodyKey,
            WidgetCatalogueRegistration.ClearSearchKey,
            WidgetCatalogueRegistration.AddLabelKey,
            WidgetCatalogueRegistration.AddKey,
        };

        Assert.Equal(new[]
        {
            "translation.dashboard.catalogue.title",
            "translation.dashboard.catalogue.subtitle",
            "translation.dashboard.catalogue.searchPlaceholder", // parity:allow web i18n key is verbatim dashboard.catalogue.searchPlaceholder
            "translation.dashboard.catalogue.searchLabel",
            "translation.dashboard.catalogue.resultCount",
            "translation.dashboard.catalogue.emptyTitle",
            "translation.dashboard.catalogue.emptyBody",
            "translation.dashboard.catalogue.clearSearch",
            "translation.dashboard.catalogue.addLabel",
            "translation.dashboard.catalogue.add",
        }, keys);

        // web dashboard.added is shared with the rest of the dashboard, hence not under the catalogue namespace.
        Assert.Equal("translation.dashboard.added", WidgetCatalogueRegistration.AddedKey);
        Assert.Equal(keys.Length, keys.Distinct().Count());
        Assert.All(keys, k => Assert.StartsWith("translation.dashboard.catalogue.", k));
    }

    [Theory]
    [InlineData(WidgetCategory.Vehicle, "vehicle", "Vehicle")]
    [InlineData(WidgetCategory.Battery, "battery", "Battery & Range")]
    [InlineData(WidgetCategory.Maps, "maps", "Maps")]
    public void Registration_category_token_label_and_key(WidgetCategory category, string token, string label)
    {
        Assert.Equal(token, WidgetCatalogueRegistration.CategoryToken(category));
        Assert.Equal(label, WidgetCatalogueRegistration.CategoryFallbackLabel(category));
        Assert.Equal(label, WidgetCatalogueRegistration.CategoryLabel(Localizer, category));
        Assert.Equal("translation.dashboard.catalogue.category." + token, WidgetCatalogueRegistration.CategoryKey(category));
    }

    [Fact]
    public void Registration_every_category_has_a_renderable_glyph()
    {
        foreach (WidgetCategory category in WidgetCatalogueProjection.CategoryOrder)
        {
            string glyph = WidgetCatalogueRegistration.CategoryGlyph(category);
            Assert.Single(glyph);
            Assert.InRange(glyph[0], '\uE000', '\uF8FF');
        }
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new WidgetCatalogueDialogDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetCatalogueDialog", Assert.Single(sink));
    }

    // ---- helpers ------------------------------------------------------------------------

    private static IReadOnlyList<WidgetCatalogueEntry> Sample() =>
    [
        new() { Id = "a-one", Name = "Alpha", Description = "first widget", Category = WidgetCategory.Vehicle, Glyph = WidgetGlyphs.Car },
        new() { Id = "b-two", Name = "Beta", Description = "second gadget", Category = WidgetCategory.Vehicle, Glyph = WidgetGlyphs.Car },
        new() { Id = "c-three", Name = "Gamma", Description = "third thing", Category = WidgetCategory.Battery, Glyph = WidgetGlyphs.Battery },
    ];

    private sealed class InMemoryCatalogue : IWidgetCatalogue
    {
        public InMemoryCatalogue(IReadOnlyList<WidgetCatalogueEntry> entries) => Entries = entries;

        public IReadOnlyList<WidgetCatalogueEntry> Entries { get; }
    }
}
