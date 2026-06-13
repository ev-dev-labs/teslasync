// UI-thread-free state holder backing the UserCell surface — the native port of the web `useCurrentUser`
// read (web/src/components/data-display/UserCell.tsx renders `<UserCell user={me} />` over the
// `GET /users/me` document). It binds the shared current-user feed through [UserCellSource] and performs no
// HTTP itself (ADR-002): the view collects [state] and folds it through the pure [UserCellProjection]. The
// current-user document is the genuine async dependency a self-contained identity surface resolves, so its
// cache-then-network lifecycle drives the surface's loading / content / empty / error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UserCell) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usercell

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.User
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the UserCell surface.
 *
 * The current-user feed is re-shared as a lifecycle-aware [UiState] so the composable can switch surfaces —
 * loading (first fetch), content/empty (the avatar + name vs the em dash, decided by the user's
 * attributability), a hard error with retry, and the stale/offline freshness envelope — without re-deriving
 * the cache-then-network contract. [refresh]/[retry] re-collect the feed (web `refetch`; the shared store
 * also replays its latest and re-fetches on a profile mutation elsewhere), and [onViewOpened] emits the one
 * PII-safe `view.opened` diagnostic (P1/S11) — slug only, never the user's name, email, or id.
 *
 * @param source the current-user document seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UserCellViewModel(
    private val source: UserCellSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The current-user document as lifecycle-aware [UiState]. A user with no attributable identity field is
     * treated as structurally empty (the web `!name && !email && !id` em-dash branch), so the surface's empty
     * state is honest rather than a blank content frame.
     */
    val state: StateFlow<UiState<User>> =
        refreshTrigger
            .flatMapLatest { source.currentUser() }
            .asUiState(isEmpty = { !UserCellUser.fromUser(it).isAttributable })

    /** Re-fetches the current-user document after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the current-user document; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no name, email, id, or avatar URL. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to UserCellRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "userCell.refresh"

        /** Wires the surface from the shared **S8** [UserStore] current-user feed (web `useCurrentUser`). */
        fun create(
            userStore: UserStore,
            logger: Logger,
        ): UserCellViewModel = UserCellViewModel(userStore.asUserCellSource(), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: UserCellSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { UserCellViewModel(source, logger) }
            }
    }
}
