using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the CostBreakdownWidget's UI-thread-free logic — the TCO JSON parse adapter,
/// the SI→display projection (current-month compact number, donut slices, ranked monthly list, and the
/// three cost/savings stat cards with units + currency), the cache-then-network result mapper, the
/// footprint flag, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx).
/// </summary>
public sealed class CostBreakdownWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static CostBreakdown Sample(
        double totalChargingCost = 35,
        double totalSavings = 100,
        double monthlySavings = 8,
        double costPerKmEv = 0.05,
        IReadOnlyList<CostBreakdownMonth>? months = null) =>
        new(
            totalChargingCost,
            totalSavings,
            monthlySavings,
            costPerKmEv,
            months ?? new[]
            {
                new CostBreakdownMonth("2026-01", 10),
                new CostBreakdownMonth("2026-02", 20),
                new CostBreakdownMonth("2026-03", 5),
            });

    private static CostBreakdownDisplay Project(
        CostBreakdown data, CostBreakdownSize size, UnitPref units, string symbol = "$") =>
        CostBreakdownProjection.Project(data, size, units, symbol, CostBreakdownProjection.DefaultPrecision, Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"vehicle_id":1,"total_charging_cost":35.5,"total_savings":120.0,"monthly_savings":8.25,
         "cost_per_km_ev":0.05,"monthly_breakdown":[
           {"month":"2026-01","ev_cost":10.0,"equiv_gas_cost":20,"cumulative_savings":10,"energy_wh":50000},
           {"month":"2026-02","ev_cost":20.0,"energy_wh":90000}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = CostBreakdown.FromJson(doc.RootElement);

        Assert.Equal(35.5, data.TotalChargingCost);
        Assert.Equal(120.0, data.TotalSavings);
        Assert.Equal(8.25, data.MonthlySavings);
        Assert.Equal(0.05, data.CostPerKmEv);
        Assert.Equal(2, data.MonthlyBreakdown.Count);
        Assert.Equal("2026-02", data.MonthlyBreakdown[1].Month);
        Assert.Equal(20.0, data.MonthlyBreakdown[1].EvCost);
        Assert.True(data.HasData);
        Assert.Equal(20.0, data.CurrentMonthCost);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_cost":12}""");

        var data = CostBreakdown.FromJson(doc.RootElement);

        Assert.Equal(12, data.TotalChargingCost);
        Assert.Equal(0, data.TotalSavings);
        Assert.Equal(0, data.MonthlySavings);
        Assert.Equal(0, data.CostPerKmEv);
        Assert.Empty(data.MonthlyBreakdown);
        Assert.False(data.HasData);
        Assert.Equal(0, data.CurrentMonthCost);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var data = CostBreakdown.FromJson(doc.RootElement);
        Assert.False(data.HasData);
        Assert.Equal(0, data.TotalChargingCost);
    }

    [Fact]
    public void FromJson_tolerates_partial_month_rows()
    {
        using var doc = JsonDocument.Parse("""
        {"monthly_breakdown":[{"ev_cost":7.5},{"month":"2026-02"},"bad",{"month":"2026-03","ev_cost":3}]}
        """);

        var data = CostBreakdown.FromJson(doc.RootElement);

        // The string entry is skipped; the two objects with partial fields default the missing field.
        Assert.Equal(3, data.MonthlyBreakdown.Count);
        Assert.Equal("\u2014", data.MonthlyBreakdown[0].Month); // missing month -> em dash
        Assert.Equal(7.5, data.MonthlyBreakdown[0].EvCost);
        Assert.Equal("2026-02", data.MonthlyBreakdown[1].Month);
        Assert.Equal(0, data.MonthlyBreakdown[1].EvCost); // missing ev_cost -> 0
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(3, true)]
    public void HasData_matches_web_gate(int monthCount, bool expected)
    {
        var months = new List<CostBreakdownMonth>();
        for (int i = 0; i < monthCount; i++)
        {
            months.Add(new CostBreakdownMonth($"2026-{i + 1:D2}", i));
        }

        Assert.Equal(expected, Sample(months: months).HasData);
    }

    // ---- Size / footprint flag (web isCompact = cols <= 1) -------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(1, 4, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new CostBreakdownSize(cols, rows).IsCompact);

    // ---- Projection: compact (web WidgetBigNumber) ---------------------------------

    [Fact]
    public void Project_compact_shows_current_month_with_savings_and_badge()
    {
        var view = Project(Sample(), new CostBreakdownSize(1, 2), UnitPref.Metric);

        Assert.True(view.IsCompact);
        Assert.Equal(5, view.CompactValue);             // last breakdown entry
        Assert.Equal("5", view.CompactValueText);
        Assert.Equal("$", view.CompactUnit);
        Assert.Equal("This Month", view.CompactLabel);
        Assert.Equal("Saved $8.00 vs gas", view.CompactSubtitle);
        Assert.True(view.ShowSavingBadge);
        Assert.Equal("Saving", view.SavingBadgeText);
    }

    [Fact]
    public void Project_compact_hides_savings_subtitle_and_badge_when_zero()
    {
        var view = Project(
            Sample(totalSavings: 0, monthlySavings: 0), new CostBreakdownSize(1, 2), UnitPref.Metric);

        Assert.Null(view.CompactSubtitle);
        Assert.False(view.ShowSavingBadge);
    }

    // ---- Projection: donut (web monthlyEntries.slice(-6)) --------------------------

    [Fact]
    public void Project_donut_maps_all_months_when_six_or_fewer()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal(3, view.Donut.Count);
        Assert.Equal("2026-01", view.Donut[0].Label);
        Assert.Equal(10, view.Donut[0].Value);
        Assert.Equal(new[] { 0, 1, 2 }, view.Donut.Select(s => s.ColorIndex).ToArray());
    }

    [Fact]
    public void Project_donut_keeps_only_the_last_six_months()
    {
        var months = new List<CostBreakdownMonth>();
        for (int i = 0; i < 8; i++)
        {
            months.Add(new CostBreakdownMonth($"M{i}", i));
        }

        var view = Project(Sample(months: months), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal(6, view.Donut.Count);
        Assert.Equal("M2", view.Donut[0].Label);          // slice(-6) drops M0, M1
        Assert.Equal("M7", view.Donut[^1].Label);
        Assert.Equal(new[] { 0, 1, 2, 3, 4, 5 }, view.Donut.Select(s => s.ColorIndex).ToArray());
    }

    // ---- Projection: ranked list (web rankedItems -> top 5 by value) ----------------

    [Fact]
    public void Project_ranked_sorts_descending_with_chronological_colors_and_bars()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal(3, view.Ranked.Count);

        Assert.Equal(1, view.Ranked[0].Rank);
        Assert.Equal("2026-02", view.Ranked[0].Label);
        Assert.Equal(20, view.Ranked[0].Value);
        Assert.Equal("$20.00", view.Ranked[0].FormattedValue);
        Assert.Equal(1, view.Ranked[0].ColorIndex);        // chronological position kept through the sort
        Assert.Equal(1.0, view.Ranked[0].BarFraction);

        Assert.Equal("2026-01", view.Ranked[1].Label);
        Assert.Equal(0, view.Ranked[1].ColorIndex);
        Assert.Equal(0.5, view.Ranked[1].BarFraction);     // 10 / 20

        Assert.Equal("2026-03", view.Ranked[2].Label);
        Assert.Equal(2, view.Ranked[2].ColorIndex);
        Assert.Equal(0.25, view.Ranked[2].BarFraction);    // 5 / 20
    }

    [Fact]
    public void Project_ranked_caps_at_five_rows()
    {
        var months = new List<CostBreakdownMonth>();
        for (int i = 0; i < 7; i++)
        {
            months.Add(new CostBreakdownMonth($"M{i}", i + 1));
        }

        var view = Project(Sample(months: months), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal(5, view.Ranked.Count);
        Assert.Equal("M6", view.Ranked[0].Label); // highest value
    }

    // ---- Projection: stat cards ----------------------------------------------------

    [Fact]
    public void Project_stat_cards_metric()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal("Total Cost", view.TotalCost.Label);
        Assert.Equal("$35.00", view.TotalCost.Value);

        Assert.Equal("Cost / km", view.CostPerDistance.Label);
        Assert.Equal("$0.050", view.CostPerDistance.Value); // 0.05 $/km, 3 dp

        Assert.Equal("Gas Savings", view.GasSavings.Label);
        Assert.Equal("$100.00", view.GasSavings.Value);
        Assert.Equal("Lifetime", view.GasSavings.Sublabel);
    }

    [Fact]
    public void Project_stat_cards_imperial_restates_cost_per_distance()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Imperial);

        Assert.Equal("Cost / mi", view.CostPerDistance.Label);
        Assert.Equal("$0.080", view.CostPerDistance.Value); // 0.05 * 1.60934 -> 0.080
    }

    [Fact]
    public void Project_uses_em_dash_when_cost_per_distance_and_savings_are_zero()
    {
        var view = Project(
            Sample(totalSavings: 0, costPerKmEv: 0), new CostBreakdownSize(2, 4), UnitPref.Metric);

        Assert.Equal("\u2014", view.CostPerDistance.Value);
        Assert.Equal("\u2014", view.GasSavings.Value);
        Assert.Null(view.GasSavings.Sublabel);
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Metric, "\u20AC");

        Assert.StartsWith("\u20AC", view.TotalCost.Value, StringComparison.Ordinal);
        Assert.StartsWith("\u20AC", view.Ranked[0].FormattedValue, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_cost_per_distance_unit_helper_matches_web()
    {
        Assert.Equal(0, CostBreakdownProjection.CostPerDistanceUnit(0, DistanceUnit.Mi));
        Assert.Equal(0.05, CostBreakdownProjection.CostPerDistanceUnit(0.05, DistanceUnit.Km));
        Assert.Equal(0.05 * 1.60934, CostBreakdownProjection.CostPerDistanceUnit(0.05, DistanceUnit.Mi), 6);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_surfaces_have_non_empty_accessibility_names()
    {
        var view = Project(Sample(), new CostBreakdownSize(2, 4), UnitPref.Metric);

        foreach (var stat in new[] { view.TotalCost, view.CostPerDistance, view.GasSavings })
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        foreach (var item in view.Ranked)
        {
            Assert.False(string.IsNullOrWhiteSpace(item.AutomationName));
            Assert.Contains(item.Label, item.AutomationName, StringComparison.Ordinal);
        }

        var compact = Project(Sample(), new CostBreakdownSize(1, 2), UnitPref.Metric);
        Assert.Contains(compact.CompactLabel, compact.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""
        {"total_charging_cost":35,"monthly_breakdown":[{"month":"2026-01","ev_cost":10}]}
        """);

        var cached = CostBreakdownResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(35, cached.Value!.TotalChargingCost);
        Assert.Single(cached.Value.MonthlyBreakdown);

        var offline = CostBreakdownResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_cost":1}""");

        Assert.Equal(LoadStatus.Loaded, CostBreakdownResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, CostBreakdownResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostBreakdownResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CostBreakdown>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_donut_ranked_and_stats()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Donut.Count);
        Assert.Equal(3, vm.Display.Ranked.Count);
        Assert.Equal("$35.00", vm.Display.TotalCost.Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_months_renders_empty()
    {
        using var vm = NewViewModel(Loaded(CostBreakdown.Empty));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No cost data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CostBreakdown>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostBreakdown>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostBreakdown>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostBreakdown>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostBreakdown>.Loading(),
            RepositoryResult<CostBreakdown>.Cached(Sample(totalChargingCost: 20), Now, stale: false),
            RepositoryResult<CostBreakdown>.Loaded(Sample(totalChargingCost: 35), Now));
        await vm.LoadAsync();

        Assert.Equal(CostBreakdownState.Loaded, vm.State);
        Assert.Equal("$35.00", vm.Display.TotalCost.Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new CostBreakdownSize(2, 4), Loaded(Sample()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new CostBreakdownSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(CostBreakdownState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_cost_per_distance()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("Cost / km", vm.Display.CostPerDistance.Label);
        Assert.Equal("$0.050", vm.Display.CostPerDistance.Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Cost / mi", vm.Display.CostPerDistance.Label);
        Assert.Equal("$0.080", vm.Display.CostPerDistance.Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_costs()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.TotalCost.Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.TotalCost.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CostBreakdown>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Cost Breakdown", vm.Title);
        Assert.Equal("No cost data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostBreakdownViewModel.State), changed);
        Assert.Contains(nameof(CostBreakdownViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("cost-breakdown", CostBreakdownRegistration.Id);
        Assert.Equal("analytics", CostBreakdownRegistration.Category);
        Assert.Equal("CostBreakdownWidget", CostBreakdownRegistration.Slug);
        Assert.Equal(new CostBreakdownSize(2, 4), CostBreakdownRegistration.DefaultSize);
        Assert.Equal(new CostBreakdownSize(1, 2), CostBreakdownRegistration.MinSize);
        Assert.Equal(new CostBreakdownSize(4, 40), CostBreakdownRegistration.MaxSize);
        Assert.Equal("Cost Breakdown", CostBreakdownRegistration.Name(Localizer));
        Assert.Contains("gas savings", CostBreakdownRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, CostBreakdownRegistration.IsWithinBounds(new CostBreakdownSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new CostBreakdownSize(1, 2), CostBreakdownRegistration.Clamp(new CostBreakdownSize(0, 0)));
        Assert.Equal(new CostBreakdownSize(4, 40), CostBreakdownRegistration.Clamp(new CostBreakdownSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostBreakdownDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostBreakdownWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_mi_to_km_matches_web_constant() =>
        Assert.Equal(1.60934, CostBreakdownProjection.MiToKm);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<CostBreakdown> Loaded(CostBreakdown data) =>
        RepositoryResult<CostBreakdown>.Loaded(data, Now);

    private static CostBreakdownViewModel NewViewModel(params RepositoryResult<CostBreakdown>[] emissions) =>
        NewViewModel(CostBreakdownSize.Default, emissions);

    private static CostBreakdownViewModel NewViewModel(
        CostBreakdownSize size,
        params RepositoryResult<CostBreakdown>[] emissions) =>
        new(
            new FakeCostBreakdownSource(emissions),
            Localizer,
            size,
            UnitPref.Metric,
            "$",
            CostBreakdownProjection.DefaultPrecision,
            () => Now);

    private sealed class FakeCostBreakdownSource(params RepositoryResult<CostBreakdown>[] emissions) : ICostBreakdownSource
    {
        public async IAsyncEnumerable<RepositoryResult<CostBreakdown>> StreamAsync(
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
