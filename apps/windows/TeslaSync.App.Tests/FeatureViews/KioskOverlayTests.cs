using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the KioskOverlay surface's UI-thread-free logic — the overlay-config defaults, the
/// clock string adapters, the input→presentation projection (every conditional layer: dim, cursor, clock,
/// rotation dots, exit), the state-holder view-model's prop setters / tick / reload, the registration metadata,
/// the PII-safe diagnostics and the idempotent cursor controller. Mirrors the web spec
/// (web/src/features/dashboard/components/KioskOverlay.tsx + useKioskMode.ts). The WinUI view itself is
/// exercised by the app build (it is not linked into this headless project).
/// </summary>
public sealed class KioskOverlayTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    // A local-wall-clock instant whose offset matches the runner's zone, so LocalDateTime is deterministic
    // regardless of where the test runs. 2026-06-08 is a Monday.
    private static DateTimeOffset LocalInstant(int year, int month, int day, int hour, int minute)
    {
        var local = new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, TimeZoneInfo.Local.GetUtcOffset(local));
    }

    private static KioskOverlayInputs Inputs(
        KioskOverlayConfig? config = null,
        bool isDimmed = false,
        bool isCursorHidden = false,
        int dashboardCount = 1,
        int currentIndex = 0) =>
        new(config ?? KioskOverlayConfig.Default, isDimmed, isCursorHidden, dashboardCount, currentIndex);

    private static KioskOverlayPresentation Project(KioskOverlayInputs inputs, DateTimeOffset? now = null) =>
        KioskOverlayProjection.Project(inputs, now ?? LocalInstant(2026, 6, 8, 14, 30), Passthrough);

    // ---- Config / input defaults (web DEFAULT_KIOSK_CONFIG) -------------------------------------------

    [Fact]
    public void Config_default_mirrors_the_web_relevant_fields()
    {
        var config = KioskOverlayConfig.Default;

        Assert.Equal(0.5, config.DimLevel);
        Assert.True(config.ShowClock);
        Assert.Equal(KioskClockCorner.BottomRight, config.ClockCorner);
        Assert.Equal(30, config.RotateIntervalSeconds);
    }

    [Fact]
    public void Inputs_default_is_an_idle_single_dashboard()
    {
        var inputs = KioskOverlayInputs.Default;

        Assert.Equal(KioskOverlayConfig.Default, inputs.Config);
        Assert.False(inputs.IsDimmed);
        Assert.False(inputs.IsCursorHidden);
        Assert.Equal(1, inputs.DashboardCount);
        Assert.Equal(0, inputs.CurrentIndex);
    }

    // ---- Clock string adapters (web useDateFormat) ---------------------------------------------------

    [Fact]
    public void Clock_formatters_match_web_formatTime_and_formatDateWithDay()
    {
        var now = LocalInstant(2026, 6, 8, 14, 30);

        Assert.Equal("02:30 PM", KioskClockFormat.FormatTime(now));
        Assert.Equal("Mon, Jun 8", KioskClockFormat.FormatDateWithDay(now));
    }

    [Fact]
    public void Clock_time_formats_morning_with_leading_zero()
    {
        Assert.Equal("09:05 AM", KioskClockFormat.FormatTime(LocalInstant(2026, 6, 8, 9, 5)));
    }

    // ---- Projection adapter: dim layer (web isDimmed + opacity 1-dimLevel) ----------------------------

    [Fact]
    public void Project_not_dimmed_hides_the_dim_layer()
    {
        var p = Project(Inputs(isDimmed: false));

        Assert.False(p.ShowDim);
        Assert.Equal(0.0, p.DimOpacity);
    }

    [Theory]
    [InlineData(0.5, 0.5)]
    [InlineData(0.0, 1.0)]
    [InlineData(1.0, 0.0)]
    [InlineData(2.0, 0.0)]   // out of range -> clamped
    [InlineData(-1.0, 1.0)]  // out of range -> clamped
    public void Project_dim_opacity_is_clamped_one_minus_dim_level(double dimLevel, double expectedOpacity)
    {
        var config = KioskOverlayConfig.Default with { DimLevel = dimLevel };
        var p = Project(Inputs(config: config, isDimmed: true));

        Assert.True(p.ShowDim);
        Assert.Equal(expectedOpacity, p.DimOpacity, 3);
    }

    // ---- Projection adapter: cursor (web isCursorHidden) ---------------------------------------------

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Project_passes_through_cursor_hidden(bool hidden)
    {
        Assert.Equal(hidden, Project(Inputs(isCursorHidden: hidden)).HideCursor);
    }

    // ---- Projection adapter: clock (web config.showClock + position) ---------------------------------

    [Fact]
    public void Project_show_clock_builds_the_readout_at_the_configured_corner()
    {
        var config = KioskOverlayConfig.Default with { ShowClock = true, ClockCorner = KioskClockCorner.TopLeft };
        var p = Project(Inputs(config: config), LocalInstant(2026, 6, 8, 14, 30));

        Assert.True(p.ShowClock);
        Assert.NotNull(p.Clock);
        Assert.Equal("02:30 PM", p.Clock!.Time);
        Assert.Equal("Mon, Jun 8", p.Clock.DateWithDay);
        Assert.Equal(KioskClockCorner.TopLeft, p.Clock.Corner);
    }

    [Fact]
    public void Project_hide_clock_yields_no_readout()
    {
        var config = KioskOverlayConfig.Default with { ShowClock = false };
        var p = Project(Inputs(config: config));

        Assert.False(p.ShowClock);
        Assert.Null(p.Clock);
    }

    // ---- Projection adapter: rotation dots (web dashboardCount>1 && rotateInterval>0) -----------------

    [Fact]
    public void Project_rotation_dots_render_one_per_dashboard_with_active_marked()
    {
        var p = Project(Inputs(dashboardCount: 3, currentIndex: 1));

        Assert.True(p.ShowRotationDots);
        Assert.Equal(3, p.RotationDots.Count);
        Assert.Equal(1, p.ActiveDotIndex);
        Assert.Collection(
            p.RotationDots,
            d => Assert.False(d.IsActive),
            d => Assert.True(d.IsActive),
            d => Assert.False(d.IsActive));
    }

    [Fact]
    public void Project_single_dashboard_hides_the_dots()
    {
        var p = Project(Inputs(dashboardCount: 1, currentIndex: 0));

        Assert.False(p.ShowRotationDots);
        Assert.Empty(p.RotationDots);
        Assert.Equal(-1, p.ActiveDotIndex);
    }

    [Fact]
    public void Project_zero_rotate_interval_hides_the_dots()
    {
        var config = KioskOverlayConfig.Default with { RotateIntervalSeconds = 0 };
        var p = Project(Inputs(config: config, dashboardCount: 4, currentIndex: 2));

        Assert.False(p.ShowRotationDots);
        Assert.Empty(p.RotationDots);
    }

    [Theory]
    [InlineData(99, 4)]   // over the end -> clamped to last
    [InlineData(-3, 0)]   // before the start -> clamped to first
    public void Project_active_dot_index_is_clamped(int currentIndex, int expectedActive)
    {
        var p = Project(Inputs(dashboardCount: 5, currentIndex: currentIndex));

        Assert.Equal(expectedActive, p.ActiveDotIndex);
        Assert.True(p.RotationDots[expectedActive].IsActive);
    }

    // ---- Projection adapter: exit + region labels (web i18n) -----------------------------------------

    [Fact]
    public void Project_exit_and_region_labels_resolve_to_english_fallbacks()
    {
        var p = Project(Inputs());

        Assert.Equal("Exit kiosk mode", p.ExitAriaLabel);
        Assert.Equal("Exit Kiosk", p.ExitButtonLabel);
        Assert.Equal("Kiosk", p.RegionName);
    }

    [Fact]
    public void Project_requests_exactly_the_web_i18n_keys()
    {
        var recorder = new RecordingLocalizer();

        KioskOverlayProjection.Project(Inputs(), LocalInstant(2026, 6, 8, 14, 30), recorder);

        Assert.Contains("translation.kiosk.exit", recorder.Keys);
        Assert.Contains("translation.kiosk.exitLabel", recorder.Keys);
        Assert.Contains("translation.dashboard.kiosk", recorder.Keys);
    }

    [Fact]
    public void Project_null_arguments_are_rejected()
    {
        Assert.Throws<ArgumentNullException>(() =>
            KioskOverlayProjection.Project(null!, LocalInstant(2026, 6, 8, 14, 30), Passthrough));
        Assert.Throws<ArgumentNullException>(() =>
            KioskOverlayProjection.Project(Inputs(), LocalInstant(2026, 6, 8, 14, 30), null!));
    }

    // ---- View-model state holder ---------------------------------------------------------------------

    [Fact]
    public void ViewModel_initial_presentation_projects_the_supplied_inputs()
    {
        var vm = new KioskOverlayViewModel(
            Passthrough,
            Inputs(dashboardCount: 2, currentIndex: 0),
            () => LocalInstant(2026, 6, 8, 14, 30));

        Assert.True(vm.Presentation.ShowClock);
        Assert.True(vm.Presentation.ShowRotationDots);
        Assert.Equal("Exit Kiosk", vm.ExitButtonLabel);
        Assert.Equal("Kiosk", vm.RegionName);
    }

    [Fact]
    public void ViewModel_set_dimmed_updates_presentation_and_notifies()
    {
        var vm = new KioskOverlayViewModel(Passthrough);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.SetDimmed(true);

        Assert.True(vm.Presentation.ShowDim);
        Assert.Contains(nameof(KioskOverlayViewModel.Presentation), changed);
    }

    [Fact]
    public void ViewModel_set_cursor_hidden_flows_to_presentation()
    {
        var vm = new KioskOverlayViewModel(Passthrough);

        vm.SetCursorHidden(true);

        Assert.True(vm.Presentation.HideCursor);
    }

    [Fact]
    public void ViewModel_set_rotation_drives_the_dots()
    {
        var vm = new KioskOverlayViewModel(Passthrough);

        vm.SetRotation(dashboardCount: 4, currentIndex: 2);

        Assert.True(vm.Presentation.ShowRotationDots);
        Assert.Equal(4, vm.Presentation.RotationDots.Count);
        Assert.Equal(2, vm.Presentation.ActiveDotIndex);
    }

    [Fact]
    public void ViewModel_set_config_can_hide_the_clock()
    {
        var vm = new KioskOverlayViewModel(Passthrough);

        vm.SetConfig(KioskOverlayConfig.Default with { ShowClock = false });

        Assert.False(vm.Presentation.ShowClock);
        Assert.Null(vm.Presentation.Clock);
    }

    [Fact]
    public void ViewModel_update_with_equal_inputs_is_a_no_op()
    {
        var vm = new KioskOverlayViewModel(Passthrough);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.SetDimmed(false); // already false

        Assert.Empty(changed);
    }

    [Fact]
    public void ViewModel_tick_reprojects_the_clock_from_the_advancing_instant()
    {
        var now = LocalInstant(2026, 6, 8, 14, 30);
        var vm = new KioskOverlayViewModel(Passthrough, Inputs(), () => now);
        Assert.Equal("02:30 PM", vm.Presentation.Clock!.Time);

        var ticked = false;
        vm.PropertyChanged += (_, e) => ticked |= e.PropertyName == nameof(KioskOverlayViewModel.Presentation);

        now = LocalInstant(2026, 6, 8, 14, 31);
        vm.Tick();

        Assert.Equal("02:31 PM", vm.Presentation.Clock!.Time);
        Assert.True(ticked);
    }

    [Fact]
    public void ViewModel_reload_reresolves_labels_after_a_language_change()
    {
        var localizer = new SuffixLocalizer();
        var vm = new KioskOverlayViewModel(localizer);
        Assert.Equal("Exit Kiosk", vm.ExitButtonLabel);

        localizer.Suffix = " \u2605";
        vm.Reload();

        Assert.Equal("Exit Kiosk \u2605", vm.ExitButtonLabel);
        Assert.Equal("Kiosk \u2605", vm.RegionName);
    }

    // ---- Registration + diagnostics ------------------------------------------------------------------

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("KioskOverlay", KioskOverlayRegistration.Slug);
    }

    [Fact]
    public void Registration_exposes_the_namespaced_web_keys()
    {
        Assert.Equal("translation.kiosk.exit", KioskOverlayRegistration.ExitAriaKey);
        Assert.Equal("translation.kiosk.exitLabel", KioskOverlayRegistration.ExitLabelKey);
        Assert.Equal("translation.dashboard.kiosk", KioskOverlayRegistration.RegionKey);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new KioskOverlayDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=KioskOverlay", "view.opened slug=KioskOverlay" },
            emitted);
    }

    // ---- Cursor controller (idempotent transition adapter) -------------------------------------------

    [Fact]
    public void CursorController_applies_only_on_a_real_transition()
    {
        var applied = new List<bool>();
        var controller = new KioskCursorController(applied.Add);

        Assert.False(controller.IsHidden);

        controller.SetCursorHidden(true);
        controller.SetCursorHidden(true);   // repeat -> no-op
        controller.SetCursorHidden(false);
        controller.SetCursorHidden(false);  // repeat -> no-op

        Assert.Equal(new[] { true, false }, applied);
        Assert.False(controller.IsHidden);
    }

    [Fact]
    public void CursorController_rejects_a_null_effect()
    {
        Assert.Throws<ArgumentNullException>(() => new KioskCursorController(null!));
    }

    // ---- Accessibility labels present ----------------------------------------------------------------

    [Fact]
    public void Accessibility_labels_are_never_blank()
    {
        var p = Project(Inputs());

        Assert.False(string.IsNullOrWhiteSpace(p.ExitAriaLabel));
        Assert.False(string.IsNullOrWhiteSpace(p.ExitButtonLabel));
        Assert.False(string.IsNullOrWhiteSpace(p.RegionName));
    }

    // ---- Test localizers -----------------------------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class SuffixLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
