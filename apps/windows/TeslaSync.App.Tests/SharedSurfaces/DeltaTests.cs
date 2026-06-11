using System.Collections.Generic;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Delta</c> shared surface's UI-thread-free logic — the metric-semantics
/// registry + resolver, the unit-label resolution, the pure projection (every display mode, the loading /
/// empty / value branches, the direction-aware colour + arrow, the unsigned magnitude and the localized
/// strings), the data seam's change notifications, the view-model's state projection, the PII-safe diagnostics
/// and the registration metadata. The numeric cases mirror the web spec
/// (web/src/components/data-display/Delta.tsx + Delta.test.tsx) one-for-one. The WinUI view itself (the inline
/// chip, arrow glyph, skeleton and brushes) is exercised by the app build.
/// </summary>
public sealed class DeltaTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Mirrors the web Delta.test.tsx baseSettings: miles, °C, bar, "$", precision 1, en-US.
    private static DeltaUnitContext Ctx(DistanceUnit distance = DistanceUnit.Mi, string currency = "$") =>
        new(
            distance,
            distance == DistanceUnit.Mi ? SpeedUnit.Mph : SpeedUnit.Kmh,
            TemperatureUnit.Celsius,
            PressureUnit.Bar,
            currency,
            "en-US",
            1);

    private static DeltaInput Input(
        string metricId,
        double? current,
        double? previous,
        DeltaDisplayMode display = DeltaDisplayMode.Percent,
        string? comparedTo = null,
        bool hideArrow = false,
        bool loading = false) =>
        new()
        {
            Metric = DeltaMetrics.Resolve(metricId),
            Current = current,
            Previous = previous,
            Display = display,
            ComparedTo = comparedTo,
            HideArrow = hideArrow,
            Loading = loading,
        };

    private static DeltaDisplay Project(DeltaInput input, DeltaUnitContext? ctx = null) =>
        DeltaProjection.Project(input, ctx ?? Ctx(), Localizer);

    // ── Colour by direction (web Delta.test.tsx "colour by direction") ───────────────────────────────────

    [Fact]
    public void LowerBetter_increase_is_negative_rose()
    {
        var d = Project(Input("cost", 12, 10, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Negative, d.Tone);
        Assert.Equal("TsColorDangerBrush", d.AccentBrushKey);
    }

    [Fact]
    public void LowerBetter_decrease_is_positive_emerald()
    {
        var d = Project(Input("cost", 8, 10, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Positive, d.Tone);
        Assert.Equal("TsColorSuccessBrush", d.AccentBrushKey);
    }

    [Fact]
    public void HigherBetter_increase_is_positive_emerald()
    {
        var d = Project(Input("range", 280, 250, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Positive, d.Tone);
        Assert.Equal("TsColorSuccessBrush", d.AccentBrushKey);
    }

    [Fact]
    public void HigherBetter_decrease_is_negative_rose()
    {
        var d = Project(Input("range", 220, 250, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Negative, d.Tone);
        Assert.Equal("TsColorDangerBrush", d.AccentBrushKey);
    }

    [Fact]
    public void Neutral_metric_is_never_good_or_bad()
    {
        var d = Project(Input("distance", 200, 100, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Neutral, d.Tone);
        Assert.Equal("TsColorTextSecondaryBrush", d.AccentBrushKey);
    }

    [Fact]
    public void Zero_delta_is_muted()
    {
        var d = Project(Input("cost", 10, 10, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaTone.Muted, d.Tone);
        Assert.Equal("TsColorTextMutedBrush", d.AccentBrushKey);
    }

    // ── Arrow (web Delta.test.tsx "arrow") ───────────────────────────────────────────────────────────────

    [Fact]
    public void Positive_delta_renders_an_up_arrow()
    {
        var d = Project(Input("range", 280, 250));

        Assert.Equal(DeltaArrow.Up, d.Arrow);
        Assert.True(d.HasArrow);
    }

    [Fact]
    public void Negative_delta_renders_a_down_arrow() =>
        Assert.Equal(DeltaArrow.Down, Project(Input("range", 220, 250)).Arrow);

    [Fact]
    public void Zero_delta_renders_a_flat_arrow() =>
        Assert.Equal(DeltaArrow.Flat, Project(Input("range", 250, 250)).Arrow);

    [Fact]
    public void HideArrow_suppresses_the_arrow()
    {
        var d = Project(Input("range", 280, 250, hideArrow: true));

        Assert.False(d.HasArrow);
        Assert.Equal(DeltaState.Value, d.State);
    }

    // ── Value formatting (web Delta.test.tsx "value formatting") ─────────────────────────────────────────

    [Fact]
    public void Percent_is_the_default_and_unsigned()
    {
        var d = Project(Input("cost", 12, 10));

        Assert.Equal("20.0%", d.PrimaryText);
        Assert.DoesNotContain("-", d.PrimaryText, StringComparison.Ordinal);
    }

    [Fact]
    public void Absolute_renders_the_currency_prefix()
    {
        var d = Project(Input("cost", 12, 10, DeltaDisplayMode.Absolute));

        Assert.Equal("$2.0", d.PrimaryText);
    }

    [Fact]
    public void Both_renders_absolute_then_percent_in_parens()
    {
        var d = Project(Input("range", 280, 250, DeltaDisplayMode.Both));

        Assert.Equal("30.0 mi", d.PrimaryText);
        Assert.Equal("(12.0%)", d.SecondaryText);
        Assert.True(d.HasSecondaryText);
    }

    [Fact]
    public void ComparedTo_is_carried_through_and_appended_to_the_accessible_name()
    {
        var d = Project(Input("cost", 12, 10, comparedTo: "vs last week"));

        Assert.Equal("vs last week", d.ComparedTo);
        Assert.True(d.HasComparedTo);
        Assert.Contains("vs last week", d.AccessibleName, StringComparison.Ordinal);
    }

    // ── Edge cases (web Delta.test.tsx "edge cases") ─────────────────────────────────────────────────────

    [Fact]
    public void Null_previous_renders_the_empty_em_dash()
    {
        var d = Project(Input("cost", 12, null));

        Assert.Equal(DeltaState.Empty, d.State);
        Assert.True(d.IsEmpty);
        Assert.Equal(DeltaDisplay.EmDash, d.PrimaryText);
        Assert.False(d.HasArrow);
    }

    [Fact]
    public void Null_current_renders_the_empty_em_dash()
    {
        var d = Project(Input("cost", null, 10));

        Assert.Equal(DeltaState.Empty, d.State);
        Assert.Equal(DeltaDisplay.EmDash, d.PrimaryText);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void NonFinite_inputs_render_the_empty_em_dash(double bad)
    {
        var d = Project(Input("cost", bad, 10));

        Assert.Equal(DeltaState.Empty, d.State);
        Assert.Equal(DeltaDisplay.EmDash, d.PrimaryText);
    }

    [Fact]
    public void Previous_zero_percent_is_an_em_dash_without_infinity()
    {
        var d = Project(Input("cost", 12, 0, DeltaDisplayMode.Percent));

        // Still the populated branch (both inputs finite), but the percent is undefined → em-dash.
        Assert.Equal(DeltaState.Value, d.State);
        Assert.Equal(DeltaDisplay.EmDash, d.PrimaryText);
        Assert.DoesNotContain("Infinity", d.PrimaryText, StringComparison.Ordinal);
        Assert.DoesNotContain("NaN", d.PrimaryText, StringComparison.Ordinal);
    }

    [Fact]
    public void Previous_zero_absolute_still_renders_the_change()
    {
        var d = Project(Input("cost", 12, 0, DeltaDisplayMode.Absolute));

        Assert.Equal(DeltaState.Value, d.State);
        Assert.Equal("$12.0", d.PrimaryText);
    }

    [Fact]
    public void Loading_renders_the_skeleton_state()
    {
        var d = Project(Input("cost", 12, 10, loading: true));

        Assert.Equal(DeltaState.Loading, d.State);
        Assert.True(d.IsLoading);
        Assert.False(d.HasArrow);
    }

    [Fact]
    public void Loading_takes_precedence_over_missing_inputs()
    {
        var d = Project(Input("cost", null, null, loading: true));

        Assert.Equal(DeltaState.Loading, d.State);
    }

    // ── Settings-aware unit suffixes (web Delta.test.tsx "settings-aware unit suffixes") ──────────────────

    [Fact]
    public void Uses_the_metric_distance_unit_from_the_context()
    {
        var d = Project(Input("range", 280, 250, DeltaDisplayMode.Absolute), Ctx(DistanceUnit.Km));

        Assert.Equal("30.0 km", d.PrimaryText);
    }

    [Fact]
    public void Uses_the_user_currency_symbol()
    {
        var d = Project(Input("cost", 12, 10, DeltaDisplayMode.Absolute), Ctx(currency: "\u20AC"));

        Assert.Equal("\u20AC2.0", d.PrimaryText);
    }

    // ── Inline semantic override (web Delta.test.tsx "inline semantic override") ─────────────────────────

    [Fact]
    public void Accepts_an_inline_direction_and_unit()
    {
        var input = new DeltaInput
        {
            Metric = DeltaMetrics.Inline(MetricDirection.HigherBetter, DeltaMetricUnit.Percent),
            Current = 88,
            Previous = 80,
            Display = DeltaDisplayMode.Absolute,
        };

        var d = Project(input);

        Assert.Equal(DeltaTone.Positive, d.Tone);
        Assert.Equal("8.0%", d.PrimaryText);
    }

    // ── Precision override (web precision prop) ──────────────────────────────────────────────────────────

    [Fact]
    public void Precision_override_controls_the_percent_digits()
    {
        var input = Input("cost", 12, 10) with { Precision = 2 };

        Assert.Equal("20.00%", Project(input).PrimaryText);
    }

    // ── Metric registry + resolver (web metricSemantics.ts) ──────────────────────────────────────────────

    [Fact]
    public void Registry_matches_the_web_count() => Assert.Equal(17, DeltaMetrics.Count);

    [Theory]
    [InlineData("cost", MetricDirection.LowerBetter, DeltaMetricUnit.Currency)]
    [InlineData("range", MetricDirection.HigherBetter, DeltaMetricUnit.Miles)]
    [InlineData("regen_pct", MetricDirection.HigherBetter, DeltaMetricUnit.Percent)]
    [InlineData("distance", MetricDirection.Neutral, DeltaMetricUnit.Miles)]
    [InlineData("temperature", MetricDirection.Neutral, DeltaMetricUnit.Celsius)]
    public void Resolve_returns_the_registered_semantic(string id, MetricDirection dir, DeltaMetricUnit unit)
    {
        var semantic = DeltaMetrics.Resolve(id);

        Assert.Equal(id, semantic.Id);
        Assert.Equal(dir, semantic.Direction);
        Assert.Equal(unit, semantic.Unit);
    }

    [Theory]
    [InlineData("not_a_metric")]
    [InlineData("")]
    [InlineData(null)]
    public void Resolve_falls_back_to_a_neutral_unitless_semantic(string? id)
    {
        var semantic = DeltaMetrics.Resolve(id);

        Assert.Equal(MetricDirection.Neutral, semantic.Direction);
        Assert.Equal(DeltaMetricUnit.None, semantic.Unit);
    }

    // ── Unit-label resolution (web useUnitLabels switch) ─────────────────────────────────────────────────

    [Fact]
    public void Currency_resolves_to_a_symbol_prefix()
    {
        var labels = Ctx().ResolveLabels(DeltaMetricUnit.Currency);

        Assert.Equal("$", labels.Prefix);
        Assert.Equal(string.Empty, labels.Suffix);
    }

    [Theory]
    [InlineData(DeltaMetricUnit.Percent, "%")]
    [InlineData(DeltaMetricUnit.KilowattHours, "kWh")]
    [InlineData(DeltaMetricUnit.WattHours, "Wh")]
    [InlineData(DeltaMetricUnit.Hours, "h")]
    [InlineData(DeltaMetricUnit.Minutes, "min")]
    [InlineData(DeltaMetricUnit.Count, "")]
    [InlineData(DeltaMetricUnit.None, "")]
    public void Static_units_resolve_to_their_suffix(DeltaMetricUnit unit, string suffix) =>
        Assert.Equal(suffix, Ctx().ResolveLabels(unit).Suffix);

    [Theory]
    [InlineData(DistanceUnit.Mi, "mi", "mph", "Wh/mi")]
    [InlineData(DistanceUnit.Km, "km", "km/h", "Wh/km")]
    public void Preference_driven_units_follow_the_context(
        DistanceUnit distance,
        string distanceSuffix,
        string speedSuffix,
        string efficiencySuffix)
    {
        var ctx = Ctx(distance);

        Assert.Equal(distanceSuffix, ctx.ResolveLabels(DeltaMetricUnit.Miles).Suffix);
        Assert.Equal(distanceSuffix, ctx.ResolveLabels(DeltaMetricUnit.Kilometres).Suffix);
        Assert.Equal(speedSuffix, ctx.ResolveLabels(DeltaMetricUnit.MilesPerHour).Suffix);
        Assert.Equal(efficiencySuffix, ctx.ResolveLabels(DeltaMetricUnit.WattHoursPerDistance).Suffix);
    }

    [Theory]
    [InlineData(PressureUnit.Bar, "bar")]
    [InlineData(PressureUnit.Kpa, "bar")] // web useUnits only ever yields bar | psi; kPa floors to bar.
    [InlineData(PressureUnit.Psi, "psi")]
    public void Pressure_follows_the_web_bar_psi_derivation(PressureUnit pref, string suffix)
    {
        var ctx = new DeltaUnitContext(DistanceUnit.Km, SpeedUnit.Kmh, TemperatureUnit.Celsius, pref);

        Assert.Equal(suffix, ctx.ResolveLabels(DeltaMetricUnit.Pressure).Suffix);
    }

    // ── Accessibility + tooltip (web title attribute / aria) ─────────────────────────────────────────────

    [Fact]
    public void Value_state_exposes_the_visible_text_as_the_accessible_name()
    {
        var d = Project(Input("range", 280, 250, DeltaDisplayMode.Both, comparedTo: "vs last week"));

        Assert.Equal("30.0 mi (12.0%) vs last week", d.AccessibleName);
    }

    [Fact]
    public void Value_state_tooltip_substitutes_the_title_tokens()
    {
        var d = Project(Input("cost", 12, 10));

        // web title: t('delta.title', '{{current}} vs {{previous}}', { current: fmt(12,2), previous: fmt(10,2) }).
        Assert.Equal("12.00 vs 10.00", d.Title);
    }

    [Fact]
    public void Empty_state_tooltip_and_name_use_the_no_comparison_message()
    {
        var d = Project(Input("cost", null, null, comparedTo: "vs last week"));

        Assert.Equal("No comparison data", d.Title);
        Assert.Equal("No comparison data vs last week", d.AccessibleName);
    }

    [Fact]
    public void Loading_state_has_a_localized_accessible_name()
    {
        var d = Project(Input("cost", 12, 10, loading: true));

        Assert.Equal("Loading\u2026", d.AccessibleName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_accessible_name()
    {
        foreach (var d in new[]
                 {
                     Project(Input("cost", 12, 10)),
                     Project(Input("cost", null, null)),
                     Project(Input("cost", 12, 10, loading: true)),
                 })
        {
            Assert.False(string.IsNullOrWhiteSpace(d.AccessibleName));
        }
    }

    // ── Projection argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => DeltaProjection.Project(null!, Ctx(), Localizer));
        Assert.Throws<ArgumentNullException>(() => DeltaProjection.Project(new DeltaInput(), null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => DeltaProjection.Project(new DeltaInput(), Ctx(), null!));
    }

    // ── View-model: per-state projection over the seam ───────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        using var vm = new DeltaViewModel(source, Localizer);

        Assert.Equal(DeltaState.Value, vm.State);
        Assert.True(vm.IsValue);
        Assert.Equal("20.0%", vm.Display.PrimaryText);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_values_change()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        using var vm = new DeltaViewModel(source, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetValues(8, 10);

        Assert.Equal(DeltaTone.Positive, vm.Display.Tone);
        Assert.Contains(nameof(DeltaViewModel.Display), changed);
        Assert.Contains(nameof(DeltaViewModel.State), changed);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_unit_context_changes()
    {
        var source = new DeltaSource(Input("range", 280, 250, DeltaDisplayMode.Absolute), Ctx(DistanceUnit.Mi));
        using var vm = new DeltaViewModel(source, Localizer);
        Assert.Equal("30.0 mi", vm.Display.PrimaryText);

        source.SetContext(Ctx(DistanceUnit.Km));

        Assert.Equal("30.0 km", vm.Display.PrimaryText);
    }

    [Fact]
    public void ViewModel_toggles_into_the_loading_state()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        using var vm = new DeltaViewModel(source, Localizer);
        Assert.Equal(DeltaState.Value, vm.State);

        source.SetLoading(true);

        Assert.Equal(DeltaState.Loading, vm.State);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        var vm = new DeltaViewModel(source, Localizer);

        vm.Dispose();
        source.SetValues(8, 10);

        Assert.Equal("20.0%", vm.Display.PrimaryText);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new DeltaViewModel(new DeltaSource(), Localizer);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new DeltaViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new DeltaViewModel(new DeltaSource(), null!));
    }

    [Fact]
    public void ViewModel_slug_matches_the_registration() =>
        Assert.Equal(DeltaRegistration.Slug, DeltaViewModel.Slug);

    // ── Source seam: change notifications ────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_raises_changed_on_set_values()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetValues(8, 10);

        Assert.Equal(1, raised);
        Assert.Equal(8, source.Input.Current);
        Assert.Equal(10, source.Input.Previous);
    }

    [Fact]
    public void Source_set_values_preserves_other_input_flags()
    {
        var source = new DeltaSource(
            Input("cost", 12, 10, DeltaDisplayMode.Absolute, comparedTo: "vs last week"),
            Ctx());

        source.SetValues(8, 10);

        Assert.Equal(DeltaDisplayMode.Absolute, source.Input.Display);
        Assert.Equal("vs last week", source.Input.ComparedTo);
    }

    [Fact]
    public void Source_set_loading_is_a_no_op_when_unchanged()
    {
        var source = new DeltaSource(Input("cost", 12, 10), Ctx());
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetLoading(false); // already false
        source.SetLoading(true);

        Assert.Equal(1, raised);
        Assert.True(source.Input.Loading);
    }

    [Fact]
    public void Source_falls_back_to_defaults_for_null_assignments()
    {
        var source = new DeltaSource();

        source.SetInput(null!);
        source.SetContext(null!);

        Assert.NotNull(source.Input);
        Assert.NotNull(source.Context);
        Assert.Equal(DeltaUnitContext.Metric, source.Context);
    }

    // ── Registration + diagnostics (P1/S11): slug-only, never values ─────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("Delta", DeltaRegistration.Slug);

    [Fact]
    public void Registration_keys_match_the_catalog()
    {
        Assert.Equal("translation.delta.noComparison", DeltaRegistration.NoComparisonKey);
        Assert.Equal("translation.delta.title", DeltaRegistration.TitleKey);
    }

    [Fact]
    public void Registration_title_substitutes_both_tokens() =>
        Assert.Equal("5 vs 3", DeltaRegistration.Title(Localizer, "5", "3"));

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DeltaDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Delta", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new DeltaDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_values()
    {
        var lines = new List<string>();
        var diagnostics = new DeltaDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("$", line, StringComparison.Ordinal);
            Assert.DoesNotContain("%", line, StringComparison.Ordinal);
        });
    }
}
