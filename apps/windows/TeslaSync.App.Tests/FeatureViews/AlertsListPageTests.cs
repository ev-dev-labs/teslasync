using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AlertsListPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/notifications/pages/AlertsListPage.tsx), the tolerant parsers, the count + aggregate maths
/// (overview metrics, the 7-day trend, the by-type breakdown), the pinned "Watching" ordering, the filter / search
/// / pagination flow, the drill-through href port, the view-model's four-state matrix
/// (loading / empty / error / success) plus the mark-read / acknowledge / reopen flows, and the generated-client
/// feed's request shaping (web <c>useAlerts</c> / <c>useAlertRules</c> / <c>usePinned</c> / <c>useMarkAlertRead</c>
/// / <c>useAcknowledgeAlert</c> / <c>useReopenAlert</c> / <c>useAlertDetail</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="AlertsListDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class AlertsListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset FixedNow = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The 36 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "Active Rules", "Alert Trend (7 Days)", "Alert marked as read", "Alerts", "Alerts by Type", "All",
        "Critical", "Info", "Last 7 Days", "Most Common", "No alerts", "No alerts match your search.",
        "Quiet hours", "Quiet hours active", "Total", "Unread", "Warning", "Warnings",
        "Your fleet is running smoothly. Alerts will appear here.", "alerts.ack.success", "alerts.ack.undo",
        "alerts.criticalCallout", "alerts.filterLabel.search", "alerts.filterLabel.status",
        "alerts.noAlertsInRange", "alerts.overview", "alerts.readRate", "alerts.rule", "alerts.searchPlaceholder",
        "alerts.subtitle", "alerts.timeline.empty", "alerts.timeline.title", "alerts.viewCritical",
        "common.disabled", "common.enabled", "pinned.section.watching",
    ];

    private static Alert MakeAlert(
        long id,
        string severity,
        bool read,
        string type,
        DateTimeOffset? created = null,
        string title = "Title",
        string message = "Message",
        string? signal = null,
        long vehicleId = 0) =>
        new(id, type, severity, title, message, read, created ?? FixedNow, null, null, signal, vehicleId);

    private static AlertsListModel RichModel(
        AlertsFilter filter = AlertsFilter.All,
        string search = "",
        int page = 1,
        bool quietActive = true)
    {
        var alerts = new List<Alert>
        {
            MakeAlert(1, "critical", read: false, "battery", title: "Battery low", message: "SOC 5%", signal: "BatteryLevel", vehicleId: 7),
            MakeAlert(2, "warning", read: false, "battery", title: "Battery warm"),
            MakeAlert(3, "info", read: true, "battery"),
            MakeAlert(4, "critical", read: true, "charging"),
            MakeAlert(5, "info", read: false, "tire_pressure"),
        };

        var rules = new List<AlertsRule>
        {
            new(1, "Battery low", true),
            new(2, "Tire check", false),
        };

        var pins = new List<PinnedRef>
        {
            new("2", 0),
            new("1", 1),
        };

        return new AlertsListModel(alerts, rules, pins, Loading: false, HasError: false, ErrorDetail: null, filter, search, page, quietActive, FixedNow);
    }

    // ── i18n key coverage (all 36 manifest strings) ─────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AlertsListProjection.Project(RichModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = AlertsListProjection.Project(AlertsListModel.Initial, Localizer);

        Assert.Equal(AlertsListState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.HasError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_alerts()
    {
        var model = AlertsListModel.Initial with { Loading = false };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.Equal(AlertsListState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No alerts", display.OverviewEmptyTitle);
        Assert.Equal("No alerts in this range. Your fleet is running smoothly.", display.OverviewEmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = AlertsListModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.Equal(AlertsListState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_success_when_alerts_present()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.Equal(AlertsListState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowOverview);
    }

    // ── Chrome strings ──────────────────────────────────────────────────────────────

    [Fact]
    public void Chrome_strings_match_web()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.Equal("Alerts", display.Title);
        Assert.Equal("Live alert events from your fleet", display.Subtitle);
        Assert.Equal("Quiet hours", display.QuietHoursBadge);
        Assert.Equal("Overview", display.OverviewTitle);
        Assert.Equal("Alert Trend (7 Days)", display.TrendTitle);
        Assert.Equal("Alerts by Type", display.ByTypeTitle);
        Assert.Equal("Watching", display.WatchingLabel);
    }

    // ── Panels: six overview metric tiles ───────────────────────────────────────────

    [Fact]
    public void Metrics_match_web_counts()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.Equal(6, display.Metrics.Count);
        Assert.Equal(("Total", "5"), (display.Metrics[0].Label, display.Metrics[0].Value));
        Assert.Equal(("Critical", "1"), (display.Metrics[1].Label, display.Metrics[1].Value));     // unread critical only
        Assert.Equal(("Warnings", "1"), (display.Metrics[2].Label, display.Metrics[2].Value));
        Assert.Equal(("Info", "2"), (display.Metrics[3].Label, display.Metrics[3].Value));
        Assert.Equal(("Unread", "3"), (display.Metrics[4].Label, display.Metrics[4].Value));
        Assert.Equal(("Read rate", "40%"), (display.Metrics[5].Label, display.Metrics[5].Value));   // 2 of 5 read
    }

    [Fact]
    public void Secondary_line_reports_active_rules_most_common_and_week()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.Equal("1/2", display.ActiveRulesValue);          // 1 of 2 rules enabled
        Assert.Equal("battery", display.MostCommonValue);        // 3 battery alerts
        Assert.Equal("5", display.Last7DaysValue);               // all 5 within the 7-day window
    }

    [Fact]
    public void Critical_callout_shows_with_interpolated_count()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.True(display.ShowCriticalCallout);
        Assert.Equal("1 critical alert needs attention", display.CriticalCalloutText);
        Assert.Equal("View critical", display.ViewCriticalLabel);
    }

    [Fact]
    public void Critical_callout_hidden_when_no_unread_critical()
    {
        var model = RichModel() with { Alerts = [MakeAlert(9, "info", read: false, "battery")] };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.False(display.ShowCriticalCallout);
    }

    // ── Charts ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Trend_has_seven_days_and_counts_today()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.True(display.ShowCharts);
        Assert.Equal(7, display.TrendDays.Count);

        var today = display.TrendDays[^1];
        Assert.Equal(2, today.Critical); // alerts 1 + 4
        Assert.Equal(1, today.Warning);  // alert 2
        Assert.Equal(2, today.Info);     // alerts 3 + 5
        Assert.Equal("Critical", display.SeriesCriticalLabel);
        Assert.Equal("Warning", display.SeriesWarningLabel);
        Assert.Equal("Info", display.SeriesInfoLabel);
    }

    [Fact]
    public void TypeSlices_sorted_by_count_descending()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.Equal(3, display.TypeSlices.Count);
        Assert.Equal(("battery", 3), (display.TypeSlices[0].Name, display.TypeSlices[0].Count));
        Assert.Contains(display.TypeSlices, s => s.Name == "tire pressure" && s.Count == 1); // underscores humanised
    }

    // ── Pinned "Watching" panel ─────────────────────────────────────────────────────

    [Fact]
    public void Pinned_rows_follow_pin_order_with_status()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);

        Assert.True(display.ShowPinned);
        Assert.Equal(2, display.PinnedCount);
        Assert.Equal(2, display.PinnedRules[0].Id);                       // position 0 first
        Assert.Equal("Disabled", display.PinnedRules[0].StatusLabel);
        Assert.Equal(StatusKind.Neutral, display.PinnedRules[0].StatusVariant);
        Assert.Equal(1, display.PinnedRules[1].Id);
        Assert.Equal("Enabled", display.PinnedRules[1].StatusLabel);
        Assert.Equal(StatusKind.Success, display.PinnedRules[1].StatusVariant);
    }

    [Fact]
    public void Pinned_falls_back_to_rule_id_when_unnamed()
    {
        var model = RichModel() with
        {
            Rules = [new AlertsRule(5, string.Empty, true)],
            Pins = [new PinnedRef("5", 0)],
        };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.Equal("Rule #5", Assert.Single(display.PinnedRules).Name);
    }

    [Fact]
    public void Pinned_hidden_when_no_pins()
    {
        var model = RichModel() with { Pins = Array.Empty<PinnedRef>() };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.False(display.ShowPinned);
        Assert.Empty(display.PinnedRules);
    }

    // ── Filter tabs + active chips ──────────────────────────────────────────────────

    [Fact]
    public void Filter_tabs_carry_live_counts_and_active_flag()
    {
        var display = AlertsListProjection.Project(RichModel(filter: AlertsFilter.Unread), Localizer);

        Assert.Equal(3, display.FilterTabs.Count);
        Assert.Equal("All (5)", display.FilterTabs[0].Label);
        Assert.Equal("Unread (3)", display.FilterTabs[1].Label);
        Assert.Equal("Critical (1)", display.FilterTabs[2].Label);
        Assert.True(display.FilterTabs[1].IsActive);
        Assert.False(display.FilterTabs[0].IsActive);
    }

    [Fact]
    public void Active_chips_reflect_search_and_status()
    {
        var display = AlertsListProjection.Project(RichModel(filter: AlertsFilter.Critical, search: "low"), Localizer);

        Assert.Equal(2, display.ActiveChips.Count);
        Assert.Equal(("Search", "low"), (display.ActiveChips[0].Label, display.ActiveChips[0].Value));
        Assert.Equal(("Status", "Critical"), (display.ActiveChips[1].Label, display.ActiveChips[1].Value));
    }

    [Fact]
    public void No_active_chips_when_default_filter_and_no_search()
    {
        var display = AlertsListProjection.Project(RichModel(), Localizer);
        Assert.Empty(display.ActiveChips);
    }

    // ── List filtering + search + pagination ────────────────────────────────────────

    [Fact]
    public void Filter_critical_narrows_the_list()
    {
        var display = AlertsListProjection.Project(RichModel(filter: AlertsFilter.Critical), Localizer);

        Assert.Equal(2, display.FilteredCount); // both critical (read + unread)
        Assert.True(display.ShowList);
        Assert.All(display.PagedAlerts, a => Assert.Equal("critical", a.Card.Severity));
    }

    [Fact]
    public void Search_matches_title_and_message_case_insensitively()
    {
        var display = AlertsListProjection.Project(RichModel(search: "soc"), Localizer);

        Assert.Equal(1, display.FilteredCount); // "SOC 5%" message
        Assert.Equal(1, Assert.Single(display.PagedAlerts).Id);
    }

    [Fact]
    public void Search_with_no_match_shows_the_search_empty_state()
    {
        var display = AlertsListProjection.Project(RichModel(search: "zzzz"), Localizer);

        Assert.True(display.ShowListEmpty);
        Assert.False(display.ShowList);
        Assert.Equal("No alerts", display.ListEmptyTitle);
        Assert.Equal("No alerts match your search.", display.ListEmptyMessage);
    }

    [Fact]
    public void Empty_all_filter_shows_the_smooth_fleet_message()
    {
        var model = RichModel() with { Alerts = Array.Empty<Alert>(), Loading = false };
        var display = AlertsListProjection.Project(model, Localizer);

        // No alerts at all → top-level Empty state; the list copy still resolves the "all" branch.
        Assert.Equal("Your fleet is running smoothly. Alerts will appear here.", display.ListEmptyMessage);
    }

    [Fact]
    public void Pagination_pages_at_twenty_per_page()
    {
        var many = Enumerable.Range(1, 45).Select(i => MakeAlert(i, "info", read: false, "battery")).ToList();
        var model = RichModel() with { Alerts = many, Page = 2 };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.True(display.ShowPagination);
        Assert.Equal(3, display.TotalPages);      // ceil(45 / 20)
        Assert.Equal(2, display.Page);
        Assert.Equal(20, display.PagedAlerts.Count);
    }

    [Fact]
    public void Page_clamped_to_available_range()
    {
        var model = RichModel() with { Page = 99 };
        var display = AlertsListProjection.Project(model, Localizer);

        Assert.Equal(1, display.TotalPages); // 5 alerts → one page
        Assert.Equal(1, display.Page);
        Assert.False(display.ShowPagination);
    }

    // ── Card model + drill-through href ─────────────────────────────────────────────

    [Fact]
    public void Card_model_carries_alert_fields_and_drill_href()
    {
        var display = AlertsListProjection.Project(RichModel(filter: AlertsFilter.Critical, search: "low"), Localizer);
        var item = Assert.Single(display.PagedAlerts);

        Assert.Equal(1, item.Id);
        Assert.Equal("Battery low", item.Card.Title);
        Assert.Equal("critical", item.Card.Severity);
        Assert.Contains("battery", item.Card.DrillHref);          // BatteryLevel → /battery
        Assert.Contains("vehicle_id=7", item.Card.DrillHref);
        Assert.Contains("signal=BatteryLevel", item.Card.DrillHref);
    }

    [Theory]
    [InlineData("BatteryLevel", "battery")]
    [InlineData("ChargeState", "charging")]
    [InlineData("VehicleSpeed", "drives")]
    [InlineData("UnmappedSignal", "signal-explorer")]
    [InlineData(null, "signal-explorer")]
    public void Drillthrough_maps_signal_to_page(string? signal, string expectedPathPrefix)
    {
        var alert = MakeAlert(1, "info", read: false, "x", signal: signal);
        string href = AlertsListRegistration.DrillthroughHref(alert);
        Assert.StartsWith(expectedPathPrefix, href, StringComparison.Ordinal);
    }

    // ── Tolerant parsing ────────────────────────────────────────────────────────────

    [Fact]
    public void Alert_ParseList_tolerates_partial_and_non_array_input()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(Alert.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse(
            "[{\"id\":5,\"severity\":\"critical\",\"is_read\":true,\"type\":\"battery\"},{}]");
        var alerts = Alert.ParseList(partial.RootElement);
        Assert.Equal(2, alerts.Count);
        Assert.Equal(5, alerts[0].Id);
        Assert.Equal("critical", alerts[0].Severity);
        Assert.True(alerts[0].IsRead);
        Assert.Equal(0, alerts[1].Id);
        Assert.Equal("info", alerts[1].Severity); // default
    }

    [Fact]
    public void Pinned_ParseList_reads_item_id_and_position()
    {
        using var doc = JsonDocument.Parse("[{\"item_id\":\"3\",\"position\":2},{\"item_id\":7,\"position\":0}]");
        var pins = PinnedRef.ParseList(doc.RootElement);

        Assert.Equal(2, pins.Count);
        Assert.Equal(("3", 2), (pins[0].ItemId, pins[0].Position));
        Assert.Equal(("7", 0), (pins[1].ItemId, pins[1].Position)); // numeric item_id coerced to string
    }

    [Fact]
    public void Rule_ParseList_reads_enabled_flag()
    {
        using var doc = JsonDocument.Parse("[{\"id\":1,\"name\":\"R\",\"enabled\":true}]");
        var rule = Assert.Single(AlertsRule.ParseList(doc.RootElement));
        Assert.True(rule.Enabled);
        Assert.Equal("R", rule.Name);
    }

    [Fact]
    public void AlertDetail_FromJson_reads_events()
    {
        using var doc = JsonDocument.Parse(
            "{\"title\":\"T\",\"message\":\"M\",\"events\":[{\"kind\":\"acknowledged\",\"actor\":\"alice\"}]}");
        var detail = AlertDetail.FromJson(doc.RootElement);

        Assert.Equal("T", detail.Title);
        Assert.Equal("acknowledged", Assert.Single(detail.Events).Kind);
        Assert.Equal("alice", detail.Events[0].Actor);
    }

    // ── View-model state matrix + flows ─────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_alerts_into_the_success_state()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(1, "info", read: false, "battery")] };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);

        await vm.LoadAsync();

        Assert.Equal(AlertsListState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new AlertsListPageViewModel(EmptyAlertsFeed.Instance, Localizer, clock: () => FixedNow);

        await vm.LoadAsync();

        Assert.Equal(AlertsListState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_alerts_failure_is_the_error_state()
    {
        var feed = new FakeAlertsFeed { ThrowOnAlerts = true };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);

        await vm.LoadAsync();

        Assert.Equal(AlertsListState.Error, vm.State);
        Assert.True(vm.Display.HasError);
    }

    [Fact]
    public async Task ViewModel_secondary_failure_does_not_fail_the_page()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(1, "info", read: false, "battery")], ThrowOnRules = true, ThrowOnPinned = true };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);

        await vm.LoadAsync();

        Assert.Equal(AlertsListState.Success, vm.State); // rules/pins failing only hides their panels
        Assert.False(vm.Display.ShowPinned);
    }

    [Fact]
    public async Task ViewModel_set_filter_resets_page_and_narrows()
    {
        var feed = new FakeAlertsFeed
        {
            Alerts = Enumerable.Range(1, 25).Select(i => MakeAlert(i, i == 1 ? "critical" : "info", read: false, "battery")).ToList(),
        };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        vm.SetPage(2);
        Assert.Equal(2, vm.Page);

        vm.SetFilter(AlertsFilter.Critical);
        Assert.Equal(AlertsFilter.Critical, vm.Filter);
        Assert.Equal(1, vm.Page); // reset
        Assert.Equal(1, vm.Display.FilteredCount);
    }

    [Fact]
    public async Task ViewModel_set_search_resets_page()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(1, "info", read: false, "battery", message: "needle")] };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        vm.SetSearch("needle");
        Assert.Equal("needle", vm.Search);
        Assert.Equal(1, vm.Page);
        Assert.Equal(1, vm.Display.FilteredCount);
    }

    [Fact]
    public async Task ViewModel_mark_read_calls_feed_then_reloads()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(3, "info", read: false, "battery")] };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        await vm.MarkReadAsync(3);

        Assert.Equal(3L, Assert.Single(feed.MarkReadIds));
        Assert.Equal(2, feed.FetchCount); // initial + reload
    }

    [Fact]
    public async Task ViewModel_acknowledge_sends_note_then_reloads()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(4, "critical", read: false, "battery")] };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        await vm.AcknowledgeAsync(4, "looked into it");

        Assert.Equal((4L, "looked into it"), Assert.Single(feed.AckCalls));
        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_reopen_calls_feed()
    {
        var feed = new FakeAlertsFeed { Alerts = [MakeAlert(4, "critical", read: false, "battery")] };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        await vm.ReopenAsync(4);

        Assert.Equal(4L, Assert.Single(feed.ReopenIds));
    }

    [Fact]
    public async Task ViewModel_load_detail_returns_feed_detail()
    {
        var feed = new FakeAlertsFeed
        {
            Alerts = [MakeAlert(1, "info", read: false, "battery")],
            Detail = new AlertDetail("Detail", "Body", [new AlertTimelineEvent("reopened", "bob", null, FixedNow)]),
        };
        using var vm = new AlertsListPageViewModel(feed, Localizer, clock: () => FixedNow);
        await vm.LoadAsync();

        var detail = await vm.LoadDetailAsync(1);
        Assert.Equal("Detail", detail.Title);
        Assert.Single(detail.Events);
    }

    // ── Generated-client feed (web hooks → /alerts + /pinned endpoints) ──────────────

    [Fact]
    public async Task ClientFeed_alerts_sends_get_and_parses()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"severity\":\"warning\",\"type\":\"battery\"}]"));
        var feed = new AlertsClientFeed(api);

        var alerts = await feed.FetchAlertsAsync(default);

        Assert.Equal("warning", Assert.Single(alerts).Severity);
        Assert.Equal("get_api_v1_alerts", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_rules_uses_rules_endpoint()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"name\":\"R\",\"enabled\":true}]"));
        var feed = new AlertsClientFeed(api);

        await feed.FetchRulesAsync(default);

        Assert.Equal("get_api_v1_alerts_rules", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_pinned_sends_type_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"item_id\":\"1\",\"position\":0}]"));
        var feed = new AlertsClientFeed(api);

        await feed.FetchPinnedRulesAsync(default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_pinned", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("alert_rule", request.Query!["type"]);
    }

    [Fact]
    public async Task ClientFeed_mark_read_sends_alert_path_param()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AlertsClientFeed(api);

        await feed.MarkReadAsync(42, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_alerts_alertID_read", request.OperationId);
        Assert.Equal("42", request.PathParams!["alertID"]);
    }

    [Fact]
    public async Task ClientFeed_acknowledge_posts_note_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AlertsClientFeed(api);

        await feed.AcknowledgeAsync(7, "note text", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_alerts_alertID_acknowledge", request.OperationId);
        Assert.Equal("7", request.PathParams!["alertID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.Equal("note text", body["note"]);
    }

    [Fact]
    public async Task ClientFeed_reopen_uses_reopen_endpoint()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AlertsClientFeed(api);

        await feed.ReopenAsync(9, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_alerts_alertID_reopen", request.OperationId);
        Assert.Equal("9", request.PathParams!["alertID"]);
    }

    [Fact]
    public async Task ClientFeed_detail_uses_alert_endpoint_and_parses()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"title\":\"T\",\"message\":\"M\",\"events\":[]}"));
        var feed = new AlertsClientFeed(api);

        var detail = await feed.FetchDetailAsync(5, default);

        Assert.Equal("get_api_v1_alerts_alertID", Assert.Single(api.Requests).OperationId);
        Assert.Equal("T", detail.Title);
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    // ── recording / fake doubles ────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeAlertsFeed : IAlertsFeed
    {
        public IReadOnlyList<Alert> Alerts { get; set; } = Array.Empty<Alert>();

        public IReadOnlyList<AlertsRule> Rules { get; set; } = Array.Empty<AlertsRule>();

        public IReadOnlyList<PinnedRef> Pins { get; set; } = Array.Empty<PinnedRef>();

        public AlertDetail Detail { get; set; } = AlertDetail.Empty;

        public bool ThrowOnAlerts { get; set; }

        public bool ThrowOnRules { get; set; }

        public bool ThrowOnPinned { get; set; }

        public int FetchCount { get; private set; }

        public List<long> MarkReadIds { get; } = new();

        public List<(long Id, string Note)> AckCalls { get; } = new();

        public List<long> ReopenIds { get; } = new();

        public Task<IReadOnlyList<Alert>> FetchAlertsAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return ThrowOnAlerts
                ? throw new InvalidOperationException("alerts down")
                : Task.FromResult(Alerts);
        }

        public Task<IReadOnlyList<AlertsRule>> FetchRulesAsync(CancellationToken cancellationToken) =>
            ThrowOnRules ? throw new InvalidOperationException("rules down") : Task.FromResult(Rules);

        public Task<IReadOnlyList<PinnedRef>> FetchPinnedRulesAsync(CancellationToken cancellationToken) =>
            ThrowOnPinned ? throw new InvalidOperationException("pins down") : Task.FromResult(Pins);

        public Task MarkReadAsync(long id, CancellationToken cancellationToken)
        {
            MarkReadIds.Add(id);
            return Task.CompletedTask;
        }

        public Task AcknowledgeAsync(long id, string note, CancellationToken cancellationToken)
        {
            AckCalls.Add((id, note));
            return Task.CompletedTask;
        }

        public Task ReopenAsync(long id, CancellationToken cancellationToken)
        {
            ReopenIds.Add(id);
            return Task.CompletedTask;
        }

        public Task<AlertDetail> FetchDetailAsync(long id, CancellationToken cancellationToken) =>
            Task.FromResult(Detail);
    }
}
