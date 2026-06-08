using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DestinationETAWidget's UI-thread-free logic — the JSON parse adapter (the
/// useLocationSnapshotLatest read), the distance / ETA / progress formatters, the active-navigation gate, the
/// location-presence badge, the projection, the Narrator name, the result mapper, the single-endpoint
/// per-vehicle data source (primary resolution + the query-scoped location-snapshot read), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty /
/// error / stale / offline) plus the compact-vs-standard footprint switch. Mirrors the web spec
/// (web/src/features/dashboard/widgets/DestinationETAWidget.tsx).
/// </summary>
public sealed class DestinationETAWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string NavigatingJson =
        """{"vehicle_id":7,"destination_name":"Home Depot","miles_to_arrival":15000,"minutes_to_arrival":95,"located_at_home":false,"located_at_work":false,"located_at_favorite":false}""";

    private const string HomeJson =
        """{"vehicle_id":7,"located_at_home":true,"miles_to_arrival":0,"minutes_to_arrival":0}""";

    // ---- Parse adapter (web useLocationSnapshotLatest read) ------------------------

    [Fact]
    public void FromResponse_reads_all_snapshot_fields()
    {
        using var doc = JsonDocument.Parse(NavigatingJson);

        var reading = DestinationETAReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("Home Depot", reading!.DestinationName);
        Assert.Equal(15000, reading.DistanceMeters);
        Assert.Equal(95, reading.MinutesToArrival);
        Assert.False(reading.LocatedAtHome);
    }

    [Fact]
    public void FromResponse_reads_presence_flags()
    {
        using var doc = JsonDocument.Parse(HomeJson);

        var reading = DestinationETAReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.LocatedAtHome);
        Assert.Null(reading.DestinationName);
    }

    [Fact]
    public void FromResponse_coalesces_missing_numbers_to_zero()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = DestinationETAReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(0, reading!.DistanceMeters);
        Assert.Equal(0, reading.MinutesToArrival);
        Assert.Null(reading.DestinationName);
        Assert.False(reading.LocatedAtHome);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(DestinationETAReading.FromResponse(doc.RootElement));
    }

    // ---- Active-navigation gate (web isNavigating) ---------------------------------

    [Theory]
    [InlineData("Home Depot", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsNavigating_matches_web(string? destination, bool expected) =>
        Assert.Equal(expected, DestinationETAProjection.IsNavigating(
            new DestinationETAReading(destination, 0, 0, false, false, false)));

    // ---- Distance formatter (web fmtNumber(convertDistanceFromSI(metres, unit), 1)) -

    [Fact]
    public void FormatDistance_metric_converts_metres_to_km()
    {
        Assert.Equal("15.0", DestinationETAProjection.FormatDistance(15000, UnitPref.Metric));
    }

    [Fact]
    public void FormatDistance_imperial_converts_metres_to_miles()
    {
        // 15000 m / 1609.344 = 9.3206 mi → "9.3".
        Assert.Equal("9.3", DestinationETAProjection.FormatDistance(15000, UnitPref.Imperial));
    }

    // ---- ETA detail formatter (web etaDisplay) -------------------------------------

    [Theory]
    [InlineData(45, "45m")]
    [InlineData(95, "1h 35m")]
    [InlineData(60, "1h 0m")]
    [InlineData(0, "0m")]
    public void FormatEtaDetail_matches_web(double minutes, string expected) =>
        Assert.Equal(expected, DestinationETAProjection.FormatEtaDetail(minutes));

    // ---- Progress fraction (web progressPercent) -----------------------------------

    [Theory]
    [InlineData(1, true, 50)]    // 100 - 1/2*100
    [InlineData(3, true, 25)]    // 100 - 3/4*100
    [InlineData(0, true, 0)]     // metres <= 0 → 0
    [InlineData(1, false, 0)]    // not navigating → 0
    public void ProgressPercent_matches_web(double metres, bool navigating, double expected) =>
        Assert.Equal(expected, DestinationETAProjection.ProgressPercent(metres, navigating), 6);

    // ---- Location badge (web locationBadge) ----------------------------------------

    [Fact]
    public void LocationBadge_home_is_success()
    {
        var badge = DestinationETAProjection.LocationBadge(
            new DestinationETAReading(null, 0, 0, true, false, false), Localizer);

        Assert.Equal(DestinationETAProjection.HomeEmoji, badge.Emoji);
        Assert.Equal("Home", badge.Label);
        Assert.Equal(StatusKind.Success, badge.Status);
    }

    [Fact]
    public void LocationBadge_work_is_neutral()
    {
        var badge = DestinationETAProjection.LocationBadge(
            new DestinationETAReading(null, 0, 0, false, true, false), Localizer);

        Assert.Equal(DestinationETAProjection.WorkEmoji, badge.Emoji);
        Assert.Equal("Work", badge.Label);
        Assert.Equal(StatusKind.Neutral, badge.Status);
    }

    [Fact]
    public void LocationBadge_favorite_is_neutral()
    {
        var badge = DestinationETAProjection.LocationBadge(
            new DestinationETAReading(null, 0, 0, false, false, true), Localizer);

        Assert.Equal(DestinationETAProjection.FavoriteEmoji, badge.Emoji);
        Assert.Equal("Favorite", badge.Label);
        Assert.Equal(StatusKind.Neutral, badge.Status);
    }

    [Fact]
    public void LocationBadge_other_is_warning()
    {
        var badge = DestinationETAProjection.LocationBadge(
            new DestinationETAReading(null, 0, 0, false, false, false), Localizer);

        Assert.Equal(DestinationETAProjection.OtherEmoji, badge.Emoji);
        Assert.Equal("Other", badge.Label);
        Assert.Equal(StatusKind.Warning, badge.Status);
    }

    [Fact]
    public void LocationBadge_prefers_home_over_work_and_favorite()
    {
        var badge = DestinationETAProjection.LocationBadge(
            new DestinationETAReading(null, 0, 0, true, true, true), Localizer);

        Assert.Equal("Home", badge.Label);
    }

    // ---- Projection (navigating) ---------------------------------------------------

    [Fact]
    public void Project_navigating_builds_full_body()
    {
        var display = DestinationETAProjection.Project(NavigatingReading(), UnitPref.Metric, Localizer);

        Assert.True(display.IsNavigating);
        Assert.Equal("Home Depot", display.DestinationName);
        Assert.Equal(95, display.EtaMinutes);
        Assert.Equal("1h 35m", display.EtaDetailText);
        Assert.Equal("15.0", display.DistanceText);
        Assert.Equal("km", display.DistanceUnitLabel);
        Assert.Equal("ETA", display.EtaLabel);
        Assert.Equal("min", display.MinLabel);
        Assert.Equal("Remaining", display.RemainingLabel);
    }

    [Fact]
    public void Project_navigating_reprojects_distance_in_imperial()
    {
        var display = DestinationETAProjection.Project(NavigatingReading(), UnitPref.Imperial, Localizer);

        Assert.Equal("9.3", display.DistanceText);
        Assert.Equal("mi", display.DistanceUnitLabel);
    }

    [Fact]
    public void Project_navigating_automation_name_summarises_route()
    {
        var display = DestinationETAProjection.Project(NavigatingReading(), UnitPref.Metric, Localizer);

        Assert.Equal("Home Depot, ETA 95 min, Remaining 15.0 km", display.AutomationName);
    }

    // ---- Projection (not navigating → location badge) ------------------------------

    [Fact]
    public void Project_not_navigating_uses_location_badge_and_em_dash_name()
    {
        var display = DestinationETAProjection.Project(
            new DestinationETAReading(null, 0, 0, true, false, false), UnitPref.Metric, Localizer);

        Assert.False(display.IsNavigating);
        Assert.Equal(DestinationETAProjection.EmDash, display.DestinationName);
        Assert.Equal("Home", display.LocationLabel);
        Assert.Equal(DestinationETAProjection.HomeEmoji, display.LocationEmoji);
        Assert.Equal(StatusKind.Success, display.LocationStatus);
        Assert.Equal("No active navigation", display.NoNavLabel);
        Assert.Equal(0, display.ProgressPercent);
    }

    [Fact]
    public void Project_not_navigating_automation_name_combines_label_and_note()
    {
        var display = DestinationETAProjection.Project(
            new DestinationETAReading(null, 0, 0, false, false, false), UnitPref.Metric, Localizer);

        Assert.Equal("Other, No active navigation", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(NavigatingJson);

        var cached = DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("Home Depot", cached.Value!.DestinationName);

        var offline = DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(95, offline.Value!.MinutesToArrival);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(NavigatingJson);

        Assert.Equal(LoadStatus.Loaded, DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no snapshot (snapshot == null) -> the "No location data" surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = DestinationETAResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DestinationETAReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_navigation_display()
    {
        using var vm = NewViewModel(Loaded(NavigatingReading()));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.True(vm.Display!.IsNavigating);
        Assert.Equal("15.0", vm.Display.DistanceText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_not_navigating_keeps_location_badge_not_empty()
    {
        using var vm = NewViewModel(Loaded(new DestinationETAReading(null, 0, 0, true, false, false)));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.False(vm.Display!.IsNavigating);
        Assert.Equal("Home", vm.Display.LocationLabel);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<DestinationETAReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No location data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DestinationETAReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<DestinationETAReading>.Cached(NavigatingReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<DestinationETAReading>.OfflineCached(
            NavigatingReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DestinationETAReading>.Loading(),
            RepositoryResult<DestinationETAReading>.Cached(new DestinationETAReading(null, 0, 0, false, false, true), Now, stale: false),
            RepositoryResult<DestinationETAReading>.Loaded(NavigatingReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(DestinationETAState.Loaded, vm.State);
        Assert.True(vm.Display!.IsNavigating);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(NavigatingReading()));
        await vm.LoadAsync();
        Assert.Equal("15.0", vm.Display!.DistanceText);
        Assert.Equal("km", vm.Display.DistanceUnitLabel);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("9.3", vm.Display!.DistanceText);
        Assert.Equal("mi", vm.Display.DistanceUnitLabel);
        Assert.Equal(DestinationETAState.Loaded, vm.State);
    }

    [Fact]
    public void ViewModel_compact_flag_tracks_footprint()
    {
        using var vm = NewViewModel(RepositoryResult<DestinationETAReading>.Empty(Now));

        Assert.False(vm.IsCompact); // default 2×2

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new DestinationETASize(1, 2);

        Assert.True(vm.IsCompact);
        Assert.Contains(nameof(DestinationETAViewModel.IsCompact), changed);
        Assert.Contains(nameof(DestinationETAViewModel.Size), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DestinationETAReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Destination ETA", vm.Title);
        Assert.Equal("No location data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(NavigatingReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DestinationETAViewModel.State), changed);
        Assert.Contains(nameof(DestinationETAViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("destination-eta", DestinationETARegistration.Id);
        Assert.Equal("maps", DestinationETARegistration.Category);
        Assert.Equal("DestinationETAWidget", DestinationETARegistration.Slug);
        Assert.Equal(new DestinationETASize(2, 2), DestinationETARegistration.DefaultSize);
        Assert.Equal(new DestinationETASize(1, 2), DestinationETARegistration.MinSize);
        Assert.Equal(new DestinationETASize(3, 40), DestinationETARegistration.MaxSize);
        Assert.Equal("Destination ETA", DestinationETARegistration.Name(Localizer));
        Assert.Equal("Active navigation: destination, distance remaining, arrival countdown", DestinationETARegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 2, true)]    // default
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DestinationETARegistration.IsWithinBounds(new DestinationETASize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DestinationETASize(1, 2), DestinationETARegistration.Clamp(new DestinationETASize(0, 0)));
        Assert.Equal(new DestinationETASize(3, 40), DestinationETARegistration.Clamp(new DestinationETASize(9, 99)));
    }

    [Fact]
    public void Size_is_compact_only_at_single_column()
    {
        Assert.True(new DestinationETASize(1, 2).IsCompact);
        Assert.False(new DestinationETASize(2, 2).IsCompact);
        Assert.False(new DestinationETASize(3, 40).IsCompact);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DestinationETADiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DestinationETAWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DestinationETASource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_snapshot()
    {
        using var snapshot = JsonDocument.Parse(NavigatingJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new DestinationETASource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Home Depot", terminal.Value!.DestinationName);
        Assert.Equal(95, terminal.Value.MinutesToArrival);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_location_snapshots_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var snapshot = JsonDocument.Parse(HomeJson);
        var api = new FakeApiClient().ReturnsValue(snapshot.RootElement);
        var source = new DestinationETASource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.True(results[^1].Value!.LocatedAtHome);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new DestinationETASource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static DestinationETAReading NavigatingReading() => new("Home Depot", 15000, 95, false, false, false);

    private static async Task<List<RepositoryResult<DestinationETAReading>>> Drain(IDestinationETASource source)
    {
        var list = new List<RepositoryResult<DestinationETAReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<DestinationETAReading> Loaded(DestinationETAReading reading) =>
        RepositoryResult<DestinationETAReading>.Loaded(reading, Now);

    private static DestinationETAViewModel NewViewModel(params RepositoryResult<DestinationETAReading>[] emissions) =>
        new(new FakeDestinationETASource(emissions), Localizer, DestinationETASize.Default);

    private sealed class FakeDestinationETASource(params RepositoryResult<DestinationETAReading>[] emissions) : IDestinationETASource
    {
        public async IAsyncEnumerable<RepositoryResult<DestinationETAReading>> StreamAsync(
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
