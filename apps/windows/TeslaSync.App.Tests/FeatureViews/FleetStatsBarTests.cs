using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the FleetStatsBar's UI-thread-free logic — the aggregate parse adapter (fleet
/// analytics + vehicle roster + recent drives/charges + unread count), the five-panel projection (labels,
/// values, unit conversion, sparkline series, the i18n keys and the accessibility labels), the registration
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/components/FleetStatsBar.tsx).
/// </summary>
public sealed class FleetStatsBarTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (FromParts) -------------------------------------------------

    [Fact]
    public void FromParts_reads_every_endpoint_body()
    {
        var data = FleetStatsBarData.FromParts(
            Json("""{ "total_distance_km": 1234.5, "total_energy_kwh": 56.7, "avg_efficiency_wh_km": 180, "total_vehicles": 3 }"""),
            Json("""[ { "id": 1, "state": "online" }, { "id": 2, "state": "asleep" }, { "id": 3, "state": "online" } ]"""),
            Json("""[ { "distance_m": 5000 }, { "distance_m": 4000 }, { "distance_m": 3000 } ]"""),
            Json("""[ { "total_energy_added_wh": 20000 }, { "total_energy_added_wh": 10000 } ]"""),
            Json("""{ "count": 7 }"""));

        Assert.Equal(3, data.VehicleCount);
        Assert.Equal(2, data.OnlineCount);
        Assert.Equal(7, data.UnreadAlerts);
        Assert.Equal(1234.5, data.TotalDistanceKm);
        Assert.Equal(56.7, data.TotalEnergyKwh);
        Assert.Equal(180, data.AvgEfficiencyWhKm);

        // web .reverse(): rows arrive newest-first, the sparkline reads oldest -> newest.
        Assert.Equal(new double[] { 3000, 4000, 5000 }, data.RecentDriveDistancesM);
        Assert.Equal(new double[] { 10000, 20000 }, data.RecentChargeEnergiesWh);
        Assert.True(data.HasData);
    }

    [Fact]
    public void FromParts_keeps_only_the_newest_recentLimit_rows()
    {
        // 7 newest-first drive distances; with a limit of 5 the newest five (10..50) survive, reversed.
        var data = FleetStatsBarData.FromParts(
            Json("{}"),
            Json("[]"),
            Json("""[ {"distance_m":70},{"distance_m":60},{"distance_m":50},{"distance_m":40},{"distance_m":30},{"distance_m":20},{"distance_m":10} ]"""),
            Json("[]"),
            Json("{}"),
            recentLimit: 5);

        Assert.Equal(new double[] { 30, 40, 50, 60, 70 }, data.RecentDriveDistancesM);
    }

    [Fact]
    public void FromParts_is_tolerant_of_missing_and_non_object_bodies()
    {
        var data = FleetStatsBarData.FromParts(
            Json("null"),       // analytics absent
            Json("{}"),          // vehicles not an array
            default,             // drives Undefined (the skipped-query case)
            Json("[]"),          // charges empty
            Json("""{ "count": "5" }"""));  // numeric-string count

        Assert.Equal(0, data.VehicleCount);
        Assert.Equal(0, data.OnlineCount);
        Assert.Equal(5, data.UnreadAlerts);
        Assert.Equal(0, data.TotalDistanceKm);
        Assert.Equal(0, data.TotalEnergyKwh);
        Assert.Equal(0, data.AvgEfficiencyWhKm);
        Assert.Empty(data.RecentDriveDistancesM);
        Assert.Empty(data.RecentChargeEnergiesWh);
        Assert.True(data.HasData); // a single unread alert is still data
    }

    [Fact]
    public void FromParts_online_match_is_case_insensitive_and_negative_count_clamps()
    {
        var data = FleetStatsBarData.FromParts(
            Json("{}"),
            Json("""[ { "id": 1, "state": "ONLINE" }, { "id": 2, "state": "online" }, { "id": 3 } ]"""),
            Json("[]"),
            Json("[]"),
            Json("""{ "count": -4 }"""));

        Assert.Equal(3, data.VehicleCount);
        Assert.Equal(2, data.OnlineCount);
        Assert.Equal(0, data.UnreadAlerts);
    }

    [Fact]
    public void FromParts_all_zero_snapshot_has_no_data()
    {
        var data = FleetStatsBarData.FromParts(
            Json("""{ "total_distance_km": 0, "total_energy_kwh": 0, "avg_efficiency_wh_km": 0 }"""),
            Json("[]"),
            Json("[]"),
            Json("[]"),
            Json("""{ "count": 0 }"""));

        Assert.False(data.HasData);
    }

    // ---- Projection: the five panels in order --------------------------------------

    [Fact]
    public void Project_builds_five_panels_in_web_order()
    {
        var view = ProjectMetric(Sample());

        Assert.Equal(5, view.Panels.Count);
        Assert.Equal(
            new[] { "fleet-size", "fleet-distance", "fleet-energy", "fleet-efficiency", "fleet-alerts" },
            view.Panels.Select(p => p.Key));
        Assert.True(view.HasData);
    }

    [Fact]
    public void Project_fleet_size_panel_carries_online_caption()
    {
        var size = ProjectMetric(Sample()).Panels[0];

        Assert.Equal("Fleet Size", size.Label);
        Assert.Equal(3, size.Value);
        Assert.Equal(0, size.Precision);
        Assert.Null(size.Suffix);
        Assert.Equal("2 online", size.SubLabel);
        Assert.Null(size.Chart);
        Assert.Equal("3", size.FormattedValue);
    }

    [Fact]
    public void Project_distance_panel_uses_metric_units_and_a_speed_sparkline()
    {
        var distance = ProjectMetric(Sample()).Panels[1];

        // km is SI-display identity: total_distance_km surfaces unchanged (NOT the web's /1000 unit bug).
        Assert.Equal(1234.5, distance.Value);
        Assert.Equal(0, distance.Precision);
        Assert.Equal(" km", distance.Suffix);
        Assert.Null(distance.SubLabel);
        Assert.NotNull(distance.Chart);
        Assert.Equal(ChartRole.Speed, distance.Chart!.Role);
        Assert.Equal(ChartSeriesKind.Area, distance.Chart.Kind);
        Assert.Equal(3, distance.Chart.Points.Count);
        Assert.Equal(new double[] { 3000, 4000, 5000 }, distance.Chart.Points.Select(p => p.Y));
    }

    [Fact]
    public void Project_distance_converts_to_miles_when_imperial()
    {
        var distance = Project(Sample(), UnitPref.Imperial).Panels[1];

        Assert.Equal(1234.5 / FleetStatsBarProjection.KmPerMile, distance.Value, 3);
        Assert.Equal(" mi", distance.Suffix);
    }

    [Fact]
    public void Project_energy_panel_is_kwh_with_one_decimal_and_an_energy_sparkline()
    {
        var energy = ProjectMetric(Sample()).Panels[2];

        Assert.Equal(56.7, energy.Value);
        Assert.Equal(1, energy.Precision);
        Assert.Equal(" kWh", energy.Suffix);
        Assert.NotNull(energy.Chart);
        Assert.Equal(ChartRole.Energy, energy.Chart!.Role);
        Assert.Equal(new double[] { 10000, 20000 }, energy.Chart.Points.Select(p => p.Y));
    }

    [Fact]
    public void Project_efficiency_panel_uses_distance_scoped_unit()
    {
        var metric = ProjectMetric(Sample()).Panels[3];
        Assert.Equal(180, metric.Value);
        Assert.Equal(" Wh/km", metric.Suffix);
        Assert.Equal("fleet average", metric.SubLabel);
        Assert.Null(metric.Chart);

        var imperial = Project(Sample(), UnitPref.Imperial).Panels[3];
        Assert.Equal(180 * FleetStatsBarProjection.KmPerMile, imperial.Value, 3);
        Assert.Equal(" Wh/mi", imperial.Suffix);
    }

    [Fact]
    public void Project_alerts_panel_shows_unread_count()
    {
        var alerts = ProjectMetric(Sample()).Panels[4];

        Assert.Equal("Alerts", alerts.Label);
        Assert.Equal(7, alerts.Value);
        Assert.Equal("unread", alerts.SubLabel);
        Assert.Null(alerts.Chart);
    }

    [Fact]
    public void Project_empty_series_falls_back_to_a_single_flat_point()
    {
        var data = new FleetStatsBarData(0, 0, 0, 0, 0, 0, Array.Empty<double>(), Array.Empty<double>());

        var view = ProjectMetric(data);

        // web MiniChart `data={arr ?? [0]}` — the panel still renders a chart (never a blank box).
        Assert.NotNull(view.Panels[1].Chart);
        Assert.Single(view.Panels[1].Chart!.Points);
        Assert.Equal(0, view.Panels[1].Chart!.Points[0].Y);
        Assert.False(view.HasData);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = FleetStatsBarProjection.Project(Sample(), UnitPref.Metric, echo);

        Assert.Equal("L:fleet.size", view.Panels[0].Label);
        Assert.Equal("2 L:fleet.online", view.Panels[0].SubLabel);
        Assert.Equal("L:fleet.distance", view.Panels[1].Label);
        Assert.Equal("L:fleet.energy", view.Panels[2].Label);
        Assert.Equal("L:fleet.efficiency", view.Panels[3].Label);
        Assert.Equal("L:fleet.average", view.Panels[3].SubLabel);
        Assert.Equal("L:fleet.alerts", view.Panels[4].Label);
        Assert.Equal("L:fleet.unread", view.Panels[4].SubLabel);
        Assert.Equal("L:fleet.stats.aria", view.AutomationName);
    }

    // ---- a11y: every panel + the surface carry a spoken name -----------------------

    [Fact]
    public void Every_panel_carries_a_non_empty_automation_name()
    {
        var view = ProjectMetric(Sample());

        Assert.All(view.Panels, p => Assert.False(string.IsNullOrWhiteSpace(p.AutomationName)));
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));

        // The composed name folds the value, unit and caption together for the screen reader.
        Assert.Equal("Fleet Size: 3. 2 online", view.Panels[0].AutomationName);
        Assert.Equal($"Distance (30d): {view.Panels[1].FormattedValue} km", view.Panels[1].AutomationName);
        Assert.Equal($"Energy (30d): {view.Panels[2].FormattedValue} kWh", view.Panels[2].AutomationName);
        Assert.Equal("Alerts: 7. unread", view.Panels[4].AutomationName);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsBarData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
        // Even before any data the five panels exist (zeroed) so the grid is never blank.
        Assert.Equal(5, vm.Display.Panels.Count);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_populated_panels()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.Equal(3, vm.Display.Panels[0].Value);
    }

    [Fact]
    public async Task ViewModel_loaded_all_zero_renders_empty_with_panels()
    {
        using var vm = NewViewModel(Loaded(FleetStatsBarData.Empty));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(5, vm.Display.Panels.Count);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsBarData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetStatsBarData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsBarData>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsBarData>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
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
            RepositoryResult<FleetStatsBarData>.Loading(),
            RepositoryResult<FleetStatsBarData>.Cached(Sample(), Now, stale: false),
            RepositoryResult<FleetStatsBarData>.Loaded(Sample(8), Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsBarState.Loaded, vm.State);
        Assert.Equal(8, vm.Display.Panels[4].Value); // the freshest snapshot's unread count wins
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal(1234.5, vm.Display.Panels[1].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal(1234.5 / FleetStatsBarProjection.KmPerMile, vm.Display.Panels[1].Value, 3);
        Assert.Equal(" mi", vm.Display.Panels[1].Suffix);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsBarData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Fleet statistics", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(FleetStatsBarViewModel.State), changed);
        Assert.Contains(nameof(FleetStatsBarViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("fleet-stats-bar", FleetStatsBarRegistration.Id);
        Assert.Equal("dashboard", FleetStatsBarRegistration.Category);
        Assert.Equal("FleetStatsBar", FleetStatsBarRegistration.Slug);
        Assert.Equal(30, FleetStatsBarRegistration.AnalyticsDays);
        Assert.Equal(5, FleetStatsBarRegistration.RecentLimit);
        Assert.Equal("Fleet statistics", FleetStatsBarRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FleetStatsBarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetStatsBar", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static FleetStatsBarData Sample(int unread = 7) =>
        new(
            VehicleCount: 3,
            OnlineCount: 2,
            UnreadAlerts: unread,
            TotalDistanceKm: 1234.5,
            TotalEnergyKwh: 56.7,
            AvgEfficiencyWhKm: 180,
            RecentDriveDistancesM: new double[] { 3000, 4000, 5000 },
            RecentChargeEnergiesWh: new double[] { 10000, 20000 });

    private static FleetStatsBarDisplay ProjectMetric(FleetStatsBarData data) =>
        FleetStatsBarProjection.Project(data, UnitPref.Metric, Localizer);

    private static FleetStatsBarDisplay Project(FleetStatsBarData data, UnitPref units) =>
        FleetStatsBarProjection.Project(data, units, Localizer);

    private static RepositoryResult<FleetStatsBarData> Loaded(FleetStatsBarData data) =>
        RepositoryResult<FleetStatsBarData>.Loaded(data, Now);

    private static FleetStatsBarViewModel NewViewModel(params RepositoryResult<FleetStatsBarData>[] emissions) =>
        new(new FakeFleetStatsBarSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeFleetStatsBarSource(params RepositoryResult<FleetStatsBarData>[] emissions) : IFleetStatsBarSource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetStatsBarData>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
