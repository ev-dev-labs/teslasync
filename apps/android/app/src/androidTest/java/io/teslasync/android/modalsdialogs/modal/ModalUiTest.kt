// Instrumented Compose UI + accessibility verification of [Modal] across the branches the web component renders
// (web/src/components/ui/Modal.tsx): the `open` gate, the titled dialog (heading + localized close affordance +
// hosted body), the anonymous dialog (no header / no close button, named only by `ariaLabel`), and the close
// hand-off. Every asserted label is the copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the
// offline `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.modal

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val noOpLogger =
        object : Logger {
            override fun log(
                level: LogLevel,
                event: String,
                fields: Map<String, String>,
            ) = Unit
        }

    private fun setContent(
        open: Boolean = true,
        title: String? = "Battery health",
        ariaLabel: String? = null,
        size: ModalSize = ModalSize.Md,
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Modal(
                    open = open,
                    onClose = onClose,
                    title = title,
                    ariaLabel = ariaLabel,
                    size = size,
                    logger = noOpLogger,
                ) {
                    Text(BODY)
                }
            }
        }
    }

    @Test
    fun titledModalRendersHeadingCloseAffordanceAndBody() {
        setContent(title = "Battery health")

        compose.onNodeWithTag(ModalTestTags.ROOT).assertIsDisplayed()
        compose.onNodeWithText("Battery health").assertIsDisplayed()
        compose.onNodeWithText(BODY).assertIsDisplayed()
        // The close control exposes its localized accessible name and is actionable (a11y label test).
        compose.onNodeWithContentDescription(CLOSE_LABEL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun closeAffordanceInvokesOnClose() {
        var closed = false
        setContent(onClose = { closed = true })

        compose.onNodeWithContentDescription(CLOSE_LABEL).performClick()
        assertTrue("tapping the close affordance must invoke onClose", closed)
    }

    @Test
    fun anonymousModalShowsBodyWithoutHeaderOrCloseButton() {
        setContent(title = null, ariaLabel = "Battery details")

        compose.onNodeWithTag(ModalTestTags.ROOT).assertIsDisplayed()
        compose.onNodeWithText(BODY).assertIsDisplayed()
        // No visible title and — like the web anonymous Modal — no header, hence no close button.
        compose.onNodeWithText("Battery health").assertDoesNotExist()
        compose.onNodeWithContentDescription(CLOSE_LABEL).assertDoesNotExist()
    }

    @Test
    fun closedModalRendersNothing() {
        setContent(open = false)

        compose.onNodeWithTag(ModalTestTags.ROOT).assertDoesNotExist()
        compose.onNodeWithText(BODY).assertDoesNotExist()
    }

    private companion object {
        const val BODY = "Modal body content"

        // The localized `common.close` copy (values/strings.xml translation_common_close) the atomic Modal applies as
        // the close button's accessible name.
        const val CLOSE_LABEL = "Close"
    }
}
