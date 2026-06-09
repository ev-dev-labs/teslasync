using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Endpoints;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the EndpointSidebar feature-view's UI-thread-free logic — the method-badge token
/// mapping, the pure search filter / tag grouping / default-open adapters, the per-state projection
/// (populated / empty / selected), the i18n routing, the accessibility names, the state-holder view-model's
/// transitions + per-group open overrides, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/EndpointSidebar.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class EndpointSidebarTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly IReadOnlyList<ParsedEndpoint> Sample = new[]
    {
        ParsedEndpoint.ForList(EndpointMethod.Get, "/vehicles", "Vehicles", "List vehicles", "listVehicles"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/vehicles/{id}/state", "Vehicles", "Vehicle state", "vehicleState"),
        ParsedEndpoint.ForList(EndpointMethod.Post, "/charging/start", "Charging", "Start charging", "startCharging"),
        ParsedEndpoint.ForList(EndpointMethod.Delete, "/alerts/{id}", "Alerts", "Delete alert", "deleteAlert"),
    };

    private static readonly IReadOnlyList<ParsedEndpoint> SixTags = new[]
    {
        ParsedEndpoint.ForList(EndpointMethod.Get, "/a", "Alpha"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/b", "Bravo"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/c", "Charlie"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/d", "Delta"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/e", "Echo"),
        ParsedEndpoint.ForList(EndpointMethod.Get, "/f", "Foxtrot"),
    };

    private static readonly Func<string, bool, bool> DefaultResolver = static (_, def) => def;

    private static EndpointSidebarDisplay Project(
        IReadOnlyList<ParsedEndpoint> endpoints,
        ParsedEndpoint? selected = null,
        string? search = null,
        Func<string, bool, bool>? resolveOpen = null,
        ILocalizer? localizer = null) =>
        EndpointSidebarProjection.Project(
            endpoints, selected, search, resolveOpen ?? DefaultResolver, localizer ?? Localizer);

    // ---- Method helpers (web METHOD_COLORS + MethodBadge) --------------------------

    [Theory]
    [InlineData("GET", EndpointMethod.Get)]
    [InlineData("get", EndpointMethod.Get)]
    [InlineData(" Post ", EndpointMethod.Post)]
    [InlineData("PUT", EndpointMethod.Put)]
    [InlineData("delete", EndpointMethod.Delete)]
    [InlineData("PATCH", EndpointMethod.Patch)]
    [InlineData("TRACE", EndpointMethod.Other)]
    [InlineData("", EndpointMethod.Other)]
    [InlineData(null, EndpointMethod.Other)]
    public void Parse_maps_wire_method_to_enum(string? raw, EndpointMethod expected) =>
        Assert.Equal(expected, EndpointMethods.Parse(raw));

    [Theory]
    [InlineData(EndpointMethod.Get, "GET")]
    [InlineData(EndpointMethod.Post, "POST")]
    [InlineData(EndpointMethod.Put, "PUT")]
    [InlineData(EndpointMethod.Delete, "DELETE")]
    [InlineData(EndpointMethod.Patch, "PATCH")]
    [InlineData(EndpointMethod.Other, "ANY")]
    public void Label_is_the_uppercase_verb(EndpointMethod method, string expected) =>
        Assert.Equal(expected, EndpointMethods.Label(method));

    [Theory]
    [InlineData(EndpointMethod.Get, "TsColorSuccessBrush")]
    [InlineData(EndpointMethod.Post, "TsColorInfoBrush")]
    [InlineData(EndpointMethod.Put, "TsColorWarningBrush")]
    [InlineData(EndpointMethod.Delete, "TsColorDangerBrush")]
    [InlineData(EndpointMethod.Patch, "TsColorAccentBrush")]
    [InlineData(EndpointMethod.Other, "TsColorTextMutedBrush")]
    public void BrushKey_maps_each_verb_to_a_token(EndpointMethod method, string expected) =>
        Assert.Equal(expected, EndpointMethods.BrushKey(method));

    // ---- Filter adapter (web `filtered` memo) --------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Filter_blank_query_returns_all(string? query) =>
        Assert.Equal(Sample.Count, EndpointSidebarProjection.Filter(Sample, query).Count);

    [Fact]
    public void Filter_matches_path()
    {
        var result = EndpointSidebarProjection.Filter(Sample, "/charging");
        Assert.Single(result);
        Assert.Equal("/charging/start", result[0].Path);
    }

    [Fact]
    public void Filter_is_case_insensitive_across_path_summary_operationId()
    {
        // "STATE" matches the path /vehicles/{id}/state, the summary "Vehicle state" and the op "vehicleState".
        var result = EndpointSidebarProjection.Filter(Sample, "STATE");
        Assert.Single(result);
        Assert.Equal("/vehicles/{id}/state", result[0].Path);
    }

    [Fact]
    public void Filter_matches_operation_id()
    {
        var result = EndpointSidebarProjection.Filter(Sample, "deletealert");
        Assert.Single(result);
        Assert.Equal("/alerts/{id}", result[0].Path);
    }

    [Fact]
    public void Filter_no_match_is_empty() =>
        Assert.Empty(EndpointSidebarProjection.Filter(Sample, "zzz-nope"));

    [Fact]
    public void Filter_is_null_safe_on_endpoint_fields()
    {
        // An endpoint with empty path/summary/operationId must not throw and must simply not match.
        var sparse = new[] { ParsedEndpoint.ForList(EndpointMethod.Get, string.Empty, "Misc") };
        Assert.Empty(EndpointSidebarProjection.Filter(sparse, "anything"));
    }

    // ---- Group adapter (web `grouped` memo) ----------------------------------------

    [Fact]
    public void Group_preserves_first_seen_tag_order()
    {
        var groups = EndpointSidebarProjection.Group(Sample);

        Assert.Equal(3, groups.Count);
        Assert.Equal("Vehicles", groups[0].Tag);
        Assert.Equal(2, groups[0].Endpoints.Count);
        Assert.Equal("Charging", groups[1].Tag);
        Assert.Equal("Alerts", groups[2].Tag);
    }

    [Fact]
    public void Group_empty_tag_falls_back_to_other()
    {
        var untagged = new[] { ParsedEndpoint.ForList(EndpointMethod.Get, "/x", string.Empty) };
        var groups = EndpointSidebarProjection.Group(untagged);

        Assert.Single(groups);
        Assert.Equal(EndpointSidebarProjection.OtherTag, groups[0].Tag);
    }

    // ---- DefaultOpen (web `selected?.tag === tag || grouped.size <= 5`) -------------

    [Fact]
    public void DefaultOpen_true_when_tag_is_selected_tag() =>
        Assert.True(EndpointSidebarProjection.DefaultOpen("Vehicles", "Vehicles", 99));

    [Fact]
    public void DefaultOpen_true_when_group_count_at_or_below_threshold()
    {
        Assert.True(EndpointSidebarProjection.DefaultOpen("X", null, 5));
        Assert.True(EndpointSidebarProjection.DefaultOpen("X", null, 1));
    }

    [Fact]
    public void DefaultOpen_false_when_above_threshold_and_not_selected() =>
        Assert.False(EndpointSidebarProjection.DefaultOpen("X", "Other", 6));

    // ---- Projection: populated -----------------------------------------------------

    [Fact]
    public void Project_populated_exposes_groups_count_and_chrome()
    {
        var display = Project(Sample);

        Assert.False(display.IsEmpty);
        Assert.Equal(4, display.FilteredCount);
        Assert.Equal(3, display.Groups.Count);
        Assert.Equal("Search endpoints...", display.SearchHint);
        Assert.Equal("4 endpoints", display.CountLabel);
        Assert.Equal(display.CountLabel, display.AutomationName);
    }

    [Fact]
    public void Project_populated_all_groups_open_when_few_groups()
    {
        var display = Project(Sample);
        Assert.All(display.Groups, g => Assert.True(g.IsOpen));
    }

    [Fact]
    public void Project_row_carries_badge_path_and_source_endpoint()
    {
        var display = Project(Sample);
        var vehicles = display.Groups[0];
        var row = vehicles.Rows[0];

        Assert.Equal("GET", row.MethodLabel);
        Assert.Equal("TsColorSuccessBrush", row.MethodBrushKey);
        Assert.Equal("/vehicles", row.Path);
        Assert.Equal("List vehicles", row.Summary);
        Assert.Equal("GET-/vehicles", row.RowKey);
        Assert.Equal("GET /vehicles", row.AutomationName);
        Assert.Same(Sample[0], row.Endpoint);
        Assert.False(row.IsSelected);
    }

    [Fact]
    public void Project_group_header_automation_name_reads_tag_and_count()
    {
        var display = Project(Sample);
        Assert.Equal("Vehicles, 2 endpoints", display.Groups[0].HeaderAutomationName);
        Assert.Equal("Charging, 1 endpoints", display.Groups[1].HeaderAutomationName);
    }

    // ---- Projection: empty (web `filtered.length === 0`) ---------------------------

    [Fact]
    public void Project_empty_shows_localized_no_results()
    {
        var display = Project(Sample, search: "zzz-nope");

        Assert.True(display.IsEmpty);
        Assert.Equal(0, display.FilteredCount);
        Assert.Empty(display.Groups);
        Assert.Equal("No matching endpoints", display.EmptyMessage);
        Assert.Equal("0 endpoints", display.CountLabel);
    }

    [Fact]
    public void Project_empty_list_is_empty()
    {
        var display = Project(Array.Empty<ParsedEndpoint>());
        Assert.True(display.IsEmpty);
        Assert.Empty(display.Groups);
    }

    // ---- Projection: selection highlight (web `isSelected`) ------------------------

    [Fact]
    public void Project_marks_selected_row_and_opens_its_group()
    {
        var selected = Sample[0]; // GET /vehicles
        var display = Project(Sample, selected: selected);

        var vehicles = display.Groups[0];
        Assert.True(vehicles.IsOpen);
        Assert.True(vehicles.Rows[0].IsSelected);
        Assert.False(vehicles.Rows[1].IsSelected);
        Assert.All(display.Groups[1].Rows, r => Assert.False(r.IsSelected));
    }

    [Fact]
    public void Project_selection_matches_on_path_and_method_only()
    {
        // A distinct instance with the same path + method is still "selected" (web value equality).
        var selectedLike = ParsedEndpoint.ForList(EndpointMethod.Get, "/vehicles", "Vehicles");
        var display = Project(Sample, selected: selectedLike);
        Assert.True(display.Groups[0].Rows[0].IsSelected);
    }

    [Fact]
    public void Project_selection_method_mismatch_is_not_selected()
    {
        var notSelected = ParsedEndpoint.ForList(EndpointMethod.Post, "/vehicles", "Vehicles");
        var display = Project(Sample, selected: notSelected);
        Assert.False(display.Groups[0].Rows[0].IsSelected);
    }

    // ---- Projection: default-open with many groups ---------------------------------

    [Fact]
    public void Project_many_groups_collapsed_by_default()
    {
        var display = Project(SixTags);
        Assert.Equal(6, display.Groups.Count);
        Assert.All(display.Groups, g => Assert.False(g.IsOpen));
    }

    [Fact]
    public void Project_many_groups_opens_only_selected_tag()
    {
        var selected = SixTags[2]; // Charlie
        var display = Project(SixTags, selected: selected);

        foreach (var group in display.Groups)
        {
            Assert.Equal(group.Tag == "Charlie", group.IsOpen);
        }
    }

    [Fact]
    public void Project_resolveOpen_override_wins_over_default()
    {
        // Force every group closed even though there are only 3 (default-open) groups.
        var display = Project(Sample, resolveOpen: static (_, _) => false);
        Assert.All(display.Groups, g => Assert.False(g.IsOpen));
    }

    // ---- i18n routing (every owned string flows through the facade) ----------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(Sample, search: "zzz-nope", localizer: new PrefixLocalizer());

        Assert.Equal("L:translation.playground.search", display.SearchHint);
        Assert.Equal("L:translation.playground.noResults", display.EmptyMessage);
        Assert.Contains("L:translation.playground.endpoints", display.CountLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_keys_match_the_web_source()
    {
        Assert.Equal("translation.playground.search", EndpointSidebarProjection.SearchKey);
        Assert.Equal("translation.playground.endpoints", EndpointSidebarProjection.EndpointsKey);
        Assert.Equal("translation.playground.noResults", EndpointSidebarProjection.NoResultsKey);
        Assert.Equal("Search endpoints...", EndpointSidebarProjection.SearchFallback);
        Assert.Equal("endpoints", EndpointSidebarProjection.EndpointsFallback);
        Assert.Equal("No matching endpoints", EndpointSidebarProjection.NoResultsFallback);
    }

    // ---- ProjectRow ----------------------------------------------------------------

    [Fact]
    public void ProjectRow_null_selection_is_not_selected()
    {
        var row = EndpointSidebarProjection.ProjectRow(Sample[0], null);
        Assert.False(row.IsSelected);
        Assert.Equal("GET-/vehicles", row.RowKey);
    }

    [Fact]
    public void IsSameEndpoint_handles_nulls_and_equality()
    {
        Assert.False(EndpointSidebarProjection.IsSameEndpoint(null, Sample[0]));
        Assert.False(EndpointSidebarProjection.IsSameEndpoint(Sample[0], null));
        Assert.False(EndpointSidebarProjection.IsSameEndpoint(null, null));
        Assert.True(EndpointSidebarProjection.IsSameEndpoint(Sample[0], Sample[0]));
        Assert.False(EndpointSidebarProjection.IsSameEndpoint(Sample[0], Sample[2]));
    }

    [Fact]
    public void SelectedTag_resolves_other_for_untagged_selection()
    {
        Assert.Null(EndpointSidebarProjection.SelectedTag(null));
        Assert.Equal("Vehicles", EndpointSidebarProjection.SelectedTag(Sample[0]));
        Assert.Equal(
            EndpointSidebarProjection.OtherTag,
            EndpointSidebarProjection.SelectedTag(ParsedEndpoint.ForList(EndpointMethod.Get, "/x", string.Empty)));
    }

    // ---- Projection / adapter guards -----------------------------------------------

    [Fact]
    public void Filter_rejects_null_endpoints() =>
        Assert.Throws<ArgumentNullException>(() => EndpointSidebarProjection.Filter(null!, "x"));

    [Fact]
    public void Group_rejects_null_endpoints() =>
        Assert.Throws<ArgumentNullException>(() => EndpointSidebarProjection.Group(null!));

    [Fact]
    public void ProjectRow_rejects_null_endpoint() =>
        Assert.Throws<ArgumentNullException>(() => EndpointSidebarProjection.ProjectRow(null!, null));

    [Fact]
    public void Project_rejects_null_endpoints() =>
        Assert.Throws<ArgumentNullException>(() =>
            EndpointSidebarProjection.Project(null!, null, null, DefaultResolver, Localizer));

    [Fact]
    public void Project_rejects_null_resolver() =>
        Assert.Throws<ArgumentNullException>(() =>
            EndpointSidebarProjection.Project(Sample, null, null, null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            EndpointSidebarProjection.Project(Sample, null, null, DefaultResolver, null!));

    // ---- View-model: seeding + search ----------------------------------------------

    [Fact]
    public void ViewModel_seeds_from_initial_props()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample, Sample[0]);

        Assert.Same(Sample, vm.Endpoints);
        Assert.Same(Sample[0], vm.Selected);
        Assert.Equal(string.Empty, vm.Search);
        Assert.False(vm.Display.IsEmpty);
        Assert.Equal(4, vm.Display.FilteredCount);
    }

    [Fact]
    public void ViewModel_update_search_filters_and_raises()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.UpdateSearch("zzz-nope");

        Assert.True(vm.Display.IsEmpty);
        Assert.Equal("zzz-nope", vm.Search);
        Assert.Contains(nameof(EndpointSidebarViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_update_search_unchanged_is_noop()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.UpdateSearch(string.Empty);

        Assert.False(raised);
    }

    // ---- View-model: selection (web onSelect + highlight) --------------------------

    [Fact]
    public void ViewModel_select_sets_selection_invokes_callback_and_raises()
    {
        var picked = new List<ParsedEndpoint>();
        var vm = new EndpointSidebarViewModel(Localizer, Sample, onSelect: picked.Add);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Select(Sample[2]);

        Assert.Same(Sample[2], vm.Selected);
        Assert.Same(Sample[2], Assert.Single(picked));
        Assert.Contains(nameof(EndpointSidebarViewModel.Selected), raised);
    }

    [Fact]
    public void ViewModel_select_already_selected_still_calls_callback_without_raising()
    {
        var picked = new List<ParsedEndpoint>();
        var vm = new EndpointSidebarViewModel(Localizer, Sample, Sample[0], onSelect: picked.Add);
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.Select(Sample[0]);

        Assert.Single(picked);
        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_set_selected_does_not_invoke_callback()
    {
        var picked = new List<ParsedEndpoint>();
        var vm = new EndpointSidebarViewModel(Localizer, Sample, onSelect: picked.Add);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetSelected(Sample[1]);

        Assert.Same(Sample[1], vm.Selected);
        Assert.Empty(picked);
        Assert.Contains(nameof(EndpointSidebarViewModel.Selected), raised);
    }

    [Fact]
    public void ViewModel_set_selected_unchanged_is_noop()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample, Sample[0]);
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetSelected(Sample[0]);

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_set_endpoints_replaces_and_raises()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetEndpoints(SixTags);

        Assert.Same(SixTags, vm.Endpoints);
        Assert.Equal(6, vm.Display.Groups.Count);
        Assert.Contains(nameof(EndpointSidebarViewModel.Display), raised);
    }

    // ---- View-model: per-group open overrides --------------------------------------

    [Fact]
    public void ViewModel_group_open_defaults_match_projection()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        Assert.True(vm.IsGroupOpen("Vehicles")); // 3 groups <= 5 → open
    }

    [Fact]
    public void ViewModel_set_group_open_override_is_silent_but_reflected_in_display()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetGroupOpen("Vehicles", false);

        Assert.False(raised); // override is silent (the expander already reflects it visually)
        Assert.False(vm.IsGroupOpen("Vehicles"));
        var vehicles = vm.Display.Groups.Single(g => g.Tag == "Vehicles");
        Assert.False(vehicles.IsOpen);
    }

    [Fact]
    public void ViewModel_open_override_persists_across_search_change()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        vm.SetGroupOpen("Vehicles", false);

        vm.UpdateSearch("vehic"); // still has the Vehicles group
        vm.UpdateSearch(string.Empty);

        Assert.False(vm.IsGroupOpen("Vehicles"));
    }

    [Fact]
    public void ViewModel_open_override_can_expand_a_default_collapsed_group()
    {
        var vm = new EndpointSidebarViewModel(Localizer, SixTags);
        Assert.False(vm.IsGroupOpen("Alpha")); // 6 groups → collapsed by default

        vm.SetGroupOpen("Alpha", true);

        Assert.True(vm.IsGroupOpen("Alpha"));
    }

    [Fact]
    public void ViewModel_reload_raises_display()
    {
        var vm = new EndpointSidebarViewModel(Localizer, Sample);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Contains(nameof(EndpointSidebarViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new EndpointSidebarViewModel(null!));

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EndpointSidebarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EndpointSidebar", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new EndpointSidebarDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("EndpointSidebar", EndpointSidebarRegistration.Slug);

    // ---- Helpers / test doubles ----------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
