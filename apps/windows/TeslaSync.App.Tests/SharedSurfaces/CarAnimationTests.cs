using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the CarAnimation surface's UI-thread-free logic — the registration metadata (slug,
/// per-control automation ids, the <c>role="img"</c> contract, the three i18n keys + fallbacks, the default
/// sizes, the viewBoxes, the SVG geometry and the animation timeline), the four pure projections
/// (<see cref="CarAnimationProjection"/>, <see cref="ChargingBoltProjection"/>, <see cref="BatteryFillProjection"/>,
/// <see cref="WheelSpinProjection"/>) covering the full-motion vs reduced-motion branch, the accessible-name
/// contract and the battery fill arithmetic / colour bands, the four state holders (initial projection, runtime
/// prop push, runtime motion toggle, subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/motion/CarAnimation.tsx). The WinUI views (shared-surfaces/CarAnimation*.cs) are exercised
/// by the app build. Because the components read no network data, there is no loading / error / stale / offline
/// state — the reproduced render branches are the full-motion animated illustrations and the reduced-motion
/// static ones.
/// </summary>
public sealed class CarAnimationTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("CarAnimation", CarAnimationRegistration.Slug);

    [Fact]
    public void Image_role_matches_the_web_source() =>
        Assert.Equal("img", CarAnimationRegistration.ImageRole);

    [Fact]
    public void Per_control_automation_ids_are_distinct_native_hooks()
    {
        var ids = new[]
        {
            CarAnimationRegistration.CarAutomationId,
            CarAnimationRegistration.ChargingBoltAutomationId,
            CarAnimationRegistration.BatteryFillAutomationId,
            CarAnimationRegistration.WheelSpinAutomationId,
        };

        Assert.Equal("car-animation", CarAnimationRegistration.CarAutomationId);
        Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web t('carAnimation.tesla'|'charging'|'loading', <english>) — translation-namespaced keys, verbatim fallbacks.
        Assert.Equal("translation.carAnimation.tesla", CarAnimationRegistration.TeslaLabelKey);
        Assert.Equal("Tesla vehicle illustration", CarAnimationRegistration.TeslaLabelFallback);
        Assert.Equal("translation.carAnimation.charging", CarAnimationRegistration.ChargingLabelKey);
        Assert.Equal("Charging", CarAnimationRegistration.ChargingLabelFallback);
        Assert.Equal("translation.carAnimation.loading", CarAnimationRegistration.LoadingLabelKey);
        Assert.Equal("Loading", CarAnimationRegistration.LoadingLabelFallback);
    }

    [Fact]
    public void I18n_labels_resolve_through_the_facade()
    {
        Assert.Equal("Tesla vehicle illustration", CarAnimationRegistration.ResolveTeslaLabel(Localizer));
        Assert.Equal("Charging", CarAnimationRegistration.ResolveChargingLabel(Localizer));
        Assert.Equal("Loading", CarAnimationRegistration.ResolveLoadingLabel(Localizer));
    }

    [Fact]
    public void Default_sizes_match_the_web_prop_defaults()
    {
        Assert.Equal(120, CarAnimationRegistration.CarDefaultSize);
        Assert.Equal(0.4, CarAnimationRegistration.CarHeightRatio);
        Assert.Equal(32, CarAnimationRegistration.ChargingBoltDefaultSize);
        Assert.Equal(48, CarAnimationRegistration.BatteryDefaultSize);
        Assert.Equal(0.5, CarAnimationRegistration.BatteryHeightRatio);
        Assert.Equal(80, CarAnimationRegistration.BatteryDefaultLevel);
        Assert.Equal(24, CarAnimationRegistration.WheelSpinDefaultSize);
    }

    [Fact]
    public void ViewBoxes_match_the_web_source()
    {
        Assert.Equal(240, CarAnimationRegistration.CarViewBoxWidth);
        Assert.Equal(96, CarAnimationRegistration.CarViewBoxHeight);
        Assert.Equal(24, CarAnimationRegistration.ChargingBoltViewBox);
        Assert.Equal(48, CarAnimationRegistration.BatteryViewBoxWidth);
        Assert.Equal(24, CarAnimationRegistration.BatteryViewBoxHeight);
        Assert.Equal(24, CarAnimationRegistration.WheelSpinViewBox);
    }

    [Fact]
    public void Silhouette_path_data_matches_the_web_source()
    {
        Assert.Equal(
            "M30 60 Q30 40 50 35 L80 28 Q100 20 130 20 Q160 20 180 28 L210 35 Q230 40 230 60 L230 65 Q230 70 225 70 L35 70 Q30 70 30 65 Z",
            CarAnimationRegistration.BodyPathData);
        Assert.Equal("M85 30 Q100 22 130 22 Q155 22 170 28 L155 42 Q140 44 120 44 Q100 44 90 42 Z", CarAnimationRegistration.WindshieldPathData);
        Assert.Equal("M55 38 L82 30 L88 42 Q78 44 68 42 Z", CarAnimationRegistration.RearWindowPathData);
        Assert.Equal("M13 2L3 14h9l-1 8 10-12h-9l1-8z", CarAnimationRegistration.BoltPathData);
    }

    [Fact]
    public void Silhouette_shape_specs_match_the_web_source()
    {
        Assert.Equal(70, CarAnimationRegistration.FrontWheelCenterX);
        Assert.Equal(190, CarAnimationRegistration.RearWheelCenterX);
        Assert.Equal(70, CarAnimationRegistration.WheelCenterY);
        Assert.Equal(14, CarAnimationRegistration.WheelTyreRadius);
        Assert.Equal(6, CarAnimationRegistration.WheelHubRadius);
        Assert.Equal(new EllipseSpec(228, 55, 4, 6), CarAnimationRegistration.Headlight);
        Assert.Equal(new RectSpec(28, 50, 4, 12, 2), CarAnimationRegistration.Taillight);
        Assert.Equal(new EllipseSpec(130, 86, 90, 4), CarAnimationRegistration.GroundShadow);
        Assert.Equal("#EF4444", CarAnimationRegistration.TaillightHex);
    }

    [Fact]
    public void Battery_shape_specs_match_the_web_source()
    {
        Assert.Equal(new RectSpec(2, 4, 38, 16, 3), CarAnimationRegistration.BatteryOutline);
        Assert.Equal(new RectSpec(40, 8, 4, 8, 1), CarAnimationRegistration.BatteryTerminal);
        Assert.Equal(4, CarAnimationRegistration.BatteryFillX);
        Assert.Equal(6, CarAnimationRegistration.BatteryFillY);
        Assert.Equal(12, CarAnimationRegistration.BatteryFillHeight);
        Assert.Equal(1.5, CarAnimationRegistration.BatteryFillCornerRadius);
    }

    [Fact]
    public void Wheel_spin_spec_matches_the_web_source()
    {
        Assert.Equal(12, CarAnimationRegistration.WheelSpinCenter);
        Assert.Equal(10, CarAnimationRegistration.WheelSpinTyreRadius);
        Assert.Equal(4, CarAnimationRegistration.WheelSpinHubRadius);
        Assert.Equal(5, CarAnimationRegistration.WheelSpinSpokeInner);
        Assert.Equal(8, CarAnimationRegistration.WheelSpinSpokeOuter);
        Assert.Equal(new double[] { 0, 72, 144, 216, 288 }, CarAnimationRegistration.WheelSpinSpokeAngles);
    }

    [Fact]
    public void Pulse_keyframes_match_the_web_source()
    {
        Assert.Equal(new double[] { 0, 0.8, 0.4, 0.8 }, CarAnimationRegistration.HeadlightPulse);
        Assert.Equal(new double[] { 0, 0.7, 0.3, 0.7 }, CarAnimationRegistration.TaillightPulse);
        Assert.Equal(new double[] { 0.1, 0.3, 0.1 }, CarAnimationRegistration.BoltPulse);
    }

    [Fact]
    public void Key_animation_durations_match_the_web_source()
    {
        Assert.Equal(1500, CarAnimationRegistration.BodyDrawDurationMs);
        Assert.Equal(2000, CarAnimationRegistration.LightPulseDurationMs);
        Assert.Equal(1500, CarAnimationRegistration.BoltPulseDurationMs);
        Assert.Equal(1200, CarAnimationRegistration.BatteryFillDurationMs);
        Assert.Equal(2000, CarAnimationRegistration.WheelSpinDurationMs);
        Assert.Equal(-4, CarAnimationRegistration.BoltEntryRise);
    }

    [Fact]
    public void Body_outline_draw_units_cover_the_body_perimeter()
    {
        // The stroke-draw dash must exceed the body perimeter so the outline is fully hidden at the sweep start.
        Assert.True(CarAnimationRegistration.BodyOutlineDrawUnits > 450);
    }

    // ── battery classification + colours ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(100, BatteryFillBand.Good)]
    [InlineData(80, BatteryFillBand.Good)]
    [InlineData(60, BatteryFillBand.Good)]
    [InlineData(59.9, BatteryFillBand.Warning)]
    [InlineData(30, BatteryFillBand.Warning)]
    [InlineData(29.9, BatteryFillBand.Critical)]
    [InlineData(0, BatteryFillBand.Critical)]
    [InlineData(150, BatteryFillBand.Good)]
    [InlineData(-5, BatteryFillBand.Critical)]
    public void Battery_bands_match_the_web_thresholds(double level, BatteryFillBand expected) =>
        Assert.Equal(expected, CarAnimationRegistration.ClassifyBattery(level));

    [Fact]
    public void Battery_band_colours_match_the_web_color_constants()
    {
        Assert.Equal("#10B981", CarAnimationRegistration.ResolveBatteryColorHex(BatteryFillBand.Good));
        Assert.Equal("#F59E0B", CarAnimationRegistration.ResolveBatteryColorHex(BatteryFillBand.Warning));
        Assert.Equal("#EF4444", CarAnimationRegistration.ResolveBatteryColorHex(BatteryFillBand.Critical));
    }

    // ── silhouette projection ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Car_projection_defaults_size_and_height_ratio()
    {
        var projection = CarAnimationProjection.Project(120, reduceMotion: false, Localizer);

        Assert.Equal(120, projection.Width);
        Assert.Equal(48, projection.Height); // 120 * 0.4
        Assert.Equal("img", projection.Role);
        Assert.Equal("Tesla vehicle illustration", projection.AccessibleName);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Car_projection_animate_branch_follows_motion(bool reduceMotion, bool expectedAnimate)
    {
        var projection = CarAnimationProjection.Project(120, reduceMotion, Localizer);
        Assert.Equal(expectedAnimate, projection.Animate);
    }

    [Fact]
    public void Car_projection_clamps_a_negative_size()
    {
        var projection = CarAnimationProjection.Project(-40, reduceMotion: false, Localizer);
        Assert.Equal(0, projection.Width);
        Assert.Equal(0, projection.Height);
    }

    [Fact]
    public void Car_projection_value_equality()
    {
        var a = CarAnimationProjection.Project(120, false, Localizer);
        var b = CarAnimationProjection.Project(120, false, Localizer);
        var different = CarAnimationProjection.Project(120, true, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Car_projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => CarAnimationProjection.Project(120, false, localizer: null!));

    // ── charging-bolt projection ──────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Bolt_projection_animate_branch_and_name(bool reduceMotion, bool expectedAnimate)
    {
        var projection = ChargingBoltProjection.Project(32, reduceMotion, Localizer);

        Assert.Equal(32, projection.Size);
        Assert.Equal(expectedAnimate, projection.Animate);
        Assert.Equal("Charging", projection.AccessibleName);
        Assert.Equal("img", projection.Role);
    }

    [Fact]
    public void Bolt_projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => ChargingBoltProjection.Project(32, false, localizer: null!));

    // ── battery projection ────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(80, 30.4)]
    [InlineData(100, 38.0)]
    [InlineData(50, 19.0)]
    [InlineData(0, 0.0)]
    [InlineData(150, 38.0)] // clamped to 100
    [InlineData(-10, 0.0)]  // clamped to 0
    public void Battery_projection_fill_width_matches_the_web_formula_at_default_size(double level, double expectedWidth)
    {
        var projection = BatteryFillProjection.Project(level, 48, reduceMotion: false);

        // web: 48px gauge -> fill rect width == 38 * clamp(level, 0, 100) / 100.
        Assert.Equal(expectedWidth, projection.FillWidth, 6);
    }

    [Fact]
    public void Battery_projection_sizing_and_band()
    {
        var projection = BatteryFillProjection.Project(80, 48, reduceMotion: false);

        Assert.Equal(48, projection.Width);
        Assert.Equal(24, projection.Height); // 48 * 0.5
        Assert.Equal(BatteryFillBand.Good, projection.Band);
        Assert.Equal("#10B981", projection.FillColorHex);
        Assert.True(projection.Animate);
    }

    [Fact]
    public void Battery_projection_reduced_motion_still_reports_target_fill()
    {
        var projection = BatteryFillProjection.Project(80, 48, reduceMotion: true);

        Assert.False(projection.Animate);
        Assert.Equal(30.4, projection.FillWidth, 6);
    }

    [Fact]
    public void Battery_projection_fill_width_is_never_negative()
    {
        var projection = BatteryFillProjection.Project(80, 2, reduceMotion: false);
        Assert.True(projection.FillWidth >= 0);
    }

    // ── wheel-spin projection ─────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Wheel_projection_animate_branch_and_name(bool reduceMotion, bool expectedAnimate)
    {
        var projection = WheelSpinProjection.Project(24, reduceMotion, Localizer);

        Assert.Equal(24, projection.Size);
        Assert.Equal(expectedAnimate, projection.Animate);
        Assert.Equal("Loading", projection.AccessibleName);
        Assert.Equal("img", projection.Role);
    }

    [Fact]
    public void Wheel_projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => WheelSpinProjection.Project(24, false, localizer: null!));

    // ── silhouette view-model ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Car_view_model_exposes_the_slug() =>
        Assert.Equal("CarAnimation", CarAnimationViewModel.Slug);

    [Fact]
    public void Car_view_model_default_ctor_uses_web_defaults()
    {
        using var viewModel = new CarAnimationViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(120, viewModel.Width);
        Assert.Equal(48, viewModel.Height);
        Assert.True(viewModel.Animate);
        Assert.Equal("Tesla vehicle illustration", viewModel.AccessibleName);
    }

    [Fact]
    public void Car_view_model_starts_reduced_when_source_reports_reduced()
    {
        using var viewModel = new CarAnimationViewModel(120, Localizer, StaticMotionPreferenceSource.Reduced);
        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void Car_view_model_set_size_pushes_and_raises()
    {
        using var viewModel = new CarAnimationViewModel(120, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetSize(200);

        Assert.Equal(200, viewModel.Width);
        Assert.Equal(80, viewModel.Height);
        Assert.Contains(nameof(CarAnimationViewModel.Projection), changed);
    }

    [Fact]
    public void Car_view_model_set_size_is_a_no_op_when_unchanged()
    {
        using var viewModel = new CarAnimationViewModel(120, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetSize(120);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Car_view_model_reacts_to_runtime_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new CarAnimationViewModel(120, Localizer, motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(CarAnimationViewModel.Projection), changed);
    }

    [Fact]
    public void Car_view_model_dispose_unsubscribes()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new CarAnimationViewModel(120, Localizer, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);
        motion.Set(reduceMotion: true);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void Car_view_model_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(() => new CarAnimationViewModel(120, localizer: null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(() => new CarAnimationViewModel(120, Localizer, motion: null!));
    }

    // ── charging-bolt view-model ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Bolt_view_model_default_and_runtime_motion()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new ChargingBoltViewModel(Localizer, motion);

        Assert.Equal(32, viewModel.Size);
        Assert.True(viewModel.Animate);
        Assert.Equal("Charging", viewModel.AccessibleName);

        motion.Set(reduceMotion: true);
        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void Bolt_view_model_set_size_pushes_and_raises()
    {
        using var viewModel = new ChargingBoltViewModel(32, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetSize(64);
        Assert.Equal(64, viewModel.Size);
        Assert.Equal(1, changes);

        viewModel.SetSize(64);
        Assert.Equal(1, changes); // no-op when unchanged
    }

    [Fact]
    public void Bolt_view_model_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(() => new ChargingBoltViewModel(32, localizer: null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(() => new ChargingBoltViewModel(32, Localizer, motion: null!));
    }

    // ── battery view-model ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Battery_view_model_default_ctor_uses_web_defaults()
    {
        using var viewModel = new BatteryFillViewModel(StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(BatteryFillBand.Good, viewModel.Band); // level 80
        Assert.Equal(30.4, viewModel.FillWidth, 6);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void Battery_view_model_set_level_reclassifies_and_raises()
    {
        using var viewModel = new BatteryFillViewModel(80, 48, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetLevel(20);

        Assert.Equal(BatteryFillBand.Critical, viewModel.Band);
        Assert.Contains(nameof(BatteryFillViewModel.Projection), changed);
    }

    [Fact]
    public void Battery_view_model_set_size_rescales_fill()
    {
        using var viewModel = new BatteryFillViewModel(100, 48, StaticMotionPreferenceSource.FullMotion);
        Assert.Equal(38.0, viewModel.FillWidth, 6);

        viewModel.SetSize(96);

        // barWidth = 96*0.6 = 57.6; fillWidth = (57.6-4)*100/100 = 53.6; rectWidth = 53.6 * 38/24.8.
        Assert.Equal(53.6 * (38.0 / 24.8), viewModel.FillWidth, 6);
    }

    [Fact]
    public void Battery_view_model_throws_for_null_motion() =>
        Assert.Throws<ArgumentNullException>(() => new BatteryFillViewModel(80, 48, motion: null!));

    // ── wheel-spin view-model ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Wheel_view_model_default_and_runtime_motion()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new WheelSpinViewModel(Localizer, motion);

        Assert.Equal(24, viewModel.Size);
        Assert.True(viewModel.Animate);
        Assert.Equal("Loading", viewModel.AccessibleName);

        motion.Set(reduceMotion: true);
        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void Wheel_view_model_dispose_unsubscribes()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new WheelSpinViewModel(24, Localizer, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();
        Assert.Equal(0, motion.ObserverCount);
    }

    [Fact]
    public void Wheel_view_model_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(() => new WheelSpinViewModel(24, localizer: null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(() => new WheelSpinViewModel(24, Localizer, motion: null!));
    }

    // ── accessibility: the labelled images are always named ───────────────────────────────────────────────

    [Fact]
    public void Labelled_images_always_have_a_name()
    {
        using var car = new CarAnimationViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);
        using var bolt = new ChargingBoltViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);
        using var wheel = new WheelSpinViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);

        Assert.False(string.IsNullOrWhiteSpace(car.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(bolt.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(wheel.AccessibleName));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CarAnimationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CarAnimation", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new CarAnimationDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
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
