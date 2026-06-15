using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LifetimeStatsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/analytics/pages/LifetimeStatsPage.tsx), the tolerant single-source parser, the four-state
/// matrix (loading / empty / error / success), the SI display formatting at the boundary, and the
/// generated-client feed's request shaping (web <c>useLifetimeStats</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="LifetimeStatsDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class LifetimeStatsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    // The 41 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "lifetime.achievements", "lifetime.activitySummary", "lifetime.avgEfficiency", "lifetime.avoided",
        "lifetime.biggestCharge", "lifetime.co2Offset", "lifetime.coffeesEquiv", "lifetime.days",
        "lifetime.daysOnRoad", "lifetime.earthCompare", "lifetime.earthProgress", "lifetime.electricCost",
        "lifetime.environmentalImpact", "lifetime.funFacts", "lifetime.gasCost", "lifetime.heroSubtitle",
        "lifetime.highestSpeed", "lifetime.homesPowered", "lifetime.hours", "lifetime.longestDrive",
        "lifetime.moonProgress", "lifetime.mostActiveDay", "lifetime.mostActiveHour", "lifetime.noAchievements",
        "lifetime.noData", "lifetime.noSavingsData", "lifetime.personalRecords", "lifetime.savingsComparison",
        "lifetime.sessions", "lifetime.since", "lifetime.subtitle", "lifetime.title", "lifetime.totalDistance",
        "lifetime.totalDrives", "lifetime.totalEnergy", "lifetime.totalSavings", "lifetime.treesEquiv",
        "lifetime.treesPlanted", "lifetime.unlocked", "lifetime.vsGas", "lifetime.youSaved",
    ];

    private static LifetimeStats SampleStats() => new(
        TotalDrives: 100,
        TotalDistanceKm: 5000,
        TotalDrivingHours: 120.5,
        AvgEfficiencyWhKm: 165,
        TotalChargeSessions: 80,
        TotalEnergyKwh: 950.4,
        TotalChargingCost: 200,
        GasEquivalentCost: 800,
        TotalSavings: 600,
        Co2OffsetKg: 1200,
        TreesEquivalent: 55,
        EarthCircumferences: 2.5,
        MoonTrips: 0.05,
        DaysOnRoad: 45.5,
        HomesEquivalentDays: 30.2,
        FirstDriveDate: "2024-01-15T00:00:00Z",
        OwnershipDays: 500,
        MostActiveDayOfWeek: "Saturday",
        MostActiveHour: 17,
        LongestDriveRecord: new LifetimeRecord(450, "2025-03-10T00:00:00Z"),
        HighestSpeedRecord: new LifetimeRecord(195, "2025-04-20T00:00:00Z"),
        MaxChargeRecord: new LifetimeRecord(75.5, "2025-05-05T00:00:00Z"),
        Achievements:
        [
            new LifetimeAchievementInfo("first-drive", "First Drive", "Drive once", "\uD83D\uDE97", true, "2024-01-15", 1, 1, 1),
            new LifetimeAchievementInfo("road-warrior", "Road Warrior", "Drive far", "\uD83C\uDFC1", true, "2024-06-01", 1, 1, 1),
            new LifetimeAchievementInfo("century", "Century", "100 drives", "\uD83C\uDFAF", false, null, 0.5, 200, 100),
        ]);

    private static LifetimeStatsModel SuccessModel(LifetimeStats? stats = null) =>
        new(new LifetimeStatsSnapshot(stats ?? SampleStats()), false, null);

    private static LifetimeStatsDisplay Project(LifetimeStatsModel model, UnitPref? units = null) =>
        LifetimeStatsProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 41 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = LifetimeStatsProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = LifetimeStatsProjection.Project(LifetimeStatsModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_forty_one_unique_keys() =>
        Assert.Equal(41, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(LifetimeStatsModel.Initial);

        Assert.Equal(LifetimeStatsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_stats()
    {
        var display = Project(new LifetimeStatsModel(LifetimeStatsSnapshot.Empty, false, null));

        Assert.Equal(LifetimeStatsState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No driving data yet", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var display = Project(new LifetimeStatsModel(LifetimeStatsSnapshot.Empty, false, "network down"));

        Assert.Equal(LifetimeStatsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_stats_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(LifetimeStatsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.HasStats);
        Assert.False(display.ShowEmpty);
    }

    // ---- Hero (web GlassPanel1) ----------------------------------------------------

    [Fact]
    public void Hero_projects_distance_and_subtitle_in_metric()
    {
        var display = Project(SuccessModel());

        Assert.Equal(5000, display.HeroDistanceValue);
        Assert.Equal("km", display.HeroDistanceUnit);
        Assert.Equal("driven across 100 drives", display.HeroSubtitle);
        Assert.Equal("That's 2.50x around the Earth!", display.HeroEarthCompare);
        Assert.Equal("Tracking since Jan 15, 2024 (500 days)", display.HeroSince);
    }

    [Fact]
    public void Hero_distance_converts_to_miles_in_imperial()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("mi", display.HeroDistanceUnit);
        Assert.Equal(3106.86, display.HeroDistanceValue, 2);   // 5000 km / 1.609344
    }

    [Fact]
    public void Hero_hides_earth_and_since_when_zero()
    {
        var stats = SampleStats() with { EarthCircumferences = 0, OwnershipDays = 0 };
        var display = Project(SuccessModel(stats));

        Assert.Equal(string.Empty, display.HeroEarthCompare);
        Assert.Equal(string.Empty, display.HeroSince);
    }

    // ---- Key stat cards (Total-Drives / Total-Distance / Total-Energy / Total-Savings) ----

    [Fact]
    public void Stat_cards_project_four_tiles_in_metric()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.StatCards.Count);

        Assert.Equal("Total Drives", display.StatCards[0].Label);
        Assert.Equal("100", display.StatCards[0].Value);
        Assert.Equal("120.5 hrs", display.StatCards[0].Sublabel);

        Assert.Equal("Total Distance", display.StatCards[1].Label);
        Assert.Equal("5,000 km", display.StatCards[1].Value);

        Assert.Equal("Total Energy", display.StatCards[2].Label);
        Assert.Equal("950.4 kWh", display.StatCards[2].Value);
        Assert.Equal("80 sessions", display.StatCards[2].Sublabel);

        Assert.Equal("Total Savings", display.StatCards[3].Label);
        Assert.Equal("$600", display.StatCards[3].Value);
        Assert.Equal("vs gasoline", display.StatCards[3].Sublabel);
    }

    [Fact]
    public void Total_distance_card_converts_to_miles_in_imperial()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);
        Assert.Equal("3,107 mi", display.StatCards[1].Value);   // 3106.86 rounded to 0 dp
    }

    // ---- Fun facts (web GlassPanel6) -----------------------------------------------

    [Fact]
    public void Fun_facts_project_four_tiles()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.FunFacts.Count);
        Assert.Equal("250.0", display.FunFacts[0].Value);   // 2.5 * 100
        Assert.Equal("%", display.FunFacts[0].Unit);
        Assert.Equal("around the Earth", display.FunFacts[0].Label);
        Assert.Equal("5.00", display.FunFacts[1].Value);    // 0.05 * 100
        Assert.Equal("55", display.FunFacts[2].Value);
        Assert.Equal("30.2", display.FunFacts[3].Value);
        Assert.Equal("days", display.FunFacts[3].Unit);
    }

    // ---- Savings comparison (web GlassPanel7) --------------------------------------

    [Fact]
    public void Savings_has_data_when_gas_cost_positive()
    {
        var display = Project(SuccessModel());

        Assert.True(display.Savings.HasData);
        Assert.Equal("$200.00", display.Savings.ElectricValueText);
        Assert.Equal("$800.00", display.Savings.GasValueText);
        Assert.Equal("$600.00", display.Savings.SavedValueText);
        Assert.Equal(800, display.Savings.MaxCost);
        Assert.Contains("1,200 kg", display.Savings.Co2Text, StringComparison.Ordinal);
        Assert.Contains("avoided", display.Savings.Co2Text, StringComparison.Ordinal);
    }

    [Fact]
    public void Savings_empty_when_no_gas_equivalent()
    {
        var stats = SampleStats() with { GasEquivalentCost = 0 };
        var display = Project(SuccessModel(stats));

        Assert.False(display.Savings.HasData);
        Assert.Equal("Complete some drives to see savings", display.Savings.EmptyMessage);
    }

    // ---- Environmental impact (web GlassPanel8) ------------------------------------

    [Fact]
    public void Environment_projects_ring_and_comparisons()
    {
        var display = Project(SuccessModel());

        Assert.Equal(100, display.Environment.RingPercent);   // min(1200/1000*100, 100)
        Assert.Equal(1200, display.Environment.Co2Kg);
        Assert.Equal("55", display.Environment.TreesValue);
        Assert.Equal("120", display.Environment.CoffeesValue);   // round(600 / 5)
    }

    [Fact]
    public void Environment_ring_clamps_to_one_hundred_percent()
    {
        var stats = SampleStats() with { Co2OffsetKg = 250 };
        var display = Project(SuccessModel(stats));

        Assert.Equal(25, display.Environment.RingPercent);   // 250 / 1000 * 100
    }

    // ---- Personal records (web GlassPanel9) ----------------------------------------

    [Fact]
    public void Records_project_three_cards_in_metric()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.Records.Count);
        Assert.Equal("Longest Drive", display.Records[0].Title);
        Assert.Equal("450.0 km", display.Records[0].Value);
        Assert.Equal("Highest Speed", display.Records[1].Title);
        Assert.Equal("195 km/h", display.Records[1].Value);
        Assert.Equal("Biggest Charge", display.Records[2].Title);
        Assert.Equal("75.5 kWh", display.Records[2].Value);
        Assert.Equal("Mar 10, 2025", display.Records[0].Date);
    }

    [Fact]
    public void Records_convert_distance_and_speed_in_imperial()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("279.6 mi", display.Records[0].Value);   // 450 km / 1.609344
        Assert.Equal("121 mph", display.Records[1].Value);    // 195 km/h * 0.621371
    }

    // ---- Activity summary (web GlassPanel10) ---------------------------------------

    [Fact]
    public void Activity_projects_four_mini_stats()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Activity.Count);
        Assert.Equal("Saturday", display.Activity[0].Value);
        Assert.Equal("17:00", display.Activity[1].Value);
        Assert.Equal("45.5", display.Activity[2].Value);
        Assert.Equal("165 Wh/km", display.Activity[3].Value);
    }

    [Fact]
    public void Activity_falls_back_to_dash_when_missing()
    {
        var stats = SampleStats() with { MostActiveDayOfWeek = string.Empty, MostActiveHour = null, AvgEfficiencyWhKm = 0 };
        var display = Project(SuccessModel(stats));

        Assert.Equal("\u2014", display.Activity[0].Value);
        Assert.Equal("\u2014", display.Activity[1].Value);
        Assert.Equal("\u2014", display.Activity[3].Value);
    }

    // ---- Achievement gallery (web GlassPanel11) ------------------------------------

    [Fact]
    public void Achievements_project_with_unlocked_summary()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.Achievements.Count);
        Assert.Equal("2/3 \u2713 Unlocked", display.AchievementsSummary);
    }

    [Fact]
    public void Achievements_empty_message_when_none()
    {
        var stats = SampleStats() with { Achievements = Array.Empty<LifetimeAchievementInfo>() };
        var display = Project(SuccessModel(stats));

        Assert.Empty(display.Achievements);
        Assert.Equal("Start driving to unlock achievements", display.AchievementsEmptyMessage);
        Assert.Equal("0/0 \u2713 Unlocked", display.AchievementsSummary);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Stats_parser_reads_snake_case_wire_shape()
    {
        using var doc = JsonDocument.Parse(
            """
            {"total_drives":7,"total_distance_km":123.4,"total_energy_kwh":45.6,"total_savings":89.0,
             "co2_offset_kg":33.0,"trees_equivalent":4,"most_active_day_of_week":"Monday","most_active_hour":9,
             "longest_drive_record":{"value":42.0,"date":"2025-01-01T00:00:00Z"},
             "highest_speed_record":{"value":180.0,"date":null},
             "achievements":[{"id":"a","name":"A","description":"d","icon":"x","unlocked":true,"progress":1,"target":1,"current":1}]}
            """);

        var stats = LifetimeStats.FromJson(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(7, stats!.TotalDrives);
        Assert.Equal(123.4, stats.TotalDistanceKm, 3);
        Assert.Equal("Monday", stats.MostActiveDayOfWeek);
        Assert.Equal(9, stats.MostActiveHour);
        Assert.NotNull(stats.LongestDriveRecord);
        Assert.Equal(42.0, stats.LongestDriveRecord!.Value, 3);
        Assert.Equal("2025-01-01T00:00:00Z", stats.LongestDriveRecord.Date);
        Assert.Null(stats.HighestSpeedRecord!.Date);
        Assert.Single(stats.Achievements);
        Assert.True(stats.Achievements[0].Unlocked);
    }

    [Fact]
    public void Stats_parser_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(LifetimeStats.FromJson(doc.RootElement));
    }

    [Fact]
    public void Stats_parser_tolerates_missing_fields_and_records()
    {
        using var doc = JsonDocument.Parse("""{"total_drives":3}""");

        var stats = LifetimeStats.FromJson(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(3, stats!.TotalDrives);
        Assert.Null(stats.LongestDriveRecord);
        Assert.Empty(stats.Achievements);
        Assert.Equal(string.Empty, stats.MostActiveDayOfWeek);
        Assert.Null(stats.MostActiveHour);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_requests_lifetime_scoped_to_vehicle()
    {
        var api = new StubApiClient(_ => """{"total_drives":5,"total_distance_km":120}""");
        var feed = new LifetimeStatsClientFeed(api, vehicleId: 42);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.True(snapshot.HasData);
        Assert.Single(api.Requests);
        Assert.Equal(LifetimeStatsRegistration.LifetimeOperation, api.Requests[0].OperationId);
        Assert.Equal(42L, api.Requests[0].Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Feed_propagates_failure_as_error()
    {
        var api = new StubApiClient(_ => null);
        var feed = new LifetimeStatsClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(CancellationToken.None));
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

    private sealed class StubApiClient : IApiClient
    {
        private readonly Func<ApiRequest, string?> _responder;

        public StubApiClient(Func<ApiRequest, string?> responder) => _responder = responder;

        public List<ApiRequest> Requests { get; } = new();

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The stub resolves operations through SendAsync only.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            string? json = _responder(request);
            if (json is null)
            {
                throw new ApiException("stub failure");
            }

            using var doc = JsonDocument.Parse(json);
            object boxed = doc.RootElement.Clone();
            return Task.FromResult((T)boxed);
        }
    }
}
