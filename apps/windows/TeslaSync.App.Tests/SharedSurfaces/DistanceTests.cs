using System.Collections.Generic;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Distance</c> shared surface's UI-thread-free logic — the registration
/// metadata, the pure <see cref="DistanceProjection"/> adapter (the mi / km input channels, SI-metre
/// normalisation, unit conversion, <c>fmtNumber</c>-equivalent formatting, precision resolution, the raw-value
/// tooltip and the em-dash empty branch), the <see cref="DistanceViewModel"/> state holder (initial
/// projection, runtime value push, runtime unit-preference change, subscription cleanup), the
/// <see cref="DistanceUnitsSource"/> seam and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/data-display/format/Distance.tsx). The WinUI view itself (shared-surfaces/Distance/Distance.cs)
/// is exercised by the app build. Because the surface reads no network data — its only data source is the
/// synchronous unit preference — the reproduced render branches are the formatted-value readout and the
/// no-value em dash, across the mi / km channels and the distance-unit / precision variants.
/// </summary>
public sealed class DistanceTests
{
    private static UnitPref Metric => UnitPref.Metric;

    private static UnitPref Imperial => UnitPref.Imperial;

    private static UnitPref WithUnit(DistanceUnit unit) => UnitPref.Metric with { Distance = unit };

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Distance", DistanceRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("distance", DistanceRegistration.RootAutomationId);

    [Fact]
    public void Registration_constants_match_the_web_source()
    {
        // web: fmtNumber global default precision 2; miles * 1609.344; km * 1000; the — dash.
        Assert.Equal(2, DistanceRegistration.DefaultPrecision);
        Assert.Equal(1609.344, DistanceRegistration.MetersPerMile);
        Assert.Equal(1000.0, DistanceRegistration.MetersPerKm);
        Assert.Equal("\u2014", DistanceRegistration.EmptyDisplay);
    }

    // ── projection: the mi channel (web miles * 1609.344 → SI, then convertDistanceFromSI) ────────────────

    [Fact]
    public void Project_miles_with_imperial_pref_is_a_round_trip()
    {
        var display = DistanceProjection.Project(miles: 1, km: null, precision: null, Imperial);

        Assert.Equal(DistanceState.Value, display.State);
        Assert.True(display.HasValue);
        Assert.Equal(1609.344, display.SourceMeters);
        Assert.Equal(1.0, display.DisplayValue);
        Assert.Equal("1.00 mi", display.Display);
        Assert.Equal("1.00 mi", display.Title);
        Assert.Equal("mi", display.UnitLabel);
    }

    [Fact]
    public void Project_miles_with_metric_pref_converts_for_display_but_keeps_the_raw_title()
    {
        var display = DistanceProjection.Project(miles: 1, km: null, precision: null, Metric);

        // 1 mi = 1609.344 m = 1.609344 km → "1.61 km"; the tooltip keeps the raw caller value in miles.
        Assert.Equal(1609.344, display.SourceMeters);
        Assert.Equal("1.61 km", display.Display);
        Assert.Equal("1.00 mi", display.Title);
        Assert.Equal("km", display.UnitLabel);
    }

    // ── projection: the km channel (web km * 1000 → SI) ───────────────────────────────────────────────────

    [Fact]
    public void Project_km_with_metric_pref_is_a_round_trip()
    {
        var display = DistanceProjection.Project(miles: null, km: 1, precision: null, Metric);

        Assert.Equal(1000.0, display.SourceMeters);
        Assert.Equal(1.0, display.DisplayValue);
        Assert.Equal("1.00 km", display.Display);
        Assert.Equal("1.00 km", display.Title);
    }

    [Fact]
    public void Project_km_with_imperial_pref_converts_for_display_but_keeps_the_raw_title()
    {
        var display = DistanceProjection.Project(miles: null, km: 1, precision: null, Imperial);

        // 1 km = 1000 m = 0.621371… mi → "0.62 mi"; the tooltip keeps the raw caller value in km.
        Assert.Equal(1000.0, display.SourceMeters);
        Assert.Equal("0.62 mi", display.Display);
        Assert.Equal("1.00 km", display.Title);
    }

    // ── projection: miles wins over km (web if (miles) … else if (km)) ────────────────────────────────────

    [Fact]
    public void Project_prefers_miles_when_both_inputs_are_supplied()
    {
        var display = DistanceProjection.Project(miles: 5, km: 99, precision: null, Imperial);

        Assert.Equal(5 * 1609.344, display.SourceMeters);
        Assert.Equal("5.00 mi", display.Display);
        Assert.Equal("5.00 mi", display.Title);
    }

    // ── projection: precision resolution (web fmtNumber(value, precision)) ────────────────────────────────

    [Fact]
    public void Project_honours_an_explicit_precision_for_the_display_but_not_the_title()
    {
        var display = DistanceProjection.Project(miles: null, km: 1.23456, precision: 3, Metric);

        Assert.Equal("1.235 km", display.Display); // display at precision 3
        Assert.Equal("1.23 km", display.Title);    // title is always two decimals (toFixed(2))
    }

    [Fact]
    public void Project_falls_back_to_the_preference_precision_when_no_override()
    {
        var pref = UnitPref.Metric with { Precision = 1 };

        var display = DistanceProjection.Project(miles: null, km: 1.23456, precision: null, pref);

        Assert.Equal("1.2 km", display.Display);
    }

    [Fact]
    public void Project_falls_back_to_the_web_global_default_precision_of_two()
    {
        // Metric has no Precision, so the web fmtNumber global default (2) is used.
        var display = DistanceProjection.Project(miles: null, km: 2.5, precision: null, Metric);

        Assert.Equal("2.50 km", display.Display);
    }

    [Fact]
    public void Project_clamps_a_negative_precision_to_zero()
    {
        var display = DistanceProjection.Project(miles: null, km: 12.9, precision: -3, Metric);

        Assert.Equal("13 km", display.Display);
    }

    // ── projection: en-US grouping + ft conversion (web fmtNumber + convertDistanceFromSI 'ft') ───────────

    [Fact]
    public void Project_groups_thousands_in_the_display_but_not_the_title()
    {
        var display = DistanceProjection.Project(miles: 1000, km: null, precision: null, Imperial);

        // fmtNumber groups (1,000.00); toFixed(2) does not (1000.00).
        Assert.Equal("1,000.00 mi", display.Display);
        Assert.Equal("1000.00 mi", display.Title);
    }

    [Fact]
    public void Project_converts_to_feet_with_grouping()
    {
        var display = DistanceProjection.Project(miles: null, km: 1, precision: null, WithUnit(DistanceUnit.Ft));

        // 1 km = 1000 m = 3280.8399… ft → "3,280.84 ft".
        Assert.Equal("3,280.84 ft", display.Display);
        Assert.Equal("ft", display.UnitLabel);
        Assert.Equal("1.00 km", display.Title);
    }

    // ── projection: the empty branch (web sourceMiles == null → <span>—</span>) ───────────────────────────

    [Fact]
    public void Project_with_no_inputs_is_the_empty_dash()
    {
        var display = DistanceProjection.Project(miles: null, km: null, precision: null, Metric);

        Assert.Equal(DistanceState.Empty, display.State);
        Assert.False(display.HasValue);
        Assert.Equal("\u2014", display.Display);
        Assert.Null(display.Title);
        Assert.Null(display.DisplayValue);
        Assert.Null(display.SourceMeters);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Project_treats_a_non_finite_value_as_empty(double notFinite)
    {
        var fromMiles = DistanceProjection.Project(miles: notFinite, km: null, precision: null, Metric);
        var fromKm = DistanceProjection.Project(miles: null, km: notFinite, precision: null, Metric);

        Assert.Equal(DistanceState.Empty, fromMiles.State);
        Assert.Equal(DistanceState.Empty, fromKm.State);
    }

    [Fact]
    public void Project_falls_through_to_km_when_miles_is_not_finite()
    {
        var display = DistanceProjection.Project(miles: double.NaN, km: 1, precision: null, Metric);

        Assert.Equal(DistanceState.Value, display.State);
        Assert.Equal("1.00 km", display.Display);
        Assert.Equal("1.00 km", display.Title);
    }

    [Fact]
    public void Project_treats_zero_as_a_value_not_empty()
    {
        // web: Number.isFinite(0) is true — zero is a real reading, not the empty dash.
        var display = DistanceProjection.Project(miles: 0, km: null, precision: null, Imperial);

        Assert.Equal(DistanceState.Value, display.State);
        Assert.Equal("0.00 mi", display.Display);
        Assert.Equal("0.00 mi", display.Title);
    }

    [Fact]
    public void Project_formats_a_negative_value()
    {
        var display = DistanceProjection.Project(miles: -5, km: null, precision: null, Imperial);

        Assert.Equal(DistanceState.Value, display.State);
        Assert.Equal("-5.00 mi", display.Display);
        Assert.Equal("-5.00 mi", display.Title);
    }

    [Fact]
    public void Project_rejects_a_null_preference() =>
        Assert.Throws<ArgumentNullException>(() =>
            DistanceProjection.Project(miles: 1, km: null, precision: null, null!));

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Theory]
    [InlineData(1.0, null, null, DistanceUnit.Mi, "1.00 mi", DistanceState.Value)]
    [InlineData(1.0, null, null, DistanceUnit.Km, "1.61 km", DistanceState.Value)]
    [InlineData(null, 1.0, null, DistanceUnit.Km, "1.00 km", DistanceState.Value)]
    [InlineData(null, 1.0, null, DistanceUnit.Mi, "0.62 mi", DistanceState.Value)]
    [InlineData(null, 1.0, null, DistanceUnit.Ft, "3,280.84 ft", DistanceState.Value)]
    [InlineData(null, null, null, DistanceUnit.Km, "\u2014", DistanceState.Empty)]
    [InlineData(double.NaN, null, null, DistanceUnit.Mi, "\u2014", DistanceState.Empty)]
    public void Projection_snapshot_per_state(double? miles, double? km, int? precision, DistanceUnit unit, string expectedDisplay, DistanceState expectedState)
    {
        var display = DistanceProjection.Project(miles, km, precision, WithUnit(unit));

        Assert.Equal(expectedState, display.State);
        Assert.Equal(expectedDisplay, display.Display);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = DistanceProjection.Project(miles: 3, km: null, precision: 2, Imperial);
        var b = DistanceProjection.Project(miles: 3, km: null, precision: 2, Imperial);
        var different = DistanceProjection.Project(miles: 3, km: null, precision: 2, Metric);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── accessibility: the visible readout is the surface's accessible name ───────────────────────────────

    [Fact]
    public void Accessible_name_is_the_visible_readout_in_the_value_state()
    {
        var display = DistanceProjection.Project(miles: 12.5, km: null, precision: null, Imperial);

        Assert.Equal(display.Display, display.AccessibleName);
        Assert.Equal("12.50 mi", display.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_the_dash_in_the_empty_state()
    {
        var display = DistanceProjection.Project(miles: null, km: null, precision: null, Metric);

        Assert.Equal(display.Display, display.AccessibleName);
        Assert.Equal("\u2014", display.AccessibleName);
    }

    // ── view-model: initial projection over the seam ──────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Distance", DistanceViewModel.Slug);

    [Fact]
    public void ViewModel_projects_the_initial_distance_and_unit()
    {
        var source = new DistanceUnitsSource(Imperial);
        using var vm = new DistanceViewModel(source, miles: 2);

        Assert.Equal(DistanceState.Value, vm.State);
        Assert.True(vm.HasValue);
        Assert.Equal("2.00 mi", vm.Display);
        Assert.Equal("2.00 mi", vm.Title);
        Assert.Equal("mi", vm.UnitLabel);
        Assert.Equal(2.0, vm.Miles);
    }

    [Fact]
    public void ViewModel_starts_empty_when_no_distance_is_supplied()
    {
        using var vm = new DistanceViewModel(new DistanceUnitsSource());

        Assert.Equal(DistanceState.Empty, vm.State);
        Assert.False(vm.HasValue);
        Assert.Equal("\u2014", vm.Display);
        Assert.Null(vm.Title);
    }

    // ── view-model: runtime value push (web miles/km/precision prop change) ───────────────────────────────

    [Fact]
    public void ViewModel_set_miles_pushes_a_new_value_and_raises_changes()
    {
        var source = new DistanceUnitsSource(Imperial);
        using var vm = new DistanceViewModel(source);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.SetMiles(10);

        Assert.Equal("10.00 mi", vm.Display);
        Assert.Contains(nameof(DistanceViewModel.Projection), changed);
        Assert.Contains(nameof(DistanceViewModel.State), changed);
        Assert.Contains(nameof(DistanceViewModel.Display), changed);
        Assert.Contains(nameof(DistanceViewModel.AccessibleName), changed);
    }

    [Fact]
    public void ViewModel_set_precision_reprojects_the_display()
    {
        var source = new DistanceUnitsSource(Metric);
        using var vm = new DistanceViewModel(source, km: 1.23456);
        Assert.Equal("1.23 km", vm.Display);

        vm.SetPrecision(3);

        Assert.Equal("1.235 km", vm.Display);
    }

    [Fact]
    public void ViewModel_set_value_is_a_no_op_when_the_projection_is_unchanged()
    {
        var source = new DistanceUnitsSource(Imperial);
        using var vm = new DistanceViewModel(source, miles: 4);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.SetMiles(4);

        Assert.Equal(0, changes);
    }

    // ── view-model: runtime unit-preference change (web useUnits re-render) ───────────────────────────────

    [Fact]
    public void ViewModel_reacts_to_a_unit_preference_change()
    {
        var source = new DistanceUnitsSource(Metric);
        using var vm = new DistanceViewModel(source, miles: 1);
        Assert.Equal("1.61 km", vm.Display);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetPreferences(Imperial);

        Assert.Equal("1.00 mi", vm.Display);
        Assert.Equal("mi", vm.UnitLabel);
        Assert.Contains(nameof(DistanceViewModel.Projection), changed);
        Assert.Contains(nameof(DistanceViewModel.Display), changed);
        Assert.Contains(nameof(DistanceViewModel.UnitLabel), changed);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_units_seam()
    {
        var source = new DistanceUnitsSource(Metric);
        var vm = new DistanceViewModel(source, miles: 1);
        Assert.Equal("1.61 km", vm.Display);

        vm.Dispose();
        source.SetPreferences(Imperial);

        // After dispose a late preference change must not move the projection.
        Assert.Equal("1.61 km", vm.Display);
    }

    [Fact]
    public void ViewModel_dispose_is_idempotent()
    {
        var vm = new DistanceViewModel(new DistanceUnitsSource(), miles: 1);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_a_null_units_seam() =>
        Assert.Throws<ArgumentNullException>(() => new DistanceViewModel(null!));

    // ── source seam: change notifications ────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_defaults_to_the_metric_preference()
    {
        var source = new DistanceUnitsSource();

        Assert.Equal(DistanceUnit.Km, source.Preferences.Distance);
    }

    [Fact]
    public void Source_raises_changed_on_set_preferences()
    {
        var source = new DistanceUnitsSource(Metric);
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetPreferences(Imperial);

        Assert.Equal(1, raised);
        Assert.Equal(DistanceUnit.Mi, source.Preferences.Distance);
    }

    [Fact]
    public void Source_raises_changed_only_when_the_preference_actually_changes()
    {
        var source = new DistanceUnitsSource(Metric);
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetPreferences(Metric); // no-op (record value equality)
        source.SetPreferences(Imperial);

        Assert.Equal(1, raised);
    }

    [Fact]
    public void Source_rejects_a_null_preference() =>
        Assert.Throws<ArgumentNullException>(() => new DistanceUnitsSource().SetPreferences(null!));

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DistanceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Distance", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new DistanceDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_the_distance_value()
    {
        var lines = new List<string>();
        var diagnostics = new DistanceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.DoesNotContain("mi", line, StringComparison.Ordinal);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
    }
}
