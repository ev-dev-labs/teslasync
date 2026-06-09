using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the TripSummaryWidget's UI-thread-free logic — the JSON parse adapter, the
/// compact footprint flag, the duration-range and distance formatting, the projection (featured "Last Trip"
/// card + the next-two recent rows + per-tile/per-row a11y), the cache-then-network result mapper, the
/// registry metadata, the diagnostics, the fleet-wide source adapter (limit query + empty short-circuit),
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline + size/units re-projection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/TripSummaryWidget.tsx).
/// </summary>
public sealed class TripSummaryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static TripSummaryTrip Trip(
        long id = 1,
        string? name = "Morning Commute",
        string? start = "2026-06-06T09:00:00Z",
        string? end = "2026-06-06T10:05:00Z",
        double distanceM = 12_340,
        long driveCount = 3,
        long chargeCount = 1) =>
        new(id, name, Parse(start), Parse(end), distanceM, driveCount, chargeCount);

    private static DateTimeOffset? Parse(string? iso) =>
        iso is null ? null : DateTimeOffset.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_array()
    {
        const string json = """
        [
          {"id":1,"vehicle_id":7,"name":"Road Trip","start_date":"2026-06-06T09:00:00Z","end_date":"2026-06-06T10:05:00Z","total_distance_m":12340,"drive_count":3,"charge_count":1},
          {"id":2,"vehicle_id":7,"name":null,"start_date":"2026-06-05T08:00:00Z","end_date":"2026-06-05T08:40:00Z","total_distance_m":500,"drive_count":1,"charge_count":0}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = TripSummaryTrip.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal("Road Trip", list[0].Name);
        Assert.Equal(12_340, list[0].TotalDistanceM);
        Assert.Equal(3, list[0].DriveCount);
        Assert.Equal(1, list[0].ChargeCount);
        Assert.NotNull(list[0].StartInstant);
        Assert.NotNull(list[0].EndInstant);
        Assert.Null(list[1].Name);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":3}]""");

        var trip = Assert.Single(TripSummaryTrip.ParseList(doc.RootElement));

        Assert.Equal(3, trip.Id);
        Assert.Null(trip.Name);
        Assert.Null(trip.StartInstant);
        Assert.Null(trip.EndInstant);
        Assert.Equal(0, trip.TotalDistanceM);
        Assert.Equal(0, trip.DriveCount);
        Assert.Equal(0, trip.ChargeCount);
    }

    [Fact]
    public void ParseList_accepts_numeric_string_id_and_values()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":"42","total_distance_m":"1000","drive_count":"2","charge_count":"1","start_date":"2026-06-06T09:00:00Z"}]""");

        var trip = Assert.Single(TripSummaryTrip.ParseList(doc.RootElement));

        Assert.Equal(42, trip.Id);
        Assert.Equal(1000, trip.TotalDistanceM);
        Assert.Equal(2, trip.DriveCount);
        Assert.Equal(1, trip.ChargeCount);
        Assert.NotNull(trip.StartInstant);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(TripSummaryTrip.ParseList(doc.RootElement));
    }

    // ---- Footprint flag (web isCompact) --------------------------------------------

    [Theory]
    [InlineData(2, 4, false)]  // default: not compact
    [InlineData(1, 2, true)]   // min: 1 col -> compact
    [InlineData(1, 4, true)]   // 1 col -> compact
    [InlineData(4, 40, false)] // max -> not compact
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new TripSummarySize(cols, rows).IsCompact);

    // ---- Duration range formatting (port of formatDurationRange) -------------------

    [Theory]
    [InlineData("2026-06-06T09:00:00Z", "2026-06-06T10:05:00Z", "1h 5m")]   // 65 min
    [InlineData("2026-06-06T09:00:00Z", "2026-06-06T09:45:00Z", "45m")]     // 45 min
    [InlineData("2026-06-06T09:00:00Z", "2026-06-06T11:00:00Z", "2h 0m")]   // 120 min
    [InlineData("2026-06-06T09:00:00Z", "2026-06-06T09:00:20Z", "0m")]      // sub-minute span -> rounds to 0m (no subMinuteLabel)
    public void FormatDurationRange_matches_web(string start, string end, string expected) =>
        Assert.Equal(expected, TripSummaryProjection.FormatDurationRange(Parse(start), Parse(end)));

    [Fact]
    public void FormatDurationRange_missing_endpoint_is_em_dash()
    {
        Assert.Equal("\u2014", TripSummaryProjection.FormatDurationRange(null, Parse("2026-06-06T10:00:00Z")));
        Assert.Equal("\u2014", TripSummaryProjection.FormatDurationRange(Parse("2026-06-06T10:00:00Z"), null));
    }

    [Fact]
    public void FormatDurationRange_non_positive_span_is_em_dash()
    {
        // end <= start (web ms <= 0).
        Assert.Equal("\u2014", TripSummaryProjection.FormatDurationRange(Parse("2026-06-06T10:00:00Z"), Parse("2026-06-06T10:00:00Z")));
        Assert.Equal("\u2014", TripSummaryProjection.FormatDurationRange(Parse("2026-06-06T10:00:00Z"), Parse("2026-06-06T09:00:00Z")));
    }

    // ---- Distance formatting (port of fmtNumber(convertDistanceFromSI)) ------------

    [Fact]
    public void FormatDistance_metric_uses_km()
    {
        var display = Project(UnitPref.Metric, TripSummarySize.Default, Trip(distanceM: 12_340));
        Assert.Equal("12.3 km", display.Featured!.Stats[0].Value);
    }

    [Fact]
    public void FormatDistance_imperial_uses_miles()
    {
        var display = Project(UnitPref.Imperial, TripSummarySize.Default, Trip(distanceM: 1609.344));
        Assert.Equal("1.0 mi", display.Featured!.Stats[0].Value);
    }

    // ---- Projection: featured card -------------------------------------------------

    [Fact]
    public void Project_featured_carries_badge_date_name_and_four_stats()
    {
        var featured = Project(UnitPref.Metric, TripSummarySize.Default, Trip()).Featured;

        Assert.NotNull(featured);
        Assert.Equal("Last Trip", featured!.BadgeLabel);
        Assert.Equal("Morning Commute", featured.Name);
        // formatDateShort renders the local "MMM d"; assert the month so the test stays timezone-independent.
        Assert.StartsWith("Jun ", featured.DateText, StringComparison.Ordinal);

        Assert.Equal(4, featured.Stats.Count);
        Assert.Equal("Distance", featured.Stats[0].Label);
        Assert.Equal("12.3 km", featured.Stats[0].Value);
        Assert.Equal("Duration", featured.Stats[1].Label);
        Assert.Equal("1h 5m", featured.Stats[1].Value);
        Assert.Equal("Drives", featured.Stats[2].Label);
        Assert.Equal("3", featured.Stats[2].Value);
        Assert.Equal("Charge Stops", featured.Stats[3].Label);
        Assert.Equal("1", featured.Stats[3].Value);
    }

    [Fact]
    public void Project_featured_uses_unnamed_fallback_for_blank_name()
    {
        var featured = Project(UnitPref.Metric, TripSummarySize.Default, Trip(name: null)).Featured;
        Assert.Equal("Unnamed trip", featured!.Name);

        var blank = Project(UnitPref.Metric, TripSummarySize.Default, Trip(name: "   ")).Featured;
        Assert.Equal("Unnamed trip", blank!.Name);
    }

    [Fact]
    public void Project_featured_duration_is_em_dash_when_end_missing()
    {
        var featured = Project(UnitPref.Metric, TripSummarySize.Default, Trip(end: null)).Featured;
        Assert.Equal("\u2014", featured!.Stats[1].Value);
    }

    [Fact]
    public void Project_featured_has_accessibility_name_with_badge_distance_and_stats()
    {
        var featured = Project(UnitPref.Metric, TripSummarySize.Default, Trip()).Featured;

        Assert.False(string.IsNullOrWhiteSpace(featured!.AutomationName));
        Assert.Contains("Last Trip", featured.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Morning Commute", featured.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Distance: 12.3 km", featured.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charge Stops: 1", featured.AutomationName, StringComparison.Ordinal);
    }

    // ---- Projection: recent-trip rows ----------------------------------------------

    [Fact]
    public void Project_recent_rows_are_trips_one_and_two()
    {
        var display = Project(
            UnitPref.Metric,
            TripSummarySize.Default,
            Trip(id: 1, name: "First"),
            Trip(id: 2, name: "Second", distanceM: 8_000, driveCount: 2),
            Trip(id: 3, name: "Third"),
            Trip(id: 4, name: "Fourth"));

        // web: recentTrips = trips.slice(0,3); list = recentTrips.slice(1) -> trips[1], trips[2].
        Assert.Equal(2, display.RecentRows.Count);
        Assert.Equal(2, display.RecentRows[0].Id);
        Assert.Equal(3, display.RecentRows[1].Id);

        var row = display.RecentRows[0];
        Assert.Equal("Second", row.Name);
        Assert.Equal("8.0 km", row.DistanceText);
        Assert.Equal("2 drv", row.DrivesBadgeText);
    }

    [Fact]
    public void Project_single_trip_has_featured_but_no_recent_rows()
    {
        var display = Project(UnitPref.Metric, TripSummarySize.Default, Trip(id: 1));

        Assert.True(display.HasData);
        Assert.NotNull(display.Featured);
        Assert.Empty(display.RecentRows);
    }

    [Fact]
    public void Project_recent_row_has_accessibility_name_with_name_distance_and_drives()
    {
        var display = Project(
            UnitPref.Metric, TripSummarySize.Default, Trip(id: 1), Trip(id: 2, name: "Evening Drive", distanceM: 8_000, driveCount: 2));

        var row = Assert.Single(display.RecentRows);
        Assert.Contains("Evening Drive", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("8.0 km", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("2 drv", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_has_no_data_and_no_featured()
    {
        var display = TripSummaryProjection.Project(
            Array.Empty<TripSummaryTrip>(), TripSummarySize.Default, UnitPref.Metric, Localizer, Now);

        Assert.False(display.HasData);
        Assert.Null(display.Featured);
        Assert.Empty(display.RecentRows);
    }

    [Fact]
    public void Project_compact_flag_flows_into_display()
    {
        var compact = Project(UnitPref.Metric, new TripSummarySize(1, 4), Trip());
        Assert.True(compact.IsCompact);

        var standard = Project(UnitPref.Metric, TripSummarySize.Default, Trip());
        Assert.False(standard.IsCompact);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"total_distance_m":1000,"drive_count":2}]""");

        var cached = TripSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = TripSummaryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(1, offline.Value![0].Id);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var rows = JsonDocument.Parse("""[{"id":1,"total_distance_m":1000}]""");

        Assert.Equal(LoadStatus.Loaded, TripSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(rows.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, TripSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TripSummaryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Loading, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_featured_and_rows()
    {
        using var vm = NewViewModel(Loaded(Trip(id: 1), Trip(id: 2), Trip(id: 3)));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.NotNull(vm.Display.Featured);
        Assert.Equal(2, vm.Display.RecentRows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No trips recorded yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_empty_list_collapses_to_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loaded(Array.Empty<TripSummaryTrip>(), Now));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Empty, vm.State);
        Assert.False(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_failure_flips_error_chip_without_replacing_body()
    {
        // Web parity: an error surfaces via the freshness "Error" chip + refresh, never a body swap.
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);   // body shows the empty state, not a separate error surface
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Cached(new[] { Trip(id: 1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(vm.IsError);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripSummaryTrip>>.OfflineCached(
            new[] { Trip(id: 1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loading(),
            RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Cached(new[] { Trip(id: 1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loaded(new[] { Trip(id: 1), Trip(id: 2) }, Now));
        await vm.LoadAsync();

        Assert.Equal(TripSummaryState.Loaded, vm.State);
        Assert.NotNull(vm.Display.Featured);
        Assert.Single(vm.Display.RecentRows);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(Loaded(Trip()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new TripSummarySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(TripSummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Trip(distanceM: 1609.344)));
        await vm.LoadAsync();
        Assert.Equal("1.6 km", vm.Display.Featured!.Stats[0].Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("1.0 mi", vm.Display.Featured!.Stats[0].Value);
        Assert.Equal(TripSummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_recent_label_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Trip Summary", vm.Title);
        Assert.Equal("No trips recorded yet", vm.EmptyMessage);
        Assert.Equal("Recent Trips", vm.RecentTripsLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Trip(id: 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TripSummaryViewModel.State), changed);
        Assert.Contains(nameof(TripSummaryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("trip-summary", TripSummaryRegistration.Id);
        Assert.Equal("driving", TripSummaryRegistration.Category);
        Assert.Equal("TripSummaryWidget", TripSummaryRegistration.Slug);
        Assert.Equal(new TripSummarySize(2, 4), TripSummaryRegistration.DefaultSize);
        Assert.Equal(new TripSummarySize(1, 2), TripSummaryRegistration.MinSize);
        Assert.Equal(new TripSummarySize(4, 40), TripSummaryRegistration.MaxSize);
        Assert.Equal("Trip Summary", TripSummaryRegistration.Name(Localizer));
        Assert.Contains("trips", TripSummaryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_matches_the_registration() =>
        Assert.Equal("trip-summary", TripSummaryRegistration.Id);

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, TripSummaryRegistration.IsWithinBounds(new TripSummarySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new TripSummarySize(1, 2), TripSummaryRegistration.Clamp(new TripSummarySize(0, 0)));
        Assert.Equal(new TripSummarySize(4, 40), TripSummaryRegistration.Clamp(new TripSummarySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TripSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TripSummaryWidget", Assert.Single(lines));
    }

    // ---- Source (fleet-wide adapter) -----------------------------------------------

    [Fact]
    public async Task Source_reads_trips_with_limit_query()
    {
        using var trips = JsonDocument.Parse(
            """[{"id":1,"name":"A","total_distance_m":1000,"drive_count":1,"start_date":"2026-06-06T09:00:00Z","end_date":"2026-06-06T09:30:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(trips.RootElement);
        var source = new TripSummarySource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(1, Assert.Single(terminal.Value!).Id);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_trips", request.OperationId);
        Assert.Equal(5, Assert.IsType<int>(request.Query!["limit"]));
    }

    [Fact]
    public async Task Source_empty_array_collapses_to_empty()
    {
        using var empty = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(empty.RootElement);
        var source = new TripSummarySource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TripSummaryDisplay Project(UnitPref units, TripSummarySize size, params TripSummaryTrip[] trips) =>
        TripSummaryProjection.Project(trips, size, units, Localizer, Now);

    private static RepositoryResult<IReadOnlyList<TripSummaryTrip>> Loaded(params TripSummaryTrip[] trips) =>
        RepositoryResult<IReadOnlyList<TripSummaryTrip>>.Loaded(trips, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<TripSummaryTrip>>>> Drain(ITripSummarySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TripSummaryTrip>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static TripSummaryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<TripSummaryTrip>>[] emissions) =>
        new(new FakeTripSummarySource(emissions), Localizer, TripSummarySize.Default, UnitPref.Metric, () => Now);

    private sealed class FakeTripSummarySource(params RepositoryResult<IReadOnlyList<TripSummaryTrip>>[] emissions)
        : ITripSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripSummaryTrip>>> StreamAsync(
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
