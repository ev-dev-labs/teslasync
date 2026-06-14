// UI-thread-free state holder backing the PinButton surface — the native port of the web composition
// (web/src/components/ui/PinButton.tsx over web/src/api/hooks/usePinned.ts). It binds the
// [PinButtonSource] seam (P1/S8), projects the cache-then-network pin feed onto a lifecycle-aware
// [UiState] of the typed [PinButtonData] (via [projectPinButtonResource]), tracks the in-flight toggle
// (web `toggle.isPending`), runs the pin/unpin mutation and raises the localized success/error toast
// (web `useTogglePin` `onSuccess`/`onError`), exposes a read retry, and emits the PII-safe one-shot
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] + [toggling] and
// calls [toggle] / [retry] / [onViewOpened] (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PinButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pinbutton

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map

/**
 * State holder backing one Compose [PinButton] — the Android port of the web `PinButton` composition over
 * `usePinned` + `useTogglePin`.
 *
 * [state] projects the [PinButtonSource.pinned] feed for the bound `(itemType, context)` bucket onto a
 * lifecycle-aware [UiState] of [PinButtonData] (whose [PinButtonData.isPinned] drives the icon tint,
 * labels, and toggle direction). The projection is NEVER "empty" — an empty pin list is the unpinned
 * content state — so the phase resolves to loading (first read, no cache) or content, and the freshness
 * envelope (stale / offline / refreshing / hard error) rides along for the render boundary's additive
 * chrome. [toggling] mirrors the web `toggle.isPending`: it is true only while a [toggle] mutation is in
 * flight, disabling the button.
 *
 * [toggle] runs the pin/unpin mutation through the seam and raises the localized success/error toast (web
 * `useTogglePin`); [retry] restarts the read after a hard error; [onViewOpened] emits the one-shot P1/S11
 * `view.opened` diagnostic. The view stays a thin renderer; it performs no HTTP.
 *
 * @param source the shared pin read + mutation seam (the real `PinnedStore` in production, a fake in tests).
 * @param itemType the pin bucket (web `itemType`).
 * @param itemId the stable, already-stringified row id (web `String(itemId)`).
 * @param context the optional sub-surface scope (web `context`).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PinButtonViewModel(
    private val source: PinButtonSource,
    private val itemType: PinnedItemType,
    private val itemId: String,
    private val context: String?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val togglingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** True only while a [toggle] mutation is in flight — the web `toggle.isPending` (disables the button). */
    val toggling: StateFlow<Boolean> = togglingState.asStateFlow()

    /**
     * The bound item's pin state as cache-then-network UI state. The empty pin list is the unpinned
     * content state (never the Empty phase), so the projection's emptiness predicate is always false.
     */
    val state: StateFlow<UiState<PinButtonData>> =
        source
            .pinned(itemType, context)
            .map { projectPinButtonResource(it, itemId) }
            .asUiState { false }

    /**
     * Pins or unpins the bound item — the native port of the web
     * `toggle.mutate({ itemId, context, pin: !isPinned })`. The direction is derived from the current
     * [state] (web `!isPinned`); a tap while a previous toggle is still pending is ignored (web
     * `if (toggle.isPending) return`). On resolution it records the PII-safe outcome and raises the
     * localized success/error toast on the optional [toast] host (web `useTogglePin` `onSuccess`/`onError`
     * through `useOptionalToast` — a `null` host degrades gracefully). [toastCopy] carries the already
     * localized titles resolved at the render boundary (P1/S10).
     */
    fun toggle(
        toastCopy: PinButtonToastCopy,
        toast: ToastController?,
    ) {
        if (togglingState.value) return
        val pin = pinToggleTarget(state.value.data?.isPinned ?: false)
        togglingState.value = true
        launch {
            val result = source.togglePin(itemType, itemId, pin, context)
            togglingState.value = false
            val succeeded = result.isSuccess
            recordPinButtonToggle(logger, pinToggleOutcome(pin, succeeded))
            val title = pinToggleToastTitle(pin, succeeded, toastCopy)
            if (succeeded) toast?.success(title) else toast?.error(title)
        }
    }

    /** Re-fetches the pin feed after a hard read error — the Retry affordance's action. */
    fun retry() {
        recordPinButtonRetry(logger)
        source.refresh()
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPinButtonOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            source: PinButtonSource,
            itemType: PinnedItemType,
            itemId: String,
            context: String?,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PinButtonViewModel(source, itemType, itemId, context, logger) }
            }
    }
}
