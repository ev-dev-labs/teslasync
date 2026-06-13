using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AuditLogPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/AuditLogPage.tsx), the tolerant parsers, the hash-chain verify sub-state, the
/// generated-client feed's request shaping (web <c>useAuditLog</c> / <c>useAuditCategories</c> /
/// <c>useAuditActions</c> / <c>useAuditChainVerify</c>) and the view-model's four-state matrix
/// (loading / empty / error / success) with the distinct HTTP-503 subsystem-unavailable branch (web
/// <c>subsystemMissing</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="AuditLogDisplay"/> flags asserted here.
/// </summary>
public sealed class AuditLogPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The 50 i18n keys the manifest requires the page to resolve (49 admin.auditLog.* + admin.subsystem.unavailableTitle).
    private static readonly string[] RequiredStringKeys =
    [
        "admin.auditLog.actionLabel", "admin.auditLog.actorLabel", "admin.auditLog.actorPlaceholder",
        "admin.auditLog.allActions", "admin.auditLog.allCategories", "admin.auditLog.applyFilters",
        "admin.auditLog.categoryLabel", "admin.auditLog.chainBroken", "admin.auditLog.chainIntact",
        "admin.auditLog.colAction", "admin.auditLog.colActor", "admin.auditLog.colCategory",
        "admin.auditLog.colDetail", "admin.auditLog.colEntity", "admin.auditLog.colSuccess",
        "admin.auditLog.colTrace", "admin.auditLog.colTs", "admin.auditLog.detailAfter",
        "admin.auditLog.detailBefore", "admin.auditLog.detailHash", "admin.auditLog.detailIp",
        "admin.auditLog.detailTrace", "admin.auditLog.detailUa", "admin.auditLog.emptyMessage",
        "admin.auditLog.emptyTable", "admin.auditLog.emptyTitle", "admin.auditLog.entityTypeLabel",
        "admin.auditLog.entityTypePlaceholder", "admin.auditLog.filtersTitle", "admin.auditLog.firstBadId",
        "admin.auditLog.hideDetails", "admin.auditLog.integrityTitle", "admin.auditLog.limitLabel",
        "admin.auditLog.nextPage", "admin.auditLog.notConfigured", "admin.auditLog.pageInfo",
        "admin.auditLog.pageTitle", "admin.auditLog.prevPage", "admin.auditLog.resetFilters",
        "admin.auditLog.rowsChecked", "admin.auditLog.showDetails", "admin.auditLog.sinceLabel",
        "admin.auditLog.subtitle", "admin.auditLog.tableTitle", "admin.auditLog.untilLabel",
        "admin.auditLog.verifyButton", "admin.auditLog.verifyErrorTitle", "admin.auditLog.verifyHint",
        "admin.auditLog.verifying", "admin.subsystem.unavailableTitle",
    ];

    private static AuditLogRow SampleRow(long id = 5, bool? success = true) => new(
        Id: id,
        Ts: "2026-06-13T11:30:00Z",
        Actor: "admin@local",
        Category: "security",
        Action: "vehicle.command",
        EntityType: "vehicle",
        EntityId: 7,
        Detail: "wake_up",
        Ip: "10.0.0.4",
        UserAgent: "Mozilla/5.0",
        Before: "{\"locked\":true}",
        After: "{\"locked\":false}",
        TraceId: "abcdef0123456789",
        PrevRowHash: "prev",
        RowHash: "0badc0de",
        Success: success);

    private static AuditLogModel RichModel() => AuditLogModel.Initial with
    {
        Rows = [SampleRow()],
        Loading = false,
        Categories = ["security", "config"],
        Actions = ["vehicle.command", "login"],
        Filter = AuditLogFilter.Default with { Category = "security", Actor = "admin@local" },
        Offset = 0,
        Expanded = [5L],
        VerifyResult = new AuditChainVerify(false, 42, 1000, string.Empty, 1000),
    };

    // ── i18n key coverage (all 50 manifest strings) ──────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AuditLogProjection.Project(RichModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = AuditLogProjection.Project(AuditLogModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ─────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = AuditLogProjection.Project(AuditLogModel.Initial, Localizer, Now);

        Assert.Equal(AuditLogState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var model = AuditLogModel.Initial with { Loading = false };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.Equal(AuditLogState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    [Fact]
    public void State_error_shows_failure_surface_with_detail()
    {
        var model = AuditLogModel.Initial with { Loading = false, HasError = true, ErrorDetail = "boom" };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.Equal(AuditLogState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var model = AuditLogModel.Initial with { Loading = false, Rows = [SampleRow()] };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.Equal(AuditLogState.Success, display.State);
        Assert.True(display.ShowRows);
        Assert.Single(display.Rows);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_subsystem_missing_raises_the_503_banner_and_suppresses_empty()
    {
        var model = AuditLogModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal(AuditLogState.Empty, display.State);
    }

    // ── Row projection ───────────────────────────────────────────────────────────────

    [Fact]
    public void Row_projects_cells_badges_and_expanded_detail()
    {
        var model = AuditLogModel.Initial with { Loading = false, Rows = [SampleRow()], Expanded = [5L] };
        var display = AuditLogProjection.Project(model, Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.Equal("admin@local", row.Actor);
        Assert.True(row.ShowCategory);
        Assert.Equal("security", row.Category);
        Assert.Equal("vehicle.command", row.Action);
        Assert.True(row.ShowEntityId);
        Assert.Equal("#7", row.EntityId);
        Assert.True(row.ShowTrace);
        Assert.True(row.IsExpanded);
        Assert.Equal("OK", row.SuccessText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Success, row.SuccessVariant);
        Assert.True(row.Expanded.ShowBefore);
        Assert.True(row.Expanded.ShowAfter);
        Assert.True(row.Expanded.ShowHash);
        Assert.Equal("10.0.0.4", row.Expanded.IpValue);
    }

    [Fact]
    public void Row_renders_em_dash_for_absent_optionals()
    {
        var bare = SampleRow(success: null) with
        {
            Category = null,
            EntityId = null,
            Detail = null,
            TraceId = null,
            Ip = null,
        };
        var model = AuditLogModel.Initial with { Loading = false, Rows = [bare] };
        var display = AuditLogProjection.Project(model, Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.False(row.ShowCategory);
        Assert.False(row.ShowEntityId);
        Assert.False(row.ShowTrace);
        Assert.Equal("\u2014", row.Detail);
        Assert.Equal("\u2014", row.SuccessText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Neutral, row.SuccessVariant);
    }

    [Fact]
    public void Failed_row_uses_the_danger_success_badge()
    {
        var model = AuditLogModel.Initial with { Loading = false, Rows = [SampleRow(success: false)] };
        var display = AuditLogProjection.Project(model, Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.Equal("Fail", row.SuccessText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Danger, row.SuccessVariant);
    }

    // ── Hash-chain verify sub-state ──────────────────────────────────────────────────

    [Fact]
    public void Verify_hint_shows_before_any_result()
    {
        var display = AuditLogProjection.Project(AuditLogModel.Initial, Localizer, Now);

        Assert.True(display.ShowVerifyHint);
        Assert.False(display.ShowVerifyResult);
        Assert.False(display.ShowVerifyError);
    }

    [Fact]
    public void Verify_busy_swaps_the_button_label_and_disables_it()
    {
        var model = AuditLogModel.Initial with { VerifyLoading = true };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.VerifyBusy);
        Assert.True(display.VerifyDisabled);
        Assert.False(display.ShowVerifyHint);
        Assert.Equal("Verifying\u2026", display.VerifyButtonLabel);
    }

    [Fact]
    public void Verify_intact_result_shows_the_success_badge()
    {
        var model = AuditLogModel.Initial with { VerifyResult = new AuditChainVerify(true, 0, 1234, string.Empty, 1000) };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowVerifyResult);
        Assert.True(display.VerifyIntact);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Success, display.VerifyBadgeVariant);
        Assert.Contains("1,234", display.VerifyRowsCheckedText, StringComparison.Ordinal);
        Assert.False(display.ShowFirstBad);
    }

    [Fact]
    public void Verify_broken_result_surfaces_the_first_bad_row()
    {
        var model = AuditLogModel.Initial with { VerifyResult = new AuditChainVerify(false, 42, 99, string.Empty, 1000) };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.VerifyBadgeVariant == TeslaSync.App.Core.StatusKind.Danger);
        Assert.False(display.VerifyIntact);
        Assert.True(display.ShowFirstBad);
        Assert.Contains("42", display.FirstBadText, StringComparison.Ordinal);
    }

    [Fact]
    public void Verify_error_shows_the_failure_banner()
    {
        var model = AuditLogModel.Initial with { VerifyError = "timeout" };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowVerifyError);
        Assert.Equal("timeout", display.VerifyErrorText);
        Assert.False(display.ShowVerifyHint);
    }

    // ── Filter dropdown options ──────────────────────────────────────────────────────

    [Fact]
    public void Category_options_prepend_the_all_head()
    {
        var model = AuditLogModel.Initial with { Categories = ["security", "config"] };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.Equal(3, display.CategoryOptions.Count);
        Assert.Equal(string.Empty, display.CategoryOptions[0].Value);
        Assert.Equal("security", display.CategoryOptions[1].Value);
    }

    [Fact]
    public void Limit_options_match_the_web_catalog()
    {
        var display = AuditLogProjection.Project(AuditLogModel.Initial, Localizer, Now);

        Assert.Equal(new[] { "50", "100", "250", "500" }, display.LimitOptions.Select(o => o.Value).ToArray());
        Assert.Equal("100", display.SelectedLimit);
    }

    [Fact]
    public void Pagination_can_advance_only_when_a_full_page_returned()
    {
        var rows = Enumerable.Range(0, 100).Select(i => SampleRow(i)).ToArray();
        var model = AuditLogModel.Initial with { Loading = false, Rows = rows, Limit = 100, Offset = 100 };
        var display = AuditLogProjection.Project(model, Localizer, Now);

        Assert.True(display.CanGoPrevious);
        Assert.True(display.CanGoNext);
        Assert.Contains("101", display.PageInfoText, StringComparison.Ordinal);
        Assert.Contains("200", display.PageInfoText, StringComparison.Ordinal);
    }

    // ── Tolerant parsers ─────────────────────────────────────────────────────────────

    [Fact]
    public void AuditLogRow_parses_snake_case_and_tolerates_missing_fields()
    {
        var el = Parse("{\"id\":12,\"ts\":\"2026-06-13T00:00:00Z\",\"actor\":\"sys\",\"action\":\"x\",\"entity_type\":\"vehicle\",\"entity_id\":3,\"success\":false}");
        var row = AuditLogRow.FromJson(el);

        Assert.Equal(12, row.Id);
        Assert.Equal("sys", row.Actor);
        Assert.Equal(3, row.EntityId);
        Assert.False(row.Success);
        Assert.Null(row.Category);
        Assert.Null(row.TraceId);
    }

    [Fact]
    public void AuditLogRow_reads_before_after_as_string_or_embedded_object()
    {
        var asString = AuditLogRow.FromJson(Parse("{\"before\":\"{\\\"a\\\":1}\"}"));
        Assert.Equal("{\"a\":1}", asString.Before);

        var asObject = AuditLogRow.FromJson(Parse("{\"after\":{\"a\":1}}"));
        Assert.NotNull(asObject.After);
        Assert.Contains("\"a\"", asObject.After!, StringComparison.Ordinal);
    }

    [Fact]
    public void AuditChainVerify_parses_the_response()
    {
        var verify = AuditChainVerify.FromJson(Parse("{\"intact\":false,\"first_bad_id\":9,\"rows_checked\":250,\"limit\":1000}"));

        Assert.False(verify.Intact);
        Assert.Equal(9, verify.FirstBadId);
        Assert.Equal(250, verify.RowsChecked);
        Assert.Equal(1000, verify.Limit);
    }

    [Fact]
    public void AuditLogListSnapshot_parses_rows_and_limit()
    {
        var snapshot = AuditLogListSnapshot.FromJson(Parse("{\"rows\":[{\"id\":1,\"action\":\"a\"},{\"id\":2,\"action\":\"b\"}],\"limit\":100}"));

        Assert.True(snapshot.HasData);
        Assert.Equal(2, snapshot.Rows.Count);
        Assert.Equal(100, snapshot.Limit);
    }

    [Fact]
    public void Facet_parser_reads_string_arrays_and_drops_non_strings()
    {
        Assert.Equal(new[] { "a", "b" }, AuditLogJson.StrArray(Parse("{\"categories\":[\"a\",\"b\",null,3]}"), "categories").ToArray());
        Assert.Equal(new[] { "login" }, AuditLogJson.StrArray(Parse("{\"actions\":[\"login\"]}"), "actions").ToArray());
        Assert.Empty(AuditLogJson.StrArray(Parse("{}"), "categories"));
    }

    // ── Registration contract (hooks ↔ generated endpoint ids) ───────────────────────

    [Fact]
    public void Registration_operations_match_the_generated_endpoint_ids()
    {
        Assert.Equal("get_api_v1_admin_audit_log", AuditLogRegistration.ListOperation);
        Assert.Equal("get_api_v1_admin_audit_log_categories", AuditLogRegistration.CategoriesOperation);
        Assert.Equal("get_api_v1_admin_audit_log_actions", AuditLogRegistration.ActionsOperation);
        Assert.Equal("get_api_v1_admin_audit_log_verify", AuditLogRegistration.VerifyOperation);
        Assert.Equal("AuditLog", AuditLogRegistration.RouteName);
        Assert.Equal(1000, AuditLogRegistration.VerifyLimit);
    }

    // ── View-model four-state matrix ─────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeFeed { ListResult = new AuditLogListSnapshot(true, [SampleRow()], 100), Categories = ["security"], Actions = ["login"] };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Success, vm.State);
        Assert.Single(vm.Display.Rows);
        Assert.Equal(2, vm.Display.CategoryOptions.Count); // All + security
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        var feed = new FakeFeed { ListError = new ApiException("audit subsystem not configured", 503) };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.Equal(AuditLogState.Empty, vm.State);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_generic_failure_is_the_error_state()
    {
        var feed = new FakeFeed { ListError = new InvalidOperationException("network down") };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
    }

    [Fact]
    public async Task ViewModel_setting_a_filter_resets_the_page_offset()
    {
        var feed = new FakeFeed { ListResult = new AuditLogListSnapshot(true, FullPage(), 100) };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.NextPageAsync();
        Assert.Equal(100, feed.LastOffset);

        await vm.SetCategoryAsync("security");

        Assert.Equal(0, feed.LastOffset);
        Assert.Equal("security", feed.LastFilter!.Category);
    }

    [Fact]
    public async Task ViewModel_reset_clears_filters_but_keeps_page_size()
    {
        var feed = new FakeFeed { ListResult = new AuditLogListSnapshot(true, [SampleRow()], 250) };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SetLimitAsync("250");
        await vm.SetActorAsync("admin@local");
        await vm.ResetFiltersAsync();

        Assert.Equal(string.Empty, feed.LastFilter!.Actor);
        Assert.Equal(250, feed.LastFilter.Limit);
    }

    [Fact]
    public async Task ViewModel_verify_runs_independently_of_the_list()
    {
        var feed = new FakeFeed
        {
            ListResult = new AuditLogListSnapshot(true, [SampleRow()], 100),
            VerifyResult = new AuditChainVerify(false, 17, 1000, string.Empty, 1000),
        };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.VerifyChainAsync();

        Assert.Equal(1000, feed.LastVerifyLimit);
        Assert.True(vm.Display.ShowVerifyResult);
        Assert.False(vm.Display.VerifyIntact);
        Assert.True(vm.Display.ShowFirstBad);
        Assert.Equal(AuditLogState.Success, vm.State); // list state unaffected
    }

    [Fact]
    public async Task ViewModel_toggle_expanded_reprojects_without_a_reload()
    {
        var feed = new FakeFeed { ListResult = new AuditLogListSnapshot(true, [SampleRow(5)], 100) };
        using var vm = new AuditLogPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        int loadsBefore = feed.ListCalls;
        vm.ToggleExpanded(5);

        Assert.True(vm.Display.Rows.Single(r => r.Id == 5).IsExpanded);
        Assert.Equal(loadsBefore, feed.ListCalls);
    }

    private static AuditLogRow[] FullPage() => Enumerable.Range(0, 100).Select(i => SampleRow(i)).ToArray();

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IAuditLogFeed
    {
        public AuditLogListSnapshot ListResult { get; init; } = AuditLogListSnapshot.Empty;
        public Exception? ListError { get; init; }
        public IReadOnlyList<string> Categories { get; init; } = Array.Empty<string>();
        public IReadOnlyList<string> Actions { get; init; } = Array.Empty<string>();
        public AuditChainVerify VerifyResult { get; init; } = new(true, 0, 0, string.Empty, 1000);

        public AuditLogFilter? LastFilter { get; private set; }
        public int LastOffset { get; private set; }
        public int LastVerifyLimit { get; private set; }
        public int ListCalls { get; private set; }

        public Task<AuditLogListSnapshot> FetchLogAsync(AuditLogFilter filter, int offset, CancellationToken cancellationToken)
        {
            LastFilter = filter;
            LastOffset = offset;
            ListCalls++;
            return ListError is not null
                ? Task.FromException<AuditLogListSnapshot>(ListError)
                : Task.FromResult(ListResult);
        }

        public Task<IReadOnlyList<string>> FetchCategoriesAsync(CancellationToken cancellationToken) => Task.FromResult(Categories);

        public Task<IReadOnlyList<string>> FetchActionsAsync(CancellationToken cancellationToken) => Task.FromResult(Actions);

        public Task<AuditChainVerify> VerifyChainAsync(int limit, CancellationToken cancellationToken)
        {
            LastVerifyLimit = limit;
            return Task.FromResult(VerifyResult);
        }
    }
}
