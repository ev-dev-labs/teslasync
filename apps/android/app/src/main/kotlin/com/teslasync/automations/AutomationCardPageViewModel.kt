// State holder backing the AutomationCard page surface (P1/S8) — the native counterpart of the host state the
// web component receives via props (web/src/features/automations/pages/AutomationCard.tsx). The web card binds
// no data hook of its own; its parent (the Automations list, `useAutomations`) supplies a single `Automation`,
// an `isFiring` flag, an optional `vehicleName`, and the action callbacks. This page-layer holder mirrors that
// contract: it carries no API data source (the manifest declares none — the surface renders from navigation
// args / local state), and exposes the host-supplied automation as the shared lifecycle-aware [UiState] surface
// the stateless screen renders, so the same loading / empty / error / content chrome the shared feature view
// implements is reachable from a single [StateFlow]. It performs NO HTTP and owns no business logic.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.automationcard.AutomationView
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder for the AutomationCard page surface. It re-presents the host-supplied
 * [automation] (the navigation arg / list selection) as a [UiState] stream so the screen stays a stateless
 * Composable that only renders, and it owns the self-contained pin affordance the web `<PinButton>` provides.
 *
 * The states are honest for a no-data-source surface: a first frame of [UiPhase.Loading] until [resolve] runs,
 * then [UiPhase.Content] when an automation is supplied or [UiPhase.Empty] when none is (a deep link without a
 * selection). The shared feature view additionally renders the hard-[UiPhase.Error] surface with a retry wired
 * to [retry], so every lifecycle state the host's feed can carry is covered.
 *
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param automation the automation this card renders, or `null` when none is selected (web `automation` prop).
 * @param isFiring whether the automation is currently firing (web `isFiring` prop) — drives the accent + chip.
 * @param vehicleName the assigned vehicle's name, or `null` for a fleet-wide automation (web `vehicleName`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AutomationCardPageViewModel(
    logger: Logger,
    private val automation: AutomationView? = null,
    val isFiring: Boolean = false,
    val vehicleName: String? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<UiState<AutomationView>>(UiState.loading())

    /** The single automation this card renders, projected onto the lifecycle-aware [UiState] surface. */
    val state: StateFlow<UiState<AutomationView>> = mutableState.asStateFlow()

    private val mutablePinned = MutableStateFlow(false)

    /** Host-owned pin state; [togglePin] flips it (the native PinButton is controlled by design). */
    val pinned: StateFlow<Boolean> = mutablePinned.asStateFlow()

    private var viewOpenedRecorded = false

    init {
        resolve()
    }

    /**
     * (Re)projects the host-supplied [automation] onto the [state] surface: content when present, empty when
     * none. Backs the initial load and the refresh/retry affordances.
     */
    fun resolve() {
        val current = automation
        mutableState.value =
            if (current != null) {
                UiState(phase = UiPhase.Content, data = current, fetchedAt = System.currentTimeMillis())
            } else {
                UiState(phase = UiPhase.Empty, fetchedAt = System.currentTimeMillis())
            }
    }

    /** Re-resolves the surface (the host `refetch` / error-state retry affordance). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to AutomationCardPageRegistration.SLUG))
        resolve()
    }

    /** Retry affordance for the hard-error surface — identical to [refresh]. */
    fun retry(): Unit = refresh()

    /** Flips the host-owned pin state (the web `<PinButton>` toggle). */
    fun togglePin() {
        mutablePinned.update { !it }
    }

    /** Emits the one-shot PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAutomationCardPageOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "automationCard.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from its props. */
        fun factory(
            automation: AutomationView?,
            isFiring: Boolean,
            vehicleName: String?,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AutomationCardPageViewModel(logger, automation, isFiring, vehicleName) }
            }
    }
}
