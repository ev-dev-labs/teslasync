using System.Collections.Generic;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One bottom-tab destination — the native port of a single entry in the web
/// <c>BottomTabBar</c>'s hard-coded <c>TABS</c> array
/// (web/src/components/layout/BottomTabBar.tsx). Each entry pairs the route the tab navigates to
/// (web <c>tab.path</c>, also the active-state identity key) with the Segoe Fluent Icons glyph that
/// stands in for the web Lucide icon, and the i18n key plus verbatim English fallback the web source
/// passes to <c>t(tab.i18nKey, tab.fallback)</c> for both the visible label and the accessible name.
/// </summary>
/// <param name="Path">Route the tab navigates to and highlights on (web <c>tab.path</c>).</param>
/// <param name="Glyph">Segoe Fluent Icons code point shown above the label (native stand-in for the web Lucide icon).</param>
/// <param name="TitleKey">i18n key resolved through the facade for the label + accessible name (web <c>tab.i18nKey</c>).</param>
/// <param name="Fallback">Verbatim English fallback for <see cref="TitleKey"/> (web <c>tab.fallback</c>).</param>
public sealed record BottomTab(string Path, string Glyph, string TitleKey, string Fallback);

/// <summary>
/// The canonical bottom-tab catalogue — the native single-source-of-truth port of the web
/// <c>BottomTabBar</c>'s module-level <c>TABS</c> constant (web/src/components/layout/BottomTabBar.tsx):
/// the top-five most-trafficked owner routes, in order, Dashboard → Drives → Charging → Battery → Map.
///
/// <para>
/// The active-location data the bar reads is NOT defined here: it flows through the shared
/// <see cref="INavLocationSource"/> active-location seam (P1/S8) — the native unification of the web
/// <c>useLocation()</c> hook, shared verbatim with the sibling <c>LinearSidebar</c> surface so every
/// chrome surface reads one current-path source. The view never touches the router; the
/// <see cref="BottomTabBarViewModel"/> reads the seam and re-projects on change.
/// </para>
///
/// <para>
/// Each glyph is the same Segoe Fluent Icons code point the shell's route table already assigns to that
/// route, so the bottom bar's icons stay consistent with the sidebar and command surfaces. The i18n
/// keys and English fallbacks are copied verbatim from the web <c>t(key, fallback)</c> calls; every key
/// resolves against the P1/S10 catalog (<c>Strings/{lang}/Resources.resw</c>) and falls back to the
/// English literal headlessly. UI-free so the catalogue is asserted without a XAML host.
/// </para>
/// </summary>
public static class BottomTabBarCatalog
{
    /// <summary>
    /// The five tabs, in render order. <c>IReadOnlyList</c> so callers (the view-model, tests) enumerate
    /// the fixed catalogue without mutating it, mirroring the web <c>const TABS</c> being a frozen module
    /// constant.
    /// </summary>
    public static IReadOnlyList<BottomTab> Default { get; } = new[]
    {
        // web: { path: '/', icon: Home, i18nKey: 'nav.dashboard', fallback: 'Home' } — shell route glyph \uE80F.
        new BottomTab("/", "\uE80F", "translation.nav.dashboard", "Home"),

        // web: { path: '/drives', icon: Car, i18nKey: 'nav.drives', fallback: 'Drives' } — shell route glyph \uE7C0.
        new BottomTab("/drives", "\uE7C0", "translation.nav.drives", "Drives"),

        // web: { path: '/charging', icon: BatteryCharging, i18nKey: 'nav.charging', fallback: 'Charging' } — shell glyph \uE945.
        new BottomTab("/charging", "\uE945", "translation.nav.charging", "Charging"),

        // web: { path: '/battery', icon: HeartPulse, i18nKey: 'nav.battery', fallback: 'Battery' } — shell glyph \uE83E.
        new BottomTab("/battery", "\uE83E", "translation.nav.battery", "Battery"),

        // web: { path: '/live', icon: MapPin, i18nKey: 'nav.liveMap', fallback: 'Map' } — shell route glyph \uE707.
        new BottomTab("/live", "\uE707", "translation.nav.liveMap", "Map"),
    };
}
