using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ChargingListPage's UI-thread-free logic — the session JSON parse adapter, the
/// charging aggregation helpers (charger category, period stats, anomaly + notable detection, daily trend, prior
/// period), the structured search mini-language, the cache-then-network result mapper, the repository source's
/// request shape (web <c>useChargingSessionsPaginated</c>), the projection (overview KPIs, prior-period deltas,
/// collection pills, sort options, trend metrics, date-grouped rows, anomaly callout, conditional sections, and
/// the four data states), the CSV / JSON export serializers, the state-holder view-model (loading / success /
/// empty / error plus search / collection / sort / paging / bulk-selection / bulk-delete / unit reproject), the
/// i18n facade key coverage for all 67 source strings, the registration metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/charging/pages/ChargingListPage.tsx). The WinUI view itself is exercised
/// by the app build; its per-state branch selection is driven entirely by the asserted state + display model.
/// </summary>
public sealed class ChargingListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 3, 31, 12, 0, 0, TimeSpan.Zero);

    private static readonly string[] ExpectedStringKeys =
    {
        "bulk.actions.delete", "bulk.deleteConfirmDescription", "bulk.deleteConfirmTitle",
        "bulk.noun.session_one", "bulk.noun.session_other", "charging.allSessions", "charging.anomalyCount",
        "charging.anomaly_one", "charging.anomaly_other", "charging.avgDuration", "charging.avgPower",
        "charging.avgRate", "charging.avgScore", "charging.batteryScore", "charging.byType", "charging.coll.all",
        "charging.coll.anomalies", "charging.coll.dc", "charging.coll.free", "charging.coll.home",
        "charging.coll.notable", "charging.coll.supercharger", "charging.coll.tagged", "charging.collections.aria",
        "charging.empty.cta", "charging.emptyForCollection", "charging.emptyForCollection.msg",
        "charging.emptyMessage", "charging.emptyTitle", "charging.filterLabel.collection",
        "charging.filterLabel.search", "charging.freeCount", "charging.itemNoun", "charging.list.subtitle",
        "charging.list.title", "charging.metric.cost", "charging.metric.energy", "charging.metric.power",
        "charging.metric.sessions", "charging.mostCommon", "charging.noPriorData", "charging.noStatsRange",
        "charging.overTime", "charging.overTime.aria", "charging.overTime.empty", "charging.overview",
        "charging.priorPeriod", "charging.results", "charging.searchPlaceholder", "charging.section.batteryDist",
        "charging.section.batteryDistDesc", "charging.section.optimizer", "charging.section.optimizerDesc",
        "charging.section.specs", "charging.sort.cost", "charging.sort.date", "charging.sort.duration",
        "charging.sort.energy", "charging.sort.power", "charging.stickyBar.aria", "charging.totalCost",
        "charging.totalEnergy", "charging.totalSessions", "charging.viewAnomalies", "common.delete",
        "common.noData", "filter.pending",
    };

    private const string SampleJson = """
    [
      {"id":10,"started_at":"2026-03-15T10:00:00Z","ended_at":"2026-03-15T11:00:00Z","charger_type":"supercharger","total_energy_added_wh":42000,"cost_decimal":12.5,"peak_power_w":150000,"start_soc_pct":20,"end_soc_pct":80,"start_place":"Costco"},
      {"id":11,"started_at":"2026-03-16T09:00:00Z","total_energy_added_wh":"1500","cost_decimal":0,"charger_type":null}
    ]
    """;

    // ---- Parsing -------------------------------------------------------------------

    [Fact]
    public void ParseList_maps_every_field_and_tolerates_partial_rows()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var sessions = ChargingListSession.ParseList(doc.RootElement);

        Assert.Equal(2, sessions.Count);
        Assert.Equal(10, sessions[0].Id);
        Assert.Equal("supercharger", sessions[0].ChargerType);
        Assert.Equal(42000, sessions[0].TotalEnergyAddedWh);
        Assert.Equal(12.5, sessions[0].CostDecimal);
        Assert.Equal(150000, sessions[0].PeakPowerW);
        Assert.Equal(20, sessions[0].StartSocPct);
        Assert.NotNull(sessions[0].EndedAt);

        // String-encoded energy + null end/charger tolerated.
        Assert.Equal(11, sessions[1].Id);
        Assert.Equal(1500, sessions[1].TotalEnergyAddedWh);
        Assert.Null(sessions[1].EndedAt);
        Assert.Null(sessions[1].ChargerType);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(ChargingListSession.ParseList(doc.RootElement));
    }

    // ---- Charger category + session helpers ----------------------------------------

    [Theory]
    [InlineData(null, ChargerCategory.Home)]
    [InlineData("", ChargerCategory.Home)]
    [InlineData("Supercharger V3", ChargerCategory.Supercharger)]
    [InlineData("TPC", ChargerCategory.Supercharger)]
    [InlineData("CCS DC", ChargerCategory.Dc)]
    [InlineData("CHAdeMO", ChargerCategory.Dc)]
    [InlineData("Home Wall Connector", ChargerCategory.Home)]
    [InlineData("mystery", ChargerCategory.Unknown)]
    public void GetChargerCategory_ports_the_web_buckets(string? type, ChargerCategory expected) =>
        Assert.Equal(expected, ChargingAggregation.GetChargerCategory(type));

    [Fact]
    public void DurationMinutes_and_AvgPowerW_compute_from_timestamps()
    {
        var s = Session(1, "2026-03-15", energyWh: 30000, cost: null, durMin: 60);
        Assert.Equal(60, ChargingAggregation.DurationMinutes(s), 3);
        Assert.Equal(30000, ChargingAggregation.AvgPowerW(s), 3); // 30 kWh over 1h = 30 kW
    }

    [Fact]
    public void DurationMinutes_is_zero_for_in_progress_session()
    {
        var s = Session(1, "2026-03-15", energyWh: 1000, cost: null, durMin: 0);
        Assert.Equal(0, ChargingAggregation.DurationMinutes(s));
    }

    // ---- Period stats --------------------------------------------------------------

    [Fact]
    public void ComputeChargingPeriodStats_aggregates_counts_totals_and_categories()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-10", energyWh: 30000, cost: 10, charger: "supercharger", durMin: 60, startSoc: 20, endSoc: 80, hour: 22),
            Session(2, "2026-03-11", energyWh: 10000, cost: 0, charger: "home", durMin: 120, startSoc: 40, endSoc: 70, hour: 22),
        };

        var stats = ChargingAggregation.ComputeChargingPeriodStats(sessions, null, null);

        Assert.Equal(2, stats.Count);
        Assert.Equal(40000, stats.TotalEnergyWh, 3);
        Assert.Equal(10, stats.TotalCost, 3);
        Assert.Equal(1, stats.SuperchargerCount);
        Assert.Equal(1, stats.HomeCount);
        Assert.Equal(1, stats.FreeCount);          // session 2 has zero cost
        Assert.Equal(22, stats.MostCommonStartHour); // both start at 22:00
        Assert.NotNull(stats.AvgRateKw);
        Assert.NotNull(stats.BatteryFriendlyScore);
    }

    [Fact]
    public void ComputeChargingPeriodStats_respects_the_date_window()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-10", energyWh: 1000, cost: 1),
            Session(2, "2026-02-10", energyWh: 1000, cost: 1),
        };

        var stats = ChargingAggregation.ComputeChargingPeriodStats(sessions, "2026-03-01", "2026-03-31");
        Assert.Equal(1, stats.Count);
    }

    [Fact]
    public void PriorPeriod_computes_the_preceding_equal_window()
    {
        var prior = ChargingAggregation.PriorPeriod("2026-03-01", "2026-03-31");
        Assert.NotNull(prior);
        Assert.Equal("2026-01-29", prior!.Value.Start);
        Assert.Equal("2026-02-28", prior.Value.End);
    }

    // ---- Anomalies + notable -------------------------------------------------------

    [Fact]
    public void DetectChargingAnomalies_applies_first_matching_rule()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-10", energyWh: 0, cost: null, charger: "home", durMin: 60),          // telemetry_gap
            Session(2, "2026-03-10", energyWh: 10000, cost: 10, charger: "supercharger", durMin: 30), // expensive (cpk = 1.0)
            Session(3, "2026-03-10", energyWh: 30000, cost: 3, charger: "home", durMin: 60),          // normal
        };

        var anomalies = ChargingAggregation.DetectChargingAnomalies(sessions, "$");

        Assert.Equal(2, anomalies.Count);
        Assert.Equal("telemetry_gap", anomalies[0].Kind);
        Assert.Equal("expensive", anomalies[1].Kind);
    }

    [Fact]
    public void DetectNotableSessions_flags_top_energy_and_fast_sessions()
    {
        var sessions = new List<ChargingListSession>();
        for (int i = 1; i <= 20; i++)
        {
            sessions.Add(Session(i, "2026-03-10", energyWh: i * 1000, cost: 1));
        }

        sessions.Add(Session(99, "2026-03-10", energyWh: 100, cost: 1, peakW: 160000)); // fast despite low energy

        var notable = ChargingAggregation.DetectNotableSessions(sessions);
        Assert.Contains(notable, s => s.Id == 99);                       // fast
        Assert.Contains(notable, s => s.Id == 20);                       // highest energy
    }

    [Fact]
    public void DailyChargingTrend_buckets_and_sorts_by_day()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-11", energyWh: 1000, cost: 2),
            Session(2, "2026-03-10", energyWh: 3000, cost: 1),
            Session(3, "2026-03-10", energyWh: 2000, cost: 1),
        };

        var sessionsTrend = ChargingAggregation.DailyChargingTrend(sessions, "sessions");
        Assert.Equal(2, sessionsTrend.Count);
        Assert.Equal("2026-03-10", sessionsTrend[0].Date);
        Assert.Equal(2, sessionsTrend[0].Value);

        var energyTrend = ChargingAggregation.DailyChargingTrend(sessions, "energy");
        Assert.Equal(5, energyTrend[0].Value, 3); // 3 kWh + 2 kWh on the 10th
    }

    // ---- Search mini-language ------------------------------------------------------

    [Fact]
    public void Search_matches_free_text_and_kv_tokens()
    {
        var s = Session(1, "2026-03-15", energyWh: 25000, cost: 6, charger: "supercharger", durMin: 30, peakW: 120000);
        s = s with { StartPlace = "Costco" };

        Assert.True(ChargingSearch.Matches(s, ChargingSearch.Parse("Costco")));
        Assert.True(ChargingSearch.Matches(s, ChargingSearch.Parse("charger:supercharger")));
        Assert.True(ChargingSearch.Matches(s, ChargingSearch.Parse("charger:sc")));
        Assert.True(ChargingSearch.Matches(s, ChargingSearch.Parse("cost:>5")));
        Assert.True(ChargingSearch.Matches(s, ChargingSearch.Parse("kwh:>20")));
        Assert.False(ChargingSearch.Matches(s, ChargingSearch.Parse("charger:home")));
        Assert.False(ChargingSearch.Matches(s, ChargingSearch.Parse("cost:<5")));
    }

    [Fact]
    public void Search_free_keyword_matches_zero_cost_sessions()
    {
        var free = Session(1, "2026-03-15", energyWh: 10000, cost: 0);
        var paid = Session(2, "2026-03-15", energyWh: 10000, cost: 5);
        Assert.True(ChargingSearch.Matches(free, ChargingSearch.Parse("free:")));
        Assert.False(ChargingSearch.Matches(paid, ChargingSearch.Parse("free:")));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var loaded = ChargingListResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Count);

        var empty = ChargingListResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, empty.Status);
    }

    // ---- Source request shape ------------------------------------------------------

    [Fact]
    public async Task Source_request_includes_vehicle_limit_and_range()
    {
        var element = JsonDocument.Parse("""[{"id":1,"started_at":"2026-03-15T10:00:00Z","total_energy_added_wh":1000}]""").RootElement.Clone();
        var api = new FakeApiClient().ReturnsValue(element);
        var source = new ChargingListSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(),
            vehicleId: 42, startDate: "2026-03-01", endDate: "2026-03-31");

        var emissions = await Collect(source.StreamAsync());

        var req = Assert.Single(api.Requests);
        Assert.Equal(ChargingListSource.OperationId, req.OperationId);
        Assert.Equal(42L, Convert.ToInt64(req.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(ChargingListProjection.FetchLimit, Convert.ToInt32(req.Query!["limit"], CultureInfo.InvariantCulture));
        Assert.Equal("2026-03-01", req.Query!["start"]);
        Assert.Equal("2026-03-31", req.Query!["end"]);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!);
    }

    [Fact]
    public async Task Source_without_vehicle_is_disabled()
    {
        var api = new FakeApiClient();
        var source = new ChargingListSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Empty(api.Requests);
        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
    }

    // ---- Projection: chrome + strings ----------------------------------------------

    [Fact]
    public void Projection_carries_chrome_strings_in_every_state()
    {
        foreach (var state in new[] { ChargingListState.Loading, ChargingListState.Empty, ChargingListState.Error, ChargingListState.Success })
        {
            var display = ChargingListProjection.Project(
                Array.Empty<ChargingListSession>(), state, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);

            Assert.Equal("Charging Sessions", display.Title);
            Assert.Equal("Overview", display.OverviewTitle);
            Assert.Equal("No charging sessions in this range", display.NoStatsMessage);
            Assert.Equal("Charging over time", display.TrendTitle);
            Assert.Equal(8, display.CollectionOptions.Count);
            Assert.Equal(5, display.SortOptions.Count);
            Assert.Equal(4, display.TrendMetrics.Count);
            Assert.Equal(3, display.Sections.Count);
        }
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_through_the_facade()
    {
        var recorder = new RecordingLocalizer();

        // Run 1 — rich March window: two anomalies (anomaly_other), prior-period data, a 2-session group, soc scores.
        var run1 = new[]
        {
            Session(1, "2026-03-15", energyWh: 10000, cost: 10, charger: "supercharger", durMin: 30, startSoc: 20, endSoc: 60),
            Session(2, "2026-03-15", energyWh: 0, cost: 0, charger: "home", durMin: 60, startSoc: 30, endSoc: 80),
            Session(3, "2026-02-15", energyWh: 5000, cost: 5, charger: "home", durMin: 30),
        };
        _ = ChargingListProjection.Project(run1, ChargingListState.Success, MarchFilters(), UnitPref.Metric, recorder, "$", Now);

        // Run 2 — single April session with one anomaly (anomaly_one), no prior data, one selected (session_one).
        var run2 = new[] { Session(4, "2026-04-10", energyWh: 10000, cost: 10, charger: "supercharger", durMin: 30) };
        var aprilFilters = MarchFilters() with { StartDate = "2026-04-01", EndDate = "2026-04-30", SelectedIds = new HashSet<long> { 4 } };
        _ = ChargingListProjection.Project(run2, ChargingListState.Success, aprilFilters, UnitPref.Metric, recorder, "$", Now);

        foreach (var key in ExpectedStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        Assert.Equal(67, ExpectedStringKeys.Length);
    }

    // ---- Projection: KPIs + stats --------------------------------------------------

    [Fact]
    public void Projection_builds_six_kpi_cards_in_web_order_when_stats_present()
    {
        var sessions = new[] { Session(1, "2026-03-10", energyWh: 30000, cost: 12, charger: "supercharger", durMin: 60, startSoc: 20, endSoc: 80) };

        var display = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);

        Assert.True(display.HasStats);
        Assert.Equal(6, display.KpiCards.Count);
        Assert.Equal(new[] { "sessions", "energy", "cost", "rate", "duration", "power" }, display.KpiCards.Select(c => c.Key).ToArray());
        Assert.Equal("Sessions", display.KpiCards[0].Label);
        Assert.Equal("$12.00", display.KpiCards[2].Value);
    }

    [Fact]
    public void Projection_without_stats_surfaces_the_no_stats_panel()
    {
        var display = ChargingListProjection.Project(
            Array.Empty<ChargingListSession>(), ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);

        Assert.False(display.HasStats);
        Assert.Equal("No charging sessions in this range", display.NoStatsMessage);
    }

    [Fact]
    public void Projection_surfaces_anomaly_callout_outside_the_anomaly_collection()
    {
        var sessions = new[] { Session(1, "2026-03-10", energyWh: 10000, cost: 10, charger: "supercharger", durMin: 30) };

        var display = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);

        Assert.True(display.HasAnomalyCallout);
        Assert.Contains("1", display.AnomalyCallout, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_collection_pills_carry_live_counts()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-10", energyWh: 10000, cost: 1, charger: "supercharger"),
            Session(2, "2026-03-10", energyWh: 10000, cost: 0, charger: "home"),
        };

        var display = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);

        Assert.Equal("all", display.CollectionOptions[0].Value);
        Assert.Contains("(2)", display.CollectionOptions[0].Label, StringComparison.Ordinal); // All = 2
    }

    [Fact]
    public void Projection_paginates_and_groups_sessions_by_day()
    {
        var sessions = new List<ChargingListSession>();
        for (int i = 1; i <= 60; i++)
        {
            sessions.Add(Session(i, "2026-03-10", energyWh: 1000, cost: 1, hour: i % 24));
        }

        var page1 = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);
        Assert.Equal(60, page1.TotalRowCount);
        Assert.True(page1.HasRows);
        Assert.Single(page1.Groups); // one day bucket
        Assert.Equal(ChargingListProjection.DisplayPageSize, page1.Groups[0].Rows.Count);

        var page2 = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters() with { Page = 2 }, UnitPref.Metric, Localizer, "$", Now);
        Assert.Equal(10, page2.Groups[0].Rows.Count);
    }

    [Fact]
    public void Projection_sorts_by_energy_descending()
    {
        var sessions = new[]
        {
            Session(1, "2026-03-10", energyWh: 1000, cost: 1, hour: 8),
            Session(2, "2026-03-10", energyWh: 5000, cost: 1, hour: 9),
        };

        var filters = MarchFilters() with { SortField = ChargingSortField.Energy, SortDescending = true };
        var display = ChargingListProjection.Project(sessions, ChargingListState.Success, filters, UnitPref.Metric, Localizer, "$", Now);

        Assert.Equal(2, display.Groups[0].Rows[0].Id);
    }

    [Fact]
    public void Projection_battery_section_shows_threshold_below_minimum()
    {
        var sessions = new[] { Session(1, "2026-03-10", energyWh: 1000, cost: 1, startSoc: 20) };

        var display = ChargingListProjection.Project(sessions, ChargingListState.Success, MarchFilters(), UnitPref.Metric, Localizer, "$", Now);
        var battery = display.Sections.Single(s => s.Key == "batteryDist");

        Assert.False(battery.HasData); // < THRESHOLD_BATTERY_DIST (5)
        Assert.False(string.IsNullOrEmpty(battery.EmptyMessage));
    }

    // ---- Export --------------------------------------------------------------------

    [Fact]
    public void BuildCsv_emits_the_web_columns()
    {
        var sessions = new[] { Session(10, "2026-03-15", energyWh: 42000, cost: 12.5, charger: "supercharger", durMin: 60) };

        string csv = ChargingListProjection.BuildCsv(sessions);

        Assert.StartsWith("id,started_at,ended_at,charger_type,kwh,cost,duration_min,avg_kw,peak_kw,start_place", csv);
        Assert.Contains("10,", csv);
        Assert.Contains("supercharger", csv);
    }

    [Fact]
    public void BuildJson_serializes_the_sessions()
    {
        var sessions = new[] { Session(10, "2026-03-15", energyWh: 42000, cost: 12.5) };
        string json = ChargingListProjection.BuildJson(sessions);
        Assert.Contains("\"Id\": 10", json);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_success_lists_sessions()
    {
        var sessions = MarchSessions();
        var source = new FakeChargingListSource(
            RepositoryResult<IReadOnlyList<ChargingListSession>>.Loading(),
            RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(sessions, Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(ChargingListState.Success, vm.State);
        Assert.True(vm.Display.HasStats);
        Assert.Equal(sessions.Count, vm.CurrentSessions.Count);
    }

    [Fact]
    public async Task ViewModel_empty_response_shows_the_empty_state()
    {
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Empty(Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(ChargingListState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_with_no_cache_surfaces_error()
    {
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(ChargingListState.Error, vm.State);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_sessions_visible()
    {
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.OfflineCached(
            MarchSessions(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(ChargingListState.Success, vm.State);
    }

    [Fact]
    public async Task ViewModel_set_collection_filters_and_resets_page()
    {
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(MarchSessions(), Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();
        vm.GoToPage(2);

        vm.SetCollection("home");

        Assert.Equal(ChargingCollectionKind.Home, vm.Filters.Collection);
        Assert.Equal(1, vm.Filters.Page);
        Assert.Equal("home", vm.Display.ActiveCollection);
    }

    [Fact]
    public async Task ViewModel_toggle_and_clear_selection_tracks_ids()
    {
        var sessions = MarchSessions();
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(sessions, Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        vm.ToggleSelection(sessions[0].Id, true);
        Assert.Equal(1, vm.Display.SelectedCount);

        vm.ClearSelection();
        Assert.Equal(0, vm.Display.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_delete_selected_calls_the_service_and_clears()
    {
        var sessions = MarchSessions();
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(sessions, Now));
        var bulk = new FakeBulkDeleteService();
        using var vm = new ChargingListPageViewModel(source, bulk, Localizer, clock: () => Now);
        await vm.LoadAsync();
        vm.ToggleSelection(sessions[0].Id, true);

        var deleted = await vm.DeleteSelectedAsync();

        Assert.Equal(1, deleted);
        Assert.Equal(new[] { sessions[0].Id }, bulk.DeletedIds);
        Assert.Equal(0, vm.Display.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_export_rows_returns_filtered_sorted_sessions()
    {
        var sessions = MarchSessions();
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(sessions, Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var all = vm.ExportRows(selectedOnly: false);
        Assert.Equal(sessions.Count, all.Count);

        vm.ToggleSelection(sessions[0].Id, true);
        var selected = vm.ExportRows(selectedOnly: true);
        Assert.Single(selected);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects()
    {
        var source = new FakeChargingListSource(RepositoryResult<IReadOnlyList<ChargingListSession>>.Loaded(MarchSessions(), Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var before = vm.Display;
        vm.Units = UnitPref.Imperial;
        Assert.NotSame(before, vm.Display);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_the_route_name_and_slug()
    {
        Assert.Equal("Charging", ChargingListRegistration.RouteName);
        Assert.Equal("charging", ChargingListRegistration.Route);
        Assert.Equal("ChargingListPage", ChargingListRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingListPage", Assert.Single(lines));
    }

    // ---- Helpers + fakes -----------------------------------------------------------

    private static ChargingListFilters MarchFilters() =>
        ChargingListFilters.Default(Now) with { StartDate = "2026-03-01", EndDate = "2026-03-31" };

    private static IReadOnlyList<ChargingListSession> MarchSessions() => new[]
    {
        Session(1, "2026-03-10", energyWh: 30000, cost: 12, charger: "supercharger", durMin: 60, startSoc: 20, endSoc: 80, hour: 9),
        Session(2, "2026-03-11", energyWh: 8000, cost: 0, charger: "home", durMin: 120, startSoc: 40, endSoc: 70, hour: 22),
    };

    private static ChargingListSession Session(
        long id,
        string day,
        double energyWh,
        double? cost,
        string? charger = "home",
        double durMin = 30,
        double? peakW = null,
        double? startSoc = null,
        double? endSoc = null,
        int hour = 10)
    {
        var start = DateTimeOffset.Parse($"{day}T{hour:00}:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        DateTimeOffset? end = durMin > 0 ? start.AddMinutes(durMin) : null;
        return new ChargingListSession(id, start, end, charger, energyWh, cost, peakW, null, startSoc, endSoc, null, null, null, null, null);
    }

    private static ChargingListPageViewModel NewViewModel(IChargingListSource source) =>
        new(source, NullChargingBulkDeleteService.Instance, Localizer, clock: () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<ChargingListSession>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargingListSession>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ChargingListSession>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeChargingListSource(params RepositoryResult<IReadOnlyList<ChargingListSession>>[] results)
        : IChargingListSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargingListSession>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class FakeBulkDeleteService : IChargingBulkDeleteService
    {
        public List<long> DeletedIds { get; } = new();

        public Task<int> DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            DeletedIds.AddRange(ids);
            return Task.FromResult(ids.Count);
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
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
