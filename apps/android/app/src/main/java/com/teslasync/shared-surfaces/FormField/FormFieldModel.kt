// Pure, framework-free model + identifier derivation + render classifier for the FormField shared surface — the
// native analogue of every decision the web component makes (web/src/components/forms/FormField.tsx) before it
// lays out its label + control + supporting line. No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A tiny, PURE, presentational wrapper. The parent owns everything — it passes a visible `label`, the field
//     `children` control, and the optional `htmlFor` / `hint` / `error` / `required` props. The component's only
//     logic is: derive an id (web `useId`, overridable by `htmlFor`) so the label associates with the control and
//     the supporting line gets a stable id; show a required marker; and pick ONE supporting line where a
//     validation `error` takes precedence over a `hint` (web `error ? … : hint ? … : null`). Its sole import is a
//     class-name helper. There is NO hook that fetches, NO `request()` call, and NO data port to bind (no P1/S8
//     state holder, no Source/ViewModel) — modelling one would invent an async dependency the web spec does not
//     have (honesty covenant: no scope narrowing, no silent drift). The one "data source" the prompt lists,
//     `useId`, is React's id generator, not a query; its native analogue is [FormFieldIds.next] below. The closest
//     sibling precedents are the equally presentational AlertBanner / AiLimitBanner surfaces (composable + model,
//     no Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are its prop-driven branches: required vs optional (web
//     `{required && …}`), and the three supporting-line outcomes — a validation error (web `error`, exposed as an
//     assertive alert), a hint when there is no error (web `hint && !error`), or no supporting line at all. Each is
//     reduced here in [classify] and asserted in the off-device test, doubling as the per-state projection check.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is a controlled wrapper whose label, control, and messages are handed in by its
// parent. There is no query to be loading, to be empty, to fail, to go stale, or to be offline, so inventing those
// states would be dishonest. The `error` this component renders is a VALIDATION message (a string prop), a wholly
// different concept from a failed fetch; it IS reproduced. The owning screen that DOES fetch (and can be
// loading/empty/stale/offline) renders its own data surface and composes this field once it already has values.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/FormField — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AlertBanner / AiLimitBanner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formfield

import io.teslasync.shared.core.diagnostics.Logger
import java.util.concurrent.atomic.AtomicLong

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no label, hint, error, or
 * control content — only this constant identifier — so a diagnostics line can never leak the field's data.
 */
const val FORM_FIELD_SLUG: String = "FormField"

/**
 * Which single supporting line the field shows beneath its control — the native mirror of the web
 * `error ? <p role="alert"> : hint ? <p> : null` decision. Exactly one outcome is ever chosen.
 */
enum class FormFieldSupport {
    /** A validation error is shown (web `error`); exposed to TalkBack as an assertive alert. */
    Error,

    /** A hint is shown because there is no error (web `hint && !error`). */
    Hint,

    /** Neither an error nor a hint was supplied — no supporting line is drawn (web `null`). */
    None,
}

/**
 * The parent-owned inputs to the field, bundled into one value object so the pure [classify] reads a single
 * argument — the native mirror of the web `FormFieldProps` the parent supplies. A blank [htmlFor], [hint], or
 * [error] is treated as absent (web falsy props / empty strings).
 *
 * @property htmlFor the caller-supplied control id (web `htmlFor`); blank ⇒ [autoId] is used instead.
 * @property autoId the generated fallback id (the web `useId()` value); see [FormFieldIds.next].
 * @property hint the helper text shown when there is no error (web `hint`).
 * @property error the validation message; when present it replaces the hint (web `error`).
 * @property required whether the required marker is shown (web `required`).
 */
data class FormFieldInput(
    val htmlFor: String? = null,
    val autoId: String,
    val hint: String? = null,
    val error: String? = null,
    val required: Boolean = false,
)

/**
 * The render-ready classification of the field — everything the view needs to draw, reduced from the parent's
 * props so every branch is exhaustively covered and unit-tested off-device. The web component always renders (the
 * parent decides whether to mount it), so there is no hidden surface — only which regions are shown and the ids
 * the label + supporting line carry.
 *
 * @property fieldId the resolved control id — [FormFieldInput.htmlFor] when present, else the generated fallback
 *   (web `const fieldId = htmlFor ?? autoId`). The view tags the supporting line with the derived child ids.
 * @property support which supporting line is shown (web `error ? … : hint ? … : null`).
 * @property errorId the id of the error line, present only when an error is shown (web `${fieldId}-error`).
 * @property hintId the id of the hint line, present only when a hint is shown without an error (web
 *   `${fieldId}-hint`).
 * @property showRequiredMarker the required asterisk is shown (web `{required && …}`).
 */
data class FormFieldRender(
    val fieldId: String,
    val support: FormFieldSupport,
    val errorId: String?,
    val hintId: String?,
    val showRequiredMarker: Boolean,
)

/**
 * Resolve the control id the way the web component does: a non-blank caller [htmlFor] wins, otherwise the
 * generated [autoId] (web `htmlFor ?? autoId`). A blank [htmlFor] is treated as absent so an empty prop never
 * yields an id like `"-error"`.
 */
fun resolveFieldId(
    htmlFor: String?,
    autoId: String,
): String = htmlFor?.takeUnless { it.isBlank() } ?: autoId

/**
 * Reduce the parent's [input] into the render-ready [FormFieldRender]. Pure (no Compose). A blank hint or error is
 * treated as absent; an error takes precedence over a hint (web `error ? … : hint ? … : null`), and the child ids
 * are derived from the resolved field id exactly as the web does (`${fieldId}-error`, `${fieldId}-hint`) — the
 * hint id is present only when a hint is shown AND there is no error (web `hint && !error`).
 */
fun classify(input: FormFieldInput): FormFieldRender {
    val fieldId = resolveFieldId(input.htmlFor, input.autoId)
    val hasError = !input.error.isNullOrBlank()
    val hasHint = !input.hint.isNullOrBlank()
    val support =
        when {
            hasError -> FormFieldSupport.Error
            hasHint -> FormFieldSupport.Hint
            else -> FormFieldSupport.None
        }
    return FormFieldRender(
        fieldId = fieldId,
        support = support,
        errorId = if (hasError) "$fieldId-error" else null,
        hintId = if (hasHint && !hasError) "$fieldId-hint" else null,
        showRequiredMarker = input.required,
    )
}

/**
 * Build the field label's accessible name from its already-localized parts. When the field is [required] the
 * localized [requiredText] is appended so TalkBack announces "{label}, required" — the native mirror of the web
 * asterisk's `aria-label="required"`, which a screen reader reads in place of the visual `*`. Kept pure so the
 * label is unit-tested without a Compose host. A blank [label] still yields a stable, non-empty announcement.
 */
fun fieldAccessibilityLabel(
    label: String,
    required: Boolean,
    requiredText: String,
): String {
    val trimmed = label.trim()
    if (!required) return trimmed
    return listOf(trimmed, requiredText).filter { it.isNotEmpty() }.joinToString(separator = ", ")
}

/**
 * The native analogue of React's `useId` — a monotonic, process-unique id generator for the field's fallback id.
 * The composable calls [next] once per field instance (under `rememberSaveable`) so the id is stable across
 * recompositions, mirroring `useId`'s stable-per-instance contract. The prefix keeps generated ids distinguishable
 * from caller-supplied `htmlFor` values and forms a valid html/test identifier.
 */
object FormFieldIds {
    private const val PREFIX = "form-field-"
    private val counter = AtomicLong(0L)

    /** Returns the next process-unique field id, e.g. `form-field-1`. Thread-safe. */
    fun next(): String = PREFIX + counter.incrementAndGet()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the label,
 * hint, error, or control content — so a diagnostics line can never leak the field's data.
 */
object FormFieldDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = FORM_FIELD_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
