using TeslaSync.App.Core.Charts;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ProgressRing surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the web prop defaults), the pure <see cref="ProgressRingProjection"/> adapter (radius / centre
/// / circumference geometry, value clamp + sanitisation, swept fraction and stroke-dash offset, size / stroke
/// fallbacks, proportional centre fonts, the render-branch flags and the composed accessible name), the
/// <see cref="ProgressRingViewModel"/> state holder (initial projection + per-prop re-projection / notification)
/// and the PII-safe diagnostics. Mirrors the web spec (web/src/components/data-display/ProgressRing.tsx). The
/// WinUI view (shared-surfaces/ProgressRing.cs) is exercised by the app build. Because the component reads no
/// network data, there is no loading / error / stale / offline state; the reproduced render branches are the
/// with/without centred main readout, the with/without centred sub readout and the with/without caption, across
/// the value-clamp range — and the ring always renders (positive radius, named gauge) so the surface is never a
/// blank box.
/// </summary>
public sealed class ProgressRingTests
{
    private const double DefaultCircumference = 2.0 * Math.PI * 22.0; // size 48, stroke 4 -> radius 22.

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ProgressRing", ProgressRingRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("progress-ring", ProgressRingRegistration.RootAutomationId);

    [Fact]
    public void Prop_defaults_match_the_web_source()
    {
        // web: max = 100, size = 48, strokeWidth = 4.
        Assert.Equal(100.0, ProgressRingRegistration.DefaultMax);
        Assert.Equal(48.0, ProgressRingRegistration.DefaultSize);
        Assert.Equal(4.0, ProgressRingRegistration.DefaultStrokeWidth);
        Assert.Equal(0, ProgressRingRegistration.DefaultColorIndex);
    }

    // ── geometry (web: radius = (size - strokeWidth) / 2; center = size / 2; circ = 2 * PI * radius) ───────

    [Fact]
    public void Project_computes_radius_center_and_circumference_from_size_and_stroke()
    {
        var projection = ProgressRingProjection.Project(0, size: 48, strokeWidth: 4);

        Assert.Equal(22.0, projection.Radius);
        Assert.Equal(24.0, projection.Center);
        Assert.Equal(DefaultCircumference, projection.Circumference, 9);
        Assert.Equal(48.0, projection.Size);
        Assert.Equal(4.0, projection.StrokeWidth);
    }

    [Fact]
    public void Project_geometry_is_independent_of_the_value()
    {
        var empty = ProgressRingProjection.Project(0, size: 48, strokeWidth: 4);
        var full = ProgressRingProjection.Project(100, size: 48, strokeWidth: 4);

        Assert.Equal(empty.Radius, full.Radius);
        Assert.Equal(empty.Center, full.Center);
        Assert.Equal(empty.Circumference, full.Circumference);
    }

    // ── value clamp + fraction + dash offset (web: clamped = max(0, min(value, max)); offset = circ - frac*circ)

    [Theory]
    [InlineData(150, 100, 100, 1.0)] // above max clamps to max -> full sweep
    [InlineData(-5, 100, 0, 0.0)]    // negative clamps to zero -> empty sweep
    [InlineData(72, 100, 72, 0.72)]  // in range passes through
    [InlineData(25, 50, 25, 0.5)]    // arbitrary max
    public void Project_clamps_value_and_derives_fraction(double value, double max, double expectedValue, double expectedFraction)
    {
        var projection = ProgressRingProjection.Project(value, max);

        Assert.Equal(expectedValue, projection.Value);
        Assert.Equal(expectedFraction, projection.Fraction, 10);
    }

    [Fact]
    public void Project_dash_offset_is_the_unswept_remainder_of_the_circumference()
    {
        var projection = ProgressRingProjection.Project(72, 100, size: 48, strokeWidth: 4);

        Assert.Equal(projection.Circumference * (1.0 - 0.72), projection.DashOffset, 9);
    }

    [Fact]
    public void Project_full_value_has_a_zero_dash_offset()
    {
        var projection = ProgressRingProjection.Project(100, 100);

        Assert.Equal(1.0, projection.Fraction, 10);
        Assert.Equal(0.0, projection.DashOffset, 9);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Project_sanitizes_non_finite_values_to_an_empty_ring(double value)
    {
        var projection = ProgressRingProjection.Project(value, 100);

        Assert.Equal(0.0, projection.Value);
        Assert.Equal(0.0, projection.Fraction);
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-10.0)]
    public void Project_with_nonpositive_max_yields_an_empty_but_drawn_ring(double max)
    {
        var projection = ProgressRingProjection.Project(42, max, size: 48, strokeWidth: 4);

        Assert.Equal(0.0, projection.Max);
        Assert.Equal(0.0, projection.Fraction);
        Assert.Equal(0.0, projection.Value);

        // Geometry still resolves so the track renders — never a blank box.
        Assert.Equal(22.0, projection.Radius);
    }

    // ── size / stroke fallbacks (never-blank, never-degenerate) ────────────────────────────────────────────

    [Theory]
    [InlineData(0.0)]
    [InlineData(-5.0)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void Project_falls_back_to_the_default_size_for_a_nonpositive_or_non_finite_size(double size)
    {
        var projection = ProgressRingProjection.Project(50, 100, size: size);

        Assert.Equal(ProgressRingRegistration.DefaultSize, projection.Size);
    }

    [Theory]
    [InlineData(-1.0)]
    [InlineData(double.NaN)]
    public void Project_falls_back_to_the_default_stroke_for_a_negative_or_non_finite_stroke(double strokeWidth)
    {
        var projection = ProgressRingProjection.Project(50, 100, size: 48, strokeWidth: strokeWidth);

        Assert.Equal(ProgressRingRegistration.DefaultStrokeWidth, projection.StrokeWidth);
    }

    [Fact]
    public void Project_clamps_the_stroke_within_the_diameter()
    {
        var projection = ProgressRingProjection.Project(50, 100, size: 48, strokeWidth: 100);

        Assert.Equal(48.0, projection.StrokeWidth);
        Assert.Equal(0.0, projection.Radius);
    }

    // ── proportional centre fonts (web: main = max(10, round(size*0.32)); sub = max(8, round(size*0.18))) ──

    [Theory]
    [InlineData(48, 15, 9)]   // round(15.36)=15 ; round(8.64)=9
    [InlineData(100, 32, 18)] // round(32)=32 ; round(18)=18
    [InlineData(20, 10, 8)]   // round(6.4)=6 -> floored to 10 ; round(3.6)=4 -> floored to 8
    public void Project_sizes_the_centre_fonts_proportionally_with_floors(double size, double expectedMain, double expectedSub)
    {
        var projection = ProgressRingProjection.Project(50, 100, size: size);

        Assert.Equal(expectedMain, projection.MainFontSize);
        Assert.Equal(expectedSub, projection.SubFontSize);
    }

    // ── centre overlay render branches (web: hasCenter = centerLabel != null || centerSubLabel != null) ────

    [Fact]
    public void Project_with_only_a_center_label_shows_the_main_readout()
    {
        var projection = ProgressRingProjection.Project(72, 100, centerLabel: "72");

        Assert.True(projection.HasCenterLabel);
        Assert.False(projection.HasCenterSubLabel);
        Assert.True(projection.HasCenter);
        Assert.Equal("72", projection.CenterLabel);
    }

    [Fact]
    public void Project_with_only_a_center_sub_label_shows_the_sub_readout()
    {
        var projection = ProgressRingProjection.Project(72, 100, centerSubLabel: "kWh");

        Assert.False(projection.HasCenterLabel);
        Assert.True(projection.HasCenterSubLabel);
        Assert.True(projection.HasCenter);
        Assert.Equal("kWh", projection.CenterSubLabel);
    }

    [Fact]
    public void Project_with_both_center_readouts_shows_the_full_overlay()
    {
        var projection = ProgressRingProjection.Project(72, 100, centerLabel: "72", centerSubLabel: "%");

        Assert.True(projection.HasCenterLabel);
        Assert.True(projection.HasCenterSubLabel);
        Assert.True(projection.HasCenter);
    }

    [Fact]
    public void Project_with_no_center_readouts_hides_the_overlay()
    {
        var projection = ProgressRingProjection.Project(72, 100);

        Assert.False(projection.HasCenterLabel);
        Assert.False(projection.HasCenterSubLabel);
        Assert.False(projection.HasCenter);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Project_treats_blank_center_readouts_as_absent(string? blank)
    {
        var projection = ProgressRingProjection.Project(72, 100, centerLabel: blank, centerSubLabel: blank);

        Assert.False(projection.HasCenterLabel);
        Assert.False(projection.HasCenterSubLabel);
        Assert.False(projection.HasCenter);
    }

    // ── caption branch (web: label && <span>) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Project_with_a_label_shows_the_caption()
    {
        var projection = ProgressRingProjection.Project(72, 100, label: "State of charge");

        Assert.True(projection.HasLabel);
        Assert.Equal("State of charge", projection.Label);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Project_treats_a_blank_label_as_absent(string? blank)
    {
        var projection = ProgressRingProjection.Project(72, 100, label: blank);

        Assert.False(projection.HasLabel);
    }

    // ── percent text + composed accessible name (the web overlay is aria-hidden) ───────────────────────────

    [Theory]
    [InlineData(0, 100, "0%")]
    [InlineData(72, 100, "72%")]
    [InlineData(100, 100, "100%")]
    [InlineData(72.5, 100, "73%")] // 72.5 rounds away from zero
    [InlineData(25, 50, "50%")]
    public void Project_formats_a_whole_number_percent(double value, double max, string expected)
    {
        var projection = ProgressRingProjection.Project(value, max);

        Assert.Equal(expected, projection.PercentText);
    }

    [Fact]
    public void Project_composes_the_name_from_caption_and_center_readouts()
    {
        var projection = ProgressRingProjection.Project(72, 100, centerLabel: "72", centerSubLabel: "%", label: "Battery");

        Assert.Equal("Battery 72 %", projection.AutomationName);
    }

    [Fact]
    public void Project_name_omits_blank_parts()
    {
        var projection = ProgressRingProjection.Project(72, 100, centerLabel: "72");

        Assert.Equal("72", projection.AutomationName);
    }

    [Fact]
    public void Project_name_falls_back_to_the_percent_when_no_text_is_supplied()
    {
        var projection = ProgressRingProjection.Project(72, 100);

        Assert.Equal("72%", projection.AutomationName);
    }

    [Fact]
    public void Project_zero_value_still_renders_a_named_ring_never_blank()
    {
        var projection = ProgressRingProjection.Project(0, 100);

        Assert.True(projection.Size > 0);
        Assert.True(projection.Radius > 0);
        Assert.False(string.IsNullOrWhiteSpace(projection.AutomationName));
        Assert.Equal("0%", projection.AutomationName);
    }

    // ── token-driven arc colour (replaces the web color hex) ───────────────────────────────────────────────

    [Fact]
    public void Project_passes_through_role_and_color_index()
    {
        var projection = ProgressRingProjection.Project(72, 100, role: ChartRole.Battery, colorIndex: 3);

        Assert.Equal(ChartRole.Battery, projection.Role);
        Assert.Equal(3, projection.ColorIndex);
    }

    [Fact]
    public void Project_defaults_the_arc_to_the_first_categorical_index()
    {
        var projection = ProgressRingProjection.Project(72, 100);

        Assert.Equal(ChartRole.None, projection.Role);
        Assert.Equal(ProgressRingRegistration.DefaultColorIndex, projection.ColorIndex);
    }

    // ── per-state "snapshot": each render state projects an exact, stable shape ─────────────────────────────

    [Theory]
    [InlineData(0, 100, null, null, null, false, false, "0%", 0.0)]
    [InlineData(72, 100, "72", "%", null, true, false, "72 %", 0.72)]
    [InlineData(100, 100, "100", null, "SOC", true, true, "SOC 100", 1.0)]
    [InlineData(150, 100, null, null, "Done", false, true, "Done", 1.0)]
    [InlineData(-5, 100, null, null, null, false, false, "0%", 0.0)]
    [InlineData(25, 50, "Half", null, null, true, false, "Half", 0.5)]
    public void Project_snapshot_per_state(
        double value,
        double max,
        string? centerLabel,
        string? centerSubLabel,
        string? label,
        bool expectedHasCenter,
        bool expectedHasLabel,
        string expectedName,
        double expectedFraction)
    {
        var projection = ProgressRingProjection.Project(value, max, centerLabel: centerLabel, centerSubLabel: centerSubLabel, label: label);

        Assert.Equal(expectedHasCenter, projection.HasCenter);
        Assert.Equal(expectedHasLabel, projection.HasLabel);
        Assert.Equal(expectedName, projection.AutomationName);
        Assert.Equal(expectedFraction, projection.Fraction, 10);
    }

    [Fact]
    public void Project_value_equality_makes_identical_states_equal()
    {
        var a = ProgressRingProjection.Project(72, 100, centerLabel: "72", label: "Battery");
        var b = ProgressRingProjection.Project(72, 100, centerLabel: "72", label: "Battery");
        var different = ProgressRingProjection.Project(73, 100, centerLabel: "72", label: "Battery");

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("ProgressRing", ProgressRingViewModel.Slug);

    [Fact]
    public void ViewModel_projects_on_construction_with_the_web_defaults()
    {
        var viewModel = new ProgressRingViewModel(72);

        Assert.Equal(72, viewModel.Value);
        Assert.Equal(100.0, viewModel.Max);
        Assert.Equal(48.0, viewModel.Size);
        Assert.Equal(4.0, viewModel.StrokeWidth);
        Assert.Equal(0.72, viewModel.Projection.Fraction, 10);
    }

    [Fact]
    public void ViewModel_set_value_reprojects_and_notifies()
    {
        var viewModel = new ProgressRingViewModel(0);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Value = 72;

        Assert.Equal(0.72, viewModel.Projection.Fraction, 10);
        Assert.Contains(nameof(ProgressRingViewModel.Value), changed);
        Assert.Contains(nameof(ProgressRingViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_set_value_is_a_no_op_for_an_unchanged_value()
    {
        var viewModel = new ProgressRingViewModel(42);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.Value = 42;

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_center_label_reprojects_and_notifies()
    {
        var viewModel = new ProgressRingViewModel(72);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.CenterLabel = "72";

        Assert.True(viewModel.Projection.HasCenterLabel);
        Assert.Equal("72", viewModel.Projection.CenterLabel);
        Assert.Contains(nameof(ProgressRingViewModel.CenterLabel), changed);
        Assert.Contains(nameof(ProgressRingViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_set_max_reprojects()
    {
        var viewModel = new ProgressRingViewModel(25);
        Assert.Equal(0.25, viewModel.Projection.Fraction, 10);

        viewModel.Max = 50;

        Assert.Equal(0.5, viewModel.Projection.Fraction, 10);
    }

    [Fact]
    public void ViewModel_set_role_and_color_index_reproject()
    {
        var viewModel = new ProgressRingViewModel(72);

        viewModel.Role = ChartRole.Battery;
        viewModel.ColorIndex = 4;

        Assert.Equal(ChartRole.Battery, viewModel.Projection.Role);
        Assert.Equal(4, viewModel.Projection.ColorIndex);
    }

    [Fact]
    public void ViewModel_set_caption_reprojects()
    {
        var viewModel = new ProgressRingViewModel(72);

        viewModel.Label = "State of charge";

        Assert.True(viewModel.Projection.HasLabel);
        Assert.Equal("State of charge", viewModel.Projection.Label);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ProgressRingDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ProgressRing", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new ProgressRingDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new ProgressRingDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(ProgressRingRegistration.Slug, line, StringComparison.Ordinal);
    }
}
