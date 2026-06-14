using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalExplorerPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/SignalExplorerPage.tsx): the four web data states
/// (loading / empty / error / success), the no-vehicle guard, the GlassPanel1 explore controls, the Live toggle +
/// connection badge, the deferred-Explore results region (the <c>historicalStats</c> / <c>chartData</c> memos and
/// the SignalHistoryTable port), the tolerant vehicle / available-signal / history parsers, the view-model's state
/// machine, and the generated-client feed's request shaping (web <c>useSelectedVehicle</c> + <c>useSignals</c> + the
/// per-signal history <c>useQuery</c>). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the <see cref="SignalExplorerDisplay"/> flags asserted here.
/// </summary>
public sealed class SignalExplorerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);
    private static readonly DateRange Today = new(new DateOnly(2026, 6, 12), new DateOnly(2026, 6, 12));

    // The 15 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "Choose up to 5 signals, set a date range, then hit Explore \u2014 or toggle Live to stream in real time.",
        "Explore",
        "Per Page",
        "Pick signals and click Explore",
        "Signal Explorer",
        "Time Range",
        "Visualise signal history with chart and stats \u2014 or stream live",
        "error.loadFailed",
        "help.signal.live.aria",
        "liveMonitor.connected",
        "liveMonitor.disconnected",
        "signalExplorer.live",
        "signalExplorer.noVehicle",
        "signalExplorer.noVehicleDesc",
        "signalExplorer.stopLive",
    ];

    private static SignalExplorerEntry Entry(
        string ts = "2026-06-12T17:30:00Z",
        string signal = "VehicleSpeed",
        double? num = 42,
        string? str = null,
        bool? boolean = null) =>
        new(ts, signal, num, str, boolean);

    private static SignalExplorerModel Model(
        long? selected = 7,
        IReadOnlyList<string>? available = null,
        IReadOnlyList<string>? selectedSignals = null,
        bool isLive = false,
        bool liveConnected = false,
        bool hasExplored = false,
        bool historyLoading = false,
        IReadOnlyList<SignalExplorerEntry>? rows = null,
        bool loading = false,
        bool isFetching = false,
        bool hasError = false,
        string? errorDetail = null,
        IReadOnlyList<SignalExplorerVehicle>? vehicles = null,
        int perPage = 25) =>
        new(
            Vehicles: vehicles ?? [new SignalExplorerVehicle(7, "Model 3")],
            SelectedVehicleId: selected,
            AvailableSignals: available ?? ["VehicleSpeed", "BatteryLevel"],
            SelectedSignals: selectedSignals ?? Array.Empty<string>(),
            Range: Today,
            PerPage: perPage,
            IsLive: isLive,
            LiveConnected: liveConnected,
            HasExplored: hasExplored,
            HistoryLoading: historyLoading,
            Rows: rows ?? Array.Empty<SignalExplorerEntry>(),
            Loading: loading,
            IsFetching: isFetching,
            HasError: hasError,
            ErrorDetail: errorDetail);

    // ---- Projection: data-state matrix ---------------------------------------------

    [Fact]
    public void Projection_loading_is_the_loading_state()
    {
        var display = SignalExplorerProjection.Project(Model(loading: true), Localizer, Now);

        Assert.Equal(SignalExplorerState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowControls);
        Assert.False(display.ShowNoVehicle);
    }

    [Fact]
    public void Projection_no_vehicle_is_the_empty_state()
    {
        var display = SignalExplorerProjection.Project(
            Model(selected: null, vehicles: Array.Empty<SignalExplorerVehicle>()), Localizer, Now);

        Assert.Equal(SignalExplorerState.Empty, display.State);
        Assert.True(display.ShowNoVehicle);
        Assert.False(display.ShowControls);
        Assert.Equal("Select a vehicle to begin", display.NoVehicleTitle);
        Assert.Equal("Pick a vehicle from the picker above to explore its signals.", display.NoVehicleMessage);
    }

    [Fact]
    public void Projection_with_vehicle_shows_controls_and_pre_explore_empty()
    {
        var display = SignalExplorerProjection.Project(Model(), Localizer, Now);

        Assert.Equal(SignalExplorerState.Success, display.State);
        Assert.True(display.ShowControls);
        Assert.True(display.ShowPreExploreEmpty);
        Assert.False(display.ShowResults);
        Assert.Equal("Pick signals and click Explore", display.PreExploreEmptyTitle);
        Assert.Equal(
            "Choose up to 5 signals, set a date range, then hit Explore \u2014 or toggle Live to stream in real time.",
            display.PreExploreEmptyMessage);
        Assert.Equal("Signal Explorer", display.Title);
        Assert.Equal("Visualise signal history with chart and stats \u2014 or stream live", display.Subtitle);
        Assert.Equal("Time Range", display.TimeRangeLabel);
        Assert.Equal("Per Page", display.PerPageLabel);
        Assert.Equal("Explore", display.ExploreLabel);
        Assert.Equal(4, display.PerPageOptions.Count);
    }

    [Fact]
    public void Projection_canExplore_requires_a_vehicle_a_signal_and_a_valid_range()
    {
        Assert.False(SignalExplorerProjection.Project(Model(), Localizer, Now).CanExplore);
        Assert.True(SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"]), Localizer, Now).CanExplore);
        Assert.False(SignalExplorerProjection.Project(
            Model(selected: null, selectedSignals: ["VehicleSpeed"], vehicles: Array.Empty<SignalExplorerVehicle>()),
            Localizer,
            Now).CanExplore);
    }

    [Fact]
    public void Projection_after_explore_with_rows_shows_stats_chart_and_history_table()
    {
        var rows = new[]
        {
            Entry(signal: "VehicleSpeed", num: 40),
            Entry(ts: "2026-06-12T17:31:00Z", signal: "VehicleSpeed", num: 60),
        };
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasExplored: true, rows: rows), Localizer, Now);

        Assert.True(display.ShowResults);
        Assert.True(display.ShowStats);
        Assert.True(display.ShowHistoryTable);
        Assert.True(display.ShowResultsTable);
        Assert.False(display.ShowEmptyResults);
        Assert.False(display.ShowPreExploreEmpty);
        Assert.Equal(2, display.TotalRecords);
        Assert.Equal(2L, display.PointsLoaded);
        Assert.Equal(4, display.Columns.Count);
        Assert.Equal(2, display.Rows.Count);
        Assert.Equal("Signal Data", display.ResultsTitle);
        Assert.Contains("2", display.ResultsMetaText, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_after_explore_with_no_rows_is_the_no_data_empty_state()
    {
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasExplored: true, rows: Array.Empty<SignalExplorerEntry>()),
            Localizer,
            Now);

        Assert.True(display.ShowResults);
        Assert.True(display.ShowHistoryTable);
        Assert.False(display.ShowStats);
        Assert.False(display.ShowResultsTable);
        Assert.True(display.ShowEmptyResults);
        Assert.Equal("No data", display.EmptyResultsTitle);
        Assert.Equal("No signal data found for this query.", display.EmptyResultsMessage);
    }

    [Fact]
    public void Projection_history_loading_shows_neither_table_nor_empty()
    {
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasExplored: true, historyLoading: true),
            Localizer,
            Now);

        Assert.True(display.ShowResults);
        Assert.True(display.HistoryLoading);
        Assert.False(display.ShowResultsTable);
        Assert.False(display.ShowEmptyResults);
    }

    [Fact]
    public void Projection_error_is_the_error_state_with_the_load_failed_banner()
    {
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasExplored: true, hasError: true, errorDetail: "boom"),
            Localizer,
            Now);

        Assert.Equal(SignalExplorerState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
    }

    // ---- Projection: Live mode -----------------------------------------------------

    [Fact]
    public void Projection_live_mode_streams_without_the_history_table()
    {
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], isLive: true, liveConnected: true), Localizer, Now);

        Assert.True(display.IsLive);
        Assert.True(display.ShowResults);
        Assert.False(display.ShowHistoryTable);
        Assert.False(display.ShowPreExploreEmpty);
        Assert.False(display.ShowExplore);
        Assert.False(display.ShowPerPage);
        Assert.True(display.ShowLiveBadge);
        Assert.True(display.LiveButtonIsDestructive);
        Assert.Equal("Stop live", display.LiveButtonText);
    }

    [Fact]
    public void Projection_live_badge_text_follows_the_connection_state()
    {
        var connected = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], isLive: true, liveConnected: true), Localizer, Now);
        Assert.True(connected.LiveBadgeConnected);
        Assert.Equal("Connected", connected.LiveBadgeText);

        var disconnected = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], isLive: true, liveConnected: false), Localizer, Now);
        Assert.False(disconnected.LiveBadgeConnected);
        Assert.Equal("Disconnected", disconnected.LiveBadgeText);
    }

    [Fact]
    public void Projection_live_button_label_is_Live_when_idle()
    {
        var display = SignalExplorerProjection.Project(Model(selectedSignals: ["VehicleSpeed"]), Localizer, Now);

        Assert.False(display.IsLive);
        Assert.Equal("Live", display.LiveButtonText);
        Assert.False(display.LiveButtonIsDestructive);
        Assert.True(display.ShowExplore);
        Assert.True(display.ShowPerPage);
        Assert.False(display.ShowLiveBadge);
    }

    [Fact]
    public void Projection_live_toggle_is_disabled_without_a_signal()
    {
        Assert.False(SignalExplorerProjection.Project(Model(), Localizer, Now).CanToggleLive);
        Assert.True(SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"]), Localizer, Now).CanToggleLive);
        // Live can always be toggled off once active, even if the selection emptied.
        Assert.True(SignalExplorerProjection.Project(Model(isLive: true), Localizer, Now).CanToggleLive);
    }

    [Fact]
    public void Projection_help_aria_uses_the_web_key()
    {
        var display = SignalExplorerProjection.Project(Model(), Localizer, Now);
        Assert.Equal("More info about live signal streaming", display.HelpLiveAria);
    }

    // ---- Projection: stats + chart memos -------------------------------------------

    [Fact]
    public void BuildStats_aggregates_min_max_avg_count_per_signal()
    {
        var rows = new[]
        {
            Entry(signal: "VehicleSpeed", num: 40),
            Entry(signal: "VehicleSpeed", num: 60),
            Entry(signal: "VehicleSpeed", num: 50),
            Entry(signal: "BatteryLevel", num: null, str: "n/a"),
        };

        var stats = SignalExplorerProjection.BuildStats(rows);

        var speed = Assert.Single(stats);
        Assert.Equal("VehicleSpeed", speed.Signal);
        Assert.Equal(40, speed.Min);
        Assert.Equal(60, speed.Max);
        Assert.Equal(50, speed.Avg);
        Assert.Equal(3, speed.Count);
    }

    [Fact]
    public void BuildChartSamples_pivots_rows_by_timestamp_ascending()
    {
        var rows = new[]
        {
            Entry(ts: "2026-06-12T17:31:00Z", signal: "VehicleSpeed", num: 60),
            Entry(ts: "2026-06-12T17:30:00Z", signal: "VehicleSpeed", num: 40),
            Entry(ts: "2026-06-12T17:30:00Z", signal: "BatteryLevel", num: null, boolean: true),
        };

        var samples = SignalExplorerProjection.BuildChartSamples(rows);

        Assert.Equal(2, samples.Count);
        Assert.Equal("2026-06-12T17:30:00Z", samples[0].Timestamp);
        Assert.Equal(40d, samples[0].Values["VehicleSpeed"]);
        Assert.Equal(1d, samples[0].Values["BatteryLevel"]); // boolean true → 1
        Assert.Equal("2026-06-12T17:31:00Z", samples[1].Timestamp);
        Assert.Equal(60d, samples[1].Values["VehicleSpeed"]);
    }

    [Fact]
    public void Projection_chart_stats_track_selected_signal_order()
    {
        var rows = new[]
        {
            Entry(signal: "VehicleSpeed", num: 40),
            Entry(signal: "VehicleSpeed", num: 60),
        };
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasExplored: true, rows: rows), Localizer, Now);

        var stat = Assert.Single(display.ChartStats);
        Assert.Equal(40, stat.Min);
        Assert.Equal(60, stat.Max);
    }

    [Fact]
    public void Projection_rows_format_value_and_classify_type()
    {
        var rows = new[]
        {
            Entry(signal: "Speed", num: 42),
            Entry(signal: "Gear", num: null, str: "Drive"),
            Entry(signal: "Locked", num: null, boolean: true),
        };
        var display = SignalExplorerProjection.Project(
            Model(selectedSignals: ["Speed"], hasExplored: true, rows: rows), Localizer, Now);

        Assert.Equal("42", display.Rows[0].Value);
        Assert.Equal("number", display.Rows[0].TypeLabel);
        Assert.Equal("Drive", display.Rows[1].Value);
        Assert.Equal("string", display.Rows[1].TypeLabel);
        Assert.Equal("true", display.Rows[2].Value);
        Assert.Equal("boolean", display.Rows[2].TypeLabel);
    }

    [Fact]
    public void Projection_exposes_the_vehicle_picker_options()
    {
        var display = SignalExplorerProjection.Project(
            Model(vehicles: [new SignalExplorerVehicle(7, "Model 3"), new SignalExplorerVehicle(8, null)]),
            Localizer,
            Now);

        Assert.Equal(2, display.VehicleOptions.Count);
        Assert.Equal("Model 3", display.VehicleOptions[0].Label);
        Assert.Equal("Vehicle 8", display.VehicleOptions[1].Label);
        Assert.Equal("Select vehicle", display.SelectVehicleLabel);
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void VehicleParseList_reads_id_and_display_name()
    {
        using var doc = JsonDocument.Parse("[{\"id\":7,\"display_name\":\"Model 3\"},{\"id\":8}]");

        var list = SignalExplorerVehicle.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal("Model 3", list[0].Label);
        Assert.Equal("Vehicle 8", list[1].Label);
    }

    [Fact]
    public void ParseAvailableSignals_reads_the_rich_catalogue_shape()
    {
        using var doc = JsonDocument.Parse(
            "{\"signals\":[{\"name\":\"VehicleSpeed\"},{\"name\":\"BatteryLevel\"},{\"name\":\"\"},{\"other\":1}]}");

        var names = SignalExplorerClientFeed.ParseAvailableSignals(doc.RootElement);

        Assert.Equal(new[] { "VehicleSpeed", "BatteryLevel" }, names);
    }

    [Fact]
    public void ParseAvailableSignals_reads_the_bare_and_legacy_string_array_shapes()
    {
        using var bare = JsonDocument.Parse("[\"A\",\"B\"]");
        Assert.Equal(new[] { "A", "B" }, SignalExplorerClientFeed.ParseAvailableSignals(bare.RootElement));

        using var legacy = JsonDocument.Parse("{\"signals\":[\"A\",\"\",\"C\"]}");
        Assert.Equal(new[] { "A", "C" }, SignalExplorerClientFeed.ParseAvailableSignals(legacy.RootElement));

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(SignalExplorerClientFeed.ParseAvailableSignals(notArray.RootElement));
    }

    [Fact]
    public void ParseHistory_classifies_each_point_by_its_json_kind()
    {
        using var doc = JsonDocument.Parse(
            "{\"signal\":\"Speed\",\"data\":[" +
            "{\"ts\":\"2026-06-12T17:30:00Z\",\"kind\":\"ValueKindDouble\",\"value\":42.5}," +
            "{\"ts\":\"2026-06-12T17:31:00Z\",\"kind\":\"ValueKindString\",\"value\":\"Drive\"}," +
            "{\"ts\":\"2026-06-12T17:32:00Z\",\"kind\":\"ValueKindBool\",\"value\":true}," +
            "{\"ts\":\"2026-06-12T17:33:00Z\",\"kind\":\"ValueKindDouble\",\"value\":null}]}");

        var rows = SignalExplorerEntry.ParseHistory(doc.RootElement);

        Assert.Equal(4, rows.Count);
        Assert.Equal(42.5, rows[0].ValueNum);
        Assert.Equal("Drive", rows[1].ValueStr);
        Assert.True(rows[2].ValueBool);
        Assert.Null(rows[3].ValueNum);
        Assert.Equal("Speed", rows[0].Signal);
        Assert.Equal(SignalExplorerProjection.EmDash, rows[3].FormatValue());
    }

    [Fact]
    public void ParseHistory_tolerates_a_non_object_envelope()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Empty(SignalExplorerEntry.ParseHistory(doc.RootElement));
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new SignalExplorerPageViewModel(EmptySignalExplorerFeed.Instance, Localizer, () => Now);

        Assert.Equal(SignalExplorerState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loads_into_success_and_selects_the_first_vehicle()
    {
        var feed = new FakeSignalExplorerFeed(
            [new SignalExplorerVehicle(42, "Model S")],
            ["VehicleSpeed", "BatteryLevel"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalExplorerState.Success, vm.State);
        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastAvailableVehicleId);
        Assert.Equal(2, vm.Display.AvailableSignals.Count);
        Assert.True(vm.Display.ShowPreExploreEmpty);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_no_vehicle_empty_state()
    {
        using var vm = new SignalExplorerPageViewModel(EmptySignalExplorerFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalExplorerState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowNoVehicle);
    }

    [Fact]
    public async Task ViewModel_explore_without_signals_is_a_noop()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ExploreAsync();

        Assert.False(vm.HasExplored);
        Assert.Equal(0, feed.HistoryFetches);
    }

    [Fact]
    public async Task ViewModel_explore_fetches_history_and_shows_the_rows()
    {
        var feed = new FakeSignalExplorerFeed(
            [new SignalExplorerVehicle(1, "A")],
            ["VehicleSpeed"],
            [Entry(signal: "VehicleSpeed", num: 55)]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        await vm.ExploreAsync();

        Assert.True(vm.HasExplored);
        Assert.Equal(1, feed.HistoryFetches);
        Assert.Equal(1L, feed.LastHistoryVehicleId);
        Assert.Equal(new[] { "VehicleSpeed" }, feed.LastSignals);
        Assert.Equal(250, feed.LastLimit); // perPage(25) * 10
        Assert.True(vm.Display.ShowResultsTable);
        Assert.True(vm.Display.ShowStats);
    }

    [Fact]
    public async Task ViewModel_history_failure_is_the_error_state()
    {
        var feed = new ThrowingHistoryFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        await vm.ExploreAsync();

        Assert.Equal(SignalExplorerState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_available_signals_failure_raises_the_banner()
    {
        var feed = new ThrowingAvailableFeed([new SignalExplorerVehicle(1, "A")]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalExplorerState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
        // The controls still render beneath the banner (a vehicle is selected).
        Assert.True(vm.Display.ShowControls);
    }

    [Fact]
    public async Task ViewModel_set_per_page_updates_the_fetch_limit()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"], [Entry()]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);
        vm.SetPerPage(100);

        await vm.ExploreAsync();

        Assert.Equal(100, vm.PerPage);
        Assert.Equal(1000, feed.LastLimit);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_reloads_signals_and_wipes_explored()
    {
        var feed = new FakeSignalExplorerFeed(
            [new SignalExplorerVehicle(1, "A"), new SignalExplorerVehicle(2, "B")],
            ["VehicleSpeed"],
            [Entry()]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);
        await vm.ExploreAsync();
        Assert.True(vm.HasExplored);

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2L, vm.SelectedVehicleId);
        Assert.Equal(2L, feed.LastAvailableVehicleId);
        Assert.False(vm.HasExplored);
        Assert.True(vm.Display.ShowPreExploreEmpty);
    }

    [Fact]
    public async Task ViewModel_set_range_updates_without_a_fetch()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        var range = new DateRange(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31));
        vm.SetRange(range);

        Assert.Equal(range, vm.Range);
        Assert.Equal(0, feed.HistoryFetches);
    }

    [Fact]
    public async Task ViewModel_toggle_live_enables_then_disables_streaming()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        vm.ToggleLive();
        Assert.True(vm.IsLive);
        Assert.True(vm.Display.ShowResults);
        Assert.False(vm.Display.ShowExplore);

        vm.ToggleLive();
        Assert.False(vm.IsLive);
        Assert.True(vm.Display.ShowPreExploreEmpty);
    }

    [Fact]
    public async Task ViewModel_toggle_live_is_a_noop_without_a_signal()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleLive();

        Assert.False(vm.IsLive);
    }

    [Fact]
    public async Task ViewModel_update_live_state_drives_the_connection_badge()
    {
        var feed = new FakeSignalExplorerFeed([new SignalExplorerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalExplorerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        // Ignored while not live.
        vm.UpdateLiveState(true);
        Assert.False(vm.LiveConnected);

        vm.ToggleLive();
        vm.UpdateLiveState(true);
        Assert.True(vm.LiveConnected);
        Assert.True(vm.Display.LiveBadgeConnected);
        Assert.Equal("Connected", vm.Display.LiveBadgeText);
    }

    [Fact]
    public void ViewModel_set_selected_signals_caps_at_five()
    {
        using var vm = new SignalExplorerPageViewModel(EmptySignalExplorerFeed.Instance, Localizer, () => Now);

        vm.SetSelectedSignals(["a", "b", "c", "d", "e", "f", "g"]);

        Assert.Equal(5, vm.SelectedSignals.Count);
        Assert.Equal(new[] { "a", "b", "c", "d", "e" }, vm.SelectedSignals);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new SignalExplorerClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
    }

    [Fact]
    public async Task ClientFeed_available_sends_the_vehicle_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signals\":[{\"name\":\"VehicleSpeed\"}]}"));
        var feed = new SignalExplorerClientFeed(api);

        var names = await feed.FetchAvailableSignalsAsync(7, default);

        Assert.Equal(new[] { "VehicleSpeed" }, names);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_signals_vehicleID_available", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_history_sends_the_path_and_from_to_limit_query_per_signal()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signal\":\"VehicleSpeed\",\"data\":[{\"ts\":\"2026-06-12T17:30:00Z\",\"kind\":\"ValueKindDouble\",\"value\":42}]}"));
        var feed = new SignalExplorerClientFeed(api);

        var rows = await feed.FetchHistoryAsync(7, ["VehicleSpeed"], "2026-06-12T00:00:00.000Z", "2026-06-12T23:59:59.999Z", 250, default);

        Assert.Single(rows);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Equal("VehicleSpeed", request.PathParams!["signalName"]);
        Assert.NotNull(request.Query);
        Assert.Equal("2026-06-12T00:00:00.000Z", request.Query!["from"]);
        Assert.Equal("2026-06-12T23:59:59.999Z", request.Query!["to"]);
        Assert.Equal(250, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_history_flattens_and_sorts_newest_first()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signal\":\"A\",\"data\":[{\"ts\":\"2026-06-12T10:00:00Z\",\"kind\":\"ValueKindDouble\",\"value\":1}]}"));
        api.ReturnsValue(Json("{\"signal\":\"B\",\"data\":[{\"ts\":\"2026-06-12T18:00:00Z\",\"kind\":\"ValueKindDouble\",\"value\":2}]}"));
        var feed = new SignalExplorerClientFeed(api);

        var rows = await feed.FetchHistoryAsync(7, ["A", "B"], string.Empty, string.Empty, 100, default);

        Assert.Equal(2, rows.Count);
        Assert.Equal("B", rows[0].Signal);  // 18:00 sorts before 10:00 (newest first)
        Assert.Equal("A", rows[1].Signal);
        Assert.Equal(2, api.Requests.Count);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SignalExplorerClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(default));
    }

    // ---- Diagnostics + registration + i18n -----------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SignalExplorerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalExplorerPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("SignalExplorer", SignalExplorerRegistration.RouteName);
        Assert.Equal("SignalExplorerPage", SignalExplorerRegistration.Slug);
        Assert.Equal(25, SignalExplorerRegistration.DefaultPerPage);
        Assert.Equal("get_api_v1_vehicles", SignalExplorerRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_available", SignalExplorerRegistration.AvailableOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", SignalExplorerRegistration.HistoryOperation);
        Assert.Equal("Signal Explorer", SignalExplorerRegistration.Title(Localizer));
        Assert.Equal("Visualise signal history with chart and stats \u2014 or stream live", SignalExplorerRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        SignalExplorerProjection.Project(Model(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

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

    private sealed class FakeSignalExplorerFeed : ISignalExplorerFeed
    {
        private readonly IReadOnlyList<SignalExplorerVehicle> _vehicles;
        private readonly IReadOnlyList<string> _available;
        private readonly IReadOnlyList<SignalExplorerEntry> _rows;

        public FakeSignalExplorerFeed(
            IReadOnlyList<SignalExplorerVehicle> vehicles,
            IReadOnlyList<string> available,
            IReadOnlyList<SignalExplorerEntry>? rows = null)
        {
            _vehicles = vehicles;
            _available = available;
            _rows = rows ?? Array.Empty<SignalExplorerEntry>();
        }

        public int HistoryFetches { get; private set; }

        public long? LastAvailableVehicleId { get; private set; }

        public long? LastHistoryVehicleId { get; private set; }

        public IReadOnlyList<string>? LastSignals { get; private set; }

        public int LastLimit { get; private set; }

        public Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            LastAvailableVehicleId = vehicleId;
            return Task.FromResult(_available);
        }

        public Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
            long vehicleId,
            IReadOnlyList<string> signals,
            string fromIso,
            string toIso,
            int limit,
            CancellationToken cancellationToken)
        {
            HistoryFetches++;
            LastHistoryVehicleId = vehicleId;
            LastSignals = signals;
            LastLimit = limit;
            return Task.FromResult(_rows);
        }
    }

    private sealed class ThrowingHistoryFeed : ISignalExplorerFeed
    {
        private readonly IReadOnlyList<SignalExplorerVehicle> _vehicles;
        private readonly IReadOnlyList<string> _available;

        public ThrowingHistoryFeed(IReadOnlyList<SignalExplorerVehicle> vehicles, IReadOnlyList<string> available)
        {
            _vehicles = vehicles;
            _available = available;
        }

        public Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(_available);

        public Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
            long vehicleId,
            IReadOnlyList<string> signals,
            string fromIso,
            string toIso,
            int limit,
            CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class ThrowingAvailableFeed : ISignalExplorerFeed
    {
        private readonly IReadOnlyList<SignalExplorerVehicle> _vehicles;

        public ThrowingAvailableFeed(IReadOnlyList<SignalExplorerVehicle> vehicles) => _vehicles = vehicles;

        public Task<IReadOnlyList<SignalExplorerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("signals down");

        public Task<IReadOnlyList<SignalExplorerEntry>> FetchHistoryAsync(
            long vehicleId,
            IReadOnlyList<string> signals,
            string fromIso,
            string toIso,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<SignalExplorerEntry>>(Array.Empty<SignalExplorerEntry>());
    }
}
