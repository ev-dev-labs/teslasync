using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the BottomTabBar surface — the native mirror of the web
/// <c>BottomTabBar</c> (web/src/components/layout/BottomTabBar.tsx), the mobile bottom navigation rail
/// pinned under the viewport on small breakpoints (<c>lg:hidden</c>). The web source is presentational:
/// its destinations are the frozen module-level <c>TABS</c> constant and its only hooks are
/// <c>useLocation</c> (the active-path source) and <c>useTranslation</c> (i18n), so it performs no data
/// fetch — and therefore renders no loading / error / stale / offline chrome to reproduce. This metadata
/// carries the diagnostics slug the surface registers under and the navigation-landmark i18n
/// key/fallback the web source passes to <c>t('nav.quickNav', 'Quick navigation')</c>; the per-tab keys
/// live verbatim on each <see cref="BottomTab"/> in the catalogue. Each key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class BottomTabBarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "BottomTabBar";

    /// <summary>i18n key for the navigation landmark accessible name (web <c>t('nav.quickNav', 'Quick navigation')</c>).</summary>
    public const string QuickNavKey = "translation.nav.quickNav";

    /// <summary>English fallback for <see cref="QuickNavKey"/> (web second arg, verbatim).</summary>
    public const string QuickNavFallback = "Quick navigation";

    /// <summary>The root route whose tab is active only on an exact match (web <c>tab.path === '/'</c>).</summary>
    public const string RootPath = "/";

    /// <summary>
    /// i18n key for the defensive empty-state copy. The web bar has no empty state (its <c>TABS</c> are a
    /// fixed non-empty constant), but the native surface still renders a friendly message instead of a blank
    /// bar if it is ever handed an empty catalogue — never a blank box. Reuses the shared catalog key
    /// <c>common.noData</c> so no new string is introduced.
    /// </summary>
    public const string EmptyMessageKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No data available";
}

/// <summary>
/// One render-ready tab — the pure projection of a <see cref="BottomTab"/> against the current path and
/// the i18n facade. <see cref="Label"/> is the localized text shown under the glyph AND the tab's
/// accessible name (the web source sets both the <c>&lt;span&gt;</c> text and the link's
/// <c>aria-label</c> from the same <c>t(tab.i18nKey, tab.fallback)</c> value). <see cref="IsActive"/> is
/// the web <c>isActive</c> branch — it drives the accent foreground, the icon glow, the bottom accent
/// pill and the <c>aria-current="page"</c> state.
/// </summary>
/// <param name="Path">Route the tab navigates to (web <c>tab.path</c>); the click intent + active key.</param>
/// <param name="Glyph">Segoe Fluent Icons code point shown above the label.</param>
/// <param name="Label">Localized label + accessible name (web <c>t(tab.i18nKey, tab.fallback)</c>).</param>
/// <param name="IsActive">Whether the current path resolves to this tab (web <c>isActive</c>).</param>
public sealed record BottomTabDisplay(string Path, string Glyph, string Label, bool IsActive);

/// <summary>
/// The render-ready projection of the whole bar — the localized navigation-landmark name plus the
/// ordered, already-resolved tabs. <see cref="IsEmpty"/> is true only when the catalogue is empty (the
/// fixed web <c>TABS</c> never is, but the surface still renders a friendly empty state instead of a
/// blank bar so a region never collapses silently); the web source has no loading / error / stale /
/// offline projection because it performs no fetch.
/// </summary>
/// <param name="NavAutomationName">Localized navigation-landmark accessible name (web <c>aria-label</c> on the <c>&lt;nav&gt;</c>).</param>
/// <param name="Tabs">The ordered, projected tabs (web <c>TABS.map(...)</c>).</param>
/// <param name="IsEmpty">Whether there are no tabs to render (drives the empty state).</param>
/// <param name="EmptyMessage">Localized friendly empty-state copy shown when <paramref name="IsEmpty"/> is true.</param>
public sealed record BottomTabBarDisplay(
    string NavAutomationName,
    IReadOnlyList<BottomTabDisplay> Tabs,
    bool IsEmpty,
    string EmptyMessage);

/// <summary>
/// The pure, UI-thread-free projection behind the BottomTabBar view — the native unification of the web
/// source's <c>isActive</c> computation and its <c>TABS.map</c> render loop. It owns the active-path rule
/// verbatim and resolves every label through the i18n facade, so the view-model and tests share one
/// render contract and the view only data-binds the result. Stateless; safe to call from any thread.
/// </summary>
public static class BottomTabBarProjection
{
    /// <summary>
    /// Whether <paramref name="tabPath"/> is the active tab for <paramref name="currentPath"/> — the web
    /// <c>isActive</c> rule verbatim: the root route ("/") matches only an exact path, while every other
    /// tab matches an exact path OR a descendant path (<c>pathname.startsWith(tab.path + '/')</c>) so
    /// nested routes such as <c>/drives/42</c> keep the Drives tab lit. Ordinal throughout — route paths
    /// are culture-invariant identifiers, never display text.
    /// </summary>
    public static bool IsActive(string? currentPath, string tabPath)
    {
        ArgumentNullException.ThrowIfNull(tabPath);
        string path = Normalize(currentPath);

        if (string.Equals(tabPath, BottomTabBarRegistration.RootPath, StringComparison.Ordinal))
        {
            return string.Equals(path, BottomTabBarRegistration.RootPath, StringComparison.Ordinal);
        }

        return string.Equals(path, tabPath, StringComparison.Ordinal)
            || path.StartsWith(tabPath + "/", StringComparison.Ordinal);
    }

    /// <summary>
    /// Project the catalogue against the current path and the i18n facade into the render-ready
    /// <see cref="BottomTabBarDisplay"/> — the native <c>TABS.map</c>. Resolves the navigation-landmark
    /// name and each tab's label/active state once so the view performs no logic. Recomputed on demand
    /// (the catalogue is five entries) so it always reflects the latest path and language.
    /// </summary>
    /// <param name="tabs">The tab catalogue (web <c>TABS</c>); typically <see cref="BottomTabBarCatalog.Default"/>.</param>
    /// <param name="currentPath">The live route path (web <c>location.pathname</c>); null/empty normalizes to "/".</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>, P1/S10).</param>
    public static BottomTabBarDisplay Project(
        IReadOnlyList<BottomTab> tabs,
        string? currentPath,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(tabs);
        ArgumentNullException.ThrowIfNull(localizer);

        string path = Normalize(currentPath);
        string navName = localizer.GetString(
            BottomTabBarRegistration.QuickNavKey, BottomTabBarRegistration.QuickNavFallback);
        string emptyMessage = localizer.GetString(
            BottomTabBarRegistration.EmptyMessageKey, BottomTabBarRegistration.EmptyMessageFallback);

        var projected = new List<BottomTabDisplay>(tabs.Count);
        foreach (BottomTab tab in tabs)
        {
            string label = localizer.GetString(tab.TitleKey, tab.Fallback);
            bool active = IsActive(path, tab.Path);
            projected.Add(new BottomTabDisplay(tab.Path, tab.Glyph, label, active));
        }

        return new BottomTabBarDisplay(navName, projected, projected.Count == 0, emptyMessage);
    }

    /// <summary>Normalize a route path the way the web router guarantees: a null / empty path is the root "/".</summary>
    public static string Normalize(string? path) =>
        string.IsNullOrEmpty(path) ? BottomTabBarRegistration.RootPath : path;
}

/// <summary>
/// PII-safe diagnostics for the BottomTabBar surface (P1/S11 diagnostics contract). A tab bar's
/// destinations are route paths and labels that can hint at a user's feature usage, so the collector
/// records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never a
/// route or a label. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class BottomTabBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BottomTabBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BottomTabBar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={BottomTabBarRegistration.Slug}"));
    }
}
