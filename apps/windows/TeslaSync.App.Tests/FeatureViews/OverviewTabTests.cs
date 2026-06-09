using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the OverviewTab surface's UI-thread-free logic — the FleetAnalytics JSON parse
/// adapter (vehicle_comparison / day_of_week / monthly_trend), the SI→display projection (the distance
/// km→m→unit conversion, the drives/avg-distance composed chart, the two cost bars + savings line with a
/// negative-aware baseline, the per-section empty gates and the localized titles), the web-parity Quick Link
/// routes + last-segment fallback labels, the cache-then-network result mapper, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/analytics/components/analytics/OverviewTab.tsx). The WinUI view
/// itself (OverviewTab.cs) is exercised by the app build.
/// </summary>
public sealed class OverviewTabTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private const string FullJson = """
    {
      "vehicle_comparison": [
        { "id": 1, "name": "Model 3", "distance": 100, "energy": 50, "efficiency": 150, "drives": 10 },
        { "id": 2, "name": "Model Y", "distance": 200, "energy": 80, "efficiency": 160, "drives": 20 }
      ],
      "drive_analytics": {
        "day_of_week": [
          { "day": "Mon", "drives": 5, "distance": 50, "avg_distance": 10 },
          { "day": "Tue", "drives": 8, "distance": 80, "avg_distance": 12 }
        ]
      },
      "charging_analytics": {
        "monthly_trend": [
          { "month": "Jan", "cost": 30, "gas_cost": 90, "savings": 60 },
          { "month": "Feb", "cost": 25, "gas_cost": 100, "savings": 75 }
        ]
      }
    }
    """;

    private static JsonElement El(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static OverviewData FullData() => OverviewData.Parse(El(FullJson));

    private static OverviewTabDisplay Project(OverviewData data, UnitPref? units = null) =>
        OverviewTabProjection.Project(data, units ?? UnitPref.Metric, Localizer);

    // ── Parse adapter ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Parse_reads_all_three_series_from_a_fleet_object()
    {
        var data = FullData();

        Assert.Equal(2, data.Vehicles.Count);
        Assert.Equal("Model 3", data.Vehicles[0].Name);
        Assert.Equal(100, data.Vehicles[0].DistanceKm);
        Assert.Equal(2, data.DaysOfWeek.Count);
        Assert.Equal(5, data.DaysOfWeek[0].Drives);
        Assert.Equal(10, data.DaysOfWeek[0].AvgDistance);
        Assert.Equal(2, data.Months.Count);
        Assert.Equal(30, data.Months[0].Cost);
        Assert.Equal(90, data.Months[0].GasCost);
        Assert.Equal(60, data.Months[0].Savings);
        Assert.True(data.HasAny);
    }

    [Fact]
    public void Parse_non_object_body_is_empty()
    {
        Assert.False(OverviewData.Parse(El("[]")).HasAny);
        Assert.False(OverviewData.Parse(El("null")).HasAny);
        Assert.False(OverviewData.Parse(El("42")).HasAny);
    }

    [Fact]
    public void Parse_tolerates_missing_sections_and_fields()
    {
        var data = OverviewData.Parse(El("""{ "vehicle_comparison": [ { "name": "Solo" } ] }"""));

        Assert.Single(data.Vehicles);
        Assert.Equal("Solo", data.Vehicles[0].Name);
        Assert.Equal(0, data.Vehicles[0].DistanceKm); // missing distance → 0 (web safe())
        Assert.Empty(data.DaysOfWeek);
        Assert.Empty(data.Months);
    }

    [Fact]
    public void Parse_tolerates_numeric_strings()
    {
        var data = OverviewData.Parse(El("""{ "vehicle_comparison": [ { "name": "A", "distance": "150.5" } ] }"""));
        Assert.Equal(150.5, data.Vehicles[0].DistanceKm);
    }

    // ── Projection: Distance by Vehicle ──────────────────────────────────────────────────────────────

    [Fact]
    public void Distance_chart_metric_keeps_km_and_scales_bars()
    {
        var distance = Project(FullData()).Charts[0];

        Assert.Equal("distance", distance.Key);
        Assert.True(distance.HasData);
        Assert.Equal(new[] { "Model 3", "Model Y" }, distance.Categories);
        Assert.Single(distance.BarSeries);
        Assert.Equal("km", distance.BarSeries[0].Name);
        Assert.Null(distance.LineSeries);

        // Web parity: convertDistanceFromSI(distanceKm * 1000, km) == distanceKm.
        Assert.Equal(100, distance.BarSeries[0].Bars[0].Value, 3);
        Assert.Equal(200, distance.BarSeries[0].Bars[1].Value, 3);
        // Heights normalise against the max (200): 0.5 and 1.0.
        Assert.Equal(0.5, distance.BarSeries[0].Bars[0].HeightRatio, 3);
        Assert.Equal(1.0, distance.BarSeries[0].Bars[1].HeightRatio, 3);
    }

    [Fact]
    public void Distance_chart_imperial_converts_km_to_miles()
    {
        var distance = Project(FullData(), UnitPref.Imperial).Charts[0];

        Assert.Equal("mi", distance.BarSeries[0].Name);
        // 100 km → 100000 m / 1609.344 = 62.137 mi ; 200 km → 124.274 mi.
        Assert.Equal(62.137, distance.BarSeries[0].Bars[0].Value, 2);
        Assert.Equal(124.274, distance.BarSeries[0].Bars[1].Value, 2);
    }

    // ── Projection: Day of Week Pattern (bar + line) ─────────────────────────────────────────────────

    [Fact]
    public void DayOfWeek_chart_has_drives_bar_and_raw_avg_distance_line()
    {
        var dow = Project(FullData()).Charts[1];

        Assert.Equal("dayOfWeek", dow.Key);
        Assert.True(dow.HasData);
        Assert.Single(dow.BarSeries);
        Assert.Equal("Drives", dow.BarSeries[0].Name);
        Assert.NotNull(dow.LineSeries);
        Assert.Equal("Avg Distance", dow.LineSeries!.Name);

        // Drives 5,8 on the left axis: 5/8 and 1.0.
        Assert.Equal(0.625, dow.BarSeries[0].Bars[0].HeightRatio, 3);
        Assert.Equal(1.0, dow.BarSeries[0].Bars[1].HeightRatio, 3);
        // avg_distance plotted verbatim (web does not convert) on a 0..12 right axis: 10/12 and 1.0.
        Assert.Equal(10.0 / 12, dow.LineSeries!.Points[0].Ratio, 3);
        Assert.Equal(1.0, dow.LineSeries!.Points[1].Ratio, 3);
        Assert.Equal(10, dow.LineSeries!.Points[0].Value, 3);
    }

    // ── Projection: Monthly Cost Comparison (2 bars + line) ──────────────────────────────────────────

    [Fact]
    public void Monthly_chart_has_two_cost_bars_sharing_one_axis_and_a_savings_line()
    {
        var monthly = Project(FullData()).Charts[2];

        Assert.Equal("monthlyCost", monthly.Key);
        Assert.Equal(2, monthly.BarSeries.Count);
        Assert.Equal("Electric Cost", monthly.BarSeries[0].Name);
        Assert.Equal("Gas Cost", monthly.BarSeries[1].Name);
        Assert.NotNull(monthly.LineSeries);
        Assert.Equal("Savings", monthly.LineSeries!.Name);

        // Both bar series share the left-axis max = max(30,25,90,100) = 100.
        Assert.Equal(0.30, monthly.BarSeries[0].Bars[0].HeightRatio, 3); // electric 30
        Assert.Equal(0.90, monthly.BarSeries[1].Bars[0].HeightRatio, 3); // gas 90
        Assert.Equal(1.00, monthly.BarSeries[1].Bars[1].HeightRatio, 3); // gas 100
    }

    [Fact]
    public void Monthly_savings_line_keeps_a_zero_baseline_when_negative()
    {
        var data = OverviewData.Parse(El("""
        { "charging_analytics": { "monthly_trend": [
          { "month": "Jan", "cost": 10, "gas_cost": 5, "savings": -20 },
          { "month": "Feb", "cost": 10, "gas_cost": 5, "savings": 40 } ] } }
        """));

        var line = Project(data).Charts[2].LineSeries!;

        // Right-axis domain includes zero: [-20, 40], range 60 → zero sits at 20/60.
        Assert.Equal(20.0 / 60, line.ZeroRatio, 3);
        Assert.Equal(0.0, line.Points[0].Ratio, 3); // -20 at the bottom
        Assert.Equal(1.0, line.Points[1].Ratio, 3); // 40 at the top
    }

    // ── Per-section empties + i18n ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_data_yields_three_empty_charts_plus_quick_links()
    {
        var display = Project(OverviewData.Empty);

        Assert.Equal(3, display.Charts.Count);
        Assert.All(display.Charts, c => Assert.False(c.HasData));
        Assert.Equal("No vehicle data", display.Charts[0].EmptyMessage);
        Assert.Equal("No day-of-week data", display.Charts[1].EmptyMessage);
        Assert.Equal("No monthly data", display.Charts[2].EmptyMessage);
        Assert.Equal(5, display.QuickLinks.Count);
    }

    [Fact]
    public void Section_titles_and_quick_links_title_resolve_through_localizer()
    {
        var d = Project(OverviewData.Empty);

        Assert.Equal("Distance by Vehicle", d.Charts[0].Title);
        Assert.Equal("Day of Week Pattern", d.Charts[1].Title);
        Assert.Equal("Monthly Cost Comparison", d.Charts[2].Title);
        Assert.Equal("Quick Links", d.QuickLinksTitle);
    }

    [Fact]
    public void Quick_links_use_web_routes_and_last_segment_fallback_labels()
    {
        var links = Project(OverviewData.Empty).QuickLinks;

        Assert.Collection(
            links,
            l => { Assert.Equal("/statistics", l.Route); Assert.Equal("statistics", l.Label); },
            l => { Assert.Equal("/period-compare", l.Route); Assert.Equal("compare", l.Label); },
            l => { Assert.Equal("/weekly-digest", l.Route); Assert.Equal("weeklyDigest", l.Label); },
            l => { Assert.Equal("/mileage", l.Route); Assert.Equal("mileage", l.Label); },
            l => { Assert.Equal("/timeline", l.Route); Assert.Equal("timeline", l.Label); });
    }

    // ── Accessibility (Narrator names projected for every datum + link) ──────────────────────────────

    [Fact]
    public void Bars_line_points_and_links_carry_narrator_names()
    {
        var d = Project(FullData());

        Assert.Contains("Model 3", d.Charts[0].BarSeries[0].Bars[0].AutomationName);
        Assert.Contains("Drives", d.Charts[1].BarSeries[0].Bars[0].AutomationName);
        Assert.Contains("Avg Distance", d.Charts[1].LineSeries!.Points[0].AutomationName);
        Assert.Contains("Electric Cost", d.Charts[2].BarSeries[0].Bars[0].AutomationName);
        Assert.All(d.QuickLinks, l => Assert.False(string.IsNullOrWhiteSpace(l.AutomationName)));
        Assert.All(d.Charts, c => Assert.False(string.IsNullOrWhiteSpace(c.AriaLabel)));
    }

    // ── Result mapper ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Mapper_parses_value_bearing_states_and_preserves_lifecycle()
    {
        Assert.Equal(LoadStatus.Loading, OverviewTabResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, OverviewTabResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var loaded = OverviewTabResultMapper.Map(RepositoryResult<JsonElement>.Loaded(El(FullJson), Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Vehicles.Count);

        var cached = OverviewTabResultMapper.Map(RepositoryResult<JsonElement>.Cached(El(FullJson), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);

        var error = OverviewTabResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, error.Status);
        Assert.Null(error.Value);
    }

    // ── State-holder view-model: per-state transitions ───────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_then_loaded()
    {
        var vm = NewViewModel(
            RepositoryResult<OverviewData>.Loading(),
            RepositoryResult<OverviewData>.Loaded(FullData(), Now));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.False(vm.IsFetching);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_non_object_body_becomes_empty()
    {
        var vm = NewViewModel(RepositoryResult<OverviewData>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_becomes_error_with_retry_message()
    {
        var vm = NewViewModel(
            RepositoryResult<OverviewData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.Equal(1, vm.Attempts);
    }

    [Fact]
    public async Task ViewModel_stale_cache_becomes_stale_state()
    {
        var vm = NewViewModel(RepositoryResult<OverviewData>.Cached(FullData(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_with_message()
    {
        var vm = NewViewModel(RepositoryResult<OverviewData>.OfflineCached(
            FullData(), Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_keeps_content_visible_while_refreshing()
    {
        var vm = NewViewModel(
            RepositoryResult<OverviewData>.Loading(),
            RepositoryResult<OverviewData>.Cached(FullData(), Now, stale: false),
            RepositoryResult<OverviewData>.Loaded(FullData(), Now));

        await vm.LoadAsync();

        Assert.Equal(OverviewTabState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        var vm = NewViewModel(
            RepositoryResult<OverviewData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x")));

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_distance_series_label()
    {
        var vm = NewViewModel(RepositoryResult<OverviewData>.Loaded(FullData(), Now));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Charts[0].BarSeries[0].Name);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mi", vm.Display.Charts[0].BarSeries[0].Name);
        Assert.Equal(62.137, vm.Display.Charts[0].BarSeries[0].Bars[0].Value, 2);
    }

    // ── Diagnostics ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        string? captured = null;
        var diagnostics = new OverviewTabDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=OverviewTab", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    private static OverviewTabViewModel NewViewModel(params RepositoryResult<OverviewData>[] sequence) =>
        new(new FakeSource(sequence), Localizer);

    private sealed class FakeSource(params RepositoryResult<OverviewData>[] sequence) : IOverviewTabSource
    {
        private readonly IReadOnlyList<RepositoryResult<OverviewData>> _sequence = sequence;

        public async IAsyncEnumerable<RepositoryResult<OverviewData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _sequence)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }
    }
}
