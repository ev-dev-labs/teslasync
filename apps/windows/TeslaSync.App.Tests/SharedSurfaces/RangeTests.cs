using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Range surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the web <c>precision = 0</c> default, the rated/ideal i18n keys), the pure
/// <see cref="RangeProjection"/> adapter (rated/ideal selection, km/mi unit conversion, precision, and the null →
/// em-dash empty branch), the <see cref="RangeViewModel"/> state holder (initial projection, runtime snapshot /
/// unit / preferred-range / precision pushes, minimal change notification), the accessibility name, and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/components/data-display/format/Range.tsx) and its
/// <c>useRangeLabel</c> companion. The WinUI view (shared-surfaces/Range.cs) is exercised by the app build.
/// Because the component reads no network data, there is no loading / error / stale / offline state; the
/// reproduced render branches are the formatted-value branch (rated|ideal × km|mi × precision) and the em-dash
/// empty branch.
/// </summary>
public sealed class RangeTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Range", RangeRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("range", RangeRegistration.RootAutomationId);

    [Fact]
    public void Default_precision_matches_the_web_source() =>
        Assert.Equal(0, RangeRegistration.DefaultPrecision);

    [Fact]
    public void Label_keys_match_the_web_useRangeLabel_keys()
    {
        // web useRangeLabel: t('common.ratedRange') / t('common.idealRange').
        Assert.Equal("common.ratedRange", RangeRegistration.RatedLabelKey);
        Assert.Equal("common.idealRange", RangeRegistration.IdealLabelKey);
        Assert.Equal("Rated Range", RangeRegistration.RatedLabelDefault);
        Assert.Equal("Ideal Range", RangeRegistration.IdealLabelDefault);
    }

    // ── projection adapter (web body: usePreferredRange + formatDistance(meters, { precision })) ───────────

    [Fact]
    public void Projection_selects_rated_range_by_default()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000);

        var projection = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);

        Assert.Equal(410_000, projection.Meters);
        Assert.Equal(RangeType.Rated, projection.Source);
        Assert.Equal("410 km", projection.Value);
        Assert.True(projection.HasValue);
    }

    [Fact]
    public void Projection_selects_ideal_range_when_preferred()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000);

        var projection = RangeProjection.Project(state, RangeType.Ideal, UnitPref.Metric, 0, Localizer);

        Assert.Equal(430_000, projection.Meters);
        Assert.Equal(RangeType.Ideal, projection.Source);
        Assert.Equal("430 km", projection.Value);
        Assert.True(projection.HasValue);
    }

    [Fact]
    public void Projection_converts_to_the_preferred_distance_unit()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);

        var metric = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);
        var imperial = RangeProjection.Project(state, RangeType.Rated, UnitPref.Imperial, 0, Localizer);

        // The projection must plumb the SELECTED metres + chosen unit + precision into the shared formatter.
        Assert.Equal(UnitFormatters.FormatDistance(410_000, UnitPref.Metric, 0), metric.Value);
        Assert.Equal(UnitFormatters.FormatDistance(410_000, UnitPref.Imperial, 0), imperial.Value);
        Assert.EndsWith("km", metric.Value, StringComparison.Ordinal);
        Assert.EndsWith("mi", imperial.Value, StringComparison.Ordinal);
        Assert.NotEqual(metric.Value, imperial.Value);
    }

    [Fact]
    public void Projection_honours_precision()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);

        var p0 = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);
        var p1 = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 1, Localizer);

        Assert.Equal("410 km", p0.Value);
        Assert.Equal("410.0 km", p1.Value);
    }

    [Fact]
    public void Projection_clamps_negative_precision_to_the_default()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);

        var projection = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, -5, Localizer);

        Assert.Equal("410 km", projection.Value);
    }

    [Fact]
    public void Projection_renders_the_em_dash_when_the_state_is_null()
    {
        var projection = RangeProjection.Project(null, RangeType.Rated, UnitPref.Metric, 0, Localizer);

        // web: meters == null ? <span>—</span> : ...
        Assert.Null(projection.Meters);
        Assert.False(projection.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, projection.Value);
    }

    [Fact]
    public void Projection_renders_the_em_dash_when_the_selected_field_is_null()
    {
        // Ideal preferred, but only rated reported → the preferred value is null → em dash.
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);

        var projection = RangeProjection.Project(state, RangeType.Ideal, UnitPref.Metric, 0, Localizer);

        Assert.Null(projection.Meters);
        Assert.False(projection.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, projection.Value);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Projection_treats_non_finite_values_as_empty(double bad)
    {
        var state = new RangeState(RatedRangeMeters: bad, IdealRangeMeters: null);

        var projection = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);

        Assert.False(projection.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, projection.Value);
    }

    [Fact]
    public void Projection_resolves_the_rated_and_ideal_labels()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000);

        Assert.Equal("Rated Range", RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer).Label);
        Assert.Equal("Ideal Range", RangeProjection.Project(state, RangeType.Ideal, UnitPref.Metric, 0, Localizer).Label);
    }

    [Fact]
    public void Projection_is_pure_and_value_equal_for_identical_inputs()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000);

        var a = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);
        var b = RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, Localizer);
        var different = RangeProjection.Project(state, RangeType.Ideal, UnitPref.Metric, 0, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_when_units_or_localizer_is_null()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);

        Assert.Throws<ArgumentNullException>(() => RangeProjection.Project(state, RangeType.Rated, units: null!, 0, Localizer));
        Assert.Throws<ArgumentNullException>(() => RangeProjection.Project(state, RangeType.Rated, UnitPref.Metric, 0, localizer: null!));
    }

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Theory]
    [InlineData(410_000.0, 430_000.0, RangeType.Rated, "410 km", true, RangeType.Rated)]
    [InlineData(410_000.0, 430_000.0, RangeType.Ideal, "430 km", true, RangeType.Ideal)]
    [InlineData(0.0, 0.0, RangeType.Rated, "0 km", true, RangeType.Rated)]
    [InlineData(null, 430_000.0, RangeType.Rated, "\u2014", false, RangeType.Rated)]
    [InlineData(410_000.0, null, RangeType.Ideal, "\u2014", false, RangeType.Ideal)]
    public void Projection_snapshot_per_state(
        double? rated,
        double? ideal,
        RangeType preferred,
        string expectedValue,
        bool expectedHasValue,
        RangeType expectedSource)
    {
        var state = new RangeState(rated, ideal);

        var projection = RangeProjection.Project(state, preferred, UnitPref.Metric, 0, Localizer);

        Assert.Equal(expectedValue, projection.Value);
        Assert.Equal(expectedHasValue, projection.HasValue);
        Assert.Equal(expectedSource, projection.Source);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Range", RangeViewModel.Slug);

    [Fact]
    public void ViewModel_default_is_rated_metric_and_empty()
    {
        var viewModel = new RangeViewModel(Localizer);

        Assert.Equal(RangeType.Rated, viewModel.PreferredRange);
        Assert.False(viewModel.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, viewModel.Value);
        Assert.Equal("Rated Range", viewModel.Label);
        Assert.Equal("Rated Range: No data available", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_constructed_with_a_snapshot_projects_it()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000));

        Assert.True(viewModel.HasValue);
        Assert.Equal("410 km", viewModel.Value);
    }

    [Fact]
    public void ViewModel_set_state_pushes_a_new_snapshot_and_raises_changes()
    {
        var viewModel = new RangeViewModel(Localizer);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetState(new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null));

        Assert.Equal("410 km", viewModel.Value);
        Assert.True(viewModel.HasValue);
        Assert.Contains(nameof(RangeViewModel.Projection), changed);
        Assert.Contains(nameof(RangeViewModel.Value), changed);
        Assert.Contains(nameof(RangeViewModel.HasValue), changed);
        Assert.Contains(nameof(RangeViewModel.AccessibleName), changed);
    }

    [Fact]
    public void ViewModel_set_state_is_a_no_op_for_an_unchanged_snapshot()
    {
        var state = new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null);
        var viewModel = new RangeViewModel(Localizer, state);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetState(state);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_changing_preferred_range_reprojects_and_raises_source()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.PreferredRange = RangeType.Ideal;

        Assert.Equal("430 km", viewModel.Value);
        Assert.Equal(RangeType.Ideal, viewModel.Source);
        Assert.Equal("Ideal Range", viewModel.Label);
        Assert.Contains(nameof(RangeViewModel.Source), changed);
        Assert.Contains(nameof(RangeViewModel.Value), changed);
        Assert.Contains(nameof(RangeViewModel.Label), changed);
    }

    [Fact]
    public void ViewModel_changing_units_reprojects()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null));
        var before = viewModel.Value;

        viewModel.Units = UnitPref.Imperial;

        Assert.NotEqual(before, viewModel.Value);
        Assert.EndsWith("mi", viewModel.Value, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_changing_precision_reprojects()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null));

        Assert.Equal("410 km", viewModel.Value);

        viewModel.Precision = 1;

        Assert.Equal("410.0 km", viewModel.Value);
    }

    [Fact]
    public void ViewModel_negative_precision_is_normalised_to_the_default()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: null),
            precision: -3);

        Assert.Equal(0, viewModel.Precision);
        Assert.Equal("410 km", viewModel.Value);
    }

    [Fact]
    public void ViewModel_throws_when_units_is_set_to_null()
    {
        var viewModel = new RangeViewModel(Localizer);

        Assert.Throws<ArgumentNullException>(() => viewModel.Units = null!);
    }

    [Fact]
    public void ViewModel_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new RangeViewModel(localizer: null!));

    // ── accessibility: the labelled value is the surface's accessible name ────────────────────────────────

    [Fact]
    public void Accessible_name_combines_the_label_and_the_value()
    {
        var viewModel = new RangeViewModel(
            Localizer,
            new RangeState(RatedRangeMeters: 410_000, IdealRangeMeters: 430_000));

        Assert.Equal("Rated Range: 410 km", viewModel.AccessibleName);
    }

    [Fact]
    public void Accessible_name_announces_no_value_when_empty()
    {
        var viewModel = new RangeViewModel(Localizer, new RangeState(RatedRangeMeters: null, IdealRangeMeters: null));

        Assert.Equal("Rated Range: No data available", viewModel.AccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the range) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RangeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Range", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new RangeDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
