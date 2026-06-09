using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
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
/// Headless verification of the ProjectedRangeWidget's UI-thread-free logic — the JSON parse adapter (the
/// useProjectedRange read), the kilometres→display distance conversion, the confidence-badge tiers, the
/// projected-vs-EPA percentage + comparison-bar tier, the factor rows, the projection across the compact /
/// standard / wide footprints, the Narrator name, the result mapper, the single-endpoint per-vehicle data
/// source (primary resolution + the path-scoped projected-range read), the registry metadata, the diagnostics,
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline)
/// plus the footprint + unit switches. Mirrors the web spec
/// (web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx).
/// </summary>
public sealed class ProjectedRangeWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string LoadedJson =
        """{"current_range_km":400,"new_range_km":450,"avg_daily_km":50,"health_score":95,"degradation_pct":8.5,"current_capacity_pct":92.3,"total_cycles":420}""";

    // ---- Parse adapter (web useProjectedRange read) --------------------------------

    [Fact]
    public void FromResponse_reads_all_projection_fields()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        var reading = ProjectedRangeReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(400, reading!.CurrentRangeKm);
        Assert.Equal(450, reading.NewRangeKm);
        Assert.Equal(50, reading.AvgDailyKm);
        Assert.Equal(95, reading.HealthScore);
        Assert.Equal(8.5, reading.DegradationPct);
        Assert.Equal(92.3, reading.CurrentCapacityPct);
        Assert.Equal(420, reading.TotalCycles);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"current_range_km":400}""");

        var reading = ProjectedRangeReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(400, reading!.CurrentRangeKm);
        Assert.Null(reading.NewRangeKm);
        Assert.Null(reading.HealthScore);
        Assert.Null(reading.TotalCycles);
    }

    [Fact]
    public void FromResponse_empty_object_is_a_reading_not_null()
    {
        // Web parity: an empty object is still truthy `data`, so the body renders (every value falls back).
        using var doc = JsonDocument.Parse("{}");

        var reading = ProjectedRangeReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.CurrentRangeKm);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ProjectedRangeReading.FromResponse(doc.RootElement));
    }

    // ---- Confidence badge (web healthBadge) ----------------------------------------

    [Theory]
    [InlineData(95, "Excellent", StatusKind.Success)]
    [InlineData(90, "Excellent", StatusKind.Success)]
    [InlineData(89.9, "Good", StatusKind.Success)]
    [InlineData(70, "Good", StatusKind.Success)]
    [InlineData(69, "Fair", StatusKind.Warning)]
    [InlineData(50, "Fair", StatusKind.Warning)]
    [InlineData(49, "Poor", StatusKind.Danger)]
    [InlineData(0, "Poor", StatusKind.Danger)]
    public void HealthBadge_matches_web_tiers(double score, string text, StatusKind status)
    {
        var badge = ProjectedRangeProjection.HealthBadge(score, Localizer);

        Assert.NotNull(badge);
        Assert.Equal(text, badge!.Text);
        Assert.Equal(status, badge.Status);
    }

    [Fact]
    public void HealthBadge_null_score_is_no_badge()
    {
        Assert.Null(ProjectedRangeProjection.HealthBadge(null, Localizer));
    }

    // ---- Distance conversion (web convertDistanceFromSI(value_km * 1000, unit)) -----

    [Fact]
    public void DistanceDisplay_metric_is_the_kilometre_value()
    {
        Assert.Equal(400, ProjectedRangeProjection.DistanceDisplay(400, UnitPref.Metric));
    }

    [Fact]
    public void DistanceDisplay_imperial_converts_km_to_miles()
    {
        // 400 km → 400000 m / 1609.344 = 248.5485 mi.
        double? mi = ProjectedRangeProjection.DistanceDisplay(400, UnitPref.Imperial);
        Assert.NotNull(mi);
        Assert.Equal(248.5485, mi!.Value, 4);
    }

    [Fact]
    public void DistanceDisplay_null_value_stays_null()
    {
        Assert.Null(ProjectedRangeProjection.DistanceDisplay(null, UnitPref.Metric));
    }

    // ---- Projected/EPA percentage (web rangePct) -----------------------------------

    [Theory]
    [InlineData(400, 450, 89)]   // round(88.88) = 89
    [InlineData(500, 450, 100)]  // round(111.1) clamped to 100
    [InlineData(225, 450, 50)]
    public void RangePct_matches_web(double projected, double epa, int expected)
    {
        Assert.Equal(expected, ProjectedRangeProjection.RangePct(projected, epa));
    }

    [Theory]
    [InlineData(null, 450.0)]
    [InlineData(400.0, null)]
    [InlineData(400.0, 0.0)]
    public void RangePct_is_null_when_either_side_is_missing(double? projected, double? epa)
    {
        Assert.Null(ProjectedRangeProjection.RangePct(projected, epa));
    }

    // ---- Comparison bar tier (web colour ternary) ----------------------------------

    [Theory]
    [InlineData(89, ProjectedRangeBarTier.Good)]
    [InlineData(80, ProjectedRangeBarTier.Good)]
    [InlineData(79, ProjectedRangeBarTier.Warning)]
    [InlineData(60, ProjectedRangeBarTier.Warning)]
    [InlineData(59, ProjectedRangeBarTier.Poor)]
    public void BarTier_matches_web(int rangePct, ProjectedRangeBarTier expected)
    {
        Assert.Equal(expected, ProjectedRangeProjection.BarTier(rangePct));
    }

    [Fact]
    public void BarTier_null_is_poor()
    {
        Assert.Equal(ProjectedRangeBarTier.Poor, ProjectedRangeProjection.BarTier(null));
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_builds_full_display()
    {
        var display = ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(2, 2), UnitPref.Metric, Localizer);

        Assert.False(display.IsCompact);
        Assert.False(display.IsWide);
        Assert.Equal(400, display.ProjectedRangeValue);
        Assert.Equal("km", display.DistanceUnitLabel);
        Assert.NotNull(display.Badge);
        Assert.Equal("Excellent", display.Badge!.Text);
        Assert.Equal("Excellent \u00B7 95%", display.BadgeDetailText);
        Assert.Equal(89, display.RangePct);
        Assert.Equal(ProjectedRangeBarTier.Good, display.BarTier);
        Assert.Equal("450 km", display.EpaText);
        Assert.Equal("89% of EPA rated", display.RangePctText);
        Assert.Equal("Projected", display.ProjectedLabel);
        Assert.Equal("EPA", display.EpaLabel);
        Assert.Equal("Range Factors", display.FactorsLabel);
    }

    [Fact]
    public void Project_metric_builds_the_four_factor_rows()
    {
        var display = ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(3, 4), UnitPref.Metric, Localizer);

        Assert.Equal(4, display.Factors.Count);
        Assert.Equal("Battery Degradation", display.Factors[0].Label);
        Assert.Equal("8.5%", display.Factors[0].Value);
        Assert.Equal("Avg Daily Usage", display.Factors[1].Label);
        Assert.Equal("50 km", display.Factors[1].Value);
        Assert.Equal("Current Capacity", display.Factors[2].Label);
        Assert.Equal("92.3%", display.Factors[2].Value);
        Assert.Equal("Battery Cycles", display.Factors[3].Label);
        Assert.Equal("420", display.Factors[3].Value);
    }

    [Fact]
    public void Project_wide_and_compact_flags_track_footprint()
    {
        Assert.True(ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(1, 2), UnitPref.Metric, Localizer).IsCompact);
        Assert.True(ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(3, 40), UnitPref.Metric, Localizer).IsWide);
    }

    [Fact]
    public void Project_imperial_reprojects_distances()
    {
        var display = ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(3, 4), UnitPref.Imperial, Localizer);

        Assert.Equal(249, display.ProjectedRangeValue); // round(248.5485)
        Assert.Equal("mi", display.DistanceUnitLabel);
        Assert.Equal("280 mi", display.EpaText);        // round(279.617)
        Assert.Equal("31 mi", display.Factors[1].Value); // round(31.0686)
        Assert.Equal(89, display.RangePct);              // unit-independent ratio
    }

    [Fact]
    public void Project_missing_range_renders_em_dash_value_and_no_percentage()
    {
        var reading = new ProjectedRangeReading(null, null, null, null, null, null, null);

        var display = ProjectedRangeProjection.Project(reading, new ProjectedRangeSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Null(display.ProjectedRangeValue);
        Assert.Null(display.RangePct);
        Assert.Equal(string.Empty, display.RangePctText);
        Assert.Equal(ProjectedRangeProjection.EmDash, display.EpaText);
        Assert.Null(display.Badge);
        // Factors still render with the web `?? 0` fallbacks.
        Assert.Equal("0.0%", display.Factors[0].Value);
        Assert.Equal("0 km", display.Factors[1].Value);
        Assert.Equal("0", display.Factors[3].Value);
    }

    [Fact]
    public void Project_automation_name_summarises_surface()
    {
        var display = ProjectedRangeProjection.Project(LoadedReading(), new ProjectedRangeSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Equal("Projected 400 km, Excellent 95%, 89% of EPA rated", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        var cached = ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(400, cached.Value!.CurrentRangeKm);

        var offline = ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(95, offline.Value!.HealthScore);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(LoadedJson);

        Assert.Equal(LoadStatus.Loaded, ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_body_to_empty()
    {
        // Web parity: a successful response with no projection object (data falsy) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = ProjectedRangeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ProjectedRangeReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(LoadedReading()));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal(400, vm.Display!.ProjectedRangeValue);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ProjectedRangeReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No projected range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ProjectedRangeReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ProjectedRangeReading>.Cached(LoadedReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ProjectedRangeReading>.OfflineCached(
            LoadedReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ProjectedRangeReading>.Loading(),
            RepositoryResult<ProjectedRangeReading>.Cached(LoadedReading(), Now, stale: false),
            RepositoryResult<ProjectedRangeReading>.Loaded(LoadedReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(ProjectedRangeState.Loaded, vm.State);
        Assert.Equal(400, vm.Display!.ProjectedRangeValue);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(LoadedReading()));
        await vm.LoadAsync();
        Assert.Equal(400, vm.Display!.ProjectedRangeValue);
        Assert.Equal("km", vm.Display.DistanceUnitLabel);

        vm.Units = UnitPref.Imperial;
        Assert.Equal(249, vm.Display!.ProjectedRangeValue);
        Assert.Equal("mi", vm.Display.DistanceUnitLabel);
        Assert.Equal(ProjectedRangeState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_updates_layout_flags_and_reprojects()
    {
        using var vm = NewViewModel(Loaded(LoadedReading()));
        await vm.LoadAsync();
        Assert.False(vm.IsWide);
        Assert.False(vm.Display!.IsWide);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new ProjectedRangeSize(3, 40);

        Assert.True(vm.IsWide);
        Assert.True(vm.Display!.IsWide);
        Assert.Contains(nameof(ProjectedRangeViewModel.IsWide), changed);
        Assert.Contains(nameof(ProjectedRangeViewModel.Size), changed);
    }

    [Fact]
    public void ViewModel_compact_flag_tracks_footprint()
    {
        using var vm = NewViewModel(RepositoryResult<ProjectedRangeReading>.Empty(Now));

        Assert.False(vm.IsCompact); // default 2×2

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new ProjectedRangeSize(1, 2);

        Assert.True(vm.IsCompact);
        Assert.Contains(nameof(ProjectedRangeViewModel.IsCompact), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ProjectedRangeReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Projected Range", vm.Title);
        Assert.Equal("No projected range data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(LoadedReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ProjectedRangeViewModel.State), changed);
        Assert.Contains(nameof(ProjectedRangeViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("projected-range", ProjectedRangeRegistration.Id);
        Assert.Equal("battery", ProjectedRangeRegistration.Category);
        Assert.Equal("ProjectedRangeWidget", ProjectedRangeRegistration.Slug);
        Assert.Equal(new ProjectedRangeSize(2, 2), ProjectedRangeRegistration.DefaultSize);
        Assert.Equal(new ProjectedRangeSize(1, 2), ProjectedRangeRegistration.MinSize);
        Assert.Equal(new ProjectedRangeSize(3, 40), ProjectedRangeRegistration.MaxSize);
        Assert.Equal("Projected Range", ProjectedRangeRegistration.Name(Localizer));
        Assert.Equal("Helix-predicted range based on driving habits, weather, elevation", ProjectedRangeRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 2, true)]    // default
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ProjectedRangeRegistration.IsWithinBounds(new ProjectedRangeSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ProjectedRangeSize(1, 2), ProjectedRangeRegistration.Clamp(new ProjectedRangeSize(0, 0)));
        Assert.Equal(new ProjectedRangeSize(3, 40), ProjectedRangeRegistration.Clamp(new ProjectedRangeSize(9, 99)));
    }

    [Fact]
    public void Size_compact_and_wide_breakpoints()
    {
        Assert.True(new ProjectedRangeSize(1, 2).IsCompact);
        Assert.False(new ProjectedRangeSize(2, 2).IsCompact);
        Assert.False(new ProjectedRangeSize(2, 2).IsWide);
        Assert.True(new ProjectedRangeSize(3, 40).IsWide);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ProjectedRangeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ProjectedRangeWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ProjectedRangeSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_projection()
    {
        using var snapshot = JsonDocument.Parse(LoadedJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new ProjectedRangeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(400, terminal.Value!.CurrentRangeKm);
        Assert.Equal(95, terminal.Value.HealthScore);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_battery_projected_range", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.True(request.Query is null || request.Query.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var snapshot = JsonDocument.Parse(LoadedJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new ProjectedRangeSource(
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
        var source = new ProjectedRangeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ProjectedRangeReading LoadedReading() => new(
        CurrentRangeKm: 400,
        NewRangeKm: 450,
        AvgDailyKm: 50,
        HealthScore: 95,
        DegradationPct: 8.5,
        CurrentCapacityPct: 92.3,
        TotalCycles: 420);

    private static async Task<List<RepositoryResult<ProjectedRangeReading>>> Drain(IProjectedRangeSource source)
    {
        var list = new List<RepositoryResult<ProjectedRangeReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ProjectedRangeReading> Loaded(ProjectedRangeReading reading) =>
        RepositoryResult<ProjectedRangeReading>.Loaded(reading, Now);

    private static ProjectedRangeViewModel NewViewModel(params RepositoryResult<ProjectedRangeReading>[] emissions) =>
        new(new FakeProjectedRangeSource(emissions), Localizer, ProjectedRangeSize.Default);

    private sealed class FakeProjectedRangeSource(params RepositoryResult<ProjectedRangeReading>[] emissions) : IProjectedRangeSource
    {
        public async IAsyncEnumerable<RepositoryResult<ProjectedRangeReading>> StreamAsync(
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
