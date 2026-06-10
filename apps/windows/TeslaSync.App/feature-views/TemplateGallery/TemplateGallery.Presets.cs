using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One catalog widget the dashboard presets reference — the native, UI-free slice of the web
/// <c>WidgetDef</c> (web/src/features/dashboard/widgets/types.ts) that <c>TemplateGallery</c> actually reads:
/// the display <see cref="NameFallback"/> (web <c>def.name</c>, shown in the detail widget list), the
/// <see cref="Category"/> slug (web <c>def.category</c>, the source of the per-card category icons) and the
/// default / min / max grid spans the layout builder needs to reproduce the preset's <c>lg</c> placement
/// (web <c>def.defaultSize</c> / <c>minSize</c> / <c>maxSize</c>). The icon is resolved separately through the
/// shared <see cref="MiniGridWidgetIcons.GlyphFor"/> resolver (the native <c>def.icon</c>), so it is not
/// duplicated here. Pure data — asserted headlessly.
/// </summary>
/// <param name="Id">The catalog widget id (web <c>def.id</c>).</param>
/// <param name="NameFallback">The English display name (web <c>def.name</c>) used as the i18n fallback.</param>
/// <param name="Category">The widget category slug (web <c>def.category</c>).</param>
/// <param name="DefaultCols">Default column span (web <c>defaultSize.cols</c>).</param>
/// <param name="DefaultRows">Default row span (web <c>defaultSize.rows</c>).</param>
/// <param name="MinCols">Minimum column span (web <c>minSize.cols</c>).</param>
/// <param name="MinRows">Minimum row span (web <c>minSize.rows</c>).</param>
/// <param name="MaxCols">Maximum column span (web <c>maxSize.cols</c>).</param>
/// <param name="MaxRows">Maximum row span (web <c>maxSize.rows</c>).</param>
public sealed record DashboardWidgetMeta(
    string Id,
    string NameFallback,
    string Category,
    int DefaultCols,
    int DefaultRows,
    int MinCols,
    int MinRows,
    int MaxCols,
    int MaxRows);

/// <summary>
/// The native <c>getWidgetDef(widgetId)</c> for the widgets the dashboard presets place — a faithful
/// transcription of the relevant fields of the web widget registry
/// (web/src/features/dashboard/widgets/registry/*) for every widget id referenced by
/// <see cref="DashboardPresets"/>. The web <c>getWidgetDef</c> works for the full 118-widget catalog, but
/// <c>TemplateGallery</c> only ever resolves ids that appear in a preset, so this catalog is scoped to exactly
/// those ids — an unknown id resolves to <c>null</c>, mirroring the web's <c>getWidgetDef(...)</c> returning
/// <c>undefined</c> (the web then renders nothing for that row). The Segoe Fluent glyph for an id is delegated
/// to the shared <see cref="MiniGridWidgetIcons.GlyphFor"/> (the same <c>def.icon</c> the
/// <see cref="MiniGridPreview"/> cells use) so the icon vocabulary is defined once. Display name and category
/// flow through the i18n facade with the registry English as the fallback. UI-free so the catalog is asserted
/// headlessly.
/// </summary>
public static class DashboardWidgetCatalog
{
    private static readonly Dictionary<string, DashboardWidgetMeta> ByWidgetId =
        new(StringComparer.Ordinal)
        {
            // vehicle (web registry/vehicle.ts)
            ["vehicle-hero"] = new("vehicle-hero", "Vehicle Card", "vehicle", 2, 9, 2, 4, 4, 40),
            ["vehicle-hero-card"] = new("vehicle-hero-card", "Vehicle Hero Card", "vehicle", 2, 2, 1, 2, 4, 40),
            ["vehicle-twin"] = new("vehicle-twin", "Digital Twin", "vehicle", 2, 4, 2, 4, 3, 40),

            // battery (web registry/battery.ts)
            ["battery-gauge"] = new("battery-gauge", "Battery Level", "battery", 1, 2, 1, 2, 2, 40),
            ["battery-radial-gauge"] = new("battery-radial-gauge", "Battery Radial Gauge", "battery", 1, 2, 1, 2, 3, 40),
            ["range-estimate"] = new("range-estimate", "Range Estimate", "battery", 1, 2, 1, 2, 2, 40),
            ["range-bar"] = new("range-bar", "Range Bar", "battery", 2, 2, 1, 2, 4, 40),
            ["battery-degradation-trend"] = new("battery-degradation-trend", "Battery Degradation Trend", "battery", 2, 4, 1, 2, 4, 40),
            ["energy-flow"] = new("energy-flow", "Energy Flow", "battery", 2, 4, 2, 4, 4, 40),

            // energy (web registry/energy.ts)
            ["energy-flow-animated"] = new("energy-flow-animated", "Energy Flow Animated", "energy", 2, 4, 2, 4, 3, 40),

            // driving (web registry/driving.ts)
            ["recent-drives"] = new("recent-drives", "Recent Drives", "driving", 2, 4, 2, 2, 4, 40),
            ["drive-score"] = new("drive-score", "Driving Score", "driving", 1, 2, 1, 2, 2, 40),
            ["recent-drives-list"] = new("recent-drives-list", "Recent Drives List", "driving", 2, 4, 1, 4, 4, 40),
            ["drive-score-gauge"] = new("drive-score-gauge", "Drive Score Gauge", "driving", 1, 2, 1, 2, 2, 40),
            ["drive-efficiency-chart"] = new("drive-efficiency-chart", "Drive Efficiency Chart", "driving", 2, 4, 1, 2, 4, 40),
            ["speed-heatmap"] = new("speed-heatmap", "Speed Heatmap", "driving", 2, 4, 1, 4, 4, 40),

            // charging (web registry/charging.ts)
            ["charge-status"] = new("charge-status", "Charge Status", "charging", 2, 2, 1, 2, 3, 40),
            ["charge-status-live"] = new("charge-status-live", "Charge Status Live", "charging", 2, 2, 1, 2, 3, 40),
            ["charge-history"] = new("charge-history", "Charge History", "charging", 2, 4, 2, 2, 4, 40),
            ["charge-session-chart"] = new("charge-session-chart", "Charge Session Chart", "charging", 2, 4, 1, 2, 4, 40),
            ["charge-cost-tracker"] = new("charge-cost-tracker", "Charge Cost Tracker", "charging", 2, 2, 1, 2, 4, 40),
            ["charging-schedule"] = new("charging-schedule", "Charging Schedule", "charging", 2, 2, 1, 2, 4, 40),

            // climate (web registry/climate.ts)
            ["climate-status"] = new("climate-status", "Climate", "climate", 1, 2, 1, 2, 2, 40),
            ["climate-control-panel"] = new("climate-control-panel", "Climate Control Panel", "climate", 2, 4, 1, 2, 4, 40),
            ["weather-at-car"] = new("weather-at-car", "Weather at Car", "climate", 1, 2, 1, 2, 3, 40),

            // tires (web registry/tires.ts)
            ["tire-pressure-visual"] = new("tire-pressure-visual", "Tire Pressure Visual", "tires", 2, 4, 2, 4, 4, 40),

            // security (web registry/security.ts)
            ["security-status"] = new("security-status", "Security", "security", 1, 2, 1, 2, 2, 40),
            ["door-window-status"] = new("door-window-status", "Door & Window Status", "security", 2, 2, 1, 2, 4, 40),
            ["sentry-event-log"] = new("sentry-event-log", "Sentry Event Log", "security", 2, 4, 2, 4, 4, 40),

            // commands (web registry/commands.ts)
            ["command-quick-actions"] = new("command-quick-actions", "Quick Actions", "commands", 2, 2, 1, 2, 4, 40),

            // telemetry (web registry/telemetry.ts)
            ["live-signals"] = new("live-signals", "Live Signals", "telemetry", 2, 4, 2, 2, 4, 40),
            ["live-signal-sparklines"] = new("live-signal-sparklines", "Live Signal Sparklines", "telemetry", 2, 4, 2, 4, 4, 40),

            // analytics (web registry/analytics.ts)
            ["fleet-stats"] = new("fleet-stats", "Fleet Stats", "analytics", 4, 2, 2, 2, 4, 40),

            // alerts (web registry/alerts.ts)
            ["alert-feed"] = new("alert-feed", "Alert Feed", "alerts", 2, 4, 2, 4, 4, 40),

            // system (web registry/system.ts)
            ["onboarding-checklist"] = new("onboarding-checklist", "Setup Checklist", "system", 2, 4, 2, 3, 4, 8),
            ["uptime-monitor"] = new("uptime-monitor", "Uptime Monitor", "system", 2, 2, 1, 2, 4, 40),
            ["quick-nav"] = new("quick-nav", "Quick Navigation", "system", 4, 2, 2, 2, 4, 40),

            // maps (web registry/maps.ts)
            ["location-map"] = new("location-map", "Vehicle Location Map", "maps", 2, 4, 1, 4, 4, 40),
        };

    /// <summary>The catalog widget ids this surface knows (the union of every preset's widget ids).</summary>
    public static IReadOnlyCollection<string> KnownWidgetIds => ByWidgetId.Keys;

    /// <summary>The number of catalog widgets (the distinct widget ids referenced by the presets).</summary>
    public static int Count => ByWidgetId.Count;

    /// <summary>
    /// The widget metadata for <paramref name="widgetId"/>, or null when the id is not referenced by any
    /// preset — the native <c>getWidgetDef(widgetId)</c> scoped to this surface.
    /// </summary>
    /// <param name="widgetId">The catalog widget id (web <c>widgetId</c>).</param>
    public static DashboardWidgetMeta? Get(string? widgetId) =>
        widgetId is not null && ByWidgetId.TryGetValue(widgetId, out var meta) ? meta : null;

    /// <summary>Try-get form of <see cref="Get"/>.</summary>
    /// <param name="widgetId">The catalog widget id.</param>
    /// <param name="meta">The resolved metadata when found.</param>
    public static bool TryGet(string? widgetId, out DashboardWidgetMeta meta)
    {
        if (widgetId is not null && ByWidgetId.TryGetValue(widgetId, out var found))
        {
            meta = found;
            return true;
        }

        meta = null!;
        return false;
    }

    /// <summary>The Segoe Fluent glyph for a widget id (the shared native <c>def.icon</c>), or null when unknown.</summary>
    /// <param name="widgetId">The catalog widget id.</param>
    public static string? GlyphFor(string? widgetId) => MiniGridWidgetIcons.GlyphFor(widgetId);

    /// <summary>The i18n key the widget's display name resolves through (the registry English is the fallback).</summary>
    /// <param name="widgetId">The catalog widget id.</param>
    public static string NameKey(string widgetId) => $"dashboard.widget.{widgetId}.name";

    /// <summary>
    /// The localized widget display name (web <c>def.name</c>), resolved through the i18n facade with the
    /// registry English as the fallback. An unknown id falls back to the id itself.
    /// </summary>
    /// <param name="localizer">The i18n facade the name resolves through.</param>
    /// <param name="widgetId">The catalog widget id.</param>
    public static string Name(ILocalizer localizer, string widgetId)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(widgetId);
        var fallback = Get(widgetId)?.NameFallback ?? widgetId;
        return localizer.GetString(NameKey(widgetId), fallback);
    }

    /// <summary>The i18n key a category label resolves through (the slug is the fallback, matching web <c>title={category}</c>).</summary>
    /// <param name="category">The widget category slug.</param>
    public static string CategoryKey(string category) => $"dashboard.widgetCategory.{category}";

    /// <summary>The localized category label (web <c>title={category}</c>), with the slug as the fallback.</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="category">The widget category slug.</param>
    public static string CategoryLabel(ILocalizer localizer, string category)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(category);
        return localizer.GetString(CategoryKey(category), category);
    }
}

/// <summary>
/// A widget placed in a preset dashboard — the native analogue of the web <c>WidgetInstance</c>
/// (<c>{ id, widgetId }</c> in web/src/features/dashboard/widgets/types.ts). <see cref="InstanceId"/> is the
/// preset-scoped instance id the web <c>makePreset</c> assigns (<c>`${presetId}-${i + 1}`</c>) and the key the
/// layout item is tied to; <see cref="WidgetId"/> is the catalog id the icon / name / category resolve from.
/// Pure data.
/// </summary>
/// <param name="InstanceId">The instance id (web <c>`${presetId}-${i + 1}`</c>).</param>
/// <param name="WidgetId">The catalog widget id (web <c>widgetId</c>).</param>
public sealed record DashboardTemplateWidget(string InstanceId, string WidgetId);

/// <summary>
/// A preset dashboard — the native projection of the parts of the web <c>SavedDashboard</c> that
/// <c>TemplateGallery</c> reads (web/src/features/dashboard/hooks/useDashboardLayout.ts <c>DASHBOARD_PRESETS</c>):
/// the stable <see cref="Id"/> (web <c>id</c>), the English <see cref="NameFallback"/> (web <c>name</c>, the
/// i18n fallback), the placed <see cref="Widgets"/> (web <c>widgets</c>) and the <c>lg</c>-breakpoint
/// <see cref="LgLayout"/> the preview renders (web <c>layouts.lg</c>, produced by
/// <see cref="DashboardLayoutBuilder"/>). Pure data so the gallery / detail projections and the preview model
/// are asserted headlessly.
/// </summary>
/// <param name="Id">The preset id (web <c>id</c>).</param>
/// <param name="NameFallback">The English preset name (web <c>name</c>) used as the i18n fallback.</param>
/// <param name="Widgets">The placed widget instances (web <c>widgets</c>).</param>
/// <param name="LgLayout">The <c>lg</c> grid layout (web <c>layouts.lg</c>).</param>
public sealed record DashboardTemplate(
    string Id,
    string NameFallback,
    IReadOnlyList<DashboardTemplateWidget> Widgets,
    IReadOnlyList<MiniGridLayoutItem> LgLayout)
{
    /// <summary>The widget count badge value (web <c>template.widgets.length</c>).</summary>
    public int WidgetCount => Widgets.Count;

    /// <summary>
    /// Project this template into the <see cref="MiniGridPreviewModel"/> the shared preview surface binds to
    /// (web <c>&lt;MiniGridPreview dashboard={template} /&gt;</c>), joining the placed widgets to the
    /// <c>lg</c> layout the preview reads.
    /// </summary>
    public MiniGridPreviewModel ToPreviewModel()
    {
        var instances = new MiniGridWidgetInstance[Widgets.Count];
        for (int i = 0; i < Widgets.Count; i++)
        {
            instances[i] = new MiniGridWidgetInstance(Widgets[i].InstanceId, Widgets[i].WidgetId);
        }

        return MiniGridPreviewModel.Create(instances, LgLayout);
    }
}

/// <summary>
/// The native port of the web preset layout builder
/// (web/src/features/dashboard/hooks/useDashboardLayout.ts <c>buildDefaultLayouts</c> / <c>buildLayoutItem</c>)
/// for the <c>lg</c> breakpoint — the only breakpoint <c>TemplateGallery</c>'s preview reads. It reproduces the
/// web auto-flow placement exactly: each widget's span is its <c>defaultSize</c> clamped into
/// <c>[minSize, maxSize]</c> and capped at the column count, then items flow left-to-right, wrapping to a new
/// row (advanced by the tallest item in the row) when the next item would overflow the four columns. No WinUI
/// types — asserted headlessly.
/// </summary>
public static class DashboardLayoutBuilder
{
    /// <summary>The dashboard's <c>lg</c> column count (web <c>GRID_COLS.lg</c>).</summary>
    public const int LgColumns = 4;

    private const int FallbackDefaultSpan = 1; // web `?? 1`
    private const int FallbackMaxRows = 20;    // web `def?.maxSize.rows ?? 20`

    /// <summary>
    /// Build the <c>lg</c> layout for a preset's widgets (web <c>buildDefaultLayouts(widgets).lg</c>),
    /// keying each item by its widget instance id so the preview can join layout to widget.
    /// </summary>
    /// <param name="widgets">The placed widget instances, in placement order.</param>
    public static IReadOnlyList<MiniGridLayoutItem> BuildLgLayout(IReadOnlyList<DashboardTemplateWidget> widgets)
    {
        ArgumentNullException.ThrowIfNull(widgets);

        var items = new List<MiniGridLayoutItem>(widgets.Count);
        int x = 0;
        int y = 0;
        int rowMaxH = 0;

        foreach (var widget in widgets)
        {
            var (w, h) = Span(widget.WidgetId);
            int itemX = x % LgColumns;
            int itemY = y;

            // web: if (x + item.w > cols) { x = 0; y += rowMaxH; rowMaxH = 0; item.x = 0; item.y = y; }
            if (x + w > LgColumns)
            {
                x = 0;
                y += rowMaxH;
                rowMaxH = 0;
                itemX = 0;
                itemY = y;
            }

            items.Add(new MiniGridLayoutItem(widget.InstanceId, itemX, itemY, w, h));
            x += w;
            rowMaxH = Math.Max(rowMaxH, h);
        }

        return items;
    }

    /// <summary>
    /// The clamped grid span of a widget (web <c>buildLayoutItem</c>'s <c>w</c> / <c>h</c>): the default size
    /// capped at the column count and clamped into the widget's min / max, with the web fallbacks applied when
    /// the id is unknown.
    /// </summary>
    /// <param name="widgetId">The catalog widget id.</param>
    public static (int W, int H) Span(string widgetId)
    {
        const int cols = LgColumns;

        if (!DashboardWidgetCatalog.TryGet(widgetId, out var def))
        {
            // web: def === undefined → defaultW/H = 1, minW = min(1, cols), minH = 1, maxW = cols, maxH = 20.
            int unknownW = ClampMinMax(Math.Min(FallbackDefaultSpan, cols), Math.Min(FallbackDefaultSpan, cols), cols);
            int unknownH = ClampMinMax(FallbackDefaultSpan, FallbackDefaultSpan, FallbackMaxRows);
            return (unknownW, unknownH);
        }

        int minW = Math.Min(def.MinCols, cols);
        int maxW = Math.Min(def.MaxCols, cols);
        int w = ClampMinMax(Math.Min(def.DefaultCols, cols), minW, maxW);
        int h = ClampMinMax(def.DefaultRows, def.MinRows, def.MaxRows);
        return (w, h);
    }

    // web: clampMinMax(value, min, max) = Math.min(Math.max(value, min), max)
    private static int ClampMinMax(int value, int min, int max) => Math.Min(Math.Max(value, min), max);
}

/// <summary>
/// The canonical preset dashboards — a faithful transcription of the web
/// <c>DASHBOARD_PRESETS</c> (web/src/features/dashboard/hooks/useDashboardLayout.ts), in the same order, with
/// the same ids, English names and widget lists. Each preset's widget instance ids
/// (<c>`${presetId}-${i + 1}`</c>) and <c>lg</c> layout are computed exactly as the web <c>makePreset</c> does,
/// so the native gallery, detail and previews bind to the same data the web does. Pure data — asserted
/// headlessly.
/// </summary>
public static class DashboardPresets
{
    /// <summary>Every preset, in web <c>DASHBOARD_PRESETS</c> order.</summary>
    public static IReadOnlyList<DashboardTemplate> All { get; } = BuildAll();

    /// <summary>The number of presets (web <c>DASHBOARD_PRESETS.length</c>).</summary>
    public static int Count => All.Count;

    /// <summary>The preset with <paramref name="id"/>, or null (web <c>DASHBOARD_PRESETS.find(p =&gt; p.id === id)</c>).</summary>
    /// <param name="id">The preset id.</param>
    public static DashboardTemplate? Find(string? id)
    {
        if (id is null)
        {
            return null;
        }

        foreach (var preset in All)
        {
            if (string.Equals(preset.Id, id, StringComparison.Ordinal))
            {
                return preset;
            }
        }

        return null;
    }

    // web: makePreset(id, name, specs) → widgets get id `${id}-${i+1}`; layout = buildDefaultLayouts(widgets).
    private static DashboardTemplate MakePreset(string id, string nameFallback, params string[] widgetIds)
    {
        var widgets = new List<DashboardTemplateWidget>(widgetIds.Length);
        for (int i = 0; i < widgetIds.Length; i++)
        {
            widgets.Add(new DashboardTemplateWidget($"{id}-{i + 1}", widgetIds[i]));
        }

        var layout = DashboardLayoutBuilder.BuildLgLayout(widgets);
        return new DashboardTemplate(id, nameFallback, widgets, layout);
    }

    private static DashboardTemplate[] BuildAll() => new[]
    {
        // web: DEFAULT_DASHBOARD (the onboarding checklist seeds first-run setup).
        MakePreset(
            "default",
            "Default",
            "onboarding-checklist",
            "vehicle-hero",
            "battery-gauge",
            "climate-status",
            "recent-drives",
            "charge-status",
            "security-status",
            "quick-nav"),
        MakePreset(
            "commuter",
            "Daily Commuter",
            "battery-gauge",
            "range-estimate",
            "charge-status",
            "climate-status",
            "security-status",
            "location-map",
            "quick-nav"),
        MakePreset(
            "fleet_manager",
            "Fleet Manager",
            "fleet-stats",
            "recent-drives",
            "charge-history",
            "drive-score",
            "vehicle-hero",
            "quick-nav"),
        MakePreset(
            "data_nerd",
            "Data Nerd",
            "live-signals",
            "energy-flow",
            "vehicle-twin",
            "battery-gauge",
            "drive-score"),
        MakePreset(
            "charging_focus",
            "Charging Hub",
            "charge-status-live",
            "battery-radial-gauge",
            "charge-session-chart",
            "charge-cost-tracker",
            "charging-schedule",
            "range-bar",
            "energy-flow-animated"),
        MakePreset(
            "security_monitor",
            "Security Monitor",
            "door-window-status",
            "sentry-event-log",
            "location-map",
            "vehicle-hero-card",
            "alert-feed",
            "command-quick-actions"),
        MakePreset(
            "road_trip",
            "Road Trip",
            "battery-radial-gauge",
            "range-bar",
            "location-map",
            "weather-at-car",
            "tire-pressure-visual",
            "climate-control-panel",
            "recent-drives-list",
            "drive-efficiency-chart"),
        MakePreset(
            "performance",
            "Performance",
            "drive-score-gauge",
            "speed-heatmap",
            "drive-efficiency-chart",
            "battery-degradation-trend",
            "energy-flow-animated",
            "live-signal-sparklines"),
        MakePreset(
            "kiosk_wall",
            "Wall Display",
            "vehicle-hero",
            "battery-radial-gauge",
            "charge-status-live",
            "location-map",
            "weather-at-car",
            "uptime-monitor"),
        MakePreset(
            "minimal",
            "Minimal",
            "battery-radial-gauge",
            "charge-status",
            "climate-status",
            "quick-nav"),
    };
}
