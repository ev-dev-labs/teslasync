using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Maps;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TemperatureImpactPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/maps/pages/TemperatureImpactPage.tsx) with its loading / empty / error / success matrix,
/// the tolerant <c>points[]</c> parser, the SI temperature / Wh-km→Wh-mi formatting at the display boundary, the
/// ported <c>TEMP_BUCKETS_C</c> / <c>getTempBucketIndex</c> / <c>bucketLabel</c> / <c>stats</c> /
/// <c>scatterData</c> / <c>tips</c> helpers, the twenty-two manifest i18n keys, the view-model state matrix and
/// the generated-client feed's request shaping (web <c>['temperature-impact', vehicleId]</c> query). The WinUI
/// view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="TemperatureImpactDisplay"/> flags asserted here.
/// </summary>
public sealed class TemperatureImpactPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The twenty-two i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData",
        "error.loadFailed",
        "tempImpact.avgEff",
        "tempImpact.avgEfficiency",
        "tempImpact.bestRange",
        "tempImpact.bucketTitle",
        "tempImpact.efficiency",
        "tempImpact.optimalDelta",
        "tempImpact.optimalDesc",
        "tempImpact.optimalTitle",
        "tempImpact.scatterName",
        "tempImpact.scatterTitle",
        "tempImpact.subtitle",
        "tempImpact.temperature",
        "tempImpact.tipCold",
        "tempImpact.tipHot",
        "tempImpact.tipOptimal",
        "tempImpact.tipsTitle",
        "tempImpact.title",
        "tempImpact.totalPoints",
        "tempImpact.worstRange",
        "temperature.title",
    ];

    private static TempEfficiencyPoint Point(
        double outsideTempC,
        double efficiencyWhKm,
        double distanceKm = 20,
        string driveDate = "2026-05-10") =>
        new(outsideTempC, efficiencyWhKm, distanceKm, driveDate);

    // cold (-10 °C, 200), optimal (15 °C, 150), hot (40 °C, 250): best=10–20, worst=>30.
    private static IReadOnlyList<TempEfficiencyPoint> SamplePoints() =>
        [Point(15, 150), Point(40, 250), Point(-10, 200)];

    private static TemperatureImpactModel SuccessModel(IReadOnlyList<TempEfficiencyPoint>? points = null) =>
        new(TempImpactSnapshot.Compose(points ?? SamplePoints()), false, null);

    private static TemperatureImpactDisplay Project(TemperatureImpactModel model, UnitPref? units = null) =>
        TemperatureImpactProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    // ---- i18n key coverage (all 22 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = TemperatureImpactProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = TemperatureImpactProjection.Project(TemperatureImpactModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_two_unique_keys() =>
        Assert.Equal(22, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(TemperatureImpactModel.Initial);

        Assert.Equal(TemperatureImpactState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_points()
    {
        var display = Project(new TemperatureImpactModel(TempImpactSnapshot.Empty, false, null));

        Assert.Equal(TemperatureImpactState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var display = Project(new TemperatureImpactModel(TempImpactSnapshot.Empty, false, "boom"));

        Assert.Equal(TemperatureImpactState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load data", display.ErrorTitle);
        Assert.Equal("boom", display.ErrorDetail);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_points_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(TemperatureImpactState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
    }

    // ---- Summary metric cards (Avg-Efficiency / Best / Worst / Total) --------------

    [Fact]
    public void StatCards_expose_four_summary_tiles_in_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Avg Efficiency", display.StatCards[0].Label);
        Assert.Equal("200.00 Wh/km", display.StatCards[0].Value);
        Assert.Equal("Best Temp Range", display.StatCards[1].Label);
        Assert.Equal("10\u201320\u00B0C", display.StatCards[1].Value);
        Assert.Equal("150.00 Wh/km", display.StatCards[1].Subtitle);
        Assert.Equal("Worst Temp Range", display.StatCards[2].Label);
        Assert.Equal("> 30\u00B0C", display.StatCards[2].Value);
        Assert.Equal("Total Data Points", display.StatCards[3].Label);
        Assert.Equal("3", display.StatCards[3].Value);
    }

    [Fact]
    public void StatCards_fall_back_to_em_dash_without_data()
    {
        var display = Project(TemperatureImpactModel.Initial);

        Assert.Equal("\u2014", display.StatCards[0].Value);
        Assert.Equal("\u2014", display.StatCards[1].Value);
        Assert.Equal("0", display.StatCards[3].Value);
    }

    // ---- Temperature buckets (web getTempBucketIndex + bucketLabel) ----------------

    [Theory]
    [InlineData(-10, 0)]
    [InlineData(5, 1)]
    [InlineData(15, 2)]
    [InlineData(25, 3)]
    [InlineData(40, 4)]
    [InlineData(100, 2)]
    public void TempBucketIndex_matches_web_half_open_bands(double tempC, int expected) =>
        Assert.Equal(expected, TemperatureImpactProjection.TempBucketIndex(tempC));

    [Fact]
    public void BucketLabel_metric_uses_open_below_open_above_and_ranges()
    {
        Assert.Equal("< 0\u00B0C", TemperatureImpactProjection.BucketLabel(0, UnitPref.Metric));
        Assert.Equal("10\u201320\u00B0C", TemperatureImpactProjection.BucketLabel(2, UnitPref.Metric));
        Assert.Equal("> 30\u00B0C", TemperatureImpactProjection.BucketLabel(4, UnitPref.Metric));
    }

    [Fact]
    public void BucketLabel_imperial_converts_boundaries_to_fahrenheit()
    {
        Assert.Equal("< 32\u00B0F", TemperatureImpactProjection.BucketLabel(0, UnitPref.Imperial));
        Assert.Equal("50\u201368\u00B0F", TemperatureImpactProjection.BucketLabel(2, UnitPref.Imperial));
        Assert.Equal("> 86\u00B0F", TemperatureImpactProjection.BucketLabel(4, UnitPref.Imperial));
    }

    // ---- Stats (web stats memo) ----------------------------------------------------

    [Fact]
    public void ComputeStats_averages_and_selects_best_and_worst_buckets()
    {
        var stats = TemperatureImpactProjection.ComputeStats(SamplePoints(), UnitPref.Metric, isMiles: false);

        Assert.NotNull(stats);
        Assert.Equal(200, stats!.AvgEff);
        Assert.Equal(3, stats.Total);
        Assert.Equal(5, stats.BucketAvgs.Count);
        Assert.Equal("10\u201320\u00B0C", stats.Best!.Label);
        Assert.Equal(150, stats.Best.Avg);
        Assert.Equal("> 30\u00B0C", stats.Worst!.Label);
        Assert.Equal(250, stats.Worst.Avg);
    }

    [Fact]
    public void ComputeStats_is_null_without_points() =>
        Assert.Null(TemperatureImpactProjection.ComputeStats([], UnitPref.Metric, isMiles: false));

    [Fact]
    public void ComputeStats_converts_efficiency_to_wh_per_mile_when_imperial()
    {
        var stats = TemperatureImpactProjection.ComputeStats([Point(15, 100)], UnitPref.Imperial, isMiles: true);

        Assert.NotNull(stats);
        Assert.Equal(100 * TemperatureImpactProjection.KmPerMile, stats!.AvgEff, 6);
    }

    // ---- Scatter chart (GlassPanel5 + ScatterChart) --------------------------------

    [Fact]
    public void Scatter_points_convert_temperature_and_efficiency_at_the_boundary()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.ScatterPoints.Count);
        Assert.Equal("Drives", display.ScatterSeriesName);
        Assert.Equal("Temperature vs Efficiency", display.ScatterTitle);
        Assert.Contains(display.ScatterPoints, p => p.X == 15 && p.Y == 150);
        Assert.True(display.HasAverageLine);
        Assert.Equal(200, display.AverageLine);
        Assert.Equal("200.00 Wh/km", display.AverageLineLabel);
        Assert.Equal("Temperature (\u00B0C)", display.ScatterXAxisLabel);
        Assert.Equal("Efficiency (Wh/km)", display.ScatterYAxisLabel);
    }

    [Fact]
    public void Scatter_efficiency_axis_switches_to_wh_per_mile_when_imperial()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("Efficiency (Wh/mi)", display.ScatterYAxisLabel);
        Assert.Contains("\u00B0F", display.ScatterXAxisLabel, StringComparison.Ordinal);
    }

    // ---- Line chart (GlassPanel6 + LineChart) --------------------------------------

    [Fact]
    public void Buckets_expose_all_five_bands_with_averages_and_counts()
    {
        var display = Project(SuccessModel());

        Assert.Equal(5, display.Buckets.Count);
        Assert.Equal("Efficiency by Temperature Range", display.BucketTitle);
        Assert.Equal("Avg Efficiency (Wh/km)", display.BucketSeriesName);
        Assert.Equal(200, display.Buckets[0].Avg);
        Assert.Equal(1, display.Buckets[0].Count);
        Assert.Equal(0, display.Buckets[1].Avg);
        Assert.Equal(0, display.Buckets[1].Count);
        Assert.Equal(150, display.Buckets[2].Avg);
        Assert.Equal("150.00 Wh/km", display.Buckets[2].ValueText);
    }

    // ---- Optimal Temperature Analysis (GlassPanel7) --------------------------------

    [Fact]
    public void Optimal_panel_describes_best_range_with_delta_and_badges()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasOptimal);
        Assert.Equal("Optimal Temperature Analysis", display.OptimalTitle);
        Assert.Contains("10\u201320\u00B0C", display.OptimalDesc, StringComparison.Ordinal);
        Assert.Contains("150.00", display.OptimalDesc, StringComparison.Ordinal);
        Assert.Contains("across 1 drives", display.OptimalDesc, StringComparison.Ordinal);
        Assert.Contains("> 30\u00B0C", display.OptimalDelta, StringComparison.Ordinal);
        Assert.Contains("100.00", display.OptimalDelta, StringComparison.Ordinal);

        // One badge per populated bucket (cold/optimal/hot); the best range is the success badge.
        Assert.Equal(3, display.OptimalBadges.Count);
        Assert.Contains(display.OptimalBadges, b => b.Variant == StatusKind.Success && b.Text.Contains("10\u201320\u00B0C", StringComparison.Ordinal));
        Assert.Contains(display.OptimalBadges, b => b.Variant == StatusKind.Neutral);
    }

    [Fact]
    public void Optimal_panel_absent_without_data()
    {
        var display = Project(TemperatureImpactModel.Initial);

        Assert.False(display.HasOptimal);
        Assert.Empty(display.OptimalBadges);
    }

    [Fact]
    public void Optimal_delta_empty_when_best_equals_worst()
    {
        var display = Project(SuccessModel([Point(15, 150)]));

        Assert.True(display.HasOptimal);
        Assert.Equal(string.Empty, display.OptimalDelta);
    }

    // ---- Recommendations (GlassPanel8) ---------------------------------------------

    [Fact]
    public void Tips_include_optimal_cold_and_hot_when_those_buckets_have_data()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.Tips.Count);
        Assert.Equal(StatusKind.Success, display.Tips[0].Variant);
        Assert.Contains("10\u201320\u00B0C", display.Tips[0].Text, StringComparison.Ordinal);
        Assert.Contains(display.Tips, t => t.Variant == StatusKind.Info && t.Text.Contains("Precondition", StringComparison.Ordinal));
        Assert.Contains(display.Tips, t => t.Variant == StatusKind.Warning && t.Text.Contains("shade", StringComparison.Ordinal));
    }

    [Fact]
    public void Tips_only_optimal_when_no_cold_or_hot_samples()
    {
        var display = Project(SuccessModel([Point(15, 150), Point(18, 160)]));

        Assert.Single(display.Tips);
        Assert.Equal(StatusKind.Success, display.Tips[0].Variant);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Point_parses_snake_case_fields()
    {
        var point = TempEfficiencyPoint.FromJson(Json(
            "{\"outside_temp\":12.5,\"efficiency_wh_km\":148.2,\"distance_km\":33.1,\"drive_date\":\"2026-05-01\"}"));

        Assert.NotNull(point);
        Assert.Equal(12.5, point!.OutsideTempC);
        Assert.Equal(148.2, point.EfficiencyWhKm);
        Assert.Equal(33.1, point.DistanceKm);
        Assert.Equal("2026-05-01", point.DriveDate);
    }

    [Fact]
    public void Point_is_null_for_a_non_object_body() =>
        Assert.Null(TempEfficiencyPoint.FromJson(Json("42")));

    [Fact]
    public void ParsePoints_reads_the_points_array()
    {
        var points = TemperatureImpactClientFeed.ParsePoints(Json(
            "{\"points\":[{\"outside_temp\":5,\"efficiency_wh_km\":190},{\"outside_temp\":25,\"efficiency_wh_km\":175}]}"));

        Assert.Equal(2, points.Count);
        Assert.Equal(5, points[0].OutsideTempC);
        Assert.Equal(175, points[1].EfficiencyWhKm);
    }

    [Fact]
    public void ParsePoints_tolerates_a_missing_points_array() =>
        Assert.Empty(TemperatureImpactClientFeed.ParsePoints(Json("{}")));

    [Fact]
    public void ParsePoints_tolerates_a_non_object_body() =>
        Assert.Empty(TemperatureImpactClientFeed.ParsePoints(Json("[]")));

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_points_into_the_success_state()
    {
        var feed = new FakeTemperatureImpactFeed(TempImpactSnapshot.Compose(SamplePoints()));
        using var vm = new TemperatureImpactPageViewModel(feed, Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(TemperatureImpactState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new TemperatureImpactPageViewModel(EmptyTemperatureImpactFeed.Instance, Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(TemperatureImpactState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new TemperatureImpactPageViewModel(new ThrowingTemperatureImpactFeed(), Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(TemperatureImpactState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeTemperatureImpactFeed(TempImpactSnapshot.Compose(SamplePoints()));
        using var vm = new TemperatureImpactPageViewModel(feed, Localizer, UnitPref.Metric);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web temperature-impact query) ----------------------

    [Fact]
    public async Task ClientFeed_sends_the_operation_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"points\":[{\"outside_temp\":12,\"efficiency_wh_km\":150}]}"));
        var feed = new TemperatureImpactClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Single(snapshot.Points);
        Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_temperature_impact", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new TemperatureImpactClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_empty_points_resolve_to_the_empty_snapshot()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"points\":[]}"));
        var feed = new TemperatureImpactClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.False(snapshot.HasData);
        Assert.Empty(snapshot.Points);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new TemperatureImpactDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemperatureImpactPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("TemperatureImpact", TemperatureImpactRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_temperature_impact", TemperatureImpactRegistration.TemperatureImpactOperation);
        Assert.Equal("Temperature Impact", TemperatureImpactRegistration.Title(Localizer));
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

    private sealed class FakeTemperatureImpactFeed(TempImpactSnapshot snapshot) : ITemperatureImpactFeed
    {
        public int FetchCount { get; private set; }

        public Task<TempImpactSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingTemperatureImpactFeed : ITemperatureImpactFeed
    {
        public Task<TempImpactSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
