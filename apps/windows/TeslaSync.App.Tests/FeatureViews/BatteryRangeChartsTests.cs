using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Battery-Range surface's UI-thread-free logic — the vehicle-state + drives
/// snapshot parse adapter (battery_level / rated_range / start_ts / distance_m / duration_s), the SI→display
/// conversion and the web derivations (the Current/Remaining bar data, the <c>batteryColor</c> threshold, the
/// reversed/rounded drive trend, the <c>driveChartData.length &gt; 0</c> empty gate), the combined
/// cache-then-network data source (primary-vehicle resolution, explicit-vehicle scoping, the
/// disabled-when-no-vehicle short-circuit, the best-effort drive-list read), the registry metadata, the
/// PII-safe diagnostics, the Narrator automation names and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline + unit re-projection). Mirrors the web
/// spec (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx).
/// </summary>
public sealed class BatteryRangeChartsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string StateResponse =
        """{"state":{"vehicle_id":7,"battery_level":72,"rated_range":400000},"live":true}""";

    private const string DrivesResponse =
        """
        [
          {"start_ts":"2026-04-04T10:00:00Z","distance_m":12000,"duration_s":1800},
          {"start_ts":"2026-04-03T09:00:00Z","distance_m":8000,"duration_s":1200}
        ]
        """;

    // ---- Parse adapter: drive samples ----------------------------------------------

    [Fact]
    public void DriveSample_reads_si_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"start_ts":"2026-04-04T10:00:00Z","distance_m":12345,"duration_s":1800}""");

        var s = DriveDistanceSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.StartTs);
        Assert.Equal(12345, s.DistanceMeters);
        Assert.Equal(1800, s.DurationSeconds);
    }

    [Fact]
    public void DriveSample_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"distance_m":5000}""");

        var s = DriveDistanceSample.FromJson(doc.RootElement);

        Assert.Null(s.StartTs);
        Assert.Equal(5000, s.DistanceMeters);
        Assert.Null(s.DurationSeconds);
    }

    [Fact]
    public void DriveSample_ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"distance_m":1}, 7, {"distance_m":2}]""");

        var list = DriveDistanceSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].DistanceMeters);
        Assert.Equal(2, list[1].DistanceMeters);
    }

    [Fact]
    public void DriveSample_ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"distance_m":1}""");
        Assert.Empty(DriveDistanceSample.ParseList(doc.RootElement));
    }

    // ---- Parse adapter: combined snapshot ------------------------------------------

    [Fact]
    public void FromParts_reads_state_envelope_and_drives()
    {
        var data = FromParts(StateResponse, DrivesResponse);

        Assert.True(data.HasState);
        Assert.True(data.HasData);
        Assert.Equal(72, data.BatteryLevelPct);
        Assert.Equal(400000, data.RatedRangeMeters);
        Assert.Equal(2, data.Drives.Count);
    }

    [Fact]
    public void FromParts_accepts_a_bare_state_object()
    {
        var data = FromParts("""{"battery_level":55,"rated_range":300000}""", "[]");

        Assert.True(data.HasState);
        Assert.Equal(55, data.BatteryLevelPct);
        Assert.Equal(300000, data.RatedRangeMeters);
        Assert.Empty(data.Drives);
    }

    [Fact]
    public void FromParts_without_battery_level_is_empty()
    {
        // Web parity: stateData?.state undefined (asleep) → the surface has nothing to plot.
        Assert.False(FromParts("""{"state":{}}""", "[]").HasState);
        Assert.False(FromParts("""{"live":false}""", "[]").HasState);
        Assert.False(FromParts("null", "[]").HasState);
    }

    [Fact]
    public void FromParts_keeps_drives_even_when_state_is_absent()
    {
        var data = FromParts("""{"live":false}""", DrivesResponse);

        Assert.False(data.HasState);
        Assert.Equal(2, data.Drives.Count);
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = Project(StateResponse, DrivesResponse, UnitPref.Metric);

        Assert.Equal("Battery Overview", display.BatteryOverviewTitle);
        Assert.Equal("Drive Distance Trend", display.DriveTrendTitle);
        Assert.Equal("Battery", display.GaugeLabel);
        Assert.Equal("Battery", display.BatteryStatLabel);
        Assert.Equal("Range", display.RangeStatLabel);
        Assert.Equal("No drive data for chart", display.NoDriveDataMessage);
        Assert.Equal("%", display.GaugeUnit);
    }

    [Fact]
    public void Project_battery_bars_are_current_and_remaining()
    {
        var bars = Project(StateResponse, DrivesResponse, UnitPref.Metric).BatteryBars;

        Assert.Equal(2, bars.Count);
        Assert.Equal("Current", bars[0].Label);
        Assert.Equal(72, bars[0].Value);
        Assert.Equal("Remaining", bars[1].Label);
        Assert.Equal(28, bars[1].Value); // 100 - 72
    }

    [Fact]
    public void Project_gauge_value_and_max_track_battery_level()
    {
        var display = Project(StateResponse, DrivesResponse, UnitPref.Metric);

        Assert.Equal(72, display.GaugeValue);
        Assert.Equal(100, display.GaugeMax);
        Assert.Equal(72, display.BatteryStatValue);
    }

    [Theory]
    [InlineData(72, StatusKind.Success)]   // > 60
    [InlineData(61, StatusKind.Success)]
    [InlineData(60, StatusKind.Warning)]   // not > 60, > 25
    [InlineData(26, StatusKind.Warning)]
    [InlineData(25, StatusKind.Danger)]    // not > 25
    [InlineData(5, StatusKind.Danger)]
    public void BatteryTier_mirrors_web_batteryColor_thresholds(double level, StatusKind expected)
    {
        Assert.Equal(expected, BatteryRangeChartsProjection.BatteryTier(level));
    }

    [Fact]
    public void Project_tier_reflects_the_level()
    {
        Assert.Equal(StatusKind.Success, Project(StateResponse, "[]", UnitPref.Metric).BatteryTier);
        Assert.Equal(
            StatusKind.Danger,
            Project("""{"battery_level":10,"rated_range":50000}""", "[]", UnitPref.Metric).BatteryTier);
    }

    // ---- Projection: SI→display range ----------------------------------------------

    [Fact]
    public void Project_range_converts_from_si_metres_per_units()
    {
        var metric = Project(StateResponse, "[]", UnitPref.Metric);
        Assert.Equal("km", metric.DistanceUnitLabel);
        Assert.Equal(400, metric.RangeDisplay, 3); // 400000 m → 400 km

        var imperial = Project(StateResponse, "[]", UnitPref.Imperial);
        Assert.Equal("mi", imperial.DistanceUnitLabel);
        Assert.Equal(248.548, imperial.RangeDisplay, 2); // 400000 / 1609.344
    }

    [Fact]
    public void Project_series_names_carry_the_active_distance_unit()
    {
        var metric = Project(StateResponse, DrivesResponse, UnitPref.Metric);
        Assert.Equal("Distance (km)", metric.DistanceSeriesName);
        Assert.Equal("Duration", metric.DurationSeriesName);

        var imperial = Project(StateResponse, DrivesResponse, UnitPref.Imperial);
        Assert.Equal("Distance (mi)", imperial.DistanceSeriesName);
    }

    // ---- Projection: drive trend (reverse + round + minutes) -----------------------

    [Fact]
    public void Project_drive_points_are_reversed_rounded_and_in_minutes()
    {
        var points = Project(StateResponse, DrivesResponse, UnitPref.Metric).DrivePoints;

        Assert.Equal(2, points.Count);
        // Web .reverse(): newest-first server rows become oldest→newest.
        Assert.Equal(8, points[0].DistanceDisplay);   // 8000 m → 8 km
        Assert.Equal(20, points[0].DurationMinutes);   // 1200 s → 20 min
        Assert.Equal(12, points[1].DistanceDisplay);   // 12000 m → 12 km
        Assert.Equal(30, points[1].DurationMinutes);   // 1800 s → 30 min
    }

    [Fact]
    public void Project_drive_distance_converts_to_imperial()
    {
        var points = Project(
            StateResponse,
            """[{"start_ts":"2026-04-04T10:00:00Z","distance_m":16093.44,"duration_s":3600}]""",
            UnitPref.Imperial).DrivePoints;

        Assert.Single(points);
        Assert.Equal(10, points[0].DistanceDisplay);   // 16093.44 m → 10 mi
        Assert.Equal(60, points[0].DurationMinutes);   // 3600 s → 60 min
    }

    [Fact]
    public void Project_drive_date_label_is_present_for_a_dated_drive()
    {
        var points = Project(StateResponse, DrivesResponse, UnitPref.Metric).DrivePoints;

        // Web formatDate → "MMM d, yyyy"; assert a year is present (timezone-robust).
        Assert.Matches(@"\d{4}", points[0].DateLabel);
        Assert.Matches(@"\d{4}", points[1].DateLabel);
    }

    [Fact]
    public void Project_empty_drives_reports_no_drive_data()
    {
        var display = Project(StateResponse, "[]", UnitPref.Metric);

        Assert.False(display.HasDriveData);
        Assert.Empty(display.DrivePoints);
        Assert.Equal("No drive data for chart", display.NoDriveDataMessage);
    }

    [Fact]
    public void Project_with_drives_reports_has_drive_data()
    {
        Assert.True(Project(StateResponse, DrivesResponse, UnitPref.Metric).HasDriveData);
    }

    // ---- Projection: accessibility names -------------------------------------------

    [Fact]
    public void Project_battery_automation_name_describes_the_panel()
    {
        var name = Project(StateResponse, DrivesResponse, UnitPref.Metric).BatteryChartAutomationName;

        Assert.Contains("Battery Overview", name, StringComparison.Ordinal);
        Assert.Contains("Current", name, StringComparison.Ordinal);
        Assert.Contains("Remaining", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_drive_automation_name_describes_the_chart()
    {
        var with = Project(StateResponse, DrivesResponse, UnitPref.Metric).DriveChartAutomationName;
        Assert.Contains("Drive Distance Trend", with, StringComparison.Ordinal);
        Assert.Contains("Distance", with, StringComparison.Ordinal);

        var without = Project(StateResponse, "[]", UnitPref.Metric).DriveChartAutomationName;
        Assert.Contains("No drive data for chart", without, StringComparison.Ordinal);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new BatteryRangeChartsViewModel(new FakeSource(), Localizer);
        Assert.Equal(BatteryRangeChartsState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_both_panels()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Loaded(Snapshot(), Now));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(72, vm.Display.GaugeValue);
        Assert.True(vm.Display.HasDriveData);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_drives_still_loaded()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Loaded(SnapshotNoDrives(), Now));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.False(vm.Display.HasDriveData);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Cached(Snapshot(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.OfflineCached(
            Snapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryRangeChartsData>.Loading(),
            RepositoryResult<BatteryRangeChartsData>.Cached(Snapshot(), Now, stale: false),
            RepositoryResult<BatteryRangeChartsData>.Loaded(Snapshot(), Now));

        await vm.LoadAsync();

        Assert.Equal(BatteryRangeChartsState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Loaded(Snapshot(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(BatteryRangeChartsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Loaded(Snapshot(), Now));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.DistanceUnitLabel);
        Assert.Equal(400, vm.Display.RangeDisplay, 3);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mi", vm.Display.DistanceUnitLabel);
        Assert.Equal(248.548, vm.Display.RangeDisplay, 2);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Loaded(Snapshot(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryRangeChartsViewModel.State), changed);
        Assert.Contains(nameof(BatteryRangeChartsViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeChartsData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Overview", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorTitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_reads_state_and_drives()
    {
        using var state = JsonDocument.Parse(StateResponse);
        using var drives = JsonDocument.Parse(DrivesResponse);

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement.Clone())
            .ReturnsValue(drives.RootElement.Clone());
        var source = new BatteryRangeChartsSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasState);
        Assert.Equal(72, emissions[^1].Value!.BatteryLevelPct);
        Assert.Equal(2, emissions[^1].Value!.Drives.Count);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(Operations.Vehicles.State, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal(Operations.Drives.List, api.Requests[1].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_both_reads()
    {
        using var state = JsonDocument.Parse(StateResponse);
        using var drives = JsonDocument.Parse("[]");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement.Clone())
            .ReturnsValue(drives.RootElement.Clone());
        var source = new BatteryRangeChartsSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 9);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal("9", api.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal(9L, Convert.ToInt64(api.Requests[1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new BatteryRangeChartsSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_still_loads_the_battery_state()
    {
        using var state = JsonDocument.Parse(StateResponse);
        using var drives = JsonDocument.Parse("[]");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement.Clone())
            .ReturnsValue(drives.RootElement.Clone());
        var source = new BatteryRangeChartsSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasState);
        Assert.Empty(emissions[^1].Value!.Drives);
    }

    [Fact]
    public async Task Source_tolerates_a_drive_list_failure_and_still_loads_state()
    {
        using var state = JsonDocument.Parse(StateResponse);

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement.Clone())
            .Throws(new InvalidOperationException("drive list down"));
        var source = new BatteryRangeChartsSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasState);
        Assert.Empty(emissions[^1].Value!.Drives);
    }

    [Fact]
    public async Task Source_without_usable_state_yields_empty()
    {
        using var state = JsonDocument.Parse("""{"live":false}""");
        using var drives = JsonDocument.Parse("[]");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement.Clone())
            .ReturnsValue(drives.RootElement.Clone());
        var source = new BatteryRangeChartsSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 2 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("battery-range-charts", BatteryRangeChartsRegistration.Id);
        Assert.Equal("BatteryRangeCharts", BatteryRangeChartsRegistration.Slug);
        Assert.Equal("Battery Overview", BatteryRangeChartsRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryRangeChartsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryRangeCharts", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static BatteryRangeChartsData FromParts(string stateJson, string drivesJson)
    {
        using var state = JsonDocument.Parse(stateJson);
        using var drives = JsonDocument.Parse(drivesJson);
        return BatteryRangeChartsData.FromParts(state.RootElement, drives.RootElement);
    }

    private static BatteryRangeChartsDisplay Project(string stateJson, string drivesJson, UnitPref units) =>
        BatteryRangeChartsProjection.Project(FromParts(stateJson, drivesJson), units, Localizer);

    private static BatteryRangeChartsData Snapshot() => FromParts(StateResponse, DrivesResponse);

    private static BatteryRangeChartsData SnapshotNoDrives() => FromParts(StateResponse, "[]");

    private static BatteryRangeChartsViewModel NewViewModel(
        params RepositoryResult<BatteryRangeChartsData>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<BatteryRangeChartsData>>> Collect(
        IAsyncEnumerable<RepositoryResult<BatteryRangeChartsData>> stream)
    {
        var list = new List<RepositoryResult<BatteryRangeChartsData>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<BatteryRangeChartsData>[] emissions)
        : IBatteryRangeChartsSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryRangeChartsData>> StreamAsync(
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
