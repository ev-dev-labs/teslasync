// Pure, framework-free model + projection for the OverviewTab feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/OverviewTab.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the analytics page) passes the
// `FleetAnalytics` document down and the tab reads three slices of it: `vehicle_comparison` (the
// "Distance by Vehicle" bars), `drive_analytics.day_of_week` (the drives + avg-distance combo), and
// `charging_analytics.monthly_trend` (the electric/gas cost + savings combo). This file models exactly
// those slices ([OverviewData]) plus the parts the web render derives from them: the per-chart series
// projections with the web `safe(...)` zero-guard, the SI→display distance conversion the first chart
// applies (web `convertDistanceFromSI(safe(v.distance) * 1000, unit)`), the locale-grouped axis
// formatting, the static Quick Links list, and the PII-safe `view.opened` diagnostic.
//
// The Quick Links labels resolve through the i18n facade by name with a documented fallback — the web
// uses `t(link.labelKey, link.labelKey.split('.').pop())` and the `analytics.links.*` keys are absent
// from the shared catalog, so [resolveOptional] mirrors that exact "key if present, else last-segment
// default" behaviour (the same approach the sibling ReferenceLinksSection surface takes).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/OverviewTab — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.overviewtab

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Backend `vehicle_comparison[].distance` is SI km; the web multiplies by this before `convertDistanceFromSI`. */
private const val METERS_PER_KM: Double = 1000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object OverviewTabRegistration {
    /** Stable surface id. */
    const val ID: String = "overview-tab"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OverviewTab"
}

/**
 * One vehicle's row from the web `vehicle_comparison`, reduced to the two fields the OverviewTab
 * "Distance by Vehicle" bars read: the [name] label and the SI [distanceKm] (kilometres, the backend's
 * SI-derived value). The remaining comparison fields (energy, efficiency, drives) belong to the separate
 * OverviewVehicleComparison surface and are intentionally not modelled here.
 */
data class OverviewVehicle(
    val name: String,
    val distanceKm: Double,
)

/**
 * One day-of-week tally — the native mirror of a web `drive_analytics.day_of_week` entry. [day] is the
 * label, [drives] the non-negative drive count, and [avgDistanceKm] the average distance the web plots on
 * the secondary axis verbatim (no unit conversion — matching the web `<Line dataKey="avg_distance" />`).
 */
data class DayOfWeekPoint(
    val day: String,
    val drives: Long,
    val avgDistanceKm: Double,
)

/**
 * One month's cost comparison — the native mirror of a web `charging_analytics.monthly_trend` entry. The
 * three plotted values are the [cost] (electric), the [gasCost] (modelled gasoline equivalent), and the
 * [savings]; all are currency amounts plotted verbatim, exactly as the web does.
 */
data class MonthlyCostPoint(
    val month: String,
    val cost: Double,
    val gasCost: Double,
    val savings: Double,
)

/**
 * The three FleetAnalytics slices the OverviewTab renders, already extracted from the document by the
 * host (the web reads `data?.vehicle_comparison`, `data?.drive_analytics?.day_of_week`, and
 * `data?.charging_analytics?.monthly_trend`, each `?? []`). An absent document maps to all-empty lists, so
 * the surface shows each panel's own empty state rather than a blank box — the web behaviour exactly.
 */
data class OverviewData(
    val vehicles: List<OverviewVehicle> = emptyList(),
    val dayOfWeek: List<DayOfWeekPoint> = emptyList(),
    val monthly: List<MonthlyCostPoint> = emptyList(),
)

/** Render-ready inputs for the single-series "Distance by Vehicle" bar chart. */
data class VehicleDistanceProjection(
    val xLabels: List<String>,
    val values: List<Double>,
    val isEmpty: Boolean,
)

/** Render-ready inputs for the "Day of Week Pattern" combo chart (drives bars + avg-distance line). */
data class DayOfWeekProjection(
    val xLabels: List<String>,
    val drives: List<Double>,
    val avgDistance: List<Double>,
    val isEmpty: Boolean,
)

/** Render-ready inputs for the "Monthly Cost Comparison" combo chart (cost + gas-cost bars + savings line). */
data class MonthlyCostProjection(
    val xLabels: List<String>,
    val cost: List<Double>,
    val gasCost: List<Double>,
    val savings: List<Double>,
    val isEmpty: Boolean,
)

/**
 * The pure projections the composable renders — the native mirror of the web component's chart data
 * mappings. Stateless and side-effect-free so they are fully covered by the off-device unit gate; the
 * composable only resolves localized strings, design-token colors, and glyphs and draws what these return.
 */
object OverviewTabProjection {
    /**
     * The web `safe(v)` zero-guard: coerces a missing or non-finite number to `0.0` so a `null`/`NaN`
     * value can never corrupt a bar height or an axis scale (web `Number.isFinite(v) ? v : 0`).
     */
    fun safe(value: Double?): Double = if (value == null || !value.isFinite()) 0.0 else value

    /**
     * Projects the vehicle rows into the "Distance by Vehicle" bars, preserving the received order. Each
     * value applies the web conversion `convertDistanceFromSI(safe(distanceKm) * 1000, unit)` — the
     * km-to-metres widen then the SI→display conversion — so miles vs kilometres matches the web exactly.
     */
    fun vehicleDistance(
        vehicles: List<OverviewVehicle>,
        distanceUnit: DistanceUnitPref,
    ): VehicleDistanceProjection =
        VehicleDistanceProjection(
            xLabels = vehicles.map { it.name },
            values = vehicles.map { convertDistanceFromSI(safe(it.distanceKm) * METERS_PER_KM, distanceUnit) },
            isEmpty = vehicles.isEmpty(),
        )

    /**
     * Projects the day-of-week rows into the combo chart's two series, preserving order: the integer
     * [DayOfWeekPoint.drives] counts widened to chart `Double`s, and the [DayOfWeekPoint.avgDistanceKm]
     * line values guarded by [safe] (plotted verbatim, as the web does — no unit conversion here).
     */
    fun dayOfWeek(points: List<DayOfWeekPoint>): DayOfWeekProjection =
        DayOfWeekProjection(
            xLabels = points.map { it.day },
            // `+ 0.0` widens each Long count to the chart series' Double value type.
            drives = points.map { it.drives + 0.0 },
            avgDistance = points.map { safe(it.avgDistanceKm) },
            isEmpty = points.isEmpty(),
        )

    /**
     * Projects the monthly-trend rows into the combo chart's three series (electric cost + gas cost bars
     * and the savings line), preserving order and guarding every value with [safe].
     */
    fun monthly(points: List<MonthlyCostPoint>): MonthlyCostProjection =
        MonthlyCostProjection(
            xLabels = points.map { it.month },
            cost = points.map { safe(it.cost) },
            gasCost = points.map { safe(it.gasCost) },
            savings = points.map { safe(it.savings) },
            isEmpty = points.isEmpty(),
        )

    /**
     * Locale-aware grouped axis formatter — groups thousands and keeps at most one fractional digit,
     * rounding half away from zero so the output matches the web `Intl.NumberFormat` default rather than
     * Java's banker's rounding (e.g. `1234.56 → "1,234.6"`, `42.0 → "42"`).
     */
    fun formatValue(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String =
        DecimalFormat("#,##0.#", DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the three chart
 * panel titles, the Quick Links panel title, the combo-chart series labels, the three per-chart empty
 * messages, and the resolved [quickLinks] items. The lifecycle-chrome strings (loading / error / retry /
 * offline / freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin
 * content carrier.
 */
data class OverviewTabStrings(
    val distByVehicleTitle: String,
    val dayOfWeekTitle: String,
    val monthlyCostTitle: String,
    val quickLinksTitle: String,
    val drivesLabel: String,
    val avgDistLabel: String,
    val electricCostLabel: String,
    val gasCostLabel: String,
    val savingsLabel: String,
    val noVehicles: String,
    val noDow: String,
    val noMonthly: String,
    val quickLinks: List<QuickLinkItem>,
)

/** Identity of a Quick Links glyph; the composable maps each to a locally authored lucide-style vector. */
enum class QuickLinkGlyph { BarChart, Activity, Calendar, MapPin, Clock }

/**
 * The five static Quick Links the web `QUICK_LINKS` constant defines, in source order. Each carries its
 * web i18n [labelKey], the derived Android catalog [androidResourceName] attempted at render time, the
 * [defaultLabel] fallback (the web `key.split('.').pop()` last segment, used when the catalog lacks the
 * key), the internal navigation [route] (the web `href`), and its [glyph] identity.
 */
enum class QuickLink(
    val labelKey: String,
    val androidResourceName: String,
    val defaultLabel: String,
    val route: String,
    val glyph: QuickLinkGlyph,
) {
    Statistics(
        "analytics.links.statistics",
        "translation_analytics_links_statistics",
        "statistics",
        "/statistics",
        QuickLinkGlyph.BarChart,
    ),
    Compare(
        "analytics.links.compare",
        "translation_analytics_links_compare",
        "compare",
        "/period-compare",
        QuickLinkGlyph.Activity,
    ),
    WeeklyDigest(
        "analytics.links.weeklyDigest",
        "translation_analytics_links_weeklyDigest",
        "weeklyDigest",
        "/weekly-digest",
        QuickLinkGlyph.Calendar,
    ),
    Mileage(
        "analytics.links.mileage",
        "translation_analytics_links_mileage",
        "mileage",
        "/mileage",
        QuickLinkGlyph.MapPin,
    ),
    Timeline(
        "analytics.links.timeline",
        "translation_analytics_links_timeline",
        "timeline",
        "/timeline",
        QuickLinkGlyph.Clock,
    ),
}

/** One render-ready Quick Link: its resolved [label], navigation [route], and [glyph]. */
data class QuickLinkItem(
    val label: String,
    val route: String,
    val glyph: QuickLinkGlyph,
)

/**
 * Reproduces the web `t(key, default)`: returns the catalog value from [lookup] when present and
 * non-blank, otherwise the documented [default]. Pure (the composable supplies the by-name lookup), so it
 * is unit-tested without an Android context.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    default: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: default

/** Builds the ordered Quick Links list, resolving each label through [labelFor] (catalog key or fallback). */
object OverviewQuickLinks {
    fun items(labelFor: (QuickLink) -> String): List<QuickLinkItem> =
        QuickLink.entries.map { link ->
            QuickLinkItem(label = labelFor(link), route = link.route, glyph = link.glyph)
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [OverviewTabRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordOverviewTabOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to OverviewTabRegistration.SLUG))
}
