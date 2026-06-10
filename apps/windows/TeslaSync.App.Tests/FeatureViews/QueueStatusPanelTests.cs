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
/// Headless verification of the queue-status surface's UI-thread-free logic — the JSON parse adapters
/// (QueueWorkerStat / snapshot), the cache-then-network result mapper, the projection (heartbeat severity →
/// token status, the host/version caption, the queue-depth bar value/max, the "{pending} pending ·
/// {inProgress} in progress" sublabel, the succeeded / failed counts with the danger flag, the heartbeat
/// detail-or-relative label, the future-only backlog "Oldest pending …" label, the "Show recent … jobs"
/// activation label, the Narrator names and the relative "Updated {when}" caption), the
/// <c>formatDurationMsLong</c> + <c>formatRelative</c> ports, the repository source's request shape, the
/// state-holder view-model's state matrix (loading / loaded / empty / error / stale / offline), the refresh
/// flow, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/QueueStatusPanel.tsx).
/// </summary>
public sealed class QueueStatusPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- QueueWorkerStat parse adapter ---------------------------------------------

    [Fact]
    public void Worker_parses_real_api_fields()
    {
        const string json = """
        [{"worker":"notification","display_name":"Notifications","pending":3,"in_progress":1,
          "succeeded_24h":120,"failed_24h":2,"oldest_pending_age_seconds":45,"heartbeat_severity":"ok",
          "heartbeat_detail":"Last beat 5s ago","last_heartbeat_at":"2026-06-06T11:59:30Z",
          "host":"worker-1","version":"1.2.3"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var stat = Assert.Single(QueueWorkerStat.ParseList(doc.RootElement));

        Assert.Equal("notification", stat.Worker);
        Assert.Equal("Notifications", stat.DisplayName);
        Assert.Equal(3, stat.Pending);
        Assert.Equal(1, stat.InProgress);
        Assert.Equal(120, stat.Succeeded24h);
        Assert.Equal(2, stat.Failed24h);
        Assert.Equal(45, stat.OldestPendingAgeSeconds);
        Assert.Equal(QueueHeartbeatSeverity.Ok, stat.HeartbeatSeverity);
        Assert.Equal("Last beat 5s ago", stat.HeartbeatDetail);
        Assert.Equal("worker-1", stat.Host);
        Assert.Equal("1.2.3", stat.Version);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 59, 30, TimeSpan.Zero), stat.LastHeartbeatInstant);
    }

    [Fact]
    public void Worker_is_tolerant_of_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"worker":"export"}]""");
        var stat = Assert.Single(QueueWorkerStat.ParseList(partial.RootElement));
        Assert.Equal("export", stat.Worker);
        Assert.Equal(string.Empty, stat.DisplayName);
        Assert.Equal(0, stat.Pending);
        Assert.Equal(0, stat.InProgress);
        Assert.Equal(0, stat.Succeeded24h);
        Assert.Equal(0, stat.Failed24h);
        Assert.Equal(0, stat.OldestPendingAgeSeconds);
        Assert.Null(stat.HeartbeatDetail);
        Assert.Null(stat.LastHeartbeatAt);
        Assert.Null(stat.Host);
        Assert.Null(stat.Version);

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(QueueWorkerStat.ParseList(notArray.RootElement));
    }

    [Fact]
    public void Worker_severity_maps_all_bands_and_unknown_to_down()
    {
        using var doc = JsonDocument.Parse(
            """[{"worker":"a","heartbeat_severity":"ok"},{"worker":"b","heartbeat_severity":"warn"},{"worker":"c","heartbeat_severity":"critical"},{"worker":"d","heartbeat_severity":"down"},{"worker":"e","heartbeat_severity":"???"},{"worker":"f"}]""");
        var list = QueueWorkerStat.ParseList(doc.RootElement);

        Assert.Equal(QueueHeartbeatSeverity.Ok, list[0].HeartbeatSeverity);
        Assert.Equal(QueueHeartbeatSeverity.Warn, list[1].HeartbeatSeverity);
        Assert.Equal(QueueHeartbeatSeverity.Critical, list[2].HeartbeatSeverity);
        Assert.Equal(QueueHeartbeatSeverity.Down, list[3].HeartbeatSeverity);
        Assert.Equal(QueueHeartbeatSeverity.Down, list[4].HeartbeatSeverity);
        Assert.Equal(QueueHeartbeatSeverity.Down, list[5].HeartbeatSeverity);
    }

    [Fact]
    public void Snapshot_parses_envelope_and_tolerates_non_object()
    {
        using var doc = JsonDocument.Parse(
            """{"generated_at":"2026-06-06T11:55:00Z","workers":[{"worker":"a","heartbeat_severity":"ok"}]}""");
        var snap = QueueStatusSnapshot.FromJson(doc.RootElement);
        Assert.Equal("2026-06-06T11:55:00Z", snap.GeneratedAt);
        Assert.Single(snap.Workers);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), snap.GeneratedAtInstant);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(QueueStatusSnapshot.FromJson(notObject.RootElement).Workers);
    }

    // ---- formatDurationMsLong port -------------------------------------------------

    [Theory]
    [InlineData(500, "500ms")]
    [InlineData(5000, "5.0s")]
    [InlineData(59000, "59.0s")]
    [InlineData(60000, "1m 0s")]
    [InlineData(90000, "1m 30s")]
    [InlineData(125000, "2m 5s")]
    [InlineData(3600000, "60m 0s")]
    public void Duration_formats_like_web(double ms, string expected) =>
        Assert.Equal(expected, QueueDuration.FormatMsLong(ms));

    [Fact]
    public void Duration_non_positive_or_non_finite_is_em_dash()
    {
        Assert.Equal("\u2014", QueueDuration.FormatMsLong(0));
        Assert.Equal("\u2014", QueueDuration.FormatMsLong(-5));
        Assert.Equal("\u2014", QueueDuration.FormatMsLong(double.NaN));
        Assert.Equal("\u2014", QueueDuration.FormatMsLong(double.PositiveInfinity));
    }

    // ---- formatRelative port -------------------------------------------------------

    [Theory]
    [InlineData(30, "just now")]
    [InlineData(300, "5m ago")]
    [InlineData(5400, "1h ago")]
    [InlineData(93600, "1d ago")]
    [InlineData(518400, "6d ago")]
    public void Relative_formats_tiers_like_web(double secondsAgo, string expected) =>
        Assert.Equal(expected, QueueRelativeTime.Format(Now.AddSeconds(-secondsAgo), Now));

    [Fact]
    public void Relative_future_is_just_now()
    {
        Assert.Equal("just now", QueueRelativeTime.Format(Now.AddSeconds(30), Now));
    }

    [Fact]
    public void Relative_beyond_a_week_falls_back_to_absolute_date()
    {
        string label = QueueRelativeTime.Format(Now.AddDays(-8), Now);
        Assert.DoesNotContain("ago", label);
        Assert.NotEqual("just now", label);
        Assert.Contains("2026", label);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_maps_severity_to_token_status_and_brush()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", QueueHeartbeatSeverity.Ok),
                Worker("b", QueueHeartbeatSeverity.Warn),
                Worker("c", QueueHeartbeatSeverity.Critical),
                Worker("d", QueueHeartbeatSeverity.Down),
            },
            Localizer,
            Now);

        Assert.Equal(StatusKind.Success, display.Rows[0].SeverityStatus);
        Assert.Equal("TsColorSuccessBrush", display.Rows[0].AccentBrushKey);
        Assert.Equal(StatusKind.Warning, display.Rows[1].SeverityStatus);
        Assert.Equal("TsColorWarningBrush", display.Rows[1].AccentBrushKey);
        Assert.Equal(StatusKind.Danger, display.Rows[2].SeverityStatus);
        Assert.Equal("TsColorDangerBrush", display.Rows[2].AccentBrushKey);
        Assert.Equal(StatusKind.Neutral, display.Rows[3].SeverityStatus);
        Assert.Equal("TsColorTextSecondaryBrush", display.Rows[3].AccentBrushKey);
    }

    [Fact]
    public void Project_severity_label_resolves_through_the_facade()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", QueueHeartbeatSeverity.Ok),
                Worker("b", QueueHeartbeatSeverity.Warn),
                Worker("c", QueueHeartbeatSeverity.Critical),
                Worker("d", QueueHeartbeatSeverity.Down),
            },
            Localizer,
            Now);

        Assert.Equal("Healthy", display.Rows[0].SeverityLabel);
        Assert.Equal("Lagging", display.Rows[1].SeverityLabel);
        Assert.Equal("Stale", display.Rows[2].SeverityLabel);
        Assert.Equal("Down", display.Rows[3].SeverityLabel);
    }

    [Fact]
    public void Project_host_label_handles_host_version_and_missing()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", host: "worker-1", version: "1.2.3"),
                Worker("b", host: "worker-2"),
                Worker("c"),
            },
            Localizer,
            Now);

        Assert.Equal("worker-1 \u00b7 1.2.3", display.Rows[0].HostLabel);
        Assert.Equal("worker-2 \u00b7 unknown", display.Rows[1].HostLabel);
        Assert.Equal("No host reported", display.Rows[2].HostLabel);
    }

    [Fact]
    public void Project_queue_depth_is_pending_plus_in_progress_with_max_fallback()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", pending: 3, inProgress: 1),
                Worker("b", pending: 0, inProgress: 0),
            },
            Localizer,
            Now);

        Assert.Equal(4, display.Rows[0].QueueDepthValue);
        Assert.Equal(4, display.Rows[0].QueueDepthMax);
        Assert.Equal(0, display.Rows[1].QueueDepthValue);
        Assert.Equal(1, display.Rows[1].QueueDepthMax);
    }

    [Fact]
    public void Project_queue_depth_detail_formats_counts_with_grouping()
    {
        var display = QueueStatusProjection.Project(
            new[] { Worker("a", pending: 3, inProgress: 1), Worker("b", pending: 1500, inProgress: 200) },
            Localizer,
            Now);

        Assert.Equal("3 pending \u00b7 1 in progress", display.Rows[0].QueueDepthDetail);
        Assert.Equal("1,500 pending \u00b7 200 in progress", display.Rows[1].QueueDepthDetail);
        Assert.Equal("Queue depth", display.Rows[0].QueueDepthLabel);
    }

    [Fact]
    public void Project_counters_format_and_flag_failures()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", succeeded: 1200, failed: 0),
                Worker("b", succeeded: 5, failed: 3),
            },
            Localizer,
            Now);

        Assert.Equal("1,200", display.Rows[0].SucceededValue);
        Assert.Equal("0", display.Rows[0].FailedValue);
        Assert.False(display.Rows[0].FailedIsDanger);
        Assert.Equal("3", display.Rows[1].FailedValue);
        Assert.True(display.Rows[1].FailedIsDanger);
        Assert.Equal("Succeeded 24h", display.Rows[0].SucceededLabel);
        Assert.Equal("Failed 24h", display.Rows[0].FailedLabel);
    }

    [Fact]
    public void Project_heartbeat_prefers_detail_then_relative_then_never()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", detail: "Last beat 7m ago"),
                Worker("b", lastHeartbeat: Iso(Now.AddMinutes(-5))),
                Worker("c"),
            },
            Localizer,
            Now);

        Assert.Equal("Last beat 7m ago", display.Rows[0].HeartbeatLabel);
        Assert.Equal("Last beat 5m ago", display.Rows[1].HeartbeatLabel);
        Assert.Equal("No heartbeat recorded", display.Rows[2].HeartbeatLabel);
    }

    [Fact]
    public void Project_oldest_label_only_renders_for_a_backlog()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("a", oldest: 90),
                Worker("b", oldest: 0),
            },
            Localizer,
            Now);

        Assert.Equal("Oldest pending: 1m 30s", display.Rows[0].OldestLabel);
        Assert.Null(display.Rows[1].OldestLabel);
    }

    [Fact]
    public void Project_card_carries_open_label_and_descriptive_automation_name()
    {
        var display = QueueStatusProjection.Project(
            new[]
            {
                Worker("notification", QueueHeartbeatSeverity.Critical, pending: 3, inProgress: 1, failed: 2, displayName: "Notifications"),
            },
            Localizer,
            Now);

        var row = display.Rows[0];
        Assert.Equal("Show recent Notifications jobs", row.OpenLabel);

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Notifications", row.AutomationName);
        Assert.Contains("Stale", row.AutomationName);
        Assert.Contains("3 pending \u00b7 1 in progress", row.AutomationName);
    }

    [Fact]
    public void UpdatedLabel_is_null_without_a_timestamp_and_relative_with_one()
    {
        Assert.Null(QueueStatusProjection.UpdatedLabel(null, Localizer, Now));
        Assert.Equal("Updated 5m ago", QueueStatusProjection.UpdatedLabel(Now.AddMinutes(-5), Localizer, Now));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, QueueStatusResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, QueueStatusResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(
            LoadStatus.Error,
            QueueStatusResultMapper.Map(
                RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_loaded_carries_snapshot_even_when_workers_empty()
    {
        using var doc = JsonDocument.Parse("""{"generated_at":"2026-06-06T11:55:00Z","workers":[]}""");
        var mapped = QueueStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Empty(mapped.Value!.Workers);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), mapped.Value!.GeneratedAtInstant);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_rows()
    {
        using var doc = JsonDocument.Parse("""{"workers":[{"worker":"a","heartbeat_severity":"ok"}]}""");

        var cached = QueueStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);

        var offline = QueueStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(
                doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Workers);
    }

    // ---- View-model: state matrix --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new QueueStatusViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(QueuePanelState.Loading, vm.State);
        Assert.False(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_one_card_per_worker()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            "2026-06-06T11:58:00Z",
            Worker("notification", QueueHeartbeatSeverity.Ok),
            Worker("export", QueueHeartbeatSeverity.Warn),
            Worker("automation", QueueHeartbeatSeverity.Down))));

        await vm.LoadAsync();

        Assert.Equal(QueuePanelState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.Rows.Count);
        Assert.Equal("Updated 2m ago", vm.UpdatedLabel);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_when_workers_empty_but_keeps_updated_caption()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:55:00Z")));

        await vm.LoadAsync();

        Assert.Equal(QueuePanelState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
        Assert.Equal("Updated 5m ago", vm.UpdatedLabel);
        Assert.StartsWith("No workers are currently registered", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<QueueStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(QueuePanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_cards()
    {
        using var vm = NewViewModel(RepositoryResult<QueueStatusSnapshot>.Cached(
            Snapshot("2026-06-06T11:50:00Z", Worker("a", QueueHeartbeatSeverity.Ok)), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(QueuePanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cards_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<QueueStatusSnapshot>.OfflineCached(
            Snapshot("2026-06-06T11:50:00Z", Worker("a", QueueHeartbeatSeverity.Ok)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(QueuePanelState.Offline, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_and_increments_attempts()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:58:00Z", Worker("a", QueueHeartbeatSeverity.Ok))));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(QueuePanelState.Loaded, vm.State);
        Assert.False(vm.IsRefreshing);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new QueueStatusViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Background workers", vm.Title);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.Equal("Refresh", vm.RetryLabel);
        Assert.Equal("Loading worker status\u2026", vm.LoadingLabel);
        Assert.StartsWith("No workers are currently registered", vm.EmptyMessage);
        Assert.StartsWith("Could not load worker status", vm.ErrorMessageDefault);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_status_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"generated_at":"2026-06-06T11:55:00Z","workers":[{"worker":"notification","display_name":"Notifications","heartbeat_severity":"ok"}]}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!.Workers);
        Assert.Equal("get_api_v1_system_queues", client.Requests[^1].OperationId);
        Assert.Equal(QueueStatusSource.StatusOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Query);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("queue-status-panel", QueueStatusRegistration.Id);
        Assert.Equal("QueueStatusPanel", QueueStatusRegistration.Slug);
        Assert.Equal("Background workers", QueueStatusRegistration.Title(Localizer));
        Assert.StartsWith("Live view of the notification", QueueStatusRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new QueueStatusDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QueueStatusPanel", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static QueueStatusViewModel NewViewModel(params RepositoryResult<QueueStatusSnapshot>[] results) =>
        new(new FakeSource(results), Localizer, () => Now);

    private static QueueStatusSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new QueueStatusSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<QueueStatusSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<QueueStatusSnapshot>> stream)
    {
        var list = new List<RepositoryResult<QueueStatusSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static RepositoryResult<QueueStatusSnapshot> Loaded(QueueStatusSnapshot snapshot) =>
        RepositoryResult<QueueStatusSnapshot>.Loaded(snapshot, Now);

    private static QueueStatusSnapshot Snapshot(string? generatedAt, params QueueWorkerStat[] workers) =>
        new(generatedAt, workers);

    private static QueueWorkerStat Worker(
        string worker,
        QueueHeartbeatSeverity severity = QueueHeartbeatSeverity.Ok,
        long pending = 0,
        long inProgress = 0,
        long succeeded = 0,
        long failed = 0,
        double oldest = 0,
        string? detail = null,
        string? lastHeartbeat = null,
        string? host = null,
        string? version = null,
        string? displayName = null) =>
        new(worker, displayName ?? worker, pending, inProgress, succeeded, failed, oldest, severity, detail, lastHeartbeat, host, version);

    private static string Iso(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

    private sealed class FakeSource : IQueueStatusSource
    {
        private readonly IReadOnlyList<RepositoryResult<QueueStatusSnapshot>> _results;

        public FakeSource(params RepositoryResult<QueueStatusSnapshot>[] results) => _results = results;

        public async IAsyncEnumerable<RepositoryResult<QueueStatusSnapshot>> StreamStatusAsync(
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
