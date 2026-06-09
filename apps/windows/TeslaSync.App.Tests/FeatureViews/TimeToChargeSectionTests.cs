using System.Globalization;
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
/// Headless verification of the Time-to-Charge surface's UI-thread-free logic — the charging-session JSON
/// parse adapter, the <c>isDcSession</c> / <c>durationMinutes</c> derivations, the metric computation (the
/// 10→80 / 20→80 average durations and the fastest / slowest kWh/h reducers), the projection into four
/// localized cards (em-dash for a null metric, the "min" / "kWh/h" units, the "Session #id" subtitle), the
/// cache-then-network result mapper, the repository source's request shape, the state-holder view-model's
/// per-state matrix (loading / loaded / empty / error / stale / offline), the registry metadata and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx).
/// </summary>
public sealed class TimeToChargeSectionTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Two DC sessions (one crossing 10→80 + 20→80, one crossing 20→80 only) plus one AC session
    // (excluded). A=60 kWh/h is the fastest, B=42 kWh/h the slowest.
    private const string SessionsJson = """
    [
      { "id": 101, "start_soc_pct": 5, "end_soc_pct": 85, "started_at": "2026-01-01T10:00:00Z", "ended_at": "2026-01-01T10:30:00Z", "total_energy_added_wh": 30000, "charger_type": "Supercharger" },
      { "id": 202, "start_soc_pct": 15, "end_soc_pct": 82, "started_at": "2026-01-01T11:00:00Z", "ended_at": "2026-01-01T11:40:00Z", "total_energy_added_wh": 28000, "peak_power_w": 50000 },
      { "id": 303, "start_soc_pct": 10, "end_soc_pct": 90, "started_at": "2026-01-01T12:00:00Z", "ended_at": "2026-01-01T12:20:00Z", "total_energy_added_wh": 10000, "peak_power_w": 7000 }
    ]
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_every_session_field()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        var rows = TimeToChargeSessionRow.ParseList(doc.RootElement);

        Assert.Equal(3, rows.Count);
        Assert.Equal(101, rows[0].Id);
        Assert.Equal(5, rows[0].StartSocPct);
        Assert.Equal(85, rows[0].EndSocPct);
        Assert.Equal(30000, rows[0].TotalEnergyAddedWh);
        Assert.Equal("Supercharger", rows[0].ChargerType);
        Assert.Equal(50000, rows[1].PeakPowerW);
        Assert.NotNull(rows[0].StartedAt);
        Assert.NotNull(rows[0].EndedAt);
    }

    [Fact]
    public void ParseList_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(TimeToChargeSessionRow.ParseList(doc.RootElement));
    }

    [Fact]
    public void FromJson_tolerates_missing_and_non_numeric_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":"bad","total_energy_added_wh":"oops"}""");
        var row = TimeToChargeSessionRow.FromJson(doc.RootElement);

        Assert.Equal(0, row.Id);
        Assert.Null(row.StartSocPct);
        Assert.Null(row.EndSocPct);
        Assert.Null(row.StartedAt);
        Assert.Null(row.EndedAt);
        Assert.Equal(0, row.TotalEnergyAddedWh);
        Assert.Null(row.ChargerType);
        Assert.Null(row.PeakPowerW);
    }

    [Fact]
    public void FromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"id":"101","start_soc_pct":"5","total_energy_added_wh":"30000"}""");
        var row = TimeToChargeSessionRow.FromJson(doc.RootElement);

        Assert.Equal(101, row.Id);
        Assert.Equal(5, row.StartSocPct);
        Assert.Equal(30000, row.TotalEnergyAddedWh);
    }

    // ---- isDcSession (web isDcSession) ---------------------------------------------

    [Theory]
    [InlineData("Supercharger", null, true)]   // truthy charger_type
    [InlineData("", null, false)]              // empty string is falsy in JS
    [InlineData(null, 25000.0, true)]          // power over the 20 kW threshold
    [InlineData(null, 20000.0, false)]         // exactly the threshold is not over it
    [InlineData(null, 15000.0, false)]         // below threshold
    [InlineData(null, null, false)]            // neither signal
    public void IsDc_matches_web_classification(string? chargerType, double? peakW, bool expected)
    {
        var row = Row(1, 0, 100, Now, Now.AddMinutes(30), 1000, chargerType, peakW);
        Assert.Equal(expected, row.IsDc);
    }

    // ---- durationMinutes (web durationMinutes) -------------------------------------

    [Fact]
    public void DurationMinutes_rounds_to_whole_minutes()
    {
        var row = Row(1, 0, 100, Now, Now.AddSeconds(90), 1000, "DC", null);
        Assert.Equal(2, row.DurationMinutes); // 90s -> 1.5 min -> round-half-up -> 2
    }

    [Fact]
    public void DurationMinutes_is_zero_when_end_missing_or_not_after_start()
    {
        Assert.Equal(0, Row(1, 0, 100, Now, null, 1000, "DC", null).DurationMinutes);
        Assert.Equal(0, Row(1, 0, 100, Now, Now, 1000, "DC", null).DurationMinutes);
        Assert.Equal(0, Row(1, 0, 100, Now, Now.AddMinutes(-5), 1000, "DC", null).DurationMinutes);
        Assert.Equal(0, Row(1, 0, 100, null, Now, 1000, "DC", null).DurationMinutes);
    }

    // ---- Metric computation (web useMemo) ------------------------------------------

    [Fact]
    public void Compute_no_dc_sessions_is_empty()
    {
        var ac = Row(1, 5, 90, Now, Now.AddMinutes(30), 10000, null, 7000);
        var metrics = TimeToChargeMetrics.Compute(new[] { ac });

        Assert.Same(TimeToChargeMetrics.Empty, metrics);
        Assert.Equal(0, metrics.DcSessionCount);
        Assert.Null(metrics.Avg10To80);
        Assert.Null(metrics.Fastest);
    }

    [Fact]
    public void Compute_averages_threshold_bands_and_reduces_rates()
    {
        var metrics = TimeToChargeMetrics.Compute(Sample());

        Assert.Equal(2, metrics.DcSessionCount);
        Assert.Equal(30, metrics.Avg10To80!.Value);   // only session A (start 5) crosses 10→80
        Assert.Equal(35, metrics.Avg20To80!.Value);    // A (30) + B (40) -> 35
        Assert.NotNull(metrics.Fastest);
        Assert.Equal(101, metrics.Fastest!.Id);       // A: 60 kWh/h
        Assert.Equal(60, metrics.Fastest.Rate, 3);
        Assert.NotNull(metrics.Slowest);
        Assert.Equal(202, metrics.Slowest!.Id);       // B: 42 kWh/h
        Assert.Equal(42, metrics.Slowest.Rate, 3);
    }

    [Fact]
    public void Compute_band10_requires_start_at_or_below_10()
    {
        // start 11 does not cross 10→80; start 9 does.
        var miss = Row(1, 11, 85, Now, Now.AddMinutes(30), 30000, "DC", null);
        var hit = Row(2, 9, 85, Now, Now.AddMinutes(20), 30000, "DC", null);

        Assert.Null(TimeToChargeMetrics.Compute(new[] { miss }).Avg10To80);
        Assert.Equal(20, TimeToChargeMetrics.Compute(new[] { hit }).Avg10To80!.Value);
    }

    [Fact]
    public void Compute_band_requires_end_at_or_above_80()
    {
        var below = Row(1, 5, 79, Now, Now.AddMinutes(30), 30000, "DC", null);
        Assert.Null(TimeToChargeMetrics.Compute(new[] { below }).Avg10To80);
        Assert.Null(TimeToChargeMetrics.Compute(new[] { below }).Avg20To80);
    }

    [Fact]
    public void Compute_rate_requires_positive_duration_and_energy()
    {
        var noEnergy = Row(1, 5, 85, Now, Now.AddMinutes(30), 0, "DC", null);
        var noDuration = Row(2, 5, 85, Now, null, 30000, "DC", null);

        var metrics = TimeToChargeMetrics.Compute(new[] { noEnergy, noDuration });
        Assert.Null(metrics.Fastest);
        Assert.Null(metrics.Slowest);
    }

    [Fact]
    public void Compute_ties_keep_the_earlier_session()
    {
        // Two DC sessions with identical 60 kWh/h rate; the web reducers keep the first (a).
        var first = Row(1, 5, 85, Now, Now.AddMinutes(30), 30000, "DC", null);
        var second = Row(2, 5, 85, Now, Now.AddMinutes(30), 30000, "DC", null);

        var metrics = TimeToChargeMetrics.Compute(new[] { first, second });
        Assert.Equal(1, metrics.Fastest!.Id);
        Assert.Equal(1, metrics.Slowest!.Id);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_four_cards_with_units_and_subtitles()
    {
        var view = TimeToChargeProjection.Project(Sample(), Localizer);

        Assert.Equal(4, view.Cards.Count);
        Assert.True(view.HasData);

        Assert.Equal("10% \u2192 80%", view.Cards[0].Label);
        Assert.Equal("30.00", view.Cards[0].Value);
        Assert.Equal("min", view.Cards[0].Unit);
        Assert.Equal("Avg duration", view.Cards[0].Subtitle);

        Assert.Equal("35.00", view.Cards[1].Value);
        Assert.Equal("min", view.Cards[1].Unit);

        Assert.Equal("Fastest Session", view.Cards[2].Label);
        Assert.Equal("60.00", view.Cards[2].Value);
        Assert.Equal("kWh/h", view.Cards[2].Unit);
        Assert.Equal("Session #101", view.Cards[2].Subtitle);

        Assert.Equal("Slowest Session", view.Cards[3].Label);
        Assert.Equal("42.00", view.Cards[3].Value);
        Assert.Equal("Session #202", view.Cards[3].Subtitle);
    }

    [Fact]
    public void Project_null_metric_renders_em_dash_without_unit()
    {
        // One AC session: present (HasData), but no DC sessions so every metric is null.
        var ac = Row(1, 5, 90, Now, Now.AddMinutes(30), 10000, null, 7000);
        var view = TimeToChargeProjection.Project(new[] { ac }, Localizer);

        Assert.True(view.HasData); // a session exists — the web renders the cards (with em-dashes)
        foreach (var card in view.Cards)
        {
            Assert.Equal(EmDash, card.Value);
            Assert.Null(card.Unit); // web: unit only shown alongside a value
        }

        Assert.Null(view.Cards[2].Subtitle); // no fastest session id to caption
        Assert.Null(view.Cards[3].Subtitle);
        Assert.Equal("Avg duration", view.Cards[0].Subtitle); // duration cards keep their static subtitle
    }

    [Fact]
    public void Project_no_sessions_has_no_data()
    {
        var view = TimeToChargeProjection.Project(Array.Empty<TimeToChargeSessionRow>(), Localizer);

        Assert.False(view.HasData);
        Assert.Equal(4, view.Cards.Count);
        Assert.All(view.Cards, c => Assert.Equal(EmDash, c.Value));
    }

    [Fact]
    public void Project_resolves_title_and_description_through_i18n()
    {
        var view = TimeToChargeProjection.Project(Sample(), Localizer);

        Assert.Equal("Time-to-Charge Analysis", view.Title);
        Assert.Equal("How long DC sessions take to reach key SOC thresholds", view.Description);
        Assert.Equal(view.Title, view.AutomationName);
    }

    [Fact]
    public void Project_cards_have_accessibility_names_containing_label_and_value()
    {
        var view = TimeToChargeProjection.Project(Sample(), Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains("Session #101", view.Cards[2].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal("\u2014", TimeToChargeProjection.EmDash);
        Assert.Equal(2, TimeToChargeProjection.ValuePrecision);
        Assert.Equal(1000.0, TimeToChargeMetrics.WhPerKwh);
        Assert.Equal(60.0, TimeToChargeMetrics.MinutesPerHour);
        Assert.Equal(20_000, TimeToChargeSessionRow.DcPowerThresholdW);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SessionsJson);

        var cached = TimeToChargeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Count);

        var offline = TimeToChargeResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Count);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse(SessionsJson);

        Assert.Equal(LoadStatus.Loaded, TimeToChargeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
        Assert.Equal(LoadStatus.Empty, TimeToChargeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, TimeToChargeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
        Assert.Equal(LoadStatus.Loading, TimeToChargeResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_four_cards()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_sessions_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Array.Empty<TimeToChargeSessionRow>()));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No charging sessions to analyse yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_with_non_dc_sessions_stays_loaded_with_em_dashes()
    {
        // Web parity: sessions exist, so the section renders its cards (all em-dashes, no DC sessions).
        var ac = Row(1, 5, 90, Now, Now.AddMinutes(30), 10000, null, 7000);
        using var vm = NewViewModel(Loaded(new[] { ac }));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.All(vm.Display.Cards, c => Assert.Equal(EmDash, c.Value));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loading(),
            RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Cached(Sample(), Now, stale: false),
            RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(TimeToChargeState.Loaded, vm.State);
        Assert.Equal("60.00", vm.Display.Cards[2].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Time-to-Charge Analysis", vm.Title);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.Equal("Loading time-to-charge analysis", vm.LoadingLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TimeToChargeSectionViewModel.State), changed);
        Assert.Contains(nameof(TimeToChargeSectionViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_sessions_and_targets_the_charging_sessions_operation()
    {
        using var doc = JsonDocument.Parse(SessionsJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
    }

    [Fact]
    public async Task Source_scopes_by_vehicle_when_supplied()
    {
        using var doc = JsonDocument.Parse("[]");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new TimeToChargeSectionSource(client, NewEngine(), NewOptions(), vehicleId: 7);

        await Collect(source.StreamAsync());

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_array_streams_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("time-to-charge-section", TimeToChargeRegistration.Id);
        Assert.Equal("charging", TimeToChargeRegistration.Category);
        Assert.Equal("TimeToChargeSection", TimeToChargeRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TimeToChargeDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimeToChargeSection", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TimeToChargeSessionRow Row(
        long id,
        double? startSoc,
        double? endSoc,
        DateTimeOffset? startedAt,
        DateTimeOffset? endedAt,
        double wh,
        string? chargerType,
        double? peakW) =>
        new(id, startSoc, endSoc, startedAt, endedAt, wh, chargerType, peakW);

    private static IReadOnlyList<TimeToChargeSessionRow> Sample()
    {
        var start = new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero);
        return new[]
        {
            // A: DC, start 5 -> 85, 30 min, 30 kWh -> 60 kWh/h (crosses 10→80 and 20→80)
            Row(101, 5, 85, start, start.AddMinutes(30), 30000, "Supercharger", null),
            // B: DC, start 15 -> 82, 40 min, 28 kWh -> 42 kWh/h (crosses 20→80 only)
            Row(202, 15, 82, start.AddHours(1), start.AddHours(1).AddMinutes(40), 28000, null, 50000),
            // C: AC, excluded (charger_type null, power below threshold)
            Row(303, 10, 90, start.AddHours(2), start.AddHours(2).AddMinutes(20), 10000, null, 7000),
        };
    }

    private static RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>> Loaded(IReadOnlyList<TimeToChargeSessionRow> sessions) =>
        RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>.Loaded(sessions, Now);

    private static TimeToChargeSectionViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static TimeToChargeSectionSource NewSource(IApiClient client) => new(client, NewEngine(), NewOptions());

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>[] emissions)
        : ITimeToChargeSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TimeToChargeSessionRow>>> StreamAsync(
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
