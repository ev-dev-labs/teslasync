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
/// Headless verification of the Health Probes Section surface's UI-thread-free logic — the
/// <c>GET /system/health</c> parse adapter (the tolerant snake_case / camelCase reads of the liveness status,
/// the database status + latency, the goroutine count, the process uptime and the pool connection count), the
/// projection (the two probe cards, the status-to-badge mapping, the <c>fmtInt</c> / <c>fmtNumber</c> readouts,
/// the <c>formatUptime</c> helper, the latency em-dash and the accessible names), the cache-then-network result
/// mapper, the single-endpoint data source, the state-holder view-model's per-state matrix (loading / loaded /
/// empty / error / stale / offline), the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/HealthProbesSection.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class HealthProbesSectionTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Production-shape GET /system/health body (matches the web ExtendedHealthResponse interface).
    private const string HealthJson = """
    {
      "status": "healthy",
      "components": { "redis": { "status": "ok", "latency_ms": 1.2 } },
      "database": { "status": "ok", "latency_ms": 12.3 },
      "database_pool": { "total_conns": 10, "idle_conns": 6, "acquired_conns": 4 },
      "system": { "goroutines": 42, "go_version": "go1.25", "uptime_seconds": 90061 }
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_all_probe_fields_from_health_body()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.Equal("healthy", snapshot.LivenessStatus);
        Assert.Equal("ok", snapshot.DatabaseStatus);
        Assert.Equal(12.3, snapshot.DatabaseLatencyMs);
        Assert.Equal(42, snapshot.Goroutines);
        Assert.Equal(90061, snapshot.UptimeSeconds);
        Assert.Equal(10, snapshot.PoolTotalConns);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_defaults_absent_statuses_to_unknown_and_keeps_data()
    {
        // A bare object body (no nested database/system/pool) still renders the cards (web parity), defaulting
        // each status to "unknown" and leaving the numeric fields absent.
        using var doc = JsonDocument.Parse("""{"status":"degraded"}""");
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.Equal("degraded", snapshot.LivenessStatus);
        Assert.Equal(HealthProbesSnapshot.UnknownStatus, snapshot.DatabaseStatus);
        Assert.Null(snapshot.DatabaseLatencyMs);
        Assert.Null(snapshot.Goroutines);
        Assert.Null(snapshot.UptimeSeconds);
        Assert.Null(snapshot.PoolTotalConns);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_empty_object_defaults_both_statuses_to_unknown()
    {
        using var doc = JsonDocument.Parse("{}");
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.Equal(HealthProbesSnapshot.UnknownStatus, snapshot.LivenessStatus);
        Assert.Equal(HealthProbesSnapshot.UnknownStatus, snapshot.DatabaseStatus);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_accepts_camelcase_aliases()
    {
        // The SPA's camelCaseKeys() transform produces camelCase aliases; the parser accepts both shapes.
        using var doc = JsonDocument.Parse("""
        {
          "status": "degraded",
          "database": { "status": "down", "latencyMs": 5 },
          "system": { "goroutines": 7, "uptimeSeconds": 30 },
          "databasePool": { "totalConns": 3 }
        }
        """);
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.Equal("down", snapshot.DatabaseStatus);
        Assert.Equal(5, snapshot.DatabaseLatencyMs);
        Assert.Equal(7, snapshot.Goroutines);
        Assert.Equal(30, snapshot.UptimeSeconds);
        Assert.Equal(3, snapshot.PoolTotalConns);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("123")]
    [InlineData("\"oops\"")]
    [InlineData("[]")]
    public void FromJson_non_object_body_is_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.HasData);
        Assert.Equal(HealthProbesSnapshot.UnknownStatus, snapshot.LivenessStatus);
    }

    [Fact]
    public void FromJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"database":{"status":"ok","latency_ms":"8.5"},"database_pool":{"total_conns":"12"}}""");
        var snapshot = HealthProbesSnapshot.FromJson(doc.RootElement);

        Assert.Equal(8.5, snapshot.DatabaseLatencyMs);
        Assert.Equal(12, snapshot.PoolTotalConns);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_both_cards_and_header_badges()
    {
        var display = HealthProbesProjection.Project(Sample(), Localizer);

        Assert.Equal("Live", display.LiveBadgeText);
        Assert.Equal(StatusKind.Success, display.LiveBadgeStatus);
        Assert.Equal("Ready", display.ReadyBadgeText);
        Assert.Equal(StatusKind.Success, display.ReadyBadgeStatus);

        Assert.Equal($"Liveness {EmDash} /healthz", display.Liveness.Title);
        Assert.Equal("healthy", display.Liveness.StatusText);
        Assert.Equal(StatusKind.Success, display.Liveness.StatusKind);

        Assert.Equal($"Readiness {EmDash} /readyz", display.Readiness.Title);
        Assert.Equal("ok", display.Readiness.StatusText);
        Assert.Equal(StatusKind.Success, display.Readiness.StatusKind);
    }

    [Fact]
    public void Project_liveness_rows_match_web_kvlist()
    {
        var rows = HealthProbesProjection.Project(Sample(), Localizer).Liveness.Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(("Status", "healthy"), (rows[0].Label, rows[0].Value));
        Assert.Equal(("Goroutines", "42"), (rows[1].Label, rows[1].Value));
        Assert.Equal(("Uptime", "1d 1h 1m"), (rows[2].Label, rows[2].Value));
    }

    [Fact]
    public void Project_readiness_rows_match_web_kvlist()
    {
        var rows = HealthProbesProjection.Project(Sample(), Localizer).Readiness.Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(("Database", "ok"), (rows[0].Label, rows[0].Value));
        Assert.Equal(("Latency", "12.3 ms"), (rows[1].Label, rows[1].Value));
        Assert.Equal(("Pool Connections", "10"), (rows[2].Label, rows[2].Value));
    }

    [Fact]
    public void Project_absent_latency_renders_em_dash()
    {
        var data = Sample() with { DatabaseLatencyMs = null };
        var rows = HealthProbesProjection.Project(data, Localizer).Readiness.Rows;

        Assert.Equal(EmDash, rows[1].Value);
    }

    [Fact]
    public void Project_absent_counts_default_to_zero()
    {
        var data = new HealthProbesSnapshot("ok", "ok", null, null, null, null);
        var display = HealthProbesProjection.Project(data, Localizer);

        Assert.Equal("0", display.Liveness.Rows[1].Value);   // Goroutines
        Assert.Equal("0m", display.Liveness.Rows[2].Value);  // Uptime
        Assert.Equal("0", display.Readiness.Rows[2].Value);  // Pool Connections
    }

    [Fact]
    public void Project_groups_large_goroutine_count()
    {
        var data = Sample() with { Goroutines = 1234 };
        var display = HealthProbesProjection.Project(data, Localizer);

        Assert.Equal("1,234", display.Liveness.Rows[1].Value);
    }

    [Fact]
    public void Project_card_automation_names_compose_title_and_status()
    {
        var display = HealthProbesProjection.Project(Sample(), Localizer);

        Assert.Equal($"Liveness {EmDash} /healthz: healthy", display.Liveness.AutomationName);
        Assert.Equal($"Readiness {EmDash} /readyz: ok", display.Readiness.AutomationName);
    }

    [Theory]
    [InlineData("healthy", StatusKind.Success)]
    [InlineData("ok", StatusKind.Success)]
    [InlineData("online", StatusKind.Success)]
    [InlineData("ready", StatusKind.Success)]
    [InlineData("HEALTHY", StatusKind.Success)]
    [InlineData("degraded", StatusKind.Warning)]
    [InlineData("warning", StatusKind.Warning)]
    [InlineData("pending", StatusKind.Warning)]
    [InlineData("unhealthy", StatusKind.Danger)]
    [InlineData("offline", StatusKind.Danger)]
    [InlineData("down", StatusKind.Danger)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("unknown", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    public void StatusToBadge_maps_web_variants(string status, StatusKind expected) =>
        Assert.Equal(expected, HealthProbesProjection.StatusToBadge(status));

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(-5, "0m")]
    [InlineData(59, "0m")]
    [InlineData(60, "1m")]
    [InlineData(3600, "1h 0m")]
    [InlineData(3661, "1h 1m")]
    [InlineData(86400, "1d 0h 0m")]
    [InlineData(90061, "1d 1h 1m")]
    public void FormatUptime_matches_web_helper(double seconds, string expected) =>
        Assert.Equal(expected, HealthProbesProjection.FormatUptime(seconds));

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(HealthJson);

        var loaded = HealthProbesResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal("healthy", loaded.Value!.LivenessStatus);

        Assert.Equal(LoadStatus.Empty, HealthProbesResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Loading, HealthProbesResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);

        var failure = HealthProbesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
    }

    [Fact]
    public void Map_preserves_offline_and_stale_freshness()
    {
        using var doc = JsonDocument.Parse(HealthJson);

        var offline = HealthProbesResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.IsStale);

        var cached = HealthProbesResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<HealthProbesSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_both_cards()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("healthy", vm.Display.Liveness.StatusText);
        Assert.Equal("ok", vm.Display.Readiness.StatusText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_non_object_snapshot_renders_empty()
    {
        using var vm = NewViewModel(Loaded(HealthProbesSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No system health data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<HealthProbesSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<HealthProbesSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<HealthProbesSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_chip()
    {
        using var vm = NewViewModel(RepositoryResult<HealthProbesSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<HealthProbesSnapshot>.Loading(),
            RepositoryResult<HealthProbesSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<HealthProbesSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(HealthProbesState.Loaded, vm.State);
        Assert.Equal("12.3 ms", vm.Display.Readiness.Rows[1].Value);
    }

    [Fact]
    public async Task ViewModel_title_description_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<HealthProbesSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Health Probes", vm.Title);
        Assert.Equal("Liveness and readiness checks", vm.Description);
        Assert.Equal("No system health data available", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(HealthProbesSectionViewModel.State), changed);
        Assert.Contains(nameof(HealthProbesSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_every_owned_string_flows_through_localizer()
    {
        var recording = new RecordingLocalizer();
        using var vm = new HealthProbesSectionViewModel(
            new FakeSource(Loaded(Sample())), recording, () => Now);
        await vm.LoadAsync();

        _ = vm.Title;
        _ = vm.Description;
        _ = vm.LoadingLabel;
        _ = vm.RetryLabel;

        Assert.Contains("Health Probes", recording.Keys);
        Assert.Contains("Liveness and readiness checks", recording.Keys);
        Assert.Contains("Live", recording.Keys);
        Assert.Contains("Ready", recording.Keys);
        Assert.Contains($"Liveness {EmDash} /healthz", recording.Keys);
        Assert.Contains($"Readiness {EmDash} /readyz", recording.Keys);
        Assert.Contains("Status", recording.Keys);
        Assert.Contains("Goroutines", recording.Keys);
        Assert.Contains("Uptime", recording.Keys);
        Assert.Contains("Database", recording.Keys);
        Assert.Contains("Latency", recording.Keys);
        Assert.Contains("Pool Connections", recording.Keys);
    }

    // ---- Repository source (engine + fake client) ----------------------------------

    [Fact]
    public async Task Source_reads_system_health_once_and_parses_terminal_loaded()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new HealthProbesSectionSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("healthy", terminal.Value!.LivenessStatus);
        Assert.Equal("ok", terminal.Value.DatabaseStatus);

        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.SystemAdmin.Health, request.OperationId);
        Assert.Equal("/system/health", api.ResolveEndpoint(request.OperationId).Path);
    }

    [Fact]
    public async Task Source_non_object_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new HealthProbesSectionSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_caches_under_distinct_key_so_second_read_is_cached()
    {
        using var doc = JsonDocument.Parse(HealthJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement).ReturnsValue(doc.RootElement);
        var engine = NewEngine();
        var source = new HealthProbesSectionSource(api, engine, new ApiClientOptions());

        await Drain(source);
        var second = await Drain(source);

        Assert.Contains(second, r => r.Status == LoadStatus.Cached);
        Assert.Equal("system-status:health-probes", HealthProbesSectionRegistration.CacheKey);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("health-probes-section", HealthProbesSectionRegistration.Id);
        Assert.Equal("system", HealthProbesSectionRegistration.Category);
        Assert.Equal("HealthProbesSection", HealthProbesSectionRegistration.Slug);
        Assert.Equal("system-status:health-probes", HealthProbesSectionRegistration.CacheKey);
        Assert.Equal(Operations.SystemAdmin.Health, HealthProbesSectionRegistration.HealthOperationId);
        Assert.Equal("get_api_v1_system_health", HealthProbesSectionRegistration.HealthOperationId);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new HealthProbesSectionDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HealthProbesSection", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static HealthProbesSnapshot Sample() =>
        new("healthy", "ok", DatabaseLatencyMs: 12.3, Goroutines: 42, UptimeSeconds: 90061, PoolTotalConns: 10);

    private static RepositoryResult<HealthProbesSnapshot> Loaded(HealthProbesSnapshot snapshot) =>
        RepositoryResult<HealthProbesSnapshot>.Loaded(snapshot, Now);

    private static HealthProbesSectionViewModel NewViewModel(params RepositoryResult<HealthProbesSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<HealthProbesSnapshot>>> Drain(IHealthProbesSectionSource source)
    {
        var list = new List<RepositoryResult<HealthProbesSnapshot>>();
        await foreach (var item in source.StreamAsync())
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<HealthProbesSnapshot>[] emissions) : IHealthProbesSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<HealthProbesSnapshot>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
