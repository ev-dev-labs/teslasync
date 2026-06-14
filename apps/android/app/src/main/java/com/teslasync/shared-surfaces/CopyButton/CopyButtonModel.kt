// Pure, framework-free model + diagnostics for the CopyButton shared surface — the native analogue of
// web/src/components/ui/CopyButton.tsx. No Compose, no Android framework, no coroutines, so every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate and the composable
// stays a thin render layer (ADR-002).
//
// The web source is an IMPERATIVE clipboard affordance, not an async cache-then-network view: a single
// button that, on tap, writes its `text` prop to the clipboard (`navigator.clipboard.writeText`), flips
// to a two-second "Copied" confirmation, optionally raises a success/error toast (only when `withToast`
// is set, through the gracefully-degrading `useOptionalToast`), and toggles its visible label and
// accessible name between "Copy" and "Copied". Its bound data sources are `useTranslation` (resolved at
// the render boundary through the P1/S10 catalog) and `useOptionalToast` (the shared toast holder — the
// P1/S8 ToastController seam, nullable because the primitive must work with no host mounted). Because it
// is an interaction and NOT a data feed, it has no loading / empty / error / stale / offline lifecycle to
// render; modelling those would fabricate behaviour the web spec does not have (the same rationale the
// accepted CopyLinkButton / GuardedLink / VisuallyHidden ports document, covenant #9). The surface's REAL
// states are reproduced instead: the idle button (copy glyph + "Copy"), the copied confirmation (check
// glyph + "Copied") that elapses after [COPIED_RESET_MILLIS], and the copy-failed branch (error toast
// when `withToast` is set while the button stays idle — the web `catch`).
//
// `InvalidPackageDeclaration` / `MatchingDeclarationName` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/CopyButton) cannot form a valid Kotlin package and this file
// co-locates several supporting declarations alongside the namesake registration object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

import io.teslasync.shared.core.diagnostics.Logger
import java.util.UUID

/**
 * Canonical registry metadata for the CopyButton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`CopyButton`); [ID]
 * is the `viewModel` key prefix the composable binds its state holder with, and [ROOT_TEST_TAG] names the
 * node the on-device UI test drives.
 */
object CopyButtonRegistration {
    /** Stable surface id, also the `viewModel` key prefix the composable binds its holder with. */
    const val ID: String = "copy-button"

    /** Diagnostics surface slug emitted with the `view.opened` / copy events (P1/S11). */
    const val SLUG: String = "CopyButton"

    /** Test tag for the clickable button node, present in every render state. */
    const val ROOT_TEST_TAG: String = "copy-button"
}

/** How long the "Copied" confirmation stays before reverting to idle (web `setTimeout(…, 2000)`). */
const val COPIED_RESET_MILLIS: Long = 2_000L

/**
 * The render state of the button — the native analogue of the web `const [copied, setCopied]`. [copied]
 * is true for [COPIED_RESET_MILLIS] after a successful copy, swapping the copy glyph + "Copy" label for
 * the check glyph + "Copied" label, then reverts.
 */
data class CopyButtonUiState(
    val copied: Boolean = false,
) {
    companion object {
        /** The resting state: copy glyph + "Copy". */
        val Idle: CopyButtonUiState = CopyButtonUiState(copied = false)
    }
}

/**
 * The already-localized toast copy resolved at the render boundary (P1/S10) and handed to the holder, so
 * the framework-free state holder raises the right toast without ever touching the i18n catalog itself —
 * the native analogue of `t('common.copyButton.successToast', …)` / `t('common.copyButton.errorToast', …)`.
 *
 * Passed to the holder as `null` when the web `withToast` prop is false, so "only toast when asked"
 * (the web `if (withToast) toast?.success(…)`) is expressed without a second flag.
 *
 * @property success the success-toast body (web `common.copyButton.successToast`).
 * @property error the failure-toast body (web `common.copyButton.errorToast`).
 */
data class CopyButtonToastCopy(
    val success: String,
    val error: String,
)

/**
 * The two base button labels resolved at the render boundary (P1/S10) — the "Copy" / "Copied" pair the
 * web reads via `t('common.copyButton.copy')` / `t('common.copyButton.copied')`. They always travel
 * together (a label decision needs both), so they are bundled into one value the pure label helpers read.
 *
 * @property copy the idle label (web `common.copyButton.copy`).
 * @property copied the post-copy confirmation label (web `common.copyButton.copied`).
 */
data class CopyButtonLabels(
    val copy: String,
    val copied: String,
)

/**
 * The resolved outcome of a copy attempt, emitted (PII-free) as a diagnostics field so a copy can be
 * observed without ever recording the copied text (which can carry VINs, tokens, or locations).
 */
enum class CopyOutcome {
    /** The text reached the clipboard (web `try` succeeded). */
    Copied,

    /** The platform rejected the clipboard write (web `catch`). */
    Failed,
}

/** The stable, dot-namespaced diagnostics event emitted once when the button is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a copy attempt resolves. */
const val EVENT_COPY: String = "copyButton.copy"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the copy outcome (never the copied text). */
const val FIELD_OUTCOME: String = "outcome"

/** Maps a clipboard-write result onto its diagnostics [CopyOutcome] (web `try` vs `catch`). */
fun copyOutcomeFor(succeeded: Boolean): CopyOutcome = if (succeeded) CopyOutcome.Copied else CopyOutcome.Failed

/**
 * The visible button label for the current state — the native analogue of the web
 * `iconOnly ? null : (label ?? (copied ? copiedLabel : copyLabel))`. Returns `null` for [iconOnly] (no
 * visible text, only the glyph), the [labelOverride] when the caller pins a fixed label (web `label`,
 * which does not toggle), and otherwise toggles the [labels] copied / copy pair. Kept pure so the render
 * decision is unit-tested off-device.
 */
fun copyButtonVisibleLabel(
    copied: Boolean,
    iconOnly: Boolean,
    labelOverride: String?,
    labels: CopyButtonLabels,
): String? =
    when {
        iconOnly -> null
        labelOverride != null -> labelOverride
        copied -> labels.copied
        else -> labels.copy
    }

/**
 * The accessible name override for the current state — the native analogue of the web
 * `ariaLabel ?? (iconOnly ? (copied ? copiedLabel : (label ?? copyLabel)) : undefined)`. An explicit
 * [ariaLabel] always wins; a labeled (non-[iconOnly]) button returns `null` so the visible text is the
 * spoken name (web `undefined`); an icon-only button always resolves a non-null name so assistive tech
 * has something to announce. Kept pure so the decision is unit-tested off-device.
 */
fun copyButtonAccessibleLabel(
    copied: Boolean,
    iconOnly: Boolean,
    ariaLabel: String?,
    labelOverride: String?,
    labels: CopyButtonLabels,
): String? =
    when {
        ariaLabel != null -> ariaLabel
        !iconOnly -> null
        copied -> labels.copied
        else -> labelOverride ?: labels.copy
    }

/**
 * A fresh per-placement instance id — used as the `viewModel` key suffix so many CopyButtons on one
 * screen (the web component is explicitly built for dense rows / table cells) each track their own
 * [CopyButtonUiState] instead of sharing one confirmation window. The native analogue of React giving
 * every `useState` call its own cell.
 */
fun randomCopyButtonInstanceId(): String = UUID.randomUUID().toString()

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [CopyButtonRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls
 * it once per placement open.
 */
fun recordCopyButtonOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to CopyButtonRegistration.SLUG))
}

/**
 * Emits the PII-safe copy diagnostic carrying only the surface slug and the resolved [outcome] — never
 * the copied text, so a diagnostics line can never leak what a user copied.
 */
fun recordCopyButtonCopy(
    logger: Logger,
    outcome: CopyOutcome,
) {
    logger.info(
        EVENT_COPY,
        mapOf(FIELD_SURFACE to CopyButtonRegistration.SLUG, FIELD_OUTCOME to outcome.name.lowercase()),
    )
}
