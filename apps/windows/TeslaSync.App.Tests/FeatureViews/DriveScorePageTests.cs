using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveScorePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/DriveScorePage.tsx), the <c>scoreDrive</c> + grade ladder maths, the
/// aggregations (averages, trend / category / distribution series, best/worst, histogram, period stats,
/// achievements, pagination, key/value cards), the four-state matrix (loading / empty / error / success), the
/// 116-key i18n coverage, and the generated-client feed's request shaping (web <c>useDrives</c> +
/// <c>useDriveScore</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="DriveScoreDisplay"/> flags asserted here.
/// </summary>
public sealed class DriveScorePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 116 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData", "driveScore.aPlusCount", "driveScore.achievements.aPlusStreak",
        "driveScore.achievements.aPlusStreakDesc", "driveScore.achievements.efficiencyMaster",
        "driveScore.achievements.efficiencyMasterDesc", "driveScore.achievements.fiftyDrives",
        "driveScore.achievements.fiftyDrivesDesc", "driveScore.achievements.firstDrive",
        "driveScore.achievements.firstDriveDesc", "driveScore.achievements.perfectScore",
        "driveScore.achievements.perfectScoreDesc", "driveScore.achievements.smoothOperator",
        "driveScore.achievements.smoothOperatorDesc", "driveScore.achievements.speedSaint",
        "driveScore.achievements.speedSaintDesc", "driveScore.achievements.tenDrives",
        "driveScore.achievements.tenDrivesDesc", "driveScore.achievements.title",
        "driveScore.achievements.unlocked", "driveScore.avgConsumption", "driveScore.avgDistance",
        "driveScore.avgDuration", "driveScore.avgEffLabel", "driveScore.avgMaxSpeed", "driveScore.avgScore",
        "driveScore.basedOn", "driveScore.bestDrive", "driveScore.bestMonth", "driveScore.bestScore",
        "driveScore.bestWeek", "driveScore.breakdown", "driveScore.categoryBreakdown",
        "driveScore.categoryBreakdown.aria", "driveScore.col.category", "driveScore.col.date",
        "driveScore.col.drives", "driveScore.col.efficiency", "driveScore.col.max", "driveScore.col.range",
        "driveScore.col.score", "driveScore.col.smoothness", "driveScore.col.speed", "driveScore.col.value",
        "driveScore.colConsumption", "driveScore.colDate", "driveScore.colDistance", "driveScore.colDuration",
        "driveScore.colEfficiency", "driveScore.colGrade", "driveScore.colRoute", "driveScore.colScore",
        "driveScore.consumption", "driveScore.distance", "driveScore.driveHistory", "driveScore.drives",
        "driveScore.drivesInPeriod", "driveScore.drivesScored", "driveScore.durationLabel",
        "driveScore.efficiency", "driveScore.efficiencyLabel", "driveScore.empty", "driveScore.emptyTitle",
        "driveScore.gradeALine", "driveScore.gradeLabel", "driveScore.highestSpeed", "driveScore.noDrives",
        "driveScore.noPeriodStats", "driveScore.ofDrives", "driveScore.overall", "driveScore.periodStats",
        "driveScore.powerRange", "driveScore.ratedAPlus", "driveScore.score", "driveScore.scoreDistribution",
        "driveScore.scoreDistribution.aria", "driveScore.scoreTrend", "driveScore.scoreTrend.aria",
        "driveScore.smoothness", "driveScore.smoothnessLabel", "driveScore.speedDiscipline",
        "driveScore.speedLabel", "driveScore.subtitle", "driveScore.thisMonth", "driveScore.thisWeek",
        "driveScore.tipBestEff", "driveScore.tipBestSmooth", "driveScore.tipBestSpeed", "driveScore.tipWorstEff",
        "driveScore.tipWorstSmooth", "driveScore.tipWorstSpeed", "driveScore.tips.coastMore",
        "driveScore.tips.cruiseControl", "driveScore.tips.followDistance", "driveScore.tips.preCondition",
        "driveScore.tips.regenBraking", "driveScore.tips.routePlanning", "driveScore.tips.smoothAccel",
        "driveScore.tips.speedLimit", "driveScore.tips.tirePressure", "driveScore.tipsSubtitle",
        "driveScore.tipsTitle", "driveScore.title", "driveScore.totalDistance", "driveScore.totalDrivesLabel",
        "driveScore.totalDuration", "driveScore.totalLabel", "driveScore.totalScore", "driveScore.trendDown",
        "driveScore.trendFlat", "driveScore.trendUp", "driveScore.unknownRoute", "driveScore.vsLastMonth",
        "driveScore.vsLastWeek", "driveScore.worstDrive", "help.driveScore.iconLabel",
    ];

    private static DriveSample Drive(
        long id,
        DateTimeOffset start,
        double distanceM = 100000,
        double durationS = 3600,
        double? maxSpeedMps = null,
        long? startBatt = 80,
        long? endBatt = 60,
        double? avgPowerW = null,
        double? energyWh = null,
        string? startAddr = "A St",
        string? endAddr = "B St") =>
        new(id, start, start.AddSeconds(durationS), distanceM, durationS, maxSpeedMps, null,
            startBatt, endBatt, startAddr, endAddr, null, avgPowerW, energyWh);

    private static DriveScoreModel Model(
        IReadOnlyList<DriveSample> drives, ApiDriveScore? score = null, bool loading = false, string? err = null) =>
        new(DriveScoreSnapshot.Compose(drives, score), loading, err);

    private static DriveScoreDisplay Project(DriveScoreModel model, int page = 1) =>
        DriveScoreProjection.Project(model, UnitPref.Metric, Localizer, Now, page);

    private static List<DriveSample> Drives(int count) =>
        Enumerable.Range(1, count).Select(i => Drive(i, Now.AddDays(-i))).ToList();

    // ---- scoreDrive maths ----------------------------------------------------------

    [Fact]
    public void ScoreDrive_matches_the_web_algorithm()
    {
        var d = Drive(1, Now.AddDays(-1), distanceM: 100000, startBatt: 80, endBatt: 60);

        var s = ScoreMath.ScoreDrive(d);

        Assert.Equal(150, s.WhPerKm);
        Assert.Equal(33, s.Efficiency);
        Assert.Equal(20, s.Smoothness);
        Assert.Equal(30, s.Speed);
        Assert.Equal(83, s.Total);
        Assert.Equal("A", s.Grade);
    }

    [Theory]
    [InlineData(95, "A+")]
    [InlineData(85, "A")]
    [InlineData(75, "B")]
    [InlineData(65, "C")]
    [InlineData(55, "D")]
    [InlineData(40, "F")]
    public void GradeFromTotal_follows_the_web_ladder(double total, string grade) =>
        Assert.Equal(grade, ScoreMath.GradeFromTotal(total));

    [Theory]
    [InlineData("A+", StatusKind.Success)]
    [InlineData("A", StatusKind.Success)]
    [InlineData("B", StatusKind.Info)]
    [InlineData("C", StatusKind.Warning)]
    [InlineData("F", StatusKind.Danger)]
    public void GradeStatus_maps_to_the_web_variant(string grade, StatusKind status) =>
        Assert.Equal(status, ScoreMath.GradeStatus(grade));

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight_with_no_data()
    {
        var display = Project(Model([], loading: true));

        Assert.Equal(DriveScoreState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_no_drives()
    {
        var display = Project(Model([]));

        Assert.Equal(DriveScoreState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_all_drives_fall_outside_the_window()
    {
        var display = Project(Model([Drive(1, Now.AddDays(-60))]));

        Assert.Equal(DriveScoreState.Empty, display.State);
    }

    [Fact]
    public void State_error_when_feed_failed()
    {
        var display = Project(Model([], err: "network down"));

        Assert.Equal(DriveScoreState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_drives_present()
    {
        var display = Project(Model([Drive(1, Now.AddDays(-1))]));

        Assert.Equal(DriveScoreState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Section structure (every web region) --------------------------------------

    [Fact]
    public void Success_projects_every_section()
    {
        var display = Project(Model([Drive(1, Now.AddDays(-1)), Drive(2, Now.AddDays(-2))]));

        Assert.Equal(3, display.Categories.Count);
        Assert.Equal(4, display.TrendSeries.Count);
        Assert.Equal(2, display.CategorySeries.Count);
        Assert.Single(display.DistributionSeries);
        Assert.Equal(5, display.DistributionSeries[0].Points.Count);
        Assert.Equal(8, display.HistoryHeaders.Count);
        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal(6, display.PeriodPanels.Count);
        Assert.Equal(8, display.Achievements.Count);
        Assert.Equal(3, display.Tips.Count);
        Assert.Equal(4, display.ScoreBreakdown.Rows.Count);
        Assert.Equal(6, display.PeriodStatistics.Rows.Count);
        Assert.True(display.Best.Has);
        Assert.True(display.Worst.Has);
        Assert.True(display.HasPeriodStats);
    }

    [Fact]
    public void Overall_falls_back_to_the_average_when_no_server_score()
    {
        var display = Project(Model([Drive(1, Now.AddDays(-1))]));

        Assert.Equal(83d, display.OverallScore);
        Assert.Equal("A", display.GradeText);
        Assert.False(display.HasBasedOn);
    }

    [Fact]
    public void Server_score_overrides_the_computed_average()
    {
        var api = new ApiDriveScore(72, 35, 25, 22, "B", 99, "up");

        var display = Project(Model([Drive(1, Now.AddDays(-1))], api));

        Assert.Equal(72d, display.OverallScore);
        Assert.Equal("B", display.GradeText);
        Assert.Equal(StatusKind.Info, display.GradeStatus);
        Assert.True(display.HasBasedOn);
        Assert.Contains("99", display.BasedOnText, StringComparison.Ordinal);
        Assert.Equal("Improving", display.OverallTrendLabel);
    }

    [Fact]
    public void Best_and_worst_track_the_extreme_scores()
    {
        var good = Drive(1, Now.AddDays(-1), distanceM: 100000, startBatt: 80, endBatt: 60);
        var bad = Drive(2, Now.AddDays(-2), distanceM: 10000, startBatt: 80, endBatt: 20, maxSpeedMps: 60, avgPowerW: 90000);

        var display = Project(Model([good, bad]));

        Assert.True(display.Best.Score >= display.Worst.Score);
        Assert.Equal("Distance", display.Best.DistanceLabel);
    }

    [Fact]
    public void Pagination_engages_above_ten_rows()
    {
        var display = Project(Model(Drives(15)));

        Assert.Equal(15, display.TotalRows);
        Assert.True(display.ShowPagination);
        Assert.Equal(10, display.PageSize);
        Assert.True(display.HistoryRows.Count <= 10);
        Assert.Equal(1, display.Page);
    }

    [Fact]
    public void First_drive_achievement_unlocks_with_one_drive()
    {
        var display = Project(Model([Drive(1, Now.AddDays(-1))]));

        Assert.True(display.Achievements[0].Unlocked);
        Assert.False(display.Achievements[1].Unlocked);
    }

    [Fact]
    public void Ten_drives_achievement_unlocks_at_ten()
    {
        var display = Project(Model(Drives(10)));

        Assert.True(display.Achievements[1].Unlocked);
    }

    // ---- i18n coverage (all 116 manifest keys) -------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DriveScoreProjection.Project(Model([Drive(1, Now.AddDays(-1))]), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_one_hundred_sixteen_unique_keys() =>
        Assert.Equal(116, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void DriveSample_FromJson_reads_snake_case_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse(
            "{\"id\":5,\"start_ts\":\"2026-06-11T12:00:00Z\",\"distance_m\":1234.5,\"duration_s\":600}");

        var d = DriveSample.FromJson(doc.RootElement);

        Assert.Equal(5, d.Id);
        Assert.Equal(1234.5, d.DistanceM);
        Assert.Null(d.MaxSpeedMps);
    }

    [Fact]
    public void ApiDriveScore_FromJson_is_null_for_a_non_object()
    {
        using var doc = JsonDocument.Parse("\"nope\"");

        Assert.Null(ApiDriveScore.FromJson(doc.RootElement));
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_composes_drives_and_score_scoped_by_vehicle_id()
    {
        var drivesJson = JsonDocument.Parse(
            "[{\"id\":1,\"start_ts\":\"2026-06-11T12:00:00Z\",\"distance_m\":100000,\"duration_s\":3600,\"start_battery_pct\":80,\"end_battery_pct\":60}]")
            .RootElement.Clone();
        var scoreJson = JsonDocument.Parse(
            "{\"overall\":72,\"grade\":\"B\",\"efficiency\":35,\"smoothness\":25,\"speedDiscipline\":22,\"totalDrives\":99,\"trend\":\"up\"}")
            .RootElement.Clone();
        var api = new FakeApiClient().ReturnsValue(drivesJson).ReturnsValue(scoreJson);
        var feed = new DriveScoreClientFeed(api, 7);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.Single(snapshot.Drives);
        Assert.Equal(1, snapshot.Drives[0].Id);
        Assert.NotNull(snapshot.Score);
        Assert.Equal("B", snapshot.Score!.Grade);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(7L, (long)api.Requests[0].Query!["vehicle_id"]!);
    }

    [Fact]
    public async Task Feed_degrades_to_no_score_when_the_score_read_fails()
    {
        var drivesJson = JsonDocument.Parse(
            "[{\"id\":1,\"start_ts\":\"2026-06-11T12:00:00Z\",\"distance_m\":1000,\"duration_s\":60}]")
            .RootElement.Clone();
        var api = new FakeApiClient().ReturnsValue(drivesJson).Throws(new ApiException("boom", 500));
        var feed = new DriveScoreClientFeed(api, 7);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.Single(snapshot.Drives);
        Assert.Null(snapshot.Score);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_transitions_to_success_after_load()
    {
        var feed = new StubFeed(DriveScoreSnapshot.Compose([Drive(1, Now.AddDays(-1))], null));
        using var vm = new DriveScorePageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_paging_reprojects_the_history_page()
    {
        var feed = new StubFeed(DriveScoreSnapshot.Compose(Drives(15), null));
        using var vm = new DriveScorePageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        Assert.Equal(1, vm.Display.Page);

        vm.Page = 2;
        Assert.Equal(2, vm.Display.Page);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_when_feed_throws()
    {
        var feed = new ThrowingFeed(new ApiException("down", 500));
        using var vm = new DriveScorePageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    private sealed class StubFeed(DriveScoreSnapshot snapshot) : IDriveScoreFeed
    {
        public Task<DriveScoreSnapshot> FetchAsync(CancellationToken cancellationToken) => Task.FromResult(snapshot);
    }

    private sealed class ThrowingFeed(Exception exception) : IDriveScoreFeed
    {
        public Task<DriveScoreSnapshot> FetchAsync(CancellationToken cancellationToken) => throw exception;
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
}
