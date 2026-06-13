using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalsWorkspacePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx), the four mandated data-states across the
/// <c>useSignals</c> / <c>useSignalDiffServer</c> sources, the eight headline / compare stat-card values, the 43
/// manifest i18n keys, the view-model's catalog + diff + pin flows, and the generated-client feed's request shaping
/// (the available / pinned / diff reads and the pin / unpin writes). The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="SignalsWorkspaceDisplay"/> flags asserted here.
/// </summary>
public sealed class SignalsWorkspacePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 17, 0, 0, TimeSpan.Zero);

    // The 43 i18n keys the manifest (string-group:telemetry/SignalsWorkspace) requires the page to resolve.
    private static readonly string[] ManifestStringKeys =
    [
        "Per Page", "Time Range", "error.loadFailed", "help.signal.live.aria", "liveMonitor.connected",
        "liveMonitor.disconnected", "liveMonitor.title", "signalDiff.bulk.addAlert", "signalDiff.bulk.csv",
        "signalDiff.bulk.pin", "signalDiff.bulk.unpin", "signalDiff.noChanges", "signalDiff.pinnedCount",
        "signalDiff.pinnedLabel", "signalDiff.totalChanged", "signalDiff.visible", "signalDiff.windowSpan",
        "signalGap.refreshInterval", "signalsWorkspace.addSignals", "signalsWorkspace.chartAuto",
        "signalsWorkspace.chartGrid", "signalsWorkspace.chartMode", "signalsWorkspace.chartOverlay",
        "signalsWorkspace.compare", "signalsWorkspace.emptyDesc", "signalsWorkspace.emptyTitle",
        "signalsWorkspace.exitCompare", "signalsWorkspace.historical", "signalsWorkspace.historyTitle",
        "signalsWorkspace.live", "signalsWorkspace.liveRate", "signalsWorkspace.mode", "signalsWorkspace.noVehicle",
        "signalsWorkspace.noVehicleDesc", "signalsWorkspace.noneSelected", "signalsWorkspace.pinned",
        "signalsWorkspace.run", "signalsWorkspace.selected", "signalsWorkspace.share",
        "signalsWorkspace.signalsSelected", "signalsWorkspace.stopLive", "signalsWorkspace.subtitle",
        "signalsWorkspace.title",
    ];

    private static SignalDiffRow Diff(string name) => new(name, "1", "2", 1, 2, null, null, null, null, true);

    private static SignalsWorkspaceModel Model(
        long vehicleId = 7,
        SignalsWorkspaceDataState catalog = SignalsWorkspaceDataState.Success,
        IReadOnlyList<string>? available = null,
        IReadOnlyList<string>? selected = null,
        IReadOnlySet<string>? pinned = null,
        SignalsWorkspaceMode mode = SignalsWorkspaceMode.Historical,
        bool liveConnected = false,
        int liveRate = 0,
        SignalsWorkspaceDataState diff = SignalsWorkspaceDataState.Empty,
        IReadOnlyList<SignalDiffRow>? diffRows = null,
        string diffSearch = "",
        bool hasHistorical = false) =>
        new(
            vehicleId,
            catalog,
            available ?? ["speed", "soc"],
            selected ?? [],
            pinned ?? new HashSet<string>(),
            mode,
            liveConnected,
            liveRate,
            diff,
            diffRows ?? [],
            diffSearch,
            Now.AddHours(-1),
            Now,
            hasHistorical);

    // ---- i18n key coverage (43 manifest strings) -----------------------------------

    [Fact]
    public void Projection_resolves_all_43_manifest_string_keys_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        _ = SignalsWorkspaceProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_string_key_list_has_the_required_count()
    {
        Assert.Equal(43, ManifestStringKeys.Length);
        Assert.Equal(ManifestStringKeys.Length, ManifestStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_live_mode()
    {
        var recorder = new RecordingLocalizer();

        _ = SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Live, liveConnected: true), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- 11 panels: the 8 stat-card values + the 3 GlassPanel regions ----------------

    [Fact]
    public void Headline_stat_cards_carry_their_values()
    {
        var display = SignalsWorkspaceProjection.Project(
            Model(selected: ["speed", "soc"], pinned: new HashSet<string> { "speed" }, mode: SignalsWorkspaceMode.Live, liveRate: 12, liveConnected: true),
            Localizer);

        Assert.Equal("Selected", display.SelectedLabel);
        Assert.Equal("2", display.SelectedValue);
        Assert.Equal("Mode", display.ModeLabel);
        Assert.Equal("Live", display.ModeValue);
        Assert.Equal("Live rate", display.LiveRateLabel);
        Assert.Equal("12 /s", display.LiveRateValue);
        Assert.Equal("Pinned signals", display.PinnedLabel);
        Assert.Equal("1", display.PinnedValue);
    }

    [Fact]
    public void Mode_value_follows_the_active_toggle()
    {
        Assert.Equal("Historical", SignalsWorkspaceProjection.Project(Model(), Localizer).ModeValue);
        Assert.Equal("Live", SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Live), Localizer).ModeValue);
        Assert.Equal("Compare", SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Compare), Localizer).ModeValue);
    }

    [Fact]
    public void Live_rate_card_is_the_em_dash_outside_live_mode()
    {
        Assert.Equal("\u2014", SignalsWorkspaceProjection.Project(Model(), Localizer).LiveRateValue);
    }

    [Fact]
    public void Compare_stat_cards_count_changed_visible_pinned_and_window_span()
    {
        var rows = new[] { Diff("speed"), Diff("soc"), Diff("power") };
        var display = SignalsWorkspaceProjection.Project(
            Model(
                mode: SignalsWorkspaceMode.Compare,
                diff: SignalsWorkspaceDataState.Success,
                diffRows: rows,
                diffSearch: "s",
                pinned: new HashSet<string> { "speed" }),
            Localizer);

        Assert.Equal("Changed signals", display.ChangedSignalsLabel);
        Assert.Equal("3", display.ChangedSignalsValue);
        Assert.Equal("Visible after filter", display.VisibleLabel);
        Assert.Equal("2", display.VisibleValue); // "s" matches speed + soc, not power
        Assert.Equal("Pinned", display.DiffPinnedLabel);
        Assert.Equal("1", display.DiffPinnedValue);
        Assert.Equal("Window span", display.WindowSpanLabel);
        Assert.Equal("3600 s", display.WindowSpanValue);
    }

    [Fact]
    public void Compare_stat_cards_are_em_dash_while_the_diff_loads()
    {
        var display = SignalsWorkspaceProjection.Project(
            Model(mode: SignalsWorkspaceMode.Compare, diff: SignalsWorkspaceDataState.Loading),
            Localizer);

        Assert.Equal("\u2014", display.ChangedSignalsValue);
        Assert.Equal("\u2014", display.VisibleValue);
    }

    [Fact]
    public void GlassPanel_toolbar_diff_and_empty_regions_carry_their_copy()
    {
        var display = SignalsWorkspaceProjection.Project(Model(), Localizer);

        // GlassPanel5 — workspace toolbar.
        Assert.Equal("Run", display.RunLabel);
        Assert.Equal("Live", display.LiveLabel);
        Assert.Equal("Compare", display.CompareLabel);
        Assert.Equal("Time Range", display.TimeRangeLabel);
        Assert.Equal("Per Page", display.PerPageLabel);

        // GlassPanel10 — compare diff panel.
        Assert.Equal("No signals changed between the two snapshots", display.NoChangesMessage);
        Assert.NotNull(display.DiffDisplay);

        // GlassPanel11 — historical/live empty panel.
        Assert.Equal("Pick signals and run a query", display.EmptyTitle);
        Assert.Contains("Run", display.EmptyDesc, StringComparison.Ordinal);
    }

    // ---- 4 data states (loading / empty / error / success) ---------------------------

    [Fact]
    public void State_loading_when_catalog_query_in_flight()
    {
        var display = SignalsWorkspaceProjection.Project(Model(catalog: SignalsWorkspaceDataState.Loading), Localizer);

        Assert.Equal(SignalsWorkspaceDataState.Loading, display.CatalogState);
        Assert.True(display.ShowCatalogLoading);
        Assert.False(display.ShowNoVehicle);
        Assert.False(display.ShowCatalogError);
    }

    [Fact]
    public void State_empty_when_no_vehicle_selected()
    {
        var display = SignalsWorkspaceProjection.Project(Model(vehicleId: 0), Localizer);

        Assert.True(display.ShowNoVehicle);
        Assert.Equal(SignalsWorkspaceDataState.Empty, display.CatalogState);
        Assert.Equal("Select a vehicle to begin", display.NoVehicleTitle);
        Assert.False(display.ShowError); // no vehicle is not an error
    }

    [Fact]
    public void State_error_surfaces_the_load_failed_banner()
    {
        var display = SignalsWorkspaceProjection.Project(Model(catalog: SignalsWorkspaceDataState.Error), Localizer);

        Assert.True(display.ShowCatalogError);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load data", display.ErrorLoadFailed);
    }

    [Fact]
    public void State_success_when_catalog_resolved_with_signals()
    {
        var display = SignalsWorkspaceProjection.Project(
            Model(catalog: SignalsWorkspaceDataState.Success, available: ["speed"]),
            Localizer);

        Assert.True(display.ShowCatalogSuccess);
        Assert.False(display.ShowNoVehicle);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Diff_states_drive_the_diff_panel_branches()
    {
        Assert.True(SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Compare, diff: SignalsWorkspaceDataState.Loading), Localizer).ShowDiffLoading);
        Assert.True(SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Compare, diff: SignalsWorkspaceDataState.Empty), Localizer).ShowDiffEmpty);
        Assert.True(SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Compare, diff: SignalsWorkspaceDataState.Error), Localizer).ShowDiffError);

        var rows = SignalsWorkspaceProjection.Project(
            Model(mode: SignalsWorkspaceMode.Compare, diff: SignalsWorkspaceDataState.Success, diffRows: [Diff("speed")]),
            Localizer);
        Assert.True(rows.ShowDiffRows);
        Assert.Single(rows.DiffDisplay.Rows);
    }

    // ---- Mode switch + chart-tab gate ------------------------------------------------

    [Fact]
    public void Compare_mode_shows_the_compare_section_and_hides_historical()
    {
        var display = SignalsWorkspaceProjection.Project(Model(mode: SignalsWorkspaceMode.Compare), Localizer);

        Assert.True(display.IsCompare);
        Assert.False(display.IsLive);
    }

    [Fact]
    public void Chart_mode_tabs_gate_on_two_or_more_selected_signals()
    {
        Assert.False(SignalsWorkspaceProjection.Project(Model(selected: ["one"]), Localizer).ShowChartModeTabs);
        Assert.True(SignalsWorkspaceProjection.Project(Model(selected: ["one", "two"]), Localizer).ShowChartModeTabs);
    }

    [Fact]
    public void Historical_empty_panel_shows_until_a_run_with_a_selection()
    {
        Assert.True(SignalsWorkspaceProjection.Project(Model(selected: ["speed"]), Localizer).ShowHistoricalEmpty);
        Assert.True(SignalsWorkspaceProjection.Project(Model(selected: ["speed"], hasHistorical: true), Localizer).ShowHistoryResults);
    }

    [Fact]
    public void Selection_badge_interpolates_the_count_or_falls_back()
    {
        Assert.Equal("None selected", SignalsWorkspaceProjection.Project(Model(selected: []), Localizer).SignalsSelectedBadge);
        Assert.Equal("2 selected", SignalsWorkspaceProjection.Project(Model(selected: ["a", "b"]), Localizer).SignalsSelectedBadge);
    }

    // ---- View-model state machine ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_the_catalog_into_the_success_state()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed", "soc"] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowCatalogSuccess);
        Assert.Equal(1, feed.AvailableCount);
        Assert.Equal(1, feed.PinnedCount);
    }

    [Fact]
    public async Task ViewModel_empty_catalog_is_the_empty_state()
    {
        var feed = new FakeWorkspaceFeed { Available = [] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);

        await vm.LoadAsync();

        Assert.Equal(SignalsWorkspaceDataState.Empty, vm.Display.CatalogState);
    }

    [Fact]
    public async Task ViewModel_catalog_failure_is_the_error_state()
    {
        var feed = new FakeWorkspaceFeed { AvailableThrows = true };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowCatalogError);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_skips_the_fetch_and_shows_the_empty_state()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed"] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 0);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowNoVehicle);
        Assert.Equal(0, feed.AvailableCount);
    }

    [Fact]
    public async Task ViewModel_compare_toggle_fetches_the_diff()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed"], Diff = [Diff("speed")] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.ToggleCompareAsync();

        Assert.True(vm.Display.IsCompare);
        Assert.Equal(1, feed.DiffCount);
        Assert.True(vm.Display.ShowDiffRows);
    }

    [Fact]
    public async Task ViewModel_live_and_compare_are_mutually_exclusive()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed"] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.ToggleLiveAsync();
        Assert.Equal(SignalsWorkspaceMode.Live, vm.Mode);

        await vm.ToggleCompareAsync();
        Assert.Equal(SignalsWorkspaceMode.Compare, vm.Mode);
        Assert.False(vm.Display.IsLive);
    }

    [Fact]
    public async Task ViewModel_live_update_feeds_the_rate_card_and_badge()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed"] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();
        await vm.ToggleLiveAsync();

        vm.UpdateLiveState(connected: true, rate: 9);

        Assert.True(vm.Display.LiveBadgeConnected);
        Assert.Equal("9 /s", vm.Display.LiveRateValue);
    }

    [Fact]
    public async Task ViewModel_toggle_pin_calls_the_feed_and_reloads_pins()
    {
        var feed = new FakeWorkspaceFeed { Available = ["speed"] };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.TogglePinAsync("speed", pin: true);

        Assert.Equal(1, feed.PinCount);
        Assert.Equal("signal:speed", feed.LastPinItemId);
        Assert.Equal(2, feed.PinnedCount); // initial load + reload after the pin
    }

    [Fact]
    public async Task ViewModel_unpin_deletes_by_the_existing_pin_id()
    {
        var feed = new FakeWorkspaceFeed
        {
            Available = ["speed"],
            Pinned = [new PinnedSignal("42", "speed")],
        };
        using var vm = new SignalsWorkspacePageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.TogglePinAsync("speed", pin: false);

        Assert.Equal(1, feed.UnpinCount);
        Assert.Equal("42", feed.LastUnpinId);
    }

    // ---- Generated-client feed (web hooks) -------------------------------------------

    [Fact]
    public async Task ClientFeed_available_sends_the_op_and_parses_strings_and_objects()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signals\":[\"speed\",{\"name\":\"soc\"},{\"nope\":1}]}"));
        var feed = new SignalsWorkspaceClientFeed(api);

        var result = await feed.FetchAvailableAsync(7, default);

        Assert.Equal(new[] { "speed", "soc" }, result);
        Assert.Equal("get_api_v1_signals_vehicleID_available", Assert.Single(api.Requests).OperationId);
        Assert.Equal("7", Assert.Single(api.Requests).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_pinned_sends_the_op_and_keeps_only_signal_rows()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":3,\"item_id\":\"signal:speed\"},{\"id\":4,\"item_id\":\"widget:foo\"}]"));
        var feed = new SignalsWorkspaceClientFeed(api);

        var result = await feed.FetchPinnedAsync(7, default);

        var pin = Assert.Single(result);
        Assert.Equal("3", pin.Id);
        Assert.Equal("speed", pin.Name);
        Assert.Equal("get_api_v1_pinned", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_diff_sends_the_op_and_parses_rows()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":[{\"name\":\"speed\",\"value_a\":1,\"value_b\":2,\"changed\":true}]}"));
        var feed = new SignalsWorkspaceClientFeed(api);

        var result = await feed.FetchDiffAsync(7, default);

        Assert.Equal("speed", Assert.Single(result).Name);
        Assert.Equal("get_api_v1_signals_vehicleID_diff", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_pin_posts_the_item_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new SignalsWorkspaceClientFeed(api);

        await feed.PinAsync("signal:speed", "signal-diff:vehicle:7", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_pinned", request.OperationId);
        var body = Assert.IsType<Dictionary<string, object?>>(request.Body);
        Assert.Equal("signal:speed", body["item_id"]);
        Assert.Equal("widget", body["item_type"]);
        Assert.Equal("signal-diff:vehicle:7", body["context"]);
    }

    [Fact]
    public async Task ClientFeed_unpin_deletes_by_id_path_parameter()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new SignalsWorkspaceClientFeed(api);

        await feed.UnpinAsync("9", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_pinned_id", request.OperationId);
        Assert.Equal("9", request.PathParams!["id"]);
    }

    // ---- Registration + diagnostics --------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_operations()
    {
        Assert.Equal("SignalsWorkspace", SignalsWorkspaceRegistration.RouteName);
        Assert.Equal("SignalsWorkspacePage", SignalsWorkspaceRegistration.Slug);
        Assert.Equal("get_api_v1_signals_vehicleID_available", SignalsWorkspaceRegistration.AvailableOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_diff", SignalsWorkspaceRegistration.DiffOperation);
        Assert.Equal("get_api_v1_pinned", SignalsWorkspaceRegistration.PinnedListOperation);
        Assert.Equal("post_api_v1_pinned", SignalsWorkspaceRegistration.PinCreateOperation);
        Assert.Equal("delete_api_v1_pinned_id", SignalsWorkspaceRegistration.PinDeleteOperation);
        Assert.Equal("signal-diff:vehicle:7", SignalsWorkspaceRegistration.PinContext(7));
    }

    [Fact]
    public void Every_registered_operation_resolves_against_the_generated_table()
    {
        var api = new FakeApiClient();
        foreach (var op in new[]
        {
            SignalsWorkspaceRegistration.AvailableOperation,
            SignalsWorkspaceRegistration.DiffOperation,
            SignalsWorkspaceRegistration.PinnedListOperation,
            SignalsWorkspaceRegistration.PinCreateOperation,
            SignalsWorkspaceRegistration.PinDeleteOperation,
        })
        {
            Assert.Equal(op, api.ResolveEndpoint(op).OperationId);
        }
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SignalsWorkspaceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalsWorkspacePage", Assert.Single(lines));
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

    private sealed class FakeWorkspaceFeed : ISignalsWorkspaceFeed
    {
        public IReadOnlyList<string> Available { get; set; } = [];

        public IReadOnlyList<PinnedSignal> Pinned { get; set; } = [];

        public IReadOnlyList<SignalDiffRow> Diff { get; set; } = [];

        public bool AvailableThrows { get; set; }

        public int AvailableCount { get; private set; }

        public int PinnedCount { get; private set; }

        public int DiffCount { get; private set; }

        public int PinCount { get; private set; }

        public int UnpinCount { get; private set; }

        public string? LastPinItemId { get; private set; }

        public string? LastUnpinId { get; private set; }

        public Task<IReadOnlyList<string>> FetchAvailableAsync(long vehicleId, CancellationToken cancellationToken)
        {
            AvailableCount++;
            if (AvailableThrows)
            {
                throw new InvalidOperationException("boom");
            }

            return Task.FromResult(Available);
        }

        public Task<IReadOnlyList<PinnedSignal>> FetchPinnedAsync(long vehicleId, CancellationToken cancellationToken)
        {
            PinnedCount++;
            return Task.FromResult(Pinned);
        }

        public Task<IReadOnlyList<SignalDiffRow>> FetchDiffAsync(long vehicleId, CancellationToken cancellationToken)
        {
            DiffCount++;
            return Task.FromResult(Diff);
        }

        public Task PinAsync(string itemId, string context, CancellationToken cancellationToken)
        {
            PinCount++;
            LastPinItemId = itemId;
            return Task.CompletedTask;
        }

        public Task UnpinAsync(string existingId, CancellationToken cancellationToken)
        {
            UnpinCount++;
            LastUnpinId = existingId;
            return Task.CompletedTask;
        }
    }
}
