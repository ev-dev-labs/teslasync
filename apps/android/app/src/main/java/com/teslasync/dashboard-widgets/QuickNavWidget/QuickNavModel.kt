// Pure, framework-free model + projection for the Quick Navigation dashboard widget — the native
// analogue of the data + composition the web component derives before returning JSX
// (web/src/features/dashboard/widgets/QuickNavWidget.tsx, which renders
// web/src/features/dashboard/components/QuickNav.tsx). No Compose, no Android, no HTTP: every type here
// is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. QuickNav is purely presentational — a static four-item shortcut grid (Drives, Charging,
// Analytics, Battery) with no data feed and no unit-bearing values — so there is no display-unit
// conversion and no loading/empty/error/stale/offline branch to model: the only surface state is the
// rendered grid (the web `WidgetShell` is handed neither `loading`/`error` nor a `query`, and `QuickNav`
// fetches nothing). This file owns the stable nav targets, the per-item accent palette, the localized
// label/description fold, and the registry footprint.
//
// i18n note (web parity): the web `QuickNav` reads each label/description through
// `useTranslation('dashboard')` + `t(key, default)`. The web app registers a SINGLE i18next namespace
// (`translation`, see web/src/i18n/index.ts), so the requested `dashboard` namespace is absent and every
// `t('nav.…', default)` resolves to its inline default. The four LABEL keys
// (`translation.nav.{drives,charging,analytics,battery}`) DO exist in the generated neutral catalog
// (apps/shared/i18n/catalog), so the composable resolves them through `stringResource`. The four
// DESCRIPTION keys (`nav.{drives,charging,analytics,battery}Desc`) exist in NO catalog, and the catalog
// is generated and drift-checked (ADR-014) so it must not be hand-authored; [QuickNavDefaults] therefore
// carries the web source's own inline description defaults, and [resolveOptional] reproduces i18next's
// `t(key, default)` exactly — preferring a catalog value if one is ever generated, else the web default.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/QuickNavWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.quicknav

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. QuickNav
 * has no size-conditional content (the web grid always renders the same four shortcuts), so the footprint
 * is carried only to register + clamp the surface in the dashboard grid and to pick the inner column
 * count via [QuickNavRegistration.columnCount].
 */
data class QuickNavSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`quick-nav`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object QuickNavRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "quick-nav"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "QuickNavWidget"

    /** Default footprint: 4 columns × 2 rows (web `defaultSize`). */
    val defaultSize = QuickNavSize(cols = 4, rows = 2)

    /** Minimum footprint: 2 columns × 2 rows (web `minSize`). */
    val minSize = QuickNavSize(cols = 2, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = QuickNavSize(cols = 4, rows = 40)

    /**
     * Footprint at/above which the inner shortcut grid lays the four cards out four-up rather than
     * two-up — the native adaptation of the web `grid-cols-2 sm:grid-cols-4` responsive breakpoint
     * (a narrow widget shows a 2×2 grid; a wide widget shows a single 1×4 row).
     */
    const val WIDE_COLUMN_THRESHOLD = 3

    /** Inner column count when the footprint is wide (web `sm:grid-cols-4`). */
    const val WIDE_COLUMNS = 4

    /** Inner column count when the footprint is narrow (web `grid-cols-2`). */
    const val NARROW_COLUMNS = 2

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: QuickNavSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: QuickNavSize): QuickNavSize =
        QuickNavSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /** The inner shortcut-grid column count for [size] (web `grid-cols-2 sm:grid-cols-4`). */
    fun columnCount(size: QuickNavSize): Int = if (size.cols >= WIDE_COLUMN_THRESHOLD) WIDE_COLUMNS else NARROW_COLUMNS
}

/**
 * One of the four shortcut targets, in web render order. Pure identity only: [destinationId] is the
 * native navigation-graph id (io.teslasync.android.navigation.Destinations) and [webPath] is the web
 * route the web `QuickNav` links to (`<Link to={…}>`). A host maps the chosen destination onto its
 * `NavHostController` (no view performs navigation itself), keeping this layer framework-free.
 */
enum class QuickNavDestination(
    val destinationId: String,
    val webPath: String,
) {
    /** Web `{ to: '/drives' }`. */
    DRIVES("drives", "/drives"),

    /** Web `{ to: '/charging' }`. */
    CHARGING("charging", "/charging"),

    /** Web `{ to: '/analytics' }`. */
    ANALYTICS("analytics", "/analytics"),

    /** Web `{ to: '/battery' }` (native destination id `batteryHealth`). */
    BATTERY("batteryHealth", "/battery"),
}

/**
 * The eight localized strings the surface folds in — the four web `t('nav.{x}', …)` labels and the four
 * `t('nav.{x}Desc', …)` descriptions. The composable builds this from the i18n facade (labels via
 * `stringResource`, descriptions via [resolveOptional]); tests pass a deterministic instance.
 */
data class QuickNavStrings(
    val drives: String,
    val drivesDesc: String,
    val charging: String,
    val chargingDesc: String,
    val analytics: String,
    val analyticsDesc: String,
    val battery: String,
    val batteryDesc: String,
)

/**
 * One render-ready shortcut card: its [destination] (the tap target + glyph selector), the localized
 * [label] + [description], the [accentArgb] accent colour (the exact web per-item hex, applied to the
 * icon + its tinted background), and a folded TalkBack [contentDescription]. Pure data (no Compose
 * types) so the projection is unit-tested without a UI host; the composable maps [destination] onto a
 * glyph and wraps [accentArgb] in a `Color`.
 */
data class QuickNavItem(
    val destination: QuickNavDestination,
    val label: String,
    val description: String,
    val accentArgb: Long,
    val contentDescription: String,
)

/**
 * The web `QuickNav` description defaults, verbatim from the web source's inline `desc:` fields. They are
 * the fallbacks for the `nav.{x}Desc` keys, which exist in no i18n catalog (and must not be added to the
 * generated, drift-checked catalog — ADR-014). [resolveOptional] uses these exactly as the web `t(key,
 * default)` second argument is used: the description renders from the catalog if the key is ever
 * generated, otherwise from these defaults (which is what the web renders today).
 */
object QuickNavDefaults {
    /** Web `desc: 'Trip history'` for `/drives`. */
    const val DRIVES_DESC = "Trip history"

    /** Web `desc: 'Sessions & costs'` for `/charging`. */
    const val CHARGING_DESC = "Sessions & costs"

    /** Web `desc: 'Fleet insights'` for `/analytics`. */
    const val ANALYTICS_DESC = "Fleet insights"

    /** Web `desc: 'Health & degradation'` for `/battery`. */
    const val BATTERY_DESC = "Health & degradation"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map
 * in tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Pure projection from the localized [QuickNavStrings] to the four render-ready [QuickNavItem]s, in the
 * web `NAV_ITEMS` order (Drives, Charging, Analytics, Battery). Each item carries the exact web accent
 * hex; the folded [QuickNavItem.contentDescription] is `"<label>, <description>"` so the whole card reads
 * as a single TalkBack node.
 */
object QuickNavProjection {
    /** Web `color: '#00f0ff'` — the Drives accent (data-driven, the CHART_COLORS analogue). */
    private const val DRIVES_ACCENT = 0xFF00F0FFL

    /** Web `color: '#10b981'` — the Charging accent. */
    private const val CHARGING_ACCENT = 0xFF10B981L

    /** Web `color: '#a855f7'` — the Analytics accent. */
    private const val ANALYTICS_ACCENT = 0xFFA855F7L

    /** Web `color: '#f59e0b'` — the Battery accent. */
    private const val BATTERY_ACCENT = 0xFFF59E0BL

    /** The four shortcut cards in web render order. */
    fun items(strings: QuickNavStrings): List<QuickNavItem> =
        listOf(
            item(QuickNavDestination.DRIVES, strings.drives, strings.drivesDesc, DRIVES_ACCENT),
            item(QuickNavDestination.CHARGING, strings.charging, strings.chargingDesc, CHARGING_ACCENT),
            item(QuickNavDestination.ANALYTICS, strings.analytics, strings.analyticsDesc, ANALYTICS_ACCENT),
            item(QuickNavDestination.BATTERY, strings.battery, strings.batteryDesc, BATTERY_ACCENT),
        )

    private fun item(
        destination: QuickNavDestination,
        label: String,
        description: String,
        accentArgb: Long,
    ): QuickNavItem =
        QuickNavItem(
            destination = destination,
            label = label,
            description = description,
            accentArgb = accentArgb,
            contentDescription = "$label, $description",
        )
}
