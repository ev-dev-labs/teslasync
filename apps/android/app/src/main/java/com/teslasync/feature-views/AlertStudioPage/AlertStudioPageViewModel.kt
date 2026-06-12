// The state holder backing the AlertStudioPage feature view (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/notifications/pages/AlertStudioPage.tsx). It
// owns the editor working-state + the page's local interaction state (selection, search, bulk set, dialogs)
// as a single immutable [AlertStudioInteraction] snapshot, projects the four cache-then-network read feeds
// (rules / channels / metrics / vehicles) into lifecycle-aware [UiState] via [BaseFeedViewModel.asUiState],
// and drives the alert-rule mutations through the injected [AlertStudioSource]. All editor transition logic
// lives in the framework-free model (AlertStudioPageModel.kt); this holder is the thin orchestration layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertStudioPage) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.featureviews.alertstudiopage

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/** The post-guard editor switch (web `guardSwitch` action result): the editor to install + the row to select. */
data class PendingSwitch(
    val editor: EditorState,
    val selectedId: Long?,
    val closeTemplates: Boolean,
)

/**
 * The page's local interaction state — the union of the web component's `useState` hooks (editor, selection,
 * search, bulk set, dialogs, in-flight flags) folded into one immutable snapshot so the composable reads a
 * single value. [baseline] is the editor snapshot the dirty check compares against (web `initialEditorRef`).
 */
data class AlertStudioInteraction(
    val editor: EditorState = freshEditor(),
    val baseline: EditorState = freshEditor(),
    val selectedId: Long? = null,
    val bulkSelected: Set<Long> = emptySet(),
    val showTemplates: Boolean = false,
    val templateSearch: String = "",
    val templateCategory: String? = null,
    val ruleSearch: String = "",
    val testChannelIds: List<Long>? = null,
    val validationError: Boolean = false,
    val snoozeTargetId: Long? = null,
    val deleteTargetId: Long? = null,
    val pendingSwitch: PendingSwitch? = null,
    val saving: Boolean = false,
    val testing: Boolean = false,
) {
    /** Whether an existing rule is being edited (web `isEditing`). */
    val isEditing: Boolean get() = selectedId != null

    /** Whether a brand-new rule is being authored (web `isNewRule`). */
    val isNewRule: Boolean get() = selectedId == null

    /** Whether the editor diverges from its load-time snapshot (web `isDirty`). */
    val isDirty: Boolean get() = editor != baseline
}

/**
 * @param source the P1/S8 data seam (real adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooManyFunctions")
class AlertStudioPageViewModel(
    private val source: AlertStudioSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The alert-rule list as cache-then-network UI state (empty list → Empty phase) (web `useAlertRules`). */
    val rules: StateFlow<UiState<List<AlertRule>>> =
        refreshTrigger.flatMapLatest { source.alertRules() }.asUiState { it.isEmpty() }

    /** The external notification channels for test delivery (web `useNotificationChannels`). */
    val channels: StateFlow<UiState<List<NotificationChannel>>> =
        refreshTrigger.flatMapLatest { source.notificationChannels() }.asUiState { it.isEmpty() }

    /** The computed-metric registry (web `useAlertMetrics`). */
    val metrics: StateFlow<UiState<List<ComputedMetricSummary>>> =
        refreshTrigger.flatMapLatest { source.alertMetrics() }.asUiState { it.isEmpty() }

    /** The enrolled-vehicle list for the multi-select (web `useVehicles`). */
    val vehicles: StateFlow<UiState<List<VehicleRef>>> =
        refreshTrigger.flatMapLatest { source.vehicles() }.asUiState { it.isEmpty() }

    /** The app-wide selected vehicle id, used by the opt-in AI panels (web `useSelectedVehicle`). */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    private val mutableInteraction = MutableStateFlow(AlertStudioInteraction())

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<AlertStudioInteraction> = mutableInteraction.asStateFlow()

    // ── Read-feed refresh / retry ─────────────────────────────────────────────────────────────────────────

    /** Re-collect every read feed — a genuine cache-then-network re-fetch (web query invalidation). */
    fun refresh() {
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the error state (web `QueryError` retry). */
    fun retry(): Unit = refresh()

    // ── Editor field setters (web `setEditor(s => …)`) ────────────────────────────────────────────────────

    private fun updateEditor(transform: (EditorState) -> EditorState) {
        mutableInteraction.update { it.copy(editor = transform(it.editor)) }
    }

    fun setName(value: String): Unit = updateEditor { it.copy(name = value) }

    fun setEnabled(value: Boolean): Unit = updateEditor { it.copy(enabled = value) }

    fun setVehicleSelection(selection: EditorVehicleSelection): Unit = updateEditor { it.copy(vehicleSelection = selection) }

    fun onSignalChange(signalName: String): Unit = updateEditor { applySignalChange(it, signalName) }

    fun onOperatorChange(op: String): Unit = updateEditor { applyOperatorChange(it, op) }

    fun onSeverityChange(severity: String): Unit = updateEditor { applySeverityChange(it, severity) }

    fun setValueNum(value: String): Unit = updateEditor { it.copy(valueNum = value) }

    fun setValueText(value: String): Unit = updateEditor { it.copy(valueText = value) }

    fun setValueBool(value: Boolean): Unit = updateEditor { it.copy(valueBool = value) }

    fun setValueMin(value: String): Unit = updateEditor { it.copy(valueMin = value) }

    fun setValueMax(value: String): Unit = updateEditor { it.copy(valueMax = value) }

    fun setCooldown(value: Int): Unit = updateEditor { it.copy(cooldownMin = value) }

    fun onTriggerModeChange(mode: String): Unit = updateEditor { applyTriggerModeChange(it, mode) }

    fun setMaxFires(value: String): Unit = updateEditor { it.copy(maxFiresPerResolution = value) }

    fun onEscalationToggle(enabled: Boolean): Unit = updateEditor { applyEscalationToggle(it, enabled) }

    fun setEscalationAfter(value: String): Unit = updateEditor { it.copy(escalationAfterMin = value) }

    fun setEscalationSeverity(value: String): Unit = updateEditor { it.copy(escalationSeverity = value) }

    fun setMsgTemplate(value: String): Unit = updateEditor { it.copy(msgTemplate = value) }

    fun setIncludeTitle(value: Boolean): Unit = updateEditor { it.copy(includeTitle = value) }

    fun setKind(kind: String): Unit = updateEditor { it.copy(kind = kind) }

    fun setMetricId(value: String): Unit = updateEditor { it.copy(metricId = value) }

    fun setMetricWindow(value: String): Unit = updateEditor { it.copy(metricWindow = value) }

    fun setMetricOp(value: String): Unit = updateEditor { it.copy(metricOp = value) }

    fun setMetricThreshold(value: String): Unit = updateEditor { it.copy(metricThreshold = value) }

    // ── Page interaction setters (web `useState` setters) ─────────────────────────────────────────────────

    fun toggleTemplates(): Unit = mutableInteraction.update { it.copy(showTemplates = !it.showTemplates) }

    fun setTemplateSearch(value: String): Unit = mutableInteraction.update { it.copy(templateSearch = value) }

    fun setTemplateCategory(category: String?): Unit = mutableInteraction.update { it.copy(templateCategory = category) }

    fun setRuleSearch(value: String): Unit = mutableInteraction.update { it.copy(ruleSearch = value) }

    fun setSnoozeTarget(id: Long?): Unit = mutableInteraction.update { it.copy(snoozeTargetId = id) }

    fun requestDelete(id: Long): Unit = mutableInteraction.update { it.copy(deleteTargetId = id) }

    fun cancelDelete(): Unit = mutableInteraction.update { it.copy(deleteTargetId = null) }

    fun toggleBulkSelected(
        id: Long,
        on: Boolean,
    ): Unit =
        mutableInteraction.update { state ->
            val next = state.bulkSelected.toMutableSet().apply { if (on) add(id) else remove(id) }
            state.copy(bulkSelected = next)
        }

    fun clearBulk(): Unit = mutableInteraction.update { it.copy(bulkSelected = emptySet()) }

    /** Drop bulk ids no longer in the visible result set (web `useEffect([filteredRules])`). */
    fun reconcileBulkSelection(visibleIds: Set<Long>) {
        mutableInteraction.update { state ->
            if (state.bulkSelected.isEmpty()) return@update state
            val next = state.bulkSelected.intersect(visibleIds)
            if (next.size == state.bulkSelected.size) state else state.copy(bulkSelected = next)
        }
    }

    /** Toggle a channel in the test-delivery target (web `handleToggleTestChannel`). */
    fun toggleTestChannel(
        channelId: Long,
        allChannelIds: List<Long>,
    ) {
        mutableInteraction.update { state ->
            val selected = state.testChannelIds ?: allChannelIds
            val next = if (selected.contains(channelId)) selected - channelId else selected + channelId
            val resolved =
                when {
                    next.isEmpty() -> state.testChannelIds
                    next.size == allChannelIds.size -> null
                    else -> next
                }
            state.copy(testChannelIds = resolved)
        }
    }

    // ── Guarded editor switching (web `guardSwitch` + `useNavigationGuard`) ───────────────────────────────

    private fun guardSwitch(next: PendingSwitch) {
        if (mutableInteraction.value.isDirty) {
            mutableInteraction.update { it.copy(pendingSwitch = next) }
        } else {
            applySwitch(next)
        }
    }

    private fun applySwitch(next: PendingSwitch) {
        mutableInteraction.update { state ->
            state.copy(
                editor = next.editor,
                baseline = next.editor,
                selectedId = next.selectedId,
                validationError = false,
                showTemplates = if (next.closeTemplates) false else state.showTemplates,
                pendingSwitch = null,
            )
        }
    }

    /** Confirm the discard prompt and apply the pending switch (web ConfirmDialog confirm). */
    fun confirmDiscard() {
        mutableInteraction.value.pendingSwitch?.let { applySwitch(it) }
    }

    /** Keep editing — dismiss the discard prompt (web ConfirmDialog cancel). */
    fun cancelDiscard(): Unit = mutableInteraction.update { it.copy(pendingSwitch = null) }

    /** Select an existing rule for editing (web `handleSelectRule`). */
    fun selectRule(rule: AlertRule) {
        guardSwitch(PendingSwitch(coerceEditorForSignal(ruleToEditor(rule)), rule.id, closeTemplates = false))
    }

    /** Start a brand-new rule / reset the editor (web `handleNewRule`). */
    fun newRule() {
        guardSwitch(PendingSwitch(freshEditor(), selectedId = null, closeTemplates = false))
    }

    /** Clone a template into the editor (web `handleCloneTemplate`); name/message come pre-localized. */
    fun cloneTemplate(
        template: RuleTemplate,
        name: String,
        message: String,
    ) {
        guardSwitch(
            PendingSwitch(templateToEditor(template, name, message), selectedId = null, closeTemplates = true),
        )
    }

    // ── Mutations (web mutation hooks) ────────────────────────────────────────────────────────────────────

    private fun resetEditor() {
        mutableInteraction.update {
            it.copy(editor = freshEditor(), baseline = freshEditor(), selectedId = null, validationError = false)
        }
    }

    /** Validate + persist the editor (web `handleSave`). No-op when [canSave] is false. */
    fun save(availableMetrics: List<ComputedMetricSummary>) {
        val state = mutableInteraction.value
        if (!canSave(state.editor, availableMetrics, state.isNewRule)) return
        val issue = validateForSave(buildSavePayload(state.editor))
        if (issue != null) {
            mutableInteraction.update { it.copy(validationError = true) }
            logger.info("alertStudio.save.invalid", mapOf("field" to issue.field.name))
            return
        }
        val request = buildSaveRequest(state.editor)
        mutableInteraction.update { it.copy(validationError = false, saving = true) }
        launch {
            source.saveAlertRule(request).fold(
                onSuccess = {
                    resetEditor()
                    refresh()
                    emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.save", success = true))
                },
                onFailure = {
                    logger.warn("alertStudio.save.fail")
                    emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.save", success = false))
                },
            )
            mutableInteraction.update { it.copy(saving = false) }
        }
    }

    /** Delete a rule (web `handleDelete`). Clears the editor + the delete prompt on success. */
    fun delete(id: Long) {
        mutableInteraction.update { it.copy(deleteTargetId = null) }
        launch {
            source.deleteAlertRule(id).fold(
                onSuccess = {
                    resetEditor()
                    refresh()
                    emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.delete", success = true))
                },
                onFailure = {
                    logger.warn("alertStudio.delete.fail")
                    emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.delete", success = false))
                },
            )
        }
    }

    /** Flip a rule's enabled flag from the list row (web inline `toggleRuleMut`). */
    fun toggleEnabled(
        id: Long,
        currentlyEnabled: Boolean,
    ) {
        launch {
            source.toggleAlertRule(id, !currentlyEnabled)
            refresh()
        }
    }

    /** Send a test notification (web `handleTest`); [defaultMessage] is the localized fallback body. */
    fun test(
        defaultMessage: String,
        allChannelIds: List<Long>,
    ) {
        val state = mutableInteraction.value
        val message =
            state.editor.message
                .trim()
                .ifEmpty { defaultMessage }
        val request =
            buildTestRequest(
                message = message,
                selectedIds = state.testChannelIds,
                allIds = allChannelIds,
                msgTemplate = state.editor.msgTemplate,
                includeTitle = state.editor.includeTitle,
            )
        mutableInteraction.update { it.copy(testing = true) }
        launch {
            source.testAlertRule(request).fold(
                onSuccess = { emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.test", success = true)) },
                onFailure = {
                    logger.warn("alertStudio.test.fail")
                    emitEvent(UiEvent.CommandOutcome(commandKey = "alertStudio.test", success = false))
                },
            )
            mutableInteraction.update { it.copy(testing = false) }
        }
    }

    /** Snooze (or cancel, with `minutes = 0`) a rule (web `handleSnooze`). */
    fun snooze(
        id: Long,
        minutes: Int,
    ) {
        launch {
            source.snoozeAlertRule(id, buildSnoozeRequest(minutes)).fold(
                onSuccess = {
                    mutableInteraction.update { it.copy(snoozeTargetId = null) }
                    refresh()
                },
                onFailure = { logger.warn("alertStudio.snooze.fail") },
            )
        }
    }

    /** Bulk-enable the selected rules (web `bulkRulesActions[enable]`). */
    fun bulkEnable(ids: List<Long>) {
        launch {
            source.bulkEnableRules(ids)
            clearBulk()
            refresh()
        }
    }

    /** Bulk-disable the selected rules (web `bulkRulesActions[disable]`). */
    fun bulkDisable(ids: List<Long>) {
        launch {
            source.bulkDisableRules(ids)
            clearBulk()
            refresh()
        }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to AlertStudioPageRegistration.SLUG))
    }
}
