using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RangeSlider surface's UI-thread-free logic — the registration metadata (slug,
/// thumb automation ids, the web <c>step = 1</c> / <c>showLabel = true</c> defaults, the thumb-label i18n keys),
/// the pure <see cref="RangeSliderMath"/> swap + percentage helpers, the <see cref="RangeSliderProjection"/>
/// adapter (display formatting, the "low – high" readout, per-thumb accessible names with label interpolation, fill
/// percentages and the low-on-top z-order), the <see cref="RangeSliderViewModel"/> state holder (controlled value
/// pushes vs. user thumb edits with the web thumb-swap and the <c>onChange</c> event, minimal change notification)
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/ui/RangeSlider.tsx). The
/// WinUI view (shared-surfaces/RangeSlider.cs, which lays out the label row + rail + range fill + two Slider
/// thumbs) is exercised by the app build. Because the component reads no network data, there is no loading / error
/// / stale / offline state; the reproduced render branches are the visible-label row, the disabled state and the
/// thumb-swap / z-order behaviour, verified through the projection per state below.
/// </summary>
public sealed class RangeSliderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static string Bracket(double n) => $"<{n.ToString(CultureInfo.InvariantCulture)}>";

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("RangeSlider", RangeSliderRegistration.Slug);

    [Fact]
    public void Registration_exposes_the_thumb_automation_ids()
    {
        Assert.Equal("range-slider", RangeSliderRegistration.RootAutomationId);
        Assert.Equal("range-slider-low", RangeSliderRegistration.LowThumbAutomationId);
        Assert.Equal("range-slider-high", RangeSliderRegistration.HighThumbAutomationId);
    }

    [Fact]
    public void Registration_defaults_match_the_web_source()
    {
        Assert.Equal(1.0, RangeSliderRegistration.DefaultStep);
        Assert.True(RangeSliderRegistration.ShowLabelDefault);
    }

    [Fact]
    public void Registration_thumb_label_keys_match_the_web_and_catalog()
    {
        // web t('slider.thumbMin', '{{label}} minimum') / t('slider.thumbMax', '{{label}} maximum');
        // the WinUI catalog stores the keys with the translation. prefix and the .NET positional token {0}.
        Assert.Equal("translation.slider.thumbMin", RangeSliderRegistration.MinThumbLabelKey);
        Assert.Equal("translation.slider.thumbMax", RangeSliderRegistration.MaxThumbLabelKey);
        Assert.Equal("{0} minimum", RangeSliderRegistration.MinThumbLabelFallback);
        Assert.Equal("{0} maximum", RangeSliderRegistration.MaxThumbLabelFallback);
    }

    // ── pure math: step coercion ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(2.0, 2.0)]
    [InlineData(0.5, 0.5)]
    [InlineData(0.0, 1.0)]
    [InlineData(-5.0, 1.0)]
    [InlineData(double.NaN, 1.0)]
    public void SafeStep_coerces_to_a_positive_increment(double step, double expected) =>
        Assert.Equal(expected, RangeSliderMath.SafeStep(step));

    [Theory]
    [InlineData(0.0, 100.0, 1.0, 10.0)] // ~10% of the range
    [InlineData(0.0, 5.0, 1.0, 1.0)]    // 10% (0.5) is below the step → at least the step
    [InlineData(0.0, 0.0, 1.0, 1.0)]    // degenerate range → at least the safe step
    [InlineData(0.0, 200.0, 0.0, 20.0)] // non-positive step is coerced to 1 first, 10% wins
    public void LargeStep_is_about_ten_percent_but_never_below_the_step(double min, double max, double step, double expected) =>
        Assert.Equal(expected, RangeSliderMath.LargeStep(min, max, step));

    // ── pure math: fill percentages ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(20.0, 0.0, 100.0, 0.0, 20.0)]
    [InlineData(80.0, 0.0, 100.0, 100.0, 80.0)]
    [InlineData(-10.0, 0.0, 100.0, 0.0, 0.0)]   // clamp below 0
    [InlineData(150.0, 0.0, 100.0, 0.0, 100.0)] // clamp above 100
    [InlineData(50.0, 0.0, 0.0, 0.0, 0.0)]      // degenerate range → low default
    [InlineData(50.0, 0.0, 0.0, 100.0, 100.0)]  // degenerate range → high default
    public void Percent_maps_value_into_0_to_100(double value, double min, double max, double degenerate, double expected) =>
        Assert.Equal(expected, RangeSliderMath.Percent(value, min, max, degenerate));

    // ── pure math: thumb-swap (web handleLowChange / handleHighChange) ─────────────────────────────────────

    [Fact]
    public void ApplyLowChange_keeps_the_pair_sorted_without_a_swap()
    {
        var result = RangeSliderMath.ApplyLowChange(new RangeSliderValue(20, 80), 50);
        Assert.Equal(new RangeSliderValue(50, 80), result);
    }

    [Fact]
    public void ApplyLowChange_swaps_when_the_low_thumb_is_dragged_past_the_high()
    {
        // web: next > high → onChange([high, next]).
        var result = RangeSliderMath.ApplyLowChange(new RangeSliderValue(20, 80), 90);
        Assert.Equal(new RangeSliderValue(80, 90), result);
    }

    [Fact]
    public void ApplyHighChange_keeps_the_pair_sorted_without_a_swap()
    {
        var result = RangeSliderMath.ApplyHighChange(new RangeSliderValue(20, 80), 50);
        Assert.Equal(new RangeSliderValue(20, 50), result);
    }

    [Fact]
    public void ApplyHighChange_swaps_when_the_high_thumb_is_dragged_below_the_low()
    {
        // web: next < low → onChange([next, low]).
        var result = RangeSliderMath.ApplyHighChange(new RangeSliderValue(20, 80), 10);
        Assert.Equal(new RangeSliderValue(10, 20), result);
    }

    // ── projection adapter (web body) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_formats_each_thumb_and_the_readout_with_the_default_formatter()
    {
        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);

        Assert.Equal(20, projection.Low);
        Assert.Equal(80, projection.High);
        Assert.Equal("20", projection.DisplayLow);
        Assert.Equal("80", projection.DisplayHigh);
        Assert.Equal("20 \u2013 80", projection.RangeText);
    }

    [Fact]
    public void Projection_uses_the_caller_formatter_for_display_and_readout()
    {
        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", Bracket, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);

        Assert.Equal("<20>", projection.DisplayLow);
        Assert.Equal("<80>", projection.DisplayHigh);
        Assert.Equal("<20> \u2013 <80>", projection.RangeText);
    }

    [Fact]
    public void Projection_resolves_the_thumb_names_through_the_localizer_with_the_label()
    {
        var localizer = new RecordingLocalizer();

        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, localizer);

        Assert.Equal("Speed minimum", projection.AriaLow);
        Assert.Equal("Speed maximum", projection.AriaHigh);
        Assert.Contains(RangeSliderRegistration.MinThumbLabelKey, localizer.RequestedKeys);
        Assert.Contains(RangeSliderRegistration.MaxThumbLabelKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Projection_prefers_explicit_thumb_label_overrides()
    {
        var localizer = new RecordingLocalizer();

        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: "Lower bound", maxThumbLabel: "Upper bound", showLabel: true, disabled: false, localizer);

        Assert.Equal("Lower bound", projection.AriaLow);
        Assert.Equal("Upper bound", projection.AriaHigh);

        // The overrides short-circuit the i18n lookups (web minThumbLabel ?? t(...)).
        Assert.DoesNotContain(RangeSliderRegistration.MinThumbLabelKey, localizer.RequestedKeys);
        Assert.DoesNotContain(RangeSliderRegistration.MaxThumbLabelKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Projection_computes_the_fill_percentages_and_z_order()
    {
        var low = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);
        Assert.Equal(20.0, low.LowPercent);
        Assert.Equal(80.0, low.HighPercent);
        Assert.False(low.LowOnTop); // 20% is left of the midpoint

        var highLow = RangeSliderProjection.Project(
            new RangeSliderValue(60, 90), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);
        Assert.True(highLow.LowOnTop); // 60% is right of the midpoint
    }

    [Fact]
    public void Projection_handles_a_degenerate_range()
    {
        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(5, 5), 10, 10, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);

        // web: range <= 0 → lowPct 0, highPct 100.
        Assert.Equal(0.0, projection.LowPercent);
        Assert.Equal(100.0, projection.HighPercent);
    }

    [Fact]
    public void Projection_carries_the_show_label_and_disabled_branches()
    {
        var shown = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);
        Assert.True(shown.ShowLabel);
        Assert.False(shown.Disabled);

        var hidden = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: false, disabled: true, Localizer);
        Assert.False(hidden.ShowLabel);
        Assert.True(hidden.Disabled);
    }

    [Fact]
    public void Projection_is_pure_and_value_equal_for_identical_inputs()
    {
        var a = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);
        var b = RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);
        var different = RangeSliderProjection.Project(
            new RangeSliderValue(30, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => RangeSliderProjection.Project(
            new RangeSliderValue(20, 80), 0, 100, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel: true, disabled: false, localizer: null!));

    // ── per-state "snapshot": each render state projects an exact, stable shape ────────────────────────────

    [Theory]
    [InlineData(20.0, 80.0, 0.0, 100.0, true, false, "20", "80", "20 \u2013 80", 20.0, 80.0, false)]
    [InlineData(0.0, 100.0, 0.0, 100.0, true, false, "0", "100", "0 \u2013 100", 0.0, 100.0, false)]
    [InlineData(60.0, 90.0, 0.0, 100.0, false, true, "60", "90", "60 \u2013 90", 60.0, 90.0, true)]
    [InlineData(25.0, 75.0, 0.0, 200.0, true, false, "25", "75", "25 \u2013 75", 12.5, 37.5, false)]
    public void Projection_snapshot_per_state(
        double low,
        double high,
        double min,
        double max,
        bool showLabel,
        bool disabled,
        string expectedDisplayLow,
        string expectedDisplayHigh,
        string expectedRangeText,
        double expectedLowPercent,
        double expectedHighPercent,
        bool expectedLowOnTop)
    {
        var projection = RangeSliderProjection.Project(
            new RangeSliderValue(low, high), min, max, "Speed", formatValue: null, minThumbLabel: null, maxThumbLabel: null, showLabel, disabled, Localizer);

        Assert.Equal(expectedDisplayLow, projection.DisplayLow);
        Assert.Equal(expectedDisplayHigh, projection.DisplayHigh);
        Assert.Equal(expectedRangeText, projection.RangeText);
        Assert.Equal(expectedLowPercent, projection.LowPercent);
        Assert.Equal(expectedHighPercent, projection.HighPercent);
        Assert.Equal(expectedLowOnTop, projection.LowOnTop);
        Assert.Equal(showLabel, projection.ShowLabel);
        Assert.Equal(disabled, projection.Disabled);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("RangeSlider", RangeSliderViewModel.Slug);

    [Fact]
    public void ViewModel_default_is_zero_metric_full_range_and_enabled()
    {
        var viewModel = new RangeSliderViewModel(Localizer);

        Assert.Equal(new RangeSliderValue(0, 0), viewModel.Value);
        Assert.Equal(0, viewModel.Min);
        Assert.Equal(100, viewModel.Max);
        Assert.Equal(1, viewModel.Step);
        Assert.True(viewModel.ShowLabel);
        Assert.True(viewModel.IsEnabled);
    }

    [Fact]
    public void ViewModel_constructed_with_a_value_projects_it()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80), label: "Speed");

        Assert.Equal("20", viewModel.DisplayLow);
        Assert.Equal("80", viewModel.DisplayHigh);
        Assert.Equal("20 \u2013 80", viewModel.RangeText);
        Assert.Equal("Speed minimum", viewModel.AriaLow);
        Assert.Equal("Speed maximum", viewModel.AriaHigh);
    }

    [Fact]
    public void ViewModel_request_low_without_swap_updates_value_and_raises_change()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        var commits = new List<RangeSliderValue>();
        viewModel.ValueChanged += (_, v) => commits.Add(v);

        viewModel.RequestLow(50);

        Assert.Equal(new RangeSliderValue(50, 80), viewModel.Value);
        Assert.Equal(new RangeSliderValue(50, 80), Assert.Single(commits));
        Assert.Contains(nameof(RangeSliderViewModel.Projection), changed);
        Assert.Contains(nameof(RangeSliderViewModel.DisplayLow), changed);
        Assert.Contains(nameof(RangeSliderViewModel.RangeText), changed);
    }

    [Fact]
    public void ViewModel_request_low_past_high_swaps_and_emits_a_sorted_tuple()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var commits = new List<RangeSliderValue>();
        viewModel.ValueChanged += (_, v) => commits.Add(v);

        viewModel.RequestLow(90);

        Assert.Equal(new RangeSliderValue(80, 90), viewModel.Value);
        Assert.Equal(new RangeSliderValue(80, 90), Assert.Single(commits));
    }

    [Fact]
    public void ViewModel_request_high_below_low_swaps_and_emits_a_sorted_tuple()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var commits = new List<RangeSliderValue>();
        viewModel.ValueChanged += (_, v) => commits.Add(v);

        viewModel.RequestHigh(10);

        Assert.Equal(new RangeSliderValue(10, 20), viewModel.Value);
        Assert.Equal(new RangeSliderValue(10, 20), Assert.Single(commits));
    }

    [Fact]
    public void ViewModel_request_ignores_non_finite_values()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var commits = 0;
        viewModel.ValueChanged += (_, _) => commits++;

        viewModel.RequestLow(double.NaN);
        viewModel.RequestHigh(double.NaN);

        Assert.Equal(new RangeSliderValue(20, 80), viewModel.Value);
        Assert.Equal(0, commits);
    }

    [Fact]
    public void ViewModel_controlled_value_set_reprojects_without_raising_change()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        var commits = 0;
        viewModel.ValueChanged += (_, _) => commits++;

        viewModel.Value = new RangeSliderValue(10, 40);

        Assert.Equal("10", viewModel.DisplayLow);
        Assert.Equal("40", viewModel.DisplayHigh);
        Assert.Contains(nameof(RangeSliderViewModel.Projection), changed);
        Assert.Equal(0, commits); // the controlled echo must not re-enter onChange
    }

    [Fact]
    public void ViewModel_value_set_is_a_no_op_for_an_unchanged_pair()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;
        var commits = 0;
        viewModel.ValueChanged += (_, _) => commits++;

        viewModel.Value = new RangeSliderValue(20, 80);

        Assert.Equal(0, changes);
        Assert.Equal(0, commits);
    }

    [Fact]
    public void ViewModel_changing_bounds_reprojects_the_percentages()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        Assert.Equal(20.0, viewModel.LowPercent);

        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Max = 200;

        Assert.Equal(10.0, viewModel.LowPercent);
        Assert.Equal(40.0, viewModel.HighPercent);
        Assert.Contains(nameof(RangeSliderViewModel.Max), changed);
        Assert.Contains(nameof(RangeSliderViewModel.Projection), changed);
        Assert.Contains(nameof(RangeSliderViewModel.LowPercent), changed);
    }

    [Fact]
    public void ViewModel_changing_format_value_reprojects_the_display()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        Assert.Equal("20", viewModel.DisplayLow);

        viewModel.FormatValue = Bracket;

        Assert.Equal("<20>", viewModel.DisplayLow);
        Assert.Equal("<20> \u2013 <80>", viewModel.RangeText);
    }

    [Fact]
    public void ViewModel_changing_min_thumb_label_reprojects_the_name()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80), label: "Speed");
        Assert.Equal("Speed minimum", viewModel.AriaLow);

        viewModel.MinThumbLabel = "Lower bound";

        Assert.Equal("Lower bound", viewModel.AriaLow);
    }

    [Fact]
    public void ViewModel_changing_label_reprojects_the_names()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80), label: "Speed");

        viewModel.Label = "Power";

        Assert.Equal("Power minimum", viewModel.AriaLow);
        Assert.Equal("Power maximum", viewModel.AriaHigh);
    }

    [Fact]
    public void ViewModel_toggling_show_label_raises_the_change()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.ShowLabel = false;

        Assert.False(viewModel.Projection.ShowLabel);
        Assert.Contains(nameof(RangeSliderViewModel.ShowLabel), changed);
        Assert.Contains(nameof(RangeSliderViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_disabling_flips_is_enabled()
    {
        var viewModel = new RangeSliderViewModel(Localizer, new RangeSliderValue(20, 80));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Disabled = true;

        Assert.False(viewModel.IsEnabled);
        Assert.True(viewModel.Projection.Disabled);
        Assert.Contains(nameof(RangeSliderViewModel.Disabled), changed);
        Assert.Contains(nameof(RangeSliderViewModel.IsEnabled), changed);
    }

    [Fact]
    public void ViewModel_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new RangeSliderViewModel(localizer: null!));

    // ── diagnostics (view.opened, PII-safe — only the slug, never the values) ─────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RangeSliderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RangeSlider", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new RangeSliderDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
