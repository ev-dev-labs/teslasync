// Instrumented Compose UI + accessibility verification of [NotionSidebarContent] across the branches the web
// NotionSidebar renders (web/src/components/layout/sidebar/NotionSidebar.tsx): the Favorites + Pages tree, an
// expanded section's rows, a collapsed section hiding its rows, the trailing vehicle/stale chips, the inline
// "No matches." filter-empty branch, and the accessible names TalkBack reads on the surface landmark, on every
// pin/unpin control and on the count chips. Runs under `connectedAndroidTest` (a device/emulator); the offline
// gate's `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class NotionSidebarUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun treeRendersFavoritesGroupAndPagesSections() {
        setContent(display(currentPath = "/charging", collapsed = setOf("Fleet")))
        compose.onNodeWithTag(NOTION_SIDEBAR_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(FAVORITES, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(PAGES, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(notionSectionTestTag("Charging"), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(notionSectionTestTag("Fleet"), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun expandedSectionShowsItsRows() {
        setContent(display(currentPath = "/charging", collapsed = setOf("Fleet")))
        compose.onNodeWithTag(notionRowTestTag("/charging"), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(notionRowTestTag("/charging/curves"), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun collapsedSectionHidesItsRows() {
        setContent(display(currentPath = "/", collapsed = setOf("Charging", "Fleet")))
        compose.onNodeWithTag(notionSectionTestTag("Charging"), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(notionRowTestTag("/charging"), useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun filterEmptyBranchShowsMessageAndClearAction() {
        setContent(display(currentPath = "/charging", filter = "zzzz"))
        compose.onNodeWithTag(NOTION_SIDEBAR_EMPTY_TEST_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(NO_MATCHES, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(CLEAR_FILTER, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun trailingCountChipsAreLabelledForTalkBack() {
        setContent(display(currentPath = "/", collapsed = emptySet()))
        compose.onNodeWithContentDescription(VEHICLE_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(STALE_LABEL, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun accessibilityLabelsArePresentOnInteractiveElements() {
        setContent(display(currentPath = "/charging", collapsed = setOf("Fleet")))
        // The surface carries its landmark name (web `aria-label={t('nav.sidebar')}`).
        compose.onNodeWithContentDescription(NAV_LABEL, useUnmergedTree = true).assertIsDisplayed()
        // The pinned favorite exposes its unpin affordance.
        compose.onNodeWithContentDescription(UNPIN_DASHBOARD, useUnmergedTree = true).assertIsDisplayed()
        // A non-pinned page exposes its pin affordance.
        compose.onNodeWithContentDescription(PIN_CHARGING, useUnmergedTree = true).assertIsDisplayed()
    }

    @Composable
    private fun setContent(display: NotionSidebarDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    NotionSidebarContent(display = display)
                }
            }
        }
    }

    private fun display(
        currentPath: String,
        filter: String = "",
        collapsed: Set<String> = emptySet(),
    ): NotionSidebarDisplay = NotionSidebarProjection.project(input(), currentPath, filter, collapsed, strings())

    private fun strings(): NotionSidebarStrings =
        NotionSidebarStrings(
            navLabel = NAV_LABEL,
            favorites = FAVORITES,
            pages = PAGES,
            filterNoMatch = NO_MATCHES,
            filterClear = CLEAR_FILTER,
        )

    private fun input(): NotionSidebarInput =
        NotionSidebarInput(
            sections =
                listOf(
                    NotionSidebarSection(
                        title = "Charging",
                        items =
                            listOf(
                                NotionNavItem("/charging", "Charging", NavGlyphs.Bolt),
                                NotionNavItem("/charging/curves", "Charging Curves", NavGlyphs.Chart),
                            ),
                    ),
                    NotionSidebarSection(
                        title = "Fleet",
                        items =
                            listOf(
                                NotionNavItem("/vehicles", "Vehicles", NavGlyphs.Car),
                                NotionNavItem("/data-repair", "Data Repair", NavGlyphs.Server),
                            ),
                    ),
                ),
            pinnedItems = listOf(NotionNavItem("/", "Dashboard", NavGlyphs.Dashboard)),
            activeSectionTitle = "Charging",
            vehicleCount = 3,
            staleCount = 12,
        )

    private companion object {
        const val NAV_LABEL = "Sidebar navigation"
        const val FAVORITES = "Favorites"
        const val PAGES = "Pages"
        const val NO_MATCHES = "No matches."
        const val CLEAR_FILTER = "Clear filter"

        // Per-row strings resolved on-device from the en catalog (translation_nav_* format strings).
        const val VEHICLE_LABEL = "3 vehicles"
        const val STALE_LABEL = "12 stale rows"
        const val UNPIN_DASHBOARD = "Unpin Dashboard"
        const val PIN_CHARGING = "Pin Charging"

        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 760.dp
    }
}
