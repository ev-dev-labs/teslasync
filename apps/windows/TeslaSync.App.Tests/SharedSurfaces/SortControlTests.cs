using System.Collections.Generic;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>SortControl</c> shared surface's UI-thread-free logic — the pure projection
/// (the two direction branches, the arrow glyph + localized label, the field-label resolution, the selected
/// option lookup and the empty option set), the data seam's change + field/direction notifications, the
/// view-model's state projection, the PII-safe diagnostics and the registration metadata. The cases mirror the
/// web spec (web/src/components/forms/SortControl.tsx) one-for-one. The WinUI view itself (the TsSelect +
/// TsButton composition) is exercised by the app build.
/// </summary>
public sealed class SortControlTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static IReadOnlyList<SortControlOption> Options =>
    [
        new("date", "Date"),
        new("distance", "Distance"),
        new("score", "Score"),
    ];

    private static SortControlDisplay Project(
        SortDirection direction = SortDirection.Ascending,
        string field = "date",
        string? ariaLabel = null,
        IReadOnlyList<SortControlOption>? options = null) =>
        SortControlProjection.Project(options ?? Options, field, direction, ariaLabel, Localizer);

    // ── Projection: direction branch (web L52-L86) ───────────────────────────────────────────────────────

    [Fact]
    public void Ascending_uses_the_up_chevron_and_ascending_label()
    {
        var display = Project(SortDirection.Ascending);
        Assert.True(display.IsAscending);
        Assert.Equal(SortDirection.Ascending, display.Direction);
        Assert.Equal(SortControlDisplay.AscendingGlyph, display.DirectionGlyph);
        Assert.Equal("Ascending", display.DirectionLabel);
    }

    [Fact]
    public void Descending_uses_the_down_chevron_and_descending_label()
    {
        var display = Project(SortDirection.Descending);
        Assert.False(display.IsAscending);
        Assert.Equal(SortDirection.Descending, display.Direction);
        Assert.Equal(SortControlDisplay.DescendingGlyph, display.DirectionGlyph);
        Assert.Equal("Descending", display.DirectionLabel);
    }

    [Fact]
    public void None_direction_normalizes_to_ascending()
    {
        var display = Project(SortDirection.None);
        Assert.True(display.IsAscending);
        Assert.Equal(SortDirection.Ascending, display.Direction);
        Assert.Equal(SortControlDisplay.AscendingGlyph, display.DirectionGlyph);
    }

    // ── Projection: accessible name (web L73) ────────────────────────────────────────────────────────────

    [Fact]
    public void Direction_accessible_name_defaults_to_the_prefix_and_label()
    {
        Assert.Equal("Sort direction: Ascending", Project(SortDirection.Ascending).DirectionAccessibleName);
        Assert.Equal("Sort direction: Descending", Project(SortDirection.Descending).DirectionAccessibleName);
    }

    [Fact]
    public void Explicit_direction_label_overrides_the_accessible_name()
    {
        var display = Project(SortDirection.Ascending, ariaLabel: "Toggle order");
        Assert.Equal("Toggle order", display.DirectionAccessibleName);
    }

    [Fact]
    public void Field_label_is_localized()
    {
        Assert.Equal("Sort by", Project().FieldLabel);
    }

    // ── Projection: selection + options ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Selected_label_resolves_from_the_options()
    {
        var display = Project(field: "distance");
        Assert.True(display.HasSelection);
        Assert.Equal("distance", display.SelectedValue);
        Assert.Equal("Distance", display.SelectedLabel);
    }

    [Fact]
    public void Unknown_field_has_no_selection()
    {
        var display = Project(field: "nope");
        Assert.False(display.HasSelection);
        Assert.Equal("nope", display.SelectedValue);
        Assert.Equal(string.Empty, display.SelectedLabel);
    }

    [Fact]
    public void Empty_options_render_the_empty_state()
    {
        var display = Project(options: []);
        Assert.True(display.IsEmpty);
        Assert.Empty(display.Options);
        Assert.False(display.HasSelection);
    }

    [Fact]
    public void Null_options_are_treated_as_empty()
    {
        var display = SortControlProjection.Project(null, "date", SortDirection.Ascending, null, Localizer);
        Assert.True(display.IsEmpty);
        Assert.Empty(display.Options);
    }

    [Fact]
    public void Options_are_carried_through_in_order()
    {
        var display = Project();
        Assert.False(display.IsEmpty);
        Assert.Equal(3, display.Options.Count);
        Assert.Equal("date", display.Options[0].Value);
        Assert.Equal("Score", display.Options[2].Label);
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(
            () => SortControlProjection.Project(Options, "date", SortDirection.Ascending, null, null!));
    }

    // ── View-model ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new SortControlSource(Options, "score", SortDirection.Descending);
        using var vm = new SortControlViewModel(source, Localizer);

        Assert.Equal("score", vm.Display.SelectedValue);
        Assert.Equal(SortDirection.Descending, vm.Direction);
        Assert.False(vm.IsAscending);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_field_changes()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        using var vm = new SortControlViewModel(source, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetField("distance");

        Assert.Equal("distance", vm.Display.SelectedValue);
        Assert.Equal("Distance", vm.Display.SelectedLabel);
        Assert.Contains(nameof(SortControlViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_direction_toggles()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        using var vm = new SortControlViewModel(source, Localizer);

        source.ToggleDirection();

        Assert.False(vm.IsAscending);
        Assert.Equal(SortDirection.Descending, vm.Direction);
        Assert.Equal(SortControlDisplay.DescendingGlyph, vm.Display.DirectionGlyph);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        var vm = new SortControlViewModel(source, Localizer);
        vm.Dispose();

        source.SetField("distance");

        Assert.Equal("date", vm.Display.SelectedValue);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new SortControlViewModel(new SortControlSource(), Localizer);
        vm.Dispose();
        vm.Dispose();
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new SortControlViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new SortControlViewModel(new SortControlSource(), null!));
    }

    [Fact]
    public void ViewModel_slug_matches_the_registration() =>
        Assert.Equal(SortControlRegistration.Slug, SortControlViewModel.Slug);

    // ── Source ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_set_field_raises_changed_and_field_changed()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        int changed = 0;
        string? reported = null;
        source.Changed += (_, _) => changed++;
        source.FieldChanged += (_, value) => reported = value;

        source.SetField("score");

        Assert.Equal(1, changed);
        Assert.Equal("score", reported);
        Assert.Equal("score", source.Field);
    }

    [Fact]
    public void Source_set_field_is_a_no_op_when_unchanged()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        int changed = 0;
        source.Changed += (_, _) => changed++;

        source.SetField("date");

        Assert.Equal(0, changed);
    }

    [Fact]
    public void Source_set_direction_raises_changed_and_direction_changed()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        SortDirection? reported = null;
        source.DirectionChanged += (_, dir) => reported = dir;

        source.SetDirection(SortDirection.Descending);

        Assert.Equal(SortDirection.Descending, reported);
        Assert.Equal(SortDirection.Descending, source.Direction);
    }

    [Fact]
    public void Source_set_direction_is_a_no_op_when_unchanged()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        int changed = 0;
        source.Changed += (_, _) => changed++;

        source.SetDirection(SortDirection.Ascending);

        Assert.Equal(0, changed);
    }

    [Fact]
    public void Source_toggle_flips_and_returns_the_new_direction()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        var reported = new List<SortDirection>();
        source.DirectionChanged += (_, dir) => reported.Add(dir);

        Assert.Equal(SortDirection.Descending, source.ToggleDirection());
        Assert.Equal(SortDirection.Ascending, source.ToggleDirection());
        Assert.Equal(new[] { SortDirection.Descending, SortDirection.Ascending }, reported);
    }

    [Fact]
    public void Source_set_options_raises_changed()
    {
        var source = new SortControlSource();
        int changed = 0;
        source.Changed += (_, _) => changed++;

        source.SetOptions(Options);

        Assert.Equal(1, changed);
        Assert.Equal(3, source.Options.Count);
    }

    [Fact]
    public void Source_falls_back_to_defaults_for_null_assignments()
    {
        var source = new SortControlSource(null!, null!, SortDirection.Ascending);
        Assert.Empty(source.Options);
        Assert.Equal(string.Empty, source.Field);
    }

    [Fact]
    public void Source_normalizes_none_to_ascending()
    {
        var source = new SortControlSource(Options, "date", SortDirection.None);
        Assert.Equal(SortDirection.Ascending, source.Direction);
    }

    [Fact]
    public void Source_set_direction_accessible_label_raises_and_clears()
    {
        var source = new SortControlSource(Options, "date", SortDirection.Ascending);
        int changed = 0;
        source.Changed += (_, _) => changed++;

        source.SetDirectionAccessibleLabel("Toggle order");
        Assert.Equal("Toggle order", source.DirectionAccessibleLabel);

        source.SetDirectionAccessibleLabel("");
        Assert.Null(source.DirectionAccessibleLabel);
        Assert.Equal(2, changed);
    }

    // ── Registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("SortControl", SortControlRegistration.Slug);

    [Fact]
    public void Registration_keys_match_the_catalog()
    {
        Assert.Equal("translation.sortControl.ascending", SortControlRegistration.AscendingKey);
        Assert.Equal("translation.sortControl.descending", SortControlRegistration.DescendingKey);
        Assert.Equal("translation.sortControl.fieldLabel", SortControlRegistration.FieldLabelKey);
        Assert.Equal("translation.sortControl.direction", SortControlRegistration.DirectionKey);
    }

    [Fact]
    public void Registration_fallbacks_match_the_web_source()
    {
        Assert.Equal("Ascending", SortControlRegistration.AscendingFallback);
        Assert.Equal("Descending", SortControlRegistration.DescendingFallback);
        Assert.Equal("Sort by", SortControlRegistration.FieldLabelFallback);
        Assert.Equal("Sort direction", SortControlRegistration.DirectionFallback);
    }

    [Fact]
    public void Registration_resolves_localized_labels_through_the_facade()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            ["translation.sortControl.ascending"] = "ASC",
            ["translation.sortControl.descending"] = "DESC",
            ["translation.sortControl.fieldLabel"] = "FIELD",
            ["translation.sortControl.direction"] = "DIR",
        });

        Assert.Equal("ASC", SortControlRegistration.Ascending(localizer));
        Assert.Equal("DESC", SortControlRegistration.Descending(localizer));
        Assert.Equal("FIELD", SortControlRegistration.FieldLabel(localizer));
        Assert.Equal("DIR", SortControlRegistration.DirectionName(localizer));
    }

    [Fact]
    public void Registration_direction_label_follows_the_direction()
    {
        Assert.Equal("Ascending", SortControlRegistration.DirectionLabel(Localizer, SortDirection.Ascending));
        Assert.Equal("Descending", SortControlRegistration.DirectionLabel(Localizer, SortDirection.Descending));
    }

    [Fact]
    public void Registration_direction_accessible_name_composes_the_prefix_and_label()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            ["translation.sortControl.ascending"] = "ASC",
            ["translation.sortControl.direction"] = "DIR",
        });

        Assert.Equal("DIR: ASC", SortControlRegistration.DirectionAccessibleName(localizer, SortDirection.Ascending));
    }

    [Fact]
    public void Registration_direction_accessible_name_honours_an_explicit_override() =>
        Assert.Equal(
            "Custom",
            SortControlRegistration.DirectionAccessibleName(Localizer, SortDirection.Ascending, "Custom"));

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SortControlDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SortControl", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new SortControlDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_field_or_label_values()
    {
        var lines = new List<string>();
        var diagnostics = new SortControlDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("date", line, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Distance", line, StringComparison.Ordinal);
        });
    }

    // ── Accessibility ────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(SortDirection.Ascending, "date")]
    [InlineData(SortDirection.Descending, "score")]
    public void Every_populated_state_exposes_non_empty_accessible_names(SortDirection direction, string field)
    {
        var display = Project(direction, field);
        Assert.False(string.IsNullOrEmpty(display.FieldLabel));
        Assert.False(string.IsNullOrEmpty(display.DirectionAccessibleName));
    }

    [Fact]
    public void Empty_state_still_exposes_non_empty_accessible_names()
    {
        var display = Project(options: []);
        Assert.False(string.IsNullOrEmpty(display.FieldLabel));
        Assert.False(string.IsNullOrEmpty(display.DirectionAccessibleName));
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
