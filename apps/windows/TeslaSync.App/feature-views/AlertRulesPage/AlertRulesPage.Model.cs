using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>AlertRulesPage</c> surface — the native mirror of the four
/// data states the web page renders (web/src/features/notifications/pages/AlertRulesPage.tsx). The web page runs
/// the <c>useAlertRules</c> query and, in precedence order, shows the loading skeletons (web <c>isLoading</c>),
/// the failure surface (web <c>error</c> → <c>ErrorDisplay</c>), the empty state (web
/// <c>rules.length === 0</c>) and otherwise the rules table. This enum is the top-level summary the ledger /
/// Narrator key off; per-region visibility is still driven by the projected flags so each branch renders exactly
/// as the web composes them.
/// </summary>
public enum AlertRulesState
{
    /// <summary>The rules query is in flight (web <c>isLoading</c>) — the panel shows the skeletons.</summary>
    Loading,

    /// <summary>The rules query resolved with no rows (web <c>!isLoading &amp;&amp; rules.length === 0</c>).</summary>
    Empty,

    /// <summary>The rules query failed (web <c>error</c>) — the panel shows the error surface.</summary>
    Error,

    /// <summary>The rules query produced rows (web <c>rules.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// The tri-state of the master "select all" checkbox — the native mirror of the web
/// <c>useBulkSelection.masterState(visibleIds)</c> result (web/src/hooks/useBulkSelection.ts:
/// <c>'all' | 'some' | 'none'</c>). Maps onto a WinUI tri-state <c>CheckBox</c>: checked / indeterminate /
/// unchecked.
/// </summary>
public enum MasterSelectionState
{
    /// <summary>No visible row is selected (web <c>'none'</c>) — the box is unchecked.</summary>
    None,

    /// <summary>Some but not all visible rows are selected (web <c>'some'</c>) — the box is indeterminate.</summary>
    Some,

    /// <summary>Every visible row is selected (web <c>'all'</c>) — the box is checked.</summary>
    All,
}

/// <summary>
/// One alert rule row — the native mirror of the slice of the web <c>AlertRule</c> (web/src/api/types.ts) this
/// page reads: the id, the display <see cref="Name"/>, the <see cref="SignalName"/>, the wire-level
/// <see cref="Severity"/> (<c>info | warn | critical</c>) and the <see cref="Enabled"/> flag. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Id">The rule id (web <c>id</c>).</param>
/// <param name="Name">The rule display name (web <c>name</c>).</param>
/// <param name="SignalName">The signal the rule watches (web <c>signal_name</c>).</param>
/// <param name="Severity">The wire-level severity (web <c>severity</c>: <c>info | warn | critical</c>).</param>
/// <param name="Enabled">Whether the rule is active (web <c>enabled</c>).</param>
public sealed record AlertRule(long Id, string Name, string SignalName, string Severity, bool Enabled)
{
    /// <summary>Parse a rules JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<AlertRule> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertRule>();
        }

        var list = new List<AlertRule>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one rule from a JSON object, tolerating missing / null fields.</summary>
    public static AlertRule FromJson(JsonElement o) => new(
        Id: ReadLong(o, "id") ?? 0,
        Name: ReadString(o, "name") ?? string.Empty,
        SignalName: ReadString(o, "signal_name") ?? string.Empty,
        Severity: ReadString(o, "severity") ?? "info",
        Enabled: ReadBool(o, "enabled") ?? false);

    private static string? ReadString(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? ReadLong(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    private static bool? ReadBool(JsonElement o, string name)
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

/// <summary>
/// Canonical metadata + i18n keys for the <c>AlertRulesPage</c> feature surface — the native mirror of the web
/// page at <c>web/src/features/notifications/pages/AlertRulesPage.tsx</c> (route <c>/notifications/rules</c>, nav
/// name <c>NotificationsRules</c>). Carries the diagnostics slug, the nav route name, the rule-name max length
/// (web <c>maxLength={120}</c>) and every visible string's i18n key + verbatim English fallback the web
/// <c>t()</c> calls render. Every label flows through one keyed <see cref="ILocalizer.GetString"/> call site so
/// the resource keys are asserted in tests and resolved through the WinUI resource bridge in the app. UI-free so
/// it is asserted headlessly.
/// </summary>
public static class AlertRulesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AlertRulesPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>NotificationsRules</c>).</summary>
    public const string RouteName = "NotificationsRules";

    /// <summary>Maximum rule-name length accepted by the inline rename (web <c>maxLength={120}</c>).</summary>
    public const int NameMaxLength = 120;

    /// <summary>The native route the rule links + the "Open Alert Studio" affordances navigate to (web <c>/notifications/studio</c>, <c>/alert-studio?rule=</c>).</summary>
    public const string StudioRoutePath = "notifications/studio";

    /// <summary>Query parameter that pre-selects a rule in the studio (web <c>/alert-studio?rule={id}</c>).</summary>
    public const string StudioRuleParam = "rule";

    /// <summary>The localized page title (web <c>alertRules.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("alertRules.title", "Alert rules");
    }

    /// <summary>The localized page subtitle (web <c>alertRules.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "alertRules.subtitle",
            "Bulk-manage alert rules. Click a rule to edit it in Alert Studio.");
    }
}

/// <summary>The four localized rules-table column headers (web <c>alertRules.col.*</c>).</summary>
/// <param name="Name">Header for the rule-name column (web <c>alertRules.col.name</c>).</param>
/// <param name="Signal">Header for the signal column (web <c>alertRules.col.signal</c>).</param>
/// <param name="Severity">Header for the severity column (web <c>alertRules.col.severity</c>).</param>
/// <param name="Status">Header for the enabled/disabled column (web <c>alertRules.col.status</c>).</param>
public sealed record AlertRulesColumnLabels(string Name, string Signal, string Severity, string Status);

/// <summary>
/// The localized bulk-action copy the toolbar consumes — the native mirror of the web <c>actions</c> array +
/// <c>itemNoun</c> the page passes to <c>BulkActionToolbar</c>
/// (web/src/features/notifications/pages/AlertRulesPage.tsx): the enable / disable / delete labels, the
/// delete-confirmation title / body / confirm label, and the singular / plural rule noun. Resolved once so the
/// toolbar host wires them verbatim.
/// </summary>
/// <param name="Enable">Enable-action label (web <c>alertRules.bulk.enable</c>).</param>
/// <param name="Disable">Disable-action label (web <c>alertRules.bulk.disable</c>).</param>
/// <param name="Delete">Delete-action label (web <c>alertRules.bulk.delete</c>).</param>
/// <param name="DeleteConfirmTitle">Delete-confirmation title (web <c>alertRules.bulk.deleteConfirm.title</c>).</param>
/// <param name="DeleteConfirmBody">Delete-confirmation body (web <c>alertRules.bulk.deleteConfirm.body</c>).</param>
/// <param name="DeleteConfirmLabel">Delete-confirmation confirm button (web <c>common.delete</c>).</param>
/// <param name="NounOne">Singular rule noun (web <c>alertRules.noun.one</c>).</param>
/// <param name="NounOther">Plural rule noun (web <c>alertRules.noun.other</c>).</param>
public sealed record AlertRulesBulkLabels(
    string Enable,
    string Disable,
    string Delete,
    string DeleteConfirmTitle,
    string DeleteConfirmBody,
    string DeleteConfirmLabel,
    string NounOne,
    string NounOther);

/// <summary>
/// One projected, render-ready rules row — the native mirror of one web <c>&lt;tr&gt;</c>
/// (web/src/features/notifications/pages/AlertRulesPage.tsx). Carries the id, the display name, the signal, the
/// wire severity (the chip resolves its own colour + level label), the enabled flag with its localized status
/// label + semantic badge tint, the per-row selection flag, the deep-link to the studio and the interpolated
/// accessibility names (select-this-rule + rename-this-rule). Pure data so each field is asserted headlessly.
/// </summary>
/// <param name="Id">The rule id.</param>
/// <param name="Name">The rule display name (em-dash when blank).</param>
/// <param name="SignalName">The signal the rule watches (em-dash when blank).</param>
/// <param name="Severity">The wire severity feeding the severity chip.</param>
/// <param name="Enabled">Whether the rule is active.</param>
/// <param name="StatusLabel">The localized enabled/disabled label (web <c>common.enabled</c> / <c>common.disabled</c>).</param>
/// <param name="StatusVariant">The semantic badge tint for the status (enabled → success, disabled → neutral).</param>
/// <param name="IsSelected">Whether this row is in the current bulk selection.</param>
/// <param name="StudioRoute">The deep-link the rule name navigates to (web <c>/alert-studio?rule={id}</c>).</param>
/// <param name="SelectRuleLabel">The accessible name for the row checkbox (web <c>alertRules.selectRule</c>, name-interpolated).</param>
/// <param name="RenameLabel">The accessible name for the rename affordance (web <c>editableText.rename.alertRule</c>, name-interpolated).</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record AlertRuleRow(
    long Id,
    string Name,
    string SignalName,
    string Severity,
    bool Enabled,
    string StatusLabel,
    StatusKind StatusVariant,
    bool IsSelected,
    string StudioRoute,
    string SelectRuleLabel,
    string RenameLabel,
    string AutomationName);

/// <summary>
/// The render-time data model the <c>AlertRulesPage</c> projects from — the native analogue of the web page's
/// resolved query + bulk-selection state (web/src/features/notifications/pages/AlertRulesPage.tsx). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Items">The current rules (web <c>rules</c>).</param>
/// <param name="Loading">Whether the rules query is in flight (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether the rules query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface (web <c>getErrorMessage(error)</c>).</param>
/// <param name="SelectedIds">The ids currently in the bulk selection (web <c>sel.selectedIds</c>).</param>
/// <param name="NameError">When set, the inline-rename validation error to surface (web <c>validate</c> result).</param>
public sealed record AlertRulesModel(
    IReadOnlyList<AlertRule> Items,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    IReadOnlySet<long> SelectedIds,
    string? NameError)
{
    /// <summary>The initial pre-fetch model — loading, no rows, nothing selected (web first render).</summary>
    public static AlertRulesModel Initial { get; } = new(
        Array.Empty<AlertRule>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SelectedIds: new HashSet<long>(),
        NameError: null);
}

/// <summary>
/// The fully projected, render-ready view of the <c>AlertRulesPage</c> — everything the WinUI view needs to draw
/// every region with no further logic (web/src/features/notifications/pages/AlertRulesPage.tsx): the top-level
/// <see cref="State"/>, the per-region visibility flags, the page title / subtitle, the edit-conflict resource
/// label, the bulk-action copy, the column headers, the projected rows, the master-selection tri-state, the
/// select-all / select-row accessible names, the empty-state copy + CTA, the error copy + retry label, the
/// inline-rename validation message + the live error to show, and the "Open Alert Studio" affordance. Pure value
/// so every field is asserted without a UI host.
/// </summary>
public sealed record AlertRulesDisplay(
    AlertRulesState State,
    bool ShowLoading,
    bool HasError,
    bool ShowEmpty,
    bool ShowRows,
    string Title,
    string Subtitle,
    string EditConflictResourceLabel,
    AlertRulesBulkLabels BulkLabels,
    AlertRulesColumnLabels ColumnLabels,
    IReadOnlyList<AlertRuleRow> Rows,
    MasterSelectionState MasterState,
    string SelectAllLabel,
    string SelectRowLabel,
    int SelectedCount,
    int TotalCount,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyCtaLabel,
    string ErrorText,
    string RetryLabel,
    string NameTooLongMessage,
    string? NameError,
    bool HasNameError,
    string OpenStudioLabel,
    string StudioRoute);

/// <summary>
/// Pure projection from the resolved query + selection state to the render-ready <see cref="AlertRulesDisplay"/>
/// — the native port of the web page body (web/src/features/notifications/pages/AlertRulesPage.tsx). Selects the
/// top-level state in the web precedence order (loading → error → empty → table), resolves every visible string
/// through the localizer, projects each row (including the interpolated select / rename accessible names and the
/// studio deep-link), computes the master-selection tri-state and validates a candidate rename name. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class AlertRulesProjection
{
    /// <summary>The em-dash shown for a blank name / signal (web <c>{value || '—'}</c> idiom).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the model into the render-ready display, resolving every visible string through <paramref name="localizer"/>.</summary>
    /// <param name="model">The resolved query + selection state.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static AlertRulesDisplay Project(AlertRulesModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var rules = model.Items ?? Array.Empty<AlertRule>();
        var selected = model.SelectedIds ?? new HashSet<long>();
        var state = SelectState(model, rules.Count);

        var rows = new List<AlertRuleRow>(rules.Count);
        foreach (var rule in rules)
        {
            rows.Add(ProjectRow(rule, selected.Contains(rule.Id), localizer));
        }

        string nameTooLong = NameTooLongMessage(localizer);

        return new AlertRulesDisplay(
            State: state,
            ShowLoading: state == AlertRulesState.Loading,
            HasError: state == AlertRulesState.Error,
            ShowEmpty: state == AlertRulesState.Empty,
            ShowRows: state == AlertRulesState.Success,
            Title: AlertRulesRegistration.Title(localizer),
            Subtitle: AlertRulesRegistration.Subtitle(localizer),
            EditConflictResourceLabel: localizer.GetString("editConflict.resource.alertRules", "Your alert rules"),
            BulkLabels: BulkLabels(localizer),
            ColumnLabels: new AlertRulesColumnLabels(
                Name: localizer.GetString("alertRules.col.name", "Name"),
                Signal: localizer.GetString("alertRules.col.signal", "Signal"),
                Severity: localizer.GetString("alertRules.col.severity", "Severity"),
                Status: localizer.GetString("alertRules.col.status", "Status")),
            Rows: rows,
            MasterState: MasterState(rules, selected),
            SelectAllLabel: localizer.GetString("bulk.selectAll", "Select all"),
            SelectRowLabel: localizer.GetString("bulk.selectRow", "Select row"),
            SelectedCount: CountSelectedVisible(rules, selected),
            TotalCount: rules.Count,
            EmptyTitle: localizer.GetString("alertRules.empty.title", "No alert rules yet"),
            EmptyMessage: localizer.GetString("alertRules.empty.body", "Create your first alert rule in the Alert Studio."),
            EmptyCtaLabel: localizer.GetString("alertRules.empty.cta", "Open Alert Studio"),
            ErrorText: ErrorText(model.ErrorDetail, localizer),
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            NameTooLongMessage: nameTooLong,
            NameError: model.NameError,
            HasNameError: !string.IsNullOrEmpty(model.NameError),
            OpenStudioLabel: localizer.GetString("alertRules.openStudio", "Open Alert Studio"),
            StudioRoute: AlertRulesRegistration.StudioRoutePath);
    }

    /// <summary>Project one rule into its render-ready row, resolving the interpolated select / rename labels.</summary>
    /// <param name="rule">The source rule.</param>
    /// <param name="isSelected">Whether the row is in the current selection.</param>
    /// <param name="localizer">The i18n facade the row labels resolve through.</param>
    public static AlertRuleRow ProjectRow(AlertRule rule, bool isSelected, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(rule);
        ArgumentNullException.ThrowIfNull(localizer);

        // The name stays raw — it backs the inline editor (web EditableText value={r.name}); the em-dash display
        // is only used for the blank-name Narrator name. The signal is em-dashed when blank (defensive null-safety).
        string displayName = string.IsNullOrEmpty(rule.Name) ? EmDash : rule.Name;
        string signal = string.IsNullOrEmpty(rule.SignalName) ? EmDash : rule.SignalName;
        string statusLabel = rule.Enabled
            ? localizer.GetString("common.enabled", "Enabled")
            : localizer.GetString("common.disabled", "Disabled");

        string selectRule = Interpolate(
            localizer.GetString("alertRules.selectRule", "Select rule {0}"),
            rule.Name);
        string rename = Interpolate(
            localizer.GetString("editableText.rename.alertRule", "Rename alert rule {0}"),
            rule.Name);

        return new AlertRuleRow(
            Id: rule.Id,
            Name: rule.Name,
            SignalName: signal,
            Severity: string.IsNullOrEmpty(rule.Severity) ? "info" : rule.Severity,
            Enabled: rule.Enabled,
            StatusLabel: statusLabel,
            StatusVariant: StatusVariant(rule.Enabled),
            IsSelected: isSelected,
            StudioRoute: StudioRoute(rule.Id),
            SelectRuleLabel: selectRule,
            RenameLabel: rename,
            AutomationName: string.Join(". ", displayName, signal, statusLabel));
    }

    /// <summary>The semantic badge tint for a status (web <c>Badge variant="success" | "neutral"</c>).</summary>
    public static StatusKind StatusVariant(bool enabled) => enabled ? StatusKind.Success : StatusKind.Neutral;

    /// <summary>The deep-link a rule name navigates to (web <c>/alert-studio?rule={id}</c>, normalized to the native studio route).</summary>
    public static string StudioRoute(long id) => string.Create(
        CultureInfo.InvariantCulture,
        $"{AlertRulesRegistration.StudioRoutePath}?{AlertRulesRegistration.StudioRuleParam}={id}");

    /// <summary>The localized rename-too-long validation message (web <c>alertRules.error.nameTooLong</c>).</summary>
    public static string NameTooLongMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("alertRules.error.nameTooLong", "Max 120 characters");
    }

    /// <summary>
    /// Validate a candidate rename (web <c>validate={(next) =&gt; next.length &gt; 120 ? t(...) : null}</c>):
    /// returns the localized too-long message when the name exceeds
    /// <see cref="AlertRulesRegistration.NameMaxLength"/>, otherwise null.
    /// </summary>
    /// <param name="name">The candidate name.</param>
    /// <param name="localizer">The i18n facade the error message resolves through.</param>
    public static string? ValidateName(string? name, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return (name ?? string.Empty).Length > AlertRulesRegistration.NameMaxLength
            ? NameTooLongMessage(localizer)
            : null;
    }

    /// <summary>Resolve the bulk-action copy once (web <c>actions</c> labels + <c>itemNoun</c>).</summary>
    public static AlertRulesBulkLabels BulkLabels(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new AlertRulesBulkLabels(
            Enable: localizer.GetString("alertRules.bulk.enable", "Enable"),
            Disable: localizer.GetString("alertRules.bulk.disable", "Disable"),
            Delete: localizer.GetString("alertRules.bulk.delete", "Delete"),
            DeleteConfirmTitle: localizer.GetString("alertRules.bulk.deleteConfirm.title", "Delete alert rules?"),
            DeleteConfirmBody: localizer.GetString(
                "alertRules.bulk.deleteConfirm.body",
                "These rules will stop firing immediately. This cannot be undone."),
            DeleteConfirmLabel: localizer.GetString("common.delete", "Delete"),
            NounOne: localizer.GetString("alertRules.noun.one", "rule"),
            NounOther: localizer.GetString("alertRules.noun.other", "rules"));
    }

    /// <summary>The master-selection tri-state for the visible rows (web <c>sel.masterState(visibleIds)</c>).</summary>
    public static MasterSelectionState MasterState(IReadOnlyList<AlertRule> rules, IReadOnlySet<long> selected)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(selected);

        if (rules.Count == 0)
        {
            return MasterSelectionState.None;
        }

        int selectedVisible = CountSelectedVisible(rules, selected);
        if (selectedVisible == 0)
        {
            return MasterSelectionState.None;
        }

        return selectedVisible == rules.Count ? MasterSelectionState.All : MasterSelectionState.Some;
    }

    private static int CountSelectedVisible(IReadOnlyList<AlertRule> rules, IReadOnlySet<long> selected)
    {
        int count = 0;
        foreach (var rule in rules)
        {
            if (selected.Contains(rule.Id))
            {
                count++;
            }
        }

        return count;
    }

    // web order: isLoading dominates, then error, then the table's own empty / rows branch.
    private static AlertRulesState SelectState(AlertRulesModel model, int ruleCount)
    {
        if (model.Loading)
        {
            return AlertRulesState.Loading;
        }

        if (model.HasError)
        {
            return AlertRulesState.Error;
        }

        return ruleCount == 0 ? AlertRulesState.Empty : AlertRulesState.Success;
    }

    private static string ErrorText(string? detail, ILocalizer localizer)
    {
        string baseText = localizer.GetString("common.errorLoad", "Failed to load data");
        return string.IsNullOrEmpty(detail) ? baseText : string.Create(CultureInfo.CurrentCulture, $"{baseText}: {detail}");
    }

    private static string Interpolate(string template, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template.Replace("{{name}}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AlertRulesPage</c> surface (P1/S11 diagnostics contract). Alert rules carry
/// fleet-identifying signal names and rule names, so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never a rule id, name, or signal. Thread-safe; mirrors the
/// sibling feature-view pages' collectors.
/// </summary>
public sealed class AlertRulesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AlertRulesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertRulesPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={AlertRulesRegistration.Slug}"));
    }
}
