using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RedisSignalViewerPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/RedisSignalViewerPage.tsx): the four web data states
/// (loading / empty / error / success), the GlassPanel1 controls, the four stat tiles, the diagnostic chips, the
/// table body branches (select-prompt / loading / no-match / no-signals / rows), the destructive-purge state
/// machine, the tolerant vehicle / snapshot / purge parsers, the signal classifier, the view-model and the
/// generated-client feed's request shaping (web <c>useVehicles</c> + <c>getRedisSignals</c> + the purge DELETEs).
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="RedisSignalViewerDisplay"/> flags asserted here.
/// </summary>
public sealed class RedisSignalViewerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 41 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "common.cancel",
        "redis.allCategories",
        "redis.autoRefresh",
        "redis.booleans",
        "redis.category",
        "redis.headerChip.l1Seen",
        "redis.headerChip.mode",
        "redis.maskedCoord",
        "redis.noMatch",
        "redis.numbers",
        "redis.purgeAllButton",
        "redis.purgeAllButtonTitle",
        "redis.purgeAllConfirm",
        "redis.purgeAllMessage",
        "redis.purgeAllPartial",
        "redis.purgeAllPartialDetail",
        "redis.purgeAllSuccess",
        "redis.purgeAllSuccessDetail",
        "redis.purgeAllTitle",
        "redis.purgeAllTypedLabel",
        "redis.purgeButton",
        "redis.purgeButtonTitle",
        "redis.purgeConfirm",
        "redis.purgeError",
        "redis.purgeMessage",
        "redis.purgeNoOpDetail",
        "redis.purgeNoOpTitle",
        "redis.purgeSuccess",
        "redis.purgeSuccessDetail",
        "redis.purgeTitle",
        "redis.refresh",
        "redis.searchPlaceholder", // parity:allow web i18n key name redis.searchPlaceholder
        "redis.selectPrompt",
        "redis.selectVehicle",
        "redis.signalName",
        "redis.strings",
        "redis.subtitle",
        "redis.title",
        "redis.totalSignals",
        "redis.type",
        "redis.value",
    ];

    private static RedisSignalEntry Sig(
        string name,
        RedisSignalValueType type = RedisSignalValueType.Number,
        string value = "1") =>
        new(name, value, type, RedisSignalClassifier.Categorize(name), RedisSignalClassifier.IsLocationSignal(name));

    private static RedisSignalsSnapshot Snapshot(params RedisSignalEntry[] entries) =>
        new(7, entries.Length, entries, null);

    private static RedisSignalViewerModel Model(
        long? selected = 7,
        RedisSignalsSnapshot? snapshot = null,
        string search = "",
        string category = RedisCategoryFilter.All,
        bool loading = false,
        bool isFetching = false,
        bool hasError = false,
        string? errorDetail = null,
        bool autoRefresh = false,
        IReadOnlyList<RedisSignalViewerVehicle>? vehicles = null,
        RedisPurgeMode purgeMode = RedisPurgeMode.None,
        string purgeLabel = "",
        bool isPurging = false) =>
        new(
            Vehicles: vehicles ?? [new RedisSignalViewerVehicle(7, "Model 3", null)],
            SelectedVehicleId: selected,
            Search: search,
            CategoryFilter: category,
            AutoRefresh: autoRefresh,
            Snapshot: snapshot,
            Loading: loading,
            IsFetching: isFetching,
            HasError: hasError,
            ErrorDetail: errorDetail,
            PurgeMode: purgeMode,
            PurgeTargetLabel: purgeLabel,
            IsPurging: isPurging);

    // ---- Projection: data-state matrix ---------------------------------------------

    [Fact]
    public void Projection_no_vehicle_is_the_empty_state_with_the_select_prompt()
    {
        var display = RedisSignalViewerProjection.Project(Model(selected: null), Localizer);

        Assert.Equal(RedisSignalViewerState.Empty, display.State);
        Assert.True(display.ShowSelectPrompt);
        Assert.False(display.ShowStats);
        Assert.False(display.ShowTable);
        Assert.Equal("Select a vehicle to view its cached Redis signals", display.SelectPromptMessage);
    }

    [Fact]
    public void Projection_loading_is_the_loading_state()
    {
        var display = RedisSignalViewerProjection.Project(Model(loading: true), Localizer);

        Assert.Equal(RedisSignalViewerState.Loading, display.State);
        Assert.True(display.ShowTableLoading);
        Assert.True(display.ShowStats);
        Assert.False(display.ShowTable);
        // web: the stat tiles show the em-dash fallback while loading.
        Assert.Equal("\u2014", display.StatCards[0].Value);
    }

    [Fact]
    public void Projection_error_is_the_error_state_with_the_load_failed_banner()
    {
        var display = RedisSignalViewerProjection.Project(Model(hasError: true, errorDetail: "boom"), Localizer);

        Assert.Equal(RedisSignalViewerState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Equal("\u2014", display.StatCards[1].Value);
    }

    [Fact]
    public void Projection_with_rows_is_the_success_state_and_renders_the_table()
    {
        var display = RedisSignalViewerProjection.Project(
            Model(snapshot: Snapshot(Sig("BatteryLevel"), Sig("Gear", RedisSignalValueType.Text, "Drive"))),
            Localizer);

        Assert.Equal(RedisSignalViewerState.Success, display.State);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowSelectPrompt);
        Assert.False(display.ShowNoSignals);
        Assert.Equal(2, display.Rows.Count);
        Assert.Equal(4, display.ColumnHeaders.Count);
    }

    [Fact]
    public void Projection_selected_vehicle_with_no_signals_is_the_no_signals_empty_state()
    {
        var display = RedisSignalViewerProjection.Project(Model(snapshot: Snapshot()), Localizer);

        Assert.Equal(RedisSignalViewerState.Empty, display.State);
        Assert.True(display.ShowNoSignals);
        Assert.False(display.ShowTable);
        Assert.Equal("No signals cached for this vehicle", display.NoSignalsMessage);
    }

    [Fact]
    public void Projection_filter_with_no_match_is_the_no_match_empty_state()
    {
        var display = RedisSignalViewerProjection.Project(
            Model(snapshot: Snapshot(Sig("BatteryLevel")), search: "zzz"),
            Localizer);

        Assert.True(display.ShowNoMatch);
        Assert.False(display.ShowTable);
        Assert.Equal("No signals match the current filter", display.NoMatchMessage);
    }

    // ---- Projection: stats, categories, chips, masking -----------------------------

    [Fact]
    public void Projection_counts_each_value_type_into_the_stat_tiles()
    {
        var snapshot = new RedisSignalsSnapshot(7, 4, new[]
        {
            Sig("Speed", RedisSignalValueType.Number),
            Sig("Range", RedisSignalValueType.Number),
            Sig("Gear", RedisSignalValueType.Text, "Drive"),
            Sig("Locked", RedisSignalValueType.Boolean, "true"),
        }, null);

        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot), Localizer);

        Assert.Equal("Total Signals", display.StatCards[0].Label);
        Assert.Equal("4", display.StatCards[0].Value);
        Assert.Equal("2", display.StatCards[1].Value); // Numbers
        Assert.Equal("1", display.StatCards[2].Value); // Strings
        Assert.Equal("1", display.StatCards[3].Value); // Booleans
    }

    [Fact]
    public void Projection_category_options_carry_live_counts()
    {
        var snapshot = Snapshot(Sig("battery_level"), Sig("charge_state"), Sig("vehicle_speed"));
        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot), Localizer);

        Assert.Equal(6, display.CategoryOptions.Count);
        Assert.Equal("all", display.CategoryOptions[0].Value);
        Assert.Equal("All Categories", display.CategoryOptions[0].Label);
        Assert.Equal("Battery (1)", display.CategoryOptions[1].Label);
        Assert.Equal("Charging (1)", display.CategoryOptions[2].Label);
        Assert.Equal("Driving (1)", display.CategoryOptions[3].Label);
    }

    [Fact]
    public void Projection_category_filter_restricts_the_rows()
    {
        var snapshot = Snapshot(Sig("battery_level"), Sig("charge_state"));
        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot, category: "Battery"), Localizer);

        Assert.True(display.ShowTable);
        Assert.Single(display.Rows);
        Assert.Equal("battery_level", display.Rows[0].Name);
        Assert.Equal("Battery", display.Rows[0].CategoryLabel);
    }

    [Fact]
    public void Projection_masks_location_signals_by_default()
    {
        var snapshot = Snapshot(Sig("latitude", RedisSignalValueType.Number, "37.4419"));
        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.True(row.IsMasked);
        Assert.Equal("\u2022\u2022.\u2022\u2022\u2022\u2022", row.Value); // digits replaced, the dot preserved
        Assert.Equal("37.4419", row.RawValue);
        Assert.Equal("Coordinate, click to reveal", display.MaskedCoordLabel);
    }

    [Fact]
    public void Projection_diagnostic_chips_reflect_the_meta_block()
    {
        var meta = new RedisSignalsMeta("hybrid", "5YJ3E1EA7KF000000", "2026-06-12T17:30:00Z", null);
        var snapshot = new RedisSignalsSnapshot(7, 1, new[] { Sig("BatteryLevel") }, meta);

        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot), Localizer);

        Assert.True(display.ShowDiagnosticChips);
        Assert.Equal(StatusKind.Success, display.ModeChipVariant);
        Assert.Contains("hybrid", display.ModeChipText, StringComparison.Ordinal);
        Assert.True(display.ShowVinChip);
        Assert.Equal("5YJ3E1EA7KF000000", display.VinChipText);
        Assert.True(display.ShowL1Chip);
    }

    [Fact]
    public void Projection_local_mode_chip_is_danger_tinted()
    {
        var meta = new RedisSignalsMeta("local", null, null, null);
        var snapshot = new RedisSignalsSnapshot(7, 1, new[] { Sig("BatteryLevel") }, meta);

        var display = RedisSignalViewerProjection.Project(Model(snapshot: snapshot), Localizer);

        Assert.Equal(StatusKind.Danger, display.ModeChipVariant);
        Assert.False(display.ShowVinChip);
        Assert.False(display.ShowL1Chip);
    }

    // ---- Projection: purge dialog --------------------------------------------------

    [Fact]
    public void Projection_purge_one_dialog_names_the_vehicle()
    {
        var display = RedisSignalViewerProjection.Project(
            Model(purgeMode: RedisPurgeMode.One, purgeLabel: "Model 3"),
            Localizer);

        Assert.True(display.ShowPurgeDialog);
        Assert.False(display.PurgeRequiresTypedConfirmation);
        Assert.Contains("Model 3", display.PurgeDialogTitle, StringComparison.Ordinal);
        Assert.Equal("Purge Redis (L2)", display.PurgeConfirmLabel);
        Assert.Equal("Cancel", display.PurgeCancelLabel);
    }

    [Fact]
    public void Projection_purge_all_dialog_requires_a_typed_confirmation()
    {
        var display = RedisSignalViewerProjection.Project(Model(purgeMode: RedisPurgeMode.All), Localizer);

        Assert.True(display.ShowPurgeDialog);
        Assert.True(display.PurgeRequiresTypedConfirmation);
        Assert.Equal("Purge ALL Redis (L2) caches?", display.PurgeDialogTitle);
        Assert.Equal("Purge All Vehicles", display.PurgeConfirmLabel);
        Assert.Equal("Type PURGE ALL to confirm", display.PurgeTypedConfirmationLabel);
    }

    // ---- Classifier ----------------------------------------------------------------

    [Theory]
    [InlineData("battery_level", RedisSignalCategory.Battery)]
    [InlineData("bms_state", RedisSignalCategory.Battery)]
    [InlineData("charge_state", RedisSignalCategory.Charging)]
    [InlineData("ac_charging_power", RedisSignalCategory.Charging)]
    [InlineData("vehicle_speed", RedisSignalCategory.Driving)]
    [InlineData("odometer", RedisSignalCategory.Driving)]
    [InlineData("inside_temp", RedisSignalCategory.Climate)]
    [InlineData("hvac_state", RedisSignalCategory.Climate)]
    [InlineData("door_state", RedisSignalCategory.Other)]
    public void Classifier_buckets_signal_names(string name, RedisSignalCategory expected) =>
        Assert.Equal(expected, RedisSignalClassifier.Categorize(name));

    [Theory]
    [InlineData("latitude", true)]
    [InlineData("longitude", true)]
    [InlineData("gps_latitude", true)]
    [InlineData("battery_level", false)]
    public void Classifier_flags_location_signals(string name, bool expected) =>
        Assert.Equal(expected, RedisSignalClassifier.IsLocationSignal(name));

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void VehicleParseList_reads_id_display_name_and_vin_fallback()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":7,\"display_name\":\"Model 3\"},{\"id\":8,\"vin\":\"5YJ3E1EA7KF001234\"},{\"id\":9}]");

        var list = RedisSignalViewerVehicle.ParseList(doc.RootElement);

        Assert.Equal(3, list.Count);
        Assert.Equal("Model 3", list[0].Label);
        Assert.Equal("5YJ3E1EA7KF001234", list[1].Label);
        Assert.Equal("Vehicle 9", list[2].Label);
    }

    [Fact]
    public void SnapshotFromJson_classifies_values_sorts_and_reads_meta()
    {
        using var doc = JsonDocument.Parse(
            "{\"vehicle_id\":7,\"signal_count\":3,\"signals\":{" +
            "\"Gear\":{\"value\":\"Drive\",\"type\":\"string\"}," +
            "\"BatteryLevel\":{\"value\":80,\"type\":\"number\"}," +
            "\"Locked\":{\"value\":true,\"type\":\"boolean\"}}," +
            "\"meta\":{\"live_signal_store_mode\":\"hybrid\",\"vehicle_vin\":\"5YJ\",\"l1_last_seen_at\":\"2026-06-12T17:30:00Z\"}}");

        var snapshot = RedisSignalsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(7, snapshot.VehicleId);
        Assert.Equal(3, snapshot.SignalCount);
        Assert.Equal(3, snapshot.Signals.Count);
        // sorted by name (case-insensitive): BatteryLevel, Gear, Locked.
        Assert.Equal("BatteryLevel", snapshot.Signals[0].Name);
        Assert.Equal("80", snapshot.Signals[0].Value);
        Assert.Equal(RedisSignalValueType.Number, snapshot.Signals[0].Type);
        Assert.Equal("Drive", snapshot.Signals[1].Value);
        Assert.Equal(RedisSignalValueType.Text, snapshot.Signals[1].Type);
        Assert.Equal("true", snapshot.Signals[2].Value);
        Assert.Equal(RedisSignalValueType.Boolean, snapshot.Signals[2].Type);
        Assert.NotNull(snapshot.Meta);
        Assert.Equal("hybrid", snapshot.Meta!.LiveSignalStoreMode);
    }

    [Fact]
    public void SnapshotFromJson_tolerates_a_non_object_envelope()
    {
        using var doc = JsonDocument.Parse("[]");
        var snapshot = RedisSignalsSnapshot.FromJson(doc.RootElement);
        Assert.Empty(snapshot.Signals);
    }

    [Fact]
    public void PurgeResultsFromJson_read_the_flags()
    {
        using var one = JsonDocument.Parse("{\"vehicle_id\":7,\"purged\":true}");
        Assert.True(RedisPurgeResult.FromJson(one.RootElement).Purged);

        using var all = JsonDocument.Parse("{\"purged\":3,\"scanned\":3,\"limit\":1000,\"has_more\":true}");
        var result = RedisPurgeAllResult.FromJson(all.RootElement);
        Assert.Equal(3, result.Purged);
        Assert.Equal(1000, result.Limit);
        Assert.True(result.HasMore);
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_empty()
    {
        using var vm = new RedisSignalViewerPageViewModel(EmptyRedisSignalViewerFeed.Instance, Localizer);
        Assert.Equal(RedisSignalViewerState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_load_populates_the_picker_without_auto_selecting()
    {
        var feed = new FakeRedisFeed([new RedisSignalViewerVehicle(42, "Model S", null)], Snapshot(Sig("BatteryLevel")));
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Null(vm.SelectedVehicleId);
        Assert.Equal(RedisSignalViewerState.Empty, vm.State);
        Assert.True(vm.Display.ShowSelectPrompt);
        Assert.Single(vm.Display.VehicleOptions);
        Assert.Equal(0, feed.SignalsFetches);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_loads_its_signals_into_success()
    {
        var feed = new FakeRedisFeed(
            [new RedisSignalViewerVehicle(42, "Model S", null)],
            Snapshot(Sig("BatteryLevel"), Sig("Gear", RedisSignalValueType.Text, "Drive")));
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(42);

        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastSignalsVehicleId);
        Assert.Equal(RedisSignalViewerState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_signals_failure_is_the_error_state()
    {
        var feed = new ThrowingSignalsFeed([new RedisSignalViewerVehicle(1, "A", null)]);
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(1);

        Assert.Equal(RedisSignalViewerState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_search_and_category_filter_without_a_refetch()
    {
        var feed = new FakeRedisFeed(
            [new RedisSignalViewerVehicle(1, "A", null)],
            Snapshot(Sig("battery_level"), Sig("charge_state")));
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(1);
        int fetchesAfterSelect = feed.SignalsFetches;

        vm.SetSearch("battery");

        Assert.Single(vm.Display.Rows);
        Assert.Equal("battery_level", vm.Display.Rows[0].Name);
        Assert.Equal(fetchesAfterSelect, feed.SignalsFetches);
    }

    [Fact]
    public async Task ViewModel_purge_one_succeeds_and_surfaces_the_success_notice()
    {
        var feed = new FakeRedisFeed([new RedisSignalViewerVehicle(1, "A", null)], Snapshot(Sig("BatteryLevel")))
        {
            NextPurge = new RedisPurgeResult(true),
        };
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(1);

        vm.OpenPurgeOne();
        Assert.True(vm.Display.ShowPurgeDialog);

        await vm.ConfirmPurgeAsync();

        Assert.Equal(1, feed.PurgeCalls);
        Assert.Equal(1L, feed.LastPurgeVehicleId);
        Assert.True(vm.PurgeNotice.Show);
        Assert.Equal(CalloutVariant.Success, vm.PurgeNotice.Variant);
        Assert.False(vm.Display.ShowPurgeDialog);
    }

    [Fact]
    public async Task ViewModel_purge_one_no_op_surfaces_the_info_notice()
    {
        var feed = new FakeRedisFeed([new RedisSignalViewerVehicle(1, "A", null)], Snapshot(Sig("BatteryLevel")))
        {
            NextPurge = new RedisPurgeResult(false),
        };
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(1);

        vm.OpenPurgeOne();
        await vm.ConfirmPurgeAsync();

        Assert.Equal(CalloutVariant.Info, vm.PurgeNotice.Variant);
        Assert.Equal("Nothing to purge", vm.PurgeNotice.Title);
    }

    [Fact]
    public async Task ViewModel_purge_all_partial_surfaces_a_warning_notice()
    {
        var feed = new FakeRedisFeed([new RedisSignalViewerVehicle(1, "A", null)], Snapshot(Sig("BatteryLevel")))
        {
            NextPurgeAll = new RedisPurgeAllResult(1000, 1000, 1000, true),
        };
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.OpenPurgeAll();
        await vm.ConfirmPurgeAsync();

        Assert.Equal(1, feed.PurgeAllCalls);
        Assert.Equal(CalloutVariant.Warning, vm.PurgeNotice.Variant);
        Assert.Equal("Redis L2 cache partially purged", vm.PurgeNotice.Title);
    }

    [Fact]
    public async Task ViewModel_purge_failure_surfaces_a_danger_notice()
    {
        var feed = new ThrowingPurgeFeed([new RedisSignalViewerVehicle(1, "A", null)], Snapshot(Sig("BatteryLevel")));
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(1);

        vm.OpenPurgeOne();
        await vm.ConfirmPurgeAsync();

        Assert.Equal(CalloutVariant.Danger, vm.PurgeNotice.Variant);
        Assert.Equal("Purge failed", vm.PurgeNotice.Title);
    }

    [Fact]
    public async Task ViewModel_cancel_purge_closes_the_dialog()
    {
        var feed = new FakeRedisFeed([new RedisSignalViewerVehicle(1, "A", null)], Snapshot(Sig("BatteryLevel")));
        using var vm = new RedisSignalViewerPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(1);

        vm.OpenPurgeOne();
        vm.CancelPurge();

        Assert.False(vm.Display.ShowPurgeDialog);
        Assert.Equal(0, feed.PurgeCalls);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new RedisSignalViewerClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
    }

    [Fact]
    public async Task ClientFeed_signals_sends_the_snake_case_vehicle_id_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"vehicle_id\":7,\"signal_count\":1,\"signals\":{\"BatteryLevel\":{\"value\":80,\"type\":\"number\"}}}"));
        var feed = new RedisSignalViewerClientFeed(api);

        var snapshot = await feed.FetchSignalsAsync(7, default);

        Assert.Single(snapshot.Signals);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_dev_tools_redis_signals", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("7", request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task ClientFeed_purge_sends_the_delete_operation_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"vehicle_id\":7,\"purged\":true}"));
        var feed = new RedisSignalViewerClientFeed(api);

        var result = await feed.PurgeAsync(7, default);

        Assert.True(result.Purged);
        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_dev_tools_redis_signals", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task ClientFeed_purge_all_sends_the_keys_delete_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"purged\":3,\"scanned\":3,\"limit\":1000,\"has_more\":false}"));
        var feed = new RedisSignalViewerClientFeed(api);

        var result = await feed.PurgeAllAsync(default);

        Assert.Equal(3, result.Purged);
        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_dev_tools_redis_signals_keys", request.OperationId);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new RedisSignalViewerClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchSignalsAsync(7, default));
    }

    // ---- Diagnostics + registration + i18n -----------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new RedisSignalViewerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RedisSignalViewerPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("RedisSignalViewer", RedisSignalViewerRegistration.RouteName);
        Assert.Equal("RedisSignalViewerPage", RedisSignalViewerRegistration.Slug);
        Assert.Equal("get_api_v1_vehicles", RedisSignalViewerRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_dev_tools_redis_signals", RedisSignalViewerRegistration.SignalsOperation);
        Assert.Equal("delete_api_v1_dev_tools_redis_signals", RedisSignalViewerRegistration.PurgeOperation);
        Assert.Equal("delete_api_v1_dev_tools_redis_signals_keys", RedisSignalViewerRegistration.PurgeAllOperation);
        Assert.Equal("vehicle_id", RedisSignalViewerRegistration.VehicleIdQueryParam);
        Assert.Equal("Redis Signal Viewer", RedisSignalViewerRegistration.Title(Localizer));
        Assert.Equal("Inspect cached signal values in Redis", RedisSignalViewerRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void RegistrationOperations_resolve_against_the_generated_endpoint_table()
    {
        AssertOperationExists(RedisSignalViewerRegistration.VehiclesOperation);
        AssertOperationExists(RedisSignalViewerRegistration.SignalsOperation);
        AssertOperationExists(RedisSignalViewerRegistration.PurgeOperation);
        AssertOperationExists(RedisSignalViewerRegistration.PurgeAllOperation);
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        RedisSignalViewerProjection.Project(Model(purgeMode: RedisPurgeMode.One, purgeLabel: "Model 3"), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        Assert.Equal(41, RequiredStringKeys.Length);
    }

    private static void AssertOperationExists(string operationId) =>
        Assert.Contains(
            TeslaSync.Windows.Generated.Api.ApiEndpoints.All,
            e => string.Equals(e.OperationId, operationId, StringComparison.Ordinal));

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private class FakeRedisFeed : IRedisSignalViewerFeed
    {
        private readonly IReadOnlyList<RedisSignalViewerVehicle> _vehicles;
        private readonly RedisSignalsSnapshot _snapshot;

        public FakeRedisFeed(IReadOnlyList<RedisSignalViewerVehicle> vehicles, RedisSignalsSnapshot snapshot)
        {
            _vehicles = vehicles;
            _snapshot = snapshot;
        }

        public RedisPurgeResult NextPurge { get; set; } = new(true);

        public RedisPurgeAllResult NextPurgeAll { get; set; } = new(0, 0, 0, false);

        public int SignalsFetches { get; private set; }

        public int PurgeCalls { get; private set; }

        public int PurgeAllCalls { get; private set; }

        public long? LastSignalsVehicleId { get; private set; }

        public long? LastPurgeVehicleId { get; private set; }

        public Task<IReadOnlyList<RedisSignalViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public virtual Task<RedisSignalsSnapshot> FetchSignalsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            SignalsFetches++;
            LastSignalsVehicleId = vehicleId;
            return Task.FromResult(_snapshot);
        }

        public virtual Task<RedisPurgeResult> PurgeAsync(long vehicleId, CancellationToken cancellationToken)
        {
            PurgeCalls++;
            LastPurgeVehicleId = vehicleId;
            return Task.FromResult(NextPurge);
        }

        public Task<RedisPurgeAllResult> PurgeAllAsync(CancellationToken cancellationToken)
        {
            PurgeAllCalls++;
            return Task.FromResult(NextPurgeAll);
        }
    }

    private sealed class ThrowingSignalsFeed : FakeRedisFeed
    {
        public ThrowingSignalsFeed(IReadOnlyList<RedisSignalViewerVehicle> vehicles)
            : base(vehicles, RedisSignalsSnapshot.Empty)
        {
        }

        public override Task<RedisSignalsSnapshot> FetchSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new ApiException("boom", 500);
    }

    private sealed class ThrowingPurgeFeed : FakeRedisFeed
    {
        public ThrowingPurgeFeed(IReadOnlyList<RedisSignalViewerVehicle> vehicles, RedisSignalsSnapshot snapshot)
            : base(vehicles, snapshot)
        {
        }

        public override Task<RedisPurgeResult> PurgeAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new ApiException("boom", 500);
    }
}
