using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.SharedSurfaces.CheckboxSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Checkbox</c> shared surface's UI-thread-free logic — the parity pixel
/// metrics (<see cref="CheckboxMetricsTable"/>), the three-state projection + browser toggle semantics
/// (<see cref="CheckboxState"/>), the controlled / user-interaction state holder
/// (<see cref="CheckboxViewModel"/>), the registration slug and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (<c>web/src/components/ui/Checkbox.tsx</c>). The WinUI view (Checkbox.cs, which composes the
/// tokenized box + glyph and the CheckBox automation peer) is exercised by the app build.
/// </summary>
public sealed class CheckboxTests
{
    // ── registration (diagnostics slug, web anonymous component) ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Checkbox", CheckboxRegistration.Slug);

    // ── adapter: CheckboxMetricsTable (web sizes table) ──────────────────────────────────────────────────

    [Fact]
    public void Metrics_small_match_the_web_size_table()
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For(CheckboxSize.Sm);

        // web sm: box h-3.5 w-3.5 (14 px), icon h-2.5 w-2.5 (10 px).
        Assert.Equal(14, metrics.BoxSize);
        Assert.Equal(10, metrics.GlyphSize);
    }

    [Fact]
    public void Metrics_medium_match_the_web_size_table()
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For(CheckboxSize.Md);

        // web md (default): box h-4 w-4 (16 px), icon h-3 w-3 (12 px).
        Assert.Equal(16, metrics.BoxSize);
        Assert.Equal(12, metrics.GlyphSize);
    }

    [Fact]
    public void Metrics_large_match_the_web_size_table()
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For(CheckboxSize.Lg);

        // web lg: box h-5 w-5 (20 px), icon h-3.5 w-3.5 (14 px).
        Assert.Equal(20, metrics.BoxSize);
        Assert.Equal(14, metrics.GlyphSize);
    }

    [Theory]
    [InlineData(CheckboxSize.Sm)]
    [InlineData(CheckboxSize.Md)]
    [InlineData(CheckboxSize.Lg)]
    public void Metrics_share_the_web_label_gap_radius_and_stroke(CheckboxSize size)
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For(size);

        // web label text-sm (14 px), gap-2 (8 px), rounded (4 px); the Fluent checkbox stroke (2 px).
        Assert.Equal(14, metrics.LabelFontSize);
        Assert.Equal(8, metrics.Gap);
        Assert.Equal(4, metrics.CornerRadius);
        Assert.Equal(2, metrics.BorderThickness);
    }

    [Fact]
    public void Unknown_size_falls_back_to_medium_metrics()
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For((CheckboxSize)999);

        Assert.Equal(CheckboxMetricsTable.For(CheckboxSize.Md), metrics);
    }

    // ── adapter: CheckboxState.ToggleState (web peer-checked / peer-indeterminate projection) ─────────────

    [Fact]
    public void Toggle_state_is_unchecked_by_default()
    {
        var state = new CheckboxState();

        Assert.Equal(CheckboxToggleState.Unchecked, state.ToggleState);
    }

    [Fact]
    public void Toggle_state_is_checked_when_checked()
    {
        var state = new CheckboxState(IsChecked: true);

        Assert.Equal(CheckboxToggleState.Checked, state.ToggleState);
    }

    [Fact]
    public void Indeterminate_overrides_checked_in_the_projection()
    {
        // web: el.indeterminate = indeterminate wins over the checked prop's visual.
        var state = new CheckboxState(IsChecked: true, IsIndeterminate: true);

        Assert.Equal(CheckboxToggleState.Indeterminate, state.ToggleState);
    }

    // ── adapter: CheckboxState.Toggle (browser checkbox semantics) ───────────────────────────────────────

    [Fact]
    public void Toggling_an_unchecked_box_checks_it()
    {
        CheckboxToggleResult result = new CheckboxState().Toggle();

        Assert.True(result.Changed);
        Assert.True(result.IsChecked);
        Assert.True(result.State.IsChecked);
        Assert.False(result.State.IsIndeterminate);
        Assert.Equal(CheckboxToggleState.Checked, result.State.ToggleState);
    }

    [Fact]
    public void Toggling_a_checked_box_unchecks_it()
    {
        CheckboxToggleResult result = new CheckboxState(IsChecked: true).Toggle();

        Assert.True(result.Changed);
        Assert.False(result.IsChecked);
        Assert.Equal(CheckboxToggleState.Unchecked, result.State.ToggleState);
    }

    [Fact]
    public void Toggling_an_indeterminate_box_resolves_to_checked_and_clears_mixed()
    {
        // Browser behaviour: clicking an indeterminate checkbox sets checked=true and indeterminate=false.
        CheckboxToggleResult result = new CheckboxState(IsIndeterminate: true).Toggle();

        Assert.True(result.Changed);
        Assert.True(result.IsChecked);
        Assert.False(result.State.IsIndeterminate);
        Assert.Equal(CheckboxToggleState.Checked, result.State.ToggleState);
    }

    [Fact]
    public void Toggling_a_disabled_box_is_a_no_op()
    {
        var state = new CheckboxState(IsChecked: false, IsDisabled: true);

        CheckboxToggleResult result = state.Toggle();

        // web: `if (disabled) return;` — no state change and no onChange.
        Assert.False(result.Changed);
        Assert.Equal(state, result.State);
        Assert.False(result.IsChecked);
    }

    [Fact]
    public void Toggle_preserves_size_and_label()
    {
        var state = new CheckboxState(Size: CheckboxSize.Lg, Label: "Select all");

        CheckboxToggleResult result = state.Toggle();

        Assert.Equal(CheckboxSize.Lg, result.State.Size);
        Assert.Equal("Select all", result.State.Label);
    }

    // ── accessibility: the inline label is the accessible name ───────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_inline_label()
    {
        var state = new CheckboxState(Label: "Include archived vehicles");

        Assert.Equal("Include archived vehicles", state.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_empty_for_an_anonymous_checkbox()
    {
        var state = new CheckboxState(Label: null);

        Assert.Equal(string.Empty, state.AccessibleName);
    }

    // ── view-model: initial state ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_from_the_supplied_state()
    {
        var viewModel = new CheckboxViewModel(
            isChecked: true,
            isIndeterminate: false,
            isDisabled: false,
            size: CheckboxSize.Lg,
            label: "Remember me");

        Assert.True(viewModel.IsChecked);
        Assert.False(viewModel.IsIndeterminate);
        Assert.False(viewModel.IsDisabled);
        Assert.Equal(CheckboxSize.Lg, viewModel.Size);
        Assert.Equal("Remember me", viewModel.Label);
        Assert.Equal(CheckboxToggleState.Checked, viewModel.ToggleState);
    }

    [Fact]
    public void ViewModel_default_is_unchecked_medium_and_unlabeled()
    {
        var viewModel = new CheckboxViewModel();

        Assert.False(viewModel.IsChecked);
        Assert.False(viewModel.IsIndeterminate);
        Assert.False(viewModel.IsDisabled);
        Assert.Equal(CheckboxSize.Md, viewModel.Size);
        Assert.Null(viewModel.Label);
        Assert.Equal(CheckboxToggleState.Unchecked, viewModel.ToggleState);
    }

    // ── view-model: user toggle fires CheckedChanged (the web onChange path) ─────────────────────────────

    [Fact]
    public void ViewModel_toggle_checks_and_reports_the_new_value()
    {
        var viewModel = new CheckboxViewModel();
        var reported = new List<bool>();
        viewModel.CheckedChanged += (_, e) => reported.Add(e.IsChecked);

        bool changed = viewModel.Toggle();

        Assert.True(changed);
        Assert.True(viewModel.IsChecked);
        Assert.Equal(new[] { true }, reported);
    }

    [Fact]
    public void ViewModel_toggle_round_trips_checked_to_unchecked()
    {
        var viewModel = new CheckboxViewModel(isChecked: true);
        var reported = new List<bool>();
        viewModel.CheckedChanged += (_, e) => reported.Add(e.IsChecked);

        viewModel.Toggle();

        Assert.False(viewModel.IsChecked);
        Assert.Equal(new[] { false }, reported);
    }

    [Fact]
    public void ViewModel_toggle_from_indeterminate_resolves_to_checked()
    {
        var viewModel = new CheckboxViewModel(isIndeterminate: true);
        var reported = new List<bool>();
        viewModel.CheckedChanged += (_, e) => reported.Add(e.IsChecked);

        viewModel.Toggle();

        Assert.True(viewModel.IsChecked);
        Assert.False(viewModel.IsIndeterminate);
        Assert.Equal(CheckboxToggleState.Checked, viewModel.ToggleState);
        Assert.Equal(new[] { true }, reported);
    }

    [Fact]
    public void ViewModel_toggle_is_a_no_op_when_disabled()
    {
        var viewModel = new CheckboxViewModel(isDisabled: true);
        int events = 0;
        viewModel.CheckedChanged += (_, _) => events++;

        bool changed = viewModel.Toggle();

        // web: `if (disabled) return;` — neither state nor onChange.
        Assert.False(changed);
        Assert.False(viewModel.IsChecked);
        Assert.Equal(0, events);
    }

    [Fact]
    public void ViewModel_toggle_raises_change_notification_for_checked_and_toggle_state()
    {
        var viewModel = new CheckboxViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Toggle();

        Assert.Contains(nameof(CheckboxViewModel.IsChecked), changed);
        Assert.Contains(nameof(CheckboxViewModel.ToggleState), changed);
    }

    // ── view-model: controlled assignment notifies but never fires CheckedChanged ────────────────────────

    [Fact]
    public void ViewModel_controlled_checked_assignment_notifies_without_firing_checked_changed()
    {
        var viewModel = new CheckboxViewModel();
        var changed = new List<string?>();
        int userEvents = 0;
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        viewModel.CheckedChanged += (_, _) => userEvents++;

        viewModel.IsChecked = true;

        Assert.True(viewModel.IsChecked);
        Assert.Contains(nameof(CheckboxViewModel.IsChecked), changed);
        Assert.Contains(nameof(CheckboxViewModel.ToggleState), changed);
        Assert.Equal(0, userEvents);
    }

    [Fact]
    public void ViewModel_assigning_the_same_value_raises_no_change()
    {
        var viewModel = new CheckboxViewModel(isChecked: true);
        int changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.IsChecked = true;

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_size_assignment_notifies()
    {
        var viewModel = new CheckboxViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Size = CheckboxSize.Sm;

        Assert.Equal(CheckboxSize.Sm, viewModel.Size);
        Assert.Contains(nameof(CheckboxViewModel.Size), changed);
    }

    [Fact]
    public void ViewModel_label_assignment_notifies()
    {
        var viewModel = new CheckboxViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Label = "Accept terms";

        Assert.Equal("Accept terms", viewModel.Label);
        Assert.Contains(nameof(CheckboxViewModel.Label), changed);
    }

    [Fact]
    public void ViewModel_disabled_assignment_notifies()
    {
        var viewModel = new CheckboxViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.IsDisabled = true;

        Assert.True(viewModel.IsDisabled);
        Assert.Contains(nameof(CheckboxViewModel.IsDisabled), changed);
    }

    [Fact]
    public void ViewModel_setting_indeterminate_updates_toggle_state()
    {
        var viewModel = new CheckboxViewModel(isChecked: true);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.IsIndeterminate = true;

        Assert.Equal(CheckboxToggleState.Indeterminate, viewModel.ToggleState);
        Assert.Contains(nameof(CheckboxViewModel.IsIndeterminate), changed);
        Assert.Contains(nameof(CheckboxViewModel.ToggleState), changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label or value) ───────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CheckboxDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Checkbox", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new CheckboxDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
