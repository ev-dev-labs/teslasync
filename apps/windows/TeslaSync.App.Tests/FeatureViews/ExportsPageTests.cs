using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Exports;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ExportsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/exports/pages/ExportsPage.tsx), the tolerant parsers (the bare-array + platform <c>{data:…}</c>
/// envelope list, the bulk result), the view-model's four-state matrix (loading / empty / error / success) plus the
/// bulk-selection + bulk-delete flow (web <c>useBulkSelection</c> + <c>useBulkExportsDelete</c>), and the
/// generated-client feed's request shaping (web <c>useExportJobs</c> GET + <c>POST /export/jobs/bulk</c> + the
/// <c>exportDownloadUrl</c> link). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="ExportsDisplay"/> flags asserted here.
/// </summary>
public sealed class ExportsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 17, 0, 0, TimeSpan.Zero);
    private static readonly Uri DownloadBase = new("https://teslasync.example");

    // The 19 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "bulk.selectAll", "bulk.selectRow", "common.delete", "exportsList.bulk.delete",
        "exportsList.bulk.deleteConfirm.body", "exportsList.bulk.deleteConfirm.title", "exportsList.col.created",
        "exportsList.col.format", "exportsList.col.size", "exportsList.col.status", "exportsList.col.type",
        "exportsList.download", "exportsList.empty.body", "exportsList.empty.title", "exportsList.noun.one",
        "exportsList.noun.other", "exportsList.selectExport", "exportsList.subtitle", "exportsList.title",
    ];

    private static ExportJobSummary Job(
        string id = "job-1",
        string type = "drives",
        string format = "csv",
        string status = "ready",
        long? fileSize = 2048,
        string? createdAt = "2026-06-12T16:30:00Z") =>
        new(id, type, format, status, fileSize, createdAt);

    private static ExportsModel Model(
        IReadOnlyList<ExportJobSummary>? jobs = null,
        IReadOnlySet<string>? selected = null,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null,
        bool bulkBusy = false,
        Uri? downloadBase = null) =>
        new(
            Jobs: jobs ?? [Job()],
            SelectedIds: selected ?? new HashSet<string>(StringComparer.Ordinal),
            Loading: loading,
            HasError: hasError,
            ErrorDetail: errorDetail,
            BulkBusy: bulkBusy,
            DownloadBase: downloadBase,
            Now: Now);

    // ---- i18n key coverage (all 19 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = ExportsProjection.Project(Model(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (column headers, the select template, the bulk-action labels, the download label) resolve on
        // every projection regardless of data state; visibility is gated separately.
        _ = ExportsProjection.Project(ExportsModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = ExportsProjection.Project(ExportsModel.Initial, Localizer);

        Assert.Equal(ExportsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowTable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_jobs()
    {
        var display = ExportsProjection.Project(Model(jobs: []), Localizer);

        Assert.Equal(ExportsState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.Equal("No exports yet", display.EmptyTitle);
        Assert.Equal("Your future exports will appear here for download or deletion.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_shows_failure_and_retry()
    {
        var display = ExportsProjection.Project(
            Model(jobs: [], loading: false, hasError: true, errorDetail: "network down"),
            Localizer);

        Assert.Equal(ExportsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_jobs_present()
    {
        var display = ExportsProjection.Project(Model(), Localizer);

        Assert.Equal(ExportsState.Success, display.State);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Panel (GlassPanel1) — table chrome + rows ---------------------------------

    [Fact]
    public void Table_projects_the_five_column_headers_and_select_labels()
    {
        var display = ExportsProjection.Project(Model(), Localizer);

        Assert.Equal("Type", display.TypeHeader);
        Assert.Equal("Format", display.FormatHeader);
        Assert.Equal("Size", display.SizeHeader);
        Assert.Equal("Created", display.CreatedHeader);
        Assert.Equal("Status", display.StatusHeader);
        Assert.Equal("Select all", display.SelectAllLabel);
        Assert.Equal("Select row", display.SelectRowLabel);
    }

    [Fact]
    public void Table_row_formats_every_cell_for_a_ready_job()
    {
        var job = Job(id: "abc-123", type: "charging", format: "json", status: "ready", fileSize: 1536);
        var display = ExportsProjection.Project(Model(jobs: [job], downloadBase: DownloadBase), Localizer);

        var projected = Assert.Single(display.Rows);
        Assert.Equal("abc-123", projected.Id);
        Assert.Equal("charging", projected.Type);
        Assert.Equal("JSON", projected.Format); // web uppercase
        Assert.Equal("1.5 KB", projected.Size); // web formatBytes
        Assert.NotEqual("\u2014", projected.Created); // a parseable timestamp formats to a real datetime
        Assert.Equal("ready", projected.StatusLabel); // passthrough fallback = raw status (web t(`...${status}`, status))
        Assert.Equal(StatusKind.Success, projected.StatusKind);
        Assert.Equal("Select export abc-123", projected.SelectLabel);
        Assert.True(projected.CanDownload);
        Assert.Equal("/api/v1/export/jobs/abc-123/download", projected.DownloadPath);
        Assert.Equal("https://teslasync.example/api/v1/export/jobs/abc-123/download", projected.DownloadUri!.ToString());
        Assert.Equal("Download", projected.DownloadLabel);
    }

    [Fact]
    public void Table_row_uses_em_dash_for_missing_size_and_hides_download_for_unready_jobs()
    {
        var job = Job(id: "p1", type: "", format: "", status: "processing", fileSize: null, createdAt: null);
        var display = ExportsProjection.Project(Model(jobs: [job], downloadBase: DownloadBase), Localizer);

        var projected = Assert.Single(display.Rows);
        Assert.Equal("\u2014", projected.Type);
        Assert.Equal("\u2014", projected.Format);
        Assert.Equal("\u2014", projected.Size);
        Assert.Equal("\u2014", projected.Created); // null timestamp -> em-dash
        Assert.Equal(StatusKind.Info, projected.StatusKind); // processing -> info
        Assert.False(projected.CanDownload);
        Assert.Null(projected.DownloadUri);
    }

    [Theory]
    [InlineData("ready", StatusKind.Success)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("processing", StatusKind.Info)]
    [InlineData("queued", StatusKind.Info)]
    [InlineData("expired", StatusKind.Neutral)]
    [InlineData("unknown", StatusKind.Neutral)]
    public void Status_chip_colour_matches_web_statusVariant(string status, StatusKind expected)
    {
        Assert.Equal(expected, ExportJobSummary.BadgeFor(status));
    }

    [Fact]
    public void Download_uri_is_null_when_no_origin_is_known()
    {
        var display = ExportsProjection.Project(Model(jobs: [Job(status: "ready")], downloadBase: null), Localizer);

        var projected = Assert.Single(display.Rows);
        Assert.True(projected.CanDownload);
        Assert.Null(projected.DownloadUri); // the link only renders once the API origin is known
    }

    // ---- Bulk-action toolbar -------------------------------------------------------

    [Fact]
    public void Bulk_bar_is_hidden_when_nothing_is_selected()
    {
        var display = ExportsProjection.Project(Model(), Localizer);

        Assert.False(display.ShowBulkBar);
        Assert.Equal(0, display.SelectedCount);
    }

    [Fact]
    public void Bulk_bar_projects_count_singular_noun_and_delete_action()
    {
        var jobs = new[] { Job("a"), Job("b") };
        var display = ExportsProjection.Project(
            Model(jobs: jobs, selected: new HashSet<string>(StringComparer.Ordinal) { "a" }),
            Localizer);

        Assert.True(display.ShowBulkBar);
        Assert.Equal(1, display.SelectedCount);
        Assert.Equal("export", display.ItemNoun); // singular noun for one selection
        Assert.Equal("Clear selection", display.ClearLabel);
        Assert.Equal("Delete", display.DeleteLabel);
        Assert.False(string.IsNullOrEmpty(display.DeleteGlyph));
    }

    [Fact]
    public void Bulk_bar_uses_the_plural_noun_for_multiple_selections()
    {
        var jobs = new[] { Job("a"), Job("b") };
        var display = ExportsProjection.Project(
            Model(jobs: jobs, selected: new HashSet<string>(StringComparer.Ordinal) { "a", "b" }),
            Localizer);

        Assert.Equal(2, display.SelectedCount);
        Assert.Equal("exports", display.ItemNoun);
    }

    [Fact]
    public void Delete_action_carries_the_confirm_copy()
    {
        var display = ExportsProjection.Project(Model(), Localizer);

        Assert.Equal("Delete export jobs?", display.DeleteConfirmTitle);
        Assert.Equal(
            "Selected jobs and their downloadable artifacts will be permanently removed.",
            display.DeleteConfirmBody);
        Assert.Equal("Delete", display.DeleteConfirmLabel);
        Assert.Equal("Cancel", display.DeleteCancelLabel);
    }

    // ---- Master-checkbox tri-state -------------------------------------------------

    [Theory]
    [InlineData(new string[0], ExportsMasterState.None)]
    [InlineData(new[] { "a" }, ExportsMasterState.Some)]
    [InlineData(new[] { "a", "b" }, ExportsMasterState.All)]
    public void Master_state_reflects_the_visible_selection(string[] selected, ExportsMasterState expected)
    {
        var jobs = new[] { Job("a"), Job("b") };
        var model = Model(jobs: jobs, selected: new HashSet<string>(selected, StringComparer.Ordinal));

        Assert.Equal(expected, ExportsProjection.ComputeMasterState(model));
        Assert.Equal(expected, ExportsProjection.Project(model, Localizer).MasterState);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parses_a_bare_array()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":\"1\",\"type\":\"drives\",\"format\":\"csv\",\"status\":\"ready\",\"file_size\":2048,\"created_at\":\"2026-06-12T16:30:00Z\"}," +
            "{\"id\":\"2\",\"type\":\"charging\",\"format\":\"json\",\"status\":\"processing\"}]");

        var snapshot = ExportsListSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(2, snapshot.Jobs.Count);
        Assert.Equal("1", snapshot.Jobs[0].Id);
        Assert.Equal("drives", snapshot.Jobs[0].Type);
        Assert.Equal(2048, snapshot.Jobs[0].FileSize);
        Assert.True(snapshot.Jobs[0].IsReady);
        Assert.Null(snapshot.Jobs[1].FileSize); // missing file_size -> null
        Assert.False(snapshot.Jobs[1].IsReady);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope()
    {
        using var doc = JsonDocument.Parse("{\"data\":[{\"id\":\"5\",\"type\":\"trips\",\"status\":\"ready\"}]}");

        var snapshot = ExportsListSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal("trips", Assert.Single(snapshot.Jobs).Type);
    }

    [Fact]
    public void Snapshot_treats_non_array_as_no_data()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.False(ExportsListSnapshot.FromJson(doc.RootElement).HasData);
    }

    [Fact]
    public void Bulk_outcome_parses_deleted_and_failed_counts()
    {
        using var deleted = JsonDocument.Parse("{\"deleted\":3,\"failed\":[]}");
        var d = ExportBulkOutcome.FromJson(deleted.RootElement);
        Assert.Equal(3, d.Deleted);
        Assert.Equal(0, d.Failed);

        using var partial = JsonDocument.Parse("{\"deleted\":2,\"failed\":[{\"id\":\"9\",\"reason\":\"not_found\"}]}");
        var p = ExportBulkOutcome.FromJson(partial.RootElement);
        Assert.Equal(2, p.Deleted);
        Assert.Equal(1, p.Failed);
    }

    // ---- formatBytes parity --------------------------------------------------------

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(512L, "512 B")]
    [InlineData(1536L, "1.5 KB")]
    [InlineData(5_242_880L, "5.0 MB")]
    [InlineData(2_147_483_648L, "2.0 GB")]
    public void FormatBytes_matches_web_binary_units(long? bytes, string expected)
    {
        Assert.Equal(expected, ExportsRegistration.FormatBytes(bytes));
    }

    // ---- View-model state matrix + selection ---------------------------------------

    [Fact]
    public async Task ViewModel_loads_jobs_into_the_success_state()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job()]));
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ExportsState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new ExportsPageViewModel(EmptyExportsFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ExportsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new ExportsPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ExportsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_toggle_row_selects_then_deselects()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job("a"), Job("b")]));
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleRow("a");
        Assert.Equal(1, vm.Display.SelectedCount);
        Assert.Equal(ExportsMasterState.Some, vm.Display.MasterState);

        vm.ToggleRow("a");
        Assert.Equal(0, vm.Display.SelectedCount);
        Assert.False(vm.Display.ShowBulkBar);
    }

    [Fact]
    public async Task ViewModel_toggle_all_selects_every_row_then_clears()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job("a"), Job("b")]));
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleAll();
        Assert.Equal(2, vm.Display.SelectedCount);
        Assert.Equal(ExportsMasterState.All, vm.Display.MasterState);

        vm.ToggleAll();
        Assert.Equal(0, vm.Display.SelectedCount);
        Assert.Equal(ExportsMasterState.None, vm.Display.MasterState);
    }

    // ---- View-model bulk delete ----------------------------------------------------

    [Fact]
    public async Task ViewModel_bulk_delete_runs_clears_selection_and_reloads()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job("a"), Job("b")]))
        {
            BulkResult = new ExportBulkOutcome(2, 0),
        };
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.ToggleAll();

        await vm.RunBulkDeleteAsync();

        Assert.Equal(1, feed.BulkCount);
        Assert.Equal(new[] { "a", "b" }, feed.LastIds!.OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.Equal(2, feed.FetchCount); // initial load + reload after the delete
        Assert.Equal(0, vm.Display.SelectedCount); // selection cleared on success
        Assert.False(vm.IsBulkBusy);
    }

    [Fact]
    public async Task ViewModel_bulk_failure_keeps_the_selection()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job("a")])) { BulkThrows = true };
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.ToggleRow("a");

        await vm.RunBulkDeleteAsync();

        Assert.Equal(1, vm.Display.SelectedCount); // selection preserved so the user can retry
        Assert.False(vm.IsBulkBusy);
    }

    [Fact]
    public async Task ViewModel_bulk_is_a_no_op_when_nothing_is_selected()
    {
        var feed = new FakeFeed(new ExportsListSnapshot(true, [Job("a")]));
        using var vm = new ExportsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RunBulkDeleteAsync();

        Assert.Equal(0, feed.BulkCount);
    }

    // ---- Generated-client feed (web useExportJobs + useBulkExportsDelete) -----------

    [Fact]
    public async Task ClientFeed_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":\"1\",\"type\":\"drives\",\"status\":\"ready\"}]"));
        var feed = new ExportsClientFeed(api, DownloadBase);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal("drives", Assert.Single(snapshot.Jobs).Type);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_export_jobs", request.OperationId);
        Assert.Equal(DownloadBase, feed.DownloadBaseUri);
    }

    [Fact]
    public async Task ClientFeed_posts_the_bulk_delete_with_ids_and_op_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"deleted\":2,\"failed\":[]}"));
        var feed = new ExportsClientFeed(api);

        var outcome = await feed.BulkDeleteAsync(new[] { "a", "b" }, default);

        Assert.Equal(2, outcome.Deleted);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_export_jobs_bulk", request.OperationId);
        Assert.NotNull(request.Body);
        Assert.Equal("{\"ids\":[\"a\",\"b\"],\"op\":\"delete\"}", JsonSerializer.Serialize(request.Body!, request.Body!.GetType()));
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_from_a_failed_list()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new ExportsClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    // ---- Download URL + registration + diagnostics ---------------------------------

    [Fact]
    public void Registration_builds_the_web_download_url()
    {
        Assert.Equal("/api/v1/export/jobs/job-42/download", ExportsRegistration.DownloadPath("job-42"));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("Exports", ExportsRegistration.RouteName);
        Assert.Equal("get_api_v1_export_jobs", ExportsRegistration.ListOperation);
        Assert.Equal("post_api_v1_export_jobs_bulk", ExportsRegistration.BulkOperation);
        Assert.Equal("delete", ExportsRegistration.DeleteOp);
        Assert.Equal("Exports", ExportsRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new ExportsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ExportsPage", Assert.Single(lines));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IExportsFeed
    {
        private readonly ExportsListSnapshot _snapshot;

        public FakeFeed(ExportsListSnapshot snapshot) => _snapshot = snapshot;

        public Uri? DownloadBaseUri => DownloadBase;

        public int FetchCount { get; private set; }

        public int BulkCount { get; private set; }

        public IReadOnlyList<string>? LastIds { get; private set; }

        public ExportBulkOutcome BulkResult { get; set; } = ExportBulkOutcome.Empty;

        public bool BulkThrows { get; set; }

        public Task<ExportsListSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }

        public Task<ExportBulkOutcome> BulkDeleteAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken)
        {
            BulkCount++;
            LastIds = ids;
            if (BulkThrows)
            {
                throw new InvalidOperationException("bulk failed");
            }

            return Task.FromResult(BulkResult);
        }
    }

    private sealed class ThrowingFeed : IExportsFeed
    {
        public Uri? DownloadBaseUri => null;

        public Task<ExportsListSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<ExportBulkOutcome> BulkDeleteAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
