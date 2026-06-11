using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the <c>NotificationBellPopover</c> surface's UI-thread-free logic — the JSON
/// adapters (snake_case + camelCase, null-tolerant), the per-state projection (loading / loaded / empty /
/// error / stale / offline via the view-model), the severity classification + rule/vehicle join, the
/// count-driven subtitle / trigger label / badge, the i18n key resolution, the per-row + per-panel accessible
/// names, the mark-all-read + navigation flows, the PII-safe diagnostics and the generated operation-id
/// resolution. Mirrors the web spec (web/src/components/layout/NotificationBellPopover.tsx). The WinUI view
/// itself (NotificationBellPopover.cs) is exercised by the app build.
/// </summary>
public sealed class NotificationBellPopoverTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private static readonly NotificationBellLabels Labels = NotificationBellLabels.Resolve(Localizer);

    // ── JSON adapters: cached body → model (snake_case + camelCase, null-tolerant) ──────────────────────

    [Fact]
    public void Notification_parses_snake_case()
    {
        const string json = """
            { "id": 7, "alert_id": 42, "title": "Battery low", "message": "12%",
              "created_at": "2026-06-09T11:00:00Z" }
            """;
        BellNotification? note = BellNotification.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.NotNull(note);
        Assert.Equal(7, note!.Id);
        Assert.Equal(42, note.AlertId);
        Assert.Equal("Battery low", note.Title);
        Assert.Equal("12%", note.Message);
        Assert.Equal(DateTimeOffset.Parse("2026-06-09T11:00:00Z", System.Globalization.CultureInfo.InvariantCulture), note.CreatedAt);
    }

    [Fact]
    public void Notification_falls_back_to_camel_case()
    {
        const string json = """{ "id": 8, "alertId": 9, "title": "T", "message": "M", "createdAt": "2026-06-09T10:00:00Z" }""";
        BellNotification? note = BellNotification.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.NotNull(note);
        Assert.Equal(9, note!.AlertId);
        Assert.Equal("T", note.Title);
    }

    [Fact]
    public void Notification_without_id_is_dropped()
    {
        BellNotification? note = BellNotification.FromJson(JsonDocument.Parse("""{ "title": "no id" }""").RootElement);
        Assert.Null(note);
    }

    [Fact]
    public void Notification_non_object_is_dropped()
    {
        BellNotification? note = BellNotification.FromJson(JsonDocument.Parse("123").RootElement);
        Assert.Null(note);
    }

    [Fact]
    public void NotificationArray_skips_malformed_rows()
    {
        const string json = """[ { "id": 1, "title": "ok" }, { "title": "no id" }, 42, { "id": 2 } ]""";
        IReadOnlyList<BellNotification> notes = BellNotification.FromJsonArray(JsonDocument.Parse(json).RootElement);

        Assert.Equal(2, notes.Count);
        Assert.Equal(1, notes[0].Id);
        Assert.Equal(2, notes[1].Id);
    }

    [Fact]
    public void AlertRule_map_keys_by_id_and_reads_severity_and_vehicle()
    {
        const string json = """
            [ { "id": 5, "name": "Low battery", "severity": "critical", "vehicle_id": 99 },
              { "id": 6, "name": "Door", "severity": "warn", "vehicleId": 100 } ]
            """;
        IReadOnlyDictionary<long, BellAlertRule> map = BellAlertRule.MapFromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal(2, map.Count);
        Assert.Equal("critical", map[5].Severity);
        Assert.Equal(99, map[5].VehicleId);
        Assert.Equal(100, map[6].VehicleId);
    }

    [Fact]
    public void Vehicle_map_reads_display_name()
    {
        const string json = """[ { "id": 99, "display_name": "Model 3" }, { "id": 100, "displayName": "Model Y" } ]""";
        IReadOnlyDictionary<long, BellVehicle> map = BellVehicle.MapFromJson(JsonDocument.Parse(json).RootElement);

        Assert.Equal("Model 3", map[99].DisplayName);
        Assert.Equal("Model Y", map[100].DisplayName);
    }

    // ── Severity classification (web severityOf) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, BellSeverity.Info)]
    [InlineData("info", BellSeverity.Info)]
    [InlineData("warn", BellSeverity.Warn)]
    [InlineData("critical", BellSeverity.Critical)]
    [InlineData("bogus", BellSeverity.Info)]
    public void SeverityOf_classifies_like_web(string? severity, BellSeverity expected)
    {
        BellAlertRule rule = new(1, "R", severity, null);
        Assert.Equal(expected, NotificationBellProjection.SeverityOf(rule));
    }

    [Fact]
    public void SeverityOf_null_rule_is_info() =>
        Assert.Equal(BellSeverity.Info, NotificationBellProjection.SeverityOf(null));

    // ── Row projection: title fallback, vehicle join, message, relative time, accessible name ───────────

    [Fact]
    public void Row_joins_severity_and_vehicle()
    {
        var notes = new[] { new BellNotification(1, 5, "Battery low", "Down to 12%", Now.AddMinutes(-5)) };
        var rules = new Dictionary<long, BellAlertRule> { [5] = new(5, "Battery rule", "critical", 99) };
        var vehicles = new Dictionary<long, BellVehicle> { [99] = new(99, "Garage Tesla") };

        BellRow row = NotificationBellProjection.BuildRows(new NotificationBellPreview(notes, rules, vehicles), Labels, Now)[0];

        Assert.Equal("Battery low", row.Title);
        Assert.Equal("Down to 12%", row.Message);
        Assert.Equal(BellSeverity.Critical, row.Severity);
        Assert.Equal("Critical", row.SeverityLabel);
        Assert.Equal("Garage Tesla", row.VehicleName);
        Assert.Equal("5m ago", row.RelativeTime);
        Assert.Contains("Critical", row.AccessibleName, StringComparison.Ordinal);
        Assert.Contains("Battery low", row.AccessibleName, StringComparison.Ordinal);
        Assert.Contains("Garage Tesla", row.AccessibleName, StringComparison.Ordinal);
    }

    [Fact]
    public void Row_title_falls_back_to_rule_name_then_untitled()
    {
        var rules = new Dictionary<long, BellAlertRule> { [5] = new(5, "The rule name", "info", null) };
        BellRow fromRule = NotificationBellProjection.BuildRows(
            new NotificationBellPreview(new[] { new BellNotification(1, 5, "", "", Now) }, rules, Empty<BellVehicle>()),
            Labels, Now)[0];
        Assert.Equal("The rule name", fromRule.Title);

        BellRow untitled = NotificationBellProjection.BuildRows(
            new NotificationBellPreview(new[] { new BellNotification(2, null, "", "", Now) }, Empty<BellAlertRule>(), Empty<BellVehicle>()),
            Labels, Now)[0];
        Assert.Equal("Notification", untitled.Title);
    }

    [Fact]
    public void Row_message_is_null_when_blank()
    {
        BellRow row = NotificationBellProjection.BuildRows(
            new NotificationBellPreview(new[] { new BellNotification(1, null, "T", "", Now) }, Empty<BellAlertRule>(), Empty<BellVehicle>()),
            Labels, Now)[0];
        Assert.Null(row.Message);
    }

    [Fact]
    public void Row_vehicle_name_falls_back_to_hash_id_and_is_null_without_rule()
    {
        var rules = new Dictionary<long, BellAlertRule> { [5] = new(5, "R", "info", 99) };
        var vehicles = new Dictionary<long, BellVehicle> { [99] = new(99, "") };
        BellRow hashed = NotificationBellProjection.BuildRows(
            new NotificationBellPreview(new[] { new BellNotification(1, 5, "T", "M", Now) }, rules, vehicles), Labels, Now)[0];
        Assert.Equal("#99", hashed.VehicleName);

        BellRow noVehicle = NotificationBellProjection.BuildRows(
            new NotificationBellPreview(new[] { new BellNotification(2, null, "T", "M", Now) }, Empty<BellAlertRule>(), Empty<BellVehicle>()),
            Labels, Now)[0];
        Assert.Null(noVehicle.VehicleName);
    }

    // ── Count-driven chrome (subtitle / trigger label / badge) ──────────────────────────────────────────

    [Fact]
    public void Subtitle_interpolates_count_or_shows_all_caught_up()
    {
        Assert.Equal("3 unread", NotificationBellProjection.Subtitle(3, Localizer));
        Assert.Equal("All caught up", NotificationBellProjection.Subtitle(0, Localizer));
    }

    [Fact]
    public void TriggerLabel_is_count_aware()
    {
        Assert.Equal("4 unread notifications", NotificationBellProjection.TriggerLabel(4, Localizer));
        Assert.Equal("Notifications", NotificationBellProjection.TriggerLabel(0, Localizer));
    }

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "5")]
    [InlineData(99, "99")]
    [InlineData(100, "99+")]
    [InlineData(1500, "99+")]
    public void BadgeText_caps_at_99_plus(int count, string expected) =>
        Assert.Equal(expected, NotificationBellProjection.BadgeText(count));

    // ── Projection: panel accessible name + mark-all enablement ─────────────────────────────────────────

    [Fact]
    public void Projection_panel_name_and_subtitle_present()
    {
        NotificationBellDisplay display = NotificationBellProjection.Project(
            NotificationBellState.Loaded, OneRowPreview(), 3, markAllReadPending: false, Labels, Localizer, Now);

        Assert.Equal(NotificationBellState.Loaded, display.State);
        Assert.Equal("3 unread", display.Subtitle);
        Assert.Contains("Notifications", display.PanelAutomationName, StringComparison.Ordinal);
        Assert.Contains("3 unread", display.PanelAutomationName, StringComparison.Ordinal);
        Assert.True(display.HasRows);
        Assert.True(display.MarkAllReadEnabled);
    }

    [Fact]
    public void Projection_mark_all_disabled_when_pending_or_no_rows()
    {
        NotificationBellDisplay pending = NotificationBellProjection.Project(
            NotificationBellState.Loaded, OneRowPreview(), 1, markAllReadPending: true, Labels, Localizer, Now);
        Assert.False(pending.MarkAllReadEnabled);

        NotificationBellDisplay empty = NotificationBellProjection.Project(
            NotificationBellState.Empty, NotificationBellPreview.Empty, 0, markAllReadPending: false, Labels, Localizer, Now);
        Assert.False(empty.MarkAllReadEnabled);
        Assert.False(empty.HasRows);
    }

    // ── View-model state machine across every state ─────────────────────────────────────────────────────

    [Fact]
    public async Task Count_stream_sets_badge()
    {
        var source = new FakeSource();
        source.CountResults.Add(RepositoryResult<int>.Loading());
        source.CountResults.Add(RepositoryResult<int>.Loaded(7, Now));
        using var vm = NewViewModel(source);

        await vm.StartCountAsync();

        Assert.Equal(7, vm.UnreadCount);
        Assert.True(vm.HasUnread);
        Assert.Equal("7", vm.BadgeText);
        Assert.Equal("7 unread notifications", vm.TriggerLabel);
    }

    [Fact]
    public async Task StartCount_is_idempotent()
    {
        var source = new FakeSource();
        source.CountResults.Add(RepositoryResult<int>.Loaded(1, Now));
        using var vm = NewViewModel(source);

        await vm.StartCountAsync();
        await vm.StartCountAsync();

        Assert.Equal(1, source.CountCalls);
    }

    [Fact]
    public async Task Preview_loaded_projects_rows()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loading());
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loaded(TwoRowPreview(), Now));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();

        Assert.Equal(NotificationBellState.Loaded, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.True(vm.IsOpen);
    }

    [Fact]
    public async Task Preview_empty_state()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loading());
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Empty(Now));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();

        Assert.Equal(NotificationBellState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
    }

    [Fact]
    public async Task Preview_error_state()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loading());
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Failure(
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();

        Assert.Equal(NotificationBellState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("offline", vm.ErrorMessage);
    }

    [Fact]
    public async Task Preview_stale_state()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Cached(TwoRowPreview(), Now.AddHours(-1), stale: true));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();

        Assert.Equal(NotificationBellState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task Preview_offline_state_keeps_cached_content()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.OfflineCached(
            TwoRowPreview(), Now.AddMinutes(-30), new RepositoryError(RepositoryErrorKind.Network, "no net")));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();

        Assert.Equal(NotificationBellState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task Retry_reloads_preview()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Failure(
            new RepositoryError(RepositoryErrorKind.Network, "x")));
        using var vm = NewViewModel(source);

        await vm.OpenAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.PreviewCalls);
        Assert.True(vm.Attempts >= 2);
    }

    // ── Trigger + navigation flows ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Trigger_on_compact_viewport_navigates_to_inbox()
    {
        using var vm = NewViewModel(new FakeSource());
        string? navigated = null;
        vm.NavigateRequested += (_, e) => navigated = e.Route;
        vm.IsMobile = true;

        NotificationBellTriggerAction action = vm.OnTriggerInvoked();

        Assert.Equal(NotificationBellTriggerAction.NavigateInbox, action);
        Assert.Equal("/notifications/inbox", navigated);
    }

    [Fact]
    public void Trigger_on_desktop_opens_popover()
    {
        using var vm = NewViewModel(new FakeSource());
        bool navigated = false;
        vm.NavigateRequested += (_, _) => navigated = true;
        vm.IsMobile = false;

        Assert.Equal(NotificationBellTriggerAction.OpenPopover, vm.OnTriggerInvoked());
        Assert.False(navigated);
    }

    [Fact]
    public void NavigateToInbox_raises_navigate_and_close()
    {
        using var vm = NewViewModel(new FakeSource());
        string? navigated = null;
        bool closed = false;
        vm.NavigateRequested += (_, e) => navigated = e.Route;
        vm.CloseRequested += (_, _) => closed = true;

        vm.NavigateToInbox();

        Assert.Equal("/notifications/inbox", navigated);
        Assert.True(closed);
    }

    [Fact]
    public void Close_marks_closed()
    {
        using var vm = NewViewModel(new FakeSource());
        vm.Close();
        Assert.False(vm.IsOpen);
    }

    // ── Mark-all-read ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MarkAllRead_invokes_command_and_refreshes()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loaded(TwoRowPreview(), Now));
        source.CountResults.Add(RepositoryResult<int>.Loaded(2, Now));
        var commands = new FakeCommands();
        using var vm = NewViewModel(source, commands);

        await vm.OpenAsync();
        int previewCallsBefore = source.PreviewCalls;
        await vm.MarkAllReadAsync();

        Assert.Equal(1, commands.MarkAllReadCalls);
        Assert.True(source.PreviewCalls > previewCallsBefore);
        Assert.True(source.CountCalls >= 1);
        Assert.False(vm.MarkAllReadPending);
    }

    [Fact]
    public async Task MarkAllRead_is_noop_without_rows()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Empty(Now));
        var commands = new FakeCommands();
        using var vm = NewViewModel(source, commands);

        await vm.OpenAsync();
        await vm.MarkAllReadAsync();

        Assert.Equal(0, commands.MarkAllReadCalls);
    }

    [Fact]
    public async Task MarkAllRead_failure_resets_pending()
    {
        var source = new FakeSource();
        source.PreviewResults.Add(RepositoryResult<NotificationBellPreview>.Loaded(TwoRowPreview(), Now));
        var commands = new FakeCommands { ShouldThrow = true };
        using var vm = NewViewModel(source, commands);

        await vm.OpenAsync();
        await vm.MarkAllReadAsync();

        Assert.False(vm.MarkAllReadPending);
        Assert.Equal(1, commands.MarkAllReadCalls);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new NotificationBellDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(sink, line => Assert.Equal("view.opened slug=NotificationBellPopover", line));
    }

    // ── i18n: every web key resolves through the facade ─────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_every_web_key_through_facade()
    {
        var recorder = new RecordingLocalizer();
        _ = NotificationBellLabels.Resolve(recorder);

        Assert.Contains("notifications.bellPopover.title", recorder.Keys);
        Assert.Contains("notifications.bellPopover.loading", recorder.Keys);
        Assert.Contains("notifications.bellPopover.error", recorder.Keys);
        Assert.Contains("notifications.bellPopover.emptyTitle", recorder.Keys);
        Assert.Contains("notifications.bellPopover.emptyMessage", recorder.Keys);
        Assert.Contains("notifications.bellPopover.untitled", recorder.Keys);
        Assert.Contains("notifications.bellPopover.markAllRead", recorder.Keys);
        Assert.Contains("notifications.bellPopover.viewAll", recorder.Keys);
        Assert.Contains("common.close", recorder.Keys);
    }

    [Fact]
    public void Subtitle_and_trigger_resolve_count_keys_through_facade()
    {
        var recorder = new RecordingLocalizer();
        _ = NotificationBellProjection.Subtitle(2, recorder);
        _ = NotificationBellProjection.Subtitle(0, recorder);
        _ = NotificationBellProjection.TriggerLabel(2, recorder);
        _ = NotificationBellProjection.TriggerLabel(0, recorder);

        Assert.Contains("notifications.bellPopover.unreadCount", recorder.Keys);
        Assert.Contains("notifications.bellPopover.allRead", recorder.Keys);
        Assert.Contains("nav.notificationsUnread", recorder.Keys);
        Assert.Contains("nav.notifications", recorder.Keys);
    }

    // ── Registration: operation ids resolve against the generated endpoint table (web hook → route) ──────

    [Theory]
    [InlineData(NotificationBellRegistration.UnreadCountOperation, "/notifications/unread-count")]
    [InlineData(NotificationBellRegistration.LogsOperation, "/notifications/logs")]
    [InlineData(NotificationBellRegistration.AlertRulesOperation, "/alerts/rules")]
    [InlineData(NotificationBellRegistration.VehiclesOperation, "/vehicles/")]
    [InlineData(NotificationBellRegistration.MarkReadOperation, "/notifications/mark-read")]
    public void Operation_ids_resolve_to_expected_path(string operationId, string expectedPath)
    {
        GeneratedApi.EndpointDescriptor? descriptor =
            GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == operationId);

        Assert.True(descriptor is not null, $"Operation '{operationId}' is not in the generated endpoint table.");
        Assert.Equal(expectedPath, descriptor!.Path);
    }

    [Fact]
    public void Registration_exposes_slug_and_inbox_route()
    {
        Assert.Equal("NotificationBellPopover", NotificationBellRegistration.Slug);
        Assert.Equal("/notifications/inbox", NotificationBellRegistration.InboxRoute);
        Assert.Equal(10, NotificationBellRegistration.PreviewLimit);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────

    private static NotificationBellPopoverViewModel NewViewModel(
        FakeSource source,
        INotificationBellCommands? commands = null) =>
        new(source, commands ?? new FakeCommands(), Localizer, () => Now);

    private static IReadOnlyDictionary<long, T> Empty<T>() => new Dictionary<long, T>();

    private static NotificationBellPreview OneRowPreview() => new(
        new[] { new BellNotification(1, null, "One", "Body", Now.AddMinutes(-2)) },
        Empty<BellAlertRule>(),
        Empty<BellVehicle>());

    private static NotificationBellPreview TwoRowPreview() => new(
        new[]
        {
            new BellNotification(1, null, "One", "Body", Now.AddMinutes(-2)),
            new BellNotification(2, null, "Two", "Body", Now.AddMinutes(-8)),
        },
        Empty<BellAlertRule>(),
        Empty<BellVehicle>());

    private sealed class FakeSource : INotificationBellSource
    {
        public List<RepositoryResult<int>> CountResults { get; } = new();

        public List<RepositoryResult<NotificationBellPreview>> PreviewResults { get; } = new();

        public int CountCalls { get; private set; }

        public int PreviewCalls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<int>> StreamUnreadCountAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            CountCalls++;
            await Task.CompletedTask.ConfigureAwait(false);
            foreach (RepositoryResult<int> result in CountResults)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }
        }

        public async IAsyncEnumerable<RepositoryResult<NotificationBellPreview>> StreamPreviewAsync(
            int limit,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            PreviewCalls++;
            await Task.CompletedTask.ConfigureAwait(false);
            foreach (RepositoryResult<NotificationBellPreview> result in PreviewResults)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }
        }
    }

    private sealed class FakeCommands : INotificationBellCommands
    {
        public int MarkAllReadCalls { get; private set; }

        public bool ShouldThrow { get; init; }

        public Task MarkAllReadAsync(CancellationToken cancellationToken = default)
        {
            MarkAllReadCalls++;
            return ShouldThrow
                ? throw new InvalidOperationException("mark-all-read failed")
                : Task.CompletedTask;
        }
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
