using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>AutomationListPage</c> surface — the native mirror of the data
/// states the web page renders (web/src/features/automations/pages/AutomationListPage.tsx). The web page runs the
/// <c>useAutomations</c> query and renders, in precedence order, the loading shimmer (web <c>isLoading</c>), the
/// failure surface (web <c>error</c>), the "no automations yet" empty state (web <c>automations.length === 0</c>) or
/// the bulk-selectable table (web <c>automations.map</c>). This enum is the top-level summary the ledger / Narrator
/// key off; per-region visibility is still driven by the projected flags so each branch renders exactly as the web
/// composes it.
/// </summary>
public enum AutomationListState
{
    /// <summary>The list query is in flight (web <c>isLoading</c>) — the panel shows the table shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no automations (web <c>automations.length === 0</c>) — the empty state shows.</summary>
    Empty,

    /// <summary>The query failed (web <c>error</c>) — the failure surface + retry shows.</summary>
    Error,

    /// <summary>The query produced rows (web <c>automations.length &gt; 0</c>) — the table renders.</summary>
    Success,
}

/// <summary>
/// One allowlisted bulk operation (web <c>AutomationBulkOp</c>): enable, disable or delete the selected automations.
/// </summary>
public enum AutomationBulkOp
{
    /// <summary>Enable every selected automation (web <c>op: 'enable'</c>).</summary>
    Enable,

    /// <summary>Disable every selected automation (web <c>op: 'disable'</c>).</summary>
    Disable,

    /// <summary>Delete every selected automation (web <c>op: 'delete'</c>, behind a confirm dialog).</summary>
    Delete,
}

/// <summary>
/// The tri-state of the master "select all" checkbox for the currently visible rows — the native mirror of the web
/// <c>useBulkSelection.masterState</c> ('none' / 'some' / 'all') that drives the header checkbox's indeterminate flag.
/// </summary>
public enum MasterSelectionState
{
    /// <summary>No visible row is selected.</summary>
    None,

    /// <summary>At least one (but not all) visible rows are selected (the indeterminate checkbox).</summary>
    Some,

    /// <summary>Every visible row is selected.</summary>
    All,
}

/// <summary>
/// One automation row — the native mirror of the web <c>Automation</c> fields the list view reads (id, name, optional
/// description, run count and enabled flag). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant (a missing <c>execution_count</c> reads as 0, matching the web <c>a.execution_count ?? 0</c>). Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AutomationRow(long Id, string Name, string? Description, long ExecutionCount, bool Enabled)
{
    /// <summary>Read one automation from a JSON object, tolerating missing / null fields.</summary>
    public static AutomationRow FromJson(JsonElement o) => new(
        Id: AutomationListJson.Long(o, "id") ?? 0,
        Name: AutomationListJson.Str(o, "name") ?? string.Empty,
        Description: AutomationListJson.Str(o, "description"),
        ExecutionCount: AutomationListJson.Long(o, "execution_count") ?? 0,
        Enabled: AutomationListJson.Bool(o, "enabled") ?? false);
}

/// <summary>
/// The automations-list envelope — the native mirror of the web <c>useAutomations</c> result: the parsed
/// <see cref="Automations"/> rows plus a <see cref="HasData"/> marker recording whether the server returned a
/// response (the web <c>query.data</c> presence test). The tolerant parser accepts either a bare JSON array (the
/// <c>writeJSON([]automationResponse)</c> wire shape) or the platform <c>{data:[…]}</c> envelope so the response
/// round-trips losslessly. Pure data.
/// </summary>
public sealed record AutomationListSnapshot(bool HasData, IReadOnlyList<AutomationRow> Automations)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static AutomationListSnapshot Empty { get; } = new(false, Array.Empty<AutomationRow>());

    /// <summary>
    /// Read the automations list from JSON, tolerating the platform <c>{data:[…]}</c> envelope and a bare array. A
    /// non-array payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static AutomationListSnapshot FromJson(JsonElement root)
    {
        JsonElement arr = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
        {
            arr = data;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var rows = new List<AutomationRow>();
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                rows.Add(AutomationRow.FromJson(element));
            }
        }

        return new AutomationListSnapshot(true, rows);
    }
}

/// <summary>
/// The result of a bulk operation — the native mirror of the web <c>AutomationBulkResult</c>
/// (<c>{ updated?, deleted?, failed: { id, reason }[] }</c>). Exactly one of <see cref="Updated"/> / <see cref="Deleted"/>
/// is populated by the server to match the verb; <see cref="Failed"/> is the count of per-id misses. Pure data;
/// parsing is null-tolerant and unwraps the platform <c>{data:…}</c> envelope.
/// </summary>
public sealed record AutomationBulkOutcome(int Updated, int Deleted, int Failed)
{
    /// <summary>The all-zero outcome (the default before any bulk op runs).</summary>
    public static AutomationBulkOutcome Empty { get; } = new(0, 0, 0);

    /// <summary>Read the bulk result from JSON, tolerating missing fields and the platform <c>{data:…}</c> envelope.</summary>
    public static AutomationBulkOutcome FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        int failed = 0;
        if (o.TryGetProperty("failed", out var f) && f.ValueKind == JsonValueKind.Array)
        {
            failed = f.GetArrayLength();
        }

        return new AutomationBulkOutcome(
            Updated: (int)(AutomationListJson.Long(o, "updated") ?? 0),
            Deleted: (int)(AutomationListJson.Long(o, "deleted") ?? 0),
            Failed: failed);
    }
}

/// <summary>
/// The data port the <see cref="AutomationListPageViewModel"/> reads automations through and runs bulk operations
/// against — the native parity of the web <c>useAutomations</c> (GET /automations) + <c>useBulkAutomationsUpdate</c>
/// (POST /automations/bulk) hooks. The view never performs HTTP itself; the default
/// <see cref="EmptyAutomationListFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="AutomationListClientFeed"/> binds to the generated OpenAPI contract client (ADR-004).
/// </summary>
public interface IAutomationListFeed
{
    /// <summary>Resolve the automations list (web <c>useAutomations</c>).</summary>
    Task<AutomationListSnapshot> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Run an allowlisted bulk operation against <paramref name="ids"/> (web <c>useBulkAutomationsUpdate</c>).</summary>
    Task<AutomationBulkOutcome> BulkUpdateAsync(IReadOnlyList<long> ids, AutomationBulkOp op, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves the list to the empty snapshot and every bulk op to the empty outcome.</summary>
public sealed class EmptyAutomationListFeed : IAutomationListFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAutomationListFeed Instance { get; } = new();

    private EmptyAutomationListFeed()
    {
    }

    /// <inheritdoc />
    public Task<AutomationListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AutomationListSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<AutomationBulkOutcome> BulkUpdateAsync(IReadOnlyList<long> ids, AutomationBulkOp op, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AutomationBulkOutcome.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>AutomationListPage</c> projects from — the native analogue of the web page's
/// resolved query + selection state (web/src/features/automations/pages/AutomationListPage.tsx). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Automations">The automations rows (web <c>automations</c>).</param>
/// <param name="SelectedIds">The currently selected automation ids (web <c>useBulkSelection.selectedIds</c>).</param>
/// <param name="Loading">Whether the list query is in flight with no data yet (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether the list query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="BulkBusy">Whether a bulk operation is currently in flight (web per-action pending flag).</param>
public sealed record AutomationListModel(
    IReadOnlyList<AutomationRow> Automations,
    IReadOnlySet<long> SelectedIds,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool BulkBusy)
{
    /// <summary>The initial model — the first load, no data yet, nothing selected.</summary>
    public static AutomationListModel Initial { get; } = new(
        Automations: Array.Empty<AutomationRow>(),
        SelectedIds: new HashSet<long>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        BulkBusy: false);
}

/// <summary>One projected, render-ready table row (web table <c>render</c> output): the formatted cells plus the row's selection state and accessible name.</summary>
public sealed record AutomationRowDisplay(
    long Id,
    string Name,
    string Description,
    string Runs,
    bool Enabled,
    string StatusLabel,
    StatusKind StatusKind,
    bool Selected,
    string SelectLabel);

/// <summary>One projected bulk-action button (web <c>BulkActionToolbar</c> action): its op, localized label, leading glyph and danger intent.</summary>
public sealed record AutomationBulkAction(AutomationBulkOp Op, string Label, string Glyph, bool IsDanger);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible page header, the four
/// data-state flags, the bulk-action toolbar (count + actions + clear + delete-confirm copy) and the table chrome
/// (column headers, master-checkbox label/state, the projected rows or the empty state). Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record AutomationListDisplay(
    AutomationListState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyCtaLabel,
    bool ShowTable,
    string NameHeader,
    string DescriptionHeader,
    string RunsHeader,
    string StatusHeader,
    string SelectAllLabel,
    string SelectRowLabel,
    MasterSelectionState MasterState,
    IReadOnlyList<AutomationRowDisplay> Rows,
    bool ShowBulkBar,
    int SelectedCount,
    string SelectedCountLabel,
    string ItemNoun,
    string ClearLabel,
    bool BulkBusy,
    IReadOnlyList<AutomationBulkAction> Actions,
    string DeleteConfirmTitle,
    string DeleteConfirmBody,
    string DeleteConfirmLabel,
    string DeleteCancelLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AutomationListModel"/> to its <see cref="AutomationListDisplay"/> — the native
/// port of the render logic in web/src/features/automations/pages/AutomationListPage.tsx. Every visible literal
/// resolves through the i18n facade using the exact web key names; the chrome strings (subtitle, column headers, the
/// status labels, the per-row select template, the delete-confirm copy, the bulk-action labels) are resolved on every
/// projection so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AutomationListProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literal.</summary>
    public const string EmDash = "\u2014";

    // The Segoe Fluent Icons glyphs for the three bulk actions (web Icons.play / pause / delete).
    private const string EnableGlyph = "\uE768";  // Play
    private const string DisableGlyph = "\uE769"; // Pause
    private const string DeleteGlyph = "\uE74D";  // Delete

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + selection state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static AutomationListDisplay Project(AutomationListModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("automationList.title", "Automations (list)");
        string subtitle = localizer.GetString(
            "automationList.subtitle",
            "Bulk-manage automations. Click an automation to edit it in the builder.");

        // ── Failure surface (web ErrorDisplay) ──────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Empty state (web EmptyState + actionTo) ─────────────────────────────────────────────────────────
        string emptyTitle = localizer.GetString("automationList.empty.title", "No automations yet");
        string emptyMessage = localizer.GetString("automationList.empty.body", "Create your first automation in the builder.");
        string emptyCta = localizer.GetString("automationList.empty.cta", "Open builder");

        // ── Table chrome (web thead column labels + bulk select labels) ─────────────────────────────────────
        string nameHeader = localizer.GetString("automationList.col.name", "Name");
        string descHeader = localizer.GetString("automationList.col.desc", "Description");
        string runsHeader = localizer.GetString("automationList.col.runs", "Runs");
        string statusHeader = localizer.GetString("automationList.col.status", "Status");
        string selectAll = localizer.GetString("bulk.selectAll", "Select all");
        string selectRow = localizer.GetString("bulk.selectRow", "Select row");
        string selectAutomationTemplate = localizer.GetString("automationList.selectAutomation", "Select automation {0}");

        // ── Status chip labels (web Badge enabled / disabled) ───────────────────────────────────────────────
        string enabledLabel = localizer.GetString("common.enabled", "Enabled");
        string disabledLabel = localizer.GetString("common.disabled", "Disabled");

        // ── Bulk-action toolbar (web BulkActionToolbar) ─────────────────────────────────────────────────────
        string nounOne = localizer.GetString("automationList.noun.one", "automation");
        string nounOther = localizer.GetString("automationList.noun.other", "automations");
        string clearLabel = localizer.GetString("bulk.clear", "Clear selection");
        var actions = new List<AutomationBulkAction>
        {
            new(AutomationBulkOp.Enable, localizer.GetString("automationList.bulk.enable", "Enable"), EnableGlyph, false),
            new(AutomationBulkOp.Disable, localizer.GetString("automationList.bulk.disable", "Disable"), DisableGlyph, false),
            new(AutomationBulkOp.Delete, localizer.GetString("automationList.bulk.delete", "Delete"), DeleteGlyph, true),
        };
        string deleteConfirmTitle = localizer.GetString("automationList.bulk.deleteConfirm.title", "Delete automations?");
        string deleteConfirmBody = localizer.GetString(
            "automationList.bulk.deleteConfirm.body",
            "Selected automations will stop running and be removed permanently. This cannot be undone.");
        string deleteConfirmLabel = localizer.GetString("common.delete", "Delete");
        string deleteCancelLabel = localizer.GetString("common.cancel", "Cancel");

        // ── Rows (web automations.map) ──────────────────────────────────────────────────────────────────────
        var rows = new List<AutomationRowDisplay>(model.Automations.Count);
        foreach (var row in model.Automations)
        {
            bool selected = model.SelectedIds.Contains(row.Id);
            rows.Add(new AutomationRowDisplay(
                Id: row.Id,
                Name: row.Name,
                Description: string.IsNullOrEmpty(row.Description) ? EmDash : row.Description!,
                Runs: row.ExecutionCount.ToString(CultureInfo.InvariantCulture),
                Enabled: row.Enabled,
                StatusLabel: row.Enabled ? enabledLabel : disabledLabel,
                StatusKind: row.Enabled ? StatusKind.Success : StatusKind.Neutral,
                Selected: selected,
                SelectLabel: string.Format(CultureInfo.CurrentCulture, selectAutomationTemplate, row.Name)));
        }

        // ── State selection (web render precedence: loading → error → empty → table) ─────────────────────────
        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool hasRows = model.Automations.Count > 0;
        bool showEmpty = !model.Loading && !model.HasError && !hasRows;
        bool showTable = !model.Loading && !model.HasError && hasRows;

        AutomationListState state = showLoading
            ? AutomationListState.Loading
            : showError
                ? AutomationListState.Error
                : hasRows
                    ? AutomationListState.Success
                    : AutomationListState.Empty;

        // ── Selection summary (web BulkActionToolbar count + master checkbox) ───────────────────────────────
        int selectedCount = CountSelected(model);
        string selectedCountLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("bulk.selected", "{0} selected"),
            selectedCount);
        string itemNoun = selectedCount == 1 ? nounOne : nounOther;
        MasterSelectionState masterState = ComputeMasterState(model);

        return new AutomationListDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: showLoading,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyCtaLabel: emptyCta,
            ShowTable: showTable,
            NameHeader: nameHeader,
            DescriptionHeader: descHeader,
            RunsHeader: runsHeader,
            StatusHeader: statusHeader,
            SelectAllLabel: selectAll,
            SelectRowLabel: selectRow,
            MasterState: masterState,
            Rows: rows,
            ShowBulkBar: selectedCount > 0,
            SelectedCount: selectedCount,
            SelectedCountLabel: selectedCountLabel,
            ItemNoun: itemNoun,
            ClearLabel: clearLabel,
            BulkBusy: model.BulkBusy,
            Actions: actions,
            DeleteConfirmTitle: deleteConfirmTitle,
            DeleteConfirmBody: deleteConfirmBody,
            DeleteConfirmLabel: deleteConfirmLabel,
            DeleteCancelLabel: deleteCancelLabel,
            AutomationName: title);
    }

    /// <summary>
    /// The master-checkbox tri-state for the visible rows (web <c>useBulkSelection.masterState</c>): none when no
    /// visible row is selected, all when every visible row is, otherwise some (the indeterminate state).
    /// </summary>
    public static MasterSelectionState ComputeMasterState(AutomationListModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.Automations.Count == 0)
        {
            return MasterSelectionState.None;
        }

        int hits = CountSelected(model);
        if (hits == 0)
        {
            return MasterSelectionState.None;
        }

        return hits == model.Automations.Count ? MasterSelectionState.All : MasterSelectionState.Some;
    }

    // Counts only selected ids that are still visible — matches the web toolbar count over the rendered rows.
    private static int CountSelected(AutomationListModel model)
    {
        int count = 0;
        foreach (var row in model.Automations)
        {
            if (model.SelectedIds.Contains(row.Id))
            {
                count++;
            }
        }

        return count;
    }
}

/// <summary>
/// Canonical metadata for the <c>AutomationListPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/automations/pages/AutomationListPage.tsx</c> (route <c>/automations/list</c>, nav name
/// <c>AutomationList</c>).
/// </summary>
public static class AutomationListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationListPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>AutomationList</c>).</summary>
    public const string RouteName = "AutomationList";

    /// <summary>The generated OpenAPI operation id for the list query (web <c>useAutomations</c>).</summary>
    public const string ListOperation = "get_api_v1_automations";

    /// <summary>The generated OpenAPI operation id for the bulk update (web <c>useBulkAutomationsUpdate</c>).</summary>
    public const string BulkOperation = "post_api_v1_automations_bulk";

    /// <summary>The route the empty-state call-to-action opens (web <c>actionTo /automations/new</c>).</summary>
    public const string BuilderRoute = "automations/new";

    /// <summary>The Segoe Fluent Icons glyph for the empty state (web automation icon).</summary>
    public const string EmptyGlyph = "\uE945"; // Lightning / automation

    /// <summary>The route a row's name link opens (web <c>to={`/automations/${id}`}</c>).</summary>
    public static string DetailRoute(long id) => $"automations/{id.ToString(CultureInfo.InvariantCulture)}";

    /// <summary>The wire op string the bulk endpoint expects (web <c>op</c>): enable / disable / delete.</summary>
    public static string Wire(AutomationBulkOp op) => op switch
    {
        AutomationBulkOp.Enable => "enable",
        AutomationBulkOp.Disable => "disable",
        AutomationBulkOp.Delete => "delete",
        _ => "enable",
    };

    /// <summary>The localized page title (web <c>automationList.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("automationList.title", "Automations (list)");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AutomationListPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation id, name or count — so a
/// diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class AutomationListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationListPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationListRegistration.Slug}");
    }
}

/// <summary>Null-tolerant JSON readers for the automations-list parsers (mirrors the sibling feature-view helpers).</summary>
internal static class AutomationListJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read an integer property, tolerating numeric or string-encoded values.</summary>
    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) => l,
            _ => null,
        };
    }

    /// <summary>Read a boolean property, or null when absent / not a boolean.</summary>
    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
