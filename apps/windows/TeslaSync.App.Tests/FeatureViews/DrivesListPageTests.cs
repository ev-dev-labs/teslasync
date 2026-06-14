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
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the DrivesListPage's UI-thread-free logic — the drive JSON parse adapter, the drives
/// aggregation helpers (efficiency + grade ladder, period stats, prior period, anomaly + notable + commute
/// detection, daily trend), the structured search mini-language, the cache-then-network result mapper, the
/// repository source's request shape (web <c>useDrives</c>), the projection (overview KPIs, prior-period deltas,
/// collection pills, sort options, trend metrics, date-grouped rows, anomaly callout, and the four data states),
/// the CSV / JSON export serializers, the state-holder view-model (loading / success / empty / error plus search /
/// collection / sort / paging / bulk-selection / bulk-delete / unit reproject), the i18n facade key coverage for
/// all 65 source strings, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/pages/DrivesListPage.tsx). The WinUI view itself is exercised by the app build; its
/// per-state branch selection is driven entirely by the asserted state + display model.
/// </summary>
public sealed class DrivesListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 3, 31, 12, 0, 0, TimeSpan.Zero);

    private static readonly string[] ExpectedStringKeys =
    {
        "bulk.actions.delete", "bulk.deleteConfirmDescription", "bulk.deleteConfirmTitle", "bulk.noun.drive_one",
        "bulk.noun.drive_other", "common.delete", "common.noData", "drives.allDrives", "drives.anomalyCount",
        "drives.anomaly_one", "drives.anomaly_other", "drives.avg", "drives.avgDur", "drives.avgScore",
        "drives.avgTrip", "drives.coll.all", "drives.coll.anomalies", "drives.coll.commutes", "drives.coll.notable",
        "drives.coll.tagged", "drives.collections.aria", "drives.cost", "drives.distance", "drives.driveTime",
        "drives.efficiency", "drives.empty.cta", "drives.emptyForCollection", "drives.emptyForCollection.msg",
        "drives.emptyMessage", "drives.emptyTitle", "drives.filterLabel.collection", "drives.filterLabel.search",
        "drives.highSpeed", "drives.inProgress", "drives.longest", "drives.lowEfficiencyBadge", "drives.max",
        "drives.metric.cost", "drives.metric.distance", "drives.metric.drives", "drives.metric.efficiency",
        "drives.metric.score", "drives.noPriorData", "drives.noStatsRange", "drives.noTelemetry", "drives.overTime",
        "drives.overTime.aria", "drives.overTime.empty", "drives.overview", "drives.priorPeriod", "drives.results",
        "drives.scoreAria", "drives.searchPlaceholder", "drives.selectDrive", "drives.sortByAria",
        "drives.sortDistance", "drives.sortEfficiency", "drives.sortRecent", "drives.stickyBar.aria",
        "drives.subtitle", "drives.title", "drives.topSpeed", "drives.totalDrives", "drives.viewAnomalies",
        "filter.pending",
    };

    private const string SampleJson = """
    [
      {"id":10,"start_ts":"2026-03-15T10:00:00Z","end_ts":"2026-03-15T10:30:00Z","distance_m":29100,"duration_s":1800,"start_battery_pct":80,"end_battery_pct":60,"max_speed_mps":40,"avg_speed_mps":20,"start_address":"Office","end_address":"Home"},
      {"id":11,"start_ts":"2026-03-16T09:00:00Z","distance_m":"5000","duration_s":600}
    ]
    """;

    // ---- Parsing -------------------------------------------------------------------

    [Fact]
    public void ParseList_maps_every_field_and_tolerates_partial_rows()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var drives = DriveListItem.ParseList(doc.RootElement);

        Assert.Equal(2, drives.Count);
        Assert.Equal(10, drives[0].Id);
        Assert.Equal(29100, drives[0].DistanceM);
        Assert.Equal(80, drives[0].StartBatteryPct);
        Assert.Equal("Office", drives[0].StartAddress);
        Assert.NotNull(drives[0].EndTs);

        // String-encoded distance + null end tolerated.
        Assert.Equal(11, drives[1].Id);
        Assert.Equal(5000, drives[1].DistanceM);
        Assert.Null(drives[1].EndTs);
    }

    [Fact]
    public void ParseList_accepts_the_drives_wrapper_object()
    {
        using var doc = JsonDocument.Parse("""{"drives":[{"id":1,"start_ts":"2026-03-15T10:00:00Z","distance_m":1000}]}""");
        var drives = DriveListItem.ParseList(doc.RootElement);
        Assert.Single(drives);
        Assert.Equal(1, drives[0].Id);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("123");
        Assert.Empty(DriveListItem.ParseList(doc.RootElement));
    }

    // ---- Efficiency + grade ladder -------------------------------------------------

    [Fact]
    public void GetEfficiency_ports_the_web_formula()
    {
        var d = Drive(1, "2026-03-15", distanceM: 10000, startSoc: 50, endSoc: 30);
        // (20 * 0.75 * 1000) / (10000/1000) = 1500 Wh/km
        Assert.Equal(1500, DrivesAggregation.GetEfficiency(d)!.Value, 3);
        Assert.Null(DrivesAggregation.GetEfficiency(Drive(2, "2026-03-15", distanceM: 0, startSoc: 50, endSoc: 30)));
    }

    [Theory]
    [InlineData(100, "A+")]
    [InlineData(150, "A")]
    [InlineData(180, "B")]
    [InlineData(210, "C")]
    [InlineData(300, "D")]
    public void GradeFromEfficiency_ports_the_web_thresholds(double eff, string expected) =>
        Assert.Equal(expected, DrivesAggregation.GradeFromEfficiency(eff).Label);

    [Fact]
    public void GradeFromEfficiency_null_is_the_em_dash() =>
        Assert.Equal("\u2014", DrivesAggregation.GradeFromEfficiency(null).Label);

    [Theory]
    [InlineData(4.5, "A+")]
    [InlineData(3.6, "A")]
    [InlineData(2.6, "B")]
    [InlineData(1.6, "C")]
    [InlineData(1.0, "D")]
    public void GradeFromNumeric_ports_the_web_thresholds(double weight, string expected) =>
        Assert.Equal(expected, DrivesAggregation.GradeFromNumeric(weight).Label);

    // ---- Period stats --------------------------------------------------------------

    [Fact]
    public void ComputePeriodStats_aggregates_counts_totals_top_speed_and_energy()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 10000, durationS: 600, startSoc: 50, endSoc: 30, maxSpeed: 30),
            Drive(2, "2026-03-11", distanceM: 40000, durationS: 1800, startSoc: 80, endSoc: 78, maxSpeed: 55),
        };

        var stats = DrivesAggregation.ComputePeriodStats(drives, null, null);

        Assert.Equal(2, stats.Count);
        Assert.Equal(50000, stats.TotalDistanceM, 3);
        Assert.Equal(2400, stats.TotalDurationS, 3);
        Assert.Equal(55, stats.TopSpeedMps, 3);
        Assert.Equal(40000, stats.LongestDistanceM, 3);
        // energyKwh = (20 + 2) * 0.75 = 16.5
        Assert.Equal(16.5, stats.TotalEnergyKwh, 3);
        Assert.NotNull(stats.AvgGradeNumeric);
    }

    [Fact]
    public void ComputePeriodStats_respects_the_date_window()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 1000),
            Drive(2, "2026-02-10", distanceM: 1000),
        };

        Assert.Equal(1, DrivesAggregation.ComputePeriodStats(drives, "2026-03-01", "2026-03-31").Count);
    }

    [Fact]
    public void PriorPeriod_computes_the_preceding_equal_window()
    {
        var prior = DrivesAggregation.PriorPeriod("2026-03-01", "2026-03-31");
        Assert.NotNull(prior);
        Assert.Equal("2026-01-29", prior!.Value.Start);
        Assert.Equal("2026-02-28", prior.Value.End);
    }

    // ---- Collections ---------------------------------------------------------------

    [Fact]
    public void DetectAnomalies_flags_grade_D_drives()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 10000, startSoc: 50, endSoc: 30), // 1500 → D
            Drive(2, "2026-03-10", distanceM: 100000, startSoc: 80, endSoc: 65), // ~112.5 → A+
        };

        var anomalies = DrivesAggregation.DetectAnomalies(drives);
        Assert.Single(anomalies);
        Assert.Equal(1, anomalies[0].Id);
    }

    [Fact]
    public void DetectNotable_flags_top_decile_distance_and_aplus()
    {
        var drives = new List<DriveListItem>();
        for (int i = 1; i <= 20; i++)
        {
            drives.Add(Drive(i, "2026-03-10", distanceM: i * 1000));
        }

        drives.Add(Drive(99, "2026-03-10", distanceM: 100000, startSoc: 80, endSoc: 65)); // A+ despite mid distance

        var notable = DrivesAggregation.DetectNotable(drives);
        Assert.Contains(notable, d => d.Id == 99);  // A+
        Assert.Contains(notable, d => d.Id == 20);  // longest
    }

    [Fact]
    public void DetectCommutes_flags_recurring_pairs()
    {
        var drives = new List<DriveListItem>();
        for (int i = 1; i <= 3; i++)
        {
            drives.Add(Drive(i, "2026-03-10", distanceM: 1000, startAddr: "Home", endAddr: "Office"));
        }

        drives.Add(Drive(9, "2026-03-10", distanceM: 1000, startAddr: "Beach", endAddr: "Pier"));

        var commutes = DrivesAggregation.DetectCommutes(drives, 3);
        Assert.Equal(3, commutes.Count);
        Assert.DoesNotContain(commutes, d => d.Id == 9);
    }

    [Fact]
    public void DailyTrend_buckets_and_sorts_by_day()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-11", distanceM: 1000),
            Drive(2, "2026-03-10", distanceM: 3000),
            Drive(3, "2026-03-10", distanceM: 2000),
        };

        var driveCount = DrivesAggregation.DailyTrend(drives, "drives");
        Assert.Equal(2, driveCount.Count);
        Assert.Equal("2026-03-10", driveCount[0].Date);
        Assert.Equal(2, driveCount[0].Value);

        var distance = DrivesAggregation.DailyTrend(drives, "distance");
        Assert.Equal(5000, distance[0].Value, 3);
    }

    // ---- Search mini-language ------------------------------------------------------

    [Fact]
    public void Search_matches_free_text_and_kv_tokens()
    {
        var d = Drive(1, "2026-03-15", distanceM: 29100, startSoc: 50, endSoc: 30, startAddr: "Office", endAddr: "Home");

        Assert.True(DriveSearch.Matches(d, DriveSearch.Parse("Office"), DistanceUnit.Km));
        Assert.True(DriveSearch.Matches(d, DriveSearch.Parse("29.1"), DistanceUnit.Km));
        Assert.True(DriveSearch.Matches(d, DriveSearch.Parse("score:d"), DistanceUnit.Km));
        Assert.True(DriveSearch.Matches(d, DriveSearch.Parse("from:Mar"), DistanceUnit.Km));
        Assert.True(DriveSearch.Matches(d, DriveSearch.Parse("distance:>20"), DistanceUnit.Km));
        Assert.False(DriveSearch.Matches(d, DriveSearch.Parse("score:a"), DistanceUnit.Km));
        Assert.False(DriveSearch.Matches(d, DriveSearch.Parse("distance:<20"), DistanceUnit.Km));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var loaded = DrivesListResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Count);

        var empty = DrivesListResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, empty.Status);
    }

    // ---- Source request shape ------------------------------------------------------

    [Fact]
    public async Task Source_request_scopes_by_vehicle()
    {
        var element = JsonDocument.Parse("""[{"id":1,"start_ts":"2026-03-15T10:00:00Z","distance_m":1000}]""").RootElement.Clone();
        var api = new FakeApiClient().ReturnsValue(element);
        var source = new DrivesListSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        var req = Assert.Single(api.Requests);
        Assert.Equal(DrivesListSource.OperationId, req.OperationId);
        Assert.Equal(42L, Convert.ToInt64(req.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!);
    }

    [Fact]
    public async Task Source_without_vehicle_is_disabled()
    {
        var api = new FakeApiClient();
        var source = new DrivesListSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Empty(api.Requests);
        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
    }

    // ---- Projection: chrome + states -----------------------------------------------

    [Fact]
    public void Projection_carries_chrome_strings_in_every_state()
    {
        foreach (var state in new[] { DrivesListState.Loading, DrivesListState.Empty, DrivesListState.Error, DrivesListState.Success })
        {
            var display = DrivesListProjection.Project(
                Array.Empty<DriveListItem>(), state, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);

            Assert.Equal(state, display.State);
            Assert.Equal("Drive History", display.Title);
            Assert.Equal("Overview", display.OverviewTitle);
            Assert.Equal("No drives in this range", display.NoStatsMessage);
            Assert.Equal("Drives over time", display.TrendTitle);
            Assert.Equal(5, display.CollectionOptions.Count);
            Assert.Equal(3, display.SortOptions.Count);
            Assert.Equal(5, display.TrendMetrics.Count);
        }
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_through_the_facade()
    {
        var recorder = new RecordingLocalizer();

        // Run 1 — rich March window on one day: 2 anomalies (anomaly_other), prior-period data (Feb drive),
        // a multi-drive group (drive_other), high-speed + no-telemetry + in-progress rows, 0 selected.
        var run1 = new[]
        {
            Drive(1, "2026-03-15", distanceM: 10000, durationS: 600, startSoc: 50, endSoc: 30, maxSpeed: 30),       // D anomaly
            Drive(2, "2026-03-15", distanceM: 5000, durationS: 600, startSoc: 60, endSoc: 40),                       // D anomaly
            Drive(3, "2026-03-15", distanceM: 0, durationS: 0, completed: true),                                     // noTelemetry
            Drive(4, "2026-03-15", distanceM: 0, durationS: 0, completed: false),                                    // inProgress
            Drive(5, "2026-03-15", distanceM: 20000, durationS: 600, startSoc: 80, endSoc: 78, maxSpeed: 60),        // highSpeed + A+
            Drive(6, "2026-02-15", distanceM: 10000, durationS: 600, startSoc: 50, endSoc: 45),                      // prior window
        };
        _ = DrivesListProjection.Project(run1, DrivesListState.Success, MarchFilters(), UnitPref.Metric, recorder, 0.15, "$", Now);

        // Run 2 — single April drive with one anomaly (anomaly_one), no prior data, one selected (drive_one).
        var run2 = new[] { Drive(10, "2026-04-10", distanceM: 10000, durationS: 600, startSoc: 50, endSoc: 30) };
        var aprilFilters = MarchFilters() with { StartDate = "2026-04-01", EndDate = "2026-04-30", SelectedIds = new HashSet<long> { 10 } };
        _ = DrivesListProjection.Project(run2, DrivesListState.Success, aprilFilters, UnitPref.Metric, recorder, 0.15, "$", Now);

        foreach (var key in ExpectedStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        Assert.Equal(65, ExpectedStringKeys.Length);
    }

    // ---- Projection: KPIs + stats --------------------------------------------------

    [Fact]
    public void Projection_builds_six_kpi_cards_in_web_order_when_stats_present()
    {
        var drives = new[] { Drive(1, "2026-03-10", distanceM: 100000, durationS: 3600, startSoc: 80, endSoc: 20, maxSpeed: 30) };

        var display = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);

        Assert.True(display.HasStats);
        Assert.Equal(6, display.KpiCards.Count);
        Assert.Equal(new[] { "drives", "distance", "driveTime", "score", "efficiency", "cost" }, display.KpiCards.Select(c => c.Key).ToArray());
        Assert.Equal("Drives", display.KpiCards[0].Label);
        // energyKwh = (80-20)*0.75 = 45 kWh → cost = 45 * 0.15 = 6.75
        Assert.StartsWith("$6.75", display.KpiCards[5].Value);
    }

    [Fact]
    public void Projection_without_stats_surfaces_the_no_stats_panel()
    {
        var display = DrivesListProjection.Project(
            Array.Empty<DriveListItem>(), DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);

        Assert.False(display.HasStats);
        Assert.Equal("No drives in this range", display.NoStatsMessage);
    }

    [Fact]
    public void Projection_surfaces_anomaly_callout_outside_the_anomaly_collection()
    {
        var drives = new[] { Drive(1, "2026-03-10", distanceM: 10000, startSoc: 50, endSoc: 30) }; // D anomaly

        var display = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);

        Assert.True(display.HasAnomalyCallout);
        Assert.Contains("1", display.AnomalyCallout, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_collection_pills_carry_live_counts_with_tagged_disabled()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 10000, startSoc: 50, endSoc: 30),
            Drive(2, "2026-03-10", distanceM: 100000, startSoc: 80, endSoc: 65),
        };

        var display = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);

        Assert.Equal("all", display.CollectionOptions[0].Value);
        Assert.Contains("(2)", display.CollectionOptions[0].Label, StringComparison.Ordinal);
        Assert.True(display.CollectionOptions[^1].Disabled); // tagged
    }

    [Fact]
    public void Projection_paginates_and_groups_drives_by_day()
    {
        var drives = new List<DriveListItem>();
        for (int i = 1; i <= 60; i++)
        {
            drives.Add(Drive(i, "2026-03-10", distanceM: i * 1000, hour: i % 24));
        }

        var page1 = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);
        Assert.Equal(60, page1.TotalRowCount);
        Assert.Single(page1.Groups);
        Assert.Equal(DrivesListProjection.DisplayPageSize, page1.Groups[0].Rows.Count);

        var page2 = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters() with { Page = 2 }, UnitPref.Metric, Localizer, 0.15, "$", Now);
        Assert.Equal(10, page2.Groups[0].Rows.Count);
    }

    [Fact]
    public void Projection_sorts_by_distance_descending()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 1000, hour: 8),
            Drive(2, "2026-03-10", distanceM: 5000, hour: 9),
        };

        var filters = MarchFilters() with { SortField = DriveSortField.Distance };
        var display = DrivesListProjection.Project(drives, DrivesListState.Success, filters, UnitPref.Metric, Localizer, 0.15, "$", Now);

        Assert.Equal(2, display.Groups[0].Rows[0].Id);
    }

    [Fact]
    public void Projection_row_flags_high_speed_and_status_badges()
    {
        var drives = new[]
        {
            Drive(1, "2026-03-10", distanceM: 20000, durationS: 600, startSoc: 80, endSoc: 78, maxSpeed: 60), // high speed
            Drive(2, "2026-03-10", distanceM: 0, durationS: 0, completed: true),                              // no telemetry
        };

        var display = DrivesListProjection.Project(drives, DrivesListState.Success, MarchFilters(), UnitPref.Metric, Localizer, 0.15, "$", Now);
        var rows = display.Groups.SelectMany(g => g.Rows).ToList();

        Assert.Contains(rows, r => r.HighSpeed);
        Assert.Contains(rows, r => r.PrimaryBadgeKind == DriveBadgeKind.Warning); // no telemetry
    }

    // ---- Export --------------------------------------------------------------------

    [Fact]
    public void BuildCsv_emits_the_web_columns()
    {
        var drives = new[] { Drive(10, "2026-03-15", distanceM: 29100, durationS: 1800, startSoc: 80, endSoc: 60) };

        string csv = DrivesListProjection.BuildCsv(drives);

        Assert.StartsWith("id,start_ts,end_ts,distance_m,duration_s,start_battery_pct,end_battery_pct,avg_speed_mps,max_speed_mps,start_address,end_address", csv);
        Assert.Contains("10,", csv);
    }

    [Fact]
    public void BuildJson_serializes_the_drives()
    {
        var drives = new[] { Drive(10, "2026-03-15", distanceM: 29100) };
        string json = DrivesListProjection.BuildJson(drives);
        Assert.Contains("\"Id\": 10", json);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_success_lists_drives()
    {
        var drives = MarchDrives();
        var source = new FakeDrivesListSource(
            RepositoryResult<IReadOnlyList<DriveListItem>>.Loading(),
            RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(drives, Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(DrivesListState.Success, vm.State);
        Assert.True(vm.Display.HasStats);
        Assert.Equal(drives.Count, vm.CurrentDrives.Count);
    }

    [Fact]
    public async Task ViewModel_empty_response_shows_the_empty_state()
    {
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Empty(Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(DrivesListState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_with_no_cache_surfaces_error()
    {
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(DrivesListState.Error, vm.State);
    }

    [Fact]
    public async Task ViewModel_set_collection_filters_and_resets_page()
    {
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(MarchDrives(), Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();
        vm.GoToPage(2);

        vm.SetCollection("anomalies");

        Assert.Equal(DriveCollectionKind.Anomalies, vm.Filters.Collection);
        Assert.Equal(1, vm.Filters.Page);
        Assert.Equal("anomalies", vm.Display.ActiveCollection);
    }

    [Fact]
    public async Task ViewModel_set_sort_and_trend_metric_reproject()
    {
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(MarchDrives(), Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        vm.SetSort("distance");
        Assert.Equal(DriveSortField.Distance, vm.Filters.SortField);
        Assert.Equal("distance", vm.Display.ActiveSort);

        vm.SetTrendMetric("cost");
        Assert.Equal("cost", vm.Filters.TrendMetric);
        Assert.Equal("cost", vm.Display.TrendActiveKey);
    }

    [Fact]
    public async Task ViewModel_toggle_and_clear_selection_tracks_ids()
    {
        var drives = MarchDrives();
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(drives, Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        vm.ToggleSelection(drives[0].Id, true);
        Assert.Equal(1, vm.Display.SelectedCount);

        vm.ClearSelection();
        Assert.Equal(0, vm.Display.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_delete_selected_calls_the_service_and_clears()
    {
        var drives = MarchDrives();
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(drives, Now));
        var bulk = new FakeBulkDeleteService();
        using var vm = new DrivesListPageViewModel(source, bulk, Localizer, clock: () => Now);
        await vm.LoadAsync();
        vm.ToggleSelection(drives[0].Id, true);

        var deleted = await vm.DeleteSelectedAsync();

        Assert.Equal(1, deleted);
        Assert.Equal(new[] { drives[0].Id }, bulk.DeletedIds);
        Assert.Equal(0, vm.Display.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_export_rows_returns_filtered_sorted_drives()
    {
        var drives = MarchDrives();
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(drives, Now));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        Assert.Equal(drives.Count, vm.ExportRows(selectedOnly: false).Count);

        vm.ToggleSelection(drives[0].Id, true);
        Assert.Single(vm.ExportRows(selectedOnly: true));
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects()
    {
        var source = new FakeDrivesListSource(RepositoryResult<IReadOnlyList<DriveListItem>>.Loaded(MarchDrives(), Now));
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
        Assert.Equal("Drives", DrivesListRegistration.RouteName);
        Assert.Equal("drives", DrivesListRegistration.Route);
        Assert.Equal("DrivesListPage", DrivesListRegistration.Slug);
        Assert.Equal("get_api_v1_drives", DrivesListRegistration.DrivesOperation);
        Assert.Equal("delete_api_v1_drives_bulk", DrivesListRegistration.BulkDeleteOperation);
    }

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new DrivesListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivesListPage", Assert.Single(lines));
    }

    // ---- Helpers + fakes -----------------------------------------------------------

    private static DrivesListFilters MarchFilters() =>
        DrivesListFilters.Default(Now) with { StartDate = "2026-03-01", EndDate = "2026-03-31" };

    private static IReadOnlyList<DriveListItem> MarchDrives() => new[]
    {
        Drive(1, "2026-03-10", distanceM: 30000, durationS: 1800, startSoc: 80, endSoc: 60, maxSpeed: 30, hour: 9),
        Drive(2, "2026-03-11", distanceM: 8000, durationS: 1200, startSoc: 40, endSoc: 30, maxSpeed: 25, hour: 18),
    };

    private static DriveListItem Drive(
        long id,
        string day,
        double distanceM,
        double durationS = 600,
        double? startSoc = null,
        double? endSoc = null,
        double? maxSpeed = null,
        double? avgSpeed = null,
        bool completed = true,
        int hour = 12,
        string? startAddr = "Origin",
        string? endAddr = "Destination")
    {
        var start = DateTimeOffset.Parse($"{day}T{hour:00}:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        DateTimeOffset? end = completed ? start.AddSeconds(durationS) : null;
        return new DriveListItem(
            id, start, end, distanceM, durationS, avgSpeed, maxSpeed, startSoc, endSoc, null, null,
            startAddr, endAddr, 47.6, -122.3, 47.7, -122.2);
    }

    private static DrivesListPageViewModel NewViewModel(IDrivesListSource source) =>
        new(source, NullDriveBulkDeleteService.Instance, Localizer, clock: () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<DriveListItem>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveListItem>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<DriveListItem>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeDrivesListSource(params RepositoryResult<IReadOnlyList<DriveListItem>>[] results)
        : IDrivesListSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveListItem>>> StreamAsync(
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

    private sealed class FakeBulkDeleteService : IDriveBulkDeleteService
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
