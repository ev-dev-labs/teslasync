using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.IngestXRay;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>XRayFieldsTable</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / data), the <c>useSortToggle</c> two-state toggle, the four per-key
/// comparators with stable ties, the cell formatting (en-US grouped sample count, relative last-seen,
/// value-kind label, neutral chip), the localized columns + empty/loading copy, the accessible names, the
/// catalog-key flow, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class XRayFieldsTableTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static IngestXRayFieldStat Stat(
        string field = "VehicleSpeed",
        long sampleCount = 10,
        string lastSeenAt = "2026-06-08T12:00:00Z",
        int valueKind = 6) =>
        new(field, sampleCount, lastSeenAt, valueKind);

    private static XRayFieldsTableModel Model(
        IReadOnlyList<IngestXRayFieldStat>? rows = null,
        bool loading = false) =>
        new(rows ?? Array.Empty<IngestXRayFieldStat>(), loading);

    private static XRayFieldsTableDisplay Project(
        XRayFieldsTableModel model,
        XRayFieldsSort? sort = null) =>
        XRayFieldsTableProjection.Project(model, sort ?? XRayFieldsSort.Default, Localizer, Now);

    private static IReadOnlyList<IngestXRayFieldStat> ThreeRows() => new[]
    {
        Stat(field: "alpha", sampleCount: 10, lastSeenAt: "2026-06-08T11:00:00Z", valueKind: 1),
        Stat(field: "bravo", sampleCount: 50, lastSeenAt: "2026-06-08T12:04:00Z", valueKind: 6),
        Stat(field: "charlie", sampleCount: 30, lastSeenAt: "2026-06-08T09:00:00Z", valueKind: 3),
    };

    // ── Branch precedence: rows → Data; loading && empty → Loading; resolved && empty → Empty ────────

    [Fact]
    public void Loading_when_loading_and_no_rows()
    {
        Assert.Equal(XRayFieldsTableState.Loading, Project(Model(loading: true)).State);
    }

    [Fact]
    public void Empty_when_resolved_and_no_rows()
    {
        Assert.Equal(XRayFieldsTableState.Empty, Project(Model(loading: false)).State);
    }

    [Fact]
    public void Data_when_rows_present_even_while_loading()
    {
        // Web parity: the DataTable shows its rows whenever they exist; the "Loading…" empty copy only
        // surfaces when the row set is empty. A refetch with cached rows stays in the data branch.
        var display = Project(Model(rows: new[] { Stat() }, loading: true));

        Assert.Equal(XRayFieldsTableState.Data, display.State);
        Assert.Single(display.Rows);
    }

    // ── useSortToggle: default + two-state toggle (re-select flips, new key → desc) ──────────────────

    [Fact]
    public void Default_sort_is_sample_count_descending()
    {
        Assert.Equal(XRayFieldsTableProjection.SampleCountKey, XRayFieldsSort.Default.Key);
        Assert.True(XRayFieldsSort.Default.Descending);
    }

    [Fact]
    public void Toggle_same_column_flips_direction()
    {
        var toggled = XRayFieldsSort.Default.Toggle(XRayFieldsTableProjection.SampleCountKey);

        Assert.Equal(XRayFieldsTableProjection.SampleCountKey, toggled.Key);
        Assert.False(toggled.Descending);
    }

    [Fact]
    public void Toggle_new_column_starts_descending()
    {
        var toggled = XRayFieldsSort.Default.Toggle(XRayFieldsTableProjection.FieldKey);

        Assert.Equal(XRayFieldsTableProjection.FieldKey, toggled.Key);
        Assert.True(toggled.Descending);
    }

    [Fact]
    public void Direction_for_reports_only_the_active_column()
    {
        Assert.Equal(SortDirection.Descending, XRayFieldsSort.Default.DirectionFor(XRayFieldsTableProjection.SampleCountKey));
        Assert.Equal(SortDirection.None, XRayFieldsSort.Default.DirectionFor(XRayFieldsTableProjection.FieldKey));
        Assert.Equal(
            SortDirection.Ascending,
            new XRayFieldsSort(XRayFieldsTableProjection.FieldKey, false).DirectionFor(XRayFieldsTableProjection.FieldKey));
    }

    // ── Sort application: each key, ascending and descending ────────────────────────────────────────

    [Fact]
    public void Default_orders_rows_by_sample_count_descending()
    {
        var rows = Project(Model(rows: ThreeRows())).Rows;

        Assert.Equal("bravo", rows[0].Field);   // 50
        Assert.Equal("charlie", rows[1].Field); // 30
        Assert.Equal("alpha", rows[2].Field);   // 10
    }

    [Fact]
    public void Sorts_by_sample_count_ascending()
    {
        var rows = Project(Model(rows: ThreeRows()), new XRayFieldsSort(XRayFieldsTableProjection.SampleCountKey, false)).Rows;

        Assert.Equal("alpha", rows[0].Field);
        Assert.Equal("charlie", rows[1].Field);
        Assert.Equal("bravo", rows[2].Field);
    }

    [Fact]
    public void Sorts_by_field_ascending_and_descending()
    {
        var asc = Project(Model(rows: ThreeRows()), new XRayFieldsSort(XRayFieldsTableProjection.FieldKey, false)).Rows;
        Assert.Equal("alpha", asc[0].Field);
        Assert.Equal("bravo", asc[1].Field);
        Assert.Equal("charlie", asc[2].Field);

        var desc = Project(Model(rows: ThreeRows()), new XRayFieldsSort(XRayFieldsTableProjection.FieldKey, true)).Rows;
        Assert.Equal("charlie", desc[0].Field);
        Assert.Equal("bravo", desc[1].Field);
        Assert.Equal("alpha", desc[2].Field);
    }

    [Fact]
    public void Sorts_by_last_seen_at_chronologically()
    {
        var asc = Project(Model(rows: ThreeRows()), new XRayFieldsSort(XRayFieldsTableProjection.LastSeenKey, false)).Rows;

        Assert.Equal("charlie", asc[0].Field); // 09:00
        Assert.Equal("alpha", asc[1].Field);   // 11:00
        Assert.Equal("bravo", asc[2].Field);   // 12:04
    }

    [Fact]
    public void Sorts_by_value_kind_numerically()
    {
        var asc = Project(Model(rows: ThreeRows()), new XRayFieldsSort(XRayFieldsTableProjection.ValueKindKey, false)).Rows;

        Assert.Equal("alpha", asc[0].Field);   // 1
        Assert.Equal("charlie", asc[1].Field); // 3
        Assert.Equal("bravo", asc[2].Field);   // 6
    }

    [Fact]
    public void Sort_is_stable_for_ties()
    {
        var rows = new[]
        {
            Stat(field: "first", sampleCount: 5),
            Stat(field: "second", sampleCount: 5),
            Stat(field: "third", sampleCount: 5),
        };

        var ascending = Project(Model(rows: rows), new XRayFieldsSort(XRayFieldsTableProjection.SampleCountKey, false)).Rows;
        Assert.Equal("first", ascending[0].Field);
        Assert.Equal("second", ascending[1].Field);
        Assert.Equal("third", ascending[2].Field);

        var descending = Project(Model(rows: rows), new XRayFieldsSort(XRayFieldsTableProjection.SampleCountKey, true)).Rows;
        Assert.Equal("first", descending[0].Field);
        Assert.Equal("second", descending[1].Field);
        Assert.Equal("third", descending[2].Field);
    }

    // ── Cell formatting: grouped count, relative last-seen, value-kind label + neutral chip ──────────

    [Fact]
    public void Formats_sample_count_with_en_us_grouping()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Stat(sampleCount: 1234567) })).Rows);

        Assert.Equal("1,234,567", row.SamplesText);
    }

    [Fact]
    public void Formats_last_seen_relative_to_now()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Stat(lastSeenAt: "2026-06-08T12:04:00Z") })).Rows);

        Assert.Equal("1m ago", row.LastSeenText);
    }

    [Fact]
    public void Renders_em_dash_for_unparseable_last_seen()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Stat(lastSeenAt: string.Empty) })).Rows);

        Assert.Equal(EmDash, row.LastSeenText);
    }

    [Fact]
    public void Formats_value_kind_label_with_neutral_chip()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Stat(valueKind: 6) })).Rows);

        Assert.Equal("float64", row.KindText);
        Assert.Equal(StatusKind.Neutral, row.KindStatus);
    }

    [Theory]
    [InlineData(0, "unknown")]
    [InlineData(1, "string")]
    [InlineData(2, "bool")]
    [InlineData(3, "int32")]
    [InlineData(4, "int64")]
    [InlineData(5, "float32")]
    [InlineData(6, "float64")]
    [InlineData(7, "enum")]
    [InlineData(8, "invalid")]
    [InlineData(9, "time")]
    [InlineData(10, "location")]
    [InlineData(42, "kind 42")]
    public void Value_kind_label_mirrors_the_web_switch(int kind, string expected)
    {
        Assert.Equal(expected, XRayValueKind.Format(kind));
    }

    // ── Columns: four keys with the web render hints ────────────────────────────────────────────────

    [Fact]
    public void Columns_match_the_web_four_columns()
    {
        var columns = Project(Model(rows: new[] { Stat() })).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((XRayFieldsTableProjection.FieldKey, "Field"), (c.Key, c.Header)),
            c => Assert.Equal((XRayFieldsTableProjection.SampleCountKey, "Samples"), (c.Key, c.Header)),
            c => Assert.Equal((XRayFieldsTableProjection.LastSeenKey, "Last seen"), (c.Key, c.Header)),
            c => Assert.Equal((XRayFieldsTableProjection.ValueKindKey, "Kind"), (c.Key, c.Header)));
    }

    [Fact]
    public void Column_render_hints_match_the_web()
    {
        var columns = Project(Model(rows: new[] { Stat() })).Columns;

        Assert.True(columns[0].Mono);     // field — font-mono
        Assert.False(columns[0].Numeric);
        Assert.True(columns[1].Numeric);  // sample_count — align right
        Assert.True(columns[3].Badge);    // value_kind — Badge
    }

    // ── i18n: every label resolves through its P1/S10 catalog key ───────────────────────────────────

    [Fact]
    public void Column_headers_resolve_through_the_catalog_keys()
    {
        var display = XRayFieldsTableProjection.Project(
            Model(rows: new[] { Stat() }), XRayFieldsSort.Default, new PrefixLocalizer(), Now);

        Assert.Collection(
            display.Columns,
            c => Assert.Equal("L:translation.admin.xray.fields.cols.field", c.Header),
            c => Assert.Equal("L:translation.admin.xray.fields.cols.count", c.Header),
            c => Assert.Equal("L:translation.admin.xray.fields.cols.lastSeen", c.Header),
            c => Assert.Equal("L:translation.admin.xray.fields.cols.kind", c.Header));
    }

    [Fact]
    public void Loading_copy_resolves_through_its_catalog_key()
    {
        var display = XRayFieldsTableProjection.Project(
            Model(loading: true), XRayFieldsSort.Default, new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.admin.xray.fields.loading", display.EmptyMessage);
    }

    [Fact]
    public void Empty_copy_resolves_through_its_catalog_key()
    {
        var display = XRayFieldsTableProjection.Project(
            Model(loading: false), XRayFieldsSort.Default, new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.admin.xray.fields.empty", display.EmptyMessage);
    }

    [Fact]
    public void Surface_title_resolves_through_its_catalog_key()
    {
        var display = XRayFieldsTableProjection.Project(
            Model(rows: new[] { Stat() }), XRayFieldsSort.Default, new PrefixLocalizer(), Now);

        Assert.Contains("L:translation.admin.xray.panels.fields", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Accessibility: every state + every row exposes a non-empty Narrator name ────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model(loading: true)),
                Project(Model(loading: false)),
                Project(Model(rows: new[] { Stat() })),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Data_rows_each_expose_a_descriptive_automation_name()
    {
        var rows = Project(Model(rows: new[]
        {
            Stat(field: "VehicleSpeed", sampleCount: 12, valueKind: 6),
            Stat(field: "BatteryLevel", sampleCount: 7, valueKind: 3),
        })).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("BatteryLevel", rows[1].AutomationName, StringComparison.Ordinal);
        Assert.Contains("int32", rows[1].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_copy()
    {
        var display = Project(Model(loading: false));

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=XRayFieldsTable, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new XRayFieldsTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=XRayFieldsTable", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("XRayFieldsTable", XRayFieldsTableRegistration.Slug);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
