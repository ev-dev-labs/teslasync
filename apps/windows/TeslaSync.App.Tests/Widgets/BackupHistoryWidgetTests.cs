using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the BackupHistoryWidget's UI-thread-free logic — the two-source JSON parse
/// adapter (energy-sites → first site id, backup-history → outage rows), the web <c>fmtDuration</c> port,
/// the projection (outage count / average duration / newest-first capped feed / labels), the footprint
/// flags, the two-call source composition (sites → backup-history, with the 30-day <c>since</c> window),
/// the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / no-site / no-events / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/BackupHistoryWidget.tsx).
/// </summary>
public sealed class BackupHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static BackupEvent Event(
        long id = 1,
        string? timestamp = "2026-06-06T12:00:00Z",
        double? durationSeconds = 120) =>
        new(id, timestamp, durationSeconds);

    private static BackupHistorySnapshot Linked(params BackupEvent[] events) =>
        new(true, 555, events);

    // ---- Parse adapter: energy sites -----------------------------------------------

    [Fact]
    public void ParseFirstSiteId_reads_snake_case_energy_site_id()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"energy_site_id":555,"site_name":"Home"},{"id":2,"energy_site_id":777}]""");

        Assert.Equal(555, BackupHistorySnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_accepts_numeric_string()
    {
        using var doc = JsonDocument.Parse("""[{"energy_site_id":"909"}]""");
        Assert.Equal(909, BackupHistorySnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_empty_array_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(BackupHistorySnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_non_array_is_null()
    {
        using var doc = JsonDocument.Parse("""{"energy_site_id":1}""");
        Assert.Null(BackupHistorySnapshot.ParseFirstSiteId(doc.RootElement));
    }

    [Fact]
    public void ParseFirstSiteId_missing_id_is_null()
    {
        using var doc = JsonDocument.Parse("""[{"site_name":"Home"}]""");
        Assert.Null(BackupHistorySnapshot.ParseFirstSiteId(doc.RootElement));
    }

    // ---- Parse adapter: backup events ----------------------------------------------

    [Fact]
    public void ParseEvents_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":3,"energy_site_id":555,"period":"day","timestamp":"2026-06-06T12:00:00Z","duration_seconds":1800,"fetched_at":"2026-06-06T12:30:00Z"}]""");

        var ev = Assert.Single(BackupHistorySnapshot.ParseEvents(doc.RootElement));
        Assert.Equal(3, ev.Id);
        Assert.Equal("2026-06-06T12:00:00Z", ev.Timestamp);
        Assert.Equal(1800, ev.DurationSeconds);
        Assert.NotNull(ev.TimestampTime);
    }

    [Fact]
    public void ParseEvents_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":4}]""");

        var ev = Assert.Single(BackupHistorySnapshot.ParseEvents(doc.RootElement));
        Assert.Equal(4, ev.Id);
        Assert.Null(ev.Timestamp);
        Assert.Null(ev.DurationSeconds);
        Assert.Null(ev.TimestampTime);
    }

    [Fact]
    public void ParseEvents_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":"5","duration_seconds":"600","timestamp":"2026-06-06T12:00:00Z"}]""");

        var ev = Assert.Single(BackupHistorySnapshot.ParseEvents(doc.RootElement));
        Assert.Equal(5, ev.Id);
        Assert.Equal(600, ev.DurationSeconds);
    }

    [Fact]
    public void ParseEvents_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(BackupHistorySnapshot.ParseEvents(doc.RootElement));
    }

    [Fact]
    public void FromJson_links_site_and_events()
    {
        using var sites = JsonDocument.Parse("""[{"energy_site_id":555}]""");
        using var events = JsonDocument.Parse(
            """[{"id":1,"timestamp":"2026-06-06T12:00:00Z","duration_seconds":120}]""");

        var snapshot = BackupHistorySnapshot.FromJson(sites.RootElement, events.RootElement);

        Assert.True(snapshot.HasSites);
        Assert.Equal(555, snapshot.SiteId);
        Assert.True(snapshot.HasEvents);
        Assert.Single(snapshot.Events);
    }

    [Fact]
    public void FromJson_without_site_ignores_events_and_is_no_sites()
    {
        using var sites = JsonDocument.Parse("[]");
        using var events = JsonDocument.Parse("""[{"id":1,"duration_seconds":120}]""");

        var snapshot = BackupHistorySnapshot.FromJson(sites.RootElement, events.RootElement);

        Assert.False(snapshot.HasSites);
        Assert.Null(snapshot.SiteId);
        Assert.False(snapshot.HasEvents);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void Snapshot_empty_and_no_sites_flags()
    {
        Assert.False(BackupHistorySnapshot.Empty.HasData);
        Assert.False(BackupHistorySnapshot.Empty.HasSites);

        Assert.True(BackupHistorySnapshot.NoSites.HasData);
        Assert.False(BackupHistorySnapshot.NoSites.HasSites);
        Assert.Empty(BackupHistorySnapshot.NoSites.Events);
    }

    // ---- Duration formatter (port of web fmtDuration) ------------------------------

    [Theory]
    [InlineData(0, "0s")]
    [InlineData(30, "30s")]
    [InlineData(45, "45s")]
    [InlineData(59, "59s")]
    [InlineData(60, "1m")]
    [InlineData(90, "1m")]
    [InlineData(3599, "59m")]
    [InlineData(3600, "1h")]
    [InlineData(7200, "2h")]
    [InlineData(3660, "1h 1m")]
    [InlineData(8100, "2h 15m")]
    public void FormatDuration_matches_web(double seconds, string expected) =>
        Assert.Equal(expected, BackupHistoryProjection.FormatDuration(seconds));

    [Theory]
    [InlineData(45.4, "45s")]
    [InlineData(45.6, "46s")]
    public void FormatDuration_rounds_sub_minute_like_math_round(double seconds, string expected) =>
        Assert.Equal(expected, BackupHistoryProjection.FormatDuration(seconds));

    [Theory]
    [InlineData(-5)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatDuration_floors_non_finite_to_zero(double seconds) =>
        Assert.Equal("0s", BackupHistoryProjection.FormatDuration(seconds));

    // ---- Size / footprint flags (web isCompact, maxEvents) -------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new BackupHistorySize(cols, rows).IsCompact);

    [Theory]
    [InlineData(1, 2, BackupHistorySize.CompactMaxEvents)]
    [InlineData(2, 4, BackupHistorySize.StandardMaxEvents)]
    public void Size_max_events_matches_web(int cols, int rows, int expected) =>
        Assert.Equal(expected, new BackupHistorySize(cols, rows).MaxEvents);

    [Fact]
    public void Size_caps_are_three_and_ten()
    {
        Assert.Equal(3, BackupHistorySize.CompactMaxEvents);
        Assert.Equal(10, BackupHistorySize.StandardMaxEvents);
    }

    // ---- Projection: stat summary --------------------------------------------------

    [Fact]
    public void Project_formats_outage_count_and_average_duration()
    {
        var display = Project(Linked(Event(durationSeconds: 120), Event(id: 2, durationSeconds: 240)));

        Assert.True(display.HasSites);
        Assert.True(display.HasEvents);
        Assert.Equal(2, display.TotalOutages);
        Assert.Equal("2", display.OutagesValue);
        Assert.Equal("3m", display.AvgDurationValue); // (120 + 240) / 2 = 180s
        Assert.Equal("Outages (30d)", display.OutagesLabel);
        Assert.Equal("Avg Duration", display.AvgDurationLabel);
        Assert.Equal("Duration", display.DurationLabel);
    }

    [Fact]
    public void Project_groups_large_outage_count()
    {
        var events = new BackupEvent[1234];
        for (int i = 0; i < events.Length; i++)
        {
            events[i] = Event(id: i, durationSeconds: 60);
        }

        var display = Project(Linked(events));
        Assert.Equal(1234, display.TotalOutages);
        Assert.Equal("1,234", display.OutagesValue);
    }

    [Fact]
    public void Project_average_treats_null_duration_as_zero()
    {
        // Web parity: avgDurationSec sums (duration_seconds ?? 0) over all items.
        var display = Project(Linked(Event(durationSeconds: null), Event(id: 2, durationSeconds: 60)));
        Assert.Equal("30s", display.AvgDurationValue); // (0 + 60) / 2 = 30s
    }

    [Fact]
    public void Project_no_events_has_zero_stats_and_no_rows()
    {
        var display = Project(Linked());
        Assert.True(display.HasSites);
        Assert.False(display.HasEvents);
        Assert.Equal(0, display.TotalOutages);
        Assert.Empty(display.Events);
        Assert.Equal("0", display.OutagesValue);
        Assert.Equal("0s", display.AvgDurationValue);
    }

    [Fact]
    public void Project_no_site_flag()
    {
        var display = Project(BackupHistorySnapshot.NoSites);
        Assert.False(display.HasSites);
        Assert.False(display.HasEvents);
    }

    // ---- Projection: outage feed ---------------------------------------------------

    [Fact]
    public void Project_sorts_rows_newest_first_and_caps_standard_to_ten()
    {
        var events = new List<BackupEvent>();
        for (int i = 0; i < 12; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            events.Add(Event(id: i, timestamp: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = Project(Linked(events.ToArray()), BackupHistorySize.Default);

        Assert.Equal(12, display.TotalOutages);   // count is over ALL events
        Assert.Equal(10, display.Events.Count);    // standard cap = 10
        Assert.Equal(11, display.Events[0].Id);     // newest first
        Assert.Equal(2, display.Events[^1].Id);
    }

    [Fact]
    public void Project_caps_compact_to_three()
    {
        var events = new List<BackupEvent>();
        for (int i = 0; i < 5; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            events.Add(Event(id: i, timestamp: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = Project(Linked(events.ToArray()), new BackupHistorySize(1, 2));

        Assert.True(display.IsCompact);
        Assert.Equal(5, display.TotalOutages);
        Assert.Equal(3, display.Events.Count);     // compact cap = 3
        Assert.Equal(4, display.Events[0].Id);      // newest first
    }

    [Fact]
    public void Project_row_formats_time_duration_and_accessibility_name()
    {
        var row = Project(Linked(Event(timestamp: "2026-06-06T12:00:00Z", durationSeconds: 1800))).Events[0];

        Assert.NotEqual("\u2014", row.TimeText);                 // a real, formatted absolute time
        Assert.False(string.IsNullOrWhiteSpace(row.TimeText));
        Assert.Equal("30m", row.DurationText);
        Assert.StartsWith(row.TimeText, row.AccessibilityName, StringComparison.Ordinal);
        Assert.Contains("Duration", row.AccessibilityName, StringComparison.Ordinal);
        Assert.Contains("30m", row.AccessibilityName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_row_missing_timestamp_is_em_dash_time_but_keeps_duration()
    {
        var row = Project(Linked(Event(timestamp: null, durationSeconds: 90))).Events[0];

        Assert.Equal("\u2014", row.TimeText);
        Assert.Equal("1m", row.DurationText);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BackupHistorySnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Loading, vm.State);
        Assert.False(vm.HasEvents);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_events_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Linked(Event(id: 1), Event(id: 2))));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Loaded, vm.State);
        Assert.True(vm.HasSites);
        Assert.True(vm.HasEvents);
        Assert.Equal(2, vm.Display.Events.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_site_without_events_is_no_events()
    {
        using var vm = NewViewModel(Loaded(Linked()));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.NoEvents, vm.State);
        Assert.True(vm.HasSites);
        Assert.False(vm.HasEvents);
        Assert.Equal("No backup events in the last 30 days", vm.NoEventsMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_without_site_is_no_site()
    {
        using var vm = NewViewModel(Loaded(BackupHistorySnapshot.NoSites));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.NoSite, vm.State);
        Assert.False(vm.HasSites);
        Assert.Equal("No Tesla Energy site linked", vm.NoSiteMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_no_events_defensively()
    {
        using var vm = NewViewModel(RepositoryResult<BackupHistorySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.NoEvents, vm.State);
        Assert.True(vm.HasSites);
        Assert.False(vm.HasEvents);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupHistorySnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupHistorySnapshot>.Cached(Linked(Event(id: 1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasEvents);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<BackupHistorySnapshot>.OfflineCached(
            Linked(Event(id: 1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Offline, vm.State);
        Assert.True(vm.HasEvents);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BackupHistorySnapshot>.Loading(),
            RepositoryResult<BackupHistorySnapshot>.Cached(Linked(Event(id: 1)), Now, stale: false),
            RepositoryResult<BackupHistorySnapshot>.Loaded(Linked(Event(id: 1), Event(id: 2)), Now));
        await vm.LoadAsync();

        Assert.Equal(BackupHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Events.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_and_recaps()
    {
        var events = new List<BackupEvent>();
        for (int i = 0; i < 8; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            events.Add(Event(id: i, timestamp: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        using var vm = NewViewModel(new BackupHistorySize(2, 4), Loaded(Linked(events.ToArray())));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.Equal(8, vm.Display.Events.Count); // standard shows all 8 (< cap 10)

        vm.Size = new BackupHistorySize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(3, vm.Display.Events.Count);  // compact recaps to 3
        Assert.Equal(BackupHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(Loaded(BackupHistorySnapshot.NoSites));
        await vm.LoadAsync();

        Assert.Equal("Backup History", vm.Title);
        Assert.Equal("No Tesla Energy site linked", vm.NoSiteMessage);
        Assert.Equal("No backup events in the last 30 days", vm.NoEventsMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Linked(Event(id: 1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BackupHistoryViewModel.State), changed);
        Assert.Contains(nameof(BackupHistoryViewModel.Display), changed);
    }

    // ---- Source: two-call composition ----------------------------------------------

    [Fact]
    public async Task Source_with_no_sites_yields_no_site_without_requesting_backup()
    {
        using var sites = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(sites.RootElement);
        var source = new BackupHistorySource(api, NewEngine(), new ApiClientOptions(), () => Now);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.False(terminal.Value!.HasSites);
        // Only the energy-sites request fired; the backup-history query stays disabled (web enabled: !!siteId).
        Assert.Single(api.Requests);
        Assert.Equal(BackupHistoryRegistration.SitesOperationId, api.Requests[0].OperationId);
    }

    [Fact]
    public async Task Source_resolves_first_site_and_requests_backup_history_with_since_window()
    {
        using var sites = JsonDocument.Parse("""[{"energy_site_id":555}]""");
        using var events = JsonDocument.Parse(
            """[{"id":1,"timestamp":"2026-06-06T12:00:00Z","duration_seconds":120}]""");
        var api = new FakeApiClient()
            .ReturnsValue(sites.RootElement)
            .ReturnsValue(events.RootElement);
        var source = new BackupHistorySource(api, NewEngine(), new ApiClientOptions(), () => Now);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasSites);
        Assert.Equal(555, terminal.Value.SiteId);
        Assert.Single(terminal.Value.Events);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(BackupHistoryRegistration.SitesOperationId, api.Requests[0].OperationId);

        var backup = api.Requests[1];
        Assert.Equal(BackupHistoryRegistration.BackupHistoryOperationId, backup.OperationId);
        Assert.Equal("555", backup.PathParams![BackupHistoryRegistration.SitePathParam]);
        Assert.Equal("2026-05-07", backup.Query![BackupHistoryRegistration.SinceQueryParam]);
    }

    [Fact]
    public void Source_since_date_is_thirty_days_before_now_utc()
    {
        Assert.Equal("2026-05-07", BackupHistorySource.SinceDate(Now));
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("backup-history", BackupHistoryRegistration.Id);
        Assert.Equal("energy", BackupHistoryRegistration.Category);
        Assert.Equal("BackupHistoryWidget", BackupHistoryRegistration.Slug);
        Assert.Equal(30, BackupHistoryRegistration.LookbackDays);
        Assert.Equal(new BackupHistorySize(2, 4), BackupHistoryRegistration.DefaultSize);
        Assert.Equal(new BackupHistorySize(1, 2), BackupHistoryRegistration.MinSize);
        Assert.Equal(new BackupHistorySize(4, 40), BackupHistoryRegistration.MaxSize);
        Assert.Equal("Backup History", BackupHistoryRegistration.Name(Localizer));
        Assert.Contains("Powerwall", BackupHistoryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 4, false)]
    [InlineData(5, 40, false)]
    [InlineData(2, 41, false)]
    [InlineData(2, 1, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BackupHistoryRegistration.IsWithinBounds(new BackupHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BackupHistorySize(1, 2), BackupHistoryRegistration.Clamp(new BackupHistorySize(0, 0)));
        Assert.Equal(new BackupHistorySize(4, 40), BackupHistoryRegistration.Clamp(new BackupHistorySize(9, 99)));
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.ContainsKey(BackupHistoryRegistration.SitesOperationId));
        Assert.True(index.TryGetValue(BackupHistoryRegistration.BackupHistoryOperationId, out var backup));
        Assert.Contains(BackupHistoryRegistration.SitePathParam, backup!.PathParams);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BackupHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BackupHistoryWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static BackupHistoryDisplay Project(BackupHistorySnapshot snapshot) =>
        Project(snapshot, BackupHistorySize.Default);

    private static BackupHistoryDisplay Project(BackupHistorySnapshot snapshot, BackupHistorySize size) =>
        BackupHistoryProjection.Project(snapshot, size, Localizer, Now);

    private static RepositoryResult<BackupHistorySnapshot> Loaded(BackupHistorySnapshot snapshot) =>
        RepositoryResult<BackupHistorySnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<BackupHistorySnapshot>>> Drain(IBackupHistorySource source)
    {
        var results = new List<RepositoryResult<BackupHistorySnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static BackupHistoryViewModel NewViewModel(params RepositoryResult<BackupHistorySnapshot>[] emissions) =>
        NewViewModel(BackupHistorySize.Default, emissions);

    private static BackupHistoryViewModel NewViewModel(
        BackupHistorySize size,
        params RepositoryResult<BackupHistorySnapshot>[] emissions) =>
        new(new FakeBackupHistorySource(emissions), Localizer, size, () => Now);

    private sealed class FakeBackupHistorySource(params RepositoryResult<BackupHistorySnapshot>[] emissions)
        : IBackupHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<BackupHistorySnapshot>> StreamAsync(
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
