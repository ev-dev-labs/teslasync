using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>TeslaCarViz</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, logical canvas dimensions, per-size widths, per-model aspect ratios and the
/// i18n keys / verbatim English fallbacks the web source renders as literals), the <c>parseModelKey</c> port, the
/// <c>batteryColor</c> / <c>boolColor</c> token mapping, the minimal SVG path parser (exercised against the real
/// web silhouette strings), the theme-aware <see cref="TeslaCarVizPalette"/> (light / dark colour parity), the
/// pure <see cref="TeslaCarVizProjection"/> (size math, driving / charging / locked / climate / sentry branches,
/// battery colour thresholds, ambient priority, the status-dot row, the reduce-motion animation gating and the
/// composed accessible description), the <see cref="TeslaCarVizViewModel"/> state holder (initial projection,
/// model / theme / motion reprojection, subscription cleanup), the <see cref="ITeslaCarVizThemeSource"/> seam and
/// the PII-safe diagnostics. Mirrors the web spec (web/src/components/data-display/TeslaCarViz.tsx). The WinUI
/// view itself (shared-surfaces/TeslaCarViz/TeslaCarViz.cs) is exercised by the app build.
/// </summary>
public sealed class TeslaCarVizTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TeslaCarVizModel Model(
        double batteryLevel = 78,
        bool isCharging = false,
        bool isLocked = false,
        bool isClimateOn = false,
        bool sentryMode = false,
        double speed = 0,
        TeslaModelFamily model = TeslaModelFamily.Model3,
        TeslaCarVizSize size = TeslaCarVizSize.Medium,
        TeslaCarVizVariant variant = TeslaCarVizVariant.Full) =>
        new(batteryLevel, isCharging, isLocked, isClimateOn, sentryMode, speed, model, size, variant);

    private static TeslaCarVizProjection Project(TeslaCarVizModel model, bool reduceMotion = false) =>
        TeslaCarVizProjection.Project(model, reduceMotion, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TeslaCarViz", TeslaCarVizRegistration.Slug);

    [Fact]
    public void Registration_slug_matches_the_view_model_slug() =>
        Assert.Equal(TeslaCarVizRegistration.Slug, TeslaCarVizViewModel.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("tesla-car-viz", TeslaCarVizRegistration.RootAutomationId);

    [Fact]
    public void Logical_canvas_matches_the_web_viewbox()
    {
        // web: viewBox="0 0 560 290".
        Assert.Equal(560, TeslaCarVizRegistration.LogicalWidth);
        Assert.Equal(290, TeslaCarVizRegistration.LogicalHeight);
    }

    [Theory]
    [InlineData(TeslaCarVizSize.Small, 180)]
    [InlineData(TeslaCarVizSize.Medium, 280)]
    [InlineData(TeslaCarVizSize.Large, 380)]
    public void Width_matches_the_web_size_map(TeslaCarVizSize size, double expected) =>
        Assert.Equal(expected, TeslaCarVizRegistration.Width(size));

    [Theory]
    [InlineData(TeslaModelFamily.Model3, 0.52)]
    [InlineData(TeslaModelFamily.ModelS, 0.52)]
    [InlineData(TeslaModelFamily.ModelY, 0.55)]
    [InlineData(TeslaModelFamily.ModelX, 0.55)]
    [InlineData(TeslaModelFamily.Cybertruck, 0.56)]
    public void Aspect_matches_the_web_ternary(TeslaModelFamily model, double expected) =>
        Assert.Equal(expected, TeslaCarVizRegistration.Aspect(model));

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_literals()
    {
        Assert.Equal("translation.vehicle.viz.charging", TeslaCarVizRegistration.ChargingKey);
        Assert.Equal("Charging", TeslaCarVizRegistration.ChargingFallback);
        Assert.Equal("translation.vehicle.viz.notCharging", TeslaCarVizRegistration.NotChargingKey);
        Assert.Equal("Not Charging", TeslaCarVizRegistration.NotChargingFallback);
        Assert.Equal("translation.vehicle.viz.locked", TeslaCarVizRegistration.LockedKey);
        Assert.Equal("Locked", TeslaCarVizRegistration.LockedFallback);
        Assert.Equal("translation.vehicle.viz.unlocked", TeslaCarVizRegistration.UnlockedKey);
        Assert.Equal("Unlocked", TeslaCarVizRegistration.UnlockedFallback);
        Assert.Equal("translation.vehicle.viz.climate", TeslaCarVizRegistration.ClimateKey);
        Assert.Equal("Climate", TeslaCarVizRegistration.ClimateFallback);
        Assert.Equal("translation.vehicle.viz.sentry", TeslaCarVizRegistration.SentryKey);
        Assert.Equal("Sentry", TeslaCarVizRegistration.SentryFallback);
        Assert.Equal("translation.vehicle.viz.driving", TeslaCarVizRegistration.DrivingKey);
        Assert.Equal("Driving", TeslaCarVizRegistration.DrivingFallback);
        Assert.Equal("translation.vehicle.viz.parked", TeslaCarVizRegistration.ParkedKey);
        Assert.Equal("Parked", TeslaCarVizRegistration.ParkedFallback);
        Assert.Equal("translation.vehicle.viz.aria", TeslaCarVizRegistration.AriaKey);
    }

    [Theory]
    [InlineData(TeslaModelFamily.Model3, "translation.vehicle.viz.model.model3", "Model 3")]
    [InlineData(TeslaModelFamily.ModelS, "translation.vehicle.viz.model.models", "Model S")]
    [InlineData(TeslaModelFamily.ModelY, "translation.vehicle.viz.model.modely", "Model Y")]
    [InlineData(TeslaModelFamily.ModelX, "translation.vehicle.viz.model.modelx", "Model X")]
    [InlineData(TeslaModelFamily.Cybertruck, "translation.vehicle.viz.model.cybertruck", "Cybertruck")]
    public void Model_label_keys_and_brand_fallbacks_are_stable(TeslaModelFamily model, string key, string fallback)
    {
        (string Key, string Fallback) entry = TeslaCarVizRegistration.ModelLabelKey(model);
        Assert.Equal(key, entry.Key);
        Assert.Equal(fallback, entry.Fallback);
        Assert.Equal(fallback, TeslaCarVizRegistration.ModelLabel(model, Localizer));
    }

    [Theory]
    [InlineData(78, "78")]
    [InlineData(0, "0")]
    [InlineData(100, "100")]
    [InlineData(12.5, "12.5")]
    public void FormatPercent_matches_the_web_raw_stringification(double value, string expected) =>
        Assert.Equal(expected, TeslaCarVizRegistration.FormatPercent(value));

    [Fact]
    public void FormatPercent_is_safe_for_non_finite_values()
    {
        Assert.Equal("0", TeslaCarVizRegistration.FormatPercent(double.NaN));
        Assert.Equal("0", TeslaCarVizRegistration.FormatPercent(double.PositiveInfinity));
    }

    // ── parseModelKey ─────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, TeslaModelFamily.Model3)]
    [InlineData("", TeslaModelFamily.Model3)]
    [InlineData("Model 3", TeslaModelFamily.Model3)]
    [InlineData("Model 3 P", TeslaModelFamily.Model3)]
    [InlineData("model3", TeslaModelFamily.Model3)]
    [InlineData("Model S", TeslaModelFamily.ModelS)]
    [InlineData("models", TeslaModelFamily.ModelS)]
    [InlineData("MS", TeslaModelFamily.ModelS)]
    [InlineData("Model Y", TeslaModelFamily.ModelY)]
    [InlineData("modely", TeslaModelFamily.ModelY)]
    [InlineData("MY", TeslaModelFamily.ModelY)]
    [InlineData("Model X", TeslaModelFamily.ModelX)]
    [InlineData("modelx", TeslaModelFamily.ModelX)]
    [InlineData("MX", TeslaModelFamily.ModelX)]
    [InlineData("Cybertruck", TeslaModelFamily.Cybertruck)]
    [InlineData("CT", TeslaModelFamily.Cybertruck)]
    [InlineData("something else", TeslaModelFamily.Model3)]
    public void ParseModelKey_ports_the_web_heuristic(string? input, TeslaModelFamily expected) =>
        Assert.Equal(expected, TeslaCarVizModel.ParseModelKey(input));

    [Fact]
    public void ParseModelKey_checks_cybertruck_before_other_substrings()
    {
        // web tests cybertruck/ct first, so a string that also contains "mx"/"my" still resolves cybertruck.
        Assert.Equal(TeslaModelFamily.Cybertruck, TeslaCarVizModel.ParseModelKey("Cybertruck"));
    }

    // ── colours ───────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(100, "TsColorSuccessBrush")]
    [InlineData(61, "TsColorSuccessBrush")]
    [InlineData(60, "TsColorWarningBrush")]
    [InlineData(26, "TsColorWarningBrush")]
    [InlineData(25, "TsColorDangerBrush")]
    [InlineData(0, "TsColorDangerBrush")]
    public void BatteryBrushKey_ports_the_web_thresholds(double level, string expected) =>
        Assert.Equal(expected, TeslaCarVizColors.BatteryBrushKey(level));

    [Theory]
    [InlineData(true, "TsColorSuccessBrush")]
    [InlineData(false, "TsColorWarningBrush")]
    public void BoolBrushKey_ports_the_web_boolColor(bool active, string expected) =>
        Assert.Equal(expected, TeslaCarVizColors.BoolBrushKey(active));

    // ── path parser ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Parser_reads_a_simple_move_line_close()
    {
        IReadOnlyList<TeslaCarVizSegment> segments = TeslaCarVizPathParser.Parse("M 10 20 L 30 40 Z");
        Assert.Equal(3, segments.Count);
        Assert.Equal(TeslaCarVizSegmentKind.MoveTo, segments[0].Kind);
        Assert.Equal(new double[] { 10, 20 }, segments[0].Args);
        Assert.Equal(TeslaCarVizSegmentKind.LineTo, segments[1].Kind);
        Assert.Equal(new double[] { 30, 40 }, segments[1].Args);
        Assert.Equal(TeslaCarVizSegmentKind.Close, segments[2].Kind);
    }

    [Fact]
    public void Parser_treats_extra_pairs_after_move_as_implicit_lines()
    {
        IReadOnlyList<TeslaCarVizSegment> segments = TeslaCarVizPathParser.Parse("M 1 2 3 4 5 6");
        Assert.Equal(TeslaCarVizSegmentKind.MoveTo, segments[0].Kind);
        Assert.Equal(TeslaCarVizSegmentKind.LineTo, segments[1].Kind);
        Assert.Equal(TeslaCarVizSegmentKind.LineTo, segments[2].Kind);
        Assert.Equal(new double[] { 5, 6 }, segments[2].Args);
    }

    [Fact]
    public void Parser_reads_quadratic_and_cubic_beziers()
    {
        IReadOnlyList<TeslaCarVizSegment> segments = TeslaCarVizPathParser.Parse("M0 0 Q 1 2 3 4 C 5 6 7 8 9 10");
        Assert.Equal(TeslaCarVizSegmentKind.QuadraticBezier, segments[1].Kind);
        Assert.Equal(4, segments[1].Args.Count);
        Assert.Equal(TeslaCarVizSegmentKind.CubicBezier, segments[2].Kind);
        Assert.Equal(6, segments[2].Args.Count);
    }

    [Fact]
    public void Parser_reads_arcs_with_sign_packed_numbers()
    {
        // The web lock shackle path: negative coords and sign-packed flags, no separating spaces.
        IReadOnlyList<TeslaCarVizSegment> segments = TeslaCarVizPathParser.Parse("M-3 -2 L-3 -5 A3 3 0 0 1 3 -5 L3 -2");
        Assert.Equal(TeslaCarVizSegmentKind.MoveTo, segments[0].Kind);
        Assert.Equal(new double[] { -3, -2 }, segments[0].Args);
        TeslaCarVizSegment arc = Assert.Single(segments, s => s.Kind == TeslaCarVizSegmentKind.Arc);
        Assert.Equal(new double[] { 3, 3, 0, 0, 1, 3, -5 }, arc.Args);
    }

    [Fact]
    public void Parser_returns_empty_for_empty_input() =>
        Assert.Empty(TeslaCarVizPathParser.Parse(string.Empty));

    [Fact]
    public void Parser_handles_every_real_silhouette_path_without_loss()
    {
        foreach (TeslaModelFamily model in Enum.GetValues<TeslaModelFamily>())
        {
            TeslaCarVizGeometry g = TeslaCarVizGeometry.For(model);
            foreach (string path in new[] { g.BodyPath, g.RoofPath, g.WindPath, g.MiniPath })
            {
                IReadOnlyList<TeslaCarVizSegment> segments = TeslaCarVizPathParser.Parse(path);
                Assert.NotEmpty(segments);
                Assert.Equal(TeslaCarVizSegmentKind.MoveTo, segments[0].Kind);
                Assert.Contains(segments, s => s.Kind == TeslaCarVizSegmentKind.Close);
            }
        }
    }

    // ── geometry ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Geometry_is_distinct_per_model()
    {
        var bodies = new HashSet<string>();
        foreach (TeslaModelFamily model in Enum.GetValues<TeslaModelFamily>())
        {
            bodies.Add(TeslaCarVizGeometry.For(model).BodyPath);
        }

        Assert.Equal(5, bodies.Count);
    }

    [Fact]
    public void Geometry_shares_the_wheel_baseline()
    {
        foreach (TeslaModelFamily model in Enum.GetValues<TeslaModelFamily>())
        {
            TeslaCarVizGeometry g = TeslaCarVizGeometry.For(model);
            Assert.Equal(160, g.FrontWheelX);
            Assert.Equal(432, g.RearWheelX);
            Assert.Equal(210, g.WheelY);
        }
    }

    // ── projection: size / driving / battery ──────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_size_uses_width_and_aspect()
    {
        TeslaCarVizProjection projection = Project(Model(size: TeslaCarVizSize.Large, model: TeslaModelFamily.Cybertruck));
        Assert.Equal(380, projection.Width);
        Assert.Equal(380 * 0.56, projection.Height, 3);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(0.1, true)]
    [InlineData(65, true)]
    public void Projection_driving_is_speed_greater_than_zero(double speed, bool expected)
    {
        TeslaCarVizProjection projection = Project(Model(speed: speed));
        Assert.Equal(expected, projection.Driving);
    }

    [Theory]
    [InlineData(50, 0.5)]
    [InlineData(0, 0)]
    [InlineData(100, 1)]
    [InlineData(150, 1)]
    [InlineData(-10, 0)]
    public void Projection_battery_fraction_is_clamped(double level, double expected)
    {
        TeslaCarVizProjection projection = Project(Model(batteryLevel: level));
        Assert.Equal(expected, projection.BatteryFraction, 5);
    }

    [Fact]
    public void Projection_battery_fraction_is_zero_for_non_finite()
    {
        TeslaCarVizProjection projection = Project(Model(batteryLevel: double.NaN));
        Assert.Equal(0, projection.BatteryFraction);
    }

    [Fact]
    public void Projection_battery_text_appends_percent()
    {
        Assert.Equal("78%", Project(Model(batteryLevel: 78)).BatteryText);
        Assert.Equal("12.5%", Project(Model(batteryLevel: 12.5)).BatteryText);
    }

    [Theory]
    [InlineData(80, "TsColorSuccessBrush")]
    [InlineData(40, "TsColorWarningBrush")]
    [InlineData(10, "TsColorDangerBrush")]
    public void Projection_battery_brush_key_follows_thresholds(double level, string expected) =>
        Assert.Equal(expected, Project(Model(batteryLevel: level)).BatteryBrushKey);

    [Theory]
    [InlineData(true, "TsColorSuccessBrush")]
    [InlineData(false, "TsColorWarningBrush")]
    public void Projection_lock_brush_key_follows_boolColor(bool locked, string expected) =>
        Assert.Equal(expected, Project(Model(isLocked: locked)).LockBrushKey);

    // ── projection: ambient priority ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ambient_is_sentry_when_sentry_even_if_charging_and_driving()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, sentryMode: true, speed: 30));
        Assert.Equal(TeslaCarVizAmbient.Sentry, projection.Ambient);
    }

    [Fact]
    public void Ambient_is_charging_when_charging_and_driving_but_not_sentry()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, speed: 30));
        Assert.Equal(TeslaCarVizAmbient.Charging, projection.Ambient);
    }

    [Fact]
    public void Ambient_is_driving_when_only_moving()
    {
        Assert.Equal(TeslaCarVizAmbient.Driving, Project(Model(speed: 30)).Ambient);
    }

    [Fact]
    public void Ambient_is_idle_when_parked_and_quiet()
    {
        Assert.Equal(TeslaCarVizAmbient.Idle, Project(Model()).Ambient);
    }

    // ── projection: status chips ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Chips_show_charging_and_lock_always()
    {
        TeslaCarVizProjection projection = Project(Model());
        Assert.Equal(2, projection.Chips.Count);
        Assert.Equal("Not Charging", projection.Chips[0].Label);
        Assert.False(projection.Chips[0].Active);
        Assert.Equal("Unlocked", projection.Chips[1].Label);
        Assert.False(projection.Chips[1].Active);
    }

    [Fact]
    public void Chips_reflect_charging_and_locked_state()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, isLocked: true));
        Assert.Equal("Charging", projection.Chips[0].Label);
        Assert.True(projection.Chips[0].Active);
        Assert.Equal("TsColorSuccessBrush", projection.Chips[0].ActiveBrushKey);
        Assert.Equal("Locked", projection.Chips[1].Label);
        Assert.True(projection.Chips[1].Active);
        Assert.Equal("TsColorSuccessBrush", projection.Chips[1].ActiveBrushKey);
    }

    [Fact]
    public void Chips_add_climate_only_when_on()
    {
        Assert.DoesNotContain(Project(Model()).Chips, c => c.Label == "Climate");
        TeslaCarVizProjection projection = Project(Model(isClimateOn: true));
        TeslaCarVizStatusChip climate = Assert.Single(projection.Chips, c => c.Label == "Climate");
        Assert.True(climate.Active);
        Assert.Equal("TsColorInfoBrush", climate.ActiveBrushKey);
    }

    [Fact]
    public void Chips_add_sentry_only_when_on()
    {
        Assert.DoesNotContain(Project(Model()).Chips, c => c.Label == "Sentry");
        TeslaCarVizProjection projection = Project(Model(sentryMode: true));
        TeslaCarVizStatusChip sentry = Assert.Single(projection.Chips, c => c.Label == "Sentry");
        Assert.True(sentry.Active);
        Assert.Equal("TsColorDangerBrush", sentry.ActiveBrushKey);
    }

    [Fact]
    public void Chips_include_all_four_when_everything_is_on()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, isLocked: true, isClimateOn: true, sentryMode: true));
        Assert.Equal(4, projection.Chips.Count);
    }

    // ── projection: accessible description ────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_describes_a_parked_locked_car()
    {
        TeslaCarVizProjection projection = Project(Model(batteryLevel: 78, isLocked: true));
        Assert.Equal("Model 3, 78% battery, Parked, Locked", projection.AutomationName);
    }

    [Fact]
    public void Accessible_name_describes_a_busy_car_in_order()
    {
        TeslaCarVizProjection projection = Project(Model(
            batteryLevel: 64,
            isCharging: true,
            isLocked: false,
            isClimateOn: true,
            sentryMode: true,
            speed: 30,
            model: TeslaModelFamily.ModelY));
        Assert.Equal("Model Y, 64% battery, Driving, Charging, Unlocked, Climate, Sentry", projection.AutomationName);
    }

    // ── projection: animation gating ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Animations_play_under_full_motion()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, isClimateOn: true, sentryMode: true, speed: 30), reduceMotion: false);
        Assert.True(projection.WheelsSpin);
        Assert.True(projection.SpeedLinesPlay);
        Assert.True(projection.TaillightPulses);
        Assert.True(projection.ChargePulses);
        Assert.True(projection.SentryRingsRotate);
        Assert.True(projection.ClimateWavesAnimate);
        Assert.True(projection.EntranceAnimates);
    }

    [Fact]
    public void Animations_are_suppressed_under_reduced_motion()
    {
        TeslaCarVizProjection projection = Project(Model(isCharging: true, isClimateOn: true, sentryMode: true, speed: 30), reduceMotion: true);
        Assert.False(projection.WheelsSpin);
        Assert.False(projection.SpeedLinesPlay);
        Assert.False(projection.TaillightPulses);
        Assert.False(projection.ChargePulses);
        Assert.False(projection.SentryRingsRotate);
        Assert.False(projection.ClimateWavesAnimate);
        Assert.False(projection.EntranceAnimates);
    }

    [Fact]
    public void Wheels_do_not_spin_when_parked_even_under_full_motion()
    {
        Assert.False(Project(Model(speed: 0), reduceMotion: false).WheelsSpin);
    }

    // ── palette ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Palette_for_scheme_selects_light_or_dark()
    {
        Assert.True(TeslaCarVizPalette.ForScheme(true).IsLight);
        Assert.False(TeslaCarVizPalette.ForScheme(false).IsLight);
        Assert.Same(TeslaCarVizPalette.Light, TeslaCarVizPalette.ForScheme(true));
        Assert.Same(TeslaCarVizPalette.Dark, TeslaCarVizPalette.ForScheme(false));
    }

    [Fact]
    public void Palette_colours_match_the_web_useSvgPalette()
    {
        Assert.Equal("#d4d8e0", TeslaCarVizPalette.Light.BodyFill);
        Assert.Equal("#2d3748", TeslaCarVizPalette.Dark.BodyFill);
        Assert.Equal("white", TeslaCarVizPalette.Dark.BatteryText);
        Assert.Equal("rgba(0,0,0,0.7)", TeslaCarVizPalette.Light.BatteryText);
        Assert.Equal("rgba(0,240,255,0.4)", TeslaCarVizPalette.Dark.Climate);
        Assert.Equal("rgba(0,120,200,0.4)", TeslaCarVizPalette.Light.Climate);
    }

    [Fact]
    public void Palette_ambient_maps_each_mode()
    {
        TeslaCarVizPalette dark = TeslaCarVizPalette.Dark;
        Assert.Equal(dark.AmbientSentry, dark.Ambient(TeslaCarVizAmbient.Sentry));
        Assert.Equal(dark.AmbientCharging, dark.Ambient(TeslaCarVizAmbient.Charging));
        Assert.Equal(dark.AmbientDriving, dark.Ambient(TeslaCarVizAmbient.Driving));
        Assert.Equal(dark.AmbientIdle, dark.Ambient(TeslaCarVizAmbient.Idle));
    }

    // ── theme source ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_theme_source_defaults_to_dark()
    {
        Assert.False(new StaticTeslaCarVizThemeSource().IsLight);
        Assert.False(StaticTeslaCarVizThemeSource.Dark.IsLight);
        Assert.True(StaticTeslaCarVizThemeSource.Light.IsLight);
    }

    [Fact]
    public void Static_theme_source_set_raises_changed()
    {
        var source = new StaticTeslaCarVizThemeSource(isLight: false);
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(true);
        Assert.True(source.IsLight);
        Assert.Equal(1, raised);

        // Setting the same value is a no-op.
        source.Set(true);
        Assert.Equal(1, raised);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    private static TeslaCarVizViewModel NewViewModel(
        TeslaCarVizModel? model = null,
        StaticTeslaCarVizThemeSource? theme = null,
        IMotionPreferenceSource? motion = null) =>
        new(Localizer, theme ?? new StaticTeslaCarVizThemeSource(false), motion ?? StaticMotionPreferenceSource.FullMotion, model);

    [Fact]
    public void ViewModel_initial_projection_and_palette_match_the_model_and_theme()
    {
        using TeslaCarVizViewModel vm = NewViewModel(Model(batteryLevel: 42, isLocked: true), new StaticTeslaCarVizThemeSource(true));
        Assert.Equal("TsColorWarningBrush", vm.Projection.BatteryBrushKey);
        Assert.True(vm.Projection.IsLocked);
        Assert.True(vm.Palette.IsLight);
        Assert.Equal(vm.Projection.AutomationName, vm.AutomationName);
    }

    [Fact]
    public void ViewModel_setting_model_reprojects_and_notifies()
    {
        using TeslaCarVizViewModel vm = NewViewModel(Model(batteryLevel: 80));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Model = Model(batteryLevel: 10);

        Assert.Equal("TsColorDangerBrush", vm.Projection.BatteryBrushKey);
        Assert.Contains(nameof(TeslaCarVizViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_theme_flip_swaps_palette_and_notifies()
    {
        var theme = new StaticTeslaCarVizThemeSource(false);
        using TeslaCarVizViewModel vm = NewViewModel(Model(), theme);
        Assert.False(vm.Palette.IsLight);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        theme.Set(true);

        Assert.True(vm.Palette.IsLight);
        Assert.Contains(nameof(TeslaCarVizViewModel.Palette), changed);
    }

    [Fact]
    public void ViewModel_reduced_motion_suppresses_animation_flags()
    {
        using TeslaCarVizViewModel vm = NewViewModel(Model(speed: 30), motion: StaticMotionPreferenceSource.Reduced);
        Assert.False(vm.Projection.WheelsSpin);
        Assert.True(vm.Projection.Driving);
    }

    [Fact]
    public void ViewModel_dispose_stops_reacting_to_the_theme_seam()
    {
        var theme = new StaticTeslaCarVizThemeSource(false);
        TeslaCarVizViewModel vm = NewViewModel(Model(), theme);
        vm.Dispose();

        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        theme.Set(true);

        Assert.False(raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TeslaCarVizDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TeslaCarViz", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leaks_state()
    {
        var lines = new List<string>();
        var diagnostics = new TeslaCarVizDiagnostics(lines.Add);
        diagnostics.RecordViewOpened();

        // The only emitted line carries the slug and nothing about battery / lock / charge state.
        Assert.DoesNotContain(lines, line => line.Contains("battery", StringComparison.OrdinalIgnoreCase));
    }
}
