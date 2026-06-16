// The state holder backing the BackupRestorePage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/admin/pages/BackupRestorePage.tsx). It projects
// the two shared cache-then-network reads onto the lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState] (each driving the page's four declared data states), owns the page's local
// interaction state (the create/edit modal + its form, the delete confirmation, the restore-preview modal, and
// the per-action in-flight flags), and runs the seven mutations, emitting a one-shot localized [UiEvent.Message]
// toast for each outcome exactly as the web `useToast` calls do. All projection logic lives in the
// framework-free model (BackupRestorePageModel.kt); this holder performs no HTTP.
//
// A monotonic refresh trigger re-subscribes the two cold read flows, reproducing the web
// `queryClient.invalidateQueries(['backup-configs' | 'backup-runs'])` refetch after every mutation and behind
// the "Refresh" affordance.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `TooManyFunctions` reflects the surface's full
// CRUD parity (create/update/delete/trigger/quick/verify/preview + form editing), each a thin action.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.admin.backuprestore

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The page's local interaction state — the native fold of the web page's `useState` cluster (the modal + its
 * form, the delete target, the restore-preview modal) and the per-mutation `isPending` flags. Exposed as one
 * immutable snapshot so the stateless content recomposes from a single source.
 */
data class BackupRestoreInteraction(
    val form: ConfigFormState = ConfigFormState.EMPTY,
    val modalOpen: Boolean = false,
    val editingId: Long? = null,
    val saving: Boolean = false,
    val deleteTarget: BackupConfig? = null,
    val deleting: Boolean = false,
    val previewOpen: Boolean = false,
    val previewData: RestorePreview? = null,
    val quickRunning: Boolean = false,
    val triggeringId: Long? = null,
    val verifyingId: Long? = null,
) {
    /** True while the modal is editing an existing config (web `editingConfig != null`). */
    val isEditing: Boolean get() = editingId != null

    /** True while the preview modal is open but its payload has not yet arrived (web `previewData == null`). */
    val previewLoading: Boolean get() = previewOpen && previewData == null
}

/**
 * @param source the P1/S8 data seam (real [ApiHttpClient][io.teslasync.shared.core.net.ApiHttpClient] adapter ↔
 *   in-memory fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + PII-safe action ids.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupRestorePageViewModel(
    private val source: BackupRestorePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val refreshTrigger = MutableStateFlow(0)
    private val interactionState = MutableStateFlow(BackupRestoreInteraction())

    /** The page's modal / dialog / in-flight interaction snapshot (web `useState` cluster). */
    val interaction: StateFlow<BackupRestoreInteraction> = interactionState.asStateFlow()

    /**
     * The configured-schedules feed as cache-then-network UI state (loading / content / empty / error). Empty is
     * the no-configs guard (web `configs.length === 0`); the refresh trigger re-subscribes so the "Refresh"
     * affordance + post-mutation invalidation re-fetch.
     */
    val configsState: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.configs() }
            .asUiState(isEmpty = { it.asBackupConfigs().isEmpty() })

    /** The backup-runs feed as cache-then-network UI state; empty is the no-runs guard (web `runs.length === 0`). */
    val runsState: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.runs() }
            .asUiState(isEmpty = { it.asBackupRuns().isEmpty() })

    // ── Read lifecycle ───────────────────────────────────────────────────────────────────────────────────────

    /** Re-fetches both feeds — backs the "Refresh" affordance + the hard-error retry (web `invalidateQueries`). */
    fun refresh() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for a hard-error feed surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BackupRestorePageDiagnostics.recordViewOpened(logger)
    }

    // ── Create / edit modal ──────────────────────────────────────────────────────────────────────────────────

    /** Open the modal in create mode with the empty form (web `openCreate`). */
    fun openCreate() {
        interactionState.update { it.copy(modalOpen = true, editingId = null, form = ConfigFormState.EMPTY, saving = false) }
    }

    /** Open the modal in edit mode seeded from [config] (web `openEdit`). */
    fun openEdit(config: BackupConfig) {
        interactionState.update { it.copy(modalOpen = true, editingId = config.id, form = config.toFormState(), saving = false) }
    }

    /** Close the modal and reset the form (web `closeModal`). */
    fun closeModal() {
        interactionState.update { it.copy(modalOpen = false, editingId = null, form = ConfigFormState.EMPTY, saving = false) }
    }

    /** Mutate one form field (web `setField`). */
    fun updateForm(transform: (ConfigFormState) -> ConfigFormState) {
        interactionState.update { it.copy(form = transform(it.form)) }
    }

    /** Switch the storage provider, clearing the provider settings (web `setField('provider_config', {})`). */
    fun setProvider(provider: String) {
        interactionState.update { it.copy(form = it.form.copy(provider = provider, providerConfig = emptyMap())) }
    }

    /** Set one provider-settings field (web `setProviderField`). */
    fun setProviderField(
        key: String,
        value: String,
    ) {
        interactionState.update { it.copy(form = it.form.copy(providerConfig = it.form.providerConfig + (key to value))) }
    }

    /** Create or update the config from the current form (web `handleSave`). */
    fun save() {
        val snapshot = interactionState.value
        if (!snapshot.form.canSave || snapshot.saving) return
        interactionState.update { it.copy(saving = true) }
        val body = snapshot.form.toRequestBody()
        val editingId = snapshot.editingId
        launch {
            val result = if (editingId != null) source.updateConfig(editingId, body) else source.createConfig(body)
            result.onSuccess {
                emitMessage(
                    if (editingId != null) BackupRestoreToastKeys.CONFIG_UPDATED else BackupRestoreToastKeys.CONFIG_CREATED,
                    UiEvent.Severity.Success,
                )
                refresh()
                closeModal()
            }.onFailure {
                emitMessage(
                    if (editingId != null) BackupRestoreToastKeys.CONFIG_UPDATE_FAILED else BackupRestoreToastKeys.CONFIG_CREATE_FAILED,
                    UiEvent.Severity.Error,
                )
                interactionState.update { it.copy(saving = false) }
            }
        }
    }

    // ── Delete confirmation ──────────────────────────────────────────────────────────────────────────────────

    /** Arm the delete confirmation for [config] (web `setDeleteTarget`). */
    fun requestDelete(config: BackupConfig) {
        interactionState.update { it.copy(deleteTarget = config) }
    }

    /** Dismiss the delete confirmation (web `onCancel`). */
    fun cancelDelete() {
        interactionState.update { it.copy(deleteTarget = null, deleting = false) }
    }

    /** Delete the armed config (web `deleteMutation`). */
    fun confirmDelete() {
        val target = interactionState.value.deleteTarget ?: return
        if (interactionState.value.deleting) return
        interactionState.update { it.copy(deleting = true) }
        launch {
            source.deleteConfig(target.id).onSuccess {
                emitMessage(BackupRestoreToastKeys.CONFIG_DELETED, UiEvent.Severity.Success)
                interactionState.update { it.copy(deleteTarget = null, deleting = false) }
                refresh()
            }.onFailure {
                emitMessage(BackupRestoreToastKeys.CONFIG_DELETE_FAILED, UiEvent.Severity.Error)
                interactionState.update { it.copy(deleting = false) }
            }
        }
    }

    // ── Run / quick actions ──────────────────────────────────────────────────────────────────────────────────

    /** Trigger [configId]'s backup now (web `triggerMutation`). */
    fun trigger(configId: Long) {
        if (interactionState.value.triggeringId != null) return
        interactionState.update { it.copy(triggeringId = configId) }
        logger.info(EVENT_TRIGGER, surfaceField)
        launch {
            source.triggerConfig(configId)
                .onSuccess { emitMessage(BackupRestoreToastKeys.TRIGGERED, UiEvent.Severity.Success); refresh() }
                .onFailure { emitMessage(BackupRestoreToastKeys.TRIGGER_FAILED, UiEvent.Severity.Error) }
            interactionState.update { it.copy(triggeringId = null) }
        }
    }

    /** Run a quick backup now (web `quickBackupMutation`). */
    fun quickBackup() {
        if (interactionState.value.quickRunning) return
        interactionState.update { it.copy(quickRunning = true) }
        logger.info(EVENT_QUICK, surfaceField)
        launch {
            source.runQuickBackup()
                .onSuccess { emitMessage(BackupRestoreToastKeys.QUICK_STARTED, UiEvent.Severity.Success); refresh() }
                .onFailure { emitMessage(BackupRestoreToastKeys.QUICK_FAILED, UiEvent.Severity.Error) }
            interactionState.update { it.copy(quickRunning = false) }
        }
    }

    /** Verify [runId]'s checksum (web `verifyMutation`); the outcome drives the verified/mismatch toast. */
    fun verify(runId: Long) {
        if (interactionState.value.verifyingId != null) return
        interactionState.update { it.copy(verifyingId = runId) }
        launch {
            source.verifyRun(runId)
                .onSuccess { verified ->
                    if (verified) {
                        emitMessage(BackupRestoreToastKeys.CHECKSUM_VERIFIED, UiEvent.Severity.Success)
                    } else {
                        emitMessage(BackupRestoreToastKeys.CHECKSUM_MISMATCH, UiEvent.Severity.Warning)
                    }
                }
                .onFailure { emitMessage(BackupRestoreToastKeys.VERIFY_FAILED, UiEvent.Severity.Error) }
            interactionState.update { it.copy(verifyingId = null) }
        }
    }

    // ── Restore preview ──────────────────────────────────────────────────────────────────────────────────────

    /** Open the restore-preview modal for [runId] and load its payload (web `handlePreview`). */
    fun openPreview(runId: Long) {
        interactionState.update { it.copy(previewOpen = true, previewData = null) }
        launch {
            source.previewRun(runId)
                .onSuccess { preview -> interactionState.update { it.copy(previewOpen = true, previewData = preview) } }
                .onFailure {
                    interactionState.update { it.copy(previewOpen = false, previewData = null) }
                    emitMessage(BackupRestoreToastKeys.PREVIEW_FAILED, UiEvent.Severity.Error)
                }
        }
    }

    /** Close the restore-preview modal (web `setPreviewOpen(false)`). */
    fun closePreview() {
        interactionState.update { it.copy(previewOpen = false, previewData = null) }
    }

    private fun emitMessage(
        key: String,
        severity: UiEvent.Severity,
    ) {
        emitEvent(UiEvent.Message(messageKey = key, severity = severity))
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(BackupRestorePageDiagnostics.FIELD_SURFACE to BackupRestorePageRegistration.SLUG)

    private companion object {
        const val EVENT_REFRESH = "backupRestore.refresh"
        const val EVENT_TRIGGER = "backupRestore.trigger"
        const val EVENT_QUICK = "backupRestore.quickBackup"
    }
}
