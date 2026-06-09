using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the GuardModeWidget's UI-thread-free logic — the config/event parse adapters,
/// the projection (compact/standard derivation, the sensitivity line, the newest-first sort + cap, the
/// event severity/label/acknowledgement mapping, the a11y automation names), the cache-then-network combine
/// mapper (the config gate + freshness folding), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/GuardModeWidget.tsx + api/hooks/useGuard.ts).
/// </summary>
public sealed class GuardModeWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static GuardModeConfig Config(
        bool enabled = true,
        string? sensitivity = "medium",
        bool autoPanic = false,
        long vehicleId = 7) =>
        new(VehicleId: vehicleId, Enabled: enabled, Sensitivity: sensitivity, AutoPanic: autoPanic, HomeGeofenceId: null);

    private static GuardModeEvent Event(
        long id,
        string type = "sentry_triggered",
        string? ts = "2026-06-06T12:00:00Z",
        bool acknowledged = false) =>
        new(
            Id: id,
            VehicleId: 7,
            Ts: ts,
            EventType: type,
            FromState: null,
            ToState: null,
            AcknowledgedAt: acknowledged ? "2026-06-06T12:01:00Z" : null,
            AcknowledgedBy: acknowledged ? "user@example.com" : null);

    private static GuardModeSnapshot Snapshot(GuardModeConfig? config, params GuardModeEvent[] events) =>
        new(config, events);

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    // ---- Config parse adapter (web GuardConfig) ------------------------------------

    [Fact]
    public void Config_FromJson_reads_snake_case_fields()
    {
        var config = GuardModeConfig.FromJson(Json("""
        {"vehicle_id":7,"enabled":true,"home_geofence_id":42,"sensitivity":"high","auto_panic":true,
         "created_at":"2026-06-01T00:00:00Z","updated_at":"2026-06-02T00:00:00Z"}
        """));

        Assert.NotNull(config);
        Assert.Equal(7, config!.VehicleId);
        Assert.True(config.Enabled);
        Assert.Equal("high", config.Sensitivity);
        Assert.True(config.AutoPanic);
        Assert.Equal(42, config.HomeGeofenceId);
    }

    [Fact]
    public void Config_FromJson_is_tolerant_of_missing_fields()
    {
        var config = GuardModeConfig.FromJson(Json("""{"vehicle_id":7}"""));

        Assert.NotNull(config);
        Assert.False(config!.Enabled);   // default
        Assert.Null(config.Sensitivity); // default
        Assert.False(config.AutoPanic);  // default
        Assert.Null(config.HomeGeofenceId);
    }

    [Fact]
    public void Config_FromJson_returns_null_for_non_object()
    {
        Assert.Null(GuardModeConfig.FromJson(Json("null")));
        Assert.Null(GuardModeConfig.FromJson(Json("[]")));
    }

    // ---- Event parse adapter (web safeArray(data?.events)) -------------------------

    [Fact]
    public void Event_ParseEnvelope_reads_events_array()
    {
        var events = GuardModeEvent.ParseEnvelope(Json("""
        {"vehicle_id":7,"events":[
          {"id":1,"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","event_type":"manual_panic",
           "acknowledged_at":"2026-06-06T12:01:00Z","acknowledged_by":"u"},
          {"id":2,"vehicle_id":7,"ts":"2026-06-06T11:00:00Z","event_type":"sentry_triggered"}]}
        """));

        Assert.Equal(2, events.Count);
        Assert.Equal(1, events[0].Id);
        Assert.Equal("manual_panic", events[0].EventType);
        Assert.True(events[0].IsAcknowledged);
        Assert.False(events[1].IsAcknowledged);
        Assert.NotNull(events[0].Timestamp);
    }

    [Fact]
    public void Event_ParseEnvelope_returns_empty_for_bare_array_or_missing_events()
    {
        // Web parity: safeArray(data?.events) — a bare array has no `.events`, so it yields no rows.
        Assert.Empty(GuardModeEvent.ParseEnvelope(Json("[{\"id\":1}]")));
        Assert.Empty(GuardModeEvent.ParseEnvelope(Json("""{"vehicle_id":7}""")));
        Assert.Empty(GuardModeEvent.ParseEnvelope(Json("null")));
    }

    // ---- Size / maxItems (web isCompact / maxItems) --------------------------------

    [Theory]
    [InlineData(1, 2, true, 3)]   // min: compact
    [InlineData(2, 4, false, 5)]  // default: standard
    [InlineData(4, 40, false, 5)] // max: standard
    public void Size_branch_and_feed_cap_match_web(int cols, int rows, bool compact, int maxItems)
    {
        var size = new GuardModeSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(maxItems, size.MaxItems);
    }

    // ---- Projection: status card derivation ----------------------------------------

    [Fact]
    public void Project_armed_config_resolves_status_and_badge()
    {
        var display = GuardModeProjection.Project(
            Snapshot(Config(enabled: true, sensitivity: "medium", autoPanic: true)),
            GuardModeSize.Default,
            Localizer,
            Now);

        Assert.True(display.Enabled);
        Assert.False(display.IsCompact);
        Assert.Equal("Armed", display.StatusLabel);
        Assert.Equal("ON", display.StatusBadgeLabel);
        Assert.Contains("Sensitivity: medium", display.SubtitleLine, StringComparison.Ordinal);
        Assert.Contains("Auto-panic", display.SubtitleLine, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_disarmed_config_omits_auto_panic_and_reads_off()
    {
        var display = GuardModeProjection.Project(
            Snapshot(Config(enabled: false, sensitivity: "low", autoPanic: false)),
            GuardModeSize.Default,
            Localizer,
            Now);

        Assert.False(display.Enabled);
        Assert.Equal("Disarmed", display.StatusLabel);
        Assert.Equal("OFF", display.StatusBadgeLabel);
        Assert.Equal("Sensitivity: low", display.SubtitleLine);
        Assert.DoesNotContain("Auto-panic", display.SubtitleLine, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_sensitivity()
    {
        var display = GuardModeProjection.Project(
            Snapshot(Config(sensitivity: null)),
            GuardModeSize.Default,
            Localizer,
            Now);

        Assert.Equal("\u2014", display.Sensitivity);
        Assert.Equal("Sensitivity: \u2014", display.SubtitleLine);
    }

    [Fact]
    public void Project_event_count_label_and_warning_flag()
    {
        var none = GuardModeProjection.Project(Snapshot(Config()), GuardModeSize.Default, Localizer, Now);
        Assert.Equal("0 events", none.EventCountLabel);
        Assert.False(none.HasEvents);

        var some = GuardModeProjection.Project(
            Snapshot(Config(), Event(1), Event(2)),
            GuardModeSize.Default,
            Localizer,
            Now);
        Assert.Equal("2 events", some.EventCountLabel);
        Assert.True(some.HasEvents);
        Assert.Equal(2, some.EventCount);
    }

    // ---- Projection: event feed (web WidgetEventFeed mapping) -----------------------

    [Fact]
    public void Project_feed_sorts_newest_first_and_caps_to_row_budget()
    {
        var events = new List<GuardModeEvent>();
        for (int i = 0; i < 6; i++)
        {
            // i=0 oldest … i=5 newest
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero);
            events.Add(Event(i, ts: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var standard = GuardModeProjection.Project(
            new GuardModeSnapshot(Config(), events),
            new GuardModeSize(2, 4),
            Localizer,
            Now);
        Assert.Equal(5, standard.FeedItems.Count);   // standard cap = 5
        Assert.Equal(5, standard.FeedItems[0].Id);   // newest first
        Assert.Equal(6, standard.EventCount);         // count is uncapped

        var compact = GuardModeProjection.Project(
            new GuardModeSnapshot(Config(), events),
            new GuardModeSize(1, 2),
            Localizer,
            Now);
        Assert.Equal(3, compact.FeedItems.Count);     // compact cap = 3
    }

    [Theory]
    [InlineData("unauthorized_unlock", SeverityLevel.Critical, "Unauthorized Unlock")]
    [InlineData("manual_panic", SeverityLevel.Critical, "Panic Alert")]
    [InlineData("sentry_triggered", SeverityLevel.Warn, "Sentry Triggered")]
    [InlineData("test_alert", SeverityLevel.Info, "Test Alert")]
    public void Project_maps_known_event_type_to_severity_and_label(string type, SeverityLevel severity, string label)
    {
        var item = GuardModeProjection.Project(
            Snapshot(Config(), Event(1, type: type)),
            GuardModeSize.Default,
            Localizer,
            Now).FeedItems[0];

        Assert.Equal(severity, item.Severity);
        Assert.Equal(label, item.Title);
        Assert.Equal(SeverityLevels.Tokens(severity).IconGlyph, item.Glyph);
        Assert.Equal(SeverityLevels.Tokens(severity).AccentBrushKey, item.AccentBrushKey);
    }

    [Fact]
    public void Project_unknown_event_type_falls_back_to_info_and_raw_label()
    {
        var item = GuardModeProjection.Project(
            Snapshot(Config(), Event(1, type: "mystery_signal")),
            GuardModeSize.Default,
            Localizer,
            Now).FeedItems[0];

        Assert.Equal(SeverityLevel.Info, item.Severity);
        Assert.Equal("mystery_signal", item.Title);
    }

    [Fact]
    public void Project_feed_subtitle_reflects_acknowledgement()
    {
        var display = GuardModeProjection.Project(
            Snapshot(Config(), Event(1, ts: "2026-06-06T12:00:00Z", acknowledged: true), Event(2, ts: "2026-06-06T11:00:00Z", acknowledged: false)),
            GuardModeSize.Default,
            Localizer,
            Now);

        Assert.Equal("Acknowledged", display.FeedItems[0].Subtitle);
        Assert.Equal("Unacknowledged", display.FeedItems[1].Subtitle);
    }

    // ---- Accessibility names --------------------------------------------------------

    [Fact]
    public void Project_feed_row_has_non_empty_accessibility_name()
    {
        var item = GuardModeProjection.Project(
            Snapshot(Config(), Event(1, type: "manual_panic", ts: "2026-06-06T12:00:00Z")),
            GuardModeSize.Default,
            Localizer,
            Now).FeedItems[0];

        Assert.False(string.IsNullOrWhiteSpace(item.AutomationName));
        Assert.Contains("Panic Alert", item.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Unacknowledged", item.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", item.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_status_card_has_non_empty_accessibility_name()
    {
        var display = GuardModeProjection.Project(Snapshot(Config(enabled: true)), GuardModeSize.Default, Localizer, Now);

        Assert.False(string.IsNullOrWhiteSpace(display.StatusAutomationName));
        Assert.Contains("Armed", display.StatusAutomationName, StringComparison.Ordinal);
    }

    // ---- Combine mapper (config gate + cache-then-network preservation) -------------

    [Fact]
    public void Combine_stays_loading_until_both_sides_resolve()
    {
        // Web parity: isLoading = configLoading || eventsLoading.
        Assert.Equal(LoadStatus.Loading, GuardModeResultMapper.Combine(null, null).Status);
        Assert.Equal(
            LoadStatus.Loading,
            GuardModeResultMapper.Combine(
                RepositoryResult<JsonElement>.Loaded(Json("""{"enabled":true}"""), Now),
                RepositoryResult<JsonElement>.Loading()).Status);
    }

    [Fact]
    public void Combine_loaded_config_and_events_yields_snapshot()
    {
        var result = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(Json("""{"vehicle_id":7,"enabled":true,"sensitivity":"high"}"""), Now),
            RepositoryResult<JsonElement>.Loaded(Json("""{"events":[{"id":1,"event_type":"locked"}]}"""), Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value!.Config);
        Assert.True(result.Value.Config!.Enabled);
        Assert.Single(result.Value.Events);
    }

    [Fact]
    public void Combine_absent_config_collapses_to_empty()
    {
        // Web parity: with no guard config object the widget shows "No guard data".
        var result = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Loaded(Json("""{"events":[{"id":1,"event_type":"locked"}]}"""), Now));

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Combine_hard_config_failure_collapses_to_error()
    {
        var result = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_preserves_stale_and_offline_with_config_present()
    {
        var config = Json("""{"vehicle_id":7,"enabled":true,"sensitivity":"medium"}""");
        var events = Json("""{"events":[]}""");

        var stale = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(config, Now, stale: true),
            RepositoryResult<JsonElement>.Loaded(events, Now));
        Assert.Equal(LoadStatus.Cached, stale.Status);
        Assert.True(stale.IsStale);
        Assert.NotNull(stale.Value!.Config);

        var offline = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(config, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Loaded(events, Now));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.NotNull(offline.Value!.Config);
    }

    [Fact]
    public void Combine_events_error_with_config_present_still_renders_offline()
    {
        var result = GuardModeResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(Json("""{"vehicle_id":7,"enabled":false}"""), Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "events down")));

        // Web parity: eventsError tints the freshness chip but config still renders the surface.
        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.NotNull(result.Value!.Config);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<GuardModeSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Loading, vm.State);
        Assert.False(vm.HasDisplay);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Config(enabled: true), Event(1), Event(2))));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Loaded, vm.State);
        Assert.True(vm.HasDisplay);
        Assert.Equal("Armed", vm.Display!.StatusLabel);
        Assert.Equal(2, vm.Display.EventCount);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_no_guard_data()
    {
        using var vm = NewViewModel(RepositoryResult<GuardModeSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Empty, vm.State);
        Assert.False(vm.HasDisplay);
        Assert.Equal("No guard data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<GuardModeSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<GuardModeSnapshot>.Cached(Snapshot(Config(), Event(1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasDisplay);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<GuardModeSnapshot>.OfflineCached(
            Snapshot(Config(), Event(1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Offline, vm.State);
        Assert.True(vm.HasDisplay);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<GuardModeSnapshot>.Loading(),
            RepositoryResult<GuardModeSnapshot>.Cached(Snapshot(Config(), Event(1)), Now, stale: false),
            RepositoryResult<GuardModeSnapshot>.Loaded(Snapshot(Config(), Event(1), Event(2)), Now));
        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Loaded, vm.State);
        Assert.Equal(2, vm.Display!.EventCount);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_feed_cap()
    {
        var events = new GuardModeEvent[5];
        for (int i = 0; i < 5; i++)
        {
            events[i] = Event(i, ts: new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero).ToString("o", CultureInfo.InvariantCulture));
        }

        using var vm = NewViewModel(
            new GuardModeSize(2, 4),
            RepositoryResult<GuardModeSnapshot>.Loaded(new GuardModeSnapshot(Config(), events), Now));
        await vm.LoadAsync();
        Assert.Equal(5, vm.Display!.FeedItems.Count); // standard cap

        vm.Size = new GuardModeSize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(3, vm.Display.FeedItems.Count);  // compact cap after reproject
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<GuardModeSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Guard Mode", vm.Title);
        Assert.Equal("No guard data", vm.EmptyMessage);
        Assert.Equal("No guard events", vm.NoEventsMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Config(), Event(1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(GuardModeViewModel.State), changed);
        Assert.Contains(nameof(GuardModeViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("guard-mode", GuardModeRegistration.Id);
        Assert.Equal("security", GuardModeRegistration.Category);
        Assert.Equal("GuardModeWidget", GuardModeRegistration.Slug);
        Assert.Equal(new GuardModeSize(2, 4), GuardModeRegistration.DefaultSize);
        Assert.Equal(new GuardModeSize(1, 2), GuardModeRegistration.MinSize);
        Assert.Equal(new GuardModeSize(4, 40), GuardModeRegistration.MaxSize);
        Assert.Equal("Guard Mode", GuardModeRegistration.Name(Localizer));
        Assert.Contains("panic", GuardModeRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, GuardModeRegistration.IsWithinBounds(new GuardModeSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new GuardModeSize(1, 2), GuardModeRegistration.Clamp(new GuardModeSize(0, 1)));
        Assert.Equal(new GuardModeSize(4, 40), GuardModeRegistration.Clamp(new GuardModeSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GuardModeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GuardModeWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<GuardModeSnapshot> Loaded(GuardModeSnapshot snapshot) =>
        RepositoryResult<GuardModeSnapshot>.Loaded(snapshot, Now);

    private static GuardModeViewModel NewViewModel(params RepositoryResult<GuardModeSnapshot>[] emissions) =>
        NewViewModel(GuardModeSize.Default, emissions);

    private static GuardModeViewModel NewViewModel(
        GuardModeSize size,
        params RepositoryResult<GuardModeSnapshot>[] emissions) =>
        new(new FakeGuardModeSource(emissions), Localizer, size, () => Now);

    private sealed class FakeGuardModeSource(params RepositoryResult<GuardModeSnapshot>[] emissions) : IGuardModeSource
    {
        public async IAsyncEnumerable<RepositoryResult<GuardModeSnapshot>> StreamAsync(
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
