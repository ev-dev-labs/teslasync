using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.RecentActivityFeedSurface;

/// <summary>
/// The render phase the <see cref="RecentActivityFeedProjection"/> resolves for one
/// (entries, loading) input — the native analogue of the branches the web
/// <c>RecentActivityFeed</c> (web/src/components/data-display/RecentActivityFeed.tsx) selects between. The web
/// component is purely presentational and prop-driven: its only branch is <c>entries.length === 0</c> (the
/// <c>EmptyState</c>) versus the populated <c>Timeline</c>. Its host page owns the fetch lifecycle (web
/// <c>MyActivityPage</c> drives <c>loading</c> / error / disabled / unauthorized around the feed), exactly as the
/// peer presentational shared surfaces (<c>Accordion</c> / <c>UsageCard</c> / <c>InlineCallout</c>) document. This
/// surface reproduces those two web branches and adds a no-chrome <see cref="Loading"/> skeleton affordance for a
/// host that is still resolving its first page (the "loading - skeleton chrome" state) — it needs no string, so
/// it adds no catalog key. None of the branches collapses the surface silently (ADR-011).
/// </summary>
public enum RecentActivityFeedPhase
{
    /// <summary>The host's first activity fetch is in flight — a loading skeleton (no entries yet).</summary>
    Loading,

    /// <summary>The fetch resolved with no rows in the window — the web feed's empty notice (web <c>entries.length === 0</c>).</summary>
    Empty,

    /// <summary>The fetch resolved with at least one row — the activity timeline (web <c>Timeline</c> success branch).</summary>
    Populated,
}

/// <summary>
/// One audit-log row scoped to a single user — the native mirror of the web <c>UserActivityEntry</c>
/// (web/src/types/admin.ts), narrowed to the fields the feed renders
/// (web/src/components/data-display/RecentActivityFeed.tsx). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host. The shared surface owns its own presentational input contract (it does not
/// depend on the <c>MyActivityPage</c> feature-view), the WinUI parity of the web component importing the shared
/// <c>UserActivityEntry</c> type rather than a page-local one.
/// </summary>
/// <param name="Id">The audit-log row id (web <c>id</c>), the stable row key.</param>
/// <param name="Timestamp">When the action occurred (web <c>ts</c>), driving the relative-time label.</param>
/// <param name="Action">The audit action string (web <c>action</c>), e.g. <c>vehicle.command.wake</c>.</param>
/// <param name="EntityType">The acted-on entity type (web <c>entity_type</c>), or null.</param>
/// <param name="EntityId">The acted-on entity id (web <c>entity_id</c>), or null.</param>
/// <param name="Detail">The optional free-text detail (web <c>detail</c>), or null.</param>
public sealed record RecentActivityEntry(
    long Id,
    DateTimeOffset? Timestamp,
    string Action,
    string? EntityType,
    string? EntityId,
    string? Detail)
{
    /// <summary>
    /// Parse a <c>GET /users/me/activity</c> array body into rows (web <c>safeArray</c> — empty when the body is
    /// not an array). Tolerates snake_case (the Go API shape) and its camelCase alias. This is the cached-payload
    /// adapter the surface hydrates from (cached JSON -> projection).
    /// </summary>
    /// <param name="root">The parsed response body.</param>
    /// <returns>The parsed rows, newest first as the server returns them; empty when the body is not an array.</returns>
    public static IReadOnlyList<RecentActivityEntry> FromArray(JsonElement root)
    {
        var rows = new List<RecentActivityEntry>();
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

            rows.Add(new RecentActivityEntry(
                Id: RecentActivityJson.Long(element, "id", "id") ?? 0,
                Timestamp: RecentActivityJson.Time(element, "ts", "ts"),
                Action: RecentActivityJson.String(element, "action", "action") ?? string.Empty,
                EntityType: RecentActivityJson.String(element, "entity_type", "entityType"),
                EntityId: RecentActivityJson.String(element, "entity_id", "entityId"),
                Detail: RecentActivityJson.String(element, "detail", "detail")));
        }

        return rows;
    }
}

/// <summary>
/// The whole presentational input the feed renders — the native analogue of the web
/// <c>RecentActivityFeedProps</c> (the <c>entries</c> + <c>emptyMessage</c> props). The parent supplies the
/// already-fetched rows, exactly like the web component, so the view never performs HTTP. <see cref="IsLoading"/>
/// lets a host flag its in-flight first fetch so the surface shows a skeleton rather than a premature empty notice.
/// </summary>
public sealed record RecentActivityFeedInput
{
    /// <summary>The rows to render, newest first (web <c>entries</c>); null / empty selects the empty branch.</summary>
    public IReadOnlyList<RecentActivityEntry>? Entries { get; init; }

    /// <summary>
    /// The caller's empty-state message override (web <c>emptyMessage</c>), already localized by the caller. When
    /// null / empty the projection resolves the web default <c>activity.myActivity.empty</c> through the localizer.
    /// </summary>
    public string? EmptyMessage { get; init; }

    /// <summary>True while the host's first fetch is in flight — selects the loading skeleton.</summary>
    public bool IsLoading { get; init; }
}

/// <summary>
/// One projected, render-ready feed row — the native analogue of a single web <c>RecentActivityFeed</c> timeline
/// item (web/src/components/data-display/RecentActivityFeed.tsx, the <c>entries.map</c> result). Pure data so every
/// branch is asserted headlessly.
/// </summary>
/// <param name="Glyph">The leading icon glyph (web <c>getActivityVisual(action).icon</c>), rendered muted — the
/// web feed sets <c>color: undefined</c>, so the icon takes the timeline's muted tint, not a per-action accent.</param>
/// <param name="Title">The resolved action label (web <c>t(visual.i18nKey, visual.fallback)</c>).</param>
/// <param name="TitleI18nKey">The i18n key the title resolved through (web <c>visual.i18nKey</c>); for diagnostics / tests.</param>
/// <param name="Subtitle">The composed <c>entity · id — detail</c> line, or null when the row has neither.</param>
/// <param name="Timestamp">When the action occurred (web <c>entry.ts</c>), driving the relative-time label at render.</param>
/// <param name="Route">The click-through route (web <c>entityHref(type,id)</c>), or null to render the title as plain text.</param>
public sealed record RecentActivityRow(
    string Glyph,
    string Title,
    string TitleI18nKey,
    string? Subtitle,
    DateTimeOffset? Timestamp,
    string? Route)
{
    /// <summary>True when the title is a click-through link (web <c>href</c> non-null).</summary>
    public bool HasRoute => !string.IsNullOrEmpty(Route);

    /// <summary>The row's Narrator name — the title, with the subtitle appended when present.</summary>
    public string AccessibleName =>
        string.IsNullOrEmpty(Subtitle) ? Title : string.Concat(Title, ", ", Subtitle);
}

/// <summary>
/// The fully projected, render-ready view of the feed for one input — the native analogue of what the web
/// <c>RecentActivityFeed</c> renders. Carries the chosen <see cref="Phase"/>, the resolved empty message + glyph
/// for the empty branch, the projected <see cref="Rows"/> for the populated branch, and the composed accessible
/// name so the surface is never anonymous. Pure data.
/// </summary>
/// <param name="Phase">Which branch the surface renders.</param>
/// <param name="EmptyMessage">The resolved empty-state message (web <c>emptyMessage ?? t('activity.myActivity.empty')</c>).</param>
/// <param name="EmptyGlyph">The empty-state glyph (web <c>Icons.history</c>).</param>
/// <param name="Rows">The projected timeline rows (populated branch; empty otherwise).</param>
/// <param name="AccessibleName">The surface's composed Narrator name (never empty).</param>
public sealed record RecentActivityFeedDisplay(
    RecentActivityFeedPhase Phase,
    string EmptyMessage,
    string EmptyGlyph,
    IReadOnlyList<RecentActivityRow> Rows,
    string AccessibleName)
{
    /// <summary>True when the surface renders the empty notice (web <c>entries.length === 0</c>).</summary>
    public bool ShowEmptyState => Phase == RecentActivityFeedPhase.Empty;

    /// <summary>True while the surface renders the loading skeleton.</summary>
    public bool ShowLoading => Phase == RecentActivityFeedPhase.Loading;

    /// <summary>True when the surface renders the activity timeline (the populated success branch).</summary>
    public bool ShowTimeline => Phase == RecentActivityFeedPhase.Populated;
}

/// <summary>
/// Pure projection from a <see cref="RecentActivityFeedInput"/> to its <see cref="RecentActivityFeedDisplay"/> —
/// the native port of web/src/components/data-display/RecentActivityFeed.tsx. It resolves the empty message
/// (the caller override or the web <c>activity.myActivity.empty</c> default), and for each entry composes the row
/// exactly as the web feed does: the per-action glyph + i18n title (web <c>getActivityVisual</c> ->
/// <c>t(i18nKey, fallback)</c>), the <c>entity · id — detail</c> subtitle, the relative timestamp source and the
/// click-through route (web <c>entityHref</c>). Every literal flows through the i18n facade with the web key
/// names and verbatim English defaults; no WinUI types — unit-tested without a UI host.
/// </summary>
public static class RecentActivityFeedProjection
{
    /// <summary>Build the display for one presentational input.</summary>
    /// <param name="input">The presentational input (entries + optional empty override + loading flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static RecentActivityFeedDisplay Project(RecentActivityFeedInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        // web: emptyMessage ?? t('activity.myActivity.empty', 'No recent activity in this window.')
        string emptyMessage = input.EmptyMessage
            ?? RecentActivityFeedRegistration.Localize(
                localizer, "activity.myActivity.empty", "No recent activity in this window.");

        IReadOnlyList<RecentActivityEntry> entries = input.Entries ?? Array.Empty<RecentActivityEntry>();
        if (entries.Count == 0)
        {
            // No rows yet: a skeleton while the host's first fetch is in flight, else the web empty notice
            // (web: <EmptyState icon={history} message={emptyMessage} />). Once rows arrive they always render,
            // so revalidating an already-populated feed never flashes a skeleton.
            RecentActivityFeedPhase emptyPhase =
                input.IsLoading ? RecentActivityFeedPhase.Loading : RecentActivityFeedPhase.Empty;
            return new RecentActivityFeedDisplay(
                emptyPhase,
                emptyMessage,
                RecentActivityFeedRegistration.EmptyGlyph,
                Array.Empty<RecentActivityRow>(),
                emptyMessage);
        }

        var rows = new List<RecentActivityRow>(entries.Count);
        foreach (var entry in entries)
        {
            var visual = RecentActivityVisuals.Resolve(entry.Action);
            string title = RecentActivityFeedRegistration.Localize(localizer, visual.I18nKey, visual.Fallback);
            rows.Add(new RecentActivityRow(
                Glyph: visual.Glyph,
                Title: title,
                TitleI18nKey: visual.I18nKey,
                Subtitle: ComposeSubtitle(entry),
                Timestamp: entry.Timestamp,
                Route: RecentActivityRoute.For(entry.EntityType, entry.EntityId)));
        }

        return new RecentActivityFeedDisplay(
            RecentActivityFeedPhase.Populated,
            emptyMessage,
            RecentActivityFeedRegistration.EmptyGlyph,
            rows,
            rows[0].AccessibleName);
    }

    // web: subtitleParts = [entity_id ? `${entity_type} · ${entity_id}` : entity_type, detail].join(' — ').
    private static string? ComposeSubtitle(RecentActivityEntry entry)
    {
        var parts = new List<string>(2);
        if (!string.IsNullOrEmpty(entry.EntityType))
        {
            parts.Add(string.IsNullOrEmpty(entry.EntityId)
                ? entry.EntityType!
                : string.Concat(entry.EntityType, " \u00b7 ", entry.EntityId));
        }

        if (!string.IsNullOrEmpty(entry.Detail))
        {
            parts.Add(entry.Detail!);
        }

        return parts.Count == 0 ? null : string.Join(" \u2014 ", parts);
    }
}

/// <summary>
/// The action-string -> (icon glyph, i18n label) resolver — the native port of web <c>getActivityVisual</c>
/// (web/src/lib/activityIcons.ts). It best-effort matches the most-specific <c>domain.verb</c> prefix down to a
/// generic fallback. Each entry's Segoe Fluent / MDL2 glyph approximates the web Lucide icon (the web feed
/// renders the icon muted — it sets <c>color: undefined</c> — so only the glyph, not the registry's accent
/// colour, is carried here). UI-free so the mapping is asserted headlessly.
/// </summary>
public static class RecentActivityVisuals
{
    /// <summary>A resolved action descriptor: the leading glyph + the i18n key / English fallback for the label.</summary>
    /// <param name="Glyph">The Segoe Fluent / MDL2 glyph approximating the web Lucide icon (web <c>visual.icon</c>).</param>
    /// <param name="I18nKey">The i18n key the label resolves through (web <c>visual.i18nKey</c>).</param>
    /// <param name="Fallback">The verbatim English fallback (web <c>visual.fallback</c>).</param>
    public sealed record Visual(string Glyph, string I18nKey, string Fallback);

    // Segoe Fluent / MDL2 glyphs approximating the web Lucide icons used by the activity registry.
    private const string GlyphGamepad = "\uE7FC";       // web Icons.gamepad (Game)
    private const string GlyphPower = "\uE7E8";         // web Icons.power (PowerButton)
    private const string GlyphBell = "\uEA8F";          // web Icons.notifications* (Ringer)
    private const string GlyphBellSilent = "\uE7ED";    // web Icons.notificationsMuted (RingerSilent)
    private const string GlyphLock = "\uE72E";          // web Icons.locked (Lock)
    private const string GlyphUnlock = "\uE785";        // web Icons.unlocked (Unlock)
    private const string GlyphClimate = "\uE9CA";       // web Icons.climate (Frigid)
    private const string GlyphBolt = "\uE945";          // web Icons.bolt (LightningBolt)
    private const string GlyphSettings = "\uE713";      // web Icons.settings (Setting)
    private const string GlyphWorkflow = "\uE895";      // web Icons.workflow (Sync)
    private const string GlyphGrid = "\uE80A";          // web Icons.layout* (GridView)
    private const string GlyphDownload = "\uE896";      // web Icons.download (Download)
    private const string GlyphKey = "\uE192";           // web Icons.key (Permissions)
    private const string GlyphUser = "\uE77B";          // web Icons.user (Contact)
    private const string GlyphHistory = "\uE81C";       // web Icons.history (History)

    private static readonly Visual Fallback =
        new(GlyphHistory, "activity.action.unknown", "Activity");

    // Ordered most-specific first; resolution walks shrinking dotted prefixes (web REGISTRY + getActivityVisual).
    private static readonly Dictionary<string, Visual> Registry =
        new(StringComparer.Ordinal)
        {
            // Vehicle commands (web vehicle.command.*)
            ["vehicle.command.wake"] = new(GlyphPower, "activity.action.vehicleCommandWake", "Wake vehicle"),
            ["vehicle.command.honk"] = new(GlyphBell, "activity.action.vehicleCommandHonk", "Honk horn"),
            ["vehicle.command.flash"] = new(GlyphPower, "activity.action.vehicleCommandFlash", "Flash lights"),
            ["vehicle.command.lock"] = new(GlyphLock, "activity.action.vehicleCommandLock", "Lock vehicle"),
            ["vehicle.command.unlock"] = new(GlyphUnlock, "activity.action.vehicleCommandUnlock", "Unlock vehicle"),
            ["vehicle.command.climate"] = new(GlyphClimate, "activity.action.vehicleCommandClimate", "Climate command"),
            ["vehicle.command.charge"] = new(GlyphBolt, "activity.action.vehicleCommandCharge", "Charging command"),
            ["vehicle.command"] = new(GlyphGamepad, "activity.action.vehicleCommand", "Vehicle command"),

            // Settings (web settings.*)
            ["settings.update"] = new(GlyphSettings, "activity.action.settingsUpdate", "Settings updated"),
            ["settings"] = new(GlyphSettings, "activity.action.settings", "Settings change"),

            // Alerts (web alert.*)
            ["alert.rule.create"] = new(GlyphBell, "activity.action.alertRuleCreate", "Alert rule created"),
            ["alert.rule.update"] = new(GlyphBell, "activity.action.alertRuleUpdate", "Alert rule updated"),
            ["alert.rule.delete"] = new(GlyphBellSilent, "activity.action.alertRuleDelete", "Alert rule deleted"),
            ["alert"] = new(GlyphBell, "activity.action.alert", "Alert change"),

            // Automations (web automation.*)
            ["automation.create"] = new(GlyphWorkflow, "activity.action.automationCreate", "Automation created"),
            ["automation.update"] = new(GlyphWorkflow, "activity.action.automationUpdate", "Automation updated"),
            ["automation.delete"] = new(GlyphWorkflow, "activity.action.automationDelete", "Automation deleted"),
            ["automation"] = new(GlyphWorkflow, "activity.action.automation", "Automation change"),

            // Dashboard / layout (web dashboard.*)
            ["dashboard.layout.save"] = new(GlyphGrid, "activity.action.dashboardLayoutSave", "Dashboard layout saved"),
            ["dashboard"] = new(GlyphGrid, "activity.action.dashboard", "Dashboard change"),

            // Data exports (web data_export.*)
            ["data_export.create"] = new(GlyphDownload, "activity.action.dataExportCreate", "Data export requested"),
            ["data_export"] = new(GlyphDownload, "activity.action.dataExport", "Data export"),

            // API keys (web api_key.*)
            ["api_key.create"] = new(GlyphKey, "activity.action.apiKeyCreate", "API key created"),
            ["api_key.update"] = new(GlyphKey, "activity.action.apiKeyUpdate", "API key updated"),
            ["api_key.delete"] = new(GlyphKey, "activity.action.apiKeyDelete", "API key revoked"),
            ["api_key"] = new(GlyphKey, "activity.action.apiKey", "API key change"),

            // Auth (web auth.*)
            ["auth.login"] = new(GlyphUser, "activity.action.authLogin", "Signed in"),
            ["auth.logout"] = new(GlyphUser, "activity.action.authLogout", "Signed out"),
            ["auth"] = new(GlyphUser, "activity.action.auth", "Authentication"),
        };

    /// <summary>
    /// Resolve an action string to its descriptor, falling back to progressively shorter dotted prefixes
    /// (web <c>getActivityVisual</c>): <c>vehicle.command.wake</c> matches first; if absent,
    /// <c>vehicle.command</c>, then <c>vehicle</c>, then the generic fallback.
    /// </summary>
    /// <param name="action">The audit action string (web <c>entry.action</c>).</param>
    /// <returns>The resolved visual descriptor (never null).</returns>
    public static Visual Resolve(string? action)
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
/// The entity -> route resolver — the native port of web <c>entityHref</c>
/// (web/src/components/data-display/RecentActivityFeed.tsx). Maps an <c>entity_type</c> + <c>entity_id</c> to a
/// frontend route when click-through makes sense; null means "render the title as plain text". UI-free.
/// </summary>
public static class RecentActivityRoute
{
    /// <summary>
    /// Resolve the click-through route for an entity (web <c>entityHref</c>). Returns null when either part is
    /// missing or the type has no destination. The id is percent-encoded (web <c>encodeURIComponent</c>) for the
    /// id-bearing routes; the rest are static landing routes that ignore the id (matching the web switch).
    /// </summary>
    /// <param name="entityType">The acted-on entity type (web <c>entity_type</c>).</param>
    /// <param name="entityId">The acted-on entity id (web <c>entity_id</c>).</param>
    /// <returns>The route, or null to render the title as plain text.</returns>
    public static string? For(string? entityType, string? entityId)
    {
        if (string.IsNullOrEmpty(entityType) || string.IsNullOrEmpty(entityId))
        {
            return null;
        }

        string id = Uri.EscapeDataString(entityId);
        return entityType switch
        {
            "vehicle" => "/vehicles/" + id,
            "drive" => "/drives/" + id,
            "charging_session" or "charge" => "/charging/" + id,
            "alert_rule" => "/notifications/alerts",
            "automation" => "/automations",
            "geofence" => "/geofences",
            "data_export" or "export" => "/data-export",
            "api_key" => "/api-keys",
            _ => null,
        };
    }
}

/// <summary>
/// Static identity + i18n helpers for the recent-activity feed shared surface (web
/// <c>components/data-display/RecentActivityFeed.tsx</c>). Centralises the diagnostics slug, the empty glyph and
/// the catalog-namespace bridge so every literal resolves from the platform string catalog.
/// </summary>
public static class RecentActivityFeedRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "RecentActivityFeed";

    /// <summary>The empty-state glyph (web <c>Icons.history</c>; History).</summary>
    public const string EmptyGlyph = "\uE81C";

    /// <summary>
    /// Resolve a web i18n key against the platform string catalog. Web keys live under the i18next default
    /// namespace, which the WinUI <c>Strings/{lang}/Resources.resw</c> catalog flattens under the
    /// <c>translation.</c> prefix (e.g. web <c>activity.myActivity.empty</c> -> resw
    /// <c>translation.activity.myActivity.empty</c>); this prepends that namespace so every literal genuinely
    /// resolves from the catalog rather than silently falling back (ADR-014).
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="key">The web i18n key (without the catalog namespace).</param>
    /// <param name="fallback">The verbatim English fallback.</param>
    /// <returns>The localized string, or <paramref name="fallback"/> when unresolved.</returns>
    public static string Localize(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation." + key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the recent-activity feed surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an action, entity id, detail or timestamp —
/// so a diagnostics line can never leak a user's activity. Thread-safe.
/// </summary>
public sealed class RecentActivityFeedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public RecentActivityFeedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentActivityFeed</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentActivityFeedRegistration.Slug}");
    }
}

/// <summary>
/// The P1/S8 data seam the feed binds to: the presentational input plus a change notification. The WinUI view
/// observes <see cref="Changed"/> and reprojects; headless tests drive it directly. Mirrors the seam pattern of
/// the peer presentational surfaces (<c>IUsageCardSource</c>).
/// </summary>
public interface IRecentActivityFeedSource
{
    /// <summary>The current presentational input.</summary>
    RecentActivityFeedInput Input { get; }

    /// <summary>Raised after <see cref="Input"/> changes.</summary>
    event EventHandler? Changed;
}

/// <summary>Null-tolerant JSON readers for the cached activity body (snake_case first, camelCase fallback).</summary>
internal static class RecentActivityJson
{
    /// <summary>Read a string field by its snake_case then camelCase name, or null when absent / non-string.</summary>
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
        if (TryLong(element, snake, out long value) || TryLong(element, camel, out value))
        {
            return value;
        }

        return null;
    }

    /// <summary>Read a timestamp field (ISO-8601 string or epoch number) by its snake_case then camelCase name.</summary>
    public static DateTimeOffset? Time(JsonElement element, string snake, string camel)
    {
        foreach (string name in new[] { snake, camel })
        {
            if (!element.TryGetProperty(name, out var v))
            {
                continue;
            }

            if (v.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(
                    v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
            {
                return parsed;
            }

            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long epoch))
            {
                return DateTimeOffset.FromUnixTimeSeconds(epoch);
            }
        }

        return null;
    }

    private static bool TryLong(JsonElement element, string name, out long value)
    {
        value = 0;
        if (!element.TryGetProperty(name, out var v))
        {
            return false;
        }

        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out value))
        {
            return true;
        }

        return v.ValueKind == JsonValueKind.String
            && long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
    }
}
