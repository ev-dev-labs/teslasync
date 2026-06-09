using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the FleetStatsBarWidget's UI-thread-free logic — the JSON tally/parse
/// adapters (vehicle list + fleet rollup), the SI→display projection (counts, distance, energy), the
/// two-source combine mapper (loading gate, analytics-driven freshness, hard-error precedence, empty
/// gate), the footprint flags, the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx).
/// </summary>
public sealed class FleetStatsBarWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static FleetStats Stats(
        int vehicleCount = 3,
        int onlineCount = 2,
        double distanceKm = 1000,
        double energyKwh = 456.7,
        bool hasVehicles = true,
        bool hasAnalytics = true) =>
        new(vehicleCount, onlineCount, distanceKm, energyKwh, hasVehicles, hasAnalytics);

    private static JsonElement El(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // ---- Vehicle tally adapter -----------------------------------------------------

    [Fact]
    public void TallyVehicles_counts_total_and_online()
    {
        var element = El("""
        [{"id":1,"state":"online"},{"id":2,"state":"asleep"},{"id":3,"state":"online"}]
        """);

        var (count, online) = FleetStats.TallyVehicles(element);

        Assert.Equal(3, count);
        Assert.Equal(2, online);
    }

    [Fact]
    public void TallyVehicles_is_case_sensitive_like_web_strict_equals()
    {
        var element = El("""[{"state":"Online"},{"state":"ONLINE"},{"state":"online"}]""");

        var (count, online) = FleetStats.TallyVehicles(element);

        Assert.Equal(3, count);
        Assert.Equal(1, online); // only the exact lowercase 'online' matches (web v.state === 'online')
    }

    [Fact]
    public void TallyVehicles_non_array_is_zero()
    {
        Assert.Equal((0, 0), FleetStats.TallyVehicles(El("{}")));
        Assert.Equal((0, 0), FleetStats.TallyVehicles(El("null")));
    }

    [Fact]
    public void TallyVehicles_tolerates_missing_state()
    {
        var element = El("""[{"id":1},{"id":2,"state":"online"}]""");

        var (count, online) = FleetStats.TallyVehicles(element);

        Assert.Equal(2, count);
        Assert.Equal(1, online);
    }

    // ---- Fleet rollup adapter ------------------------------------------------------

    [Fact]
    public void ReadFleet_reads_snake_case_fields()
    {
        var element = El("""{"total_distance_km":1234.5,"total_energy_kwh":456.7,"total_cost":9.9}""");

        var (distanceKm, energyKwh) = FleetStats.ReadFleet(element);

        Assert.Equal(1234.5, distanceKm);
        Assert.Equal(456.7, energyKwh);
    }

    [Fact]
    public void ReadFleet_is_tolerant_of_missing_fields()
    {
        var (distanceKm, energyKwh) = FleetStats.ReadFleet(El("""{"total_distance_km":12}"""));

        Assert.Equal(12, distanceKm);
        Assert.Equal(0, energyKwh);
    }

    [Fact]
    public void ReadFleet_non_object_is_zero() => Assert.Equal((0d, 0d), FleetStats.ReadFleet(El("[]")));

    [Theory]
    [InlineData(false, false, false)] // nothing
    [InlineData(true, false, true)]   // vehicles only
    [InlineData(false, true, true)]   // analytics only
    [InlineData(true, true, true)]    // both
    public void HasData_matches_web_gate(bool hasVehicles, bool hasAnalytics, bool expected) =>
        Assert.Equal(expected, Stats(hasVehicles: hasVehicles, hasAnalytics: hasAnalytics).HasData);

    // ---- Size / footprint flags (web isCompact = rows < 2) -------------------------

    [Theory]
    [InlineData(4, 2, false, 4)] // default — full 4-up
    [InlineData(3, 2, false, 2)] // min — collapses to 2-up
    [InlineData(4, 1, true, 1)]  // compact (rows < 2) — stack 1-up
    [InlineData(4, 40, false, 4)] // max — full 4-up
    public void Size_flags_match_web(int cols, int rows, bool compact, int gridCols)
    {
        var size = new FleetStatsBarSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_four_stats()
    {
        var view = FleetStatsBarProjection.Project(
            Stats(vehicleCount: 3, onlineCount: 2, distanceKm: 1000, energyKwh: 456.7),
            FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);

        Assert.Equal(4, view.Stats.Count);

        Assert.Equal("Vehicles", view.Stats[0].Label);
        Assert.Equal("3", view.Stats[0].Value);
        Assert.Null(view.Stats[0].Unit);

        Assert.Equal("Online Now", view.Stats[1].Label);
        Assert.Equal("2", view.Stats[1].Value);
        Assert.Null(view.Stats[1].Unit);

        Assert.Equal("Distance (30d)", view.Stats[2].Label);
        Assert.Equal("km", view.Stats[2].Unit);

        Assert.Equal("Energy (30d)", view.Stats[3].Label);
        Assert.Equal("456.7", view.Stats[3].Value);
        Assert.Equal("kWh", view.Stats[3].Unit);
    }

    [Fact]
    public void Project_distance_mirrors_web_convertDistanceFromSI_on_the_raw_km_value()
    {
        // Web parity (FleetStatsBarWidget.tsx L19, L28): the `total_distance_km` value is passed straight
        // into convertDistanceFromSI (the SI/metres converter) with NO km→m scaling, so 1000 renders as
        // 1000/1000 = 1.0 km and 1000/1609.344 ≈ 0.6 mi. This pins that exact (sibling-divergent) arithmetic.
        var metric = FleetStatsBarProjection.Project(
            Stats(distanceKm: 1000), FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);
        Assert.Equal("1.0", metric.Stats[2].Value);
        Assert.Equal("km", metric.Stats[2].Unit);

        var imperial = FleetStatsBarProjection.Project(
            Stats(distanceKm: 1000), FleetStatsBarRegistration.DefaultSize, UnitPref.Imperial, Localizer);
        Assert.Equal("0.6", imperial.Stats[2].Value);
        Assert.Equal("mi", imperial.Stats[2].Unit);
    }

    [Fact]
    public void Project_computes_online_subtitle_resolving_the_online_key()
    {
        var view = FleetStatsBarProjection.Project(
            Stats(vehicleCount: 3, onlineCount: 2), FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);

        // Web FleetStatsBarWidget.tsx L48: trendValue = `${onlineCount} ${t('...online')}`.
        Assert.Equal("2 online", view.Stats[0].Subtitle);
        // Web L54: onlinePct = `${fmtNumber((online/total)*100, 0)}%` -> "67%".
        Assert.Equal("67%", view.Stats[1].Subtitle);
    }

    [Fact]
    public void Project_online_percent_is_null_when_no_vehicles()
    {
        var view = FleetStatsBarProjection.Project(
            Stats(vehicleCount: 0, onlineCount: 0, hasVehicles: false),
            FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);

        Assert.Null(view.Stats[1].Subtitle); // web: onlinePct undefined when vehicleCount === 0
        Assert.Equal("0 online", view.Stats[0].Subtitle);
    }

    [Fact]
    public void Project_energy_keeps_one_decimal_like_web()
    {
        var view = FleetStatsBarProjection.Project(
            Stats(energyKwh: 234.56), FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);

        Assert.Equal("234.6", view.Stats[3].Value); // fmtNumber(_, 1)
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var view = FleetStatsBarProjection.Project(
            Stats(), FleetStatsBarRegistration.DefaultSize, UnitPref.Metric, Localizer);

        foreach (var stat in view.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(stat.Glyph));
        }
    }

    [Fact]
    public void Project_carries_footprint_flags()
    {
        var compact = FleetStatsBarProjection.Project(
            Stats(), new FleetStatsBarSize(4, 1), UnitPref.Metric, Localizer);
        Assert.True(compact.IsCompact);
        Assert.Equal(1, compact.GridColumns);

        var wide = FleetStatsBarProjection.Project(
            Stats(), new FleetStatsBarSize(4, 2), UnitPref.Metric, Localizer);
        Assert.False(wide.IsCompact);
        Assert.Equal(4, wide.GridColumns);
    }

    // ---- Combine mapper (two-source, web composition) ------------------------------

    private static RepositoryResult<JsonElement> RawLoaded(string json) =>
        RepositoryResult<JsonElement>.Loaded(El(json), Now);

    private static readonly string VehiclesJson = """[{"state":"online"},{"state":"asleep"},{"state":"online"}]""";
    private static readonly string FleetJson = """{"total_distance_km":1000,"total_energy_kwh":456.7}""";

    [Fact]
    public void Combine_both_loading_is_loading() =>
        Assert.Equal(
            LoadStatus.Loading,
            FleetStatsBarResultMapper.Combine(
                RepositoryResult<JsonElement>.Loading(), RepositoryResult<JsonElement>.Loading()).Status);

    [Fact]
    public void Combine_stays_loading_until_analytics_resolves()
    {
        // Web: isLoading = vehiclesLoading || analyticsLoading — vehicles loaded but analytics still loading.
        var result = FleetStatsBarResultMapper.Combine(RawLoaded(VehiclesJson), RepositoryResult<JsonElement>.Loading());
        Assert.Equal(LoadStatus.Loading, result.Status);
    }

    [Fact]
    public void Combine_stays_loading_until_vehicles_resolves()
    {
        var result = FleetStatsBarResultMapper.Combine(RepositoryResult<JsonElement>.Loading(), RawLoaded(FleetJson));
        Assert.Equal(LoadStatus.Loading, result.Status);
    }

    [Fact]
    public void Combine_loaded_merges_counts_and_totals()
    {
        var result = FleetStatsBarResultMapper.Combine(RawLoaded(VehiclesJson), RawLoaded(FleetJson));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        var stats = result.Value!;
        Assert.Equal(3, stats.VehicleCount);
        Assert.Equal(2, stats.OnlineCount);
        Assert.Equal(1000, stats.TotalDistanceKm);
        Assert.Equal(456.7, stats.TotalEnergyKwh);
        Assert.True(stats.HasData);
        Assert.Equal(Now, result.FetchedAt); // freshness tracks the fleet (analytics) read
    }

    [Fact]
    public void Combine_fleet_hard_error_is_failure_even_with_vehicles()
    {
        // Web: WidgetShell shows <QueryError> whenever the analytics `error` is truthy, regardless of vehicles.
        var result = FleetStatsBarResultMapper.Combine(
            RawLoaded(VehiclesJson),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, result.Status);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public void Combine_no_data_is_empty()
    {
        var result = FleetStatsBarResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now), RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Combine_vehicles_only_renders_content()
    {
        // Web: hasData = (vehicles && vehicles.length > 0) || analytics — vehicles alone keep it non-empty.
        var result = FleetStatsBarResultMapper.Combine(RawLoaded(VehiclesJson), RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(3, result.Value!.VehicleCount);
        Assert.True(result.Value!.HasVehicles);
        Assert.False(result.Value!.HasAnalytics);
    }

    [Fact]
    public void Combine_analytics_only_renders_content()
    {
        var result = FleetStatsBarResultMapper.Combine(RepositoryResult<JsonElement>.Empty(Now), RawLoaded(FleetJson));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(0, result.Value!.VehicleCount);
        Assert.True(result.Value!.HasAnalytics);
    }

    [Fact]
    public void Combine_fleet_offline_is_offline_with_content()
    {
        var result = FleetStatsBarResultMapper.Combine(
            RawLoaded(VehiclesJson),
            RepositoryResult<JsonElement>.OfflineCached(El(FleetJson), Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.True(result.Value!.HasData);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public void Combine_fleet_cached_stale_is_cached_stale()
    {
        var result = FleetStatsBarResultMapper.Combine(
            RawLoaded(VehiclesJson),
            RepositoryResult<JsonElement>.Cached(El(FleetJson), Now, stale: true));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No fleet data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStats>.Cached(Stats(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStats>.OfflineCached(
            Stats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetStats>.Loading(),
            RepositoryResult<FleetStats>.Cached(Stats(vehicleCount: 1), Now, stale: false),
            RepositoryResult<FleetStats>.Loaded(Stats(vehicleCount: 5), Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loaded, vm.State);
        Assert.Equal("5", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Stats(distanceKm: 1000)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Stats[2].Unit);
        Assert.Equal("1.0", vm.Display.Stats[2].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Stats[2].Unit);
        Assert.Equal("0.6", vm.Display.Stats[2].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_grid_columns()
    {
        using var vm = NewViewModel(new FleetStatsBarSize(4, 2), Loaded(Stats()));
        await vm.LoadAsync();
        Assert.Equal(4, vm.Display.GridColumns);

        vm.Size = new FleetStatsBarSize(4, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(1, vm.Display.GridColumns);
        Assert.Equal(FleetStatsBarState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Fleet Stats", vm.Title);
        Assert.Equal("No fleet data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(FleetStatsBarViewModel.State), changed);
        Assert.Contains(nameof(FleetStatsBarViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("fleet-stats-bar", FleetStatsBarRegistration.Id);
        Assert.Equal("analytics", FleetStatsBarRegistration.Category);
        Assert.Equal("FleetStatsBarWidget", FleetStatsBarRegistration.Slug);
        Assert.Equal(new FleetStatsBarSize(4, 2), FleetStatsBarRegistration.DefaultSize);
        Assert.Equal(new FleetStatsBarSize(3, 2), FleetStatsBarRegistration.MinSize);
        Assert.Equal(new FleetStatsBarSize(4, 40), FleetStatsBarRegistration.MaxSize);
        Assert.Equal("Fleet Stats Bar", FleetStatsBarRegistration.Name(Localizer));
        Assert.Contains("Fleet-wide", FleetStatsBarRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(4, 2, true)]
    [InlineData(3, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(4, 41, false)] // above max rows
    [InlineData(4, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, FleetStatsBarRegistration.IsWithinBounds(new FleetStatsBarSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new FleetStatsBarSize(3, 2), FleetStatsBarRegistration.Clamp(new FleetStatsBarSize(0, 0)));
        Assert.Equal(new FleetStatsBarSize(4, 40), FleetStatsBarRegistration.Clamp(new FleetStatsBarSize(9, 99)));
    }

    [Fact]
    public void Source_requests_the_web_default_window() =>
        Assert.Equal(30, FleetStatsBarRegistration.DefaultDays);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FleetStatsBarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetStatsBarWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<FleetStats> Loaded(FleetStats stats) =>
        RepositoryResult<FleetStats>.Loaded(stats, Now);

    private static FleetStatsBarViewModel NewViewModel(params RepositoryResult<FleetStats>[] emissions) =>
        NewViewModel(FleetStatsBarRegistration.DefaultSize, emissions);

    private static FleetStatsBarViewModel NewViewModel(
        FleetStatsBarSize size,
        params RepositoryResult<FleetStats>[] emissions) =>
        new(new FakeFleetStatsBarSource(emissions), Localizer, size, UnitPref.Metric);

    private sealed class FakeFleetStatsBarSource(params RepositoryResult<FleetStats>[] emissions) : IFleetStatsBarSource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetStats>> StreamAsync(
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
