// UI-thread-free state holder backing the CopyLinkButton surface — the native port of the web
// `CopyLinkButton` click handler (web/src/components/layout/CopyLinkButton.tsx) over the `useToast` seam.
// It copies the caller-supplied link through the bound [ClipboardWriter], raises the success/error toast
// on the shared [ToastController] (the `useToast` analogue), drives the two-second "Copied" confirmation
// the render boundary swaps icon + label on, and emits the PII-safe diagnostics. The view performs NO
// clipboard I/O and no timing — it only collects [state] and calls [copyLink] / [onViewOpened] (ADR-002).
//
// It extends [BaseFeedViewModel] for the sanctioned redacting [logger] and the scope-bound [launch]
// helper, exactly like the sibling state holders. Because a CopyLinkButton is a reusable leaf, the
// composable binds it with a stable surface key; the holder tracks its own [CopyLinkUiState].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CopyLinkButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

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
 * State holder backing one Compose [CopyLinkButton] — the Android port of the web `CopyLinkButton`'s
 * `handleClick` over the `useToast` seam.
 *
 * On [copyLink] it writes the caller-supplied link to the clipboard through the [clipboard] seam, records
 * the PII-safe outcome, and branches exactly like the web `try`/`catch`: on success it flips [state] to
 * `copied` (web `setCopied(true)`), raises the success toast (web `toast.success`), and schedules the
 * two-second revert (web `setTimeout(() => setCopied(false), 2000)`); on failure it raises the error toast
 * (web `toast.error`) and leaves the button idle. A second copy while the confirmation is showing restarts
 * the revert timer so the most recent success owns the window.
 *
 * @param clipboard the shared clipboard seam (the system clipboard in production, a recording fake in tests).
 * @param toast the shared toast queue holder — the `useToast` analogue (a real [ToastController] in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class CopyLinkButtonViewModel(
    private val clipboard: ClipboardWriter,
    private val toast: ToastController,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(CopyLinkUiState.Idle)

    /** This button's render state — `copied` while the confirmation window is open. */
    val state: StateFlow<CopyLinkUiState> = mutableState.asStateFlow()

    private var resetJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * Copies [link] to the clipboard under [label] and resolves the outcome — the native port of the web
     * `handleClick`. [copy] carries the already-localized success/error toast bodies (resolved at the
     * render boundary, P1/S10). The copied link is NEVER logged; only the [CopyOutcome] is.
     */
    fun copyLink(
        link: String,
        label: String,
        copy: CopyLinkToastCopy,
    ) {
        val succeeded = clipboard.writeLink(label, link)
        recordCopyLinkCopy(logger, copyOutcomeFor(succeeded))
        if (succeeded) {
            mutableState.value = CopyLinkUiState(copied = true)
            toast.success(copy.success)
            scheduleReset()
        } else {
            toast.error(copy.error)
        }
    }

    private fun scheduleReset() {
        resetJob?.cancel()
        resetJob =
            stateScope.launch {
                delay(COPIED_RESET_MILLIS)
                mutableState.value = CopyLinkUiState.Idle
            }
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per placement. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCopyLinkOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            clipboard: ClipboardWriter,
            toast: ToastController,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CopyLinkButtonViewModel(clipboard, toast, logger) }
            }
    }
}
