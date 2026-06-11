// Pure, framework-free model + projection for the Reference Links feature view — the native analogue of
// the data + composition the web component derives before returning JSX
// (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx, which maps the static
// REFERENCE_LINKS constant from ./constants.ts). No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is purely presentational — it renders `REFERENCE_LINKS.map(...)` over a static,
// compile-time constant and binds no data hook (its only hook is `useTranslation`). There is therefore no
// loading / error / stale / offline branch in the source to reproduce; the single async-free surface state
// is the rendered grid. The grid is list-shaped, so an [ReferenceLinksProjection.items] result that is
// empty is still handled gracefully by the composable (a friendly empty state, never a blank box) even
// though the bundled constant is never empty.
//
// i18n note (web parity): the web source renders each card title via `t(link.title)` where `link.title`
// is a key such as `devtools.ref.fleetOverview`. Those four keys are absent from BOTH the web catalog
// (web/src/i18n/en.json has a `devtools` section but no `ref` subtree) AND the shared neutral catalog
// (apps/shared/i18n/catalog — only `devtools.fleet.*` / `devtools.health.*` exist), and the web call
// passes no inline default, so i18next returns the raw key string at runtime today. The shared catalog is
// generated and drift-checked (ADR-014) so it must not be hand-authored. This model therefore mirrors the
// QuickNav precedent's `resolveOptional(key, default)` shape: the composable first attempts the canonical
// catalog key by name (so the proper localized title renders the moment the catalog ever generates it —
// resolving through the P1/S10 facade exactly as required), and otherwise falls back to the documented
// human-readable title in [ReferenceLinkDefaults] rather than surfacing a raw dotted key. This divergence
// from the web's raw-key gap is intentional and documented (never silent).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ReferenceLinksSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.referencelinks

/**
 * The four lucide glyphs the web source maps via its ICON_MAP (`BookOpen`, `Globe`, `ExternalLink`,
 * `Radio`). Kept as a pure enum so the projection stays free of Compose `ImageVector` types; the composable
 * maps each case onto its native glyph in `glyphFor`.
 */
enum class ReferenceLinkGlyph { BookOpen, Globe, ExternalLink, Radio }

/**
 * One reference link, in the exact web `REFERENCE_LINKS` render order. Pure identity only: the external
 * [url] the card opens, the [glyph] selector, the web i18n [webI18nKey] (verbatim from the source's
 * `link.title`, for parity documentation), and the generated-catalog [androidResourceName] the composable
 * resolves by name (the `translation.`-prefixed key with dots folded to underscores, e.g.
 * `translation_devtools_ref_fleetOverview`).
 */
enum class ReferenceLinkTarget(
    val url: String,
    val glyph: ReferenceLinkGlyph,
    val webI18nKey: String,
    val androidResourceName: String,
) {
    /** Web `{ title: 'devtools.ref.fleetOverview', url: '…/docs/fleet-api', icon: 'BookOpen' }`. */
    FLEET_OVERVIEW(
        url = "https://developer.tesla.com/docs/fleet-api",
        glyph = ReferenceLinkGlyph.BookOpen,
        webI18nKey = "devtools.ref.fleetOverview",
        androidResourceName = "translation_devtools_ref_fleetOverview",
    ),

    /** Web `{ title: 'devtools.ref.partnerEndpoints', url: '…/partner-endpoints#register', icon: 'Globe' }`. */
    PARTNER_ENDPOINTS(
        url = "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register",
        glyph = ReferenceLinkGlyph.Globe,
        webI18nKey = "devtools.ref.partnerEndpoints",
        androidResourceName = "translation_devtools_ref_partnerEndpoints",
    ),

    /** Web `{ title: 'devtools.ref.devPortal', url: 'https://developer.tesla.com', icon: 'ExternalLink' }`. */
    DEV_PORTAL(
        url = "https://developer.tesla.com",
        glyph = ReferenceLinkGlyph.ExternalLink,
        webI18nKey = "devtools.ref.devPortal",
        androidResourceName = "translation_devtools_ref_devPortal",
    ),

    /** Web `{ title: 'devtools.ref.telemetryGuide', url: '…/fleet-telemetry', icon: 'Radio' }`. */
    TELEMETRY_GUIDE(
        url = "https://developer.tesla.com/docs/fleet-api/fleet-telemetry",
        glyph = ReferenceLinkGlyph.Radio,
        webI18nKey = "devtools.ref.telemetryGuide",
        androidResourceName = "translation_devtools_ref_telemetryGuide",
    ),
}

/**
 * Canonical metadata for this surface. There is no web dashboard-registry entry to mirror (the web
 * `ReferenceLinksSection` is a composed section of the devtools page, not a draggable widget), so this
 * object carries only the cross-cutting concern every surface owes: the diagnostics surface [SLUG] emitted
 * with the one-shot `view.opened` event (P1/S11) and the responsive column policy.
 */
object ReferenceLinksRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ReferenceLinksSection"

    /** Inner column count at compact width — the web base grid (no `grid-cols-*`) is a single column. */
    const val COMPACT_COLUMNS = 1

    /** Inner column count at medium width — the web `sm:grid-cols-2` breakpoint. */
    const val MEDIUM_COLUMNS = 2

    /** Inner column count at expanded width — the web `lg:grid-cols-4` breakpoint. */
    const val EXPANDED_COLUMNS = 4
}

/**
 * The localized strings the surface folds in: the four card titles (web `t(link.title)`) plus the message
 * shown if the link list ever resolves empty (web renders an empty grid; the native surface shows a
 * friendly empty state instead of a blank box). The composable builds this from the i18n facade; tests pass
 * a deterministic instance.
 */
data class ReferenceLinkStrings(
    val fleetOverviewTitle: String,
    val partnerEndpointsTitle: String,
    val devPortalTitle: String,
    val telemetryGuideTitle: String,
    val emptyMessage: String,
) {
    /** The title for [target], in web render order. */
    fun titleFor(target: ReferenceLinkTarget): String =
        when (target) {
            ReferenceLinkTarget.FLEET_OVERVIEW -> fleetOverviewTitle
            ReferenceLinkTarget.PARTNER_ENDPOINTS -> partnerEndpointsTitle
            ReferenceLinkTarget.DEV_PORTAL -> devPortalTitle
            ReferenceLinkTarget.TELEMETRY_GUIDE -> telemetryGuideTitle
        }
}

/**
 * The documented human-readable fallback titles, used only when the canonical `translation.devtools.ref.*`
 * key is absent from the generated catalog (which it is today — see the file header). The web source passes
 * no inline default to `t(link.title)`, so these are derived from each link's semantics and the Tesla
 * developer-docs URL it points to; they keep the surface production-polished instead of reproducing the
 * web's raw-key gap. Documented here (not silent) per the honesty covenant.
 */
object ReferenceLinkDefaults {
    /** Fallback for `devtools.ref.fleetOverview` → https://developer.tesla.com/docs/fleet-api. */
    const val FLEET_OVERVIEW_TITLE = "Fleet API Overview"

    /** Fallback for `devtools.ref.partnerEndpoints` → …/endpoints/partner-endpoints#register. */
    const val PARTNER_ENDPOINTS_TITLE = "Partner Endpoints"

    /** Fallback for `devtools.ref.devPortal` → https://developer.tesla.com. */
    const val DEV_PORTAL_TITLE = "Developer Portal"

    /** Fallback for `devtools.ref.telemetryGuide` → …/fleet-api/fleet-telemetry. */
    const val TELEMETRY_GUIDE_TITLE = "Fleet Telemetry Guide"
}

/**
 * One render-ready card: its [target] (the tap target + url + glyph selector), the localized [title], the
 * external [url] shown beneath the title, and a folded TalkBack [contentDescription]. Pure data (no Compose
 * types) so the projection is unit-tested without a UI host; the composable maps [target]'s glyph onto an
 * `ImageVector` and wires the tap to open [url].
 */
data class ReferenceLinkItem(
    val target: ReferenceLinkTarget,
    val title: String,
    val url: String,
    val glyph: ReferenceLinkGlyph,
    val contentDescription: String,
)

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Pure projection from the localized [ReferenceLinkStrings] to the render-ready [ReferenceLinkItem]s, in the
 * web `REFERENCE_LINKS` order. The folded [ReferenceLinkItem.contentDescription] is `"<title>, <url>"` so
 * each card reads as a single TalkBack node mirroring its visible content. Also owns the responsive column
 * count, the native adaptation of the web `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` breakpoints.
 */
object ReferenceLinksProjection {
    /** The reference cards in web render order. */
    fun items(strings: ReferenceLinkStrings): List<ReferenceLinkItem> =
        ReferenceLinkTarget.entries.map { target ->
            val title = strings.titleFor(target)
            ReferenceLinkItem(
                target = target,
                title = title,
                url = target.url,
                glyph = target.glyph,
                contentDescription = "$title, ${target.url}",
            )
        }

    /**
     * The inner column count for the given [width] bucket — Compact → 1 (web base grid), Medium → 2 (web
     * `sm:grid-cols-2`), Expanded → 4 (web `lg:grid-cols-4`). Framework-free `Int` so it is JVM-unit-tested.
     */
    fun columnCount(width: ReferenceLinksWidth): Int =
        when (width) {
            ReferenceLinksWidth.Compact -> ReferenceLinksRegistration.COMPACT_COLUMNS
            ReferenceLinksWidth.Medium -> ReferenceLinksRegistration.MEDIUM_COLUMNS
            ReferenceLinksWidth.Expanded -> ReferenceLinksRegistration.EXPANDED_COLUMNS
        }
}

/**
 * Framework-free window-width bucket the column policy keys off, decoupling the pure projection from the
 * Material 3 `WindowWidthSizeClass` (mapped at the Compose edge in the composable, mirroring the app-wide
 * `io.teslasync.android.navigation.WindowWidth`). Kept local so the projection has no navigation dependency.
 */
enum class ReferenceLinksWidth { Compact, Medium, Expanded }
