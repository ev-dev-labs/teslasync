using System.Globalization;
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
/// Headless verification of the BackupMonitorWidget's UI-thread-free logic — the backup-runs JSON parse
/// adapter (snake_case fields → run rows), the web <c>fmtBytes</c> / <c>fmtRelativeTime</c> / <c>statusVariant</c>
/// / <c>statusLabel</c> ports, the projection (latest-run stats / newest-first capped feed / labels), the
/// footprint flags, the single-call source composition, the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/BackupMonitorWidget.tsx).
/// </summary>
public sealed class BackupMonitorWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static BackupRun Run(
        long id = 1,
        string? status = "completed",
        string? backupType = "full",
        double fileSize = 1048576,
        string? createdAt = "2026-06-06T11:50:00Z",
        string? completedAt = "2026-06-06T12:00:00Z",
        long? durationMs = 1500) =>
        new(id, status, backupType, fileSize, createdAt, completedAt, durationMs);

    private static BackupMonitorSnapshot Snapshot(params BackupRun[] runs) => new(runs);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseRuns_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":3,"status":"completed","backup_type":"full","file_size":2048,"created_at":"2026-06-06T11:00:00Z","completed_at":"2026-06-06T12:00:00Z","duration_ms":1800}]""");

        var run = Assert.Single(BackupMonitorSnapshot.ParseRuns(doc.RootElement));
        Assert.Equal(3, run.Id);
        Assert.Equal("completed", run.Status);
        Assert.Equal("full", run.BackupType);
        Assert.Equal(2048, run.FileSizeBytes);
        Assert.Equal(1800, run.DurationMs);
        Assert.NotNull(run.CompletedAtTime);
        Assert.NotNull(run.CreatedAtTime);
        Assert.Equal(run.CompletedAtTime, run.SortTime);
    }

    [Fact]
    public void ParseRuns_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":4}]""");

        var run = Assert.Single(BackupMonitorSnapshot.ParseRuns(doc.RootElement));
        Assert.Equal(4, run.Id);
        Assert.Null(run.Status);
        Assert.Null(run.BackupType);
        Assert.Equal(0, run.FileSizeBytes);
        Assert.Null(run.DurationMs);
        Assert.Null(run.SortTime);
    }

    [Fact]
    public void ParseRuns_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":"5","file_size":"4096","duration_ms":"900","completed_at":"2026-06-06T12:00:00Z"}]""");

        var run = Assert.Single(BackupMonitorSnapshot.ParseRuns(doc.RootElement));
        Assert.Equal(5, run.Id);
        Assert.Equal(4096, run.FileSizeBytes);
        Assert.Equal(900, run.DurationMs);
    }

    [Fact]
    public void ParseRuns_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(BackupMonitorSnapshot.ParseRuns(doc.RootElement));
    }

    [Fact]
    public void FromJson_builds_snapshot_with_runs()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"status":"completed","file_size":1024,"completed_at":"2026-06-06T12:00:00Z"}]""");

        var snapshot = BackupMonitorSnapshot.FromJson(doc.RootElement);
        Assert.True(snapshot.HasData);
        Assert.True(snapshot.HasRuns);
        Assert.Single(snapshot.Runs);
    }

    [Fact]
    public void SortTime_prefers_completed_then_created()
    {
        Assert.Equal(
            new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero),
            Run(createdAt: "2026-06-06T11:00:00Z", completedAt: "2026-06-06T12:00:00Z").SortTime);

        Assert.Equal(
            new DateTimeOffset(2026, 6, 6, 11, 0, 0, TimeSpan.Zero),
            Run(createdAt: "2026-06-06T11:00:00Z", completedAt: null).SortTime);
    }

    [Fact]
    public void Snapshot_empty_and_fetched_flags()
    {
        Assert.False(BackupMonitorSnapshot.Empty.HasData);
        Assert.False(BackupMonitorSnapshot.Empty.HasRuns);

        Assert.True(Snapshot(Run()).HasData);
        Assert.True(Snapshot(Run()).HasRuns);

        Assert.True(Snapshot().HasData);
        Assert.False(Snapshot().HasRuns);
    }

    // ---- Byte formatter (port of web fmtBytes) -------------------------------------

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(-5, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1023, "1023 B")]
    [InlineData(1024, "1.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1048576, "1.0 MB")]
    [InlineData(5242880, "5.0 MB")]
    [InlineData(15728640, "15 MB")]
    [InlineData(1073741824, "1.0 GB")]
    [InlineData(1099511627776, "1.0 TB")]
    [InlineData(1125899906842624, "1024 TB")]
    public void FormatBytes_matches_web(double bytes, string expected) =>
        Assert.Equal(expected, BackupMonitorProjection.FormatBytes(bytes));

    // ---- Relative-time formatter (port of web fmtRelativeTime) ----------------------

    [Fact]
    public void FormatRelativeTime_null_is_em_dash() =>
        Assert.Equal("\u2014", BackupMonitorProjection.FormatRelativeTime(null, Now));

    [Fact]
    public void FormatRelativeTime_future_is_just_now() =>
        Assert.Equal("just now", BackupMonitorProjection.FormatRelativeTime(Now.AddMinutes(5), Now));

    [Theory]
    [InlineData(0, "just now")]
    [InlineData(30, "just now")]
    [InlineData(5 * 60, "5m ago")]
    [InlineData(59 * 60, "59m ago")]
    [InlineData(90 * 60, "1h ago")]
    [InlineData(3 * 3600, "3h ago")]
    [InlineData(25 * 3600, "1d ago")]
    [InlineData(50 * 3600, "2d ago")]
    public void FormatRelativeTime_tiers_match_web(int secondsAgo, string expected) =>
        Assert.Equal(expected, BackupMonitorProjection.FormatRelativeTime(Now.AddSeconds(-secondsAgo), Now));

    // ---- Status mapping (web statusVariant / statusDotColor / statusLabel) ----------

    [Theory]
    [InlineData("completed", StatusKind.Success)]
    [InlineData("running", StatusKind.Warning)]
    [InlineData("queued", StatusKind.Warning)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("cancelled", StatusKind.Danger)]
    [InlineData(null, StatusKind.Danger)]
    public void StatusKindFor_matches_web(string? status, StatusKind expected) =>
        Assert.Equal(expected, BackupMonitorProjection.StatusKindFor(status));

    [Theory]
    [InlineData("completed", "Success")]
    [InlineData("running", "Running")]
    [InlineData("queued", "Queued")]
    [InlineData("failed", "Failed")]
    [InlineData("weird", "Failed")]
    [InlineData(null, "Failed")]
    public void StatusLabelFor_matches_web(string? status, string expected) =>
        Assert.Equal(expected, BackupMonitorProjection.StatusLabelFor(status, Localizer));

    // ---- Size / footprint flags (web isCompact / isWide) ----------------------------

    [Theory]
    [InlineData(1, 2, true, false)]
    [InlineData(2, 2, false, false)]
    [InlineData(3, 4, false, false)]
    [InlineData(4, 40, false, true)]
    public void Size_footprint_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new BackupMonitorSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    [Fact]
    public void Size_recent_runs_cap_is_five() => Assert.Equal(5, BackupMonitorSize.RecentRunsCap);

    // ---- Projection: latest-run stats ----------------------------------------------

    [Fact]
    public void Project_formats_latest_run_stats()
    {
        var display = Project(Snapshot(
            Run(id: 1, status: "completed", backupType: "full", fileSize: 1048576, completedAt: "2026-06-06T12:00:00Z"),
            Run(id: 2, status: "failed", completedAt: "2026-06-06T10:00:00Z")));

        Assert.True(display.HasRuns);
        Assert.Equal("5m ago", display.LastBackupValue);   // latest completed 12:00, now 12:05
        Assert.Equal("1.0 MB", display.SizeValue);
        Assert.Equal("full", display.TypeValue);
        Assert.Equal("Success", display.LatestStatusText);
        Assert.Equal(StatusKind.Success, display.LatestStatusKind);
        Assert.False(display.LatestIsFailed);
        Assert.Equal("Last backup", display.LastBackupLabel);
        Assert.Equal("Backup Size", display.SizeLabel);
        Assert.Equal("Type", display.TypeLabel);
        Assert.Equal("Status", display.StatusLabel);
        Assert.Equal("Recent Runs", display.RecentRunsLabel);
    }

    [Fact]
    public void Project_type_falls_back_to_em_dash_when_missing()
    {
        var display = Project(Snapshot(Run(backupType: null)));
        Assert.Equal("\u2014", display.TypeValue);
    }

    [Fact]
    public void Project_failed_tint_only_on_literal_failed_status()
    {
        Assert.True(Project(Snapshot(Run(status: "failed"))).LatestIsFailed);

        // Danger-toned but not literally "failed" → no red tint (web latestStatus === 'failed').
        var cancelled = Project(Snapshot(Run(status: "cancelled")));
        Assert.Equal(StatusKind.Danger, cancelled.LatestStatusKind);
        Assert.False(cancelled.LatestIsFailed);
    }

    [Fact]
    public void Project_no_runs_has_empty_stats_and_no_rows()
    {
        var display = Project(Snapshot());
        Assert.False(display.HasRuns);
        Assert.Empty(display.RecentRuns);
        Assert.Equal("\u2014", display.LastBackupValue);
        Assert.Equal("0 B", display.SizeValue);
        Assert.Equal("\u2014", display.TypeValue);
        Assert.Equal("Failed", display.LatestStatusText);   // web latest status defaults to 'failed'
    }

    // ---- Projection: recent-runs feed ----------------------------------------------

    [Fact]
    public void Project_sorts_rows_newest_first_and_caps_to_five()
    {
        var runs = new List<BackupRun>();
        for (int i = 0; i < 7; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            runs.Add(Run(id: i, completedAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = Project(Snapshot(runs.ToArray()));

        Assert.Equal(5, display.RecentRuns.Count);   // cap = 5
        Assert.Equal(6, display.RecentRuns[0].Id);    // newest first
        Assert.Equal(2, display.RecentRuns[^1].Id);
    }

    [Fact]
    public void Project_row_subtext_includes_size_and_duration()
    {
        var row = Project(Snapshot(Run(fileSize: 2048, durationMs: 1500))).RecentRuns[0];
        Assert.Equal("2.0 KB \u00B7 1500ms", row.SubText);
        Assert.Equal(StatusKind.Success, row.Status);
        Assert.False(string.IsNullOrWhiteSpace(row.TimeText));
        Assert.NotEqual("\u2014", row.TimeText);
    }

    [Fact]
    public void Project_row_subtext_omits_duration_when_absent()
    {
        var row = Project(Snapshot(Run(fileSize: 2048, durationMs: null))).RecentRuns[0];
        Assert.Equal("2.0 KB", row.SubText);
    }

    [Fact]
    public void Project_row_accessibility_name_combines_time_size_status()
    {
        var row = Project(Snapshot(Run(fileSize: 2048, durationMs: 1500, status: "completed"))).RecentRuns[0];
        Assert.StartsWith(row.TimeText, row.AccessibilityName, StringComparison.Ordinal);
        Assert.Contains("2.0 KB", row.AccessibilityName, StringComparison.Ordinal);
        Assert.Contains("Success", row.AccessibilityName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_combines_label_time_status()
    {
        var name = Project(Snapshot(Run(status: "completed", completedAt: "2026-06-06T12:00:00Z"))).CompactAutomationName;
        Assert.Contains("Last backup", name, StringComparison.Ordinal);
        Assert.Contains("5m ago", name, StringComparison.Ordinal);
        Assert.Contains("Success", name, StringComparison.Ordinal);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BackupMonitorSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Loading, vm.State);
        Assert.False(vm.HasRuns);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_runs_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Run(id: 1), Run(id: 2, completedAt: "2026-06-06T11:00:00Z"))));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Loaded, vm.State);
        Assert.True(vm.HasRuns);
        Assert.Equal(2, vm.Display.RecentRuns.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_runs_is_empty()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Empty, vm.State);
        Assert.False(vm.HasRuns);
        Assert.Equal("No backup data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_defensively()
    {
        using var vm = NewViewModel(RepositoryResult<BackupMonitorSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Empty, vm.State);
        Assert.False(vm.HasRuns);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupMonitorSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupMonitorSnapshot>.Cached(Snapshot(Run(id: 1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRuns);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<BackupMonitorSnapshot>.OfflineCached(
            Snapshot(Run(id: 1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Offline, vm.State);
        Assert.True(vm.HasRuns);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupMonitorSnapshot>.Loading(),
            RepositoryResult<BackupMonitorSnapshot>.Cached(Snapshot(Run(id: 1)), Now, stale: false),
            RepositoryResult<BackupMonitorSnapshot>.Loaded(Snapshot(Run(id: 1), Run(id: 2, completedAt: "2026-06-06T11:00:00Z")), Now));
        await vm.LoadAsync();

        Assert.Equal(BackupMonitorState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.RecentRuns.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_footprint_flags()
    {
        using var vm = NewViewModel(new BackupMonitorSize(2, 2), Loaded(Snapshot(Run(id: 1))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.False(vm.Display.IsWide);
        Assert.Equal(BackupMonitorState.Loaded, vm.State);

        vm.Size = new BackupMonitorSize(1, 2);
        Assert.True(vm.Display.IsCompact);

        vm.Size = new BackupMonitorSize(4, 8);
        Assert.True(vm.Display.IsWide);
        Assert.Equal(BackupMonitorState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        await vm.LoadAsync();

        Assert.Equal("Backup Monitor", vm.Title);
        Assert.Equal("No backup data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Run(id: 1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BackupMonitorViewModel.State), changed);
        Assert.Contains(nameof(BackupMonitorViewModel.Display), changed);
    }

    // ---- Source: single-call composition -------------------------------------------

    [Fact]
    public async Task Source_requests_backup_runs_and_maps_snapshot()
    {
        using var runs = JsonDocument.Parse(
            """[{"id":1,"status":"completed","file_size":1024,"completed_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(runs.RootElement);
        var source = new BackupMonitorSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasRuns);
        Assert.Single(terminal.Value.Runs);

        Assert.Single(api.Requests);
        Assert.Equal(BackupMonitorRegistration.RunsOperationId, api.Requests[0].OperationId);
    }

    [Fact]
    public async Task Source_empty_array_is_loaded_without_runs()
    {
        using var runs = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(runs.RootElement);
        var source = new BackupMonitorSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasData);
        Assert.False(terminal.Value.HasRuns);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("backup-monitor", BackupMonitorRegistration.Id);
        Assert.Equal("system", BackupMonitorRegistration.Category);
        Assert.Equal("BackupMonitorWidget", BackupMonitorRegistration.Slug);
        Assert.Equal(new BackupMonitorSize(2, 2), BackupMonitorRegistration.DefaultSize);
        Assert.Equal(new BackupMonitorSize(1, 2), BackupMonitorRegistration.MinSize);
        Assert.Equal(new BackupMonitorSize(4, 40), BackupMonitorRegistration.MaxSize);
        Assert.Equal("Backup Monitor", BackupMonitorRegistration.Name(Localizer));
        Assert.Contains("backup", BackupMonitorRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, BackupMonitorRegistration.IsWithinBounds(new BackupMonitorSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BackupMonitorSize(1, 2), BackupMonitorRegistration.Clamp(new BackupMonitorSize(0, 0)));
        Assert.Equal(new BackupMonitorSize(4, 40), BackupMonitorRegistration.Clamp(new BackupMonitorSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_id_resolves_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(BackupMonitorRegistration.RunsOperationId, out var runs));
        Assert.Equal("/backup/runs", runs!.Path);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BackupMonitorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BackupMonitorWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static BackupMonitorDisplay Project(BackupMonitorSnapshot snapshot) =>
        Project(snapshot, BackupMonitorSize.Default);

    private static BackupMonitorDisplay Project(BackupMonitorSnapshot snapshot, BackupMonitorSize size) =>
        BackupMonitorProjection.Project(snapshot, size, Localizer, Now);

    private static RepositoryResult<BackupMonitorSnapshot> Loaded(BackupMonitorSnapshot snapshot) =>
        RepositoryResult<BackupMonitorSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<BackupMonitorSnapshot>>> Drain(IBackupMonitorSource source)
    {
        var results = new List<RepositoryResult<BackupMonitorSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static BackupMonitorViewModel NewViewModel(params RepositoryResult<BackupMonitorSnapshot>[] emissions) =>
        NewViewModel(BackupMonitorSize.Default, emissions);

    private static BackupMonitorViewModel NewViewModel(
        BackupMonitorSize size,
        params RepositoryResult<BackupMonitorSnapshot>[] emissions) =>
        new(new FakeBackupMonitorSource(emissions), Localizer, size, () => Now);

    private sealed class FakeBackupMonitorSource(params RepositoryResult<BackupMonitorSnapshot>[] emissions)
        : IBackupMonitorSource
    {
        public async IAsyncEnumerable<RepositoryResult<BackupMonitorSnapshot>> StreamAsync(
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
