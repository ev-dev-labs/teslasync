package io.teslasync.android.featureviews.addwidgetbutton

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [AddWidgetButtonContent] across the two branches
 * the web component renders (web/src/features/dashboard/components/AddWidgetButton.tsx): not-editing (the
 * tooltip-wrapped "+" FAB is shown, labeled, and fires `onClick`) and editing (the surface renders nothing,
 * web `return null`). The "Add Widget" label is resolved from the app's i18n resources so the test follows
 * the device locale rather than hard-coding English, and the FAB is targeted by both its TalkBack content
 * description (the a11y label test) and the web-parity test tag. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection.
 */
class AddWidgetButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val addWidgetLabel get() = context.getString(R.string.translation_dashboard_addWidget)

    private fun setContent(
        isEditing: Boolean,
        onClick: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.BottomEnd) {
                    AddWidgetButtonContent(
                        display = AddWidgetButtonProjection.project(isEditing = isEditing),
                        onClick = onClick,
                    )
                }
            }
        }
    }

    @Test
    fun notEditingShowsLabeledClickableFab() {
        setContent(isEditing = false)

        compose.onNodeWithTag(AddWidgetButtonRegistration.TEST_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(addWidgetLabel).assertIsDisplayed()
    }

    @Test
    fun fabClickInvokesOnClick() {
        var clicks = 0
        setContent(isEditing = false, onClick = { clicks++ })

        compose.onNodeWithTag(AddWidgetButtonRegistration.TEST_TAG).performClick()

        assertEquals(1, clicks)
    }

    @Test
    fun editingRendersNothing() {
        setContent(isEditing = true)

        compose.onAllNodesWithTag(AddWidgetButtonRegistration.TEST_TAG).assertCountEquals(0)
        compose.onAllNodesWithContentDescription(addWidgetLabel).assertCountEquals(0)
    }
}
