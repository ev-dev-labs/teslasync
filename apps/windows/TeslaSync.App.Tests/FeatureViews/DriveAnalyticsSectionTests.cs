using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Drive-Analytics section's UI-thread-free logic — the drive-list JSON parse
/// adapter (start_ts / distance_m / avg_speed_mps / avg_power_w), the date filter, the three projections
/// (speed-bucket histogram with the web double-convert bucketing quirk, peak-power-vs-distance scatter with
/// the mean reference line, last-20-drives peak / regen dual-area), the SI→display conversions, the
/// cache-then-network result mapper, the vehicle-resolving drive-list source, the registry metadata, the
/// PII-safe diagnostics, the Narrator automation names and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline + range and unit re-projection). Mirrors
/// the web spec (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx +
/// DrivingDynamicsPage.tsx).
/// </summary>
public sealed class DriveAnalyticsSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateRange WideRange = new(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

    private const string ThreeDriveTrace =
        """
        [
          {"start_ts":"2026-04-01T10:00:00Z","distance_m":12000,"avg_speed_mps":25,"avg_power_w":40000},
          {"start_ts":"2026-04-02T10:00:00Z","distance_m":30000,"avg_speed_mps":35,"avg_power_w":-10000},
          {"start_ts":"2026-04-03T10:00:00Z","distance_m":5000,"avg_speed_mps":10,"avg_power_w":20000}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_field()
    {
        using var doc = JsonDocument.Parse(
            """{"start_ts":"2026-04-04T10:00:00Z","distance_m":12345,"avg_speed_mps":12.5,"avg_power_w":48000}""");

        var s = DriveAnalyticsSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.StartTs);
        Assert.Equal(12345, s.DistanceM);
        Assert.Equal(12.5, s.AvgSpeedMps);
        Assert.Equal(48000, s.AvgPowerW);
        Assert.Equal(new DateOnly(2026, 4, 4), s.StartDate);
    }

    [Fact]
    public void FromJson_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"start_ts":"2026-04-04T11:00:00Z"}""");

        var s = DriveAnalyticsSample.FromJson(doc.RootElement);

        Assert.Null(s.DistanceM);
        Assert.Null(s.AvgSpeedMps);
        Assert.Null(s.AvgPowerW);
        Assert.Equal(new DateOnly(2026, 4, 4), s.StartDate);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"avg_speed_mps":1}, 7, {"avg_speed_mps":2}]""");

        var list = DriveAnalyticsSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].AvgSpeedMps);
        Assert.Equal(2, list[1].AvgSpeedMps);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"avg_speed_mps":1}""");
        Assert.Empty(DriveAnalyticsSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(ThreeDriveTrace);

        Assert.True(display.HasData);
        Assert.Equal(3, display.DriveCount);
        Assert.Equal("Drive Analytics", display.Title);
        Assert.Equal("Speed Distribution", display.SpeedDistributionChrome.Title);
        Assert.Equal("Drives grouped by average speed", display.SpeedDistributionChrome.Subtitle);
        Assert.Equal("Speed-bucket drive count distribution bar chart", display.SpeedDistributionChrome.AriaLabel);
        Assert.Equal("Acceleration Patterns", display.AccelerationChrome.Title);
        Assert.Equal("Peak power vs trip distance", display.AccelerationChrome.Subtitle);
        Assert.Equal("Per-drive scatter chart of peak power versus trip distance", display.AccelerationChrome.AriaLabel);
        Assert.Equal("Power Profile", display.PowerProfileChrome.Title);
        Assert.Equal("Peak & regen power for recent drives", display.PowerProfileChrome.Subtitle);
        Assert.Equal("Recent-drives peak and regen power dual-area chart", display.PowerProfileChrome.AriaLabel);
    }

    // ---- Projection: speed distribution (web double-convert bucketing) -------------

    [Fact]
    public void Project_speed_distribution_buckets_drives_by_display_speed()
    {
        var model = ProjectMetric(ThreeDriveTrace).SpeedDistribution;

        // 25 m/s → 90 km/h (bucket 0 [0,108)), 35 m/s → 126 km/h (bucket 1 [108,216)), 10 m/s → 36 km/h (bucket 0).
        Assert.True(model.HasData);
        Assert.Equal(5, model.Buckets.Count);
        Assert.Equal(new[] { 2, 1, 0, 0, 0 }, model.Buckets.Select(b => b.Count).ToArray());
        Assert.Equal(2, model.MaxCount);
        Assert.Equal("Drives", model.SeriesName);
        Assert.Equal("0\u201330 km/h", model.Buckets[0].Range);
        Assert.Equal("120+ km/h", model.Buckets[4].Range);
    }

    [Fact]
    public void Project_speed_distribution_uses_speed_unit_label()
    {
        var imperial = Project(ThreeDriveTrace, UnitPref.Imperial).SpeedDistribution;
        Assert.Equal("0\u201330 mph", imperial.Buckets[0].Range);
        Assert.Equal("120+ mph", imperial.Buckets[4].Range);
    }

    [Fact]
    public void Project_speed_distribution_skips_drives_without_speed()
    {
        var model = ProjectMetric(
            """[{"start_ts":"2026-04-01T10:00:00Z","avg_power_w":1000}]""").SpeedDistribution;

        Assert.False(model.HasData);
        Assert.All(model.Buckets, b => Assert.Equal(0, b.Count));
    }

    // ---- Projection: acceleration scatter + mean reference line --------------------

    [Fact]
    public void Project_acceleration_maps_distance_and_power_with_mean_line()
    {
        var model = ProjectMetric(ThreeDriveTrace).Acceleration;

        Assert.True(model.HasData);
        Assert.Equal(3, model.Points.Count);
        Assert.Equal("km", model.DistanceUnit);

        // distance: round(m/1000), power: w/1000 kW.
        Assert.Equal(12, model.Points[0].DistanceDisplay, 6);
        Assert.Equal(40, model.Points[0].PowerKw, 6);
        Assert.Equal(30, model.Points[1].DistanceDisplay, 6);
        Assert.Equal(-10, model.Points[1].PowerKw, 6);

        // mean(40, -10, 20) = 16.666...
        Assert.Equal(50.0 / 3.0, model.AveragePowerKw!.Value, 6);
    }

    [Fact]
    public void Project_acceleration_excludes_drives_without_power()
    {
        var model = ProjectMetric(
            """[{"start_ts":"2026-04-01T10:00:00Z","distance_m":1000,"avg_speed_mps":10}]""").Acceleration;

        Assert.False(model.HasData);
        Assert.Empty(model.Points);
        Assert.Null(model.AveragePowerKw);
    }

    [Fact]
    public void Project_acceleration_uses_imperial_distance_unit()
    {
        var model = Project(ThreeDriveTrace, UnitPref.Imperial).Acceleration;
        Assert.Equal("mi", model.DistanceUnit);
    }

    // ---- Projection: power profile (last 20, peak + regen) -------------------------

    [Fact]
    public void Project_power_profile_maps_recent_drives()
    {
        var model = ProjectMetric(ThreeDriveTrace).PowerProfile;

        Assert.True(model.HasData);
        Assert.Equal(3, model.Points.Count);
        Assert.Equal("Max Power (kW)", model.MaxSeriesName);
        Assert.Equal("Regen Power (kW)", model.RegenSeriesName);

        Assert.Equal(1, model.Points[0].Index);
        Assert.Equal("Apr 1", model.Points[0].Label);
        Assert.Equal(40, model.Points[0].PowerMaxKw, 6);
        Assert.Equal(0, model.Points[0].PowerMinKw, 6);
        Assert.Equal(-10, model.Points[1].PowerMaxKw, 6);
    }

    [Fact]
    public void Project_power_profile_keeps_only_the_last_twenty_drives()
    {
        var many = Enumerable.Range(0, 25)
            .Select(i => new DriveAnalyticsSample(
                new DateTimeOffset(2026, 4, 1, 0, 0, 0, TimeSpan.Zero).AddDays(i), 1000, 10, 1000))
            .ToList();

        var model = DriveAnalyticsSectionProjection.Project(many, WideRange, UnitPref.Metric, Localizer).PowerProfile;

        Assert.Equal(DriveAnalyticsSectionProjection.PowerProfileWindow, model.Points.Count);
        Assert.Equal(1, model.Points[0].Index);
        Assert.Equal(20, model.Points[^1].Index);
    }

    [Fact]
    public void Project_power_profile_defaults_missing_power_to_zero()
    {
        var model = ProjectMetric(
            """[{"start_ts":"2026-04-01T10:00:00Z","avg_speed_mps":10}]""").PowerProfile;

        Assert.True(model.HasData);
        Assert.Equal(0, model.Points[0].PowerMaxKw, 6);
    }

    // ---- Projection: date filter ---------------------------------------------------

    [Fact]
    public void Project_filters_drives_to_the_selected_range()
    {
        var range = new DateRange(new DateOnly(2026, 4, 2), new DateOnly(2026, 4, 2));
        var display = DriveAnalyticsSectionProjection.Project(ParseDrives(ThreeDriveTrace), range, UnitPref.Metric, Localizer);

        // Only the 2026-04-02 drive (35 m/s → bucket 1) survives.
        Assert.Equal(1, display.DriveCount);
        Assert.Equal(new[] { 0, 1, 0, 0, 0 }, display.SpeedDistribution.Buckets.Select(b => b.Count).ToArray());
        Assert.Single(display.Acceleration.Points);
        Assert.Single(display.PowerProfile.Points);
    }

    [Fact]
    public void Project_excludes_undated_drives()
    {
        var display = ProjectMetric("""[{"distance_m":1000,"avg_speed_mps":10,"avg_power_w":1000}]""");
        Assert.Equal(0, display.DriveCount);
        Assert.False(display.HasData);
    }

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = DriveAnalyticsSectionProjection.Empty(WideRange, UnitPref.Metric, Localizer);

        Assert.False(display.HasData);
        Assert.Equal(0, display.DriveCount);
        Assert.False(display.SpeedDistribution.HasData);
        Assert.False(display.Acceleration.HasData);
        Assert.False(display.PowerProfile.HasData);
        Assert.Equal(5, display.SpeedDistribution.Buckets.Count);
    }

    // ---- Projection → chart series -------------------------------------------------

    [Fact]
    public void SpeedDistribution_to_chart_series_indexes_buckets()
    {
        var series = Assert.Single(ProjectMetric(ThreeDriveTrace).SpeedDistribution.ToChartSeries());
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal(5, series.Points.Count);
        Assert.Equal(0d, series.Points[0].X, 6);
        Assert.Equal(2d, series.Points[0].Y, 6);
        Assert.Equal("0\u201330 km/h", series.Points[0].Label);
    }

    [Fact]
    public void PowerProfile_to_chart_series_emits_peak_and_regen()
    {
        var series = ProjectMetric(ThreeDriveTrace).PowerProfile.ToChartSeries();
        Assert.Equal(2, series.Count);
        Assert.Equal("Max Power (kW)", series[0].Name);
        Assert.Equal("Regen Power (kW)", series[1].Name);
        Assert.All(series[1].Points, p => Assert.Equal(0d, p.Y, 6));
    }

    [Fact]
    public void Acceleration_annotations_carry_the_average_line()
    {
        var model = ProjectMetric(ThreeDriveTrace).Acceleration;
        var annotation = Assert.Single(model.ToAnnotations("Avg"));
        Assert.Equal("Avg", annotation.Label);
        Assert.Equal(50.0 / 3.0, annotation.Value, 6);
    }

    [Fact]
    public void PowerProfile_annotations_carry_the_zero_baseline()
    {
        var annotation = Assert.Single(ProjectMetric(ThreeDriveTrace).PowerProfile.ToAnnotations());
        Assert.Equal(0d, annotation.Value, 6);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_emits_narrator_names_for_every_datum()
    {
        var display = ProjectMetric(ThreeDriveTrace);

        Assert.All(display.SpeedDistribution.Buckets, b => Assert.False(string.IsNullOrWhiteSpace(b.AutomationName)));
        Assert.Contains("Drives", display.SpeedDistribution.Buckets[0].AutomationName);

        Assert.All(display.Acceleration.Points, p =>
        {
            Assert.False(string.IsNullOrWhiteSpace(p.AutomationName));
            Assert.Contains("kW", p.AutomationName);
        });

        Assert.All(display.PowerProfile.Points, p =>
        {
            Assert.False(string.IsNullOrWhiteSpace(p.AutomationName));
            Assert.Contains("Apr", p.AutomationName);
        });
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(ThreeDriveTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = DriveAnalyticsSectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(3, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, DriveAnalyticsSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, DriveAnalyticsSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = DriveAnalyticsSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new DriveAnalyticsSectionViewModel(new FakeSource(), Localizer, UnitPref.Metric, WideRange);
        Assert.Equal(DriveAnalyticsSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_content()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(DriveAnalyticsSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.DriveCount);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(DriveAnalyticsSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_range_excluding_all_drives_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(DriveAnalyticsSectionState.Loaded, vm.State);

        vm.Range = new DateRange(new DateOnly(2020, 1, 1), new DateOnly(2020, 1, 2));

        Assert.Equal(DriveAnalyticsSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(0, vm.DriveCount);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(DriveAnalyticsSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(DriveAnalyticsSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(DriveAnalyticsSectionState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loading(),
            RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(DriveAnalyticsSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(DriveAnalyticsSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal("0\u201330 km/h", vm.Display.SpeedDistribution.Buckets[0].Range);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("0\u201330 mph", vm.Display.SpeedDistribution.Buckets[0].Range);
        Assert.Equal("mi", vm.Display.Acceleration.DistanceUnit);
    }

    [Fact]
    public async Task ViewModel_changing_range_reprojects_drive_count()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(3, vm.DriveCount);

        vm.Range = new DateRange(new DateOnly(2026, 4, 2), new DateOnly(2026, 4, 3));

        Assert.Equal(2, vm.DriveCount);
        Assert.Equal(DriveAnalyticsSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveAnalyticsSectionViewModel.State), changed);
        Assert.Contains(nameof(DriveAnalyticsSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive Analytics", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_reads_drive_list()
    {
        using var drives = JsonDocument.Parse(ThreeDriveTrace);
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new DriveAnalyticsSectionSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);
        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Drives.List, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_skips_primary_resolution()
    {
        using var drives = JsonDocument.Parse(ThreeDriveTrace);
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new DriveAnalyticsSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 9);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(9L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new DriveAnalyticsSectionSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_empty_drive_list_yields_empty()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new DriveAnalyticsSectionSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("drive-analytics-section", DriveAnalyticsSectionRegistration.Id);
        Assert.Equal("DriveAnalyticsSection", DriveAnalyticsSectionRegistration.Slug);
        Assert.Equal("Drive Analytics", DriveAnalyticsSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveAnalyticsSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveAnalyticsSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DriveAnalyticsSectionDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static DriveAnalyticsSectionDisplay Project(string json, UnitPref units) =>
        DriveAnalyticsSectionProjection.Project(ParseDrives(json), WideRange, units, Localizer);

    private static IReadOnlyList<DriveAnalyticsSample> ParseDrives(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return DriveAnalyticsSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<DriveAnalyticsSample> Trace() => ParseDrives(ThreeDriveTrace);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static DriveAnalyticsSectionViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric, WideRange);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>[] emissions)
        : IDriveAnalyticsSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveAnalyticsSample>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
