using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.StateMachine;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveControls</c> feature surface's UI-thread-free logic — the counter
/// projection (the web <c>windowCount ?? bufferCount ?? 0</c> / <c>totalCount ?? bufferCount ?? 0</c> /
/// <c>outside</c> / <c>dual</c> maths and the dual vs. legacy single-scope copy selection), the four window
/// options + selected-value mapping, the controlled toggle / step pass-through that drives each render branch,
/// the localized labels + accessible name, and the diagnostics. Mirrors the web spec
/// (web/src/features/system/components/state-machine/LiveControls.tsx). Because the web source is a purely
/// controlled component (only <c>useTranslation</c>; it performs no fetch), its visible states are the
/// controlled branches asserted below — live/frozen, step enable/disable, dual/single counter — not the
/// freshness states of a cache-then-network read. The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class LiveControlsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LiveControlsModel Model(
        bool isLive = true,
        bool canStepPrev = false,
        bool canStepNext = false,
        int windowMinutes = 30,
        int? windowCount = null,
        int? totalCount = null,
        int? bufferCount = null) =>
        new(isLive, canStepPrev, canStepNext, windowMinutes, windowCount, totalCount, bufferCount);

    private static LiveControlsDisplay Project(LiveControlsModel model) =>
        LiveControlsProjection.Project(model, Localizer);

    // ── Counter adapter: inWindow / total / outside / dual (web parity) ─────────────────────────────

    [Fact]
    public void Counter_with_no_counts_is_zero_and_single_scope()
    {
        var display = Project(Model());

        Assert.Equal(0, display.InWindow);
        Assert.Equal(0, display.Total);
        Assert.Equal(0, display.Outside);
        Assert.False(display.Dual);
        Assert.Equal("0 buffered", display.CounterLabel);
    }

    [Fact]
    public void Counter_legacy_buffer_count_drives_both_scopes()
    {
        // Web fallback: bufferCount alone → inWindow = total = bufferCount, dual false ("{n} buffered").
        var display = Project(Model(bufferCount: 12));

        Assert.Equal(12, display.InWindow);
        Assert.Equal(12, display.Total);
        Assert.Equal(0, display.Outside);
        Assert.False(display.Dual);
        Assert.Equal("12 buffered", display.CounterLabel);
    }

    [Fact]
    public void Counter_dual_scope_when_window_and_total_differ()
    {
        var display = Project(Model(windowCount: 3, totalCount: 10));

        Assert.Equal(3, display.InWindow);
        Assert.Equal(10, display.Total);
        Assert.Equal(7, display.Outside);
        Assert.True(display.Dual);
        Assert.Equal("3 in window \u00b7 10 in 24 h", display.CounterLabel);
    }

    [Fact]
    public void Counter_dual_collapses_to_single_copy_when_nothing_is_outside()
    {
        // dual=true but outside==0 → the web renders the single-scope "{n} buffered" copy.
        var display = Project(Model(windowCount: 10, totalCount: 10));

        Assert.True(display.Dual);
        Assert.Equal(0, display.Outside);
        Assert.Equal("10 buffered", display.CounterLabel);
    }

    [Fact]
    public void Counter_total_falls_back_to_buffer_count_when_only_window_is_set()
    {
        // windowCount present (dual), totalCount null → total uses bufferCount fallback.
        var display = Project(Model(windowCount: 5, bufferCount: 8));

        Assert.Equal(5, display.InWindow);
        Assert.Equal(8, display.Total);
        Assert.Equal(3, display.Outside);
        Assert.True(display.Dual);
        Assert.Equal("5 in window \u00b7 8 in 24 h", display.CounterLabel);
    }

    [Fact]
    public void Counter_outside_never_goes_negative()
    {
        // inWindow > total can only arise from mismatched inputs; the web clamps with Math.max(0, …).
        var display = Project(Model(windowCount: 9, totalCount: 4));

        Assert.Equal(0, display.Outside);
        Assert.Equal("9 buffered", display.CounterLabel); // dual but outside==0 → single copy
    }

    [Theory]
    [InlineData(5, 7)]
    [InlineData(30, 0)]
    [InlineData(120, 42)]
    public void Tooltip_reports_the_window_minutes_and_outside_count(int windowMinutes, int outside)
    {
        var display = Project(Model(windowMinutes: windowMinutes, windowCount: 1, totalCount: 1 + outside));

        Assert.Equal(
            $"Counts inside the {windowMinutes}-minute Window dropdown. {outside} more transitions fetched in the last 24 h.",
            display.TooltipLabel);
    }

    // ── Window options: the four web windows, value = minute count ──────────────────────────────────

    [Fact]
    public void Window_options_are_the_four_web_windows()
    {
        var values = Project(Model()).WindowOptions.Select(o => o.Value).ToArray();

        Assert.Equal(new[] { "5", "10", "30", "120" }, values);
    }

    [Fact]
    public void Window_option_labels_localize_minutes_and_hours()
    {
        var labels = Project(Model()).WindowOptions.Select(o => o.Label).ToArray();

        Assert.Equal(new[] { "5 min", "10 min", "30 min", "2 h" }, labels);
    }

    [Fact]
    public void No_window_option_is_ever_disabled()
    {
        Assert.All(Project(Model()).WindowOptions, o => Assert.False(o.Disabled));
    }

    [Fact]
    public void Selected_window_value_is_the_minute_count_string()
    {
        Assert.Equal("120", Project(Model(windowMinutes: 120)).SelectedWindowValue);
    }

    [Fact]
    public void Selected_window_value_can_fall_outside_the_offered_options()
    {
        // The web Select shows nothing selected for an off-list value; the projection still surfaces it.
        Assert.Equal("7", Project(Model(windowMinutes: 7)).SelectedWindowValue);
    }

    // ── Controlled toggle + step branches (the surface's visible states) ────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Live_flag_is_passed_through(bool isLive)
    {
        Assert.Equal(isLive, Project(Model(isLive: isLive)).IsLive);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void Step_enablement_is_passed_through(bool canPrev, bool canNext)
    {
        var display = Project(Model(canStepPrev: canPrev, canStepNext: canNext));

        Assert.Equal(canPrev, display.CanStepPrev);
        Assert.Equal(canNext, display.CanStepNext);
    }

    // ── i18n: web English fallbacks via PassthroughLocalizer ────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var display = Project(Model());

        Assert.Equal("Live", display.LiveLabel);
        Assert.Equal("Freeze", display.FreezeLabel);
        Assert.Equal("Step to previous transition", display.StepPrevLabel);
        Assert.Equal("Step to next transition", display.StepNextLabel);
        Assert.Equal("Window", display.WindowLabel);
        Assert.Equal("Clear buffer", display.ClearLabel);
    }

    // ── i18n: every string resolves through its P1/S10 catalog key ──────────────────────────────────

    [Fact]
    public void Labels_resolve_through_their_catalog_keys()
    {
        var display = LiveControlsProjection.Project(Model(), new PrefixLocalizer());

        Assert.Equal("L:translation.debugger.controls.live", display.LiveLabel);
        Assert.Equal("L:translation.debugger.controls.freeze", display.FreezeLabel);
        Assert.Equal("L:translation.debugger.controls.stepPrev", display.StepPrevLabel);
        Assert.Equal("L:translation.debugger.controls.stepNext", display.StepNextLabel);
        Assert.Equal("L:translation.debugger.controls.window", display.WindowLabel);
        Assert.Equal("L:translation.debugger.controls.clear", display.ClearLabel);
    }

    [Fact]
    public void Counter_and_tooltip_resolve_through_their_catalog_keys()
    {
        var prefix = new PrefixLocalizer();

        Assert.Equal(
            "L:translation.debugger.controls.buffered",
            LiveControlsProjection.Project(Model(bufferCount: 1), prefix).CounterLabel);
        Assert.Equal(
            "L:translation.debugger.controls.bufferedDual",
            LiveControlsProjection.Project(Model(windowCount: 1, totalCount: 9), prefix).CounterLabel);
        Assert.Equal(
            "L:translation.debugger.controls.bufferedTooltip",
            LiveControlsProjection.Project(Model(), prefix).TooltipLabel);
    }

    [Fact]
    public void Window_option_labels_resolve_through_their_catalog_keys()
    {
        var options = LiveControlsProjection.Project(Model(), new PrefixLocalizer()).WindowOptions;

        Assert.Equal("L:translation.debugger.window.minutes", options[0].Label); // 5 min
        Assert.Equal("L:translation.debugger.window.hours", options[3].Label);   // 2 h
    }

    // ── Accessibility: the surface always exposes a non-empty accessible name ───────────────────────

    [Fact]
    public void Every_branch_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model(isLive: true)),
                Project(Model(isLive: false)),
                Project(Model(isLive: true, canStepPrev: true, canStepNext: true, windowCount: 3, totalCount: 10)),
                Project(Model(bufferCount: 5)),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Automation_name_reflects_the_live_or_frozen_state()
    {
        Assert.Contains("Live", Project(Model(isLive: true)).AutomationName, StringComparison.Ordinal);
        Assert.Contains("Freeze", Project(Model(isLive: false)).AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveControls, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveControlsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveControls", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("LiveControls", LiveControlsRegistration.Slug);
    }

    // ── Initial model ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_model_is_live_with_the_default_window_and_no_stepping()
    {
        var model = LiveControlsModel.Initial;

        Assert.True(model.IsLive);
        Assert.False(model.CanStepPrev);
        Assert.False(model.CanStepNext);
        Assert.Equal(30, model.WindowMinutes);
        Assert.Null(model.WindowCount);
        Assert.Null(model.TotalCount);
        Assert.Null(model.BufferCount);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
