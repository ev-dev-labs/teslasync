// Pure, framework-free model + projection for the ConfirmDialog modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/ui/ConfirmDialog.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the generic destructive-action confirmation prompt. It is a *controlled* dialog whose
// only data dependency is `useTranslation` (i18n, P1/S10) — it binds no fetch and owns no store, so (exactly
// like the sibling AddAnnotationPopover surface) the cache-then-network lifecycle (loading / empty / error /
// stale / offline) belongs to the OWNING surface that decides to raise the prompt, not here; modelling those
// phases would invent behaviour the web spec does not have (drift). The branches the web source actually
// defines are the complete state set this surface renders, and each is projected here:
//   1. the danger-vs-warning variant (web `variant`) -> the critical/warn severity that selects the icon glyph
//      and the accent colour the composable tints the message box + confirm button with,
//   2. the typed-confirmation gate (web `requireTypedConfirmation`) — the confirm action stays disabled until
//      the user types the exact required string (web `typed === requireTypedConfirmation`),
//   3. the in-flight (`loading`) state — both buttons disable, confirm shows a spinner, the dialog is not
//      dismissible (the dismiss guard is carried by the composable; see ConfirmDialog.kt),
//   4. the "Don't ask again" silence affordance (web `silenceKey`) — honoured ONLY for non-danger,
//      non-typed-confirmation prompts (web `silenceKey && variant !== 'danger' && !requireTypedConfirmation`),
//      persisted through the [ConfirmSilenceStore] seam (the native analogue of web `lib/confirmSilence.ts`),
//      with the auto-resolve short-circuit when the action was previously silenced (web `isSilenced`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ConfirmDialog — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modal surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.confirmdialog

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The destructive-emphasis union the web component offers (web `variant: 'danger' | 'warning'`, default
 * `'danger'`). [Danger] is for irreversible actions (delete vehicle, wipe data); [Warning] is for cautionary
 * but recoverable ones. Mapped to a [ConfirmSeverity] by [ConfirmDialogProjection.severityFor].
 */
enum class ConfirmVariant {
    Danger,
    Warning,
}

/**
 * The canonical severity the variant resolves to (web `variantToSeverity`: danger -> 'critical',
 * warning -> 'warn'). Selects the severity glyph + accent colour at the Compose boundary (P1/S9), mirroring
 * the web `severityTokens[sev]` lookup (AlertOctagon/red for [Critical], AlertTriangle/amber for [Warn]).
 */
enum class ConfirmSeverity {
    Critical,
    Warn,
}

/**
 * The "Don't ask again" persistence seam — the native analogue of the web `lib/confirmSilence.ts` helpers
 * (`isSilenced` / `silence`) that the dialog reads/writes through `localStorage`. Kept as a pure interface so
 * the model + projection stay framework-free and off-device testable with an in-memory fake; the production
 * `SharedPreferences`-backed implementation lives at the Compose boundary (ConfirmDialog.kt).
 */
interface ConfirmSilenceStore {
    /** Whether the user previously opted to silence this stable action [key] (web `isSilenced(key)`). */
    fun isSilenced(key: String): Boolean

    /** Persist that the user no longer wants to be asked about this action [key] (web `silence(key)`). */
    fun silence(key: String)
}

/**
 * A store that never silences anything — the safe default for previews and the off-device unit gate, where no
 * persistence is wired. Matches the web behaviour when `localStorage` is unavailable (private mode / quota):
 * the dialog simply re-prompts.
 */
object NoopConfirmSilenceStore : ConfirmSilenceStore {
    override fun isSilenced(key: String): Boolean = false

    override fun silence(key: String) {
        // No persistence in previews/tests: re-prompting is the safe default (web `lib/confirmSilence` fallback).
    }
}

/**
 * Pure projection from the dialog's inputs to its render decisions — a 1:1 port of the derivations the web
 * component performs inline (the `variantToSeverity` lookup, the `silenceHonored` guard, the `typedMatches` /
 * `confirmDisabled` computation, the typed-confirmation input-label fallback, and the silenced auto-resolve
 * short-circuit). No Compose, no side effects.
 */
object ConfirmDialogProjection {
    /** Maps the web `variant` to its canonical severity (web `variantToSeverity`). */
    fun severityFor(variant: ConfirmVariant): ConfirmSeverity =
        when (variant) {
            ConfirmVariant.Danger -> ConfirmSeverity.Critical
            ConfirmVariant.Warning -> ConfirmSeverity.Warn
        }

    /**
     * Whether the "Don't ask again" silence affordance is honoured — the web
     * `Boolean(silenceKey && variant !== 'danger' && !requireTypedConfirmation)`. Destructive ([Danger]) and
     * typed-confirmation prompts always re-prompt regardless of caller, and an absent/blank [silenceKey] is
     * never honoured (web truthiness of `silenceKey`).
     */
    fun isSilenceHonored(
        variant: ConfirmVariant,
        requireTypedConfirmation: String?,
        silenceKey: String?,
    ): Boolean = !silenceKey.isNullOrEmpty() && variant != ConfirmVariant.Danger && requireTypedConfirmation == null

    /**
     * Whether the typed-confirmation gate is satisfied — the web `!requireTypedConfirmation || typed ===
     * requireTypedConfirmation`. A dialog with no required string is always considered matched.
     */
    fun typedMatches(
        requireTypedConfirmation: String?,
        typed: String,
    ): Boolean = requireTypedConfirmation == null || typed == requireTypedConfirmation

    /**
     * Whether the confirm action is actionable — the inverse of the web `confirmDisabled = loading ||
     * !typedMatches`. Disabled while a mutation is in flight ([loading]) or until the required string is typed.
     */
    fun confirmEnabled(
        loading: Boolean,
        requireTypedConfirmation: String?,
        typed: String,
    ): Boolean = !loading && typedMatches(requireTypedConfirmation, typed)

    /**
     * The label for the typed-confirmation input — the web `typedConfirmationLabel ?? (requireTypedConfirmation
     * ? 'Type "X" to confirm' : '')`. The native port resolves the fallback to the required string itself (the
     * exact token the user must type), matching the shared `components/ui/ConfirmDialog` interpretation: this
     * avoids a hard-coded English literal in native code (P1/S10 rule) without inventing a catalog key the web
     * source does not have. Returns `null` when there is no typed-confirmation gate (the input is not rendered).
     */
    fun typedConfirmationInputLabel(
        custom: String?,
        requireTypedConfirmation: String?,
    ): String? = custom ?: requireTypedConfirmation

    /**
     * Whether the silence choice should be persisted on confirm — the web `if (silenceHonored && silenceKey &&
     * dontAskAgain) silence(silenceKey)` guard. The composable calls [ConfirmSilenceStore.silence] only when
     * this is true.
     */
    fun shouldPersistSilence(
        silenceHonored: Boolean,
        silenceKey: String?,
        dontAskAgain: Boolean,
    ): Boolean = silenceHonored && !silenceKey.isNullOrEmpty() && dontAskAgain

    /**
     * Whether the dialog should render nothing and auto-resolve because the action was previously silenced —
     * the web `if (open && silenceHonored && isSilenced(silenceKey)) return null` short-circuit. [silenced] is
     * the store's answer for the action id (web `isSilenced(silenceKey)`); [silenceHonored] is the result of
     * [isSilenceHonored]. The composable fires `onConfirm` and renders nothing when this is true.
     */
    fun suppressRender(
        silenceHonored: Boolean,
        silenced: Boolean,
    ): Boolean = silenceHonored && silenced
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ConfirmDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "confirm-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ConfirmDialog"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [ConfirmDialogRegistration.SLUG] — never the dialog title, message, the typed string, or the silence action
 * id — so a diagnostics line can never leak what the user is confirming. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
object ConfirmDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to ConfirmDialogRegistration.SLUG))
    }
}
