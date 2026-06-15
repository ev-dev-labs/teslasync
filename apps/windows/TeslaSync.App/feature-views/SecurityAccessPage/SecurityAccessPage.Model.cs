using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>SecurityAccessPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/admin/pages/SecurityAccessPage.tsx). The web page runs the
/// <c>useSecurityEvents</c> history query plus the polled <c>/security/latest</c> query and renders, in precedence
/// order, the loading shimmer (web <c>isLoading = loadingLatest || loadingHistory</c>), the load-failure
/// <c>AlertBanner</c> (web <c>anyError</c>, <c>error.loadFailed</c>) layered over whatever content is available, or
/// the resolved security content (lock / sentry / doors / windows + history). Per-region empty surfaces are still
/// driven by the projected flags so a region never collapses silently.
/// </summary>
public enum SecurityAccessState
{
    /// <summary>The first security read is in flight with nothing yet to show — the page shows the shimmer.</summary>
    Loading,

    /// <summary>A vehicles / latest / history read failed (web <c>anyError</c>) — the failure banner is shown.</summary>
    Error,

    /// <summary>The security state resolved (web <c>latest</c> / <c>history</c>) — the panels render.</summary>
    Success,
}

/// <summary>The closed/venting/open classification of one window (native mirror of the web <c>WindowState</c>).</summary>
public enum SecurityWindowState
{
    /// <summary>The window reads closed.</summary>
    Closed,

    /// <summary>The window reads venting.</summary>
    Venting,

    /// <summary>The window reads open.</summary>
    Open,

    /// <summary>The window value is missing or unrecognised.</summary>
    Unknown,
}

/// <summary>The semantic tone a status/timeline row renders with (maps to a <c>StatusKind</c> at the view boundary).</summary>
public enum SecurityTone
{
    /// <summary>No semantic colour.</summary>
    Neutral,

    /// <summary>A positive / secure signal.</summary>
    Good,

    /// <summary>A cautionary signal.</summary>
    Warn,

    /// <summary>A negative / insecure signal.</summary>
    Bad,
}

/// <summary>
/// One security snapshot row — the native mirror of the web <c>SecurityEvent</c> (web/src/types/admin.ts), read from
/// the <c>/security</c> + <c>/security/latest</c> responses. The backend serialises raw <c>signal.SignalValue</c>
/// values, so the door/sentry/window/center-display fields can each arrive as a bool, a string or a number; they are
/// captured as a boxed union (<see cref="object"/>) exactly as the web treats them as <c>unknown</c>. Field names
/// mirror the Go API's snake_case JSON tags (camelCase tolerated as a fallback). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record SecurityEvent(
    string Id,
    bool? Locked,
    object? SentryMode,
    object? DoorState,
    object? FdWindow,
    object? FpWindow,
    object? RdWindow,
    object? RpWindow,
    bool? HomelinkNearby,
    bool? GuestMode,
    long? HomelinkDeviceCount,
    bool? DriverSeatOccupied,
    object? CenterDisplay,
    bool? ValetModeEnabled,
    bool? ServiceMode,
    long? PairedPhoneKeyCount,
    string? CreatedAt)
{
    /// <summary>Read one event from a JSON object, tolerating missing / null fields and bool|string|number unions.</summary>
    public static SecurityEvent FromJson(JsonElement o) => new(
        Id: SecurityAccessJson.Str(o, "id", "Id") ?? string.Empty,
        Locked: SecurityAccessJson.Bool(o, "locked", "Locked"),
        SentryMode: SecurityAccessJson.Signal(o, "sentry_mode", "sentryMode"),
        DoorState: SecurityAccessJson.Signal(o, "door_state", "doorState"),
        FdWindow: SecurityAccessJson.Signal(o, "fd_window", "fdWindow"),
        FpWindow: SecurityAccessJson.Signal(o, "fp_window", "fpWindow"),
        RdWindow: SecurityAccessJson.Signal(o, "rd_window", "rdWindow"),
        RpWindow: SecurityAccessJson.Signal(o, "rp_window", "rpWindow"),
        HomelinkNearby: SecurityAccessJson.Bool(o, "homelink_nearby", "homelinkNearby"),
        GuestMode: SecurityAccessJson.Bool(o, "guest_mode", "guestMode"),
        HomelinkDeviceCount: SecurityAccessJson.Long(o, "homelink_device_count", "homelinkDeviceCount"),
        DriverSeatOccupied: SecurityAccessJson.Bool(o, "driver_seat_occupied", "driverSeatOccupied"),
        CenterDisplay: SecurityAccessJson.Signal(o, "center_display", "centerDisplay"),
        ValetModeEnabled: SecurityAccessJson.Bool(o, "valet_mode_enabled", "valetModeEnabled"),
        ServiceMode: SecurityAccessJson.Bool(o, "service_mode", "serviceMode"),
        PairedPhoneKeyCount: SecurityAccessJson.Long(o, "paired_phone_key_count", "pairedPhoneKeyCount"),
        CreatedAt: SecurityAccessJson.Str(o, "created_at", "createdAt"));

    /// <summary>Read the latest snapshot from a single object (tolerating the platform <c>{data:…}</c> envelope).</summary>
    public static SecurityEvent? ParseLatest(JsonElement root)
    {
        JsonElement o = SecurityAccessJson.Unwrap(root);
        return o.ValueKind == JsonValueKind.Object ? FromJson(o) : null;
    }

    /// <summary>Read the history feed from an array or a <c>{data|events|items:[…]}</c> envelope (newest-first preserved).</summary>
    public static IReadOnlyList<SecurityEvent> ParseHistory(JsonElement root)
    {
        var rows = SecurityAccessJson.Array(root, "data", "events", "items", "security");
        var list = new List<SecurityEvent>(rows.Count);
        foreach (var item in rows)
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The aggregate security statistics over the history window — the native mirror of the web <c>SecurityStats</c>
/// (lock transitions, door-open / window-open counts, homelink + guest-mode occurrences, total events). <c>null</c>
/// when the window is empty (the web returns <c>null</c> and hides the figures). Pure data.
/// </summary>
public sealed record SecurityStats(
    int LockEvents,
    int DoorOpenCount,
    int WindowOpenCount,
    int HomelinkCount,
    int GuestCount,
    int Total);

/// <summary>
/// Tolerant JSON readers for the security responses. The door/sentry/window fields are unions (bool|string|number),
/// so <see cref="Signal"/> boxes whichever scalar arrived (the web <c>unknown</c>); the typed readers coerce across
/// the scalar kinds the Go API emits. Kept internal + UI-free so the projection is unit-tested without a UI host.
/// </summary>
internal static class SecurityAccessJson
{
    /// <summary>Unwrap the platform <c>{data:{…}}</c> envelope when present, else return the element unchanged.</summary>
    public static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
        {
            return data;
        }

        return root;
    }

    /// <summary>Resolve a list payload: a bare array, or the first present array under one of <paramref name="keys"/>.</summary>
    public static IReadOnlyList<JsonElement> Array(JsonElement root, params string[] keys)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return Materialize(root);
        }

        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                return Materialize(data);
            }

            foreach (var key in keys)
            {
                if (root.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    return Materialize(arr);
                }
            }
        }

        return System.Array.Empty<JsonElement>();
    }

    /// <summary>Box the first present scalar (bool|string|number) under one of <paramref name="names"/>, else null.</summary>
    public static object? Signal(JsonElement o, params string[] names)
    {
        if (!TryGet(o, names, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.TryGetDouble(out var d) ? d : null,
            _ => null,
        };
    }

    /// <summary>Read a boolean (tolerating "true"/"false" strings and non-zero numbers), else null.</summary>
    public static bool? Bool(JsonElement o, params string[] names)
    {
        if (!TryGet(o, names, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => value.TryGetDouble(out var d) ? d != 0 : null,
            JsonValueKind.String => bool.TryParse(value.GetString(), out var b) ? b : null,
            _ => null,
        };
    }

    /// <summary>Read a 64-bit integer (tolerating numeric strings), else null.</summary>
    public static long? Long(JsonElement o, params string[] names)
    {
        if (!TryGet(o, names, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out var n) => n,
            JsonValueKind.Number when value.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>Read a string value (only when the wire value is a JSON string), else null.</summary>
    public static string? Str(JsonElement o, params string[] names) =>
        TryGet(o, names, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool TryGet(JsonElement o, string[] names, out JsonElement value)
    {
        if (o.ValueKind == JsonValueKind.Object)
        {
            foreach (var name in names)
            {
                if (o.TryGetProperty(name, out value) && value.ValueKind != JsonValueKind.Null)
                {
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static List<JsonElement> Materialize(JsonElement array)
    {
        var list = new List<JsonElement>();
        foreach (var item in array.EnumerateArray())
        {
            list.Add(item);
        }

        return list;
    }
}

/// <summary>
/// The render-time data model the <c>SecurityAccessPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/SecurityAccessPage.tsx): the polled latest snapshot, the
/// history feed, the per-query loading flags and the per-query error messages plus whether a vehicle is scoped. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SecurityAccessModel(
    SecurityEvent? Latest,
    IReadOnlyList<SecurityEvent> History,
    bool LoadingLatest,
    bool LoadingHistory,
    bool HasVehicle,
    string? VehiclesError,
    string? LatestError,
    string? HistoryError)
{
    /// <summary>The initial model: both reads in flight, nothing resolved yet (the loading state).</summary>
    public static SecurityAccessModel Initial { get; } = new(
        Latest: null,
        History: System.Array.Empty<SecurityEvent>(),
        LoadingLatest: true,
        LoadingHistory: true,
        HasVehicle: false,
        VehiclesError: null,
        LatestError: null,
        HistoryError: null);
}

/// <summary>One fleet-summary stat card (web <c>SummaryStatsRow</c>): a label, a value and an optional sub-caption.</summary>
public sealed record SecuritySummaryStat(string Label, string Value, string Sub);

/// <summary>One security status row (web <c>SecurityStatusCards</c>): a label, a value and its semantic tone.</summary>
public sealed record SecurityStatusItem(string Label, string Value, SecurityTone Tone);

/// <summary>One live-state detail row (web <c>LiveVehicleState</c>): a label / value pair.</summary>
public sealed record SecurityLiveItem(string Label, string Value);

/// <summary>One history-table column descriptor (web <c>EventHistoryTable</c> headers).</summary>
public sealed record SecurityEventColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected history-table row (web <c>EventHistoryTable</c> cell strings).</summary>
public sealed record SecurityEventRow(string Id, string Time, string Lock, string Sentry, string Doors, string Windows);

/// <summary>One projected timeline row (web <c>EventTimeline</c>): a localized title, detail, relative time + tone.</summary>
public sealed record SecurityTimelineRow(string Id, string Title, string Detail, string Time, SecurityTone Tone);

/// <summary>
/// The fully-projected, render-ready content the <c>SecurityAccessPage</c> view binds to — every visible string is
/// resolved and every per-region flag is decided here so the WinUI view is a thin renderer. Mirrors the web page's
/// composition: the header, the load-failure banner, the security alert <c>GlassPanel</c> (GlassPanel1), the
/// live-state <c>GlassPanel</c> (GlassPanel2), the summary stat cards, the per-vehicle status rows, the history table
/// and the event timeline — each with its loading / empty / error surface.
/// </summary>
public sealed record SecurityAccessDisplay(
    SecurityAccessState State,
    string Title,
    string Subtitle,
    string AutomationName,
    bool ShowLoading,
    bool ShowErrorBanner,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    bool ShowAlert,
    string AlertText,
    bool HasLatest,
    string LiveTitle,
    string LiveEmptyMessage,
    IReadOnlyList<SecuritySummaryStat> SummaryStats,
    IReadOnlyList<SecurityStatusItem> StatusItems,
    IReadOnlyList<SecurityLiveItem> LiveItems,
    string HistoryTitle,
    IReadOnlyList<SecurityEventColumn> Columns,
    IReadOnlyList<SecurityEventRow> Rows,
    bool HasHistory,
    string HistoryEmptyMessage,
    string TimelineTitle,
    IReadOnlyList<SecurityTimelineRow> Timeline,
    string TimelineEmptyMessage);

/// <summary>
/// Static registration facts for the surface (route name + the generated operation ids it binds) plus the localized
/// title. Mirrors the web hooks the page composes: <c>useSecurityEvents → GET /security</c>, the polled
/// <c>GET /security/latest</c> and <c>useVehicles → GET /vehicles</c>. Centralising the operation ids keeps the
/// literals out of the feed and lets a test assert each resolves against the generated endpoint table (ADR-004).
/// </summary>
public static class SecurityAccessRegistration
{
    /// <summary>The navigation route name (matches <c>RouteTable</c> <c>Page("SecurityAccess","security-access",…)</c>).</summary>
    public const string RouteName = "SecurityAccess";

    /// <summary>The diagnostics surface slug.</summary>
    public const string Slug = "SecurityAccessPage";

    /// <summary>The history read (web <c>useSecurityEvents → GET /security?vehicle_id=…</c>).</summary>
    public const string HistoryOperation = "get_api_v1_security";

    /// <summary>The polled latest snapshot (web <c>GET /security/latest?vehicle_id=…</c>).</summary>
    public const string LatestOperation = "get_api_v1_security_latest";

    /// <summary>The fleet scope read (web <c>useVehicles → GET /vehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    /// <summary>The localized page title (web <c>t('admin.security.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.security.title", "Security & Access");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the surface. Records only the <c>view.opened</c> event (no VINs, locations or signal
/// values) so the open can be counted without leaking telemetry. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class SecurityAccessDiagnostics
{
    private readonly Action<string>? _sink;

    /// <summary>Creates the sink over an optional line writer (tests capture the emitted lines).</summary>
    public SecurityAccessDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened { get; private set; }

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened()
    {
        ViewsOpened++;
        _sink?.Invoke($"view.opened slug={SecurityAccessRegistration.Slug}");
    }
}

/// <summary>
/// The pure, UI-free projection from <see cref="SecurityAccessModel"/> to <see cref="SecurityAccessDisplay"/> — the
/// native port of the web <c>SecurityAccessPage</c> render logic. Every visible string is resolved through the
/// injected <see cref="ILocalizer"/> (the 4 manifest keys are resolved on every projection regardless of data state)
/// and every per-region flag is decided here. The security helpers (<c>doorClosed</c>, <c>allWindowsClosed</c>,
/// <c>isSentryActive</c>, <c>computeSentryUptime</c>, <c>findLastLockChange</c>, <c>computeSecurityStats</c>,
/// <c>deriveTimeline</c>) are 1:1 ports of web/src/features/admin/components/security-access/helpers.ts.
/// </summary>
public static class SecurityAccessProjection
{
    private const string EmDash = "\u2014";
    private const int TimelineLimit = 50;

    /// <summary>Project the render-ready display for the current model, resolving every string through <paramref name="localizer"/>.</summary>
    public static SecurityAccessDisplay Project(SecurityAccessModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // The 4 manifest strings — resolved on EVERY projection regardless of data state.
        string title = localizer.GetString("admin.security.title", "Security & Access");
        string subtitle = localizer.GetString("admin.security.subtitle", "Lock status, sentry mode, doors, and windows");
        string alertText = localizer.GetString("admin.security.alert", "\u26a0 Vehicle may not be secure \u2014 check lock, door, and window status.");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");

        SecurityEvent? latest = model.Latest;
        IReadOnlyList<SecurityEvent> history = model.History ?? System.Array.Empty<SecurityEvent>();
        bool hasLatest = latest is not null;
        bool hasHistory = history.Count > 0;
        bool hasData = hasLatest || hasHistory;

        string? errorDetail = model.VehiclesError ?? model.LatestError ?? model.HistoryError;
        bool anyError = errorDetail is not null;
        bool loading = model.LoadingLatest || model.LoadingHistory;

        bool showLoading = loading && !hasData && !anyError;
        bool showErrorBanner = anyError;
        bool showContent = !showLoading;

        SecurityAccessState state = showLoading
            ? SecurityAccessState.Loading
            : anyError ? SecurityAccessState.Error : SecurityAccessState.Success;

        bool secure = IsSecure(latest);
        bool showAlert = hasLatest && !secure;

        string errorText = anyError ? $"{loadFailed}: {errorDetail}" : loadFailed;

        return new SecurityAccessDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            ShowLoading: showLoading,
            ShowErrorBanner: showErrorBanner,
            ShowContent: showContent,
            ErrorText: errorText,
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            ShowAlert: showAlert,
            AlertText: alertText,
            HasLatest: hasLatest,
            LiveTitle: localizer.GetString("admin.security.liveState", "Live Vehicle State"),
            LiveEmptyMessage: localizer.GetString("admin.security.live.empty", "No live vehicle state available"),
            SummaryStats: BuildSummaryStats(model, localizer, secure, now),
            StatusItems: BuildStatusItems(latest, localizer),
            LiveItems: BuildLiveItems(latest, localizer),
            HistoryTitle: localizer.GetString("admin.security.eventHistory", "Event History"),
            Columns: BuildColumns(localizer),
            Rows: BuildRows(history, now),
            HasHistory: hasHistory,
            HistoryEmptyMessage: localizer.GetString("admin.security.noEvents", "No security events recorded"),
            TimelineTitle: localizer.GetString("admin.security.timeline.title", "Event Timeline"),
            Timeline: BuildTimeline(history, localizer, now),
            TimelineEmptyMessage: localizer.GetString("admin.security.timeline.noEvents", "No timeline events"));
    }

    // ── Web helper ports (security-access/helpers.ts) ──────────────────────────────────────────────

    /// <summary>web <c>isSentryActive</c>: true for any non-"off" sentry value (bool or string).</summary>
    public static bool IsSentryActive(object? value)
    {
        if (value is bool b)
        {
            return b;
        }

        string? raw = AsNonEmptyString(value);
        return raw is not null && !raw.Contains("off", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>web <c>doorClosed</c>: true when the door value reads closed (null/bool/number/string tolerant).</summary>
    public static bool DoorClosed(object? value)
    {
        switch (value)
        {
            case null:
                return true;
            case bool b:
                return !b;
            case double d:
                return d == 0;
        }

        string? raw = AsNonEmptyString(value);
        if (raw is null)
        {
            return true;
        }

        string lower = raw.Trim().ToLowerInvariant();
        return lower is "" or "closed" or "closedall" or "0" or "false";
    }

    /// <summary>web <c>parseWindowState</c>: classify a single window value.</summary>
    public static SecurityWindowState ParseWindowState(object? value)
    {
        string? raw = AsNonEmptyString(value);
        if (raw is null)
        {
            return SecurityWindowState.Unknown;
        }

        string lower = raw.ToLowerInvariant();
        if (lower is "closed" or "0")
        {
            return SecurityWindowState.Closed;
        }

        if (lower.Contains("vent", StringComparison.Ordinal))
        {
            return SecurityWindowState.Venting;
        }

        return SecurityWindowState.Open;
    }

    /// <summary>web <c>allWindowsClosed</c>: every window classifies as closed.</summary>
    public static bool AllWindowsClosed(SecurityEvent? ev)
    {
        if (ev is null)
        {
            return true;
        }

        return ParseWindowState(ev.FdWindow) == SecurityWindowState.Closed
            && ParseWindowState(ev.FpWindow) == SecurityWindowState.Closed
            && ParseWindowState(ev.RdWindow) == SecurityWindowState.Closed
            && ParseWindowState(ev.RpWindow) == SecurityWindowState.Closed;
    }

    /// <summary>web <c>isSecure</c>: locked AND doors closed AND all windows closed.</summary>
    public static bool IsSecure(SecurityEvent? latest)
    {
        if (latest is null)
        {
            return true;
        }

        return (latest.Locked ?? false) && DoorClosed(latest.DoorState) && AllWindowsClosed(latest);
    }

    /// <summary>web <c>computeSentryUptime</c>: percent of events with sentry active.</summary>
    public static double ComputeSentryUptime(IReadOnlyList<SecurityEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (events.Count == 0)
        {
            return 0;
        }

        int on = 0;
        foreach (var ev in events)
        {
            if (IsSentryActive(ev.SentryMode))
            {
                on++;
            }
        }

        return (double)on / events.Count * 100;
    }

    /// <summary>web <c>findLastLockChange</c>: the timestamp of the last lock transition (or the newest event time).</summary>
    public static string? FindLastLockChange(IReadOnlyList<SecurityEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        for (var i = 1; i < events.Count; i++)
        {
            if (events[i].Locked != events[i - 1].Locked)
            {
                return events[i - 1].CreatedAt;
            }
        }

        return events.Count > 0 ? events[0].CreatedAt : null;
    }

    /// <summary>web <c>computeSecurityStats</c>: aggregate lock / door / window / homelink / guest counts, or null when empty.</summary>
    public static SecurityStats? ComputeSecurityStats(IReadOnlyList<SecurityEvent> history)
    {
        ArgumentNullException.ThrowIfNull(history);
        if (history.Count == 0)
        {
            return null;
        }

        int lockEvents = 0;
        for (var i = 1; i < history.Count; i++)
        {
            if (history[i].Locked != history[i - 1].Locked)
            {
                lockEvents++;
            }
        }

        int doorOpen = 0;
        int windowOpen = 0;
        int homelink = 0;
        int guest = 0;
        foreach (var ev in history)
        {
            if (!DoorClosed(ev.DoorState))
            {
                doorOpen++;
            }

            if (!AllWindowsClosed(ev))
            {
                windowOpen++;
            }

            if (ev.HomelinkNearby == true)
            {
                homelink++;
            }

            if (ev.GuestMode == true)
            {
                guest++;
            }
        }

        return new SecurityStats(lockEvents, doorOpen, windowOpen, homelink, guest, history.Count);
    }

    // ── Region builders ───────────────────────────────────────────────────────────────────────────

    private static SecuritySummaryStat[] BuildSummaryStats(
        SecurityAccessModel model,
        ILocalizer localizer,
        bool secure,
        DateTimeOffset now)
    {
        IReadOnlyList<SecurityEvent> history = model.History ?? System.Array.Empty<SecurityEvent>();
        string statusValue = model.Latest is null
            ? EmDash
            : secure
                ? localizer.GetString("admin.security.secure", "Secure")
                : localizer.GetString("admin.security.unsecure", "Not Secure");

        string lastLock = FormatRelative(FindLastLockChange(history), now);
        double uptime = ComputeSentryUptime(history);

        return new[]
        {
            new SecuritySummaryStat(
                localizer.GetString("admin.security.stat.status", "Status"),
                statusValue,
                localizer.GetString("admin.security.subtitle", "Lock status, sentry mode, doors, and windows")),
            new SecuritySummaryStat(
                localizer.GetString("admin.security.stat.lastLock", "Last Lock Change"),
                lastLock,
                string.Empty),
            new SecuritySummaryStat(
                localizer.GetString("admin.security.stat.sentryUptime", "Sentry Uptime"),
                FormatPercent(uptime),
                string.Empty),
            new SecuritySummaryStat(
                localizer.GetString("admin.security.stat.totalEvents", "Total Events"),
                FormatCount(history.Count),
                string.Empty),
        };
    }

    private static SecurityStatusItem[] BuildStatusItems(SecurityEvent? latest, ILocalizer localizer)
    {
        if (latest is null)
        {
            return System.Array.Empty<SecurityStatusItem>();
        }

        bool locked = latest.Locked ?? false;
        bool sentry = IsSentryActive(latest.SentryMode);
        bool doorsClosed = DoorClosed(latest.DoorState);
        bool windowsClosed = AllWindowsClosed(latest);

        return new[]
        {
            new SecurityStatusItem(
                localizer.GetString("admin.security.card.lockStatus", "Lock Status"),
                locked
                    ? localizer.GetString("admin.security.locked", "Locked")
                    : localizer.GetString("admin.security.unlocked", "Unlocked"),
                locked ? SecurityTone.Good : SecurityTone.Bad),
            new SecurityStatusItem(
                localizer.GetString("admin.security.card.sentryMode", "Sentry Mode"),
                sentry
                    ? localizer.GetString("admin.security.active", "Active")
                    : localizer.GetString("admin.security.inactive", "Inactive"),
                sentry ? SecurityTone.Good : SecurityTone.Neutral),
            new SecurityStatusItem(
                localizer.GetString("admin.security.card.doors", "Doors"),
                doorsClosed
                    ? localizer.GetString("admin.security.closed", "Closed")
                    : localizer.GetString("admin.security.open", "Open"),
                doorsClosed ? SecurityTone.Good : SecurityTone.Bad),
            new SecurityStatusItem(
                localizer.GetString("admin.security.card.windows", "Windows"),
                BuildWindowSummary(latest, localizer),
                windowsClosed ? SecurityTone.Good : SecurityTone.Warn),
        };
    }

    private static SecurityLiveItem[] BuildLiveItems(SecurityEvent? latest, ILocalizer localizer)
    {
        if (latest is null)
        {
            return System.Array.Empty<SecurityLiveItem>();
        }

        return new[]
        {
            new SecurityLiveItem(
                localizer.GetString("admin.security.live.driverSeat", "Driver Seat"),
                latest.DriverSeatOccupied == true
                    ? localizer.GetString("admin.security.live.occupied", "Occupied")
                    : EmDash),
            new SecurityLiveItem(
                localizer.GetString("admin.security.live.valetMode", "Valet Mode"),
                BoolLabel(latest.ValetModeEnabled, localizer)),
            new SecurityLiveItem(
                localizer.GetString("admin.security.live.serviceMode", "Service Mode"),
                BoolLabel(latest.ServiceMode, localizer)),
            new SecurityLiveItem(
                localizer.GetString("admin.security.live.pairedKeys", "Paired Keys"),
                latest.PairedPhoneKeyCount is { } keys ? FormatCount((int)keys) : EmDash),
            new SecurityLiveItem(
                localizer.GetString("admin.security.live.homelinkDevices", "HomeLink Devices"),
                latest.HomelinkDeviceCount is { } devices ? FormatCount((int)devices) : EmDash),
        };
    }

    private static SecurityEventColumn[] BuildColumns(ILocalizer localizer) => new[]
    {
        new SecurityEventColumn("time", localizer.GetString("admin.security.col.time", "Time"), false),
        new SecurityEventColumn("lock", localizer.GetString("admin.security.col.lock", "Lock"), false),
        new SecurityEventColumn("sentry", localizer.GetString("admin.security.col.sentry", "Sentry"), false),
        new SecurityEventColumn("doors", localizer.GetString("admin.security.col.doors", "Doors"), false),
        new SecurityEventColumn("windows", localizer.GetString("admin.security.col.windows", "Windows"), false),
    };

    private static List<SecurityEventRow> BuildRows(IReadOnlyList<SecurityEvent> history, DateTimeOffset now)
    {
        var rows = new List<SecurityEventRow>(history.Count);
        int index = 0;
        foreach (var ev in history)
        {
            rows.Add(new SecurityEventRow(
                Id: string.IsNullOrEmpty(ev.Id) ? $"row-{index}" : ev.Id,
                Time: FormatRelative(ev.CreatedAt, now),
                Lock: (ev.Locked ?? false) ? "Locked" : "Unlocked",
                Sentry: IsSentryActive(ev.SentryMode) ? "On" : "Off",
                Doors: DoorClosed(ev.DoorState) ? "Closed" : "Open",
                Windows: AllWindowsClosed(ev) ? "Closed" : "Open"));
            index++;
        }

        return rows;
    }

    private static IReadOnlyList<SecurityTimelineRow> BuildTimeline(
        IReadOnlyList<SecurityEvent> history,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (history.Count == 0)
        {
            return System.Array.Empty<SecurityTimelineRow>();
        }

        var sorted = new List<SecurityEvent>(history);
        sorted.Sort((a, b) => Compare(b.CreatedAt, a.CreatedAt));

        var timeline = new List<SecurityTimelineRow>();
        for (var i = 0; i < sorted.Count - 1 && timeline.Count < TimelineLimit; i++)
        {
            SecurityEvent curr = sorted[i];
            SecurityEvent prev = sorted[i + 1];

            if (curr.Locked != prev.Locked)
            {
                bool locked = curr.Locked ?? false;
                timeline.Add(new SecurityTimelineRow(
                    Id: $"lock-{curr.Id}-{i}",
                    Title: locked
                        ? localizer.GetString("admin.security.timeline.lock.positive", "Vehicle Locked")
                        : localizer.GetString("admin.security.timeline.lock.negative", "Vehicle Unlocked"),
                    Detail: AsNonEmptyString(curr.DoorState) ?? EmDash,
                    Time: FormatRelative(curr.CreatedAt, now),
                    Tone: locked ? SecurityTone.Good : SecurityTone.Bad));
            }

            if (!SignalEquals(curr.SentryMode, prev.SentryMode))
            {
                bool active = IsSentryActive(curr.SentryMode);
                timeline.Add(new SecurityTimelineRow(
                    Id: $"sentry-{curr.Id}-{i}",
                    Title: active
                        ? localizer.GetString("admin.security.timeline.sentry.positive", "Sentry Activated")
                        : localizer.GetString("admin.security.timeline.sentry.negative", "Sentry Deactivated"),
                    Detail: string.Empty,
                    Time: FormatRelative(curr.CreatedAt, now),
                    Tone: active ? SecurityTone.Good : SecurityTone.Bad));
            }

            if (!SignalEquals(curr.DoorState, prev.DoorState))
            {
                bool closed = DoorClosed(curr.DoorState);
                timeline.Add(new SecurityTimelineRow(
                    Id: $"door-{curr.Id}-{i}",
                    Title: closed
                        ? localizer.GetString("admin.security.timeline.door.positive", "Doors Closed")
                        : localizer.GetString("admin.security.timeline.door.negative", "Doors Opened"),
                    Detail: AsNonEmptyString(curr.DoorState) ?? (closed ? "Closed" : "Open"),
                    Time: FormatRelative(curr.CreatedAt, now),
                    Tone: closed ? SecurityTone.Good : SecurityTone.Bad));
            }
        }

        timeline.Sort((a, b) => string.CompareOrdinal(b.Id, a.Id));
        return timeline;
    }

    private static string BuildWindowSummary(SecurityEvent ev, ILocalizer localizer)
    {
        var states = new[]
        {
            ParseWindowState(ev.FdWindow),
            ParseWindowState(ev.FpWindow),
            ParseWindowState(ev.RdWindow),
            ParseWindowState(ev.RpWindow),
        };

        int openCount = 0;
        foreach (var s in states)
        {
            if (s != SecurityWindowState.Closed)
            {
                openCount++;
            }
        }

        return openCount == 0
            ? localizer.GetString("admin.security.closed", "All Closed")
            : string.Format(CultureInfo.InvariantCulture, "{0} {1}", openCount, localizer.GetString("admin.security.open", "Open"));
    }

    private static string BoolLabel(bool? value, ILocalizer localizer) => value switch
    {
        true => localizer.GetString("admin.security.enabled", "Enabled"),
        false => localizer.GetString("admin.security.disabled", "Disabled"),
        _ => EmDash,
    };

    // ── Formatting ────────────────────────────────────────────────────────────────────────────────

    /// <summary>web <c>timeSince</c>: "just now" / "Nm ago" / "Nh ago" / "Nd ago" / em-dash for null/unparseable.</summary>
    public static string FormatRelative(string? raw, DateTimeOffset now)
    {
        if (!TryParseInstant(raw, out var value))
        {
            return EmDash;
        }

        double diffSeconds = (now - value).TotalSeconds;
        if (diffSeconds < 0)
        {
            return EmDash;
        }

        long seconds = (long)Math.Floor(diffSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return $"{minutes}m ago";
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return $"{hours}h ago";
        }

        long days = hours / 24;
        return $"{days}d ago";
    }

    /// <summary>Thousands-grouped integer (en-US), matching the web <c>toLocaleString()</c> default.</summary>
    public static string FormatCount(int value) => value.ToString("#,0", CultureInfo.GetCultureInfo("en-US"));

    /// <summary>One-decimal percent (web <c>uptime.toFixed(1)%</c>).</summary>
    public static string FormatPercent(double value) =>
        string.Format(CultureInfo.InvariantCulture, "{0:0.0}%", value);

    private static bool TryParseInstant(string? raw, out DateTimeOffset value)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            value = default;
            return false;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out value);
    }

    private static int Compare(string? a, string? b)
    {
        bool pa = TryParseInstant(a, out var da);
        bool pb = TryParseInstant(b, out var db);
        if (pa && pb)
        {
            return da.CompareTo(db);
        }

        if (pa)
        {
            return 1;
        }

        return pb ? -1 : string.CompareOrdinal(a, b);
    }

    private static bool SignalEquals(object? a, object? b)
    {
        if (a is null && b is null)
        {
            return true;
        }

        if (a is null || b is null)
        {
            return false;
        }

        return a.Equals(b);
    }

    private static string? AsNonEmptyString(object? value) =>
        value is string s && !string.IsNullOrWhiteSpace(s) ? s : null;
}
