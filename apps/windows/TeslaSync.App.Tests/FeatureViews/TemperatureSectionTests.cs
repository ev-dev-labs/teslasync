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
/// Headless verification of the drive-detail Temperatures surface's UI-thread-free logic — the per-drive
/// telemetry JSON parse adapter (outside / inside / driver / passenger temperature + climate flag + fan
/// status), the SI Celsius → display conversion, the conditional line-series gates
/// (web <c>stats.outsideTemps.length &gt; 0</c>), the per-channel average / climate-status / fan avg-max stat
/// tiles, the <c>chartData.length &gt; 1 &amp;&amp; stats.hasAnyTemp</c> empty gate, the cache-then-network
/// result mapper, the drive-resolving data source (explicit drive id, primary-vehicle → latest-drive chain,
/// disabled-when-no-vehicle short-circuit), the registry metadata, the PII-safe diagnostics, the Narrator
/// automation names and the state-holder view-model's per-state transitions (loading / loaded / empty / error
/// / stale / offline + unit re-projection). Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/TemperatureSection.tsx + useDriveDetailData.ts).
/// </summary>
public sealed class TemperatureSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string TwoSampleTrace =
        """
        [
          {"timestamp":"2026-04-04T10:00:00Z","outside_temp":10,"inside_temp":22,"driver_temp":21,"passenger_temp":20,"is_climate_on":true,"fan_status":3},
          {"timestamp":"2026-04-04T10:01:00Z","outside_temp":12,"inside_temp":23,"driver_temp":21,"passenger_temp":20,"is_climate_on":true,"fan_status":5}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_temperature_field()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:00:00Z","outside_temp":9.5,"inside_temp":21.5,"driver_temp":20,"passenger_temp":19,"is_climate_on":true,"fan_status":4}""");

        var s = TemperatureSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(9.5, s.OutsideTempC);
        Assert.Equal(21.5, s.InsideTempC);
        Assert.Equal(20, s.DriverTempC);
        Assert.Equal(19, s.PassengerTempC);
        Assert.True(s.ClimateOn);
        Assert.Equal(4, s.FanStatus);
    }

    [Fact]
    public void FromJson_falls_back_to_created_at_and_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T11:00:00Z","inside_temp":18}""");

        var s = TemperatureSample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 11, 0, 0, TimeSpan.Zero), s.TimestampUtc);
        Assert.Equal(18, s.InsideTempC);
        Assert.Null(s.OutsideTempC);
        Assert.Null(s.DriverTempC);
        Assert.Null(s.ClimateOn);
        Assert.Null(s.FanStatus);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"inside_temp":1}, 7, {"inside_temp":2}]""");

        var list = TemperatureSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].InsideTempC);
        Assert.Equal(2, list[1].InsideTempC);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"inside_temp":1}""");
        Assert.Empty(TemperatureSample.ParseList(doc.RootElement));
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = ProjectMetric(TwoSampleTrace);

        Assert.True(display.HasData);
        Assert.Equal("Temperatures", display.Title);
        Assert.Equal(
            "Inside, outside, driver and passenger temperature lines over the drive timeline",
            display.ChartAriaLabel);
        Assert.Equal("No temperature telemetry is available for this drive.", display.EmptyMessage);
    }

    // ---- Projection: SI Celsius → display ------------------------------------------

    [Fact]
    public void Project_keeps_celsius_in_metric_and_converts_to_fahrenheit_in_imperial()
    {
        var metric = ProjectMetric(TwoSampleTrace);
        var outsideMetric = SeriesByKey(metric, "outside");
        Assert.Equal(10, outsideMetric.Points[0].ValueDisplay, 3);
        Assert.Equal(12, outsideMetric.Points[1].ValueDisplay, 3);
        Assert.EndsWith("\u00B0C", outsideMetric.Label, StringComparison.Ordinal);

        var imperial = Project(TwoSampleTrace, UnitPref.Imperial);
        var outsideImperial = SeriesByKey(imperial, "outside");
        Assert.Equal(50, outsideImperial.Points[0].ValueDisplay, 3); // 10 °C → 50 °F
        Assert.Equal(53.6, outsideImperial.Points[1].ValueDisplay, 3); // 12 °C → 53.6 °F
        Assert.EndsWith("\u00B0F", outsideImperial.Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_time_labels_use_24h_local_clock()
    {
        var outside = SeriesByKey(ProjectMetric(TwoSampleTrace), "outside");
        Assert.Equal(2, outside.Points.Count);
        Assert.Matches(@"^\d{2}:\d{2}$", outside.Points[0].TimeLabel);
    }

    // ---- Projection: line series present-channel gates -----------------------------

    [Fact]
    public void Project_lists_all_four_series_in_web_order_with_palette_indices()
    {
        var series = ProjectMetric(TwoSampleTrace).Series;

        Assert.Equal(new[] { "outside", "inside", "driver", "passenger" }, series.Select(s => s.Key).ToArray());
        Assert.Equal(TemperatureSectionProjection.OutsideColorIndex, series[0].ColorIndex);
        Assert.Equal(TemperatureSectionProjection.InsideColorIndex, series[1].ColorIndex);
        Assert.Equal(TemperatureSectionProjection.DriverColorIndex, series[2].ColorIndex);
        Assert.Equal(TemperatureSectionProjection.PassengerColorIndex, series[3].ColorIndex);
    }

    [Fact]
    public void Project_omits_series_for_channels_without_samples()
    {
        // Only outside + inside present → driver / passenger series are dropped (web conditional <Line>).
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","outside_temp":10,"inside_temp":22},
              {"timestamp":"2026-04-04T10:01:00Z","outside_temp":12,"inside_temp":23}
            ]
            """);

        Assert.Equal(new[] { "outside", "inside" }, display.Series.Select(s => s.Key).ToArray());
        Assert.DoesNotContain(display.Series, s => s.Key is "driver" or "passenger");
    }

    // ---- Projection: stat tiles ----------------------------------------------------

    [Fact]
    public void Project_builds_all_six_tiles_in_web_order()
    {
        var tiles = ProjectMetric(TwoSampleTrace).Tiles;

        Assert.Equal(
            new[]
            {
                "Outside Temperature", "Inside Temperature", "Driver Temperature",
                "Passenger Temperature", "Climate", "Fan Status",
            },
            tiles.Select(t => t.Label).ToArray());
    }

    [Fact]
    public void Project_temperature_tiles_average_in_display_units()
    {
        var tiles = ProjectMetric(TwoSampleTrace).Tiles;

        var outside = TileByLabel(tiles, "Outside Temperature");
        Assert.Equal("11.0", outside.Value); // (10 + 12) / 2
        Assert.Equal("\u00B0C", outside.Unit);

        Assert.Equal("22.5", TileByLabel(tiles, "Inside Temperature").Value); // (22 + 23) / 2
        Assert.Equal("21.0", TileByLabel(tiles, "Driver Temperature").Value);
        Assert.Equal("20.0", TileByLabel(tiles, "Passenger Temperature").Value);
    }

    [Fact]
    public void Project_temperature_tiles_convert_to_fahrenheit()
    {
        var tiles = Project(TwoSampleTrace, UnitPref.Imperial).Tiles;
        var outside = TileByLabel(tiles, "Outside Temperature");
        Assert.Equal("51.8", outside.Value); // (50 + 53.6) / 2
        Assert.Equal("\u00B0F", outside.Unit);
    }

    [Fact]
    public void Project_climate_tile_reports_on_when_mostly_on()
    {
        var climate = TileByLabel(ProjectMetric(TwoSampleTrace).Tiles, "Climate");
        Assert.Equal("On", climate.Value);
        Assert.Equal(string.Empty, climate.Unit);
    }

    [Fact]
    public void Project_climate_tile_reports_mostly_off_when_off_dominates()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","outside_temp":10,"is_climate_on":true},
              {"timestamp":"2026-04-04T10:01:00Z","outside_temp":11,"is_climate_on":false},
              {"timestamp":"2026-04-04T10:02:00Z","outside_temp":12,"is_climate_on":false}
            ]
            """);

        Assert.Equal("Mostly Off", TileByLabel(display.Tiles, "Climate").Value);
    }

    [Fact]
    public void Project_climate_tile_reports_off_when_never_on()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","outside_temp":10,"is_climate_on":false},
              {"timestamp":"2026-04-04T10:01:00Z","outside_temp":11,"is_climate_on":false}
            ]
            """);

        Assert.Equal("Off", TileByLabel(display.Tiles, "Climate").Value);
    }

    [Fact]
    public void Project_omits_climate_tile_without_climate_samples()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","outside_temp":10},
              {"timestamp":"2026-04-04T10:01:00Z","outside_temp":12}
            ]
            """);

        Assert.DoesNotContain(display.Tiles, t => t.Label == "Climate");
    }

    [Fact]
    public void Project_fan_tile_reports_avg_and_max()
    {
        var fan = TileByLabel(ProjectMetric(TwoSampleTrace).Tiles, "Fan Status");
        // Web: `${t('avg')} ${fmtInt(avg)} · Max ${max}` → "Avg 4 · Max 5".
        Assert.Equal("Avg 4 \u00B7 Max 5", fan.Value);
        Assert.Equal(string.Empty, fan.Unit);
    }

    [Fact]
    public void Project_omits_fan_tile_without_fan_samples()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","inside_temp":21},
              {"timestamp":"2026-04-04T10:01:00Z","inside_temp":22}
            ]
            """);

        Assert.DoesNotContain(display.Tiles, t => t.Label == "Fan Status");
    }

    // ---- Projection: empty gate (chartData.length > 1 && hasAnyTemp) ----------------

    [Fact]
    public void Project_single_sample_is_not_plottable()
    {
        var display = ProjectMetric("""[{"timestamp":"2026-04-04T10:00:00Z","inside_temp":22}]""");

        Assert.False(display.HasData);
        Assert.Empty(display.Series);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Project_trace_without_any_temperature_is_not_plottable()
    {
        // Two samples but no temperature channel → hasAnyTemp false → empty (web gate).
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","is_climate_on":true,"fan_status":3},
              {"timestamp":"2026-04-04T10:01:00Z","is_climate_on":true,"fan_status":4}
            ]
            """);

        Assert.False(display.HasData);
        Assert.Empty(display.Series);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Project_single_channel_two_samples_is_plottable()
    {
        var display = ProjectMetric(
            """
            [
              {"timestamp":"2026-04-04T10:00:00Z","driver_temp":21},
              {"timestamp":"2026-04-04T10:01:00Z","driver_temp":22}
            ]
            """);

        Assert.True(display.HasData);
        Assert.Equal("driver", Assert.Single(display.Series).Key);
        Assert.Equal("Driver Temperature", Assert.Single(display.Tiles).Label);
    }

    [Fact]
    public void Project_empty_samples_reports_no_data()
    {
        var display = TemperatureSectionProjection.Empty(UnitPref.Metric, Localizer);
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

        var mapped = TemperatureSectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(2, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, TemperatureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, TemperatureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = TemperatureSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TemperatureSectionViewModel(new FakeSource(), Localizer);
        Assert.Equal(TemperatureSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Series.Count);
    }

    [Fact]
    public async Task ViewModel_short_trace_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(
            ParseTrace("""[{"timestamp":"2026-04-04T10:00:00Z","inside_temp":22}]"""), Now));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No temperature telemetry is available for this drive.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(TemperatureSectionState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TemperatureSample>>.Loading(),
            RepositoryResult<IReadOnlyList<TemperatureSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(TemperatureSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(TemperatureSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_into_imperial()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.EndsWith("\u00B0C", SeriesByKey(vm.Display, "outside").Label, StringComparison.Ordinal);

        vm.Units = UnitPref.Imperial;

        Assert.EndsWith("\u00B0F", SeriesByKey(vm.Display, "outside").Label, StringComparison.Ordinal);
        Assert.Equal("51.8", TileByLabel(vm.Display.Tiles, "Outside Temperature").Value);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TemperatureSectionViewModel.State), changed);
        Assert.Contains(nameof(TemperatureSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TemperatureSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Temperatures", vm.Title);
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
        var source = new TemperatureSectionSource(
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
        var source = new TemperatureSectionSource(
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
        var source = new TemperatureSectionSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new TemperatureSectionSource(
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
        var source = new TemperatureSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), driveId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("temperature-section", TemperatureSectionRegistration.Id);
        Assert.Equal("TemperatureSection", TemperatureSectionRegistration.Slug);
        Assert.Equal("Temperatures", TemperatureSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TemperatureSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemperatureSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TemperatureSectionDisplay ProjectMetric(string json) => Project(json, UnitPref.Metric);

    private static TemperatureSectionDisplay Project(string json, UnitPref units) =>
        TemperatureSectionProjection.Project(ParseTrace(json), units, Localizer);

    private static IReadOnlyList<TemperatureSample> ParseTrace(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return TemperatureSample.ParseList(doc.RootElement);
    }

    private static IReadOnlyList<TemperatureSample> Trace() => ParseTrace(TwoSampleTrace);

    private static TemperatureSectionSeries SeriesByKey(TemperatureSectionDisplay display, string key) =>
        Assert.Single(display.Series, s => s.Key == key);

    private static TemperatureSectionTile TileByLabel(IReadOnlyList<TemperatureSectionTile> tiles, string label) =>
        Assert.Single(tiles, t => t.Label == label);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static TemperatureSectionViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<TemperatureSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<TemperatureSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<TemperatureSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TemperatureSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<TemperatureSample>>[] emissions)
        : ITemperatureSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TemperatureSample>>> StreamAsync(
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
