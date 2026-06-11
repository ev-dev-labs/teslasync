using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Service Health surface's UI-thread-free logic — the telemetry-status JSON
/// parse adapter (enabled / mode / aggregate_stats / streaming_vehicles map), the cache-then-network result
/// mapper, the projection (the enabled/streaming header badges, the four metric tile values, the per-row
/// streaming status, the <c>fmtInt</c>/<c>fmtNumber</c> formatting, the sortable signal-count cell and the
/// Narrator names), the repository source's request shape (the <c>get_api_v1_telemetry</c> operation), the
/// state-holder view-model's state matrix (loading / loaded / empty / error / stale / offline) and refresh
/// flow, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/ServiceHealthSection.tsx).
/// </summary>
public sealed class ServiceHealthSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string TelemetryJson = """
        {
          "enabled": true,
          "mode": "fleet_telemetry",
          "streaming_vehicles": {
            "5YJ3E1EA1KF000001": {"vin":"5YJ3E1EA1KF000001","is_streaming":true,"signal_count":12345,
              "signals_per_second":1.5,"latency_ms":42.0,"last_received":"2026-06-06T11:59:00Z"},
            "5YJ3E1EA1KF000002": {"vin":"5YJ3E1EA1KF000002","is_streaming":false,"signal_count":7,
              "signals_per_second":0,"latency_ms":0,"last_received":null}
          },
          "aggregate_stats": {"total_signals_received": 1000000, "avg_signals_per_second": "12.34"}
        }
        """;

    // ---- JSON parse adapter --------------------------------------------------------

    [Fact]
    public void Snapshot_parses_real_api_fields()
    {
        using var doc = JsonDocument.Parse(TelemetryJson);
        var snap = ServiceHealthSnapshot.FromJson(doc.RootElement);

        Assert.True(snap.Enabled);
        Assert.Equal("fleet_telemetry", snap.Mode);
        Assert.Equal(1_000_000, snap.TotalSignalsReceived);
        Assert.Equal("12.34", snap.AvgSignalsPerSecond);
        Assert.Equal(2, snap.Vehicles.Count);
        Assert.Equal(1, snap.ActiveCount);

        var streaming = snap.Vehicles.Single(v => v.Vin == "5YJ3E1EA1KF000001");
        Assert.True(streaming.IsStreaming);
        Assert.Equal(12345, streaming.SignalCount);
        Assert.Equal(1.5, streaming.SignalsPerSecond);
        Assert.Equal(42.0, streaming.LatencyMs);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 0, TimeSpan.Zero), streaming.LastReceived);

        var idle = snap.Vehicles.Single(v => v.Vin == "5YJ3E1EA1KF000002");
        Assert.False(idle.IsStreaming);
        Assert.Null(idle.LastReceived);
    }

    [Fact]
    public void Snapshot_is_tolerant_of_missing_fields_and_non_object()
    {
        using var partial = JsonDocument.Parse("""{"streaming_vehicles":{"A":{"vin":"A"}}}""");
        var snap = ServiceHealthSnapshot.FromJson(partial.RootElement);
        Assert.False(snap.Enabled);
        Assert.Equal(string.Empty, snap.Mode);
        Assert.Equal(0, snap.TotalSignalsReceived);
        Assert.Null(snap.AvgSignalsPerSecond);
        var vehicle = Assert.Single(snap.Vehicles);
        Assert.Equal("A", vehicle.Vin);
        Assert.Equal(0, vehicle.SignalCount);
        Assert.Null(vehicle.LastReceived);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(ServiceHealthSnapshot.FromJson(notObject.RootElement).Vehicles);
    }

    [Fact]
    public void Vehicle_uses_map_key_when_entry_omits_its_own_vin()
    {
        using var doc = JsonDocument.Parse("""{"streaming_vehicles":{"MAPKEY":{"is_streaming":true}}}""");
        var vehicle = Assert.Single(ServiceHealthSnapshot.FromJson(doc.RootElement).Vehicles);
        Assert.Equal("MAPKEY", vehicle.Vin);
    }

    [Fact]
    public void AvgSignalsPerSecond_tolerates_a_numeric_payload()
    {
        using var doc = JsonDocument.Parse("""{"aggregate_stats":{"avg_signals_per_second":5.5}}""");
        Assert.Equal("5.5", ServiceHealthSnapshot.FromJson(doc.RootElement).AvgSignalsPerSecond);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_header_badges_metrics_and_rows_match_web()
    {
        using var doc = JsonDocument.Parse(TelemetryJson);
        var display = ServiceHealthProjection.Project(ServiceHealthSnapshot.FromJson(doc.RootElement), Localizer, Now);

        // Header badges (web data ? <Badge enabled?'success':'neutral'>… + <Badge info>{n} streaming</Badge>).
        Assert.True(display.EnabledFlag);
        Assert.Equal("Enabled", display.EnabledBadgeText);
        Assert.Equal(StatusKind.Success, display.EnabledBadgeStatus);
        Assert.Equal(1, display.ActiveCount);
        Assert.Equal("1 streaming", display.StreamingBadgeText);

        // Four metric tiles (Mode, Vehicles Connected, Total Signals [fmtInt], Avg Signals/s).
        Assert.Equal("fleet_telemetry", display.ModeValue);
        Assert.Equal("1", display.VehiclesConnectedValue);
        Assert.Equal("1,000,000", display.TotalSignalsValue);
        Assert.Equal("12.34", display.AvgSignalsValue);

        // Vehicle rows.
        Assert.True(display.HasVehicles);
        Assert.Equal(2, display.VehicleRows.Count);

        var streaming = display.VehicleRows.Single(r => r.Vin == "5YJ3E1EA1KF000001");
        Assert.Equal("Streaming", streaming.StatusText);
        Assert.Equal(StatusKind.Success, streaming.StatusKind);
        Assert.Equal("12,345", streaming.SignalCount.Display);
        Assert.Equal(12345, streaming.SignalCount.Value);
        Assert.Equal("1.5", streaming.SignalsPerSecondText);
        Assert.Equal("42 ms", streaming.LatencyText);
        Assert.NotEqual("\u2014", streaming.LastReceivedText);

        var idle = display.VehicleRows.Single(r => r.Vin == "5YJ3E1EA1KF000002");
        Assert.Equal("Idle", idle.StatusText);
        Assert.Equal(StatusKind.Neutral, idle.StatusKind);
        Assert.Equal("\u2014", idle.LastReceivedText);
    }

    [Fact]
    public void Project_disabled_snapshot_renders_neutral_disabled_badge_and_zero_metrics()
    {
        using var doc = JsonDocument.Parse("""{"enabled":false,"mode":"polling"}""");
        var display = ServiceHealthProjection.Project(ServiceHealthSnapshot.FromJson(doc.RootElement), Localizer, Now);

        Assert.False(display.EnabledFlag);
        Assert.Equal("Disabled", display.EnabledBadgeText);
        Assert.Equal(StatusKind.Neutral, display.EnabledBadgeStatus);
        Assert.Equal(0, display.ActiveCount);
        Assert.Equal("0 streaming", display.StreamingBadgeText);
        Assert.Equal("0", display.TotalSignalsValue);
        Assert.Equal("0", display.AvgSignalsValue);  // web `?? '0'`
        Assert.False(display.HasVehicles);
    }

    [Fact]
    public void SignalCountCell_displays_grouped_but_sorts_numerically()
    {
        var small = new SignalCountCell(7, "7");
        var large = new SignalCountCell(12345, "12,345");

        Assert.Equal("12,345", large.ToString());          // grouped display
        Assert.True(large.CompareTo(small) > 0);            // numeric, not lexical ("1" < "7" lexically)
        Assert.True(large > small);
        Assert.True(small < large);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, ServiceHealthResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, ServiceHealthResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(
            LoadStatus.Error,
            ServiceHealthResultMapper.Map(
                RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_value()
    {
        using var doc = JsonDocument.Parse(TelemetryJson);

        var cached = ServiceHealthResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Vehicles.Count);

        var offline = ServiceHealthResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.Enabled);
    }

    // ---- View-model: state matrix --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new ServiceHealthViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(ServiceHealthSectionState.Loading, vm.State);
        Assert.False(vm.HasBadges);
        Assert.False(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_badges_metrics_and_rows()
    {
        using var vm = NewViewModel(Loaded(Parse(TelemetryJson)));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Loaded, vm.State);
        Assert.True(vm.HasBadges);
        Assert.Equal("Enabled", vm.Display.EnabledBadgeText);
        Assert.Equal("1 streaming", vm.Display.StreamingBadgeText);
        Assert.Equal(2, vm.Display.VehicleRows.Count);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_telemetry_body()
    {
        using var vm = NewViewModel(RepositoryResult<ServiceHealthSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Empty, vm.State);
        Assert.False(vm.HasBadges);
        Assert.Equal("No telemetry data available", vm.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_even_when_no_vehicles_present()
    {
        using var vm = NewViewModel(Loaded(Parse("""{"enabled":true,"mode":"fleet_telemetry"}""")));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Loaded, vm.State);
        Assert.True(vm.HasBadges);
        Assert.False(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_error_when_failure_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<ServiceHealthSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content()
    {
        using var vm = NewViewModel(RepositoryResult<ServiceHealthSnapshot>.Cached(Parse(TelemetryJson), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<ServiceHealthSnapshot>.OfflineCached(
            Parse(TelemetryJson), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(ServiceHealthSectionState.Offline, vm.State);
        Assert.True(vm.Display.HasVehicles);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_and_increments_attempts()
    {
        using var vm = NewViewModel(
            Loaded(Parse(TelemetryJson)),
            Loaded(Parse(TelemetryJson)));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(ServiceHealthSectionState.Loaded, vm.State);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new ServiceHealthViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Service Health", vm.Title);
        Assert.Equal("Fleet Telemetry streaming status", vm.Description);
        Assert.Equal("Mode", vm.ModeLabel);
        Assert.Equal("Vehicles Connected", vm.VehiclesConnectedLabel);
        Assert.Equal("Total Signals", vm.TotalSignalsLabel);
        Assert.Equal("Avg Signals/s", vm.AvgSignalsLabel);
        Assert.Equal("VIN", vm.VinHeader);
        Assert.Equal("Status", vm.StatusHeader);
        Assert.Equal("Signals", vm.SignalsHeader);
        Assert.Equal("Signals/s", vm.SignalsPerSecondHeader);
        Assert.Equal("Latency", vm.LatencyHeader);
        Assert.Equal("Last Received", vm.LastReceivedHeader);
        Assert.Equal("No telemetry data available", vm.NoDataMessage);
        Assert.Equal("No vehicles connected", vm.NoVehiclesMessage);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.StartsWith("Loading service health", vm.LoadingLabel);
        Assert.StartsWith("Couldn't load service health", vm.ErrorMessageDefault);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_stream_targets_the_generated_telemetry_operation()
    {
        using var doc = JsonDocument.Parse(TelemetryJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Vehicles.Count);
        Assert.Equal("get_api_v1_telemetry", client.Requests[^1].OperationId);
        Assert.Equal(ServiceHealthSource.TelemetryOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("service-health-section", ServiceHealthRegistration.Id);
        Assert.Equal("ServiceHealthSection", ServiceHealthRegistration.Slug);
        Assert.Equal("Service Health", ServiceHealthRegistration.Title(Localizer));
        Assert.Equal("Fleet Telemetry streaming status", ServiceHealthRegistration.Description(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new ServiceHealthDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ServiceHealthSection", Assert.Single(sink));
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_rows_carry_descriptive_non_empty_automation_names()
    {
        using var doc = JsonDocument.Parse(TelemetryJson);
        var display = ServiceHealthProjection.Project(ServiceHealthSnapshot.FromJson(doc.RootElement), Localizer, Now);

        var streaming = display.VehicleRows.Single(r => r.Vin == "5YJ3E1EA1KF000001");
        Assert.False(string.IsNullOrWhiteSpace(streaming.AutomationName));
        Assert.Contains("5YJ3E1EA1KF000001", streaming.AutomationName);
        Assert.Contains("Streaming", streaming.AutomationName);
        Assert.Contains("12,345", streaming.AutomationName);
        Assert.Contains("Signals", streaming.AutomationName);
    }

    // ---- helpers -------------------------------------------------------------------

    private static ServiceHealthViewModel NewViewModel(params RepositoryResult<ServiceHealthSnapshot>[] results) =>
        new(new FakeSource(results), Localizer, () => Now);

    private static ServiceHealthSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new ServiceHealthSource(client, engine, options);
    }

    private static ServiceHealthSnapshot Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return ServiceHealthSnapshot.FromJson(doc.RootElement);
    }

    private static RepositoryResult<ServiceHealthSnapshot> Loaded(ServiceHealthSnapshot snapshot) =>
        RepositoryResult<ServiceHealthSnapshot>.Loaded(snapshot, Now);

    private static async Task<IReadOnlyList<RepositoryResult<T>>> Collect<T>(IAsyncEnumerable<RepositoryResult<T>> stream)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource : IServiceHealthSource
    {
        private readonly IReadOnlyList<RepositoryResult<ServiceHealthSnapshot>> _results;

        public FakeSource(params RepositoryResult<ServiceHealthSnapshot>[] results) =>
            _results = results ?? Array.Empty<RepositoryResult<ServiceHealthSnapshot>>();

        public async IAsyncEnumerable<RepositoryResult<ServiceHealthSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }
    }
}
