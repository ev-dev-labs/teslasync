package io.teslasync.android.featureviews.weekselector

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [WeekSelectorContent] across the two branches the
 * web component renders (web/src/features/analytics/components/weekly-digest/WeekSelector.tsx): the current
 * week (the "Current" badge is shown and Next is disabled) and a past week (no badge, Next enabled). Also
 * drives the web contract — Previous always fires `onPrevWeek`, Next fires `onNextWeek` only when enabled —
 * and the blank-label em-dash fallback. Every asserted string is resolved from the app's i18n resources so
 * the test follows the device locale rather than hard-coding English, and each interactive control is
 * targeted by its TalkBack content description (the a11y label test). Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection.
 */
class WeekSelectorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private val prevLabel get() = string(R.string.translation_analytics_weeklyDigest_prevWeek)
    private val nextLabel get() = string(R.string.translation_analytics_weeklyDigest_nextWeek)
    private val currentLabel get() = string(R.string.translation_analytics_weeklyDigest_current)

    private fun setContent(
        weekLabel: String,
        isCurrentWeek: Boolean,
        onPrevWeek: () -> Unit = {},
        onNextWeek: () -> Unit = {},
        width: Dp = HOST_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.width(width)) {
                    WeekSelectorContent(
                        display = WeekSelectorProjection.project(weekLabel, isCurrentWeek),
                        onPrevWeek = onPrevWeek,
                        onNextWeek = onNextWeek,
                    )
                }
            }
        }
    }

    @Test
    fun currentWeekShowsLabelBadgeAndDisablesNext() {
        setContent(weekLabel = WEEK_LABEL, isCurrentWeek = true)

        compose.onNodeWithText(WEEK_LABEL).assertIsDisplayed()
        compose.onNodeWithText(currentLabel).assertIsDisplayed()
        // a11y labels present on both controls.
        compose.onNodeWithContentDescription(prevLabel).assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithContentDescription(nextLabel).assertIsDisplayed().assertIsNotEnabled()
    }

    @Test
    fun pastWeekHidesBadgeAndEnablesNext() {
        setContent(weekLabel = PAST_LABEL, isCurrentWeek = false)

        compose.onNodeWithText(PAST_LABEL).assertIsDisplayed()
        compose.onNodeWithText(currentLabel).assertDoesNotExist()
        compose.onNodeWithContentDescription(nextLabel).assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun previousClickInvokesCallback() {
        var prev = 0
        setContent(weekLabel = PAST_LABEL, isCurrentWeek = false, onPrevWeek = { prev++ })

        compose.onNodeWithContentDescription(prevLabel).performClick()

        assertEquals(1, prev)
    }

    @Test
    fun nextClickInvokesCallbackWhenEnabled() {
        var next = 0
        setContent(weekLabel = PAST_LABEL, isCurrentWeek = false, onNextWeek = { next++ })

        compose.onNodeWithContentDescription(nextLabel).performClick()

        assertEquals(1, next)
    }

    @Test
    fun nextStaysDisabledAndInertOnTheCurrentWeek() {
        var next = 0
        setContent(weekLabel = WEEK_LABEL, isCurrentWeek = true, onNextWeek = { next++ })

        compose.onNodeWithContentDescription(nextLabel).assertIsNotEnabled()
        assertEquals(0, next)
    }

    @Test
    fun blankLabelRendersTheEmDashFallback() {
        setContent(weekLabel = "", isCurrentWeek = false)

        compose.onNodeWithText(EM_DASH).assertIsDisplayed()
        assertFalse(WEEK_LABEL == EM_DASH)
    }

    private companion object {
        const val WEEK_LABEL = "Jun 9 \u2013 Jun 15"
        const val PAST_LABEL = "Jun 2 \u2013 Jun 8"
        const val EM_DASH = "\u2014"
        val HOST_WIDTH = 420.dp
    }
}
