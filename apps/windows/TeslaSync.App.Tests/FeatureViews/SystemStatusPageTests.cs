using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SystemStatusPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/SystemStatusPage.tsx), the tolerant snake_case parsers for the seven queries, the
/// per-source four-state matrix (loading / empty / error / success), the i18n key coverage and the view-model's
/// load orchestration. The WinUI view is exercised by the app build; its per-region visibility is driven entirely by
/// the <see cref="SystemStatusDisplay"/> flags asserted here.
/// </summary>
public sealed class SystemStatusPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 14, 12, 0, 0, TimeSpan.Zero);

    // Every i18n key the projection resolves across all data branches (covers the 77 parity strings + helpers).
    private static readonly string[] AllKeys =
    [
        "systemStatus.apiOverBudget", "systemStatus.apiOverBudgetDesc", "systemStatus.apiUsageDesc",
        "systemStatus.apiUsageTitle", "systemStatus.awaitingFirstCheck", "systemStatus.backups",
        "systemStatus.channels", "systemStatus.channelsValue", "systemStatus.configuredNoRun",
        "systemStatus.configuredSchedules", "systemStatus.connect", "systemStatus.currentVersion",
        "systemStatus.database", "systemStatus.databaseTitle", "systemStatus.errorsSince", "systemStatus.failed",
        "systemStatus.failuresRecent", "systemStatus.health", "systemStatus.healthCheckFailed",
        "systemStatus.lastBackupDaysAgo", "systemStatus.lastBackupToday", "systemStatus.lastChecked",
        "systemStatus.lastCheckedStale", "systemStatus.lastSuccessful", "systemStatus.lastSuccessfulSize",
        "systemStatus.latency", "systemStatus.maintenanceActive", "systemStatus.maintenanceActiveDesc",
        "systemStatus.manage", "systemStatus.manageBackups", "systemStatus.needsAttention", "systemStatus.noBackups",
        "systemStatus.noBackupsDesc", "systemStatus.noChannels", "systemStatus.noData", "systemStatus.noErrors",
        "systemStatus.notConfigured", "systemStatus.notConnected", "systemStatus.notConnectedDesc",
        "systemStatus.notifications", "systemStatus.notificationsSummary", "systemStatus.notificationsTitle",
        "systemStatus.openApiLogs", "systemStatus.openDbHealth", "systemStatus.openErrorLogs",
        "systemStatus.openLiveMonitor", "systemStatus.openNotifications", "systemStatus.operational",
        "systemStatus.pending", "systemStatus.poolAcquired", "systemStatus.poolIdle", "systemStatus.reauthenticate",
        "systemStatus.recentErrors", "systemStatus.refresh", "systemStatus.refreshAria", "systemStatus.releaseNotes",
        "systemStatus.resourcesFootnote", "systemStatus.runHealthCheck", "systemStatus.sentLifetime",
        "systemStatus.services", "systemStatus.servicesSummary", "systemStatus.servicesTitle",
        "systemStatus.setUpBackups", "systemStatus.staleBackup", "systemStatus.staleBackupDesc",
        "systemStatus.storageUsed", "systemStatus.subscribe", "systemStatus.subtitle", "systemStatus.systemInfo",
        "systemStatus.systemInfoCpuNote", "systemStatus.systemInfoDesc", "systemStatus.tables",
        "systemStatus.telemetry", "systemStatus.telemetryIdle", "systemStatus.telemetrySummaryMany",
        "systemStatus.telemetrySummaryOne", "systemStatus.telemetryTitle", "systemStatus.teslaAuth",
        "systemStatus.title", "systemStatus.tokenExpired", "systemStatus.tokenExpiredDesc",
        "systemStatus.tokenExpiring", "systemStatus.tokenExpiringDesc", "systemStatus.totalRows",
        "systemStatus.totalRuns", "systemStatus.updateAvailable", "systemStatus.uptimeFootnote",
        "systemStatus.workers", "systemStatus.workersTitle", "systemStatus.workersUnhealthy",
    ];

    private static readonly string[] RequiredOperationIds =
    [
        SystemStatusRegistration.HealthOperation,
        SystemStatusRegistration.VehiclesOperation,
        SystemStatusRegistration.NotificationsOperation,
        SystemStatusRegistration.AuthOperation,
        SystemStatusRegistration.BackupRunsOperation,
        SystemStatusRegistration.BackupConfigsOperation,
        SystemStatusRegistration.MaintenanceOperation,
    ];

    // ── Model builders ──────────────────────────────────────────────────────────────────────────────────────

    private static SystemStatusModel Loaded() => new(
        HealthLoading: false, HealthHasError: false, HealthError: null,
        Health: new SystemHealthSnapshot(true, "healthy", [new StatusComponentEntry("database", "ok"), new StatusComponentEntry("redis", "ok")]),
        VehiclesLoading: false, VehiclesHasError: false, Vehicles: new StatusVehiclesSnapshot(true, 2),
        NotificationsLoading: false, NotificationsHasError: false, Notifications: new NotificationStatsSnapshot(true, 2, 3, 100, 1, 0),
        AuthLoading: false, AuthHasError: false, Auth: new AuthStatusSnapshot(true, true, true, Now.AddDays(365).ToString("o")),
        BackupRunsLoading: false, BackupRunsHasError: false, BackupRuns: new BackupRunsSnapshot(true, [new BackupRunEntry("completed", Now.ToString("o"), 1_048_576)]),
        BackupConfigsLoading: false, BackupConfigsHasError: false, BackupConfigs: new BackupConfigsSnapshot(true, 1),
        MaintenanceLoading: false, MaintenanceHasError: false, Maintenance: new MaintenanceSnapshot(true, "off", null),
        HealthUpdatedAt: Now);

    private static SystemStatusModel AllEmpty() => Loaded() with
    {
        Health = SystemHealthSnapshot.Empty,
        Vehicles = StatusVehiclesSnapshot.Empty,
        Notifications = NotificationStatsSnapshot.Empty,
        Auth = AuthStatusSnapshot.Empty,
        BackupRuns = BackupRunsSnapshot.Empty,
        BackupConfigs = BackupConfigsSnapshot.Empty,
        Maintenance = MaintenanceSnapshot.Empty,
    };

    private static IEnumerable<SystemStatusModel> AllScenarios()
    {
        yield return SystemStatusModel.Initial;                                                          // loading + awaitingFirstCheck + noData + telemetryIdle + operational
        yield return Loaded();                                                                            // success + lastChecked + servicesSummary + telemetrySummaryMany + notificationsSummary + lastBackupToday
        yield return Loaded() with { HealthHasError = true, HealthError = "boom" };                       // healthCheckFailed
        yield return Loaded() with { HealthUpdatedAt = Now.AddMinutes(-3) };                              // lastCheckedStale
        yield return Loaded() with { Vehicles = new StatusVehiclesSnapshot(true, 0) };                    // telemetryIdle
        yield return Loaded() with { Vehicles = new StatusVehiclesSnapshot(true, 1) };                    // telemetrySummaryOne
        yield return Loaded() with { Notifications = NotificationStatsSnapshot.Empty };                   // operational
        yield return Loaded() with { Notifications = new NotificationStatsSnapshot(true, 0, 0, 0, 0, 0) };// noChannels
        yield return Loaded() with { Maintenance = new MaintenanceSnapshot(true, "maintenance", null) }; // maintenanceActive(+desc+manage)
        yield return Loaded() with { Auth = new AuthStatusSnapshot(true, true, true, Now.AddDays(-1).ToString("o")) };  // tokenExpired(+desc+reauthenticate)
        yield return Loaded() with { Auth = new AuthStatusSnapshot(true, true, true, Now.AddDays(3).ToString("o")) };   // tokenExpiring(+desc)
        yield return Loaded() with { Auth = new AuthStatusSnapshot(true, true, false, null) };            // notConnected (action item)
        yield return Loaded() with { BackupRuns = new BackupRunsSnapshot(true, [new BackupRunEntry("completed", Now.AddDays(-10).ToString("o"), 1024)]) }; // staleBackup(+desc)
        yield return Loaded() with { BackupRuns = new BackupRunsSnapshot(true, []), BackupConfigs = new BackupConfigsSnapshot(true, 1) }; // noBackupsDesc + setUpBackups + configuredNoRun
        yield return Loaded() with { BackupRuns = new BackupRunsSnapshot(true, [new BackupRunEntry("completed", Now.AddDays(-3).ToString("o"), 1024)]) }; // lastBackupDaysAgo
        yield return Loaded() with { BackupRuns = new BackupRunsSnapshot(true, [new BackupRunEntry("running", null, null)]), BackupConfigs = new BackupConfigsSnapshot(true, 1) }; // configuredNoRun
        yield return Loaded() with { BackupRuns = new BackupRunsSnapshot(true, []), BackupConfigs = new BackupConfigsSnapshot(true, 0) }; // notConfigured
    }

    // ── i18n key coverage ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_i18n_key_across_all_branches()
    {
        var recorder = new RecordingLocalizer();

        foreach (var model in AllScenarios())
        {
            _ = SystemStatusProjection.Project(model, recorder, Now);
        }

        foreach (var key in AllKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_the_core_chrome_keys_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SystemStatusProjection.Project(SystemStatusModel.Initial, recorder, Now);

        // The always-rendered chrome (header, panels, accordion titles, footers) resolves on every projection.
        foreach (var key in new[]
        {
            "systemStatus.title", "systemStatus.subtitle", "systemStatus.refresh", "systemStatus.runHealthCheck",
            "systemStatus.health", "systemStatus.needsAttention", "systemStatus.servicesTitle",
            "systemStatus.databaseTitle", "systemStatus.telemetryTitle", "systemStatus.notificationsTitle",
            "systemStatus.workersTitle", "systemStatus.backups", "systemStatus.apiUsageTitle",
            "systemStatus.recentErrors", "systemStatus.systemInfo", "systemStatus.uptimeFootnote",
            "systemStatus.subscribe",
        })
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_first_load_in_flight()
    {
        var display = SystemStatusProjection.Project(SystemStatusModel.Initial, Localizer, Now);

        Assert.Equal(SystemStatusState.Loading, display.State);
        Assert.True(display.IsFirstLoad);
        Assert.Equal(SystemStatusState.Loading, display.HealthSourceState);
        Assert.Equal(SystemStatusState.Loading, display.VehiclesSourceState);
        Assert.Equal(SystemStatusState.Loading, display.AuthSourceState);
    }

    [Fact]
    public void State_empty_when_every_source_resolved_without_data()
    {
        var display = SystemStatusProjection.Project(AllEmpty(), Localizer, Now);

        Assert.Equal(SystemStatusState.Empty, display.State);
        Assert.Equal(SystemStatusState.Empty, display.HealthSourceState);
        Assert.Equal(SystemStatusState.Empty, display.NotificationsSourceState);
        Assert.Equal(SystemStatusState.Empty, display.BackupRunsSourceState);
    }

    [Fact]
    public void State_error_when_health_query_fails()
    {
        var display = SystemStatusProjection.Project(
            Loaded() with { HealthHasError = true, HealthError = "503 Service Unavailable" }, Localizer, Now);

        Assert.Equal(SystemStatusState.Error, display.State);
        Assert.True(display.ShowErrorBanner);
        Assert.Equal("503 Service Unavailable", display.ErrorBannerMessage);
        Assert.Equal(SystemStatusState.Error, display.HealthSourceState);
        Assert.Contains("503 Service Unavailable", display.HeroSubline);
    }

    [Fact]
    public void State_success_when_data_present()
    {
        var display = SystemStatusProjection.Project(Loaded(), Localizer, Now);

        Assert.Equal(SystemStatusState.Success, display.State);
        Assert.False(display.ShowErrorBanner);
        Assert.Equal(SystemStatusState.Success, display.HealthSourceState);
        Assert.Equal(SystemStatusState.Success, display.VehiclesSourceState);
        Assert.Equal(SystemStatusState.Success, display.NotificationsSourceState);
        Assert.Equal(SystemStatusState.Success, display.AuthSourceState);
        Assert.Equal(SystemStatusState.Success, display.BackupRunsSourceState);
        Assert.Equal(SystemStatusState.Success, display.BackupConfigsSourceState);
        Assert.Equal(SystemStatusState.Success, display.MaintenanceSourceState);
    }

    // ── Derived content ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Health_panel_renders_all_six_rows()
    {
        var display = SystemStatusProjection.Project(Loaded(), Localizer, Now);

        Assert.Equal(6, display.HealthRows.Count);
        Assert.Equal(HealthStatus.Healthy, display.HealthRows[0].Status); // services: 2/2 ok
        Assert.Equal("Tesla auth", display.HealthRows[5].Label);
    }

    [Fact]
    public void Overall_status_reflects_maintenance_mode()
    {
        var display = SystemStatusProjection.Project(
            Loaded() with { Maintenance = new MaintenanceSnapshot(true, "maintenance", "msg") }, Localizer, Now);

        Assert.Equal(HealthStatus.Maintenance, display.OverallStatus);
        Assert.Contains(display.ActionItems, a => a.Title == "Maintenance mode is active");
    }

    [Fact]
    public void Stale_health_downgrades_overall_status_to_unknown()
    {
        var display = SystemStatusProjection.Project(Loaded() with { HealthUpdatedAt = Now.AddMinutes(-5) }, Localizer, Now);

        Assert.True(display.IsStale);
        Assert.Equal(HealthStatus.Unknown, display.OverallStatus);
    }

    [Fact]
    public void Expired_token_produces_an_error_action_item_with_interpolation()
    {
        var display = SystemStatusProjection.Project(
            Loaded() with { Auth = new AuthStatusSnapshot(true, true, true, Now.AddDays(-1).ToString("o")) }, Localizer, Now);

        var item = Assert.Single(display.ActionItems, a => a.Severity == CalloutSeverity.Error);
        Assert.Equal("Tesla token expired", item.Title);
        Assert.Equal("Re-authenticate", item.CtaLabel);
    }

    [Fact]
    public void Expiring_token_interpolates_the_day_count()
    {
        var display = SystemStatusProjection.Project(
            Loaded() with { Auth = new AuthStatusSnapshot(true, true, true, Now.AddDays(3).ToString("o")) }, Localizer, Now);

        var item = Assert.Single(display.ActionItems, a => a.Title.StartsWith("Tesla token expires in", StringComparison.Ordinal));
        Assert.DoesNotContain("{{", item.Title, StringComparison.Ordinal);
        Assert.Contains("3", item.Title, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_backup_produces_a_warning_action_item()
    {
        var display = SystemStatusProjection.Project(
            Loaded() with { BackupRuns = new BackupRunsSnapshot(true, [new BackupRunEntry("completed", Now.AddDays(-10).ToString("o"), 1024)]) },
            Localizer, Now);

        Assert.Contains(display.ActionItems, a => a.Title.Contains("10 days old", StringComparison.Ordinal));
    }

    [Fact]
    public void Backups_summary_reads_today_for_a_fresh_run()
    {
        var display = SystemStatusProjection.Project(Loaded(), Localizer, Now);

        Assert.Equal("Last backup: today", display.BackupsSummary);
        Assert.Equal(5, display.BackupRows.Count);
    }

    [Fact]
    public void Uptime_heatmap_spans_thirty_days()
    {
        var display = SystemStatusProjection.Project(Loaded(), Localizer, Now);

        Assert.Equal(30, display.UptimeDays.Count);
        Assert.Equal(HealthStatus.Healthy, display.UptimeDays[^1].Status); // today reflects current status
    }

    // ── Snapshot parsers (tolerant snake_case) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Health_snapshot_parses_components_and_drops_camelcase_aliases()
    {
        var json = Parse("""{"status":"degraded","components":{"database":{"status":"ok"},"redis":{"status":"down"},"signalStore":{"status":"ok"}}}""");
        var snapshot = SystemHealthSnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Equal("degraded", snapshot.Status);
        // The camelCase "signalStore" alias is filtered; only the two snake_case keys remain.
        Assert.Equal(2, snapshot.Components.Count);
    }

    [Fact]
    public void Vehicles_snapshot_counts_array_length()
    {
        var snapshot = StatusVehiclesSnapshot.FromJson(Parse("""[{"id":1},{"id":2},{"id":3}]"""));

        Assert.True(snapshot.HasData);
        Assert.Equal(3, snapshot.Count);
    }

    [Fact]
    public void Notification_stats_snapshot_prefers_total_sent()
    {
        var snapshot = NotificationStatsSnapshot.FromJson(
            Parse("""{"enabled_channels":2,"total_channels":4,"total_sent":250,"pending":3,"failed":1}"""));

        Assert.True(snapshot.HasData);
        Assert.Equal(2, snapshot.EnabledChannels);
        Assert.Equal(250, snapshot.Sent);
        Assert.Equal(1, snapshot.Failed);
    }

    [Fact]
    public void Auth_snapshot_tracks_tristate_authenticated()
    {
        var connected = AuthStatusSnapshot.FromJson(Parse("""{"authenticated":true,"expires_at":"2027-01-01T00:00:00Z"}"""));
        Assert.True(connected.HasAuthenticated);
        Assert.True(connected.Authenticated);

        var unknown = AuthStatusSnapshot.FromJson(Parse("""{"expires_at":"2027-01-01T00:00:00Z"}"""));
        Assert.False(unknown.HasAuthenticated);
    }

    [Fact]
    public void Backup_runs_snapshot_reads_status_and_completion()
    {
        var snapshot = BackupRunsSnapshot.FromJson(
            Parse("""[{"status":"completed","completed_at":"2026-06-14T00:00:00Z","file_size":2048},{"status":"failed"}]"""));

        Assert.True(snapshot.HasData);
        Assert.Equal(2, snapshot.Runs.Count);
        Assert.Equal(2048, snapshot.Runs[0].FileSize);
    }

    [Fact]
    public void Maintenance_snapshot_detects_active_mode()
    {
        Assert.True(MaintenanceSnapshot.FromJson(Parse("""{"mode":"maintenance","maintenance_message":"x"}""")).IsActive);
        Assert.False(MaintenanceSnapshot.FromJson(Parse("""{"mode":"off"}""")).IsActive);
    }

    // ── Generated-client contract ───────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(OperationIds))]
    public void Every_operation_resolves_against_the_generated_endpoint_table(string operationId)
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == operationId);

        Assert.True(descriptor is not null, $"Operation '{operationId}' is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    public static IEnumerable<object[]> OperationIds() => RequiredOperationIds.Select(id => new object[] { id });

    // ── View-model orchestration ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_reaches_success_after_loading_every_source()
    {
        var vm = new SystemStatusPageViewModel(new FakeFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SystemStatusState.Success, vm.State);
        Assert.False(vm.IsFetching);
        Assert.Equal(6, vm.Display.HealthRows.Count);
        Assert.Equal("Last backup: today", vm.Display.BackupsSummary);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_state_when_health_fails()
    {
        var vm = new SystemStatusPageViewModel(new FakeFeed { FailHealth = true }, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SystemStatusState.Error, vm.State);
        Assert.True(vm.Display.ShowErrorBanner);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : ISystemStatusFeed
    {
        public bool FailHealth { get; init; }

        public Task<SystemHealthSnapshot> FetchHealthAsync(CancellationToken cancellationToken) =>
            FailHealth
                ? Task.FromException<SystemHealthSnapshot>(new InvalidOperationException("health down"))
                : Task.FromResult(new SystemHealthSnapshot(true, "healthy", [new StatusComponentEntry("database", "ok"), new StatusComponentEntry("redis", "ok")]));

        public Task<StatusVehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new StatusVehiclesSnapshot(true, 2));

        public Task<NotificationStatsSnapshot> FetchNotificationsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new NotificationStatsSnapshot(true, 2, 3, 100, 0, 0));

        public Task<AuthStatusSnapshot> FetchAuthAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new AuthStatusSnapshot(true, true, true, Now.AddDays(365).ToString("o")));

        public Task<BackupRunsSnapshot> FetchBackupRunsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new BackupRunsSnapshot(true, [new BackupRunEntry("completed", Now.ToString("o"), 1_048_576)]));

        public Task<BackupConfigsSnapshot> FetchBackupConfigsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new BackupConfigsSnapshot(true, 1));

        public Task<MaintenanceSnapshot> FetchMaintenanceAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new MaintenanceSnapshot(true, "off", null));
    }
}
