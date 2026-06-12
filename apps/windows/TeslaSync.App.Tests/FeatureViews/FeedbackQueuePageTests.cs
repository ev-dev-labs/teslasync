using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FeedbackQueuePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/FeedbackQueuePage.tsx), the category/status badge maps, the tolerant parsers, the
/// view-model's four-state matrix (loading / empty / error / success) and inline update/reload flow, and the
/// generated-client feed's request shaping (web <c>useFeedbackList</c> + <c>useUpdateFeedback</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the <see cref="FeedbackQueueDisplay"/>
/// flags asserted here.
/// </summary>
public sealed class FeedbackQueuePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 38 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "common.next", "common.previous", "common.refresh",
        "feedback.category.bug", "feedback.category.feature", "feedback.category.other",
        "feedback.queue.action.changeStatus", "feedback.queue.action.forward", "feedback.queue.action.githubUrl",
        "feedback.queue.action.saveUrl", "feedback.queue.bridgeDisabled", "feedback.queue.col.category",
        "feedback.queue.col.created", "feedback.queue.col.github", "feedback.queue.col.pageRoute",
        "feedback.queue.col.reporter", "feedback.queue.col.status", "feedback.queue.col.title",
        "feedback.queue.empty", "feedback.queue.emptyMessage", "feedback.queue.expand.appVersion",
        "feedback.queue.expand.body", "feedback.queue.expand.consoleTail", "feedback.queue.expand.recentErrors",
        "feedback.queue.expand.submitter", "feedback.queue.expand.userAgent", "feedback.queue.expand.userEmail",
        "feedback.queue.filter.allCategories", "feedback.queue.filter.allStatuses", "feedback.queue.filter.category",
        "feedback.queue.filter.status", "feedback.queue.maskedEmail", "feedback.queue.openIssue",
        "feedback.queue.pageOf", "feedback.queue.status.closed", "feedback.queue.status.new",
        "feedback.queue.status.triaged", "feedback.queue.title",
    ];

    private static FeedbackEntry SampleEntry(
        long id = 1,
        string category = "bug",
        string status = "new",
        string email = "alice@example.com",
        string github = "",
        string? recentErrors = "[{\"message\":\"boom\"}]") => new(
        Id: id,
        CreatedAt: "2026-06-06T11:30:00Z",
        Category: category,
        Title: "App crashes on launch",
        Body: "Steps to reproduce: open the app.",
        PageRoute: "/dashboard",
        UserAgent: "Mozilla/5.0",
        AppVersion: "1.2.3",
        UserEmail: email,
        RecentErrorsJson: recentErrors,
        ConsoleTail: "warn: low memory",
        Status: status,
        GithubIssueUrl: github,
        SubmitterSubject: "user-7",
        SubmitterIp: "203.0.113.5",
        TriagedAt: null,
        TriagedBy: string.Empty);

    private static FeedbackQueueModel RichModel(bool bridgeEnabled = true) => new(
        Items: [SampleEntry()],
        Total: 60,
        GithubBridgeEnabled: bridgeEnabled,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        Filter: new FeedbackFilter("new", "bug"),
        Page: 1,
        Limit: 25,
        ExpandedId: 1);

    // ---- i18n key coverage (all 38 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = FeedbackQueueProjection.Project(RichModel(), recorder, Now);
        _ = FeedbackQueueProjection.DetailLabels(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = FeedbackQueueProjection.Project(FeedbackQueueModel.Initial, recorder, Now);
        _ = FeedbackQueueProjection.DetailLabels(recorder);

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
        var display = FeedbackQueueProjection.Project(FeedbackQueueModel.Initial, Localizer, Now);

        Assert.Equal(FeedbackQueueState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.HasError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var model = FeedbackQueueModel.Initial with { Loading = false };
        var display = FeedbackQueueProjection.Project(model, Localizer, Now);

        Assert.Equal(FeedbackQueueState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowPagination);
        Assert.Equal("No feedback yet", display.EmptyTitle);
        Assert.Equal("User-submitted bug reports and feature requests will appear here.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_shows_query_error_with_detail()
    {
        var model = FeedbackQueueModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = FeedbackQueueProjection.Project(model, Localizer, Now);

        Assert.Equal(FeedbackQueueState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var model = FeedbackQueueModel.Initial with { Loading = false, Items = [SampleEntry()], Total = 1 };
        var display = FeedbackQueueProjection.Project(model, Localizer, Now);

        Assert.Equal(FeedbackQueueState.Success, display.State);
        Assert.True(display.ShowRows);
        Assert.True(display.ShowPagination);
        Assert.Single(display.Rows);
    }

    // ---- Panel: filters ------------------------------------------------------------

    [Fact]
    public void Filter_options_match_web_with_all_heads()
    {
        var display = FeedbackQueueProjection.Project(FeedbackQueueModel.Initial, Localizer, Now);

        Assert.Equal(["", "new", "triaged", "closed"], display.StatusFilterOptions.Select(o => o.Value).ToArray());
        Assert.Equal("All statuses", display.StatusFilterOptions[0].Label);
        Assert.Equal("New", display.StatusFilterOptions[1].Label);

        Assert.Equal(["", "bug", "feature", "other"], display.CategoryFilterOptions.Select(o => o.Value).ToArray());
        Assert.Equal("All categories", display.CategoryFilterOptions[0].Label);
        Assert.Equal("Bug report", display.CategoryFilterOptions[1].Label);

        Assert.Equal("Status", display.StatusFilterLabel);
        Assert.Equal("Category", display.CategoryFilterLabel);
        Assert.Equal("Refresh", display.RefreshLabel);
    }

    [Fact]
    public void Bridge_disabled_note_shows_only_when_bridge_off()
    {
        var off = FeedbackQueueProjection.Project(FeedbackQueueModel.Initial, Localizer, Now);
        Assert.True(off.ShowBridgeDisabled);
        Assert.StartsWith("GitHub Issues bridge is not configured", off.BridgeDisabledText);

        var on = FeedbackQueueProjection.Project(FeedbackQueueModel.Initial with { GithubBridgeEnabled = true }, Localizer, Now);
        Assert.False(on.ShowBridgeDisabled);
    }

    [Fact]
    public void Column_headers_match_web()
    {
        var display = FeedbackQueueProjection.Project(RichModel(), Localizer, Now);
        var c = display.ColumnLabels;

        Assert.Equal("Created", c.Created);
        Assert.Equal("Category", c.Category);
        Assert.Equal("Title", c.Title);
        Assert.Equal("Page", c.PageRoute);
        Assert.Equal("Reporter", c.Reporter);
        Assert.Equal("Status", c.Status);
        Assert.Equal("GitHub", c.Github);
    }

    // ---- Panel: rows + expanded detail ---------------------------------------------

    [Fact]
    public void Row_projects_cells_and_detail_blocks()
    {
        var display = FeedbackQueueProjection.Project(RichModel(), Localizer, Now);
        var row = Assert.Single(display.Rows);

        var expectedTs = DateTimeFormatting.Format(
            DateTimeOffset.Parse("2026-06-06T11:30:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            DateTimeVariant.Full,
            Now);
        Assert.Equal(expectedTs, row.Created);
        Assert.Equal("Bug report", row.CategoryLabel);
        Assert.Equal(StatusKind.Danger, row.CategoryVariant);
        Assert.Equal("App crashes on launch", row.Title);
        Assert.Equal("/dashboard", row.PageRoute);
        Assert.True(row.HasPageRoute);
        Assert.Equal("alice@example.com", row.ReporterName);
        Assert.Equal("user-7", row.ReporterSecondary);
        Assert.Equal("New", row.StatusLabel);
        Assert.Equal(StatusKind.Warning, row.StatusVariant);
        Assert.False(row.HasGithubUrl);
        Assert.Equal("Open issue", row.OpenIssueLabel);
        Assert.True(row.IsExpanded);

        // expanded detail
        Assert.Equal("Steps to reproduce: open the app.", row.Body);
        Assert.Equal("1.2.3", row.AppVersion);
        Assert.Equal("Mozilla/5.0", row.UserAgent);
        Assert.Equal("user-7", row.Submitter);
        Assert.True(row.HasUserEmail);
        Assert.Equal("alice@example.com", row.UserEmail);
        Assert.True(row.HasRecentErrors);
        Assert.Contains("\"message\"", row.RecentErrorsJson);
        Assert.True(row.HasConsoleTail);
        Assert.Equal("new", row.CurrentStatus);
        Assert.True(row.ShowForward); // bridge enabled && no github url
    }

    [Fact]
    public void Row_forward_hidden_when_github_url_present_or_bridge_off()
    {
        var withUrl = FeedbackQueueProjection.Project(
            RichModel() with { Items = [SampleEntry(github: "https://github.com/o/r/issues/1")] },
            Localizer,
            Now);
        Assert.False(Assert.Single(withUrl.Rows).ShowForward);
        Assert.True(Assert.Single(withUrl.Rows).HasGithubUrl);

        var bridgeOff = FeedbackQueueProjection.Project(RichModel(bridgeEnabled: false), Localizer, Now);
        Assert.False(Assert.Single(bridgeOff.Rows).ShowForward);
    }

    [Fact]
    public void Row_uses_em_dash_for_missing_optional_fields()
    {
        var entry = SampleEntry() with { PageRoute = string.Empty, Title = string.Empty, UserEmail = string.Empty, RecentErrorsJson = null, ConsoleTail = string.Empty };
        var model = FeedbackQueueModel.Initial with { Loading = false, Items = [entry], Total = 1 };
        var row = Assert.Single(FeedbackQueueProjection.Project(model, Localizer, Now).Rows);

        Assert.False(row.HasPageRoute);
        Assert.Equal(FeedbackQueueProjection.EmDash, row.PageRoute);
        Assert.Equal(FeedbackQueueProjection.EmDash, row.Title);
        Assert.False(row.HasUserEmail);
        Assert.False(row.HasRecentErrors);
        Assert.False(row.HasConsoleTail);
        // No e-mail → the submitter subject becomes the primary reporter identity.
        Assert.Equal("user-7", row.ReporterName);
        Assert.Equal(string.Empty, row.ReporterSecondary);
    }

    [Fact]
    public void Detail_labels_and_status_options_match_web()
    {
        var labels = FeedbackQueueProjection.DetailLabels(Localizer);

        Assert.Equal("Report body", labels.Body);
        Assert.Equal("App version", labels.AppVersion);
        Assert.Equal("User agent", labels.UserAgent);
        Assert.Equal("Submitter", labels.Submitter);
        Assert.Equal("Email", labels.UserEmail);
        Assert.Equal("Recent frontend errors", labels.RecentErrors);
        Assert.Equal("Console tail", labels.ConsoleTail);
        Assert.Equal("Status", labels.ChangeStatus);
        Assert.Equal("GitHub issue URL", labels.GithubUrl);
        Assert.Equal("Save URL", labels.SaveUrl);
        Assert.Equal("Forward to GitHub", labels.Forward);
        Assert.Equal("Reporter email, click to reveal", labels.MaskedEmail);
        Assert.Equal(["new", "triaged", "closed"], labels.StatusOptions.Select(o => o.Value).ToArray());
    }

    // ---- Badge mappings ------------------------------------------------------------

    [Theory]
    [InlineData("bug", StatusKind.Danger)]
    [InlineData("feature", StatusKind.Info)]
    [InlineData("other", StatusKind.Neutral)]
    [InlineData("unknown", StatusKind.Neutral)]
    public void CategoryBadge_matches_web(string category, StatusKind expected) =>
        Assert.Equal(expected, FeedbackBadges.Category(category));

    [Theory]
    [InlineData("new", StatusKind.Warning)]
    [InlineData("triaged", StatusKind.Success)]
    [InlineData("closed", StatusKind.Neutral)]
    [InlineData("unknown", StatusKind.Neutral)]
    public void StatusBadge_matches_web(string status, StatusKind expected) =>
        Assert.Equal(expected, FeedbackBadges.Status(status));

    // ---- Pagination ----------------------------------------------------------------

    [Fact]
    public void Pagination_math_matches_web()
    {
        var model = FeedbackQueueModel.Initial with { Loading = false, Items = [SampleEntry()], Total = 60, Page = 1 };
        var display = FeedbackQueueProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowPagination);        // rows present → pagination shown
        Assert.Equal("Page 2 of 3 (60 entries)", display.PageOfText);
        Assert.True(display.CanGoPrevious);
        Assert.True(display.CanGoNext);

        var lastPage = FeedbackQueueProjection.Project(model with { Page = 2 }, Localizer, Now);
        Assert.False(lastPage.CanGoNext);
        Assert.True(lastPage.CanGoPrevious);

        var firstPage = FeedbackQueueProjection.Project(model with { Page = 0 }, Localizer, Now);
        Assert.False(firstPage.CanGoPrevious);
    }

    // ---- JSON pretty-print + tolerant parsing --------------------------------------

    [Fact]
    public void PrettyJson_indents_valid_json_and_passes_raw_through()
    {
        var pretty = FeedbackQueueProjection.PrettyJson("{\"a\":1}");
        Assert.Contains("\n", pretty);
        Assert.Contains("\"a\": 1", pretty);

        Assert.Equal("not json", FeedbackQueueProjection.PrettyJson("not json"));
    }

    [Fact]
    public void ParseList_is_tolerant_of_partial_and_non_array_input()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(FeedbackEntry.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("[{\"id\":5,\"category\":\"feature\"},{}]");
        var rows = FeedbackEntry.ParseList(partial.RootElement);
        Assert.Equal(2, rows.Count);
        Assert.Equal(5, rows[0].Id);
        Assert.Equal("feature", rows[0].Category);
        Assert.Equal(0, rows[1].Id);
        Assert.Null(rows[1].RecentErrorsJson);
    }

    [Fact]
    public void Snapshot_parse_reads_items_total_and_bridge_flags()
    {
        using var doc = JsonDocument.Parse(
            "{\"items\":[{\"id\":1,\"recent_errors\":[{\"e\":1}]}],\"total\":42,\"github_bridge_enabled\":true,\"github_repo\":\"o/r\"}");
        var snapshot = FeedbackListSnapshot.FromJson(doc.RootElement);

        Assert.Single(snapshot.Items);
        Assert.Equal(42, snapshot.Total);
        Assert.True(snapshot.GithubBridgeEnabled);
        Assert.Equal("o/r", snapshot.GithubRepo);
        Assert.NotNull(snapshot.Items[0].RecentErrorsJson); // captured the raw blob
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeFeed(new FeedbackListSnapshot([SampleEntry()], 60, true, "o/r"));
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(FeedbackQueueState.Success, vm.State);
        Assert.True(vm.Display.ShowRows);
        Assert.Single(vm.Display.Rows);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new FeedbackQueuePageViewModel(EmptyFeedbackQueueFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(FeedbackQueueState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new ThrowingFeed();
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(FeedbackQueueState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText);
    }

    [Fact]
    public async Task ViewModel_filter_resets_page_and_reloads()
    {
        var feed = new FakeFeed(new FeedbackListSnapshot([SampleEntry()], 60, true, "o/r"));
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        await vm.NextPageAsync();
        Assert.Equal(1, vm.Page);

        await vm.SetStatusFilterAsync("triaged");

        Assert.Equal(0, vm.Page); // changing a filter resets the page
        Assert.Equal("triaged", feed.LastQuery!.Filter.Status);
        Assert.Equal(0, feed.LastQuery.Page);
    }

    [Fact]
    public async Task ViewModel_toggle_expanded_marks_the_row()
    {
        var feed = new FakeFeed(new FeedbackListSnapshot([SampleEntry(7)], 1, true, "o/r"));
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleExpanded(7);
        Assert.True(vm.Display.Rows.Single().IsExpanded);

        vm.ToggleExpanded(7);
        Assert.False(vm.Display.Rows.Single().IsExpanded);
    }

    [Fact]
    public async Task ViewModel_update_status_writes_then_reloads()
    {
        var feed = new FakeFeed(new FeedbackListSnapshot([SampleEntry(3)], 1, true, "o/r"));
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.UpdateStatusAsync(3, "triaged");

        Assert.Equal((3L, "triaged"), (feed.LastUpdateId, feed.LastUpdate!.Status));
        Assert.Equal(2, feed.FetchCount); // initial load + reload after update
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_forward_and_save_url_send_the_right_payloads()
    {
        var feed = new FakeFeed(new FeedbackListSnapshot([SampleEntry(9)], 1, true, "o/r"));
        using var vm = new FeedbackQueuePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SaveGithubUrlAsync(9, "https://github.com/o/r/issues/9");
        Assert.Equal("https://github.com/o/r/issues/9", feed.LastUpdate!.GithubIssueUrl);

        await vm.ForwardToGithubAsync(9);
        Assert.True(feed.LastUpdate!.ForwardToGithub);
    }

    // ---- Generated-client feed (web useFeedbackList + useUpdateFeedback) ------------

    [Fact]
    public async Task ClientFeed_list_sends_snake_case_query_and_parses_snapshot()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"items\":[{\"id\":1}],\"total\":7,\"github_bridge_enabled\":true}"));
        var feed = new FeedbackQueueClientFeed(api);

        var snapshot = await feed.FetchAsync(new FeedbackQueueQuery(new FeedbackFilter("new", "bug"), 2, 25), default);

        Assert.Equal(7, snapshot.Total);
        Assert.True(snapshot.GithubBridgeEnabled);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_feedback", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("new", request.Query!["status"]);
        Assert.Equal("bug", request.Query["category"]);
        Assert.Equal(25, request.Query["limit"]);
        Assert.Equal(50, request.Query["offset"]); // page 2 * 25
    }

    [Fact]
    public async Task ClientFeed_list_omits_unset_filters()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"items\":[],\"total\":0}"));
        var feed = new FeedbackQueueClientFeed(api);

        await feed.FetchAsync(new FeedbackQueueQuery(FeedbackFilter.Empty, 0, 25), default);

        var request = Assert.Single(api.Requests);
        Assert.NotNull(request.Query);
        Assert.False(request.Query!.ContainsKey("status"));
        Assert.False(request.Query.ContainsKey("category"));
        Assert.Equal(0, request.Query["offset"]);
    }

    [Fact]
    public async Task ClientFeed_update_patches_by_id_with_touched_fields_only()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new FeedbackQueueClientFeed(api);

        await feed.UpdateAsync(42, new FeedbackUpdate(Status: "closed"), default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("patch_api_v1_admin_feedback_id", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("42", request.PathParams!["id"]);

        var body = Assert.IsType<Dictionary<string, object?>>(request.Body);
        Assert.Equal("closed", body["status"]);
        Assert.False(body.ContainsKey("github_issue_url"));
        Assert.False(body.ContainsKey("forward_to_github"));
    }

    [Fact]
    public async Task ClientFeed_update_forward_sends_boolean_flag()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new FeedbackQueueClientFeed(api);

        await feed.UpdateAsync(5, new FeedbackUpdate(ForwardToGithub: true), default);

        var body = Assert.IsType<Dictionary<string, object?>>(Assert.Single(api.Requests).Body);
        Assert.Equal(true, body["forward_to_github"]);
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new FeedbackQueueDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FeedbackQueuePage", Assert.Single(lines));
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

    private sealed class FakeFeed : IFeedbackQueueFeed
    {
        private readonly FeedbackListSnapshot _snapshot;

        public FakeFeed(FeedbackListSnapshot snapshot) => _snapshot = snapshot;

        public FeedbackQueueQuery? LastQuery { get; private set; }

        public long LastUpdateId { get; private set; }

        public FeedbackUpdate? LastUpdate { get; private set; }

        public int FetchCount { get; private set; }

        public Task<FeedbackListSnapshot> FetchAsync(FeedbackQueueQuery query, CancellationToken cancellationToken)
        {
            LastQuery = query;
            FetchCount++;
            return Task.FromResult(_snapshot);
        }

        public Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken)
        {
            LastUpdateId = id;
            LastUpdate = update;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingFeed : IFeedbackQueueFeed
    {
        public Task<FeedbackListSnapshot> FetchAsync(FeedbackQueueQuery query, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }
}
