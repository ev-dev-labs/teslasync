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
/// Headless verification of the QuickMetrics surface's UI-thread-free logic — the stats computation (the web
/// <c>computeStats</c> + <c>getChargerCategory</c> + <c>durationMinutes</c> ports, including the SI energy/power
/// conversions, the truthy peak-power filter and the home/supercharger/DC categorisation), the JSON parse
/// adapter, the cache-then-network result mapper, the projection (the web <c>&lt;AnimatedNumber/&gt;</c> count,
/// <c>formatDuration</c>, <c>&lt;Currency precision={0}/&gt;</c> and <c>fmtWithUnit(_, 'kWh')</c> formatting, plus
/// the six metric cells and their accents/glyphs), the repository source's vehicle-scoped request shape, the
/// state-holder view-model's full state matrix (loading / ready / empty / stale / offline / error), the i18n
/// facade key coverage, the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-list/QuickMetrics.tsx + helpers.ts). The WinUI view itself is
/// exercised by the app build; its per-state branch selection is driven entirely by the view-model
/// <see cref="QuickMetricsState"/> asserted here.
/// </summary>
public sealed class QuickMetricsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // One home (null type, no peak power), one Supercharger and one DC (CCS) session — the DC session is free
    // (zero cost) — with hand-computable totals (60 kWh added, $20 cost, 120 min, 100 kW avg over two powered).
    private const string SampleJson = """
    [
      {"total_energy_added_wh":10000,"cost_decimal":5,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T01:00:00Z"},
      {"total_energy_added_wh":20000,"cost_decimal":15,"charger_type":"Supercharger","peak_power_w":150000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:30:00Z"},
      {"total_energy_added_wh":30000,"cost_decimal":0,"charger_type":"CCS","peak_power_w":50000,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:30:00Z"}
    ]
    """;

    // ---- Compute: stats math, conversions, categorisation, duration ----------------

    [Fact]
    public void Compute_aggregates_like_the_web_computeStats()
    {
        var stats = SampleStats();

        Assert.Equal(60, stats.TotalEnergyKwh);          // (10000+20000+30000) Wh → 60 kWh
        Assert.Equal(20, stats.TotalCost);               // 5 + 15 + 0
        Assert.Equal(120, stats.TotalDurationMinutes);   // 60 + 30 + 30
        Assert.Equal(100, stats.AvgPowerKw);             // (150000 + 50000) / 2 / 1000
        Assert.Equal(20.0 / 60.0, stats.AvgCostPerKwh, 6); // totalCost / totalEnergyKwh
        Assert.Equal(1, stats.HomeCount);                // null charger type → home
        Assert.Equal(1, stats.ScCount);                  // "Supercharger" → supercharger
        Assert.Equal(1, stats.DcCount);                  // "CCS" → dc
        Assert.Equal(3, stats.Count);
        Assert.False(stats.IsEmpty);
    }

    [Fact]
    public void Compute_returns_zero_empty_stats_for_no_sessions()
    {
        var stats = QuickMetricsCompute.Compute(Array.Empty<QuickMetricsSession>());

        Assert.True(stats.IsEmpty);          // web parity: computeStats returns null for an empty list
        Assert.Equal(0, stats.Count);
        Assert.Equal(0, stats.TotalEnergyKwh);
        Assert.Same(QuickMetricsStats.Zero, stats);
    }

    [Theory]
    [InlineData(null, QuickMetricsChargerCategory.Home)]         // null → home (historical AC)
    [InlineData("", QuickMetricsChargerCategory.Home)]           // empty → home
    [InlineData("Supercharger", QuickMetricsChargerCategory.Supercharger)]
    [InlineData("Tesla TPC", QuickMetricsChargerCategory.Supercharger)] // "tpc"
    [InlineData("CCS", QuickMetricsChargerCategory.Dc)]
    [InlineData("CHAdeMO", QuickMetricsChargerCategory.Dc)]
    [InlineData("DC Fast", QuickMetricsChargerCategory.Dc)]
    [InlineData("Home Wall Connector", QuickMetricsChargerCategory.Home)] // "home" / "wall"
    [InlineData("AC", QuickMetricsChargerCategory.Home)]
    [InlineData("Mystery", QuickMetricsChargerCategory.Unknown)]
    public void Categorize_ports_getChargerCategory(string? chargerType, QuickMetricsChargerCategory expected)
    {
        Assert.Equal(expected, QuickMetricsCompute.Categorize(chargerType));
    }

    [Fact]
    public void Compute_only_averages_power_over_truthy_peak_powers()
    {
        // Web parity: `sessions.filter(s => s.peak_power_w)` drops null and 0 powers before averaging.
        var sessions = new List<QuickMetricsSession>
        {
            new(EnergyWh: 0, Cost: 0, ChargerType: null, PeakPowerW: null, StartedAt: null, EndedAt: null),
            new(EnergyWh: 0, Cost: 0, ChargerType: null, PeakPowerW: 0, StartedAt: null, EndedAt: null),
            new(EnergyWh: 0, Cost: 0, ChargerType: null, PeakPowerW: 10000, StartedAt: null, EndedAt: null),
            new(EnergyWh: 0, Cost: 0, ChargerType: null, PeakPowerW: 30000, StartedAt: null, EndedAt: null),
        };

        var stats = QuickMetricsCompute.Compute(sessions);

        Assert.Equal(20, stats.AvgPowerKw); // (10000 + 30000) / 2 / 1000 — the two zero/null powers are excluded
    }

    [Fact]
    public void Compute_unknown_category_counts_toward_none_of_the_three_buckets()
    {
        var sessions = new List<QuickMetricsSession>
        {
            new(EnergyWh: 1000, Cost: 1, ChargerType: "Mystery", PeakPowerW: 1000, StartedAt: null, EndedAt: null),
        };

        var stats = QuickMetricsCompute.Compute(sessions);

        Assert.Equal(0, stats.HomeCount);
        Assert.Equal(0, stats.ScCount);
        Assert.Equal(0, stats.DcCount);
        Assert.Equal(1, stats.Count); // still counted in the total
    }

    [Fact]
    public void DurationMinutes_ports_the_web_helper_rules()
    {
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal(0, QuickMetricsCompute.DurationMinutes(start, null));        // no end → 0
        Assert.Equal(0, QuickMetricsCompute.DurationMinutes(null, start));        // no start → 0
        Assert.Equal(0, QuickMetricsCompute.DurationMinutes(start, start));       // end == start → 0
        Assert.Equal(0, QuickMetricsCompute.DurationMinutes(start.AddMinutes(5), start)); // end < start → 0
        Assert.Equal(60, QuickMetricsCompute.DurationMinutes(start, start.AddHours(1)));
        Assert.Equal(2, QuickMetricsCompute.DurationMinutes(start, start.AddSeconds(90))); // 1.5 min rounds away → 2
    }

    [Fact]
    public void Compute_is_null_tolerant_for_missing_fields()
    {
        var sessions = new List<QuickMetricsSession>
        {
            new(EnergyWh: 0, Cost: null, ChargerType: null, PeakPowerW: null, StartedAt: null, EndedAt: null),
        };

        var stats = QuickMetricsCompute.Compute(sessions);

        Assert.Equal(1, stats.HomeCount);            // null type → home
        Assert.Equal(0, stats.TotalCost);            // null cost → 0
        Assert.Equal(0, stats.TotalDurationMinutes); // null timestamps → 0
        Assert.Equal(0, stats.AvgPowerKw);           // no powered sessions → 0
    }

    // ---- JSON parse adapter --------------------------------------------------------

    [Fact]
    public void Parse_reads_the_real_api_fields()
    {
        var sessions = ParseSample();

        Assert.Equal(3, sessions.Count);
        Assert.Equal(10000, sessions[0].EnergyWh);
        Assert.Equal(5, sessions[0].Cost);
        Assert.Null(sessions[0].ChargerType);
        Assert.Null(sessions[0].PeakPowerW);
        Assert.Equal("Supercharger", sessions[1].ChargerType);
        Assert.Equal(150000, sessions[1].PeakPowerW);
        Assert.Equal(0, sessions[2].Cost);
        Assert.NotNull(sessions[0].StartedAt);
        Assert.NotNull(sessions[0].EndedAt);
    }

    [Fact]
    public void Parse_is_tolerant_of_non_array_and_partial_rows()
    {
        using var notArray = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(QuickMetricsSession.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("""[{"total_energy_added_wh":"1234.5"},{}]""");
        var rows = QuickMetricsSession.ParseList(partial.RootElement);
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

        var cached = QuickMetricsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Count);

        var offline = QuickMetricsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(60, offline.Value!.TotalEnergyKwh);

        var loaded = QuickMetricsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(1, loaded.Value!.ScCount);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, QuickMetricsResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, QuickMetricsResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, QuickMetricsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Formatters (web parity) ---------------------------------------------------

    [Fact]
    public void FormatCount_renders_like_the_web_animated_number()
    {
        Assert.Equal("0", QuickMetricsProjection.FormatCount(0));
        Assert.Equal("7", QuickMetricsProjection.FormatCount(7));
        Assert.Equal("1,234", QuickMetricsProjection.FormatCount(1234)); // web fmtNumber(n, 0) groups thousands
    }

    [Fact]
    public void FormatDuration_ports_formatDurationMinutes()
    {
        Assert.Equal("0m", QuickMetricsProjection.FormatDuration(0));
        Assert.Equal("45m", QuickMetricsProjection.FormatDuration(45));
        Assert.Equal("2h 0m", QuickMetricsProjection.FormatDuration(120));
        Assert.Equal("1h 5m", QuickMetricsProjection.FormatDuration(65));
        Assert.Equal("2h 5m", QuickMetricsProjection.FormatDuration(125.4));
        Assert.Equal(QuickMetricsProjection.EmDash, QuickMetricsProjection.FormatDuration(-1));
        Assert.Equal(QuickMetricsProjection.EmDash, QuickMetricsProjection.FormatDuration(double.NaN));
    }

    [Fact]
    public void FormatCurrency_and_energy_match_web()
    {
        Assert.Equal("$2", QuickMetricsProjection.FormatCurrency(20.0 / 12.0, "$", 0)); // 1.6667 → $2 (precision 0)
        Assert.Equal("€1,234", QuickMetricsProjection.FormatCurrency(1234, "€", 0));
        Assert.Equal("$10.00", QuickMetricsProjection.FormatCurrency(10, "$", 2));
        Assert.Equal(QuickMetricsProjection.EmDash, QuickMetricsProjection.FormatCurrency(double.NaN, "$", 0));
        Assert.Equal("20.00 kWh", QuickMetricsProjection.FormatEnergyKwh(20));
        Assert.Equal("1,500.00 kWh", QuickMetricsProjection.FormatEnergyKwh(1500));
    }

    // ---- Projection: the six metric cells ------------------------------------------

    [Fact]
    public void Project_builds_the_six_metric_cells_in_order()
    {
        var display = QuickMetricsProjection.Project(SampleStats(), Localizer);

        Assert.True(display.HasData);
        Assert.Equal(6, display.Metrics.Count);

        var home = display.Metrics[0];
        Assert.Equal("Home", home.Label);
        Assert.Equal(StatusKind.Success, home.Accent);
        Assert.True(home.Animated);
        Assert.Equal(1, home.NumericValue);
        Assert.Equal("1", home.ValueText);
        Assert.Equal(QuickMetricsRegistration.HomeGlyph, home.Glyph);

        var sc = display.Metrics[1];
        Assert.Equal("Supercharger", sc.Label);
        Assert.Equal(StatusKind.Danger, sc.Accent);
        Assert.True(sc.Animated);
        Assert.Equal("1", sc.ValueText);

        var dc = display.Metrics[2];
        Assert.Equal("DC Fast", dc.Label);
        Assert.Equal(StatusKind.Warning, dc.Accent);
        Assert.Equal("1", dc.ValueText);

        var totalTime = display.Metrics[3];
        Assert.Equal("Total Time", totalTime.Label);
        Assert.Null(totalTime.Accent);   // web text-primary
        Assert.False(totalTime.Animated);
        Assert.Equal(string.Empty, totalTime.Glyph);
        Assert.Equal("2h 0m", totalTime.ValueText);

        var monthlyAvg = display.Metrics[4];
        Assert.Equal("Monthly Avg", monthlyAvg.Label);
        Assert.Equal("$2", monthlyAvg.ValueText); // 20 / 12 = 1.6667 → $2 at precision 0

        var perSession = display.Metrics[5];
        Assert.Equal("Per Session", perSession.Label);
        Assert.Equal("20.00 kWh", perSession.ValueText); // 60 kWh / 3 sessions
    }

    [Fact]
    public void Project_honours_a_currency_symbol_override()
    {
        var display = QuickMetricsProjection.Project(SampleStats(), Localizer, "€");
        Assert.Equal("€2", display.Metrics[4].ValueText);
    }

    [Fact]
    public void Project_null_or_empty_stats_is_the_empty_display()
    {
        Assert.False(QuickMetricsProjection.Project(null, Localizer).HasData);

        var empty = QuickMetricsCompute.Compute(Array.Empty<QuickMetricsSession>());
        var display = QuickMetricsProjection.Project(empty, Localizer);
        Assert.False(display.HasData);
        Assert.Empty(display.Metrics);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_the_request()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new QuickMetricsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new QuickMetricsSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new QuickMetricsSource(
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

        var ok = new QuickMetricsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new QuickMetricsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(60, emissions[^1].Value!.TotalEnergyKwh);
    }

    // ---- View-model state matrix (loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_projected_content()
    {
        var source = new FakeQuickMetricsSource(
            RepositoryResult<QuickMetricsStats>.Loading(),
            RepositoryResult<QuickMetricsStats>.Loaded(SampleStats(), Now));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Ready, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(6, vm.Display.Metrics.Count);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_null_body_is_whole_surface_empty()
    {
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.Empty(Now));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
    }

    [Fact]
    public async Task ViewModel_loaded_but_zero_session_stats_is_empty()
    {
        var empty = QuickMetricsCompute.Compute(Array.Empty<QuickMetricsSession>());
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.Loaded(empty, Now));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_chip()
    {
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.Cached(SampleStats(), Now, stale: true));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
        Assert.Equal(vm.StaleLabel, vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_chip()
    {
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.OfflineCached(
            SampleStats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_empty_scaffold_and_retry_state()
    {
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(QuickMetricsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.Display.HasData);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeQuickMetricsSource(RepositoryResult<QuickMetricsStats>.Loaded(SampleStats(), Now));
        using var vm = new QuickMetricsViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(QuickMetricsState.Ready, vm.State);
    }

    // ---- i18n facade coverage + accessibility + registry + diagnostics -------------

    [Fact]
    public void Every_surface_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = QuickMetricsProjection.Project(SampleStats(), recorder);
        _ = QuickMetricsRegistration.EmptyText(recorder);

        // Every t() key the web QuickMetrics uses must be requested by name.
        Assert.Contains("charging.metrics.home", recorder.Keys);
        Assert.Contains("charging.metrics.supercharger", recorder.Keys);
        Assert.Contains("charging.metrics.dcFast", recorder.Keys);
        Assert.Contains("charging.metrics.totalTime", recorder.Keys);
        Assert.Contains("charging.metrics.monthlyAvg", recorder.Keys);
        Assert.Contains("charging.metrics.perSession", recorder.Keys);
        Assert.Contains("charging.noMetrics", recorder.Keys);
    }

    [Fact]
    public void Cells_carry_accessible_names_with_label_and_value()
    {
        var display = QuickMetricsProjection.Project(SampleStats(), Localizer);

        Assert.All(display.Metrics, m => Assert.False(string.IsNullOrWhiteSpace(m.AutomationName)));
        Assert.Equal("Home: 1", display.Metrics[0].AutomationName);
        Assert.Equal("Total Time: 2h 0m", display.Metrics[3].AutomationName);
        Assert.Equal("Per Session: 20.00 kWh", display.Metrics[5].AutomationName);

        // The three count cells (web AnimatedNumber) carry a glyph; the three derived cells do not.
        Assert.All(display.Metrics.Take(3), m => Assert.False(string.IsNullOrEmpty(m.Glyph)));
        Assert.All(display.Metrics.Skip(3), m => Assert.Equal(string.Empty, m.Glyph));

        Assert.False(string.IsNullOrWhiteSpace(QuickMetricsRegistration.StaleLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(QuickMetricsRegistration.OfflineLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(QuickMetricsRegistration.RetryLabel(Localizer)));
    }

    [Fact]
    public void Registration_exposes_a_stable_slug_and_currency_default()
    {
        Assert.Equal("QuickMetrics", QuickMetricsRegistration.Slug);
        Assert.Equal("$", QuickMetricsRegistration.DefaultCurrencySymbol);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new QuickMetricsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=QuickMetrics", line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
    }

    // ---- helpers -------------------------------------------------------------------

    private static IReadOnlyList<QuickMetricsSession> ParseSample()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        return QuickMetricsSession.ParseList(doc.RootElement);
    }

    private static QuickMetricsStats SampleStats() => QuickMetricsCompute.Compute(ParseSample());

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<IReadOnlyList<RepositoryResult<QuickMetricsStats>>> Collect(
        IAsyncEnumerable<RepositoryResult<QuickMetricsStats>> stream)
    {
        var list = new List<RepositoryResult<QuickMetricsStats>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeQuickMetricsSource(params RepositoryResult<QuickMetricsStats>[] results) : IQuickMetricsSource
    {
        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<QuickMetricsStats>> StreamAsync(
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
