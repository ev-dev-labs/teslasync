using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>; the
/// <see cref="ColumnCount"/> reproduces the QuickNav grid's responsive column count
/// (web <c>grid-cols-2 sm:grid-cols-4</c> in web/src/features/dashboard/components/QuickNav.tsx): two
/// columns when the surface is narrow, four when it is wide.
/// </summary>
/// <param name="Cols">Grid columns the surface spans (1–4).</param>
/// <param name="Rows">Grid rows the surface spans.</param>
public readonly record struct QuickNavSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (4×2).</summary>
    public static QuickNavSize Default => new(4, 2);

    /// <summary>
    /// The number of tile columns to lay out — two when the footprint is one or two columns wide, four
    /// once it reaches three or more (the native analogue of <c>grid-cols-2 sm:grid-cols-4</c>).
    /// </summary>
    public int ColumnCount => Cols >= 3 ? 4 : 2;
}

/// <summary>
/// The mutually-exclusive surface state for the <see cref="QuickNavViewModel"/>. QuickNav is a pure
/// presentational surface (web/src/features/dashboard/widgets/QuickNavWidget.tsx delegates to
/// <c>QuickNav</c>, which has no data source and no asynchronous reads), so it has a single content
/// state — <see cref="Ready"/> — plus the defensive <see cref="Empty"/> branch so a degenerate empty
/// projection renders a friendly empty surface rather than a blank box. There is deliberately no
/// loading / error / stale / offline state because the web source has none.
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
/// web/src/features/dashboard/components/QuickNav.tsx). <see cref="Glyph"/> is the Segoe Fluent code
/// point standing in for the web Lucide icon (it matches the same destination's nav-pane glyph in
/// <c>RouteTable</c>), and <see cref="AccentBrushKey"/> is the semantic design token standing in for the
/// web Tailwind hex colour (no ad-hoc hex in the control layer, per the engineering guidelines).
/// <see cref="RouteName"/> is the stable W3 route identifier the tile navigates to (the native analogue
/// of the web <c>to</c> path).
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
/// One projected, render-ready navigation tile consumed by the WinUI view (web rendered <c>Link</c>).
/// <see cref="Label"/> and <see cref="Description"/> are already resolved through the i18n facade
/// (web <c>t(labelKey, label)</c> / <c>t(descKey, desc)</c>), and <see cref="AutomationName"/> is the
/// Narrator name for the whole tile (label + description, mirroring the web link's accessible name).
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
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
/// The fully projected, render-ready view for one footprint — the native analogue of the web
/// <c>QuickNav</c> render output: the responsive column count and the ordered list of tiles. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Columns">The number of tile columns to lay out (web <c>grid-cols-2 sm:grid-cols-4</c>).</param>
/// <param name="Tiles">The ordered navigation tiles (web <c>NAV_ITEMS.map</c>).</param>
public sealed record QuickNavDisplay(int Columns, IReadOnlyList<QuickNavTile> Tiles);

/// <summary>
/// Canonical registry metadata for the Quick Navigation surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/system.ts (<c>quick-nav</c>). The dashboard grid
/// system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class QuickNavRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "quick-nav";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "QuickNavWidget";

    /// <summary>Default footprint: 4 columns × 2 rows.</summary>
    public static QuickNavSize DefaultSize => new(4, 2);

    /// <summary>Minimum footprint: 2 columns × 2 rows.</summary>
    public static QuickNavSize MinSize => new(2, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static QuickNavSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Quick Navigation").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.quickNav.title", "Quick Navigation");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.quickNav.description", "Shortcut links to key pages");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(QuickNavSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static QuickNavSize Clamp(QuickNavSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// Pure projection from the canonical <see cref="QuickNavItem"/> list to the render-ready
/// <see cref="QuickNavDisplay"/> — the native port of the web <c>NAV_ITEMS.map</c> in
/// web/src/features/dashboard/components/QuickNav.tsx. Every label and description resolves through the
/// i18n facade; the Narrator name joins them as the web link's accessible name does. No SI conversion
/// applies (the surface carries no measurements).
/// </summary>
public static class QuickNavProjection
{
    /// <summary>Segoe Fluent chevron-right glyph (web <c>ChevronRight</c>).</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Project <paramref name="items"/> for <paramref name="size"/>, resolving labels via <paramref name="localizer"/>.</summary>
    public static QuickNavDisplay Project(
        IReadOnlyList<QuickNavItem> items,
        QuickNavSize size,
        ILocalizer localizer)
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

        return new QuickNavDisplay(size.ColumnCount, tiles);
    }
}

/// <summary>
/// PII-safe diagnostics for the Quick Navigation surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a route, label or any user data — so
/// a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class QuickNavDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public QuickNavDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickNavWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuickNavRegistration.Slug}");
    }
}
