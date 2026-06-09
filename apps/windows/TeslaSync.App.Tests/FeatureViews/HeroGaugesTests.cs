using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the HeroGauges feature surface's UI-thread-free logic — the JSON parse
/// adapter, the SI→display projection (distance / drives / energy / efficiency / gas-savings / CO₂ with
/// units + currency), the cache-then-network result mapper, the per-gauge accents + glyphs + accessible
/// names, the localized labels + i18n key set, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/analytics/components/analytics/HeroGauges.tsx). The WinUI view itself
/// (HeroGauges.cs) is exercised by the app build.
/// </summary>
public sealed class HeroGaugesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    private static HeroFleetAnalytics Fleet(
        double distanceKm = 1000,
        double drives = 42,
        double energyKwh = 234.5,
        double effWhKm = 150,
        double cost = 50) =>
        new(distanceKm, drives, energyKwh, effWhKm, cost);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_vehicles":3,"total_distance_km":1234.5,"total_drives":42,
         "total_charging_sessions":11,"total_energy_kwh":456.7,"total_cost":78.9,
         "avg_efficiency_wh_km":171.2}
        """;
        using var doc = JsonDocument.Parse(json);

        var fleet = HeroFleetAnalytics.FromJson(doc.RootElement);

        Assert.Equal(1234.5, fleet.TotalDistanceKm);
        Assert.Equal(42, fleet.TotalDrives);
        Assert.Equal(456.7, fleet.TotalEnergyKwh);
        Assert.Equal(78.9, fleet.TotalCost);
        Assert.Equal(171.2, fleet.AvgEfficiencyWhKm);
        Assert.True(fleet.HasData);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"total_drives":7}""");

        var fleet = HeroFleetAnalytics.FromJson(doc.RootElement);

        Assert.Equal(7, fleet.TotalDrives);
        Assert.Equal(0, fleet.TotalDistanceKm);
        Assert.Equal(0, fleet.TotalEnergyKwh);
        Assert.Equal(0, fleet.AvgEfficiencyWhKm);
        Assert.Equal(0, fleet.TotalCost);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var fleet = HeroFleetAnalytics.FromJson(doc.RootElement);
        Assert.False(fleet.HasData);
        Assert.Equal(0, fleet.TotalDistanceKm);
    }

    [Theory]
    [InlineData(0, 0, 0, false)]   // nothing
    [InlineData(5, 0, 0, true)]    // distance only
    [InlineData(0, 5, 0, true)]    // energy only
    [InlineData(0, 0, 3, true)]    // drives only
    public void HasData_gates_the_empty_state(double distKm, double energyKwh, double drives, bool expected) =>
        Assert.Equal(expected, Fleet(distanceKm: distKm, energyKwh: energyKwh, drives: drives).HasData);

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_six_gauges()
    {
        var view = HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "$", Localizer);

        Assert.Equal(6, view.Gauges.Count);
        Assert.True(view.HasData);

        Assert.Equal("Distance", view.Gauges[0].Label);
        Assert.Equal("1,000.0", view.Gauges[0].Value);
        Assert.Equal("km", view.Gauges[0].Subtitle);

        Assert.Equal("Drives", view.Gauges[1].Label);
        Assert.Equal("42", view.Gauges[1].Value);
        Assert.Null(view.Gauges[1].Subtitle);

        Assert.Equal("Energy", view.Gauges[2].Label);
        Assert.Equal("234.5", view.Gauges[2].Value);
        Assert.Equal("kWh", view.Gauges[2].Subtitle);

        Assert.Equal("Efficiency", view.Gauges[3].Label);
        Assert.Equal("150.0", view.Gauges[3].Value);
        Assert.Equal("Wh/km", view.Gauges[3].Subtitle);

        Assert.Equal("Gas Savings", view.Gauges[4].Label);
        Assert.Equal("$78", view.Gauges[4].Value); // 1000*0.085*1.5 - 50 = 77.5 -> $78
        Assert.Null(view.Gauges[4].Subtitle);

        Assert.Equal("CO\u2082 Saved", view.Gauges[5].Label);
        Assert.Equal("120", view.Gauges[5].Value); // 1000 * 0.12
        Assert.Equal("kg", view.Gauges[5].Subtitle);
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_distance_and_efficiency()
    {
        var view = HeroGaugesProjection.Project(Fleet(), UnitPref.Imperial, "$", Localizer);

        Assert.Equal("621.4", view.Gauges[0].Value);  // 1000 km -> 621.4 mi
        Assert.Equal("mi", view.Gauges[0].Subtitle);

        Assert.Equal("241.4", view.Gauges[3].Value);  // 150 Wh/km * 1.609344 -> 241.4 Wh/mi
        Assert.Equal("Wh/mi", view.Gauges[3].Subtitle);

        // Gas savings + CO₂ stay km-based regardless of the display unit.
        Assert.Equal("$78", view.Gauges[4].Value);
        Assert.Equal("120", view.Gauges[5].Value);
    }

    [Fact]
    public void Project_clamps_gas_savings_at_zero_when_cost_exceeds_savings()
    {
        // 100 km -> 100*0.085*1.5 = 12.75 saved; cost 50 -> negative -> clamped to $0.
        var view = HeroGaugesProjection.Project(Fleet(distanceKm: 100, cost: 50), UnitPref.Metric, "$", Localizer);

        Assert.Equal("$0", view.Gauges[4].Value);
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var view = HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "\u20AC", Localizer);

        Assert.StartsWith("\u20AC", view.Gauges[4].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_assigns_the_web_neon_accents_per_gauge()
    {
        var view = HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "$", Localizer);

        Assert.Equal(
            new[]
            {
                HeroGaugeAccent.Cyan, HeroGaugeAccent.Purple, HeroGaugeAccent.Green,
                HeroGaugeAccent.Amber, HeroGaugeAccent.Green, HeroGaugeAccent.Green,
            },
            view.Gauges.Select(g => g.Accent).ToArray());
    }

    [Fact]
    public void Project_assigns_the_expected_glyph_per_gauge()
    {
        var view = HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "$", Localizer);

        Assert.Equal(HeroGaugesProjection.DistanceGlyph, view.Gauges[0].Glyph);
        Assert.Equal(HeroGaugesProjection.DrivesGlyph, view.Gauges[1].Glyph);
        Assert.Equal(HeroGaugesProjection.EnergyGlyph, view.Gauges[2].Glyph);
        Assert.Equal(HeroGaugesProjection.EfficiencyGlyph, view.Gauges[3].Glyph);
        Assert.Equal(HeroGaugesProjection.GasSavingsGlyph, view.Gauges[4].Glyph);
        Assert.Equal(HeroGaugesProjection.Co2Glyph, view.Gauges[5].Glyph);
    }

    [Fact]
    public void Project_zero_fleet_still_renders_six_gauges_but_is_not_data()
    {
        var view = HeroGaugesProjection.Project(HeroFleetAnalytics.Empty, UnitPref.Metric, "$", Localizer);

        Assert.False(view.HasData);
        Assert.Equal(6, view.Gauges.Count);
        Assert.Equal("0.0", view.Gauges[0].Value);
        Assert.Equal("0", view.Gauges[1].Value);
        Assert.Equal("$0", view.Gauges[4].Value);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Every_gauge_exposes_a_descriptive_automation_name()
    {
        var gauges = HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "$", Localizer).Gauges;

        Assert.All(gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
        Assert.Equal("Distance: 1,000.0 km", gauges[0].AutomationName);
        Assert.Equal("Drives: 42", gauges[1].AutomationName);
        Assert.Equal("CO\u2082 Saved: 120 kg", gauges[5].AutomationName);
    }

    // ---- i18n ----------------------------------------------------------------------

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        HeroGaugesProjection.Project(Fleet(), UnitPref.Metric, "$", recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["analytics.hero.distance"] = "Distance",
            ["analytics.hero.drives"] = "Drives",
            ["analytics.hero.energy"] = "Energy",
            ["analytics.hero.efficiency"] = "Efficiency",
            ["analytics.hero.gasSavings"] = "Gas Savings",
            ["analytics.hero.co2Saved"] = "CO\u2082 Saved",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10,"total_energy_kwh":5}""");

        var cached = HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.TotalDistanceKm);

        var offline = HeroGaugesResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(5, offline.Value!.TotalEnergyKwh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":10}""");

        Assert.Equal(LoadStatus.Loaded, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<HeroFleetAnalytics>.Loading());
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauges()
    {
        using var vm = NewViewModel(Loaded(Fleet()));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Gauges.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(HeroFleetAnalytics.Empty));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No analytics yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<HeroFleetAnalytics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<HeroFleetAnalytics>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<HeroFleetAnalytics>.Cached(Fleet(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<HeroFleetAnalytics>.OfflineCached(
            Fleet(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<HeroFleetAnalytics>.Loading(),
            RepositoryResult<HeroFleetAnalytics>.Cached(Fleet(distanceKm: 500), Now, stale: false),
            RepositoryResult<HeroFleetAnalytics>.Loaded(Fleet(distanceKm: 1000), Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.Equal("1,000.0", vm.Display.Gauges[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Fleet(distanceKm: 1000)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.Gauges[0].Subtitle);
        Assert.Equal("1,000.0", vm.Display.Gauges[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.Gauges[0].Subtitle);
        Assert.Equal("621.4", vm.Display.Gauges[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_gas_savings()
    {
        using var vm = NewViewModel(Loaded(Fleet()));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Gauges[4].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Gauges[4].Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_surface_name_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<HeroFleetAnalytics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Fleet analytics overview", vm.SurfaceName);
        Assert.Equal("No analytics yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Fleet()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(HeroGaugesViewModel.State), changed);
        Assert.Contains(nameof(HeroGaugesViewModel.Display), changed);
    }

    // ---- Registration / constants / diagnostics ------------------------------------

    [Fact]
    public void Registration_slug_and_window_are_stable()
    {
        Assert.Equal("HeroGauges", HeroGaugesRegistration.Slug);
        Assert.Equal(30, HeroGaugesRegistration.DefaultDays);
    }

    [Fact]
    public void Projection_km_per_mile_matches_web_constant() =>
        Assert.Equal(1.609344, HeroGaugesProjection.KmPerMile);

    [Fact]
    public void Projection_heuristic_constants_match_web()
    {
        Assert.Equal(0.085, HeroGaugesProjection.GasLitresPerKm);
        Assert.Equal(1.5, HeroGaugesProjection.GasPricePerLitre);
        Assert.Equal(0.12, HeroGaugesProjection.Co2KgPerKm);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HeroGaugesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HeroGauges", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<HeroFleetAnalytics> Loaded(HeroFleetAnalytics fleet) =>
        RepositoryResult<HeroFleetAnalytics>.Loaded(fleet, Now);

    private static HeroGaugesViewModel NewViewModel(params RepositoryResult<HeroFleetAnalytics>[] emissions) =>
        new(new FakeHeroGaugesSource(emissions), Localizer, UnitPref.Metric, "$");

    private sealed class FakeHeroGaugesSource(params RepositoryResult<HeroFleetAnalytics>[] emissions) : IHeroGaugesSource
    {
        public async IAsyncEnumerable<RepositoryResult<HeroFleetAnalytics>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
