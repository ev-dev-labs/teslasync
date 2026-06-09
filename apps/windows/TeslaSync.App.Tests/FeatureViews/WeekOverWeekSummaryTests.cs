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
/// Headless verification of the Week-over-Week Comparison surface's UI-thread-free logic — the weekly-digest
/// JSON parse adapter (the five this-week + five prev-week figures, the derived CO₂, the web zero-coercion),
/// the projection (the six metric cards with their metric-unit + currency formatting, the per-card trend
/// invert flags, the a11y names), the <c>trendFor</c> port (signed percentage, flat threshold, lower-is-better
/// inversion), the cache-then-network result mapper, the repository source's weekly-digest request shape, the
/// state-holder view-model's per-state matrix (loading / loaded / empty / error / stale / offline), the
/// registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx).
/// </summary>
public sealed class WeekOverWeekSummaryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string DigestJson = """
    {
      "drives": 12,
      "distance_km": 320,
      "energy_kwh": 64,
      "cost": 9,
      "efficiency": 200,
      "prev_drives": 10,
      "prev_distance_km": 300,
      "prev_energy_kwh": 80,
      "prev_cost": 12,
      "prev_efficiency": 250
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromResponse_reads_all_ten_figures()
    {
        using var doc = JsonDocument.Parse(DigestJson);
        var metrics = WeekOverWeekMetrics.FromResponse(doc.RootElement);

        Assert.NotNull(metrics);
        Assert.Equal(12, metrics!.Drives);
        Assert.Equal(320, metrics.DistanceKm);
        Assert.Equal(64, metrics.EnergyKwh);
        Assert.Equal(9, metrics.Cost);
        Assert.Equal(200, metrics.EfficiencyWhKm);
        Assert.Equal(10, metrics.PrevDrives);
        Assert.Equal(300, metrics.PrevDistanceKm);
        Assert.Equal(80, metrics.PrevEnergyKwh);
        Assert.Equal(12, metrics.PrevCost);
        Assert.Equal(250, metrics.PrevEfficiencyWhKm);
    }

    [Fact]
    public void FromResponse_derives_co2_from_energy_like_web()
    {
        using var doc = JsonDocument.Parse(DigestJson);
        var metrics = WeekOverWeekMetrics.FromResponse(doc.RootElement)!;

        // web: co2Saved = energyUsed * CO2_PER_KWH_GASOLINE_KG (0.21)
        Assert.Equal(64 * 0.21, metrics.Co2SavedKg, 6);
        Assert.Equal(80 * 0.21, metrics.PrevCo2SavedKg, 6);
        Assert.Equal(0.21, WeekOverWeekMetrics.Co2PerKwhKg);
    }

    [Fact]
    public void FromResponse_coerces_absent_and_non_numeric_fields_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"drives":"oops","distance_km":null}""");
        var metrics = WeekOverWeekMetrics.FromResponse(doc.RootElement);

        Assert.NotNull(metrics);
        Assert.Equal(0, metrics!.Drives);
        Assert.Equal(0, metrics.DistanceKm);
        Assert.Equal(0, metrics.EnergyKwh);
    }

    [Fact]
    public void FromResponse_parses_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"distance_km":"123.5","prev_distance_km":"100"}""");
        var metrics = WeekOverWeekMetrics.FromResponse(doc.RootElement)!;

        Assert.Equal(123.5, metrics.DistanceKm);
        Assert.Equal(100, metrics.PrevDistanceKm);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("\"x\"")]
    [InlineData("null")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(WeekOverWeekMetrics.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_empty_object_yields_all_zero_digest()
    {
        using var doc = JsonDocument.Parse("{}");
        var metrics = WeekOverWeekMetrics.FromResponse(doc.RootElement);

        Assert.NotNull(metrics); // web renders an all-zero card grid when metrics is a present object
        Assert.Equal(WeekOverWeekMetrics.Empty, metrics);
    }

    // ---- Trend port (web trendFor) -------------------------------------------------

    [Fact]
    public void Trend_up_renders_signed_positive_percentage()
    {
        var trend = WeekOverWeekTrend.Of(110, 100);

        Assert.Equal(WeekOverWeekTrendDirection.Up, trend.Direction);
        Assert.Equal("+10.0%", trend.Value);
        Assert.True(trend.Positive);
    }

    [Fact]
    public void Trend_down_renders_signed_negative_percentage_and_is_negative_by_default()
    {
        var trend = WeekOverWeekTrend.Of(90, 100);

        Assert.Equal(WeekOverWeekTrendDirection.Down, trend.Direction);
        Assert.Equal("-10.0%", trend.Value);
        Assert.False(trend.Positive);
    }

    [Fact]
    public void Trend_invert_positive_flags_a_decrease_as_good()
    {
        // web trendFor(current, previous, invertPositive=true): a drop is the desirable outcome (energy/cost/efficiency)
        var trend = WeekOverWeekTrend.Of(90, 100, invertPositive: true);

        Assert.Equal(WeekOverWeekTrendDirection.Down, trend.Direction);
        Assert.True(trend.Positive);
    }

    [Fact]
    public void Trend_invert_positive_flags_an_increase_as_bad()
    {
        var trend = WeekOverWeekTrend.Of(110, 100, invertPositive: true);

        Assert.Equal(WeekOverWeekTrendDirection.Up, trend.Direction);
        Assert.False(trend.Positive);
    }

    [Fact]
    public void Trend_below_flat_threshold_renders_flat_zero_positive()
    {
        // web: Math.abs(diff) < 0.01 -> { direction: 'flat', value: '0%', positive: true }
        var trend = WeekOverWeekTrend.Of(100.005, 100);

        Assert.Equal(WeekOverWeekTrendDirection.Flat, trend.Direction);
        Assert.Equal("0%", trend.Value);
        Assert.True(trend.Positive);
    }

    [Fact]
    public void Trend_equal_values_render_flat()
    {
        var trend = WeekOverWeekTrend.Of(50, 50);
        Assert.Equal(WeekOverWeekTrendDirection.Flat, trend.Direction);
        Assert.Equal("0%", trend.Value);
    }

    [Fact]
    public void Trend_from_zero_previous_renders_hundred_percent_when_current_positive()
    {
        // web pctChange: previous === 0 ? (current > 0 ? 100 : 0)
        var trend = WeekOverWeekTrend.Of(5, 0);

        Assert.Equal(WeekOverWeekTrendDirection.Up, trend.Direction);
        Assert.Equal("+100.0%", trend.Value);
        Assert.True(trend.Positive);
    }

    [Theory]
    [InlineData(0, 0, 0)]
    [InlineData(5, 0, 100)]
    [InlineData(-3, 0, 0)]
    [InlineData(10, 5, 100)]
    [InlineData(90, 100, -10)]
    public void PctChange_matches_web(double current, double previous, double expected)
    {
        Assert.Equal(expected, WeekOverWeekTrend.PctChange(current, previous), 6);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_six_cards_in_web_order_with_labels()
    {
        var view = WeekOverWeekProjection.Project(Sample(), Localizer);

        Assert.Equal("Week-over-Week Comparison", view.Title);
        Assert.True(view.HasData);
        Assert.Collection(
            view.Cards,
            c => Assert.Equal("Distance", c.Label),
            c => Assert.Equal("Drives", c.Label),
            c => Assert.Equal("Energy", c.Label),
            c => Assert.Equal("Cost", c.Label),
            c => Assert.Equal("Efficiency", c.Label),
            c => Assert.Equal("CO\u2082 Saved", c.Label));
    }

    [Fact]
    public void Project_formats_values_and_metric_units_like_web()
    {
        var cards = WeekOverWeekProjection.Project(Sample(), Localizer).Cards;

        AssertCard(cards[0], "320.0", "km");
        AssertCard(cards[1], "12", null);             // fmtInt drive count, no unit
        AssertCard(cards[2], "64.0", "kWh");
        AssertCard(cards[3], "$9.00", null);          // formatCurrency(cost, 2)
        AssertCard(cards[4], "200.0", "Wh/km");
        AssertCard(cards[5], "13.4", "kg");           // 64 * 0.21 = 13.44 -> 13.4
    }

    [Fact]
    public void Project_honours_custom_currency_symbol()
    {
        var cards = WeekOverWeekProjection.Project(Sample(), Localizer, "€").Cards;
        Assert.Equal("€9.00", cards[3].Value);
    }

    [Fact]
    public void Project_applies_web_trend_invert_flags_per_card()
    {
        var cards = WeekOverWeekProjection.Project(Sample(), Localizer).Cards;

        // Distance up (300 -> 320) is good (no invert)
        Assert.Equal(WeekOverWeekTrendDirection.Up, cards[0].Trend.Direction);
        Assert.True(cards[0].Trend.Positive);

        // Drives up (10 -> 12) is good
        Assert.True(cards[1].Trend.Positive);

        // Energy down (80 -> 64) is good (invertPositive)
        Assert.Equal(WeekOverWeekTrendDirection.Down, cards[2].Trend.Direction);
        Assert.True(cards[2].Trend.Positive);

        // Cost down (12 -> 9) is good (invertPositive)
        Assert.True(cards[3].Trend.Positive);

        // Efficiency down (250 -> 200 Wh/km) is good (invertPositive)
        Assert.True(cards[4].Trend.Positive);

        // CO2 saved down (16.8 -> 13.44) is bad (no invert)
        Assert.Equal(WeekOverWeekTrendDirection.Down, cards[5].Trend.Direction);
        Assert.False(cards[5].Trend.Positive);
    }

    [Fact]
    public void Project_builds_accessible_names_with_label_value_and_unit()
    {
        var cards = WeekOverWeekProjection.Project(Sample(), Localizer).Cards;

        Assert.Equal("Distance: 320.0 km", cards[0].AutomationName);
        Assert.Equal("Drives: 12", cards[1].AutomationName);   // no unit
        Assert.Equal("Cost: $9.00", cards[3].AutomationName);  // currency, no unit
        Assert.Equal("CO\u2082 Saved: 13.4 kg", cards[5].AutomationName);
    }

    [Fact]
    public void Project_constants_match_web_keys()
    {
        Assert.Equal("translation.analytics.weeklyDigest.weekOverWeek", WeekOverWeekProjection.TitleKey);
        Assert.Equal("translation.analytics.weeklyDigest.distance", WeekOverWeekProjection.DistanceKey);
        Assert.Equal("translation.analytics.weeklyDigest.drives", WeekOverWeekProjection.DrivesKey);
        Assert.Equal("translation.analytics.weeklyDigest.energy", WeekOverWeekProjection.EnergyKey);
        Assert.Equal("translation.analytics.weeklyDigest.cost", WeekOverWeekProjection.CostKey);
        Assert.Equal("translation.analytics.weeklyDigest.efficiency", WeekOverWeekProjection.EfficiencyKey);
        Assert.Equal("translation.analytics.weeklyDigest.co2", WeekOverWeekProjection.Co2Key);
    }

    [Fact]
    public void EmptyDisplay_has_title_and_no_cards()
    {
        var view = WeekOverWeekProjection.EmptyDisplay(Localizer);
        Assert.Equal("Week-over-Week Comparison", view.Title);
        Assert.Empty(view.Cards);
        Assert.False(view.HasData);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(DigestJson);

        var cached = WeekOverWeekResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(320, cached.Value!.DistanceKm);

        var offline = WeekOverWeekResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(64, offline.Value!.EnergyKwh);
    }

    [Fact]
    public void Map_collapses_non_object_payload_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var loaded = WeekOverWeekResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, loaded.Status);
    }

    [Fact]
    public void Map_maps_empty_failure_and_loading()
    {
        Assert.Equal(LoadStatus.Empty, WeekOverWeekResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, WeekOverWeekResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, WeekOverWeekResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WeekOverWeekMetrics>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
        Assert.Empty(vm.Display.Cards);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cards()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.Equal("320.0", vm.Display.Cards[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<WeekOverWeekMetrics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No weekly data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeekOverWeekMetrics>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<WeekOverWeekMetrics>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<WeekOverWeekMetrics>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeekOverWeekMetrics>.Loading(),
            RepositoryResult<WeekOverWeekMetrics>.Cached(Sample(), Now, stale: false),
            RepositoryResult<WeekOverWeekMetrics>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(WeekOverWeekSummaryState.Loaded, vm.State);
        Assert.Equal("320.0", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_cost_card()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("$9.00", vm.Display.Cards[3].Value);

        vm.CurrencySymbol = "€";

        Assert.Equal("€9.00", vm.Display.Cards[3].Value);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<WeekOverWeekMetrics>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Week-over-Week Comparison", vm.Title);
        Assert.Equal("No weekly data available", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WeekOverWeekSummaryViewModel.State), changed);
        Assert.Contains(nameof(WeekOverWeekSummaryViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_weekly_digest_operation_with_vehicle_path()
    {
        using var doc = JsonDocument.Parse(DigestJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 7);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(320, emissions[^1].Value!.DistanceKm);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_vehicles_vehicleID_weekly_digest", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_without_vehicle_streams_empty_and_makes_no_request()
    {
        var client = new FakeApiClient();
        var source = NewSource(client, vehicleId: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(client.Requests);
    }

    [Fact]
    public async Task Source_non_object_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 3);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public void Source_exposes_canonical_operation_id()
    {
        Assert.Equal("get_api_v1_vehicles_vehicleID_weekly_digest", WeekOverWeekSummarySource.WeeklyDigestOperation);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("week-over-week-summary", WeekOverWeekSummaryRegistration.Id);
        Assert.Equal("analytics", WeekOverWeekSummaryRegistration.Category);
        Assert.Equal("WeekOverWeekSummary", WeekOverWeekSummaryRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new WeekOverWeekSummaryDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WeekOverWeekSummary", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static WeekOverWeekMetrics Sample() => new(
        Drives: 12, DistanceKm: 320, EnergyKwh: 64, Cost: 9, EfficiencyWhKm: 200,
        PrevDrives: 10, PrevDistanceKm: 300, PrevEnergyKwh: 80, PrevCost: 12, PrevEfficiencyWhKm: 250);

    private static RepositoryResult<WeekOverWeekMetrics> Loaded(WeekOverWeekMetrics metrics) =>
        RepositoryResult<WeekOverWeekMetrics>.Loaded(metrics, Now);

    private static WeekOverWeekSummaryViewModel NewViewModel(params RepositoryResult<WeekOverWeekMetrics>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static WeekOverWeekSummarySource NewSource(IApiClient client, long? vehicleId)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new WeekOverWeekSummarySource(client, engine, options, vehicleId);
    }

    private static void AssertCard(WeekOverWeekCard card, string value, string? unit)
    {
        Assert.Equal(value, card.Value);
        Assert.Equal(unit, card.Unit);
    }

    private static async Task<IReadOnlyList<RepositoryResult<WeekOverWeekMetrics>>> Collect(
        IAsyncEnumerable<RepositoryResult<WeekOverWeekMetrics>> stream)
    {
        var list = new List<RepositoryResult<WeekOverWeekMetrics>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<WeekOverWeekMetrics>[] emissions) : IWeekOverWeekSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<WeekOverWeekMetrics>> StreamAsync(
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
