using System.Globalization;
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
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the GeofenceWidget's UI-thread-free logic — the geofence list parser, the vehicle
/// position parser (the useVehicleState read, including the res.state envelope unwrap), the haversine + inside /
/// outside / current-zone projection, the unit-converted radius formatter, the two-source combine mapper, the
/// per-vehicle data source (the always-on geofences read + the optional position read), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline) plus the compact-vs-standard footprint and the map gate. Mirrors the web spec
/// (web/src/features/dashboard/widgets/GeofenceWidget.tsx).
/// </summary>
public sealed class GeofenceWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // Vehicle sits exactly on the Home fence centre; Work and Old Site are tens of km away.
    private const double HomeLat = 37.7749;
    private const double HomeLon = -122.4194;

    private const string GeofencesJson =
        """
        [
          {"id":"1","name":"Home","latitude":37.7749,"longitude":-122.4194,"radius":1000,"enabled":true},
          {"id":"2","name":"Work","latitude":37.3318,"longitude":-122.0312,"radius":2000,"enabled":true},
          {"id":"3","name":"Old Site","latitude":34.0522,"longitude":-118.2437,"radius":500,"enabled":false}
        ]
        """;

    private const string StateAtHomeJson =
        """{"state":{"vehicle_id":7,"latitude":37.7749,"longitude":-122.4194,"state":"online"}}""";

    // ---- Geofence list parse adapter (web useGeofences read) ------------------------

    [Fact]
    public void ParseList_reads_all_fence_fields()
    {
        using var doc = JsonDocument.Parse(GeofencesJson);

        var fences = GeofenceItem.ParseList(doc.RootElement);

        Assert.Equal(3, fences.Count);
        Assert.Equal("1", fences[0].Id);
        Assert.Equal("Home", fences[0].Name);
        Assert.Equal(37.7749, fences[0].Latitude);
        Assert.Equal(-122.4194, fences[0].Longitude);
        Assert.Equal(1000, fences[0].RadiusMeters);
        Assert.True(fences[0].Enabled);
        Assert.False(fences[2].Enabled);
    }

    [Fact]
    public void ParseList_applies_web_defaults_for_missing_fields()
    {
        // Web parity: g.name ?? '—' (kept null here), g.radius ?? 0, g.enabled ?? true.
        using var doc = JsonDocument.Parse("""[{"id":"x","latitude":1,"longitude":2}]""");

        var fence = Assert.Single(GeofenceItem.ParseList(doc.RootElement));

        Assert.Null(fence.Name);
        Assert.Equal(0, fence.RadiusMeters);
        Assert.True(fence.Enabled); // web g.enabled ?? true
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("\"x\"")]
    [InlineData("[]")]
    public void ParseList_returns_empty_for_non_array_or_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(GeofenceItem.ParseList(doc.RootElement));
    }

    [Fact]
    public void ParseList_coerces_numeric_id_to_string()
    {
        using var doc = JsonDocument.Parse("""[{"id":42,"latitude":1,"longitude":2,"radius":3}]""");

        var fence = Assert.Single(GeofenceItem.ParseList(doc.RootElement));

        Assert.Equal("42", fence.Id);
    }

    // ---- Vehicle position parse (web useVehicleState read) --------------------------

    [Fact]
    public void Position_unwraps_state_envelope_and_reads_coords()
    {
        using var doc = JsonDocument.Parse(StateAtHomeJson);

        var pos = GeofenceVehiclePosition.FromStateResponse(doc.RootElement);

        Assert.Equal(HomeLat, pos.Latitude);
        Assert.Equal(HomeLon, pos.Longitude);
        Assert.True(pos.HasCoordinates);
    }

    [Fact]
    public void Position_reads_flat_body_when_not_wrapped()
    {
        using var doc = JsonDocument.Parse("""{"latitude":10,"longitude":20}""");

        var pos = GeofenceVehiclePosition.FromStateResponse(doc.RootElement);

        Assert.Equal(10, pos.Latitude);
        Assert.Equal(20, pos.Longitude);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("5")]
    [InlineData("{}")]
    public void Position_without_coords_has_no_fix(string json)
    {
        using var doc = JsonDocument.Parse(json);

        var pos = GeofenceVehiclePosition.FromStateResponse(doc.RootElement);

        Assert.Equal(0, pos.Latitude);
        Assert.Equal(0, pos.Longitude);
        Assert.False(pos.HasCoordinates);
    }

    // ---- Haversine (web haversineMeters) -------------------------------------------

    [Fact]
    public void Haversine_is_zero_for_identical_points()
    {
        Assert.Equal(0, GeofenceProjection.HaversineMeters(HomeLat, HomeLon, HomeLat, HomeLon), 6);
    }

    [Fact]
    public void Haversine_one_degree_of_longitude_at_equator()
    {
        // 1° longitude at the equator ≈ R * π/180 ≈ 111195 m.
        double d = GeofenceProjection.HaversineMeters(0, 0, 0, 1);
        Assert.Equal(111195, d, 0);
    }

    // ---- Radius formatter (web fmtNumber(convertDistanceFromSI(metres, unit), 1) + unit) -

    [Fact]
    public void FormatRadius_metric_converts_metres_to_km()
    {
        Assert.Equal("1.0 km", GeofenceProjection.FormatRadius(1000, UnitPref.Metric));
    }

    [Fact]
    public void FormatRadius_imperial_converts_metres_to_miles()
    {
        // 1000 m / 1609.344 = 0.621 mi → "0.6 mi".
        Assert.Equal("0.6 mi", GeofenceProjection.FormatRadius(1000, UnitPref.Imperial));
    }

    // ---- Projection (inside / outside / disabled / current zone) --------------------

    [Fact]
    public void Project_at_home_marks_home_inside_and_current_zone()
    {
        var display = GeofenceProjection.Project(ReadingAtHome(), UnitPref.Metric, Localizer);

        Assert.Equal(3, display.Fences.Count);
        Assert.Equal(GeofenceFenceStatus.Inside, display.Fences[0].Status);
        Assert.Equal("Inside", display.Fences[0].StatusLabel);
        Assert.True(display.Fences[0].Inside);
        Assert.True(display.Fences[0].Highlighted);
        Assert.Equal("Radius: 1.0 km", display.Fences[0].RadiusDetail);

        Assert.Equal(GeofenceFenceStatus.Outside, display.Fences[1].Status);
        Assert.False(display.Fences[1].Inside);

        // Old Site is disabled — disabled wins over inside/outside (web !f.enabled branch).
        Assert.Equal(GeofenceFenceStatus.Disabled, display.Fences[2].Status);
        Assert.Equal("Disabled", display.Fences[2].StatusLabel);
        Assert.False(display.Fences[2].Highlighted);

        Assert.Equal("Home", display.CurrentZoneName);
        Assert.True(display.HasCurrentZone);
        Assert.Equal("Home", display.CompactBadgeLabel);
        Assert.True(display.HasCoordinates);
    }

    [Fact]
    public void Project_without_fix_has_no_inside_and_no_zone()
    {
        // Web parity: hasCoords false → dist = Infinity → nothing inside, currentZone undefined.
        var reading = new GeofenceWidgetReading(GeofenceVehiclePosition.None, FencesFixture());

        var display = GeofenceProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.All(display.Fences, f => Assert.NotEqual(GeofenceFenceStatus.Inside, f.Status));
        Assert.Null(display.CurrentZoneName);
        Assert.False(display.HasCurrentZone);
        Assert.Equal("No zone", display.CompactBadgeLabel);
        Assert.False(display.HasCoordinates);
    }

    [Fact]
    public void Project_uses_em_dash_for_missing_name()
    {
        var reading = new GeofenceWidgetReading(
            GeofenceVehiclePosition.None,
            [new GeofenceItem("z", null, 1, 2, 100, true)]);

        var display = GeofenceProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal(GeofenceProjection.EmDash, display.Fences[0].Name);
    }

    [Fact]
    public void Project_reprojects_radius_in_imperial()
    {
        var display = GeofenceProjection.Project(ReadingAtHome(), UnitPref.Imperial, Localizer);

        Assert.Equal("Radius: 0.6 mi", display.Fences[0].RadiusDetail);
    }

    [Fact]
    public void Project_row_automation_name_summarises_fence()
    {
        // Accessibility: every row carries a Narrator-ready name (name, status, radius).
        var display = GeofenceProjection.Project(ReadingAtHome(), UnitPref.Metric, Localizer);

        Assert.Equal("Home, Inside, Radius: 1.0 km", display.Fences[0].AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
    }

    // ---- Combine mapper (parse + preserve status) ----------------------------------

    [Fact]
    public void Combine_loaded_state_and_fences_yields_loaded_reading()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);
        using var fences = JsonDocument.Parse(GeofencesJson);

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.Loaded(state.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(fences.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(3, result.Value!.Fences.Count);
        Assert.True(result.Value.Position.HasCoordinates);
    }

    [Fact]
    public void Combine_empty_fences_collapses_to_empty()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);
        using var empty = JsonDocument.Parse("[]");

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.Loaded(state.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, result.Status);
        Assert.Equal(Now, result.FetchedAt);
    }

    [Fact]
    public void Combine_fences_hard_error_yields_failure()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.Loaded(state.RootElement, Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_stale_fences_render_with_stale_flag()
    {
        using var fences = JsonDocument.Parse(GeofencesJson);

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Cached(fences.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
        Assert.Equal(3, result.Value!.Fences.Count);
    }

    [Fact]
    public void Combine_offline_state_keeps_fences_and_marks_offline()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);
        using var fences = JsonDocument.Parse(GeofencesJson);

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.OfflineCached(state.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Loaded(fences.RootElement, Now));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.Equal(3, result.Value!.Fences.Count);
    }

    [Fact]
    public void Combine_partial_state_error_still_renders_fences()
    {
        using var fences = JsonDocument.Parse(GeofencesJson);

        var result = GeofenceCombiner.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "state down")),
            RepositoryResult<JsonElement>.Loaded(fences.RootElement, Now));

        // The fence list is the content; a failed position read only tints the freshness chip.
        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.Equal(3, result.Value!.Fences.Count);
        Assert.False(result.Value.Position.HasCoordinates);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<GeofenceWidgetReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_fence_display()
    {
        using var vm = NewViewModel(Loaded(ReadingAtHome()));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.Equal(3, vm.Display!.Fences.Count);
        Assert.Equal("Home", vm.Display.CurrentZoneName);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<GeofenceWidgetReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No geofences configured", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<GeofenceWidgetReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<GeofenceWidgetReading>.Cached(ReadingAtHome(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<GeofenceWidgetReading>.OfflineCached(
            ReadingAtHome(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<GeofenceWidgetReading>.Loading(),
            RepositoryResult<GeofenceWidgetReading>.Cached(ReadingAtHome(), Now, stale: false),
            RepositoryResult<GeofenceWidgetReading>.Loaded(ReadingAtHome(), Now));
        await vm.LoadAsync();

        Assert.Equal(GeofenceState.Loaded, vm.State);
        Assert.Equal(3, vm.Display!.Fences.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_radius()
    {
        using var vm = NewViewModel(Loaded(ReadingAtHome()));
        await vm.LoadAsync();
        Assert.Equal("Radius: 1.0 km", vm.Display!.Fences[0].RadiusDetail);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Radius: 0.6 mi", vm.Display!.Fences[0].RadiusDetail);
        Assert.Equal(GeofenceState.Loaded, vm.State);
    }

    [Fact]
    public void ViewModel_compact_flag_tracks_footprint()
    {
        using var vm = NewViewModel(RepositoryResult<GeofenceWidgetReading>.Empty(Now));

        Assert.False(vm.IsCompact); // default 2×4

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new GeofenceSize(1, 2);

        Assert.True(vm.IsCompact);
        Assert.Contains(nameof(GeofenceViewModel.IsCompact), changed);
        Assert.Contains(nameof(GeofenceViewModel.Size), changed);
    }

    [Fact]
    public async Task ViewModel_show_map_requires_fix_and_three_rows()
    {
        using var vm = NewViewModel(Loaded(ReadingAtHome()));
        await vm.LoadAsync();

        // Default 2×4 with a fix → map shown (web showMap = hasCoords && size.rows >= 3).
        Assert.True(vm.ShowMap);

        vm.Size = new GeofenceSize(2, 2); // below the 3-row map threshold
        Assert.False(vm.ShowMap);
    }

    [Fact]
    public async Task ViewModel_show_map_false_without_fix()
    {
        using var vm = NewViewModel(Loaded(new GeofenceWidgetReading(GeofenceVehiclePosition.None, FencesFixture())));
        await vm.LoadAsync();

        Assert.False(vm.ShowMap);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<GeofenceWidgetReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Geofence Status", vm.Title);
        Assert.Equal("No geofences configured", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(ReadingAtHome()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(GeofenceViewModel.State), changed);
        Assert.Contains(nameof(GeofenceViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("geofence-status", GeofenceRegistration.Id);
        Assert.Equal("maps", GeofenceRegistration.Category);
        Assert.Equal("GeofenceWidget", GeofenceRegistration.Slug);
        Assert.Equal(new GeofenceSize(2, 4), GeofenceRegistration.DefaultSize);
        Assert.Equal(new GeofenceSize(1, 2), GeofenceRegistration.MinSize);
        Assert.Equal(new GeofenceSize(4, 40), GeofenceRegistration.MaxSize);
        Assert.Equal("Geofence Status", GeofenceRegistration.Name(Localizer));
        Assert.Equal(
            "Configured geofences with inside/outside status for current vehicle",
            GeofenceRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 4, true)]    // default
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, GeofenceRegistration.IsWithinBounds(new GeofenceSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new GeofenceSize(1, 2), GeofenceRegistration.Clamp(new GeofenceSize(0, 0)));
        Assert.Equal(new GeofenceSize(4, 40), GeofenceRegistration.Clamp(new GeofenceSize(9, 99)));
    }

    [Fact]
    public void Size_is_compact_only_at_single_column()
    {
        Assert.True(new GeofenceSize(1, 2).IsCompact);
        Assert.False(new GeofenceSize(2, 4).IsCompact);
        Assert.True(new GeofenceSize(2, 4).AllowsMap);
        Assert.False(new GeofenceSize(2, 2).AllowsMap);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GeofenceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GeofenceWidget", Assert.Single(lines));
    }

    // ---- Source (always-on geofences + optional position read) ---------------------

    [Fact]
    public async Task Source_resolves_primary_then_loads_geofences_and_state()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);
        using var fences = JsonDocument.Parse(GeofencesJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.Vehicles.State, state.RootElement)
            .Returns(Operations.Locations.Geofences, fences.RootElement);

        var source = new GeofenceSource(
            new FakeWidgetVehicleSource(Snapshot(7)), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(3, terminal.Value!.Fences.Count);
        Assert.True(terminal.Value.Position.HasCoordinates);

        Assert.Equal("7", StateRequest(api).PathParams!["vehicleID"]);
        Assert.Equal("get_api_v1_geofences", FencesRequest(api).OperationId);
    }

    [Fact]
    public async Task Source_without_vehicle_still_loads_geofences()
    {
        using var fences = JsonDocument.Parse(GeofencesJson);
        var api = new KeyedFakeApiClient().Returns(Operations.Locations.Geofences, fences.RootElement);

        var source = new GeofenceSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        // Web parity: useGeofences() has no vehicle gate — the list renders with no position.
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(3, terminal.Value!.Fences.Count);
        Assert.False(terminal.Value.Position.HasCoordinates);
        Assert.All(api.Requests, r => Assert.Equal(Operations.Locations.Geofences, r.OperationId));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_state_read()
    {
        using var state = JsonDocument.Parse(StateAtHomeJson);
        using var fences = JsonDocument.Parse(GeofencesJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.Vehicles.State, state.RootElement)
            .Returns(Operations.Locations.Geofences, fences.RootElement);

        var source = new GeofenceSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", StateRequest(api).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_empty_geofences_yields_empty()
    {
        using var empty = JsonDocument.Parse("[]");
        var api = new KeyedFakeApiClient().Returns(Operations.Locations.Geofences, empty.RootElement);

        var source = new GeofenceSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_geofences_failure_yields_error()
    {
        var api = new KeyedFakeApiClient()
            .Throws(Operations.Locations.Geofences, new HttpRequestException("down"));

        var source = new GeofenceSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Error, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static WidgetVehicleSnapshot Snapshot(long id) => new() { VehicleId = id };

    private static IReadOnlyList<GeofenceItem> FencesFixture()
    {
        using var doc = JsonDocument.Parse(GeofencesJson);
        return GeofenceItem.ParseList(doc.RootElement);
    }

    private static GeofenceWidgetReading ReadingAtHome() =>
        new(new GeofenceVehiclePosition(HomeLat, HomeLon), FencesFixture());

    private static RepositoryResult<GeofenceWidgetReading> Loaded(GeofenceWidgetReading reading) =>
        RepositoryResult<GeofenceWidgetReading>.Loaded(reading, Now);

    private static GeofenceViewModel NewViewModel(params RepositoryResult<GeofenceWidgetReading>[] emissions) =>
        new(new FakeGeofenceSource(emissions), Localizer, GeofenceSize.Default);

    private static async Task<List<RepositoryResult<GeofenceWidgetReading>>> DrainAsync(IGeofenceSource source)
    {
        var list = new List<RepositoryResult<GeofenceWidgetReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static ApiRequest StateRequest(KeyedFakeApiClient api) =>
        api.Requests.First(r => r.OperationId == Operations.Vehicles.State);

    private static ApiRequest FencesRequest(KeyedFakeApiClient api) =>
        api.Requests.First(r => r.OperationId == Operations.Locations.Geofences);

    private sealed class FakeGeofenceSource(params RepositoryResult<GeofenceWidgetReading>[] emissions) : IGeofenceSource
    {
        public async IAsyncEnumerable<RepositoryResult<GeofenceWidgetReading>> StreamAsync(
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

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public KeyedFakeApiClient Throws(string operationId, Exception exception)
        {
            _responses[operationId] = () => throw exception;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
