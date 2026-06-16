using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Severity threshold for the server-side log filter — the native union of the web
/// <c>LogStreamLevel</c> (<c>'debug' | 'info' | 'warn' | 'error'</c>,
/// web/src/api/hooks/useLogStream.ts). Matches the levels the backend handler supports
/// (<c>debug</c> includes everything down to debug; <c>error</c> only surfaces error/fatal/panic).
/// Pure data.
/// </summary>
public enum LogStreamLevel
{
    /// <summary>All events down to debug (web <c>'debug'</c>).</summary>
    Debug,

    /// <summary>Info and above (web <c>'info'</c>) — the default threshold.</summary>
    Info,

    /// <summary>Warnings and above (web <c>'warn'</c>).</summary>
    Warn,

    /// <summary>Errors / fatal / panic only (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>The on-the-wire token and parser for a <see cref="LogStreamLevel"/> (web query-param value).</summary>
public static class LogStreamLevels
{
    /// <summary>The <c>level</c> query-param token the backend SSE handler expects (web <c>buildLogStreamUrl</c>).</summary>
    public static string Wire(LogStreamLevel level) => level switch
    {
        LogStreamLevel.Debug => "debug",
        LogStreamLevel.Warn => "warn",
        LogStreamLevel.Error => "error",
        _ => "info",
    };

    /// <summary>Parse a wire token back to a <see cref="LogStreamLevel"/>, defaulting to <see cref="LogStreamLevel.Info"/>.</summary>
    public static LogStreamLevel Parse(string? wire) => wire?.Trim().ToLowerInvariant() switch
    {
        "debug" => LogStreamLevel.Debug,
        "warn" => LogStreamLevel.Warn,
        "warning" => LogStreamLevel.Warn,
        "error" => LogStreamLevel.Error,
        _ => LogStreamLevel.Info,
    };
}

/// <summary>One decoded structured-log field (<c>key=value</c>) extracted from a zerolog payload. Pure data.</summary>
/// <param name="Key">The field name (web object key).</param>
/// <param name="Value">The already-rendered display value (web <c>String(value)</c> / <c>JSON.stringify</c>).</param>
public sealed record LogField(string Key, string Value);

/// <summary>
/// One parsed live-log row — the native analogue of the web <c>LogStreamEvent</c>
/// (web/src/api/hooks/useLogStream.ts). <see cref="Payload"/> is the raw zerolog JSON line so the table can
/// render arbitrary fields without pre-modelling them; the level / message / vehicle id / fields are decoded
/// once at construction (web <c>buildLogEvent</c> + the page's <c>extract*</c> helpers) so the projection and
/// the filters stay allocation-light. <see cref="Seq"/> is a monotonic counter assigned on receive so list
/// keys stay stable even when two events share a timestamp. Pure data — no WinUI types.
/// </summary>
public sealed record LogStreamEvent(
    long Seq,
    System.DateTimeOffset ReceivedAt,
    string Payload,
    string Level,
    string Message,
    string? VehicleId,
    IReadOnlyList<LogField> Fields)
{
    private static readonly HashSet<string> SkipKeys = new(System.StringComparer.Ordinal)
    {
        "level", "time", "message", "msg",
    };

    private static readonly string[] VehicleKeys = ["vehicle_id", "vehicleID", "vehicleId"];

    /// <summary>
    /// Build an event from one raw <c>data:</c> payload (web <c>buildLogEvent</c>). Parses the zerolog JSON
    /// once; when the payload is not a JSON object the row falls back to the raw text at <c>info</c> level
    /// (matching zerolog's own default) with no decoded fields.
    /// </summary>
    public static LogStreamEvent FromPayload(long seq, System.DateTimeOffset receivedAt, string payload)
    {
        System.ArgumentNullException.ThrowIfNull(payload);

        string level = "info";
        string message = payload;
        string? vehicleId = null;
        IReadOnlyList<LogField> fields = System.Array.Empty<LogField>();

        try
        {
            using var doc = JsonDocument.Parse(payload);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                var root = doc.RootElement;
                level = ReadLevel(root);
                message = ReadMessage(root, payload);
                vehicleId = ReadVehicleId(root);
                fields = ReadFields(root);
            }
        }
        catch (JsonException)
        {
            // Not valid JSON — keep the raw payload as the message (web tryParseJSON -> null branch).
        }

        return new LogStreamEvent(seq, receivedAt, payload, level, message, vehicleId, fields);
    }

    private static string ReadLevel(JsonElement obj) =>
        obj.TryGetProperty("level", out var level) && level.ValueKind == JsonValueKind.String
            ? level.GetString() ?? "info"
            : "info";

    private static string ReadMessage(JsonElement obj, string raw)
    {
        if (obj.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String)
        {
            return message.GetString() ?? raw;
        }

        if (obj.TryGetProperty("msg", out var msg) && msg.ValueKind == JsonValueKind.String)
        {
            return msg.GetString() ?? raw;
        }

        return raw;
    }

    private static string? ReadVehicleId(JsonElement obj)
    {
        foreach (var key in VehicleKeys)
        {
            if (!obj.TryGetProperty(key, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                var s = value.GetString();
                if (!string.IsNullOrEmpty(s))
                {
                    return s;
                }
            }
            else if (value.ValueKind == JsonValueKind.Number)
            {
                return value.GetRawText();
            }
        }

        return null;
    }

    private static List<LogField> ReadFields(JsonElement obj)
    {
        var fields = new List<LogField>();
        foreach (var prop in obj.EnumerateObject())
        {
            if (SkipKeys.Contains(prop.Name))
            {
                continue;
            }

            if (prop.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                continue;
            }

            fields.Add(new LogField(prop.Name, RenderFieldValue(prop.Value)));
        }

        return fields;
    }

    private static string RenderFieldValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => string.Empty,
        _ => value.GetRawText(),
    };
}

/// <summary>One minimum-level dropdown option (web <c>LEVEL_OPTIONS</c>). Pure data.</summary>
/// <param name="Value">The level the option selects.</param>
/// <param name="Label">The localized option label (web <c>liveLogs.level.*</c>).</param>
public sealed record LiveLogsLevelOption(LogStreamLevel Value, string Label);

/// <summary>One decoded <c>key=value</c> chip rendered in the Fields column, value-truncated for display.</summary>
/// <param name="Key">The field name.</param>
/// <param name="Value">The display value (truncated to 32 chars + ellipsis, web cell rule).</param>
public sealed record LogFieldChip(string Key, string Value);

/// <summary>
/// One projected table row — a <see cref="LogStreamEvent"/> rendered for the four-column table
/// (Time / Level / Message / Fields), exactly as the web <c>DataTable</c> column renderers derive it. Pure data.
/// </summary>
/// <param name="Seq">The stable row key (web <c>keyExtractor</c>).</param>
/// <param name="Time">The formatted receive time (web <c>formatTime</c>, <c>HH:mm:ss.fff</c>).</param>
/// <param name="LevelLabel">The upper-cased level, or the em-dash when the row has no level.</param>
/// <param name="LevelStatus">The severity chip colour (web <c>levelBadgeVariant</c>).</param>
/// <param name="Message">The extracted message (web <c>extractMessage</c>).</param>
/// <param name="Fields">Up to six decoded field chips (web <c>extractFields</c>, sliced to 6).</param>
/// <param name="OverflowText">The "+N" overflow marker when more than six fields exist, else null.</param>
public sealed record LiveLogRowDisplay(
    long Seq,
    string Time,
    string LevelLabel,
    StatusKind LevelStatus,
    string Message,
    IReadOnlyList<LogFieldChip> Fields,
    string? OverflowText);

/// <summary>The table data-state the manifest tracks: <see cref="Empty"/> (no rows) or <see cref="Success"/> (rows).</summary>
public enum LiveLogsState
{
    /// <summary>No buffered events match the current filter — the in-panel empty state renders.</summary>
    Empty,

    /// <summary>One or more events match — the log table renders.</summary>
    Success,
}

/// <summary>
/// The raw, render-agnostic state the <see cref="LiveLogsPageViewModel"/> owns and the
/// <see cref="LiveLogsProjection"/> reads — the native analogue of the web page's local state +
/// <c>useLogStream</c> result (web/src/features/admin/pages/LiveLogsPage.tsx). Pure data.
/// </summary>
public sealed record LiveLogsModel(
    LogStreamLevel Level,
    string Grep,
    string GrepDraft,
    string VehicleFilter,
    bool Paused,
    bool Autoscroll,
    bool Enabled,
    IReadOnlyList<LogStreamEvent> Events,
    bool Connected,
    string? ErrorDetail,
    int Drops,
    long TotalReceived);

/// <summary>
/// The fully projected, render-ready view of the Live Logs page — every label, stat value, badge, column
/// header, filter hint, control caption, the error surface copy and the filtered table rows the web derives
/// with its <c>useMemo</c> chain + inline <c>t(key, default)</c> calls. The view binds to this and performs no
/// logic of its own. Pure data — no WinUI types.
/// </summary>
public sealed record LiveLogsDisplay
{
    /// <summary>The page title (web <c>liveLogs.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>liveLogs.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The connection badge text (web <c>ConnectionBadge</c>).</summary>
    public required string ConnectionLabel { get; init; }

    /// <summary>The connection badge colour (web <c>Badge variant</c>).</summary>
    public required StatusKind ConnectionStatus { get; init; }

    /// <summary>The buffered-count caption (web <c>liveLogs.stats.buffered</c>).</summary>
    public required string BufferedText { get; init; }

    /// <summary>The total-received caption (web <c>liveLogs.stats.received</c>).</summary>
    public required string ReceivedText { get; init; }

    /// <summary>The server-drops caption (web <c>liveLogs.stats.drops</c>).</summary>
    public required string DropsText { get; init; }

    /// <summary>Whether the server-drops caption is shown (web <c>stream.drops &gt; 0</c>).</summary>
    public required bool ShowDrops { get; init; }

    /// <summary>The minimum-level field label (web <c>liveLogs.filters.level</c>).</summary>
    public required string LevelLabel { get; init; }

    /// <summary>The minimum-level dropdown options (web <c>LEVEL_OPTIONS</c>).</summary>
    public required IReadOnlyList<LiveLogsLevelOption> LevelOptions { get; init; }

    /// <summary>The currently selected minimum level.</summary>
    public required LogStreamLevel SelectedLevel { get; init; }

    /// <summary>The grep field label (web <c>liveLogs.filters.grep</c>).</summary>
    public required string GrepLabel { get; init; }

    /// <summary>The grep field in-field hint (web <c>liveLogs.filters.grepPlaceholder</c>).</summary>
    public required string GrepHint { get; init; }

    /// <summary>The grep helper text under the field (web <c>liveLogs.filters.grepHelp</c>).</summary>
    public required string GrepHelp { get; init; }

    /// <summary>The current grep draft text (web <c>grepDraft</c>).</summary>
    public required string GrepValue { get; init; }

    /// <summary>The vehicle-id field label (web <c>liveLogs.filters.vehicleId</c>).</summary>
    public required string VehicleIdLabel { get; init; }

    /// <summary>The vehicle-id field in-field hint (web <c>liveLogs.filters.vehicleIdPlaceholder</c>).</summary>
    public required string VehicleIdHint { get; init; }

    /// <summary>The current vehicle-id filter text (web <c>vehicleFilter</c>).</summary>
    public required string VehicleIdValue { get; init; }

    /// <summary>The auto-scroll toggle label (web <c>liveLogs.controls.autoscroll</c>).</summary>
    public required string AutoscrollLabel { get; init; }

    /// <summary>Whether auto-scroll is on (web <c>autoscroll</c>).</summary>
    public required bool Autoscroll { get; init; }

    /// <summary>The pause/resume button label (web <c>liveLogs.controls.pause</c> / <c>.resume</c>).</summary>
    public required string PauseLabel { get; init; }

    /// <summary>Whether the buffer is paused (drives the play/pause glyph).</summary>
    public required bool Paused { get; init; }

    /// <summary>The clear-buffer button label (web <c>liveLogs.controls.clear</c>).</summary>
    public required string ClearLabel { get; init; }

    /// <summary>The download button label (web <c>liveLogs.controls.download</c>).</summary>
    public required string DownloadLabel { get; init; }

    /// <summary>Whether the download button is enabled (web <c>filteredEvents.length &gt; 0</c>).</summary>
    public required bool CanDownload { get; init; }

    /// <summary>The reconnect button label (web <c>liveLogs.controls.reconnect</c>).</summary>
    public required string ReconnectLabel { get; init; }

    /// <summary>Whether the connection-error panel is shown (web <c>stream.error</c>).</summary>
    public required bool ShowError { get; init; }

    /// <summary>The connection-error panel title (web <c>liveLogs.error.title</c>).</summary>
    public required string ErrorTitle { get; init; }

    /// <summary>The connection-error panel body (web <c>stream.error.message || liveLogs.error.hint</c>).</summary>
    public required string ErrorMessage { get; init; }

    /// <summary>The Time column header (web <c>liveLogs.table.time</c>).</summary>
    public required string TimeHeader { get; init; }

    /// <summary>The Level column header (web <c>liveLogs.table.level</c>).</summary>
    public required string LevelHeader { get; init; }

    /// <summary>The Message column header (web <c>liveLogs.table.message</c>).</summary>
    public required string MessageHeader { get; init; }

    /// <summary>The Fields column header (web <c>liveLogs.table.fields</c>).</summary>
    public required string FieldsHeader { get; init; }

    /// <summary>The em-dash shown for a row with no level (web <c>liveLogs.table.noLevel</c>).</summary>
    public required string NoLevelLabel { get; init; }

    /// <summary>The active table data-state (empty / success).</summary>
    public required LiveLogsState State { get; init; }

    /// <summary>Whether the log table renders (web <c>filteredEvents.length &gt; 0</c>).</summary>
    public required bool ShowTable { get; init; }

    /// <summary>Whether the empty state renders inside the table panel (web <c>filteredEvents.length === 0</c>).</summary>
    public required bool ShowEmpty { get; init; }

    /// <summary>The empty-state title (web <c>liveLogs.title</c> reused as the EmptyState title).</summary>
    public required string EmptyTitle { get; init; }

    /// <summary>The empty-state body (web <c>liveLogs.empty.noEvents</c>).</summary>
    public required string EmptyMessage { get; init; }

    /// <summary>Whether the empty state offers the Reconnect action (web <c>!enabled</c>).</summary>
    public required bool ShowEmptyAction { get; init; }

    /// <summary>The empty-state action label (web <c>liveLogs.controls.reconnect</c>).</summary>
    public required string EmptyActionLabel { get; init; }

    /// <summary>The filtered, oldest-first table rows the page renders.</summary>
    public required IReadOnlyList<LiveLogRowDisplay> Rows { get; init; }

    /// <summary>The buffer-size footer caption (web <c>{buffered} / max {LOG_STREAM_MAX_EVENTS}</c>).</summary>
    public required string FooterText { get; init; }

    /// <summary>The localized download file-name template (web <c>liveLogs.filename</c>, .NET <c>{0}</c> form).</summary>
    public required string FileNameTemplate { get; init; }

    /// <summary>The composed accessible name for the surface (the title).</summary>
    public required string AutomationName { get; init; }
}

/// <summary>
/// Pure projection from <see cref="LiveLogsModel"/> to <see cref="LiveLogsDisplay"/> — the native port of the
/// web page's <c>filteredEvents</c> / <c>columns</c> <c>useMemo</c> chain and every inline <c>t(key, default)</c>
/// call across the page (web/src/features/admin/pages/LiveLogsPage.tsx). Every one of the page's i18n keys is
/// resolved on every call — regardless of state — so a single headless projection asserts the whole manifest
/// string set. No WinUI types.
/// </summary>
public static class LiveLogsProjection
{
    /// <summary>The rolling client-side buffer cap (web <c>LOG_STREAM_MAX_EVENTS</c>).</summary>
    public const int LogStreamMaxEvents = 1000;

    private const int MaxFieldChips = 6;
    private const int MaxFieldValueChars = 32;

    /// <summary>Project the model into its render-ready display, resolving every label through <paramref name="localizer"/>.</summary>
    public static LiveLogsDisplay Project(LiveLogsModel model, ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(model);
        System.ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("liveLogs.title", "Live logs");

        // Connection badge — resolve every status string on every call so the headless test covers them all.
        string statusError = localizer.GetString("liveLogs.status.error", "Connection error");
        string statusDisconnected = localizer.GetString("liveLogs.status.disconnected", "Disconnected");
        string statusConnecting = localizer.GetString("liveLogs.status.connecting", "Connecting\u2026");
        string statusPaused = localizer.GetString("liveLogs.status.paused", "Paused (still receiving)");
        string statusConnected = localizer.GetString("liveLogs.status.connected", "Live");

        (string connectionLabel, StatusKind connectionStatus) = ConnectionBadge(
            model, statusError, statusDisconnected, statusConnecting, statusPaused, statusConnected);

        IReadOnlyList<LogStreamEvent> filtered = LiveLogsFilter.Apply(model.Events, model.VehicleFilter);

        string errorHint = localizer.GetString(
            "liveLogs.error.hint",
            "Check your network and admin permissions, then click Reconnect.");

        string noLevel = localizer.GetString("liveLogs.table.noLevel", "\u2014");
        var rows = new List<LiveLogRowDisplay>(filtered.Count);
        foreach (var ev in filtered)
        {
            rows.Add(ProjectRow(ev, noLevel));
        }

        string bufferedText = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("liveLogs.stats.buffered", "Buffered: {0}"),
            model.Events.Count);

        bool hasError = model.ErrorDetail is not null;

        return new LiveLogsDisplay
        {
            Title = title,
            Subtitle = localizer.GetString(
                "liveLogs.subtitle",
                "Stream the API server's structured log events in real time. Filter by severity and an optional "
                    + "regular expression. The connection is dropped when you navigate away."),

            ConnectionLabel = connectionLabel,
            ConnectionStatus = connectionStatus,

            BufferedText = bufferedText,
            ReceivedText = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("liveLogs.stats.received", "Received: {0}"),
                model.TotalReceived),
            DropsText = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("liveLogs.stats.drops", "Server drops: {0}"),
                model.Drops),
            ShowDrops = model.Drops > 0,

            LevelLabel = localizer.GetString("liveLogs.filters.level", "Minimum level"),
            LevelOptions = LevelOptions(localizer),
            SelectedLevel = model.Level,

            GrepLabel = localizer.GetString("liveLogs.filters.grep", "Grep (regular expression)"),
            GrepHint = localizer.GetString("liveLogs.filters.grepPlaceholder", "e.g. mqtt|signal_log"), // parity:allow web i18n key name grepPlaceholder
            GrepHelp = localizer.GetString(
                "liveLogs.filters.grepHelp",
                "Server-side filter. Maximum 256 characters. Invalid expressions are rejected before connecting."),
            GrepValue = model.GrepDraft,

            VehicleIdLabel = localizer.GetString("liveLogs.filters.vehicleId", "Vehicle ID"),
            VehicleIdHint = localizer.GetString("liveLogs.filters.vehicleIdPlaceholder", "Numeric \u2014 applied client-side"), // parity:allow web i18n key name vehicleIdPlaceholder
            VehicleIdValue = model.VehicleFilter,

            AutoscrollLabel = localizer.GetString("liveLogs.controls.autoscroll", "Auto-scroll"),
            Autoscroll = model.Autoscroll,
            PauseLabel = model.Paused
                ? localizer.GetString("liveLogs.controls.resume", "Resume")
                : localizer.GetString("liveLogs.controls.pause", "Pause"),
            Paused = model.Paused,
            ClearLabel = localizer.GetString("liveLogs.controls.clear", "Clear buffer"),
            DownloadLabel = localizer.GetString("liveLogs.controls.download", "Download visible (.txt)"),
            CanDownload = filtered.Count > 0,
            ReconnectLabel = localizer.GetString("liveLogs.controls.reconnect", "Reconnect"),

            ShowError = hasError,
            ErrorTitle = localizer.GetString("liveLogs.error.title", "Could not connect to log stream"),
            ErrorMessage = string.IsNullOrEmpty(model.ErrorDetail) ? errorHint : model.ErrorDetail!,

            TimeHeader = localizer.GetString("liveLogs.table.time", "Time"),
            LevelHeader = localizer.GetString("liveLogs.table.level", "Level"),
            MessageHeader = localizer.GetString("liveLogs.table.message", "Message"),
            FieldsHeader = localizer.GetString("liveLogs.table.fields", "Fields"),
            NoLevelLabel = noLevel,

            State = filtered.Count > 0 ? LiveLogsState.Success : LiveLogsState.Empty,
            ShowTable = filtered.Count > 0,
            ShowEmpty = filtered.Count == 0,
            EmptyTitle = title,
            EmptyMessage = localizer.GetString(
                "liveLogs.empty.noEvents",
                "No log events yet. Trigger activity (e.g. start a charging session) to see live output."),
            ShowEmptyAction = !model.Enabled,
            EmptyActionLabel = localizer.GetString("liveLogs.controls.reconnect", "Reconnect"),

            Rows = rows,
            FooterText = $"{bufferedText} / max {LogStreamMaxEvents.ToString(CultureInfo.CurrentCulture)}",
            FileNameTemplate = localizer.GetString("liveLogs.filename", "teslasync-logs-{0}.txt"),
            AutomationName = title,
        };
    }

    /// <summary>The localized minimum-level dropdown options (web <c>LEVEL_OPTIONS</c>).</summary>
    public static IReadOnlyList<LiveLogsLevelOption> LevelOptions(ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            new LiveLogsLevelOption(LogStreamLevel.Debug, localizer.GetString("liveLogs.level.debug", "Debug")),
            new LiveLogsLevelOption(LogStreamLevel.Info, localizer.GetString("liveLogs.level.info", "Info")),
            new LiveLogsLevelOption(LogStreamLevel.Warn, localizer.GetString("liveLogs.level.warn", "Warn")),
            new LiveLogsLevelOption(LogStreamLevel.Error, localizer.GetString("liveLogs.level.error", "Error")),
        ];
    }

    /// <summary>The severity chip colour for a level (web <c>levelBadgeVariant</c>).</summary>
    public static StatusKind LevelStatus(string level)
    {
        string norm = (level ?? string.Empty).ToLowerInvariant();
        return norm switch
        {
            "debug" or "trace" => StatusKind.Neutral,
            "info" => StatusKind.Info,
            "warn" or "warning" => StatusKind.Warning,
            "error" or "err" or "fatal" or "panic" => StatusKind.Danger,
            _ => StatusKind.Neutral,
        };
    }

    /// <summary>Format a receive time as <c>HH:mm:ss.fff</c> (web <c>formatTime</c>).</summary>
    public static string FormatTime(System.DateTimeOffset receivedAt) =>
        receivedAt.ToString("HH:mm:ss.fff", CultureInfo.CurrentCulture);

    private static LiveLogRowDisplay ProjectRow(LogStreamEvent ev, string noLevel)
    {
        string levelLabel = string.IsNullOrEmpty(ev.Level) ? noLevel : ev.Level.ToUpperInvariant();

        var chips = new List<LogFieldChip>(System.Math.Min(ev.Fields.Count, MaxFieldChips));
        foreach (var field in ev.Fields.Take(MaxFieldChips))
        {
            chips.Add(new LogFieldChip(field.Key, Truncate(field.Value)));
        }

        string? overflow = ev.Fields.Count > MaxFieldChips
            ? $"+{(ev.Fields.Count - MaxFieldChips).ToString(CultureInfo.CurrentCulture)}"
            : null;

        return new LiveLogRowDisplay(
            ev.Seq,
            FormatTime(ev.ReceivedAt),
            levelLabel,
            LevelStatus(ev.Level),
            ev.Message,
            chips,
            overflow);
    }

    private static string Truncate(string value) =>
        value.Length > MaxFieldValueChars ? value[..MaxFieldValueChars] + "\u2026" : value;

    private static (string Label, StatusKind Status) ConnectionBadge(
        LiveLogsModel model,
        string error,
        string disconnected,
        string connecting,
        string paused,
        string connected)
    {
        if (model.ErrorDetail is not null)
        {
            return (error, StatusKind.Danger);
        }

        if (!model.Enabled)
        {
            return (disconnected, StatusKind.Neutral);
        }

        if (!model.Connected)
        {
            return (connecting, StatusKind.Info);
        }

        return model.Paused ? (paused, StatusKind.Warning) : (connected, StatusKind.Success);
    }
}

/// <summary>
/// The client-side vehicle-id filter the web page applies to the current buffer
/// (web <c>filteredEvents</c> <c>useMemo</c>). Kept UI-free + shared so the projection and the download
/// reuse one definition (DRY).
/// </summary>
public static class LiveLogsFilter
{
    /// <summary>Filter <paramref name="events"/> to those whose decoded vehicle id equals the trimmed filter (empty = all).</summary>
    public static IReadOnlyList<LogStreamEvent> Apply(IReadOnlyList<LogStreamEvent> events, string vehicleFilter)
    {
        System.ArgumentNullException.ThrowIfNull(events);
        string needle = (vehicleFilter ?? string.Empty).Trim();
        if (needle.Length == 0)
        {
            return events;
        }

        return events.Where(e => string.Equals(e.VehicleId, needle, System.StringComparison.Ordinal)).ToArray();
    }
}

/// <summary>
/// The plain-text export the web Download button builds (web <c>eventToText</c> + <c>downloadFilename</c>).
/// UI-free so the headless tests pin the exact line shape and the time-stamped file name.
/// </summary>
public static class LiveLogsExport
{
    /// <summary>Render one event as a download line (web <c>eventToText</c>): <c>[time] LEVEL payload</c>.</summary>
    public static string EventToText(LogStreamEvent ev)
    {
        System.ArgumentNullException.ThrowIfNull(ev);
        return $"[{LiveLogsProjection.FormatTime(ev.ReceivedAt)}] {ev.Level.ToUpperInvariant()} {ev.Payload}";
    }

    /// <summary>Render the whole visible buffer as the newline-joined download body (web <c>handleDownload</c>).</summary>
    public static string BuildText(IReadOnlyList<LogStreamEvent> events)
    {
        System.ArgumentNullException.ThrowIfNull(events);
        return string.Join("\n", events.Select(EventToText));
    }

    /// <summary>The UTC time stamp the file name embeds (web <c>downloadFilename</c>: ISO, colons to dashes).</summary>
    public static string Stamp(System.DateTimeOffset now) =>
        now.UtcDateTime.ToString("yyyy-MM-dd'T'HH-mm-ss'Z'", CultureInfo.InvariantCulture);

    /// <summary>The suggested download file name from the localized template (web <c>liveLogs.filename</c>).</summary>
    public static string FileName(string template, System.DateTimeOffset now)
    {
        System.ArgumentNullException.ThrowIfNull(template);
        return string.Format(CultureInfo.InvariantCulture, template, Stamp(now));
    }
}

/// <summary>
/// Metadata for the native WinUI 3 <c>LiveLogsPage</c> — the parity port of the web page
/// <c>web/src/features/admin/pages/LiveLogsPage.tsx</c> (manifest web route <c>(unrouted)</c>). The web page
/// streams the API server's structured zerolog events over the admin SSE tail and renders them in a virtualized
/// table. This registration exposes the diagnostics slug, the shell page-factory route name and the two
/// localized header strings; every literal flows through the <see cref="ILocalizer"/> facade with the web key
/// names so the resource pipeline (and the headless tests) resolve the exact same keys.
/// </summary>
public static class LiveLogsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "LiveLogsPage";

    /// <summary>
    /// The shell page-factory name the page registers under. The web page is unrouted (manifest web route
    /// <c>(unrouted)</c>), so — like the sibling W7 <c>SystemPage</c> — the native
    /// <see cref="Core.Navigation.RouteTable"/> intentionally carries no matching entry; the factory registration
    /// keeps the surface reachable by deep link / programmatic navigation without inventing a route the web
    /// parity baseline does not have.
    /// </summary>
    public const string RouteName = "LiveLogs";

    /// <summary>The SSE log-tail endpoint path WITHOUT the <c>/api/v1</c> prefix (web <c>LOG_STREAM_PATH</c>).</summary>
    public const string StreamPath = "admin/logs/stream";

    /// <summary>The localized page title (web <c>liveLogs.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("liveLogs.title", "Live logs");
    }

    /// <summary>The localized page subtitle (web <c>liveLogs.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "liveLogs.subtitle",
            "Stream the API server's structured log events in real time. Filter by severity and an optional "
                + "regular expression. The connection is dropped when you navigate away.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveLogsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never any log content, vehicle id or filter —
/// so a diagnostics line can never leak operator data. Thread-safe.
/// </summary>
public sealed class LiveLogsDiagnostics
{
    private readonly System.Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveLogsDiagnostics(System.Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => System.Threading.Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveLogsPage</c>.</summary>
    public void RecordViewOpened()
    {
        System.Threading.Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveLogsRegistration.Slug}");
    }
}
