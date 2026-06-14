using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The lifecycle state of the <c>SafetyPage</c> surface — the native mirror of the data states the web page renders
/// (web/src/features/settings/pages/SafetyPage.tsx). The web page reads its values from the already-resolved global
/// <c>useSettings()</c> hook and renders the deterministic safety-settings listing unconditionally; it never gates a
/// per-page loading / empty / error branch. So this enum has exactly the single state the parity manifest declares —
/// <see cref="Success"/> — and the listing always renders (web's AI-OFF-safe static-help invariant).
/// </summary>
public enum SafetyState
{
    /// <summary>The deterministic safety-settings listing is rendered (the only state the web page exposes).</summary>
    Success,
}

/// <summary>
/// The typed snapshot of the seven safety-related settings the page lists — the native analogue of the slice of the
/// web <c>useSettings().settings</c> object the page reads (web/src/features/settings/pages/SafetyPage.tsx). Stored as
/// canonical values (booleans, enum strings, HH:MM times); the row value strings are formatted at the display boundary
/// in <see cref="SafetyProjection"/>. <see cref="Default"/> mirrors the web <c>DEFAULT_SETTINGS</c> so the page renders
/// fully even before / without a backend read (web's defaults-merged hook). Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="QuietHoursEnabled">web <c>quiet_hours_enabled</c>.</param>
/// <param name="QuietHoursStart">web <c>quiet_hours_start</c> (HH:MM, 24-hour).</param>
/// <param name="QuietHoursEnd">web <c>quiet_hours_end</c> (HH:MM, 24-hour).</param>
/// <param name="AlertDigestMode">web <c>alert_digest_mode</c> (instant / hourly / daily).</param>
/// <param name="CriticalFlashEnabled">web <c>critical_flash_enabled</c>.</param>
/// <param name="TabBadgeEnabled">web <c>tab_badge_enabled</c>.</param>
/// <param name="ApiSuspended">web <c>api_suspended</c> (the operational kill-switch).</param>
public sealed record SafetySettingsSnapshot(
    bool QuietHoursEnabled,
    string QuietHoursStart,
    string QuietHoursEnd,
    string AlertDigestMode,
    bool CriticalFlashEnabled,
    bool TabBadgeEnabled,
    bool ApiSuspended)
{
    /// <summary>The defaults the web hook merges (web <c>DEFAULT_SETTINGS</c> in web/src/hooks/useSettings.ts).</summary>
    public static SafetySettingsSnapshot Default { get; } = new(
        QuietHoursEnabled: false,
        QuietHoursStart: "22:00",
        QuietHoursEnd: "07:00",
        AlertDigestMode: "instant",
        CriticalFlashEnabled: true,
        TabBadgeEnabled: true,
        ApiSuspended: false);

    /// <summary>
    /// Parse a settings read into the safety slice, tolerating the bare settings object and the platform
    /// <c>{data:…}</c> envelope, and falling back to each field's web default when the field is absent or the wrong
    /// kind (web's defaults-merged read). Never throws on a malformed shape — it degrades to <see cref="Default"/>.
    /// </summary>
    /// <param name="json">The settings read JSON (web <c>useSettings().data</c>).</param>
    public static SafetySettingsSnapshot FromJson(JsonElement json)
    {
        var root = json;
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("data", out var data)
            && data.ValueKind == JsonValueKind.Object)
        {
            root = data;
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return Default;
        }

        return new SafetySettingsSnapshot(
            QuietHoursEnabled: ReadBool(root, "quiet_hours_enabled", Default.QuietHoursEnabled),
            QuietHoursStart: ReadString(root, "quiet_hours_start", Default.QuietHoursStart),
            QuietHoursEnd: ReadString(root, "quiet_hours_end", Default.QuietHoursEnd),
            AlertDigestMode: ReadString(root, "alert_digest_mode", Default.AlertDigestMode),
            CriticalFlashEnabled: ReadBool(root, "critical_flash_enabled", Default.CriticalFlashEnabled),
            TabBadgeEnabled: ReadBool(root, "tab_badge_enabled", Default.TabBadgeEnabled),
            ApiSuspended: ReadBool(root, "api_suspended", Default.ApiSuspended));
    }

    private static bool ReadBool(JsonElement root, string property, bool fallback) =>
        root.TryGetProperty(property, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : fallback;

    private static string ReadString(JsonElement root, string property, string fallback) =>
        root.TryGetProperty(property, out var value)
        && value.ValueKind == JsonValueKind.String
        && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()!
            : fallback;
}

/// <summary>
/// The settings-read seam the page binds through (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useSettings()</c> hook (web/src/api/hooks/useSettings.ts). The concrete <see cref="SafetySettingsClientSource"/>
/// drives the real <c>GET /settings</c> read while <see cref="EmptySafetySettingsSource"/> resolves to the web
/// defaults for headless hosts and tests (so the listing always renders the deterministic, AI-OFF-safe baseline).
/// </summary>
public interface ISafetySettingsSource
{
    /// <summary>Resolve the safety-settings snapshot (web <c>useSettings</c> query). Falls back to defaults on failure.</summary>
    Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default source — resolves the read to the web defaults (the headless / unpackaged default).</summary>
public sealed class EmptySafetySettingsSource : ISafetySettingsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySafetySettingsSource Instance { get; } = new();

    private EmptySafetySettingsSource()
    {
    }

    /// <inheritdoc />
    public Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SafetySettingsSnapshot.Default);
    }
}

/// <summary>
/// The render-time data model the <c>SafetyPage</c> projects from — the native analogue of the web page's resolved
/// settings slice (web/src/features/settings/pages/SafetyPage.tsx). Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Settings">The resolved safety-settings snapshot the row values format from.</param>
public sealed record SafetyModel(SafetySettingsSnapshot Settings)
{
    /// <summary>The initial model the view-model starts from (the web defaults).</summary>
    public static SafetyModel Initial { get; } = new(SafetySettingsSnapshot.Default);
}

/// <summary>
/// One projected, render-ready row of the safety-settings listing — the native analogue of one <c>SAFETY_ROWS</c>
/// entry in web/src/features/settings/pages/SafetyPage.tsx with its current value resolved. Pure data.
/// </summary>
/// <param name="Key">The row's stable identity (its title i18n key) — drives the automation id (web <c>data-testid</c>).</param>
/// <param name="Title">The localized row title (web <c>t(row.titleKey)</c>).</param>
/// <param name="Value">The current value string for the badge (web <c>row.renderValue(settings)</c>).</param>
/// <param name="Description">The localized plain-English explanation (web <c>t(row.descKey)</c>).</param>
/// <param name="DocsLabel">The localized "Docs" link label (web <c>safetySettings.listing.docsLink</c>).</param>
/// <param name="DocsUri">The absolute documentation URL the link opens (web relative <c>row.docsAnchor</c>).</param>
public sealed record SafetyRowDisplay(
    string Key,
    string Title,
    string Value,
    string Description,
    string DocsLabel,
    string DocsUri);

/// <summary>
/// The projected, render-ready content the <c>SafetyPage</c> view binds to — every visible literal resolved through
/// the i18n facade (the exact web key names) plus the top-level <see cref="SafetyState"/>. Pure data.
/// </summary>
/// <param name="State">The top-level data state (always <see cref="SafetyState.Success"/>).</param>
/// <param name="Title">web <c>safetySettings.pageTitle</c>.</param>
/// <param name="Subtitle">web <c>safetySettings.pageSubtitle</c>.</param>
/// <param name="ListingTitle">web <c>safetySettings.listing.title</c>.</param>
/// <param name="ListingSubtitle">web <c>safetySettings.listing.subtitle</c>.</param>
/// <param name="ChangeHint">web <c>safetySettings.listing.changeHint</c>.</param>
/// <param name="Rows">The seven projected listing rows (web <c>SAFETY_ROWS.map(...)</c>).</param>
/// <param name="AutomationName">The accessible name the page reports (the page title).</param>
public sealed record SafetyDisplay(
    SafetyState State,
    string Title,
    string Subtitle,
    string ListingTitle,
    string ListingSubtitle,
    string ChangeHint,
    IReadOnlyList<SafetyRowDisplay> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SafetyModel"/> to its <see cref="SafetyDisplay"/> — the native port of the render
/// logic in web/src/features/settings/pages/SafetyPage.tsx. Every one of the six manifest strings (plus the seven
/// rows' title/description keys) resolves through the i18n facade using the exact web key names, and each row's value
/// is formatted from the snapshot exactly as the web <c>renderValue</c> does. No WinUI types — unit-tested headlessly.
/// </summary>
public static class SafetyProjection
{
    // The web row value literals (web renderValue) — the deterministic projection of each canonical value. Not i18n in
    // the web source (they are value tokens, not chrome), so they are reproduced verbatim here for byte-parity.
    private const string On = "On";
    private const string Off = "Off";
    private const string Active = "Active";
    private const string Suspended = "Suspended";
    private const string EmDash = "\u2014";

    // The deterministic safety-settings listing — mirrors the module-scope SAFETY_ROWS array in the web source
    // (same set + order), so the off-mode static-help surface lists everything Helix would explain on-mode.
    private static readonly SafetyRowMeta[] Rows =
    [
        new(
            "safetySettings.rows.quietHoursEnabled.title",
            "Quiet hours",
            "safetySettings.rows.quietHoursEnabled.description",
            "When ON, TeslaSync defers non-critical notifications during the configured quiet-hours window. "
                + "Critical alerts are always delivered.",
            "/docs/notifications/quiet-hours.md",
            static s => s.QuietHoursEnabled ? On : Off),
        new(
            "safetySettings.rows.quietHoursStart.title",
            "Quiet-hours window start",
            "safetySettings.rows.quietHoursStart.description",
            "Window start in HH:MM (24-hour) local time. Effective only when quiet hours are ON.",
            "/docs/notifications/quiet-hours.md",
            static s => Display(s.QuietHoursStart)),
        new(
            "safetySettings.rows.quietHoursEnd.title",
            "Quiet-hours window end",
            "safetySettings.rows.quietHoursEnd.description",
            "Window end in HH:MM (24-hour) local time. Effective only when quiet hours are ON.",
            "/docs/notifications/quiet-hours.md",
            static s => Display(s.QuietHoursEnd)),
        new(
            "safetySettings.rows.alertDigestMode.title",
            "Alert digest mode",
            "safetySettings.rows.alertDigestMode.description",
            "How alerts are batched. Instant delivers each alert as it fires; Hourly batches into one digest per "
                + "hour; Daily batches into one digest per day.",
            "/docs/notifications/digest.md",
            static s => Display(s.AlertDigestMode)),
        new(
            "safetySettings.rows.criticalFlashEnabled.title",
            "Critical-alert tab flash",
            "safetySettings.rows.criticalFlashEnabled.description",
            "When ON, TeslaSync briefly flashes the browser tab title when a critical alert arrives while the tab is "
                + "in the background. Honours the OS-level reduce-motion preference.",
            "/docs/notifications/tab-signalling.md",
            static s => s.CriticalFlashEnabled ? On : Off),
        new(
            "safetySettings.rows.tabBadgeEnabled.title",
            "Unread tab badge",
            "safetySettings.rows.tabBadgeEnabled.description",
            "When ON, TeslaSync prefixes the browser tab title with (N) and paints a coloured dot on the favicon for "
                + "unread notifications.",
            "/docs/notifications/tab-signalling.md",
            static s => s.TabBadgeEnabled ? On : Off),
        new(
            "safetySettings.rows.apiSuspended.title",
            "API kill-switch",
            "safetySettings.rows.apiSuspended.description",
            "Operational kill-switch. When ON, TeslaSync stops issuing requests to the Tesla Fleet API; existing "
                + "telemetry streams continue. Used during outage triage so the install does not pile up rate-limited "
                + "retries.",
            "/docs/operations/api-suspended.md",
            static s => s.ApiSuspended ? Suspended : Active),
    ];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved safety-settings snapshot).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SafetyDisplay Project(SafetyModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Page header (web PageContainer title + subtitle).
        string title = localizer.GetString("safetySettings.pageTitle", "Safety settings");
        string subtitle = localizer.GetString(
            "safetySettings.pageSubtitle",
            "Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the "
                + "API kill-switch. Use the links below each row to change a value.");

        // GlassPanel1 — the deterministic safety-settings listing.
        string listingTitle = localizer.GetString("safetySettings.listing.title", "Your safety-related settings");
        string listingSubtitle = localizer.GetString(
            "safetySettings.listing.subtitle",
            "Each row shows the current value on this install and links to the canonical Settings page where you can "
                + "change it.");
        string changeHint = localizer.GetString(
            "safetySettings.listing.changeHint",
            "To change a value, open the main Settings page. This page is read-only and never changes a setting on "
                + "its own.");
        string docsLabel = localizer.GetString("safetySettings.listing.docsLink", "Docs");

        var rows = new List<SafetyRowDisplay>(Rows.Length);
        foreach (var row in Rows)
        {
            rows.Add(new SafetyRowDisplay(
                Key: row.TitleKey,
                Title: localizer.GetString(row.TitleKey, row.TitleFallback),
                Value: row.RenderValue(model.Settings),
                Description: localizer.GetString(row.DescriptionKey, row.DescriptionFallback),
                DocsLabel: docsLabel,
                DocsUri: SafetyPageRegistration.DocsBaseUrl + row.DocsAnchor));
        }

        return new SafetyDisplay(
            State: SafetyState.Success,
            Title: title,
            Subtitle: subtitle,
            ListingTitle: listingTitle,
            ListingSubtitle: listingSubtitle,
            ChangeHint: changeHint,
            Rows: rows,
            AutomationName: title);
    }

    // web: `s.quiet_hours_start ?? '—'` / `s.alert_digest_mode ?? 'instant'` — show the value, or an em-dash when blank.
    private static string Display(string value) => string.IsNullOrWhiteSpace(value) ? EmDash : value;

    private sealed record SafetyRowMeta(
        string TitleKey,
        string TitleFallback,
        string DescriptionKey,
        string DescriptionFallback,
        string DocsAnchor,
        Func<SafetySettingsSnapshot, string> RenderValue);
}

/// <summary>
/// Static identity + i18n helpers for the <c>SafetyPage</c> surface: the diagnostics slug, the navigation route name
/// (matching the RouteTable <c>SafetySettingsPage</c> entry at path <c>settings/safety</c>), the generated read
/// operation id (web <c>useSettings</c>) and the documentation base URL the per-row "Docs" links resolve against.
/// </summary>
public static class SafetyPageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SafetyPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SafetySettingsPage</c>).</summary>
    public const string RouteName = "SafetySettingsPage";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "settings/safety";

    /// <summary>The generated OpenAPI operation id for the settings read (web <c>useSettings</c> → <c>GET /settings</c>).</summary>
    public const string GetOperation = "get_api_v1_settings";

    /// <summary>The base the per-row relative <c>docsAnchor</c> paths resolve against to open the canonical docs.</summary>
    public const string DocsBaseUrl = "https://github.com/ev-dev-labs/teslasync/blob/main";

    /// <summary>The localized page title (web <c>safetySettings.pageTitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("safetySettings.pageTitle", "Safety settings");
    }

    /// <summary>The localized page subtitle (web <c>safetySettings.pageSubtitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "safetySettings.pageSubtitle",
            "Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the "
                + "API kill-switch. Use the links below each row to change a value.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SafetyPage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a setting value — so a diagnostics line can never leak
/// configuration. Thread-safe.
/// </summary>
public sealed class SafetyPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public SafetyPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SafetyPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SafetyPageRegistration.Slug}");
    }
}
