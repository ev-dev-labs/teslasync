using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SlowQueriesPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/SlowQueriesPage.tsx), the tolerant parsers, the cache-hit-ratio + number
/// formatting, the view-model's four-state matrix (loading / empty / error / success) plus the
/// pg_stat_statements-not-configured warning, and the generated-client feed's request shaping + envelope unwrap
/// (web <c>useSlowQueries</c> + <c>fetchEnvelope</c>). The WinUI view is exercised by the app build; its per-region
/// visibility is driven entirely by the <see cref="SlowQueriesDisplay"/> flags asserted here.
/// </summary>
public sealed class SlowQueriesPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 17 manifest parity string keys plus the four order-by option labels the page renders.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.slowQueries.colCache", "admin.slowQueries.colCalls", "admin.slowQueries.colFingerprint",
        "admin.slowQueries.colMax", "admin.slowQueries.colMean", "admin.slowQueries.colRows",
        "admin.slowQueries.colTotal", "admin.slowQueries.emptyMessage", "admin.slowQueries.emptyTable",
        "admin.slowQueries.emptyTitle", "admin.slowQueries.limit", "admin.slowQueries.notConfigured",
        "admin.slowQueries.orderBy", "admin.slowQueries.pageTitle", "admin.slowQueries.subtitle",
        "admin.slowQueries.tableTitle", "admin.subsystem.unavailableTitle",
        "admin.slowQueries.orderMean", "admin.slowQueries.orderTotal", "admin.slowQueries.orderCalls",
        "admin.slowQueries.orderMax",
    ];

    private static SlowQueryRow SampleRow(
        long queryId = 42,
        string fingerprint = "SELECT * FROM drives WHERE vehicle_id = $1",
        long calls = 1234,
        double totalMs = 98765.4,
        double meanMs = 12.34,
        double maxMs = 56.78,
        long rows = 4321,
        long? hit = 90,
        long? read = 10) =>
        new(queryId, fingerprint, calls, totalMs, meanMs, maxMs, rows, hit, read);

    private static SlowQueriesModel ModelWith(params SlowQueryRow[] rows) => SlowQueriesModel.Initial with
    {
        Loading = false,
        Rows = rows,
    };

    // ---- i18n key coverage (all manifest strings + order labels) -------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SlowQueriesProjection.Project(ModelWith(SampleRow()), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SlowQueriesProjection.Project(SlowQueriesModel.Initial, recorder);

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Title_and_subtitle_match_web()
    {
        var display = SlowQueriesProjection.Project(SlowQueriesModel.Initial, Localizer);

        Assert.Equal("Slow Queries", display.Title);
        Assert.StartsWith("Top queries from pg_stat_statements.", display.Subtitle);
        Assert.Equal("Top queries", display.TableTitle);
        Assert.Equal("Slow Queries", SlowQueriesRegistration.Title(Localizer));
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = SlowQueriesProjection.Project(SlowQueriesModel.Initial, Localizer);

        Assert.Equal(SlowQueriesState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.False(display.HasError);
        Assert.False(display.ShowSubsystemMissing);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var display = SlowQueriesProjection.Project(SlowQueriesModel.Initial with { Loading = false }, Localizer);

        Assert.Equal(SlowQueriesState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.Equal("No slow queries", display.EmptyTitle);
        Assert.StartsWith("pg_stat_statements is empty", display.EmptyMessage);
    }

    [Fact]
    public void State_error_shows_failure_with_detail()
    {
        var model = SlowQueriesModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = SlowQueriesProjection.Project(model, Localizer);

        Assert.Equal(SlowQueriesState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var display = SlowQueriesProjection.Project(ModelWith(SampleRow()), Localizer);

        Assert.Equal(SlowQueriesState.Success, display.State);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.Single(display.Rows);
    }

    // ---- Subsystem-missing warning (web error.status === 503) ----------------------

    [Fact]
    public void Subsystem_missing_shows_warning_and_empty_table_not_error_or_emptystate()
    {
        var model = SlowQueriesModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = SlowQueriesProjection.Project(model, Localizer);

        Assert.True(display.ShowSubsystemMissing);
        Assert.Equal("Subsystem unavailable", display.SubsystemUnavailableTitle);
        Assert.StartsWith("pg_stat_statements is not installed", display.NotConfiguredText);

        // Not an error, and NOT the big empty state — the table branch renders with its empty-table note.
        Assert.False(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.True(display.ShowTable);
        Assert.Empty(display.Rows);
        Assert.Equal("No slow queries", display.EmptyTableMessage);
        Assert.Equal(SlowQueriesState.Empty, display.State);
    }

    // ---- Filter controls -----------------------------------------------------------

    [Fact]
    public void OrderBy_options_match_web()
    {
        var display = SlowQueriesProjection.Project(SlowQueriesModel.Initial, Localizer);

        Assert.Equal(
            ["mean_time", "total_time", "calls", "max_time"],
            display.OrderByOptions.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Mean time", "Total time", "Calls", "Max time"],
            display.OrderByOptions.Select(o => o.Label).ToArray());
        Assert.Equal("mean_time", display.SelectedOrderBy);
        Assert.Equal("Order by", display.OrderByLabel);
    }

    [Fact]
    public void Limit_options_match_web()
    {
        var display = SlowQueriesProjection.Project(SlowQueriesModel.Initial, Localizer);

        Assert.Equal(["10", "25", "50", "100"], display.LimitOptions.Select(o => o.Value).ToArray());
        Assert.Equal(["10", "25", "50", "100"], display.LimitOptions.Select(o => o.Label).ToArray());
        Assert.Equal("25", display.SelectedLimit);
        Assert.Equal("Limit", display.LimitLabel);
    }

    [Fact]
    public void Column_headers_match_web()
    {
        var c = SlowQueriesProjection.Project(ModelWith(SampleRow()), Localizer).ColumnLabels;

        Assert.Equal("Query fingerprint", c.Fingerprint);
        Assert.Equal("Calls", c.Calls);
        Assert.Equal("Mean (ms)", c.Mean);
        Assert.Equal("Max (ms)", c.Max);
        Assert.Equal("Total (ms)", c.Total);
        Assert.Equal("Rows", c.Rows);
        Assert.Equal("Cache hit ratio", c.Cache);
    }

    // ---- Row projection + number formatting (web fmtNumber) ------------------------

    [Fact]
    public void Row_formats_every_cell_the_web_way()
    {
        var row = Assert.Single(SlowQueriesProjection.Project(ModelWith(SampleRow()), Localizer).Rows);

        Assert.Equal("42", row.Key);
        Assert.True(row.HasFingerprint);
        Assert.Equal("SELECT * FROM drives WHERE vehicle_id = $1", row.Fingerprint);
        Assert.Equal("SELECT * FROM drives WHERE vehicle_id = $1", row.FingerprintTooltip);
        Assert.Equal(Fmt(1234, 2), row.Calls);   // fmtNumber(calls) → global precision (2)
        Assert.Equal(Fmt(12.34, 2), row.Mean);    // fmtNumber(mean, 2)
        Assert.Equal(Fmt(56.78, 2), row.Max);     // fmtNumber(max, 2)
        Assert.Equal(Fmt(98765.4, 0), row.Total); // fmtNumber(total, 0)
        Assert.Equal(Fmt(4321, 2), row.Rows);     // fmtNumber(rows) → global precision (2)
        Assert.Equal("90.0%", row.Cache);         // 90 / (90 + 10) * 100 = 90.0
    }

    [Fact]
    public void Row_uses_em_dash_for_blank_fingerprint()
    {
        var row = Assert.Single(SlowQueriesProjection.Project(ModelWith(SampleRow(fingerprint: string.Empty)), Localizer).Rows);

        Assert.False(row.HasFingerprint);
        Assert.Equal(SlowQueriesProjection.EmDash, row.Fingerprint);
    }

    [Theory]
    [InlineData(90L, 10L, "90.0%")]
    [InlineData(3L, 1L, "75.0%")]
    [InlineData(0L, 0L, "\u2014")]      // no buffer accesses → em-dash
    [InlineData(null, null, "\u2014")] // both null → em-dash
    [InlineData(100L, 0L, "100.0%")]
    public void CacheHitRatio_matches_web(long? hit, long? read, string expected) =>
        Assert.Equal(expected, SlowQueriesProjection.CacheHitRatio(SampleRow(hit: hit, read: read)));

    // ---- Tolerant parsing ----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_envelope_and_rows()
    {
        var snapshot = SlowQueriesSnapshot.FromJson(Json(
            "{\"data\":{\"order_by\":\"total_time\",\"slow_queries\":[" +
            "{\"query_id\":7,\"fingerprint\":\"SELECT 1\",\"calls\":5,\"total_time_ms\":10.5,\"mean_time_ms\":2.1,\"max_time_ms\":3.3,\"rows_returned\":5,\"shared_blks_hit\":8,\"shared_blks_read\":2}]}}"));

        Assert.Equal("total_time", snapshot.OrderBy);
        Assert.False(snapshot.SubsystemMissing);
        var row = Assert.Single(snapshot.Rows);
        Assert.Equal(7, row.QueryId);
        Assert.Equal("SELECT 1", row.Fingerprint);
        Assert.Equal(5, row.Calls);
        Assert.Equal(8, row.SharedBlksHit);
        Assert.Equal(2, row.SharedBlksRead);
    }

    [Fact]
    public void Snapshot_parses_unwrapped_body_and_tolerates_missing_fields()
    {
        var snapshot = SlowQueriesSnapshot.FromJson(Json(
            "{\"slow_queries\":[{\"query_id\":1}]}"));

        var row = Assert.Single(snapshot.Rows);
        Assert.Equal(1, row.QueryId);
        Assert.Equal(string.Empty, row.Fingerprint);
        Assert.Equal(0, row.Calls);
        Assert.Null(row.SharedBlksHit);
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new SlowQueriesPageViewModel(EmptySlowQueriesFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SlowQueriesState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new SlowQueriesPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(SlowQueriesState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText);
    }

    [Fact]
    public async Task ViewModel_rows_snapshot_is_the_success_state()
    {
        var feed = new FakeFeed(new SlowQueriesSnapshot("mean_time", [SampleRow()], false));
        using var vm = new SlowQueriesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SlowQueriesState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_subsystem_missing_surfaces_the_warning_banner()
    {
        var feed = new FakeFeed(SlowQueriesSnapshot.NotConfigured);
        using var vm = new SlowQueriesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowSubsystemMissing);
        Assert.False(vm.Display.HasError);
        Assert.False(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_set_order_by_reloads_with_new_key()
    {
        var feed = new FakeFeed(new SlowQueriesSnapshot("mean_time", [SampleRow()], false));
        using var vm = new SlowQueriesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SetOrderByAsync("total_time");

        Assert.Equal("total_time", vm.OrderBy);
        Assert.Equal("total_time", feed.LastQuery!.OrderBy);
        Assert.Equal(2, feed.FetchCount); // initial load + reorder
    }

    [Fact]
    public async Task ViewModel_set_limit_reloads_with_new_limit()
    {
        var feed = new FakeFeed(new SlowQueriesSnapshot("mean_time", [SampleRow()], false));
        using var vm = new SlowQueriesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SetLimitAsync(100);

        Assert.Equal(100, vm.Limit);
        Assert.Equal(100, feed.LastQuery!.Limit);
    }

    [Fact]
    public async Task ViewModel_set_same_order_by_does_not_reload()
    {
        var feed = new FakeFeed(new SlowQueriesSnapshot("mean_time", [SampleRow()], false));
        using var vm = new SlowQueriesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.SetOrderByAsync("mean_time"); // unchanged

        Assert.Equal(1, feed.FetchCount);
    }

    // ---- Generated-client feed (web useSlowQueries) --------------------------------

    [Fact]
    public async Task ClientFeed_sends_snake_case_query_and_parses_envelope()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":{\"order_by\":\"calls\",\"slow_queries\":[{\"query_id\":9,\"calls\":3}]}}"));
        var feed = new SlowQueriesClientFeed(api);

        var snapshot = await feed.FetchAsync(new SlowQueriesQuery("calls", 50), default);

        Assert.Equal("calls", snapshot.OrderBy);
        Assert.Equal(9, Assert.Single(snapshot.Rows).QueryId);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_observability_slow_queries", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("calls", request.Query!["order_by"]);
        Assert.Equal(50, request.Query["limit"]);
    }

    [Fact]
    public async Task ClientFeed_maps_503_to_subsystem_missing()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("pg_stat_statements missing", 503, null, "SUBSYSTEM_NOT_CONFIGURED"));
        var feed = new SlowQueriesClientFeed(api);

        var snapshot = await feed.FetchAsync(new SlowQueriesQuery("mean_time", 25), default);

        Assert.True(snapshot.SubsystemMissing);
        Assert.Empty(snapshot.Rows);
    }

    [Fact]
    public async Task ClientFeed_propagates_non_503_failures()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SlowQueriesClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(new SlowQueriesQuery("mean_time", 25), default));
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SlowQueriesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SlowQueriesPage", Assert.Single(lines));
    }

    private static string Fmt(double value, int digits) => NumberFormatting.Format(value, null, digits);

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

    private sealed class FakeFeed : ISlowQueriesFeed
    {
        private readonly SlowQueriesSnapshot _snapshot;

        public FakeFeed(SlowQueriesSnapshot snapshot) => _snapshot = snapshot;

        public SlowQueriesQuery? LastQuery { get; private set; }

        public int FetchCount { get; private set; }

        public Task<SlowQueriesSnapshot> FetchAsync(SlowQueriesQuery query, CancellationToken cancellationToken)
        {
            LastQuery = query;
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : ISlowQueriesFeed
    {
        public Task<SlowQueriesSnapshot> FetchAsync(SlowQueriesQuery query, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("feed failed");
    }
}
