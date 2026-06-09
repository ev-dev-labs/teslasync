using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Driving Performance Cards surface's UI-thread-free logic — the
/// drive-analytics JSON parse adapter (the four <c>*_stats</c> groups + the web <c>safe()</c> coercion), the
/// SI→display projection (speed/distance unit conversion, the per-card em-dash, the kW power tiles), the
/// cache-then-network result mapper, the repository source's request shape, the state-holder view-model's
/// per-state matrix (loading / loaded / empty / error / stale / offline), the registry metadata and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx).
/// </summary>
public sealed class DrivingPerformanceCardsTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string FleetJson = """
    {
      "period_days": 30,
      "drive_analytics": {
        "speed_stats": { "min": 0, "max": 120, "avg": 65, "median": 60, "p95": 110, "count": 100 },
        "power_stats": { "min": 0, "max": 250, "avg": 80, "median": 70, "p95": 220, "count": 100 },
        "regen_stats": { "min": 0, "max": 60, "avg": 20, "median": 18, "p95": 55, "count": 100 },
        "distance_stats": { "min": 1, "max": 318, "avg": 42.5, "median": 30, "p95": 200, "count": 100 }
      }
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_the_four_stat_groups()
    {
        using var doc = JsonDocument.Parse(FleetJson);
        var snapshot = DrivingPerformanceSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Speed);
        Assert.Equal(120, snapshot.Speed!.Max);
        Assert.Equal(65, snapshot.Speed.Avg);
        Assert.Equal(250, snapshot.Power!.Max);
        Assert.Equal(60, snapshot.Regen!.Max);
        Assert.Equal(318, snapshot.Distance!.Max);
        Assert.Equal(42.5, snapshot.Distance.Avg);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_absent_group_stays_null_for_em_dash()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"power_stats":{"max":100,"avg":40}}}""");
        var snapshot = DrivingPerformanceSnapshot.FromJson(doc.RootElement);

        Assert.Null(snapshot.Speed);
        Assert.Null(snapshot.Regen);
        Assert.Null(snapshot.Distance);
        Assert.NotNull(snapshot.Power);
        Assert.True(snapshot.HasData); // one group present
    }

    [Fact]
    public void FromJson_present_but_empty_group_coerces_to_zero()
    {
        // web: a present (truthy) stat object renders safe(undefined)=0, not the em-dash.
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"speed_stats":{}}}""");
        var snapshot = DrivingPerformanceSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Speed);
        Assert.Equal(0, snapshot.Speed!.Max);
        Assert.Equal(0, snapshot.Speed.Avg);
    }

    [Fact]
    public void FromJson_coerces_non_finite_and_non_numeric_fields_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"drive_analytics":{"speed_stats":{"max":"oops","avg":null}}}""");
        var snapshot = DrivingPerformanceSnapshot.FromJson(doc.RootElement);

        Assert.NotNull(snapshot.Speed);
        Assert.Equal(0, snapshot.Speed!.Max);
        Assert.Equal(0, snapshot.Speed.Avg);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_drive_analytics_and_non_object()
    {
        using var noDa = JsonDocument.Parse("""{"period_days":30}""");
        Assert.False(DrivingPerformanceSnapshot.FromJson(noDa.RootElement).HasData);

        using var daArray = JsonDocument.Parse("""{"drive_analytics":[]}""");
        Assert.False(DrivingPerformanceSnapshot.FromJson(daArray.RootElement).HasData);

        using var notObject = JsonDocument.Parse("[]");
        Assert.False(DrivingPerformanceSnapshot.FromJson(notObject.RootElement).HasData);
    }

    [Theory]
    [InlineData("""{"drive_analytics":{}}""", false)]
    [InlineData("""{"drive_analytics":{"speed_stats":{"max":1}}}""", true)]
    [InlineData("""{"drive_analytics":{"distance_stats":{"avg":1}}}""", true)]
    public void HasData_gate_matches_presence_of_any_group(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, DrivingPerformanceSnapshot.FromJson(doc.RootElement).HasData);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_formats_six_cards()
    {
        var view = DrivingPerformanceProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.Equal(6, view.Cards.Count);
        Assert.True(view.HasData);

        Assert.Equal("Top Speed", view.Cards[0].Label);
        Assert.Equal("120", view.Cards[0].Value);
        Assert.Equal("km/h", view.Cards[0].Subtitle);

        Assert.Equal("Avg Speed", view.Cards[1].Label);
        Assert.Equal("65", view.Cards[1].Value);
        Assert.Equal("km/h", view.Cards[1].Subtitle);

        Assert.Equal("Peak Power", view.Cards[2].Label);
        Assert.Equal("250", view.Cards[2].Value);
        Assert.Equal("kW", view.Cards[2].Subtitle);

        Assert.Equal("Peak Regen", view.Cards[3].Label);
        Assert.Equal("60", view.Cards[3].Value);
        Assert.Equal("kW", view.Cards[3].Subtitle);

        Assert.Equal("Avg Drive Distance", view.Cards[4].Label);
        Assert.Equal("42.5", view.Cards[4].Value);
        Assert.Equal("km", view.Cards[4].Subtitle);

        Assert.Equal("Longest Drive", view.Cards[5].Label);
        Assert.Equal("318.0", view.Cards[5].Value);
        Assert.Equal("km", view.Cards[5].Subtitle);
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_speed_and_distance_but_not_power()
    {
        var view = DrivingPerformanceProjection.Project(Sample(), UnitPref.Imperial, Localizer);

        Assert.Equal("75", view.Cards[0].Value);   // 120 km/h -> 74.56 mph -> 75
        Assert.Equal("mph", view.Cards[0].Subtitle);

        Assert.Equal("40", view.Cards[1].Value);    // 65 km/h -> 40.39 mph -> 40

        Assert.Equal("250", view.Cards[2].Value);   // power unchanged (kW)
        Assert.Equal("kW", view.Cards[2].Subtitle);

        Assert.Equal("26.4", view.Cards[4].Value);  // 42.5 km -> 26.41 mi
        Assert.Equal("mi", view.Cards[4].Subtitle);

        Assert.Equal("197.6", view.Cards[5].Value); // 318 km -> 197.60 mi
        Assert.Equal("mi", view.Cards[5].Subtitle);
    }

    [Fact]
    public void Project_absent_group_renders_em_dash_per_card()
    {
        var snapshot = new DrivingPerformanceSnapshot(Speed: null, Power: new DrivingStat(100, 40), Regen: null, Distance: null);

        var view = DrivingPerformanceProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.Equal(EmDash, view.Cards[0].Value); // top speed
        Assert.Equal(EmDash, view.Cards[1].Value); // avg speed
        Assert.Equal("100", view.Cards[2].Value);  // peak power present
        Assert.Equal(EmDash, view.Cards[3].Value); // peak regen
        Assert.Equal(EmDash, view.Cards[4].Value); // avg distance
        Assert.Equal(EmDash, view.Cards[5].Value); // longest drive
    }

    [Fact]
    public void Project_present_empty_group_renders_zero_not_em_dash()
    {
        var snapshot = new DrivingPerformanceSnapshot(Speed: new DrivingStat(0, 0), Power: null, Regen: null, Distance: null);

        var view = DrivingPerformanceProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.Equal("0", view.Cards[0].Value);
        Assert.Equal("0", view.Cards[1].Value);
    }

    [Fact]
    public void Project_assigns_web_accent_color_grouping()
    {
        var view = DrivingPerformanceProjection.Project(Sample(), UnitPref.Metric, Localizer);

        // cyan(0) & purple(1) are each shared by two tiles, amber(2)/green(3) once — matching the web colors.
        Assert.Equal(new[] { 0, 1, 2, 3, 0, 1 }, view.Cards.Select(c => c.ColorIndex).ToArray());
    }

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var view = DrivingPerformanceProjection.Project(Sample(), UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal(1000.0, DrivingPerformanceProjection.MetersPerKm);
        Assert.Equal(3600.0, DrivingPerformanceProjection.SecondsPerHour);
        Assert.Equal("\u2014", DrivingPerformanceProjection.EmDash);
        Assert.Equal("kW", DrivingPerformanceProjection.PowerUnitLabel);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(FleetJson);

        var cached = DrivingPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(120, cached.Value!.Speed!.Max);

        var offline = DrivingPerformanceResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(250, offline.Value!.Power!.Max);
    }

    [Fact]
    public void Map_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(FleetJson);

        Assert.Equal(LoadStatus.Loaded, DrivingPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DrivingPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DrivingPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, DrivingPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingPerformanceSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_cards()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(DrivingPerformanceSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No driving performance data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingPerformanceSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingPerformanceSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingPerformanceSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_chip()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingPerformanceSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DrivingPerformanceSnapshot>.Loading(),
            RepositoryResult<DrivingPerformanceSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<DrivingPerformanceSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(DrivingPerformanceState.Loaded, vm.State);
        Assert.Equal("120", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("km/h", vm.Display.Cards[0].Subtitle);
        Assert.Equal("120", vm.Display.Cards[0].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mph", vm.Display.Cards[0].Subtitle);
        Assert.Equal("75", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DrivingPerformanceSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Driving Performance", vm.Title);
        Assert.Equal("No driving performance data yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DrivingPerformanceCardsViewModel.State), changed);
        Assert.Contains(nameof(DrivingPerformanceCardsViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_snapshot_and_targets_the_fleet_operation_with_days_window()
    {
        using var doc = JsonDocument.Parse(FleetJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(120, emissions[^1].Value!.Speed!.Max);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_analytics_fleet", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(30, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_body_streams_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("driving-performance-cards", DrivingPerformanceCardsRegistration.Id);
        Assert.Equal("analytics", DrivingPerformanceCardsRegistration.Category);
        Assert.Equal("DrivingPerformanceCards", DrivingPerformanceCardsRegistration.Slug);
        Assert.Equal(30, DrivingPerformanceCardsRegistration.DefaultDays);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new DrivingPerformanceCardsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingPerformanceCards", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static DrivingPerformanceSnapshot Sample() =>
        new(
            Speed: new DrivingStat(120, 65),
            Power: new DrivingStat(250, 80),
            Regen: new DrivingStat(60, 20),
            Distance: new DrivingStat(318, 42.5));

    private static RepositoryResult<DrivingPerformanceSnapshot> Loaded(DrivingPerformanceSnapshot snapshot) =>
        RepositoryResult<DrivingPerformanceSnapshot>.Loaded(snapshot, Now);

    private static DrivingPerformanceCardsViewModel NewViewModel(
        params RepositoryResult<DrivingPerformanceSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric, () => Now);

    private static DrivingPerformanceCardsSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new DrivingPerformanceCardsSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<DrivingPerformanceSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<DrivingPerformanceSnapshot>> stream)
    {
        var list = new List<RepositoryResult<DrivingPerformanceSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<DrivingPerformanceSnapshot>[] emissions)
        : IDrivingPerformanceCardsSource
    {
        public async IAsyncEnumerable<RepositoryResult<DrivingPerformanceSnapshot>> StreamAsync(
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
