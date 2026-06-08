using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="CommandHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>CommandHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. Faithful to the web component, a fetch failure is surfaced through the
/// header freshness "Error" chip plus the refresh button (the retry affordance) rather than replacing
/// the body — so <see cref="Error"/> still renders the feed (or the friendly empty state), never a blank
/// box. <see cref="Empty"/> mirrors the web <c>list.length === 0</c> gate (the command log resolved with
/// no rows).
/// </summary>
public enum CommandHistoryState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache) carrying at least one command.</summary>
    Loaded,

    /// <summary>The request resolved with no commands — render the friendly "No commands sent" state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the empty body plus an error chip.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline/error chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers for <see cref="CommandLogEntry"/>. Each returns <see langword="null"/> for an
/// absent / wrong-kind property so a partial wire body never throws — mirroring the web hook's defensive
/// <c>?? '—'</c> reads.
/// </summary>
internal static class CommandHistoryJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    internal static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read an <c>id</c> (number or numeric string), or <c>0</c> when absent/unparseable.</summary>
    internal static long GetId(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }
}

/// <summary>
/// One command-log entry from <c>GET /vehicles/{vehicleID}/commands/history</c> (web
/// <c>useCommandHistory</c>, shape <c>CommandLogEntry</c> in web/src/api/hooks/useCommands.ts). Field
/// names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never
/// throws. Only the fields the widget renders are projected — id, command, status, created time. The raw
/// wire timestamp is kept (as the web does) and parsed on demand via <see cref="CreatedAtTime"/>.
/// </summary>
public sealed record CommandLogEntry(
    long Id,
    string? Command,
    string? Status,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET …/commands/history</c> JSON array into a tolerant list of entries.</summary>
    public static IReadOnlyList<CommandLogEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CommandLogEntry>();
        }

        var list = new List<CommandLogEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single command-log JSON object into a <see cref="CommandLogEntry"/>.</summary>
    public static CommandLogEntry FromJson(JsonElement obj) => new(
        Id: CommandHistoryJson.GetId(obj, "id"),
        Command: CommandHistoryJson.GetString(obj, "command"),
        Status: CommandHistoryJson.GetString(obj, "status"),
        CreatedAt: CommandHistoryJson.GetString(obj, "created_at") ?? CommandHistoryJson.GetString(obj, "createdAt"));

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Status → presentation mapping for a command — the native port of <c>STATUS_MAP</c> / <c>DEFAULT_STATUS</c>
/// and the compact <c>CompactView</c> variant/label logic in
/// web/src/features/dashboard/widgets/CommandHistoryWidget.tsx. Comparisons are case-sensitive against the
/// exact lowercase wire values the Go command handler writes (<c>"success"</c> / <c>"failed"</c> /
/// <c>"pending"</c>), matching the web's strict <c>=== 'success'</c> / object-key lookups. Each status
/// resolves a Segoe Fluent glyph (approximating the web Lucide icon) and a token brush key (approximating
/// the web hex accent).
/// </summary>
public static class CommandStatuses
{
    /// <summary>Segoe Fluent — CommandPrompt (web <c>Terminal</c>): the header icon and the default/unknown row.</summary>
    public const string TerminalGlyph = "\uE756";

    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>): a successful command.</summary>
    public const string CheckGlyph = "\uE930";

    /// <summary>Segoe Fluent — ErrorBadge (web <c>XCircle</c>): a failed command.</summary>
    public const string ErrorGlyph = "\uEA39";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c>): a pending command.</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>
    /// Resolve the feed-row glyph + token accent brush key for a wire status (web <c>STATUS_MAP[status] ??
    /// DEFAULT_STATUS</c>): success → check/green, failed → error/red, pending → clock/amber, anything else
    /// (including <see langword="null"/>) → terminal/muted-grey.
    /// </summary>
    public static (string Glyph, string AccentBrushKey) FeedTokens(string? status) => status switch
    {
        "success" => (CheckGlyph, "TsColorSuccessBrush"),
        "failed" => (ErrorGlyph, "TsColorDangerBrush"),
        "pending" => (ClockGlyph, "TsColorWarningBrush"),
        _ => (TerminalGlyph, "TsColorTextMutedBrush"),
    };

    /// <summary>
    /// The compact badge tone (web <c>CompactView</c> <c>variant</c>): success → success, failed → danger,
    /// anything else (including pending / unknown / <see langword="null"/>) → warning.
    /// </summary>
    public static StatusKind CompactBadgeStatus(string? status) => status switch
    {
        "success" => StatusKind.Success,
        "failed" => StatusKind.Danger,
        _ => StatusKind.Warning,
    };

    /// <summary>
    /// The localized compact badge label (web <c>CompactView</c> <c>label</c>): success → "Success",
    /// failed → "Failed", anything else → "Pending".
    /// </summary>
    public static string CompactBadgeLabel(string? status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            "success" => localizer.GetString("widget.commandSuccess", "Success"),
            "failed" => localizer.GetString("widget.commandFailed", "Failed"),
            _ => localizer.GetString("widget.commandPending", "Pending"),
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/CommandHistoryWidget.tsx (a single column renders the last-command
/// chip; wider footprints render the command feed). The feed is always capped at ten rows, matching the
/// web <c>maxItems={10}</c>.
/// </summary>
public readonly record struct CommandHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static CommandHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the last-command chip.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Maximum feed rows rendered (web <c>maxItems={10}</c>, independent of footprint).</summary>
    public const int MaxFeedItems = 10;
}

/// <summary>
/// One projected, display-ready feed row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c> (the <c>feedItems</c> map in the web component). Holds the resolved status
/// presentation (glyph + token brush key), the title-cased command, the raw status subtitle, the
/// relative-time string, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record CommandFeedRow(
    long Id,
    string Glyph,
    string AccentBrushKey,
    string Title,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the command log for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the newest-first,
/// capped feed rows plus the compact last-command chip (command name + badge tone/label) and the
/// footprint flag. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record CommandHistoryDisplay(
    bool IsCompact,
    bool HasItems,
    string CompactCommandName,
    StatusKind CompactBadgeStatus,
    string CompactBadgeLabel,
    string CompactAutomationName,
    IReadOnlyList<CommandFeedRow> Items);

/// <summary>
/// Pure projection from raw command-log rows to the display model — the native port of the
/// <c>feedItems</c> / <c>CompactView</c> / <c>formatCommandName</c> logic in
/// web/src/features/dashboard/widgets/CommandHistoryWidget.tsx plus <c>WidgetEventFeed</c>'s newest-first
/// sort and <c>maxItems</c> slice. <paramref name="now"/> is injected so the relative-time tiers are
/// unit-tested deterministically. Every label resolves through the i18n facade.
/// </summary>
public static class CommandHistoryProjection
{
    /// <summary>Em-dash fallback for a missing command / status (web <c>?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const string Separator = ", ";

    /// <summary>Project <paramref name="commands"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static CommandHistoryDisplay Project(
        IReadOnlyList<CommandLogEntry> commands,
        CommandHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: the compact chip reads the raw first item (list[0]), not the sorted feed head.
        var first = commands.Count > 0 ? commands[0] : null;
        string compactCommandName = first is null ? EmDash : FormatCommandName(first.Command);
        StatusKind compactBadgeStatus = CommandStatuses.CompactBadgeStatus(first?.Status);
        string compactBadgeLabel = CommandStatuses.CompactBadgeLabel(first?.Status, localizer);
        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}{1}{2}", compactCommandName, Separator, compactBadgeLabel);

        var rows = ProjectRows(commands, localizer, now);

        return new CommandHistoryDisplay(
            IsCompact: size.IsCompact,
            HasItems: commands.Count > 0,
            CompactCommandName: compactCommandName,
            CompactBadgeStatus: compactBadgeStatus,
            CompactBadgeLabel: compactBadgeLabel,
            CompactAutomationName: compactAutomationName,
            Items: rows);
    }

    /// <summary>
    /// Title-case a raw command name — the native port of the web <c>formatCommandName</c>
    /// (<c>raw.replace(/_/g, ' ').replace(/\b\w/g, c =&gt; c.toUpperCase())</c>): underscores become spaces
    /// and the first ASCII word-character of each run is upper-cased. A <see langword="null"/> command
    /// collapses to the em-dash (web <c>command ?? '—'</c>), which title-cases to itself.
    /// </summary>
    public static string FormatCommandName(string? raw)
    {
        string source = raw ?? EmDash;
        if (source.Length == 0)
        {
            return source;
        }

        var chars = source.ToCharArray();
        bool atWordStart = true;
        for (int i = 0; i < chars.Length; i++)
        {
            char c = chars[i];
            if (c == '_')
            {
                chars[i] = ' ';
                atWordStart = true;
                continue;
            }

            if (IsAsciiWord(c))
            {
                if (atWordStart)
                {
                    chars[i] = char.ToUpperInvariant(c);
                }

                atWordStart = false;
            }
            else
            {
                atWordStart = true;
            }
        }

        return new string(chars);
    }

    private static bool IsAsciiWord(char c) =>
        c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9');

    private static List<CommandFeedRow> ProjectRows(
        IReadOnlyList<CommandLogEntry> commands,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var ordered = commands
            .OrderByDescending(c => c.CreatedAtTime ?? DateTimeOffset.UnixEpoch)
            .Take(CommandHistorySize.MaxFeedItems);

        var rows = new List<CommandFeedRow>(Math.Min(commands.Count, CommandHistorySize.MaxFeedItems));
        foreach (var entry in ordered)
        {
            var (glyph, brushKey) = CommandStatuses.FeedTokens(entry.Status);
            string title = FormatCommandName(entry.Command);
            string subtitle = string.IsNullOrEmpty(entry.Status) ? EmDash : entry.Status;
            string relative = DateTimeFormatting.Format(entry.CreatedAtTime, DateTimeVariant.Relative, now);
            string automationName = string.Format(
                CultureInfo.CurrentCulture, "{0}: {1}, {2}", title, subtitle, relative);

            rows.Add(new CommandFeedRow(
                Id: entry.Id,
                Glyph: glyph,
                AccentBrushKey: brushKey,
                Title: title,
                Subtitle: subtitle,
                RelativeTime: relative,
                Timestamp: entry.CreatedAtTime,
                AutomationName: automationName));
        }

        return rows;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;CommandLogEntry&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class CommandHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<CommandLogEntry>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<CommandLogEntry> Parse() =>
            raw.HasValue ? CommandLogEntry.ParseList(raw.Value) : Array.Empty<CommandLogEntry>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<CommandLogEntry>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<CommandLogEntry>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<CommandLogEntry>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<CommandLogEntry>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<CommandLogEntry>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<CommandLogEntry>> ToLoadedOrEmpty(
        IReadOnlyList<CommandLogEntry> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<CommandLogEntry>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
