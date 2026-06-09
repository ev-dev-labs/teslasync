using System.Globalization;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the AC/DC charging-stats surface's UI-thread-free logic — the breakdown
/// computation (the web <c>computeAcDcBreakdown</c> + <c>durationMinutes</c> ports, including the
/// charger-type/peak-power DC rule and the free-charging rule), the JSON parse adapter, the cache-then-network
/// result mapper, the projection (the web <c>fmtPercent</c> / <c>fmtWithUnit</c> kWh|MWh switch /
/// <c>Currency</c> / <c>formatDuration</c> formatting, the <c>energy &gt; 0 ? … : '—'</c> em-dash gate, the
/// energy-split bar, the filtered table rows and the optional free footer), the repository source's
/// vehicle-scoped request shape, the state-holder view-model's full state matrix
/// (loading / ready / empty / stale / offline / error), the i18n facade key coverage, the registry metadata and
/// the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx + helpers.ts). The WinUI view itself is
/// exercised by the app build; its per-state branch selection is driven entirely by the view-model
/// <see cref="AcDcStatsState"/> asserted here.
/// </summary>
public sealed class AcDcStatsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Two AC sessions (no charger type, sub-22 kW) and two DC sessions (one by charger type, one by peak power),
    // with one free session in each bucket — a deterministic fixture with hand-computable totals.
    private const string SampleJson = """
    [
      {"total_energy_added_wh":100,"cost_decimal":10,"peak_power_w":7000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T01:00:00Z"},
      {"total_energy_added_wh":50,"cost_decimal":0,"peak_power_w":5000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:30:00Z"},
      {"total_energy_added_wh":300,"cost_decimal":30,"charger_type":"Supercharger","peak_power_w":150000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:20:00Z"},
      {"total_energy_added_wh":200,"cost_decimal":null,"peak_power_w":50000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:40:00Z"}
    ]
    """;

    // ---- Compute: breakdown math, DC rule, free rule, duration ---------------------

    [Fact]
    public void Compute_buckets_sessions_and_totals_like_the_web_helper()
    {
        var breakdown = SampleBreakdown();

        Assert.Equal(150, breakdown.Ac.Energy);
        Assert.Equal(10, breakdown.Ac.Cost);
        Assert.Equal(2, breakdown.Ac.Count);
        Assert.Equal(90, breakdown.Ac.TotalDurationMinutes);
        Assert.Equal(1, breakdown.Ac.FreeCount);
        Assert.Equal(50, breakdown.Ac.FreeEnergy);

        Assert.Equal(500, breakdown.Dc.Energy);
        Assert.Equal(30, breakdown.Dc.Cost);
        Assert.Equal(2, breakdown.Dc.Count);
        Assert.Equal(60, breakdown.Dc.TotalDurationMinutes);
        Assert.Equal(1, breakdown.Dc.FreeCount);
        Assert.Equal(200, breakdown.Dc.FreeEnergy);

        Assert.Equal(650, breakdown.Total.Energy);
        Assert.Equal(40, breakdown.Total.Cost);
        Assert.Equal(250, breakdown.Total.FreeEnergy);
        Assert.Equal(2, breakdown.Total.FreeCount);
        Assert.Equal(4, breakdown.TotalCount);
    }

    [Theory]
    [InlineData("Home", 1000, true)]        // any non-empty charger_type → DC (web parity, even "Home")
    [InlineData("Supercharger", 0, true)]   // charger_type present → DC regardless of power
    [InlineData(null, 30000, true)]         // no charger_type but peak power above the 22 kW ceiling → DC
    [InlineData("", 50000, true)]           // empty charger_type falls back to the power test → DC
    [InlineData(null, 22000, false)]        // exactly 22 kW is not above the ceiling → AC
    [InlineData(null, 5000, false)]         // low power, no charger_type → AC
    [InlineData("", 1000, false)]           // empty charger_type, low power → AC
    public void Compute_dc_rule_matches_web_isDC(string? chargerType, double peakPowerW, bool expectDc)
    {
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 1000, Cost: 5, ChargerType: chargerType, PeakPowerW: peakPowerW, StartedAt: null, EndedAt: null),
        };

        var breakdown = AcDcStatsCompute.Compute(sessions);

        Assert.Equal(expectDc ? 1 : 0, breakdown.Dc.Count);
        Assert.Equal(expectDc ? 0 : 1, breakdown.Ac.Count);
    }

    [Theory]
    [InlineData(null, true)]   // missing cost → free
    [InlineData(0.0, true)]    // zero cost → free
    [InlineData(5.0, false)]   // positive cost → paid
    [InlineData(-1.0, false)]  // negative cost is not exactly zero → paid (web `!cost || cost === 0`)
    public void Compute_free_rule_matches_web(double? cost, bool expectFree)
    {
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 100, Cost: cost, ChargerType: null, PeakPowerW: 1000, StartedAt: null, EndedAt: null),
        };

        var breakdown = AcDcStatsCompute.Compute(sessions);

        Assert.Equal(expectFree ? 1 : 0, breakdown.Ac.FreeCount);
        Assert.Equal(expectFree ? 100 : 0, breakdown.Ac.FreeEnergy);
    }

    [Fact]
    public void DurationMinutes_ports_the_web_helper_rules()
    {
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal(0, AcDcStatsCompute.DurationMinutes(start, null));        // no end → 0
        Assert.Equal(0, AcDcStatsCompute.DurationMinutes(null, start));        // no start → 0
        Assert.Equal(0, AcDcStatsCompute.DurationMinutes(start, start));       // end == start → 0
        Assert.Equal(0, AcDcStatsCompute.DurationMinutes(start.AddMinutes(5), start)); // end < start → 0
        Assert.Equal(60, AcDcStatsCompute.DurationMinutes(start, start.AddHours(1)));
        Assert.Equal(2, AcDcStatsCompute.DurationMinutes(start, start.AddSeconds(90))); // 1.5 min rounds away → 2
    }

    [Fact]
    public void Compute_is_null_tolerant_for_missing_fields()
    {
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 0, Cost: null, ChargerType: null, PeakPowerW: null, StartedAt: null, EndedAt: null),
        };

        var breakdown = AcDcStatsCompute.Compute(sessions);

        Assert.Equal(1, breakdown.Ac.Count); // null power → AC
        Assert.Equal(1, breakdown.Ac.FreeCount); // null cost → free
        Assert.Equal(0, breakdown.Ac.TotalDurationMinutes); // null timestamps → 0
    }

    // ---- JSON parse adapter --------------------------------------------------------

    [Fact]
    public void Parse_reads_the_real_api_fields()
    {
        var sessions = ParseSample();

        Assert.Equal(4, sessions.Count);
        Assert.Equal(100, sessions[0].EnergyWh);
        Assert.Equal(10, sessions[0].Cost);
        Assert.Null(sessions[0].ChargerType);
        Assert.Equal(7000, sessions[0].PeakPowerW);
        Assert.Equal("Supercharger", sessions[2].ChargerType);
        Assert.Null(sessions[3].Cost); // explicit JSON null
        Assert.NotNull(sessions[0].StartedAt);
        Assert.NotNull(sessions[0].EndedAt);
    }

    [Fact]
    public void Parse_is_tolerant_of_non_array_and_partial_rows()
    {
        using var notArray = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(AcDcChargingSession.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("""[{"total_energy_added_wh":"1234.5"},{}]""");
        var rows = AcDcChargingSession.ParseList(partial.RootElement);
        Assert.Equal(2, rows.Count);
        Assert.Equal(1234.5, rows[0].EnergyWh); // numeric string coerced
        Assert.Equal(0, rows[1].EnergyWh);      // missing field → 0
        Assert.Null(rows[1].Cost);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_computes_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);

        var cached = AcDcStatsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(4, cached.Value!.TotalCount);

        var offline = AcDcStatsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(650, offline.Value!.Total.Energy);

        var loaded = AcDcStatsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Ac.Count);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, AcDcStatsResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, AcDcStatsResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, AcDcStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Formatters (web parity) ---------------------------------------------------

    [Fact]
    public void FormatEnergy_switches_to_mwh_at_a_thousand()
    {
        Assert.Equal("150.00 kWh", AcDcStatsProjection.FormatEnergy(150));
        Assert.Equal("999.50 kWh", AcDcStatsProjection.FormatEnergy(999.5));
        Assert.Equal("1.00 MWh", AcDcStatsProjection.FormatEnergy(1000));
        Assert.Equal("1.50 MWh", AcDcStatsProjection.FormatEnergy(1500));
        Assert.Equal("250.00 kWh", AcDcStatsProjection.FormatEnergyKwh(250)); // always kWh, no switch
        Assert.Equal("1,500.00 kWh", AcDcStatsProjection.FormatEnergyKwh(1500));
    }

    [Fact]
    public void FormatPercent_and_currency_and_count_match_web()
    {
        Assert.Equal("23.08%", AcDcStatsProjection.FormatPercent(150.0 / 650.0 * 100));
        Assert.Equal("$10.00", AcDcStatsProjection.FormatCurrency(10, "$"));
        Assert.Equal("€1,234.50", AcDcStatsProjection.FormatCurrency(1234.5, "€"));
        Assert.Equal(AcDcStatsProjection.EmDash, AcDcStatsProjection.FormatCurrency(double.NaN, "$"));
        Assert.Equal("1234", AcDcStatsProjection.FormatCount(1234)); // raw, no grouping (web `{count}`)
    }

    [Fact]
    public void FormatDuration_ports_formatDurationMinutes()
    {
        Assert.Equal("0m", AcDcStatsProjection.FormatDuration(0));
        Assert.Equal("45m", AcDcStatsProjection.FormatDuration(45));
        Assert.Equal("1h 5m", AcDcStatsProjection.FormatDuration(65));
        Assert.Equal("2h 5m", AcDcStatsProjection.FormatDuration(125.4));
        Assert.Equal(AcDcStatsProjection.EmDash, AcDcStatsProjection.FormatDuration(-1));
        Assert.Equal(AcDcStatsProjection.EmDash, AcDcStatsProjection.FormatDuration(double.NaN));
    }

    // ---- Projection: energy split + table rows + free footer -----------------------

    [Fact]
    public void Project_builds_the_energy_split_bar()
    {
        var split = AcDcStatsProjection.Project(SampleBreakdown(), Localizer).Split;

        Assert.True(split.AcShown);
        Assert.True(split.DcShown);
        Assert.Equal(150.0 / 650.0 * 100, split.AcWeight, 6);
        Assert.Equal(500.0 / 650.0 * 100, split.DcWeight, 6);
        Assert.Equal("AC 23.08%", split.AcSegmentText);
        Assert.Equal("DC 76.92%", split.DcSegmentText);
        Assert.Equal("AC: 150.00 kWh", split.AcEnergyText);
        Assert.Equal("Total: 650.00 kWh", split.TotalEnergyText);
        Assert.Equal("DC: 500.00 kWh", split.DcEnergyText);
    }

    [Fact]
    public void Project_builds_ac_and_dc_table_rows_in_order()
    {
        var display = AcDcStatsProjection.Project(SampleBreakdown(), Localizer);

        Assert.True(display.HasRows);
        Assert.Equal(2, display.Rows.Count);

        var ac = display.Rows[0];
        Assert.Equal("AC Charging", ac.Label);
        Assert.Equal(StatusKind.Info, ac.Accent);
        Assert.Equal("2", ac.SessionsText);
        Assert.Equal("150.00 kWh", ac.EnergyText);
        Assert.Equal("$10.00", ac.CostText);
        Assert.Equal("$0.07", ac.PerKwhText); // 10 / 150
        Assert.Equal("75.00 kWh", ac.AvgEnergyText); // 150 / 2
        Assert.Equal("45m", ac.AvgTimeText); // 90 / 2
        Assert.Equal("1 (50.00 kWh)", ac.FreeText);

        var dc = display.Rows[1];
        Assert.Equal("DC Charging", dc.Label);
        Assert.Equal(StatusKind.Warning, dc.Accent);
        Assert.Equal("500.00 kWh", dc.EnergyText);
        Assert.Equal("$30.00", dc.CostText);
        Assert.Equal("$0.06", dc.PerKwhText); // 30 / 500
        Assert.Equal("250.00 kWh", dc.AvgEnergyText);
        Assert.Equal("30m", dc.AvgTimeText);
        Assert.Equal("1 (200.00 kWh)", dc.FreeText);
    }

    [Fact]
    public void Project_builds_the_free_footer_with_label_and_value_parts()
    {
        var display = AcDcStatsProjection.Project(SampleBreakdown(), Localizer);

        Assert.True(display.HasFree);
        Assert.Equal("Free charged", display.FreeChargedLabel);
        Assert.Equal("2 sessions", display.FreeSessionsValue);
        Assert.Equal("Free energy", display.FreeEnergyLabel);
        Assert.Equal("250.00 kWh", display.FreeEnergyValue);
    }

    [Fact]
    public void Project_filters_zero_count_buckets_and_gates_the_free_footer()
    {
        // Only AC sessions, all paid — no DC row, no free footer.
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 100, Cost: 5, ChargerType: null, PeakPowerW: 5000, StartedAt: null, EndedAt: null),
        };
        var display = AcDcStatsProjection.Project(AcDcStatsCompute.Compute(sessions), Localizer);

        Assert.Single(display.Rows);
        Assert.Equal("AC Charging", display.Rows[0].Label);
        Assert.False(display.HasFree);
        Assert.Equal(string.Empty, display.FreeSessionsValue);
    }

    [Fact]
    public void Project_em_dash_for_per_kwh_when_a_bucket_has_no_energy()
    {
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 0, Cost: 0, ChargerType: null, PeakPowerW: 5000, StartedAt: null, EndedAt: null),
        };
        var row = AcDcStatsProjection.Project(AcDcStatsCompute.Compute(sessions), Localizer).Rows[0];

        Assert.Equal("0.00 kWh", row.EnergyText);
        Assert.Equal(AcDcStatsProjection.EmDash, row.PerKwhText); // energy == 0 → no $/kWh
        Assert.Equal("$0.00", row.CostText);
        Assert.Equal("1 (0.00 kWh)", row.FreeText); // cost 0 → free
    }

    [Fact]
    public void Project_renders_mwh_for_a_large_bucket()
    {
        var sessions = new List<AcDcChargingSession>
        {
            new(EnergyWh: 1500, Cost: 60, ChargerType: "Supercharger", PeakPowerW: 150000, StartedAt: null, EndedAt: null),
        };
        var row = AcDcStatsProjection.Project(AcDcStatsCompute.Compute(sessions), Localizer).Rows[0];

        Assert.Equal("1.50 MWh", row.EnergyText);
        Assert.Equal("1,500.00 kWh", row.AvgEnergyText); // avg energy stays in kWh
    }

    [Fact]
    public void Project_null_or_empty_breakdown_is_the_empty_display()
    {
        Assert.False(AcDcStatsProjection.Project(null, Localizer).HasRows);

        var empty = AcDcStatsCompute.Compute(Array.Empty<AcDcChargingSession>());
        var display = AcDcStatsProjection.Project(empty, Localizer);
        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
        Assert.False(display.HasFree);
    }

    [Fact]
    public void Project_honours_a_currency_symbol_override()
    {
        var display = AcDcStatsProjection.Project(SampleBreakdown(), Localizer, "€");
        Assert.Equal("€10.00", display.Rows[0].CostText);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_the_request()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new AcDcStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(4, emissions[^1].Value!.TotalCount);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new AcDcStatsSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new AcDcStatsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var cache = new InMemoryCacheStore();
        var options = new ApiClientOptions();
        var engine = new CacheThenNetworkEngine(cache, () => Now);

        var ok = new AcDcStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new AcDcStatsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(650, emissions[^1].Value!.Total.Energy);
    }

    // ---- View-model state matrix (loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_projected_content()
    {
        var source = new FakeAcDcSource(
            RepositoryResult<AcDcBreakdown>.Loading(),
            RepositoryResult<AcDcBreakdown>.Loaded(SampleBreakdown(), Now));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Ready, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_null_body_is_whole_surface_empty()
    {
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.Empty(Now));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
    }

    [Fact]
    public async Task ViewModel_loaded_but_zero_count_breakdown_is_empty()
    {
        var empty = AcDcStatsCompute.Compute(Array.Empty<AcDcChargingSession>());
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.Loaded(empty, Now));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_chip()
    {
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.Cached(SampleBreakdown(), Now, stale: true));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
        Assert.Equal(vm.StaleLabel, vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_chip()
    {
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.OfflineCached(
            SampleBreakdown(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_empty_scaffold_and_retry_state()
    {
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AcDcStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.Display.HasRows);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeAcDcSource(RepositoryResult<AcDcBreakdown>.Loaded(SampleBreakdown(), Now));
        using var vm = new AcDcStatsViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(AcDcStatsState.Ready, vm.State);
    }

    // ---- i18n facade coverage + accessibility + registry + diagnostics -------------

    [Fact]
    public void Every_surface_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = AcDcStatsProjection.Project(SampleBreakdown(), recorder);
        _ = AcDcStatsRegistration.Title(recorder);
        _ = AcDcStatsRegistration.EnergySplitLabel(recorder);
        _ = AcDcStatsRegistration.TypeHeader(recorder);
        _ = AcDcStatsRegistration.EnergyHeader(recorder);
        _ = AcDcStatsRegistration.CostPerKwhHeader(recorder);
        _ = AcDcStatsRegistration.AvgEnergyHeader(recorder);
        _ = AcDcStatsRegistration.AvgTimeHeader(recorder);

        // Every t() key the web AcDcStatsPanel uses must be requested by name.
        Assert.Contains("charging.stats.chargingByType", recorder.Keys);
        Assert.Contains("charging.stats.energySplitLabel", recorder.Keys);
        Assert.Contains("charging.table.type", recorder.Keys);
        Assert.Contains("charging.table.sessionCount", recorder.Keys);
        Assert.Contains("charging.table.energy", recorder.Keys);
        Assert.Contains("charging.table.cost", recorder.Keys);
        Assert.Contains("charging.table.costPerKwh", recorder.Keys);
        Assert.Contains("charging.table.avgEnergy", recorder.Keys);
        Assert.Contains("charging.table.avgTime", recorder.Keys);
        Assert.Contains("charging.table.free", recorder.Keys);
        Assert.Contains("charging.table.acCharging", recorder.Keys);
        Assert.Contains("charging.table.dcCharging", recorder.Keys);
        Assert.Contains("charging.table.freeCharged", recorder.Keys);
        Assert.Contains("charging.table.freeEnergy", recorder.Keys);
    }

    [Fact]
    public void Rows_and_footer_carry_accessible_names()
    {
        var display = AcDcStatsProjection.Project(SampleBreakdown(), Localizer);

        Assert.All(display.Rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("AC Charging", display.Rows[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains("150.00 kWh", display.Rows[0].AutomationName, StringComparison.Ordinal);
        Assert.Contains("Sessions", display.Rows[0].AutomationName, StringComparison.Ordinal);

        Assert.False(string.IsNullOrWhiteSpace(display.FreeFooterAutomationName));
        Assert.Contains("250.00 kWh", display.FreeFooterAutomationName, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(AcDcStatsRegistration.StaleLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AcDcStatsRegistration.OfflineLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AcDcStatsRegistration.RetryLabel(Localizer)));
    }

    [Fact]
    public void Registration_exposes_a_stable_slug_and_currency_default()
    {
        Assert.Equal("AcDcStatsPanel", AcDcStatsRegistration.Slug);
        Assert.Equal("$", AcDcStatsRegistration.DefaultCurrencySymbol);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new AcDcStatsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=AcDcStatsPanel", line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
    }

    // ---- helpers -------------------------------------------------------------------

    private static IReadOnlyList<AcDcChargingSession> ParseSample()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        return AcDcChargingSession.ParseList(doc.RootElement);
    }

    private static AcDcBreakdown SampleBreakdown() => AcDcStatsCompute.Compute(ParseSample());

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<AcDcBreakdown>>> Collect(
        IAsyncEnumerable<RepositoryResult<AcDcBreakdown>> stream)
    {
        var list = new List<RepositoryResult<AcDcBreakdown>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeAcDcSource(params RepositoryResult<AcDcBreakdown>[] results) : IAcDcStatsSource
    {
        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<AcDcBreakdown>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var result in results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
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
