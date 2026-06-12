using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.SelectSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Select</c> shared surface's UI-thread-free logic — the parity pixel metrics
/// (<see cref="SelectMetricsTable"/>), the field-id slug + state derivations (<see cref="SelectState"/>), the
/// render projection incl. i18n resolution and the composed accessible names (<see cref="SelectProjection"/>), the
/// controlled / user-interaction state holder (<see cref="SelectViewModel"/>), the registration metadata and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (<c>web/src/components/ui/Select.tsx</c>, composing
/// <c>Label.tsx</c> + <c>HelpIcon.tsx</c>). The WinUI view (Select.cs, which composes the label row + ComboBox +
/// helper line and the Group automation peer) is exercised by the app build.
/// </summary>
public sealed class SelectTests
{
    // A localizer that maps known keys to markers so the projection's key usage is asserted; unknown keys return
    // the supplied fallback (the PassthroughLocalizer contract).
    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) => _map.TryGetValue(key, out string? value) ? value : fallback;
    }

    private static SelectOption[] SampleOptions() =>
    [
        SelectOption.Create("d", "Drive"),
        SelectOption.Create("r", "Reverse"),
        SelectOption.Create("p", "Park", isDisabled: true),
    ];

    private static SelectState SampleState(SelectState? seed = null) =>
        (seed ?? new SelectState()) with { Options = SampleOptions() };

    // ── registration (slug, i18n keys, slugify) ──────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Select", SelectRegistration.Slug);

    [Fact]
    public void Registration_owns_the_three_web_i18n_keys_with_verbatim_fallbacks()
    {
        Assert.Equal("translation.form.required", SelectRegistration.RequiredKey);
        Assert.Equal("required", SelectRegistration.RequiredFallback);
        Assert.Equal("translation.a11y.helpFor", SelectRegistration.HelpForKey);
        Assert.Equal("Help for {0}", SelectRegistration.HelpForFallback);
        Assert.Equal("translation.help.tooltip.iconLabel", SelectRegistration.HelpIconLabelKey);
        Assert.Equal("More info", SelectRegistration.HelpIconLabelFallback);
    }

    [Theory]
    [InlineData("Drive Mode", "drive-mode")]
    [InlineData("UPPER", "upper")]
    [InlineData("Multiple   Spaces", "multiple-spaces")]
    [InlineData("Tab\tSeparated", "tab-separated")]
    public void Slugify_matches_the_web_id_derivation(string label, string expected) =>
        Assert.Equal(expected, SelectRegistration.Slugify(label));

    // ── adapter: SelectMetricsTable (web sizeClasses table) ──────────────────────────────────────────────

    [Fact]
    public void Metrics_small_match_the_web_size_table()
    {
        SelectMetrics metrics = SelectMetricsTable.For(SelectSize.Sm);

        // web sm: px-2 py-1.5 text-xs.
        Assert.Equal(12, metrics.FontSize);
        Assert.Equal(8, metrics.PaddingX);
        Assert.Equal(6, metrics.PaddingY);
        Assert.Equal(0, metrics.MinHeight);
    }

    [Fact]
    public void Metrics_medium_match_the_web_size_table()
    {
        SelectMetrics metrics = SelectMetricsTable.For(SelectSize.Md);

        // web md (default): px-3 py-2 text-sm.
        Assert.Equal(14, metrics.FontSize);
        Assert.Equal(12, metrics.PaddingX);
        Assert.Equal(8, metrics.PaddingY);
        Assert.Equal(0, metrics.MinHeight);
    }

    [Fact]
    public void Metrics_large_match_the_web_size_table()
    {
        SelectMetrics metrics = SelectMetricsTable.For(SelectSize.Lg);

        // web lg: px-4 py-2.5 text-base.
        Assert.Equal(16, metrics.FontSize);
        Assert.Equal(16, metrics.PaddingX);
        Assert.Equal(10, metrics.PaddingY);
        Assert.Equal(0, metrics.MinHeight);
    }

    [Fact]
    public void Metrics_auto_resolves_to_the_density_baseline()
    {
        SelectMetrics metrics = SelectMetricsTable.For(SelectSize.Auto);

        // web auto: density-aware — the standard density baseline (md spacing + a touch-row min height).
        Assert.Equal(14, metrics.FontSize);
        Assert.Equal(12, metrics.PaddingX);
        Assert.Equal(8, metrics.PaddingY);
        Assert.Equal(SelectMetricsTable.DensityRowMinHeight, metrics.MinHeight);
    }

    [Theory]
    [InlineData(SelectSize.Sm)]
    [InlineData(SelectSize.Md)]
    [InlineData(SelectSize.Lg)]
    [InlineData(SelectSize.Auto)]
    public void Metrics_share_the_web_radius_and_stroke(SelectSize size)
    {
        SelectMetrics metrics = SelectMetricsTable.For(size);

        // web rounded-md (6 px) + border (1 px).
        Assert.Equal(6, metrics.CornerRadius);
        Assert.Equal(1, metrics.BorderThickness);
    }

    [Fact]
    public void Unknown_size_falls_back_to_medium_metrics() =>
        Assert.Equal(SelectMetricsTable.For(SelectSize.Md), SelectMetricsTable.For((SelectSize)999));

    // ── adapter: SelectState derivations ─────────────────────────────────────────────────────────────────

    [Fact]
    public void SelectId_prefers_the_explicit_id()
    {
        var state = new SelectState { Id = "vehicle-picker", Label = "Vehicle" };

        Assert.Equal("vehicle-picker", state.SelectId);
    }

    [Fact]
    public void SelectId_falls_back_to_the_slugified_label()
    {
        var state = new SelectState { Label = "Drive Mode" };

        Assert.Equal("drive-mode", state.SelectId);
    }

    [Fact]
    public void SelectId_is_null_without_an_id_or_label() =>
        Assert.Null(new SelectState().SelectId);

    [Fact]
    public void Show_hint_is_suppressed_when_an_error_is_present()
    {
        var state = new SelectState { Hint = "Pick a drive mode", Error = "Required field" };

        Assert.True(state.HasError);
        Assert.False(state.ShowHint);
    }

    [Fact]
    public void Show_hint_is_true_when_a_hint_is_present_without_an_error()
    {
        var state = new SelectState { Hint = "Pick a drive mode" };

        Assert.True(state.ShowHint);
    }

    [Fact]
    public void Empty_options_is_a_render_state_not_a_hidden_surface()
    {
        var state = new SelectState();

        Assert.False(state.HasOptions);
        Assert.Empty(state.Options);
    }

    [Fact]
    public void Selected_option_and_index_resolve_from_the_value()
    {
        SelectState state = SampleState() with { SelectedValue = "r" };

        Assert.Equal("Reverse", state.SelectedOption?.Label);
        Assert.Equal(1, state.SelectedIndex);
    }

    [Fact]
    public void Selected_index_is_minus_one_when_nothing_matches()
    {
        SelectState state = SampleState() with { SelectedValue = "missing" };

        Assert.Null(state.SelectedOption);
        Assert.Equal(-1, state.SelectedIndex);
    }

    [Fact]
    public void Can_select_an_enabled_present_option() =>
        Assert.True(SampleState().CanSelect("d"));

    [Fact]
    public void Cannot_select_a_disabled_option() =>
        Assert.False(SampleState().CanSelect("p"));

    [Fact]
    public void Cannot_select_an_absent_option() =>
        Assert.False(SampleState().CanSelect("x"));

    [Fact]
    public void Can_clear_the_selection_with_null() =>
        Assert.True(SampleState().CanSelect(null));

    // ── adapter: SelectProjection (per-state + i18n + a11y) ──────────────────────────────────────────────

    [Fact]
    public void Projection_of_a_bare_label_has_no_required_marker_and_a_plain_accessible_name()
    {
        var state = new SelectState { Label = "Vehicle", Options = SampleOptions() };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.HasLabel);
        Assert.Equal("Vehicle", display.LabelText);
        Assert.False(display.ShowRequiredMarker);
        Assert.Equal("Vehicle", display.AccessibleName);
    }

    [Fact]
    public void Projection_of_a_required_label_appends_the_localized_required_word()
    {
        var state = new SelectState { Label = "Vehicle", IsRequired = true };
        var localizer = new MapLocalizer(new Dictionary<string, string> { [SelectRegistration.RequiredKey] = "REQ" });

        SelectDisplay display = SelectProjection.Project(state, localizer);

        // web Label: the visible `*` plus a VisuallyHidden localized "required" folded into the accessible name.
        Assert.True(display.ShowRequiredMarker);
        Assert.Equal("Vehicle REQ", display.AccessibleName);
    }

    [Fact]
    public void Required_falls_back_to_the_english_required_word()
    {
        var state = new SelectState { Label = "Vehicle", IsRequired = true };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.Equal("Vehicle required", display.AccessibleName);
    }

    [Fact]
    public void Required_without_a_label_renders_no_marker_and_no_name()
    {
        // web: the `*` lives inside the {label && ...} block, so it never renders without a label.
        var state = new SelectState { IsRequired = true, Options = SampleOptions() };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.False(display.HasLabel);
        Assert.False(display.ShowRequiredMarker);
        Assert.Equal(string.Empty, display.AccessibleName);
    }

    [Fact]
    public void Help_renders_with_a_per_field_accessible_name()
    {
        var state = new SelectState
        {
            Label = "Drive Mode",
            Help = SelectHelp.FromText("Choose how the car drives"),
        };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.HelpVisible);
        Assert.Equal("Choose how the car drives", display.HelpText);
        // forId defaults to the resolved selectId (slugified label); fallback "Help for {0}".
        Assert.Equal("Help for drive-mode", display.HelpAccessibleLabel);
    }

    [Fact]
    public void Help_uses_the_explicit_for_id_over_the_select_id()
    {
        var state = new SelectState
        {
            Label = "Drive Mode",
            Help = SelectHelp.Create(content: "info", forId: "custom-field"),
        };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.Equal("Help for custom-field", display.HelpAccessibleLabel);
    }

    [Fact]
    public void Help_aria_label_override_wins()
    {
        var state = new SelectState
        {
            Label = "Drive Mode",
            Help = SelectHelp.Create(content: "info", ariaLabel: "Drive mode help"),
        };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.Equal("Drive mode help", display.HelpAccessibleLabel);
    }

    [Fact]
    public void Help_resolves_its_body_through_the_i18n_key()
    {
        var state = new SelectState
        {
            Label = "Drive Mode",
            Help = SelectHelp.FromKey("help.driveMode", "fallback help"),
        };
        var localizer = new MapLocalizer(new Dictionary<string, string> { ["help.driveMode"] = "Localized help body" });

        SelectDisplay display = SelectProjection.Project(state, localizer);

        Assert.True(display.HelpVisible);
        Assert.Equal("Localized help body", display.HelpText);
    }

    [Fact]
    public void Help_is_hidden_without_a_label()
    {
        // web: the HelpIcon is nested inside the {label && ...} block.
        var state = new SelectState { Help = SelectHelp.FromText("info"), Options = SampleOptions() };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.False(display.HelpVisible);
    }

    [Fact]
    public void Help_is_hidden_when_its_body_is_empty()
    {
        // web HelpIcon L69: renders nothing when no help text is supplied.
        var state = new SelectState { Label = "Drive Mode", Help = SelectHelp.Create() };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.False(display.HelpVisible);
    }

    [Fact]
    public void Projection_of_an_error_sets_the_described_by_error_id()
    {
        var state = new SelectState { Label = "Vehicle", Error = "Select a vehicle", Hint = "ignored" };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.HasError);
        Assert.Equal("Select a vehicle", display.ErrorText);
        Assert.False(display.ShowHint);
        Assert.Equal("vehicle-error", display.DescribedById);
        Assert.Equal("Select a vehicle", display.DescribedText);
    }

    [Fact]
    public void Projection_of_a_hint_sets_the_described_by_hint_id()
    {
        var state = new SelectState { Label = "Vehicle", Hint = "Pick the active vehicle" };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.ShowHint);
        Assert.Equal("vehicle-hint", display.DescribedById);
        Assert.Equal("Pick the active vehicle", display.DescribedText);
    }

    [Fact]
    public void Described_by_is_null_without_a_resolvable_id()
    {
        // No id, no label → no selectId → no aria-describedby target even with an error.
        var state = new SelectState { Error = "boom", Options = SampleOptions() };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.HasError);
        Assert.Null(display.DescribedById);
    }

    [Fact]
    public void Projection_carries_prompt_options_and_selection()
    {
        var state = new SelectState
        {
            Label = "Gear",
            Options = SampleOptions(),
            Prompt = "Select a gear",
            SelectedValue = "d",
        };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.HasPrompt);
        Assert.Equal("Select a gear", display.PromptText);
        Assert.True(display.HasOptions);
        Assert.Equal(3, display.Options.Count);
        Assert.Equal(0, display.SelectedIndex);
    }

    [Fact]
    public void Projection_of_empty_options_still_produces_a_display()
    {
        var state = new SelectState { Label = "Gear", Prompt = "None available" };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.False(display.HasOptions);
        Assert.Empty(display.Options);
        Assert.Equal(-1, display.SelectedIndex);
    }

    [Fact]
    public void Projection_carries_the_disabled_flag_and_size_metrics()
    {
        var state = new SelectState { Label = "Gear", IsDisabled = true, Size = SelectSize.Lg };

        SelectDisplay display = SelectProjection.Project(state, PassthroughLocalizer.Instance);

        Assert.True(display.IsDisabled);
        Assert.Equal(SelectMetricsTable.For(SelectSize.Lg), display.Metrics);
    }

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => SelectProjection.Project(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => SelectProjection.Project(new SelectState(), null!));
    }

    // ── view-model: initial state ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_from_the_supplied_state()
    {
        var viewModel = new SelectViewModel(
            options: SampleOptions(),
            label: "Drive Mode",
            size: SelectSize.Lg,
            isRequired: true,
            selectedValue: "d",
            id: "gear");

        Assert.Equal(3, viewModel.Options.Count);
        Assert.Equal("Drive Mode", viewModel.Label);
        Assert.Equal(SelectSize.Lg, viewModel.Size);
        Assert.True(viewModel.IsRequired);
        Assert.Equal("d", viewModel.SelectedValue);
        Assert.Equal("gear", viewModel.SelectId);
        Assert.Equal("Drive", viewModel.SelectedOption?.Label);
        Assert.Equal(0, viewModel.SelectedIndex);
    }

    [Fact]
    public void ViewModel_default_is_empty_medium_and_unselected()
    {
        var viewModel = new SelectViewModel();

        Assert.Empty(viewModel.Options);
        Assert.Null(viewModel.Label);
        Assert.Equal(SelectSize.Md, viewModel.Size);
        Assert.False(viewModel.IsDisabled);
        Assert.Null(viewModel.SelectedValue);
        Assert.Equal(-1, viewModel.SelectedIndex);
    }

    // ── view-model: user selection fires SelectionChanged (the web onChange path) ────────────────────────

    [Fact]
    public void ViewModel_select_changes_value_and_reports_it()
    {
        var viewModel = new SelectViewModel(options: SampleOptions());
        var reported = new List<string?>();
        viewModel.SelectionChanged += (_, e) => reported.Add(e.Value);

        bool changed = viewModel.SelectValue("r");

        Assert.True(changed);
        Assert.Equal("r", viewModel.SelectedValue);
        Assert.Equal(new[] { "r" }, reported);
    }

    [Fact]
    public void ViewModel_select_same_value_is_a_no_op()
    {
        var viewModel = new SelectViewModel(options: SampleOptions(), selectedValue: "d");
        int events = 0;
        viewModel.SelectionChanged += (_, _) => events++;

        bool changed = viewModel.SelectValue("d");

        Assert.False(changed);
        Assert.Equal(0, events);
    }

    [Fact]
    public void ViewModel_select_on_a_disabled_control_is_a_no_op()
    {
        var viewModel = new SelectViewModel(options: SampleOptions(), isDisabled: true);
        int events = 0;
        viewModel.SelectionChanged += (_, _) => events++;

        bool changed = viewModel.SelectValue("r");

        Assert.False(changed);
        Assert.Null(viewModel.SelectedValue);
        Assert.Equal(0, events);
    }

    [Fact]
    public void ViewModel_select_of_a_disabled_option_is_rejected()
    {
        var viewModel = new SelectViewModel(options: SampleOptions());
        int events = 0;
        viewModel.SelectionChanged += (_, _) => events++;

        bool changed = viewModel.SelectValue("p");

        Assert.False(changed);
        Assert.Null(viewModel.SelectedValue);
        Assert.Equal(0, events);
    }

    [Fact]
    public void ViewModel_select_of_an_absent_option_is_rejected()
    {
        var viewModel = new SelectViewModel(options: SampleOptions());

        Assert.False(viewModel.SelectValue("nope"));
    }

    [Fact]
    public void ViewModel_select_null_clears_the_selection_and_reports_null()
    {
        var viewModel = new SelectViewModel(options: SampleOptions(), selectedValue: "d");
        var reported = new List<string?>();
        viewModel.SelectionChanged += (_, e) => reported.Add(e.Value);

        bool changed = viewModel.SelectValue(null);

        Assert.True(changed);
        Assert.Null(viewModel.SelectedValue);
        Assert.Equal(new string?[] { null }, reported);
    }

    [Fact]
    public void ViewModel_select_raises_change_notification_for_value_and_derived_members()
    {
        var viewModel = new SelectViewModel(options: SampleOptions());
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SelectValue("r");

        Assert.Contains(nameof(SelectViewModel.SelectedValue), changed);
        Assert.Contains(nameof(SelectViewModel.SelectedOption), changed);
        Assert.Contains(nameof(SelectViewModel.SelectedIndex), changed);
    }

    // ── view-model: controlled assignment notifies but never fires SelectionChanged ──────────────────────

    [Fact]
    public void ViewModel_controlled_value_assignment_notifies_without_firing_selection_changed()
    {
        var viewModel = new SelectViewModel(options: SampleOptions());
        var changed = new List<string?>();
        int userEvents = 0;
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        viewModel.SelectionChanged += (_, _) => userEvents++;

        viewModel.SelectedValue = "r";

        Assert.Equal("r", viewModel.SelectedValue);
        Assert.Contains(nameof(SelectViewModel.SelectedValue), changed);
        Assert.Contains(nameof(SelectViewModel.SelectedOption), changed);
        Assert.Equal(0, userEvents);
    }

    [Fact]
    public void ViewModel_assigning_the_same_value_raises_no_change()
    {
        var viewModel = new SelectViewModel(options: SampleOptions(), selectedValue: "d");
        int changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SelectedValue = "d";

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_options_assignment_notifies_and_refreshes_the_selection()
    {
        var viewModel = new SelectViewModel(selectedValue: "r");
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Options = SampleOptions();

        Assert.Contains(nameof(SelectViewModel.Options), changed);
        Assert.Contains(nameof(SelectViewModel.SelectedOption), changed);
        Assert.Contains(nameof(SelectViewModel.SelectedIndex), changed);
        Assert.Equal(1, viewModel.SelectedIndex);
    }

    [Fact]
    public void ViewModel_label_assignment_notifies_label_and_select_id()
    {
        var viewModel = new SelectViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Label = "Drive Mode";

        Assert.Equal("Drive Mode", viewModel.Label);
        Assert.Contains(nameof(SelectViewModel.Label), changed);
        Assert.Contains(nameof(SelectViewModel.SelectId), changed);
        Assert.Equal("drive-mode", viewModel.SelectId);
    }

    [Fact]
    public void ViewModel_error_and_hint_and_disabled_assignments_notify()
    {
        var viewModel = new SelectViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Error = "boom";
        viewModel.Hint = "tip";
        viewModel.IsDisabled = true;
        viewModel.Prompt = "Pick one";

        Assert.Contains(nameof(SelectViewModel.Error), changed);
        Assert.Contains(nameof(SelectViewModel.Hint), changed);
        Assert.Contains(nameof(SelectViewModel.IsDisabled), changed);
        Assert.Contains(nameof(SelectViewModel.Prompt), changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label, options or value) ──────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SelectDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Select", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new SelectDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
