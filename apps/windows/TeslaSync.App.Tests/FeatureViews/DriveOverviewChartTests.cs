using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the Drive Overview surface's UI-thread-free logic — the per-drive telemetry JSON
/// parse adapter (speed / power / battery_level / usable_soc / ideal_range / est_range / rated_range), the
/// SI→display conversion + dual-axis normalization, the conditional series gates
/// (<c>chartData.some(...)</c>), the Mean / Max / Min legend statistics, the <c>chartData.length &gt; 1</c>
/// empty gate, the cache-then-network result mapper, the drive-resolving data source (explicit drive id,
/// primary-vehicle → latest-drive chain, disabled-when-no-vehicle short-circuit), the registry metadata, the
/// PII-safe diagnostics, the Narrator automation names and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline + unit re-projection). Mirrors the web
/// spec (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx + useDriveDetailData.ts).
/// </summary>
public sealed class DriveOverviewChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string TwoSampleTrace =
        """
        [
          {"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":50,"battery_level":80,"usable_soc":78,"ideal_range":400000,"est_range":380000},
          {"timestamp":"2026-04-04T10:01:00Z","speed":20,"power":-30,"battery_level":78,"usable_soc":76,"ideal_range":398000,"est_range":378000}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_overview_field()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:00:00Z","speed":12.5,"power":48,"battery_level":80,"usable_soc":77,"ideal_range":401000,"est_range":381000,"rated_range":370000}""");

        var s = DriveOverviewSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(12.5, s.SpeedMps);
        Assert.Equal(48, s.PowerKw);
        Assert.Equal(80, s.BatteryPct);
        Assert.Equal(77, s.UsableSocPct);
        Assert.Equal(401000, s.IdealRangeM);
        Assert.Equal(381000, s.EstRangeM);
        Assert.Equal(370000, s.RatedRangeM);
    }

    [Fact]
    public void FromJson_falls_back_to_created_at_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T11:00:00Z","speed":5}""");

        var s = DriveOverviewSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(5, s.SpeedMps);
        Assert.Null(s.PowerKw);
        Assert.Null(s.BatteryPct);
        Assert.Null(s.IdealRangeM);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"speed":1}, 7, {"speed":2}]""");

        var list = DriveOverviewSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].SpeedMps);
        Assert.Equal(2, list[1].SpeedMps);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"speed":1}""");
        Assert.Empty(DriveOverviewSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(TwoSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Drive Overview", display.Title);
        Assert.Equal("Drive overview composed chart of speed, range, SOC and power over time", display.ChartAriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
    }

    [Fact]
    public void Project_series_names_carry_the_active_units()
    {
        var metric = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Equal("Speed (km/h)", metric.SpeedSeriesName);
        Assert.Equal("Range ideal (km)", metric.IdealRangeSeriesName);
        Assert.Equal("Range est. (km)", metric.EstRangeSeriesName);
        Assert.Equal("SOC %", metric.SocSeriesName);
        Assert.Equal("Usable SOC %", metric.UsableSocSeriesName);
        Assert.Equal("Power kW", metric.PowerSeriesName);

        var imperial = Project(TwoSampleTrace, UnitPref.Imperial).Chart;
        Assert.Equal("Speed (mph)", imperial.SpeedSeriesName);
        Assert.Equal("Range ideal (mi)", imperial.IdealRangeSeriesName);
    }

    // ---- Projection: SI→display + normalization ------------------------------------

    [Fact]
    public void Project_converts_speed_and_range_from_si_and_keeps_soc_power_native()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;

        // speed: 10 m/s → 36 km/h, 20 m/s → 72 km/h. range: 400000 m → 400 km. SOC / power native.
        Assert.Equal(36, chart.Points[0].SpeedDisplay, 3);
        Assert.Equal(72, chart.Points[1].SpeedDisplay, 3);
        Assert.Equal(400, chart.Points[0].IdealRangeDisplay!.Value, 3);
        Assert.Equal(380, chart.Points[0].EstRangeDisplay!.Value, 3);
        Assert.Equal(80, chart.Points[0].SocPct, 3);
        Assert.Equal(50, chart.Points[0].PowerKw, 3);
    }

    [Fact]
    public void Project_normalizes_left_axis_to_joint_max_and_power_axis_across_zero()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;

        // Left axis max = max(speed 72, SOC 80, ideal 400, est 380, usable 78) = 400.
        Assert.Equal("400", chart.LeftAxisMaxLabel);
        Assert.Equal(36.0 / 400.0, chart.Points[0].SpeedRatio, 6);
        Assert.Equal(80.0 / 400.0, chart.Points[0].SocRatio, 6);
        Assert.Equal(1.0, chart.Points[0].IdealRangeRatio!.Value, 6); // 400 / 400

        // Power axis spans zero: min(-30), max(50). ratio = (power - min) / range.
        Assert.Equal("50 kW", chart.PowerAxisMaxLabel);
        Assert.Equal("-30 kW", chart.PowerAxisMinLabel);
        Assert.Equal(1.0, chart.Points[0].PowerRatio, 6);  // (50 - -30) / 80
        Assert.Equal(0.0, chart.Points[1].PowerRatio, 6);  // (-30 - -30) / 80
    }

    [Fact]
    public void Project_time_labels_use_24h_local_clock()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Equal(2, chart.Points.Count);
        Assert.Matches(@"^\d{2}:\d{2}$", chart.Points[0].TimeLabel);
    }

    // ---- Projection: conditional series gates --------------------------------------

    [Fact]
    public void Project_flags_all_optional_series_present_when_data_carries_them()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;
        Assert.True(chart.HasIdealRange);
        Assert.True(chart.HasEstRange);
        Assert.True(chart.HasUsableSoc);
    }

    [Fact]
    public void Project_omits_optional_series_when_data_lacks_them()
    {
        var chart = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":50,"battery_level":80},
              {"timestamp":"2026-04-04T10:01:00Z","speed":20,"power":-30,"battery_level":78}
            ]
            """).Chart;

        Assert.False(chart.HasIdealRange);
        Assert.False(chart.HasEstRange);
        Assert.False(chart.HasUsableSoc);
        Assert.All(chart.Points, p => Assert.Null(p.IdealRangeRatio));
        Assert.All(chart.Points, p => Assert.Null(p.UsableSocRatio));
    }

    [Fact]
    public void Project_est_series_falls_back_to_rated_range()
    {
        // Web parity: dataKey = some(estRange) ? 'estRange' : 'ratedRange'; stat uses estRange ?? ratedRange.
        var chart = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":5,"battery_level":80,"rated_range":360000},
              {"timestamp":"2026-04-04T10:01:00Z","speed":20,"power":6,"battery_level":78,"rated_range":358000}
            ]
            """).Chart;

        Assert.True(chart.HasEstRange);
        Assert.Equal(360, chart.Points[0].EstRangeDisplay!.Value, 3); // 360000 m → 360 km from rated_range
    }

    // ---- Projection: rich Mean / Max / Min legend ----------------------------------

    [Fact]
    public void Project_legend_lists_present_series_in_web_order_with_brushes()
    {
        var legend = ProjectMetric(TwoSampleTrace).Legend;

        Assert.Equal(6, legend.Count);
        Assert.Equal(new[] { "Speed", "Range (ideal)", "Range (est.)", "SOC", "Usable SOC", "Power" },
            legend.Select(l => l.Label).ToArray());
        Assert.Equal(DriveOverviewChartProjection.SpeedBrushKey, legend[0].ColorBrushKey);
        Assert.Equal(DriveOverviewChartProjection.IdealRangeBrushKey, legend[1].ColorBrushKey);
        Assert.Equal(DriveOverviewChartProjection.EstRangeBrushKey, legend[2].ColorBrushKey);
        Assert.Equal(DriveOverviewChartProjection.SocBrushKey, legend[3].ColorBrushKey);
        Assert.Equal(DriveOverviewChartProjection.UsableSocBrushKey, legend[4].ColorBrushKey);
        Assert.Equal(DriveOverviewChartProjection.PowerBrushKey, legend[5].ColorBrushKey);

        // Web parity: the two range series are dashed; the rest are solid.
        Assert.True(legend[1].Dashed);
        Assert.True(legend[2].Dashed);
        Assert.False(legend[0].Dashed);
        Assert.False(legend[5].Dashed);
    }

    [Fact]
    public void Project_legend_range_stats_use_integer_precision_and_distance_unit()
    {
        var legend = ProjectMetric(TwoSampleTrace).Legend;
        var ideal = legend[1];

        // ideal km: 400, 398 → mean 399, max 400, min 398 (fmtInt, web).
        Assert.Equal("399 km", ideal.Mean);
        Assert.Equal("400 km", ideal.Max);
        Assert.Equal("398 km", ideal.Min);
    }

    [Fact]
    public void Project_legend_soc_uses_percent_and_excludes_non_positive_battery()
    {
        // Web parity: socS = statFn(map(d => d.battery > 0 ? d.battery : null)) — a zero battery is excluded.
        var legend = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":5,"battery_level":0},
              {"timestamp":"2026-04-04T10:01:00Z","speed":20,"power":6,"battery_level":60},
              {"timestamp":"2026-04-04T10:02:00Z","speed":15,"power":4,"battery_level":58}
            ]
            """).Legend;

        var soc = Assert.Single(legend, l => l.Label == "SOC");
        // Only 60 and 58 count → mean 59, max 60, min 58.
        Assert.Contains("59", soc.Mean);
        Assert.Contains("%", soc.Mean);
        Assert.Contains("60", soc.Max);
        Assert.Contains("58", soc.Min);
    }

    [Fact]
    public void Project_legend_speed_and_power_carry_units()
    {
        var legend = ProjectMetric(TwoSampleTrace).Legend;
        var speed = legend[0];
        var power = legend[5];

        // speed: 36, 72 km/h → min uses fmtInt (web), mean/max default precision.
        Assert.Contains("km/h", speed.Mean);
        Assert.Equal("36 km/h", speed.Min);
        Assert.Contains("kW", power.Mean);
        // power: 50, -30 → mean 10, max 50, min -30.
        Assert.Contains("50", power.Max);
        Assert.Contains("-30", power.Min);
    }

    [Fact]
    public void Project_legend_automation_names_describe_the_row()
    {
        var legend = ProjectMetric(TwoSampleTrace).Legend;

        Assert.All(legend, l =>
        {
            Assert.Contains(l.Label, l.AutomationName);
            Assert.Contains("Mean", l.AutomationName);
            Assert.Contains("Max", l.AutomationName);
            Assert.Contains("Min", l.AutomationName);
        });
    }

    [Fact]
    public void Project_chart_automation_name_reports_sample_count()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Contains("2", chart.AutomationName);
    }

    // ---- Projection: empty gate (chartData.length > 1) -----------------------------

    [Fact]
    public void Project_single_sample_is_not_plottable()
    {
        var display = ProjectMetric("""[{"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":5,"battery_level":80}]""");

        Assert.False(display.HasData);
        Assert.False(display.Chart.HasPoints);
        Assert.Empty(display.Legend);
    }

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = DriveOverviewChartProjection.Empty(UnitPref.Metric, Localizer);
        Assert.False(display.HasData);
        Assert.Empty(display.Chart.Points);
        Assert.Empty(display.Legend);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(TwoSampleTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = DriveOverviewChartResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(2, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, DriveOverviewChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, DriveOverviewChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = DriveOverviewChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new DriveOverviewChartViewModel(new FakeSource(), Localizer);
        Assert.Equal(DriveOverviewChartState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Chart.Points.Count);
    }

    [Fact]
    public async Task ViewModel_short_trace_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(
            ParseTrace("""[{"timestamp":"2026-04-04T10:00:00Z","speed":10,"power":5,"battery_level":80}]"""), Now));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(DriveOverviewChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loading(),
            RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(DriveOverviewChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(DriveOverviewChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal("Speed (km/h)", vm.Display.Chart.SpeedSeriesName);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("Speed (mph)", vm.Display.Chart.SpeedSeriesName);
        Assert.Equal("Range ideal (mi)", vm.Display.Chart.IdealRangeSeriesName);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveOverviewChartViewModel.State), changed);
        Assert.Contains(nameof(DriveOverviewChartViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive Overview", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source -----------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_chains_drive_list_latest_telemetry()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":11,"start_ts":"2026-04-01T08:00:00Z"},{"id":55,"start_ts":"2026-04-04T10:00:00Z"}]""");
        using var telemetry = JsonDocument.Parse(TwoSampleTrace);

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement.Clone())
            .ReturnsValue(telemetry.RootElement.Clone());
        var source = new DriveOverviewChartSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Count);
        Assert.Equal(2, api.Requests.Count);

        // 1) drive list scoped by vehicle_id (newest by start_ts → id 55).
        Assert.Equal(Operations.Drives.List, api.Requests[0].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));

        // 2) that drive's telemetry by path parameter.
        Assert.Equal(Operations.Drives.Telemetry, api.Requests[1].OperationId);
        Assert.Equal("55", api.Requests[1].PathParams!["driveID"]);
    }

    [Fact]
    public async Task Source_explicit_drive_id_skips_vehicle_and_list_resolution()
    {
        using var telemetry = JsonDocument.Parse(TwoSampleTrace);
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement.Clone());
        var source = new DriveOverviewChartSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: null, driveId: 99);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Drives.Telemetry, request.OperationId);
        Assert.Equal("99", request.PathParams!["driveID"]);
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new DriveOverviewChartSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new DriveOverviewChartSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
        Assert.Equal(Operations.Drives.List, Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_empty_telemetry_yields_empty()
    {
        using var telemetry = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement.Clone());
        var source = new DriveOverviewChartSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("drive-overview-chart", DriveOverviewChartRegistration.Id);
        Assert.Equal("DriveOverviewChart", DriveOverviewChartRegistration.Slug);
        Assert.Equal("Drive Overview", DriveOverviewChartRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveOverviewChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveOverviewChart", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DriveOverviewChartDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static DriveOverviewChartDisplay Project(string json, UnitPref units) =>
        DriveOverviewChartProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<DriveOverviewSample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return DriveOverviewSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<DriveOverviewSample> Trace() => ParseTrace(TwoSampleTrace);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static DriveOverviewChartViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<DriveOverviewSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<DriveOverviewSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveOverviewSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<DriveOverviewSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<DriveOverviewSample>>[] emissions)
        : IDriveOverviewChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveOverviewSample>>> StreamAsync(
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
