using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the DetailedStatistics surface's UI-thread-free logic — the charging-sessions JSON
/// reduction adapter (the web Charging-History page <c>computeStats</c> / <c>computeEnhancedStats</c>), the
/// six-cell projection (labels, formatted values, accent token keys and Narrator names), the cache-then-network
/// result mapper, the registration metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-list/DetailedStatistics.tsx).
/// </summary>
public sealed class DetailedStatisticsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Reduction adapter ---------------------------------------------------------

    [Fact]
    public void FromSessionsJson_reduces_the_detailed_figures()
    {
        const string json = """
        [
          { "total_energy_added_wh": 30000, "cost_decimal": 12.5, "peak_power_w": 11000,
            "charger_type": "Supercharger V3", "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T10:30:00Z" },
          { "total_energy_added_wh": 20000, "cost_decimal": 7.5, "peak_power_w": 50000,
            "charger_type": "Supercharger V3", "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T11:00:00Z" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(45.0, stats.AvgDurationMin);          // avg(30, 60) minutes
        Assert.Equal(30.5, stats.AvgPowerKw);              // avg(11kW, 50kW)
        Assert.Equal("Supercharger V3", stats.TopChargerType);
        Assert.Equal(2, stats.TopChargerCount);
        Assert.Equal(20.0, stats.TotalCost);               // Σ cost_decimal
        Assert.Equal(0.4, stats.AvgCostPerKwh, 10);        // 20 / (50000 Wh / 1000)
    }

    [Fact]
    public void FromSessionsJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"started_at":"2026-01-01T10:00:00Z"}]""");

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(1, stats.TotalSessions);
        Assert.Equal(0, stats.AvgPowerKw);
        Assert.Equal(0, stats.AvgCostPerKwh);   // no energy added -> 0 (web totalEnergy > 0 guard)
        Assert.Equal(0, stats.AvgDurationMin);  // no ended_at -> 0
        Assert.Equal(0, stats.TotalCost);
        Assert.Equal("AC/Home", stats.TopChargerType); // null charger_type -> 'AC/Home'
        Assert.Equal(1, stats.TopChargerCount);
    }

    [Fact]
    public void FromSessionsJson_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":"15000","peak_power_w":"7000","cost_decimal":"3.25"}]""");

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.Equal(7.0, stats.AvgPowerKw);
        Assert.Equal(3.25, stats.TotalCost);
        Assert.Equal(3.25 / 15.0, stats.AvgCostPerKwh, 10); // 3.25 / (15000 Wh / 1000)
    }

    [Fact]
    public void FromSessionsJson_excludes_zero_power_and_non_positive_durations()
    {
        // session 1: ended before started -> 0 min; peak 0 -> excluded from the power average.
        // session 2: 15 min; 7 kW counts.
        const string json = """
        [
          { "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T09:30:00Z", "peak_power_w": 0, "charger_type": "Home" },
          { "started_at": "2026-01-02T10:00:00Z", "ended_at": "2026-01-02T10:15:00Z", "peak_power_w": 7000, "charger_type": "DC Fast" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.Equal(2, stats.TotalSessions);
        Assert.Equal(7.0, stats.AvgPowerKw);      // Σ(7kW) / max(withPower=1, 1) -- the 0-power session is excluded
        Assert.Equal(7.5, stats.AvgDurationMin);  // avg(0, 15)
        // Tie on count(1 each): the first-seen type ("Home") wins (web stable descending sort).
        Assert.Equal("Home", stats.TopChargerType);
        Assert.Equal(1, stats.TopChargerCount);
    }

    [Fact]
    public void FromSessionsJson_picks_the_most_common_charger_type()
    {
        const string json = """
        [
          { "charger_type": "Home" },
          { "charger_type": "Supercharger" },
          { "charger_type": "Supercharger" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.Equal("Supercharger", stats.TopChargerType);
        Assert.Equal(2, stats.TopChargerCount);
    }

    [Fact]
    public void FromSessionsJson_treats_a_blank_charger_type_as_ac_home()
    {
        using var doc = JsonDocument.Parse("""[{"charger_type":""}]""");

        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        Assert.Equal("AC/Home", stats.TopChargerType);
        Assert.Equal(1, stats.TopChargerCount);
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_empty_array()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.TotalSessions);
    }

    [Fact]
    public void FromSessionsJson_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total":3}""");
        Assert.False(ChargingDetailedStats.FromSessionsJson(doc.RootElement).HasData);
    }

    // ---- FormatDuration (web formatDurationMinutes) --------------------------------

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(45, "45m")]
    [InlineData(90, "1h 30m")]
    [InlineData(125.4, "2h 5m")]
    [InlineData(90.5, "1h 31m")]   // remainder rounds half-up (30.5 -> 31), web Math.round
    [InlineData(59.6, "60m")]      // web parity quirk: minute part rounds to 60 within a 0-hour span
    public void FormatDuration_matches_the_web_clock_string(double minutes, string expected) =>
        Assert.Equal(expected, DetailedStatisticsProjection.FormatDuration(minutes));

    [Fact]
    public void FormatDuration_falls_back_to_an_em_dash_for_invalid_input()
    {
        Assert.Equal("\u2014", DetailedStatisticsProjection.FormatDuration(-1));
        Assert.Equal("\u2014", DetailedStatisticsProjection.FormatDuration(double.NaN));
        Assert.Equal("\u2014", DetailedStatisticsProjection.FormatDuration(double.PositiveInfinity));
    }

    // ---- Projection (cells, accents, a11y) -----------------------------------------

    [Fact]
    public void Project_builds_the_six_cells_with_values_accents_and_a11y()
    {
        var stats = new ChargingDetailedStats(2, 45, 30.5, "Supercharger V3", 2, 20, 0.4);

        var view = DetailedStatisticsProjection.Project(stats, "$", Localizer);

        Assert.Equal(6, view.Cells.Count);
        Assert.True(view.HasData);
        Assert.Equal("Detailed Statistics", view.Title);

        Assert.Equal("Total Sessions", view.Cells[0].Label);
        Assert.Equal("2", view.Cells[0].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentPrimary, view.Cells[0].AccentBrushKey);
        Assert.Equal("Total Sessions: 2", view.Cells[0].AutomationName);

        Assert.Equal("Avg Duration", view.Cells[1].Label);
        Assert.Equal("45m", view.Cells[1].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentPrimary, view.Cells[1].AccentBrushKey);

        Assert.Equal("Avg Power", view.Cells[2].Label);
        Assert.Equal("30.50 kW", view.Cells[2].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentPower, view.Cells[2].AccentBrushKey);

        Assert.Equal("Top Charger (2\u00D7)", view.Cells[3].Label);
        Assert.Equal("Supercharger V3", view.Cells[3].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentPrimary, view.Cells[3].AccentBrushKey);

        Assert.Equal("Total Cost", view.Cells[4].Label);
        Assert.Equal("$20.00", view.Cells[4].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentCost, view.Cells[4].AccentBrushKey);

        Assert.Equal("Avg $/kWh", view.Cells[5].Label);
        Assert.Equal("$0.400", view.Cells[5].Value);
        Assert.Equal(DetailedStatisticsProjection.AccentCostPerKwh, view.Cells[5].AccentBrushKey);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.All(view.Cells, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.All(view.Cells, c => Assert.Contains(c.Label, c.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Project_parses_then_formats_end_to_end()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12345,"peak_power_w":7000,"cost_decimal":3.2,"charger_type":"CCS","started_at":"2026-01-01T10:00:00Z","ended_at":"2026-01-01T10:20:00Z"}]""");
        var stats = ChargingDetailedStats.FromSessionsJson(doc.RootElement);

        var view = DetailedStatisticsProjection.Project(stats, "$", Localizer);

        Assert.Equal("1", view.Cells[0].Value);
        Assert.Equal("20m", view.Cells[1].Value);
        Assert.Equal("7.00 kW", view.Cells[2].Value);
        Assert.Equal("CCS", view.Cells[3].Value);
        Assert.Equal("Top Charger (1\u00D7)", view.Cells[3].Label);
        Assert.Equal("$3.20", view.Cells[4].Value);
        Assert.Equal("$0.259", view.Cells[5].Value); // 3.2 / 12.345 -> 0.2592 -> 0.259 at 3 dp
    }

    [Fact]
    public void Project_empty_summary_renders_zeroed_cells_not_a_blank_grid()
    {
        var view = DetailedStatisticsProjection.Project(ChargingDetailedStats.Empty, "$", Localizer);

        Assert.False(view.HasData);
        Assert.Equal(6, view.Cells.Count); // web parity: the grid is always six cells, never hidden

        Assert.Equal("0", view.Cells[0].Value);
        Assert.Equal("0m", view.Cells[1].Value);
        Assert.Equal("0.00 kW", view.Cells[2].Value);

        // No sessions -> no top charger: an em-dash value and a count-free label, never a blank box.
        Assert.Equal("\u2014", view.Cells[3].Value);
        Assert.Equal("Top Charger", view.Cells[3].Label);

        Assert.Equal("$0.00", view.Cells[4].Value);
        Assert.Equal("$0.000", view.Cells[5].Value);
    }

    [Fact]
    public void Project_honours_the_currency_symbol()
    {
        var stats = new ChargingDetailedStats(1, 10, 5, "Home", 1, 12.5, 0.5);

        var pounds = DetailedStatisticsProjection.Project(stats, "\u00A3", Localizer);

        Assert.Equal("\u00A312.50", pounds.Cells[4].Value);
        Assert.Equal("\u00A30.500", pounds.Cells[5].Value);
    }

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => DetailedStatisticsProjection.Project(null!, "$", Localizer));
        Assert.Throws<ArgumentNullException>(
            () => DetailedStatisticsProjection.Project(ChargingDetailedStats.Empty, "$", null!));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_reduces_payload()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000,"charger_type":"Home"}]""");

        var cached = DetailedStatsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1, cached.Value!.TotalSessions);

        var offline = DetailedStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, DetailedStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DetailedStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DetailedStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailedStats>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cells()
    {
        using var vm = NewViewModel(Loaded(new ChargingDetailedStats(2, 45, 30.5, "Supercharger V3", 2, 20, 0.4)));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cells.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty_but_keeps_cells()
    {
        using var vm = NewViewModel(Loaded(ChargingDetailedStats.Empty));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Empty, vm.State);
        Assert.False(vm.HasData);
        // The six cells still render their zeroed / em-dash values (web parity, never a blank box).
        Assert.Equal(6, vm.Display.Cells.Count);
        Assert.Equal("0", vm.Display.Cells[0].Value);
        Assert.Equal("\u2014", vm.Display.Cells[3].Value);
        Assert.Equal("$0.00", vm.Display.Cells[4].Value);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailedStats>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingDetailedStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailedStats>.Cached(
            new ChargingDetailedStats(3, 12, 9, "Home", 3, 6, 0.2), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailedStats>.OfflineCached(
            new ChargingDetailedStats(3, 12, 9, "Home", 3, 6, 0.2),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingDetailedStats>.Loading(),
            RepositoryResult<ChargingDetailedStats>.Cached(new ChargingDetailedStats(1, 1, 1, "Home", 1, 1, 1), Now, stale: false),
            RepositoryResult<ChargingDetailedStats>.Loaded(new ChargingDetailedStats(9, 30, 40, "Supercharger", 9, 99, 0.5), Now));
        await vm.LoadAsync();

        Assert.Equal(DetailedStatisticsState.Loaded, vm.State);
        Assert.Equal("9", vm.Display.Cells[0].Value);
        Assert.Equal("Supercharger", vm.Display.Cells[3].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_cells()
    {
        using var vm = NewViewModel(Loaded(new ChargingDetailedStats(1, 10, 5, "Home", 1, 20, 0.5)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Cells[4].Value, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u00A3"; // £
        Assert.StartsWith("\u00A3", vm.Display.Cells[4].Value, StringComparison.Ordinal);
        Assert.StartsWith("\u00A3", vm.Display.Cells[5].Value, StringComparison.Ordinal);
        Assert.Equal(DetailedStatisticsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingDetailedStats>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Detailed Statistics", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new ChargingDetailedStats(1, 1, 1, "Home", 1, 1, 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DetailedStatisticsViewModel.State), changed);
        Assert.Contains(nameof(DetailedStatisticsViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("detailed-statistics", DetailedStatisticsRegistration.Id);
        Assert.Equal("charging", DetailedStatisticsRegistration.Category);
        Assert.Equal("DetailedStatistics", DetailedStatisticsRegistration.Slug);
        Assert.Equal("Detailed Statistics", DetailedStatisticsRegistration.Name(Localizer));
        Assert.False(string.IsNullOrEmpty(DetailedStatisticsRegistration.TrendingUpGlyph));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DetailedStatisticsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DetailedStatistics", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_figures()
    {
        var lines = new List<string>();
        var diagnostics = new DetailedStatisticsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.Equal("view.opened slug=DetailedStatistics", line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain("kW", line, StringComparison.Ordinal);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<ChargingDetailedStats> Loaded(ChargingDetailedStats data) =>
        RepositoryResult<ChargingDetailedStats>.Loaded(data, Now);

    private static DetailedStatisticsViewModel NewViewModel(params RepositoryResult<ChargingDetailedStats>[] emissions) =>
        new(new FakeDetailedStatisticsSource(emissions), Localizer, "$", () => Now);

    private sealed class FakeDetailedStatisticsSource(params RepositoryResult<ChargingDetailedStats>[] emissions)
        : IDetailedStatisticsSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingDetailedStats>> StreamAsync(
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
