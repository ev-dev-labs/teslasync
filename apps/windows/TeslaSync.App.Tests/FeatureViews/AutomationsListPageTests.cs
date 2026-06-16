using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AutomationsListPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/automations/pages/AutomationsListPage.tsx), the stat-bar computation, the client-side
/// status/search filter, the pin ordering, the card-model mapping, the typed-envelope import gate, the view-model's
/// four-state matrix (loading / empty / error / success) plus the mutate-then-reload flow, and the generated-client
/// feed's request shaping (web <c>useAutomations</c> + sibling queries / mutations). The WinUI view is exercised by
/// the app build; its per-region visibility is driven entirely by the <see cref="AutomationsListDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class AutomationsListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 23 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "automations.autoDisabledWarning", "automations.create", "automations.empty", "automations.empty.cta",
        "automations.filterStatus", "automations.import", "automations.importFailedWithReason",
        "automations.importTypedEnvelopeRequired", "automations.importUnknownError", "automations.noMatch",
        "automations.noMatch.cta", "automations.presets.collapse", "automations.presets.expand",
        "automations.presets.hint", "automations.presets.title", "automations.presets.toggleAria",
        "automations.search", "automations.stats.active", "automations.stats.autoDisabled",
        "automations.stats.disabled", "automations.stats.total", "automations.subtitle", "automations.title",
    ];

    private static AutomationSummary SampleAutomation(
        long id = 1,
        string name = "Cabin overheat guard",
        string? description = "Keeps the cabin cool",
        bool enabled = true,
        bool autoDisabled = false,
        long? vehicleId = 7,
        long failureCount = 0) => new(
        Id: id,
        Name: name,
        Description: description,
        Enabled: enabled,
        AutoDisabled: autoDisabled,
        AutoDisabledReason: autoDisabled ? "too many failures" : null,
        VehicleId: vehicleId,
        LastTriggeredAt: "2026-06-06T11:30:00Z",
        ExecutionCount: 12,
        FailureCount: failureCount,
        NextFireTime: null,
        Conflicts: Array.Empty<AutomationConflictModel>());

    private static AutomationsListModel RichModel() => AutomationsListModel.Initial with
    {
        Items =
        [
            SampleAutomation(1, "Active one", enabled: true),
            SampleAutomation(2, "Disabled one", enabled: false),
            SampleAutomation(3, "Auto one", autoDisabled: true, failureCount: 5),
        ],
        Vehicles = [new AutomationVehicleRef(7, "Model 3")],
        Pins = [new AutomationPin("3", 0)],
        History = [new AutomationHistoryEntry(10, "Active one", "success", null, Now.AddMinutes(-5), 1200, 2, 2)],
        HistorySummary = new AutomationHistorySummary(40, 92.5, 1500),
        Loading = false,
    };

    // ---- i18n key coverage (all 23 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AutomationsListProjection.Project(RichModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = AutomationsListProjection.Project(AutomationsListModel.Initial, recorder, Now);

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
        var display = AutomationsListProjection.Project(AutomationsListModel.Initial, Localizer, Now);

        Assert.Equal(AutomationsListState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowCards);
        Assert.False(display.HasError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_automations()
    {
        var model = AutomationsListModel.Initial with { Loading = false };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Equal(AutomationsListState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowCards);
        Assert.False(display.ShowNoMatch);
        Assert.Equal("No automations yet. Create a typed automation to get started!", display.EmptyMessage);
        Assert.Equal("Create automation", display.EmptyCtaLabel);
    }

    [Fact]
    public void State_error_shows_query_error_with_detail()
    {
        var model = AutomationsListModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Equal(AutomationsListState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowCards);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_automations_present()
    {
        var display = AutomationsListProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(AutomationsListState.Success, display.State);
        Assert.True(display.ShowCards);
        Assert.Equal(3, display.Cards.Count);
    }

    // ---- Panels: stat bar ----------------------------------------------------------

    [Fact]
    public void Stat_bar_counts_match_web_compute_stats()
    {
        var display = AutomationsListProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal("3", display.TotalValue);
        Assert.Equal("1", display.ActiveValue);
        Assert.Equal("1", display.DisabledValue);
        Assert.Equal("1", display.AutoDisabledValue);
        Assert.Equal("Total", display.TotalLabel);
        Assert.Equal("Active", display.ActiveLabel);
        Assert.Equal("Disabled", display.DisabledLabel);
        Assert.Equal("Auto-Disabled", display.AutoDisabledLabel);
    }

    [Fact]
    public void Auto_disabled_warning_shows_only_when_any_auto_disabled()
    {
        var withAuto = AutomationsListProjection.Project(RichModel(), Localizer, Now);
        Assert.True(withAuto.ShowAutoDisabledWarning);
        Assert.Contains("1", withAuto.AutoDisabledWarning);

        var clean = AutomationsListProjection.Project(
            RichModel() with { Items = [SampleAutomation(1, enabled: true)] },
            Localizer,
            Now);
        Assert.False(clean.ShowAutoDisabledWarning);
    }

    // ---- Panel: filters ------------------------------------------------------------

    [Fact]
    public void Status_filter_options_match_web_with_all_head()
    {
        var display = AutomationsListProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(["all", "active", "disabled", "auto-disabled"], display.StatusFilterOptions.Select(o => o.Value).ToArray());
        Assert.Equal("All", display.StatusFilterOptions[0].Label);
        Assert.Equal("Active", display.StatusFilterOptions[1].Label);
        Assert.Equal("Filter by status", display.FilterStatusLabel);
        Assert.Equal("Search automations...", display.SearchHint);
    }

    [Fact]
    public void Status_filter_active_keeps_only_enabled_not_auto_disabled()
    {
        var model = RichModel() with { StatusFilter = AutomationStatusFilter.Active };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Single(display.Cards);
        Assert.Equal("Active one", display.Cards[0].Name);
    }

    [Fact]
    public void Status_filter_auto_disabled_keeps_only_auto_disabled()
    {
        var model = RichModel() with { StatusFilter = AutomationStatusFilter.AutoDisabled };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Single(display.Cards);
        Assert.Equal("Auto one", display.Cards[0].Name);
    }

    [Fact]
    public void Search_filter_matches_name_or_description()
    {
        var model = RichModel() with { Search = "disabled one" };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Single(display.Cards);
        Assert.Equal("Disabled one", display.Cards[0].Name);
    }

    [Fact]
    public void Filter_count_badge_visible_only_when_filtering()
    {
        var unfiltered = AutomationsListProjection.Project(RichModel(), Localizer, Now);
        Assert.False(unfiltered.ShowFilterCount);

        var filtered = AutomationsListProjection.Project(RichModel() with { Search = "active" }, Localizer, Now);
        Assert.True(filtered.ShowFilterCount);
        Assert.Equal("1 / 3", filtered.FilterCountText);
    }

    [Fact]
    public void No_match_state_when_filter_excludes_everything()
    {
        var model = RichModel() with { Search = "no-such-automation" };
        var display = AutomationsListProjection.Project(model, Localizer, Now);

        Assert.Equal(AutomationsListState.Success, display.State); // there ARE automations; the filter just matches none
        Assert.True(display.ShowNoMatch);
        Assert.False(display.ShowCards);
        Assert.False(display.ShowEmpty);
        Assert.Equal("No automations match your filters", display.NoMatchMessage);
        Assert.Equal("Reset filters", display.NoMatchCtaLabel);
    }

    // ---- Pin ordering --------------------------------------------------------------

    [Fact]
    public void Pinned_automations_float_to_the_top_in_pin_order()
    {
        // Pin id 3 to position 0 → it should lead even though it is last in the source order.
        var display = AutomationsListProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(3, display.Cards[0].Id);
        Assert.True(display.Cards[0].IsPinned);
        Assert.False(display.Cards[1].IsPinned);
    }

    // ---- Card model mapping --------------------------------------------------------

    [Fact]
    public void Card_model_resolves_vehicle_scope_label()
    {
        var display = AutomationsListProjection.Project(RichModel(), Localizer, Now);
        var active = display.Cards.Single(c => c.Id == 1);

        Assert.Equal("Model 3", active.VehicleName);
        Assert.False(active.IsFiring);
    }

    // ---- Import envelope gate (web isAutomationImportEnvelope) ----------------------

    [Theory]
    [InlineData("{\"version\":1,\"automations\":[]}", true)]
    [InlineData("{\"version\":2,\"automations\":[{\"name\":\"x\"}]}", true)]
    [InlineData("{\"automations\":[]}", false)]            // missing version
    [InlineData("{\"version\":1}", false)]                  // missing automations
    [InlineData("{\"version\":\"1\",\"automations\":[]}", false)] // version not numeric (legacy)
    [InlineData("[]", false)]                                // not an object
    [InlineData("not json", false)]
    [InlineData("", false)]
    public void Import_envelope_validation_matches_web(string json, bool expected)
    {
        Assert.Equal(expected, AutomationImportEnvelope.IsValid(json));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_automations_into_the_success_state()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(1)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(AutomationsListState.Success, vm.State);
        Assert.True(vm.Display.ShowCards);
        Assert.Single(vm.Display.Cards);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new AutomationsListPageViewModel(EmptyAutomationsListFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(AutomationsListState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new AutomationsListPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(AutomationsListState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText);
    }

    [Fact]
    public async Task ViewModel_toggle_writes_then_reloads()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(3)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleAsync(3, false);

        Assert.Equal((3L, false), feed.LastToggle);
        Assert.Equal(2, feed.FetchCount); // initial load + reload after toggle
    }

    [Fact]
    public async Task ViewModel_togglePin_when_not_pinned_posts_pin()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(3)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.TogglePinAsync(3);

        Assert.Equal("3", feed.LastPin);
        Assert.Null(feed.LastUnpin);
        Assert.Equal(2, feed.FetchCount); // initial load + reload after pin
    }

    [Fact]
    public async Task ViewModel_togglePin_when_already_pinned_deletes_by_row_id()
    {
        var feed = new FakeFeed(new AutomationsListSnapshot(
            new[] { SampleAutomation(9) },
            Array.Empty<AutomationVehicleRef>(),
            new[] { new AutomationPin("9", 0, "pin-42") },
            Array.Empty<AutomationHistoryEntry>(),
            null));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.TogglePinAsync(9);

        Assert.Equal("pin-42", feed.LastUnpin);
        Assert.Null(feed.LastPin);
    }

    [Fact]
    public async Task ViewModel_reEnable_delete_testRun_each_write_then_reload()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(9)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ReEnableAsync(9);
        await vm.DeleteAsync(9);
        await vm.TestRunAsync(9);

        Assert.Equal(9, feed.LastReEnable);
        Assert.Equal(9, feed.LastDelete);
        Assert.Equal(9, feed.LastTestRun);
        Assert.Equal(4, feed.FetchCount); // 1 initial + 3 reloads
    }

    [Fact]
    public async Task ViewModel_status_filter_reprojects_without_reload()
    {
        var feed = new FakeFeed(new AutomationsListSnapshot(
            [SampleAutomation(1, "A", enabled: true), SampleAutomation(2, "B", enabled: false)],
            Array.Empty<AutomationVehicleRef>(),
            Array.Empty<AutomationPin>(),
            Array.Empty<AutomationHistoryEntry>(),
            null));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetStatusFilter("disabled");

        Assert.Equal(AutomationStatusFilter.Disabled, vm.StatusFilter);
        Assert.Single(vm.Display.Cards);
        Assert.Equal("B", vm.Display.Cards[0].Name);
        Assert.Equal(1, feed.FetchCount); // filtering is client-side: no extra fetch
    }

    [Fact]
    public async Task ViewModel_search_and_reset_filters_reproject()
    {
        var feed = new FakeFeed(new AutomationsListSnapshot(
            [SampleAutomation(1, "Alpha"), SampleAutomation(2, "Beta")],
            Array.Empty<AutomationVehicleRef>(),
            Array.Empty<AutomationPin>(),
            Array.Empty<AutomationHistoryEntry>(),
            null));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetSearch("alpha");
        Assert.Single(vm.Display.Cards);
        Assert.True(vm.Display.ShowFilterCount);

        vm.ResetFilters();
        Assert.Equal(AutomationStatusFilter.All, vm.StatusFilter);
        Assert.Equal(string.Empty, vm.Search);
        Assert.Equal(2, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_import_rejects_untyped_envelope_without_posting()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(1)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        var result = await vm.ImportAsync("{\"foo\":1}");

        Assert.False(result.Success);
        Assert.Contains("typed", result.ErrorMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Null(feed.LastImport); // never posted
    }

    [Fact]
    public async Task ViewModel_import_posts_typed_envelope_and_reloads()
    {
        var feed = new FakeFeed(SnapshotWith(SampleAutomation(1)));
        using var vm = new AutomationsListPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        var result = await vm.ImportAsync("{\"version\":1,\"automations\":[]}");

        Assert.True(result.Success);
        Assert.Equal("{\"version\":1,\"automations\":[]}", feed.LastImport);
        Assert.Equal(2, feed.FetchCount); // initial load + reload after import
    }

    // ---- Generated-client feed (web useAutomations + sibling queries / mutations) ---

    [Fact]
    public async Task ClientFeed_fetch_reads_all_four_queries_and_parses_them()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"name\":\"Guard\",\"enabled\":true}]"));   // GET /automations
        api.ReturnsValue(Json("[{\"id\":7,\"display_name\":\"Model 3\"}]"));            // GET /vehicles
        api.ReturnsValue(Json("[{\"item_id\":\"1\",\"position\":0}]"));                  // GET /pinned
        api.ReturnsValue(Json("{\"items\":[{\"id\":5,\"automation_name\":\"Guard\",\"status\":\"success\",\"triggered_at\":\"2026-06-06T11:00:00Z\",\"duration_ms\":900,\"actions_total\":2,\"actions_succeeded\":2}],\"summary\":{\"total_executions\":3,\"success_rate\":100,\"avg_duration_ms\":900}}"));
        var feed = new AutomationsListClientFeed(api);

        var snapshot = await feed.FetchAsync(20, default);

        Assert.Single(snapshot.Automations);
        Assert.Equal("Guard", snapshot.Automations[0].Name);
        Assert.Single(snapshot.Vehicles);
        Assert.Equal("Model 3", snapshot.Vehicles[0].DisplayName);
        Assert.Single(snapshot.Pins);
        Assert.Equal("1", snapshot.Pins[0].ItemId);
        Assert.Single(snapshot.History);
        Assert.NotNull(snapshot.HistorySummary);
        Assert.Equal(3, snapshot.HistorySummary!.TotalExecutions);

        Assert.Equal(4, api.Requests.Count);
        Assert.Equal("get_api_v1_automations", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_vehicles", api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_pinned", api.Requests[2].OperationId);
        Assert.Equal("automation", api.Requests[2].Query!["type"]);
        Assert.Equal("get_api_v1_automations_history", api.Requests[3].OperationId);
        Assert.Equal(20, api.Requests[3].Query!["limit"]);
    }

    [Fact]
    public async Task ClientFeed_toggle_patches_by_id_with_enabled_flag()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AutomationsListClientFeed(api);

        await feed.ToggleAsync(42, true, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("patch_api_v1_automations_id_toggle", request.OperationId);
        Assert.Equal("42", request.PathParams!["id"]);
        var body = Assert.IsType<Dictionary<string, object?>>(request.Body);
        Assert.Equal(true, body["enabled"]);
    }

    [Fact]
    public async Task ClientFeed_reEnable_delete_testRun_target_the_right_operations()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}")).ReturnsValue(Json("{}")).ReturnsValue(Json("{}"));
        var feed = new AutomationsListClientFeed(api);

        await feed.ReEnableAsync(3, default);
        await feed.DeleteAsync(4, default);
        await feed.TestRunAsync(5, default);

        Assert.Equal("patch_api_v1_automations_id_re_enable", api.Requests[0].OperationId);
        Assert.Equal("3", api.Requests[0].PathParams!["id"]);
        Assert.Equal("delete_api_v1_automations_id", api.Requests[1].OperationId);
        Assert.Equal("4", api.Requests[1].PathParams!["id"]);
        Assert.Equal("post_api_v1_automations_id_test_run", api.Requests[2].OperationId);
        Assert.Equal("5", api.Requests[2].PathParams!["id"]);
    }

    [Fact]
    public async Task ClientFeed_import_posts_the_parsed_envelope_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new AutomationsListClientFeed(api);

        await feed.ImportAsync("{\"version\":1,\"automations\":[]}", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_automations_import", request.OperationId);
        var body = Assert.IsType<JsonElement>(request.Body);
        Assert.Equal(JsonValueKind.Object, body.ValueKind);
        Assert.Equal(1, body.GetProperty("version").GetInt32());
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new AutomationsListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationsListPage", Assert.Single(lines));
    }

    private static AutomationsListSnapshot SnapshotWith(params AutomationSummary[] items) => new(
        items,
        Array.Empty<AutomationVehicleRef>(),
        Array.Empty<AutomationPin>(),
        Array.Empty<AutomationHistoryEntry>(),
        null);

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

    private sealed class FakeFeed : IAutomationsListFeed
    {
        private readonly AutomationsListSnapshot _snapshot;

        public FakeFeed(AutomationsListSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public (long Id, bool Enabled)? LastToggle { get; private set; }

        public long? LastReEnable { get; private set; }

        public long? LastDelete { get; private set; }

        public long? LastTestRun { get; private set; }

        public string? LastImport { get; private set; }

        public Task<AutomationsListSnapshot> FetchAsync(int historyLimit, CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }

        public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken)
        {
            LastToggle = (id, enabled);
            return Task.CompletedTask;
        }

        public Task ReEnableAsync(long id, CancellationToken cancellationToken)
        {
            LastReEnable = id;
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken)
        {
            LastDelete = id;
            return Task.CompletedTask;
        }

        public Task TestRunAsync(long id, CancellationToken cancellationToken)
        {
            LastTestRun = id;
            return Task.CompletedTask;
        }

        public Task ImportAsync(string envelopeJson, CancellationToken cancellationToken)
        {
            LastImport = envelopeJson;
            return Task.CompletedTask;
        }

        public string? LastPin { get; private set; }

        public string? LastUnpin { get; private set; }

        public Task PinAsync(string automationId, CancellationToken cancellationToken)
        {
            LastPin = automationId;
            return Task.CompletedTask;
        }

        public Task UnpinAsync(string pinId, CancellationToken cancellationToken)
        {
            LastUnpin = pinId;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingFeed : IAutomationsListFeed
    {
        public Task<AutomationsListSnapshot> FetchAsync(int historyLimit, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task ReEnableAsync(long id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task DeleteAsync(long id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task TestRunAsync(long id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task ImportAsync(string envelopeJson, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");
    }
}
