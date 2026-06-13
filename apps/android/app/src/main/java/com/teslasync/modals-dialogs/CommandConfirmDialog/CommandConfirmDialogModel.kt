// Pure, framework-free model + projection for the CommandConfirmDialog modal/dialog surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/features/system/components/CommandConfirmDialog.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is the destructive Tesla-command confirmation prompt the Commands page raises before it
// sends a dangerous command (erase user data, keyless remote start, clear drive PIN, …). Its only data
// dependency is `useTranslation` (i18n, P1/S10) — it binds no fetch and owns no store, so (exactly like the
// sibling ConfirmDialog surface) the cache-then-network lifecycle (loading / empty / error / stale / offline)
// belongs to the OWNING Commands surface that decides to raise the prompt, not here; modelling those phases
// would invent behaviour the web spec does not have (drift). The branches the web source actually defines are
// the complete state set this surface renders, and each is projected here:
//   1. the count-down arming window (web `countdown` + the per-second `setRemaining` interval) — Confirm is held
//      disabled, dimmed, and labelled `Confirm (Ns)` until [tick] drains the remaining seconds to zero,
//   2. the typed-confirmation gate (web `confirmInput`) — Confirm stays disabled until the user types the exact
//      required token, compared case-insensitively after trimming (web
//      `inputValue.trim().toUpperCase() === confirmInput.toUpperCase()`),
//   3. the combined arm-able predicate (web `canConfirm = remaining === 0 && (!confirmInput || typedMatches)`),
//   4. the in-flight (`loading`) state — Confirm shows a spinner and both the button and the Enter/confirm
//      hand-off disable (the spinner + dismiss wiring is carried by the composable; see CommandConfirmDialog.kt).
//
// `def.labelKey` / `def.confirmKey` are RUNTIME-DYNAMIC i18n keys resolved at the Compose boundary against the
// generated P1/S10 catalog with the def's fallback (the faithful analogue of web `t(def.labelKey,
// def.labelFallback)`); the catalog lookup itself is Android-only, so it lives in CommandConfirmDialog.kt and
// only the key/fallback selection ([confirmMessageKey] / [confirmMessageFallback]) is modelled here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/CommandConfirmDialog — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modal surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandconfirmdialog

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The subset of the web `CommandDef` (web/src/features/system/commands.ts) this dialog reads — the prompt's
 * single data input (web `def: CommandDef`). The owning Commands surface passes the selected command's
 * definition; the dialog only ever touches these six fields, so the native contract is narrowed to them
 * (the full registry is the Commands page's responsibility, out of scope for this surface).
 *
 * @param labelKey i18n key for the dialog title (web `def.labelKey`); resolved with [labelFallback].
 * @param labelFallback the already-English title shown when [labelKey] is absent from the catalog (web
 *   `def.labelFallback`). Owner-supplied data, not a hard-coded literal.
 * @param confirmKey optional i18n key for the confirmation body (web `def.confirmKey`).
 * @param confirmFallback optional already-English confirmation body (web `def.confirmFallback`).
 * @param countdown the arming delay in whole seconds before Confirm becomes pressable (web `def.countdown`,
 *   default `0` = immediately arm-able).
 * @param confirmInput optional token the user must type to confirm an irreversible command (web
 *   `def.confirmInput`, e.g. `"ERASE"`); `null`/empty disables the typed gate.
 */
data class CommandConfirmDef(
    val labelKey: String,
    val labelFallback: String,
    val confirmKey: String? = null,
    val confirmFallback: String? = null,
    val countdown: Int = 0,
    val confirmInput: String? = null,
)

/**
 * Pure projection from the dialog's inputs to its render decisions — a 1:1 port of the derivations the web
 * component performs inline (the `countdown` reset + per-second decrement, the `canConfirm` predicate, the
 * trimmed case-insensitive typed-confirmation compare, the dynamic-message key/fallback selection, and the
 * `Confirm (Ns)` count-down label). No Compose, no side effects.
 */
object CommandConfirmDialogProjection {
    /**
     * The seconds the count-down starts at when the dialog opens — the web `useState(countdown)` /
     * `setRemaining(countdown)` seed, clamped so a negative or absent value arms Confirm immediately
     * (web `def.countdown ?? 0`).
     */
    fun initialRemaining(countdown: Int): Int = countdown.coerceAtLeast(0)

    /**
     * One tick of the count-down — the web `setRemaining(prev => prev <= 1 ? 0 : prev - 1)` reducer the
     * 1-second interval applies. Stops at zero (never negative).
     */
    fun tick(remaining: Int): Int = if (remaining <= 1) 0 else remaining - 1

    /** Whether the arming count-down is still running (web `remaining > 0`). */
    fun isCountingDown(remaining: Int): Boolean = remaining > 0

    /** Whether the dialog renders a typed-confirmation gate at all (web truthiness of `confirmInput`). */
    fun requiresTypedConfirmation(confirmInput: String?): Boolean = !confirmInput.isNullOrEmpty()

    /**
     * Whether the typed-confirmation gate is satisfied — the web `!confirmInput || inputValue.trim()
     * .toUpperCase() === confirmInput.toUpperCase()`. A dialog with no required token is always considered
     * matched; otherwise the comparison is trimmed and case-insensitive.
     */
    fun typedConfirmationMatches(
        confirmInput: String?,
        typed: String,
    ): Boolean = confirmInput.isNullOrEmpty() || typed.trim().uppercase() == confirmInput.uppercase()

    /**
     * Whether Confirm is arm-able — the web `canConfirm = remaining === 0 && (!confirmInput || typedMatches)`.
     * This drives the button's enabled state; the composable additionally hands `loading` to the button (which
     * disables itself while a spinner shows), reproducing the web `disabled={!canConfirm}` + `loading={loading}`.
     */
    fun canConfirm(
        remaining: Int,
        confirmInput: String?,
        typed: String,
    ): Boolean = remaining == 0 && typedConfirmationMatches(confirmInput, typed)

    /**
     * Whether the confirm action may actually fire — the web Enter-key guard `canConfirm && !loading`. The
     * composable uses this for the keyboard-driven hand-off; the on-screen button relies on [canConfirm] plus
     * its own loading-disables-itself behaviour.
     */
    fun confirmActionable(
        remaining: Int,
        confirmInput: String?,
        typed: String,
        loading: Boolean,
    ): Boolean = !loading && canConfirm(remaining, confirmInput, typed)

    /** The i18n key for the confirmation body — the web `def.confirmKey ?? ''` (empty = resolve the fallback). */
    fun confirmMessageKey(confirmKey: String?): String = confirmKey.orEmpty()

    /**
     * The confirmation body shown when [confirmMessageKey] is absent from the catalog — the web
     * `def.confirmFallback ?? 'Are you sure?'` chain. The native P1/S10 rule forbids a hard-coded English
     * literal in view code, and the generated catalog (owned by apps/shared/i18n) carries no generic
     * "are you sure" key, so the unreachable-in-practice last resort (every real dangerous command supplies
     * `confirmFallback`) degrades to the command's own [labelFallback] rather than inventing a literal — a
     * documented, non-silent divergence that still renders an owner-supplied, never-empty prompt.
     */
    fun confirmMessageFallback(
        confirmFallback: String?,
        labelFallback: String,
    ): String = confirmFallback?.takeIf { it.isNotBlank() } ?: labelFallback

    /**
     * The Confirm button label — the web `remaining > 0 ? \`${confirm} (${remaining}s)\` : confirm`. The
     * `(Ns)` count-down suffix is a verbatim port of the web inline template (locale-neutral digits + the
     * unit letter, carried in neither catalog exactly as in the web source), appended to the already-localized
     * [confirmLabel].
     */
    fun countdownConfirmLabel(
        confirmLabel: String,
        remaining: Int,
    ): String = if (remaining > 0) "$confirmLabel ($remaining" + SECONDS_SUFFIX else confirmLabel

    private const val SECONDS_SUFFIX = "s)"
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CommandConfirmDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "command-confirm-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandConfirmDialog"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [CommandConfirmDialogRegistration.SLUG] — never the command title, the confirmation body, the typed token, or
 * which command is being confirmed — so a diagnostics line can never leak what destructive action the user is
 * about to take. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
object CommandConfirmDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to CommandConfirmDialogRegistration.SLUG))
    }
}
