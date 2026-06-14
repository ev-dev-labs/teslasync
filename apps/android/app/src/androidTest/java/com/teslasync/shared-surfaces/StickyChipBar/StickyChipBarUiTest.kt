// Instrumented Compose UI + accessibility verification of [StickyChipBarContent] across the states the web
// StickyChipBar renders: the populated chip row (each chip announcing its label, the active one marked
// selected — the production surface tags each chip with the `Role.Tab` semantics + selected state), the
// click → `onChipClick(id)` contract (web `handleClick`), the row announcing the localized `navLabel` (web
// `<nav aria-label>`), and the friendly empty surface carrying the localized `common.noData` message (the web
// empty `<nav>`). Mirrors the accepted sibling PillFilterBarUiTest's finder / assertion surface (label,
// content-description, selected). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
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

class StickyChipBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private var clickedId: String? = null

    private fun setContent(projection: StickyChipBarProjection) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    StickyChipBarContent(
                        projection = projection,
                        navLabel = NAV_LABEL,
                        emptyMessage = NO_DATA,
                        onChipClick = { clickedId = it },
                    )
                }
            }
        }
    }

    @Test
    fun resolvedRowShowsEveryChipLabel() {
        setContent(resolved())
        compose.onNodeWithText("Overview", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Battery", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Charging", substring = true).assertIsDisplayed()
    }

    @Test
    fun activeChipIsMarkedSelected() {
        setContent(resolved())
        compose.onNodeWithText("Overview", substring = true).assertIsSelected()
        compose.onNodeWithText("Battery", substring = true).assertIsNotSelected()
    }

    @Test
    fun clickingChipInvokesOnChipClickWithId() {
        setContent(resolved())
        compose.onNodeWithText("Charging", substring = true).performClick()
        assertEquals("charging", clickedId)
    }

    @Test
    fun rowAnnouncesTheLocalizedNavLabel() {
        setContent(resolved())
        compose.onNodeWithContentDescription(NAV_LABEL).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheLocalizedMessage() {
        setContent(StickyChipBarProjection.Empty)
        compose.onNodeWithText(NO_DATA).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun resolved(): StickyChipBarProjection.Resolved =
        StickyChipBarProjection.Resolved(
            listOf(
                ChipView(id = "overview", label = "Overview", active = true),
                ChipView(id = "battery", label = "Battery", active = false),
                ChipView(id = "charging", label = "Charging", active = false),
            ),
        )

    private companion object {
        const val NAV_LABEL = "Quick navigation"

        // en catalog value resolved on-device (translation_common_noData).
        const val NO_DATA = "No data available"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 120.dp
    }
}
