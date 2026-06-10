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
/// Headless verification of the Speed-Histogram surface's UI-thread-free logic — the per-drive telemetry JSON
/// speed-parse adapter, the SI→display speed conversion + fixed-edge bucketing + percentage projection (web
/// <c>speedHistData</c> memo), the open / closed bucket edge labels at the user's global precision, the
/// <c>speedHistData.length &gt; 0</c> empty gate, the cache-then-network result mapper, the drive-resolving
/// data source (explicit drive id, primary-vehicle → latest-drive chain, disabled-when-no-vehicle
/// short-circuit), the registry metadata, the PII-safe diagnostics and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline + unit re-projection). Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx + useDriveDetailData.ts).
/// </summary>
public sealed class SpeedHistogramChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Five samples (SI m/s): three at 18 km/h (bucket 0), one at 36 km/h (bucket 1), one at 90 km/h (bucket 4).
    private const string FiveSampleTrace =
        """[{"speed":5},{"speed":5},{"speed":5},{"speed":10},{"speed":25}]""";

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_speed()
    {
        using var doc = JsonDocument.Parse("""{"speed":12.5,"battery_level":80}""");
        var s = SpeedHistogramSample.FromJson(doc.RootElement);
        Assert.Equal(12.5, s.SpeedMps);
    }

    [Fact]
    public void FromJson_tolerates_missing_or_non_numeric_speed()
    {
        using var doc = JsonDocument.Parse("""{"battery_level":80}""");
        Assert.Null(SpeedHistogramSample.FromJson(doc.RootElement).SpeedMps);

        using var bad = JsonDocument.Parse("""{"speed":"fast"}""");
        Assert.Null(SpeedHistogramSample.FromJson(bad.RootElement).SpeedMps);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"speed":1}, 7, {"speed":2}]""");
        var list = SpeedHistogramSample.ParseList(doc.RootElement);
        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].SpeedMps);
        Assert.Equal(2, list[1].SpeedMps);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"speed":1}""");
        Assert.Empty(SpeedHistogramSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(FiveSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Speed Histogram", display.Title);
        Assert.Equal("Speed-bucket distribution histogram", display.AriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
        Assert.Equal("Speed range", display.RangeColumnLabel);
        Assert.Equal("% of drive", display.PctColumnLabel);
        Assert.Equal("% of drive", display.Chart.BarSeriesName);
    }

    // ---- Projection: bucketing + percentages ---------------------------------------

    [Fact]
    public void Project_buckets_samples_and_drops_empty_buckets()
    {
        var chart = ProjectMetric(FiveSampleTrace).Chart;

        // bucket 0 (×3) = 60%, bucket 1 (×1) = 20%, bucket 4 (×1) = 20%; buckets 2/3/5/6 dropped.
        Assert.Equal(3, chart.Bars.Count);
        Assert.Equal(new[] { "0.00\u201320.00", "20.00\u201340.00", "80.00\u2013100.00" },
            chart.Bars.Select(b => b.Range).ToArray());
        Assert.Equal(new[] { 60, 20, 20 }, chart.Bars.Select(b => b.Pct).ToArray());
        Assert.Equal(60, chart.MaxPct);
    }

    [Fact]
    public void Project_pct_label_and_height_ratio_normalize_against_tallest_bar()
    {
        var chart = ProjectMetric(FiveSampleTrace).Chart;

        Assert.Equal("60%", chart.Bars[0].PctLabel);
        Assert.Equal("20%", chart.Bars[1].PctLabel);
        Assert.Equal(1.0, chart.Bars[0].HeightRatio, 6);     // 60 / 60
        Assert.Equal(20.0 / 60.0, chart.Bars[1].HeightRatio, 6);
        Assert.Equal(20.0 / 60.0, chart.Bars[2].HeightRatio, 6);
    }

    [Fact]
    public void Project_percentages_round_half_away_from_zero_like_js_math_round()
    {
        // 1 of 8 = 12.5% → JS Math.round → 13; 7 of 8 = 87.5% → 88.
        var chart = ProjectMetric(
            """[{"speed":5},{"speed":10},{"speed":10},{"speed":10},{"speed":10},{"speed":10},{"speed":10},{"speed":10}]""").Chart;

        var bottom = chart.Bars.Single(b => b.Range == "0.00\u201320.00");
        var second = chart.Bars.Single(b => b.Range == "20.00\u201340.00");
        Assert.Equal(13, bottom.Pct); // 1/8 = 12.5 → 13
        Assert.Equal(88, second.Pct); // 7/8 = 87.5 → 88
    }

    [Fact]
    public void Project_open_bucket_uses_plus_label()
    {
        // 40 m/s = 144 km/h → the open 120+ bucket; one sample → 100%.
        var chart = ProjectMetric("""[{"speed":40}]""").Chart;

        var bar = Assert.Single(chart.Bars);
        Assert.Equal("120.00+", bar.Range);
        Assert.Equal(100, bar.Pct);
    }

    [Fact]
    public void Project_null_speed_counts_as_zero_in_bottom_bucket()
    {
        // Web parity: speed = tp.speed ?? 0, so a row with no speed lands in the 0-20 bucket.
        var chart = ProjectMetric("""[{"battery_level":80}]""").Chart;

        var bar = Assert.Single(chart.Bars);
        Assert.Equal("0.00\u201320.00", bar.Range);
        Assert.Equal(100, bar.Pct);
    }

    [Fact]
    public void Project_bucketing_uses_the_display_unit()
    {
        // 17 m/s = 61.2 km/h (metric bucket 3) but 38.03 mph (imperial bucket 1).
        Assert.Equal("60.00\u201380.00", Assert.Single(ProjectMetric("""[{"speed":17}]""").Chart.Bars).Range);
        Assert.Equal("20.00\u201340.00", Assert.Single(Project("""[{"speed":17}]""", UnitPref.Imperial).Chart.Bars).Range);
    }

    [Fact]
    public void Project_label_precision_follows_the_units_precision()
    {
        // Web fmtNumber uses the global precision (_globalPrecision, default 2). A 0-precision pref drops the
        // fraction digits.
        var zeroPrec = Project("""[{"speed":5}]""", UnitPref.Metric with { Precision = 0 }).Chart;
        Assert.Equal("0\u201320", Assert.Single(zeroPrec.Bars).Range);
    }

    [Fact]
    public void Project_bar_automation_name_describes_range_and_percentage()
    {
        var chart = ProjectMetric(FiveSampleTrace).Chart;
        var bar = chart.Bars[2];
        Assert.Contains("80.00\u2013100.00", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("20%", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("of drive", bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_to_chart_series_carries_buckets_for_the_data_view()
    {
        var series = Assert.Single(ProjectMetric(FiveSampleTrace).ToChartSeries());
        Assert.Equal("% of drive", series.Name);
        Assert.Equal(3, series.Points.Count);
        Assert.Equal(60, series.Points[0].Y);
        Assert.Equal("0.00\u201320.00", series.Points[0].Label);
    }

    // ---- Projection: empty gate (speedHistData.length > 0) -------------------------

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = SpeedHistogramChartProjection.Empty(UnitPref.Metric, Localizer);
        Assert.False(display.HasData);
        Assert.Empty(display.Chart.Bars);
        Assert.Empty(display.ToChartSeries());
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(FiveSampleTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = SpeedHistogramChartResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(5, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, SpeedHistogramChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, SpeedHistogramChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = SpeedHistogramChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new SpeedHistogramChartViewModel(new FakeSource(), Localizer);
        Assert.Equal(SpeedHistogramChartState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_histogram()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Chart.Bars.Count);
    }

    [Fact]
    public async Task ViewModel_no_samples_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(
            Array.Empty<SpeedHistogramSample>(), Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(SpeedHistogramChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loading(),
            RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedHistogramChartState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(SpeedHistogramChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial_buckets()
    {
        // 17 m/s → metric bucket 3 (60-80), imperial bucket 1 (20-40).
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(
            ParseTrace("""[{"speed":17}]"""), Now));
        await vm.LoadAsync();
        Assert.Equal("60.00\u201380.00", vm.Display.Chart.Bars[0].Range);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("20.00\u201340.00", vm.Display.Chart.Bars[0].Range);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SpeedHistogramChartViewModel.State), changed);
        Assert.Contains(nameof(SpeedHistogramChartViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedHistogramSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Speed Histogram", vm.Title);
        Assert.Equal("Speed-bucket distribution histogram", vm.AriaLabel);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorTitle));
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
        using var telemetry = JsonDocument.Parse(FiveSampleTrace);

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement.Clone())
            .ReturnsValue(telemetry.RootElement.Clone());
        var source = new SpeedHistogramChartSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(5, emissions[^1].Value!.Count);
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
        using var telemetry = JsonDocument.Parse(FiveSampleTrace);
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement.Clone());
        var source = new SpeedHistogramChartSource(
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
        var source = new SpeedHistogramChartSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new SpeedHistogramChartSource(
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
        var source = new SpeedHistogramChartSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("speed-histogram-chart", SpeedHistogramChartRegistration.Id);
        Assert.Equal("SpeedHistogramChart", SpeedHistogramChartRegistration.Slug);
        Assert.Equal("Speed Histogram", SpeedHistogramChartRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedHistogramChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedHistogramChart", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SpeedHistogramChartDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static SpeedHistogramChartDisplay Project(string json, UnitPref units) =>
        SpeedHistogramChartProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<SpeedHistogramSample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return SpeedHistogramSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<SpeedHistogramSample> Trace() => ParseTrace(FiveSampleTrace);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static SpeedHistogramChartViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<SpeedHistogramSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<SpeedHistogramSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedHistogramSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SpeedHistogramSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<SpeedHistogramSample>>[] emissions)
        : ISpeedHistogramChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedHistogramSample>>> StreamAsync(
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
