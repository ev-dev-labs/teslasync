// Pure, framework-free model + projection for the Modal modal/dialog surface — the native analogue of everything the
// web component derives before it returns JSX (web/src/components/ui/Modal.tsx, the shared surface Modal). No Compose,
// no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is the shared overlay primitive every other dialog builds on: a backdrop + a centred card (a
// full-bleed bottom sheet below the `sm` breakpoint) hosting an optional title header (with a >=44 px close button), a
// scrollable body, and explicit dismiss affordances (the close button, a backdrop click, and Esc). Its render is a
// small set of branches, each projected here:
//   1. the `open` gate — `if (!open) return null`, so a closed modal renders nothing,
//   2. the title-vs-anonymous branch — `title` present renders the header and labels the dialog by that heading (web
//      `aria-labelledby={title ? titleId : undefined}`); absent, the dialog takes the caller's `ariaLabel`
//      (web `aria-label={!title ? ariaLabel : undefined}`),
//   3. the four `size` presets (`sm | md | lg | full`) that cap the card's max width at the `>= sm` breakpoint
//      (web `sizes` record: `sm:max-w-sm | sm:max-w-lg | sm:max-w-2xl | sm:max-w-[min(96vw,1100px)]`).
// Those branches are the complete state set this surface has. It binds NO data hook — its only inputs are presentation
// props plus the two presentational React utilities `useId` (mints the `titleId` for the `aria-labelledby` wiring) and
// `useImperativeHandle` (composes the forwarded ref onto the dialog node) — so, exactly like the sibling ConfirmDialog
// / SessionExpiredModal surfaces, the cache-then-network lifecycle (loading / empty / error / stale / offline) lives on
// the OWNING surface that fills the modal, never here; modelling those phases would invent behaviour the web spec does
// not have (drift).
//
// Native mapping of the two React utilities (P1/S8 has no holder to bind — they are presentational, not data):
//   - `useId` only exists to give the `<h2>` heading a stable id so `aria-labelledby` can point at it. Compose
//     associates a dialog's accessible name directly via `Modifier.semantics { paneTitle = … }` — there is no DOM id
//     to mint — so the projection resolves the accessible NAME ([ModalDisplay.accessibleName]) and the composable feeds
//     it to the pane title; no id is invented.
//   - `useImperativeHandle` exposes the dialog DOM node so a parent can imperatively focus/measure it; on Android the
//     platform `Dialog` the modal renders into already moves focus into the dialog and traps it, so that web mechanic
//     is subsumed by the platform and no native handle is fabricated.
//
// Size mapping (P1/S9): the web pixel ceilings (sm 384, md 512, lg 672, full <=1100) are projected onto the native
// design-system modal ceiling. The native modal is a centred card whose width never exceeds the `--modal-max` token
// (560 dp, the atomic Modal's `MODAL_MAX_WIDTH`); `lg` and `full` both exceed it and therefore clamp to it, while `sm`
// and `md` stay proportionally narrower. This is a documented platform adaptation, not silent drift: a 1100 dp tablet
// dialog is non-idiomatic, so the size prop's observable intent (relative width, narrowest -> widest) is preserved
// under the platform ceiling and asserted by the unit gate.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/Modal — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling modal/dialog + feature-view surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.modal

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ModalRegistration {
    /** Stable surface id. */
    const val ID: String = "modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Modal"
}

/**
 * The width-preset union the web Modal offers (`size?: 'sm' | 'md' | 'lg' | 'full'`, default `md`). Each case caps the
 * card's max width at the `>= sm` breakpoint; the dp ceiling each maps onto is resolved by
 * [ModalProjection.maxWidthDp]. The presentation prop carries no data — it is a pure render input.
 *
 * @property Sm web `sm:max-w-sm` (384 px) — the narrowest card.
 * @property Md web `sm:max-w-lg` (512 px) — the default.
 * @property Lg web `sm:max-w-2xl` (672 px).
 * @property Full web `sm:max-w-[min(96vw,1100px)]` — the widest; clamps to the native modal ceiling.
 */
enum class ModalSize { Sm, Md, Lg, Full }

/**
 * The fully projected, render-ready view — the native analogue of every value the web component computes before it
 * returns its overlay. Pure data (no Compose types) so the projection is unit-tested without a UI host; each field is
 * exactly one piece of the web render decision.
 *
 * @property open whether the overlay renders at all (web `open`; `false` mirrors the web `return null`).
 * @property hasHeader whether the title header (heading + close button) is shown (web `title &&`); `false` for an
 *   anonymous dialog labelled only by [accessibleName].
 * @property title the visible heading, or `null` when the dialog is anonymous (web `title ? … : undefined`). When
 *   present it is also the dialog's accessible name (web `aria-labelledby`).
 * @property accessibleName the name assistive tech announces for the dialog — the heading when [hasHeader], else the
 *   caller's `ariaLabel` (web `aria-label`); empty only when an anonymous dialog supplied no label.
 * @property size the resolved width preset (web `size`).
 */
data class ModalDisplay(
    val open: Boolean,
    val hasHeader: Boolean,
    val title: String?,
    val accessibleName: String,
    val size: ModalSize,
)

/**
 * Pure projection from the surface's inputs to its render-ready [ModalDisplay] — a 1:1 port of the derivations the web
 * component performs: the `open` gate, the `title ? aria-labelledby : aria-label` labelling branch, and the `size` ->
 * max-width mapping. No Compose, no side effects.
 */
object ModalProjection {
    /** Native max-width ceiling for the `sm` preset (web `max-w-sm`, 384 px), in dp. */
    const val MAX_WIDTH_SM_DP: Int = 360

    /** Native max-width ceiling for the `md` preset (web `max-w-lg`, 512 px), in dp. */
    const val MAX_WIDTH_MD_DP: Int = 480

    /** Native max-width ceiling for the `lg` preset (web `max-w-2xl`, 672 px), clamped to the modal ceiling, in dp. */
    const val MAX_WIDTH_LG_DP: Int = 560

    /** Native max-width ceiling for the `full` preset (web `min(96vw,1100px)`), clamped to the modal ceiling, in dp. */
    const val MAX_WIDTH_FULL_DP: Int = 560

    /**
     * Maps a [size] onto its native max-width ceiling in dp (web `sizes[size]`). `lg` and `full` exceed the
     * design-system modal ceiling (the `--modal-max` 560 dp token) and clamp to it; `sm` and `md` stay narrower, so the
     * ordering `sm <= md <= lg <= full` is preserved.
     */
    fun maxWidthDp(size: ModalSize): Int =
        when (size) {
            ModalSize.Sm -> MAX_WIDTH_SM_DP
            ModalSize.Md -> MAX_WIDTH_MD_DP
            ModalSize.Lg -> MAX_WIDTH_LG_DP
            ModalSize.Full -> MAX_WIDTH_FULL_DP
        }

    /**
     * Projects the surface's inputs into the render-ready [ModalDisplay].
     *
     * @param open the web `open` prop — gates the whole overlay.
     * @param title the optional visible heading (web `title`). A blank/whitespace value is treated as absent so no
     *   empty header row is rendered, mirroring the web `title &&` truthiness for the empty string.
     * @param ariaLabel the accessible name to use when no [title] is shown (web `ariaLabel`, required by ARIA for a
     *   dialog with no visible heading).
     * @param size the width preset (web `size`, default `md`).
     */
    fun project(
        open: Boolean,
        title: String?,
        ariaLabel: String?,
        size: ModalSize,
    ): ModalDisplay {
        val heading = title?.takeIf { it.isNotBlank() }
        val accessibleName = heading ?: ariaLabel?.takeIf { it.isNotBlank() } ?: ""
        return ModalDisplay(
            open = open,
            hasHeader = heading != null,
            title = heading,
            accessibleName = accessibleName,
            size = size,
        )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ModalRegistration.SLUG] (P1/S11). Carries only the
 * slug — never the title or the hosted content — so a diagnostics line can never leak what the modal is showing. Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its open-effect.
 */
fun recordModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ModalRegistration.SLUG))
}
