// Pure, framework-free model + diagnostics for the PrintButton shared surface — the native analogue of
// web/src/components/ui/PrintButton.tsx. No Compose, no Android framework, no coroutines, so every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate and the composable
// stays a thin render layer (ADR-002).
//
// The web source is an IMPERATIVE print affordance, not an async cache-then-network view: a ghost/sm
// button carrying a Printer glyph and the "Print" label that, on tap, runs a re-entry guard
// (`if (printing) return`), flips an internal `printing` flag, awaits an optional `beforePrint` setup
// hook (expand collapsed panels, switch to the tab the user wants on paper), gives the framework one
// animation frame to flush those state changes, then opens the print dialog (`window.print()`) and
// clears the flag; if `beforePrint` throws, it logs the error and clears the flag. Its only bound data
// source is `useTranslation` (resolved at the render boundary through the P1/S10 catalog as the "Print"
// label). Because it is an interaction and NOT a data feed, it has no loading / empty / error / stale /
// offline lifecycle to render; modelling those would fabricate behaviour the web spec does not have (the
// same rationale the accepted CopyButton / CopyLinkButton / Checkbox ports document, covenant #9).
//
// The `printing` flag is, in the web source, PURELY an internal re-entry guard — the rendered Button
// references `disabled`, never `printing`, so a print in flight has no distinct visual. This port keeps
// that contract: `printing` lives in the state holder and gates double-taps, but the rendered surface is
// identical whether idle or printing. The surface's REAL, fully-reproduced states are therefore: the
// idle button (Printer glyph + "Print"), the icon-only variant (glyph only, accessible name carried by
// the web `aria-label`), the disabled button, and the `beforePrint`-failed branch (the web `catch` —
// the flag clears and the button stays usable). The web `data-print-hide` attribute (which hides the
// button on the printed page via the `@media print` stylesheet) has no native analogue: the Android
// print framework rasterises a caller-supplied document, not the live view tree, so there is nothing to
// hide. It is intentionally absent rather than ported to a no-op.
//
// `InvalidPackageDeclaration` / `MatchingDeclarationName` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/PrintButton) cannot form a valid Kotlin package and this file
// co-locates several supporting declarations alongside the namesake registration object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import io.teslasync.shared.core.diagnostics.Logger
import java.util.UUID

/**
 * Canonical registry metadata for the PrintButton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PrintButton`); [ID]
 * is the `viewModel` key prefix the composable binds its state holder with, and [ROOT_TEST_TAG] names the
 * node the on-device UI test drives.
 */
object PrintButtonRegistration {
    /** Stable surface id, also the `viewModel` key prefix the composable binds its holder with. */
    const val ID: String = "print-button"

    /** Diagnostics surface slug emitted with the `view.opened` / print events (P1/S11). */
    const val SLUG: String = "PrintButton"

    /** Test tag for the clickable button node, present in every render state. */
    const val ROOT_TEST_TAG: String = "print-button"
}

/**
 * The render state of the button — the native analogue of the web `const [printing, setPrinting]`.
 * [printing] is true while an in-flight print (the awaited `beforePrint` + the one-frame flush + the
 * dialog launch) is running, gating re-entry exactly like the web `if (printing) return`. It carries NO
 * distinct visual (the web Button references `disabled`, never `printing`), so the rendered surface is
 * identical in both states; the flag exists only to prevent a double-launch.
 */
data class PrintButtonUiState(
    val printing: Boolean = false,
) {
    companion object {
        /** The resting state: ready to print. */
        val Idle: PrintButtonUiState = PrintButtonUiState(printing = false)
    }
}

/**
 * The resolved outcome of a print-dialog launch, emitted (PII-free) as a diagnostics field so a print can
 * be observed without recording anything about the page being printed.
 */
enum class PrintOutcome {
    /** The system print dialog was launched (web `window.print()` reached the browser). */
    Launched,

    /** The platform rejected the launch — e.g. no print service is available (a native-only branch). */
    Failed,
}

/** Maps a print-launch result onto its diagnostics [PrintOutcome]. */
fun printOutcomeFor(launched: Boolean): PrintOutcome = if (launched) PrintOutcome.Launched else PrintOutcome.Failed

/** The stable, dot-namespaced diagnostics event emitted once when the button is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a print-dialog launch resolves. */
const val EVENT_PRINT: String = "printButton.print"

/** The diagnostics event emitted (PII-free) when the optional `beforePrint` hook throws (web `catch`). */
const val EVENT_BEFORE_PRINT_ERROR: String = "printButton.beforePrintError"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the launch outcome (never anything about the printed page). */
const val FIELD_OUTCOME: String = "outcome"

/** The structured-field key carrying the failing exception's type name (code-derived, never user data). */
const val FIELD_ERROR_TYPE: String = "error_type"

/**
 * The visible button label for the current configuration — the native analogue of the web
 * `iconOnly ? null : (label ?? printLabel)`, where the web `printLabel = label ?? t('common.printButton.print')`.
 * Returns `null` for [iconOnly] (no visible text, only the glyph), the [labelOverride] when the caller pins
 * a fixed label (web `label`), and otherwise the localized [printLabel]. Kept pure so the render decision is
 * unit-tested off-device.
 */
fun printButtonVisibleLabel(
    iconOnly: Boolean,
    labelOverride: String?,
    printLabel: String,
): String? =
    when {
        iconOnly -> null
        labelOverride != null -> labelOverride
        else -> printLabel
    }

/**
 * The accessible name override for the current configuration — the native analogue of the web
 * `ariaLabel ?? (iconOnly ? printLabel : undefined)`, where the web `printLabel = label ?? t(...)`. An
 * explicit [ariaLabel] always wins; a labeled (non-[iconOnly]) button returns `null` so the visible text is
 * the spoken name (web `undefined`); an icon-only button always resolves a non-null name (the [labelOverride]
 * when pinned, otherwise the localized [printLabel]) so assistive tech has something to announce. Kept pure so
 * the decision is unit-tested off-device.
 */
fun printButtonAccessibleLabel(
    iconOnly: Boolean,
    ariaLabel: String?,
    labelOverride: String?,
    printLabel: String,
): String? =
    when {
        ariaLabel != null -> ariaLabel
        !iconOnly -> null
        else -> labelOverride ?: printLabel
    }

/**
 * A fresh per-placement instance id — used as the `viewModel` key suffix so multiple PrintButtons on one
 * screen each track their own [PrintButtonUiState] instead of sharing one in-flight guard. The native
 * analogue of React giving every `useState` call its own cell.
 */
fun randomPrintButtonInstanceId(): String = UUID.randomUUID().toString()

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [PrintButtonRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls it
 * once per placement open.
 */
fun recordPrintButtonOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG))
}

/**
 * Emits the PII-safe print diagnostic carrying only the surface slug and the resolved [outcome] — never
 * anything about the page being printed, so a diagnostics line can never leak the user's content.
 */
fun recordPrintButtonPrint(
    logger: Logger,
    outcome: PrintOutcome,
) {
    logger.info(
        EVENT_PRINT,
        mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG, FIELD_OUTCOME to outcome.name.lowercase()),
    )
}

/**
 * Emits the PII-safe error diagnostic for a thrown `beforePrint` hook (web
 * `console.error('PrintButton: beforePrint failed', err)`). It records only the surface slug and the
 * failing exception's TYPE name ([errorType]) — never the exception message, which could carry user data —
 * so the failure is observable without leaking what the hook touched.
 */
fun recordPrintButtonBeforePrintError(
    logger: Logger,
    errorType: String,
) {
    logger.error(
        EVENT_BEFORE_PRINT_ERROR,
        mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG, FIELD_ERROR_TYPE to errorType),
    )
}
