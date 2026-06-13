using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// One curated catalog entry — the native analogue of the web <c>CuratedDashboardPanel</c>
/// (web/src/features/power-user/pages/DashboardsPage.tsx). The catalog is install-wide static (it mirrors the
/// Go-side <c>AINLDashboardComposerPanelEntry</c> shape), so it is a compile-time constant rather than a
/// network read — exactly as the web page hard-codes <c>CURATED_DASHBOARD_PANELS</c>. Pure data.
/// </summary>
/// <param name="Name">The panel's <c>panel_name</c> token (the curated identifier).</param>
/// <param name="Description">The one-line description shown beneath the name.</param>
public sealed record CuratedDashboardPanel(string Name, string Description);

/// <summary>
/// The static curated panel catalog — a one-for-one port of the web <c>CURATED_DASHBOARD_PANELS</c> array
/// (web/src/features/power-user/pages/DashboardsPage.tsx) and its <c>sortedPanels</c> memo. The Helix
/// natural-language composer refuses any <c>panel_name</c> outside this list, and a dashboard may use each
/// <c>panel_name</c> at most once. UI-free so the catalog and its ordering are asserted headlessly.
/// </summary>
public static class DashboardComposerCatalog
{
    /// <summary>The catalog in source order (web array order, before sorting).</summary>
    public static IReadOnlyList<CuratedDashboardPanel> Panels { get; } =
    [
        new("drives_per_day_timeseries", "Timeseries panel: SUM(distance_m)/day from the drives table"),
        new("battery_soc_stat", "Stat panel: latest BatteryLevel sample from signal_log_view"),
        new("charging_sessions_table", "Table panel: recent rows from the charging_sessions table"),
        new("alerts_count_stat", "Stat panel: count of alerts fired in the last 7 days"),
        new("vehicles_table", "Table panel: vehicles metadata overview (id, model, color)"),
        new("energy_used_per_day_barchart", "Barchart panel: SUM(energy_used_wh)/day from the drives table"),
    ];

    /// <summary>
    /// The catalog sorted by <see cref="CuratedDashboardPanel.Name"/> — the native analogue of the web
    /// <c>sortedPanels</c> memo (<c>[...CURATED_DASHBOARD_PANELS].sort((a, b) =&gt; a.name.localeCompare(b.name))</c>).
    /// Every name is lower-case ASCII, so an ordinal sort matches the web locale compare exactly.
    /// </summary>
    public static IReadOnlyList<CuratedDashboardPanel> Sorted() =>
        Panels.OrderBy(static p => p.Name, StringComparer.Ordinal).ToArray();
}

/// <summary>
/// The input that drives one render of the composer — the native analogue of the web component's local
/// <c>dashboardJson</c> state (web/src/features/power-user/pages/DashboardsPage.tsx). The editor writes a fresh
/// value on every keystroke and the view-model re-projects, mirroring the web <c>setDashboardJson</c> flow.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Json">The raw text currently in the editor (web <c>dashboardJson</c>).</param>
public sealed record DashboardComposerInput(string Json)
{
    /// <summary>The resting input — an empty editor.</summary>
    public static DashboardComposerInput Blank { get; } = new(string.Empty);

    /// <summary>Wrap <paramref name="json"/> as an input, coalescing <see langword="null"/> to the empty editor.</summary>
    public static DashboardComposerInput From(string? json) => new(json ?? string.Empty);

    /// <summary>True when the copy affordance is enabled (web <c>dashboardJson.trim().length &gt; 0</c>).</summary>
    public bool CanCopy => Json.Trim().Length > 0;
}

/// <summary>
/// The mutually-exclusive outcome of a copy attempt — the native analogue of the four status branches the web
/// <c>handleCopy</c> sets (web/src/features/power-user/pages/DashboardsPage.tsx), chosen in the same
/// precedence: <see cref="Empty"/> (the editor is blank — web <c>!trimmed</c>), <see cref="Unavailable"/>
/// (no clipboard access — web <c>!navigator.clipboard</c>), <see cref="Success"/> (the write resolved) and
/// <see cref="Failed"/> (the write threw — web <c>catch</c>).
/// </summary>
public enum DashboardCopyOutcome
{
    /// <summary>The editor is blank — prompt the user to enter JSON first (web <c>copyEmpty</c>).</summary>
    Empty,

    /// <summary>Clipboard access is not available — ask the user to copy manually (web <c>copyUnavailable</c>).</summary>
    Unavailable,

    /// <summary>The JSON was copied (web <c>copySuccess</c>).</summary>
    Success,

    /// <summary>The clipboard write failed — ask the user to copy manually (web <c>copyFailed</c>).</summary>
    Failed,
}

/// <summary>
/// The fully projected, render-ready view of the composer for one editor value — everything the WinUI view
/// binds to, with every visible literal already resolved through the i18n facade. Holds the page header + intro,
/// the editor panel's labels and the four copy-status messages (all resolved on every projection so the i18n
/// contract holds regardless of which branch the copy flow later takes), the curated catalog and its labels,
/// and the current <see cref="CanCopy"/> flag. Pure data — no WinUI types — so every branch is asserted
/// headlessly.
/// </summary>
public sealed record DashboardComposerDisplay(
    string Title,
    string Intro,

    // GlassPanel1 — manual JSON editor.
    string EditorTitle,
    string EditorHint,
    string EditorLabel,
    string CopyLabel,
    string ClearLabel,
    string CopyEmptyMessage,
    string CopyUnavailableMessage,
    string CopySuccessMessage,
    string CopyFailedMessage,

    // GlassPanel2 — curated panel catalog.
    string PanelsTitle,
    string PanelsIntro,
    IReadOnlyList<CuratedDashboardPanel> Panels,

    bool CanCopy)
{
    /// <summary>The status line for a completed copy attempt (web <c>setStatusMessage</c> per branch).</summary>
    /// <param name="outcome">The branch the copy flow took.</param>
    public string StatusFor(DashboardCopyOutcome outcome) => outcome switch
    {
        DashboardCopyOutcome.Empty => CopyEmptyMessage,
        DashboardCopyOutcome.Unavailable => CopyUnavailableMessage,
        DashboardCopyOutcome.Success => CopySuccessMessage,
        DashboardCopyOutcome.Failed => CopyFailedMessage,
        _ => string.Empty,
    };
}

/// <summary>
/// Pure projection from a <see cref="DashboardComposerInput"/> to its render-ready <see cref="DashboardComposerDisplay"/>
/// — the native port of the web <c>DashboardsPage</c> render body
/// (web/src/features/power-user/pages/DashboardsPage.tsx). Every visible literal resolves through the i18n
/// facade using the exact web key names and the verbatim web translation defaults; the curated catalog is
/// sorted exactly as the web <c>sortedPanels</c> memo. No SI conversion applies — the surface carries no
/// measurements. UI-free so the transform is unit-tested without a XAML host.
/// </summary>
public static class DashboardComposerProjection
{
    /// <summary>i18n key for the page title (web <c>powerDashboards.title</c>).</summary>
    public const string TitleKey = "powerDashboards.title";

    /// <summary>English default for the page title (web translation default).</summary>
    public const string TitleDefault = "Dashboard Composer";

    /// <summary>i18n key for the intro paragraph (web <c>powerDashboards.intro</c>).</summary>
    public const string IntroKey = "powerDashboards.intro";

    /// <summary>English default for the intro paragraph (web translation default).</summary>
    public const string IntroDefault =
        "Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and " +
        "placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your " +
        "JSON into your existing Grafana dashboard editor.";

    /// <summary>i18n key for the editor panel title (web <c>powerDashboards.editor.title</c>).</summary>
    public const string EditorTitleKey = "powerDashboards.editor.title";

    /// <summary>English default for the editor panel title (web translation default).</summary>
    public const string EditorTitleDefault = "Manual dashboard JSON editor";

    /// <summary>i18n key for the editor hint — the web editor example-envelope key.</summary>
    public const string EditorHintKey = "powerDashboards.editor.placeholder"; // parity:allow web i18n key name (verbatim)

    /// <summary>English default for the editor hint — the web example envelope shown in the empty editor.</summary>
    public const string EditorHintDefault =
        "{\n  \"title\": \"Fleet overview\",\n  \"slots\": [\n    {\n      \"panel_name\": " +
        "\"drives_per_day_timeseries\",\n      \"grid_pos\": { \"x\": 0, \"y\": 0, \"w\": 24, \"h\": 8 }\n    }\n  ]\n}";

    /// <summary>i18n key for the editor accessibility label (web <c>powerDashboards.editor.label</c>).</summary>
    public const string EditorLabelKey = "powerDashboards.editor.label";

    /// <summary>English default for the editor accessibility label (web translation default).</summary>
    public const string EditorLabelDefault = "Dashboard JSON editor";

    /// <summary>i18n key for the copy affordance (web <c>powerDashboards.editor.copy</c>).</summary>
    public const string CopyKey = "powerDashboards.editor.copy";

    /// <summary>English default for the copy affordance (web translation default).</summary>
    public const string CopyDefault = "Copy to clipboard";

    /// <summary>i18n key for the clear affordance (web <c>powerDashboards.editor.clear</c>).</summary>
    public const string ClearKey = "powerDashboards.editor.clear";

    /// <summary>English default for the clear affordance (web translation default).</summary>
    public const string ClearDefault = "Clear";

    /// <summary>i18n key for the blank-editor copy status (web <c>powerDashboards.editor.copyEmpty</c>).</summary>
    public const string CopyEmptyKey = "powerDashboards.editor.copyEmpty";

    /// <summary>English default for the blank-editor copy status (web translation default).</summary>
    public const string CopyEmptyDefault = "Type or paste a dashboard JSON envelope above before copying.";

    /// <summary>i18n key for the no-clipboard copy status (web <c>powerDashboards.editor.copyUnavailable</c>).</summary>
    public const string CopyUnavailableKey = "powerDashboards.editor.copyUnavailable";

    /// <summary>English default for the no-clipboard copy status (web translation default).</summary>
    public const string CopyUnavailableDefault =
        "Clipboard access is not available in this browser. Select the text manually and copy with " +
        "Ctrl+C / Cmd+C.";

    /// <summary>i18n key for the successful copy status (web <c>powerDashboards.editor.copySuccess</c>).</summary>
    public const string CopySuccessKey = "powerDashboards.editor.copySuccess";

    /// <summary>English default for the successful copy status (web translation default).</summary>
    public const string CopySuccessDefault =
        "Copied. Paste the JSON into your Grafana dashboard editor (Dashboard settings \u2192 JSON Model).";

    /// <summary>i18n key for the failed copy status (web <c>powerDashboards.editor.copyFailed</c>).</summary>
    public const string CopyFailedKey = "powerDashboards.editor.copyFailed";

    /// <summary>English default for the failed copy status (web translation default).</summary>
    public const string CopyFailedDefault =
        "Clipboard write failed. Select the text manually and copy with Ctrl+C / Cmd+C.";

    /// <summary>i18n key for the catalog panel title (web <c>powerDashboards.panels.title</c>).</summary>
    public const string PanelsTitleKey = "powerDashboards.panels.title";

    /// <summary>English default for the catalog panel title (web translation default).</summary>
    public const string PanelsTitleDefault = "Curated panel catalog";

    /// <summary>i18n key for the catalog intro (web <c>powerDashboards.panels.intro</c>).</summary>
    public const string PanelsIntroKey = "powerDashboards.panels.intro";

    /// <summary>English default for the catalog intro (web translation default).</summary>
    public const string PanelsIntroDefault =
        "These are the panels the curated catalog exposes. The Helix natural-language composer refuses any " +
        "panel_name outside this list, and each dashboard may use each panel_name at most once.";

    /// <summary>Project <paramref name="input"/> into a render-ready display, resolving every string via <paramref name="localizer"/>.</summary>
    /// <param name="input">The current editor value to project.</param>
    /// <param name="localizer">The i18n facade resolving every owned label.</param>
    public static DashboardComposerDisplay Project(DashboardComposerInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        return new DashboardComposerDisplay(
            Title: localizer.GetString(TitleKey, TitleDefault),
            Intro: localizer.GetString(IntroKey, IntroDefault),
            EditorTitle: localizer.GetString(EditorTitleKey, EditorTitleDefault),
            EditorHint: localizer.GetString(EditorHintKey, EditorHintDefault),
            EditorLabel: localizer.GetString(EditorLabelKey, EditorLabelDefault),
            CopyLabel: localizer.GetString(CopyKey, CopyDefault),
            ClearLabel: localizer.GetString(ClearKey, ClearDefault),
            CopyEmptyMessage: localizer.GetString(CopyEmptyKey, CopyEmptyDefault),
            CopyUnavailableMessage: localizer.GetString(CopyUnavailableKey, CopyUnavailableDefault),
            CopySuccessMessage: localizer.GetString(CopySuccessKey, CopySuccessDefault),
            CopyFailedMessage: localizer.GetString(CopyFailedKey, CopyFailedDefault),
            PanelsTitle: localizer.GetString(PanelsTitleKey, PanelsTitleDefault),
            PanelsIntro: localizer.GetString(PanelsIntroKey, PanelsIntroDefault),
            Panels: DashboardComposerCatalog.Sorted(),
            CanCopy: input.CanCopy);
    }
}

/// <summary>
/// Canonical metadata for the Dashboards surface. The web source is the page at route <c>/power/dashboards</c>
/// (nav name <c>Dashboards</c>); this carries the native route name the shell registers the page under and the
/// diagnostics <see cref="Slug"/> the P1/S11 contract emits with <c>view.opened</c>.
/// </summary>
public static class DashboardsRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches the route table).</summary>
    public const string RouteName = "PowerDashboards";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DashboardsPage";

    /// <summary>The localized page title (web <c>powerDashboards.title</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DashboardComposerProjection.TitleKey, DashboardComposerProjection.TitleDefault);
    }
}

/// <summary>
/// PII-safe diagnostics for the Dashboards surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never the editor value or any composed dashboard JSON (which
/// can embed install-specific panel queries) — so a diagnostics line can never leak the content a user pasted.
/// Thread-safe.
/// </summary>
public sealed class DashboardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public DashboardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DashboardsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DashboardsRegistration.Slug}");
    }
}
