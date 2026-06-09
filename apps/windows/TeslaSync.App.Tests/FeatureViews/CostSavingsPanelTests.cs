using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the CostSavingsPanel surface's UI-thread-free logic — the drive JSON parse adapter
/// (distance / duration / aggregate energy + power + the telemetry-power fallback series), the energy-used
/// derivation (the parent hook's 3-tier <c>energyWh</c> fallback), the projection (the always-present Trip-Cost
/// tile and the conditional Cost-per-distance / Gas-cost / Gas-savings / Savings-% tiles, their web formatting,
/// labels and accessibility names), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) plus settings/units re-projection. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx + useDriveDetailData.ts +
/// useFormatting.ts).
/// </summary>
public sealed class CostSavingsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // 10 miles == 16093.44 m exactly; 0.5 h == 1800 s; 3 kWh == 3000 Wh.
    private const double TenMilesInMeters = 16093.44;

    // $0.12/kWh, "$", 2 dp, 30 mpg, $4.00/gal — the gas-comparison scenario that yields all five tiles.
    private static readonly CostSavingsSettings GasSettings = new(
        CostPerKwh: 0.12,
        CurrencySymbol: "$",
        DecimalPrecision: 2,
        GasEfficiencyMpg: 30,
        GasPricePerUnit: 4.0,
        GasUnit: CostSavingsGasUnit.Gallon);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_drive_fields()
    {
        const string json = """
        {
          "id": 42,
          "distance_m": 16093.44,
          "duration_s": 1800,
          "energy_used_wh": 3000,
          "avg_power_w": 6000
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var s = DriveCostSnapshot.FromJson(doc.RootElement);

        Assert.True(s.HasData);
        Assert.Equal(16093.44, s.DistanceM, 4);
        Assert.Equal(1800, s.DurationS, 4);
        Assert.Equal(3000, s.EnergyUsedWh);
        Assert.Equal(6000, s.AvgPowerW);
    }

    [Fact]
    public void FromJson_tolerates_numeric_strings_and_missing_optionals()
    {
        using var doc = JsonDocument.Parse("""{"id":"7","distance_m":"16093.44","duration_s":"1800"}""");

        var s = DriveCostSnapshot.FromJson(doc.RootElement);

        Assert.True(s.HasData);
        Assert.Equal(16093.44, s.DistanceM, 4);
        Assert.Null(s.EnergyUsedWh);
        Assert.Null(s.AvgPowerW);
        Assert.Empty(s.RowPowersKw);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object_and_non_drive()
    {
        using var array = JsonDocument.Parse("""[1,2,3]""");
        Assert.False(DriveCostSnapshot.FromJson(array.RootElement).HasData);

        using var notDrive = JsonDocument.Parse("""{"foo":"bar"}""");
        Assert.False(DriveCostSnapshot.FromJson(notDrive.RootElement).HasData);
    }

    // ---- EnergyWh derivation (web useDriveDetailData 3-tier fallback) ---------------

    [Fact]
    public void EnergyWh_prefers_the_aggregate_energy_used()
    {
        // energy_used_wh wins even when avg_power_w would imply a different figure.
        var s = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: 9999, RowPowersKw: Array.Empty<double>());
        Assert.Equal(3000, s.EnergyWh, 4);
    }

    [Fact]
    public void EnergyWh_falls_back_to_avg_power_times_duration()
    {
        // |4 kW| * 0.5 h * 1000 == 2000 Wh.
        var s = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: null, AvgPowerW: 4000, RowPowersKw: Array.Empty<double>());
        Assert.Equal(2000, s.EnergyWh, 4);
    }

    [Fact]
    public void EnergyWh_falls_back_to_the_mean_telemetry_power()
    {
        // mean(10,20) kW == 15 kW; * 1 h * 1000 == 15000 Wh.
        var s = new DriveCostSnapshot(true, TenMilesInMeters, 3600, EnergyUsedWh: null, AvgPowerW: null, RowPowersKw: new double[] { 10, 20 });
        Assert.Equal(15000, s.EnergyWh, 4);
    }

    [Fact]
    public void FromJson_reads_embedded_telemetry_power_series()
    {
        const string json = """
        {
          "id": 1,
          "distance_m": 1000,
          "duration_s": 3600,
          "telemetry": [ {"power": 10}, {"power": 20}, {"foo": "bar"} ]
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var s = DriveCostSnapshot.FromJson(doc.RootElement);

        // Every row contributes (the third row's absent power is the web `power ?? 0`).
        Assert.Equal(3, s.RowPowersKw.Count);
        Assert.Equal(new double[] { 10, 20, 0 }, s.RowPowersKw);
        Assert.Equal(10_000, s.EnergyWh, 4); // mean(10,20,0)=10 kW * 1 h * 1000
    }

    // ---- Projection: the full five-tile scenario -----------------------------------

    [Fact]
    public void Project_builds_all_five_tiles_with_web_formatting()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        var view = CostSavingsProjection.Project(drive, GasSettings, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("Cost & Savings", view.Title);
        Assert.Equal(5, view.Tiles.Count);

        // Trip Cost: formatEnergyCost(3 kWh) = $ (3 * 0.12) = $0.36, "at $0.12/kWh".
        Assert.NotNull(view.TripCost);
        Assert.Equal("Trip Cost", view.TripCost!.Label);
        Assert.Equal("$0.36", view.TripCost.ValueText);
        Assert.Equal("at $0.12/kWh", view.TripCost.Subtitle);
        Assert.Equal(CostSavingsProjection.SuccessBrushKey, view.TripCost.ValueBrushKey);

        // Cost / km: 0.36 / 16.09344 km = $0.022 (3 dp).
        Assert.NotNull(view.CostPerDistance);
        Assert.Equal("Cost / km", view.CostPerDistance!.Label);
        Assert.Equal("$0.022", view.CostPerDistance.ValueText);
        Assert.Equal(CostSavingsProjection.InfoBrushKey, view.CostPerDistance.ValueBrushKey);

        // Gas Cost (equiv): 10 mi / 30 mpg * $4 = $1.33, "at 30 MPG".
        Assert.NotNull(view.GasCostEquiv);
        Assert.Equal("Gas Cost (equiv)", view.GasCostEquiv!.Label);
        Assert.Equal("$1.33", view.GasCostEquiv.ValueText);
        Assert.Equal("at 30 MPG", view.GasCostEquiv.Subtitle);
        Assert.Equal(CostSavingsProjection.DangerBrushKey, view.GasCostEquiv.ValueBrushKey);

        // vs Gas Savings: $1.33 - $0.36 = $0.97.
        Assert.NotNull(view.GasSavings);
        Assert.Equal("vs Gas Savings", view.GasSavings!.Label);
        Assert.Equal("$0.97", view.GasSavings.ValueText);

        // Savings %: 0.9733 / 1.3333 * 100 = 73%.
        Assert.NotNull(view.SavingsPct);
        Assert.Equal("Savings %", view.SavingsPct!.Label);
        Assert.Equal("73%", view.SavingsPct.ValueText);
    }

    [Fact]
    public void Project_hides_cost_per_distance_when_distance_is_zero()
    {
        var drive = new DriveCostSnapshot(true, DistanceM: 0, DurationS: 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        var view = CostSavingsProjection.Project(drive, GasSettings, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.NotNull(view.TripCost);
        Assert.Null(view.CostPerDistance);
        // No distance → no gas estimate → no savings trio (web `savings != null && savings > 0`).
        Assert.Null(view.GasCostEquiv);
        Assert.Null(view.GasSavings);
        Assert.Null(view.SavingsPct);
        Assert.Single(view.Tiles);
    }

    [Fact]
    public void Project_hides_gas_trio_when_no_gas_price_configured()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        // Default settings carry no gas comparison (mpg/price 0) → estimateGasCost is null.
        var view = CostSavingsProjection.Project(drive, CostSavingsSettings.Default, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.NotNull(view.TripCost);
        Assert.NotNull(view.CostPerDistance);
        Assert.Null(view.GasCostEquiv);
        Assert.Null(view.GasSavings);
        Assert.Null(view.SavingsPct);
        Assert.Equal(2, view.Tiles.Count);
    }

    [Fact]
    public void Project_uses_the_imperial_distance_unit_label_and_value()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        var view = CostSavingsProjection.Project(drive, GasSettings, UnitPref.Imperial, Localizer);

        Assert.NotNull(view.CostPerDistance);
        Assert.Equal("Cost / mi", view.CostPerDistance!.Label);
        // 0.36 / 10 mi = $0.036.
        Assert.Equal("$0.036", view.CostPerDistance.ValueText);
    }

    [Fact]
    public void Project_empty_snapshot_renders_friendly_empty_state()
    {
        var view = CostSavingsProjection.Project(DriveCostSnapshot.Empty, GasSettings, UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Tiles);
        Assert.Null(view.TripCost);
        Assert.Equal("Cost & Savings", view.Title);
        Assert.Equal("No cost data for this drive", view.EmptyMessage);
    }

    [Fact]
    public void Project_honours_a_custom_currency_symbol()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());
        var euro = GasSettings with { CurrencySymbol = "€" };

        var view = CostSavingsProjection.Project(drive, euro, UnitPref.Metric, Localizer);

        Assert.Equal("€0.36", view.TripCost!.ValueText);
        Assert.Equal("at €0.12/kWh", view.TripCost.Subtitle);
        Assert.Equal("€1.33", view.GasCostEquiv!.ValueText);
    }

    [Fact]
    public void Project_blank_currency_symbol_falls_back_to_dollar()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());
        var blank = GasSettings with { CurrencySymbol = "   " };

        var view = CostSavingsProjection.Project(drive, blank, UnitPref.Metric, Localizer);

        Assert.Equal("$0.36", view.TripCost!.ValueText);
    }

    // ---- useFormatting helper ports ------------------------------------------------

    [Fact]
    public void EstimateGasCost_returns_null_when_inputs_non_positive()
    {
        Assert.Null(CostSavingsProjection.EstimateGasCost(TenMilesInMeters, CostSavingsSettings.Default)); // mpg/price 0
        Assert.Null(CostSavingsProjection.EstimateGasCost(0, GasSettings));                                // distance 0
    }

    [Fact]
    public void EstimateGasCost_applies_the_gallon_and_litre_branches()
    {
        // Gallon: 10 mi / 30 mpg * $4 = $1.3333.
        Assert.Equal(1.3333, CostSavingsProjection.EstimateGasCost(TenMilesInMeters, GasSettings)!.Value, 4);

        // Litre: 10 mi / 30 mpg = 0.3333 gal → * 3.78541 L/gal * $1.5 = $1.8927.
        var litre = GasSettings with { GasUnit = CostSavingsGasUnit.Liter, GasPricePerUnit = 1.5 };
        Assert.Equal(1.8927, CostSavingsProjection.EstimateGasCost(TenMilesInMeters, litre)!.Value, 4);
    }

    [Fact]
    public void CostPerDistanceUnit_returns_null_for_non_positive_distance()
    {
        Assert.Null(CostSavingsProjection.CostPerDistanceUnit(3, 0, GasSettings, UnitPref.Metric));
    }

    // ---- i18n: every source label resolves through its catalog key ------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        var view = CostSavingsProjection.Project(drive, GasSettings, UnitPref.Metric, echo);

        Assert.Equal("L:driveDetail.costSavings", view.Title);
        Assert.Equal("L:driveDetail.tripCost", view.TripCost!.Label);
        Assert.Contains("L:driveDetail.atRate", view.TripCost.Subtitle, StringComparison.Ordinal);
        Assert.Contains("L:driveDetail.costPerUnit", view.CostPerDistance!.Label, StringComparison.Ordinal);
        Assert.Equal("L:driveDetail.gasCostEquiv", view.GasCostEquiv!.Label);
        Assert.Contains("L:driveDetail.atMpg", view.GasCostEquiv.Subtitle, StringComparison.Ordinal);
        Assert.Equal("L:driveDetail.gasSavings", view.GasSavings!.Label);
        Assert.Equal("L:driveDetail.savingsPct", view.SavingsPct!.Label);
    }

    [Fact]
    public void Empty_message_resolves_through_its_catalog_key()
    {
        var echo = new KeyEchoLocalizer();
        var view = CostSavingsProjection.Project(DriveCostSnapshot.Empty, GasSettings, UnitPref.Metric, echo);
        Assert.Equal("L:driveDetail.costSavings.empty", view.EmptyMessage);
    }

    // ---- a11y: every tile carries a spoken name ------------------------------------

    [Fact]
    public void Every_tile_carries_a_non_empty_value_label_and_automation_name()
    {
        var drive = new DriveCostSnapshot(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

        var view = CostSavingsProjection.Project(drive, GasSettings, UnitPref.Metric, Localizer);

        foreach (var tile in view.Tiles)
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.Label));
            Assert.False(string.IsNullOrWhiteSpace(tile.ValueText));
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
            Assert.Contains(tile.Label, tile.AutomationName, StringComparison.Ordinal);
            Assert.Contains(tile.ValueText, tile.AutomationName, StringComparison.Ordinal);
        }

        Assert.False(string.IsNullOrWhiteSpace(view.AriaLabel));
        Assert.Contains(view.Title, view.AriaLabel, StringComparison.Ordinal);
        Assert.Contains(view.TripCost!.ValueText, view.AriaLabel, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""{"id":1,"distance_m":16093.44,"duration_s":1800,"energy_used_wh":3000}""");

        var cached = CostSavingsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);

        var offline = CostSavingsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, CostSavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, CostSavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostSavingsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DriveCostSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tiles()
    {
        using var vm = NewViewModel(GasSettings, Loaded(Drive()));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display.TripCost);
        Assert.Equal(5, vm.Display.Tiles.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_drive_renders_empty()
    {
        using var vm = NewViewModel(Loaded(DriveCostSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No cost data for this drive", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DriveCostSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveCostSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(GasSettings, RepositoryResult<DriveCostSnapshot>.Cached(Drive(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(GasSettings, RepositoryResult<DriveCostSnapshot>.OfflineCached(
            Drive(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            GasSettings,
            RepositoryResult<DriveCostSnapshot>.Loading(),
            RepositoryResult<DriveCostSnapshot>.Cached(Drive(), Now, stale: false),
            RepositoryResult<DriveCostSnapshot>.Loaded(Drive(), Now));
        await vm.LoadAsync();

        Assert.Equal(CostSavingsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(5, vm.Display.Tiles.Count);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_settings_change()
    {
        // Default settings (no gas) → 2 tiles; switching to the gas comparison → 5 tiles, same snapshot.
        using var vm = NewViewModel(CostSavingsSettings.Default, Loaded(Drive()));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Display.Tiles.Count);

        vm.Settings = GasSettings;

        Assert.Equal(5, vm.Display.Tiles.Count);
        Assert.Equal(CostSavingsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        using var vm = new CostSavingsPanelViewModel(
            new FakeSource(Loaded(Drive())), Localizer, GasSettings, UnitPref.Metric);
        await vm.LoadAsync();
        Assert.Equal("Cost / km", vm.Display.CostPerDistance!.Label);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("Cost / mi", vm.Display.CostPerDistance!.Label);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DriveCostSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Cost & Savings", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(GasSettings, Loaded(Drive()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostSavingsPanelViewModel.State), changed);
        Assert.Contains(nameof(CostSavingsPanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("cost-savings-panel", CostSavingsPanelRegistration.Id);
        Assert.Equal("driving", CostSavingsPanelRegistration.Category);
        Assert.Equal("CostSavingsPanel", CostSavingsPanelRegistration.Slug);
        Assert.Equal("Cost & Savings", CostSavingsPanelRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostSavingsPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostSavingsPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DriveCostSnapshot Drive() =>
        new(true, TenMilesInMeters, 1800, EnergyUsedWh: 3000, AvgPowerW: null, RowPowersKw: Array.Empty<double>());

    private static RepositoryResult<DriveCostSnapshot> Loaded(DriveCostSnapshot data) =>
        RepositoryResult<DriveCostSnapshot>.Loaded(data, Now);

    private static CostSavingsPanelViewModel NewViewModel(params RepositoryResult<DriveCostSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CostSavingsPanelViewModel NewViewModel(
        CostSavingsSettings settings, params RepositoryResult<DriveCostSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, settings);

    private sealed class FakeSource(params RepositoryResult<DriveCostSnapshot>[] emissions) : ICostSavingsPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<DriveCostSnapshot>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
