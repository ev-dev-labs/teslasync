using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AnalyticsSummaryWidget's UI-thread-free logic — the JSON parse adapter,
/// the SI→display projection (distance/efficiency/energy/cost with units + currency), the
/// cache-then-network result mapper, the footprint flags, the registry metadata, the diagnostics, and
/// the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline). Mirrors the web spec (web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx).
/// </summary>
public sealed class AnalyticsSummaryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static AnalyticsSummary Summary(
        double distanceKm = 1000,
        double efficiencyWhKm = 150,
        double energyKwh = 234.5,
        double cost = 50,
        IReadOnlyList<double>? distanceTrend = null,
        IReadOnlyList<double>? efficiencyTrend = null,
        IReadOnlyList<double>? energyTrend = null,
        IReadOnlyList<double>? costTrend = null) =>
        new(
            distanceKm,
            efficiencyWhKm,
            energyKwh,
            cost,
            distanceTrend ?? Array.Empty<double>(),
            efficiencyTrend ?? Array.Empty<double>(),
            energyTrend ?? Array.Empty<double>(),
            costTrend ?? Array.Empty<double>());

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_vehicles":3,"total_distance_km":1234.5,"total_drives":42,
         "total_charging_sessions":11,"total_energy_kwh":456.7,"total_cost":78.9,
         "avg_efficiency_wh_km":171.2}
        """;
        using var doc = JsonDocument.Parse(json);

        var summary = AnalyticsSummary.FromJson(doc.RootElement);

        Assert.Equal(1234.5, summary.TotalDistanceKm);
        Assert.Equal(456.7, summary.TotalEnergyKwh);
        Assert.Equal(78.9, summary.TotalCost);
        Assert.Equal(171.2, summary.AvgEfficiencyWhKm);
        Assert.True(summary.HasData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":12}""");

        var summary = AnalyticsSummary.FromJson(doc.RootElement);

        Assert.Equal(12, summary.TotalDistanceKm);
        Assert.Equal(0, summary.AvgEfficiencyWhKm);
        Assert.Equal(0, summary.TotalEnergyKwh);
        Assert.Equal(0, summary.TotalCost);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var summary = AnalyticsSummary.FromJson(doc.RootElement);
        Assert.False(summary.HasData);
        Assert.Equal(0, summary.TotalDistanceKm);
    }

    [Fact]
    public void FromJson_parses_optional_trend_arrays()
    {
        using var doc = JsonDocument.Parse("""
        {"total_distance_km":10,"distance_trend":[1,2,3],"cost_trend":[0.1,0.2]}
        """);

        var summary = AnalyticsSummary.FromJson(doc.RootElement);

        Assert.Equal(new double[] { 1, 2, 3 }, summary.DistanceTrend);
        Assert.Equal(new double[] { 0.1, 0.2 }, summary.CostTrend);
        Assert.True(summary.HasTrends);
    }

    [Theory]
    [InlineData(0, 0, false)]   // nothing
    [InlineData(5, 0, true)]    // distance only
    [InlineData(0, 5, true)]    // energy only
    [InlineData(5, 5, true)]    // both
    public void HasData_matches_web_gate(double distKm, double energyKwh, bool expected) =>
        Assert.Equal(expected, Summary(distanceKm: distKm, energyKwh: energyKwh).HasData);

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 2, true, false, 2)]   // compact
    [InlineData(2, 2, false, false, 2)]  // standard
    [InlineData(3, 2, false, false, 2)]  // standard-wide-ish (cols 3 -> still 2-up grid, not wide)
    [InlineData(4, 2, false, true, 4)]   // wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide, int gridCols)
    {
        var size = new AnalyticsSummarySize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_four_stats()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceKm: 1000, efficiencyWhKm: 150, energyKwh: 234.5, cost: 50),
            new AnalyticsSummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(4, view.Stats.Count);

        Assert.Equal("Total Distance", view.Stats[0].Label);
        Assert.Equal("1,000", view.Stats[0].Value);
        Assert.Equal("km", view.Stats[0].Unit);

        Assert.Equal("Avg Efficiency", view.Stats[1].Label);
        Assert.Equal("150", view.Stats[1].Value);
        Assert.Equal("Wh/km", view.Stats[1].Unit);

        Assert.Equal("Energy Consumed", view.Stats[2].Label);
        Assert.Equal("234.5", view.Stats[2].Value);
        Assert.Equal("kWh", view.Stats[2].Unit);

        Assert.Equal("Cost / km", view.Stats[3].Label);
        Assert.Equal("$0.050", view.Stats[3].Value); // 50 / 1000
        Assert.Null(view.Stats[3].Unit);
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_distance_efficiency_and_cost()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceKm: 1000, efficiencyWhKm: 150, energyKwh: 234.5, cost: 50),
            new AnalyticsSummarySize(2, 2), UnitPref.Imperial, "$", Localizer);

        Assert.Equal("621", view.Stats[0].Value);   // 1000 km -> 621 mi
        Assert.Equal("mi", view.Stats[0].Unit);

        Assert.Equal("241", view.Stats[1].Value);   // 150 Wh/km * 1.60934 -> 241 Wh/mi
        Assert.Equal("Wh/mi", view.Stats[1].Unit);

        Assert.Equal("Cost / mi", view.Stats[3].Label);
        Assert.Equal("$0.080", view.Stats[3].Value); // 50 / 621.37 -> 0.080
    }

    [Fact]
    public void Project_uses_em_dash_when_cost_is_zero()
    {
        // Energy present but no distance -> displayDist 0 -> costPerDist 0 -> em dash.
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceKm: 0, energyKwh: 100, cost: 10),
            new AnalyticsSummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal("\u2014", view.Stats[3].Value);
        Assert.True(view.HasData); // energy keeps it non-empty
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceKm: 1000, cost: 50),
            new AnalyticsSummarySize(2, 2), UnitPref.Metric, "€", Localizer);

        Assert.StartsWith("\u20AC", view.Stats[3].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_computes_compact_distance_rounded()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceKm: 1234), new AnalyticsSummarySize(1, 2), UnitPref.Metric, "$", Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(1234, view.CompactDistance);
        Assert.Equal("1,234", view.CompactValue);
        Assert.Equal("km", view.CompactUnit);
        Assert.Equal("Total Distance", view.CompactLabel);
    }

    [Fact]
    public void Project_carries_trends_for_wide_sparklines()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(distanceTrend: new double[] { 1, 2 }),
            new AnalyticsSummarySize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.True(view.IsWide);
        Assert.True(view.HasSparklines);
        Assert.Equal(4, view.Sparklines.Count);
        Assert.Equal(new double[] { 1, 2 }, view.Sparklines[0]);
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(), new AnalyticsSummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("Total Distance", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_assigns_palette_index_per_stat()
    {
        var view = AnalyticsSummaryProjection.Project(
            Summary(), new AnalyticsSummarySize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(new[] { 0, 1, 2, 3 }, view.Stats.Select(s => s.ColorIndex).ToArray());
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10,"total_energy_kwh":5}""");

        var cached = AnalyticsSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.TotalDistanceKm);

        var offline = AnalyticsSummaryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(5, offline.Value!.TotalEnergyKwh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10}""");

        Assert.Equal(LoadStatus.Loaded, AnalyticsSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, AnalyticsSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AnalyticsSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AnalyticsSummary>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats()
    {
        using var vm = NewViewModel(Loaded(Summary()));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(AnalyticsSummary.Empty));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No analytics data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AnalyticsSummary>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnalyticsSummary>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnalyticsSummary>.Cached(Summary(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<AnalyticsSummary>.OfflineCached(
            Summary(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnalyticsSummary>.Loading(),
            RepositoryResult<AnalyticsSummary>.Cached(Summary(distanceKm: 500), Now, stale: false),
            RepositoryResult<AnalyticsSummary>.Loaded(Summary(distanceKm: 1000), Now));
        await vm.LoadAsync();

        Assert.Equal(AnalyticsSummaryState.Loaded, vm.State);
        Assert.Equal("1,000", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new AnalyticsSummarySize(2, 2), Loaded(Summary()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new AnalyticsSummarySize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(AnalyticsSummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Summary(distanceKm: 1000)));
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
        using var vm = NewViewModel(Loaded(Summary(distanceKm: 1000, cost: 50)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Stats[3].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Stats[3].Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AnalyticsSummary>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Analytics Summary", vm.Title);
        Assert.Equal("No analytics data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Summary()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AnalyticsSummaryViewModel.State), changed);
        Assert.Contains(nameof(AnalyticsSummaryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("analytics-summary", AnalyticsSummaryRegistration.Id);
        Assert.Equal("analytics", AnalyticsSummaryRegistration.Category);
        Assert.Equal("AnalyticsSummaryWidget", AnalyticsSummaryRegistration.Slug);
        Assert.Equal(new AnalyticsSummarySize(2, 2), AnalyticsSummaryRegistration.DefaultSize);
        Assert.Equal(new AnalyticsSummarySize(1, 2), AnalyticsSummaryRegistration.MinSize);
        Assert.Equal(new AnalyticsSummarySize(4, 40), AnalyticsSummaryRegistration.MaxSize);
        Assert.Equal("Analytics Summary", AnalyticsSummaryRegistration.Name(Localizer));
        Assert.Contains("efficiency", AnalyticsSummaryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, AnalyticsSummaryRegistration.IsWithinBounds(new AnalyticsSummarySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AnalyticsSummarySize(1, 2), AnalyticsSummaryRegistration.Clamp(new AnalyticsSummarySize(0, 0)));
        Assert.Equal(new AnalyticsSummarySize(4, 40), AnalyticsSummaryRegistration.Clamp(new AnalyticsSummarySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AnalyticsSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnalyticsSummaryWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_mi_to_km_matches_web_constant() =>
        Assert.Equal(1.60934, AnalyticsSummaryProjection.MiToKm);

    [Fact]
    public void Source_requests_the_web_default_window() =>
        Assert.Equal(30, AnalyticsSummaryRegistration.DefaultDays);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<AnalyticsSummary> Loaded(AnalyticsSummary summary) =>
        RepositoryResult<AnalyticsSummary>.Loaded(summary, Now);

    private static AnalyticsSummaryViewModel NewViewModel(params RepositoryResult<AnalyticsSummary>[] emissions) =>
        NewViewModel(AnalyticsSummarySize.Default, emissions);

    private static AnalyticsSummaryViewModel NewViewModel(
        AnalyticsSummarySize size,
        params RepositoryResult<AnalyticsSummary>[] emissions) =>
        new(new FakeAnalyticsSummarySource(emissions), Localizer, size, UnitPref.Metric, "$", () => Now);

    private sealed class FakeAnalyticsSummarySource(params RepositoryResult<AnalyticsSummary>[] emissions) : IAnalyticsSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<AnalyticsSummary>> StreamAsync(
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
