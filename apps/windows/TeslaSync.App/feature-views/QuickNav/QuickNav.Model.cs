using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The outbound navigation seam the <c>QuickNav</c> feature surface drives — the native analogue of the web
/// react-router <c>&lt;Link to="…"&gt;</c> in web/src/features/dashboard/components/QuickNav.tsx. The view
/// never touches the shell directly; activating a tile calls <see cref="Navigate(string)"/> with the
/// canonical W3 route name and the host wires this to the in-app navigation (resolving the route name to its
/// path and invoking the shell). A test double records the requested route so the view's navigation
/// behaviour is verified without a shell.
/// </summary>
public interface IQuickNavNavigator
{
    /// <summary>Navigate the shell to the destination identified by <paramref name="routeName"/>.</summary>
    /// <param name="routeName">The stable W3 route name (e.g. <c>Drives</c>, <c>Charging</c>).</param>
    void Navigate(string routeName);
}

/// <summary>
/// The source of the surface's navigation entries (P1/S8 state-holder seam). <c>QuickNav</c> is
/// presentational, so the entries are the fixed catalog the web component hard-codes (<c>NAV_ITEMS</c> in
/// web/src/features/dashboard/components/QuickNav.tsx) rather than a network read — but routing the list
/// through a seam keeps the view free of literals and lets a test substitute an empty or alternate catalog
/// to exercise the empty branch.
/// </summary>
public interface IQuickNavItemSource
{
    /// <summary>The ordered navigation entries to project into tiles.</summary>
    IReadOnlyList<QuickNavItem> GetItems();
}

/// <summary>
/// The mutually-exclusive surface state for the <c>QuickNav</c> feature view. The web source
/// (web/src/features/dashboard/components/QuickNav.tsx) is a pure presentational component with no data
/// source and no asynchronous reads, so it has a single content state — <see cref="Ready"/> — plus the
/// defensive <see cref="Empty"/> branch so a degenerate empty projection renders a friendly empty surface
/// rather than a blank box. There is deliberately no loading / error / stale / offline state because the
/// web source has none (those belong to data-backed surfaces).
/// </summary>
public enum QuickNavState
{
    /// <summary>The navigation tiles are projected and ready to render (the web grid).</summary>
    Ready,

    /// <summary>No tiles resolved — render a friendly empty surface (never a blank panel).</summary>
    Empty,
}

/// <summary>
/// One canonical navigation entry — the native analogue of a web <c>NAV_ITEMS</c> record
/// (<c>{ to, icon, labelKey, label, descKey, desc, color }</c> in
/// web/src/features/dashboard/components/QuickNav.tsx). <see cref="Glyph"/> is the Segoe Fluent code point
/// standing in for the web Lucide icon (it matches the same destination's nav-pane glyph in
/// <c>RouteTable</c>), and <see cref="AccentBrushKey"/> is the semantic design token standing in for the web
/// Tailwind hex colour (no ad-hoc hex in the control layer, per the engineering guidelines).
/// <see cref="RouteName"/> is the stable W3 route identifier the tile navigates to (the native analogue of
/// the web <c>to</c> path).
/// </summary>
/// <param name="RouteName">Stable W3 route name the tile opens (web <c>to</c> path).</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="LabelKey">i18n key for the title (web <c>labelKey</c>).</param>
/// <param name="LabelFallback">English fallback title (web <c>label</c>).</param>
/// <param name="DescriptionKey">i18n key for the description (web <c>descKey</c>).</param>
/// <param name="DescriptionFallback">English fallback description (web <c>desc</c>).</param>
/// <param name="AccentBrushKey">Semantic accent token key (web Tailwind <c>color</c>).</param>
public sealed record QuickNavItem(
    string RouteName,
    string Glyph,
    string LabelKey,
    string LabelFallback,
    string DescriptionKey,
    string DescriptionFallback,
    string AccentBrushKey);

/// <summary>
/// One projected, render-ready navigation tile consumed by the WinUI view (a web rendered <c>Link</c>).
/// <see cref="Label"/> and <see cref="Description"/> are already resolved through the i18n facade
/// (web <c>t(labelKey, label)</c> / <c>t(descKey, desc)</c>), and <see cref="AutomationName"/> is the
/// Narrator name for the whole tile (label + description, mirroring the web link's accessible name). Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="RouteName">Stable W3 route name the tile opens.</param>
/// <param name="Glyph">Segoe Fluent glyph for the tinted icon.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the icon tint / chip.</param>
/// <param name="Label">Localized title.</param>
/// <param name="Description">Localized description.</param>
/// <param name="AutomationName">Narrator name for the tile (label + description).</param>
public sealed record QuickNavTile(
    string RouteName,
    string Glyph,
    string AccentBrushKey,
    string Label,
    string Description,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface — the native analogue of the web <c>QuickNav</c>
/// render output: the resolved <see cref="State"/> and the ordered list of navigation
/// <see cref="Tiles"/> (web <c>NAV_ITEMS.map</c>). The responsive column count is a width-driven view
/// concern (see <see cref="QuickNavLayout"/>), not baked into the projection. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="QuickNavState.Ready"/> / <see cref="QuickNavState.Empty"/>).</param>
/// <param name="Tiles">The ordered navigation tiles (web <c>NAV_ITEMS.map</c>).</param>
public sealed record QuickNavDisplay(QuickNavState State, IReadOnlyList<QuickNavTile> Tiles)
{
    /// <summary>True when at least one tile resolved (the web grid renders); false drives the empty surface.</summary>
    public bool HasTiles => Tiles.Count > 0;
}

/// <summary>
/// The canonical <see cref="IQuickNavItemSource"/> — the four navigation entries the web <c>QuickNav</c>
/// component renders, in the same order (Drives, Charging, Analytics, Battery). Headless and immutable, so
/// the catalog is asserted in unit tests.
/// </summary>
public sealed class QuickNavItemSource : IQuickNavItemSource
{
    /// <inheritdoc />
    public IReadOnlyList<QuickNavItem> GetItems() => QuickNavRegistration.Canonical;
}

/// <summary>
/// Pure projection from the canonical <see cref="QuickNavItem"/> list to the render-ready
/// <see cref="QuickNavDisplay"/> — the native port of the web <c>NAV_ITEMS.map</c> in
/// web/src/features/dashboard/components/QuickNav.tsx. Every label and description resolves through the i18n
/// facade; the Narrator name joins them as the web link's accessible name does. No SI conversion applies
/// (the surface carries no measurements). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QuickNavProjection
{
    /// <summary>Segoe Fluent chevron-right glyph (web <c>ChevronRight</c>).</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Project <paramref name="items"/>, resolving every label/description via <paramref name="localizer"/>.</summary>
    /// <param name="items">The navigation entries (the canonical catalog, or a test substitute).</param>
    /// <param name="localizer">The i18n facade every label and description resolves through.</param>
    public static QuickNavDisplay Project(IReadOnlyList<QuickNavItem> items, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(localizer);

        var tiles = new List<QuickNavTile>(items.Count);
        foreach (var item in items)
        {
            string label = localizer.GetString(item.LabelKey, item.LabelFallback);
            string description = localizer.GetString(item.DescriptionKey, item.DescriptionFallback);
            string automationName = string.Create(CultureInfo.CurrentCulture, $"{label}, {description}");
            tiles.Add(new QuickNavTile(
                item.RouteName,
                item.Glyph,
                item.AccentBrushKey,
                label,
                description,
                automationName));
        }

        var state = tiles.Count > 0 ? QuickNavState.Ready : QuickNavState.Empty;
        return new QuickNavDisplay(state, tiles);
    }
}

/// <summary>
/// The responsive column logic for the <c>QuickNav</c> grid — the native port of the web Tailwind classes
/// <c>grid-cols-2 sm:grid-cols-4</c> (web/src/features/dashboard/components/QuickNav.tsx). The web grid lays
/// out two columns until the container reaches the Tailwind <c>sm</c> breakpoint (640&#160;px), then four.
/// Pure arithmetic so the breakpoint is asserted without a UI host.
/// </summary>
public static class QuickNavLayout
{
    /// <summary>The Tailwind <c>sm</c> breakpoint in effective pixels (web <c>sm:</c> == 640&#160;px).</summary>
    public const double SmBreakpointPx = 640;

    /// <summary>Columns at narrow widths (web <c>grid-cols-2</c>).</summary>
    public const int NarrowColumns = 2;

    /// <summary>Columns at or above the <c>sm</c> breakpoint (web <c>sm:grid-cols-4</c>).</summary>
    public const int WideColumns = 4;

    /// <summary>
    /// The number of tile columns for an available <paramref name="width"/>: two below the <c>sm</c>
    /// breakpoint, four at or above it (web <c>grid-cols-2 sm:grid-cols-4</c>). A non-positive or
    /// not-a-number width (a control not yet measured) collapses to the narrow count so the first paint is
    /// never wider than the surface.
    /// </summary>
    public static int ColumnsForWidth(double width) =>
        double.IsNaN(width) || width < SmBreakpointPx ? NarrowColumns : WideColumns;
}

/// <summary>
/// Canonical metadata for the <c>QuickNav</c> feature surface — the native mirror of the web component at
/// web/src/features/dashboard/components/QuickNav.tsx: the stable diagnostics slug, the empty-state copy, and
/// the fixed navigation catalog (<c>NAV_ITEMS</c>) with the same Segoe Fluent glyphs, semantic accent tokens
/// and W3 route names the rest of the shell already uses for those destinations. UI-free so the metadata is
/// asserted in tests.
/// </summary>
public static class QuickNavRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "QuickNav";

    /// <summary>i18n key for the empty-state message (shown only in the defensive empty branch).</summary>
    public const string EmptyMessageKey = "widget.quickNav.noData";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyMessageFallback = "No navigation links available";

    /// <summary>i18n key for the surface's Narrator group name (the web nav region).</summary>
    public const string GroupNameKey = "widget.quickNav.title";

    /// <summary>English fallback for the surface's Narrator group name.</summary>
    public const string GroupNameFallback = "Quick Navigation";

    // Segoe Fluent Icons code points — each matches the destination's nav-pane glyph in RouteTable
    // (web Lucide icon → the platform glyph the rest of the shell already uses for that page).
    private const string DrivesGlyph = "\uE7C0";    // web Route — Drives page
    private const string ChargingGlyph = "\uE945";  // web BatteryCharging — Charging page
    private const string AnalyticsGlyph = "\uE9D9"; // web Gauge — Analytics page
    private const string BatteryGlyph = "\uE83E";   // web Activity — Battery Health page

    // Semantic accent tokens (web Tailwind hex → nearest design token; no raw hex in the control layer).
    private const string Info = "TsColorInfoBrush";       // web #00f0ff (cyan)
    private const string Success = "TsColorSuccessBrush"; // web #10b981 (green)
    private const string Accent = "TsColorAccentBrush";   // web #a855f7 (purple)
    private const string Warning = "TsColorWarningBrush"; // web #f59e0b (amber)

    /// <summary>The canonical, ordered navigation catalog (web <c>NAV_ITEMS</c>).</summary>
    public static IReadOnlyList<QuickNavItem> Canonical { get; } = new[]
    {
        new QuickNavItem("Drives", DrivesGlyph, "nav.drives", "Drives", "nav.drivesDesc", "Trip history", Info),
        new QuickNavItem("Charging", ChargingGlyph, "nav.charging", "Charging", "nav.chargingDesc", "Sessions & costs", Success),
        new QuickNavItem("Analytics", AnalyticsGlyph, "nav.analytics", "Analytics", "nav.analyticsDesc", "Fleet insights", Accent),
        new QuickNavItem("BatteryHealth", BatteryGlyph, "nav.battery", "Battery", "nav.batteryDesc", "Health & degradation", Warning),
    };

    /// <summary>The localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
    }

    /// <summary>The localized Narrator group name for the surface.</summary>
    public static string GroupName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(GroupNameKey, GroupNameFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>QuickNav</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free per-tile navigation activation with the surface
/// slug — never a route, label or any user data — so a diagnostics line can never leak operational data.
/// Thread-safe.
/// </summary>
public sealed class QuickNavDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _navigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public QuickNavDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a tile has been activated (a navigation requested).</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickNav</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuickNavRegistration.Slug}");
    }

    /// <summary>Record that a tile was activated, emitting <c>quick-nav.activated slug=QuickNav</c>.</summary>
    public void RecordNavigated()
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke($"quick-nav.activated slug={QuickNavRegistration.Slug}");
    }
}
