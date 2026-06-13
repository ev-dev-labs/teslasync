// Pure, framework-free model + render classifier for the Breadcrumbs shared surface — the native analogue of
// every decision the web component makes (web/src/components/layout/Breadcrumbs.tsx) before it paints its trail.
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer over [classify].
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, CONTROLLED presentational component. The parent owns the data — it passes the `items` trail, an
//     optional `homeHref`, and an optional `homeAriaLabel`; the component's only logic is (a) hiding itself when
//     the trail is degenerate and (b) deciding, per entry, whether to draw a link, the current-page label, or a
//     collapsed indicator. Its only hook is `useTranslation` (the two a11y labels), and its only other import is
//     a class-name helper. There is NO data hook, NO fetch, and NO data port to bind (no P1/S8 state holder, no
//     Source/ViewModel) — modelling one would invent an async dependency the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The closest sibling precedents are the equally
//     presentational AlertBanner / AnnouncerRegion / GuardedLink surfaces (composable + model, no Source/VM).
//   • So the surface's REAL, fully-reproduced branches are exactly the ones the web `Breadcrumbs` draws:
//       1. The degenerate-trail guard: `if (items.length <= 1) return null` — a 0- or 1-segment trail renders
//          NOTHING. This is the component's defined contract (a single segment is just "you are here"; there is
//          no trail to show), faithfully reproduced as [BreadcrumbsRender.visible] = false and exercised by the
//          off-device test. It is NOT a hidden data panel — there is no data being withheld, only the documented
//          "no trail yet" contract — so honouring it is parity, not a shortcut.
//       2. The leading Home affordance (always drawn when visible) — a link to `homeHref` labelled by the
//          localized `a11y.breadcrumbHome` ("Dashboard") unless the parent overrides it.
//       3. Per entry: a CURRENT label (the last entry, or any entry with no `href`) vs a LINK (a non-last entry
//          with an `href`) — the web `isLast || !item.href ? <span> : <PrefetchLink>` ternary, reduced here to
//          [CrumbRole].
//       4. The responsive middle-collapse: a MIDDLE entry (`i > 0 && !isLast`) hides its label and shows a "…"
//          indicator on a narrow viewport (web `hidden sm:inline` + `sm:hidden …`), reduced here to
//          [BreadcrumbCrumb.showLabel] / [BreadcrumbCrumb.showEllipsis] driven by the `compact` flag the view
//          derives from the available width (the platform-idiomatic analogue of the web `sm` media query).
//   • The one place this surface hardens the literal port: a blank entry label collapses to a localized
//     fallback ([blankLabelFallback]) so an individual crumb can never render as an empty, tappable box — the
//     "never a blank box" contract applied at the crumb level, where the web would otherwise paint an empty link.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is controlled chrome whose trail is handed in by its parent. There is no query to be
// loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest. The owning
// screen that DOES fetch renders its own data surface and supplies this trail once it knows where the user is.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Breadcrumbs — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AlertBanner / AnnouncerRegion / GuardedLink surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.breadcrumbs

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no labels or hrefs — only this
 * constant identifier — so a diagnostics line can never leak where the user is in the app.
 */
const val BREADCRUMBS_SLUG: String = "Breadcrumbs"

/**
 * Minimum number of trail entries before the breadcrumb renders. The web returns `null` for a 0- or 1-segment
 * trail (`if (items.length <= 1) return null`); the native [classify] mirrors that by reporting
 * [BreadcrumbsRender.visible] = false below this threshold.
 */
const val MIN_VISIBLE_CRUMBS: Int = 2

/**
 * One entry in the breadcrumb trail — the native mirror of the web `BreadcrumbItem`.
 *
 * @property label the visible text for this segment (web `label`).
 * @property href the navigation target; `null` marks the current page with no link (web `href?: undefined`).
 */
data class BreadcrumbItem(
    val label: String,
    val href: String? = null,
)

/**
 * Whether a rendered crumb is an interactive [Link] or a non-interactive [Current] page label — the native
 * reduction of the web `isLast || !item.href ? <span> : <PrefetchLink>` ternary.
 */
enum class CrumbRole {
    /** A non-last entry with an href — a tappable navigation link (web `<PrefetchLink>`). */
    Link,

    /** The last entry, or any entry without an href — the current-page label (web `<span>`). */
    Current,
}

/**
 * The render-ready classification of one trail entry — everything the view needs to draw a single crumb,
 * reduced from a [BreadcrumbItem] plus its position and the viewport's compactness so every branch is covered
 * and unit-tested off-device.
 *
 * @property label the resolved text (the entry label, or [classify]'s blank-label fallback).
 * @property href the navigation target passed to the view's `onNavigate`; non-null only when [role] is [Link].
 * @property role whether this crumb is a [Link] or the [Current] page label.
 * @property isLast this is the final entry — drawn as the emphasized current page (web `font-medium` secondary).
 * @property isMiddle this is an interior entry (`i > 0 && !isLast`) — eligible for the responsive collapse.
 * @property showLabel the entry's label is drawn (false only when a middle entry is collapsed on a narrow view).
 * @property showEllipsis the collapsed "…" indicator is drawn in place of the label (web mobile `sm:hidden …`).
 */
data class BreadcrumbCrumb(
    val label: String,
    val href: String?,
    val role: CrumbRole,
    val isLast: Boolean,
    val isMiddle: Boolean,
    val showLabel: Boolean,
    val showEllipsis: Boolean,
)

/**
 * The render-ready classification of the whole trail — whether it is shown at all (web's `items.length <= 1`
 * guard) and, if so, the per-entry [crumbs]. There is no hidden surface: when [visible] is false the web renders
 * nothing too, which is the component's documented "no trail" contract, not a withheld data panel.
 *
 * @property visible the trail is drawn (`items.size >=` [MIN_VISIBLE_CRUMBS]); false reproduces the web `null`.
 * @property crumbs the per-entry render classifications, in order; empty when [visible] is false.
 */
data class BreadcrumbsRender(
    val visible: Boolean,
    val crumbs: List<BreadcrumbCrumb>,
)

/**
 * Reduce the parent's [items] (plus the [compact] viewport flag the view derives from the available width) into
 * the render-ready [BreadcrumbsRender]. Pure (no Compose).
 *
 * Mirrors the web component exactly: a trail with fewer than [MIN_VISIBLE_CRUMBS] entries is not shown (web
 * `return null`); otherwise each entry becomes a [Link] (a non-last entry with a non-blank href) or the
 * [Current] label (the last entry, or any entry without an href), and an interior entry collapses to a "…"
 * indicator when [compact] (web `hidden sm:inline` / `sm:hidden`). A blank entry label collapses to
 * [blankLabelFallback] so a crumb never renders as an empty box.
 */
fun classify(
    items: List<BreadcrumbItem>,
    compact: Boolean,
    blankLabelFallback: String,
): BreadcrumbsRender {
    if (items.size < MIN_VISIBLE_CRUMBS) {
        return BreadcrumbsRender(visible = false, crumbs = emptyList())
    }
    val lastIndex = items.lastIndex
    val crumbs =
        items.mapIndexed { index, item ->
            val isLast = index == lastIndex
            val isMiddle = index > 0 && !isLast
            val isLink = !isLast && !item.href.isNullOrBlank()
            val collapsed = compact && isMiddle
            BreadcrumbCrumb(
                label = item.label.ifBlank { blankLabelFallback },
                href = if (isLink) item.href else null,
                role = if (isLink) CrumbRole.Link else CrumbRole.Current,
                isLast = isLast,
                isMiddle = isMiddle,
                showLabel = !collapsed,
                showEllipsis = collapsed,
            )
        }
    return BreadcrumbsRender(visible = true, crumbs = crumbs)
}

/**
 * Resolve the leading Home link's accessibility label — the native mirror of the web
 * `homeAriaLabel ?? t('a11y.breadcrumbHome', 'Dashboard')`: the parent's [explicit] override when non-blank,
 * otherwise the localized [fallback]. Kept pure so the label's presence is unit-tested without a Compose host.
 */
fun resolveHomeAriaLabel(
    explicit: String?,
    fallback: String,
): String = explicit?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a label or an
 * href — so a diagnostics line can never leak the user's location in the app.
 */
object BreadcrumbsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = BREADCRUMBS_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
