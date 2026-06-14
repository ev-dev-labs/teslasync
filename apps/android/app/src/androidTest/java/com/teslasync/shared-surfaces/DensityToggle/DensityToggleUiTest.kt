// Instrumented Compose UI + accessibility verification of [DensityToggleContent] across the states the web
// DensityToggle renders: the content branch with each density selected (the active segment highlighted, the
// others not), the per-option accessible name + selected state (the native equivalent of `role="radio"
// aria-checked`), the group accessible name (web group `aria-label`), tap-to-commit, and the empty-options
// fallback (a friendly caption, never a blank box). Runs under `connectedAndroidTest` (a device/emulator); the
// offline gate's `testReleaseUnitTest` covers the pure model (projection, keyboard cycling, the `t(key, default)`
// resolver, and the diagnostics) in DensityToggleModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DensityToggle) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.densitytoggle

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DensityToggleUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DensityToggleStrings(
            table = TABLE,
            compact = COMPACT,
            comfortable = COMFORTABLE,
            groupLabel = GROUP_LABEL,
            noOptions = NO_OPTIONS,
        )

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun rendersOneSegmentPerDensityWithTheGroupName() {
        host {
            DensityToggleContent(value = Density.Table, onChange = {}, strings = strings)
        }
        compose.onNodeWithTag(DENSITY_TOGGLE_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(GROUP_LABEL).assertIsDisplayed()
        Density.entries.forEach { density ->
            compose.onNodeWithTag(densityOptionTag(density)).assertIsDisplayed().assertHasClickAction()
        }
    }

    @Test
    fun highlightsOnlyTheSelectedDensity() {
        host {
            DensityToggleContent(value = Density.Compact, onChange = {}, strings = strings)
        }
        compose.onNodeWithTag(densityOptionTag(Density.Compact)).assertIsSelected()
        compose.onNodeWithTag(densityOptionTag(Density.Table)).assertIsNotSelected()
        compose.onNodeWithTag(densityOptionTag(Density.Comfortable)).assertIsNotSelected()
    }

    @Test
    fun eachSegmentAnnouncesItsDensityLabel() {
        host {
            DensityToggleContent(value = Density.Table, onChange = {}, strings = strings)
        }
        // The native equivalent of the web per-option `aria-label` — every interactive segment is named.
        compose.onNodeWithContentDescription(TABLE).assertIsDisplayed()
        compose.onNodeWithContentDescription(COMPACT).assertIsDisplayed()
        compose.onNodeWithContentDescription(COMFORTABLE).assertIsDisplayed()
    }

    @Test
    fun tappingASegmentCommitsThatDensity() {
        var committed: Density? = null
        host {
            DensityToggleContent(value = Density.Table, onChange = { committed = it }, strings = strings)
        }
        compose.onNodeWithTag(densityOptionTag(Density.Comfortable)).performClick()
        assertEquals(Density.Comfortable, committed)
    }

    @Test
    fun honoursAnAriaLabelOverrideForTheGroup() {
        host {
            DensityToggleContent(value = Density.Table, onChange = {}, strings = strings, ariaLabel = OVERRIDE_LABEL)
        }
        compose.onNodeWithContentDescription(OVERRIDE_LABEL).assertIsDisplayed()
    }

    @Test
    fun rendersOnlyTheCallerSubsetOfOptions() {
        host {
            DensityToggleContent(
                value = Density.Comfortable,
                onChange = {},
                strings = strings,
                options = listOf(Density.Compact, Density.Comfortable),
            )
        }
        compose.onNodeWithTag(densityOptionTag(Density.Compact)).assertIsDisplayed()
        compose.onNodeWithTag(densityOptionTag(Density.Comfortable)).assertIsSelected()
        // The hidden table option is never composed (web `options` subset).
        compose.onNodeWithTag(densityOptionTag(Density.Table)).assertDoesNotExist()
    }

    @Test
    fun emptyOptionsShowsTheFriendlyCaptionNeverABlankBox() {
        host {
            DensityToggleContent(value = Density.Table, onChange = {}, strings = strings, options = emptyList())
        }
        compose.onNodeWithTag(DENSITY_TOGGLE_EMPTY_TAG).assertIsDisplayed()
        // The segmented selector is not composed when there are no options.
        compose.onNodeWithTag(DENSITY_TOGGLE_TEST_TAG).assertDoesNotExist()
    }

    private companion object {
        const val TABLE = "Table"
        const val COMPACT = "Compact"
        const val COMFORTABLE = "Comfortable"
        const val GROUP_LABEL = "List density"
        const val NO_OPTIONS = "No density options"
        const val OVERRIDE_LABEL = "Row size"
    }
}
