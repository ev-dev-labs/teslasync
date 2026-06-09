using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the SentryEventLogWidget's UI-thread-free logic — the parse adapter, the
/// deriveEvent classification ladder, the projection (sort / cap / subtitle / labels / a11y name), the
/// cache-then-network result mapper, the repository-backed source (vehicle resolution + request shape +
/// cached→projection), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx).
/// </summary>
public sealed class SentryEventLogWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private const string FiveMinAgo = "2026-06-06T12:00:00Z";

    private static SentryLogEvent Event(
        long? id = 1,
        long vehicleId = 7,
        string? ts = FiveMinAgo,
        string? doorState = null,
        bool? sentryMode = null,
        bool? locked = null,
        string? createdAt = FiveMinAgo) =>
        new(id, vehicleId, ts, doorState, sentryMode, locked, createdAt);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"vehicle_id":7,"ts":"2026-06-06T11:59:00Z","event_type":"security","door_state":"df open",
          "sentry_mode":true,"locked":false,"id":42,"created_at":"2026-06-06T12:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var ev = Assert.Single(SentryLogEvent.ParseList(doc.RootElement));

        Assert.Equal(42, ev.Id);
        Assert.Equal(7, ev.VehicleId);
        Assert.Equal("2026-06-06T11:59:00Z", ev.Ts);
        Assert.Equal("df open", ev.DoorState);
        Assert.True(ev.SentryMode);
        Assert.False(ev.Locked);
        Assert.NotNull(ev.Timestamp);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var ev = Assert.Single(SentryLogEvent.ParseList(doc.RootElement));

        Assert.Equal(2, ev.Id);
        Assert.Equal(0, ev.VehicleId);
        Assert.Null(ev.DoorState);
        Assert.Null(ev.SentryMode);
        Assert.Null(ev.Locked);
        Assert.Null(ev.Timestamp);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(SentryLogEvent.ParseList(doc.RootElement));
    }

    [Fact]
    public void FromJson_ignores_non_string_door_state_and_non_bool_flags()
    {
        // Web parity: door_state is read via asNonEmptyString (string-only); sentry_mode/locked are
        // strict booleans, so a string/number value collapses to null (not true/false).
        using var doc = JsonDocument.Parse("""[{"door_state":false,"sentry_mode":"active","locked":1}]""");

        var ev = Assert.Single(SentryLogEvent.ParseList(doc.RootElement));

        Assert.Null(ev.DoorState);
        Assert.Null(ev.SentryMode);
        Assert.Null(ev.Locked);
    }

    [Fact]
    public void FromJson_distinguishes_explicit_null_from_false()
    {
        using var doc = JsonDocument.Parse("""[{"sentry_mode":null,"locked":false}]""");

        var ev = Assert.Single(SentryLogEvent.ParseList(doc.RootElement));

        Assert.Null(ev.SentryMode);   // web: != null is false
        Assert.False(ev.Locked);      // web: === false is true
    }

    [Fact]
    public void Key_and_timestamp_fall_back_to_vehicle_and_ts()
    {
        var ev = Event(id: null, vehicleId: 7, ts: FiveMinAgo, createdAt: null);

        Assert.Equal("7-2026-06-06T12:00:00Z", ev.Key);
        Assert.NotNull(ev.Timestamp); // created_at absent -> ts
    }

    // ---- Classification (web deriveEvent precedence) -------------------------------

    [Fact]
    public void Classify_door_open_takes_precedence_over_everything()
    {
        var ev = Event(doorState: "df open", sentryMode: true, locked: true);
        Assert.Equal(SentryEventKind.DoorOpen, SentryEventLogProjection.Classify(ev));
    }

    [Theory]
    [InlineData(true, null, SentryEventKind.SentryActivated)]
    [InlineData(false, null, SentryEventKind.SentryDeactivated)]
    [InlineData(null, true, SentryEventKind.Locked)]
    [InlineData(null, false, SentryEventKind.Unlocked)]
    [InlineData(null, null, SentryEventKind.StateUpdated)]
    public void Classify_follows_web_ladder(bool? sentry, bool? locked, SentryEventKind expected)
    {
        var ev = Event(doorState: null, sentryMode: sentry, locked: locked);
        Assert.Equal(expected, SentryEventLogProjection.Classify(ev));
    }

    [Fact]
    public void Classify_sentry_wins_over_lock()
    {
        // Web ladder: sentry_mode is checked before locked.
        var ev = Event(sentryMode: true, locked: false);
        Assert.Equal(SentryEventKind.SentryActivated, SentryEventLogProjection.Classify(ev));
    }

    // ---- Open-door parsing ---------------------------------------------------------

    [Fact]
    public void OpenDoors_filters_open_parts_case_insensitively()
    {
        var open = SentryEventLogProjection.OpenDoors("FrontLeft OPEN, FrontRight closed, RearLeft open");

        Assert.Equal(2, open.Count);
        Assert.Equal("FrontLeft OPEN", open[0]);
        Assert.Equal("RearLeft open", open[1]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("all closed")]
    public void OpenDoors_empty_when_none_open(string? doorState) =>
        Assert.Empty(SentryEventLogProjection.OpenDoors(doorState));

    // ---- Presentation (web hex -> design token) ------------------------------------

    [Theory]
    [InlineData(SentryEventKind.DoorOpen, "TsColorWarningBrush", SentryEventSeverity.Warning)]
    [InlineData(SentryEventKind.SentryActivated, "TsColorInfoBrush", SentryEventSeverity.Info)]
    [InlineData(SentryEventKind.SentryDeactivated, "TsColorTextMutedBrush", SentryEventSeverity.Info)]
    [InlineData(SentryEventKind.Locked, "TsColorSuccessBrush", SentryEventSeverity.Info)]
    [InlineData(SentryEventKind.Unlocked, "TsColorDangerBrush", SentryEventSeverity.Critical)]
    [InlineData(SentryEventKind.StateUpdated, "TsColorAccentBrush", SentryEventSeverity.Info)]
    public void Presentation_maps_kind_to_token_and_severity(
        SentryEventKind kind, string brushKey, SentryEventSeverity severity)
    {
        var presentation = SentryEventLogProjection.Presentation(kind);

        Assert.Equal(brushKey, presentation.AccentBrushKey);
        Assert.Equal(severity, presentation.Severity);
        Assert.False(string.IsNullOrEmpty(presentation.Glyph));
    }

    // ---- Title / subtitle (i18n) ---------------------------------------------------

    [Fact]
    public void Title_door_open_includes_door_names()
    {
        var ev = Event(doorState: "df open, pf open");
        var title = SentryEventLogProjection.Title(SentryEventKind.DoorOpen, ev, Localizer);

        Assert.Equal("Door open: df open, pf open", title);
    }

    [Theory]
    [InlineData(SentryEventKind.SentryActivated, "Sentry Mode activated")]
    [InlineData(SentryEventKind.SentryDeactivated, "Sentry Mode deactivated")]
    [InlineData(SentryEventKind.Locked, "Vehicle locked")]
    [InlineData(SentryEventKind.Unlocked, "Vehicle unlocked")]
    [InlineData(SentryEventKind.StateUpdated, "Security state updated")]
    public void Title_resolves_each_kind_through_i18n(SentryEventKind kind, string expected) =>
        Assert.Equal(expected, SentryEventLogProjection.Title(kind, Event(), Localizer));

    [Fact]
    public void Subtitle_combines_lock_and_sentry_state()
    {
        var ev = Event(locked: true, sentryMode: true);
        var subtitle = SentryEventLogProjection.Subtitle(ev, Localizer);

        Assert.Equal("\uD83D\uDD12 Locked \u00B7 \uD83D\uDEE1\uFE0F Sentry On", subtitle);
    }

    [Fact]
    public void Subtitle_uses_unlocked_and_sentry_off_words()
    {
        var ev = Event(locked: false, sentryMode: false);
        var subtitle = SentryEventLogProjection.Subtitle(ev, Localizer);

        Assert.Equal("\uD83D\uDD13 Unlocked \u00B7 Sentry Off", subtitle);
    }

    [Fact]
    public void Subtitle_is_em_dash_when_no_signals_present()
    {
        var ev = Event(locked: null, sentryMode: null);
        Assert.Equal("\u2014", SentryEventLogProjection.Subtitle(ev, Localizer));
    }

    // ---- Size / eventLimit (web isWide / isTall) -----------------------------------

    [Theory]
    [InlineData(2, 4, 7)]   // default: tall, not wide
    [InlineData(2, 1, 4)]   // neither
    [InlineData(3, 2, 10)]  // wide
    [InlineData(4, 40, 10)] // wide (max)
    public void Size_row_budget_matches_web(int cols, int rows, int expected) =>
        Assert.Equal(expected, new SentryEventLogSize(cols, rows).MaxItems);

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_row_budget()
    {
        var events = new List<SentryLogEvent>();
        for (int i = 0; i < 10; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero);
            events.Add(Event(id: i, createdAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var rows = SentryEventLogProjection.Project(events, new SentryEventLogSize(2, 4), Localizer, Now);

        Assert.Equal(7, rows.Count);                // 2x4 budget = 7 (tall, not wide)
        Assert.Equal("9", rows[0].Key);             // newest first
        Assert.Equal("3", rows[^1].Key);            // 7 newest of 0..9 -> keys 9..3
    }

    [Fact]
    public void Project_includes_subtitle_only_when_wide()
    {
        var ev = Event(locked: true, sentryMode: true);

        var narrow = SentryEventLogProjection.Project([ev], new SentryEventLogSize(2, 4), Localizer, Now)[0];
        var wide = SentryEventLogProjection.Project([ev], new SentryEventLogSize(3, 4), Localizer, Now)[0];

        Assert.Null(narrow.Subtitle);
        Assert.False(string.IsNullOrEmpty(wide.Subtitle));
    }

    [Fact]
    public void Project_resolves_presentation_and_relative_time()
    {
        var row = SentryEventLogProjection.Project([Event(locked: false)], SentryEventLogSize.Default, Localizer, Now)[0];

        Assert.Equal(SentryEventKind.Unlocked, row.Kind);
        Assert.Equal(SentryEventSeverity.Critical, row.Severity);
        Assert.Equal("TsColorDangerBrush", row.AccentBrushKey);
        Assert.Equal("Vehicle unlocked", row.Title);
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = SentryEventLogProjection.Project([Event(locked: true)], SentryEventLogSize.Default, Localizer, Now)[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Vehicle locked", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"locked":false,"created_at":"2026-06-06T12:00:00Z"}]""");

        var cached = SentryEventLogResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SentryEventLogResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = SentryEventLogResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = SentryEventLogResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Loading, vm.State);
        Assert.False(vm.HasRows);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Event(id: 1, locked: true), Event(id: 2, sentryMode: true)));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Loaded, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal(2, vm.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SentryLogEvent>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Equal("No security events recorded", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Cached(new[] { Event(locked: true) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SentryLogEvent>>.OfflineCached(
            new[] { Event(locked: true) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Offline, vm.State);
        Assert.True(vm.HasRows);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loading(),
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Cached(new[] { Event(id: 1, locked: true) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loaded(new[] { Event(id: 1, locked: true), Event(id: 2, sentryMode: true) }, Now));
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Loaded, vm.State);
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_subtitle()
    {
        using var vm = NewViewModel(
            new SentryEventLogSize(2, 4),
            RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loaded(new[] { Event(locked: true, sentryMode: true) }, Now));
        await vm.LoadAsync();
        Assert.Null(vm.Rows[0].Subtitle); // narrow -> no subtitle

        vm.Size = new SentryEventLogSize(3, 4);
        Assert.False(string.IsNullOrEmpty(vm.Rows[0].Subtitle)); // wide -> subtitle
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SentryLogEvent>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Sentry Event Log", vm.Title);
        Assert.Equal("No security events recorded", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state()
    {
        using var vm = NewViewModel(Loaded(Event(locked: true)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SentryEventLogViewModel.State), changed);
        Assert.Contains(nameof(SentryEventLogViewModel.Rows), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("sentry-event-log", SentryEventLogRegistration.Id);
        Assert.Equal("security", SentryEventLogRegistration.Category);
        Assert.Equal("SentryEventLogWidget", SentryEventLogRegistration.Slug);
        Assert.Equal(new SentryEventLogSize(2, 4), SentryEventLogRegistration.DefaultSize);
        Assert.Equal(new SentryEventLogSize(2, 4), SentryEventLogRegistration.MinSize);
        Assert.Equal(new SentryEventLogSize(4, 40), SentryEventLogRegistration.MaxSize);
        Assert.Equal("Sentry Event Log", SentryEventLogRegistration.Name(Localizer));
        Assert.Contains("sentry", SentryEventLogRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SentryEventLogRegistration.IsWithinBounds(new SentryEventLogSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SentryEventLogSize(2, 4), SentryEventLogRegistration.Clamp(new SentryEventLogSize(1, 1)));
        Assert.Equal(new SentryEventLogSize(4, 40), SentryEventLogRegistration.Clamp(new SentryEventLogSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SentryEventLogDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SentryEventLogWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shape + cached -> projection ----------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SentryEventLogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_with_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"locked":false,"created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SentryEventLogSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SentryEventLogSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_projection_classifies_parsed_payload()
    {
        // cached -> projection: an unlocked snapshot resolves to the Unlocked row via the view-model.
        using var doc = JsonDocument.Parse("""[{"id":1,"locked":false,"created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SentryEventLogSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        using var vm = new SentryEventLogViewModel(source, Localizer, SentryEventLogSize.Default, () => Now);
        await vm.LoadAsync();

        Assert.Equal(SentryEventLogState.Loaded, vm.State);
        var row = Assert.Single(vm.Rows);
        Assert.Equal(SentryEventKind.Unlocked, row.Kind);
        Assert.Equal("Vehicle unlocked", row.Title);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<IReadOnlyList<SentryLogEvent>> Loaded(params SentryLogEvent[] events) =>
        RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loaded(events, Now);

    private static SentryEventLogViewModel NewViewModel(params RepositoryResult<IReadOnlyList<SentryLogEvent>>[] emissions) =>
        NewViewModel(SentryEventLogSize.Default, emissions);

    private static SentryEventLogViewModel NewViewModel(
        SentryEventLogSize size,
        params RepositoryResult<IReadOnlyList<SentryLogEvent>>[] emissions) =>
        new(new FakeSentryEventLogSource(emissions), Localizer, size, () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<SentryLogEvent>>>> Drain(ISentryEventLogSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SentryLogEvent>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSentryEventLogSource(params RepositoryResult<IReadOnlyList<SentryLogEvent>>[] emissions) : ISentryEventLogSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SentryLogEvent>>> StreamAsync(
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
