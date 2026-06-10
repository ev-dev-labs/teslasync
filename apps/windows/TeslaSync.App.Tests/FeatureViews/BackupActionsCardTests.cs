using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BackupActionsCard</c> surface's UI-thread-free logic — the backup-runs JSON
/// parse adapter (total / last-successful / recent-failure derivation), the projection (web backup-section
/// <c>DefList</c> rows + <c>formatBytes</c> port), the repository source's request shapes (the status read and
/// the quick-backup mutation, classified-not-thrown), the state-holder view-model's read-state matrix
/// (loading / ready / empty / error / stale / offline) and the mutation flow (idle → running → succeeded /
/// failed, the in-flight guard, the permission vs generic failure messages, the post-success refresh), the
/// registry metadata + i18n facade copy, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/BackupActionsCard.tsx and its backup-section rows in
/// web/src/features/system/pages/SystemStatusPage.tsx).
/// </summary>
public sealed class BackupActionsCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse adapter ------------------------------------------------------------------------------

    [Fact]
    public void Snapshot_derives_total_last_successful_and_failures_from_snake_case()
    {
        using var doc = JsonDocument.Parse(
            """
            [
              {"status":"failed","completed_at":"2026-06-06T09:00:00Z","file_size":10},
              {"status":"completed","completed_at":"2026-06-06T08:00:00Z","file_size":2048},
              {"status":"completed","completed_at":"2026-06-06T07:00:00Z","file_size":4096},
              {"status":"failed"}
            ]
            """);

        var snap = BackupActionsSnapshot.FromJson(doc.RootElement);

        Assert.True(snap.HasData);
        Assert.True(snap.HasRuns);
        Assert.Equal(4, snap.TotalRuns);
        Assert.Equal(2, snap.RecentFailures);
        // Web parity: the FIRST completed run in newest-first order is the last successful one.
        Assert.Equal("2026-06-06T08:00:00Z", snap.LastSuccessfulCompletedAt);
        Assert.Equal(2048, snap.LastSuccessfulSizeBytes);
        Assert.NotNull(snap.LastSuccessfulCompletedAtInstant);
    }

    [Fact]
    public void Snapshot_with_no_completed_run_has_no_last_successful()
    {
        using var doc = JsonDocument.Parse("""[{"status":"failed"},{"status":"running"}]""");

        var snap = BackupActionsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(2, snap.TotalRuns);
        Assert.Equal(1, snap.RecentFailures);
        Assert.Null(snap.LastSuccessfulCompletedAt);
        Assert.Null(snap.LastSuccessfulSizeBytes);
        Assert.Null(snap.LastSuccessfulCompletedAtInstant);
    }

    [Fact]
    public void Snapshot_is_tolerant_of_partial_rows_and_non_array_bodies()
    {
        using var partial = JsonDocument.Parse("""[{"id":1},{"status":"completed"}]""");
        var snap = BackupActionsSnapshot.FromJson(partial.RootElement);
        Assert.Equal(2, snap.TotalRuns);
        Assert.Equal(0, snap.RecentFailures);
        Assert.Null(snap.LastSuccessfulCompletedAt);
        Assert.Null(snap.LastSuccessfulSizeBytes);

        using var notArray = JsonDocument.Parse("""{"error":"nope"}""");
        var empty = BackupActionsSnapshot.FromJson(notArray.RootElement);
        Assert.False(empty.HasData);
        Assert.False(empty.HasRuns);
        Assert.Equal(0, empty.TotalRuns);
    }

    [Fact]
    public void Snapshot_accepts_numeric_string_file_size()
    {
        using var doc = JsonDocument.Parse(
            """[{"status":"completed","completed_at":"2026-06-06T08:00:00Z","file_size":"4096"}]""");

        var snap = BackupActionsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(4096, snap.LastSuccessfulSizeBytes);
    }

    // ---- Projection (formatBytes + DefList rows) ----------------------------------------------------

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(-5, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(2048, "2.0 KB")]
    [InlineData(1572864, "1.5 MB")]
    [InlineData(471859200, "450 MB")]
    [InlineData(1610612736, "1.5 GB")]
    public void FormatBytes_matches_web_helper(double bytes, string expected) =>
        Assert.Equal(expected, BackupActionsProjection.FormatBytes(bytes));

    [Fact]
    public void Projection_builds_the_four_backup_section_rows()
    {
        var display = BackupActionsProjection.Project(
            new BackupActionsSnapshot(3, "2026-06-06T08:00:00Z", 2048, 1), Localizer, Now);

        Assert.True(display.HasRuns);
        Assert.Equal(4, display.Rows.Count);
        Assert.Equal("Total runs", display.Rows[0].Label);
        Assert.Equal("3", display.Rows[0].Value);
        Assert.Equal("Last successful", display.Rows[1].Label);
        Assert.NotEqual("\u2014", display.Rows[1].Value);
        Assert.Equal("Last successful size", display.Rows[2].Label);
        Assert.Equal("2.0 KB", display.Rows[2].Value);
        Assert.Equal("Failures (recent)", display.Rows[3].Label);
        Assert.Equal("1", display.Rows[3].Value);
        Assert.Contains("Total runs: 3", display.AccessibilitySummary, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_renders_em_dash_when_no_successful_run()
    {
        var display = BackupActionsProjection.Project(
            new BackupActionsSnapshot(2, null, null, 2), Localizer, Now);

        Assert.Equal("\u2014", display.Rows[1].Value); // Last successful
        Assert.Equal("\u2014", display.Rows[2].Value); // Last successful size
        Assert.Equal("2", display.Rows[3].Value);      // Failures (recent)
    }

    [Fact]
    public void Projection_empty_snapshot_has_no_runs_and_localized_empty_message()
    {
        var display = BackupActionsProjection.Project(BackupActionsSnapshot.Empty, Localizer, Now);

        Assert.False(display.HasRuns);
        Assert.Equal("No backups have run yet", display.EmptyMessage);
    }

    // ---- Repository source (request shapes, classified-not-thrown) ----------------------------------

    [Fact]
    public async Task Source_status_read_parses_runs_into_a_snapshot()
    {
        using var doc = JsonDocument.Parse(
            """[{"status":"completed","completed_at":"2026-06-06T08:00:00Z","file_size":2048},{"status":"failed"}]""");
        var client = new FakeApiClient().ReturnsValue<JsonElement>(doc.RootElement.Clone());

        var emissions = await Collect(NewSource(client).StreamStatusAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.TotalRuns);
        Assert.Equal(1, emissions[^1].Value!.RecentFailures);
        Assert.Equal(BackupActionsCardRegistration.RunsOperationId, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_quick_backup_posts_to_the_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"id":99,"status":"started"}""");
        var client = new FakeApiClient().ReturnsValue<JsonElement>(doc.RootElement.Clone());

        var outcome = await NewSource(client).RunQuickBackupAsync();

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        var request = Assert.Single(client.Requests);
        Assert.Equal("post_api_v1_backup_quick", request.OperationId);
        Assert.Equal(BackupActionsCardRegistration.QuickBackupOperationId, request.OperationId);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task Source_quick_backup_failure_is_classified_not_thrown()
    {
        var client = new FakeApiClient().Throws(new ApiException("denied", 403, null, "FORBIDDEN"));

        var outcome = await NewSource(client).RunQuickBackupAsync();

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Unauthorized, outcome.Error!.Kind);
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(BackupActionsCardRegistration.RunsOperationId, out var runs));
        Assert.Equal("/backup/runs", runs!.Path);
        Assert.True(index.TryGetValue(BackupActionsCardRegistration.QuickBackupOperationId, out var quick));
        Assert.Equal("/backup/quick", quick!.Path);
    }

    // ---- View-model: read-state matrix --------------------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = NewViewModel();
        Assert.Equal(BackupActionsState.Loading, vm.State);
        Assert.True(vm.IsButtonEnabled);
        Assert.Equal("Run quick backup now", vm.RunButtonLabel);
    }

    [Fact]
    public async Task ViewModel_ready_when_runs_are_loaded()
    {
        using var vm = NewViewModel(Loaded(WithRuns()));

        await vm.LoadAsync();

        Assert.Equal(BackupActionsState.Ready, vm.State);
        Assert.True(vm.HasRuns);
        Assert.Equal(4, vm.Display.Rows.Count);
        Assert.Null(vm.StatusHint);
        Assert.Null(vm.ReadErrorMessage);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_runs()
    {
        using var vm = NewViewModel(Loaded(new BackupActionsSnapshot(0, null, null, 0)));

        await vm.LoadAsync();

        Assert.Equal(BackupActionsState.Empty, vm.State);
        Assert.False(vm.HasRuns);
        Assert.Equal("No backups have run yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_read_fails_with_no_cache()
    {
        using var vm = NewViewModel(Failure(RepositoryErrorKind.Server));

        await vm.LoadAsync();

        Assert.Equal(BackupActionsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("Couldn't load backup status", vm.ReadErrorMessage);
    }

    [Fact]
    public async Task ViewModel_error_uses_auth_message_for_unauthorized()
    {
        using var vm = NewViewModel(Failure(RepositoryErrorKind.Unauthorized));

        await vm.LoadAsync();

        Assert.Equal("Sign in to view backup status", vm.ReadErrorMessage);
    }

    [Fact]
    public async Task ViewModel_stale_keeps_rows_and_shows_hint()
    {
        using var vm = NewViewModel(Cached(WithRuns(), stale: true));

        await vm.LoadAsync();

        Assert.Equal(BackupActionsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRuns);
        Assert.Equal("Backup status may be out of date", vm.StatusHint);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_rows_and_shows_offline_hint()
    {
        using var vm = NewViewModel(Offline(WithRuns()));

        await vm.LoadAsync();

        Assert.Equal(BackupActionsState.Offline, vm.State);
        Assert.True(vm.HasRuns);
        Assert.Equal("You're offline — showing the last cached backup status", vm.StatusHint);
    }

    // ---- View-model: quick-backup mutation flow -----------------------------------------------------

    [Fact]
    public async Task ViewModel_success_shows_started_feedback_and_refreshes()
    {
        var source = new FakeBackupActionsSource(Loaded(WithRuns()));
        using var vm = new BackupActionsCardViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();

        await vm.RunQuickBackupAsync();

        Assert.Equal(BackupActionPhase.Succeeded, vm.Phase);
        Assert.Equal(BackupActionFeedbackTone.Success, vm.FeedbackTone);
        Assert.Equal("Quick backup started", vm.FeedbackMessage);
        Assert.True(vm.IsButtonEnabled);
        Assert.Equal("Run quick backup now", vm.RunButtonLabel);
        Assert.Equal(1, source.RunCount);
        // Web parity: the backup-runs query is refreshed after a successful trigger (≥ 2 status streams).
        Assert.True(source.StatusStreamCount >= 2);
    }

    [Fact]
    public async Task ViewModel_permission_failure_shows_admin_message()
    {
        var source = new FakeBackupActionsSource(Loaded(WithRuns()))
        {
            QuickHandler = () => Task.FromResult(
                QuickBackupOutcome.Fail(new RepositoryError(RepositoryErrorKind.Unauthorized, "denied", 403))),
        };
        using var vm = new BackupActionsCardViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();

        await vm.RunQuickBackupAsync();

        Assert.Equal(BackupActionPhase.Failed, vm.Phase);
        Assert.Equal(BackupActionFeedbackTone.Error, vm.FeedbackTone);
        Assert.Equal("Quick backup requires admin permission.", vm.FeedbackMessage);
    }

    [Fact]
    public async Task ViewModel_generic_failure_interpolates_the_error_message()
    {
        var source = new FakeBackupActionsSource(Loaded(WithRuns()))
        {
            QuickHandler = () => Task.FromResult(
                QuickBackupOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "Disk full", 500))),
        };
        using var vm = new BackupActionsCardViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();

        await vm.RunQuickBackupAsync();

        Assert.Equal("Backup failed: Disk full", vm.FeedbackMessage);
    }

    [Fact]
    public async Task ViewModel_guards_against_a_double_trigger_while_running()
    {
        var gate = new TaskCompletionSource<QuickBackupOutcome>();
        var source = new FakeBackupActionsSource(Loaded(WithRuns())) { QuickHandler = () => gate.Task };
        using var vm = new BackupActionsCardViewModel(source, Localizer, clock: () => Now);
        await vm.LoadAsync();

        var first = vm.RunQuickBackupAsync();
        Assert.True(vm.IsRunning);
        Assert.Equal("Starting\u2026", vm.RunButtonLabel);
        Assert.False(vm.IsButtonEnabled);

        // Web parity: `if (mutation.isPending) return` — the second click is dropped.
        await vm.RunQuickBackupAsync();
        Assert.Equal(1, source.RunCount);

        gate.SetResult(QuickBackupOutcome.Ok());
        await first;
        Assert.Equal(BackupActionPhase.Succeeded, vm.Phase);
    }

    // ---- Registry, i18n copy + accessibility --------------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("backup-actions-card", BackupActionsCardRegistration.Id);
        Assert.Equal("BackupActionsCard", BackupActionsCardRegistration.Slug);
        Assert.Equal("backup", BackupActionsCardRegistration.BackupRoutePath);
    }

    [Fact]
    public void Registration_resolves_every_web_string_through_the_facade()
    {
        Assert.Equal("Run quick backup now", BackupActionsCardRegistration.RunLabel(Localizer));
        Assert.Equal("Starting\u2026", BackupActionsCardRegistration.StartingLabel(Localizer));
        Assert.Equal("Manage backups & restore", BackupActionsCardRegistration.ManageLabel(Localizer));
        Assert.Equal("Quick backup started", BackupActionsCardRegistration.StartedLabel(Localizer));
        Assert.Equal(
            "Quick backup requires admin permission.",
            BackupActionsCardRegistration.PermissionErrorLabel(Localizer));
        Assert.Equal("Backups", BackupActionsCardRegistration.SurfaceLabel(Localizer));
    }

    [Fact]
    public void Registration_interpolates_the_failure_message()
    {
        Assert.Equal(
            "Backup failed: out of disk",
            BackupActionsCardRegistration.FailedLabel(Localizer, "out of disk"));
    }

    [Fact]
    public void ViewModel_exposes_accessible_surface_and_action_labels()
    {
        using var vm = NewViewModel();
        Assert.Equal("Backups", vm.SurfaceLabel);
        Assert.Equal("Manage backups & restore", vm.ManageLabel);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public void Navigator_null_object_is_a_safe_no_op()
    {
        // The default navigator never throws (the shell adapter is optional).
        NullBackupActionsNavigator.Instance.NavigateToBackups();
        Assert.Same(NullBackupActionsNavigator.Instance, NullBackupActionsNavigator.Instance);
    }

    // ---- Diagnostics (PII-safe) ---------------------------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new BackupActionsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BackupActionsCard", Assert.Single(sink));
    }

    [Fact]
    public async Task Diagnostics_records_run_resolution_without_leaking_backup_details()
    {
        var sink = new List<string>();
        var diagnostics = new BackupActionsDiagnostics(sink.Add);
        var source = new FakeBackupActionsSource(Loaded(WithRuns()));
        using var vm = new BackupActionsCardViewModel(source, Localizer, diagnostics, () => Now);

        await vm.RunQuickBackupAsync();

        Assert.Equal(1, diagnostics.RunsRequested);
        Assert.Equal(1, diagnostics.RunsSucceeded);
        Assert.Equal(0, diagnostics.RunsFailed);
        Assert.DoesNotContain(sink, line => line.Contains("2048", StringComparison.Ordinal));
    }

    // ---- helpers ------------------------------------------------------------------------------------

    private static BackupActionsCardViewModel NewViewModel(
        params RepositoryResult<BackupActionsSnapshot>[] status) =>
        new(new FakeBackupActionsSource(status), Localizer, clock: () => Now);

    private static BackupActionsSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new BackupActionsSource(client, engine, options);
    }

    private static BackupActionsSnapshot WithRuns() => new(3, "2026-06-06T08:00:00Z", 2048, 1);

    private static RepositoryResult<BackupActionsSnapshot> Loaded(BackupActionsSnapshot s) =>
        RepositoryResult<BackupActionsSnapshot>.Loaded(s, Now);

    private static RepositoryResult<BackupActionsSnapshot> Cached(BackupActionsSnapshot s, bool stale) =>
        RepositoryResult<BackupActionsSnapshot>.Cached(s, Now, stale);

    private static RepositoryResult<BackupActionsSnapshot> Offline(BackupActionsSnapshot s) =>
        RepositoryResult<BackupActionsSnapshot>.OfflineCached(
            s, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

    private static RepositoryResult<BackupActionsSnapshot> Failure(RepositoryErrorKind kind) =>
        RepositoryResult<BackupActionsSnapshot>.Failure(new RepositoryError(kind, "boom"));

    private static async Task<IReadOnlyList<RepositoryResult<BackupActionsSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<BackupActionsSnapshot>> stream)
    {
        var list = new List<RepositoryResult<BackupActionsSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    /// <summary>A scripted <see cref="IBackupActionsSource"/> — yields a fixed status sequence and a
    /// controllable quick-backup outcome, recording how many times each operation was invoked.</summary>
    private sealed class FakeBackupActionsSource : IBackupActionsSource
    {
        private readonly RepositoryResult<BackupActionsSnapshot>[] _status;

        public FakeBackupActionsSource(params RepositoryResult<BackupActionsSnapshot>[] status) =>
            _status = status;

        /// <summary>Optional override for the quick-backup outcome (defaults to success).</summary>
        public Func<Task<QuickBackupOutcome>>? QuickHandler { get; init; }

        /// <summary>Number of quick-backup triggers that reached the source.</summary>
        public int RunCount { get; private set; }

        /// <summary>Number of status streams opened (≥ 2 proves the post-success refresh fired).</summary>
        public int StatusStreamCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<BackupActionsSnapshot>> StreamStatusAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            StatusStreamCount++;
            foreach (var result in _status)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<QuickBackupOutcome> RunQuickBackupAsync(CancellationToken cancellationToken = default)
        {
            RunCount++;
            return QuickHandler?.Invoke() ?? Task.FromResult(QuickBackupOutcome.Ok());
        }
    }
}
