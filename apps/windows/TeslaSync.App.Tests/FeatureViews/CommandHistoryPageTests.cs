using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CommandHistoryPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/CommandHistoryPage.tsx): the full-history stats (24h count / success rate /
/// most-used / last-sent), the status + search filtering and pagination, the <c>formatCommandName</c> /
/// <c>buildSubtitle</c> ports, the tolerant command-log / vehicle parsers, the view-model's four-state matrix
/// (loading / empty / error / success), and the generated-client feed's request shaping
/// (web <c>useSelectedVehicle</c> + <c>useCommandHistory?limit=200</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="CommandHistoryDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class CommandHistoryPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);

    // The 18 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "commandHistory.backToCommands",
        "commandHistory.filterAll",
        "commandHistory.filterFailed",
        "commandHistory.filterSuccess",
        "commandHistory.lastSent",
        "commandHistory.mostUsed",
        "commandHistory.noCommands",
        "commandHistory.noFilterResults",
        "commandHistory.searchCommands",
        "commandHistory.searchPlaceholder",
        "commandHistory.selectVehicle",
        "commandHistory.showing",
        "commandHistory.subtitle",
        "commandHistory.successRate",
        "commandHistory.timelineTitle",
        "commandHistory.title",
        "commandHistory.total24h",
        "filter.pending",
    ];

    private static CommandLogEntry Cmd(
        long id = 1,
        string command = "lock",
        string status = "success",
        string createdAt = "2026-06-12T17:30:00Z",
        string @params = "{}",
        string error = "") =>
        new(id, 7, command, @params, status, error, createdAt);

    private static IReadOnlyList<CommandLogEntry> SampleCommands() =>
    [
        Cmd(1, "lock", "success", "2026-06-12T17:30:00Z"),   // 30m ago, within 24h
        Cmd(2, "lock", "failed", "2026-06-12T10:00:00Z"),    // 8h ago, within 24h
        Cmd(3, "wake_up", "success", "2026-06-10T12:00:00Z"), // >2d ago, outside 24h
    ];

    private static CommandHistoryModel Model(
        IReadOnlyList<CommandLogEntry>? commands = null,
        CommandStatusFilter status = CommandStatusFilter.All,
        string search = "",
        int page = 1,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null,
        IReadOnlyList<CommandHistoryVehicle>? vehicles = null,
        long? selected = 7) =>
        new(
            Vehicles: vehicles ?? [new CommandHistoryVehicle(7, "Model 3")],
            SelectedVehicleId: selected,
            Commands: commands ?? SampleCommands(),
            Loading: loading,
            HasError: hasError,
            ErrorDetail: errorDetail,
            StatusFilter: status,
            SearchQuery: search,
            IsSearchPending: false,
            Page: page,
            PageSize: CommandHistoryRegistration.PageSize);

    // ---- Stats (web useMemo over the full history) ---------------------------------

    [Fact]
    public void Projection_computes_the_four_stat_tiles_from_the_full_history()
    {
        var display = CommandHistoryProjection.Project(Model(), Localizer, Now);

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Commands (24h)", display.StatCards[0].Label);
        Assert.Equal("2", display.StatCards[0].Value);              // 2 within the 24h window
        Assert.Equal("Success Rate", display.StatCards[1].Label);
        Assert.Equal("67%", display.StatCards[1].Value);            // round(2/3 * 100)
        Assert.Equal("Most Used", display.StatCards[2].Label);
        Assert.Equal("Lock", display.StatCards[2].Value);           // lock ×2 → friendly label
        Assert.Equal("Last Sent", display.StatCards[3].Label);
        Assert.Equal("30m ago", display.StatCards[3].Value);        // commands[0] is newest
    }

    [Fact]
    public void Projection_empty_history_zeroes_the_stats_with_em_dashes()
    {
        var display = CommandHistoryProjection.Project(
            Model(commands: Array.Empty<CommandLogEntry>()), Localizer, Now);

        Assert.Equal("0", display.StatCards[0].Value);
        Assert.Equal("0%", display.StatCards[1].Value);
        Assert.Equal(CommandHistoryProjection.EmDash, display.StatCards[2].Value);
        Assert.Equal(CommandHistoryProjection.EmDash, display.StatCards[3].Value);
    }

    // ---- Filtering + pagination (web filtered/paginatedCommands) -------------------

    [Fact]
    public void Projection_status_filter_failed_keeps_only_failed_rows()
    {
        var display = CommandHistoryProjection.Project(
            Model(status: CommandStatusFilter.Failed), Localizer, Now);

        Assert.Equal(1, display.FilteredTotal);
        Assert.True(display.ShowTimeline);
        Assert.Single(display.TimelineRows);
        Assert.Equal(CommandHistoryState.Success, display.State);
    }

    [Fact]
    public void Projection_search_matches_friendly_and_raw_command_names()
    {
        // "remote start" only matches the friendly label of remote_start_drive.
        var commands = new[] { Cmd(1, "remote_start_drive", "success"), Cmd(2, "lock", "success") };
        var display = CommandHistoryProjection.Project(
            Model(commands: commands, search: "remote start"), Localizer, Now);

        Assert.Equal(1, display.FilteredTotal);
        Assert.Equal("Remote Start", display.TimelineRows[0].Title);
    }

    [Fact]
    public void Projection_search_with_no_match_is_the_filtered_empty_state()
    {
        var display = CommandHistoryProjection.Project(
            Model(search: "no-such-command"), Localizer, Now);

        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowTimeline);
        Assert.Equal("No commands match the current filters", display.EmptyMessage);
        Assert.Equal(CommandHistoryState.Empty, display.State);
    }

    [Fact]
    public void Projection_unfiltered_empty_is_the_no_commands_state()
    {
        var display = CommandHistoryProjection.Project(
            Model(commands: Array.Empty<CommandLogEntry>()), Localizer, Now);

        Assert.True(display.ShowEmpty);
        Assert.Equal("No commands have been sent yet", display.EmptyMessage);
    }

    [Fact]
    public void Projection_paginates_to_the_page_size_and_shows_the_pager()
    {
        var commands = Enumerable.Range(1, 30)
            .Select(i => Cmd(i, "lock", "success", "2026-06-12T17:30:00Z"))
            .ToArray();

        var page1 = CommandHistoryProjection.Project(Model(commands: commands), Localizer, Now);
        Assert.Equal(30, page1.FilteredTotal);
        Assert.Equal(25, page1.TimelineRows.Count);
        Assert.True(page1.ShowPagination);
        Assert.Equal("30 commands", page1.ShowingText);

        var page2 = CommandHistoryProjection.Project(Model(commands: commands, page: 2), Localizer, Now);
        Assert.Equal(5, page2.TimelineRows.Count);
    }

    [Fact]
    public void Projection_loading_with_no_rows_is_the_loading_state()
    {
        var display = CommandHistoryProjection.Project(
            Model(commands: Array.Empty<CommandLogEntry>(), loading: true), Localizer, Now);

        Assert.True(display.ShowLoading);
        Assert.Equal(CommandHistoryState.Loading, display.State);
    }

    [Fact]
    public void Projection_error_with_no_rows_is_the_error_state_with_detail()
    {
        var display = CommandHistoryProjection.Project(
            Model(commands: Array.Empty<CommandLogEntry>(), hasError: true, errorDetail: "boom"),
            Localizer,
            Now);

        Assert.True(display.HasError);
        Assert.Equal(CommandHistoryState.Error, display.State);
        Assert.Contains("Failed to load data", display.ErrorBannerText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_status_tabs_mark_the_active_filter()
    {
        var display = CommandHistoryProjection.Project(Model(status: CommandStatusFilter.Success), Localizer, Now);

        Assert.Equal(3, display.StatusTabs.Count);
        Assert.Equal(CommandStatusFilter.Success, display.StatusTabs[1].Key);
        Assert.True(display.StatusTabs[1].IsActive);
        Assert.False(display.StatusTabs[0].IsActive);
        Assert.Equal("All", display.StatusTabs[0].Label);
        Assert.Equal("Success", display.StatusTabs[1].Label);
        Assert.Equal("Failed", display.StatusTabs[2].Label);
    }

    [Fact]
    public void Projection_exposes_the_vehicle_picker_and_back_link()
    {
        var display = CommandHistoryProjection.Project(
            Model(vehicles: [new CommandHistoryVehicle(7, "Model 3"), new CommandHistoryVehicle(8, null)]),
            Localizer,
            Now);

        Assert.Equal(2, display.VehicleOptions.Count);
        Assert.Equal("Model 3", display.VehicleOptions[0].Label);
        Assert.Equal("Vehicle 8", display.VehicleOptions[1].Label);   // null display name fallback
        Assert.Equal("Commands", display.BackToCommandsLabel);
        Assert.Equal("Select vehicle", display.SelectVehicleLabel);
        Assert.Equal("Filtering\u2026", display.SearchPendingLabel);
    }

    // ---- formatCommandName + buildSubtitle ports -----------------------------------

    [Theory]
    [InlineData("lock", "Lock")]
    [InlineData("remote_start_drive", "Remote Start")]
    [InlineData("set_pin_to_drive", "PIN to Drive")]
    [InlineData("custom_thing_here", "Custom Thing Here")] // not in the label map → title-cased
    public void FormatCommandName_maps_known_labels_and_title_cases_the_rest(string raw, string expected)
    {
        Assert.Equal(expected, CommandHistoryProjection.FormatCommandName(raw));
    }

    [Fact]
    public void FormatCommandName_null_is_the_em_dash()
    {
        Assert.Equal("\u2014", CommandHistoryProjection.FormatCommandName(null));
    }

    [Fact]
    public void BuildSubtitle_joins_params_and_error()
    {
        var cmd = Cmd(1, "set_temps", "failed", @params: "{\"temp\":21}", error: "vehicle asleep");

        var subtitle = CommandHistoryProjection.BuildSubtitle(cmd, Now);

        Assert.Equal("temp: 21 \u00b7 Error: vehicle asleep", subtitle);
    }

    [Fact]
    public void BuildSubtitle_raw_params_on_parse_failure()
    {
        var cmd = Cmd(1, "lock", "success", @params: "not-json");

        var subtitle = CommandHistoryProjection.BuildSubtitle(cmd, Now);

        Assert.Equal("not-json", subtitle);
    }

    [Fact]
    public void BuildSubtitle_falls_back_to_a_timestamp_when_empty()
    {
        var cmd = Cmd(1, "lock", "success", @params: "{}", error: "");

        var subtitle = CommandHistoryProjection.BuildSubtitle(cmd, Now);

        Assert.False(string.IsNullOrWhiteSpace(subtitle));
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_command_rows()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":5,\"vehicle_id\":7,\"command\":\"unlock\",\"params\":\"{}\",\"status\":\"success\",\"error\":\"\",\"created_at\":\"2026-06-12T17:00:00Z\"}]");

        var list = CommandLogEntry.ParseList(doc.RootElement);

        var entry = Assert.Single(list);
        Assert.Equal(5, entry.Id);
        Assert.Equal(7, entry.VehicleId);
        Assert.Equal("unlock", entry.Command);
        Assert.Equal("success", entry.Status);
        Assert.NotNull(entry.CreatedAtTime);
    }

    [Fact]
    public void ParseList_tolerates_non_arrays_and_partial_rows()
    {
        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(CommandLogEntry.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("[{\"command\":\"lock\"}]");
        var entry = Assert.Single(CommandLogEntry.ParseList(partial.RootElement));
        Assert.Equal(0, entry.Id);
        Assert.Null(entry.Status);
        Assert.Null(entry.CreatedAtTime);
    }

    [Fact]
    public void VehicleParseList_reads_id_and_display_name()
    {
        using var doc = JsonDocument.Parse("[{\"id\":7,\"display_name\":\"Model 3\"},{\"id\":8}]");

        var list = CommandHistoryVehicle.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal("Model 3", list[0].Label);
        Assert.Equal("Vehicle 8", list[1].Label);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new CommandHistoryPageViewModel(EmptyCommandHistoryFeed.Instance, Localizer, () => Now);

        Assert.Equal(CommandHistoryState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loads_into_success_and_selects_the_first_vehicle()
    {
        var feed = new FakeCommandHistoryFeed(
            [new CommandHistoryVehicle(42, "Model S")],
            SampleCommands());
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Success, vm.State);
        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastHistoryVehicleId);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new CommandHistoryPageViewModel(EmptyCommandHistoryFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
    }

    [Fact]
    public async Task ViewModel_vehicles_failure_is_the_error_state()
    {
        using var vm = new CommandHistoryPageViewModel(new ThrowingCommandHistoryFeed(failVehicles: true), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_history_failure_is_the_error_state()
    {
        using var vm = new CommandHistoryPageViewModel(new ThrowingCommandHistoryFeed(failVehicles: false), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Error, vm.State);
        Assert.True(vm.Display.HasError);
    }

    [Fact]
    public async Task ViewModel_status_filter_reprojects_without_a_reload()
    {
        var feed = new FakeCommandHistoryFeed([new CommandHistoryVehicle(1, "A")], SampleCommands());
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetStatusFilter(CommandStatusFilter.Failed);

        Assert.Equal(CommandStatusFilter.Failed, vm.StatusFilter);
        Assert.Equal(1, vm.Display.FilteredTotal);
        Assert.Equal(1, feed.HistoryFetches); // no extra network call
    }

    [Fact]
    public async Task ViewModel_search_resets_page_and_filters()
    {
        var feed = new FakeCommandHistoryFeed([new CommandHistoryVehicle(1, "A")], SampleCommands());
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetSearchQuery("wake");

        Assert.Equal("wake", vm.SearchQuery);
        Assert.Equal(1, vm.Page);
        Assert.Equal(1, vm.Display.FilteredTotal);
        Assert.Equal("Wake Up", vm.Display.TimelineRows[0].Title);
    }

    [Fact]
    public async Task ViewModel_set_page_slices_client_side()
    {
        var commands = Enumerable.Range(1, 30)
            .Select(i => Cmd(i, "lock", "success", "2026-06-12T17:30:00Z"))
            .ToArray();
        var feed = new FakeCommandHistoryFeed([new CommandHistoryVehicle(1, "A")], commands);
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetPage(2);

        Assert.Equal(2, vm.Page);
        Assert.Equal(5, vm.Display.TimelineRows.Count);
        Assert.Equal(1, feed.HistoryFetches);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_refetches_and_resets_page()
    {
        var feed = new FakeCommandHistoryFeed(
            [new CommandHistoryVehicle(1, "A"), new CommandHistoryVehicle(2, "B")],
            SampleCommands());
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetPage(1);

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2L, vm.SelectedVehicleId);
        Assert.Equal(2L, feed.LastHistoryVehicleId);
        Assert.Equal(1, vm.Page);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeCommandHistoryFeed([new CommandHistoryVehicle(1, "A")], SampleCommands());
        using var vm = new CommandHistoryPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RefreshAsync();

        Assert.Equal(2, feed.VehiclesFetches);
    }

    // ---- Generated-client feed (web useSelectedVehicle + useCommandHistory) --------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new CommandHistoryClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
    }

    [Fact]
    public async Task ClientFeed_history_sends_the_vehicle_path_and_limit_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new CommandHistoryClientFeed(api);

        _ = await feed.FetchHistoryAsync(7, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_commands_history", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.NotNull(request.Query);
        Assert.Equal(200, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new CommandHistoryClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(default));
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new CommandHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CommandHistoryPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_page_size_and_operations()
    {
        Assert.Equal("CommandHistory", CommandHistoryRegistration.RouteName);
        Assert.Equal("CommandHistoryPage", CommandHistoryRegistration.Slug);
        Assert.Equal(25, CommandHistoryRegistration.PageSize);
        Assert.Equal(200, CommandHistoryRegistration.HistoryLimit);
        Assert.Equal("get_api_v1_vehicles", CommandHistoryRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_vehicles_vehicleID_commands_history", CommandHistoryRegistration.HistoryOperation);
        Assert.Equal("Command History", CommandHistoryRegistration.Title(Localizer));
        Assert.Equal("Audit log of all vehicle commands", CommandHistoryRegistration.Subtitle(Localizer));
    }

    // ---- i18n key coverage (the manifest's 18 required keys) ------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // Two scenarios so both the no-commands and the filtered-empty messages are resolved.
        CommandHistoryProjection.Project(
            Model(commands: Array.Empty<CommandLogEntry>()), recorder, Now);
        CommandHistoryProjection.Project(
            Model(search: "no-match"), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeCommandHistoryFeed : ICommandHistoryFeed
    {
        private readonly IReadOnlyList<CommandHistoryVehicle> _vehicles;
        private readonly IReadOnlyList<CommandLogEntry> _commands;

        public FakeCommandHistoryFeed(
            IReadOnlyList<CommandHistoryVehicle> vehicles,
            IReadOnlyList<CommandLogEntry> commands)
        {
            _vehicles = vehicles;
            _commands = commands;
        }

        public int VehiclesFetches { get; private set; }

        public int HistoryFetches { get; private set; }

        public long? LastHistoryVehicleId { get; private set; }

        public Task<IReadOnlyList<CommandHistoryVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetches++;
            return Task.FromResult(_vehicles);
        }

        public Task<IReadOnlyList<CommandLogEntry>> FetchHistoryAsync(long vehicleId, CancellationToken cancellationToken)
        {
            HistoryFetches++;
            LastHistoryVehicleId = vehicleId;
            return Task.FromResult(_commands);
        }
    }

    private sealed class ThrowingCommandHistoryFeed : ICommandHistoryFeed
    {
        private readonly bool _failVehicles;

        public ThrowingCommandHistoryFeed(bool failVehicles) => _failVehicles = failVehicles;

        public Task<IReadOnlyList<CommandHistoryVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            if (_failVehicles)
            {
                throw new InvalidOperationException("Failed to load data");
            }

            return Task.FromResult<IReadOnlyList<CommandHistoryVehicle>>([new CommandHistoryVehicle(1, "A")]);
        }

        public Task<IReadOnlyList<CommandLogEntry>> FetchHistoryAsync(long vehicleId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }
}
