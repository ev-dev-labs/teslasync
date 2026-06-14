// Pure, framework-free model + projection + diagnostics for the Label shared surface — the native analogue of
// every decision the web component makes (web/src/components/ui/Label.tsx) before it lays out its label content
// and optional required marker. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A tiny, PURE accessibility primitive: it renders an HTML `<label>` carrying the caller's `children`, and
//     when `required` is set it appends (1) a decorative red `*` marked `aria-hidden="true"` so a screen reader
//     never voices the glyph as "asterisk", and (2) a `<VisuallyHidden>` span carrying the localized
//     `t('form.required', 'required')` string so the paired control's accessible name becomes "<label> required"
//     (WCAG 3.3.2). Its only hook is `useTranslation`; it fetches nothing and owns no state — the parent owns the
//     label content and the `required` flag. So there is NO data port to bind (no P1/S8 state holder, no
//     Source/ViewModel); modelling one would invent an async dependency the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The sibling presentational ports FormField / ScoreBadge /
//     VisuallyHidden document the same rationale (composable + model, no Source).
//   • So the surface's REAL, fully-reproduced states are its two prop-driven branches: optional (the bare label
//     content) and required (the content plus the aria-hidden `*` and the screen-reader-only "required" suffix).
//     Each is reduced here in [projectLabel] and asserted in the off-device test, doubling as the per-state check.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is a controlled presentational primitive whose content and required flag are handed
// in by its parent. There is no query to be loading, to be empty, to fail, to go stale, or to be offline, so
// inventing those states would be dishonest. The owning screen that DOES fetch renders its own data surface and
// composes this label once it already has values.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Label — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling FormField / ScoreBadge surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.label

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The visible required glyph — the native mirror of the web `*` rendered in the `aria-hidden="true"` span. It is
 * drawn for sighted users but never announced (the view clears its semantics), exactly as the web hides it from
 * assistive technologies so they read the localized "required" suffix instead.
 */
const val LABEL_REQUIRED_MARKER: String = "*"

/**
 * The web i18n key the screen-reader-only required suffix resolves through (web `t('form.required', 'required')`).
 * The native view reads it from the P1/S10 catalog via `R.string.translation_form_required`; this constant pins
 * the web→android key parity so the off-device test can assert the surface binds the exact same key.
 */
const val LABEL_REQUIRED_I18N_KEY: String = "form.required"

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no label content — only this
 * constant identifier — so a diagnostics line can never leak what a field was labelled.
 */
const val LABEL_SLUG: String = "Label"

/**
 * The render-ready classification of the label — everything the view needs to draw, reduced from the parent's
 * single `required` prop so the branch is exhaustively covered and unit-tested off-device. The web component
 * always renders (the parent decides whether to mount it), so there is no hidden surface — only whether the
 * required marker + screen-reader "required" suffix are shown.
 *
 * @property showRequiredMarker the aria-hidden `*` and the screen-reader-only "required" suffix are shown (web
 *   `{required && …}`).
 */
data class LabelProjection(
    val showRequiredMarker: Boolean,
)

/**
 * Reduce the parent's [required] flag into the render-ready [LabelProjection]. Pure (no Compose) — the native
 * mirror of the web `{required && …}` guard, kept here so the branch is asserted without a Compose host.
 */
fun projectLabel(required: Boolean): LabelProjection = LabelProjection(showRequiredMarker = required)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the label
 * content — so a diagnostics line can never leak what a field was labelled.
 */
object LabelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = LABEL_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
