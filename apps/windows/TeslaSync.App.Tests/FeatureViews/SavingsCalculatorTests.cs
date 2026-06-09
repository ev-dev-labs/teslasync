using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
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
/// Headless verification of the savings-calculator surface's UI-thread-free logic — the charging-session JSON
/// parse adapter, the cost aggregation (totals + month-bucket count + odometer-delta distance), the
/// gas-versus-electric comparison maths (a faithful port of the web <c>gasComparison</c> memo), the input
/// coercion (web <c>Number(value) || fallback</c>), the projection (currency formatting, the per-distance
/// suffix, the comparison-vs-noData gate, the a11y names), the cache-then-network result mapper, the repository
/// source's request shape, the state-holder view-model's per-state matrix (loading / loaded / empty / error /
/// stale / offline) plus the live input recomputation and reset, the registry metadata and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx + useCostAnalysisData.ts).
/// </summary>
public sealed class SavingsCalculatorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // Two sessions: 30 kWh added, $5 spent, 482803.2 m driven (300 mi), across Jan + Feb 2026.
    private const string SessionsJson = """
    [
      { "total_energy_added_wh": 10000, "cost_decimal": 2.0, "start_odometer_m": 0, "end_odometer_m": 160934.4, "started_at": "2026-01-15T08:00:00Z" },
      { "total_energy_added_wh": 20000, "cost_decimal": 3.0, "start_odometer_m": 160934.4, "end_odometer_m": 482803.2, "started_at": "2026-02-10T09:00:00Z" }
    ]
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_session_fields()
    {
        using var doc = JsonDocument.Parse("""
        { "total_energy_added_wh": 12500, "cost_decimal": 4.25, "start_odometer_m": 1000, "end_odometer_m": 26093.44, "started_at": "2026-03-01T07:30:00Z" }
        """);

        var s = SavingsChargingSession.FromJson(doc.RootElement);

        Assert.Equal(12500, s.EnergyWh);
        Assert.Equal(4.25, s.Cost);
        Assert.Equal(1000, s.OdometerStartM);
        Assert.Equal(26093.44, s.OdometerEndM);
        Assert.NotNull(s.StartedAt);
        Assert.Equal(25093.44, s.DistanceAddedMeters, 3);
    }

    [Fact]
    public void FromJson_is_null_tolerant_and_defaults_energy_to_zero()
    {
        using var doc = JsonDocument.Parse("""{ "cost_decimal": null }""");

        var s = SavingsChargingSession.FromJson(doc.RootElement);

        Assert.Equal(0, s.EnergyWh);
        Assert.Null(s.Cost);
        Assert.Null(s.OdometerStartM);
        Assert.Null(s.StartedAt);
        Assert.Equal(0, s.DistanceAddedMeters);
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{ "total_energy_added_wh": "5000", "cost_decimal": "1.5" }""");

        var s = SavingsChargingSession.FromJson(doc.RootElement);

        Assert.Equal(5000, s.EnergyWh);
        Assert.Equal(1.5, s.Cost);
    }

    [Fact]
    public void DistanceAddedMeters_is_zero_when_delta_not_positive_or_odometer_absent()
    {
        Assert.Equal(0, new SavingsChargingSession(0, null, 100, 50, null).DistanceAddedMeters); // end < start
        Assert.Equal(0, new SavingsChargingSession(0, null, 100, 100, null).DistanceAddedMeters); // no delta
        Assert.Equal(0, new SavingsChargingSession(0, null, null, 500, null).DistanceAddedMeters); // start absent
        Assert.Equal(400, new SavingsChargingSession(0, null, 100, 500, null).DistanceAddedMeters);
    }

    [Fact]
    public void ParseList_reads_array_and_ignores_non_arrays()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        Assert.Equal(2, SavingsChargingSession.ParseList(doc.RootElement).Count);

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(SavingsChargingSession.ParseList(notArray.RootElement));
    }

    // ---- Aggregation ---------------------------------------------------------------

    [Fact]
    public void Aggregate_sums_cost_energy_distance_months_and_count()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        var agg = SavingsCostAggregate.Aggregate(SavingsChargingSession.ParseList(doc.RootElement));

        Assert.Equal(5.0, agg.TotalCostUsd, 6);
        Assert.Equal(30.0, agg.TotalEnergyKwh, 6);           // (10000 + 20000) Wh -> kWh
        Assert.Equal(482803.2, agg.TotalDistanceM, 3);
        Assert.Equal(2, agg.MonthCount);                     // 2026-01 + 2026-02
        Assert.Equal(2, agg.SessionCount);
        Assert.True(agg.HasData);
    }

    [Fact]
    public void Aggregate_counts_distinct_months_once()
    {
        const string sameMonth = """
        [
          { "total_energy_added_wh": 1000, "started_at": "2026-01-05T08:00:00Z" },
          { "total_energy_added_wh": 1000, "started_at": "2026-01-20T08:00:00Z" }
        ]
        """;
        using var doc = JsonDocument.Parse(sameMonth);
        var agg = SavingsCostAggregate.Aggregate(SavingsChargingSession.ParseList(doc.RootElement));

        Assert.Equal(1, agg.MonthCount);
        Assert.Equal(2, agg.SessionCount);
    }

    [Fact]
    public void Aggregate_of_empty_is_the_empty_aggregate()
    {
        var agg = SavingsCostAggregate.Aggregate(Array.Empty<SavingsChargingSession>());

        Assert.False(agg.HasData);
        Assert.Equal(0, agg.SessionCount);
        Assert.Equal(SavingsCostAggregate.Empty, agg);
    }

    // ---- Input coercion (web Number(v) || fallback) ---------------------------------

    [Theory]
    [InlineData("3.5", 3.5)]
    [InlineData("0", 0)]
    [InlineData("", 0)]
    [InlineData("abc", 0)]
    public void ParseGasPrice_matches_web_or_zero(string text, double expected) =>
        Assert.Equal(expected, SavingsCalculatorInputs.ParseGasPrice(text));

    [Theory]
    [InlineData("0.13", 0.13)]
    [InlineData("", 0)]
    [InlineData("nope", 0)]
    public void ParseElectricityRate_matches_web_or_zero(string text, double expected) =>
        Assert.Equal(expected, SavingsCalculatorInputs.ParseElectricityRate(text));

    [Theory]
    [InlineData("30", 30)]
    [InlineData("0", 1)]    // web Number("0") || 1 === 1
    [InlineData("", 1)]
    [InlineData("abc", 1)]
    public void ParseMpg_matches_web_or_one(string text, double expected) =>
        Assert.Equal(expected, SavingsCalculatorInputs.ParseMpg(text));

    [Fact]
    public void Default_inputs_match_web_constants()
    {
        Assert.Equal(3.5, SavingsCalculatorInputs.DefaultGasPrice);
        Assert.Equal(30, SavingsCalculatorInputs.DefaultMpg);
        Assert.Equal(0.13, SavingsCalculatorInputs.DefaultElectricityRate);
        Assert.Equal(new SavingsCalculatorInputs(3.5, 30, 0.13), SavingsCalculatorInputs.Default);
    }

    // ---- Comparison maths (faithful port of useCostAnalysisData gasComparison) -------

    [Fact]
    public void Compute_reproduces_web_gas_comparison()
    {
        // aggregate: $10 spent, 50 kWh, 1,609,344 m (the web meters->miles step yields exactly 1000), 5 months.
        var aggregate = new SavingsCostAggregate(TotalCostUsd: 10, TotalEnergyKwh: 50, TotalDistanceM: 1609344, MonthCount: 5, SessionCount: 12);
        var inputs = new SavingsCalculatorInputs(GasPrice: 4.0, Mpg: 25, ElectricityRate: 0.20);

        var cmp = SavingsGasComparison.Compute(aggregate, inputs, DistanceUnit.Mi);

        // distDisplay = DistanceFromSi(1609344 / 1609.344, Mi) = DistanceFromSi(1000, Mi) = 1000 / 1609.344.
        Assert.Equal(10.0, cmp.EvCost, 6);                    // 50 kWh * $0.20
        Assert.Equal(10.0, cmp.ActualCost, 6);                // pass-through total cost
        Assert.Equal(0.16, cmp.CostPerDistanceGas, 6);        // gasPrice / mpg (distDisplay cancels)
        Assert.Equal(16.09344, cmp.CostPerDistanceEv, 4);     // 10 / (1000 / 1609.344)
        Assert.Equal(0.0994194, cmp.GasCost, 5);              // distDisplay * (gasPrice / mpg)
        Assert.Equal(cmp.GasCost - 10.0, cmp.Savings, 6);     // gasCost - actualCost
        Assert.Equal((cmp.GasCost - cmp.EvCost) / 5.0, cmp.MonthlySavings, 6);
        Assert.Equal(cmp.MonthlySavings * 12, cmp.YearlySavings, 6);
    }

    [Fact]
    public void Compute_guards_zero_distance_and_zero_mpg()
    {
        var zeroDistance = new SavingsCostAggregate(10, 50, 0, 3, 5);
        var cmp = SavingsGasComparison.Compute(zeroDistance, SavingsCalculatorInputs.Default, DistanceUnit.Mi);
        Assert.Equal(0, cmp.GasCost);
        Assert.Equal(0, cmp.CostPerDistanceGas);
        Assert.Equal(0, cmp.CostPerDistanceEv);

        var zeroMpg = SavingsGasComparison.Compute(new SavingsCostAggregate(10, 50, 1609344, 3, 5), new SavingsCalculatorInputs(4, 0, 0.2), DistanceUnit.Mi);
        Assert.True(double.IsFinite(zeroMpg.GasCost));
        Assert.Equal(0, zeroMpg.GasCost);
    }

    [Fact]
    public void Compute_monthly_is_zero_when_no_months()
    {
        var cmp = SavingsGasComparison.Compute(new SavingsCostAggregate(10, 50, 1609344, 0, 5), SavingsCalculatorInputs.Default, DistanceUnit.Mi);
        Assert.Equal(0, cmp.MonthlySavings);
        Assert.Equal(0, cmp.YearlySavings);
    }

    [Fact]
    public void Compute_honours_the_distance_unit()
    {
        var aggregate = new SavingsCostAggregate(10, 50, 1609344, 5, 12);
        var miles = SavingsGasComparison.Compute(aggregate, SavingsCalculatorInputs.Default, DistanceUnit.Mi);
        var km = SavingsGasComparison.Compute(aggregate, SavingsCalculatorInputs.Default, DistanceUnit.Km);

        // The display distance (and therefore the absolute gas cost) differs by unit; the per-distance gas
        // cost is always gasPrice/mpg, so it is unit-invariant.
        Assert.NotEqual(miles.GasCost, km.GasCost);
        Assert.Equal(miles.CostPerDistanceGas, km.CostPerDistanceGas, 9);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_formats_labels_currency_and_per_distance()
    {
        var aggregate = new SavingsCostAggregate(TotalCostUsd: 10, TotalEnergyKwh: 50, TotalDistanceM: 1609344, MonthCount: 5, SessionCount: 12);
        var view = SavingsCalculatorProjection.Project(aggregate, new SavingsCalculatorInputs(4.0, 25, 0.20), DistanceUnit.Mi, Localizer);

        Assert.True(view.HasComparison);
        Assert.Equal("Gas vs Electric Savings Calculator", view.Title);
        Assert.Equal("Your Assumptions", view.InputsLabel);
        Assert.Equal("Comparison", view.ComparisonLabel);
        Assert.Equal("Gas Price ($/gal)", view.GasPriceLabel);
        Assert.Equal("Gas Car MPG", view.MpgLabel);
        Assert.Equal("Electricity Rate ($/kWh)", view.ElectricityRateLabel);
        Assert.Equal("Reset Defaults", view.ResetLabel);

        Assert.Equal("$10.00", view.EvCostValueText);                 // 50 kWh * $0.20
        Assert.Equal("$16.093/mi", view.EvCostPerDistanceText);       // 10 / (1000/1609.344), 3 dp + unit
        Assert.Equal("Gas Cost (equivalent)", view.GasCostLabel);
        Assert.StartsWith("$", view.GasCostValueText, StringComparison.Ordinal);
        Assert.EndsWith("/mi", view.GasCostPerDistanceText, StringComparison.Ordinal);
        Assert.Equal("over selected period", view.OverPeriodLabel);
        Assert.StartsWith("~$", view.YearlySavingsText, StringComparison.Ordinal);
        Assert.EndsWith("/ year", view.YearlySavingsText, StringComparison.Ordinal);
        Assert.Equal("mi", view.DistanceUnitLabel);
    }

    [Fact]
    public void Project_empty_aggregate_gates_to_no_data_with_zeroed_readouts()
    {
        var view = SavingsCalculatorProjection.Project(SavingsCostAggregate.Empty, SavingsCalculatorInputs.Default, DistanceUnit.Mi, Localizer);

        Assert.False(view.HasComparison);
        Assert.Equal("Not enough data for comparison", view.NoDataMessage);
        Assert.Equal("$0.00", view.GasCostValueText);
        Assert.Equal("$0.00", view.EvCostValueText);
        Assert.Equal("$0.00", view.TotalSavingsValueText);
        Assert.Equal("$0.00", view.MonthlySavingsValueText);
        Assert.Equal("~$0 / year", view.YearlySavingsText);
        Assert.Equal("$0.000/mi", view.GasCostPerDistanceText);
    }

    [Fact]
    public void Project_honours_custom_currency_symbol()
    {
        var aggregate = new SavingsCostAggregate(10, 50, 1609344, 5, 12);
        var view = SavingsCalculatorProjection.Project(aggregate, new SavingsCalculatorInputs(4.0, 25, 0.20), DistanceUnit.Mi, Localizer, "€");

        Assert.Equal("€10.00", view.EvCostValueText);
        Assert.StartsWith("€", view.GasCostValueText, StringComparison.Ordinal);
        Assert.StartsWith("~€", view.YearlySavingsText, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_builds_accessible_names_with_label_and_value()
    {
        var aggregate = new SavingsCostAggregate(10, 50, 1609344, 5, 12);
        var view = SavingsCalculatorProjection.Project(aggregate, new SavingsCalculatorInputs(4.0, 25, 0.20), DistanceUnit.Mi, Localizer);

        Assert.Contains(view.GasCostLabel, view.GasCostAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.GasCostValueText, view.GasCostAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.EvCostValueText, view.EvCostAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.TotalSavingsValueText, view.TotalSavingsAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.MonthlySavingsValueText, view.MonthlySavingsAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.ComparisonLabel, view.ComparisonAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_aggregates_payload()
    {
        using var doc = JsonDocument.Parse(SessionsJson);

        var cached = SavingsCalculatorResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.SessionCount);
        Assert.Equal(5.0, cached.Value!.TotalCostUsd, 6);

        var offline = SavingsCalculatorResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(30.0, offline.Value!.TotalEnergyKwh, 6);
    }

    [Fact]
    public void Map_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, SavingsCalculatorResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, SavingsCalculatorResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, SavingsCalculatorResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsCostAggregate>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_comparison()
    {
        using var vm = NewViewModel(Loaded(SampleAggregate()));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasComparison);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(SavingsCostAggregate.Empty));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsCostAggregate>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsCostAggregate>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsCostAggregate>.Cached(SampleAggregate(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SavingsCostAggregate>.OfflineCached(
            SampleAggregate(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SavingsCostAggregate>.Loading(),
            RepositoryResult<SavingsCostAggregate>.Cached(SampleAggregate(), Now, stale: false),
            RepositoryResult<SavingsCostAggregate>.Loaded(SampleAggregate(), Now));
        await vm.LoadAsync();

        Assert.Equal(SavingsCalculatorState.Loaded, vm.State);
        Assert.True(vm.Display.HasComparison);
    }

    [Fact]
    public async Task ViewModel_input_change_recomputes_comparison_live()
    {
        using var vm = NewViewModel(Loaded(SampleAggregate()));
        await vm.LoadAsync();

        vm.ElectricityRate = 0.5;                              // 30 kWh * $0.50 = $15.00
        Assert.Equal("$15.00", vm.Display.EvCostValueText);

        vm.GasPrice = 30;
        vm.Mpg = 10;                                           // gas $/dist = gasPrice / mpg = 3.0
        Assert.Equal("$3.000/mi", vm.Display.GasCostPerDistanceText);
    }

    [Fact]
    public async Task ViewModel_reset_restores_defaults_and_reprojects()
    {
        using var vm = NewViewModel(Loaded(SampleAggregate()));
        await vm.LoadAsync();

        vm.GasPrice = 99;
        vm.Mpg = 99;
        vm.ElectricityRate = 9;
        vm.ResetInputs();

        Assert.Equal(3.5, vm.GasPrice);
        Assert.Equal(30, vm.Mpg);
        Assert.Equal(0.13, vm.ElectricityRate);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_display_and_inputs()
    {
        using var vm = NewViewModel(Loaded(SampleAggregate()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();
        Assert.Contains(nameof(SavingsCalculatorViewModel.State), changed);
        Assert.Contains(nameof(SavingsCalculatorViewModel.Display), changed);

        changed.Clear();
        vm.GasPrice = 7.0;
        Assert.Contains(nameof(SavingsCalculatorViewModel.GasPrice), changed);
        Assert.Contains(nameof(SavingsCalculatorViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_copy_resolves_through_i18n()
    {
        using var vm = NewViewModel();
        Assert.Equal("Gas vs Electric Savings Calculator", vm.Title);
        Assert.Equal("No Charging Data", vm.EmptyTitle);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_the_request()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new SavingsCalculatorSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.SessionCount);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SavingsCalculatorSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new SavingsCalculatorSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        var cache = new InMemoryCacheStore();
        var options = new ApiClientOptions();
        var engine = new CacheThenNetworkEngine(cache, () => Now);

        var ok = new SavingsCalculatorSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new SavingsCalculatorSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(5.0, emissions[^1].Value!.TotalCostUsd, 6);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("savings-calculator", SavingsCalculatorRegistration.Id);
        Assert.Equal("charging", SavingsCalculatorRegistration.Category);
        Assert.Equal("SavingsCalculator", SavingsCalculatorRegistration.Slug);
        Assert.Equal("$/gal", SavingsCalculatorRegistration.GasPriceUnit);
        Assert.Equal("mpg", SavingsCalculatorRegistration.MpgUnit);
        Assert.Equal("$/kWh", SavingsCalculatorRegistration.ElectricityRateUnit);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SavingsCalculatorDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SavingsCalculator", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SavingsCostAggregate SampleAggregate() => new(5.0, 30.0, 482803.2, 2, 2);

    private static RepositoryResult<SavingsCostAggregate> Loaded(SavingsCostAggregate aggregate) =>
        RepositoryResult<SavingsCostAggregate>.Loaded(aggregate, Now);

    private static SavingsCalculatorViewModel NewViewModel(params RepositoryResult<SavingsCostAggregate>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<SavingsCostAggregate>>> Collect(
        IAsyncEnumerable<RepositoryResult<SavingsCostAggregate>> stream)
    {
        var list = new List<RepositoryResult<SavingsCostAggregate>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<SavingsCostAggregate>[] emissions) : ISavingsCalculatorSource
    {
        public async IAsyncEnumerable<RepositoryResult<SavingsCostAggregate>> StreamAsync(
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
