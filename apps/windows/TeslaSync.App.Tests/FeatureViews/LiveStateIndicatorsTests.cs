using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveStateIndicators</c> feature surface's UI-thread-free logic — the JSON
/// parse adapter (the useVehicleState read of speed / is_locked / sentry_mode / is_climate_on / is_charging out
/// of the <c>{ state, live }</c> envelope, including the vehicle_id gate and the tolerant bool/number/string
/// readers), the projection (five chips in web order with the Speed / Lock / Sentry / Climate / Charging text
/// and the exact variant rules, the unit-converted speed, the accessible names), the cache-then-network result
/// mapper, the per-vehicle data source (primary resolution + path-scoped request), the registry metadata, the
/// PII-safe diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty /
/// error / stale / offline) plus unit re-projection. Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class LiveStateIndicatorsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    private static LiveStateIndicatorsReading Reading(
        double? speed = 20,
        bool? isLocked = true,
        bool? sentryMode = false,
        bool? isClimateOn = true,
        bool? isCharging = false) =>
        new(speed, isLocked, sentryMode, isClimateOn, isCharging);

    // ── Parse adapter (web useVehicleState read) ──────────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_state_fields_out_of_envelope()
    {
        using var doc = JsonDocument.Parse(
            """
            {"state":{"vehicle_id":7,"speed":20,"is_locked":true,"sentry_mode":false,
             "is_climate_on":true,"is_charging":false},"live":true}
            """);

        var reading = LiveStateIndicatorsReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(20, reading!.Speed);
        Assert.True(reading.IsLocked);
        Assert.False(reading.SentryMode);
        Assert.True(reading.IsClimateOn);
        Assert.False(reading.IsCharging);
    }

    [Fact]
    public void FromResponse_accepts_a_bare_state_object()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":3,"speed":0,"is_charging":true}""");

        var reading = LiveStateIndicatorsReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(0, reading!.Speed);
        Assert.True(reading.IsCharging);
    }

    [Fact]
    public void FromResponse_null_when_no_state_and_no_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");

        Assert.Null(LiveStateIndicatorsReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_null_when_state_lacks_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""{"state":{"speed":12}}""");

        Assert.Null(LiveStateIndicatorsReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_null_for_non_object_body()
    {
        using var doc = JsonDocument.Parse("null");

        Assert.Null(LiveStateIndicatorsReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_reads_numeric_and_string_unions_tolerantly()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"speed":"12.5","is_locked":"true","sentry_mode":1,"is_charging":0}}""");

        var reading = LiveStateIndicatorsReading.FromResponse(doc.RootElement);

        Assert.Equal(12.5, reading!.Speed);
        Assert.True(reading.IsLocked);
        Assert.True(reading.SentryMode);
        Assert.False(reading.IsCharging);
    }

    [Fact]
    public void FromResponse_missing_fields_are_null()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var reading = LiveStateIndicatorsReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.Speed);
        Assert.Null(reading.IsLocked);
        Assert.Null(reading.SentryMode);
        Assert.Null(reading.IsClimateOn);
        Assert.Null(reading.IsCharging);
    }

    // ── Projection: composition + order ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_emits_five_chips_in_web_order()
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal(5, view.Indicators.Count);
        Assert.Equal(new[] { "speed", "lock", "sentry", "climate", "charging" },
            view.Indicators.Select(i => i.Key).ToArray());
    }

    // ── Projection: speed chip (web variant + useUnits().formatSpeed) ───────────────────────────────────

    [Fact]
    public void Project_speed_success_when_moving_and_converts_to_units()
    {
        var metric = LiveStateIndicatorsProjection.Project(Reading(speed: 20), UnitPref.Metric, Localizer);
        var imperial = LiveStateIndicatorsProjection.Project(Reading(speed: 20), UnitPref.Imperial, Localizer);

        Assert.Equal(StatusKind.Success, metric.Indicators[0].Status);
        Assert.StartsWith("Speed:", metric.Indicators[0].Text);
        Assert.Contains("km/h", metric.Indicators[0].Text);
        Assert.Contains("mph", imperial.Indicators[0].Text);
    }

    [Theory]
    [InlineData(0d)]
    [InlineData(-5d)]
    public void Project_speed_neutral_when_not_moving(double speed)
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(speed: speed), UnitPref.Metric, Localizer);

        Assert.Equal(StatusKind.Neutral, view.Indicators[0].Status);
    }

    [Fact]
    public void Project_speed_em_dash_and_neutral_when_null()
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(speed: null), UnitPref.Metric, Localizer);

        Assert.Equal(StatusKind.Neutral, view.Indicators[0].Status);
        Assert.Contains(EmDash, view.Indicators[0].Text);
    }

    // ── Projection: lock / sentry / climate / charging variant + text rules ─────────────────────────────

    [Theory]
    [InlineData(true, "Locked", StatusKind.Success)]
    [InlineData(false, "Unlocked", StatusKind.Danger)]
    [InlineData(null, "Unlocked", StatusKind.Danger)]
    public void Project_lock_chip(bool? locked, string expectedText, StatusKind expectedStatus)
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(isLocked: locked), UnitPref.Metric, Localizer);

        Assert.Equal(expectedText, view.Indicators[1].Text);
        Assert.Equal(expectedStatus, view.Indicators[1].Status);
    }

    [Theory]
    [InlineData(true, "Sentry: Active", StatusKind.Warning)]
    [InlineData(false, "Sentry: Off", StatusKind.Neutral)]
    [InlineData(null, "Sentry: Off", StatusKind.Neutral)]
    public void Project_sentry_chip(bool? sentry, string expectedText, StatusKind expectedStatus)
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(sentryMode: sentry), UnitPref.Metric, Localizer);

        Assert.Equal(expectedText, view.Indicators[2].Text);
        Assert.Equal(expectedStatus, view.Indicators[2].Status);
    }

    [Theory]
    [InlineData(true, "Climate: On", StatusKind.Info)]
    [InlineData(false, "Climate: Off", StatusKind.Neutral)]
    [InlineData(null, "Climate: Off", StatusKind.Neutral)]
    public void Project_climate_chip(bool? climate, string expectedText, StatusKind expectedStatus)
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(isClimateOn: climate), UnitPref.Metric, Localizer);

        Assert.Equal(expectedText, view.Indicators[3].Text);
        Assert.Equal(expectedStatus, view.Indicators[3].Status);
    }

    [Theory]
    [InlineData(true, "Charging", StatusKind.Warning)]
    [InlineData(false, "Not Charging", StatusKind.Neutral)]
    [InlineData(null, "Not Charging", StatusKind.Neutral)]
    public void Project_charging_chip(bool? charging, string expectedText, StatusKind expectedStatus)
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(isCharging: charging), UnitPref.Metric, Localizer);

        Assert.Equal(expectedText, view.Indicators[4].Text);
        Assert.Equal(expectedStatus, view.Indicators[4].Status);
    }

    // ── Accessibility names (Narrator) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_chips_and_surface_have_accessible_names()
    {
        var view = LiveStateIndicatorsProjection.Project(Reading(), UnitPref.Metric, Localizer);

        foreach (var chip in view.Indicators)
        {
            Assert.False(string.IsNullOrWhiteSpace(chip.AutomationName));
            Assert.Equal(chip.Text, chip.AutomationName);
        }

        Assert.Equal("Live State", view.Title);
        Assert.Equal(view.Title, view.AutomationName);
    }

    // ── Result mapper (cache-then-network preservation) ─────────────────────────────────────────────────

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"speed":10,"is_locked":true}}""");

        var cached = LiveStateIndicatorsResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.Speed);

        var offline = LiveStateIndicatorsResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.IsLocked);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        Assert.Equal(LoadStatus.Loaded, LiveStateIndicatorsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, LiveStateIndicatorsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, LiveStateIndicatorsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_loaded_body_without_state_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = LiveStateIndicatorsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ── View-model state matrix ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<LiveStateIndicatorsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_five_chips()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(5, vm.Display!.Indicators.Count);
        Assert.Equal("Locked", vm.Display.Indicators[1].Text);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<LiveStateIndicatorsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No live state data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveStateIndicatorsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveStateIndicatorsReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<LiveStateIndicatorsReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<LiveStateIndicatorsReading>.Loading(),
            RepositoryResult<LiveStateIndicatorsReading>.Cached(Reading(isLocked: false), Now, stale: false),
            RepositoryResult<LiveStateIndicatorsReading>.Loaded(Reading(isLocked: true), Now));
        await vm.LoadAsync();

        Assert.Equal(LiveStateIndicatorsState.Loaded, vm.State);
        Assert.Equal("Locked", vm.Display!.Indicators[1].Text);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_speed_chip()
    {
        using var vm = NewViewModel(Loaded(Reading(speed: 20)));
        await vm.LoadAsync();

        Assert.Contains("km/h", vm.Display!.Indicators[0].Text);

        vm.Units = UnitPref.Imperial;

        Assert.Contains("mph", vm.Display!.Indicators[0].Text);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LiveStateIndicatorsViewModel.State), changed);
        Assert.Contains(nameof(LiveStateIndicatorsViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_loading_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<LiveStateIndicatorsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Live State", vm.Title);
        Assert.Equal("No live state data available", vm.EmptyMessage);
        Assert.Equal("Loading live state", vm.LoadingMessage);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("live-state-indicators", LiveStateIndicatorsRegistration.Id);
        Assert.Equal("LiveStateIndicators", LiveStateIndicatorsRegistration.Slug);
        Assert.Equal("Live State", LiveStateIndicatorsRegistration.Name(Localizer));
        Assert.Equal("No live state data available", LiveStateIndicatorsRegistration.EmptyMessage(Localizer));
        Assert.Equal("Live state indicators failed to load", LiveStateIndicatorsRegistration.ErrorMessage(Localizer));
        Assert.Equal("Loading live state", LiveStateIndicatorsRegistration.LoadingMessage(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveStateIndicators, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveStateIndicatorsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveStateIndicators", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_state_values()
    {
        var captured = new List<string>();
        var diagnostics = new LiveStateIndicatorsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=LiveStateIndicators", line));
    }

    // ── Source (per-vehicle adapter) ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new LiveStateIndicatorsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"speed":20,"is_locked":true}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveStateIndicatorsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.IsLocked);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":42}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveStateIndicatorsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_body_without_state_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveStateIndicatorsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ── Fakes / helpers ─────────────────────────────────────────────────────────────────────────────────

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<LiveStateIndicatorsReading>>> Drain(ILiveStateIndicatorsSource source)
    {
        var list = new List<RepositoryResult<LiveStateIndicatorsReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<LiveStateIndicatorsReading> Loaded(LiveStateIndicatorsReading reading) =>
        RepositoryResult<LiveStateIndicatorsReading>.Loaded(reading, Now);

    private static LiveStateIndicatorsViewModel NewViewModel(params RepositoryResult<LiveStateIndicatorsReading>[] emissions) =>
        new(new FakeLiveStateIndicatorsSource(emissions), Localizer);

    private sealed class FakeLiveStateIndicatorsSource(params RepositoryResult<LiveStateIndicatorsReading>[] emissions)
        : ILiveStateIndicatorsSource
    {
        public async IAsyncEnumerable<RepositoryResult<LiveStateIndicatorsReading>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
