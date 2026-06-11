using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the HistoryListRow surface's UI-thread-free logic — the registration metadata
/// (slug, automation ids, chevron glyph, per-glow border brush keys, geometry), the pure
/// <see cref="HistoryListRowProjection"/> adapter (slot visibility, actions/chevron branches, the selected
/// tint, the glow brush mapping, the mutually-exclusive navigate / invoke / inert activation, href
/// normalization, automation-id derivation and the defensive empty state), the
/// <see cref="HistoryListRowViewModel"/> state holder (initial projection, runtime prop pushes, the navigation
/// seam) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/data-display/HistoryListRow.tsx). The WinUI view (shared-surfaces/HistoryListRow/
/// HistoryListRow.cs) is exercised by the app build. Because the component reads no network data, there is no
/// loading / error / stale / offline state; the reproduced branches are the ready row, the defensive empty row,
/// each slot present/absent, the hover-revealed actions, the chevron show/hide, the selected tint, each glow,
/// and the three activation modes.
/// </summary>
public sealed class HistoryListRowTests
{
    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("HistoryListRow", HistoryListRowRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("history-list-row", HistoryListRowRegistration.RootAutomationId);

    [Fact]
    public void Panel_automation_id_suffix_mirrors_the_web_testid_panel() =>
        Assert.Equal("-panel", HistoryListRowRegistration.PanelAutomationIdSuffix);

    [Fact]
    public void Default_glow_is_cyan() =>
        Assert.Equal(HistoryListRowGlow.Cyan, HistoryListRowRegistration.DefaultGlow);

    [Fact]
    public void Chevron_glyph_is_the_segoe_fluent_chevron_right() =>
        Assert.Equal("\uE76C", HistoryListRowRegistration.ChevronGlyph);

    [Fact]
    public void Geometry_matches_the_web_layout()
    {
        Assert.Equal(16, HistoryListRowRegistration.PanelPadding);   // web p-3 sm:p-4
        Assert.Equal(36, HistoryListRowRegistration.LeadingColumnWidth); // web w-9
    }

    [Theory]
    [InlineData(HistoryListRowGlow.Cyan, "TsChartSpeedBrush")]
    [InlineData(HistoryListRowGlow.Green, "TsChartBatteryBrush")]
    [InlineData(HistoryListRowGlow.Purple, "TsChartPowerBrush")]
    [InlineData(HistoryListRowGlow.None, "TsColorBorderBrush")]
    public void Glow_brush_key_maps_each_accent(HistoryListRowGlow glow, string expectedKey) =>
        Assert.Equal(expectedKey, HistoryListRowRegistration.GlowBrushKey(glow));

    [Fact]
    public void Selected_border_uses_the_cyan_accent_brush() =>
        Assert.Equal("TsChartSpeedBrush", HistoryListRowRegistration.SelectedBorderBrushKey);

    // ── projection adapter (web component body conditional branches) ──────────────────────────────────────

    [Fact]
    public void Projection_shows_each_populated_slot()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(
            HasPrimary: true,
            HasCheckbox: true,
            HasLeading: true,
            HasRoute: true,
            HasMetrics: true,
            HasInsight: true));

        Assert.Equal(HistoryListRowState.Ready, projection.State);
        Assert.True(projection.ShowPrimary);
        Assert.True(projection.ShowCheckbox);
        Assert.True(projection.ShowLeading);
        Assert.True(projection.ShowRoute);
        Assert.True(projection.ShowMetrics);
        Assert.True(projection.ShowInsight);
    }

    [Fact]
    public void Projection_hides_each_absent_slot()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true));

        Assert.False(projection.ShowCheckbox);
        Assert.False(projection.ShowLeading);
        Assert.False(projection.ShowRoute);
        Assert.False(projection.ShowMetrics);
        Assert.False(projection.ShowInsight);
        Assert.False(projection.ShowActions);
    }

    [Fact]
    public void Projection_shows_actions_only_when_at_least_one_is_supplied()
    {
        Assert.False(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, ActionCount: 0)).ShowActions);
        Assert.True(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, ActionCount: 1)).ShowActions);
        Assert.True(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, ActionCount: 4)).ShowActions);
    }

    [Fact]
    public void Projection_clamps_a_negative_action_count_to_zero()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, ActionCount: -3));

        Assert.Equal(0, projection.ActionCount);
        Assert.False(projection.ShowActions);
    }

    [Fact]
    public void Projection_shows_the_chevron_unless_hidden()
    {
        Assert.True(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, HideChevron: false)).ShowChevron);
        Assert.False(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, HideChevron: true)).ShowChevron);
    }

    [Fact]
    public void Projection_carries_the_selected_tint()
    {
        Assert.False(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true)).IsSelected);
        Assert.True(HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Selected: true)).IsSelected);
    }

    [Fact]
    public void Projection_resolves_the_glow_brush_key()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Glow: HistoryListRowGlow.Green));

        Assert.Equal(HistoryListRowGlow.Green, projection.Glow);
        Assert.Equal("TsChartBatteryBrush", projection.GlowBrushKey);
    }

    [Fact]
    public void Projection_navigates_when_an_href_is_present()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Href: "/drives/123"));

        Assert.Equal(HistoryListRowActivation.Navigate, projection.Activation);
        Assert.True(projection.IsInteractive);
        Assert.Equal("/drives/123", projection.Href);
    }

    [Fact]
    public void Projection_invokes_when_only_a_click_handler_is_present()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, HasClickHandler: true));

        Assert.Equal(HistoryListRowActivation.Invoke, projection.Activation);
        Assert.True(projection.IsInteractive);
        Assert.Equal(string.Empty, projection.Href);
    }

    [Fact]
    public void Projection_href_wins_over_a_click_handler()
    {
        // web: href and onClick are mutually exclusive; an href wraps the body in a Link.
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Href: "/x", HasClickHandler: true));

        Assert.Equal(HistoryListRowActivation.Navigate, projection.Activation);
    }

    [Fact]
    public void Projection_is_inert_without_href_or_click_handler()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true));

        Assert.Equal(HistoryListRowActivation.None, projection.Activation);
        Assert.False(projection.IsInteractive);
    }

    [Fact]
    public void Projection_trims_the_href_and_treats_blank_as_not_navigable()
    {
        Assert.Equal("/x", HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Href: "  /x  ")).Href);
        Assert.Equal(HistoryListRowActivation.None, HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Href: "   ")).Activation);
        Assert.Equal(HistoryListRowActivation.None, HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Href: "")).Activation);
    }

    [Fact]
    public void Projection_derives_the_automation_ids_from_the_test_id()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, TestId: "drive-row"));

        Assert.Equal("drive-row", projection.AutomationId);
        Assert.Equal("drive-row-panel", projection.PanelAutomationId);
    }

    [Fact]
    public void Projection_leaves_the_automation_ids_null_without_a_test_id()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true));

        Assert.Null(projection.AutomationId);
        Assert.Null(projection.PanelAutomationId);
    }

    [Fact]
    public void Projection_collapses_to_empty_without_a_primary()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: false, HasRoute: true));

        Assert.Equal(HistoryListRowState.Empty, projection.State);
        Assert.False(projection.ShowPrimary);
    }

    [Fact]
    public void Projection_throws_for_null_props() =>
        Assert.Throws<ArgumentNullException>(() => HistoryListRowProjection.Project(null!));

    // ── accessibility: the activatable row exposes its caller-composed name ────────────────────────────────

    [Fact]
    public void Accessible_name_is_exposed_for_an_interactive_row()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(
            HasPrimary: true,
            Href: "/drives/1",
            AccessibleName: "Drive on Jan 1, 12.4 mi"));

        Assert.True(projection.IsInteractive);
        Assert.Equal("Drive on Jan 1, 12.4 mi", projection.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_empty_when_unset()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true));

        Assert.Equal(string.Empty, projection.AccessibleName);
    }

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Fact]
    public void Projection_snapshot_ready_full_navigable_row()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(
            HasPrimary: true,
            HasCheckbox: true,
            HasLeading: true,
            HasRoute: true,
            HasMetrics: true,
            HasInsight: true,
            ActionCount: 3,
            Href: "/drives/9",
            Selected: true,
            Glow: HistoryListRowGlow.Cyan,
            TestId: "drive-9"));

        Assert.Equal(HistoryListRowState.Ready, projection.State);
        Assert.True(projection.ShowPrimary);
        Assert.True(projection.ShowCheckbox);
        Assert.True(projection.ShowLeading);
        Assert.True(projection.ShowRoute);
        Assert.True(projection.ShowMetrics);
        Assert.True(projection.ShowInsight);
        Assert.True(projection.ShowActions);
        Assert.True(projection.ShowChevron);
        Assert.True(projection.IsSelected);
        Assert.Equal(HistoryListRowActivation.Navigate, projection.Activation);
        Assert.Equal("TsChartSpeedBrush", projection.GlowBrushKey);
        Assert.Equal("drive-9", projection.AutomationId);
        Assert.Equal("drive-9-panel", projection.PanelAutomationId);
    }

    [Fact]
    public void Projection_snapshot_minimal_inert_row()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, HideChevron: true));

        Assert.Equal(HistoryListRowState.Ready, projection.State);
        Assert.True(projection.ShowPrimary);
        Assert.False(projection.ShowCheckbox);
        Assert.False(projection.ShowLeading);
        Assert.False(projection.ShowRoute);
        Assert.False(projection.ShowMetrics);
        Assert.False(projection.ShowInsight);
        Assert.False(projection.ShowActions);
        Assert.False(projection.ShowChevron);
        Assert.False(projection.IsInteractive);
        Assert.Equal(HistoryListRowActivation.None, projection.Activation);
    }

    [Fact]
    public void Projection_snapshot_empty_row()
    {
        var projection = HistoryListRowProjection.Project(new HistoryListRowProps());

        Assert.Equal(HistoryListRowState.Empty, projection.State);
        Assert.False(projection.ShowPrimary);
        Assert.True(projection.ShowChevron);
        Assert.False(projection.IsInteractive);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Glow: HistoryListRowGlow.Green, Selected: true));
        var b = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Glow: HistoryListRowGlow.Green, Selected: true));
        var different = HistoryListRowProjection.Project(new HistoryListRowProps(HasPrimary: true, Glow: HistoryListRowGlow.Cyan, Selected: true));

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("HistoryListRow", HistoryListRowViewModel.Slug);

    [Fact]
    public void ViewModel_projects_its_initial_props()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true, Glow: HistoryListRowGlow.Purple));

        Assert.Equal(HistoryListRowGlow.Purple, viewModel.Projection.Glow);
        Assert.True(viewModel.Projection.ShowPrimary);
        Assert.Equal(HistoryListRowActivation.None, viewModel.Activation);
        Assert.False(viewModel.IsInteractive);
    }

    [Fact]
    public void ViewModel_default_ctor_is_an_empty_inert_row()
    {
        var viewModel = new HistoryListRowViewModel();

        Assert.Equal(HistoryListRowState.Empty, viewModel.Projection.State);
        Assert.Equal(HistoryListRowGlow.Cyan, viewModel.Projection.Glow);
        Assert.False(viewModel.IsInteractive);
    }

    [Fact]
    public void ViewModel_update_props_reprojects_and_raises()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.UpdateProps(new HistoryListRowProps(HasPrimary: true, Selected: true, ActionCount: 2));

        Assert.True(viewModel.Projection.IsSelected);
        Assert.True(viewModel.Projection.ShowActions);
        Assert.Contains(nameof(HistoryListRowViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_update_props_is_a_no_op_for_an_equivalent_configuration()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true, Selected: true));
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.UpdateProps(new HistoryListRowProps(HasPrimary: true, Selected: true));

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_selected_toggles_the_tint()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true));

        viewModel.SetSelected(true);

        Assert.True(viewModel.Projection.IsSelected);
    }

    [Fact]
    public void ViewModel_set_glow_changes_the_accent()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true));

        viewModel.SetGlow(HistoryListRowGlow.Purple);

        Assert.Equal(HistoryListRowGlow.Purple, viewModel.Projection.Glow);
        Assert.Equal("TsChartPowerBrush", viewModel.Projection.GlowBrushKey);
    }

    [Fact]
    public void ViewModel_set_href_makes_the_row_navigable()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true));

        viewModel.SetHref("/charging/7");

        Assert.Equal(HistoryListRowActivation.Navigate, viewModel.Activation);
        Assert.Equal("/charging/7", viewModel.Projection.Href);
    }

    [Fact]
    public void ViewModel_throws_when_props_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => new HistoryListRowViewModel((HistoryListRowProps)null!));
        Assert.Throws<ArgumentNullException>(() => new HistoryListRowViewModel(new HistoryListRowProps()).UpdateProps(null!));
    }

    // ── navigation seam (web react-router Link) ───────────────────────────────────────────────────────────

    [Fact]
    public void Activate_navigates_a_navigable_row_through_the_seam()
    {
        var navigator = new RecordingNavigator();
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true, Href: "/drives/123"), navigator);

        HistoryListRowActivation kind = viewModel.Activate();

        Assert.Equal(HistoryListRowActivation.Navigate, kind);
        Assert.Equal("/drives/123", Assert.Single(navigator.Navigations));
    }

    [Fact]
    public void Activate_does_not_navigate_an_invoke_only_row()
    {
        var navigator = new RecordingNavigator();
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true, HasClickHandler: true), navigator);

        HistoryListRowActivation kind = viewModel.Activate();

        Assert.Equal(HistoryListRowActivation.Invoke, kind);
        Assert.Empty(navigator.Navigations);
    }

    [Fact]
    public void Activate_is_inert_for_a_non_interactive_row()
    {
        var navigator = new RecordingNavigator();
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true), navigator);

        Assert.Equal(HistoryListRowActivation.None, viewModel.Activate());
        Assert.Empty(navigator.Navigations);
    }

    [Fact]
    public void Activate_is_safe_without_a_navigator()
    {
        var viewModel = new HistoryListRowViewModel(new HistoryListRowProps(HasPrimary: true, Href: "/x"), navigator: null);

        Assert.Equal(HistoryListRowActivation.Navigate, viewModel.Activate());
    }

    // ── diagnostics (view.opened + activation, PII-safe — only the slug) ──────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HistoryListRowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HistoryListRow", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_record_emits_activation_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HistoryListRowDiagnostics(lines.Add);

        diagnostics.RecordActivated();

        Assert.Equal(1, diagnostics.Activations);
        Assert.Equal("history-list-row.activated slug=HistoryListRow", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_events()
    {
        var diagnostics = new HistoryListRowDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordActivated();
        diagnostics.RecordActivated();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(2, diagnostics.Activations);
    }

    [Fact]
    public void Diagnostics_never_leak_a_route_or_user_data()
    {
        var lines = new List<string>();
        var diagnostics = new HistoryListRowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordActivated();

        // Every diagnostic line is the slug-only operational form — never an href / path.
        Assert.All(lines, line =>
        {
            Assert.EndsWith(HistoryListRowRegistration.Slug, line, StringComparison.Ordinal);
            Assert.DoesNotContain("/", line, StringComparison.Ordinal);
        });
    }

    private sealed class RecordingNavigator : IHistoryListRowNavigator
    {
        private readonly List<string> _navigations = new();

        public IReadOnlyList<string> Navigations => _navigations;

        public void Navigate(string href) => _navigations.Add(href);
    }
}
