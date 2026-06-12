using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the StaggerItem surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the web entrance constants), the pure <see cref="StaggerItemProjection"/> adapter
/// (the <c>useMotionPreference(350)</c> reduce-motion duration collapse, the animate decision, and the
/// from/to opacity + vertical-offset endpoints), the <see cref="StaggerItemViewModel"/> state holder (initial
/// projection, runtime motion toggle, subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/motion/StaggerItem.tsx). The WinUI view (shared-surfaces/StaggerItem.cs) is exercised by
/// the app build. Because the component reads no network data, there is no loading / error / stale / offline
/// state; the reproduced render branches are the full-motion fade-and-rise and the reduced-motion /
/// zero-duration instant settle.
/// </summary>
public sealed class StaggerItemTests
{
    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("StaggerItem", StaggerItemRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("stagger-item", StaggerItemRegistration.RootAutomationId);

    [Fact]
    public void Entrance_constants_match_the_web_source()
    {
        // web: useMotionPreference(350); hidden { opacity: 0, y: 15 }; show { opacity: 1, y: 0 }.
        Assert.Equal(350, StaggerItemRegistration.DefaultDurationMs);
        Assert.Equal(15.0, StaggerItemRegistration.HiddenOffsetY);
        Assert.Equal(0.0, StaggerItemRegistration.ShownOffsetY);
        Assert.Equal(0.0, StaggerItemRegistration.HiddenOpacity);
        Assert.Equal(1.0, StaggerItemRegistration.ShownOpacity);
    }

    // ── projection adapter (web component body: useMotionPreference + hidden/show variants) ───────────────

    [Fact]
    public void Projection_animates_when_motion_is_allowed_and_duration_is_positive()
    {
        var projection = StaggerItemProjection.Project(350, reduceMotion: false);

        Assert.True(projection.Animate);
        Assert.Equal(350, projection.DurationMs);
        Assert.Equal(0.35, projection.DurationSeconds, 5);
    }

    [Fact]
    public void Projection_full_motion_starts_faded_and_below_and_settles_in_place()
    {
        var projection = StaggerItemProjection.Project(350, reduceMotion: false);

        // web hidden { opacity: 0, y: 15 } -> show { opacity: 1, y: 0 }.
        Assert.Equal(0.0, projection.FromOpacity);
        Assert.Equal(15.0, projection.FromOffsetY);
        Assert.Equal(1.0, projection.ToOpacity);
        Assert.Equal(0.0, projection.ToOffsetY);
    }

    [Fact]
    public void Projection_does_not_animate_under_reduced_motion()
    {
        var projection = StaggerItemProjection.Project(350, reduceMotion: true);

        // web useMotionPreference: durationMs collapses to 0; hidden variant becomes { opacity: 1, y: 0 }.
        Assert.False(projection.Animate);
        Assert.Equal(0, projection.DurationMs);
        Assert.Equal(0.0, projection.DurationSeconds);
    }

    [Fact]
    public void Projection_reduced_motion_renders_straight_in_the_final_state()
    {
        var projection = StaggerItemProjection.Project(350, reduceMotion: true);

        // No flash: the from-endpoints equal the resting state so the child appears in place immediately.
        Assert.Equal(1.0, projection.FromOpacity);
        Assert.Equal(0.0, projection.FromOffsetY);
        Assert.Equal(1.0, projection.ToOpacity);
        Assert.Equal(0.0, projection.ToOffsetY);
    }

    [Fact]
    public void Projection_does_not_animate_when_duration_is_zero()
    {
        var projection = StaggerItemProjection.Project(0, reduceMotion: false);

        Assert.False(projection.Animate);
        Assert.Equal(1.0, projection.FromOpacity);
        Assert.Equal(0.0, projection.FromOffsetY);
    }

    [Fact]
    public void Projection_clamps_negative_duration_to_zero_and_does_not_animate()
    {
        var projection = StaggerItemProjection.Project(-120, reduceMotion: false);

        Assert.Equal(0, projection.DurationMs);
        Assert.False(projection.Animate);
    }

    [Fact]
    public void Projection_honours_a_custom_positive_duration()
    {
        var projection = StaggerItemProjection.Project(600, reduceMotion: false);

        Assert.True(projection.Animate);
        Assert.Equal(600, projection.DurationMs);
        Assert.Equal(0.6, projection.DurationSeconds, 5);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = StaggerItemProjection.Project(350, reduceMotion: false);
        var b = StaggerItemProjection.Project(350, reduceMotion: false);
        var different = StaggerItemProjection.Project(350, reduceMotion: true);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── per-state "snapshot": each render state projects exact, stable values ─────────────────────────────

    [Theory]
    [InlineData(350, false, true, 0.0, 15.0, 350)]
    [InlineData(350, true, false, 1.0, 0.0, 0)]
    [InlineData(0, false, false, 1.0, 0.0, 0)]
    [InlineData(600, false, true, 0.0, 15.0, 600)]
    [InlineData(600, true, false, 1.0, 0.0, 0)]
    public void Projection_snapshot_per_state(int durationMs, bool reduceMotion, bool expectedAnimate, double expectedFromOpacity, double expectedFromOffsetY, int expectedDurationMs)
    {
        var projection = StaggerItemProjection.Project(durationMs, reduceMotion);

        Assert.Equal(expectedAnimate, projection.Animate);
        Assert.Equal(expectedFromOpacity, projection.FromOpacity);
        Assert.Equal(expectedFromOffsetY, projection.FromOffsetY);
        Assert.Equal(expectedDurationMs, projection.DurationMs);

        // The resting state is invariant across every branch.
        Assert.Equal(1.0, projection.ToOpacity);
        Assert.Equal(0.0, projection.ToOffsetY);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("StaggerItem", StaggerItemViewModel.Slug);

    [Fact]
    public void ViewModel_default_ctor_uses_the_web_default_duration_and_full_motion()
    {
        using var viewModel = new StaggerItemViewModel(StaticMotionPreferenceSource.FullMotion);

        Assert.True(viewModel.Animate);
        Assert.Equal(350, viewModel.DurationMs);
        Assert.Equal(0.35, viewModel.DurationSeconds, 5);
        Assert.Equal(0.0, viewModel.FromOpacity);
        Assert.Equal(15.0, viewModel.FromOffsetY);
        Assert.Equal(1.0, viewModel.ToOpacity);
        Assert.Equal(0.0, viewModel.ToOffsetY);
    }

    [Fact]
    public void ViewModel_starts_reduced_when_the_motion_source_reports_reduced()
    {
        using var viewModel = new StaggerItemViewModel(StaticMotionPreferenceSource.Reduced);

        Assert.False(viewModel.Animate);
        Assert.Equal(0, viewModel.DurationMs);
        Assert.Equal(1.0, viewModel.FromOpacity);
        Assert.Equal(0.0, viewModel.FromOffsetY);
    }

    [Fact]
    public void ViewModel_honours_an_explicit_duration()
    {
        using var viewModel = new StaggerItemViewModel(500, StaticMotionPreferenceSource.FullMotion);

        Assert.True(viewModel.Animate);
        Assert.Equal(500, viewModel.DurationMs);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new StaggerItemViewModel(motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(StaggerItemViewModel.Projection), changed);
        Assert.Contains(nameof(StaggerItemViewModel.Animate), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_motion_change_is_a_no_op()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new StaggerItemViewModel(motion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_motion_source()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new StaggerItemViewModel(motion);
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
        Assert.Throws<ArgumentNullException>(() => new StaggerItemViewModel(motion: null!));
        Assert.Throws<ArgumentNullException>(() => new StaggerItemViewModel(350, motion: null!));
    }

    // ── accessibility: the wrapper is an anonymous, transparent group hook ────────────────────────────────

    [Fact]
    public void Accessibility_stable_hook_is_the_root_automation_id()
    {
        // The view stamps this id on itself and exposes no name of its own (the hosted child carries the
        // meaningful semantics — see StaggerItem.cs StaggerAutomationPeer).
        Assert.Equal("stagger-item", StaggerItemRegistration.RootAutomationId);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new StaggerItemDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StaggerItem", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new StaggerItemDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new StaggerItemDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(StaggerItemRegistration.Slug, line, StringComparison.Ordinal);
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
