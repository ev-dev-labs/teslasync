using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the LayoutSwitcher feature-view's UI-thread-free logic — the pure projection (the
/// web render: active-layout resolution, vehicle-scoped visible filter, active name + pinned-badge label, the
/// per-row menu entries, the edit / save-as / reset / pin actions and the save-as suggestion), the i18n
/// routing through the <c>dashboard</c>-namespaced keys, the accessibility names, the state-holder
/// view-model's commands + events (switch / save-as / reset / pin / edit, menu open-close, the prompt and
/// confirm phases), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/LayoutSwitcher.tsx). The WinUI view itself is exercised by the app
/// build. There is deliberately no loading / stale / error / offline case because the web source is a
/// controlled component with no asynchronous read.
/// </summary>
public sealed class LayoutSwitcherTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LayoutSummary Layout(
        string id,
        string name,
        long? vehicleId = null,
        bool isDefault = false) => new(id, name, vehicleId, isDefault);

    private static LayoutSwitcherModel Model(
        IReadOnlyList<LayoutSummary>? dashboards = null,
        string activeId = "",
        bool dirty = false,
        bool editMode = false,
        long? selectedVehicleId = null,
        LayoutSwitcherVehicle? selectedVehicle = null,
        bool canToggleEdit = true,
        bool canPin = true,
        bool canDuplicate = true) => new(
        dashboards ?? Array.Empty<LayoutSummary>(),
        activeId,
        dirty,
        editMode,
        selectedVehicleId,
        selectedVehicle,
        canToggleEdit,
        canPin,
        canDuplicate);

    private static LayoutSwitcherDisplay Project(LayoutSwitcherModel model, ILocalizer? localizer = null) =>
        LayoutSwitcherProjection.Project(model, localizer ?? Localizer);

    // ── Active-layout resolution (web find(activeId) ?? dashboards[0]) ────────────────────────────────

    [Fact]
    public void Active_resolves_by_id()
    {
        var model = Model(
            new[] { Layout("a", "Alpha"), Layout("b", "Beta") },
            activeId: "b");

        Assert.Equal("b", model.Active?.Id);
        Assert.Equal("Beta", Project(model).ActiveName);
    }

    [Fact]
    public void Active_falls_back_to_first_when_id_unknown()
    {
        var model = Model(
            new[] { Layout("a", "Alpha"), Layout("b", "Beta") },
            activeId: "missing");

        Assert.Equal("a", model.Active?.Id);
        Assert.Equal("Alpha", Project(model).ActiveName);
    }

    [Fact]
    public void Active_is_null_and_name_is_untitled_when_empty()
    {
        var model = Model();

        Assert.Null(model.Active);
        Assert.Equal("Untitled", Project(model).ActiveName);
    }

    // ── Vehicle-scoped visible filter (web visible filter) ───────────────────────────────────────────

    [Fact]
    public void Visible_includes_user_global_and_matching_vehicle_layouts()
    {
        var model = Model(
            new[]
            {
                Layout("global", "Global", vehicleId: null),
                Layout("v5", "For 5", vehicleId: 5),
                Layout("v7", "For 7", vehicleId: 7),
            },
            selectedVehicleId: 5);

        var ids = model.Visible.Select(v => v.Id).ToArray();

        Assert.Equal(new[] { "global", "v5" }, ids);
    }

    [Fact]
    public void Visible_hides_vehicle_pinned_layouts_when_no_vehicle_selected()
    {
        var model = Model(
            new[]
            {
                Layout("global", "Global", vehicleId: null),
                Layout("v5", "For 5", vehicleId: 5),
            },
            selectedVehicleId: null);

        var ids = model.Visible.Select(v => v.Id).ToArray();

        Assert.Equal(new[] { "global" }, ids);
    }

    [Fact]
    public void Empty_visible_set_renders_the_empty_message()
    {
        var model = Model(
            new[] { Layout("v5", "For 5", vehicleId: 5) },
            selectedVehicleId: 7);

        var display = Project(model);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Entries);
        Assert.Equal("No layouts available for this vehicle.", display.EmptyMessage);
    }

    // ── Entries (web visible.map row) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Entries_carry_active_default_and_pin_state()
    {
        var model = Model(
            new[]
            {
                Layout("a", "Alpha", isDefault: true),
                Layout("b", "Beta", vehicleId: 5),
            },
            activeId: "b",
            selectedVehicleId: 5);

        var display = Project(model);
        LayoutMenuEntry alpha = display.Entries.Single(e => e.Id == "a");
        LayoutMenuEntry beta = display.Entries.Single(e => e.Id == "b");

        Assert.True(alpha.ShowDefaultBadge);
        Assert.False(alpha.ShowPinGlyph);
        Assert.False(alpha.IsActive);

        Assert.False(beta.ShowDefaultBadge);
        Assert.True(beta.ShowPinGlyph);
        Assert.True(beta.IsActive);
    }

    [Fact]
    public void Entry_automation_name_folds_in_the_default_badge()
    {
        var model = Model(new[] { Layout("a", "Alpha", isDefault: true) }, activeId: "a");

        LayoutMenuEntry entry = Assert.Single(Project(model).Entries);

        Assert.Equal("Alpha, default", entry.AutomationName);
    }

    [Fact]
    public void Entry_automation_name_is_just_the_name_when_not_default()
    {
        var model = Model(new[] { Layout("a", "Alpha") }, activeId: "a");

        LayoutMenuEntry entry = Assert.Single(Project(model).Entries);

        Assert.Equal("Alpha", entry.AutomationName);
    }

    // ── Modified + pinned badges (web dirty / pinnedLabel) ───────────────────────────────────────────

    [Fact]
    public void Modified_badge_follows_dirty_flag()
    {
        Assert.True(Project(Model(new[] { Layout("a", "Alpha") }, "a", dirty: true)).ShowModifiedBadge);
        Assert.False(Project(Model(new[] { Layout("a", "Alpha") }, "a", dirty: false)).ShowModifiedBadge);
    }

    [Fact]
    public void Pinned_label_prefers_display_name()
    {
        var model = Model(
            new[] { Layout("a", "Alpha", vehicleId: 5) },
            activeId: "a",
            selectedVehicleId: 5,
            selectedVehicle: new LayoutSwitcherVehicle("My Model 3", "VIN123"));

        var display = Project(model);

        Assert.True(display.ShowPinnedBadge);
        Assert.Equal("My Model 3", display.PinnedLabel);
    }

    [Fact]
    public void Pinned_label_falls_back_to_vin_then_id()
    {
        var byVin = Project(Model(
            new[] { Layout("a", "Alpha", vehicleId: 5) },
            "a",
            selectedVehicleId: 5,
            selectedVehicle: new LayoutSwitcherVehicle(null, "VIN123")));
        Assert.Equal("VIN123", byVin.PinnedLabel);

        var byId = Project(Model(
            new[] { Layout("a", "Alpha", vehicleId: 5) },
            "a",
            selectedVehicleId: 5,
            selectedVehicle: new LayoutSwitcherVehicle(null, null)));
        Assert.Equal("#5", byId.PinnedLabel);
    }

    [Fact]
    public void Pinned_label_is_absent_when_active_is_unpinned_or_no_vehicle()
    {
        var unpinned = Project(Model(
            new[] { Layout("a", "Alpha", vehicleId: null) },
            "a",
            selectedVehicle: new LayoutSwitcherVehicle("Car", null)));
        Assert.False(unpinned.ShowPinnedBadge);
        Assert.Null(unpinned.PinnedLabel);

        var noVehicle = Project(Model(
            new[] { Layout("a", "Alpha", vehicleId: 5) },
            "a",
            selectedVehicleId: 5,
            selectedVehicle: null));
        Assert.False(noVehicle.ShowPinnedBadge);
    }

    // ── Edit button (web onToggleEdit + editMode) ────────────────────────────────────────────────────

    [Fact]
    public void Edit_button_hidden_without_capability()
    {
        Assert.False(Project(Model(canToggleEdit: false)).ShowEditButton);
        Assert.True(Project(Model(canToggleEdit: true)).ShowEditButton);
    }

    [Fact]
    public void Edit_button_label_toggles_with_edit_mode()
    {
        Assert.Equal("Edit", Project(Model(editMode: false)).EditButtonLabel);
        Assert.Equal("Done", Project(Model(editMode: true)).EditButtonLabel);
        Assert.True(Project(Model(editMode: true)).EditActive);
    }

    // ── Pin toggle item (web onPinToVehicle && active + disabled guard) ──────────────────────────────

    [Fact]
    public void Pin_toggle_hidden_without_capability_or_active()
    {
        Assert.False(Project(Model(new[] { Layout("a", "Alpha") }, "a", canPin: false)).ShowPinToggle);
        Assert.False(Project(Model(canPin: true)).ShowPinToggle); // no active layout
        Assert.True(Project(Model(new[] { Layout("a", "Alpha") }, "a", canPin: true)).ShowPinToggle);
    }

    [Fact]
    public void Pin_toggle_label_and_enabled_state_match_web()
    {
        // Unpinned active + a selected vehicle → "Pin to current vehicle", enabled.
        var pinnable = Project(Model(
            new[] { Layout("a", "Alpha", vehicleId: null) },
            "a",
            selectedVehicleId: 9));
        Assert.Equal("Pin to current vehicle", pinnable.PinToggleLabel);
        Assert.True(pinnable.PinToggleEnabled);

        // Unpinned active + no selected vehicle → disabled (web disabled guard).
        var noTarget = Project(Model(new[] { Layout("a", "Alpha", vehicleId: null) }, "a"));
        Assert.False(noTarget.PinToggleEnabled);

        // Pinned active → "Unpin from vehicle", always enabled.
        var unpin = Project(Model(new[] { Layout("a", "Alpha", vehicleId: 9) }, "a", selectedVehicleId: 9));
        Assert.Equal("Unpin from vehicle", unpin.PinToggleLabel);
        Assert.True(unpin.PinToggleEnabled);
    }

    // ── Save-as suggestion (web `${active.name} (Copy)` / newLayoutDefault) ──────────────────────────

    [Fact]
    public void SaveAs_suggestion_appends_copy_for_active_layout()
    {
        var model = Model(new[] { Layout("a", "Alpha") }, activeId: "a");

        Assert.Equal("Alpha (Copy)", Project(model).SaveAsSuggestion);
    }

    [Fact]
    public void SaveAs_suggestion_is_new_layout_default_when_empty()
    {
        Assert.Equal("New Layout", Project(Model()).SaveAsSuggestion);
    }

    // ── Label casing + i18n routing ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Label_is_uppercased()
    {
        Assert.Equal("LAYOUT", Project(Model()).LabelText);
    }

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(
            Model(new[] { Layout("a", "Alpha", isDefault: true, vehicleId: 5) }, "a", dirty: true, selectedVehicleId: 5),
            new PrefixLocalizer());

        Assert.Equal("L:DASHBOARD.LAYOUT.LABEL", display.LabelText);
        Assert.Equal("L:dashboard.layout.switcherLabel", display.SwitcherAutomationName);
        Assert.Equal("L:dashboard.layout.modified", display.ModifiedText);
        Assert.Equal("L:dashboard.layout.menuLabel", display.MenuAutomationName);
        Assert.Equal("L:dashboard.layout.newFromCurrent", display.NewFromCurrentLabel);
        Assert.Equal("L:dashboard.layout.reset", display.ResetItemLabel);
        Assert.Equal("L:dashboard.layout.menuFooter", display.MenuFooterText);
        Assert.Equal("L:dashboard.layout.saveAsPrompt", display.SaveAsPromptTitle);
        Assert.Equal("L:dashboard.layout.resetTitle", display.ResetConfirmTitle);
        Assert.Equal("L:dashboard.layout.resetMessage", display.ResetConfirmMessage);
        Assert.Equal("L:dashboard.layout.resetConfirm", display.ResetConfirmLabel);
        Assert.Equal("L:common.cancel", display.CancelLabel);
    }

    [Fact]
    public void Empty_message_and_unpin_route_through_localizer()
    {
        var empty = Project(Model(new[] { Layout("v", "V", vehicleId: 5) }, "v", selectedVehicleId: 7), new PrefixLocalizer());
        Assert.Equal("L:dashboard.layout.noneVisible", empty.EmptyMessage);

        var unpin = Project(Model(new[] { Layout("a", "A", vehicleId: 5) }, "a", selectedVehicleId: 5), new PrefixLocalizer());
        Assert.Equal("L:dashboard.layout.unpin", unpin.PinToggleLabel);
    }

    // ── Accessibility (every interactive surface has a Narrator name) ─────────────────────────────────

    [Fact]
    public void Projection_exposes_non_empty_accessibility_names()
    {
        var display = Project(Model(
            new[] { Layout("a", "Alpha", isDefault: true), Layout("b", "Beta", vehicleId: 5) },
            "a",
            selectedVehicleId: 5));

        Assert.False(string.IsNullOrWhiteSpace(display.SwitcherAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.MenuAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.SaveAsTooltip));
        Assert.False(string.IsNullOrWhiteSpace(display.ResetTooltip));
        Assert.False(string.IsNullOrWhiteSpace(display.EditButtonTooltip));
        Assert.All(display.Entries, e => Assert.False(string.IsNullOrWhiteSpace(e.AutomationName)));
    }

    // ── Projection guards ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_model() =>
        Assert.Throws<ArgumentNullException>(() => LayoutSwitcherProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => LayoutSwitcherProjection.Project(LayoutSwitcherModel.Empty, null!));

    // ── View-model: seeding + input updates ──────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_seeds_display_from_model()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));

        Assert.Equal("Alpha", vm.Display.ActiveName);
        Assert.False(vm.IsMenuOpen);
        Assert.Equal(LayoutSwitcherActionPhase.Idle, vm.Phase);
    }

    [Fact]
    public void ViewModel_set_active_id_reprojects_and_raises()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha"), Layout("b", "Beta") }, "a"));
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetActiveId("b");

        Assert.Equal("Beta", vm.Display.ActiveName);
        Assert.Contains(nameof(LayoutSwitcherViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_set_dirty_and_edit_mode_flow_to_display()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));

        vm.SetDirty(true);
        vm.SetEditMode(true);

        Assert.True(vm.Display.ShowModifiedBadge);
        Assert.Equal("Done", vm.Display.EditButtonLabel);
    }

    [Fact]
    public void ViewModel_set_selected_vehicle_reveals_pinned_layout()
    {
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("v", "Vehicle Only", vehicleId: 5) }, "v"));
        Assert.True(vm.Display.IsEmpty);

        vm.SetSelectedVehicle(5, new LayoutSwitcherVehicle("Car", null));

        Assert.False(vm.Display.IsEmpty);
        Assert.Equal("Car", vm.Display.PinnedLabel);
    }

    // ── View-model: menu open/close ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_menu_toggle_tracks_open_state()
    {
        var vm = new LayoutSwitcherViewModel(Localizer);

        vm.ToggleMenu();
        Assert.True(vm.IsMenuOpen);

        vm.ToggleMenu();
        Assert.False(vm.IsMenuOpen);
    }

    // ── View-model: switch (web onSwitch + close) ────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_switch_raises_event_and_closes_menu()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha"), Layout("b", "Beta") }, "a"));
        vm.OpenMenu();
        string? switched = null;
        vm.SwitchRequested += (_, e) => switched = e.LayoutId;

        vm.Switch("b");

        Assert.Equal("b", switched);
        Assert.False(vm.IsMenuOpen);
    }

    // ── View-model: save-as (web handleSaveAs) ───────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_begin_save_as_opens_prompt_and_closes_menu()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        vm.OpenMenu();

        vm.BeginSaveAs();

        Assert.True(vm.IsSaveAsPromptOpen);
        Assert.False(vm.IsMenuOpen);
    }

    [Fact]
    public void ViewModel_commit_save_as_empty_is_noop()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        bool created = false;
        bool duplicated = false;
        vm.CreateRequested += (_, _) => created = true;
        vm.DuplicateRequested += (_, _) => duplicated = true;

        vm.BeginSaveAs();
        vm.CommitSaveAs("   ");

        Assert.False(created);
        Assert.False(duplicated);
        Assert.False(vm.IsSaveAsPromptOpen);
    }

    [Fact]
    public void ViewModel_commit_save_as_duplicates_active_when_supported()
    {
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha") }, "a", canDuplicate: true));
        string? duplicatedId = null;
        vm.DuplicateRequested += (_, e) => duplicatedId = e.LayoutId;

        vm.BeginSaveAs();
        vm.CommitSaveAs("Ignored Name");

        Assert.Equal("a", duplicatedId);
    }

    [Fact]
    public void ViewModel_commit_save_as_creates_with_trimmed_name_when_no_duplicate()
    {
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha") }, "a", canDuplicate: false));
        string? createdName = null;
        vm.CreateRequested += (_, e) => createdName = e.Name;

        vm.BeginSaveAs();
        vm.CommitSaveAs("  My Layout  ");

        Assert.Equal("My Layout", createdName);
    }

    [Fact]
    public void ViewModel_cancel_save_as_closes_prompt()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        vm.BeginSaveAs();

        vm.CancelSaveAs();

        Assert.False(vm.IsSaveAsPromptOpen);
    }

    // ── View-model: reset (web handleReset + useConfirm) ─────────────────────────────────────────────

    [Fact]
    public void ViewModel_begin_reset_opens_confirmation()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        vm.OpenMenu();

        vm.BeginReset();

        Assert.True(vm.IsResetConfirmOpen);
        Assert.False(vm.IsMenuOpen);
    }

    [Fact]
    public void ViewModel_confirm_reset_raises_event()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        bool reset = false;
        vm.ResetRequested += (_, _) => reset = true;

        vm.BeginReset();
        vm.ConfirmReset();

        Assert.True(reset);
        Assert.False(vm.IsResetConfirmOpen);
    }

    [Fact]
    public void ViewModel_cancel_reset_does_not_raise()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        bool reset = false;
        vm.ResetRequested += (_, _) => reset = true;

        vm.BeginReset();
        vm.CancelReset();

        Assert.False(reset);
        Assert.False(vm.IsResetConfirmOpen);
    }

    // ── View-model: pin toggle (web handlePinToggle) ─────────────────────────────────────────────────

    [Fact]
    public void ViewModel_toggle_pin_pins_active_to_selected_vehicle()
    {
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha", vehicleId: null) }, "a", selectedVehicleId: 9));
        LayoutPinEventArgs? pin = null;
        vm.PinToVehicleRequested += (_, e) => pin = e;

        vm.TogglePin();

        Assert.NotNull(pin);
        Assert.Equal("a", pin!.LayoutId);
        Assert.Equal(9, pin.VehicleId);
    }

    [Fact]
    public void ViewModel_toggle_pin_unpins_pinned_active()
    {
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha", vehicleId: 9) }, "a", selectedVehicleId: 9));
        LayoutPinEventArgs? pin = null;
        vm.PinToVehicleRequested += (_, e) => pin = e;

        vm.TogglePin();

        Assert.NotNull(pin);
        Assert.Null(pin!.VehicleId);
    }

    [Fact]
    public void ViewModel_toggle_pin_noop_without_capability_or_target()
    {
        var noCap = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha", vehicleId: null) }, "a", selectedVehicleId: 9, canPin: false));
        bool raised = false;
        noCap.PinToVehicleRequested += (_, _) => raised = true;
        noCap.TogglePin();
        Assert.False(raised);

        var noTarget = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha", vehicleId: null) }, "a", selectedVehicleId: null));
        bool raised2 = false;
        noTarget.PinToVehicleRequested += (_, _) => raised2 = true;
        noTarget.TogglePin();
        Assert.False(raised2);
    }

    // ── View-model: edit toggle (web onToggleEdit) ───────────────────────────────────────────────────

    [Fact]
    public void ViewModel_toggle_edit_raises_when_supported()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(canToggleEdit: true));
        bool toggled = false;
        vm.ToggleEditRequested += (_, _) => toggled = true;

        vm.ToggleEdit();

        Assert.True(toggled);
    }

    [Fact]
    public void ViewModel_toggle_edit_noop_without_capability()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(canToggleEdit: false));
        bool toggled = false;
        vm.ToggleEditRequested += (_, _) => toggled = true;

        vm.ToggleEdit();

        Assert.False(toggled);
    }

    [Fact]
    public void ViewModel_reload_reprojects()
    {
        var vm = new LayoutSwitcherViewModel(Localizer, Model(new[] { Layout("a", "Alpha") }, "a"));
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Contains(nameof(LayoutSwitcherViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new LayoutSwitcherViewModel(null!));

    // ── Diagnostics (PII-safe, slug-tagged) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_emits_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LayoutSwitcherDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LayoutSwitcher", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_action_counters_emit_slug_only()
    {
        var lines = new List<string>();
        var diagnostics = new LayoutSwitcherDiagnostics(lines.Add);

        diagnostics.RecordLayoutSwitched();
        diagnostics.RecordLayoutCreated();
        diagnostics.RecordLayoutReset();
        diagnostics.RecordPinToggled();

        Assert.Equal(1, diagnostics.LayoutsSwitched);
        Assert.Equal(1, diagnostics.LayoutsCreated);
        Assert.Equal(1, diagnostics.LayoutsReset);
        Assert.Equal(1, diagnostics.PinsToggled);
        Assert.All(lines, line => Assert.Contains("slug=LayoutSwitcher", line, StringComparison.Ordinal));
    }

    [Fact]
    public void Diagnostics_flow_through_view_model_actions()
    {
        var lines = new List<string>();
        var diagnostics = new LayoutSwitcherDiagnostics(lines.Add);
        var vm = new LayoutSwitcherViewModel(
            Localizer,
            Model(new[] { Layout("a", "Alpha") }, "a"),
            diagnostics);

        vm.Switch("a");
        vm.BeginReset();
        vm.ConfirmReset();

        Assert.Equal(1, diagnostics.LayoutsSwitched);
        Assert.Equal(1, diagnostics.LayoutsReset);
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new LayoutSwitcherDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_and_id_are_stable()
    {
        Assert.Equal("LayoutSwitcher", LayoutSwitcherRegistration.Slug);
        Assert.Equal("layout-switcher", LayoutSwitcherRegistration.Id);
    }

    // ── Helpers / test doubles ──────────────────────────────────────────────────────────────────────

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
