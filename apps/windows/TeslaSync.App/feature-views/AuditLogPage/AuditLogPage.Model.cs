using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>AuditLogPage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/admin/pages/AuditLogPage.tsx). The web page runs the
/// <c>useAuditLog</c> query and renders, in precedence order, the loading spinner (web <c>logQuery.isLoading</c>),
/// the generic failure surface, the audit-entry table (web <c>rows.length &gt; 0</c>) and otherwise the "no audit
/// entries" empty state — with the HTTP 503 "subsystem not configured" case raising a distinct warning banner above
/// the panels (web <c>subsystemMissing</c>). This enum is the top-level summary the ledger/Narrator key off; per-region
/// visibility is still driven by the projected flags so each branch renders exactly as the web composes them.
/// </summary>
public enum AuditLogState
{
    /// <summary>The list query is in flight with no rows yet (web <c>logQuery.isLoading</c>) — the spinner shows.</summary>
    Loading,

    /// <summary>The query resolved with no rows (web <c>rows.length === 0</c>) — the empty state shows.</summary>
    Empty,

    /// <summary>The query failed with a non-503 error — the generic failure surface shows.</summary>
    Error,

    /// <summary>The query produced audit rows (web <c>rows.length &gt; 0</c>) — the table renders.</summary>
    Success,
}

/// <summary>
/// One audit-ledger row — the native mirror of the web <c>AuditLogRow</c>
/// (web/src/types/admin-operator-confidence.ts). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial object never throws. The <see cref="Before"/> / <see cref="After"/> snapshots round-trip
/// whether the server sent them as a JSON string or an embedded object. Pure data — no WinUI types — so the projection
/// is unit-tested without a UI host.
/// </summary>
public sealed record AuditLogRow(
    long Id,
    string Ts,
    string Actor,
    string? Category,
    string Action,
    string EntityType,
    long? EntityId,
    string? Detail,
    string? Ip,
    string? UserAgent,
    string? Before,
    string? After,
    string? TraceId,
    string? PrevRowHash,
    string? RowHash,
    bool? Success)
{
    /// <summary>Read one audit row from a JSON object, tolerating missing / null fields.</summary>
    public static AuditLogRow FromJson(JsonElement o)
    {
        return new AuditLogRow(
            Id: JsonReadHelpers.Long(o, "id") ?? 0,
            Ts: JsonReadHelpers.Str(o, "ts") ?? string.Empty,
            Actor: JsonReadHelpers.Str(o, "actor") ?? string.Empty,
            Category: JsonReadHelpers.Str(o, "category"),
            Action: JsonReadHelpers.Str(o, "action") ?? string.Empty,
            EntityType: JsonReadHelpers.Str(o, "entity_type") ?? string.Empty,
            EntityId: JsonReadHelpers.Long(o, "entity_id"),
            Detail: JsonReadHelpers.Str(o, "detail"),
            Ip: JsonReadHelpers.Str(o, "ip"),
            UserAgent: JsonReadHelpers.Str(o, "user_agent"),
            Before: AuditLogJson.RawOrString(o, "before"),
            After: AuditLogJson.RawOrString(o, "after"),
            TraceId: JsonReadHelpers.Str(o, "trace_id"),
            PrevRowHash: JsonReadHelpers.Str(o, "prev_row_hash"),
            RowHash: JsonReadHelpers.Str(o, "row_hash"),
            Success: JsonReadHelpers.Bool(o, "success"));
    }
}

/// <summary>
/// The hash-chain re-derivation result — the native mirror of the web <c>AuditChainVerifyResponse</c>: whether the
/// SHA-256 chain re-derived <see cref="Intact"/>, the first divergent row id (<see cref="FirstBadId"/>), the number of
/// rows checked (<see cref="RowsChecked"/>) and the echo of the <see cref="Since"/> / <see cref="Limit"/> bounds. Pure
/// data; parsing is null-tolerant.
/// </summary>
public sealed record AuditChainVerify(bool Intact, long FirstBadId, long RowsChecked, string Since, int Limit)
{
    /// <summary>Read the verify response from a JSON object, tolerating missing / null fields.</summary>
    public static AuditChainVerify FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return new AuditChainVerify(false, 0, 0, string.Empty, 0);
        }

        return new AuditChainVerify(
            Intact: JsonReadHelpers.Bool(o, "intact") ?? false,
            FirstBadId: JsonReadHelpers.Long(o, "first_bad_id") ?? 0,
            RowsChecked: JsonReadHelpers.Long(o, "rows_checked") ?? 0,
            Since: JsonReadHelpers.Str(o, "since") ?? string.Empty,
            Limit: JsonReadHelpers.Int(o, "limit") ?? 0);
    }
}

/// <summary>
/// The audit-log list envelope — the native mirror of the web <c>AuditLogListResponse</c>: the resolved
/// <see cref="Rows"/> plus the server-echoed page <see cref="Limit"/>, and a <see cref="HasData"/> marker recording
/// whether the server returned a body. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record AuditLogListSnapshot(bool HasData, IReadOnlyList<AuditLogRow> Rows, int Limit)
{
    /// <summary>The empty snapshot (no body yet) — the default local-state feed result.</summary>
    public static AuditLogListSnapshot Empty { get; } = new(false, Array.Empty<AuditLogRow>(), 0);

    /// <summary>Read the list response from JSON, tolerating missing / null fields.</summary>
    public static AuditLogListSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var rows = new List<AuditLogRow>();
        if (o.TryGetProperty("rows", out var rowsEl) && rowsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in rowsEl.EnumerateArray())
            {
                if (row.ValueKind == JsonValueKind.Object)
                {
                    rows.Add(AuditLogRow.FromJson(row));
                }
            }
        }

        return new AuditLogListSnapshot(true, rows, JsonReadHelpers.Int(o, "limit") ?? rows.Count);
    }
}

/// <summary>
/// The append-only filter state the page browses the ledger by — the native mirror of the web filter
/// <c>useState</c> set (since / until / category / action / actor / entity_type / limit). String fields are
/// empty=unset (never null) so the controlled inputs stay controlled, mirroring the web. Pure data.
/// </summary>
public sealed record AuditLogFilter(
    string Since,
    string Until,
    string Category,
    string Action,
    string Actor,
    string EntityType,
    int Limit)
{
    /// <summary>The default filter — no scope, the web default page size of 100.</summary>
    public static AuditLogFilter Default { get; } = new(
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        string.Empty,
        AuditLogRegistration.DefaultLimit);

    /// <summary>Whether any scope filter is active (used to colour the empty-state guidance).</summary>
    public bool HasAny =>
        Since.Length > 0 || Until.Length > 0 || Category.Length > 0 ||
        Action.Length > 0 || Actor.Length > 0 || EntityType.Length > 0;
}

/// <summary>
/// The render-time data model the <c>AuditLogPage</c> projects from — the native analogue of the web page's resolved
/// query state (web/src/features/admin/pages/AuditLogPage.tsx). It carries the list query result, the category/action
/// dropdown feeds, the active filter + paging cursor, the expanded-row set and the independent chain-verify
/// sub-state. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AuditLogModel(
    IReadOnlyList<AuditLogRow> Rows,
    int Limit,
    IReadOnlyList<string> Categories,
    IReadOnlyList<string> Actions,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing,
    AuditLogFilter Filter,
    int Offset,
    IReadOnlyCollection<long> Expanded,
    bool VerifyLoading,
    AuditChainVerify? VerifyResult,
    string? VerifyError)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static AuditLogModel Initial { get; } = new(
        Rows: Array.Empty<AuditLogRow>(),
        Limit: AuditLogRegistration.DefaultLimit,
        Categories: Array.Empty<string>(),
        Actions: Array.Empty<string>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false,
        Filter: AuditLogFilter.Default,
        Offset: 0,
        Expanded: Array.Empty<long>(),
        VerifyLoading: false,
        VerifyResult: null,
        VerifyError: null);
}

/// <summary>One value/label pair backing a filter dropdown (the web <c>Select</c> option). Pure data.</summary>
public sealed record AuditSelectOption(string Value, string Label);

/// <summary>The localized audit-table column headers (web <c>columns</c> header strings). Pure data.</summary>
public sealed record AuditColumnLabels(
    string Ts,
    string Actor,
    string Category,
    string Action,
    string Entity,
    string Detail,
    string Trace,
    string Success);

/// <summary>
/// The projected, render-ready expanded detail for one audit row (web <c>ExpandedDetail</c>): the IP / user-agent /
/// trace-id lines and the optional before/after snapshots and row hash, each with its localized caption. Pure data.
/// </summary>
public sealed record AuditExpandedDisplay(
    string IpLabel,
    string IpValue,
    string UserAgentLabel,
    string UserAgentValue,
    bool ShowTrace,
    string TraceLabel,
    string TraceValue,
    bool ShowBefore,
    string BeforeLabel,
    string BeforeJson,
    bool ShowAfter,
    string AfterLabel,
    string AfterJson,
    bool ShowHash,
    string HashLabel,
    string HashValue);

/// <summary>
/// The projected, render-ready view of one audit row (web <c>DataTable</c> row + its expanded detail): the formatted
/// timestamp + relative time, the actor / category / action / entity cells, the detail snippet, the trace chip, the
/// success badge and the expand toggle label, plus the expanded-detail payload. Pure data.
/// </summary>
public sealed record AuditRowDisplay(
    long Id,
    string Timestamp,
    string Relative,
    string Actor,
    bool ShowCategory,
    string Category,
    string Action,
    string EntityType,
    bool ShowEntityId,
    string EntityId,
    string Detail,
    bool ShowTrace,
    string TraceShort,
    string TraceId,
    string SuccessText,
    StatusKind SuccessVariant,
    bool IsExpanded,
    string ExpandLabel,
    string AutomationName,
    AuditExpandedDisplay Expanded);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every count formatted at the display boundary.
/// Holds the always-visible page header, the subsystem-unavailable banner, the four data-state flags, the hash-chain
/// integrity panel (verify button + hint / error / result), the filters panel (the seven filter controls + their
/// options) and the entries panel (pagination + the projected rows or the empty state). Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record AuditLogDisplay(
    AuditLogState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyTableText,
    // ── Panel 1: hash-chain integrity ──
    string IntegrityTitle,
    string VerifyButtonLabel,
    bool VerifyBusy,
    bool VerifyDisabled,
    bool ShowVerifyHint,
    string VerifyHint,
    bool ShowVerifyError,
    string VerifyErrorTitle,
    string VerifyErrorText,
    bool ShowVerifyResult,
    bool VerifyIntact,
    string VerifyBadgeLabel,
    StatusKind VerifyBadgeVariant,
    string VerifyRowsCheckedText,
    bool ShowFirstBad,
    string FirstBadText,
    // ── Panel 2: filters ──
    string FiltersTitle,
    string SinceLabel,
    string UntilLabel,
    string CategoryLabel,
    string ActionLabel,
    string ActorLabel,
    string ActorPlaceholder, // parity:allow projected web input-hint placeholder string (admin.auditLog.actorPlaceholder)
    string EntityTypeLabel,
    string EntityTypePlaceholder, // parity:allow projected web input-hint placeholder string (admin.auditLog.entityTypePlaceholder)
    string LimitLabel,
    string ResetLabel,
    string SearchLabel,
    IReadOnlyList<AuditSelectOption> CategoryOptions,
    IReadOnlyList<AuditSelectOption> ActionOptions,
    IReadOnlyList<AuditSelectOption> LimitOptions,
    string SelectedCategory,
    string SelectedAction,
    string SelectedLimit,
    string SinceValue,
    string UntilValue,
    string ActorValue,
    string EntityTypeValue,
    // ── Panel 3: entries ──
    string TableTitle,
    string PreviousLabel,
    string NextLabel,
    string PageInfoText,
    bool CanGoPrevious,
    bool CanGoNext,
    AuditColumnLabels Columns,
    IReadOnlyList<AuditRowDisplay> Rows,
    bool ShowRows,
    string CopyLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AuditLogModel"/> to its <see cref="AuditLogDisplay"/> — the native port of the
/// render logic in web/src/features/admin/pages/AuditLogPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; counts format through <see cref="NumberFormatting"/> and timestamps through
/// <see cref="DateTimeFormatting"/> (the web <c>formatDateTime</c> / <c>formatRelative</c>), so the C# output matches
/// the web truth. Every chrome string is resolved on every projection (visibility is gated by the returned flags), so
/// the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AuditLogProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static AuditLogDisplay Project(AuditLogModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.auditLog.pageTitle", "Audit Log");
        string subtitle = localizer.GetString(
            "admin.auditLog.subtitle",
            "Append-only audit ledger with SHA-256 hash chaining. Use the filter row to narrow scope and Verify Chain to re-derive integrity on demand.");

        // ── Subsystem-unavailable banner (web 503 subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.auditLog.notConfigured",
            "The audit log subsystem is not configured on this deployment.");

        // ── Generic failure surface (native InfoBar + Retry) ────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Loading + empty branches ────────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("admin.auditLog.emptyTitle", "No audit entries");
        string emptyMessage = localizer.GetString(
            "admin.auditLog.emptyMessage",
            "No rows match the current filter. Try widening the time range or clearing the filters.");
        string emptyTableText = localizer.GetString("admin.auditLog.emptyTable", "No entries");

        // ── Panel 1: hash-chain integrity (web GlassPanel 1) ────────────────────────────────────────────────
        string integrityTitle = localizer.GetString("admin.auditLog.integrityTitle", "Hash chain integrity");
        string verifyLabel = localizer.GetString("admin.auditLog.verifyButton", "Verify chain");
        string verifyingLabel = localizer.GetString("admin.auditLog.verifying", "Verifying\u2026");
        string verifyHint = localizer.GetString(
            "admin.auditLog.verifyHint",
            "Triggers a server-side re-derivation of every row_hash. No data is sent or written; this is read-only.");
        string verifyErrorTitle = localizer.GetString("admin.auditLog.verifyErrorTitle", "Verification failed");
        string chainIntact = localizer.GetString("admin.auditLog.chainIntact", "Chain intact");
        string chainBroken = localizer.GetString("admin.auditLog.chainBroken", "Chain broken");
        string rowsCheckedTemplate = localizer.GetString("admin.auditLog.rowsChecked", "{0} rows checked");
        string firstBadTemplate = localizer.GetString("admin.auditLog.firstBadId", "First bad row: #{0}");

        var verify = model.VerifyResult;
        bool showVerifyResult = verify is not null;
        bool showVerifyError = !string.IsNullOrEmpty(model.VerifyError);
        bool showVerifyHint = !model.VerifyLoading && verify is null && !showVerifyError;
        bool verifyIntact = verify?.Intact ?? false;
        string verifyBadgeLabel = verifyIntact ? chainIntact : chainBroken;
        StatusKind verifyBadgeVariant = verifyIntact ? StatusKind.Success : StatusKind.Danger;
        string rowsCheckedText = verify is null
            ? string.Empty
            : string.Format(CultureInfo.CurrentCulture, rowsCheckedTemplate, FormatCount(verify.RowsChecked));
        bool showFirstBad = verify is { Intact: false, FirstBadId: > 0 };
        string firstBadText = showFirstBad
            ? string.Format(CultureInfo.CurrentCulture, firstBadTemplate, verify!.FirstBadId.ToString(CultureInfo.CurrentCulture))
            : string.Empty;

        // ── Panel 2: filters (web GlassPanel 2) ─────────────────────────────────────────────────────────────
        string filtersTitle = localizer.GetString("admin.auditLog.filtersTitle", "Filters");
        string sinceLabel = localizer.GetString("admin.auditLog.sinceLabel", "Since");
        string untilLabel = localizer.GetString("admin.auditLog.untilLabel", "Until");
        string categoryLabel = localizer.GetString("admin.auditLog.categoryLabel", "Category");
        string actionLabel = localizer.GetString("admin.auditLog.actionLabel", "Action");
        string actorLabel = localizer.GetString("admin.auditLog.actorLabel", "Actor");
        string actorPlaceholder = localizer.GetString("admin.auditLog.actorPlaceholder", "e.g. admin@local"); // parity:allow required web i18n key admin.auditLog.actorPlaceholder
        string entityTypeLabel = localizer.GetString("admin.auditLog.entityTypeLabel", "Entity type");
        string entityTypePlaceholder = localizer.GetString("admin.auditLog.entityTypePlaceholder", "e.g. vehicle, alert_rule"); // parity:allow required web i18n key admin.auditLog.entityTypePlaceholder
        string limitLabel = localizer.GetString("admin.auditLog.limitLabel", "Rows per page");
        string resetLabel = localizer.GetString("admin.auditLog.resetFilters", "Reset");
        string searchLabel = localizer.GetString("admin.auditLog.applyFilters", "Search");
        string allCategories = localizer.GetString("admin.auditLog.allCategories", "All categories");
        string allActions = localizer.GetString("admin.auditLog.allActions", "All actions");

        var categoryOptions = BuildOptions(allCategories, model.Categories);
        var actionOptions = BuildOptions(allActions, model.Actions);

        // ── Panel 3: entries table (web GlassPanel 3) ───────────────────────────────────────────────────────
        string tableTitle = localizer.GetString("admin.auditLog.tableTitle", "Entries");
        string previousLabel = localizer.GetString("admin.auditLog.prevPage", "Previous");
        string nextLabel = localizer.GetString("admin.auditLog.nextPage", "Next");
        string pageInfoTemplate = localizer.GetString("admin.auditLog.pageInfo", "Showing {0}\u2013{1}");
        string showDetailsLabel = localizer.GetString("admin.auditLog.showDetails", "Details");
        string hideDetailsLabel = localizer.GetString("admin.auditLog.hideDetails", "Hide");
        string copyLabel = localizer.GetString("common.copy", "Copy");

        var columns = new AuditColumnLabels(
            Ts: localizer.GetString("admin.auditLog.colTs", "Timestamp"),
            Actor: localizer.GetString("admin.auditLog.colActor", "Actor"),
            Category: localizer.GetString("admin.auditLog.colCategory", "Category"),
            Action: localizer.GetString("admin.auditLog.colAction", "Action"),
            Entity: localizer.GetString("admin.auditLog.colEntity", "Entity"),
            Detail: localizer.GetString("admin.auditLog.colDetail", "Detail"),
            Trace: localizer.GetString("admin.auditLog.colTrace", "Trace"),
            Success: localizer.GetString("admin.auditLog.colSuccess", "Status"));

        // Expanded-detail captions (web ExpandedDetail) — resolved on every projection so the i18n contract holds.
        string ipLabel = localizer.GetString("admin.auditLog.detailIp", "IP");
        string uaLabel = localizer.GetString("admin.auditLog.detailUa", "User-agent");
        string traceLabel = localizer.GetString("admin.auditLog.detailTrace", "Trace ID");
        string beforeLabel = localizer.GetString("admin.auditLog.detailBefore", "Before");
        string afterLabel = localizer.GetString("admin.auditLog.detailAfter", "After");
        string hashLabel = localizer.GetString("admin.auditLog.detailHash", "Row hash");

        string okText = localizer.GetString("common.ok", "OK");
        string failText = localizer.GetString("common.fail", "Fail");

        var rows = new List<AuditRowDisplay>(model.Rows.Count);
        foreach (var row in model.Rows)
        {
            bool expanded = model.Expanded.Contains(row.Id);
            rows.Add(new AuditRowDisplay(
                Id: row.Id,
                Timestamp: FormatTimestamp(row.Ts, now),
                Relative: FormatRelative(row.Ts, now),
                Actor: string.IsNullOrEmpty(row.Actor) ? EmDash : row.Actor,
                ShowCategory: !string.IsNullOrEmpty(row.Category),
                Category: row.Category ?? string.Empty,
                Action: row.Action,
                EntityType: string.IsNullOrEmpty(row.EntityType) ? EmDash : row.EntityType,
                ShowEntityId: row.EntityId.HasValue,
                EntityId: row.EntityId.HasValue ? $"#{row.EntityId.Value.ToString(CultureInfo.CurrentCulture)}" : string.Empty,
                Detail: string.IsNullOrEmpty(row.Detail) ? EmDash : row.Detail!,
                ShowTrace: !string.IsNullOrEmpty(row.TraceId),
                TraceShort: ShortTrace(row.TraceId),
                TraceId: row.TraceId ?? string.Empty,
                SuccessText: SuccessText(row.Success, okText, failText),
                SuccessVariant: SuccessVariant(row.Success),
                IsExpanded: expanded,
                ExpandLabel: expanded ? hideDetailsLabel : showDetailsLabel,
                AutomationName: $"{FormatTimestamp(row.Ts, now)} {row.Action}".Trim(),
                Expanded: new AuditExpandedDisplay(
                    IpLabel: ipLabel,
                    IpValue: string.IsNullOrEmpty(row.Ip) ? EmDash : row.Ip!,
                    UserAgentLabel: uaLabel,
                    UserAgentValue: string.IsNullOrEmpty(row.UserAgent) ? EmDash : row.UserAgent!,
                    ShowTrace: !string.IsNullOrEmpty(row.TraceId),
                    TraceLabel: traceLabel,
                    TraceValue: row.TraceId ?? string.Empty,
                    ShowBefore: !string.IsNullOrEmpty(row.Before),
                    BeforeLabel: beforeLabel,
                    BeforeJson: FormatJson(row.Before),
                    ShowAfter: !string.IsNullOrEmpty(row.After),
                    AfterLabel: afterLabel,
                    AfterJson: FormatJson(row.After),
                    ShowHash: !string.IsNullOrEmpty(row.RowHash),
                    HashLabel: hashLabel,
                    HashValue: row.RowHash ?? string.Empty)));
        }

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool hasRows = model.Rows.Count > 0;
        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool showSubsystem = !model.Loading && model.SubsystemMissing;
        bool showRows = !model.Loading && !model.HasError && hasRows;
        bool showEmpty = !model.Loading && !model.HasError && !model.SubsystemMissing && !hasRows;

        AuditLogState state = showLoading
            ? AuditLogState.Loading
            : showError
                ? AuditLogState.Error
                : showRows
                    ? AuditLogState.Success
                    : AuditLogState.Empty;

        int from = hasRows ? model.Offset + 1 : 0;
        int to = model.Offset + model.Rows.Count;
        string pageInfo = string.Format(
            CultureInfo.CurrentCulture,
            pageInfoTemplate,
            from.ToString(CultureInfo.CurrentCulture),
            to.ToString(CultureInfo.CurrentCulture));

        return new AuditLogDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemUnavailable: showSubsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyTableText: emptyTableText,
            IntegrityTitle: integrityTitle,
            VerifyButtonLabel: model.VerifyLoading ? verifyingLabel : verifyLabel,
            VerifyBusy: model.VerifyLoading,
            VerifyDisabled: model.VerifyLoading,
            ShowVerifyHint: showVerifyHint,
            VerifyHint: verifyHint,
            ShowVerifyError: showVerifyError,
            VerifyErrorTitle: verifyErrorTitle,
            VerifyErrorText: model.VerifyError ?? string.Empty,
            ShowVerifyResult: showVerifyResult,
            VerifyIntact: verifyIntact,
            VerifyBadgeLabel: verifyBadgeLabel,
            VerifyBadgeVariant: verifyBadgeVariant,
            VerifyRowsCheckedText: rowsCheckedText,
            ShowFirstBad: showFirstBad,
            FirstBadText: firstBadText,
            FiltersTitle: filtersTitle,
            SinceLabel: sinceLabel,
            UntilLabel: untilLabel,
            CategoryLabel: categoryLabel,
            ActionLabel: actionLabel,
            ActorLabel: actorLabel,
            ActorPlaceholder: actorPlaceholder, // parity:allow web input-hint placeholder key (admin.auditLog.actorPlaceholder)
            EntityTypeLabel: entityTypeLabel,
            EntityTypePlaceholder: entityTypePlaceholder, // parity:allow web input-hint placeholder key (admin.auditLog.entityTypePlaceholder)
            LimitLabel: limitLabel,
            ResetLabel: resetLabel,
            SearchLabel: searchLabel,
            CategoryOptions: categoryOptions,
            ActionOptions: actionOptions,
            LimitOptions: AuditLogRegistration.LimitOptions,
            SelectedCategory: model.Filter.Category,
            SelectedAction: model.Filter.Action,
            SelectedLimit: model.Filter.Limit.ToString(CultureInfo.InvariantCulture),
            SinceValue: model.Filter.Since,
            UntilValue: model.Filter.Until,
            ActorValue: model.Filter.Actor,
            EntityTypeValue: model.Filter.EntityType,
            TableTitle: tableTitle,
            PreviousLabel: previousLabel,
            NextLabel: nextLabel,
            PageInfoText: pageInfo,
            CanGoPrevious: model.Offset > 0,
            CanGoNext: model.Rows.Count >= model.Limit && model.Limit > 0,
            Columns: columns,
            Rows: rows,
            ShowRows: showRows,
            CopyLabel: copyLabel,
            AutomationName: title);
    }

    /// <summary>Format a count with en-US grouping (web <c>{{count}}</c> interpolation).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format an absolute timestamp (web <c>formatDateTime</c>); em-dash for unparseable input.</summary>
    public static string FormatTimestamp(string? raw, DateTimeOffset now) =>
        DateTimeFormatting.Format(ParseTs(raw), DateTimeVariant.Full, now);

    /// <summary>Format a relative timestamp (web <c>formatRelative</c>); em-dash for unparseable input.</summary>
    public static string FormatRelative(string? raw, DateTimeOffset now) =>
        DateTimeFormatting.Format(ParseTs(raw), DateTimeVariant.Relative, now);

    /// <summary>Pretty-print a JSON snapshot (web <c>formatJSON</c>); the raw text when it is not valid JSON.</summary>
    public static string FormatJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            return JsonSerializer.Serialize(doc.RootElement, IndentedJson);
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    private static DateTimeOffset? ParseTs(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return value;
        }

        return null;
    }

    private static string ShortTrace(string? traceId)
    {
        if (string.IsNullOrEmpty(traceId))
        {
            return EmDash;
        }

        return traceId.Length <= 8 ? $"{traceId}\u2026" : $"{traceId[..8]}\u2026";
    }

    private static string SuccessText(bool? success, string okText, string failText) => success switch
    {
        true => okText,
        false => failText,
        _ => EmDash,
    };

    private static StatusKind SuccessVariant(bool? success) => success switch
    {
        true => StatusKind.Success,
        false => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static List<AuditSelectOption> BuildOptions(string allLabel, IReadOnlyList<string> values)
    {
        var options = new List<AuditSelectOption>(values.Count + 1) { new(string.Empty, allLabel) };
        foreach (var value in values)
        {
            options.Add(new AuditSelectOption(value, value));
        }

        return options;
    }
}

/// <summary>
/// The data port the <see cref="AuditLogPageViewModel"/> reads the audit ledger through — the native parity of the
/// web hooks <c>useAuditLog</c> / <c>useAuditCategories</c> / <c>useAuditActions</c> / <c>useAuditChainVerify</c>
/// (GET /admin/audit-log[/categories|/actions|/verify]). The view never performs HTTP itself; the default
/// <see cref="EmptyAuditLogFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="AuditLogClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing list fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the 503 subsystem-unavailable
/// banner distinctly from a generic failure, exactly as the web <c>subsystemMissing</c> check does.
/// </summary>
public interface IAuditLogFeed
{
    /// <summary>Resolve one page of audit rows for <paramref name="filter"/> at <paramref name="offset"/> (web <c>useAuditLog</c>).</summary>
    Task<AuditLogListSnapshot> FetchLogAsync(AuditLogFilter filter, int offset, CancellationToken cancellationToken);

    /// <summary>Resolve the distinct category facet (web <c>useAuditCategories</c>).</summary>
    Task<IReadOnlyList<string>> FetchCategoriesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the distinct action facet (web <c>useAuditActions</c>).</summary>
    Task<IReadOnlyList<string>> FetchActionsAsync(CancellationToken cancellationToken);

    /// <summary>Re-derive the hash chain for the most recent <paramref name="limit"/> rows (web <c>useAuditChainVerify</c>).</summary>
    Task<AuditChainVerify> VerifyChainAsync(int limit, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves the list/facets to empty and never verifies (the empty data state).</summary>
public sealed class EmptyAuditLogFeed : IAuditLogFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAuditLogFeed Instance { get; } = new();

    private EmptyAuditLogFeed()
    {
    }

    /// <inheritdoc />
    public Task<AuditLogListSnapshot> FetchLogAsync(AuditLogFilter filter, int offset, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AuditLogListSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<string>> FetchCategoriesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<string>> FetchActionsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
    }

    /// <inheritdoc />
    public Task<AuditChainVerify> VerifyChainAsync(int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new AuditChainVerify(true, 0, 0, string.Empty, limit));
    }
}

/// <summary>
/// Canonical metadata for the <c>AuditLogPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/AuditLogPage.tsx</c> (route <c>/admin/audit-log</c>, nav name <c>AuditLog</c>).
/// </summary>
public static class AuditLogRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AuditLogPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>AuditLog</c>).</summary>
    public const string RouteName = "AuditLog";

    /// <summary>The default page size (web <c>useState('100')</c>).</summary>
    public const int DefaultLimit = 100;

    /// <summary>The chain-verify scan bound (web <c>useAuditChainVerify(null, 1000, false)</c>).</summary>
    public const int VerifyLimit = 1000;

    /// <summary>The generated OpenAPI operation id for the audit-log list (web <c>useAuditLog</c>).</summary>
    public const string ListOperation = "get_api_v1_admin_audit_log";

    /// <summary>The generated OpenAPI operation id for the category facet (web <c>useAuditCategories</c>).</summary>
    public const string CategoriesOperation = "get_api_v1_admin_audit_log_categories";

    /// <summary>The generated OpenAPI operation id for the action facet (web <c>useAuditActions</c>).</summary>
    public const string ActionsOperation = "get_api_v1_admin_audit_log_actions";

    /// <summary>The generated OpenAPI operation id for the chain verify (web <c>useAuditChainVerify</c>).</summary>
    public const string VerifyOperation = "get_api_v1_admin_audit_log_verify";

    /// <summary>The page-size options (web <c>LIMIT_OPTIONS</c>): 50 / 100 / 250 / 500.</summary>
    public static IReadOnlyList<AuditSelectOption> LimitOptions { get; } =
    [
        new("50", "50"),
        new("100", "100"),
        new("250", "250"),
        new("500", "500"),
    ];

    /// <summary>The localized page title (web <c>admin.auditLog.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.auditLog.pageTitle", "Audit Log");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AuditLogPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an actor, IP, trace id or row hash — so a
/// diagnostics line can never leak audit content. Thread-safe.
/// </summary>
public sealed class AuditLogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AuditLogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AuditLogPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }

    private const string Slug = AuditLogRegistration.Slug;
}

/// <summary>Small null-tolerant JSON readers specific to the audit parsers (UI-free, unit-tested).</summary>
internal static class AuditLogJson
{
    /// <summary>Read a string array property (web <c>categories</c> / <c>actions</c>), dropping non-strings.</summary>
    public static IReadOnlyList<string> StrArray(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object ||
            !o.TryGetProperty(name, out var v) ||
            v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>();
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                string? s = item.GetString();
                if (!string.IsNullOrEmpty(s))
                {
                    list.Add(s);
                }
            }
        }

        return list;
    }

    /// <summary>
    /// Read a before/after snapshot that the server may send as a JSON string or an embedded object/array —
    /// returning the string verbatim, or the raw JSON text of an object/array, or null when absent.
    /// </summary>
    public static string? RawOrString(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Object or JsonValueKind.Array => v.GetRawText(),
            _ => null,
        };
    }
}
