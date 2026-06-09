using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the WeeklySummaryCardWidget's UI-thread-free logic — the JSON parse adapter
/// (the useWeeklyDigest read), the kilometres→display distance + Wh/km→Wh/mi efficiency conversion, the
/// week-over-week trend logic (em dash / "~0%" / signed direction + good-bad flag), the SI→display
/// projection across the compact / 2-up / wide-tall footprints (grid tiles vs inline summary row), the
/// Narrator names, the cache-then-network result mapper, the single-endpoint per-vehicle data source
/// (primary resolution + the path-scoped weekly-digest read), the registry metadata, the diagnostics, and
/// the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline) plus the footprint + unit + currency switches. Mirrors the web spec
/// (web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx).
/// </summary>
public sealed class WeeklySummaryCardWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string LoadedJson =
        """{"drives":5,"distance_km":100,"energy_kwh":50,"cost":12,"efficiency":150,"prev_drives":4,"prev_distance_km":80,"prev_energy_kwh":40,"prev_cost":15,"prev_efficiency":160}""";

    private static WeeklyDigest Digest(
        double drives = 5,
        double distanceKm = 100,
        double energyKwh = 50,
        double cost = 12,
        double efficiencyWhKm = 150,
        double prevDrives = 4,
        double prevDistanceKm = 80,
        double prevEnergyKwh = 40,
        double prevCost = 15,
        double prevEfficiencyWhKm = 160) =>
        new(drives, distanceKm, energyKwh, cost, efficiencyWhKm, prevDrives, prevDistanceKm, prevEnergyKwh, prevCost, prevEfficiencyWhKm);

    // ---- Parse adapter (web useWeeklyDigest read) ----------------------------------

    [Fact]
    public void FromResponse_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        var digest = WeeklyDigest.FromResponse(doc.RootElement);

        Assert.NotNull(digest);
        Assert.Equal(5, digest!.Drives);
        Assert.Equal(100, digest.DistanceKm);
        Assert.Equal(50, digest.EnergyKwh);
        Assert.Equal(12, digest.Cost);
        Assert.Equal(150, digest.EfficiencyWhKm);
        Assert.Equal(4, digest.PrevDrives);
        Assert.Equal(80, digest.PrevDistanceKm);
        Assert.Equal(40, digest.PrevEnergyKwh);
        Assert.Equal(15, digest.PrevCost);
        Assert.Equal(160, digest.PrevEfficiencyWhKm);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"distance_km":42}""");

        var digest = WeeklyDigest.FromResponse(doc.RootElement);

        Assert.NotNull(digest);
        Assert.Equal(42, digest!.DistanceKm);
        Assert.Equal(0, digest.EnergyKwh);
        Assert.Equal(0, digest.Cost);
        Assert.Equal(0, digest.PrevDistanceKm);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("\"oops\"")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(WeeklyDigest.FromResponse(doc.RootElement));
    }

    // ---- Size / footprint flags (web isCompact / isWide / isTall) ------------------

    [Theory]
    [InlineData(1, 1, true, false, false, 2)]  // compact
    [InlineData(2, 1, false, false, false, 2)] // 2x1: 2-up grid + inline row
    [InlineData(1, 2, false, false, true, 2)]  // min (tall): 2-up grid, all four tiles
    [InlineData(2, 2, false, false, true, 2)]  // default (tall)
    [InlineData(3, 2, false, true, true, 4)]   // wide
    [InlineData(4, 2, false, true, true, 4)]   // wide max width
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide, bool tall, int gridCols)
    {
        var size = new WeeklySummarySize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(tall, size.IsTall);
        Assert.Equal(gridCols, size.GridColumns);
    }

    // ---- Trend logic (web trendOf) -------------------------------------------------

    [Fact]
    public void Trend_zero_previous_is_em_dash_flat()
    {
        var trend = WeeklyTrend.Of(100, 0);
        Assert.Equal(WeeklyTrendDirection.Flat, trend.Direction);
        Assert.Equal("\u2014", trend.Value);
        Assert.False(trend.Positive);
    }

    [Fact]
    public void Trend_sub_one_percent_is_approx_zero_flat()
    {
        var trend = WeeklyTrend.Of(100.4, 100);
        Assert.Equal(WeeklyTrendDirection.Flat, trend.Direction);
        Assert.Equal("~0%", trend.Value);
    }

    [Fact]
    public void Trend_increase_is_up_and_positive_when_higher_better()
    {
        var trend = WeeklyTrend.Of(100, 80);
        Assert.Equal(WeeklyTrendDirection.Up, trend.Direction);
        Assert.Equal("25%", trend.Value);
        Assert.True(trend.Positive);
    }

    [Fact]
    public void Trend_decrease_is_down_and_positive_when_lower_better()
    {
        // Cost / efficiency: a drop is the good outcome.
        var trend = WeeklyTrend.Of(12, 15, lowerIsPositive: true);
        Assert.Equal(WeeklyTrendDirection.Down, trend.Direction);
        Assert.Equal("20%", trend.Value);
        Assert.True(trend.Positive);
    }

    [Fact]
    public void Trend_increase_is_down_outcome_when_lower_better()
    {
        var trend = WeeklyTrend.Of(15, 12, lowerIsPositive: true);
        Assert.Equal(WeeklyTrendDirection.Up, trend.Direction);
        Assert.False(trend.Positive);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_all_four_stats()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(), new WeeklySummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(4, display.GridStats.Count);

        Assert.Equal("Distance", display.GridStats[0].Label);
        Assert.Equal("100.0", display.GridStats[0].Value);
        Assert.Equal("km", display.GridStats[0].Unit);
        Assert.Equal(WeeklyTrendDirection.Up, display.GridStats[0].Trend.Direction);

        Assert.Equal("Energy", display.GridStats[1].Label);
        Assert.Equal("50.0", display.GridStats[1].Value);
        Assert.Equal("kWh", display.GridStats[1].Unit);

        Assert.Equal("Cost", display.GridStats[2].Label);
        Assert.Equal("$12.00", display.GridStats[2].Value);
        Assert.Null(display.GridStats[2].Unit);
        Assert.True(display.GridStats[2].Trend.Positive); // cost fell 15 -> 12

        Assert.Equal("Efficiency", display.GridStats[3].Label);
        Assert.Equal("150", display.GridStats[3].Value);
        Assert.Equal("Wh/km", display.GridStats[3].Unit);
        Assert.True(display.GridStats[3].Trend.Positive); // efficiency fell 160 -> 150
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_distance_and_efficiency()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(distanceKm: 100, efficiencyWhKm: 150), new WeeklySummarySize(2, 2), UnitPref.Imperial, "$", Localizer);

        Assert.Equal("62.1", display.GridStats[0].Value);   // 100 km -> 62.1 mi
        Assert.Equal("mi", display.GridStats[0].Unit);

        Assert.Equal("241", display.GridStats[3].Value);    // 150 Wh/km * 1.60934 -> 241 Wh/mi
        Assert.Equal("Wh/mi", display.GridStats[3].Unit);
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(cost: 20), new WeeklySummarySize(2, 2), UnitPref.Metric, "\u20AC", Localizer);

        Assert.StartsWith("\u20AC", display.GridStats[2].Value, StringComparison.Ordinal);
    }

    // ---- Projection (layout partition) ---------------------------------------------

    [Fact]
    public void Project_two_by_one_splits_grid_and_inline()
    {
        // 2x1 (not wide, not tall): web renders Distance+Energy in the grid and Cost+Efficiency inline.
        var display = WeeklySummaryProjection.Project(
            Digest(), new WeeklySummarySize(2, 1), UnitPref.Metric, "$", Localizer);

        Assert.Equal(2, display.GridStats.Count);
        Assert.Equal("Distance", display.GridStats[0].Label);
        Assert.Equal("Energy", display.GridStats[1].Label);

        Assert.Equal(2, display.InlineStats.Count);
        Assert.Equal("$12.00", display.InlineStats[0].Value);          // cost
        Assert.Equal("150 Wh/km", display.InlineStats[1].Value);       // efficiency + unit
    }

    [Fact]
    public void Project_tall_includes_cost_and_efficiency_in_grid()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(), new WeeklySummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        Assert.Equal(4, display.GridStats.Count);
        Assert.Empty(display.InlineStats);
    }

    [Fact]
    public void Project_wide_uses_four_columns()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(), new WeeklySummarySize(4, 2), UnitPref.Metric, "$", Localizer);

        Assert.True(display.IsWide);
        Assert.Equal(4, display.GridColumns);
        Assert.Equal(4, display.GridStats.Count);
    }

    [Fact]
    public void Project_compact_exposes_big_distance_number()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(distanceKm: 1234), new WeeklySummarySize(1, 1), UnitPref.Metric, "$", Localizer);

        Assert.True(display.IsCompact);
        Assert.Equal("1,234", display.CompactValue);
        Assert.Equal("km", display.CompactUnit);
        Assert.Equal("km this week", display.CompactCaption);
        Assert.Contains("1,234", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("this week", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_stats_have_non_empty_accessibility_names()
    {
        var display = WeeklySummaryProjection.Project(
            Digest(), new WeeklySummarySize(2, 2), UnitPref.Metric, "$", Localizer);

        foreach (var stat in display.GridStats)
        {
            Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName));
            Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal);
            Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        var cached = WeeklySummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(100, cached.Value!.DistanceKm);

        var offline = WeeklySummaryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(50, offline.Value!.EnergyKwh);
    }

    [Fact]
    public void Mapper_non_object_payload_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");

        Assert.Equal(LoadStatus.Empty, WeeklySummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        Assert.Equal(LoadStatus.Loaded, WeeklySummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, WeeklySummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, WeeklySummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WeeklyDigest>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_metrics()
    {
        using var vm = NewViewModel(Loaded(Digest()));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.GridStats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<WeeklyDigest>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No weekly data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeeklyDigest>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<WeeklyDigest>.Cached(Digest(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<WeeklyDigest>.OfflineCached(
            Digest(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeeklyDigest>.Loading(),
            RepositoryResult<WeeklyDigest>.Cached(Digest(distanceKm: 50), Now, stale: false),
            RepositoryResult<WeeklyDigest>.Loaded(Digest(distanceKm: 100), Now));
        await vm.LoadAsync();

        Assert.Equal(WeeklySummaryState.Loaded, vm.State);
        Assert.Equal("100.0", vm.Display.GridStats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new WeeklySummarySize(2, 2), Loaded(Digest()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new WeeklySummarySize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(WeeklySummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Digest(distanceKm: 100)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.GridStats[0].Unit);
        Assert.Equal("100.0", vm.Display.GridStats[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.GridStats[0].Unit);
        Assert.Equal("62.1", vm.Display.GridStats[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost()
    {
        using var vm = NewViewModel(Loaded(Digest(cost: 20)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.GridStats[2].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.GridStats[2].Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<WeeklyDigest>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Weekly Summary", vm.Title);
        Assert.Equal("No weekly data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Digest()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WeeklySummaryViewModel.State), changed);
        Assert.Contains(nameof(WeeklySummaryViewModel.Display), changed);
    }

    // ---- Data source (per-vehicle weekly-digest read) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new WeeklySummarySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_digest()
    {
        using var snapshot = JsonDocument.Parse(LoadedJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new WeeklySummarySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(100, terminal.Value!.DistanceKm);
        Assert.Equal(50, terminal.Value.EnergyKwh);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_weekly_digest", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.True(request.Query is null || request.Query.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var snapshot = JsonDocument.Parse(LoadedJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new WeeklySummarySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new WeeklySummarySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("weekly-summary-card", WeeklySummaryRegistration.Id);
        Assert.Equal("analytics", WeeklySummaryRegistration.Category);
        Assert.Equal("WeeklySummaryCardWidget", WeeklySummaryRegistration.Slug);
        Assert.Equal(new WeeklySummarySize(2, 2), WeeklySummaryRegistration.DefaultSize);
        Assert.Equal(new WeeklySummarySize(1, 2), WeeklySummaryRegistration.MinSize);
        Assert.Equal(new WeeklySummarySize(4, 40), WeeklySummaryRegistration.MaxSize);
        Assert.Equal("Weekly Summary", WeeklySummaryRegistration.Name(Localizer));
        Assert.Contains("efficiency", WeeklySummaryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, WeeklySummaryRegistration.IsWithinBounds(new WeeklySummarySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new WeeklySummarySize(1, 2), WeeklySummaryRegistration.Clamp(new WeeklySummarySize(0, 0)));
        Assert.Equal(new WeeklySummarySize(4, 40), WeeklySummaryRegistration.Clamp(new WeeklySummarySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WeeklySummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WeeklySummaryCardWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_mi_to_km_matches_web_constant() =>
        Assert.Equal(1.60934, WeeklySummaryProjection.MiToKm);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<WeeklyDigest> Loaded(WeeklyDigest digest) =>
        RepositoryResult<WeeklyDigest>.Loaded(digest, Now);

    private static WeeklySummaryViewModel NewViewModel(params RepositoryResult<WeeklyDigest>[] emissions) =>
        NewViewModel(WeeklySummarySize.Default, emissions);

    private static WeeklySummaryViewModel NewViewModel(
        WeeklySummarySize size,
        params RepositoryResult<WeeklyDigest>[] emissions) =>
        new(new FakeWeeklySummarySource(emissions), Localizer, size, UnitPref.Metric, "$", () => Now);

    private static async Task<List<RepositoryResult<WeeklyDigest>>> Drain(IWeeklySummarySource source)
    {
        var list = new List<RepositoryResult<WeeklyDigest>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeWeeklySummarySource(params RepositoryResult<WeeklyDigest>[] emissions) : IWeeklySummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<WeeklyDigest>> StreamAsync(
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
