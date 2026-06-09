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

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the RecentDrivesListWidget's UI-thread-free logic — the JSON parse adapter, the
/// footprint flags (isWide / isTall / driveLimit), the duration/address/SoC/battery-used formatting, the
/// projection (cap + order + per-row labels + navigation routes + a11y), the cache-then-network result
/// mapper, the registry metadata, the diagnostics, the per-vehicle source adapter (vehicle resolution +
/// query param + empty short-circuit), and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline + size/units re-projection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx).
/// </summary>
public sealed class RecentDrivesListWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static RecentDrive Drive(
        long id = 1,
        double distanceM = 12_340,
        double durationS = 3_900,
        double? startSoc = 85,
        double? endSoc = 72,
        string? startAddress = "123 Market St, San Francisco",
        string? endAddress = "1 Tesla Rd, Austin",
        string? startTs = "2026-06-06T09:00:00Z") =>
        new(id, distanceM, durationS, startSoc, endSoc, startAddress, endAddress, Parse(startTs));

    private static DateTimeOffset? Parse(string? iso) =>
        iso is null ? null : DateTimeOffset.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_array()
    {
        const string json = """
        [
          {"id":1,"vehicle_id":7,"distance_m":12340,"duration_s":3900,"start_soc_pct":85,"end_soc_pct":72,"start_address":"A St","end_address":"B St","start_ts":"2026-06-06T09:00:00Z"},
          {"id":2,"vehicle_id":7,"distance_m":500,"duration_s":40,"start_soc_pct":50,"end_soc_pct":48,"start_ts":"2026-06-06T08:00:00Z"}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = RecentDrive.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(12_340, list[0].DistanceM);
        Assert.Equal(3_900, list[0].DurationS);
        Assert.Equal(85, list[0].StartSocPct);
        Assert.Equal(72, list[0].EndSocPct);
        Assert.Equal("A St", list[0].StartAddress);
        Assert.Equal("B St", list[0].EndAddress);
        Assert.NotNull(list[0].StartInstant);
        Assert.Null(list[1].StartAddress);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":3}]""");

        var drive = Assert.Single(RecentDrive.ParseList(doc.RootElement));

        Assert.Equal(3, drive.Id);
        Assert.Equal(0, drive.DistanceM);
        Assert.Equal(0, drive.DurationS);
        Assert.Null(drive.StartSocPct);
        Assert.Null(drive.EndSocPct);
        Assert.Null(drive.StartAddress);
        Assert.Null(drive.StartInstant);
    }

    [Fact]
    public void ParseList_accepts_numeric_string_id_and_values()
    {
        using var doc = JsonDocument.Parse("""[{"id":"42","distance_m":"1000","duration_s":"600","start_ts":"2026-06-06T09:00:00Z"}]""");

        var drive = Assert.Single(RecentDrive.ParseList(doc.RootElement));

        Assert.Equal(42, drive.Id);
        Assert.Equal(1000, drive.DistanceM);
        Assert.Equal(600, drive.DurationS);
        Assert.NotNull(drive.StartInstant);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(RecentDrive.ParseList(doc.RootElement));
    }

    // ---- Footprint flags (web isWide / isTall / driveLimit) ------------------------

    [Theory]
    [InlineData(2, 4, false, true, 7)]   // default: tall, not wide -> 7
    [InlineData(1, 4, false, true, 7)]   // min: 1 col -> not wide -> 7
    [InlineData(3, 4, true, true, 10)]   // wide -> 10
    [InlineData(4, 40, true, true, 10)]  // max -> 10
    [InlineData(2, 1, false, false, 5)]  // not tall, not wide -> 5
    public void Size_flags_match_web(int cols, int rows, bool wide, bool tall, int limit)
    {
        var size = new RecentDrivesListSize(cols, rows);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(tall, size.IsTall);
        Assert.Equal(limit, size.DriveLimit);
    }

    // ---- Duration formatting (port of formatDurationMinutes) -----------------------

    [Theory]
    [InlineData(3_900, "1h 5m")]   // 65 min
    [InlineData(2_700, "45m")]     // 45 min
    [InlineData(7_200, "2h 0m")]   // 120 min
    [InlineData(30, "<1m")]        // 0.5 min -> sub-minute label
    [InlineData(0, "<1m")]         // 0 min -> sub-minute label
    public void FormatDurationMinutes_matches_web(double seconds, string expected) =>
        Assert.Equal(expected, RecentDrivesListProjection.FormatDurationMinutes(seconds));

    [Fact]
    public void FormatDurationMinutes_negative_is_em_dash() =>
        Assert.Equal("\u2014", RecentDrivesListProjection.FormatDurationMinutes(-60));

    // ---- Address truncation (port of truncateAddress) ------------------------------

    [Fact]
    public void TruncateAddress_null_or_empty_is_em_dash()
    {
        Assert.Equal("\u2014", RecentDrivesListProjection.TruncateAddress(null));
        Assert.Equal("\u2014", RecentDrivesListProjection.TruncateAddress(string.Empty));
    }

    [Fact]
    public void TruncateAddress_keeps_short_address_verbatim() =>
        Assert.Equal("1 Tesla Rd", RecentDrivesListProjection.TruncateAddress("1 Tesla Rd"));

    [Fact]
    public void TruncateAddress_truncates_long_address_with_ellipsis()
    {
        string thirtyOne = new('x', 31);
        string result = RecentDrivesListProjection.TruncateAddress(thirtyOne);
        Assert.Equal(new string('x', 30) + "\u2026", result);
        Assert.Equal(31, result.Length);
    }

    // ---- Projection: row labels ----------------------------------------------------

    [Fact]
    public void Project_row_carries_metric_distance_duration_battery_and_date()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive()).Items[0];

        Assert.Equal("12.3 km", row.DistanceText);
        Assert.Equal("1h 5m", row.DurationText);
        Assert.Equal("85% \u2192 72%", row.BatteryText);
        Assert.Equal("13%", row.BatteryUsedText);
        // formatDateShort renders the vehicle/local time ("MMM d") like the web — assert the month so the
        // test stays deterministic regardless of the runner's timezone (Jun 6 stays in June at any offset).
        Assert.StartsWith("Jun ", row.DateText, StringComparison.Ordinal);
        Assert.Equal("/drives/1", row.DetailRoute);
    }

    [Fact]
    public void Project_row_uses_imperial_distance_unit()
    {
        var row = Project(UnitPref.Imperial, RecentDrivesListSize.Default, Drive(distanceM: 1609.344)).Items[0];
        Assert.Equal("1.0 mi", row.DistanceText);
    }

    [Fact]
    public void Project_row_battery_uses_question_mark_when_soc_missing_and_hides_used()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive(endSoc: null)).Items[0];

        Assert.Equal("85% \u2192 ?%", row.BatteryText);
        Assert.Null(row.BatteryUsedText);
    }

    [Fact]
    public void Project_row_hides_battery_used_when_distance_is_zero()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive(distanceM: 0)).Items[0];
        Assert.Null(row.BatteryUsedText);
    }

    [Fact]
    public void Project_row_date_is_em_dash_when_start_missing()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive(startTs: null)).Items[0];
        Assert.Equal("\u2014", row.DateText);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name_with_distance_and_date()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive()).Items[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("12.3 km", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Jun", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Projection: wide layout + addresses ---------------------------------------

    [Fact]
    public void Project_wide_includes_addresses_in_accessibility_name()
    {
        var display = Project(UnitPref.Metric, new RecentDrivesListSize(3, 4), Drive());

        Assert.True(display.IsWide);
        Assert.Contains("123 Market St, San Francisco", display.Items[0].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_narrow_excludes_addresses_from_accessibility_name()
    {
        var display = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive());

        Assert.False(display.IsWide);
        Assert.DoesNotContain("123 Market St", display.Items[0].AutomationName, StringComparison.Ordinal);
        // The truncated addresses are still carried on the row for the view to render when it grows wide.
        Assert.Equal("123 Market St, San Francisco", display.Items[0].StartAddress);
    }

    // ---- Projection: cap + order + empty -------------------------------------------

    [Fact]
    public void Project_caps_to_drive_limit_and_preserves_order()
    {
        var drives = new List<RecentDrive>();
        for (int i = 0; i < 12; i++)
        {
            drives.Add(Drive(id: i));
        }

        // Wide -> 10, default tall -> 7.
        Assert.Equal(10, RecentDrivesListProjection.Project(drives, new RecentDrivesListSize(4, 40), UnitPref.Metric, Now).Items.Count);

        var narrow = RecentDrivesListProjection.Project(drives, RecentDrivesListSize.Default, UnitPref.Metric, Now);
        Assert.Equal(7, narrow.Items.Count);
        Assert.Equal(0, narrow.Items[0].Id);   // server order preserved
        Assert.Equal(6, narrow.Items[^1].Id);
    }

    [Fact]
    public void Project_empty_has_no_data_and_view_all_route()
    {
        var display = RecentDrivesListProjection.Project(
            Array.Empty<RecentDrive>(), RecentDrivesListSize.Default, UnitPref.Metric, Now);

        Assert.False(display.HasData);
        Assert.Empty(display.Items);
        Assert.Equal("/drives", display.ViewAllRoute);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"distance_m":1000,"duration_s":600}]""");

        var cached = RecentDrivesListResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = RecentDrivesListResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(1, offline.Value![0].Id);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var rows = JsonDocument.Parse("""[{"id":1,"distance_m":1000}]""");

        Assert.Equal(LoadStatus.Loaded, RecentDrivesListResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(rows.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, RecentDrivesListResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, RecentDrivesListResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrive>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Loading, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Drive(id: 1), Drive(id: 2)));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No recent drives recorded", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_empty_list_collapses_to_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrive>>.Loaded(Array.Empty<RecentDrive>(), Now));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Empty, vm.State);
        Assert.False(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_failure_flips_error_chip_without_replacing_body()
    {
        // Web parity: an error surfaces via the freshness "Error" chip + refresh, never a body swap.
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrive>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);   // body shows the empty state, not a separate error surface
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrive>>.Cached(new[] { Drive(id: 1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(vm.IsError);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrive>>.OfflineCached(
            new[] { Drive(id: 1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDrive>>.Loading(),
            RepositoryResult<IReadOnlyList<RecentDrive>>.Cached(new[] { Drive(id: 1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<RecentDrive>>.Loaded(new[] { Drive(id: 1), Drive(id: 2) }, Now));
        await vm.LoadAsync();

        Assert.Equal(RecentDrivesListState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_cap_and_wide()
    {
        var drives = new List<RecentDrive>();
        for (int i = 0; i < 8; i++)
        {
            drives.Add(Drive(id: i));
        }

        using var vm = NewViewModel(new RecentDrivesListSize(4, 40), RepositoryResult<IReadOnlyList<RecentDrive>>.Loaded(drives, Now));
        await vm.LoadAsync();
        Assert.True(vm.Display.IsWide);
        Assert.Equal(8, vm.Display.Items.Count);   // wide cap 10

        vm.Size = RecentDrivesListSize.Default;     // 2x4 -> tall cap 7, not wide
        Assert.False(vm.Display.IsWide);
        Assert.Equal(7, vm.Display.Items.Count);
        Assert.Equal(RecentDrivesListState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Drive(distanceM: 1609.344)));
        await vm.LoadAsync();
        Assert.Equal("1.6 km", vm.Display.Items[0].DistanceText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("1.0 mi", vm.Display.Items[0].DistanceText);
        Assert.Equal(RecentDrivesListState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_view_all_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDrive>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Recent Drives", vm.Title);
        Assert.Equal("No recent drives recorded", vm.EmptyMessage);
        Assert.Equal("View all", vm.ViewAllLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Drive(id: 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RecentDrivesListViewModel.State), changed);
        Assert.Contains(nameof(RecentDrivesListViewModel.Display), changed);
    }

    // ---- Navigation routes (web Link targets) --------------------------------------

    [Fact]
    public void Row_detail_route_targets_the_drive()
    {
        var row = Project(UnitPref.Metric, RecentDrivesListSize.Default, Drive(id: 99)).Items[0];
        Assert.Equal("/drives/99", row.DetailRoute);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("recent-drives-list", RecentDrivesListRegistration.Id);
        Assert.Equal("driving", RecentDrivesListRegistration.Category);
        Assert.Equal("RecentDrivesListWidget", RecentDrivesListRegistration.Slug);
        Assert.Equal(new RecentDrivesListSize(2, 4), RecentDrivesListRegistration.DefaultSize);
        Assert.Equal(new RecentDrivesListSize(1, 4), RecentDrivesListRegistration.MinSize);
        Assert.Equal(new RecentDrivesListSize(4, 40), RecentDrivesListRegistration.MaxSize);
        Assert.Equal("Recent Drives", RecentDrivesListRegistration.Name(Localizer));
        Assert.Contains("distance", RecentDrivesListRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_matches_the_registration() =>
        Assert.Equal("recent-drives-list", RecentDrivesListRegistration.Id);

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 4, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 3, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, RecentDrivesListRegistration.IsWithinBounds(new RecentDrivesListSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new RecentDrivesListSize(1, 4), RecentDrivesListRegistration.Clamp(new RecentDrivesListSize(0, 0)));
        Assert.Equal(new RecentDrivesListSize(4, 40), RecentDrivesListRegistration.Clamp(new RecentDrivesListSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RecentDrivesListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentDrivesListWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new RecentDrivesListSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_drives_scoped_by_vehicle()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":1,"vehicle_id":7,"distance_m":1000,"duration_s":600,"start_ts":"2026-06-06T09:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement);
        var source = new RecentDrivesListSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(1, Assert.Single(terminal.Value!).Id);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse("""[{"id":1,"distance_m":1000,"start_ts":"2026-06-06T09:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement);
        var source = new RecentDrivesListSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(Assert.Single(api.Requests).Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_collapses_to_empty()
    {
        using var empty = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(empty.RootElement);
        var source = new RecentDrivesListSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RecentDrivesListDisplay Project(UnitPref units, RecentDrivesListSize size, params RecentDrive[] drives) =>
        RecentDrivesListProjection.Project(drives, size, units, Now);

    private static RepositoryResult<IReadOnlyList<RecentDrive>> Loaded(params RecentDrive[] drives) =>
        RepositoryResult<IReadOnlyList<RecentDrive>>.Loaded(drives, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<RecentDrive>>>> Drain(IRecentDrivesListSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<RecentDrive>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RecentDrivesListViewModel NewViewModel(params RepositoryResult<IReadOnlyList<RecentDrive>>[] emissions) =>
        NewViewModel(RecentDrivesListSize.Default, emissions);

    private static RecentDrivesListViewModel NewViewModel(
        RecentDrivesListSize size,
        params RepositoryResult<IReadOnlyList<RecentDrive>>[] emissions) =>
        new(new FakeRecentDrivesListSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeRecentDrivesListSource(params RepositoryResult<IReadOnlyList<RecentDrive>>[] emissions)
        : IRecentDrivesListSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDrive>>> StreamAsync(
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
