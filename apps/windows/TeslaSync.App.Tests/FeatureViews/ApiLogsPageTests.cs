using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ApiLogsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/ApiLogsPage.tsx), the badge/service catalogs, the service-option derivation
/// (web/src/features/admin/lib/serviceOptions.ts), the JSON pretty-printer + export, the tolerant parsers, and the
/// view-model's four-state matrix (loading / empty / error / success). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="ApiLogsDisplay"/> flags asserted here.
/// </summary>
public sealed class ApiLogsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 30 i18n keys the manifest requires the page to resolve (29 apiLogs.* + error.loadFailed).
    private static readonly string[] RequiredStringKeys =
    [
        "apiLogs.adjustFilters", "apiLogs.allMethods", "apiLogs.allServices", "apiLogs.allStatus",
        "apiLogs.avgDuration", "apiLogs.byService", "apiLogs.clear", "apiLogs.error", "apiLogs.errorRate",
        "apiLogs.exportJson", "apiLogs.filterEndpoint", "apiLogs.filters", "apiLogs.last24h", "apiLogs.loading",
        "apiLogs.next", "apiLogs.noData", "apiLogs.noLogs", "apiLogs.noLogsFound", "apiLogs.pageOf",
        "apiLogs.previous", "apiLogs.requestBody", "apiLogs.requestUrl", "apiLogs.responseBody",
        "apiLogs.serviceCount", "apiLogs.serviceFilterAria", "apiLogs.showing", "apiLogs.subtitle",
        "apiLogs.title", "apiLogs.totalCalls", "error.loadFailed",
    ];

    private static ApiCallLogStats SampleStats() => new(
        TotalCalls: 12345,
        ByMethod: new Dictionary<string, long> { ["GET"] = 10000, ["POST"] = 2345 },
        ByService: new Dictionary<string, long> { ["teslasync-api"] = 9000, ["tesla-api"] = 3000, ["unknown-svc"] = 345 },
        ErrorRate: 6.5,
        ErrorCount: 802,
        AvgDurationMs: 134.7,
        Last24h: 987);

    private static ApiCallLog SampleLog(long id = 1, string method = "POST", int? status = 500, string? error = "boom") => new(
        Id: id,
        Ts: "2026-06-06T11:30:00Z",
        VehicleId: 7,
        Service: "tesla-api",
        HttpMethod: method,
        Endpoint: "/api/1/vehicles/7/command",
        StatusCode: status,
        DurationMs: 42,
        ErrorMessage: error,
        RateLimited: false,
        RequestBody: "{\"wake\":true}",
        ResponseBody: null);

    private static ApiLogsModel RichModel() => new(
        Stats: SampleStats(),
        Logs: [SampleLog()],
        Total: 60,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        Filter: new ApiLogsFilter("tesla-api", "POST", "5xx", "vehicles", string.Empty, string.Empty),
        Page: 1,
        Limit: 25,
        ExpandedId: 1);

    // ---- i18n key coverage (all 30 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // The running page resolves chrome through the projection and the expanded-detail headings through
        // DetailLabels; together they must cover every manifest key.
        _ = ApiLogsProjection.Project(RichModel(), recorder, Now);
        _ = ApiLogsProjection.DetailLabels(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = ApiLogsProjection.Project(ApiLogsModel.Initial, recorder, Now);
        _ = ApiLogsProjection.DetailLabels(recorder);

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = ApiLogsProjection.Project(ApiLogsModel.Initial, Localizer, Now);

        Assert.Equal(ApiLogsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal("Loading logs...", display.LoadingText);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Stats = SampleStats() };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(ApiLogsState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowEmptyHint); // no active filters
        Assert.Equal("No API call logs found", display.EmptyText);
        Assert.Equal("No logs found", display.TableSummaryText);
    }

    [Fact]
    public void State_empty_with_filters_shows_adjust_hint()
    {
        var model = ApiLogsModel.Initial with
        {
            Loading = false,
            Filter = ApiLogsFilter.Empty with { Method = "GET" },
        };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(ApiLogsState.Empty, display.State);
        Assert.True(display.ShowEmptyHint);
        Assert.True(display.HasFilters);
        Assert.Equal("Try adjusting your filters", display.EmptyHintText);
    }

    [Fact]
    public void State_error_shows_banner_with_detail()
    {
        var model = ApiLogsModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(ApiLogsState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Equal("Failed to load data: network down", display.ErrorBannerText);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Logs = [SampleLog()], Total = 1 };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(ApiLogsState.Success, display.State);
        Assert.True(display.ShowRows);
        Assert.Single(display.Rows);
        Assert.True(display.CanExport);
    }

    // ---- Panel: stat tiles ---------------------------------------------------------

    [Fact]
    public void StatCards_format_values_like_the_web_helpers()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Stats = SampleStats() };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Total Calls", display.StatCards[0].Label);
        Assert.Equal("12,345", display.StatCards[0].Value);
        Assert.Equal("Error Rate", display.StatCards[1].Label);
        Assert.Equal("6.50%", display.StatCards[1].Value);
        Assert.Equal("802", display.StatCards[1].Sublabel); // error_rate > 5 surfaces error_count
        Assert.Equal("Avg Duration", display.StatCards[2].Label);
        Assert.Equal("134ms", display.StatCards[2].Value);
        Assert.Equal("Last 24h", display.StatCards[3].Label);
        Assert.Equal("987", display.StatCards[3].Value);
    }

    [Fact]
    public void StatCards_render_em_dash_when_stats_absent()
    {
        var display = ApiLogsProjection.Project(ApiLogsModel.Initial, Localizer, Now);

        Assert.All(display.StatCards, c => Assert.Equal(ApiLogsProjection.EmDash, c.Value));
        Assert.Null(display.StatCards[1].Sublabel);
    }

    // ---- Panel: by-service chips ---------------------------------------------------

    [Fact]
    public void ByService_chips_map_labels_and_variants()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Stats = SampleStats() };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.True(display.HasByService);
        Assert.Equal("By Service", display.ByServiceLabel);
        Assert.Equal(3, display.ServiceChips.Count);

        var teslasync = display.ServiceChips.Single(c => c.Service == "teslasync-api");
        Assert.Equal("TeslaSync API", teslasync.Label);
        Assert.Equal(StatusKind.Info, teslasync.Variant);
        Assert.Equal("9,000", teslasync.CountText);

        var unknown = display.ServiceChips.Single(c => c.Service == "unknown-svc");
        Assert.Equal("unknown-svc", unknown.Label); // unknown → raw id + neutral
        Assert.Equal(StatusKind.Neutral, unknown.Variant);
    }

    // ---- Panel: filters / service options ------------------------------------------

    [Fact]
    public void ServiceOptions_union_is_label_sorted_with_all_head()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Stats = SampleStats(), Filter = ApiLogsFilter.Empty with { Service = "custom-active" } };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.Equal(string.Empty, display.ServiceOptions[0].Value);
        Assert.Equal("All Services", display.ServiceOptions[0].Label);

        var values = display.ServiceOptions.Select(o => o.Value).ToList();
        Assert.Contains("custom-active", values);        // active selection always present
        Assert.Contains("github-releases", values);      // static catalog always present
        Assert.Contains("unknown-svc", values);          // live by_service key present

        var tailLabels = display.ServiceOptions.Skip(1).Select(o => o.Label).ToList();
        var sorted = tailLabels.OrderBy(l => l, StringComparer.OrdinalIgnoreCase).ToList();
        Assert.Equal(sorted, tailLabels);
    }

    [Fact]
    public void ServiceCount_reports_tracked_and_known()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Stats = SampleStats() };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowServiceCount);
        // 3 services with data; 11 in the static catalog.
        Assert.Equal("3 with data \u00b7 11 known", display.ServiceCountText);
    }

    [Fact]
    public void Method_and_status_options_match_web()
    {
        var display = ApiLogsProjection.Project(ApiLogsModel.Initial, Localizer, Now);

        Assert.Equal(["", "GET", "POST", "PUT", "DELETE"], display.MethodOptions.Select(o => o.Value).ToArray());
        Assert.Equal("All Methods", display.MethodOptions[0].Label);
        Assert.Equal(["", "2xx", "3xx", "4xx", "5xx"], display.StatusOptions.Select(o => o.Value).ToArray());
        Assert.Equal("All Status", display.StatusOptions[0].Label);
        Assert.Equal("Filter by endpoint...", display.EndpointHint);
    }

    // ---- Panel: table header + pagination ------------------------------------------

    [Fact]
    public void TableSummary_reports_the_visible_range()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Logs = [SampleLog()], Total = 60, Page = 1 };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        // page 1 (zero-based) → rows 26–50 of 60
        Assert.Equal("Showing 26\u201350 of 60", display.TableSummaryText);
    }

    [Fact]
    public void Pagination_math_matches_web()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Logs = [SampleLog()], Total = 60, Page = 1 };
        var display = ApiLogsProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowPagination);        // ceil(60/25) = 3 pages
        Assert.Equal("Page 2 of 3", display.PageOfText);
        Assert.True(display.CanGoPrevious);
        Assert.True(display.CanGoNext);

        var lastPage = ApiLogsProjection.Project(model with { Page = 2 }, Localizer, Now);
        Assert.False(lastPage.CanGoNext);

        var single = ApiLogsProjection.Project(model with { Total = 10, Page = 0 }, Localizer, Now);
        Assert.False(single.ShowPagination);
    }

    // ---- Panel: log rows + expanded detail -----------------------------------------

    [Fact]
    public void Row_projects_header_and_detail_blocks()
    {
        var model = ApiLogsModel.Initial with { Loading = false, Logs = [SampleLog()], Total = 1, ExpandedId = 1 };
        var display = ApiLogsProjection.Project(model, Localizer, Now);
        var row = Assert.Single(display.Rows);

        var expectedTs = DateTimeFormatting.Format(
            DateTimeOffset.Parse("2026-06-06T11:30:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            DateTimeVariant.Full,
            Now);
        Assert.Equal(expectedTs, row.Timestamp);
        Assert.Equal("Tesla API", row.ServiceLabel);
        Assert.Equal(StatusKind.Info, row.ServiceVariant);
        Assert.Equal("POST", row.Method);
        Assert.Equal(StatusKind.Info, row.MethodVariant);
        Assert.Equal("500", row.StatusText);
        Assert.Equal(StatusKind.Danger, row.StatusVariant);
        Assert.Equal("42ms", row.DurationText);
        Assert.True(row.HasError);
        Assert.Equal("boom", row.ErrorSummary);
        Assert.True(row.IsExpanded);
        Assert.Equal("POST /api/1/vehicles/7/command", row.RequestUrlText);
        Assert.Equal("boom", row.ErrorBody);

        Assert.True(row.RequestBody.HasData);
        Assert.Equal("Request Body", row.RequestBody.Label);
        Assert.Contains("\"wake\"", row.RequestBody.Body);

        Assert.False(row.ResponseBody.HasData); // null response body
        Assert.Equal("No response body", row.ResponseBody.Body);
    }

    [Fact]
    public void Row_uses_na_status_and_em_dash_error_when_missing()
    {
        var log = SampleLog(status: null, error: null);
        var model = ApiLogsModel.Initial with { Loading = false, Logs = [log], Total = 1 };
        var display = ApiLogsProjection.Project(model, Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.Equal("N/A", row.StatusText);
        Assert.Equal(StatusKind.Neutral, row.StatusVariant);
        Assert.False(row.HasError);
        Assert.Equal(ApiLogsProjection.EmDash, row.ErrorSummary);
    }

    // ---- Badge mappings ------------------------------------------------------------

    [Theory]
    [InlineData("GET", StatusKind.Success)]
    [InlineData("POST", StatusKind.Info)]
    [InlineData("PUT", StatusKind.Warning)]
    [InlineData("PATCH", StatusKind.Warning)]
    [InlineData("DELETE", StatusKind.Danger)]
    [InlineData("HEAD", StatusKind.Neutral)]
    public void MethodBadge_matches_web(string method, StatusKind expected) =>
        Assert.Equal(expected, ApiLogBadges.Method(method));

    [Theory]
    [InlineData(null, StatusKind.Neutral)]
    [InlineData(0, StatusKind.Neutral)]
    [InlineData(200, StatusKind.Success)]
    [InlineData(301, StatusKind.Info)]
    [InlineData(404, StatusKind.Warning)]
    [InlineData(500, StatusKind.Danger)]
    public void StatusBadge_matches_web(int? code, StatusKind expected) =>
        Assert.Equal(expected, ApiLogBadges.Status(code));

    // ---- JSON pretty-print + export ------------------------------------------------

    [Fact]
    public void PrettyJson_indents_valid_json_and_passes_raw_through()
    {
        var pretty = ApiLogsProjection.PrettyJson("{\"a\":1}");
        Assert.Contains("\n", pretty);
        Assert.Contains("\"a\": 1", pretty);

        Assert.Equal("not json", ApiLogsProjection.PrettyJson("not json"));
    }

    [Fact]
    public void Export_serializes_snake_case_and_names_the_file()
    {
        var json = ApiLogsExport.ToJson([SampleLog()]);
        Assert.Contains("\"http_method\": \"POST\"", json);
        Assert.Contains("\"status_code\": 500", json);
        Assert.Contains("\"request_body\"", json);

        Assert.Equal("teslasync-api-logs-2026-06-06.json", ApiLogsExport.FileName(Now));
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void ParseList_is_tolerant_of_partial_and_non_array_input()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(ApiCallLog.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("[{\"id\":5,\"http_method\":\"GET\"},{}]");
        var rows = ApiCallLog.ParseList(partial.RootElement);
        Assert.Equal(2, rows.Count);
        Assert.Equal(5, rows[0].Id);
        Assert.Equal("GET", rows[0].HttpMethod);
        Assert.Equal(0, rows[1].Id);
        Assert.Null(rows[1].StatusCode);
    }

    [Fact]
    public void Stats_parse_reads_maps_and_numbers()
    {
        using var doc = JsonDocument.Parse(
            "{\"total_calls\":10,\"by_service\":{\"a\":3,\"b\":7},\"error_rate\":2.5,\"error_count\":1,\"avg_duration_ms\":12.3,\"last_24h\":4}");
        var stats = ApiCallLogStats.FromJson(doc.RootElement);

        Assert.Equal(10, stats.TotalCalls);
        Assert.Equal(2, stats.ByService.Count);
        Assert.Equal(7, stats.ByService["b"]);
        Assert.Equal(2.5, stats.ErrorRate);
        Assert.Equal(4, stats.Last24h);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeFeed(new ApiLogsSnapshot(SampleStats(), [SampleLog()], 60));
        using var vm = new ApiLogsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ApiLogsState.Success, vm.State);
        Assert.True(vm.Display.ShowRows);
        Assert.Single(vm.Display.Rows);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new ApiLogsPageViewModel(EmptyApiLogsFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ApiLogsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new ThrowingFeed();
        using var vm = new ApiLogsPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ApiLogsState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText);
    }

    [Fact]
    public async Task ViewModel_filter_resets_page_and_reloads()
    {
        var feed = new FakeFeed(new ApiLogsSnapshot(SampleStats(), [SampleLog()], 60));
        using var vm = new ApiLogsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        await vm.NextPageAsync();
        Assert.Equal(1, vm.Page);

        await vm.SetMethodAsync("GET");

        Assert.Equal(0, vm.Page); // changing a filter resets the page
        Assert.Equal("GET", feed.LastQuery!.Filter.Method);
        Assert.Equal(0, feed.LastQuery.Page);
    }

    [Fact]
    public async Task ViewModel_toggle_expanded_marks_the_row()
    {
        var feed = new FakeFeed(new ApiLogsSnapshot(SampleStats(), [SampleLog(7)], 1));
        using var vm = new ApiLogsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleExpanded(7);
        Assert.True(vm.Display.Rows.Single().IsExpanded);

        vm.ToggleExpanded(7);
        Assert.False(vm.Display.Rows.Single().IsExpanded);
    }

    [Fact]
    public async Task ViewModel_export_returns_current_page_json()
    {
        var feed = new FakeFeed(new ApiLogsSnapshot(SampleStats(), [SampleLog()], 1));
        using var vm = new ApiLogsPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        var json = vm.ExportJson();
        Assert.Contains("\"endpoint\": \"/api/1/vehicles/7/command\"", json);
        Assert.Equal("teslasync-api-logs-2026-06-06.json", vm.ExportFileName());
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new ApiLogsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ApiLogsPage", Assert.Single(lines));
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

    private sealed class FakeFeed : IApiLogsFeed
    {
        private readonly ApiLogsSnapshot _snapshot;

        public FakeFeed(ApiLogsSnapshot snapshot) => _snapshot = snapshot;

        public ApiLogsQuery? LastQuery { get; private set; }

        public Task<ApiLogsSnapshot> FetchAsync(ApiLogsQuery query, CancellationToken cancellationToken)
        {
            LastQuery = query;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IApiLogsFeed
    {
        public Task<ApiLogsSnapshot> FetchAsync(ApiLogsQuery query, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
