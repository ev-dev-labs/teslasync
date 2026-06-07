using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the ChargeCostTrackerWidget's UI-thread-free logic — the charging-session
/// JSON parse adapter, the 30-day window + 100-session cap, the SI→display cost math (the native port of
/// the web <c>computeMetrics</c> + <c>useFormatting</c> helpers, including the reproduced miles-as-metres
/// quirk), the projection into tiles/compact/footer for each footprint, the cache-then-network result
/// mapper, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx).
/// </summary>
public sealed class ChargeCostTrackerWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static ChargeCostTrackerSession Session(double daysAgo, double energyWh, double? cost = null) =>
        new(Now.AddDays(-daysAgo), energyWh, cost);

    private static ChargeCostTrackerSettings GasSettings() =>
        ChargeCostTrackerSettings.Default with { GasEfficiencyMpg = 30, GasPricePerUnit = 3.5 };

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"started_at":"2026-06-01T08:00:00Z","total_energy_added_wh":12345.6,"cost":7.89}
        """);

        var s = ChargeCostTrackerSession.FromJson(doc.RootElement);

        Assert.Equal(12345.6, s.EnergyAddedWh);
        Assert.Equal(7.89, s.Cost);
        Assert.Equal(new DateTimeOffset(2026, 6, 1, 8, 0, 0, TimeSpan.Zero), s.StartedAt);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":1}""");

        var s = ChargeCostTrackerSession.FromJson(doc.RootElement);

        Assert.Equal(0, s.EnergyAddedWh);
        Assert.Null(s.Cost);
        Assert.Null(s.StartedAt);
    }

    [Fact]
    public void ParseList_reads_array_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""
        [{"total_energy_added_wh":1000}, 42, {"total_energy_added_wh":2000,"cost":3}]
        """);

        var list = ChargeCostTrackerSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1000, list[0].EnergyAddedWh);
        Assert.Equal(3, list[1].Cost);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(ChargeCostTrackerSession.ParseList(doc.RootElement));
    }

    // ---- Size / footprint flags (web isCompact / isTall) ---------------------------

    [Theory]
    [InlineData(1, 1, true, false)]   // compact
    [InlineData(1, 2, false, true)]   // min footprint (1x2) — tall, not compact
    [InlineData(2, 2, false, true)]   // default — tall
    [InlineData(2, 1, false, false)]  // short, two-up — neither
    [InlineData(4, 40, false, true)]  // max — tall
    public void Size_flags_match_web(int cols, int rows, bool compact, bool tall)
    {
        var size = new ChargeCostTrackerSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(tall, size.IsTall);
    }

    // ---- ComputeMetrics (web computeMetrics + useFormatting) ------------------------

    [Fact]
    public void ComputeMetrics_estimates_cost_from_kwh_when_no_session_cost()
    {
        var sessions = new[] { Session(5, 10_000), Session(10, 10_000) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.Equal(20, m.TotalKwh, 6);
        Assert.Equal(2.4, m.TotalCost, 6);          // 20 kWh * $0.12
        Assert.Equal(2, m.SessionCount);
        Assert.Equal(70, m.TotalDistanceMi, 6);     // 20 kWh * 3.5
        Assert.True(m.HasData);
    }

    [Fact]
    public void ComputeMetrics_prefers_recorded_session_cost()
    {
        var sessions = new[] { Session(1, 10_000, cost: 15) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.Equal(10, m.TotalKwh, 6);
        Assert.Equal(15, m.TotalCost, 6);           // recorded cost, not the estimate
        Assert.Equal(1, m.SessionCount);
    }

    [Fact]
    public void ComputeMetrics_excludes_sessions_outside_the_30_day_window()
    {
        var sessions = new[] { Session(10, 10_000), Session(20, 10_000), Session(40, 10_000) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.Equal(2, m.SessionCount);            // the 40-day-old session is dropped
        Assert.Equal(20, m.TotalKwh, 6);
    }

    [Fact]
    public void ComputeMetrics_caps_at_100_most_recent_sessions()
    {
        var sessions = new List<ChargeCostTrackerSession>();
        for (int i = 0; i < 150; i++)
        {
            sessions.Add(Session(i % 25, 1_000)); // all within 30 days, 1 kWh each
        }

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.Equal(100, m.SessionCount);
        Assert.Equal(100, m.TotalKwh, 6);
    }

    [Fact]
    public void ComputeMetrics_reproduces_web_cost_per_distance_quirk()
    {
        // Web parity: totalDistanceMi (70) is fed into the metres parameter, so it is converted as metres:
        // 70 m -> 0.07 km; cost 2.4 / 0.07 = 34.2857.
        var sessions = new[] { Session(5, 10_000), Session(10, 10_000) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.NotNull(m.CostPerDistance);
        Assert.Equal(34.2857, m.CostPerDistance!.Value, 4);
    }

    [Fact]
    public void ComputeMetrics_gas_savings_null_when_unconfigured()
    {
        var sessions = new[] { Session(1, 10_000) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        Assert.Null(m.GasSavings); // default mpg/price are 0 -> estimateGasCost returns null
    }

    [Fact]
    public void ComputeMetrics_gas_savings_when_configured()
    {
        // Web parity: estimateGasCost(35) converts 35 (metres) -> miles, so the estimate is tiny and the
        // EV cost dominates, yielding a negative "savings" — reproduced verbatim from the web source.
        var sessions = new[] { Session(1, 10_000) };

        var m = ChargeCostTrackerProjection.ComputeMetrics(sessions, GasSettings(), UnitPref.Metric, Now);

        Assert.NotNull(m.GasSavings);
        Assert.Equal(-1.1975, m.GasSavings!.Value, 4);
    }

    // ---- Projection (standard / tall, metric) --------------------------------------

    [Fact]
    public void Project_standard_tall_formats_all_four_tiles_metric()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(
            new[] { Session(5, 10_000), Session(10, 10_000) }, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(
            m, ChargeCostTrackerSettings.Default, UnitPref.Metric, new ChargeCostTrackerSize(2, 2), Localizer);

        Assert.True(view.HasData);
        Assert.False(view.IsCompact);
        Assert.True(view.IsTall);

        Assert.Equal("Total Energy", view.Energy.Label);
        Assert.Equal("20.0 kWh", view.Energy.Value);
        Assert.Equal("2 sessions", view.Energy.Subtitle);

        Assert.Equal("Total Cost", view.Cost.Label);
        Assert.Equal("$2.40", view.Cost.Value);
        Assert.Equal("$0.12/kWh", view.Cost.Subtitle);

        Assert.NotNull(view.CostPerDistance);
        Assert.Equal("Cost / km", view.CostPerDistance!.Label);
        Assert.Equal("$34.286", view.CostPerDistance.Value);  // 34.2857 @ 3dp

        Assert.NotNull(view.GasSavings);
        Assert.Equal("vs Gas Savings", view.GasSavings!.Label);
        Assert.Equal("\u2014", view.GasSavings.Value);                 // unconfigured -> em dash
        Assert.Equal("Set gas price in settings", view.GasSavings.Subtitle);
    }

    [Fact]
    public void Project_imperial_uses_mile_distance_label()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(
            new[] { Session(5, 10_000), Session(10, 10_000) }, ChargeCostTrackerSettings.Default, UnitPref.Imperial, Now);

        var view = ChargeCostTrackerProjection.Project(
            m, ChargeCostTrackerSettings.Default, UnitPref.Imperial, new ChargeCostTrackerSize(2, 2), Localizer);

        Assert.Equal("Cost / mi", view.CostPerDistance!.Label);
        Assert.NotNull(m.CostPerDistance);
        Assert.Equal(55.1775, m.CostPerDistance!.Value, 3); // 2.4 / (70/1609.344)
    }

    [Fact]
    public void Project_gas_savings_tile_when_configured()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(new[] { Session(1, 10_000) }, GasSettings(), UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(
            m, GasSettings(), UnitPref.Metric, new ChargeCostTrackerSize(2, 2), Localizer);

        Assert.Equal("$-1.20", view.GasSavings!.Value);          // -1.1975 @ 2dp
        Assert.Equal("30-day estimate", view.GasSavings.Subtitle);
    }

    [Fact]
    public void Project_respects_currency_symbol()
    {
        var settings = ChargeCostTrackerSettings.Default with { CurrencySymbol = "\u20AC" };
        var m = ChargeCostTrackerProjection.ComputeMetrics(new[] { Session(1, 10_000) }, settings, UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(m, settings, UnitPref.Metric, new ChargeCostTrackerSize(2, 2), Localizer);

        Assert.StartsWith("\u20AC", view.Cost.Value, StringComparison.Ordinal);
    }

    // ---- Projection (compact) ------------------------------------------------------

    [Fact]
    public void Project_compact_shows_big_total_cost()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(
            new[] { Session(5, 10_000), Session(10, 10_000) }, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(
            m, ChargeCostTrackerSettings.Default, UnitPref.Metric, new ChargeCostTrackerSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal("$2", view.CompactValue);          // formatCurrency(2.4, 0)
        Assert.Equal("30-day cost", view.CompactLabel);
    }

    // ---- Projection (short footer) -------------------------------------------------

    [Fact]
    public void Project_short_layout_builds_footer_not_extra_tiles()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(
            new[] { Session(5, 10_000), Session(10, 10_000) }, ChargeCostTrackerSettings.Default, UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(
            m, ChargeCostTrackerSettings.Default, UnitPref.Metric, new ChargeCostTrackerSize(2, 1), Localizer);

        Assert.False(view.IsTall);
        Assert.Null(view.CostPerDistance);
        Assert.Null(view.GasSavings);
        Assert.Equal("$34.286/km", view.FooterLeft);
        Assert.Equal(string.Empty, view.FooterRight); // gas unconfigured -> no savings text
    }

    [Fact]
    public void Project_short_layout_footer_right_shows_savings_when_configured()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(new[] { Session(1, 10_000) }, GasSettings(), UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(m, GasSettings(), UnitPref.Metric, new ChargeCostTrackerSize(2, 1), Localizer);

        Assert.Equal("Saved $-1.20 vs gas", view.FooterRight);
    }

    // ---- Accessibility names -------------------------------------------------------

    [Fact]
    public void Project_tiles_have_non_empty_accessibility_names()
    {
        var m = ChargeCostTrackerProjection.ComputeMetrics(
            new[] { Session(5, 10_000) }, GasSettings(), UnitPref.Metric, Now);

        var view = ChargeCostTrackerProjection.Project(m, GasSettings(), UnitPref.Metric, new ChargeCostTrackerSize(2, 2), Localizer);

        foreach (var tile in new[] { view.Energy, view.Cost, view.CostPerDistance!, view.GasSavings! })
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
            Assert.Contains(tile.Label, tile.AutomationName, StringComparison.Ordinal);
            Assert.Contains(tile.Value, tile.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains(view.CompactLabel, view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.CompactValue, view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":5000}]""");

        var cached = ChargeCostTrackerResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = ChargeCostTrackerResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(5000, offline.Value![0].EnergyAddedWh);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");

        Assert.Equal(LoadStatus.Loaded, ChargeCostTrackerResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargeCostTrackerResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargeCostTrackerResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tiles()
    {
        using var vm = NewViewModel(Loaded(Session(1, 10_000), Session(2, 10_000)));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("20.0 kWh", vm.Display.Energy.Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_in_window_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded()); // empty list -> no sessions -> hasData false
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No charge data", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_old_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Session(45, 10_000))); // outside the 30-day window
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Cached(new[] { Session(1, 10_000) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.OfflineCached(
            new[] { Session(1, 10_000) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loading(),
            RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Cached(new[] { Session(1, 5_000) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loaded(new[] { Session(1, 10_000) }, Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeCostTrackerState.Loaded, vm.State);
        Assert.Equal("10.0 kWh", vm.Display.Energy.Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargeCostTrackerSize(2, 2), Loaded(Session(1, 10_000)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargeCostTrackerSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargeCostTrackerState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance_label()
    {
        using var vm = NewViewModel(Loaded(Session(1, 10_000)));
        await vm.LoadAsync();
        Assert.Equal("Cost / km", vm.Display.CostPerDistance!.Label);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Cost / mi", vm.Display.CostPerDistance!.Label);
    }

    [Fact]
    public async Task ViewModel_settings_change_reprojects_currency()
    {
        using var vm = NewViewModel(Loaded(Session(1, 10_000)));
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.Cost.Value, StringComparison.Ordinal);

        vm.Settings = ChargeCostTrackerSettings.Default with { CurrencySymbol = "\u00A3" }; // £
        Assert.StartsWith("\u00A3", vm.Display.Cost.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Cost Tracker", vm.Title);
        Assert.Equal("No charge data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Session(1, 10_000)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargeCostTrackerViewModel.State), changed);
        Assert.Contains(nameof(ChargeCostTrackerViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-cost-tracker", ChargeCostTrackerRegistration.Id);
        Assert.Equal("charging", ChargeCostTrackerRegistration.Category);
        Assert.Equal("ChargeCostTrackerWidget", ChargeCostTrackerRegistration.Slug);
        Assert.Equal(new ChargeCostTrackerSize(2, 2), ChargeCostTrackerRegistration.DefaultSize);
        Assert.Equal(new ChargeCostTrackerSize(1, 2), ChargeCostTrackerRegistration.MinSize);
        Assert.Equal(new ChargeCostTrackerSize(4, 40), ChargeCostTrackerRegistration.MaxSize);
        Assert.Equal("Charge Cost Tracker", ChargeCostTrackerRegistration.Name(Localizer));
        Assert.Contains("cost", ChargeCostTrackerRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargeCostTrackerRegistration.IsWithinBounds(new ChargeCostTrackerSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargeCostTrackerSize(1, 2), ChargeCostTrackerRegistration.Clamp(new ChargeCostTrackerSize(0, 0)));
        Assert.Equal(new ChargeCostTrackerSize(4, 40), ChargeCostTrackerRegistration.Clamp(new ChargeCostTrackerSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargeCostTrackerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargeCostTrackerWidget", Assert.Single(lines));
    }

    // ---- Constants (web parity) ----------------------------------------------------

    [Fact]
    public void Projection_constants_match_web()
    {
        Assert.Equal(3.5, ChargeCostTrackerProjection.AvgMiPerKwh);
        Assert.Equal(3.78541, ChargeCostTrackerProjection.GallonsToLiters);
        Assert.Equal(30, ChargeCostTrackerProjection.WindowDays);
        Assert.Equal(100, ChargeCostTrackerProjection.MaxSessions);
        Assert.Equal(0.12, ChargeCostTrackerSettings.DefaultCostPerKwh);
        Assert.Equal(30, ChargeCostTrackerRegistration.DefaultDays);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>> Loaded(params ChargeCostTrackerSession[] sessions) =>
        RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>.Loaded(sessions, Now);

    private static ChargeCostTrackerViewModel NewViewModel(params RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>[] emissions) =>
        NewViewModel(ChargeCostTrackerSize.Default, emissions);

    private static ChargeCostTrackerViewModel NewViewModel(
        ChargeCostTrackerSize size,
        params RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>[] emissions) =>
        new(new FakeChargeCostTrackerSource(emissions), Localizer, size, UnitPref.Metric, ChargeCostTrackerSettings.Default, () => Now);

    private sealed class FakeChargeCostTrackerSource(params RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>[] emissions) : IChargeCostTrackerSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargeCostTrackerSession>>> StreamAsync(
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
