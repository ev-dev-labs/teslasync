package io.teslasync.android.sharedsurfaces.servicestatus

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ServiceStatus shared surface across every state the
 * web component renders (web/src/components/data-display/ServiceStatus.tsx): the healthy/degraded/down dot, the
 * cold-start loading dot, the connected-but-idle empty surface, the connected-but-stale chip, and the offline
 * banner with its reconnect affordance. It asserts the rendered i18n label, the merged "System Health: {label}"
 * TalkBack description (web `title="System: {overall}"`), and that the reconnect control is a labelled, clickable
 * element. Reduced motion keeps the loading pulse from holding the test clock busy. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class ServiceStatusUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val stamp = 1_700_000_000_000L

    private fun s(id: Int) = context.getString(id)

    /** The merged panel description "System Health: {label}" (web `title="System: {overall}"`). */
    private fun spoken(labelId: Int) = s(R.string.translation_widget_systemHealth_title) + ": " + s(labelId)

    private fun strings(): ServiceStatusStrings =
        ServiceStatusStrings(
            title = s(R.string.translation_widget_systemHealth_title),
            healthy = s(R.string.translation_widget_systemHealth_healthy),
            degraded = s(R.string.translation_widget_systemHealth_degraded),
            down = s(R.string.translation_widget_systemHealth_down),
            unknown = s(R.string.translation_common_unknown),
            noData = s(R.string.translation_widget_systemHealth_noData),
            stale = s(R.string.translation_mqtt_stale),
            loading = s(R.string.translation_a11y_loading),
            offlineTitle = s(R.string.translation_error_network_offlineTitle),
            offlineDetail = s(R.string.translation_error_network_offlineDetail),
            reconnect = s(R.string.translation_error_network_retryWhenOnline),
        )

    private fun render(
        status: LiveConnectionStatus,
        lastMessageAtMillis: Long? = stamp,
        stale: Boolean = false,
    ): ServiceStatusRender = ServiceStatusProjection.render(ServiceStatusSnapshot(status, lastMessageAtMillis, stale))

    private fun setSurface(render: ServiceStatusRender) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ServiceStatusContent(render = render, strings = strings())
                }
            }
        }
    }

    @Test
    fun healthyShowsHealthyLabelAndPanelIsLabelled() {
        setSurface(render(LiveConnectionStatus.Connected))

        compose.onNodeWithText(s(R.string.translation_widget_systemHealth_healthy), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(spoken(R.string.translation_widget_systemHealth_healthy)).assertIsDisplayed()
        compose.onNodeWithTag(SERVICE_STATUS_BANNER_TAG).assertDoesNotExist()
    }

    @Test
    fun reconnectingShowsDegradedAndNoBanner() {
        setSurface(render(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))

        compose.onNodeWithText(s(R.string.translation_widget_systemHealth_degraded), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(SERVICE_STATUS_BANNER_TAG).assertDoesNotExist()
    }

    @Test
    fun offlineShowsBannerDownDotAndReconnectAffordance() {
        setSurface(render(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null))

        compose.onNodeWithTag(SERVICE_STATUS_BANNER_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_error_network_offlineTitle)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_error_network_offlineDetail)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_widget_systemHealth_down), useUnmergedTree = true).assertIsDisplayed()
        // The reconnect control is a labelled, clickable element (a11y).
        compose.onNodeWithText(s(R.string.translation_error_network_retryWhenOnline)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun staleShowsTheStaleChip() {
        setSurface(render(LiveConnectionStatus.Connected, stale = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_widget_systemHealth_degraded), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTheLoadingLabel() {
        setSurface(render(LiveConnectionStatus.Unknown, lastMessageAtMillis = null))

        compose.onNodeWithText(s(R.string.translation_a11y_loading), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(spoken(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoDataCaption() {
        setSurface(render(LiveConnectionStatus.Connected, lastMessageAtMillis = null))

        compose.onNodeWithText(s(R.string.translation_widget_systemHealth_noData), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(SERVICE_STATUS_DOT_TAG).assertIsDisplayed()
    }
}
