using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Charging analytics surface's UI-thread-free logic — the JSON parse adapter
/// (totals + charging_analytics lists + nullable stats), the cache-then-network result mapper, the projection
/// (web <c>fmtInt</c> / <c>fmtNumber</c> / <c>formatCurrency</c> formatting, the <c>powerStats ? … : '—'</c>
/// em-dash gate, the donut / bar / leaderboard / cost datasets and their ratios / percents), the repository
/// source's request shape, the state-holder view-model's full state matrix
/// (loading / ready / empty / stale / offline / error), the i18n facade key coverage, the registry metadata and
/// the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/analytics/ChargingTab.tsx + ChargingDetailSection.tsx). The WinUI view
/// itself is exercised by the app build; its per-state branch selection is driven entirely by the view-model
/// <see cref="ChargingTabState"/> asserted here.
/// </summary>
public sealed class ChargingTabTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string SampleJson = """
    {
      "period_days": 30,
      "total_charging_sessions": 128,
      "total_energy_kwh": 1543.2,
      "total_cost": 213.45,
      "charging_analytics": {
        "charger_types": [{"type":"Supercharger","count":80},{"type":"Home","count":40}],
        "start_battery_dist": [{"range":"0-20%","count":12},{"range":"20-40%","count":40}],
        "hourly_pattern": [{"hour":0,"charges":3,"energy":45.2},{"hour":22,"charges":9,"energy":120.5}],
        "charger_brands": [{"brand":"Tesla","count":80},{"brand":"Electrify America","count":30}],
        "monthly_trend": [
          {"month":"2026-01","energy":400,"cost":52.3,"sessions":40,"avg_power":48.2,"gas_cost":120,"savings":67.7}
        ],
        "power_stats": {"min":5,"max":250,"avg":48.5,"median":40,"p95":150,"count":128},
        "duration_stats": {"min":10,"max":480,"avg":62.3,"median":45,"p95":240,"count":128},
        "efficiency_stats": {"min":85,"max":99,"avg":92.4,"median":93,"p95":98,"count":128},
        "cost_stats": {"min":1.2,"max":35.6,"avg":12.34,"median":10,"p95":28,"count":128}
      }
    }
    """;

    // ---- JSON parse adapter ---------------------------------------------------------

    [Fact]
    public void Data_parses_totals_and_analytics_from_real_api_fields()
    {
        var data = Sample();

        Assert.Equal(128, data.TotalChargingSessions);
        Assert.Equal(1543.2, data.TotalEnergyKwh);
        Assert.Equal(213.45, data.TotalCost);

        Assert.Equal(2, data.Analytics.ChargerTypes.Count);
        Assert.Equal("Supercharger", data.Analytics.ChargerTypes[0].Type);
        Assert.Equal(80, data.Analytics.ChargerTypes[0].Count);
        Assert.Equal(2, data.Analytics.StartBatteryDist.Count);
        Assert.Equal("0-20%", data.Analytics.StartBatteryDist[0].Range);
        Assert.Equal(2, data.Analytics.HourlyPattern.Count);
        Assert.Equal(22, data.Analytics.HourlyPattern[1].Hour);
        Assert.Equal(9, data.Analytics.HourlyPattern[1].Charges);
        Assert.Equal(120.5, data.Analytics.HourlyPattern[1].Energy);
        Assert.Equal(2, data.Analytics.ChargerBrands.Count);
        Assert.Single(data.Analytics.MonthlyTrend);
        Assert.Equal("2026-01", data.Analytics.MonthlyTrend[0].Month);
        Assert.Equal(48.2, data.Analytics.MonthlyTrend[0].AvgPower);
        Assert.Equal(40, data.Analytics.MonthlyTrend[0].Sessions);
    }

    [Fact]
    public void Stats_parse_when_present_and_are_null_when_absent()
    {
        var data = Sample();
        Assert.NotNull(data.Analytics.PowerStats);
        Assert.Equal(48.5, data.Analytics.PowerStats!.Avg);
        Assert.NotNull(data.Analytics.CostStats);
        Assert.Equal(12.34, data.Analytics.CostStats!.Avg);

        using var doc = JsonDocument.Parse("""{"total_charging_sessions":5,"charging_analytics":{"charger_types":[]}}""");
        var partial = ChargingTabData.FromJson(doc.RootElement);
        Assert.Equal(5, partial.TotalChargingSessions);
        Assert.Null(partial.Analytics.PowerStats);
        Assert.Null(partial.Analytics.CostStats);
        Assert.Empty(partial.Analytics.ChargerTypes);
    }

    [Fact]
    public void Data_is_tolerant_of_a_non_object_or_missing_body()
    {
        using var notObject = JsonDocument.Parse("[]");
        var empty = ChargingTabData.FromJson(notObject.RootElement);
        Assert.Equal(0, empty.TotalChargingSessions);
        Assert.Empty(empty.Analytics.ChargerTypes);

        using var numericString = JsonDocument.Parse("""{"total_energy_kwh":"1543.2","total_charging_sessions":"128"}""");
        var coerced = ChargingTabData.FromJson(numericString.RootElement);
        Assert.Equal(128, coerced.TotalChargingSessions);
        Assert.Equal(1543.2, coerced.TotalEnergyKwh);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);

        var cached = ChargingTabResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(128, cached.Value!.TotalChargingSessions);

        var offline = ChargingTabResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(213.45, offline.Value!.TotalCost);

        var loaded = ChargingTabResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(1543.2, loaded.Value!.TotalEnergyKwh);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, ChargingTabResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, ChargingTabResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargingTabResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Projection: summary cards -------------------------------------------------

    [Fact]
    public void Summary_cards_format_like_the_web_metric_cards()
    {
        var display = ChargingTabProjection.Project(Sample(), Localizer);

        Assert.Equal(6, display.SummaryCards.Count);

        AssertCard(display.SummaryCards[0], "Sessions", "128", string.Empty);
        AssertCard(display.SummaryCards[1], "Total Energy", "1,543.2", "kWh");
        AssertCard(display.SummaryCards[2], "Total Cost", "$213.45", string.Empty);
        AssertCard(display.SummaryCards[3], "Avg Power", "48.5", "kW");
        AssertCard(display.SummaryCards[4], "Avg Duration", "62", "min");
        AssertCard(display.SummaryCards[5], "Charge Efficiency", "92.4", "%");
    }

    [Fact]
    public void Summary_cards_coerce_counts_to_zero_but_gate_stats_with_em_dash_on_null_data()
    {
        // web parity: fmtInt(undefined)/fmtNumber(undefined) → "0"/"0.0"/"$0.00";
        // the average power / duration / efficiency cards use `stats ? … : '—'`.
        var display = ChargingTabProjection.Project(null, Localizer);

        Assert.Equal("0", display.SummaryCards[0].Value);
        Assert.Equal("0.0", display.SummaryCards[1].Value);
        Assert.Equal("$0.00", display.SummaryCards[2].Value);
        Assert.Equal(ChargingTabProjection.EmDash, display.SummaryCards[3].Value);
        Assert.Equal(ChargingTabProjection.EmDash, display.SummaryCards[4].Value);
        Assert.Equal(ChargingTabProjection.EmDash, display.SummaryCards[5].Value);
    }

    [Fact]
    public void Stat_cards_show_em_dash_only_when_the_stat_block_is_absent()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_sessions":5,"charging_analytics":{"charger_types":[]}}""");
        var display = ChargingTabProjection.Project(ChargingTabData.FromJson(doc.RootElement), Localizer);

        Assert.Equal("5", display.SummaryCards[0].Value);
        Assert.Equal(ChargingTabProjection.EmDash, display.SummaryCards[3].Value); // no power_stats
        Assert.Empty(display.CostCards); // no cost_stats → no cost cards
    }

    [Fact]
    public void Currency_symbol_override_is_honoured()
    {
        var display = ChargingTabProjection.Project(Sample(), Localizer, "€");
        Assert.Equal("€213.45", display.SummaryCards[2].Value);
    }

    // ---- Projection: charts + leaderboards -----------------------------------------

    [Fact]
    public void Charger_types_project_with_counts_and_palette_indices()
    {
        var types = ChargingTabProjection.Project(Sample(), Localizer).ChargerTypes;

        Assert.Equal(2, types.Count);
        Assert.Equal("Supercharger", types[0].Type);
        Assert.Equal("80", types[0].CountText);
        Assert.Equal(0, types[0].ColorIndex);
        Assert.Equal(1, types[1].ColorIndex);
    }

    [Fact]
    public void Battery_bars_scale_height_to_the_tallest_bucket()
    {
        var bars = ChargingTabProjection.Project(Sample(), Localizer).BatteryDistribution;

        Assert.Equal(2, bars.Count);
        Assert.Equal(0.3, bars[0].HeightRatio, 3); // 12 / 40
        Assert.Equal(1.0, bars[1].HeightRatio, 3); // 40 / 40
        Assert.Equal("12", bars[0].CountText);
    }

    [Fact]
    public void Hourly_points_carry_a_clock_label_and_formatted_values()
    {
        var hourly = ChargingTabProjection.Project(Sample(), Localizer).HourlyPattern;

        Assert.Equal("0:00", hourly[0].HourLabel);
        Assert.Equal("22:00", hourly[1].HourLabel);
        Assert.Equal("9", hourly[1].ChargesText);
        Assert.Equal("120.5", hourly[1].EnergyText);
    }

    [Fact]
    public void Brand_leaderboard_ranks_and_scales_to_the_leader()
    {
        var brands = ChargingTabProjection.Project(Sample(), Localizer).ChargerBrands;

        Assert.Equal(1, brands[0].Rank);
        Assert.Equal("Tesla", brands[0].Brand);
        Assert.Equal(100.0, brands[0].Percent, 3);
        Assert.Equal("80", brands[0].CountText);
        Assert.Equal(2, brands[1].Rank);
        Assert.Equal(37.5, brands[1].Percent, 3); // 30 / 80
    }

    [Fact]
    public void Monthly_trend_points_format_energy_power_and_sessions()
    {
        var month = ChargingTabProjection.Project(Sample(), Localizer).MonthlyTrend[0];

        Assert.Equal("2026-01", month.Month);
        Assert.Equal("400.0", month.EnergyText);
        Assert.Equal("48.2", month.AvgPowerText);
        Assert.Equal("40", month.SessionsText);
    }

    [Fact]
    public void Cost_cards_project_min_avg_median_max_as_currency()
    {
        var cards = ChargingTabProjection.Project(Sample(), Localizer).CostCards;

        Assert.Equal(4, cards.Count);
        AssertCard(cards[0], "Min Cost", "$1.20", string.Empty);
        AssertCard(cards[1], "Avg Cost", "$12.34", string.Empty);
        AssertCard(cards[2], "Median Cost", "$10.00", string.Empty);
        AssertCard(cards[3], "Max Cost", "$35.60", string.Empty);
    }

    [Fact]
    public void Cost_by_type_rows_share_of_all_sessions()
    {
        var rows = ChargingTabProjection.Project(Sample(), Localizer).CostByType;

        Assert.Equal(2, rows.Count);
        Assert.Equal(66.666, rows[0].Percent, 2); // 80 / 120
        Assert.Equal("67", rows[0].PercentText);
        Assert.Equal(33.333, rows[1].Percent, 2); // 40 / 120
        Assert.Equal("33", rows[1].PercentText);
    }

    [Fact]
    public void Empty_analytics_yield_empty_sections_not_a_throw()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_sessions":0,"charging_analytics":{}}""");
        var display = ChargingTabProjection.Project(ChargingTabData.FromJson(doc.RootElement), Localizer);

        Assert.Empty(display.ChargerTypes);
        Assert.Empty(display.BatteryDistribution);
        Assert.Empty(display.HourlyPattern);
        Assert.Empty(display.ChargerBrands);
        Assert.Empty(display.MonthlyTrend);
        Assert.Empty(display.CostByType);
        Assert.False(display.HasCostStats);
        Assert.Equal(6, display.SummaryCards.Count); // cards always render
    }

    // ---- View-model state matrix (loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_formatted_content()
    {
        var source = new FakeChargingSource(
            RepositoryResult<ChargingTabData>.Loading(),
            RepositoryResult<ChargingTabData>.Loaded(Sample(), Now));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Ready, vm.State);
        Assert.Equal("128", vm.Display.SummaryCards[0].Value);
        Assert.Equal(2, vm.Display.ChargerTypes.Count);
        Assert.True(vm.Display.HasCostStats);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_present_object_with_empty_lists_is_ready_not_empty()
    {
        using var doc = JsonDocument.Parse("""{"total_charging_sessions":0,"charging_analytics":{}}""");
        var data = ChargingTabData.FromJson(doc.RootElement);
        var source = new FakeChargingSource(RepositoryResult<ChargingTabData>.Loaded(data, Now));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Ready, vm.State);
        Assert.Empty(vm.Display.ChargerTypes);
    }

    [Fact]
    public async Task ViewModel_null_body_is_whole_surface_empty()
    {
        var source = new FakeChargingSource(RepositoryResult<ChargingTabData>.Empty(Now));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_chip()
    {
        var source = new FakeChargingSource(
            RepositoryResult<ChargingTabData>.Cached(Sample(), Now, stale: true));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal("128", vm.Display.SummaryCards[0].Value);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_chip()
    {
        var source = new FakeChargingSource(RepositoryResult<ChargingTabData>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.Equal("128", vm.Display.SummaryCards[0].Value);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_zero_scaffold_and_retry_state()
    {
        var source = new FakeChargingSource(RepositoryResult<ChargingTabData>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ChargingTabState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("0", vm.Display.SummaryCards[0].Value);
        Assert.Equal(ChargingTabProjection.EmDash, vm.Display.SummaryCards[3].Value);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeChargingSource(RepositoryResult<ChargingTabData>.Loaded(Sample(), Now));
        using var vm = new ChargingTabViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(ChargingTabState.Ready, vm.State);
    }

    [Fact]
    public async Task ViewModel_status_announcement_tracks_the_state()
    {
        var stale = new FakeChargingSource(RepositoryResult<ChargingTabData>.Cached(Sample(), Now, stale: true));
        using var staleVm = new ChargingTabViewModel(stale, Localizer);
        await staleVm.LoadAsync();
        Assert.Equal(staleVm.StaleLabel, staleVm.StatusAnnouncement);

        var ready = new FakeChargingSource(RepositoryResult<ChargingTabData>.Loaded(Sample(), Now));
        using var readyVm = new ChargingTabViewModel(ready, Localizer);
        await readyVm.LoadAsync();
        Assert.Null(readyVm.StatusAnnouncement);
    }

    // ---- Repository source request shape (engine + fake client) --------------------

    [Fact]
    public async Task Source_requests_fleet_analytics_with_no_params()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(128, emissions[^1].Value!.TotalChargingSessions);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_analytics_fleet", request.OperationId);
        Assert.Null(request.PathParams);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var cache = new InMemoryCacheStore();
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        var engine = new CacheThenNetworkEngine(cache, () => Now);

        var ok = new ChargingTabSource(new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new ChargingTabSource(
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(128, emissions[^1].Value!.TotalChargingSessions);
    }

    // ---- i18n facade coverage + accessibility + registry + diagnostics -------------

    [Fact]
    public void Every_surface_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingTabProjection.Project(Sample(), recorder);
        _ = ChargingTabRegistration.ChargerTypesTitle(recorder);
        _ = ChargingTabRegistration.StartBatteryTitle(recorder);
        _ = ChargingTabRegistration.HourlyPatternTitle(recorder);
        _ = ChargingTabRegistration.ChargerBrandsTitle(recorder);
        _ = ChargingTabRegistration.MonthlyTrendTitle(recorder);
        _ = ChargingTabRegistration.CostAnalysisTitle(recorder);
        _ = ChargingTabRegistration.CostByTypeTitle(recorder);
        _ = ChargingTabRegistration.ChargesSeries(recorder);
        _ = ChargingTabRegistration.EnergySeries(recorder);
        _ = ChargingTabRegistration.AvgPowerSeries(recorder);
        _ = ChargingTabRegistration.NoChargerTypes(recorder);
        _ = ChargingTabRegistration.NoBatteryDistribution(recorder);
        _ = ChargingTabRegistration.NoHourly(recorder);
        _ = ChargingTabRegistration.NoBrands(recorder);
        _ = ChargingTabRegistration.NoMonthly(recorder);
        _ = ChargingTabRegistration.NoCostStats(recorder);
        _ = ChargingTabRegistration.NoCostByType(recorder);

        Assert.Contains("analytics.charging.sessions", recorder.Keys);
        Assert.Contains("analytics.charging.totalEnergy", recorder.Keys);
        Assert.Contains("analytics.charging.totalCost", recorder.Keys);
        Assert.Contains("analytics.charging.avgPower", recorder.Keys);
        Assert.Contains("analytics.charging.avgDuration", recorder.Keys);
        Assert.Contains("analytics.charging.min", recorder.Keys);
        Assert.Contains("analytics.charging.chargeEff", recorder.Keys);
        Assert.Contains("analytics.charging.chargerTypes", recorder.Keys);
        Assert.Contains("analytics.charging.startBattery", recorder.Keys);
        Assert.Contains("analytics.charging.hourlyPattern", recorder.Keys);
        Assert.Contains("analytics.charging.charges", recorder.Keys);
        Assert.Contains("analytics.charging.energykWh", recorder.Keys);
        Assert.Contains("analytics.charging.noTypes", recorder.Keys);
        Assert.Contains("analytics.charging.noBatDist", recorder.Keys);
        Assert.Contains("analytics.charging.noHourly", recorder.Keys);
        Assert.Contains("analytics.charging.minCost", recorder.Keys);
        Assert.Contains("analytics.charging.costByType", recorder.Keys);
    }

    [Fact]
    public void Section_labels_and_card_names_are_present_for_accessibility()
    {
        var display = ChargingTabProjection.Project(Sample(), Localizer);

        Assert.All(
            display.SummaryCards,
            card => Assert.False(string.IsNullOrWhiteSpace(card.AutomationName)));
        Assert.Contains("Sessions", display.SummaryCards[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains("kWh", display.SummaryCards[1].AutomationName, StringComparison.Ordinal);

        Assert.Equal("Charger Types", ChargingTabRegistration.ChargerTypesTitle(Localizer));
        Assert.Equal("Cost by Charger Type", ChargingTabRegistration.CostByTypeTitle(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(ChargingTabRegistration.StaleLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(ChargingTabRegistration.OfflineLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(ChargingTabRegistration.RetryLabel(Localizer)));
    }

    [Fact]
    public void Registration_exposes_a_stable_slug_and_currency_default()
    {
        Assert.Equal("ChargingTab", ChargingTabRegistration.Slug);
        Assert.Equal("$", ChargingTabRegistration.DefaultCurrencySymbol);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new ChargingTabDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=ChargingTab", line);
        Assert.DoesNotContain("128", line, StringComparison.Ordinal);
    }

    // ---- helpers -------------------------------------------------------------------

    private static ChargingTabData Sample()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        return ChargingTabData.FromJson(doc.RootElement);
    }

    private static void AssertCard(ChargingMetricCard card, string label, string value, string subtitle)
    {
        Assert.Equal(label, card.Label);
        Assert.Equal(value, card.Value);
        Assert.Equal(subtitle, card.Subtitle);
    }

    private static ChargingTabSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new ChargingTabSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<ChargingTabData>>> Collect(
        IAsyncEnumerable<RepositoryResult<ChargingTabData>> stream)
    {
        var list = new List<RepositoryResult<ChargingTabData>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeChargingSource : IChargingTabSource
    {
        private readonly IReadOnlyList<RepositoryResult<ChargingTabData>> _results;

        public FakeChargingSource(params RepositoryResult<ChargingTabData>[] results) => _results = results;

        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<ChargingTabData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
