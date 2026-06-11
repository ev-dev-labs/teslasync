using System.Net.Http;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the Telemetry Pipeline surface's UI-thread-free logic — the streaming/polling
/// JSON parse adapters, the liveness union + age ladder, the projection (fleet rollup, liveness chips,
/// connectivity chips, battery + relative-time labels, Narrator names), the cache-then-network result
/// mappers, the repository source's request shapes (the generated streaming op + the non-contract polling
/// GET), the state-holder view-model's chrome state matrix (loading / ready / empty / error / stale /
/// offline), the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/TelemetryPipelineCard.tsx).
/// </summary>
public sealed class TelemetryPipelineCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private const string TwoMinAgo = "2026-06-06T11:58:00Z";   // < 5m  → sending
    private const string TenMinAgo = "2026-06-06T11:50:00Z";   // 5-30m → slow
    private const string OneHourAgo = "2026-06-06T11:00:00Z";  // > 30m → stale

    // ---- Streaming-status parse adapter --------------------------------------------

    [Fact]
    public void Stream_parses_object_map_and_connected_flag()
    {
        const string json = """
        {"connected":true,"vehicles":{
          "5YJ3E1EA1KF000001":{"lastReceived":"2026-06-06T11:58:00Z","signalsPerSecond":4.2,"signalCount":240}}}
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = TelemetryStreamSnapshot.ParseEnvelope(doc.RootElement);

        Assert.True(snapshot.Connected);
        var v = Assert.Single(snapshot.Vehicles);
        Assert.Equal("5YJ3E1EA1KF000001", v.Vin);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 58, 0, TimeSpan.Zero), v.LastReceived);
        Assert.Equal(240, v.SignalCount);
    }

    [Fact]
    public void Stream_parses_array_form_and_snake_case_aliases()
    {
        const string json = """
        {"connected":false,"vehicles":[
          {"vin":"VINA","last_received":"2026-06-06T11:50:00Z","signals_per_second":1.0,"signal_count":12}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = TelemetryStreamSnapshot.ParseEnvelope(doc.RootElement);

        Assert.False(snapshot.Connected);
        var v = Assert.Single(snapshot.Vehicles);
        Assert.Equal("VINA", v.Vin);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 50, 0, TimeSpan.Zero), v.LastReceived);
    }

    [Fact]
    public void Stream_falls_back_to_streaming_vehicles_alias_and_tolerates_non_object()
    {
        using var alias = JsonDocument.Parse("""{"connected":true,"streaming_vehicles":{"VINB":{"last_received":"2026-06-06T11:00:00Z"}}}""");
        var snapshot = TelemetryStreamSnapshot.ParseEnvelope(alias.RootElement);
        Assert.Equal("VINB", Assert.Single(snapshot.Vehicles).Vin);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Same(TelemetryStreamSnapshot.Empty, ReferenceOrEmpty(TelemetryStreamSnapshot.ParseEnvelope(notObject.RootElement)));
    }

    private static TelemetryStreamSnapshot ReferenceOrEmpty(TelemetryStreamSnapshot s) =>
        s.Vehicles.Count == 0 && !s.Connected ? TelemetryStreamSnapshot.Empty : s;

    // ---- Polling-status parse adapter ----------------------------------------------

    [Fact]
    public void Polling_parses_enabled_flag_and_per_vin_map()
    {
        const string json = """
        {"enabled":true,"vehicles":{
          "VINA":{"last_poll_time":"2026-06-06T11:58:00Z","next_poll_after":"2026-06-06T12:05:00Z","battery_level":82}}}
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = PollingEngineSnapshot.ParseEnvelope(doc.RootElement);

        Assert.True(snapshot.Enabled);
        var v = Assert.Single(snapshot.Vehicles);
        Assert.Equal("VINA", v.Vin);
        Assert.Equal(82, v.BatteryLevel);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 58, 0, TimeSpan.Zero), v.LastPoll);
        Assert.Equal("2026-06-06T12:05:00Z", v.NextPollAfter);
    }

    [Fact]
    public void Polling_defaults_enabled_true_when_absent()
    {
        using var doc = JsonDocument.Parse("""{"vehicles":{}}""");
        var snapshot = PollingEngineSnapshot.ParseEnvelope(doc.RootElement);
        Assert.True(snapshot.Enabled); // web: pollingStatus?.enabled !== false
        Assert.Empty(snapshot.Vehicles);
    }

    // ---- Liveness union + age ladder (web liveness()) ------------------------------

    [Theory]
    [InlineData(TwoMinAgo, TelemetryLiveness.Sending)]
    [InlineData(TenMinAgo, TelemetryLiveness.Slow)]
    [InlineData(OneHourAgo, TelemetryLiveness.Stale)]
    public void Liveness_age_ladder_matches_web(string lastSeen, TelemetryLiveness expected)
    {
        var stream = TelemetryPipelineCardJson.TryParseTimestamp(lastSeen);
        var result = TelemetryPipelineLiveness.Evaluate(null, stream, Now);
        Assert.Equal(expected, result.Level);
        Assert.Equal(TelemetryLivenessSource.Stream, result.Source);
    }

    [Fact]
    public void Liveness_offline_when_no_timestamps()
    {
        var result = TelemetryPipelineLiveness.Evaluate(null, null, Now);
        Assert.Equal(TelemetryLiveness.Offline, result.Level);
        Assert.Equal(TelemetryLivenessSource.None, result.Source);
        Assert.Null(result.LastSeen);
    }

    [Fact]
    public void Liveness_uses_freshest_of_poll_and_stream_and_reports_source()
    {
        var poll = TelemetryPipelineCardJson.TryParseTimestamp(OneHourAgo);
        var stream = TelemetryPipelineCardJson.TryParseTimestamp(TwoMinAgo);

        var streamWins = TelemetryPipelineLiveness.Evaluate(poll, stream, Now);
        Assert.Equal(TelemetryLivenessSource.Stream, streamWins.Source);
        Assert.Equal(TelemetryLiveness.Sending, streamWins.Level);

        var pollWins = TelemetryPipelineLiveness.Evaluate(stream, poll, Now);
        Assert.Equal(TelemetryLivenessSource.Poll, pollWins.Source);
        Assert.Equal(TelemetryLiveness.Sending, pollWins.Level);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_five_fleet_cells_with_connected_count_and_em_dash()
    {
        var display = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA") },
            stream: null,
            polling: null,
            positionCount: 1234,
            drivesCount: 56,
            chargingSessionsCount: null,
            signalLogCount: 9000,
            Localizer,
            Now);

        Assert.Equal(5, display.FleetCells.Count);
        Assert.Equal("Vehicles", display.FleetCells[0].Label);
        Assert.Equal("1 connected", display.FleetCells[0].Value);
        Assert.Equal("\u2014", display.FleetCells[3].Value); // null charging sessions
        Assert.True(display.HasVehicles);
    }

    [Fact]
    public void Project_none_configured_when_roster_empty()
    {
        var display = TelemetryPipelineProjection.Project(
            Array.Empty<TelemetryPipelineVehicle>(), null, null, 0, 0, 0, 0, Localizer, Now);

        Assert.Equal("none configured", display.FleetCells[0].Value);
        Assert.False(display.HasVehicles);
        Assert.Empty(display.LivenessChips);
    }

    [Fact]
    public void Project_builds_vehicle_row_with_battery_liveness_and_source()
    {
        var stream = new TelemetryStreamSnapshot(true, new[]
        {
            new TelemetryStreamVehicle("VINA", TwoMinAgo, 4.0, 200),
        });
        var polling = new PollingEngineSnapshot(true, new[]
        {
            new PollingVehicleStatus("VINA", TenMinAgo, "2026-06-06T12:05:00Z", 80),
        });

        var display = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA", "My Car", "online") }, stream, polling, 0, 0, 0, 0, Localizer, Now);

        var row = Assert.Single(display.VehicleRows);
        Assert.Equal("My Car", row.DisplayName);
        Assert.Equal("VIN \u00b7\u00b7\u00b7VINA", row.VinTailText);
        Assert.Equal("online", row.StateLabel);
        Assert.Equal(TelemetryLiveness.Sending, row.Liveness); // stream 2m beats poll 10m
        Assert.Equal("stream", row.SourceLabel);
        Assert.Equal(80, row.BatteryPercent);
        Assert.Equal(StatusKind.Success, row.BatteryStatus);
        Assert.True(row.HasNextPoll);
        Assert.Contains("My Car", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("80%", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_liveness_chips_count_each_bucket()
    {
        var stream = new TelemetryStreamSnapshot(true, new[]
        {
            new TelemetryStreamVehicle("VINA", TwoMinAgo, 1, 1),  // sending
            new TelemetryStreamVehicle("VINB", OneHourAgo, 1, 1), // stale
        });
        var display = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA"), Vehicle("VINB"), Vehicle("VINC") }, // VINC has no signal → offline
            stream,
            polling: null,
            0, 0, 0, 0,
            Localizer,
            Now);

        Assert.Equal(3, display.VehicleRows.Count);
        Assert.Contains(display.LivenessChips, c => c.Level == TelemetryLiveness.Sending && c.Count == 1);
        Assert.Contains(display.LivenessChips, c => c.Level == TelemetryLiveness.Stale && c.Count == 1);
        Assert.Contains(display.LivenessChips, c => c.Level == TelemetryLiveness.Offline && c.Count == 1);
        Assert.DoesNotContain(display.LivenessChips, c => c.Level == TelemetryLiveness.Slow);
    }

    [Fact]
    public void Project_connectivity_polling_off_chip_only_when_disabled_and_streaming()
    {
        var connected = new TelemetryStreamSnapshot(true, Array.Empty<TelemetryStreamVehicle>());

        var disabledWhileStreaming = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA") }, connected, new PollingEngineSnapshot(false, Array.Empty<PollingVehicleStatus>()),
            0, 0, 0, 0, Localizer, Now).Connectivity;
        Assert.True(disabledWhileStreaming.MqttConnected);
        Assert.True(disabledWhileStreaming.ShowPollingChip);
        Assert.Equal("polling engine off (streaming-only)", disabledWhileStreaming.PollingLabel);
        Assert.Equal(StatusKind.Neutral, disabledWhileStreaming.PollingStatus);

        var enabled = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA") }, connected, new PollingEngineSnapshot(true, Array.Empty<PollingVehicleStatus>()),
            0, 0, 0, 0, Localizer, Now).Connectivity;
        Assert.False(enabled.ShowPollingChip);

        var disconnected = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA") }, new TelemetryStreamSnapshot(false, Array.Empty<TelemetryStreamVehicle>()),
            new PollingEngineSnapshot(false, Array.Empty<PollingVehicleStatus>()), 0, 0, 0, 0, Localizer, Now).Connectivity;
        Assert.False(disconnected.MqttConnected);
        Assert.Equal("MQTT broker disconnected", disconnected.MqttLabel);
        Assert.Equal("polling engine disabled", disconnected.PollingLabel);
        Assert.Equal(StatusKind.Warning, disconnected.PollingStatus);
    }

    [Fact]
    public void RelativeTime_matches_web_ladder_and_em_dash()
    {
        Assert.Equal("\u2014", TelemetryPipelineProjection.RelativeTime(null, Now, Localizer));
        Assert.Equal("2 min ago", TelemetryPipelineProjection.RelativeTime(
            TelemetryPipelineCardJson.TryParseTimestamp(TwoMinAgo), Now, Localizer));
        Assert.Equal("1h ago", TelemetryPipelineProjection.RelativeTime(
            TelemetryPipelineCardJson.TryParseTimestamp(OneHourAgo), Now, Localizer));
        Assert.Equal("in 5 min", TelemetryPipelineProjection.RelativeTime(
            TelemetryPipelineCardJson.TryParseTimestamp("2026-06-06T12:05:00Z"), Now, Localizer));
    }

    [Fact]
    public void VinTail_masks_to_last_four_or_fallback_marker()
    {
        Assert.Equal("0001", TelemetryPipelineProjection.VinTail("5YJ3E1EA1KF000001"));
        Assert.Equal("AB", TelemetryPipelineProjection.VinTail("AB"));
        Assert.Equal("????", TelemetryPipelineProjection.VinTail(null));
    }

    // ---- Result mappers (cache-then-network preservation) --------------------------

    [Fact]
    public void MapStreaming_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"connected":true,"vehicles":{}}""");

        var cached = TelemetryPipelineResultMapper.MapStreaming(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.Connected);

        var failure = TelemetryPipelineResultMapper.MapStreaming(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);

        Assert.Equal(LoadStatus.Loading, TelemetryPipelineResultMapper.MapStreaming(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    [Fact]
    public void MapPolling_maps_offline_keeping_value()
    {
        using var doc = JsonDocument.Parse("""{"enabled":false,"vehicles":{}}""");
        var offline = TelemetryPipelineResultMapper.MapPolling(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.False(offline.Value!.Enabled);
    }

    // ---- View-model: chrome state matrix -------------------------------------------

    [Fact]
    public async Task ViewModel_loading_until_stream_resolves()
    {
        using var vm = NewViewModel(
            stream: Script(RepositoryResult<TelemetryStreamSnapshot>.Loading()),
            polling: Script(RepositoryResult<PollingEngineSnapshot>.Loading()));
        vm.SetFleetContext(new[] { Vehicle("VINA") }, 1, 1, 1, 1);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_ready_with_rows_and_connectivity()
    {
        var stream = new TelemetryStreamSnapshot(true, new[] { new TelemetryStreamVehicle("VINA", TwoMinAgo, 4, 200) });
        var polling = new PollingEngineSnapshot(true, new[] { new PollingVehicleStatus("VINA", TwoMinAgo, "2026-06-06T12:05:00Z", 70) });

        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.Loaded(stream, Now)),
            Script(RepositoryResult<PollingEngineSnapshot>.Loaded(polling, Now)));
        vm.SetFleetContext(new[] { Vehicle("VINA", "My Car", "online") }, 10, 2, 3, 400);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Ready, vm.State);
        Assert.True(vm.Display.HasVehicles);
        Assert.True(vm.Display.Connectivity.MqttConnected);
        Assert.Equal(70, Assert.Single(vm.Display.VehicleRows).BatteryPercent);
        Assert.True(vm.PollingAvailable);
        Assert.NotNull(vm.StreamUpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_vehicles()
    {
        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.Loaded(new TelemetryStreamSnapshot(true, Array.Empty<TelemetryStreamVehicle>()), Now)),
            Script(RepositoryResult<PollingEngineSnapshot>.Empty(Now)));
        vm.SetFleetContext(Array.Empty<TelemetryPipelineVehicle>(), 0, 0, 0, 0);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Empty, vm.State);
        Assert.False(vm.Display.HasVehicles);
        Assert.Equal("No vehicles configured yet. Add a vehicle from the Tesla account page to see per-vehicle telemetry status.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_stream_fails_with_no_cache()
    {
        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))),
            Script(RepositoryResult<PollingEngineSnapshot>.Empty(Now)));
        vm.SetFleetContext(new[] { Vehicle("VINA") }, 1, 1, 1, 1);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Error, vm.State);
        Assert.True(vm.StreamIsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.StreamAttempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_keeps_content()
    {
        var stream = new TelemetryStreamSnapshot(true, new[] { new TelemetryStreamVehicle("VINA", TwoMinAgo, 4, 200) });
        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.Cached(stream, Now, stale: true)),
            Script(RepositoryResult<PollingEngineSnapshot>.Empty(Now)));
        vm.SetFleetContext(new[] { Vehicle("VINA") }, 1, 1, 1, 1);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Stale, vm.State);
        Assert.True(vm.StreamIsStale);
        Assert.True(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_and_sets_error_chip()
    {
        var stream = new TelemetryStreamSnapshot(true, new[] { new TelemetryStreamVehicle("VINA", TwoMinAgo, 4, 200) });
        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.OfflineCached(stream, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))),
            Script(RepositoryResult<PollingEngineSnapshot>.Empty(Now)));
        vm.SetFleetContext(new[] { Vehicle("VINA") }, 1, 1, 1, 1);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Offline, vm.State);
        Assert.True(vm.StreamIsError);
        Assert.True(vm.StreamIsStale);
        Assert.True(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_polling_failure_is_non_fatal()
    {
        var stream = new TelemetryStreamSnapshot(true, new[] { new TelemetryStreamVehicle("VINA", TwoMinAgo, 4, 200) });
        using var vm = NewViewModel(
            Script(RepositoryResult<TelemetryStreamSnapshot>.Loaded(stream, Now)),
            Script(RepositoryResult<PollingEngineSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Network, "down"))));
        vm.SetFleetContext(new[] { Vehicle("VINA") }, 1, 1, 1, 1);

        await vm.LoadAsync();

        Assert.Equal(TelemetryPipelineState.Ready, vm.State); // polling failure does not break the card
        Assert.False(vm.PollingAvailable);
    }

    // ---- Repository source request shapes ------------------------------------------

    [Fact]
    public async Task Source_streams_telemetry_via_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"connected":true,"vehicles":{"VINA":{"last_received":"2026-06-06T11:58:00Z"}}}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        using var http = new HttpClient(new StubHttpMessageHandler("{}")) { BaseAddress = new Uri("http://localhost") };
        var source = NewSource(client, http);

        var emissions = await Collect(source.StreamStreamingStatusAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.Connected);
        Assert.Single(emissions[^1].Value!.Vehicles);
        Assert.Equal("get_api_v1_telemetry", client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_polling_GET_targets_the_versioned_polling_status_route()
    {
        var client = new FakeApiClient();
        var handler = new StubHttpMessageHandler("""{"enabled":true,"vehicles":{"VINA":{"battery_level":55}}}""");
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost") };
        var source = NewSource(client, http);

        var emissions = await Collect(source.StreamPollingStatusAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.Enabled);
        Assert.Equal(55, Assert.Single(emissions[^1].Value!.Vehicles).BatteryLevel);
        Assert.NotNull(handler.LastRequestUri);
        Assert.Equal("/api/v1/polling/status", handler.LastRequestUri!.AbsolutePath);
        Assert.Equal(HttpMethod.Get, handler.LastMethod);
    }

    [Fact]
    public async Task Source_polling_failure_surfaces_as_repository_failure()
    {
        var client = new FakeApiClient();
        var handler = new StubHttpMessageHandler(string.Empty, System.Net.HttpStatusCode.InternalServerError);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost") };
        var source = NewSource(client, http);

        var emissions = await Collect(source.StreamPollingStatusAsync());

        Assert.Equal(LoadStatus.Error, emissions[^1].Status);
    }

    // ---- Registry + diagnostics + accessibility ------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("telemetry-pipeline-card", TelemetryPipelineCardRegistration.Id);
        Assert.Equal("TelemetryPipelineCard", TelemetryPipelineCardRegistration.Slug);
        Assert.Equal("Telemetry pipeline", TelemetryPipelineCardRegistration.AccessibleName(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TelemetryPipelineCardDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TelemetryPipelineCard", Assert.Single(sink));
    }

    [Fact]
    public void Accessibility_names_are_present_on_rows_and_chips()
    {
        var stream = new TelemetryStreamSnapshot(true, new[] { new TelemetryStreamVehicle("VINA", TwoMinAgo, 4, 200) });
        var display = TelemetryPipelineProjection.Project(
            new[] { Vehicle("VINA", "My Car", "online") }, stream, null, 0, 0, 0, 0, Localizer, Now);

        var row = Assert.Single(display.VehicleRows);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.All(display.LivenessChips, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
    }

    // ---- helpers -------------------------------------------------------------------

    private static TelemetryPipelineCardViewModel NewViewModel(
        IReadOnlyList<RepositoryResult<TelemetryStreamSnapshot>> stream,
        IReadOnlyList<RepositoryResult<PollingEngineSnapshot>> polling) =>
        new(new FakeSource(stream, polling), Localizer, () => Now);

    private static TelemetryPipelineCardSource NewSource(IApiClient client, HttpClient http)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new TelemetryPipelineCardSource(client, http, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<T>>> Collect<T>(IAsyncEnumerable<RepositoryResult<T>> stream)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static IReadOnlyList<RepositoryResult<T>> Script<T>(params RepositoryResult<T>[] results) => results;

    private static TelemetryPipelineVehicle Vehicle(string vin, string? name = null, string? state = "online") =>
        new(Id: vin.GetHashCode() & 0x7fffffff, Vin: vin, DisplayName: name, State: state);

    private sealed class FakeSource : ITelemetryPipelineCardSource
    {
        private readonly IReadOnlyList<RepositoryResult<TelemetryStreamSnapshot>> _stream;
        private readonly IReadOnlyList<RepositoryResult<PollingEngineSnapshot>> _polling;

        public FakeSource(
            IReadOnlyList<RepositoryResult<TelemetryStreamSnapshot>> stream,
            IReadOnlyList<RepositoryResult<PollingEngineSnapshot>> polling)
        {
            _stream = stream;
            _polling = polling;
        }

        public async IAsyncEnumerable<RepositoryResult<TelemetryStreamSnapshot>> StreamStreamingStatusAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _stream)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }

        public async IAsyncEnumerable<RepositoryResult<PollingEngineSnapshot>> StreamPollingStatusAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _polling)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly string _body;
        private readonly System.Net.HttpStatusCode _status;

        public StubHttpMessageHandler(string body, System.Net.HttpStatusCode status = System.Net.HttpStatusCode.OK)
        {
            _body = body;
            _status = status;
        }

        public Uri? LastRequestUri { get; private set; }

        public HttpMethod? LastMethod { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequestUri = request.RequestUri;
            LastMethod = request.Method;
            var response = new HttpResponseMessage(_status)
            {
                Content = new StringContent(_body, Encoding.UTF8, "application/json"),
            };
            return Task.FromResult(response);
        }
    }
}
