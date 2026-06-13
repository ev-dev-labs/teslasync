using System.Collections.Generic;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ActiveVehicleSegment shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, the Segoe Fluent glyphs, the five i18n keys the source references with their
/// verbatim fallbacks), the pure <see cref="ActiveVehicleSegmentProjection"/> (the hidden / single / switcher
/// vehicle-count branches, the selected-or-first label rule, the live battery / range metrics with SI → unit
/// conversion + rounding, the tooltip / aria composition, the icon-only mode and the projected popover rows), the
/// <see cref="InMemoryActiveVehicleUnitsSource"/> / <see cref="InMemoryActiveVehicleStateSource"/> seams, the
/// <see cref="ActiveVehicleSegmentViewModel"/> state holder (reprojection + commit + dispose) and the PII-safe
/// diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx). The WinUI view itself
/// (shared-surfaces/ActiveVehicleSegment/ActiveVehicleSegment.cs) is exercised by the app build.
/// </summary>
public sealed class ActiveVehicleSegmentTests
{
    private static readonly IReadOnlyList<VehicleOption> Fleet =
    [
        new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3"),
        new(2, null, "7SAYGDEE9PF000222", "Model Y"),
        new(3, null, null, null),
    ];

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static ActiveVehicleSegmentProjection Project(
        IReadOnlyList<VehicleOption>? vehicles = null,
        long? selectedId = null,
        ActiveVehicleLiveState? liveState = null,
        UnitPref? unitPref = null,
        bool iconOnly = false,
        ILocalizer? localizer = null) =>
        ActiveVehicleSegmentProjection.Project(
            vehicles ?? Fleet,
            selectedId,
            liveState,
            unitPref ?? UnitPref.Metric,
            iconOnly,
            localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ActiveVehicleSegment", ActiveVehicleSegmentRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("active-vehicle-segment", ActiveVehicleSegmentRegistration.RootAutomationId);

    [Fact]
    public void Glyphs_map_to_the_fluent_stand_ins_for_the_web_lucide_icons()
    {
        Assert.Equal("\uE804", ActiveVehicleSegmentRegistration.CarGlyph);
        Assert.Equal("\uE70E", ActiveVehicleSegmentRegistration.ChevronUpGlyph);
        Assert.Equal("\uE73E", ActiveVehicleSegmentRegistration.CheckGlyph);
    }

    [Fact]
    public void Middle_dot_is_the_web_separator() =>
        Assert.Equal("\u00B7", ActiveVehicleSegmentRegistration.MiddleDot);

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.statusBar.vehicle.fallback", ActiveVehicleSegmentRegistration.FallbackKey);
        Assert.Equal("Vehicle", ActiveVehicleSegmentRegistration.FallbackFallback);
        Assert.Equal("translation.statusBar.vehicle.none", ActiveVehicleSegmentRegistration.NoneKey);
        Assert.Equal("No vehicle", ActiveVehicleSegmentRegistration.NoneFallback);
        Assert.Equal("translation.statusBar.vehicle.tooltip", ActiveVehicleSegmentRegistration.TooltipKey);
        Assert.Equal("Active vehicle", ActiveVehicleSegmentRegistration.TooltipFallback);
        Assert.Equal("translation.statusBar.vehicle.aria", ActiveVehicleSegmentRegistration.AriaKey);
        Assert.Equal("Active vehicle", ActiveVehicleSegmentRegistration.AriaFallback);
        Assert.Equal("translation.statusBar.vehicle.switch", ActiveVehicleSegmentRegistration.SwitchKey);
        Assert.Equal("Switch vehicle", ActiveVehicleSegmentRegistration.SwitchFallback);
    }

    [Fact]
    public void Every_i18n_key_resolves_through_the_facade()
    {
        var recording = new RecordingLocalizer();
        _ = Project(localizer: recording);

        Assert.Contains("translation.statusBar.vehicle.fallback", recording.RequestedKeys);
        Assert.Contains("translation.statusBar.vehicle.aria", recording.RequestedKeys);
        Assert.Contains("translation.statusBar.vehicle.tooltip", recording.RequestedKeys);
        Assert.Contains("translation.statusBar.vehicle.switch", recording.RequestedKeys);
    }

    // ── status: the three vehicle-count branches (web vehicles.length) ───────────────────────────────────

    [Fact]
    public void Empty_fleet_is_hidden_like_the_web_return_null()
    {
        var projection = Project([]);

        Assert.Equal(ActiveVehicleSegmentStatus.Hidden, projection.Status);
        Assert.False(projection.IsVisible);
        Assert.False(projection.IsInteractive);
        Assert.Null(projection.SelectedId);
        Assert.Empty(projection.Options);
    }

    [Fact]
    public void Null_fleet_is_hidden()
    {
        var projection = ActiveVehicleSegmentProjection.Project(
            vehicles: null,
            selectedId: null,
            liveState: null,
            unitPref: UnitPref.Metric,
            iconOnly: false,
            localizer: Localizer);

        Assert.Equal(ActiveVehicleSegmentStatus.Hidden, projection.Status);
        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Single_vehicle_is_a_static_non_interactive_chip()
    {
        var projection = Project([new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3")]);

        Assert.Equal(ActiveVehicleSegmentStatus.Solo, projection.Status);
        Assert.True(projection.IsVisible);
        Assert.False(projection.IsInteractive);
        Assert.Equal("Red Three", projection.Label);
        Assert.Equal(1, projection.SelectedId);
    }

    [Fact]
    public void Multi_vehicle_is_the_interactive_switcher()
    {
        var projection = Project();

        Assert.Equal(ActiveVehicleSegmentStatus.Switcher, projection.Status);
        Assert.True(projection.IsVisible);
        Assert.True(projection.IsInteractive);
        Assert.Equal(3, projection.Options.Count);
    }

    // ── label: the selected-or-first display-name → VIN → "Vehicle {id}" rule (web label) ────────────────

    [Fact]
    public void Label_defaults_to_the_first_vehicle_when_nothing_is_selected()
    {
        // web useSelectedVehicle precedence: effectiveId = urlId ?? stored ?? firstVehicleId.
        var projection = Project(selectedId: null);

        Assert.Equal("Red Three", projection.Label);
        Assert.Equal(1, projection.SelectedId);
        Assert.True(projection.Options[0].Selected);
        Assert.False(projection.Options[1].Selected);
    }

    [Fact]
    public void Label_falls_back_to_vin_then_to_vehicle_id()
    {
        Assert.Equal("7SAYGDEE9PF000222", Project(selectedId: 2).Label); // display name absent → VIN
        Assert.Equal("Vehicle 3", Project(selectedId: 3).Label);         // display name + VIN absent → "Vehicle {id}"
    }

    [Fact]
    public void Selecting_a_vehicle_marks_only_that_row_and_drives_the_label()
    {
        var projection = Project(selectedId: 2);

        Assert.Equal(2, projection.SelectedId);
        Assert.False(projection.Options[0].Selected);
        Assert.True(projection.Options[1].Selected);
        Assert.False(projection.Options[2].Selected);
    }

    [Fact]
    public void Options_carry_the_label_rule_and_model()
    {
        IReadOnlyList<ActiveVehicleSegmentOption> options = Project().Options;

        Assert.Equal("Red Three", options[0].Name);
        Assert.Equal("Model 3", options[0].Model);
        Assert.Equal("7SAYGDEE9PF000222", options[1].Name);
        Assert.Equal("Vehicle 3", options[2].Name);
        Assert.Null(options[2].Model);
    }

    // ── metrics: live battery / range with SI → unit conversion + rounding (web metricsLabel) ────────────

    [Fact]
    public void No_live_state_shows_no_metrics()
    {
        var projection = Project(liveState: null);

        Assert.False(projection.HasMetrics);
        Assert.Equal(string.Empty, projection.MetricsText);
        Assert.False(projection.ShowMetrics);
    }

    [Fact]
    public void Metrics_compose_battery_and_imperial_range()
    {
        // 160934.4 m == 100 mi exactly (1609.344 m/mi).
        var projection = Project(
            liveState: new ActiveVehicleLiveState(80, 160934.4),
            unitPref: UnitPref.Imperial);

        Assert.True(projection.HasMetrics);
        Assert.Equal("80% \u00B7 100 mi", projection.MetricsText);
        Assert.True(projection.ShowMetrics);
    }

    [Fact]
    public void Metrics_convert_range_to_metric_kilometres()
    {
        // 160934.4 m == 160.9344 km → rounded 161.
        var projection = Project(
            liveState: new ActiveVehicleLiveState(80, 160934.4),
            unitPref: UnitPref.Metric);

        Assert.Equal("80% \u00B7 161 km", projection.MetricsText);
    }

    [Fact]
    public void Metrics_round_to_the_nearest_unit_half_up_like_js_math_round()
    {
        // 12500 m == 12.5 km → JS Math.round(12.5) == 13.
        Assert.Equal(
            "50% \u00B7 13 km",
            Project(liveState: new ActiveVehicleLiveState(50, 12500), unitPref: UnitPref.Metric).MetricsText);

        // 12400 m == 12.4 km → 12.
        Assert.Equal(
            "50% \u00B7 12 km",
            Project(liveState: new ActiveVehicleLiveState(50, 12400), unitPref: UnitPref.Metric).MetricsText);
    }

    [Fact]
    public void Null_battery_and_range_fall_back_to_zero_but_still_show_metrics()
    {
        // web: liveState present → metrics shown with `battery_level ?? 0` / `rated_range ?? 0`.
        var projection = Project(liveState: new ActiveVehicleLiveState(null, null), unitPref: UnitPref.Metric);

        Assert.True(projection.HasMetrics);
        Assert.Equal("0% \u00B7 0 km", projection.MetricsText);
    }

    // ── tooltip + accessible name (web Tooltip content + aria-label) ─────────────────────────────────────

    [Fact]
    public void Tooltip_composes_prefix_label_sublabel_and_metrics()
    {
        var projection = Project(
            vehicles: [new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3")],
            liveState: new ActiveVehicleLiveState(80, 160934.4),
            unitPref: UnitPref.Imperial);

        Assert.Equal("Active vehicle \u00B7 Red Three \u00B7 Model 3 \u00B7 80% \u00B7 100 mi", projection.TooltipText);
    }

    [Fact]
    public void Tooltip_omits_sublabel_and_metrics_when_absent()
    {
        var projection = Project(selectedId: 3, liveState: null);

        // Vehicle 3 has no model (no sub-label) and there is no live state (no metrics).
        Assert.Equal("Active vehicle \u00B7 Vehicle 3", projection.TooltipText);
    }

    [Fact]
    public void Chip_accessible_name_uses_the_aria_prefix()
    {
        var projection = Project([new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3")]);

        Assert.Equal("Active vehicle: Red Three", projection.AutomationName);
    }

    [Fact]
    public void Switcher_accessible_name_uses_the_switch_prefix()
    {
        var projection = Project(selectedId: 1);

        Assert.Equal("Switch vehicle (Red Three)", projection.AutomationName);
    }

    [Fact]
    public void Popover_accessible_name_is_the_aria_label()
    {
        Assert.Equal("Active vehicle", Project().ListAccessibleName);
        Assert.Equal("Active vehicle", Project([]).ListAccessibleName);
    }

    // ── icon-only mode (web iconOnly prop) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Icon_only_hides_label_metrics_and_chevron_but_keeps_the_composed_text()
    {
        var projection = Project(
            liveState: new ActiveVehicleLiveState(80, 160934.4),
            unitPref: UnitPref.Imperial,
            iconOnly: true);

        Assert.True(projection.IconOnly);
        Assert.False(projection.ShowLabel);
        Assert.False(projection.ShowMetrics);
        Assert.False(projection.ShowChevron);

        // The label / metrics are still derived (the tooltip + aria still carry them).
        Assert.Equal("Red Three", projection.Label);
        Assert.True(projection.HasMetrics);
    }

    [Fact]
    public void Non_icon_only_switcher_shows_label_metrics_and_chevron()
    {
        var projection = Project(liveState: new ActiveVehicleLiveState(80, 160934.4));

        Assert.True(projection.ShowLabel);
        Assert.True(projection.ShowMetrics);
        Assert.True(projection.ShowChevron);
    }

    [Fact]
    public void Single_chip_never_shows_a_chevron()
    {
        var projection = Project([new(1, "Red Three", null, null)]);

        Assert.False(projection.ShowChevron);
    }

    // ── sources: the units + live-state seams ────────────────────────────────────────────────────────────

    [Fact]
    public void Units_source_defaults_to_metric()
    {
        var source = new InMemoryActiveVehicleUnitsSource();

        Assert.Equal(UnitPref.Metric, source.Preferences);
    }

    [Fact]
    public void Units_source_raises_changed_on_a_new_preference_only()
    {
        var source = new InMemoryActiveVehicleUnitsSource(UnitPref.Metric);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetPreferences(UnitPref.Imperial);
        source.SetPreferences(UnitPref.Imperial); // unchanged → no-op

        Assert.Equal(1, raised);
        Assert.Equal(UnitPref.Imperial, source.Preferences);
    }

    [Fact]
    public void Live_state_source_defaults_to_none()
    {
        var source = new InMemoryActiveVehicleStateSource();

        Assert.Null(source.Current);
    }

    [Fact]
    public void Live_state_source_raises_changed_on_a_new_snapshot_only()
    {
        var source = new InMemoryActiveVehicleStateSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        var snapshot = new ActiveVehicleLiveState(80, 160934.4);
        source.Set(snapshot);
        source.Set(new ActiveVehicleLiveState(80, 160934.4)); // value-equal → no-op

        Assert.Equal(1, raised);
        Assert.Equal(snapshot, source.Current);
    }

    // ── view-model: reprojection + commit + dispose ──────────────────────────────────────────────────────

    private static ActiveVehicleSegmentViewModel NewViewModel(
        out VehicleSelectState state,
        out InMemoryActiveVehicleUnitsSource units,
        out InMemoryActiveVehicleStateSource liveState,
        IReadOnlyList<VehicleOption>? fleet = null,
        UnitPref? unitPref = null)
    {
        state = new VehicleSelectState();
        state.SetLoaded(fleet ?? Fleet);
        units = new InMemoryActiveVehicleUnitsSource(unitPref ?? UnitPref.Imperial);
        liveState = new InMemoryActiveVehicleStateSource();
        return new ActiveVehicleSegmentViewModel(state, units, liveState, PassthroughLocalizer.Instance);
    }

    [Fact]
    public void ViewModel_projects_the_bound_state()
    {
        using var vm = NewViewModel(out _, out _, out _);

        Assert.Equal(ActiveVehicleSegmentStatus.Switcher, vm.Status);
        Assert.True(vm.IsVisible);
        Assert.True(vm.IsInteractive);
        Assert.Equal(1, vm.SelectedId); // defaults to first vehicle
    }

    [Fact]
    public void ViewModel_reprojects_when_the_units_change()
    {
        using var vm = NewViewModel(out _, out var units, out var live);
        live.Set(new ActiveVehicleLiveState(80, 160934.4));

        Assert.Equal("80% \u00B7 100 mi", vm.Projection.MetricsText);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        units.SetPreferences(UnitPref.Metric);

        Assert.True(raised > 0);
        Assert.Equal("80% \u00B7 161 km", vm.Projection.MetricsText);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_live_state_changes()
    {
        using var vm = NewViewModel(out _, out _, out var live);
        Assert.False(vm.Projection.HasMetrics);

        live.Set(new ActiveVehicleLiveState(42, 160934.4));

        Assert.True(vm.Projection.HasMetrics);
        Assert.Equal("42% \u00B7 100 mi", vm.Projection.MetricsText);
    }

    [Fact]
    public void ViewModel_pick_commits_the_scope_to_the_shared_holder()
    {
        using var vm = NewViewModel(out var state, out _, out _);

        Assert.True(vm.Pick(2));

        Assert.Equal(2, state.SelectedId);
        Assert.Equal(2, vm.SelectedId);
        Assert.True(vm.Projection.Options[1].Selected);
    }

    [Fact]
    public void ViewModel_pick_returns_false_when_the_scope_is_unchanged()
    {
        using var vm = NewViewModel(out _, out _, out _);

        Assert.True(vm.Pick(2));
        Assert.False(vm.Pick(2)); // already selected
    }

    [Fact]
    public void ViewModel_stops_reprojecting_after_dispose()
    {
        var vm = NewViewModel(out _, out _, out var live);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        live.Set(new ActiveVehicleLiveState(80, 160934.4));

        Assert.Equal(0, raised);
    }

    [Fact]
    public void ViewModel_single_vehicle_auto_selects_and_collapses_to_a_chip()
    {
        using var vm = NewViewModel(out _, out _, out _, fleet: [new(7, "Solo", null, null)]);

        Assert.Equal(ActiveVehicleSegmentStatus.Solo, vm.Status);
        Assert.Equal(7, vm.SelectedId);
        Assert.Equal("Active vehicle: Solo", vm.Projection.AutomationName);
    }

    // ── diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_the_view_opened_signal()
    {
        var lines = new List<string>();
        var diagnostics = new ActiveVehicleSegmentDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(["view.opened slug=ActiveVehicleSegment"], lines);
    }
}
