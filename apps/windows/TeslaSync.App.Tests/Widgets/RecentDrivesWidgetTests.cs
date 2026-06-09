using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the RecentDrivesWidget's UI-thread-free logic — the drive-list parse adapter
/// (distance_m / duration_s / start_soc_pct↔start_battery_pct / start_ts), the five-row window, the
/// SI→display distance conversion, the duration + start→end SoC detail line, the short start date, the
/// per-drive drill-through route, the cache-then-network result mapper, the per-vehicle data source
/// (primary resolution + vehicle_id-scoped request with no limit param + contract id), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline + units reprojection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/RecentDrivesWidget.tsx + registry/driving.ts).
/// </summary>
public sealed class RecentDrivesWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // A local-kind Apr 4 noon so the absolute short-date render is "Apr 4" regardless of the runner's tz.
    private static readonly DateTimeOffset AprFourthLocalNoon = new(new DateTime(2026, 4, 4, 12, 0, 0, DateTimeKind.Local));

    private static RecentDrivesDrive Drive(
        long id,
        double distanceM = 16093.44,
        long durationS = 1200,
        long? startSoc = 80,
        long? endSoc = 60,
        DateTimeOffset? startTs = null) =>
        new(id, distanceM, durationS, startSoc, endSoc, startTs ?? AprFourthLocalNoon);

    private static IReadOnlyList<RecentDrivesRow> Project(IReadOnlyList<RecentDrivesDrive> drives, UnitPref? units = null) =>
        RecentDrivesProjection.Project(drives, units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":12,"vehicle_id":7,"distance_m":16093.44,"duration_s":1200,
          "start_battery_pct":80,"end_battery_pct":60,"start_ts":"2026-04-04T15:30:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var drive = Assert.Single(RecentDrivesDrive.ParseList(doc.RootElement));

        Assert.Equal(12, drive.Id);
        Assert.Equal(16093.44, drive.DistanceM);
        Assert.Equal(1200, drive.DurationS);
        Assert.Equal(80, drive.StartSocPct);
        Assert.Equal(60, drive.EndSocPct);
        Assert.NotNull(drive.StartTs);
    }

    [Fact]
    public void ParseList_prefers_soc_pct_over_battery_pct_when_both_present()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"start_soc_pct":91,"start_battery_pct":12,"end_soc_pct":55,"end_battery_pct":99}]""");

        var drive = Assert.Single(RecentDrivesDrive.ParseList(doc.RootElement));

        Assert.Equal(91, drive.StartSocPct); // web Drive type key wins
        Assert.Equal(55, drive.EndSocPct);
    }

    [Fact]
    public void ParseList_falls_back_to_battery_pct_when_soc_pct_absent()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"start_battery_pct":42,"end_battery_pct":17}]""");

        var drive = Assert.Single(RecentDrivesDrive.ParseList(doc.RootElement));

        Assert.Equal(42, drive.StartSocPct); // live wire key
        Assert.Equal(17, drive.EndSocPct);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var drive = Assert.Single(RecentDrivesDrive.ParseList(doc.RootElement));

        Assert.Equal(2, drive.Id);
        Assert.Equal(0, drive.DistanceM);
        Assert.Equal(0, drive.DurationS);
        Assert.Null(drive.StartSocPct);
        Assert.Null(drive.EndSocPct);
        Assert.Null(drive.StartTs);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(RecentDrivesDrive.ParseList(doc.RootElement));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_keeps_only_the_first_five_drives_in_order()
    {
        var drives = new List<RecentDrivesDrive>();
        for (int i = 0; i < 7; i++)
        {
            drives.Add(Drive(i));
        }

        var rows = Project(drives);

        Assert.Equal(RecentDrivesProjection.WindowLimit, rows.Count); // 5
        Assert.Equal(0, rows[0].DriveId);   // newest-first order preserved
        Assert.Equal(4, rows[^1].DriveId);
    }

    [Fact]
    public void Project_metric_distance_text_uses_km_at_one_decimal()
    {
        var row = Assert.Single(Project(new[] { Drive(1, distanceM: 16093.44) }));
        Assert.Equal("16.1 km", row.DistanceText);
    }

    [Fact]
    public void Project_imperial_distance_text_converts_to_miles()
    {
        var row = Assert.Single(Project(new[] { Drive(1, distanceM: 16093.44) }, UnitPref.Imperial));
        Assert.Equal("10.0 mi", row.DistanceText); // 16093.44 m = 10 mi exactly
    }

    [Fact]
    public void Project_detail_line_shows_minutes_and_start_end_soc()
    {
        var row = Assert.Single(Project(new[] { Drive(1, durationS: 1200, startSoc: 80, endSoc: 60) }));
        Assert.Equal("20 min \u00B7 80% \u2192 60%", row.DetailText);
    }

    [Fact]
    public void Project_unknown_soc_renders_question_mark()
    {
        var row = Assert.Single(Project(new[] { Drive(1, durationS: 600, startSoc: null, endSoc: null) }));
        Assert.Equal("10 min \u00B7 ?% \u2192 ?%", row.DetailText);
    }

    [Fact]
    public void Project_date_is_short_month_day()
    {
        var row = Assert.Single(Project(new[] { Drive(1, startTs: AprFourthLocalNoon) }));
        Assert.Equal("Apr 4", row.DateText);
    }

    [Fact]
    public void Project_null_date_renders_em_dash()
    {
        var noDate = new RecentDrivesDrive(1, 16093.44, 1200, 80, 60, StartTs: null);
        var row = Assert.Single(Project(new[] { noDate }));
        Assert.Equal("\u2014", row.DateText);
    }

    [Fact]
    public void Project_row_target_is_the_drive_drillthrough_route()
    {
        var row = Assert.Single(Project(new[] { Drive(123) }));
        Assert.Equal("drives/123", row.Target);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = Assert.Single(Project(new[] { Drive(1, distanceM: 16093.44, durationS: 1200, startSoc: 80, endSoc: 60) }));

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("16.1 km", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("20 min", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Apr 4", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_list_returns_no_rows()
    {
        Assert.Empty(Project(Array.Empty<RecentDrivesDrive>()));
    }

    [Fact]
    public void Project_list_route_matches_web()
    {
        Assert.Equal("drives", RecentDrivesProjection.ListRoute);
        Assert.Equal("drives/7", RecentDrivesProjection.DriveRoute(7));
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"distance_m":1000,"duration_s":600,"start_ts":"2026-04-04T12:00:00Z"}]""");

        var cached = RecentDrivesResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = RecentDrivesResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = RecentDrivesResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = RecentDrivesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Loading, vm.State);
        Assert.False(vm.HasRows);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Drive(1), Drive(2)));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Loaded, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal(2, vm.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Equal("No recent drives", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Cached(new[] { Drive(1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.OfflineCached(
            new[] { Drive(1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Offline, vm.State);
        Assert.True(vm.HasRows);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loading(),
            RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Cached(new[] { Drive(1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loaded(new[] { Drive(1), Drive(2) }, Now));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesState.Loaded, vm.State);
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Drive(1, distanceM: 16093.44)));
        await vm.LoadAsync();
        Assert.Equal("16.1 km", vm.Rows[0].DistanceText); // metric default

        vm.Units = UnitPref.Imperial;
        Assert.Equal("10.0 mi", vm.Rows[0].DistanceText); // reprojected
    }

    [Fact]
    public async Task ViewModel_size_change_raises_but_keeps_rows()
    {
        using var vm = NewViewModel(Loaded(Drive(1), Drive(2)));
        await vm.LoadAsync();
        var before = vm.Rows;

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.Size = new RecentDrivesSize(4, 8);

        Assert.Contains(nameof(RecentDrivesViewModel.Size), changed);
        Assert.Same(before, vm.Rows); // footprint does not re-project (web parity)
    }

    [Fact]
    public async Task ViewModel_title_viewall_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Recent Drives", vm.Title);
        Assert.Equal("View all", vm.ViewAllLabel);
        Assert.Equal("No recent drives", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_rows()
    {
        using var vm = NewViewModel(Loaded(Drive(1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RecentDrivesViewModel.State), changed);
        Assert.Contains(nameof(RecentDrivesViewModel.Rows), changed);
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new RecentDrivesSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_vehicle_id_only()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"distance_m":1000,"duration_s":600,"start_ts":"2026-06-05T12:00:00Z"},{"id":2,"distance_m":2000,"duration_s":1200,"start_ts":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RecentDrivesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives", request.OperationId);
        var query = Assert.Single(request.Query!);
        Assert.Equal("vehicle_id", query.Key); // the generated endpoint declares only vehicle_id (no limit)
        Assert.Equal(7L, Convert.ToInt64(query.Value, CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"distance_m":10,"duration_s":60,"start_ts":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RecentDrivesSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new RecentDrivesSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public void Source_operation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == "get_api_v1_drives");

        Assert.True(descriptor is not null, "Operation 'get_api_v1_drives' is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("recent-drives", RecentDrivesRegistration.Id);
        Assert.Equal("driving", RecentDrivesRegistration.Category);
        Assert.Equal("RecentDrivesWidget", RecentDrivesRegistration.Slug);
        Assert.Equal(new RecentDrivesSize(2, 4), RecentDrivesRegistration.DefaultSize);
        Assert.Equal(new RecentDrivesSize(2, 2), RecentDrivesRegistration.MinSize);
        Assert.Equal(new RecentDrivesSize(4, 40), RecentDrivesRegistration.MaxSize);
        Assert.Equal("Recent Drives", RecentDrivesRegistration.Name(Localizer));
        Assert.Equal("Last 5 drives with distance and efficiency", RecentDrivesRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(2, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, RecentDrivesRegistration.IsWithinBounds(new RecentDrivesSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new RecentDrivesSize(2, 2), RecentDrivesRegistration.Clamp(new RecentDrivesSize(1, 1)));
        Assert.Equal(new RecentDrivesSize(4, 40), RecentDrivesRegistration.Clamp(new RecentDrivesSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RecentDrivesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentDrivesWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<RecentDrivesDrive>>>> Drain(IRecentDrivesSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<RecentDrivesDrive>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<RecentDrivesDrive>> Loaded(params RecentDrivesDrive[] drives) =>
        RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loaded(drives, Now);

    private static RecentDrivesViewModel NewViewModel(params RepositoryResult<IReadOnlyList<RecentDrivesDrive>>[] emissions) =>
        new(new FakeRecentDrivesSource(emissions), Localizer, RecentDrivesSize.Default, UnitPref.Metric);

    private sealed class FakeRecentDrivesSource(params RepositoryResult<IReadOnlyList<RecentDrivesDrive>>[] emissions) : IRecentDrivesSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDrivesDrive>>> StreamAsync(
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
