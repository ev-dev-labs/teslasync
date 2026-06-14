// UI-thread-free state holder backing the CopyButton surface — the native port of the web `CopyButton`
// click handler (web/src/components/ui/CopyButton.tsx) over the `useOptionalToast` seam. It copies the
// caller-supplied text through the bound [ClipboardWriter], raises the success/error toast on the shared
// [ToastController] only when the caller passed toast copy (the web `if (withToast) toast?.…`), invokes
// the host `onCopy` callback on success, drives the two-second "Copied" confirmation the render boundary
// swaps glyph + label on, and emits the PII-safe diagnostics. The view performs NO clipboard I/O and no
// timing — it only collects [state] and calls [copy] / [onViewOpened] (ADR-002).
//
// The toast holder is NULLABLE: the web primitive reads `useOptionalToast`, which returns `null` outside
// a mounted host, so a toast is raised only when both a host is present AND the caller opted in — never a
// crash when neither holds. It extends [BaseFeedViewModel] for the sanctioned redacting [logger] and the
// scope-bound [launch] helper, exactly like the sibling state holders. Because a CopyButton is a reusable
// leaf used many times per screen, the composable binds it with a per-placement key.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CopyButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State holder backing one Compose [CopyButton] — the Android port of the web `CopyButton`'s `handleCopy`
 * over the `useOptionalToast` seam.
 *
 * On [copy] it writes the caller-supplied text to the clipboard through the [clipboard] seam, records the
 * PII-safe outcome, and branches exactly like the web `try`/`catch`: on success it flips [state] to
 * `copied` (web `setCopied(true)`), invokes the host `onCopied` callback (web `onCopy?.()`), raises the
 * success toast when toast copy was supplied (web `if (withToast) toast?.success`), and schedules the
 * two-second revert (web `setTimeout(() => setCopied(false), 2000)`); on failure it raises the error toast
 * when toast copy was supplied (web `catch` → `if (withToast) toast?.error`) and leaves the button idle. A
 * second copy while the confirmation is showing restarts the revert timer so the most recent success owns
 * the window.
 *
 * @param clipboard the shared clipboard seam (the system clipboard in production, a recording fake in tests).
 * @param toast the shared toast queue holder, or `null` when no host is mounted — the `useOptionalToast`
 *   analogue (a real [ToastController] in tests that assert a toast, `null` in tests that assert none).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class CopyButtonViewModel(
    private val clipboard: ClipboardWriter,
    private val toast: ToastController?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(CopyButtonUiState.Idle)

    /** This button's render state — `copied` while the confirmation window is open. */
    val state: StateFlow<CopyButtonUiState> = mutableState.asStateFlow()

    private var resetJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * Copies [text] to the clipboard under [clipLabel] and resolves the outcome — the native port of the
     * web `handleCopy`. [toastCopy] carries the already-localized success/error toast bodies (resolved at
     * the render boundary, P1/S10) when the web `withToast` prop is set, or `null` to suppress the toast.
     * [onCopied] is the host `onCopy` callback, fired once on success. The copied text is NEVER logged;
     * only the [CopyOutcome] is.
     */
    fun copy(
        text: String,
        clipLabel: String,
        toastCopy: CopyButtonToastCopy?,
        onCopied: () -> Unit,
    ) {
        val succeeded = clipboard.writeText(clipLabel, text)
        recordCopyButtonCopy(logger, copyOutcomeFor(succeeded))
        if (succeeded) {
            mutableState.value = CopyButtonUiState(copied = true)
            onCopied()
            toastCopy?.let { toast?.success(it.success) }
            scheduleReset()
        } else {
            toastCopy?.let { toast?.error(it.error) }
        }
    }

    private fun scheduleReset() {
        resetJob?.cancel()
        resetJob =
            stateScope.launch {
                delay(COPIED_RESET_MILLIS)
                mutableState.value = CopyButtonUiState.Idle
            }
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per placement. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCopyButtonOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            clipboard: ClipboardWriter,
            toast: ToastController?,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CopyButtonViewModel(clipboard, toast, logger) }
            }
    }
}
