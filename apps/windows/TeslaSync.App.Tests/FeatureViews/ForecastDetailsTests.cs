using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ForecastDetails</c> surface's UI-thread-free logic — the cost-forecast
/// JSON parse adapter (breakdown home/supercharger + gas_comparison + insights, with the web <c>safe()</c>
/// coercion), the projection (currency formatting at the web precisions, the donut segments, the empty copy,
/// the a11y names), the cache-then-network result mapper, the repository source's request shape (vehicle_id +
/// months), the state-holder view-model's per-state matrix (loading / loaded / empty / error / stale /
/// offline), the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx).
/// </summary>
public sealed class ForecastDetailsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private const string ForecastJson = """
    {
      "historical": [ { "month": "2026-01", "cost": 60, "kwh": 500, "sessions": 8, "cost_per_kwh": 0.12 } ],
      "forecast": [ { "month": "2026-07", "cost": 62, "cost_low": 55, "cost_high": 70, "kwh": 510 } ],
      "breakdown": {
        "home": { "pct": 70, "avg_cost_per_kwh": 0.12, "monthly_avg": 40 },
        "supercharger": { "pct": 30, "avg_cost_per_kwh": 0.45, "monthly_avg": 25 }
      },
      "gas_comparison": {
        "avg_km_per_month": 1500,
        "gas_cost_per_month": 180,
        "ev_cost_per_month": 65,
        "monthly_savings": 115,
        "annual_savings": 1380,
        "lifetime_savings": 13800
      },
      "insights": [ "Charge at home to save more", "Avoid peak supercharger hours" ]
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_breakdown_gas_and_insights()
    {
        using var doc = JsonDocument.Parse(ForecastJson);
        var snapshot = CostForecastSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(70, snapshot.Breakdown.Home.Percent);
        Assert.Equal(0.12, snapshot.Breakdown.Home.AvgCostPerKwh, 6);
        Assert.Equal(30, snapshot.Breakdown.Supercharger.Percent);
        Assert.Equal(0.45, snapshot.Breakdown.Supercharger.AvgCostPerKwh, 6);

        Assert.Equal(1500, snapshot.GasComparison.AvgKmPerMonth);
        Assert.Equal(180, snapshot.GasComparison.GasCostPerMonth);
        Assert.Equal(65, snapshot.GasComparison.EvCostPerMonth);
        Assert.Equal(115, snapshot.GasComparison.MonthlySavings);
        Assert.Equal(1380, snapshot.GasComparison.AnnualSavings);
        Assert.Equal(13800, snapshot.GasComparison.LifetimeSavings);

        Assert.Equal(2, snapshot.Insights.Count);
        Assert.Equal("Charge at home to save more", snapshot.Insights[0]);
    }

    [Fact]
    public void FromJson_coerces_missing_and_non_numeric_fields_to_zero()
    {
        using var doc = JsonDocument.Parse("""
        { "breakdown": { "home": { "pct": "oops", "avg_cost_per_kwh": null } }, "gas_comparison": {} }
        """);
        var snapshot = CostForecastSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(0, snapshot.Breakdown.Home.Percent);
        Assert.Equal(0, snapshot.Breakdown.Home.AvgCostPerKwh);
        Assert.Equal(0, snapshot.Breakdown.Supercharger.Percent); // sub-object absent -> zero
        Assert.Equal(0, snapshot.GasComparison.MonthlySavings);
        Assert.Empty(snapshot.Insights);
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""
        { "breakdown": { "supercharger": { "pct": "30", "avg_cost_per_kwh": "0.45" } } }
        """);
        var snapshot = CostForecastSnapshot.FromJson(doc.RootElement);

        Assert.Equal(30, snapshot.Breakdown.Supercharger.Percent);
        Assert.Equal(0.45, snapshot.Breakdown.Supercharger.AvgCostPerKwh, 6);
    }

    [Fact]
    public void FromJson_insights_keeps_only_non_empty_strings()
    {
        using var doc = JsonDocument.Parse("""
        { "insights": [ 1, "keep", null, "", "second" ] }
        """);
        var snapshot = CostForecastSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Equal(new[] { "keep", "second" }, snapshot.Insights);
    }

    [Fact]
    public void FromJson_is_tolerant_of_empty_non_object_and_non_forecast()
    {
        using var empty = JsonDocument.Parse("{}");
        Assert.False(CostForecastSnapshot.FromJson(empty.RootElement).HasData);

        using var notObject = JsonDocument.Parse("[]");
        Assert.False(CostForecastSnapshot.FromJson(notObject.RootElement).HasData);

        using var notForecast = JsonDocument.Parse("""{ "historical": [] }""");
        Assert.False(CostForecastSnapshot.FromJson(notForecast.RootElement).HasData);
    }

    [Theory]
    [InlineData("""{ "breakdown": {} }""", true)]
    [InlineData("""{ "gas_comparison": {} }""", true)]
    [InlineData("""{ "insights": [] }""", true)]
    [InlineData("""{ "unrelated": 1 }""", false)]
    public void HasData_gate_matches_presence_of_forecast_keys(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, CostForecastSnapshot.FromJson(doc.RootElement).HasData);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_formats_labels_currency_and_segments()
    {
        var view = ForecastDetailsProjection.Project(Sample(), Localizer);

        Assert.True(view.HasData);
        Assert.Equal("Charging Breakdown", view.BreakdownTitle);
        Assert.Equal("Gas vs EV Savings", view.SavingsTitle);
        Assert.Equal("Insights", view.InsightsTitle);

        Assert.Equal(2, view.Segments.Count);
        Assert.Equal("Home", view.Segments[0].Name);
        Assert.Equal(70, view.Segments[0].Percent);
        Assert.Equal("$0.120/kWh", view.Segments[0].CostPerKwhText);
        Assert.Equal(0, view.Segments[0].ColorIndex);
        Assert.Equal("Supercharger", view.Segments[1].Name);
        Assert.Equal("$0.450/kWh", view.Segments[1].CostPerKwhText);
        Assert.Equal(1, view.Segments[1].ColorIndex);
        Assert.Equal("Home 70%, Supercharger 30%", view.ChartSummary);

        Assert.Equal(115, view.MonthlySavingsValue);
        Assert.Equal("$115", view.MonthlySavingsText);
        Assert.Equal("Monthly Savings", view.MonthlySavingsLabel);
        Assert.Equal("Annual", view.AnnualLabel);
        Assert.Equal("$1,380", view.AnnualText);
        Assert.Equal("Lifetime", view.LifetimeLabel);
        Assert.Equal("$13,800", view.LifetimeText);
        Assert.Equal("Gas cost/mo", view.GasCostLabel);
        Assert.Equal("$180.00", view.GasCostText);
        Assert.Equal("EV cost/mo", view.EvCostLabel);
        Assert.Equal("$65.00", view.EvCostText);
        Assert.Equal("Avg km/mo", view.AvgKmLabel);
        Assert.Equal("1,500", view.AvgKmText);

        Assert.Equal(new[] { "Charge at home to save more", "Avoid peak supercharger hours" }, view.Insights);
        Assert.Equal("$", view.CurrencySymbol);
    }

    [Fact]
    public void Project_honours_custom_currency_symbol()
    {
        var view = ForecastDetailsProjection.Project(Sample(), Localizer, "\u20AC");

        Assert.Equal("\u20AC0.120/kWh", view.Segments[0].CostPerKwhText);
        Assert.Equal("\u20AC115", view.MonthlySavingsText);
        Assert.Equal("\u20AC1,380", view.AnnualText);
        Assert.Equal("\u20AC180.00", view.GasCostText);
        Assert.Equal("\u20AC", view.CurrencySymbol);
    }

    [Fact]
    public void Project_without_data_has_no_segments_but_keeps_empty_copy()
    {
        var view = ForecastDetailsProjection.Project(CostForecastSnapshot.Empty, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Segments);
        Assert.Equal(string.Empty, view.ChartSummary);
        Assert.Empty(view.Insights);
        Assert.Equal("Breakdown will appear once charging data is available.", view.NoBreakdownMessage);
        Assert.Equal("Savings data will appear once driving history is available.", view.NoSavingsMessage);
        Assert.Equal("Insights will appear as more data is collected.", view.NoInsightsMessage);
    }

    [Fact]
    public void Project_segment_automation_names_carry_label_and_cost()
    {
        var view = ForecastDetailsProjection.Project(Sample(), Localizer);

        Assert.Contains(view.Segments[0].Name, view.Segments[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.Segments[0].CostPerKwhText, view.Segments[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.MonthlySavingsLabel, view.SavingsAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.MonthlySavingsText, view.SavingsAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_constants_match_web_precisions()
    {
        Assert.Equal("$", ForecastDetailsProjection.DefaultCurrencySymbol);
        Assert.Equal(3, ForecastDetailsProjection.CostPerKwhPrecision);
        Assert.Equal(0, ForecastDetailsProjection.SavingsPrecision);
        Assert.Equal(2, ForecastDetailsProjection.MonthlyCostPrecision);
    }

    // ---- i18n: every source label resolves through its catalog key -----------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = ForecastDetailsProjection.Project(Sample(), echo);

        Assert.Equal("L:costAnalysis.forecast.breakdown", view.BreakdownTitle);
        Assert.Equal("L:costAnalysis.forecast.savings", view.SavingsTitle);
        Assert.Equal("L:costAnalysis.forecast.insights", view.InsightsTitle);
        Assert.Equal("L:costAnalysis.forecast.monthlySavings", view.MonthlySavingsLabel);
        Assert.Equal("L:costAnalysis.forecast.annual", view.AnnualLabel);
        Assert.Equal("L:costAnalysis.forecast.lifetime", view.LifetimeLabel);
        Assert.Equal("L:costAnalysis.forecast.gasCost", view.GasCostLabel);
        Assert.Equal("L:costAnalysis.forecast.evCost", view.EvCostLabel);
        Assert.Equal("L:costAnalysis.forecast.avgKm", view.AvgKmLabel);
        Assert.Equal("L:Home", view.Segments[0].Name);
        Assert.Equal("L:Supercharger", view.Segments[1].Name);

        var emptyView = ForecastDetailsProjection.Project(CostForecastSnapshot.Empty, echo);
        Assert.Equal("L:costAnalysis.forecast.noBreakdown", emptyView.NoBreakdownMessage);
        Assert.Equal("L:costAnalysis.forecast.noSavings", emptyView.NoSavingsMessage);
        Assert.Equal("L:costAnalysis.forecast.noInsights", emptyView.NoInsightsMessage);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(ForecastJson);

        var cached = CostForecastResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal(115, cached.Value.GasComparison.MonthlySavings);

        var offline = CostForecastResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Map_maps_loading_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ForecastJson);

        Assert.Equal(LoadStatus.Loaded, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasData);
        Assert.Equal("$115", vm.Display.MonthlySavingsText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(CostForecastSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(vm.Display.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.NoBreakdownMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecastSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecastSnapshot>.Loading(),
            RepositoryResult<CostForecastSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<CostForecastSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(ForecastDetailsState.Loaded, vm.State);
        Assert.Equal("$115", vm.Display.MonthlySavingsText);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("$115", vm.Display.MonthlySavingsText);

        vm.CurrencySymbol = "\u20AC";

        Assert.Equal("\u20AC115", vm.Display.MonthlySavingsText);
        Assert.Equal("\u20AC0.120/kWh", vm.Display.Segments[0].CostPerKwhText);
    }

    [Fact]
    public async Task ViewModel_title_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecastSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Cost Forecast Details", vm.Title);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ForecastDetailsViewModel.State), changed);
        Assert.Contains(nameof(ForecastDetailsViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_request_with_months()
    {
        using var doc = JsonDocument.Parse(ForecastJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new ForecastDetailsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.True(emissions[^1].Value!.HasData);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_cost_forecast", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(6, Convert.ToInt32(request.Query["months"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_and_months_win()
    {
        using var doc = JsonDocument.Parse(ForecastJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new ForecastDetailsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), months: 3, vehicleId: 42);

        await Collect(source.StreamAsync());

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(3, Convert.ToInt32(request.Query["months"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ForecastDetailsSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_empty_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new ForecastDetailsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_id_and_default_months()
    {
        Assert.Equal("get_api_v1_analytics_cost_forecast", ForecastDetailsSource.OperationId);
        Assert.Equal(6, ForecastDetailsSource.DefaultMonths);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("forecast-details", ForecastDetailsRegistration.Id);
        Assert.Equal("charging", ForecastDetailsRegistration.Category);
        Assert.Equal("ForecastDetails", ForecastDetailsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new ForecastDetailsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=ForecastDetails", line);
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CostForecastSnapshot Sample()
    {
        using var doc = JsonDocument.Parse(ForecastJson);
        return CostForecastSnapshot.FromJson(doc.RootElement);
    }

    private static RepositoryResult<CostForecastSnapshot> Loaded(CostForecastSnapshot snapshot) =>
        RepositoryResult<CostForecastSnapshot>.Loaded(snapshot, Now);

    private static ForecastDetailsViewModel NewViewModel(params RepositoryResult<CostForecastSnapshot>[] emissions) =>
        new(new FakeForecastSource(emissions), Localizer);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<CostForecastSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<CostForecastSnapshot>> stream)
    {
        var list = new List<RepositoryResult<CostForecastSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeForecastSource(params RepositoryResult<CostForecastSnapshot>[] emissions) : IForecastDetailsSource
    {
        public async IAsyncEnumerable<RepositoryResult<CostForecastSnapshot>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
