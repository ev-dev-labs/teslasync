// Pure, framework-free model + diagnostics for the CopyLinkButton shared surface — the native analogue
// of web/src/components/layout/CopyLinkButton.tsx. No Compose, no Android framework, no coroutines, so
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate and the
// composable stays a thin render layer (ADR-002).
//
// The web source is an IMPERATIVE share affordance, not an async cache-then-network view: a single ghost
// button that, on tap, copies the current deep-linked URL (`window.location.href`) to the clipboard,
// flips to a two-second "Copied" confirmation, and raises a success/error toast (`useToast`). Its bound
// data sources are `useTranslation` (resolved at the render boundary through the P1/S10 catalog) and
// `useToast` (the shared toast state holder — the P1/S8 ToastController seam). Because it is an
// interaction and NOT a data feed, it has no loading / empty / error / stale / offline lifecycle to
// render; modelling those would fabricate behaviour the web spec does not have (the same rationale the
// accepted GuardedLink / VisuallyHidden ports document, covenant #9). The surface's REAL states are
// reproduced instead: the idle button (link glyph + "Copy link"), the copied confirmation (check glyph +
// "Copied") that elapses after [COPIED_RESET_MILLIS], and the copy-failed branch (error toast while the
// button stays idle — the web `catch`).
//
// `InvalidPackageDeclaration` / `MatchingDeclarationName` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/CopyLinkButton) cannot form a valid Kotlin package and this
// file co-locates several supporting declarations alongside the namesake registration object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the CopyLinkButton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`CopyLinkButton`);
 * [ID] is the `viewModel` key the composable binds its state holder with, and [ROOT_TEST_TAG] names the
 * node the on-device UI test drives.
 */
object CopyLinkButtonRegistration {
    /** Stable surface id, also the `viewModel` key the composable binds its holder with. */
    const val ID: String = "copy-link-button"

    /** Diagnostics surface slug emitted with the `view.opened` / copy events (P1/S11). */
    const val SLUG: String = "CopyLinkButton"

    /** Test tag for the clickable button node, present in every render state. */
    const val ROOT_TEST_TAG: String = "copy-link-button"
}

/** How long the "Copied" confirmation stays before reverting to idle (web `setTimeout(…, 2000)`). */
const val COPIED_RESET_MILLIS: Long = 2_000L

/**
 * The render state of the button — the native analogue of the web `const [copied, setCopied]`. [copied]
 * is true for [COPIED_RESET_MILLIS] after a successful copy, swapping the link glyph + "Copy link" label
 * for the check glyph + "Copied" label, then reverts.
 */
data class CopyLinkUiState(
    val copied: Boolean = false,
) {
    companion object {
        /** The resting state: link glyph + "Copy link". */
        val Idle: CopyLinkUiState = CopyLinkUiState(copied = false)
    }
}

/**
 * The already-localized toast copy resolved at the render boundary (P1/S10) and handed to the holder, so
 * the framework-free state holder raises the right toast without ever touching the i18n catalog itself —
 * the native analogue of the web `t('common.copyLink.success', …)` / `t('common.copyLink.error', …)`.
 *
 * @property success the success-toast body (web `common.copyLink.success`).
 * @property error the failure-toast body (web `common.copyLink.error`).
 */
data class CopyLinkToastCopy(
    val success: String,
    val error: String,
)

/**
 * The resolved outcome of a copy attempt, emitted (PII-free) as a diagnostics field so a copy can be
 * observed without ever recording the copied link/URL (which can carry locations or filter state).
 */
enum class CopyOutcome {
    /** The link reached the clipboard (web `try` succeeded). */
    Copied,

    /** The platform rejected the clipboard write (web `catch`). */
    Failed,
}

/** The stable, dot-namespaced diagnostics event emitted once when the button is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a copy attempt resolves. */
const val EVENT_COPY: String = "copyLink.copy"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the copy outcome (never the copied link). */
const val FIELD_OUTCOME: String = "outcome"

/** Maps a clipboard-write result onto its diagnostics [CopyOutcome] (web `try` vs `catch`). */
fun copyOutcomeFor(succeeded: Boolean): CopyOutcome = if (succeeded) CopyOutcome.Copied else CopyOutcome.Failed

/**
 * The visible button label for the current [copied] state — the native analogue of the web
 * `copied ? t('…copied') : t('…action')`. Kept pure so the render decision is unit-tested off-device.
 */
fun visibleCopyLabel(
    copied: Boolean,
    copyLabel: String,
    copiedLabel: String,
): String = if (copied) copiedLabel else copyLabel

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [CopyLinkButtonRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls it
 * once per placement open.
 */
fun recordCopyLinkOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to CopyLinkButtonRegistration.SLUG))
}

/**
 * Emits the PII-safe copy diagnostic carrying only the surface slug and the resolved [outcome] — never the
 * copied link, query, or any user content, so a diagnostics line can never leak where a user was sharing.
 */
fun recordCopyLinkCopy(
    logger: Logger,
    outcome: CopyOutcome,
) {
    logger.info(
        EVENT_COPY,
        mapOf(FIELD_SURFACE to CopyLinkButtonRegistration.SLUG, FIELD_OUTCOME to outcome.name.lowercase()),
    )
}
