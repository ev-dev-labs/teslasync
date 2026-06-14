// Instrumented Compose UI + accessibility verification of [TabsContent] across the states the web Tabs renders:
// the populated strip (each tab announcing its label, the active one marked selected with the production
// `Role.Tab` semantics), the click → `onChange(key)` contract, the disabled tab being non-interactive (web
// `disabled`), the row announcing the localized `ariaLabel` (web `aria-label`), and the friendly empty surface
// carrying the localized `translation_common_noData` message. Mirrors the accepted sibling
// PillFilterBarUiTest / AccordionUiTest finder + assertion surface (label, content-description, selected,
// enabled, role). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TabsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private var clickedKey: String? = null

    private fun setContent(projection: TabsProjection) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TabsContent(
                        projection = projection,
                        onChange = { clickedKey = it },
                        ariaLabel = ARIA_LABEL,
                        scrollable = true,
                        tablistId = "test",
                    )
                }
            }
        }
    }

    @Test
    fun resolvedStripShowsEveryTabLabel() {
        setContent(resolved())
        compose.onNodeWithText("Overview").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("History").assertIsDisplayed()
    }

    @Test
    fun selectedTabIsMarkedSelected() {
        setContent(resolved())
        compose.onNodeWithText("Overview").assertIsSelected()
        compose.onNodeWithText("Battery").assertIsNotSelected()
    }

    @Test
    fun clickingEnabledTabInvokesOnChangeWithKey() {
        setContent(resolved())
        compose.onNodeWithText("Battery").performClick()
        assertEquals("battery", clickedKey)
    }

    @Test
    fun disabledTabIsNotInteractive() {
        setContent(resolved())
        compose.onNodeWithText("History").assertIsNotEnabled()
    }

    @Test
    fun rowAnnouncesTheLocalizedAriaLabel() {
        setContent(resolved())
        compose.onNodeWithContentDescription(ARIA_LABEL).assertIsDisplayed()
    }

    @Test
    fun eachTabCarriesTheTabRole() {
        setContent(resolved())
        compose
            .onNodeWithText("Overview")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab))
    }

    @Test
    fun emptyStateShowsLocalizedMessage() {
        setContent(TabsProjection.Empty)
        compose.onNodeWithText(NO_DATA).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun resolved(): TabsProjection.Resolved =
        TabsProjection.Resolved(
            listOf(
                TabView("overview", "Overview", selected = true, disabled = false),
                TabView("battery", "Battery", selected = false, disabled = false),
                TabView("history", "History", selected = false, disabled = true),
            ),
        )

    private companion object {
        const val ARIA_LABEL = "Vehicle sections"

        // en catalog value resolved on-device (translation_common_noData).
        const val NO_DATA = "No data available"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 120.dp
    }
}
