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
/// Headless verification of the Charging Speed Trend surface's UI-thread-free logic — the charging-session
/// JSON parse adapter (peak_power_w / charger_type / started_at), the <c>isDcSession</c> DC/AC split, the
/// month bucketing (started_at.slice(0, 7)), the SI watts→kW conversion, the per-bucket DC/AC mean rounded to
/// one decimal, the ascending month sort and the empty-chart gate, the standalone legend, the cache-then-network
/// result mapper, the per-vehicle data source (query-scoped request + disabled-when-no-vehicle short-circuit),
/// the registry metadata, the PII-safe diagnostics, the per-row Narrator names and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx + helpers.ts).
/// </summary>
public sealed class SpeedTrendChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_peak_power_charger_type_and_started_at()
    {
        using var doc = JsonDocument.Parse(
            """{"peak_power_w":150000,"charger_type":"Supercharger","started_at":"2026-04-04T10:00:00Z"}""");

        var session = SpeedTrendSession.FromJson(doc.RootElement);

        Assert.Equal(150000, session.PeakPowerW);
        Assert.Equal("Supercharger", session.ChargerType);
        Assert.Equal("2026-04-04T10:00:00Z", session.StartedAt);
    }

    [Fact]
    public void FromJson_defaults_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var session = SpeedTrendSession.FromJson(doc.RootElement);

        Assert.Equal(0, session.PeakPowerW);
        Assert.Null(session.ChargerType);
        Assert.Null(session.StartedAt);
    }

    [Fact]
    public void FromJson_parses_numeric_string_power()
    {
        using var doc = JsonDocument.Parse("""{"peak_power_w":"48000"}""");

        Assert.Equal(48000, SpeedTrendSession.FromJson(doc.RootElement).PeakPowerW);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"peak_power_w":1000}, 7, {"peak_power_w":2000}]""");

        var list = SpeedTrendSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1000, list[0].PeakPowerW);
        Assert.Equal(2000, list[1].PeakPowerW);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"peak_power_w":1000}""");
        Assert.Empty(SpeedTrendSession.ParseList(doc.RootElement));
    }

    // ---- isDcSession (web helpers.ts) ----------------------------------------------

    [Fact]
    public void IsDcSession_true_when_charger_type_present_even_at_low_power()
    {
        Assert.True(SpeedTrendChartProjection.IsDcSession(new SpeedTrendSession(5000, "Home Wall Connector", null)));
    }

    [Fact]
    public void IsDcSession_true_when_power_exceeds_20kw_threshold_without_charger_type()
    {
        Assert.True(SpeedTrendChartProjection.IsDcSession(new SpeedTrendSession(25000, null, null)));
    }

    [Fact]
    public void IsDcSession_false_for_untyped_low_power_session()
    {
        Assert.False(SpeedTrendChartProjection.IsDcSession(new SpeedTrendSession(7000, null, null)));
        Assert.False(SpeedTrendChartProjection.IsDcSession(new SpeedTrendSession(20000, string.Empty, null)));
    }

    // ---- Projection (grouping / split / kW / rounding / sort) ----------------------

    [Fact]
    public void Project_buckets_by_month_splits_dc_ac_and_averages_in_kw()
    {
        var display = Project(
            S(150000, "Supercharger", "2026-04-04T10:00:00Z"),
            S(50000, "CCS", "2026-04-20T08:00:00Z"),
            S(7000, null, "2026-04-10T22:00:00Z"),
            S(11000, null, "2026-04-15T07:00:00Z"),
            S(120000, "dc", "2026-05-01T09:00:00Z"));

        Assert.True(display.HasData);
        Assert.Equal(2, display.Months.Count);

        var april = display.Months[0];
        Assert.Equal("2026-04", april.Month);
        Assert.Equal(100.0, april.DcAvgKw); // (150 + 50) / 2
        Assert.Equal(9.0, april.AcAvgKw);   // (7 + 11) / 2

        var may = display.Months[1];
        Assert.Equal("2026-05", may.Month);
        Assert.Equal(120.0, may.DcAvgKw);
        Assert.Equal(0.0, may.AcAvgKw); // no AC sessions → web avg([]) === 0
    }

    [Fact]
    public void Project_sorts_months_ascending()
    {
        var display = Project(
            S(120000, "dc", "2026-05-01T09:00:00Z"),
            S(60000, "dc", "2026-01-01T09:00:00Z"),
            S(90000, "dc", "2026-03-01T09:00:00Z"));

        Assert.Equal(new[] { "2026-01", "2026-03", "2026-05" }, display.Months.Select(m => m.Month).ToArray());
    }

    [Fact]
    public void Project_rounds_averages_to_one_decimal_half_up()
    {
        // DC kW 10, 11, 13 → avg 11.333 → 11.3 (round down).
        var down = Project(
            S(10000, "dc", "2026-04-01T00:00:00Z"),
            S(11000, "dc", "2026-04-02T00:00:00Z"),
            S(13000, "dc", "2026-04-03T00:00:00Z"));
        Assert.Equal(11.3, down.Months[0].DcAvgKw);
        Assert.Equal("11.3", down.Months[0].DcAvgText);

        // DC kW 10, 11, 12, 13, 14, 16 → avg 12.666 → 12.7 (round up).
        var up = Project(
            S(10000, "dc", "2026-04-01T00:00:00Z"),
            S(11000, "dc", "2026-04-02T00:00:00Z"),
            S(12000, "dc", "2026-04-03T00:00:00Z"),
            S(13000, "dc", "2026-04-04T00:00:00Z"),
            S(14000, "dc", "2026-04-05T00:00:00Z"),
            S(16000, "dc", "2026-04-06T00:00:00Z"));
        Assert.Equal(12.7, up.Months[0].DcAvgKw);
        Assert.Equal("12.7", up.Months[0].DcAvgText);
    }

    [Fact]
    public void Project_buckets_missing_started_at_under_empty_month()
    {
        var display = Project(S(50000, "dc", null));

        Assert.Single(display.Months);
        Assert.Equal(string.Empty, display.Months[0].Month);
        Assert.Equal(50.0, display.Months[0].DcAvgKw);
    }

    [Fact]
    public void Project_empty_sessions_reports_no_data()
    {
        var display = SpeedTrendChartProjection.Project(Array.Empty<SpeedTrendSession>(), Localizer);

        Assert.False(display.HasData);
        Assert.Empty(display.Months);
    }

    [Fact]
    public void Project_exposes_localized_chrome_and_column_labels()
    {
        var display = Project(S(50000, "dc", "2026-04-01T00:00:00Z"));

        Assert.Equal("Charging Speed Trend", display.Title);
        Assert.Equal("Monthly average DC vs AC charge rate", display.Subtitle);
        Assert.Equal("Monthly average DC and AC charging speed line chart", display.ChartAriaLabel);
        Assert.Equal("Avg kW", display.AxisLabel);
        Assert.Equal("DC Avg", display.DcSeriesLabel);
        Assert.Equal("AC Avg", display.AcSeriesLabel);
        Assert.Equal("Month", display.MonthColumnLabel);
        Assert.Equal("DC Avg kW", display.DcColumnLabel);
        Assert.Equal("AC Avg kW", display.AcColumnLabel);
    }

    [Fact]
    public void Project_legend_has_dc_and_ac_chips_with_semantic_brushes()
    {
        var legend = Project(S(50000, "dc", "2026-04-01T00:00:00Z")).Legend;

        Assert.Equal(2, legend.Count);
        Assert.Equal("DC Fast", legend[0].Label);
        Assert.Equal("TsColorInfoBrush", legend[0].ColorBrushKey);
        Assert.Equal("AC / Home", legend[1].Label);
        Assert.Equal("TsColorSuccessBrush", legend[1].ColorBrushKey);
    }

    [Fact]
    public void Project_row_automation_name_carries_month_values_and_units()
    {
        var row = Project(
            S(150000, "Supercharger", "2026-04-04T10:00:00Z"),
            S(7000, null, "2026-04-10T22:00:00Z")).Months[0];

        Assert.Equal("2026-04: DC Avg 150.0 kW, AC Avg 7.0 kW", row.AutomationName);
    }

    [Fact]
    public void Project_series_color_indices_mirror_web_palette_order()
    {
        Assert.Equal(0, SpeedTrendChartProjection.DcSeriesColorIndex);
        Assert.Equal(1, SpeedTrendChartProjection.AcSeriesColorIndex);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"peak_power_w":50000,"charger_type":"dc","started_at":"2026-04-01T00:00:00Z"}]""");
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = SpeedTrendChartResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Single(mapped.Value!);
        Assert.Equal(50000, mapped.Value![0].PeakPowerW);
    }

    [Fact]
    public void Mapper_cached_payload_projects_to_monthly_rows()
    {
        using var doc = JsonDocument.Parse(
            """[{"peak_power_w":100000,"charger_type":"dc","started_at":"2026-04-01T00:00:00Z"}]""");
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: false);

        var mapped = SpeedTrendChartResultMapper.Map(cached);
        var display = SpeedTrendChartProjection.Project(mapped.Value!, Localizer);

        Assert.True(display.HasData);
        Assert.Equal("2026-04", display.Months[0].Month);
        Assert.Equal(100.0, display.Months[0].DcAvgKw);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, SpeedTrendChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, SpeedTrendChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = SpeedTrendChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new SpeedTrendChartViewModel(new FakeSource(), Localizer);
        Assert.Equal(SpeedTrendChartState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(
            Sessions(S(100000, "dc", "2026-04-01T00:00:00Z")), Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal("2026-04", vm.Display.Months[0].Month);
    }

    [Fact]
    public async Task ViewModel_loaded_but_no_sessions_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(
            Array.Empty<SpeedTrendSession>(), Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Cached(
            Sessions(S(100000, "dc", "2026-04-01T00:00:00Z")), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.OfflineCached(
            Sessions(S(100000, "dc", "2026-04-01T00:00:00Z")),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        var sessions = Sessions(S(80000, "dc", "2026-04-01T00:00:00Z"));
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loading(),
            RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Cached(sessions, Now, stale: false),
            RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(sessions, Now));

        await vm.LoadAsync();

        Assert.Equal(SpeedTrendChartState.Loaded, vm.State);
        Assert.Equal(80.0, vm.Display.Months[0].DcAvgKw);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(
            Sessions(S(80000, "dc", "2026-04-01T00:00:00Z")), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(SpeedTrendChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(
            Sessions(S(80000, "dc", "2026-04-01T00:00:00Z")), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SpeedTrendChartViewModel.State), changed);
        Assert.Contains(nameof(SpeedTrendChartViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charging Speed Trend", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_and_scopes_the_request_to_the_vehicle()
    {
        using var doc = JsonDocument.Parse(
            """[{"peak_power_w":100000,"charger_type":"dc","started_at":"2026-04-01T00:00:00Z"}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 7);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!);
        Assert.Equal(Operations.Charging.Sessions, client.Requests[^1].OperationId);
        Assert.Equal(7L, (long)client.Requests[^1].Query!["vehicle_id"]!);
    }

    [Fact]
    public async Task Source_treats_an_empty_array_as_empty()
    {
        var client = new FakeApiClient().ReturnsValue(EmptyArray());
        var source = NewSource(client, vehicleId: 7);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var client = new FakeApiClient();
        var source = NewSource(client, vehicleId: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(client.Requests);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("speed-trend-chart", SpeedTrendChartRegistration.Id);
        Assert.Equal("SpeedTrendChart", SpeedTrendChartRegistration.Slug);
        Assert.Equal("Charging Speed Trend", SpeedTrendChartRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedTrendChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedTrendChart", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SpeedTrendSession S(double peakPowerW, string? chargerType, string? startedAt) =>
        new(peakPowerW, chargerType, startedAt);

    private static IReadOnlyList<SpeedTrendSession> Sessions(params SpeedTrendSession[] sessions) => sessions;

    private static SpeedTrendChartDisplay Project(params SpeedTrendSession[] sessions) =>
        SpeedTrendChartProjection.Project(sessions, Localizer);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static SpeedTrendChartViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<SpeedTrendSession>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static SpeedTrendChartSource NewSource(IApiClient client, long? vehicleId)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new SpeedTrendChartSource(client, engine, options, vehicleId);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<SpeedTrendSession>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedTrendSession>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SpeedTrendSession>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<SpeedTrendSession>>[] emissions)
        : ISpeedTrendChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedTrendSession>>> StreamAsync(
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
