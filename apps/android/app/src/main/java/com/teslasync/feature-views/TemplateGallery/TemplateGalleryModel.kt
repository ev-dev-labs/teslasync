// Pure, framework-free model + projection for the TemplateGallery feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/dashboard/components/TemplateGallery.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is a modal gallery of dashboard templates. Its data is the static `DASHBOARD_PRESETS`
// constant (web hooks/useDashboardLayout.ts) plus the widget registry `getWidgetDef` (web
// widgets/registry). For each preset it derives: the MiniGridPreview tiles (web buildDefaultLayouts at the
// `lg`/4-column breakpoint, each tile carrying the widget's registry icon), the unique category icons (web
// `useCategoryIcons`, max 5), the per-widget icon+name list shown in the detail view, and the widget count
// (web `template.widgets.length`). It also offers a "blank" option that applies the [BLANK_PRESET_ID]
// sentinel (web `onApply('__blank__')`).
//
// This file owns exactly those derivations as a vendor-neutral projection. It embeds the slice of the web
// widget registry the presets reference (38 widgets) and the 10 presets themselves — the native analogue of
// the web static catalog a host state-holder (P1/S8) supplies — so the view performs no HTTP. Colors,
// glyphs and the localized template name/description/chrome are resolved at the Compose boundary, never
// here; the model carries only vendor-neutral kinds, ids, and the layout geometry.
//
// Layout note: the web buildLayoutItem clamps the default width/height into the registry min/max. At the
// `lg` (4-column) breakpoint MiniGridPreview reads, that clamp is a verified no-op for every preset widget
// (minCols ≤ defaultCols ≤ maxCols and defaultCols ≤ 4 for all 38), so the projection uses defaultSize
// directly and reproduces buildDefaultLayouts' auto-flow placement exactly. [TemplateGalleryProjectionTest]
// pins the resulting geometry.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TemplateGallery — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.templategallery

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TemplateGalleryRegistration {
    /** Stable surface id. */
    const val ID: String = "template-gallery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TemplateGallery"
}

/** The `lg` breakpoint column count MiniGridPreview lays out against (web `GRID_COLS.lg`). */
const val GRID_COLS_LG: Int = 4

/** Fallback grid height when a template has no widgets (web MiniGridPreview `safeMaxY` guard). */
const val DEFAULT_MAX_Y: Int = 2

/** Max unique category icons shown per card (web `useCategoryIcons` `.slice(0, 5)`). */
const val MAX_CATEGORY_ICONS: Int = 5

/** The sentinel preset id the "blank" option applies (web `onApply('__blank__')`). */
const val BLANK_PRESET_ID: String = "__blank__"

/**
 * The semantic widget category — the vendor-neutral mirror of the web `WidgetCategory` union. Only the
 * categories the presets reference are modeled; the render layer maps each to nothing visual (the category
 * is surfaced only as its representative icon), so this stays a pure grouping key for [categoryIcons].
 */
enum class WidgetCategory {
    Vehicle,
    Battery,
    Energy,
    Driving,
    Charging,
    Climate,
    Tires,
    Security,
    Commands,
    Telemetry,
    Analytics,
    Alerts,
    System,
    Maps,
}

/**
 * The glyph a widget renders in the mini-grid tiles, the detail list, and the category-icon row — the
 * vendor-neutral mirror of the lucide icon each web `WidgetDef.icon` references. The render layer
 * ([TemplateGalleryGlyphs]) resolves each kind to an authored 24dp vector; Android bundles no lucide set.
 */
enum class WidgetIconKind {
    Rocket,
    Car,
    Battery,
    Thermometer,
    Zap,
    Shield,
    MapPin,
    Gauge,
    BarChart,
    TrendingUp,
    Wifi,
    Activity,
    Monitor,
    DollarSign,
    Calendar,
    Workflow,
    DoorOpen,
    Eye,
    CreditCard,
    Bell,
    Command,
    CloudSun,
    CircleDot,
    List,
    Grid,
    HeartPulse,
}

/**
 * The native mirror of the slice of a web `WidgetDef` the TemplateGallery reads: the [id] (matched against a
 * preset's widget instances), the registry display [name] (shown in the detail list), the [category] (for
 * [categoryIcons]), the [icon], and the `lg`-breakpoint [defaultCols]/[defaultRows] (the auto-flow layout
 * input — see the layout note in the file header).
 */
data class WidgetDef(
    val id: String,
    val name: String,
    val category: WidgetCategory,
    val icon: WidgetIconKind,
    val defaultCols: Int,
    val defaultRows: Int,
)

/**
 * The embedded slice of the web widget registry (web widgets/registry) the presets reference — the native
 * analogue of `getWidgetDef`. A feature view may not expand a shared registry from a surface prompt, so the
 * 38 referenced widgets are inlined here, keyed by id. Unknown ids resolve to `null`, exactly like the web
 * `getWidgetDef` returning `undefined`.
 */
val WIDGET_REGISTRY: Map<String, WidgetDef> =
    listOf(
        WidgetDef("onboarding-checklist", "Setup Checklist", WidgetCategory.System, WidgetIconKind.Rocket, 2, 4),
        WidgetDef("vehicle-hero", "Vehicle Card", WidgetCategory.Vehicle, WidgetIconKind.Car, 2, 9),
        WidgetDef("battery-gauge", "Battery Level", WidgetCategory.Battery, WidgetIconKind.Battery, 1, 2),
        WidgetDef("climate-status", "Climate", WidgetCategory.Climate, WidgetIconKind.Thermometer, 1, 2),
        WidgetDef("recent-drives", "Recent Drives", WidgetCategory.Driving, WidgetIconKind.Car, 2, 4),
        WidgetDef("charge-status", "Charge Status", WidgetCategory.Charging, WidgetIconKind.Zap, 2, 2),
        WidgetDef("security-status", "Security", WidgetCategory.Security, WidgetIconKind.Shield, 1, 2),
        WidgetDef("quick-nav", "Quick Navigation", WidgetCategory.System, WidgetIconKind.MapPin, 4, 2),
        WidgetDef("range-estimate", "Range Estimate", WidgetCategory.Battery, WidgetIconKind.Gauge, 1, 2),
        WidgetDef("location-map", "Vehicle Location Map", WidgetCategory.Maps, WidgetIconKind.MapPin, 2, 4),
        WidgetDef("fleet-stats", "Fleet Stats", WidgetCategory.Analytics, WidgetIconKind.BarChart, 4, 2),
        WidgetDef("charge-history", "Charge History", WidgetCategory.Charging, WidgetIconKind.BarChart, 2, 4),
        WidgetDef("drive-score", "Driving Score", WidgetCategory.Driving, WidgetIconKind.TrendingUp, 1, 2),
        WidgetDef("live-signals", "Live Signals", WidgetCategory.Telemetry, WidgetIconKind.Wifi, 2, 4),
        WidgetDef("energy-flow", "Energy Flow", WidgetCategory.Battery, WidgetIconKind.Activity, 2, 4),
        WidgetDef("vehicle-twin", "Digital Twin", WidgetCategory.Vehicle, WidgetIconKind.Monitor, 2, 4),
        WidgetDef("charge-status-live", "Charge Status Live", WidgetCategory.Charging, WidgetIconKind.Zap, 2, 2),
        WidgetDef("battery-radial-gauge", "Battery Radial Gauge", WidgetCategory.Battery, WidgetIconKind.Battery, 1, 2),
        WidgetDef("charge-session-chart", "Charge Session Chart", WidgetCategory.Charging, WidgetIconKind.Zap, 2, 4),
        WidgetDef(
            "charge-cost-tracker",
            "Charge Cost Tracker",
            WidgetCategory.Charging,
            WidgetIconKind.DollarSign,
            2,
            2,
        ),
        WidgetDef("charging-schedule", "Charging Schedule", WidgetCategory.Charging, WidgetIconKind.Calendar, 2, 2),
        WidgetDef("range-bar", "Range Bar", WidgetCategory.Battery, WidgetIconKind.Gauge, 2, 2),
        WidgetDef("energy-flow-animated", "Energy Flow Animated", WidgetCategory.Energy, WidgetIconKind.Workflow, 2, 4),
        WidgetDef("door-window-status", "Door & Window Status", WidgetCategory.Security, WidgetIconKind.DoorOpen, 2, 2),
        WidgetDef("sentry-event-log", "Sentry Event Log", WidgetCategory.Security, WidgetIconKind.Eye, 2, 4),
        WidgetDef("vehicle-hero-card", "Vehicle Hero Card", WidgetCategory.Vehicle, WidgetIconKind.CreditCard, 2, 2),
        WidgetDef("alert-feed", "Alert Feed", WidgetCategory.Alerts, WidgetIconKind.Bell, 2, 4),
        WidgetDef("command-quick-actions", "Quick Actions", WidgetCategory.Commands, WidgetIconKind.Command, 2, 2),
        WidgetDef("weather-at-car", "Weather at Car", WidgetCategory.Climate, WidgetIconKind.CloudSun, 1, 2),
        WidgetDef("tire-pressure-visual", "Tire Pressure Visual", WidgetCategory.Tires, WidgetIconKind.CircleDot, 2, 4),
        WidgetDef(
            "climate-control-panel",
            "Climate Control Panel",
            WidgetCategory.Climate,
            WidgetIconKind.Thermometer,
            2,
            4,
        ),
        WidgetDef("recent-drives-list", "Recent Drives List", WidgetCategory.Driving, WidgetIconKind.List, 2, 4),
        WidgetDef(
            "drive-efficiency-chart",
            "Drive Efficiency Chart",
            WidgetCategory.Driving,
            WidgetIconKind.TrendingUp,
            2,
            4,
        ),
        WidgetDef("drive-score-gauge", "Drive Score Gauge", WidgetCategory.Driving, WidgetIconKind.Gauge, 1, 2),
        WidgetDef("speed-heatmap", "Speed Heatmap", WidgetCategory.Driving, WidgetIconKind.Grid, 2, 4),
        WidgetDef(
            "battery-degradation-trend",
            "Battery Degradation Trend",
            WidgetCategory.Battery,
            WidgetIconKind.TrendingUp,
            2,
            4,
        ),
        WidgetDef(
            "live-signal-sparklines",
            "Live Signal Sparklines",
            WidgetCategory.Telemetry,
            WidgetIconKind.Activity,
            2,
            4,
        ),
        WidgetDef("uptime-monitor", "Uptime Monitor", WidgetCategory.System, WidgetIconKind.HeartPulse, 2, 2),
    ).associateBy { it.id }

/**
 * The native mirror of the slice of a web `SavedDashboard` a template card reads: the preset [id] (the apply
 * target + the i18n key suffix), the registry display [name] (the web `t()` fallback), and the ordered
 * [widgetIds] (the widget instances, web `template.widgets`). The host's shared P1/S8 state-holder supplies
 * these — the view performs no HTTP; [DASHBOARD_PRESETS] is the built-in catalog.
 */
data class DashboardTemplateData(
    val id: String,
    val name: String,
    val widgetIds: List<String>,
)

/**
 * The built-in dashboard template catalog — the native analogue of the web `DASHBOARD_PRESETS` constant
 * (web hooks/useDashboardLayout.ts: DEFAULT_DASHBOARD + 9 makePreset). Preserved in declaration order, so
 * the gallery renders them in the same order the web maps them.
 */
val DASHBOARD_PRESETS: List<DashboardTemplateData> =
    listOf(
        DashboardTemplateData(
            "default",
            "Default",
            listOf(
                "onboarding-checklist",
                "vehicle-hero",
                "battery-gauge",
                "climate-status",
                "recent-drives",
                "charge-status",
                "security-status",
                "quick-nav",
            ),
        ),
        DashboardTemplateData(
            "commuter",
            "Daily Commuter",
            listOf(
                "battery-gauge",
                "range-estimate",
                "charge-status",
                "climate-status",
                "security-status",
                "location-map",
                "quick-nav",
            ),
        ),
        DashboardTemplateData(
            "fleet_manager",
            "Fleet Manager",
            listOf("fleet-stats", "recent-drives", "charge-history", "drive-score", "vehicle-hero", "quick-nav"),
        ),
        DashboardTemplateData(
            "data_nerd",
            "Data Nerd",
            listOf("live-signals", "energy-flow", "vehicle-twin", "battery-gauge", "drive-score"),
        ),
        DashboardTemplateData(
            "charging_focus",
            "Charging Hub",
            listOf(
                "charge-status-live",
                "battery-radial-gauge",
                "charge-session-chart",
                "charge-cost-tracker",
                "charging-schedule",
                "range-bar",
                "energy-flow-animated",
            ),
        ),
        DashboardTemplateData(
            "security_monitor",
            "Security Monitor",
            listOf(
                "door-window-status",
                "sentry-event-log",
                "location-map",
                "vehicle-hero-card",
                "alert-feed",
                "command-quick-actions",
            ),
        ),
        DashboardTemplateData(
            "road_trip",
            "Road Trip",
            listOf(
                "battery-radial-gauge",
                "range-bar",
                "location-map",
                "weather-at-car",
                "tire-pressure-visual",
                "climate-control-panel",
                "recent-drives-list",
                "drive-efficiency-chart",
            ),
        ),
        DashboardTemplateData(
            "performance",
            "Performance",
            listOf(
                "drive-score-gauge",
                "speed-heatmap",
                "drive-efficiency-chart",
                "battery-degradation-trend",
                "energy-flow-animated",
                "live-signal-sparklines",
            ),
        ),
        DashboardTemplateData(
            "kiosk_wall",
            "Wall Display",
            listOf(
                "vehicle-hero",
                "battery-radial-gauge",
                "charge-status-live",
                "location-map",
                "weather-at-car",
                "uptime-monitor",
            ),
        ),
        DashboardTemplateData(
            "minimal",
            "Minimal",
            listOf("battery-radial-gauge", "charge-status", "climate-status", "quick-nav"),
        ),
    )

/**
 * One positioned tile in a template's mini-grid preview — the native analogue of a web MiniGridPreview cell.
 * [x]/[y] are grid-cell offsets and [w]/[h] cell spans in the [GRID_COLS_LG]×maxY space; [icon] is the
 * widget's glyph, or `null` when the widget id is unknown (web renders an empty cell).
 */
data class GridTile(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
    val icon: WidgetIconKind?,
)

/**
 * A fully laid-out mini-grid preview — the native analogue of the data MiniGridPreview reads from
 * `dashboard.layouts.lg`. [cols] is always [GRID_COLS_LG]; [maxY] is the grid height the tiles are scaled
 * against (web `safeMaxY`); [tiles] preserves widget order.
 */
data class MiniGridProjection(
    val cols: Int,
    val maxY: Int,
    val tiles: List<GridTile>,
)

/** A unique category's representative icon — the native analogue of one web `useCategoryIcons` entry. */
data class CategoryIcon(
    val category: WidgetCategory,
    val icon: WidgetIconKind,
)

/** One widget shown in the detail view's icon+name grid — the native analogue of a web `getWidgetDef` row. */
data class WidgetProjection(
    val icon: WidgetIconKind,
    val name: String,
)

/**
 * A fully projected, render-ready template — the native analogue of everything a web `TemplateCard` /
 * `TemplateDetail` reads. Pure data (no Compose types): the composable resolves the localized name and
 * description from [id] (falling back to [name]), formats [widgetCount], maps each [WidgetIconKind] to a
 * glyph, and renders [miniGrid] / [categoryIcons] / [widgets].
 */
data class TemplateProjection(
    val id: String,
    val name: String,
    val widgetCount: Int,
    val categoryIcons: List<CategoryIcon>,
    val widgets: List<WidgetProjection>,
    val miniGrid: MiniGridProjection,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component
 * reads from `DASHBOARD_PRESETS`. [templates] preserves the received order; [isEmpty] drives the empty
 * branch (no templates resolved).
 */
data class TemplateGalleryProjectionResult(
    val templates: List<TemplateProjection>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-preset
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object TemplateGalleryProjection {
    /**
     * Projects [templates] into render-ready cards, preserving the received order (the web map order).
     * [TemplateGalleryProjectionResult.isEmpty] is `true` when there are no templates.
     */
    fun project(templates: List<DashboardTemplateData>): TemplateGalleryProjectionResult {
        val projected = templates.map(::projectTemplate)
        return TemplateGalleryProjectionResult(templates = projected, isEmpty = projected.isEmpty())
    }

    /** Projects a single [template] into its render-ready card (mini-grid, category icons, widget list). */
    fun projectTemplate(template: DashboardTemplateData): TemplateProjection =
        TemplateProjection(
            id = template.id,
            name = template.name,
            widgetCount = template.widgetIds.size,
            categoryIcons = categoryIcons(template.widgetIds),
            widgets =
                template.widgetIds.mapNotNull { id ->
                    WIDGET_REGISTRY[id]?.let { WidgetProjection(icon = it.icon, name = it.name) }
                },
            miniGrid = buildMiniGrid(template.widgetIds),
        )
}

/**
 * Reproduces the web `buildDefaultLayouts` auto-flow placement at the `lg` (4-column) breakpoint: each
 * widget is placed left-to-right at its [WidgetDef.defaultCols]×[WidgetDef.defaultRows] span, wrapping to a
 * new row (advanced by the tallest tile in the row) when it would overflow [GRID_COLS_LG]. Unknown widget
 * ids fall back to a 1×1 tile with no icon (web buildLayoutItem `def?.… ?? 1`).
 */
fun buildMiniGrid(widgetIds: List<String>): MiniGridProjection {
    val cols = GRID_COLS_LG
    var x = 0
    var y = 0
    var rowMaxH = 0
    val tiles = ArrayList<GridTile>(widgetIds.size)
    for (id in widgetIds) {
        val def = WIDGET_REGISTRY[id]
        val w = minOf(def?.defaultCols ?: 1, cols)
        val h = def?.defaultRows ?: 1
        if (x + w > cols) {
            x = 0
            y += rowMaxH
            rowMaxH = 0
        }
        tiles += GridTile(x = x, y = y, w = w, h = h, icon = def?.icon)
        x += w
        rowMaxH = maxOf(rowMaxH, h)
    }
    val maxY = tiles.maxOfOrNull { it.y + it.h }?.takeIf { it > 0 } ?: DEFAULT_MAX_Y
    return MiniGridProjection(cols = cols, maxY = maxY, tiles = tiles)
}

/**
 * Reproduces the web `useCategoryIcons`: walks the widgets in order and collects each category's first
 * widget's icon, de-duplicated by category and capped at [MAX_CATEGORY_ICONS]. Unknown ids are skipped (web
 * `if (def && !seen.has(def.category))`). `distinctBy` keeps the first widget per category (web `seen` set).
 */
fun categoryIcons(widgetIds: List<String>): List<CategoryIcon> =
    widgetIds
        .mapNotNull { WIDGET_REGISTRY[it] }
        .distinctBy { it.category }
        .take(MAX_CATEGORY_ICONS)
        .map { CategoryIcon(category = it.category, icon = it.icon) }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TemplateGalleryRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordTemplateGalleryOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TemplateGalleryRegistration.SLUG))
}
