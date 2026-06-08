using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DriveEfficiencyChartWidget's UI-thread-free logic — the JSON parse adapter,
/// the <c>estimateEfficiency</c> port, the daily-grouping / rolling-average / unit-conversion projection and
/// the Avg / Best day / Trend stats across the compact / standard footprints and metric / imperial units,
/// the cache-then-network result mapper, the per-vehicle data source (primary resolution + query-scoped
/// request), the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline) including the web <c>isEmpty</c> gate.
/// Mirrors the web spec (web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx +
/// api/hooks/useVehicles.ts).
/// </summary>
public sealed class DriveEfficiencyChartWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Fixed reference instant; the 30-day window is therefore [2026-05-07 12:05Z, 2026-06-06 12:05Z].
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    private static DriveEfficiencyDrive Drive(
        string startTs, double distanceM, double? energyWh = null, double? startSoc = null, double? endSoc = null)
    {
        DateTimeOffset? instant = DateTimeOffset.TryParse(
            startTs,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
        return new DriveEfficiencyDrive(distanceM, energyWh, startSoc, endSoc, startTs, instant);
    }

    // Two drives on 2026-05-20 (avg 160), then 180, 200, 160 → four day-buckets, all inside the window.
    private static IReadOnlyList<DriveEfficiencyDrive> SampleDrives() => new[]
    {
        Drive("2026-05-20T08:00:00Z", 10000, 1500),
        Drive("2026-05-20T18:00:00Z", 10000, 1700),
        Drive("2026-05-21T08:00:00Z", 10000, 1800),
        Drive("2026-05-22T08:00:00Z", 10000, 2000),
        Drive("2026-05-23T08:00:00Z", 10000, 1600),
    };

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"distance_m":12345.6,"energy_used_wh":1850.0,"start_soc_pct":82.0,"end_soc_pct":63.0,
         "start_ts":"2026-05-20T08:30:00Z"}
        """;
        using var doc = JsonDocument.Parse(json);

        var drive = DriveEfficiencyDrive.FromJson(doc.RootElement);

        Assert.Equal(12345.6, drive.DistanceM);
        Assert.Equal(1850.0, drive.EnergyUsedWh);
        Assert.Equal(82.0, drive.StartSocPct);
        Assert.Equal(63.0, drive.EndSocPct);
        Assert.Equal("2026-05-20T08:30:00Z", drive.StartTimestamp);
        Assert.Equal(new DateTimeOffset(2026, 5, 20, 8, 30, 0, TimeSpan.Zero), drive.StartInstant);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"distance_m":5000}""");

        var drive = DriveEfficiencyDrive.FromJson(doc.RootElement);

        Assert.Equal(5000, drive.DistanceM);
        Assert.Null(drive.EnergyUsedWh);
        Assert.Null(drive.StartSocPct);
        Assert.Null(drive.EndSocPct);
        Assert.Null(drive.StartTimestamp);
        Assert.Null(drive.StartInstant);
    }

    [Fact]
    public void FromJson_defaults_distance_to_zero_when_absent()
    {
        using var doc = JsonDocument.Parse("""{"start_ts":"2026-05-20T08:00:00Z"}""");
        var drive = DriveEfficiencyDrive.FromJson(doc.RootElement);
        Assert.Equal(0, drive.DistanceM);
    }

    [Fact]
    public void ParseList_skips_non_objects_and_non_arrays()
    {
        using var arr = JsonDocument.Parse("""[{"distance_m":10000},7,"x",{"distance_m":20000}]""");
        Assert.Equal(2, DriveEfficiencyDrive.ParseList(arr.RootElement).Count);

        using var obj = JsonDocument.Parse("{}");
        Assert.Empty(DriveEfficiencyDrive.ParseList(obj.RootElement));
    }

    // ---- estimateEfficiency port ---------------------------------------------------

    [Fact]
    public void Estimate_uses_measured_energy_over_distance()
    {
        // 1500 Wh / 10 km = 150 Wh/km.
        Assert.Equal(150, DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(Drive("t", 10000, energyWh: 1500)));
    }

    [Fact]
    public void Estimate_skips_tiny_drives()
    {
        // 0.5 km < 0.8 km threshold.
        Assert.Null(DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(Drive("t", 500, energyWh: 100)));
    }

    [Theory]
    [InlineData(200.0)]    // 200/10 = 20 Wh/km < 30 → rejected
    [InlineData(6000.0)]   // 6000/10 = 600 Wh/km > 500 → rejected
    public void Estimate_rejects_implausible_samples(double energyWh)
    {
        Assert.Null(DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(Drive("t", 10000, energyWh: energyWh)));
    }

    [Fact]
    public void Estimate_falls_back_to_soc_delta_when_energy_absent()
    {
        // (10 % * 0.75 * 1000) / 50 km = 150 Wh/km.
        Assert.Equal(150, DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(
            Drive("t", 50000, energyWh: null, startSoc: 80, endSoc: 70)));
    }

    [Fact]
    public void Estimate_falls_back_when_energy_not_positive()
    {
        Assert.Equal(150, DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(
            Drive("t", 50000, energyWh: 0, startSoc: 80, endSoc: 70)));
    }

    [Fact]
    public void Estimate_returns_null_when_soc_delta_not_positive()
    {
        Assert.Null(DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(
            Drive("t", 50000, energyWh: null, startSoc: 70, endSoc: 80)));
    }

    [Fact]
    public void Estimate_returns_null_when_soc_missing()
    {
        Assert.Null(DriveEfficiencyChartProjection.EstimateEfficiencyWhPerKm(
            Drive("t", 50000, energyWh: null, startSoc: 80, endSoc: null)));
    }

    // ---- Projection: daily points + stats (metric) ---------------------------------

    [Fact]
    public void Project_builds_daily_points_rolling_and_stats_metric()
    {
        var view = DriveEfficiencyChartProjection.Project(
            SampleDrives(), new DriveEfficiencyChartSize(2, 4), UnitPref.Metric, Localizer, Now);

        Assert.False(view.IsEmpty);
        Assert.Equal(4, view.Points.Count);

        Assert.Equal("2026-05-20", view.Points[0].Date);
        Assert.Equal("May 20", view.Points[0].Label);
        Assert.Equal(160, view.Points[0].Efficiency);
        Assert.Null(view.Points[0].RollingAvg);

        Assert.Equal(180, view.Points[1].Efficiency);
        Assert.Equal(170, view.Points[1].RollingAvg);

        Assert.Equal(200, view.Points[2].Efficiency);
        Assert.Equal(180, view.Points[2].RollingAvg);

        Assert.Equal(160, view.Points[3].Efficiency);
        Assert.Equal(175, view.Points[3].RollingAvg);

        Assert.Equal("Wh/km", view.EfficiencyUnit);
        Assert.Equal("Daily (Wh/km)", view.DailySeriesName);
        Assert.Equal("7-day avg (Wh/km)", view.RollingSeriesName);

        // Avg / Best day / Trend.
        Assert.Equal(3, view.Stats.Count);
        Assert.Equal("Avg", view.Stats[0].Label);
        Assert.Equal("175", view.Stats[0].Value);
        Assert.Equal("Wh/km", view.Stats[0].Unit);

        Assert.Equal("Best day", view.Stats[1].Label);
        Assert.Equal("160", view.Stats[1].Value);
        Assert.Equal("Wh/km", view.Stats[1].Unit);

        Assert.Equal("Trend", view.Stats[2].Label);
        Assert.Equal("+5.9%", view.Stats[2].Value);
        Assert.Null(view.Stats[2].Unit);

        Assert.True(view.HasReferenceLine);
        Assert.Equal(175, view.ReferenceValue);
    }

    [Fact]
    public void Project_converts_to_miles_when_imperial()
    {
        var view = DriveEfficiencyChartProjection.Project(
            SampleDrives(), new DriveEfficiencyChartSize(2, 4), UnitPref.Imperial, Localizer, Now);

        Assert.Equal("Wh/mi", view.EfficiencyUnit);
        Assert.Equal("Daily (Wh/mi)", view.DailySeriesName);
        Assert.Equal("Wh/mi", view.Stats[0].Unit);

        // 160 Wh/km * 1.609344 = 257.49504 → 257.5; 200 * 1.609344 = 321.8688 → 321.9.
        Assert.Equal(257.5, view.Points[0].Efficiency);
        Assert.Equal(321.9, view.Points[2].Efficiency);
    }

    [Fact]
    public void Project_filters_to_last_30_days()
    {
        var drives = new[]
        {
            Drive("2026-05-20T08:00:00Z", 10000, 1500), // inside window
            Drive("2026-04-01T08:00:00Z", 10000, 1500), // older than 30-day cutoff
        };

        var view = DriveEfficiencyChartProjection.Project(
            drives, new DriveEfficiencyChartSize(2, 4), UnitPref.Metric, Localizer, Now);

        Assert.Single(view.Points);
        Assert.Equal("2026-05-20", view.Points[0].Date);
    }

    [Fact]
    public void Project_empty_when_no_usable_samples()
    {
        // All tiny drives → no efficiency sample → web isEmpty.
        var drives = new[]
        {
            Drive("2026-05-20T08:00:00Z", 400, 100),
            Drive("2026-05-21T08:00:00Z", 500, 120),
        };

        var view = DriveEfficiencyChartProjection.Project(
            drives, new DriveEfficiencyChartSize(2, 4), UnitPref.Metric, Localizer, Now);

        Assert.True(view.IsEmpty);
        Assert.Empty(view.Points);
        Assert.False(view.HasReferenceLine);
        Assert.Equal(EmDash, view.Stats[0].Value);
        Assert.Equal(EmDash, view.Stats[1].Value);
        Assert.Equal(EmDash, view.Stats[2].Value);
    }

    [Fact]
    public void Project_trend_is_null_below_four_points()
    {
        var drives = new[]
        {
            Drive("2026-05-20T08:00:00Z", 10000, 1500),
            Drive("2026-05-21T08:00:00Z", 10000, 1800),
            Drive("2026-05-22T08:00:00Z", 10000, 2000),
        };

        var view = DriveEfficiencyChartProjection.Project(
            drives, new DriveEfficiencyChartSize(2, 4), UnitPref.Metric, Localizer, Now);

        Assert.Equal(3, view.Points.Count);
        Assert.Equal(EmDash, view.Stats[2].Value); // Trend
    }

    [Fact]
    public void Project_legend_matches_series_palette()
    {
        var view = DriveEfficiencyChartProjection.Project(
            SampleDrives(), new DriveEfficiencyChartSize(2, 4), UnitPref.Metric, Localizer, Now);

        Assert.Equal(2, view.Legend.Count);
        Assert.Equal("Daily", view.Legend[0].Label);
        Assert.Equal("TsChart01Brush", view.Legend[0].ColorBrushKey);
        Assert.Equal("7-day avg", view.Legend[1].Label);
        Assert.Equal("TsChart02Brush", view.Legend[1].ColorBrushKey);
    }

    [Fact]
    public void Project_compact_marks_compact_and_lists_stats_for_narrator()
    {
        var view = DriveEfficiencyChartProjection.Project(
            SampleDrives(), new DriveEfficiencyChartSize(1, 1), UnitPref.Metric, Localizer, Now);

        Assert.True(view.IsCompact);
        Assert.NotEmpty(view.Stats);

        // Every stat carries a Narrator automation name; the compact name aggregates them.
        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("Avg", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Trend", view.CompactAutomationName, StringComparison.Ordinal);

        // Web parity: isCompact requires BOTH cols<=1 AND rows<=1.
        Assert.False(DriveEfficiencyChartProjection.Project(
            SampleDrives(), new DriveEfficiencyChartSize(1, 2), UnitPref.Metric, Localizer, Now).IsCompact);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """[{"distance_m":10000,"energy_used_wh":1500,"start_ts":"2026-05-20T08:00:00Z"}]""");

        var cached = DriveEfficiencyChartResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = DriveEfficiencyChartResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, DriveEfficiencyChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DriveEfficiencyChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DriveEfficiencyChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(SampleDrives()));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Loaded, vm.State);
        Assert.Equal(4, vm.Display.Points.Count);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_usable_data_renders_empty_via_isEmpty_gate()
    {
        var noData = new[] { Drive("2026-05-20T08:00:00Z", 400, 100) };
        using var vm = NewViewModel(Loaded(noData));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Empty, vm.State);
        Assert.Equal("No efficiency data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Cached(SampleDrives(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(4, vm.Display.Points.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.OfflineCached(
            SampleDrives(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loading(),
            RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Cached(SampleDrives(), Now, stale: false),
            RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loaded(SampleDrives(), Now));
        await vm.LoadAsync();

        Assert.Equal(DriveEfficiencyChartState.Loaded, vm.State);
        Assert.Equal("175", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new DriveEfficiencyChartSize(2, 4), Loaded(SampleDrives()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new DriveEfficiencyChartSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(DriveEfficiencyChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_efficiency_unit()
    {
        using var vm = NewViewModel(Loaded(SampleDrives()));
        await vm.LoadAsync();
        Assert.Equal("Wh/km", vm.Display.Stats[0].Unit);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Wh/mi", vm.Display.Stats[0].Unit);
        Assert.Equal(DriveEfficiencyChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive Efficiency", vm.Title);
        Assert.Equal("No efficiency data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SampleDrives()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveEfficiencyChartViewModel.State), changed);
        Assert.Contains(nameof(DriveEfficiencyChartViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("drive-efficiency-chart", DriveEfficiencyChartRegistration.Id);
        Assert.Equal("driving", DriveEfficiencyChartRegistration.Category);
        Assert.Equal("DriveEfficiencyChartWidget", DriveEfficiencyChartRegistration.Slug);
        Assert.Equal(new DriveEfficiencyChartSize(2, 4), DriveEfficiencyChartRegistration.DefaultSize);
        Assert.Equal(new DriveEfficiencyChartSize(1, 2), DriveEfficiencyChartRegistration.MinSize);
        Assert.Equal(new DriveEfficiencyChartSize(4, 40), DriveEfficiencyChartRegistration.MaxSize);
        Assert.Equal("Drive Efficiency Chart", DriveEfficiencyChartRegistration.Name(Localizer));
        Assert.Contains("rolling average", DriveEfficiencyChartRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DriveEfficiencyChartRegistration.IsWithinBounds(new DriveEfficiencyChartSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DriveEfficiencyChartSize(1, 2), DriveEfficiencyChartRegistration.Clamp(new DriveEfficiencyChartSize(0, 0)));
        Assert.Equal(new DriveEfficiencyChartSize(4, 40), DriveEfficiencyChartRegistration.Clamp(new DriveEfficiencyChartSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveEfficiencyChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveEfficiencyChartWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DriveEfficiencyChartSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """[{"distance_m":10000,"energy_used_wh":1500,"start_ts":"2026-05-20T08:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveEfficiencyChartSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Single(terminal.Value!);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"distance_m":10000,"energy_used_wh":1500,"start_ts":"2026-05-20T08:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveEfficiencyChartSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveEfficiencyChartSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>>> Drain(IDriveEfficiencyChartSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>> Loaded(IReadOnlyList<DriveEfficiencyDrive> drives) =>
        RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>.Loaded(drives, Now);

    private static DriveEfficiencyChartViewModel NewViewModel(params RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>[] emissions) =>
        NewViewModel(DriveEfficiencyChartSize.Default, emissions);

    private static DriveEfficiencyChartViewModel NewViewModel(
        DriveEfficiencyChartSize size,
        params RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>[] emissions) =>
        new(new FakeDriveSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeDriveSource(params RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>[] emissions) : IDriveEfficiencyChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveEfficiencyDrive>>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
