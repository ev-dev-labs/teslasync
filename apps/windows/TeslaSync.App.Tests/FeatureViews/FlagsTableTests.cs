using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.FeatureFlags;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FlagsTable</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / data, with the web stale-while-revalidate data precedence), the
/// <c>previewValue</c> JSON preview, the <c>useSortToggle('key', 'asc')</c> key sort, the 25/50/100 pagination,
/// the row formatting + accessible names, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/feature-flags/FlagsTable.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class FlagsTableTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static FeatureFlagEntry Entry(string key, string json) => FeatureFlagEntry.FromJson(key, json);

    private static FlagsTableModel Model(params FeatureFlagEntry[] rows) => new(rows, false);

    private static FlagsTableModel LoadingModel(params FeatureFlagEntry[] rows) => new(rows, true);

    private static TableSortState SortKey()
    {
        var sort = new TableSortState();
        sort.Toggle(FlagsTableProjection.KeyColumnKey); // ascending (web useSortToggle('key', 'asc'))
        return sort;
    }

    private static FlagsTableDisplay Project(
        FlagsTableModel model,
        TableSortState? sort = null,
        int page = 1,
        int pageSize = FlagsTableProjection.DefaultPageSize) =>
        FlagsTableProjection.Project(model, Localizer, sort ?? SortKey(), page, pageSize);

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    // ── Branch selection: loading / empty / data (+ web stale-while-revalidate data precedence) ─────────

    [Fact]
    public void Loading_when_no_rows_and_loading()
    {
        Assert.Equal(FlagsTableState.Loading, Project(LoadingModel()).State);
    }

    [Fact]
    public void Empty_when_no_rows_and_not_loading()
    {
        Assert.Equal(FlagsTableState.Empty, Project(Model()).State);
    }

    [Fact]
    public void Data_when_rows_present()
    {
        Assert.Equal(FlagsTableState.Data, Project(Model(Entry("a", "1"))).State);
    }

    [Fact]
    public void Data_takes_precedence_over_loading_like_the_web()
    {
        // web: the DataTable keeps showing rows while a background refetch is in flight (emptyMessage only
        // shows when data is empty).
        Assert.Equal(FlagsTableState.Data, Project(LoadingModel(Entry("a", "1"))).State);
    }

    // ── Columns: three columns, key sortable (web sortable: true), value/actions not ────────────────────

    [Fact]
    public void Columns_match_the_web_three_columns()
    {
        var columns = Project(Model(Entry("a", "1"))).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((FlagsTableProjection.KeyColumnKey, "Flag key", true), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((FlagsTableProjection.ValueColumnKey, "Value", false), (c.Key, c.Header, c.Sortable)),
            c => Assert.Equal((FlagsTableProjection.ActionsColumnKey, "Actions", false), (c.Key, c.Header, c.Sortable)));
    }

    // ── previewValue: the web branch-by-branch rules ────────────────────────────────────────────────────

    [Fact]
    public void Preview_null_is_the_literal_null()
    {
        Assert.Equal("null", FlagsTableProjection.PreviewValue(Json("null")));
    }

    [Fact]
    public void Preview_undefined_is_em_dash()
    {
        Assert.Equal(EmDash, FlagsTableProjection.PreviewValue(default));
    }

    [Fact]
    public void Preview_string_is_json_quoted()
    {
        Assert.Equal("\"hello\"", FlagsTableProjection.PreviewValue(Json("\"hello\"")));
    }

    [Theory]
    [InlineData("42", "42")]
    [InlineData("3.14", "3.14")]
    [InlineData("-7", "-7")]
    public void Preview_number_is_string_value(string json, string expected)
    {
        Assert.Equal(expected, FlagsTableProjection.PreviewValue(Json(json)));
    }

    [Theory]
    [InlineData("true", "true")]
    [InlineData("false", "false")]
    public void Preview_boolean_is_lowercase_string_value(string json, string expected)
    {
        Assert.Equal(expected, FlagsTableProjection.PreviewValue(Json(json)));
    }

    [Fact]
    public void Preview_object_is_compact_json()
    {
        Assert.Equal("{\"a\":1,\"b\":true}", FlagsTableProjection.PreviewValue(Json("{ \"a\": 1, \"b\": true }")));
    }

    [Fact]
    public void Preview_array_is_compact_json()
    {
        Assert.Equal("[1,2,3]", FlagsTableProjection.PreviewValue(Json("[1, 2, 3]")));
    }

    [Fact]
    public void Preview_long_object_is_truncated_with_ellipsis()
    {
        var preview = FlagsTableProjection.PreviewValue(Json($"{{\"k\":\"{new string('x', 200)}\"}}"));

        Assert.EndsWith("\u2026", preview, StringComparison.Ordinal);
        Assert.Equal(118, preview.Length); // web: slice(0, 117) + '…'
    }

    [Fact]
    public void Preview_long_string_is_not_truncated_like_the_web()
    {
        // web previewValue returns JSON.stringify(value) for strings *before* the truncation branch.
        var preview = FlagsTableProjection.PreviewValue(Json($"\"{new string('x', 200)}\""));

        Assert.DoesNotContain("\u2026", preview, StringComparison.Ordinal);
        Assert.Equal(202, preview.Length); // 200 chars + the two quotes
    }

    // ── Sorting: useSortToggle('key', 'asc') three-state toggle ─────────────────────────────────────────

    [Fact]
    public void Default_sort_is_key_ascending()
    {
        var rows = new[] { Entry("zebra", "1"), Entry("alpha", "2"), Entry("mango", "3") };

        var display = Project(Model(rows));

        Assert.Equal(SortDirection.Ascending, display.KeySortDirection);
        Assert.Equal(new[] { "alpha", "mango", "zebra" }, display.Rows.Select(r => r.Key));
    }

    [Fact]
    public void Descending_sort_reverses_keys()
    {
        var rows = new[] { Entry("zebra", "1"), Entry("alpha", "2"), Entry("mango", "3") };
        var sort = SortKey();
        sort.Toggle(FlagsTableProjection.KeyColumnKey); // ascending -> descending

        var display = Project(Model(rows), sort);

        Assert.Equal(SortDirection.Descending, display.KeySortDirection);
        Assert.Equal(new[] { "zebra", "mango", "alpha" }, display.Rows.Select(r => r.Key));
    }

    [Fact]
    public void Unsorted_preserves_the_original_order()
    {
        var rows = new[] { Entry("zebra", "1"), Entry("alpha", "2"), Entry("mango", "3") };
        var sort = SortKey();
        sort.Toggle(FlagsTableProjection.KeyColumnKey); // ascending -> descending
        sort.Toggle(FlagsTableProjection.KeyColumnKey); // descending -> none

        var display = Project(Model(rows), sort);

        Assert.Equal(SortDirection.None, display.KeySortDirection);
        Assert.Equal(new[] { "zebra", "alpha", "mango" }, display.Rows.Select(r => r.Key));
    }

    // ── Pagination: defaultPageSize 25, pageSizeOptions [25, 50, 100] ────────────────────────────────────

    [Fact]
    public void First_page_slices_to_the_page_size()
    {
        var rows = SixtyRows();

        var display = Project(Model(rows), page: 1, pageSize: 25);

        Assert.Equal(25, display.Rows.Count);
        Assert.Equal(60, display.TotalCount);
        Assert.Equal(3, display.PageCount);
        Assert.Equal(1, display.RangeStart);
        Assert.Equal(25, display.RangeEnd);
        Assert.Equal("k00", display.Rows[0].Key);
    }

    [Fact]
    public void Last_page_carries_the_remainder()
    {
        var rows = SixtyRows();

        var display = Project(Model(rows), page: 3, pageSize: 25);

        Assert.Equal(10, display.Rows.Count);
        Assert.Equal(51, display.RangeStart);
        Assert.Equal(60, display.RangeEnd);
        Assert.Equal("k50", display.Rows[0].Key);
    }

    [Fact]
    public void Page_size_50_reduces_the_page_count()
    {
        var rows = SixtyRows();

        var display = Project(Model(rows), page: 1, pageSize: 50);

        Assert.Equal(50, display.Rows.Count);
        Assert.Equal(2, display.PageCount);
    }

    [Fact]
    public void Out_of_range_page_is_clamped()
    {
        var rows = SixtyRows();

        var display = Project(Model(rows), page: 99, pageSize: 25);

        Assert.Equal(3, display.Page);
        Assert.Equal(10, display.Rows.Count);
    }

    [Fact]
    public void Page_size_options_match_the_web_config()
    {
        Assert.Equal(new[] { 25, 50, 100 }, FlagsTableProjection.PageSizeOptions);
        Assert.Equal(25, FlagsTableProjection.DefaultPageSize);
        Assert.Equal(new[] { 25, 50, 100 }, Project(Model(Entry("a", "1"))).PageSizeOptions);
    }

    [Fact]
    public void Pagination_only_shows_in_the_data_state()
    {
        Assert.True(Project(Model(Entry("a", "1"))).ShowPagination);
        Assert.False(Project(Model()).ShowPagination);
        Assert.False(Project(LoadingModel()).ShowPagination);
    }

    // ── Row formatting + status messages ────────────────────────────────────────────────────────────────

    [Fact]
    public void Row_carries_key_value_preview_and_action_names()
    {
        var row = Assert.Single(Project(Model(Entry("feature.foo", "true"))).Rows);

        Assert.Equal("feature.foo", row.Key);
        Assert.Equal("feature.foo", row.KeyText);
        Assert.Equal("true", row.ValuePreview);
        Assert.Equal("Edit feature.foo", row.EditActionName);
        Assert.Equal("Delete feature.foo", row.DeleteActionName);
        Assert.Contains("feature.foo", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Status_message_resolves_loading_then_empty_then_blank()
    {
        Assert.Equal("Loading flags\u2026", Project(LoadingModel()).StatusMessage);
        Assert.Equal("No feature flags are set on this server.", Project(Model()).StatusMessage);
        Assert.Equal(string.Empty, Project(Model(Entry("a", "1"))).StatusMessage);
    }

    [Fact]
    public void Action_labels_resolve_through_the_facade()
    {
        var display = Project(Model(Entry("a", "1")));

        Assert.Equal("Edit", display.EditLabel);
        Assert.Equal("Delete", display.DeleteLabel);
    }

    // ── Accessibility: every state + every interactive row carries a Narrator name ──────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(LoadingModel()),
                Project(Model()),
                Project(Model(Entry("a", "1"))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Each_row_action_name_carries_the_flag_key()
    {
        var rows = Project(Model(Entry("k1", "1"), Entry("k2", "2"))).Rows;

        Assert.All(rows, row =>
        {
            Assert.Contains(row.Key, row.EditActionName, StringComparison.Ordinal);
            Assert.Contains(row.Key, row.DeleteActionName, StringComparison.Ordinal);
        });
    }

    // ── Diagnostics (P1/S11): view.opened slug=FlagsTable, PII-safe ─────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new FlagsTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FlagsTable", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("FlagsTable", FlagsTableRegistration.Slug);
    }

    // ── i18n: every key from the web source maps to a translation.* catalog key ─────────────────────────

    [Fact]
    public void I18n_keys_match_the_web_source_under_the_translation_namespace()
    {
        Assert.Equal("translation.admin.flags.cols.key", FlagsTableProjection.KeyHeaderKey);
        Assert.Equal("translation.admin.flags.cols.value", FlagsTableProjection.ValueHeaderKey);
        Assert.Equal("translation.admin.flags.cols.actions", FlagsTableProjection.ActionsHeaderKey);
        Assert.Equal("translation.admin.flags.actions.edit", FlagsTableProjection.EditLabelKey);
        Assert.Equal("translation.admin.flags.actions.delete", FlagsTableProjection.DeleteLabelKey);
        Assert.Equal("translation.admin.flags.table.loading", FlagsTableProjection.LoadingMessageKey);
        Assert.Equal("translation.admin.flags.table.empty", FlagsTableProjection.EmptyMessageKey);
    }

    private static FeatureFlagEntry[] SixtyRows() =>
        Enumerable.Range(0, 60)
            .Select(i => Entry($"k{i.ToString("D2", CultureInfo.InvariantCulture)}", i.ToString(CultureInfo.InvariantCulture)))
            .ToArray();
}
