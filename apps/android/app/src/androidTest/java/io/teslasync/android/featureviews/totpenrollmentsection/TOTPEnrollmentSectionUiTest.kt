package io.teslasync.android.featureviews.totpenrollmentsection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TOTPEnrollmentSectionContent] across every state the
 * web component renders (loading spinner, open-mode notice, not-enrolled, active, hard error with retry,
 * stale/offline), plus the three dialogs (enroll, backup-codes reveal, disable confirmation). Asserts the
 * rendered i18n strings are present, the loading spinner exposes its localized content description for
 * TalkBack, the QR image carries its accessible name, and the retry / close / download controls fire. Runs
 * under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the
 * projection/state logic, this covers the render + a11y.
 */
class TOTPEnrollmentSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun str(id: Int): String = context.getString(id)

    private fun session(
        activated: Boolean,
        lastUsedAt: String? = null,
        backupRemaining: Int = 0,
    ): UiState<TOTPStatus> =
        UiState(
            phase = UiPhase.Content,
            data = TOTPStatus.Session(activated = activated, lastUsedAt = lastUsedAt, backupCodesRemaining = backupRemaining),
            fetchedAt = 1L,
        )

    private fun enrollment(): TOTPEnrollment =
        TOTPEnrollment(
            secret = "JBSWY3DPEHPK3PXP",
            otpauthUri = "otpauth://totp/teslasync",
            // A 1×1 transparent PNG so the QR image decodes + exposes its accessible name.
            qrDataUri =
                "data:image/png;base64," +
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            backupCodes = listOf("AAAA-1111", "BBBB-2222"),
            expiresAt = "2026-01-01T00:15:00Z",
        )

    private fun setContent(
        status: UiState<TOTPStatus>,
        dialog: TOTPDialogUiState = TOTPDialogUiState(),
        onRetry: () -> Unit = {},
        onCloseDialog: () -> Unit = {},
        onDownloadCodes: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TOTPEnrollmentSectionContent(
                    status = status,
                    dialog = dialog,
                    onRetry = onRetry,
                    onCloseDialog = onCloseDialog,
                    onDownloadCodes = onDownloadCodes,
                )
            }
        }
    }

    @Test
    fun loadingShowsLocalizedSpinnerLabel() {
        setContent(UiState.loading())
        val loading = str(R.string.translation_settings_totp_loading)
        compose.onNodeWithText(loading).assertIsDisplayed()
        compose.onNodeWithContentDescription(loading).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_actions_enroll)).assertDoesNotExist()
    }

    @Test
    fun openModeShowsNoticeNotActions() {
        setContent(UiState(phase = UiPhase.Empty, data = TOTPStatus.Open, fetchedAt = 1L))
        compose.onNodeWithText(str(R.string.translation_settings_totp_openMode_message)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_title)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_actions_enroll)).assertDoesNotExist()
    }

    @Test
    fun notEnrolledShowsEnrollButtonAndPill() {
        setContent(session(activated = false))
        compose.onNodeWithText(str(R.string.translation_settings_totp_actions_enroll)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_status_notEnrolled)).assertIsDisplayed()
    }

    @Test
    fun activeShowsPillCountAndActions() {
        setContent(session(activated = true, lastUsedAt = "2026-01-01T12:00:00Z", backupRemaining = 8))
        compose.onNodeWithText(str(R.string.translation_settings_totp_status_active)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_lastUsed_label)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_backupCodesRemaining_label)).assertIsDisplayed()
        compose.onNodeWithText("8").assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_actions_regenerate)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_actions_disable)).assertIsDisplayed()
    }

    @Test
    fun activeNeverUsedShowsNeverLabel() {
        setContent(session(activated = true, lastUsedAt = null, backupRemaining = 4))
        compose.onNodeWithText(str(R.string.translation_settings_totp_lastUsed_never)).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFires() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(str(R.string.translation_common_retry)).performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsNoticeAndKeepsContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = TOTPStatus.Session(activated = true, backupCodesRemaining = 2),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(str(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_status_active)).assertIsDisplayed()
    }

    @Test
    fun enrollModalShowsSecretQrAndVerify() {
        setContent(
            session(activated = false),
            dialog = TOTPDialogUiState(step = TOTPDialogStep.Enroll, enrollment = enrollment()),
        )
        compose.onNodeWithText(str(R.string.translation_settings_totp_modal_manualLabel)).assertIsDisplayed()
        compose.onNodeWithText("JBSWY3DPEHPK3PXP").assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_modal_verify)).assertIsDisplayed()
        // a11y: the QR image exposes its localized accessible name.
        compose.onNodeWithContentDescription(str(R.string.translation_settings_totp_modal_qrAlt)).assertIsDisplayed()
    }

    @Test
    fun backupCodesModalShowsCodesAndFiresActions() {
        var closed = false
        var downloaded = false
        setContent(
            session(activated = true),
            dialog = TOTPDialogUiState(step = TOTPDialogStep.BackupCodes, revealedCodes = listOf("AAAA-1111", "BBBB-2222")),
            onCloseDialog = { closed = true },
            onDownloadCodes = { downloaded = true },
        )
        compose.onNodeWithText("AAAA-1111").assertIsDisplayed()
        compose.onNodeWithText("BBBB-2222").assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_backupCodes_download)).performClick()
        assertTrue(downloaded)
        compose.onNodeWithText(str(R.string.translation_settings_totp_backupCodes_done)).performClick()
        assertTrue(closed)
    }

    @Test
    fun disableConfirmShowsTypedGate() {
        setContent(session(activated = true), dialog = TOTPDialogUiState(showDisableConfirm = true))
        compose.onNodeWithText(str(R.string.translation_settings_totp_disable_title)).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_settings_totp_disable_typedLabel)).assertIsDisplayed()
    }
}
