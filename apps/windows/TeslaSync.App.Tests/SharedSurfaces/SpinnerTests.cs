using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Spinner surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the ARIA role/live contract, the i18n key + fallback behind the default label, the size map,
/// the bolt geometry + its measured path length, the glow colours and the self-drawing keyframe timeline), the
/// pure <see cref="SpinnerProjection"/> adapter (size resolution, the reduced-motion vs full-motion branch, the
/// caption present/absent branch and the accessible-name contract), the <see cref="SpinnerViewModel"/> state
/// holder (initial projection, runtime size/label push, runtime motion toggle, subscription cleanup) and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/components/feedback/Spinner.tsx). The WinUI view
/// (shared-surfaces/Spinner.cs) is exercised by the app build. Because the component reads no network data, there
/// is no loading / error / stale / offline state — the spinner is itself the loading state; the reproduced render
/// branches are the full-motion self-drawing bolt, the reduced-motion static fill, the with/without caption
/// variants and the three size variants.
/// </summary>
public sealed class SpinnerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Spinner", SpinnerRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("spinner", SpinnerRegistration.RootAutomationId);

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web role="status": a polite status live region.
        Assert.Equal("status", SpinnerRegistration.StatusRole);
        Assert.Equal("polite", SpinnerRegistration.LiveSetting);
    }

    [Fact]
    public void Default_label_key_and_fallback_match_the_web_source()
    {
        // web aria-label={label ?? 'Loading'} — the default resolves through global.loading.
        Assert.Equal("translation.global.loading", SpinnerRegistration.DefaultLabelKey);
        Assert.Equal("Loading", SpinnerRegistration.DefaultLabelFallback);
        Assert.Equal("Loading", SpinnerRegistration.ResolveDefaultLabel(Localizer));
    }

    [Fact]
    public void Bolt_path_data_and_viewbox_match_the_web_source()
    {
        Assert.Equal("M112 30L62 108h34L78 170l58-82h-34z", SpinnerRegistration.BoltPathData);
        Assert.Equal(200, SpinnerRegistration.ViewBoxSize);
    }

    [Fact]
    public void Draw_duration_matches_the_web_keyframes() =>
        Assert.Equal(2000, SpinnerRegistration.DrawDurationMs);

    [Fact]
    public void Glow_colours_match_the_web_theme_primary_and_accent()
    {
        Assert.Equal("#22D3EE", SpinnerRegistration.GlowPrimaryHex);
        Assert.Equal("#10B981", SpinnerRegistration.GlowAccentHex);
    }

    [Theory]
    [InlineData(SpinnerSize.Small, 24, 22)]
    [InlineData(SpinnerSize.Medium, 48, 14)]
    [InlineData(SpinnerSize.Large, 80, 10)]
    public void Size_map_matches_the_web_source(SpinnerSize size, int pixels, double stroke)
    {
        SpinnerMetrics metrics = SpinnerRegistration.Resolve(size);

        Assert.Equal(pixels, metrics.Pixels);
        Assert.Equal(stroke, metrics.StrokeWidth);
    }

    // ── bolt geometry ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Bolt_vertices_resolve_the_web_relative_path_to_absolute_points()
    {
        // web d="M112 30L62 108h34L78 170l58-82h-34z" → six absolute vertices, then a close.
        Assert.Equal(6, SpinnerRegistration.BoltVertices.Count);
        Assert.Equal(new BoltPoint(112, 30), SpinnerRegistration.BoltVertices[0]);
        Assert.Equal(new BoltPoint(62, 108), SpinnerRegistration.BoltVertices[1]);
        Assert.Equal(new BoltPoint(96, 108), SpinnerRegistration.BoltVertices[2]);
        Assert.Equal(new BoltPoint(78, 170), SpinnerRegistration.BoltVertices[3]);
        Assert.Equal(new BoltPoint(136, 88), SpinnerRegistration.BoltVertices[4]);
        Assert.Equal(new BoltPoint(102, 88), SpinnerRegistration.BoltVertices[5]);
    }

    [Fact]
    public void Bolt_path_length_is_the_closed_perimeter()
    {
        // The closed bolt perimeter (~384.5 units) is the dash length the draw animation sweeps — the native
        // analogue of the web pathLength=100 normalisation.
        Assert.InRange(SpinnerRegistration.BoltPathLength, 384.4, 384.6);
    }

    // ── self-drawing keyframes (web @keyframes boltDraw) ──────────────────────────────────────────────────

    [Fact]
    public void Draw_keyframes_reproduce_the_boltDraw_timeline()
    {
        IReadOnlyList<SpinnerKeyframe> frames = SpinnerRegistration.DrawKeyframes;

        Assert.Equal(5, frames.Count);
        // 0% { stroke-dashoffset: 100; fill-opacity: 0; opacity: 0.15 }
        Assert.Equal(new SpinnerKeyframe(0.00, 1, 0, 0.15), frames[0]);
        // 30% { stroke-dashoffset: 0; fill-opacity: 0; opacity: 1 }
        Assert.Equal(new SpinnerKeyframe(0.30, 0, 0, 1.00), frames[1]);
        // 55% { stroke-dashoffset: 0; fill-opacity: 1; opacity: 1 }
        Assert.Equal(new SpinnerKeyframe(0.55, 0, 1, 1.00), frames[2]);
        // 80% { stroke-dashoffset: 0; fill-opacity: 1; opacity: 0.9 }
        Assert.Equal(new SpinnerKeyframe(0.80, 0, 1, 0.90), frames[3]);
        // 100% { stroke-dashoffset: -100; fill-opacity: 0; opacity: 0 }
        Assert.Equal(new SpinnerKeyframe(1.00, -1, 0, 0.00), frames[4]);
    }

    [Fact]
    public void Draw_keyframes_are_monotonic_in_time()
    {
        double previous = -1;
        foreach (SpinnerKeyframe frame in SpinnerRegistration.DrawKeyframes)
        {
            Assert.True(frame.Time > previous, $"keyframe time {frame.Time} must increase");
            previous = frame.Time;
        }
    }

    // ── projection adapter (web component body) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_defaults_to_the_medium_size_metrics()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Medium, label: null, reduceMotion: false, Localizer);

        Assert.Equal(SpinnerSize.Medium, projection.Size);
        Assert.Equal(48, projection.Pixels);
        Assert.Equal(14, projection.StrokeWidth);
    }

    [Fact]
    public void Projection_animates_and_starts_undrawn_under_full_motion()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Medium, label: null, reduceMotion: false, Localizer);

        // web: strokeDasharray=100, strokeDashoffset=100 (undrawn), fillOpacity=0, draw class applied.
        Assert.True(projection.Animate);
        Assert.True(projection.StrokeDashed);
        Assert.Equal(1.0, projection.InitialDashProgress);
        Assert.Equal(0.0, projection.FillOpacity);
    }

    [Fact]
    public void Projection_snaps_to_a_solid_fill_under_reduced_motion()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Large, label: null, reduceMotion: true, Localizer);

        // web prefers-reduced-motion: fillOpacity=1, strokeDasharray='none', strokeDashoffset=0, no draw class.
        Assert.False(projection.Animate);
        Assert.False(projection.StrokeDashed);
        Assert.Equal(0.0, projection.InitialDashProgress);
        Assert.Equal(1.0, projection.FillOpacity);
    }

    [Fact]
    public void Projection_without_a_label_hides_the_caption_and_uses_the_i18n_default_name()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Small, label: null, reduceMotion: false, Localizer);

        // web {label && <span>} hides the caption; aria-label falls back to 'Loading'.
        Assert.False(projection.HasLabel);
        Assert.Equal(string.Empty, projection.Label);
        Assert.Equal("Loading", projection.AccessibleName);
    }

    [Fact]
    public void Projection_with_a_label_shows_the_caption_and_names_the_region_with_it()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Medium, label: "Loading drives…", reduceMotion: false, Localizer);

        // web: the caller-supplied label is both the visible caption and the aria-label.
        Assert.True(projection.HasLabel);
        Assert.Equal("Loading drives…", projection.Label);
        Assert.Equal("Loading drives…", projection.AccessibleName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Projection_treats_blank_labels_as_absent(string? label)
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Medium, label, reduceMotion: false, Localizer);

        // A blank label is treated as absent so the status region keeps a meaningful name for Narrator.
        Assert.False(projection.HasLabel);
        Assert.Equal(string.Empty, projection.Label);
        Assert.Equal("Loading", projection.AccessibleName);
    }

    [Fact]
    public void Projection_trims_a_supplied_label()
    {
        var projection = SpinnerProjection.Project(SpinnerSize.Medium, "  Syncing  ", reduceMotion: false, Localizer);

        Assert.True(projection.HasLabel);
        Assert.Equal("Syncing", projection.Label);
        Assert.Equal("Syncing", projection.AccessibleName);
    }

    [Theory]
    [InlineData(SpinnerSize.Small, false, 24, 22, true, 1.0, 0.0)]
    [InlineData(SpinnerSize.Small, true, 24, 22, false, 0.0, 1.0)]
    [InlineData(SpinnerSize.Medium, false, 48, 14, true, 1.0, 0.0)]
    [InlineData(SpinnerSize.Large, true, 80, 10, false, 0.0, 1.0)]
    public void Projection_snapshot_per_state(
        SpinnerSize size,
        bool reduceMotion,
        int expectedPixels,
        double expectedStroke,
        bool expectedAnimate,
        double expectedInitialDashProgress,
        double expectedFillOpacity)
    {
        var projection = SpinnerProjection.Project(size, label: null, reduceMotion, Localizer);

        Assert.Equal(expectedPixels, projection.Pixels);
        Assert.Equal(expectedStroke, projection.StrokeWidth);
        Assert.Equal(expectedAnimate, projection.Animate);
        Assert.Equal(expectedInitialDashProgress, projection.InitialDashProgress);
        Assert.Equal(expectedFillOpacity, projection.FillOpacity);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = SpinnerProjection.Project(SpinnerSize.Medium, "x", reduceMotion: false, Localizer);
        var b = SpinnerProjection.Project(SpinnerSize.Medium, "x", reduceMotion: false, Localizer);
        var different = SpinnerProjection.Project(SpinnerSize.Medium, "x", reduceMotion: true, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => SpinnerProjection.Project(SpinnerSize.Medium, null, false, localizer: null!));

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Spinner", SpinnerViewModel.Slug);

    [Fact]
    public void ViewModel_default_ctor_uses_the_web_prop_defaults()
    {
        using var viewModel = new SpinnerViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(SpinnerSize.Medium, viewModel.Size);
        Assert.Equal(48, viewModel.Pixels);
        Assert.False(viewModel.HasLabel);
        Assert.Equal("Loading", viewModel.AccessibleName);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_starts_reduced_when_the_motion_source_reports_reduced()
    {
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, StaticMotionPreferenceSource.Reduced);

        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_set_size_pushes_a_new_size_and_raises_changes()
    {
        using var viewModel = new SpinnerViewModel(SpinnerSize.Small, null, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetSize(SpinnerSize.Large);

        Assert.Equal(SpinnerSize.Large, viewModel.Size);
        Assert.Equal(80, viewModel.Pixels);
        Assert.Contains(nameof(SpinnerViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_set_size_is_a_no_op_for_an_unchanged_size()
    {
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetSize(SpinnerSize.Medium);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_label_updates_the_caption_and_accessible_name()
    {
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, StaticMotionPreferenceSource.FullMotion);
        Assert.Equal("Loading", viewModel.AccessibleName);

        viewModel.SetLabel("Charging…");

        Assert.True(viewModel.HasLabel);
        Assert.Equal("Charging…", viewModel.Label);
        Assert.Equal("Charging…", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_set_label_back_to_null_restores_the_default_name()
    {
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, "Charging…", Localizer, StaticMotionPreferenceSource.FullMotion);
        Assert.True(viewModel.HasLabel);

        viewModel.SetLabel(null);

        Assert.False(viewModel.HasLabel);
        Assert.Equal("Loading", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(SpinnerViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_motion_change_is_a_no_op()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, motion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_motion_source()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);

        // After dispose a late change must not move the projection.
        motion.Set(reduceMotion: true);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(
            () => new SpinnerViewModel(SpinnerSize.Medium, null, localizer: null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new SpinnerViewModel(SpinnerSize.Medium, null, Localizer, motion: null!));
    }

    // ── accessibility: the status region is always named ──────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_never_empty()
    {
        using var withLabel = new SpinnerViewModel(SpinnerSize.Medium, "Importing", Localizer, StaticMotionPreferenceSource.FullMotion);
        using var withoutLabel = new SpinnerViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);

        Assert.False(string.IsNullOrWhiteSpace(withLabel.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(withoutLabel.AccessibleName));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the label) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpinnerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Spinner", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new SpinnerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new SpinnerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(SpinnerRegistration.Slug, line, StringComparison.Ordinal);
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
