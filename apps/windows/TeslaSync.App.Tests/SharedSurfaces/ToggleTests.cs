using System.Collections.Generic;
using TeslaSync.App.SharedSurfaces.ToggleSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Toggle</c> shared surface's UI-thread-free logic — the parity pixel metrics
/// (<see cref="ToggleMetricsTable"/>), the two-state projection + flip semantics (<see cref="ToggleState"/>),
/// the controlled / user-interaction state holder (<see cref="ToggleViewModel"/>), the registration slug and
/// the PII-safe diagnostics. Mirrors the web spec one-for-one (<c>web/src/components/ui/Toggle.tsx</c>). The
/// WinUI view (Toggle.cs, which composes the tokenized track + sliding thumb and the Button automation peer)
/// is exercised by the app build.
/// </summary>
public sealed class ToggleTests
{
    // ── registration (diagnostics slug, web anonymous component) ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Toggle", ToggleRegistration.Slug);

    // ── adapter: ToggleMetricsTable (web trackSize / thumbSize / thumbTranslate tables) ──────────────────

    [Fact]
    public void Metrics_small_match_the_web_size_table()
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(ToggleSize.Sm);

        // web sm: track h-5 w-9 (20 x 36 px), thumb h-3.5 w-3.5 (14 px).
        Assert.Equal(36, metrics.TrackWidth);
        Assert.Equal(20, metrics.TrackHeight);
        Assert.Equal(14, metrics.ThumbSize);
    }

    [Fact]
    public void Metrics_medium_match_the_web_size_table()
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(ToggleSize.Md);

        // web md (default): track h-6 w-11 (24 x 44 px), thumb h-5 w-5 (20 px).
        Assert.Equal(44, metrics.TrackWidth);
        Assert.Equal(24, metrics.TrackHeight);
        Assert.Equal(20, metrics.ThumbSize);
    }

    [Fact]
    public void Small_thumb_travel_matches_the_web_translate_x_4()
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(ToggleSize.Sm);

        // web sm checked: translate-x-4 (16 px); the thumb is centered with a 3 px inset.
        Assert.Equal(3, metrics.ThumbInset);
        Assert.Equal(16, metrics.ThumbTravel);
    }

    [Fact]
    public void Medium_thumb_travel_matches_the_web_translate_x_5()
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(ToggleSize.Md);

        // web md checked: translate-x-5 (20 px); the thumb is centered with a 2 px inset.
        Assert.Equal(2, metrics.ThumbInset);
        Assert.Equal(20, metrics.ThumbTravel);
    }

    [Theory]
    [InlineData(ToggleSize.Sm)]
    [InlineData(ToggleSize.Md)]
    public void Track_and_thumb_corner_radii_are_full_pills(ToggleSize size)
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(size);

        // web rounded-full: the track and thumb radii are half their respective dimensions.
        Assert.Equal(metrics.TrackHeight / 2, metrics.TrackCornerRadius);
        Assert.Equal(metrics.ThumbSize / 2, metrics.ThumbCornerRadius);
    }

    [Theory]
    [InlineData(ToggleSize.Sm)]
    [InlineData(ToggleSize.Md)]
    public void Metrics_share_the_web_label_size_and_gap(ToggleSize size)
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(size);

        // web label text-sm (14 px) and gap-2 (8 px) on every size.
        Assert.Equal(14, metrics.LabelFontSize);
        Assert.Equal(8, metrics.Gap);
    }

    [Fact]
    public void Unknown_size_falls_back_to_medium_metrics()
    {
        ToggleMetrics metrics = ToggleMetricsTable.For((ToggleSize)999);

        Assert.Equal(ToggleMetricsTable.For(ToggleSize.Md), metrics);
    }

    // ── adapter: ToggleState.VisualState (web checked projection) ────────────────────────────────────────

    [Fact]
    public void Visual_state_is_off_by_default()
    {
        var state = new ToggleState();

        Assert.Equal(ToggleVisualState.Off, state.VisualState);
        Assert.False(state.IsChecked);
    }

    [Fact]
    public void Visual_state_is_on_when_checked()
    {
        var state = new ToggleState(IsChecked: true);

        Assert.Equal(ToggleVisualState.On, state.VisualState);
    }

    // ── adapter: ToggleState.Toggle (web onChange(!checked) flip) ────────────────────────────────────────

    [Fact]
    public void Toggling_an_off_switch_turns_it_on()
    {
        ToggleResult result = new ToggleState().Toggle();

        Assert.True(result.IsChecked);
        Assert.True(result.State.IsChecked);
        Assert.Equal(ToggleVisualState.On, result.State.VisualState);
    }

    [Fact]
    public void Toggling_an_on_switch_turns_it_off()
    {
        ToggleResult result = new ToggleState(IsChecked: true).Toggle();

        Assert.False(result.IsChecked);
        Assert.Equal(ToggleVisualState.Off, result.State.VisualState);
    }

    [Fact]
    public void Toggle_preserves_size_and_label()
    {
        var state = new ToggleState(Size: ToggleSize.Sm, Label: "Track location");

        ToggleResult result = state.Toggle();

        Assert.Equal(ToggleSize.Sm, result.State.Size);
        Assert.Equal("Track location", result.State.Label);
    }

    // ── accessibility: the inline label is the accessible name ───────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_inline_label()
    {
        var state = new ToggleState(Label: "Enable notifications");

        Assert.Equal("Enable notifications", state.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_empty_for_an_anonymous_switch()
    {
        var state = new ToggleState(Label: null);

        Assert.Equal(string.Empty, state.AccessibleName);
    }

    // ── view-model: initial state ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_from_the_supplied_state()
    {
        var viewModel = new ToggleViewModel(
            isChecked: true,
            size: ToggleSize.Sm,
            label: "Dark mode");

        Assert.True(viewModel.IsChecked);
        Assert.Equal(ToggleSize.Sm, viewModel.Size);
        Assert.Equal("Dark mode", viewModel.Label);
        Assert.Equal(ToggleVisualState.On, viewModel.VisualState);
    }

    [Fact]
    public void ViewModel_default_is_off_medium_and_unlabeled()
    {
        var viewModel = new ToggleViewModel();

        Assert.False(viewModel.IsChecked);
        Assert.Equal(ToggleSize.Md, viewModel.Size);
        Assert.Null(viewModel.Label);
        Assert.Equal(ToggleVisualState.Off, viewModel.VisualState);
    }

    // ── view-model: user toggle fires CheckedChanged (the web onChange path) ─────────────────────────────

    [Fact]
    public void ViewModel_toggle_turns_on_and_reports_the_new_value()
    {
        var viewModel = new ToggleViewModel();
        var reported = new List<bool>();
        viewModel.CheckedChanged += (_, e) => reported.Add(e.IsChecked);

        bool result = viewModel.Toggle();

        Assert.True(result);
        Assert.True(viewModel.IsChecked);
        Assert.Equal(new[] { true }, reported);
    }

    [Fact]
    public void ViewModel_toggle_round_trips_on_to_off()
    {
        var viewModel = new ToggleViewModel(isChecked: true);
        var reported = new List<bool>();
        viewModel.CheckedChanged += (_, e) => reported.Add(e.IsChecked);

        viewModel.Toggle();

        Assert.False(viewModel.IsChecked);
        Assert.Equal(new[] { false }, reported);
    }

    [Fact]
    public void ViewModel_toggle_raises_change_notification_for_checked_and_visual_state()
    {
        var viewModel = new ToggleViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Toggle();

        Assert.Contains(nameof(ToggleViewModel.IsChecked), changed);
        Assert.Contains(nameof(ToggleViewModel.VisualState), changed);
    }

    // ── view-model: controlled assignment notifies but never fires CheckedChanged ────────────────────────

    [Fact]
    public void ViewModel_controlled_checked_assignment_notifies_without_firing_checked_changed()
    {
        var viewModel = new ToggleViewModel();
        var changed = new List<string?>();
        int userEvents = 0;
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        viewModel.CheckedChanged += (_, _) => userEvents++;

        viewModel.IsChecked = true;

        Assert.True(viewModel.IsChecked);
        Assert.Contains(nameof(ToggleViewModel.IsChecked), changed);
        Assert.Contains(nameof(ToggleViewModel.VisualState), changed);
        Assert.Equal(0, userEvents);
    }

    [Fact]
    public void ViewModel_assigning_the_same_value_raises_no_change()
    {
        var viewModel = new ToggleViewModel(isChecked: true);
        int changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.IsChecked = true;

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_size_assignment_notifies()
    {
        var viewModel = new ToggleViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Size = ToggleSize.Sm;

        Assert.Equal(ToggleSize.Sm, viewModel.Size);
        Assert.Contains(nameof(ToggleViewModel.Size), changed);
    }

    [Fact]
    public void ViewModel_label_assignment_notifies()
    {
        var viewModel = new ToggleViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Label = "Sentry mode";

        Assert.Equal("Sentry mode", viewModel.Label);
        Assert.Contains(nameof(ToggleViewModel.Label), changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label or value) ───────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ToggleDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Toggle", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ToggleDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
