using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Trips;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the TripListPage's UI-thread-free logic — the trip JSON parse adapter, the
/// cache-then-network result mapper, the repository source's fleet-wide / vehicle-scoped request shape (web
/// <c>useTrips({ vehicle_id, limit })</c>), the projection (the four summary metrics, the top-10-by-distance
/// chart bars, the per-trip rows with the web <c>convertDistanceFromSI</c> distance, the unit-aware
/// <c>formatEnergy</c>, the <c>formatCurrency</c> cost, the Wh/(distance-unit) efficiency, the date label and
/// the page's own <c>formatDuration</c>), the CSV / JSON export serializers, the state-holder view-model's three
/// data states (loading / success / empty) plus the client-side pager and unit reproject, the i18n facade key
/// coverage for all 22 source strings, the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/trips/pages/TripListPage.tsx). The WinUI view itself is exercised by the app build; its
/// per-state branch selection is driven entirely by the <see cref="TripListState"/> + <see cref="TripListDisplay"/>
/// asserted here.
/// </summary>
public sealed class TripListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Start = new(2026, 1, 2, 8, 0, 0, TimeSpan.Zero);

    private static readonly string[] ExpectedStringKeys =
    {
        "trips.chart.col.trip",
        "trips.chart.distance",
        "trips.chart.empty",
        "trips.chart.title",
        "trips.chart.title.aria",
        "trips.export.csv",
        "trips.export.json",
        "trips.list.empty",
        "trips.list.heading",
        "trips.row.charges",
        "trips.row.cost",
        "trips.row.drives",
        "trips.row.trip",
        "trips.stats.cost",
        "trips.stats.distance",
        "trips.stats.driveCount",
        "trips.stats.energy",
        "trips.stats.total",
        "trips.stats.totalDrives",
        "trips.stats.tripCount",
        "trips.subtitle",
        "trips.title",
    };

    private const string SampleJson = """
    [
      {"id":10,"name":"Coast run","start_date":"2026-01-02T08:00:00Z","end_date":"2026-01-02T09:05:00Z","total_distance_m":10000,"total_energy_wh":5000,"total_cost":4.0,"drive_count":3,"charge_count":1},
      {"id":11,"start_date":"2026-01-03T08:00:00Z","total_distance_m":"4000","total_energy_wh":1500,"total_cost":0,"drive_count":1,"charge_count":0}
    ]
    """;

    // ---- Parsing -------------------------------------------------------------------

    [Fact]
    public void ParseList_maps_every_field_and_tolerates_partial_rows()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var trips = TripListItem.ParseList(doc.RootElement);

        Assert.Equal(2, trips.Count);

        Assert.Equal(10, trips[0].Id);
        Assert.Equal("Coast run", trips[0].Name);
        Assert.NotNull(trips[0].StartInstant);
        Assert.NotNull(trips[0].EndInstant);
        Assert.Equal(10000, trips[0].TotalDistanceM);
        Assert.Equal(5000, trips[0].TotalEnergyWh);
        Assert.Equal(4.0, trips[0].TotalCost);
        Assert.Equal(3, trips[0].DriveCount);
        Assert.Equal(1, trips[0].ChargeCount);

        // Missing name + end_date, string-encoded distance — all tolerated.
        Assert.Equal(11, trips[1].Id);
        Assert.Null(trips[1].Name);
        Assert.Null(trips[1].EndInstant);
        Assert.Equal(4000, trips[1].TotalDistanceM);
        Assert.Equal(0, trips[1].ChargeCount);
    }

    [Fact]
    public void ParseList_returns_empty_for_a_non_array_body()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(TripListItem.ParseList(doc.RootElement));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void ResultMapper_preserves_status_and_parses_the_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var loaded = TripListResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Count);

        Assert.Equal(LoadStatus.Loading, TripListResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, TripListResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
    }

    // ---- Source request shape ------------------------------------------------------

    [Fact]
    public async Task Source_scopes_the_request_to_the_primary_vehicle_with_the_limit()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new TripListSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_trips", request.OperationId);
        Assert.Equal(TripListProjection.FetchLimit, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_reads_fleet_wide_and_omits_vehicle_id()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new TripListSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.False(request.Query!.ContainsKey("vehicle_id"));
        Assert.Equal(TripListProjection.FetchLimit, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_an_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new TripListSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Projection: strings + stat cards + chart + rows ---------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_through_the_facade()
    {
        var recorder = new RecordingLocalizer();
        var trips = new[] { Trip(1, name: null, driveCount: 2, chargeCount: 2, cost: 3) };

        _ = TripListProjection.Project(trips, TripListState.Success, 1, UnitPref.Metric, recorder, Now);

        foreach (var key in ExpectedStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_carries_the_chrome_strings_in_every_state()
    {
        foreach (var state in new[] { TripListState.Loading, TripListState.Empty, TripListState.Success })
        {
            var display = TripListProjection.Project(Array.Empty<TripListItem>(), state, 1, UnitPref.Metric, Localizer, Now);

            Assert.Equal("Trips", display.Title);
            Assert.Equal("Multi-drive trip reports with distance and cost tracking", display.Subtitle);
            Assert.Equal("Top Trips by Distance", display.ChartTitle);
            Assert.Equal("Top trips ranked by distance horizontal bar chart", display.ChartAriaLabel);
            Assert.Equal("All Trips", display.ListHeading);
            Assert.Equal("No trips recorded yet", display.ListEmptyMessage);
            Assert.Equal("No trip data to chart", display.ChartEmptyMessage);
            Assert.Equal("Trip", display.ChartTripColumnLabel);
        }
    }

    [Fact]
    public void Projection_builds_four_stat_cards_in_web_order()
    {
        var trips = new[]
        {
            Trip(10, name: "A", distanceM: 10000, energyWh: 5000, cost: 4, driveCount: 3),
            Trip(11, name: "B", distanceM: 4000, energyWh: 1500, cost: 0, driveCount: 1),
        };

        var display = TripListProjection.Project(trips, TripListState.Success, 1, UnitPref.Metric, Localizer, Now);

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal(new[] { "distance", "energy", "cost", "total" }, display.StatCards.Select(c => c.Key).ToArray());

        Assert.Equal("Total Distance", display.StatCards[0].Label);
        Assert.Equal("14 km", display.StatCards[0].Value);
        Assert.Equal("2 trips", display.StatCards[0].Sublabel);
        Assert.Equal(TripListProjection.CyanAccentBrushKey, display.StatCards[0].AccentBrushKey);

        Assert.Equal("Energy Used", display.StatCards[1].Label);
        Assert.EndsWith("Wh", display.StatCards[1].Value);
        Assert.Equal("4 drives", display.StatCards[1].Sublabel);

        Assert.Equal("Total Cost", display.StatCards[2].Label);
        Assert.Equal("$4.00", display.StatCards[2].Value);

        Assert.Equal("Total Trips", display.StatCards[3].Label);
        Assert.Equal("2", display.StatCards[3].Value);
        Assert.Equal("4 total drives", display.StatCards[3].Sublabel);
    }

    [Fact]
    public void Projection_renders_zero_stat_cards_in_the_empty_state_but_no_chart_or_rows()
    {
        var display = TripListProjection.Project(Array.Empty<TripListItem>(), TripListState.Empty, 1, UnitPref.Metric, Localizer, Now);

        Assert.Equal(4, display.StatCards.Count);
        Assert.Equal("0 km", display.StatCards[0].Value);
        Assert.Equal("0 trips", display.StatCards[0].Sublabel);
        Assert.Empty(display.ChartBars);
        Assert.Empty(display.Rows);
        Assert.False(display.HasChart);
        Assert.False(display.HasRows);
    }

    [Fact]
    public void Projection_loading_state_emits_no_stat_cards()
    {
        var display = TripListProjection.Project(Array.Empty<TripListItem>(), TripListState.Loading, 1, UnitPref.Metric, Localizer, Now);
        Assert.Empty(display.StatCards);
    }

    [Fact]
    public void Projection_builds_top_ten_chart_bars_sorted_by_distance_descending()
    {
        var trips = new List<TripListItem>();
        for (int i = 1; i <= 12; i++)
        {
            trips.Add(Trip(i, name: $"T{i}", distanceM: i * 1000));
        }

        var display = TripListProjection.Project(trips, TripListState.Success, 1, UnitPref.Metric, Localizer, Now);

        Assert.Equal(TripListProjection.ChartTopN, display.ChartBars.Count);
        // Highest distance first; the largest (12 km) anchors the full-width ratio.
        Assert.Equal("T12", display.ChartBars[0].Name);
        Assert.Equal(1.0, display.ChartBars[0].Ratio, 3);
        Assert.True(display.ChartBars[0].DistanceValue >= display.ChartBars[1].DistanceValue);
    }

    [Fact]
    public void Projection_chart_bar_uses_the_name_fallback_and_converts_distance()
    {
        var trip = Trip(42, name: null, distanceM: 10000);

        var metric = TripListProjection.Project(new[] { trip }, TripListState.Success, 1, UnitPref.Metric, Localizer, Now).ChartBars[0];
        var imperial = TripListProjection.Project(new[] { trip }, TripListState.Success, 1, UnitPref.Imperial, Localizer, Now).ChartBars[0];

        Assert.Equal("Trip 42", metric.Name);
        Assert.Equal("10 km", metric.DistanceText);
        Assert.Equal("6 mi", imperial.DistanceText);
    }

    [Fact]
    public void Projection_row_ports_name_fallback_duration_drives_charges_distance_and_efficiency()
    {
        var trip = Trip(42, name: null, distanceM: 10000, energyWh: 5000, cost: 4, driveCount: 3, chargeCount: 1,
            start: Start, end: Start.AddMinutes(65));

        var row = TripListProjection.Project(new[] { trip }, TripListState.Success, 1, UnitPref.Metric, Localizer, Now).Rows[0];

        Assert.Equal(42, row.Id);
        Assert.Equal("Trip #42", row.Name);              // web trip.name ?? `Trip #${id}`
        Assert.Equal("1h 5m", row.DurationText);          // web formatDuration hours + minutes
        Assert.Equal("3 drives", row.DrivesText);
        Assert.True(row.HasCharges);
        Assert.Equal("1 charges", row.ChargesText);
        Assert.Equal("10 km", row.DistanceText);
        Assert.Equal("500 Wh/km", row.EfficiencyText);    // 5000 Wh / 10 km
        Assert.True(row.HasCost);
        Assert.Equal("$4.00", row.CostText);
        Assert.Contains(",", row.DateText);               // web formatDate -> "MMM d, yyyy"
    }

    [Fact]
    public void Projection_row_hides_cost_and_charges_and_shows_in_progress_when_absent()
    {
        // Constructed directly so EndInstant is genuinely null (the Trip helper defaults a 30-minute end).
        var trip = new TripListItem(7, "Solo", Start, null, 8000, 2000, 0, 1, 0);

        var row = TripListProjection.Project(new[] { trip }, TripListState.Success, 1, UnitPref.Metric, Localizer, Now).Rows[0];

        Assert.False(row.HasCost);
        Assert.Equal(string.Empty, row.CostText);
        Assert.False(row.HasCharges);
        Assert.Equal("In progress", row.DurationText);
    }

    [Fact]
    public void Projection_imperial_efficiency_uses_wh_per_mile()
    {
        var trip = Trip(1, name: "A", distanceM: 16093.44, energyWh: 5000); // 10 mi
        var row = TripListProjection.Project(new[] { trip }, TripListState.Success, 1, UnitPref.Imperial, Localizer, Now).Rows[0];

        Assert.EndsWith("Wh/mi", row.EfficiencyText);
    }

    [Theory]
    [InlineData(0, "In progress")]   // no end -> in-progress label
    [InlineData(25, "25m")]          // under an hour
    [InlineData(65, "1h 5m")]        // hours + minutes
    [InlineData(60, "1h")]           // exact hour, sub-half-minute remainder
    public void FormatDuration_ports_the_web_rules(int minutes, string expected)
    {
        DateTimeOffset? end = minutes == 0 ? null : Start.AddMinutes(minutes);
        Assert.Equal(expected, TripListProjection.FormatDuration(Start, end, Localizer));
    }

    // ---- Pagination ----------------------------------------------------------------

    [Fact]
    public void Projection_paginates_rows_client_side()
    {
        var trips = BuildTrips(15);

        var page1 = TripListProjection.Project(trips, TripListState.Success, 1, UnitPref.Metric, Localizer, Now);
        Assert.Equal(15, page1.TotalRowCount);
        Assert.Equal(TripListProjection.DisplayPageSize, page1.Rows.Count);
        Assert.Equal(1, page1.RangeStart);
        Assert.Equal(10, page1.RangeEnd);

        var page2 = TripListProjection.Project(trips, TripListState.Success, 2, UnitPref.Metric, Localizer, Now);
        Assert.Equal(5, page2.Rows.Count);
        Assert.Equal(11, page2.RangeStart);
        Assert.Equal(15, page2.RangeEnd);

        // Out-of-range page clamps to the last available page.
        var clamped = TripListProjection.Project(trips, TripListState.Success, 99, UnitPref.Metric, Localizer, Now);
        Assert.Equal(2, clamped.Page);
    }

    // ---- Export serializers --------------------------------------------------------

    [Fact]
    public void BuildCsv_emits_the_web_columns_and_raw_si_values()
    {
        var trips = new[] { Trip(10, name: "Coast run", distanceM: 10000, energyWh: 5000, cost: 4, driveCount: 3, chargeCount: 1) };

        string csv = TripListProjection.BuildCsv(trips, Localizer);

        Assert.StartsWith("id,name,start_date,end_date,distance_m,energy_wh,cost,drives,charges", csv);
        Assert.Contains("10,Coast run,", csv);
        Assert.Contains(",10000,5000,4,3,1", csv);
    }

    [Fact]
    public void BuildJson_serializes_the_snake_case_trip_shape()
    {
        var trips = new[] { Trip(10, name: "Coast run", distanceM: 10000, energyWh: 5000, cost: 4, driveCount: 3, chargeCount: 1) };

        string json = TripListProjection.BuildJson(trips);

        Assert.Contains("\"id\": 10", json);
        Assert.Contains("\"total_distance_m\": 10000", json);
        Assert.Contains("\"charge_count\": 1", json);
    }

    // ---- View-model state matrix (loading / success / empty) -----------------------

    [Fact]
    public async Task ViewModel_loading_then_success_lists_the_trips()
    {
        var trips = new[] { Trip(1, name: "A"), Trip(2, name: "B") };
        var source = new FakeTripListSource(
            RepositoryResult<IReadOnlyList<TripListItem>>.Loading(),
            RepositoryResult<IReadOnlyList<TripListItem>>.Loaded(trips, Now));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TripListState.Success, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
        Assert.Equal(2, vm.CurrentTrips.Count);
    }

    [Fact]
    public async Task ViewModel_empty_response_shows_the_empty_state()
    {
        var source = new FakeTripListSource(RepositoryResult<IReadOnlyList<TripListItem>>.Empty(Now));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TripListState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
        Assert.False(string.IsNullOrEmpty(vm.Display.ListEmptyMessage));
        Assert.Equal(4, vm.Display.StatCards.Count); // zero-value cards still render (web parity)
    }

    [Fact]
    public async Task ViewModel_loaded_but_no_trips_is_empty()
    {
        var source = new FakeTripListSource(
            RepositoryResult<IReadOnlyList<TripListItem>>.Loaded(Array.Empty<TripListItem>(), Now));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TripListState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_with_no_cache_folds_into_empty_like_the_web()
    {
        var source = new FakeTripListSource(RepositoryResult<IReadOnlyList<TripListItem>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TripListState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_trips_visible()
    {
        var trips = new[] { Trip(1, name: "A") };
        var source = new FakeTripListSource(RepositoryResult<IReadOnlyList<TripListItem>>.OfflineCached(
            trips, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TripListState.Success, vm.State);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_reproject_on_unit_change_reformats_distance()
    {
        var trips = new[] { Trip(1, name: "A", distanceM: 10000) };
        var source = new FakeTripListSource(RepositoryResult<IReadOnlyList<TripListItem>>.Loaded(trips, Now));
        using var vm = new TripListPageViewModel(source, Localizer);

        await vm.LoadAsync();
        Assert.Equal("10 km", vm.Display.Rows[0].DistanceText);

        vm.Units = UnitPref.Imperial;
        Assert.EndsWith(" mi", vm.Display.Rows[0].DistanceText);
    }

    [Fact]
    public async Task ViewModel_go_to_page_slices_rows_without_refetching()
    {
        var source = new FakeTripListSource(RepositoryResult<IReadOnlyList<TripListItem>>.Loaded(BuildTrips(15), Now));
        using var vm = new TripListPageViewModel(source, Localizer);
        await vm.LoadAsync();

        Assert.Equal(1, vm.Page);
        Assert.Equal(10, vm.Display.Rows.Count);

        vm.GoToPage(2);

        Assert.Equal(2, vm.Page);
        Assert.Equal(5, vm.Display.Rows.Count);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_the_route_name_and_slug()
    {
        Assert.Equal("Trips", TripListRegistration.RouteName);
        Assert.Equal("trips", TripListRegistration.Route);
        Assert.Equal("TripListPage", TripListRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new TripListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripListPage", Assert.Single(lines));
    }

    // ---- Helpers + fakes -----------------------------------------------------------

    private static TripListItem Trip(
        long id,
        string? name,
        double distanceM = 1000,
        double energyWh = 100,
        double cost = 0,
        long driveCount = 1,
        long chargeCount = 0,
        DateTimeOffset? start = null,
        DateTimeOffset? end = null) =>
        new(id, name, start ?? Start, end ?? Start.AddMinutes(30), distanceM, energyWh, cost, driveCount, chargeCount);

    private static IReadOnlyList<TripListItem> BuildTrips(int count)
    {
        var trips = new List<TripListItem>(count);
        for (int i = 1; i <= count; i++)
        {
            trips.Add(Trip(i, name: $"T{i}", distanceM: i * 1000));
        }

        return trips;
    }

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<TripListItem>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripListItem>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TripListItem>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeTripListSource(params RepositoryResult<IReadOnlyList<TripListItem>>[] results)
        : ITripListSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripListItem>>> StreamAsync(
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
