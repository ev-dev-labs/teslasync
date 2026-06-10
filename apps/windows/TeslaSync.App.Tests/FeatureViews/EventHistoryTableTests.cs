using System.Globalization;
using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SecurityAccess;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EventHistoryTable</c> feature surface's UI-thread-free logic — the branch
/// projection (loading replaces the table, then empty, then data), the five columns with the single sortable
/// time column, the lock / sentry badge variants, the <c>doorClosed</c> / <c>parseWindowState</c> /
/// <c>windowSummary</c> helpers, the time sort, the 50-row pagination, the accessible names, the i18n catalog
/// keys, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/security-access/EventHistoryTable.tsx + ./helpers.ts). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class EventHistoryTableTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SecuritySignal Text(string value) => SecuritySignal.FromText(value);

    private static SecuritySignal Bool(bool value) => SecuritySignal.FromBoolean(value);

    private static SecuritySignal Nil => SecuritySignal.None;

    private static SecurityEventRow Row(
        string id = "evt-1",
        DateTimeOffset? createdAt = null,
        bool? locked = null,
        SecuritySignal sentry = default,
        SecuritySignal door = default,
        SecuritySignal fd = default,
        SecuritySignal fp = default,
        SecuritySignal rd = default,
        SecuritySignal rp = default) =>
        new(id, createdAt ?? new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.Zero), locked, sentry, door, fd, fp, rd, rp);

    private static SecurityEventRow AllClosedRow(string id = "evt-1", bool? locked = true) =>
        Row(id, locked: locked, sentry: Bool(true), door: Text("Closed"),
            fd: Text("Closed"), fp: Text("Closed"), rd: Text("Closed"), rp: Text("Closed"));

    private static EventHistoryTableModel Model(params SecurityEventRow[] rows) => new(rows, false);

    private static EventHistoryTableModel LoadingModel(params SecurityEventRow[] rows) => new(rows, true);

    private static EventHistoryTableDisplay Project(
        EventHistoryTableModel model,
        TableSortState? sort = null,
        int page = 1,
        int pageSize = EventHistoryTableProjection.DefaultPageSize) =>
        EventHistoryTableProjection.Project(model, Localizer, sort ?? new TableSortState(), page, pageSize);

    // ── Branch selection: loading replaces the table (web {isLoading ? <Skeleton/> : <DataTable/>}) ──────

    [Fact]
    public void Loading_when_is_loading_and_no_rows()
    {
        Assert.Equal(EventHistoryTableState.Loading, Project(LoadingModel()).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_rows_like_the_web()
    {
        // web: isLoading short-circuits to <Skeleton/> before the <DataTable/> ever renders.
        Assert.Equal(EventHistoryTableState.Loading, Project(LoadingModel(AllClosedRow())).State);
    }

    [Fact]
    public void Empty_when_no_rows_and_not_loading()
    {
        Assert.Equal(EventHistoryTableState.Empty, Project(Model()).State);
    }

    [Fact]
    public void Data_when_rows_present_and_not_loading()
    {
        Assert.Equal(EventHistoryTableState.Data, Project(Model(AllClosedRow())).State);
    }

    // ── Columns: five columns, only the time column sortable (web sortable: true) ───────────────────────

    [Fact]
    public void Columns_match_the_web_five_columns()
    {
        var columns = Project(Model(AllClosedRow())).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((EventHistoryTableProjection.TimeColumnKey, "Time", true), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((EventHistoryTableProjection.LockColumnKey, "Lock", false), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((EventHistoryTableProjection.SentryColumnKey, "Sentry", false), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((EventHistoryTableProjection.DoorsColumnKey, "Doors", false), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((EventHistoryTableProjection.WindowsColumnKey, "Windows", false), (c.Key, c.Header, c.Sortable)));
    }

    [Fact]
    public void Title_and_empty_message_resolve_through_the_facade()
    {
        var display = Project(Model());

        Assert.Equal("Security Event History", display.Title);
        Assert.Equal("No security events recorded yet.", display.EmptyMessage);
    }

    // ── Lock badge: web variant={row.locked ? 'success' : 'danger'} ─────────────────────────────────────

    [Fact]
    public void Lock_locked_is_success_and_labelled_locked()
    {
        var row = Assert.Single(Project(Model(Row(locked: true))).Rows);

        Assert.Equal(StatusKind.Success, row.LockStatus);
        Assert.Equal("Locked", row.LockText);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public void Lock_unlocked_or_null_is_danger_and_labelled_unlocked(bool? locked)
    {
        var row = Assert.Single(Project(Model(Row(locked: locked))).Rows);

        Assert.Equal(StatusKind.Danger, row.LockStatus);
        Assert.Equal("Unlocked", row.LockText);
    }

    // ── Sentry badge: web variant={row.sentryMode ? 'success' : 'neutral'} (JS truthiness) ──────────────

    [Fact]
    public void Sentry_boolean_true_is_success_on()
    {
        var row = Assert.Single(Project(Model(Row(sentry: Bool(true)))).Rows);

        Assert.Equal(StatusKind.Success, row.SentryStatus);
        Assert.Equal("On", row.SentryText);
    }

    [Fact]
    public void Sentry_boolean_false_is_neutral_off()
    {
        var row = Assert.Single(Project(Model(Row(sentry: Bool(false)))).Rows);

        Assert.Equal(StatusKind.Neutral, row.SentryStatus);
        Assert.Equal("Off", row.SentryText);
    }

    [Fact]
    public void Sentry_null_is_neutral_off()
    {
        var row = Assert.Single(Project(Model(Row(sentry: Nil))).Rows);

        Assert.Equal(StatusKind.Neutral, row.SentryStatus);
        Assert.Equal("Off", row.SentryText);
    }

    [Fact]
    public void Sentry_empty_string_is_falsy_neutral_off()
    {
        var row = Assert.Single(Project(Model(Row(sentry: Text(string.Empty)))).Rows);

        Assert.Equal(StatusKind.Neutral, row.SentryStatus);
        Assert.Equal("Off", row.SentryText);
    }

    [Fact]
    public void Sentry_non_empty_string_is_truthy_on_matching_the_web_ternary()
    {
        // web: `row.sentryMode ? …` — ANY non-empty string is truthy in JS, even the string "Off".
        var row = Assert.Single(Project(Model(Row(sentry: Text("Off")))).Rows);

        Assert.Equal(StatusKind.Success, row.SentryStatus);
        Assert.Equal("On", row.SentryText);
    }

    // ── Doors cell: web asNonEmptyString(doorState) ?? (doorClosed ? Closed : —) + green/amber ──────────

    [Fact]
    public void Doors_non_empty_string_shows_raw_value_and_open_colour()
    {
        var row = Assert.Single(Project(Model(Row(door: Text("DriverFrontOpen")))).Rows);

        Assert.Equal("DriverFrontOpen", row.DoorsText);
        Assert.False(row.DoorsClosed);
    }

    [Fact]
    public void Doors_closed_string_shows_raw_value_and_closed_colour()
    {
        var row = Assert.Single(Project(Model(Row(door: Text("Closed")))).Rows);

        Assert.Equal("Closed", row.DoorsText);
        Assert.True(row.DoorsClosed);
    }

    [Fact]
    public void Doors_null_falls_back_to_localized_closed()
    {
        var row = Assert.Single(Project(Model(Row(door: Nil))).Rows);

        Assert.Equal("Closed", row.DoorsText);
        Assert.True(row.DoorsClosed);
    }

    [Fact]
    public void Doors_boolean_false_is_closed_with_localized_label()
    {
        var row = Assert.Single(Project(Model(Row(door: Bool(false)))).Rows);

        Assert.Equal("Closed", row.DoorsText);
        Assert.True(row.DoorsClosed);
    }

    [Fact]
    public void Doors_boolean_true_is_open_with_em_dash_label()
    {
        var row = Assert.Single(Project(Model(Row(door: Bool(true)))).Rows);

        Assert.Equal(EmDash, row.DoorsText);
        Assert.False(row.DoorsClosed);
    }

    // ── Windows cell: web windowSummary + green/amber ───────────────────────────────────────────────────

    [Fact]
    public void Windows_all_closed_summary_and_colour()
    {
        var row = Assert.Single(Project(Model(AllClosedRow())).Rows);

        Assert.Equal("All Closed", row.WindowsText);
        Assert.True(row.WindowsClosed);
    }

    [Fact]
    public void Windows_some_open_reports_count_and_open_colour()
    {
        var source = Row(fd: Text("Closed"), fp: Text("Open"), rd: Text("Vent"), rp: Text("Closed"));

        var row = Assert.Single(Project(Model(source)).Rows);

        Assert.Equal("2 Open/Venting", row.WindowsText);
        Assert.False(row.WindowsClosed);
    }

    [Fact]
    public void Windows_boolean_values_are_unknown_and_count_as_open()
    {
        // web parseWindowState only parses strings (asNonEmptyString); a boolean window is 'Unknown' != 'Closed'.
        var source = Row(fd: Bool(false), fp: Bool(false), rd: Bool(false), rp: Bool(false));

        var row = Assert.Single(Project(Model(source)).Rows);

        Assert.Equal("4 Open/Venting", row.WindowsText);
        Assert.False(row.WindowsClosed);
    }

    // ── Helper: ParseWindowState (web parseWindowState) ─────────────────────────────────────────────────

    [Theory]
    [InlineData("Closed", SecurityWindowState.Closed)]
    [InlineData("closed", SecurityWindowState.Closed)]
    [InlineData("0", SecurityWindowState.Closed)]
    [InlineData("Venting", SecurityWindowState.Venting)]
    [InlineData("partially-vented", SecurityWindowState.Venting)]
    [InlineData("Open", SecurityWindowState.Open)]
    [InlineData("ajar", SecurityWindowState.Open)]
    public void ParseWindowState_maps_strings_like_the_web(string value, SecurityWindowState expected)
    {
        Assert.Equal(expected, EventHistoryTableProjection.ParseWindowState(Text(value)));
    }

    [Fact]
    public void ParseWindowState_non_string_is_unknown()
    {
        Assert.Equal(SecurityWindowState.Unknown, EventHistoryTableProjection.ParseWindowState(Bool(true)));
        Assert.Equal(SecurityWindowState.Unknown, EventHistoryTableProjection.ParseWindowState(Nil));
        Assert.Equal(SecurityWindowState.Unknown, EventHistoryTableProjection.ParseWindowState(Text(string.Empty)));
    }

    // ── Helper: DoorClosed (web doorClosed) ─────────────────────────────────────────────────────────────

    [Fact]
    public void DoorClosed_null_and_boolean_branches()
    {
        Assert.True(EventHistoryTableProjection.DoorClosed(Nil));
        Assert.True(EventHistoryTableProjection.DoorClosed(Bool(false)));
        Assert.False(EventHistoryTableProjection.DoorClosed(Bool(true)));
    }

    [Theory]
    [InlineData("", true)]
    [InlineData("Closed", true)]
    [InlineData("closedall", true)]
    [InlineData("0", true)]
    [InlineData("false", true)]
    [InlineData("  CLOSED  ", true)]
    [InlineData("Open", false)]
    [InlineData("DriverOpen", false)]
    public void DoorClosed_string_branches(string value, bool expected)
    {
        Assert.Equal(expected, EventHistoryTableProjection.DoorClosed(Text(value)));
    }

    [Fact]
    public void DoorClosed_json_object_all_false_or_null_is_closed()
    {
        Assert.True(EventHistoryTableProjection.DoorClosed(Text("{\"df\":false,\"pf\":null}")));
        Assert.False(EventHistoryTableProjection.DoorClosed(Text("{\"df\":true}")));
    }

    [Fact]
    public void DoorClosed_malformed_json_object_is_open()
    {
        Assert.False(EventHistoryTableProjection.DoorClosed(Text("{not json")));
    }

    // ── Helper: AllWindowsClosed + WindowSummary ────────────────────────────────────────────────────────

    [Fact]
    public void AllWindowsClosed_true_only_when_every_corner_closed()
    {
        Assert.True(EventHistoryTableProjection.AllWindowsClosed(AllClosedRow()));
        Assert.False(EventHistoryTableProjection.AllWindowsClosed(
            Row(fd: Text("Closed"), fp: Text("Open"), rd: Text("Closed"), rp: Text("Closed"))));
    }

    [Fact]
    public void WindowSummary_counts_open_and_venting_corners()
    {
        Assert.Equal("All Closed", EventHistoryTableProjection.WindowSummary(AllClosedRow()));
        Assert.Equal("1 Open/Venting", EventHistoryTableProjection.WindowSummary(
            Row(fd: Text("Closed"), fp: Text("Vent"), rd: Text("Closed"), rp: Text("Closed"))));
        Assert.Equal("3 Open/Venting", EventHistoryTableProjection.WindowSummary(
            Row(fd: Text("Open"), fp: Text("Open"), rd: Text("Open"), rp: Text("Closed"))));
    }

    // ── Signal value semantics (web string | boolean | null + asNonEmptyString) ─────────────────────────

    [Fact]
    public void Signal_truthiness_and_non_empty_string()
    {
        Assert.True(Bool(true).IsTruthy);
        Assert.False(Bool(false).IsTruthy);
        Assert.True(Text("anything").IsTruthy);
        Assert.False(Text(string.Empty).IsTruthy);
        Assert.False(Nil.IsTruthy);

        Assert.Equal("x", Text("x").NonEmptyString);
        Assert.Null(Text(string.Empty).NonEmptyString);
        Assert.Null(Bool(true).NonEmptyString);
        Assert.Null(Nil.NonEmptyString);
    }

    // ── Sorting: the time column toggles ascending → descending → none over createdAt ───────────────────

    [Fact]
    public void Default_order_is_input_order_when_unsorted()
    {
        var older = Row("a", createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var newer = Row("b", createdAt: new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero));

        var display = Project(Model(newer, older));

        Assert.Equal(SortDirection.None, display.TimeSortDirection);
        Assert.Equal(new[] { "b", "a" }, display.Rows.Select(r => r.Id));
    }

    [Fact]
    public void Time_sort_ascending_orders_by_created_at()
    {
        var older = Row("a", createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var newer = Row("b", createdAt: new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero));
        var sort = new TableSortState();
        sort.Toggle(EventHistoryTableProjection.TimeColumnKey); // ascending

        var display = Project(Model(newer, older), sort);

        Assert.Equal(SortDirection.Ascending, display.TimeSortDirection);
        Assert.Equal(new[] { "a", "b" }, display.Rows.Select(r => r.Id));
    }

    [Fact]
    public void Time_sort_descending_reverses_order()
    {
        var older = Row("a", createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var newer = Row("b", createdAt: new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero));
        var sort = new TableSortState();
        sort.Toggle(EventHistoryTableProjection.TimeColumnKey); // ascending
        sort.Toggle(EventHistoryTableProjection.TimeColumnKey); // descending

        var display = Project(Model(older, newer), sort);

        Assert.Equal(SortDirection.Descending, display.TimeSortDirection);
        Assert.Equal(new[] { "b", "a" }, display.Rows.Select(r => r.Id));
    }

    // ── Pagination: defaultPageSize 50, pageSizeOptions [20, 50, 100] ────────────────────────────────────

    [Fact]
    public void Page_size_options_and_default_match_the_web_config()
    {
        Assert.Equal(50, EventHistoryTableProjection.DefaultPageSize);
        Assert.Equal(new[] { 20, 50, 100 }, EventHistoryTableProjection.PageSizeOptions);
        Assert.Equal(new[] { 20, 50, 100 }, Project(Model(AllClosedRow())).PageSizeOptions);
    }

    [Fact]
    public void First_page_slices_to_the_page_size()
    {
        var rows = ManyRows(120);

        var display = Project(Model(rows), pageSize: 50);

        Assert.Equal(50, display.Rows.Count);
        Assert.Equal(120, display.TotalCount);
        Assert.Equal(3, display.PageCount);
        Assert.Equal(1, display.RangeStart);
        Assert.Equal(50, display.RangeEnd);
    }

    [Fact]
    public void Last_page_carries_the_remainder()
    {
        var rows = ManyRows(120);

        var display = Project(Model(rows), page: 3, pageSize: 50);

        Assert.Equal(20, display.Rows.Count);
        Assert.Equal(101, display.RangeStart);
        Assert.Equal(120, display.RangeEnd);
    }

    [Fact]
    public void Out_of_range_page_is_clamped()
    {
        var rows = ManyRows(120);

        var display = Project(Model(rows), page: 99, pageSize: 50);

        Assert.Equal(3, display.Page);
        Assert.Equal(20, display.Rows.Count);
    }

    [Fact]
    public void Pagination_only_shows_in_the_data_state()
    {
        Assert.True(Project(Model(AllClosedRow())).ShowPagination);
        Assert.False(Project(Model()).ShowPagination);
        Assert.False(Project(LoadingModel()).ShowPagination);
    }

    // ── Accessibility: every state + every row carries a non-empty Narrator name ────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(LoadingModel()),
                Project(Model()),
                Project(Model(AllClosedRow())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Row_automation_name_carries_every_cell_status()
    {
        var source = Row(locked: true, sentry: Bool(true), door: Text("Closed"),
            fd: Text("Closed"), fp: Text("Closed"), rd: Text("Closed"), rp: Text("Closed"));

        var row = Assert.Single(Project(Model(source)).Rows);

        Assert.Contains("Locked", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("On", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Closed", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("All Closed", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_includes_the_empty_message()
    {
        Assert.Contains("No security events recorded yet.", Project(Model()).AutomationName, StringComparison.Ordinal);
    }

    // ── i18n: every key from the web source maps to a translation.* catalog key ─────────────────────────

    [Fact]
    public void I18n_keys_match_the_web_source_under_the_translation_namespace()
    {
        Assert.Equal("translation.admin.security.eventHistory", EventHistoryTableProjection.TitleKey);
        Assert.Equal("translation.admin.security.col.time", EventHistoryTableProjection.TimeHeaderKey);
        Assert.Equal("translation.admin.security.col.lock", EventHistoryTableProjection.LockHeaderKey);
        Assert.Equal("translation.admin.security.col.sentry", EventHistoryTableProjection.SentryHeaderKey);
        Assert.Equal("translation.admin.security.col.doors", EventHistoryTableProjection.DoorsHeaderKey);
        Assert.Equal("translation.admin.security.col.windows", EventHistoryTableProjection.WindowsHeaderKey);
        Assert.Equal("translation.admin.security.locked", EventHistoryTableProjection.LockedKey);
        Assert.Equal("translation.admin.security.unlocked", EventHistoryTableProjection.UnlockedKey);
        Assert.Equal("translation.admin.security.on", EventHistoryTableProjection.OnKey);
        Assert.Equal("translation.admin.security.off", EventHistoryTableProjection.OffKey);
        Assert.Equal("translation.admin.security.closed", EventHistoryTableProjection.ClosedKey);
        Assert.Equal("translation.admin.security.noEvents", EventHistoryTableProjection.NoEventsKey);
    }

    [Fact]
    public void Labels_resolve_against_the_resw_catalog_values()
    {
        var display = EventHistoryTableProjection.Project(
            Model(AllClosedRow()), new ReswLocalizer(), new TableSortState(), 1, EventHistoryTableProjection.DefaultPageSize);

        Assert.Equal("Security Event History", display.Title);
        Assert.Equal("No security events recorded yet.", display.EmptyMessage);
        Assert.Equal(new[] { "Time", "Lock", "Sentry", "Doors", "Windows" }, display.Columns.Select(c => c.Header));

        var row = Assert.Single(display.Rows);
        Assert.Equal("Locked", row.LockText);
        Assert.Equal("On", row.SentryText);
    }

    // ── Diagnostics (P1/S11): view.opened slug=EventHistoryTable, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new EventHistoryTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EventHistoryTable", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("EventHistoryTable", EventHistoryTableRegistration.Slug);
    }

    // ── Argument guards ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_arguments()
    {
        var sort = new TableSortState();
        Assert.Throws<ArgumentNullException>(() => EventHistoryTableProjection.Project(null!, Localizer, sort, 1, 50));
        Assert.Throws<ArgumentNullException>(() => EventHistoryTableProjection.Project(Model(), null!, sort, 1, 50));
        Assert.Throws<ArgumentNullException>(() => EventHistoryTableProjection.Project(Model(), Localizer, null!, 1, 50));
    }

    [Fact]
    public void Window_helpers_reject_a_null_row()
    {
        Assert.Throws<ArgumentNullException>(() => EventHistoryTableProjection.AllWindowsClosed(null!));
        Assert.Throws<ArgumentNullException>(() => EventHistoryTableProjection.WindowSummary(null!));
    }

    private static SecurityEventRow[] ManyRows(int count) =>
        Enumerable.Range(0, count)
            .Select(i => Row(
                id: $"evt-{i.ToString("D3", CultureInfo.InvariantCulture)}",
                createdAt: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero).AddMinutes(i)))
            .ToArray();

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves the surface's <c>translation.*</c> keys to the
    /// <c>Strings/{lang}/Resources.resw</c> English catalog values (as production does), and the English
    /// fallback for every other key — proving the projection feeds the exact catalog keys.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            EventHistoryTableProjection.TitleKey => "Security Event History",
            EventHistoryTableProjection.TimeHeaderKey => "Time",
            EventHistoryTableProjection.LockHeaderKey => "Lock",
            EventHistoryTableProjection.SentryHeaderKey => "Sentry",
            EventHistoryTableProjection.DoorsHeaderKey => "Doors",
            EventHistoryTableProjection.WindowsHeaderKey => "Windows",
            EventHistoryTableProjection.LockedKey => "Locked",
            EventHistoryTableProjection.UnlockedKey => "Unlocked",
            EventHistoryTableProjection.OnKey => "On",
            EventHistoryTableProjection.OffKey => "Off",
            EventHistoryTableProjection.ClosedKey => "Closed",
            EventHistoryTableProjection.NoEventsKey => "No security events recorded yet.",
            _ => fallback,
        };
    }
}
