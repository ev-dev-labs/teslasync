using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WinUI <c>EnergyPage</c>'s UI-thread-free logic — the energy-stats /
/// charging-sessions / latest-live JSON parse adapters, the SI→display projection (hero gauges, quick metrics,
/// lifetime cards, cost-vs-gas comparisons, the four chart series + the charger breakdown, the sessions table),
/// the cache-then-network result mappers, the three-source state-holder view-model's per-state transitions
/// (loading / ready / error / stale / offline), the i18n key coverage, the repository-backed sources, the
/// registration metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/battery/pages/EnergyPage.tsx).
/// </summary>
public sealed class EnergyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the page renders (web key names) — parity string coverage (56).</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "common.noData",
        "energy.breakdown.sessions",
        "energy.chart.chargerBreakdown", "energy.chart.chargerBreakdown.aria",
        "energy.chart.chargingByTime", "energy.chart.chargingByTime.aria",
        "energy.chart.distance",
        "energy.chart.efficiencyTrend", "energy.chart.efficiencyTrend.aria",
        "energy.chart.energy", "energy.chart.energyCostDaily", "energy.chart.energyCostDaily.aria",
        "energy.chart.energyKwh", "energy.chart.noEfficiencyData", "energy.chart.noEnergyData",
        "energy.chart.sessions",
        "energy.cost_decimal.evCost", "energy.cost_decimal.gasEquivalent", "energy.cost_decimal.less",
        "energy.cost_decimal.periodTotal", "energy.cost_decimal.projectedAnnual", "energy.cost_decimal.saving",
        "energy.empty.hero",
        "energy.gauge.co2Saved", "energy.gauge.efficiency", "energy.gauge.energyUsed", "energy.gauge.totalCost",
        "energy.lifetime.energyUsed", "energy.lifetime.energyUsedDesc", "energy.lifetime.periodEnergy",
        "energy.lifetime.periodEnergyDesc", "energy.lifetime.title",
        "energy.metric.costPerDist", "energy.metric.costPerKwh", "energy.metric.monthlyEst",
        "energy.metric.sessions", "energy.metric.totalDistance", "energy.metric.yearlyEst",
        "energy.pageSubtitle", "energy.pageTitle",
        "energy.sessions.empty", "energy.sessions.title",
        "energy.table.battery", "energy.table.cost_decimal", "energy.table.date", "energy.table.energy",
        "energy.table.perKwh", "energy.table.power", "energy.table.type",
        "energy.timeOfDay.afternoon", "energy.timeOfDay.evening", "energy.timeOfDay.morning",
        "energy.timeOfDay.night",
        "energy.tip.offPeak", "energy.tip.solar",
        "energy.title",
    ];

    private static EnergyDailyPoint[] SampleDaily() =>
    [
        new("2026-05-01", 18_000, 0.16, 110_000),
        new("2026-05-02", 22_000, 0.18, 120_000),
        new("2026-05-03", 12_000, 0.15, 80_000),
    ];

    private static EnergyStats SampleStats() => new(
        TotalWh: 52_000,
        TotalEnergyUsedWh: 50_000,
        TotalDistanceM: 310_000,
        AvgEfficiencyWhPerM: 0.18,
        Co2SavedKg: 21,
        DailyBreakdown: SampleDaily());

    private static IReadOnlyList<EnergyChargingSession> SampleSessions() =>
    [
        new(1, new DateTimeOffset(2026, 5, 1, 2, 0, 0, TimeSpan.Zero), 30_000, 6.5, 20, 80, 150_000, "Tesla Supercharger"),
        new(2, new DateTimeOffset(2026, 5, 2, 14, 0, 0, TimeSpan.Zero), 18_000, 3.2, 40, 70, 50_000, "CCS"),
        new(3, new DateTimeOffset(2026, 5, 3, 20, 0, 0, TimeSpan.Zero), 10_000, 1.1, 55, 90, 7_000, null),
    ];

    private static EnergyDisplay Project(
        EnergyStats? stats = null,
        IReadOnlyList<EnergyChargingSession>? sessions = null,
        EnergyLiveCharging? live = null,
        UnitPref? units = null,
        string symbol = "$",
        ILocalizer? localizer = null) =>
        EnergyProjection.Project(
            stats ?? SampleStats(),
            sessions ?? SampleSessions(),
            live ?? new EnergyLiveCharging(1234),
            units ?? UnitPref.Metric,
            symbol,
            EnergyPageViewModel.DefaultPrecision,
            localizer ?? Localizer);

    // ---- Parse adapters ------------------------------------------------------------

    [Fact]
    public void Stats_FromJson_reads_snake_case_fields_and_daily_breakdown()
    {
        const string json = """
        {"total_wh":52000,"total_energy_used_wh":50000,"total_distance_m":310000,
         "avg_efficiency_wh_per_m":0.18,"co2_saved_kg":21.0,"daily_breakdown":[
           {"date":"2026-05-01","energy_wh":18000,"efficiency_wh_per_m":0.16,"distance_m":110000},
           {"date":"2026-05-02","energy_wh":22000,"efficiency_wh_per_m":0.18,"distance_m":120000}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = EnergyStats.FromJson(doc.RootElement);

        Assert.Equal(52000, stats.TotalWh);
        Assert.Equal(50000, stats.TotalEnergyUsedWh);
        Assert.Equal(310000, stats.TotalDistanceM);
        Assert.Equal(0.18, stats.AvgEfficiencyWhPerM);
        Assert.Equal(21.0, stats.Co2SavedKg);
        Assert.Equal(2, stats.DailyBreakdown.Count);
        Assert.Equal("2026-05-02", stats.DailyBreakdown[1].Date);
        Assert.Equal(22000, stats.DailyBreakdown[1].EnergyWh);
        Assert.False(stats.HasNoData);
    }

    [Fact]
    public void Stats_FromJson_is_tolerant_and_flags_no_data()
    {
        using var doc = JsonDocument.Parse("""{"total_wh":0}""");
        var stats = EnergyStats.FromJson(doc.RootElement);

        Assert.Equal(0, stats.TotalDistanceM);
        Assert.Null(stats.Co2SavedKg);
        Assert.Empty(stats.DailyBreakdown);
        Assert.True(stats.HasNoData);
    }

    [Fact]
    public void Stats_FromJson_unwraps_data_envelope()
    {
        using var doc = JsonDocument.Parse("""{"data":{"total_wh":1000,"total_distance_m":5000}}""");
        var stats = EnergyStats.FromJson(doc.RootElement);

        Assert.Equal(1000, stats.TotalWh);
        Assert.Equal(5000, stats.TotalDistanceM);
    }

    [Fact]
    public void Sessions_FromArray_reads_bare_array_and_envelopes()
    {
        const string json = """
        [{"id":7,"started_at":"2026-05-01T02:00:00Z","total_energy_added_wh":30000,"cost_decimal":6.5,
          "start_soc_pct":20,"end_soc_pct":80,"peak_power_w":150000,"charger_type":"Tesla Supercharger"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var sessions = EnergyChargingSession.FromArray(doc.RootElement);

        var s = Assert.Single(sessions);
        Assert.Equal(7, s.Id);
        Assert.Equal(30000, s.TotalEnergyAddedWh);
        Assert.Equal(6.5, s.CostDecimal);
        Assert.Equal(80, s.EndSocPct);
        Assert.Equal("Tesla Supercharger", s.ChargerType);

        using var enveloped = JsonDocument.Parse("""{"data":[{"id":9,"started_at":"2026-05-02T00:00:00Z","total_energy_added_wh":1}]}""");
        Assert.Single(EnergyChargingSession.FromArray(enveloped.RootElement));
    }

    [Fact]
    public void Live_FromJson_reads_lifetime_energy_or_null()
    {
        using var withValue = JsonDocument.Parse("""{"lifetime_energy_used":1234.5}""");
        Assert.Equal(1234.5, EnergyLiveCharging.FromJson(withValue.RootElement).LifetimeEnergyUsedKwh);

        using var without = JsonDocument.Parse("""{"other":1}""");
        Assert.Null(EnergyLiveCharging.FromJson(without.RootElement).LifetimeEnergyUsedKwh);

        using var notObject = JsonDocument.Parse("null");
        Assert.Null(EnergyLiveCharging.FromJson(notObject.RootElement).LifetimeEnergyUsedKwh);
    }

    // ---- Projection: i18n coverage -------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        Project(localizer: recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        Assert.Equal(56, RequiredStringKeys.Length);
    }

    // ---- Projection: hero gauges (GlassPanel1) -------------------------------------

    [Fact]
    public void Projection_builds_four_hero_gauges_in_display_units()
    {
        var view = Project();

        Assert.Equal(4, view.Gauges.Count);
        Assert.False(view.ShowEmptyHero);
        Assert.Equal("Energy Used", view.Gauges[0].Label);
        Assert.Equal("Wh", view.Gauges[0].Unit);
        Assert.Equal("Efficiency", view.Gauges[1].Label);
        Assert.Equal("Wh/km", view.Gauges[1].Unit);
        Assert.Equal("CO\u2082 Saved", view.Gauges[2].Label);
        Assert.Equal("kg", view.Gauges[2].Unit);
        Assert.Equal(21, view.Gauges[2].Value);
        Assert.Equal("Total Cost", view.Gauges[3].Label);
        Assert.Equal("$", view.Gauges[3].Unit);
        // Total cost is the sum of the sample sessions' costs (6.5 + 3.2 + 1.1).
        Assert.Equal(10.8, view.Gauges[3].Value, 3);
    }

    [Fact]
    public void Projection_efficiency_unit_switches_to_imperial()
    {
        var metric = Project(units: UnitPref.Metric);
        var imperial = Project(units: UnitPref.Imperial);

        Assert.Equal("Wh/km", metric.Gauges[1].Unit);
        Assert.Equal("Wh/mi", imperial.Gauges[1].Unit);
        Assert.Equal("kWh", imperial.Gauges[0].Unit);
    }

    [Fact]
    public void Projection_shows_empty_hero_when_no_sessions_and_no_stats()
    {
        var view = Project(stats: EnergyStats.Empty, sessions: Array.Empty<EnergyChargingSession>(), live: EnergyLiveCharging.Empty);

        Assert.True(view.ShowEmptyHero);
        Assert.False(string.IsNullOrWhiteSpace(view.EmptyHeroMessage));
    }

    // ---- Projection: metrics / lifetime / cost comparison --------------------------

    [Fact]
    public void Projection_builds_six_quick_metrics()
    {
        var view = Project();

        Assert.Equal(6, view.Metrics.Count);
        Assert.Equal("Sessions", view.Metrics[3].Label);
        Assert.Equal("3", view.Metrics[3].Value); // three sample sessions
    }

    [Fact]
    public void Projection_builds_two_lifetime_cards_with_kwh_value()
    {
        var view = Project(live: new EnergyLiveCharging(1234));

        Assert.Equal(2, view.LifetimeCards.Count);
        Assert.Equal("Lifetime Energy Used", view.LifetimeCards[0].Label);
        Assert.Contains("kWh", view.LifetimeCards[0].Value, StringComparison.Ordinal);
        Assert.Contains("1,234", view.LifetimeCards[0].Value, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_lifetime_value_is_em_dash_when_live_absent()
    {
        var view = Project(live: EnergyLiveCharging.Empty);
        Assert.Equal("\u2014", view.LifetimeCards[0].Value);
    }

    [Fact]
    public void Projection_builds_two_cost_comparisons_with_saving_chip()
    {
        var view = Project();

        Assert.Equal(2, view.CostCompares.Count);
        Assert.Equal("EV Cost", view.CostCompares[0].EvCostLabel);
        Assert.Equal("Gas Equivalent", view.CostCompares[0].GasLabel);
        Assert.Contains("Saving", view.CostCompares[0].SavingText, StringComparison.Ordinal);
        Assert.Contains("%", view.CostCompares[0].PercentLessText, StringComparison.Ordinal);
        Assert.Contains("less", view.CostCompares[0].PercentLessText, StringComparison.Ordinal);
    }

    // ---- Projection: charts (12 of them, ChartContainer + 4 bodies + 4 gauges) -----

    [Fact]
    public void Projection_builds_energy_cost_composed_series()
    {
        var view = Project();

        Assert.Equal(ChartState.Ready, view.EnergyCostState);
        Assert.Equal(2, view.EnergyCostSeries.Count);
        Assert.Equal(ChartSeriesKind.Bar, view.EnergyCostSeries[0].Kind);   // energy bars
        Assert.Equal(ChartSeriesKind.Line, view.EnergyCostSeries[1].Kind);  // efficiency line
        Assert.Equal(3, view.EnergyCostSeries[0].Points.Count);
        Assert.Equal("Wh/km", view.EnergyCostSeries[1].Name);
    }

    [Fact]
    public void Projection_builds_efficiency_area_series()
    {
        var view = Project();

        Assert.Equal(ChartState.Ready, view.EfficiencyState);
        Assert.Equal(2, view.EfficiencySeries.Count);
        Assert.All(view.EfficiencySeries, s => Assert.Equal(ChartSeriesKind.Area, s.Kind));
        Assert.Equal(3, view.EfficiencySeries[0].Points.Count);
    }

    [Fact]
    public void Projection_builds_time_of_day_bar_series_with_four_buckets()
    {
        var view = Project();

        Assert.Equal(ChartState.Ready, view.TimeOfDayState);
        Assert.Equal(2, view.TimeOfDaySeries.Count);
        Assert.All(view.TimeOfDaySeries, s => Assert.Equal(ChartSeriesKind.Bar, s.Kind));
        Assert.Equal(4, view.TimeOfDaySeries[0].Points.Count);
    }

    [Fact]
    public void Projection_builds_charger_breakdown_pie_and_legend()
    {
        var view = Project();

        Assert.Equal(ChartState.Ready, view.ChargerBreakdownState);
        Assert.Equal(3, view.ChargerSlices.Count);
        Assert.Equal(3, view.ChargerRows.Count);
        Assert.Contains(view.ChargerRows, r => r.Name == "Supercharger");
        Assert.Contains(view.ChargerRows, r => r.Name == "DC Fast");
        Assert.Contains(view.ChargerRows, r => r.Name == "Home/AC");
        Assert.All(view.ChargerRows, r => Assert.Contains("/kWh", r.PerKwhText, StringComparison.Ordinal));
    }

    [Fact]
    public void Projection_charts_are_empty_when_no_data()
    {
        var view = Project(stats: EnergyStats.Empty, sessions: Array.Empty<EnergyChargingSession>(), live: EnergyLiveCharging.Empty);

        Assert.Equal(ChartState.Empty, view.EnergyCostState);
        Assert.Equal(ChartState.Empty, view.EfficiencyState);
        Assert.Equal(ChartState.Empty, view.TimeOfDayState);
        Assert.Equal(ChartState.Empty, view.ChargerBreakdownState);
        Assert.Empty(view.EnergyCostSeries);
        Assert.Empty(view.ChargerSlices);
    }

    // ---- Projection: sessions table (GlassPanel9) ----------------------------------

    [Fact]
    public void Projection_builds_session_rows_and_columns()
    {
        var view = Project();

        Assert.True(view.HasSessions);
        Assert.Equal(7, view.SessionColumns.Count);
        Assert.Equal(3, view.SessionRows.Count);
        Assert.Contains("\u2192", view.SessionRows[0].Battery, StringComparison.Ordinal); // start -> end soc
        Assert.Contains("kW", view.SessionRows[0].Power, StringComparison.Ordinal);
        Assert.Equal("Supercharger", view.SessionRows[0].Type);
    }

    [Fact]
    public void Projection_session_table_caps_at_fifteen_rows()
    {
        var many = new List<EnergyChargingSession>();
        for (int i = 0; i < 25; i++)
        {
            many.Add(new EnergyChargingSession(i, Now, 1000, 1, 10, 20, 1000, "CCS"));
        }

        var view = Project(sessions: many);
        Assert.Equal(15, view.SessionRows.Count);
    }

    [Fact]
    public void Projection_sessions_empty_when_none()
    {
        var view = Project(sessions: Array.Empty<EnergyChargingSession>());
        Assert.False(view.HasSessions);
        Assert.Empty(view.SessionRows);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_for_each_source()
    {
        using var statsDoc = JsonDocument.Parse("""{"total_wh":99}""");
        var cached = EnergyResultMapper.MapStats(RepositoryResult<JsonElement>.Cached(statsDoc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(99, cached.Value!.TotalWh);

        using var arrDoc = JsonDocument.Parse("""[{"id":1,"started_at":"2026-05-01T00:00:00Z","total_energy_added_wh":5}]""");
        var loadedSessions = EnergyResultMapper.MapSessions(RepositoryResult<JsonElement>.Loaded(arrDoc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loadedSessions.Status);
        Assert.Single(loadedSessions.Value!);

        var offlineLive = EnergyResultMapper.MapLive(RepositoryResult<JsonElement>.OfflineCached(
            JsonDocument.Parse("""{"lifetime_energy_used":7}""").RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offlineLive.Status);
        Assert.Equal(7, offlineLive.Value!.LifetimeEnergyUsedKwh);

        Assert.Equal(LoadStatus.Empty, EnergyResultMapper.MapStats(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, EnergyResultMapper.MapStats(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix (loading / ready / error / stale / offline) -------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Loading()],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Loading()],
            [RepositoryResult<EnergyLiveCharging>.Loading()]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Loading, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_hero_charts_metrics_and_sessions()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Loaded(SampleStats(), Now)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Loaded(SampleSessions(), Now)],
            [RepositoryResult<EnergyLiveCharging>.Loaded(new EnergyLiveCharging(1234), Now)]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Ready, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal(4, vm.Display.Gauges.Count);
        Assert.Equal(2, vm.Display.EnergyCostSeries.Count);
        Assert.True(vm.Display.HasSessions);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_stats_still_renders_content_with_empty_panels()
    {
        // Web parity: an empty energy-stats response keeps the page rendered with per-panel empty bodies.
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Empty(Now)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty(Now)],
            [RepositoryResult<EnergyLiveCharging>.Empty(Now)]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Ready, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.Display.ShowEmptyHero);
        Assert.Equal(ChartState.Empty, vm.Display.EnergyCostState);
    }

    [Fact]
    public async Task ViewModel_stats_failure_renders_error()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty(Now)],
            [RepositoryResult<EnergyLiveCharging>.Empty(Now)]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Cached(SampleStats(), Now, stale: true)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Cached(SampleSessions(), Now, stale: true)],
            [RepositoryResult<EnergyLiveCharging>.Empty(Now)]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content_and_error()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.OfflineCached(SampleStats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty(Now)],
            [RepositoryResult<EnergyLiveCharging>.Empty(Now)]);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_efficiency_unit()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Loaded(SampleStats(), Now)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Loaded(SampleSessions(), Now)]);
        await vm.LoadAsync();
        Assert.Equal("Wh/km", vm.Display.Gauges[1].Unit);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Wh/mi", vm.Display.Gauges[1].Unit);
        Assert.Equal(EnergyState.Ready, vm.State);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_costs()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Loaded(SampleStats(), Now)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Loaded(SampleSessions(), Now)]);
        await vm.LoadAsync();
        Assert.StartsWith("$", vm.Display.CostCompares[0].EvCostValue, StringComparison.Ordinal);

        vm.CurrencySymbol = "\u20AC";
        Assert.StartsWith("\u20AC", vm.Display.CostCompares[0].EvCostValue, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(
            [RepositoryResult<EnergyStats>.Loaded(SampleStats(), Now)],
            [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Loaded(SampleSessions(), Now)]);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnergyPageViewModel.State), changed);
        Assert.Contains(nameof(EnergyPageViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_title_and_subtitle_resolve_through_i18n()
    {
        using var vm = NewViewModel([RepositoryResult<EnergyStats>.Empty(Now)]);
        Assert.Equal("Energy Intelligence", vm.Title);
        Assert.Contains("efficiency trends", vm.Subtitle, StringComparison.Ordinal);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_web_route()
    {
        Assert.Equal("Energy", EnergyRegistration.RouteName);
        Assert.Equal("EnergyPage", EnergyRegistration.Slug);
        Assert.Equal("Energy Intelligence", EnergyRegistration.Title(Localizer));
        Assert.Contains("consumption patterns", EnergyRegistration.Subtitle(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyPage", Assert.Single(lines));
    }

    [Fact]
    public async Task Empty_sources_render_content_with_empty_hero()
    {
        using var vm = new EnergyPageViewModel(
            EmptyEnergyStatsSource.Instance,
            EmptyChargingSessionsSource.Instance,
            EmptyChargingTelemetryLatestSource.Instance,
            Localizer);
        await vm.LoadAsync();

        Assert.Equal(EnergyState.Ready, vm.State);
        Assert.True(vm.Display.ShowEmptyHero);
    }

    // ---- Repository-backed sources -------------------------------------------------

    [Fact]
    public async Task StatsSource_short_circuits_to_empty_with_no_vehicle()
    {
        var source = new EnergyStatsClientSource(
            new FakeVehicleSource(null), new ThrowingApiClient(), NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, results[0].Status);
    }

    [Fact]
    public async Task StatsSource_resolves_vehicle_and_parses_loaded_stats()
    {
        var api = new StubApiClient("""{"total_wh":4200,"total_distance_m":12000,"avg_efficiency_wh_per_m":0.2}""");
        var source = new EnergyStatsClientSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 42 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        Assert.Contains(results, r => r.Status == LoadStatus.Loading);
        var loaded = Assert.Single(results, r => r.Status == LoadStatus.Loaded);
        Assert.Equal(4200, loaded.Value!.TotalWh);
        Assert.Equal(Operations.Vehicles.Energy, api.LastRequest!.OperationId);
        Assert.Equal("42", api.LastRequest.PathParams!["vehicleID"]);
        Assert.Equal(EnergyProjection.WindowDays, api.LastRequest.Query!["days"]);
    }

    [Fact]
    public async Task SessionsSource_sends_snake_case_window_query()
    {
        var api = new StubApiClient("""[{"id":1,"started_at":"2026-05-01T00:00:00Z","total_energy_added_wh":1000}]""");
        var source = new ChargingSessionsClientSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions(),
            clock: () => Now);

        var results = await Drain(source.StreamAsync());

        var loaded = Assert.Single(results, r => r.Status == LoadStatus.Loaded);
        Assert.Single(loaded.Value!);
        Assert.Equal(Operations.Charging.Sessions, api.LastRequest!.OperationId);
        Assert.Equal(7L, api.LastRequest.Query!["vehicle_id"]);
        Assert.True(api.LastRequest.Query.ContainsKey("start"));
        Assert.True(api.LastRequest.Query.ContainsKey("end"));
    }

    [Fact]
    public async Task LiveSource_sends_vehicle_id_and_parses_lifetime()
    {
        var api = new StubApiClient("""{"lifetime_energy_used":5000}""");
        var source = new ChargingTelemetryLatestClientSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 9 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source.StreamAsync());

        var loaded = Assert.Single(results, r => r.Status == LoadStatus.Loaded);
        Assert.Equal(5000, loaded.Value!.LifetimeEnergyUsedKwh);
        Assert.Equal(Operations.Charging.TelemetryLatest, api.LastRequest!.OperationId);
        Assert.Equal(9L, api.LastRequest.Query!["vehicle_id"]);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<T>>> Drain<T>(IAsyncEnumerable<RepositoryResult<T>> stream)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static EnergyPageViewModel NewViewModel(
        RepositoryResult<EnergyStats>[] stats,
        RepositoryResult<IReadOnlyList<EnergyChargingSession>>[]? sessions = null,
        RepositoryResult<EnergyLiveCharging>[]? live = null) =>
        new(
            new FakeStatsSource(stats),
            new FakeSessionsSource(sessions ?? [RepositoryResult<IReadOnlyList<EnergyChargingSession>>.Empty(Now)]),
            new FakeLiveSource(live ?? [RepositoryResult<EnergyLiveCharging>.Empty(Now)]),
            Localizer);

    private sealed class FakeStatsSource(params RepositoryResult<EnergyStats>[] emissions) : IEnergyStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<EnergyStats>> StreamAsync(
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

    private sealed class FakeSessionsSource(params RepositoryResult<IReadOnlyList<EnergyChargingSession>>[] emissions)
        : IChargingSessionsSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<EnergyChargingSession>>> StreamAsync(
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

    private sealed class FakeLiveSource(params RepositoryResult<EnergyLiveCharging>[] emissions)
        : IChargingTelemetryLatestSource
    {
        public async IAsyncEnumerable<RepositoryResult<EnergyLiveCharging>> StreamAsync(
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

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }

    private sealed class StubApiClient(string json) : IApiClient
    {
        private readonly JsonElement _element = JsonDocument.Parse(json).RootElement.Clone();

        public ApiRequest? LastRequest { get; private set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The Energy source tests never resolve endpoint descriptors directly.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            return Task.FromResult((T)(object)_element);
        }
    }

    private sealed class ThrowingApiClient : IApiClient
    {
        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The no-vehicle path never reaches the API client.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("The no-vehicle path never reaches the API client.");
    }
}
