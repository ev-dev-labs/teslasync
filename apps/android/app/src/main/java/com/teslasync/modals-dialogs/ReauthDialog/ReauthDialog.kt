// The native Jetpack Compose + Material 3 ReauthDialog modal/dialog — a parity port of the web sudo-style step-up
// reauth dialog (web/src/components/feedback/ReauthDialog.tsx). The web component is opened when the backend gates a
// sensitive action (401 + `SUDO_REQUIRED`); it is auth-mode aware, rendering either the credential form (Password +
// optional Authenticator tab, real submit) for forward-auth installs or the typed-confirmation form (type `CONFIRM`,
// local resolve) for open-mode installs. This port reproduces every one of those branches with native primitives.
//
// Every derivation flows through the pure [ReauthDialogProjection] + the [ReauthError]/[ReauthSubmitOutcome] model
// (ReauthDialogModel.kt); the composables are a thin render + form-state layer. The only strings are resolved from
// the i18n catalog (P1/S10) `sudo.*` keys (already shipped in res/values*/strings.xml) plus `common.close` for the
// Modal affordance — there is no English literal in shipped code. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// Web Root vs pure split: [ReauthDialog] is the production entry — it binds the shared P1/S8 reads (the auth-mode +
// TOTP-status [Resource]s the host collects from `AuthModeRepository` / `TOTPStore`), derives `mode` +
// `totpTabAvailable` via the projection, owns the ephemeral form state (web `useState`), and routes the submit
// through the host-supplied seam (no HTTP here). [ReauthDialogContent] is the stateless render layer — the preview +
// UI-test entry — so each branch is exercised off the Dialog window.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web `text-sm text-[var(--text-secondary)]` intro maps to
// [BodyText]; the helper `HelperText` maps to [HelperText]; the error `ErrorText` maps to [ErrorText]; the web tab
// strip / inputs / buttons map to the shared [Tabs] / [Input] / [Button]; web `gap-*` insets map to [Spacing].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ReauthDialog) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.reauthdialog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import kotlinx.coroutines.launch

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object ReauthDialogTestTags {
    const val ROOT: String = "reauth-dialog"
    const val PASSWORD: String = "reauth-password"
    const val TOTP: String = "reauth-totp"
    const val CONFIRM_TEXT: String = "reauth-confirm-text"
    const val ERROR: String = "reauth-error"
    const val CANCEL: String = "reauth-cancel"
    const val SUBMIT: String = "reauth-submit"
}

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless [ReauthDialogContent] takes plain strings and stays trivially previewable + UI-testable.
 * The three token-bearing strings are pre-interpolated with [TYPED_CONFIRMATION_TOKEN] here.
 */
data class ReauthDialogStrings(
    val title: String,
    val openModeTitle: String,
    val description: String,
    val openModeBody: String,
    val tabsLabel: String,
    val tabPassword: String,
    val tabTotp: String,
    val passwordLabel: String,
    val totpLabel: String,
    val typedConfirmationLabel: String,
    val helper: String,
    val cancel: String,
    val submit: String,
    val openModeSubmit: String,
    val close: String,
    val errorPasswordRequired: String,
    val errorTotpRequired: String,
    val errorTypedConfirmationMismatch: String,
    val errorNotConfigured: String,
    val errorInvalidPassword: String,
    val errorInvalidTotp: String,
    val errorUnknown: String,
)

/** Resolves every [ReauthDialogStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberReauthDialogStrings(): ReauthDialogStrings =
    ReauthDialogStrings(
        title = stringResource(R.string.translation_sudo_title),
        openModeTitle = stringResource(R.string.translation_sudo_openMode_title),
        description = stringResource(R.string.translation_sudo_description),
        openModeBody = stringResource(R.string.translation_sudo_openMode_body, TYPED_CONFIRMATION_TOKEN),
        tabsLabel = stringResource(R.string.translation_sudo_tabs_label),
        tabPassword = stringResource(R.string.translation_sudo_tabs_password),
        tabTotp = stringResource(R.string.translation_sudo_tabs_totp),
        passwordLabel = stringResource(R.string.translation_sudo_passwordLabel),
        totpLabel = stringResource(R.string.translation_sudo_totpLabel),
        typedConfirmationLabel = stringResource(R.string.translation_sudo_typedConfirmationLabel, TYPED_CONFIRMATION_TOKEN),
        helper = stringResource(R.string.translation_sudo_helper),
        cancel = stringResource(R.string.translation_sudo_cancel),
        submit = stringResource(R.string.translation_sudo_submit),
        openModeSubmit = stringResource(R.string.translation_sudo_openMode_submit),
        close = stringResource(R.string.translation_common_close),
        errorPasswordRequired = stringResource(R.string.translation_sudo_errors_passwordRequired),
        errorTotpRequired = stringResource(R.string.translation_sudo_errors_totpRequired),
        errorTypedConfirmationMismatch =
            stringResource(R.string.translation_sudo_errors_typedConfirmationMismatch, TYPED_CONFIRMATION_TOKEN),
        errorNotConfigured = stringResource(R.string.translation_sudo_errors_notConfigured),
        errorInvalidPassword = stringResource(R.string.translation_sudo_errors_invalidPassword),
        errorInvalidTotp = stringResource(R.string.translation_sudo_errors_invalidTotp),
        errorUnknown = stringResource(R.string.translation_sudo_errors_unknown),
    )

/**
 * Stateful entry point — the faithful port of the web `ReauthDialogRoot` + `ReauthDialog` pair. Binds the shared
 * P1/S8 reads, derives the mode + Authenticator-tab visibility through [ReauthDialogProjection], records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11), owns the ephemeral form state (web `useState`), routes the
 * submit through the host-supplied [onSubmitCredential] seam, and renders the modal. The owning host gates
 * composition (web `open`) and collects [authMode] / [totpStatus] from the shared holders.
 *
 * @param authMode the deployment auth-mode read (web `useSessionMonitor`); `open` selects the confirm variant.
 * @param totpStatus the per-user TOTP-status read (web `useTOTPStatus`); drives Authenticator-tab visibility.
 * @param onSubmit success handler — the host forwards the [SudoCredential] to retry the gated action (web `onSubmit`).
 * @param onCancel dismiss handler — the host rejects the pending challenge (web `onCancel`); ignored while in flight.
 * @param onSubmitCredential the credential-submit seam the host binds to its data layer (web `onSubmitCredential`);
 *   returns a non-throwing [ReauthSubmitOutcome] so the view never touches HTTP.
 * @param forceMode hard override for the mode (web `forceMode`); when unset the mode derives from [authMode].
 * @param challengeKey identifies the active challenge (web `path`); a change resets the form for the next challenge.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ReauthDialog(
    authMode: Resource<AuthModeResponse>?,
    totpStatus: Resource<TOTPStatus>?,
    onSubmit: (SudoCredential) -> Unit,
    onCancel: () -> Unit,
    onSubmitCredential: suspend (SudoSubmitBody) -> ReauthSubmitOutcome,
    modifier: Modifier = Modifier,
    forceMode: DialogMode? = null,
    challengeKey: String = "",
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordReauthDialogOpened(logger) }

    val mode = remember(authMode, forceMode) { ReauthDialogProjection.modeFor(authMode, forceMode) }
    val totpTabAvailable = remember(totpStatus) { ReauthDialogProjection.totpTabAvailable(totpStatus) }
    val strings = rememberReauthDialogStrings()
    val scope = rememberCoroutineScope()

    var activeTab by remember { mutableStateOf(ReauthTab.Password) }
    var password by remember { mutableStateOf("") }
    var totp by remember { mutableStateOf("") }
    var confirmText by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<ReauthError?>(null) }

    // Reset the form whenever a fresh challenge becomes active so the previous attempt never bleeds across
    // actions (web reset effect keyed on `open || path`).
    LaunchedEffect(challengeKey) {
        activeTab = ReauthTab.Password
        password = ""
        totp = ""
        confirmText = ""
        submitting = false
        error = null
    }

    // If the Authenticator tab disappears mid-flight, fall back to Password so the selection always matches a
    // visible tab (web effect on `[totpTabAvailable, activeTab]`).
    LaunchedEffect(totpTabAvailable, activeTab) {
        if (!totpTabAvailable && activeTab == ReauthTab.Totp) activeTab = ReauthTab.Password
    }

    val handleCancel: () -> Unit = { if (!submitting) onCancel() }

    val handleSubmit: () -> Unit = {
        if (!submitting) {
            when (mode) {
                DialogMode.Confirm -> {
                    val mismatch = ReauthDialogProjection.validateConfirm(confirmText)
                    if (mismatch != null) {
                        error = mismatch
                    } else {
                        onSubmit(SudoCredential(SudoMode.Open))
                    }
                }

                DialogMode.Credential -> {
                    val invalid = ReauthDialogProjection.validateCredential(activeTab, password, totp)
                    if (invalid != null) {
                        error = invalid
                    } else {
                        submitting = true
                        error = null
                        val tab = activeTab
                        scope.launch {
                            val body = ReauthDialogProjection.submitBody(tab, password, totp)
                            when (val outcome = onSubmitCredential(body)) {
                                is ReauthSubmitOutcome.Success -> onSubmit(outcome.credential)
                                is ReauthSubmitOutcome.Failure ->
                                    error = ReauthDialogProjection.mapSubmitFailure(outcome.code, outcome.message, tab)
                            }
                            submitting = false
                        }
                    }
                }
            }
        }
    }

    val title = if (mode == DialogMode.Confirm) strings.openModeTitle else strings.title

    Modal(
        onDismissRequest = handleCancel,
        modifier = modifier,
        title = title,
        accessibleName = title,
        closeLabel = strings.close,
        // Web `onClose={loading ? () => undefined : onCancel}`: the dialog cannot be dismissed in flight.
        dismissOnBackdrop = !submitting,
    ) {
        ReauthDialogContent(
            mode = mode,
            totpTabAvailable = totpTabAvailable,
            strings = strings,
            activeTab = activeTab,
            password = password,
            totp = totp,
            confirmText = confirmText,
            submitting = submitting,
            errorText = error?.let { resolveError(it, strings) },
            onActiveTabChange = { activeTab = it },
            onPasswordChange = { password = it },
            onTotpChange = { totp = ReauthDialogProjection.sanitizeTotp(it) },
            onConfirmTextChange = { confirmText = it },
            onCancel = handleCancel,
            onSubmit = handleSubmit,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the mode-specific intro, the credential
 * tabs + Password/Authenticator input + helper (or the typed-confirmation input), the optional error line, and the
 * end-aligned Cancel / submit actions. Every control carries an accessible label; all controls disable while
 * [submitting], and the submit action additionally shows a spinner.
 */
@Composable
fun ReauthDialogContent(
    mode: DialogMode,
    totpTabAvailable: Boolean,
    strings: ReauthDialogStrings,
    activeTab: ReauthTab,
    password: String,
    totp: String,
    confirmText: String,
    submitting: Boolean,
    errorText: String?,
    onActiveTabChange: (ReauthTab) -> Unit,
    onPasswordChange: (String) -> Unit,
    onTotpChange: (String) -> Unit,
    onConfirmTextChange: (String) -> Unit,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ReauthDialogTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BodyText(text = if (mode == DialogMode.Confirm) strings.openModeBody else strings.description)

        if (mode == DialogMode.Credential) {
            CredentialFields(
                totpTabAvailable = totpTabAvailable,
                strings = strings,
                activeTab = activeTab,
                password = password,
                totp = totp,
                submitting = submitting,
                onActiveTabChange = onActiveTabChange,
                onPasswordChange = onPasswordChange,
                onTotpChange = onTotpChange,
            )
        } else {
            Input(
                value = confirmText,
                onValueChange = onConfirmTextChange,
                modifier = Modifier.testTag(ReauthDialogTestTags.CONFIRM_TEXT),
                label = strings.typedConfirmationLabel,
                enabled = !submitting,
                required = true,
            )
        }

        if (errorText != null) {
            ErrorText(text = errorText, modifier = Modifier.testTag(ReauthDialogTestTags.ERROR))
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                modifier = Modifier.testTag(ReauthDialogTestTags.CANCEL),
                variant = ButtonVariant.Ghost,
                enabled = !submitting,
            )
            Button(
                label = if (mode == DialogMode.Confirm) strings.openModeSubmit else strings.submit,
                onClick = onSubmit,
                modifier = Modifier.testTag(ReauthDialogTestTags.SUBMIT),
                variant = ButtonVariant.Primary,
                enabled = !submitting,
                loading = submitting,
            )
        }
    }
}

/**
 * The credential-mode body — the Password/Authenticator tab strip, the active tab's input, and the reauth-lifetime
 * helper. Extracted so the parent [ReauthDialogContent] stays a flat mode switch.
 */
@Composable
private fun CredentialFields(
    totpTabAvailable: Boolean,
    strings: ReauthDialogStrings,
    activeTab: ReauthTab,
    password: String,
    totp: String,
    submitting: Boolean,
    onActiveTabChange: (ReauthTab) -> Unit,
    onPasswordChange: (String) -> Unit,
    onTotpChange: (String) -> Unit,
) {
    val tabs =
        buildList {
            add(TabItem(ReauthTab.Password.wire, strings.tabPassword))
            if (totpTabAvailable) add(TabItem(ReauthTab.Totp.wire, strings.tabTotp))
        }
    Tabs(
        tabs = tabs,
        selectedKey = activeTab.wire,
        onSelect = { key -> onActiveTabChange(ReauthTab.fromWire(key)) },
        modifier = Modifier.semantics { contentDescription = strings.tabsLabel },
    )

    if (activeTab == ReauthTab.Password) {
        Input(
            value = password,
            onValueChange = onPasswordChange,
            modifier = Modifier.testTag(ReauthDialogTestTags.PASSWORD),
            label = strings.passwordLabel,
            enabled = !submitting,
            required = true,
            keyboardType = KeyboardType.Password,
            visualTransformation = PasswordVisualTransformation(),
        )
    } else {
        Input(
            value = totp,
            onValueChange = onTotpChange,
            modifier = Modifier.testTag(ReauthDialogTestTags.TOTP),
            label = strings.totpLabel,
            enabled = !submitting,
            required = true,
            keyboardType = KeyboardType.Number,
        )
    }

    HelperText(text = strings.helper)
}

/** Maps a [ReauthError] to its already-localized message — each case is one `sudo.errors.*` string. */
private fun resolveError(
    error: ReauthError,
    strings: ReauthDialogStrings,
): String =
    when (error) {
        ReauthError.PasswordRequired -> strings.errorPasswordRequired
        ReauthError.TotpRequired -> strings.errorTotpRequired
        ReauthError.TypedConfirmationMismatch -> strings.errorTypedConfirmationMismatch
        ReauthError.NotConfigured -> strings.errorNotConfigured
        ReauthError.InvalidPassword -> strings.errorInvalidPassword
        ReauthError.InvalidTotp -> strings.errorInvalidTotp
        ReauthError.Unknown -> strings.errorUnknown
        is ReauthError.Raw -> error.message
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val previewStrings =
    ReauthDialogStrings(
        title = "Confirm your identity",
        openModeTitle = "Confirm sensitive action",
        description = "For your security, please re-enter your password or authenticator code before this action runs.",
        openModeBody = "This is a destructive action. Type CONFIRM to continue.",
        tabsLabel = "Reauth method",
        tabPassword = "Password",
        tabTotp = "Authenticator",
        passwordLabel = "Password",
        totpLabel = "Authenticator code",
        typedConfirmationLabel = "Type CONFIRM to confirm",
        helper = "Your reauth lasts 5 minutes; rapid follow-up actions will not re-prompt.",
        cancel = "Cancel",
        submit = "Confirm",
        openModeSubmit = "Continue",
        close = "Close",
        errorPasswordRequired = "Enter your password to continue.",
        errorTotpRequired = "Enter the 6-digit code from your authenticator.",
        errorTypedConfirmationMismatch = "Type CONFIRM exactly to confirm.",
        errorNotConfigured = "Step-up reauth is not configured on this server.",
        errorInvalidPassword = "Password did not match.",
        errorInvalidTotp = "Authenticator code was rejected.",
        errorUnknown = "Reauthentication failed.",
    )

@Preview(name = "Credential — password tab", showBackground = true, widthDp = 360)
@Composable
private fun ReauthDialogPasswordPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReauthDialogContent(
            mode = DialogMode.Credential,
            totpTabAvailable = true,
            strings = previewStrings,
            activeTab = ReauthTab.Password,
            password = "",
            totp = "",
            confirmText = "",
            submitting = false,
            errorText = null,
            onActiveTabChange = {},
            onPasswordChange = {},
            onTotpChange = {},
            onConfirmTextChange = {},
            onCancel = {},
            onSubmit = {},
        )
    }
}

@Preview(name = "Credential — authenticator tab", showBackground = true, widthDp = 360)
@Composable
private fun ReauthDialogTotpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReauthDialogContent(
            mode = DialogMode.Credential,
            totpTabAvailable = true,
            strings = previewStrings,
            activeTab = ReauthTab.Totp,
            password = "",
            totp = "123456",
            confirmText = "",
            submitting = false,
            errorText = null,
            onActiveTabChange = {},
            onPasswordChange = {},
            onTotpChange = {},
            onConfirmTextChange = {},
            onCancel = {},
            onSubmit = {},
        )
    }
}

@Preview(name = "Open mode — typed confirmation", showBackground = true, widthDp = 360)
@Composable
private fun ReauthDialogConfirmPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReauthDialogContent(
            mode = DialogMode.Confirm,
            totpTabAvailable = false,
            strings = previewStrings,
            activeTab = ReauthTab.Password,
            password = "",
            totp = "",
            confirmText = "CONFIRM",
            submitting = false,
            errorText = null,
            onActiveTabChange = {},
            onPasswordChange = {},
            onTotpChange = {},
            onConfirmTextChange = {},
            onCancel = {},
            onSubmit = {},
        )
    }
}

@Preview(name = "Credential — rejected credential", showBackground = true, widthDp = 360)
@Composable
private fun ReauthDialogErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReauthDialogContent(
            mode = DialogMode.Credential,
            totpTabAvailable = true,
            strings = previewStrings,
            activeTab = ReauthTab.Password,
            password = "hunter2",
            totp = "",
            confirmText = "",
            submitting = false,
            errorText = previewStrings.errorInvalidPassword,
            onActiveTabChange = {},
            onPasswordChange = {},
            onTotpChange = {},
            onConfirmTextChange = {},
            onCancel = {},
            onSubmit = {},
        )
    }
}

@Preview(name = "Credential — submitting (in flight)", showBackground = true, widthDp = 360)
@Composable
private fun ReauthDialogSubmittingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReauthDialogContent(
            mode = DialogMode.Credential,
            totpTabAvailable = true,
            strings = previewStrings,
            activeTab = ReauthTab.Password,
            password = "hunter2",
            totp = "",
            confirmText = "",
            submitting = true,
            errorText = null,
            onActiveTabChange = {},
            onPasswordChange = {},
            onTotpChange = {},
            onConfirmTextChange = {},
            onCancel = {},
            onSubmit = {},
        )
    }
}
