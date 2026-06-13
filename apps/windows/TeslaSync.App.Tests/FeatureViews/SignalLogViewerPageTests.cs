using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalLogViewerPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/SignalLogViewerPage.tsx): the four web data states
/// (loading / empty / error / success), the no-vehicle guard, the GlassPanel1 query controls, the deferred-query
/// results region (table / loading / no-data), the tolerant vehicle / available-signal / history parsers, the
/// view-model's state machine, and the generated-client feed's request shaping (web <c>useSelectedVehicle</c> +
/// <c>useSignals</c> + the per-signal history <c>useQuery</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="SignalLogViewerDisplay"/> flags asserted here.
/// </summary>
public sealed class SignalLogViewerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);
    private static readonly DateRange Today = new(new DateOnly(2026, 6, 12), new DateOnly(2026, 6, 12));

    // The 12 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "Choose one or more signals, set a date range, then hit Query to browse signal history.",
        "Per Page",
        "Query",
        "Query signal history from Postgres",
        "Select signals and click Query",
        "Signal Log",
        "Signal Log Viewer",
        "Time Range",
        "error.loadFailed",
        "records",
        "signalLog.noVehicle",
        "signalLog.noVehicleDesc",
    ];

    private static SignalLogEntry Entry(
        string ts = "2026-06-12T17:30:00Z",
        string signal = "VehicleSpeed",
        double? num = 42,
        string? str = null,
        bool? boolean = null) =>
        new(ts, signal, num, str, boolean);

    private static SignalLogViewerModel Model(
        long? selected = 7,
        IReadOnlyList<string>? available = null,
        IReadOnlyList<string>? selectedSignals = null,
        bool hasQueried = false,
        bool historyLoading = false,
        IReadOnlyList<SignalLogEntry>? rows = null,
        bool loading = false,
        bool isFetching = false,
        bool hasError = false,
        string? errorDetail = null,
        IReadOnlyList<SignalLogViewerVehicle>? vehicles = null,
        int perPage = 50) =>
        new(
            Vehicles: vehicles ?? [new SignalLogViewerVehicle(7, "Model 3")],
            SelectedVehicleId: selected,
            AvailableSignals: available ?? ["VehicleSpeed", "BatteryLevel"],
            SelectedSignals: selectedSignals ?? Array.Empty<string>(),
            Range: Today,
            PerPage: perPage,
            HasQueried: hasQueried,
            HistoryLoading: historyLoading,
            Rows: rows ?? Array.Empty<SignalLogEntry>(),
            Loading: loading,
            IsFetching: isFetching,
            HasError: hasError,
            ErrorDetail: errorDetail);

    // ---- Projection: data-state matrix ---------------------------------------------

    [Fact]
    public void Projection_loading_is_the_loading_state()
    {
        var display = SignalLogViewerProjection.Project(Model(loading: true), Localizer, Now);

        Assert.Equal(SignalLogViewerState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowControls);
        Assert.False(display.ShowNoVehicle);
    }

    [Fact]
    public void Projection_no_vehicle_is_the_empty_state()
    {
        var display = SignalLogViewerProjection.Project(
            Model(selected: null, vehicles: Array.Empty<SignalLogViewerVehicle>()), Localizer, Now);

        Assert.Equal(SignalLogViewerState.Empty, display.State);
        Assert.True(display.ShowNoVehicle);
        Assert.False(display.ShowControls);
        Assert.Equal("Select a vehicle to begin", display.NoVehicleTitle);
        Assert.Equal("Pick a vehicle from the picker above to query its signal history.", display.NoVehicleMessage);
    }

    [Fact]
    public void Projection_with_vehicle_shows_controls_and_pre_query_empty()
    {
        var display = SignalLogViewerProjection.Project(Model(), Localizer, Now);

        Assert.Equal(SignalLogViewerState.Success, display.State);
        Assert.True(display.ShowControls);
        Assert.True(display.ShowPreQueryEmpty);
        Assert.False(display.ShowResults);
        Assert.Equal("Select signals and click Query", display.PreQueryEmptyTitle);
        Assert.Equal(
            "Choose one or more signals, set a date range, then hit Query to browse signal history.",
            display.PreQueryEmptyMessage);
        Assert.Equal("Signal Log Viewer", display.Title);
        Assert.Equal("Query signal history from Postgres", display.Subtitle);
        Assert.Equal("Time Range", display.TimeRangeLabel);
        Assert.Equal("Per Page", display.PerPageLabel);
        Assert.Equal("Query", display.QueryLabel);
        Assert.Equal(4, display.PerPageOptions.Count);
    }

    [Fact]
    public void Projection_canQuery_requires_a_vehicle_a_signal_and_a_valid_range()
    {
        Assert.False(SignalLogViewerProjection.Project(Model(), Localizer, Now).CanQuery);
        Assert.True(SignalLogViewerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"]), Localizer, Now).CanQuery);
        Assert.False(SignalLogViewerProjection.Project(
            Model(selected: null, selectedSignals: ["VehicleSpeed"], vehicles: Array.Empty<SignalLogViewerVehicle>()),
            Localizer,
            Now).CanQuery);
    }

    [Fact]
    public void Projection_after_query_with_rows_shows_the_table_and_records()
    {
        var rows = new[] { Entry(signal: "VehicleSpeed"), Entry(ts: "2026-06-12T17:31:00Z", signal: "BatteryLevel", num: 80) };
        var display = SignalLogViewerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasQueried: true, rows: rows), Localizer, Now);

        Assert.True(display.ShowResults);
        Assert.True(display.ShowResultsTable);
        Assert.False(display.ShowEmptyResults);
        Assert.False(display.ShowPreQueryEmpty);
        Assert.True(display.ShowRecords);
        Assert.Equal("2 records", display.RecordsText);
        Assert.Equal(2, display.TotalRecords);
        Assert.Equal(4, display.Columns.Count);
        Assert.Equal(2, display.Rows.Count);
        Assert.Equal("Signal Data", display.ResultsTitle);
    }

    [Fact]
    public void Projection_after_query_with_no_rows_is_the_no_data_empty_state()
    {
        var display = SignalLogViewerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasQueried: true, rows: Array.Empty<SignalLogEntry>()),
            Localizer,
            Now);

        Assert.True(display.ShowResults);
        Assert.False(display.ShowResultsTable);
        Assert.True(display.ShowEmptyResults);
        Assert.Equal("No data", display.EmptyResultsTitle);
        Assert.Equal("No signal data found for this query.", display.EmptyResultsMessage);
    }

    [Fact]
    public void Projection_history_loading_shows_neither_table_nor_empty()
    {
        var display = SignalLogViewerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasQueried: true, historyLoading: true),
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
        var display = SignalLogViewerProjection.Project(
            Model(selectedSignals: ["VehicleSpeed"], hasQueried: true, hasError: true, errorDetail: "boom"),
            Localizer,
            Now);

        Assert.Equal(SignalLogViewerState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
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
        var display = SignalLogViewerProjection.Project(
            Model(selectedSignals: ["Speed"], hasQueried: true, rows: rows), Localizer, Now);

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
        var display = SignalLogViewerProjection.Project(
            Model(vehicles: [new SignalLogViewerVehicle(7, "Model 3"), new SignalLogViewerVehicle(8, null)]),
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

        var list = SignalLogViewerVehicle.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal("Model 3", list[0].Label);
        Assert.Equal("Vehicle 8", list[1].Label);
    }

    [Fact]
    public void ParseAvailableSignals_reads_the_rich_catalogue_shape()
    {
        using var doc = JsonDocument.Parse(
            "{\"signals\":[{\"name\":\"VehicleSpeed\"},{\"name\":\"BatteryLevel\"},{\"name\":\"\"},{\"other\":1}]}");

        var names = SignalLogViewerClientFeed.ParseAvailableSignals(doc.RootElement);

        Assert.Equal(new[] { "VehicleSpeed", "BatteryLevel" }, names);
    }

    [Fact]
    public void ParseAvailableSignals_reads_the_bare_and_legacy_string_array_shapes()
    {
        using var bare = JsonDocument.Parse("[\"A\",\"B\"]");
        Assert.Equal(new[] { "A", "B" }, SignalLogViewerClientFeed.ParseAvailableSignals(bare.RootElement));

        using var legacy = JsonDocument.Parse("{\"signals\":[\"A\",\"\",\"C\"]}");
        Assert.Equal(new[] { "A", "C" }, SignalLogViewerClientFeed.ParseAvailableSignals(legacy.RootElement));

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(SignalLogViewerClientFeed.ParseAvailableSignals(notArray.RootElement));
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

        var rows = SignalLogEntry.ParseHistory(doc.RootElement);

        Assert.Equal(4, rows.Count);
        Assert.Equal(42.5, rows[0].ValueNum);
        Assert.Equal("Drive", rows[1].ValueStr);
        Assert.True(rows[2].ValueBool);
        Assert.Null(rows[3].ValueNum);
        Assert.Equal("Speed", rows[0].Signal);
        Assert.Equal(SignalLogViewerProjection.EmDash, rows[3].FormatValue());
    }

    [Fact]
    public void ParseHistory_tolerates_a_non_object_envelope()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Empty(SignalLogEntry.ParseHistory(doc.RootElement));
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new SignalLogViewerPageViewModel(EmptySignalLogViewerFeed.Instance, Localizer, () => Now);

        Assert.Equal(SignalLogViewerState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loads_into_success_and_selects_the_first_vehicle()
    {
        var feed = new FakeSignalLogViewerFeed(
            [new SignalLogViewerVehicle(42, "Model S")],
            ["VehicleSpeed", "BatteryLevel"]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalLogViewerState.Success, vm.State);
        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastAvailableVehicleId);
        Assert.Equal(2, vm.Display.AvailableSignals.Count);
        Assert.True(vm.Display.ShowPreQueryEmpty);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_no_vehicle_empty_state()
    {
        using var vm = new SignalLogViewerPageViewModel(EmptySignalLogViewerFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SignalLogViewerState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowNoVehicle);
    }

    [Fact]
    public async Task ViewModel_query_without_signals_is_a_noop()
    {
        var feed = new FakeSignalLogViewerFeed([new SignalLogViewerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.QueryAsync();

        Assert.False(vm.HasQueried);
        Assert.Equal(0, feed.HistoryFetches);
    }

    [Fact]
    public async Task ViewModel_query_fetches_history_and_shows_the_rows()
    {
        var feed = new FakeSignalLogViewerFeed(
            [new SignalLogViewerVehicle(1, "A")],
            ["VehicleSpeed"],
            [Entry(signal: "VehicleSpeed", num: 55)]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        await vm.QueryAsync();

        Assert.True(vm.HasQueried);
        Assert.Equal(1, feed.HistoryFetches);
        Assert.Equal(1L, feed.LastHistoryVehicleId);
        Assert.Equal(new[] { "VehicleSpeed" }, feed.LastSignals);
        Assert.Equal(500, feed.LastLimit); // perPage(50) * 10
        Assert.True(vm.Display.ShowResultsTable);
        Assert.Equal("1 records", vm.Display.RecordsText);
    }

    [Fact]
    public async Task ViewModel_history_failure_is_the_error_state()
    {
        var feed = new ThrowingHistoryFeed([new SignalLogViewerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);

        await vm.QueryAsync();

        Assert.Equal(SignalLogViewerState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_set_per_page_updates_the_fetch_limit()
    {
        var feed = new FakeSignalLogViewerFeed([new SignalLogViewerVehicle(1, "A")], ["VehicleSpeed"], [Entry()]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSelectedSignals(["VehicleSpeed"]);
        vm.SetPerPage(100);

        await vm.QueryAsync();

        Assert.Equal(100, vm.PerPage);
        Assert.Equal(1000, feed.LastLimit);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_reloads_the_available_signals()
    {
        var feed = new FakeSignalLogViewerFeed(
            [new SignalLogViewerVehicle(1, "A"), new SignalLogViewerVehicle(2, "B")],
            ["VehicleSpeed"]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2L, vm.SelectedVehicleId);
        Assert.Equal(2L, feed.LastAvailableVehicleId);
    }

    [Fact]
    public async Task ViewModel_set_range_updates_without_a_fetch()
    {
        var feed = new FakeSignalLogViewerFeed([new SignalLogViewerVehicle(1, "A")], ["VehicleSpeed"]);
        using var vm = new SignalLogViewerPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        var range = new DateRange(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31));
        vm.SetRange(range);

        Assert.Equal(range, vm.Range);
        Assert.Equal(0, feed.HistoryFetches);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new SignalLogViewerClientFeed(api);

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
        var feed = new SignalLogViewerClientFeed(api);

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
        var feed = new SignalLogViewerClientFeed(api);

        var rows = await feed.FetchHistoryAsync(7, ["VehicleSpeed"], "2026-06-12T00:00:00.000Z", "2026-06-12T23:59:59.999Z", 500, default);

        Assert.Single(rows);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Equal("VehicleSpeed", request.PathParams!["signalName"]);
        Assert.NotNull(request.Query);
        Assert.Equal("2026-06-12T00:00:00.000Z", request.Query!["from"]);
        Assert.Equal("2026-06-12T23:59:59.999Z", request.Query!["to"]);
        Assert.Equal(500, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_history_flattens_and_sorts_newest_first()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signal\":\"A\",\"data\":[{\"ts\":\"2026-06-12T10:00:00Z\",\"kind\":\"ValueKindDouble\",\"value\":1}]}"));
        api.ReturnsValue(Json("{\"signal\":\"B\",\"data\":[{\"ts\":\"2026-06-12T18:00:00Z\",\"kind\":\"ValueKindDouble\",\"value\":2}]}"));
        var feed = new SignalLogViewerClientFeed(api);

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
        var feed = new SignalLogViewerClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(default));
    }

    // ---- Diagnostics + registration + i18n -----------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SignalLogViewerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalLogViewerPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("SignalLogViewer", SignalLogViewerRegistration.RouteName);
        Assert.Equal("SignalLogViewerPage", SignalLogViewerRegistration.Slug);
        Assert.Equal(50, SignalLogViewerRegistration.DefaultPerPage);
        Assert.Equal("get_api_v1_vehicles", SignalLogViewerRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_available", SignalLogViewerRegistration.AvailableOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", SignalLogViewerRegistration.HistoryOperation);
        Assert.Equal("Signal Log Viewer", SignalLogViewerRegistration.Title(Localizer));
        Assert.Equal("Query signal history from Postgres", SignalLogViewerRegistration.Subtitle(Localizer));
        Assert.Equal("Signal Log", SignalLogViewerRegistration.PageTitle(Localizer));
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        SignalLogViewerProjection.Project(Model(), recorder, Now);
        // web usePageTitle(t('Signal Log')) — the browser-tab title resolves through the registration.
        SignalLogViewerRegistration.PageTitle(recorder);

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

    private sealed class FakeSignalLogViewerFeed : ISignalLogViewerFeed
    {
        private readonly IReadOnlyList<SignalLogViewerVehicle> _vehicles;
        private readonly IReadOnlyList<string> _available;
        private readonly IReadOnlyList<SignalLogEntry> _rows;

        public FakeSignalLogViewerFeed(
            IReadOnlyList<SignalLogViewerVehicle> vehicles,
            IReadOnlyList<string> available,
            IReadOnlyList<SignalLogEntry>? rows = null)
        {
            _vehicles = vehicles;
            _available = available;
            _rows = rows ?? Array.Empty<SignalLogEntry>();
        }

        public int VehiclesFetches { get; private set; }

        public int AvailableFetches { get; private set; }

        public int HistoryFetches { get; private set; }

        public long? LastAvailableVehicleId { get; private set; }

        public long? LastHistoryVehicleId { get; private set; }

        public IReadOnlyList<string>? LastSignals { get; private set; }

        public int LastLimit { get; private set; }

        public Task<IReadOnlyList<SignalLogViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetches++;
            return Task.FromResult(_vehicles);
        }

        public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            AvailableFetches++;
            LastAvailableVehicleId = vehicleId;
            return Task.FromResult(_available);
        }

        public Task<IReadOnlyList<SignalLogEntry>> FetchHistoryAsync(
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

    private sealed class ThrowingHistoryFeed : ISignalLogViewerFeed
    {
        private readonly IReadOnlyList<SignalLogViewerVehicle> _vehicles;
        private readonly IReadOnlyList<string> _available;

        public ThrowingHistoryFeed(IReadOnlyList<SignalLogViewerVehicle> vehicles, IReadOnlyList<string> available)
        {
            _vehicles = vehicles;
            _available = available;
        }

        public Task<IReadOnlyList<SignalLogViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);

        public Task<IReadOnlyList<string>> FetchAvailableSignalsAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(_available);

        public Task<IReadOnlyList<SignalLogEntry>> FetchHistoryAsync(
            long vehicleId,
            IReadOnlyList<string> signals,
            string fromIso,
            string toIso,
            int limit,
            CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
