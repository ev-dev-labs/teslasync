using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The outbound navigation seam the <c>QuickLinksSection</c> feature surface drives — the native analogue of
/// the web react-router <c>&lt;Link to="…"&gt;</c> in
/// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx. The view never touches the shell
/// directly; activating a tile calls <see cref="Navigate(string)"/> with the canonical W3 route name and the
/// host wires this to the in-app navigation (resolving the route name to its path and invoking the shell). A
/// test double records the requested route so the view's navigation behaviour is verified without a shell.
/// </summary>
public interface IQuickLinksNavigator
{
    /// <summary>Navigate the shell to the destination identified by <paramref name="routeName"/>.</summary>
    /// <param name="routeName">The stable W3 route name (e.g. <c>Drives</c>, <c>Charging</c>).</param>
    void Navigate(string routeName);
}

/// <summary>
/// The source of the surface's quick-link entries (P1/S8 state-holder seam). <c>QuickLinksSection</c> is
/// presentational, so the entries are the fixed list the web component hard-codes (<c>quickLinks</c> in
/// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx) rather than a network read — but
/// routing the list through a seam keeps the view free of literals and lets a test substitute an empty or
/// alternate list to exercise the empty branch.
/// </summary>
public interface IQuickLinksItemSource
{
    /// <summary>The ordered quick-link entries to project into tiles.</summary>
    IReadOnlyList<QuickLinkItem> GetItems();
}

/// <summary>
/// The mutually-exclusive surface state for the <c>QuickLinksSection</c> feature view. The web source
/// (web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx) is a pure presentational
/// component with no data source and no asynchronous reads, so it has a single content state —
/// <see cref="Ready"/> — plus the defensive <see cref="Empty"/> branch so a degenerate empty projection renders
/// a friendly empty surface rather than a blank box. There is deliberately no loading / error / stale / offline
/// state because the web source has none (those belong to data-backed surfaces).
/// </summary>
public enum QuickLinksState
{
    /// <summary>The quick-link tiles are projected and ready to render (the web grid).</summary>
    Ready,

    /// <summary>No tiles resolved — render a friendly empty surface (never a blank panel).</summary>
    Empty,
}

/// <summary>
/// One canonical quick-link entry — the native analogue of a web <c>quickLinks</c> record
/// (<c>{ label, icon, to }</c> in web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx).
/// <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web Lucide icon (it matches the same
/// destination's nav-pane glyph in <c>RouteTable</c>), and <see cref="RouteName"/> is the stable W3 route
/// identifier the tile navigates to (the native analogue of the web <c>to</c> path).
/// </summary>
/// <param name="RouteName">Stable W3 route name the tile opens (web <c>to</c> path).</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="LabelKey">i18n key for the label (web <c>t()</c> key).</param>
/// <param name="LabelFallback">English fallback label (web <c>t()</c> default).</param>
public sealed record QuickLinkItem(
    string RouteName,
    string Glyph,
    string LabelKey,
    string LabelFallback);

/// <summary>
/// One projected, render-ready quick-link tile consumed by the WinUI view (a web rendered <c>Link</c>).
/// <see cref="Label"/> is already resolved through the i18n facade (web <c>t(labelKey, label)</c>), and
/// <see cref="AutomationName"/> is the Narrator name for the whole tile (the label, mirroring the web link's
/// accessible name). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="RouteName">Stable W3 route name the tile opens.</param>
/// <param name="Glyph">Segoe Fluent glyph for the icon.</param>
/// <param name="Label">Localized label.</param>
/// <param name="AutomationName">Narrator name for the tile (the label).</param>
public sealed record QuickLinkTile(
    string RouteName,
    string Glyph,
    string Label,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface — the native analogue of the web
/// <c>QuickLinksSection</c> render output: the resolved <see cref="State"/>, the localized panel
/// <see cref="Title"/> (web <c>vehicles.detail.quickLinks</c>), and the ordered list of quick-link
/// <see cref="Tiles"/> (web <c>quickLinks.map</c>). The responsive column count is a width-driven view concern
/// (see <see cref="QuickLinksLayout"/>), not baked into the projection. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="QuickLinksState.Ready"/> / <see cref="QuickLinksState.Empty"/>).</param>
/// <param name="Title">The localized panel title (web "Quick Links" header).</param>
/// <param name="Tiles">The ordered quick-link tiles (web <c>quickLinks.map</c>).</param>
public sealed record QuickLinksDisplay(QuickLinksState State, string Title, IReadOnlyList<QuickLinkTile> Tiles)
{
    /// <summary>True when at least one tile resolved (the web grid renders); false drives the empty surface.</summary>
    public bool HasTiles => Tiles.Count > 0;
}

/// <summary>
/// The canonical <see cref="IQuickLinksItemSource"/> — the six quick-link entries the web
/// <c>QuickLinksSection</c> component renders, in the same order (Drives, Charging, Battery, Climate,
/// Efficiency, Settings). Headless and immutable, so the list is asserted in unit tests.
/// </summary>
public sealed class QuickLinksItemSource : IQuickLinksItemSource
{
    /// <inheritdoc />
    public IReadOnlyList<QuickLinkItem> GetItems() => QuickLinksRegistration.Canonical;
}

/// <summary>
/// Pure projection from the canonical <see cref="QuickLinkItem"/> list to the render-ready
/// <see cref="QuickLinksDisplay"/> — the native port of the web <c>quickLinks.map</c> in
/// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx. The panel title and every label
/// resolve through the i18n facade; the Narrator name mirrors the web link's accessible name. No SI conversion
/// applies (the surface carries no measurements). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QuickLinksProjection
{
    /// <summary>Segoe Fluent chevron-right glyph (web <c>ChevronRight</c> header icon).</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Project <paramref name="items"/>, resolving the title and every label via <paramref name="localizer"/>.</summary>
    /// <param name="items">The quick-link entries (the canonical list, or a test substitute).</param>
    /// <param name="localizer">The i18n facade the title and every label resolve through.</param>
    public static QuickLinksDisplay Project(IReadOnlyList<QuickLinkItem> items, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(localizer);

        var tiles = new List<QuickLinkTile>(items.Count);
        foreach (var item in items)
        {
            string label = localizer.GetString(item.LabelKey, item.LabelFallback);
            tiles.Add(new QuickLinkTile(item.RouteName, item.Glyph, label, label));
        }

        var state = tiles.Count > 0 ? QuickLinksState.Ready : QuickLinksState.Empty;
        return new QuickLinksDisplay(state, QuickLinksRegistration.Title(localizer), tiles);
    }
}

/// <summary>
/// The responsive column logic for the <c>QuickLinksSection</c> grid — the native port of the web Tailwind
/// classes <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-6</c>
/// (web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx). The web grid lays out two
/// columns until the container reaches the Tailwind <c>sm</c> breakpoint (640&#160;px), three until the
/// <c>lg</c> breakpoint (1024&#160;px), then six. Pure arithmetic so the breakpoints are asserted without a UI
/// host.
/// </summary>
public static class QuickLinksLayout
{
    /// <summary>The Tailwind <c>sm</c> breakpoint in effective pixels (web <c>sm:</c> == 640&#160;px).</summary>
    public const double SmBreakpointPx = 640;

    /// <summary>The Tailwind <c>lg</c> breakpoint in effective pixels (web <c>lg:</c> == 1024&#160;px).</summary>
    public const double LgBreakpointPx = 1024;

    /// <summary>Columns at narrow widths (web <c>grid-cols-2</c>).</summary>
    public const int NarrowColumns = 2;

    /// <summary>Columns at the <c>sm</c> breakpoint (web <c>sm:grid-cols-3</c>).</summary>
    public const int MediumColumns = 3;

    /// <summary>Columns at or above the <c>lg</c> breakpoint (web <c>lg:grid-cols-6</c>).</summary>
    public const int WideColumns = 6;

    /// <summary>
    /// The number of tile columns for an available <paramref name="width"/>: two below the <c>sm</c>
    /// breakpoint, three between the <c>sm</c> and <c>lg</c> breakpoints, six at or above <c>lg</c>
    /// (web <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-6</c>). A non-positive or not-a-number width (a control
    /// not yet measured) collapses to the narrow count so the first paint is never wider than the surface.
    /// </summary>
    public static int ColumnsForWidth(double width)
    {
        if (double.IsNaN(width) || width < SmBreakpointPx)
        {
            return NarrowColumns;
        }

        return width < LgBreakpointPx ? MediumColumns : WideColumns;
    }
}

/// <summary>
/// Canonical metadata for the <c>QuickLinksSection</c> feature surface — the native mirror of the web component
/// at web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx: the stable diagnostics slug,
/// the panel title, the empty-state copy, and the fixed quick-link list (<c>quickLinks</c>) with the same Segoe
/// Fluent glyphs and W3 route names the rest of the shell already uses for those destinations. UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class QuickLinksRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "QuickLinksSection";

    /// <summary>i18n key for the panel title (web <c>vehicles.detail.quickLinks</c>); also the Narrator group name.</summary>
    public const string TitleKey = "vehicles.detail.quickLinks";

    /// <summary>English fallback for the panel title (web <c>t()</c> default).</summary>
    public const string TitleFallback = "Quick Links";

    /// <summary>i18n key for the empty-state message (shown only in the defensive empty branch).</summary>
    public const string EmptyMessageKey = "vehicles.detail.quickLinks.noData";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyMessageFallback = "No quick links available";

    // Segoe Fluent Icons code points — each matches the destination's nav-pane glyph in RouteTable
    // (web Lucide icon -> the platform glyph the rest of the shell already uses for that page). Climate uses
    // the shared thermometer glyph (web Thermometer) so it stays distinct from the Settings gear.
    private const string DrivesGlyph = "\uE7C0";     // web Route — Drives page
    private const string ChargingGlyph = "\uE945";   // web BatteryCharging — Charging page
    private const string BatteryGlyph = "\uE83E";    // web Battery — Battery Health page
    private const string ClimateGlyph = "\uE9CA";    // web Thermometer — Climate Control page
    private const string EfficiencyGlyph = "\uE9D2"; // web BarChart3 — Efficiency page
    private const string SettingsGlyph = "\uE713";   // web Settings — Settings page

    /// <summary>The canonical, ordered quick-link list (web <c>quickLinks</c>).</summary>
    public static IReadOnlyList<QuickLinkItem> Canonical { get; } = new[]
    {
        new QuickLinkItem("Drives", DrivesGlyph, "nav.drives", "Drives"),
        new QuickLinkItem("Charging", ChargingGlyph, "nav.charging", "Charging"),
        new QuickLinkItem("BatteryHealth", BatteryGlyph, "nav.battery", "Battery"),
        new QuickLinkItem("ClimateControl", ClimateGlyph, "nav.climate", "Climate"),
        new QuickLinkItem("Efficiency", EfficiencyGlyph, "nav.efficiency", "Efficiency"),
        new QuickLinkItem("Settings", SettingsGlyph, "nav.settings", "Settings"),
    };

    /// <summary>The localized panel title (also used as the surface's Narrator group name).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>QuickLinksSection</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event and the data-free per-tile navigation activation with the surface slug —
/// never a route, label or any user data — so a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class QuickLinksDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _navigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public QuickLinksDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a tile has been activated (a navigation requested).</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickLinksSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={QuickLinksRegistration.Slug}"));
    }

    /// <summary>Record that a tile was activated, emitting <c>quick-links.activated slug=QuickLinksSection</c>.</summary>
    public void RecordNavigated()
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"quick-links.activated slug={QuickLinksRegistration.Slug}"));
    }
}
