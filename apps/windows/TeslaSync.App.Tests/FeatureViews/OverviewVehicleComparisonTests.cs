using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.OverviewVehicleComparison;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the OverviewVehicleComparison surface's UI-thread-free logic — the
/// <c>vehicle_comparison</c> JSON parse adapter, the four-panel SI→display projection (Fleet Usage pie,
/// Efficiency Leaderboard, Vehicle Comparison radar, Energy &amp; Activity bars) with distance/efficiency
/// unit conversion, the cache-then-network result mapper, the registry metadata, the PII-safe diagnostics,
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline). Mirrors the web spec
/// (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx).
/// </summary>
public sealed class OverviewVehicleComparisonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static VehicleComparisonVehicle V(long id, string name, double distKm, double energyKwh, double effWhKm, double drives) =>
        new(id, name, distKm, energyKwh, effWhKm, drives);

    private static OverviewVehicleComparisonData Data(params VehicleComparisonVehicle[] vehicles) =>
        new(vehicles);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_vehicle_comparison_rows()
    {
        const string json = """
        {"period_days":30,"vehicle_comparison":[
          {"id":1,"name":"Model 3","distance":100,"energy":20,"efficiency":150,"drives":5},
          {"id":2,"name":"Model Y","distance":50,"energy":12,"efficiency":175,"drives":3}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);

        Assert.True(data.HasData);
        Assert.Equal(2, data.Vehicles.Count);
        var first = data.Vehicles[0];
        Assert.Equal(1, first.Id);
        Assert.Equal("Model 3", first.Name);
        Assert.Equal(100, first.DistanceKm);
        Assert.Equal(20, first.EnergyKwh);
        Assert.Equal(150, first.EfficiencyWhKm);
        Assert.Equal(5, first.Drives);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);
        Assert.False(data.HasData);
        Assert.Empty(data.Vehicles);
    }

    [Fact]
    public void FromJson_returns_empty_when_field_missing()
    {
        using var doc = JsonDocument.Parse("""{"total_vehicles":3}""");
        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);
        Assert.False(data.HasData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_numeric_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_comparison":[{"id":7,"name":"X"}]}""");
        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);

        var v = Assert.Single(data.Vehicles);
        Assert.Equal(7, v.Id);
        Assert.Equal("X", v.Name);
        Assert.Equal(0, v.DistanceKm);
        Assert.Equal(0, v.EnergyKwh);
        Assert.Equal(0, v.EfficiencyWhKm);
        Assert.Equal(0, v.Drives);
    }

    [Fact]
    public void FromJson_skips_non_object_elements()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_comparison":[1,"a",{"id":2,"name":"Y","distance":10}]}""");
        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);
        var v = Assert.Single(data.Vehicles);
        Assert.Equal(2, v.Id);
    }

    [Fact]
    public void FromJson_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_comparison":[{"id":"4","name":"S","distance":"42.5","drives":"9"}]}""");
        var data = OverviewVehicleComparisonData.FromJson(doc.RootElement);
        var v = Assert.Single(data.Vehicles);
        Assert.Equal(4, v.Id);
        Assert.Equal(42.5, v.DistanceKm);
        Assert.Equal(9, v.Drives);
    }

    // ---- Projection: gates ---------------------------------------------------------

    [Fact]
    public void Project_empty_has_no_panels_but_localized_chrome()
    {
        var display = OverviewVehicleComparisonProjection.Project(OverviewVehicleComparisonData.Empty, UnitPref.Metric, Localizer);

        Assert.False(display.HasVehicles);
        Assert.False(display.HasComparison);
        Assert.Empty(display.FleetUsage);
        Assert.Empty(display.Leaderboard);
        Assert.Empty(display.ComparisonSeries);
        Assert.Empty(display.EnergyActivitySeries);
        Assert.Empty(display.VehicleNames);
        // Web parity: every panel still resolves its title + empty message through i18n.
        Assert.Equal("Fleet Usage", display.FleetUsageTitle);
        Assert.Equal("Efficiency Leaderboard", display.EfficiencyLeaderboardTitle);
        Assert.Equal("Vehicle Comparison", display.VehicleComparisonTitle);
        Assert.Equal("Energy & Activity", display.EnergyActivityTitle);
        Assert.Equal("No vehicle data", display.NoVehiclesMessage);
        Assert.Equal("No efficiency data", display.NoEfficiencyMessage);
        Assert.Equal("Need 2+ vehicles for comparison", display.NoComparisonMessage);
    }

    [Fact]
    public void Project_single_vehicle_hides_radar_keeps_other_panels()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "Solo", 80, 16, 160, 4)), UnitPref.Metric, Localizer);

        Assert.True(display.HasVehicles);
        Assert.False(display.HasComparison); // radar needs 2+
        Assert.Single(display.FleetUsage);
        Assert.Single(display.Leaderboard);
        Assert.Empty(display.ComparisonSeries);
        Assert.Equal(2, display.EnergyActivitySeries.Count);
    }

    // ---- Projection: Fleet Usage (distance conversion) -----------------------------

    [Fact]
    public void Project_metric_fleet_usage_converts_distance()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 100, 20, 150, 5), V(2, "B", 50, 10, 200, 3)), UnitPref.Metric, Localizer);

        Assert.Equal("km", display.DistanceUnitLabel);
        Assert.Equal(2, display.FleetUsage.Count);
        // Web parity: convertDistanceFromSI(distanceKm * 1000, Km) == distanceKm.
        Assert.Equal(100, display.FleetUsage[0].Y, 6);
        Assert.Equal("A", display.FleetUsage[0].Label);
        Assert.Equal(50, display.FleetUsage[1].Y, 6);
    }

    [Fact]
    public void Project_imperial_fleet_usage_and_efficiency_unit()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 100, 20, 150, 5), V(2, "B", 50, 10, 200, 3)), UnitPref.Imperial, Localizer);

        Assert.Equal("mi", display.DistanceUnitLabel);
        Assert.Equal("Wh/mi", display.EfficiencyUnitLabel);
        // 100 km -> 62.137 mi.
        Assert.Equal(62.137, display.FleetUsage[0].Y, 3);
    }

    // ---- Projection: Efficiency Leaderboard ----------------------------------------

    [Fact]
    public void Project_leaderboard_sorted_ascending_with_bar_fraction()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "Worst", 10, 5, 200, 1), V(2, "Best", 20, 4, 150, 2)), UnitPref.Metric, Localizer);

        Assert.Equal(2, display.Leaderboard.Count);
        // Sorted ascending by efficiency: Best (150) ranks #1, Worst (200) ranks #2.
        Assert.Equal("#1 Best", display.Leaderboard[0].Label);
        Assert.Equal("150.0 Wh/km", display.Leaderboard[0].FormattedValue);
        Assert.Equal(0.75, display.Leaderboard[0].BarFraction, 6); // 150 / 200
        Assert.Equal("#2 Worst", display.Leaderboard[1].Label);
        Assert.Equal("200.0 Wh/km", display.Leaderboard[1].FormattedValue);
        Assert.Equal(1.0, display.Leaderboard[1].BarFraction, 6); // 200 / 200 (the max)
    }

    [Fact]
    public void Project_leaderboard_imperial_value()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 10, 5, 150, 1)), UnitPref.Imperial, Localizer);

        // 150 Wh/km * 1.609344 = 241.4016 -> "241.4 Wh/mi".
        Assert.Equal("241.4 Wh/mi", display.Leaderboard[0].FormattedValue);
    }

    [Fact]
    public void Project_leaderboard_has_accessibility_names()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 10, 5, 150, 1), V(2, "B", 20, 4, 175, 2)), UnitPref.Metric, Localizer);

        foreach (var entry in display.Leaderboard)
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.AutomationName));
            Assert.Contains(entry.Label, entry.AutomationName, StringComparison.Ordinal);
            Assert.Contains(entry.FormattedValue, entry.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Projection: Vehicle Comparison radar --------------------------------------

    [Fact]
    public void Project_radar_requires_two_vehicles()
    {
        Assert.Empty(OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 10, 5, 150, 1)), UnitPref.Metric, Localizer).ComparisonSeries);

        Assert.Equal(2, OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 10, 5, 150, 1), V(2, "B", 20, 4, 175, 2)), UnitPref.Metric, Localizer).ComparisonSeries.Count);
    }

    [Fact]
    public void Project_radar_normalizes_and_inverts_efficiency()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 100, 20, 150, 5), V(2, "B", 50, 10, 200, 3)), UnitPref.Metric, Localizer);

        Assert.Equal(100, display.ComparisonMax);
        var a = display.ComparisonSeries[0];
        Assert.Equal("A", a.Name);
        Assert.Equal(4, a.Points.Count);
        // Distance / Energy / Drives axes: best-in-fleet maps to 100.
        Assert.Equal(100, a.Points[0].Y, 6); // 100 / max(100)
        Assert.Equal(100, a.Points[1].Y, 6); // 20 / max(20)
        Assert.Equal(100, a.Points[2].Y, 6); // 5 / max(5)
        // Efficiency inverted: A (150) is better than B (200) -> (200-150)/200 = 25.
        Assert.Equal(25, a.Points[3].Y, 6);
        Assert.Equal("Distance", a.Points[0].Label);
        Assert.Equal("Efficiency", a.Points[3].Label);

        var b = display.ComparisonSeries[1];
        Assert.Equal(60, b.Points[2].Y, 6); // drives 3 / max 5 -> 60
        Assert.Equal(0, b.Points[3].Y, 6);  // worst efficiency -> 0
    }

    // ---- Projection: Energy & Activity bars ----------------------------------------

    [Fact]
    public void Project_energy_activity_two_series_raw_values()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "A", 100, 20, 150, 5), V(2, "B", 50, 10, 200, 3)), UnitPref.Metric, Localizer);

        Assert.Equal(2, display.EnergyActivitySeries.Count);
        var energy = display.EnergyActivitySeries[0];
        var drives = display.EnergyActivitySeries[1];
        Assert.Equal("Energy (kWh)", energy.Name);
        Assert.Equal(ChartSeriesKind.Bar, energy.Kind);
        Assert.Equal(20, energy.Points[0].Y, 6);
        Assert.Equal(10, energy.Points[1].Y, 6);
        Assert.Equal("Drives", drives.Name);
        Assert.Equal(5, drives.Points[0].Y, 6);
        Assert.Equal(3, drives.Points[1].Y, 6);
        Assert.Equal(new[] { "A", "B" }, display.VehicleNames);
    }

    [Fact]
    public void Project_uses_fallback_name_for_blank_vehicle()
    {
        var display = OverviewVehicleComparisonProjection.Project(
            Data(V(1, "", 10, 5, 150, 1), V(2, "  ", 20, 4, 175, 2)), UnitPref.Metric, Localizer);

        Assert.Equal("Vehicle 1", display.VehicleNames[0]);
        Assert.Equal("Vehicle 2", display.VehicleNames[1]);
        // Fallback names are unique so the radar series identities never collide.
        Assert.Equal("Vehicle 1", display.ComparisonSeries[0].Name);
        Assert.Equal("Vehicle 2", display.ComparisonSeries[1].Name);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_comparison":[{"id":1,"name":"A","distance":12}]}""");

        var cached = OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(12, cached.Value!.Vehicles[0].DistanceKm);

        var offline = OverviewVehicleComparisonResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Vehicles);
    }

    [Fact]
    public void Mapper_maps_loading_loaded_empty_failure_refreshing()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_comparison":[{"id":1,"name":"A"}]}""");

        Assert.Equal(LoadStatus.Loading, OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Loaded, OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Refreshing, OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Refreshing(doc.RootElement, Now, stale: false)).Status);

        Assert.Equal(LoadStatus.Empty, OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, OverviewVehicleComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<OverviewVehicleComparisonData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_panels()
    {
        using var vm = NewViewModel(Loaded(Data(V(1, "A", 100, 20, 150, 5), V(2, "B", 50, 10, 200, 3))));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasComparison);
        Assert.Equal(2, vm.Display.Leaderboard.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_vehicles_still_renders_content()
    {
        // Web parity: an analytics object with an empty vehicle_comparison renders the four panels (each
        // showing its own empty state) — it is NOT the surface-level empty terminal.
        using var vm = NewViewModel(Loaded(OverviewVehicleComparisonData.Empty));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Loaded, vm.State);
        Assert.False(vm.HasData);
        Assert.False(vm.Display.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<OverviewVehicleComparisonData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<OverviewVehicleComparisonData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<OverviewVehicleComparisonData>.Cached(Data(V(1, "A", 10, 5, 150, 1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<OverviewVehicleComparisonData>.OfflineCached(
            Data(V(1, "A", 10, 5, 150, 1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<OverviewVehicleComparisonData>.Loading(),
            RepositoryResult<OverviewVehicleComparisonData>.Cached(Data(V(1, "A", 10, 5, 150, 1)), Now, stale: false),
            RepositoryResult<OverviewVehicleComparisonData>.Loaded(Data(V(1, "A", 10, 5, 150, 1), V(2, "B", 20, 4, 175, 2)), Now));
        await vm.LoadAsync();

        Assert.Equal(OverviewVehicleComparisonState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Leaderboard.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Data(V(1, "A", 100, 20, 150, 5))));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.DistanceUnitLabel);
        Assert.Equal("150.0 Wh/km", vm.Display.Leaderboard[0].FormattedValue);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.DistanceUnitLabel);
        Assert.Equal("241.4 Wh/mi", vm.Display.Leaderboard[0].FormattedValue);
        Assert.Equal(OverviewVehicleComparisonState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(V(1, "A", 10, 5, 150, 1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(OverviewVehicleComparisonViewModel.State), changed);
        Assert.Contains(nameof(OverviewVehicleComparisonViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel();
        Assert.Equal("Vehicle Comparison", vm.Title);
    }

    // ---- Registration metadata + diagnostics + constants ----------------------------

    [Fact]
    public void Registration_metadata_matches_contract()
    {
        Assert.Equal("overview-vehicle-comparison", OverviewVehicleComparisonRegistration.Id);
        Assert.Equal("analytics", OverviewVehicleComparisonRegistration.Category);
        Assert.Equal("OverviewVehicleComparison", OverviewVehicleComparisonRegistration.Slug);
        Assert.Equal(30, OverviewVehicleComparisonRegistration.DefaultDays);
        Assert.Equal("Vehicle Comparison", OverviewVehicleComparisonRegistration.Name(Localizer));
        Assert.Contains("efficiency", OverviewVehicleComparisonRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OverviewVehicleComparisonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=OverviewVehicleComparison", Assert.Single(lines));
    }

    [Fact]
    public void Projection_km_per_mile_matches_web_constant() =>
        Assert.Equal(1.609344, OverviewVehicleComparisonProjection.KmPerMile);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<OverviewVehicleComparisonData> Loaded(OverviewVehicleComparisonData data) =>
        RepositoryResult<OverviewVehicleComparisonData>.Loaded(data, Now);

    private static OverviewVehicleComparisonViewModel NewViewModel(params RepositoryResult<OverviewVehicleComparisonData>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeSource(params RepositoryResult<OverviewVehicleComparisonData>[] emissions) : IOverviewVehicleComparisonSource
    {
        public async IAsyncEnumerable<RepositoryResult<OverviewVehicleComparisonData>> StreamAsync(
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
