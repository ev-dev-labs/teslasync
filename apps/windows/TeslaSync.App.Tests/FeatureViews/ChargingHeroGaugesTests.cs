using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the charging Hero Gauges feature surface's UI-thread-free logic — the
/// charging-sessions reduction (count / energy / cost / average power / average cost-per-kWh), the four-gauge
/// + cost-tile projection (values, full-sweep maxima, units, neon accents, accessible names), the
/// cache-then-network result mapper, the localized labels + i18n key set, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/charging/components/charging-list/HeroGauges.tsx). The WinUI view
/// itself (HeroGauges.cs) is exercised by the app build.
/// </summary>
public sealed class ChargingHeroGaugesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // Three sessions: 100 kWh total, $20 total, avg power over the two powered sessions = 100 kW, $0.20/kWh.
    private const string ThreeSessions = """
    [
      {"total_energy_added_wh":50000,"cost_decimal":10,"peak_power_w":120000,"started_at":"2026-06-01T10:00:00Z","ended_at":"2026-06-01T11:00:00Z"},
      {"total_energy_added_wh":30000,"cost_decimal":6,"peak_power_w":80000,"started_at":"2026-06-02T10:00:00Z","ended_at":"2026-06-02T10:30:00Z"},
      {"total_energy_added_wh":20000,"cost_decimal":4,"peak_power_w":0,"started_at":"2026-06-03T10:00:00Z","ended_at":"2026-06-03T10:45:00Z"}
    ]
    """;

    private static ChargingStats Stats(
        int count = 3,
        double energyKwh = 100,
        double cost = 20,
        double powerKw = 100,
        double costPerKwh = 0.2) =>
        new(count, energyKwh, cost, powerKw, costPerKwh);

    // ---- Reduction adapter --------------------------------------------------------

    [Fact]
    public void FromSessionsJson_reduces_the_web_compute_stats()
    {
        var stats = ChargingStats.FromSessionsJson(Parse(ThreeSessions));

        Assert.Equal(3, stats.Count);
        Assert.Equal(100, stats.TotalEnergyKwh);       // (50000+30000+20000)/1000
        Assert.Equal(20, stats.TotalCost);             // 10+6+4
        Assert.Equal(100, stats.AvgPowerKw);           // (120000+80000)/2/1000 — zero-power session excluded
        Assert.Equal(0.2, stats.AvgCostPerKwh);        // 20 / 100
        Assert.True(stats.HasData);
    }

    [Fact]
    public void FromSessionsJson_excludes_zero_and_missing_power_from_the_average()
    {
        // Only the 90 kW session has truthy power; the zero-power and the power-less rows do not dilute it.
        var stats = ChargingStats.FromSessionsJson(Parse("""
        [
          {"total_energy_added_wh":10000,"cost_decimal":2,"peak_power_w":90000},
          {"total_energy_added_wh":10000,"cost_decimal":2,"peak_power_w":0},
          {"total_energy_added_wh":10000,"cost_decimal":2}
        ]
        """));

        Assert.Equal(3, stats.Count);
        Assert.Equal(90, stats.AvgPowerKw);
    }

    [Fact]
    public void FromSessionsJson_is_tolerant_of_missing_fields()
    {
        var stats = ChargingStats.FromSessionsJson(Parse("""[{"total_energy_added_wh":5000}]"""));

        Assert.Equal(1, stats.Count);
        Assert.Equal(5, stats.TotalEnergyKwh);
        Assert.Equal(0, stats.TotalCost);
        Assert.Equal(0, stats.AvgPowerKw);
        Assert.Equal(0, stats.AvgCostPerKwh);
        Assert.True(stats.HasData);
    }

    [Fact]
    public void FromSessionsJson_guards_cost_per_kwh_when_energy_is_zero()
    {
        var stats = ChargingStats.FromSessionsJson(Parse("""[{"total_energy_added_wh":0,"cost_decimal":5}]"""));

        Assert.Equal(1, stats.Count);
        Assert.Equal(0, stats.AvgCostPerKwh);
        Assert.True(stats.HasData);
    }

    [Theory]
    [InlineData("{}")]   // object, not array
    [InlineData("[]")]   // empty array
    [InlineData("null")] // null body
    public void FromSessionsJson_returns_empty_for_no_sessions(string json)
    {
        var stats = ChargingStats.FromSessionsJson(Parse(json));

        Assert.False(stats.HasData);
        Assert.Equal(0, stats.Count);
        Assert.Same(ChargingStats.Empty, ChargingStats.FromSessionsJson(Parse(json)));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_renders_four_gauges_and_a_cost_tile()
    {
        var view = HeroGaugesProjection.Project(Stats(), "$", Localizer);

        Assert.True(view.HasData);
        Assert.Equal(4, view.Gauges.Count);

        Assert.Equal("Sessions", view.Gauges[0].Label);
        Assert.Equal(3, view.Gauges[0].Value);
        Assert.Equal(50, view.Gauges[0].Max);            // max(3, 50)
        Assert.Equal(string.Empty, view.Gauges[0].Unit);

        Assert.Equal("Energy", view.Gauges[1].Label);
        Assert.Equal(100, view.Gauges[1].Value);
        Assert.Equal(500, view.Gauges[1].Max);           // max(100, 500)
        Assert.Equal("kWh", view.Gauges[1].Unit);

        Assert.Equal("Total Cost", view.Gauges[2].Label);
        Assert.Equal(20, view.Gauges[2].Value);
        Assert.Equal(100, view.Gauges[2].Max);           // max(20, 100)
        Assert.Equal("$", view.Gauges[2].Unit);

        Assert.Equal("Avg Power", view.Gauges[3].Label);
        Assert.Equal(100, view.Gauges[3].Value);
        Assert.Equal(250, view.Gauges[3].Max);           // fixed 250
        Assert.Equal("kW", view.Gauges[3].Unit);

        Assert.Equal("Avg $/kWh", view.CostPerKwh.Label);
        Assert.Equal(0.2, view.CostPerKwh.Value);
        Assert.Equal(3, view.CostPerKwh.Decimals);
        Assert.Equal("$", view.CostPerKwh.Prefix);
    }

    [Fact]
    public void Project_assigns_the_web_neon_accents_per_gauge()
    {
        var view = HeroGaugesProjection.Project(Stats(), "$", Localizer);

        Assert.Equal(
            new[] { HeroGaugeAccent.Cyan, HeroGaugeAccent.Green, HeroGaugeAccent.Amber, HeroGaugeAccent.Purple },
            view.Gauges.Select(g => g.Accent).ToArray());
    }

    [Fact]
    public void Project_rounds_gauge_values_like_the_web_source()
    {
        // totalEnergy 234.5 -> 235 ; totalCost 49.6 -> 50 ; avgPower 99.4 -> 99.
        var view = HeroGaugesProjection.Project(Stats(energyKwh: 234.5, cost: 49.6, powerKw: 99.4), "$", Localizer);

        Assert.Equal(235, view.Gauges[1].Value);
        Assert.Equal(50, view.Gauges[2].Value);
        Assert.Equal(99, view.Gauges[3].Value);
    }

    [Fact]
    public void Project_rounds_cost_per_kwh_to_two_decimals()
    {
        var view = HeroGaugesProjection.Project(Stats(costPerKwh: 0.2567), "$", Localizer);

        Assert.Equal(0.26, view.CostPerKwh.Value);
    }

    [Fact]
    public void Project_respects_the_currency_symbol()
    {
        var view = HeroGaugesProjection.Project(Stats(), "\u20AC", Localizer);

        Assert.Equal("\u20AC", view.Gauges[2].Unit);          // cost gauge suffix
        Assert.Equal("\u20AC", view.CostPerKwh.Prefix);       // cost tile prefix
        Assert.StartsWith("Avg $/kWh: \u20AC", view.CostPerKwh.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_blank_currency_falls_back_to_dollar()
    {
        var view = HeroGaugesProjection.Project(Stats(), "   ", Localizer);

        Assert.Equal("$", view.Gauges[2].Unit);
        Assert.Equal("$", view.CostPerKwh.Prefix);
    }

    [Fact]
    public void Project_empty_stats_is_not_data_but_still_projects_every_tile()
    {
        var view = HeroGaugesProjection.Project(ChargingStats.Empty, "$", Localizer);

        Assert.False(view.HasData);
        Assert.Equal(4, view.Gauges.Count);
        Assert.Equal(0, view.Gauges[0].Value);
        Assert.Equal(50, view.Gauges[0].Max);             // floor still applies when value is zero
        Assert.Equal(0, view.CostPerKwh.Value);
    }

    [Fact]
    public void Every_tile_exposes_a_descriptive_automation_name()
    {
        var view = HeroGaugesProjection.Project(Stats(), "$", Localizer);

        Assert.All(view.Gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
        Assert.Equal("Sessions: 3", view.Gauges[0].AutomationName);
        Assert.Equal("Energy: 100 kWh", view.Gauges[1].AutomationName);
        Assert.Equal("Total Cost: 20 $", view.Gauges[2].AutomationName);
        Assert.Equal("Avg Power: 100 kW", view.Gauges[3].AutomationName);
        Assert.Equal("Avg $/kWh: $0.200", view.CostPerKwh.AutomationName);
    }

    // ---- i18n ----------------------------------------------------------------------

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        HeroGaugesProjection.Project(Stats(), "$", recorder);
        using var vm = new HeroGaugesViewModel(new FakeHeroGaugesSource(), recorder, "$");
        _ = vm.EmptyMessage;

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["charging.gauges.sessions"] = "Sessions",
            ["charging.gauges.energy"] = "Energy",
            ["charging.gauges.totalCost"] = "Total Cost",
            ["charging.gauges.avgPower"] = "Avg Power",
            ["charging.gauges.avgCostPerKwh"] = "Avg $/kWh",
            ["charging.noStats"] = "No charging statistics available yet",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_reduces_payload()
    {
        var sessions = Parse(ThreeSessions);

        var cached = HeroGaugesResultMapper.Map(RepositoryResult<JsonElement>.Cached(sessions, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Count);
        Assert.Equal(100, cached.Value.TotalEnergyKwh);

        var offline = HeroGaugesResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            sessions, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(20, offline.Value!.TotalCost);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        var sessions = Parse(ThreeSessions);

        Assert.Equal(LoadStatus.Loaded, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(sessions, Now)).Status);

        Assert.Equal(LoadStatus.Empty, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, HeroGaugesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauges()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Gauges.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(ChargingStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No charging statistics available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingStats>.Cached(Stats(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingStats>.OfflineCached(
            Stats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
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
            RepositoryResult<ChargingStats>.Loading(),
            RepositoryResult<ChargingStats>.Cached(Stats(count: 2), Now, stale: false),
            RepositoryResult<ChargingStats>.Loaded(Stats(count: 5), Now));
        await vm.LoadAsync();

        Assert.Equal(HeroGaugesState.Loaded, vm.State);
        Assert.Equal(5, vm.Display.Gauges[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_tiles()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        await vm.LoadAsync();
        Assert.Equal("$", vm.Display.CostPerKwh.Prefix);
        Assert.Equal("$", vm.Display.Gauges[2].Unit);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.Equal("\u00A3", vm.Display.CostPerKwh.Prefix);
        Assert.Equal("\u00A3", vm.Display.Gauges[2].Unit);
    }

    [Fact]
    public async Task ViewModel_surface_name_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charging statistics", vm.SurfaceName);
        Assert.Equal("No charging statistics available yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Stats()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(HeroGaugesViewModel.State), changed);
        Assert.Contains(nameof(HeroGaugesViewModel.Display), changed);
    }

    // ---- Registration / diagnostics ------------------------------------------------

    [Fact]
    public void Registration_slug_and_category_are_stable()
    {
        Assert.Equal("HeroGauges", HeroGaugesRegistration.Slug);
        Assert.Equal("charging", HeroGaugesRegistration.Category);
        Assert.Equal("Charging statistics", HeroGaugesRegistration.Name(Localizer));
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

    private static RepositoryResult<ChargingStats> Loaded(ChargingStats stats) =>
        RepositoryResult<ChargingStats>.Loaded(stats, Now);

    private static HeroGaugesViewModel NewViewModel(params RepositoryResult<ChargingStats>[] emissions) =>
        new(new FakeHeroGaugesSource(emissions), Localizer, "$");

    private sealed class FakeHeroGaugesSource(params RepositoryResult<ChargingStats>[] emissions) : IHeroGaugesSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingStats>> StreamAsync(
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
