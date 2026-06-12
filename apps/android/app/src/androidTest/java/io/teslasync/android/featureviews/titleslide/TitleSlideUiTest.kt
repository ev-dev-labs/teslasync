package io.teslasync.android.featureviews.titleslide

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TitleSlideContent] across the render path the web
 * component defines (the year hero, the localized title, and the vehicle name) plus the blank-name fallback.
 * Asserts the rendered i18n string, the vehicle name, and the stable TalkBack label on the count-up hero
 * (the projected grouped year, not the animating value). Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection logic; this covers render
 * + a11y. Reduced motion is forced so the count-up resolves to its final value deterministically.
 */
class TitleSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val data =
        TitleSlideData(
            year = 2024,
            vehicle = TitleSlideVehicle(id = 1, displayName = "My Model 3", model = "model3"),
        )

    private fun setContent(slide: TitleSlideData) {
        compose.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme(dynamicColor = false) {
                    TitleSlideContent(data = slide)
                }
            }
        }
    }

    @Test
    fun rendersTheLocalizedTitleAndVehicleName() {
        setContent(data)
        compose.onNodeWithText("Year in Review").assertIsDisplayed()
        compose.onNodeWithText("My Model 3").assertIsDisplayed()
    }

    @Test
    fun heroYearExposesItsStableAccessibilityLabel() {
        setContent(data)
        // The count-up clears its animating semantics and exposes the final grouped year as one label.
        compose.onNodeWithContentDescription("2,024").assertIsDisplayed()
    }

    @Test
    fun reducedMotionResolvesTheYearToItsFinalValue() {
        setContent(data)
        compose.onNodeWithText("2,024").assertIsDisplayed()
    }

    @Test
    fun blankVehicleNameRendersTheEmDashFallback() {
        setContent(data.copy(vehicle = TitleSlideVehicle(id = 2, displayName = "", model = "models")))
        compose.onNodeWithText("\u2014").assertIsDisplayed()
    }
}
