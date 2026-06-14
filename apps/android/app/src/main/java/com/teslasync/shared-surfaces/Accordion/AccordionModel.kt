// Pure, framework-free model + render classifier + a11y affordances + diagnostics for the Accordion shared
// surface — the native analogue of every decision the web component makes
// (web/src/components/ui/Accordion.tsx) before it paints. No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, presentational component — "Collapsible content section with animated reveal" (web JSDoc): a
//     rounded, hairline-bordered container whose header is a single `<button>` carrying an optional leading
//     `icon`, the `title`, an optional `badge`, an optional `headerExtra` slot, and a trailing `ChevronDown`
//     that rotates 180° while open; below it an `AnimatePresence` reveals the `children` body (a top divider
//     + padded content) when open. The parent owns ALL content (title / icon / badge / headerExtra / body);
//     the component's only logic is owning (or, when controlled, deferring) the open/closed boolean and
//     selecting which optional regions to draw. There is NO hook, NO fetch, and NO data port to bind (no
//     P1/S8 state holder, no Source/ViewModel) — modelling one would invent an async dependency the web spec
//     does not have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational ports
//     InlineCallout / ProgressRing / ReleaseNotes set the same precedent (composable + pure model, no
//     Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are the open/closed toggle crossed with its prop-driven
//     branches: a leading icon present/absent (web `{icon && …}`), a badge present/absent (web `{badge}`), a
//     headerExtra present/absent (web `{headerExtra}`), and a real body vs an empty body (web `children`).
//     Each is reduced here in [classifyAccordion] and asserted in the off-device test, doubling as the
//     per-state snapshot.
//   • Controlled vs uncontrolled is the one genuinely stateful decision the web makes
//     (`isControlled = open !== undefined && onOpenChange !== undefined`; `open = isControlled ? open :
//     internalOpen`). It is reproduced verbatim by [accordionIsControlled] / [resolveAccordionOpen] so the
//     composable's `remember`-backed fallback and the parent-owned override behave exactly like the source.
//   • The one place this surface improves on a literal port is the empty-body branch: the web renders whatever
//     `children` it is given (including nothing), but the prompt's "empty → friendly empty state, never a
//     blank box" contract is honoured by [classifyAccordion] flagging an empty body so the view renders a
//     localized caption instead of an empty region.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is a controlled container whose content is handed in by its parent. There is no
// query to be loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest.
// The owning screen that DOES fetch (and can be loading/stale/offline) renders its own data surface and only
// mounts this accordion once it already has content to reveal.
//
// Accessibility: the web header is a `<button aria-expanded={open}>`. A DOM button announces its inner text
// and its expanded state for free; Compose has no auto-localized `aria-expanded`, so the native header carries
// a localized action label (Expand / Collapse) and state description (Expanded / Collapsed). The web source
// owns no text keys for these (it relies on the DOM), so — exactly like the sibling ReleaseNotes surface —
// they resolve by-name through the i18n facade ([resolveOptional], the native mirror of i18next `t(key,
// default)`) with the English [AccordionDefaults] fallbacks. The only other string the surface shows beyond
// its caller-supplied props is the empty-body caption, which resolves through the existing
// `translation_common_noData` catalog key at the render boundary (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Accordion — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.accordion

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no title, badge, or body —
 * only this constant identifier — so a diagnostics line can never leak the accordion's content.
 */
const val ACCORDION_SLUG: String = "Accordion"

/**
 * Whether the accordion is in controlled mode — the native mirror of the web
 * `isControlled = open !== undefined && onOpenChange !== undefined`. Controlled mode means the parent owns the
 * open/closed source of truth; both an [openOverride] and an [hasOnOpenChange] handler must be supplied,
 * matching the web's requirement that the pair travel together (an `open` with no `onOpenChange` would be a
 * read-only prop the user could never toggle, so the web — and this port — fall back to internal state).
 */
fun accordionIsControlled(
    openOverride: Boolean?,
    hasOnOpenChange: Boolean,
): Boolean = openOverride != null && hasOnOpenChange

/**
 * Resolve the effective open state — web `open = isControlled ? openProp : internalOpen`. In controlled mode
 * the parent-owned [openOverride] wins; otherwise the composable's own remembered [internalOpen] is used. Pure
 * so the controlled/uncontrolled decision is unit-tested without a Compose host. A controlled call always
 * supplies a non-null [openOverride] (guaranteed by [accordionIsControlled]); the `?: internalOpen` is a
 * defensive fall-through that can never be reached in controlled mode.
 */
fun resolveAccordionOpen(
    openOverride: Boolean?,
    hasOnOpenChange: Boolean,
    internalOpen: Boolean,
): Boolean = if (accordionIsControlled(openOverride, hasOnOpenChange)) openOverride ?: internalOpen else internalOpen

/**
 * The parent-owned inputs to the accordion, bundled into one value object so the pure [classifyAccordion]
 * reads a single argument instead of a long parameter list — the native mirror of the web `AccordionProps`
 * region flags the parent supplies.
 *
 * @property expanded whether the body is currently revealed (the resolved web `open`).
 * @property hasIcon whether the parent supplied a leading glyph slot (web truthy `icon`).
 * @property hasBadge whether the parent supplied a badge slot (web truthy `badge`).
 * @property hasHeaderExtra whether the parent supplied a header-extra slot (web truthy `headerExtra`).
 * @property hasBody whether the parent supplied a non-empty body slot (web non-empty `children`).
 */
data class AccordionInput(
    val expanded: Boolean,
    val hasIcon: Boolean = false,
    val hasBadge: Boolean = false,
    val hasHeaderExtra: Boolean = false,
    val hasBody: Boolean = false,
)

/**
 * The render-ready classification of the accordion — everything the view needs to draw, reduced from the
 * parent's props so every branch is exhaustively covered and unit-tested off-device. The web component always
 * renders the container + header (the parent decides whether to mount it), so there is no hidden surface —
 * only which header regions are shown, whether the body is revealed, and whether the revealed body is real or
 * the empty fallback.
 *
 * @property expanded the body is revealed (web `open`); drives the chevron rotation and the body visibility.
 * @property showIcon a leading glyph is shown — only when the parent supplied one (web `{icon && …}`).
 * @property showBadge a badge is shown (web `{badge}`).
 * @property showHeaderExtra a header-extra slot is shown (web `{headerExtra}`).
 * @property showBody a real body is shown when expanded (web non-empty `children`).
 * @property showEmptyFallback no body was supplied — the view shows a localized caption when expanded, never a
 *   blank box.
 */
data class AccordionRender(
    val expanded: Boolean,
    val showIcon: Boolean,
    val showBadge: Boolean,
    val showHeaderExtra: Boolean,
    val showBody: Boolean,
    val showEmptyFallback: Boolean,
)

/**
 * Reduce the parent's [input] into the render-ready [AccordionRender]. Pure (no Compose). A body that is
 * present is shown; an absent body sets [AccordionRender.showEmptyFallback] so the revealed region is never a
 * blank box (the prompt's empty-state contract). The empty/real distinction is independent of [expanded] so
 * the classification is stable across the toggle and the test can assert each region once.
 */
fun classifyAccordion(input: AccordionInput): AccordionRender =
    AccordionRender(
        expanded = input.expanded,
        showIcon = input.hasIcon,
        showBadge = input.hasBadge,
        showHeaderExtra = input.hasHeaderExtra,
        showBody = input.hasBody,
        showEmptyFallback = !input.hasBody,
    )

/**
 * Native-only accessibility microcopy defaults — the web header is a `<button aria-expanded>` whose state +
 * action a DOM screen reader announces for free, so the web source owns no catalog key for these. Absent a
 * catalog hit these English fallbacks are used (the native mirror of i18next's default argument).
 */
object AccordionDefaults {
    /** Action label announced for the header while collapsed (TalkBack "double-tap to …"). */
    const val EXPAND_ACTION: String = "Expand"

    /** Action label announced for the header while expanded. */
    const val COLLAPSE_ACTION: String = "Collapse"

    /** State description announced while open — native equivalent of `aria-expanded="true"`. */
    const val EXPANDED_STATE: String = "Expanded"

    /** State description announced while closed — native equivalent of `aria-expanded="false"`. */
    const val COLLAPSED_STATE: String = "Collapsed"
}

/** Resource name for the header's expand action label (by-name; absent ⇒ the English default). */
const val KEY_ACCORDION_EXPAND_ACTION: String = "translation_accordion_expand"

/** Resource name for the header's collapse action label (by-name; absent ⇒ default). */
const val KEY_ACCORDION_COLLAPSE_ACTION: String = "translation_accordion_collapse"

/** Resource name for the header's expanded state description (by-name; absent ⇒ default). */
const val KEY_ACCORDION_EXPANDED_STATE: String = "translation_accordion_expanded"

/** Resource name for the header's collapsed state description (by-name; absent ⇒ default). */
const val KEY_ACCORDION_COLLAPSED_STATE: String = "translation_accordion_collapsed"

/**
 * The localized accessibility affordance strings for the collapsible header — resolved once at the render
 * boundary so the header's TalkBack action + state description track the open/closed toggle the way the web
 * `aria-expanded` does. The web source owns no text keys for these (it relies on the DOM), so they resolve
 * by-name with the English fallbacks above.
 */
data class AccordionAffordances(
    val expandAction: String,
    val collapseAction: String,
    val expandedState: String,
    val collapsedState: String,
) {
    /** The TalkBack action label for the toggle in its current [expanded] state. */
    fun actionLabel(expanded: Boolean): String = if (expanded) collapseAction else expandAction

    /** The TalkBack state description for the current [expanded] state (web `aria-expanded`). */
    fun stateLabel(expanded: Boolean): String = if (expanded) expandedState else collapsedState
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the title,
 * badge, or body — so a diagnostics line can never leak what the accordion shows.
 */
object AccordionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ACCORDION_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
