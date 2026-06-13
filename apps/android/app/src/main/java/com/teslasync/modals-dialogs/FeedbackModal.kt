// Compose render layer for the FeedbackModal surface — the native analogue of the JSX the web component returns
// (web/src/components/feedback/FeedbackModal.tsx). It is a thin shell over the pure [FeedbackModalProjection]
// derivations + the [FeedbackModalViewModel] orchestration: a Material 3 modal hosting the category / title / body
// form, the auto-attached context panel (page route, app version, device descriptor) with the two consent toggles
// (attach recent errors — default ON, attach recent console messages — default OFF), the inline submit-error alert
// (web `submit.isError`), and the Cancel + Send-feedback actions (the submit button flips to its in-flight label and
// disables while invalid or sending, web `submitDisabled`). Every string is resolved from the i18n catalog (P1/S10);
// colors come from the generated theme tokens (P1/S9). No HTTP.
//
// Web parity note: the web component takes an `open` prop and renders a self-managed `<Modal open>`. The native idiom
// is conditional composition — the host renders `if (open) FeedbackModal(...)` — so this surface omits the `open`
// parameter, exactly as the sibling IncidentForm dialog does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs) cannot form
// a valid Kotlin package. `MatchingDeclarationName` is suppressed because the file's primary export is the
// `FeedbackModal` composable (matching the filename); the co-located [FeedbackModalStrings] carrier is a supporting type.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.feedbackmodal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [FeedbackModalContent] takes plain strings and stays trivially previewable + UI-testable.
 */
data class FeedbackModalStrings(
    val title: String,
    val close: String,
    val categoryLabel: String,
    val categoryBug: String,
    val categoryFeature: String,
    val categoryOther: String,
    val titleLabel: String,
    val titleHint: String,
    val bodyLabel: String,
    val bodyHint: String,
    val contextTitle: String,
    val contextPage: String,
    val contextAppVersion: String,
    val contextUserAgent: String,
    val contextUnknown: String,
    val includeErrorsHint: String,
    val includeConsole: String,
    val includeConsoleHint: String,
    val submitError: String,
    val cancel: String,
    val submitting: String,
    val submit: String,
    val required: String,
)

/** Resolves every [FeedbackModalStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberFeedbackModalStrings(): FeedbackModalStrings =
    FeedbackModalStrings(
        title = stringResource(R.string.translation_feedback_title),
        close = stringResource(R.string.translation_common_close),
        categoryLabel = stringResource(R.string.translation_feedback_form_category_label),
        categoryBug = stringResource(R.string.translation_feedback_category_bug),
        categoryFeature = stringResource(R.string.translation_feedback_category_feature),
        categoryOther = stringResource(R.string.translation_feedback_category_other),
        titleLabel = stringResource(R.string.translation_feedback_form_title_label),
        titleHint = stringResource(R.string.translation_feedback_form_title_placeholder), // parity:allow i18n key name
        bodyLabel = stringResource(R.string.translation_feedback_form_body_label),
        bodyHint = stringResource(R.string.translation_feedback_form_body_placeholder), // parity:allow i18n key name
        contextTitle = stringResource(R.string.translation_feedback_context_title),
        contextPage = stringResource(R.string.translation_feedback_context_page),
        contextAppVersion = stringResource(R.string.translation_feedback_context_appVersion),
        contextUserAgent = stringResource(R.string.translation_feedback_context_userAgent),
        contextUnknown = stringResource(R.string.translation_feedback_context_unknown),
        includeErrorsHint = stringResource(R.string.translation_feedback_form_includeErrorsHint),
        includeConsole = stringResource(R.string.translation_feedback_form_includeConsole),
        includeConsoleHint = stringResource(R.string.translation_feedback_form_includeConsoleHint),
        submitError = stringResource(R.string.translation_feedback_submitError),
        cancel = stringResource(R.string.translation_common_cancel),
        submitting = stringResource(R.string.translation_feedback_form_submitting),
        submit = stringResource(R.string.translation_feedback_form_submit),
        required = stringResource(R.string.translation_form_required),
    )

/**
 * Stateful entry point. Binds the [source] (the S8 feedback write seam) into a [FeedbackModalViewModel], records the
 * one-shot PII-safe `view.opened` diagnostic, clears any stale inline error on (re)open, dismisses on a successful
 * submit, and renders the modal form. A host supplies [source] (bound from the shared FeedbackStore) and the
 * auto-collected [context]; tests/previews pass fakes. No HTTP.
 *
 * @param onClose dismiss callback — invoked by the Cancel/close affordances and after a successful submit (web `onClose`).
 * @param source the feedback write seam (P1/S8); host-provided so the dialog never sees the store or HTTP.
 * @param context the auto-collected diagnostic context shown before submit (web `useLocation` + navigator + env + buffers).
 */
@Composable
fun FeedbackModal(
    onClose: () -> Unit,
    source: FeedbackModalSource,
    context: FeedbackContext = FeedbackContext(),
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FeedbackModalRegistration.SLUG,
) {
    val viewModel: FeedbackModalViewModel =
        viewModel(key = instanceKey, factory = FeedbackModalViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(Unit) { viewModel.resetSubmitError() }
    LaunchedEffect(viewModel) { viewModel.closed.collect { onClose() } }

    val submitting by viewModel.submitting.collectAsStateWithLifecycle()
    val submitError by viewModel.submitError.collectAsStateWithLifecycle()
    val strings = rememberFeedbackModalStrings()

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        FeedbackModalContent(
            strings = strings,
            context = context,
            submitting = submitting,
            submitError = submitError,
            onSubmit = { draft -> viewModel.submit(draft, context) },
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral draft (web
 * `useState`), clamps each edit to the server bounds, surfaces a per-field required affordance once a field is
 * touched-then-cleared, gates the submit on full validity (web `submitDisabled`), and hands the assembled
 * [FeedbackDraft] back through [onSubmit]. Every control carries an accessible label; the Cancel + submit actions
 * disable while a submit is in flight.
 */
@Composable
fun FeedbackModalContent(
    strings: FeedbackModalStrings,
    context: FeedbackContext,
    submitting: Boolean,
    submitError: Boolean,
    onSubmit: (FeedbackDraft) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf(FeedbackDraft()) }
    var titleTouched by remember { mutableStateOf(false) }
    var bodyTouched by remember { mutableStateOf(false) }
    val valid = FeedbackModalProjection.isValid(draft)
    val titleError = if (titleTouched && draft.title.isBlank()) strings.required else null
    val bodyError = if (bodyTouched && draft.body.isBlank()) strings.required else null

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Select(
            options = categoryOptions(strings),
            selectedValue = draft.category.wire,
            onSelect = { draft = draft.copy(category = FeedbackCategory.fromWire(it)) },
            label = strings.categoryLabel,
            enabled = !submitting,
        )
        Input(
            value = draft.title,
            onValueChange = {
                titleTouched = true
                draft = draft.copy(title = FeedbackModalProjection.clampTitle(it))
            },
            label = strings.titleLabel,
            hint = strings.titleHint,
            errorText = titleError,
            enabled = !submitting,
            required = true,
        )
        Textarea(
            value = draft.body,
            onValueChange = {
                bodyTouched = true
                draft = draft.copy(body = FeedbackModalProjection.clampBody(it))
            },
            label = strings.bodyLabel,
            hint = strings.bodyHint,
            errorText = bodyError,
            enabled = !submitting,
            required = true,
            minLines = MIN_BODY_LINES,
        )
        FeedbackContextPanel(
            strings = strings,
            context = context,
            draft = draft,
            submitting = submitting,
            onDraftChange = { draft = it },
        )
        if (submitError) {
            ErrorText(
                text = strings.submitError,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
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
                onClick = {
                    titleTouched = true
                    bodyTouched = true
                    onSubmit(draft)
                },
                variant = ButtonVariant.Primary,
                enabled = !submitting && valid,
            )
        }
    }
}

/**
 * The auto-attached context panel — the native mirror of the web component's bordered "Auto-attached context" box: the
 * page route, app version, and device descriptor (shown so nothing ships without the operator seeing it), plus the two
 * consent toggles with their privacy helper text. The recent-errors count is interpolated into the toggle label from
 * the live [FeedbackContext.recentErrors] buffer (web `getRecentReportsForFeedback().length`).
 */
@Composable
private fun FeedbackContextPanel(
    strings: FeedbackModalStrings,
    context: FeedbackContext,
    draft: FeedbackDraft,
    submitting: Boolean,
    onDraftChange: (FeedbackDraft) -> Unit,
) {
    val includeErrorsLabel =
        stringResource(R.string.translation_feedback_form_includeErrors, context.recentErrors.size)
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Caption(strings.contextTitle)
            ContextRow(strings.contextPage, context.pageRoute.ifBlank { strings.contextUnknown }, mono = true)
            ContextRow(strings.contextAppVersion, context.appVersion.ifBlank { strings.contextUnknown }, mono = true)
            ContextRow(strings.contextUserAgent, context.userAgent.ifBlank { strings.contextUnknown }, mono = false)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Toggle(
                    checked = draft.includeRecentErrors,
                    onCheckedChange = { onDraftChange(draft.copy(includeRecentErrors = it)) },
                    label = includeErrorsLabel,
                    enabled = !submitting,
                )
                HelperText(strings.includeErrorsHint)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Toggle(
                    checked = draft.includeConsoleTail,
                    onCheckedChange = { onDraftChange(draft.copy(includeConsoleTail = it)) },
                    label = strings.includeConsole,
                    enabled = !submitting,
                )
                HelperText(strings.includeConsoleHint)
            }
        }
    }
}

/** One labelled context entry: a muted caption over the value, monospaced for route/version, plain for the descriptor. */
@Composable
private fun ContextRow(
    label: String,
    value: String,
    mono: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        if (mono) CodeText(value) else BodyText(value)
    }
}

private fun categoryOptions(strings: FeedbackModalStrings): List<SelectOption> =
    listOf(
        SelectOption(FeedbackCategory.Bug.wire, strings.categoryBug),
        SelectOption(FeedbackCategory.Feature.wire, strings.categoryFeature),
        SelectOption(FeedbackCategory.Other.wire, strings.categoryOther),
    )

/** Body textarea row count (web `rows={6}`). */
private const val MIN_BODY_LINES = 6
