using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SystemHealthWidget's UI-thread-free logic — the three JSON parse adapters (the
/// useSystemHealth / useDBStats / useConnectionPool reads), the projection (service list + status colours,
/// healthy tally, overall label / presence, DB-size fallback chain, active/max connection formatting, memory /
/// goroutine readouts, footprint flag, Narrator name), the health-driven three-source combine mapper, the
/// concurrent server-wide data source (the three reads), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors
/// the web spec (web/src/features/dashboard/widgets/SystemHealthWidget.tsx).
/// </summary>
public sealed class SystemHealthWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string HealthJson = """
        {"status":"healthy","components":{
          "database":{"status":"healthy"},
          "mqtt":{"status":"ok"},
          "tesla_api":{"status":"degraded"},
          "fleet_telemetry":{"status":"unhealthy"}},
          "checked_at":"2026-06-06T12:00:00Z"}
        """;

    private const string DbStatsJson = """{"tables":[],"table_count":3,"database_size":12345678}""";
    private const string RuntimeInfoJson = """{"go_version":"go1.25","goroutines":42,"max_open":25,"open":8,"in_use":3,"idle":5}""";

    // ---- Parse adapters (web hook reads) -------------------------------------------

    [Fact]
    public void ParseHealth_reads_status_and_component_map()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var snap = SystemHealthReport.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Equal("healthy", snap!.Status);
        Assert.Equal(4, snap.Components.Count);
        Assert.Equal("healthy", snap.Components["database"]);
        Assert.Equal("degraded", snap.Components["tesla_api"]);
        Assert.Equal("unhealthy", snap.Components["fleet_telemetry"]);
        Assert.Null(snap.DatabaseSize);
    }

    [Fact]
    public void ParseHealth_defaults_status_to_unknown_when_absent()
    {
        using var doc = JsonDocument.Parse("""{"components":{}}""");
        var snap = SystemHealthReport.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Equal("unknown", snap!.Status);
        Assert.Empty(snap.Components);
    }

    [Fact]
    public void ParseHealth_reads_database_size_when_present()
    {
        using var doc = JsonDocument.Parse("""{"status":"degraded","database_size":"1.2 GB"}""");
        var snap = SystemHealthReport.Parse(doc.RootElement);

        Assert.Equal("1.2 GB", snap!.DatabaseSize);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("[]")]
    public void ParseHealth_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SystemHealthReport.Parse(doc.RootElement));
    }

    [Fact]
    public void ParseDbStats_reads_numeric_database_size_as_raw_text()
    {
        using var doc = JsonDocument.Parse(DbStatsJson);
        var snap = DbStatsSnapshot.Parse(doc.RootElement);

        Assert.Equal("12345678", snap!.DatabaseSize);
    }

    [Fact]
    public void ParseDbStats_reads_string_database_size_verbatim()
    {
        using var doc = JsonDocument.Parse("""{"database_size":"42 MB"}""");
        Assert.Equal("42 MB", DbStatsSnapshot.Parse(doc.RootElement)!.DatabaseSize);
    }

    [Fact]
    public void ParseDbStats_null_database_size_when_absent()
    {
        using var doc = JsonDocument.Parse("""{"table_count":0}""");
        Assert.Null(DbStatsSnapshot.Parse(doc.RootElement)!.DatabaseSize);
    }

    [Fact]
    public void ParsePool_reads_pool_fields_and_omits_absent_memory()
    {
        using var doc = JsonDocument.Parse(RuntimeInfoJson);
        var snap = ConnectionPoolSnapshot.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Equal(3, snap!.InUse);
        Assert.Equal(25, snap.MaxOpen);
        Assert.Equal(42L, snap.Goroutines);
        Assert.Null(snap.MemoryMb);
    }

    [Theory]
    [InlineData("""{"memory_mb":512}""", 512)]
    [InlineData("""{"memoryMB":256.5}""", 256.5)]
    public void ParsePool_reads_memory_megabytes_from_either_casing(string json, double expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, ConnectionPoolSnapshot.Parse(doc.RootElement)!.MemoryMb);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    public void ParsePool_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ConnectionPoolSnapshot.Parse(doc.RootElement));
    }

    [Fact]
    public void JsonScalar_read_text_handles_string_number_and_absent()
    {
        using var doc = JsonDocument.Parse("""{"s":"hi","n":12,"e":"","b":true}""");
        var root = doc.RootElement;

        Assert.Equal("hi", JsonScalar.ReadText(root, "s"));
        Assert.Equal("12", JsonScalar.ReadText(root, "n"));
        Assert.Null(JsonScalar.ReadText(root, "e"));
        Assert.Null(JsonScalar.ReadText(root, "b"));
        Assert.Null(JsonScalar.ReadText(root, "missing"));
    }

    // ---- Status colour / overall mapping (web statusColor / overallBadgeStatus) -----

    [Theory]
    [InlineData("ok", "success")]
    [InlineData("healthy", "success")]
    [InlineData("degraded", "warning")]
    [InlineData("unhealthy", "critical")]
    [InlineData("down", "critical")]
    [InlineData("unknown", "critical")]
    public void StatusSeverity_matches_web(string status, string expected) =>
        Assert.Equal(expected, SystemHealthProjection.StatusSeverity(status));

    [Theory]
    [InlineData("healthy", "online")]
    [InlineData("degraded", "away")]
    [InlineData("unhealthy", "offline")]
    [InlineData("unknown", "offline")]
    public void PresenceToken_matches_web(string status, string expected) =>
        Assert.Equal(expected, SystemHealthProjection.PresenceToken(status));

    [Theory]
    [InlineData("healthy", StatusKind.Success)]
    [InlineData("degraded", StatusKind.Warning)]
    [InlineData("unhealthy", StatusKind.Danger)]
    [InlineData("unknown", StatusKind.Danger)]
    public void OverallHealth_matches_web(string status, StatusKind expected) =>
        Assert.Equal(expected, SystemHealthProjection.OverallHealth(status));

    [Theory]
    [InlineData("healthy", "Healthy")]
    [InlineData("degraded", "Degraded")]
    [InlineData("unhealthy", "Down")]
    [InlineData("unknown", "Down")]
    public void OverallLabel_matches_web(string status, string expected) =>
        Assert.Equal(expected, SystemHealthProjection.OverallLabel(status, Localizer));

    // ---- Projection (the full body the view renders) --------------------------------

    [Fact]
    public void Project_full_reading_maps_every_stat()
    {
        var display = SystemHealthProjection.Project(FullReading(), SystemHealthRegistration.DefaultSize, Localizer);

        Assert.True(display.HasData);
        Assert.False(display.IsCompact);
        Assert.Equal(StatusKind.Success, display.Health);
        Assert.Equal("Healthy", display.OverallLabel);
        Assert.Equal("online", display.PresenceToken);
        Assert.Equal(2, display.HealthyCount);
        Assert.Equal(4, display.TotalServices);
        Assert.Equal("2/4 services", display.ServicesSummary);
        Assert.Equal("12345678", display.DbSizeText);
        Assert.Equal("3/25", display.ActiveConnsText);
        Assert.Equal("\u2014", display.MemoryText);
        Assert.Equal("42", display.GoroutinesText);
    }

    [Fact]
    public void Project_service_rows_carry_label_and_severity()
    {
        var services = SystemHealthProjection
            .Project(FullReading(), SystemHealthRegistration.DefaultSize, Localizer).Services;

        Assert.Equal(4, services.Count);
        AssertService(services[0], "Database", "success", "healthy");
        AssertService(services[1], "Mqtt", "success", "ok");
        AssertService(services[2], "Tesla Api", "warning", "degraded");
        AssertService(services[3], "Fleet Telemetry", "critical", "unhealthy");
    }

    [Fact]
    public void Project_compact_footprint_sets_flag()
    {
        var display = SystemHealthProjection.Project(FullReading(), new SystemHealthSize(1, 2), Localizer);
        Assert.True(display.IsCompact);
    }

    [Fact]
    public void Project_no_health_renders_empty_with_unknown_defaults()
    {
        var display = SystemHealthProjection.Project(
            new SystemHealthReading(null, null, null), SystemHealthRegistration.DefaultSize, Localizer);

        Assert.False(display.HasData);
        Assert.Equal("Down", display.OverallLabel);
        Assert.Equal("offline", display.PresenceToken);
        Assert.Equal(0, display.HealthyCount);
        Assert.Equal(4, display.TotalServices);
        Assert.All(display.Services, s => Assert.Equal("critical", s.Severity));
        Assert.Equal("\u2014", display.DbSizeText);
        Assert.Equal("0", display.ActiveConnsText);
        Assert.Equal("\u2014", display.MemoryText);
        Assert.Equal("\u2014", display.GoroutinesText);
    }

    [Fact]
    public void Project_db_size_prefers_health_then_db_then_em_dash()
    {
        var fromHealth = SystemHealthProjection.Project(
            new SystemHealthReading(new SystemHealthReport("healthy", Components(), "1 GB"), new DbStatsSnapshot("999"), null),
            SystemHealthRegistration.DefaultSize, Localizer);
        Assert.Equal("1 GB", fromHealth.DbSizeText);

        var fromDb = SystemHealthProjection.Project(
            new SystemHealthReading(new SystemHealthReport("healthy", Components(), null), new DbStatsSnapshot("777"), null),
            SystemHealthRegistration.DefaultSize, Localizer);
        Assert.Equal("777", fromDb.DbSizeText);

        var neither = SystemHealthProjection.Project(
            new SystemHealthReading(new SystemHealthReport("healthy", Components(), null), null, null),
            SystemHealthRegistration.DefaultSize, Localizer);
        Assert.Equal("\u2014", neither.DbSizeText);
    }

    [Fact]
    public void Project_active_conns_drops_max_when_zero()
    {
        var display = SystemHealthProjection.Project(
            new SystemHealthReading(new SystemHealthReport("healthy", Components(), null), null, new ConnectionPoolSnapshot(7, 0, null, null)),
            SystemHealthRegistration.DefaultSize, Localizer);

        Assert.Equal("7", display.ActiveConnsText);
    }

    [Fact]
    public void Project_memory_megabytes_formats_with_grouping()
    {
        var display = SystemHealthProjection.Project(
            new SystemHealthReading(new SystemHealthReport("healthy", Components(), null), null, new ConnectionPoolSnapshot(1, 2, 9, 1536)),
            SystemHealthRegistration.DefaultSize, Localizer);

        Assert.Equal("1,536 MB", display.MemoryText);
        Assert.Equal("9", display.GoroutinesText);
    }

    // ---- Combine mapper (health-driven three-source merge) --------------------------

    [Fact]
    public void Combine_all_loaded_renders_body()
    {
        using var health = JsonDocument.Parse(HealthJson);
        using var db = JsonDocument.Parse(DbStatsJson);
        using var pool = JsonDocument.Parse(RuntimeInfoJson);

        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(health.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(db.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(pool.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.True(combined.Value!.HasHealth);
        Assert.NotNull(combined.Value.Db);
        Assert.NotNull(combined.Value.Pool);
        Assert.Equal(Now, combined.FetchedAt);
    }

    [Fact]
    public void Combine_health_only_renders_body_without_enrichment()
    {
        using var health = JsonDocument.Parse(HealthJson);
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(health.RootElement, Now), null, null);

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.True(combined.Value!.HasHealth);
        Assert.Null(combined.Value.Db);
        Assert.Null(combined.Value.Pool);
    }

    [Fact]
    public void Combine_health_empty_collapses_to_empty()
    {
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, combined.Status);
        Assert.Null(combined.Value);
    }

    [Fact]
    public void Combine_health_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(nullBody.RootElement, Now), null, null);

        Assert.Equal(LoadStatus.Empty, combined.Status);
    }

    [Fact]
    public void Combine_health_error_with_no_content_collapses_to_failure()
    {
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null, null);

        Assert.Equal(LoadStatus.Error, combined.Status);
        Assert.NotNull(combined.Error);
    }

    [Fact]
    public void Combine_health_stale_marks_body_stale()
    {
        using var health = JsonDocument.Parse(HealthJson);
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(health.RootElement, Now, stale: true), null, null);

        Assert.Equal(LoadStatus.Cached, combined.Status);
        Assert.True(combined.IsStale);
    }

    [Fact]
    public void Combine_health_offline_marks_body_offline()
    {
        using var health = JsonDocument.Parse(HealthJson);
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(health.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null, null);

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.True(combined.Value!.HasHealth);
    }

    [Fact]
    public void Combine_health_refreshing_keeps_body()
    {
        using var health = JsonDocument.Parse(HealthJson);
        var combined = SystemHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Refreshing(health.RootElement, Now, stale: false), null, null);

        Assert.Equal(LoadStatus.Refreshing, combined.Status);
        Assert.True(combined.Value!.HasHealth);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_body_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("Healthy", vm.Display!.OverallLabel);
        Assert.Equal("3/25", vm.Display.ActiveConnsText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No system health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthReading>.Cached(FullReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthReading>.OfflineCached(
            FullReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthReading>.Loading(),
            RepositoryResult<SystemHealthReading>.Cached(new SystemHealthReading(new SystemHealthReport("degraded", Components(), null), null, null), Now, stale: false),
            RepositoryResult<SystemHealthReading>.Loaded(FullReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(SystemHealthState.Loaded, vm.State);
        Assert.Equal("Healthy", vm.Display!.OverallLabel);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = new SystemHealthViewModel(
            new FakeSystemHealthSource(Loaded(FullReading())), Localizer, new SystemHealthSize(1, 2));
        await vm.LoadAsync();
        Assert.True(vm.Display!.IsCompact);

        vm.Size = new SystemHealthSize(2, 4);
        Assert.False(vm.Display!.IsCompact);
        Assert.Equal(SystemHealthState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SystemHealthViewModel.State), changed);
        Assert.Contains(nameof(SystemHealthViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("System Health", vm.Title);
        Assert.Equal("No system health data", vm.EmptyMessage);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("system-health", SystemHealthRegistration.Id);
        Assert.Equal("system", SystemHealthRegistration.Category);
        Assert.Equal("SystemHealthWidget", SystemHealthRegistration.Slug);
        Assert.Equal(new SystemHealthSize(2, 4), SystemHealthRegistration.DefaultSize);
        Assert.Equal(new SystemHealthSize(1, 2), SystemHealthRegistration.MinSize);
        Assert.Equal(new SystemHealthSize(4, 40), SystemHealthRegistration.MaxSize);
        Assert.Equal("System Health", SystemHealthRegistration.Name(Localizer));
        Assert.Equal("Server health: DB, MQTT, Tesla API status, memory, connections", SystemHealthRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 4, true)]    // default
    [InlineData(0, 2, false)]   // below min cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SystemHealthRegistration.IsWithinBounds(new SystemHealthSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SystemHealthSize(1, 2), SystemHealthRegistration.Clamp(new SystemHealthSize(0, 0)));
        Assert.Equal(new SystemHealthSize(4, 40), SystemHealthRegistration.Clamp(new SystemHealthSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SystemHealthDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SystemHealthWidget", Assert.Single(lines));
    }

    // ---- Source (concurrent three-endpoint server-wide adapter) --------------------

    [Fact]
    public async Task Source_merges_three_reads()
    {
        using var health = JsonDocument.Parse(HealthJson);
        using var db = JsonDocument.Parse(DbStatsJson);
        using var pool = JsonDocument.Parse(RuntimeInfoJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Health, health.RootElement)
            .Returns(DbStatsOperation, db.RootElement)
            .Returns(RuntimeInfoOperation, pool.RootElement);

        var source = new SystemHealthSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasHealth);
        Assert.Equal("healthy", terminal.Value.Health!.Status);
        Assert.Equal("12345678", terminal.Value.Db!.DatabaseSize);
        Assert.Equal(3, terminal.Value.Pool!.InUse);
    }

    [Fact]
    public async Task Source_requests_the_three_operations()
    {
        using var health = JsonDocument.Parse(HealthJson);
        using var db = JsonDocument.Parse(DbStatsJson);
        using var pool = JsonDocument.Parse(RuntimeInfoJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Health, health.RootElement)
            .Returns(DbStatsOperation, db.RootElement)
            .Returns(RuntimeInfoOperation, pool.RootElement);

        var source = new SystemHealthSource(api, NewEngine(), new ApiClientOptions());
        await DrainAsync(source);

        Assert.Contains(api.Requests, r => r.OperationId == Operations.SystemAdmin.Health);
        Assert.Contains(api.Requests, r => r.OperationId == DbStatsOperation);
        Assert.Contains(api.Requests, r => r.OperationId == RuntimeInfoOperation);
    }

    [Fact]
    public async Task Source_health_only_content_renders_body()
    {
        using var health = JsonDocument.Parse(HealthJson);
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Health, health.RootElement)
            .Returns(DbStatsOperation, nullBody.RootElement)
            .Returns(RuntimeInfoOperation, nullBody.RootElement);

        var source = new SystemHealthSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasHealth);
        Assert.Null(terminal.Value.Db);
        Assert.Null(terminal.Value.Pool);
    }

    [Fact]
    public async Task Source_health_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Health, nullBody.RootElement)
            .Returns(DbStatsOperation, nullBody.RootElement)
            .Returns(RuntimeInfoOperation, nullBody.RootElement);

        var source = new SystemHealthSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Empty, terminal.Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private const string DbStatsOperation = "get_api_v1_dev_tools_db_stats";
    private const string RuntimeInfoOperation = "get_api_v1_dev_tools_runtime_info";

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static IReadOnlyDictionary<string, string> Components() =>
        new Dictionary<string, string>(StringComparer.Ordinal);

    private static SystemHealthReading FullReading() => new(
        new SystemHealthReport(
            "healthy",
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["database"] = "healthy",
                ["mqtt"] = "ok",
                ["tesla_api"] = "degraded",
                ["fleet_telemetry"] = "unhealthy",
            },
            null),
        new DbStatsSnapshot("12345678"),
        new ConnectionPoolSnapshot(3, 25, 42, null));

    private static RepositoryResult<SystemHealthReading> Loaded(SystemHealthReading reading) =>
        RepositoryResult<SystemHealthReading>.Loaded(reading, Now);

    private static SystemHealthViewModel NewViewModel(params RepositoryResult<SystemHealthReading>[] emissions) =>
        new(new FakeSystemHealthSource(emissions), Localizer, SystemHealthRegistration.DefaultSize);

    private static async Task<List<RepositoryResult<SystemHealthReading>>> DrainAsync(ISystemHealthSource source)
    {
        var list = new List<RepositoryResult<SystemHealthReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static void AssertService(SystemServiceRow row, string label, string severity, string statusText)
    {
        Assert.Equal(label, row.Label);
        Assert.Equal(severity, row.Severity);
        Assert.Equal(statusText, row.StatusText);
    }

    private sealed class FakeSystemHealthSource(params RepositoryResult<SystemHealthReading>[] emissions) : ISystemHealthSource
    {
        public async IAsyncEnumerable<RepositoryResult<SystemHealthReading>> StreamAsync(
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

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
