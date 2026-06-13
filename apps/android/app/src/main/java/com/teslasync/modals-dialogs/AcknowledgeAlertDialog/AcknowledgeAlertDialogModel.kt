// Pure, framework-free model + projection for the AcknowledgeAlertDialog modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/admin/components/AcknowledgeAlertDialog.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the modal opened from an alert row's "Acknowledge" button. It is a *controlled* form — its only
// hooks are `useTranslation` (i18n, P1/S10) and `useId` (the hint's a11y association); it performs no data fetch and
// owns no store. It records an optional free-text note (the input hard-caps at `NOTE_MAX + 50` characters, web
// `maxLength`, while the trimmed note must stay within `NOTE_MAX` or the field flips to its error state and the submit
// disables) and hands the *trimmed* note back to the parent's `onSubmit` callback. An empty / whitespace-only note is
// accepted — the backend treats it as "ack with no note" so the audit timeline still captures who + when. This file
// owns the data derivations behind that form: the maxLength clamp (web `maxLength={NOTE_MAX + 50}`), the trim (web
// `note.trim()`), the over-limit guard (web `tooLong`), the submit-enablement guard (web `submitting || tooLong`), and
// the trimmed-note resolution handed to `onSubmit` (web `onSubmit(trimmed)`). The localized labels are resolved at the
// Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/AcknowledgeAlertDialog — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.acknowledgealertdialog

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline note state, the
 * derived `trimmed` / `tooLong` values, and the `handleSubmit` guard. Stateless and side-effect-free, so it is fully
 * covered by the off-device unit gate.
 */
object AcknowledgeAlertProjection {
    /** Maximum trimmed note length the client accepts before the field flips to its error state (web `NOTE_MAX`). */
    const val NOTE_MAX: Int = 1000

    /**
     * Extra typing headroom the textarea allows past [NOTE_MAX] so a user can over-type and trim back without the
     * input swallowing keystrokes (web `maxLength={NOTE_MAX + 50}`).
     */
    const val NOTE_INPUT_GRACE: Int = 50

    /** The textarea's hard character cap — the web `maxLength` (`NOTE_MAX + 50`). */
    const val MAX_INPUT_LENGTH: Int = NOTE_MAX + NOTE_INPUT_GRACE

    /** Clamps a note edit to the textarea's accepted maximum (web `maxLength={NOTE_MAX + 50}`). */
    fun clampNote(note: String): String = note.take(MAX_INPUT_LENGTH)

    /** The trimmed note the dialog submits and length-checks (web `const trimmed = note.trim()`). */
    fun trimmedNote(note: String): String = note.trim()

    /**
     * Whether the trimmed note exceeds [NOTE_MAX] — the web `tooLong`. Drives both the field's error affordance and the
     * disabled submit. An empty / whitespace-only note is never too long (web parity: blank notes are allowed).
     */
    fun isTooLong(note: String): Boolean = trimmedNote(note).length > NOTE_MAX

    /**
     * Whether the Acknowledge action may fire — the web `handleSubmit` guard `if (submitting || tooLong) return` (and
     * the button's `disabled={submitting || tooLong}`). Note an empty note is submittable, exactly as the web allows.
     */
    fun canSubmit(
        note: String,
        submitting: Boolean,
    ): Boolean = !submitting && !isTooLong(note)

    /** The value handed to the parent's `onSubmit` — the trimmed note, which may be the empty string (web `trimmed`). */
    fun resolveSubmitNote(note: String): String = trimmedNote(note)
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AcknowledgeAlertDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "acknowledge-alert-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AcknowledgeAlertDialog"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [AcknowledgeAlertDialogRegistration.SLUG] — never the typed note or the acknowledged alert's title — so a diagnostics
 * line can never leak what the operator is acknowledging or writing.
 */
object AcknowledgeAlertDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to AcknowledgeAlertDialogRegistration.SLUG))
    }
}
