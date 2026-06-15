using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SecurityAccessPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/SecurityAccessPage.tsx + components/security-access/helpers.ts), the tolerant
/// parsers (bool|string|number signal unions + the platform <c>{data:…}</c> envelope), the view-model's three-state
/// matrix (loading / error / success) and the generated-client feed's request shaping (web <c>useSecurityEvents</c>,
/// the polled <c>/security/latest</c> and <c>useVehicles</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="SecurityAccessDisplay"/> flags asserted here.
/// </summary>
public sealed class SecurityAccessPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 2, 0, 0, TimeSpan.Zero);

    // The 4 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.security.alert",
        "admin.security.subtitle",
        "admin.security.title",
        "error.loadFailed",
    ];

    private static SecurityEvent SecureLatest(string id = "1", string? createdAt = "2026-06-15T01:59:00Z") => new(
        Id: id,
        Locked: true,
        SentryMode: "On",
        DoorState: "Closed",
        FdWindow: "Closed",
        FpWindow: "Closed",
        RdWindow: "Closed",
        RpWindow: "Closed",
        HomelinkNearby: false,
        GuestMode: false,
        HomelinkDeviceCount: 2,
        DriverSeatOccupied: true,
        CenterDisplay: "On",
        ValetModeEnabled: false,
        ServiceMode: false,
        PairedPhoneKeyCount: 3,
        CreatedAt: createdAt);

    private static SecurityEvent InsecureLatest(string id = "2", string? createdAt = "2026-06-15T01:58:00Z") =>
        SecureLatest(id, createdAt) with { Locked = false, DoorState = "Open", FdWindow = "Open" };

    private static SecurityAccessModel SuccessModel(
        SecurityEvent? latest = null,
        IReadOnlyList<SecurityEvent>? history = null) => new(
        Latest: latest ?? SecureLatest(),
        History: history ?? [SecureLatest()],
        LoadingLatest: false,
        LoadingHistory: false,
        HasVehicle: true,
        VehiclesError: null,
        LatestError: null,
        HistoryError: null);

    // ---- i18n key coverage (all 4 manifest strings) --------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SecurityAccessProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SecurityAccessProjection.Project(SecurityAccessModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Three data states ---------------------------------------------------------

    [Fact]
    public void State_loading_when_initial_with_no_data()
    {
        var display = SecurityAccessProjection.Project(SecurityAccessModel.Initial, Localizer, Now);

        Assert.Equal(SecurityAccessState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowErrorBanner);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_error_when_a_read_failed()
    {
        var model = SecurityAccessModel.Initial with
        {
            LoadingLatest = false,
            LoadingHistory = false,
            HistoryError = "boom",
        };
        var display = SecurityAccessProjection.Project(model, Localizer, Now);

        Assert.Equal(SecurityAccessState.Error, display.State);
        Assert.True(display.ShowErrorBanner);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.Equal("Failed to load data: boom", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_error_prefers_the_vehicles_error_detail()
    {
        var model = SecurityAccessModel.Initial with
        {
            LoadingLatest = false,
            LoadingHistory = false,
            VehiclesError = "fleet down",
            HistoryError = "history down",
        };
        var display = SecurityAccessProjection.Project(model, Localizer, Now);

        Assert.Equal("Failed to load data: fleet down", display.ErrorText);
    }

    [Fact]
    public void State_success_when_security_state_resolved()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(SecurityAccessState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowErrorBanner);
        Assert.True(display.HasLatest);
    }

    // ---- Panel: GlassPanel1 (security alert) ---------------------------------------

    [Fact]
    public void Alert_panel_hidden_when_vehicle_is_secure()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(latest: SecureLatest()), Localizer, Now);

        Assert.False(display.ShowAlert);
        Assert.Equal(
            "\u26a0 Vehicle may not be secure \u2014 check lock, door, and window status.",
            display.AlertText);
    }

    [Fact]
    public void Alert_panel_shown_when_vehicle_is_not_secure()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(latest: InsecureLatest()), Localizer, Now);

        Assert.True(display.ShowAlert);
    }

    [Fact]
    public void Alert_panel_hidden_when_no_latest_snapshot()
    {
        var model = SuccessModel() with { Latest = null };
        var display = SecurityAccessProjection.Project(model, Localizer, Now);

        Assert.False(display.ShowAlert);
        Assert.False(display.HasLatest);
    }

    // ---- Panel: GlassPanel2 (live vehicle state) -----------------------------------

    [Fact]
    public void Live_panel_projects_status_rows_from_the_latest_snapshot()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(latest: SecureLatest()), Localizer, Now);

        Assert.True(display.HasLatest);
        Assert.Collection(
            display.StatusItems,
            s => AssertStatus(s, "Lock Status", "Locked", SecurityTone.Good),
            s => AssertStatus(s, "Sentry Mode", "Active", SecurityTone.Good),
            s => AssertStatus(s, "Doors", "Closed", SecurityTone.Good),
            s => Assert.Equal("Windows", s.Label));
        Assert.NotEmpty(display.LiveItems);
    }

    [Fact]
    public void Live_panel_status_reflects_an_insecure_vehicle()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(latest: InsecureLatest()), Localizer, Now);

        Assert.Collection(
            display.StatusItems,
            s => AssertStatus(s, "Lock Status", "Unlocked", SecurityTone.Bad),
            s => Assert.Equal("Sentry Mode", s.Label),
            s => AssertStatus(s, "Doors", "Open", SecurityTone.Bad),
            s => Assert.Equal(SecurityTone.Warn, s.Tone));
    }

    [Fact]
    public void Live_panel_is_empty_without_a_latest_snapshot()
    {
        var model = SuccessModel() with { Latest = null };
        var display = SecurityAccessProjection.Project(model, Localizer, Now);

        Assert.False(display.HasLatest);
        Assert.Empty(display.StatusItems);
        Assert.Empty(display.LiveItems);
        Assert.Equal("No live vehicle state available", display.LiveEmptyMessage);
    }

    // ---- History table + summary ---------------------------------------------------

    [Fact]
    public void History_table_has_five_columns()
    {
        var display = SecurityAccessProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Event History", display.HistoryTitle);
        Assert.Collection(
            display.Columns,
            c => AssertColumn(c, "time", "Time"),
            c => AssertColumn(c, "lock", "Lock"),
            c => AssertColumn(c, "sentry", "Sentry"),
            c => AssertColumn(c, "doors", "Doors"),
            c => AssertColumn(c, "windows", "Windows"));
    }

    [Fact]
    public void History_rows_format_each_cell()
    {
        var ev = SecureLatest(id: "row-7", createdAt: "2026-06-15T01:55:00Z");
        var display = SecurityAccessProjection.Project(SuccessModel(history: [ev]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("row-7", row.Id);
        Assert.Equal("5m ago", row.Time);
        Assert.Equal("Locked", row.Lock);
        Assert.Equal("On", row.Sentry);
        Assert.Equal("Closed", row.Doors);
        Assert.Equal("Closed", row.Windows);
    }

    [Fact]
    public void History_empty_message_is_projected_when_no_events()
    {
        var model = SuccessModel(history: []);
        var display = SecurityAccessProjection.Project(model, Localizer, Now);

        Assert.False(display.HasHistory);
        Assert.Equal("No security events recorded", display.HistoryEmptyMessage);
    }

    [Fact]
    public void Summary_stats_project_status_last_lock_uptime_and_total()
    {
        IReadOnlyList<SecurityEvent> history =
        [
            SecureLatest(id: "a", createdAt: "2026-06-15T01:55:00Z") with { SentryMode = "On" },
            InsecureLatest(id: "b", createdAt: "2026-06-15T01:50:00Z") with { SentryMode = "Off" },
        ];
        var display = SecurityAccessProjection.Project(SuccessModel(history: history), Localizer, Now);

        Assert.Collection(
            display.SummaryStats,
            s => Assert.Equal("Status", s.Label),
            s => Assert.Equal("Last Lock Change", s.Label),
            s =>
            {
                Assert.Equal("Sentry Uptime", s.Label);
                Assert.Equal("50.0%", s.Value);   // 1 of 2 events sentry-active
            },
            s =>
            {
                Assert.Equal("Total Events", s.Label);
                Assert.Equal("2", s.Value);
            });
    }

    // ---- Web helper ports ----------------------------------------------------------

    [Theory]
    [InlineData("On", true)]
    [InlineData("Off", false)]
    [InlineData("SentryOff", false)]
    [InlineData("", false)]
    public void IsSentryActive_matches_web_strings(string value, bool expected) =>
        Assert.Equal(expected, SecurityAccessProjection.IsSentryActive(value));

    [Fact]
    public void IsSentryActive_handles_bool_union()
    {
        Assert.True(SecurityAccessProjection.IsSentryActive(true));
        Assert.False(SecurityAccessProjection.IsSentryActive(false));
        Assert.False(SecurityAccessProjection.IsSentryActive(null));
    }

    [Fact]
    public void DoorClosed_is_tolerant_of_the_signal_union()
    {
        Assert.True(SecurityAccessProjection.DoorClosed(null));
        Assert.True(SecurityAccessProjection.DoorClosed(false));
        Assert.True(SecurityAccessProjection.DoorClosed("Closed"));
        Assert.True(SecurityAccessProjection.DoorClosed("0"));
        Assert.True(SecurityAccessProjection.DoorClosed(0d));
        Assert.False(SecurityAccessProjection.DoorClosed(true));
        Assert.False(SecurityAccessProjection.DoorClosed("Open"));
    }

    [Theory]
    [InlineData("Closed", SecurityWindowState.Closed)]
    [InlineData("0", SecurityWindowState.Closed)]
    [InlineData("Vented", SecurityWindowState.Venting)]
    [InlineData("Open", SecurityWindowState.Open)]
    public void ParseWindowState_classifies_window_strings(string value, SecurityWindowState expected) =>
        Assert.Equal(expected, SecurityAccessProjection.ParseWindowState(value));

    [Fact]
    public void ParseWindowState_unknown_for_non_string_values() =>
        Assert.Equal(SecurityWindowState.Unknown, SecurityAccessProjection.ParseWindowState(true));

    [Fact]
    public void IsSecure_requires_locked_doors_closed_and_windows_closed()
    {
        Assert.True(SecurityAccessProjection.IsSecure(null));
        Assert.True(SecurityAccessProjection.IsSecure(SecureLatest()));
        Assert.False(SecurityAccessProjection.IsSecure(InsecureLatest()));
        Assert.False(SecurityAccessProjection.IsSecure(SecureLatest() with { RpWindow = "Open" }));
    }

    [Fact]
    public void ComputeSentryUptime_is_the_active_percentage()
    {
        IReadOnlyList<SecurityEvent> events =
        [
            SecureLatest() with { SentryMode = "On" },
            SecureLatest() with { SentryMode = "Off" },
            SecureLatest() with { SentryMode = "On" },
        ];

        Assert.Equal(200d / 3, SecurityAccessProjection.ComputeSentryUptime(events), 3);
        Assert.Equal(0, SecurityAccessProjection.ComputeSentryUptime([]));
    }

    [Fact]
    public void ComputeSecurityStats_aggregates_counts_or_returns_null_when_empty()
    {
        Assert.Null(SecurityAccessProjection.ComputeSecurityStats([]));

        IReadOnlyList<SecurityEvent> history =
        [
            SecureLatest() with { Locked = true, DoorState = "Open", HomelinkNearby = true },
            SecureLatest() with { Locked = false, GuestMode = true },
        ];
        var stats = SecurityAccessProjection.ComputeSecurityStats(history);

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.Total);
        Assert.Equal(1, stats.LockEvents);
        Assert.Equal(1, stats.DoorOpenCount);
        Assert.Equal(1, stats.HomelinkCount);
        Assert.Equal(1, stats.GuestCount);
    }

    [Fact]
    public void FindLastLockChange_returns_the_transition_or_newest_time()
    {
        IReadOnlyList<SecurityEvent> events =
        [
            SecureLatest(id: "newest", createdAt: "2026-06-15T01:59:00Z") with { Locked = true },
            SecureLatest(id: "older", createdAt: "2026-06-15T01:50:00Z") with { Locked = false },
        ];

        Assert.Equal("2026-06-15T01:59:00Z", SecurityAccessProjection.FindLastLockChange(events));
        Assert.Null(SecurityAccessProjection.FindLastLockChange([]));
    }

    // ---- Formatting ----------------------------------------------------------------

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData("not-a-date", "\u2014")]
    [InlineData("2026-06-15T01:59:45Z", "just now")]
    [InlineData("2026-06-15T01:55:00Z", "5m ago")]
    [InlineData("2026-06-14T23:00:00Z", "3h ago")]
    [InlineData("2026-06-12T02:00:00Z", "3d ago")]
    public void FormatRelative_matches_web_tiers(string? raw, string expected) =>
        Assert.Equal(expected, SecurityAccessProjection.FormatRelative(raw, Now));

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "5")]
    [InlineData(12345, "12,345")]
    public void FormatCount_matches_web(int value, string expected) =>
        Assert.Equal(expected, SecurityAccessProjection.FormatCount(value));

    [Theory]
    [InlineData(0.0, "0.0%")]
    [InlineData(50.0, "50.0%")]
    [InlineData(66.6667, "66.7%")]
    public void FormatPercent_matches_web(double value, string expected) =>
        Assert.Equal(expected, SecurityAccessProjection.FormatPercent(value));

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void SecurityEvent_parse_reads_snake_case_and_signal_unions()
    {
        using var doc = JsonDocument.Parse(
            "{\"id\":\"abc\",\"locked\":true,\"sentry_mode\":\"On\",\"door_state\":\"Closed\"," +
            "\"fd_window\":\"Closed\",\"paired_phone_key_count\":4,\"driver_seat_occupied\":false," +
            "\"created_at\":\"2026-06-15T01:00:00Z\"}");

        var ev = SecurityEvent.FromJson(doc.RootElement);

        Assert.Equal("abc", ev.Id);
        Assert.True(ev.Locked);
        Assert.Equal("On", ev.SentryMode);
        Assert.Equal("Closed", ev.DoorState);
        Assert.Equal(4, ev.PairedPhoneKeyCount);
        Assert.False(ev.DriverSeatOccupied);
        Assert.Equal("2026-06-15T01:00:00Z", ev.CreatedAt);
    }

    [Fact]
    public void SecurityEvent_parse_tolerates_bool_and_number_signal_unions()
    {
        using var doc = JsonDocument.Parse("{\"sentry_mode\":true,\"door_state\":0}");
        var ev = SecurityEvent.FromJson(doc.RootElement);

        Assert.Equal(true, ev.SentryMode);
        Assert.Equal(0d, ev.DoorState);
    }

    [Fact]
    public void ParseLatest_unwraps_the_data_envelope()
    {
        using var doc = JsonDocument.Parse("{\"data\":{\"locked\":true,\"door_state\":\"Closed\"}}");
        var latest = SecurityEvent.ParseLatest(doc.RootElement);

        Assert.NotNull(latest);
        Assert.True(latest!.Locked);
    }

    [Fact]
    public void ParseLatest_returns_null_for_a_non_object()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(SecurityEvent.ParseLatest(doc.RootElement));
    }

    [Fact]
    public void ParseHistory_reads_a_bare_array()
    {
        using var doc = JsonDocument.Parse("[{\"id\":\"1\"},{\"id\":\"2\"}]");
        var history = SecurityEvent.ParseHistory(doc.RootElement);

        Assert.Equal(2, history.Count);
        Assert.Equal("1", history[0].Id);
    }

    [Fact]
    public void ParseHistory_reads_the_data_and_events_envelopes()
    {
        using var dataDoc = JsonDocument.Parse("{\"data\":[{\"id\":\"d\"}]}");
        Assert.Equal("d", Assert.Single(SecurityEvent.ParseHistory(dataDoc.RootElement)).Id);

        using var eventsDoc = JsonDocument.Parse("{\"events\":[{\"id\":\"e\"}]}");
        Assert.Equal("e", Assert.Single(SecurityEvent.ParseHistory(eventsDoc.RootElement)).Id);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_vehicles_latest_and_history_into_success()
    {
        var feed = new FakeFeed
        {
            Vehicles = [new VehicleOption(7, "Model 3")],
            Latest = SecureLatest(),
            History = [SecureLatest()],
        };
        using var vm = new SecurityAccessPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecurityAccessState.Success, vm.State);
        Assert.True(vm.Display.HasLatest);
        Assert.Equal(7, vm.SelectedVehicleId);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_history_failure_is_the_error_state()
    {
        var feed = new FakeFeed
        {
            Vehicles = [new VehicleOption(7, "Model 3")],
            Latest = SecureLatest(),
            HistoryError = new InvalidOperationException("history boom"),
        };
        using var vm = new SecurityAccessPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecurityAccessState.Error, vm.State);
        Assert.True(vm.Display.ShowErrorBanner);
        Assert.True(vm.IsError);
        Assert.Contains("history boom", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_set_vehicle_reloads_the_scoped_reads()
    {
        var feed = new FakeFeed
        {
            Vehicles = [new VehicleOption(7, "Model 3"), new VehicleOption(9, "Model Y")],
            Latest = SecureLatest(),
            History = [SecureLatest()],
        };
        using var vm = new SecurityAccessPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        Assert.Equal(7, vm.SelectedVehicleId);

        await vm.SetVehicleAsync(9);

        Assert.Equal(9, vm.SelectedVehicleId);
        Assert.Contains(9, feed.LatestVehicleIds);
        Assert.Contains(9, feed.HistoryVehicleIds);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed
        {
            Vehicles = [new VehicleOption(7, "Model 3")],
            Latest = SecureLatest(),
            History = [SecureLatest()],
        };
        using var vm = new SecurityAccessPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.VehiclesFetchCount);
    }

    // ---- Generated-client feed (web hooks) -----------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_vehicles_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":7,\"display_name\":\"Model 3\"}]"));
        var feed = new SecurityAccessClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        var vehicle = Assert.Single(vehicles);
        Assert.Equal(7, vehicle.Id);
        Assert.Equal("get_api_v1_vehicles", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_latest_sends_the_security_latest_operation_with_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"locked\":true,\"door_state\":\"Closed\"}"));
        var feed = new SecurityAccessClientFeed(api);

        var latest = await feed.FetchLatestAsync(7, default);

        Assert.NotNull(latest);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security_latest", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_history_sends_the_security_operation_with_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":\"1\"}]"));
        var feed = new SecurityAccessClientFeed(api);

        var history = await feed.FetchSecurityEventsAsync(7, default);

        Assert.Single(history);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exceptions()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SecurityAccessClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchSecurityEventsAsync(7, default));
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_operations_resolve_in_the_generated_table()
    {
        var api = new FakeApiClient();

        Assert.Equal(
            SecurityAccessRegistration.HistoryOperation,
            api.ResolveEndpoint(SecurityAccessRegistration.HistoryOperation).OperationId);
        Assert.Equal(
            SecurityAccessRegistration.LatestOperation,
            api.ResolveEndpoint(SecurityAccessRegistration.LatestOperation).OperationId);
        Assert.Equal(
            SecurityAccessRegistration.VehiclesOperation,
            api.ResolveEndpoint(SecurityAccessRegistration.VehiclesOperation).OperationId);
    }

    [Fact]
    public void Registration_exposes_route_and_title()
    {
        Assert.Equal("SecurityAccess", SecurityAccessRegistration.RouteName);
        Assert.Equal("Security & Access", SecurityAccessRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SecurityAccessDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecurityAccessPage", Assert.Single(lines));
    }

    private static void AssertStatus(SecurityStatusItem item, string label, string value, SecurityTone tone)
    {
        Assert.Equal(label, item.Label);
        Assert.Equal(value, item.Value);
        Assert.Equal(tone, item.Tone);
    }

    private static void AssertColumn(SecurityEventColumn column, string key, string header)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
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

    private sealed class FakeFeed : ISecurityAccessFeed
    {
        public IReadOnlyList<VehicleOption> Vehicles { get; init; } = Array.Empty<VehicleOption>();

        public SecurityEvent? Latest { get; init; }

        public IReadOnlyList<SecurityEvent> History { get; init; } = Array.Empty<SecurityEvent>();

        public Exception? HistoryError { get; init; }

        public int VehiclesFetchCount { get; private set; }

        public List<long> LatestVehicleIds { get; } = [];

        public List<long> HistoryVehicleIds { get; } = [];

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetchCount++;
            return Task.FromResult(Vehicles);
        }

        public Task<SecurityEvent?> FetchLatestAsync(long vehicleId, CancellationToken cancellationToken)
        {
            LatestVehicleIds.Add(vehicleId);
            return Task.FromResult(Latest);
        }

        public Task<IReadOnlyList<SecurityEvent>> FetchSecurityEventsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            HistoryVehicleIds.Add(vehicleId);
            if (HistoryError is not null)
            {
                throw HistoryError;
            }

            return Task.FromResult(History);
        }
    }
}
