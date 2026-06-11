using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the KioskSettingsModal surface's UI-thread-free logic — the clock-corner wire mapping,
/// the projections (the four progressive-disclosure gates, the initial rotation selection with unknown-id
/// pruning, the "can't deselect the last dashboard" toggle rule, the four dropdown option projections + their
/// off / never / seconds / minutes labels, the live-preview swatch maths and the opacity↔percent conversions), the
/// state-holder view-model's branches (initial defaults, each setter's <c>onUpdateConfig</c> emission + dependent
/// gate, the dashboard toggle's emission + sticky-last rule, and the enter / close / open contract that mirrors
/// <c>handleEnter</c> / <c>onClose</c> / <c>onEnterKiosk</c>), the i18n key + fallback contract that doubles as the
/// Narrator-label source, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/KioskSettingsModal.tsx +
/// web/src/features/dashboard/hooks/useKioskMode.ts). The WinUI view itself (KioskSettingsModal.cs) is exercised
/// by the app build.
/// </summary>
public sealed class KioskSettingsModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static IReadOnlyList<KioskDashboard> Dashboards(params string[] ids) =>
        ids.Select((id, i) => new KioskDashboard(id, $"Dashboard {i + 1}", IsDefault: i == 0)).ToList();

    private static KioskSettingsModalViewModel NewViewModel(
        KioskConfig? config = null,
        IReadOnlyList<KioskDashboard>? dashboards = null,
        KioskSettingsModalDiagnostics? diagnostics = null) =>
        new(config ?? KioskConfig.Default, dashboards ?? Dashboards("d1", "d2", "d3"), Localizer, diagnostics);

    // ── Clock-corner wire mapping (web clockPosition union) ──────────────────────────────────────────────

    [Theory]
    [InlineData(ClockCorner.TopLeft, "top-left")]
    [InlineData(ClockCorner.TopRight, "top-right")]
    [InlineData(ClockCorner.BottomLeft, "bottom-left")]
    [InlineData(ClockCorner.BottomRight, "bottom-right")]
    public void ClockCorner_round_trips_through_token(ClockCorner corner, string token)
    {
        Assert.Equal(token, ClockCorners.ToToken(corner));
        Assert.True(ClockCorners.TryFromToken(token, out var parsed));
        Assert.Equal(corner, parsed);
    }

    [Fact]
    public void ClockCorner_from_unknown_token_is_false_and_defaults_to_bottom_right()
    {
        Assert.False(ClockCorners.TryFromToken("middle", out var corner));
        Assert.Equal(ClockCorner.BottomRight, corner);
        Assert.False(ClockCorners.TryFromToken(null, out var fromNull));
        Assert.Equal(ClockCorner.BottomRight, fromNull);
    }

    // ── Registration: web DEFAULT_KIOSK_CONFIG + bounds + slug ───────────────────────────────────────────

    [Fact]
    public void Registration_pins_the_web_defaults()
    {
        Assert.Equal("KioskSettingsModal", KioskSettingsModalRegistration.Slug);
        Assert.Equal(30, KioskSettingsModalRegistration.DefaultRotateIntervalSeconds);
        Assert.True(KioskSettingsModalRegistration.DefaultHideCursor);
        Assert.Equal(5, KioskSettingsModalRegistration.DefaultCursorTimeoutSeconds);
        Assert.Equal(0, KioskSettingsModalRegistration.DefaultDimAfterMinutes);
        Assert.Equal(0.5, KioskSettingsModalRegistration.DefaultDimLevel);
        Assert.True(KioskSettingsModalRegistration.DefaultShowClock);
        Assert.Equal(ClockCorner.BottomRight, KioskSettingsModalRegistration.DefaultClockPosition);
        Assert.Equal(1.0, KioskSettingsModalRegistration.DefaultWidgetOpacity);
        Assert.Equal(1.0, KioskSettingsModalRegistration.DefaultBackgroundOpacity);
    }

    [Fact]
    public void Registration_pins_the_web_slider_bounds()
    {
        Assert.Equal(30, KioskSettingsModalRegistration.DimLevelMinPercent);
        Assert.Equal(90, KioskSettingsModalRegistration.DimLevelMaxPercent);
        Assert.Equal(30, KioskSettingsModalRegistration.WidgetOpacityMinPercent);
        Assert.Equal(100, KioskSettingsModalRegistration.WidgetOpacityMaxPercent);
        Assert.Equal(0, KioskSettingsModalRegistration.BackgroundOpacityMinPercent);
        Assert.Equal(100, KioskSettingsModalRegistration.BackgroundOpacityMaxPercent);
        Assert.Equal(5, KioskSettingsModalRegistration.OpacityStepPercent);
    }

    [Fact]
    public void Registration_pins_the_web_option_value_arrays()
    {
        Assert.Equal([0, 10, 15, 30, 60, 120, 300], KioskSettingsModalRegistration.RotationIntervalValues);
        Assert.Equal([3, 5, 10, 15], KioskSettingsModalRegistration.CursorTimeoutValues);
        Assert.Equal([0, 5, 10, 15, 30, 60], KioskSettingsModalRegistration.DimAfterValues);
        Assert.Equal(
            [ClockCorner.TopLeft, ClockCorner.TopRight, ClockCorner.BottomLeft, ClockCorner.BottomRight],
            KioskSettingsModalRegistration.ClockCornerOrder);
    }

    [Fact]
    public void DefaultConfig_matches_the_web_DEFAULT_KIOSK_CONFIG()
    {
        var config = KioskConfig.Default;
        Assert.Equal(30, config.RotateIntervalSeconds);
        Assert.Empty(config.DashboardIds);
        Assert.True(config.HideCursor);
        Assert.Equal(5, config.CursorTimeoutSeconds);
        Assert.Equal(0, config.DimAfterMinutes);
        Assert.Equal(0.5, config.DimLevel);
        Assert.True(config.ShowClock);
        Assert.Equal(ClockCorner.BottomRight, config.ClockPosition);
        Assert.Equal(1.0, config.WidgetOpacity);
        Assert.Equal(1.0, config.BackgroundOpacity);
    }

    // ── Registration: i18n labels (the Narrator-label source; web t('kiosk.…')) ──────────────────────────

    [Fact]
    public void Registration_resolves_the_web_labels_via_fallback()
    {
        Assert.Equal("Kiosk Settings", KioskSettingsModalRegistration.SettingsTitle(Localizer));
        Assert.Equal("Dashboard Rotation", KioskSettingsModalRegistration.RotationTitle(Localizer));
        Assert.Equal("Rotation Interval", KioskSettingsModalRegistration.RotationIntervalLabel(Localizer));
        Assert.Equal("Dashboards to Rotate", KioskSettingsModalRegistration.DashboardsToRotateLabel(Localizer));
        Assert.Equal("Default", KioskSettingsModalRegistration.DefaultBadge(Localizer));
        Assert.Equal("Display", KioskSettingsModalRegistration.DisplayTitle(Localizer));
        Assert.Equal("Auto-hide Cursor", KioskSettingsModalRegistration.HideCursorLabel(Localizer));
        Assert.Equal("Hide After", KioskSettingsModalRegistration.CursorTimeoutLabel(Localizer));
        Assert.Equal("Dim Screen After", KioskSettingsModalRegistration.DimAfterLabel(Localizer));
        Assert.Equal("Dimmed Brightness", KioskSettingsModalRegistration.BrightnessLabel(Localizer));
        Assert.Equal("Show Clock", KioskSettingsModalRegistration.ShowClockLabel(Localizer));
        Assert.Equal("Clock Position", KioskSettingsModalRegistration.ClockPositionLabel(Localizer));
        Assert.Equal("Transparency", KioskSettingsModalRegistration.TransparencyTitle(Localizer));
        Assert.Equal("Widget Opacity", KioskSettingsModalRegistration.WidgetOpacityLabel(Localizer));
        Assert.Equal("Background Opacity", KioskSettingsModalRegistration.BackgroundOpacityLabel(Localizer));
        Assert.Equal("Transparent", KioskSettingsModalRegistration.TransparentLabel(Localizer));
        Assert.Equal("Solid", KioskSettingsModalRegistration.SolidLabel(Localizer));
        Assert.Equal("Enter Kiosk Mode", KioskSettingsModalRegistration.EnterLabel(Localizer));
        Assert.Equal("Cancel", KioskSettingsModalRegistration.CancelLabel(Localizer));
        Assert.Equal(
            "Preview \u2014 this is how widgets will look",
            KioskSettingsModalRegistration.PreviewText(Localizer));
        Assert.Equal(
            "Adjust widget and background opacity. Higher values are more solid and readable.",
            KioskSettingsModalRegistration.TransparencyDescription(Localizer));
        Assert.StartsWith("Kiosk mode enters fullscreen", KioskSettingsModalRegistration.HintText(Localizer));
    }

    [Theory]
    [InlineData(3, "3s")]
    [InlineData(10, "10s")]
    public void SecondsLabel_appends_the_seconds_unit(int seconds, string expected) =>
        Assert.Equal(expected, KioskSettingsModalRegistration.SecondsLabel(Localizer, seconds));

    [Theory]
    [InlineData(1, "1 min")]
    [InlineData(5, "5 min")]
    public void MinutesLabel_appends_the_minutes_unit(int minutes, string expected) =>
        Assert.Equal(expected, KioskSettingsModalRegistration.MinutesLabel(Localizer, minutes));

    [Fact]
    public void PercentLabel_appends_the_percent_sign() =>
        Assert.Equal("75%", KioskSettingsModalRegistration.PercentLabel(75));

    // ── Projection: progressive-disclosure gates (web conditional render branches) ───────────────────────

    [Theory]
    [InlineData(0, 3, false)]   // rotation off
    [InlineData(30, 1, false)]  // only one dashboard
    [InlineData(30, 0, false)]  // no dashboards
    [InlineData(30, 2, true)]   // rotation on + > 1 dashboard
    public void ShouldShowDashboardList_matches_web_gate(int rotateSeconds, int dashboardCount, bool expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.ShouldShowDashboardList(rotateSeconds, dashboardCount));

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void ShouldShowCursorTimeout_matches_hideCursor(bool hideCursor, bool expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.ShouldShowCursorTimeout(hideCursor));

    [Theory]
    [InlineData(0, false)]
    [InlineData(5, true)]
    public void ShouldShowDimBrightness_matches_dimAfter(int dimAfter, bool expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.ShouldShowDimBrightness(dimAfter));

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void ShouldShowClockPosition_matches_showClock(bool showClock, bool expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.ShouldShowClockPosition(showClock));

    // ── Projection: initial selection (web selectedIds seed) ─────────────────────────────────────────────

    [Fact]
    public void InitialSelection_uses_saved_ids_when_present()
    {
        var dashboards = Dashboards("d1", "d2", "d3");
        var selection = KioskSettingsModalProjection.InitialSelection(["d2", "d3"], dashboards);
        Assert.Equal(["d2", "d3"], selection);
    }

    [Fact]
    public void InitialSelection_falls_back_to_all_dashboards_when_none_saved()
    {
        var dashboards = Dashboards("d1", "d2", "d3");
        var selection = KioskSettingsModalProjection.InitialSelection(Array.Empty<string>(), dashboards);
        Assert.Equal(["d1", "d2", "d3"], selection);
    }

    [Fact]
    public void InitialSelection_drops_unknown_saved_ids()
    {
        var dashboards = Dashboards("d1", "d2");
        var selection = KioskSettingsModalProjection.InitialSelection(["d1", "ghost"], dashboards);
        Assert.Equal(["d1"], selection);
    }

    [Fact]
    public void InitialSelection_falls_back_to_all_when_all_saved_ids_are_unknown()
    {
        var dashboards = Dashboards("d1", "d2");
        var selection = KioskSettingsModalProjection.InitialSelection(["ghost"], dashboards);
        Assert.Equal(["d1", "d2"], selection);
    }

    // ── Projection: toggle (web toggleDashboard + sticky-last rule) ──────────────────────────────────────

    [Theory]
    [InlineData(2, true)]
    [InlineData(1, false)]
    public void CanDeselect_keeps_the_last_selection(int selectedCount, bool expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.CanDeselect(selectedCount));

    [Fact]
    public void Toggle_adds_an_unselected_dashboard()
    {
        var next = KioskSettingsModalProjection.Toggle(["d1"], "d2");
        Assert.Equal(["d1", "d2"], next);
    }

    [Fact]
    public void Toggle_removes_a_selected_dashboard_when_more_than_one_remains()
    {
        var next = KioskSettingsModalProjection.Toggle(["d1", "d2"], "d1");
        Assert.Equal(["d2"], next);
    }

    [Fact]
    public void Toggle_keeps_the_last_selected_dashboard()
    {
        var next = KioskSettingsModalProjection.Toggle(["d1"], "d1");
        Assert.Equal(["d1"], next);
    }

    // ── Projection: dropdown options (web option arrays + labels) ────────────────────────────────────────

    [Fact]
    public void RotationOptions_match_the_web_values_and_labels()
    {
        var options = KioskSettingsModalProjection.RotationOptions(Localizer);
        Assert.Equal([0, 10, 15, 30, 60, 120, 300], options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Off", "10s", "15s", "30s", "1 min", "2 min", "5 min"],
            options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void CursorTimeoutOptions_match_the_web_values_and_labels()
    {
        var options = KioskSettingsModalProjection.CursorTimeoutOptions(Localizer);
        Assert.Equal([3, 5, 10, 15], options.Select(o => o.Value).ToArray());
        Assert.Equal(["3s", "5s", "10s", "15s"], options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void DimAfterOptions_match_the_web_values_and_labels()
    {
        var options = KioskSettingsModalProjection.DimAfterOptions(Localizer);
        Assert.Equal([0, 5, 10, 15, 30, 60], options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Never", "5 min", "10 min", "15 min", "30 min", "60 min"],
            options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void ClockPositionOptions_match_the_web_values_and_labels()
    {
        var options = KioskSettingsModalProjection.ClockPositionOptions(Localizer);
        Assert.Equal(
            [ClockCorner.TopLeft, ClockCorner.TopRight, ClockCorner.BottomLeft, ClockCorner.BottomRight],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Top Left", "Top Right", "Bottom Left", "Bottom Right"],
            options.Select(o => o.Label).ToArray());
    }

    // ── Projection: live-preview swatch maths (web rgba / blur) ──────────────────────────────────────────

    [Fact]
    public void ComputePreview_at_full_opacity_matches_web()
    {
        var preview = KioskSettingsModalProjection.ComputePreview(1.0, 1.0);
        Assert.Equal((byte)255, preview.BackgroundAlpha);
        Assert.Equal((byte)51, preview.WidgetAlpha); // round((0.03 + 1*0.17) * 255)
        Assert.Equal(16.0, preview.BlurRadiusPixels); // 4 + 1*12
    }

    [Fact]
    public void ComputePreview_at_minimum_widget_and_transparent_background_matches_web()
    {
        var preview = KioskSettingsModalProjection.ComputePreview(0.3, 0.0);
        Assert.Equal((byte)0, preview.BackgroundAlpha);
        Assert.Equal((byte)21, preview.WidgetAlpha); // round((0.03 + 0.3*0.17) * 255) = round(20.655)
        Assert.Equal(7.6, preview.BlurRadiusPixels, 3); // 4 + 0.3*12
    }

    [Fact]
    public void ComputePreview_rounds_half_away_from_zero_like_js_Math_round()
    {
        var preview = KioskSettingsModalProjection.ComputePreview(1.0, 0.5);
        Assert.Equal((byte)128, preview.BackgroundAlpha); // round(127.5)
    }

    [Fact]
    public void ComputePreview_clamps_out_of_range_inputs()
    {
        var preview = KioskSettingsModalProjection.ComputePreview(2.0, -1.0);
        Assert.Equal((byte)0, preview.BackgroundAlpha);
        Assert.Equal((byte)51, preview.WidgetAlpha);
        Assert.Equal(16.0, preview.BlurRadiusPixels);
    }

    [Fact]
    public void ComputePreview_treats_NaN_as_the_web_default_of_one()
    {
        var preview = KioskSettingsModalProjection.ComputePreview(double.NaN, double.NaN);
        Assert.Equal((byte)255, preview.BackgroundAlpha);
        Assert.Equal((byte)51, preview.WidgetAlpha);
    }

    [Theory]
    [InlineData(0.0, 0)]
    [InlineData(0.5, 50)]
    [InlineData(1.0, 100)]
    [InlineData(0.075, 8)] // round(7.5) away from zero
    public void OpacityToPercent_rounds_like_web(double opacity, int expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.OpacityToPercent(opacity));

    [Theory]
    [InlineData(50, 0.5)]
    [InlineData(100, 1.0)]
    [InlineData(0, 0.0)]
    public void PercentToOpacity_matches_web(int percent, double expected) =>
        Assert.Equal(expected, KioskSettingsModalProjection.PercentToOpacity(percent));

    // ── ViewModel: initial state + gates ─────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_initialises_from_config_and_seeds_all_dashboards()
    {
        var vm = NewViewModel();

        Assert.Equal(30, vm.RotateIntervalSeconds);
        Assert.True(vm.HideCursor);
        Assert.Equal(5, vm.CursorTimeoutSeconds);
        Assert.Equal(0, vm.DimAfterMinutes);
        Assert.Equal(0.5, vm.DimLevel);
        Assert.True(vm.ShowClock);
        Assert.Equal(ClockCorner.BottomRight, vm.ClockPosition);
        Assert.Equal(1.0, vm.WidgetOpacity);
        Assert.Equal(1.0, vm.BackgroundOpacity);
        Assert.Equal(["d1", "d2", "d3"], vm.SelectedIds);

        Assert.True(vm.ShowDashboardList);   // rotate 30 + 3 dashboards
        Assert.True(vm.ShowCursorTimeout);   // hideCursor true
        Assert.False(vm.ShowDimBrightness);  // dimAfter 0
        Assert.True(vm.ShowClockPosition);   // showClock true
    }

    [Fact]
    public void ViewModel_exposes_localized_labels_for_narrator()
    {
        var vm = NewViewModel();
        Assert.Equal("Kiosk Settings", vm.SettingsTitle);
        Assert.Equal("Enter Kiosk Mode", vm.EnterLabel);
        Assert.Equal("Cancel", vm.CancelLabel);
        Assert.Equal("100%", vm.WidgetOpacityDisplay);
        Assert.Equal("100%", vm.BackgroundOpacityDisplay);
        Assert.Equal("50%", vm.DimLevelDisplay);
    }

    // ── ViewModel: setters emit onUpdateConfig + flip the dependent gate ─────────────────────────────────

    [Fact]
    public void Setting_rotation_off_emits_config_and_hides_dashboard_list()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.RotateIntervalSeconds = 0;

        Assert.False(vm.ShowDashboardList);
        Assert.Equal(0, emitted.Last().RotateIntervalSeconds);
    }

    [Fact]
    public void Disabling_cursor_autohide_emits_config_and_hides_timeout()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.HideCursor = false;

        Assert.False(vm.ShowCursorTimeout);
        Assert.False(emitted.Last().HideCursor);
    }

    [Fact]
    public void Setting_dim_after_emits_config_and_shows_brightness()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.DimAfterMinutes = 10;

        Assert.True(vm.ShowDimBrightness);
        Assert.Equal(10, emitted.Last().DimAfterMinutes);
    }

    [Fact]
    public void Disabling_clock_emits_config_and_hides_clock_position()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.ShowClock = false;

        Assert.False(vm.ShowClockPosition);
        Assert.False(emitted.Last().ShowClock);
    }

    [Fact]
    public void Setting_widget_opacity_emits_config_and_recomputes_preview_and_readout()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.WidgetOpacity = 0.5;

        Assert.Equal(0.5, emitted.Last().WidgetOpacity);
        Assert.Equal(50, vm.WidgetOpacityPercent);
        Assert.Equal("50%", vm.WidgetOpacityDisplay);
        Assert.Equal((byte)29, vm.Preview.WidgetAlpha); // round((0.03 + 0.5*0.17) * 255)
    }

    [Fact]
    public void Setting_background_opacity_emits_config_and_recomputes_preview()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.BackgroundOpacity = 0.0;

        Assert.Equal(0.0, emitted.Last().BackgroundOpacity);
        Assert.Equal((byte)0, vm.Preview.BackgroundAlpha);
    }

    [Fact]
    public void Setting_clock_position_emits_config()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.ClockPosition = ClockCorner.TopLeft;

        Assert.Equal(ClockCorner.TopLeft, emitted.Last().ClockPosition);
    }

    [Fact]
    public void Setting_an_unchanged_value_does_not_emit_config()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.RotateIntervalSeconds = 30; // already 30

        Assert.Empty(emitted);
    }

    // ── ViewModel: dashboard toggle (web toggleDashboard) ────────────────────────────────────────────────

    [Fact]
    public void ToggleDashboard_emits_config_with_the_updated_selection()
    {
        var vm = NewViewModel();
        var emitted = CaptureConfig(vm);

        vm.ToggleDashboard("d2");

        Assert.Equal(["d1", "d3"], vm.SelectedIds);
        Assert.Equal(["d1", "d3"], emitted.Last().DashboardIds);
    }

    [Fact]
    public void ToggleDashboard_keeps_the_last_selection_and_emits_nothing()
    {
        var config = KioskConfig.Default with { DashboardIds = ["d1"] };
        var vm = NewViewModel(config);
        var emitted = CaptureConfig(vm);

        Assert.Equal(["d1"], vm.SelectedIds);
        vm.ToggleDashboard("d1");

        Assert.Equal(["d1"], vm.SelectedIds);
        Assert.Empty(emitted);
    }

    [Fact]
    public void IsSelected_reflects_the_current_selection()
    {
        var vm = NewViewModel();
        Assert.True(vm.IsSelected("d1"));
        vm.ToggleDashboard("d1");
        Assert.False(vm.IsSelected("d1"));
    }

    // ── ViewModel: enter / close contract (web handleEnter / onClose / onEnterKiosk) ─────────────────────

    [Fact]
    public void RequestEnterKiosk_emits_config_then_close_then_enter_in_web_order()
    {
        var vm = NewViewModel();
        var order = new List<string>();
        vm.ConfigUpdated += (_, _) => order.Add("config");
        vm.CloseRequested += (_, _) => order.Add("close");
        vm.EnterKioskRequested += (_, _) => order.Add("enter");

        vm.RequestEnterKiosk();

        Assert.Equal(["config", "close", "enter"], order);
    }

    [Fact]
    public void RequestEnterKiosk_emits_the_final_selection()
    {
        var vm = NewViewModel();
        vm.ToggleDashboard("d2"); // selection now d1, d3
        KioskConfig? committed = null;
        vm.ConfigUpdated += (_, config) => committed = config;

        vm.RequestEnterKiosk();

        Assert.NotNull(committed);
        Assert.Equal(["d1", "d3"], committed!.DashboardIds);
    }

    [Fact]
    public void RequestClose_requests_close_without_entering_kiosk()
    {
        var vm = NewViewModel();
        bool closed = false;
        bool entered = false;
        vm.CloseRequested += (_, _) => closed = true;
        vm.EnterKioskRequested += (_, _) => entered = true;

        vm.RequestClose();

        Assert.True(closed);
        Assert.False(entered);
    }

    // ── Diagnostics (PII-safe view.opened, P1/S11) ───────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new KioskSettingsModalDiagnostics(lines.Add);
        var vm = NewViewModel(diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(["view.opened slug=KioskSettingsModal"], lines);
    }

    [Fact]
    public void Diagnostics_counts_each_open()
    {
        var diagnostics = new KioskSettingsModalDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private static List<KioskConfig> CaptureConfig(KioskSettingsModalViewModel vm)
    {
        var emitted = new List<KioskConfig>();
        vm.ConfigUpdated += (_, config) => emitted.Add(config);
        return emitted;
    }
}
