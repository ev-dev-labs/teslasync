using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Speed surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the web fold factors + precision defaults), the pure <see cref="SpeedProjection"/> adapter
/// (mph-first / km/h-fallback / empty branch, SI fold + <c>convertSpeedFromSI</c> reconversion, en-US formatting,
/// precision resolution, and the <c>toFixed(1)</c> hover title), the <see cref="SpeedViewModel"/> state holder
/// (initial projection, runtime input pushes, runtime unit-preference toggle, subscription cleanup), the
/// <see cref="IUnitPreferenceSource"/> adapters (static + the <see cref="AppSettingsUnitPreferenceSource"/>
/// settings binding), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/data-display/format/Speed.tsx). The WinUI view (shared-surfaces/Speed.cs) is exercised by
/// the app build. Because the component reads no network data, there is no loading / error / stale / offline
/// state; the reproduced render branches are the mph value, the km/h value, and the empty fallback.
/// </summary>
public sealed class SpeedTests
{
    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Speed", SpeedRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("speed", SpeedRegistration.RootAutomationId);

    [Fact]
    public void Defaults_and_fold_factors_match_the_web_source()
    {
        // web: fmtNumber default precision = _globalPrecision = 2; title uses toFixed(1).
        Assert.Equal(2, SpeedRegistration.DefaultPrecision);
        Assert.Equal(1, SpeedRegistration.SourceTitlePrecision);

        // web: mph * 0.44704; kmh * 1000 / 3600.
        Assert.Equal(0.44704, SpeedRegistration.MetersPerSecondPerMph);
        Assert.Equal(1000.0, SpeedRegistration.MetersPerKilometer);
        Assert.Equal(3600.0, SpeedRegistration.SecondsPerHour);
    }

    // ── projection adapter (web component body) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_renders_mph_in_imperial_with_a_round_trip()
    {
        var projection = SpeedProjection.Project(mph: 60, kmh: null, precision: 2, UnitPref.Imperial);

        Assert.True(projection.HasValue);
        Assert.Equal(SpeedSource.MilesPerHour, projection.Source);
        Assert.Equal("60.00 mph", projection.DisplayText);
        Assert.Equal("60.0 mph", projection.Title);
        Assert.Equal(SpeedUnit.Mph, projection.Unit);
    }

    [Fact]
    public void Projection_converts_mph_to_metric_display()
    {
        // 60 mph -> 26.8224 m/s -> 96.56064 km/h (web convertSpeedFromSI to km/h), formatted at precision 2.
        var projection = SpeedProjection.Project(mph: 60, kmh: null, precision: 2, UnitPref.Metric);

        Assert.Equal("96.56 km/h", projection.DisplayText);
        // The hover title always shows the raw caller value in its source unit (mph), not the display unit.
        Assert.Equal("60.0 mph", projection.Title);
    }

    [Fact]
    public void Projection_renders_kmh_in_metric_with_a_round_trip()
    {
        var projection = SpeedProjection.Project(mph: null, kmh: 100, precision: 2, UnitPref.Metric);

        Assert.Equal(SpeedSource.KilometersPerHour, projection.Source);
        Assert.Equal("100.00 km/h", projection.DisplayText);
        Assert.Equal("100.0 km/h", projection.Title);
    }

    [Fact]
    public void Projection_converts_kmh_to_imperial_display()
    {
        // 100 km/h -> 27.77778 m/s -> 62.137 mph, formatted at precision 2.
        var projection = SpeedProjection.Project(mph: null, kmh: 100, precision: 2, UnitPref.Imperial);

        Assert.Equal("62.14 mph", projection.DisplayText);
        Assert.Equal("100.0 km/h", projection.Title);
    }

    [Fact]
    public void Projection_prefers_mph_when_both_inputs_are_present()
    {
        // web: mph is checked first; kmh is only the fallback.
        var projection = SpeedProjection.Project(mph: 60, kmh: 100, precision: 2, UnitPref.Imperial);

        Assert.Equal(SpeedSource.MilesPerHour, projection.Source);
        Assert.Equal("60.00 mph", projection.DisplayText);
        Assert.Equal("60.0 mph", projection.Title);
    }

    [Fact]
    public void Projection_falls_back_to_kmh_when_mph_is_not_finite()
    {
        var projection = SpeedProjection.Project(mph: double.NaN, kmh: 50, precision: 2, UnitPref.Metric);

        Assert.Equal(SpeedSource.KilometersPerHour, projection.Source);
        Assert.Equal("50.00 km/h", projection.DisplayText);
    }

    [Fact]
    public void Projection_is_empty_when_no_input_is_supplied()
    {
        var projection = SpeedProjection.Project(mph: null, kmh: null, precision: 2, UnitPref.Metric);

        Assert.False(projection.HasValue);
        Assert.Equal(SpeedSource.None, projection.Source);
        // web: bare `—` span with no title.
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, projection.DisplayText);
        Assert.Null(projection.Title);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Projection_is_empty_for_non_finite_inputs(double bad)
    {
        var projection = SpeedProjection.Project(mph: bad, kmh: bad, precision: 2, UnitPref.Imperial);

        Assert.False(projection.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, projection.DisplayText);
    }

    [Fact]
    public void Projection_honours_a_custom_empty_display()
    {
        var pref = UnitPref.Metric with { EmptyDisplay = "n/a" };

        var projection = SpeedProjection.Project(mph: null, kmh: null, precision: 2, pref);

        Assert.Equal("n/a", projection.DisplayText);
    }

    [Fact]
    public void Projection_groups_thousands_in_display_but_not_in_the_title()
    {
        // 12,345 km/h round-trips to 12,345 km/h; the display groups (Intl.NumberFormat), toFixed(1) does not.
        var projection = SpeedProjection.Project(mph: null, kmh: 12345, precision: 0, UnitPref.Metric);

        Assert.Equal("12,345 km/h", projection.DisplayText);
        Assert.Equal("12345.0 km/h", projection.Title);
    }

    [Fact]
    public void Projection_explicit_precision_wins_over_the_default()
    {
        Assert.Equal("60 mph", SpeedProjection.Project(60, null, precision: 0, UnitPref.Imperial).DisplayText);
        Assert.Equal("60.000 mph", SpeedProjection.Project(60, null, precision: 3, UnitPref.Imperial).DisplayText);
    }

    [Fact]
    public void Projection_uses_the_default_precision_when_none_is_supplied()
    {
        // web: precision ?? _globalPrecision (default 2). UnitPref.Imperial.Precision is null -> 2.
        var projection = SpeedProjection.Project(mph: 60, kmh: null, precision: null, UnitPref.Imperial);

        Assert.Equal(2, projection.Precision);
        Assert.Equal("60.00 mph", projection.DisplayText);
    }

    [Fact]
    public void Projection_uses_the_pref_precision_when_no_per_call_precision()
    {
        // The UnitPref.Precision is the _globalPrecision analog and wins over the hard default.
        var pref = UnitPref.Imperial with { Precision = 0 };

        var projection = SpeedProjection.Project(mph: 60, kmh: null, precision: null, pref);

        Assert.Equal(0, projection.Precision);
        Assert.Equal("60 mph", projection.DisplayText);
    }

    [Fact]
    public void Projection_clamps_negative_precision_to_zero()
    {
        var projection = SpeedProjection.Project(mph: 60, kmh: null, precision: -3, UnitPref.Imperial);

        Assert.Equal(0, projection.Precision);
        Assert.Equal("60 mph", projection.DisplayText);
    }

    [Fact]
    public void Projection_throws_when_the_pref_is_null() =>
        Assert.Throws<ArgumentNullException>(() => SpeedProjection.Project(60, null, 2, pref: null!));

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = SpeedProjection.Project(60, null, 2, UnitPref.Imperial);
        var b = SpeedProjection.Project(60, null, 2, UnitPref.Imperial);
        var different = SpeedProjection.Project(60, null, 2, UnitPref.Metric);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Theory]
    [InlineData(60.0, null, 2, false, "60.00 mph", "60.0 mph")]    // mph, imperial
    [InlineData(0.0, null, 2, false, "0.00 mph", "0.0 mph")]       // zero, imperial
    [InlineData(60.0, null, 2, true, "96.56 km/h", "60.0 mph")]    // mph, metric display
    [InlineData(null, 100.0, 2, true, "100.00 km/h", "100.0 km/h")] // kmh, metric
    [InlineData(null, 100.0, 2, false, "62.14 mph", "100.0 km/h")]  // kmh, imperial display
    public void Projection_snapshot_per_state(double? mph, double? kmh, int precision, bool metric, string expectedDisplay, string expectedTitle)
    {
        UnitPref pref = metric ? UnitPref.Metric : UnitPref.Imperial;

        var projection = SpeedProjection.Project(mph, kmh, precision, pref);

        Assert.Equal(expectedDisplay, projection.DisplayText);
        Assert.Equal(expectedTitle, projection.Title);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Speed", SpeedViewModel.Slug);

    [Fact]
    public void ViewModel_initial_projection_reflects_the_inputs_and_source()
    {
        using var viewModel = new SpeedViewModel(60, StaticUnitPreferenceSource.Imperial);

        Assert.True(viewModel.HasValue);
        Assert.Equal("60.00 mph", viewModel.DisplayText);
        Assert.Equal("60.0 mph", viewModel.Title);
        Assert.Equal("60.00 mph", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_empty_when_no_input()
    {
        using var viewModel = new SpeedViewModel(null, null, null, StaticUnitPreferenceSource.Metric);

        Assert.False(viewModel.HasValue);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, viewModel.DisplayText);
        Assert.Null(viewModel.Title);
    }

    [Fact]
    public void ViewModel_set_mph_pushes_a_value_and_raises_changes()
    {
        using var viewModel = new SpeedViewModel(null, null, null, StaticUnitPreferenceSource.Imperial);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetMph(60);

        Assert.Equal("60.00 mph", viewModel.DisplayText);
        Assert.Contains(nameof(SpeedViewModel.Mph), changed);
        Assert.Contains(nameof(SpeedViewModel.Projection), changed);
        Assert.Contains(nameof(SpeedViewModel.DisplayText), changed);
        Assert.Contains(nameof(SpeedViewModel.AccessibleName), changed);
        Assert.Contains(nameof(SpeedViewModel.Title), changed);
        Assert.Contains(nameof(SpeedViewModel.HasValue), changed);
    }

    [Fact]
    public void ViewModel_set_mph_is_a_no_op_for_an_unchanged_value()
    {
        using var viewModel = new SpeedViewModel(42, StaticUnitPreferenceSource.Imperial);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetMph(42);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_kmh_pushes_a_value()
    {
        using var viewModel = new SpeedViewModel(null, null, null, StaticUnitPreferenceSource.Metric);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetKmh(100);

        Assert.Equal("100.00 km/h", viewModel.DisplayText);
        Assert.Equal("100.0 km/h", viewModel.Title);
        Assert.Contains(nameof(SpeedViewModel.Kmh), changed);
    }

    [Fact]
    public void ViewModel_set_precision_reprojects()
    {
        using var viewModel = new SpeedViewModel(60, 0, null, StaticUnitPreferenceSource.Imperial);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetPrecision(0);

        Assert.Equal("60 mph", viewModel.DisplayText);
        Assert.Contains(nameof(SpeedViewModel.Precision), changed);
        Assert.Contains(nameof(SpeedViewModel.DisplayText), changed);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_unit_preference_change()
    {
        var units = new FakeUnitPreferenceSource(UnitPref.Metric);
        using var viewModel = new SpeedViewModel(60, units);
        // 60 mph displayed in metric is km/h.
        Assert.Equal("96.56 km/h", viewModel.DisplayText);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        units.Set(UnitPref.Imperial);

        Assert.Equal("60.00 mph", viewModel.DisplayText);
        Assert.Contains(nameof(SpeedViewModel.UnitPreference), changed);
        Assert.Contains(nameof(SpeedViewModel.Projection), changed);
        Assert.Contains(nameof(SpeedViewModel.DisplayText), changed);
        // The raw source value did not change, so the title is unchanged and not re-raised.
        Assert.DoesNotContain(nameof(SpeedViewModel.Title), changed);
        Assert.Equal("60.0 mph", viewModel.Title);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_unit_change_is_a_no_op()
    {
        var units = new FakeUnitPreferenceSource(UnitPref.Metric);
        using var viewModel = new SpeedViewModel(60, units);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        units.Set(UnitPref.Metric);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_preference_source()
    {
        var units = new FakeUnitPreferenceSource(UnitPref.Metric);
        var viewModel = new SpeedViewModel(60, units);
        Assert.Equal(1, units.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, units.ObserverCount);

        // After dispose a late change must not move the projection.
        units.Set(UnitPref.Imperial);
        Assert.Equal("96.56 km/h", viewModel.DisplayText);
    }

    [Fact]
    public void ViewModel_throws_when_the_source_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => new SpeedViewModel(60, units: null!));
        Assert.Throws<ArgumentNullException>(() => new SpeedViewModel(60, null, null, units: null!));
    }

    // ── source adapters (P1/S8 useUnits seam) ─────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_reports_its_fixed_preference()
    {
        Assert.Same(UnitPref.Metric, StaticUnitPreferenceSource.Metric.Current);
        Assert.Same(UnitPref.Imperial, StaticUnitPreferenceSource.Imperial.Current);
    }

    [Fact]
    public async Task AppSettingsSource_projects_the_measurement_system()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore(
            AppSettings.Default with { Units = UnitSystemPreference.Imperial }));
        // Production loads persisted settings at startup (AppSettingsHost.InitializeAsync -> LoadAsync).
        await service.LoadAsync();
        var source = new AppSettingsUnitPreferenceSource(service);

        Assert.Same(UnitPref.Imperial, source.Current);
        Assert.Equal(SpeedUnit.Mph, source.Current.Speed);
    }

    [Fact]
    public async Task AppSettingsSource_fires_on_a_unit_change()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore());
        var source = new AppSettingsUnitPreferenceSource(service);
        var received = new List<UnitPref>();
        using var subscription = source.Observe(received.Add);

        await service.UpdateAsync(s => s with { Units = UnitSystemPreference.Imperial });

        Assert.Same(UnitPref.Imperial, Assert.Single(received));
    }

    [Fact]
    public async Task AppSettingsSource_ignores_changes_that_do_not_affect_units()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore());
        var source = new AppSettingsUnitPreferenceSource(service);
        var received = new List<UnitPref>();
        using var subscription = source.Observe(received.Add);

        await service.UpdateAsync(s => s with { Theme = AppThemePreference.Dark });

        Assert.Empty(received);
    }

    [Fact]
    public async Task AppSettingsSource_dispose_stops_firing()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore());
        var source = new AppSettingsUnitPreferenceSource(service);
        var received = new List<UnitPref>();
        var subscription = source.Observe(received.Add);

        subscription.Dispose();
        await service.UpdateAsync(s => s with { Units = UnitSystemPreference.Imperial });

        Assert.Empty(received);
    }

    // ── accessibility: the converted value is the surface's accessible name ───────────────────────────────

    [Fact]
    public void Accessible_name_is_the_visible_readout()
    {
        using var withValue = new SpeedViewModel(60, StaticUnitPreferenceSource.Imperial);
        using var empty = new SpeedViewModel(null, null, null, StaticUnitPreferenceSource.Metric);

        // The view sets AutomationProperties.Name to the projection's AccessibleName (= DisplayText).
        Assert.Equal("60.00 mph", withValue.AccessibleName);
        Assert.Equal(withValue.DisplayText, withValue.AccessibleName);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, empty.AccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Speed", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new SpeedDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(SpeedRegistration.Slug, line, StringComparison.Ordinal);
    }

    /// <summary>
    /// A test <see cref="IUnitPreferenceSource"/> that can push runtime preference changes and reports its live
    /// observer count — the Speed analogue of the AnimatedNumber FakeMotionSource, used to verify the view-model's
    /// reactive re-render on a measurement-system toggle and its subscription cleanup.
    /// </summary>
    private sealed class FakeUnitPreferenceSource : IUnitPreferenceSource
    {
        private readonly List<Action<UnitPref>> _observers = new();
        private UnitPref _current;

        public FakeUnitPreferenceSource(UnitPref current) => _current = current;

        public UnitPref Current => _current;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<UnitPref> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(UnitPref pref)
        {
            _current = pref;
            foreach (var observer in _observers.ToArray())
            {
                observer(pref);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeUnitPreferenceSource _owner;
            private readonly Action<UnitPref> _observer;
            private bool _disposed;

            public Subscription(FakeUnitPreferenceSource owner, Action<UnitPref> observer)
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
