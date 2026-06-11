using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AnimatedNumber surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the web prop defaults), the pure <see cref="AnimatedNumberProjection"/> adapter
/// (locale formatting + prefix/suffix + decimals/duration clamping + the reduced-motion / zero-duration snap
/// branch), the <see cref="AnimatedNumberViewModel"/> state holder (initial projection, runtime value push,
/// runtime motion toggle, subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/data-display/AnimatedNumber.tsx). The WinUI view (shared-surfaces/AnimatedNumber.cs) is
/// exercised by the app build. Because the component reads no network data, there is no loading / error / stale
/// / offline state; the reproduced render branches are the full-motion count-up, the reduced-motion /
/// zero-duration snap, and the with/without prefix-suffix and decimals variants.
/// </summary>
public sealed class AnimatedNumberTests
{
    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AnimatedNumber", AnimatedNumberRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("animated-number", AnimatedNumberRegistration.RootAutomationId);

    [Fact]
    public void Prop_defaults_match_the_web_source()
    {
        // web: duration = 1, decimals = 0, const from = 0.
        Assert.Equal(1.0, AnimatedNumberRegistration.DefaultDurationSeconds);
        Assert.Equal(0, AnimatedNumberRegistration.DefaultDecimals);
        Assert.Equal(0.0, AnimatedNumberRegistration.StartValue);
    }

    // ── projection adapter (web component body: fmtNumber(display, decimals), ease-out tween) ─────────────

    [Fact]
    public void Projection_formats_the_target_with_en_us_grouping()
    {
        var projection = AnimatedNumberProjection.Project(1234567, decimals: 0, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.Equal("1,234,567", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_honours_decimals()
    {
        var projection = AnimatedNumberProjection.Project(3.14159, decimals: 2, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.Equal("3.14", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_wraps_the_number_in_prefix_and_suffix()
    {
        var projection = AnimatedNumberProjection.Project(1234, decimals: 0, prefix: "$", suffix: " kWh", durationSeconds: 1, reduceMotion: false);

        Assert.Equal("$1,234 kWh", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_treats_null_prefix_and_suffix_as_empty()
    {
        var projection = AnimatedNumberProjection.Project(42, decimals: 0, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.Equal(string.Empty, projection.Prefix);
        Assert.Equal(string.Empty, projection.Suffix);
        Assert.Equal("42", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_formats_an_intermediate_frame()
    {
        var projection = AnimatedNumberProjection.Project(100, decimals: 0, prefix: "~", suffix: "%", durationSeconds: 1, reduceMotion: false);

        // The view renders each tween frame through Format(); mid-animation the value is between 0 and 100.
        Assert.Equal("~50%", projection.Format(50));
        Assert.Equal("~0%", projection.Format(AnimatedNumberRegistration.StartValue));
    }

    [Fact]
    public void Projection_formats_negative_values()
    {
        var projection = AnimatedNumberProjection.Project(-1234, decimals: 0, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.Equal("-1,234", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_clamps_negative_decimals_to_zero()
    {
        var projection = AnimatedNumberProjection.Project(42.7, decimals: -3, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.Equal(0, projection.Decimals);
        Assert.Equal("43", projection.FormattedTarget);
    }

    [Fact]
    public void Projection_clamps_negative_duration_to_zero_and_does_not_animate()
    {
        var projection = AnimatedNumberProjection.Project(100, decimals: 0, prefix: null, suffix: null, durationSeconds: -5, reduceMotion: false);

        Assert.Equal(0, projection.DurationSeconds);
        Assert.False(projection.Animate);
    }

    [Fact]
    public void Projection_start_value_is_zero()
    {
        // web: const from = 0 — every count-up starts from zero.
        Assert.Equal(0.0, AnimatedNumberRegistration.StartValue);
    }

    [Fact]
    public void Projection_animates_when_motion_is_allowed_and_duration_is_positive()
    {
        var projection = AnimatedNumberProjection.Project(100, decimals: 0, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: false);

        Assert.True(projection.Animate);
    }

    [Fact]
    public void Projection_does_not_animate_under_reduced_motion()
    {
        var projection = AnimatedNumberProjection.Project(100, decimals: 0, prefix: null, suffix: null, durationSeconds: 1, reduceMotion: true);

        // web prefers-reduced-motion: the readout snaps straight to its final value.
        Assert.False(projection.Animate);
    }

    [Fact]
    public void Projection_does_not_animate_when_duration_is_zero()
    {
        var projection = AnimatedNumberProjection.Project(100, decimals: 0, prefix: null, suffix: null, durationSeconds: 0, reduceMotion: false);

        Assert.False(projection.Animate);
    }

    [Fact]
    public void Projection_throws_for_nothing_and_is_pure()
    {
        // Project is a pure value-returning function (no nullable required args beyond prefix/suffix); a blank
        // prefix/suffix is accepted and normalised rather than throwing.
        var a = AnimatedNumberProjection.Project(7, 0, "", "", 1, false);
        var b = AnimatedNumberProjection.Project(7, 0, null, null, 1, false);

        Assert.Equal(a, b);
    }

    // ── per-state "snapshot": each render state projects an exact, stable value ───────────────────────────

    [Theory]
    [InlineData(0, 0, null, null, 1.0, false, "0", true)]
    [InlineData(1000, 0, null, null, 1.0, false, "1,000", true)]
    [InlineData(1000, 0, null, null, 1.0, true, "1,000", false)]
    [InlineData(1000, 0, null, null, 0.0, false, "1,000", false)]
    [InlineData(42.5, 1, "$", null, 1.0, false, "$42.5", true)]
    [InlineData(98.6, 1, null, "°", 2.0, true, "98.6°", false)]
    public void Projection_snapshot_per_state(double value, int decimals, string? prefix, string? suffix, double durationSeconds, bool reduceMotion, string expectedTarget, bool expectedAnimate)
    {
        var projection = AnimatedNumberProjection.Project(value, decimals, prefix, suffix, durationSeconds, reduceMotion);

        Assert.Equal(expectedTarget, projection.FormattedTarget);
        Assert.Equal(expectedAnimate, projection.Animate);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = AnimatedNumberProjection.Project(100, 0, "$", null, 1, false);
        var b = AnimatedNumberProjection.Project(100, 0, "$", null, 1, false);
        var different = AnimatedNumberProjection.Project(100, 0, "$", null, 1, true);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("AnimatedNumber", AnimatedNumberViewModel.Slug);

    [Fact]
    public void ViewModel_default_ctor_uses_the_web_prop_defaults()
    {
        using var viewModel = new AnimatedNumberViewModel(5, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(5, viewModel.Value);
        Assert.Equal(0, viewModel.Decimals);
        Assert.Equal(1.0, viewModel.DurationSeconds);
        Assert.Equal(string.Empty, viewModel.Prefix);
        Assert.Equal(string.Empty, viewModel.Suffix);
        Assert.True(viewModel.Animate);
        Assert.Equal("5", viewModel.FormattedTarget);
    }

    [Fact]
    public void ViewModel_starts_reduced_when_the_motion_source_reports_reduced()
    {
        using var viewModel = new AnimatedNumberViewModel(50, 0, null, null, 1.0, StaticMotionPreferenceSource.Reduced);

        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_set_value_pushes_a_new_target_and_raises_changes()
    {
        using var viewModel = new AnimatedNumberViewModel(0, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetValue(100);

        Assert.Equal(100, viewModel.Value);
        Assert.Equal("100", viewModel.FormattedTarget);
        Assert.Contains(nameof(AnimatedNumberViewModel.Projection), changed);
        Assert.Contains(nameof(AnimatedNumberViewModel.Value), changed);
        Assert.Contains(nameof(AnimatedNumberViewModel.FormattedTarget), changed);
    }

    [Fact]
    public void ViewModel_set_value_is_a_no_op_for_an_unchanged_value()
    {
        using var viewModel = new AnimatedNumberViewModel(42, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetValue(42);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_value_still_restarts_when_the_formatted_target_is_unchanged()
    {
        using var viewModel = new AnimatedNumberViewModel(100.1, 0, null, null, 1.0, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // 100.1 and 100.2 both format to "100" at 0 decimals, but the raw value changed so the tween restarts.
        viewModel.SetValue(100.2);

        Assert.Equal("100", viewModel.FormattedTarget);
        Assert.Contains(nameof(AnimatedNumberViewModel.Projection), changed);
        Assert.Contains(nameof(AnimatedNumberViewModel.Value), changed);
        Assert.DoesNotContain(nameof(AnimatedNumberViewModel.FormattedTarget), changed);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new AnimatedNumberViewModel(50, 0, null, null, 1.0, motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(AnimatedNumberViewModel.Animate), changed);
        Assert.Contains(nameof(AnimatedNumberViewModel.Projection), changed);
        // A motion change does not alter the value or its formatted target.
        Assert.DoesNotContain(nameof(AnimatedNumberViewModel.Value), changed);
        Assert.Equal(50, viewModel.Value);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_motion_change_is_a_no_op()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new AnimatedNumberViewModel(50, motion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_motion_source()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new AnimatedNumberViewModel(50, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);
        Assert.True(viewModel.Animate);

        // After dispose a late change must not move the projection.
        motion.Set(reduceMotion: true);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_throws_when_the_motion_source_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => new AnimatedNumberViewModel(0, motion: null!));
        Assert.Throws<ArgumentNullException>(() => new AnimatedNumberViewModel(0, 0, null, null, 1.0, motion: null!));
    }

    // ── accessibility: the settled value is the surface's accessible name ─────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_settled_formatted_value()
    {
        using var viewModel = new AnimatedNumberViewModel(1234, 0, "$", null, 1.0, StaticMotionPreferenceSource.FullMotion);

        // The view sets AutomationProperties.Name (and the automation peer's name) to FormattedTarget — the
        // settled value, not the intermediate count-up frames (see AnimatedNumber.cs RenderFrame).
        Assert.Equal("$1,234", viewModel.FormattedTarget);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the value) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AnimatedNumberDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnimatedNumber", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AnimatedNumberDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new AnimatedNumberDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(AnimatedNumberRegistration.Slug, line, StringComparison.Ordinal);
    }

    private sealed class FakeMotionSource : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = new();
        private bool _reduceMotion;

        public FakeMotionSource(bool reduceMotion) => _reduceMotion = reduceMotion;

        public bool ReduceMotion => _reduceMotion;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(bool reduceMotion)
        {
            _reduceMotion = reduceMotion;
            foreach (var observer in _observers.ToArray())
            {
                observer(reduceMotion);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeMotionSource _owner;
            private readonly Action<bool> _observer;
            private bool _disposed;

            public Subscription(FakeMotionSource owner, Action<bool> observer)
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
