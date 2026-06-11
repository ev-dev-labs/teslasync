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
/// Headless verification of the Trip-Replay Speed &amp; Power timeline surface's UI-thread-free logic — the
/// per-drive telemetry JSON parse adapter (timestamp / speed / power), the projection (minutes-since-start X,
/// SI→display speed conversion, kW power kept un-converted, per-axis bounds), the web <c>data.length &gt; 0</c>
/// empty gate, the <c>nearestIndexByTime</c> binary search, the cache-then-network result mapper, the
/// drive-resolving data source (explicit drive id, primary-vehicle → latest-drive chain, disabled-when-no-
/// vehicle short-circuit), the registry metadata, the PII-safe diagnostics, the Narrator labels, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline +
/// unit re-projection) and cursor-sync seek bridge (web <c>useSyncedCursor</c> / <c>ChartCursorBridge</c> /
/// <c>onSeekToIndex</c>). Mirrors the web spec (web/src/features/trips/components/TripReplayCharts.tsx +
/// pages/TripReplayPage.tsx).
/// </summary>
public sealed class TripReplayChartsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string ThreeSampleTrace =
        """
        [
          {"timestamp":"2026-04-04T10:00:00Z","speed":0,"power":-30},
          {"timestamp":"2026-04-04T10:01:00Z","speed":10,"power":45},
          {"timestamp":"2026-04-04T10:02:00Z","speed":20,"power":120}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_timestamp_speed_and_power()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:00:00Z","speed":12.5,"power":42.5}""");

        var s = TripReplaySample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(12.5, s.SpeedMps);
        Assert.Equal(42.5, s.PowerKw);
    }

    [Fact]
    public void FromJson_falls_back_to_created_at_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T11:00:00Z","speed":5}""");

        var s = TripReplaySample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(5, s.SpeedMps);
        Assert.Null(s.PowerKw);
    }

    [Fact]
    public void FromJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"speed":"7.5","power":"-12"}""");

        var s = TripReplaySample.FromJson(doc.RootElement);

        Assert.Equal(7.5, s.SpeedMps);
        Assert.Equal(-12, s.PowerKw);
        Assert.Null(s.TimestampUtc);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"power":1}, 7, {"power":2}]""");

        var list = TripReplaySample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].PowerKw);
        Assert.Equal(2, list[1].PowerKw);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"power":1}""");
        Assert.Empty(TripReplaySample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(ThreeSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Speed & Power Timeline", display.Title);
        Assert.Equal("Click to seek replay position", display.Subtitle);
        Assert.Equal("Trip replay speed and power timeline area chart", display.ChartAriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
    }

    [Fact]
    public void Project_series_names_and_axis_units_track_the_active_speed_unit()
    {
        var metric = ProjectMetric(ThreeSampleTrace).Timeline;
        Assert.Equal("Speed", metric.SpeedSeriesName);
        Assert.Equal("Power", metric.PowerSeriesName);
        Assert.Equal("km/h", metric.SpeedUnitLabel);
        Assert.Equal("kW", metric.PowerUnitLabel); // power is always kW

        var imperial = Project(ThreeSampleTrace, UnitPref.Imperial).Timeline;
        Assert.Equal("mph", imperial.SpeedUnitLabel);
        Assert.Equal("kW", imperial.PowerUnitLabel);
    }

    // ---- Projection: time / SI→display / axis bounds -------------------------------

    [Fact]
    public void Project_computes_minutes_since_trip_start_for_the_x_axis()
    {
        var points = ProjectMetric(ThreeSampleTrace).Timeline.Points;

        Assert.Equal(new[] { 0, 1, 2 }, points.Select(p => p.Index).ToArray());
        Assert.Equal(0.0, points[0].Time);
        Assert.Equal(1.0, points[1].Time);
        Assert.Equal(2.0, points[2].Time);
    }

    [Fact]
    public void Project_converts_speed_from_si_and_keeps_power_in_kw()
    {
        var metric = ProjectMetric(ThreeSampleTrace).Timeline;
        // speed 0 / 10 / 20 m/s → 0 / 36 / 72 km/h; power kept verbatim in kW (incl. regen −30).
        Assert.Equal(new[] { 0.0, 36.0, 72.0 }, metric.Points.Select(p => p.Speed).ToArray());
        Assert.Equal(new[] { -30.0, 45.0, 120.0 }, metric.Points.Select(p => p.Power).ToArray());

        var imperial = Project(ThreeSampleTrace, UnitPref.Imperial).Timeline;
        Assert.Equal(22.369, imperial.Points[1].Speed, 3); // 10 m/s ≈ 22.369 mph
        Assert.Equal(45.0, imperial.Points[1].Power);       // power independent of speed unit
    }

    [Fact]
    public void Project_exposes_axis_bounds_with_zero_anchored_speed_and_regen_aware_power()
    {
        var metric = ProjectMetric(ThreeSampleTrace).Timeline;

        Assert.Equal(72.0, metric.SpeedAxisMax);   // max display speed
        Assert.Equal(-30.0, metric.PowerAxisMin);  // regen low
        Assert.Equal(120.0, metric.PowerAxisMax);  // peak
    }

    [Fact]
    public void Project_speed_axis_max_falls_back_to_one_when_all_speeds_zero()
    {
        var timeline = ProjectMetric(
            """[{"timestamp":"2026-04-04T10:00:00Z","speed":0,"power":0},{"timestamp":"2026-04-04T10:01:00Z","speed":0,"power":0}]""")
            .Timeline;

        Assert.Equal(1.0, timeline.SpeedAxisMax); // avoids divide-by-zero in the ratio mapping
    }

    [Fact]
    public void Project_tolerates_missing_first_timestamp_without_producing_nan()
    {
        var points = ProjectMetric("""[{"speed":1,"power":2},{"speed":3,"power":4}]""").Timeline.Points;

        Assert.All(points, p => Assert.False(double.IsNaN(p.Time)));
        Assert.Equal(0.0, points[0].Time);
    }

    // ---- Projection: empty gate (web data.length > 0) ------------------------------

    [Fact]
    public void Project_empty_list_has_no_data()
    {
        Assert.False(TripReplayChartsProjection.Empty(UnitPref.Metric, Localizer).HasData);
    }

    [Fact]
    public void Project_single_sample_still_has_data()
    {
        // Web parity: the gate is data.length > 0, so even a one-sample trace renders the chart.
        var display = ProjectMetric("""[{"timestamp":"2026-04-04T10:00:00Z","speed":5,"power":9}]""");
        Assert.True(display.HasData);
        Assert.Single(display.Timeline.Points);
    }

    // ---- nearestIndexByTime --------------------------------------------------------

    [Fact]
    public void NearestIndexByTime_returns_exact_and_closest_neighbours()
    {
        var points = ProjectMetric(ThreeSampleTrace).Timeline.Points; // times 0, 1, 2

        Assert.Equal(1, TripReplayChartsProjection.NearestIndexByTime(points, 1.0)); // exact
        Assert.Equal(0, TripReplayChartsProjection.NearestIndexByTime(points, 0.4)); // nearer 0
        Assert.Equal(2, TripReplayChartsProjection.NearestIndexByTime(points, 1.6)); // nearer 2
    }

    [Fact]
    public void NearestIndexByTime_breaks_ties_towards_the_at_or_after_sample()
    {
        var points = ProjectMetric(ThreeSampleTrace).Timeline.Points; // times 0, 1, 2

        // 1.5 is equidistant from index 1 and 2; the web strict-< comparison keeps the at-or-after sample.
        Assert.Equal(2, TripReplayChartsProjection.NearestIndexByTime(points, 1.5));
    }

    [Fact]
    public void NearestIndexByTime_clamps_out_of_range_targets_to_the_ends()
    {
        var points = ProjectMetric(ThreeSampleTrace).Timeline.Points; // times 0, 1, 2

        Assert.Equal(0, TripReplayChartsProjection.NearestIndexByTime(points, -50));
        Assert.Equal(2, TripReplayChartsProjection.NearestIndexByTime(points, 999));
    }

    [Fact]
    public void NearestIndexByTime_empty_list_returns_zero()
    {
        Assert.Equal(0, TripReplayChartsProjection.NearestIndexByTime(Array.Empty<TripReplayChartPoint>(), 3));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void ResultMapper_cached_preserves_stale_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(ThreeSampleTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = TripReplayChartsResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(3, mapped.Value!.Count);
    }

    [Fact]
    public void ResultMapper_offline_preserves_payload()
    {
        using var doc = JsonDocument.Parse(ThreeSampleTrace);
        var offline = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = TripReplayChartsResultMapper.Map(offline);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(3, mapped.Value!.Count);
    }

    [Fact]
    public void ResultMapper_failure_carries_the_error()
    {
        var mapped = TripReplayChartsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, mapped.Status);
        Assert.Equal("boom", mapped.Error!.Message);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TripReplayChartsViewModel(new FakeSource(), Localizer);
        Assert.Equal(TripReplayChartsState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Timeline.Points.Count);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_samples_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(
            Array.Empty<TripReplaySample>(), Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TripReplaySample>>.Loading(),
            RepositoryResult<IReadOnlyList<TripReplaySample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TripReplayChartsState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(TripReplayChartsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_speed_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal("km/h", vm.Display.Timeline.SpeedUnitLabel);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mph", vm.Display.Timeline.SpeedUnitLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TripReplayChartsViewModel.State), changed);
        Assert.Contains(nameof(TripReplayChartsViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Speed & Power Timeline", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.Subtitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.ChartAriaLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- View-model cursor-sync seek bridge ----------------------------------------

    [Fact]
    public async Task ViewModel_cursor_move_seeks_to_nearest_sample_and_raises_event()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        var seeks = new List<int>();
        vm.SeekToIndexRequested += (_, idx) => seeks.Add(idx);

        vm.CursorSync.SetCursor(2.0); // nearest the sample at minute 2 → index 2

        Assert.Equal(new[] { 2 }, seeks.ToArray());
        Assert.Equal(2, vm.CurrentIndex);
    }

    [Fact]
    public async Task ViewModel_cursor_dedupes_repeated_positions_for_the_same_index()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        var seeks = new List<int>();
        vm.SeekToIndexRequested += (_, idx) => seeks.Add(idx);

        vm.CursorSync.SetCursor(1.0);
        vm.CursorSync.SetCursor(1.05); // still nearest index 1 → no second forward
        vm.CursorSync.SetCursor(2.0);  // now index 2

        Assert.Equal(new[] { 1, 2 }, seeks.ToArray());
    }

    [Fact]
    public async Task ViewModel_cursor_clear_does_not_seek()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        var seeks = new List<int>();
        vm.SeekToIndexRequested += (_, idx) => seeks.Add(idx);

        vm.CursorSync.SetCursor(1.0);
        vm.CursorSync.Clear();

        Assert.Equal(new[] { 1 }, seeks.ToArray());
    }

    [Fact]
    public async Task ViewModel_host_seekTo_moves_playhead_without_raising_event()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        var seeks = new List<int>();
        vm.SeekToIndexRequested += (_, idx) => seeks.Add(idx);

        vm.SeekTo(2);
        Assert.Equal(2, vm.CurrentIndex);

        vm.SeekTo(99); // clamped to the last sample
        Assert.Equal(2, vm.CurrentIndex);

        Assert.Empty(seeks); // host-driven seeks never echo back through onSeekToIndex
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_chains_drive_list_latest_telemetry()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":11,"start_ts":"2026-04-01T08:00:00Z"},{"id":55,"start_ts":"2026-04-04T10:00:00Z"}]""");
        using var telemetry = JsonDocument.Parse(ThreeSampleTrace);

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement.Clone())
            .ReturnsValue(telemetry.RootElement.Clone());
        var source = new TripReplayChartsSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);
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
        using var telemetry = JsonDocument.Parse(ThreeSampleTrace);
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement.Clone());
        var source = new TripReplayChartsSource(
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
        var source = new TripReplayChartsSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new TripReplayChartsSource(
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
        var source = new TripReplayChartsSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics + a11y labels ----------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("trip-replay-charts", TripReplayChartsRegistration.Id);
        Assert.Equal("TripReplayCharts", TripReplayChartsRegistration.Slug);
        Assert.Equal("Speed & Power Timeline", TripReplayChartsRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TripReplayChartsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripReplayCharts", Assert.Single(lines));
    }

    [Fact]
    public void Accessibility_labels_are_present_on_chart_and_series()
    {
        var display = ProjectMetric(ThreeSampleTrace);

        // The chart carries a spoken summary and every series / unit label resolves through i18n.
        Assert.False(string.IsNullOrWhiteSpace(display.ChartAriaLabel));
        Assert.False(string.IsNullOrWhiteSpace(display.Timeline.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Timeline.SpeedSeriesName));
        Assert.False(string.IsNullOrWhiteSpace(display.Timeline.PowerSeriesName));
        Assert.Contains("3", display.Timeline.AutomationName); // sample count surfaced for Narrator
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TripReplayChartsDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static TripReplayChartsDisplay Project(string json, UnitPref units) =>
        TripReplayChartsProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<TripReplaySample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return TripReplaySample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<TripReplaySample> Trace() => ParseTrace(ThreeSampleTrace);

    private static TripReplayChartsViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<TripReplaySample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<TripReplaySample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripReplaySample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TripReplaySample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<TripReplaySample>>[] emissions)
        : ITripReplayChartsSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripReplaySample>>> StreamAsync(
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
