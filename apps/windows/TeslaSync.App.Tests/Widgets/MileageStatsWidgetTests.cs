using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the MileageStatsWidget's UI-thread-free logic — the JSON parse adapter, the
/// SI→display projection (daily / weekly / monthly average + the next-milestone tile with its months trend),
/// the cache-then-network result mapper, the footprint flag (compact / standard), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/MileageStatsWidget.tsx).
/// </summary>
public sealed class MileageStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static MileageStats Make(double lifetimeKm = 1000, double last30dKm = 300) =>
        new(lifetimeKm, last30dKm);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """{"vehicle_id":7,"lifetime_km":12345.6,"last_30d_km":900.5}""";
        using var doc = JsonDocument.Parse(json);

        var stats = MileageStats.FromJson(doc.RootElement);

        Assert.Equal(12345.6, stats.LifetimeKm);
        Assert.Equal(900.5, stats.Last30dKm);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"lifetime_km":50}""");

        var stats = MileageStats.FromJson(doc.RootElement);

        Assert.Equal(50, stats.LifetimeKm);
        Assert.Equal(0, stats.Last30dKm);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = MileageStats.FromJson(doc.RootElement);
        Assert.Equal(0, stats.LifetimeKm);
        Assert.Equal(0, stats.Last30dKm);
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"lifetime_km":"1000","last_30d_km":"300"}""");

        var stats = MileageStats.FromJson(doc.RootElement);

        Assert.Equal(1000, stats.LifetimeKm);
        Assert.Equal(300, stats.Last30dKm);
    }

    // ---- Size / footprint flag (web isCompact) -------------------------------------

    [Theory]
    [InlineData(1, 2, true)]   // compact
    [InlineData(2, 2, false)]  // standard (default)
    [InlineData(4, 2, false)]  // wide still renders the same two-up averages grid
    public void Size_flag_matches_web(int cols, int rows, bool compact)
    {
        var size = new MileageStatsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_four_averages()
    {
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        Assert.False(view.IsCompact);
        Assert.Equal(4, view.Stats.Count);

        // daily avg = (300 / 30) km = 10 km/day
        Assert.Equal("Daily Avg", view.Stats[0].Label);
        Assert.Equal("10.0", view.Stats[0].Value);
        Assert.Equal("km", view.Stats[0].Unit);

        Assert.Equal("Weekly Avg", view.Stats[1].Label);
        Assert.Equal("70", view.Stats[1].Value); // 10 * 7
        Assert.Equal("km", view.Stats[1].Unit);

        Assert.Equal("Monthly Avg", view.Stats[2].Label);
        Assert.Equal("300", view.Stats[2].Value); // 10 * 30
        Assert.Equal("km", view.Stats[2].Unit);

        Assert.Equal("Next Milestone", view.Stats[3].Label);
        Assert.Equal("10,000", view.Stats[3].Value);
        Assert.Equal("km", view.Stats[3].Unit);
    }

    [Fact]
    public void Project_milestone_and_months_projection()
    {
        // lifetime 1000 km -> next 10k milestone is 10,000; remaining 9000 km at 10 km/day -> 30 months.
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        var trend = view.Stats[3].Trend;
        Assert.NotNull(trend);
        Assert.True(trend!.Positive);
        Assert.Equal("\u2191", trend.Arrow);
        Assert.Equal("~30 mo", trend.Value);
    }

    [Fact]
    public void Project_milestone_rounds_up_to_next_ten_thousand()
    {
        // lifetime 15,000 km -> next milestone 20,000; remaining 5000 km at 20 km/day -> 8 months.
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 15000, last30dKm: 600), new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Equal("20,000", view.Stats[3].Value);
        Assert.Equal("~8 mo", view.Stats[3].Trend!.Value);
    }

    [Fact]
    public void Project_only_milestone_tile_carries_a_trend()
    {
        var view = MileageStatsProjection.Project(
            Make(), new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Null(view.Stats[0].Trend);
        Assert.Null(view.Stats[1].Trend);
        Assert.Null(view.Stats[2].Trend);
        Assert.NotNull(view.Stats[3].Trend);
    }

    // ---- Projection (imperial conversion) ------------------------------------------

    [Fact]
    public void Project_imperial_converts_distance_and_units()
    {
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(2, 2), UnitPref.Imperial, Localizer);

        // (300/30) km = 10 km/day -> 6.2137 mi/day
        Assert.Equal("6.2", view.Stats[0].Value);
        Assert.Equal("mi", view.Stats[0].Unit);
        Assert.Equal("43", view.Stats[1].Value);   // 6.2137 * 7
        Assert.Equal("186", view.Stats[2].Value);  // 6.2137 * 30
        Assert.Equal("10,000", view.Stats[3].Value); // 621 mi -> next 10k mile milestone
        Assert.Equal("~50 mo", view.Stats[3].Trend!.Value);
    }

    // ---- Projection (all-zero still renders the grid) ------------------------------

    [Fact]
    public void Project_all_zero_renders_grid_with_em_dash_trend()
    {
        // Web parity: the EmptyState gates on `data` presence, not the averages — an all-zero object renders
        // the grid; with no daily distance the milestone months are unknown ("—").
        var view = MileageStatsProjection.Project(
            MileageStats.Empty, new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Equal(4, view.Stats.Count);
        Assert.Equal("0.0", view.Stats[0].Value);
        Assert.Equal("0", view.Stats[1].Value);
        Assert.Equal("0", view.Stats[2].Value);
        Assert.Equal("10,000", view.Stats[3].Value); // ceil((0+1)/10000)*10000
        Assert.Equal("\u2014", view.Stats[3].Trend!.Value);
    }

    // ---- Projection (compact daily-average big number) -----------------------------

    [Fact]
    public void Project_compact_label_is_unit_per_day_metric()
    {
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(1, 2), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(10, view.CompactDailyAverage);
        Assert.Equal("10", view.CompactValue);
        Assert.Equal("km/day", view.CompactLabel);
        Assert.Contains("10", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("km/day", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_label_follows_imperial_unit()
    {
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(1, 2), UnitPref.Imperial, Localizer);

        Assert.Equal("6", view.CompactValue); // 6.2137 -> 6
        Assert.Equal("mi/day", view.CompactLabel);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = MileageStatsProjection.Project(
            Make(lifetimeKm: 1000, last30dKm: 300), new MileageStatsSize(2, 2), UnitPref.Metric, Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }

        // The milestone tile folds its trend caption into the Narrator name.
        Assert.Contains("~30 mo", view.Stats[3].AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"lifetime_km":10,"last_30d_km":3}""");

        var cached = MileageStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.LifetimeKm);

        var offline = MileageStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Last30dKm);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"lifetime_km":10}""");

        Assert.Equal(LoadStatus.Loaded, MileageStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MileageStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MileageStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MileageStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats()
    {
        using var vm = NewViewModel(Loaded(Make()));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_all_zero_object_still_renders_grid()
    {
        // Web parity: the outer EmptyState gates on `data` truthiness, NOT on the averages — a populated
        // (all-zero) object renders the grid.
        using var vm = NewViewModel(Loaded(MileageStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.Equal("0.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        // The Source yields Empty() both for an empty body and the disabled no-vehicle query.
        using var vm = NewViewModel(RepositoryResult<MileageStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No mileage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MileageStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<MileageStats>.Cached(Make(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<MileageStats>.OfflineCached(
            Make(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MileageStats>.Loading(),
            RepositoryResult<MileageStats>.Cached(Make(lifetimeKm: 500, last30dKm: 150), Now, stale: false),
            RepositoryResult<MileageStats>.Loaded(Make(lifetimeKm: 1000, last30dKm: 300), Now));
        await vm.LoadAsync();

        Assert.Equal(MileageStatsState.Loaded, vm.State);
        Assert.Equal("10.0", vm.Display.Stats[0].Value); // last snapshot wins (300/30 km)
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new MileageStatsSize(2, 2), Loaded(Make()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new MileageStatsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(MileageStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Make(lifetimeKm: 1000, last30dKm: 300)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Stats[0].Unit);
        Assert.Equal("10.0", vm.Display.Stats[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Stats[0].Unit);
        Assert.Equal("6.2", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MileageStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Mileage Stats", vm.Title);
        Assert.Equal("No mileage data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Make()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MileageStatsViewModel.State), changed);
        Assert.Contains(nameof(MileageStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("mileage-stats", MileageStatsRegistration.Id);
        Assert.Equal("analytics", MileageStatsRegistration.Category);
        Assert.Equal("MileageStatsWidget", MileageStatsRegistration.Slug);
        Assert.Equal(new MileageStatsSize(2, 2), MileageStatsRegistration.DefaultSize);
        Assert.Equal(new MileageStatsSize(1, 2), MileageStatsRegistration.MinSize);
        Assert.Equal(new MileageStatsSize(4, 40), MileageStatsRegistration.MaxSize);
        Assert.Equal("Mileage Stats", MileageStatsRegistration.Name(Localizer));
        Assert.Contains("milestone", MileageStatsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, MileageStatsRegistration.IsWithinBounds(new MileageStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new MileageStatsSize(1, 2), MileageStatsRegistration.Clamp(new MileageStatsSize(0, 0)));
        Assert.Equal(new MileageStatsSize(4, 40), MileageStatsRegistration.Clamp(new MileageStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MileageStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MileageStatsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<MileageStats> Loaded(MileageStats stats) =>
        RepositoryResult<MileageStats>.Loaded(stats, Now);

    private static MileageStatsViewModel NewViewModel(params RepositoryResult<MileageStats>[] emissions) =>
        NewViewModel(MileageStatsSize.Default, emissions);

    private static MileageStatsViewModel NewViewModel(
        MileageStatsSize size,
        params RepositoryResult<MileageStats>[] emissions) =>
        new(new FakeMileageStatsSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeMileageStatsSource(params RepositoryResult<MileageStats>[] emissions) : IMileageStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<MileageStats>> StreamAsync(
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
