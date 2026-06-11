using System.Globalization;
using System.Linq;
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
/// Headless verification of the Recent-Drives section's UI-thread-free logic — the drive-list JSON parse
/// adapter (id / start_ts / distance_m / duration_s / start_soc_pct / end_soc_pct), the four column
/// projections (Date via the locale-aware time formatter, Distance via SI→display conversion with the unit
/// label, Duration via the web <c>durationStr</c> port, Battery via the <c>start% → end%</c> / em-dash gate),
/// the numeric Distance sort, the pagination, the cache-then-network result mapper, the vehicle-resolving
/// drive-list source, the registry metadata, the PII-safe diagnostics, the Narrator automation names and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline + sort,
/// page and unit re-projection). Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx).
/// </summary>
public sealed class RecentDrivesSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string ThreeDriveTrace =
        """
        [
          {"id":1,"start_ts":"2026-04-01T10:00:00Z","distance_m":12000,"duration_s":3900,"start_soc_pct":80,"end_soc_pct":62},
          {"id":2,"start_ts":"2026-04-02T10:00:00Z","distance_m":30000,"duration_s":7320,"start_soc_pct":90,"end_soc_pct":55},
          {"id":3,"start_ts":"2026-04-03T10:00:00Z","distance_m":5000,"duration_s":90,"start_soc_pct":70,"end_soc_pct":68}
        ]
        """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_every_field()
    {
        using var doc = JsonDocument.Parse(
            """{"id":42,"start_ts":"2026-04-04T10:00:00Z","distance_m":12345,"duration_s":3600,"start_soc_pct":88,"end_soc_pct":61}""");

        var s = RecentDriveSample.FromJson(doc.RootElement);

        Assert.Equal(42, s.Id);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), s.StartTs);
        Assert.Equal(12345, s.DistanceM);
        Assert.Equal(3600, s.DurationS);
        Assert.Equal(88, s.StartSocPct);
        Assert.Equal(61, s.EndSocPct);
    }

    [Fact]
    public void FromJson_tolerates_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var s = RecentDriveSample.FromJson(doc.RootElement);

        Assert.Equal(7, s.Id);
        Assert.Null(s.StartTs);
        Assert.Null(s.DistanceM);
        Assert.Null(s.DurationS);
        Assert.Null(s.StartSocPct);
        Assert.Null(s.EndSocPct);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"id":1}, 7, {"id":2}]""");

        var list = RecentDriveSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(RecentDriveSample.ParseList(doc.RootElement));
    }

    // ---- Projection: column renderers ----------------------------------------------

    [Fact]
    public void ProjectRow_formats_the_four_cells_in_metric()
    {
        var sample = Single(ThreeDriveTrace, 0);
        var row = RecentDrivesSectionProjection.ProjectRow(sample, UnitPref.Metric);

        Assert.Equal(DateTimeFormatting.Format(sample.StartTs, DateTimeVariant.Full, DateTimeOffset.Now), row.DateText);
        Assert.NotEqual("\u2014", row.DateText);
        Assert.Equal("12.0 km", row.DistanceText);
        Assert.Equal(12000, row.DistanceMeters);
        Assert.Equal("1h 5m", row.DurationText);                  // 3900 s → 65 min → 1h 5m
        Assert.Equal("80% \u2192 62%", row.BatteryText);
    }

    [Fact]
    public void ProjectRow_duration_drops_the_hour_below_sixty_minutes()
    {
        var row = RecentDrivesSectionProjection.ProjectRow(Single(ThreeDriveTrace, 2), UnitPref.Metric);
        Assert.Equal("2m", row.DurationText);                     // 90 s → 1.5 min → fmtInt rounds to 2m
    }

    [Fact]
    public void ProjectRow_distance_defaults_missing_to_zero_never_dash()
    {
        var sample = new RecentDriveSample(9, Now, DistanceM: null, DurationS: 0, StartSocPct: null, EndSocPct: null);
        var row = RecentDrivesSectionProjection.ProjectRow(sample, UnitPref.Metric);

        Assert.Equal("0.0 km", row.DistanceText);                 // web `distance_m ?? 0`
        Assert.Equal(0, row.DistanceMeters);
    }

    [Fact]
    public void ProjectRow_battery_is_dash_when_either_soc_is_missing()
    {
        var noEnd = new RecentDriveSample(1, Now, 1000, 600, StartSocPct: 80, EndSocPct: null);
        var noStart = new RecentDriveSample(2, Now, 1000, 600, StartSocPct: null, EndSocPct: 60);

        Assert.Equal("\u2014", RecentDrivesSectionProjection.ProjectRow(noEnd, UnitPref.Metric).BatteryText);
        Assert.Equal("\u2014", RecentDrivesSectionProjection.ProjectRow(noStart, UnitPref.Metric).BatteryText);
    }

    [Fact]
    public void ProjectRow_distance_uses_imperial_unit()
    {
        var sample = Single(ThreeDriveTrace, 0);
        var row = RecentDrivesSectionProjection.ProjectRow(sample, UnitPref.Imperial);
        Assert.EndsWith("mi", row.DistanceText);
        Assert.DoesNotContain("km", row.DistanceText);
    }

    // ---- Projection: chrome + i18n -------------------------------------------------

    [Fact]
    public void Project_exposes_localized_chrome()
    {
        var display = Project(ThreeDriveTrace, UnitPref.Metric);

        Assert.True(display.HasData);
        Assert.Equal(3, display.DriveCount);
        Assert.Equal("Recent Drives", display.Title);
        Assert.Equal("View all", display.ViewAllLabel);
        Assert.Equal("No drives recorded yet", display.EmptyMessage);
        Assert.Equal("Date", display.DateHeader);
        Assert.Equal("Distance", display.DistanceHeader);
        Assert.Equal("Duration", display.DurationHeader);
        Assert.Equal("Battery", display.BatteryHeader);
    }

    [Fact]
    public void Project_empty_reports_no_data()
    {
        var display = RecentDrivesSectionProjection.Empty(UnitPref.Metric, Localizer);

        Assert.False(display.HasData);
        Assert.Equal(0, display.DriveCount);
        Assert.Empty(display.Rows);
        Assert.False(display.ShowPagination);
        Assert.Equal("No drives recorded yet", display.EmptyMessage);
    }

    // ---- Projection: Distance sort -------------------------------------------------

    [Fact]
    public void Project_unsorted_preserves_source_order()
    {
        var display = Project(ThreeDriveTrace, UnitPref.Metric);
        Assert.Equal(new long[] { 1, 2, 3 }, display.Rows.Select(r => r.Id).ToArray());
        Assert.Equal(SortDirection.None, display.DistanceSortDirection);
    }

    [Fact]
    public void Project_distance_sort_ascending_orders_by_meters()
    {
        var sort = new TableSortState();
        sort.Toggle(RecentDrivesSectionProjection.DistanceColumnKey); // ascending

        var display = RecentDrivesSectionProjection.Project(ParseDrives(ThreeDriveTrace), UnitPref.Metric, Localizer, sort, 1, 10);

        Assert.Equal(SortDirection.Ascending, display.DistanceSortDirection);
        Assert.Equal(new double[] { 5000, 12000, 30000 }, display.Rows.Select(r => r.DistanceMeters).ToArray());
    }

    [Fact]
    public void Project_distance_sort_descending_orders_by_meters()
    {
        var sort = new TableSortState();
        sort.Toggle(RecentDrivesSectionProjection.DistanceColumnKey); // ascending
        sort.Toggle(RecentDrivesSectionProjection.DistanceColumnKey); // descending

        var display = RecentDrivesSectionProjection.Project(ParseDrives(ThreeDriveTrace), UnitPref.Metric, Localizer, sort, 1, 10);

        Assert.Equal(SortDirection.Descending, display.DistanceSortDirection);
        Assert.Equal(new double[] { 30000, 12000, 5000 }, display.Rows.Select(r => r.DistanceMeters).ToArray());
    }

    // ---- Projection: pagination ----------------------------------------------------

    [Fact]
    public void Project_paginates_to_the_requested_page()
    {
        var many = Enumerable.Range(0, 25)
            .Select(i => new RecentDriveSample(
                i, new DateTimeOffset(2026, 4, 1, 0, 0, 0, TimeSpan.Zero).AddDays(i), 1000.0 * (i + 1), 600, 90, 80))
            .ToList();

        var display = RecentDrivesSectionProjection.Project(many, UnitPref.Metric, Localizer, new TableSortState(), 2, 10);

        Assert.True(display.ShowPagination);
        Assert.Equal(25, display.TotalCount);
        Assert.Equal(2, display.Page);
        Assert.Equal(3, display.PageCount);
        Assert.Equal(10, display.Rows.Count);
        Assert.Equal(11, display.RangeStart);
        Assert.Equal(20, display.RangeEnd);
    }

    [Fact]
    public void Project_does_not_paginate_a_short_list()
    {
        var display = Project(ThreeDriveTrace, UnitPref.Metric);
        Assert.False(display.ShowPagination);
        Assert.Equal(3, display.Rows.Count);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_emits_narrator_name_for_every_row()
    {
        var display = Project(ThreeDriveTrace, UnitPref.Metric);

        Assert.All(display.Rows, r =>
        {
            Assert.False(string.IsNullOrWhiteSpace(r.AutomationName));
            Assert.Contains(r.DistanceText, r.AutomationName);
            Assert.Contains(r.BatteryText, r.AutomationName);
        });
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(ThreeDriveTrace);
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = RecentDrivesSectionResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(3, mapped.Value!.Count);
    }

    [Fact]
    public void Mapper_cached_payload_projects_into_rows()
    {
        using var doc = JsonDocument.Parse(ThreeDriveTrace);
        var mapped = RecentDrivesSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: false));

        var display = RecentDrivesSectionProjection.Project(
            mapped.Value!, UnitPref.Metric, Localizer, new TableSortState(), 1, 10);

        Assert.Equal(3, display.DriveCount);
        Assert.Equal("12.0 km", display.Rows[0].DistanceText);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, RecentDrivesSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, RecentDrivesSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = RecentDrivesSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new RecentDrivesSectionViewModel(new FakeSource(), Localizer, UnitPref.Metric);
        Assert.Equal(RecentDrivesSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_content()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(RecentDrivesSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.DriveCount);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(RecentDrivesSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(RecentDrivesSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Cached(Trace(), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(RecentDrivesSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.OfflineCached(
            Trace(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(RecentDrivesSectionState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loading(),
            RepositoryResult<IReadOnlyList<RecentDriveSample>>.Cached(Trace(), Now, stale: false),
            RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));

        await vm.LoadAsync();

        Assert.Equal(RecentDrivesSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(RecentDrivesSectionState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_changing_units_reprojects_distance()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal("12.0 km", vm.Display.Rows[0].DistanceText);

        vm.Units = UnitPref.Imperial;

        Assert.EndsWith("mi", vm.Display.Rows[0].DistanceText);
    }

    [Fact]
    public async Task ViewModel_toggle_distance_sort_reorders_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));
        await vm.LoadAsync();
        Assert.Equal(new long[] { 1, 2, 3 }, vm.Display.Rows.Select(r => r.Id).ToArray());

        vm.ToggleDistanceSort(); // ascending by distance

        Assert.Equal(SortDirection.Ascending, vm.Display.DistanceSortDirection);
        Assert.Equal(new long[] { 3, 1, 2 }, vm.Display.Rows.Select(r => r.Id).ToArray());
    }

    [Fact]
    public async Task ViewModel_pagination_slices_and_navigates()
    {
        var many = Enumerable.Range(1, 12)
            .Select(i => new RecentDriveSample(i, Now.AddMinutes(i), 1000.0 * i, 600, 90, 80))
            .ToList();

        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(many, Now));
        await vm.LoadAsync();

        Assert.True(vm.Display.ShowPagination);
        Assert.Equal(10, vm.Display.Rows.Count);
        Assert.Equal(1, vm.Display.Page);

        vm.GoToPage(2);

        Assert.Equal(2, vm.Display.Page);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Trace(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(RecentDrivesSectionViewModel.State), changed);
        Assert.Contains(nameof(RecentDrivesSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<RecentDriveSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Recent Drives", vm.Title);
        Assert.Equal("View all", vm.ViewAllLabel);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source ---------------------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_then_reads_drive_list()
    {
        using var drives = JsonDocument.Parse(ThreeDriveTrace);
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new RecentDrivesSectionSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);
        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Drives.List, request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_skips_primary_resolution()
    {
        using var drives = JsonDocument.Parse(ThreeDriveTrace);
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new RecentDrivesSectionSource(
            new FakeVehicleSource(null), api, NewEngine(), NewOptions(), vehicleId: 9);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal(9L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var api = new FakeApiClient();
        var source = new RecentDrivesSectionSource(new FakeVehicleSource(null), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_empty_drive_list_yields_empty()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement.Clone());
        var source = new RecentDrivesSectionSource(
            new FakeVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), NewOptions());

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("recent-drives-section", RecentDrivesSectionRegistration.Id);
        Assert.Equal("RecentDrivesSection", RecentDrivesSectionRegistration.Slug);
        Assert.Equal("Recent Drives", RecentDrivesSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RecentDrivesSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentDrivesSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RecentDrivesSectionDisplay Project(string json, UnitPref units) =>
        RecentDrivesSectionProjection.Project(ParseDrives(json), units, Localizer, new TableSortState(), 1, 10);

    private static IReadOnlyList<RecentDriveSample> ParseDrives(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return RecentDriveSample.ParseList(doc.RootElement);
    }

    private static RecentDriveSample Single(string json, int index) => ParseDrives(json)[index];

    private static IReadOnlyList<RecentDriveSample> Trace() => ParseDrives(ThreeDriveTrace);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static RecentDrivesSectionViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<RecentDriveSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<RecentDriveSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDriveSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<RecentDriveSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<RecentDriveSample>>[] emissions)
        : IRecentDrivesSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDriveSample>>> StreamAsync(
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

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
