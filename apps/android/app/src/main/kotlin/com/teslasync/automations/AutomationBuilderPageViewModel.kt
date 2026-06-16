// The state holder backing the AutomationBuilderPage automations surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/automations/pages/AutomationBuilderPage.tsx). It binds the
// four reads onto the shared lifecycle-aware [UiState] surface, owns the editable [BuilderForm] (the web `FormState`),
// and drives the three mutations, performing no HTTP itself — every feed and write is routed through the injected
// [AutomationBuilderPageSource] (real S8 holders ↔ a test fake).
//
// The primary read is the edit-mode `/automations/{id}` load: it gates the page (loading → not-found → error → form),
// reproducing the web `isEdit && isLoadingAutomation` / `loadError` / `!existingAutomation` branch. A 404 surfaces as the
// friendly not-found surface (the web `EmptyState`) via the page's `httpStatus == 404` check, distinct from a hard error.
// In create/preset mode there is nothing to load, so the form renders immediately (the success surface). The vehicle and
// channel lists are their own lifecycle-aware feeds the form's pickers read; the preset feed hydrates the form once in
// install-preset mode. All decode/derivation lives in the framework-free model (AutomationBuilderPageModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.builder

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.automations.AutomationActionInput
import io.teslasync.shared.core.presentation.automations.AutomationConditionInput
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The unified save-blocker the form surfaces — the native analogue of the web page's single `saveError` holder, which
 * carries EITHER a pre-save validation message OR a failed-mutation message. Kept typed so the render boundary resolves
 * a [Validation] to its localized `automations.builder.error*` string and shows a [Mutation] message verbatim.
 */
sealed interface SaveError {
    /** A pre-save validation failure; the render boundary maps [kind] to one of the six error strings. */
    data class Validation(val kind: BuilderValidation) : SaveError

    /** A failed create/update mutation; [message] is the server/transport message shown verbatim. */
    data class Mutation(val message: String) : SaveError
}

/**
 * @param source the P1/S8 data seam (the shared Automations + Vehicles holders + the channels repository in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param automationId the edit-mode automation id (web `useParams().id`), or null for create/preset.
 * @param presetId the install-preset id (web `searchParams.get('preset')`), or null otherwise.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + save/test-run diagnostics.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutomationBuilderPageViewModel(
    private val source: AutomationBuilderPageSource,
    private val automationId: Long?,
    private val presetId: String?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private var hydrated = false
    private val retryTick = MutableStateFlow(0)

    /** Which entry point opened the builder (web `isEdit` / `presetId` branching). */
    val mode: BuilderMode =
        when {
            automationId != null -> BuilderMode.Edit
            presetId != null -> BuilderMode.Preset
            else -> BuilderMode.Create
        }

    /** True in edit mode — gates the loading / not-found / error surfaces on the automation read (web `isEdit`). */
    val isEdit: Boolean get() = mode == BuilderMode.Edit

    // ---- Reads --------------------------------------------------------------------

    /**
     * The primary `GET /automations/{id}` feed as cache-then-network UI state (web `useAutomation`). Only meaningful in
     * edit mode; an empty payload (synthetic id ≤ 0) resolves to the not-found surface. In create/preset mode there is
     * nothing to load, so a static `Content` state lets the form render immediately.
     */
    val automation: StateFlow<UiState<AutomationFull>> =
        automationId
            ?.let { id -> retryTick.flatMapLatest { source.automation(id) }.asUiState(isEmpty = { it.id <= 0L }) }
            ?: MutableStateFlow(UiState<AutomationFull>(UiPhase.Content))

    /** The `GET /automations/presets/{id}` feed (web `useAutomationPreset`) — hydrates the form in install-preset mode. */
    val preset: StateFlow<UiState<AutomationPreset>> =
        presetId
            ?.let { id -> source.automationPreset(id).asUiState(isEmpty = { it.id.isBlank() }) }
            ?: MutableStateFlow(UiState<AutomationPreset>(UiPhase.Content))

    /** The `GET /vehicles` feed (web `useVehicles`) — the vehicle-scope picker options. */
    val vehicles: StateFlow<UiState<List<Vehicle>>> = source.vehicles().asUiState(isEmpty = { it.isEmpty() })

    /** The `GET /notifications` feed (web `useNotificationChannels`) — the notify-action channel options. */
    val channels: StateFlow<UiState<List<NotificationChannel>>> =
        source.notificationChannels().asUiState(isEmpty = { it.isEmpty() })

    // ---- Form + save state --------------------------------------------------------

    private val formState = MutableStateFlow(BuilderForm())

    /** The editable form the four FormSections bind to (web `form`). */
    val form: StateFlow<BuilderForm> = formState.asStateFlow()

    private val dirtyState = MutableStateFlow(false)

    /** Whether the form has unsaved edits (web `dirty`) — drives the unsaved-changes guard + draft affordance. */
    val dirty: StateFlow<Boolean> = dirtyState.asStateFlow()

    private val saveErrorState = MutableStateFlow<SaveError?>(null)

    /** The current save blocker (validation or mutation failure), or null (web `saveError`). */
    val saveError: StateFlow<SaveError?> = saveErrorState.asStateFlow()

    private val editConflictState = MutableStateFlow(false)

    /** True when the last update was rejected as a concurrent-edit conflict (web `EditConflictBanner`). */
    val editConflict: StateFlow<Boolean> = editConflictState.asStateFlow()

    private val savingState = MutableStateFlow(false)

    /** True while a create/update is in flight (web `isSaving`) — drives the Save button's loading state. */
    val saving: StateFlow<Boolean> = savingState.asStateFlow()

    private val testRunningState = MutableStateFlow(false)

    /** True while a test run is in flight (web `testRunMutation.isPending`). */
    val testRunning: StateFlow<Boolean> = testRunningState.asStateFlow()

    private val testRunStartedState = MutableStateFlow(false)

    /** True once a test run has been started successfully (web `testRunMutation.isSuccess`). */
    val testRunStarted: StateFlow<Boolean> = testRunStartedState.asStateFlow()

    private val navigateAwayState = MutableStateFlow(false)

    /** Flips true after a successful save so the screen returns to the list (web `navigate('/automations')`). */
    val navigateAway: StateFlow<Boolean> = navigateAwayState.asStateFlow()

    private val savedIdState = MutableStateFlow<Long?>(null)

    /**
     * The id a test run targets: the just-saved id, falling back to the edited automation's id (web
     * `savedId ?? automationId`). Null in create mode until the first successful save, when Test Run becomes available.
     */
    val testRunTarget: StateFlow<Long?> =
        savedIdState
            .map { it ?: automationId }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), automationId)

    init {
        when (mode) {
            BuilderMode.Edit -> launch { hydrateFrom(automation) { automationToForm(it) } }
            BuilderMode.Preset -> launch { hydrateFrom(preset) { presetToForm(it) } }
            BuilderMode.Create -> hydrated = true
        }
    }

    // ---- Form mutations -----------------------------------------------------------

    /** Sets the automation name (web `update('name', …)`). */
    fun setName(value: String) = mutate { it.copy(name = value) }

    /** Sets the description (web `update('description', …)`). */
    fun setDescription(value: String) = mutate { it.copy(description = value) }

    /** Sets the pinned vehicle, or null for all vehicles (web `update('vehicle_id', …)`). */
    fun setVehicleId(value: Long?) = mutate { it.copy(vehicleId = value) }

    /** Sets the enabled flag (web `update('enabled', …)`). */
    fun setEnabled(value: Boolean) = mutate { it.copy(enabled = value) }

    /** Replaces the trigger when the type picker changes (web `handleTriggerKindChange`). */
    fun setTriggerKind(kind: TriggerKind?) =
        mutate { it.copy(triggers = if (kind == null) emptyList() else listOf(createDefaultTrigger(kind))) }

    /** Replaces the (single) configured trigger after an in-panel edit (web `update('triggers', [trigger])`). */
    fun setTrigger(trigger: AutomationTriggerInput) = mutate { it.copy(triggers = listOf(trigger)) }

    /** Replaces the conditions list (web `update('conditions', …)`). */
    fun setConditions(conditions: List<AutomationConditionInput>) = mutate { it.copy(conditions = conditions) }

    /** Replaces the actions list (web `update('actions', …)`). */
    fun setActions(actions: List<AutomationActionInput>) = mutate { it.copy(actions = actions) }

    private inline fun mutate(block: (BuilderForm) -> BuilderForm) {
        formState.update(block)
        dirtyState.value = true
    }

    // ---- Save / test-run / discard ------------------------------------------------

    /**
     * Validates and saves the form, flipping [navigateAway] on success so the screen returns to the list (web
     * `handleSave`). A validation failure or a mutation error sets [saveError]; an HTTP 409 sets [editConflict] instead
     * so the conflict banner shows rather than a raw message. On success the form is marked clean and the saved id is
     * recorded for the Test Run affordance.
     */
    fun save() {
        val invalid = validate(formState.value)
        if (invalid != null) {
            saveErrorState.value = SaveError.Validation(invalid)
            return
        }
        saveErrorState.value = null
        editConflictState.value = false
        launch {
            savingState.value = true
            val input = formState.value.toFullInput()
            val result =
                if (automationId != null) source.updateAutomationFull(automationId, input) else source.createAutomationFull(input)
            savingState.value = false
            result
                .onSuccess { saved ->
                    dirtyState.value = false
                    savedIdState.value = saved.id
                    navigateAwayState.value = true
                    logger.info(EVENT_SAVE)
                }.onFailure(::onSaveFailure)
        }
    }

    private fun onSaveFailure(error: Throwable) {
        if ((error as? ApiError.Http)?.status == HTTP_CONFLICT) {
            editConflictState.value = true
        } else {
            saveErrorState.value = SaveError.Mutation(error.message ?: error.toString())
        }
    }

    /** Starts a test run of the saved (or edited) automation (web `handleTestRun`). A no-op when nothing is saved yet. */
    fun testRun() {
        val target = testRunTarget.value ?: return
        launch {
            testRunningState.value = true
            val result = source.testRunAutomation(target)
            testRunningState.value = false
            result
                .onSuccess {
                    testRunStartedState.value = true
                    logger.info(EVENT_TEST_RUN)
                }.onFailure { logger.warn(EVENT_TEST_RUN_FAILED) }
        }
    }

    /** Discards in-progress edits and clears any blocker (web draft `onDiscard` + the discard-changes confirm). */
    fun discardDraft() {
        formState.value = BuilderForm()
        dirtyState.value = false
        saveErrorState.value = null
        editConflictState.value = false
    }

    /** Re-fetches the edit-mode automation after a hard error (the error surface's retry) by re-running the cold feed. */
    fun retry() {
        logger.info(EVENT_RETRY)
        retryTick.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no automation id / name payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAutomationBuilderPageOpened(logger)
    }

    private suspend fun <T> hydrateFrom(
        feed: StateFlow<UiState<T>>,
        toForm: (T) -> BuilderForm,
    ) {
        feed.collect { state ->
            val data = state.data
            if (!hydrated && data != null && state.isContent) {
                formState.value = toForm(data)
                hydrated = true
            }
        }
    }

    private companion object {
        const val HTTP_CONFLICT = 409
        const val EVENT_SAVE = "automations.builder.save"
        const val EVENT_RETRY = "automations.builder.retry"
        const val EVENT_TEST_RUN = "automations.builder.testRun"
        const val EVENT_TEST_RUN_FAILED = "automations.builder.testRunFailed"
    }
}
