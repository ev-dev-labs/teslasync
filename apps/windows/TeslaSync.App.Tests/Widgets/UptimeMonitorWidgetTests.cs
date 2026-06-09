using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the UptimeMonitorWidget's UI-thread-free logic — the system-health JSON parse
/// adapter (snake_case + camelCase component fields → component rows), the web <c>statusVariant</c> /
/// <c>StatusDot</c> / service-label ports, the projection (overall badge / per-service rows / healthy-count /
/// DB-size + table-count footer / labels), the footprint flags, the single-call source composition, the
/// registry metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx).
/// </summary>
public sealed class UptimeMonitorWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string FullBody =
        """
        {
          "status": "healthy",
          "components": {
            "database": { "status": "healthy", "consecutive_failures": 0 },
            "mqtt": { "status": "degraded", "consecutive_failures": 2, "last_error": "timeout" },
            "tesla_api": { "status": "unhealthy", "consecutive_failures": 5 },
            "fleet_telemetry": { "status": "healthy" }
          },
          "database_size": "1.2 GB",
          "table_count": 42
        }
        """;

    private static SystemHealthComponent Component(
        string key, string status = "healthy", int failures = 0, string? lastError = null) =>
        new(key, status, failures, lastError);

    private static SystemHealthSnapshot Snapshot(
        string overall = "healthy",
        IReadOnlyList<SystemHealthComponent>? components = null,
        string? databaseSize = "1.2 GB",
        long? tableCount = 42) =>
        new(overall, components ?? Array.Empty<SystemHealthComponent>(), databaseSize, tableCount);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseComponents_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(FullBody);

        var components = SystemHealthSnapshot.ParseComponents(doc.RootElement);
        Assert.Equal(4, components.Count);

        var mqtt = Assert.Single(components, c => c.Key == "mqtt");
        Assert.Equal("degraded", mqtt.Status);
        Assert.Equal(2, mqtt.ConsecutiveFailures);
        Assert.Equal("timeout", mqtt.LastError);

        var fleet = Assert.Single(components, c => c.Key == "fleet_telemetry");
        Assert.Equal("healthy", fleet.Status);
        Assert.Equal(0, fleet.ConsecutiveFailures);
        Assert.Null(fleet.LastError);
    }

    [Fact]
    public void ParseComponents_defaults_status_to_unhealthy_when_absent()
    {
        using var doc = JsonDocument.Parse("""{"components":{"database":{}}}""");

        var component = Assert.Single(SystemHealthSnapshot.ParseComponents(doc.RootElement));
        Assert.Equal("database", component.Key);
        Assert.Equal("unhealthy", component.Status);
        Assert.Equal(0, component.ConsecutiveFailures);
        Assert.Null(component.LastError);
    }

    [Fact]
    public void ParseComponents_accepts_camel_case_aliases()
    {
        using var doc = JsonDocument.Parse(
            """{"components":{"mqtt":{"status":"degraded","consecutiveFailures":3,"lastError":"x"}}}""");

        var component = Assert.Single(SystemHealthSnapshot.ParseComponents(doc.RootElement));
        Assert.Equal(3, component.ConsecutiveFailures);
        Assert.Equal("x", component.LastError);
    }

    [Fact]
    public void ParseComponents_non_object_is_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Empty(SystemHealthSnapshot.ParseComponents(doc.RootElement));
    }

    [Fact]
    public void FromJson_builds_snapshot_from_full_body()
    {
        using var doc = JsonDocument.Parse(FullBody);

        var snapshot = SystemHealthSnapshot.FromJson(doc.RootElement);
        Assert.True(snapshot.HasData);
        Assert.Equal("healthy", snapshot.OverallStatus);
        Assert.Equal("1.2 GB", snapshot.DatabaseSize);
        Assert.Equal(42, snapshot.TableCount);
        Assert.Equal(4, snapshot.Components.Count);
        Assert.Equal("degraded", snapshot.Component("mqtt")!.Status);
        Assert.Null(snapshot.Component("missing"));
    }

    [Fact]
    public void FromJson_empty_object_is_content_with_defaults()
    {
        using var doc = JsonDocument.Parse("{}");

        var snapshot = SystemHealthSnapshot.FromJson(doc.RootElement);
        Assert.True(snapshot.HasData);                       // web: `{}` is truthy → content
        Assert.Equal("unknown", snapshot.OverallStatus);     // web: data.status ?? 'unknown'
        Assert.Empty(snapshot.Components);
        Assert.Null(snapshot.DatabaseSize);
        Assert.Null(snapshot.TableCount);
    }

    [Fact]
    public void FromJson_non_object_body_is_absent()
    {
        using var doc = JsonDocument.Parse("null");

        var snapshot = SystemHealthSnapshot.FromJson(doc.RootElement);
        Assert.False(snapshot.HasData);                      // web: falsy data → empty state
        Assert.Equal("unknown", snapshot.OverallStatus);
    }

    [Fact]
    public void FromJson_reads_overall_fallback_and_string_table_count()
    {
        using var doc = JsonDocument.Parse(
            """{"overall":"degraded","table_count":"7","database_size":"512 MB"}""");

        var snapshot = SystemHealthSnapshot.FromJson(doc.RootElement);
        Assert.Equal("degraded", snapshot.OverallStatus);    // falls back to `overall` when `status` absent
        Assert.Equal(7, snapshot.TableCount);                // numeric string tolerated
        Assert.Equal("512 MB", snapshot.DatabaseSize);
    }

    [Fact]
    public void Snapshot_empty_is_absent_body()
    {
        Assert.False(SystemHealthSnapshot.Empty.HasData);
        Assert.Equal("unknown", SystemHealthSnapshot.Empty.OverallStatus);
        Assert.Empty(SystemHealthSnapshot.Empty.Components);
    }

    // ---- Status mapping (web statusVariant / StatusDot) -----------------------------

    [Theory]
    [InlineData("ok", StatusKind.Success)]
    [InlineData("healthy", StatusKind.Success)]
    [InlineData("degraded", StatusKind.Warning)]
    [InlineData("unhealthy", StatusKind.Danger)]
    [InlineData("unknown", StatusKind.Danger)]
    [InlineData("disconnected", StatusKind.Danger)]
    [InlineData(null, StatusKind.Danger)]
    public void StatusKindFor_matches_web(string? status, StatusKind expected) =>
        Assert.Equal(expected, UptimeMonitorProjection.StatusKindFor(status));

    [Theory]
    [InlineData("ok", true)]
    [InlineData("healthy", true)]
    [InlineData("degraded", false)]
    [InlineData("unhealthy", false)]
    [InlineData(null, false)]
    public void IsHealthy_matches_web(string? status, bool expected) =>
        Assert.Equal(expected, UptimeMonitorProjection.IsHealthy(status));

    [Theory]
    [InlineData("database", "Database")]
    [InlineData("mqtt", "Mqtt")]
    [InlineData("tesla_api", "Tesla Api")]
    [InlineData("fleet_telemetry", "Fleet Telemetry")]
    public void TitleCaseFromKey_matches_web_regex(string key, string expected) =>
        Assert.Equal(expected, UptimeMonitorProjection.TitleCaseFromKey(key));

    [Fact]
    public void ServiceLabel_uses_title_cased_fallback_through_facade() =>
        Assert.Equal("Tesla Api", UptimeMonitorProjection.ServiceLabel("tesla_api", Localizer));

    [Fact]
    public void ServiceKeys_match_web_order() =>
        Assert.Equal(new[] { "database", "mqtt", "tesla_api", "fleet_telemetry" }, UptimeMonitorProjection.ServiceKeys);

    // ---- Size / footprint flags (web isCompact / isTall) ----------------------------

    [Theory]
    [InlineData(1, 1, true, false)]
    [InlineData(1, 2, false, true)]
    [InlineData(2, 2, false, true)]
    [InlineData(4, 40, false, true)]
    public void Size_footprint_flags_match_web(int cols, int rows, bool compact, bool tall)
    {
        var size = new UptimeMonitorSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(tall, size.IsTall);
    }

    // ---- Projection: overall + services --------------------------------------------

    [Fact]
    public void Project_overall_healthy_shows_all_ok()
    {
        var display = Project(Snapshot(overall: "healthy"));
        Assert.Equal("All OK", display.OverallBadgeText);
        Assert.Equal(StatusKind.Success, display.OverallKind);
        Assert.Equal("Overall", display.OverallLabel);
    }

    [Theory]
    [InlineData("degraded", StatusKind.Warning)]
    [InlineData("unhealthy", StatusKind.Danger)]
    [InlineData("unknown", StatusKind.Danger)]
    public void Project_overall_non_healthy_shows_raw_status(string overall, StatusKind kind)
    {
        var display = Project(Snapshot(overall: overall));
        Assert.Equal(overall, display.OverallBadgeText);
        Assert.Equal(kind, display.OverallKind);
    }

    [Fact]
    public void Project_builds_four_services_in_web_order()
    {
        var display = Project(Snapshot(components: new[]
        {
            Component("tesla_api", "unhealthy", 5),
            Component("database", "healthy"),
            Component("mqtt", "degraded", 2, "timeout"),
            Component("fleet_telemetry", "healthy"),
        }));

        Assert.Equal(4, display.Services.Count);
        Assert.Equal(new[] { "database", "mqtt", "tesla_api", "fleet_telemetry" },
            display.Services.Select(s => s.Key).ToArray());

        Assert.Equal("Database", display.Services[0].Label);
        Assert.Equal(StatusKind.Success, display.Services[0].Kind);
        Assert.Equal("OK", display.Services[0].BadgeText);

        Assert.Equal(StatusKind.Warning, display.Services[1].Kind);
        Assert.Equal("degraded", display.Services[1].BadgeText);   // web: raw status for non-healthy

        Assert.Equal(StatusKind.Danger, display.Services[2].Kind);
        Assert.Equal("unhealthy", display.Services[2].BadgeText);
    }

    [Fact]
    public void Project_missing_components_default_to_unhealthy()
    {
        var display = Project(Snapshot(components: Array.Empty<SystemHealthComponent>()));

        Assert.Equal(4, display.Services.Count);
        Assert.All(display.Services, s =>
        {
            Assert.Equal("unhealthy", s.Status);
            Assert.Equal(StatusKind.Danger, s.Kind);
            Assert.Equal("unhealthy", s.BadgeText);
        });
        Assert.Equal(0, display.HealthyCount);
    }

    [Fact]
    public void Project_healthy_count_and_compact_metric()
    {
        var display = Project(Snapshot(components: new[]
        {
            Component("database", "healthy"),
            Component("mqtt", "ok"),
            Component("tesla_api", "degraded"),
            Component("fleet_telemetry", "unhealthy"),
        }));

        Assert.Equal(2, display.HealthyCount);   // healthy + ok
        Assert.Equal(4, display.ServiceCount);
        Assert.Equal("2/4", display.CompactCountText);
    }

    [Fact]
    public void Project_footer_values_and_em_dash_fallback()
    {
        var present = Project(Snapshot(databaseSize: "1.2 GB", tableCount: 42));
        Assert.Equal("DB Size", present.DatabaseSizeLabel);
        Assert.Equal("1.2 GB", present.DatabaseSizeValue);
        Assert.Equal("Tables", present.TableCountLabel);
        Assert.Equal("42", present.TableCountValue);

        var absent = Project(Snapshot(databaseSize: null, tableCount: null));
        Assert.Equal(DateTimeFormatting.DefaultEmptyDisplay, absent.DatabaseSizeValue);
        Assert.Equal(DateTimeFormatting.DefaultEmptyDisplay, absent.TableCountValue);
    }

    [Fact]
    public void Project_footprint_flags_flow_into_display()
    {
        Assert.True(Project(Snapshot(), new UptimeMonitorSize(1, 1)).IsCompact);
        Assert.False(Project(Snapshot(), new UptimeMonitorSize(2, 2)).IsCompact);
        Assert.True(Project(Snapshot(), new UptimeMonitorSize(2, 2)).IsTall);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void Project_service_row_accessibility_name_combines_label_and_badge()
    {
        var row = Project(Snapshot(components: new[] { Component("mqtt", "degraded", 2, "timeout") }))
            .Services.Single(s => s.Key == "mqtt");

        Assert.Contains("Mqtt", row.AccessibilityName, StringComparison.Ordinal);
        Assert.Contains("degraded", row.AccessibilityName, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(row.AccessibilityName));
    }

    [Fact]
    public void Project_overall_and_compact_automation_names_are_populated()
    {
        var display = Project(Snapshot(overall: "healthy", components: new[]
        {
            Component("database", "healthy"),
            Component("mqtt", "unhealthy"),
        }));

        Assert.Contains("Overall", display.OverallAutomationName, StringComparison.Ordinal);
        Assert.Contains("All OK", display.OverallAutomationName, StringComparison.Ordinal);
        Assert.Contains("1", display.CompactAutomationName, StringComparison.Ordinal);   // healthy count
        Assert.Contains("4", display.CompactAutomationName, StringComparison.Ordinal);   // total services
    }

    [Fact]
    public void Project_absent_snapshot_is_unknown_and_no_data()
    {
        var display = UptimeMonitorProjection.Project(SystemHealthSnapshot.Empty, UptimeMonitorSize.Default, Localizer);
        Assert.False(display.HasData);
        Assert.Equal("unknown", display.OverallStatus);
        Assert.Equal("No system health data", display.EmptyMessage);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_body_is_loaded()
    {
        using var vm = NewViewModel(Loaded(FromFull()));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Services.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_body_is_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthSnapshot>.Loaded(SystemHealthSnapshot.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No system health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_defensively()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthSnapshot>.Cached(FromFull(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<SystemHealthSnapshot>.OfflineCached(
            FromFull(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SystemHealthSnapshot>.Loading(),
            RepositoryResult<SystemHealthSnapshot>.Cached(FromFull(), Now, stale: false),
            RepositoryResult<SystemHealthSnapshot>.Loaded(FromFull(), Now));
        await vm.LoadAsync();

        Assert.Equal(UptimeMonitorState.Loaded, vm.State);
        Assert.Equal(4, vm.Display.Services.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_footprint_flags()
    {
        using var vm = NewViewModel(new UptimeMonitorSize(2, 2), Loaded(FromFull()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.Equal(UptimeMonitorState.Loaded, vm.State);

        vm.Size = new UptimeMonitorSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.False(vm.Display.IsTall);
        Assert.Equal(UptimeMonitorState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(Loaded(FromFull()));
        await vm.LoadAsync();

        Assert.Equal("Uptime Monitor", vm.Title);
        Assert.Equal("No system health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FromFull()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(UptimeMonitorViewModel.State), changed);
        Assert.Contains(nameof(UptimeMonitorViewModel.Display), changed);
    }

    // ---- Source: single-call composition -------------------------------------------

    [Fact]
    public async Task Source_requests_system_health_and_maps_snapshot()
    {
        using var body = JsonDocument.Parse(FullBody);
        var api = new FakeApiClient().ReturnsValue(body.RootElement);
        var source = new UptimeMonitorSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasData);
        Assert.Equal("healthy", terminal.Value.OverallStatus);
        Assert.Equal(4, terminal.Value.Components.Count);

        Assert.Single(api.Requests);
        Assert.Equal(UptimeMonitorRegistration.HealthOperationId, api.Requests[0].OperationId);
    }

    [Fact]
    public async Task Source_non_object_body_is_loaded_without_data()
    {
        using var body = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(body.RootElement);
        var source = new UptimeMonitorSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.False(terminal.Value!.HasData);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("uptime-monitor", UptimeMonitorRegistration.Id);
        Assert.Equal("system", UptimeMonitorRegistration.Category);
        Assert.Equal("UptimeMonitorWidget", UptimeMonitorRegistration.Slug);
        Assert.Equal(new UptimeMonitorSize(2, 2), UptimeMonitorRegistration.DefaultSize);
        Assert.Equal(new UptimeMonitorSize(1, 2), UptimeMonitorRegistration.MinSize);
        Assert.Equal(new UptimeMonitorSize(4, 40), UptimeMonitorRegistration.MaxSize);
        Assert.Equal("Uptime Monitor", UptimeMonitorRegistration.Name(Localizer));
        Assert.Contains("System health", UptimeMonitorRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 2, false)]
    [InlineData(5, 40, false)]
    [InlineData(2, 41, false)]
    [InlineData(2, 1, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, UptimeMonitorRegistration.IsWithinBounds(new UptimeMonitorSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new UptimeMonitorSize(1, 2), UptimeMonitorRegistration.Clamp(new UptimeMonitorSize(0, 0)));
        Assert.Equal(new UptimeMonitorSize(4, 40), UptimeMonitorRegistration.Clamp(new UptimeMonitorSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_id_resolves_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(UptimeMonitorRegistration.HealthOperationId, out var health));
        Assert.Equal("/system/health", health!.Path);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new UptimeMonitorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UptimeMonitorWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SystemHealthSnapshot FromFull()
    {
        using var doc = JsonDocument.Parse(FullBody);
        return SystemHealthSnapshot.FromJson(doc.RootElement);
    }

    private static UptimeMonitorDisplay Project(SystemHealthSnapshot snapshot) =>
        Project(snapshot, UptimeMonitorSize.Default);

    private static UptimeMonitorDisplay Project(SystemHealthSnapshot snapshot, UptimeMonitorSize size) =>
        UptimeMonitorProjection.Project(snapshot, size, Localizer);

    private static RepositoryResult<SystemHealthSnapshot> Loaded(SystemHealthSnapshot snapshot) =>
        RepositoryResult<SystemHealthSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<SystemHealthSnapshot>>> Drain(IUptimeMonitorSource source)
    {
        var results = new List<RepositoryResult<SystemHealthSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static UptimeMonitorViewModel NewViewModel(params RepositoryResult<SystemHealthSnapshot>[] emissions) =>
        NewViewModel(UptimeMonitorSize.Default, emissions);

    private static UptimeMonitorViewModel NewViewModel(
        UptimeMonitorSize size,
        params RepositoryResult<SystemHealthSnapshot>[] emissions) =>
        new(new FakeUptimeMonitorSource(emissions), Localizer, size);

    private sealed class FakeUptimeMonitorSource(params RepositoryResult<SystemHealthSnapshot>[] emissions)
        : IUptimeMonitorSource
    {
        public async IAsyncEnumerable<RepositoryResult<SystemHealthSnapshot>> StreamAsync(
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
