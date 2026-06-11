using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the JobProgressDrawer's UI-thread-free logic — the JSON parse adapter (real
/// wire + camelCase tolerance), the status normaliser, the byte formatter, the active/recent projection
/// (bucketing / cap / order / counts / chip label / download-uri gating / interpolated lines), the
/// pretty-type/status maps, the cache-then-network result mapper, the registration metadata, the
/// diagnostics, the repository source's request shape + download base, the chrome presentation
/// (open / minimized / dismissed) with persistence + auto-promotion + visibility, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the
/// web spec (web/src/components/feedback/JobProgressDrawer.tsx).
/// </summary>
public sealed class JobProgressDrawerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly Uri DownloadBase = new("https://teslasync.local", UriKind.Absolute);
    private const string FiveMinAgo = "2026-06-06T12:00:00Z";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ExportJob_parses_real_api_fields()
    {
        const string json = """
        [{"id":7,"type":"charging","format":"json","status":"ready","file_size":2048,"error_message":null,"created_at":"2026-06-06T12:00:00Z","completed_at":"2026-06-06T12:03:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement));

        Assert.Equal("7", job.Id);
        Assert.Equal("charging", job.Type);
        Assert.Equal("json", job.Format);
        Assert.Equal(ExportJobStatus.Ready, job.Status);
        Assert.Equal(2048, job.FileSize);
        Assert.Null(job.ErrorMessage);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), job.CreatedAtTime);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 3, 0, TimeSpan.Zero), job.CompletedAtTime);
        Assert.False(job.IsActive);
    }

    [Fact]
    public void ExportJob_accepts_camel_case_aliases()
    {
        const string json = """[{"id":"x9","type":"drives","format":"csv","status":"processing","fileSize":4096,"errorMessage":"oops","createdAt":"2026-06-06T12:00:00Z","completedAt":"2026-06-06T12:04:00Z"}]""";
        using var doc = JsonDocument.Parse(json);

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement));

        Assert.Equal("x9", job.Id);
        Assert.Equal(4096, job.FileSize);
        Assert.Equal("oops", job.ErrorMessage);
        Assert.Equal(ExportJobStatus.Processing, job.Status);
        Assert.True(job.IsActive);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 4, 0, TimeSpan.Zero), job.CompletedAtTime);
    }

    [Fact]
    public void ExportJob_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var job = Assert.Single(ExportJobRecord.ParseList(doc.RootElement));

        Assert.Equal("2", job.Id);
        Assert.Equal(string.Empty, job.Type);
        Assert.Equal(string.Empty, job.Format);
        Assert.Null(job.FileSize);
        Assert.Null(job.ErrorMessage);
        Assert.Equal(ExportJobStatus.Queued, job.Status);
        Assert.Null(job.CreatedAtTime);
        Assert.True(job.IsActive);
    }

    [Fact]
    public void ExportJob_parselist_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(ExportJobRecord.ParseList(doc.RootElement));
    }

    [Theory]
    [InlineData("queued", ExportJobStatus.Queued)]
    [InlineData("processing", ExportJobStatus.Processing)]
    [InlineData("ready", ExportJobStatus.Ready)]
    [InlineData("failed", ExportJobStatus.Failed)]
    [InlineData("expired", ExportJobStatus.Expired)]
    [InlineData("PROCESSING", ExportJobStatus.Processing)]
    [InlineData("unknown", ExportJobStatus.Queued)]
    [InlineData("", ExportJobStatus.Queued)]
    public void NormaliseStatus_maps_web_statuses(string raw, ExportJobStatus expected) =>
        Assert.Equal(expected, ExportJobRecord.NormaliseStatus(raw));

    // ---- Byte formatting (web formatBytes zeroAsEmpty + gbDecimals=2) ---------------

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(0L, "\u2014")]
    [InlineData(-5L, "\u2014")]
    [InlineData(512L, "512 B")]
    [InlineData(1536L, "1.5 KB")]
    [InlineData(2048L, "2.0 KB")]
    [InlineData(5242880L, "5.0 MB")]
    [InlineData(3221225472L, "3.00 GB")]
    [InlineData(1610612736L, "1.50 GB")]
    public void FormatBytes_matches_web(long? bytes, string expected) =>
        Assert.Equal(expected, JobProgressDrawerProjection.FormatBytes(bytes));

    // ---- Pretty type / status (web prettyType / prettyStatus) ----------------------

    [Theory]
    [InlineData("account", "Account export")]
    [InlineData("drives", "Drives")]
    [InlineData("charging", "Charging")]
    [InlineData("analytics", "Analytics")]
    [InlineData("backup", "Backup")]
    [InlineData("import_drives", "Import drives")]
    [InlineData("import_charging", "Import charging")]
    [InlineData("weird", "weird")]
    public void PrettyType_matches_web(string type, string expected) =>
        Assert.Equal(expected, JobProgressDrawerProjection.PrettyType(type, Localizer));

    [Theory]
    [InlineData(ExportJobStatus.Queued, "Queued")]
    [InlineData(ExportJobStatus.Processing, "Processing")]
    [InlineData(ExportJobStatus.Ready, "Ready")]
    [InlineData(ExportJobStatus.Failed, "Failed")]
    [InlineData(ExportJobStatus.Expired, "Expired")]
    public void PrettyStatus_matches_web(ExportJobStatus status, string expected) =>
        Assert.Equal(expected, JobProgressDrawerProjection.PrettyStatus(status, Localizer));

    [Fact]
    public void Fill_substitutes_interpolation_tokens()
    {
        string filled = JobProgressDrawerProjection.Fill("{{a}} and {{b}}", ("a", "X"), ("b", "Y"));
        Assert.Equal("X and Y", filled);
    }

    // ---- Projection: buckets / cap / order / counts / chip -------------------------

    [Fact]
    public void Project_buckets_active_and_recent()
    {
        var jobs = new[]
        {
            Job("1", ExportJobStatus.Processing),
            Job("2", ExportJobStatus.Queued),
            Job("3", ExportJobStatus.Ready),
            Job("4", ExportJobStatus.Failed),
            Job("5", ExportJobStatus.Expired),
        };

        var display = JobProgressDrawerProjection.Project(jobs, 5, Localizer, Now, DownloadBase);

        Assert.Equal(new[] { "1", "2" }, display.ActiveSection.Rows.Select(r => r.Id).ToArray());
        Assert.Equal(new[] { "3", "4", "5" }, display.RecentSection.Rows.Select(r => r.Id).ToArray());
        Assert.Equal(2, display.ActiveCount);
        Assert.True(display.HasActive);
        Assert.True(display.HasAnyJobs);
    }

    [Fact]
    public void Project_preserves_input_order_and_caps_recent()
    {
        var jobs = Enumerable.Range(0, 9)
            .Select(i => Job($"r{i}", ExportJobStatus.Ready))
            .ToArray();

        var display = JobProgressDrawerProjection.Project(jobs, 5, Localizer, Now, DownloadBase);

        Assert.Empty(display.ActiveSection.Rows);
        Assert.Equal(new[] { "r0", "r1", "r2", "r3", "r4" }, display.RecentSection.Rows.Select(r => r.Id).ToArray());
    }

    [Fact]
    public void Project_minimized_and_pill_text()
    {
        var running = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Processing), Job("2", ExportJobStatus.Queued) }, 5, Localizer, Now, null);
        Assert.True(running.MinimizedShowSpinner);
        Assert.Equal("2 export running", running.MinimizedText);
        Assert.Equal("2 active", running.ActivePillText);

        var idle = JobProgressDrawerProjection.Project(
            new[] { Job("3", ExportJobStatus.Ready) }, 5, Localizer, Now, null);
        Assert.False(idle.MinimizedShowSpinner);
        Assert.Equal("Exports", idle.MinimizedText);
        Assert.False(idle.HasActive);
    }

    [Fact]
    public void Project_section_headings_and_empty_labels_resolve_through_i18n()
    {
        var display = JobProgressDrawerProjection.Project(Array.Empty<ExportJobRecord>(), 5, Localizer, Now, null);

        Assert.Equal("In progress", display.ActiveSection.Heading);
        Assert.Equal("No active exports", display.ActiveSection.EmptyLabel);
        Assert.True(display.ActiveSection.IsEmpty);
        Assert.Equal("Recent", display.RecentSection.Heading);
        Assert.Equal("No recent exports", display.RecentSection.EmptyLabel);
        Assert.True(display.RecentSection.IsEmpty);
        Assert.False(display.HasAnyJobs);
    }

    [Fact]
    public void Project_active_row_status_line_interpolated()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Processing, createdAt: FiveMinAgo) }, 5, Localizer, Now, null);

        var row = Assert.Single(display.ActiveSection.Rows);
        Assert.Equal("Processing \u00b7 started 5m ago", row.DetailLine);
        Assert.True(row.IsActive);
        Assert.True(row.StatusGlyphSpins);
        Assert.Equal(StatusKind.Info, row.StatusBadge);
    }

    [Fact]
    public void Project_recent_row_completed_line_uses_size_and_completed_at()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Ready, fileSize: 2048, createdAt: "2026-06-06T09:00:00Z", completedAt: FiveMinAgo) },
            5, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.RecentSection.Rows);
        Assert.Equal("2.0 KB \u00b7 5m ago", row.DetailLine);
    }

    [Fact]
    public void Project_recent_row_completed_line_falls_back_to_created_at()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Failed, fileSize: null, createdAt: FiveMinAgo, completedAt: null) },
            5, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.RecentSection.Rows);
        Assert.Equal("\u2014 \u00b7 5m ago", row.DetailLine);
        Assert.True(row.ShowFailedGlyph);
    }

    [Fact]
    public void Project_download_uri_only_for_ready_with_base()
    {
        var ready = JobProgressDrawerProjection.Project(
            new[] { Job("r1", ExportJobStatus.Ready) }, 5, Localizer, Now, DownloadBase);
        var readyRow = Assert.Single(ready.RecentSection.Rows);
        Assert.True(readyRow.ShowDownload);
        Assert.Equal(new Uri(DownloadBase, "/api/v1/export/jobs/r1/download"), readyRow.DownloadUri);

        var noBase = JobProgressDrawerProjection.Project(
            new[] { Job("r1", ExportJobStatus.Ready) }, 5, Localizer, Now, null);
        Assert.Null(Assert.Single(noBase.RecentSection.Rows).DownloadUri);

        var failed = JobProgressDrawerProjection.Project(
            new[] { Job("f1", ExportJobStatus.Failed) }, 5, Localizer, Now, DownloadBase);
        var failedRow = Assert.Single(failed.RecentSection.Rows);
        Assert.False(failedRow.ShowDownload);
        Assert.Null(failedRow.DownloadUri);
    }

    [Fact]
    public void Project_download_uri_escapes_job_id()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("a b/c", ExportJobStatus.Ready) }, 5, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.RecentSection.Rows);
        Assert.Equal(new Uri(DownloadBase, "/api/v1/export/jobs/a%20b%2Fc/download"), row.DownloadUri);
    }

    [Fact]
    public void Project_rows_have_non_empty_accessibility_names()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Ready, type: "drives", format: "csv", fileSize: 2048, createdAt: FiveMinAgo, completedAt: FiveMinAgo) },
            5, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.RecentSection.Rows);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Drives", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("CSV", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_row_automation_name_includes_error_message()
    {
        var display = JobProgressDrawerProjection.Project(
            new[] { Job("1", ExportJobStatus.Failed, error: "disk full", createdAt: FiveMinAgo) },
            5, Localizer, Now, DownloadBase);

        var row = Assert.Single(display.RecentSection.Rows);
        Assert.True(row.HasError);
        Assert.Contains("disk full", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"ready","created_at":"2026-06-06T12:00:00Z"}]""");

        var cached = JobProgressDrawerResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = JobProgressDrawerResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_empty_and_maps_failure()
    {
        Assert.Equal(LoadStatus.Empty, JobProgressDrawerResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, JobProgressDrawerResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
        Assert.Equal(LoadStatus.Loading, JobProgressDrawerResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- Registration / diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_web_wiring()
    {
        Assert.Equal("JobProgressDrawer", JobProgressDrawerRegistration.Slug);
        Assert.Equal("get_api_v1_export_jobs", JobProgressDrawerRegistration.JobsOperationId);
        Assert.Equal(5, JobProgressDrawerRegistration.DefaultMaxRecent);
        Assert.Equal("teslasync.exportDrawer.state", JobProgressDrawerRegistration.StorageKey);
        Assert.Equal("Export jobs", JobProgressDrawerRegistration.Title(Localizer));
        Assert.Equal("Export job progress", JobProgressDrawerRegistration.Label(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new JobProgressDrawerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=JobProgressDrawer", Assert.Single(lines));
    }

    // ---- Source: request shape + download base -------------------------------------

    [Fact]
    public async Task Source_requests_export_jobs_and_parses()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"status":"processing","created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new JobProgressDrawerSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamJobsAsync());

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(ExportJobStatus.Processing, Assert.Single(results[^1].Value!).Status);
        Assert.Equal("get_api_v1_export_jobs", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public void Source_exposes_download_base_from_options()
    {
        var options = new ApiClientOptions { BaseAddress = DownloadBase };
        var source = new JobProgressDrawerSource(new FakeApiClient(), NewEngine(), options);

        Assert.Equal(DownloadBase, source.DownloadBaseUri);
    }

    // ---- View-model data-state matrix ----------------------------------------------

    [Fact]
    public async Task ViewModel_stays_loading_until_resolved()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_projects_jobs()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, Loaded(Job("1", ExportJobStatus.Processing), Job("2", ExportJobStatus.Ready)));
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Single(vm.Display.ActiveSection.Rows);
        Assert.Single(vm.Display.RecentSection.Rows);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_jobs()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Empty, vm.State);
        Assert.False(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_error_when_load_fails_with_no_items()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open,
            RepositoryResult<IReadOnlyList<ExportJobRecord>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_items()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open,
            RepositoryResult<IReadOnlyList<ExportJobRecord>>.Cached(new[] { Job("1", ExportJobStatus.Ready) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_items_and_error_chip()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open,
            RepositoryResult<IReadOnlyList<ExportJobRecord>>.OfflineCached(
                new[] { Job("1", ExportJobStatus.Ready) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(JobProgressState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_and_keeps_items()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, Loaded(Job("1", ExportJobStatus.Ready)));
        await vm.LoadAsync();
        Assert.True(vm.HasItems);

        await vm.RetryAsync();

        Assert.Equal(JobProgressState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.Attempts >= 2);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, Loaded(Job("1", ExportJobStatus.Ready)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(JobProgressDrawerViewModel.State), changed);
        Assert.Contains(nameof(JobProgressDrawerViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_labels_resolve_through_i18n()
    {
        using var vm = NewViewModel(JobDrawerPresentation.Open, Loaded(Job("1", ExportJobStatus.Processing)));
        await vm.LoadAsync();

        Assert.Equal("Export jobs", vm.Title);
        Assert.Equal("Export job progress", vm.RegionLabel);
        Assert.Equal("Loading export jobs\u2026", vm.LoadingText);
        Assert.Equal("Minimize", vm.MinimizeLabel);
        Assert.Equal("Dismiss", vm.DismissLabel);
        Assert.Equal("Download", vm.DownloadLabel);
        Assert.Equal("Show export jobs (1 active)", vm.ExpandLabel);
    }

    // ---- Presentation: persistence / auto-promote / visibility ---------------------

    [Fact]
    public void ViewModel_reads_initial_presentation_from_store()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Open);
        using var vm = new JobProgressDrawerViewModel(new FakeSource(), Localizer, store, clock: () => Now);

        Assert.Equal(JobDrawerPresentation.Open, vm.Presentation);
    }

    [Fact]
    public void ViewModel_expand_minimize_dismiss_persist()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Minimized);
        using var vm = new JobProgressDrawerViewModel(new FakeSource(), Localizer, store, clock: () => Now);

        vm.Expand();
        Assert.Equal(JobDrawerPresentation.Open, vm.Presentation);
        Assert.Equal(JobDrawerPresentation.Open, store.Load());

        vm.Dismiss();
        Assert.Equal(JobDrawerPresentation.Dismissed, vm.Presentation);
        Assert.Equal(JobDrawerPresentation.Dismissed, store.Load());

        vm.Minimize();
        Assert.Equal(JobDrawerPresentation.Minimized, vm.Presentation);
        Assert.True(store.SaveCount >= 3);
    }

    [Fact]
    public async Task ViewModel_auto_promotes_dismissed_to_minimized_when_active_appears()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Dismissed);
        using var vm = NewViewModel(store, Loaded(Job("1", ExportJobStatus.Processing)));

        await vm.LoadAsync();

        Assert.Equal(JobDrawerPresentation.Minimized, vm.Presentation);
        Assert.Equal(JobDrawerPresentation.Minimized, store.Load());
        Assert.True(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_hidden_when_dismissed_and_no_active()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Dismissed);
        using var vm = NewViewModel(store, Loaded(Job("1", ExportJobStatus.Ready)));

        await vm.LoadAsync();

        Assert.Equal(JobDrawerPresentation.Dismissed, vm.Presentation);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_minimized_hidden_when_no_jobs_after_resolve()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Minimized);
        using var vm = NewViewModel(store, RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now));

        await vm.LoadAsync();

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_open_visible_even_when_empty()
    {
        var store = new InMemoryJobDrawerStateStore(JobDrawerPresentation.Open);
        using var vm = NewViewModel(store, RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(Now));

        await vm.LoadAsync();

        Assert.True(vm.IsVisible);
        Assert.Equal(JobProgressState.Empty, vm.State);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ExportJobRecord Job(
        string id,
        ExportJobStatus status,
        string type = "drives",
        string format = "csv",
        long? fileSize = null,
        string? error = null,
        string? createdAt = FiveMinAgo,
        string? completedAt = null) =>
        new(id, type, format, status, fileSize, error, createdAt, completedAt);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<IReadOnlyList<ExportJobRecord>> Loaded(params ExportJobRecord[] jobs) =>
        RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loaded(jobs, Now);

    private static JobProgressDrawerViewModel NewViewModel(
        JobDrawerPresentation presentation,
        params RepositoryResult<IReadOnlyList<ExportJobRecord>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, new InMemoryJobDrawerStateStore(presentation), clock: () => Now);

    private static JobProgressDrawerViewModel NewViewModel(
        IJobDrawerStateStore store,
        params RepositoryResult<IReadOnlyList<ExportJobRecord>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, store, clock: () => Now);

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

    private sealed class FakeSource : IJobProgressDrawerSource
    {
        private readonly RepositoryResult<IReadOnlyList<ExportJobRecord>>[] _emissions;

        public FakeSource(params RepositoryResult<IReadOnlyList<ExportJobRecord>>[] emissions) =>
            _emissions = emissions;

        public Uri? DownloadBaseUri => DownloadBase;

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobRecord>>> StreamJobsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }
    }
}
