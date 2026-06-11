using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the system-status Infrastructure Section surface's UI-thread-free logic — the
/// merged two-endpoint parse adapter (the telemetry status body + the optional extended-health database_pool),
/// the i18n projection (the two KV cards, the connection / polling badges, the per-row em-dash and the optional
/// metric row), the cache-then-network result mapper, the data source (the merged telemetry + health read with
/// graceful health degradation), the state-holder view-model's per-state matrix (loading / ready / empty /
/// error / stale / offline), the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/InfrastructureSection.tsx). The WinUI view itself is exercised by
/// the app build. Named distinctly from <c>InfrastructureSectionTests</c> (the sibling admin/dev-tools
/// InfrastructureSection surface) to avoid a duplicate test-class definition.
/// </summary>
public sealed class InfrastructureStatusSectionTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Production-shape merged cache envelope: the telemetry body is the /telemetry/ status object and the health
    // body is the /system/health object carrying database_pool.
    private const string MergedJson = """
    {
      "telemetry": {
        "enabled": true,
        "mode": "fleet_telemetry",
        "endpoint": "wss://telemetry.example/v1",
        "protocol": "fleet-telemetry-v1",
        "speed_comparison": {
          "fleet_telemetry_latency": "0.5s",
          "fleet_api_polling": "30s",
          "speedup": "60x"
        }
      },
      "health": {
        "database_pool": { "total_conns": 25, "idle_conns": 20, "acquired_conns": 5 }
      }
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_telemetry_and_pool_from_merged_envelope()
    {
        using var doc = JsonDocument.Parse(MergedJson);
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.Enabled);
        Assert.Equal("fleet_telemetry", snapshot.Mode);
        Assert.Equal("wss://telemetry.example/v1", snapshot.Endpoint);
        Assert.Equal("fleet-telemetry-v1", snapshot.Protocol);
        Assert.Equal("0.5s", snapshot.FleetTelemetryLatency);
        Assert.Equal("30s", snapshot.FleetApiPolling);
        Assert.Equal("60x", snapshot.Speedup);
        Assert.False(snapshot.IsPolling);

        Assert.NotNull(snapshot.Pool);
        Assert.Equal(25, snapshot.Pool!.TotalConns);
        Assert.Equal(5, snapshot.Pool.AcquiredConns);
        Assert.Equal(20, snapshot.Pool.IdleConns);
    }

    [Fact]
    public void FromJson_non_object_is_empty()
    {
        using var doc = JsonDocument.Parse("\"nope\"");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.Enabled);
        Assert.Null(snapshot.Mode);
        Assert.Null(snapshot.Pool);
    }

    [Fact]
    public void FromJson_partial_telemetry_leaves_fields_absent()
    {
        using var doc = JsonDocument.Parse("""{"telemetry":{"enabled":false}}""");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.Enabled);
        Assert.Null(snapshot.Mode);
        Assert.Null(snapshot.Endpoint);
        Assert.Null(snapshot.Speedup);
        Assert.Null(snapshot.Pool); // no health body → no metric row (web parity)
    }

    [Fact]
    public void FromJson_missing_database_pool_yields_null_pool()
    {
        using var doc = JsonDocument.Parse("""{"telemetry":{"enabled":true},"health":{"status":"ok"}}""");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.Null(snapshot.Pool);
    }

    [Fact]
    public void FromJson_polling_mode_sets_is_polling()
    {
        using var doc = JsonDocument.Parse("""{"telemetry":{"enabled":false,"mode":"polling"}}""");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.IsPolling);
    }

    [Fact]
    public void FromJson_tolerates_numeric_string_pool_counts()
    {
        using var doc = JsonDocument.Parse(
            """{"health":{"database_pool":{"total_conns":"42","idle_conns":7,"acquired_conns":"3"}}}""");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Pool);
        Assert.Equal(42, snapshot.Pool!.TotalConns);
        Assert.Equal(7, snapshot.Pool.IdleConns);
        Assert.Equal(3, snapshot.Pool.AcquiredConns);
    }

    [Fact]
    public void FromJson_wrong_kind_fields_read_as_absent()
    {
        // enabled as a string and endpoint as a number are not the expected kinds → treated as absent.
        using var doc = JsonDocument.Parse("""{"telemetry":{"enabled":"yes","endpoint":12}}""");
        var snapshot = InfrastructureSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.Enabled);
        Assert.Null(snapshot.Endpoint);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_populated_snapshot_renders_both_cards_and_metrics()
    {
        using var doc = JsonDocument.Parse(MergedJson);
        var display = InfrastructureProjection.Project(InfrastructureSnapshot.FromJson(doc.RootElement), Localizer);

        Assert.True(display.Connected);
        Assert.Equal("Connected", display.ConnectionStatusText);
        Assert.False(display.Polling);
        Assert.Equal("Standby", display.PollingStatusText);

        Assert.Equal(4, display.SseRows.Count);
        Assert.Equal("Connection State", display.SseRows[0].Label);
        Assert.Equal("Connected", display.SseRows[0].Value);
        Assert.Equal("Endpoint", display.SseRows[1].Label);
        Assert.Equal("wss://telemetry.example/v1", display.SseRows[1].Value);
        Assert.Equal("Protocol", display.SseRows[2].Label);
        Assert.Equal("No", display.SseRows[3].Value); // not polling → "No"

        Assert.Equal(4, display.PollingRows.Count);
        Assert.Equal("Mode", display.PollingRows[0].Label);
        Assert.Equal("fleet_telemetry", display.PollingRows[0].Value);
        Assert.Equal("60x", display.PollingRows[1].Value);
        Assert.Equal("0.5s", display.PollingRows[2].Value);
        Assert.Equal("30s", display.PollingRows[3].Value);

        Assert.NotNull(display.Metrics);
        Assert.Equal(3, display.Metrics!.Count);
        Assert.Equal("Total Conns", display.Metrics[0].Label);
        Assert.Equal("25", display.Metrics[0].Value);
        Assert.Equal("5", display.Metrics[1].Value);
        Assert.Equal("20", display.Metrics[2].Value);
    }

    [Fact]
    public void Project_empty_snapshot_shows_disconnected_placeholders_no_metrics()
    {
        var display = InfrastructureProjection.Project(InfrastructureSnapshot.Empty, Localizer);

        Assert.False(display.Connected);
        Assert.Equal("Disconnected", display.ConnectionStatusText);
        Assert.Equal("Disconnected", display.SseRows[0].Value);
        Assert.Equal(EmDash, display.SseRows[1].Value);  // endpoint absent
        Assert.Equal(EmDash, display.SseRows[2].Value);  // protocol absent
        Assert.Equal("No", display.SseRows[3].Value);

        Assert.Equal("unknown", display.PollingRows[0].Value); // web literal mode fallback
        Assert.Equal(EmDash, display.PollingRows[1].Value);

        Assert.Null(display.Metrics); // no pool → row hidden (web parity)
    }

    [Fact]
    public void Project_polling_snapshot_marks_active_and_yes_polling()
    {
        var snapshot = InfrastructureSnapshot.Empty with { Enabled = true, Mode = "polling" };
        var display = InfrastructureProjection.Project(snapshot, Localizer);

        Assert.True(display.Polling);
        Assert.Equal("Active", display.PollingStatusText);
        Assert.Equal("Yes \u2014 Polling", display.SseRows[3].Value);
        Assert.Equal("polling", display.PollingRows[0].Value);
    }

    [Fact]
    public void Project_partial_pool_renders_em_dash_for_absent_count()
    {
        var snapshot = InfrastructureSnapshot.Empty with { Pool = new InfrastructureDbPool(10, null, 4) };
        var display = InfrastructureProjection.Project(snapshot, Localizer);

        Assert.NotNull(display.Metrics);
        Assert.Equal("10", display.Metrics![0].Value);
        Assert.Equal(EmDash, display.Metrics[1].Value); // acquired absent
        Assert.Equal("4", display.Metrics[2].Value);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(MergedJson);

        var cached = InfrastructureResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.Enabled);

        var offline = InfrastructureResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("60x", offline.Value!.Speedup);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse(MergedJson);

        Assert.Equal(LoadStatus.Loaded, InfrastructureResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, InfrastructureResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, InfrastructureResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, InfrastructureResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<InfrastructureSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(string.IsNullOrWhiteSpace(vm.StatusAnnouncement)); // a11y: loading announced
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cards_and_metrics()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Ready, vm.State);
        Assert.True(vm.HasMetrics);
        Assert.True(vm.Display.Connected);
        Assert.Equal(4, vm.Display.SseRows.Count);
        Assert.Equal(4, vm.Display.PollingRows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_disconnected_placeholder()
    {
        using var vm = NewViewModel(RepositoryResult<InfrastructureSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Empty, vm.State);
        Assert.False(vm.Display.Connected);
        Assert.Equal(4, vm.Display.SseRows.Count); // cards still render (never a blank panel)
        Assert.Null(vm.Display.Metrics);
        Assert.False(vm.HasMetrics);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<InfrastructureSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<InfrastructureSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.Connected);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<InfrastructureSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.Connected);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_ready()
    {
        using var vm = NewViewModel(
            RepositoryResult<InfrastructureSnapshot>.Loading(),
            RepositoryResult<InfrastructureSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<InfrastructureSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(InfrastructureState.Ready, vm.State);
        Assert.True(vm.Display.Connected);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_labels_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<InfrastructureSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Infrastructure", vm.Title);
        Assert.Equal("SSE connections and polling engine diagnostics", vm.Description);
        Assert.Equal("SSE Connection", vm.SseConnectionTitle);
        Assert.Equal("Polling Engine", vm.PollingEngineTitle);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(InfrastructureSectionViewModel.State), changed);
        Assert.Contains(nameof(InfrastructureSectionViewModel.Display), changed);
    }

    // ---- Repository source (engine + fake client) ----------------------------------

    [Fact]
    public async Task Source_reads_telemetry_then_health_and_merges()
    {
        using var telemetry = JsonDocument.Parse(
            """{"enabled":true,"mode":"fleet_telemetry","endpoint":"wss://x","protocol":"v1"}""");
        using var health = JsonDocument.Parse(
            """{"database_pool":{"total_conns":12,"idle_conns":9,"acquired_conns":3}}""");

        var api = new FakeApiClient()
            .ReturnsValue(telemetry.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new InfrastructureSectionSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.Enabled);
        Assert.Equal("wss://x", terminal.Value.Endpoint);
        Assert.Equal(12, terminal.Value.Pool!.TotalConns);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_telemetry", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_system_health", api.Requests[1].OperationId);
    }

    [Fact]
    public async Task Source_tolerates_failed_health_read()
    {
        // Web parity: the two queries are independent — a failed extended-health read just leaves the metric row
        // absent while the telemetry body still drives the cards.
        using var telemetry = JsonDocument.Parse("""{"enabled":true,"mode":"fleet_telemetry"}""");

        var api = new FakeApiClient()
            .ReturnsValue(telemetry.RootElement)
            .Throws(new TimeoutException("health down"));
        var source = new InfrastructureSectionSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.Enabled);
        Assert.Null(terminal.Value.Pool); // failed health → no metric row
        Assert.Equal(2, api.Requests.Count);
    }

    [Fact]
    public async Task Source_null_telemetry_body_streams_empty()
    {
        using var telemetry = JsonDocument.Parse("null");
        using var health = JsonDocument.Parse("{}");

        var api = new FakeApiClient()
            .ReturnsValue(telemetry.RootElement)
            .ReturnsValue(health.RootElement);
        var source = new InfrastructureSectionSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_failed_telemetry_read_streams_error()
    {
        // The dominant telemetry read failing with no cache surfaces the hard-error state.
        var api = new FakeApiClient().Throws(new TimeoutException("telemetry down"));
        var source = new InfrastructureSectionSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Error, terminal.Status);
        Assert.Single(api.Requests); // health is never reached
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("infrastructure-section", InfrastructureSectionRegistration.Id);
        Assert.Equal("system", InfrastructureSectionRegistration.Category);
        Assert.Equal("InfrastructureSection", InfrastructureSectionRegistration.Slug);
        Assert.Equal("get_api_v1_telemetry", InfrastructureSectionRegistration.TelemetryOperation);
        Assert.Equal("infrastructure:status", InfrastructureSectionRegistration.CacheKey);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new InfrastructureSectionDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InfrastructureSection", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static InfrastructureSnapshot Sample()
    {
        using var doc = JsonDocument.Parse(MergedJson);
        return InfrastructureSnapshot.FromJson(doc.RootElement);
    }

    private static RepositoryResult<InfrastructureSnapshot> Loaded(InfrastructureSnapshot snapshot) =>
        RepositoryResult<InfrastructureSnapshot>.Loaded(snapshot, Now);

    private static InfrastructureSectionViewModel NewViewModel(
        params RepositoryResult<InfrastructureSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<InfrastructureSnapshot>>> Drain(IInfrastructureSectionSource source)
    {
        var list = new List<RepositoryResult<InfrastructureSnapshot>>();
        await foreach (var item in source.StreamAsync())
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<InfrastructureSnapshot>[] emissions)
        : IInfrastructureSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<InfrastructureSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
