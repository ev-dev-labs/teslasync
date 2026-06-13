using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Vehicles;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleDetailPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicles/pages/VehicleDetailPage.tsx), the tolerant settings parsers, the nickname resolver
/// (web <c>findEffectiveSetting</c>), the four-state matrix (loading / empty / error / success), the sixteen
/// section-boundary regions with their localized fallback titles, the wake-command folding (web wake mutation),
/// and the generated-client feed's request shaping (web <c>useVehicleSettings</c> + wake). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="VehicleDetailDisplay"/> flags asserted here.
/// </summary>
public sealed class VehicleDetailPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 19 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "vehicles.detail.title",
        "vehicles.detail.wakeFailed",
        "vehicles.detail.wakeSuccess",
        "vehicles.detail.section.aiPaintPreviewFailed",
        "vehicles.detail.section.batteryChartsFailed",
        "vehicles.detail.section.batteryRangeFailed",
        "vehicles.detail.section.chargingTelemetryFailed",
        "vehicles.detail.section.climateFailed",
        "vehicles.detail.section.headerFailed",
        "vehicles.detail.section.liveStateFailed",
        "vehicles.detail.section.motorFailed",
        "vehicles.detail.section.quickLinksFailed",
        "vehicles.detail.section.quickStatsFailed",
        "vehicles.detail.section.recentChargesFailed",
        "vehicles.detail.section.recentDrivesFailed",
        "vehicles.detail.section.securityFailed",
        "vehicles.detail.section.settingsFailed",
        "vehicles.detail.section.tireFailed",
        "vehicles.detail.section.vehicleConfigFailed",
    ];

    // The sixteen web SectionErrorBoundary regions in render order.
    private static readonly string[] SectionIds =
    [
        "header", "battery-range", "live-state", "quick-stats", "motor", "climate", "security",
        "tire-pressure", "charging-telemetry", "battery-charts", "recent-drives", "recent-charges",
        "vehicle-config", "ai-paint-preview", "quick-links", "settings",
    ];

    private static VehicleSettingsData Settings(params EffectiveSettingData[] rows) =>
        new(rows);

    private static EffectiveSettingData Nickname(string value) =>
        new("nickname", value, ValueIsText: true, Source: "override");

    private static VehicleDetailModel SuccessModel(VehicleSettingsData? settings = null) =>
        new(new VehicleDetailSnapshot(settings ?? Settings(Nickname("Bolt"))), false, null);

    private static VehicleDetailDisplay Project(VehicleDetailModel model) =>
        VehicleDetailProjection.Project(model, Localizer);

    // ── i18n key coverage (all 19 manifest strings) ─────────────────────────────────

    [Fact]
    public void Required_string_key_set_has_exactly_nineteen_unique_keys() =>
        Assert.Equal(19, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = VehicleDetailProjection.Project(SuccessModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = VehicleDetailProjection.Project(VehicleDetailModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_settings_query_in_flight()
    {
        var display = Project(VehicleDetailModel.Initial);

        Assert.Equal(VehicleDetailState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_without_settings()
    {
        var display = Project(new VehicleDetailModel(VehicleDetailSnapshot.Empty, false, null));

        Assert.Equal(VehicleDetailState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_read_failed()
    {
        var display = Project(new VehicleDetailModel(VehicleDetailSnapshot.Empty, false, "boom"));

        Assert.Equal(VehicleDetailState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_settings_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(VehicleDetailState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ── Sections / regions ──────────────────────────────────────────────────────────

    [Fact]
    public void Success_builds_all_sixteen_section_regions_in_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(16, display.Sections.Count);
        Assert.Equal(SectionIds, display.Sections.Select(section => section.Id).ToArray());
    }

    [Fact]
    public void Every_section_carries_its_localized_fallback_title()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Vehicle header failed to load", Section(display, "header").FallbackTitle);
        Assert.Equal("Per-vehicle settings failed to load", Section(display, "settings").FallbackTitle);
        Assert.Equal("Helix paint preview failed to load", Section(display, "ai-paint-preview").FallbackTitle);
        Assert.All(display.Sections, section => Assert.False(string.IsNullOrWhiteSpace(section.FallbackTitle)));
    }

    [Fact]
    public void Sections_without_in_scope_data_carry_a_localized_empty_message()
    {
        var display = Project(SuccessModel());

        // Motor / climate / security have no in-scope data source — they render a localized caption, never blank.
        foreach (var id in new[] { "motor", "climate", "security", "tire-pressure" })
        {
            var section = Section(display, id);
            Assert.Empty(section.Rows);
            Assert.False(string.IsNullOrWhiteSpace(section.EmptyText));
        }
    }

    [Fact]
    public void Settings_section_renders_the_resolved_effective_settings()
    {
        var display = Project(SuccessModel(Settings(
            Nickname("Bolt"),
            new EffectiveSettingData("alerts_muted", bool.TrueString, ValueIsText: false, Source: "default"))));

        var settings = Section(display, "settings");

        Assert.Equal(2, settings.Rows.Count);
        Assert.Contains(settings.Rows, row => row.Label == "nickname" && row.Value.Contains("Bolt", StringComparison.Ordinal));
        Assert.Contains(settings.Rows, row => row.Label == "alerts_muted" && row.Value.Contains("default", StringComparison.Ordinal));
    }

    // ── Nickname resolver (web findEffectiveSetting) ─────────────────────────────────

    [Fact]
    public void Effective_name_uses_the_nickname_override_when_present()
    {
        var display = Project(SuccessModel(Settings(Nickname("Lightning"))));

        Assert.Equal("Lightning", display.Title);
        Assert.Equal("Lightning", display.EffectiveName);
        Assert.Contains("Lightning", Section(display, "header").Rows.Single().Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Effective_name_falls_back_to_the_title_without_a_nickname()
    {
        var display = Project(SuccessModel(Settings(
            new EffectiveSettingData("range_unit", "km", ValueIsText: true, Source: "user"))));

        Assert.Equal("Vehicle Detail", display.EffectiveName);
    }

    [Fact]
    public void Effective_name_ignores_a_blank_or_non_text_nickname()
    {
        var blank = Project(SuccessModel(Settings(new EffectiveSettingData("nickname", "", ValueIsText: true, Source: "override"))));
        Assert.Equal("Vehicle Detail", blank.EffectiveName);

        var numeric = Project(SuccessModel(Settings(new EffectiveSettingData("nickname", "7", ValueIsText: false, Source: "override"))));
        Assert.Equal("Vehicle Detail", numeric.EffectiveName);
    }

    // ── Wake strings always resolved (web wake toasts) ───────────────────────────────

    [Fact]
    public void Wake_toasts_are_resolved_on_the_display()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Wake command sent", display.WakeSuccess);
        Assert.Equal("Failed to wake vehicle", display.WakeFailed);
        Assert.Equal("Wake Up", display.WakeLabel);
    }

    // ── Tolerant parsers ─────────────────────────────────────────────────────────────

    [Fact]
    public void Settings_data_parses_the_snake_case_wire_shape()
    {
        var json = Json(
            """
            {
              "settings": [
                { "key": "nickname", "value": "Bolt", "source": "override" },
                { "key": "alerts_muted", "value": true, "source": "default" },
                { "key": "soc_limit", "value": 80, "source": "user" }
              ]
            }
            """);

        var settings = VehicleSettingsData.FromJson(json);

        Assert.NotNull(settings);
        Assert.Equal(3, settings!.Settings.Count);

        var nickname = settings.Find("nickname");
        Assert.NotNull(nickname);
        Assert.Equal("Bolt", nickname!.Value);
        Assert.True(nickname.ValueIsText);
        Assert.Equal("override", nickname.Source);

        var muted = settings.Find("alerts_muted");
        Assert.False(muted!.ValueIsText);
        Assert.Equal(bool.TrueString, muted.Value);

        var soc = settings.Find("soc_limit");
        Assert.Equal("80", soc!.Value);
    }

    [Fact]
    public void Settings_data_from_a_non_object_is_null()
    {
        Assert.Null(VehicleSettingsData.FromJson(Json("[]")));
        Assert.Null(VehicleSettingsData.FromJson(Json("null")));
    }

    [Fact]
    public void Settings_rows_without_a_key_are_dropped()
    {
        var settings = VehicleSettingsData.FromJson(Json("""{ "settings": [ { "value": "x", "source": "user" }, { "key": "ok", "value": "y", "source": "default" } ] }"""));

        Assert.NotNull(settings);
        Assert.Single(settings!.Settings);
        Assert.Equal("ok", settings.Settings[0].Key);
    }

    // ── Generated-client feed request shaping ────────────────────────────────────────

    [Fact]
    public async Task Client_feed_reads_the_settings_for_the_vehicle()
    {
        var api = new FakeApiClient()
            .ReturnsValue(Json("""{ "settings": [ { "key": "nickname", "value": "Bolt", "source": "override" } ] }"""));
        var feed = new VehicleDetailPageClientFeed(api);

        var snapshot = await feed.FetchAsync(7, CancellationToken.None);

        Assert.True(snapshot.HasSettings);
        Assert.Equal("Bolt", snapshot.Settings!.Find("nickname")!.Value);
        Assert.Single(api.Requests);
        Assert.Equal(VehicleDetailPageRegistration.SettingsOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Client_feed_posts_the_wake_command_for_the_vehicle()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{\"status\":\"ok\"}"));
        var feed = new VehicleDetailPageClientFeed(api);

        await feed.WakeAsync(7, CancellationToken.None);

        Assert.Single(api.Requests);
        Assert.Equal(VehicleDetailPageRegistration.WakeOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_snapshot()
    {
        var snapshot = await EmptyVehicleDetailPageFeed.Instance.FetchAsync(7, CancellationToken.None);

        Assert.False(snapshot.HasSettings);
    }

    // ── View-model state folding ─────────────────────────────────────────────────────

    [Fact]
    public async Task View_model_folds_resolved_settings_into_the_success_state()
    {
        var vm = new VehicleDetailPageViewModel(
            new StubFeed(new VehicleDetailSnapshot(Settings(Nickname("Bolt")))),
            Localizer,
            7);

        await vm.LoadAsync();

        Assert.Equal(VehicleDetailState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal("Bolt", vm.Display.EffectiveName);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task View_model_surfaces_a_failed_read_as_the_error_state()
    {
        var vm = new VehicleDetailPageViewModel(new ThrowingFeed(), Localizer, 7);

        await vm.LoadAsync();

        Assert.Equal(VehicleDetailState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task View_model_wake_success_surfaces_the_wake_success_toast()
    {
        var vm = new VehicleDetailPageViewModel(
            new StubFeed(new VehicleDetailSnapshot(Settings(Nickname("Bolt")))),
            Localizer,
            7);
        await vm.LoadAsync();

        await vm.WakeAsync();

        Assert.False(vm.WakeIsError);
        Assert.Equal("Wake command sent", vm.WakeStatus);
        Assert.False(vm.WakeInProgress);
    }

    [Fact]
    public async Task View_model_wake_failure_surfaces_the_api_message()
    {
        var vm = new VehicleDetailPageViewModel(
            new StubFeed(new VehicleDetailSnapshot(Settings(Nickname("Bolt"))), wakeError: new ApiException("vehicle asleep", 408)),
            Localizer,
            7);
        await vm.LoadAsync();

        await vm.WakeAsync();

        Assert.True(vm.WakeIsError);
        Assert.Equal("vehicle asleep", vm.WakeStatus);
    }

    private static VehicleSectionDisplay Section(VehicleDetailDisplay display, string id) =>
        display.Sections.Single(section => section.Id == id);

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class StubFeed(VehicleDetailSnapshot snapshot, ApiException? wakeError = null) : IVehicleDetailPageFeed
    {
        public Task<VehicleDetailSnapshot> FetchAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);

        public Task WakeAsync(long vehicleId, CancellationToken cancellationToken) =>
            wakeError is null ? Task.CompletedTask : throw wakeError;
    }

    private sealed class ThrowingFeed : IVehicleDetailPageFeed
    {
        public Task<VehicleDetailSnapshot> FetchAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new ApiException("boom", 500);

        public Task WakeAsync(long vehicleId, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
