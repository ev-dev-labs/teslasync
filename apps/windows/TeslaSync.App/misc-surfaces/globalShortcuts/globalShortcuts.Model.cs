using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// Canonical metadata for the <c>globalShortcuts</c> misc surface — the native mirror of the web seeder at
/// <c>web/src/lib/globalShortcuts.tsx</c>. The web source is a registry seeder that returns <c>null</c>: on
/// mount it pours the four universal app keys, the <c>GOTO_SHORTCUTS</c> navigation table and the
/// <c>commandRegistry</c> entries that declare a shortcut into the shared registry, each tagged with one of
/// three already-translated groups (Actions / Navigation / Commands). This holder pins the diagnostics slug
/// and every group / title / empty string's i18n key + English fallback (the fallbacks mirror
/// Strings/en/Resources.resw so the headless projection asserts the rendered copy). The per-entry description
/// keys live on the <see cref="GlobalShortcutsCatalog"/> data. UI-free so the metadata is asserted without a
/// XAML host.
/// </summary>
public static class GlobalShortcutsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "globalShortcuts";

    /// <summary>i18n key for the "Actions" group (web <c>shortcuts.groups.actions</c>).</summary>
    public const string ActionsGroupKey = "translation.shortcuts.groups.actions";

    /// <summary>English fallback for <see cref="ActionsGroupKey"/>.</summary>
    public const string ActionsGroupFallback = "Actions";

    /// <summary>i18n key for the "Navigation" group (web <c>shortcuts.groups.navigation</c>).</summary>
    public const string NavigationGroupKey = "translation.shortcuts.groups.navigation";

    /// <summary>English fallback for <see cref="NavigationGroupKey"/> (note the trailing ellipsis U+2026).</summary>
    public const string NavigationGroupFallback = "Navigation (press g then…)";

    /// <summary>i18n key for the "Commands" group (web <c>shortcuts.groups.commands</c>).</summary>
    public const string CommandsGroupKey = "translation.shortcuts.groups.commands";

    /// <summary>English fallback for <see cref="CommandsGroupKey"/>.</summary>
    public const string CommandsGroupFallback = "Commands";

    /// <summary>
    /// i18n key for the navigation description template (web <c>shortcuts.goto</c>, <c>{0}</c> = destination
    /// label). The web uses the named token <c>{{label}}</c>; the resw catalogue uses the positional
    /// <c>{0}</c>.
    /// </summary>
    public const string GotoTemplateKey = "translation.shortcuts.goto";

    /// <summary>English fallback for <see cref="GotoTemplateKey"/> (<c>{0}</c> = destination label).</summary>
    public const string GotoTemplateFallback = "Go to {0}";

    /// <summary>i18n key for the surface title (web cheatsheet <c>shortcuts.title</c>).</summary>
    public const string TitleKey = "translation.shortcuts.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Keyboard Shortcuts";

    /// <summary>i18n key for the defensive empty surface (no global shortcuts in the catalogue).</summary>
    public const string EmptyKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No data available";

    /// <summary>Surface title (web cheatsheet <c>t('shortcuts.title', 'Keyboard Shortcuts')</c>).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Defensive empty-surface message (web <c>t('common.noData', 'No data available')</c>).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }
}

/// <summary>
/// The mutually-exclusive surface state. The web source's data sources are a synchronous in-process
/// translation lookup (<c>useTranslation</c>) and the in-process shortcut registry it seeds
/// (<c>useShortcut</c>) — it runs no fetch, query, cache or connectivity check and returns <c>null</c>. So,
/// exactly like the sibling <c>KeyboardShortcutsModal</c> / <c>TourLauncher</c> surfaces, the only states are
/// the populated grouped list and a defensive empty surface (the catalogue produced no definitions — never a
/// blank box). There is deliberately no loading / error / stale / offline branch: those would be fabricated
/// behavior the web source does not have (it composes no network read).
/// </summary>
public enum GlobalShortcutsState
{
    /// <summary>At least one global shortcut is listed (the web seeder's populated set).</summary>
    Ready,

    /// <summary>The catalogue produced no definitions — the friendly defensive empty surface.</summary>
    Empty,
}

/// <summary>
/// The render-ready view of the whole surface — the localized <see cref="Title"/>, the grouped, ordered
/// shortcut <see cref="Groups"/> (reusing the shared <see cref="ShortcutGroup"/> projection so the native
/// global-shortcuts panel renders in exactly the same group order as the <c>KeyboardShortcutsModal</c>
/// cheatsheet), the defensive <see cref="EmptyMessage"/> and the composed Narrator <see cref="AutomationName"/>.
/// <see cref="State"/> is <see cref="GlobalShortcutsState.Empty"/> only when the catalogue is empty. Pure data
/// so every field is asserted without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state.</param>
/// <param name="Title">The localized surface title.</param>
/// <param name="Groups">The grouped, ordered shortcut rows (web groups, ranked Navigation → Actions → Commands).</param>
/// <param name="EmptyMessage">The localized defensive empty-surface message.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record GlobalShortcutsDisplay(
    GlobalShortcutsState State,
    string Title,
    IReadOnlyList<ShortcutGroup> Groups,
    string EmptyMessage,
    string AutomationName)
{
    /// <summary>Total shortcut rows across every group.</summary>
    public int ShortcutCount => Groups.Sum(static g => g.Shortcuts.Count);

    /// <summary>True when at least one shortcut is listed (web <c>defs.length &gt; 0</c>).</summary>
    public bool HasShortcuts => ShortcutCount > 0;
}

/// <summary>
/// Pure projection from the built global-shortcut definitions to the render-ready
/// <see cref="GlobalShortcutsDisplay"/> — the native port of how the web seeder's definitions surface in the
/// cheatsheet. It groups + orders the definitions through the shared <see cref="ShortcutProjection"/> (so the
/// native global-shortcuts panel matches the cheatsheet's grouping exactly: every entry is global, so none is
/// route-gated and no search is applied), resolves the title + empty copy through the i18n facade, and composes
/// the Narrator name. No WinUI types — unit tested without a UI host.
/// </summary>
public static class GlobalShortcutsProjection
{
    /// <summary>
    /// Project <paramref name="definitions"/> into the render-ready display, grouping + ordering through
    /// <see cref="ShortcutProjection"/> (mode <see cref="ShortcutFilterMode.All"/>, root path, no search — every
    /// definition is global) and resolving the title + empty copy through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="definitions">The built global-shortcut definitions (see <see cref="GlobalShortcutsCatalog.Build"/>).</param>
    /// <param name="localizer">The i18n facade the title + empty copy resolve through.</param>
    public static GlobalShortcutsDisplay Project(
        IReadOnlyList<ShortcutDefinition> definitions,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(definitions);
        ArgumentNullException.ThrowIfNull(localizer);

        // Every global-shortcut entry is scope=global, so it is never route-gated; mode All + no search keeps
        // them all and the shared projection handles the group rank + per-group id ordering.
        IReadOnlyList<ShortcutGroup> groups =
            ShortcutProjection.Project(definitions, ShortcutFilterMode.All, "/", string.Empty);

        string title = GlobalShortcutsRegistration.Title(localizer);
        string empty = GlobalShortcutsRegistration.EmptyMessage(localizer);

        GlobalShortcutsState state = groups.Count == 0 ? GlobalShortcutsState.Empty : GlobalShortcutsState.Ready;
        string automationName = state == GlobalShortcutsState.Empty
            ? string.Create(CultureInfo.CurrentCulture, $"{title}. {empty}")
            : title;

        return new GlobalShortcutsDisplay(state, title, groups, empty, automationName);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>globalShortcuts</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> counter with the surface slug — never a shortcut id, key, route or fleet
/// datum — so a diagnostics line can never leak user data. Thread-safe.
/// </summary>
public sealed class GlobalShortcutsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public GlobalShortcutsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened (activated).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=globalShortcuts</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GlobalShortcutsRegistration.Slug}");
    }
}
