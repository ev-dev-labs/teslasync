using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="AppearanceSettingsViewModel"/> can be in — the
/// native union of the branches the Appearance surface renders. The web
/// <c>AppearanceSettings</c> (web/src/features/settings/components/AppearanceSettings.tsx) reads its server
/// preferences from <c>useSettings()</c> (the <c>ui_density</c> / <c>time_format_default</c> /
/// <c>chart_palette</c> document) and falls back to defaults while that query is in flight; the native
/// surface owns its own cache-then-network read of <c>GET /settings</c>, so — like the sibling
/// <see cref="CostForecastSection"/> — it reproduces the full loading / loaded / empty / error / stale /
/// offline matrix the P2 state contract requires. Every value maps onto a visible surface (never a blank
/// panel): <see cref="Loaded"/>, <see cref="Empty"/>, <see cref="Stale"/> and <see cref="Offline"/> render
/// the full eight-section settings form (server controls reflect the cached/fresh document or the defaults,
/// the local-preference controls are always interactive), <see cref="Loading"/> shows the skeleton chrome
/// and <see cref="Error"/> the retry affordance.
/// </summary>
public enum AppearanceSettingsState
{
    /// <summary>Initial fetch with no cached settings document — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh settings document arrived — render the full form bound to it.</summary>
    Loaded,

    /// <summary>The settings document resolved empty — render the full form seeded with defaults.</summary>
    Empty,

    /// <summary>The read failed and no cached document exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached document older than the freshness window — render the form plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached document remains — render the form plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The information-density preference (web <c>ui_density</c> — <c>compact</c> / <c>comfortable</c> /
/// <c>spacious</c>). Persisted server-side because the web density picker writes the same
/// <c>ui_density</c> setting <c>useDensitySync</c> applies to <c>body[data-density]</c>.
/// </summary>
public enum DensityChoice
{
    /// <summary>Tight rows — fits more on screen (web <c>compact</c>).</summary>
    Compact,

    /// <summary>Default sizing (web <c>comfortable</c>).</summary>
    Comfortable,

    /// <summary>Roomy — easier to read at distance (web <c>spacious</c>).</summary>
    Spacious,
}

/// <summary>The default timestamp rendering preference (web <c>time_format_default</c>).</summary>
public enum TimeFormatChoice
{
    /// <summary>Relative ("2h ago") — best for recent activity feeds (web <c>relative</c>).</summary>
    Relative,

    /// <summary>Absolute ("Nov 12, 13:42") — best for trip planning (web <c>absolute</c>).</summary>
    Absolute,
}

/// <summary>The chart colour palette preference (web <c>chart_palette</c>).</summary>
public enum ChartPaletteChoice
{
    /// <summary>Colour-blind-safe Okabe-Ito palette — the default (web <c>cb_safe</c>).</summary>
    CbSafe,

    /// <summary>Stylistic neon palette (web <c>neon</c>).</summary>
    Neon,
}

/// <summary>
/// The sidebar visual layout preference (web <c>useSidebarStyle</c>). A per-device, client-only preference
/// (web localStorage <c>teslasync:sidebar-style:v1</c>) — instant, offline, never a network round-trip.
/// </summary>
public enum SidebarStyleChoice
{
    /// <summary>Quiet single column with a 2px accent bar — the default (web <c>linear</c> / "Minimal").</summary>
    Linear,

    /// <summary>Tighter rows with collapsible sections (web <c>notion</c> / "Compact").</summary>
    Notion,

    /// <summary>Colourful icon tiles with a pill on the active item (web <c>legacy</c> / "Classic").</summary>
    Legacy,
}

/// <summary>The product-tour action a tour button performs (web <c>startTour(id)</c> / <c>resetAllTours()</c>).</summary>
public enum TourAction
{
    /// <summary>Replay the dashboard tour (web <c>startTour('main')</c>).</summary>
    ReplayMain,

    /// <summary>Replay the debugger tour (web <c>startTour('debugger')</c>).</summary>
    ReplayDebugger,

    /// <summary>Replay the automations tour (web <c>startTour('automations')</c>).</summary>
    ReplayAutomations,

    /// <summary>Reset every onboarding tour (web <c>resetAllTours()</c>).</summary>
    ResetAll,
}

/// <summary>
/// The canonical wire tokens + enum mapping for the three server-side appearance preferences. Kept in one
/// place so the parse (<see cref="AppearanceServerSettings.FromJson"/>) and the full-replace save body
/// (<see cref="AppearanceServerSettings.ToRequestBody"/>) agree exactly with the Go API's snake_case JSON.
/// </summary>
public static class AppearanceWire
{
    /// <summary>The <c>ui_density</c> settings key.</summary>
    public const string DensityKey = "ui_density";

    /// <summary>The <c>time_format_default</c> settings key.</summary>
    public const string TimeFormatKey = "time_format_default";

    /// <summary>The <c>chart_palette</c> settings key.</summary>
    public const string ChartPaletteKey = "chart_palette";

    /// <summary>The wire token for a <see cref="DensityChoice"/>.</summary>
    public static string Token(DensityChoice value) => value switch
    {
        DensityChoice.Compact => "compact",
        DensityChoice.Spacious => "spacious",
        _ => "comfortable",
    };

    /// <summary>The wire token for a <see cref="TimeFormatChoice"/>.</summary>
    public static string Token(TimeFormatChoice value) => value == TimeFormatChoice.Absolute ? "absolute" : "relative";

    /// <summary>The wire token for a <see cref="ChartPaletteChoice"/>.</summary>
    public static string Token(ChartPaletteChoice value) => value == ChartPaletteChoice.Neon ? "neon" : "cb_safe";

    /// <summary>The wire token for a <see cref="SidebarStyleChoice"/>.</summary>
    public static string Token(SidebarStyleChoice value) => value switch
    {
        SidebarStyleChoice.Notion => "notion",
        SidebarStyleChoice.Legacy => "legacy",
        _ => "linear",
    };

    /// <summary>Parses a <c>ui_density</c> token, defaulting to <see cref="DensityChoice.Comfortable"/>.</summary>
    public static DensityChoice ParseDensity(string? token) => token?.Trim().ToLowerInvariant() switch
    {
        "compact" => DensityChoice.Compact,
        "spacious" => DensityChoice.Spacious,
        _ => DensityChoice.Comfortable,
    };

    /// <summary>Parses a <c>time_format_default</c> token, defaulting to <see cref="TimeFormatChoice.Relative"/>.</summary>
    public static TimeFormatChoice ParseTimeFormat(string? token) =>
        string.Equals(token?.Trim(), "absolute", StringComparison.OrdinalIgnoreCase)
            ? TimeFormatChoice.Absolute
            : TimeFormatChoice.Relative;

    /// <summary>Parses a <c>chart_palette</c> token, defaulting to <see cref="ChartPaletteChoice.CbSafe"/>.</summary>
    public static ChartPaletteChoice ParseChartPalette(string? token) =>
        string.Equals(token?.Trim(), "neon", StringComparison.OrdinalIgnoreCase)
            ? ChartPaletteChoice.Neon
            : ChartPaletteChoice.CbSafe;

    /// <summary>Parses a sidebar-style token, defaulting to <see cref="SidebarStyleChoice.Linear"/>.</summary>
    public static SidebarStyleChoice ParseSidebar(string? token) => token?.Trim().ToLowerInvariant() switch
    {
        "notion" => SidebarStyleChoice.Notion,
        "legacy" => SidebarStyleChoice.Legacy,
        _ => SidebarStyleChoice.Linear,
    };
}

/// <summary>
/// The two canonical chart palettes the chart-palette preview swatches render — the native mirror of
/// <c>CHART_COLORS_CB_SAFE</c> / <c>CHART_COLORS_NEON</c> in web/src/lib/colors.ts. These are the palette's
/// own identity (the colour-blind-safe Okabe-Ito set vs the stylistic neon set), carried here as data —
/// exactly as the web carries the hex arrays — so the preview chips reproduce the web swatches faithfully.
/// They are preview-only and never tint the control chrome (which uses W1 tokens).
/// </summary>
public static class AppearancePalettes
{
    /// <summary>The colour-blind-safe Okabe-Ito palette (web <c>CHART_COLORS_CB_SAFE</c>).</summary>
    public static IReadOnlyList<string> CbSafe { get; } =
    [
        "#0072B2", "#E69F00", "#009E73", "#F0E442", "#56B4E9", "#D55E00", "#CC79A7", "#4B4B4B",
    ];

    /// <summary>The stylistic neon palette (web <c>CHART_COLORS_NEON</c>).</summary>
    public static IReadOnlyList<string> Neon { get; } =
    [
        "#00f0ff", "#10b981", "#a855f7", "#f59e0b", "#4f46e5", "#ef4444", "#ec4899", "#14b8a6",
    ];

    /// <summary>The preview swatches for a palette choice.</summary>
    public static IReadOnlyList<string> For(ChartPaletteChoice choice) =>
        choice == ChartPaletteChoice.Neon ? Neon : CbSafe;
}

/// <summary>
/// The three server-side appearance preferences plus the rest of the settings document. The web reads
/// these from <c>useSettings()</c> (<c>settings.ui_density</c> / <c>time_format_default</c> /
/// <c>chart_palette</c>); because the <c>PUT /settings</c> endpoint is full-replace (not patch), the web
/// saves with the partial-merge pattern <c>{ ...settings, ui_density: next }</c>. <see cref="Raw"/> preserves
/// every other top-level field of the document so <see cref="ToRequestBody"/> can reproduce that lossless
/// full-replace merge. WinUI-free so the parse and merge are unit-tested without a UI host.
/// </summary>
public sealed record AppearanceServerSettings(
    DensityChoice Density,
    TimeFormatChoice TimeFormat,
    ChartPaletteChoice ChartPalette,
    IReadOnlyDictionary<string, JsonElement> Raw)
{
    /// <summary>The privacy-first defaults used while the read is in flight or the document is absent/empty.</summary>
    public static AppearanceServerSettings Default { get; } = new(
        DensityChoice.Comfortable,
        TimeFormatChoice.Relative,
        ChartPaletteChoice.CbSafe,
        new Dictionary<string, JsonElement>(StringComparer.Ordinal));

    /// <summary>
    /// Project a <c>GET /settings</c> JSON object into the appearance preferences, tolerating an
    /// absent/non-object body (returns <see cref="Default"/>) and absent/invalid fields (each falls back to
    /// its default). Every other top-level field is preserved in <see cref="Raw"/> (detached clones) so a
    /// later save round-trips the whole document.
    /// </summary>
    public static AppearanceServerSettings FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Default;
        }

        var raw = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            raw[property.Name] = property.Value.Clone();
        }

        return new AppearanceServerSettings(
            AppearanceWire.ParseDensity(GetString(element, AppearanceWire.DensityKey)),
            AppearanceWire.ParseTimeFormat(GetString(element, AppearanceWire.TimeFormatKey)),
            AppearanceWire.ParseChartPalette(GetString(element, AppearanceWire.ChartPaletteKey)),
            raw);
    }

    /// <summary>The settings document with this density applied (the web <c>{ ...settings, ui_density }</c>).</summary>
    public AppearanceServerSettings WithDensity(DensityChoice value) => this with { Density = value };

    /// <summary>The settings document with this time format applied.</summary>
    public AppearanceServerSettings WithTimeFormat(TimeFormatChoice value) => this with { TimeFormat = value };

    /// <summary>The settings document with this chart palette applied.</summary>
    public AppearanceServerSettings WithChartPalette(ChartPaletteChoice value) => this with { ChartPalette = value };

    /// <summary>
    /// The full-replace <c>PUT /settings</c> body: every preserved field from <see cref="Raw"/> plus the
    /// three appearance keys set from the current choices (the web <c>{ ...settings, &lt;key&gt;: next }</c>
    /// merge). The three keys are always authored from the typed choices so a stale raw value cannot win.
    /// </summary>
    public IReadOnlyDictionary<string, object?> ToRequestBody()
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in Raw)
        {
            body[key] = value;
        }

        body[AppearanceWire.DensityKey] = AppearanceWire.Token(Density);
        body[AppearanceWire.TimeFormatKey] = AppearanceWire.Token(TimeFormat);
        body[AppearanceWire.ChartPaletteKey] = AppearanceWire.Token(ChartPalette);
        return body;
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The per-device, client-only appearance preferences the web keeps in localStorage rather than the server
/// settings blob: the sidebar style (<c>useSidebarStyle</c>), the footer status-bar prefs
/// (<c>useStatusBarPrefs</c>) and the achievement-celebration prefs (<c>useAchievementCelebrationPrefs</c>).
/// They are instant, survive offline, and are per-device-form-factor decisions (web rationale). Defaults
/// mirror the web hooks exactly. WinUI-free so the normalization is unit-tested without a UI host.
/// </summary>
public sealed record AppearanceLocalPreferences
{
    /// <summary>Sidebar layout (web default <c>'linear'</c>).</summary>
    public SidebarStyleChoice SidebarStyle { get; init; } = SidebarStyleChoice.Linear;

    /// <summary>Whether the footer status bar is shown (web <c>StatusBar</c> default <c>enabled: true</c>).</summary>
    public bool StatusBarEnabled { get; init; } = true;

    /// <summary>Whether the status bar is always icon-only (web default <c>iconOnly: false</c>).</summary>
    public bool StatusBarIconOnly { get; init; }

    /// <summary>Whether a celebration toast pops on unlock (web default <c>showToasts: true</c>).</summary>
    public bool CelebrationShowToasts { get; init; } = true;

    /// <summary>Whether a chime plays on unlock (web default <c>playSound: false</c>).</summary>
    public bool CelebrationPlaySound { get; init; }

    /// <summary>Whether recent unlocks surface on the dashboard (web default <c>showOnDashboard: true</c>).</summary>
    public bool CelebrationShowOnDashboard { get; init; } = true;

    /// <summary>Whether achievement push notifications are sent (web default <c>pushOnUnlock: true</c>).</summary>
    public bool CelebrationPushOnUnlock { get; init; } = true;

    /// <summary>The default preferences used on first run / when nothing is persisted.</summary>
    public static AppearanceLocalPreferences Default { get; } = new();

    /// <summary>Returns a sanitized copy: an undefined sidebar enum falls back to <see cref="SidebarStyleChoice.Linear"/>.</summary>
    public AppearanceLocalPreferences Normalized() => this with
    {
        SidebarStyle = Enum.IsDefined(SidebarStyle) ? SidebarStyle : SidebarStyleChoice.Linear,
    };
}

/// <summary>One server-driven density choice card (web density picker button).</summary>
/// <param name="Id">The density this card selects.</param>
/// <param name="Label">Localized choice label.</param>
/// <param name="Help">Localized supporting help.</param>
/// <param name="IsActive">True when this is the current density.</param>
/// <param name="AutomationName">Narrator name (label + help).</param>
public sealed record DensityOption(DensityChoice Id, string Label, string Help, bool IsActive, string AutomationName);

/// <summary>One sidebar-style choice card (web sidebar-style radio).</summary>
/// <param name="Id">The sidebar style this card selects.</param>
/// <param name="Label">Localized choice label.</param>
/// <param name="Help">Localized supporting help.</param>
/// <param name="IsActive">True when this is the current sidebar style.</param>
/// <param name="AutomationName">Narrator name (label + help).</param>
public sealed record SidebarOption(SidebarStyleChoice Id, string Label, string Help, bool IsActive, string AutomationName);

/// <summary>One time-format choice card (web time-format button).</summary>
/// <param name="Id">The time format this card selects.</param>
/// <param name="Label">Localized choice label.</param>
/// <param name="Help">Localized supporting help.</param>
/// <param name="IsActive">True when this is the current time format.</param>
/// <param name="AutomationName">Narrator name (label + help).</param>
public sealed record TimeFormatOption(TimeFormatChoice Id, string Label, string Help, bool IsActive, string AutomationName);

/// <summary>One chart-palette choice card, with its preview swatches (web chart-palette radio).</summary>
/// <param name="Id">The palette this card selects.</param>
/// <param name="Label">Localized choice label.</param>
/// <param name="Help">Localized supporting help.</param>
/// <param name="IsActive">True when this is the current palette.</param>
/// <param name="Swatches">The palette's preview hex swatches.</param>
/// <param name="AutomationName">Narrator name (label + help).</param>
public sealed record ChartPaletteOption(
    ChartPaletteChoice Id,
    string Label,
    string Help,
    bool IsActive,
    IReadOnlyList<string> Swatches,
    string AutomationName);

/// <summary>One on/off preference row (web toggle row in the status-bar / celebration panels).</summary>
/// <param name="Label">Localized row label.</param>
/// <param name="Help">Localized supporting help.</param>
/// <param name="IsOn">The current on/off state.</param>
/// <param name="IsEnabled">Whether the row is interactive (web disabled when the parent toggle is off).</param>
/// <param name="AutomationName">Narrator name (label + help).</param>
public sealed record AppearanceToggleRow(string Label, string Help, bool IsOn, bool IsEnabled, string AutomationName);

/// <summary>One product-tour action button (web tour button).</summary>
/// <param name="Action">The tour action the button performs.</param>
/// <param name="Label">Localized button label.</param>
/// <param name="Variant">The button emphasis variant.</param>
/// <param name="Glyph">Optional leading Segoe Fluent glyph (empty for none).</param>
public sealed record TourButton(TourAction Action, string Label, ButtonVariant Variant, string Glyph);

/// <summary>The localized labels for the embedded theme picker (web shared <c>ThemePicker showMode</c>).</summary>
/// <param name="Label">Accessible group label.</param>
/// <param name="System">Localized "follow system" label.</param>
/// <param name="Light">Localized light-theme label.</param>
/// <param name="Dark">Localized dark-theme label.</param>
/// <param name="HighContrast">Localized high-contrast label.</param>
public sealed record ThemePickerLabels(string Label, string System, string Light, string Dark, string HighContrast);

/// <summary>The density section: its label, choices, supporting help and the live preview rows.</summary>
public sealed record DensitySection(
    string Label,
    string Help,
    IReadOnlyList<DensityOption> Options,
    string PreviewTitle,
    IReadOnlyList<string> PreviewRows);

/// <summary>The sidebar-style section: its label, choices and supporting help.</summary>
public sealed record SidebarSection(string Label, string Help, IReadOnlyList<SidebarOption> Options);

/// <summary>The time-format section: its label, choices and supporting help.</summary>
public sealed record TimeFormatSection(string Label, string Help, IReadOnlyList<TimeFormatOption> Options);

/// <summary>The chart-palette section: its label, choices and supporting help.</summary>
public sealed record ChartPaletteSection(string Label, string Help, IReadOnlyList<ChartPaletteOption> Options);

/// <summary>The status-bar section: its label and the two toggle rows.</summary>
public sealed record StatusBarSection(string Label, AppearanceToggleRow Show, AppearanceToggleRow IconOnly);

/// <summary>The achievement-celebration section: its label and the four toggle rows.</summary>
public sealed record CelebrationSection(
    string Label,
    AppearanceToggleRow ShowToasts,
    AppearanceToggleRow PlaySound,
    AppearanceToggleRow ShowOnDashboard,
    AppearanceToggleRow PushOnUnlock);

/// <summary>The product-tours section: its label, title, body and the four action buttons.</summary>
public sealed record ToursSection(string Label, string Title, string Body, IReadOnlyList<TourButton> Buttons);

/// <summary>
/// The fully projected, render-ready view of the Appearance surface — every section the web
/// <c>AppearanceSettings</c> renders, with every label already resolved through the i18n facade and every
/// active selection already computed. The view is a thin renderer over this. <see cref="ServerControlsEnabled"/>
/// mirrors the web <c>disabled={!settings || saveSettings.isPending}</c> gate that greys the three
/// server-driven choice groups while the document loads or a save is in flight; the local-preference
/// controls (sidebar, status bar, celebration, tours) are always interactive. Pure data so every section is
/// asserted without a UI host.
/// </summary>
public sealed record AppearanceSettingsDisplay(
    string Title,
    string Subtitle,
    ThemePickerLabels Theme,
    DensitySection Density,
    SidebarSection Sidebar,
    TimeFormatSection TimeFormat,
    ChartPaletteSection ChartPalette,
    StatusBarSection StatusBar,
    CelebrationSection Celebration,
    ToursSection Tours,
    bool ServerControlsEnabled,
    string AutomationName)
{
    /// <summary>An all-default display (server defaults + local-pref defaults) for the loading fallback.</summary>
    public static AppearanceSettingsDisplay Default(ILocalizer localizer) =>
        AppearanceSettingsProjection.Project(
            AppearanceServerSettings.Default,
            AppearanceLocalPreferences.Default,
            serverControlsEnabled: false,
            localizer);
}

/// <summary>
/// Canonical registry metadata for the Appearance surface — the native mirror of the web
/// <c>AppearanceSettings</c>. The diagnostics <see cref="Slug"/> is the stable surface identifier emitted
/// with the <c>view.opened</c> event (P1/S11 diagnostics contract); the localized <see cref="Name"/> /
/// <see cref="Description"/> back the surface's Narrator name and any host chrome.
/// </summary>
public static class AppearanceSettingsRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "appearance-settings";

    /// <summary>Surface category (the web component lives under the settings feature).</summary>
    public const string Category = "settings";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AppearanceSettings";

    /// <summary>Localized surface display name (web <c>t('theme.title', 'Appearance')</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("theme.title", "Appearance");
    }

    /// <summary>Localized surface description (web <c>t('theme.subtitle', …)</c>).</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("theme.subtitle", "Customize colors and display mode");
    }
}

/// <summary>
/// Pure projection from the parsed server settings + local preferences to the render-ready
/// <see cref="AppearanceSettingsDisplay"/> — the native port of the render logic in
/// web/src/features/settings/components/AppearanceSettings.tsx. Every title, choice label, help string,
/// preview row and tour label resolves through the i18n facade with the web English literal as the fallback
/// (so the resource keys are asserted in tests and resolved for real in the app), and the active selection
/// for each group is computed from the current preference. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class AppearanceSettingsProjection
{
    /// <summary>Project the current settings + preferences into the render-ready display.</summary>
    /// <param name="settings">The parsed server-side appearance settings.</param>
    /// <param name="preferences">The per-device local preferences.</param>
    /// <param name="serverControlsEnabled">Whether the server-driven choice groups are interactive.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static AppearanceSettingsDisplay Project(
        AppearanceServerSettings settings,
        AppearanceLocalPreferences preferences,
        bool serverControlsEnabled,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = localizer.GetString("theme.title", "Appearance");
        var subtitle = localizer.GetString("theme.subtitle", "Customize colors and display mode");

        return new AppearanceSettingsDisplay(
            title,
            subtitle,
            ProjectTheme(localizer),
            ProjectDensity(settings.Density, localizer),
            ProjectSidebar(preferences.SidebarStyle, localizer),
            ProjectTimeFormat(settings.TimeFormat, localizer),
            ProjectChartPalette(settings.ChartPalette, localizer),
            ProjectStatusBar(preferences, localizer),
            ProjectCelebration(preferences, localizer),
            ProjectTours(localizer),
            serverControlsEnabled,
            title);
    }

    private static ThemePickerLabels ProjectTheme(ILocalizer localizer) => new(
        localizer.GetString("theme.mode.label", "Theme"),
        localizer.GetString("theme.mode.system", "System"),
        localizer.GetString("theme.mode.light", "Light"),
        localizer.GetString("theme.mode.dark", "Dark"),
        localizer.GetString("theme.mode.highContrast", "High contrast"));

    private static DensitySection ProjectDensity(DensityChoice active, ILocalizer localizer)
    {
        var options = new[]
        {
            DensityCard(DensityChoice.Compact, active, "theme.density.compact", "Compact",
                "theme.density.compactHelp", "Tight rows \u2014 fits more on screen", localizer),
            DensityCard(DensityChoice.Comfortable, active, "theme.density.comfortable", "Comfortable",
                "theme.density.comfortableHelp", "Default sizing", localizer),
            DensityCard(DensityChoice.Spacious, active, "theme.density.spacious", "Spacious",
                "theme.density.spaciousHelp", "Roomy \u2014 easier to read at distance", localizer),
        };

        var previewRows = new[]
        {
            localizer.GetString("theme.density.previewRow1", "Sample row \u2014 Tesla Model 3"),
            localizer.GetString("theme.density.previewRow2", "Sample row \u2014 Tesla Model Y"),
            localizer.GetString("theme.density.previewRow3", "Sample row \u2014 Tesla Model S"),
        };

        return new DensitySection(
            localizer.GetString("theme.density.label", "Information density"),
            localizer.GetString("theme.density.help", "Affects table rows, cards, and dashboard widgets across the app."),
            options,
            localizer.GetString("theme.density.previewTitle", "Preview"),
            previewRows);
    }

    private static DensityOption DensityCard(
        DensityChoice id, DensityChoice active, string labelKey, string labelFallback,
        string helpKey, string helpFallback, ILocalizer localizer)
    {
        var label = localizer.GetString(labelKey, labelFallback);
        var help = localizer.GetString(helpKey, helpFallback);
        return new DensityOption(id, label, help, id == active, AutomationName(label, help));
    }

    private static SidebarSection ProjectSidebar(SidebarStyleChoice active, ILocalizer localizer)
    {
        var options = new[]
        {
            SidebarCard(SidebarStyleChoice.Linear, active, "theme.sidebarStyle.linear", "Minimal",
                "theme.sidebarStyle.linearHelp",
                "Single column with section headers and a 2px accent bar on the active row. Recommended.", localizer),
            SidebarCard(SidebarStyleChoice.Notion, active, "theme.sidebarStyle.notion", "Compact",
                "theme.sidebarStyle.notionHelp",
                "Tighter rows with collapsible sections. Best for fitting many pages on screen.", localizer),
            SidebarCard(SidebarStyleChoice.Legacy, active, "theme.sidebarStyle.legacy", "Classic",
                "theme.sidebarStyle.legacyHelp",
                "Colorful icon tiles with a pill on the active item. The most visual option.", localizer),
        };

        return new SidebarSection(
            localizer.GetString("theme.sidebarStyle.label", "Sidebar style"),
            localizer.GetString("theme.sidebarStyle.help",
                "Applies instantly. Saved per device \u2014 your other devices keep their own choice."),
            options);
    }

    private static SidebarOption SidebarCard(
        SidebarStyleChoice id, SidebarStyleChoice active, string labelKey, string labelFallback,
        string helpKey, string helpFallback, ILocalizer localizer)
    {
        var label = localizer.GetString(labelKey, labelFallback);
        var help = localizer.GetString(helpKey, helpFallback);
        return new SidebarOption(id, label, help, id == active, AutomationName(label, help));
    }

    private static TimeFormatSection ProjectTimeFormat(TimeFormatChoice active, ILocalizer localizer)
    {
        var options = new[]
        {
            TimeFormatCard(TimeFormatChoice.Relative, active, "theme.timeFormat.relative", "Relative (2h ago)",
                "theme.timeFormat.relativeHelp", "Best for recent activity feeds", localizer),
            TimeFormatCard(TimeFormatChoice.Absolute, active, "theme.timeFormat.absolute", "Absolute (Nov 12, 13:42)",
                "theme.timeFormat.absoluteHelp", "Best for trip planning and event correlation", localizer),
        };

        return new TimeFormatSection(
            localizer.GetString("theme.timeFormat.label", "Default time format"),
            localizer.GetString("theme.timeFormat.help",
                "Hover any timestamp to see the alternate format. Override per-surface with the format prop where needed."),
            options);
    }

    private static TimeFormatOption TimeFormatCard(
        TimeFormatChoice id, TimeFormatChoice active, string labelKey, string labelFallback,
        string helpKey, string helpFallback, ILocalizer localizer)
    {
        var label = localizer.GetString(labelKey, labelFallback);
        var help = localizer.GetString(helpKey, helpFallback);
        return new TimeFormatOption(id, label, help, id == active, AutomationName(label, help));
    }

    private static ChartPaletteSection ProjectChartPalette(ChartPaletteChoice active, ILocalizer localizer)
    {
        var options = new[]
        {
            PaletteCard(ChartPaletteChoice.CbSafe, active, "theme.chartPalette.cbSafe", "Color-blind safe",
                "theme.chartPalette.cbSafeHelp", "Okabe-Ito palette \u2014 distinguishable for all CVD types.", localizer),
            PaletteCard(ChartPaletteChoice.Neon, active, "theme.chartPalette.neon", "Stylistic neon",
                "theme.chartPalette.neonHelp", "Bright cyan/magenta \u2014 best when colour vision is unimpaired.", localizer),
        };

        return new ChartPaletteSection(
            localizer.GetString("theme.chartPalette.label", "Chart palette"),
            localizer.GetString("theme.chartPalette.help",
                "Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users with red-green colour vision deficiency."),
            options);
    }

    private static ChartPaletteOption PaletteCard(
        ChartPaletteChoice id, ChartPaletteChoice active, string labelKey, string labelFallback,
        string helpKey, string helpFallback, ILocalizer localizer)
    {
        var label = localizer.GetString(labelKey, labelFallback);
        var help = localizer.GetString(helpKey, helpFallback);
        return new ChartPaletteOption(id, label, help, id == active, AppearancePalettes.For(id), AutomationName(label, help));
    }

    private static StatusBarSection ProjectStatusBar(AppearanceLocalPreferences prefs, ILocalizer localizer)
    {
        var show = ToggleRow(
            "theme.statusBar.show", "Show status bar",
            "theme.statusBar.showHelp", "Always-on footer with API health, live telemetry, vehicle, and version.",
            prefs.StatusBarEnabled, enabled: true, localizer);

        // Web parity: the icon-only row dims (aria-disabled) when the status bar itself is hidden.
        var iconOnly = ToggleRow(
            "theme.statusBar.iconOnly", "Always icon-only",
            "theme.statusBar.iconOnlyHelp",
            "Hide labels at all widths. Otherwise the bar auto-collapses on narrow screens.",
            prefs.StatusBarIconOnly, enabled: prefs.StatusBarEnabled, localizer);

        return new StatusBarSection(localizer.GetString("theme.statusBar.label", "Status bar"), show, iconOnly);
    }

    private static CelebrationSection ProjectCelebration(AppearanceLocalPreferences prefs, ILocalizer localizer)
    {
        var showToasts = ToggleRow(
            "achievements.showToasts", "Show celebration toasts",
            "achievements.showToastsHelp", "Pop a celebratory toast with confetti when you unlock an achievement.",
            prefs.CelebrationShowToasts, enabled: true, localizer);

        var playSound = ToggleRow(
            "achievements.playSound", "Play sound on unlock",
            "achievements.playSoundHelp", "Play a short chime alongside the celebration toast. Off by default.",
            prefs.CelebrationPlaySound, enabled: true, localizer);

        var showOnDashboard = ToggleRow(
            "achievements.showOnDashboard", "Show recently unlocked on dashboard",
            "achievements.showOnDashboardHelp",
            "Surface your latest unlocks in the dashboard's recently-unlocked widget.",
            prefs.CelebrationShowOnDashboard, enabled: true, localizer);

        var pushOnUnlock = ToggleRow(
            "achievements.pushOnUnlock", "Send push notifications for achievements",
            "achievements.pushOnUnlockHelp",
            "Deliver a web push notification when an achievement unlocks while the tab is closed.",
            prefs.CelebrationPushOnUnlock, enabled: true, localizer);

        return new CelebrationSection(
            localizer.GetString("achievements.celebrationSettings", "Celebration"),
            showToasts, playSound, showOnDashboard, pushOnUnlock);
    }

    private static ToursSection ProjectTours(ILocalizer localizer)
    {
        var buttons = new[]
        {
            new TourButton(TourAction.ReplayMain,
                localizer.GetString("settings.tours.replayMain", "Replay dashboard tour"),
                ButtonVariant.Primary, "\uE768"),
            new TourButton(TourAction.ReplayDebugger,
                localizer.GetString("settings.tours.replayDebugger", "Debugger tour"),
                ButtonVariant.Subtle, string.Empty),
            new TourButton(TourAction.ReplayAutomations,
                localizer.GetString("settings.tours.replayAutomations", "Automations tour"),
                ButtonVariant.Subtle, string.Empty),
            new TourButton(TourAction.ResetAll,
                localizer.GetString("settings.tours.resetAll", "Reset all tours"),
                ButtonVariant.Destructive, "\uE72C"),
        };

        return new ToursSection(
            localizer.GetString("settings.tours.label", "Product tours"),
            localizer.GetString("settings.tours.title", "Product tours"),
            localizer.GetString("settings.tours.body", "Re-run the guided walkthroughs that introduce major sections."),
            buttons);
    }

    private static AppearanceToggleRow ToggleRow(
        string labelKey, string labelFallback, string helpKey, string helpFallback,
        bool isOn, bool enabled, ILocalizer localizer)
    {
        var label = localizer.GetString(labelKey, labelFallback);
        var help = localizer.GetString(helpKey, helpFallback);
        return new AppearanceToggleRow(label, help, isOn, enabled, AutomationName(label, help));
    }

    private static string AutomationName(string label, string help) =>
        string.Create(CultureInfo.CurrentCulture, $"{label}. {help}");
}

/// <summary>
/// PII-safe diagnostics for the Appearance surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a preference value or any user data —
/// so a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class AppearanceSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public AppearanceSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AppearanceSettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AppearanceSettingsRegistration.Slug}");
    }
}
