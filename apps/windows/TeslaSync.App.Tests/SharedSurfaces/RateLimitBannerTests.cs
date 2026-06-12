using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RateLimitBanner shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / control automation ids, the Clock / AlertCircle / dismiss glyphs, the amber accent token
/// keys, and the i18n keys with their verbatim web fallbacks), the pure countdown / message helpers
/// (<see cref="RateLimitBannerRegistration.RemainingSeconds"/>, <see cref="RateLimitBannerRegistration.FormatMessage"/>),
/// the <see cref="RateLimitSignal"/> cooldown maths, the pure <see cref="RateLimitBannerProjection"/> across the
/// hidden / rate-limit / upstream-down / retry-armed states (and the accessible-name contract), the signal and
/// query-invalidation seams (<see cref="InMemoryRateLimitSignalSource"/> / <see cref="DelegatedRateLimitSignalSource"/>
/// and <see cref="CountingQueryInvalidator"/> / <see cref="DelegatedQueryInvalidator"/>), the
/// <see cref="RateLimitBannerViewModel"/> state holder (initial projection, capture on each signal, the per-second
/// countdown tick, the retry/dismiss actions, re-arm, and subscription cleanup), and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/feedback/RateLimitBanner.tsx). The WinUI view itself
/// (shared-surfaces/RateLimitBanner.cs) and its dispatcher timer are exercised by the app build.
/// </summary>
public sealed class RateLimitBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset T0 = new(2026, 6, 11, 12, 0, 0, TimeSpan.Zero);

    private static RateLimitBannerProjection Project(RateLimitSignal? signal, DateTimeOffset now, ILocalizer? localizer = null) =>
        RateLimitBannerProjection.Project(signal, now, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("RateLimitBanner", RateLimitBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("rate-limit-banner", RateLimitBannerRegistration.BannerAutomationId);
        Assert.Equal("rate-limit-banner-retry", RateLimitBannerRegistration.RetryAutomationId);
        Assert.Equal("rate-limit-banner-dismiss", RateLimitBannerRegistration.DismissAutomationId);
    }

    [Fact]
    public void Glyphs_match_the_shared_fluent_stand_ins()
    {
        Assert.Equal("\uE823", RateLimitBannerRegistration.RateLimitedGlyph);
        Assert.Equal("\uEA39", RateLimitBannerRegistration.UpstreamDownGlyph);
        Assert.Equal("\uE711", RateLimitBannerRegistration.DismissGlyph);
    }

    [Fact]
    public void Accent_tokens_match_the_amber_warning_ramp()
    {
        // web amber-300 icon/border tint, sourced from the W1 design "warning" tokens.
        Assert.Equal("TsColorWarningBrush", RateLimitBannerRegistration.AccentBrushKey);
        Assert.Equal("TsColorWarningColor", RateLimitBannerRegistration.AccentColorKey);
        Assert.Equal("#F59E0B", RateLimitBannerRegistration.AccentFallback);
    }

    [Fact]
    public void I18n_keys_resolve_under_the_translation_namespace()
    {
        string[] keys =
        {
            RateLimitBannerRegistration.RateLimitedKey,
            RateLimitBannerRegistration.UpstreamDownKey,
            RateLimitBannerRegistration.RetryKey,
            RateLimitBannerRegistration.DismissKey,
        };

        Assert.All(keys, key => Assert.StartsWith("translation.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void I18n_keys_match_the_web_call_sites()
    {
        Assert.Equal("translation.ratelimit.banner", RateLimitBannerRegistration.RateLimitedKey);
        Assert.Equal("translation.upstream.banner", RateLimitBannerRegistration.UpstreamDownKey);
        Assert.Equal("translation.ratelimit.retry", RateLimitBannerRegistration.RetryKey);
        Assert.Equal("translation.common.dismiss", RateLimitBannerRegistration.DismissKey);
    }

    [Fact]
    public void I18n_fallbacks_match_the_web_literals_verbatim()
    {
        Assert.Equal("Too many requests — pausing for {0}s", RateLimitBannerRegistration.RateLimitedFallback);
        Assert.Equal("Tesla upstream unavailable — retry in {0}s", RateLimitBannerRegistration.UpstreamDownFallback);
        Assert.Equal("Retry now", RateLimitBannerRegistration.RetryFallback);
        Assert.Equal("Dismiss", RateLimitBannerRegistration.DismissFallback);
    }

    [Theory]
    [InlineData(RateLimitKind.RateLimited, "\uE823")]
    [InlineData(RateLimitKind.UpstreamDown, "\uEA39")]
    public void GlyphFor_selects_the_per_kind_icon(RateLimitKind kind, string expected) =>
        Assert.Equal(expected, RateLimitBannerRegistration.GlyphFor(kind));

    [Theory]
    [InlineData(RateLimitKind.RateLimited, "translation.ratelimit.banner")]
    [InlineData(RateLimitKind.UpstreamDown, "translation.upstream.banner")]
    public void MessageKey_selects_the_per_kind_copy(RateLimitKind kind, string expected) =>
        Assert.Equal(expected, RateLimitBannerRegistration.MessageKey(kind));

    // ── countdown helper ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void RemainingSeconds_rounds_up_to_the_next_whole_second()
    {
        // web Math.ceil((expiresAt - now) / 1000): 2.5s left rounds up to 3.
        Assert.Equal(3, RateLimitBannerRegistration.RemainingSeconds(T0.AddMilliseconds(2500), T0));
        Assert.Equal(30, RateLimitBannerRegistration.RemainingSeconds(T0.AddSeconds(30), T0));
        Assert.Equal(1, RateLimitBannerRegistration.RemainingSeconds(T0.AddMilliseconds(1), T0));
    }

    [Fact]
    public void RemainingSeconds_clamps_at_zero_once_elapsed()
    {
        Assert.Equal(0, RateLimitBannerRegistration.RemainingSeconds(T0, T0));
        Assert.Equal(0, RateLimitBannerRegistration.RemainingSeconds(T0.AddSeconds(-5), T0));
    }

    // ── message formatting ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void FormatMessage_substitutes_the_remaining_seconds()
    {
        Assert.Equal(
            "Too many requests — pausing for 30s",
            RateLimitBannerRegistration.FormatMessage(Localizer, RateLimitKind.RateLimited, 30));
        Assert.Equal(
            "Tesla upstream unavailable — retry in 15s",
            RateLimitBannerRegistration.FormatMessage(Localizer, RateLimitKind.UpstreamDown, 15));
    }

    [Fact]
    public void FormatMessage_tolerates_a_template_without_a_count_slot()
    {
        var localizer = new FixedLocalizer("No countdown here");
        Assert.Equal("No countdown here", RateLimitBannerRegistration.FormatMessage(localizer, RateLimitKind.RateLimited, 9));
    }

    [Fact]
    public void FormatMessage_degrades_to_the_raw_template_on_a_malformed_count_slot()
    {
        var localizer = new FixedLocalizer("{0");
        Assert.Equal("{0", RateLimitBannerRegistration.FormatMessage(localizer, RateLimitKind.RateLimited, 9));
    }

    // ── signal maths ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void RateLimited_signal_anchors_the_window_to_now()
    {
        var signal = RateLimitSignal.RateLimited("/vehicles", 30, T0);
        Assert.Equal(RateLimitKind.RateLimited, signal.Kind);
        Assert.Equal("/vehicles", signal.Scope);
        Assert.Null(signal.Upstream);
        Assert.Equal(T0.AddSeconds(30), signal.ExpiresAt);
        Assert.Equal(30, signal.RemainingSeconds(T0));
    }

    [Fact]
    public void UpstreamDown_signal_anchors_the_window_to_now()
    {
        var signal = RateLimitSignal.UpstreamDown("tesla", 15, T0);
        Assert.Equal(RateLimitKind.UpstreamDown, signal.Kind);
        Assert.Equal("tesla", signal.Upstream);
        Assert.Null(signal.Scope);
        Assert.Equal(T0.AddSeconds(15), signal.ExpiresAt);
        Assert.Equal(15, signal.RemainingSeconds(T0));
    }

    [Theory]
    [InlineData(-5)]
    [InlineData(double.NaN)]
    [InlineData(double.NegativeInfinity)]
    public void Signal_clamps_a_non_positive_or_non_finite_window_to_now(double retryAfter)
    {
        // web Math.max(0, retryAfterSec): a negative/NaN window expires immediately.
        var signal = RateLimitSignal.RateLimited("/x", retryAfter, T0);
        Assert.Equal(T0, signal.ExpiresAt);
        Assert.Equal(0, signal.RemainingSeconds(T0));
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_hidden_when_no_signal_is_in_flight()
    {
        var p = Project(null, T0);
        Assert.False(p.IsVisible);
        Assert.Equal(string.Empty, p.Message);
        Assert.False(p.RetryEnabled);
        Assert.Equal(string.Empty, p.AccessibleName);

        // a11y action labels still resolve even while hidden, so a control bound to them is never label-less.
        Assert.Equal("Retry now", p.RetryLabel);
        Assert.Equal("Dismiss", p.DismissLabel);
        Assert.Equal("TsColorWarningBrush", p.AccentBrushKey);
    }

    [Fact]
    public void Projection_rate_limited_state_renders_clock_and_copy()
    {
        var p = Project(RateLimitSignal.RateLimited("/vehicles", 30, T0), T0);
        Assert.True(p.IsVisible);
        Assert.Equal(RateLimitKind.RateLimited, p.Kind);
        Assert.Equal("\uE823", p.Glyph);
        Assert.Equal(30, p.RemainingSeconds);
        Assert.Equal("Too many requests — pausing for 30s", p.Message);
        Assert.False(p.RetryEnabled); // disabled while counting down (web disabled={remaining > 0}).
        Assert.Equal(p.Message, p.AccessibleName);
    }

    [Fact]
    public void Projection_upstream_down_state_renders_alert_and_copy()
    {
        var p = Project(RateLimitSignal.UpstreamDown("tesla", 15, T0), T0);
        Assert.True(p.IsVisible);
        Assert.Equal(RateLimitKind.UpstreamDown, p.Kind);
        Assert.Equal("\uEA39", p.Glyph);
        Assert.Equal(15, p.RemainingSeconds);
        Assert.Equal("Tesla upstream unavailable — retry in 15s", p.Message);
        Assert.False(p.RetryEnabled);
    }

    [Fact]
    public void Projection_arms_retry_once_the_window_elapses_and_stays_visible()
    {
        var signal = RateLimitSignal.RateLimited("/vehicles", 30, T0);

        var counting = Project(signal, T0.AddSeconds(10));
        Assert.True(counting.IsVisible);
        Assert.Equal(20, counting.RemainingSeconds);
        Assert.False(counting.RetryEnabled);

        var armed = Project(signal, T0.AddSeconds(30));
        Assert.True(armed.IsVisible); // web keeps the banner up until retry/dismiss — it never auto-hides.
        Assert.Equal(0, armed.RemainingSeconds);
        Assert.True(armed.RetryEnabled);
    }

    // ── seams ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void InMemorySource_raises_rate_limited_and_upstream_signals()
    {
        var source = new InMemoryRateLimitSignalSource();
        var received = new List<RateLimitSignalEventArgs>();
        source.SignalReceived += (_, e) => received.Add(e);

        source.RaiseRateLimited("/vehicles", 30);
        source.RaiseUpstreamDown("tesla", 15);

        Assert.Equal(2, source.SignalCount);
        Assert.Equal(RateLimitKind.RateLimited, received[0].Kind);
        Assert.Equal("/vehicles", received[0].Scope);
        Assert.Equal(30d, received[0].RetryAfterSeconds);
        Assert.Equal(RateLimitKind.UpstreamDown, received[1].Kind);
        Assert.Equal("tesla", received[1].Upstream);
        Assert.Equal(15d, received[1].RetryAfterSeconds);
    }

    [Fact]
    public void DelegatedSource_publishes_both_signal_shapes()
    {
        var source = new DelegatedRateLimitSignalSource();
        RateLimitSignalEventArgs? last = null;
        source.SignalReceived += (_, e) => last = e;

        source.PublishRateLimited("/drives", 12);
        Assert.NotNull(last);
        Assert.Equal(RateLimitKind.RateLimited, last!.Kind);
        Assert.Equal("/drives", last.Scope);

        source.PublishUpstreamDown("tesla", 7);
        Assert.Equal(RateLimitKind.UpstreamDown, last!.Kind);
        Assert.Equal("tesla", last.Upstream);
    }

    [Fact]
    public void CountingInvalidator_counts_invalidations()
    {
        var invalidator = new CountingQueryInvalidator();
        Assert.Equal(0, invalidator.InvalidateCount);
        invalidator.InvalidateAll();
        invalidator.InvalidateAll();
        Assert.Equal(2, invalidator.InvalidateCount);
    }

    [Fact]
    public void DelegatedInvalidator_invokes_the_host_action()
    {
        var calls = 0;
        var invalidator = new DelegatedQueryInvalidator(() => calls++);
        invalidator.InvalidateAll();
        Assert.Equal(1, calls);
    }

    [Fact]
    public void DelegatedInvalidator_rejects_a_null_action() =>
        Assert.Throws<ArgumentNullException>(() => new DelegatedQueryInvalidator(null!));

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_hidden()
    {
        using var vm = NewViewModel(out _, out _, () => T0);
        Assert.False(vm.IsVisible);
        Assert.False(vm.Projection.RetryEnabled);
    }

    [Fact]
    public void ViewModel_shows_the_banner_when_a_rate_limit_signal_arrives()
    {
        using var vm = NewViewModel(out var source, out _, () => T0);
        var changes = CountChanges(vm);

        source.RaiseRateLimited("/vehicles", 30);

        Assert.True(vm.IsVisible);
        Assert.Equal(RateLimitKind.RateLimited, vm.Projection.Kind);
        Assert.Equal("Too many requests — pausing for 30s", vm.Message);
        Assert.True(changes() >= 1);
    }

    [Fact]
    public void ViewModel_shows_the_banner_when_an_upstream_signal_arrives()
    {
        using var vm = NewViewModel(out var source, out _, () => T0);
        source.RaiseUpstreamDown("tesla", 15);

        Assert.True(vm.IsVisible);
        Assert.Equal(RateLimitKind.UpstreamDown, vm.Projection.Kind);
        Assert.Equal("Tesla upstream unavailable — retry in 15s", vm.Message);
    }

    [Fact]
    public void ViewModel_tick_advances_the_countdown_and_arms_retry_at_zero()
    {
        var now = T0;
        using var vm = NewViewModel(out var source, out _, () => now);
        source.RaiseRateLimited("/vehicles", 30);
        Assert.Equal(30, vm.Projection.RemainingSeconds);

        now = T0.AddSeconds(1);
        vm.Tick();
        Assert.Equal(29, vm.Projection.RemainingSeconds);
        Assert.Equal("Too many requests — pausing for 29s", vm.Message);
        Assert.False(vm.RetryEnabled);

        now = T0.AddSeconds(30);
        vm.Tick();
        Assert.Equal(0, vm.Projection.RemainingSeconds);
        Assert.True(vm.RetryEnabled);
        Assert.True(vm.IsVisible);
    }

    [Fact]
    public void ViewModel_tick_does_not_notify_when_the_rendered_value_is_unchanged()
    {
        var now = T0;
        using var vm = NewViewModel(out var source, out _, () => now);
        source.RaiseRateLimited("/vehicles", 30);

        var changes = CountChanges(vm);
        now = T0.AddMilliseconds(200); // same whole-second remaining → no visible change.
        vm.Tick();
        Assert.Equal(0, changes());
    }

    [Fact]
    public void ViewModel_retry_clears_the_banner_and_invalidates_every_query()
    {
        using var vm = NewViewModel(out var source, out var invalidator, () => T0);
        source.RaiseRateLimited("/vehicles", 30);
        Assert.True(vm.IsVisible);

        vm.Retry();

        Assert.False(vm.IsVisible);
        Assert.Equal(1, invalidator.InvalidateCount);
    }

    [Fact]
    public void ViewModel_retry_when_hidden_does_not_invalidate()
    {
        using var vm = NewViewModel(out _, out var invalidator, () => T0);
        vm.Retry();
        Assert.False(vm.IsVisible);
        Assert.Equal(0, invalidator.InvalidateCount);
    }

    [Fact]
    public void ViewModel_dismiss_clears_the_banner_without_invalidating()
    {
        using var vm = NewViewModel(out var source, out var invalidator, () => T0);
        source.RaiseRateLimited("/vehicles", 30);

        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.Equal(0, invalidator.InvalidateCount);
    }

    [Fact]
    public void ViewModel_re_arms_after_a_dismissal_when_a_fresh_signal_arrives()
    {
        using var vm = NewViewModel(out var source, out _, () => T0);
        source.RaiseRateLimited("/vehicles", 30);
        vm.Dismiss();
        Assert.False(vm.IsVisible);

        source.RaiseUpstreamDown("tesla", 10);
        Assert.True(vm.IsVisible);
        Assert.Equal(RateLimitKind.UpstreamDown, vm.Projection.Kind);
    }

    [Fact]
    public void ViewModel_unsubscribes_on_dispose()
    {
        var vm = NewViewModel(out var source, out _, () => T0);
        var changes = CountChanges(vm);
        vm.Dispose();

        source.RaiseRateLimited("/vehicles", 30);

        Assert.False(vm.IsVisible);
        Assert.Equal(0, changes());
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new InMemoryRateLimitSignalSource();
        var invalidator = new CountingQueryInvalidator();
        Assert.Throws<ArgumentNullException>(() => new RateLimitBannerViewModel(null!, source, invalidator));
        Assert.Throws<ArgumentNullException>(() => new RateLimitBannerViewModel(Localizer, null!, invalidator));
        Assert.Throws<ArgumentNullException>(() => new RateLimitBannerViewModel(Localizer, source, null!));
    }

    // ── accessibility ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_announced_countdown_copy()
    {
        var p = Project(RateLimitSignal.RateLimited("/vehicles", 30, T0), T0);

        // web role="alert": the banner is announced by its message; the action controls carry their own labels.
        Assert.False(string.IsNullOrWhiteSpace(p.AccessibleName));
        Assert.Equal(p.Message, p.AccessibleName);
        Assert.False(string.IsNullOrWhiteSpace(p.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(p.DismissLabel));
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug_only()
    {
        var lines = new List<string>();
        var diagnostics = new RateLimitBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(lines, line => Assert.Equal("view.opened slug=RateLimitBanner", line));
    }

    [Fact]
    public void Diagnostics_never_leak_scope_or_upstream_pii()
    {
        var lines = new List<string>();
        var diagnostics = new RateLimitBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("/vehicles", line, StringComparison.Ordinal);
            Assert.DoesNotContain("tesla", line, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Diagnostics_are_silent_without_a_sink()
    {
        var diagnostics = new RateLimitBannerDiagnostics();
        diagnostics.RecordViewOpened();
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

    private static RateLimitBannerViewModel NewViewModel(
        out InMemoryRateLimitSignalSource source,
        out CountingQueryInvalidator invalidator,
        Func<DateTimeOffset> clock)
    {
        source = new InMemoryRateLimitSignalSource();
        invalidator = new CountingQueryInvalidator();
        return new RateLimitBannerViewModel(Localizer, source, invalidator, clock);
    }

    private static Func<int> CountChanges(RateLimitBannerViewModel vm)
    {
        var count = 0;
        vm.PropertyChanged += (_, _) => count++;
        return () => count;
    }

    private sealed class FixedLocalizer : ILocalizer
    {
        private readonly string _value;

        public FixedLocalizer(string value) => _value = value;

        public string GetString(string key, string fallback) => _value;
    }
}
