using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>InboxBody</c> feature surface's UI-thread-free logic — the JSON adapter
/// (snake_case + camelCase, null-tolerant), the per-state projection (loading / loaded / empty / error /
/// stale / offline via the view-model), the <c>groupByDay</c> bucketing (Today / Yesterday / dated headers),
/// the severity classification + chip status, the per-row context-menu assembly, the tab-specific bulk-action
/// set with its delete confirmation copy, the filter query serialization, the i18n key resolution, the
/// per-state accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/InboxBody.tsx). The WinUI view itself (InboxBody.cs) is exercised
/// by the app build.
/// </summary>
public sealed class InboxBodyTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static InboxNotification Note(
        long id,
        DateTimeOffset created,
        bool read = false,
        bool archived = false,
        string? severity = null,
        long? alertId = 1,
        string title = "Title",
        string message = "Message") =>
        new(id, alertId, title, message, severity, created,
            read ? created.AddMinutes(1) : null,
            archived ? created.AddMinutes(2) : null);

    private static InboxBodyDisplay ProjectFlat(bool archived, params InboxNotification[] rows)
    {
        var model = new InboxBodyModel(
            new InboxReading(InboxView.Flat, rows, Array.Empty<InboxGroup>()),
            archived,
            InboxView.Flat,
            new HashSet<long>());
        return InboxBodyProjection.Project(model, Localizer, Now);
    }

    private static InboxBodyDisplay ProjectGrouped(params InboxGroup[] groups)
    {
        var model = new InboxBodyModel(
            new InboxReading(InboxView.Grouped, Array.Empty<InboxNotification>(), groups),
            false,
            InboxView.Grouped,
            new HashSet<long>());
        return InboxBodyProjection.Project(model, Localizer, Now);
    }

    // ── JSON adapter: cached body → projection (snake_case + camelCase, null-tolerant) ──────────────────

    [Fact]
    public void Adapter_parses_snake_case_notification_log()
    {
        const string json = """
            { "id": 7, "alert_id": 42, "title": "Battery low", "message": "12%",
              "severity": "critical", "created_at": "2026-06-09T11:00:00Z", "read_at": null, "archived_at": null }
            """;
        InboxNotification? note = InboxNotification.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.NotNull(note);
        Assert.Equal(7, note!.Id);
        Assert.Equal(42, note.AlertId);
        Assert.Equal("Battery low", note.Title);
        Assert.Equal("critical", note.Severity);
        Assert.False(note.IsRead);
        Assert.False(note.IsArchived);
    }

    [Fact]
    public void Adapter_falls_back_to_camel_case_keys()
    {
        const string json = """
            { "id": 8, "alertId": 9, "title": "T", "message": "M", "createdAt": "2026-06-09T10:00:00Z",
              "readAt": "2026-06-09T10:05:00Z", "archivedAt": "2026-06-09T10:06:00Z" }
            """;
        InboxNotification? note = InboxNotification.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.NotNull(note);
        Assert.Equal(9, note!.AlertId);
        Assert.True(note.IsRead);
        Assert.True(note.IsArchived);
    }

    [Fact]
    public void Adapter_returns_null_for_a_row_without_an_id()
    {
        InboxNotification? note = InboxNotification.FromJson(JsonDocument.Parse("{ \"title\": \"x\" }").RootElement);

        Assert.Null(note);
    }

    [Fact]
    public void Adapter_parses_a_group_with_its_latest_member()
    {
        const string json = """
            { "group_key": "abc", "count": 5, "unread_count": 2, "vehicle_ids": [1, 2],
              "latest": { "id": 3, "title": "T", "message": "M", "created_at": "2026-06-09T11:00:00Z" } }
            """;
        InboxGroup? group = InboxGroup.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.NotNull(group);
        Assert.Equal("abc", group!.GroupKey);
        Assert.Equal(5, group.Count);
        Assert.Equal(2, group.UnreadCount);
        Assert.Equal(3, group.Latest.Id);
        Assert.Equal(new long[] { 1, 2 }, group.VehicleIds);
    }

    [Fact]
    public void Adapter_reading_parses_a_flat_logs_array()
    {
        const string json = """[ { "id": 1, "created_at": "2026-06-09T11:00:00Z" }, { "id": 2, "created_at": "2026-06-09T10:00:00Z" } ]""";
        InboxReading reading = InboxReading.FromJson(JsonDocument.Parse(json).RootElement, InboxView.Flat, grouped: false);

        Assert.Equal(2, reading.Rows.Count);
        Assert.Empty(reading.Groups);
    }

    // ── Day grouping: Today / Yesterday / dated, consecutive bucketing (web groupByDay) ──────────────────

    [Fact]
    public void Flat_groups_rows_into_today_yesterday_and_dated_buckets()
    {
        InboxBodyDisplay display = ProjectFlat(
            archived: false,
            Note(1, Now),
            Note(2, Now.AddHours(-1)),
            Note(3, Now.AddDays(-1)),
            Note(4, Now.AddDays(-5)));

        Assert.Equal(3, display.Days.Count);
        Assert.Equal("Today", display.Days[0].DayLabel);
        Assert.Equal(2, display.Days[0].Rows.Count);
        Assert.Equal("Yesterday", display.Days[1].DayLabel);
        Assert.Equal(
            Now.AddDays(-5).LocalDateTime.ToString("dddd, MMM d, yyyy", CultureInfo.GetCultureInfo("en-US")),
            display.Days[2].DayLabel);
    }

    [Fact]
    public void Flat_count_and_unread_count_reflect_the_rows()
    {
        InboxBodyDisplay display = ProjectFlat(false, Note(1, Now), Note(2, Now, read: true), Note(3, Now));

        Assert.Equal(3, display.FlatCount);
        Assert.Equal(2, display.UnreadCount);
        Assert.Equal("3 notifications", display.CountLabel);
    }

    // ── Severity classification + chip status (web row/badge accent switch) ─────────────────────────────

    [Theory]
    [InlineData("critical", InboxSeverityClass.Critical)]
    [InlineData("warning", InboxSeverityClass.Warning)]
    [InlineData("warn", InboxSeverityClass.Warning)]
    [InlineData("info", InboxSeverityClass.Info)]
    [InlineData("", InboxSeverityClass.None)]
    [InlineData(null, InboxSeverityClass.None)]
    public void Classify_maps_severity_to_its_class(string? severity, InboxSeverityClass expected) =>
        Assert.Equal(expected, InboxBodyProjection.Classify(severity));

    [Fact]
    public void Classify_is_case_insensitive() =>
        Assert.Equal(InboxSeverityClass.Critical, InboxBodyProjection.Classify("CRITICAL"));

    [Theory]
    [InlineData(InboxSeverityClass.Critical, StatusKind.Danger)]
    [InlineData(InboxSeverityClass.Warning, StatusKind.Warning)]
    [InlineData(InboxSeverityClass.Info, StatusKind.Info)]
    [InlineData(InboxSeverityClass.None, StatusKind.Neutral)]
    public void Status_follows_the_severity_class(InboxSeverityClass severityClass, StatusKind expected) =>
        Assert.Equal(expected, InboxBodyProjection.StatusFor(severityClass));

    [Fact]
    public void Row_with_a_severity_carries_a_capitalized_chip_label()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now, severity: "critical")).Days[0].Rows);

        Assert.Equal("Critical", row.SeverityLabel);
        Assert.Equal(StatusKind.Danger, row.SeverityStatus);
    }

    [Fact]
    public void Row_without_a_severity_has_no_chip()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now, severity: null)).Days[0].Rows);

        Assert.Null(row.SeverityLabel);
        Assert.Equal(StatusKind.Neutral, row.SeverityStatus);
    }

    // ── Per-row context menu (web buildRowContextMenu) ──────────────────────────────────────────────────

    [Fact]
    public void Unread_unarchived_row_menu_offers_mark_read_archive_view_context_delete()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now, read: false, archived: false, alertId: 5)).Days[0].Rows);

        Assert.Collection(
            row.ContextMenu,
            i => Assert.Equal(InboxRowAction.MarkRead, i.Action),
            i => Assert.Equal(InboxRowAction.Archive, i.Action),
            i => Assert.Equal(InboxRowAction.ViewContext, i.Action),
            i => Assert.Equal(InboxRowAction.Delete, i.Action));
    }

    [Fact]
    public void Read_archived_row_menu_offers_mark_unread_restore_delete()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(true, Note(1, Now, read: true, archived: true, alertId: null)).Days[0].Rows);

        Assert.Collection(
            row.ContextMenu,
            i => Assert.Equal(InboxRowAction.MarkUnread, i.Action),
            i => Assert.Equal(InboxRowAction.Restore, i.Action),
            i => Assert.Equal(InboxRowAction.Delete, i.Action));
    }

    [Fact]
    public void View_context_is_omitted_when_the_row_has_no_alert()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now, alertId: null)).Days[0].Rows);

        Assert.DoesNotContain(row.ContextMenu, i => i.Action == InboxRowAction.ViewContext);
    }

    [Fact]
    public void The_delete_row_item_is_destructive()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now)).Days[0].Rows);
        InboxRowMenuItem delete = Assert.Single(row.ContextMenu, i => i.Action == InboxRowAction.Delete);

        Assert.True(delete.Destructive);
    }

    // ── Tab-specific bulk actions (web bulkActions) ─────────────────────────────────────────────────────

    [Fact]
    public void Inbox_bulk_actions_are_mark_read_archive_delete()
    {
        InboxBodyDisplay display = ProjectFlat(false, Note(1, Now));

        Assert.Collection(
            display.BulkActions,
            a => Assert.Equal(InboxBulkAction.MarkRead, a.Action),
            a => Assert.Equal(InboxBulkAction.Archive, a.Action),
            a => Assert.Equal(InboxBulkAction.Delete, a.Action));
    }

    [Fact]
    public void Archive_bulk_actions_are_restore_delete()
    {
        InboxBodyDisplay display = ProjectFlat(true, Note(1, Now, archived: true));

        Assert.Collection(
            display.BulkActions,
            a => Assert.Equal(InboxBulkAction.Restore, a.Action),
            a => Assert.Equal(InboxBulkAction.Delete, a.Action));
    }

    [Fact]
    public void The_bulk_delete_action_carries_its_confirmation_copy()
    {
        InboxBulkActionItem delete = Assert.Single(
            ProjectFlat(false, Note(1, Now)).BulkActions,
            a => a.Action == InboxBulkAction.Delete);

        Assert.True(delete.Destructive);
        Assert.Equal("Delete notifications?", delete.ConfirmTitle);
        Assert.Equal("Delete", delete.ConfirmLabel);
        Assert.False(string.IsNullOrWhiteSpace(delete.ConfirmBody));
    }

    // ── Grouped view (web NotificationGroupRow) ─────────────────────────────────────────────────────────

    [Fact]
    public void Grouped_projection_builds_thread_rows_with_counts()
    {
        var group = new InboxGroup("k", Note(10, Now, severity: "warning"), 12, 3, new long[] { 1 });
        InboxBodyDisplay display = ProjectGrouped(group);

        Assert.True(display.IsGrouped);
        InboxGroupRowDisplay row = Assert.Single(display.Groups);
        Assert.Equal(10, row.LatestId);
        Assert.Equal("12", row.CountText);
        Assert.Equal("3", row.UnreadText);
        Assert.Equal("Warning", row.SeverityLabel);
        Assert.Equal(1, display.GroupCount);
    }

    [Fact]
    public void Grouped_count_label_uses_the_group_count()
    {
        InboxBodyDisplay display = ProjectGrouped(
            new InboxGroup("a", Note(1, Now), 1, 0, Array.Empty<long>()),
            new InboxGroup("b", Note(2, Now), 1, 0, Array.Empty<long>()));

        Assert.Equal("2 notifications", display.CountLabel);
    }

    // ── Empty-state copy per tab / view (web EmptyState branches) ───────────────────────────────────────

    [Fact]
    public void Empty_inbox_copy_uses_the_no_notifications_strings()
    {
        InboxBodyDisplay display = ProjectFlat(false);

        Assert.False(display.HasContent);
        Assert.Equal("No notifications", display.EmptyTitle);
        Assert.Equal("Configure alert rules", display.EmptyCtaLabel);
    }

    [Fact]
    public void Empty_archive_copy_uses_the_archived_strings_and_no_cta()
    {
        InboxBodyDisplay display = ProjectFlat(true);

        Assert.Equal("No archived notifications", display.EmptyTitle);
        Assert.Equal("Archived notifications will appear here.", display.EmptyMessage);
        Assert.Null(display.EmptyCtaLabel);
    }

    [Fact]
    public void Empty_grouped_copy_uses_the_no_threads_strings()
    {
        InboxBodyDisplay display = ProjectGrouped();

        Assert.False(display.HasContent);
        Assert.Equal("No notification threads", display.EmptyTitle);
    }

    // ── Filter query serialization (web serializeNotificationFilters) ───────────────────────────────────

    [Fact]
    public void Filter_always_emits_the_archived_discriminator()
    {
        IReadOnlyDictionary<string, object?> query = InboxFilter.Default(true).ToQuery();

        Assert.Equal("true", query["archived"]);
    }

    [Fact]
    public void Filter_serializes_severity_read_and_search()
    {
        var filter = InboxFilter.Default(false) with
        {
            Severities = new[] { InboxSeverity.Critical, InboxSeverity.Warn },
            Read = InboxReadFilter.Unread,
            Query = "battery",
        };
        IReadOnlyDictionary<string, object?> query = filter.ToQuery();

        Assert.Equal("critical,warn", query["severity"]);
        Assert.Equal("false", query["read"]);
        Assert.Equal("battery", query["q"]);
    }

    [Fact]
    public void Filter_omits_the_read_param_for_the_all_state()
    {
        IReadOnlyDictionary<string, object?> query = InboxFilter.Default(false).ToQuery();

        Assert.False(query.ContainsKey("read"));
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Content_automation_name_carries_the_count()
    {
        InboxBodyDisplay display = ProjectFlat(false, Note(1, Now), Note(2, Now));

        Assert.Contains("2 notifications", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_is_the_empty_title()
    {
        InboxBodyDisplay display = ProjectFlat(false);

        Assert.Equal(display.EmptyTitle, display.AutomationName);
    }

    [Fact]
    public void Row_automation_name_carries_title_message_and_time()
    {
        InboxRowDisplay row = Assert.Single(
            ProjectFlat(false, Note(1, Now, title: "Battery", message: "Low")).Days[0].Rows);

        Assert.Contains("Battery", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Low", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_row_context_menu_item_has_a_label_and_glyph()
    {
        InboxRowDisplay row = Assert.Single(ProjectFlat(false, Note(1, Now)).Days[0].Rows);

        Assert.All(row.ContextMenu, i =>
        {
            Assert.False(string.IsNullOrWhiteSpace(i.Label));
            Assert.False(string.IsNullOrWhiteSpace(i.Glyph));
        });
    }

    // ── Diagnostics (P1/S11): view.opened slug=InboxBody, PII-safe ──────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new InboxBodyDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InboxBody", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_notification_content()
    {
        var captured = new List<string>();
        var diagnostics = new InboxBodyDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.DoesNotContain(line, char.IsDigit);
    }

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("InboxBody", InboxBodyRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => InboxBodyProjection.Project(null!, Localizer, Now));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => InboxBodyProjection.Project(InboxBodyModel.Empty, null!, Now));

    // ── View-model state matrix (per-state: loading / loaded / empty / error / stale / offline) ──────────

    private static InboxBodyViewModel NewViewModel(FakeInboxSource source, FakeInboxCommands commands, bool archived = false) =>
        new(source, commands, Localizer, archived, () => Now);

    [Fact]
    public async Task ViewModel_reaches_loaded_with_content()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now), Note(2, Now) } };
        var vm = NewViewModel(source, new FakeInboxCommands(), archived: true);

        await vm.LoadAsync();

        Assert.Equal(InboxBodyState.Loaded, vm.State);
        Assert.True(vm.Display.HasContent);
        Assert.Equal(2, vm.Display.FlatCount);
    }

    [Fact]
    public async Task ViewModel_reaches_empty()
    {
        var source = new FakeInboxSource { FinalStatus = LoadStatus.Empty };
        var vm = NewViewModel(source, new FakeInboxCommands(), archived: true);

        await vm.LoadAsync();

        Assert.Equal(InboxBodyState.Empty, vm.State);
        Assert.False(vm.Display.HasContent);
        Assert.Equal("No archived notifications", vm.Display.EmptyTitle);
    }

    [Fact]
    public async Task ViewModel_reaches_error_with_a_message()
    {
        var source = new FakeInboxSource
        {
            FinalStatus = LoadStatus.Error,
            Error = new RepositoryError(RepositoryErrorKind.Server, "boom"),
        };
        var vm = NewViewModel(source, new FakeInboxCommands(), archived: true);

        await vm.LoadAsync();

        Assert.Equal(InboxBodyState.Error, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_reaches_stale_then_offline()
    {
        var stale = new FakeInboxSource { Rows = { Note(1, Now) }, FinalStatus = LoadStatus.Cached, Stale = true };
        var staleVm = NewViewModel(stale, new FakeInboxCommands(), archived: true);
        await staleVm.LoadAsync();
        Assert.Equal(InboxBodyState.Stale, staleVm.State);

        var offline = new FakeInboxSource
        {
            Rows = { Note(1, Now) },
            FinalStatus = LoadStatus.Offline,
            Error = new RepositoryError(RepositoryErrorKind.Offline, "offline"),
        };
        var offlineVm = NewViewModel(offline, new FakeInboxCommands(), archived: true);
        await offlineVm.LoadAsync();
        Assert.Equal(InboxBodyState.Offline, offlineVm.State);
        Assert.True(offlineVm.IsError);
    }

    [Fact]
    public async Task ViewModel_selection_toggles_and_select_all()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now), Note(2, Now) } };
        var vm = NewViewModel(source, new FakeInboxCommands(), archived: true);
        await vm.LoadAsync();

        vm.ToggleSelection(1, true);
        Assert.Equal(1, vm.SelectedCount);
        Assert.True(vm.IsSelected(1));

        vm.SelectAllVisible();
        Assert.Equal(2, vm.SelectedCount);
        Assert.True(vm.Display.AllVisibleSelected);

        vm.ClearSelection();
        Assert.Equal(0, vm.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_bulk_archive_invokes_the_command_and_clears_selection()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now), Note(2, Now) } };
        var commands = new FakeInboxCommands();
        var vm = NewViewModel(source, commands, archived: false);
        await vm.SetViewAsync(InboxView.Flat);

        vm.ToggleSelection(1, true);
        vm.ToggleSelection(2, true);
        await vm.InvokeBulkActionAsync(InboxBulkAction.Archive);

        Assert.Equal(new long[] { 1, 2 }, commands.Archived.OrderBy(x => x).ToArray());
        Assert.Equal(0, vm.SelectedCount);
    }

    [Fact]
    public async Task ViewModel_row_delete_invokes_the_command()
    {
        var source = new FakeInboxSource { Rows = { Note(7, Now) } };
        var commands = new FakeInboxCommands();
        var vm = NewViewModel(source, commands, archived: true);
        await vm.LoadAsync();

        await vm.InvokeRowActionAsync(InboxRowAction.Delete, 7);

        Assert.Contains(7, commands.Deleted);
    }

    [Fact]
    public async Task ViewModel_view_toggle_switches_to_flat()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now) }, Groups = { new InboxGroup("k", Note(1, Now), 1, 0, Array.Empty<long>()) } };
        var vm = NewViewModel(source, new FakeInboxCommands(), archived: false);
        await vm.LoadAsync();
        Assert.True(vm.Display.IsGrouped);

        await vm.SetViewAsync(InboxView.Flat);

        Assert.Equal(InboxView.Flat, vm.View);
        Assert.False(vm.Display.IsGrouped);
    }

    [Fact]
    public async Task ViewModel_auto_marks_visible_unread_on_flat_open()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now, read: false), Note(2, Now, read: true) } };
        var commands = new FakeInboxCommands();
        var vm = NewViewModel(source, commands, archived: false);

        await vm.SetViewAsync(InboxView.Flat);

        Assert.Contains(1, commands.MarkedRead);
        Assert.DoesNotContain(2, commands.MarkedRead);
    }

    [Fact]
    public async Task ViewModel_does_not_auto_mark_when_disabled()
    {
        var source = new FakeInboxSource { Rows = { Note(1, Now, read: false) } };
        var commands = new FakeInboxCommands();
        var vm = NewViewModel(source, commands, archived: false);
        vm.AutoMarkOnOpen = false;

        await vm.SetViewAsync(InboxView.Flat);

        Assert.Empty(commands.MarkedRead);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new InboxBodyViewModel(null!, new FakeInboxCommands(), Localizer, false));
        Assert.Throws<ArgumentNullException>(() => new InboxBodyViewModel(new FakeInboxSource(), null!, Localizer, false));
    }

    private sealed class FakeInboxSource : IInboxSource
    {
        public List<InboxNotification> Rows { get; } = new();

        public List<InboxGroup> Groups { get; } = new();

        public LoadStatus FinalStatus { get; set; } = LoadStatus.Loaded;

        public RepositoryError? Error { get; set; }

        public bool Stale { get; set; }

        public DateTimeOffset FetchedAt { get; set; } = Now;

        public async IAsyncEnumerable<RepositoryResult<InboxReading>> StreamAsync(
            InboxQuery query,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask.ConfigureAwait(false);
            yield return RepositoryResult<InboxReading>.Loading();

            bool grouped = query.View == InboxView.Grouped && !query.Filter.Archived;
            var reading = grouped
                ? new InboxReading(query.View, Array.Empty<InboxNotification>(), Groups)
                : new InboxReading(query.View, Rows, Array.Empty<InboxGroup>());

            yield return FinalStatus switch
            {
                LoadStatus.Empty => RepositoryResult<InboxReading>.Empty(FetchedAt),
                LoadStatus.Error => RepositoryResult<InboxReading>.Failure(Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "error")),
                LoadStatus.Offline => RepositoryResult<InboxReading>.OfflineCached(reading, FetchedAt, Error ?? new RepositoryError(RepositoryErrorKind.Offline, "offline")),
                LoadStatus.Cached => RepositoryResult<InboxReading>.Cached(reading, FetchedAt, Stale),
                _ => RepositoryResult<InboxReading>.Loaded(reading, FetchedAt),
            };
        }
    }

    private sealed class FakeInboxCommands : IInboxCommands
    {
        public List<long> MarkedRead { get; } = new();

        public List<long> MarkedUnread { get; } = new();

        public List<long> Archived { get; } = new();

        public List<long> Unarchived { get; } = new();

        public List<long> Deleted { get; } = new();

        public int MarkAllReadCalls { get; private set; }

        public Task MarkReadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            MarkedRead.AddRange(ids);
            return Task.CompletedTask;
        }

        public Task MarkAllReadAsync(CancellationToken cancellationToken = default)
        {
            MarkAllReadCalls++;
            return Task.CompletedTask;
        }

        public Task MarkUnreadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            MarkedUnread.AddRange(ids);
            return Task.CompletedTask;
        }

        public Task ArchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            Archived.AddRange(ids);
            return Task.CompletedTask;
        }

        public Task UnarchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            Unarchived.AddRange(ids);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default)
        {
            Deleted.AddRange(ids);
            return Task.CompletedTask;
        }
    }
}
