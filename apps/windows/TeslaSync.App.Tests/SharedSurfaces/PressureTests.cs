using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Pressure surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the web <c>fmtNumber</c> default precision, the NIST/BIPM source→SI factors), the pure
/// <see cref="PressureProjection"/> adapter (bar/psi → kPa → the active display unit, en-US number formatting,
/// the source-unit tooltip, the <c>bar</c>-over-<c>psi</c> precedence and the em-dash empty branch), the
/// <see cref="PressureViewModel"/> state holder (initial projection, runtime input push, runtime unit toggle,
/// subscription cleanup), the <see cref="SettingsPressureUnitSource"/> binding, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/data-display/format/Pressure.tsx). The WinUI view
/// (shared-surfaces/Pressure.cs) is exercised by the app build. Because the component reads no network data,
/// there is no loading / error / stale / offline state; the reproduced render branches are the value state
/// (formatted number + unit + source tooltip) and the empty state (em dash, no tooltip).
/// </summary>
public sealed class PressureTests
{
    private static readonly string EmDash = UnitFormatters.DefaultEmptyDisplay;

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Pressure", PressureRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("pressure", PressureRegistration.RootAutomationId);

    [Fact]
    public void Default_precision_matches_the_web_fmtNumber_global_default() =>
        // numberFormat.ts: `let _globalPrecision = 2`.
        Assert.Equal(2, PressureRegistration.DefaultPrecision);

    [Fact]
    public void Source_to_si_factors_match_the_web_source()
    {
        // web: sourceBar = bar * 100; sourceBar = psi * 6.894757.
        Assert.Equal(100.0, PressureRegistration.KpaPerBar);
        Assert.Equal(6.894757, PressureRegistration.KpaPerPsi);
    }

    // ── projection adapter (web body: fmtNumber(convertPressureFromSI(sourceBar, pref), precision)) ────────

    [Fact]
    public void Projection_renders_bar_input_in_metric_kpa()
    {
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: null, UnitPref.Metric);

        // 2.5 bar -> 250 kPa, metric shows kPa at the default precision (2).
        Assert.True(projection.HasValue);
        Assert.Equal("250.00 kPa", projection.Text);
        Assert.Equal("2.50 bar", projection.Tooltip);
        Assert.Equal(PressureUnit.Kpa, projection.DisplayUnit);
        Assert.Equal(250.0, projection.SourceKpa!.Value, 6);
    }

    [Fact]
    public void Projection_renders_bar_input_converted_to_imperial_psi()
    {
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: null, UnitPref.Imperial);

        // 2.5 bar -> 250 kPa -> 36.26 psi; the tooltip still echoes the raw bar source.
        Assert.Equal("36.26 psi", projection.Text);
        Assert.Equal("2.50 bar", projection.Tooltip);
        Assert.Equal(PressureUnit.Psi, projection.DisplayUnit);
    }

    [Fact]
    public void Projection_renders_psi_input_in_imperial_psi_round_trip()
    {
        var projection = PressureProjection.Project(bar: null, psi: 36, precision: null, UnitPref.Imperial);

        // 36 psi -> kPa -> back to 36 psi for display; tooltip echoes the raw psi source.
        Assert.Equal("36.00 psi", projection.Text);
        Assert.Equal("36.00 psi", projection.Tooltip);
    }

    [Fact]
    public void Projection_renders_psi_input_converted_to_metric_kpa()
    {
        var projection = PressureProjection.Project(bar: null, psi: 36, precision: null, UnitPref.Metric);

        // 36 psi -> 248.211252 kPa.
        Assert.Equal("248.21 kPa", projection.Text);
        Assert.Equal("36.00 psi", projection.Tooltip);
        Assert.Equal(248.211252, projection.SourceKpa!.Value, 6);
    }

    [Fact]
    public void Projection_prefers_bar_over_psi_when_both_are_supplied()
    {
        var projection = PressureProjection.Project(bar: 2.0, psi: 30, precision: null, UnitPref.Metric);

        // web: `if (bar != null && finite) … else if (psi …)` — bar wins.
        Assert.Equal("200.00 kPa", projection.Text);
        Assert.Equal("2.00 bar", projection.Tooltip);
    }

    [Fact]
    public void Projection_falls_back_to_psi_when_bar_is_not_finite()
    {
        var projection = PressureProjection.Project(bar: double.NaN, psi: 30, precision: null, UnitPref.Imperial);

        // NaN bar is ignored; psi resolves.
        Assert.True(projection.HasValue);
        Assert.Equal("30.00 psi", projection.Text);
        Assert.Equal("30.00 psi", projection.Tooltip);
    }

    [Fact]
    public void Projection_honours_a_pressure_preference_of_bar()
    {
        var pref = UnitPref.Metric with { Pressure = PressureUnit.Bar };
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: null, pref);

        // 2.5 bar -> 250 kPa -> 2.5 bar for display.
        Assert.Equal("2.50 bar", projection.Text);
        Assert.Equal(PressureUnit.Bar, projection.DisplayUnit);
    }

    [Fact]
    public void Projection_groups_thousands_with_en_us_separators()
    {
        var projection = PressureProjection.Project(bar: 15, psi: null, precision: null, UnitPref.Metric);

        // 15 bar -> 1500 kPa, grouped.
        Assert.Equal("1,500.00 kPa", projection.Text);
        Assert.Equal("15.00 bar", projection.Tooltip);
    }

    [Fact]
    public void Projection_honours_the_precision_override()
    {
        Assert.Equal("250 kPa", PressureProjection.Project(2.5, null, precision: 0, UnitPref.Metric).Text);
        Assert.Equal("250.0 kPa", PressureProjection.Project(2.5, null, precision: 1, UnitPref.Metric).Text);
        Assert.Equal("250.000 kPa", PressureProjection.Project(2.5, null, precision: 3, UnitPref.Metric).Text);
    }

    [Fact]
    public void Projection_uses_the_unit_pref_precision_when_no_override_is_supplied()
    {
        var pref = UnitPref.Metric with { Precision = 3 };
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: null, pref);

        Assert.Equal("250.000 kPa", projection.Text);
    }

    [Fact]
    public void Projection_clamps_negative_precision_to_zero()
    {
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: -3, UnitPref.Metric);

        Assert.Equal("250 kPa", projection.Text);
    }

    [Fact]
    public void Projection_tooltip_is_always_two_fixed_decimals_regardless_of_display_precision()
    {
        // The tooltip mirrors the web `${raw.toFixed(2)} {unit}`, independent of the display `precision`.
        var projection = PressureProjection.Project(bar: 2.5, psi: null, precision: 0, UnitPref.Metric);

        Assert.Equal("250 kPa", projection.Text);
        Assert.Equal("2.50 bar", projection.Tooltip);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData(double.NaN, null)]
    [InlineData(double.PositiveInfinity, null)]
    [InlineData(double.NegativeInfinity, double.NaN)]
    [InlineData(null, double.PositiveInfinity)]
    public void Projection_empty_state_renders_the_em_dash_with_no_tooltip(double? bar, double? psi)
    {
        var projection = PressureProjection.Project(bar, psi, precision: null, UnitPref.Metric);

        // web: `if (sourceBar == null) return <span>—</span>;` — em dash, no title.
        Assert.False(projection.HasValue);
        Assert.Equal(EmDash, projection.Text);
        Assert.Null(projection.Tooltip);
        Assert.Null(projection.SourceKpa);
        Assert.Null(projection.DisplayValue);
    }

    [Fact]
    public void Projection_throws_when_the_preference_is_null() =>
        Assert.Throws<ArgumentNullException>(() => PressureProjection.Project(2.5, null, null, pref: null!));

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = PressureProjection.Project(2.5, null, null, UnitPref.Metric);
        var b = PressureProjection.Project(2.5, null, null, UnitPref.Metric);
        var different = PressureProjection.Project(2.5, null, null, UnitPref.Imperial);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Theory]
    [InlineData(2.5, null, null, true, "250.00 kPa", "2.50 bar")]
    [InlineData(null, 36.0, null, true, "248.21 kPa", "36.00 psi")]
    [InlineData(1.0, null, 0, true, "100 kPa", "1.00 bar")]
    [InlineData(null, null, null, false, "\u2014", null)]
    public void Projection_snapshot_per_state_metric(double? bar, double? psi, int? precision, bool hasValue, string expectedText, string? expectedTooltip)
    {
        var projection = PressureProjection.Project(bar, psi, precision, UnitPref.Metric);

        Assert.Equal(hasValue, projection.HasValue);
        Assert.Equal(expectedText, projection.Text);
        Assert.Equal(expectedTooltip, projection.Tooltip);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Pressure", PressureViewModel.Slug);

    [Fact]
    public void ViewModel_initial_projection_reflects_the_inputs_and_unit_source()
    {
        using var viewModel = new PressureViewModel(bar: 2.5, StaticPressureUnitSource.Metric);

        Assert.True(viewModel.HasValue);
        Assert.Equal("250.00 kPa", viewModel.Text);
        Assert.Equal("2.50 bar", viewModel.Tooltip);
        Assert.Equal(2.5, viewModel.Bar);
        Assert.Null(viewModel.Psi);
    }

    [Fact]
    public void ViewModel_set_inputs_pushes_new_props_and_raises_changes()
    {
        using var viewModel = new PressureViewModel(bar: 2.5, StaticPressureUnitSource.Metric);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetInputs(bar: 3.0, psi: null, precision: null);

        Assert.Equal("300.00 kPa", viewModel.Text);
        Assert.Equal(3.0, viewModel.Bar);
        Assert.Contains(nameof(PressureViewModel.Projection), changed);
        Assert.Contains(nameof(PressureViewModel.Bar), changed);
        Assert.Contains(nameof(PressureViewModel.Text), changed);
        Assert.Contains(nameof(PressureViewModel.AccessibleName), changed);
    }

    [Fact]
    public void ViewModel_set_inputs_is_a_no_op_for_unchanged_inputs()
    {
        using var viewModel = new PressureViewModel(bar: 2.5, StaticPressureUnitSource.Metric);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetInputs(bar: 2.5, psi: null, precision: null);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_transition_to_empty_raises_has_value_change()
    {
        using var viewModel = new PressureViewModel(bar: 2.5, StaticPressureUnitSource.Metric);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetInputs(bar: null, psi: null, precision: null);

        Assert.False(viewModel.HasValue);
        Assert.Equal(EmDash, viewModel.Text);
        Assert.Null(viewModel.Tooltip);
        Assert.Contains(nameof(PressureViewModel.HasValue), changed);
        Assert.Contains(nameof(PressureViewModel.Tooltip), changed);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_units_change()
    {
        var source = new FakeUnitSource(UnitPref.Metric);
        using var viewModel = new PressureViewModel(bar: 2.5, source);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.Set(UnitPref.Imperial);

        // The user flipped to imperial: 2.5 bar now renders in psi; the bar input is unchanged.
        Assert.Equal("36.26 psi", viewModel.Text);
        Assert.Equal(2.5, viewModel.Bar);
        Assert.Contains(nameof(PressureViewModel.Projection), changed);
        Assert.Contains(nameof(PressureViewModel.Text), changed);
        Assert.DoesNotContain(nameof(PressureViewModel.Bar), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_units_change_is_a_no_op()
    {
        var source = new FakeUnitSource(UnitPref.Metric);
        using var viewModel = new PressureViewModel(bar: 2.5, source);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        source.Set(UnitPref.Metric);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_unit_source()
    {
        var source = new FakeUnitSource(UnitPref.Metric);
        var viewModel = new PressureViewModel(bar: 2.5, source);
        Assert.Equal(1, source.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, source.ObserverCount);

        // After dispose a late change must not move the projection.
        source.Set(UnitPref.Imperial);
        Assert.Equal("250.00 kPa", viewModel.Text);
    }

    [Fact]
    public void ViewModel_throws_when_the_unit_source_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => new PressureViewModel(2.5, unitSource: null!));
        Assert.Throws<ArgumentNullException>(() => new PressureViewModel(2.5, null, null, unitSource: null!));
    }

    // ── accessibility: the formatted reading is the surface's accessible name ─────────────────────────────

    [Fact]
    public void Accessible_name_is_the_formatted_reading_in_the_value_state()
    {
        using var viewModel = new PressureViewModel(bar: 2.5, StaticPressureUnitSource.Metric);

        Assert.Equal("250.00 kPa", viewModel.AccessibleName);
        Assert.Equal(viewModel.Text, viewModel.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_the_em_dash_in_the_empty_state()
    {
        using var viewModel = new PressureViewModel(bar: null, StaticPressureUnitSource.Metric);

        Assert.Equal(EmDash, viewModel.AccessibleName);
    }

    // ── settings-bound unit source (production P1/S8 binding) ─────────────────────────────────────────────

    [Fact]
    public void Settings_unit_source_reads_the_current_preference()
    {
        var settings = NewSettingsService();
        var source = new SettingsPressureUnitSource(settings);

        // Default settings are metric (UnitSystemPreference.Metric -> kPa).
        Assert.Equal(PressureUnit.Kpa, source.Current.Pressure);
    }

    [Fact]
    public async Task Settings_unit_source_forwards_committed_changes()
    {
        var settings = NewSettingsService();
        var source = new SettingsPressureUnitSource(settings);
        var received = new List<PressureUnit>();
        using var subscription = source.Observe(p => received.Add(p.Pressure));

        await settings.UpdateAsync(s => s with { Units = UnitSystemPreference.Imperial });

        Assert.Contains(PressureUnit.Psi, received);
    }

    [Fact]
    public async Task Settings_unit_source_dispose_stops_forwarding()
    {
        var settings = NewSettingsService();
        var source = new SettingsPressureUnitSource(settings);
        var received = new List<PressureUnit>();
        var subscription = source.Observe(p => received.Add(p.Pressure));

        subscription.Dispose();
        await settings.UpdateAsync(s => s with { Units = UnitSystemPreference.Imperial });

        Assert.Empty(received);
    }

    [Fact]
    public void Settings_unit_source_throws_when_the_service_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new SettingsPressureUnitSource(settings: null!));

    [Fact]
    public void Static_unit_source_throws_when_observe_callback_is_null() =>
        Assert.Throws<ArgumentNullException>(() => StaticPressureUnitSource.Metric.Observe(onChanged: null!));

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PressureDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Pressure", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new PressureDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private static AppSettingsService NewSettingsService() => new(new InMemoryAppSettingsStore());

    private sealed class FakeUnitSource : IPressureUnitSource
    {
        private readonly List<Action<UnitPref>> _observers = new();
        private UnitPref _pref;

        public FakeUnitSource(UnitPref pref) => _pref = pref;

        public UnitPref Current => _pref;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<UnitPref> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(UnitPref pref)
        {
            _pref = pref;
            foreach (var observer in _observers.ToArray())
            {
                observer(pref);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeUnitSource _owner;
            private readonly Action<UnitPref> _observer;
            private bool _disposed;

            public Subscription(FakeUnitSource owner, Action<UnitPref> observer)
            {
                _owner = owner;
                _observer = observer;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _owner._observers.Remove(_observer);
            }
        }
    }
}
