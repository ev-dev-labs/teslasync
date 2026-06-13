// Instrumented Compose UI + accessibility verification of [PillFilterBarContent] across the states the web
// PillFilterBar renders: the populated pills/tabs row (each pill announcing its label, the active one marked
// selected — the production surface tags each pill with the `Role.Tab` semantics + selected state), the
// click → `onChange(key)` contract, the disabled pill being non-interactive (web `disabled`), the row
// announcing the localized `ariaLabel` (web `aria-label`), and the friendly empty surface carrying the
// localized `translation_savedViews_emptyQuery` message. Mirrors the accepted sibling DeltaUiTest's finder /
// assertion surface (label, content-description, selected, enabled). Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pillfilterbar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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

class PillFilterBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private var clickedKey: String? = null

    private fun setContent(
        projection: PillFilterBarProjection,
        variant: PillVariant = PillVariant.Pills,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PillFilterBarContent(
                        projection = projection,
                        ariaLabel = ARIA_LABEL,
                        variant = variant,
                        scrollable = true,
                        tablistId = "test",
                        onChange = { clickedKey = it },
                        iconFor = { null },
                    )
                }
            }
        }
    }

    @Test
    fun resolvedRowShowsEveryPillLabel() {
        setContent(resolved())
        compose.onNodeWithText("All", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Anomalies", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Archived", substring = true).assertIsDisplayed()
    }

    @Test
    fun selectedPillIsMarkedSelected() {
        setContent(resolved())
        compose.onNodeWithText("All", substring = true).assertIsSelected()
        compose.onNodeWithText("Anomalies", substring = true).assertIsNotSelected()
    }

    @Test
    fun clickingEnabledPillInvokesOnChangeWithKey() {
        setContent(resolved())
        compose.onNodeWithText("Anomalies", substring = true).performClick()
        assertEquals("anomalies", clickedKey)
    }

    @Test
    fun disabledPillIsNotInteractive() {
        setContent(resolved())
        compose.onNodeWithText("Archived", substring = true).assertIsNotEnabled()
    }

    @Test
    fun rowAnnouncesTheLocalizedAriaLabel() {
        setContent(resolved())
        compose.onNodeWithContentDescription(ARIA_LABEL).assertIsDisplayed()
    }

    @Test
    fun tabsVariantRendersSelectablePills() {
        setContent(resolved(), variant = PillVariant.Tabs)
        compose.onNodeWithText("All", substring = true).assertIsDisplayed().assertIsSelected()
        compose.onNodeWithText("Anomalies", substring = true).assertIsNotSelected()
    }

    @Test
    fun emptyStateShowsLocalizedMessage() {
        setContent(PillFilterBarProjection.Empty)
        compose.onNodeWithText(NO_FILTERS).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun resolved(): PillFilterBarProjection.Resolved =
        PillFilterBarProjection.Resolved(
            listOf(
                PillView("all", "All", "(128)", PillAccent.Cyan, selected = true, disabled = false),
                PillView("anomalies", "Anomalies", "(4)", PillAccent.Red, selected = false, disabled = false),
                PillView("archived", "Archived", null, PillAccent.Green, selected = false, disabled = true),
            ),
        )

    private companion object {
        const val ARIA_LABEL = "Filter drives"

        // en catalog value resolved on-device (translation_savedViews_emptyQuery).
        const val NO_FILTERS = "No filters"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 120.dp
    }
}
