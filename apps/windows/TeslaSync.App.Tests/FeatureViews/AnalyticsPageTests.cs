using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Analytics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AnalyticsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/analytics/pages/AnalyticsPage.tsx), the tolerant fleet snapshot parsers, the
/// three-state matrix (loading / error / success), the four web tab labels, the replay sources that feed the
/// self-fetching tabs from the page's single read, the presentational tab models, the view-model lifecycle
/// and the generated-client feed's request shaping (web <c>useFleetAnalytics</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="AnalyticsDisplay"/> flags asserted here.
/// </summary>
public sealed class AnalyticsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The six i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "analytics.title",
        "analytics.subtitle",
        "analytics.tabs.overview",
        "analytics.tabs.driving",
        "analytics.tabs.charging",
        "analytics.tabs.battery",
    ];

    private const string SampleFleetJson = """
    {
      "period_days": 30,
      "total_vehicles": 2,
      "total_distance_km": 1000,
      "total_drives": 20,
      "total_charging_sessions": 8,
      "total_energy_kwh": 180,
      "total_cost": 42,
      "avg_efficiency_wh_km": 160,
      "drive_analytics": {
        "speed_distribution": [{ "range": "0-20", "count": 5 }, { "range": "20-40", "count": 7 }],
        "distance_distribution": [{ "range": "0-10", "count": 3 }],
        "duration_distribution": [{ "range": "0-30", "count": 2 }],
        "hourly_pattern": [{ "hour": 8, "drives": 4, "distance": 40 }],
        "temp_vs_efficiency": [{ "temp": 20, "efficiency": 150, "distance": 30 }],
        "daily_trend": [{ "date": "2026-06-01", "drives": 4, "distance": 40, "efficiency": 150 }],
        "speed_stats": { "min": 0, "avg": 30, "max": 60 },
        "power_stats": { "min": 0, "avg": 50, "max": 120 },
        "regen_stats": { "min": 0, "avg": 20, "max": 40 },
        "distance_stats": { "min": 1, "avg": 20, "max": 50 },
        "temperature": {
          "inside": { "min": 18, "avg": 21, "max": 24 },
          "outside": { "min": 10, "avg": 15, "max": 20 }
        }
      },
      "battery_trend": [
        { "date": "2026-06-01", "health_score": 98, "capacity_wh": 75000, "degradation_pct": 2, "range_km": 480, "cycle_count": 120 },
        { "date": "2026-06-02", "health_score": 97, "capacity_wh": 74800, "degradation_pct": 2.2, "range_km": 478, "cycle_count": 121 }
      ]
    }
    """;

    private static AnalyticsFleetSnapshot SampleSnapshot()
    {
        using var doc = JsonDocument.Parse(SampleFleetJson);
        return AnalyticsFleetSnapshot.FromJson(doc.RootElement);
    }

    private static AnalyticsPageModel SuccessModel() => new(SampleSnapshot(), false, null, AnalyticsTabKey.Overview);

    private static AnalyticsDisplay Project(AnalyticsPageModel model) => AnalyticsProjection.Project(model, Localizer);

    // ---- i18n key coverage (all six manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AnalyticsProjection.Project(SuccessModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = AnalyticsProjection.Project(AnalyticsPageModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_six_unique_keys() =>
        Assert.Equal(6, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Title_and_subtitle_use_the_web_defaults()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Fleet Analytics", display.Title);
        Assert.Equal("Comprehensive fleet performance insights", display.Subtitle);
    }

    // ---- Three data states ---------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(AnalyticsPageModel.Initial);

        Assert.Equal(AnalyticsPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_fleet_query_failed()
    {
        var model = new AnalyticsPageModel(AnalyticsFleetSnapshot.Empty, false, "network down", AnalyticsTabKey.Overview);
        var display = Project(model);

        Assert.Equal(AnalyticsPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_fleet_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(AnalyticsPageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_success_even_when_fleet_resolved_with_no_data()
    {
        // The fleet endpoint always returns an object; a dataless resolution is still success (the hero and
        // each tab render their own empty surface) rather than a page-level empty branch.
        using var doc = JsonDocument.Parse("{}");
        var snapshot = AnalyticsFleetSnapshot.FromJson(doc.RootElement);
        var display = Project(new AnalyticsPageModel(snapshot, false, null, AnalyticsTabKey.Overview));

        Assert.True(snapshot.HasFleet);
        Assert.Equal(AnalyticsPageState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ---- Tab strip -----------------------------------------------------------------

    [Fact]
    public void Tabs_project_the_four_web_tabs_in_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Tabs.Count);
        Assert.Equal(AnalyticsTabKey.Overview, display.Tabs[0].Key);
        Assert.Equal(AnalyticsTabKey.Driving, display.Tabs[1].Key);
        Assert.Equal(AnalyticsTabKey.Charging, display.Tabs[2].Key);
        Assert.Equal(AnalyticsTabKey.Battery, display.Tabs[3].Key);

        Assert.Equal("Overview", display.Tabs[0].Label);
        Assert.Equal("Driving", display.Tabs[1].Label);
        Assert.Equal("Charging", display.Tabs[2].Label);
        Assert.Equal("Battery", display.Tabs[3].Label);
    }

    [Fact]
    public void Tabs_carry_distinct_non_empty_glyphs()
    {
        var tabs = AnalyticsProjection.BuildTabs(Localizer);

        Assert.All(tabs, t => Assert.False(string.IsNullOrEmpty(t.Glyph)));
        Assert.Equal(4, tabs.Select(t => t.Glyph).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Active_tab_flows_through_the_projection()
    {
        var display = Project(new AnalyticsPageModel(SampleSnapshot(), false, null, AnalyticsTabKey.Charging));
        Assert.Equal(AnalyticsTabKey.Charging, display.ActiveTab);
    }

    // ---- Snapshot parsing ----------------------------------------------------------

    [Fact]
    public void FromJson_parses_drive_analytics_slices()
    {
        var snapshot = SampleSnapshot();
        Assert.True(snapshot.HasFleet);

        var da = snapshot.Driving;
        Assert.NotNull(da);
        Assert.Equal(2, da!.SpeedDistribution.Count);
        Assert.Equal("0-20", da.SpeedDistribution[0].Range);
        Assert.Equal(5, da.SpeedDistribution[0].Count);
        Assert.Single(da.DistanceDistribution);
        Assert.Single(da.DurationDistribution);
        Assert.Single(da.HourlyPattern);
        Assert.Equal(8, da.HourlyPattern[0].Hour);
        Assert.Single(da.TempVsEfficiency);
        Assert.Equal(150, da.TempVsEfficiency[0].Efficiency);
        Assert.Single(da.DailyTrend);
        Assert.Equal("2026-06-01", da.DailyTrend[0].Date);

        Assert.NotNull(da.SpeedStats);
        Assert.Equal(60, da.SpeedStats!.Max);
        Assert.NotNull(da.PowerStats);
        Assert.Equal(120, da.PowerStats!.Max);
        Assert.NotNull(da.Temperature);
        Assert.Equal(24, da.Temperature!.Inside!.Max);
        Assert.Equal(10, da.Temperature.Outside!.Min);
    }

    [Fact]
    public void FromJson_parses_battery_trend()
    {
        var snapshot = SampleSnapshot();

        Assert.Equal(2, snapshot.BatteryTrend.Count);
        Assert.Equal("2026-06-01", snapshot.BatteryTrend[0].Date);
        Assert.Equal(98, snapshot.BatteryTrend[0].HealthScore);
        Assert.Equal(75000, snapshot.BatteryTrend[0].CapacityWh);
        Assert.Equal(480, snapshot.BatteryTrend[0].RangeKm);
        Assert.Equal(121, snapshot.BatteryTrend[1].CycleCount);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_slices()
    {
        using var doc = JsonDocument.Parse("""{ "total_drives": 5 }""");
        var snapshot = AnalyticsFleetSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasFleet);
        Assert.Null(snapshot.Driving);
        Assert.Empty(snapshot.BatteryTrend);
    }

    [Fact]
    public void FromJson_returns_empty_for_a_non_object_body()
    {
        using var doc = JsonDocument.Parse("[]");
        var snapshot = AnalyticsFleetSnapshot.FromJson(doc.RootElement);

        Assert.False(snapshot.HasFleet);
        Assert.Null(snapshot.RawFleet);
        Assert.Null(snapshot.Driving);
        Assert.Empty(snapshot.BatteryTrend);
    }

    // ---- Presentational tab models -------------------------------------------------

    [Fact]
    public void BuildDrivingModel_is_ready_when_analytics_present()
    {
        var model = AnalyticsProjection.BuildDrivingModel(SampleSnapshot());

        Assert.Equal(DriveLoadPhase.Ready, model.Phase);
        Assert.NotNull(model.Analytics);
    }

    [Fact]
    public void BuildDrivingModel_is_empty_when_analytics_absent()
    {
        var model = AnalyticsProjection.BuildDrivingModel(AnalyticsFleetSnapshot.Empty);

        Assert.Equal(DriveLoadPhase.Ready, model.Phase);
        Assert.Null(model.Analytics);
    }

    [Fact]
    public void BuildBatteryModel_carries_the_trend_and_is_not_loading()
    {
        var model = AnalyticsProjection.BuildBatteryModel(SampleSnapshot());

        Assert.False(model.Loading);
        Assert.Equal(2, model.Trend.Count);
    }

    // ---- Replay sources (one fetch feeds the self-fetching tabs) --------------------

    [Fact]
    public async Task Hero_replay_source_maps_loaded_when_fleet_present()
    {
        var snapshot = SampleSnapshot();
        var result = await FirstAsync(new ReplayHeroGaugesSource(snapshot.RawFleet).StreamAsync());

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
    }

    [Fact]
    public async Task Hero_replay_source_maps_empty_when_fleet_absent()
    {
        var result = await FirstAsync(new ReplayHeroGaugesSource(null).StreamAsync());
        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public async Task Overview_replay_source_maps_loaded_when_fleet_present()
    {
        var snapshot = SampleSnapshot();
        var result = await FirstAsync(new ReplayOverviewTabSource(snapshot.RawFleet).StreamAsync());

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
    }

    [Fact]
    public async Task Charging_replay_source_maps_loaded_when_fleet_present()
    {
        var snapshot = SampleSnapshot();
        var result = await FirstAsync(new ReplayChargingTabSource(snapshot.RawFleet).StreamAsync());

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
    }

    [Fact]
    public async Task Replay_sources_map_empty_when_fleet_absent()
    {
        Assert.Equal(LoadStatus.Empty, (await FirstAsync(new ReplayOverviewTabSource(null).StreamAsync())).Status);
        Assert.Equal(LoadStatus.Empty, (await FirstAsync(new ReplayChargingTabSource(null).StreamAsync())).Status);
    }

    // ---- View-model lifecycle ------------------------------------------------------

    [Fact]
    public async Task ViewModel_transitions_loading_to_success()
    {
        using var vm = new AnalyticsPageViewModel(new StubFeed(SampleSnapshot), Localizer);
        Assert.Equal(AnalyticsPageState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(AnalyticsPageState.Success, vm.State);
        Assert.True(vm.Snapshot.HasFleet);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_when_feed_throws()
    {
        using var vm = new AnalyticsPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(AnalyticsPageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_bumps_data_version_on_each_load()
    {
        using var vm = new AnalyticsPageViewModel(new StubFeed(SampleSnapshot), Localizer);
        int before = vm.DataVersion;

        await vm.LoadAsync();

        Assert.True(vm.DataVersion > before);
    }

    [Fact]
    public void ViewModel_set_active_tab_updates_state_and_display()
    {
        using var vm = new AnalyticsPageViewModel(EmptyAnalyticsFleetFeed.Instance, Localizer);

        vm.SetActiveTab(AnalyticsTabKey.Battery);

        Assert.Equal(AnalyticsTabKey.Battery, vm.ActiveTab);
        Assert.Equal(AnalyticsTabKey.Battery, vm.Display.ActiveTab);
    }

    [Fact]
    public void ViewModel_records_view_opened()
    {
        var opened = 0;
        var diagnostics = new AnalyticsPageDiagnostics(_ => opened++);
        using var vm = new AnalyticsPageViewModel(EmptyAnalyticsFleetFeed.Instance, Localizer, diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, opened);
    }

    // ---- Generated-client feed request shaping -------------------------------------

    [Fact]
    public async Task ClientFeed_requests_the_fleet_operation_with_the_default_window()
    {
        using var doc = JsonDocument.Parse(SampleFleetJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var feed = new AnalyticsFleetClientFeed(api);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        var request = Assert.Single(api.Requests);
        Assert.Equal(AnalyticsRegistration.FleetOperation, request.OperationId);
        Assert.NotNull(request.Query);
        Assert.True(request.Query!.ContainsKey("days"));
        Assert.Equal(
            AnalyticsRegistration.DefaultDays,
            Convert.ToInt32(request.Query!["days"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.True(snapshot.HasFleet);
        Assert.Equal(2, snapshot.BatteryTrend.Count);
    }

    private static async Task<RepositoryResult<T>> FirstAsync<T>(IAsyncEnumerable<RepositoryResult<T>> sequence)
    {
        await foreach (var result in sequence)
        {
            return result;
        }

        throw new InvalidOperationException("the replay source yielded no emission");
    }

    private sealed class StubFeed : IAnalyticsFleetFeed
    {
        private readonly Func<AnalyticsFleetSnapshot> _factory;

        public StubFeed(Func<AnalyticsFleetSnapshot> factory) => _factory = factory;

        public Task<AnalyticsFleetSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_factory());
    }

    private sealed class ThrowingFeed : IAnalyticsFleetFeed
    {
        public Task<AnalyticsFleetSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("network down");
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
