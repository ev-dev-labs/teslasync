using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AutomationListPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/automations/pages/AutomationListPage.tsx), the tolerant parsers (the bare-array + platform
/// <c>{data:…}</c> envelope list, the bulk result), the view-model's four-state matrix (loading / empty / error /
/// success) plus the bulk-selection + bulk-operation flow (web <c>useBulkSelection</c> + <c>useBulkAutomationsUpdate</c>),
/// and the generated-client feed's request shaping (web <c>useAutomations</c> GET + <c>POST /automations/bulk</c>). The
/// WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="AutomationListDisplay"/> flags asserted here.
/// </summary>
public sealed class AutomationListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 22 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "automationList.bulk.delete", "automationList.bulk.deleteConfirm.body", "automationList.bulk.deleteConfirm.title",
        "automationList.bulk.disable", "automationList.bulk.enable", "automationList.col.desc", "automationList.col.name",
        "automationList.col.runs", "automationList.col.status", "automationList.empty.body", "automationList.empty.cta",
        "automationList.empty.title", "automationList.noun.one", "automationList.noun.other",
        "automationList.selectAutomation", "automationList.subtitle", "automationList.title", "bulk.selectAll",
        "bulk.selectRow", "common.delete", "common.disabled", "common.enabled",
    ];

    private static AutomationRow Row(
        long id = 1,
        string name = "Charge at home",
        string? description = "Sets the limit to 80%",
        long runs = 5,
        bool enabled = true) =>
        new(id, name, description, runs, enabled);

    private static AutomationListModel Model(
        IReadOnlyList<AutomationRow>? automations = null,
        IReadOnlySet<long>? selected = null,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null,
        bool bulkBusy = false) =>
        new(
            Automations: automations ?? [Row()],
            SelectedIds: selected ?? new HashSet<long>(),
            Loading: loading,
            HasError: hasError,
            ErrorDetail: errorDetail,
            BulkBusy: bulkBusy);

    // ---- i18n key coverage (all 22 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AutomationListProjection.Project(Model(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (column headers, status labels, the select template, the bulk-action labels) resolve on every
        // projection regardless of data state; visibility is gated separately.
        _ = AutomationListProjection.Project(AutomationListModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = AutomationListProjection.Project(AutomationListModel.Initial, Localizer);

        Assert.Equal(AutomationListState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowTable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_automations()
    {
        var display = AutomationListProjection.Project(Model(automations: []), Localizer);

        Assert.Equal(AutomationListState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowTable);
        Assert.Equal("No automations yet", display.EmptyTitle);
        Assert.Equal("Create your first automation in the builder.", display.EmptyMessage);
        Assert.Equal("Open builder", display.EmptyCtaLabel);
    }

    [Fact]
    public void State_error_shows_failure_and_retry()
    {
        var display = AutomationListProjection.Project(
            Model(automations: [], loading: false, hasError: true, errorDetail: "network down"),
            Localizer);

        Assert.Equal(AutomationListState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_automations_present()
    {
        var display = AutomationListProjection.Project(Model(), Localizer);

        Assert.Equal(AutomationListState.Success, display.State);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Panel (GlassPanel1) — table chrome + rows ---------------------------------

    [Fact]
    public void Table_projects_the_four_column_headers_and_select_labels()
    {
        var display = AutomationListProjection.Project(Model(), Localizer);

        Assert.Equal("Name", display.NameHeader);
        Assert.Equal("Description", display.DescriptionHeader);
        Assert.Equal("Runs", display.RunsHeader);
        Assert.Equal("Status", display.StatusHeader);
        Assert.Equal("Select all", display.SelectAllLabel);
        Assert.Equal("Select row", display.SelectRowLabel);
    }

    [Fact]
    public void Table_row_formats_every_cell_for_an_enabled_automation()
    {
        var row = Row(id: 7, name: "Precondition", description: "Warms the cabin", runs: 1234, enabled: true);
        var display = AutomationListProjection.Project(Model(automations: [row]), Localizer);

        var projected = Assert.Single(display.Rows);
        Assert.Equal(7, projected.Id);
        Assert.Equal("Precondition", projected.Name);
        Assert.Equal("Warms the cabin", projected.Description);
        Assert.Equal("1234", projected.Runs); // plain number, no grouping (matches web {a.execution_count})
        Assert.True(projected.Enabled);
        Assert.Equal("Enabled", projected.StatusLabel);
        Assert.Equal(StatusKind.Success, projected.StatusKind);
        Assert.Equal("Select automation Precondition", projected.SelectLabel);
    }

    [Fact]
    public void Table_row_uses_em_dash_for_missing_description_and_neutral_disabled_chip()
    {
        var row = Row(id: 9, name: "Idle alert", description: null, runs: 0, enabled: false);
        var display = AutomationListProjection.Project(Model(automations: [row]), Localizer);

        var projected = Assert.Single(display.Rows);
        Assert.Equal("\u2014", projected.Description);
        Assert.Equal("0", projected.Runs);
        Assert.False(projected.Enabled);
        Assert.Equal("Disabled", projected.StatusLabel);
        Assert.Equal(StatusKind.Neutral, projected.StatusKind);
    }

    // ---- Bulk-action toolbar -------------------------------------------------------

    [Fact]
    public void Bulk_bar_is_hidden_when_nothing_is_selected()
    {
        var display = AutomationListProjection.Project(Model(), Localizer);

        Assert.False(display.ShowBulkBar);
        Assert.Equal(0, display.SelectedCount);
    }

    [Fact]
    public void Bulk_bar_projects_count_noun_and_three_actions_when_selected()
    {
        var rows = new[] { Row(1), Row(2, name: "Second") };
        var display = AutomationListProjection.Project(Model(automations: rows, selected: new HashSet<long> { 1 }), Localizer);

        Assert.True(display.ShowBulkBar);
        Assert.Equal(1, display.SelectedCount);
        Assert.Equal("automation", display.ItemNoun); // singular noun for one selection
        Assert.Equal("Clear selection", display.ClearLabel);

        Assert.Collection(
            display.Actions,
            a => AssertAction(a, AutomationBulkOp.Enable, "Enable", danger: false),
            a => AssertAction(a, AutomationBulkOp.Disable, "Disable", danger: false),
            a => AssertAction(a, AutomationBulkOp.Delete, "Delete", danger: true));
    }

    [Fact]
    public void Bulk_bar_uses_the_plural_noun_for_multiple_selections()
    {
        var rows = new[] { Row(1), Row(2, name: "Second") };
        var display = AutomationListProjection.Project(Model(automations: rows, selected: new HashSet<long> { 1, 2 }), Localizer);

        Assert.Equal(2, display.SelectedCount);
        Assert.Equal("automations", display.ItemNoun);
    }

    [Fact]
    public void Delete_action_carries_the_confirm_copy()
    {
        var display = AutomationListProjection.Project(Model(), Localizer);

        Assert.Equal("Delete automations?", display.DeleteConfirmTitle);
        Assert.Equal(
            "Selected automations will stop running and be removed permanently. This cannot be undone.",
            display.DeleteConfirmBody);
        Assert.Equal("Delete", display.DeleteConfirmLabel);
        Assert.Equal("Cancel", display.DeleteCancelLabel);
    }

    // ---- Master-checkbox tri-state -------------------------------------------------

    [Theory]
    [InlineData(new long[0], MasterSelectionState.None)]
    [InlineData(new long[] { 1 }, MasterSelectionState.Some)]
    [InlineData(new long[] { 1, 2 }, MasterSelectionState.All)]
    public void Master_state_reflects_the_visible_selection(long[] selected, MasterSelectionState expected)
    {
        var rows = new[] { Row(1), Row(2, name: "Second") };
        var model = Model(automations: rows, selected: new HashSet<long>(selected));

        Assert.Equal(expected, AutomationListProjection.ComputeMasterState(model));
        Assert.Equal(expected, AutomationListProjection.Project(model, Localizer).MasterState);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parses_a_bare_array()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":1,\"name\":\"A\",\"description\":\"d\",\"execution_count\":3,\"enabled\":true}," +
            "{\"id\":2,\"name\":\"B\",\"enabled\":false}]");

        var snapshot = AutomationListSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(2, snapshot.Automations.Count);
        Assert.Equal(1, snapshot.Automations[0].Id);
        Assert.Equal("A", snapshot.Automations[0].Name);
        Assert.Equal(3, snapshot.Automations[0].ExecutionCount);
        Assert.True(snapshot.Automations[0].Enabled);
        Assert.Null(snapshot.Automations[1].Description);
        Assert.Equal(0, snapshot.Automations[1].ExecutionCount); // missing execution_count -> 0 (web ?? 0)
        Assert.False(snapshot.Automations[1].Enabled);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope()
    {
        using var doc = JsonDocument.Parse("{\"data\":[{\"id\":5,\"name\":\"Wrapped\",\"enabled\":true}]}");

        var snapshot = AutomationListSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal("Wrapped", Assert.Single(snapshot.Automations).Name);
    }

    [Fact]
    public void Snapshot_treats_non_array_as_no_data()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.False(AutomationListSnapshot.FromJson(doc.RootElement).HasData);
    }

    [Fact]
    public void Bulk_outcome_parses_updated_deleted_and_failed_counts()
    {
        using var updated = JsonDocument.Parse("{\"updated\":3,\"failed\":[]}");
        var u = AutomationBulkOutcome.FromJson(updated.RootElement);
        Assert.Equal(3, u.Updated);
        Assert.Equal(0, u.Deleted);
        Assert.Equal(0, u.Failed);

        using var deleted = JsonDocument.Parse("{\"deleted\":2,\"failed\":[{\"id\":9,\"reason\":\"not_found\"}]}");
        var d = AutomationBulkOutcome.FromJson(deleted.RootElement);
        Assert.Equal(2, d.Deleted);
        Assert.Equal(1, d.Failed);
    }

    // ---- View-model state matrix + selection ---------------------------------------

    [Fact]
    public async Task ViewModel_loads_automations_into_the_success_state()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row()]));
        using var vm = new AutomationListPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AutomationListState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new AutomationListPageViewModel(EmptyAutomationListFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AutomationListState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new AutomationListPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(AutomationListState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_toggle_row_selects_then_deselects()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1), Row(2, name: "Second")]));
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.ToggleRow(1);
        Assert.Equal(1, vm.Display.SelectedCount);
        Assert.Equal(MasterSelectionState.Some, vm.Display.MasterState);

        vm.ToggleRow(1);
        Assert.Equal(0, vm.Display.SelectedCount);
        Assert.False(vm.Display.ShowBulkBar);
    }

    [Fact]
    public async Task ViewModel_toggle_all_selects_every_row_then_clears()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1), Row(2, name: "Second")]));
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.ToggleAll();
        Assert.Equal(2, vm.Display.SelectedCount);
        Assert.Equal(MasterSelectionState.All, vm.Display.MasterState);

        vm.ToggleAll();
        Assert.Equal(0, vm.Display.SelectedCount);
        Assert.Equal(MasterSelectionState.None, vm.Display.MasterState);
    }

    [Fact]
    public async Task ViewModel_clear_selection_drops_every_selection()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1), Row(2, name: "Second")]));
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleAll();

        vm.ClearSelection();

        Assert.Equal(0, vm.Display.SelectedCount);
    }

    // ---- View-model bulk operations ------------------------------------------------

    [Fact]
    public async Task ViewModel_bulk_success_runs_the_op_clears_selection_and_reloads()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1), Row(2, name: "Second")]))
        {
            BulkResult = new AutomationBulkOutcome(2, 0, 0),
        };
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleAll();

        await vm.RunBulkAsync(AutomationBulkOp.Enable);

        Assert.Equal(1, feed.BulkCount);
        Assert.Equal(AutomationBulkOp.Enable, feed.LastOp);
        Assert.Equal(new long[] { 1, 2 }, feed.LastIds!.OrderBy(x => x).ToArray());
        Assert.Equal(2, feed.FetchCount); // initial load + reload after the bulk op
        Assert.Equal(0, vm.Display.SelectedCount); // selection cleared on success
        Assert.False(vm.IsBulkBusy);
    }

    [Fact]
    public async Task ViewModel_bulk_failure_keeps_the_selection()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1)])) { BulkThrows = true };
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleRow(1);

        await vm.RunBulkAsync(AutomationBulkOp.Delete);

        Assert.Equal(1, vm.Display.SelectedCount); // selection preserved so the user can retry
        Assert.False(vm.IsBulkBusy);
    }

    [Fact]
    public async Task ViewModel_bulk_is_a_no_op_when_nothing_is_selected()
    {
        var feed = new FakeFeed(new AutomationListSnapshot(true, [Row(1)]));
        using var vm = new AutomationListPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.RunBulkAsync(AutomationBulkOp.Delete);

        Assert.Equal(0, feed.BulkCount);
    }

    // ---- Generated-client feed (web useAutomations + useBulkAutomationsUpdate) ------

    [Fact]
    public async Task ClientFeed_sends_the_list_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"name\":\"A\",\"enabled\":true}]"));
        var feed = new AutomationListClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal("A", Assert.Single(snapshot.Automations).Name);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_automations", request.OperationId);
    }

    [Fact]
    public async Task ClientFeed_posts_the_bulk_operation_with_ids_and_op_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"deleted\":2,\"failed\":[]}"));
        var feed = new AutomationListClientFeed(api);

        var outcome = await feed.BulkUpdateAsync(new long[] { 1, 2 }, AutomationBulkOp.Delete, default);

        Assert.Equal(2, outcome.Deleted);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_automations_bulk", request.OperationId);
        Assert.NotNull(request.Body);
        Assert.Equal("{\"ids\":[1,2],\"op\":\"delete\"}", JsonSerializer.Serialize(request.Body!, request.Body!.GetType()));
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_from_a_failed_list()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new AutomationListClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    // ---- Wire op + diagnostics + registration --------------------------------------

    [Theory]
    [InlineData(AutomationBulkOp.Enable, "enable")]
    [InlineData(AutomationBulkOp.Disable, "disable")]
    [InlineData(AutomationBulkOp.Delete, "delete")]
    public void Registration_maps_each_op_to_its_wire_string(AutomationBulkOp op, string expected) =>
        Assert.Equal(expected, AutomationListRegistration.Wire(op));

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("AutomationList", AutomationListRegistration.RouteName);
        Assert.Equal("get_api_v1_automations", AutomationListRegistration.ListOperation);
        Assert.Equal("post_api_v1_automations_bulk", AutomationListRegistration.BulkOperation);
        Assert.Equal("automations/new", AutomationListRegistration.BuilderRoute);
        Assert.Equal("automations/42", AutomationListRegistration.DetailRoute(42));
        Assert.Equal("Automations (list)", AutomationListRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new AutomationListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationListPage", Assert.Single(lines));
    }

    private static void AssertAction(AutomationBulkAction action, AutomationBulkOp op, string label, bool danger)
    {
        Assert.Equal(op, action.Op);
        Assert.Equal(label, action.Label);
        Assert.Equal(danger, action.IsDanger);
        Assert.False(string.IsNullOrEmpty(action.Glyph));
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

    private sealed class FakeFeed : IAutomationListFeed
    {
        private readonly AutomationListSnapshot _snapshot;

        public FakeFeed(AutomationListSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public int BulkCount { get; private set; }

        public IReadOnlyList<long>? LastIds { get; private set; }

        public AutomationBulkOp LastOp { get; private set; }

        public AutomationBulkOutcome BulkResult { get; set; } = AutomationBulkOutcome.Empty;

        public bool BulkThrows { get; set; }

        public Task<AutomationListSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }

        public Task<AutomationBulkOutcome> BulkUpdateAsync(IReadOnlyList<long> ids, AutomationBulkOp op, CancellationToken cancellationToken)
        {
            BulkCount++;
            LastIds = ids;
            LastOp = op;
            if (BulkThrows)
            {
                throw new InvalidOperationException("bulk failed");
            }

            return Task.FromResult(BulkResult);
        }
    }

    private sealed class ThrowingFeed : IAutomationListFeed
    {
        public Task<AutomationListSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<AutomationBulkOutcome> BulkUpdateAsync(IReadOnlyList<long> ids, AutomationBulkOp op, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
