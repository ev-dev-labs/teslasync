using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="MyActivityPageViewModel"/> can be in for its single
/// data source — the web page's <c>useMyRecentActivity</c> hook
/// (web/src/features/system/pages/MyActivityPage.tsx, <c>GET /users/me/activity</c>). The web page is a thin
/// <c>PageContainer</c> (with <c>loading={isLoading}</c>) wrapping one <c>GlassPanel</c> that selects between
/// four mutually-exclusive bodies — the 503 "feature disabled" notice, the 401 "identity required" notice, a
/// generic retriable error notice, and (otherwise) the <c>RecentActivityFeed</c> which renders either its own
/// empty notice or the timeline. This union names every one of those outcomes; none collapses the panel
/// silently (ADR-011).
/// </summary>
public enum MyActivityState
{
    /// <summary>The first activity fetch is in flight — the web <c>loading={isLoading}</c> spinner.</summary>
    Loading,

    /// <summary>The endpoint returned <c>503</c> — ForwardAuth is not configured (web <c>featureDisabled</c>).</summary>
    Disabled,

    /// <summary>The endpoint returned <c>401</c> — the request carried no identity header (web <c>unauthenticated</c>).</summary>
    Unauthorized,

    /// <summary>The fetch failed for any other reason — the retriable error notice (web <c>apiError</c>).</summary>
    Error,

    /// <summary>The fetch resolved with no rows in the window — the feed's empty notice (web <c>entries.length === 0</c>).</summary>
    Empty,

    /// <summary>The fetch resolved with at least one row — the activity timeline (web success).</summary>
    Loaded,
}

/// <summary>
/// Which body the single <c>GlassPanel</c> renders — either the activity <c>timeline</c> (the success branch) or a
/// centred <c>notice</c> (the loading / disabled / unauthorized / error / empty branches, each a native
/// <c>TsEmptyState</c>). The native mirror of the web page's branch selection inside the panel.
/// </summary>
public enum MyActivityBody
{
    /// <summary>A centred notice (glyph + title + message + optional retry) — every non-success branch.</summary>
    Notice,

    /// <summary>The activity timeline — the success branch (web <c>RecentActivityFeed</c>).</summary>
    Timeline,
}

/// <summary>
/// The query the activity source answers — the native mirror of the web <c>MyActivityParams</c>
/// (web/src/api/hooks/useUser.ts, <c>buildActivityQuery</c>). <see cref="Start"/> / <see cref="End"/> are
/// ISO <c>yyyy-MM-dd</c> strings (sent as the snake_case <c>start</c> / <c>end</c> query params, matching the
/// Go API); <see cref="Limit"/> is capped server-side at 200.
/// </summary>
/// <param name="Start">The inclusive window start (web <c>start</c>), ISO <c>yyyy-MM-dd</c>.</param>
/// <param name="End">The inclusive window end (web <c>end</c>), ISO <c>yyyy-MM-dd</c>.</param>
/// <param name="Limit">The maximum number of rows to request (web <c>limit</c>, <see cref="MyActivityRegistration.ActivityLimit"/>).</param>
public sealed record MyActivityQuery(string Start, string End, int Limit);

/// <summary>
/// One audit-log row scoped to the current user — the native mirror of the web <c>UserActivityEntry</c>
/// (web/src/types/admin.ts), narrowed to the fields the feed renders
/// (web/src/components/data-display/RecentActivityFeed.tsx). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Id">The audit-log row id (web <c>id</c>), the stable row key.</param>
/// <param name="Timestamp">When the action occurred (web <c>ts</c>), driving the relative-time label.</param>
/// <param name="Action">The audit action string (web <c>action</c>), e.g. <c>vehicle.command.wake</c>.</param>
/// <param name="EntityType">The acted-on entity type (web <c>entity_type</c>), or null.</param>
/// <param name="EntityId">The acted-on entity id (web <c>entity_id</c>), or null.</param>
/// <param name="Detail">The optional free-text detail (web <c>detail</c>), or null.</param>
public sealed record UserActivityEntry(
    long Id,
    DateTimeOffset? Timestamp,
    string Action,
    string? EntityType,
    string? EntityId,
    string? Detail)
{
    /// <summary>Parse a <c>GET /users/me/activity</c> array body into rows (web <c>safeArray</c> — empty when not an array).</summary>
    /// <param name="root">The parsed response body.</param>
    /// <returns>The parsed rows, newest first as the server returns them; empty when the body is not an array.</returns>
    public static IReadOnlyList<UserActivityEntry> FromArray(JsonElement root)
    {
        var rows = new List<UserActivityEntry>();
        if (root.ValueKind != JsonValueKind.Array)
        {
            return rows;
        }

        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = MyActivityJson.Long(element, "id", "id") ?? 0;
            string action = MyActivityJson.String(element, "action", "action") ?? string.Empty;

            rows.Add(new UserActivityEntry(
                Id: id,
                Timestamp: MyActivityJson.Time(element, "ts", "ts"),
                Action: action,
                EntityType: MyActivityJson.String(element, "entity_type", "entityType"),
                EntityId: MyActivityJson.String(element, "entity_id", "entityId"),
                Detail: MyActivityJson.String(element, "detail", "detail")));
        }

        return rows;
    }
}

/// <summary>
/// One projected, render-ready feed row — the native analogue of a single web <c>RecentActivityFeed</c> timeline
/// item (web/src/components/data-display/RecentActivityFeed.tsx). <see cref="Title"/> is the resolved action
/// label (web <c>getActivityVisual(action)</c> → <c>t(i18nKey, fallback)</c>); <see cref="Subtitle"/> is the
/// composed <c>entity · id — detail</c> line (or null); <see cref="Timestamp"/> drives the relative-time label;
/// and <see cref="Severity"/> is the wire severity token (<c>info</c>/<c>warn</c>/<c>critical</c>/<c>success</c>)
/// that colours the timeline dot (the native analogue of the web per-action accent colour). Pure data.
/// </summary>
/// <param name="Title">The resolved action label (web <c>t(visual.i18nKey, visual.fallback)</c>).</param>
/// <param name="Subtitle">The composed <c>entity · id — detail</c> line, or null when the row has neither.</param>
/// <param name="Timestamp">When the action occurred (web <c>entry.ts</c>), driving the relative-time label.</param>
/// <param name="Severity">The wire severity token (<c>info</c>/<c>warn</c>/<c>critical</c>/<c>success</c>) for the dot.</param>
public sealed record MyActivityRow(string Title, string? Subtitle, DateTimeOffset? Timestamp, string Severity);

/// <summary>
/// The fully projected, render-ready view of the page for one (entries, state) input — the native analogue of
/// what the web <c>MyActivityPage</c> renders. Carries the two header literals + copy-link target, the chosen
/// <see cref="Body"/>, the notice fields (glyph / title / message / optional retry label) for every non-success
/// branch, the timeline <see cref="Rows"/> for the success branch, and the composed accessible name. Pure data so
/// every branch is asserted headlessly.
/// </summary>
/// <param name="Title">The page title (web <c>activity.myActivity.title</c>).</param>
/// <param name="Subtitle">The page sub-heading (web <c>activity.myActivity.subtitle</c>).</param>
/// <param name="CopyLinkText">The deep link the copy-link affordance writes (web <c>window.location.href</c>).</param>
/// <param name="State">The current lifecycle state.</param>
/// <param name="IsLoading">Whether the container spinner replaces the body (web <c>loading={isLoading}</c>).</param>
/// <param name="Body">Which body the panel renders — the timeline or a notice.</param>
/// <param name="NoticeGlyph">The notice's leading glyph (non-success branches).</param>
/// <param name="NoticeTitle">The notice heading, or empty when the notice has no heading (the empty branch).</param>
/// <param name="NoticeMessage">The notice body message.</param>
/// <param name="NoticeActionText">The notice's retry-button label, or empty when no action is shown (only the error branch retries).</param>
/// <param name="Rows">The projected timeline rows (success branch; empty otherwise).</param>
/// <param name="AutomationName">The page's composed accessible name.</param>
public sealed record MyActivityDisplay(
    string Title,
    string Subtitle,
    string CopyLinkText,
    MyActivityState State,
    bool IsLoading,
    MyActivityBody Body,
    string NoticeGlyph,
    string NoticeTitle,
    string NoticeMessage,
    string NoticeActionText,
    IReadOnlyList<MyActivityRow> Rows,
    string AutomationName)
{
    /// <summary>True when the panel renders the activity timeline (the success branch).</summary>
    public bool ShowTimeline => Body == MyActivityBody.Timeline;

    /// <summary>True when the notice shows a retry affordance (the error branch).</summary>
    public bool ShowRetry => NoticeActionText.Length > 0;
}

/// <summary>
/// Pure projection from a load result (rows + <see cref="MyActivityState"/> + optional error detail) to its
/// <see cref="MyActivityDisplay"/> — the native port of web/src/features/system/pages/MyActivityPage.tsx. It
/// resolves the two header literals and, per state, the panel body: the 503 / 401 / error notices (each its web
/// title + description, the error carrying the dynamic detail + a retry label), the empty notice (web
/// <c>RecentActivityFeed</c> empty message), or the timeline rows. Each row's action label, severity and
/// <c>entity · id — detail</c> subtitle are resolved exactly as the web feed composes them. Every literal flows
/// through the i18n facade with the web key names and verbatim English defaults; no WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class MyActivityProjection
{
    /// <summary>Build the display for a load result.</summary>
    /// <param name="entries">The rows the fetch resolved (empty for the loading / error / notice branches).</param>
    /// <param name="state">The current lifecycle state.</param>
    /// <param name="errorDetail">The dynamic error message for the <see cref="MyActivityState.Error"/> branch (web <c>apiError.message</c>), or null.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static MyActivityDisplay Project(
        IReadOnlyList<UserActivityEntry> entries,
        MyActivityState state,
        string? errorDetail,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = MyActivityRegistration.Title(localizer);
        string retry = MyActivityRegistration.Localize(localizer, "common.retry", "Retry");

        var (body, glyph, noticeTitle, noticeMessage, action, rows) = state switch
        {
            // web: <EmptyState icon={securityCheck} title={disabled.title} message={disabled.description} />
            MyActivityState.Disabled => (
                MyActivityBody.Notice,
                MyActivityRegistration.DisabledGlyph,
                MyActivityRegistration.Localize(localizer, "activity.myActivity.disabled.title", "Activity feed disabled"),
                MyActivityRegistration.Localize(localizer,
                    "activity.myActivity.disabled.description",
                    "Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure AUTH_FORWARD_HEADER."),
                string.Empty,
                (IReadOnlyList<MyActivityRow>)Array.Empty<MyActivityRow>()),

            // web: <EmptyState icon={user} title={unauthorized.title} message={unauthorized.description} />
            MyActivityState.Unauthorized => (
                MyActivityBody.Notice,
                MyActivityRegistration.UnauthorizedGlyph,
                MyActivityRegistration.Localize(localizer, "activity.myActivity.unauthorized.title", "Identity required"),
                MyActivityRegistration.Localize(localizer,
                    "activity.myActivity.unauthorized.description",
                    "Your request did not include an identity header. Sign in through your identity provider and try again."),
                string.Empty,
                Array.Empty<MyActivityRow>()),

            // web: <EmptyState icon={warning} title={error.title} message={apiError.message} action={{retry}} />
            MyActivityState.Error => (
                MyActivityBody.Notice,
                MyActivityRegistration.ErrorGlyph,
                MyActivityRegistration.Localize(localizer, "activity.myActivity.error.title", "Could not load activity"),
                string.IsNullOrWhiteSpace(errorDetail)
                    ? MyActivityRegistration.Localize(localizer, "activity.myActivity.error.title", "Could not load activity")
                    : errorDetail!,
                retry,
                Array.Empty<MyActivityRow>()),

            // web RecentActivityFeed empty: <EmptyState icon={history} message={empty} />
            MyActivityState.Empty => (
                MyActivityBody.Notice,
                MyActivityRegistration.EmptyGlyph,
                string.Empty,
                MyActivityRegistration.Localize(localizer, "activity.myActivity.empty", "No recent activity in this window."),
                string.Empty,
                Array.Empty<MyActivityRow>()),

            // web success: <RecentActivityFeed entries={entries} />
            MyActivityState.Loaded => (
                MyActivityBody.Timeline,
                string.Empty,
                string.Empty,
                string.Empty,
                string.Empty,
                BuildRows(entries, localizer)),

            // Loading: the container spinner replaces the body (web loading={isLoading}); the notice is hidden behind it.
            _ => (
                MyActivityBody.Notice,
                MyActivityRegistration.EmptyGlyph,
                string.Empty,
                MyActivityRegistration.Localize(localizer, "activity.myActivity.empty", "No recent activity in this window."),
                string.Empty,
                Array.Empty<MyActivityRow>()),
        };

        return new MyActivityDisplay(
            Title: title,
            Subtitle: MyActivityRegistration.Subtitle(localizer),
            CopyLinkText: MyActivityRegistration.CopyLink,
            State: state,
            IsLoading: state == MyActivityState.Loading,
            Body: body,
            NoticeGlyph: glyph,
            NoticeTitle: noticeTitle,
            NoticeMessage: noticeMessage,
            NoticeActionText: action,
            Rows: rows,
            AutomationName: title);
    }

    // web RecentActivityFeed: entries.map((entry) => ({ icon/color via getActivityVisual, title, subtitle, time })).
    private static List<MyActivityRow> BuildRows(
        IReadOnlyList<UserActivityEntry> entries,
        ILocalizer localizer)
    {
        var rows = new List<MyActivityRow>(entries.Count);
        foreach (var entry in entries)
        {
            var visual = MyActivityVisuals.Resolve(entry.Action);
            string title = MyActivityRegistration.Localize(localizer, visual.I18nKey, visual.Fallback);
            rows.Add(new MyActivityRow(title, ComposeSubtitle(entry), entry.Timestamp, visual.Severity));
        }

        return rows;
    }

    // web: subtitleParts = [entity_id ? `${entity_type} · ${entity_id}` : entity_type, detail].join(' — ').
    private static string? ComposeSubtitle(UserActivityEntry entry)
    {
        var parts = new List<string>(2);
        if (!string.IsNullOrEmpty(entry.EntityType))
        {
            parts.Add(string.IsNullOrEmpty(entry.EntityId)
                ? entry.EntityType!
                : $"{entry.EntityType} \u00b7 {entry.EntityId}");
        }

        if (!string.IsNullOrEmpty(entry.Detail))
        {
            parts.Add(entry.Detail!);
        }

        return parts.Count == 0 ? null : string.Join(" \u2014 ", parts);
    }
}

/// <summary>
/// The action-string → (severity, i18n label) resolver — the native port of web
/// <c>getActivityVisual</c> (web/src/lib/activityIcons.ts). It best-effort matches the most-specific
/// <c>domain.verb</c> prefix down to a generic fallback; the web per-action Lucide icon + accent colour collapse
/// to a single severity token here (the shared <c>TsTimeline</c> renders the accent as a severity-coloured dot,
/// the WinUI parity of the web feed's per-row icon colour). UI-free so the mapping is asserted headlessly.
/// </summary>
public static class MyActivityVisuals
{
    /// <summary>A resolved action descriptor: the severity token + the i18n key / English fallback for the label.</summary>
    /// <param name="Severity">The wire severity token (<c>info</c>/<c>warn</c>/<c>critical</c>/<c>success</c>) for the dot.</param>
    /// <param name="I18nKey">The i18n key the label resolves through (web <c>visual.i18nKey</c>).</param>
    /// <param name="Fallback">The verbatim English fallback (web <c>visual.fallback</c>).</param>
    public sealed record ActivityVisual(string Severity, string I18nKey, string Fallback);

    private static readonly ActivityVisual Fallback =
        new("info", "activity.action.unknown", "Activity");

    // Ordered most-specific first; resolution walks shrinking dotted prefixes (web REGISTRY + getActivityVisual).
    private static readonly Dictionary<string, ActivityVisual> Registry =
        new(StringComparer.Ordinal)
        {
            // Vehicle commands (web vehicle.command.*)
            ["vehicle.command.wake"] = new("warn", "activity.action.vehicleCommandWake", "Wake vehicle"),
            ["vehicle.command.honk"] = new("info", "activity.action.vehicleCommandHonk", "Honk horn"),
            ["vehicle.command.flash"] = new("info", "activity.action.vehicleCommandFlash", "Flash lights"),
            ["vehicle.command.lock"] = new("success", "activity.action.vehicleCommandLock", "Lock vehicle"),
            ["vehicle.command.unlock"] = new("warn", "activity.action.vehicleCommandUnlock", "Unlock vehicle"),
            ["vehicle.command.climate"] = new("info", "activity.action.vehicleCommandClimate", "Climate command"),
            ["vehicle.command.charge"] = new("success", "activity.action.vehicleCommandCharge", "Charging command"),
            ["vehicle.command"] = new("info", "activity.action.vehicleCommand", "Vehicle command"),

            // Settings (web settings.*)
            ["settings.update"] = new("info", "activity.action.settingsUpdate", "Settings updated"),
            ["settings"] = new("info", "activity.action.settings", "Settings change"),

            // Alerts (web alert.*)
            ["alert.rule.create"] = new("critical", "activity.action.alertRuleCreate", "Alert rule created"),
            ["alert.rule.update"] = new("critical", "activity.action.alertRuleUpdate", "Alert rule updated"),
            ["alert.rule.delete"] = new("critical", "activity.action.alertRuleDelete", "Alert rule deleted"),
            ["alert"] = new("critical", "activity.action.alert", "Alert change"),

            // Automations (web automation.*)
            ["automation.create"] = new("info", "activity.action.automationCreate", "Automation created"),
            ["automation.update"] = new("info", "activity.action.automationUpdate", "Automation updated"),
            ["automation.delete"] = new("critical", "activity.action.automationDelete", "Automation deleted"),
            ["automation"] = new("info", "activity.action.automation", "Automation change"),

            // Dashboard / layout (web dashboard.*)
            ["dashboard.layout.save"] = new("info", "activity.action.dashboardLayoutSave", "Dashboard layout saved"),
            ["dashboard"] = new("info", "activity.action.dashboard", "Dashboard change"),

            // Data exports (web data_export.*)
            ["data_export.create"] = new("info", "activity.action.dataExportCreate", "Data export requested"),
            ["data_export"] = new("info", "activity.action.dataExport", "Data export"),

            // API keys (web api_key.*)
            ["api_key.create"] = new("warn", "activity.action.apiKeyCreate", "API key created"),
            ["api_key.update"] = new("warn", "activity.action.apiKeyUpdate", "API key updated"),
            ["api_key.delete"] = new("critical", "activity.action.apiKeyDelete", "API key revoked"),
            ["api_key"] = new("warn", "activity.action.apiKey", "API key change"),

            // Auth (web auth.*)
            ["auth.login"] = new("success", "activity.action.authLogin", "Signed in"),
            ["auth.logout"] = new("info", "activity.action.authLogout", "Signed out"),
            ["auth"] = new("info", "activity.action.auth", "Authentication"),
        };

    /// <summary>
    /// Resolve an action string to its descriptor, falling back to progressively shorter dotted prefixes
    /// (web <c>getActivityVisual</c>): <c>vehicle.command.wake</c> matches first; if absent,
    /// <c>vehicle.command</c>, then <c>vehicle</c>, then the generic fallback.
    /// </summary>
    /// <param name="action">The audit action string (web <c>entry.action</c>).</param>
    /// <returns>The resolved visual descriptor (never null).</returns>
    public static ActivityVisual Resolve(string? action)
    {
        if (string.IsNullOrWhiteSpace(action))
        {
            return Fallback;
        }

        string normalized = action.Trim();
        if (Registry.TryGetValue(normalized, out var exact))
        {
            return exact;
        }

        string[] parts = normalized.Split('.');
        for (int i = parts.Length - 1; i > 0; i--)
        {
            string prefix = string.Join('.', parts, 0, i);
            if (Registry.TryGetValue(prefix, out var match))
            {
                return match;
            }
        }

        return Fallback;
    }
}

/// <summary>
/// Static identity + i18n helpers for the per-user activity page (web
/// <c>web/src/features/system/pages/MyActivityPage.tsx</c>, route <c>/me/activity</c>, nav name
/// <c>MyActivity</c>). The shell page factory binds the view under <see cref="RouteName"/>.
/// </summary>
public static class MyActivityRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("MyActivity", "me/activity", …)).</summary>
    public const string RouteName = "MyActivity";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "me/activity";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MyActivityPage";

    /// <summary>The deep link the copy-link affordance writes (the native analogue of <c>window.location.href</c>).</summary>
    public const string CopyLink = "teslasync://me/activity";

    /// <summary>The generated operation id for the activity read (web <c>useMyRecentActivity</c>).</summary>
    public const string ActivityOperation = "get_api_v1_users_me_activity";

    /// <summary>The default look-back window in days (web <c>DEFAULT_WINDOW_DAYS</c>).</summary>
    public const int DefaultWindowDays = 30;

    /// <summary>The max rows requested (web <c>ACTIVITY_LIMIT</c>; the server caps at 200).</summary>
    public const int ActivityLimit = 200;

    /// <summary>Decorative glyph for the 503 "feature disabled" notice (web <c>Icons.securityCheck</c> — shield).</summary>
    public const string DisabledGlyph = "\uEA18";

    /// <summary>Decorative glyph for the 401 "identity required" notice (web <c>Icons.user</c> — contact).</summary>
    public const string UnauthorizedGlyph = "\uE77B";

    /// <summary>Decorative glyph for the generic error notice (web <c>Icons.warning</c>).</summary>
    public const string ErrorGlyph = "\uE7BA";

    /// <summary>Decorative glyph for the empty notice (web <c>Icons.history</c>; matches the nav glyph).</summary>
    public const string EmptyGlyph = "\uE81C";

    /// <summary>
    /// Resolve a web i18n key against the platform string catalog. Web keys live under the i18next default
    /// namespace, which the WinUI <c>Strings/{lang}/Resources.resw</c> catalog flattens under the
    /// <c>translation.</c> prefix (e.g. web <c>activity.myActivity.title</c> → resw
    /// <c>translation.activity.myActivity.title</c>); this prepends that namespace so every literal genuinely
    /// resolves from the catalog rather than silently falling back (ADR-014).
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="key">The web i18n key (without the catalog namespace), e.g. <c>activity.myActivity.title</c>.</param>
    /// <param name="fallback">The verbatim English fallback.</param>
    /// <returns>The localized string, or <paramref name="fallback"/> when unresolved.</returns>
    public static string Localize(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation." + key, fallback);
    }

    /// <summary>The localized page title (web <c>activity.myActivity.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return MyActivityRegistration.Localize(localizer, "activity.myActivity.title", "My Activity");
    }

    /// <summary>The localized page sub-heading (web <c>activity.myActivity.subtitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return MyActivityRegistration.Localize(localizer,
            "activity.myActivity.subtitle",
            "Recent actions you have taken in TeslaSync.");
    }

    /// <summary>The default 30-day window ending today (web <c>defaults</c>), as ISO <c>yyyy-MM-dd</c> strings.</summary>
    /// <param name="today">The anchor "today" (injectable for deterministic tests).</param>
    /// <returns>The (start, end) ISO date strings.</returns>
    public static (string Start, string End) DefaultWindow(DateOnly today)
    {
        DateOnly start = today.AddDays(-(DefaultWindowDays - 1));
        return (IsoDate(start), IsoDate(today));
    }

    /// <summary>Format a date as the ISO <c>yyyy-MM-dd</c> string the API expects (web <c>isoDate</c>).</summary>
    public static string IsoDate(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}

/// <summary>
/// PII-safe diagnostics for the per-user activity surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an action, entity id, detail, IP or
/// timestamp — so a diagnostics line can never leak a user's activity. Thread-safe.
/// </summary>
public sealed class MyActivityDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public MyActivityDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MyActivityPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MyActivityRegistration.Slug}");
    }
}

/// <summary>Null-tolerant JSON readers for the activity body (snake_case first, camelCase fallback).</summary>
internal static class MyActivityJson
{
    /// <summary>Read a string field by its snake_case then camelCase name, or null when absent/non-string.</summary>
    public static string? String(JsonElement element, string snake, string camel)
    {
        if (element.TryGetProperty(snake, out var s) && s.ValueKind == JsonValueKind.String)
        {
            return s.GetString();
        }

        if (!string.Equals(snake, camel, StringComparison.Ordinal)
            && element.TryGetProperty(camel, out var c)
            && c.ValueKind == JsonValueKind.String)
        {
            return c.GetString();
        }

        return null;
    }

    /// <summary>Read a long field by its snake_case then camelCase name, tolerating string-encoded numbers.</summary>
    public static long? Long(JsonElement element, string snake, string camel)
    {
        if (TryLong(element, snake, out var value))
        {
            return value;
        }

        if (!string.Equals(snake, camel, StringComparison.Ordinal) && TryLong(element, camel, out value))
        {
            return value;
        }

        return null;
    }

    /// <summary>Read an ISO-8601 timestamp field by its snake_case then camelCase name, or null when unparseable.</summary>
    public static DateTimeOffset? Time(JsonElement element, string snake, string camel)
    {
        string? raw = String(element, snake, camel);
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

    private static bool TryLong(JsonElement element, string name, out long value)
    {
        value = 0;
        if (!element.TryGetProperty(name, out var property))
        {
            return false;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetInt64(out value) => true,
            JsonValueKind.String when long.TryParse(
                property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value) => true,
            _ => false,
        };
    }
}
