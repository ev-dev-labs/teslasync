using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>TrueCostPage</c>'s UI-thread-free logic — the TCO JSON parse
/// adapter, the SI→display projection (hero stat cards, cumulative-savings area series, cost-per-km
/// comparison bars + chips, monthly EV-vs-gas bars, savings-breakdown cards), the cache-then-network result
/// mapper, the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline), the i18n key coverage, the registration metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/analytics/pages/TrueCostPage.tsx).
/// </summary>
public sealed class TrueCostPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the page renders (web key names) — parity string coverage.</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "common.unit.gallon", "common.unit.liter",
        "tco.costKm", "tco.costPerKm", "tco.costPerKm.aria",
        "tco.cumulativeSavings", "tco.cumulativeSavings.aria",
        "tco.electricityVsGas", "tco.equivGasCost", "tco.evCost", "tco.evElectric",
        "tco.fuelSavings", "tco.gasEquiv", "tco.iceGas", "tco.maintenanceSavings",
        "tco.monthlyEvVsGas", "tco.monthlyEvVsGas.aria", "tco.monthlySavings",
        "tco.noData", "tco.noMonthlyData", "tco.noOilChanges", "tco.overMonths",
        "tco.perKmEv", "tco.perKmGas", "tco.plusMaintenance", "tco.savingsBreakdown",
        "tco.sessions", "tco.subtitle", "tco.title",
        "tco.totalEstSavings", "tco.totalEvCost", "tco.totalSavings",
    ];

    private static TrueCostMonth[] SampleMonths() =>
    [
        new("2026-01", 10, 22, 12, 50_000),
        new("2026-02", 20, 40, 32, 90_000),
        new("2026-03", 5, 15, 42, 30_000),
    ];

    private static TrueCostBreakdown Sample(IReadOnlyList<TrueCostMonth>? months = null) =>
        new(
            TotalChargingCost: 35,
            TotalWh: 170_000,
            TotalSessions: 12,
            TotalKm: 1000,
            FirstDate: "2025-06-01",
            LastDate: "2026-06-01",
            EquivalentGasCost: 80,
            TotalSavings: 45,
            MonthlySavings: 8,
            CostPerKmEv: 0.05,
            CostPerKmIce: 0.12,
            MaintenanceSavingsEstimate: 50,
            MonthsOfOwnership: 12,
            GasPrice: 3.5,
            GasEfficiencyMpg: 30,
            MonthlyBreakdown: months ?? SampleMonths());

    private static TrueCostDisplay Project(TrueCostBreakdown data, UnitPref? units = null, string symbol = "$") =>
        TrueCostProjection.Project(data, units ?? UnitPref.Metric, symbol, TrueCostProjection.DefaultPrecision, GasUnit.Gallon, Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"vehicle_id":1,"total_charging_cost":35.5,"total_wh":170000,"total_sessions":12,"total_km":1234.0,
         "first_date":"2025-06-01","last_date":"2026-06-01","equivalent_gas_cost":80.0,"total_savings":120.0,
         "monthly_savings":8.25,"cost_per_km_ev":0.05,"cost_per_km_ice":0.12,"maintenance_savings_estimate":50,
         "months_of_ownership":12,"gas_price":3.5,"gas_efficiency_mpg":30,"monthly_breakdown":[
           {"month":"2026-01","ev_cost":10.0,"equiv_gas_cost":22,"cumulative_savings":12,"energy_wh":50000},
           {"month":"2026-02","ev_cost":20.0,"equiv_gas_cost":40,"cumulative_savings":32,"energy_wh":90000}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = TrueCostBreakdown.FromJson(doc.RootElement);

        Assert.Equal(35.5, data.TotalChargingCost);
        Assert.Equal(170000, data.TotalWh);
        Assert.Equal(12, data.TotalSessions);
        Assert.Equal(1234.0, data.TotalKm);
        Assert.Equal("2025-06-01", data.FirstDate);
        Assert.Equal("2026-06-01", data.LastDate);
        Assert.Equal(80.0, data.EquivalentGasCost);
        Assert.Equal(120.0, data.TotalSavings);
        Assert.Equal(0.12, data.CostPerKmIce);
        Assert.Equal(2, data.MonthlyBreakdown.Count);
        Assert.Equal("2026-02", data.MonthlyBreakdown[1].Month);
        Assert.Equal(40, data.MonthlyBreakdown[1].EquivGasCost);
        Assert.Equal(32, data.MonthlyBreakdown[1].CumulativeSavings);
        Assert.True(data.HasMonthlyData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_cost":12}""");

        var data = TrueCostBreakdown.FromJson(doc.RootElement);

        Assert.Equal(12, data.TotalChargingCost);
        Assert.Equal(0, data.TotalSavings);
        Assert.Equal("\u2014", data.FirstDate);
        Assert.Empty(data.MonthlyBreakdown);
        Assert.False(data.HasMonthlyData);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Same(TrueCostBreakdown.Empty, TrueCostBreakdown.FromJson(doc.RootElement));
    }

    // ---- Projection: i18n coverage -------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        TrueCostProjection.Project(Sample(), UnitPref.Metric, "$", TrueCostProjection.DefaultPrecision, GasUnit.Gallon, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_required_keys_even_with_no_monthly_rows()
    {
        var recorder = new RecordingLocalizer();

        TrueCostProjection.Project(
            Sample(months: Array.Empty<TrueCostMonth>()), UnitPref.Metric, "$",
            TrueCostProjection.DefaultPrecision, GasUnit.Gallon, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Projection: hero stat panels (GlassPanel1..4) -----------------------------

    [Fact]
    public void Projection_builds_four_hero_stats()
    {
        var view = Project(Sample());

        Assert.Equal("Total EV Cost", view.TotalEvCost.Label);
        Assert.Equal("$35.00", view.TotalEvCost.Value);
        Assert.Contains("sessions", view.TotalEvCost.Sublabel, StringComparison.Ordinal);
        Assert.Contains("12", view.TotalEvCost.Sublabel, StringComparison.Ordinal);

        Assert.Equal("Equiv. Gas Cost", view.EquivGasCost.Label);
        Assert.Equal("$80.00", view.EquivGasCost.Value);
        Assert.Contains("gal", view.EquivGasCost.Sublabel, StringComparison.Ordinal);
        Assert.Contains("MPG", view.EquivGasCost.Sublabel, StringComparison.Ordinal);

        Assert.Equal("Total Savings", view.TotalSavings.Label);
        Assert.Equal("$45.00", view.TotalSavings.Value);
        Assert.Contains("12", view.TotalSavings.Sublabel, StringComparison.Ordinal); // Over 12 months

        Assert.Equal("Monthly Savings", view.MonthlySavings.Label);
        Assert.Equal("$8.00", view.MonthlySavings.Value);

        foreach (var stat in new[] { view.TotalEvCost, view.EquivGasCost, view.TotalSavings, view.MonthlySavings })
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(stat.Glyph));
        }
    }

    [Fact]
    public void Projection_uses_liter_label_when_gas_unit_is_liter()
    {
        var view = TrueCostProjection.Project(
            Sample(), UnitPref.Metric, "$", TrueCostProjection.DefaultPrecision, GasUnit.Liter, Localizer);

        Assert.Contains("/L", view.EquivGasCost.Sublabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_respects_currency_symbol()
    {
        var view = Project(Sample(), symbol: "\u20AC");

        Assert.StartsWith("\u20AC", view.TotalEvCost.Value, StringComparison.Ordinal);
        Assert.StartsWith("\u20AC", view.CostPerKmEvChipValue, StringComparison.Ordinal);
    }

    // ---- Projection: cost-per-km chips ---------------------------------------------

    [Fact]
    public void Projection_builds_cost_per_km_chips_at_three_decimals()
    {
        var view = Project(Sample());

        Assert.Equal("$0.050", view.CostPerKmEvChipValue);
        Assert.Equal("per km (EV)", view.CostPerKmEvChipLabel);
        Assert.Equal("$0.120", view.CostPerKmIceChipValue);
        Assert.Equal("per km (Gas)", view.CostPerKmIceChipLabel);
    }

    // ---- Projection: chart series (AreaChart + two BarCharts) ----------------------

    [Fact]
    public void Projection_builds_cumulative_area_series()
    {
        var view = Project(Sample());

        var series = Assert.Single(view.CumulativeSeries);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(3, series.Points.Count);
        Assert.Equal(42, series.Points[2].Y); // last cumulative_savings
        Assert.Equal("2026-03", series.Points[2].Label);
        Assert.True(view.HasMonthlyData);
    }

    [Fact]
    public void Projection_builds_cost_per_km_bar_series_with_two_points()
    {
        var view = Project(Sample());

        var series = Assert.Single(view.CostPerKmSeries);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal(2, series.Points.Count);
        Assert.Equal(0.05, series.Points[0].Y);
        Assert.Equal("EV (Electric)", series.Points[0].Label);
        Assert.Equal(0.12, series.Points[1].Y);
        Assert.Equal("ICE (Gas)", series.Points[1].Label);
    }

    [Fact]
    public void Projection_builds_monthly_ev_vs_gas_bar_series()
    {
        var view = Project(Sample());

        Assert.Equal(2, view.MonthlySeries.Count);
        Assert.All(view.MonthlySeries, s => Assert.Equal(ChartSeriesKind.Bar, s.Kind));
        Assert.Equal("EV Cost", view.MonthlySeries[0].Name);
        Assert.Equal("Gas Equiv.", view.MonthlySeries[1].Name);
        Assert.Equal(3, view.MonthlySeries[0].Points.Count);
        Assert.Equal(20, view.MonthlySeries[0].Points[1].Y);   // 2026-02 ev_cost
        Assert.Equal(40, view.MonthlySeries[1].Points[1].Y);   // 2026-02 equiv_gas_cost
    }

    [Fact]
    public void Projection_charts_are_empty_when_no_monthly_rows_but_cost_per_km_still_renders()
    {
        var view = Project(Sample(months: Array.Empty<TrueCostMonth>()));

        Assert.Empty(view.CumulativeSeries);
        Assert.Empty(view.MonthlySeries);
        Assert.Single(view.CostPerKmSeries); // scalar comparison still renders
        Assert.False(view.HasMonthlyData);
        Assert.Equal("No monthly data available yet", view.NoMonthlyDataMessage);
    }

    // ---- Projection: savings-breakdown cards (GlassPanel8) -------------------------

    [Fact]
    public void Projection_builds_savings_breakdown_cards()
    {
        var view = Project(Sample());

        Assert.Equal("Savings Breakdown", view.SavingsBreakdownTitle);

        Assert.Equal("Fuel Savings", view.FuelSavings.Label);
        Assert.Equal("$45.00", view.FuelSavings.Value);
        Assert.Equal("Electricity vs gasoline", view.FuelSavings.Sublabel);

        Assert.Equal("Maintenance Savings (Est.)", view.MaintenanceSavings.Label);
        Assert.Equal("$50.00", view.MaintenanceSavings.Value);

        Assert.Equal("Total Estimated Savings", view.TotalEstimatedSavings.Label);
        Assert.Equal("$95.00", view.TotalEstimatedSavings.Value); // 45 + 50
        Assert.Contains("2025-06-01", view.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);
        Assert.Contains("2026-06-01", view.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_total_estimated_sublabel_restates_distance_in_imperial()
    {
        var metric = Project(Sample(), UnitPref.Metric);
        var imperial = Project(Sample(), UnitPref.Imperial);

        Assert.Contains("km", metric.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);
        Assert.Contains("mi", imperial.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_cost":35,"cost_per_km_ice":0.1}""");

        var cached = TrueCostResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(35, cached.Value!.TotalChargingCost);

        var offline = TrueCostResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(0.1, offline.Value!.CostPerKmIce);

        Assert.Equal(LoadStatus.Empty, TrueCostResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, TrueCostResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix (loading / empty / error / success) ----------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<TrueCostBreakdown>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Loading, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_hero_charts_and_breakdown()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal("$35.00", vm.Display.TotalEvCost.Value);
        Assert.Single(vm.Display.CumulativeSeries);
        Assert.Equal(2, vm.Display.MonthlySeries.Count);
        Assert.True(vm.Display.HasMonthlyData);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_months_still_renders_success()
    {
        // Web parity: a populated-but-charging-empty TCO object renders the full layout, not the empty page.
        using var vm = NewViewModel(Loaded(Sample(months: Array.Empty<TrueCostMonth>())));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.False(vm.Display.HasMonthlyData);
        Assert.Empty(vm.Display.CumulativeSeries);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_state()
    {
        using var vm = NewViewModel(RepositoryResult<TrueCostBreakdown>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Empty, vm.State);
        Assert.False(vm.HasContent);
        Assert.Equal("No data available. Start charging to see your cost analysis.", vm.Display.NoDataMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error()
    {
        using var vm = NewViewModel(
            RepositoryResult<TrueCostBreakdown>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<TrueCostBreakdown>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_error()
    {
        using var vm = NewViewModel(RepositoryResult<TrueCostBreakdown>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<TrueCostBreakdown>.Loading(),
            RepositoryResult<TrueCostBreakdown>.Cached(Sample(), Now, stale: false),
            RepositoryResult<TrueCostBreakdown>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Loaded, vm.State);
        Assert.Equal("$35.00", vm.Display.TotalEvCost.Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Contains("km", vm.Display.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);

        vm.Units = UnitPref.Imperial;
        Assert.Contains("mi", vm.Display.TotalEstimatedSavings.Sublabel, StringComparison.Ordinal);
        Assert.Equal(TrueCostState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_costs()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.TotalEvCost.Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.TotalEvCost.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_gas_unit_change_reprojects_label()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Contains("/gal", vm.Display.EquivGasCost.Sublabel, StringComparison.Ordinal);

        vm.GasUnit = GasUnit.Liter;
        Assert.Contains("/L", vm.Display.EquivGasCost.Sublabel, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_title_and_subtitle_resolve_through_i18n()
    {
        using var vm = NewViewModel();
        Assert.Equal("True Cost of Ownership", vm.Title);
        Assert.Contains("gas vehicle", vm.Subtitle, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TrueCostPageViewModel.State), changed);
        Assert.Contains(nameof(TrueCostPageViewModel.Display), changed);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_web_route()
    {
        Assert.Equal("TrueCostOwnership", TrueCostRegistration.RouteName);
        Assert.Equal("TrueCostPage", TrueCostRegistration.Slug);
        Assert.Equal("True Cost of Ownership", TrueCostRegistration.Title(Localizer));
        Assert.Contains("gas vehicle", TrueCostRegistration.Subtitle(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TrueCostDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TrueCostPage", Assert.Single(lines));
    }

    [Fact]
    public async Task Empty_source_yields_empty_result()
    {
        using var vm = new TrueCostPageViewModel(EmptyTrueCostBreakdownSource.Instance, Localizer, clock: () => Now);
        await vm.LoadAsync();

        Assert.Equal(TrueCostState.Empty, vm.State);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<TrueCostBreakdown> Loaded(TrueCostBreakdown data) =>
        RepositoryResult<TrueCostBreakdown>.Loaded(data, Now);

    private static TrueCostPageViewModel NewViewModel(params RepositoryResult<TrueCostBreakdown>[] emissions) =>
        new(
            new FakeTrueCostSource(emissions),
            Localizer,
            UnitPref.Metric,
            "$",
            TrueCostProjection.DefaultPrecision,
            GasUnit.Gallon,
            () => Now);

    private sealed class FakeTrueCostSource(params RepositoryResult<TrueCostBreakdown>[] emissions) : ITrueCostBreakdownSource
    {
        public async IAsyncEnumerable<RepositoryResult<TrueCostBreakdown>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
