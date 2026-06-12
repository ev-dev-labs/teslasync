// The native Jetpack Compose + Material 3 TOTPEnrollmentSection feature view — a parity port of
// web/src/features/settings/components/TOTPEnrollmentSection.tsx. The web component renders one GlassPanel with
// three top-level branches: a loading spinner ("Loading two-factor settings…"); an "open mode" notice
// (the deployment has no forward-auth header, so per-user TOTP cannot be tracked — an AlertTriangle marker plus
// a "requires forward-auth" helper); and the live section (a ShieldCheck marker, a title + subtitle, a status
// pill, and either an Enable-TOTP button when not enrolled, or the last-used stamp, the remaining backup-code
// count, and the Regenerate / Disable actions when active). Two modals (the QR + manual secret + 6-digit
// verify, then the one-time backup-codes reveal with copy + download) and a typed-confirmation disable dialog
// complete the flow.
//
// This native port keeps that composition and additionally surfaces the cache-then-network states the P3
// contract mandates for the server-backed status read: a spinner covers loading, a `QueryError` covers a hard
// failure with no cache, an offline notice + auto-keep covers stale/offline (the cached pill stays visible),
// the open-mode sentinel maps to the empty phase (the inline notice, never a blank box), and a live
// session drives the content. The view performs NO HTTP and never persists directly — it binds a
// [TOTPEnrollmentSectionViewModel] (over the shared S8 TOTP store/repository) and renders. Every visible string
// resolves through the i18n catalog (P1/S10) via `stringResource` (the `translation_settings_totp_*` keys plus
// the shared `translation_common_*` copy/close/offline/retry keys); nothing here carries English microcopy.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/TOTPEnrollmentSection) cannot form a valid Kotlin package and the file
// hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.totpenrollmentsection

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The web `<FadeIn delay={0.05}>` entry stagger (50 ms). */
private const val FADE_DELAY_MS = 50

/** The QR image footprint (web `<img width={224} height={224} />`). */
private val QR_SIZE: Dp = 224.dp

/** Maximum simultaneously-stacked toasts (web caps the toast region). */
private const val MAX_TOASTS = 3

/** Toast visible duration before auto-dismiss. */
private const val TOAST_DURATION_MS = 4_000L

/** The MIME type the backup-codes download writes (web `Blob([...], { type: 'text/plain' })`). */
private const val MIME_TEXT_PLAIN = "text/plain"

/**
 * The sentinel the user must type to confirm disabling — a verbatim token (NOT display copy), exactly the web
 * `requireTypedConfirmation="DISABLE"`. The localized prompt around it is `disable.typedLabel`.
 */
private const val DISABLE_CONFIRMATION = "DISABLE"

/** The backup-codes reveal lays the codes out two-up (web `grid-cols-2`). */
private const val BACKUP_CODES_COLUMNS = 2

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * Stateful entry point for the TOTPEnrollmentSection surface. Binds the [source] (the shared S8 TOTP feed +
 * mutations) into a [TOTPEnrollmentSectionViewModel], records the one-shot PII-safe `view.opened` diagnostic,
 * owns the toast queue + the Storage-Access-Framework backup-codes download, and renders every section +
 * lifecycle state. A host supplies [source] (an adapter over the shared TOTP store/repository) and a unique
 * [instanceKey] per placement. This view performs no HTTP.
 */
@Composable
fun TOTPEnrollmentSection(
    source: TOTPEnrollmentSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TOTPEnrollmentSectionRegistration.SLUG,
) {
    val viewModel: TOTPEnrollmentSectionViewModel =
        viewModel(key = instanceKey, factory = TOTPEnrollmentSectionViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val status by viewModel.status.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()

    val context = LocalContext.current
    var pendingDownload by remember { mutableStateOf<String?>(null) }
    val createDocument =
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(MIME_TEXT_PLAIN)) { uri ->
            val content = pendingDownload
            if (uri != null && content != null) {
                runCatching {
                    context.contentResolver.openOutputStream(uri)?.use { stream -> stream.write(content.toByteArray()) }
                }
            }
            pendingDownload = null
        }
    val fileHeader = stringResource(R.string.translation_settings_totp_backupCodes_fileHeader)

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    TOTPToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        TOTPEnrollmentSectionContent(
            status = status,
            dialog = dialog,
            onRetry = viewModel::retry,
            onEnroll = viewModel::beginEnroll,
            onVerifyCodeChange = viewModel::verifyCodeChanged,
            onSubmitVerify = viewModel::submitVerify,
            onCloseDialog = viewModel::closeDialog,
            onRegenerate = viewModel::beginRegenerate,
            onRequestDisable = viewModel::requestDisable,
            onCancelDisable = viewModel::cancelDisable,
            onConfirmDisable = viewModel::confirmDisable,
            onDownloadCodes = {
                val codes = dialog.revealedCodes
                if (!codes.isNullOrEmpty()) {
                    pendingDownload = TOTPEnrollmentSectionProjection.backupCodesFileContent(fileHeader, codes)
                    createDocument.launch(BACKUP_CODES_FILE_NAME)
                }
            },
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Renders the panel
 * (a spinner while loading, a `QueryError` with retry on a hard failure with no cache, the open-mode
 * notice for the empty phase, otherwise the live session) plus the enroll modal, the backup-codes reveal,
 * and the disable confirmation, each gated on [dialog]. A stale/offline cached snapshot keeps the section
 * visible with an offline notice + retry.
 */
@Composable
fun TOTPEnrollmentSectionContent(
    status: UiState<TOTPStatus>,
    dialog: TOTPDialogUiState,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    onEnroll: () -> Unit = {},
    onVerifyCodeChange: (String) -> Unit = {},
    onSubmitVerify: () -> Unit = {},
    onCloseDialog: () -> Unit = {},
    onRegenerate: () -> Unit = {},
    onRequestDisable: () -> Unit = {},
    onCancelDisable: () -> Unit = {},
    onConfirmDisable: () -> Unit = {},
    onDownloadCodes: () -> Unit = {},
) {
    FadeIn(delayMs = FADE_DELAY_MS, modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            when {
                status.isLoading -> LoadingRow()
                status.isError ->
                    QueryError(
                        kind = queryErrorKindOf(status),
                        resourceName = stringResource(R.string.translation_settings_totp_title),
                        onRetry = onRetry,
                    )
                else -> {
                    if (status.isOffline) {
                        OfflineNotice(onRetry = onRetry)
                        Spacer(Modifier.height(Spacing.md))
                    }
                    when (val data = status.data) {
                        is TOTPStatus.Open -> OpenModeContent()
                        is TOTPStatus.Session ->
                            SessionContent(
                                display = TOTPEnrollmentSectionProjection.projectSession(data),
                                dialog = dialog,
                                onEnroll = onEnroll,
                                onRegenerate = onRegenerate,
                                onRequestDisable = onRequestDisable,
                            )
                        null -> OpenModeContent()
                    }
                }
            }
        }
    }

    if (dialog.step == TOTPDialogStep.Enroll && dialog.enrollment != null) {
        EnrollModal(
            enrollment = dialog.enrollment,
            verifyCode = dialog.verifyCode,
            verifyError = dialog.verifyError,
            verifyPending = dialog.verifyPending,
            onVerifyCodeChange = onVerifyCodeChange,
            onSubmitVerify = onSubmitVerify,
            onClose = onCloseDialog,
        )
    }
    if (dialog.step == TOTPDialogStep.BackupCodes && dialog.revealedCodes != null) {
        BackupCodesModal(
            codes = dialog.revealedCodes,
            onDownload = onDownloadCodes,
            onClose = onCloseDialog,
        )
    }
    if (dialog.showDisableConfirm) {
        DisableConfirmDialog(
            revokePending = dialog.revokePending,
            onConfirm = onConfirmDisable,
            onCancel = onCancelDisable,
        )
    }
}

/** The loading branch — a small spinner beside the localized "Loading two-factor settings…" (web `Spinner`). */
@Composable
private fun LoadingRow() {
    val loading = stringResource(R.string.translation_settings_totp_loading)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Spinner(size = SpinnerSize.Sm, accessibleLabel = loading)
        BodyText(loading)
    }
}

/**
 * The open-mode notice — the surface's empty state (web `data-testid="totp-section-open-mode"`). An
 * AlertTriangle marker, the section title, and the "requires forward-auth" helper; never a blank box.
 */
@Composable
private fun ColumnScope.OpenModeContent() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconBox(tone = IconBoxTone.Warning) {
            Icon(TOTPEnrollmentSectionGlyphs.AlertTriangle, contentDescription = null)
        }
        Spacer(Modifier.width(Spacing.sm))
        Heading(stringResource(R.string.translation_settings_totp_title), level = HeadingLevel.Panel)
    }
    Spacer(Modifier.height(Spacing.sm))
    HelperText(stringResource(R.string.translation_settings_totp_openMode_message))
}

/**
 * The live session branch (web `data-testid="totp-section"`): the ShieldCheck marker, the title + subtitle,
 * the status pill, then the active-credential body (last-used + backup count + Regenerate/Disable) or the
 * not-enrolled body (Enable-TOTP button + hint).
 */
@Composable
private fun ColumnScope.SessionContent(
    display: TOTPSessionDisplay,
    dialog: TOTPDialogUiState,
    onEnroll: () -> Unit,
    onRegenerate: () -> Unit,
    onRequestDisable: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            IconBox(tone = if (display.activated) IconBoxTone.Success else IconBoxTone.Info) {
                Icon(TOTPEnrollmentSectionGlyphs.ShieldCheck, contentDescription = null)
            }
            Spacer(Modifier.width(Spacing.sm))
            Column(modifier = Modifier.weight(1f)) {
                Heading(stringResource(R.string.translation_settings_totp_title), level = HeadingLevel.Panel)
                HelperText(stringResource(R.string.translation_settings_totp_subtitle))
            }
        }
        Spacer(Modifier.width(Spacing.sm))
        Badge(
            text =
                if (display.activated) {
                    stringResource(R.string.translation_settings_totp_status_active)
                } else {
                    stringResource(R.string.translation_settings_totp_status_notEnrolled)
                },
            variant = if (display.activated) BadgeVariant.Success else BadgeVariant.Neutral,
        )
    }
    Spacer(Modifier.height(Spacing.md))
    if (display.activated) {
        ActiveCredentialBody(
            display = display,
            regeneratePending = dialog.regeneratePending,
            onRegenerate = onRegenerate,
            onRequestDisable = onRequestDisable,
        )
    } else {
        NotEnrolledBody(enrollPending = dialog.enrollPending, onEnroll = onEnroll)
    }
}

/** The active-credential body: a last-used / backup-count pair, then the Regenerate + Disable actions. */
@Composable
private fun ColumnScope.ActiveCredentialBody(
    display: TOTPSessionDisplay,
    regeneratePending: Boolean,
    onRegenerate: () -> Unit,
    onRequestDisable: () -> Unit,
) {
    val formatLastUsed = rememberLastUsedFormatter()
    val lastUsed = display.lastUsedAtIso?.let(formatLastUsed) ?: stringResource(R.string.translation_settings_totp_lastUsed_never)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Column(modifier = Modifier.weight(1f)) {
            FieldLabelText(stringResource(R.string.translation_settings_totp_lastUsed_label))
            BodyText(lastUsed)
        }
        Column(modifier = Modifier.weight(1f)) {
            FieldLabelText(stringResource(R.string.translation_settings_totp_backupCodesRemaining_label))
            BodyText(display.backupCodesRemaining.toString())
        }
    }
    Spacer(Modifier.height(Spacing.md))
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label = stringResource(R.string.translation_settings_totp_actions_regenerate),
            onClick = onRegenerate,
            variant = ButtonVariant.Ghost,
            leadingIcon = TOTPEnrollmentSectionGlyphs.RefreshCw,
            loading = regeneratePending,
        )
        Button(
            label = stringResource(R.string.translation_settings_totp_actions_disable),
            onClick = onRequestDisable,
            variant = ButtonVariant.Danger,
            leadingIcon = TOTPEnrollmentSectionGlyphs.Trash2,
        )
    }
}

/** The not-enrolled body: the Enable-TOTP button plus the authenticator-app compatibility hint. */
@Composable
private fun ColumnScope.NotEnrolledBody(
    enrollPending: Boolean,
    onEnroll: () -> Unit,
) {
    Button(
        label = stringResource(R.string.translation_settings_totp_actions_enroll),
        onClick = onEnroll,
        variant = ButtonVariant.Primary,
        leadingIcon = TOTPEnrollmentSectionGlyphs.KeyRound,
        loading = enrollPending,
    )
    Spacer(Modifier.height(Spacing.sm))
    HelperText(stringResource(R.string.translation_settings_totp_actions_enrollHint))
}

/** Stale/offline notice — a warning chip plus a retry affordance shown over the kept cached content. */
@Composable
private fun ColumnScope.OfflineNotice(onRetry: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Badge(text = stringResource(R.string.translation_common_offline), variant = BadgeVariant.Warning, dot = true)
        Button(
            label = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The enroll modal: scan instructions, the decoded QR, the manual secret with copy, and the 6-digit verify. */
@Composable
private fun EnrollModal(
    enrollment: TOTPEnrollment,
    verifyCode: String,
    verifyError: TOTPVerifyError?,
    verifyPending: Boolean,
    onVerifyCodeChange: (String) -> Unit,
    onSubmitVerify: () -> Unit,
    onClose: () -> Unit,
) {
    val qr = remember(enrollment.qrDataUri) { decodeQrDataUri(enrollment.qrDataUri) }
    Modal(
        onDismissRequest = onClose,
        title = stringResource(R.string.translation_settings_totp_modal_enrollTitle),
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BodyText(stringResource(R.string.translation_settings_totp_modal_scanInstructions))
            if (qr != null) {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Image(
                        bitmap = qr,
                        contentDescription = stringResource(R.string.translation_settings_totp_modal_qrAlt),
                        modifier = Modifier.size(QR_SIZE),
                    )
                }
            }
            Column {
                FieldLabelText(stringResource(R.string.translation_settings_totp_modal_manualLabel))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    CodeText(enrollment.secret, modifier = Modifier.weight(1f))
                    CopyButton(
                        text = enrollment.secret,
                        copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                        copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                        iconOnly = true,
                    )
                }
            }
            Input(
                value = verifyCode,
                onValueChange = onVerifyCodeChange,
                label = stringResource(R.string.translation_settings_totp_modal_codeLabel),
                errorText = verifyError?.let { verifyErrorText(it) },
                enabled = !verifyPending,
                keyboardType = KeyboardType.Number,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    label = stringResource(R.string.translation_settings_totp_modal_cancel),
                    onClick = onClose,
                    variant = ButtonVariant.Ghost,
                    enabled = !verifyPending,
                )
                Button(
                    label = stringResource(R.string.translation_settings_totp_modal_verify),
                    onClick = onSubmitVerify,
                    variant = ButtonVariant.Primary,
                    loading = verifyPending,
                )
            }
        }
    }
}

/** The one-time backup-codes reveal: the warning, the two-up code grid, then Download / Copy / Done. */
@Composable
private fun BackupCodesModal(
    codes: List<String>,
    onDownload: () -> Unit,
    onClose: () -> Unit,
) {
    Modal(
        onDismissRequest = onClose,
        title = stringResource(R.string.translation_settings_totp_backupCodes_title),
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BodyText(stringResource(R.string.translation_settings_totp_backupCodes_warning))
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                codes.chunked(BACKUP_CODES_COLUMNS).forEach { rowCodes ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        rowCodes.forEach { code -> CodeText(code, modifier = Modifier.weight(1f)) }
                        repeat(BACKUP_CODES_COLUMNS - rowCodes.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    label = stringResource(R.string.translation_settings_totp_backupCodes_download),
                    onClick = onDownload,
                    variant = ButtonVariant.Ghost,
                    leadingIcon = TOTPEnrollmentSectionGlyphs.Download,
                )
                CopyButton(
                    text = codes.joinToString("\n"),
                    copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                    copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                )
                Button(
                    label = stringResource(R.string.translation_settings_totp_backupCodes_done),
                    onClick = onClose,
                    variant = ButtonVariant.Primary,
                )
            }
        }
    }
}

/** The disable confirmation — a typed-confirmation ("DISABLE") danger dialog (web `ConfirmDialog`). */
@Composable
private fun DisableConfirmDialog(
    revokePending: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_settings_totp_disable_title),
        message = stringResource(R.string.translation_settings_totp_disable_message),
        confirmLabel = stringResource(R.string.translation_settings_totp_disable_confirm),
        cancelLabel = stringResource(R.string.translation_settings_totp_disable_cancel),
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Danger,
        loading = revokePending,
        requireTypedConfirmation = DISABLE_CONFIRMATION,
        typedConfirmationLabel = stringResource(R.string.translation_settings_totp_disable_typedLabel),
        closeLabel = stringResource(R.string.translation_common_close),
    )
}

/** Maps a [TOTPVerifyError] to its localized inline message (P1/S10). */
@Composable
private fun verifyErrorText(error: TOTPVerifyError): String =
    stringResource(
        when (error) {
            TOTPVerifyError.CodeIncomplete -> R.string.translation_settings_totp_errors_codeLength
            TOTPVerifyError.InvalidCode -> R.string.translation_settings_totp_errors_invalidCode
            TOTPVerifyError.RateLimited -> R.string.translation_settings_totp_errors_rateLimited
            TOTPVerifyError.EnrollmentExpired -> R.string.translation_settings_totp_errors_enrollmentExpired
            TOTPVerifyError.Generic -> R.string.translation_settings_totp_errors_verifyGeneric
        },
    )

/**
 * Collects the view-model's typed toasts, maps each to a localized + toned [ToastItem], enqueues it (capped at
 * [MAX_TOASTS]), and auto-dismisses after [TOAST_DURATION_MS] — the native analogue of the web `useToast`.
 */
@Composable
private fun TOTPToastPresenter(
    viewModel: TOTPEnrollmentSectionViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val verified = stringResource(R.string.translation_settings_totp_toasts_verified)
    val disabled = stringResource(R.string.translation_settings_totp_toasts_disabled)
    val regenerated = stringResource(R.string.translation_settings_totp_toasts_backupRegenerated)
    val enrollFailed = stringResource(R.string.translation_settings_totp_errors_enroll)
    val revokeFailed = stringResource(R.string.translation_settings_totp_errors_disable)
    val regenerateFailed = stringResource(R.string.translation_settings_totp_errors_regenerate)
    val scope = rememberCoroutineScope()
    var seq by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, verified, disabled, regenerated, enrollFailed, revokeFailed, regenerateFailed) {
        viewModel.toasts.collect { toast ->
            val item =
                when (toast) {
                    TOTPToast.Verified -> ToastItem(seq++, verified, Tone.Success)
                    TOTPToast.Disabled -> ToastItem(seq++, disabled, Tone.Success)
                    TOTPToast.BackupRegenerated -> ToastItem(seq++, regenerated, Tone.Success)
                    TOTPToast.EnrollFailed -> ToastItem(seq++, enrollFailed, Tone.Danger)
                    TOTPToast.RevokeFailed -> ToastItem(seq++, revokeFailed, Tone.Danger)
                    TOTPToast.RegenerateFailed -> ToastItem(seq++, regenerateFailed, Tone.Danger)
                }
            queue.add(item)
            if (queue.size > MAX_TOASTS) queue.removeAt(0)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

/** Classifies a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.Network, ErrorKind.CircuitOpen -> QueryErrorKind.Offline
        else -> QueryErrorKind.Network
    }

/**
 * A locale-aware ISO-8601 → medium date-time formatter (web `useDateFormat().formatDateTime`). A blank or
 * unparseable stamp yields the em dash so the row is never blank.
 */
@Composable
private fun rememberLastUsedFormatter(): (String) -> String {
    val locale = Locale.getDefault()
    val zone = ZoneId.systemDefault()
    return remember(locale, zone) {
        val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale).withZone(zone)
        val format: (String) -> String = { raw ->
            if (raw.isBlank()) EM_DASH else runCatching { formatter.format(Instant.parse(raw)) }.getOrDefault(raw)
        }
        format
    }
}

/**
 * Decodes a `data:` URI (web `enrollment.qr_data_uri`) into an [ImageBitmap] for inline rendering, or `null`
 * when the URI carries no payload / fails to decode (the manual-entry secret remains as the fallback).
 */
private fun decodeQrDataUri(dataUri: String): ImageBitmap? {
    val comma = dataUri.indexOf(',')
    if (comma < 0) return null
    val encoded = dataUri.substring(comma + 1)
    return runCatching {
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
    }.getOrNull()
}

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(name = "TOTP — not enrolled", showBackground = true)
@Composable
private fun TOTPEnrollmentSectionNotEnrolledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOTPEnrollmentSectionContent(
            status = UiState(phase = UiPhase.Content, data = TOTPStatus.Session(activated = false), fetchedAt = 1L),
            dialog = TOTPDialogUiState(),
        )
    }
}

@Preview(name = "TOTP — active", showBackground = true)
@Composable
private fun TOTPEnrollmentSectionActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOTPEnrollmentSectionContent(
            status =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        TOTPStatus.Session(
                            activated = true,
                            lastUsedAt = "2026-01-01T12:00:00Z",
                            backupCodesRemaining = 8,
                        ),
                    fetchedAt = 1L,
                ),
            dialog = TOTPDialogUiState(),
        )
    }
}

@Preview(name = "TOTP — open mode (empty)", showBackground = true)
@Composable
private fun TOTPEnrollmentSectionOpenModePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TOTPEnrollmentSectionContent(
            status = UiState(phase = UiPhase.Empty, data = TOTPStatus.Open, fetchedAt = 1L),
            dialog = TOTPDialogUiState(),
        )
    }
}
