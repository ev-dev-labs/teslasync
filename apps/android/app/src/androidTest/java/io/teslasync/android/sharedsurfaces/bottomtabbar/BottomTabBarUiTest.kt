package io.teslasync.android.sharedsurfaces.bottomtabbar

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.navigation.Destination
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the BottomTabBar shared surface across every state the
 * web component renders (web/src/components/layout/BottomTabBar.tsx): all five tabs are always shown, the tab
 * owning the current route is selected (including a descendant route lighting its section), a route outside the
 * bar leaves every tab unselected, and a tap raises its destination. It also asserts the accessibility
 * contract — the bar exposes the localized "Quick navigation" landmark label and every tab is announced by its
 * visible label. The stateful path is exercised end to end against the real ViewModel + source seam. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class BottomTabBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): BottomTabBarStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return BottomTabBarStrings(
            navLabel = ctx.getString(R.string.translation_nav_quickNav),
            dashboard = ctx.getString(R.string.translation_nav_dashboard),
            drives = ctx.getString(R.string.translation_nav_drives),
            charging = ctx.getString(R.string.translation_nav_charging),
            battery = ctx.getString(R.string.translation_nav_battery),
            liveMap = ctx.getString(R.string.translation_nav_liveMap),
        )
    }

    private fun content(
        path: String,
        onSelect: (Destination) -> Unit = {},
    ) {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BottomTabBarContent(
                    display = BottomTabBarProjection.project(path, labels),
                    onSelect = onSelect,
                )
            }
        }
    }

    @Test
    fun allFiveTabsAreAlwaysShown() {
        val labels = strings()
        content("/")
        compose.onNodeWithTag(BOTTOM_TAB_BAR_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(labels.dashboard).assertIsDisplayed()
        compose.onNodeWithText(labels.drives).assertIsDisplayed()
        compose.onNodeWithText(labels.charging).assertIsDisplayed()
        compose.onNodeWithText(labels.battery).assertIsDisplayed()
        compose.onNodeWithText(labels.liveMap).assertIsDisplayed()
    }

    @Test
    fun barExposesTheQuickNavigationLandmarkLabel() {
        val labels = strings()
        content("/")
        compose.onNodeWithContentDescription(labels.navLabel).assertIsDisplayed()
    }

    @Test
    fun theTabOwningTheCurrentRouteIsSelected() {
        content("/charging")
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Charging)).assertIsSelected()
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Dashboard)).assertIsNotSelected()
    }

    @Test
    fun aDescendantRouteSelectsItsSectionTab() {
        content("/charging/123")
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Charging)).assertIsSelected()
    }

    @Test
    fun aRouteOutsideTheBarLeavesEveryTabUnselectedButShown() {
        val labels = strings()
        content("/settings")
        compose.onNodeWithText(labels.dashboard).assertIsDisplayed()
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Dashboard)).assertIsNotSelected()
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Charging)).assertIsNotSelected()
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.LiveMap)).assertIsNotSelected()
    }

    @Test
    fun tappingATabRaisesItsDestination() {
        var selected: Destination? = null
        content("/") { selected = it }
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Drives)).performClick()
        assertEquals("drives", selected?.id)
    }

    @Test
    fun statefulBottomTabBarBindsTheRouteAndSelectsTheActiveTab() {
        val source = bottomTabBarSource { MutableStateFlow("/battery") }
        val vm = BottomTabBarViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BottomTabBar(viewModel = vm, onSelect = {})
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(bottomTabItemTestTag(BottomTab.Battery)).assertIsSelected()
    }
}
