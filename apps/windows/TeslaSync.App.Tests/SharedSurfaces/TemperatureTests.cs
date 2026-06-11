using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces.TemperatureSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Temperature</c> shared surface's UI-thread-free logic — the registration
/// metadata, the pure <see cref="TemperatureProjection"/> adapter (the c/f source selection and precedence,
/// the °F→°C source conversion, the SI→display conversion + locale formatting, the precision resolution and
/// the source-value tooltip), the per-state visible readout and accessible name (the value branch and the
/// em-dash empty branch), the <see cref="TemperatureViewModel"/> state holder (initial projection, runtime
/// value push, runtime °C⇄°F toggle, subscription cleanup), the <see cref="IUnitPreferenceSource"/> seam and
/// the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/data-display/format/Temperature.tsx</c>). The WinUI view itself (Temperature.cs) is
/// exercised by the app build. Because the component reads no network data (its only inputs are
/// caller-supplied props plus the <c>useUnits</c> preference), there is no loading / error / stale / offline
/// state; the reproduced render branches are the converted value readout and the no-value em dash.
/// </summary>
public sealed class TemperatureTests
{
    private const string EmDash = "\u2014";
    private const string DegC = "\u00B0C";
    private const string DegF = "\u00B0F";

    private static TemperatureDisplay Project(TemperatureModel model, UnitPref preferences) =>
        TemperatureProjection.Project(model, preferences);

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Temperature", TemperatureRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("temperature", TemperatureRegistration.RootAutomationId);

    [Fact]
    public void Default_precision_matches_the_web_fmtNumber_global_default() =>
        Assert.Equal(2, TemperatureRegistration.DefaultPrecision);

    [Fact]
    public void Symbol_constants_match_the_web_literals()
    {
        Assert.Equal("\u2014", TemperatureRegistration.EmptyDisplay);
        Assert.Equal("\u00B0C", TemperatureRegistration.CelsiusSymbol);
        Assert.Equal("\u00B0F", TemperatureRegistration.FahrenheitSymbol);
    }

    // ── empty branch (web sourceC == null → <span>—</span>, no title) ────────────────────────────────────

    [Fact]
    public void No_inputs_render_the_em_dash()
    {
        TemperatureDisplay d = Project(TemperatureModel.Empty, UnitPref.Metric);

        Assert.False(d.HasValue);
        Assert.Equal(EmDash, d.Text);
        Assert.Null(d.Tooltip);
        Assert.Equal(EmDash, d.AutomationName);
    }

    [Fact]
    public void Empty_branch_is_independent_of_units() =>
        Assert.Equal(EmDash, Project(TemperatureModel.Empty, UnitPref.Imperial).Text);

    [Theory]
    [InlineData(double.NaN, double.NaN)]
    [InlineData(double.PositiveInfinity, double.NegativeInfinity)]
    public void Non_finite_inputs_render_the_em_dash(double c, double f)
    {
        TemperatureDisplay d = Project(new TemperatureModel(c, f), UnitPref.Metric);

        Assert.False(d.HasValue);
        Assert.Equal(EmDash, d.Text);
        Assert.Null(d.Tooltip);
    }

    // ── value branch: celsius source ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Celsius_in_metric_uses_the_global_default_precision()
    {
        // web: precision undefined → fmtNumber(value, _globalPrecision=2) → "20.00", + "°C".
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(20), UnitPref.Metric);

        Assert.True(d.HasValue);
        Assert.Equal("20.00" + DegC, d.Text);
        Assert.Equal("20.0 " + DegC, d.Tooltip);
        Assert.Equal(d.Text, d.AutomationName);
    }

    [Fact]
    public void Celsius_in_metric_honours_explicit_precision_zero() =>
        Assert.Equal("20" + DegC, Project(TemperatureModel.FromCelsius(20, 0), UnitPref.Metric).Text);

    [Fact]
    public void Celsius_in_metric_honours_explicit_precision_one() =>
        Assert.Equal("20.0" + DegC, Project(TemperatureModel.FromCelsius(20, 1), UnitPref.Metric).Text);

    [Fact]
    public void Celsius_converts_to_fahrenheit_in_imperial()
    {
        // web: convertTempFromSI(20, '°F') = 20*9/5+32 = 68; the tooltip still echoes the °C source.
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(20, 0), UnitPref.Imperial);

        Assert.Equal("68" + DegF, d.Text);
        Assert.Equal("20.0 " + DegC, d.Tooltip);
    }

    [Fact]
    public void Negative_celsius_is_preserved_in_value_and_tooltip()
    {
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(-5, 1), UnitPref.Metric);

        Assert.Equal("-5.0" + DegC, d.Text);
        Assert.Equal("-5.0 " + DegC, d.Tooltip);
    }

    // ── value branch: fahrenheit source ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Fahrenheit_converts_to_celsius_in_metric()
    {
        // web: sourceC = ((68 - 32) * 5) / 9 = 20; display in °C; tooltip echoes the °F source.
        TemperatureDisplay d = Project(TemperatureModel.FromFahrenheit(68, 0), UnitPref.Metric);

        Assert.True(d.HasValue);
        Assert.Equal("20" + DegC, d.Text);
        Assert.Equal("68.0 " + DegF, d.Tooltip);
    }

    [Fact]
    public void Fahrenheit_round_trips_in_imperial()
    {
        // web: sourceC = 20 (from 68°F); convertTempFromSI(20, '°F') = 68 → "68°F"; tooltip echoes °F.
        TemperatureDisplay d = Project(TemperatureModel.FromFahrenheit(68, 0), UnitPref.Imperial);

        Assert.Equal("68" + DegF, d.Text);
        Assert.Equal("68.0 " + DegF, d.Tooltip);
    }

    // ── source precedence + tooltip independence ─────────────────────────────────────────────────────────

    [Fact]
    public void Celsius_takes_precedence_over_fahrenheit_when_both_are_finite()
    {
        // web: the `if (c …) else if (f …)` order means c wins and f is ignored entirely.
        TemperatureDisplay d = Project(new TemperatureModel(20, 100, 0), UnitPref.Metric);

        Assert.Equal("20" + DegC, d.Text);
        Assert.Equal("20.0 " + DegC, d.Tooltip);
    }

    [Fact]
    public void Non_finite_celsius_falls_through_to_fahrenheit()
    {
        TemperatureDisplay d = Project(new TemperatureModel(double.NaN, 68, 0), UnitPref.Metric);

        Assert.Equal("20" + DegC, d.Text);
        Assert.Equal("68.0 " + DegF, d.Tooltip);
    }

    [Fact]
    public void Tooltip_keeps_one_decimal_independent_of_display_precision()
    {
        // display rounds to an integer (precision 0) but the title is always toFixed(1).
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(21.5, 0), UnitPref.Metric);

        Assert.Equal("22" + DegC, d.Text); // halfExpand: 21.5 → 22
        Assert.Equal("21.5 " + DegC, d.Tooltip);
    }

    [Fact]
    public void Display_has_no_space_before_the_unit_but_the_tooltip_does()
    {
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(20, 0), UnitPref.Metric);

        Assert.DoesNotContain(" ", d.Text, System.StringComparison.Ordinal);
        Assert.Contains(" ", d.Tooltip!, System.StringComparison.Ordinal);
    }

    // ── precision resolution (web fmtNumber: prop ?? global) ─────────────────────────────────────────────

    [Fact]
    public void Precision_prop_wins_over_preference_and_default()
    {
        UnitPref pref = UnitPref.Metric with { Precision = 3 };
        Assert.Equal(0, TemperatureProjection.ResolvePrecision(TemperatureModel.FromCelsius(1, 0), pref));
    }

    [Fact]
    public void Preference_precision_is_used_when_the_prop_is_absent()
    {
        UnitPref pref = UnitPref.Metric with { Precision = 1 };

        Assert.Equal(1, TemperatureProjection.ResolvePrecision(TemperatureModel.FromCelsius(1), pref));
        Assert.Equal("20.0" + DegC, Project(TemperatureModel.FromCelsius(20), pref).Text);
    }

    [Fact]
    public void Default_precision_is_used_when_neither_prop_nor_preference_supplies_one() =>
        Assert.Equal(2, TemperatureProjection.ResolvePrecision(TemperatureModel.FromCelsius(1), UnitPref.Metric));

    [Fact]
    public void Negative_precision_is_clamped_to_zero() =>
        Assert.Equal(0, TemperatureProjection.ResolvePrecision(TemperatureModel.FromCelsius(1, -3), UnitPref.Metric));

    // ── accessibility: an accessible name is present in every branch ─────────────────────────────────────

    [Fact]
    public void Accessible_name_is_non_empty_in_every_branch()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(TemperatureModel.Empty, UnitPref.Metric).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(TemperatureModel.FromCelsius(20, 0), UnitPref.Metric).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(Project(TemperatureModel.FromFahrenheit(68, 0), UnitPref.Imperial).AutomationName));
    }

    [Fact]
    public void Accessible_name_matches_the_visible_readout_in_the_value_branch()
    {
        TemperatureDisplay d = Project(TemperatureModel.FromCelsius(20, 1), UnitPref.Metric);
        Assert.Equal(d.Text, d.AutomationName);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => TemperatureProjection.Project(null!, UnitPref.Metric));

    [Fact]
    public void Project_rejects_a_null_preferences() =>
        Assert.Throws<System.ArgumentNullException>(() => TemperatureProjection.Project(TemperatureModel.Empty, null!));

    // ── view-model: initial projection ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_its_initial_model_in_the_source_units()
    {
        using var vm = new TemperatureViewModel(TemperatureModel.FromCelsius(20, 0), StaticUnitPreferenceSource.Metric);

        Assert.Equal("Temperature", TemperatureViewModel.Slug);
        Assert.Equal(UnitPref.Metric, vm.Preferences);
        Assert.Equal("20" + DegC, vm.Display.Text);
    }

    [Fact]
    public void ViewModel_pushing_a_new_model_reprojects_and_notifies()
    {
        using var vm = new TemperatureViewModel(TemperatureModel.FromCelsius(20, 0), StaticUnitPreferenceSource.Metric);
        int raised = 0;
        vm.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(TemperatureViewModel.Display)) raised++; };

        vm.SetCelsius(25, 0);

        Assert.Equal("25" + DegC, vm.Display.Text);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void ViewModel_setting_an_equal_model_is_a_no_op()
    {
        using var vm = new TemperatureViewModel(TemperatureModel.FromCelsius(20, 0), StaticUnitPreferenceSource.Metric);
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Model = TemperatureModel.FromCelsius(20, 0);

        Assert.Equal(0, raised);
    }

    [Fact]
    public void ViewModel_set_fahrenheit_switches_the_source()
    {
        using var vm = new TemperatureViewModel(TemperatureModel.Empty, StaticUnitPreferenceSource.Metric);

        vm.SetFahrenheit(68, 0);

        Assert.Equal("20" + DegC, vm.Display.Text);
        Assert.Equal("68.0 " + DegF, vm.Display.Tooltip);
    }

    // ── view-model: runtime °C ⇄ °F toggle (web useUnits re-render) ───────────────────────────────────────

    [Fact]
    public void ViewModel_reprojects_when_the_unit_preference_changes_at_runtime()
    {
        var source = new MutableUnitPreferenceSource(UnitPref.Metric);
        using var vm = new TemperatureViewModel(TemperatureModel.FromCelsius(20), source);
        int raised = 0;
        vm.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(TemperatureViewModel.Display)) raised++; };

        Assert.Equal("20.00" + DegC, vm.Display.Text);

        source.Set(UnitPref.Imperial);

        Assert.Equal("68.00" + DegF, vm.Display.Text);
        Assert.Equal(UnitPref.Imperial, vm.Preferences);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_preference_source()
    {
        var source = new MutableUnitPreferenceSource(UnitPref.Metric);
        var vm = new TemperatureViewModel(TemperatureModel.FromCelsius(20, 0), source);
        Assert.Equal(1, source.ObserverCount);

        vm.Dispose();
        Assert.Equal(0, source.ObserverCount);

        // After disposal a preference change must not mutate the (frozen) projection.
        source.Set(UnitPref.Imperial);
        Assert.Equal("20" + DegC, vm.Display.Text);
    }

    [Fact]
    public void ViewModel_dispose_is_idempotent()
    {
        var vm = new TemperatureViewModel(TemperatureModel.Empty, StaticUnitPreferenceSource.Metric);
        vm.Dispose();
        vm.Dispose();
    }

    [Fact]
    public void ViewModel_rejects_null_constructor_arguments()
    {
        Assert.Throws<System.ArgumentNullException>(() => new TemperatureViewModel(null!, StaticUnitPreferenceSource.Metric));
        Assert.Throws<System.ArgumentNullException>(() => new TemperatureViewModel(TemperatureModel.Empty, null!));
    }

    // ── unit-preference seam ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_reports_its_fixed_preference()
    {
        Assert.Equal(UnitPref.Metric, StaticUnitPreferenceSource.Metric.Preferences);
        Assert.Equal(UnitPref.Imperial, StaticUnitPreferenceSource.Imperial.Preferences);
    }

    [Fact]
    public void Static_source_observe_is_inert_but_well_behaved()
    {
        using IDisposable handle = StaticUnitPreferenceSource.Metric.Observe(_ => { });
        Assert.NotNull(handle);
        Assert.Throws<System.ArgumentNullException>(() => StaticUnitPreferenceSource.Metric.Observe(null!));
    }

    [Fact]
    public void Mutable_source_notifies_observers_once_per_distinct_change()
    {
        var source = new MutableUnitPreferenceSource(UnitPref.Metric);
        var seen = new List<UnitPref>();
        using IDisposable handle = source.Observe(seen.Add);

        source.Set(UnitPref.Imperial);
        source.Set(UnitPref.Imperial); // unchanged → no second notification

        Assert.Equal(UnitPref.Imperial, source.Preferences);
        UnitPref only = Assert.Single(seen);
        Assert.Equal(UnitPref.Imperial, only);
    }

    [Fact]
    public void Mutable_source_subscription_dispose_stops_notifications()
    {
        var source = new MutableUnitPreferenceSource(UnitPref.Metric);
        var seen = new List<UnitPref>();
        IDisposable handle = source.Observe(seen.Add);

        handle.Dispose();
        source.Set(UnitPref.Imperial);

        Assert.Empty(seen);
        Assert.Equal(0, source.ObserverCount);
    }

    [Fact]
    public void Mutable_source_rejects_null_arguments()
    {
        Assert.Throws<System.ArgumentNullException>(() => new MutableUnitPreferenceSource(null!));
        var source = new MutableUnitPreferenceSource(UnitPref.Metric);
        Assert.Throws<System.ArgumentNullException>(() => source.Observe(null!));
        Assert.Throws<System.ArgumentNullException>(() => source.Set(null!));
    }

    // ── diagnostics (view.opened, PII-safe — never the temperature value) ────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TemperatureDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Temperature", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new TemperatureDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
