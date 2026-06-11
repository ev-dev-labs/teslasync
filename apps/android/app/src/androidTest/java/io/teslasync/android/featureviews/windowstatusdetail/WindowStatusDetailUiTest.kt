package io.teslasync.android.featureviews.windowstatusdetail

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [WindowStatusDetailContent] across the branches the
 * web component renders (web/src/features/admin/components/security-access/WindowStatusDetail.tsx): the
 * resolved four-card grid (each window labelled + state-valued), the loading skeleton (no values), the friendly
 * empty state, the hard-error retry surface, and the wide responsive-grid layout. Every asserted string is
 * resolved from the app's i18n resources so the test follows the device locale rather than hard-coding English.
 * Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection.
 */
class WindowStatusDetailUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    // fd=closed→Closed, fp=open→Open, rd=vent→Venting, rp=absent→Unknown — exercises all four accent roles.
    private fun mixedWindows() =
        SecurityWindows(
            fdWindow = JsonPrimitive("closed"),
            fpWindow = JsonPrimitive("open"),
            rdWindow = JsonPrimitive("vent"),
            rpWindow = null,
        )

    private fun setContent(
        state: UiState<SecurityWindows>,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    WindowStatusDetailContent(state = state, onRetry = {})
                }
            }
        }
    }

    @Test
    fun resolvedShowsHeadingAllFourLabelsAndStates() {
        setContent(UiState(phase = UiPhase.Content, data = mixedWindows()))

        // The always-visible heading (web <h2>).
        compose.onNodeWithText(string(R.string.translation_admin_security_windowDetail)).assertIsDisplayed()
        // Every window's position label (a11y label test).
        compose.onNodeWithText(string(R.string.translation_admin_security_window_fd)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_fp)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_rd)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_rp)).assertIsDisplayed()
        // Every parsed state value.
        compose.onNodeWithText(string(R.string.translation_admin_security_windowState_closed)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_windowState_open)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_windowState_venting)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_windowState_unknown)).assertIsDisplayed()
    }

    @Test
    fun eachCardExposesACombinedAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = mixedWindows()))

        // TalkBack reads "<position>: <state>" per card — verifies the per-card contentDescription.
        compose
            .onNodeWithContentDescription(
                "${string(R.string.translation_admin_security_window_fd)}: " +
                    string(R.string.translation_admin_security_windowState_closed),
            ).assertIsDisplayed()
        compose
            .onNodeWithContentDescription(
                "${string(R.string.translation_admin_security_window_rp)}: " +
                    string(R.string.translation_admin_security_windowState_unknown),
            ).assertIsDisplayed()
    }

    @Test
    fun loadingShowsHeadingButHidesValues() {
        setContent(UiState.loading())

        // Heading stays; skeleton chrome replaces the values, so no state value is present.
        compose.onNodeWithText(string(R.string.translation_admin_security_windowDetail)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_windowState_closed)).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_fd)).assertDoesNotExist()
    }

    @Test
    fun emptyShowsFriendlyMessageNotABlankBox() {
        setContent(UiState(phase = UiPhase.Empty, data = SecurityWindows()))

        compose.onNodeWithText(string(R.string.translation_common_noData)).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordance() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun wideLayoutRendersAllFourCards() {
        setContent(UiState(phase = UiPhase.Content, data = mixedWindows()), width = WIDE_WIDTH)

        compose.onNodeWithText(string(R.string.translation_admin_security_window_fd)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_fp)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_rd)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_security_window_rp)).assertIsDisplayed()
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val WIDE_WIDTH = 1080.dp
        val HOST_HEIGHT = 800.dp
    }
}
