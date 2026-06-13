// Pure, framework-free model + visibility math + render classifier + diagnostics for the PageHeaderSticky shared
// surface — the native analogue of every decision the web component makes (web/src/components/layout/
// PageHeaderSticky.tsx) before it paints its sticky bar. No Compose, no Android, no HTTP: every declaration here
// is exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web component is a
// PURE, presentational layout-chrome control driven by one signal: an IntersectionObserver watching a page "hero"
// element (the overview card identified by `targetId`). Its only logic is the visibility decision and the
// optional scroll-to-top affordance — there is NO hook, NO fetch, and NO data port to bind (no P1/S8 state
// holder, no Source/ViewModel); modelling one would invent an async dependency the web spec does not have
// (honesty covenant: no scope narrowing, no silent drift). The closest sibling precedent is the equally
// presentational AlertBanner surface (composable + model, no Source/ViewModel).
//
//   • visibility — `const scrolledPast = entry.boundingClientRect.top < 0;
//                   setVisible(!entry.isIntersecting && scrolledPast)`. The bar appears ONLY once the hero has
//     scrolled fully ABOVE the viewport top, and hides again when it re-enters. The `top < 0` guard is the
//     long-page protection: a hero still BELOW the viewport on first paint also reports `isIntersecting=false`,
//     but must NOT trigger the bar. [stickyHeaderVisible] reproduces this exact two-input decision and
//     [snapshotFromHero] derives the two inputs from native LazyList geometry — the platform IntersectionObserver
//     equivalent (an item is in `visibleItemsInfo` iff it intersects the viewport; its `offset` is the native
//     `boundingClientRect.top`; an absent hero is above iff the first visible index is past it).
//   • affordance — when `scrollToTop` (default true) the WHOLE bar becomes a button with a small up glyph and an
//     `aria-label = "${ariaLabel} — scroll to top"`; when false it is a plain labelled region with neither. The
//     native port conveys "this labelled bar is an actionable scroll-to-top control" idiomatically through a
//     Compose Button role on the [ariaLabel]-labelled node plus the visible up glyph (Material HIG), rather than
//     folding the English words "scroll to top" into the spoken name — so no English literal is hardcoded in
//     native code and the affordance is still announced as a button. [classify] reduces this to the render flags.
//   • body — the web renders whatever `children` (the compressed summary) it is handed. The native surface takes
//     that as a flat [PageHeaderStickyInput.hasSummary] string (the common case) or an arbitrary slot
//     ([PageHeaderStickyInput.hasSlotContent], the faithful port of the `children` ReactNode). The one place this
//     surface improves on a literal port is the empty-body branch: the prompt's "empty -> friendly empty state,
//     never a blank box" contract is honoured by [classify] flagging an empty body so the view renders a
//     localized caption (the existing `common.noData` key) instead of an empty bar.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is presentational layout chrome whose content is handed in by its parent and whose only
// dynamic input is the scroll position. There is no query to be loading, to fail, to go stale, or to be offline,
// so inventing those states would be dishonest (honesty covenant 1/2/9). The surface's REAL, fully-reproduced
// states are: hidden (the hero is in view or still below — renders nothing, faithful to the web
// `if (!visible) return null`, contributing zero layout rather than a blank box), visible with the scroll-to-top
// affordance (default), visible without it (`scrollToTop=false`), and the empty-body fallback. Each is reduced
// here and asserted in the off-device test, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PageHeaderSticky — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AlertBanner / OfflineBanner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageheadersticky

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the PageHeaderSticky surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PageHeaderSticky`); [ID] is
 * the stable key a host can bind the surface with.
 */
object PageHeaderStickyRegistration {
    /** Stable surface id. */
    const val ID: String = "page-header-sticky"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PageHeaderSticky"
}

/**
 * The two IntersectionObserver inputs the web `PageHeaderSticky` decides visibility from, captured as one PII-free
 * value object so the decision is a pure, unit-testable function. Carries no page content and no target id — only
 * the geometry of the watched hero element.
 *
 * @property heroIntersecting the web `entry.isIntersecting` — any part of the hero is currently on screen.
 * @property heroAboveViewport the web `entry.boundingClientRect.top < 0` — the hero's top edge has scrolled above
 *   the trigger line (the user has scrolled PAST it, as opposed to not having reached it yet).
 */
data class StickyScrollSnapshot(
    val heroIntersecting: Boolean,
    val heroAboveViewport: Boolean,
) {
    companion object {
        /** The initial, un-scrolled state: the hero is fully in view at rest, so the bar is hidden. */
        fun atRest(): StickyScrollSnapshot = StickyScrollSnapshot(heroIntersecting = true, heroAboveViewport = false)
    }
}

/**
 * The web visibility decision, verbatim: the sticky bar shows only when the hero is NOT intersecting the viewport
 * AND has scrolled above the trigger line. The `aboveViewport` guard is the long-page protection — a hero still
 * below the viewport on first paint is also non-intersecting but must stay hidden until the user scrolls past it.
 */
fun stickyHeaderVisible(snapshot: StickyScrollSnapshot): Boolean = !snapshot.heroIntersecting && snapshot.heroAboveViewport

/**
 * Derive the two web IntersectionObserver inputs from native LazyList geometry — the platform equivalent of
 * `IntersectionObserver.observe(hero)`. A list item is present in `visibleItemsInfo` exactly when it intersects
 * the viewport (the native `isIntersecting`), and its `offset` is its top relative to the viewport top (the
 * native `boundingClientRect.top`). When the hero is NOT laid out it is either fully above (the first visible
 * index has moved past it) or still below (not yet reached) — only the former is "scrolled past".
 *
 * @param heroItemIndex the index of the hero (overview) item the bar tracks — the native `targetId`.
 * @param firstVisibleItemIndex the list's current first visible item index.
 * @param heroVisibleOffsetPx the hero item's top offset in px when it is laid out, or `null` when it is not.
 * @param topOffsetPx the trigger line inset from the viewport top (the web `topOffset`); defaults to 0.
 */
fun snapshotFromHero(
    heroItemIndex: Int,
    firstVisibleItemIndex: Int,
    heroVisibleOffsetPx: Int?,
    topOffsetPx: Int = 0,
): StickyScrollSnapshot {
    val intersecting = heroVisibleOffsetPx != null
    val aboveViewport =
        if (heroVisibleOffsetPx != null) {
            heroVisibleOffsetPx < topOffsetPx
        } else {
            firstVisibleItemIndex > heroItemIndex
        }
    return StickyScrollSnapshot(heroIntersecting = intersecting, heroAboveViewport = aboveViewport)
}

/**
 * The parent-owned inputs to the bar, bundled into one value object so the pure [classify] reads a single
 * argument — the native mirror of the web `PageHeaderStickyProps` the parent supplies. A blank summary is treated
 * as absent (web falsy `children`).
 *
 * @property visible whether the bar is shown at all (the resolved web `visible` state from [stickyHeaderVisible]).
 * @property scrollToTop whether the bar is a scroll-to-top button with an up glyph (web `scrollToTop`, default true).
 * @property hasSummary whether the parent supplied a non-blank flat summary (the common web `children`).
 * @property hasSlotContent whether the parent supplied an arbitrary body slot (the faithful web `children` node).
 */
data class PageHeaderStickyInput(
    val visible: Boolean,
    val scrollToTop: Boolean = true,
    val hasSummary: Boolean = false,
    val hasSlotContent: Boolean = false,
)

/**
 * The render-ready classification of the bar — everything the view needs to draw, reduced from the parent's props
 * so every branch is exhaustively covered and unit-tested off-device.
 *
 * @property visible the bar renders at all; when false the surface contributes zero layout (web `return null`).
 * @property clickable the whole bar is an actionable scroll-to-top button (web `{scrollToTop && …}`).
 * @property showScrollToTop the trailing up glyph is shown (web `{scrollToTop && <ArrowUp/>}`).
 * @property showSummary a real flat-summary body is shown (web truthy `children`).
 * @property showEmptyFallback no body was supplied — the view shows a localized caption, never a blank bar.
 */
data class PageHeaderStickyRender(
    val visible: Boolean,
    val clickable: Boolean,
    val showScrollToTop: Boolean,
    val showSummary: Boolean,
    val showEmptyFallback: Boolean,
)

/**
 * Reduce the parent's [input] into the render-ready [PageHeaderStickyRender]. Pure (no Compose). An arbitrary slot
 * takes precedence over a flat summary (web `children`); when neither a summary nor a slot is present the body is
 * empty and [PageHeaderStickyRender.showEmptyFallback] is set so the view never paints a blank bar.
 */
fun classify(input: PageHeaderStickyInput): PageHeaderStickyRender {
    val hasBody = input.hasSlotContent || input.hasSummary
    return PageHeaderStickyRender(
        visible = input.visible,
        clickable = input.scrollToTop,
        showScrollToTop = input.scrollToTop,
        showSummary = input.hasSummary && !input.hasSlotContent,
        showEmptyFallback = !hasBody,
    )
}

/**
 * Build the merged accessibility announcement for the bar from its already-localized parts (the view resolves the
 * [ariaLabel] and [body] through props / i18n). Kept pure so TalkBack-label presence is unit-tested without a
 * Compose host. The region name leads; a non-blank body follows so the summary is spoken too. When the body is
 * blank only the [ariaLabel] is announced, so the region is never silent.
 */
fun pageHeaderStickyLabel(
    ariaLabel: String,
    body: String?,
): String {
    val parts = listOfNotNull(ariaLabel, body).map { it.trim() }.filter { it.isNotEmpty() }
    return parts.joinToString(separator = ". ")
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the page
 * content, the target id, or the scroll position — so a diagnostics line can never leak which page a user was on.
 */
object PageHeaderStickyDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = PageHeaderStickyRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
