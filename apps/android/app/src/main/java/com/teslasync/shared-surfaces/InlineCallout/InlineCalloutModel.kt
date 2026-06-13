// Pure, framework-free model + variant taxonomy + render classifier for the InlineCallout shared surface — the
// native analogue of every decision the web component makes (web/src/components/feedback/InlineCallout.tsx) before
// it paints. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, presentational component — "single-line, low-chrome callout for surfacing one actionable insight
//     inside a larger card" (web JSDoc). The parent owns the data: it passes `variant`, an optional leading
//     `icon`, the `children` body, and an optional `action` ({ label, href?, onClick? }); the component's only
//     logic is selecting the severity tint from `variant` and choosing its container element from the action.
//     Its sole non-icon import is a class-name helper. There is NO hook, NO fetch, and NO data port to bind (no
//     P1/S8 state holder, no Source/ViewModel) — modelling one would invent an async dependency the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). The closest sibling precedent is the
//     equally presentational AlertBanner surface (composable + model, no Source/ViewModel); InlineCallout is its
//     smaller, optionally-actionable cousin (the web JSDoc contrasts the two explicitly).
//   • So the surface's REAL, fully-reproduced states are its four severity variants (info / success / warning /
//     danger) crossed with its prop-driven branches: a leading icon present/absent (web `{icon && …}`), a real
//     body vs an empty body (web `children`), an action present/absent (web `{action && …}`, the trailing
//     label + chevron), and — the heart of the component — which of the THREE container modes the action selects:
//       – web `action.href` truthy  ⇒ an `<a href>` link            ⇒ [CalloutInteraction.Link]
//       – else `action.onClick` truthy ⇒ a `<button>`                ⇒ [CalloutInteraction.Button]
//       – else (no action, or an action with neither handler) ⇒ a `<div role="status">` ⇒ [CalloutInteraction.Status]
//     Each is reduced here in [classify] and asserted in the off-device test, doubling as the per-state snapshot.
//   • The native action collapses the web `href` / `onClick` pair onto one [InlineCalloutAction.onActivate]
//     callback (a native app navigates through a callback, never a DOM href), preserving the web's link-vs-button
//     distinction through [InlineCalloutAction.isLink] so the view can mirror the original element + accessibility
//     intent without shipping a dead `href` string the runtime could never honour.
//   • The one place this surface improves on a literal port is the empty-body branch: the web renders whatever
//     `children` it is given (including nothing), but the prompt's "empty → friendly empty state, never a blank
//     box" contract is honoured by [classify] flagging an empty body so the view renders a localized caption
//     instead of an empty region.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is a controlled callout whose content is handed in by its parent. There is no query to be
// loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest. The owning
// screen that DOES fetch (and can be loading/stale/offline) renders its own data surface and only mounts this
// callout once it already has an insight to surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/InlineCallout — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AlertBanner surface does. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.inlinecallout

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no body, action label, or
 * variant — only this constant identifier — so a diagnostics line can never leak the callout's content.
 */
const val INLINE_CALLOUT_SLUG: String = "InlineCallout"

/**
 * The severity treatment the callout paints with — the native mirror of the web `CalloutVariant` union
 * (`'info' | 'success' | 'warning' | 'danger'`). Each maps 1:1 to a feedback Tone palette in the view.
 */
enum class CalloutVariant {
    /** Cyan informational insight (web `variant="info"`). */
    Info,

    /** Green positive insight (web `variant="success"`). */
    Success,

    /** Amber cautionary insight (web `variant="warning"`). */
    Warning,

    /** Red critical insight (web `variant="danger"`). */
    Danger,
}

/**
 * Parse a wire/string `variant` into a [CalloutVariant] — the native mirror of the web string union. Any
 * unrecognized or absent value collapses to [CalloutVariant.Info], the lowest-severity informational default, so
 * a forward-compatible client never crashes on a new backend variant. Case-sensitive, like the web union.
 */
fun variantFromWire(raw: String?): CalloutVariant =
    when (raw) {
        "success" -> CalloutVariant.Success
        "warning" -> CalloutVariant.Warning
        "danger" -> CalloutVariant.Danger
        else -> CalloutVariant.Info
    }

/**
 * The container mode the callout renders in, selected by the action — the native mirror of the web component's
 * three-way element switch. The web prefers `href` when both handlers are supplied; [resolveInteraction] keeps
 * that precedence.
 */
enum class CalloutInteraction {
    /** Web `action.href` truthy → an `<a href>` link; the whole callout activates navigation. */
    Link,

    /** Web `action.onClick` truthy (and no `href`) → a `<button>`; the whole callout fires an in-app action. */
    Button,

    /** Web fall-through → a non-interactive `<div role="status">`: no action, or an action with no handler. */
    Status,
}

/**
 * The parent-owned action that turns the callout into a single tap target — the native port of the web
 * `action?: { label; href?; onClick? }`. The web `href` (navigation) and `onClick` (in-app) collapse onto one
 * [onActivate] callback because a native app routes through a callback rather than a DOM href; [isLink] preserves
 * the web's link-vs-button distinction so the view reproduces the original element + accessibility intent.
 *
 * @property label the trailing affordance text shown before the chevron (web `action.label`); already localized
 *   by the caller, exactly like the web string.
 * @property onActivate invoked when the callout is tapped; `null` reproduces the degenerate web action that
 *   carries a label but neither `href` nor `onClick` (rendered as a non-interactive status row).
 * @property isLink `true` reproduces the web `<a href>` (navigation) branch; `false` reproduces the web
 *   `<button>` (in-app `onClick`) branch.
 */
data class InlineCalloutAction(
    val label: String,
    val onActivate: (() -> Unit)? = null,
    val isLink: Boolean = false,
)

/**
 * Resolve the container [CalloutInteraction] from an [action], honoring the web precedence (`href` beats
 * `onClick`). A `null` action, or an action whose [InlineCalloutAction.onActivate] is `null` (the web action with
 * neither handler), is non-interactive [CalloutInteraction.Status] — the web `<div role="status">` fall-through.
 */
fun resolveInteraction(action: InlineCalloutAction?): CalloutInteraction =
    when {
        action?.onActivate == null -> CalloutInteraction.Status
        action.isLink -> CalloutInteraction.Link
        else -> CalloutInteraction.Button
    }

/**
 * The render-ready classification of the callout — everything the view needs to draw, reduced from the parent's
 * props so every branch is exhaustively covered and unit-tested off-device. The web component always renders
 * (the parent decides whether to mount it), so there is no hidden surface — only which regions are shown and
 * which container mode wraps them.
 *
 * @property variant the severity tint (web `variant`).
 * @property showIcon a leading severity glyph is shown — only when the parent supplied one (web `{icon && …}`).
 * @property showBody a real body (a non-blank message or a slot) is shown (web `children`).
 * @property showEmptyFallback no body was supplied — the view shows a localized caption, never a blank box.
 * @property showAction the trailing action label + chevron is shown (web `{action && …}`).
 * @property interaction which container element the action selects (web `<a>` / `<button>` / `<div role=status>`).
 */
data class InlineCalloutRender(
    val variant: CalloutVariant,
    val showIcon: Boolean,
    val showBody: Boolean,
    val showEmptyFallback: Boolean,
    val showAction: Boolean,
    val interaction: CalloutInteraction,
)

/**
 * The parent-owned inputs to the callout, bundled into one value object so the pure [classify] reads a single
 * argument instead of a long parameter list — the native mirror of the web `InlineCalloutProps` the parent
 * supplies. A blank [message] is treated as absent (web empty `children`); a blank [actionLabel] is treated as no
 * action (web falsy `action`).
 *
 * @property variant the severity tint (web `variant`).
 * @property message the flat body text (the common web `children`).
 * @property hasSlotContent whether the parent passed an arbitrary body slot (the faithful web `children`).
 * @property hasIcon whether the parent supplied a leading glyph (web truthy `icon`).
 * @property actionLabel the trailing affordance text (web `action.label`); blank ⇒ no action.
 * @property hasActivation whether the action carries an activation handler (web truthy `href` or `onClick`).
 * @property isLink whether the action is the web `<a href>` (navigation) branch rather than the `<button>` branch.
 */
data class InlineCalloutInput(
    val variant: CalloutVariant = CalloutVariant.Info,
    val message: String? = null,
    val hasSlotContent: Boolean = false,
    val hasIcon: Boolean = false,
    val actionLabel: String? = null,
    val hasActivation: Boolean = false,
    val isLink: Boolean = false,
)

/**
 * Reduce the parent's [input] into the render-ready [InlineCalloutRender]. Pure (no Compose). A blank message is
 * treated as absent (web empty `children`); when neither a message nor a slot is present the body is empty and
 * [InlineCalloutRender.showEmptyFallback] is set so the view never paints a blank region. A blank action label is
 * treated as no action, and the container mode is resolved with the web's `href`-beats-`onClick` precedence.
 */
fun classify(input: InlineCalloutInput): InlineCalloutRender {
    val hasBody = input.hasSlotContent || !input.message.isNullOrBlank()
    val hasAction = !input.actionLabel.isNullOrBlank()
    val interaction =
        when {
            !hasAction -> CalloutInteraction.Status
            input.hasActivation && input.isLink -> CalloutInteraction.Link
            input.hasActivation -> CalloutInteraction.Button
            else -> CalloutInteraction.Status
        }
    return InlineCalloutRender(
        variant = input.variant,
        showIcon = input.hasIcon,
        showBody = hasBody,
        showEmptyFallback = !hasBody,
        showAction = hasAction,
        interaction = interaction,
    )
}

/**
 * Build the merged accessibility announcement for the callout from its already-localized parts (the view resolves
 * the body + action label through props / i18n). Kept pure so TalkBack-label presence is unit-tested without a
 * Compose host. The body (or, when blank, the [emptyFallback]) leads; a present action label is appended so a
 * screen-reader user hears both the insight and the affordance in one focus. Blank parts are skipped.
 */
fun calloutAccessibilityLabel(
    body: String?,
    actionLabel: String?,
    emptyFallback: String,
): String {
    val lead = body?.trim().takeUnless { it.isNullOrEmpty() } ?: emptyFallback
    val affordance = actionLabel?.trim().takeUnless { it.isNullOrEmpty() }
    return listOfNotNull(lead, affordance).joinToString(separator = ". ")
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the body,
 * action label, or variant — so a diagnostics line can never leak the callout's content.
 */
object InlineCalloutDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = INLINE_CALLOUT_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
