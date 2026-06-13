using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EfficiencyPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/EfficiencyPage.tsx), the tolerant two-source parsers, the four-state matrix
/// (loading / empty / error / success), the SI display formatting at the boundary, and the generated-client
/// feed's request shaping (web <c>useDrivingStats</c> + <c>useDrives</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="EfficiencyDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class EfficiencyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 42 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "efficiency.avg", "efficiency.avgConsumption", "efficiency.avgSpeed", "efficiency.avgSpeedCol",
        "efficiency.co2Label", "efficiency.co2Saved", "efficiency.col.date", "efficiency.col.range",
        "efficiency.costPerKm", "efficiency.costPerKmLabel", "efficiency.dailyTrend", "efficiency.dailyTrend.aria",
        "efficiency.drives", "efficiency.drivesAnalyzed", "efficiency.insights", "efficiency.kmPerKwh",
        "efficiency.noInsights", "efficiency.noStatCards", "efficiency.noStats", "efficiency.noSummary",
        "efficiency.noTempData", "efficiency.regenRatio", "efficiency.regenRatioLabel", "efficiency.speed",
        "efficiency.speedDist", "efficiency.speedDist.aria", "efficiency.speedVsEfficiency",
        "efficiency.speedVsEfficiency.aria", "efficiency.subtitle", "efficiency.summary", "efficiency.temp",
        "efficiency.tempEfficiency", "efficiency.tempRange", "efficiency.tempVsEfficiency",
        "efficiency.tempVsEfficiency.aria", "efficiency.title", "efficiency.topSpeed", "efficiency.total",
        "efficiency.totalDistLabel", "efficiency.totalDistance", "efficiency.totalDriveTime", "efficiency.totalRegen",
    ];

    private static EfficiencyStats SampleStats(double avgEfficiencyWhKm = 160, double totalDistanceKm = 500) => new(
        TotalDrives: 10,
        TotalDistanceKm: totalDistanceKm,
        TotalDurationS: 36000,
        AvgEfficiencyWhKm: avgEfficiencyWhKm,
        AvgSpeedKmh: 12,
        TopSpeedKmh: 30,
        RegenRatio: 0.25,
        RegenEnergyWh: 5000,
        Co2SavedKg: 42);

    private static EfficiencyDrive Drive(
        string startTs = "2026-06-01T08:00:00Z",
        double distanceM = 10000,
        double startBatt = 80,
        double endBatt = 70,
        double avgSpeedMps = 15,
        double tempC = 20) =>
        new(startTs, distanceM, avgSpeedMps, tempC, startBatt, endBatt);

    private static IReadOnlyList<EfficiencyDrive> SampleDrives(int count = 5)
    {
        var drives = new List<EfficiencyDrive>(count);
        for (int i = 0; i < count; i++)
        {
            drives.Add(Drive(startTs: $"2026-06-0{i + 1}T08:00:00Z", avgSpeedMps: 15 + i, tempC: 18 + i));
        }

        return drives;
    }

    private static EfficiencyModel SuccessModel(EfficiencyStats? stats = null, IReadOnlyList<EfficiencyDrive>? drives = null) =>
        new(new EfficiencySnapshot(stats ?? SampleStats(), drives ?? SampleDrives()), false, null);

    private static EfficiencyDisplay Project(EfficiencyModel model, UnitPref? units = null) =>
        EfficiencyProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 42 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = EfficiencyProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = EfficiencyProjection.Project(EfficiencyModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_forty_two_unique_keys() =>
        Assert.Equal(42, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(EfficiencyModel.Initial);

        Assert.Equal(EfficiencyState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_stats_and_no_drives()
    {
        var model = new EfficiencyModel(EfficiencySnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(EfficiencyState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No efficiency data available yet", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_stats_query_failed()
    {
        var model = new EfficiencyModel(EfficiencySnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(EfficiencyState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_stats_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(EfficiencyState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.HasStats);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_success_when_only_drives_present()
    {
        var model = new EfficiencyModel(new EfficiencySnapshot(null, SampleDrives()), false, null);
        var display = Project(model);

        Assert.Equal(EfficiencyState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.HasStats);
    }

    // ---- Hero gauge + readouts -----------------------------------------------------

    [Fact]
    public void Hero_gauge_and_readouts_project_in_metric()
    {
        var display = Project(SuccessModel());

        Assert.Equal(160, display.GaugeValue);
        Assert.Equal(300, display.GaugeMax);
        Assert.Equal("Avg Wh/km", display.GaugeLabel);

        // km/kWh = 1000 / avgEfficiencyWhKm.
        Assert.Equal(6.25, display.HeroReadouts[0].Value, 3);
        Assert.Equal("km/kWh", display.HeroReadouts[0].Label);
        Assert.Equal(1, display.HeroReadouts[0].Decimals);

        // CO2 saved (kg), rounded.
        Assert.Equal(42, display.HeroReadouts[1].Value);
        Assert.Equal("CO\u2082 Saved (kg)", display.HeroReadouts[1].Label);

        Assert.Equal("Total km", display.HeroReadouts[2].Label);
    }

    [Fact]
    public void Hero_gauge_clamps_to_max()
    {
        var display = Project(SuccessModel(SampleStats(avgEfficiencyWhKm: 999)));
        Assert.Equal(300, display.GaugeValue);
    }

    [Fact]
    public void Hero_empty_when_no_stats()
    {
        var model = new EfficiencyModel(new EfficiencySnapshot(null, SampleDrives()), false, null);
        var display = Project(model);

        Assert.False(display.HasStats);
        Assert.Equal("No efficiency data available yet", display.HeroEmptyMessage);
    }

    // ---- Stat cards ----------------------------------------------------------------

    [Fact]
    public void Stat_cards_project_four_tiles_in_metric()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("Avg Wh/km", display.StatCards[0].Label);
        Assert.Equal("160.00", display.StatCards[0].Value);
        Assert.Equal("Avg Speed km/h", display.StatCards[1].Label);
        Assert.Equal("43.20", display.StatCards[1].Value);   // web feeds avg_speed_kmh through the m/s converter
        Assert.Equal("Est. Cost/km", display.StatCards[2].Label);
        Assert.Equal("$0.019", display.StatCards[2].Value);
        Assert.Equal("Drives Analyzed", display.StatCards[3].Label);
        Assert.Equal("10", display.StatCards[3].Value);
    }

    [Fact]
    public void Stat_cards_in_imperial_convert_efficiency_to_wh_per_mi()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        Assert.Equal("Avg Wh/mi", display.StatCards[0].Label);
        // 160 Wh/km * 1.609344 = 257.50 Wh/mi.
        Assert.Equal("257.50", display.StatCards[0].Value);
    }

    // ---- Charts --------------------------------------------------------------------

    [Fact]
    public void Charts_have_data_with_five_drives()
    {
        var display = Project(SuccessModel());

        Assert.True(display.TrendChart.HasData);
        Assert.True(display.SpeedDistChart.HasData);
        Assert.True(display.SpeedVsEffChart.HasData);
        Assert.True(display.TempVsEffChart.HasData);

        Assert.Equal("Daily Efficiency (Wh/km)", display.TrendChart.Title);
        Assert.Equal("Daily efficiency trend area chart", display.TrendChart.AriaLabel);
        Assert.Equal("Speed versus efficiency scatter plot", display.SpeedVsEffChart.AriaLabel);
        Assert.Equal("Temperature versus efficiency scatter plot", display.TempVsEffChart.AriaLabel);
    }

    [Fact]
    public void Scatter_charts_need_more_than_three_points()
    {
        // 3 drives -> scatter HasData false (web gates speedVsEff.length > 3); trend (> 2) still true.
        var display = Project(SuccessModel(drives: SampleDrives(3)));

        Assert.False(display.SpeedVsEffChart.HasData);
        Assert.False(display.TempVsEffChart.HasData);
        Assert.True(display.TrendChart.HasData);
        Assert.Equal(3, display.SpeedVsEffChart.Points.Count);
    }

    [Fact]
    public void Charts_empty_when_no_drives()
    {
        var display = Project(new EfficiencyModel(new EfficiencySnapshot(SampleStats(), Array.Empty<EfficiencyDrive>()), false, null));

        Assert.False(display.TrendChart.HasData);
        Assert.False(display.SpeedDistChart.HasData);
        Assert.False(display.SpeedVsEffChart.HasData);
        Assert.False(display.TempVsEffChart.HasData);
        Assert.Empty(display.TrendChart.Points);
    }

    // ---- Temperature-bucketed table ------------------------------------------------

    [Fact]
    public void Temp_table_buckets_drives_with_six_columns()
    {
        var display = Project(SuccessModel());

        Assert.True(display.TableHasData);
        Assert.Equal(6, display.TableColumns.Count);
        Assert.Equal("Temp Range", display.TableColumns[0].Header);
        Assert.Equal("Drives", display.TableColumns[1].Header);
        Assert.Equal("Avg Wh/km", display.TableColumns[2].Header);
        Assert.Equal("km/kWh", display.TableColumns[3].Header);

        Assert.NotEmpty(display.TableRows);
        var first = display.TableRows[0];
        Assert.Equal("10\u201320\u00B0C", first.Range);   // sample temps 18..22 -> buckets 10-20 (first) and 20-30
    }

    [Fact]
    public void Temp_table_empty_when_no_temperature_data()
    {
        var drives = new[] { Drive() with { OutsideTempAvgC = null } };
        var display = Project(new EfficiencyModel(new EfficiencySnapshot(SampleStats(), drives), false, null));

        Assert.False(display.TableHasData);
        Assert.Equal("Not enough data for temperature breakdown", display.TableEmptyMessage);
    }

    // ---- Summary metric bars + insights --------------------------------------------

    [Fact]
    public void Summary_bars_project_four_with_accents()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.SummaryBars.Count);
        Assert.Equal("Avg", display.SummaryBars[0].Label);
        Assert.Equal(160, display.SummaryBars[0].Value, 3);
        Assert.Equal(300, display.SummaryBars[0].Max);
        Assert.Equal("Regen Ratio", display.SummaryBars[2].Label);
        Assert.Equal(25, display.SummaryBars[2].Value, 3);   // 0.25 * 100
    }

    [Fact]
    public void Insights_project_six_readouts()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.Insights.Count);
        Assert.Equal("Total Regen", display.Insights[0].Label);
        Assert.Equal("Regen Ratio", display.Insights[1].Label);
        Assert.Equal("25.00%", display.Insights[1].Value);
        Assert.Equal("CO\u2082 Saved", display.Insights[2].Label);
        Assert.Equal("42 kg", display.Insights[2].Value);
        Assert.Equal("Top Speed", display.Insights[4].Label);
    }

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void Stats_parser_reads_snake_case_wire_shape()
    {
        using var doc = JsonDocument.Parse(
            """
            {"total_drives":7,"total_distance_km":123.4,"total_duration_s":4200,"avg_efficiency_wh_km":155.5,
             "avg_speed_kmh":13.2,"top_speed_kmh":30.1,"regen_ratio":0.31,"regen_energy_wh":900.0,"co2_saved_kg":12.5}
            """);

        var stats = EfficiencyStats.FromJson(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(7, stats!.TotalDrives);
        Assert.Equal(123.4, stats.TotalDistanceKm, 3);
        Assert.Equal(155.5, stats.AvgEfficiencyWhKm, 3);
        Assert.Equal(0.31, stats.RegenRatio, 3);
    }

    [Fact]
    public void Stats_parser_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(EfficiencyStats.FromJson(doc.RootElement));
    }

    [Fact]
    public void Drives_parser_reads_array_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            [{"start_ts":"2026-06-01T08:00:00Z","distance_m":10000,"avg_speed_mps":15,"outside_temp_avg_c":20,
              "start_battery_pct":80,"end_battery_pct":70},
             {"start_ts":"2026-06-02T08:00:00Z","distance_m":5000}]
            """);

        var drives = EfficiencySnapshot.ParseDrives(doc.RootElement);

        Assert.Equal(2, drives.Count);
        Assert.Equal(10000, drives[0].DistanceM);
        Assert.Equal(15, drives[0].AvgSpeedMps);
        Assert.Null(drives[1].AvgSpeedMps);
        Assert.Null(drives[1].StartBatteryPct);
    }

    [Fact]
    public void Drive_efficiency_returns_null_without_battery_drop()
    {
        Assert.Null(Drive(startBatt: 70, endBatt: 80).Efficiency());   // gained charge
        Assert.Null(Drive(distanceM: 0).Efficiency());                  // no distance
        Assert.NotNull(Drive(startBatt: 80, endBatt: 70, distanceM: 10000).Efficiency());
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task Feed_requests_stats_and_drives_scoped_to_vehicle()
    {
        var api = new StubApiClient((request) => request.OperationId == EfficiencyRegistration.StatsOperation
            ? """{"total_drives":3,"total_distance_km":50,"avg_efficiency_wh_km":150}"""
            : """[{"start_ts":"2026-06-01T08:00:00Z","distance_m":10000,"start_battery_pct":80,"end_battery_pct":70,"avg_speed_mps":12,"outside_temp_avg_c":15}]""");
        var feed = new EfficiencyClientFeed(api, vehicleId: 42);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.True(snapshot.HasStats);
        Assert.Single(snapshot.Drives);
        Assert.Equal(2, api.Requests.Count);
        Assert.Contains(api.Requests, r => r.OperationId == EfficiencyRegistration.StatsOperation);
        Assert.Contains(api.Requests, r => r.OperationId == EfficiencyRegistration.DrivesOperation);
        Assert.All(api.Requests, r => Assert.Equal(42L, r.Query!["vehicle_id"]));
    }

    [Fact]
    public async Task Feed_propagates_stats_failure_as_error()
    {
        var api = new StubApiClient(request => request.OperationId == EfficiencyRegistration.StatsOperation ? null : "[]");
        var feed = new EfficiencyClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Feed_degrades_to_empty_drives_when_drives_fail()
    {
        var api = new StubApiClient(request => request.OperationId == EfficiencyRegistration.StatsOperation
            ? """{"total_drives":1,"avg_efficiency_wh_km":150}"""
            : null);
        var feed = new EfficiencyClientFeed(api, vehicleId: 1);

        var snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.True(snapshot.HasStats);
        Assert.Empty(snapshot.Drives);
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
