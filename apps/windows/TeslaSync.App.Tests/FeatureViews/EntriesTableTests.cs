using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EntriesTable</c> DLQ-inspector surface's UI-thread-free logic — the per-state
/// projection (data / loading / empty), the web-faithful per-column sort, the cell formatting (timestamp,
/// <c>formatBytes</c>, <c>fmtInt</c>, em-dash fallbacks), the replayable chip, the localized columns, the
/// pagination maths, the accessible names and the diagnostics. Mirrors the web spec
/// (<c>web/src/features/admin/components/dlq-inspector/EntriesTable.tsx</c>). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class EntriesTableTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 13, 0, 0, TimeSpan.Zero);

    private static DlqEntrySummary Entry(
        long id = 1,
        string arrived = "2026-06-08T12:00:00Z",
        string reason = "decode_error",
        bool replayable = true,
        long rawPayloadSize = 512,
        string? vin = "VIN0000000000001",
        string? topic = "telemetry/v/Soc",
        int? redeliveries = 1) =>
        new(id, arrived, reason, replayable, rawPayloadSize, vin, topic, redeliveries);

    private static EntriesTableDisplay Project(
        IReadOnlyList<DlqEntrySummary>? rows = null,
        bool loading = false,
        EntriesTableSort? sort = null) =>
        EntriesTableProjection.Project(
            new EntriesTableModel(rows ?? Array.Empty<DlqEntrySummary>(), loading),
            sort ?? EntriesTableSort.Default,
            Now,
            Localizer);

    // ── State selection (web: rows present -> table; else loading copy / clean copy) ────────────────

    [Fact]
    public void Data_state_when_rows_present_even_while_loading()
    {
        // Web: the DataTable renders rows whenever data.length > 0, regardless of the loading flag.
        var display = Project(new[] { Entry() }, loading: true);

        Assert.Equal(EntriesTableState.Data, display.State);
        Assert.Single(display.Rows);
    }

    [Fact]
    public void Loading_state_when_no_rows_and_loading()
    {
        var display = Project(Array.Empty<DlqEntrySummary>(), loading: true);

        Assert.Equal(EntriesTableState.Loading, display.State);
        Assert.Empty(display.Rows);
        Assert.Equal("Loading\u2026", display.EmptyMessage);
    }

    [Fact]
    public void Empty_state_when_no_rows_and_not_loading()
    {
        var display = Project(Array.Empty<DlqEntrySummary>(), loading: false);

        Assert.Equal(EntriesTableState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.Equal("No DLQ entries \u2014 the pipeline is clean.", display.EmptyMessage);
    }

    // ── Columns: keys, localized headers, sortable flags, render styles (web column descriptors) ─────

    [Fact]
    public void Columns_match_the_web_eight_columns_in_order()
    {
        var columns = Project(new[] { Entry() }).Columns;

        Assert.Collection(
            columns,
            c => AssertColumn(c, EntriesTableColumns.ArrivedAtKey, "Arrived", true, EntriesCellStyle.Timestamp),
            c => AssertColumn(c, EntriesTableColumns.ReasonKey, "Reason", true, EntriesCellStyle.ReasonMono),
            c => AssertColumn(c, EntriesTableColumns.VinKey, "VIN", true, EntriesCellStyle.MutedMono),
            c => AssertColumn(c, EntriesTableColumns.TopicKey, "Source topic", false, EntriesCellStyle.MutedMono),
            c => AssertColumn(c, EntriesTableColumns.RedeliveriesKey, "Redel.", false, EntriesCellStyle.Count),
            c => AssertColumn(c, EntriesTableColumns.SizeKey, "Payload", true, EntriesCellStyle.Size),
            c => AssertColumn(c, EntriesTableColumns.ReplayableKey, "Replayable", false, EntriesCellStyle.ReplayableBadge),
            c => AssertColumn(c, EntriesTableColumns.ActionsKey, "Actions", false, EntriesCellStyle.InspectAction));
    }

    private static void AssertColumn(
        EntriesTableColumn column,
        string key,
        string header,
        bool sortable,
        EntriesCellStyle style)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(sortable, column.Sortable);
        Assert.Equal(style, column.Style);
    }

    // ── Sort: default + useSortToggle semantics ─────────────────────────────────────────────────────

    [Fact]
    public void Default_sort_is_arrived_at_descending()
    {
        Assert.Equal(EntriesTableColumns.ArrivedAtKey, EntriesTableSort.Default.Key);
        Assert.False(EntriesTableSort.Default.Ascending);
    }

    [Fact]
    public void Toggle_same_key_flips_direction()
    {
        var flipped = EntriesTableSort.Default.Toggle(EntriesTableColumns.ArrivedAtKey);

        Assert.Equal(EntriesTableColumns.ArrivedAtKey, flipped.Key);
        Assert.True(flipped.Ascending);
    }

    [Fact]
    public void Toggle_new_key_resets_to_descending()
    {
        var ascendingReason = new EntriesTableSort(EntriesTableColumns.ReasonKey, true);

        var next = ascendingReason.Toggle(EntriesTableColumns.SizeKey);

        Assert.Equal(EntriesTableColumns.SizeKey, next.Key);
        Assert.False(next.Ascending);
    }

    // ── Sort order: each web-sortable column, ascending + descending ────────────────────────────────

    private static DlqEntrySummary[] SortFixture() =>
    [
        Entry(id: 1, arrived: "2026-06-08T10:00:00Z", reason: "decode", vin: "VINB", rawPayloadSize: 2048),
        Entry(id: 2, arrived: "2026-06-08T12:00:00Z", reason: "auth", vin: "VINA", rawPayloadSize: 512),
        Entry(id: 3, arrived: "2026-06-08T11:00:00Z", reason: "schema", vin: null, rawPayloadSize: 1048576),
    ];

    [Fact]
    public void Sort_arrived_at_descending_is_newest_first()
    {
        var rows = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.ArrivedAtKey, false)).Rows;

        Assert.Equal(new long[] { 2, 3, 1 }, rows.Select(r => r.RowKey).ToArray());
    }

    [Fact]
    public void Sort_arrived_at_ascending_is_oldest_first()
    {
        var rows = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.ArrivedAtKey, true)).Rows;

        Assert.Equal(new long[] { 1, 3, 2 }, rows.Select(r => r.RowKey).ToArray());
    }

    [Fact]
    public void Sort_reason_ascending_and_descending_uses_locale_order()
    {
        var asc = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.ReasonKey, true)).Rows;
        var desc = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.ReasonKey, false)).Rows;

        Assert.Equal(new long[] { 2, 1, 3 }, asc.Select(r => r.RowKey).ToArray());
        Assert.Equal(new long[] { 3, 1, 2 }, desc.Select(r => r.RowKey).ToArray());
    }

    [Fact]
    public void Sort_vin_ascending_treats_null_as_empty_string()
    {
        // Web `(a.parsed_vin ?? '').localeCompare(b.parsed_vin ?? '')` — the null VIN sorts first ascending.
        var rows = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.VinKey, true)).Rows;

        Assert.Equal(new long[] { 3, 2, 1 }, rows.Select(r => r.RowKey).ToArray());
    }

    [Fact]
    public void Sort_payload_size_is_numeric_not_lexicographic()
    {
        var asc = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.SizeKey, true)).Rows;
        var desc = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.SizeKey, false)).Rows;

        Assert.Equal(new long[] { 2, 1, 3 }, asc.Select(r => r.RowKey).ToArray());
        Assert.Equal(new long[] { 3, 1, 2 }, desc.Select(r => r.RowKey).ToArray());
    }

    [Fact]
    public void Sort_by_non_sortable_key_preserves_input_order()
    {
        // Web switch `default: return 0` — a non-sortable key leaves the order untouched.
        var rows = Project(SortFixture(), sort: new EntriesTableSort(EntriesTableColumns.TopicKey, true)).Rows;

        Assert.Equal(new long[] { 1, 2, 3 }, rows.Select(r => r.RowKey).ToArray());
    }

    // ── Cell formatting ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Arrived_cell_renders_absolute_timestamp_when_valid()
    {
        var cell = Cell(Project(new[] { Entry(arrived: "2026-06-08T12:00:00Z") }), EntriesTableColumns.ArrivedAtKey);

        Assert.Contains("2026", cell, StringComparison.Ordinal);
        Assert.NotEqual(EmDash, cell);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-timestamp")]
    public void Arrived_cell_falls_back_to_em_dash_when_unparseable(string arrived)
    {
        var cell = Cell(Project(new[] { Entry(arrived: arrived) }), EntriesTableColumns.ArrivedAtKey);

        Assert.Equal(EmDash, cell);
    }

    [Fact]
    public void Reason_cell_falls_back_to_em_dash_when_empty()
    {
        Assert.Equal("decode", Cell(Project(new[] { Entry(reason: "decode") }), EntriesTableColumns.ReasonKey));
        Assert.Equal(EmDash, Cell(Project(new[] { Entry(reason: "") }), EntriesTableColumns.ReasonKey));
    }

    [Fact]
    public void Vin_and_topic_cells_fall_back_to_em_dash_when_null()
    {
        var display = Project(new[] { Entry(vin: null, topic: null) });

        Assert.Equal(EmDash, Cell(display, EntriesTableColumns.VinKey));
        Assert.Equal(EmDash, Cell(display, EntriesTableColumns.TopicKey));
    }

    [Fact]
    public void Redeliveries_cell_formats_with_grouping_or_em_dash()
    {
        Assert.Equal("1,234", Cell(Project(new[] { Entry(redeliveries: 1234) }), EntriesTableColumns.RedeliveriesKey));
        Assert.Equal("0", Cell(Project(new[] { Entry(redeliveries: 0) }), EntriesTableColumns.RedeliveriesKey));
        Assert.Equal(EmDash, Cell(Project(new[] { Entry(redeliveries: null) }), EntriesTableColumns.RedeliveriesKey));
    }

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(2048, "2.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1048576, "1.0 MB")]
    [InlineData(-1, "\u2014")]
    public void Payload_cell_uses_format_bytes(long size, string expected)
    {
        Assert.Equal(expected, Cell(Project(new[] { Entry(rawPayloadSize: size) }), EntriesTableColumns.SizeKey));
    }

    [Fact]
    public void Replayable_cell_and_flag_track_the_entry()
    {
        var yes = Assert.Single(Project(new[] { Entry(replayable: true) }).Rows);
        var no = Assert.Single(Project(new[] { Entry(replayable: false) }).Rows);

        Assert.True(yes.Replayable);
        Assert.Equal("Yes", yes.ReplayableText);
        Assert.Equal("Yes", yes.Cells[EntriesTableColumns.ReplayableKey]);
        Assert.False(no.Replayable);
        Assert.Equal("No", no.ReplayableText);
    }

    [Fact]
    public void Row_preserves_identity_and_source_for_the_inspect_callback()
    {
        var entry = Entry(id: 99);

        var row = Assert.Single(Project(new[] { entry }).Rows);

        Assert.Equal(99, row.RowKey);
        Assert.Same(entry, row.Source);
    }

    [Fact]
    public void Inspect_label_resolves_through_the_localizer()
    {
        Assert.Equal("Inspect", Project(new[] { Entry() }).InspectLabel);
    }

    // ── Accessibility: non-empty names on every state, row and inspect affordance ───────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(new[] { Entry() }),
                Project(Array.Empty<DlqEntrySummary>(), loading: true),
                Project(Array.Empty<DlqEntrySummary>(), loading: false),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Each_row_exposes_descriptive_row_and_inspect_names()
    {
        var row = Assert.Single(Project(new[] { Entry(reason: "decode_error") }).Rows);

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("decode_error", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Inspect", row.InspectAutomationName, StringComparison.Ordinal);
        Assert.Contains("decode_error", row.InspectAutomationName, StringComparison.Ordinal);
    }

    // ── Pagination maths ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pagination_defaults_match_the_web_data_table()
    {
        Assert.Equal(25, EntriesTablePaging.DefaultPageSize);
        Assert.Equal(new[] { 25, 50, 100 }, EntriesTablePaging.PageSizeOptions.ToArray());
    }

    [Fact]
    public void Slice_returns_the_requested_page_and_clamps_overflow()
    {
        var rows = Project(Enumerable.Range(1, 60).Select(i => Entry(id: i)).ToArray()).Rows;

        Assert.Equal(25, EntriesTablePaging.Slice(rows, 0, 25).Count);
        Assert.Equal(10, EntriesTablePaging.Slice(rows, 2, 25).Count);
        Assert.Equal(3, EntriesTablePaging.PageCount(rows.Count, 25));

        // An out-of-range page index falls back to the last page rather than an empty slice.
        Assert.Equal(10, EntriesTablePaging.Slice(rows, 99, 25).Count);
    }

    // ── Diagnostics (P1/S11): view.opened slug=EntriesTable, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new EntriesTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EntriesTable", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_line_never_leaks_entry_content()
    {
        var captured = new List<string>();
        new EntriesTableDiagnostics(captured.Add).RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("VIN", line, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("topic", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("EntriesTable", EntriesTableRegistration.Slug);
    }

    private static string Cell(EntriesTableDisplay display, string key) =>
        Assert.Single(display.Rows).Cells[key];
}
