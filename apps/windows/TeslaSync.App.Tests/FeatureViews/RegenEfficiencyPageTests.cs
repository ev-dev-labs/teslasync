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
/// Headless verification of the <c>RegenEfficiencyPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/RegenEfficiencyPage.tsx) with its loading / empty / error / success matrix,
/// the tolerant two-source parsers, the SI distance / energy / power formatting at the display boundary, the
/// ported <c>regenColor</c> / <c>getRegenRatio</c> / <c>monthlyTrend</c> / <c>regenDrives</c> helpers, the
/// thirty manifest i18n keys, the view-model state matrix, and the generated-client feed's request shaping
/// (web <c>useRegenEfficiency</c> + <c>useDrives</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="RegenEfficiencyDisplay"/> flags asserted here.
/// </summary>
public sealed class RegenEfficiencyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The thirty i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData",
        "help.regenEfficiency.iconLabel",
        "regen.col.drives",
        "regen.col.month",
        "regen.col.regenKwh",
        "regen.date",
        "regen.distanceCol",
        "regen.drives",
        "regen.freeCharges",
        "regen.freeChargesBar",
        "regen.lifetimeDrive",
        "regen.lifetimeRegen",
        "regen.maxRegenCol",
        "regen.metrics",
        "regen.monthlyAvg",
        "regen.monthlyAvgBar",
        "regen.monthlyTrend",
        "regen.monthlyTrend.aria",
        "regen.noData",
        "regen.ratioCol",
        "regen.ratioLabel",
        "regen.recentDrives",
        "regen.recoveredInfo",
        "regen.regenKwh",
        "regen.regenRatio",
        "regen.regenRatioBar",
        "regen.subtitle",
        "regen.title",
        "regen.totalRegen",
        "regen.totalRegenLabel",
    ];

    private static RegenSummary SampleSummary(
        double totalRegenWh = 84000,
        double totalDriveWh = 320000,
        double regenRatio = 26,
        double monthlyAvgRegen = 1500,
        double freeCharges = 1.4) =>
        new(totalRegenWh, totalDriveWh, regenRatio, monthlyAvgRegen, freeCharges);

    private static RegenDrive Drive(
        long id = 1,
        string? startTs = "2026-05-10T08:00:00Z",
        double distanceM = 24000,
        double? energyUsedWh = 5000,
        double? regenEnergyWh = 900,
        double? avgPowerW = 12000) =>
        new(
            id,
            startTs is null ? null : DateTimeOffset.Parse(startTs, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            distanceM,
            energyUsedWh,
            regenEnergyWh,
            avgPowerW);

    private static RegenEfficiencyModel SuccessModel(
        RegenSummary? summary = null, IReadOnlyList<RegenDrive>? drives = null) =>
        new(RegenEfficiencySnapshot.Compose(summary ?? SampleSummary(), drives ?? [Drive()]), false, null);

    private static RegenEfficiencyDisplay Project(RegenEfficiencyModel model, UnitPref? units = null) =>
        RegenEfficiencyProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 30 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = RegenEfficiencyProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = RegenEfficiencyProjection.Project(RegenEfficiencyModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_thirty_unique_keys() =>
        Assert.Equal(30, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(RegenEfficiencyModel.Initial);

        Assert.Equal(RegenEfficiencyState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_regen_object()
    {
        var model = new RegenEfficiencyModel(RegenEfficiencySnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(RegenEfficiencyState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No regen efficiency data available yet", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_regen_query_failed()
    {
        var model = new RegenEfficiencyModel(RegenEfficiencySnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(RegenEfficiencyState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_regen_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(RegenEfficiencyState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Hero gauge + recovery summary (GlassPanel1) -------------------------------

    [Fact]
    public void Gauge_rounds_the_ratio_and_maps_quality_status()
    {
        var display = Project(SuccessModel(SampleSummary(regenRatio: 26.4)));

        Assert.Equal(26, display.GaugeValue);
        Assert.Equal(100, display.GaugeMax);
        Assert.Equal("%", display.GaugeUnit);
        Assert.Equal(StatusKind.Success, display.GaugeStatus);
    }

    [Theory]
    [InlineData(30, StatusKind.Success)]
    [InlineData(18, StatusKind.Info)]
    [InlineData(10, StatusKind.Warning)]
    [InlineData(3, StatusKind.Danger)]
    public void RegenStatus_follows_the_web_color_bands(double ratio, StatusKind expected) =>
        Assert.Equal(expected, RegenEfficiencyProjection.RegenStatus(ratio));

    [Fact]
    public void Recovered_summary_formats_kwh_and_free_charges()
    {
        var display = Project(SuccessModel(SampleSummary(totalRegenWh: 84000, freeCharges: 1.4)));

        // 84000 Wh -> 84.0 kWh, 1.40 free charges (the catalog template hardcodes the kWh unit).
        Assert.Contains("84.0", display.RecoveredInfo, StringComparison.Ordinal);
        Assert.Contains("1.40", display.RecoveredInfo, StringComparison.Ordinal);
    }

    // ---- Six summary stat cards (GlassPanel2..GlassPanel7) -------------------------

    [Fact]
    public void Stat_cards_project_six_tiles_with_lifetime_placeholders()
    {
        var display = Project(SuccessModel(SampleSummary(totalRegenWh: 84000, regenRatio: 26, monthlyAvgRegen: 1500, freeCharges: 1.4)), UnitPref.Imperial);

        Assert.Equal(6, display.StatCards.Count);
        Assert.Equal(UnitFormatters.FormatEnergy(84000, UnitPref.Imperial, 1), display.StatCards[0].Value);
        Assert.Equal("Total Regen", display.StatCards[0].Label);
        Assert.Equal(ScalarFormatters.FormatPercentage(26, 2), display.StatCards[1].Value);
        Assert.Equal(UnitFormatters.FormatPower(1500, UnitPref.Imperial, 1), display.StatCards[2].Value);
        Assert.Equal(ScalarFormatters.FormatNumber(1.4, 2), display.StatCards[3].Value);

        // Lifetime regen / drive energy are always unavailable on the web page — the last two tiles are the dash.
        Assert.Equal("\u2014", display.StatCards[4].Value);
        Assert.Equal("\u2014", display.StatCards[5].Value);
    }

    // ---- Regen-metrics strip (GlassPanel9) ----------------------------------------

    [Fact]
    public void Metric_bars_project_four_bars_with_accent_brushes()
    {
        var display = Project(SuccessModel(SampleSummary(totalRegenWh: 84000, regenRatio: 26, monthlyAvgRegen: 1500, freeCharges: 1.4)));

        Assert.Equal(4, display.MetricBars.Count);

        Assert.Equal(84000, display.MetricBars[0].Value);
        Assert.Equal(100000, display.MetricBars[0].Max);
        Assert.Equal("TsColorSuccessBrush", display.MetricBars[0].AccentBrushKey);

        Assert.Equal(26, display.MetricBars[1].Value);
        Assert.Equal(100, display.MetricBars[1].Max);
        Assert.Equal("TsColorAccentBrush", display.MetricBars[1].AccentBrushKey);

        Assert.Equal(1500, display.MetricBars[2].Value);
        Assert.Equal("TsColorInfoBrush", display.MetricBars[2].AccentBrushKey);

        Assert.Equal(1.4, display.MetricBars[3].Value);
        Assert.Equal(10, display.MetricBars[3].Max);
        Assert.Equal("TsColorWarningBrush", display.MetricBars[3].AccentBrushKey);
    }

    // ---- Monthly-Regen-Trend chart -------------------------------------------------

    [Fact]
    public void Monthly_trend_buckets_drives_by_month_and_converts_distance()
    {
        var drives = new List<RegenDrive>
        {
            Drive(id: 1, startTs: "2026-03-05T08:00:00Z", distanceM: 10000, regenEnergyWh: 1000),
            Drive(id: 2, startTs: "2026-03-20T08:00:00Z", distanceM: 20000, regenEnergyWh: 2000),
            Drive(id: 3, startTs: "2026-04-10T08:00:00Z", distanceM: 30000, regenEnergyWh: 3000),
        };

        var rows = RegenEfficiencyProjection.BuildMonthlyTrend(drives, UnitPref.Metric);

        Assert.Equal(2, rows.Count);
        Assert.Equal("2026-03", rows[0].Month);
        Assert.Equal(2, rows[0].Drives);
        Assert.Equal(3.0, rows[0].RegenKwh, 3);   // (1000 + 2000) / 1000
        Assert.Equal(30.0, rows[0].Distance, 3);  // (10000 + 20000) m -> 30 km
        Assert.Equal("2026-04", rows[1].Month);
        Assert.Equal(1, rows[1].Drives);
    }

    [Fact]
    public void Monthly_trend_keeps_only_the_most_recent_twelve_months()
    {
        var drives = new List<RegenDrive>();
        for (int i = 0; i < 14; i++)
        {
            int year = 2025 + (i / 12);
            int month = (i % 12) + 1;
            drives.Add(Drive(id: i + 1, startTs: $"{year:D4}-{month:D2}-01T00:00:00Z", regenEnergyWh: 1000));
        }

        var rows = RegenEfficiencyProjection.BuildMonthlyTrend(drives, UnitPref.Metric);

        // 14 months from 2025-01 to 2026-02; only the most recent twelve (2025-03 .. 2026-02) are kept.
        Assert.Equal(12, rows.Count);
        Assert.Equal("2025-03", rows[0].Month);
        Assert.Equal("2026-02", rows[^1].Month);
    }

    [Fact]
    public void Trend_chart_visible_only_with_more_than_one_month()
    {
        var single = Project(SuccessModel(drives: [Drive(id: 1, startTs: "2026-03-05T08:00:00Z")]));
        Assert.False(single.Trend.Visible);

        var multi = Project(SuccessModel(drives:
        [
            Drive(id: 1, startTs: "2026-03-05T08:00:00Z"),
            Drive(id: 2, startTs: "2026-04-05T08:00:00Z"),
        ]));
        Assert.True(multi.Trend.Visible);
        Assert.Equal(2, multi.Trend.Series.Count);
        Assert.Equal(ChartSeriesKind.Bar, multi.Trend.Series[0].Kind);
        Assert.Equal(ChartSeriesKind.Line, multi.Trend.Series[1].Kind);
        Assert.Equal(ChartRole.Regen, multi.Trend.Series[1].Role);
    }

    // ---- Recent-regen-drives table (GlassPanel10) ---------------------------------

    [Fact]
    public void Table_includes_only_drives_with_positive_regen_capped_at_twenty()
    {
        var drives = new List<RegenDrive> { Drive(id: 99, regenEnergyWh: 0) };
        for (int i = 0; i < 25; i++)
        {
            drives.Add(Drive(id: 100 + i, regenEnergyWh: 500));
        }

        var display = Project(SuccessModel(drives: drives));

        Assert.Equal(20, display.TableRows.Count);
        Assert.DoesNotContain(display.TableRows, r => r.Id == "99");
        Assert.Collection(
            display.TableColumns,
            c => Assert.Equal("Date", c),
            c => Assert.Equal("Distance", c),
            c => Assert.Equal("Max Regen", c),
            c => Assert.Equal("Ratio", c));
    }

    [Fact]
    public void Table_formats_distance_max_regen_and_ratio_at_the_display_boundary()
    {
        var drive = Drive(id: 7, distanceM: 24000, energyUsedWh: 5000, regenEnergyWh: 900, avgPowerW: 12000);
        var display = Project(SuccessModel(drives: [drive]), UnitPref.Imperial);

        var row = Assert.Single(display.TableRows);
        Assert.Equal("7", row.Id);
        Assert.Equal(
            $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(24000, DistanceUnit.Mi), 2)} mi",
            row.Distance);
        Assert.Equal($"{ScalarFormatters.FormatNumber(0.9, 2)} kWh", row.MaxRegen);
        // ratio = 900 / 5000 * 100 = 18% -> Info band.
        Assert.Equal(ScalarFormatters.FormatPercentage(18, 2), row.Ratio);
        Assert.Equal(StatusKind.Info, row.RatioStatus);
    }

    [Fact]
    public void Table_empty_message_when_no_regen_drives()
    {
        var display = Project(SuccessModel(drives: [Drive(regenEnergyWh: 0)]));

        Assert.Empty(display.TableRows);
        Assert.Equal("No data available", display.TableEmptyMessage);
    }

    // ---- Per-drive regen ratio (web getRegenRatio) --------------------------------

    [Fact]
    public void RegenRatio_is_null_without_positive_power_or_energy()
    {
        Assert.Null(Drive(avgPowerW: 0).RegenRatio());
        Assert.Null(Drive(avgPowerW: null).RegenRatio());
        Assert.Null(Drive(energyUsedWh: 0, avgPowerW: 1000).RegenRatio());
        Assert.Null(Drive(regenEnergyWh: 0, avgPowerW: 1000).RegenRatio());
    }

    [Fact]
    public void RegenRatio_is_regen_over_energy_used()
    {
        var ratio = Drive(energyUsedWh: 5000, regenEnergyWh: 1000, avgPowerW: 12000).RegenRatio();
        Assert.Equal(20, ratio);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Summary_parses_snake_case_fields()
    {
        var summary = RegenSummary.FromJson(Json(
            "{\"total_regen_wh\":84000,\"total_drive_wh\":320000,\"regen_ratio\":26.25," +
            "\"monthly_avg_regen\":1500,\"free_charges\":1.4}"));

        Assert.NotNull(summary);
        Assert.Equal(84000, summary!.TotalRegenWh);
        Assert.Equal(320000, summary.TotalDriveWh);
        Assert.Equal(26.25, summary.RegenRatio);
        Assert.Equal(1500, summary.MonthlyAvgRegen);
        Assert.Equal(1.4, summary.FreeCharges);
    }

    [Fact]
    public void Summary_is_null_for_a_non_object_body() =>
        Assert.Null(RegenSummary.FromJson(Json("null")));

    [Fact]
    public void Drive_parses_si_fields()
    {
        var drive = RegenDrive.FromJson(Json(
            "{\"id\":42,\"start_ts\":\"2026-05-01T10:00:00Z\",\"distance_m\":24000," +
            "\"energy_used_wh\":5000,\"regen_energy_wh\":900,\"avg_power_w\":12000}"));

        Assert.Equal(42, drive.Id);
        Assert.Equal(24000, drive.DistanceM);
        Assert.Equal(900, drive.RegenEnergyWh);
        Assert.Equal(12000, drive.AvgPowerW);
        Assert.NotNull(drive.StartTs);
    }

    [Fact]
    public void ParseDrives_tolerates_a_non_array_body() =>
        Assert.Empty(RegenEfficiencyClientFeed.ParseDrives(Json("{}")));

    [Fact]
    public void ParseDrives_reads_an_array_of_drive_objects()
    {
        var drives = RegenEfficiencyClientFeed.ParseDrives(Json(
            "[{\"id\":1,\"distance_m\":1000},{\"id\":2,\"distance_m\":2000}]"));

        Assert.Equal(2, drives.Count);
        Assert.Equal(1, drives[0].Id);
        Assert.Equal(2000, drives[1].DistanceM);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_regen_into_the_success_state()
    {
        var feed = new FakeRegenFeed(RegenEfficiencySnapshot.Compose(SampleSummary(), [Drive()]));
        using var vm = new RegenEfficiencyPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new RegenEfficiencyPageViewModel(EmptyRegenEfficiencyFeed.Instance, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new RegenEfficiencyPageViewModel(new ThrowingRegenFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(RegenEfficiencyState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeRegenFeed(RegenEfficiencySnapshot.Compose(SampleSummary(), [Drive()]));
        using var vm = new RegenEfficiencyPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useRegenEfficiency + useDrives) ----------------

    [Fact]
    public async Task ClientFeed_sends_both_operations_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_regen_wh\":84000,\"regen_ratio\":26}"));
        api.ReturnsValue(Json("[{\"id\":1,\"distance_m\":1000,\"regen_energy_wh\":500}]"));
        var feed = new RegenEfficiencyClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(84000, snapshot.Summary.TotalRegenWh);
        Assert.Single(snapshot.Drives);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_analytics_regen", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_drives", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_regen_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new RegenEfficiencyClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_only_drives_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_regen_wh\":42000}"));
        api.Throws(new ApiException("drives subsystem down", 503));
        var feed = new RegenEfficiencyClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(42000, snapshot.Summary.TotalRegenWh);
        Assert.Empty(snapshot.Drives);
    }

    [Fact]
    public async Task ClientFeed_appends_the_range_to_the_regen_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_regen_wh\":1}"));
        api.ReturnsValue(Json("[]"));
        var feed = new RegenEfficiencyClientFeed(api, vehicleId: 5, start: "2026-01-01", end: "2026-06-01");

        await feed.FetchAsync(default);

        Assert.Equal("2026-01-01", api.Requests[0].Query!["start"]?.ToString());
        Assert.Equal("2026-06-01", api.Requests[0].Query!["end"]?.ToString());
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new RegenEfficiencyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RegenEfficiencyPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("RegenEfficiency", RegenEfficiencyRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_regen", RegenEfficiencyRegistration.RegenOperation);
        Assert.Equal("get_api_v1_drives", RegenEfficiencyRegistration.DrivesOperation);
        Assert.Equal("Regenerative Braking", RegenEfficiencyRegistration.Title(Localizer));
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

    private sealed class FakeRegenFeed(RegenEfficiencySnapshot snapshot) : IRegenEfficiencyFeed
    {
        public int FetchCount { get; private set; }

        public Task<RegenEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingRegenFeed : IRegenEfficiencyFeed
    {
        public Task<RegenEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
