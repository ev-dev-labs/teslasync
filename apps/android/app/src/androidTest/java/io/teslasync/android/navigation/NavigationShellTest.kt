package io.teslasync.android.navigation

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the adaptive navigation shell ([AppScaffold] + [TeslaSyncNavHost]).
 * The pure routing rules are covered by the no-device [RouteTableTest]/[AdaptiveNavTest]; these
 * assert the shell shows the right primary affordance per window width (the shell always composes the
 * closed modal drawer, so the affordance is identified by its [NavTestTags] seam rather than by its —
 * non-unique — destination labels), falls through to the shared not-found screen for an un-hosted
 * page, announces the route to screen readers, navigates on selection, and resolves a deep link into
 * the live back stack on a device (connectedDebugAndroidTest).
 */
class NavigationShellTest {
    @get:Rule
    val rule = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun title(id: String): String = context.getString(navTitleRes(id))

    private fun renderShell(
        width: WindowWidth,
        onController: (NavHostController) -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                val navController = rememberNavController()
                onController(navController)
                AppScaffold(navController = navController, width = width)
            }
        }
    }

    @Test
    fun compactWidthShowsBottomBarNotRailOrDrawer() {
        renderShell(WindowWidth.Compact)
        rule.onNodeWithTag(NavTestTags.BOTTOM_BAR).assertIsDisplayed()
        rule.onNodeWithTag(NavTestTags.RAIL).assertDoesNotExist()
        rule.onNodeWithTag(NavTestTags.PERMANENT_DRAWER).assertDoesNotExist()
    }

    @Test
    fun mediumWidthShowsNavigationRail() {
        renderShell(WindowWidth.Medium)
        rule.onNodeWithTag(NavTestTags.RAIL).assertIsDisplayed()
        rule.onNodeWithTag(NavTestTags.BOTTOM_BAR).assertDoesNotExist()
        rule.onNodeWithTag(NavTestTags.PERMANENT_DRAWER).assertDoesNotExist()
        rule.onNodeWithText(context.getString(R.string.nav_more)).assertIsDisplayed()
    }

    @Test
    fun expandedWidthShowsPermanentDrawer() {
        renderShell(WindowWidth.Expanded)
        rule.onNodeWithTag(NavTestTags.PERMANENT_DRAWER).assertIsDisplayed()
        rule.onNodeWithTag(NavTestTags.BOTTOM_BAR).assertDoesNotExist()
        rule.onNodeWithTag(NavTestTags.RAIL).assertDoesNotExist()
    }

    @Test
    fun unhostedStartDestinationRendersNotFoundScreen() {
        renderShell(WindowWidth.Compact)
        rule.onNodeWithText(context.getString(R.string.nav_not_found_body), substring = true).assertIsDisplayed()
    }

    @Test
    fun routeAnnouncerExposesPoliteAnnouncement() {
        renderShell(WindowWidth.Compact)
        val announcement = context.getString(R.string.nav_route_announcement, title("dashboard"))
        rule.onNodeWithContentDescription(announcement).assertExists()
    }

    @Test
    fun selectingBottomBarDestinationNavigates() {
        lateinit var navController: NavHostController
        renderShell(WindowWidth.Compact) { navController = it }
        rule.onNode(hasText(title("charging")) and hasAnyAncestor(hasTestTag(NavTestTags.BOTTOM_BAR))).performClick()
        rule.waitForIdle()
        rule.runOnIdle { assertEquals("charging", navController.currentDestination?.route) }
    }

    @Test
    fun deepLinkResolvesIntoTheBackStack() {
        lateinit var navController: NavHostController
        renderShell(WindowWidth.Compact) { navController = it }
        val uri = "${RouteTable.APP_SCHEME}://app/charging"
        var handled = false
        rule.runOnUiThread {
            handled = navController.handleDeepLink(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
        }
        rule.waitForIdle()
        assertTrue("deep link $uri should be handled", handled)
        rule.runOnIdle { assertEquals("charging", navController.currentDestination?.route) }
    }
}
