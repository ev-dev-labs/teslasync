using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SpeedProfilePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/SpeedProfilePage.tsx) with its loading / empty / error / success matrix, the
/// tolerant two-source parsers, the SI speed / efficiency formatting at the display boundary, the ported
/// <c>getEfficiency</c> / <c>bucketColor</c> / <c>categoryIcon</c> / <c>scatterData</c> / <c>bucketEfficiency</c>
/// helpers, the twenty-one manifest i18n keys, the view-model state matrix, and the generated-client feed's
/// request shaping (web <c>useSpeedProfile</c> + <c>useDrives</c>). The WinUI view is exercised by the app build;
/// its per-region visibility is driven entirely by the <see cref="SpeedProfileDisplay"/> flags asserted here.
/// </summary>
public sealed class SpeedProfilePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The twenty-one i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "speedProfile.avgSpeed",
        "speedProfile.better",
        "speedProfile.distribution",
        "speedProfile.distribution.aria",
        "speedProfile.drives",
        "speedProfile.effVsSpeed",
        "speedProfile.effVsSpeed.aria",
        "speedProfile.efficient",
        "speedProfile.highConsumption",
        "speedProfile.insightText",
        "speedProfile.insightTitle",
        "speedProfile.lower",
        "speedProfile.moderate",
        "speedProfile.noData",
        "speedProfile.optimalSpeed",
        "speedProfile.peakSpeed",
        "speedProfile.speed",
        "speedProfile.subtitle",
        "speedProfile.timeShare",
        "speedProfile.timeSpent",
        "speedProfile.title",
    ];

    private static SpeedBucket[] SampleDistribution() =>
    [
        new("0-15", 8),
        new("15-30", 40),
        new("30-45", 30),
        new("45-60", 18),
        new("60+", 4),
    ];

    private static SpeedProfileSummary SampleSummary(
        double avgSpeedMps = 20,
        double peakSpeedMps = 35,
        double optimalSpeedMps = 18,
        IReadOnlyList<SpeedBucket>? distribution = null) =>
        new(avgSpeedMps, peakSpeedMps, optimalSpeedMps, distribution ?? SampleDistribution());

    private static SpeedDrive Drive(
        long id = 1,
        string? startTs = "2026-05-10T08:00:00Z",
        double distanceM = 10000,
        double? energyUsedWh = 1500,
        double? startBatteryPct = 80,
        double? endBatteryPct = 70,
        double? avgSpeedMps = 10) =>
        new(
            id,
            startTs is null ? null : DateTimeOffset.Parse(startTs, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            distanceM,
            energyUsedWh,
            startBatteryPct,
            endBatteryPct,
            avgSpeedMps);

    private static SpeedProfileModel SuccessModel(
        SpeedProfileSummary? summary = null, IReadOnlyList<SpeedDrive>? drives = null) =>
        new(SpeedProfileSnapshot.Compose(summary ?? SampleSummary(), drives ?? [Drive()]), false, null);

    private static SpeedProfileDisplay Project(SpeedProfileModel model, UnitPref? units = null) =>
        SpeedProfileProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    // ---- i18n key coverage (all 21 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = SpeedProfileProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SpeedProfileProjection.Project(SpeedProfileModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_one_unique_keys() =>
        Assert.Equal(21, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(SpeedProfileModel.Initial);

        Assert.Equal(SpeedProfileState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_profile_object()
    {
        var model = new SpeedProfileModel(SpeedProfileSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(SpeedProfileState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No speed profile data available yet", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_profile_query_failed()
    {
        var model = new SpeedProfileModel(SpeedProfileSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(SpeedProfileState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_profile_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(SpeedProfileState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Hero speed gauges (GlassPanel1) -------------------------------------------

    [Fact]
    public void Gauges_project_three_tiles_rounded_in_metric_with_ceilings_and_roles()
    {
        var display = Project(SuccessModel(SampleSummary(avgSpeedMps: 20, peakSpeedMps: 35, optimalSpeedMps: 18)));

        Assert.Equal(3, display.Gauges.Count);

        // 20 m/s -> 72 km/h, ceiling 55.56 m/s -> 200 km/h.
        Assert.Equal(72, display.Gauges[0].Value);
        Assert.Equal(200, display.Gauges[0].Max);
        Assert.Equal("km/h", display.Gauges[0].Unit);
        Assert.Equal("Avg Speed", display.Gauges[0].Label);
        Assert.Equal(ChartRole.Speed, display.Gauges[0].Role);

        // 35 m/s -> 126 km/h, ceiling 69.44 m/s -> 250 km/h.
        Assert.Equal(126, display.Gauges[1].Value);
        Assert.Equal(250, display.Gauges[1].Max);
        Assert.Equal("Peak Speed", display.Gauges[1].Label);
        Assert.Equal(ChartRole.Temperature, display.Gauges[1].Role);

        // 18 m/s -> 64.8 -> 65 km/h.
        Assert.Equal(65, display.Gauges[2].Value);
        Assert.Equal("Optimal Speed", display.Gauges[2].Label);
        Assert.Equal(ChartRole.Regen, display.Gauges[2].Role);
    }

    [Fact]
    public void Gauges_convert_speed_to_the_display_unit_in_imperial()
    {
        var display = Project(SuccessModel(SampleSummary(avgSpeedMps: 20)), UnitPref.Imperial);

        // 20 m/s -> 44.738 mph -> 45.
        Assert.Equal(45, display.Gauges[0].Value);
        Assert.Equal("mph", display.Gauges[0].Unit);
    }

    // ---- Speed-distribution bar chart (Speed-Distribution) -------------------------

    [Fact]
    public void Distribution_chart_projects_a_single_bar_series_over_the_buckets()
    {
        var display = Project(SuccessModel());

        Assert.True(display.Distribution.HasData);
        var series = Assert.Single(display.Distribution.Series);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal(5, series.Points.Count);
        Assert.Equal(40, series.Points[1].Y);            // second bucket readings
        Assert.Equal("15-30", series.Points[1].Label);
        Assert.Equal("Speed Distribution", display.Distribution.Title);
        Assert.Equal("Speed-bucket time-share distribution bar chart", display.Distribution.AriaLabel);
    }

    [Fact]
    public void Distribution_chart_is_empty_without_buckets()
    {
        var display = Project(SuccessModel(SampleSummary(distribution: Array.Empty<SpeedBucket>())));

        Assert.False(display.Distribution.HasData);
    }

    // ---- Speed-bucket detail cards (GlassPanel3) -----------------------------------

    [Fact]
    public void Bucket_cards_project_time_share_drives_and_colour_band()
    {
        var display = Project(SuccessModel(drives: Array.Empty<SpeedDrive>()));

        Assert.Equal(5, display.BucketCards.Count);

        // total readings = 8+40+30+18+4 = 100; second bucket = 40 -> 40.0%.
        var second = display.BucketCards[1];
        Assert.Equal("15-30", second.Range);
        Assert.Equal("40.0%", second.TimeShareText);
        Assert.Equal("40", second.DrivesText);
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Success), second.TimeShareBrushKey); // "15-30" -> includes 15

        var fifth = display.BucketCards[4];
        Assert.Equal("60+", fifth.Range);
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Warning), fifth.TimeShareBrushKey); // "60+" -> starts 60
    }

    [Fact]
    public void Bucket_cards_show_efficiency_block_only_with_matching_drives()
    {
        // A drive at 10 m/s -> 36 km/h lands in the "30-45" bucket; eff = 1500 Wh / 10 km = 150 Wh/km.
        var drive = Drive(avgSpeedMps: 10, distanceM: 10000, energyUsedWh: 1500);
        var display = Project(SuccessModel(drives: [drive, drive, drive]));

        var bucket = Assert.Single(display.BucketCards, c => c.Range == "30-45");
        Assert.True(bucket.HasEfficiency);
        Assert.Equal("Wh/km", bucket.EfficiencyLabel);
        Assert.Equal("150", bucket.EfficiencyText);                 // 150 Wh/km, 0 decimals, metric
        Assert.Equal("36.0 km/h", bucket.AvgSpeedText);             // 10 m/s -> 36 km/h
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Success), bucket.EfficiencyBrushKey); // 150 < 160

        var noDrives = Assert.Single(display.BucketCards, c => c.Range == "0-15");
        Assert.False(noDrives.HasEfficiency);
        Assert.Equal("\u2014", noDrives.AvgSpeedText);
    }

    [Fact]
    public void Bucket_cards_convert_efficiency_to_wh_per_mile_in_imperial()
    {
        var drive = Drive(avgSpeedMps: 10, distanceM: 10000, energyUsedWh: 1500);
        var display = Project(SuccessModel(drives: [drive]), UnitPref.Imperial);

        // 10 m/s -> 22.37 mph lands in "15-30" (mph buckets); eff 150 Wh/km -> 241 Wh/mi.
        var bucket = Assert.Single(display.BucketCards, c => c.Range == "15-30");
        Assert.True(bucket.HasEfficiency);
        Assert.Equal("Wh/mi", bucket.EfficiencyLabel);
        Assert.Equal("241", bucket.EfficiencyText);
    }

    // ---- Efficiency-vs-speed scatter (Efficiency-vs-Speed) -------------------------

    [Fact]
    public void Scatter_is_visible_only_with_more_than_three_eligible_drives()
    {
        var drives = new List<SpeedDrive>();
        for (int i = 0; i < 3; i++)
        {
            drives.Add(Drive(id: i + 1, avgSpeedMps: 15 + i, distanceM: 10000, energyUsedWh: 1500));
        }

        var three = Project(SuccessModel(drives: drives));
        Assert.False(three.Scatter.Visible);

        drives.Add(Drive(id: 99, avgSpeedMps: 20, distanceM: 10000, energyUsedWh: 1500));
        var four = Project(SuccessModel(drives: drives));
        Assert.True(four.Scatter.Visible);

        var series = Assert.Single(four.Scatter.Series);
        Assert.Equal(ChartSeriesKind.Scatter, series.Kind);
        Assert.Equal(4, series.Points.Count);
    }

    [Fact]
    public void Scatter_excludes_drives_without_speed_or_efficiency()
    {
        var drives = new List<SpeedDrive>
        {
            Drive(id: 1, avgSpeedMps: 0),                                            // zero speed -> excluded
            Drive(id: 2, avgSpeedMps: null),                                         // null speed -> excluded
            Drive(id: 3, avgSpeedMps: 20, distanceM: 0, energyUsedWh: 1500),         // no distance -> no efficiency
            Drive(id: 4, avgSpeedMps: 20, distanceM: 10000, energyUsedWh: 1500),     // eligible
        };

        var display = Project(SuccessModel(drives: drives));
        var series = Assert.Single(display.Scatter.Series);
        Assert.Single(series.Points);
    }

    [Fact]
    public void Scatter_projects_three_colour_legend_chips_and_subtitle()
    {
        var display = Project(SuccessModel());

        Assert.Collection(
            display.Scatter.Legend,
            c => Assert.Equal("Efficient", c.Label),
            c => Assert.Equal("Moderate", c.Label),
            c => Assert.Equal("High consumption", c.Label));
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Success), display.Scatter.Legend[0].BrushKey);
        Assert.Equal("Lower Wh/km = better", display.Scatter.Subtitle);
        Assert.Equal("Per-drive efficiency versus speed scatter plot", display.Scatter.AriaLabel);
    }

    // ---- Efficiency insight (GlassPanel5) ------------------------------------------

    [Fact]
    public void Insight_is_available_and_formats_optimal_speed_when_positive()
    {
        var display = Project(SuccessModel(SampleSummary(optimalSpeedMps: 18)));

        Assert.True(display.InsightAvailable);
        Assert.Equal("Efficiency Insight", display.InsightTitle);
        // 18 m/s -> 65 km/h interpolated into the insight template.
        Assert.Contains("65", display.InsightText, StringComparison.Ordinal);
        Assert.Contains("km/h", display.InsightText, StringComparison.Ordinal);
    }

    [Fact]
    public void Insight_falls_back_to_no_data_when_optimal_speed_is_zero()
    {
        var display = Project(SuccessModel(SampleSummary(optimalSpeedMps: 0)));

        Assert.False(display.InsightAvailable);
        Assert.Equal("No speed profile data available yet", display.InsightText);
    }

    // ---- Ported colour-band + bucket helpers ---------------------------------------

    [Theory]
    [InlineData("0-15", StatusKind.Success)]
    [InlineData("15-30", StatusKind.Success)]
    [InlineData("30-45", StatusKind.Info)]
    [InlineData("45-60", StatusKind.Info)]
    [InlineData("60-75", StatusKind.Warning)]
    [InlineData("90+", StatusKind.Danger)]
    public void BucketStatus_follows_the_web_speed_bands(string range, StatusKind expected) =>
        Assert.Equal(expected, SpeedProfileProjection.BucketStatus(range));

    [Theory]
    [InlineData(150, StatusKind.Success)]
    [InlineData(200, StatusKind.Warning)]
    [InlineData(260, StatusKind.Danger)]
    public void EfficiencyStatus_follows_the_web_thresholds(double eff, StatusKind expected) =>
        Assert.Equal(expected, SpeedProfileProjection.EfficiencyStatus(eff));

    [Theory]
    [InlineData(120, StatusKind.Success)]
    [InlineData(180, StatusKind.Info)]
    [InlineData(240, StatusKind.Warning)]
    [InlineData(300, StatusKind.Danger)]
    public void ScatterStatus_follows_the_web_thresholds(double eff, StatusKind expected) =>
        Assert.Equal(expected, SpeedProfileProjection.ScatterStatus(eff));

    [Theory]
    [InlineData("0-15", 0d, 15d)]
    [InlineData("60-75", 60d, 75d)]
    [InlineData("90+", 90d, 999d)]
    public void ParseBucketBounds_reads_numeric_bounds(string label, double lo, double hi)
    {
        var (parsedLo, parsedHi) = SpeedProfileProjection.ParseBucketBounds(label);
        Assert.Equal(lo, parsedLo);
        Assert.Equal(hi, parsedHi);
    }

    [Fact]
    public void ParseBucketBounds_is_null_for_a_non_numeric_label()
    {
        var (lo, _) = SpeedProfileProjection.ParseBucketBounds("all");
        Assert.Null(lo);
    }

    [Fact]
    public void BuildBucketEfficiency_buckets_drives_by_display_speed_and_averages()
    {
        var ranges = new SpeedBucket[] { new("0-15", 0), new("15-30", 0) };
        var drives = new List<SpeedDrive>
        {
            // 3 m/s -> 10.8 km/h -> "0-15"; eff = 1000 / 10 = 100 Wh/km.
            Drive(id: 1, avgSpeedMps: 3, distanceM: 10000, energyUsedWh: 1000),
            // 6 m/s -> 21.6 km/h -> "15-30"; eff = 2000 / 10 = 200 Wh/km.
            Drive(id: 2, avgSpeedMps: 6, distanceM: 10000, energyUsedWh: 2000),
        };

        var map = SpeedProfileProjection.BuildBucketEfficiency(drives, ranges, UnitPref.Metric);

        Assert.Equal(100, map["0-15"].AvgEff, 3);
        Assert.Equal(3, map["0-15"].AvgSpeedMps, 3);
        Assert.Equal(200, map["15-30"].AvgEff, 3);
    }

    // ---- Per-drive efficiency (web getEfficiency) ----------------------------------

    [Fact]
    public void Efficiency_uses_energy_when_available()
    {
        // 1500 Wh / 10 km = 150 Wh/km.
        Assert.Equal(150, Drive(distanceM: 10000, energyUsedWh: 1500).Efficiency());
    }

    [Fact]
    public void Efficiency_falls_back_to_battery_estimate()
    {
        // (80 - 70) * 0.75 * 1000 / 10 km = 750 Wh/km.
        var drive = Drive(distanceM: 10000, energyUsedWh: null, startBatteryPct: 80, endBatteryPct: 70);
        Assert.Equal(750, drive.Efficiency());
    }

    [Fact]
    public void Efficiency_is_null_without_distance_or_consumption()
    {
        Assert.Null(Drive(distanceM: 0).Efficiency());
        Assert.Null(Drive(distanceM: 10000, energyUsedWh: null, startBatteryPct: 70, endBatteryPct: 70).Efficiency());
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Summary_parses_snake_case_fields_and_distribution()
    {
        var summary = SpeedProfileSummary.FromJson(Json(
            "{\"avg_speed_mps\":20,\"peak_speed_mps\":35,\"optimal_speed_mps\":18," +
            "\"distribution\":[{\"speed_bucket\":\"0-15\",\"readings\":8},{\"speed_bucket\":\"15-30\",\"readings\":40}]}"));

        Assert.NotNull(summary);
        Assert.Equal(20, summary!.AvgSpeedMps);
        Assert.Equal(35, summary.PeakSpeedMps);
        Assert.Equal(18, summary.OptimalSpeedMps);
        Assert.Equal(2, summary.Distribution.Count);
        Assert.Equal("15-30", summary.Distribution[1].Label);
        Assert.Equal(40, summary.Distribution[1].Readings);
    }

    [Fact]
    public void Summary_is_null_for_a_non_object_body() =>
        Assert.Null(SpeedProfileSummary.FromJson(Json("null")));

    [Fact]
    public void Summary_tolerates_a_missing_distribution()
    {
        var summary = SpeedProfileSummary.FromJson(Json("{\"avg_speed_mps\":20}"));

        Assert.NotNull(summary);
        Assert.Empty(summary!.Distribution);
        Assert.Equal(0, summary.PeakSpeedMps);
    }

    [Fact]
    public void Drive_parses_si_fields()
    {
        var drive = SpeedDrive.FromJson(Json(
            "{\"id\":42,\"start_ts\":\"2026-05-01T10:00:00Z\",\"distance_m\":24000," +
            "\"energy_used_wh\":5000,\"avg_speed_mps\":18.5}"));

        Assert.Equal(42, drive.Id);
        Assert.Equal(24000, drive.DistanceM);
        Assert.Equal(5000, drive.EnergyUsedWh);
        Assert.Equal(18.5, drive.AvgSpeedMps);
        Assert.NotNull(drive.StartTs);
    }

    [Fact]
    public void ParseDrives_tolerates_a_non_array_body() =>
        Assert.Empty(SpeedProfileClientFeed.ParseDrives(Json("{}")));

    [Fact]
    public void ParseDrives_reads_an_array_of_drive_objects()
    {
        var drives = SpeedProfileClientFeed.ParseDrives(Json(
            "[{\"id\":1,\"distance_m\":1000},{\"id\":2,\"distance_m\":2000}]"));

        Assert.Equal(2, drives.Count);
        Assert.Equal(1, drives[0].Id);
        Assert.Equal(2000, drives[1].DistanceM);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_profile_into_the_success_state()
    {
        var feed = new FakeSpeedProfileFeed(SpeedProfileSnapshot.Compose(SampleSummary(), [Drive()]));
        using var vm = new SpeedProfilePageViewModel(feed, Localizer, UnitPref.Metric, () => DateTimeOffset.UnixEpoch);

        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(DateTimeOffset.UnixEpoch, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new SpeedProfilePageViewModel(EmptySpeedProfileFeed.Instance, Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new SpeedProfilePageViewModel(new ThrowingSpeedProfileFeed(), Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(SpeedProfileState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeSpeedProfileFeed(SpeedProfileSnapshot.Compose(SampleSummary(), [Drive()]));
        using var vm = new SpeedProfilePageViewModel(feed, Localizer, UnitPref.Metric);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useSpeedProfile + useDrives) --------------------

    [Fact]
    public async Task ClientFeed_sends_both_operations_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"avg_speed_mps\":20,\"peak_speed_mps\":35}"));
        api.ReturnsValue(Json("[{\"id\":1,\"distance_m\":1000,\"avg_speed_mps\":18}]"));
        var feed = new SpeedProfileClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(20, snapshot.Summary.AvgSpeedMps);
        Assert.Single(snapshot.Drives);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_analytics_speed_profile", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_drives", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_profile_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SpeedProfileClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_only_drives_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"avg_speed_mps\":42}"));
        api.Throws(new ApiException("drives subsystem down", 503));
        var feed = new SpeedProfileClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(42, snapshot.Summary.AvgSpeedMps);
        Assert.Empty(snapshot.Drives);
    }

    [Fact]
    public async Task ClientFeed_appends_the_range_to_the_profile_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"avg_speed_mps\":1}"));
        api.ReturnsValue(Json("[]"));
        var feed = new SpeedProfileClientFeed(api, vehicleId: 5, start: "2026-01-01", end: "2026-06-01");

        await feed.FetchAsync(default);

        Assert.Equal("2026-01-01", api.Requests[0].Query!["start"]?.ToString());
        Assert.Equal("2026-06-01", api.Requests[0].Query!["end"]?.ToString());
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedProfileDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedProfilePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("SpeedProfile", SpeedProfileRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_speed_profile", SpeedProfileRegistration.SpeedProfileOperation);
        Assert.Equal("get_api_v1_drives", SpeedProfileRegistration.DrivesOperation);
        Assert.Equal("Speed Profile", SpeedProfileRegistration.Title(Localizer));
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

    private sealed class FakeSpeedProfileFeed(SpeedProfileSnapshot snapshot) : ISpeedProfileFeed
    {
        public int FetchCount { get; private set; }

        public Task<SpeedProfileSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingSpeedProfileFeed : ISpeedProfileFeed
    {
        public Task<SpeedProfileSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
