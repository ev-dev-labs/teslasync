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

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ExportStatusWidget's UI-thread-free logic — the JSON parse adapter (real
/// wire + web-interface field tolerance, per-source status derivation), the status normaliser, the byte /
/// file-name formatters, the merged projection (admin-over-legacy dedupe / status-then-newest sort /
/// active-count / compact badge / capped rows / download-uri gating), the cache-then-network result
/// mapper, the registry metadata, the diagnostics, the repository source's request shapes + download base,
/// and the state-holder view-model's combined per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ExportStatusWidget.tsx).
/// </summary>
public sealed class ExportStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly Uri DownloadBase = new("https://teslasync.local", UriKind.Absolute);
    private const string FiveMinAgo = "2026-06-06T12:00:00Z";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ExportJob_parses_real_api_fields_admin_status()
    {
        const string json = """
        [{"id":1,"type":"drives","format":"csv","status":"ready","file_name":"drives.csv","file_size":2048,"created_at":"2026-06-06T12:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement, fromAdmin: true));

        Assert.Equal("1", job.Id);
        Assert.Equal("csv", job.Format);
        Assert.Equal("drives.csv", job.FilePath);
        Assert.Equal(2048, job.FileSize);
        Assert.Equal(ExportJobStatus.Ready, job.Status);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), job.CreatedAtTime);
    }

    [Fact]
    public void ExportJob_legacy_prefers_fsm_state_then_falls_back_to_status()
    {
        using var withFsm = JsonDocument.Parse("""[{"id":1,"fsm_state":"processing","status":"ready"}]""");
        Assert.Equal(ExportJobStatus.Processing, Assert.Single(ExportJobRecord.ParseList(withFsm.RootElement, fromAdmin: false)).Status);

        using var withoutFsm = JsonDocument.Parse("""[{"id":1,"status":"failed"}]""");
        Assert.Equal(ExportJobStatus.Failed, Assert.Single(ExportJobRecord.ParseList(withoutFsm.RootElement, fromAdmin: false)).Status);
    }

    [Fact]
    public void ExportJob_accepts_web_interface_names()
    {
        const string json = """[{"id":"x9","format":"json","filePath":"/exports/a/b.json","fileSize":4096,"createdAt":"2026-06-06T12:00:00Z","status":"processing"}]""";
        using var doc = JsonDocument.Parse(json);

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement, fromAdmin: true));

        Assert.Equal("x9", job.Id);
        Assert.Equal("/exports/a/b.json", job.FilePath);
        Assert.Equal(4096, job.FileSize);
        Assert.Equal(ExportJobStatus.Processing, job.Status);
    }

    [Fact]
    public void ExportJob_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement, fromAdmin: true));

        Assert.Equal("2", job.Id);
        Assert.Equal(string.Empty, job.Format);
        Assert.Null(job.FilePath);
        Assert.Equal(0, job.FileSize);
        Assert.Equal(ExportJobStatus.Queued, job.Status);
        Assert.Null(job.CreatedAtTime);
    }

    [Fact]
    public void ExportJob_parselist_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(ExportJobRecord.ParseList(doc.RootElement, fromAdmin: false));
    }

    [Theory]
    [InlineData("processing", ExportJobStatus.Processing)]
    [InlineData("running", ExportJobStatus.Processing)]
    [InlineData("ready", ExportJobStatus.Ready)]
    [InlineData("done", ExportJobStatus.Ready)]
    [InlineData("completed", ExportJobStatus.Ready)]
    [InlineData("failed", ExportJobStatus.Failed)]
    [InlineData("error", ExportJobStatus.Failed)]
    [InlineData("queued", ExportJobStatus.Queued)]
    [InlineData("expired", ExportJobStatus.Queued)]
    [InlineData("", ExportJobStatus.Queued)]
    public void NormaliseStatus_maps_web_buckets(string raw, ExportJobStatus expected) =>
        Assert.Equal(expected, ExportJobRecord.NormaliseStatus(raw));

    // ---- Byte / file-name formatting (web fmtBytes / truncateFilename) --------------

    [Theory]
    [InlineData(0, "\u2014")]
    [InlineData(-5, "\u2014")]
    [InlineData(512, "512 B")]
    [InlineData(2048, "2.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(5242880, "5.0 MB")]
    [InlineData(3221225472, "3.0 GB")]
    public void FormatBytes_matches_web(long bytes, string expected) =>
        Assert.Equal(expected, ExportStatusProjection.FormatBytes(bytes));

    [Fact]
    public void TruncateFileName_takes_basename_and_ellipsizes()
    {
        Assert.Equal("\u2014", ExportStatusProjection.TruncateFileName(null));
        Assert.Equal("\u2014", ExportStatusProjection.TruncateFileName(string.Empty));
        Assert.Equal("report.csv", ExportStatusProjection.TruncateFileName("/exports/2026/report.csv"));

        var truncated = ExportStatusProjection.TruncateFileName(new string('a', 40));
        Assert.Equal(28, truncated.Length);
        Assert.EndsWith("\u2026", truncated, StringComparison.Ordinal);
    }

    // ---- Projection: merge / sort / stats / rows / download ------------------------

    [Fact]
    public void Project_merges_admin_over_legacy_by_id()
    {
        var primary = new[] { Job("1", ExportJobStatus.Queued, createdAt: FiveMinAgo) };
        var admin = new[] { Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo) };

        var display = ExportStatusProjection.Project(primary, admin, Wide, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.Items);
        Assert.Equal(ExportJobStatus.Ready, row.Status); // admin wins
        Assert.Equal(StatusKind.Success, row.StatusBadge);
    }

    [Fact]
    public void Project_orders_by_status_then_newest()
    {
        var primary = new[]
        {
            Job("ready", ExportJobStatus.Ready, createdAt: "2026-06-06T11:00:00Z"),
            Job("proc", ExportJobStatus.Processing, createdAt: "2026-06-06T11:30:00Z"),
        };
        var admin = new[]
        {
            Job("queued", ExportJobStatus.Queued, createdAt: "2026-06-06T11:45:00Z"),
            Job("failed", ExportJobStatus.Failed, createdAt: "2026-06-06T11:58:00Z"),
        };

        var display = ExportStatusProjection.Project(primary, admin, Standard, Localizer, Now, null);

        Assert.Equal(new[] { "proc", "queued", "ready", "failed" }, display.Items.Select(i => i.Id).ToArray());
    }

    [Fact]
    public void Project_orders_same_status_newest_first()
    {
        var primary = new[]
        {
            Job("old", ExportJobStatus.Processing, createdAt: "2026-06-06T10:00:00Z"),
            Job("new", ExportJobStatus.Processing, createdAt: "2026-06-06T11:59:00Z"),
        };

        var display = ExportStatusProjection.Project(primary, Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, null);

        Assert.Equal(new[] { "new", "old" }, display.Items.Select(i => i.Id).ToArray());
    }

    [Fact]
    public void Project_active_count_and_running_flag()
    {
        var primary = new[]
        {
            Job("1", ExportJobStatus.Processing, createdAt: FiveMinAgo),
            Job("2", ExportJobStatus.Queued, createdAt: FiveMinAgo),
            Job("3", ExportJobStatus.Ready, createdAt: FiveMinAgo),
            Job("4", ExportJobStatus.Failed, createdAt: FiveMinAgo),
        };

        var display = ExportStatusProjection.Project(primary, Array.Empty<ExportJobRecord>(), Compact, Localizer, Now, null);

        Assert.Equal(2, display.ActiveCount); // processing + queued
        Assert.True(display.HasRunning);
        Assert.Equal("2", display.ActiveCountText);
        Assert.Equal("Running", display.CompactBadgeText);
        Assert.Equal(StatusKind.Success, display.CompactBadgeStatus);
    }

    [Fact]
    public void Project_idle_badge_when_no_processing()
    {
        var primary = new[] { Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo) };

        var display = ExportStatusProjection.Project(primary, Array.Empty<ExportJobRecord>(), Compact, Localizer, Now, null);

        Assert.False(display.HasRunning);
        Assert.Equal("Idle", display.CompactBadgeText);
        Assert.Equal(StatusKind.Neutral, display.CompactBadgeStatus);
    }

    [Fact]
    public void Project_caps_standard_rows_at_max_feed_items()
    {
        var jobs = Enumerable.Range(0, 25)
            .Select(i => Job($"j{i}", ExportJobStatus.Ready, createdAt: FiveMinAgo))
            .ToArray();

        var display = ExportStatusProjection.Project(jobs, Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, null);

        Assert.Equal(ExportStatusSize.MaxFeedItems, display.Items.Count);
    }

    [Fact]
    public void Project_download_uri_only_for_ready_with_path_when_wide()
    {
        var ready = new[] { Job("r1", ExportJobStatus.Ready, filePath: "report.csv", createdAt: FiveMinAgo) };

        var wide = ExportStatusProjection.Project(ready, Array.Empty<ExportJobRecord>(), Wide, Localizer, Now, DownloadBase);
        Assert.Equal(new Uri(DownloadBase, "/api/v1/export/download/r1"), Assert.Single(wide.Items).DownloadUri);
        Assert.True(wide.ShowDownload);

        var standard = ExportStatusProjection.Project(ready, Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, DownloadBase);
        Assert.Null(Assert.Single(standard.Items).DownloadUri); // not wide
        Assert.False(standard.ShowDownload);

        var processing = new[] { Job("p1", ExportJobStatus.Processing, filePath: "report.csv", createdAt: FiveMinAgo) };
        var notReady = ExportStatusProjection.Project(processing, Array.Empty<ExportJobRecord>(), Wide, Localizer, Now, DownloadBase);
        Assert.Null(Assert.Single(notReady.Items).DownloadUri); // not ready

        var noBase = ExportStatusProjection.Project(ready, Array.Empty<ExportJobRecord>(), Wide, Localizer, Now, null);
        Assert.Null(Assert.Single(noBase.Items).DownloadUri); // no base
    }

    [Fact]
    public void Project_processing_row_flagged()
    {
        var primary = new[] { Job("1", ExportJobStatus.Processing, createdAt: FiveMinAgo) };

        var display = ExportStatusProjection.Project(primary, Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, null);

        Assert.True(Assert.Single(display.Items).IsProcessing);
    }

    [Fact]
    public void Project_empty_inputs_yield_no_items()
    {
        var display = ExportStatusProjection.Project(
            Array.Empty<ExportJobRecord>(), Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, null);

        Assert.False(display.HasItems);
        Assert.Empty(display.Items);
        Assert.Equal(0, display.ActiveCount);
        Assert.False(display.HasRunning);
    }

    [Fact]
    public void Project_rows_have_non_empty_accessibility_names()
    {
        var primary = new[] { Job("1", ExportJobStatus.Ready, format: "csv", filePath: "report.csv", fileSize: 2048, createdAt: FiveMinAgo) };

        var row = Assert.Single(ExportStatusProjection.Project(primary, Array.Empty<ExportJobRecord>(), Standard, Localizer, Now, null).Items);

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("report.csv", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("CSV", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Done", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"ready","created_at":"2026-06-06T12:00:00Z"}]""");

        var cached = ExportStatusResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), fromAdmin: true);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = ExportStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            fromAdmin: true);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty_and_maps_failure()
    {
        using var empty = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, ExportStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), fromAdmin: false).Status);

        Assert.Equal(LoadStatus.Loaded, ExportStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now), fromAdmin: false).Status);

        Assert.Equal(LoadStatus.Error, ExportStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), fromAdmin: false).Status);
    }

    // ---- Size flags (web isCompact / isWide) ---------------------------------------

    [Theory]
    [InlineData(1, 2, true, false)]
    [InlineData(2, 4, false, false)]
    [InlineData(3, 4, false, true)]
    [InlineData(4, 40, false, true)]
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new ExportStatusSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("export-status", ExportStatusRegistration.Id);
        Assert.Equal("system", ExportStatusRegistration.Category);
        Assert.Equal("ExportStatusWidget", ExportStatusRegistration.Slug);
        Assert.Equal(15, ExportStatusRegistration.MaxFeedItems);
        Assert.Equal("get_api_v1_export_jobs", ExportStatusRegistration.JobsOperationId);
        Assert.Equal(new ExportStatusSize(2, 4), ExportStatusRegistration.DefaultSize);
        Assert.Equal(new ExportStatusSize(1, 2), ExportStatusRegistration.MinSize);
        Assert.Equal(new ExportStatusSize(4, 40), ExportStatusRegistration.MaxSize);
        Assert.Equal("Export Status", ExportStatusRegistration.Name(Localizer));
        Assert.Contains("export", ExportStatusRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ExportStatusRegistration.IsWithinBounds(new ExportStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ExportStatusSize(1, 2), ExportStatusRegistration.Clamp(new ExportStatusSize(0, 0)));
        Assert.Equal(new ExportStatusSize(4, 40), ExportStatusRegistration.Clamp(new ExportStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ExportStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ExportStatusWidget", Assert.Single(lines));
    }

    // ---- Source: request shapes + download base ------------------------------------

    [Fact]
    public async Task Source_primary_stream_requests_export_jobs_and_parses()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"ready","created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ExportStatusSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamPrimaryJobsAsync());

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);
        Assert.Equal("get_api_v1_export_jobs", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_admin_stream_requests_export_jobs_and_parses()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"processing"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ExportStatusSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAdminJobsAsync());

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(ExportJobStatus.Processing, Assert.Single(results[^1].Value!).Status);
        Assert.Equal("get_api_v1_export_jobs", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public void Source_exposes_download_base_from_options()
    {
        var options = new ApiClientOptions { BaseAddress = DownloadBase };
        var source = new ExportStatusSource(new FakeApiClient(), NewEngine(), options);

        Assert.Equal(DownloadBase, source.DownloadBaseUri);
    }

    // ---- View-model combined state matrix ------------------------------------------

    [Fact]
    public async Task ViewModel_stays_loading_until_both_sources_resolve()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loaded(new[] { Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo) }, Now) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loading() }); // admin never resolves
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_merges_both_sources()
    {
        using var vm = NewViewModel(
            Primary(Job("1", ExportJobStatus.Processing, createdAt: FiveMinAgo)),
            Admin(Job("2", ExportJobStatus.Ready, createdAt: FiveMinAgo)));
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_both_sources_empty()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No export jobs", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_a_source_fails_with_no_items()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_items()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Cached(new[] { Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo) }, Now, stale: true) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_items_and_error_chip()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.OfflineCached(new[] { Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(ExportStatusState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(
            ExportStatusSize.Default,
            Primary(Job("1", ExportJobStatus.Processing, createdAt: FiveMinAgo)),
            Admin());
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ExportStatusSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ExportStatusState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) },
            new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal("Export Status", vm.Title);
        Assert.Equal("No export jobs", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(
            Primary(Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo)),
            Admin());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ExportStatusViewModel.State), changed);
        Assert.Contains(nameof(ExportStatusViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_and_keeps_items()
    {
        using var vm = NewViewModel(
            Primary(Job("1", ExportJobStatus.Ready, createdAt: FiveMinAgo)),
            Admin(Job("2", ExportJobStatus.Queued, createdAt: FiveMinAgo)));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Display.Items.Count);

        await vm.RetryAsync();

        Assert.Equal(ExportStatusState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.True(vm.Attempts >= 2);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static readonly ExportStatusSize Compact = new(1, 2);
    private static readonly ExportStatusSize Standard = new(2, 4);
    private static readonly ExportStatusSize Wide = new(3, 4);

    private static ExportJobRecord Job(
        string id,
        ExportJobStatus status,
        string format = "csv",
        string? filePath = null,
        long fileSize = 0,
        string? createdAt = FiveMinAgo) =>
        new(id, format, filePath, fileSize, createdAt, status);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<IReadOnlyList<ExportJobRecord>>[] Primary(params ExportJobRecord[] jobs) =>
        new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loaded(jobs, Now) };

    private static RepositoryResult<IReadOnlyList<ExportJobRecord>>[] Admin(params ExportJobRecord[] jobs) =>
        jobs.Length == 0
            ? new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now) }
            : new[] { RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loaded(jobs, Now) };

    private static ExportStatusViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] primary,
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] admin) =>
        NewViewModel(ExportStatusSize.Default, primary, admin);

    private static ExportStatusViewModel NewViewModel(
        ExportStatusSize size,
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] primary,
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] admin) =>
        new(new FakeExportStatusSource(primary, admin), Localizer, size, () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<ExportJobRecord>>>> Drain(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ExportJobRecord>>>();
        await foreach (var result in stream)
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeExportStatusSource(
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] primary,
        RepositoryResult<IReadOnlyList<ExportJobRecord>>[] admin) : IExportStatusSource
    {
        public Uri? DownloadBaseUri => DownloadBase;

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamPrimaryJobsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in primary)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamAdminJobsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in admin)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
