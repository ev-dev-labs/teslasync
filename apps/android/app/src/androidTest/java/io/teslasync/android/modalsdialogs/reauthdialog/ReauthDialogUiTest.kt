// Instrumented Compose UI + accessibility verification of [ReauthDialogContent] across the branches the web
// component renders (web/src/components/feedback/ReauthDialog.tsx): the credential form (Password / Authenticator
// tabs + inputs + helper), the Authenticator-tab visibility, the open-mode typed-confirmation form, the error line,
// the in-flight state (web `loading` — every control disables), and the Cancel / submit hand-offs. Every asserted
// label is the localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the offline
// `testReleaseUnitTest` gate covers the pure projection + error mapping.
package io.teslasync.android.modalsdialogs.reauthdialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ReauthDialogUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
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

    private fun setContent(
        mode: DialogMode = DialogMode.Credential,
        totpTabAvailable: Boolean = true,
        activeTab: ReauthTab = ReauthTab.Password,
        password: String = "",
        totp: String = "",
        confirmText: String = "",
        submitting: Boolean = false,
        errorText: String? = null,
        onActiveTabChange: (ReauthTab) -> Unit = {},
        onPasswordChange: (String) -> Unit = {},
        onTotpChange: (String) -> Unit = {},
        onConfirmTextChange: (String) -> Unit = {},
        onCancel: () -> Unit = {},
        onSubmit: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ReauthDialogContent(
                        mode = mode,
                        totpTabAvailable = totpTabAvailable,
                        strings = strings,
                        activeTab = activeTab,
                        password = password,
                        totp = totp,
                        confirmText = confirmText,
                        submitting = submitting,
                        errorText = errorText,
                        onActiveTabChange = onActiveTabChange,
                        onPasswordChange = onPasswordChange,
                        onTotpChange = onTotpChange,
                        onConfirmTextChange = onConfirmTextChange,
                        onCancel = onCancel,
                        onSubmit = onSubmit,
                    )
                }
            }
        }
    }

    @Test
    fun credentialPasswordTab_rendersIntroTabPasswordFieldHelperAndActions() {
        setContent()

        compose.onNodeWithText(strings.description).assertIsDisplayed()
        // The Authenticator tab is present (distinct from the "Authenticator code" input label).
        compose.onNodeWithText(strings.tabTotp).assertIsDisplayed()
        compose.onNodeWithTag(ReauthDialogTestTags.PASSWORD).assertIsDisplayed()
        compose.onNodeWithText(strings.helper).assertIsDisplayed()
        // The Cancel / submit actions expose their accessible names and are actionable (a11y label test).
        compose.onNodeWithTag(ReauthDialogTestTags.CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(ReauthDialogTestTags.SUBMIT).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.submit).assertIsDisplayed()
    }

    @Test
    fun authenticatorTabHiddenWhenUnavailable() {
        setContent(totpTabAvailable = false)

        compose.onNodeWithText(strings.tabTotp).assertDoesNotExist()
        compose.onNodeWithTag(ReauthDialogTestTags.PASSWORD).assertIsDisplayed()
    }

    @Test
    fun authenticatorTab_rendersTotpField() {
        setContent(activeTab = ReauthTab.Totp, totp = "123456")

        compose.onNodeWithTag(ReauthDialogTestTags.TOTP).assertIsDisplayed()
        compose.onNodeWithTag(ReauthDialogTestTags.PASSWORD).assertDoesNotExist()
    }

    @Test
    fun confirmMode_rendersTypedConfirmationInputBodyAndContinueWithNoTabs() {
        setContent(mode = DialogMode.Confirm, totpTabAvailable = false, confirmText = "CONFIRM")

        compose.onNodeWithText(strings.openModeBody).assertIsDisplayed()
        compose.onNodeWithTag(ReauthDialogTestTags.CONFIRM_TEXT).assertIsDisplayed()
        compose.onNodeWithText(strings.openModeSubmit).assertIsDisplayed()
        // No credential tabs or password field in the open-mode confirm variant.
        compose.onNodeWithText(strings.tabTotp).assertDoesNotExist()
        compose.onNodeWithTag(ReauthDialogTestTags.PASSWORD).assertDoesNotExist()
    }

    @Test
    fun errorLineRendersWhenPresent() {
        setContent(errorText = strings.errorInvalidPassword)

        compose.onNodeWithTag(ReauthDialogTestTags.ERROR).assertIsDisplayed()
        compose.onNodeWithText(strings.errorInvalidPassword).assertIsDisplayed()
    }

    @Test
    fun inFlightDisablesBothActions() {
        setContent(submitting = true, password = "hunter2")

        compose.onNodeWithTag(ReauthDialogTestTags.CANCEL).assertIsNotEnabled()
        compose.onNodeWithTag(ReauthDialogTestTags.SUBMIT).assertIsNotEnabled()
    }

    @Test
    fun submitInvokesOnSubmit() {
        var submitted = false
        setContent(password = "hunter2", onSubmit = { submitted = true })

        compose.onNodeWithTag(ReauthDialogTestTags.SUBMIT).performClick()
        assertTrue("tapping the submit action must invoke onSubmit", submitted)
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })

        compose.onNodeWithTag(ReauthDialogTestTags.CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Test
    fun typingPasswordInvokesOnPasswordChange() {
        var captured = ""
        setContent(onPasswordChange = { captured = it })

        compose.onNodeWithTag(ReauthDialogTestTags.PASSWORD).performTextInput("hunter2")
        assertEquals("hunter2", captured)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
