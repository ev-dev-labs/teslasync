using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SummaryStatsGrid's UI-thread-free logic — the charging-sessions JSON
/// reduction adapter (the web Charging-Curve page <c>useMemo</c>), the six-card projection (labels, formatted
/// values, unit suffixes and Narrator names), the cache-then-network result mapper, the registration
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx).
/// </summary>
public sealed class SummaryStatsGridTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Reduction adapter ---------------------------------------------------------

    [Fact]
    public void FromSessionsJson_reduces_the_six_summary_figures()
    {
        const string json = """
        [
          { "total_energy_added_wh": 30000, "cost_decimal": 12.5, "peak_power_w": 11000,
            "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T10:30:00Z" },
          { "total_energy_added_wh": 20000, "cost_decimal": 7.5, "peak_power_w": 50000,
            "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T11:00:00Z" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(50000, stats.TotalEnergyWh);     // Σ total_energy_added_wh (Wh, labeled kWh by the web grid)
        Assert.Equal(20.0, stats.TotalCost);          // Σ cost_decimal
        Assert.Equal(30.5, stats.AvgRateKw);          // avg(11kW, 50kW)
        Assert.Equal(50, stats.PeakRateKw);           // max(11kW, 50kW)
        Assert.Equal(45, stats.AvgDurationMin);       // avg(30min, 60min)
    }

    [Fact]
    public void FromSessionsJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"started_at":"2026-01-01T10:00:00Z"}]""");

        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(1, stats.TotalSessions);
        Assert.Equal(0, stats.TotalEnergyWh);
        Assert.Equal(0, stats.TotalCost);
        Assert.Equal(0, stats.AvgRateKw);
        Assert.Equal(0, stats.PeakRateKw);    // max over a single 0-power session
        Assert.Equal(0, stats.AvgDurationMin); // no ended_at -> 0
    }

    [Fact]
    public void FromSessionsJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":"15000","peak_power_w":"7000","cost_decimal":"3.25"}]""");

        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);

        Assert.Equal(15000, stats.TotalEnergyWh);
        Assert.Equal(7, stats.AvgRateKw);
        Assert.Equal(7, stats.PeakRateKw);
        Assert.Equal(3.25, stats.TotalCost);
    }

    [Fact]
    public void FromSessionsJson_ignores_non_positive_and_missing_durations()
    {
        // session 1: ended before started -> 0; session 2: 15 min; null power counts as 0 in the average.
        const string json = """
        [
          { "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T09:30:00Z" },
          { "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T10:15:00Z", "peak_power_w": 7000 }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);

        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(7.5, stats.AvgDurationMin);  // avg(0, 15)
        Assert.Equal(3.5, stats.AvgRateKw);       // avg(0kW, 7kW)
        Assert.Equal(7, stats.PeakRateKw);        // max(0kW, 7kW)
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_empty_array()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.TotalSessions);
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total":3}""");
        Assert.False(ChargingSummary.FromSessionsJson(doc.RootElement).HasData);
    }

    // ---- Projection (cached -> projection) -----------------------------------------

    [Fact]
    public void Project_builds_the_six_cards_with_values_units_and_a11y()
    {
        var stats = new ChargingSummary(2, 50000, 30.5, 50, 45, 20);

        var view = SummaryStatsProjection.Project(stats, "$", SummaryStatsProjection.DefaultPrecision, Localizer);

        Assert.Equal(6, view.Cards.Count);
        Assert.True(view.HasData);

        Assert.Equal("Total Sessions", view.Cards[0].Label);
        Assert.Equal("2", view.Cards[0].Value);
        Assert.Null(view.Cards[0].Unit);
        Assert.Equal("Total Sessions: 2", view.Cards[0].AutomationName);

        Assert.Equal("Total Energy", view.Cards[1].Label);
        Assert.Equal("50,000.00", view.Cards[1].Value);   // Wh sum, labeled kWh (web parity)
        Assert.Equal("kWh", view.Cards[1].Unit);
        Assert.Equal("Total Energy: 50,000.00 kWh", view.Cards[1].AutomationName);

        Assert.Equal("Avg Charge Rate", view.Cards[2].Label);
        Assert.Equal("30.50", view.Cards[2].Value);
        Assert.Equal("kW", view.Cards[2].Unit);

        Assert.Equal("Peak Rate", view.Cards[3].Label);
        Assert.Equal("50.00", view.Cards[3].Value);
        Assert.Equal("kW", view.Cards[3].Unit);

        Assert.Equal("Avg Duration", view.Cards[4].Label);
        Assert.Equal("45", view.Cards[4].Value);
        Assert.Equal("min", view.Cards[4].Unit);

        Assert.Equal("Total Cost", view.Cards[5].Label);
        Assert.Equal("$20.00", view.Cards[5].Value);
        Assert.Null(view.Cards[5].Unit);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.All(view.Cards, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.All(view.Cards, c => Assert.Contains(c.Label, c.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Project_parses_then_formats_end_to_end()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12345,"peak_power_w":7000,"cost_decimal":3.2,"started_at":"2026-01-01T10:00:00Z","ended_at":"2026-01-01T10:20:00Z"}]""");
        var stats = ChargingSummary.FromSessionsJson(doc.RootElement);

        var view = SummaryStatsProjection.Project(stats, "$", SummaryStatsProjection.DefaultPrecision, Localizer);

        Assert.Equal("1", view.Cards[0].Value);
        Assert.Equal("12,345.00", view.Cards[1].Value);
        Assert.Equal("7.00", view.Cards[2].Value);
        Assert.Equal("7.00", view.Cards[3].Value);
        Assert.Equal("20", view.Cards[4].Value);
        Assert.Equal("$3.20", view.Cards[5].Value);
    }

    [Fact]
    public void Project_empty_summary_renders_zeroed_cards_not_a_blank_grid()
    {
        var view = SummaryStatsProjection.Project(ChargingSummary.Empty, "$", SummaryStatsProjection.DefaultPrecision, Localizer);

        Assert.False(view.HasData);
        Assert.Equal(6, view.Cards.Count); // web parity: the grid is always six cards, never hidden
        Assert.Equal("0", view.Cards[0].Value);
        Assert.Equal("0.00", view.Cards[1].Value);
        Assert.Equal("$0.00", view.Cards[5].Value);
    }

    [Fact]
    public void Project_honours_currency_symbol_and_precision()
    {
        var stats = new ChargingSummary(1, 1000, 5, 5, 10, 12.5);

        var pounds = SummaryStatsProjection.Project(stats, "\u00A3", 0, Localizer);

        Assert.Equal("1,000", pounds.Cards[1].Value);   // precision 0
        Assert.Equal("5", pounds.Cards[2].Value);
        Assert.Equal("\u00A313", pounds.Cards[5].Value); // £, precision 0, 12.5 -> 13 (half-up)
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_reduces_payload()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");

        var cached = SummaryStatsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1, cached.Value!.TotalSessions);

        var offline = SummaryStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, SummaryStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SummaryStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SummaryStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSummary>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cards()
    {
        using var vm = NewViewModel(Loaded(new ChargingSummary(2, 50000, 30.5, 50, 45, 20)));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty_but_keeps_cards()
    {
        using var vm = NewViewModel(Loaded(ChargingSummary.Empty));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        // The six cards still render their zeroed values (web parity, never a blank box).
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.Equal("0", vm.Display.Cards[0].Value);
        Assert.Equal("$0.00", vm.Display.Cards[5].Value);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSummary>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingSummary>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSummary>.Cached(
            new ChargingSummary(3, 1000, 5, 9, 12, 6), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSummary>.OfflineCached(
            new ChargingSummary(3, 1000, 5, 9, 12, 6),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingSummary>.Loading(),
            RepositoryResult<ChargingSummary>.Cached(new ChargingSummary(1, 100, 1, 1, 1, 1), Now, stale: false),
            RepositoryResult<ChargingSummary>.Loaded(new ChargingSummary(9, 90000, 40, 60, 30, 99), Now));
        await vm.LoadAsync();

        Assert.Equal(SummaryStatsState.Loaded, vm.State);
        Assert.Equal("9", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_card()
    {
        using var vm = NewViewModel(Loaded(new ChargingSummary(1, 1000, 5, 5, 10, 20)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Cards[5].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Cards[5].Value, StringComparison.Ordinal);
        Assert.Equal(SummaryStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_precision_change_reprojects_numeric_cards()
    {
        using var vm = NewViewModel(Loaded(new ChargingSummary(1, 50000, 5, 5, 10, 20)));
        await vm.LoadAsync();
        Assert.Equal("50,000.00", vm.Display.Cards[1].Value);

        vm.DecimalPrecision = 0;
        Assert.Equal("50,000", vm.Display.Cards[1].Value);
        Assert.Equal(SummaryStatsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSummary>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Charging Curve", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new ChargingSummary(1, 100, 1, 1, 1, 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SummaryStatsGridViewModel.State), changed);
        Assert.Contains(nameof(SummaryStatsGridViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("summary-stats-grid", SummaryStatsRegistration.Id);
        Assert.Equal("charging", SummaryStatsRegistration.Category);
        Assert.Equal("SummaryStatsGrid", SummaryStatsRegistration.Slug);
        Assert.Equal("Charging Curve", SummaryStatsRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SummaryStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SummaryStatsGrid", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<ChargingSummary> Loaded(ChargingSummary data) =>
        RepositoryResult<ChargingSummary>.Loaded(data, Now);

    private static SummaryStatsGridViewModel NewViewModel(params RepositoryResult<ChargingSummary>[] emissions) =>
        new(new FakeSummaryStatsSource(emissions), Localizer, "$", SummaryStatsProjection.DefaultPrecision, () => Now);

    private sealed class FakeSummaryStatsSource(params RepositoryResult<ChargingSummary>[] emissions) : ISummaryStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingSummary>> StreamAsync(
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
