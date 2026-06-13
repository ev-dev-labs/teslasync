using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>ScheduledExportsPanel</c> surface — the native mirror of the
/// three data states the web panel renders (web/src/features/system/pages/ScheduledExportsPanel.tsx). The web
/// panel runs the <c>useScheduledExports</c> query and, in precedence order, shows the loading skeletons (web
/// <c>isLoading</c>), the empty state (web <c>rows.length === 0</c>) and otherwise the schedules table. This enum
/// is the top-level summary the ledger / Narrator key off; per-region visibility is still driven by the projected
/// flags so each branch renders exactly as the web composes it.
/// </summary>
public enum ScheduledExportsState
{
    /// <summary>The list query is in flight on the first load (web <c>isLoading</c>) — the panel shows skeletons.</summary>
    Loading,

    /// <summary>The query resolved with no rows (web <c>!isLoading &amp;&amp; rows.length === 0</c>).</summary>
    Empty,

    /// <summary>The query produced rows (web <c>rows.length &gt; 0</c>) — the schedules table is shown.</summary>
    Success,
}

/// <summary>
/// One schedule's delivery dispatcher — the native mirror of the web typed <c>delivery</c> JSONB column
/// (<c>{ kind, target? }</c>). <see cref="Target"/> is required for <c>email</c> / <c>webhook</c> and ignored for
/// <c>download</c>.
/// </summary>
/// <param name="Kind">The delivery channel (<c>download | email | webhook</c>).</param>
/// <param name="Target">The email address / HTTPS URL, or null for downloads.</param>
public sealed record ScheduledExportDelivery(string Kind, string? Target);

/// <summary>
/// One row of <c>scheduled_exports</c> — the native mirror of the web <c>ScheduledExport</c> wire shape
/// (web/src/api/hooks/useExports.ts). Parsing is null-tolerant so a partial row never throws. Pure data (no WinUI
/// types) so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The schedule id (web <c>id</c>).</param>
/// <param name="Name">The schedule display name (web <c>name</c>).</param>
/// <param name="ExportType">The export domain (web <c>export_type</c>).</param>
/// <param name="Format">The serialization format (web <c>format</c>).</param>
/// <param name="VehicleId">The optional vehicle scope (web <c>vehicle_id</c>).</param>
/// <param name="Columns">The optional column allowlist (web <c>columns</c>).</param>
/// <param name="ScheduleCron">The 5-field cron expression (web <c>schedule_cron</c>).</param>
/// <param name="Delivery">The delivery dispatcher (web <c>delivery</c>).</param>
/// <param name="RangeWindow">The look-back window (web <c>range_window</c>).</param>
/// <param name="Enabled">Whether the schedule is active (web <c>enabled</c>).</param>
/// <param name="LastRunAt">ISO-8601 last-run instant, or null (web <c>last_run_at</c>).</param>
/// <param name="LastStatus">The last run outcome (<c>ok | failed</c>) or null (web <c>last_status</c>).</param>
/// <param name="NextRunAt">ISO-8601 next-run instant, or null (web <c>next_run_at</c>).</param>
public sealed record ScheduledExport(
    long Id,
    string Name,
    string ExportType,
    string Format,
    long? VehicleId,
    IReadOnlyList<string>? Columns,
    string ScheduleCron,
    ScheduledExportDelivery Delivery,
    string RangeWindow,
    bool Enabled,
    string? LastRunAt,
    string? LastStatus,
    string? NextRunAt)
{
    /// <summary>The parsed next-run instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? NextRunTime => ParseTimestamp(NextRunAt);

    /// <summary>The parsed last-run instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastRunTime => ParseTimestamp(LastRunAt);

    /// <summary>Parse a schedules JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<ScheduledExport> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ScheduledExport>();
        }

        var list = new List<ScheduledExport>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one schedule from a JSON object, tolerating missing / null fields.</summary>
    public static ScheduledExport FromJson(JsonElement o) => new(
        Id: ReadLong(o, "id") ?? 0,
        Name: ReadString(o, "name") ?? string.Empty,
        ExportType: ReadString(o, "export_type") ?? string.Empty,
        Format: ReadString(o, "format") ?? string.Empty,
        VehicleId: ReadLong(o, "vehicle_id"),
        Columns: ReadStringList(o, "columns"),
        ScheduleCron: ReadString(o, "schedule_cron") ?? string.Empty,
        Delivery: ReadDelivery(o),
        RangeWindow: ReadString(o, "range_window") ?? string.Empty,
        Enabled: ReadBool(o, "enabled") ?? false,
        LastRunAt: ReadString(o, "last_run_at"),
        LastStatus: ReadString(o, "last_status"),
        NextRunAt: ReadString(o, "next_run_at"));

    private static ScheduledExportDelivery ReadDelivery(JsonElement o)
    {
        if (o.TryGetProperty("delivery", out var d) && d.ValueKind == JsonValueKind.Object)
        {
            return new ScheduledExportDelivery(
                Kind: ReadString(d, "kind") ?? "download",
                Target: ReadString(d, "target"));
        }

        return new ScheduledExportDelivery("download", null);
    }

    private static string? ReadString(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<string>? ReadStringList(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var list = new List<string>(v.GetArrayLength());
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                list.Add(item.GetString() ?? string.Empty);
            }
        }

        return list;
    }

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

    private static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The editable create / update form state — the native mirror of the web <c>ScheduledExportInput</c>
/// (web/src/api/hooks/useExports.ts) the inline "New schedule" form binds to. Pure value so the form flow is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Name">The schedule name (web <c>name</c>).</param>
/// <param name="ExportType">The export domain (web <c>export_type</c>).</param>
/// <param name="Format">The serialization format (web <c>format</c>).</param>
/// <param name="ScheduleCron">The 5-field cron expression (web <c>schedule_cron</c>).</param>
/// <param name="RangeWindow">The look-back window (web <c>range_window</c>).</param>
/// <param name="DeliveryKind">The delivery channel (web <c>delivery.kind</c>).</param>
/// <param name="DeliveryTarget">The delivery target (web <c>delivery.target</c>).</param>
/// <param name="Enabled">Whether the schedule is active (web <c>enabled</c>).</param>
/// <param name="VehicleId">The optional vehicle scope carried through edits (web <c>vehicle_id</c>).</param>
/// <param name="Columns">The optional column allowlist carried through edits (web <c>columns</c>).</param>
public sealed record ScheduledExportFormState(
    string Name,
    string ExportType,
    string Format,
    string ScheduleCron,
    string RangeWindow,
    string DeliveryKind,
    string DeliveryTarget,
    bool Enabled,
    long? VehicleId,
    IReadOnlyList<string>? Columns)
{
    /// <summary>A blank form (web <c>emptyInput()</c>): drives / csv weekly download over a 7-day window.</summary>
    public static ScheduledExportFormState Empty() => new(
        Name: string.Empty,
        ExportType: ScheduledExportsRegistration.ExportTypes[0],
        Format: ScheduledExportsRegistration.Formats[0],
        ScheduleCron: ScheduledExportsRegistration.DefaultCron,
        RangeWindow: ScheduledExportsRegistration.DefaultRangeWindow,
        DeliveryKind: ScheduledExportsRegistration.DeliveryKinds[0],
        DeliveryTarget: string.Empty,
        Enabled: true,
        VehicleId: null,
        Columns: null);

    /// <summary>Seed the form from an existing row for editing (web <c>inputFromRow(row)</c>).</summary>
    public static ScheduledExportFormState FromRow(ScheduledExport row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return new ScheduledExportFormState(
            Name: row.Name,
            ExportType: row.ExportType,
            Format: row.Format,
            ScheduleCron: row.ScheduleCron,
            RangeWindow: row.RangeWindow,
            DeliveryKind: row.Delivery.Kind,
            DeliveryTarget: row.Delivery.Target ?? string.Empty,
            Enabled: row.Enabled,
            VehicleId: row.VehicleId,
            Columns: row.Columns);
    }

    /// <summary>
    /// Build the wire payload (web <c>submit</c>): the optional <c>target</c> is dropped for download deliveries so
    /// an unused string never round-trips, and is trimmed for email / webhook.
    /// </summary>
    internal ScheduledExportPayload ToPayload()
    {
        var delivery = string.Equals(DeliveryKind, "download", StringComparison.Ordinal)
            ? new ScheduledExportDeliveryPayload("download")
            : new ScheduledExportDeliveryPayload(DeliveryKind) { Target = (DeliveryTarget ?? string.Empty).Trim() };

        return new ScheduledExportPayload(
            Name: Name,
            ExportType: ExportType,
            Format: Format,
            ScheduleCron: ScheduleCron,
            Delivery: delivery,
            RangeWindow: RangeWindow,
            Enabled: Enabled)
        {
            VehicleId = VehicleId,
            Columns = Columns,
        };
    }
}

/// <summary>
/// The <c>POST</c> / <c>PUT /scheduled-exports</c> request body — the native mirror of the web
/// <c>ScheduledExportInput</c> payload. JSON property names are pinned to the snake_case wire contract so the shape
/// is independent of the shared serializer's naming policy; <c>owner_subject</c> is intentionally absent (the
/// server takes ownership from the forward-auth header).
/// </summary>
internal sealed record ScheduledExportPayload(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("export_type")] string ExportType,
    [property: JsonPropertyName("format")] string Format,
    [property: JsonPropertyName("schedule_cron")] string ScheduleCron,
    [property: JsonPropertyName("delivery")] ScheduledExportDeliveryPayload Delivery,
    [property: JsonPropertyName("range_window")] string RangeWindow,
    [property: JsonPropertyName("enabled")] bool Enabled)
{
    /// <summary>Optional vehicle scope (web <c>vehicle_id</c>); omitted when null.</summary>
    [JsonPropertyName("vehicle_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? VehicleId { get; init; }

    /// <summary>Optional column allowlist (web <c>columns</c>); omitted when null.</summary>
    [JsonPropertyName("columns")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? Columns { get; init; }
}

/// <summary>The nested <c>delivery</c> body — <c>{ kind, target? }</c>; <c>target</c> is omitted for downloads.</summary>
/// <param name="Kind">The delivery channel.</param>
internal sealed record ScheduledExportDeliveryPayload(
    [property: JsonPropertyName("kind")] string Kind)
{
    /// <summary>The delivery target; omitted when null (download).</summary>
    [JsonPropertyName("target")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Target { get; init; }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>ScheduledExportsPanel</c> feature surface — the native mirror of the
/// web panel (web/src/features/system/pages/ScheduledExportsPanel.tsx). Carries the diagnostics slug, the
/// navigation route name, the generated-client operation ids, the form option lists + defaults, and the page
/// title / subtitle i18n keys. UI-free so it is asserted headlessly.
/// </summary>
public static class ScheduledExportsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ScheduledExportsPanel";

    /// <summary>The navigation route name this panel registers under (deep-link only; web is unrouted).</summary>
    public const string RouteName = "ScheduledExports";

    /// <summary>The deep-link path the shell maps to this surface.</summary>
    public const string RoutePath = "scheduled-exports";

    /// <summary>Generated client op for the list (web <c>useScheduledExports → GET /scheduled-exports</c>).</summary>
    public const string ListOperation = "get_api_v1_scheduled_exports";

    /// <summary>Generated client op for create (web <c>useCreateScheduledExport → POST /scheduled-exports</c>).</summary>
    public const string CreateOperation = "post_api_v1_scheduled_exports";

    /// <summary>Generated client op for update (web <c>useUpdateScheduledExport → PUT /scheduled-exports/{id}</c>).</summary>
    public const string UpdateOperation = "put_api_v1_scheduled_exports_id";

    /// <summary>Generated client op for delete (web <c>useDeleteScheduledExport → DELETE /scheduled-exports/{id}</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_scheduled_exports_id";

    /// <summary>Generated client op for run-now (web <c>useRunScheduledExportNow → POST /scheduled-exports/{id}/run</c>).</summary>
    public const string RunOperation = "post_api_v1_scheduled_exports_id_run";

    /// <summary>Default cron for a fresh schedule (web <c>emptyInput().schedule_cron</c>).</summary>
    public const string DefaultCron = "0 9 * * 0";

    /// <summary>Default look-back window for a fresh schedule (web <c>emptyInput().range_window</c>).</summary>
    public const string DefaultRangeWindow = "7d";

    /// <summary>The export-type options (web <c>EXPORT_TYPES</c>).</summary>
    public static IReadOnlyList<string> ExportTypes { get; } =
        new[] { "drives", "charging", "trips", "positions", "signals" };

    /// <summary>The format options (web <c>FORMATS</c>).</summary>
    public static IReadOnlyList<string> Formats { get; } = new[] { "csv", "json" };

    /// <summary>The delivery-kind options (web <c>DELIVERY_KINDS</c>).</summary>
    public static IReadOnlyList<string> DeliveryKinds { get; } = new[] { "download", "email", "webhook" };

    /// <summary>The localized panel title (web <c>dataExport.scheduled.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dataExport.scheduled.title", "Scheduled exports");
    }

    /// <summary>The localized panel subtitle (web <c>dataExport.scheduled.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dataExport.scheduled.subtitle", "Cron-driven recurring exports.");
    }
}

/// <summary>One drop-down option — the native mirror of a web <c>{ value, label }</c> select entry.</summary>
/// <param name="Value">The wire value.</param>
/// <param name="Label">The visible label (web maps each option's label to its value).</param>
public sealed record ScheduledExportOption(string Value, string Label);

/// <summary>
/// The localized inline-form copy — the native mirror of the web <c>dataExport.scheduled.form.*</c> labels +
/// help text. Resolved once so the form host wires them verbatim.
/// </summary>
/// <param name="NameLabel">Name field label.</param>
/// <param name="NameHint">Name field hint.</param>
/// <param name="CronLabel">Cron field label.</param>
/// <param name="CronHelp">Cron field help text.</param>
/// <param name="ExportTypeLabel">Export-type field label.</param>
/// <param name="FormatLabel">Format field label.</param>
/// <param name="RangeWindowLabel">Range-window field label.</param>
/// <param name="RangeWindowHelp">Range-window field help text.</param>
/// <param name="DeliveryKindLabel">Delivery-kind field label.</param>
/// <param name="DeliveryTargetLabel">Delivery-target field label.</param>
/// <param name="DeliveryTargetHelp">Delivery-target field help text.</param>
/// <param name="CancelLabel">Cancel button label.</param>
/// <param name="SubmitLabel">Save button label.</param>
public sealed record ScheduledExportsFormLabels(
    string NameLabel,
    string NameHint,
    string CronLabel,
    string CronHelp,
    string ExportTypeLabel,
    string FormatLabel,
    string RangeWindowLabel,
    string RangeWindowHelp,
    string DeliveryKindLabel,
    string DeliveryTargetLabel,
    string DeliveryTargetHelp,
    string CancelLabel,
    string SubmitLabel);

/// <summary>The eight localized schedules-table column headers (web <c>dataExport.scheduled.table.*</c>).</summary>
/// <param name="Name">Name column header.</param>
/// <param name="Type">Type column header.</param>
/// <param name="Cron">Cron column header.</param>
/// <param name="Delivery">Delivery column header.</param>
/// <param name="NextRun">Next-run column header.</param>
/// <param name="LastRun">Last-run column header.</param>
/// <param name="Status">Status column header.</param>
/// <param name="Actions">Actions column header.</param>
public sealed record ScheduledExportsColumnLabels(
    string Name,
    string Type,
    string Cron,
    string Delivery,
    string NextRun,
    string LastRun,
    string Status,
    string Actions);

/// <summary>The localized per-row action labels (web <c>dataExport.scheduled.actions.*</c>).</summary>
/// <param name="RunNow">Run-now action label.</param>
/// <param name="Enable">Enable action label.</param>
/// <param name="Disable">Disable action label.</param>
/// <param name="Edit">Edit action label.</param>
/// <param name="Delete">Delete action label.</param>
public sealed record ScheduledExportsActionLabels(
    string RunNow,
    string Enable,
    string Disable,
    string Edit,
    string Delete);

/// <summary>
/// One projected, render-ready schedules row — the native mirror of one web <c>&lt;tr&gt;</c>
/// (web/src/features/system/pages/ScheduledExportsPanel.tsx). Carries the id, the display name, the
/// type + format label, the cron string, the resolved delivery string, the formatted next-run / last-run cells,
/// the status badge tint + label (and whether a badge shows at all), the enabled flag with its toggle label, the
/// run-now busy flag and the composed accessibility name. Pure data so each field is asserted headlessly.
/// </summary>
/// <param name="Id">The schedule id.</param>
/// <param name="Name">The schedule display name.</param>
/// <param name="TypeLabel">The "type (format)" cell (web <c>{export_type} ({format})</c>).</param>
/// <param name="Cron">The cron expression cell.</param>
/// <param name="Delivery">The delivery cell (kind, plus "→ target" when present).</param>
/// <param name="NextRun">The formatted next-run cell (em-dash when absent).</param>
/// <param name="LastRun">The formatted last-run cell ("Never" when absent).</param>
/// <param name="StatusVariant">The semantic badge tint for the last status.</param>
/// <param name="StatusLabel">The localized last-status label (em-dash when unknown).</param>
/// <param name="HasStatusBadge">Whether a status badge shows (false → em-dash text).</param>
/// <param name="Enabled">Whether the schedule is active (disabled rows render dimmed).</param>
/// <param name="ToggleLabel">The enable/disable toggle label for this row.</param>
/// <param name="ToggleEnables">True when the toggle would enable a disabled row.</param>
/// <param name="IsRunning">Whether this row's run-now request is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record ScheduledExportRow(
    long Id,
    string Name,
    string TypeLabel,
    string Cron,
    string Delivery,
    string NextRun,
    string LastRun,
    StatusKind StatusVariant,
    string StatusLabel,
    bool HasStatusBadge,
    bool Enabled,
    string ToggleLabel,
    bool ToggleEnables,
    bool IsRunning,
    string AutomationName);

/// <summary>
/// The render-time data model the <c>ScheduledExportsPanel</c> projects from — the native analogue of the web
/// panel's resolved query + inline-form state (web/src/features/system/pages/ScheduledExportsPanel.tsx). Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Items">The current schedules (web <c>rows</c>).</param>
/// <param name="Loading">Whether the list query is in flight (web <c>isLoading</c>).</param>
/// <param name="ShowForm">Whether the inline create/edit form is open (web <c>showForm</c>).</param>
/// <param name="EditingId">The id being edited, or null for a create (web <c>editingId</c>).</param>
/// <param name="Form">The editable form state (web <c>form</c>).</param>
/// <param name="Submitting">Whether a create / update mutation is pending (web <c>create/update.isPending</c>).</param>
/// <param name="RunningId">The id whose run-now mutation is in flight, or null (web <c>runNow.variables</c>).</param>
/// <param name="Now">The clock used to format the run timestamps.</param>
public sealed record ScheduledExportsModel(
    IReadOnlyList<ScheduledExport> Items,
    bool Loading,
    bool ShowForm,
    long? EditingId,
    ScheduledExportFormState Form,
    bool Submitting,
    long? RunningId,
    DateTimeOffset Now)
{
    /// <summary>The initial pre-fetch model — loading, no rows, the form closed.</summary>
    public static ScheduledExportsModel Initial { get; } = new(
        Items: Array.Empty<ScheduledExport>(),
        Loading: true,
        ShowForm: false,
        EditingId: null,
        Form: ScheduledExportFormState.Empty(),
        Submitting: false,
        RunningId: null,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>
/// The fully projected, render-ready view of the <c>ScheduledExportsPanel</c> — everything the WinUI view needs to
/// draw every region with no further logic (web/src/features/system/pages/ScheduledExportsPanel.tsx): the
/// top-level <see cref="State"/>, the per-region visibility flags, the header (title / subtitle / new-schedule
/// button), the inline form (labels, option lists, current values, delivery-target visibility, submit busy flag),
/// the column headers, the action labels, the projected rows, the empty-state copy and the delete-confirmation
/// copy. Pure value so every field is asserted without a UI host.
/// </summary>
public sealed record ScheduledExportsDisplay(
    ScheduledExportsState State,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowRows,
    string Title,
    string Subtitle,
    string NewScheduleLabel,
    bool ShowForm,
    bool IsEditing,
    bool Submitting,
    bool ShowDeliveryTarget,
    ScheduledExportFormState Form,
    ScheduledExportsFormLabels FormLabels,
    IReadOnlyList<ScheduledExportOption> ExportTypeOptions,
    IReadOnlyList<ScheduledExportOption> FormatOptions,
    IReadOnlyList<ScheduledExportOption> DeliveryKindOptions,
    ScheduledExportsColumnLabels ColumnLabels,
    ScheduledExportsActionLabels ActionLabels,
    IReadOnlyList<ScheduledExportRow> Rows,
    string EmptyTitle,
    string EmptyMessage,
    string DeleteConfirmTitle,
    string DeleteConfirmBodyTemplate,
    string DeleteConfirmLabel,
    string DeleteCancelLabel)
{
    /// <summary>Resolve the delete-confirmation body for a specific schedule name (web <c>{{name}}</c> interpolation).</summary>
    public string DeleteConfirmBody(string name) =>
        DeleteConfirmBodyTemplate.Replace("{{name}}", name ?? string.Empty, StringComparison.Ordinal);
}

/// <summary>
/// Pure projection from the resolved query + inline-form state to the render-ready <see cref="ScheduledExportsDisplay"/>
/// — the native port of the web panel body (web/src/features/system/pages/ScheduledExportsPanel.tsx). Selects the
/// top-level state in the web precedence order (loading → empty → table), resolves every visible string through the
/// localizer, projects each row (type+format, delivery string, formatted run timestamps, status badge) and exposes
/// the form option lists. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ScheduledExportsProjection
{
    /// <summary>The em-dash shown for a blank / unknown cell (web <c>{value || '—'}</c> idiom).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the model into the render-ready display, resolving every visible string through <paramref name="localizer"/>.</summary>
    /// <param name="model">The resolved query + form state.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ScheduledExportsDisplay Project(ScheduledExportsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var items = model.Items ?? Array.Empty<ScheduledExport>();
        bool showLoading = model.Loading && items.Count == 0;
        bool showRows = !showLoading && items.Count > 0;
        bool showEmpty = !showLoading && items.Count == 0;

        var state = showLoading
            ? ScheduledExportsState.Loading
            : showRows ? ScheduledExportsState.Success : ScheduledExportsState.Empty;

        string neverLabel = localizer.GetString("dataExport.scheduled.status.never", "Never");
        string okLabel = localizer.GetString("dataExport.scheduled.status.ok", "OK");
        string failedLabel = localizer.GetString("dataExport.scheduled.status.failed", "Failed");

        var actions = new ScheduledExportsActionLabels(
            RunNow: localizer.GetString("dataExport.scheduled.actions.runNow", "Run now"),
            Enable: localizer.GetString("dataExport.scheduled.actions.enable", "Enable"),
            Disable: localizer.GetString("dataExport.scheduled.actions.disable", "Disable"),
            Edit: localizer.GetString("dataExport.scheduled.actions.edit", "Edit"),
            Delete: localizer.GetString("dataExport.scheduled.actions.delete", "Delete"));

        var rows = items
            .Select(item => ProjectRow(item, actions, okLabel, failedLabel, neverLabel, model.RunningId, model.Now))
            .ToList();

        var formLabels = new ScheduledExportsFormLabels(
            NameLabel: localizer.GetString("dataExport.scheduled.form.name", "Name"),
            NameHint: localizer.GetString("dataExport.scheduled.form.namePlaceholder", "Drives weekly"), // parity:allow web i18n key name, not a stub marker
            CronLabel: localizer.GetString("dataExport.scheduled.form.scheduleCron", "Cron expression"),
            CronHelp: localizer.GetString("dataExport.scheduled.form.scheduleCronHelp", "Standard 5-field cron, e.g. '0 9 * * 0'."),
            ExportTypeLabel: localizer.GetString("dataExport.scheduled.form.exportType", "Export type"),
            FormatLabel: localizer.GetString("dataExport.scheduled.form.format", "Format"),
            RangeWindowLabel: localizer.GetString("dataExport.scheduled.form.rangeWindow", "Range window"),
            RangeWindowHelp: localizer.GetString("dataExport.scheduled.form.rangeWindowHelp", "Format: number + m/h/d."),
            DeliveryKindLabel: localizer.GetString("dataExport.scheduled.form.deliveryKind", "Delivery kind"),
            DeliveryTargetLabel: localizer.GetString("dataExport.scheduled.form.deliveryTarget", "Delivery target"),
            DeliveryTargetHelp: localizer.GetString("dataExport.scheduled.form.deliveryTargetHelp", "Email address or HTTPS URL."),
            CancelLabel: localizer.GetString("dataExport.scheduled.form.cancel", "Cancel"),
            SubmitLabel: localizer.GetString("dataExport.scheduled.form.submit", "Save schedule"));

        var columns = new ScheduledExportsColumnLabels(
            Name: localizer.GetString("dataExport.scheduled.table.name", "Name"),
            Type: localizer.GetString("dataExport.scheduled.table.type", "Type"),
            Cron: localizer.GetString("dataExport.scheduled.table.cron", "Cron"),
            Delivery: localizer.GetString("dataExport.scheduled.table.delivery", "Delivery"),
            NextRun: localizer.GetString("dataExport.scheduled.table.nextRun", "Next run"),
            LastRun: localizer.GetString("dataExport.scheduled.table.lastRun", "Last run"),
            Status: localizer.GetString("dataExport.scheduled.table.status", "Status"),
            Actions: localizer.GetString("dataExport.scheduled.table.actions", "Actions"));

        var form = model.Form ?? ScheduledExportFormState.Empty();

        return new ScheduledExportsDisplay(
            State: state,
            ShowLoading: showLoading,
            ShowEmpty: showEmpty,
            ShowRows: showRows,
            Title: ScheduledExportsRegistration.Title(localizer),
            Subtitle: ScheduledExportsRegistration.Subtitle(localizer),
            NewScheduleLabel: localizer.GetString("dataExport.scheduled.newSchedule", "New schedule"),
            ShowForm: model.ShowForm,
            IsEditing: model.EditingId is not null,
            Submitting: model.Submitting,
            ShowDeliveryTarget: !string.Equals(form.DeliveryKind, "download", StringComparison.Ordinal),
            Form: form,
            FormLabels: formLabels,
            ExportTypeOptions: Options(ScheduledExportsRegistration.ExportTypes),
            FormatOptions: Options(ScheduledExportsRegistration.Formats),
            DeliveryKindOptions: Options(ScheduledExportsRegistration.DeliveryKinds),
            ColumnLabels: columns,
            ActionLabels: actions,
            Rows: rows,
            EmptyTitle: localizer.GetString("dataExport.scheduled.empty", "No schedules yet"),
            EmptyMessage: localizer.GetString(
                "dataExport.scheduled.emptyMessage",
                "Create a schedule to receive recurring exports automatically."),
            DeleteConfirmTitle: localizer.GetString("dataExport.scheduled.deleteConfirmTitle", "Delete schedule?"),
            DeleteConfirmBodyTemplate: localizer.GetString(
                "dataExport.scheduled.deleteConfirmBody",
                "This will stop future runs of {{name}}."),
            DeleteConfirmLabel: actions.Delete,
            DeleteCancelLabel: formLabels.CancelLabel);
    }

    private static ScheduledExportRow ProjectRow(
        ScheduledExport item,
        ScheduledExportsActionLabels actions,
        string okLabel,
        string failedLabel,
        string neverLabel,
        long? runningId,
        DateTimeOffset now)
    {
        string typeLabel = string.Create(CultureInfo.CurrentCulture, $"{item.ExportType} ({item.Format})");

        string delivery = item.Delivery.Kind;
        if (!string.IsNullOrEmpty(item.Delivery.Target))
        {
            delivery = string.Create(CultureInfo.CurrentCulture, $"{item.Delivery.Kind} \u2192 {item.Delivery.Target}");
        }

        string nextRun = item.NextRunTime is null
            ? EmDash
            : DateTimeFormatting.Format(item.NextRunTime, DateTimeVariant.Full, now);

        string lastRun = item.LastRunTime is null
            ? neverLabel
            : DateTimeFormatting.Format(item.LastRunTime, DateTimeVariant.Full, now);

        var (statusVariant, statusLabel, hasBadge) = item.LastStatus switch
        {
            "ok" => (StatusKind.Success, okLabel, true),
            "failed" => (StatusKind.Danger, failedLabel, true),
            _ => (StatusKind.Neutral, EmDash, false),
        };

        return new ScheduledExportRow(
            Id: item.Id,
            Name: string.IsNullOrEmpty(item.Name) ? EmDash : item.Name,
            TypeLabel: typeLabel,
            Cron: item.ScheduleCron,
            Delivery: delivery,
            NextRun: nextRun,
            LastRun: lastRun,
            StatusVariant: statusVariant,
            StatusLabel: statusLabel,
            HasStatusBadge: hasBadge,
            Enabled: item.Enabled,
            ToggleLabel: item.Enabled ? actions.Disable : actions.Enable,
            ToggleEnables: !item.Enabled,
            IsRunning: runningId == item.Id,
            AutomationName: string.IsNullOrEmpty(item.Name) ? EmDash : item.Name);
    }

    private static List<ScheduledExportOption> Options(IReadOnlyList<string> values) =>
        values.Select(v => new ScheduledExportOption(v, v)).ToList();
}

/// <summary>
/// PII-safe diagnostics for the <c>ScheduledExportsPanel</c> surface (P1/S11 diagnostics contract). Schedules carry
/// user-identifying names and delivery targets, so the collector records ONLY the operational <c>view.opened</c>
/// event with the surface slug — never a schedule id, name, or delivery target. Thread-safe; mirrors the sibling
/// feature-view pages' collectors.
/// </summary>
public sealed class ScheduledExportsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ScheduledExportsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ScheduledExportsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ScheduledExportsRegistration.Slug}"));
    }
}
