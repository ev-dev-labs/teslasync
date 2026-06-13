using System.Globalization;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Sharing;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SharingTripsPage's UI-thread-free logic — the trip JSON parse adapter, the
/// cache-then-network result mapper, the repository source's fleet-wide / vehicle-scoped request shape (web
/// <c>useTrips({ vehicle_id, limit: 20 })</c>), the projection (the web <c>convertDistanceFromSI</c> +
/// <c>fmtInt</c> distance, the <c>fmtNumber(total_energy_wh)</c> watt-hour readout, the page's own
/// <c>formatDuration</c> rules, the date label, the "Trip #{id}" name fallback and the "{n} drives" tally), the
/// state-holder view-model's three data states (loading / success / empty) plus the single trip-selection
/// model, the i18n facade key coverage for all 8 source strings, the registry metadata and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/sharing/pages/SharingTripsPage.tsx). The WinUI view itself
/// is exercised by the app build; its per-state branch selection (GlassPanel1 skeletons / empty / list,
/// GlassPanel2 hint) is driven entirely by the <see cref="SharingTripsState"/> + <see cref="SharingTripsDisplay"/>
/// asserted here.
/// </summary>
public sealed class SharingTripsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Start = new(2026, 1, 2, 8, 0, 0, TimeSpan.Zero);

    private static readonly string[] ExpectedStringKeys =
    {
        "sharing.trips.recent.empty",
        "sharing.trips.recent.heading",
        "sharing.trips.row.drives",
        "sharing.trips.row.trip",
        "sharing.trips.staticHint.body",
        "sharing.trips.staticHint.heading",
        "sharing.trips.subtitle",
        "sharing.trips.title",
    };

    private const string SampleJson = """
    [
      {"id":10,"name":"Coast run","start_date":"2026-01-02T08:00:00Z","end_date":"2026-01-02T09:05:00Z","total_distance_m":10000,"drive_count":3,"total_energy_wh":500},
      {"id":11,"start_date":"2026-01-03T08:00:00Z","total_distance_m":"2500","drive_count":1,"total_energy_wh":150}
    ]
    """;

    // ---- Parsing -------------------------------------------------------------------

    [Fact]
    public void ParseList_maps_every_field_and_tolerates_partial_rows()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var trips = SharingTrip.ParseList(doc.RootElement);

        Assert.Equal(2, trips.Count);

        Assert.Equal(10, trips[0].Id);
        Assert.Equal("Coast run", trips[0].Name);
        Assert.NotNull(trips[0].StartInstant);
        Assert.NotNull(trips[0].EndInstant);
        Assert.Equal(10000, trips[0].TotalDistanceM);
        Assert.Equal(3, trips[0].DriveCount);
        Assert.Equal(500, trips[0].TotalEnergyWh);

        // Missing name + end_date, string-encoded distance — all tolerated.
        Assert.Equal(11, trips[1].Id);
        Assert.Null(trips[1].Name);
        Assert.Null(trips[1].EndInstant);
        Assert.Equal(2500, trips[1].TotalDistanceM);
    }

    [Fact]
    public void ParseList_returns_empty_for_a_non_array_body()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(SharingTrip.ParseList(doc.RootElement));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void ResultMapper_preserves_status_and_parses_the_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var loaded = SharingTripsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Count);

        Assert.Equal(LoadStatus.Loading, SharingTripsResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, SharingTripsResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
    }

    // ---- Source request shape ------------------------------------------------------

    [Fact]
    public async Task Source_scopes_the_request_to_the_primary_vehicle_with_the_limit()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new SharingTripsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_trips", request.OperationId);
        Assert.Equal(SharingTripsProjection.FetchLimit, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_reads_fleet_wide_and_omits_vehicle_id()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new SharingTripsSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.False(request.Query!.ContainsKey("vehicle_id"));
        Assert.Equal(SharingTripsProjection.FetchLimit, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_an_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new SharingTripsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Projection: strings + row formatting --------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_through_the_facade()
    {
        var recorder = new RecordingLocalizer();
        var trips = new[] { Trip(1, name: null, driveCount: 2) };

        _ = SharingTripsProjection.Project(trips, SharingTripsState.Success, UnitPref.Metric, recorder, Now);

        foreach (var key in ExpectedStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_carries_both_panels_constant_strings_in_every_state()
    {
        foreach (var state in new[] { SharingTripsState.Loading, SharingTripsState.Empty, SharingTripsState.Success })
        {
            var display = SharingTripsProjection.Project(Array.Empty<SharingTrip>(), state, UnitPref.Metric, Localizer, Now);

            // GlassPanel1 header + empty message.
            Assert.Equal("Recent trips", display.RecentHeading);
            Assert.Equal("No recent trips. Drive your vehicle to populate this list.", display.EmptyMessage);

            // GlassPanel2 static-hint heading + body.
            Assert.Equal("Static share cards", display.StaticHintHeading);
            Assert.Contains("static, redacted share card", display.StaticHintBody);

            // Page chrome.
            Assert.Equal("Share a trip", display.Title);
            Assert.Equal("Pick a recent trip to share as a static link, postcard, or image.", display.Subtitle);
        }
    }

    [Fact]
    public void Projection_only_builds_rows_in_the_success_state()
    {
        var trips = new[] { Trip(1, name: "A", driveCount: 1) };

        Assert.Empty(SharingTripsProjection.Project(trips, SharingTripsState.Loading, UnitPref.Metric, Localizer, Now).Rows);
        Assert.Empty(SharingTripsProjection.Project(trips, SharingTripsState.Empty, UnitPref.Metric, Localizer, Now).Rows);

        var success = SharingTripsProjection.Project(trips, SharingTripsState.Success, UnitPref.Metric, Localizer, Now);
        Assert.True(success.HasRows);
        Assert.Single(success.Rows);
    }

    [Fact]
    public void Projection_row_uses_the_name_fallback_drives_tally_energy_and_date()
    {
        var trip = Trip(42, name: null, driveCount: 3, distanceM: 10000, energyWh: 500,
            start: Start, end: Start.AddMinutes(25));
        var row = SharingTripsProjection.Project(new[] { trip }, SharingTripsState.Success, UnitPref.Metric, Localizer, Now).Rows[0];

        Assert.Equal(42, row.Id);
        Assert.Equal("Trip #42", row.Name);          // web trip.name ?? `Trip #${id}`
        Assert.Equal("3 drives", row.DrivesText);     // web {{count}} drives
        Assert.Equal("500 Wh", row.EnergyText);       // web fmtNumber(total_energy_wh) + " Wh"
        Assert.Equal("25m", row.DurationText);        // web formatDuration under an hour
        Assert.Contains(",", row.DateText);           // web formatDate -> "MMM d, yyyy"
        Assert.NotEqual("\u2014", row.DateText);
    }

    [Fact]
    public void Projection_converts_distance_to_the_active_display_unit()
    {
        var trip = Trip(1, name: "A", distanceM: 10000);

        var metric = SharingTripsProjection.Project(new[] { trip }, SharingTripsState.Success, UnitPref.Metric, Localizer, Now).Rows[0];
        var imperial = SharingTripsProjection.Project(new[] { trip }, SharingTripsState.Success, UnitPref.Imperial, Localizer, Now).Rows[0];

        Assert.Equal("10 km", metric.DistanceText);
        Assert.EndsWith(" mi", imperial.DistanceText);
        Assert.NotEqual(metric.DistanceText, imperial.DistanceText);
    }

    [Theory]
    [InlineData(0, "\u2014")]          // no end -> em-dash
    [InlineData(25, "25m")]            // under an hour
    [InlineData(65, "1h 5m")]          // hours + minutes
    [InlineData(60, "1h")]             // exact hour, sub-half-minute remainder
    public void FormatDuration_ports_the_web_rules(int minutes, string expected)
    {
        DateTimeOffset? end = minutes == 0 ? null : Start.AddMinutes(minutes);
        Assert.Equal(expected, SharingTripsProjection.FormatDuration(Start, end));
    }

    // ---- View-model state matrix (loading / success / empty) -----------------------

    [Fact]
    public async Task ViewModel_loading_then_success_lists_the_trips()
    {
        var trips = new[] { Trip(1, name: "A"), Trip(2, name: "B") };
        var source = new FakeSharingTripsSource(
            RepositoryResult<IReadOnlyList<SharingTrip>>.Loading(),
            RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(trips, Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SharingTripsState.Success, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_response_shows_the_empty_state()
    {
        var source = new FakeSharingTripsSource(RepositoryResult<IReadOnlyList<SharingTrip>>.Empty(Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SharingTripsState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
        Assert.False(string.IsNullOrEmpty(vm.Display.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_loaded_but_no_trips_is_empty()
    {
        var source = new FakeSharingTripsSource(
            RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(Array.Empty<SharingTrip>(), Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SharingTripsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_with_no_cache_folds_into_empty_like_the_web()
    {
        var source = new FakeSharingTripsSource(RepositoryResult<IReadOnlyList<SharingTrip>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SharingTripsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_trips_visible()
    {
        var trips = new[] { Trip(1, name: "A") };
        var source = new FakeSharingTripsSource(RepositoryResult<IReadOnlyList<SharingTrip>>.OfflineCached(
            trips, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(SharingTripsState.Success, vm.State);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_reproject_on_unit_change_reformats_distance()
    {
        var trips = new[] { Trip(1, name: "A", distanceM: 10000) };
        var source = new FakeSharingTripsSource(RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(trips, Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();
        Assert.Equal("10 km", vm.Display.Rows[0].DistanceText);

        vm.Units = UnitPref.Imperial;
        Assert.EndsWith(" mi", vm.Display.Rows[0].DistanceText);
    }

    // ---- Selection model -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_select_trip_sets_the_selection()
    {
        var trips = new[] { Trip(1, name: "A"), Trip(2, name: "B") };
        var source = new FakeSharingTripsSource(RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(trips, Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);
        await vm.LoadAsync();

        vm.SelectTrip(2);

        Assert.Equal(2L, vm.SelectedTripId);
    }

    [Fact]
    public async Task ViewModel_selection_is_cleared_when_the_list_becomes_empty()
    {
        var trips = new[] { Trip(1, name: "A") };
        var source = new FakeSharingTripsSource(
            RepositoryResult<IReadOnlyList<SharingTrip>>.Loaded(trips, Now),
            RepositoryResult<IReadOnlyList<SharingTrip>>.Empty(Now));
        using var vm = new SharingTripsPageViewModel(source, Localizer);

        await vm.LoadAsync();
        vm.SelectTrip(1);
        Assert.Equal(1L, vm.SelectedTripId);

        await vm.LoadAsync(); // second pass yields Loaded then Empty
        Assert.Null(vm.SelectedTripId);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_the_route_name_and_slug()
    {
        Assert.Equal("SharingTrips", SharingTripsRegistration.RouteName);
        Assert.Equal("sharing/trips", SharingTripsRegistration.Route);
        Assert.Equal("SharingTripsPage", SharingTripsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new SharingTripsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SharingTripsPage", Assert.Single(lines));
    }

    // ---- Helpers + fakes -----------------------------------------------------------

    private static SharingTrip Trip(
        long id,
        string? name,
        long driveCount = 1,
        double distanceM = 1000,
        double energyWh = 100,
        DateTimeOffset? start = null,
        DateTimeOffset? end = null) =>
        new(id, name, start ?? Start, end ?? Start.AddMinutes(30), distanceM, driveCount, energyWh);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<SharingTrip>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<SharingTrip>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SharingTrip>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSharingTripsSource(params RepositoryResult<IReadOnlyList<SharingTrip>>[] results)
        : ISharingTripsSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SharingTrip>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
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
