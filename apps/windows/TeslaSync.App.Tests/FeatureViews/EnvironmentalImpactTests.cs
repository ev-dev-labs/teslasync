using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the EnvironmentalImpact surface's UI-thread-free logic — the charging-session JSON
/// parse adapter, the environmental core-stats derivation (ported from the web cost-analysis reduction), the
/// projection (the two green tiles, the descriptive sentence segments, the three sub-stats, their formatted
/// values, the labels and accessibility names), the cache-then-network result mapper, the registration
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx + useCostAnalysisData.ts +
/// constants.ts).
/// </summary>
public sealed class EnvironmentalImpactTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_session_fields()
    {
        const string json = """
        {
          "id": 42,
          "total_energy_added_wh": 30000,
          "cost_decimal": 12.5
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var s = EnvironmentalImpactSession.FromJson(doc.RootElement);

        Assert.Equal(42, s.Id);
        Assert.Equal(30000, s.TotalEnergyAddedWh);
        Assert.Equal(12.5, s.CostDecimal);
    }

    [Fact]
    public void ParseList_reads_array_and_preserves_order()
    {
        const string json = """
        [ {"id":1,"total_energy_added_wh":10}, {"id":2,"total_energy_added_wh":20} ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = EnvironmentalImpactSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""[ {"id":"7","total_energy_added_wh":"25000"} ]""");

        var list = EnvironmentalImpactSession.ParseList(doc.RootElement);

        Assert.Single(list);
        Assert.Equal(7, list[0].Id);
        Assert.Equal(25000, list[0].TotalEnergyAddedWh);
        Assert.Null(list[0].CostDecimal);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(EnvironmentalImpactSession.ParseList(doc.RootElement));
    }

    // ---- ComputeStats (web coreStats reduction) ------------------------------------

    [Fact]
    public void ComputeStats_returns_null_for_no_sessions()
    {
        Assert.Null(EnvironmentalImpactProjection.ComputeStats(Array.Empty<EnvironmentalImpactSession>()));
    }

    [Fact]
    public void ComputeStats_derives_the_web_envelope()
    {
        // 200 kWh + 137 kWh = 337 kWh; 337 / 33.7 == 10 gallons-equivalent.
        var sessions = new[]
        {
            Session(energyWh: 200_000, cost: 20),
            Session(energyWh: 137_000, cost: 5),
        };

        var stats = EnvironmentalImpactProjection.ComputeStats(sessions);

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.Count);
        Assert.Equal(25, stats.TotalCost, 4);
        Assert.Equal(337, stats.TotalEnergyKwh, 4);
        Assert.Equal(10, stats.GallonsEquiv, 4);            // 337 / 33.7
        Assert.Equal(35, stats.GasCost, 4);                 // 10 * 3.5
        Assert.Equal(10, stats.Savings, 4);                 // 35 - 25
        Assert.Equal(88.87, stats.Co2SavedKg, 4);           // 10 * 8.887
        Assert.Equal(88.87 / 22.0, stats.TreeEquiv, 6);     // co2 / 22
        Assert.Equal(0.08887, stats.MetricTonsCo2, 6);      // co2 / 1000
    }

    [Fact]
    public void ComputeStats_treats_missing_cost_as_zero()
    {
        var stats = EnvironmentalImpactProjection.ComputeStats(new[] { Session(energyWh: 33_700, cost: null) });

        Assert.NotNull(stats);
        Assert.Equal(0, stats!.TotalCost, 4);
        Assert.Equal(1, stats.GallonsEquiv, 4);             // 33.7 kWh / 33.7
        Assert.Equal(3.5, stats.GasCost, 4);
        Assert.Equal(3.5, stats.Savings, 4);                // gasCost - 0
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_empty_when_no_sessions()
    {
        var view = EnvironmentalImpactProjection.Project(Array.Empty<EnvironmentalImpactSession>(), Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Tiles);
        Assert.Empty(view.Stats);
        Assert.Equal(0, view.Count);
        Assert.Equal("No data", view.EmptyMessage);
    }

    [Fact]
    public void Project_builds_tiles_sentence_and_substats_with_web_formatting()
    {
        var sessions = new[]
        {
            Session(energyWh: 200_000, cost: 20),
            Session(energyWh: 137_000, cost: 5),
        };

        var view = EnvironmentalImpactProjection.Project(sessions, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(2, view.Count);

        // Two green headline tiles: fmtNumber(co2SavedKg, 1) and fmtNumber(treeEquiv, 1).
        Assert.Equal(2, view.Tiles.Count);
        Assert.Equal("88.9", view.Tiles[0].ValueText);
        Assert.Equal("kg CO\u2082 saved", view.Tiles[0].Label);
        Assert.Equal("4.0", view.Tiles[1].ValueText);
        Assert.Equal("tree-years equivalent", view.Tiles[1].Label);

        // Sentence emphases: `{fmtNumber(co2, 0)} kg` and `{fmtNumber(treeEquiv, 1)}`.
        Assert.Equal("89 kg", view.Co2Emphasis);
        Assert.Equal("4.0", view.TreeEmphasis);
        Assert.Contains("89 kg", view.DescriptionPlain, StringComparison.Ordinal);
        Assert.Contains("4.0", view.DescriptionPlain, StringComparison.Ordinal);

        // Three sub-stats: gallons fmtNumber(_, 1), metric tons fmtNumber(co2/1000, 2), savings fmtNumber(_, 0).
        Assert.Equal(3, view.Stats.Count);
        Assert.Equal("10.0", view.Stats[0].ValueText);
        Assert.Equal("gallons avoided", view.Stats[0].Label);
        Assert.Equal("0.09", view.Stats[1].ValueText);
        Assert.Equal("metric tons CO\u2082", view.Stats[1].Label);
        Assert.Equal("10", view.Stats[2].ValueText);
        Assert.Equal("$ saved total", view.Stats[2].Label);
    }

    // ---- i18n: every source label resolves through its catalog key ------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = EnvironmentalImpactProjection.Project(new[] { Session(energyWh: 200_000, cost: 20) }, echo);

        Assert.Equal("L:costAnalysis.environment.title", view.Title);
        Assert.Equal("L:costAnalysis.environment.kgCo2", view.Tiles[0].Label);
        Assert.Equal("L:costAnalysis.environment.treeEquiv", view.Tiles[1].Label);
        Assert.Equal("L:costAnalysis.environment.gallons", view.Stats[0].Label);
        Assert.Equal("L:costAnalysis.environment.metricTons", view.Stats[1].Label);
        Assert.Equal("L:costAnalysis.environment.dollarsSaved", view.Stats[2].Label);
        Assert.Equal("L:costAnalysis.environment.desc", view.DescriptionPrefix);
        Assert.Equal("L:costAnalysis.environment.ofCo2", view.OfCo2);
        Assert.Equal("L:costAnalysis.environment.treeNote", view.TreeNote);
        Assert.Equal("L:costAnalysis.environment.treesAbsorbing", view.TreesAbsorbing);
        Assert.Equal("L:costAnalysis.environment.noData", view.EmptyMessage);
    }

    // ---- a11y: every tile / stat carries a spoken name -----------------------------

    [Fact]
    public void Every_metric_carries_a_non_empty_value_label_and_automation_name()
    {
        var view = EnvironmentalImpactProjection.Project(
            new[] { Session(energyWh: 200_000, cost: 20), Session(energyWh: 137_000, cost: 5) }, Localizer);

        foreach (var m in view.Tiles.Concat(view.Stats))
        {
            Assert.False(string.IsNullOrWhiteSpace(m.ValueText));
            Assert.False(string.IsNullOrWhiteSpace(m.Label));
            Assert.False(string.IsNullOrWhiteSpace(m.AutomationName));
            Assert.Contains(m.ValueText, m.AutomationName, StringComparison.Ordinal);
            Assert.Contains(m.Label, m.AutomationName, StringComparison.Ordinal);
        }

        Assert.False(string.IsNullOrWhiteSpace(view.AriaLabel));
        Assert.Contains(view.Title, view.AriaLabel, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""[ {"id":1,"total_energy_added_wh":10,"cost_decimal":1} ]""");

        var cached = EnvironmentalImpactResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = EnvironmentalImpactResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, EnvironmentalImpactResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, EnvironmentalImpactResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, EnvironmentalImpactResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tiles_and_substats()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(energyWh: 200_000, cost: 20))));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Tiles.Count);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Array.Empty<EnvironmentalImpactSession>()));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Empty, vm.State);
        Assert.False(vm.HasData);
        // Even empty, the surface keeps the friendly message (never a blank box).
        Assert.Equal("No data", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Cached(
            Sessions(Session(energyWh: 200_000, cost: 20)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.OfflineCached(
            Sessions(Session(energyWh: 200_000, cost: 20)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loading(),
            RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Cached(
                Sessions(Session(energyWh: 100_000, cost: 5)), Now, stale: false),
            RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loaded(
                Sessions(Session(energyWh: 200_000, cost: 20)), Now));
        await vm.LoadAsync();

        Assert.Equal(EnvironmentalImpactState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Tiles.Count);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Environmental Impact", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(energyWh: 200_000, cost: 20))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnvironmentalImpactViewModel.State), changed);
        Assert.Contains(nameof(EnvironmentalImpactViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("environmental-impact", EnvironmentalImpactRegistration.Id);
        Assert.Equal("charging", EnvironmentalImpactRegistration.Category);
        Assert.Equal("EnvironmentalImpact", EnvironmentalImpactRegistration.Slug);
        Assert.Equal("Environmental Impact", EnvironmentalImpactRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnvironmentalImpactDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnvironmentalImpact", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static EnvironmentalImpactSession Session(double? energyWh, double? cost, long id = 1) =>
        new(id, energyWh, cost);

    private static IReadOnlyList<EnvironmentalImpactSession> Sessions(params EnvironmentalImpactSession[] sessions) =>
        sessions;

    private static RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>> Loaded(IReadOnlyList<EnvironmentalImpactSession> data) =>
        RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loaded(data, Now);

    private static EnvironmentalImpactViewModel NewViewModel(params RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>[] emissions) =>
        new(new FakeEnvironmentalImpactSource(emissions), Localizer);

    private sealed class FakeEnvironmentalImpactSource(params RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>[] emissions) : IEnvironmentalImpactSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>> StreamAsync(
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
