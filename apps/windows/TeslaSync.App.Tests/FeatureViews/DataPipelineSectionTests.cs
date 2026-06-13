using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the DataPipelineSection feature-view's UI-thread-free logic — the compression /
/// export-job JSON adapters (snake_case + camelCase + string-id tolerance), the helpers.tsx status-classifier
/// and formatBytes ports, the queue-counter and active-badge derivation, the projection (metric tiles, stat
/// tiles, gauge value, rows and Narrator names), the cache-then-network result mappers, the state-holder
/// view-model's per-state transitions (loading / loaded / empty / stale / offline / error), the registration
/// metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/DataPipelineSection.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class DataPipelineSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Compression adapter (web CompressionStats) -----------------------------------------------------

    [Fact]
    public void Compression_FromJson_reads_snake_case_fields()
    {
        const string json = """
        { "total": 1000, "compressed": 600, "savings_percent": 42.5, "total_positions": 5000,
          "compressed_positions": 3200, "estimated_saved_rows": 1800, "estimated_saved_bytes": 2048 }
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = CompressionStatsSnapshot.FromJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(1000, stats.Total);
        Assert.Equal(42.5, stats.SavingsPercent, 3);
        Assert.Equal(5000, stats.TotalPositions);
        Assert.Equal(3200, stats.CompressedPositions);
        Assert.Equal(2048, stats.EstimatedSavedBytes);
    }

    [Fact]
    public void Compression_FromJson_falls_back_to_camelCase()
    {
        const string json = """{ "savingsPercent": 18.0, "totalPositions": 40, "estimatedSavedBytes": 1024 }""";
        using var doc = JsonDocument.Parse(json);

        var stats = CompressionStatsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(18.0, stats.SavingsPercent, 3);
        Assert.Equal(40, stats.TotalPositions);
        Assert.Equal(1024, stats.EstimatedSavedBytes);
    }

    [Fact]
    public void Compression_non_object_is_empty()
    {
        using var doc = JsonDocument.Parse("null");

        var stats = CompressionStatsSnapshot.FromJson(doc.RootElement);

        Assert.False(stats.HasData);
        Assert.Same(CompressionStatsSnapshot.Empty, stats);
        Assert.Equal(0, stats.SavingsPercent, 3);
    }

    [Fact]
    public void Compression_tolerates_numeric_strings()
    {
        // The camelCaseKeys transform can leave large counts as strings.
        const string json = """{ "savings_percent": "33.25", "total_positions": "12345" }""";
        using var doc = JsonDocument.Parse(json);

        var stats = CompressionStatsSnapshot.FromJson(doc.RootElement);

        Assert.Equal(33.25, stats.SavingsPercent, 3);
        Assert.Equal(12345, stats.TotalPositions);
    }

    // ---- Export-job adapter (web ExportJobSummary) ------------------------------------------------------

    [Fact]
    public void ExportJobs_ParseList_projects_rendered_fields_tolerantly()
    {
        const string json = """
        [ { "id": "job-7", "type": "drives", "format": "csv", "status": "ready",
            "file_name": "drives.csv", "file_size": 4096, "record_count": 1200,
            "created_at": "2026-06-09T11:55:00Z", "completed_at": "2026-06-09T11:56:00Z" },
          { "id": "job-8", "status": "failed" } ]
        """;
        using var doc = JsonDocument.Parse(json);

        var jobs = ExportJobSnapshot.ParseList(doc.RootElement);

        Assert.Equal(2, jobs.Count);
        Assert.Equal("job-7", jobs[0].Id); // id is a string
        Assert.Equal("drives", jobs[0].Type);
        Assert.Equal("csv", jobs[0].Format);
        Assert.Equal("ready", jobs[0].Status);
        Assert.Equal("drives.csv", jobs[0].FileName);
        Assert.Equal(1200, jobs[0].RecordCount);
        Assert.NotNull(jobs[0].CreatedAtTime);
        Assert.Null(jobs[1].Type); // missing -> null (projection later renders em-dash)
        Assert.True(jobs[1].IsStatus("failed"));
    }

    [Fact]
    public void ExportJobs_ParseList_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(ExportJobSnapshot.ParseList(doc.RootElement));
    }

    [Fact]
    public void ExportJobs_IsStatus_is_case_insensitive()
    {
        var job = new ExportJobSnapshot("a", null, null, "READY", null, 0, 0, null, null, null);
        Assert.True(job.IsStatus("ready"));
        Assert.False(job.IsStatus("failed"));
    }

    // ---- Queue counters + active badge (web pendingJobs/processingJobs/...) ------------------------------

    [Fact]
    public void CountStatus_counts_each_queue_bucket()
    {
        var jobs = new[]
        {
            Job("1", "queued"), Job("2", "queued"), Job("3", "processing"),
            Job("4", "ready"), Job("5", "failed"), Job("6", "failed"),
        };

        Assert.Equal(2, DataPipelineSectionProjection.CountStatus(jobs, ExportJobSnapshot.StatusQueued));
        Assert.Equal(1, DataPipelineSectionProjection.CountStatus(jobs, ExportJobSnapshot.StatusProcessing));
        Assert.Equal(1, DataPipelineSectionProjection.CountStatus(jobs, ExportJobSnapshot.StatusReady));
        Assert.Equal(2, DataPipelineSectionProjection.CountStatus(jobs, ExportJobSnapshot.StatusFailed));
    }

    // ---- Projection (web render body) -------------------------------------------------------------------

    [Fact]
    public void Projection_builds_compression_tiles_gauge_and_saved_badge()
    {
        var reading = new DataPipelineReading(
            new CompressionStatsSnapshot(
                Total: 1000, Compressed: 600, SavingsPercent: 42.5,
                TotalPositions: 5000, CompressedPositions: 3200,
                EstimatedSavedRows: 1800, EstimatedSavedBytes: 2048),
            Array.Empty<ExportJobSnapshot>());

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        Assert.True(display.HasCompression);
        Assert.Equal(4, display.CompressionTiles.Count);
        Assert.Equal("Compression Ratio", display.CompressionTiles[0].Label);
        Assert.Equal("42.50%", display.CompressionTiles[0].Value); // fmtPercent default precision = 2
        Assert.Equal("Estimated Savings", display.CompressionTiles[1].Label);
        Assert.Equal("2.0 KB", display.CompressionTiles[1].Value); // web formatBytes(2048)
        Assert.Equal("5,000", display.CompressionTiles[2].Value); // fmtInt(total_positions)
        Assert.Equal("3,200", display.CompressionTiles[3].Value); // fmtInt(compressed_positions)

        Assert.Equal(42.5, display.SavingsPercent, 3);
        Assert.Equal("Savings", display.GaugeLabel);
        Assert.True(display.HasSavedBadge);
        Assert.Equal("42.50% saved", display.SavedBadgeText);
    }

    [Fact]
    public void Projection_builds_stat_tiles_active_badge_and_export_rows()
    {
        var reading = new DataPipelineReading(
            CompressionStatsSnapshot.Empty,
            new[]
            {
                Job("a", "queued", type: "drives", format: "csv", file: "a.csv", records: 10, created: "2026-06-09T10:00:00Z"),
                Job("b", "processing", type: "charging", format: "json", file: "b.json", records: 20, created: "2026-06-09T11:00:00Z"),
                Job("c", "ready", type: "drives", format: "csv", file: "c.csv", records: 30, created: "2026-06-09T09:00:00Z"),
                Job("d", "failed", type: "analytics", format: "csv", file: "d.csv", records: 0, created: "2026-06-09T08:00:00Z"),
            });

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        // Stat tiles: Pending / Processing / Completed / Failed
        Assert.Equal(4, display.StatTiles.Count);
        Assert.Equal("Pending", display.StatTiles[0].Label);
        Assert.Equal("1", display.StatTiles[0].Value);
        Assert.Equal("Processing", display.StatTiles[1].Label);
        Assert.Equal("1", display.StatTiles[1].Value);
        Assert.Equal("Completed", display.StatTiles[2].Label);
        Assert.Equal("1", display.StatTiles[2].Value);
        Assert.Equal("Failed", display.StatTiles[3].Label);
        Assert.Equal("1", display.StatTiles[3].Value);

        // Active badge = pending + processing = 2
        Assert.True(display.HasActiveBadge);
        Assert.Equal("2 active", display.ActiveBadgeText);

        // Export rows preserve API order (web renders data={exportJobs} verbatim).
        Assert.True(display.HasExportJobs);
        Assert.Equal(4, display.ExportRows.Count);
        Assert.Equal("a", display.ExportRows[0].Id);
        Assert.Equal("queued", display.ExportRows[0].StatusText);
        Assert.Equal("d", display.ExportRows[3].Id);

        // Status glyph + brush map through the helpers.tsx port.
        Assert.Equal(StatusHelpers.SuccessGlyph, display.ExportRows[2].StatusGlyph); // ready -> success
        Assert.Equal(StatusHelpers.SuccessBrushKey, display.ExportRows[2].StatusBrushKey);
        Assert.Equal(StatusHelpers.DangerGlyph, display.ExportRows[3].StatusGlyph); // failed -> danger
        Assert.Equal("10", display.ExportRows[0].RecordCount);

        // Compression hidden when its body is absent; section still has content via jobs.
        Assert.False(display.HasCompression);
        Assert.False(display.HasSavedBadge);
        Assert.True(display.HasAnyContent);
    }

    [Fact]
    public void Projection_renders_em_dash_for_missing_cells()
    {
        var reading = new DataPipelineReading(
            CompressionStatsSnapshot.Empty,
            new[] { new ExportJobSnapshot("x", null, null, null, null, 0, 0, null, null, null) });

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        var row = display.ExportRows[0];
        Assert.Equal(DataPipelineSectionProjection.EmDash, row.StatusText);
        Assert.Equal(DataPipelineSectionProjection.EmDash, row.Type);
        Assert.Equal(DataPipelineSectionProjection.EmDash, row.Format);
        Assert.Equal(DataPipelineSectionProjection.EmDash, row.FileName);
        Assert.True(display.HasAnyContent);
    }

    [Fact]
    public void Projection_no_active_badge_when_nothing_queued_or_processing()
    {
        var reading = new DataPipelineReading(
            CompressionStatsSnapshot.Empty,
            new[] { Job("a", "ready"), Job("b", "failed") });

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        Assert.False(display.HasActiveBadge);
        Assert.True(display.HasExportJobs); // still shows the table + stat tiles
        Assert.Equal(4, display.StatTiles.Count);
    }

    [Fact]
    public void Projection_empty_reading_has_no_content()
    {
        var display = DataPipelineSectionProjection.Project(DataPipelineReading.Empty, Localizer, Now);

        Assert.False(display.HasCompression);
        Assert.False(display.HasExportJobs);
        Assert.False(display.HasSavedBadge);
        Assert.False(display.HasActiveBadge);
        Assert.False(display.HasAnyContent);
        Assert.Empty(display.CompressionTiles);
        Assert.Empty(display.StatTiles);
    }

    [Fact]
    public void Projection_stat_tiles_hidden_when_no_export_jobs()
    {
        // Web parity: the four StatCards live inside the `exportJobs.length > 0` branch.
        var reading = new DataPipelineReading(
            new CompressionStatsSnapshot(0, 0, 10, 0, 0, 0, 0),
            Array.Empty<ExportJobSnapshot>());

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        Assert.True(display.HasCompression);
        Assert.False(display.HasExportJobs);
        Assert.Empty(display.StatTiles);
        Assert.Empty(display.ExportRows);
    }

    // ---- Accessibility: every projected tile/row carries a Narrator name --------------------------------

    [Fact]
    public void Projection_every_tile_and_row_has_a_narrator_name()
    {
        var reading = new DataPipelineReading(
            new CompressionStatsSnapshot(10, 6, 25, 100, 60, 40, 1024),
            new[] { Job("a", "ready", type: "drives", format: "csv", file: "a.csv", records: 5, created: "2026-06-09T10:00:00Z") });

        var display = DataPipelineSectionProjection.Project(reading, Localizer, Now);

        Assert.All(display.CompressionTiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.All(display.StatTiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.All(display.ExportRows, r => Assert.False(string.IsNullOrWhiteSpace(r.AutomationName)));
        Assert.Equal("Compression Ratio: 25.00%", display.CompressionTiles[0].AutomationName);
    }

    // ---- Result mappers (cache-then-network -> typed snapshot) ------------------------------------------

    [Fact]
    public void MapCompression_loaded_object_becomes_loaded_snapshot()
    {
        using var doc = JsonDocument.Parse("""{ "savings_percent": 12.5 }""");
        var raw = RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now);

        var mapped = DataPipelineSectionResultMapper.MapCompression(raw);

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Equal(12.5, mapped.Value!.SavingsPercent, 3);
    }

    [Fact]
    public void MapCompression_null_body_becomes_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var raw = RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now);

        Assert.Equal(LoadStatus.Empty, DataPipelineSectionResultMapper.MapCompression(raw).Status);
    }

    [Fact]
    public void MapCompression_failure_propagates_error()
    {
        var raw = RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "boom"));
        var mapped = DataPipelineSectionResultMapper.MapCompression(raw);

        Assert.Equal(LoadStatus.Error, mapped.Status);
        Assert.NotNull(mapped.Error);
    }

    [Fact]
    public void MapCompression_offline_cached_preserves_value_and_offline_status()
    {
        using var doc = JsonDocument.Parse("""{ "savings_percent": 9 }""");
        var raw = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = DataPipelineSectionResultMapper.MapCompression(raw);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.NotNull(mapped.Value);
    }

    [Fact]
    public void MapExportJobs_empty_array_becomes_empty_but_populated_array_loads()
    {
        using var emptyDoc = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, DataPipelineSectionResultMapper.MapExportJobs(
            RepositoryResult<JsonElement>.Loaded(emptyDoc.RootElement, Now)).Status);

        using var fullDoc = JsonDocument.Parse("""[ { "id": "1", "status": "ready" } ]""");
        var mapped = DataPipelineSectionResultMapper.MapExportJobs(RepositoryResult<JsonElement>.Loaded(fullDoc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Single(mapped.Value!);
    }

    [Fact]
    public void MapExportJobs_cached_stale_is_preserved()
    {
        using var doc = JsonDocument.Parse("""[ { "id": "1", "status": "ready" } ]""");
        var raw = RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true);

        var mapped = DataPipelineSectionResultMapper.MapExportJobs(raw);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Single(mapped.Value!);
    }

    // ---- View-model: every state renders ----------------------------------------------------------------

    [Fact]
    public void ViewModel_starts_in_loading()
    {
        using var vm = new DataPipelineSectionViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(DataPipelineSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_when_both_reads_carry_content()
    {
        var source = new FakeSource(
            Compression(LoadStatus.Loaded, new CompressionStatsSnapshot(10, 6, 25, 100, 60, 40, 1024)),
            ExportJobs(LoadStatus.Loaded, Job("a", "ready", created: "2026-06-09T10:00:00Z")));
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Loaded, vm.State);
        Assert.True(vm.Display.HasCompression);
        Assert.True(vm.Display.HasExportJobs);
        Assert.False(vm.IsError);
        Assert.False(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_empty_when_both_reads_resolve_with_nothing()
    {
        var source = new FakeSource(CompressionEmpty(), ExportJobsEmpty());
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Empty, vm.State);
        Assert.False(vm.Display.HasAnyContent);
    }

    [Fact]
    public async Task ViewModel_error_when_both_reads_fail_with_nothing_cached()
    {
        var source = new FakeSource(CompressionFail(), ExportJobsFail());
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_when_a_read_is_cached_stale_with_content()
    {
        var source = new FakeSource(
            new[] { RepositoryResult<CompressionStatsSnapshot>.Cached(new CompressionStatsSnapshot(10, 6, 25, 100, 60, 40, 1024), Now, stale: true) },
            ExportJobs(LoadStatus.Loaded, Job("a", "ready", created: "2026-06-09T10:00:00Z")));
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_offline_when_a_read_is_offline_with_content()
    {
        var source = new FakeSource(
            new[]
            {
                RepositoryResult<CompressionStatsSnapshot>.OfflineCached(
                    new CompressionStatsSnapshot(10, 6, 25, 100, 60, 40, 1024), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            },
            ExportJobsEmpty());
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_compression_when_jobs_are_empty()
    {
        var source = new FakeSource(
            Compression(LoadStatus.Loaded, new CompressionStatsSnapshot(10, 6, 25, 100, 60, 40, 1024)),
            ExportJobsEmpty());
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Loaded, vm.State);
        Assert.True(vm.Display.HasCompression);
        Assert.False(vm.Display.HasExportJobs);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_jobs_when_compression_is_empty()
    {
        var source = new FakeSource(
            CompressionEmpty(),
            ExportJobs(LoadStatus.Loaded, Job("a", "queued", created: "2026-06-09T10:00:00Z")));
        using var vm = new DataPipelineSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataPipelineSectionState.Loaded, vm.State);
        Assert.False(vm.Display.HasCompression);
        Assert.True(vm.Display.HasExportJobs);
        Assert.True(vm.Display.HasActiveBadge); // one queued job
    }

    // ---- Localized chrome resolves the required web keys ------------------------------------------------

    [Fact]
    public void ViewModel_exposes_web_strings_through_the_localizer()
    {
        using var vm = new DataPipelineSectionViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Data Pipeline", vm.Title);
        Assert.Equal("Compression statistics and export job queue", vm.Description);
        Assert.Equal("Compression Statistics", vm.CompressionStatisticsTitle);
        Assert.Equal("Export Job Queue", vm.ExportJobQueueTitle);
        Assert.Equal("No export jobs in queue", vm.NoExportJobsMessage);
    }

    [Fact]
    public void Required_web_i18n_keys_are_requested_through_the_facade()
    {
        var recorder = new RecordingLocalizer();
        using var vm = new DataPipelineSectionViewModel(new FakeSource(), recorder, () => Now);

        _ = vm.Title;
        _ = vm.Description;
        _ = vm.CompressionStatisticsTitle;
        _ = vm.ExportJobQueueTitle;
        _ = vm.NoExportJobsMessage;

        Assert.Contains("featureView.dataPipeline.title", recorder.Keys);
        Assert.Contains("featureView.dataPipeline.description", recorder.Keys);
        Assert.Contains("featureView.dataPipeline.compressionStatistics", recorder.Keys);
        Assert.Contains("featureView.dataPipeline.exportJobQueue", recorder.Keys);
        Assert.Contains("featureView.dataPipeline.noExportJobs", recorder.Keys);
    }

    // ---- Diagnostics + registration ---------------------------------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DataPipelineSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DataPipelineSection", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_canonical_metadata()
    {
        Assert.Equal("DataPipelineSection", DataPipelineSectionRegistration.Slug);
        Assert.Equal("data-pipeline-section", DataPipelineSectionRegistration.Id);
        Assert.Equal("Data Pipeline", DataPipelineSectionRegistration.Title(Localizer));
        Assert.Equal("Compression statistics and export job queue", DataPipelineSectionRegistration.Description(Localizer));
    }

    // ---- Test doubles -----------------------------------------------------------------------------------

    private static ExportJobSnapshot Job(
        string id,
        string status,
        string? type = null,
        string? format = null,
        string? file = null,
        long records = 0,
        string? created = null) =>
        new(id, type, format, status, file, 0, records, null, created, null);

    private static RepositoryResult<CompressionStatsSnapshot>[] Compression(LoadStatus status, CompressionStatsSnapshot value) =>
        new[] { status == LoadStatus.Loaded ? RepositoryResult<CompressionStatsSnapshot>.Loaded(value, Now) : RepositoryResult<CompressionStatsSnapshot>.Cached(value, Now, false) };

    private static RepositoryResult<CompressionStatsSnapshot>[] CompressionEmpty() =>
        new[] { RepositoryResult<CompressionStatsSnapshot>.Empty(Now) };

    private static RepositoryResult<CompressionStatsSnapshot>[] CompressionFail() =>
        new[] { RepositoryResult<CompressionStatsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "x")) };

    private static RepositoryResult<IReadOnlyList<ExportJobSnapshot>>[] ExportJobs(LoadStatus status, params ExportJobSnapshot[] rows)
    {
        IReadOnlyList<ExportJobSnapshot> list = rows;
        return new[] { RepositoryResult<IReadOnlyList<ExportJobSnapshot>>.Loaded(list, Now) };
    }

    private static RepositoryResult<IReadOnlyList<ExportJobSnapshot>>[] ExportJobsEmpty() =>
        new[] { RepositoryResult<IReadOnlyList<ExportJobSnapshot>>.Empty(Now) };

    private static RepositoryResult<IReadOnlyList<ExportJobSnapshot>>[] ExportJobsFail() =>
        new[] { RepositoryResult<IReadOnlyList<ExportJobSnapshot>>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "x")) };

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    /// <summary>A fake source that replays a fixed sequence of emissions per read. Defaults to a single
    /// Loading emission so a freshly-constructed view-model that never loads stays on the skeleton.</summary>
    private sealed class FakeSource : IDataPipelineSectionSource
    {
        private readonly RepositoryResult<CompressionStatsSnapshot>[] _compression;
        private readonly RepositoryResult<IReadOnlyList<ExportJobSnapshot>>[] _exportJobs;

        public FakeSource(
            RepositoryResult<CompressionStatsSnapshot>[]? compression = null,
            RepositoryResult<IReadOnlyList<ExportJobSnapshot>>[]? exportJobs = null)
        {
            _compression = compression ?? new[] { RepositoryResult<CompressionStatsSnapshot>.Loading() };
            _exportJobs = exportJobs ?? new[] { RepositoryResult<IReadOnlyList<ExportJobSnapshot>>.Loading() };
        }

        public IAsyncEnumerable<RepositoryResult<CompressionStatsSnapshot>> StreamCompressionAsync(CancellationToken cancellationToken = default) =>
            Replay(_compression, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<IReadOnlyList<ExportJobSnapshot>>> StreamExportJobsAsync(CancellationToken cancellationToken = default) =>
            Replay(_exportJobs, cancellationToken);

        private static async IAsyncEnumerable<T> Replay<T>(T[] items, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var item in items)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return item;
            }
        }
    }
}
