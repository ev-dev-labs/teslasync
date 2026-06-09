using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the LifetimeStatsWidget's UI-thread-free logic — the JSON parse adapter, the
/// SI→display projection (distance/drives/energy/CO₂/cost/ownership/avg-daily with units + currency), the
/// cache-then-network result mapper, the footprint flags (compact / standard / wide), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx).
/// </summary>
public sealed class LifetimeStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static LifetimeStats Make(
        double distanceKm = 1000,
        long drives = 100,
        double energyKwh = 234.5,
        double co2Kg = 300,
        double cost = 50,
        long ownershipDays = 200) =>
        new(distanceKm, drives, energyKwh, co2Kg, cost, ownershipDays);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_drives":42,"total_distance_km":1234.5,"total_energy_kwh":456.7,
         "co2_offset_kg":321.0,"total_charging_cost":78.9,"ownership_days":365}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = LifetimeStats.FromJson(doc.RootElement);

        Assert.Equal(42, stats.TotalDrives);
        Assert.Equal(1234.5, stats.TotalDistanceKm);
        Assert.Equal(456.7, stats.TotalEnergyKwh);
        Assert.Equal(321.0, stats.Co2OffsetKg);
        Assert.Equal(78.9, stats.TotalChargingCost);
        Assert.Equal(365, stats.OwnershipDays);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":12}""");

        var stats = LifetimeStats.FromJson(doc.RootElement);

        Assert.Equal(12, stats.TotalDistanceKm);
        Assert.Equal(0, stats.TotalDrives);
        Assert.Equal(0, stats.TotalEnergyKwh);
        Assert.Equal(0, stats.Co2OffsetKg);
        Assert.Equal(0, stats.TotalChargingCost);
        Assert.Equal(0, stats.OwnershipDays);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = LifetimeStats.FromJson(doc.RootElement);
        Assert.Equal(0, stats.TotalDistanceKm);
        Assert.Equal(0, stats.OwnershipDays);
    }

    [Fact]
    public void FromJson_coerces_fractional_counts_to_long()
    {
        using var doc = JsonDocument.Parse("""{"total_drives":41.6,"ownership_days":12.2}""");

        var stats = LifetimeStats.FromJson(doc.RootElement);

        Assert.Equal(42, stats.TotalDrives);  // 41.6 rounds away from zero
        Assert.Equal(12, stats.OwnershipDays); // 12.2 rounds down
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false, 2)]   // compact
    [InlineData(2, 2, false, false, 2)]  // standard
    [InlineData(3, 2, false, true, 4)]   // wide starts at 3 cols (web isWide = cols >= 3)
    [InlineData(4, 2, false, true, 4)]   // wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide, int gridCols)
    {
        var size = new LifetimeStatsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_standard_metric_formats_four_core_stats()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000, drives: 100, energyKwh: 234.5, co2Kg: 300),
            new LifetimeStatsSize(2, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(4, view.Stats.Count); // standard footprint → core only

        Assert.Equal("Total Distance", view.Stats[0].Label);
        Assert.Equal("1,000", view.Stats[0].Value);
        Assert.Equal("km", view.Stats[0].Unit);

        Assert.Equal("Total Drives", view.Stats[1].Label);
        Assert.Equal("100", view.Stats[1].Value);
        Assert.Null(view.Stats[1].Unit);

        Assert.Equal("Total Energy", view.Stats[2].Label);
        Assert.Equal("234.5", view.Stats[2].Value);
        Assert.Equal("kWh", view.Stats[2].Unit);

        Assert.Equal("CO\u2082 Saved", view.Stats[3].Label);
        Assert.Equal("300", view.Stats[3].Value);
        Assert.Equal("kg", view.Stats[3].Unit);
    }

    [Fact]
    public void Project_wide_adds_three_extra_stats()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000, cost: 50, ownershipDays: 200),
            new LifetimeStatsSize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.True(view.IsWide);
        Assert.Equal(7, view.Stats.Count);

        Assert.Equal("Total Cost", view.Stats[4].Label);
        Assert.Equal("$50.00", view.Stats[4].Value);
        Assert.Null(view.Stats[4].Unit);

        Assert.Equal("Ownership Days", view.Stats[5].Label);
        Assert.Equal("200", view.Stats[5].Value);
        Assert.Null(view.Stats[5].Unit);

        Assert.Equal("Avg Daily Distance", view.Stats[6].Label);
        Assert.Equal("5.0", view.Stats[6].Value); // 1000 km / 200 days
        Assert.Equal("km", view.Stats[6].Unit);
    }

    [Fact]
    public void Project_avg_daily_is_zero_when_no_ownership_days()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000, ownershipDays: 0),
            new LifetimeStatsSize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal("0.0", view.Stats[6].Value);
    }

    // ---- Projection (distance correctness — SI metres, NOT the web mile defect) -----

    [Fact]
    public void Project_distance_uses_si_metres_not_web_mile_defect()
    {
        // Web LifetimeStatsWidget feeds km*KM_TO_MI (miles) into convertDistanceFromSI (expects metres) —
        // a migration defect. The native port follows the documented SI contract and the accepted sibling
        // (AnalyticsSummaryWidget): km*1000 metres. 1000 km therefore stays 1,000 km / converts to 621 mi.
        var metric = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000), new LifetimeStatsSize(2, 2), UnitPref.Metric, "$", Localizer);
        Assert.Equal("1,000", metric.Stats[0].Value);
        Assert.Equal("km", metric.Stats[0].Unit);

        var imperial = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000), new LifetimeStatsSize(2, 2), UnitPref.Imperial, "$", Localizer);
        Assert.Equal("621", imperial.Stats[0].Value); // 1000 km -> 621 mi
        Assert.Equal("mi", imperial.Stats[0].Unit);
    }

    [Fact]
    public void Project_imperial_converts_avg_daily_distance()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000, ownershipDays: 200),
            new LifetimeStatsSize(4, 2), UnitPref.Imperial, "$", Localizer);

        Assert.Equal("mi", view.Stats[6].Unit);
        Assert.Equal("3.1", view.Stats[6].Value); // 621.37 mi / 200 days
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var view = LifetimeStatsProjection.Project(
            Make(cost: 50), new LifetimeStatsSize(4, 2), UnitPref.Metric, "\u20AC", Localizer);

        Assert.StartsWith("\u20AC", view.Stats[4].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_label_is_unit_lifetime()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1234), new LifetimeStatsSize(1, 2), UnitPref.Metric, "$", Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(1234, view.CompactDistance);
        Assert.Equal("1,234", view.CompactValue);
        Assert.Equal("km lifetime", view.CompactLabel);
        Assert.Contains("1,234", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("km lifetime", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_label_follows_imperial_unit()
    {
        var view = LifetimeStatsProjection.Project(
            Make(distanceKm: 1000), new LifetimeStatsSize(1, 2), UnitPref.Imperial, "$", Localizer);

        Assert.Equal("621", view.CompactValue);
        Assert.Equal("mi lifetime", view.CompactLabel);
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = LifetimeStatsProjection.Project(
            Make(), new LifetimeStatsSize(4, 2), UnitPref.Metric, "$", Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("lifetime", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_assigns_sequential_palette_index_per_stat()
    {
        var view = LifetimeStatsProjection.Project(
            Make(), new LifetimeStatsSize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(new[] { 0, 1, 2, 3, 4, 5, 6 }, view.Stats.Select(s => s.ColorIndex).ToArray());
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10,"total_drives":3}""");

        var cached = LifetimeStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.TotalDistanceKm);

        var offline = LifetimeStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.TotalDrives);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10}""");

        Assert.Equal(LoadStatus.Loaded, LifetimeStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, LifetimeStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, LifetimeStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats()
    {
        using var vm = NewViewModel(Loaded(Make()));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_all_zero_object_still_renders_grid()
    {
        // Web parity: the outer EmptyState gates on `data` truthiness, NOT on the totals — a populated
        // (all-zero) object renders the grid, unlike the value-gated AnalyticsSummaryWidget.
        using var vm = NewViewModel(Loaded(LifetimeStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.Equal("0", vm.Display.Stats[1].Value);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No lifetime data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<LifetimeStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<LifetimeStats>.Cached(Make(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeStats>.OfflineCached(
            Make(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<LifetimeStats>.Loading(),
            RepositoryResult<LifetimeStats>.Cached(Make(distanceKm: 500), Now, stale: false),
            RepositoryResult<LifetimeStats>.Loaded(Make(distanceKm: 1000), Now));
        await vm.LoadAsync();

        Assert.Equal(LifetimeStatsState.Loaded, vm.State);
        Assert.Equal("1,000", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new LifetimeStatsSize(2, 2), Loaded(Make()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new LifetimeStatsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(LifetimeStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_to_wide_adds_extra_tiles()
    {
        using var vm = NewViewModel(new LifetimeStatsSize(2, 2), Loaded(Make()));
        await vm.LoadAsync();
        Assert.Equal(4, vm.Display.Stats.Count);

        vm.Size = new LifetimeStatsSize(4, 2);
        Assert.True(vm.Display.IsWide);
        Assert.Equal(7, vm.Display.Stats.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Make(distanceKm: 1000)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Stats[0].Unit);
        Assert.Equal("1,000", vm.Display.Stats[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Stats[0].Unit);
        Assert.Equal("621", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost()
    {
        using var vm = NewViewModel(new LifetimeStatsSize(4, 2), Loaded(Make(cost: 50)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Stats[4].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Stats[4].Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Lifetime Stats", vm.Title);
        Assert.Equal("No lifetime data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Make()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LifetimeStatsViewModel.State), changed);
        Assert.Contains(nameof(LifetimeStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("lifetime-stats", LifetimeStatsRegistration.Id);
        Assert.Equal("analytics", LifetimeStatsRegistration.Category);
        Assert.Equal("LifetimeStatsWidget", LifetimeStatsRegistration.Slug);
        Assert.Equal(new LifetimeStatsSize(2, 2), LifetimeStatsRegistration.DefaultSize);
        Assert.Equal(new LifetimeStatsSize(1, 2), LifetimeStatsRegistration.MinSize);
        Assert.Equal(new LifetimeStatsSize(4, 40), LifetimeStatsRegistration.MaxSize);
        Assert.Equal("Lifetime Stats", LifetimeStatsRegistration.Name(Localizer));
        Assert.Contains("ownership", LifetimeStatsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, LifetimeStatsRegistration.IsWithinBounds(new LifetimeStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new LifetimeStatsSize(1, 2), LifetimeStatsRegistration.Clamp(new LifetimeStatsSize(0, 0)));
        Assert.Equal(new LifetimeStatsSize(4, 40), LifetimeStatsRegistration.Clamp(new LifetimeStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LifetimeStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LifetimeStatsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<LifetimeStats> Loaded(LifetimeStats stats) =>
        RepositoryResult<LifetimeStats>.Loaded(stats, Now);

    private static LifetimeStatsViewModel NewViewModel(params RepositoryResult<LifetimeStats>[] emissions) =>
        NewViewModel(LifetimeStatsSize.Default, emissions);

    private static LifetimeStatsViewModel NewViewModel(
        LifetimeStatsSize size,
        params RepositoryResult<LifetimeStats>[] emissions) =>
        new(new FakeLifetimeStatsSource(emissions), Localizer, size, UnitPref.Metric, "$", () => Now);

    private sealed class FakeLifetimeStatsSource(params RepositoryResult<LifetimeStats>[] emissions) : ILifetimeStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<LifetimeStats>> StreamAsync(
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
