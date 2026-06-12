package io.teslasync.android.featureviews.quicknav

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [QuickNavContent] across the states the surface renders:
 * the populated four-card grid (the web `NAV_ITEMS.map(...)` — Drives / Charging / Analytics / Battery), the
 * navigation callback each card fires (web `<Link to={nav.to}>`), the per-card accessibility (every card is a
 * focusable button with a click action + accessible label), and the defensive empty state (never a blank box).
 * The offline gate's `testReleaseUnitTest` covers the pure catalogue + diagnostics; this covers render + a11y.
 * Mirrors the web spec (web/src/features/dashboard/components/QuickNav.tsx).
 */
class QuickNavUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        items: List<QuickNavItem> = QuickNavProjection.items,
        onNavigate: (QuickNavDestination) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                QuickNavContent(onNavigate = onNavigate, items = items)
            }
        }
    }

    @Test
    fun contentRendersAllFourNavCardLabels() {
        setContent()
        compose.onNodeWithText("Drives").assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
        compose.onNodeWithText("Analytics").assertIsDisplayed()
        compose.onNodeWithText("Battery Health").assertIsDisplayed()
    }

    @Test
    fun contentRendersEachCardDescription() {
        setContent()
        // Each card carries its destination's localized subtitle (web per-item description).
        compose.onNodeWithText("Comprehensive fleet performance insights").assertIsDisplayed()
        compose.onNodeWithText("Trip scoring", substring = true).assertIsDisplayed()
    }

    @Test
    fun tappingCardsInvokesOnNavigateWithTheMatchingDestination() {
        val tapped = mutableListOf<QuickNavDestination>()
        setContent(onNavigate = { tapped += it })

        compose.onNodeWithText("Drives").performClick()
        compose.onNodeWithText("Charging").performClick()
        compose.onNodeWithText("Analytics").performClick()
        compose.onNodeWithText("Battery Health").performClick()

        assertEquals(
            listOf(
                QuickNavDestination.Drives,
                QuickNavDestination.Charging,
                QuickNavDestination.Analytics,
                QuickNavDestination.Battery,
            ),
            tapped,
        )
    }

    @Test
    fun everyCardIsAnAccessibleButtonWithAClickAction() {
        setContent()
        // Each card is a single focusable button carrying its label + a click action (web `<Link>`).
        compose.onNodeWithText("Drives").assertHasClickAction()
        compose.onNodeWithText("Charging").assertHasClickAction()
        compose.onNodeWithText("Analytics").assertHasClickAction()
        compose.onNodeWithText("Battery Health").assertHasClickAction()
    }

    @Test
    fun emptyShowsFriendlyNoDataMessageNotABlankBox() {
        setContent(items = emptyList())
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }
}
