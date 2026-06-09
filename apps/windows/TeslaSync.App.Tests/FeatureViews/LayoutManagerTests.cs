using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the LayoutManager feature-view's UI-thread-free logic — the pure reorder adapter
/// (web <c>onReorder</c> drop-to-reposition), the per-state projection (ready / empty) with its localized chrome,
/// emoji fallback, active marking, default badge and per-layout context menu, the i18n routing, the accessibility
/// names, the state-holder view-model's full interaction surface (select / create / rename / delete / duplicate /
/// settings / reorder / templates, each mirroring the web callback contract) and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/features/dashboard/components/LayoutManager.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class LayoutManagerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LayoutDashboard Dash(string id, string name, string? icon = null, bool isDefault = false) =>
        new(id, name, icon, isDefault);

    private static IReadOnlyList<LayoutDashboard> Three() =>
        new[]
        {
            Dash("a", "Overview", "🚗", isDefault: true),
            Dash("b", "Battery", "🔋"),
            Dash("c", "Trips"),
        };

    private static LayoutManagerDisplay Project(IReadOnlyList<LayoutDashboard>? dashboards, string? activeId = null, ILocalizer? localizer = null) =>
        LayoutManagerProjection.Project(dashboards, activeId, localizer ?? Localizer);

    private static LayoutManagerViewModel Vm(
        IReadOnlyList<LayoutDashboard>? dashboards = null,
        string? activeId = null,
        bool supportsTemplates = false) =>
        new(Localizer, dashboards ?? Three(), activeId, supportsTemplates);

    // ---- Reorder adapter (web onReorder drop-to-reposition) -------------------------

    [Fact]
    public void Reorder_moves_forward()
    {
        var result = LayoutManagerProjection.Reorder(new[] { "a", "b", "c" }, 0, 2);
        Assert.Equal(new[] { "b", "c", "a" }, result);
    }

    [Fact]
    public void Reorder_moves_backward()
    {
        var result = LayoutManagerProjection.Reorder(new[] { "a", "b", "c" }, 2, 0);
        Assert.Equal(new[] { "c", "a", "b" }, result);
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(-1, 0)]
    [InlineData(0, 5)]
    public void Reorder_noop_or_out_of_range_is_unchanged(int from, int to)
    {
        var result = LayoutManagerProjection.Reorder(new[] { "a", "b", "c" }, from, to);
        Assert.Equal(new[] { "a", "b", "c" }, result);
    }

    [Fact]
    public void Reorder_null_is_empty() =>
        Assert.Empty(LayoutManagerProjection.Reorder<string>(null, 0, 1));

    // ---- Projection: empty ----------------------------------------------------------

    [Fact]
    public void Project_empty_has_no_tabs_but_keeps_chrome()
    {
        var display = Project(Array.Empty<LayoutDashboard>());

        Assert.Equal(LayoutManagerState.Empty, display.State);
        Assert.Empty(display.Tabs);
        Assert.Equal("New Layout", display.NewLayoutLabel);
        Assert.Equal("Layout name...", display.NewNameHint);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(display.NewLayoutGlyph));
    }

    [Fact]
    public void Project_null_dashboards_is_empty() =>
        Assert.Equal(LayoutManagerState.Empty, Project(null).State);

    // ---- Projection: ready ----------------------------------------------------------

    [Fact]
    public void Project_ready_maps_every_dashboard_in_order()
    {
        var display = Project(Three(), activeId: "b");

        Assert.Equal(LayoutManagerState.Ready, display.State);
        Assert.Equal(3, display.Tabs.Count);
        Assert.Equal(new[] { "a", "b", "c" }, display.Tabs.Select(t => t.Id));
    }

    [Fact]
    public void Project_marks_only_the_active_tab()
    {
        var display = Project(Three(), activeId: "b");

        Assert.False(display.Tabs[0].IsActive);
        Assert.True(display.Tabs[1].IsActive);
        Assert.False(display.Tabs[2].IsActive);
    }

    [Fact]
    public void Project_no_active_id_marks_nothing() =>
        Assert.DoesNotContain(Project(Three()).Tabs, t => t.IsActive);

    [Fact]
    public void Project_falls_back_to_bar_chart_emoji_when_icon_missing()
    {
        var display = Project(new[] { Dash("c", "Trips") });
        Assert.Equal(LayoutManagerProjection.DefaultIcon, display.Tabs[0].IconGlyph);
    }

    [Fact]
    public void Project_keeps_provided_icon()
    {
        var display = Project(new[] { Dash("b", "Battery", "🔋") });
        Assert.Equal("🔋", display.Tabs[0].IconGlyph);
    }

    [Fact]
    public void Project_default_layout_shows_badge_and_announces_it()
    {
        var display = Project(Three());
        LayoutTab def = display.Tabs[0];

        Assert.True(def.IsDefault);
        Assert.Equal("default", def.DefaultBadge);
        Assert.Equal("Overview, default", def.AutomationName);
    }

    [Fact]
    public void Project_non_default_layout_has_no_badge()
    {
        var display = Project(Three());
        LayoutTab tab = display.Tabs[1];

        Assert.False(tab.IsDefault);
        Assert.Null(tab.DefaultBadge);
        Assert.Equal("Battery", tab.AutomationName);
    }

    // ---- Context menu ---------------------------------------------------------------

    [Fact]
    public void BuildMenu_has_four_entries_in_web_order()
    {
        var menu = LayoutManagerProjection.BuildMenu(Project(Three()), isDefault: false);

        Assert.Equal(
            new[] { LayoutAction.Rename, LayoutAction.Duplicate, LayoutAction.Settings, LayoutAction.Delete },
            menu.Select(m => m.Action));
    }

    [Fact]
    public void BuildMenu_delete_is_destructive_and_others_are_not()
    {
        var menu = LayoutManagerProjection.BuildMenu(Project(Three()), isDefault: false);

        Assert.True(menu.Single(m => m.Action == LayoutAction.Delete).IsDanger);
        Assert.DoesNotContain(menu.Where(m => m.Action != LayoutAction.Delete), m => m.IsDanger);
    }

    [Fact]
    public void BuildMenu_disables_delete_for_default_layout()
    {
        var menu = LayoutManagerProjection.BuildMenu(Project(Three()), isDefault: true);
        Assert.False(menu.Single(m => m.Action == LayoutAction.Delete).IsEnabled);
    }

    [Fact]
    public void BuildMenu_enables_delete_for_non_default_layout()
    {
        var menu = LayoutManagerProjection.BuildMenu(Project(Three()), isDefault: false);
        Assert.True(menu.Single(m => m.Action == LayoutAction.Delete).IsEnabled);
    }

    [Fact]
    public void BuildMenu_labels_match_display_and_every_entry_has_a_glyph()
    {
        var display = Project(Three());
        var menu = LayoutManagerProjection.BuildMenu(display, isDefault: false);

        Assert.Equal(display.RenameLabel, menu[0].Label);
        Assert.Equal(display.DuplicateLabel, menu[1].Label);
        Assert.Equal(display.SettingsLabel, menu[2].Label);
        Assert.Equal(display.DeleteLabel, menu[3].Label);
        Assert.DoesNotContain(menu, m => string.IsNullOrWhiteSpace(m.Glyph));
    }

    // ---- i18n routing (every owned string flows through the facade) -----------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(Three(), localizer: new PrefixLocalizer());

        Assert.Equal("L:dashboard.newLayout", display.NewLayoutLabel);
        Assert.Equal("L:dashboard.newName", display.NewNameHint);
        Assert.Equal("L:dashboard.confirmRename", display.ConfirmRenameLabel);
        Assert.Equal("L:dashboard.cancelRename", display.CancelRenameLabel);
        Assert.Equal("L:dashboard.confirmCreate", display.ConfirmCreateLabel);
        Assert.Equal("L:dashboard.cancelCreate", display.CancelCreateLabel);
        Assert.Equal("L:dashboard.rename", display.RenameLabel);
        Assert.Equal("L:dashboard.duplicate", display.DuplicateLabel);
        Assert.Equal("L:dashboard.settings", display.SettingsLabel);
        Assert.Equal("L:dashboard.delete", display.DeleteLabel);
        Assert.Equal("L:dashboard.default", display.DefaultBadge);
    }

    [Fact]
    public void Project_routes_default_badge_on_tabs_through_localizer()
    {
        var display = Project(Three(), localizer: new PrefixLocalizer());
        Assert.Equal("L:dashboard.default", display.Tabs[0].DefaultBadge);
    }

    // ---- Accessibility --------------------------------------------------------------

    [Fact]
    public void Project_region_name_and_tab_names_are_non_empty()
    {
        var display = Project(Three(), activeId: "a");

        Assert.False(string.IsNullOrWhiteSpace(display.RegionName));
        Assert.DoesNotContain(display.Tabs, t => string.IsNullOrWhiteSpace(t.AutomationName));
    }

    [Fact]
    public void Project_confirm_and_cancel_labels_are_non_empty()
    {
        var display = Project(Three());

        Assert.False(string.IsNullOrWhiteSpace(display.ConfirmRenameLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.CancelRenameLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.ConfirmCreateLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.CancelCreateLabel));
    }

    // ---- Projection guards ----------------------------------------------------------

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => LayoutManagerProjection.Project(Three(), null, null!));

    [Fact]
    public void BuildMenu_rejects_null_display() =>
        Assert.Throws<ArgumentNullException>(() => LayoutManagerProjection.BuildMenu(null!, false));

    // ---- View-model: seeding --------------------------------------------------------

    [Fact]
    public void ViewModel_seeds_from_dashboards()
    {
        var vm = Vm(Three(), activeId: "b");

        Assert.Equal(LayoutManagerState.Ready, vm.State);
        Assert.True(vm.HasTabs);
        Assert.Equal(3, vm.Dashboards.Count);
        Assert.Equal("b", vm.ActiveId);
        Assert.False(vm.IsEditing);
        Assert.False(vm.IsCreating);
    }

    [Fact]
    public void ViewModel_seeds_empty_from_null()
    {
        var vm = new LayoutManagerViewModel(Localizer);

        Assert.Equal(LayoutManagerState.Empty, vm.State);
        Assert.False(vm.HasTabs);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new LayoutManagerViewModel(null!));

    // ---- View-model: select ---------------------------------------------------------

    [Fact]
    public void ViewModel_select_raises_switch_and_marks_active()
    {
        var vm = Vm(Three(), activeId: "a");
        var switched = new List<string>();
        vm.SwitchRequested += (_, id) => switched.Add(id);

        vm.Select("c");

        Assert.Equal("c", Assert.Single(switched));
        Assert.Equal("c", vm.ActiveId);
        Assert.True(vm.Tabs.Single(t => t.Id == "c").IsActive);
    }

    [Fact]
    public void ViewModel_select_already_active_still_raises_switch()
    {
        var vm = Vm(Three(), activeId: "a");
        int count = 0;
        vm.SwitchRequested += (_, _) => count++;

        vm.Select("a");

        Assert.Equal(1, count);
        Assert.Equal("a", vm.ActiveId);
    }

    // ---- View-model: create ---------------------------------------------------------

    [Fact]
    public void ViewModel_begin_create_opens_inline_field_when_no_templates()
    {
        var vm = Vm(supportsTemplates: false);
        vm.BeginCreate();
        Assert.True(vm.IsCreating);
    }

    [Fact]
    public void ViewModel_begin_create_opens_templates_when_wired()
    {
        var vm = Vm(supportsTemplates: true);
        int templates = 0;
        vm.OpenTemplatesRequested += (_, _) => templates++;

        vm.BeginCreate();

        Assert.Equal(1, templates);
        Assert.False(vm.IsCreating);
    }

    [Fact]
    public void ViewModel_confirm_create_emits_trimmed_name_and_closes()
    {
        var vm = Vm();
        var created = new List<string>();
        vm.CreateRequested += (_, name) => created.Add(name);
        vm.BeginCreate();

        vm.ConfirmCreate("  Energy  ");

        Assert.Equal("Energy", Assert.Single(created));
        Assert.False(vm.IsCreating);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ViewModel_confirm_create_blank_creates_nothing_but_closes(string? name)
    {
        var vm = Vm();
        int created = 0;
        vm.CreateRequested += (_, _) => created++;
        vm.BeginCreate();

        vm.ConfirmCreate(name);

        Assert.Equal(0, created);
        Assert.False(vm.IsCreating);
    }

    [Fact]
    public void ViewModel_cancel_create_closes_field()
    {
        var vm = Vm();
        vm.BeginCreate();
        vm.CancelCreate();
        Assert.False(vm.IsCreating);
    }

    // ---- View-model: rename ---------------------------------------------------------

    [Fact]
    public void ViewModel_begin_rename_seeds_editor_with_current_name()
    {
        var vm = Vm(Three());
        vm.BeginRename("b");

        Assert.True(vm.IsEditing);
        Assert.Equal("b", vm.EditingId);
        Assert.Equal("Battery", vm.EditingName);
    }

    [Fact]
    public void ViewModel_begin_rename_unknown_id_is_noop()
    {
        var vm = Vm(Three());
        vm.BeginRename("zzz");
        Assert.False(vm.IsEditing);
    }

    [Fact]
    public void ViewModel_confirm_rename_emits_trimmed_request_and_ends_editing()
    {
        var vm = Vm(Three());
        var renames = new List<LayoutRenameRequest>();
        vm.RenameRequested += (_, r) => renames.Add(r);
        vm.BeginRename("b");

        vm.ConfirmRename("  Cells  ");

        LayoutRenameRequest request = Assert.Single(renames);
        Assert.Equal("b", request.Id);
        Assert.Equal("Cells", request.Name);
        Assert.False(vm.IsEditing);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ViewModel_confirm_rename_blank_renames_nothing_but_ends_editing(string? name)
    {
        var vm = Vm(Three());
        int renames = 0;
        vm.RenameRequested += (_, _) => renames++;
        vm.BeginRename("b");

        vm.ConfirmRename(name);

        Assert.Equal(0, renames);
        Assert.False(vm.IsEditing);
    }

    [Fact]
    public void ViewModel_cancel_rename_ends_editing_without_event()
    {
        var vm = Vm(Three());
        int renames = 0;
        vm.RenameRequested += (_, _) => renames++;
        vm.BeginRename("b");

        vm.CancelRename();

        Assert.Equal(0, renames);
        Assert.False(vm.IsEditing);
    }

    [Fact]
    public void ViewModel_begin_create_cancels_active_rename()
    {
        var vm = Vm(Three());
        vm.BeginRename("b");
        vm.BeginCreate();

        Assert.False(vm.IsEditing);
        Assert.True(vm.IsCreating);
    }

    [Fact]
    public void ViewModel_begin_rename_cancels_active_create()
    {
        var vm = Vm(Three());
        vm.BeginCreate();
        vm.BeginRename("b");

        Assert.False(vm.IsCreating);
        Assert.True(vm.IsEditing);
    }

    // ---- View-model: delete / duplicate / settings ----------------------------------

    [Fact]
    public void ViewModel_delete_non_default_raises_request()
    {
        var vm = Vm(Three());
        var deleted = new List<string>();
        vm.DeleteRequested += (_, id) => deleted.Add(id);

        vm.Delete("b");

        Assert.Equal("b", Assert.Single(deleted));
    }

    [Fact]
    public void ViewModel_delete_default_is_blocked()
    {
        var vm = Vm(Three());
        int deleted = 0;
        vm.DeleteRequested += (_, _) => deleted++;

        vm.Delete("a");

        Assert.Equal(0, deleted);
    }

    [Fact]
    public void ViewModel_delete_unknown_id_is_noop()
    {
        var vm = Vm(Three());
        int deleted = 0;
        vm.DeleteRequested += (_, _) => deleted++;

        vm.Delete("zzz");

        Assert.Equal(0, deleted);
    }

    [Fact]
    public void ViewModel_duplicate_raises_request()
    {
        var vm = Vm(Three());
        var duplicated = new List<string>();
        vm.DuplicateRequested += (_, id) => duplicated.Add(id);

        vm.Duplicate("c");

        Assert.Equal("c", Assert.Single(duplicated));
    }

    [Fact]
    public void ViewModel_open_settings_raises_request()
    {
        var vm = Vm(Three());
        var settings = new List<string>();
        vm.OpenSettingsRequested += (_, id) => settings.Add(id);

        vm.OpenSettings("b");

        Assert.Equal("b", Assert.Single(settings));
    }

    // ---- View-model: reorder --------------------------------------------------------

    [Fact]
    public void ViewModel_reorder_raises_request_and_applies_optimistically()
    {
        var vm = Vm(Three());
        var reorders = new List<LayoutReorderRequest>();
        vm.ReorderRequested += (_, r) => reorders.Add(r);

        vm.Reorder(0, 2);

        LayoutReorderRequest request = Assert.Single(reorders);
        Assert.Equal(0, request.From);
        Assert.Equal(2, request.To);
        Assert.Equal(new[] { "b", "c", "a" }, vm.Dashboards.Select(d => d.Id));
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(-1, 0)]
    [InlineData(0, 9)]
    public void ViewModel_reorder_invalid_is_noop(int from, int to)
    {
        var vm = Vm(Three());
        int reorders = 0;
        vm.ReorderRequested += (_, _) => reorders++;

        vm.Reorder(from, to);

        Assert.Equal(0, reorders);
        Assert.Equal(new[] { "a", "b", "c" }, vm.Dashboards.Select(d => d.Id));
    }

    // ---- View-model: update / reload ------------------------------------------------

    [Fact]
    public void ViewModel_update_dashboards_replaces_collection_and_active()
    {
        var vm = Vm(Three(), activeId: "a");
        vm.UpdateDashboards(new[] { Dash("x", "New") }, activeId: "x");

        Assert.Single(vm.Dashboards);
        Assert.Equal("x", vm.ActiveId);
        Assert.Equal("x", vm.Tabs[0].Id);
    }

    [Fact]
    public void ViewModel_update_dashboards_cancels_rename_when_target_removed()
    {
        var vm = Vm(Three());
        vm.BeginRename("b");

        vm.UpdateDashboards(new[] { Dash("a", "Overview", isDefault: true) });

        Assert.False(vm.IsEditing);
    }

    [Fact]
    public void ViewModel_update_dashboards_keeps_rename_when_target_present()
    {
        var vm = Vm(Three());
        vm.BeginRename("b");

        vm.UpdateDashboards(Three());

        Assert.True(vm.IsEditing);
        Assert.Equal("b", vm.EditingId);
    }

    [Fact]
    public void ViewModel_reload_reprojects_and_raises_display()
    {
        var vm = Vm(Three());
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Contains(nameof(LayoutManagerViewModel.Display), raised);
        Assert.Contains(nameof(LayoutManagerViewModel.Tabs), raised);
    }

    [Fact]
    public void ViewModel_open_templates_only_fires_when_supported()
    {
        var without = Vm(supportsTemplates: false);
        int firedWithout = 0;
        without.OpenTemplatesRequested += (_, _) => firedWithout++;
        without.OpenTemplates();
        Assert.Equal(0, firedWithout);

        var with = Vm(supportsTemplates: true);
        int firedWith = 0;
        with.OpenTemplatesRequested += (_, _) => firedWith++;
        with.OpenTemplates();
        Assert.Equal(1, firedWith);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LayoutManagerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LayoutManager", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new LayoutManagerDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("LayoutManager", LayoutManagerRegistration.Slug);

    // ---- Helpers / test doubles ----------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
