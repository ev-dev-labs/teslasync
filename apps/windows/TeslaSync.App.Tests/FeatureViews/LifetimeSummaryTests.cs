using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the LifetimeSummary's UI-thread-free logic — the charging-sessions JSON reduction
/// adapter (the web Cost-Analysis page <c>coreStats</c> / <c>lifetimeMetrics</c> memos), the seven-metric
/// projection (labels, formatted values and Narrator names), the cache-then-network result mapper, the
/// registration metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx).
/// </summary>
public sealed class LifetimeSummaryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Reduction adapter ---------------------------------------------------------

    [Fact]
    public void FromSessionsJson_reduces_the_lifetime_aggregates()
    {
        const string json = """
        [
          { "total_energy_added_wh": 30000, "cost_decimal": 12.5,
            "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T10:30:00Z" },
          { "total_energy_added_wh": 20000, "cost_decimal": 7.5,
            "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T11:00:00Z" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(20.0, stats.TotalCost);          // Σ cost_decimal
        Assert.Equal(50.0, stats.TotalEnergyKwh);     // Σ total_energy_added_wh / 1000 (convertEnergyFromSI)
        Assert.Equal(90, stats.TotalDurationMin);     // 30 + 60 min
        Assert.Equal(0, stats.FreeSessions);          // both cost > 0
        Assert.Equal(0, stats.FreeEnergyWh);
    }

    [Fact]
    public void FromSessionsJson_counts_free_sessions_and_keeps_free_energy_in_raw_wh()
    {
        // web: free = !cost_decimal || cost_decimal === 0; a null cost counts as free. freeEnergy sums the raw
        // total_energy_added_wh (Wh) yet the grid labels it "kWh" — reproduced verbatim (do not divide).
        const string json = """
        [
          { "total_energy_added_wh": 10000, "cost_decimal": 5.0 },
          { "total_energy_added_wh": 8000, "cost_decimal": 0 },
          { "total_energy_added_wh": 2000 }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        Assert.Equal(3, stats.TotalSessions);
        Assert.Equal(5.0, stats.TotalCost);
        Assert.Equal(20.0, stats.TotalEnergyKwh);     // 20000 Wh / 1000
        Assert.Equal(2, stats.FreeSessions);          // the zero-cost and the missing-cost rows
        Assert.Equal(10000, stats.FreeEnergyWh);      // 8000 + 2000, raw Wh (the web quirk)
    }

    [Fact]
    public void FromSessionsJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"started_at":"2026-01-01T10:00:00Z"}]""");

        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(1, stats.TotalSessions);
        Assert.Equal(0, stats.TotalCost);
        Assert.Equal(0, stats.TotalEnergyKwh);
        Assert.Equal(0, stats.TotalDurationMin);  // no ended_at -> 0
        Assert.Equal(1, stats.FreeSessions);      // missing cost -> free
        Assert.Equal(0, stats.FreeEnergyWh);
    }

    [Fact]
    public void FromSessionsJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":"15000","cost_decimal":"3.25"}]""");

        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        Assert.Equal(15.0, stats.TotalEnergyKwh);
        Assert.Equal(3.25, stats.TotalCost);
        Assert.Equal(0, stats.FreeSessions);
    }

    [Fact]
    public void FromSessionsJson_ignores_non_positive_and_missing_durations()
    {
        // session 1: ended before started -> 0; session 2: 15 min.
        const string json = """
        [
          { "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T09:30:00Z", "cost_decimal": 1 },
          { "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T10:15:00Z", "cost_decimal": 2 }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(15, stats.TotalDurationMin);  // 0 + 15
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_empty_array()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.TotalSessions);
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total":3}""");
        Assert.False(LifetimeSummaryStats.FromSessionsJson(doc.RootElement).HasData);
    }

    // ---- Projection (cached -> projection) -----------------------------------------

    [Fact]
    public void Project_builds_the_seven_metrics_with_values_and_a11y()
    {
        var stats = new LifetimeSummaryStats(2, 20.0, 50.0, 90, 0, 0);

        var view = LifetimeSummaryProjection.Project(stats, "$", Localizer);

        Assert.Equal(7, view.Metrics.Count);
        Assert.True(view.HasData);

        Assert.Equal("Total Spent", view.Metrics[0].Label);
        Assert.Equal("$20.00", view.Metrics[0].Value);
        Assert.Equal("Total Spent: $20.00", view.Metrics[0].AutomationName);

        Assert.Equal("Total Energy", view.Metrics[1].Label);
        Assert.Equal("50.0 kWh", view.Metrics[1].Value);

        Assert.Equal("Total Sessions", view.Metrics[2].Label);
        Assert.Equal("2", view.Metrics[2].Value);

        Assert.Equal("Avg Session Cost", view.Metrics[3].Label);
        Assert.Equal("$10.00", view.Metrics[3].Value);   // 20 / 2

        Assert.Equal("Avg Energy / Session", view.Metrics[4].Label);
        Assert.Equal("25.0 kWh", view.Metrics[4].Value); // 50 / 2

        Assert.Equal("Avg Duration", view.Metrics[5].Label);
        Assert.Equal("45 min", view.Metrics[5].Value);   // 90 / 2

        Assert.Equal("Free Sessions", view.Metrics[6].Label);
        Assert.Equal("0 (0.0 kWh)", view.Metrics[6].Value);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.All(view.Metrics, m => Assert.False(string.IsNullOrWhiteSpace(m.AutomationName)));
        Assert.All(view.Metrics, m => Assert.Contains(m.Label, m.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Project_parses_then_formats_free_sessions_end_to_end()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":10000,"cost_decimal":5.0},{"total_energy_added_wh":8000,"cost_decimal":0},{"total_energy_added_wh":2000}]""");
        var stats = LifetimeSummaryStats.FromSessionsJson(doc.RootElement);

        var view = LifetimeSummaryProjection.Project(stats, "$", Localizer);

        Assert.Equal("$5.00", view.Metrics[0].Value);
        Assert.Equal("20.0 kWh", view.Metrics[1].Value);
        Assert.Equal("3", view.Metrics[2].Value);
        Assert.Equal("$1.67", view.Metrics[3].Value);    // 5 / 3
        Assert.Equal("6.7 kWh", view.Metrics[4].Value);  // 20 / 3
        Assert.Equal("0 min", view.Metrics[5].Value);
        Assert.Equal("2 (10,000.0 kWh)", view.Metrics[6].Value); // raw Wh sum, grouped, labeled kWh (web parity)
    }

    [Fact]
    public void Project_empty_summary_renders_zeroed_metrics()
    {
        var view = LifetimeSummaryProjection.Project(LifetimeSummaryStats.Empty, "$", Localizer);

        Assert.False(view.HasData);
        Assert.Equal(7, view.Metrics.Count);
        Assert.Equal("$0.00", view.Metrics[0].Value);
        Assert.Equal("0.0 kWh", view.Metrics[1].Value);
        Assert.Equal("0", view.Metrics[2].Value);
        Assert.Equal("0 (0.0 kWh)", view.Metrics[6].Value);
    }

    [Fact]
    public void Project_honours_currency_symbol()
    {
        var stats = new LifetimeSummaryStats(2, 25.0, 10.0, 30, 0, 0);

        var pounds = LifetimeSummaryProjection.Project(stats, "\u00A3", Localizer);

        Assert.Equal("\u00A325.00", pounds.Metrics[0].Value);  // £ total spent
        Assert.Equal("\u00A312.50", pounds.Metrics[3].Value);  // £ avg session cost (25 / 2)
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_reduces_payload()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000,"cost_decimal":2}]""");

        var cached = LifetimeSummaryResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1, cached.Value!.TotalSessions);

        var offline = LifetimeSummaryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, LifetimeSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, LifetimeSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, LifetimeSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeSummaryStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_seven_metrics()
    {
        using var vm = NewViewModel(Loaded(new LifetimeSummaryStats(2, 20.0, 50.0, 90, 0, 0)));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(7, vm.Display.Metrics.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        // web parity: coreStats / lifetimeMetrics resolve to null with no sessions -> the "No data" surface.
        using var vm = NewViewModel(Loaded(LifetimeSummaryStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeSummaryStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<LifetimeSummaryStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeSummaryStats>.Cached(
            new LifetimeSummaryStats(3, 30.0, 12.0, 45, 1, 5000), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeSummaryStats>.OfflineCached(
            new LifetimeSummaryStats(3, 30.0, 12.0, 45, 1, 5000),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<LifetimeSummaryStats>.Loading(),
            RepositoryResult<LifetimeSummaryStats>.Cached(new LifetimeSummaryStats(1, 5, 2, 10, 0, 0), Now, stale: false),
            RepositoryResult<LifetimeSummaryStats>.Loaded(new LifetimeSummaryStats(9, 90.0, 45.0, 180, 2, 7000), Now));
        await vm.LoadAsync();

        Assert.Equal(LifetimeSummaryState.Loaded, vm.State);
        Assert.Equal("9", vm.Display.Metrics[2].Value); // Total Sessions
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_metrics()
    {
        using var vm = NewViewModel(Loaded(new LifetimeSummaryStats(1, 20.0, 5.0, 30, 0, 0)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Metrics[0].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Metrics[0].Value, StringComparison.Ordinal);
        Assert.Equal(LifetimeSummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<LifetimeSummaryStats>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Lifetime Summary", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new LifetimeSummaryStats(1, 5, 2, 10, 0, 0)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LifetimeSummaryViewModel.State), changed);
        Assert.Contains(nameof(LifetimeSummaryViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("lifetime-summary", LifetimeSummaryRegistration.Id);
        Assert.Equal("charging", LifetimeSummaryRegistration.Category);
        Assert.Equal("LifetimeSummary", LifetimeSummaryRegistration.Slug);
        Assert.Equal("Lifetime Summary", LifetimeSummaryRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LifetimeSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LifetimeSummary", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<LifetimeSummaryStats> Loaded(LifetimeSummaryStats data) =>
        RepositoryResult<LifetimeSummaryStats>.Loaded(data, Now);

    private static LifetimeSummaryViewModel NewViewModel(params RepositoryResult<LifetimeSummaryStats>[] emissions) =>
        new(new FakeLifetimeSummarySource(emissions), Localizer, "$");

    private sealed class FakeLifetimeSummarySource(params RepositoryResult<LifetimeSummaryStats>[] emissions) : ILifetimeSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<LifetimeSummaryStats>> StreamAsync(
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
