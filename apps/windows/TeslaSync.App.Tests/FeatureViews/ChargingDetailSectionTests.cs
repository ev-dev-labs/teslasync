using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ChargingDetailSection's UI-thread-free logic — the
/// <c>charging_analytics</c> JSON parse adapter, the projection (brand leaderboard percentages, monthly-trend
/// rows, cost cards with currency + accents, cost-by-charger-type bars), the cache-then-network result
/// mapper, the registration metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/analytics/components/analytics/ChargingDetailSection.tsx).
/// </summary>
public sealed class ChargingDetailSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromFleetJson_reads_charging_analytics_sections()
    {
        const string json = """
        {
          "total_vehicles": 2,
          "charging_analytics": {
            "charger_brands": [ {"brand":"Tesla","count":10}, {"brand":"EVgo","count":4} ],
            "charger_types": [ {"type":"Supercharger","count":30}, {"type":"Home","count":10} ],
            "monthly_trend": [ {"month":"2026-01","energy":120.5,"avg_power":11.2,"sessions":6,"cost":18.2} ],
            "cost_stats": {"min":1.5,"max":8,"avg":3.25,"median":3,"p95":7,"count":40}
          }
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var data = ChargingDetailAnalytics.FromFleetJson(doc.RootElement);

        Assert.Equal(2, data.Brands.Count);
        Assert.Equal("Tesla", data.Brands[0].Brand);
        Assert.Equal(10, data.Brands[0].Count);
        Assert.Equal(2, data.ChargerTypes.Count);
        Assert.Equal("Supercharger", data.ChargerTypes[0].Type);
        Assert.Single(data.MonthlyTrend);
        Assert.Equal("2026-01", data.MonthlyTrend[0].Month);
        Assert.Equal(120.5, data.MonthlyTrend[0].Energy);
        Assert.Equal(11.2, data.MonthlyTrend[0].AvgPower);
        Assert.Equal(6, data.MonthlyTrend[0].Sessions);
        Assert.NotNull(data.CostStats);
        Assert.Equal(1.5, data.CostStats!.Min);
        Assert.Equal(3, data.CostStats.Median);
        Assert.Equal(8, data.CostStats.Max);
        Assert.True(data.HasAnyData);
    }

    [Fact]
    public void FromFleetJson_is_tolerant_of_missing_sections()
    {
        using var doc = JsonDocument.Parse("""{"charging_analytics":{"charger_types":[{"type":"Home"}]}}""");

        var data = ChargingDetailAnalytics.FromFleetJson(doc.RootElement);

        Assert.Empty(data.Brands);
        Assert.Empty(data.MonthlyTrend);
        Assert.Null(data.CostStats);
        Assert.Single(data.ChargerTypes);
        Assert.Equal("Home", data.ChargerTypes[0].Type);
        Assert.Equal(0, data.ChargerTypes[0].Count); // missing count -> 0
        Assert.True(data.HasAnyData);
    }

    [Fact]
    public void FromFleetJson_returns_empty_when_charging_analytics_absent()
    {
        using var doc = JsonDocument.Parse("""{"total_vehicles":3}""");
        var data = ChargingDetailAnalytics.FromFleetJson(doc.RootElement);
        Assert.False(data.HasAnyData);
        Assert.Empty(data.Brands);
        Assert.Empty(data.ChargerTypes);
        Assert.Empty(data.MonthlyTrend);
        Assert.Null(data.CostStats);
    }

    [Fact]
    public void FromFleetJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.False(ChargingDetailAnalytics.FromFleetJson(doc.RootElement).HasAnyData);
    }

    [Fact]
    public void FromFleetJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""
        {"charging_analytics":{"charger_brands":[{"brand":"Tesla","count":"7"}]}}
        """);

        var data = ChargingDetailAnalytics.FromFleetJson(doc.RootElement);
        Assert.Equal(7, data.Brands[0].Count);
    }

    [Fact]
    public void CostStats_present_even_when_all_zero_gates_cards()
    {
        using var doc = JsonDocument.Parse("""
        {"charging_analytics":{"cost_stats":{"min":0,"max":0,"avg":0,"median":0}}}
        """);

        var data = ChargingDetailAnalytics.FromFleetJson(doc.RootElement);
        Assert.NotNull(data.CostStats);
        Assert.True(data.HasAnyData);
    }

    // ---- Projection (brand leaderboard) --------------------------------------------

    [Fact]
    public void Project_brand_leaderboard_ranks_and_scales_bars()
    {
        var data = Analytics(brands: new[]
        {
            new ChargingDetailBrand("Tesla", 10),
            new ChargingDetailBrand("EVgo", 5),
        });

        var view = ChargingDetailProjection.Project(data, "$", Localizer);

        Assert.True(view.HasBrands);
        Assert.Equal(2, view.Brands.Count);

        Assert.Equal("#1 Tesla", view.Brands[0].Label);
        Assert.Equal(10, view.Brands[0].Value);
        Assert.Equal(10, view.Brands[0].Max);          // maxCount
        Assert.Equal("10 sessions", view.Brands[0].ValueText);
        Assert.Equal(ChargingDetailProjection.BrandAccentKey, view.Brands[0].AccentBrushKey);

        Assert.Equal("#2 EVgo", view.Brands[1].Label);
        Assert.Equal(5, view.Brands[1].Value);
        Assert.Equal(10, view.Brands[1].Max);          // bar = 5/10
    }

    [Fact]
    public void Project_brand_leaderboard_empty_renders_empty_state()
    {
        var view = ChargingDetailProjection.Project(ChargingDetailAnalytics.Empty, "$", Localizer);
        Assert.False(view.HasBrands);
        Assert.Empty(view.Brands);
        Assert.Equal("No charger brand data", view.NoBrandsMessage);
    }

    // ---- Projection (monthly trend) ------------------------------------------------

    [Fact]
    public void Project_monthly_rows_format_series_values()
    {
        var data = Analytics(monthly: new[]
        {
            new ChargingDetailMonthPoint("2026-01", 120, 11.5, 6),
        });

        var view = ChargingDetailProjection.Project(data, "$", Localizer);

        Assert.True(view.HasMonthly);
        var row = Assert.Single(view.Monthly);
        Assert.Equal("2026-01", row.Month);
        Assert.Equal(120, row.Energy);
        Assert.Equal(11.5, row.AvgPower);
        Assert.Equal(6, row.Sessions);
        Assert.Equal("120.0", row.EnergyText);
        Assert.Equal("11.5", row.AvgPowerText);
        Assert.Equal("6", row.SessionsText);
        Assert.Equal("Energy (kWh)", view.EnergySeriesLabel);
        Assert.Equal("Avg Power (kW)", view.AvgPowerSeriesLabel);
        Assert.Equal("Sessions", view.SessionsSeriesLabel);
    }

    [Fact]
    public void Project_monthly_empty_renders_empty_state()
    {
        var view = ChargingDetailProjection.Project(ChargingDetailAnalytics.Empty, "$", Localizer);
        Assert.False(view.HasMonthly);
        Assert.Equal("No monthly data", view.NoMonthlyMessage);
    }

    // ---- Projection (cost cards) ---------------------------------------------------

    [Fact]
    public void Project_cost_cards_format_currency_and_assign_accents()
    {
        var data = Analytics(cost: new ChargingDetailCostStats(1.5, 3.25, 3, 8));

        var view = ChargingDetailProjection.Project(data, "$", Localizer);

        Assert.True(view.HasCostStats);
        Assert.Equal(4, view.CostCards.Count);

        Assert.Equal("Min Cost", view.CostCards[0].Label);
        Assert.Equal("$1.50", view.CostCards[0].Value);
        Assert.Equal("TsColorSuccessBrush", view.CostCards[0].AccentBrushKey);   // green

        Assert.Equal("Avg Cost", view.CostCards[1].Label);
        Assert.Equal("$3.25", view.CostCards[1].Value);
        Assert.Equal("TsColorInfoBrush", view.CostCards[1].AccentBrushKey);      // cyan

        Assert.Equal("Median Cost", view.CostCards[2].Label);
        Assert.Equal("$3.00", view.CostCards[2].Value);
        Assert.Equal("TsChartPowerBrush", view.CostCards[2].AccentBrushKey);     // purple

        Assert.Equal("Max Cost", view.CostCards[3].Label);
        Assert.Equal("$8.00", view.CostCards[3].Value);
        Assert.Equal("TsColorWarningBrush", view.CostCards[3].AccentBrushKey);   // amber
    }

    [Fact]
    public void Project_cost_cards_respect_currency_symbol()
    {
        var data = Analytics(cost: new ChargingDetailCostStats(1.5, 3.25, 3, 8));
        var view = ChargingDetailProjection.Project(data, "\u20AC", Localizer); // €
        Assert.StartsWith("\u20AC", view.CostCards[0].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_cost_empty_renders_empty_state()
    {
        var view = ChargingDetailProjection.Project(ChargingDetailAnalytics.Empty, "$", Localizer);
        Assert.False(view.HasCostStats);
        Assert.Empty(view.CostCards);
        Assert.Equal("No cost statistics", view.NoCostStatsMessage);
    }

    // ---- Projection (cost by charger type) -----------------------------------------

    [Fact]
    public void Project_charger_type_bars_compute_share_and_cycle_palette()
    {
        var data = Analytics(types: new[]
        {
            new ChargingDetailChargerType("Supercharger", 30),
            new ChargingDetailChargerType("Home", 10),
        });

        var view = ChargingDetailProjection.Project(data, "$", Localizer);

        Assert.True(view.HasChargerTypes);
        Assert.Equal(2, view.ChargerTypes.Count);

        Assert.Equal("Supercharger", view.ChargerTypes[0].Label);
        Assert.Equal(30, view.ChargerTypes[0].Value);
        Assert.Equal(40, view.ChargerTypes[0].Max);          // totalSessions
        Assert.Equal("30 (75%)", view.ChargerTypes[0].ValueText);
        Assert.Equal(ChartPalette.KeyForIndex(0), view.ChargerTypes[0].AccentBrushKey);

        Assert.Equal("Home", view.ChargerTypes[1].Label);
        Assert.Equal("10 (25%)", view.ChargerTypes[1].ValueText);
        Assert.Equal(ChartPalette.KeyForIndex(1), view.ChargerTypes[1].AccentBrushKey);
    }

    [Fact]
    public void Project_charger_type_empty_renders_empty_state()
    {
        var view = ChargingDetailProjection.Project(ChargingDetailAnalytics.Empty, "$", Localizer);
        Assert.False(view.HasChargerTypes);
        Assert.Equal("No charger type data", view.NoChargerTypesMessage);
    }

    [Fact]
    public void Project_all_sections_have_accessibility_names()
    {
        var data = Analytics(
            brands: new[] { new ChargingDetailBrand("Tesla", 10) },
            types: new[] { new ChargingDetailChargerType("Home", 5) },
            cost: new ChargingDetailCostStats(1, 2, 3, 4),
            monthly: new[] { new ChargingDetailMonthPoint("2026-01", 10, 5, 2) });

        var view = ChargingDetailProjection.Project(data, "$", Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.All(view.Brands, b => Assert.False(string.IsNullOrWhiteSpace(b.AutomationName)));
        Assert.All(view.ChargerTypes, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.All(view.CostCards, c => Assert.Contains(c.Label, c.AutomationName, StringComparison.Ordinal));
        Assert.All(view.Monthly, m => Assert.Contains(m.Month, m.AutomationName, StringComparison.Ordinal));
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""
        {"charging_analytics":{"charger_brands":[{"brand":"Tesla","count":3}]}}
        """);

        var cached = ChargingDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("Tesla", cached.Value!.Brands[0].Brand);

        var offline = ChargingDetailResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasAnyData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"charging_analytics":{}}""");

        Assert.Equal(LoadStatus.Loaded, ChargingDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargingDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargingDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailAnalytics>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Loading, vm.State);
        Assert.False(vm.HasAnyData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_sections()
    {
        using var vm = NewViewModel(Loaded(Analytics(
            brands: new[] { new ChargingDetailBrand("Tesla", 10) },
            cost: new ChargingDetailCostStats(1, 2, 3, 4))));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Loaded, vm.State);
        Assert.True(vm.HasAnyData);
        Assert.True(vm.Display.HasBrands);
        Assert.True(vm.Display.HasCostStats);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty_but_keeps_panels()
    {
        using var vm = NewViewModel(Loaded(ChargingDetailAnalytics.Empty));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Empty, vm.State);
        Assert.False(vm.HasAnyData);
        // The four panels still render their per-section empty states (web parity, never a blank box).
        Assert.Equal("No charger brand data", vm.Display.NoBrandsMessage);
        Assert.Equal("No monthly data", vm.Display.NoMonthlyMessage);
        Assert.Equal("No cost statistics", vm.Display.NoCostStatsMessage);
        Assert.Equal("No charger type data", vm.Display.NoChargerTypesMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailAnalytics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Empty, vm.State);
        Assert.False(vm.HasAnyData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingDetailAnalytics>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailAnalytics>.Cached(
            Analytics(brands: new[] { new ChargingDetailBrand("Tesla", 10) }), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasAnyData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailAnalytics>.OfflineCached(
            Analytics(brands: new[] { new ChargingDetailBrand("Tesla", 10) }),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Offline, vm.State);
        Assert.True(vm.HasAnyData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingDetailAnalytics>.Loading(),
            RepositoryResult<ChargingDetailAnalytics>.Cached(
                Analytics(brands: new[] { new ChargingDetailBrand("EVgo", 2) }), Now, stale: false),
            RepositoryResult<ChargingDetailAnalytics>.Loaded(
                Analytics(brands: new[] { new ChargingDetailBrand("Tesla", 9) }), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Loaded, vm.State);
        Assert.Equal("#1 Tesla", vm.Display.Brands[0].Label);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_cards()
    {
        using var vm = NewViewModel(Loaded(Analytics(cost: new ChargingDetailCostStats(1.5, 2, 3, 4))));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.CostCards[0].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.CostCards[0].Value, StringComparison.Ordinal);
        Assert.Equal(ChargingDetailState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailAnalytics>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Charging Detail", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Analytics(brands: new[] { new ChargingDetailBrand("Tesla", 1) })));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargingDetailViewModel.State), changed);
        Assert.Contains(nameof(ChargingDetailViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("charging-detail-section", ChargingDetailRegistration.Id);
        Assert.Equal("analytics", ChargingDetailRegistration.Category);
        Assert.Equal("ChargingDetailSection", ChargingDetailRegistration.Slug);
        Assert.Equal(30, ChargingDetailRegistration.DefaultDays);
        Assert.Equal("Charging Detail", ChargingDetailRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingDetailDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingDetailSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ChargingDetailAnalytics Analytics(
        IReadOnlyList<ChargingDetailBrand>? brands = null,
        IReadOnlyList<ChargingDetailChargerType>? types = null,
        IReadOnlyList<ChargingDetailMonthPoint>? monthly = null,
        ChargingDetailCostStats? cost = null) =>
        new(
            brands ?? Array.Empty<ChargingDetailBrand>(),
            types ?? Array.Empty<ChargingDetailChargerType>(),
            monthly ?? Array.Empty<ChargingDetailMonthPoint>(),
            cost);

    private static RepositoryResult<ChargingDetailAnalytics> Loaded(ChargingDetailAnalytics data) =>
        RepositoryResult<ChargingDetailAnalytics>.Loaded(data, Now);

    private static ChargingDetailViewModel NewViewModel(params RepositoryResult<ChargingDetailAnalytics>[] emissions) =>
        new(new FakeChargingDetailSource(emissions), Localizer, "$", () => Now);

    private sealed class FakeChargingDetailSource(params RepositoryResult<ChargingDetailAnalytics>[] emissions) : IChargingDetailSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingDetailAnalytics>> StreamAsync(
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
}
