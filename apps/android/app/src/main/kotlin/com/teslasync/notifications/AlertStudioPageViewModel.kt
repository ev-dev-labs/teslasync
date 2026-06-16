// The state holder backing the AlertStudioPage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/notifications/pages/AlertStudioPage.tsx). It owns the
// page's local interaction state (the typed rule editor, the selected rule, the rule/template searches, the
// template-category filter, the bulk selection, the snooze target and the test-channel selection) as an
// immutable [AlertStudioInteraction] snapshot, and projects the four cache-then-network reads (rules,
// computed metrics, channels, vehicles) onto the shared lifecycle-aware [UiState] surface.
//
// Each feed re-collects whenever its refresh trigger bumps; every mutation routes through the injected
// [AlertStudioPageSource] and, on success, bumps exactly the trigger the matching web hook invalidates via
// `invalidateQueries` (the rule list for rule writes; nothing for a test). All derivation logic lives in the
// framework-free model (AlertStudioPageModel.kt); this holder is the thin orchestration layer and performs no
// HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertstudio

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestTarget
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real shared Notifications + Vehicles repositories ↔ test fake); the view
 *   never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertStudioPageViewModel(
    private val source: AlertStudioPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(AlertStudioInteraction())
    private val savingState = MutableStateFlow(false)
    private val rulesRefresh = MutableStateFlow(0)
    private val metricsRefresh = MutableStateFlow(0)
    private val channelsRefresh = MutableStateFlow(0)
    private val vehiclesRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `editor` + selection + filter + bulk + snooze useStates). */
    val interaction: StateFlow<AlertStudioInteraction> = mutableInteraction.asStateFlow()

    /** True while a rule create/update is in flight (web `saveRuleMut.isPending`); drives the Save button. */
    val isSaving: StateFlow<Boolean> = savingState.asStateFlow()

    /** `GET /alerts/rules` as cache-then-network UI state (web `useAlertRules`), empty ⇒ the no-rules state. */
    val rulesState: StateFlow<UiState<List<AlertRule>>> =
        rulesRefresh.flatMapLatest { source.alertRules() }.asUiState { it.isEmpty() }

    /** `GET /alerts/metrics` as UI state (web `useAlertMetrics`); feeds the computed-metric editor. */
    val metricsState: StateFlow<UiState<List<ComputedMetricSummary>>> =
        metricsRefresh.flatMapLatest { source.alertMetrics() }.asUiState { it.isEmpty() }

    /** `GET /notifications` channel list as UI state (web `useNotificationChannels`); feeds the channels panel. */
    val channelsState: StateFlow<UiState<List<NotificationChannel>>> =
        channelsRefresh.flatMapLatest { source.notificationChannels() }.asUiState { it.isEmpty() }

    /** `GET /vehicles` as UI state (web `useVehicles`); feeds the rule-scope picker. */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        vehiclesRefresh.flatMapLatest { source.vehicles() }.asUiState { it.isEmpty() }

    // ── Editor / interaction updates ──────────────────────────────────────────────────────────────────────

    /** Applies [transform] to the current editor draft (web `setEditor`). */
    fun updateEditor(transform: (AlertStudioEditor) -> AlertStudioEditor) {
        mutableInteraction.update { it.copy(editor = transform(it.editor)) }
    }

    /** Loads an existing [rule] into the editor for editing (web `handleSelectRule`). */
    fun selectRule(rule: AlertRule) {
        mutableInteraction.update { it.copy(editor = editorFromRule(rule), selectedRuleId = rule.id) }
    }

    /** Resets the editor to a fresh, unsaved draft (web `handleNewRule` / Reset). */
    fun newRule() {
        mutableInteraction.update { it.copy(editor = AlertStudioEditor(), selectedRuleId = null) }
    }

    /** Clones a [template] into a fresh draft and hides the templates panel (web `handleCloneTemplate`). */
    fun cloneTemplate(template: RuleTemplate) {
        mutableInteraction.update {
            it.copy(editor = editorFromTemplate(template), selectedRuleId = null, showTemplates = false)
        }
    }

    /** Toggles the templates panel (web `setShowTemplates`). */
    fun toggleTemplates() {
        mutableInteraction.update { it.copy(showTemplates = !it.showTemplates) }
    }

    /** Sets the rule-list search query (web `setRuleSearch`). */
    fun setRuleSearch(query: String) {
        mutableInteraction.update { it.copy(ruleSearch = query) }
    }

    /** Sets the template search query (web `setTemplateSearch`). */
    fun setTemplateSearch(query: String) {
        mutableInteraction.update { it.copy(templateSearch = query) }
    }

    /** Sets (or clears, with `null`) the template-category filter (web `setTemplateCategory`). */
    fun setTemplateCategory(category: String?) {
        mutableInteraction.update { it.copy(templateCategory = category) }
    }

    /** Adds/removes [id] from the bulk selection (web `toggleBulkSelected`). */
    fun toggleBulkSelected(
        id: Long,
        checked: Boolean,
    ) {
        mutableInteraction.update {
            val next = if (checked) it.bulkSelected + id else it.bulkSelected - id
            it.copy(bulkSelected = next)
        }
    }

    /** Clears the bulk selection (web `clearBulk`). */
    fun clearBulk() {
        mutableInteraction.update { it.copy(bulkSelected = emptySet()) }
    }

    /** Opens (or closes, with `null`) the snooze dialog for a rule (web `setSnoozeTargetId`). */
    fun setSnoozeTarget(id: Long?) {
        mutableInteraction.update { it.copy(snoozeTargetId = id) }
    }

    /** Toggles a channel as a test-delivery target (web `handleToggleTestChannel`). */
    fun toggleTestChannel(
        channelId: Long,
        allChannelIds: List<Long>,
    ) {
        mutableInteraction.update { state ->
            val current = state.testChannelIds ?: allChannelIds.toSet()
            val next = if (channelId in current) current - channelId else current + channelId
            state.copy(testChannelIds = next)
        }
    }

    // ── Mutations (web mutation hooks) ────────────────────────────────────────────────────────────────────

    /** Creates/updates the edited rule, then refreshes the rule list (web `useSaveAlertRule`). */
    fun save() {
        val editor = mutableInteraction.value.editor
        if (!canSave(editor)) return
        savingState.value = true
        launch {
            source.saveAlertRule(buildSaveRequest(editor))
                .onSuccess {
                    logger.info("alertStudio.save")
                    rulesRefresh.update { it + 1 }
                    if (editor.id == null) newRule()
                }
                .onFailure { logger.warn("alertStudio.save.failed") }
            savingState.value = false
        }
    }

    /** Deletes a rule, then refreshes the rule list (web `useDeleteAlertRule`). */
    fun delete(id: Long) {
        launch {
            source.deleteAlertRule(id)
                .onSuccess {
                    logger.info("alertStudio.delete")
                    rulesRefresh.update { it + 1 }
                    mutableInteraction.update { state ->
                        if (state.editor.id == id || state.selectedRuleId == id) {
                            state.copy(editor = AlertStudioEditor(), selectedRuleId = null)
                        } else {
                            state
                        }
                    }
                }
                .onFailure { logger.warn("alertStudio.delete.failed") }
        }
    }

    /** Enables/disables a rule, then refreshes the rule list (web `useToggleAlertRule`). */
    fun toggleEnabled(
        id: Long,
        enabled: Boolean,
    ) {
        launch {
            source.toggleAlertRule(id, enabled)
                .onSuccess { rulesRefresh.update { it + 1 } }
                .onFailure { logger.warn("alertStudio.toggle.failed") }
        }
    }

    /** Bulk-enables the selected rules, refreshes the list and clears the selection (web `useBulkEnableRules`). */
    fun bulkEnable() {
        val ids = mutableInteraction.value.bulkSelected.toList()
        if (ids.isEmpty()) return
        launch {
            source.bulkEnableRules(ids)
                .onSuccess {
                    rulesRefresh.update { it + 1 }
                    clearBulk()
                }
                .onFailure { logger.warn("alertStudio.bulkEnable.failed") }
        }
    }

    /** Bulk-disables the selected rules, refreshes the list and clears the selection (web `useBulkDisableRules`). */
    fun bulkDisable() {
        val ids = mutableInteraction.value.bulkSelected.toList()
        if (ids.isEmpty()) return
        launch {
            source.bulkDisableRules(ids)
                .onSuccess {
                    rulesRefresh.update { it + 1 }
                    clearBulk()
                }
                .onFailure { logger.warn("alertStudio.bulkDisable.failed") }
        }
    }

    /** Sends a test delivery for the edited rule; invalidates nothing (web `useTestAlertRule`). */
    fun test(defaultMessage: String) {
        val state = mutableInteraction.value
        val editor = state.editor
        if (editor.name.isBlank()) return
        val target =
            state.testChannelIds
                ?.let { AlertTestTarget(channelIds = it.toList()) }
                ?: AlertTestTarget(allChannels = true)
        val request =
            AlertTestRequest(
                message = editor.msgTemplate.ifBlank { defaultMessage },
                target = target,
                msgTemplate = editor.msgTemplate.takeIf { it.isNotBlank() },
                includeTitle = editor.includeTitle,
            )
        launch {
            source.testAlertRule(request)
                .onSuccess { logger.info("alertStudio.test") }
                .onFailure { logger.warn("alertStudio.test.failed") }
        }
    }

    /** Snoozes a rule for [minutes], refreshes the list and closes the dialog (web `useSnoozeAlertRule`). */
    fun snooze(
        id: Long,
        minutes: Int,
    ) {
        launch {
            source.snoozeAlertRule(id, AlertRuleSnoozeRequest(minutes = minutes))
                .onSuccess {
                    rulesRefresh.update { it + 1 }
                    setSnoozeTarget(null)
                }
                .onFailure { logger.warn("alertStudio.snooze.failed") }
        }
    }

    /** Cancels an active snooze (zero-minute request), refreshes the list and closes the dialog. */
    fun cancelSnooze(id: Long) {
        launch {
            source.snoozeAlertRule(id, AlertRuleSnoozeRequest(minutes = 0))
                .onSuccess {
                    rulesRefresh.update { it + 1 }
                    setSnoozeTarget(null)
                }
                .onFailure { logger.warn("alertStudio.snooze.cancel.failed") }
        }
    }

    // ── Retry affordances (the per-feed error-surface retry) ──────────────────────────────────────────────

    /** Re-collects the rule-list feed (the page error-retry affordance). */
    fun retryRules() {
        rulesRefresh.update { it + 1 }
    }

    /** Re-collects the channel-list feed (the channels-panel error-retry affordance). */
    fun retryChannels() {
        channelsRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAlertStudioPageOpened(logger)
    }
}
