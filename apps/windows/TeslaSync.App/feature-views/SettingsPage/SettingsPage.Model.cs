using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>SettingsPage</c> surface — the native mirror of the data states the
/// web page renders (web/src/features/settings/pages/SettingsPage.tsx). The web page runs the <c>useSettings</c> query
/// purely to gate the <c>PageContainer</c> <c>loading</c> prop; once the query resolves, the (static) settings content
/// always renders. This enum therefore has exactly the two states the parity manifest declares — <see cref="Loading"/>
/// while the query is in flight, and <see cref="Success"/> once it resolves — and the per-region visibility is driven
/// off the projected flags so the body renders exactly as the web composes it.
/// </summary>
public enum SettingsState
{
    /// <summary>The settings query is in flight (web <c>isLoading</c>) — the page shows the loading spinner.</summary>
    Loading,

    /// <summary>The query resolved (web <c>!isLoading</c>) — the settings content renders.</summary>
    Success,
}

/// <summary>
/// The settings-read seam the page binds through (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useSettings()</c> hook (web/src/api/hooks/useSettings.ts). The page only needs the load lifecycle (the web page
/// consumes <c>useSettings</c> solely for <c>isLoading</c>); the concrete <see cref="SettingsClientFeed"/> drives the
/// real <c>GET /settings</c> read while <see cref="EmptySettingsFeed"/> stands in for headless hosts and tests.
/// </summary>
public interface ISettingsFeed
{
    /// <summary>Resolve the settings snapshot (web <c>useSettings</c> query). Throws on a transport / HTTP failure.</summary>
    Task<SettingsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The resolved settings payload marker — the native analogue of the web <c>useSettings().data</c>. The page surface
/// itself renders only static affordances, so it needs nothing beyond "did the read resolve"; the typed settings shape
/// is owned by the individual settings-section units. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">Whether the read returned a settings object (web <c>data != null</c>).</param>
public sealed record SettingsSnapshot(bool HasData)
{
    /// <summary>The empty snapshot (no settings object) — the headless / default read result.</summary>
    public static SettingsSnapshot Empty { get; } = new(false);

    /// <summary>Parse a settings read, tolerating the bare object and the platform <c>{data:…}</c> envelope.</summary>
    public static SettingsSnapshot FromJson(JsonElement json)
    {
        if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty("data", out var data))
        {
            return new SettingsSnapshot(data.ValueKind is JsonValueKind.Object or JsonValueKind.Array);
        }

        return new SettingsSnapshot(json.ValueKind is JsonValueKind.Object or JsonValueKind.Array);
    }
}

/// <summary>The default feed — resolves the read to the empty snapshot (the headless / unpackaged default).</summary>
public sealed class EmptySettingsFeed : ISettingsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySettingsFeed Instance { get; } = new();

    private EmptySettingsFeed()
    {
    }

    /// <inheritdoc />
    public Task<SettingsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SettingsSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>SettingsPage</c> projects from — the native analogue of the web page's resolved
/// query state (web/src/features/settings/pages/SettingsPage.tsx). Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
/// <param name="Loading">Whether the settings query is in flight with no result yet (web <c>isLoading</c>).</param>
public sealed record SettingsModel(bool Loading)
{
    /// <summary>The initial (first-load) model the view-model starts from.</summary>
    public static SettingsModel Initial { get; } = new(Loading: true);
}

/// <summary>
/// The projected, render-ready content the <c>SettingsPage</c> view binds to — every visible literal resolved through
/// the i18n facade (the exact web key names) plus the top-level <see cref="SettingsState"/> and the loading flag. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SettingsDisplay(
    SettingsState State,
    bool ShowLoading,
    string Title,
    string Subtitle,
    string ConflictResourceLabel,
    string ExportTitle,
    string ExportSubtitle,
    string TourTitle,
    string TourDescription,
    string TourActionLabel,
    string ChecklistTitle,
    string ChecklistDescription,
    string ChecklistActionLabel,
    string ChecklistRestartedMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SettingsModel"/> to its <see cref="SettingsDisplay"/> — the native port of the
/// render logic in web/src/features/settings/pages/SettingsPage.tsx. Every one of the twelve manifest strings resolves
/// through the i18n facade using the exact web key names, on every projection (regardless of data state) so the i18n
/// contract holds while loading and once loaded. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SettingsProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SettingsDisplay Project(SettingsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Page header (web PageContainer title + subtitle).
        string title = localizer.GetString("title", "Settings");
        string subtitle = localizer.GetString(
            "subtitle",
            "Configure TeslaSync preferences and Tesla account connection");

        // Edit-conflict banner resource noun (web <EditConflictBanner resourceLabel={t('editConflict.resource.settings')} />).
        string conflictResource = localizer.GetString("editConflict.resource.settings", "Your settings");

        // GlassPanel1 — Data Export link (web <a href="/data-export"><GlassPanel>…).
        string exportTitle = localizer.GetString("export.title", "Data Export");
        string exportSubtitle = localizer.GetString(
            "export.subtitle",
            "Export drives, charging, analytics, or full backup as CSV/JSON");

        // GlassPanel2 — Onboarding Tour.
        string tourTitle = localizer.GetString("tour.title", "Onboarding Tour");
        string tourDescription = localizer.GetString(
            "tour.description",
            "Re-run the guided walkthrough of TeslaSync features");
        string tourAction = localizer.GetString("tour.restart", "Open Tour Launcher");

        // GlassPanel3 — Setup Checklist restart affordance.
        string checklistTitle = localizer.GetString("checklist.settings.title", "Setup Checklist");
        string checklistDescription = localizer.GetString(
            "checklist.settings.description",
            "Restart the first-run checklist widget on your dashboard. If you removed it, re-add the "
                + "\u201cSetup Checklist\u201d widget from the dashboard customizer.");
        string checklistAction = localizer.GetString("checklist.settings.restart", "Restart Checklist");
        string checklistRestarted = localizer.GetString(
            "checklist.settings.restarted",
            "Setup checklist restarted \u2014 re-add the widget from the dashboard customizer if needed.");

        var state = model.Loading ? SettingsState.Loading : SettingsState.Success;

        return new SettingsDisplay(
            State: state,
            ShowLoading: model.Loading,
            Title: title,
            Subtitle: subtitle,
            ConflictResourceLabel: conflictResource,
            ExportTitle: exportTitle,
            ExportSubtitle: exportSubtitle,
            TourTitle: tourTitle,
            TourDescription: tourDescription,
            TourActionLabel: tourAction,
            ChecklistTitle: checklistTitle,
            ChecklistDescription: checklistDescription,
            ChecklistActionLabel: checklistAction,
            ChecklistRestartedMessage: checklistRestarted,
            AutomationName: title);
    }
}

/// <summary>
/// Static identity + i18n helpers for the <c>SettingsPage</c> surface: the diagnostics slug, the navigation route name
/// (matching the RouteTable <c>Settings</c> entry), the generated read operation id (web <c>useSettings</c>), the
/// Segoe Fluent Icons glyphs standing in for the web Lucide icons, and the cross-page link route the Data Export panel
/// navigates to (web <c>/data-export</c>).
/// </summary>
public static class SettingsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SettingsPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Settings</c>).</summary>
    public const string RouteName = "Settings";

    /// <summary>The generated OpenAPI operation id for the settings read (web <c>useSettings</c> → <c>GET /settings</c>).</summary>
    public const string GetOperation = "get_api_v1_settings";

    /// <summary>The route the Data Export panel deep-links to (web <c>/data-export</c>).</summary>
    public const string DataExportRoute = "data-export";

    /// <summary>The Segoe Fluent "Download" glyph standing in for the web Lucide <c>Download</c> icon.</summary>
    public const string DataExportGlyph = "\uE896";

    /// <summary>The Segoe Fluent "OpenInNewWindow" glyph standing in for the web Lucide <c>ExternalLink</c> icon.</summary>
    public const string ExternalLinkGlyph = "\uE8A7";

    /// <summary>The Segoe Fluent "Play" glyph standing in for the web Lucide <c>PlayCircle</c> tour icon.</summary>
    public const string TourGlyph = "\uE768";

    /// <summary>The Segoe Fluent "BulletedListMirrored" glyph standing in for the web Lucide <c>Rocket</c> checklist icon.</summary>
    public const string ChecklistGlyph = "\uE9D5";

    /// <summary>The localized page title (web <c>settings:title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("title", "Settings");
    }

    /// <summary>The localized page subtitle (web <c>settings:subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "subtitle",
            "Configure TeslaSync preferences and Tesla account connection");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SettingsPage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never any settings value — so a diagnostics line can never leak
/// fleet content. Thread-safe.
/// </summary>
public sealed class SettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SettingsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SettingsRegistration.Slug}");
    }
}
