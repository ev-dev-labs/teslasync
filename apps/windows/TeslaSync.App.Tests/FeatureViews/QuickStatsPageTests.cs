using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Dashboard;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>QuickStatsPage</c> surface's Microsoft.UI-free logic — the tolerant
/// parsers (vehicles roster, live-state, fleet analytics), the SI→display projection (distance/drives/energy/
/// cost with units + currency), the four-state view-model matrix (loading / loaded / empty / error) and the
/// generated-client source's request shaping (web <c>useVehicles</c> + <c>useVehicleState</c> +
/// <c>useAnalyticsSummary(30)</c>). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the <see cref="QuickStatsDisplay"/> flags asserted here. Mirrors the web spec
/// (web/src/features/dashboard/pages/QuickStatsPage.tsx).
/// </summary>
public sealed class QuickStatsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The nine i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "quickStats.cost", "quickStats.defaultName", "quickStats.distance", "quickStats.drives",
        "quickStats.energy", "quickStats.footer", "quickStats.noVehicle", "quickStats.openDashboard",
        "quickStats.title",
    ];

    private static QuickStatsSnapshot Snapshot(
        QuickStatsVehicle? vehicle = null,
        QuickStatsLiveState? state = null,
        QuickStatsAnalytics? analytics = null) =>
        new(vehicle, state, analytics ?? QuickStatsAnalytics.Empty);

    private static QuickStatsAnalytics Analytics(
        double distanceKm = 1000,
        long drives = 42,
        double energyKwh = 234,
        double cost = 78) =>
        new(distanceKm, drives, energyKwh, cost);

    // ---- Vehicle parser ------------------------------------------------------------

    [Fact]
    public void Vehicle_picks_the_first_entry_with_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":7,"display_name":"Garage Y","model":"modely","vin":"5YJ"},
         {"id":9,"display_name":"Second"}]
        """);

        var vehicle = QuickStatsVehicle.FromVehiclesArray(doc.RootElement);

        Assert.NotNull(vehicle);
        Assert.Equal(7, vehicle!.Id);
        Assert.Equal("Garage Y", vehicle.DisplayName);
        Assert.Equal("modely", vehicle.Model);
    }

    [Fact]
    public void Vehicle_is_null_for_an_empty_or_non_array_body()
    {
        using var empty = JsonDocument.Parse("[]");
        using var obj = JsonDocument.Parse("{}");

        Assert.Null(QuickStatsVehicle.FromVehiclesArray(empty.RootElement));
        Assert.Null(QuickStatsVehicle.FromVehiclesArray(obj.RootElement));
    }

    // ---- Live-state parser ---------------------------------------------------------

    [Fact]
    public void LiveState_reads_the_nested_state_string()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"state":"driving"}}""");

        var state = QuickStatsLiveState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal("driving", state!.Status);
    }

    [Fact]
    public void LiveState_is_null_when_no_state_object_present()
    {
        using var doc = JsonDocument.Parse("""{"vehicle":{"id":7}}""");
        Assert.Null(QuickStatsLiveState.FromResponse(doc.RootElement));
    }

    // ---- Analytics parser ----------------------------------------------------------

    [Fact]
    public void Analytics_reads_snake_case_totals()
    {
        using var doc = JsonDocument.Parse("""
        {"total_distance_km":1234.5,"total_drives":42,"total_energy_kwh":456.7,"total_cost":78.9}
        """);

        var analytics = QuickStatsAnalytics.FromJson(doc.RootElement);

        Assert.Equal(1234.5, analytics.TotalDistanceKm);
        Assert.Equal(42, analytics.TotalDrives);
        Assert.Equal(456.7, analytics.TotalEnergyKwh);
        Assert.Equal(78.9, analytics.TotalCost);
        Assert.True(analytics.HasData);
    }

    [Fact]
    public void Analytics_is_tolerant_and_empty_for_non_object()
    {
        using var partial = JsonDocument.Parse("""{"total_drives":3}""");
        using var array = JsonDocument.Parse("[]");

        var fromPartial = QuickStatsAnalytics.FromJson(partial.RootElement);
        Assert.Equal(3, fromPartial.TotalDrives);
        Assert.Equal(0, fromPartial.TotalDistanceKm);

        Assert.False(QuickStatsAnalytics.FromJson(array.RootElement).HasData);
    }

    // ---- Projection: panels --------------------------------------------------------

    [Fact]
    public void Projection_emits_four_metric_panels_in_order()
    {
        var display = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics()), QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);

        Assert.Collection(
            display.Metrics,
            m => Assert.Equal("distance", m.Key),
            m => Assert.Equal("drives", m.Key),
            m => Assert.Equal("energy", m.Key),
            m => Assert.Equal("cost", m.Key));
    }

    [Fact]
    public void Projection_assigns_the_web_metric_accent_colours()
    {
        var display = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics()), QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);

        Assert.Equal(QuickStatsProjection.CyanAccentBrushKey, Metric(display, "distance").AccentBrushKey);
        Assert.Equal(QuickStatsProjection.GreenAccentBrushKey, Metric(display, "drives").AccentBrushKey);
        Assert.Equal(QuickStatsProjection.AmberAccentBrushKey, Metric(display, "energy").AccentBrushKey);
        Assert.Equal(QuickStatsProjection.PurpleAccentBrushKey, Metric(display, "cost").AccentBrushKey);
    }

    [Fact]
    public void Projection_converts_distance_to_metric_and_imperial()
    {
        var metric = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics(distanceKm: 1000)), QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);
        var imperial = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics(distanceKm: 1000)), QuickStatsState.Loaded, UnitPref.Imperial, "$", Localizer);

        Assert.Equal("1,000", Metric(metric, "distance").Value);
        Assert.Equal("km Driven", Metric(metric, "distance").Label);

        Assert.Equal("621", Metric(imperial, "distance").Value);
        Assert.Equal("mi Driven", Metric(imperial, "distance").Label);
    }

    [Fact]
    public void Projection_formats_cost_with_the_currency_symbol()
    {
        var dollars = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics(cost: 78)), QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);
        var euros = QuickStatsProjection.Project(
            Snapshot(analytics: Analytics(cost: 78)), QuickStatsState.Loaded, UnitPref.Metric, "\u20ac", Localizer);

        Assert.Equal("$78", Metric(dollars, "cost").Value);
        Assert.Equal("\u20ac78", Metric(euros, "cost").Value);
    }

    [Fact]
    public void Projection_renders_the_vehicle_card_name_and_model_state()
    {
        var vehicle = new QuickStatsVehicle(7, "Garage Y", "modely");
        var display = QuickStatsProjection.Project(
            Snapshot(vehicle, new QuickStatsLiveState("driving"), Analytics()),
            QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);

        Assert.True(display.HasVehicle);
        Assert.Equal("Garage Y", display.VehicleName);
        Assert.Equal("modely \u00b7 driving", display.VehicleSubtitle);
    }

    [Fact]
    public void Projection_falls_back_to_default_name_and_offline_state()
    {
        var vehicle = new QuickStatsVehicle(7, string.Empty, "model3");
        var display = QuickStatsProjection.Project(
            Snapshot(vehicle, state: null, analytics: Analytics()),
            QuickStatsState.Loaded, UnitPref.Metric, "$", Localizer);

        Assert.Equal("Tesla", display.VehicleName);
        Assert.Equal("model3 \u00b7 offline", display.VehicleSubtitle);
    }

    [Fact]
    public void Projection_surfaces_the_no_vehicle_empty_state()
    {
        var display = QuickStatsProjection.Project(
            QuickStatsSnapshot.Empty, QuickStatsState.Empty, UnitPref.Metric, "$", Localizer);

        Assert.False(display.HasVehicle);
        Assert.Equal("No vehicle found", display.NoVehicleMessage);
        Assert.True(display.ShowContent);
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        QuickStatsProjection.Project(
            Snapshot(new QuickStatsVehicle(1, "X", "model3"), new QuickStatsLiveState("online"), Analytics()),
            QuickStatsState.Loaded, UnitPref.Metric, "$", recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- View-model: four-state matrix ---------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<QuickStatsSnapshot>.Loaded(
                Snapshot(new QuickStatsVehicle(1, "X", "model3"), new QuickStatsLiveState("online"), Analytics()), Now));

        Assert.Equal(QuickStatsState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(QuickStatsState.Loaded, vm.State);
        Assert.True(vm.Display.HasVehicle);
        Assert.True(vm.Display.ShowContent);
    }

    [Fact]
    public async Task ViewModel_classifies_a_no_data_snapshot_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<QuickStatsSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(QuickStatsState.Empty, vm.State);
        Assert.False(vm.Display.HasVehicle);
        Assert.True(vm.Display.ShowContent);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_failure()
    {
        using var vm = NewViewModel(
            RepositoryResult<QuickStatsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(QuickStatsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        using var vm = NewViewModel(
            RepositoryResult<QuickStatsSnapshot>.Loaded(Snapshot(analytics: Analytics(distanceKm: 1000)), Now));

        await vm.LoadAsync();
        Assert.Equal("1,000", Metric(vm.Display, "distance").Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("621", Metric(vm.Display, "distance").Value);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new QuickStatsPageViewModel(
            new FakeQuickStatsSource(), Localizer, diagnostics: new QuickStatsDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=QuickStatsPage", lines);
    }

    // ---- Registration / source shaping ---------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_window()
    {
        Assert.Equal("QuickStats", QuickStatsRegistration.RouteName);
        Assert.Equal("quick-stats", QuickStatsRegistration.Route);
        Assert.Equal(30, QuickStatsRegistration.AnalyticsDays);
        Assert.Equal("Quick Stats", QuickStatsRegistration.Title(Localizer));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static QuickStatsMetric Metric(QuickStatsDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        throw new KeyNotFoundException(key);
    }

    private static QuickStatsPageViewModel NewViewModel(params RepositoryResult<QuickStatsSnapshot>[] emissions) =>
        new(new FakeQuickStatsSource(emissions), Localizer, UnitPref.Metric, "$");

    private sealed class FakeQuickStatsSource(params RepositoryResult<QuickStatsSnapshot>[] emissions) : IQuickStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<QuickStatsSnapshot>> StreamAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
