using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the OfflineBanner shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner automation id, the ARIA role/live contract, the warning token keys + WifiOff glyph, the tint
/// alphas, and the i18n keys + fallbacks the projection references), the <see cref="OnlineStatusSnapshot"/>
/// states, the pure <see cref="OfflineBannerProjection"/> (visibility gating across online / offline, the
/// localized title / body, and the accessible-name contract), the <see cref="OfflineBannerViewModel"/> state
/// holder (initial projection, reprojection on connectivity change, subscription cleanup), the static / network
/// sources, and the PII-safe diagnostics. Mirrors the web spec (web/src/components/feedback/OfflineBanner.tsx).
/// The web source is connectivity-only — it has exactly two render branches (<c>if (online) return null</c> vs.
/// the offline banner) and performs no data fetch, so there is deliberately no loading / empty / error / stale
/// branch to reproduce. The WinUI view itself (shared-surfaces/OfflineBanner/OfflineBanner.cs) is exercised by
/// the app build.
/// </summary>
public sealed class OfflineBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("OfflineBanner", OfflineBannerRegistration.Slug);

    [Fact]
    public void Automation_id_is_stable() =>
        Assert.Equal("offline-banner", OfflineBannerRegistration.BannerAutomationId);

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web AlertBanner: role="status" aria-live="polite".
        Assert.Equal("status", OfflineBannerRegistration.StatusRole);
        Assert.Equal("polite", OfflineBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Warning_token_keys_glyph_and_tints_match_the_shared_callout_warning()
    {
        Assert.Equal("TsColorWarningBrush", OfflineBannerRegistration.WarningBrushKey);
        Assert.Equal("TsColorWarningColor", OfflineBannerRegistration.WarningColorKey);
        Assert.Equal("\uEB5E", OfflineBannerRegistration.WifiOffGlyph);
        Assert.Equal(0.08, OfflineBannerRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.20, OfflineBannerRegistration.BannerBorderOpacity);
        Assert.Equal(0.80, OfflineBannerRegistration.BodyForegroundOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.pwa.offline.title", OfflineBannerRegistration.TitleKey);
        Assert.Equal("You're offline", OfflineBannerRegistration.TitleFallback);
        Assert.Equal("translation.pwa.offline.banner", OfflineBannerRegistration.BodyKey);
        Assert.Equal(
            "Showing cached data. New requests will retry when you reconnect.",
            OfflineBannerRegistration.BodyFallback);
    }

    [Fact]
    public void Resolve_helpers_flow_through_the_localizer()
    {
        Assert.Equal("You're offline", OfflineBannerRegistration.ResolveTitle(Localizer));
        Assert.Equal(
            "Showing cached data. New requests will retry when you reconnect.",
            OfflineBannerRegistration.ResolveBody(Localizer));
    }

    // ── snapshot ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Online_snapshot_is_online_and_not_the_render_gate()
    {
        Assert.True(OnlineStatusSnapshot.Online.IsOnline);
        Assert.False(OnlineStatusSnapshot.Online.IsOffline);
    }

    [Fact]
    public void Offline_snapshot_is_offline_and_is_the_render_gate()
    {
        Assert.False(OnlineStatusSnapshot.Offline.IsOnline);
        Assert.True(OnlineStatusSnapshot.Offline.IsOffline);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_while_online()
    {
        // web: if (online) return null.
        var projection = OfflineBannerProjection.Project(OnlineStatusSnapshot.Online, Localizer);

        Assert.False(projection.IsVisible);
        // The strings are still resolved so they are ready the instant the device drops offline.
        Assert.Equal("You're offline", projection.Title);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_shown_with_title_and_body_while_offline()
    {
        var projection = OfflineBannerProjection.Project(OnlineStatusSnapshot.Offline, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("You're offline", projection.Title);
        Assert.Equal("Showing cached data. New requests will retry when you reconnect.", projection.Body);
        Assert.Equal("polite", projection.LiveSetting);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_title_and_body()
    {
        var projection = OfflineBannerProjection.Project(OnlineStatusSnapshot.Offline, Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
        Assert.Equal(
            "You're offline. Showing cached data. New requests will retry when you reconnect.",
            projection.AccessibleName);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_hidden_while_online()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Online);
        using var vm = new OfflineBannerViewModel(Localizer, source);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_starts_shown_while_offline()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Offline);
        using var vm = new OfflineBannerViewModel(Localizer, source);

        Assert.True(vm.IsVisible);
        Assert.Equal("You're offline", vm.Title);
        Assert.Equal("Showing cached data. New requests will retry when you reconnect.", vm.Body);
    }

    [Fact]
    public void View_model_reprojects_when_the_device_drops_offline()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Online);
        using var vm = new OfflineBannerViewModel(Localizer, source);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(OnlineStatusSnapshot.Offline);

        Assert.True(vm.IsVisible);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_reprojects_when_the_device_comes_back_online()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Offline);
        using var vm = new OfflineBannerViewModel(Localizer, source);
        Assert.True(vm.IsVisible);

        source.Set(OnlineStatusSnapshot.Online);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_does_not_reproject_when_the_status_is_unchanged()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Online);
        using var vm = new OfflineBannerViewModel(Localizer, source);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(OnlineStatusSnapshot.Online);

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Online);
        var vm = new OfflineBannerViewModel(Localizer, source);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(OnlineStatusSnapshot.Offline);

        Assert.Equal(0, raised);
    }

    // ── sources ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_raises_changed_on_set()
    {
        var source = new StaticOnlineStatusSource(OnlineStatusSnapshot.Online);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(OnlineStatusSnapshot.Offline);

        Assert.True(source.Current.IsOffline);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Network_source_maps_availability_to_the_snapshot()
    {
        var availability = new FakeNetworkAvailability(online: true);
        using var source = new NetworkOnlineStatusSource(availability);
        Assert.True(source.Current.IsOnline);

        availability.SetOnline(false);
        Assert.True(source.Current.IsOffline);
    }

    [Fact]
    public void Network_source_re_raises_availability_changes()
    {
        var availability = new FakeNetworkAvailability(online: true);
        using var source = new NetworkOnlineStatusSource(availability);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        availability.SetOnline(false);

        Assert.Equal(1, raised);
    }

    [Fact]
    public void Network_source_stops_re_raising_after_dispose()
    {
        var availability = new FakeNetworkAvailability(online: true);
        var source = new NetworkOnlineStatusSource(availability);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Dispose();
        availability.SetOnline(false);

        Assert.Equal(0, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OfflineBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=OfflineBanner", "view.opened slug=OfflineBanner" },
            lines);
    }

    /// <summary>A controllable <see cref="INetworkAvailability"/> for the network-source tests.</summary>
    private sealed class FakeNetworkAvailability : INetworkAvailability
    {
        private bool _online;

        public FakeNetworkAvailability(bool online) => _online = online;

        public event Action<bool>? AvailabilityChanged;

        public bool IsOnline => _online;

        public void SetOnline(bool online)
        {
            _online = online;
            AvailabilityChanged?.Invoke(online);
        }
    }
}
