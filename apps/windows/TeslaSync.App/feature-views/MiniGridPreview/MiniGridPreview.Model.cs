using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One placed item in the dashboard's <c>lg</c> grid layout — the native, WinUI-free analogue of the web
/// react-grid-layout <c>RGLLayout</c> item (<c>{ i, x, y, w, h }</c> in
/// web/src/features/dashboard/widgets/types.ts) that
/// web/src/features/dashboard/components/MiniGridPreview.tsx iterates over. <see cref="Key"/> is the layout
/// item's <c>i</c> (it ties a layout cell to a <see cref="MiniGridWidgetInstance.Id"/>); the remaining fields
/// are the grid-unit position (<see cref="X"/>, <see cref="Y"/>) and span (<see cref="W"/>, <see cref="H"/>).
/// Pure data so the preview geometry is asserted headlessly.
/// </summary>
/// <param name="Key">The layout item's identity (web <c>i</c>); matches a widget instance id.</param>
/// <param name="X">Column offset in grid units (web <c>x</c>).</param>
/// <param name="Y">Row offset in grid units (web <c>y</c>).</param>
/// <param name="W">Column span in grid units (web <c>w</c>).</param>
/// <param name="H">Row span in grid units (web <c>h</c>).</param>
public sealed record MiniGridLayoutItem(string Key, int X, int Y, int W, int H);

/// <summary>
/// A widget placed on the dashboard — the native analogue of the web <c>WidgetInstance</c>
/// (<c>{ id, widgetId }</c> in web/src/features/dashboard/widgets/types.ts). The preview joins each
/// <see cref="MiniGridLayoutItem"/> to its instance by <see cref="Id"/> (web
/// <c>dashboard.widgets.find(w =&gt; w.id === item.i)</c>) and then resolves the instance's catalog icon from
/// <see cref="WidgetId"/> (web <c>getWidgetDef(widget.widgetId)?.icon</c>). Pure data.
/// </summary>
/// <param name="Id">The instance identity (web <c>id</c>); matches a layout item's <see cref="MiniGridLayoutItem.Key"/>.</param>
/// <param name="WidgetId">The catalog widget id (web <c>widgetId</c>) the icon is resolved from.</param>
public sealed record MiniGridWidgetInstance(string Id, string WidgetId);

/// <summary>
/// The render-time data model the <c>MiniGridPreview</c> surface binds to — the native projection of the parts
/// of the web <c>SavedDashboard</c> the preview reads (web/src/features/dashboard/components/MiniGridPreview.tsx
/// only touches <c>dashboard.layouts.lg</c> and <c>dashboard.widgets</c>). The web component is purely
/// presentational: it fetches nothing, so there is no loading / error / stale / offline branch to reproduce
/// here (those belong to data-backed surfaces); the only state distinction the web source itself makes is
/// populated vs. empty layout. <see cref="Layout"/> is the <c>lg</c> breakpoint layout (web
/// <c>dashboard.layouts.lg ?? []</c>) and <see cref="Widgets"/> the placed widget instances. Construct through
/// <see cref="Create"/> (or the named <see cref="Empty"/>) so the lists are never null. Unit-tested without a
/// UI host.
/// </summary>
/// <param name="Widgets">The placed widget instances (web <c>dashboard.widgets</c>).</param>
/// <param name="Layout">The <c>lg</c> grid layout items (web <c>dashboard.layouts.lg</c>).</param>
public sealed record MiniGridPreviewModel(
    IReadOnlyList<MiniGridWidgetInstance> Widgets,
    IReadOnlyList<MiniGridLayoutItem> Layout)
{
    /// <summary>The empty model — no widgets and no layout (web <c>layouts.lg ?? []</c> resolving to <c>[]</c>).</summary>
    public static MiniGridPreviewModel Empty { get; } =
        new(Array.Empty<MiniGridWidgetInstance>(), Array.Empty<MiniGridLayoutItem>());

    /// <summary>
    /// Build a model, coalescing null lists to empty so the projection mirrors the web
    /// <c>dashboard.layouts.lg ?? []</c> null-guard and never iterates a null collection.
    /// </summary>
    /// <param name="widgets">The placed widget instances, or null.</param>
    /// <param name="layout">The <c>lg</c> layout items, or null.</param>
    public static MiniGridPreviewModel Create(
        IReadOnlyList<MiniGridWidgetInstance>? widgets,
        IReadOnlyList<MiniGridLayoutItem>? layout) =>
        new(widgets ?? Array.Empty<MiniGridWidgetInstance>(), layout ?? Array.Empty<MiniGridLayoutItem>());
}

/// <summary>
/// One projected preview cell — a single web absolutely-positioned box
/// (web/src/features/dashboard/components/MiniGridPreview.tsx). The four fractions are the web inline-style
/// percentages expressed as 0..1 ratios of the container: <see cref="LeftFraction"/> is <c>x / cols</c>,
/// <see cref="TopFraction"/> is <c>y / safeMaxY</c>, <see cref="WidthFraction"/> is <c>w / cols</c> and
/// <see cref="HeightFraction"/> is <c>h / safeMaxY</c> (the view multiplies by the rendered size). They are
/// intentionally NOT clamped to [0,1], matching the web (which emits raw percentages). <see cref="IconGlyph"/>
/// is the resolved Segoe Fluent glyph for the cell's widget, or null when the widget is unknown or has no icon
/// (web <c>Icon &amp;&amp; …</c> renders nothing). Pure data.
/// </summary>
/// <param name="Key">The layout item key the cell was projected from (web <c>item.i</c>).</param>
/// <param name="LeftFraction">Left offset as a fraction of width (web <c>x / cols</c>).</param>
/// <param name="TopFraction">Top offset as a fraction of height (web <c>y / safeMaxY</c>).</param>
/// <param name="WidthFraction">Width as a fraction of width (web <c>w / cols</c>).</param>
/// <param name="HeightFraction">Height as a fraction of height (web <c>h / safeMaxY</c>).</param>
/// <param name="IconGlyph">The resolved Segoe Fluent glyph, or null when the cell shows no icon.</param>
public sealed record MiniGridTile(
    string Key,
    double LeftFraction,
    double TopFraction,
    double WidthFraction,
    double HeightFraction,
    string? IconGlyph);

/// <summary>
/// The fully projected, render-ready view of a <see cref="MiniGridPreviewModel"/> — everything the web
/// component derives before returning JSX (web/src/features/dashboard/components/MiniGridPreview.tsx): the
/// fixed column count (web <c>GRID_COLS.lg</c>), the guarded row span (web <c>safeMaxY</c>), the container
/// aspect ratio (web <c>aspectRatio: cols / safeMaxY</c>), the per-cell <see cref="Tiles"/>, whether the
/// layout is <see cref="IsEmpty"/>, plus the localized accessible <see cref="AutomationName"/> and
/// <see cref="EmptyMessage"/>. Pure data so every derived value is asserted headlessly.
/// </summary>
/// <param name="Columns">The fixed column count (web <c>GRID_COLS.lg</c> = 4).</param>
/// <param name="RowSpan">The guarded row span (web <c>safeMaxY</c>).</param>
/// <param name="AspectRatio">Width-to-height ratio of the preview (web <c>cols / safeMaxY</c>).</param>
/// <param name="Tiles">The projected cells, in layout order.</param>
/// <param name="IsEmpty">True when the layout has no items (web empty layout).</param>
/// <param name="AutomationName">The localized Narrator name for the preview.</param>
/// <param name="EmptyMessage">The localized friendly empty-state caption.</param>
public sealed record MiniGridPreviewDisplay(
    int Columns,
    int RowSpan,
    double AspectRatio,
    IReadOnlyList<MiniGridTile> Tiles,
    bool IsEmpty,
    string AutomationName,
    string EmptyMessage);

/// <summary>
/// Pure projection from a <see cref="MiniGridPreviewModel"/> to its <see cref="MiniGridPreviewDisplay"/> — the
/// native port of web/src/features/dashboard/components/MiniGridPreview.tsx. It reproduces the web derivations
/// exactly: the fixed four-column grid (web <c>GRID_COLS.lg</c>), the
/// <c>maxY = layout.length &gt; 0 ? max(y + h) : 2</c> row span with the
/// <c>safeMaxY = maxY &gt; 0 &amp;&amp; finite ? maxY : 2</c> guard, the per-item percentage geometry, and the
/// per-item icon join (web <c>widgets.find(w =&gt; w.id === item.i)</c> then
/// <c>getWidgetDef(widget.widgetId)?.icon</c>). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class MiniGridPreviewProjection
{
    /// <summary>The dashboard's <c>lg</c> column count (web <c>GRID_COLS.lg</c>).</summary>
    public const int GridColumns = 4;

    /// <summary>The row-span fallback when the layout is empty or yields a non-positive span (web <c>: 2</c>).</summary>
    public const int FallbackRowSpan = 2;

    /// <summary>
    /// Project <paramref name="model"/> into a render-ready display, resolving copy via
    /// <paramref name="localizer"/> and each cell's icon through <paramref name="iconResolver"/> (defaulting to
    /// <see cref="MiniGridWidgetIcons.GlyphFor"/>, the native <c>getWidgetDef(...).icon</c>).
    /// </summary>
    /// <param name="model">The render-time data model (the relevant parts of the web <c>SavedDashboard</c>).</param>
    /// <param name="localizer">The i18n facade the accessible name + empty caption resolve through.</param>
    /// <param name="iconResolver">
    /// The widget-id to Segoe Fluent glyph resolver (web <c>getWidgetDef(widgetId)?.icon</c>); a null result
    /// means the cell shows no icon. Defaults to <see cref="MiniGridWidgetIcons.GlyphFor"/>.
    /// </param>
    public static MiniGridPreviewDisplay Project(
        MiniGridPreviewModel model,
        ILocalizer localizer,
        Func<string, string?>? iconResolver = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var resolve = iconResolver ?? MiniGridWidgetIcons.GlyphFor;
        var layout = model.Layout ?? Array.Empty<MiniGridLayoutItem>();
        var widgets = model.Widgets ?? Array.Empty<MiniGridWidgetInstance>();

        int safeMaxY = RowSpan(layout);

        var tiles = new List<MiniGridTile>(layout.Count);
        foreach (var item in layout)
        {
            // web: const widget = dashboard.widgets.find((w) => w.id === item.i);
            var widget = FindWidget(widgets, item.Key);

            // web: const def = widget ? getWidgetDef(widget.widgetId) : null; const Icon = def?.icon;
            string? glyph = widget is not null ? resolve(widget.WidgetId) : null;

            tiles.Add(new MiniGridTile(
                item.Key,
                (double)item.X / GridColumns,
                (double)item.Y / safeMaxY,
                (double)item.W / GridColumns,
                (double)item.H / safeMaxY,
                glyph));
        }

        return new MiniGridPreviewDisplay(
            Columns: GridColumns,
            RowSpan: safeMaxY,
            AspectRatio: (double)GridColumns / safeMaxY,
            Tiles: tiles,
            IsEmpty: layout.Count == 0,
            AutomationName: MiniGridPreviewRegistration.PreviewLabel(localizer),
            EmptyMessage: MiniGridPreviewRegistration.EmptyMessage(localizer));
    }

    /// <summary>
    /// The guarded row span for a layout — the web
    /// <c>maxY = layout.length &gt; 0 ? Math.max(...map(l =&gt; l.y + l.h)) : 2</c> followed by
    /// <c>safeMaxY = maxY &gt; 0 &amp;&amp; Number.isFinite(maxY) ? maxY : 2</c>. Integers are always finite, so
    /// the finite guard reduces to the positivity guard.
    /// </summary>
    /// <param name="layout">The <c>lg</c> layout items.</param>
    public static int RowSpan(IReadOnlyList<MiniGridLayoutItem> layout)
    {
        ArgumentNullException.ThrowIfNull(layout);

        if (layout.Count == 0)
        {
            return FallbackRowSpan;
        }

        int maxY = int.MinValue;
        foreach (var item in layout)
        {
            int bottom = item.Y + item.H;
            if (bottom > maxY)
            {
                maxY = bottom;
            }
        }

        return maxY > 0 ? maxY : FallbackRowSpan;
    }

    private static MiniGridWidgetInstance? FindWidget(IReadOnlyList<MiniGridWidgetInstance> widgets, string key)
    {
        foreach (var widget in widgets)
        {
            if (string.Equals(widget.Id, key, StringComparison.Ordinal))
            {
                return widget;
            }
        }

        return null;
    }
}

/// <summary>
/// The native <c>getWidgetDef(widgetId)?.icon</c> for the dashboard widget catalog — resolves a placed
/// widget's id to the Segoe Fluent glyph a <c>MiniGridPreview</c> cell shows. It is split into two tables so
/// each concern is verified independently: <see cref="IconNameFor"/> is a faithful, row-for-row transcription
/// of the web widget registry's <c>id =&gt; icon</c> assignments (web/src/features/dashboard/widgets/registry/*,
/// 118 widgets), and the id-to-glyph step then maps each web Lucide icon name to its closest Segoe Fluent
/// glyph. Segoe Fluent has no 1:1 equivalent for every Lucide icon, so that second step is a documented
/// platform approximation (the same Lucide-to-Fluent substitution the rest of the app uses, e.g.
/// <c>QuickNavWidget</c>); semantically related icons may share a glyph. An unknown widget id resolves to
/// <c>null</c> — exactly the web's <c>def?.icon</c> when the registry has no entry — so the cell renders no
/// icon. UI-free so the catalog and the resolver are asserted headlessly.
/// </summary>
public static class MiniGridWidgetIcons
{
    // Faithful transcription of the web registry id => Lucide icon (web/src/features/dashboard/widgets/registry).
    private static readonly Dictionary<string, string> IconByWidgetId =
        new(StringComparer.Ordinal)
        {
            // vehicle
            ["vehicle-hero"] = "Car",
            ["vehicle-hero-card"] = "CreditCard",
            ["vehicle-twin"] = "Monitor",
            ["digital-twin-mini"] = "Monitor",
            ["software-update-status"] = "MonitorSmartphone",
            ["software-update-history"] = "Download",
            ["odometer-counter"] = "Hash",
            ["drivetrain-health"] = "Cog",
            ["motor-performance"] = "Zap",
            ["motor-history"] = "Cog",
            ["vehicle-specs"] = "FileText",
            ["watch-summary"] = "Watch",
            ["maintenance-tracker"] = "Wrench",
            ["warranty-status"] = "ShieldCheck",
            ["subscriptions"] = "CreditCard",
            ["vehicle-upgrades"] = "ArrowUpCircle",

            // battery
            ["battery-gauge"] = "Battery",
            ["battery-radial-gauge"] = "Battery",
            ["range-estimate"] = "Gauge",
            ["range-bar"] = "Gauge",
            ["battery-degradation-trend"] = "TrendingUp",
            ["energy-flow"] = "Activity",
            ["projected-range"] = "Navigation",
            ["battery-cells"] = "Cpu",
            ["battery-degradation-forecast"] = "TrendingDown",
            ["battery-health-analytics"] = "HeartPulse",

            // energy
            ["energy-flow-animated"] = "Workflow",
            ["vampire-drain"] = "BatteryWarning",
            ["sleep-efficiency"] = "Moon",
            ["solar-production"] = "Sun",
            ["live-power-flow"] = "Workflow",
            ["energy-site-info"] = "Home",
            ["backup-history"] = "BatteryFull",
            ["power-flow-history"] = "TrendingUp",
            ["energy-stats"] = "Zap",

            // driving
            ["recent-drives"] = "Car",
            ["drive-score"] = "TrendingUp",
            ["recent-drives-list"] = "List",
            ["drive-score-gauge"] = "Gauge",
            ["drive-efficiency-chart"] = "TrendingUp",
            ["speed-heatmap"] = "Grid3X3",
            ["driving-dynamics"] = "Gauge",
            ["speed-profile"] = "Activity",
            ["regen-efficiency"] = "RotateCcw",
            ["route-efficiency"] = "Route",
            ["driving-coach"] = "Lightbulb",
            ["trip-summary"] = "Navigation",
            ["drive-telemetry"] = "Activity",

            // charging
            ["charge-status"] = "Zap",
            ["charge-status-live"] = "Zap",
            ["charge-history"] = "BarChart3",
            ["charge-session-chart"] = "Zap",
            ["charge-cost-tracker"] = "DollarSign",
            ["charging-schedule"] = "Calendar",
            ["cost-forecast"] = "TrendingUp",
            ["charging-optimizer"] = "Sparkles",
            ["wall-connector"] = "Plug",
            ["charging-telemetry"] = "Gauge",
            ["supercharger-history"] = "Zap",
            ["charge-plans"] = "Clock",
            ["charging-session-detail"] = "Zap",

            // climate
            ["climate-status"] = "Thermometer",
            ["climate-control-panel"] = "Thermometer",
            ["weather-at-car"] = "CloudSun",
            ["climate-history"] = "ThermometerSun",

            // tires
            ["tire-pressure-visual"] = "CircleDot",
            ["tire-pressure-history"] = "CircleDot",

            // security
            ["security-status"] = "Shield",
            ["door-window-status"] = "DoorOpen",
            ["sentry-event-log"] = "Eye",
            ["safety-features"] = "ShieldAlert",
            ["safety-history"] = "AlertOctagon",
            ["guard-mode"] = "Shield",
            ["vehicle-access"] = "Users",

            // commands
            ["command-quick-actions"] = "Command",
            ["command-history"] = "Terminal",

            // media
            ["media-now-playing"] = "Music",
            ["media-history"] = "ListMusic",

            // telemetry
            ["live-signals"] = "Wifi",
            ["live-signal-sparklines"] = "Activity",
            ["signal-health"] = "Activity",
            ["signal-catalog"] = "BookOpen",
            ["signal-log"] = "ScrollText",

            // analytics
            ["fleet-stats"] = "BarChart3",
            ["fleet-stats-bar"] = "BarChart3",
            ["weekly-summary-card"] = "CalendarRange",
            ["weekly-digest"] = "CalendarDays",
            ["monthly-mileage"] = "BarChart3",
            ["lifetime-stats"] = "Trophy",
            ["mileage-stats"] = "TrendingUp",
            ["state-timeline"] = "Clock",
            ["anomaly-detector"] = "AlertTriangle",
            ["fsm-distribution"] = "GitBranch",
            ["cost-breakdown"] = "PieIcon",
            ["year-review"] = "Calendar",
            ["analytics-summary"] = "BarChart3",
            ["recently-unlocked-achievements"] = "Trophy",

            // alerts
            ["alert-feed"] = "Bell",
            ["notification-stats"] = "Bell",

            // automations
            ["automation-status"] = "Workflow",
            ["automation-history"] = "PlayCircle",

            // system
            ["onboarding-checklist"] = "Rocket",
            ["uptime-monitor"] = "HeartPulse",
            ["mqtt-status"] = "Radio",
            ["quick-nav"] = "MapPin",
            ["api-usage"] = "BarChart2",
            ["system-health"] = "Server",
            ["telemetry-errors"] = "AlertCircle",
            ["audit-log"] = "FileSearch",
            ["backup-monitor"] = "HardDrive",
            ["export-status"] = "Download",
            ["version-info"] = "Info",
            ["dashboard-stats"] = "LayoutDashboard",

            // maps
            ["location-map"] = "MapPin",
            ["location-favorites"] = "MapPin",
            ["geofence-status"] = "Crosshair",
            ["destination-eta"] = "Navigation2",
            ["position-heatmap"] = "MapIcon",
        };

    // Web Lucide icon name => closest Segoe Fluent glyph (documented platform approximation). The 22 mappings
    // already used elsewhere in the app (e.g. Car E804, Gauge E9D9, Activity E83E, Zap E945, Clock E823,
    // Hash E8EF, DollarSign E1D3, HardDrive EDA2, BookOpen E82D, Route E7C0, CalendarDays E787) are reused
    // verbatim so the catalog tints from the same glyph vocabulary.
    private static readonly Dictionary<string, string> GlyphByIcon =
        new(StringComparer.Ordinal)
        {
            ["Activity"] = "\uE83E",
            ["AlertCircle"] = "\uE7BA",
            ["AlertOctagon"] = "\uE7BA",
            ["AlertTriangle"] = "\uE7BA",
            ["ArrowUpCircle"] = "\uE777",
            ["BarChart2"] = "\uE9D2",
            ["BarChart3"] = "\uE9D2",
            ["Battery"] = "\uE83F",
            ["BatteryFull"] = "\uE83F",
            ["BatteryWarning"] = "\uE7BA",
            ["Bell"] = "\uEA8F",
            ["BookOpen"] = "\uE82D",
            ["Calendar"] = "\uE787",
            ["CalendarDays"] = "\uE787",
            ["CalendarRange"] = "\uE787",
            ["Car"] = "\uE804",
            ["CircleDot"] = "\uE9D9",
            ["Clock"] = "\uE823",
            ["CloudSun"] = "\uE753",
            ["Cog"] = "\uE713",
            ["Command"] = "\uE756",
            ["Cpu"] = "\uEDA2",
            ["CreditCard"] = "\uE8C7",
            ["Crosshair"] = "\uE707",
            ["DollarSign"] = "\uE1D3",
            ["DoorOpen"] = "\uE72E",
            ["Download"] = "\uE896",
            ["Eye"] = "\uE7B3",
            ["FileSearch"] = "\uE721",
            ["FileText"] = "\uE8A5",
            ["Gauge"] = "\uE9D9",
            ["GitBranch"] = "\uE9D2",
            ["Grid3X3"] = "\uE9D2",
            ["HardDrive"] = "\uEDA2",
            ["Hash"] = "\uE8EF",
            ["HeartPulse"] = "\uE83E",
            ["Home"] = "\uE80F",
            ["Info"] = "\uE897",
            ["LayoutDashboard"] = "\uE700",
            ["Lightbulb"] = "\uE706",
            ["List"] = "\uE8FD",
            ["ListMusic"] = "\uE8FD",
            ["MapIcon"] = "\uE707",
            ["MapPin"] = "\uE707",
            ["Monitor"] = "\uE7F4",
            ["MonitorSmartphone"] = "\uE8EA",
            ["Moon"] = "\uE708",
            ["Music"] = "\uE767",
            ["Navigation"] = "\uE707",
            ["Navigation2"] = "\uE707",
            ["PieIcon"] = "\uE9D2",
            ["PlayCircle"] = "\uE768",
            ["Plug"] = "\uE945",
            ["Radio"] = "\uE701",
            ["Rocket"] = "\uE945",
            ["RotateCcw"] = "\uE72C",
            ["Route"] = "\uE7C0",
            ["ScrollText"] = "\uE8A5",
            ["Server"] = "\uEDA2",
            ["Shield"] = "\uEA18",
            ["ShieldAlert"] = "\uEA18",
            ["ShieldCheck"] = "\uEA18",
            ["Sparkles"] = "\uE734",
            ["Sun"] = "\uE706",
            ["Terminal"] = "\uE756",
            ["Thermometer"] = "\uE9CA",
            ["ThermometerSun"] = "\uE9CA",
            ["TrendingDown"] = "\uE9D2",
            ["TrendingUp"] = "\uE9D2",
            ["Trophy"] = "\uE734",
            ["Users"] = "\uE716",
            ["Watch"] = "\uE916",
            ["Wifi"] = "\uE701",
            ["Workflow"] = "\uE713",
            ["Wrench"] = "\uE90F",
            ["Zap"] = "\uE945",
        };

    /// <summary>Number of catalog widget ids the resolver knows (web registry size).</summary>
    public static int KnownWidgetCount => IconByWidgetId.Count;

    /// <summary>Number of distinct Lucide icon names mapped to a Segoe Fluent glyph.</summary>
    public static int KnownIconCount => GlyphByIcon.Count;

    /// <summary>The catalog widget ids the resolver knows.</summary>
    public static IReadOnlyCollection<string> KnownWidgetIds => IconByWidgetId.Keys;

    /// <summary>The distinct Lucide icon names the catalog uses.</summary>
    public static IReadOnlyCollection<string> KnownIconNames => GlyphByIcon.Keys;

    /// <summary>
    /// The web Lucide icon name a widget id uses, or null when the id is not in the catalog — the faithful
    /// transcription of the web registry's <c>id =&gt; icon</c> assignment.
    /// </summary>
    /// <param name="widgetId">The catalog widget id (web <c>widgetId</c>).</param>
    public static string? IconNameFor(string? widgetId) =>
        widgetId is not null && IconByWidgetId.TryGetValue(widgetId, out var icon) ? icon : null;

    /// <summary>
    /// The Segoe Fluent glyph for a web Lucide icon name, or null when the name is not mapped — the documented
    /// platform-approximation step.
    /// </summary>
    /// <param name="iconName">The web Lucide icon name (e.g. <c>Battery</c>).</param>
    public static string? GlyphForIcon(string? iconName) =>
        iconName is not null && GlyphByIcon.TryGetValue(iconName, out var glyph) ? glyph : null;

    /// <summary>
    /// The Segoe Fluent glyph a placed widget shows, or null when the id is unknown — the native
    /// <c>getWidgetDef(widgetId)?.icon</c> (id =&gt; Lucide icon =&gt; Fluent glyph).
    /// </summary>
    /// <param name="widgetId">The catalog widget id (web <c>widgetId</c>).</param>
    public static string? GlyphFor(string? widgetId) => GlyphForIcon(IconNameFor(widgetId));
}

/// <summary>
/// Canonical metadata for the <c>MiniGridPreview</c> feature surface — the native mirror of the web component
/// at web/src/features/dashboard/components/MiniGridPreview.tsx. The web source is anonymous (it renders no
/// text and makes no <c>t(...)</c> calls), so the only strings the native surface resolves are an accessible
/// Narrator name for the otherwise-decorative preview and a friendly empty-state caption; both reuse existing
/// P1/S10 catalog keys (<c>dashboard.layout.label</c>, <c>common.noData</c>) rather than introducing new copy.
/// UI-free so the slug, keys and glyph are asserted in tests.
/// </summary>
public static class MiniGridPreviewRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "MiniGridPreview";

    /// <summary>i18n key for the preview's accessible name (the shared <c>dashboard.layout.label</c> string).</summary>
    public const string PreviewLabelKey = "dashboard.layout.label";

    /// <summary>English fallback for <see cref="PreviewLabelKey"/> (the catalog value).</summary>
    public const string PreviewLabelFallback = "Layout";

    /// <summary>i18n key for the empty-state caption (the shared <c>common.noData</c> string).</summary>
    public const string EmptyMessageKey = "common.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/> (the catalog value).</summary>
    public const string EmptyMessageFallback = "No data available";

    /// <summary>Segoe Fluent "GridView" glyph shown in the empty state (decorative, no widgets placed).</summary>
    public const string EmptyGlyph = "\uE80A";

    /// <summary>Resolve the preview's accessible name through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    public static string PreviewLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PreviewLabelKey, PreviewLabelFallback);
    }

    /// <summary>Resolve the friendly empty-state caption through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade the caption resolves through.</param>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>MiniGridPreview</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — the preview carries no fleet data (it renders
/// only abstract layout rectangles and decorative glyphs), so a diagnostics line can never leak anything.
/// Thread-safe.
/// </summary>
public sealed class MiniGridPreviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public MiniGridPreviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MiniGridPreview</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MiniGridPreviewRegistration.Slug}");
    }
}
