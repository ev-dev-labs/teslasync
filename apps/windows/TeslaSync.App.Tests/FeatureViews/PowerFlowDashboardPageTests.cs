using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PowerFlowDashboardPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/PowerFlowDashboardPage.tsx), the tolerant live-status + history parsers (incl.
/// the platform <c>{data:…}</c> envelope and the no-data <c>{message:…}</c> response), the view-model's four-state
/// matrix (loading / empty / error / success) with the best-effort history overlay and the manual refresh, and the
/// generated-client feed's request shaping (the three web hooks). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="PowerFlowDisplay"/> flags asserted here.
/// </summary>
public sealed class PowerFlowDashboardPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);
    private static readonly UnitPref Metric = UnitPref.Metric;

    // The 33 i18n keys the manifest requires the page to resolve (web key names verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "powerFlow.backupCapable", "powerFlow.batteryLabel", "powerFlow.batteryPower", "powerFlow.batteryState",
        "powerFlow.charging", "powerFlow.discharging", "powerFlow.energyLeft", "powerFlow.exporting",
        "powerFlow.flowDiagram", "powerFlow.grid", "powerFlow.gridPower", "powerFlow.gridServices",
        "powerFlow.history", "powerFlow.home", "powerFlow.homeConsumption", "powerFlow.importing",
        "powerFlow.lastUpdate", "powerFlow.noBatteryData", "powerFlow.noFlowData", "powerFlow.powerOverTime",
        "powerFlow.powerOverTime.aria", "powerFlow.powerOverTimeDesc", "powerFlow.refresh", "powerFlow.socOverTime",
        "powerFlow.socOverTime.aria", "powerFlow.socOverTimeDesc", "powerFlow.solar", "powerFlow.solarPower",
        "powerFlow.stateOfCharge", "powerFlow.stormMode", "powerFlow.subtitle", "powerFlow.title",
        "powerFlow.totalCapacity",
    ];

    private static PowerFlowLiveReading SampleLive(
        double? solar = 3500,
        double? battery = -1500,
        double? load = 2000,
        double? grid = -800,
        double? gridServices = 0,
        double? energyLeft = 12500,
        double? totalPack = 13500,
        double? soc = 73,
        string? gridStatus = "Active",
        bool backup = true,
        bool storm = false,
        string? timestamp = "2026-06-12T11:59:00Z") =>
        new(true, 1, solar, battery, load, grid, gridServices, energyLeft, totalPack, soc, gridStatus, backup, storm, timestamp);

    private static PowerFlowHistoryEntry Sample(string ts, double solar, double battery, double grid, double load, double soc) =>
        new(ts, solar, battery, grid, load, soc);

    private static IReadOnlyList<PowerFlowHistoryEntry> SampleHistory() =>
    [
        Sample("2026-06-10T12:00:00Z", 3000, -1000, -500, 1500, 70),
        Sample("2026-06-11T12:00:00Z", 3500, -1500, -800, 2000, 73),
        Sample("2026-06-12T12:00:00Z", 4000, 500, 200, 2500, 68),
    ];

    private static PowerFlowModel SuccessModel(
        PowerFlowLiveReading? live = null,
        IReadOnlyList<PowerFlowHistoryEntry>? history = null) => new(
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        HasLive: true,
        Live: live ?? SampleLive(),
        HistoryLoading: false,
        History: history ?? SampleHistory());

    private static PowerFlowModel EmptyModel() =>
        PowerFlowModel.Initial with { Loading = false, HistoryLoading = false };

    private static PowerFlowDisplay Project(PowerFlowModel model, UnitPref? units = null) =>
        PowerFlowProjection.Project(model, Localizer, units ?? Metric, Now);

    // ── i18n key coverage (all 33 manifest strings, in every data state) ─────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();
        _ = PowerFlowProjection.Project(SuccessModel(), recorder, Metric, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        _ = PowerFlowProjection.Project(PowerFlowModel.Initial, recorder, Metric, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_in_the_empty_state()
    {
        var recorder = new RecordingLocalizer();
        _ = PowerFlowProjection.Project(EmptyModel(), recorder, Metric, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_live_query_in_flight()
    {
        var display = Project(PowerFlowModel.Initial);

        Assert.Equal(PowerFlowState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_snapshot()
    {
        var display = Project(EmptyModel());

        Assert.Equal(PowerFlowState.Empty, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.HasLive);
        Assert.False(display.HasBatteryData);
        Assert.False(display.HasFlowData);
        Assert.Equal("No battery data \u2014 refresh to fetch", display.NoBatteryDataMessage);
        Assert.Equal("No power flow data yet", display.NoFlowDataMessage);
    }

    [Fact]
    public void State_empty_shows_dash_for_every_current_power_tile()
    {
        var display = Project(EmptyModel());

        Assert.Equal("\u2014", display.SolarCard.Value);
        Assert.Equal("\u2014", display.BatteryCard.Value);
        Assert.Equal("\u2014", display.HomeCard.Value);
        Assert.Equal("\u2014", display.GridCard.Value);
    }

    [Fact]
    public void State_error_when_live_query_failed()
    {
        var model = PowerFlowModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down", HistoryLoading = false };
        var display = Project(model);

        Assert.Equal(PowerFlowState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_shows_scaffold()
    {
        var display = Project(SuccessModel());

        Assert.Equal(PowerFlowState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.HasLive);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Header_resolves_title_subtitle_and_refresh()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Power Flow", display.Title);
        Assert.Equal("Real-time power flow from your Tesla Energy system", display.Subtitle);
        Assert.Equal("Refresh from Tesla", display.RefreshLabel);
    }

    // ── Header badges (web Grid / Storm Mode / Backup Capable / Updated) ─────────────────────────────────

    [Fact]
    public void Grid_badge_is_success_and_visible_when_active()
    {
        var display = Project(SuccessModel());

        Assert.True(display.GridBadge.Visible);
        Assert.Equal("Grid: Active", display.GridBadge.Text);
        Assert.Equal(StatusKind.Success, display.GridBadge.Status);
    }

    [Theory]
    [InlineData(null, "Grid: \u2014")]
    [InlineData("Disconnected", "Grid: Disconnected")]
    public void Grid_badge_is_danger_when_not_active(string? status, string expected)
    {
        var display = Project(SuccessModel(SampleLive(gridStatus: status)));

        Assert.Equal(expected, display.GridBadge.Text);
        Assert.Equal(StatusKind.Danger, display.GridBadge.Status);
        Assert.True(display.GridBadge.Visible);
    }

    [Fact]
    public void Storm_badge_only_visible_when_storm_mode_active()
    {
        Assert.False(Project(SuccessModel()).StormBadge.Visible);

        var storm = Project(SuccessModel(SampleLive(storm: true)));
        Assert.True(storm.StormBadge.Visible);
        Assert.Equal("Storm Mode Active", storm.StormBadge.Text);
        Assert.Equal(StatusKind.Warning, storm.StormBadge.Status);
    }

    [Fact]
    public void Backup_badge_only_visible_when_backup_capable()
    {
        Assert.True(Project(SuccessModel()).BackupBadge.Visible);
        Assert.False(Project(SuccessModel(SampleLive(backup: false))).BackupBadge.Visible);
        Assert.Equal("Backup Capable", Project(SuccessModel()).BackupBadge.Text);
    }

    [Fact]
    public void Last_update_badge_visible_with_snapshot_and_hidden_when_empty()
    {
        var success = Project(SuccessModel());
        Assert.True(success.LastUpdateBadge.Visible);
        Assert.StartsWith("Updated", success.LastUpdateBadge.Text, StringComparison.Ordinal);
        Assert.Equal(StatusKind.Neutral, success.LastUpdateBadge.Status);

        Assert.False(Project(EmptyModel()).LastUpdateBadge.Visible);
    }

    [Fact]
    public void Last_update_badge_is_warning_when_snapshot_is_stale()
    {
        var stale = Project(SuccessModel(SampleLive(timestamp: "2026-06-12T11:00:00Z")));
        Assert.Equal(StatusKind.Warning, stale.LastUpdateBadge.Status);
    }

    // ── Panels 1-4: current-power tiles ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Current_power_tiles_format_watts_and_state_sublabels()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Solar Production", display.SolarCard.Label);
        Assert.Equal("3.5 kW", display.SolarCard.Value);

        Assert.Equal("Battery", display.BatteryCard.Label);
        Assert.Equal("-1.5 kW", display.BatteryCard.Value);
        Assert.Equal("Charging", display.BatteryCard.Sublabel);   // battery power < 0 → charging

        Assert.Equal("Home Consumption", display.HomeCard.Label);
        Assert.Equal("2.0 kW", display.HomeCard.Value);

        Assert.Equal("Grid", display.GridCard.Label);
        Assert.Equal("-800 W", display.GridCard.Value);
        Assert.Equal("Exporting", display.GridCard.Sublabel);     // grid power < 0 → exporting
    }

    [Fact]
    public void Battery_and_grid_sublabels_flip_for_discharging_and_importing()
    {
        var display = Project(SuccessModel(SampleLive(battery: 1200, grid: 600)));

        Assert.Equal("1.2 kW", display.BatteryCard.Value);
        Assert.Equal("Discharging", display.BatteryCard.Sublabel);
        Assert.Equal("600 W", display.GridCard.Value);
        Assert.Equal("Importing", display.GridCard.Sublabel);
    }

    // ── Panel 5: battery state ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Battery_state_panel_projects_soc_energy_and_capacity()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Battery State", display.BatteryStateTitle);
        Assert.True(display.HasBatteryData);
        Assert.Equal("State of Charge", display.StateOfChargeLabel);
        Assert.Equal("73.0%", display.SocValueText);
        Assert.Equal(73, display.SocPercent);
        Assert.True(display.SocBarVisible);
        Assert.Equal("Energy Remaining", display.EnergyLeftLabel);
        Assert.Equal("12.5 kWh", display.EnergyLeftValue);
        Assert.Equal("Total Capacity", display.TotalCapacityLabel);
        Assert.Equal("13.5 kWh", display.TotalCapacityValue);
    }

    [Fact]
    public void Battery_state_panel_is_null_safe_when_soc_missing()
    {
        var display = Project(SuccessModel(SampleLive(soc: null, energyLeft: null, totalPack: null)));

        Assert.Equal("\u2014", display.SocValueText);
        Assert.False(display.SocBarVisible);
        Assert.Equal(0, display.SocPercent);
        Assert.Equal("\u2014", display.EnergyLeftValue);
        Assert.Equal("\u2014", display.TotalCapacityValue);
    }

    [Fact]
    public void Soc_bar_is_clamped_to_one_hundred()
    {
        var display = Project(SuccessModel(SampleLive(soc: 142)));
        Assert.Equal(100, display.SocPercent);
    }

    // ── Panel 6: power-flow diagram ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Flow_diagram_has_three_arrows_when_no_grid_services()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Power Flow", display.FlowDiagramTitle);
        Assert.True(display.HasFlowData);
        Assert.Equal(3, display.FlowArrows.Count);

        Assert.Equal("Solar", display.FlowArrows[0].From);
        Assert.Equal("Home", display.FlowArrows[0].To);
        Assert.Equal("3.5 kW", display.FlowArrows[0].PowerText);
        Assert.True(display.FlowArrows[0].Active);
        Assert.False(display.FlowArrows[0].IsExport);   // solar power >= 0

        Assert.Equal("Battery", display.FlowArrows[1].From);
        Assert.True(display.FlowArrows[1].IsExport);    // battery power < 0

        Assert.Equal("Grid", display.FlowArrows[2].From);
        Assert.Equal("-800 W", display.FlowArrows[2].PowerText);
        Assert.True(display.FlowArrows[2].IsExport);
    }

    [Fact]
    public void Flow_diagram_adds_grid_services_arrow_when_non_zero()
    {
        var display = Project(SuccessModel(SampleLive(gridServices: 500)));

        Assert.Equal(4, display.FlowArrows.Count);
        Assert.Equal("Grid Services", display.FlowArrows[3].From);
        Assert.Equal("Grid", display.FlowArrows[3].To);
        Assert.Equal("500 W", display.FlowArrows[3].PowerText);
        Assert.True(display.FlowArrows[3].Active);
    }

    [Fact]
    public void Flow_arrow_is_inactive_when_no_power()
    {
        var display = Project(SuccessModel(SampleLive(solar: 0)));
        Assert.False(display.FlowArrows[0].Active);
    }

    // ── Panels 7/8: charts ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Power_over_time_chart_has_four_area_series_one_point_per_sample()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Power Over Time", display.PowerOverTimeTitle);
        Assert.Equal("Solar, battery, and grid power flow", display.PowerOverTimeDesc);
        Assert.Equal("Solar, battery, grid, and home power flow stacked area chart over time", display.PowerOverTimeAria);
        Assert.Equal(ChartState.Ready, display.PowerChartState);

        Assert.Equal(4, display.PowerSeries.Count);
        Assert.All(display.PowerSeries, s => Assert.Equal(ChartSeriesKind.Area, s.Kind));
        Assert.Collection(
            display.PowerSeries,
            s => Assert.Equal("Solar", s.Name),
            s => Assert.Equal("Battery", s.Name),
            s => Assert.Equal("Grid", s.Name),
            s => Assert.Equal("Home", s.Name));

        Assert.Equal(3, display.PowerSeries[0].Points.Count);
        Assert.Equal(3000, display.PowerSeries[0].Points[0].Y);   // history[0].solar_power (SI watts plotted)
        Assert.Equal(500, display.PowerSeries[1].Points[2].Y);    // history[2].battery_power
    }

    [Fact]
    public void Soc_over_time_chart_has_one_line_series()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Battery State of Charge", display.SocOverTimeTitle);
        Assert.Equal("Battery percentage over time", display.SocOverTimeDesc);
        Assert.Equal("Battery state of charge percentage over time line chart", display.SocOverTimeAria);

        var series = Assert.Single(display.SocSeries);
        Assert.Equal(ChartSeriesKind.Line, series.Kind);
        Assert.Equal("State of Charge", series.Name);
        Assert.Equal(3, series.Points.Count);
        Assert.Equal(73, series.Points[1].Y);
    }

    [Fact]
    public void Charts_are_empty_when_no_history()
    {
        var display = Project(SuccessModel(history: Array.Empty<PowerFlowHistoryEntry>()));

        Assert.Empty(display.PowerSeries);
        Assert.Empty(display.SocSeries);
        Assert.Equal(ChartState.Empty, display.PowerChartState);
        Assert.Equal(ChartState.Empty, display.SocChartState);
    }

    [Fact]
    public void Charts_are_in_loading_state_while_history_loads()
    {
        var display = Project(SuccessModel() with { HistoryLoading = true });

        Assert.Equal(ChartState.Loading, display.PowerChartState);
        Assert.Equal(ChartState.Loading, display.SocChartState);
    }

    [Fact]
    public void History_section_title_is_resolved()
    {
        Assert.Equal("Power History", Project(SuccessModel()).HistoryTitle);
    }

    // ── Magnitude-adaptive formatters (web fmtWatts / fmtWh) ─────────────────────────────────────────────

    [Theory]
    [InlineData(500, "500 W")]
    [InlineData(999, "999 W")]
    [InlineData(1000, "1.0 kW")]
    [InlineData(1500, "1.5 kW")]
    [InlineData(-2300, "-2.3 kW")]
    public void FormatWatts_matches_web(double watts, string expected) =>
        Assert.Equal(expected, PowerFlowProjection.FormatWatts(watts, Metric));

    [Theory]
    [InlineData(500, "500 Wh")]
    [InlineData(1000, "1.0 kWh")]
    [InlineData(13500, "13.5 kWh")]
    public void FormatWattHours_matches_web(double wh, string expected) =>
        Assert.Equal(expected, PowerFlowProjection.FormatWattHours(wh, Metric));

    [Fact]
    public void Formatters_return_em_dash_for_null()
    {
        Assert.Equal("\u2014", PowerFlowProjection.FormatWatts(null, Metric));
        Assert.Equal("\u2014", PowerFlowProjection.FormatWattHours(null, Metric));
    }

    // ── Tolerant JSON parsing ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Live_parse_unwraps_envelope_and_reads_snapshot()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"id\":7,\"solar_power\":3500,\"battery_power\":-1500,\"load_power\":2000," +
            "\"grid_power\":-800,\"energy_left\":12500,\"total_pack_energy\":13500,\"percentage_charged\":73," +
            "\"grid_status\":\"Active\",\"backup_capable\":true,\"storm_mode_active\":false," +
            "\"timestamp\":\"2026-06-12T11:59:00Z\"}}");

        var live = PowerFlowLiveReading.FromJson(doc.RootElement);

        Assert.True(live.HasData);
        Assert.Equal(7, live.Id);
        Assert.Equal(3500, live.SolarPower);
        Assert.Equal(-1500, live.BatteryPower);
        Assert.Equal(73, live.PercentageCharged);
        Assert.Equal("Active", live.GridStatus);
        Assert.True(live.BackupCapable);
        Assert.False(live.StormModeActive);
    }

    [Fact]
    public void Live_parse_treats_message_response_as_no_data()
    {
        using var message = JsonDocument.Parse("{\"message\":\"no live status data yet — use POST .../refresh\"}");
        Assert.False(PowerFlowLiveReading.FromJson(message.RootElement).HasData);

        using var notObject = JsonDocument.Parse("42");
        Assert.False(PowerFlowLiveReading.FromJson(notObject.RootElement).HasData);
    }

    [Fact]
    public void History_parse_reads_array_and_envelope()
    {
        using var bare = JsonDocument.Parse(
            "[{\"timestamp\":\"2026-06-12T12:00:00Z\",\"solar_power\":100,\"battery_power\":-50," +
            "\"grid_power\":10,\"load_power\":60,\"percentage_charged\":80}]");
        var fromArray = PowerFlowHistoryEntry.ListFromJson(bare.RootElement);
        var entry = Assert.Single(fromArray);
        Assert.Equal(100, entry.SolarPower);
        Assert.Equal(-50, entry.BatteryPower);
        Assert.Equal(80, entry.PercentageCharged);

        using var enveloped = JsonDocument.Parse("{\"data\":[{\"timestamp\":\"t\",\"solar_power\":5}]}");
        Assert.Single(PowerFlowHistoryEntry.ListFromJson(enveloped.RootElement));

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(PowerFlowHistoryEntry.ListFromJson(notArray.RootElement));
    }

    [Fact]
    public void History_parse_defaults_missing_power_to_zero()
    {
        using var doc = JsonDocument.Parse("[{\"timestamp\":\"t\"}]");
        var entry = Assert.Single(PowerFlowHistoryEntry.ListFromJson(doc.RootElement));
        Assert.Equal(0, entry.SolarPower);
        Assert.Equal(0, entry.PercentageCharged);
    }

    // ── View-model state matrix ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_live_and_history_into_the_success_state()
    {
        var feed = new FakePowerFlowFeed(SampleLive(), SampleHistory());
        using var vm = new PowerFlowDashboardPageViewModel(feed, Localizer, siteId: 1, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(PowerFlowState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.HasLive);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.LiveCount);
        Assert.Equal(1, feed.HistoryCount);
        Assert.Equal(PowerFlowProjection.HistoryLimit, feed.LastLimit);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new PowerFlowDashboardPageViewModel(EmptyPowerFlowFeed.Instance, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(PowerFlowState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.Display.HasLive);
    }

    [Fact]
    public async Task ViewModel_live_failure_is_the_error_state()
    {
        using var vm = new PowerFlowDashboardPageViewModel(new ThrowingLiveFeed(), Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(PowerFlowState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_history_failure_does_not_error_the_page()
    {
        // The history hook is independent of the page state — a failure leaves the charts empty, not errored.
        var feed = new HistoryThrowingFeed(SampleLive());
        using var vm = new PowerFlowDashboardPageViewModel(feed, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(PowerFlowState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Empty(vm.Display.PowerSeries);
        Assert.Equal(ChartState.Empty, vm.Display.PowerChartState);
    }

    [Fact]
    public async Task ViewModel_refresh_posts_then_reloads_through_the_feed()
    {
        var feed = new FakePowerFlowFeed(SampleLive(), SampleHistory());
        using var vm = new PowerFlowDashboardPageViewModel(feed, Localizer, clock: () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(1, feed.RefreshCount);
        Assert.Equal(2, feed.LiveCount);     // initial load + reload after refresh
        Assert.Equal(2, feed.HistoryCount);
        Assert.False(vm.IsRefreshing);
    }

    // ── Generated-client feed (the three web hooks) ──────────────────────────────────────────────────────

    [Fact]
    public async Task ClientFeed_live_status_sends_the_operation_with_site_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":3,\"percentage_charged\":55}"));
        var feed = new PowerFlowClientFeed(api);

        var live = await feed.FetchLiveStatusAsync(1, default);

        Assert.True(live.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tesla_energy_sites_siteID_live_status", request.OperationId);
        Assert.Equal("1", request.PathParams!["siteID"]);
    }

    [Fact]
    public async Task ClientFeed_history_sends_the_operation_with_since_until_limit()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new PowerFlowClientFeed(api);

        _ = await feed.FetchLiveStatusHistoryAsync(2, "2026-06-05", "2026-06-12", 1000, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tesla_energy_sites_siteID_live_status_history", request.OperationId);
        Assert.Equal("2", request.PathParams!["siteID"]);
        Assert.Equal("2026-06-05", request.Query!["since"]);
        Assert.Equal("2026-06-12", request.Query!["until"]);
        Assert.Equal("1000", request.Query!["limit"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_refresh_sends_the_post_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":9}"));
        var feed = new PowerFlowClientFeed(api);

        var live = await feed.RefreshLiveStatusAsync(1, default);

        Assert.True(live.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_tesla_energy_sites_siteID_live_status_refresh", request.OperationId);
        Assert.Equal("1", request.PathParams!["siteID"]);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 502));
        var feed = new PowerFlowClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchLiveStatusAsync(1, default));
        Assert.Equal(502, ex.StatusCode);
    }

    [Fact]
    public void ClientFeed_operations_resolve_against_the_generated_endpoint_table()
    {
        var api = new FakeApiClient();
        Assert.Equal(
            PowerFlowDashboardRegistration.OperationLiveStatus,
            api.ResolveEndpoint(PowerFlowDashboardRegistration.OperationLiveStatus).OperationId);
        Assert.Equal(
            PowerFlowDashboardRegistration.OperationHistory,
            api.ResolveEndpoint(PowerFlowDashboardRegistration.OperationHistory).OperationId);
        Assert.Equal(
            PowerFlowDashboardRegistration.OperationRefresh,
            api.ResolveEndpoint(PowerFlowDashboardRegistration.OperationRefresh).OperationId);
    }

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("PowerFlowDashboard", PowerFlowDashboardRegistration.RouteName);
        Assert.Equal(1, PowerFlowDashboardRegistration.DefaultSiteId);
        Assert.Equal("get_api_v1_tesla_energy_sites_siteID_live_status", PowerFlowDashboardRegistration.OperationLiveStatus);
        Assert.Equal("get_api_v1_tesla_energy_sites_siteID_live_status_history", PowerFlowDashboardRegistration.OperationHistory);
        Assert.Equal("post_api_v1_tesla_energy_sites_siteID_live_status_refresh", PowerFlowDashboardRegistration.OperationRefresh);
        Assert.Equal("Power Flow", PowerFlowDashboardRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new PowerFlowDashboardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PowerFlowDashboardPage", Assert.Single(lines));
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

    private sealed class FakePowerFlowFeed(PowerFlowLiveReading live, IReadOnlyList<PowerFlowHistoryEntry> history) : IPowerFlowFeed
    {
        public int LiveCount { get; private set; }

        public int HistoryCount { get; private set; }

        public int RefreshCount { get; private set; }

        public int LastLimit { get; private set; }

        public Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken)
        {
            LiveCount++;
            return Task.FromResult(live);
        }

        public Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
            long siteId, string? since, string? until, int limit, CancellationToken cancellationToken)
        {
            HistoryCount++;
            LastLimit = limit;
            return Task.FromResult(history);
        }

        public Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken)
        {
            RefreshCount++;
            return Task.FromResult(live);
        }
    }

    private sealed class ThrowingLiveFeed : IPowerFlowFeed
    {
        public Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("network down");

        public Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
            long siteId, string? since, string? until, int limit, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PowerFlowHistoryEntry>>(Array.Empty<PowerFlowHistoryEntry>());

        public Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken) =>
            Task.FromResult(PowerFlowLiveReading.Empty);
    }

    private sealed class HistoryThrowingFeed(PowerFlowLiveReading live) : IPowerFlowFeed
    {
        public Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken) =>
            Task.FromResult(live);

        public Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
            long siteId, string? since, string? until, int limit, CancellationToken cancellationToken) =>
            throw new ApiException("history unavailable", 503);

        public Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken) =>
            Task.FromResult(live);
    }
}
