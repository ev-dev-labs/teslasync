using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the BatteryCellsWidget's UI-thread-free logic — the JSON parse adapter (summary
/// + per-cell), the cell-status threshold helper, the heatmap/stat projection across the compact / standard
/// / wide footprints, the cache-then-network result mapper, the per-vehicle data source (primary resolution +
/// path-scoped request), the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/BatteryCellsWidget.tsx).
/// </summary>
public sealed class BatteryCellsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static BatteryCell Cell(int id, int module, double? voltage, double? temperature) =>
        new(id, module, voltage, temperature);

    private static BatteryCellSummary Summary(
        double avgV = 3.700,
        double minV = 3.650,
        double maxV = 3.750,
        double spread = 0.012,
        double avgTemp = 25,
        double minTemp = 22,
        double maxTemp = 28,
        double tempSpread = 6,
        int total = 2,
        IReadOnlyList<BatteryCell>? cells = null) =>
        new(avgV, minV, maxV, spread, avgTemp, minTemp, maxTemp, tempSpread, total,
            cells ?? new[] { Cell(1, 0, 3.700, 25), Cell(2, 1, 3.710, 26) });

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void SummaryFromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_cells":96,"avg_voltage":3.7,"min_voltage":3.65,"max_voltage":3.75,
         "voltage_spread":0.012,"avg_temperature":25.5,"min_temperature":22.1,
         "max_temperature":28.9,"temp_spread":6.8,
         "cells":[{"cell_id":1,"module":0,"voltage":3.70,"temperature":25.0}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var summary = BatteryCellSummary.FromJson(doc.RootElement);

        Assert.Equal(96, summary.TotalCells);
        Assert.Equal(3.7, summary.AvgVoltage);
        Assert.Equal(3.65, summary.MinVoltage);
        Assert.Equal(3.75, summary.MaxVoltage);
        Assert.Equal(0.012, summary.VoltageSpread);
        Assert.Equal(25.5, summary.AvgTemperature);
        Assert.Equal(22.1, summary.MinTemperature);
        Assert.Equal(28.9, summary.MaxTemperature);
        Assert.Equal(6.8, summary.TempSpread);

        var cell = Assert.Single(summary.Cells);
        Assert.Equal(1, cell.CellId);
        Assert.Equal(0, cell.Module);
        Assert.Equal(3.70, cell.Voltage);
        Assert.Equal(25.0, cell.Temperature);
    }

    [Fact]
    public void SummaryFromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"avg_voltage":3.7}""");

        var summary = BatteryCellSummary.FromJson(doc.RootElement);

        Assert.Equal(3.7, summary.AvgVoltage);
        Assert.Equal(0, summary.MinVoltage);
        Assert.Equal(0, summary.MaxVoltage);
        Assert.Equal(0, summary.TotalCells);
        Assert.Empty(summary.Cells);
    }

    [Fact]
    public void SummaryFromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var summary = BatteryCellSummary.FromJson(doc.RootElement);
        Assert.Equal(0, summary.AvgVoltage);
        Assert.Empty(summary.Cells);
    }

    [Fact]
    public void CellFromJson_leaves_missing_voltage_null_for_unknown_status()
    {
        using var doc = JsonDocument.Parse("""{"cell_id":4,"module":2}""");

        var cell = BatteryCell.FromJson(doc.RootElement);

        Assert.Equal(4, cell.CellId);
        Assert.Equal(2, cell.Module);
        Assert.Null(cell.Voltage);
        Assert.Null(cell.Temperature);
    }

    // ---- Cell status thresholds (web cellStatus) -----------------------------------

    [Theory]
    [InlineData(3.000, BatteryCellSeverity.Ok)]      // dev 0 mV
    [InlineData(3.004, BatteryCellSeverity.Ok)]      // dev ~4 mV
    [InlineData(3.010, BatteryCellSeverity.Warning)] // dev ~10 mV
    [InlineData(3.020, BatteryCellSeverity.Error)]   // dev ~20 mV
    public void SeverityFor_classifies_by_deviation(double voltage, BatteryCellSeverity expected) =>
        Assert.Equal(expected, BatteryCellsProjection.SeverityFor(voltage, 3.000));

    [Fact]
    public void SeverityFor_null_voltage_is_unknown() =>
        Assert.Equal(BatteryCellSeverity.Unknown, BatteryCellsProjection.SeverityFor(null, 3.000));

    [Theory]
    [InlineData(BatteryCellSeverity.Ok, "TsColorSuccessBrush")]
    [InlineData(BatteryCellSeverity.Warning, "TsColorWarningBrush")]
    [InlineData(BatteryCellSeverity.Error, "TsColorDangerBrush")]
    [InlineData(BatteryCellSeverity.Unknown, "TsColorTextSecondaryBrush")]
    public void Severity_maps_to_themed_status_brush(BatteryCellSeverity severity, string brushKey) =>
        Assert.Equal(brushKey, TeslaSync.App.Core.StatusResources.AccentBrushKey(
            BatteryCellsProjection.ToStatusKind(severity)));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(5, BatteryCellsProjection.OkThresholdMv);
        Assert.Equal(15, BatteryCellsProjection.WarningThresholdMv);
    }

    // ---- Size / footprint flags (web isCompact / isWide / cols) --------------------

    [Theory]
    [InlineData(1, 4, true, false, 2)]   // compact -> 2-up
    [InlineData(2, 4, false, false, 3)]  // standard -> 3-up
    [InlineData(3, 4, false, true, 4)]   // wide -> 4-up
    [InlineData(4, 40, false, true, 4)]  // wide (max)
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide, int gridCols)
    {
        var size = new BatteryCellsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Projection (standard, 2x4) ------------------------------------------------

    [Fact]
    public void Project_standard_formats_cells_and_voltage_stats()
    {
        var view = BatteryCellsProjection.Project(Summary(), new BatteryCellsSize(2, 4), Localizer);

        Assert.False(view.IsWide);
        Assert.Equal(3, view.GridColumns);
        Assert.False(view.ShowTemperature);
        Assert.Empty(view.TemperatureStats);

        Assert.Equal(2, view.Cells.Count);
        Assert.Equal("C1", view.Cells[0].Label);
        Assert.Equal("3.700 V", view.Cells[0].Value);
        Assert.Equal(BatteryCellSeverity.Ok, view.Cells[0].Severity);   // 3.700 vs avg 3.700
        Assert.Equal("C2", view.Cells[1].Label);
        Assert.Equal(BatteryCellSeverity.Warning, view.Cells[1].Severity); // 3.710 -> 10 mV

        Assert.Equal(4, view.VoltageStats.Count);
        Assert.Equal("Min V", view.VoltageStats[0].Label);
        Assert.Equal("3.650 V", view.VoltageStats[0].Value);
        Assert.Equal("Max V", view.VoltageStats[1].Label);
        Assert.Equal("3.750 V", view.VoltageStats[1].Value);
        Assert.Equal("Avg V", view.VoltageStats[2].Label);
        Assert.Equal("3.700 V", view.VoltageStats[2].Value);
        Assert.Equal("Spread", view.VoltageStats[3].Label);
        Assert.Equal("12.0 mV", view.VoltageStats[3].Value); // 0.012 * 1000
    }

    // ---- Projection (wide, 3x4) ----------------------------------------------------

    [Fact]
    public void Project_wide_adds_module_labels_temperature_and_temp_stats()
    {
        var view = BatteryCellsProjection.Project(Summary(), new BatteryCellsSize(3, 4), Localizer);

        Assert.True(view.IsWide);
        Assert.Equal(4, view.GridColumns);
        Assert.True(view.ShowTemperature);

        Assert.Equal("Cell 1 \u00B7 M0", view.Cells[0].Label);
        Assert.Equal("3.700 V / 25.0\u00B0", view.Cells[0].Value);
        Assert.Equal("Cell 2 \u00B7 M1", view.Cells[1].Label);
        Assert.Equal("3.710 V / 26.0\u00B0", view.Cells[1].Value);

        Assert.Equal(3, view.TemperatureStats.Count);
        Assert.Equal("Min Temp", view.TemperatureStats[0].Label);
        Assert.Equal("22.0\u00B0", view.TemperatureStats[0].Value);
        Assert.Equal("Avg Temp", view.TemperatureStats[1].Label);
        Assert.Equal("25.0\u00B0", view.TemperatureStats[1].Value);
        Assert.Equal("Max Temp", view.TemperatureStats[2].Label);
        Assert.Equal("28.0\u00B0", view.TemperatureStats[2].Value);
    }

    [Fact]
    public void Project_compact_hides_nothing_but_tightens_grid()
    {
        var view = BatteryCellsProjection.Project(Summary(), new BatteryCellsSize(1, 4), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(2, view.GridColumns);
        Assert.Equal("C1", view.Cells[0].Label);
        Assert.Equal(4, view.VoltageStats.Count); // stats always present
    }

    [Fact]
    public void Project_unknown_voltage_renders_zero_value_and_unknown_status()
    {
        var view = BatteryCellsProjection.Project(
            Summary(cells: new[] { Cell(7, 0, null, null) }),
            new BatteryCellsSize(2, 4), Localizer);

        var cell = Assert.Single(view.Cells);
        Assert.Equal(BatteryCellSeverity.Unknown, cell.Severity);
        Assert.Equal("0.000 V", cell.Value); // web fmtNumber(undefined) -> safeNumber 0
    }

    [Fact]
    public void Project_cells_have_non_empty_accessibility_names()
    {
        var view = BatteryCellsProjection.Project(Summary(), new BatteryCellsSize(3, 4), Localizer);

        foreach (var cell in view.Cells)
        {
            Assert.False(string.IsNullOrWhiteSpace(cell.AutomationName));
            Assert.Contains(cell.Label, cell.AutomationName, StringComparison.Ordinal);
            Assert.Contains(cell.Value, cell.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Project_empty_summary_has_no_cells_but_keeps_stats_and_empty_message()
    {
        var view = BatteryCellsProjection.Project(BatteryCellSummary.Empty, new BatteryCellsSize(2, 4), Localizer);

        Assert.False(view.HasCells);
        Assert.Empty(view.Cells);
        Assert.Equal("No cell data", view.CellsEmptyMessage);
        Assert.Equal(4, view.VoltageStats.Count);
        Assert.Equal("0.000 V", view.VoltageStats[2].Value);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"avg_voltage":3.7,"min_voltage":3.6}""");

        var cached = BatteryCellsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3.7, cached.Value!.AvgVoltage);

        var offline = BatteryCellsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3.6, offline.Value!.MinVoltage);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"avg_voltage":3.7}""");

        Assert.Equal(LoadStatus.Loaded, BatteryCellsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryCellsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryCellsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryCellSummary>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_heatmap_and_stats()
    {
        using var vm = NewViewModel(Loaded(Summary()));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Loaded, vm.State);
        Assert.True(vm.HasCells);
        Assert.Equal(2, vm.Display.Cells.Count);
        Assert.Equal(4, vm.Display.VoltageStats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_no_data_body_stays_loaded_with_empty_grid()
    {
        // Web parity: a populated-but-empty "no_data" body keeps `data` truthy, so the surface renders
        // (Loaded) with the heatmap showing its own "No cell data" message rather than the outer empty.
        using var vm = NewViewModel(Loaded(BatteryCellSummary.Empty));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Loaded, vm.State);
        Assert.False(vm.HasCells);
        Assert.Equal("No cell data", vm.Display.CellsEmptyMessage);
        Assert.Equal(4, vm.Display.VoltageStats.Count);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_outer_empty()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryCellSummary>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Empty, vm.State);
        Assert.False(vm.HasCells);
        Assert.Equal("No battery cell data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryCellSummary>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryCellSummary>.Cached(Summary(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasCells);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryCellSummary>.OfflineCached(
            Summary(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Offline, vm.State);
        Assert.True(vm.HasCells);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryCellSummary>.Loading(),
            RepositoryResult<BatteryCellSummary>.Cached(Summary(minV: 3.600), Now, stale: false),
            RepositoryResult<BatteryCellSummary>.Loaded(Summary(minV: 3.650), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Loaded, vm.State);
        Assert.Equal("3.650 V", vm.Display.VoltageStats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_wide()
    {
        using var vm = NewViewModel(new BatteryCellsSize(2, 4), Loaded(Summary()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsWide);
        Assert.False(vm.Display.ShowTemperature);

        vm.Size = new BatteryCellsSize(3, 4);
        Assert.True(vm.Display.IsWide);
        Assert.True(vm.Display.ShowTemperature);
        Assert.Equal(3, vm.Display.TemperatureStats.Count);
        Assert.Equal(BatteryCellsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryCellSummary>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Cells", vm.Title);
        Assert.Equal("No battery cell data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Summary()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryCellsViewModel.State), changed);
        Assert.Contains(nameof(BatteryCellsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-cells", BatteryCellsRegistration.Id);
        Assert.Equal("battery", BatteryCellsRegistration.Category);
        Assert.Equal("BatteryCellsWidget", BatteryCellsRegistration.Slug);
        Assert.Equal(new BatteryCellsSize(2, 4), BatteryCellsRegistration.DefaultSize);
        Assert.Equal(new BatteryCellsSize(2, 4), BatteryCellsRegistration.MinSize);
        Assert.Equal(new BatteryCellsSize(4, 40), BatteryCellsRegistration.MaxSize);
        Assert.Equal("Battery Cells", BatteryCellsRegistration.Name(Localizer));
        Assert.Contains("heatmap", BatteryCellsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]    // min == default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(5, 40, false)]  // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryCellsRegistration.IsWithinBounds(new BatteryCellsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryCellsSize(2, 4), BatteryCellsRegistration.Clamp(new BatteryCellsSize(0, 0)));
        Assert.Equal(new BatteryCellsSize(4, 40), BatteryCellsRegistration.Clamp(new BatteryCellsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryCellsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryCellsWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryCellsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_cells_by_path()
    {
        using var doc = JsonDocument.Parse(
            """{"avg_voltage":3.7,"min_voltage":3.65,"max_voltage":3.75,"cells":[{"cell_id":1,"voltage":3.7}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryCellsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(3.7, terminal.Value!.AvgVoltage);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_battery_cells", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"avg_voltage":3.7}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryCellsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryCellsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<BatteryCellSummary>>> Drain(IBatteryCellsSource source)
    {
        var list = new List<RepositoryResult<BatteryCellSummary>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<BatteryCellSummary> Loaded(BatteryCellSummary summary) =>
        RepositoryResult<BatteryCellSummary>.Loaded(summary, Now);

    private static BatteryCellsViewModel NewViewModel(params RepositoryResult<BatteryCellSummary>[] emissions) =>
        NewViewModel(BatteryCellsSize.Default, emissions);

    private static BatteryCellsViewModel NewViewModel(
        BatteryCellsSize size,
        params RepositoryResult<BatteryCellSummary>[] emissions) =>
        new(new FakeBatteryCellsSource(emissions), Localizer, size, () => Now);

    private sealed class FakeBatteryCellsSource(params RepositoryResult<BatteryCellSummary>[] emissions) : IBatteryCellsSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryCellSummary>> StreamAsync(
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
