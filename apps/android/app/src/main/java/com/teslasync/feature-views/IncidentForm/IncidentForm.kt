// Compose render layer for the IncidentForm feature view — the native analogue of the JSX the web component returns
// (web/src/features/system/components/status/IncidentForm.tsx). It is a thin shell over the pure
// [IncidentFormProjection] derivations + the [IncidentFormViewModel] orchestration: a Material 3 modal hosting the
// title / severity / status / affected-components / message form, the Cancel + Log-incident actions (the submit
// button flips to its in-flight label, web `create.isPending`), and the success / validation / failure toasts. Every
// string is resolved from the i18n catalog (P1/S10); colors come from the generated theme tokens (P1/S9). No HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/feature-views/IncidentForm)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Maximum simultaneously-stacked toasts (web caps the toast region). */
private const val MAX_TOASTS = 3

/** Toast visible duration before auto-dismiss. */
private const val TOAST_DURATION_MS = 4_000L

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless [IncidentFormContent] takes plain strings and stays trivially previewable + UI-testable.
 */
data class IncidentFormStrings(
    val title: String,
    val close: String,
    val titleLabel: String,
    val titleHint: String,
    val severityLabel: String,
    val severityMinor: String,
    val severityMajor: String,
    val severityCritical: String,
    val statusLabel: String,
    val statusInvestigating: String,
    val statusIdentified: String,
    val statusMonitoring: String,
    val statusResolved: String,
    val componentsLabel: String,
    val componentsHint: String,
    val messageLabel: String,
    val messageHint: String,
    val cancel: String,
    val submit: String,
    val submitting: String,
    val toastLogged: String,
    val toastSubmitFailed: String,
    val validationTitleTooShort: String,
)

/** Resolves every [IncidentFormStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberIncidentFormStrings(): IncidentFormStrings =
    IncidentFormStrings(
        title = stringResource(R.string.translation_incidentForm_title),
        close = stringResource(R.string.translation_incidentForm_close),
        titleLabel = stringResource(R.string.translation_incidentForm_titleLabel),
        titleHint = stringResource(R.string.translation_incidentForm_titleHint),
        severityLabel = stringResource(R.string.translation_incidentForm_severityLabel),
        severityMinor = stringResource(R.string.translation_incidentForm_severityMinor),
        severityMajor = stringResource(R.string.translation_incidentForm_severityMajor),
        severityCritical = stringResource(R.string.translation_incidentForm_severityCritical),
        statusLabel = stringResource(R.string.translation_incidentForm_statusLabel),
        statusInvestigating = stringResource(R.string.translation_incidentForm_statusInvestigating),
        statusIdentified = stringResource(R.string.translation_incidentForm_statusIdentified),
        statusMonitoring = stringResource(R.string.translation_incidentForm_statusMonitoring),
        statusResolved = stringResource(R.string.translation_incidentForm_statusResolved),
        componentsLabel = stringResource(R.string.translation_incidentForm_componentsLabel),
        componentsHint = stringResource(R.string.translation_incidentForm_componentsHint),
        messageLabel = stringResource(R.string.translation_incidentForm_messageLabel),
        messageHint = stringResource(R.string.translation_incidentForm_messageHint),
        cancel = stringResource(R.string.translation_incidentForm_cancel),
        submit = stringResource(R.string.translation_incidentForm_submit),
        submitting = stringResource(R.string.translation_incidentForm_submitting),
        toastLogged = stringResource(R.string.translation_incidentForm_toastLogged),
        toastSubmitFailed = stringResource(R.string.translation_incidentForm_toastSubmitFailed),
        validationTitleTooShort = stringResource(R.string.translation_incidentForm_validationTitleTooShort),
    )

/**
 * Stateful entry point. Binds the [source] (the S8 incidents write seam) into an [IncidentFormViewModel], records the
 * one-shot PII-safe `view.opened` diagnostic, hosts the toast queue, dismisses on a successful log, and renders the
 * modal form. A host supplies [source] (bound from the shared IncidentsStore); tests/previews pass a fake. No HTTP.
 *
 * @param onClose dismiss callback — invoked by the Cancel/close affordances and after a successful log (web `onClose`).
 * @param source the incidents write seam (P1/S8); host-provided so the dialog never sees the store or HTTP.
 */
@Composable
fun IncidentForm(
    onClose: () -> Unit,
    source: IncidentFormSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = IncidentFormRegistration.SLUG,
) {
    val viewModel: IncidentFormViewModel =
        viewModel(key = instanceKey, factory = IncidentFormViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel) { viewModel.closed.collect { onClose() } }

    val submitting by viewModel.submitting.collectAsStateWithLifecycle()
    val strings = rememberIncidentFormStrings()
    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    IncidentFormToastPresenter(viewModel, toastQueue, strings)

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        IncidentFormContent(
            strings = strings,
            submitting = submitting,
            onSubmit = viewModel::submit,
            onCancel = onClose,
        )
        ToastHost(toasts = toastQueue, onDismiss = { id -> toastQueue.removeAll { it.id == id } })
    }
}

/**
 * Collects the ViewModel's one-shot [IncidentFormToast]s, maps each to a localized + toned [ToastItem], and feeds the
 * caller-owned [queue] with an auto-dismiss timer — the native analogue of the web `useToast` calls.
 */
@Composable
private fun IncidentFormToastPresenter(
    viewModel: IncidentFormViewModel,
    queue: SnapshotStateList<ToastItem>,
    strings: IncidentFormStrings,
) {
    val scope = rememberCoroutineScope()
    var seq by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = toastItem(toast, seq++, strings)
            queue.add(item)
            if (queue.size > MAX_TOASTS) queue.removeAt(0)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

private fun toastItem(
    toast: IncidentFormToast,
    id: Long,
    strings: IncidentFormStrings,
): ToastItem =
    when (toast) {
        IncidentFormToast.Logged -> ToastItem(id, strings.toastLogged, Tone.Success)
        IncidentFormToast.ValidationTitleTooShort -> ToastItem(id, strings.validationTitleTooShort, Tone.Danger)
        is IncidentFormToast.SubmitFailed ->
            ToastItem(id, toast.detail?.takeIf { it.isNotBlank() } ?: strings.toastSubmitFailed, Tone.Danger)
    }

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral draft (web
 * `useState`), clamps each edit to the server bounds, and hands the assembled [IncidentDraft] back through [onSubmit].
 * Every control carries an accessible label; the Cancel + submit actions disable while a log is in flight.
 */
@Composable
fun IncidentFormContent(
    strings: IncidentFormStrings,
    submitting: Boolean,
    onSubmit: (IncidentDraft) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf(IncidentDraft()) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = draft.title,
            onValueChange = { draft = draft.copy(title = IncidentFormProjection.clampTitle(it)) },
            label = strings.titleLabel,
            hint = strings.titleHint,
            enabled = !submitting,
            required = true,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Select(
                options = severityOptions(strings),
                selectedValue = draft.severity.wire,
                onSelect = { draft = draft.copy(severity = IncidentSeverity.fromWire(it)) },
                modifier = Modifier.weight(1f),
                label = strings.severityLabel,
                enabled = !submitting,
            )
            Select(
                options = statusOptions(strings),
                selectedValue = draft.status.wire,
                onSelect = { draft = draft.copy(status = IncidentStatus.fromWire(it)) },
                modifier = Modifier.weight(1f),
                label = strings.statusLabel,
                enabled = !submitting,
            )
        }
        Input(
            value = draft.components,
            onValueChange = { draft = draft.copy(components = it) },
            label = strings.componentsLabel,
            hint = strings.componentsHint,
            enabled = !submitting,
        )
        Textarea(
            value = draft.message,
            onValueChange = { draft = draft.copy(message = IncidentFormProjection.clampMessage(it)) },
            label = strings.messageLabel,
            hint = strings.messageHint,
            enabled = !submitting,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                enabled = !submitting,
            )
            Button(
                label = if (submitting) strings.submitting else strings.submit,
                onClick = { onSubmit(draft) },
                variant = ButtonVariant.Primary,
                enabled = !submitting,
            )
        }
    }
}

private fun severityOptions(strings: IncidentFormStrings): List<SelectOption> =
    listOf(
        SelectOption(IncidentSeverity.Minor.wire, strings.severityMinor),
        SelectOption(IncidentSeverity.Major.wire, strings.severityMajor),
        SelectOption(IncidentSeverity.Critical.wire, strings.severityCritical),
    )

private fun statusOptions(strings: IncidentFormStrings): List<SelectOption> =
    listOf(
        SelectOption(IncidentStatus.Investigating.wire, strings.statusInvestigating),
        SelectOption(IncidentStatus.Identified.wire, strings.statusIdentified),
        SelectOption(IncidentStatus.Monitoring.wire, strings.statusMonitoring),
        SelectOption(IncidentStatus.Resolved.wire, strings.statusResolved),
    )
