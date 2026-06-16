// UI-thread-free state holder backing the Compose [APIKeysPage] surface — the native port of the web page's
// hook composition (web/src/features/admin/pages/APIKeysPage.tsx). The web page owns five `useState` hooks
// (showCreate / newName / newPerm / generatedKey / deleteTarget) plus the `useApiKeys` query and three
// mutations; here that read feed is projected onto a cache-then-network [UiState] and the local interaction is
// folded into one immutable [ApiKeysInteraction] snapshot so the composable reads a single value.
//
// On a successful mutation it re-collects the feed (the data-layer analogue of the web hooks'
// `invalidateQueries(['api-keys'])`) and raises a one-shot [BaseFeedViewModel.events] outcome carrying an i18n
// key (ADR-014), never a pre-formatted sentence. The view-model performs no HTTP (ADR-002) and logs only the
// PII-safe surface slug (ADR-016) — never a key name, prefix, or the minted secret.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction state — the union of the web component's five `useState` hooks folded into one
 * immutable snapshot so the composable reads a single value.
 *
 * @property showCreate whether the create modal is open (web `showCreate`).
 * @property newName the in-progress key name (web `newName`).
 * @property newPermission the chosen permission level (web `newPerm`).
 * @property generatedKey the freshly-minted secret to reveal once, or `null` before generation (web `generatedKey`).
 * @property creating whether the create mutation is in flight (web `createMut.isPending`) — disables Generate.
 * @property deleteTarget the key pending delete confirmation, or `null` (web `deleteTarget`).
 */
data class ApiKeysInteraction(
    val showCreate: Boolean = false,
    val newName: String = "",
    val newPermission: PermissionLevel = PermissionLevel.Read,
    val generatedKey: String? = null,
    val creating: Boolean = false,
    val deleteTarget: ApiKey? = null,
) {
    /** Whether the Generate action is enabled (web `disabled={!newName.trim()}`). */
    val canGenerate: Boolean get() = newName.isNotBlank() && !creating
}

/**
 * State holder backing the Compose [APIKeysPage].
 *
 * It projects the injected [source]'s key-list feed onto [keys] and routes the three mutations through the same
 * seam. The first [recordViewOpened] records the one-shot `view.opened` diagnostic. It owns no networking and
 * never logs anything but the surface slug.
 *
 * @param source the key feed + create/delete/revoke seam (P1/S8) — a shared-store adapter in production, a fake
 *   in tests.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApiKeysPageViewModel(
    private val source: ApiKeysSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(ApiKeysInteraction())
    private var viewOpenedRecorded = false

    /**
     * The issued API keys as a lifecycle-aware [UiState]: loading / content / empty (no keys) / stale / offline /
     * error, carrying the freshness stamp + error kind. Empty is a friendly affordance, never a blank box (web
     * `EmptyState`).
     */
    val keys: StateFlow<UiState<List<ApiKey>>> =
        refreshTrigger
            .flatMapLatest { source.apiKeys() }
            .asUiState { ApiKeysProjection.isEmpty(it) }

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<ApiKeysInteraction> = mutableInteraction.asStateFlow()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ApiKeysPageDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network load — backs the error/stale retry affordance + the post-mutation refresh. */
    fun retry() {
        refreshTrigger.update { it + 1 }
    }

    // ── Create modal (web `showCreate` / `newName` / `newPerm` / `generatedKey`) ──────────────────────────────

    /** Open the create modal, clearing any previously revealed secret (web `setShowCreate(true); setGeneratedKey(null)`). */
    fun openCreate(): Unit = mutableInteraction.update { it.copy(showCreate = true, generatedKey = null) }

    /** Close the create modal and clear the in-progress form + revealed secret (web modal `onClose`). */
    fun closeCreate(): Unit = mutableInteraction.update { it.copy(showCreate = false, generatedKey = null, newName = "") }

    /** Set the in-progress key name (web `setNewName`). */
    fun setName(value: String): Unit = mutableInteraction.update { it.copy(newName = value) }

    /** Set the chosen permission level (web `setNewPerm`). */
    fun setPermission(level: PermissionLevel): Unit = mutableInteraction.update { it.copy(newPermission = level) }

    /**
     * Mint the key (web `createMut.mutate({ name, permissions }, { onSuccess })`). A no-op when the name is blank
     * or a create is already in flight (the web Generate button is disabled in both cases). On success it reveals
     * the minted secret, clears the name (web `setNewName('')`), refreshes the list, and raises the success
     * outcome; on failure it raises the failure outcome and keeps the form open.
     */
    fun generate() {
        val state = mutableInteraction.value
        if (!state.canGenerate) return
        val name = state.newName.trim()
        val permission = state.newPermission
        mutableInteraction.update { it.copy(creating = true) }
        ApiKeysPageDiagnostics.recordCreate(logger)
        launch {
            source.createApiKey(name, permission).fold(
                onSuccess = { key ->
                    mutableInteraction.update { it.copy(generatedKey = key, newName = "", creating = false) }
                    retry()
                },
                onFailure = {
                    logger.warn("${ApiKeysPageDiagnostics.EVENT_CREATE}.fail")
                    mutableInteraction.update { it.copy(creating = false) }
                },
            )
        }
    }

    // ── Revoke + delete (web `revokeMut` / `deleteMut` / `deleteTarget`) ──────────────────────────────────────

    /** Revoke a key — mark it expired (web `revokeMut.mutate(k.id)`); refreshes the list on success. */
    fun revoke(id: Long) {
        ApiKeysPageDiagnostics.recordRevoke(logger)
        launch {
            source.revokeApiKey(id).fold(
                onSuccess = { retry() },
                onFailure = { logger.warn("${ApiKeysPageDiagnostics.EVENT_REVOKE}.fail") },
            )
        }
    }

    /** Open the delete confirmation for [key] (web `setDeleteTarget(k)`). */
    fun requestDelete(key: ApiKey): Unit = mutableInteraction.update { it.copy(deleteTarget = key) }

    /** Dismiss the delete confirmation (web `onCancel: () => setDeleteTarget(null)`). */
    fun cancelDelete(): Unit = mutableInteraction.update { it.copy(deleteTarget = null) }

    /**
     * Confirm + perform the pending delete (web `deleteMut.mutate(deleteTarget.id, { onSuccess: () =>
     * setDeleteTarget(null) })`). Clears the prompt + refreshes the list on success; keeps the prompt open on
     * failure so the operator can retry.
     */
    fun confirmDelete() {
        val target = mutableInteraction.value.deleteTarget ?: return
        ApiKeysPageDiagnostics.recordDelete(logger)
        launch {
            source.deleteApiKey(target.id).fold(
                onSuccess = {
                    mutableInteraction.update { it.copy(deleteTarget = null) }
                    retry()
                },
                onFailure = { logger.warn("${ApiKeysPageDiagnostics.EVENT_DELETE}.fail") },
            )
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a bound [source]. */
        fun factory(
            source: ApiKeysSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ApiKeysPageViewModel(source, logger) }
            }
    }
}
