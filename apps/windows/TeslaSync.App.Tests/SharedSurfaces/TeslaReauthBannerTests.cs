using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the TeslaReauthBanner shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / action automation ids, the ARIA role/live contract, the amber warning token keys + warning /
/// dismiss glyphs, the tint alphas, the <c>/tesla-account</c> deep-link route, and the i18n keys + fallbacks the
/// projection references), the pure <see cref="TeslaReauthBannerProjection"/> (visibility gating across hidden /
/// visible, the localized copy, and the accessible-name contract), the best-effort
/// <see cref="TeslaAuthMutationBuffer"/> replay adapter (FIFO order, the 10-entry cap, the 5-minute TTL, swallowed
/// replay errors, and the snapshot-and-clear drain), the <see cref="TeslaAuthRecoveryHub"/> event + queue seam, the
/// <see cref="ITeslaReauthNavigator"/> bindings, the <see cref="TeslaReauthBannerViewModel"/> state holder (initial
/// visibility, show on expiry, hide + drain on recovery, dismiss, re-show after dismiss, reconnect dispatch, and
/// subscription cleanup), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/TeslaReauthBanner.tsx, web/src/lib/teslaAuthRecovery.ts). The web source listens to
/// document events and reads no API query, so the generic loading / empty / error / stale / offline data-lifecycle
/// states deliberately collapse to the hidden state; only the hidden / visible states the web actually has are
/// reproduced. The WinUI view itself (shared-surfaces/TeslaReauthBanner.cs) is exercised by the app build.
/// </summary>
public sealed class TeslaReauthBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TeslaReauthBanner", TeslaReauthBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        // web data-testid="tesla-reauth-banner" plus stable ids for the two controls.
        Assert.Equal("tesla-reauth-banner", TeslaReauthBannerRegistration.BannerAutomationId);
        Assert.Equal("tesla-reauth-banner-reconnect", TeslaReauthBannerRegistration.ReconnectAutomationId);
        Assert.Equal("tesla-reauth-banner-dismiss", TeslaReauthBannerRegistration.DismissAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_an_assertive_alert_region()
    {
        // web wrapper div: role="alert" aria-live="assertive".
        Assert.Equal("alert", TeslaReauthBannerRegistration.AlertRole);
        Assert.Equal("assertive", TeslaReauthBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Reconnect_route_is_the_tesla_account_deep_link()
    {
        // web handleReconnect: navigate('/tesla-account').
        Assert.Equal("/tesla-account", TeslaReauthBannerRegistration.TeslaAccountRoute);
    }

    [Fact]
    public void Warning_token_keys_glyphs_and_tints_match_the_web_amber_accent()
    {
        Assert.Equal("TsColorWarningColor", TeslaReauthBannerRegistration.WarningColorKey);
        Assert.Equal("TsColorWarningBrush", TeslaReauthBannerRegistration.WarningBrushKey);
        Assert.Equal("\uE7BA", TeslaReauthBannerRegistration.WarningGlyph);
        Assert.Equal("\uE711", TeslaReauthBannerRegistration.DismissGlyph);
        Assert.Equal(0.08, TeslaReauthBannerRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.30, TeslaReauthBannerRegistration.BannerBorderOpacity);
        Assert.Equal(0.15, TeslaReauthBannerRegistration.IconChipOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.tesla.reauth.title", TeslaReauthBannerRegistration.TitleKey);
        Assert.Equal("Tesla account disconnected", TeslaReauthBannerRegistration.TitleFallback);
        Assert.Equal("translation.tesla.reauth.body", TeslaReauthBannerRegistration.BodyKey);
        Assert.Equal("Reconnect to resume live data and commands.", TeslaReauthBannerRegistration.BodyFallback);
        Assert.Equal("translation.tesla.reauth.cta", TeslaReauthBannerRegistration.ReconnectKey);
        Assert.Equal("Reconnect", TeslaReauthBannerRegistration.ReconnectFallback);
        Assert.Equal("translation.common.dismiss", TeslaReauthBannerRegistration.DismissKey);
        Assert.Equal("Dismiss", TeslaReauthBannerRegistration.DismissFallback);
    }

    [Fact]
    public void Resolve_helpers_flow_through_the_localizer()
    {
        Assert.Equal("Tesla account disconnected", TeslaReauthBannerRegistration.ResolveTitle(Localizer));
        Assert.Equal(
            "Reconnect to resume live data and commands.",
            TeslaReauthBannerRegistration.ResolveBody(Localizer));
        Assert.Equal("Reconnect", TeslaReauthBannerRegistration.ResolveReconnectLabel(Localizer));
        Assert.Equal("Dismiss", TeslaReauthBannerRegistration.ResolveDismissLabel(Localizer));
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_when_not_visible()
    {
        // web: if (!visible) return null.
        var projection = TeslaReauthBannerProjection.Project(visible: false, Localizer);

        Assert.False(projection.IsVisible);
        // The copy is still resolved so it is ready the instant the banner shows.
        Assert.Equal("Tesla account disconnected", projection.Title);
        Assert.Equal("Reconnect to resume live data and commands.", projection.Body);
        Assert.Equal("Reconnect", projection.ReconnectLabel);
        Assert.Equal("Dismiss", projection.DismissLabel);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_shown_with_title_body_and_actions_when_visible()
    {
        var projection = TeslaReauthBannerProjection.Project(visible: true, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("Tesla account disconnected", projection.Title);
        Assert.Equal("Reconnect to resume live data and commands.", projection.Body);
        Assert.Equal("Reconnect", projection.ReconnectLabel);
        Assert.Equal("Dismiss", projection.DismissLabel);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_title_and_body()
    {
        var projection = TeslaReauthBannerProjection.Project(visible: true, Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
        Assert.Equal(
            "Tesla account disconnected. Reconnect to resume live data and commands.",
            projection.AccessibleName);
    }

    // ── mutation queue adapter ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Queue_constants_match_the_web_module()
    {
        // web TESLA_AUTH_QUEUE_MAX = 10, TESLA_AUTH_QUEUE_TTL_MS = 5 minutes.
        Assert.Equal(10, TeslaAuthMutationBuffer.MaxEntries);
        Assert.Equal(TimeSpan.FromMinutes(5), TeslaAuthMutationBuffer.EntryTtl);
    }

    [Fact]
    public async Task Queue_replays_entries_in_fifo_order()
    {
        var queue = new TeslaAuthMutationBuffer();
        var order = new List<int>();
        for (var i = 0; i < 3; i++)
        {
            var captured = i;
            queue.Add(_ =>
            {
                order.Add(captured);
                return Task.CompletedTask;
            });
        }

        await queue.DrainAsync();

        Assert.Equal(new[] { 0, 1, 2 }, order);
        Assert.Equal(0, queue.Count);
    }

    [Fact]
    public void Queue_drops_entries_once_the_cap_is_reached()
    {
        var queue = new TeslaAuthMutationBuffer();
        for (var i = 0; i < TeslaAuthMutationBuffer.MaxEntries + 5; i++)
        {
            queue.Add(_ => Task.CompletedTask);
        }

        Assert.Equal(TeslaAuthMutationBuffer.MaxEntries, queue.Count);
    }

    [Fact]
    public async Task Queue_drops_entries_older_than_the_ttl_when_draining()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var queue = new TeslaAuthMutationBuffer(() => now);
        var replayed = 0;

        queue.Add(_ =>
        {
            replayed++;
            return Task.CompletedTask;
        });

        // Advance past the 5-minute TTL before draining: the entry is dropped silently.
        now = now.AddMinutes(6);
        await queue.DrainAsync();

        Assert.Equal(0, replayed);
        Assert.Equal(0, queue.Count);
    }

    [Fact]
    public async Task Queue_replays_only_the_entries_still_within_the_ttl()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var queue = new TeslaAuthMutationBuffer(() => now);
        var replayed = new List<string>();

        queue.Add(_ =>
        {
            replayed.Add("stale");
            return Task.CompletedTask;
        });

        now = now.AddMinutes(6);
        queue.Add(_ =>
        {
            replayed.Add("fresh");
            return Task.CompletedTask;
        });

        await queue.DrainAsync();

        Assert.Equal(new[] { "fresh" }, replayed);
    }

    [Fact]
    public async Task Queue_swallows_replay_failures_and_continues()
    {
        var queue = new TeslaAuthMutationBuffer();
        var succeeded = false;

        queue.Add(_ => Task.FromException(new InvalidOperationException("replay boom")));
        queue.Add(_ =>
        {
            succeeded = true;
            return Task.CompletedTask;
        });

        // The drain itself never throws; the failed replay surfaces through its own error path.
        await queue.DrainAsync();

        Assert.True(succeeded);
        Assert.Equal(0, queue.Count);
    }

    [Fact]
    public async Task Queue_drain_is_a_noop_when_empty()
    {
        var queue = new TeslaAuthMutationBuffer();

        await queue.DrainAsync();
        await queue.DrainAsync();

        Assert.Equal(0, queue.Count);
    }

    [Fact]
    public async Task Queue_drain_clears_the_queue_up_front()
    {
        var queue = new TeslaAuthMutationBuffer();
        var gate = new TaskCompletionSource();
        queue.Add(_ => gate.Task);

        var drain = queue.DrainAsync();

        // The queue is snapshotted and cleared before the first replay awaits (web QUEUE.splice up front).
        Assert.Equal(0, queue.Count);

        gate.SetResult();
        await drain;
    }

    [Fact]
    public void Queue_clear_discards_pending_entries_without_replaying()
    {
        var queue = new TeslaAuthMutationBuffer();
        var replayed = false;
        queue.Add(_ =>
        {
            replayed = true;
            return Task.CompletedTask;
        });

        queue.Clear();

        Assert.Equal(0, queue.Count);
        Assert.False(replayed);
    }

    // ── recovery hub ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Hub_starts_not_expired()
    {
        var hub = new TeslaAuthRecoveryHub();
        Assert.False(hub.IsExpired);
    }

    [Fact]
    public void Hub_notify_expired_flags_state_and_raises_the_event()
    {
        var hub = new TeslaAuthRecoveryHub();
        var raised = 0;
        hub.Expired += (_, _) => raised++;

        hub.NotifyExpired();

        Assert.True(hub.IsExpired);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Hub_notify_recovered_clears_state_and_raises_the_event()
    {
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var raised = 0;
        hub.Recovered += (_, _) => raised++;

        hub.NotifyRecovered();

        Assert.False(hub.IsExpired);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Hub_raises_expired_on_every_signal_so_a_repeated_401_re_surfaces()
    {
        // web: every teslasync:tesla-auth-expired event calls setVisible(true).
        var hub = new TeslaAuthRecoveryHub();
        var raised = 0;
        hub.Expired += (_, _) => raised++;

        hub.NotifyExpired();
        hub.NotifyExpired();

        Assert.Equal(2, raised);
    }

    [Fact]
    public async Task Hub_drain_replays_the_queued_mutations()
    {
        var hub = new TeslaAuthRecoveryHub();
        var replayed = 0;
        hub.QueueMutation(_ =>
        {
            replayed++;
            return Task.CompletedTask;
        });

        await hub.DrainQueuedMutationsAsync();

        Assert.Equal(1, replayed);
        Assert.Equal(0, hub.Buffer.Count);
    }

    // ── navigator ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Recording_navigator_counts_reconnect_requests()
    {
        var navigator = new RecordingTeslaReauthNavigator();

        navigator.NavigateToTeslaAccount();
        navigator.NavigateToTeslaAccount();

        Assert.Equal(2, navigator.NavigateCount);
    }

    [Fact]
    public void Delegate_navigator_forwards_to_the_shell_delegate()
    {
        var calls = 0;
        var navigator = new DelegateTeslaReauthNavigator(() => calls++);

        navigator.NavigateToTeslaAccount();

        Assert.Equal(1, calls);
    }

    [Fact]
    public void Delegate_navigator_requires_a_delegate() =>
        Assert.Throws<ArgumentNullException>(() => new DelegateTeslaReauthNavigator(null!));

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_hidden_while_the_token_is_valid()
    {
        var hub = new TeslaAuthRecoveryHub();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_starts_visible_when_the_token_already_expired()
    {
        // A banner mounted after an expiry already happened still surfaces (IsExpired snapshot).
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);

        Assert.True(vm.IsVisible);
        Assert.Equal("Tesla account disconnected", vm.Title);
        Assert.Equal("Reconnect to resume live data and commands.", vm.Body);
    }

    [Fact]
    public void View_model_shows_the_banner_on_expiry()
    {
        // web onExpired: setVisible(true).
        var hub = new TeslaAuthRecoveryHub();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        hub.NotifyExpired();

        Assert.True(vm.IsVisible);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_dismiss_hides_the_banner_without_resolving_the_expiry()
    {
        // web handleDismiss: setVisible(false) — the token is still expired.
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        Assert.True(vm.IsVisible);

        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.True(hub.IsExpired);
    }

    [Fact]
    public void View_model_re_shows_the_banner_when_a_dismissed_expiry_signals_again()
    {
        // web: a repeated teslasync:tesla-auth-expired re-shows a dismissed banner.
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        vm.Dismiss();
        Assert.False(vm.IsVisible);

        hub.NotifyExpired();

        Assert.True(vm.IsVisible);
    }

    [Fact]
    public async Task View_model_recovery_hides_the_banner_and_drains_queued_mutations()
    {
        // web onRecovered: setVisible(false) + void drainQueuedTeslaMutations().
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        Assert.True(vm.IsVisible);

        var replayed = 0;
        hub.QueueMutation(_ =>
        {
            replayed++;
            return Task.CompletedTask;
        });

        hub.NotifyRecovered();
        if (vm.PendingDrain is { } drain)
        {
            await drain;
        }

        Assert.False(vm.IsVisible);
        Assert.Equal(1, replayed);
        Assert.Equal(0, hub.Buffer.Count);
    }

    [Fact]
    public void View_model_reconnect_dispatches_to_the_navigator()
    {
        // web handleReconnect: navigate('/tesla-account').
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);

        vm.Reconnect();

        Assert.Equal(1, navigator.NavigateCount);
    }

    [Fact]
    public void View_model_does_not_reproject_when_an_expiry_repeats_while_already_visible()
    {
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        var navigator = new RecordingTeslaReauthNavigator();
        using var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        Assert.True(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        hub.NotifyExpired();

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var hub = new TeslaAuthRecoveryHub();
        var navigator = new RecordingTeslaReauthNavigator();
        var vm = new TeslaReauthBannerViewModel(Localizer, hub, navigator);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        hub.NotifyExpired();
        hub.NotifyRecovered();

        Assert.Equal(0, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TeslaReauthBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=TeslaReauthBanner", "view.opened slug=TeslaReauthBanner" },
            lines);
    }
}
