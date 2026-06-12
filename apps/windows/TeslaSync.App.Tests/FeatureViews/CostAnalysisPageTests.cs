using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>CostAnalysisPage</c>'s UI-thread-free logic — the charging-session
/// JSON parse adapter, the three chart aggregations ported from web <c>useCostAnalysisData</c> (monthly
/// buckets, the per-session cost-per-kWh trend and the charger-type breakdown), the cache-then-network result
/// mapper, the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline), the four page-level i18n keys, the registration metadata and the diagnostics. Mirrors the web
/// spec (web/src/features/charging/pages/CostAnalysisPage.tsx + components/cost-analysis/useCostAnalysisData.ts).
/// </summary>
public sealed class CostAnalysisPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every page-level literal the page renders (web key names) — parity string coverage.</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "costAnalysis.title",
        "costAnalysis.subtitle",
        "costAnalysis.empty.title",
        "costAnalysis.empty.message",
    ];

    private static CostAnalysisSession Session(
        string? startedAt,
        double? cost,
        double energyWh,
        string? chargerType = null,
        double? peakPowerW = null,
        string? startPlace = null) =>
        new(
            startedAt is null ? null : DateTimeOffset.Parse(startedAt, System.Globalization.CultureInfo.InvariantCulture),
            cost,
            energyWh,
            chargerType,
            peakPowerW,
            startPlace);

    private static IReadOnlyList<CostAnalysisSession> Sessions(params CostAnalysisSession[] sessions) => sessions;

    private static IReadOnlyList<CostAnalysisSession> Sample() => Sessions(
        Session("2026-01-10T12:00:00Z", 10, 50_000, "Tesla Supercharger V3"),
        Session("2026-01-20T12:00:00Z", 5, 30_000, peakPowerW: 50_000),
        Session("2026-02-05T12:00:00Z", 20, 90_000, startPlace: "Office garage"));

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        const string json = """
        {"started_at":"2026-01-10T08:30:00Z","cost_decimal":12.5,"total_energy_added_wh":48000,
         "charger_type":"Tesla Supercharger","peak_power_w":150000,"start_place":"Home"}
        """;
        using var doc = JsonDocument.Parse(json);

        var session = CostAnalysisSession.FromJson(doc.RootElement);

        Assert.NotNull(session.StartedAt);
        Assert.Equal(2026, session.StartedAt!.Value.Year);
        Assert.Equal(1, session.StartedAt.Value.Month);
        Assert.Equal(12.5, session.CostDecimal);
        Assert.Equal(48000, session.EnergyAddedWh);
        Assert.Equal("Tesla Supercharger", session.ChargerType);
        Assert.Equal(150000, session.PeakPowerW);
        Assert.Equal("Home", session.StartPlace);
        Assert.Equal("2026-01", session.MonthKey);
    }

    [Fact]
    public void ParseList_reads_array_and_skips_non_objects()
    {
        const string json = """
        [{"started_at":"2026-01-10T00:00:00Z","cost_decimal":3,"total_energy_added_wh":10000}, 7, "x", null]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = CostAnalysisSession.ParseList(doc.RootElement);

        Assert.Single(list);
        Assert.Equal(3, list[0].CostDecimal);
    }

    [Fact]
    public void FromJson_is_null_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"cost_decimal":null,"started_at":"not-a-date"}""");

        var session = CostAnalysisSession.FromJson(doc.RootElement);

        Assert.Null(session.StartedAt);
        Assert.Null(session.CostDecimal);
        Assert.Equal(0, session.EnergyAddedWh);
        Assert.Null(session.MonthKey);
    }

    // ---- Aggregator: monthly buckets -----------------------------------------------

    [Fact]
    public void Aggregator_builds_monthly_buckets_sorted_by_month()
    {
        var charts = CostAnalysisAggregator.Build(Sample());

        var rows = charts.MonthlyTable.Data;
        Assert.Equal(2, rows.Count);

        Assert.Equal("2026-01", rows[0].Month);
        Assert.Equal(15, rows[0].Cost);          // 10 + 5
        Assert.Equal(80, rows[0].Energy);         // (50000 + 30000) / 1000 kWh
        Assert.Equal(2, rows[0].Sessions);
        Assert.Equal(15.0 / 80.0, rows[0].AvgCostPerKwh, 6);

        Assert.Equal("2026-02", rows[1].Month);
        Assert.Equal(20, rows[1].Cost);
        Assert.Equal(90, rows[1].Energy);

        // Monthly area-chart points mirror the table rows.
        Assert.Equal(2, charts.Monthly.Data.Count);
        Assert.Equal("2026-01", charts.Monthly.Data[0].Month);
        Assert.Equal(15, charts.Monthly.Data[0].Cost);
    }

    [Fact]
    public void Aggregator_monthly_gas_equivalent_uses_web_defaults()
    {
        var charts = CostAnalysisAggregator.Build(Sessions(
            Session("2026-03-01T12:00:00Z", 4, 33_700))); // 33.7 kWh == exactly one gallon-equivalent

        var row = Assert.Single(charts.MonthlyTable.Data);
        // gasEquiv = (33.7 / 33.7) * 3.5 == 3.5 ; savings = 3.5 - 4
        Assert.Equal(3.5, row.GasEquiv, 6);
        Assert.Equal(3.5 - 4, row.Savings, 6);
    }

    // ---- Aggregator: cost-per-kWh trend --------------------------------------------

    [Fact]
    public void Aggregator_builds_cost_per_kwh_trend_sorted_by_start()
    {
        var charts = CostAnalysisAggregator.Build(Sessions(
            Session("2026-02-05T12:00:00Z", 20, 90_000),
            Session("2026-01-10T12:00:00Z", 10, 50_000),
            Session("2026-01-15T12:00:00Z", null, 30_000),     // dropped: no cost
            Session("2026-01-16T12:00:00Z", 4, 0)));           // dropped: no energy

        var points = charts.CostPerKwh.Points;
        Assert.Equal(2, points.Count);
        // Sorted ascending by start; costPerKwh = cost / (wh / 1000).
        Assert.Equal(10.0 / 50.0, points[0].CostPerKwh, 6);
        Assert.Equal(20.0 / 90.0, points[1].CostPerKwh, 6);
        Assert.False(charts.CostPerKwh.Loading);
    }

    // ---- Aggregator: charger-type breakdown ----------------------------------------

    [Fact]
    public void Aggregator_builds_charger_type_breakdown_sorted_by_cost()
    {
        var charts = CostAnalysisAggregator.Build(Sessions(
            Session("2026-01-01T12:00:00Z", 5, 10_000),                                   // Home
            Session("2026-01-02T12:00:00Z", 30, 60_000, "Tesla Supercharger"),            // Supercharger
            Session("2026-01-03T12:00:00Z", 20, 40_000, peakPowerW: 50_000),              // Public DC
            Session("2026-01-04T12:00:00Z", 10, 20_000, startPlace: "Office")));          // Work / L2

        var items = charts.ChargerType.Items;
        Assert.Equal(4, items.Count);
        Assert.Equal(65, charts.ChargerType.TotalCost);
        Assert.Equal("Supercharger", items[0].Name);
        Assert.Equal(30, items[0].Cost);
        Assert.Equal("Public DC", items[1].Name);
        Assert.Equal("Work / L2", items[2].Name);
        Assert.Equal("Home", items[3].Name);
        Assert.Equal(60, items[0].EnergyKwh); // 60000 Wh -> 60 kWh
    }

    [Theory]
    [InlineData("Tesla Supercharger", null, null, "Supercharger")]
    [InlineData("supercharger v2", null, null, "Supercharger")]
    [InlineData(null, 30000.0, null, "Public DC")]
    [InlineData(null, 5000.0, "Work parking", "Work / L2")]
    [InlineData(null, 5000.0, "the office", "Work / L2")]
    [InlineData(null, 5000.0, "Driveway", "Home")]
    [InlineData(null, null, null, "Home")]
    public void Aggregator_categorizes_chargers(string? chargerType, double? peakPowerW, string? startPlace, string expected)
    {
        var session = Session("2026-01-01T12:00:00Z", 1, 1000, chargerType, peakPowerW, startPlace);
        Assert.Equal(expected, CostAnalysisAggregator.CategorizeCharger(session));
    }

    [Fact]
    public void Aggregator_empty_sessions_yields_empty_charts()
    {
        var charts = CostAnalysisAggregator.Build(Array.Empty<CostAnalysisSession>());

        Assert.Empty(charts.Monthly.Data);
        Assert.Empty(charts.MonthlyTable.Data);
        Assert.Empty(charts.CostPerKwh.Points);
        Assert.Empty(charts.ChargerType.Items);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"cost_decimal":3,"total_energy_added_wh":10000,"started_at":"2026-01-01T00:00:00Z"}]""");

        var cached = CostAnalysisResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var empty = CostAnalysisResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, empty.Status);

        var error = CostAnalysisResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, error.Status);
    }

    // ---- View-model state matrix (loading / empty / error / success) ----------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Loading, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_loaded_with_sessions_renders_success()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal(3, vm.SessionCount);
        Assert.Equal(2, vm.Charts.MonthlyTable.Data.Count);
        Assert.NotEmpty(vm.Charts.ChargerType.Items);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_session_list_renders_empty()
    {
        // Web parity: a loaded-but-session-less snapshot collapses to the page-level empty state.
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loaded(
            Array.Empty<CostAnalysisSession>(), Now));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Empty, vm.State);
        Assert.False(vm.HasContent);
        Assert.Equal(0, vm.SessionCount);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Empty, vm.State);
        Assert.False(vm.HasContent);
        Assert.Equal("No Charging Data", vm.Display.EmptyTitle);
        Assert.Equal("Start charging your vehicle to see cost analysis and savings trends.", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_error()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loading(),
            RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Cached(Sample(), Now, stale: false),
            RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Loaded, vm.State);
        Assert.Equal(3, vm.SessionCount);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_charts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loaded(Sample(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostAnalysisPageViewModel.State), changed);
        Assert.Contains(nameof(CostAnalysisPageViewModel.Charts), changed);
    }

    // ---- Strings / projection ------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        CostAnalysisProjection.Project(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_uses_web_fallbacks()
    {
        var display = CostAnalysisProjection.Project(Localizer);

        Assert.Equal("Cost Analysis", display.Title);
        Assert.Equal("Electricity cost trends, gas savings, and charging economics", display.Subtitle);
        Assert.Equal("No Charging Data", display.EmptyTitle);
        Assert.Equal("Start charging your vehicle to see cost analysis and savings trends.", display.EmptyMessage);
    }

    [Fact]
    public void ViewModel_title_and_subtitle_resolve_through_i18n()
    {
        using var vm = NewViewModel();

        Assert.Equal("Cost Analysis", vm.Title);
        Assert.Contains("gas savings", vm.Subtitle, StringComparison.Ordinal);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_web_route()
    {
        Assert.Equal("CostAnalysis", CostAnalysisRegistration.RouteName);
        Assert.Equal("CostAnalysisPage", CostAnalysisRegistration.Slug);
        Assert.Equal("Cost Analysis", CostAnalysisRegistration.Title(Localizer));
        Assert.Contains("charging economics", CostAnalysisRegistration.Subtitle(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostAnalysisDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostAnalysisPage", Assert.Single(lines));
    }

    [Fact]
    public async Task Empty_source_yields_empty_result()
    {
        using var vm = new CostAnalysisPageViewModel(EmptyCostAnalysisSessionsSource.Instance, Localizer, clock: () => Now);
        await vm.LoadAsync();

        Assert.Equal(CostAnalysisState.Empty, vm.State);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CostAnalysisPageViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<CostAnalysisSession>>[] emissions) =>
        new(new FakeCostAnalysisSource(emissions), Localizer, clock: () => Now);

    private sealed class FakeCostAnalysisSource(params RepositoryResult<IReadOnlyList<CostAnalysisSession>>[] emissions)
        : ICostAnalysisSessionsSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<CostAnalysisSession>>> StreamAsync(
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
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
