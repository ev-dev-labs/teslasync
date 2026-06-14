// Pure, framework-free model + commit classifier + display resolver + diagnostics for the EditableText shared
// surface — the native analogue of every decision the web component makes (web/src/components/ui/EditableText.tsx)
// before it paints. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour set this surface reproduces):
//   • An inline-edit primitive: a display surface (a button-styled-as-text, or a caller-supplied `display`
//     render prop) that switches to a single-line input on activation, commits the trimmed draft on
//     Enter/blur, and cancels on Escape. The parent owns the saved `value` and the async `onSave`; the
//     component owns only the transient edit state (editing / draft / saving / error). It is FETCH-FREE — it
//     binds no query, so it has no network loading / stale / offline lifecycle of its own (the same honesty
//     rationale the sibling presentational ports Accordion / AnnouncerRegion document). Its REAL states are
//     the web's own: a resolved display value, an empty value shown as ghost text (the web empty-value hint), the
//     editor, a save in flight (the web `saving` spinner — this surface's "loading"), and an error (validation
//     or a rejected save) that keeps the editor open. The owning screen that DOES fetch renders its own data
//     surface and hands a resolved `value` in.
//   • `commitDraft` is the single commit path with five guarded outcomes, reproduced verbatim by
//     [decideCommit]: a no-op when the trimmed draft equals the trimmed current value (exit, no server call);
//     an empty draft is invalid (the built-in empty message); a validator-rejected draft is invalid (the
//     validator's message); an identical re-submit of the last committed value exits without re-calling the
//     server (the web `lastSubmittedRef` guard against Enter-then-blur double fire); otherwise a save with the
//     trimmed value. The saving re-entrancy guard (web `savingRef`) lives in the view.
//   • Live validation (web `handleInputChange`) is [liveValidationError]: an empty trimmed draft surfaces no
//     error yet (pre-empting "empty" on every backspace is hostile), a non-empty draft surfaces the validator's
//     message live so the user sees it before committing.
//   • The display text (web `visibleText` / the empty-value flag) is [resolveDisplayText]: an empty value with a
//     ghost string shows the ghost (muted), otherwise the value.
//
// i18n: the four user-visible strings (empty error, saved announcement, save-failed error, saving label) all
// resolve through the P1/S10 catalog at the render boundary (keys already in res/values/strings.xml); this
// pure layer holds none of them — the empty + save-failed messages are passed in already-localized so the
// commit decision stays framework-free and unit-testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/EditableText — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editabletext

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no value, draft, or error —
 * only this constant identifier — so a diagnostics line can never leak what the field shows or the user typed.
 */
const val EDITABLE_TEXT_SLUG: String = "EditableText"

/**
 * The visible text size of the editable — the native mirror of the web `variant` prop. [Body] (default) is the
 * web `text-sm font-normal`; [Heading] is the web `text-base font-semibold`. Controls typography only; it never
 * changes the commit / validation behaviour.
 */
enum class EditableTextVariant { Body, Heading }

/**
 * The canonical normaliser — the same value compared and sent to the server (web `normalise = s.trim()`).
 * Centralised so [decideCommit], [liveValidationError], and the view all trim identically.
 */
fun normaliseEditableText(value: String): String = value.trim()

/**
 * The resolved display text and whether it is the ghost (empty-value) fallback — the native mirror of the web
 * `visibleText` / empty-value-flag pair. [isGhost] drives the muted styling so an empty value never renders as a
 * blank surface (the prompt's empty-state contract).
 *
 * @property text the string the display renders (the value, or the ghost fallback when the value is empty).
 * @property isGhost the rendered text is the empty-value ghost fallback, not a real value.
 */
data class EditableDisplayText(
    val text: String,
    val isGhost: Boolean,
)

/**
 * Resolve what the display renders — the web `visibleText` (the value, or the ghost hint when the value is
 * empty) and its empty-value flag. An empty [value] with a non-empty [ghostText] shows
 * the ghost (flagged [EditableDisplayText.isGhost]); anything else shows the [value]. Pure, so the empty-vs-real
 * decision is unit-tested without a Compose host.
 */
fun resolveDisplayText(
    value: String,
    ghostText: String?,
): EditableDisplayText =
    if (value.isEmpty() && !ghostText.isNullOrEmpty()) {
        EditableDisplayText(ghostText, isGhost = true)
    } else {
        EditableDisplayText(value, isGhost = false)
    }

/**
 * The live, per-keystroke validation message — web `handleInputChange`. A trimmed-empty [next] surfaces no
 * error yet (the web deliberately does not pre-empt "empty" on every backspace; that message is reserved for
 * the commit), otherwise the [validate] result (its message, or null when valid) is returned so the user sees
 * the error before pressing Enter. The default no-op validator yields null, matching the web "no validate ⇒
 * clear error" branch.
 */
fun liveValidationError(
    next: String,
    validate: (String) -> String?,
): String? {
    val trimmed = normaliseEditableText(next)
    return if (trimmed.isEmpty()) null else validate(trimmed)
}

/**
 * The outcome of attempting to commit an inline-edit draft — the native reduction of the web `commitDraft`
 * return contract. [Exit] leaves edit mode without a server call (a no-op edit or an identical re-submit);
 * [Invalid] keeps the editor open and shows [Invalid.message] (empty or validator-rejected); [Save] runs the
 * async save with the trimmed [Save.value].
 */
sealed interface CommitDecision {
    /** Leave edit mode without touching the server — a no-op edit or an identical re-submit. */
    data object Exit : CommitDecision

    /** Stay in edit mode and show [message] — an empty or validator-rejected draft. */
    data class Invalid(
        val message: String,
    ) : CommitDecision

    /** Run the async save with the trimmed [value]. */
    data class Save(
        val value: String,
    ) : CommitDecision
}

/**
 * Decide what an inline-edit commit should do — the verbatim port of the web `commitDraft` guards, in order:
 *   1. a draft equal to the current value (after trim) is a [CommitDecision.Exit] no-op (no server call);
 *   2. an empty draft is [CommitDecision.Invalid] with [emptyMessage] (the built-in empty rule);
 *   3. a [validate]-rejected draft is [CommitDecision.Invalid] with the validator's message;
 *   4. a draft identical to [lastSubmitted] is a [CommitDecision.Exit] (the web `lastSubmittedRef` guard that
 *      stops Enter-then-blur from saving twice);
 *   5. otherwise a [CommitDecision.Save] with the trimmed value.
 *
 * [emptyMessage] is passed in already-localized so the decision stays framework-free. The no-op check precedes
 * validation (so clearing back to the original empty value exits rather than erroring), and [validate] is only
 * consulted for a changed, non-empty draft.
 */
fun decideCommit(
    draft: String,
    currentValue: String,
    lastSubmitted: String?,
    emptyMessage: String,
    validate: (String) -> String?,
): CommitDecision {
    val next = normaliseEditableText(draft)
    return when {
        next == normaliseEditableText(currentValue) -> CommitDecision.Exit
        next.isEmpty() -> CommitDecision.Invalid(emptyMessage)
        else -> classifyChangedDraft(next, lastSubmitted, validate)
    }
}

/**
 * Classify a changed, non-empty trimmed [next] (web `commitDraft` tail): a validator rejection is
 * [CommitDecision.Invalid]; a draft equal to [lastSubmitted] is a [CommitDecision.Exit] (the duplicate-submit
 * guard); otherwise [CommitDecision.Save]. Split out so [decideCommit] stays a single readable `when`.
 */
private fun classifyChangedDraft(
    next: String,
    lastSubmitted: String?,
    validate: (String) -> String?,
): CommitDecision {
    val validationError = validate(next)
    return when {
        validationError != null -> CommitDecision.Invalid(validationError)
        lastSubmitted == next -> CommitDecision.Exit
        else -> CommitDecision.Save(next)
    }
}

/**
 * The render-prop inputs handed to a caller-supplied display (web `EditableTextDisplayProps`). Pure data so the
 * custom-display contract is documented and testable without Compose.
 *
 * @property value the currently-saved value (NOT the in-flight draft) — web `value`.
 * @property onStartEdit imperatively enter edit mode; wire to a pencil affordance — web `onStartEdit`.
 * @property disabled true when the parent set `disabled` — web `disabled`.
 */
data class EditableTextDisplayScope(
    val value: String,
    val onStartEdit: () -> Unit,
    val disabled: Boolean,
)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the value,
 * draft, or error — so a diagnostics line can never leak what the field shows or what the user typed.
 */
object EditableTextDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = EDITABLE_TEXT_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
