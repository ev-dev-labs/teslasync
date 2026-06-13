package io.teslasync.android.sharedsurfaces.maintenancebanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of the MaintenanceBanner shared surface across every state
 * the web component renders (web/src/components/feedback/MaintenanceBanner.tsx): the amber maintenance variant
 * with its title / body / countdown, the sky degraded variant with the default copy, the hidden (`mode === 'ok'`)
 * state, the offline / last-known "Stale" chip, and the labelled dismiss control. It asserts the rendered i18n
 * copy and that the dismiss control is a labelled, clickable element. Reduced motion keeps the FadeIn from
 * holding the test clock busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the
 * pure projection, this covers the render.
 */
class MaintenanceBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val now = Instant.parse("2025-01-01T12:00:00Z").toEpochMilli()
    private val untilFuture = "2025-01-01T12:30:00Z"

    private fun s(id: Int) = context.getString(id)

    private fun s(
        id: Int,
        arg: String,
    ) = context.getString(id, arg)

    private fun strings(): MaintenanceBannerStrings =
        MaintenanceBannerStrings(
            maintenanceTitle = s(R.string.translation_serviceMode_banner_maintenanceTitle),
            degradedTitle = s(R.string.translation_serviceMode_banner_degradedTitle),
            defaultMaintenance = s(R.string.translation_serviceMode_banner_defaultMaintenance),
            defaultDegraded = s(R.string.translation_serviceMode_banner_defaultDegraded),
            endingNow = s(R.string.translation_serviceMode_banner_endingNow),
            ended = s(R.string.translation_serviceMode_banner_ended),
            dismiss = s(R.string.translation_common_dismiss),
            stale = s(R.string.translation_mqtt_stale),
        )

    private fun render(
        mode: String,
        until: String = "",
        message: String = "",
        stale: Boolean = false,
    ): MaintenanceBannerRender =
        MaintenanceBannerProjection.render(
            MaintenanceBannerSnapshot(rawMode = mode, message = message, untilIso = until, updatedAtIso = "u-1", present = true),
            nowMs = now,
            dismissedKey = null,
            stale = stale,
        )

    private fun setSurface(render: MaintenanceBannerRender) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    MaintenanceBannerContent(render = render, strings = strings())
                }
            }
        }
    }

    @Test
    fun maintenanceShowsTitleBodyAndCountdown() {
        setSurface(render(ServiceMode.RAW_MAINTENANCE, until = untilFuture, message = "DB upgrade in progress"))

        compose.onNodeWithTag(MAINTENANCE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_serviceMode_banner_maintenanceTitle), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("DB upgrade in progress", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(MAINTENANCE_BANNER_COUNTDOWN_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithText(s(R.string.translation_serviceMode_banner_endsIn, "30m 00s"), useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test
    fun degradedShowsTitleAndDefaultCopy() {
        setSurface(render(ServiceMode.RAW_DEGRADED))

        compose.onNodeWithTag(MAINTENANCE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_serviceMode_banner_degradedTitle), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_serviceMode_banner_defaultDegraded), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun okModeRendersNoBanner() {
        setSurface(render(ServiceMode.RAW_OK))

        compose.onNodeWithTag(MAINTENANCE_BANNER_TEST_TAG).assertDoesNotExist()
    }

    @Test
    fun staleActiveWindowShowsTheStaleChip() {
        setSurface(render(ServiceMode.RAW_MAINTENANCE, stale = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun endingNowShowsTheImminentCopy() {
        setSurface(render(ServiceMode.RAW_MAINTENANCE, until = "2025-01-01T12:00:00Z"))

        compose.onNodeWithText(s(R.string.translation_serviceMode_banner_endingNow), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun dismissControlIsLabelledAndClickable() {
        setSurface(render(ServiceMode.RAW_MAINTENANCE))

        // The dismiss control carries the localized "Dismiss" label and is a clickable, focusable element (a11y).
        compose.onNodeWithContentDescription(s(R.string.translation_common_dismiss)).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(MAINTENANCE_BANNER_DISMISS_TAG, useUnmergedTree = true).assertHasClickAction()
    }
}
