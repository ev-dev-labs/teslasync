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
/// Headless verification of the Elevation Profile surface's UI-thread-free logic — the per-drive telemetry
/// JSON parse adapter (elevation / speed), the SI→display conversion + dual-axis normalization, the
/// elevation-gain / elevation-loss / net reductions, the <c>chartData.length &gt; 1</c> empty gate, the
/// cache-then-network result mapper, the drive-resolving data source (explicit drive id, primary-vehicle →
/// latest-drive chain, disabled-when-no-vehicle short-circuit), the registry metadata, the PII-safe
/// diagnostics, the Narrator automation names and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline + unit re-projection). Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/ElevationChart.tsx + useDriveDetailData.ts).
/// </summary>
public sealed class ElevationChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string TwoSampleTrace =
        """
        [
          {"timestamp":"2026-04-04T10:00:00Z","elevation":100,"speed":10},
          {"timestamp":"2026-04-04T10:01:00Z","elevation":130,"speed":20}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_elevation_speed_and_timestamp()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:00:00Z","elevation":123.5,"speed":12.5}""");

        var s = ElevationSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(123.5, s.ElevationM);
        Assert.Equal(12.5, s.SpeedMps);
    }

    [Fact]
    public void FromJson_falls_back_to_created_at_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T11:00:00Z","speed":5}""");

        var s = ElevationSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Null(s.ElevationM);
        Assert.Equal(5, s.SpeedMps);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"elevation":1}, 7, {"elevation":2}]""");

        var list = ElevationSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].ElevationM);
        Assert.Equal(2, list[1].ElevationM);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"elevation":1}""");
        Assert.Empty(ElevationSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(TwoSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Elevation Profile", display.Title);
        Assert.Equal("Elevation and speed area+line chart over the drive timeline", display.ChartAriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
        Assert.Equal("gain", display.GainLabel);
        Assert.Equal("loss", display.LossLabel);
        Assert.Equal("Net", display.NetLabel);
    }

    [Fact]
    public void Project_series_names_carry_the_active_speed_unit_and_metre_elevation()
    {
        var metric = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Equal("Elevation (m)", metric.ElevationSeriesName);
        Assert.Equal("Speed (km/h)", metric.SpeedSeriesName);

        var imperial = Project(TwoSampleTrace, UnitPref.Imperial).Chart;
        Assert.Equal("Elevation (m)", imperial.ElevationSeriesName); // elevation is always metres
        Assert.Equal("Speed (mph)", imperial.SpeedSeriesName);
    }

    // ---- Projection: SI→display + normalization ------------------------------------

    [Fact]
    public void Project_keeps_elevation_in_metres_and_converts_speed_from_si()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;

        // elevation: 100 m, 130 m kept as metres. speed: 10 m/s → 36 km/h, 20 m/s → 72 km/h.
        Assert.Equal(100, chart.Points[0].ElevationM, 3);
        Assert.Equal(130, chart.Points[1].ElevationM, 3);
        Assert.Equal(36, chart.Points[0].SpeedDisplay, 3);
        Assert.Equal(72, chart.Points[1].SpeedDisplay, 3);

        // imperial: elevation unchanged (metres); speed in mph.
        var imperial = Project(TwoSampleTrace, UnitPref.Imperial).Chart;
        Assert.Equal(130, imperial.Points[1].ElevationM, 3);
        Assert.Equal(UnitConverters.SpeedFromSi(20, SpeedUnit.Mph), imperial.Points[1].SpeedDisplay, 3);
    }

    [Fact]
    public void Project_normalizes_elevation_across_min_max_and_speed_across_zero_max()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;

        // elevation axis [100, 130]: ratio = (elev - 100) / 30.
        Assert.Equal("130", chart.ElevAxisMaxLabel);
        Assert.Equal("100", chart.ElevAxisMinLabel);
        Assert.Equal(0.0, chart.Points[0].ElevationRatio, 6);
        Assert.Equal(1.0, chart.Points[1].ElevationRatio, 6);

        // speed axis [0, 72]: ratio = speed / 72.
        Assert.Equal("72", chart.SpeedAxisMaxLabel);
        Assert.Equal(36.0 / 72.0, chart.Points[0].SpeedRatio, 6);
        Assert.Equal(1.0, chart.Points[1].SpeedRatio, 6);
    }

    [Fact]
    public void Project_flat_elevation_centers_the_ratio()
    {
        // A flat trace (min == max) cannot divide by range; the projection centres every point at 0.5.
        var chart = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","elevation":200,"speed":10},
              {"timestamp":"2026-04-04T10:01:00Z","elevation":200,"speed":20}
            ]
            """).Chart;

        Assert.All(chart.Points, p => Assert.Equal(0.5, p.ElevationRatio, 6));
    }

    [Fact]
    public void Project_time_labels_use_24h_local_clock()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Equal(2, chart.Points.Count);
        Assert.Matches(@"^\d{2}:\d{2}$", chart.Points[0].TimeLabel);
    }

    [Fact]
    public void Project_chart_automation_name_reports_sample_count()
    {
        var chart = ProjectMetric(TwoSampleTrace).Chart;
        Assert.Contains("2", chart.AutomationName);
    }

    // ---- Projection: gain / loss / net stats ---------------------------------------

    [Fact]
    public void Project_stats_sum_positive_and_negative_elevation_deltas()
    {
        // 100 → 130 (+30) → 110 (-20): gain 30, loss 20, net 10.
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","elevation":100,"speed":10},
              {"timestamp":"2026-04-04T10:01:00Z","elevation":130,"speed":12},
              {"timestamp":"2026-04-04T10:02:00Z","elevation":110,"speed":11}
            ]
            """);

        Assert.Equal(30, display.Stats.GainM, 6);
        Assert.Equal(20, display.Stats.LossM, 6);
        Assert.Equal(10, display.Stats.NetM, 6);
    }

    [Fact]
    public void Project_stats_format_with_metre_unit()
    {
        var stats = ProjectMetric(TwoSampleTrace).Stats;

        // 100 → 130: gain 30, loss 0, net 30 — formatted with the metre suffix.
        Assert.Equal(30, stats.GainM, 6);
        Assert.Equal(0, stats.LossM, 6);
        Assert.Equal(30, stats.NetM, 6);
        Assert.Contains("30", stats.GainText);
        Assert.EndsWith("m", stats.GainText);
        Assert.EndsWith("m", stats.LossText);
        Assert.EndsWith("m", stats.NetText);
    }

    [Fact]
    public void Project_stats_net_can_be_negative()
    {
        // 200 → 150 (-50): gain 0, loss 50, net -50.
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","elevation":200,"speed":10},
              {"timestamp":"2026-04-04T10:01:00Z","elevation":150,"speed":12}
            ]
            """);

        Assert.Equal(0, display.Stats.GainM, 6);
        Assert.Equal(50, display.Stats.LossM, 6);
        Assert.Equal(-50, display.Stats.NetM, 6);
        Assert.Contains("-50", display.Stats.NetText);
    }

    [Fact]
    public void Project_missing_elevation_coalesces_to_zero()
    {
        // Web parity: elevation defaults to 0 when absent (tp.elevation ?? 0).
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","speed":10},
              {"timestamp":"2026-04-04T10:01:00Z","elevation":40,"speed":12}
            ]
            """);

        Assert.Equal(0, display.Chart.Points[0].ElevationM, 6);
        Assert.Equal(40, display.Stats.GainM, 6); // 0 → 40 = +40
    }

    // ---- Projection: empty gate (chartData.length > 1) -----------------------------

    [Fact]
    public void Project_single_sample_is_not_plottable()
    {
        var display = ProjectMetric("""[{"timestamp":"2026-04-04T10:00:00Z","elevation":100,"speed":10}]""");

        Assert.False(display.HasData);
        Assert.False(display.Chart.HasPoints);
    }

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = ElevationChartProjection.Empty(UnitPref.Metric, Localizer);
        Assert.False(display.HasData);
        Assert.Empty(display.Chart.Points);
        Assert.Equal(0, display.Stats.GainM);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(TwoSampleTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = ElevationChartResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(2, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, ElevationChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, ElevationChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = ElevationChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    [Fact]
    public void Mapper_preserves_offline_with_cached_value()
    {
        using var doc = JsonDocument.Parse(TwoSampleTrace);
        var offline = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = ElevationChartResultMapper.Map(offline);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(2, mapped.Value!.Count);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new ElevationChartViewModel(new FakeSource(), Localizer);
        Assert.Equal(ElevationChartState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Chart.Points.Count);
    }

    [Fact]
    public async Task ViewModel_short_trace_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(
            ParseTrace("""[{"timestamp":"2026-04-04T10:00:00Z","elevation":100,"speed":10}]"""), Now));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(ElevationChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ElevationSample>>.Loading(),
            RepositoryResult<IReadOnlyList<ElevationSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(ElevationChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(ElevationChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_speed_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal("Speed (km/h)", vm.Display.Chart.SpeedSeriesName);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("Speed (mph)", vm.Display.Chart.SpeedSeriesName);
        Assert.Equal("Elevation (m)", vm.Display.Chart.ElevationSeriesName);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ElevationChartViewModel.State), changed);
        Assert.Contains(nameof(ElevationChartViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ElevationSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Elevation Profile", vm.Title);
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
        var source = new ElevationChartSource(
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
        var source = new ElevationChartSource(
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
        var source = new ElevationChartSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new ElevationChartSource(
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
        var source = new ElevationChartSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics + a11y labels ----------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("elevation-chart", ElevationChartRegistration.Id);
        Assert.Equal("ElevationChart", ElevationChartRegistration.Slug);
        Assert.Equal("Elevation Profile", ElevationChartRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ElevationChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ElevationChart", Assert.Single(lines));
    }

    [Fact]
    public void Projection_brush_keys_match_web_series_colours()
    {
        // web Area stroke/fill #10b981 → success token; web Line stroke #a855f7 → power token.
        Assert.Equal("TsColorSuccessBrush", ElevationChartProjection.ElevationBrushKey);
        Assert.Equal("TsChartPowerBrush", ElevationChartProjection.SpeedBrushKey);
    }

    [Fact]
    public void Accessibility_labels_are_present_on_chart_and_stats()
    {
        var display = ProjectMetric(TwoSampleTrace);

        // The chart carries a spoken summary and every stat/series label resolves through i18n.
        Assert.False(string.IsNullOrWhiteSpace(display.ChartAriaLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.Chart.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Chart.ElevationSeriesName));
        Assert.False(string.IsNullOrWhiteSpace(display.Chart.SpeedSeriesName));
        Assert.False(string.IsNullOrWhiteSpace(display.GainLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.LossLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.NetLabel));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ElevationChartDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static ElevationChartDisplay Project(string json, UnitPref units) =>
        ElevationChartProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<ElevationSample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return ElevationSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<ElevationSample> Trace() => ParseTrace(TwoSampleTrace);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static ElevationChartViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<ElevationSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<ElevationSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<ElevationSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ElevationSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<ElevationSample>>[] emissions)
        : IElevationChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ElevationSample>>> StreamAsync(
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
