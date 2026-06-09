using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.FeatureFlags;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChangesPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / data), the scoped-vs-global empty message, the row formatting (absolute
/// timestamp, em-dash fallbacks, the web <c>compact()</c> value truncation), the <c>OP_VARIANT</c> operation
/// mapping, the accessible names, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/feature-flags/ChangesPanel.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class ChangesPanelTests
{
    private const string EmDash = "\u2014";
    private const string Ellipsis = "\u2026";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static FeatureFlagChangeRow Row(
        string id = "1",
        string? changedAt = "2026-06-08T12:00:00Z",
        string? actor = "alice",
        string flagKey = "telemetry.enabled",
        string operation = "set",
        string? oldValue = "false",
        string? newValue = "true",
        string? reason = "rollout") =>
        new(id, changedAt, actor, flagKey, operation, oldValue, newValue, reason);

    private static ChangesPanelModel Model(
        IReadOnlyList<FeatureFlagChangeRow>? rows = null,
        bool loading = false,
        string? scopedKey = null) =>
        new(rows ?? Array.Empty<FeatureFlagChangeRow>(), loading, scopedKey);

    private static ChangesPanelDisplay Project(ChangesPanelModel model) =>
        ChangesPanelProjection.Project(model, Localizer, Now);

    // ── Branch selection: rows>0 → data; rows==0 → loading-or-empty (web source order) ──────────────

    [Fact]
    public void Empty_when_resolved_with_no_rows()
    {
        var display = Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: false));

        Assert.Equal(ChangesPanelState.Empty, display.State);
        Assert.Equal("No flag changes yet", display.EmptyTitle);
    }

    [Fact]
    public void Loading_when_loading_with_no_rows()
    {
        var display = Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: true));

        Assert.Equal(ChangesPanelState.Loading, display.State);
        Assert.Equal("Loading audit log\u2026", display.LoadingMessage);
    }

    [Fact]
    public void Data_when_rows_present()
    {
        var display = Project(Model(rows: new[] { Row(), Row(id: "2", flagKey: "ui.beta") }));

        Assert.Equal(ChangesPanelState.Data, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Data_takes_precedence_over_loading_when_rows_present()
    {
        // Web does not early-return when rows exist — it renders the table even while still loading.
        var display = Project(Model(rows: new[] { Row() }, loading: true));

        Assert.Equal(ChangesPanelState.Data, display.State);
    }

    // ── Empty message: scoped vs global (web `scopedKey ? scopedMessage : globalMessage`) ───────────

    [Fact]
    public void Global_empty_message_when_no_scope()
    {
        var display = Project(Model(scopedKey: null));

        Assert.Equal(ChangesPanelState.Empty, display.State);
        Assert.Contains("Flag changes will appear here", display.EmptyMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Scoped_empty_message_interpolates_the_key()
    {
        var display = Project(Model(scopedKey: "telemetry.enabled"));

        Assert.Equal(ChangesPanelState.Empty, display.State);
        Assert.Contains("No audit rows for", display.EmptyMessage, StringComparison.Ordinal);
        Assert.Contains("telemetry.enabled", display.EmptyMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_scope_falls_back_to_global_message()
    {
        // Web `scopedKey ?` is falsy for the empty string — it must select the global message.
        var display = Project(Model(scopedKey: string.Empty));

        Assert.Contains("Flag changes will appear here", display.EmptyMessage, StringComparison.Ordinal);
    }

    // ── Columns: the seven web columns, in order, with localized headers ────────────────────────────

    [Fact]
    public void Columns_match_the_web_seven_columns()
    {
        var columns = Project(Model(rows: new[] { Row() })).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((ChangesPanelProjection.ChangedAtKey, "Changed at"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.ActorKey, "Actor"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.FlagKeyKey, "Key"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.OperationKey, "Op"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.OldValueKey, "Old"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.NewValueKey, "New"), (c.Key, c.Header)),
            c => Assert.Equal((ChangesPanelProjection.ReasonKey, "Reason"), (c.Key, c.Header)));
    }

    // ── Row formatting: timestamp, em-dash fallbacks, value truncation ──────────────────────────────

    [Fact]
    public void Row_formats_changed_at_as_an_absolute_timestamp()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row() })).Rows);

        Assert.Equal("1", row.RowKey);
        Assert.Contains("2026", row.Cells[ChangesPanelProjection.ChangedAtKey], StringComparison.Ordinal);
        Assert.NotEqual(EmDash, row.Cells[ChangesPanelProjection.ChangedAtKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_missing_changed_at()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(changedAt: null) })).Rows);

        Assert.Equal(EmDash, row.Cells[ChangesPanelProjection.ChangedAtKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_missing_actor_else_passes_through()
    {
        var present = Assert.Single(Project(Model(rows: new[] { Row(actor: "bob") })).Rows);
        Assert.Equal("bob", present.Cells[ChangesPanelProjection.ActorKey]);

        var missing = Assert.Single(Project(Model(rows: new[] { Row(actor: null) })).Rows);
        Assert.Equal(EmDash, missing.Cells[ChangesPanelProjection.ActorKey]);
    }

    [Fact]
    public void Row_passes_through_flag_key()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(flagKey: "ui.dark_mode") })).Rows);

        Assert.Equal("ui.dark_mode", row.Cells[ChangesPanelProjection.FlagKeyKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_missing_reason()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(reason: null) })).Rows);

        Assert.Equal(EmDash, row.Cells[ChangesPanelProjection.ReasonKey]);
    }

    [Fact]
    public void Null_values_render_em_dash()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(oldValue: null, newValue: null) })).Rows);

        Assert.Equal(EmDash, row.Cells[ChangesPanelProjection.OldValueKey]);
        Assert.Equal(EmDash, row.Cells[ChangesPanelProjection.NewValueKey]);
    }

    [Fact]
    public void Short_values_pass_through_unchanged()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(oldValue: "false", newValue: "{\"a\":1}") })).Rows);

        Assert.Equal("false", row.Cells[ChangesPanelProjection.OldValueKey]);
        Assert.Equal("{\"a\":1}", row.Cells[ChangesPanelProjection.NewValueKey]);
    }

    [Fact]
    public void Long_values_are_truncated_to_57_chars_plus_ellipsis()
    {
        // Web compact(): s.length > 60 → s.slice(0, 57) + '…'.
        string longValue = new('x', 80);
        var row = Assert.Single(Project(Model(rows: new[] { Row(oldValue: longValue) })).Rows);

        string cell = row.Cells[ChangesPanelProjection.OldValueKey];
        Assert.Equal(58, cell.Length);
        Assert.EndsWith(Ellipsis, cell, StringComparison.Ordinal);
        Assert.Equal(new string('x', 57) + Ellipsis, cell);
    }

    [Fact]
    public void Value_at_the_60_char_boundary_is_not_truncated()
    {
        string boundary = new('y', 60);
        var row = Assert.Single(Project(Model(rows: new[] { Row(oldValue: boundary) })).Rows);

        Assert.Equal(boundary, row.Cells[ChangesPanelProjection.OldValueKey]);
    }

    // ── Operation: OP_VARIANT mapping + text pass-through ───────────────────────────────────────────

    [Theory]
    [InlineData("set", StatusKind.Success)]
    [InlineData("delete", StatusKind.Danger)]
    [InlineData("toggle", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    public void Operation_variant_maps_set_delete_and_falls_back_to_neutral(string operation, StatusKind expected)
    {
        var row = Assert.Single(Project(Model(rows: new[] { Row(operation: operation) })).Rows);

        Assert.Equal(expected, row.OperationStatus);
        Assert.Equal(operation, row.Cells[ChangesPanelProjection.OperationKey]);
    }

    // ── Accessibility: every state and every row exposes a Narrator name ────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: false)),
                Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: true)),
                Project(Model(rows: new[] { Row() })),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_message()
    {
        var display = Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: false));

        Assert.Contains(display.EmptyTitle, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_message()
    {
        var display = Project(Model(rows: Array.Empty<FeatureFlagChangeRow>(), loading: true));

        Assert.Equal(display.LoadingMessage, display.AutomationName);
    }

    [Fact]
    public void Data_rows_each_expose_a_descriptive_automation_name()
    {
        var rows = Project(Model(rows: new[]
        {
            Row(),
            Row(id: "2", flagKey: "ui.beta", operation: "delete"),
        })).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("ui.beta", rows[1].AutomationName, StringComparison.Ordinal);
        Assert.Contains("delete", rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── Configuration + diagnostics (P1/S11): view.opened slug=ChangesPanel, PII-safe ───────────────

    [Fact]
    public void Page_size_matches_the_web_default()
    {
        Assert.Equal(25, ChangesPanelProjection.PageSize);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChangesPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChangesPanel", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("ChangesPanel", ChangesPanelRegistration.Slug);
    }
}
