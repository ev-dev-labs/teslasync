// The native Jetpack Compose + Material 3 WebhookChannelsSection feature view — a parity port of
// web/src/features/settings/components/WebhookChannelsSection.tsx. It reproduces that surface end to end: the
// header (icon + title + subtitle + "Add webhook"), the kind=webhook list (web `useWebhookChannels`) with a
// status pill + method chip + per-row toggle / test / edit / delete, the inline structured test result (web
// `testResults`), the create/edit modal (name, URL, HTTP method, signing secret) with a live HMAC
// X-TeslaSync-Signature preview (web `useWebhookSignaturePreview`), the delete confirmation, and the payload
// variables doc box. Every lifecycle state the shared cache-then-network feed can carry is rendered — loading
// skeleton chrome, friendly empty state, hard-error retry surface, and stale/offline "last known" with a
// freshness chip + auto-refresh — so a panel is never a blank box. The view performs NO HTTP: it binds the
// [WebhookChannelsSectionViewModel] (P1/S8) and renders.
//
// Toasts are surfaced through the shared [ToastHost] from the view-model's typed [WebhookToast] stream, localized
// at this boundary (P1/S10) onto the generic channel-CRUD copy the web hooks emit. The signing secret powers the
// live signature preview here; see WebhookChannelsSectionProjection.kt for why it is not persisted through the
// shared typed save body (a declared shared-contract boundary, not silent drift).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/WebhookChannelsSection) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.webhookchannelssection

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val SIGNATURE_DEBOUNCE_MS = 300L
private val ROW_SKELETON_HEIGHT = 96.dp
private val TEST_SPINNER_SIZE = 18.dp
private const val LOADING_TAG = "Loading"

/**
 * Stateful entry point for the WebhookChannelsSection surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the create/edit modal + delete confirmation + toast queue, and renders
 * every lifecycle state the webhook feed can carry. The host constructs the view-model via
 * [WebhookChannelsSectionViewModel.create]; this view never performs HTTP.
 */
@Composable
fun WebhookChannelsSection(
    viewModel: WebhookChannelsSectionViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val channelsState by viewModel.webhookChannels.collectAsStateWithLifecycle()
    val testResults by viewModel.testResults.collectAsStateWithLifecycle()
    val testingChannelId by viewModel.testingChannelId.collectAsStateWithLifecycle()

    var showForm by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<WebhookFormState?>(null) }
    var confirmDelete by remember { mutableStateOf<NotificationChannel.Webhook?>(null) }

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    WebhookToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        WebhookChannelsSectionContent(
            channelsState = channelsState,
            testResults = testResults,
            testingChannelId = testingChannelId,
            onAdd = {
                editing = null
                showForm = true
            },
            onEdit = { channel ->
                editing = webhookFormFrom(channel)
                showForm = true
            },
            onDelete = { channel -> confirmDelete = channel },
            onToggle = viewModel::toggle,
            onTest = viewModel::test,
            onRetry = viewModel::retry,
        )

        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (showForm) {
        val close = {
            showForm = false
            editing = null
        }
        WebhookFormModal(
            initial = editing,
            onDismiss = { showForm = false },
            onSaved = close,
            onSave = viewModel::save,
            onPreview = viewModel::previewSignature,
        )
    }

    confirmDelete?.let { channel ->
        ConfirmDialog(
            title = stringResource(R.string.translation_webhookChannels_delete_title),
            message = stringResource(R.string.translation_webhookChannels_delete_message),
            confirmLabel = stringResource(R.string.translation_webhookChannels_delete_confirm),
            cancelLabel = stringResource(R.string.translation_webhookChannels_delete_cancel),
            severity = ConfirmSeverity.Danger,
            closeLabel = stringResource(R.string.translation_common_close),
            onConfirm = {
                viewModel.delete(channel)
                confirmDelete = null
            },
            onCancel = { confirmDelete = null },
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (header → list →
 * docs box) and every lifecycle branch: a loading skeleton, a hard-error retry surface, the no-webhooks empty
 * state, and the populated rows with their freshness chip. Stale (non-error) data auto-refreshes, mirroring the
 * sibling surfaces' freshness contract.
 */
@Composable
fun WebhookChannelsSectionContent(
    channelsState: UiState<List<NotificationChannel.Webhook>>,
    testResults: Map<Long, WebhookTestResult>,
    testingChannelId: Long?,
    onAdd: () -> Unit,
    onEdit: (NotificationChannel.Webhook) -> Unit,
    onDelete: (NotificationChannel.Webhook) -> Unit,
    onToggle: (NotificationChannel.Webhook) -> Unit,
    onTest: (NotificationChannel.Webhook) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(channelsState.stale, channelsState.refreshing, channelsState.hasError) {
        if (channelsState.stale && !channelsState.refreshing && !channelsState.hasError) onRetry()
    }

    FadeIn {
        GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                WebhookSectionHeader(onAdd = onAdd)
                WebhookListArea(
                    channelsState = channelsState,
                    testResults = testResults,
                    testingChannelId = testingChannelId,
                    onAdd = onAdd,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onToggle = onToggle,
                    onTest = onTest,
                    onRetry = onRetry,
                )
                WebhookDocsPanel()
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookSectionHeader(onAdd: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info) {
            Icon(WebhookGlyphs.Webhook, contentDescription = null, size = IconSize.Md)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            SectionTitle(stringResource(R.string.translation_webhookChannels_title))
            HelperText(stringResource(R.string.translation_webhookChannels_subtitle))
        }
        Button(
            label = stringResource(R.string.translation_webhookChannels_addButton),
            onClick = onAdd,
            variant = ButtonVariant.Primary,
            leadingIcon = TeslaGlyphs.Plus,
        )
    }
}

// ── List area ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookListArea(
    channelsState: UiState<List<NotificationChannel.Webhook>>,
    testResults: Map<Long, WebhookTestResult>,
    testingChannelId: Long?,
    onAdd: () -> Unit,
    onEdit: (NotificationChannel.Webhook) -> Unit,
    onDelete: (NotificationChannel.Webhook) -> Unit,
    onToggle: (NotificationChannel.Webhook) -> Unit,
    onTest: (NotificationChannel.Webhook) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        channelsState.isLoading -> WebhookLoading()
        channelsState.isError -> WebhookErrorState(channelsState, onRetry)
        channelsState.isEmpty -> WebhookEmptyState(onAdd)
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                if (channelsState.stale || channelsState.refreshing || channelsState.hasError) {
                    WebhookFreshnessChip(channelsState)
                }
                sortWebhookChannels(channelsState.data ?: emptyList()).forEach { channel ->
                    WebhookRow(
                        channel = channel,
                        isTesting = testingChannelId == channel.id,
                        testResult = testResults[channel.id],
                        onToggle = onToggle,
                        onTest = onTest,
                        onEdit = onEdit,
                        onDelete = onDelete,
                    )
                }
            }
    }
}

@Composable
private fun WebhookLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(3) {
            Skeleton(
                modifier = Modifier.semantics { contentDescription = LOADING_TAG },
                height = ROW_SKELETON_HEIGHT,
            )
        }
    }
}

@Composable
private fun WebhookErrorState(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_webhookChannels_loadError, webhookErrorDetail(state)),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun webhookErrorDetail(state: UiState<*>): String =
    when (state.errorKind) {
        ErrorKind.Network, ErrorKind.Timeout, ErrorKind.CircuitOpen ->
            stringResource(R.string.translation_error_network_message)
        else -> stringResource(R.string.translation_error_serverError_message)
    }

@Composable
private fun WebhookEmptyState(onAdd: () -> Unit) {
    EmptyState(
        message = stringResource(R.string.translation_webhookChannels_empty_message),
        title = stringResource(R.string.translation_webhookChannels_empty_title),
        icon = WebhookGlyphs.Webhook,
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_webhookChannels_empty_action),
                onClick = onAdd,
            ),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Row ──────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookRow(
    channel: NotificationChannel.Webhook,
    isTesting: Boolean,
    testResult: WebhookTestResult?,
    onToggle: (NotificationChannel.Webhook) -> Unit,
    onTest: (NotificationChannel.Webhook) -> Unit,
    onEdit: (NotificationChannel.Webhook) -> Unit,
    onDelete: (NotificationChannel.Webhook) -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            WebhookRowHeader(
                channel = channel,
                isTesting = isTesting,
                onToggle = onToggle,
                onTest = onTest,
                onEdit = onEdit,
                onDelete = onDelete,
            )
            if (testResult != null) WebhookTestResultPanel(testResult)
        }
    }
}

@Composable
private fun WebhookRowHeader(
    channel: NotificationChannel.Webhook,
    isTesting: Boolean,
    onToggle: (NotificationChannel.Webhook) -> Unit,
    onTest: (NotificationChannel.Webhook) -> Unit,
    onEdit: (NotificationChannel.Webhook) -> Unit,
    onDelete: (NotificationChannel.Webhook) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(channel.name)
                if (channel.enabled) {
                    Badge(stringResource(R.string.translation_webhookChannels_row_enabled), variant = BadgeVariant.Success)
                } else {
                    Badge(stringResource(R.string.translation_webhookChannels_row_disabled), variant = BadgeVariant.Neutral)
                }
                Badge(webhookMethodLabel(channel.method), variant = BadgeVariant.Info)
            }
            BodyText(channel.url, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        WebhookRowActions(
            channel = channel,
            isTesting = isTesting,
            onToggle = onToggle,
            onTest = onTest,
            onEdit = onEdit,
            onDelete = onDelete,
        )
    }
}

@Composable
private fun WebhookRowActions(
    channel: NotificationChannel.Webhook,
    isTesting: Boolean,
    onToggle: (NotificationChannel.Webhook) -> Unit,
    onTest: (NotificationChannel.Webhook) -> Unit,
    onEdit: (NotificationChannel.Webhook) -> Unit,
    onDelete: (NotificationChannel.Webhook) -> Unit,
) {
    val toggleDescription = activeToggleLabel(channel.enabled)
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Toggle(
            checked = channel.enabled,
            onCheckedChange = { onToggle(channel) },
            modifier =
                Modifier
                    .width(56.dp)
                    .semantics { contentDescription = toggleDescription },
        )
        if (isTesting) {
            CircularProgressIndicator(modifier = Modifier.size(TEST_SPINNER_SIZE), strokeWidth = 2.dp)
        } else {
            IconButton(
                imageVector = WebhookGlyphs.Send,
                contentDescription = stringResource(R.string.translation_webhookChannels_row_test),
                onClick = { onTest(channel) },
                size = IconSize.Sm,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.Edit,
            contentDescription = stringResource(R.string.translation_webhookChannels_row_edit),
            onClick = { onEdit(channel) },
            size = IconSize.Sm,
        )
        IconButton(
            imageVector = WebhookGlyphs.Trash,
            contentDescription = stringResource(R.string.translation_webhookChannels_row_delete),
            onClick = { onDelete(channel) },
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
    }
}

@Composable
private fun activeToggleLabel(enabled: Boolean): String {
    val active = stringResource(R.string.translation_webhookChannels_row_toggle)
    val state =
        if (enabled) {
            stringResource(R.string.translation_webhookChannels_row_enabled)
        } else {
            stringResource(R.string.translation_webhookChannels_row_disabled)
        }
    return "$active: $state"
}

// ── Inline test result ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookTestResultPanel(result: WebhookTestResult) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (result.success) {
                    Badge(stringResource(R.string.translation_webhookChannels_test_success), variant = BadgeVariant.Success)
                } else {
                    Badge(stringResource(R.string.translation_webhookChannels_test_failure), variant = BadgeVariant.Danger)
                }
                Caption(stringResource(R.string.translation_webhookChannels_test_status, result.statusCode))
                Caption(stringResource(R.string.translation_webhookChannels_test_latency, result.latencyMs))
            }
            result.signature?.takeIf { it.isNotEmpty() }?.let { signature ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption(stringResource(R.string.translation_webhookChannels_test_signature))
                    CodeText(signature, modifier = Modifier.weight(1f))
                }
            }
            result.bodyPreview?.takeIf { it.isNotEmpty() }?.let { body ->
                WebhookResponseBody(body = body, truncated = result.truncated)
            }
            result.error?.takeIf { it.isNotEmpty() }?.let { error ->
                BodyText(error, color = TeslaTokens.status.danger)
            }
        }
    }
}

@Composable
private fun WebhookResponseBody(
    body: String,
    truncated: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.translation_webhookChannels_test_body)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(
            label,
            modifier =
                Modifier
                    .clickable { expanded = !expanded }
                    .semantics { contentDescription = label },
        )
        if (expanded) {
            val suffix = if (truncated) "\n${stringResource(R.string.translation_webhookChannels_test_truncated)}" else ""
            CodeText("$body$suffix", modifier = Modifier.fillMaxWidth())
        }
    }
}

// ── Freshness chip ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookFreshnessChip(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Payload docs ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WebhookDocsPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Subhead(stringResource(R.string.translation_webhookChannels_docs_title))
            HelperText(stringResource(R.string.translation_webhookChannels_docs_intro))
            WEBHOOK_PAYLOAD_VARIABLES.forEach { variable ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption("\u2022")
                    CodeText(variable)
                }
            }
        }
    }
}

// ── Create / edit modal ──────────────────────────────────────────────────────────────────────────────────

/**
 * The create/edit webhook modal (web `WebhookFormModal`). Owns the transient form state, the secret visibility
 * toggle, the inline validation error, and the in-flight save flag. [onSave] returns a [Result] so a success
 * closes via [onSaved] and a failure shows the inline error; [onPreview] backs the live signature preview.
 */
@Composable
private fun WebhookFormModal(
    initial: WebhookFormState?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    onSave: suspend (io.teslasync.shared.core.presentation.notifications.NotificationChannelInput) -> Result<NotificationChannel>,
    onPreview: suspend (String, String) -> Result<WebhookSignaturePreviewResult>,
) {
    val isEdit = initial?.id != null
    val scope = rememberCoroutineScope()

    var form by remember { mutableStateOf(initial ?: EMPTY_WEBHOOK_FORM) }
    var showSecret by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    val nameRequiredMessage = stringResource(R.string.translation_webhookChannels_form_nameRequired)
    val urlInvalidMessage = stringResource(R.string.translation_webhookChannels_form_urlInvalid)

    val title =
        if (isEdit) {
            stringResource(R.string.translation_webhookChannels_form_editTitle)
        } else {
            stringResource(R.string.translation_webhookChannels_form_addTitle)
        }

    Modal(
        onDismissRequest = onDismiss,
        title = title,
        accessibleName = title,
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = form.name,
                onValueChange = { form = form.copy(name = it) },
                label = stringResource(R.string.translation_webhookChannels_form_name),
                hint = stringResource(R.string.translation_webhookChannels_form_namePlaceholder), // parity:allow P1/S10 i18n key id
                required = true,
            )
            WebhookUrlField(url = form.url, onChange = { form = form.copy(url = it) })
            Select(
                options = WEBHOOK_HTTP_METHODS.map { SelectOption(it.wire, it.wire) },
                selectedValue = form.method.wire,
                onSelect = { form = form.copy(method = WebhookHttpMethod.from(it)) },
                label = stringResource(R.string.translation_webhookChannels_form_method),
            )
            WebhookSecretField(
                secret = form.secret,
                showSecret = showSecret,
                isEdit = isEdit,
                onChange = { form = form.copy(secret = it) },
                onToggleVisibility = { showSecret = !showSecret },
            )
            SignaturePreview(secret = form.secret, onPreview = onPreview)
            Toggle(
                checked = form.enabled,
                onCheckedChange = { form = form.copy(enabled = it) },
                label = stringResource(R.string.translation_webhookChannels_form_enabled),
            )
            WebhookFormErrorText(formError)
            WebhookFormActions(
                isEdit = isEdit,
                saving = saving,
                onCancel = onDismiss,
                onSubmit = {
                    val validation = validateWebhookForm(form.name, form.url)
                    formError =
                        when (validation) {
                            WebhookFormError.NameRequired -> nameRequiredMessage
                            WebhookFormError.UrlInvalid -> urlInvalidMessage
                            null -> null
                        }
                    if (validation == null) {
                        saving = true
                        scope.launch {
                            val result = onSave(toWebhookSavePayload(form))
                            saving = false
                            result.fold(
                                onSuccess = { onSaved() },
                                onFailure = { error -> formError = error.message ?: error.toString() },
                            )
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun WebhookUrlField(
    url: String,
    onChange: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Input(
            value = url,
            onValueChange = onChange,
            label = stringResource(R.string.translation_webhookChannels_form_url),
            hint = stringResource(R.string.translation_webhookChannels_form_urlPlaceholder), // parity:allow P1/S10 i18n key id
            keyboardType = KeyboardType.Uri,
            required = true,
        )
        HelperText(stringResource(R.string.translation_webhookChannels_form_urlHelp))
    }
}

@Composable
private fun WebhookSecretField(
    secret: String,
    showSecret: Boolean,
    isEdit: Boolean,
    onChange: (String) -> Unit,
    onToggleVisibility: () -> Unit,
) {
    val secretHint =
        if (isEdit) {
            stringResource(R.string.translation_webhookChannels_form_secretPlaceholderEdit) // parity:allow P1/S10 i18n key id
        } else {
            stringResource(R.string.translation_webhookChannels_form_secretPlaceholder) // parity:allow P1/S10 i18n key id
        }
    val toggleLabel =
        if (showSecret) {
            stringResource(R.string.translation_webhookChannels_form_hideSecret)
        } else {
            stringResource(R.string.translation_webhookChannels_form_showSecret)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Input(
                value = secret,
                onValueChange = onChange,
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_webhookChannels_form_secret),
                hint = secretHint,
                visualTransformation = if (showSecret) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardType = KeyboardType.Password,
            )
            IconButton(
                imageVector = if (showSecret) TeslaGlyphs.EyeOff else TeslaGlyphs.Eye,
                contentDescription = toggleLabel,
                onClick = onToggleVisibility,
                size = IconSize.Md,
            )
        }
        HelperText(stringResource(R.string.translation_webhookChannels_form_secretHelp))
    }
}

@Composable
private fun WebhookFormErrorText(message: String?) {
    if (message != null) BodyText(message, color = TeslaTokens.status.danger)
}

@Composable
private fun WebhookFormActions(
    isEdit: Boolean,
    saving: Boolean,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_webhookChannels_form_cancel),
            onClick = onCancel,
            variant = ButtonVariant.Ghost,
        )
        Button(
            label = webhookSaveLabel(isEdit, saving),
            onClick = onSubmit,
            variant = ButtonVariant.Primary,
            loading = saving,
        )
    }
}

@Composable
private fun webhookSaveLabel(
    isEdit: Boolean,
    saving: Boolean,
): String =
    when {
        saving -> stringResource(R.string.translation_webhookChannels_form_saving)
        isEdit -> stringResource(R.string.translation_webhookChannels_form_saveEdit)
        else -> stringResource(R.string.translation_webhookChannels_form_save)
    }

// ── Live signature preview ───────────────────────────────────────────────────────────────────────────────

/**
 * The live HMAC X-TeslaSync-Signature preview (web `SignaturePreview`). Debounces the secret 300 ms, then asks
 * the backend to sign [WEBHOOK_SAMPLE_BODY]; renders the loading / error / signature states inline with a copy
 * affordance. An empty secret shows the "add a secret" helper text (web empty branch).
 */
@Composable
private fun SignaturePreview(
    secret: String,
    onPreview: suspend (String, String) -> Result<WebhookSignaturePreviewResult>,
) {
    val trimmed = secret.trim()
    var signature by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(trimmed) {
        if (trimmed.isEmpty()) {
            signature = ""
            errorMessage = null
            loading = false
            return@LaunchedEffect
        }
        errorMessage = null
        loading = true
        delay(SIGNATURE_DEBOUNCE_MS)
        onPreview(secret, WEBHOOK_SAMPLE_BODY).fold(
            onSuccess = { signature = it.signature },
            onFailure = { error ->
                signature = ""
                errorMessage = error.message ?: error.toString()
            },
        )
        loading = false
    }

    if (trimmed.isEmpty()) {
        HelperText(stringResource(R.string.translation_webhookChannels_signature_empty))
        return
    }

    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(stringResource(R.string.translation_webhookChannels_signature_label))
            SignaturePreviewBody(signature = signature, errorMessage = errorMessage, loading = loading)
            HelperText(stringResource(R.string.translation_webhookChannels_signature_help))
        }
    }
}

@Composable
private fun SignaturePreviewBody(
    signature: String,
    errorMessage: String?,
    loading: Boolean,
) {
    when {
        loading && signature.isEmpty() ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(TEST_SPINNER_SIZE), strokeWidth = 2.dp)
                Caption(stringResource(R.string.translation_webhookChannels_signature_loading))
            }
        errorMessage != null ->
            BodyText(
                stringResource(R.string.translation_webhookChannels_signature_error, errorMessage),
                color = TeslaTokens.status.danger,
            )
        signature.isNotEmpty() ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CodeText(signature, modifier = Modifier.weight(1f))
                CopyButton(
                    text = signature,
                    copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                    copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                    iconOnly = true,
                )
            }
    }
}

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [WebhookToast] into a [ToastItem] with. */
private data class WebhookToastStrings(
    val enabled: String,
    val disabled: String,
    val toggleFailed: String,
    val deleted: String,
    val deleteFailed: String,
) {
    fun toItem(
        toast: WebhookToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            WebhookToast.Enabled -> ToastItem(id, enabled, Tone.Success)
            WebhookToast.Disabled -> ToastItem(id, disabled, Tone.Success)
            WebhookToast.ToggleFailed -> ToastItem(id, toggleFailed, Tone.Danger)
            WebhookToast.Deleted -> ToastItem(id, deleted, Tone.Success)
            WebhookToast.DeleteFailed -> ToastItem(id, deleteFailed, Tone.Danger)
        }
}

@Composable
private fun rememberWebhookToastStrings(): WebhookToastStrings =
    WebhookToastStrings(
        enabled = stringResource(R.string.translation_notifications_channels_toggledOn),
        disabled = stringResource(R.string.translation_notifications_channels_toggledOff),
        toggleFailed = stringResource(R.string.translation_notifications_channels_toggleFailed),
        deleted = stringResource(R.string.translation_notifications_channels_deleted),
        deleteFailed = stringResource(R.string.translation_notifications_channels_deleteFailed),
    )

/** Collects the view-model's [WebhookToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun WebhookToastPresenter(
    viewModel: WebhookChannelsSectionViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val strings = rememberWebhookToastStrings()
    val scope = rememberCoroutineScope()
    var nextId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = strings.toItem(toast, nextId++)
            if (queue.size >= MAX_TOASTS) queue.removeAt(0)
            queue.add(item)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private fun previewWebhooks(): List<NotificationChannel.Webhook> =
    listOf(
        NotificationChannel.Webhook(
            id = 1,
            name = "Discord #alerts",
            enabled = true,
            url = "https://discord.com/api/webhooks/123/abc",
            method = "POST",
        ),
        NotificationChannel.Webhook(
            id = 2,
            name = "Home Assistant",
            enabled = false,
            url = "https://ha.local/api/webhook/xyz",
            method = "PUT",
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun WebhookChannelsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WebhookChannelsSectionContent(
            channelsState = UiState(UiPhase.Content, previewWebhooks()),
            testResults =
                mapOf(
                    1L to WebhookTestResult(success = true, statusCode = 200, latencyMs = 142, signature = "sha256=abc123"),
                ),
            testingChannelId = null,
            onAdd = {},
            onEdit = {},
            onDelete = {},
            onToggle = {},
            onTest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun WebhookChannelsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WebhookChannelsSectionContent(
            channelsState = UiState(UiPhase.Empty, emptyList()),
            testResults = emptyMap(),
            testingChannelId = null,
            onAdd = {},
            onEdit = {},
            onDelete = {},
            onToggle = {},
            onTest = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun WebhookChannelsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WebhookChannelsSectionContent(
            channelsState = UiState(UiPhase.Loading),
            testResults = emptyMap(),
            testingChannelId = null,
            onAdd = {},
            onEdit = {},
            onDelete = {},
            onToggle = {},
            onTest = {},
            onRetry = {},
        )
    }
}
