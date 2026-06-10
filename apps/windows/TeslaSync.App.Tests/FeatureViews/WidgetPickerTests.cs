using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>WidgetPicker</c> feature-view's UI-thread-free logic — the catalogue
/// adapter (the 118-widget registry + 10 presets ported from web/src/features/dashboard/widgets/registry and
/// <c>DASHBOARD_PRESETS</c>), the pure projection (search/category filtering, registry-ordered grouping,
/// recently-added slicing, the addable sets behind every "Add all", the per-card highlight runs + grid-size
/// caption + "Added" state, and the footer plural count), the i18n routing through the web's keys, the
/// accessibility names, the state-holder view-model's commands + events (add / add-many / preset / search /
/// category / open-close), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/WidgetPicker.tsx). The WinUI view itself
/// (feature-views\WidgetPicker\WidgetPicker.cs) is exercised by the app build. There is deliberately no
/// loading / error / stale / offline case because the web source is a controlled component over a static
/// catalogue with no asynchronous read — the only "no rows" surface is the search no-results state.
/// </summary>
public sealed class WidgetPickerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetPickerDisplay Project(
        WidgetPickerInteraction? interaction = null,
        WidgetPickerModel? model = null,
        ILocalizer? localizer = null) =>
        WidgetPickerProjection.Project(
            model ?? WidgetPickerModel.Default,
            interaction ?? WidgetPickerInteraction.Empty,
            localizer ?? Localizer);

    // ── Catalogue adapter (cached → projection): the ported registry + presets ───────────────────────

    [Fact]
    public void Catalogue_has_the_full_web_registry_of_118_widgets()
    {
        Assert.Equal(118, WidgetPickerCatalog.WidgetCount);
        Assert.Equal(118, WidgetPickerCatalog.DefaultWidgets.Count);
    }

    [Fact]
    public void Catalogue_widget_ids_are_unique()
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (WidgetCatalogEntry entry in WidgetPickerCatalog.DefaultWidgets)
        {
            Assert.True(ids.Add(entry.Id), $"duplicate id {entry.Id}");
        }
    }

    [Fact]
    public void Every_catalogue_widget_resolves_to_an_icon_glyph()
    {
        // Parity with the web `<w.icon />`: every registry id maps to a Segoe Fluent glyph via the shared
        // MiniGridWidgetIcons resolver (the native getWidgetDef(id).icon), so no card ever renders icon-less.
        foreach (WidgetCatalogEntry entry in WidgetPickerCatalog.DefaultWidgets)
        {
            Assert.False(
                string.IsNullOrEmpty(MiniGridWidgetIcons.GlyphFor(entry.Id)),
                $"no glyph for {entry.Id}");
        }
    }

    [Fact]
    public void Catalogue_default_sizes_are_positive()
    {
        foreach (WidgetCatalogEntry entry in WidgetPickerCatalog.DefaultWidgets)
        {
            Assert.True(entry.DefaultCols > 0 && entry.DefaultRows > 0, entry.Id);
        }
    }

    [Fact]
    public void Presets_match_the_web_dashboard_presets()
    {
        Assert.Equal(10, WidgetPickerCatalog.DefaultPresets.Count);

        WidgetPresetSummary first = WidgetPickerCatalog.DefaultPresets[0];
        Assert.Equal("default", first.Id);
        Assert.Equal("Default", first.Name);
        Assert.Equal(8, first.WidgetCount);
        Assert.True(first.IsDefault);

        Assert.Contains(WidgetPickerCatalog.DefaultPresets, p => p.Id == "commuter" && p.WidgetCount == 7);
        Assert.Contains(WidgetPickerCatalog.DefaultPresets, p => p.Id == "minimal" && p.WidgetCount == 4);
        Assert.Single(WidgetPickerCatalog.DefaultPresets, p => p.IsDefault);
    }

    // ── Default (populated, grouped) state ───────────────────────────────────────────────────────────

    [Fact]
    public void Default_state_renders_the_full_grouped_catalogue()
    {
        WidgetPickerDisplay d = Project();

        Assert.Equal("Add Widget", d.Title);
        Assert.False(d.IsSearching);
        Assert.False(d.ShowNoResults);
        Assert.Equal("118 widgets available", d.AvailableCountText);
        Assert.Equal(16, d.Groups.Count);
        Assert.Equal(WidgetCategory.Vehicle, d.Groups[0].Category);
        Assert.Equal(WidgetCategory.Maps, d.Groups[^1].Category);
        Assert.Equal(118, d.Groups.Sum(g => g.Cards.Count));
    }

    [Fact]
    public void Default_state_shows_presets_and_pills()
    {
        WidgetPickerDisplay d = Project();

        Assert.True(d.ShowPresets);
        Assert.Equal(10, d.Presets.Count);
        Assert.Equal("Layout Presets", d.PresetsHeading);

        // First pill is the "All" pill (selected on the default view); then one pill per category.
        Assert.Equal(17, d.Pills.Count);
        Assert.True(d.Pills[0].IsAll);
        Assert.True(d.Pills[0].IsSelected);
        Assert.Equal(WidgetCategory.Vehicle, d.Pills[1].Category);
        Assert.All(d.Pills.Skip(1), p => Assert.False(p.IsAll));
    }

    [Fact]
    public void Default_state_has_no_footer_and_no_recently_added()
    {
        WidgetPickerDisplay d = Project();

        Assert.False(d.ShowFooter);
        Assert.False(d.ShowRecentlyAdded);
        Assert.Empty(d.RecentlyAddedCards);
    }

    [Fact]
    public void Group_add_all_targets_only_widgets_not_already_added()
    {
        var model = WidgetPickerModel.Create(new[] { "battery-gauge" });
        WidgetPickerDisplay d = Project(model: model);

        WidgetGroupView battery = d.Groups.Single(g => g.Category == WidgetCategory.Battery);
        Assert.DoesNotContain("battery-gauge", battery.AddAllIds);
        Assert.True(battery.AddAllEnabled);
        Assert.Equal(battery.Cards.Count - 1, battery.AddAllIds.Count);
    }

    // ── Search state ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Searching_switches_to_a_flat_filtered_list()
    {
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "battery"));

        Assert.True(d.IsSearching);
        Assert.Empty(d.Groups);
        Assert.False(d.ShowPresets);
        Assert.False(d.ShowRecentlyAdded);
        Assert.NotEmpty(d.SearchResults);
        // web: a result matches the query in its name, description OR category (w.category.includes(query)).
        Assert.All(
            d.SearchResults,
            c => Assert.Contains("battery", (c.Name + " " + c.Description + " " + c.CategoryLabel).ToLowerInvariant()));
    }

    [Fact]
    public void Search_results_bar_formats_the_count_and_query()
    {
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "charge"));

        Assert.True(d.ShowSearchResultsBar);
        Assert.Equal($"{d.SearchResults.Count} results for \"charge\"", d.SearchResultsText);
        Assert.StartsWith("+ Add all ", d.SearchAddAllLabel);
    }

    [Fact]
    public void Search_matches_by_category_slug()
    {
        // web: w.category.toLowerCase().includes(query) — "maps" matches every map widget even when its name
        // and description never contain the word.
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "maps"));

        var resultIds = d.SearchResults.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        foreach (WidgetCatalogEntry entry in WidgetPickerCatalog.DefaultWidgets.Where(w => w.Category == WidgetCategory.Maps))
        {
            Assert.Contains(entry.Id, resultIds);
        }
    }

    [Fact]
    public void Search_highlights_the_matched_run()
    {
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "battery"));

        WidgetCardView card = d.SearchResults.First(c => c.Name == "Battery Level");
        Assert.Contains(card.NameSpans, s => s.IsMatch && s.Text == "Battery");
        Assert.Equal(card.Name, string.Concat(card.NameSpans.Select(s => s.Text)));
    }

    [Fact]
    public void No_results_shows_a_friendly_message_never_a_blank_body()
    {
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "zzzznomatch"));

        Assert.True(d.IsSearching);
        Assert.True(d.ShowNoResults);
        Assert.Empty(d.SearchResults);
        Assert.False(d.ShowSearchResultsBar);
        Assert.Equal("No widgets match \"zzzznomatch\"", d.NoResultsText);
    }

    [Fact]
    public void Single_result_hides_the_results_bar()
    {
        // A query specific enough to match exactly one widget renders the card without the bulk "Add all" bar.
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "Odometer Counter"));

        Assert.Single(d.SearchResults);
        Assert.False(d.ShowSearchResultsBar);
    }

    // ── Category-filtered state ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Filtering_by_category_narrows_to_one_group_and_hides_presets()
    {
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(categoryFilter: WidgetCategory.Battery));

        Assert.Single(d.Groups);
        Assert.Equal(WidgetCategory.Battery, d.Groups[0].Category);
        Assert.False(d.ShowPresets);
        Assert.False(d.ShowRecentlyAdded);
        Assert.Equal("10 widgets available", d.AvailableCountText);

        WidgetCategoryPill battery = d.Pills.Single(p => p.Category == WidgetCategory.Battery);
        Assert.True(battery.IsSelected);
        Assert.False(d.Pills[0].IsSelected);
    }

    // ── "Added" cards (web isAdded) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Active_widget_renders_as_added_and_disabled()
    {
        var model = WidgetPickerModel.Create(new[] { "battery-gauge" });
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(search: "battery"), model);

        WidgetCardView card = d.SearchResults.Single(c => c.Id == "battery-gauge");
        Assert.True(card.IsAdded);
        Assert.Equal("Added", card.AddedBadgeLabel);
        Assert.Contains("Added", card.AutomationName);
        Assert.DoesNotContain("battery-gauge", d.SearchAddAllIds);
    }

    // ── Recently added (web recentlyAddedVisible) ────────────────────────────────────────────────────

    [Fact]
    public void Recently_added_shows_only_on_the_unsearched_all_view()
    {
        var interaction = WidgetPickerInteraction.Create(
            recentlyAddedIds: new[] { "range-estimate", "battery-gauge" });

        WidgetPickerDisplay shown = Project(interaction);
        Assert.True(shown.ShowRecentlyAdded);
        Assert.Equal(new[] { "range-estimate", "battery-gauge" }, shown.RecentlyAddedCards.Select(c => c.Id));

        WidgetPickerDisplay searching = Project(interaction with { Search = "battery" });
        Assert.False(searching.ShowRecentlyAdded);

        WidgetPickerDisplay filtered = Project(interaction with { CategoryFilter = WidgetCategory.Battery });
        Assert.False(filtered.ShowRecentlyAdded);
    }

    [Fact]
    public void Recently_added_excludes_widgets_already_on_the_dashboard()
    {
        var interaction = WidgetPickerInteraction.Create(recentlyAddedIds: new[] { "range-estimate", "battery-gauge" });
        var model = WidgetPickerModel.Create(new[] { "battery-gauge" });

        WidgetPickerDisplay d = Project(interaction, model);

        Assert.Equal(new[] { "range-estimate" }, d.RecentlyAddedCards.Select(c => c.Id));
    }

    [Fact]
    public void Recently_added_is_capped_at_eight()
    {
        var ids = WidgetPickerCatalog.DefaultWidgets.Take(12).Select(w => w.Id).ToArray();
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(recentlyAddedIds: ids));

        Assert.Equal(WidgetPickerProjection.RecentlyAddedMax, d.RecentlyAddedCards.Count);
    }

    // ── Footer plural count (web addedCountText) ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(1, "1 widget added")]
    [InlineData(3, "3 widgets added")]
    public void Footer_count_uses_the_plural_form(int count, string expected)
    {
        var ids = WidgetPickerCatalog.DefaultWidgets.Take(count).Select(w => w.Id).ToArray();
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(addedThisSessionIds: ids));

        Assert.True(d.ShowFooter);
        Assert.Equal(expected, d.AddedCountText);
        Assert.Equal("Done", d.DoneLabel);
    }

    // ── Highlight helper (web highlightMatch) ────────────────────────────────────────────────────────

    [Fact]
    public void Highlight_with_empty_query_is_a_single_plain_run()
    {
        var spans = WidgetPickerProjection.Highlight("Battery Level", string.Empty);
        Assert.Single(spans);
        Assert.False(spans[0].IsMatch);
    }

    [Fact]
    public void Highlight_splits_around_a_case_insensitive_match()
    {
        var spans = WidgetPickerProjection.Highlight("Battery Level", "lev");
        Assert.Equal(3, spans.Count);
        Assert.Equal("Battery ", spans[0].Text);
        Assert.True(spans[1].IsMatch);
        Assert.Equal("Lev", spans[1].Text);
        Assert.Equal("el", spans[2].Text);
    }

    [Fact]
    public void Highlight_with_no_match_is_a_single_plain_run()
    {
        var spans = WidgetPickerProjection.Highlight("Battery Level", "xyz");
        Assert.Single(spans);
        Assert.False(spans[0].IsMatch);
    }

    // ── Addable / recently-added helpers (web handleAddMany / setRecentlyAddedIds) ───────────────────

    [Fact]
    public void ResolveAddable_dedupes_drops_active_and_unknown()
    {
        var model = WidgetPickerModel.Create(new[] { "battery-gauge" });

        IReadOnlyList<string> addable = WidgetPickerProjection.ResolveAddable(
            model,
            new[] { "battery-gauge", "range-estimate", "range-estimate", "not-a-widget" });

        Assert.Equal(new[] { "range-estimate" }, addable);
    }

    [Fact]
    public void NextRecentlyAdded_prepends_dedupes_and_caps()
    {
        var previous = new[] { "a", "b", "c" };
        IReadOnlyList<string> next = WidgetPickerProjection.NextRecentlyAdded(previous, new[] { "c", "d" });

        Assert.Equal(new[] { "c", "d", "a", "b" }, next);
    }

    [Fact]
    public void NextRecentlyAdded_caps_at_eight()
    {
        var added = Enumerable.Range(0, 10).Select(i => "w" + i).ToArray();
        IReadOnlyList<string> next = WidgetPickerProjection.NextRecentlyAdded(Array.Empty<string>(), added);

        Assert.Equal(WidgetPickerProjection.RecentlyAddedMax, next.Count);
    }

    [Fact]
    public void Announcement_is_singular_or_plural()
    {
        Assert.Equal("Battery Level added to dashboard",
            WidgetPickerProjection.AddedAnnouncement(new[] { "Battery Level" }, Localizer));
        Assert.Equal("2 widgets added to dashboard",
            WidgetPickerProjection.AddedAnnouncement(new[] { "Battery Level", "Range Estimate" }, Localizer));
        Assert.Equal(string.Empty,
            WidgetPickerProjection.AddedAnnouncement(Array.Empty<string>(), Localizer));
    }

    // ── View-model commands + events (web handlers) ──────────────────────────────────────────────────

    [Fact]
    public void AddWidget_raises_the_request_records_the_session_and_announces()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        var captured = new List<IReadOnlyList<string>>();
        vm.AddWidgetsRequested += (_, e) => captured.Add(e.WidgetIds);

        vm.AddWidget("battery-gauge");

        Assert.Single(captured);
        Assert.Equal(new[] { "battery-gauge" }, captured[0]);
        Assert.Contains("battery-gauge", vm.AddedThisSessionIds);
        Assert.Equal("Battery Level added to dashboard", vm.Display.Announcement);
        Assert.True(vm.Display.ShowFooter);
        Assert.Equal("1 widget added", vm.Display.AddedCountText);
    }

    [Fact]
    public void AddWidgets_batch_announces_the_count_and_persists_recently_added()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        var persisted = new List<IReadOnlyList<string>>();
        vm.RecentlyAddedChanged += (_, e) => persisted.Add(e.Ids);

        vm.AddWidgets(new[] { "battery-gauge", "range-estimate" });

        Assert.Equal("2 widgets added to dashboard", vm.Display.Announcement);
        Assert.Equal("2 widgets added", vm.Display.AddedCountText);
        Assert.Single(persisted);
        Assert.Equal(new[] { "battery-gauge", "range-estimate" }, persisted[0]);
    }

    [Fact]
    public void Adding_an_already_active_widget_is_a_no_op()
    {
        var vm = new WidgetPickerViewModel(Localizer, WidgetPickerModel.Create(new[] { "battery-gauge" }));
        bool raised = false;
        vm.AddWidgetsRequested += (_, _) => raised = true;

        vm.AddWidget("battery-gauge");

        Assert.False(raised);
        Assert.Empty(vm.AddedThisSessionIds);
    }

    [Fact]
    public void AddWidget_with_close_after_add_closes_the_drawer()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        vm.Open();
        bool closed = false;
        vm.CloseRequested += (_, _) => closed = true;

        vm.AddWidget("battery-gauge", closeAfterAdd: true);

        Assert.True(closed);
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void ApplyPreset_raises_the_request_and_closes()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        vm.Open();
        string? applied = null;
        bool closed = false;
        vm.ApplyPresetRequested += (_, e) => applied = e.PresetId;
        vm.CloseRequested += (_, _) => closed = true;

        vm.ApplyPreset("commuter");

        Assert.Equal("commuter", applied);
        Assert.True(closed);
    }

    [Fact]
    public void Open_resets_transient_state_and_reloads_recently_added()
    {
        var vm = new WidgetPickerViewModel(
            Localizer,
            recentlyAddedLoader: () => new[] { "range-estimate" });
        vm.SetSearch("battery");
        vm.SetCategoryFilter(WidgetCategory.Battery);
        vm.AddWidget("battery-gauge");

        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.Equal(string.Empty, vm.Search);
        Assert.Null(vm.CategoryFilter);
        Assert.Empty(vm.AddedThisSessionIds);
        Assert.Equal(new[] { "range-estimate" }, vm.RecentlyAddedIds);
    }

    [Fact]
    public void Close_clears_the_session_count_and_raises_close()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        vm.Open();
        vm.AddWidget("battery-gauge");
        bool closed = false;
        vm.CloseRequested += (_, _) => closed = true;

        vm.Close();

        Assert.True(closed);
        Assert.False(vm.IsOpen);
        Assert.Empty(vm.AddedThisSessionIds);
        Assert.False(vm.Display.ShowFooter);
    }

    [Fact]
    public void AddAllInCategory_adds_every_addable_widget_in_the_group()
    {
        var vm = new WidgetPickerViewModel(Localizer);
        IReadOnlyList<string>? requested = null;
        vm.AddWidgetsRequested += (_, e) => requested = e.WidgetIds;

        vm.AddAllInCategory(WidgetCategory.Tires);

        Assert.NotNull(requested);
        Assert.Equal(
            WidgetPickerCatalog.DefaultWidgets.Where(w => w.Category == WidgetCategory.Tires).Select(w => w.Id),
            requested);
    }

    // ── i18n: every owned string flows through the facade (no hardcoded English) ─────────────────────

    [Fact]
    public void Owned_chrome_resolves_through_the_i18n_facade()
    {
        var fake = new SentinelLocalizer();
        WidgetPickerDisplay d = Project(localizer: fake);

        Assert.Equal("«dashboard.addWidget»", d.Title);
        Assert.Equal("«widgets.search»", d.SearchHint);
        Assert.Equal("«widgets.categoryFilter»", d.CategoryFilterLabel);
        Assert.Equal("«dashboard.presets»", d.PresetsHeading);
        Assert.Contains("«widgets.available»", d.AvailableCountText);
        Assert.Contains(d.Pills, p => p.IsAll && p.Label == "«widgets.allCategories»");
    }

    [Fact]
    public void Category_labels_resolve_through_the_facade()
    {
        var fake = new SentinelLocalizer();
        WidgetPickerDisplay d = Project(WidgetPickerInteraction.Create(categoryFilter: WidgetCategory.Battery), localizer: fake);

        Assert.Equal("«widgets.category.battery»", d.Groups[0].Heading);
    }

    // ── Accessibility (Narrator names on every interactive element) ──────────────────────────────────

    [Fact]
    public void Every_card_pill_and_preset_has_a_narrator_name()
    {
        WidgetPickerDisplay d = Project();

        Assert.False(string.IsNullOrWhiteSpace(d.CategoryFilterLabel));
        Assert.All(d.Pills, p => Assert.False(string.IsNullOrWhiteSpace(p.Label)));
        Assert.All(d.Presets, p => Assert.False(string.IsNullOrWhiteSpace(p.AutomationName)));
        Assert.All(
            d.Groups.SelectMany(g => g.Cards),
            c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
    }

    [Fact]
    public void Card_automation_name_includes_name_and_description()
    {
        WidgetPickerDisplay d = Project();
        WidgetCardView card = d.Groups[0].Cards[0];

        Assert.Contains(card.Name, card.AutomationName);
        Assert.Contains(card.Description, card.AutomationName);
    }

    // ── Diagnostics (P1/S11): PII-safe operational counters ──────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new WidgetPickerDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetPicker", captured[0]);
    }

    [Fact]
    public void Diagnostics_record_adds_as_a_count_without_leaking_ids()
    {
        var captured = new List<string>();
        var diagnostics = new WidgetPickerDiagnostics(captured.Add);

        diagnostics.RecordWidgetsAdded(3);
        diagnostics.RecordWidgetsAdded(0);

        Assert.Equal(3, diagnostics.WidgetsAdded);
        Assert.Equal("widget.added slug=WidgetPicker count=3", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_record_preset_applied_without_the_id()
    {
        var captured = new List<string>();
        var diagnostics = new WidgetPickerDiagnostics(captured.Add);

        diagnostics.RecordPresetApplied();

        Assert.Equal(1, diagnostics.PresetsApplied);
        Assert.Equal("preset.applied slug=WidgetPicker", captured[0]);
    }

    [Fact]
    public void View_model_open_emits_view_opened_diagnostics()
    {
        var captured = new List<string>();
        var vm = new WidgetPickerViewModel(Localizer, diagnostics: new WidgetPickerDiagnostics(captured.Add));

        vm.Open();

        Assert.Contains("view.opened slug=WidgetPicker", captured);
    }

    // ── Null-argument guards ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            WidgetPickerProjection.Project(null!, WidgetPickerInteraction.Empty, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            WidgetPickerProjection.Project(WidgetPickerModel.Default, null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            WidgetPickerProjection.Project(WidgetPickerModel.Default, WidgetPickerInteraction.Empty, null!));
    }

    /// <summary>An <see cref="ILocalizer"/> that wraps each key in guillemets so the keyed call site is
    /// asserted headlessly while proving the surface contributes no hardcoded English of its own.</summary>
    private sealed class SentinelLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => $"«{key}»";
    }
}
