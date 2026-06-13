using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>ActiveSessionsPage</c> surface — the native mirror of the render
/// branches the web component renders (web/src/features/settings/components/ActiveSessionsSection.tsx, hosted by
/// web/src/features/settings/pages/ActiveSessionsPage.tsx). The web component renders, in precedence order, the
/// loading panel (web <c>sessions.isLoading</c>), the open-mode panel (web <c>!sessions.data || mode === 'open'</c>),
/// then the forward-auth panel — whose table shows either rows (web <c>sessions.map</c>) or the empty message
/// (web <c>emptyMessage</c>). The native surface additionally promotes a genuine list-load failure to a dedicated
/// failure-and-retry state (the web maps an errored query to the open-mode branch because <c>sessions.data</c> is
/// undefined; the native port surfaces it explicitly so the data-state contract holds). Per-region visibility is
/// still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum ActiveSessionsState
{
    /// <summary>The sessions query is in flight on first paint (web <c>sessions.isLoading</c>).</summary>
    Loading,

    /// <summary>The backend reported <c>AUTH_MODE_OPEN</c> (web <c>mode === 'open'</c>) — the forward-auth notice shows.</summary>
    OpenMode,

    /// <summary>The list query failed — the failure surface + retry shows.</summary>
    Error,

    /// <summary>Forward-auth resolved with no sessions (web table empty message).</summary>
    Empty,

    /// <summary>Forward-auth resolved with one or more sessions (web table rows).</summary>
    Populated,
}

/// <summary>
/// The discriminator of the sessions list response — the native mirror of the web <c>ActiveSessionsResponse</c> union
/// (<c>{ mode: 'open' }</c> | <c>{ mode: 'session'; sessions }</c>). <see cref="Open"/> is the
/// session-tracking-unavailable signal the backend returns as a 501 <c>AUTH_MODE_OPEN</c>; <see cref="Session"/> is the
/// forward-auth list.
/// </summary>
public enum SessionsMode
{
    /// <summary>Session tracking is unavailable (web <c>{ mode: 'open' }</c>, backend <c>AUTH_MODE_OPEN</c>).</summary>
    Open,

    /// <summary>Forward-auth is active and the list (possibly empty) is present (web <c>{ mode: 'session' }</c>).</summary>
    Session,
}

/// <summary>
/// One active browser/device session — the native mirror of the web <c>ActiveSession</c> the list reads (id,
/// user-agent, ip, the created + last-seen ISO timestamps and the <c>current</c> marker). Field names mirror the Go
/// snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Id">The opaque session id (web <c>id</c>).</param>
/// <param name="UserAgent">The raw User-Agent the device label is derived from (web <c>user_agent</c>).</param>
/// <param name="Ip">The remote IP address (web <c>ip</c>).</param>
/// <param name="CreatedAt">The ISO sign-in timestamp (web <c>created_at</c>), or null when absent.</param>
/// <param name="LastSeenAt">The ISO last-seen timestamp (web <c>last_seen_at</c>), or null when absent.</param>
/// <param name="Current">True for the session making the request (web <c>current</c>).</param>
public sealed record ActiveSession(
    string Id,
    string UserAgent,
    string Ip,
    string? CreatedAt,
    string? LastSeenAt,
    bool Current)
{
    /// <summary>The parsed sign-in instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => ParseTimestamp(CreatedAt);

    /// <summary>The parsed last-seen instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? LastSeenTime => ParseTimestamp(LastSeenAt);

    /// <summary>Read one session from a JSON object, tolerating missing / null fields.</summary>
    public static ActiveSession FromJson(JsonElement o) => new(
        Id: ActiveSessionsJson.Str(o, "id") ?? string.Empty,
        UserAgent: ActiveSessionsJson.Str(o, "user_agent") ?? string.Empty,
        Ip: ActiveSessionsJson.Str(o, "ip") ?? string.Empty,
        CreatedAt: ActiveSessionsJson.Str(o, "created_at"),
        LastSeenAt: ActiveSessionsJson.Str(o, "last_seen_at"),
        Current: ActiveSessionsJson.Bool(o, "current"));

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
            out var value)
            ? value
            : null;
    }
}

/// <summary>
/// The sessions-list envelope — the native mirror of the resolved web <c>useSessions</c> value: the discriminating
/// <see cref="Mode"/> plus the parsed <see cref="Sessions"/>. The tolerant parser accepts the backend
/// <c>{ mode, sessions }</c> object, the platform <c>{ data: [...] }</c> envelope and a bare array; an explicit
/// <c>mode: 'open'</c> resolves to <see cref="Open"/>. Pure data.
/// </summary>
public sealed record ActiveSessionsSnapshot(SessionsMode Mode, IReadOnlyList<ActiveSession> Sessions)
{
    /// <summary>The open-mode snapshot (session tracking unavailable) — web <c>{ mode: 'open' }</c>.</summary>
    public static ActiveSessionsSnapshot Open { get; } = new(SessionsMode.Open, Array.Empty<ActiveSession>());

    /// <summary>The resolved-but-empty forward-auth snapshot — the default local-state feed result.</summary>
    public static ActiveSessionsSnapshot EmptySession { get; } = new(SessionsMode.Session, Array.Empty<ActiveSession>());

    /// <summary>
    /// Read the sessions list from JSON, tolerating the backend <c>{ mode, sessions }</c> object, the platform
    /// <c>{ data: [...] }</c> envelope and a bare array. An explicit <c>mode: 'open'</c> yields <see cref="Open"/>.
    /// </summary>
    public static ActiveSessionsSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            string? mode = ActiveSessionsJson.Str(root, "mode");
            if (string.Equals(mode, "open", StringComparison.OrdinalIgnoreCase))
            {
                return Open;
            }

            if (root.TryGetProperty("sessions", out var sessions))
            {
                return new ActiveSessionsSnapshot(SessionsMode.Session, ReadArray(sessions));
            }

            if (root.TryGetProperty("data", out var data))
            {
                return new ActiveSessionsSnapshot(SessionsMode.Session, ReadArray(data));
            }
        }

        return new ActiveSessionsSnapshot(SessionsMode.Session, ReadArray(root));
    }

    private static IReadOnlyList<ActiveSession> ReadArray(JsonElement arr)
    {
        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ActiveSession>();
        }

        var list = new List<ActiveSession>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(ActiveSession.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The render-time data model the <c>ActiveSessionsPage</c> projects from — the native analogue of the web
/// component's resolved query plus the in-flight revoke flags
/// (web/src/features/settings/components/ActiveSessionsSection.tsx). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Mode">The resolved list discriminator (null while the first load is in flight).</param>
/// <param name="Sessions">The session rows (web <c>sessions.data.sessions</c>).</param>
/// <param name="Loading">Whether the list query is in flight with no data yet (web <c>sessions.isLoading</c>).</param>
/// <param name="HasError">Whether the list query failed (web <c>sessions.isError</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="RevokingId">The id of the row whose per-row revoke is in flight (web <c>revokeMut.variables</c>).</param>
/// <param name="RevokingAllOthers">Whether the all-others revoke is in flight (web <c>revokeAllOthersMut.isPending</c>).</param>
/// <param name="Now">The reference instant for the timestamp formatting.</param>
public sealed record ActiveSessionsModel(
    SessionsMode? Mode,
    IReadOnlyList<ActiveSession> Sessions,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    string? RevokingId,
    bool RevokingAllOthers,
    DateTimeOffset Now)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static ActiveSessionsModel Initial { get; } = new(
        Mode: null,
        Sessions: Array.Empty<ActiveSession>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        RevokingId: null,
        RevokingAllOthers: false,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>
/// One projected, render-ready session row (web table row): the formatted cells plus the row's revoke affordance and
/// "this device" marker. Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Id">The session id the revoke mutation targets.</param>
/// <param name="Device">The heuristic device label (web <c>describeDevice(user_agent)</c>).</param>
/// <param name="Ip">The IP cell, or the em-dash fallback (web <c>row.ip || '—'</c>).</param>
/// <param name="SignedIn">The formatted sign-in timestamp (web <c>formatTimestamp(created_at)</c>).</param>
/// <param name="LastSeen">The formatted last-seen timestamp (web <c>formatTimestamp(last_seen_at)</c>).</param>
/// <param name="Current">True for the request's own session (web <c>row.current</c>).</param>
/// <param name="CurrentLabel">The "this device" chip label (web <c>sessions.current</c>).</param>
/// <param name="CanRevoke">Whether the row shows a revoke button (web renders none for the current row).</param>
/// <param name="RevokeLabel">The revoke button label (web <c>sessions.row.revoke</c>).</param>
/// <param name="RevokeAria">The revoke button accessible name (web <c>sessions.row.revokeAria</c>).</param>
/// <param name="RevokeBusy">Whether this row's revoke is in flight (the button disables, web <c>revokeMut.isPending</c>).</param>
public sealed record ActiveSessionRowDisplay(
    string Id,
    string Device,
    string Ip,
    string SignedIn,
    string LastSeen,
    bool Current,
    string CurrentLabel,
    bool CanRevoke,
    string RevokeLabel,
    string RevokeAria,
    bool RevokeBusy);

/// <summary>
/// The render-ready display the <c>ActiveSessionsPage</c> view binds to — every visible literal resolved through the
/// i18n facade and every per-region visibility flag computed, so the view is a thin renderer. The native mirror of
/// the full web tree: the page chrome (<see cref="Title"/> + <see cref="Subtitle"/>, the two manifest strings) plus
/// the hosted section's loading / open-mode / error / forward-auth (table or empty) branches and the two destructive
/// confirm dialogs.
/// </summary>
public sealed record ActiveSessionsDisplay(
    ActiveSessionsState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    string LoadingText,
    bool ShowOpenMode,
    string OpenModeTitle,
    string OpenModeMessage,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowForwardAuth,
    string PanelTitle,
    string PanelSubtitle,
    bool ShowInlineError,
    string InlineErrorText,
    bool ShowAllOthers,
    string AllOthersLabel,
    bool AllOthersBusy,
    string DeviceHeader,
    string IpHeader,
    string SignedInHeader,
    string LastSeenHeader,
    bool ShowTable,
    IReadOnlyList<ActiveSessionRowDisplay> Rows,
    bool ShowEmpty,
    string EmptyMessage,
    string RevokeConfirmTitle,
    string RevokeConfirmMessageTemplate,
    string RevokeConfirmLabel,
    string RevokeCancelLabel,
    string AllOthersConfirmTitle,
    string AllOthersConfirmMessage,
    string AllOthersConfirmLabel,
    string AllOthersCancelLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="ActiveSessionsModel"/> to its <see cref="ActiveSessionsDisplay"/> — the native
/// port of the render logic in web/src/features/settings/components/ActiveSessionsSection.tsx (and the hosting page's
/// PageContainer chrome). Every visible literal resolves through the i18n facade using the exact web key names; the
/// chrome strings (page title/subtitle, panel header, column labels, confirm copy) resolve on every projection so the
/// i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ActiveSessionsProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literal.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The token replaced by the device label in the revoke-aria + confirm-message templates (web <c>{{device}}</c>).</summary>
    public const string DeviceToken = "{{device}}";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + revoke flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ActiveSessionsDisplay Project(ActiveSessionsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Page chrome (web PageContainer title + subtitle — the two manifest strings).
        string title = ActiveSessionsRegistration.Title(localizer);
        string subtitle = ActiveSessionsRegistration.Subtitle(localizer);

        // Loading panel (web sessions.isLoading).
        string loadingText = localizer.GetString("sessions.loading", "Loading sessions\u2026");

        // Open-mode panel (web mode === 'open').
        string openModeTitle = localizer.GetString("sessions.openMode.title", "Active sessions");
        string openModeMessage = localizer.GetString(
            "sessions.openMode.message",
            "Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.");

        // Failure surface (the native error+retry state).
        string loadFailed = localizer.GetString("sessions.errors.load", "Failed to load active sessions.");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed} {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // Forward-auth panel header (web IconBox + Heading + HelperText + all-others Button).
        string panelTitle = localizer.GetString("sessions.title", "Active sessions");
        string panelSubtitle = localizer.GetString(
            "sessions.subtitle",
            "Devices currently signed in to TeslaSync. Revoking a session signs that browser out on its next request \u2014 your upstream identity provider's session is unaffected.");
        string allOthersLabelIdle = localizer.GetString("sessions.revokeAllOthers", "Sign out all other devices");
        string allOthersLabelBusy = localizer.GetString("sessions.revokeAllOthersBusy", "Signing out\u2026");

        // Table chrome (web DataTable column headers + row affordances).
        string deviceHeader = localizer.GetString("sessions.columns.device", "Device");
        string ipHeader = localizer.GetString("sessions.columns.ip", "IP address");
        string signedInHeader = localizer.GetString("sessions.columns.createdAt", "Signed in");
        string lastSeenHeader = localizer.GetString("sessions.columns.lastSeenAt", "Last seen");
        string currentLabel = localizer.GetString("sessions.current", "This device");
        string revokeLabel = localizer.GetString("sessions.row.revoke", "Sign out");
        string revokeAriaTemplate = localizer.GetString("sessions.row.revokeAria", "Sign out {{device}}");
        string emptyMessage = localizer.GetString("sessions.empty", "No active sessions for this account.");

        // Confirm-dialog copy (web ConfirmDialog — destructive, never silenceable).
        string revokeConfirmTitle = localizer.GetString("sessions.confirm.revokeTitle", "Sign out this device?");
        string revokeConfirmMessageTemplate = localizer.GetString(
            "sessions.confirm.revokeMessage",
            "{{device}} will be signed out on its next request. Your other devices will stay signed in.");
        string revokeConfirmLabel = localizer.GetString("sessions.confirm.revokeConfirm", "Sign out");
        string revokeCancelLabel = localizer.GetString("sessions.confirm.revokeCancel", "Keep signed in");
        string allOthersConfirmTitle = localizer.GetString("sessions.confirm.allOthersTitle", "Sign out all other devices?");
        string allOthersConfirmMessage = localizer.GetString(
            "sessions.confirm.allOthersMessage",
            "Every browser other than this one will be signed out on its next request. You can sign back in immediately.");
        string allOthersConfirmLabel = localizer.GetString("sessions.confirm.allOthersConfirm", "Sign out all others");
        string allOthersCancelLabel = localizer.GetString("sessions.confirm.allOthersCancel", "Cancel");

        // State resolution (web render-branch precedence).
        ActiveSessionsState state = ResolveState(model);

        bool showForwardAuth = state is ActiveSessionsState.Empty or ActiveSessionsState.Populated;
        bool hasOthers = false;
        var rows = new List<ActiveSessionRowDisplay>(model.Sessions.Count);
        if (showForwardAuth)
        {
            foreach (var session in model.Sessions)
            {
                string device = ActiveSessionsRegistration.DescribeDevice(session.UserAgent);
                if (!session.Current)
                {
                    hasOthers = true;
                }

                rows.Add(new ActiveSessionRowDisplay(
                    Id: session.Id,
                    Device: device,
                    Ip: string.IsNullOrEmpty(session.Ip) ? EmDash : session.Ip,
                    SignedIn: DateTimeFormatting.Format(session.CreatedAtTime, DateTimeVariant.Full, model.Now),
                    LastSeen: DateTimeFormatting.Format(session.LastSeenTime, DateTimeVariant.Full, model.Now),
                    Current: session.Current,
                    CurrentLabel: currentLabel,
                    CanRevoke: !session.Current,
                    RevokeLabel: revokeLabel,
                    RevokeAria: revokeAriaTemplate.Replace(DeviceToken, device, StringComparison.Ordinal),
                    RevokeBusy: string.Equals(model.RevokingId, session.Id, StringComparison.Ordinal)));
            }
        }

        bool allOthersBusy = model.RevokingAllOthers;

        return new ActiveSessionsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == ActiveSessionsState.Loading,
            LoadingText: loadingText,
            ShowOpenMode: state == ActiveSessionsState.OpenMode,
            OpenModeTitle: openModeTitle,
            OpenModeMessage: openModeMessage,
            ShowError: state == ActiveSessionsState.Error,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowForwardAuth: showForwardAuth,
            PanelTitle: panelTitle,
            PanelSubtitle: panelSubtitle,
            ShowInlineError: showForwardAuth && model.HasError,
            InlineErrorText: loadFailed,
            ShowAllOthers: state == ActiveSessionsState.Populated && hasOthers,
            AllOthersLabel: allOthersBusy ? allOthersLabelBusy : allOthersLabelIdle,
            AllOthersBusy: allOthersBusy,
            DeviceHeader: deviceHeader,
            IpHeader: ipHeader,
            SignedInHeader: signedInHeader,
            LastSeenHeader: lastSeenHeader,
            ShowTable: state == ActiveSessionsState.Populated,
            Rows: rows,
            ShowEmpty: state == ActiveSessionsState.Empty,
            EmptyMessage: emptyMessage,
            RevokeConfirmTitle: revokeConfirmTitle,
            RevokeConfirmMessageTemplate: revokeConfirmMessageTemplate,
            RevokeConfirmLabel: revokeConfirmLabel,
            RevokeCancelLabel: revokeCancelLabel,
            AllOthersConfirmTitle: allOthersConfirmTitle,
            AllOthersConfirmMessage: allOthersConfirmMessage,
            AllOthersConfirmLabel: allOthersConfirmLabel,
            AllOthersCancelLabel: allOthersCancelLabel,
            AutomationName: title);
    }

    /// <summary>Resolve the top-level data state from the model in the web render-branch precedence order.</summary>
    public static ActiveSessionsState ResolveState(ActiveSessionsModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (model.Loading)
        {
            return ActiveSessionsState.Loading;
        }

        if (model.HasError)
        {
            return ActiveSessionsState.Error;
        }

        if (model.Mode is not SessionsMode.Session)
        {
            return ActiveSessionsState.OpenMode;
        }

        return model.Sessions.Count == 0 ? ActiveSessionsState.Empty : ActiveSessionsState.Populated;
    }
}

/// <summary>
/// Canonical metadata for the <c>ActiveSessionsPage</c> feature surface — the native mirror of the web page at
/// web/src/features/settings/pages/ActiveSessionsPage.tsx (route <c>/account/sessions</c>, nav name
/// <c>Active Sessions</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the title and
/// subtitle resolve through the i18n facade with the web key names and the web inline-default English copy (these two
/// keys live as inline <c>t(key, default)</c> fallbacks in the web source — they are not catalog entries — so the
/// native surface resolves them the same way: keyed, with the same English fallback).
/// </summary>
public static class ActiveSessionsRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under (see RouteTable <c>ActiveSessions</c>).</summary>
    public const string RouteName = "ActiveSessions";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ActiveSessionsPage";

    /// <summary>The generated OpenAPI operation id for the list query (web <c>useSessions</c> GET /auth/sessions).</summary>
    public const string ListOperation = "get_api_v1_auth_sessions";

    /// <summary>The generated OpenAPI operation id for a single-session revoke (web <c>useRevokeSession</c>).</summary>
    public const string RevokeOperation = "delete_api_v1_auth_sessions_id";

    /// <summary>The generated OpenAPI operation id for the all-others revoke (web <c>useRevokeAllOtherSessions</c>).</summary>
    public const string RevokeAllOthersOperation = "delete_api_v1_auth_sessions_all_others";

    /// <summary>The structured error code the backend returns when session tracking is unavailable (web sentinel).</summary>
    public const string AuthModeOpenCode = "AUTH_MODE_OPEN";

    /// <summary>The Segoe Fluent Icons glyph for the forward-auth panel header (web Laptop icon).</summary>
    public const string DeviceGlyph = "\uE7F8"; // Devices

    /// <summary>The Segoe Fluent Icons glyph for the open-mode notice (web AlertTriangle icon).</summary>
    public const string WarningGlyph = "\uE7BA"; // Warning

    /// <summary>The Segoe Fluent Icons glyph for the per-row revoke action (web LogOut icon).</summary>
    public const string RevokeGlyph = "\uF3B1"; // SignOut

    /// <summary>The Segoe Fluent Icons glyph for the all-others revoke action (web ShieldAlert icon).</summary>
    public const string AllOthersGlyph = "\uE730"; // Shield

    /// <summary>The localized page title (web <c>account.sessions.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("account.sessions.title", "Active sessions");
    }

    /// <summary>The localized page subtitle (web <c>account.sessions.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "account.sessions.subtitle",
            "Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.");
    }

    /// <summary>
    /// Heuristic device label derived from a User-Agent string — a 1:1 port of the web <c>describeDevice</c>: a tiny
    /// match ladder over the major browsers + operating systems producing a "Firefox on Windows" style label, with a
    /// graceful fallback so an unknown agent still identifies its row.
    /// </summary>
    public static string DescribeDevice(string userAgent)
    {
        string ua = (userAgent ?? string.Empty).Trim();
        if (ua.Length == 0)
        {
            return "Unknown device";
        }

        string browser = "Browser";
        if (Contains(ua, "Edg/"))
        {
            browser = "Edge";
        }
        else if (Contains(ua, "OPR/") || Contains(ua, "Opera"))
        {
            browser = "Opera";
        }
        else if (Contains(ua, "Chrome/") && !Contains(ua, "Chromium"))
        {
            browser = "Chrome";
        }
        else if (Contains(ua, "Chromium"))
        {
            browser = "Chromium";
        }
        else if (Contains(ua, "Firefox/"))
        {
            browser = "Firefox";
        }
        else if (Contains(ua, "Safari/") && !Contains(ua, "Chrome/"))
        {
            browser = "Safari";
        }

        string os = "Unknown OS";
        if (Contains(ua, "Windows NT"))
        {
            os = "Windows";
        }
        else if (Contains(ua, "Mac OS X") || Contains(ua, "Macintosh"))
        {
            os = "macOS";
        }
        else if (Contains(ua, "Android"))
        {
            os = "Android";
        }
        else if (Contains(ua, "iPhone") || Contains(ua, "iPad") || Contains(ua, "iPod"))
        {
            os = "iOS";
        }
        else if (Contains(ua, "Linux"))
        {
            os = "Linux";
        }

        return $"{browser} on {os}";
    }

    private static bool Contains(string haystack, string needle) =>
        haystack.Contains(needle, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>ActiveSessionsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, user-agent or IP — so a
/// diagnostics line can never leak account or device data. Thread-safe.
/// </summary>
public sealed class ActiveSessionsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ActiveSessionsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActiveSessionsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ActiveSessionsRegistration.Slug}");
    }
}

/// <summary>Null-tolerant JSON readers for the sessions parsers (mirrors the sibling feature-view helpers).</summary>
internal static class ActiveSessionsJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a boolean property, tolerating absence (false) and JSON true/false.</summary>
    public static bool Bool(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}
