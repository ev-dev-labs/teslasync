// Pure, framework-free model + projection for the AccordionSection feature view — the native analogue of
// the data the web component derives from its props before returning JSX
// (web/src/features/system/components/status/AccordionSection.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is a PURELY PRESENTATIONAL disclosure primitive from the shared `@/components/ui` +
// `@/components/motion` library. It binds NO data hook (the P3 prompt's own "Data sources: none - pure
// presentational component"); its only collaborators are GlassPanel, FadeIn, the cn() class helper, and a
// chevron glyph. The single piece of logic it owns is the open/closed toggle (`setOpen(prev => !prev)`,
// reachable by click and by the Enter/Space key handler) plus the chevron's `open && 'rotate-180'`
// transform; everything else is layout and caller-supplied slots (icon, title, description, badges,
// children). This file reproduces that logic in [AccordionSectionModel] and reduces the surface to its
// genuine, reachable render states in [AccordionRender]:
//
//   • Collapsed       — open == false: only the header is shown (web: `{open && (...)}` is false).
//   • ExpandedContent — open == true with a body slot: header + divider + the caller's content (web FadeIn).
//   • ExpandedEmpty   — open == true with no body slot: header + divider + a friendly empty state. The web
//                       `children` is a required slot, but a native caller may hand none; rather than render
//                       a blank box we show the shared feedback EmptyState, exactly as the sibling CodeBlock
//                       surface does for an empty body.
//
// There is no remote feed behind an AccordionSection, so there is NO loading / error / stale / offline
// lifecycle to model — inventing one would be fabricated state the web source never has (a "No silent
// drift" covenant violation), exactly as the sibling CodeBlock / JsonFormatter surfaces document. The data
// the P3 states checklist describes ("initial fetch", "fetch failed", "older than freshness window", "no
// connectivity") presupposes a data source this component does not have.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AccordionSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.accordionsection

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AccordionSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "accordion-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AccordionSection"
}

/** Chevron rotation, in degrees, when the section is open — the web `open && 'rotate-180'` transform. */
const val CHEVRON_OPEN_DEGREES: Float = 180f

/** Chevron rotation, in degrees, when the section is closed (the resting glyph orientation). */
const val CHEVRON_CLOSED_DEGREES: Float = 0f

/**
 * Native-only microcopy defaults. The web AccordionSection owns no i18n keys of its own — its `title` and
 * `description` are already-localized strings handed in by the parent, and it has no empty/accessibility
 * copy. The native surface still needs accessible expand/collapse affordance labels (the web relies on the
 * DOM `role="button"` + `aria-expanded`, which TalkBack has no automatic equivalent for) and a friendly
 * empty-body hint. As with the sibling CodeBlock surface, that microcopy resolves through the i18n facade
 * by-name and falls back to these English defaults when no catalog entry exists — so this artifact stays
 * within its allowed-files scope (it adds no new catalog keys) while remaining fully localizable later.
 */
object AccordionSectionDefaults {
    /** Action label announced for the toggle while collapsed (TalkBack: "double tap to Expand"). */
    const val EXPAND_ACTION: String = "Expand"

    /** Action label announced for the toggle while expanded (TalkBack: "double tap to Collapse"). */
    const val COLLAPSE_ACTION: String = "Collapse"

    /** State description announced while expanded — the native equivalent of `aria-expanded="true"`. */
    const val EXPANDED_STATE: String = "Expanded"

    /** State description announced while collapsed — the native equivalent of `aria-expanded="false"`. */
    const val COLLAPSED_STATE: String = "Collapsed"

    /** Friendly empty-body hint (no catalog entry ⇒ this English default is used). */
    const val EMPTY_HINT: String = "Nothing to show"
}

/** Resource name for the expand action label (by-name; absent ⇒ [AccordionSectionDefaults.EXPAND_ACTION]). */
const val KEY_EXPAND_ACTION: String = "translation_accordionSection_expand"

/** Resource name for the collapse action label (by-name; absent ⇒ default). */
const val KEY_COLLAPSE_ACTION: String = "translation_accordionSection_collapse"

/** Resource name for the expanded state description (by-name; absent ⇒ default). */
const val KEY_EXPANDED_STATE: String = "translation_accordionSection_expanded"

/** Resource name for the collapsed state description (by-name; absent ⇒ default). */
const val KEY_COLLAPSED_STATE: String = "translation_accordionSection_collapsed"

/** Resource name for the empty-body hint (by-name; absent ⇒ [AccordionSectionDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_accordionSection_empty"

/**
 * The localized strings the composable renders — resolved once at the render boundary (all by-name with the
 * web `t(key, default)` fallback, since the web source owns no catalog keys for this surface) and handed to
 * the stateless content as a framework-free bundle so the view stays a thin render layer. [actionLabel] and
 * [stateLabel] pick the open/closed variant so the header's accessibility affordances track the toggle.
 */
data class AccordionSectionStrings(
    val expandAction: String,
    val collapseAction: String,
    val expandedState: String,
    val collapsedState: String,
    val emptyHint: String,
) {
    /** The TalkBack action label for the toggle in its current [open] state (web `role="button"` intent). */
    fun actionLabel(open: Boolean): String = if (open) collapseAction else expandAction

    /** The TalkBack state description for the current [open] state (web `aria-expanded`). */
    fun stateLabel(open: Boolean): String = if (open) expandedState else collapsedState
}

/**
 * The reduced render state of an AccordionSection — the three mutually-exclusive, genuinely reachable
 * branches of the web component. The header is always present (web renders it unconditionally); the cases
 * differ only in the body region beneath it.
 */
sealed interface AccordionRender {
    /** open == false: header only, no body region (web `{open && (...)}` short-circuits). */
    data object Collapsed : AccordionRender

    /** open == true with a body slot: header + divider + the caller's content, faded in (web FadeIn). */
    data object ExpandedContent : AccordionRender

    /** open == true without a body slot: header + divider + a friendly empty state (never a blank box). */
    data object ExpandedEmpty : AccordionRender
}

/**
 * Pure, side-effect-free reducer — the native port of the web component's prop-and-state to render mapping.
 * Stateless so it is fully covered by the off-device unit gate.
 */
object AccordionSectionModel {
    /** Reproduces the web `setOpen(prev => !prev)` toggle (click + Enter/Space both flip the same flag). */
    fun toggle(open: Boolean): Boolean = !open

    /** The chevron rotation in degrees for the current [open] state (web `open && 'rotate-180'`). */
    fun chevronRotation(open: Boolean): Float = if (open) CHEVRON_OPEN_DEGREES else CHEVRON_CLOSED_DEGREES

    /** Whether the body region renders at all (web `{open && (...)}`). */
    fun shouldRenderBody(open: Boolean): Boolean = open

    /**
     * Classifies the surface into its [AccordionRender] state from the toggle [open] flag and whether a body
     * slot was supplied ([hasContent]). A collapsed section never inspects its body; an expanded section
     * with no body shows the friendly empty state instead of a blank box.
     */
    fun render(
        open: Boolean,
        hasContent: Boolean,
    ): AccordionRender =
        when {
            !open -> AccordionRender.Collapsed
            hasContent -> AccordionRender.ExpandedContent
            else -> AccordionRender.ExpandedEmpty
        }
}

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
