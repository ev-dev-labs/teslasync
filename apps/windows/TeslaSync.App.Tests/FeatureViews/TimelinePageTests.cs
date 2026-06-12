using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Analytics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TimelinePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/analytics/pages/TimelinePage.tsx), the tolerant vehicles / timeline / summary parsers, the
/// view-model's four-state matrix (loading / empty / error / success), and the generated-client feed's request
/// shaping (web <c>useVehicles</c> + the two vehicle-states queries). The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="TimelineDisplay"/> flags asserted here.
/// </summary>
public sealed class TimelinePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);

    // The 23 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "error.loadFailed",
        "timeline.charging", "timeline.chargingTime", "timeline.dailyBreakdown",
        "timeline.driving", "timeline.drivingTime", "timeline.duration",
        "timeline.fromState", "timeline.idle", "timeline.idleSleepTime",
        "timeline.noDailyData", "timeline.noStateData", "timeline.noTransitions",
        "timeline.selectVehicle", "timeline.sleeping", "timeline.stateTimeline",
        "timeline.stateTransitions", "timeline.subtitle", "timeline.time",
        "timeline.title", "timeline.toState", "timeline.totalTransitions", "timeline.trigger",
    ];

    private static StateSummary SampleSummary() => new(
        TotalSeconds: 13200,
        ByState:
        [
            new ByStateRow("driving", 3600, 27.3, 5),
            new ByStateRow("charging", 1800, 13.6, 3),
            new ByStateRow("online", 600, 4.5, 2),
            new ByStateRow("asleep", 7200, 54.5, 1),
        ]);

    private static IReadOnlyList<TransitionRecord> SampleTransitions() =>
    [
        new TransitionRecord("2026-06-10T08:00:00Z", "asleep", "online", "vehicle_state", "online"),
        new TransitionRecord("2026-06-10T08:30:00Z", "online", "driving", "shift_state", "D"),
        new TransitionRecord("2026-06-11T09:00:00Z", "driving", "charging", "charge_state", "Charging"),
    ];

    private static TimelineModel SuccessModel() => new(
        Vehicles: [new TimelineVehicle(1, "Model 3", "VIN1")],
        SelectedVehicleId: 1,
        Days: 7,
        Transitions: SampleTransitions(),
        Summary: SampleSummary(),
        TimelineLoading: false,
        SummaryLoading: false,
        HasError: false,
        ErrorDetail: null);

    // ---- i18n key coverage (all 23 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = TimelineProjection.Project(SuccessModel(), recorder, Now);

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
        _ = TimelineProjection.Project(TimelineModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_first_query_in_flight()
    {
        var display = TimelineProjection.Project(TimelineModel.Initial, Localizer, Now);

        Assert.Equal(TimelineState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_vehicle_or_data()
    {
        var model = TimelineModel.Initial with { TimelineLoading = false, SummaryLoading = false };
        var display = TimelineProjection.Project(model, Localizer, Now);

        Assert.Equal(TimelineState.Empty, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.Equal(TimelinePanelMode.Empty, display.DistributionMode);
        Assert.Equal(TimelinePanelMode.Empty, display.DailyMode);
        Assert.False(display.ShowTransitions);
    }

    [Fact]
    public void State_error_shows_banner_above_content()
    {
        var model = TimelineModel.Initial with { TimelineLoading = false, SummaryLoading = false, HasError = true, ErrorDetail = "network down" };
        var display = TimelineProjection.Project(model, Localizer, Now);

        Assert.Equal(TimelineState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.True(display.ShowContent); // web renders the banner above the always-present panels
        Assert.Equal("Failed to load data: network down", display.ErrorBannerText);
    }

    [Fact]
    public void State_success_when_data_present()
    {
        var display = TimelineProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(TimelineState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.Equal(TimelinePanelMode.Content, display.DistributionMode);
        Assert.Equal(TimelinePanelMode.Content, display.DailyMode);
        Assert.True(display.ShowTransitions);
    }

    [Fact]
    public void Distribution_empty_shows_skeleton_while_summary_loads()
    {
        var model = TimelineModel.Initial with { TimelineLoading = false, SummaryLoading = true, Transitions = SampleTransitions() };
        var display = TimelineProjection.Project(model, Localizer, Now);

        Assert.Equal(TimelinePanelMode.Loading, display.DistributionMode);
    }

    // ---- Panels 1-4: summary metric cards ------------------------------------------

    [Fact]
    public void Metrics_project_labels_values_and_accents()
    {
        var display = TimelineProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(4, display.Metrics.Count);

        Assert.Equal("Total Transitions", display.Metrics[0].Label);
        Assert.Equal("11", display.Metrics[0].Value); // 5 + 3 + 2 + 1

        Assert.Equal("Driving Time", display.Metrics[1].Label);
        Assert.Equal("1h", display.Metrics[1].Value); // 3600s
        Assert.Equal("TsColorSuccessBrush", display.Metrics[1].AccentBrushKey);

        Assert.Equal("Charging Time", display.Metrics[2].Label);
        Assert.Equal("30m", display.Metrics[2].Value); // 1800s
        Assert.Equal("TsColorInfoBrush", display.Metrics[2].AccentBrushKey);

        Assert.Equal("Idle / Sleep Time", display.Metrics[3].Label);
        Assert.Equal("2h 10m", display.Metrics[3].Value); // online 600 + asleep 7200 = 7800s
    }

    // ---- Panel 5: state-distribution bar + legend ----------------------------------

    [Fact]
    public void Distribution_segments_sum_and_skip_sub_threshold_slices()
    {
        var summary = new StateSummary(10000,
        [
            new ByStateRow("driving", 5000, 50, 4),
            new ByStateRow("charging", 4980, 49.8, 2),
            new ByStateRow("idle", 20, 0.2, 1), // 0.2% < 0.3% threshold → skipped (web pct < 0.3)
        ]);
        var model = SuccessModel() with { Summary = summary };

        var display = TimelineProjection.Project(model, Localizer, Now);

        Assert.Equal(2, display.DistributionSegments.Count);
        Assert.Equal("driving", display.DistributionSegments[0].State);
        Assert.Equal("TsColorSuccessBrush", display.DistributionSegments[0].BrushKey);
        Assert.Equal(50d, display.DistributionSegments[0].WidthStar, 1);
    }

    [Fact]
    public void Distribution_legend_lists_all_eight_states()
    {
        var display = TimelineProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(8, display.Legend.Count);
        Assert.Equal("Driving", display.Legend[0].Label);
        Assert.Equal("Asleep", display.Legend[7].Label);
    }

    // ---- Panel 6: daily-breakdown bar chart ----------------------------------------

    [Fact]
    public void Daily_breakdown_bins_by_utc_day_and_buckets_by_destination_state()
    {
        var display = TimelineProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(2, display.DailyBars.Count);
        Assert.Equal("2026-06-10", display.DailyBars[0].Day);
        Assert.Equal(1, display.DailyBars[0].Driving);  // online→driving
        Assert.Equal(1, display.DailyBars[0].Idle);     // asleep→online (online bucketed as idle)
        Assert.Equal("2026-06-11", display.DailyBars[1].Day);
        Assert.Equal(1, display.DailyBars[1].Charging); // driving→charging

        // Series names are the four localized buckets the chart legend renders.
        Assert.Equal("Driving", display.DrivingSeriesName);
        Assert.Equal("Charging", display.ChargingSeriesName);
        Assert.Equal("Idle", display.IdleSeriesName);
        Assert.Equal("Sleeping", display.SleepingSeriesName);
    }

    // ---- Panel 7: transitions table ------------------------------------------------

    [Fact]
    public void Table_rows_carry_badges_durations_and_trigger_fallback()
    {
        var display = TimelineProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(3, display.Rows.Count);

        var first = display.Rows[0];
        Assert.Equal("asleep", first.FromState);
        Assert.Equal(StatusKind.Neutral, first.FromStatus);
        Assert.Equal("online", first.ToState);
        Assert.Equal(StatusKind.Info, first.ToStatus);
        Assert.Equal("30m", first.Duration); // 08:00 → 08:30
        Assert.Equal("vehicle_state", first.Trigger);

        // Newest row's duration is measured against `now` (web live age of the current state).
        var newest = display.Rows[2];
        Assert.NotEqual(TimelineProjection.EmDash, newest.Duration);
    }

    [Fact]
    public void Table_trigger_falls_back_to_em_dash_when_absent()
    {
        var model = SuccessModel() with
        {
            Transitions = [new TransitionRecord("2026-06-10T08:00:00Z", "online", "driving", null, null)],
        };

        var display = TimelineProjection.Project(model, Localizer, Now);

        Assert.Equal(TimelineProjection.EmDash, display.Rows[0].Trigger);
    }

    [Theory]
    [InlineData(45, "45s")]
    [InlineData(60, "1m")]
    [InlineData(3600, "1h")]
    [InlineData(5400, "1h 30m")]
    public void FormatDurationFromSeconds_matches_web(double seconds, string expected) =>
        Assert.Equal(expected, TimelineProjection.FormatDurationFromSeconds(seconds));

    [Theory]
    [InlineData("driving", StatusKind.Success)]
    [InlineData("charging", StatusKind.Info)]
    [InlineData("offline", StatusKind.Danger)]
    [InlineData("idle", StatusKind.Warning)]
    [InlineData("sleeping", StatusKind.Neutral)]
    public void BadgeFor_matches_web_state_badge(string state, StatusKind expected) =>
        Assert.Equal(expected, TimelineProjection.BadgeFor(state));

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Vehicles_parse_reads_id_and_label_fields()
    {
        using var doc = JsonDocument.Parse("[{\"id\":7,\"display_name\":\"Model Y\",\"vin\":\"X1\"},{\"vin\":\"X2\"}]");

        var vehicles = TimelineVehicle.ParseList(doc.RootElement);

        var only = Assert.Single(vehicles); // the second entry has no id and is skipped
        Assert.Equal(7L, only.Id);
        Assert.Equal("Model Y", only.Label);
    }

    [Fact]
    public void Timeline_parse_reads_transitions_envelope_and_bare_array()
    {
        using var envelope = JsonDocument.Parse(
            "{\"transitions\":[{\"ts\":\"2026-06-10T08:00:00Z\",\"from_state\":\"online\",\"to_state\":\"driving\",\"trigger_field\":\"shift_state\"}]}");
        var fromEnvelope = TransitionRecord.ParseList(envelope.RootElement);
        Assert.Single(fromEnvelope);
        Assert.Equal("online", fromEnvelope[0].FromState);
        Assert.Equal("driving", fromEnvelope[0].ToState);

        using var bare = JsonDocument.Parse("[{\"ts\":\"x\",\"from_state\":\"a\",\"to_state\":\"b\"}]");
        Assert.Single(TransitionRecord.ParseList(bare.RootElement));
    }

    [Fact]
    public void Summary_parse_reads_total_and_by_state_rows()
    {
        using var doc = JsonDocument.Parse(
            "{\"total_seconds\":1000,\"by_state\":[{\"state\":\"driving\",\"total_seconds\":600,\"percentage\":60,\"transition_count\":3}]}");

        var summary = StateSummary.FromJson(doc.RootElement);

        Assert.Equal(1000d, summary.TotalSeconds);
        var row = Assert.Single(summary.ByState);
        Assert.Equal("driving", row.State);
        Assert.Equal(600d, row.TotalSeconds);
        Assert.Equal(3, row.TransitionCount);
    }

    [Fact]
    public void Summary_parse_treats_unexpected_shapes_as_empty()
    {
        using var array = JsonDocument.Parse("[]");
        Assert.Empty(StateSummary.FromJson(array.RootElement).ByState);

        using var nul = JsonDocument.Parse("null");
        Assert.Equal(0d, StateSummary.FromJson(nul.RootElement).TotalSeconds);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_into_the_success_state_and_selects_the_first_vehicle()
    {
        var feed = new FakeTimelineFeed([new TimelineVehicle(42, "Model S", "VIN")], SampleTransitions(), SampleSummary());
        using var vm = new TimelinePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TimelineState.Success, vm.State);
        Assert.Equal(42L, vm.SelectedVehicleId);
        Assert.Equal(42L, feed.LastTimelineVehicleId);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new TimelinePageViewModel(EmptyTimelineFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TimelineState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
    }

    [Fact]
    public async Task ViewModel_vehicles_failure_is_the_error_state()
    {
        using var vm = new TimelinePageViewModel(new ThrowingFeed(failVehicles: true), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TimelineState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_timeline_failure_is_the_error_state()
    {
        using var vm = new TimelinePageViewModel(new ThrowingFeed(failVehicles: false), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TimelineState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_refetches_for_the_new_id()
    {
        var feed = new FakeTimelineFeed(
            [new TimelineVehicle(1, "A", "V1"), new TimelineVehicle(2, "B", "V2")],
            SampleTransitions(),
            SampleSummary());
        using var vm = new TimelinePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        Assert.Equal(1L, vm.SelectedVehicleId);

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2L, vm.SelectedVehicleId);
        Assert.Equal(2L, feed.LastTimelineVehicleId);
    }

    [Fact]
    public async Task ViewModel_set_days_refetches_with_the_new_window()
    {
        var feed = new FakeTimelineFeed([new TimelineVehicle(1, "A", "V1")], SampleTransitions(), SampleSummary());
        using var vm = new TimelinePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SetDaysAsync(30);

        Assert.Equal(30, vm.Days);
        Assert.Equal(30, feed.LastDays);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeTimelineFeed([new TimelineVehicle(1, "A", "V1")], SampleTransitions(), SampleSummary());
        using var vm = new TimelinePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.VehiclesFetches);
    }

    // ---- Generated-client feed (web useVehicles + the two vehicle-states queries) ---

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_list_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"display_name\":\"Model 3\"}]"));
        var feed = new TimelineClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Single(vehicles);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task ClientFeed_timeline_sends_snake_case_vehicle_and_days_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"transitions\":[]}"));
        var feed = new TimelineClientFeed(api);

        _ = await feed.FetchTimelineAsync(7, 30, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicle_states_timeline", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(30, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_summary_sends_snake_case_vehicle_and_days_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_seconds\":0,\"by_state\":[]}"));
        var feed = new TimelineClientFeed(api);

        _ = await feed.FetchSummaryAsync(9, 90, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicle_states_summary", request.OperationId);
        Assert.Equal(9L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(90, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new TimelineClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchVehiclesAsync(default));
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new TimelineDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimelinePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("Timeline", TimelineRegistration.RouteName);
        Assert.Equal("TimelinePage", TimelineRegistration.Slug);
        Assert.Equal("get_api_v1_vehicles", TimelineRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_vehicle_states_timeline", TimelineRegistration.TimelineOperation);
        Assert.Equal("get_api_v1_vehicle_states_summary", TimelineRegistration.SummaryOperation);
        Assert.Equal("Timeline", TimelineRegistration.Title(Localizer));
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

    private sealed class FakeTimelineFeed : ITimelineFeed
    {
        private readonly IReadOnlyList<TimelineVehicle> _vehicles;
        private readonly IReadOnlyList<TransitionRecord> _transitions;
        private readonly StateSummary _summary;

        public FakeTimelineFeed(
            IReadOnlyList<TimelineVehicle> vehicles,
            IReadOnlyList<TransitionRecord> transitions,
            StateSummary summary)
        {
            _vehicles = vehicles;
            _transitions = transitions;
            _summary = summary;
        }

        public int VehiclesFetches { get; private set; }

        public long? LastTimelineVehicleId { get; private set; }

        public int LastDays { get; private set; }

        public Task<IReadOnlyList<TimelineVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetches++;
            return Task.FromResult(_vehicles);
        }

        public Task<IReadOnlyList<TransitionRecord>> FetchTimelineAsync(long vehicleId, int days, CancellationToken cancellationToken)
        {
            LastTimelineVehicleId = vehicleId;
            LastDays = days;
            return Task.FromResult(_transitions);
        }

        public Task<StateSummary> FetchSummaryAsync(long vehicleId, int days, CancellationToken cancellationToken) =>
            Task.FromResult(_summary);
    }

    private sealed class ThrowingFeed : ITimelineFeed
    {
        private readonly bool _failVehicles;

        public ThrowingFeed(bool failVehicles) => _failVehicles = failVehicles;

        public Task<IReadOnlyList<TimelineVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            if (_failVehicles)
            {
                throw new InvalidOperationException("Failed to load data");
            }

            return Task.FromResult<IReadOnlyList<TimelineVehicle>>([new TimelineVehicle(1, "A", "V1")]);
        }

        public Task<IReadOnlyList<TransitionRecord>> FetchTimelineAsync(long vehicleId, int days, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<StateSummary> FetchSummaryAsync(long vehicleId, int days, CancellationToken cancellationToken) =>
            Task.FromResult(StateSummary.Empty);
    }
}
