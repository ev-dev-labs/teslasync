// Instrumented Compose UI + accessibility verification of the LayoutBreadcrumbs shared surface across the states
// the web breadcrumb graph renders (web/src/components/layout/Breadcrumbs.tsx): the self-suppressed top-level page
// (a <= 1 item chain renders nothing), the full trail (home affordance + linked ancestors + current text), and
// the compact-width collapse of middle crumbs to an ellipsis. It also asserts the things that matter for a
// breadcrumb surface — the home affordance and every link announce a label to assistive tech, and the current
// crumb is plain non-interactive text. The offline `testReleaseUnitTest` gate covers the pure model; this runs
// under `connectedAndroidTest`.
package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

// `assertExists` / `assertDoesNotExist` are member functions of `SemanticsNodeInteraction` in the pinned Compose
// test BOM, so they are called directly on the node interaction below and are intentionally not imported.

class LayoutBreadcrumbsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val twoItemTrail =
        listOf(
            BreadcrumbItem(destinationId = "drives", label = "Drives", route = "drives"),
            BreadcrumbItem(destinationId = "driveDetail", label = "Trip to office", route = null),
        )

    private val threeItemTrail =
        listOf(
            BreadcrumbItem(destinationId = "vehicles", label = "Vehicles", route = "vehicles"),
            BreadcrumbItem(destinationId = "vehicleDetail", label = "Model 3", route = "vehicles/3"),
            BreadcrumbItem(destinationId = "vehicleAccess", label = "Access", route = null),
        )

    @Test
    fun singleItemChainSuppressesTheWholeRow() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LayoutBreadcrumbsContent(
                    items = listOf(BreadcrumbItem(destinationId = "dashboard", label = "Dashboard", route = null)),
                )
            }
        }

        compose.onNodeWithTag(LAYOUT_BREADCRUMBS_TEST_TAG).assertDoesNotExist()
    }

    @Test
    fun trailRendersHomeLinkedAncestorAndCurrentCrumb() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.requiredWidth(800.dp)) {
                    LayoutBreadcrumbsContent(items = twoItemTrail)
                }
            }
        }

        compose.onNodeWithTag(LAYOUT_BREADCRUMBS_TEST_TAG, useUnmergedTree = true).assertExists()
        // The leading home affordance announces the localized "Dashboard" label and is actionable.
        compose.onNodeWithContentDescription("Dashboard").assertExists().assertHasClickAction()
        // The ancestor crumb is a link.
        compose.onNodeWithText("Drives").assertIsDisplayed().assertHasClickAction()
        // The current crumb is plain, non-interactive text.
        compose.onNodeWithText("Trip to office").assertIsDisplayed().assertHasNoClickAction()
    }

    @Test
    fun tappingAnAncestorCrumbEmitsItsNavigationTarget() {
        val navigated = mutableListOf<BreadcrumbItem>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.requiredWidth(800.dp)) {
                    LayoutBreadcrumbsContent(items = twoItemTrail, onNavigate = { navigated += it })
                }
            }
        }

        compose.onNodeWithText("Drives").performClick()

        assertEquals(1, navigated.size)
        assertEquals("drives", navigated.single().destinationId)
        assertEquals("drives", navigated.single().route)
    }

    @Test
    fun middleCrumbsCollapseOnACompactWidth() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.requiredWidth(320.dp)) {
                    LayoutBreadcrumbsContent(items = threeItemTrail)
                }
            }
        }

        // First + current stay visible; the middle crumb collapses behind the ellipsis.
        compose.onNodeWithText("Vehicles").assertExists()
        compose.onNodeWithText("Access").assertExists()
        compose.onNodeWithText("Model 3").assertDoesNotExist()
    }

    @Test
    fun middleCrumbsStayVisibleOnAWideWidth() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.requiredWidth(800.dp)) {
                    LayoutBreadcrumbsContent(items = threeItemTrail)
                }
            }
        }

        compose.onNodeWithText("Model 3").assertIsDisplayed().assertHasClickAction()
    }
}
