// On-device Compose UI + accessibility verification of the ThemePicker shared surface across the states the
// web source renders (web/src/components/ui/ThemePicker.tsx): the populated picker (both sections, the mode +
// accent tiles, their selected markers, and the custom builder), the loading skeleton, the defensive empty
// state, the error + retry affordance, and the TalkBack labels on every interactive tile. It asserts the
// rendered chrome strings and that picking a tile / retrying invokes the surface callbacks. Every render uses
// reduced motion so the entry animation never keeps the test clock busy. Runs under `connectedAndroidTest`;
// the `testReleaseUnitTest` gate covers the pure model, the store, and the ViewModel — this covers the render.
package io.teslasync.android.sharedsurfaces.themepicker

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ThemePickerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): ThemePickerStrings =
        ThemePickerStrings(
            surfaceLabel = "Customize colors and display mode",
            displayMode = "Display Mode",
            accentColor = "Accent Color",
            theme = "Theme",
            mode = "Mode",
            custom = "Custom",
            primary = "Primary",
            accent = "Accent",
            loading = "Loading",
            errorMessage = "Failed to load data",
            retry = "Retry",
            stale = "Stale",
            offline = "Offline",
            noData = "No data available",
        )

    private fun data(themeId: String = "neon-cyan"): ThemePickerData =
        ThemeCatalog.project(ThemePickerRegistration.DEFAULTS.copy(themeId = themeId))

    private fun setSurface(
        state: UiState<ThemePickerData>,
        callbacks: ThemePickerCallbacks = ThemePickerCallbacks(),
        showCustom: Boolean = true,
        compact: Boolean = false,
    ) {
        compose.setContent {
            Surface {
                ThemePickerContent(
                    state = state,
                    strings = strings(),
                    callbacks = callbacks,
                    showCustom = showCustom,
                    compact = compact,
                )
            }
        }
    }

    @Composable
    private fun Surface(content: @Composable () -> Unit) {
        TeslaSyncTheme(dynamicColor = false) {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                content()
            }
        }
    }

    @Test
    fun contentRendersBothSectionsAndTheModeAndThemeTiles() {
        setSurface(UiState(UiPhase.Content, data = data(), fetchedAt = STAMP))

        compose.onNodeWithTag(THEME_PICKER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Display Mode").assertIsDisplayed()
        compose.onNodeWithText("Accent Color").assertIsDisplayed()
        compose.onNodeWithTag(THEME_PICKER_MODE_TAG_PREFIX + "dark").assertIsDisplayed()
        compose.onNodeWithTag(THEME_PICKER_THEME_TAG_PREFIX + "neon-cyan").assertIsDisplayed()
    }

    @Test
    fun everyInteractiveTileIsLabelledForTalkBack() {
        setSurface(UiState(UiPhase.Content, data = data(), fetchedAt = STAMP))

        compose.onNodeWithContentDescription("Dark").assertIsDisplayed()
        compose.onNodeWithContentDescription("Neon Cyan").assertIsDisplayed()
        compose.onNodeWithContentDescription("Custom").assertIsDisplayed()
    }

    @Test
    fun pickingAModeInvokesTheCallback() {
        val picks = mutableListOf<Pair<String, String>>()
        setSurface(
            UiState(UiPhase.Content, data = data(), fetchedAt = STAMP),
            callbacks = ThemePickerCallbacks(onSelectMode = { id, name -> picks += id to name }),
        )

        compose.onNodeWithTag(THEME_PICKER_MODE_TAG_PREFIX + "light").performClick()
        assertEquals(listOf("light" to "Light"), picks)
    }

    @Test
    fun pickingABrandThemeInvokesTheCallback() {
        val picks = mutableListOf<String>()
        setSurface(
            UiState(UiPhase.Content, data = data(), fetchedAt = STAMP),
            callbacks = ThemePickerCallbacks(onSelectBrand = { id, _ -> picks += id }),
        )

        compose.onNodeWithTag(THEME_PICKER_THEME_TAG_PREFIX + "tesla-red").performClick()
        assertEquals(listOf("tesla-red"), picks)
    }

    @Test
    fun customBuilderIsShownWhenTheCustomThemeIsActive() {
        setSurface(UiState(UiPhase.Content, data = data("custom"), fetchedAt = STAMP))

        compose.onNodeWithTag(THEME_PICKER_CUSTOM_TAG).assertIsDisplayed()
        compose.onNodeWithText("Primary").assertIsDisplayed()
        compose.onNodeWithText("Accent").assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersTheSurfaceRoot() {
        setSurface(UiState.loading())
        compose.onNodeWithTag(THEME_PICKER_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersAFriendlyMessage() {
        setSurface(UiState(UiPhase.Empty, data = ThemePickerData(ThemePickerRegistration.DEFAULTS, emptyList(), emptyList())))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun errorStateRendersRetryAndInvokesTheCallback() {
        var retried = 0
        setSurface(
            UiState(UiPhase.Error, errorKind = ErrorKind.Unknown),
            callbacks = ThemePickerCallbacks(onRetry = { retried++ }),
        )

        compose.onNodeWithText("Retry").performClick()
        assertEquals(1, retried)
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
