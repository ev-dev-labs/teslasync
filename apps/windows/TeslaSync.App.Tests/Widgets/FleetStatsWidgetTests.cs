using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the FleetStatsWidget's UI-thread-free logic — the JSON parse adapters (fleet
/// analytics, vehicle-list rollup, recent drive/charge series), the SI→display projection (distance,
/// energy, efficiency with units; fleet-size + online + alert cards), the four-source combine-latest mapper,
/// the footprint flags, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx + components/FleetStatsBar.tsx).
/// </summary>
public sealed class FleetStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static FleetStatsReading Reading(
        double analyticsVehicles = 3,
        double distanceKm = 5000,
        double energyKwh = 234.5,
        double efficiencyWhKm = 150,
        int vehicleCount = 3,
        int onlineCount = 2,
        IReadOnlyList<double>? driveDistancesM = null,
        IReadOnlyList<double>? chargeEnergiesWh = null) =>
        new(
            new FleetStatsAnalytics(analyticsVehicles, distanceKm, energyKwh, efficiencyWhKm),
            new FleetVehiclesRollup(vehicleCount, onlineCount),
            driveDistancesM ?? Array.Empty<double>(),
            chargeEnergiesWh ?? Array.Empty<double>());

    // ---- Analytics parse adapter ---------------------------------------------------

    [Fact]
    public void Analytics_FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_vehicles":4,"total_drives":42,"total_charging_sessions":11,
         "total_distance_km":1234.5,"total_energy_kwh":456.7,"total_cost":78.9,
         "avg_efficiency_wh_km":171.2}
        """;
        using var doc = JsonDocument.Parse(json);

        var analytics = FleetStatsAnalytics.FromJson(doc.RootElement);

        Assert.Equal(4, analytics.TotalVehicles);
        Assert.Equal(1234.5, analytics.TotalDistanceKm);
        Assert.Equal(456.7, analytics.TotalEnergyKwh);
        Assert.Equal(171.2, analytics.AvgEfficiencyWhKm);
    }

    [Fact]
    public void Analytics_FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":12}""");

        var analytics = FleetStatsAnalytics.FromJson(doc.RootElement);

        Assert.Equal(12, analytics.TotalDistanceKm);
        Assert.Equal(0, analytics.TotalVehicles);
        Assert.Equal(0, analytics.TotalEnergyKwh);
        Assert.Equal(0, analytics.AvgEfficiencyWhKm);
    }

    [Fact]
    public void Analytics_FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Equal(FleetStatsAnalytics.Empty, FleetStatsAnalytics.FromJson(doc.RootElement));
    }

    // ---- Vehicle-list rollup parse adapter -----------------------------------------

    [Fact]
    public void Vehicles_FromJson_counts_total_and_online()
    {
        const string json = """
        [{"id":1,"state":"online"},{"id":2,"state":"asleep"},{"id":3,"state":"online"},{"id":4,"state":"offline"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var rollup = FleetVehiclesRollup.FromJson(doc.RootElement);

        Assert.Equal(4, rollup.Count);
        Assert.Equal(2, rollup.OnlineCount);
    }

    [Fact]
    public void Vehicles_FromJson_is_case_insensitive_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"state":"ONLINE"},"junk",{"id":9}]""");

        var rollup = FleetVehiclesRollup.FromJson(doc.RootElement);

        Assert.Equal(2, rollup.Count);   // the two objects; the string is skipped
        Assert.Equal(1, rollup.OnlineCount);
    }

    [Fact]
    public void Vehicles_FromJson_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Equal(FleetVehiclesRollup.Empty, FleetVehiclesRollup.FromJson(doc.RootElement));
    }

    // ---- Recent drive / charge series parse ----------------------------------------

    [Fact]
    public void ParseDriveDistances_extracts_distance_m_in_order()
    {
        using var doc = JsonDocument.Parse("""[{"distance_m":300},{"distance_m":200},{"distance_m":100}]""");

        var distances = FleetStatsReading.ParseDriveDistances(doc.RootElement);

        Assert.Equal(new double[] { 300, 200, 100 }, distances);
    }

    [Fact]
    public void ParseChargeEnergies_extracts_total_energy_added_wh_and_skips_missing()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":5000},{"cost":1},{"total_energy_added_wh":7000}]""");

        var energies = FleetStatsReading.ParseChargeEnergies(doc.RootElement);

        Assert.Equal(new double[] { 5000, 7000 }, energies);
    }

    [Fact]
    public void ParseDriveDistances_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Empty(FleetStatsReading.ParseDriveDistances(doc.RootElement));
    }

    // ---- HasData gate --------------------------------------------------------------

    [Theory]
    [InlineData(0, 0, 0, 0, false)] // genuinely empty fleet
    [InlineData(2, 0, 0, 0, true)]  // vehicles from the list
    [InlineData(0, 5, 0, 0, true)]  // vehicles from analytics
    [InlineData(0, 0, 5, 0, true)]  // distance only
    [InlineData(0, 0, 0, 5, true)]  // energy only
    public void HasData_matches_web_gate(int vehicleCount, double analyticsVehicles, double distanceKm, double energyKwh, bool expected) =>
        Assert.Equal(expected, Reading(
            analyticsVehicles: analyticsVehicles,
            distanceKm: distanceKm,
            energyKwh: energyKwh,
            vehicleCount: vehicleCount,
            onlineCount: 0).HasData);

    // ---- Footprint grid columns ----------------------------------------------------

    [Theory]
    [InlineData(4, 4)]
    [InlineData(3, 3)]
    [InlineData(2, 2)]
    [InlineData(1, 2)]
    public void Size_grid_columns_track_footprint(int cols, int expected) =>
        Assert.Equal(expected, new FleetStatsSize(cols, 2).GridColumns);

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_composes_five_cards()
    {
        var view = FleetStatsProjection.Project(
            Reading(distanceKm: 5000, energyKwh: 234.5, efficiencyWhKm: 150, vehicleCount: 3, onlineCount: 2),
            FleetStatsSize.Default, UnitPref.Metric, Localizer);

        Assert.Equal(5, view.Cards.Count);

        Assert.Equal("Fleet Size", view.Cards[0].Label);
        Assert.Equal(3, view.Cards[0].Value);
        Assert.Equal("2 online", view.Cards[0].Subtitle);
        Assert.Equal(FleetStatTone.Primary, view.Cards[0].Tone);

        Assert.Equal("Distance (30d)", view.Cards[1].Label);
        Assert.Equal(" km", view.Cards[1].Suffix);
        Assert.Equal(FleetStatTone.Cyan, view.Cards[1].Tone);

        Assert.Equal("Energy (30d)", view.Cards[2].Label);
        Assert.Equal(234.5, view.Cards[2].Value);
        Assert.Equal(1, view.Cards[2].Precision);
        Assert.Equal(" kWh", view.Cards[2].Suffix);
        Assert.Equal(FleetStatTone.Emerald, view.Cards[2].Tone);

        Assert.Equal("Efficiency", view.Cards[3].Label);
        Assert.Equal(150, view.Cards[3].Value);
        Assert.Equal(" Wh/km", view.Cards[3].Suffix);
        Assert.Equal("fleet average", view.Cards[3].Subtitle);
        Assert.Equal(FleetStatTone.Amber, view.Cards[3].Tone);

        Assert.Equal("Alerts", view.Cards[4].Label);
        Assert.Equal(0, view.Cards[4].Value);
        Assert.Equal("unread", view.Cards[4].Subtitle);
        Assert.Equal(FleetStatTone.AlertClear, view.Cards[4].Tone);
    }

    [Fact]
    public void Project_distance_mirrors_web_no_km_scaling()
    {
        // Web parity (FleetStatsWidget.tsx): toDistanceDisplay(total_distance_km) =
        // convertDistanceFromSI(total_distance_km, unit) WITHOUT the km→m ×1000 the sibling
        // AnalyticsSummary widget applies. Metric therefore divides the km value by 1000 (5000 → 5),
        // exactly as the binding web spec renders it. This test locks that intentional parity.
        var metric = FleetStatsProjection.Project(
            Reading(distanceKm: 5000), FleetStatsSize.Default, UnitPref.Metric, Localizer);
        Assert.Equal(5.0, metric.Cards[1].Value, 6);

        var imperial = FleetStatsProjection.Project(
            Reading(distanceKm: 5000), FleetStatsSize.Default, UnitPref.Imperial, Localizer);
        Assert.Equal(5000.0 / 1609.344, imperial.Cards[1].Value, 6);
        Assert.Equal(" mi", imperial.Cards[1].Suffix);
    }

    // ---- Projection (imperial efficiency) ------------------------------------------

    [Fact]
    public void Project_imperial_converts_efficiency_with_web_constant()
    {
        var view = FleetStatsProjection.Project(
            Reading(efficiencyWhKm: 150), FleetStatsSize.Default, UnitPref.Imperial, Localizer);

        Assert.Equal(150 * 1.609344, view.Cards[3].Value, 6);
        Assert.Equal(" Wh/mi", view.Cards[3].Suffix);
    }

    [Fact]
    public void Project_alert_tone_turns_clear_when_no_unread()
    {
        var view = FleetStatsProjection.Project(Reading(), FleetStatsSize.Default, UnitPref.Metric, Localizer);
        Assert.Equal(0, view.Cards[4].Value); // Web parity: unreadAlerts is hardcoded to 0.
        Assert.Equal(FleetStatTone.AlertClear, view.Cards[4].Tone);
    }

    // ---- Sparklines ----------------------------------------------------------------

    [Fact]
    public void Project_distance_sparkline_is_reversed_to_chronological()
    {
        var view = FleetStatsProjection.Project(
            Reading(driveDistancesM: new double[] { 300, 200, 100 }),
            FleetStatsSize.Default, UnitPref.Metric, Localizer);

        Assert.Equal(new double[] { 100, 200, 300 }, view.Cards[1].Sparkline);
        Assert.Equal(0, view.Cards[1].SparkColorIndex);
    }

    [Fact]
    public void Project_energy_sparkline_caps_to_recent_limit_then_reverses()
    {
        var view = FleetStatsProjection.Project(
            Reading(chargeEnergiesWh: new double[] { 6, 5, 4, 3, 2, 1 }),
            FleetStatsSize.Default, UnitPref.Metric, Localizer);

        // Newest-first, capped to 5, then reversed for the sparkline.
        Assert.Equal(new double[] { 2, 3, 4, 5, 6 }, view.Cards[2].Sparkline);
        Assert.Equal(1, view.Cards[2].SparkColorIndex);
    }

    [Fact]
    public void Project_sparkline_is_null_below_two_points()
    {
        var oneDrive = FleetStatsProjection.Project(
            Reading(driveDistancesM: new double[] { 100 }), FleetStatsSize.Default, UnitPref.Metric, Localizer);
        Assert.Null(oneDrive.Cards[1].Sparkline);

        var noCharges = FleetStatsProjection.Project(
            Reading(chargeEnergiesWh: Array.Empty<double>()), FleetStatsSize.Default, UnitPref.Metric, Localizer);
        Assert.Null(noCharges.Cards[2].Sparkline);
    }

    // ---- Accessibility names -------------------------------------------------------

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var view = FleetStatsProjection.Project(
            Reading(vehicleCount: 3, onlineCount: 2), FleetStatsSize.Default, UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("online", view.Cards[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains("fleet average", view.Cards[3].AutomationName, StringComparison.Ordinal);
    }

    // ---- Combine mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Combine_preserves_analytics_status_and_folds_all_sources()
    {
        using var analytics = JsonDocument.Parse("""{"total_distance_km":1000,"total_energy_kwh":50,"total_vehicles":2}""");
        using var vehicles = JsonDocument.Parse("""[{"state":"online"},{"state":"asleep"}]""");
        using var drives = JsonDocument.Parse("""[{"distance_m":10},{"distance_m":20}]""");
        using var charges = JsonDocument.Parse("""[{"total_energy_added_wh":1},{"total_energy_added_wh":2}]""");

        var combined = FleetStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(analytics.RootElement, Now, stale: true),
            RepositoryResult<JsonElement>.Loaded(vehicles.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(drives.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(charges.RootElement, Now));

        Assert.Equal(LoadStatus.Cached, combined.Status);
        Assert.True(combined.IsStale);
        Assert.Equal(1000, combined.Value!.Analytics.TotalDistanceKm);
        Assert.Equal(2, combined.Value.Vehicles.Count);
        Assert.Equal(1, combined.Value.Vehicles.OnlineCount);
        Assert.Equal(new double[] { 10, 20 }, combined.Value.RecentDriveDistancesM);
        Assert.Equal(new double[] { 1, 2 }, combined.Value.RecentChargeEnergiesWh);
    }

    [Fact]
    public void Combine_loading_analytics_yields_loading_regardless_of_others()
    {
        using var vehicles = JsonDocument.Parse("""[{"state":"online"}]""");

        var combined = FleetStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loading(),
            RepositoryResult<JsonElement>.Loaded(vehicles.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(),
            RepositoryResult<JsonElement>.Empty());

        Assert.Equal(LoadStatus.Loading, combined.Status);
    }

    [Fact]
    public void Combine_maps_offline_and_failure_from_analytics()
    {
        using var analytics = JsonDocument.Parse("""{"total_distance_km":10}""");

        var offline = FleetStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(analytics.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Empty(),
            RepositoryResult<JsonElement>.Empty(),
            RepositoryResult<JsonElement>.Empty());
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(10, offline.Value!.Analytics.TotalDistanceKm);

        var failure = FleetStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Empty(),
            RepositoryResult<JsonElement>.Empty(),
            RepositoryResult<JsonElement>.Empty());
        Assert.Equal(LoadStatus.Error, failure.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cards()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(5, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Reading(analyticsVehicles: 0, distanceKm: 0, energyKwh: 0, vehicleCount: 0, onlineCount: 0)));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No fleet data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetStatsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetStatsReading>.Loading(),
            RepositoryResult<FleetStatsReading>.Cached(Reading(vehicleCount: 2), Now, stale: false),
            RepositoryResult<FleetStatsReading>.Loaded(Reading(vehicleCount: 5), Now));
        await vm.LoadAsync();

        Assert.Equal(FleetStatsState.Loaded, vm.State);
        Assert.Equal(5, vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Reading(efficiencyWhKm: 150)));
        await vm.LoadAsync();
        Assert.Equal(" Wh/km", vm.Display.Cards[3].Suffix);

        vm.Units = UnitPref.Imperial;
        Assert.Equal(" Wh/mi", vm.Display.Cards[3].Suffix);
        Assert.Equal(FleetStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_without_losing_state()
    {
        using var vm = NewViewModel(new FleetStatsSize(2, 2), Loaded(Reading()));
        await vm.LoadAsync();
        Assert.Equal(FleetStatsState.Loaded, vm.State);

        vm.Size = new FleetStatsSize(4, 2);
        Assert.Equal(4, vm.Size.GridColumns);
        Assert.Equal(FleetStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<FleetStatsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Fleet Stats", vm.Title);
        Assert.Equal("No fleet data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(FleetStatsViewModel.State), changed);
        Assert.Contains(nameof(FleetStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("fleet-stats", FleetStatsRegistration.Id);
        Assert.Equal("analytics", FleetStatsRegistration.Category);
        Assert.Equal("FleetStatsWidget", FleetStatsRegistration.Slug);
        Assert.Equal(new FleetStatsSize(4, 2), FleetStatsRegistration.DefaultSize);
        Assert.Equal(new FleetStatsSize(2, 2), FleetStatsRegistration.MinSize);
        Assert.Equal(new FleetStatsSize(4, 40), FleetStatsRegistration.MaxSize);
        Assert.Equal("Fleet Stats", FleetStatsRegistration.Name(Localizer));
        Assert.Equal("Fleet-wide metrics and totals", FleetStatsRegistration.Description(Localizer));
        Assert.Equal(30, FleetStatsRegistration.DefaultDays);
    }

    [Theory]
    [InlineData(4, 2, true)]
    [InlineData(2, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(1, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(4, 41, false)] // above max rows
    [InlineData(4, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, FleetStatsRegistration.IsWithinBounds(new FleetStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new FleetStatsSize(2, 2), FleetStatsRegistration.Clamp(new FleetStatsSize(0, 0)));
        Assert.Equal(new FleetStatsSize(4, 40), FleetStatsRegistration.Clamp(new FleetStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FleetStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FleetStatsWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_mi_to_km_matches_web_constant() =>
        Assert.Equal(1.609344, FleetStatsProjection.MiToKm);

    [Fact]
    public void Projection_recent_limit_matches_web_query() =>
        Assert.Equal(5, FleetStatsProjection.RecentLimit);

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<FleetStatsReading> Loaded(FleetStatsReading reading) =>
        RepositoryResult<FleetStatsReading>.Loaded(reading, Now);

    private static FleetStatsViewModel NewViewModel(params RepositoryResult<FleetStatsReading>[] emissions) =>
        NewViewModel(FleetStatsSize.Default, emissions);

    private static FleetStatsViewModel NewViewModel(
        FleetStatsSize size,
        params RepositoryResult<FleetStatsReading>[] emissions) =>
        new(new FakeFleetStatsSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeFleetStatsSource(params RepositoryResult<FleetStatsReading>[] emissions) : IFleetStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetStatsReading>> StreamAsync(
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
