using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SentryEventLogViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SentryEventLogWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum SentryEventLogState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no security events — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The canonical severity of a derived sentry/security event — the native port of the web
/// <c>EventFeedItem['severity']</c> ('info' | 'warning' | 'critical') produced by <c>deriveEvent</c>
/// in web/src/features/dashboard/widgets/SentryEventLogWidget.tsx.
/// </summary>
public enum SentryEventSeverity
{
    /// <summary>Routine state change (web 'info').</summary>
    Info,

    /// <summary>A door was reported open (web 'warning').</summary>
    Warning,

    /// <summary>The vehicle was unlocked (web 'critical').</summary>
    Critical,
}

/// <summary>
/// The kind of security state change a snapshot describes — the native enumeration of the six
/// branches of the web <c>deriveEvent</c> precedence ladder (door open → sentry on → sentry off →
/// locked → unlocked → fallback). Each kind resolves to a glyph, a token brush and a severity via
/// <see cref="SentryEventLogProjection"/>.
/// </summary>
public enum SentryEventKind
{
    /// <summary>One or more doors are open (web amber "Door open: …").</summary>
    DoorOpen,

    /// <summary>Sentry Mode was armed (web cyan "Sentry Mode activated").</summary>
    SentryActivated,

    /// <summary>Sentry Mode was disarmed (web grey "Sentry Mode deactivated").</summary>
    SentryDeactivated,

    /// <summary>The vehicle was locked (web green "Vehicle locked").</summary>
    Locked,

    /// <summary>The vehicle was unlocked (web red "Vehicle unlocked").</summary>
    Unlocked,

    /// <summary>A generic security state change (web purple "Security state updated").</summary>
    StateUpdated,
}

/// <summary>
/// One security/access snapshot row from <c>GET /security?vehicle_id=</c> (web <c>useQuery</c> over
/// <c>SecurityEvent[]</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial row never throws. <see cref="SentryMode"/> and
/// <see cref="Locked"/> are tri-state (<see langword="null"/> when the signal was absent or JSON
/// null) so the projection can reproduce the web's exact <c>=== true</c> / <c>=== false</c> /
/// <c>!= null</c> semantics; <see cref="DoorState"/> is captured only when it is a string (the web
/// reads it through <c>asNonEmptyString</c>). <see cref="CreatedAt"/> and <see cref="Ts"/> are kept
/// as the raw wire strings and parsed on demand.
/// </summary>
public sealed record SentryLogEvent(
    long? Id,
    long VehicleId,
    string? Ts,
    string? DoorState,
    bool? SentryMode,
    bool? Locked,
    string? CreatedAt)
{
    /// <summary>
    /// The display timestamp instant (web <c>ev.created_at ?? ev.ts</c>), or <see langword="null"/>
    /// when neither is present/parseable.
    /// </summary>
    public DateTimeOffset? Timestamp => TryParseTimestamp(CreatedAt) ?? TryParseTimestamp(Ts);

    /// <summary>The stable row key (web <c>ev.id ?? `${ev.vehicle_id}-${ev.ts}`</c>).</summary>
    public string Key => Id?.ToString(CultureInfo.InvariantCulture)
        ?? string.Create(CultureInfo.InvariantCulture, $"{VehicleId}-{Ts}");

    /// <summary>Parse a <c>GET /security</c> JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<SentryLogEvent> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SentryLogEvent>();
        }

        var list = new List<SentryLogEvent>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single security JSON object into a <see cref="SentryLogEvent"/>.</summary>
    public static SentryLogEvent FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id"),
        VehicleId: GetLong(obj, "vehicle_id") ?? 0,
        Ts: GetString(obj, "ts"),
        DoorState: GetString(obj, "door_state"),
        SentryMode: GetBool(obj, "sentry_mode"),
        Locked: GetBool(obj, "locked"),
        CreatedAt: GetString(obj, "created_at"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isWide</c> / <c>isTall</c> / <c>eventLimit</c> logic in
/// web/src/features/dashboard/widgets/SentryEventLogWidget.tsx.
/// </summary>
public readonly record struct SentryEventLogSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SentryEventLogSize Default => new(2, 4);

    /// <summary>True at three or more columns (web <c>isWide</c>): show the status subtitle.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True at two or more rows (web <c>isTall</c>).</summary>
    public bool IsTall => Rows >= 2;

    /// <summary>
    /// Maximum rows rendered (web <c>eventLimit</c> + the <c>WidgetEventFeed maxItems</c> slice):
    /// wide→10, tall→7, otherwise 4.
    /// </summary>
    public int MaxItems => IsWide ? 10 : IsTall ? 7 : 4;
}

/// <summary>Resolved presentation tokens for a <see cref="SentryEventKind"/> (glyph + token brush + severity).</summary>
/// <param name="Glyph">Segoe Fluent glyph approximating the web Lucide icon.</param>
/// <param name="AccentBrushKey">Token brush key the web hex accent maps onto.</param>
/// <param name="Severity">The web <c>EventFeedItem</c> severity.</param>
public readonly record struct SentryEventPresentation(string Glyph, string AccentBrushKey, SentryEventSeverity Severity);

/// <summary>
/// One projected, display-ready feed row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c>. Holds the resolved kind presentation (glyph + token brush key), the localized
/// title and optional subtitle, the relative-time string, and a Narrator automation name. Pure data —
/// no WinUI types.
/// </summary>
public sealed record SentryEventRow(
    string Key,
    SentryEventKind Kind,
    string Glyph,
    string AccentBrushKey,
    SentryEventSeverity Severity,
    string Title,
    string? Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// Pure projection from raw security snapshots to display rows — the native port of the
/// <c>deriveEvent</c> + <c>feedItems</c> <c>useMemo</c> logic in
/// web/src/features/dashboard/widgets/SentryEventLogWidget.tsx plus <c>WidgetEventFeed</c>'s
/// newest-first sort and <c>maxItems</c> slice. <paramref name="now"/> is injected so the
/// relative-time tiers are unit-tested deterministically. Every label resolves through the i18n facade.
/// </summary>
public static class SentryEventLogProjection
{
    private const string MiddotSeparator = " \u00B7 ";
    private const string EmDash = "\u2014";

    // Segoe Fluent / MDL2 glyphs reused from the security-domain widgets (Door, Lock, Unlock, Monitor, Shield).
    private const string DoorGlyph = "\uE8D7";
    private const string MonitorGlyph = "\uE7F4";
    private const string LockGlyph = "\uE72E";
    private const string UnlockGlyph = "\uE785";
    private const string ShieldGlyph = "\uEA18";

    /// <summary>Project + sort (newest first) + cap <paramref name="events"/> to the footprint's row budget.</summary>
    public static IReadOnlyList<SentryEventRow> Project(
        IReadOnlyList<SentryLogEvent> events,
        SentryEventLogSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(localizer);

        var ordered = events
            .OrderByDescending(e => e.Timestamp ?? DateTimeOffset.MinValue)
            .Take(size.MaxItems);

        var rows = new List<SentryEventRow>(Math.Min(events.Count, size.MaxItems));
        foreach (var ev in ordered)
        {
            var kind = Classify(ev);
            var presentation = Presentation(kind);
            string title = Title(kind, ev, localizer);
            string? subtitle = size.IsWide ? Subtitle(ev, localizer) : null;
            string relative = DateTimeFormatting.Format(ev.Timestamp, DateTimeVariant.Relative, now);

            rows.Add(new SentryEventRow(
                Key: ev.Key,
                Kind: kind,
                Glyph: presentation.Glyph,
                AccentBrushKey: presentation.AccentBrushKey,
                Severity: presentation.Severity,
                Title: title,
                Subtitle: subtitle,
                RelativeTime: relative,
                Timestamp: ev.Timestamp,
                AutomationName: AutomationName(title, relative)));
        }

        return rows;
    }

    /// <summary>
    /// Classify a snapshot into its <see cref="SentryEventKind"/> following the web <c>deriveEvent</c>
    /// precedence exactly: open doors → sentry armed → sentry disarmed → locked → unlocked → fallback.
    /// </summary>
    public static SentryEventKind Classify(SentryLogEvent ev)
    {
        ArgumentNullException.ThrowIfNull(ev);

        if (OpenDoors(ev.DoorState).Count > 0)
        {
            return SentryEventKind.DoorOpen;
        }

        if (ev.SentryMode == true)
        {
            return SentryEventKind.SentryActivated;
        }

        if (ev.SentryMode == false)
        {
            return SentryEventKind.SentryDeactivated;
        }

        if (ev.Locked == true)
        {
            return SentryEventKind.Locked;
        }

        if (ev.Locked == false)
        {
            return SentryEventKind.Unlocked;
        }

        return SentryEventKind.StateUpdated;
    }

    /// <summary>Resolve the glyph / token brush / severity presentation for a kind (web hex → design token).</summary>
    public static SentryEventPresentation Presentation(SentryEventKind kind) => kind switch
    {
        SentryEventKind.DoorOpen => new(DoorGlyph, "TsColorWarningBrush", SentryEventSeverity.Warning),
        SentryEventKind.SentryActivated => new(MonitorGlyph, "TsColorInfoBrush", SentryEventSeverity.Info),
        SentryEventKind.SentryDeactivated => new(MonitorGlyph, "TsColorTextMutedBrush", SentryEventSeverity.Info),
        SentryEventKind.Locked => new(LockGlyph, "TsColorSuccessBrush", SentryEventSeverity.Info),
        SentryEventKind.Unlocked => new(UnlockGlyph, "TsColorDangerBrush", SentryEventSeverity.Critical),
        _ => new(ShieldGlyph, "TsColorAccentBrush", SentryEventSeverity.Info),
    };

    /// <summary>The localized event title (web <c>deriveEvent().title</c>), routed through the i18n facade.</summary>
    public static string Title(SentryEventKind kind, SentryLogEvent ev, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        return kind switch
        {
            SentryEventKind.DoorOpen => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("widget.sentryEventLog.event.doorOpen", "Door open: {0}"),
                string.Join(", ", OpenDoors(ev.DoorState))),
            SentryEventKind.SentryActivated =>
                localizer.GetString("widget.sentryEventLog.event.sentryActivated", "Sentry Mode activated"),
            SentryEventKind.SentryDeactivated =>
                localizer.GetString("widget.sentryEventLog.event.sentryDeactivated", "Sentry Mode deactivated"),
            SentryEventKind.Locked =>
                localizer.GetString("widget.sentryEventLog.event.locked", "Vehicle locked"),
            SentryEventKind.Unlocked =>
                localizer.GetString("widget.sentryEventLog.event.unlocked", "Vehicle unlocked"),
            _ => localizer.GetString("widget.sentryEventLog.event.stateUpdated", "Security state updated"),
        };
    }

    /// <summary>
    /// The localized status subtitle (web <c>parts.join(' · ') || '—'</c>): the lock state and the
    /// sentry state, each emitted only when its signal is present (web <c>!= null</c>).
    /// </summary>
    public static string Subtitle(SentryLogEvent ev, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        var parts = new List<string>(2);
        if (ev.Locked is { } locked)
        {
            parts.Add(locked
                ? localizer.GetString("widget.sentryEventLog.subtitle.locked", "\uD83D\uDD12 Locked")
                : localizer.GetString("widget.sentryEventLog.subtitle.unlocked", "\uD83D\uDD13 Unlocked"));
        }

        if (ev.SentryMode is { } sentry)
        {
            parts.Add(sentry
                ? localizer.GetString("widget.sentryEventLog.subtitle.sentryOn", "\uD83D\uDEE1\uFE0F Sentry On")
                : localizer.GetString("widget.sentryEventLog.subtitle.sentryOff", "Sentry Off"));
        }

        return parts.Count > 0 ? string.Join(MiddotSeparator, parts) : EmDash;
    }

    /// <summary>The comma-separated open-door names (web <c>door_state.split(',').filter(includes('open'))</c>).</summary>
    public static IReadOnlyList<string> OpenDoors(string? doorState)
    {
        if (string.IsNullOrEmpty(doorState))
        {
            return Array.Empty<string>();
        }

        var open = new List<string>();
        foreach (var part in doorState.Split(','))
        {
            string trimmed = part.Trim();
            if (trimmed.Contains("open", StringComparison.OrdinalIgnoreCase))
            {
                open.Add(trimmed);
            }
        }

        return open;
    }

    private static string AutomationName(string title, string relativeTime) =>
        string.Format(CultureInfo.CurrentCulture, "{0}, {1}", title, relativeTime);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SentryLogEvent&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SentryEventLogResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SentryLogEvent>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SentryLogEvent> Parse() =>
            raw.HasValue ? SentryLogEvent.ParseList(raw.Value) : Array.Empty<SentryLogEvent>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SentryLogEvent>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SentryLogEvent>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SentryLogEvent>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SentryLogEvent>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SentryLogEvent>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SentryLogEvent>> ToLoadedOrEmpty(
        IReadOnlyList<SentryLogEvent> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SentryLogEvent>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SentryLogEvent>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
