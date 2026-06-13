using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AlertRulesPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/notifications/pages/AlertRulesPage.tsx), the status-badge map, the tolerant parser, the
/// master-selection tri-state, the rename validation, the view-model's four-state matrix
/// (loading / empty / error / success) plus the bulk + rename flows, and the generated-client feed's request
/// shaping (web <c>useAlertRules</c> / <c>useBulkEnableRules</c> / <c>useBulkDisableRules</c> /
/// <c>useDeleteAlertRule</c> / <c>useSaveAlertRule</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="AlertRulesDisplay"/> flags asserted here.
/// </summary>
public sealed class AlertRulesPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 26 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "alertRules.bulk.delete", "alertRules.bulk.deleteConfirm.body", "alertRules.bulk.deleteConfirm.title",
        "alertRules.bulk.disable", "alertRules.bulk.enable", "alertRules.col.name", "alertRules.col.severity",
        "alertRules.col.signal", "alertRules.col.status", "alertRules.empty.body", "alertRules.empty.cta",
        "alertRules.empty.title", "alertRules.error.nameTooLong", "alertRules.noun.one", "alertRules.noun.other",
        "alertRules.openStudio", "alertRules.selectRule", "alertRules.subtitle", "alertRules.title",
        "bulk.selectAll", "bulk.selectRow", "common.delete", "common.disabled", "common.enabled",
        "editConflict.resource.alertRules", "editableText.rename.alertRule",
    ];

    private static AlertRule Rule(long id = 1, string name = "Battery low", string signal = "battery_level", string severity = "warn", bool enabled = true) =>
        new(id, name, signal, severity, enabled);

    // Two rows — one enabled, one disabled — so both common.enabled and common.disabled are resolved.
    private static AlertRulesModel RichModel(IReadOnlySet<long>? selected = null) => new(
        Items: [Rule(1, enabled: true), Rule(2, name: "Tire pressure", signal: "tire_pressure", severity: "critical", enabled: false)],
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        SelectedIds: selected ?? new HashSet<long>(),
        NameError: null);

    // ---- i18n key coverage (all 26 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AlertRulesProjection.Project(RichModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = AlertRulesProjection.Project(AlertRulesModel.Initial, Localizer);

        Assert.Equal(AlertRulesState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.HasError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var model = AlertRulesModel.Initial with { Loading = false };
        var display = AlertRulesProjection.Project(model, Localizer);

        Assert.Equal(AlertRulesState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal("No alert rules yet", display.EmptyTitle);
        Assert.Equal("Create your first alert rule in the Alert Studio.", display.EmptyMessage);
        Assert.Equal("Open Alert Studio", display.EmptyCtaLabel);
    }

    [Fact]
    public void State_error_shows_message_with_detail()
    {
        var model = AlertRulesModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = AlertRulesProjection.Project(model, Localizer);

        Assert.Equal(AlertRulesState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var display = AlertRulesProjection.Project(RichModel(), Localizer);

        Assert.Equal(AlertRulesState.Success, display.State);
        Assert.True(display.ShowRows);
        Assert.Equal(2, display.Rows.Count);
        Assert.Equal(2, display.TotalCount);
    }

    // ---- Panel: title / subtitle / column headers ----------------------------------

    [Fact]
    public void Chrome_strings_match_web()
    {
        var display = AlertRulesProjection.Project(RichModel(), Localizer);

        Assert.Equal("Alert rules", display.Title);
        Assert.Equal("Bulk-manage alert rules. Click a rule to edit it in Alert Studio.", display.Subtitle);
        Assert.Equal("Your alert rules", display.EditConflictResourceLabel);
        Assert.Equal("Open Alert Studio", display.OpenStudioLabel);

        Assert.Equal("Name", display.ColumnLabels.Name);
        Assert.Equal("Signal", display.ColumnLabels.Signal);
        Assert.Equal("Severity", display.ColumnLabels.Severity);
        Assert.Equal("Status", display.ColumnLabels.Status);

        Assert.Equal("Select all", display.SelectAllLabel);
        Assert.Equal("Select row", display.SelectRowLabel);
    }

    [Fact]
    public void Bulk_labels_match_web()
    {
        var labels = AlertRulesProjection.Project(RichModel(), Localizer).BulkLabels;

        Assert.Equal("Enable", labels.Enable);
        Assert.Equal("Disable", labels.Disable);
        Assert.Equal("Delete", labels.Delete);
        Assert.Equal("Delete alert rules?", labels.DeleteConfirmTitle);
        Assert.Equal("These rules will stop firing immediately. This cannot be undone.", labels.DeleteConfirmBody);
        Assert.Equal("Delete", labels.DeleteConfirmLabel);
        Assert.Equal("rule", labels.NounOne);
        Assert.Equal("rules", labels.NounOther);
    }

    // ---- Panel: rows ---------------------------------------------------------------

    [Fact]
    public void Row_projects_cells_links_and_a11y_names()
    {
        var display = AlertRulesProjection.Project(RichModel(new HashSet<long> { 1 }), Localizer);
        var enabledRow = display.Rows[0];
        var disabledRow = display.Rows[1];

        Assert.Equal("Battery low", enabledRow.Name);
        Assert.Equal("battery_level", enabledRow.SignalName);
        Assert.Equal("warn", enabledRow.Severity);
        Assert.True(enabledRow.Enabled);
        Assert.Equal("Enabled", enabledRow.StatusLabel);
        Assert.Equal(StatusKind.Success, enabledRow.StatusVariant);
        Assert.True(enabledRow.IsSelected);
        Assert.Equal("notifications/studio?rule=1", enabledRow.StudioRoute);
        Assert.Equal("Select rule Battery low", enabledRow.SelectRuleLabel);
        Assert.Equal("Rename alert rule Battery low", enabledRow.RenameLabel);

        Assert.Equal("Disabled", disabledRow.StatusLabel);
        Assert.Equal(StatusKind.Neutral, disabledRow.StatusVariant);
        Assert.False(disabledRow.IsSelected);
    }

    [Fact]
    public void Row_uses_em_dash_for_blank_signal()
    {
        var model = AlertRulesModel.Initial with { Loading = false, Items = [Rule(7, name: string.Empty, signal: string.Empty)] };
        var row = Assert.Single(AlertRulesProjection.Project(model, Localizer).Rows);

        Assert.Equal(string.Empty, row.Name); // raw — backs the inline editor
        Assert.Equal(AlertRulesProjection.EmDash, row.SignalName);
    }

    // ---- Status badge mapping ------------------------------------------------------

    [Theory]
    [InlineData(true, StatusKind.Success)]
    [InlineData(false, StatusKind.Neutral)]
    public void StatusVariant_matches_web(bool enabled, StatusKind expected) =>
        Assert.Equal(expected, AlertRulesProjection.StatusVariant(enabled));

    // ---- Master selection tri-state ------------------------------------------------

    [Fact]
    public void MasterState_reflects_visible_selection()
    {
        var rules = new List<AlertRule> { Rule(1), Rule(2) };

        Assert.Equal(MasterSelectionState.None, AlertRulesProjection.MasterState(rules, new HashSet<long>()));
        Assert.Equal(MasterSelectionState.Some, AlertRulesProjection.MasterState(rules, new HashSet<long> { 1 }));
        Assert.Equal(MasterSelectionState.All, AlertRulesProjection.MasterState(rules, new HashSet<long> { 1, 2 }));
        Assert.Equal(MasterSelectionState.None, AlertRulesProjection.MasterState(Array.Empty<AlertRule>(), new HashSet<long>()));
    }

    // ---- Rename validation ---------------------------------------------------------

    [Fact]
    public void ValidateName_rejects_over_120_chars()
    {
        Assert.Null(AlertRulesProjection.ValidateName(new string('x', 120), Localizer));
        Assert.Equal("Max 120 characters", AlertRulesProjection.ValidateName(new string('x', 121), Localizer));
    }

    [Fact]
    public void NameError_surfaces_in_display()
    {
        var model = RichModel() with { NameError = "Max 120 characters" };
        var display = AlertRulesProjection.Project(model, Localizer);

        Assert.True(display.HasNameError);
        Assert.Equal("Max 120 characters", display.NameError);
    }

    // ---- Tolerant parsing ----------------------------------------------------------

    [Fact]
    public void ParseList_is_tolerant_of_partial_and_non_array_input()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(AlertRule.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse(
            "[{\"id\":5,\"name\":\"A\",\"signal_name\":\"s\",\"severity\":\"critical\",\"enabled\":true},{}]");
        var rules = AlertRule.ParseList(partial.RootElement);
        Assert.Equal(2, rules.Count);
        Assert.Equal(5, rules[0].Id);
        Assert.Equal("critical", rules[0].Severity);
        Assert.True(rules[0].Enabled);
        Assert.Equal(0, rules[1].Id);
        Assert.Equal("info", rules[1].Severity); // default
        Assert.False(rules[1].Enabled);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeAlertRulesFeed([Rule(1), Rule(2)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertRulesState.Success, vm.State);
        Assert.True(vm.Display.ShowRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new AlertRulesPageViewModel(EmptyAlertRulesFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertRulesState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new ThrowingAlertRulesFeed();
        using var vm = new AlertRulesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertRulesState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText);
    }

    [Fact]
    public async Task ViewModel_selection_toggle_and_master_toggle()
    {
        var feed = new FakeAlertRulesFeed([Rule(1), Rule(2)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.ToggleSelect(1);
        Assert.Equal(MasterSelectionState.Some, vm.Display.MasterState);
        Assert.Contains(1L, vm.SelectedIds);

        vm.ToggleSelectAll();
        Assert.Equal(MasterSelectionState.All, vm.Display.MasterState);

        vm.ToggleSelectAll(); // all → clear
        Assert.Equal(MasterSelectionState.None, vm.Display.MasterState);

        vm.ToggleSelect(2);
        vm.ClearSelection();
        Assert.Empty(vm.SelectedIds);
    }

    [Fact]
    public async Task ViewModel_bulk_enable_calls_feed_then_clears_and_reloads()
    {
        var feed = new FakeAlertRulesFeed([Rule(1), Rule(2)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleSelect(1);
        vm.ToggleSelect(2);

        await vm.BulkEnableAsync(vm.SelectedIds);

        Assert.Equal([1L, 2L], feed.LastBulkEnable);
        Assert.Equal(2, feed.FetchCount); // initial + reload
        Assert.Empty(vm.SelectedIds);
    }

    [Fact]
    public async Task ViewModel_bulk_disable_calls_feed()
    {
        var feed = new FakeAlertRulesFeed([Rule(3)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.BulkDisableAsync([3]);

        Assert.Equal([3L], feed.LastBulkDisable);
        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_bulk_delete_deletes_each_id_then_reloads()
    {
        var feed = new FakeAlertRulesFeed([Rule(4), Rule(5)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.BulkDeleteAsync([4, 5]);

        Assert.Equal([4L, 5L], feed.DeletedIds);
        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_rename_valid_writes_then_reloads()
    {
        var feed = new FakeAlertRulesFeed([Rule(9, name: "Old")]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        bool attempted = await vm.RenameAsync(9, "New name");

        Assert.True(attempted);
        Assert.Equal((9L, "New name"), (feed.LastRenameId, feed.LastRenameName));
        Assert.Equal(2, feed.FetchCount); // initial + reload after rename
        Assert.False(vm.Display.HasNameError);
    }

    [Fact]
    public async Task ViewModel_rename_too_long_is_rejected_without_write()
    {
        var feed = new FakeAlertRulesFeed([Rule(9)]);
        using var vm = new AlertRulesPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        bool attempted = await vm.RenameAsync(9, new string('x', 121));

        Assert.False(attempted);
        Assert.Equal(0, feed.RenameCount);
        Assert.True(vm.Display.HasNameError);
        Assert.Equal("Max 120 characters", vm.Display.NameError);

        vm.ClearNameError();
        Assert.False(vm.Display.HasNameError);
    }

    // ---- Generated-client feed (web hooks → /alerts/rules endpoints) ----------------

    [Fact]
    public async Task ClientFeed_list_sends_get_and_parses_rules()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"name\":\"A\",\"signal_name\":\"s\",\"severity\":\"warn\",\"enabled\":true}]"));
        var feed = new AlertRulesClientFeed(api);

        var rules = await feed.FetchAsync(default);

        Assert.Single(rules);
        Assert.Equal("A", rules[0].Name);
        Assert.Equal("get_api_v1_alerts_rules", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_bulk_enable_posts_ids_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"updated\":2}"));
        var feed = new AlertRulesClientFeed(api);

        await feed.BulkEnableAsync([1, 2], default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_alerts_rules_bulk_enable", request.OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.Equal(new long[] { 1, 2 }, Assert.IsAssignableFrom<IReadOnlyList<long>>(body["ids"]));
    }

    [Fact]
    public async Task ClientFeed_bulk_disable_posts_to_disable_endpoint()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"updated\":1}"));
        var feed = new AlertRulesClientFeed(api);

        await feed.BulkDisableAsync([3], default);

        Assert.Equal("post_api_v1_alerts_rules_bulk_disable", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_delete_sends_rule_path_param()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AlertRulesClientFeed(api);

        await feed.DeleteAsync(42, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_alerts_rules_ruleID", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("42", request.PathParams!["ruleID"]);
    }

    [Fact]
    public async Task ClientFeed_rename_puts_name_body_with_rule_path_param()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":5,\"name\":\"New\"}"));
        var feed = new AlertRulesClientFeed(api);

        await feed.RenameAsync(5, "New", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("put_api_v1_alerts_rules_ruleID", request.OperationId);
        Assert.Equal("5", request.PathParams!["ruleID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.Equal("New", body["name"]);
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    // ── recording / fake doubles ───────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeAlertRulesFeed : IAlertRulesFeed
    {
        private readonly IReadOnlyList<AlertRule> _rules;

        public FakeAlertRulesFeed(IReadOnlyList<AlertRule> rules) => _rules = rules;

        public int FetchCount { get; private set; }

        public IReadOnlyList<long>? LastBulkEnable { get; private set; }

        public IReadOnlyList<long>? LastBulkDisable { get; private set; }

        public List<long> DeletedIds { get; } = new();

        public int RenameCount { get; private set; }

        public long LastRenameId { get; private set; }

        public string? LastRenameName { get; private set; }

        public Task<IReadOnlyList<AlertRule>> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_rules);
        }

        public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
        {
            LastBulkEnable = ids.ToList();
            return Task.CompletedTask;
        }

        public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
        {
            LastBulkDisable = ids.ToList();
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken)
        {
            DeletedIds.Add(id);
            return Task.CompletedTask;
        }

        public Task RenameAsync(long id, string name, CancellationToken cancellationToken)
        {
            RenameCount++;
            LastRenameId = id;
            LastRenameName = name;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingAlertRulesFeed : IAlertRulesFeed
    {
        public Task<IReadOnlyList<AlertRule>> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task DeleteAsync(long id, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task RenameAsync(long id, string name, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
