using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ServiceStatus shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / dot automation ids, the ARIA role/live contract, the per-level token brush keys, the i18n
/// keys the projections reference and the WifiOff glyph), the health classification + display helpers, the
/// <see cref="ServiceStatusHealthSnapshot.FromRepositoryResult"/> adapter (every cache-then-network state, incl.
/// the offline-cached case), the pure <see cref="ServiceStatusBannerProjection"/> /
/// <see cref="ServiceStatusHealthDotProjection"/> (visibility gating, accent brush, localized message / tooltip,
/// and the accessible-name contract), the <see cref="ServiceStatusBannerViewModel"/> /
/// <see cref="ServiceStatusHealthDotViewModel"/> state holders (initial projection, reprojection, refresh
/// forwarding, subscription cleanup), the static / network / repository seams, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/data-display/ServiceStatus.tsx). The WinUI views themselves
/// (shared-surfaces/ServiceStatus.cs) are exercised by the app build.
/// </summary>
public sealed class ServiceStatusTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ServiceStatus", ServiceStatusRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("service-status-banner", ServiceStatusRegistration.BannerAutomationId);
        Assert.Equal("system-health-dot", ServiceStatusRegistration.HealthDotAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        Assert.Equal("status", ServiceStatusRegistration.StatusRole);
        Assert.Equal("polite", ServiceStatusRegistration.LiveSetting);
    }

    [Theory]
    [InlineData(ServiceStatusHealthLevel.Healthy, "TsColorSuccessBrush")]
    [InlineData(ServiceStatusHealthLevel.Degraded, "TsColorWarningBrush")]
    [InlineData(ServiceStatusHealthLevel.Unhealthy, "TsColorDangerBrush")]
    [InlineData(ServiceStatusHealthLevel.Unknown, "TsColorDangerBrush")]
    public void HealthBrushKey_maps_each_level_to_its_token_brush(ServiceStatusHealthLevel level, string expected) =>
        Assert.Equal(expected, ServiceStatusRegistration.HealthBrushKey(level));

    [Fact]
    public void WifiOff_glyph_matches_the_shared_fluent_stand_in() =>
        Assert.Equal("\uEB5E", ServiceStatusRegistration.WifiOffGlyph);

    [Fact]
    public void Banner_tint_recipe_matches_the_web_danger_alphas()
    {
        Assert.Equal("TsColorDangerColor", ServiceStatusRegistration.DangerColorKey);
        Assert.Equal("TsColorDangerBrush", ServiceStatusRegistration.DangerBrushKey);
        Assert.Equal(0.15, ServiceStatusRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.20, ServiceStatusRegistration.BannerBorderOpacity);
        Assert.Equal(0.50, ServiceStatusRegistration.DotGlowOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // The web ServiceStatus.tsx has no t() calls; these keys carry the verbatim English literals it renders.
        Assert.Equal("translation.serviceStatus.offlineBanner", ServiceStatusRegistration.OfflineBannerKey);
        Assert.Equal(
            "You are offline. Data may be stale. Reconnecting automatically...",
            ServiceStatusRegistration.OfflineBannerFallback);
        Assert.Equal("translation.serviceStatus.systemTooltip", ServiceStatusRegistration.SystemTooltipKey);
        Assert.Equal("System: {0}", ServiceStatusRegistration.SystemTooltipFallback);
        Assert.Equal("translation.serviceStatus.health.healthy", ServiceStatusRegistration.HealthyLabelKey);
        Assert.Equal("healthy", ServiceStatusRegistration.HealthyLabelFallback);
        Assert.Equal("translation.serviceStatus.health.degraded", ServiceStatusRegistration.DegradedLabelKey);
        Assert.Equal("degraded", ServiceStatusRegistration.DegradedLabelFallback);
        Assert.Equal("translation.serviceStatus.health.unhealthy", ServiceStatusRegistration.UnhealthyLabelKey);
        Assert.Equal("unhealthy", ServiceStatusRegistration.UnhealthyLabelFallback);
    }

    // ── health classification + display ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, ServiceStatusHealthLevel.Unknown)]
    [InlineData("healthy", ServiceStatusHealthLevel.Healthy)]
    [InlineData("degraded", ServiceStatusHealthLevel.Degraded)]
    [InlineData("unhealthy", ServiceStatusHealthLevel.Unhealthy)]
    [InlineData("down", ServiceStatusHealthLevel.Unhealthy)]
    public void ClassifyHealth_matches_the_web_overall_branch(string? overall, ServiceStatusHealthLevel expected) =>
        Assert.Equal(expected, ServiceStatusRegistration.ClassifyHealth(overall));

    [Fact]
    public void HealthDisplay_localizes_canonical_tokens_and_passes_through_unknown_values()
    {
        Assert.Equal("healthy", ServiceStatusRegistration.HealthDisplay("healthy", Localizer));
        Assert.Equal("degraded", ServiceStatusRegistration.HealthDisplay("degraded", Localizer));
        Assert.Equal("unhealthy", ServiceStatusRegistration.HealthDisplay("unhealthy", Localizer));
        // web shows the raw data.overall verbatim — a non-canonical backend value is never swallowed.
        Assert.Equal("maintenance", ServiceStatusRegistration.HealthDisplay("maintenance", Localizer));
        Assert.Equal(string.Empty, ServiceStatusRegistration.HealthDisplay(null, Localizer));
    }

    // ── health snapshot adapter (RepositoryResult → snapshot): the web useQuery data exposure ───────────────

    [Fact]
    public void FromResult_loading_has_no_data()
    {
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(RepositoryResult<ServiceStatusReadModel>.Loading());

        Assert.False(snap.HasData);
        Assert.Null(snap.Overall);
        Assert.Equal(ServiceStatusHealthLevel.Unknown, snap.Level);
    }

    [Fact]
    public void FromResult_loaded_carries_the_overall_value()
    {
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(
            RepositoryResult<ServiceStatusReadModel>.Loaded(new ServiceStatusReadModel("healthy"), Now));

        Assert.True(snap.HasData);
        Assert.Equal("healthy", snap.Overall);
        Assert.Equal(ServiceStatusHealthLevel.Healthy, snap.Level);
    }

    [Fact]
    public void FromResult_cached_carries_the_overall_value()
    {
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(
            RepositoryResult<ServiceStatusReadModel>.Cached(new ServiceStatusReadModel("degraded"), Now, stale: true));

        Assert.Equal("degraded", snap.Overall);
        Assert.Equal(ServiceStatusHealthLevel.Degraded, snap.Level);
    }

    [Fact]
    public void FromResult_refreshing_keeps_the_cached_value()
    {
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(
            RepositoryResult<ServiceStatusReadModel>.Refreshing(new ServiceStatusReadModel("healthy"), Now, stale: false));

        Assert.Equal("healthy", snap.Overall);
    }

    [Fact]
    public void FromResult_empty_has_no_data()
    {
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(RepositoryResult<ServiceStatusReadModel>.Empty(Now));

        Assert.False(snap.HasData);
    }

    [Fact]
    public void FromResult_failure_has_no_data()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(RepositoryResult<ServiceStatusReadModel>.Failure(error));

        Assert.False(snap.HasData);
        Assert.Equal(ServiceStatusHealthLevel.Unknown, snap.Level);
    }

    [Fact]
    public void FromResult_offline_cached_keeps_the_last_known_value()
    {
        // web: a TanStack query retains its last successful `data` across a failed refetch — the dot keeps showing
        // the last known health rather than disappearing.
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var snap = ServiceStatusHealthSnapshot.FromRepositoryResult(
            RepositoryResult<ServiceStatusReadModel>.OfflineCached(new ServiceStatusReadModel("unhealthy"), Now, error));

        Assert.True(snap.HasData);
        Assert.Equal("unhealthy", snap.Overall);
        Assert.Equal(ServiceStatusHealthLevel.Unhealthy, snap.Level);
    }

    [Fact]
    public void FromResult_throws_when_the_result_is_null() =>
        Assert.Throws<ArgumentNullException>(() => ServiceStatusHealthSnapshot.FromRepositoryResult(null!));

    // ── banner projection (per-state) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Banner_is_collapsed_when_online()
    {
        var projection = ServiceStatusBannerProjection.Project(ServiceStatusConnectionSnapshot.Online, Localizer);

        Assert.False(projection.IsVisible);
        // The message is still resolved so it is ready to announce the moment the device drops offline.
        Assert.Equal("You are offline. Data may be stale. Reconnecting automatically...", projection.Message);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Banner_is_shown_with_the_offline_message_when_offline()
    {
        var projection = ServiceStatusBannerProjection.Project(ServiceStatusConnectionSnapshot.Offline, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("You are offline. Data may be stale. Reconnecting automatically...", projection.Message);
    }

    [Fact]
    public void Banner_accessible_name_is_the_offline_message()
    {
        // a11y: a screen reader announces the offline message when the banner drops in.
        var projection = ServiceStatusBannerProjection.Project(ServiceStatusConnectionSnapshot.Offline, Localizer);

        Assert.Equal(projection.Message, projection.AccessibleName);
    }

    [Fact]
    public void ConnectionSnapshot_is_offline_flag_matches_status()
    {
        Assert.True(ServiceStatusConnectionSnapshot.Offline.IsOffline);
        Assert.False(ServiceStatusConnectionSnapshot.Online.IsOffline);
    }

    // ── dot projection (per-state) ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Dot_is_hidden_until_data_resolves()
    {
        var projection = ServiceStatusHealthDotProjection.Project(ServiceStatusHealthSnapshot.None, Localizer);

        Assert.False(projection.IsVisible);
        Assert.Equal(ServiceStatusHealthLevel.Unknown, projection.Level);
    }

    [Theory]
    [InlineData("healthy", ServiceStatusHealthLevel.Healthy, "TsColorSuccessBrush", "System: healthy")]
    [InlineData("degraded", ServiceStatusHealthLevel.Degraded, "TsColorWarningBrush", "System: degraded")]
    [InlineData("unhealthy", ServiceStatusHealthLevel.Unhealthy, "TsColorDangerBrush", "System: unhealthy")]
    public void Dot_renders_each_health_level_with_its_brush_and_tooltip(
        string overall,
        ServiceStatusHealthLevel level,
        string brushKey,
        string tooltip)
    {
        var projection = ServiceStatusHealthDotProjection.Project(new ServiceStatusHealthSnapshot(overall), Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal(level, projection.Level);
        Assert.Equal(brushKey, projection.AccentBrushKey);
        Assert.Equal(tooltip, projection.Tooltip);
    }

    [Fact]
    public void Dot_renders_a_non_canonical_status_verbatim_in_the_tooltip()
    {
        var projection = ServiceStatusHealthDotProjection.Project(new ServiceStatusHealthSnapshot("maintenance"), Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal(ServiceStatusHealthLevel.Unhealthy, projection.Level);
        Assert.Equal("System: maintenance", projection.Tooltip);
    }

    [Fact]
    public void Dot_accessible_name_equals_its_tooltip()
    {
        // a11y: the dot's Narrator name is the same "System: {status}" string the web exposes via title.
        var projection = ServiceStatusHealthDotProjection.Project(new ServiceStatusHealthSnapshot("healthy"), Localizer);

        Assert.Equal(projection.Tooltip, projection.AccessibleName);
    }

    // ── banner view-model ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Banner_view_model_reprojects_when_connectivity_changes()
    {
        var source = new StaticServiceStatusConnectionSource(ServiceStatusConnectionSnapshot.Online);
        using var vm = new ServiceStatusBannerViewModel(Localizer, source);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(ServiceStatusConnectionSnapshot.Offline);

        Assert.True(vm.IsVisible);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Banner_view_model_unsubscribes_on_dispose()
    {
        var source = new StaticServiceStatusConnectionSource(ServiceStatusConnectionSnapshot.Online);
        var vm = new ServiceStatusBannerViewModel(Localizer, source);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(ServiceStatusConnectionSnapshot.Offline);

        Assert.Equal(0, raised);
    }

    // ── dot view-model ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Dot_view_model_reprojects_when_health_changes()
    {
        var source = new StaticServiceStatusHealthSource(ServiceStatusHealthSnapshot.None);
        using var vm = new ServiceStatusHealthDotViewModel(Localizer, source);
        Assert.False(vm.IsVisible);

        source.Set(new ServiceStatusHealthSnapshot("degraded"));

        Assert.True(vm.IsVisible);
        Assert.Equal(ServiceStatusHealthLevel.Degraded, vm.Level);
        Assert.Equal("TsColorWarningBrush", vm.AccentBrushKey);
        Assert.Equal("System: degraded", vm.Tooltip);
    }

    [Fact]
    public void Dot_view_model_forwards_refresh_to_the_seam()
    {
        var source = new StaticServiceStatusHealthSource(new ServiceStatusHealthSnapshot("healthy"));
        using var vm = new ServiceStatusHealthDotViewModel(Localizer, source);

        vm.RequestRefresh();
        vm.RequestRefresh();

        Assert.Equal(2, source.RefreshCount);
    }

    // ── sources ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Network_connection_source_tracks_availability()
    {
        var availability = new FakeNetworkAvailability(online: true);
        using var source = new NetworkServiceStatusConnectionSource(availability);
        Assert.False(source.Current.IsOffline);

        var raised = 0;
        source.Changed += (_, _) => raised++;

        availability.Set(false);

        Assert.True(source.Current.IsOffline);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Network_connection_source_detaches_on_dispose()
    {
        var availability = new FakeNetworkAvailability(online: true);
        var source = new NetworkServiceStatusConnectionSource(availability);
        source.Dispose();

        var raised = 0;
        source.Changed += (_, _) => raised++;
        availability.Set(false);

        Assert.Equal(0, raised);
    }

    [Fact]
    public async Task Repository_health_source_projects_the_stream()
    {
        var source = new RepositoryServiceStatusHealthSource(Stream, autoStart: false);
        var settled = new TaskCompletionSource();
        source.Changed += (_, _) =>
        {
            if (source.Current.Overall == "healthy")
            {
                settled.TrySetResult();
            }
        };

        source.Refresh();
        await settled.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal("healthy", source.Current.Overall);
        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<ServiceStatusReadModel>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            yield return RepositoryResult<ServiceStatusReadModel>.Loading();
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<ServiceStatusReadModel>.Loaded(new ServiceStatusReadModel("healthy"), Now);
        }
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ServiceStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=ServiceStatus", "view.opened slug=ServiceStatus" }, lines);
    }

    private sealed class FakeNetworkAvailability : INetworkAvailability
    {
        private bool _online;

        public FakeNetworkAvailability(bool online) => _online = online;

        public event Action<bool>? AvailabilityChanged;

        public bool IsOnline => _online;

        public void Set(bool online)
        {
            _online = online;
            AvailabilityChanged?.Invoke(online);
        }
    }
}
