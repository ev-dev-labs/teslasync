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
/// Headless verification of the Cost Summary Cards surface's UI-thread-free logic — the charging-session
/// JSON parse adapter (cost_decimal + total_energy_added_wh + odometer delta), the <c>coreStats</c>
/// aggregation (the native port of the web <c>useCostAnalysisData</c>, including the reproduced
/// miles-as-metres cost-per-distance quirk), the SI→display projection into the six web tiles (Total Cost,
/// Avg $/kWh, Cost Per Mile/km, Total Energy, Gas Savings $, Savings %), the cache-then-network result
/// mapper, the per-vehicle repository source's request shape, the state-holder view-model's per-state matrix
/// (loading / loaded / empty / error / stale / offline), the registry metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx).
/// </summary>
public sealed class CostSummaryCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // 100 miles of odometer delta in SI metres (100 * 1609.344) — chosen so the web miles-as-metres
    // cost-per-distance quirk yields exact round figures in both unit systems.
    private const double HundredMilesM = 160934.4;

    private static CostSummaryCardsSession Session(
        double? cost, double energyWh, double? startOdom = null, double? endOdom = null) =>
        new(cost, energyWh, startOdom, endOdom);

    // A two-session fleet: 30 kWh added, $1.50 spent, 100 mi of odometer delta on the first session.
    private static IReadOnlyList<CostSummaryCardsSession> SampleSessions() => new[]
    {
        Session(1.0, 20_000, 0, HundredMilesM),
        Session(0.5, 10_000, 0, 0), // zero odometer delta -> contributes no distance
    };

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"cost_decimal":7.89,"total_energy_added_wh":12345.6,"start_odometer_m":1000,"end_odometer_m":161934.4}
        """);

        var s = CostSummaryCardsSession.FromJson(doc.RootElement);

        Assert.Equal(7.89, s.CostDecimal);
        Assert.Equal(12345.6, s.EnergyAddedWh);
        Assert.Equal(1000, s.OdometerStartM);
        Assert.Equal(161934.4, s.OdometerEndM);
        Assert.Equal(160934.4, s.DistanceAddedM);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":1}""");

        var s = CostSummaryCardsSession.FromJson(doc.RootElement);

        Assert.Null(s.CostDecimal);
        Assert.Equal(0, s.EnergyAddedWh);
        Assert.Null(s.OdometerStartM);
        Assert.Null(s.OdometerEndM);
        Assert.Null(s.DistanceAddedM);
    }

    [Theory]
    [InlineData(1000.0, 2000.0, 1000.0)] // positive delta
    [InlineData(2000.0, 2000.0, null)] // zero delta -> null (sums as 0)
    [InlineData(2000.0, 1000.0, null)] // negative delta -> null
    public void DistanceAddedM_matches_web_distanceAddedM(double start, double end, double? expected)
    {
        Assert.Equal(expected, Session(1, 1000, start, end).DistanceAddedM);
    }

    [Fact]
    public void DistanceAddedM_null_when_an_endpoint_is_missing()
    {
        Assert.Null(Session(1, 1000, startOdom: null, endOdom: 5000).DistanceAddedM);
        Assert.Null(Session(1, 1000, startOdom: 1000, endOdom: null).DistanceAddedM);
    }

    [Fact]
    public void ParseList_reads_array_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""
        [{"total_energy_added_wh":1000,"cost_decimal":2}, 42, {"total_energy_added_wh":2000}]
        """);

        var list = CostSummaryCardsSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(2, list[0].CostDecimal);
        Assert.Equal(2000, list[1].EnergyAddedWh);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(CostSummaryCardsSession.ParseList(doc.RootElement));
    }

    // ---- CoreStats aggregation (web useCostAnalysisData) ----------------------------

    [Fact]
    public void Compute_aggregates_core_stats_in_metric()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Metric);

        Assert.True(stats.HasData);
        Assert.Equal(2, stats.Count);
        Assert.Equal(1.5, stats.TotalCost, 6);
        Assert.Equal(30, stats.TotalEnergyKwh, 6);          // 30000 Wh -> 30 kWh
        Assert.Equal(0.05, stats.AvgCostPerKwh, 6);          // 1.5 / 30
        Assert.Equal(30.0 / 33.7, stats.GallonsEquiv, 6);    // KWH_PER_GALLON

        // web quirk: convertDistanceFromSI(totalDistanceM / 1609.344, 'km') = (100) / 1000 = 0.1 km.
        Assert.Equal(15, stats.CostPerDistance, 6);          // 1.5 / 0.1

        double gasCost = 30.0 / 33.7 * 3.5;
        Assert.Equal(gasCost - 1.5, stats.Savings, 6);
        Assert.Equal((gasCost - 1.5) / gasCost * 100, stats.SavingsPercent, 6);
    }

    [Fact]
    public void Compute_cost_per_distance_differs_in_imperial()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Imperial);

        // web quirk: convertDistanceFromSI(100, 'mi') = 100 / 1609.344 mi; costPerDist = 1.5 / that.
        Assert.Equal(1.5 / (100.0 / 1609.344), stats.CostPerDistance, 4);

        // Everything not distance-derived is unit-invariant.
        Assert.Equal(30, stats.TotalEnergyKwh, 6);
        Assert.Equal(1.5, stats.TotalCost, 6);
    }

    [Fact]
    public void Compute_empty_sessions_is_empty()
    {
        var stats = CostSummaryCoreStats.Compute(Array.Empty<CostSummaryCardsSession>(), CostSummaryCardsSettings.Default, UnitPref.Metric);

        Assert.False(stats.HasData);
        Assert.Equal(0, stats.Count);
        Assert.Same(CostSummaryCoreStats.Empty, stats);
    }

    [Fact]
    public void Compute_zero_energy_avoids_divide_by_zero()
    {
        var stats = CostSummaryCoreStats.Compute(new[] { Session(0, 0) }, CostSummaryCardsSettings.Default, UnitPref.Metric);

        Assert.True(stats.HasData);          // a session exists (web coreStats non-null)
        Assert.Equal(0, stats.AvgCostPerKwh); // guarded
        Assert.Equal(0, stats.CostPerDistance);
        Assert.Equal(0, stats.SavingsPercent);
    }

    // ---- Projection (six tiles, web StatBox parity) ---------------------------------

    [Fact]
    public void Project_metric_formats_six_cards()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Metric);
        var view = CostSummaryCardsProjection.Project(stats, CostSummaryCardsSettings.Default, UnitPref.Metric, Localizer);

        Assert.Equal(6, view.Cards.Count);
        Assert.True(view.HasData);

        Assert.Equal("Total Cost", view.Cards[0].Label);
        Assert.Equal("$1.50", view.Cards[0].Value);
        Assert.Equal("2 sessions", view.Cards[0].Subtitle);

        Assert.Equal("Avg $/kWh", view.Cards[1].Label);
        Assert.Equal("$0.050", view.Cards[1].Value);
        Assert.Equal("blended rate", view.Cards[1].Subtitle);

        Assert.Equal("Cost Per km", view.Cards[2].Label);
        Assert.Equal("$15.000", view.Cards[2].Value);
        Assert.Equal("per km", view.Cards[2].Subtitle);

        Assert.Equal("Total Energy", view.Cards[3].Label);
        Assert.Equal("30.0 kWh", view.Cards[3].Value);
        Assert.Equal("0.9 gal equiv", view.Cards[3].Subtitle);

        Assert.Equal("Gas Savings $", view.Cards[4].Label);
        Assert.Equal("$1.62", view.Cards[4].Value);
        Assert.Equal("vs $3.50/gal", view.Cards[4].Subtitle);

        Assert.Equal("Savings %", view.Cards[5].Label);
        Assert.Equal("51.9%", view.Cards[5].Value);
        Assert.Equal("vs gasoline", view.Cards[5].Subtitle);
    }

    [Fact]
    public void Project_imperial_uses_mile_noun_and_unit()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Imperial);
        var view = CostSummaryCardsProjection.Project(stats, CostSummaryCardsSettings.Default, UnitPref.Imperial, Localizer);

        Assert.Equal("Cost Per Mile", view.Cards[2].Label);
        Assert.Equal("per mi", view.Cards[2].Subtitle);
        Assert.Equal("$24.140", view.Cards[2].Value); // 1.5 / (100/1609.344)
    }

    [Fact]
    public void Project_honours_currency_symbol_and_gas_unit()
    {
        var settings = CostSummaryCardsSettings.Default with
        {
            CurrencySymbol = "\u00A3", // £
            GasUnit = CostSummaryCardsGasUnit.Liter,
        };
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), settings, UnitPref.Metric);
        var view = CostSummaryCardsProjection.Project(stats, settings, UnitPref.Metric, Localizer);

        Assert.StartsWith("\u00A3", view.Cards[0].Value, StringComparison.Ordinal);
        Assert.StartsWith("\u00A3", view.Cards[4].Value, StringComparison.Ordinal);
        Assert.EndsWith("/L", view.Cards[4].Subtitle, StringComparison.Ordinal); // litre gas unit
    }

    [Fact]
    public void Project_blank_currency_symbol_falls_back_to_dollar()
    {
        var settings = CostSummaryCardsSettings.Default with { CurrencySymbol = "  " };
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), settings, UnitPref.Metric);
        var view = CostSummaryCardsProjection.Project(stats, settings, UnitPref.Metric, Localizer);

        Assert.StartsWith("$", view.Cards[0].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_assigns_one_palette_index_per_web_icon_colour()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Metric);
        var view = CostSummaryCardsProjection.Project(stats, CostSummaryCardsSettings.Default, UnitPref.Metric, Localizer);

        // web icon colours cyan / yellow / blue / green / red / emerald -> six distinct accents.
        Assert.Equal(new[] { 0, 1, 2, 3, 4, 5 }, view.Cards.Select(c => c.ColorIndex).ToArray());
    }

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var stats = CostSummaryCoreStats.Compute(SampleSessions(), CostSummaryCardsSettings.Default, UnitPref.Metric);
        var view = CostSummaryCardsProjection.Project(stats, CostSummaryCardsSettings.Default, UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Subtitle, card.AutomationName, StringComparison.Ordinal);
            Assert.False(string.IsNullOrEmpty(card.Glyph));
        }
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal(33.7, CostSummaryCardsProjection.KwhPerGallon);
        Assert.Equal(1609.344, CostSummaryCardsProjection.MetersPerMile);
        Assert.Equal(3.5, CostSummaryCardsProjection.DefaultGasPrice);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":5000,"cost_decimal":2}]""");

        var cached = CostSummaryCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(5000, Assert.Single(cached.Value!).EnergyAddedWh);

        var offline = CostSummaryCardsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, Assert.Single(offline.Value!).CostDecimal);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");

        Assert.Equal(LoadStatus.Loaded, CostSummaryCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, CostSummaryCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostSummaryCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, CostSummaryCardsResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cards()
    {
        using var vm = NewViewModel(Loaded(SampleSessions()));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.Equal("$1.50", vm.Display.Cards[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Array.Empty<CostSummaryCardsSession>()));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No cost data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Cached(SampleSessions(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_chip()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.OfflineCached(
            SampleSessions(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loading(),
            RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Cached(SampleSessions(), Now, stale: false),
            RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loaded(SampleSessions(), Now));
        await vm.LoadAsync();

        Assert.Equal(CostSummaryCardsState.Loaded, vm.State);
        Assert.Equal("$1.50", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance_noun()
    {
        using var vm = NewViewModel(Loaded(SampleSessions()));
        await vm.LoadAsync();
        Assert.Equal("Cost Per km", vm.Display.Cards[2].Label);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("Cost Per Mile", vm.Display.Cards[2].Label);
    }

    [Fact]
    public async Task ViewModel_settings_change_reprojects_currency()
    {
        using var vm = NewViewModel(Loaded(SampleSessions()));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Cards[0].Value, StringComparison.Ordinal);

        vm.Settings = CostSummaryCardsSettings.Default with { CurrencySymbol = "\u00A3" }; // £

        Assert.StartsWith("\u00A3", vm.Display.Cards[0].Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Cost Summary", vm.Title);
        Assert.Equal("No cost data yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SampleSessions()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostSummaryCardsViewModel.State), changed);
        Assert.Contains(nameof(CostSummaryCardsViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client + vehicle source) -----

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new CostSummaryCardsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":20000,"cost_decimal":1},{"total_energy_added_wh":10000,"cost_decimal":0.5}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new CostSummaryCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Charging.Sessions, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new CostSummaryCardsSource(
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
        var source = new CostSummaryCardsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("cost-summary-cards", CostSummaryCardsRegistration.Id);
        Assert.Equal("charging", CostSummaryCardsRegistration.Category);
        Assert.Equal("CostSummaryCards", CostSummaryCardsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new CostSummaryCardsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostSummaryCards", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<CostSummaryCardsSession>> Loaded(IReadOnlyList<CostSummaryCardsSession> sessions) =>
        RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loaded(sessions, Now);

    private static CostSummaryCardsViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric, CostSummaryCardsSettings.Default);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>>> Drain(ICostSummaryCardsSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>[] emissions)
        : ICostSummaryCardsSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>> StreamAsync(
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
