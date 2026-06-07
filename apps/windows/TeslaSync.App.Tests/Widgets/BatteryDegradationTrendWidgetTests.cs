using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the BatteryDegradationTrendWidget's UI-thread-free logic — the JSON parse
/// adapter (trend + monthly point), the stats / chart / isEmpty projection across the compact / standard
/// footprints (including the 80% end-of-life reference-line visibility test), the cache-then-network result
/// mapper, the per-vehicle data source (primary resolution + query-scoped request), the registry metadata,
/// the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty /
/// error / stale / offline) including the web <c>isEmpty</c> gate. Mirrors the web spec
/// (web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx + api/hooks/useEnergy.ts).
/// </summary>
public sealed class BatteryDegradationTrendWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";
    private const string MinusSign = "\u2212";

    private static DegradationTrendPoint Point(string month, double health, double range = 300) =>
        new(month, health, range);

    private static BatteryDegradationTrend Trend(
        double? health = 92.4,
        double? rate = 0.08,
        double? cycles = 312,
        IReadOnlyList<DegradationTrendPoint>? points = null) =>
        new(health, rate, cycles, points ?? Array.Empty<DegradationTrendPoint>());

    private static IReadOnlyList<DegradationTrendPoint> Series(params double[] health)
    {
        var list = new List<DegradationTrendPoint>(health.Length);
        for (int i = 0; i < health.Length; i++)
        {
            list.Add(Point($"2026-{i + 1:00}", health[i]));
        }

        return list;
    }

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"current_health_pct":92.4,"current_health":80.0,"degradation_rate_pct_per_month":0.08,
         "current_cycles":312,
         "monthly_trend":[
           {"month":"2025-01","avg_health":98.5,"avg_capacity":75.1,"avg_range":410.0},
           {"month":"2025-02","avg_health":97.2,"avg_capacity":74.6,"avg_range":402.5}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);

        Assert.Equal(92.4, trend.CurrentHealthPct);
        Assert.Equal(0.08, trend.DegradationRatePctPerMonth);
        Assert.Equal(312, trend.CurrentCycles);

        Assert.Equal(2, trend.MonthlyTrend.Count);
        Assert.Equal("2025-01", trend.MonthlyTrend[0].Month);
        Assert.Equal(98.5, trend.MonthlyTrend[0].AvgHealth);
        Assert.Equal(410.0, trend.MonthlyTrend[0].AvgRange);
    }

    [Fact]
    public void FromJson_falls_back_to_current_health_when_pct_absent()
    {
        using var doc = JsonDocument.Parse("""{"current_health":88.5}""");

        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);

        Assert.Equal(88.5, trend.CurrentHealthPct);
    }

    [Fact]
    public void FromJson_keeps_literal_zero_health()
    {
        // Web parity: the ?? chain only falls through on absent/null, so a literal 0 stays 0 (not empty).
        using var doc = JsonDocument.Parse("""{"current_health_pct":0}""");

        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);

        Assert.Equal(0, trend.CurrentHealthPct);
        Assert.False(trend.IsEmpty);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90}""");

        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);

        Assert.Equal(90, trend.CurrentHealthPct);
        Assert.Null(trend.DegradationRatePctPerMonth);
        Assert.Null(trend.CurrentCycles);
        Assert.Empty(trend.MonthlyTrend);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);
        Assert.True(trend.IsEmpty);
        Assert.Empty(trend.MonthlyTrend);
    }

    [Fact]
    public void FromJson_ignores_non_array_monthly_trend()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90,"monthly_trend":"nope"}""");

        var trend = BatteryDegradationTrend.FromJson(doc.RootElement);

        Assert.Empty(trend.MonthlyTrend);
    }

    [Fact]
    public void TrendPoint_FromJson_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"month":"2025-03"}""");
        var point = DegradationTrendPoint.FromJson(doc.RootElement);

        Assert.Equal("2025-03", point.Month);
        Assert.Equal(0, point.AvgHealth);
        Assert.Equal(0, point.AvgRange);

        using var nonObj = JsonDocument.Parse("7");
        var fallback = DegradationTrendPoint.FromJson(nonObj.RootElement);
        Assert.Equal(string.Empty, fallback.Month);
    }

    // ---- isEmpty gate (web isEmpty) ------------------------------------------------

    [Fact]
    public void IsEmpty_true_when_no_health_and_no_trend()
    {
        Assert.True(new BatteryDegradationTrend(null, 0.2, null, Array.Empty<DegradationTrendPoint>()).IsEmpty);
    }

    [Fact]
    public void IsEmpty_false_when_health_present()
    {
        Assert.False(Trend(health: 90, points: Array.Empty<DegradationTrendPoint>()).IsEmpty);
    }

    [Fact]
    public void IsEmpty_false_when_trend_present_even_without_health()
    {
        Assert.False(new BatteryDegradationTrend(null, null, null, Series(95, 94)).IsEmpty);
    }

    // ---- Projection: stat row ------------------------------------------------------

    [Fact]
    public void Project_builds_soh_degradation_and_cycles_stats()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(health: 92.45, rate: 0.08, cycles: 312), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.Equal(3, view.Stats.Count);

        Assert.Equal("SoH", view.Stats[0].Label);
        Assert.Equal("92.5%", view.Stats[0].Value);
        Assert.Null(view.Stats[0].Unit);

        Assert.Equal("Degradation", view.Stats[1].Label);
        Assert.Equal($"{MinusSign}0.08%", view.Stats[1].Value);
        Assert.Equal("/mo", view.Stats[1].Unit);

        Assert.Equal("Cycles", view.Stats[2].Label);
        Assert.Equal("312", view.Stats[2].Value);
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.3)]
    public void Project_hides_degradation_when_not_positive(double rate)
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(rate: rate), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.DoesNotContain(view.Stats, s => string.Equals(s.Label, "Degradation", StringComparison.Ordinal));
        Assert.Equal(2, view.Stats.Count);
    }

    [Fact]
    public void Project_hides_degradation_when_rate_null()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(rate: null), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.DoesNotContain(view.Stats, s => string.Equals(s.Label, "Degradation", StringComparison.Ordinal));
    }

    [Fact]
    public void Project_renders_em_dash_for_null_health_and_cycles()
    {
        var view = BatteryDegradationTrendProjection.Project(
            new BatteryDegradationTrend(null, null, null, Series(95, 90)),
            new BatteryDegradationTrendSize(2, 4),
            Localizer);

        Assert.Equal(EmDash, view.Stats[0].Value); // SoH
        Assert.Equal(EmDash, view.Stats[^1].Value); // Cycles
    }

    [Fact]
    public void Project_compact_automation_name_lists_stats()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(health: 91.0, rate: 0.0, cycles: 100), new BatteryDegradationTrendSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.Contains("SoH", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("91.0%", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Cycles", view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Projection: chart ---------------------------------------------------------

    [Fact]
    public void Project_builds_chart_series_from_monthly_health()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(points: Series(98.5, 97.2, 95.1)), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.True(view.HasChart);
        Assert.Equal(new[] { 98.5, 97.2, 95.1 }, view.ChartHealth);
        Assert.Equal(new[] { "2026-01", "2026-02", "2026-03" }, view.ChartMonths);
        Assert.Equal("Health %", view.ChartSeriesName);
    }

    [Fact]
    public void Project_single_point_has_no_chart_and_keeps_need_more_data_copy()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(points: Series(98.5)), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.False(view.HasChart);
        Assert.Equal("More data needed for trend", view.ChartEmptyMessage);
    }

    [Fact]
    public void Project_shows_eol_reference_when_health_reaches_threshold()
    {
        // Lowest sample 81 <= 80 + 2 domain padding -> reference line visible (web domain [dataMin-2, 100]).
        var view = BatteryDegradationTrendProjection.Project(
            Trend(points: Series(95, 88, 81)), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.True(view.HasChart);
        Assert.True(view.ShowEolThreshold);
        Assert.Equal(80.0, BatteryDegradationTrendProjection.EolThresholdPct);
    }

    [Fact]
    public void Project_hides_eol_reference_when_health_above_domain()
    {
        // Lowest sample 88 > 82 -> the 80% line sits outside the zoomed-in domain, as on web.
        var view = BatteryDegradationTrendProjection.Project(
            Trend(points: Series(96, 92, 88)), new BatteryDegradationTrendSize(2, 4), Localizer);

        Assert.False(view.ShowEolThreshold);
    }

    [Fact]
    public void Project_compact_marks_compact_and_keeps_stats()
    {
        var view = BatteryDegradationTrendProjection.Project(
            Trend(points: Series(95, 94)), new BatteryDegradationTrendSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.NotEmpty(view.Stats);
        // Web parity: isCompact requires BOTH cols<=1 AND rows<=1.
        Assert.False(BatteryDegradationTrendProjection.Project(
            Trend(), new BatteryDegradationTrendSize(1, 2), Localizer).IsCompact);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"current_health_pct":90.1,"monthly_trend":[{"month":"a","avg_health":90.1,"avg_range":300}]}""");

        var cached = BatteryDegradationTrendResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(90.1, cached.Value!.CurrentHealthPct);

        var offline = BatteryDegradationTrendResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.MonthlyTrend);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90}""");

        Assert.Equal(LoadStatus.Loaded, BatteryDegradationTrendResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryDegradationTrendResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryDegradationTrendResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryDegradationTrend>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Trend(points: Series(98, 95))));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Loaded, vm.State);
        Assert.True(vm.Display.HasChart);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty_via_isEmpty_gate()
    {
        // Web parity: a resolved body with no current health AND no monthly rows hits the isEmpty gate.
        var noData = new BatteryDegradationTrend(null, 0.2, null, Array.Empty<DegradationTrendPoint>());
        using var vm = NewViewModel(Loaded(noData));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Empty, vm.State);
        Assert.Equal("No degradation data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryDegradationTrend>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryDegradationTrend>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryDegradationTrend>.Cached(Trend(points: Series(98, 95)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasChart);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryDegradationTrend>.OfflineCached(
            Trend(points: Series(98, 95)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryDegradationTrend>.Loading(),
            RepositoryResult<BatteryDegradationTrend>.Cached(Trend(health: 80.0), Now, stale: false),
            RepositoryResult<BatteryDegradationTrend>.Loaded(Trend(health: 90.0), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationTrendState.Loaded, vm.State);
        Assert.Equal("90.0%", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new BatteryDegradationTrendSize(2, 4), Loaded(Trend(points: Series(98, 95))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new BatteryDegradationTrendSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(BatteryDegradationTrendState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryDegradationTrend>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery Degradation", vm.Title);
        Assert.Equal("No degradation data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Trend(points: Series(98, 95))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryDegradationTrendViewModel.State), changed);
        Assert.Contains(nameof(BatteryDegradationTrendViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-degradation-trend", BatteryDegradationTrendRegistration.Id);
        Assert.Equal("battery", BatteryDegradationTrendRegistration.Category);
        Assert.Equal("BatteryDegradationTrendWidget", BatteryDegradationTrendRegistration.Slug);
        Assert.Equal(new BatteryDegradationTrendSize(2, 4), BatteryDegradationTrendRegistration.DefaultSize);
        Assert.Equal(new BatteryDegradationTrendSize(1, 2), BatteryDegradationTrendRegistration.MinSize);
        Assert.Equal(new BatteryDegradationTrendSize(4, 40), BatteryDegradationTrendRegistration.MaxSize);
        Assert.Equal("Battery Degradation Trend", BatteryDegradationTrendRegistration.Name(Localizer));
        Assert.Contains("range", BatteryDegradationTrendRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryDegradationTrendRegistration.IsWithinBounds(new BatteryDegradationTrendSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryDegradationTrendSize(1, 2), BatteryDegradationTrendRegistration.Clamp(new BatteryDegradationTrendSize(0, 0)));
        Assert.Equal(new BatteryDegradationTrendSize(4, 40), BatteryDegradationTrendRegistration.Clamp(new BatteryDegradationTrendSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryDegradationTrendDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryDegradationTrendWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryDegradationTrendSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"current_health_pct":91.2,"current_cycles":280,"monthly_trend":[{"month":"a","avg_health":91.2,"avg_range":300}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationTrendSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(91.2, terminal.Value!.CurrentHealthPct);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_battery_degradation", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"current_health_pct":90}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationTrendSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryDegradationTrendSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<BatteryDegradationTrend>>> Drain(IBatteryDegradationTrendSource source)
    {
        var list = new List<RepositoryResult<BatteryDegradationTrend>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<BatteryDegradationTrend> Loaded(BatteryDegradationTrend trend) =>
        RepositoryResult<BatteryDegradationTrend>.Loaded(trend, Now);

    private static BatteryDegradationTrendViewModel NewViewModel(params RepositoryResult<BatteryDegradationTrend>[] emissions) =>
        NewViewModel(BatteryDegradationTrendSize.Default, emissions);

    private static BatteryDegradationTrendViewModel NewViewModel(
        BatteryDegradationTrendSize size,
        params RepositoryResult<BatteryDegradationTrend>[] emissions) =>
        new(new FakeTrendSource(emissions), Localizer, size, () => Now);

    private sealed class FakeTrendSource(params RepositoryResult<BatteryDegradationTrend>[] emissions) : IBatteryDegradationTrendSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryDegradationTrend>> StreamAsync(
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
