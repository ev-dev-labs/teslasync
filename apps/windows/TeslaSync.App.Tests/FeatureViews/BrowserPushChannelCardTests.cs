using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using DeviceList = System.Collections.Generic.IReadOnlyList<TeslaSync.App.FeatureViews.BrowserPushDevice>;
using DeviceResult = TeslaSync.App.Core.Data.State.RepositoryResult<
    System.Collections.Generic.IReadOnlyList<TeslaSync.App.FeatureViews.BrowserPushDevice>>;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the BrowserPushChannelCard feature-view's UI-thread-free logic — the registered
/// device JSON adapter, the per-state / per-branch projection (status badge, the four unsupported reasons, the
/// enable/disable affordance and the per-device rows), the i18n key catalog, the accessibility names, the
/// cache-then-network state-holder transitions (loading / loaded / empty / stale / offline / error), the
/// enable / disable / remove actions through the capability gateway, and the PII-safe diagnostics. Mirrors the
/// web spec (web/src/features/notifications/components/BrowserPushChannelCard.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class BrowserPushChannelCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // ---- Device JSON adapter (web PushSubscriptionRow[]) ------------------------------------------------

    [Fact]
    public void ParseList_reads_every_field_from_the_json_array()
    {
        var devices = BrowserPushDevice.ParseList(Json(
            "[{\"id\":7,\"endpoint\":\"https://push/e7\",\"user_agent\":\"Firefox\"," +
            "\"last_used_at\":\"2025-12-31T23:55:00Z\"}]"));

        var device = Assert.Single(devices);
        Assert.Equal(7, device.Id);
        Assert.Equal("https://push/e7", device.Endpoint);
        Assert.Equal("Firefox", device.UserAgent);
        Assert.Equal(new DateTimeOffset(2025, 12, 31, 23, 55, 0, TimeSpan.Zero), device.LastUsedAt);
    }

    [Fact]
    public void ParseList_tolerates_missing_user_agent_and_last_used()
    {
        var devices = BrowserPushDevice.ParseList(Json("[{\"id\":1,\"endpoint\":\"https://push/e1\"}]"));

        var device = Assert.Single(devices);
        Assert.Null(device.UserAgent);
        Assert.Null(device.LastUsedAt);
    }

    [Fact]
    public void ParseList_skips_rows_without_an_endpoint()
    {
        var devices = BrowserPushDevice.ParseList(Json(
            "[{\"id\":1,\"user_agent\":\"NoEndpoint\"},{\"id\":2,\"endpoint\":\"https://push/e2\"}]"));

        Assert.Equal("https://push/e2", Assert.Single(devices).Endpoint);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("\"oops\"")]
    [InlineData("[]")]
    public void ParseList_non_arrays_and_empty_arrays_yield_no_devices(string raw) =>
        Assert.Empty(BrowserPushDevice.ParseList(Json(raw)));

    // ---- Projection: status badge + capability branches (web disabledReason ladder) ---------------------

    [Fact]
    public void Projection_supported_and_not_subscribed_shows_enable_and_neutral_status()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Default, isSubscribed: false);

        Assert.False(display.IsUnsupported);
        Assert.Equal("Not subscribed", display.StatusText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Neutral, display.StatusStatus);
        Assert.True(display.ShowEnable);
        Assert.False(display.ShowDisable);
        Assert.Equal("Enable on this device", display.EnableText);
        Assert.Equal(string.Empty, display.DisabledReason);
    }

    [Fact]
    public void Projection_supported_and_subscribed_shows_disable_and_success_status()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Granted, isSubscribed: true);

        Assert.False(display.IsUnsupported);
        Assert.Equal("Active on this device", display.StatusText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Success, display.StatusStatus);
        Assert.True(display.ShowDisable);
        Assert.False(display.ShowEnable);
        Assert.Equal("Disable on this device", display.DisableText);
    }

    [Fact]
    public void Projection_notifications_unsupported_shows_warning_and_notification_reason()
    {
        var display = Project(BrowserPushCapability.NotificationsUnsupported, BrowserPushPermissionStatus.Default, false);

        Assert.True(display.IsUnsupported);
        Assert.Equal("Unavailable", display.StatusText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Warning, display.StatusStatus);
        Assert.Equal("This browser doesn't support notifications.", display.DisabledReason);
        Assert.False(display.ShowEnable);
        Assert.False(display.ShowDisable);
    }

    [Fact]
    public void Projection_server_not_configured_shows_server_disabled_reason()
    {
        var display = Project(BrowserPushCapability.ServerNotConfigured, BrowserPushPermissionStatus.Default, false);

        Assert.True(display.IsUnsupported);
        Assert.Equal(
            "Browser push is not configured on this server. Ask your administrator to set the VAPID keys.",
            display.DisabledReason);
    }

    [Fact]
    public void Projection_push_api_unsupported_shows_push_api_reason()
    {
        var display = Project(BrowserPushCapability.PushApiUnsupported, BrowserPushPermissionStatus.Default, false);

        Assert.True(display.IsUnsupported);
        Assert.Equal("This browser doesn't support the Push API.", display.DisabledReason);
    }

    [Fact]
    public void Projection_permission_denied_while_supported_shows_blocked_reason()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Denied, false);

        Assert.True(display.IsUnsupported);
        Assert.Equal(
            "Notifications are blocked for this site. Re-enable them in your browser settings to use browser push.",
            display.DisabledReason);
    }

    [Fact]
    public void Projection_capability_precedes_permission_denied()
    {
        // Web: the capability reasons are evaluated before the permission-denied reason.
        var display = Project(BrowserPushCapability.NotificationsUnsupported, BrowserPushPermissionStatus.Denied, false);

        Assert.Equal("This browser doesn't support notifications.", display.DisabledReason);
    }

    [Fact]
    public void Projection_carries_the_platform_note_and_title_and_subtitle()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Default, false);

        Assert.Equal("Browser push", display.Title);
        Assert.Equal("Get OS-level notifications even when TeslaSync is closed.", display.Subtitle);
        Assert.Equal(
            "iOS Safari requires version 16.4 or later, and you must add TeslaSync to your Home Screen.",
            display.PlatformNote);
        Assert.Equal(BrowserPushChannelProjection.BellGlyph, display.IconGlyph);
    }

    // ---- Projection: device rows -----------------------------------------------------------------------

    [Fact]
    public void Projection_marks_the_current_device_and_formats_last_used()
    {
        var devices = Devices(new BrowserPushDevice(1, "https://push/e1", "Edge", Now.AddMinutes(-5)));
        var display = BrowserPushChannelProjection.Project(
            BrowserPushCapability.Supported,
            BrowserPushPermissionStatus.Granted,
            isSubscribed: true,
            currentEndpoint: "https://push/e1",
            devices,
            Localizer,
            Now);

        var row = Assert.Single(display.Devices);
        Assert.True(row.IsThisDevice);
        Assert.Equal("Edge", row.UserAgentText);
        Assert.Equal("(this device)", row.ThisDeviceMarker);
        Assert.Equal("Last used 5m ago", row.LastUsedText);
        Assert.Equal("Remove this device", row.RemoveLabel);
    }

    [Fact]
    public void Projection_falls_back_to_unknown_browser_and_never_used()
    {
        var devices = Devices(new BrowserPushDevice(2, "https://push/e2", null, null));
        var display = BrowserPushChannelProjection.Project(
            BrowserPushCapability.Supported,
            BrowserPushPermissionStatus.Default,
            isSubscribed: false,
            currentEndpoint: null,
            devices,
            Localizer,
            Now);

        var row = Assert.Single(display.Devices);
        Assert.False(row.IsThisDevice);
        Assert.Equal("Unknown browser", row.UserAgentText);
        Assert.Equal("Not yet used", row.LastUsedText);
    }

    [Fact]
    public void Projection_with_no_devices_carries_the_empty_state_text()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Default, false);

        Assert.Empty(display.Devices);
        Assert.False(string.IsNullOrWhiteSpace(display.DevicesEmptyText));
        Assert.Equal("Registered devices", display.DevicesHeading);
    }

    // ---- i18n catalog ----------------------------------------------------------------------------------

    [Fact]
    public void I18n_catalog_contains_every_web_key()
    {
        var keys = BrowserPushChannelStrings.AllKeys;

        Assert.Contains("webpush.title", keys);
        Assert.Contains("webpush.subtitle", keys);
        Assert.Contains("webpush.status.subscribed", keys);
        Assert.Contains("webpush.status.notSubscribed", keys);
        Assert.Contains("webpush.status.unsupported", keys);
        Assert.Contains("webpush.unsupported.notification", keys);
        Assert.Contains("webpush.unsupported.serverDisabled", keys);
        Assert.Contains("webpush.unsupported.pushApi", keys);
        Assert.Contains("webpush.unsupported.permissionDenied", keys);
        Assert.Contains("webpush.enable", keys);
        Assert.Contains("webpush.disable", keys);
        Assert.Contains("webpush.iosNote", keys);
        Assert.Contains("webpush.devices.title", keys);
        Assert.Contains("webpush.devices.unknownAgent", keys);
        Assert.Contains("webpush.devices.lastUsed", keys);
        Assert.Contains("webpush.devices.neverUsed", keys);
        Assert.Contains("webpush.devices.thisDevice", keys);
        Assert.Contains("webpush.devices.remove", keys);
    }

    [Fact]
    public void I18n_catalog_has_no_duplicate_keys()
    {
        var keys = BrowserPushChannelStrings.AllKeys;
        Assert.Equal(keys, keys.Distinct().ToList());
    }

    // ---- Accessibility names ---------------------------------------------------------------------------

    [Fact]
    public void Accessibility_surface_and_badge_carry_narrator_names()
    {
        var display = Project(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Granted, true);

        Assert.Equal("Browser push", display.AutomationName);
        Assert.Equal(display.StatusText, display.StatusAutomationName);
    }

    [Fact]
    public void Accessibility_device_row_name_includes_browser_marker_and_last_used()
    {
        var devices = Devices(new BrowserPushDevice(1, "https://push/e1", "Chrome", Now.AddMinutes(-2)));
        var display = BrowserPushChannelProjection.Project(
            BrowserPushCapability.Supported,
            BrowserPushPermissionStatus.Granted,
            isSubscribed: true,
            currentEndpoint: "https://push/e1",
            devices,
            Localizer,
            Now);

        var row = Assert.Single(display.Devices);
        Assert.Contains("Chrome", row.AutomationName);
        Assert.Contains("(this device)", row.AutomationName);
        Assert.Contains("Last used 2m ago", row.AutomationName);
    }

    // ---- State holder: cache-then-network transitions --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_devices()
    {
        var source = new FakeDeviceSource(
            DeviceResult.Loading(),
            DeviceResult.Loaded(Devices(new BrowserPushDevice(1, "https://push/e1", "Edge", null)), Now));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(BrowserPushChannelState.Loaded, vm.State);
        Assert.Single(vm.Devices);
        Assert.False(vm.IsError);
        Assert.Single(vm.Display.Devices);
    }

    [Fact]
    public async Task ViewModel_empty_response_sets_empty_state()
    {
        var source = new FakeDeviceSource(DeviceResult.Loading(), DeviceResult.Empty(Now));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(BrowserPushChannelState.Empty, vm.State);
        Assert.Empty(vm.Devices);
    }

    [Fact]
    public async Task ViewModel_stale_cache_sets_stale_state()
    {
        var source = new FakeDeviceSource(
            DeviceResult.Loading(),
            DeviceResult.Cached(Devices(new BrowserPushDevice(1, "https://push/e1", "Edge", null)), Now, stale: true));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(BrowserPushChannelState.Stale, vm.State);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_devices_and_message()
    {
        var source = new FakeDeviceSource(
            DeviceResult.Loading(),
            DeviceResult.OfflineCached(
                Devices(new BrowserPushDevice(1, "https://push/e1", "Edge", null)),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "down")));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(BrowserPushChannelState.Offline, vm.State);
        Assert.Single(vm.Devices);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_hard_failure_sets_error_state()
    {
        var source = new FakeDeviceSource(
            DeviceResult.Loading(),
            DeviceResult.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(BrowserPushChannelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_counts_attempts_across_retries()
    {
        var source = new FakeDeviceSource(DeviceResult.Loading(), DeviceResult.Empty(Now));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
    }

    // ---- State holder: enable / disable / remove actions -----------------------------------------------

    [Fact]
    public async Task ViewModel_enable_subscribes_and_reloads()
    {
        var gateway = new InMemoryBrowserPushGateway();
        var source = new FakeDeviceSource(DeviceResult.Empty(Now));
        using var vm = new BrowserPushChannelViewModel(source, gateway, Localizer);

        await vm.EnableAsync();

        Assert.True(gateway.IsSubscribed);
        Assert.True(vm.IsSubscribed);
        Assert.True(vm.Display.ShowDisable);
        Assert.False(vm.Display.ShowEnable);
        Assert.Equal(BrowserPushPermissionStatus.Granted, vm.Permission);
        Assert.True(source.StreamCount >= 1);
    }

    [Fact]
    public async Task ViewModel_disable_unsubscribes_and_reloads()
    {
        var gateway = new InMemoryBrowserPushGateway(
            BrowserPushCapability.Supported, BrowserPushPermissionStatus.Granted, isSubscribed: true, currentEndpoint: "https://push/e1");
        var source = new FakeDeviceSource(DeviceResult.Empty(Now));
        using var vm = new BrowserPushChannelViewModel(source, gateway, Localizer);

        await vm.DisableAsync();

        Assert.False(gateway.IsSubscribed);
        Assert.False(vm.IsSubscribed);
        Assert.True(vm.Display.ShowEnable);
    }

    [Fact]
    public async Task ViewModel_remove_device_deletes_by_endpoint_and_reloads()
    {
        var source = new FakeDeviceSource(
            DeviceResult.Loaded(Devices(new BrowserPushDevice(1, "https://push/e1", "Edge", null)), Now));
        using var vm = new BrowserPushChannelViewModel(source, new InMemoryBrowserPushGateway(), Localizer);
        await vm.LoadAsync();
        int streamsBefore = source.StreamCount;

        await vm.RemoveDeviceAsync("https://push/e1");

        Assert.Equal("https://push/e1", Assert.Single(source.Removed));
        Assert.True(source.StreamCount > streamsBefore);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_capability_changes()
    {
        var gateway = new InMemoryBrowserPushGateway();
        var source = new FakeDeviceSource(DeviceResult.Empty(Now));
        using var vm = new BrowserPushChannelViewModel(source, gateway, Localizer);
        await vm.LoadAsync();
        Assert.False(vm.Display.IsUnsupported);

        gateway.SetCapability(BrowserPushCapability.NotificationsUnsupported);

        Assert.True(vm.Display.IsUnsupported);
        Assert.Equal("This browser doesn't support notifications.", vm.Display.DisabledReason);
    }

    // ---- In-memory gateway (web useWebPush) ------------------------------------------------------------

    [Fact]
    public async Task Gateway_subscribe_grants_permission_and_stamps_endpoint()
    {
        var gateway = new InMemoryBrowserPushGateway();
        int changes = 0;
        gateway.Changed += (_, _) => changes++;

        bool ok = await gateway.SubscribeAsync();

        Assert.True(ok);
        Assert.True(gateway.IsSubscribed);
        Assert.Equal(BrowserPushPermissionStatus.Granted, gateway.Permission);
        Assert.False(string.IsNullOrEmpty(gateway.CurrentEndpoint));
        Assert.Equal(1, changes);
    }

    [Theory]
    [InlineData(BrowserPushCapability.NotificationsUnsupported)]
    [InlineData(BrowserPushCapability.ServerNotConfigured)]
    [InlineData(BrowserPushCapability.PushApiUnsupported)]
    public async Task Gateway_subscribe_refuses_when_unsupported(BrowserPushCapability capability)
    {
        var gateway = new InMemoryBrowserPushGateway(capability);

        Assert.False(await gateway.SubscribeAsync());
        Assert.False(gateway.IsSubscribed);
    }

    [Fact]
    public async Task Gateway_subscribe_refuses_when_permission_denied()
    {
        var gateway = new InMemoryBrowserPushGateway(BrowserPushCapability.Supported, BrowserPushPermissionStatus.Denied);

        Assert.False(await gateway.SubscribeAsync());
        Assert.False(gateway.IsSubscribed);
    }

    [Fact]
    public async Task Gateway_unsubscribe_clears_subscription()
    {
        var gateway = new InMemoryBrowserPushGateway(
            BrowserPushCapability.Supported, BrowserPushPermissionStatus.Granted, isSubscribed: true, currentEndpoint: "https://push/e1");

        Assert.True(await gateway.UnsubscribeAsync());
        Assert.False(gateway.IsSubscribed);
        Assert.Null(gateway.CurrentEndpoint);
    }

    [Fact]
    public void Gateway_set_permission_raises_changed_once()
    {
        var gateway = new InMemoryBrowserPushGateway();
        int changes = 0;
        gateway.Changed += (_, _) => changes++;

        gateway.SetPermission(BrowserPushPermissionStatus.Denied);
        gateway.SetPermission(BrowserPushPermissionStatus.Denied);

        Assert.Equal(1, changes);
        Assert.Equal(BrowserPushPermissionStatus.Denied, gateway.Permission);
    }

    // ---- Diagnostics & registration --------------------------------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BrowserPushChannelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1L, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BrowserPushChannelCard", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("BrowserPushChannelCard", BrowserPushChannelRegistration.Slug);
        Assert.Equal("get_api_v1_push_subscribe", BrowserPushChannelRegistration.DevicesGetOperation);
        Assert.Equal("delete_api_v1_push_subscribe", BrowserPushChannelRegistration.DeviceDeleteOperation);
        Assert.Equal("get_api_v1_push_public_key", BrowserPushChannelRegistration.PublicKeyOperation);
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => e.OperationId == BrowserPushChannelRegistration.DevicesGetOperation && e.Method == GeneratedApi.HttpMethod.Get);
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => e.OperationId == BrowserPushChannelRegistration.DeviceDeleteOperation && e.Method == GeneratedApi.HttpMethod.Delete);
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => e.OperationId == BrowserPushChannelRegistration.PublicKeyOperation && e.Method == GeneratedApi.HttpMethod.Get);
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    private static BrowserPushChannelDisplay Project(
        BrowserPushCapability capability,
        BrowserPushPermissionStatus permission,
        bool isSubscribed) =>
        BrowserPushChannelProjection.Project(
            capability,
            permission,
            isSubscribed,
            currentEndpoint: null,
            Array.Empty<BrowserPushDevice>(),
            Localizer,
            Now);

    private static DeviceList Devices(params BrowserPushDevice[] devices) => devices;

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class FakeDeviceSource : IBrowserPushDeviceSource
    {
        private readonly DeviceResult[] _emissions;

        public FakeDeviceSource(params DeviceResult[] emissions) => _emissions = emissions;

        public int StreamCount { get; private set; }

        public List<string> Removed { get; } = new();

        public async IAsyncEnumerable<DeviceResult> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            StreamCount++;
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public Task RemoveAsync(string endpoint, CancellationToken cancellationToken = default)
        {
            Removed.Add(endpoint);
            return Task.CompletedTask;
        }
    }
}
