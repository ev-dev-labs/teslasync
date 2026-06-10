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
/// Headless verification of the drive-detail Tire-Pressure surface's UI-thread-free logic — the per-drive
/// telemetry JSON parse adapter (the four corner pressures + timestamp), the SI Pascals → kilopascals →
/// display conversion, the conditional line-series gates (web <c>chartData.some(d =&gt; d.tireFl !== null)</c>),
/// the always-four per-corner min–max stat tiles (over readings <c>&gt; 0</c>, em dash otherwise), the
/// <c>stats.hasTirePressure</c> empty gate, the cache-then-network result mapper, the drive-resolving data
/// source (explicit drive id, primary-vehicle → latest-drive chain, disabled-when-no-vehicle short-circuit),
/// the registry metadata, the PII-safe diagnostics, the Narrator automation names and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline + unit
/// re-projection). Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/TirePressureSection.tsx + useDriveDetailData.ts).
/// </summary>
public sealed class TirePressureSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // 1 psi = 6.894757 kPa (NIST SP 811) — the same display constant the converter uses.
    private const double KpaPerPsi = 6.894757;

    private const string TwoSampleTrace =
        """
        [
          {"timestamp":"2026-04-04T10:00:00Z","tire_pressure_fl":290000,"tire_pressure_fr":295000,"tire_pressure_rl":300000,"tire_pressure_rr":305000},
          {"timestamp":"2026-04-04T10:01:00Z","tire_pressure_fl":294000,"tire_pressure_fr":297000,"tire_pressure_rl":302000,"tire_pressure_rr":307000}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_corner_field()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:00:00Z","tire_pressure_fl":290000,"tire_pressure_fr":295000,"tire_pressure_rl":300000,"tire_pressure_rr":305000}""");

        var s = TirePressureSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(290000, s.FrontLeftPa);
        Assert.Equal(295000, s.FrontRightPa);
        Assert.Equal(300000, s.RearLeftPa);
        Assert.Equal(305000, s.RearRightPa);
    }

    [Fact]
    public void FromJson_falls_back_to_created_at_and_tolerates_missing_corners()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T11:00:00Z","tire_pressure_fl":288000}""");

        var s = TirePressureSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(288000, s.FrontLeftPa);
        Assert.Null(s.FrontRightPa);
        Assert.Null(s.RearLeftPa);
        Assert.Null(s.RearRightPa);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"tire_pressure_fl":1000}, 7, {"tire_pressure_fl":2000}]""");

        var list = TirePressureSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1000, list[0].FrontLeftPa);
        Assert.Equal(2000, list[1].FrontLeftPa);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"tire_pressure_fl":1000}""");
        Assert.Empty(TirePressureSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(TwoSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Tire Pressure During Drive", display.Title);
        Assert.Equal(
            "Front and rear tire pressure lines over the drive timeline",
            display.ChartAriaLabel);
        Assert.Equal("No telemetry data available", display.EmptyMessage);
    }

    // ---- Projection: SI Pascals → kPa → display ------------------------------------

    [Fact]
    public void Project_divides_pascals_to_kilopascals_in_metric()
    {
        var fl = SeriesByKey(ProjectMetric(TwoSampleTrace), "fl");

        // 290000 Pa / 1000 = 290 kPa (metric is identity).
        Assert.Equal(290, fl.Points[0].ValueDisplay, 3);
        Assert.Equal(294, fl.Points[1].ValueDisplay, 3);
        Assert.EndsWith("(kPa)", fl.Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_converts_to_psi_in_imperial()
    {
        var fl = SeriesByKey(Project(TwoSampleTrace, UnitPref.Imperial), "fl");

        Assert.Equal(290.0 / KpaPerPsi, fl.Points[0].ValueDisplay, 3); // 290 kPa → ~42.06 psi
        Assert.Equal(294.0 / KpaPerPsi, fl.Points[1].ValueDisplay, 3);
        Assert.EndsWith("(psi)", fl.Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_time_labels_use_24h_local_clock()
    {
        var fl = SeriesByKey(ProjectMetric(TwoSampleTrace), "fl");
        Assert.Equal(2, fl.Points.Count);
        Assert.Matches(@"^\d{2}:\d{2}$", fl.Points[0].TimeLabel);
    }

    // ---- Projection: line series present-corner gates ------------------------------

    [Fact]
    public void Project_lists_all_four_series_in_web_order_with_palette_indices()
    {
        var series = ProjectMetric(TwoSampleTrace).Series;

        Assert.Equal(new[] { "fl", "fr", "rl", "rr" }, series.Select(s => s.Key).ToArray());
        Assert.Equal(TirePressureSectionProjection.FrontLeftColorIndex, series[0].ColorIndex);
        Assert.Equal(TirePressureSectionProjection.FrontRightColorIndex, series[1].ColorIndex);
        Assert.Equal(TirePressureSectionProjection.RearLeftColorIndex, series[2].ColorIndex);
        Assert.Equal(TirePressureSectionProjection.RearRightColorIndex, series[3].ColorIndex);
    }

    [Fact]
    public void Project_omits_series_for_corners_without_samples()
    {
        // Only FL + FR present → RL / RR series are dropped (web conditional <Line>).
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","tire_pressure_fl":290000,"tire_pressure_fr":295000},
              {"timestamp":"2026-04-04T10:01:00Z","tire_pressure_fl":294000,"tire_pressure_fr":297000}
            ]
            """);

        Assert.Equal(new[] { "fl", "fr" }, display.Series.Select(s => s.Key).ToArray());
        Assert.DoesNotContain(display.Series, s => s.Key is "rl" or "rr");
    }

    [Fact]
    public void Project_single_sample_single_corner_is_plottable()
    {
        // Web parity: hasTirePressure is NOT gated on a minimum sample count (unlike the temperature chart).
        var display = ProjectMetric("""[{"timestamp":"2026-04-04T10:00:00Z","tire_pressure_rr":301000}]""");

        Assert.True(display.HasData);
        Assert.Equal("rr", Assert.Single(display.Series).Key);
        Assert.Equal(4, display.Tiles.Count);
    }

    // ---- Projection: stat tiles ----------------------------------------------------

    [Fact]
    public void Project_always_builds_four_tiles_in_web_order()
    {
        var tiles = ProjectMetric(TwoSampleTrace).Tiles;

        Assert.Equal(
            new[] { "Front Left", "Front Right", "Rear Left", "Rear Right" },
            tiles.Select(t => t.Label).ToArray());
    }

    [Fact]
    public void Project_tiles_show_min_max_range_in_display_units()
    {
        var tiles = ProjectMetric(TwoSampleTrace).Tiles;

        var fl = TileByLabel(tiles, "Front Left");
        Assert.Equal("290.0\u2013294.0", fl.Value); // en dash between min and max
        Assert.Equal("kPa", fl.Unit);

        Assert.Equal("295.0\u2013297.0", TileByLabel(tiles, "Front Right").Value);
        Assert.Equal("300.0\u2013302.0", TileByLabel(tiles, "Rear Left").Value);
        Assert.Equal("305.0\u2013307.0", TileByLabel(tiles, "Rear Right").Value);
    }

    [Fact]
    public void Project_tile_for_corner_without_positive_readings_shows_em_dash()
    {
        // RR present on the chart (non-null) but only as zero → no positive reading → tile em dash, series kept.
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","tire_pressure_fl":290000,"tire_pressure_rr":0},
              {"timestamp":"2026-04-04T10:01:00Z","tire_pressure_fl":294000,"tire_pressure_rr":0}
            ]
            """);

        var rr = TileByLabel(display.Tiles, "Rear Right");
        Assert.Equal("\u2014", rr.Value);
        Assert.Equal(string.Empty, rr.Unit);

        // The line is still drawn for a non-null (zero) corner — web keeps `some(d => d.tireRr !== null)`.
        Assert.Contains(display.Series, s => s.Key == "rr");
    }

    [Fact]
    public void Project_tile_for_absent_corner_shows_em_dash()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","tire_pressure_fl":290000},
              {"timestamp":"2026-04-04T10:01:00Z","tire_pressure_fl":294000}
            ]
            """);

        var rl = TileByLabel(display.Tiles, "Rear Left");
        Assert.Equal("\u2014", rl.Value);
        Assert.DoesNotContain(display.Series, s => s.Key == "rl");
    }

    [Fact]
    public void Project_tiles_convert_to_psi_in_imperial()
    {
        var fl = TileByLabel(Project(TwoSampleTrace, UnitPref.Imperial).Tiles, "Front Left");

        // 290 kPa → 42.0613 psi, 294 kPa → 42.6414 psi (each rounded to one decimal).
        string min = (290.0 / KpaPerPsi).ToString("0.0", CultureInfo.InvariantCulture);
        string max = (294.0 / KpaPerPsi).ToString("0.0", CultureInfo.InvariantCulture);
        Assert.Equal($"{min}\u2013{max}", fl.Value);
        Assert.Equal("psi", fl.Unit);
    }

    // ---- Projection: empty gate (stats.hasTirePressure) ----------------------------

    [Fact]
    public void Project_trace_without_any_tire_pressure_is_not_plottable()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z"},
              {"timestamp":"2026-04-04T10:01:00Z"}
            ]
            """);

        Assert.False(display.HasData);
        Assert.Empty(display.Series);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = TirePressureSectionProjection.Empty(UnitPref.Metric, Localizer);
        Assert.False(display.HasData);
        Assert.Empty(display.Series);
        Assert.Empty(display.Tiles);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_series_and_tiles_carry_narrator_automation_names()
    {
        var display = ProjectMetric(TwoSampleTrace);

        Assert.All(display.Series, s => Assert.False(string.IsNullOrWhiteSpace(s.AutomationName)));
        Assert.All(display.Tiles, t =>
        {
            Assert.False(string.IsNullOrWhiteSpace(t.AutomationName));
            Assert.Contains(t.Label, t.AutomationName, StringComparison.Ordinal);
        });
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(TwoSampleTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = TirePressureSectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(2, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = TirePressureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TirePressureSectionViewModel(new FakeSource(), Localizer);
        Assert.Equal(TirePressureSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Series.Count);
    }

    [Fact]
    public async Task ViewModel_trace_without_pressure_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(
            ParseTrace("""[{"timestamp":"2026-04-04T10:00:00Z"}]"""), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(TirePressureSectionState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Loading(),
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(TirePressureSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.EndsWith("(kPa)", SeriesByKey(vm.Display, "fl").Label, StringComparison.Ordinal);

        vm.Units = UnitPref.Imperial;

        Assert.EndsWith("(psi)", SeriesByKey(vm.Display, "fl").Label, StringComparison.Ordinal);
        Assert.Equal("psi", TileByLabel(vm.Display.Tiles, "Front Left").Unit);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TirePressureSectionViewModel.State), changed);
        Assert.Contains(nameof(TirePressureSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Tire Pressure During Drive", vm.Title);
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
        var source = new TirePressureSectionSource(
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
        var source = new TirePressureSectionSource(
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
        var source = new TirePressureSectionSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new TirePressureSectionSource(
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
        var source = new TirePressureSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("tire-pressure-section", TirePressureSectionRegistration.Id);
        Assert.Equal("TirePressureSection", TirePressureSectionRegistration.Slug);
        Assert.Equal("Tire Pressure During Drive", TirePressureSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressureSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressureSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TirePressureSectionDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static TirePressureSectionDisplay Project(string json, UnitPref units) =>
        TirePressureSectionProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<TirePressureSample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return TirePressureSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<TirePressureSample> Trace() => ParseTrace(TwoSampleTrace);

    private static TirePressureSectionSeries SeriesByKey(TirePressureSectionDisplay display, string key) =>
        Assert.Single(display.Series, s => s.Key == key);

    private static TirePressureSectionTile TileByLabel(IReadOnlyList<TirePressureSectionTile> tiles, string label) =>
        Assert.Single(tiles, t => t.Label == label);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static TirePressureSectionViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<TirePressureSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<TirePressureSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<TirePressureSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TirePressureSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<TirePressureSample>>[] emissions)
        : ITirePressureSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TirePressureSample>>> StreamAsync(
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
