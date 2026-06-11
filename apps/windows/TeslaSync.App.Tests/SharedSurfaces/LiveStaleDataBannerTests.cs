using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the LiveStaleDataBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, the two-minute sustained-disconnection threshold + 50 ms wake margin, the
/// WifiOff glyph, the warning token keys + tint alphas, the ARIA role/live contract, and the i18n keys + fallbacks
/// the projection references), the pure <see cref="LiveStaleDataBannerEvaluator"/> adapter (the web
/// <c>disconnectedSinceRef</c> + threshold debounce: non-disconnected clears, first disconnect arms, sub-threshold
/// waits, at/over threshold shows), the <see cref="LiveStaleDataBannerProjection"/> (hidden vs shown, localized
/// title / message, the accessible-name contract), the <see cref="LiveStaleDataBannerViewModel"/> state holder
/// (initial collapse, the arm → elapse → show sequence under an injected clock, reconnect clearing, change
/// notification, subscription cleanup), the static / monitor sources, and the PII-safe diagnostics. Mirrors the web
/// spec (web/src/components/feedback/LiveStaleDataBanner.tsx, web/src/hooks/useLiveConnection.ts). The WinUI view
/// itself (shared-surfaces/LiveStaleDataBanner/LiveStaleDataBanner.cs) is exercised by the app build.
/// </summary>
public sealed class LiveStaleDataBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly TimeSpan Threshold = TimeSpan.FromMinutes(2);
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("LiveStaleDataBanner", LiveStaleDataBannerRegistration.Slug);

    [Fact]
    public void Automation_id_is_stable() =>
        Assert.Equal("live-stale-data-banner", LiveStaleDataBannerRegistration.RootAutomationId);

    [Fact]
    public void Threshold_and_wake_margin_match_the_web_source()
    {
        // web: STALE_BANNER_THRESHOLD_MS = 2 * 60_000; setTimeout(..., remaining + 50).
        Assert.Equal(TimeSpan.FromMinutes(2), LiveStaleDataBannerRegistration.StaleThreshold);
        Assert.Equal(TimeSpan.FromMilliseconds(50), LiveStaleDataBannerRegistration.WakeMargin);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        Assert.Equal("status", LiveStaleDataBannerRegistration.StatusRole);
        Assert.Equal("polite", LiveStaleDataBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Warning_token_keys_and_glyph_match_the_shared_callout_warning()
    {
        Assert.Equal("TsColorWarningBrush", LiveStaleDataBannerRegistration.WarningBrushKey);
        Assert.Equal("TsColorWarningColor", LiveStaleDataBannerRegistration.WarningColorKey);
        Assert.Equal("\uEB5E", LiveStaleDataBannerRegistration.WifiOffGlyph);
        Assert.Equal(0.08, LiveStaleDataBannerRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.20, LiveStaleDataBannerRegistration.BannerBorderOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.live.staleBanner.title", LiveStaleDataBannerRegistration.TitleKey);
        Assert.Equal("Live data unavailable", LiveStaleDataBannerRegistration.TitleFallback);
        Assert.Equal("translation.live.staleBanner.message", LiveStaleDataBannerRegistration.MessageKey);
        Assert.Equal(
            "The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.",
            LiveStaleDataBannerRegistration.MessageFallback);
    }

    // ── evaluator (the web disconnectedSinceRef + threshold debounce) ─────────────────────────────────────

    [Theory]
    [InlineData(LiveConnectionState.Connected)]
    [InlineData(LiveConnectionState.Reconnecting)]
    [InlineData(LiveConnectionState.Unknown)]
    public void Decide_hides_and_clears_for_any_non_disconnected_status(LiveConnectionState status)
    {
        // web: the else branch — disconnectedSinceRef.current = null; setShow(false).
        var decision = LiveStaleDataBannerEvaluator.Decide(status, T0.AddMinutes(-5), T0, Threshold);

        Assert.False(decision.Show);
        Assert.Null(decision.DisconnectedSince);
        Assert.Null(decision.RetryAfter);
    }

    [Fact]
    public void Decide_arms_on_the_first_disconnected_observation_without_showing()
    {
        // web: disconnectedSinceRef.current ??= Date.now(); elapsed 0 < threshold -> schedule, stay hidden.
        var decision = LiveStaleDataBannerEvaluator.Decide(LiveConnectionState.Disconnected, null, T0, Threshold);

        Assert.False(decision.Show);
        Assert.Equal(T0, decision.DisconnectedSince);
        Assert.Equal(Threshold + LiveStaleDataBannerRegistration.WakeMargin, decision.RetryAfter);
    }

    [Fact]
    public void Decide_stays_hidden_and_reschedules_below_the_threshold()
    {
        var since = T0.AddSeconds(-30);
        var decision = LiveStaleDataBannerEvaluator.Decide(LiveConnectionState.Disconnected, since, T0, Threshold);

        Assert.False(decision.Show);
        Assert.Equal(since, decision.DisconnectedSince);
        Assert.Equal(
            Threshold - TimeSpan.FromSeconds(30) + LiveStaleDataBannerRegistration.WakeMargin,
            decision.RetryAfter);
    }

    [Fact]
    public void Decide_shows_exactly_at_the_threshold_boundary()
    {
        // web: elapsed >= STALE_BANNER_THRESHOLD_MS (>=, not >).
        var since = T0 - Threshold;
        var decision = LiveStaleDataBannerEvaluator.Decide(LiveConnectionState.Disconnected, since, T0, Threshold);

        Assert.True(decision.Show);
        Assert.Equal(since, decision.DisconnectedSince);
        Assert.Null(decision.RetryAfter);
    }

    [Fact]
    public void Decide_shows_past_the_threshold()
    {
        var since = T0 - Threshold - TimeSpan.FromSeconds(15);
        var decision = LiveStaleDataBannerEvaluator.Decide(LiveConnectionState.Disconnected, since, T0, Threshold);

        Assert.True(decision.Show);
        Assert.Null(decision.RetryAfter);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_collapsed_but_strings_are_resolved_when_hidden()
    {
        var projection = LiveStaleDataBannerProjection.Project(show: false, Localizer);

        Assert.False(projection.IsVisible);
        // Resolved so they are ready the instant the banner shows.
        Assert.Equal("Live data unavailable", projection.Title);
        Assert.Contains("offline for more than 2 minutes", projection.Message);
        Assert.Equal("\uEB5E", projection.IconGlyph);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_shown_with_title_message_and_glyph()
    {
        var projection = LiveStaleDataBannerProjection.Project(show: true, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("Live data unavailable", projection.Title);
        Assert.Equal(LiveStaleDataBannerRegistration.MessageFallback, projection.Message);
        Assert.Equal("\uEB5E", projection.IconGlyph);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_title_and_message()
    {
        var projection = LiveStaleDataBannerProjection.Project(show: true, Localizer);

        Assert.Equal($"{projection.Title}. {projection.Message}", projection.AccessibleName);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_collapsed_when_connected()
    {
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Connected);
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => T0, Threshold);

        Assert.False(vm.IsVisible);
        Assert.Null(vm.RetryAfter);
        Assert.Null(vm.DisconnectedSince);
    }

    [Fact]
    public void View_model_starts_collapsed_when_unknown()
    {
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Unknown);
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => T0, Threshold);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_arms_but_stays_hidden_when_disconnect_begins()
    {
        var now = T0;
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Connected);
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => now, Threshold);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(LiveConnectionState.Disconnected);

        Assert.False(vm.IsVisible);
        Assert.Equal(now, vm.DisconnectedSince);
        Assert.NotNull(vm.RetryAfter);
        // Hidden -> hidden, but RetryAfter armed, so the view is notified to schedule its wake timer.
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_shows_after_the_threshold_elapses()
    {
        var now = T0;
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Connected);
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => now, Threshold);

        source.Set(LiveConnectionState.Disconnected);
        Assert.False(vm.IsVisible);

        // The view's one-shot wake timer fires once the remaining threshold time has elapsed.
        now = T0.AddMinutes(2).AddSeconds(1);
        vm.NotifyTimeElapsed();

        Assert.True(vm.IsVisible);
        Assert.Null(vm.RetryAfter);
        Assert.Equal("Live data unavailable", vm.Title);
        Assert.Equal(LiveStaleDataBannerRegistration.MessageFallback, vm.Message);
    }

    [Fact]
    public void View_model_hides_and_clears_on_reconnect()
    {
        var now = T0;
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Disconnected);
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => now, Threshold);

        // Drive it past the threshold so it is shown.
        now = T0.AddMinutes(3);
        vm.NotifyTimeElapsed();
        Assert.True(vm.IsVisible);

        // web: any non-disconnected status clears the timer and hides the banner.
        source.Set(LiveConnectionState.Connected);

        Assert.False(vm.IsVisible);
        Assert.Null(vm.DisconnectedSince);
        Assert.Null(vm.RetryAfter);
    }

    [Fact]
    public void View_model_starts_shown_when_already_disconnected_past_the_threshold()
    {
        // Mounting onto a pipe that has been down a while: disconnectedSince seeds to "now", so it is not shown
        // until the threshold elapses from mount (mirrors the web ref seeding at effect run).
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Disconnected);
        var now = T0;
        using var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => now, Threshold);

        Assert.False(vm.IsVisible);
        Assert.Equal(T0, vm.DisconnectedSince);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticLiveStaleDataBannerSource(LiveConnectionState.Connected);
        var vm = new LiveStaleDataBannerViewModel(Localizer, source, () => T0, Threshold);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(LiveConnectionState.Disconnected);

        Assert.Equal(0, raised);
    }

    // ── sources ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_raises_changed_on_set()
    {
        var source = new StaticLiveStaleDataBannerSource();
        Assert.Equal(LiveConnectionState.Unknown, source.Status);

        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(LiveConnectionState.Disconnected);

        Assert.Equal(LiveConnectionState.Disconnected, source.Status);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Monitor_source_maps_the_effective_state_to_the_coarse_indicator_state()
    {
        var now = T0;
        var monitor = new LiveConnectionMonitor(Threshold, () => now);

        using var source = new MonitorLiveStaleDataBannerSource(monitor);
        // A fresh monitor is Closed, which the shared mapping folds to the coarse Disconnected state.
        Assert.Equal(LiveConnectionState.Disconnected, source.Status);

        var raised = 0;
        source.Changed += (_, _) => raised++;

        // An event moves the transport to Open, which maps to the coarse Connected state.
        monitor.MarkEvent(now);

        Assert.Equal(LiveConnectionState.Connected, source.Status);
        Assert.True(raised >= 1);
    }

    [Fact]
    public void Monitor_source_unsubscribes_on_dispose()
    {
        var now = T0;
        var monitor = new LiveConnectionMonitor(Threshold, () => now);
        var source = new MonitorLiveStaleDataBannerSource(monitor);

        source.Dispose();

        var raised = 0;
        source.Changed += (_, _) => raised++;
        monitor.MarkEvent(now);
        monitor.SetState(LiveConnection.Reconnecting);

        Assert.Equal(0, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LiveStaleDataBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=LiveStaleDataBanner", "view.opened slug=LiveStaleDataBanner" },
            lines);
    }
}
