package io.teslasync.android.sharedsurfaces.toast

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Toast shared surface across the states the
 * web source renders (web/src/components/feedback/Toast.tsx): each of the four tone variants, a toast
 * with a navigation ("View →") action, a toast with a callback ("Undo") action, the dismiss control
 * (and its TalkBack label, the web `aria-label="Dismiss notification"`), and the empty (invisible) host.
 * It asserts the rendered i18n + content strings and that the action and dismiss controls invoke their
 * callbacks with the toast id. Every render is built with reduced motion so the entry animation never
 * keeps the test clock busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers
 * the pure model + the ViewModel, this covers the render.
 */
class ToastUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun setSurface(
        state: ToastHostState,
        onAction: (ToastMessage) -> Unit = {},
        onDismiss: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ToastHostContent(
                        state = state,
                        reducedMotion = true,
                        onAction = onAction,
                        onDismiss = onDismiss,
                    )
                }
            }
        }
    }

    private fun label(resId: Int) = context.getString(resId)

    private fun toast(
        id: String,
        tone: ToastTone,
        title: String,
        message: String? = null,
        action: ToastAction? = null,
    ) = ToastMessage(id = id, tone = tone, title = title, message = message, action = action)

    @Test
    fun successToastRendersTitleMessageAndDismiss() {
        setSurface(
            ToastHostState(
                listOf(toast("a", ToastTone.Success, title = "Settings saved", message = "Your changes are live.")),
            ),
        )

        compose.onNodeWithTag(TOAST_CARD_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Settings saved").assertIsDisplayed()
        compose.onNodeWithText("Your changes are live.").assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_a11y_dismissNotification)).assertIsDisplayed()
    }

    @Test
    fun everyToneVariantRendersACard() {
        setSurface(
            ToastHostState(
                listOf(
                    toast("s", ToastTone.Success, title = "Saved"),
                    toast("e", ToastTone.Error, title = "Failed"),
                    toast("i", ToastTone.Info, title = "Heads up"),
                    toast("w", ToastTone.Warning, title = "Careful"),
                ),
            ),
        )

        assertEquals(4, compose.onAllNodesWithTag(TOAST_CARD_TEST_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText("Failed").assertIsDisplayed()
        compose.onNodeWithText("Careful").assertIsDisplayed()
    }

    @Test
    fun navigationActionRendersWithArrowAndInvokesOnAction() {
        val acted = mutableListOf<String>()
        val item = toast("a", ToastTone.Info, title = "Battery alert", action = ToastAction.Navigate("View", "/battery"))
        setSurface(ToastHostState(listOf(item)), onAction = { acted += it.id })

        compose.onNodeWithText("View \u2192").assertIsDisplayed()
        compose.onNodeWithText("View \u2192").performClick()
        assertEquals(listOf("a"), acted)
    }

    @Test
    fun callbackActionInvokesOnAction() {
        val acted = mutableListOf<String>()
        val item = toast("a", ToastTone.Warning, title = "Rule deleted", action = ToastAction.Callback("Undo", {}))
        setSurface(ToastHostState(listOf(item)), onAction = { acted += it.id })

        compose.onNodeWithText("Undo").performClick()
        assertEquals(listOf("a"), acted)
    }

    @Test
    fun dismissControlInvokesOnDismissWithTheToastId() {
        val dismissed = mutableListOf<String>()
        setSurface(
            ToastHostState(listOf(toast("a", ToastTone.Info, title = "Heads up"))),
            onDismiss = { dismissed += it },
        )

        compose.onNodeWithContentDescription(label(R.string.translation_a11y_dismissNotification)).performClick()
        assertEquals(listOf("a"), dismissed)
    }

    @Test
    fun dismissControlIsLabelledForTalkBack() {
        setSurface(ToastHostState(listOf(toast("a", ToastTone.Info, title = "Heads up"))))

        compose.onNodeWithContentDescription(label(R.string.translation_a11y_dismissNotification)).assertIsDisplayed()
    }

    @Test
    fun emptyHostRendersTheContainerWithoutCards() {
        setSurface(ToastHostState.Empty)

        compose.onNodeWithTag(TOAST_HOST_TEST_TAG).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag(TOAST_CARD_TEST_TAG).fetchSemanticsNodes().size)
    }
}
