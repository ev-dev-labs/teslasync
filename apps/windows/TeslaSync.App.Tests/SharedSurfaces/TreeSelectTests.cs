using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>TreeSelect</c> shared surface's UI-thread-free logic — the registration slug +
/// token keys + i18n keys/fallbacks and the label projections (<see cref="TreeSelectRegistration"/>); the pure
/// filter + tri-state adapter (<see cref="TreeSelectProjection.FilterGroups"/> /
/// <see cref="TreeSelectProjection.GroupState"/>); the per-state view-model — the loading / empty / no-results /
/// populated body matrix, the search filter (selection-independent), the collapsed-by-default expansion that opens
/// while searching, the per-leaf disabled state, the tri-state group + header "select visible" toggles, the
/// selected/visible counts, the flat row projection with its accessible names, and the roving-tabindex keyboard
/// model (<see cref="TreeSelectViewModel"/>); the PII-safe diagnostics; and the argument guards. Mirrors the web
/// spec one-for-one (<c>web/src/components/forms/TreeSelect.tsx</c>). The WinUI view itself
/// (shared-surfaces/TreeSelect.cs, which composes the search box + header + scrollable tree body) is exercised by
/// the app build. Because the component reads no network data, there is no error / stale / offline state to
/// reproduce; the four reproduced branches are loading / empty / no-results / populated.
/// </summary>
public sealed class TreeSelectTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static IReadOnlyList<TreeGroup> Catalog() =>
    [
        new("battery", "Battery", [new TreeLeaf("soc", "State of Charge"), new TreeLeaf("range", "Range")]),
        new("drive", "Drive", [new TreeLeaf("speed", "Speed"), new TreeLeaf("power", "Power")]),
    ];

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static TreeSelectViewModel NewVm(
        IReadOnlyList<TreeGroup>? groups = null,
        ILocalizer? localizer = null,
        IReadOnlyList<string>? initialSelection = null,
        string search = "",
        bool isLoading = false,
        bool expandedByDefault = false,
        System.Func<TreeLeaf, bool>? getLeafDisabled = null,
        System.Func<TreeLeaf, string?>? getLeafDisabledReason = null) =>
        new(
            groups ?? Catalog(),
            localizer ?? Localizer,
            initialSelection,
            search,
            isLoading,
            expandedByDefault,
            getLeafDisabled,
            getLeafDisabledReason);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TreeSelect", TreeSelectRegistration.Slug);

    [Fact]
    public void Registration_token_keys_match_the_web_css_variables()
    {
        Assert.Equal("TsColorTextPrimaryBrush", TreeSelectRegistration.TextPrimaryBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", TreeSelectRegistration.TextSecondaryBrushKey);
        Assert.Equal("TsColorTextMutedBrush", TreeSelectRegistration.TextMutedBrushKey);
        Assert.Equal("TsColorSurfaceBrush", TreeSelectRegistration.SurfaceBrushKey);
        Assert.Equal("TsColorBorderBrush", TreeSelectRegistration.BorderBrushKey);
    }

    [Fact]
    public void Registration_i18n_keys_carry_the_translation_prefix()
    {
        Assert.StartsWith("translation.treeSelect.", TreeSelectRegistration.SearchHintKey, System.StringComparison.Ordinal);
        Assert.StartsWith("translation.treeSelect.", TreeSelectRegistration.FilterAriaKey, System.StringComparison.Ordinal);
        Assert.StartsWith("translation.treeSelect.", TreeSelectRegistration.NoResultsKey, System.StringComparison.Ordinal);
        Assert.StartsWith("translation.treeSelect.", TreeSelectRegistration.GroupAriaKey, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Search\u2026", TreeSelectRegistration.SearchHintFallback);
        Assert.Equal("Filter tree", TreeSelectRegistration.FilterAriaFallback);
        Assert.Equal("Clear search", TreeSelectRegistration.ClearSearchFallback);
        Assert.Equal("Select all", TreeSelectRegistration.SelectAllFallback);
        Assert.Equal("Clear all", TreeSelectRegistration.ClearAllFallback);
        Assert.Equal("Clear all selected", TreeSelectRegistration.ClearAllSelectedFallback);
        Assert.Equal("Tree multi-select", TreeSelectRegistration.TreeLabelFallback);
        Assert.Equal("No items available.", TreeSelectRegistration.EmptyFallback);
    }

    // ── registration: label projections ──────────────────────────────────────────────────────────────────

    [Fact]
    public void SelectAllLabel_follows_the_web_ternary()
    {
        Assert.Equal("Select all", TreeSelectRegistration.SelectAllLabel(Localizer, isSearching: false, allVisibleSelected: false, visibleCount: 4));
        Assert.Equal("Clear all", TreeSelectRegistration.SelectAllLabel(Localizer, isSearching: false, allVisibleSelected: true, visibleCount: 4));
        Assert.Equal("Select 3 visible", TreeSelectRegistration.SelectAllLabel(Localizer, isSearching: true, allVisibleSelected: false, visibleCount: 3));
        Assert.Equal("Clear 3 visible", TreeSelectRegistration.SelectAllLabel(Localizer, isSearching: true, allVisibleSelected: true, visibleCount: 3));
    }

    [Fact]
    public void SelectedSummary_appends_the_total_only_while_searching()
    {
        Assert.Equal("2 selected", TreeSelectRegistration.SelectedSummary(Localizer, selectedCount: 2, totalCount: 4, isSearching: false));
        Assert.Equal("2 selected of 4", TreeSelectRegistration.SelectedSummary(Localizer, selectedCount: 2, totalCount: 4, isSearching: true));
    }

    [Fact]
    public void GroupAria_and_GroupToggle_interpolate_the_web_templates()
    {
        Assert.Equal("Battery, 1 of 2 selected", TreeSelectRegistration.GroupAria(Localizer, "Battery", selectedCount: 1, totalCount: 2));
        Assert.Equal("Toggle Battery", TreeSelectRegistration.GroupToggle(Localizer, "Battery"));
    }

    [Fact]
    public void LeafName_only_appends_a_reason_when_disabled()
    {
        Assert.Equal("State of Charge", TreeSelectRegistration.LeafName(Localizer, "State of Charge", disabledReason: null));
        Assert.Equal("Speed (Unavailable)", TreeSelectRegistration.LeafName(Localizer, "Speed", disabledReason: "Unavailable"));
    }

    [Fact]
    public void NoResults_interpolates_the_trimmed_query()
    {
        Assert.Equal("No matches for \u201Cxyz\u201D.", TreeSelectRegistration.NoResults(Localizer, "xyz"));
    }

    [Fact]
    public void Summary_appends_the_visible_count_only_while_searching()
    {
        Assert.Equal("2 selected of 4 total", TreeSelectRegistration.Summary(Localizer, 2, 4, 1, isSearching: false));
        Assert.Equal("2 selected of 4 total, 1 visible", TreeSelectRegistration.Summary(Localizer, 2, 4, 1, isSearching: true));
    }

    [Fact]
    public void GroupCount_renders_selected_over_visible() =>
        Assert.Equal("1/2", TreeSelectRegistration.GroupCount(1, 2));

    // ── adapter: FilterGroups (web filterGroups, L104-L117) ───────────────────────────────────────────────

    [Fact]
    public void FilterGroups_returns_the_same_reference_when_the_needle_is_blank()
    {
        IReadOnlyList<TreeGroup> groups = Catalog();
        Assert.Same(groups, TreeSelectProjection.FilterGroups(groups, "   "));
    }

    [Fact]
    public void FilterGroups_keeps_all_leaves_when_the_group_label_matches()
    {
        IReadOnlyList<TreeGroup> filtered = TreeSelectProjection.FilterGroups(Catalog(), "battery");
        TreeGroup group = Assert.Single(filtered);
        Assert.Equal("battery", group.Key);
        Assert.Equal(2, group.Leaves.Count);
    }

    [Fact]
    public void FilterGroups_keeps_only_matching_leaves_and_drops_empty_groups()
    {
        IReadOnlyList<TreeGroup> filtered = TreeSelectProjection.FilterGroups(Catalog(), "range");
        TreeGroup group = Assert.Single(filtered);
        Assert.Equal("battery", group.Key);
        TreeLeaf leaf = Assert.Single(group.Leaves);
        Assert.Equal("range", leaf.Value);
    }

    [Fact]
    public void FilterGroups_is_case_insensitive()
    {
        IReadOnlyList<TreeGroup> filtered = TreeSelectProjection.FilterGroups(Catalog(), "SPEED");
        TreeGroup group = Assert.Single(filtered);
        Assert.Equal("drive", group.Key);
        Assert.Equal("speed", Assert.Single(group.Leaves).Value);
    }

    // ── adapter: GroupState tri-state (web allGroupSelected / someGroupSelected) ───────────────────────────

    [Fact]
    public void GroupState_is_unchecked_when_nothing_selected()
    {
        TreeGroup group = Catalog()[0];
        Assert.Equal(TreeCheckState.Unchecked, TreeSelectProjection.GroupState(group, _ => false, _ => false));
    }

    [Fact]
    public void GroupState_is_indeterminate_when_some_selected()
    {
        TreeGroup group = Catalog()[0];
        Assert.Equal(
            TreeCheckState.Indeterminate,
            TreeSelectProjection.GroupState(group, v => v == "soc", _ => false));
    }

    [Fact]
    public void GroupState_is_checked_when_every_enabled_leaf_selected_ignoring_disabled()
    {
        // Only the enabled leaves must be selected for the "all" state (web visibleEnabledLeaves.every).
        TreeGroup group = Catalog()[1]; // drive: speed, power
        Assert.Equal(
            TreeCheckState.Checked,
            TreeSelectProjection.GroupState(group, v => v == "speed", l => l.Value == "power"));
    }

    // ── view-model: body state matrix ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_slug_matches_the_web_surface() => Assert.Equal("TreeSelect", TreeSelectViewModel.Slug);

    [Fact]
    public void VisualState_is_empty_for_an_empty_catalog()
    {
        using var vm = NewVm(groups: System.Array.Empty<TreeGroup>());
        Assert.Equal(TreeSelectVisualState.Empty, vm.VisualState);
        Assert.Empty(vm.Rows);
    }

    [Fact]
    public void VisualState_is_loading_when_loading()
    {
        using var vm = NewVm(isLoading: true);
        Assert.Equal(TreeSelectVisualState.Loading, vm.VisualState);
        Assert.Empty(vm.Rows);
    }

    [Fact]
    public void VisualState_is_no_results_when_the_filter_eliminates_every_group()
    {
        using var vm = NewVm(search: "nonexistent");
        Assert.Equal(TreeSelectVisualState.NoResults, vm.VisualState);
        Assert.Equal(0, vm.FilteredGroupCount);
        Assert.Empty(vm.Rows);
    }

    [Fact]
    public void VisualState_is_populated_for_a_non_empty_catalog()
    {
        using var vm = NewVm();
        Assert.Equal(TreeSelectVisualState.Populated, vm.VisualState);
        Assert.NotEmpty(vm.Rows);
    }

    [Fact]
    public void Loading_toggle_reprojects_the_visual_state()
    {
        using var vm = NewVm();
        Assert.Equal(TreeSelectVisualState.Populated, vm.VisualState);
        vm.IsLoading = true;
        Assert.Equal(TreeSelectVisualState.Loading, vm.VisualState);
        vm.IsLoading = false;
        Assert.Equal(TreeSelectVisualState.Populated, vm.VisualState);
    }

    // ── view-model: collapsed-by-default expansion (web default + expand-while-searching) ─────────────────

    [Fact]
    public void Groups_are_collapsed_by_default_so_only_group_rows_render()
    {
        using var vm = NewVm();
        Assert.All(vm.Rows, r => Assert.Equal(TreeSelectRowKind.Group, r.Kind));
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public void Expanding_a_group_reveals_its_leaf_rows()
    {
        using var vm = NewVm();
        vm.ToggleExpanded("battery");
        Assert.True(vm.IsRowExpanded("battery"));

        // battery group + soc + range + drive group (collapsed).
        Assert.Equal(4, vm.Rows.Count);
        Assert.Contains(vm.Rows, r => r is { Kind: TreeSelectRowKind.Leaf, LeafValue: "soc" });
        Assert.Contains(vm.Rows, r => r is { Kind: TreeSelectRowKind.Leaf, LeafValue: "range" });
    }

    [Fact]
    public void ExpandedByDefault_renders_every_leaf()
    {
        using var vm = NewVm(expandedByDefault: true);
        Assert.Equal(6, vm.Rows.Count); // 2 groups + 4 leaves
    }

    [Fact]
    public void Searching_force_expands_every_group_and_blocks_manual_collapse()
    {
        using var vm = NewVm(search: "e"); // matches several leaves across both groups
        Assert.True(vm.IsRowExpanded("battery"));
        Assert.True(vm.IsRowExpanded("drive"));

        vm.ToggleExpanded("battery"); // no-op while searching (web `if (isSearching) return;`)
        Assert.True(vm.IsRowExpanded("battery"));
    }

    // ── view-model: selection + counts ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ToggleLeaf_tracks_selection_and_group_tristate()
    {
        using var vm = NewVm(expandedByDefault: true);
        vm.ToggleLeaf("soc");

        Assert.Equal(1, vm.SelectedCount);
        Assert.Contains("soc", vm.SelectedValues);
        TreeSelectRow group = vm.Rows.First(r => r is { Kind: TreeSelectRowKind.Group, GroupKey: "battery" });
        Assert.Equal(TreeCheckState.Indeterminate, group.CheckState);
        Assert.Equal(1, group.SelectedCount);
        Assert.Equal(2, group.VisibleCount);
    }

    [Fact]
    public void ToggleGroupVisible_selects_all_then_clears()
    {
        using var vm = NewVm();
        vm.ToggleGroupVisible("battery");
        Assert.Equal(2, vm.SelectedCount);
        Assert.Equal(new[] { "soc", "range" }, vm.SelectedValues);

        vm.ToggleGroupVisible("battery");
        Assert.Equal(0, vm.SelectedCount);
    }

    [Fact]
    public void ToggleAllVisible_selects_every_visible_enabled_leaf()
    {
        using var vm = NewVm();
        vm.ToggleAllVisible();
        Assert.Equal(4, vm.SelectedCount);
        Assert.True(vm.AllVisibleSelected);
        Assert.Equal(TreeCheckState.Checked, vm.HeaderCheckState);

        vm.ToggleAllVisible();
        Assert.Equal(0, vm.SelectedCount);
        Assert.Equal(TreeCheckState.Unchecked, vm.HeaderCheckState);
    }

    [Fact]
    public void HeaderCheckState_is_indeterminate_for_a_partial_selection()
    {
        using var vm = NewVm();
        vm.ToggleLeaf("soc");
        Assert.True(vm.SomeVisibleSelected);
        Assert.Equal(TreeCheckState.Indeterminate, vm.HeaderCheckState);
    }

    [Fact]
    public void ClearAllSelected_removes_every_selection()
    {
        using var vm = NewVm();
        vm.ToggleAllVisible();
        Assert.True(vm.ShowClearAllSelected);
        vm.ClearAllSelected();
        Assert.Equal(0, vm.SelectedCount);
        Assert.False(vm.ShowClearAllSelected);
    }

    [Fact]
    public void Selection_survives_the_search_filter()
    {
        using var vm = NewVm();
        vm.ToggleLeaf("soc");
        Assert.Contains("soc", vm.SelectedValues);

        // "range" filters soc out of view but must not deselect it (web Grafana convention).
        vm.SetSearch("range");
        Assert.Contains("soc", vm.SelectedValues);
        Assert.Equal(1, vm.SelectedCount);
        Assert.Equal(0, vm.VisibleSelectedCount);

        vm.SetSearch(string.Empty);
        Assert.Contains("soc", vm.SelectedValues);
    }

    [Fact]
    public void Initial_selection_is_seeded_and_ignores_unknown_values()
    {
        using var vm = NewVm(initialSelection: ["soc", "ghost"]);
        Assert.Equal(1, vm.SelectedCount);
        Assert.Contains("soc", vm.SelectedValues);
    }

    // ── view-model: disabled leaves ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Disabled_leaf_cannot_be_toggled()
    {
        using var vm = NewVm(expandedByDefault: true, getLeafDisabled: l => l.Value == "power");
        vm.ToggleLeaf("power");
        Assert.Equal(0, vm.SelectedCount);

        TreeSelectRow leaf = vm.Rows.First(r => r.LeafValue == "power");
        Assert.True(leaf.IsDisabled);
        Assert.False(leaf.CanToggle);
    }

    [Fact]
    public void Group_toggle_only_touches_enabled_leaves()
    {
        using var vm = NewVm(getLeafDisabled: l => l.Value == "power");
        vm.ToggleGroupVisible("drive");
        Assert.Equal(1, vm.SelectedCount);
        Assert.Contains("speed", vm.SelectedValues);
        Assert.DoesNotContain("power", vm.SelectedValues);
    }

    [Fact]
    public void Disabled_leaf_row_carries_the_reason_in_its_accessible_name()
    {
        using var vm = NewVm(
            expandedByDefault: true,
            getLeafDisabled: l => l.Value == "power",
            getLeafDisabledReason: _ => "Unavailable");
        TreeSelectRow leaf = vm.Rows.First(r => r.LeafValue == "power");
        Assert.Equal("Power (Unavailable)", leaf.AccessibleName);
    }

    // ── view-model: roving keyboard model (web handleKeyDown) ──────────────────────────────────────────────

    [Fact]
    public void Focus_navigation_clamps_to_the_row_bounds()
    {
        using var vm = NewVm(); // 2 collapsed group rows
        Assert.Equal(0, vm.FocusIndex);

        vm.FocusNext();
        Assert.Equal(1, vm.FocusIndex);
        vm.FocusNext();
        Assert.Equal(1, vm.FocusIndex); // clamped at the last row

        vm.FocusPrevious();
        Assert.Equal(0, vm.FocusIndex);
        vm.FocusPrevious();
        Assert.Equal(0, vm.FocusIndex); // clamped at the first row

        vm.FocusLast();
        Assert.Equal(1, vm.FocusIndex);
        vm.FocusFirst();
        Assert.Equal(0, vm.FocusIndex);
    }

    [Fact]
    public void Focus_move_raises_the_focus_moved_event()
    {
        using var vm = NewVm();
        var moves = new List<int>();
        vm.FocusMoved += (_, index) => moves.Add(index);

        vm.FocusNext();

        Assert.Equal(1, Assert.Single(moves));
    }

    [Fact]
    public void ExpandFocused_opens_a_collapsed_group()
    {
        using var vm = NewVm();
        vm.SetFocusIndex(0);
        vm.ExpandFocused();
        Assert.True(vm.IsRowExpanded("battery"));
    }

    [Fact]
    public void CollapseOrFocusParent_collapses_an_expanded_group()
    {
        using var vm = NewVm();
        vm.ToggleExpanded("battery");
        vm.SetFocusIndex(0);
        vm.CollapseOrFocusParent();
        Assert.False(vm.IsRowExpanded("battery"));
    }

    [Fact]
    public void CollapseOrFocusParent_moves_a_leaf_focus_to_its_parent_group()
    {
        using var vm = NewVm();
        vm.ToggleExpanded("battery");
        vm.SetFocusIndex(1); // soc leaf
        Assert.Equal(TreeSelectRowKind.Leaf, vm.FocusedRow!.Kind);

        vm.CollapseOrFocusParent();
        Assert.Equal(0, vm.FocusIndex);
        Assert.Equal(TreeSelectRowKind.Group, vm.FocusedRow!.Kind);
    }

    [Fact]
    public void ToggleSelectionAtFocus_toggles_a_group_then_a_leaf()
    {
        using var vm = NewVm();
        vm.SetFocusIndex(0); // battery group
        vm.ToggleSelectionAtFocus();
        Assert.Equal(2, vm.SelectedCount);

        vm.ToggleExpanded("battery");
        vm.SetFocusIndex(1); // soc leaf
        vm.ToggleSelectionAtFocus();
        Assert.Equal(1, vm.SelectedCount); // soc deselected
    }

    [Fact]
    public void ToggleExpansionAtFocus_expands_a_focused_group()
    {
        using var vm = NewVm();
        vm.SetFocusIndex(0);
        vm.ToggleExpansionAtFocus();
        Assert.True(vm.IsRowExpanded("battery"));
    }

    // ── view-model: change notifications ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Selection_change_raises_the_selection_changed_event()
    {
        using var vm = NewVm();
        var snapshots = new List<IReadOnlyList<string>>();
        vm.SelectionChanged += (_, values) => snapshots.Add(values);

        vm.ToggleLeaf("soc");

        Assert.Equal(new[] { "soc" }, Assert.Single(snapshots));
    }

    [Fact]
    public void Property_changed_fires_on_search_and_selection()
    {
        using var vm = NewVm();
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.SetSearch("battery");
        vm.ToggleAllVisible();

        Assert.True(raised >= 2);
    }

    // ── view-model: a11y — every projected row carries an accessible name ─────────────────────────────────

    [Fact]
    public void Every_row_carries_an_accessible_name_and_automation_id()
    {
        using var vm = NewVm(expandedByDefault: true);
        Assert.NotEmpty(vm.Rows);
        Assert.All(vm.Rows, row =>
        {
            Assert.False(string.IsNullOrWhiteSpace(row.AccessibleName));
            Assert.False(string.IsNullOrWhiteSpace(row.ToggleName));
            Assert.False(string.IsNullOrWhiteSpace(row.AutomationId));
        });
    }

    [Fact]
    public void Group_row_accessible_name_matches_the_web_aria_label()
    {
        using var vm = NewVm();
        vm.ToggleLeaf("soc");
        TreeSelectRow group = vm.Rows.First(r => r.GroupKey == "battery" && r.Kind == TreeSelectRowKind.Group);
        Assert.Equal("Battery, 1 of 2 selected", group.AccessibleName);
        Assert.Equal("Toggle Battery", group.ToggleName);
    }

    [Fact]
    public void Chrome_labels_route_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        using var vm = NewVm(localizer: localizer);

        _ = vm.SearchHint;
        _ = vm.FilterAria;
        _ = vm.TreeLabel;
        _ = vm.SelectAllLabel;

        Assert.Contains(TreeSelectRegistration.SearchHintKey, localizer.RequestedKeys);
        Assert.Contains(TreeSelectRegistration.FilterAriaKey, localizer.RequestedKeys);
        Assert.Contains(TreeSelectRegistration.TreeLabelKey, localizer.RequestedKeys);
        Assert.Contains(TreeSelectRegistration.SelectAllKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Summary_tracks_the_selection_and_search()
    {
        using var vm = NewVm();
        vm.ToggleLeaf("soc");
        Assert.Equal("1 selected of 4 total", vm.Summary);

        vm.SetSearch("range");
        Assert.Equal("1 selected of 4 total, 1 visible", vm.Summary);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TreeSelectDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TreeSelect", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new TreeSelectDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_groups() =>
        Assert.Throws<System.ArgumentNullException>(() => new TreeSelectViewModel(null!, Localizer));

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => new TreeSelectViewModel(Catalog(), null!));

    [Fact]
    public void FilterGroups_rejects_null_groups() =>
        Assert.Throws<System.ArgumentNullException>(() => TreeSelectProjection.FilterGroups(null!, "x"));

    [Fact]
    public void GroupState_rejects_null_arguments()
    {
        TreeGroup group = Catalog()[0];
        Assert.Throws<System.ArgumentNullException>(() => TreeSelectProjection.GroupState(null!, _ => false, _ => false));
        Assert.Throws<System.ArgumentNullException>(() => TreeSelectProjection.GroupState(group, null!, _ => false));
        Assert.Throws<System.ArgumentNullException>(() => TreeSelectProjection.GroupState(group, _ => false, null!));
    }

    [Fact]
    public void ToggleLeaf_rejects_a_null_value()
    {
        using var vm = NewVm();
        Assert.Throws<System.ArgumentNullException>(() => vm.ToggleLeaf(null!));
    }
}
