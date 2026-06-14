using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MileagePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/analytics/pages/MileagePage.tsx) with its loading / empty / error / success matrix, the
/// tolerant three-source parsers, the SI distance formatting at the display boundary, the ported <c>fromKm</c> /
/// <c>odometerData</c> / <c>dailyData</c> / <c>monthlyRows</c> helpers, the sixteen manifest i18n keys, the
/// view-model state matrix, and the generated-client feed's request shaping (web <c>useMileageStats</c> +
/// <c>useDailyMileage</c> + <c>useMonthlyMileage</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="MileageDisplay"/> flags asserted here.
/// </summary>
public sealed class MileagePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The sixteen i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Daily Distance",
        "Distance",
        "Distance per Drive",
        "Drives",
        "Month",
        "Monthly Summary",
        "No Entries",
        "Odometer",
        "Odometer Over Time",
        "error.loadFailed",
        "mileage.annualProjection",
        "mileage.dailyAvg",
        "mileage.subtitle",
        "mileage.title",
        "mileage.totalDistance",
        "mileage.totalDrives",
    ];

    private static MileageStats SampleStats(
        double lifetimeKm = 12000, double last30dKm = 900, long driveCountLifetime = 240) =>
        new(lifetimeKm, last30dKm, driveCountLifetime);

    private static MileageDailyBucket Daily(string date, double totalKm, double? endOdometerKm) =>
        new(date, totalKm, endOdometerKm);

    private static MileageMonthlyBucket Monthly(string yearMonth, double totalKm, long driveCount) =>
        new(yearMonth, totalKm, driveCount);

    private static MileageModel SuccessModel(
        MileageStats? stats = null,
        IReadOnlyList<MileageDailyBucket>? daily = null,
        IReadOnlyList<MileageMonthlyBucket>? monthly = null) =>
        new(
            MileageSnapshot.Compose(
                stats ?? SampleStats(),
                daily ?? [Daily("2026-05-01", 40, 12000)],
                monthly ?? [Monthly("2026-05", 1200, 24)]),
            false,
            null);

    private static MileageDisplay Project(MileageModel model, UnitPref? units = null) =>
        MileageProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    private static string Unit(UnitPref units) => UnitLabels.Label(units.Distance);

    // ---- i18n key coverage (all 16 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = MileageProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = MileageProjection.Project(MileageModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_sixteen_unique_keys() =>
        Assert.Equal(16, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_stats_query_in_flight()
    {
        var display = Project(MileageModel.Initial);

        Assert.Equal(MileageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_stats_object()
    {
        var model = new MileageModel(MileageSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(MileageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No Entries", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_stats_query_failed()
    {
        var model = new MileageModel(MileageSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(MileageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("Failed to load data", display.ErrorText, StringComparison.Ordinal);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_stats_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(MileageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Four summary metric cards (Total-Distance / Total-Drives / Daily-Avg-30d / Annual-Projection) ------

    [Fact]
    public void Metric_cards_project_four_tiles_with_web_labels_and_accents()
    {
        var display = Project(SuccessModel(SampleStats(lifetimeKm: 12000, last30dKm: 900, driveCountLifetime: 240)));

        Assert.Equal(4, display.MetricCards.Count);
        Assert.Equal("Total Distance", display.MetricCards[0].Label);
        Assert.Equal("Total Drives", display.MetricCards[1].Label);
        Assert.Equal("Daily Avg (30d)", display.MetricCards[2].Label);
        Assert.Equal("Annual Projection", display.MetricCards[3].Label);

        Assert.Equal("TsColorAccentBrush", display.MetricCards[0].AccentBrushKey);
        Assert.Equal("TsColorSuccessBrush", display.MetricCards[1].AccentBrushKey);
        Assert.Equal("TsColorInfoBrush", display.MetricCards[2].AccentBrushKey);
        Assert.Equal("TsColorAccentBrush", display.MetricCards[3].AccentBrushKey);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Metric_card_values_convert_distance_at_the_display_boundary(bool imperial)
    {
        var units = imperial ? UnitPref.Imperial : UnitPref.Metric;
        var stats = SampleStats(lifetimeKm: 12000, last30dKm: 900, driveCountLifetime: 240);
        var display = Project(SuccessModel(stats), units);

        double dailyAvgKm = 900 / 30.0;
        string unit = Unit(units);

        Assert.Equal($"{ScalarFormatters.FormatNumber(MileageProjection.FromKm(12000, units), 0)} {unit}", display.MetricCards[0].Value);
        Assert.Equal(ScalarFormatters.FormatNumber(240, 0), display.MetricCards[1].Value);
        Assert.Equal($"{ScalarFormatters.FormatNumber(MileageProjection.FromKm(dailyAvgKm, units), 2)} {unit}", display.MetricCards[2].Value);
        Assert.Equal($"{ScalarFormatters.FormatNumber(MileageProjection.FromKm(dailyAvgKm * 365, units), 0)} {unit}", display.MetricCards[3].Value);
    }

    // ---- Odometer-Over-Time area chart (GlassPanel5) -------------------------------

    [Fact]
    public void Odometer_chart_skips_days_with_a_null_final_odometer()
    {
        var daily = new List<MileageDailyBucket>
        {
            Daily("2026-05-01", 40, 12000),
            Daily("2026-05-02", 55, null),
            Daily("2026-05-03", 30, 12070),
        };

        var display = Project(SuccessModel(daily: daily));

        Assert.True(display.OdometerChart.HasData);
        Assert.Equal("Odometer Over Time", display.OdometerChart.Title);
        Assert.Equal("Odometer (km)", display.OdometerChart.SeriesName);
        Assert.Equal(2, display.OdometerChart.ColorIndex);
        // The null-odometer middle day is filtered out; the two readings remain, contiguously indexed.
        Assert.Equal(2, display.OdometerChart.Points.Count);
        Assert.Equal(0, display.OdometerChart.Points[0].X);
        Assert.Equal(1, display.OdometerChart.Points[1].X);
        Assert.Equal("May 1, 2026", display.OdometerChart.Points[0].Label);
        Assert.Equal(12000, display.OdometerChart.Points[0].Y);
    }

    [Fact]
    public void Odometer_chart_empty_when_no_qualifying_days()
    {
        var display = Project(SuccessModel(daily: [Daily("2026-05-02", 55, null)]));

        Assert.False(display.OdometerChart.HasData);
        Assert.Empty(display.OdometerChart.Points);
        Assert.Equal("No Entries", display.OdometerChart.EmptyMessage);
    }

    // ---- Daily-Distance bar chart (GlassPanel6) ------------------------------------

    [Fact]
    public void Daily_chart_includes_every_day_and_converts_distance()
    {
        var daily = new List<MileageDailyBucket>
        {
            Daily("2026-05-01", 40, 12000),
            Daily("2026-05-02", 55, null),
        };

        var display = Project(SuccessModel(daily: daily), UnitPref.Imperial);

        Assert.True(display.DailyChart.HasData);
        Assert.Equal("Daily Distance", display.DailyChart.Title);
        Assert.Equal("Distance (mi)", display.DailyChart.SeriesName);
        Assert.Equal(0, display.DailyChart.ColorIndex);
        Assert.Equal(2, display.DailyChart.Points.Count);
        Assert.Equal(MileageProjection.FromKm(40, UnitPref.Imperial), display.DailyChart.Points[0].Y, 6);
    }

    [Fact]
    public void Daily_chart_empty_when_no_buckets()
    {
        var display = Project(SuccessModel(daily: Array.Empty<MileageDailyBucket>()));

        Assert.False(display.DailyChart.HasData);
        Assert.Empty(display.DailyChart.Points);
    }

    // ---- Monthly-Summary table (GlassPanel7) --------------------------------------

    [Fact]
    public void Monthly_table_columns_carry_the_unit_in_the_numeric_headers()
    {
        var display = Project(SuccessModel(), UnitPref.Metric);

        Assert.Collection(
            display.TableColumns,
            c => { Assert.Equal("month", c.Key); Assert.Equal("Month", c.Header); Assert.False(c.IsNumeric); },
            c => { Assert.Equal("distance", c.Key); Assert.Equal("Distance (km)", c.Header); Assert.True(c.IsNumeric); },
            c => { Assert.Equal("drives", c.Key); Assert.Equal("Drives", c.Header); Assert.True(c.IsNumeric); },
            c => { Assert.Equal("dailyAvg", c.Key); Assert.Equal("Distance per Drive (km)", c.Header); Assert.True(c.IsNumeric); });
    }

    [Fact]
    public void Monthly_table_rows_compute_per_drive_distance_and_guard_zero_drives()
    {
        var monthly = new List<MileageMonthlyBucket>
        {
            Monthly("2026-05", 1200, 24),
            Monthly("2026-04", 0, 0),
        };

        var display = Project(SuccessModel(monthly: monthly), UnitPref.Metric);

        Assert.Equal(2, display.TableRows.Count);

        Assert.Equal("2026-05", display.TableRows[0].Month);
        Assert.Equal(ScalarFormatters.FormatNumber(1200, 2), display.TableRows[0].Distance);
        Assert.Equal(ScalarFormatters.FormatNumber(24, 0), display.TableRows[0].Drives);
        Assert.Equal(ScalarFormatters.FormatNumber(50, 2), display.TableRows[0].DistancePerDrive);

        // Zero-drive month: per-drive distance falls back to zero rather than dividing by zero.
        Assert.Equal("2026-04", display.TableRows[1].Month);
        Assert.Equal(ScalarFormatters.FormatNumber(0, 2), display.TableRows[1].DistancePerDrive);
    }

    [Fact]
    public void Monthly_table_empty_when_no_buckets()
    {
        var display = Project(SuccessModel(monthly: Array.Empty<MileageMonthlyBucket>()));

        Assert.Empty(display.TableRows);
        Assert.Equal("No Entries", display.TableEmptyMessage);
    }

    // ---- fromKm + formatDate helpers ----------------------------------------------

    [Fact]
    public void FromKm_scales_kilometres_through_the_si_converter()
    {
        Assert.Equal(50, MileageProjection.FromKm(50, UnitPref.Metric), 6);
        Assert.Equal(UnitConverters.DistanceFromSi(50_000, DistanceUnit.Mi), MileageProjection.FromKm(50, UnitPref.Imperial), 6);
    }

    [Fact]
    public void FormatDay_renders_the_web_month_day_year_label()
    {
        Assert.Equal("May 1, 2026", MileageProjection.FormatDay("2026-05-01"));
        Assert.Equal("Dec 31, 2025", MileageProjection.FormatDay("2025-12-31"));
    }

    [Fact]
    public void FormatDay_returns_the_raw_value_for_an_unparseable_date() =>
        Assert.Equal("not-a-date", MileageProjection.FormatDay("not-a-date"));

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Stats_parses_snake_case_fields()
    {
        var stats = MileageStats.FromJson(Json(
            "{\"vehicle_id\":7,\"lifetime_km\":12000.5,\"last_30d_km\":900,\"drive_count_lifetime\":240}"));

        Assert.NotNull(stats);
        Assert.Equal(12000.5, stats!.LifetimeKm);
        Assert.Equal(900, stats.Last30dKm);
        Assert.Equal(240, stats.DriveCountLifetime);
    }

    [Fact]
    public void Stats_is_null_for_a_non_object_body() =>
        Assert.Null(MileageStats.FromJson(Json("null")));

    [Fact]
    public void Daily_bucket_parses_and_tolerates_a_null_odometer()
    {
        var bucket = MileageDailyBucket.FromJson(Json(
            "{\"date\":\"2026-05-01\",\"total_km\":40,\"end_odometer_km\":null,\"drive_count\":3}"));

        Assert.Equal("2026-05-01", bucket.Date);
        Assert.Equal(40, bucket.TotalKm);
        Assert.Null(bucket.EndOdometerKm);
    }

    [Fact]
    public void Monthly_bucket_parses_snake_case_fields()
    {
        var bucket = MileageMonthlyBucket.FromJson(Json(
            "{\"year_month\":\"2026-05\",\"total_km\":1200,\"drive_count\":24}"));

        Assert.Equal("2026-05", bucket.YearMonth);
        Assert.Equal(1200, bucket.TotalKm);
        Assert.Equal(24, bucket.DriveCount);
    }

    [Fact]
    public void ParseDaily_unwraps_the_days_envelope()
    {
        var buckets = MileageClientFeed.ParseDaily(Json(
            "{\"vehicle_id\":7,\"days\":[{\"date\":\"2026-05-01\",\"total_km\":40},{\"date\":\"2026-05-02\",\"total_km\":55}]}"));

        Assert.Equal(2, buckets.Count);
        Assert.Equal("2026-05-01", buckets[0].Date);
        Assert.Equal(55, buckets[1].TotalKm);
    }

    [Fact]
    public void ParseMonthly_unwraps_the_months_envelope()
    {
        var buckets = MileageClientFeed.ParseMonthly(Json(
            "{\"vehicle_id\":7,\"months\":[{\"year_month\":\"2026-05\",\"total_km\":1200,\"drive_count\":24}]}"));

        var bucket = Assert.Single(buckets);
        Assert.Equal("2026-05", bucket.YearMonth);
        Assert.Equal(24, bucket.DriveCount);
    }

    [Fact]
    public void ParseDaily_tolerates_a_missing_or_non_array_envelope()
    {
        Assert.Empty(MileageClientFeed.ParseDaily(Json("{}")));
        Assert.Empty(MileageClientFeed.ParseDaily(Json("{\"days\":null}")));
        Assert.Empty(MileageClientFeed.ParseDaily(Json("[]")));
    }

    [Fact]
    public void ParseMonthly_tolerates_a_missing_or_non_array_envelope()
    {
        Assert.Empty(MileageClientFeed.ParseMonthly(Json("{}")));
        Assert.Empty(MileageClientFeed.ParseMonthly(Json("{\"months\":42}")));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_mileage_into_the_success_state()
    {
        var feed = new FakeMileageFeed(SuccessModel().Snapshot);
        var now = new DateTimeOffset(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);
        using var vm = new MileagePageViewModel(feed, Localizer, UnitPref.Metric, () => now);

        await vm.LoadAsync();

        Assert.Equal(MileageState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new MileagePageViewModel(EmptyMileageFeed.Instance, Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(MileageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new MileagePageViewModel(new ThrowingMileageFeed(), Localizer, UnitPref.Metric);

        await vm.LoadAsync();

        Assert.Equal(MileageState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeMileageFeed(SuccessModel().Snapshot);
        using var vm = new MileagePageViewModel(feed, Localizer, UnitPref.Metric);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useMileageStats + useDailyMileage + useMonthlyMileage) -----------------

    [Fact]
    public async Task ClientFeed_sends_three_operations_with_the_vehicle_id_and_days_window()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"lifetime_km\":12000,\"last_30d_km\":900,\"drive_count_lifetime\":240}"));
        api.ReturnsValue(Json("{\"days\":[{\"date\":\"2026-05-01\",\"total_km\":40,\"end_odometer_km\":12000}]}"));
        api.ReturnsValue(Json("{\"months\":[{\"year_month\":\"2026-05\",\"total_km\":1200,\"drive_count\":24}]}"));
        var feed = new MileageClientFeed(api, vehicleId: 7, days: 90);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(12000, snapshot.Stats.LifetimeKm);
        Assert.Single(snapshot.Daily);
        Assert.Single(snapshot.Monthly);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal("get_api_v1_mileage_stats", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_mileage_daily", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
        Assert.Equal("90", api.Requests[1].Query!["days"]?.ToString());
        Assert.Equal("get_api_v1_mileage_monthly", api.Requests[2].OperationId);
        Assert.Equal("7", api.Requests[2].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_stats_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new MileageClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_supplementary_reads_fail()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"lifetime_km\":4200}"));
        api.Throws(new ApiException("daily subsystem down", 503));
        api.Throws(new ApiException("monthly subsystem down", 503));
        var feed = new MileageClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(4200, snapshot.Stats.LifetimeKm);
        Assert.Empty(snapshot.Daily);
        Assert.Empty(snapshot.Monthly);
    }

    [Fact]
    public void ClientFeed_clamps_a_non_positive_days_window_to_the_default()
    {
        // The web hook defaults the window to 90; a zero/negative window must never reach the wire.
        Assert.Equal(90, MileageClientFeed.DefaultDays);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new MileageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MileagePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("Mileage", MileageRegistration.RouteName);
        Assert.Equal("get_api_v1_mileage_stats", MileageRegistration.StatsOperation);
        Assert.Equal("get_api_v1_mileage_daily", MileageRegistration.DailyOperation);
        Assert.Equal("get_api_v1_mileage_monthly", MileageRegistration.MonthlyOperation);
        Assert.Equal("Mileage", MileageRegistration.Title(Localizer));
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

    private sealed class FakeMileageFeed(MileageSnapshot snapshot) : IMileageFeed
    {
        public int FetchCount { get; private set; }

        public Task<MileageSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingMileageFeed : IMileageFeed
    {
        public Task<MileageSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
