using System.Collections.Generic;
using TeslaSync.App.Core.Status;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the HealthRow shared surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the spaced em-dash accessible-name separator, the chevron glyph), the pure interaction
/// classifier (the web link / button / div branch order, with the link winning over a handler), the
/// <see cref="HealthRowProjection"/> (every status tint passthrough, the icon-present / icon-absent gate, the
/// four interaction modes, the link target / external flag and the composed accessible name), the
/// <see cref="HealthRowViewModel"/> state holder (initial projection, reprojection + change notification,
/// the no-op when the projection is unchanged, and activation routing through the navigation seam / click
/// handler) and the PII-safe diagnostics. Mirrors the web spec (web/src/components/status/HealthRow.tsx). The
/// WinUI view itself (shared-surfaces/HealthRow.cs, composing the atomic TsHealthRow) is exercised by the app
/// build.
/// </summary>
public sealed class HealthRowTests
{
    private static HealthRowProjection Project(HealthRowModel model) => HealthRowProjection.Project(model);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("HealthRow", HealthRowRegistration.Slug);

    [Fact]
    public void Registration_automation_id_is_stable() =>
        Assert.Equal("health-row", HealthRowRegistration.AutomationId);

    [Fact]
    public void Chevron_glyph_matches_the_shared_fluent_stand_in() =>
        Assert.Equal("\uE76C", HealthRowRegistration.ChevronGlyph);

    [Fact]
    public void Accessible_name_separator_is_a_spaced_em_dash() =>
        Assert.Equal(" \u2014 ", HealthRowRegistration.AccessibleNameSeparator);

    [Fact]
    public void ComposeAccessibleName_joins_label_and_summary_with_the_em_dash() =>
        Assert.Equal("Database \u2014 12 / 12 healthy", HealthRowRegistration.ComposeAccessibleName("Database", "12 / 12 healthy"));

    // ── interaction classifier (web HealthRow.tsx L78-107 branch order) ──────────────────────────────────────

    [Theory]
    [InlineData(null, false, false, HealthRowInteraction.None)]
    [InlineData("", false, false, HealthRowInteraction.None)]
    [InlineData(null, false, true, HealthRowInteraction.Command)]
    [InlineData("", true, true, HealthRowInteraction.Command)]
    [InlineData("/system", false, false, HealthRowInteraction.InternalLink)]
    [InlineData("/system", true, false, HealthRowInteraction.ExternalLink)]
    public void ClassifyInteraction_resolves_each_branch(string? to, bool external, bool interactive, HealthRowInteraction expected) =>
        Assert.Equal(expected, HealthRowRegistration.ClassifyInteraction(to, external, interactive));

    [Fact]
    public void ClassifyInteraction_lets_a_link_win_over_a_handler()
    {
        // web: the `if (to)` branch returns before the `if (onClick)` branch is reached.
        Assert.Equal(HealthRowInteraction.InternalLink, HealthRowRegistration.ClassifyInteraction("/system", false, true));
        Assert.Equal(HealthRowInteraction.ExternalLink, HealthRowRegistration.ClassifyInteraction("https://status.example", true, true));
    }

    // ── projection: status tint passthrough ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(HealthStatus.Healthy)]
    [InlineData(HealthStatus.Degraded)]
    [InlineData(HealthStatus.Unhealthy)]
    [InlineData(HealthStatus.Unknown)]
    [InlineData(HealthStatus.Maintenance)]
    public void Project_passes_each_status_through_for_the_dot_and_summary_tint(HealthStatus status)
    {
        var p = Project(HealthRowModel.Static(status, "Worker", "idle"));
        Assert.Equal(status, p.Status);
    }

    // ── projection: icon gate (web `icon && …`) ──────────────────────────────────────────────────────────

    [Fact]
    public void Project_shows_the_icon_only_when_a_glyph_is_supplied()
    {
        var withIcon = Project(HealthRowModel.Static(HealthStatus.Healthy, "MQTT", "connected", glyph: "\uE701"));
        Assert.True(withIcon.ShowIcon);
        Assert.Equal("\uE701", withIcon.Glyph);

        var withoutIcon = Project(HealthRowModel.Static(HealthStatus.Healthy, "MQTT", "connected"));
        Assert.False(withoutIcon.ShowIcon);
        Assert.Equal(string.Empty, withoutIcon.Glyph);
    }

    // ── projection: the four interaction modes (web L78-107) ────────────────────────────────────────────

    [Fact]
    public void Project_static_row_is_non_interactive()
    {
        var p = Project(HealthRowModel.Static(HealthStatus.Unknown, "Cache", "0 vehicles \u00b7 idle"));
        Assert.Equal(HealthRowInteraction.None, p.Interaction);
        Assert.False(p.Actionable);
        Assert.Null(p.Target);
        Assert.False(p.External);
    }

    [Fact]
    public void Project_internal_link_carries_its_in_app_target()
    {
        var p = Project(HealthRowModel.Link(HealthStatus.Healthy, "Drives", "all healthy", "/drives"));
        Assert.Equal(HealthRowInteraction.InternalLink, p.Interaction);
        Assert.True(p.Actionable);
        Assert.Equal("/drives", p.Target);
        Assert.False(p.External);
    }

    [Fact]
    public void Project_external_link_is_flagged_external()
    {
        var p = Project(HealthRowModel.Link(HealthStatus.Degraded, "Grafana", "2 alerts", "https://grafana.example", external: true));
        Assert.Equal(HealthRowInteraction.ExternalLink, p.Interaction);
        Assert.True(p.Actionable);
        Assert.Equal("https://grafana.example", p.Target);
        Assert.True(p.External);
    }

    [Fact]
    public void Project_command_row_is_actionable_with_no_target()
    {
        var p = Project(HealthRowModel.Clickable(HealthStatus.Maintenance, "Run health check", "ready"));
        Assert.Equal(HealthRowInteraction.Command, p.Interaction);
        Assert.True(p.Actionable);
        Assert.Null(p.Target);
        Assert.False(p.External);
    }

    [Fact]
    public void Project_empty_link_falls_through_to_the_handler_branch()
    {
        // web: `if (to)` is false for an empty string, so an attached handler still makes it a button.
        var model = new HealthRowModel { Status = HealthStatus.Healthy, Label = "L", Summary = "S", To = string.Empty, Interactive = true };
        var p = Project(model);
        Assert.Equal(HealthRowInteraction.Command, p.Interaction);
        Assert.Null(p.Target);
    }

    [Fact]
    public void Project_composes_the_accessible_name_from_label_and_summary()
    {
        var p = Project(HealthRowModel.Link(HealthStatus.Healthy, "Database", "12 / 12 healthy", "/system/db"));
        Assert.Equal("Database \u2014 12 / 12 healthy", p.AccessibleName);
    }

    // ── view-model: initial state ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_slug_matches_the_surface() =>
        Assert.Equal("HealthRow", HealthRowViewModel.Slug);

    [Fact]
    public void ViewModel_projects_the_initial_model()
    {
        var model = HealthRowModel.Link(HealthStatus.Healthy, "API", "operational", "/system/api");
        var vm = new HealthRowViewModel(model);
        Assert.Equal(HealthRowProjection.Project(model), vm.Projection);
        Assert.Same(model, vm.Model);
    }

    // ── view-model: reprojection + change notification ───────────────────────────────────────────────────

    [Fact]
    public void SetModel_reprojects_and_raises_change_when_the_projection_moves()
    {
        var vm = new HealthRowViewModel(HealthRowModel.Static(HealthStatus.Healthy, "API", "operational"));
        var raised = 0;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(HealthRowViewModel.Projection))
            {
                raised++;
            }
        };

        vm.SetModel(HealthRowModel.Static(HealthStatus.Unhealthy, "API", "down"));

        Assert.Equal(1, raised);
        Assert.Equal(HealthStatus.Unhealthy, vm.Projection.Status);
        Assert.Equal("down", vm.Projection.Summary);
    }

    [Fact]
    public void SetModel_is_a_no_op_when_the_projection_is_unchanged()
    {
        // External is ignored by the projection when there is no link, so these two models project identically.
        var first = new HealthRowModel { Status = HealthStatus.Healthy, Label = "API", Summary = "ok", External = false };
        var vm = new HealthRowViewModel(first);
        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.SetModel(new HealthRowModel { Status = HealthStatus.Healthy, Label = "API", Summary = "ok", External = true });

        Assert.Equal(0, raised);
        Assert.Equal(HealthRowInteraction.None, vm.Projection.Interaction);
    }

    // ── view-model: activation routing (web link click / button onClick) ────────────────────────────────

    [Fact]
    public void Activate_internal_link_routes_the_target_in_app()
    {
        var navigator = new RecordingNavigator();
        var vm = new HealthRowViewModel(HealthRowModel.Link(HealthStatus.Healthy, "Drives", "ok", "/drives"), navigator);

        vm.Activate();

        var call = Assert.Single(navigator.Calls);
        Assert.Equal("/drives", call.Target);
        Assert.False(call.External);
    }

    [Fact]
    public void Activate_external_link_routes_with_the_external_flag()
    {
        var navigator = new RecordingNavigator();
        var vm = new HealthRowViewModel(
            HealthRowModel.Link(HealthStatus.Degraded, "Grafana", "2 alerts", "https://grafana.example", external: true),
            navigator);

        vm.Activate();

        var call = Assert.Single(navigator.Calls);
        Assert.Equal("https://grafana.example", call.Target);
        Assert.True(call.External);
    }

    [Fact]
    public void Activate_command_invokes_the_handler_and_does_not_navigate()
    {
        var navigator = new RecordingNavigator();
        var invoked = 0;
        var vm = new HealthRowViewModel(
            HealthRowModel.Clickable(HealthStatus.Maintenance, "Run health check", "ready"),
            navigator,
            onActivated: () => invoked++);

        vm.Activate();

        Assert.Equal(1, invoked);
        Assert.Empty(navigator.Calls);
    }

    [Fact]
    public void Activate_static_row_does_nothing()
    {
        var navigator = new RecordingNavigator();
        var invoked = 0;
        var vm = new HealthRowViewModel(
            HealthRowModel.Static(HealthStatus.Unknown, "Cache", "idle"),
            navigator,
            onActivated: () => invoked++);

        vm.Activate();

        Assert.Equal(0, invoked);
        Assert.Empty(navigator.Calls);
    }

    [Fact]
    public void NullNavigator_activation_is_a_safe_no_op()
    {
        var vm = new HealthRowViewModel(HealthRowModel.Link(HealthStatus.Healthy, "API", "ok", "/system/api"));

        // No navigator supplied falls back to the inert seam; activation must not throw.
        var exception = Record.Exception(vm.Activate);
        Assert.Null(exception);
    }

    // ── diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new HealthRowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=HealthRow", "view.opened slug=HealthRow" }, lines);
    }

    private sealed class RecordingNavigator : IHealthRowNavigator
    {
        public List<(string Target, bool External)> Calls { get; } = [];

        public void Navigate(string target, bool external) => Calls.Add((target, external));
    }
}
