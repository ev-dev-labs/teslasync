// The native Jetpack Compose + Material 3 AutomationBuilderPage automations surface — a parity port of
// web/src/features/automations/pages/AutomationBuilderPage.tsx, the typed create/edit form at /automations/new and
// /automations/:id/edit. It reproduces the page's three GlassPanels (the trigger-configurator panel, the empty-trigger
// panel, and the preset-hint panel), every data state (loading / not-found-empty / error / success), the four typed
// FormSections (General / When / Only If / Then), the save / test-run / cancel actions, the save-error banner, and the
// cross-cutting unsaved-changes guard, draft-recovery, and edit-conflict affordances — every visible string resolved
// from the generated res/values catalog (ADR-014).
//
// Composition: [AutomationBuilderPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the form + feeds); [AutomationBuilderPageContent] is the
// stateless render layer — the page chrome (title / subtitle / edit breadcrumb) then the edit-load-gated body (loader /
// not-found / error / form). The form draws each FormSection from the bound state and routes every edit back through the
// view-model, which owns all form state (ADR-002). No HTTP, no business logic in composables.
//
// `InvalidPackageDeclaration` is suppressed (mandated surface directory diverges from the app package);
// `MatchingDeclarationName` for the co-located stateless content + helpers; `LongMethod`/`TooManyFunctions` for the
// parity-complete section set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "LongMethod", "TooManyFunctions")

package io.teslasync.android.automations.builder

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.FormSection
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationActionInput
import io.teslasync.shared.core.presentation.automations.AutomationConditionInput
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel

/** Stagger between the body sections' entrance fades (web `FadeIn delay` cascade), in ms per section ordinal. */
private const val FADE_STEP_MS = 50

/** The HTTP status the edit-load read returns when the automation is missing — routed to the not-found surface. */
private const val HTTP_NOT_FOUND = 404

// ── Stateful entry ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AutomationBuilderPageViewModel] over the supplied [source] (the host wires the shared
 * Automations + Vehicles holders + the channels repository), keyed by the surface slug + the edited id/preset so the
 * form state is scoped to this builder instance. Records the one-shot `view.opened` diagnostic and binds the live state
 * to the content. [onNavigateToList] returns to the automations list after a save or cancel (web `navigate('/automations')`).
 */
@Composable
fun AutomationBuilderPage(
    source: AutomationBuilderPageSource,
    onNavigateToList: () -> Unit,
    modifier: Modifier = Modifier,
    automationId: Long? = null,
    presetId: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: AutomationBuilderPageViewModel =
        viewModel(
            key = AutomationBuilderPageRegistration.SLUG + ":" + (automationId?.toString() ?: presetId ?: "new"),
            factory =
                viewModelFactory {
                    initializer { AutomationBuilderPageViewModel(source, automationId, presetId, logger) }
                },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val automation by viewModel.automation.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val channels by viewModel.channels.collectAsStateWithLifecycle()
    val form by viewModel.form.collectAsStateWithLifecycle()
    val dirty by viewModel.dirty.collectAsStateWithLifecycle()
    val saveError by viewModel.saveError.collectAsStateWithLifecycle()
    val editConflict by viewModel.editConflict.collectAsStateWithLifecycle()
    val saving by viewModel.saving.collectAsStateWithLifecycle()
    val testRunning by viewModel.testRunning.collectAsStateWithLifecycle()
    val testRunStarted by viewModel.testRunStarted.collectAsStateWithLifecycle()
    val testRunTarget by viewModel.testRunTarget.collectAsStateWithLifecycle()
    val navigateAway by viewModel.navigateAway.collectAsStateWithLifecycle()

    AutomationBuilderPageContent(
        state =
            AutomationBuilderUiState(
                mode = viewModel.mode,
                automation = automation,
                form = form,
                vehicles = vehicles.data ?: emptyList(),
                channels = channels.data ?: emptyList(),
                dirty = dirty,
                saveError = saveError,
                editConflict = editConflict,
                saving = saving,
                testRunning = testRunning,
                testRunStarted = testRunStarted,
                testRunTarget = testRunTarget,
                navigateAway = navigateAway,
            ),
        callbacks =
            AutomationBuilderCallbacks(
                onName = viewModel::setName,
                onDescription = viewModel::setDescription,
                onVehicle = viewModel::setVehicleId,
                onEnabled = viewModel::setEnabled,
                onTriggerKind = viewModel::setTriggerKind,
                onTrigger = viewModel::setTrigger,
                onConditions = viewModel::setConditions,
                onActions = viewModel::setActions,
                onSave = viewModel::save,
                onTestRun = viewModel::testRun,
                onDiscard = viewModel::discardDraft,
                onLeave = onNavigateToList,
                onRetry = viewModel::retry,
            ),
        modifier = modifier,
    )
}

/** The immutable snapshot the stateless content renders (grouped so the content signature stays readable). */
data class AutomationBuilderUiState(
    val mode: BuilderMode,
    val automation: UiState<AutomationFull>,
    val form: BuilderForm,
    val vehicles: List<Vehicle>,
    val channels: List<NotificationChannel>,
    val dirty: Boolean,
    val saveError: SaveError?,
    val editConflict: Boolean,
    val saving: Boolean,
    val testRunning: Boolean,
    val testRunStarted: Boolean,
    val testRunTarget: Long?,
    val navigateAway: Boolean,
)

/** The edit callbacks the content routes every interaction through (the view-model owns all form state). */
data class AutomationBuilderCallbacks(
    val onName: (String) -> Unit,
    val onDescription: (String) -> Unit,
    val onVehicle: (Long?) -> Unit,
    val onEnabled: (Boolean) -> Unit,
    val onTriggerKind: (TriggerKind?) -> Unit,
    val onTrigger: (AutomationTriggerInput) -> Unit,
    val onConditions: (List<AutomationConditionInput>) -> Unit,
    val onActions: (List<AutomationActionInput>) -> Unit,
    val onSave: () -> Unit,
    val onTestRun: () -> Unit,
    val onDiscard: () -> Unit,
    val onLeave: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateless content ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the edit breadcrumb) then the edit-load-gated body — a
 * centered loader on a first edit load, the friendly not-found empty-state on a 404, a retryable error panel on a hard
 * failure, or the typed builder form otherwise (create/preset always render the form). An unsaved-changes guard wraps
 * back navigation.
 */
@Composable
fun AutomationBuilderPageContent(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
    modifier: Modifier = Modifier,
) {
    var confirmLeave by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val requestLeave = { if (state.dirty) confirmLeave = true else leaving = true }

    // The system back gesture goes through the unsaved-changes guard while there are edits; once a leave is committed
    // (a save, a confirmed discard, or a clean cancel) the guard is disabled so the dispatched pop is never re-caught.
    BackHandler(enabled = state.dirty && !leaving) { confirmLeave = true }

    // A successful save (web `navigate('/automations')`) commits the leave; the actual pop runs in a post-composition
    // effect so the now-disabled BackHandler can't intercept it.
    LaunchedEffect(state.navigateAway) { if (state.navigateAway) leaving = true }
    LaunchedEffect(leaving) { if (leaving) callbacks.onLeave() }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        BuilderChrome(mode = state.mode, automation = state.automation)

        val notFound = state.automation.httpStatus == HTTP_NOT_FOUND || state.automation.isEmpty
        when {
            state.mode == BuilderMode.Edit && state.automation.isLoading -> BuilderLoading()
            state.mode == BuilderMode.Edit && notFound -> BuilderNotFound()
            state.mode == BuilderMode.Edit && state.automation.isError -> BuilderError(onRetry = callbacks.onRetry)
            else -> BuilderBody(state = state, callbacks = callbacks, onRequestLeave = requestLeave)
        }
    }

    if (confirmLeave) {
        ConfirmDialog(
            title = stringResource(R.string.translation_forms_unsavedTitle),
            message = stringResource(R.string.translation_forms_unsavedAutomation),
            confirmLabel = stringResource(R.string.translation_forms_discard),
            cancelLabel = stringResource(R.string.translation_forms_keepEditing),
            onConfirm = {
                confirmLeave = false
                leaving = true
            },
            onCancel = { confirmLeave = false },
        )
    }
}

/** Title + subtitle (web `PageContainer` title/subtitle) and, in edit mode, the "Edit: {name}" breadcrumb caption. */
@Composable
private fun BuilderChrome(
    mode: BuilderMode,
    automation: UiState<AutomationFull>,
) {
    val title =
        when (mode) {
            BuilderMode.Edit -> stringResource(R.string.translation_automations_builder_editTitle)
            BuilderMode.Preset -> stringResource(R.string.translation_automations_builder_presetTitle)
            BuilderMode.Create -> stringResource(R.string.translation_automations_builder_createTitle)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(title)
        val editedName = automation.data?.name
        if (mode == BuilderMode.Edit && !editedName.isNullOrBlank()) {
            Caption(stringResource(R.string.translation_automations_builder_editBreadcrumb, editedName))
        }
        BodyText(
            stringResource(R.string.translation_automations_builder_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun BuilderLoading() {
    PageLoader(modifier = Modifier.fillMaxWidth(), label = stringResource(R.string.translation_common_loading))
}

/** The not-found surface — the web `<EmptyState … notFound />` shown when the edited automation is missing (404). */
@Composable
private fun BuilderNotFound() {
    EmptyState(
        message = stringResource(R.string.translation_automations_builder_notFound),
        icon = AutomationBuilderGlyphs.Warning,
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun BuilderError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The success surface — the back link, banners, the four FormSections, the action bar, and the preset hint. */
@Composable
private fun BuilderBody(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
    onRequestLeave: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Button(
            label = stringResource(R.string.translation_automations_builder_backToList),
            onClick = onRequestLeave,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = AutomationBuilderGlyphs.ArrowLeft,
        )

        if (state.editConflict) {
            EditConflictBanner()
        }
        if (state.mode == BuilderMode.Create && state.dirty) {
            DraftRecoveryBanner(onDiscard = callbacks.onDiscard)
        }

        FadeIn { GeneralSection(state, callbacks) }
        FadeIn(delayMs = FADE_STEP_MS) { WhenSection(state, callbacks) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { OnlyIfSection(state, callbacks) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { ThenSection(state, callbacks) }

        if (state.saveError != null) {
            SaveErrorBanner(state.saveError)
        }

        FadeIn(delayMs = FADE_STEP_MS * 4) { ActionBar(state, callbacks, onRequestLeave) }

        if (state.mode != BuilderMode.Edit) {
            FadeIn(delayMs = FADE_STEP_MS * 5) { PresetHintPanel() }
        }
    }
}

// ── General section ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GeneralSection(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
) {
    FormSection(title = stringResource(R.string.translation_automations_builder_general)) {
        Input(
            value = state.form.name,
            onValueChange = callbacks.onName,
            label = stringResource(R.string.translation_automations_builder_name),
            hint = stringResource(R.string.translation_automations_builder_namePlaceholder), // parity:allow ported web i18n key id (name hint copy)
            required = true,
        )
        Textarea(
            value = state.form.description,
            onValueChange = callbacks.onDescription,
            label = stringResource(R.string.translation_automations_builder_description),
            hint = stringResource(R.string.translation_automations_builder_descriptionPlaceholder), // parity:allow ported web i18n key id (description hint copy)
            minLines = 2,
        )
        Select(
            label = stringResource(R.string.translation_automations_builder_vehicle),
            options = vehicleOptions(state.vehicles),
            selectedValue = state.form.vehicleId?.toString() ?: "",
            emptyLabel = stringResource(R.string.translation_automations_builder_allVehicles),
            onSelect = { callbacks.onVehicle(it.toLongOrNull()) },
        )
        Toggle(
            checked = state.form.enabled,
            onCheckedChange = callbacks.onEnabled,
            label = stringResource(R.string.translation_automations_builder_enabled),
        )
    }
}

/** The vehicle picker options: an "All Vehicles" first option then each vehicle by display name (web `vehicleOptions`). */
@Composable
private fun vehicleOptions(vehicles: List<Vehicle>): List<SelectOption> {
    val all = SelectOption(value = "", label = stringResource(R.string.translation_automations_builder_allVehicles))
    val rows =
        vehicles.map { vehicle ->
            val label =
                vehicle.displayName.ifBlank {
                    stringResource(R.string.translation_automations_builder_vehicleFallback, vehicle.id.toString())
                }
            SelectOption(value = vehicle.id.toString(), label = label)
        }
    return listOf(all) + rows
}

// ── When (Trigger) section — GlassPanel1 / GlassPanel2 ───────────────────────────────────────────────────────────

@Composable
private fun WhenSection(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
) {
    val selectedKind = state.form.selectedTriggerKind()
    FormSection(
        title = stringResource(R.string.translation_automations_builder_when),
        description = stringResource(R.string.translation_automations_builder_whenDesc),
    ) {
        Select(
            label = stringResource(R.string.translation_automations_builder_triggerType),
            options = triggerKindOptions(),
            selectedValue = selectedKind?.name ?: "",
            emptyLabel = stringResource(R.string.translation_automations_builder_selectTrigger),
            onSelect = { picked -> callbacks.onTriggerKind(TriggerKind.entries.firstOrNull { it.name == picked }) },
        )
        val trigger = state.form.triggers.firstOrNull()
        if (trigger != null) {
            // GlassPanel1 — the per-kind trigger configurator (web `<GlassPanel><TriggerConfigurator/></GlassPanel>`).
            GlassPanel(padding = PanelPadding.Md) {
                TriggerConfigurator(trigger = trigger, onChange = callbacks.onTrigger)
            }
        } else {
            // GlassPanel2 — the empty-trigger prompt shown until a type is chosen (web `<GlassPanel><EmptyState/></GlassPanel>`).
            GlassPanel(padding = PanelPadding.Md) {
                EmptyState(message = stringResource(R.string.translation_automations_builder_emptyTrigger))
            }
        }
    }
}

/** The trigger-type picker options (web `triggerOptions`): a "Select trigger type…" prompt then the four kinds. */
@Composable
private fun triggerKindOptions(): List<SelectOption> =
    listOf(SelectOption(value = "", label = stringResource(R.string.translation_automations_builder_selectTrigger))) +
        TriggerKind.entries.map { SelectOption(value = it.name, label = triggerKindLabel(it)) }

@Composable
private fun triggerKindLabel(kind: TriggerKind): String =
    when (kind) {
        TriggerKind.Schedule -> stringResource(R.string.translation_automations_builder_triggerSchedule)
        TriggerKind.Event -> stringResource(R.string.translation_automations_builder_triggerEvent)
        TriggerKind.Geofence -> stringResource(R.string.translation_automations_builder_triggerGeofence)
        TriggerKind.Signal -> stringResource(R.string.translation_automations_builder_triggerSignal)
    }

// ── Only If (Conditions) section ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun OnlyIfSection(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
) {
    FormSection(
        title = stringResource(R.string.translation_automations_builder_onlyIf),
        description = stringResource(R.string.translation_automations_builder_onlyIfDesc),
    ) {
        ConditionsEditor(conditions = state.form.conditions, onChange = callbacks.onConditions)
    }
}

// ── Then (Actions) section ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ThenSection(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
) {
    FormSection(
        title = stringResource(R.string.translation_automations_builder_then),
        description = stringResource(R.string.translation_automations_builder_thenDesc),
    ) {
        ActionsEditor(actions = state.form.actions, channels = state.channels, onChange = callbacks.onActions)
    }
}

// ── Banners + action bar + preset hint (GlassPanel3) ─────────────────────────────────────────────────────────────

/** The save blocker banner — validation messages map to a localized string; a mutation message shows verbatim. */
@Composable
private fun SaveErrorBanner(error: SaveError) {
    val message =
        when (error) {
            is SaveError.Validation -> validationMessage(error.kind)
            is SaveError.Mutation -> error.message
        }
    AlertBanner(
        message = message,
        tone = Tone.Danger,
        title = stringResource(R.string.translation_automations_builder_saveError),
        icon = AutomationBuilderGlyphs.Warning,
    )
}

@Composable
private fun validationMessage(kind: BuilderValidation): String =
    when (kind) {
        BuilderValidation.NameRequired -> stringResource(R.string.translation_automations_builder_errorName)
        BuilderValidation.TriggerRequired -> stringResource(R.string.translation_automations_builder_errorTrigger)
        BuilderValidation.TriggerPlace -> stringResource(R.string.translation_automations_builder_errorTriggerPlace)
        BuilderValidation.ConditionPlace -> stringResource(R.string.translation_automations_builder_errorConditionPlace)
        BuilderValidation.ActionsRequired -> stringResource(R.string.translation_automations_builder_errorActions)
        BuilderValidation.ActionDetails -> stringResource(R.string.translation_automations_builder_errorActionDetails)
    }

/** The edit-conflict banner shown when a save was rejected as a concurrent edit (web `EditConflictBanner`). */
@Composable
private fun EditConflictBanner() {
    val resourceLabel = stringResource(R.string.translation_editConflict_resource_automation)
    AlertBanner(
        message = stringResource(R.string.translation_editConflict_banner_bodyWithLabel, resourceLabel),
        tone = Tone.Warning,
        title = resourceLabel,
        icon = AutomationBuilderGlyphs.Warning,
    )
}

/** The draft-recovery banner shown for a dirty new automation (web `DraftRecoveryBanner`), labelled by the item noun. */
@Composable
private fun DraftRecoveryBanner(onDiscard: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_forms_unsavedWarning),
        tone = Tone.Info,
        title = stringResource(R.string.translation_draft_noun_automation),
        action = BannerAction(stringResource(R.string.translation_forms_discardDraft), onDiscard),
    )
}

/** The submit / test-run / cancel action bar + the "test run started" confirmation (web action footer). */
@Composable
private fun ActionBar(
    state: AutomationBuilderUiState,
    callbacks: AutomationBuilderCallbacks,
    onRequestLeave: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val submitLabel =
                if (state.mode == BuilderMode.Edit) {
                    stringResource(R.string.translation_automations_builder_save)
                } else {
                    stringResource(R.string.translation_automations_builder_create)
                }
            Button(
                label = submitLabel,
                onClick = callbacks.onSave,
                variant = ButtonVariant.Primary,
                enabled = !state.saving,
                loading = state.saving,
                leadingIcon = AutomationBuilderGlyphs.Save,
            )
            if (state.testRunTarget != null) {
                Button(
                    label = stringResource(R.string.translation_automations_builder_testRun),
                    onClick = callbacks.onTestRun,
                    variant = ButtonVariant.Secondary,
                    enabled = !state.testRunning,
                    loading = state.testRunning,
                    leadingIcon = AutomationBuilderGlyphs.Play,
                )
            }
            Button(
                label = stringResource(R.string.translation_automations_builder_cancel),
                onClick = onRequestLeave,
                variant = ButtonVariant.Ghost,
                leadingIcon = AutomationBuilderGlyphs.Close,
            )
        }
        if (state.testRunStarted) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    AutomationBuilderGlyphs.Bolt,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.success,
                )
                Caption(stringResource(R.string.translation_automations_builder_testRunStarted))
            }
        }
    }
}

/** GlassPanel3 — the preset-hint panel shown when creating (web `{!isEdit && <GlassPanel>presetHint</GlassPanel>}`). */
@Composable
private fun PresetHintPanel() {
    GlassPanel(padding = PanelPadding.Md) {
        BodyText(
            stringResource(R.string.translation_automations_builder_presetHint),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
