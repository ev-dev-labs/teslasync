package io.teslasync.android.featureviews.environmentslide

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
 * On-device Compose UI + accessibility verification of [EnvironmentSlideContent] across every state the
 * surface renders: the typical state (uppercase label + green "N kg" count-up + "Like planting N trees"
 * caption + tree grid), the overflow state (the "+N more" chip past the 30-glyph cap), and the zero/no-impact
 * state ("0 kg" + an empty grid, never a blank box). Also asserts the lead 🌍 exposes the "CO₂ offset" concept
 * as its TalkBack label. Reduced motion is forced via [LocalReducedMotion] so the count-up snaps to its final
 * value and assertions are deterministic. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest`
 * gate covers the pure projection logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/review/EnvironmentSlide.tsx).
 */
class EnvironmentSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(data: EnvironmentSlideData) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    EnvironmentSlideContent(data = data)
                }
            }
        }
    }

    @Test
    fun typicalStateRendersTheCountUpAndTreesEquivalentCaption() {
        // 504 kg / 21 = 24 trees.
        setContent(EnvironmentSlideData(co2OffsetKg = 504.0))
        compose.onNodeWithText("504 kg").assertIsDisplayed()
        compose.onNodeWithText("Like planting 24 trees").assertIsDisplayed()
    }

    @Test
    fun overflowStateRendersTheMoreChip() {
        // 1050 kg / 21 = 50 trees -> 30 glyphs + "+20 more".
        setContent(EnvironmentSlideData(co2OffsetKg = 1050.0))
        compose.onNodeWithText("Like planting 50 trees").assertIsDisplayed()
        compose.onNodeWithText("+20 more").assertIsDisplayed()
    }

    @Test
    fun zeroStateRendersZeroKilogramsAndNoTrees() {
        // The no-impact surface still renders its hero + caption (never a blank box).
        setContent(EnvironmentSlideData(co2OffsetKg = 0.0))
        compose.onNodeWithText("0 kg").assertIsDisplayed()
        compose.onNodeWithText("Like planting 0 trees").assertIsDisplayed()
    }

    @Test
    fun globeExposesTheCo2OffsetConceptAsItsAccessibilityLabel() {
        // The lead glyph announces the localized "CO₂ offset" label to TalkBack (proves the i18n key resolves).
        setContent(EnvironmentSlideData(co2OffsetKg = 504.0))
        compose.onNodeWithContentDescription("CO₂ offset").assertIsDisplayed()
    }
}
