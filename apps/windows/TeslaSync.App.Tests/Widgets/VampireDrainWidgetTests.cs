using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the VampireDrainWidget's UI-thread-free logic — the JSON parse adapters
/// (stats + events, snake_case / null tolerance), the drain-per-day + severity math, the duration / title /
/// subtitle formatters, the projection (compact value / avg-drain card / reversed sparkline / newest-first
/// capped feed / hasData gate), the two cache-then-network result mappers, the registry metadata, the
/// diagnostics, the repository source's vehicle resolution + request shapes, and the state-holder
/// view-model's combined per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors
/// the web spec (web/src/features/dashboard/widgets/VampireDrainWidget.tsx).
/// </summary>
public sealed class VampireDrainWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private const string OneHourAgo = "2026-06-06T11:00:00Z";
    private const string HalfHourAgo = "2026-06-06T11:30:00Z";
    private const string SevenMinAgo = "2026-06-06T11:58:00Z";

    private static readonly VampireDrainSize Compact = new(1, 2);
    private static readonly VampireDrainSize Standard = new(2, 4);
    private static readonly VampireDrainSize Wide = new(3, 4);

    private static VampireDrainStats Stats(
        double avgDrainRate = 0.05,
        long eventCount = 3,
        double totalHours = 12) =>
        new(avgDrainRate, 0.1, 50, totalHours, eventCount, 0.06, 0.04);

    private static VampireDrainEvent Event(
        long id = 1,
        string? start = HalfHourAgo,
        double batteryLost = 2.5,
        double durationHours = 6,
        double drainRatePerHour = 0.08,
        bool sentry = false) =>
        new(id, 7, start, batteryLost, durationHours, drainRatePerHour, sentry);

    // ---- Parse adapter: stats ------------------------------------------------------

    [Fact]
    public void Stats_parses_snake_case_fields()
    {
        const string json = """
        {"avg_drain_rate":0.05,"max_drain_rate":0.2,"total_range_lost":42.5,"total_hours":12,
         "event_count":3,"avg_sentry_drain":0.07,"avg_nosentry_drain":0.03}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = VampireDrainStats.FromResponse(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(0.05, stats!.AvgDrainRate);
        Assert.Equal(0.2, stats.MaxDrainRate);
        Assert.Equal(42.5, stats.TotalRangeLost);
        Assert.Equal(12, stats.TotalHours);
        Assert.Equal(3, stats.EventCount);
        Assert.Equal(0.07, stats.AvgSentryDrain);
        Assert.Equal(0.03, stats.AvgNosentryDrain);
    }

    [Fact]
    public void Stats_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("{}");

        var stats = VampireDrainStats.FromResponse(doc.RootElement);

        Assert.NotNull(stats);
        Assert.Equal(0, stats!.AvgDrainRate);
        Assert.Equal(0, stats.EventCount);
    }

    [Fact]
    public void Stats_returns_null_for_non_object()
    {
        using var array = JsonDocument.Parse("[]");
        using var number = JsonDocument.Parse("3");

        Assert.Null(VampireDrainStats.FromResponse(array.RootElement));
        Assert.Null(VampireDrainStats.FromResponse(number.RootElement));
    }

    // ---- Parse adapter: events -----------------------------------------------------

    [Fact]
    public void Events_parse_snake_case_fields()
    {
        const string json = """
        [{"id":42,"vehicle_id":7,"start_date":"2026-06-06T11:30:00Z","battery_lost":2.5,
          "duration_hours":6,"drain_rate_pct_per_hour":0.08,"sentry_mode":true}]
        """;
        using var doc = JsonDocument.Parse(json);

        var ev = Assert.Single(VampireDrainEvent.ParseList(doc.RootElement));

        Assert.Equal(42, ev.Id);
        Assert.Equal(7, ev.VehicleId);
        Assert.Equal("2026-06-06T11:30:00Z", ev.StartDate);
        Assert.Equal(2.5, ev.BatteryLost);
        Assert.Equal(6, ev.DurationHours);
        Assert.Equal(0.08, ev.DrainRatePctPerHour);
        Assert.True(ev.SentryMode);
        Assert.NotNull(ev.Timestamp);
    }

    [Fact]
    public void Events_are_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var ev = Assert.Single(VampireDrainEvent.ParseList(doc.RootElement));

        Assert.Equal(2, ev.Id);
        Assert.Equal(0, ev.VehicleId);
        Assert.Null(ev.BatteryLost);
        Assert.Null(ev.DurationHours);
        Assert.Null(ev.DrainRatePctPerHour);
        Assert.False(ev.SentryMode);    // web: ev.sentry_mode is falsy when absent
        Assert.Null(ev.Timestamp);
    }

    [Fact]
    public void Events_return_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(VampireDrainEvent.ParseList(doc.RootElement));
    }

    [Fact]
    public void Event_key_falls_back_to_vehicle_and_start_date()
    {
        var ev = Event(id: 0, start: HalfHourAgo) with { Id = null };
        Assert.Equal("7-2026-06-06T11:30:00Z", ev.Key);
    }

    // ---- Drain math + severity (web drainColor thresholds) -------------------------

    [Fact]
    public void AvgDrainPerDay_multiplies_hourly_rate_by_24()
    {
        Assert.Equal(1.2, VampireDrainProjection.AvgDrainPerDay(Stats(avgDrainRate: 0.05)), 6);
        Assert.Equal(0, VampireDrainProjection.AvgDrainPerDay(null));
    }

    [Fact]
    public void DrainPerDay_multiplies_event_rate_by_24()
    {
        Assert.Equal(1.92, VampireDrainProjection.DrainPerDay(Event(drainRatePerHour: 0.08)), 6);
        Assert.Equal(0, VampireDrainProjection.DrainPerDay(Event(drainRatePerHour: 0) with { DrainRatePctPerHour = null }));
    }

    [Theory]
    [InlineData(0.0, StatusKind.Success)]
    [InlineData(0.99, StatusKind.Success)]
    [InlineData(1.0, StatusKind.Warning)]
    [InlineData(2.99, StatusKind.Warning)]
    [InlineData(3.0, StatusKind.Danger)]
    [InlineData(5.5, StatusKind.Danger)]
    public void Severity_matches_web_drainColor(double drainPerDay, StatusKind expected) =>
        Assert.Equal(expected, VampireDrainProjection.Severity(drainPerDay));

    // ---- Formatters (web formatDuration / title / subtitle) ------------------------

    [Theory]
    [InlineData(0.5, "30m")]
    [InlineData(0.0, "0m")]
    [InlineData(1.0, "1.0h")]
    [InlineData(6.0, "6.0h")]
    [InlineData(12.5, "12.5h")]
    public void FormatDuration_matches_web(double hours, string expected) =>
        Assert.Equal(expected, VampireDrainProjection.FormatDuration(hours, Localizer));

    [Fact]
    public void EventTitle_includes_battery_duration_and_sentry()
    {
        Assert.Equal("2.0% \u00B7 6.0h \u00B7 Sentry",
            VampireDrainProjection.EventTitle(Event(batteryLost: 2.0, durationHours: 6, sentry: true), Localizer));

        Assert.Equal("1.0% \u00B7 30m",
            VampireDrainProjection.EventTitle(Event(batteryLost: 1.0, durationHours: 0.5, sentry: false), Localizer));
    }

    [Fact]
    public void EventSubtitle_is_drain_per_day_percentage()
    {
        // 0.08/hr * 24 = 1.92 -> "1.9%/day".
        Assert.Equal("1.9%/day", VampireDrainProjection.EventSubtitle(1.92, Localizer));
    }

    // ---- Projection: compact / avg-drain / sparkline / feed / hasData --------------

    [Fact]
    public void Project_compact_shows_avg_drain_big_number_with_severity()
    {
        var display = VampireDrainProjection.Project(Stats(avgDrainRate: 0.05), Array.Empty<VampireDrainEvent>(), Compact, Localizer, Now);

        Assert.True(display.HasData);
        Assert.True(display.IsCompact);
        Assert.Equal("1.2%", display.CompactValueText);
        Assert.Equal("/day", display.CompactPerDayLabel);
        Assert.Equal(StatusKind.Warning, display.CompactSeverity);
    }

    [Fact]
    public void Project_avg_drain_card_value_and_sublabel()
    {
        var display = VampireDrainProjection.Project(Stats(avgDrainRate: 0.05, eventCount: 3, totalHours: 12), Array.Empty<VampireDrainEvent>(), Standard, Localizer, Now);

        Assert.Equal("Avg Drain", display.AvgDrainLabel);
        Assert.Equal("1.2%/day", display.AvgDrainValueText);
        Assert.Equal(StatusKind.Warning, display.AvgDrainSeverity);
        Assert.Equal("3 events \u00B7 12h total", display.AvgDrainSublabel);
    }

    [Fact]
    public void Project_sublabel_absent_when_stats_missing()
    {
        var display = VampireDrainProjection.Project(null, new[] { Event() }, Standard, Localizer, Now);

        Assert.True(display.HasData);                 // events present
        Assert.Null(display.AvgDrainSublabel);        // web: sublabel only when stats != null
        Assert.Equal("0.0%/day", display.AvgDrainValueText); // avgDrainPctPerDay = 0 when stats missing
    }

    [Fact]
    public void Project_sparkline_is_reversed_event_drain_per_day()
    {
        var e1 = Event(id: 1, start: OneHourAgo, drainRatePerHour: 0.05);   // 1.2
        var e2 = Event(id: 2, start: HalfHourAgo, drainRatePerHour: 0.10);  // 2.4
        var e3 = Event(id: 3, start: SevenMinAgo, drainRatePerHour: 0.20);  // 4.8

        var display = VampireDrainProjection.Project(Stats(), new[] { e1, e2, e3 }, Wide, Localizer, Now);

        // Web parity: events.slice().reverse().map(drainDay).
        Assert.Equal(new[] { 4.8, 2.4, 1.2 }, display.SparklineData.Select(v => Math.Round(v, 6)).ToArray());
        Assert.True(display.ShowSparkline);
        Assert.Equal(StatusKind.Warning, display.SparklineSeverity); // avg 0.05*24 = 1.2
    }

    [Fact]
    public void Project_sparkline_hidden_when_not_wide_or_too_few_points()
    {
        var two = new[] { Event(id: 1), Event(id: 2) };

        Assert.False(VampireDrainProjection.Project(Stats(), two, Standard, Localizer, Now).ShowSparkline); // not wide
        Assert.False(VampireDrainProjection.Project(Stats(), new[] { Event() }, Wide, Localizer, Now).ShowSparkline); // one point
        Assert.True(VampireDrainProjection.Project(Stats(), two, Wide, Localizer, Now).ShowSparkline);
    }

    [Fact]
    public void Project_feed_orders_newest_first_and_caps_at_five()
    {
        var events = Enumerable.Range(0, 7)
            .Select(i => Event(id: i, start: $"2026-06-06T11:0{i}:00Z"))
            .ToArray();

        var display = VampireDrainProjection.Project(Stats(), events, Standard, Localizer, Now);

        Assert.Equal(VampireDrainSize.MaxFeedItems, display.Events.Count);
        Assert.Equal(new[] { "6", "5", "4", "3", "2" }, display.Events.Select(r => r.Key).ToArray());
    }

    [Fact]
    public void Project_event_rows_carry_severity_title_subtitle_and_relative_time()
    {
        var ev = Event(id: 9, start: HalfHourAgo, batteryLost: 4.0, durationHours: 12, drainRatePerHour: 0.20, sentry: true);

        var row = Assert.Single(VampireDrainProjection.Project(Stats(), new[] { ev }, Standard, Localizer, Now).Events);

        Assert.Equal(StatusKind.Danger, row.Severity);  // 0.2*24 = 4.8 -> red
        Assert.Equal("4.0% \u00B7 12.0h \u00B7 Sentry", row.Title);
        Assert.Equal("4.8%/day", row.Subtitle);
        Assert.Equal("35m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_no_data_when_no_stats_and_no_events()
    {
        var display = VampireDrainProjection.Project(null, Array.Empty<VampireDrainEvent>(), Standard, Localizer, Now);

        Assert.False(display.HasData);
        Assert.False(display.HasEvents);
        Assert.Equal("No vampire drain data", display.EmptyMessage);
    }

    [Fact]
    public void Project_no_events_message_when_stats_present_but_no_events()
    {
        var display = VampireDrainProjection.Project(Stats(), Array.Empty<VampireDrainEvent>(), Standard, Localizer, Now);

        Assert.True(display.HasData);     // stats present
        Assert.False(display.HasEvents);
        Assert.Equal("No recent drain events", display.NoEventsMessage);
    }

    // ---- Accessibility names -------------------------------------------------------

    [Fact]
    public void Project_surfaces_non_empty_accessibility_names()
    {
        var display = VampireDrainProjection.Project(Stats(avgDrainRate: 0.05, eventCount: 3, totalHours: 12), new[] { Event(sentry: true) }, Standard, Localizer, Now);

        Assert.False(string.IsNullOrWhiteSpace(display.CompactAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.AvgDrainAutomationName));
        Assert.Contains("Avg Drain", display.AvgDrainAutomationName, StringComparison.Ordinal);
        Assert.Contains("1.2%/day", display.AvgDrainAutomationName, StringComparison.Ordinal);

        var row = Assert.Single(display.Events);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains(row.Title, row.AutomationName, StringComparison.Ordinal);
        Assert.Contains(row.RelativeTime, row.AutomationName, StringComparison.Ordinal);
    }

    // ---- i18n key coverage (every web-source key resolves through the facade) -------

    [Fact]
    public void Projection_resolves_every_web_source_i18n_key()
    {
        var recorder = new RecordingLocalizer();
        var shortEvent = Event(id: 1, durationHours: 0.5, sentry: true);  // exercises min + sentry
        var longEvent = Event(id: 2, durationHours: 6);                   // exercises hr

        _ = VampireDrainProjection.Project(Stats(), new[] { shortEvent, longEvent }, Wide, recorder, Now);
        _ = VampireDrainRegistration.Name(recorder);

        string[] expected =
        {
            "widget.vampireDrain.title",
            "widget.vampireDrain.avgDrain",
            "widget.vampireDrain.eventCount",
            "widget.vampireDrain.hr",
            "widget.vampireDrain.min",
            "widget.vampireDrain.noData",
            "widget.vampireDrain.noEvents",
            "widget.vampireDrain.perDay",
            "widget.vampireDrain.sentry",
            "widget.vampireDrain.trend",
        };

        foreach (var key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Result mappers (cache-then-network preservation) --------------------------

    [Fact]
    public void StatsMapper_preserves_status_and_parses_object()
    {
        using var doc = JsonDocument.Parse("""{"avg_drain_rate":0.05,"event_count":3}""");

        var cached = VampireDrainStatsResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(0.05, cached.Value!.AvgDrainRate);

        var loaded = VampireDrainStatsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
    }

    [Fact]
    public void StatsMapper_collapses_non_object_to_empty_and_maps_failure()
    {
        using var array = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, VampireDrainStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(array.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, VampireDrainStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, VampireDrainStatsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void EventsMapper_preserves_status_and_collapses_empty_array()
    {
        using var rows = JsonDocument.Parse("""[{"id":1,"start_date":"2026-06-06T11:30:00Z"}]""");
        using var empty = JsonDocument.Parse("[]");

        var offline = VampireDrainEventsResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(rows.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);

        Assert.Equal(LoadStatus.Empty, VampireDrainEventsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);
    }

    // ---- Size flags (web isCompact / isWide) ---------------------------------------

    [Theory]
    [InlineData(1, 2, true, false)]
    [InlineData(2, 4, false, false)]
    [InlineData(3, 4, false, true)]
    [InlineData(4, 40, false, true)]
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new VampireDrainSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("vampire-drain", VampireDrainRegistration.Id);
        Assert.Equal("energy", VampireDrainRegistration.Category);
        Assert.Equal("VampireDrainWidget", VampireDrainRegistration.Slug);
        Assert.Equal(new VampireDrainSize(2, 4), VampireDrainRegistration.DefaultSize);
        Assert.Equal(new VampireDrainSize(1, 2), VampireDrainRegistration.MinSize);
        Assert.Equal(new VampireDrainSize(4, 40), VampireDrainRegistration.MaxSize);
        Assert.Equal("Vampire Drain", VampireDrainRegistration.Name(Localizer));
        Assert.Contains("drain", VampireDrainRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, VampireDrainRegistration.IsWithinBounds(new VampireDrainSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new VampireDrainSize(1, 2), VampireDrainRegistration.Clamp(new VampireDrainSize(0, 0)));
        Assert.Equal(new VampireDrainSize(4, 40), VampireDrainRegistration.Clamp(new VampireDrainSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VampireDrainDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VampireDrainWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shapes -------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new VampireDrainSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var stats = await DrainStats(source);
        var events = await DrainEvents(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(stats).Status);
        Assert.Equal(LoadStatus.Empty, Assert.Single(events).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_stats_stream_requests_vampire_drain_stats_by_vehicle()
    {
        using var doc = JsonDocument.Parse("""{"avg_drain_rate":0.05,"event_count":3,"total_hours":12}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new VampireDrainSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await DrainStats(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(0.05, results[^1].Value!.AvgDrainRate);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vampire_drain_stats", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Source_events_stream_requests_vampire_drain_with_limit()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"start_date":"2026-06-06T11:30:00Z","drain_rate_pct_per_hour":0.08}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new VampireDrainSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await DrainEvents(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vampire_drain", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
        Assert.Equal(VampireDrainSource.EventLimit, request.Query!["limit"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"avg_drain_rate":0}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new VampireDrainSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainStats(source);

        Assert.Equal(42L, Assert.Single(api.Requests).Query!["vehicle_id"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_stats_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new VampireDrainSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), new ApiClientOptions());

        var results = await DrainStats(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- View-model combined state matrix ------------------------------------------

    [Fact]
    public async Task ViewModel_stays_loading_until_both_sources_resolve()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<VampireDrainStats>.Loaded(Stats(), Now) },
            new[] { RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Loading() }); // events never resolve
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_merges_stats_and_events()
    {
        using var vm = NewViewModel(StatsStream(Stats()), EventsStream(Event()));
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasEvents);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_both_sources_empty()
    {
        using var vm = NewViewModel(StatsStream(null), EventsStream());
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No vampire drain data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_both_fail_with_no_data()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<VampireDrainStats>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) },
            new[] { RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) });
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stats_present_with_events_error_stays_loaded_with_error_chip()
    {
        // Web parity: hasData = stats != null, so the body renders; isError = statsError || eventsError
        // lights the freshness chip without replacing the body.
        using var vm = NewViewModel(
            StatsStream(Stats()),
            new[] { RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) });
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<VampireDrainStats>.Cached(Stats(), Now, stale: true) },
            EventsStream());
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_error_chip()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<VampireDrainStats>.OfflineCached(Stats(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")) },
            EventsStream());
        await vm.LoadAsync();

        Assert.Equal(VampireDrainState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(Standard, StatsStream(Stats()), EventsStream(Event()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new VampireDrainSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(VampireDrainState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(StatsStream(Stats()), EventsStream(Event()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VampireDrainViewModel.State), changed);
        Assert.Contains(nameof(VampireDrainViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_and_keeps_data()
    {
        using var vm = NewViewModel(StatsStream(Stats()), EventsStream(Event()));
        await vm.LoadAsync();
        Assert.True(vm.HasData);

        await vm.RetryAsync();

        Assert.Equal(VampireDrainState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Attempts >= 2);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<VampireDrainStats>[] StatsStream(VampireDrainStats? stats) =>
        stats is null
            ? new[] { RepositoryResult<VampireDrainStats>.Empty(Now) }
            : new[] { RepositoryResult<VampireDrainStats>.Loaded(stats, Now) };

    private static RepositoryResult<IReadOnlyList<VampireDrainEvent>>[] EventsStream(params VampireDrainEvent[] events) =>
        events.Length == 0
            ? new[] { RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Empty(Now) }
            : new[] { RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Loaded(events, Now) };

    private static VampireDrainViewModel NewViewModel(
        RepositoryResult<VampireDrainStats>[] stats,
        RepositoryResult<IReadOnlyList<VampireDrainEvent>>[] events) =>
        NewViewModel(Standard, stats, events);

    private static VampireDrainViewModel NewViewModel(
        VampireDrainSize size,
        RepositoryResult<VampireDrainStats>[] stats,
        RepositoryResult<IReadOnlyList<VampireDrainEvent>>[] events) =>
        new(new FakeVampireDrainSource(stats, events), Localizer, size, () => Now);

    private static async Task<List<RepositoryResult<VampireDrainStats>>> DrainStats(IVampireDrainSource source)
    {
        var list = new List<RepositoryResult<VampireDrainStats>>();
        await foreach (var result in source.StreamStatsAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static async Task<List<RepositoryResult<IReadOnlyList<VampireDrainEvent>>>> DrainEvents(IVampireDrainSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<VampireDrainEvent>>>();
        await foreach (var result in source.StreamEventsAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeVampireDrainSource(
        RepositoryResult<VampireDrainStats>[] stats,
        RepositoryResult<IReadOnlyList<VampireDrainEvent>>[] events) : IVampireDrainSource
    {
        public async IAsyncEnumerable<RepositoryResult<VampireDrainStats>> StreamStatsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in stats)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VampireDrainEvent>>> StreamEventsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in events)
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
