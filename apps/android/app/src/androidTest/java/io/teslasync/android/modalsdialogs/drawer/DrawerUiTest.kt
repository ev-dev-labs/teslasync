// Instrumented Compose UI + accessibility verification of [DrawerSheet] across the branches the web component
// renders (web/src/components/ui/Drawer.tsx): the optional title header (title + close), the scrollable body,
// and the optional footer, plus the close hand-off. Every asserted label is the localized copy the surface
// exposes to TalkBack (the close affordance's accessible name — the a11y label test). Runs under
// `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + side mapping.
package io.teslasync.android.modalsdialogs.drawer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class DrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings = DrawerStrings(close = "Close", panel = "Panel")

    private fun display(
        side: DrawerSide = DrawerSide.End,
        showHeader: Boolean = true,
        showFooter: Boolean = false,
        accessibleName: String = "Filters",
    ) = DrawerDisplay(side = side, showHeader = showHeader, showFooter = showFooter, accessibleName = accessibleName)

    private fun setSheet(
        display: DrawerDisplay = display(),
        title: String? = "Filters",
        footer: (@Composable () -> Unit)? = null,
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    DrawerSheet(
                        display = display,
                        strings = strings,
                        title = title,
                        onClose = onClose,
                        physicalRight = true,
                        footer = footer,
                    ) {
                        BodyText(BODY_TEXT)
                    }
                }
            }
        }
    }

    @Test
    fun titleHeaderAndCloseActionRenderWithTitle() {
        setSheet()

        compose.onNodeWithTag(DrawerTestTags.TITLE).assertIsDisplayed()
        compose.onNodeWithText("Filters").assertIsDisplayed()
        // The close affordance exposes its accessible name and is actionable (a11y label test).
        compose.onNodeWithContentDescription(strings.close).assertIsDisplayed()
        compose.onNodeWithTag(DrawerTestTags.CLOSE).assertHasClickAction()
    }

    @Test
    fun headerIsOmittedWhenTitleAbsent() {
        setSheet(display = display(showHeader = false, accessibleName = "Panel"), title = null)

        compose.onNodeWithTag(DrawerTestTags.TITLE).assertDoesNotExist()
        compose.onNodeWithTag(DrawerTestTags.CLOSE).assertDoesNotExist()
    }

    @Test
    fun bodyContentAlwaysRenders() {
        setSheet()

        compose.onNodeWithTag(DrawerTestTags.BODY).assertIsDisplayed()
        compose.onNodeWithText(BODY_TEXT).assertIsDisplayed()
    }

    @Test
    fun footerRendersWhenSuppliedAndIsOmittedOtherwise() {
        setSheet(display = display(showFooter = true), footer = { Button("Apply", {}, variant = ButtonVariant.Primary) })
        compose.onNodeWithTag(DrawerTestTags.FOOTER).assertIsDisplayed()
        compose.onNodeWithText("Apply").assertIsDisplayed()

        setSheet(display = display(showFooter = false), footer = null)
        compose.onNodeWithTag(DrawerTestTags.FOOTER).assertDoesNotExist()
    }

    @Test
    fun closeButtonInvokesOnClose() {
        var closed = false
        setSheet(onClose = { closed = true })

        compose.onNodeWithTag(DrawerTestTags.CLOSE).performClick()
        assertTrue("tapping the close button must invoke onClose", closed)
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 720.dp
        const val BODY_TEXT = "Pick the metrics and date range to narrow the dashboard."
    }
}
