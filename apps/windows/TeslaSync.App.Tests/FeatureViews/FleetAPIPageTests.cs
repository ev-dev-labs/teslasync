using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FleetAPIPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/FleetAPIPage.tsx), the tolerant snapshot parsers (incl. the platform <c>{data:…}</c>
/// envelope), the view-model's three-state matrix (loading / empty / success) plus the suspend toggle and polling-config
/// writes with their toast notices, and the generated-client feed's request shaping (the six web hooks). The WinUI view
/// is exercised by the app build; its per-region visibility is driven entirely by the <see cref="FleetApiDisplay"/>
/// flags asserted here.
/// </summary>
public sealed class FleetAPIPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 70 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        // page header
        "fleetApi.navTitle", "fleetApi.title", "fleetApi.subtitle",
        // GlassPanel1 — Tesla API Polling
        "fleetApi.polling.title", "fleetApi.polling.suspendedStatus", "fleetApi.polling.activeStatus",
        "fleetApi.polling.suspendedNote",
        // GlassPanel3 — API Endpoint Controls
        "fleetApi.controls.title", "fleetApi.controls.subtitle", "fleetApi.controls.enabled",
        "fleetApi.section.polling", "fleetApi.section.onDemand", "fleetApi.section.commands",
        "fleetApi.section.telemetryCapture",
        // telemetry capture
        "fleetApi.capture.connected", "fleetApi.capture.notConfigured", "fleetApi.capture.rawTitle",
        "fleetApi.capture.enabledDesc", "fleetApi.capture.disabledDesc", "fleetApi.capture.retentionTitle",
        "fleetApi.capture.retentionDesc", "fleetApi.capture.signalsCaptured", "fleetApi.capture.vehicle",
        // retention options
        "fleetApi.retention.d1", "fleetApi.retention.d3", "fleetApi.retention.d7", "fleetApi.retention.d14",
        "fleetApi.retention.d30",
        // GlassPanel7 — API Endpoints
        "fleetApi.endpoints.title", "fleetApi.endpoints.configured", "fleetApi.endpoint.api",
        "fleetApi.endpoint.web", "fleetApi.endpoint.oauth", "fleetApi.endpoint.teslaApi", "common.noData",
        // toasts
        "fleetApi.toast.suspendedTitle", "fleetApi.toast.suspendedBody", "fleetApi.toast.resumedTitle",
        "fleetApi.toast.resumedBody", "fleetApi.toast.failedTitle", "fleetApi.toast.suspendError",
        "fleetApi.toast.pollingUpdated", "fleetApi.toast.pollingError",
        // endpoint labels
        "fleetApi.ep.label.vehicleDiscovery", "fleetApi.ep.label.chargeState", "fleetApi.ep.label.climateState",
        "fleetApi.ep.label.driveState", "fleetApi.ep.label.locationData", "fleetApi.ep.label.vehicleState",
        "fleetApi.ep.label.vehicleConfig", "fleetApi.ep.label.nearbyCharging", "fleetApi.ep.label.releaseNotes",
        "fleetApi.ep.label.recentAlerts", "fleetApi.ep.label.serviceData", "fleetApi.ep.label.wakeUp",
        "fleetApi.ep.label.commands",
        // endpoint descriptions
        "fleetApi.ep.desc.listVehicles", "fleetApi.ep.desc.batteryCharging", "fleetApi.ep.desc.climateTemp",
        "fleetApi.ep.desc.locationSpeed", "fleetApi.ep.desc.gps", "fleetApi.ep.desc.locksDoors",
        "fleetApi.ep.desc.modelTrim", "fleetApi.ep.desc.syncVehicles", "fleetApi.ep.desc.superchargers",
        "fleetApi.ep.desc.firmwareNotes", "fleetApi.ep.desc.alertHistory", "fleetApi.ep.desc.serviceHistory",
        "fleetApi.ep.desc.wakeSleep", "fleetApi.ep.desc.lockUnlock",
    ];

    private static FleetApiModel ResolvedModel(
        bool suspended = false,
        PollingConfigSnapshot? polling = null,
        CaptureStatsSnapshot? capture = null,
        FleetVersionSnapshot? version = null,
        FleetApiNoticeKind notice = FleetApiNoticeKind.None) => new(
        Loading: false,
        Settings: new FleetSettingsSnapshot(true, suspended),
        PollingConfig: polling ?? PollingConfigSnapshot.Empty,
        CaptureStats: capture ?? CaptureStatsSnapshot.Empty,
        Version: version ?? FleetVersionSnapshot.Empty,
        Notice: notice);

    private static PollingConfigSnapshot Polling(int retention = 7, params (string Key, bool On)[] toggles)
    {
        var map = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var (key, on) in toggles)
        {
            map[key] = on;
        }

        return new PollingConfigSnapshot(true, map, retention);
    }

    private static FleetVersionSnapshot Version(params (string Key, string Url)[] endpoints)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, url) in endpoints)
        {
            map[key] = url;
        }

        return new FleetVersionSnapshot(true, "1.2.3", "go1.25", "linux", "amd64", map);
    }

    // ---- i18n key coverage (all 70 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = FleetApiProjection.Project(
            ResolvedModel(polling: Polling(), version: Version(("api", "https://api"))), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_even_while_loading()
    {
        var recorder = new RecordingLocalizer();

        _ = FleetApiProjection.Project(FleetApiModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_exactly_seventy_distinct_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = FleetApiProjection.Project(FleetApiModel.Initial, recorder);

        Assert.Equal(70, recorder.Keys.Distinct().Count());
    }

    // ---- Data states (loading / empty / success) -----------------------------------

    [Fact]
    public void State_loading_when_first_read_in_flight()
    {
        var display = FleetApiProjection.Project(FleetApiModel.Initial, Localizer);

        Assert.Equal(FleetApiState.Loading, display.State);
        Assert.True(display.ShowLoading);
    }

    [Fact]
    public void State_empty_when_no_configured_endpoints()
    {
        var display = FleetApiProjection.Project(ResolvedModel(version: Version()), Localizer);

        Assert.Equal(FleetApiState.Empty, display.State);
        Assert.False(display.ShowLoading);
        Assert.True(display.ShowEndpointsEmpty);
        Assert.False(display.ShowConfiguredEndpoints);
        Assert.Equal("No data available", display.NoDataMessage);
    }

    [Fact]
    public void State_success_when_configured_endpoints_present()
    {
        var display = FleetApiProjection.Project(
            ResolvedModel(version: Version(("api", "https://api.example"))), Localizer);

        Assert.Equal(FleetApiState.Success, display.State);
        Assert.True(display.ShowConfiguredEndpoints);
        Assert.False(display.ShowEndpointsEmpty);
    }

    // ---- GlassPanel1 — Tesla API Polling -------------------------------------------

    [Fact]
    public void Polling_panel_active_state()
    {
        var display = FleetApiProjection.Project(ResolvedModel(suspended: false), Localizer);

        Assert.False(display.IsSuspended);
        Assert.Equal("Tesla API Polling", display.PollingTitle);
        Assert.Equal("Vehicle data is being polled from Tesla", display.PollingStatus);
    }

    [Fact]
    public void Polling_panel_suspended_state_shows_warning_note()
    {
        var display = FleetApiProjection.Project(ResolvedModel(suspended: true), Localizer);

        Assert.True(display.IsSuspended);
        Assert.Equal("All Tesla Fleet API calls are suspended", display.PollingStatus);
        Assert.Equal(
            "Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. "
                + "Useful when your vehicle is in service.",
            display.SuspendedNote);
    }

    // ---- GlassPanel3 — API Endpoint Controls ---------------------------------------

    [Fact]
    public void Controls_hidden_until_polling_config_resolves()
    {
        var display = FleetApiProjection.Project(ResolvedModel(), Localizer);

        Assert.False(display.ShowControls);
        Assert.Equal(string.Empty, display.EnabledSummary);
    }

    [Fact]
    public void Endpoint_groups_have_the_web_counts()
    {
        var display = FleetApiProjection.Project(ResolvedModel(polling: Polling()), Localizer);

        Assert.Equal(7, display.PollingEndpoints.Count);
        Assert.Equal(11, display.OnDemandEndpoints.Count);
        Assert.Equal(2, display.CommandEndpoints.Count);
    }

    [Fact]
    public void Endpoint_toggle_reflects_the_config_flag()
    {
        var polling = Polling(toggles: [("charge_state", true), ("drive_state", false)]);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling), Localizer);

        var charge = display.PollingEndpoints.Single(e => e.Key == "charge_state");
        var drive = display.PollingEndpoints.Single(e => e.Key == "drive_state");
        Assert.True(charge.Enabled);
        Assert.False(drive.Enabled);
        Assert.Equal("Charge State", charge.Label);
        Assert.Equal("Battery & charging data", charge.Description);
    }

    [Fact]
    public void Enabled_summary_counts_every_endpoint_key()
    {
        // Three polling flags on, plus telemetry_capture — four of the twenty-one keys enabled.
        var polling = Polling(toggles:
        [
            ("vehicle_discovery", true), ("charge_state", true), ("drive_state", true), ("telemetry_capture", true),
        ]);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling), Localizer);

        Assert.Equal("(4/21 enabled)", display.EnabledSummary);
    }

    [Fact]
    public void OnDemand_vehicle_discovery_has_its_own_description()
    {
        var display = FleetApiProjection.Project(ResolvedModel(polling: Polling()), Localizer);

        var onDemand = display.OnDemandEndpoints.Single(e => e.Key == "on_demand_vehicle_discovery");
        Assert.Equal("Vehicle Discovery", onDemand.Label);
        Assert.Equal("Sync vehicles from Tesla", onDemand.Description);
    }

    // ---- Telemetry capture ---------------------------------------------------------

    [Fact]
    public void Capture_badge_connected_when_mongo_enabled()
    {
        var display = FleetApiProjection.Project(
            ResolvedModel(polling: Polling(), capture: new CaptureStatsSnapshot(true, true, 0, 0)), Localizer);

        Assert.True(display.ShowMongoBadge);
        Assert.True(display.MongoEnabled);
        Assert.Equal("MongoDB Connected", display.MongoBadgeText);
        Assert.Equal("Capture every fleet telemetry signal to MongoDB for debugging", display.RawSignalRecordingDescription);
    }

    [Fact]
    public void Capture_badge_not_configured_uses_disabled_description()
    {
        var display = FleetApiProjection.Project(
            ResolvedModel(polling: Polling(), capture: new CaptureStatsSnapshot(true, false, 0, 0)), Localizer);

        Assert.Equal("MongoDB Not Configured", display.MongoBadgeText);
        Assert.Equal("Set MONGODB_ENABLED=true and configure MONGODB_URI to enable", display.RawSignalRecordingDescription);
    }

    [Fact]
    public void Retention_row_visible_only_when_capture_on_and_mongo_enabled()
    {
        var polling = Polling(retention: 14, toggles: [("telemetry_capture", true)]);
        var capture = new CaptureStatsSnapshot(true, true, 0, 0);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling, capture: capture), Localizer);

        Assert.True(display.ShowRetention);
        Assert.Equal(14, display.RetentionDays);
        Assert.Collection(
            display.RetentionOptions,
            o => AssertOption(o, 1, "1 day"),
            o => AssertOption(o, 3, "3 days"),
            o => AssertOption(o, 7, "7 days"),
            o => AssertOption(o, 14, "14 days"),
            o => AssertOption(o, 30, "30 days"));
    }

    [Fact]
    public void Retention_row_hidden_when_capture_off()
    {
        var polling = Polling(toggles: [("telemetry_capture", false)]);
        var capture = new CaptureStatsSnapshot(true, true, 0, 0);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling, capture: capture), Localizer);

        Assert.False(display.ShowRetention);
        Assert.False(display.ShowCaptureStats);
    }

    [Fact]
    public void Capture_stats_chip_formats_count_and_pluralizes_vehicles()
    {
        var polling = Polling(toggles: [("telemetry_capture", true)]);
        var capture = new CaptureStatsSnapshot(true, true, 1234567, 3);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling, capture: capture), Localizer);

        Assert.True(display.ShowCaptureStats);
        Assert.Equal("1,234,567 signals captured from 3 vehicles", display.CaptureStatsText);
    }

    [Fact]
    public void Capture_stats_chip_uses_singular_for_one_vehicle()
    {
        var polling = Polling(toggles: [("telemetry_capture", true)]);
        var capture = new CaptureStatsSnapshot(true, true, 5, 1);
        var display = FleetApiProjection.Project(ResolvedModel(polling: polling, capture: capture), Localizer);

        Assert.Equal("5 signals captured from 1 vehicle", display.CaptureStatsText);
    }

    // ---- GlassPanel7 — API Endpoints -----------------------------------------------

    [Fact]
    public void Configured_endpoints_render_known_rows_in_order()
    {
        var version = Version(
            ("api", "https://api.local"),
            ("web", "https://web.local"),
            ("oauth_callback", "https://oauth.local"),
            ("tesla_api", "https://fleet-api.tesla.com"));
        var display = FleetApiProjection.Project(ResolvedModel(version: version), Localizer);

        Assert.Equal("v1.2.3 \u00b7 go1.25 \u00b7 linux/amd64", display.VersionSubtitle);
        Assert.Collection(
            display.ConfiguredEndpoints,
            e => AssertEndpoint(e, "API (Internal)", "https://api.local"),
            e => AssertEndpoint(e, "Web Frontend", "https://web.local"),
            e => AssertEndpoint(e, "OAuth Callback", "https://oauth.local"),
            e => AssertEndpoint(e, "Tesla Fleet API", "https://fleet-api.tesla.com"));
    }

    [Fact]
    public void Configured_endpoints_skip_missing_urls()
    {
        var display = FleetApiProjection.Project(
            ResolvedModel(version: Version(("api", "https://api.only"))), Localizer);

        var only = Assert.Single(display.ConfiguredEndpoints);
        AssertEndpoint(only, "API (Internal)", "https://api.only");
    }

    // ---- Toast / InfoBar notices ---------------------------------------------------

    [Theory]
    [InlineData(FleetApiNoticeKind.ApiSuspended, "API suspended", "All Tesla API calls have been paused")]
    [InlineData(FleetApiNoticeKind.ApiResumed, "API resumed", "Tesla API polling has been re-enabled")]
    [InlineData(FleetApiNoticeKind.SuspendFailed, "Failed", "Could not toggle API suspension")]
    [InlineData(FleetApiNoticeKind.PollingUpdated, "Polling config updated", "")]
    [InlineData(FleetApiNoticeKind.PollingFailed, "Failed to update polling config", "")]
    public void Notice_maps_to_localized_title_and_message(FleetApiNoticeKind kind, string title, string message)
    {
        var display = FleetApiProjection.Project(ResolvedModel(notice: kind), Localizer);

        Assert.True(display.Notice.HasNotice);
        Assert.Equal(kind, display.Notice.Kind);
        Assert.Equal(title, display.Notice.Title);
        Assert.Equal(message, display.Notice.Message);
    }

    [Fact]
    public void Notice_none_is_not_shown()
    {
        var display = FleetApiProjection.Project(ResolvedModel(), Localizer);
        Assert.False(display.Notice.HasNotice);
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void Settings_parser_reads_api_suspended_from_envelope()
    {
        var snapshot = FleetSettingsSnapshot.FromJson(Json("{\"data\":{\"api_suspended\":true}}"));
        Assert.True(snapshot.HasData);
        Assert.True(snapshot.ApiSuspended);
    }

    [Fact]
    public void Polling_parser_captures_flags_and_retention()
    {
        var snapshot = PollingConfigSnapshot.FromJson(
            Json("{\"charge_state\":true,\"drive_state\":false,\"telemetry_capture_retention_days\":14}"));

        Assert.True(snapshot.HasData);
        Assert.True(snapshot.IsEnabled("charge_state"));
        Assert.False(snapshot.IsEnabled("drive_state"));
        Assert.Equal(14, snapshot.RetentionDays);
    }

    [Fact]
    public void Polling_parser_defaults_retention_to_seven()
    {
        var snapshot = PollingConfigSnapshot.FromJson(Json("{\"charge_state\":true}"));
        Assert.Equal(7, snapshot.RetentionDays);
    }

    [Fact]
    public void Polling_with_toggle_flips_one_flag_and_keeps_the_rest()
    {
        var snapshot = Polling(retention: 7, toggles: [("charge_state", true), ("drive_state", false)]);
        var payload = snapshot.WithToggle("drive_state", true);

        Assert.Equal(true, payload["charge_state"]);
        Assert.Equal(true, payload["drive_state"]);
        Assert.Equal(7, payload[PollingConfigSnapshot.RetentionField]);
    }

    [Fact]
    public void Capture_parser_counts_distinct_vins()
    {
        var snapshot = CaptureStatsSnapshot.FromJson(
            Json("{\"mongodb_enabled\":true,\"total_documents\":42,\"distinct_vins\":[\"a\",\"b\"]}"));

        Assert.True(snapshot.MongoEnabled);
        Assert.Equal(42, snapshot.TotalDocuments);
        Assert.Equal(2, snapshot.DistinctVinCount);
    }

    [Fact]
    public void Version_parser_reads_endpoints_map()
    {
        var snapshot = FleetVersionSnapshot.FromJson(
            Json("{\"chart_version\":\"9\",\"go_version\":\"go1.25\",\"os\":\"linux\",\"arch\":\"arm64\",\"endpoints\":{\"api\":\"https://x\"}}"));

        Assert.True(snapshot.HasData);
        Assert.Equal("9", snapshot.ChartVersion);
        Assert.Equal("https://x", snapshot.Endpoints["api"]);
    }

    // ---- ViewModel: reads + state --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_all_four_reads_into_success()
    {
        var feed = new FakeFeed
        {
            Settings = new FleetSettingsSnapshot(true, false),
            Polling = Polling(),
            Capture = new CaptureStatsSnapshot(true, false, 0, 0),
            Version = Version(("api", "https://api")),
        };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FleetApiState.Success, vm.State);
        Assert.True(vm.Display.ShowControls);
        Assert.Equal(1, feed.SettingsReads);
        Assert.Equal(1, feed.PollingReads);
        Assert.Equal(1, feed.CaptureReads);
        Assert.Equal(1, feed.VersionReads);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new FleetAPIPageViewModel(EmptyFleetApiFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(FleetApiState.Empty, vm.State);
        Assert.False(vm.Display.ShowLoading);
    }

    [Fact]
    public async Task ViewModel_read_failure_keeps_the_other_panels()
    {
        var feed = new FakeFeed
        {
            Polling = Polling(),
            Version = Version(("api", "https://api")),
            FailVersion = true,
        };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        // The version read threw, so no configured endpoints — but the polling controls still render.
        Assert.True(vm.Display.ShowControls);
        Assert.True(vm.Display.ShowEndpointsEmpty);
    }

    // ---- ViewModel: suspend toggle -------------------------------------------------

    [Fact]
    public async Task ViewModel_suspend_sets_the_suspended_notice_and_rereads_settings()
    {
        var feed = new FakeFeed { Settings = new FleetSettingsSnapshot(true, false) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        feed.Settings = new FleetSettingsSnapshot(true, true);

        await vm.ToggleSuspendAsync(desiredSuspended: true);

        Assert.True(vm.Display.IsSuspended);
        Assert.Equal(FleetApiNoticeKind.ApiSuspended, vm.Display.Notice.Kind);
        Assert.Equal(true, feed.LastSuspended);
        Assert.Equal(2, feed.SettingsReads); // initial load + re-read after the mutation
    }

    [Fact]
    public async Task ViewModel_resume_sets_the_resumed_notice()
    {
        var feed = new FakeFeed { Settings = new FleetSettingsSnapshot(true, true) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.ToggleSuspendAsync(desiredSuspended: false);

        Assert.Equal(FleetApiNoticeKind.ApiResumed, vm.Display.Notice.Kind);
    }

    [Fact]
    public async Task ViewModel_suspend_failure_sets_the_failed_notice()
    {
        var feed = new FakeFeed { Settings = new FleetSettingsSnapshot(true, false), MutationSucceeds = false };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.ToggleSuspendAsync(desiredSuspended: true);

        Assert.Equal(FleetApiNoticeKind.SuspendFailed, vm.Display.Notice.Kind);
        Assert.Equal(1, feed.SettingsReads); // no re-read on failure
    }

    // ---- ViewModel: polling-config writes ------------------------------------------

    [Fact]
    public async Task ViewModel_toggle_endpoint_flips_flag_and_sets_updated_notice()
    {
        var feed = new FakeFeed { Polling = Polling(toggles: [("charge_state", false)]) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.ToggleEndpointAsync("charge_state");

        Assert.Equal(FleetApiNoticeKind.PollingUpdated, vm.Display.Notice.Kind);
        Assert.NotNull(feed.LastPayload);
        Assert.Equal(true, feed.LastPayload!["charge_state"]);
        var charge = vm.Display.PollingEndpoints.Single(e => e.Key == "charge_state");
        Assert.True(charge.Enabled); // the re-read reflects the flip
    }

    [Fact]
    public async Task ViewModel_toggle_endpoint_is_a_no_op_before_config_loads()
    {
        var feed = new FakeFeed();
        using var vm = new FleetAPIPageViewModel(feed, Localizer);

        await vm.ToggleEndpointAsync("charge_state");

        Assert.Equal(0, feed.UpdateCalls);
    }

    [Fact]
    public async Task ViewModel_set_retention_writes_the_new_window()
    {
        var feed = new FakeFeed { Polling = Polling(retention: 7, toggles: [("telemetry_capture", true)]) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SetRetentionAsync(30);

        Assert.Equal(FleetApiNoticeKind.PollingUpdated, vm.Display.Notice.Kind);
        Assert.Equal(30, feed.LastPayload![PollingConfigSnapshot.RetentionField]);
        Assert.Equal(30, vm.Display.RetentionDays);
    }

    [Fact]
    public async Task ViewModel_set_retention_is_a_no_op_for_the_same_value()
    {
        var feed = new FakeFeed { Polling = Polling(retention: 7) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SetRetentionAsync(7);

        Assert.Equal(0, feed.UpdateCalls);
    }

    [Fact]
    public async Task ViewModel_update_failure_sets_the_polling_failed_notice()
    {
        var feed = new FakeFeed { Polling = Polling(toggles: [("charge_state", false)]), MutationSucceeds = false };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.ToggleEndpointAsync("charge_state");

        Assert.Equal(FleetApiNoticeKind.PollingFailed, vm.Display.Notice.Kind);
    }

    [Fact]
    public async Task ViewModel_clear_notice_dismisses_the_toast()
    {
        var feed = new FakeFeed { Settings = new FleetSettingsSnapshot(true, false) };
        using var vm = new FleetAPIPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.ToggleSuspendAsync(desiredSuspended: true);

        vm.ClearNotice();

        Assert.False(vm.Display.Notice.HasNotice);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_reads_send_the_web_hook_operations()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"api_suspended\":true}"));
        api.ReturnsValue(Json("{\"charge_state\":true}"));
        api.ReturnsValue(Json("{\"mongodb_enabled\":true,\"total_documents\":1,\"distinct_vins\":[\"v\"]}"));
        api.ReturnsValue(Json("{\"chart_version\":\"1\",\"endpoints\":{}}"));
        var feed = new FleetApiClientFeed(api);

        Assert.True((await feed.FetchSettingsAsync(default)).ApiSuspended);
        Assert.True((await feed.FetchPollingConfigAsync(default)).IsEnabled("charge_state"));
        Assert.Equal(1, (await feed.FetchCaptureStatsAsync(default)).TotalDocuments);
        Assert.True((await feed.FetchVersionAsync(default)).HasData);

        Assert.Collection(
            api.Requests,
            r => Assert.Equal("get_api_v1_settings", r.OperationId),
            r => Assert.Equal("get_api_v1_settings_polling_config", r.OperationId),
            r => Assert.Equal("get_api_v1_dev_tools_telemetry_capture_stats", r.OperationId),
            r => Assert.Equal("get_api_v1_system_version", r.OperationId));
    }

    [Fact]
    public async Task ClientFeed_suspend_posts_the_suspended_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new FleetApiClientFeed(api);

        var outcome = await feed.ToggleSuspendAsync(true, default);

        Assert.True(outcome.Success);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_settings_suspend_api", request.OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object>>(request.Body);
        Assert.Equal(true, body["suspended"]);
    }

    [Fact]
    public async Task ClientFeed_update_puts_the_full_config()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new FleetApiClientFeed(api);
        var payload = new Dictionary<string, object> { ["charge_state"] = true, ["telemetry_capture_retention_days"] = 14 };

        var outcome = await feed.UpdatePollingConfigAsync(payload, default);

        Assert.True(outcome.Success);
        var request = Assert.Single(api.Requests);
        Assert.Equal("put_api_v1_settings_polling_config", request.OperationId);
        Assert.Same(payload, request.Body);
    }

    [Fact]
    public async Task ClientFeed_mutation_failure_is_a_failed_outcome()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new FleetApiClientFeed(api);

        var outcome = await feed.ToggleSuspendAsync(true, default);

        Assert.False(outcome.Success);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new FleetApiDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetAPIPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("FleetAPI", FleetApiRegistration.RouteName);
        Assert.Equal("get_api_v1_settings", FleetApiRegistration.SettingsOperation);
        Assert.Equal("get_api_v1_settings_polling_config", FleetApiRegistration.PollingConfigOperation);
        Assert.Equal("put_api_v1_settings_polling_config", FleetApiRegistration.PollingConfigUpdateOperation);
        Assert.Equal("post_api_v1_settings_suspend_api", FleetApiRegistration.SuspendOperation);
        Assert.Equal("get_api_v1_dev_tools_telemetry_capture_stats", FleetApiRegistration.CaptureStatsOperation);
        Assert.Equal("get_api_v1_system_version", FleetApiRegistration.VersionOperation);
        Assert.Equal("Fleet API Settings", FleetApiRegistration.Title(Localizer));
    }

    private static void AssertOption(FleetApiRetentionOption option, int days, string label)
    {
        Assert.Equal(days, option.Days);
        Assert.Equal(label, option.Label);
    }

    private static void AssertEndpoint(FleetApiConfiguredEndpoint endpoint, string label, string url)
    {
        Assert.Equal(label, endpoint.Label);
        Assert.Equal(url, endpoint.Url);
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IFleetApiFeed
    {
        public FleetSettingsSnapshot Settings { get; set; } = FleetSettingsSnapshot.Empty;

        public PollingConfigSnapshot Polling { get; set; } = PollingConfigSnapshot.Empty;

        public CaptureStatsSnapshot Capture { get; set; } = CaptureStatsSnapshot.Empty;

        public FleetVersionSnapshot Version { get; set; } = FleetVersionSnapshot.Empty;

        public bool MutationSucceeds { get; set; } = true;

        public bool FailVersion { get; set; }

        public int SettingsReads { get; private set; }

        public int PollingReads { get; private set; }

        public int CaptureReads { get; private set; }

        public int VersionReads { get; private set; }

        public int UpdateCalls { get; private set; }

        public bool? LastSuspended { get; private set; }

        public IReadOnlyDictionary<string, object>? LastPayload { get; private set; }

        public Task<FleetSettingsSnapshot> FetchSettingsAsync(CancellationToken cancellationToken)
        {
            SettingsReads++;
            return Task.FromResult(Settings);
        }

        public Task<PollingConfigSnapshot> FetchPollingConfigAsync(CancellationToken cancellationToken)
        {
            PollingReads++;
            return Task.FromResult(Polling);
        }

        public Task<CaptureStatsSnapshot> FetchCaptureStatsAsync(CancellationToken cancellationToken)
        {
            CaptureReads++;
            return Task.FromResult(Capture);
        }

        public Task<FleetVersionSnapshot> FetchVersionAsync(CancellationToken cancellationToken)
        {
            VersionReads++;
            return FailVersion
                ? Task.FromException<FleetVersionSnapshot>(new ApiException("version down", 500))
                : Task.FromResult(Version);
        }

        public Task<FleetMutationOutcome> ToggleSuspendAsync(bool suspended, CancellationToken cancellationToken)
        {
            LastSuspended = suspended;
            return Task.FromResult(MutationSucceeds ? FleetMutationOutcome.Ok : FleetMutationOutcome.Fail);
        }

        public Task<FleetMutationOutcome> UpdatePollingConfigAsync(
            IReadOnlyDictionary<string, object> payload,
            CancellationToken cancellationToken)
        {
            UpdateCalls++;
            LastPayload = payload;
            if (MutationSucceeds)
            {
                Polling = FromPayload(payload);
            }

            return Task.FromResult(MutationSucceeds ? FleetMutationOutcome.Ok : FleetMutationOutcome.Fail);
        }

        private static PollingConfigSnapshot FromPayload(IReadOnlyDictionary<string, object> payload)
        {
            var toggles = new Dictionary<string, bool>(StringComparer.Ordinal);
            int retention = 7;
            foreach (var (key, value) in payload)
            {
                if (key == PollingConfigSnapshot.RetentionField && value is int days)
                {
                    retention = days;
                }
                else if (value is bool flag)
                {
                    toggles[key] = flag;
                }
            }

            return new PollingConfigSnapshot(true, toggles, retention);
        }
    }
}
