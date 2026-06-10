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
/// Headless verification of the backend-status surface's UI-thread-free logic — the JSON parse adapters
/// (extended health / connection pool / version snapshots), the cache-then-network result mappers, the
/// projection (okCount badge variant, the <c>getStatusIcon</c> / <c>statusTextClass</c> status mapping, the
/// latency / failure / count formatting, the <c>formatUptime</c> port, the runtime fallbacks and the
/// component Narrator names), the repository source's three request shapes, the state-holder view-model's
/// state matrix (loading / loaded / empty / error / stale / offline) and the combined-loading gate, the
/// refresh flow, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/BackendStatusSection.tsx).
/// </summary>
public sealed class BackendStatusSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string HealthJson = """
        {"status":"degraded",
         "components":{
            "database":{"status":"ok","latency_ms":1.5,"last_check":"2026-06-06T11:59:00Z","consecutive_failures":0},
            "redis":{"status":"degraded","latency_ms":12.0,"consecutive_failures":2}},
         "system":{"goroutines":42,"go_version":"go1.25","uptime_seconds":3661}}
        """;

    private const string PoolJson = """{"max_open":25,"open":10,"in_use":3,"idle":7,"wait_count":1500}""";

    private const string VersionJson =
        """{"go_version":"go1.25.1","uptime_seconds":90061,"goroutines":50,"os":"linux","arch":"amd64"}""";

    // ---- Health snapshot parse adapter ---------------------------------------------

    [Fact]
    public void Health_parses_components_system_and_status()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var snap = BackendHealthSnapshot.FromJson(doc.RootElement);

        Assert.Equal("degraded", snap.Status);
        Assert.Equal(2, snap.Components.Count);
        Assert.True(snap.HasSystem);
        Assert.Equal("go1.25", snap.SystemGoVersion);
        Assert.Equal(3661, snap.SystemUptimeSeconds);
        Assert.Equal(42, snap.SystemGoroutines);

        var database = snap.Components[0];
        Assert.Equal("database", database.Name);
        Assert.Equal("ok", database.Status);
        Assert.Equal(1.5, database.LatencyMs);
        Assert.Equal(0, database.ConsecutiveFailures);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 0, TimeSpan.Zero), database.LastCheckInstant);
    }

    [Fact]
    public void Health_is_tolerant_of_missing_fields_and_non_object()
    {
        using var partial = JsonDocument.Parse("""{"components":{"x":{}}}""");
        var snap = BackendHealthSnapshot.FromJson(partial.RootElement);
        Assert.Equal(string.Empty, snap.Status);
        Assert.False(snap.HasSystem);
        var c = Assert.Single(snap.Components);
        Assert.Equal("x", c.Name);
        Assert.Equal(string.Empty, c.Status);
        Assert.Equal(0, c.LatencyMs);
        Assert.Equal(0, c.ConsecutiveFailures);
        Assert.Null(c.LastCheckInstant);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(BackendHealthSnapshot.FromJson(notObject.RootElement).Components);
    }

    [Fact]
    public void Pool_parses_snake_case_fields_and_marks_present()
    {
        using var doc = JsonDocument.Parse(PoolJson);
        var pool = ConnectionPoolSnapshot.FromJson(doc.RootElement);

        Assert.True(pool.Present);
        Assert.Equal(25, pool.MaxOpen);
        Assert.Equal(10, pool.Open);
        Assert.Equal(3, pool.InUse);
        Assert.Equal(7, pool.Idle);
        Assert.Equal(1500, pool.WaitCount);

        using var notObject = JsonDocument.Parse("null");
        Assert.False(ConnectionPoolSnapshot.FromJson(notObject.RootElement).Present);
    }

    [Fact]
    public void Version_parses_fields_and_marks_present()
    {
        using var doc = JsonDocument.Parse(VersionJson);
        var version = VersionSnapshot.FromJson(doc.RootElement);

        Assert.True(version.Present);
        Assert.Equal("go1.25.1", version.GoVersion);
        Assert.Equal(90061, version.UptimeSeconds);
        Assert.Equal(50, version.Goroutines);
        Assert.Equal("linux", version.Os);
        Assert.Equal("amd64", version.Arch);

        using var notObject = JsonDocument.Parse("3");
        Assert.False(VersionSnapshot.FromJson(notObject.RootElement).Present);
    }

    // ---- Status mapping (getStatusIcon / statusTextClass) --------------------------

    [Theory]
    [InlineData("ok", StatusKind.Success)]
    [InlineData("healthy", StatusKind.Success)]
    [InlineData("connected", StatusKind.Success)]
    [InlineData("degraded", StatusKind.Warning)]
    [InlineData("pending", StatusKind.Warning)]
    [InlineData("unhealthy", StatusKind.Danger)]
    [InlineData("down", StatusKind.Danger)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("weird", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    public void StatusKind_maps_like_web(string status, StatusKind expected) =>
        Assert.Equal(expected, BackendStatusProjection.StatusKindFor(status));

    [Fact]
    public void StatusGlyph_matches_the_semantic_status()
    {
        Assert.Equal(BackendStatusProjection.HealthyGlyph, BackendStatusProjection.StatusGlyphFor("ok"));
        Assert.Equal(BackendStatusProjection.WarningGlyph, BackendStatusProjection.StatusGlyphFor("degraded"));
        Assert.Equal(BackendStatusProjection.DangerGlyph, BackendStatusProjection.StatusGlyphFor("unhealthy"));
        Assert.Equal(BackendStatusProjection.UnknownGlyph, BackendStatusProjection.StatusGlyphFor("???"));
    }

    [Theory]
    [InlineData("ok", true)]
    [InlineData("healthy", true)]
    [InlineData("degraded", false)]
    [InlineData("connected", false)]
    public void IsHealthy_counts_only_ok_and_healthy(string status, bool expected) =>
        Assert.Equal(expected, BackendStatusProjection.IsHealthy(status));

    // ---- formatUptime port ---------------------------------------------------------

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(59, "0m")]
    [InlineData(61, "1m")]
    [InlineData(3661, "1h 1m")]
    [InlineData(86400, "1d 0h 0m")]
    [InlineData(90061, "1d 1h 1m")]
    public void FormatUptime_matches_web(long seconds, string expected) =>
        Assert.Equal(expected, BackendStatusProjection.FormatUptime(seconds));

    [Fact]
    public void FormatUptime_floors_negative_to_zero() =>
        Assert.Equal("0m", BackendStatusProjection.FormatUptime(-10));

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_badge_is_warning_when_not_all_healthy()
    {
        var display = BackendStatusProjection.Project(
            HealthWith(("database", "ok", 1.5, 0, "2026-06-06T11:59:00Z"), ("redis", "degraded", 12.0, 2, null)),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        Assert.True(display.HasBadge);
        Assert.Equal(1, display.OkCount);
        Assert.Equal(2, display.ComponentCount);
        Assert.Equal(StatusKind.Warning, display.BadgeStatus);
        Assert.Equal("1/2 healthy", display.BadgeText);
    }

    [Fact]
    public void Project_badge_is_success_when_all_healthy()
    {
        var display = BackendStatusProjection.Project(
            HealthWith(("database", "ok", 1.0, 0, null), ("redis", "healthy", 2.0, 0, null)),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        Assert.Equal(StatusKind.Success, display.BadgeStatus);
        Assert.Equal("2/2 healthy", display.BadgeText);
    }

    [Fact]
    public void Project_no_badge_when_no_components()
    {
        var display = BackendStatusProjection.Project(
            BackendHealthSnapshot.Empty, ConnectionPoolSnapshot.Absent, VersionSnapshot.Absent, Localizer, Now);

        Assert.False(display.HasBadge);
        Assert.False(display.HasComponents);
        Assert.False(display.HasAnyContent);
    }

    [Fact]
    public void Project_component_rows_format_status_latency_and_failures()
    {
        var display = BackendStatusProjection.Project(
            HealthWith(("database", "ok", 1.5, 0, "2026-06-06T11:59:00Z"), ("redis", "unhealthy", 12.0, 3, null)),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        var database = display.ComponentRows[0];
        Assert.Equal("ok", database.StatusText);
        Assert.Equal(StatusKind.Success, database.StatusKind);
        Assert.Equal("1.5 ms", database.LatencyText);
        Assert.Equal("0", database.FailuresText);
        Assert.False(database.HasFailures);
        Assert.NotEqual(BackendStatusProjection.EmDash, database.LastCheckText);

        var redis = display.ComponentRows[1];
        Assert.Equal(StatusKind.Danger, redis.StatusKind);
        Assert.Equal("12.0 ms", redis.LatencyText);
        Assert.Equal("3", redis.FailuresText);
        Assert.True(redis.HasFailures);
        Assert.Equal(BackendStatusProjection.EmDash, redis.LastCheckText);
    }

    [Fact]
    public void Project_pool_formats_counts_with_grouping()
    {
        var display = BackendStatusProjection.Project(
            BackendHealthSnapshot.Empty,
            new ConnectionPoolSnapshot(true, 25, 10, 3, 7, 1500),
            VersionSnapshot.Absent,
            Localizer,
            Now);

        Assert.True(display.Pool.Present);
        Assert.Equal("25", display.Pool.MaxOpenText);
        Assert.Equal("10", display.Pool.OpenText);
        Assert.Equal("3", display.Pool.InUseText);
        Assert.Equal("7", display.Pool.IdleText);
        Assert.Equal("1,500", display.Pool.WaitCountText);
        Assert.True(display.HasAnyContent);
    }

    [Fact]
    public void Project_runtime_prefers_version_then_falls_back_to_health_system()
    {
        var fromVersion = BackendStatusProjection.Project(
            BackendHealthSnapshot.Empty,
            ConnectionPoolSnapshot.Absent,
            new VersionSnapshot(true, "go1.25.1", 90061, 50, "linux", "amd64"),
            Localizer,
            Now);

        Assert.True(fromVersion.Runtime.Present);
        Assert.Equal("go1.25.1", ValueOf(fromVersion.Runtime, "Go Version"));
        Assert.Equal("1d 1h 1m", ValueOf(fromVersion.Runtime, "Uptime"));
        Assert.Equal("50", ValueOf(fromVersion.Runtime, "Goroutines"));
        Assert.Equal("linux / amd64", ValueOf(fromVersion.Runtime, "OS / Arch"));

        var fromHealth = BackendStatusProjection.Project(
            new BackendHealthSnapshot("ok", Array.Empty<ComponentHealth>(), true, "go1.24", 3661, 7),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        Assert.True(fromHealth.Runtime.Present);
        Assert.Equal("go1.24", ValueOf(fromHealth.Runtime, "Go Version"));
        Assert.Equal("1h 1m", ValueOf(fromHealth.Runtime, "Uptime"));
        Assert.Equal("7", ValueOf(fromHealth.Runtime, "Goroutines"));
        // web: OS / Arch renders the em-dash when version is absent.
        Assert.Equal(BackendStatusProjection.EmDash, ValueOf(fromHealth.Runtime, "OS / Arch"));
    }

    [Fact]
    public void Project_runtime_absent_when_no_system_and_no_version()
    {
        var display = BackendStatusProjection.Project(
            new BackendHealthSnapshot("ok", Array.Empty<ComponentHealth>(), false, null, 0, 0),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        Assert.False(display.Runtime.Present);
    }

    [Fact]
    public void Project_component_rows_carry_descriptive_non_empty_automation_names()
    {
        var display = BackendStatusProjection.Project(
            HealthWith(("database", "ok", 1.5, 0, "2026-06-06T11:59:00Z")),
            ConnectionPoolSnapshot.Absent,
            VersionSnapshot.Absent,
            Localizer,
            Now);

        string name = display.ComponentRows[0].AutomationName;
        Assert.False(string.IsNullOrWhiteSpace(name));
        Assert.Contains("database", name);
        Assert.Contains("ok", name);
        Assert.Contains("1.5 ms", name);
    }

    // ---- Result mappers ------------------------------------------------------------

    [Fact]
    public void Mappers_pass_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, BackendStatusResultMapper.MapHealth(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, BackendStatusResultMapper.MapPool(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(
            LoadStatus.Error,
            BackendStatusResultMapper.MapVersion(
                RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_loaded_health_carries_parsed_snapshot()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var mapped = BackendStatusResultMapper.MapHealth(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Equal(2, mapped.Value!.Components.Count);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_value()
    {
        using var pool = JsonDocument.Parse(PoolJson);
        var cached = BackendStatusResultMapper.MapPool(
            RepositoryResult<JsonElement>.Cached(pool.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.Present);

        using var version = JsonDocument.Parse(VersionJson);
        var offline = BackendStatusResultMapper.MapVersion(
            RepositoryResult<JsonElement>.OfflineCached(
                version.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.Present);
    }

    // ---- View-model: state matrix --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new BackendStatusViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(BackendStatusSectionState.Loading, vm.State);
        Assert.False(vm.Display.HasAnyContent);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_components_pool_and_runtime()
    {
        using var vm = NewViewModel(
            Loaded(HealthWith(("database", "ok", 1.5, 0, null), ("redis", "degraded", 12.0, 2, null))),
            Loaded(new ConnectionPoolSnapshot(true, 25, 10, 3, 7, 1500)),
            Loaded(new VersionSnapshot(true, "go1.25.1", 90061, 50, "linux", "amd64")));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.ComponentRows.Count);
        Assert.True(vm.Display.Pool.Present);
        Assert.True(vm.Display.Runtime.Present);
        Assert.Equal("1/2 healthy", vm.Display.BadgeText);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_nothing_to_show()
    {
        using var vm = NewViewModel(
            Loaded(BackendHealthSnapshot.Empty),
            RepositoryResult<ConnectionPoolSnapshot>.Empty(Now),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Empty, vm.State);
        Assert.False(vm.Display.HasAnyContent);
        Assert.StartsWith("No backend status", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_when_only_pool_present_even_if_health_empty()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackendHealthSnapshot>.Empty(Now),
            Loaded(new ConnectionPoolSnapshot(true, 25, 10, 3, 7, 0)),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Loaded, vm.State);
        Assert.True(vm.Display.Pool.Present);
        Assert.False(vm.Display.HasComponents);
    }

    [Fact]
    public async Task ViewModel_error_when_health_fails_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackendHealthSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<ConnectionPoolSnapshot>.Empty(Now),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackendHealthSnapshot>.Cached(
                HealthWith(("database", "ok", 1.0, 0, null)), Now, stale: true),
            RepositoryResult<ConnectionPoolSnapshot>.Empty(Now),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasComponents);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_and_sets_error_chip()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackendHealthSnapshot>.OfflineCached(
                HealthWith(("database", "ok", 1.0, 0, null)),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "offline")),
            RepositoryResult<ConnectionPoolSnapshot>.Empty(Now),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Offline, vm.State);
        Assert.True(vm.Display.HasComponents);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_stays_loading_until_pool_resolves()
    {
        // Health resolved but the pool read is still in flight (only the engine's Loading emission):
        // web parity — the combined skeleton shows while (extLoading || poolLoading).
        using var vm = NewViewModel(
            Loaded(HealthWith(("database", "ok", 1.0, 0, null))),
            RepositoryResult<ConnectionPoolSnapshot>.Loading(),
            RepositoryResult<VersionSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BackendStatusSectionState.Loading, vm.State);
        Assert.True(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_and_increments_attempts()
    {
        using var vm = NewViewModel(
            Loaded(HealthWith(("database", "ok", 1.0, 0, null))),
            RepositoryResult<ConnectionPoolSnapshot>.Empty(Now),
            RepositoryResult<VersionSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(BackendStatusSectionState.Loaded, vm.State);
        Assert.False(vm.IsRefreshing);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new BackendStatusViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Backend Status", vm.Title);
        Assert.Equal("Component health, database pool, and runtime info", vm.Description);
        Assert.Equal("Component Health", vm.ComponentHealthTitle);
        Assert.Equal("Database Connection Pool", vm.DatabasePoolTitle);
        Assert.Equal("System Runtime", vm.SystemRuntimeTitle);
        Assert.Equal("Component", vm.ComponentHeader);
        Assert.Equal("Latency", vm.LatencyHeader);
        Assert.Equal("Failures", vm.FailuresHeader);
        Assert.Equal("Last Check", vm.LastCheckHeader);
        Assert.Equal("Max Open", vm.MaxOpenLabel);
        Assert.Equal("Wait Count", vm.WaitCountLabel);
        Assert.Equal("No components found", vm.NoComponentsMessage);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.StartsWith("Loading backend status", vm.LoadingLabel);
        Assert.StartsWith("Could not load backend status", vm.ErrorMessageDefault);
    }

    // ---- Repository source request shapes ------------------------------------------

    [Fact]
    public async Task Source_health_stream_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamHealthAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Components.Count);
        Assert.Equal("get_api_v1_system_health", client.Requests[^1].OperationId);
        Assert.Equal(BackendStatusSource.HealthOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_pool_stream_targets_the_runtime_info_operation()
    {
        using var doc = JsonDocument.Parse(PoolJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamPoolAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.Present);
        Assert.Equal("get_api_v1_dev_tools_runtime_info", client.Requests[^1].OperationId);
        Assert.Equal(BackendStatusSource.PoolOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_version_stream_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(VersionJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamVersionAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.Present);
        Assert.Equal("get_api_v1_system_version", client.Requests[^1].OperationId);
        Assert.Equal(BackendStatusSource.VersionOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamHealthAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("backend-status-section", BackendStatusRegistration.Id);
        Assert.Equal("BackendStatusSection", BackendStatusRegistration.Slug);
        Assert.Equal("Backend Status", BackendStatusRegistration.Title(Localizer));
        Assert.Equal(
            "Component health, database pool, and runtime info",
            BackendStatusRegistration.Description(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new BackendStatusDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BackendStatusSection", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static BackendStatusViewModel NewViewModel(
        RepositoryResult<BackendHealthSnapshot> health,
        RepositoryResult<ConnectionPoolSnapshot> pool,
        RepositoryResult<VersionSnapshot> version) =>
        new(new FakeSource(new[] { health }, new[] { pool }, new[] { version }), Localizer, () => Now);

    private static BackendStatusSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new BackendStatusSource(client, engine, options);
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

    private static RepositoryResult<BackendHealthSnapshot> Loaded(BackendHealthSnapshot snapshot) =>
        RepositoryResult<BackendHealthSnapshot>.Loaded(snapshot, Now);

    private static RepositoryResult<ConnectionPoolSnapshot> Loaded(ConnectionPoolSnapshot snapshot) =>
        RepositoryResult<ConnectionPoolSnapshot>.Loaded(snapshot, Now);

    private static RepositoryResult<VersionSnapshot> Loaded(VersionSnapshot snapshot) =>
        RepositoryResult<VersionSnapshot>.Loaded(snapshot, Now);

    private static BackendHealthSnapshot HealthWith(
        params (string name, string status, double latency, long failures, string? lastCheck)[] components) =>
        new(
            "ok",
            components.Select(c => new ComponentHealth(c.name, c.status, c.latency, c.failures, c.lastCheck)).ToList(),
            HasSystem: false,
            SystemGoVersion: null,
            SystemUptimeSeconds: 0,
            SystemGoroutines: 0);

    private static string ValueOf(SystemRuntimeDisplay runtime, string label) =>
        runtime.Items.First(i => i.Label == label).Value;

    private sealed class FakeSource : IBackendStatusSource
    {
        private readonly IReadOnlyList<RepositoryResult<BackendHealthSnapshot>> _health;
        private readonly IReadOnlyList<RepositoryResult<ConnectionPoolSnapshot>> _pool;
        private readonly IReadOnlyList<RepositoryResult<VersionSnapshot>> _version;

        public FakeSource(
            IReadOnlyList<RepositoryResult<BackendHealthSnapshot>>? health = null,
            IReadOnlyList<RepositoryResult<ConnectionPoolSnapshot>>? pool = null,
            IReadOnlyList<RepositoryResult<VersionSnapshot>>? version = null)
        {
            _health = health ?? Array.Empty<RepositoryResult<BackendHealthSnapshot>>();
            _pool = pool ?? Array.Empty<RepositoryResult<ConnectionPoolSnapshot>>();
            _version = version ?? Array.Empty<RepositoryResult<VersionSnapshot>>();
        }

        public IAsyncEnumerable<RepositoryResult<BackendHealthSnapshot>> StreamHealthAsync(
            CancellationToken cancellationToken = default) => Stream(_health, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<ConnectionPoolSnapshot>> StreamPoolAsync(
            CancellationToken cancellationToken = default) => Stream(_pool, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<VersionSnapshot>> StreamVersionAsync(
            CancellationToken cancellationToken = default) => Stream(_version, cancellationToken);

        private static async IAsyncEnumerable<RepositoryResult<T>> Stream<T>(
            IReadOnlyList<RepositoryResult<T>> results,
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var result in results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }
    }
}
