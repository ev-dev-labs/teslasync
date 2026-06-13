// UI-thread-free state holder backing a single GuardedLink placement — the native port of the web
// `GuardedLink` click handler (web/src/components/feedback/GuardedLink.tsx) over the
// `useNavigationGuardContext` seam. It plans each tap (web `onClick` branch), runs the confirm
// round-trip through the bound [NavigationGuard], exposes the in-flight [state] the render boundary dims
// on, re-publishes the seam's [confirmRequest] for the host, and emits the PII-safe diagnostics. The
// view performs NO business logic — it only collects [state] and calls [attemptNavigation] /
// [respondToConfirm] / [onViewOpened] (ADR-002).
//
// It extends [BaseFeedViewModel] for the sanctioned redacting [logger] and the scope-bound [launch]
// helper, exactly like the sibling state holders. Because a GuardedLink is a reusable leaf (many per
// screen) rather than a once-mounted surface, the composable binds one keyed instance per placement
// (a fresh `randomLinkInstanceId`), so each link tracks its own [GuardedLinkUiState] independently.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/GuardedLink) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * State holder backing one Compose [GuardedLink] — the Android port of the web `GuardedLink` click
 * handler over the `useNavigationGuardContext` seam.
 *
 * On a tap it plans the navigation ([planNavigation]) from the bypass flag, this link's in-flight state,
 * and whether any registered guard is dirty, then: navigates straight away on a bypass or clean tree
 * (web `navigate(to, …)`); drops a duplicate tap while a confirmation is already open (web's in-flight
 * promise reuse); or opens the confirmation through [NavigationGuard.confirmIfDirty] and navigates only
 * if the user discards (web `if (ok) navigate(...)`). Every resolution emits a PII-safe navigate
 * diagnostic carrying only the surface slug + the [NavigationOutcome] (never a destination).
 *
 * @param guard the shared navigation-guard seam (the process singleton in production, a fresh instance
 *   in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class GuardedLinkViewModel(
    private val guard: NavigationGuard,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val mutableState = MutableStateFlow(GuardedLinkUiState())

    /** This link's render state — `isConfirming` while its confirm round-trip is open. */
    val state: StateFlow<GuardedLinkUiState> = mutableState.asStateFlow()

    /** The pending confirmation to render, delegated to the bound guard (web provider `pending`). */
    val confirmRequest: StateFlow<NavGuardPrompt?> = guard.confirmRequest

    /** Registers a dirty-state guard and returns its un-register handle (web `register`). */
    fun registerDirtyGuard(entry: NavigationGuardEntry): () -> Unit = guard.register(entry)

    /**
     * Resolves a tap — the native port of web `GuardedLink`'s `onClick`. [bypassGuard] skips the guard
     * (web modifier / middle-click / `target="_blank"`); otherwise a dirty tree is gated behind the
     * confirmation and [navigate] runs only when the user discards. [navigate] is the caller-supplied
     * navigation action (web `useNavigate`'s `navigate(to, …)`), invoked at most once per tap.
     */
    fun attemptNavigation(
        bypassGuard: Boolean,
        navigate: () -> Unit,
    ) {
        when (planNavigation(bypassGuard, mutableState.value.isConfirming, guard.hasDirtyGuard())) {
            NavigationPlan.NavigateNow -> navigateNow(bypassGuard, navigate)
            NavigationPlan.Ignore -> recordGuardedLinkNavigation(logger, NavigationOutcome.Deferred)
            NavigationPlan.AwaitConfirmation -> confirmThenNavigate(navigate)
        }
    }

    private fun navigateNow(
        bypassGuard: Boolean,
        navigate: () -> Unit,
    ) {
        val outcome = if (bypassGuard) NavigationOutcome.Bypassed else NavigationOutcome.Allowed
        recordGuardedLinkNavigation(logger, outcome)
        navigate()
    }

    private fun confirmThenNavigate(navigate: () -> Unit) {
        mutableState.update { it.copy(isConfirming = true) }
        launch {
            val discard = guard.confirmIfDirty()
            mutableState.update { it.copy(isConfirming = false) }
            recordGuardedLinkNavigation(logger, if (discard) NavigationOutcome.Allowed else NavigationOutcome.Blocked)
            if (discard) navigate()
        }
    }

    /** Settles the open confirmation with the user's choice ([discard] = discard + navigate). */
    fun respondToConfirm(discard: Boolean) {
        guard.respond(discard)
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per placement. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGuardedLinkOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds each link placement's holder through. */
        fun factory(
            guard: NavigationGuard,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { GuardedLinkViewModel(guard, logger) }
            }
    }
}
