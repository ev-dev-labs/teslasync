using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AuditPanel</c> feature surface's UI-thread-free logic — the branch projection
/// (loading / empty / data), the scoped vs. global empty copy, the seven column renderers (absolute timestamp,
/// em-dash fallbacks, numeric DLQ id, result code), the <c>RESULT_VARIANT</c> status mapping, the accessible names,
/// the catalog-key flow, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/dlq-inspector/AuditPanel.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class AuditPanelTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static AuditRecord Record(
        long id = 1,
        string replayedAt = "2026-06-08T12:00:00Z",
        string actor = "ops@example.com",
        long dlqId = 42,
        string result = DlqReplayResultVariant.Ok,
        string dstTopic = "telemetry/VIN/v/Speed",
        string error = "",
        string traceId = "trace-abc") =>
        new(id, replayedAt, actor, dlqId, result, dstTopic, error, traceId);

    private static AuditPanelModel Model(
        IReadOnlyList<AuditRecord>? rows = null,
        bool loading = false,
        long? scopedDlqId = null) =>
        new(rows ?? Array.Empty<AuditRecord>(), loading, scopedDlqId);

    private static AuditPanelDisplay Project(AuditPanelModel model) =>
        AuditPanelProjection.Project(model, Localizer, Now);

    // ── Branch precedence: !loading && empty → Empty; loading && empty → Loading; rows → Data ───────

    [Fact]
    public void Loading_when_loading_and_no_rows()
    {
        var display = Project(Model(loading: true));

        Assert.Equal(AuditPanelState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_and_no_rows()
    {
        var display = Project(Model(loading: false));

        Assert.Equal(AuditPanelState.Empty, display.State);
    }

    [Fact]
    public void Data_when_rows_present()
    {
        var display = Project(Model(rows: new[] { Record(), Record(id: 2) }));

        Assert.Equal(AuditPanelState.Data, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Data_takes_precedence_over_loading_like_the_web()
    {
        // web returns the DataTable (with rows) whenever rows.length > 0, regardless of loading.
        var display = Project(Model(rows: new[] { Record() }, loading: true));

        Assert.Equal(AuditPanelState.Data, display.State);
    }

    // ── Empty state: scoped vs. global copy + title ─────────────────────────────────────────────────

    [Fact]
    public void Empty_uses_global_message_when_not_scoped()
    {
        var display = Project(Model(scopedDlqId: null));

        Assert.Equal("No replay attempts yet", display.EmptyTitle);
        Assert.Equal("Replay attempts will appear here once an operator triggers one.", display.EmptyMessage);
    }

    [Fact]
    public void Empty_uses_scoped_message_when_scoped()
    {
        var display = Project(Model(scopedDlqId: 7));

        Assert.Equal(
            "This entry has not been replayed. Use the Replay action above to send it back to its source topic.",
            display.EmptyMessage);
    }

    // ── Table empty message: loading text vs. empty title (web emptyMessage ternary) ────────────────

    [Fact]
    public void Table_empty_message_is_loading_text_while_loading()
    {
        var display = Project(Model(loading: true));

        Assert.Equal("Loading audit log\u2026", display.TableEmptyMessage);
        Assert.Equal(display.LoadingText, display.TableEmptyMessage);
    }

    [Fact]
    public void Table_empty_message_is_empty_title_when_resolved()
    {
        var display = Project(Model(rows: new[] { Record() }, loading: false));

        Assert.Equal("No replay attempts yet", display.TableEmptyMessage);
    }

    // ── Columns: the web seven columns, in order ────────────────────────────────────────────────────

    [Fact]
    public void Columns_match_the_web_seven_columns()
    {
        var columns = Project(Model(rows: new[] { Record() })).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((AuditPanelProjection.ReplayedAtKey, "Replayed at"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.ActorKey, "Actor"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.DlqIdKey, "DLQ ID"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.ResultKey, "Result"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.DstTopicKey, "Destination"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.ErrorKey, "Error"), (c.Key, c.Header)),
            c => Assert.Equal((AuditPanelProjection.TraceIdKey, "Trace ID"), (c.Key, c.Header)));
    }

    [Fact]
    public void Page_size_matches_the_web_default()
    {
        Assert.Equal(25, AuditPanelProjection.PageSize);
    }

    // ── Row formatting: absolute timestamp, numeric id, pass-through, em-dash fallbacks ─────────────

    [Fact]
    public void Row_formats_timestamp_absolutely_and_passes_through_fields()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Record() })).Rows);

        Assert.Equal(1L, row.RowKey);
        Assert.Contains("2026", row.Cells[AuditPanelProjection.ReplayedAtKey], StringComparison.Ordinal);
        Assert.NotEqual(EmDash, row.Cells[AuditPanelProjection.ReplayedAtKey]);
        Assert.Equal("ops@example.com", row.Cells[AuditPanelProjection.ActorKey]);
        Assert.Equal("42", row.Cells[AuditPanelProjection.DlqIdKey]);
        Assert.Equal("ok", row.Cells[AuditPanelProjection.ResultKey]);
        Assert.Equal("telemetry/VIN/v/Speed", row.Cells[AuditPanelProjection.DstTopicKey]);
        Assert.Equal("trace-abc", row.Cells[AuditPanelProjection.TraceIdKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_missing_string_fields()
    {
        var row = Assert.Single(Project(Model(rows: new[]
        {
            Record(replayedAt: "", actor: "", result: "", dstTopic: "", error: "", traceId: ""),
        })).Rows);

        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.ReplayedAtKey]);
        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.ActorKey]);
        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.ResultKey]);
        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.DstTopicKey]);
        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.ErrorKey]);
        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.TraceIdKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_unparseable_timestamp()
    {
        var row = Assert.Single(Project(Model(rows: new[] { Record(replayedAt: "not-a-date") })).Rows);

        Assert.Equal(EmDash, row.Cells[AuditPanelProjection.ReplayedAtKey]);
    }

    // ── RESULT_VARIANT: each known code → status, unknown → neutral ─────────────────────────────────

    [Theory]
    [InlineData(DlqReplayResultVariant.Ok, StatusKind.Success)]
    [InlineData(DlqReplayResultVariant.PublishFailed, StatusKind.Danger)]
    [InlineData(DlqReplayResultVariant.RateLimited, StatusKind.Warning)]
    [InlineData(DlqReplayResultVariant.Disabled, StatusKind.Warning)]
    [InlineData(DlqReplayResultVariant.NotFound, StatusKind.Neutral)]
    [InlineData(DlqReplayResultVariant.Unparseable, StatusKind.Danger)]
    public void Result_variant_maps_each_known_code(string result, StatusKind expected)
    {
        Assert.Equal(expected, DlqReplayResultVariant.For(result));
    }

    [Theory]
    [InlineData("")]
    [InlineData("something_new")]
    [InlineData(null)]
    public void Result_variant_unknown_falls_back_to_neutral(string? result)
    {
        Assert.Equal(StatusKind.Neutral, DlqReplayResultVariant.For(result));
    }

    [Fact]
    public void Row_result_status_reflects_the_variant_mapping()
    {
        var rows = Project(Model(rows: new[]
        {
            Record(id: 1, result: DlqReplayResultVariant.Ok),
            Record(id: 2, result: DlqReplayResultVariant.PublishFailed),
            Record(id: 3, result: "mystery"),
        })).Rows;

        Assert.Equal(StatusKind.Success, rows[0].ResultStatus);
        Assert.Equal(StatusKind.Danger, rows[1].ResultStatus);
        Assert.Equal(StatusKind.Neutral, rows[2].ResultStatus);
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
                Project(Model(rows: new[] { Record() })),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Empty_automation_name_carries_title_and_message()
    {
        var display = Project(Model(scopedDlqId: null));

        Assert.Contains(display.EmptyTitle, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_text()
    {
        var display = Project(Model(loading: true));

        Assert.Equal(display.LoadingText, display.AutomationName);
    }

    [Fact]
    public void Data_rows_each_expose_a_descriptive_automation_name()
    {
        var rows = Project(Model(rows: new[]
        {
            Record(),
            Record(id: 2, actor: "admin@example.com", result: DlqReplayResultVariant.PublishFailed),
        })).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("admin@example.com", rows[1].AutomationName, StringComparison.Ordinal);
        Assert.Contains("publish_failed", rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── i18n: every label resolves through its P1/S10 catalog key ───────────────────────────────────

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var display = AuditPanelProjection.Project(Model(scopedDlqId: 5), new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.admin.dlq.audit.empty.title", display.EmptyTitle);
        Assert.Equal("L:translation.admin.dlq.audit.empty.scopedMessage", display.EmptyMessage);
        Assert.Equal("L:translation.admin.dlq.audit.loading", display.LoadingText);
        Assert.Collection(
            display.Columns,
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.replayedAt", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.actor", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.dlqId", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.result", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.dstTopic", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.error", c.Header),
            c => Assert.Equal("L:translation.admin.dlq.audit.cols.traceId", c.Header));
    }

    [Fact]
    public void Global_empty_message_resolves_through_its_catalog_key()
    {
        var display = AuditPanelProjection.Project(Model(scopedDlqId: null), new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.admin.dlq.audit.empty.globalMessage", display.EmptyMessage);
    }

    // ── Diagnostics (P1/S11): view.opened slug=AuditPanel, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AuditPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AuditPanel", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("AuditPanel", AuditPanelRegistration.Slug);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
