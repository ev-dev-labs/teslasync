// UI-thread-free state holder backing the PrintButton surface — the native port of the web `PrintButton`
// click handler (web/src/components/ui/PrintButton.tsx) over the `window.print()` + `requestAnimationFrame`
// seams. It runs the web re-entry guard, flips the internal `printing` flag, awaits the caller-supplied
// `beforePrint` setup hook, gives the UI one frame to flush the resulting state, launches the system print
// dialog through the bound [PrintLauncher], records the PII-safe diagnostics, and clears the flag — exactly
// the web `try { await beforePrint(); requestAnimationFrame(() => { window.print() }) } catch { … } finally`
// shape. The view performs NO platform print I/O and no frame timing; it only collects [state] and calls
// [print] / [onViewOpened] (ADR-002).
//
// It extends [BaseFeedViewModel] for the sanctioned redacting [logger] and the scope-bound coroutine
// [stateScope], exactly like the sibling state holders. Because a PrintButton can appear more than once on a
// screen (e.g. a page action bar plus a panel-local trigger), the composable binds it with a per-placement
// key so two buttons never share one in-flight guard.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PrintButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/** Diagnostics fallback when a thrown `beforePrint` hook has no simple type name (anonymous class). */
private const val UNKNOWN_ERROR_TYPE: String = "unknown"

/**
 * State holder backing one Compose [PrintButton] — the Android port of the web `PrintButton`'s
 * `handleClick` over the `window.print()` + `requestAnimationFrame` seams.
 *
 * On [print] it branches exactly like the web handler: if a print is already in flight it no-ops (web
 * `if (printing) return`); otherwise it flips [state] to `printing` (web `setPrinting(true)`), awaits the
 * optional `beforePrint` hook, gives the UI one frame to commit any pre-print state ([frame] —
 * web `requestAnimationFrame`), launches the system print dialog through [launcher] (web `window.print()`),
 * records the resolved [PrintOutcome], and clears the flag. If `beforePrint` throws, it records the PII-safe
 * error (web `console.error`) and clears the flag without launching the dialog. The flag is ALWAYS cleared
 * (web `finally` / the `catch` reset), so a failed setup never wedges the button.
 *
 * @param launcher the system-print seam (the real `PrintManager` in production, a recording double in tests).
 * @param frame the one-frame flush seam (the `withFrameNanos` clock in production, immediate in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PrintButtonViewModel(
    private val launcher: PrintLauncher,
    private val frame: FrameSynchronizer,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(PrintButtonUiState.Idle)

    /** This button's render state — `printing` while an in-flight print holds the re-entry guard. */
    val state: StateFlow<PrintButtonUiState> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /**
     * Opens the print dialog — the native port of the web `handleClick`. [beforePrint] is the host setup
     * hook (web `beforePrint`), awaited before the dialog opens; pass `null` when there is nothing to flush.
     * A second call while a print is in flight is ignored (web `if (printing) return`). Nothing about the
     * printed page is ever logged; only the resolved [PrintOutcome] is.
     */
    fun print(beforePrint: (suspend () -> Unit)?) {
        if (mutableState.value.printing) return
        mutableState.value = PrintButtonUiState(printing = true)
        stateScope.launch {
            try {
                if (runBeforePrint(beforePrint)) {
                    frame.awaitFrame()
                    recordPrintButtonPrint(logger, printOutcomeFor(launcher.print()))
                }
            } finally {
                mutableState.value = PrintButtonUiState.Idle
            }
        }
    }

    /**
     * Runs the optional [beforePrint] hook, returning whether it succeeded (and the print may proceed). A
     * thrown hook is the web `catch`: it records the PII-safe error type and returns `false` so the dialog is
     * not launched. A [CancellationException] is rethrown so structured concurrency is never swallowed.
     */
    @Suppress("TooGenericExceptionCaught")
    private suspend fun runBeforePrint(beforePrint: (suspend () -> Unit)?): Boolean =
        try {
            beforePrint?.invoke()
            true
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Throwable) {
            recordPrintButtonBeforePrintError(logger, error::class.simpleName ?: UNKNOWN_ERROR_TYPE)
            false
        }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per placement. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPrintButtonOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            launcher: PrintLauncher,
            frame: FrameSynchronizer,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PrintButtonViewModel(launcher, frame, logger) }
            }
    }
}
