using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MQTTInspectorPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/MQTTInspectorPage.tsx), the tolerant snake_case / camelCase parsers, the
/// view-model's three-state matrix (loading / empty / success) plus the failure banner, the per-tick throughput
/// accumulation (web <c>useEffect</c>) and the generated-client feed's request shaping (web <c>useMQTTStatus</c> →
/// <c>GET /telemetry</c>). The WinUI view is exercised by the app build; its per-region visibility is driven entirely
/// by the <see cref="MqttInspectorDisplay"/> flags asserted here.
/// </summary>
public sealed class MQTTInspectorPageTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 29 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "mqtt.batches", "mqtt.broker", "mqtt.collectingData", "mqtt.connected", "mqtt.disconnected",
        "mqtt.fetchError", "mqtt.lastReceived", "mqtt.live", "mqtt.noStatus", "mqtt.noTopics", "mqtt.noVehicles",
        "mqtt.refreshInterval", "mqtt.sigPerSec", "mqtt.signalThroughput", "mqtt.signals", "mqtt.signalsPerSec",
        "mqtt.stale", "mqtt.state", "mqtt.status", "mqtt.streamingVehicles", "mqtt.subtitle", "mqtt.title",
        "mqtt.topicPatterns", "mqtt.totalBatches", "mqtt.totalSignals", "mqtt.uptime", "mqtt.vehicleBreakdown",
        "mqtt.vehicles", "mqtt.vin",
    ];

    private static MqttVehicleRow Vehicle(
        string vin,
        string? state = "online",
        long signals = 1000,
        long batches = 50,
        double? rate = 12.5,
        double lastReceivedAgoSeconds = 5) =>
        new(vin, state, signals, batches, rate, Now.AddSeconds(-lastReceivedAgoSeconds).ToString("o", CultureInfo.InvariantCulture));

    private static MqttStatusSnapshot SampleStatus(
        bool connected = true,
        string? broker = "tcp://mosquitto:1883",
        double? uptime = 7320,
        string[]? topics = null,
        IReadOnlyList<MqttVehicleRow>? vehicles = null) =>
        new(
            HasStatus: true,
            Connected: connected,
            Broker: broker,
            UptimeSeconds: uptime,
            Topics: topics ?? ["telemetry/+/v/+", "$SYS/broker/uptime"],
            Vehicles: vehicles ??
            [
                Vehicle("5YJ3E1EA1KF000001", "online", 12_000, 240, 18.4, 3),
                Vehicle("5YJ3E1EA1KF000002", "asleep", 4_000, 80, 2.1, 600),
            ]);

    private static MqttInspectorModel SuccessModel(
        MqttStatusSnapshot? status = null,
        IReadOnlyList<ThroughputPoint>? throughput = null) =>
        new(false, false, null, status ?? SampleStatus(), throughput ?? Array.Empty<ThroughputPoint>());

    private static MqttInspectorDisplay Project(MqttInspectorModel model, ILocalizer? localizer = null) =>
        MqttInspectorProjection.Project(model, localizer ?? PassthroughLocalizer.Instance, Now);

    // ---- i18n key coverage (all 29 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = MqttInspectorProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = MqttInspectorProjection.Project(MqttInspectorModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_in_the_empty_state()
    {
        var recorder = new RecordingLocalizer();

        _ = MqttInspectorProjection.Project(
            new MqttInspectorModel(false, false, null, MqttStatusSnapshot.Empty, Array.Empty<ThroughputPoint>()),
            recorder,
            Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- data states (loading / empty / success) ----------------------------------

    [Fact]
    public void State_is_loading_before_the_first_resolve()
    {
        var display = Project(MqttInspectorModel.Initial);
        Assert.Equal(MqttInspectorState.Loading, display.State);
    }

    [Fact]
    public void State_is_success_when_the_broker_status_resolves()
    {
        var display = Project(SuccessModel());
        Assert.Equal(MqttInspectorState.Success, display.State);
        Assert.True(display.HasStatus);
    }

    [Fact]
    public void State_is_empty_when_resolved_without_a_status()
    {
        var display = Project(new MqttInspectorModel(false, false, null, MqttStatusSnapshot.Empty, Array.Empty<ThroughputPoint>()));
        Assert.Equal(MqttInspectorState.Empty, display.State);
        Assert.False(display.HasStatus);
        Assert.Equal("MQTT broker status not available", display.NoStatusMessage);
    }

    // ---- error banner (GlassPanel1, web `error && !status`) -----------------------

    [Fact]
    public void Error_banner_shows_when_failed_with_no_status()
    {
        var display = Project(new MqttInspectorModel(false, true, "boom", MqttStatusSnapshot.Empty, Array.Empty<ThroughputPoint>()));
        Assert.True(display.ShowErrorBanner);
        Assert.Equal("Unable to load MQTT status", display.ErrorBannerTitle);
        Assert.Equal("boom", display.ErrorBannerMessage);
    }

    [Fact]
    public void Error_banner_hidden_when_a_prior_status_is_present()
    {
        // web parity: react-query keeps the last data, so an error with a cached status keeps the banner hidden.
        var display = Project(new MqttInspectorModel(false, true, "boom", SampleStatus(), Array.Empty<ThroughputPoint>()));
        Assert.False(display.ShowErrorBanner);
    }

    // ---- summary stat cards (Streaming-Vehicles / Total-Signals / Total-Batches / Signals-sec) ----

    [Fact]
    public void StatCards_show_the_em_dash_while_loading()
    {
        var display = Project(MqttInspectorModel.Initial);
        Assert.All(display.StatCards, c => Assert.Equal("\u2014", c.Value));
    }

    [Fact]
    public void StatCards_aggregate_the_fleet_totals()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("2", display.StatCards[0].Value);          // streaming vehicles
        Assert.Equal("16,000", display.StatCards[1].Value);     // 12,000 + 4,000 total signals
        Assert.Equal("320", display.StatCards[2].Value);        // 240 + 80 total batches
        Assert.Equal("20.50", display.StatCards[3].Value);      // 18.4 + 2.1 signals/sec (fmtNumber precision 2)
        Assert.Equal("Streaming Vehicles", display.StatCards[0].Label);
        Assert.Equal("Signals / sec", display.StatCards[3].Label);
    }

    // ---- connection info panel (GlassPanel6) --------------------------------------

    [Fact]
    public void Connection_panel_shows_broker_uptime_and_topics()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ShowBroker);
        Assert.Equal("tcp://mosquitto:1883", display.BrokerValue);
        Assert.True(display.ShowUptime);
        Assert.Equal("2h 2m", display.UptimeValue);             // 7320s = 2h 2m
        Assert.True(display.HasTopics);
        Assert.Equal(2, display.Topics.Count);
        Assert.True(display.Connected);
        Assert.Equal("Connected", display.ConnectionText);
        Assert.Equal(StatusKind.Success, display.ConnectionStatus);
    }

    [Fact]
    public void Connection_panel_uptime_formats_minutes_only_under_an_hour()
    {
        var display = Project(SuccessModel(SampleStatus(uptime: 600)));
        Assert.Equal("10m", display.UptimeValue);
    }

    [Fact]
    public void Connection_panel_topics_empty_state_when_no_topics()
    {
        var display = Project(SuccessModel(SampleStatus(topics: [])));
        Assert.False(display.HasTopics);
        Assert.Equal("No MQTT topics detected", display.NoTopicsMessage);
    }

    [Fact]
    public void Disconnected_broker_renders_the_danger_chip()
    {
        var display = Project(SuccessModel(SampleStatus(connected: false)));
        Assert.False(display.Connected);
        Assert.Equal("Disconnected", display.ConnectionText);
        Assert.Equal(StatusKind.Danger, display.ConnectionStatus);
    }

    // ---- throughput chart (GlassPanel7 + AreaChart) -------------------------------

    [Fact]
    public void Chart_is_collecting_until_more_than_two_points()
    {
        var twoPoints = new ThroughputPoint[] { new("12:00:00", 5), new("12:00:05", 7) };
        var display = Project(SuccessModel(throughput: twoPoints));

        Assert.False(display.ChartReady);
        Assert.Null(display.ThroughputSeries);
        Assert.Equal("Collecting throughput data\u2026", display.CollectingDataMessage);
    }

    [Fact]
    public void Chart_is_ready_with_an_area_series_when_enough_points()
    {
        var points = new ThroughputPoint[]
        {
            new("12:00:00", 5), new("12:00:05", 7), new("12:00:10", 3), new("12:00:15", 9),
        };
        var display = Project(SuccessModel(throughput: points));

        Assert.True(display.ChartReady);
        Assert.NotNull(display.ThroughputSeries);
        Assert.Equal(4, display.ThroughputSeries!.Points.Count);
        Assert.Equal(Core.Charts.ChartSeriesKind.Area, display.ThroughputSeries.Kind);
        Assert.Equal("Signals", display.ThroughputSeries.Name);
    }

    // ---- vehicle breakdown (GlassPanel8 + DataTable) ------------------------------

    [Fact]
    public void Vehicle_rows_are_projected_with_formatted_cells()
    {
        var display = Project(SuccessModel());

        Assert.Equal(2, display.VehicleRows.Count);
        var first = display.VehicleRows[0];
        Assert.Equal("5YJ3E1EA1KF000001", first.Vin);
        Assert.Equal("online", first.StateText);
        Assert.Equal(StatusKind.Success, first.StateStatus);
        Assert.Equal("12,000", first.SignalsText);
        Assert.Equal("240", first.BatchesText);
        Assert.Equal("18.40", first.SigPerSecText);
    }

    [Fact]
    public void Recent_vehicle_is_live_stale_vehicle_is_flagged()
    {
        var status = SampleStatus(vehicles:
        [
            Vehicle("RECENT", "online", lastReceivedAgoSeconds: 3),
            Vehicle("STALE", "asleep", lastReceivedAgoSeconds: 600),
        ]);
        var display = Project(SuccessModel(status));

        var live = display.VehicleRows[0];
        Assert.False(live.IsStale);
        Assert.Equal("Live", live.StatusText);
        Assert.Equal(StatusKind.Success, live.StatusStatus);

        var stale = display.VehicleRows[1];
        Assert.True(stale.IsStale);
        Assert.Equal("Stale", stale.StatusText);
        Assert.Equal(StatusKind.Warning, stale.StatusStatus);
    }

    [Fact]
    public void Vehicle_without_last_received_is_stale_with_em_dash()
    {
        var status = SampleStatus(vehicles: [new MqttVehicleRow("NOTS", null, 10, 1, null, null)]);
        var display = Project(SuccessModel(status));

        var row = display.VehicleRows[0];
        Assert.False(row.HasState);
        Assert.Equal("\u2014", row.StateText);
        Assert.Equal("\u2014", row.SigPerSecText);
        Assert.Equal("\u2014", row.LastReceivedText);
        Assert.True(row.IsStale);
    }

    [Fact]
    public void Vehicle_count_and_stale_count_text_track_the_fleet()
    {
        var status = SampleStatus(vehicles:
        [
            Vehicle("A", lastReceivedAgoSeconds: 3),
            Vehicle("B", lastReceivedAgoSeconds: 600),
            Vehicle("C", lastReceivedAgoSeconds: 900),
        ]);
        var display = Project(SuccessModel(status));

        Assert.True(display.ShowVehicleCount);
        Assert.Equal("3 vehicles", display.VehicleCountText);
        Assert.True(display.ShowStaleCount);
        Assert.Equal("2 Stale", display.StaleCountText);
    }

    [Fact]
    public void No_vehicles_hides_the_counts_and_keeps_the_empty_message()
    {
        var display = Project(SuccessModel(SampleStatus(vehicles: Array.Empty<MqttVehicleRow>())));

        Assert.False(display.ShowVehicleCount);
        Assert.False(display.ShowStaleCount);
        Assert.Empty(display.VehicleRows);
        Assert.Equal("No vehicles currently streaming", display.NoVehiclesMessage);
    }

    // ---- tolerant JSON parsing (web useMQTTStatus normalisation) -------------------

    [Fact]
    public void Parse_reads_the_object_map_of_vehicles_keyed_by_vin()
    {
        var json = Json("""
        {
          "connected": true,
          "broker": "tcp://broker:1883",
          "uptime_seconds": 120,
          "topics": ["telemetry/+/v/+"],
          "vehicles": {
            "VIN1": { "state": "online", "signal_count": 500, "batch_count": 10, "signals_per_second": 4.5, "last_received": "2026-06-12T11:59:55Z" }
          }
        }
        """);

        var snapshot = MqttStatusSnapshot.FromJson(json);

        Assert.True(snapshot.HasStatus);
        Assert.True(snapshot.Connected);
        Assert.Equal("tcp://broker:1883", snapshot.Broker);
        Assert.Equal(120, snapshot.UptimeSeconds);
        Assert.Single(snapshot.Vehicles);
        Assert.Equal("VIN1", snapshot.Vehicles[0].Vin);
        Assert.Equal(500, snapshot.Vehicles[0].SignalCount);
        Assert.Equal(4.5, snapshot.Vehicles[0].SignalsPerSecond);
    }

    [Fact]
    public void Parse_reads_the_array_of_vehicles_with_camel_case_aliases()
    {
        var json = Json("""
        {
          "connected": false,
          "uptimeSeconds": 99,
          "vehicles": [
            { "vin": "VINA", "signalCount": 7, "batchCount": 2, "signalsPerSecond": 1.0 }
          ]
        }
        """);

        var snapshot = MqttStatusSnapshot.FromJson(json);

        Assert.False(snapshot.Connected);
        Assert.Equal(99, snapshot.UptimeSeconds);
        Assert.Single(snapshot.Vehicles);
        Assert.Equal("VINA", snapshot.Vehicles[0].Vin);
        Assert.Equal(7, snapshot.Vehicles[0].SignalCount);
    }

    [Fact]
    public void Parse_falls_back_to_the_streaming_vehicles_alias()
    {
        var json = Json("""
        {
          "connected": true,
          "streaming_vehicles": { "VINB": { "signal_count": 3 } }
        }
        """);

        var snapshot = MqttStatusSnapshot.FromJson(json);

        Assert.Single(snapshot.Vehicles);
        Assert.Equal("VINB", snapshot.Vehicles[0].Vin);
        Assert.Equal(3, snapshot.Vehicles[0].SignalCount);
    }

    [Fact]
    public void Parse_aggregates_totals_across_vehicles()
    {
        var json = Json("""
        {
          "connected": true,
          "vehicles": [
            { "vin": "A", "signal_count": 100, "batch_count": 5, "signals_per_second": 2.5 },
            { "vin": "B", "signal_count": 200, "batch_count": 9, "signals_per_second": 7.5 }
          ]
        }
        """);

        var snapshot = MqttStatusSnapshot.FromJson(json);

        Assert.Equal(300, snapshot.TotalSignals);
        Assert.Equal(14, snapshot.TotalBatches);
        Assert.Equal(10.0, snapshot.TotalRate);
    }

    [Fact]
    public void Parse_of_a_non_object_payload_is_the_absent_snapshot()
    {
        Assert.Same(MqttStatusSnapshot.Empty, MqttStatusSnapshot.FromJson(Json("[]")));
        Assert.Same(MqttStatusSnapshot.Empty, MqttStatusSnapshot.FromJson(Json("null")));
        Assert.False(MqttStatusSnapshot.FromJson(Json("42")).HasStatus);
    }

    // ---- view-model lifecycle ------------------------------------------------------

    [Fact]
    public async Task LoadAsync_resolves_to_the_success_state()
    {
        var feed = new FakeMqttFeed().Returns(SampleStatus());
        using var vm = new MQTTInspectorPageViewModel(feed, PassthroughLocalizer.Instance, () => Now);

        Assert.Equal(MqttInspectorState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(MqttInspectorState.Success, vm.State);
        Assert.True(vm.Display.HasStatus);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.Calls);
    }

    [Fact]
    public async Task LoadAsync_error_with_no_status_surfaces_the_banner()
    {
        var feed = new FakeMqttFeed().Throws(new InvalidOperationException("network down"));
        using var vm = new MQTTInspectorPageViewModel(feed, PassthroughLocalizer.Instance, () => Now);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowErrorBanner);
        Assert.Equal("network down", vm.Display.ErrorBannerMessage);
        Assert.Equal(MqttInspectorState.Empty, vm.State);
    }

    [Fact]
    public async Task RefreshAsync_keeps_the_prior_status_when_a_later_read_fails()
    {
        var feed = new FakeMqttFeed().Returns(SampleStatus()).Throws(new InvalidOperationException("blip"));
        using var vm = new MQTTInspectorPageViewModel(feed, PassthroughLocalizer.Instance, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.True(vm.Display.HasStatus);          // prior data persists
        Assert.False(vm.Display.ShowErrorBanner);   // banner stays hidden because a status is present
        Assert.Equal(MqttInspectorState.Success, vm.State);
    }

    [Fact]
    public async Task LoadAsync_accumulates_throughput_until_the_chart_is_ready()
    {
        var feed = new FakeMqttFeed()
            .Returns(StatusWithSignals(1_000))
            .Returns(StatusWithSignals(1_500))
            .Returns(StatusWithSignals(1_800))
            .Returns(StatusWithSignals(2_400));
        using var vm = new MQTTInspectorPageViewModel(feed, PassthroughLocalizer.Instance, () => Now);

        await vm.LoadAsync();
        Assert.False(vm.Display.ChartReady); // 1 point

        await vm.RefreshAsync();
        await vm.RefreshAsync();
        await vm.RefreshAsync();

        Assert.True(vm.Display.ChartReady);  // 4 points > 2
        Assert.NotNull(vm.Display.ThroughputSeries);
        Assert.Equal(4, vm.Display.ThroughputSeries!.Points.Count);
    }

    [Fact]
    public async Task LoadAsync_skips_the_initial_zero_throughput_sample()
    {
        var feed = new FakeMqttFeed()
            .Returns(StatusWithSignals(0))
            .Returns(StatusWithSignals(0))
            .Returns(StatusWithSignals(0))
            .Returns(StatusWithSignals(100))
            .Returns(StatusWithSignals(250));
        using var vm = new MQTTInspectorPageViewModel(feed, PassthroughLocalizer.Instance, () => Now);

        for (var i = 0; i < 5; i++)
        {
            await vm.RefreshAsync();
        }

        // The three leading zero samples are skipped (web `totalSignals === 0 && prevTotalRef === null`),
        // so only two points accumulate from the 100 -> 250 progression — not enough to render the chart.
        Assert.False(vm.Display.ChartReady);
    }

    [Fact]
    public void NotifyOpened_records_a_pii_safe_diagnostics_event()
    {
        var events = new List<string>();
        var diagnostics = new MqttInspectorDiagnostics(events.Add);
        using var vm = new MQTTInspectorPageViewModel(EmptyMqttStatusFeed.Instance, PassthroughLocalizer.Instance, () => Now, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=MQTTInspectorPage", events);
    }

    // ---- generated-client feed (web useMQTTStatus -> GET /telemetry) ---------------

    [Fact]
    public async Task ClientFeed_issues_the_telemetry_operation_and_parses_the_body()
    {
        var json = Json("""{ "connected": true, "vehicles": { "V": { "signal_count": 9 } } }""");
        var api = new FakeApiClient().ReturnsValue(json);
        var feed = new MqttStatusClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_telemetry", api.Requests[0].OperationId);
        Assert.True(snapshot.Connected);
        Assert.Equal(9, snapshot.Vehicles[0].SignalCount);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_absent_snapshot()
    {
        var snapshot = await EmptyMqttStatusFeed.Instance.FetchAsync(default);
        Assert.False(snapshot.HasStatus);
        Assert.Empty(snapshot.Vehicles);
    }

    [Fact]
    public void Registration_exposes_the_route_operation_and_slug()
    {
        Assert.Equal("MQTTInspector", MqttInspectorRegistration.RouteName);
        Assert.Equal("get_api_v1_telemetry", MqttInspectorRegistration.TelemetryOperation);
        Assert.Equal("MQTTInspectorPage", MqttInspectorRegistration.Slug);
        Assert.Equal(120, MqttInspectorRegistration.StaleThresholdSeconds);
        Assert.Equal("MQTT Inspector", MqttInspectorRegistration.Title(PassthroughLocalizer.Instance));
    }

    // ---- helpers -------------------------------------------------------------------

    private static MqttStatusSnapshot StatusWithSignals(long total) =>
        new(true, true, "tcp://b:1883", 100, ["t"], [new MqttVehicleRow("V", "online", total, 1, 1.0, Now.ToString("o", CultureInfo.InvariantCulture))]);

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

    private sealed class FakeMqttFeed : IMqttStatusFeed
    {
        private readonly Queue<Func<MqttStatusSnapshot>> _results = new();

        public int Calls { get; private set; }

        public FakeMqttFeed Returns(MqttStatusSnapshot snapshot)
        {
            _results.Enqueue(() => snapshot);
            return this;
        }

        public FakeMqttFeed Throws(Exception exception)
        {
            _results.Enqueue(() => throw exception);
            return this;
        }

        public Task<MqttStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls++;
            var next = _results.Count > 0 ? _results.Dequeue() : () => MqttStatusSnapshot.Empty;
            return Task.FromResult(next());
        }
    }
}
