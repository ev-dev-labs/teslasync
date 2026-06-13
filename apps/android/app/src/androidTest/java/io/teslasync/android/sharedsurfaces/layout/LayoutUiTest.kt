package io.teslasync.android.sharedsurfaces.layout

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of the Layout shared surface across every state the
 * web app shell renders (web/src/components/layout/Layout.tsx): the loading skeleton chrome, the grouped
 * nav + the routed content slot, the no-vehicles empty state, the stale/offline freshness chips, and the
 * classified error with a working Retry. The chrome's interactive affordances expose their TalkBack labels
 * (a11y label test); the stateful path is exercised end to end against the real ViewModel + source seam.
 * Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers
 * the render.
 */
class LayoutUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): LayoutStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return LayoutStrings(
            primaryNav = ctx.getString(R.string.translation_a11y_primaryNav),
            primaryHeader = ctx.getString(R.string.translation_a11y_primaryHeader),
            openSidebar = ctx.getString(R.string.translation_nav_openSidebar),
            closeSidebar = ctx.getString(R.string.translation_nav_closeSidebar),
            current = ctx.getString(R.string.translation_nav_currentSection),
            pinned = ctx.getString(R.string.translation_nav_pinned),
            pinAction = ctx.getString(R.string.translation_nav_pinAction),
            pinnedAction = ctx.getString(R.string.translation_nav_pinnedAction),
            pinCurrent = ctx.getString(R.string.translation_nav_pinCurrent),
            unpinCurrent = ctx.getString(R.string.translation_nav_unpinCurrent),
            unpinPageTemplate = ctx.getString(R.string.translation_nav_unpinPage),
            recentlyUsed = ctx.getString(R.string.translation_nav_recentlyUsed),
            sections = ctx.getString(R.string.translation_nav_sections),
            expandAll = ctx.getString(R.string.translation_nav_expandAll),
            collapseAll = ctx.getString(R.string.translation_nav_collapseAll),
            quickSearchHint = ctx.getString(R.string.translation_nav_quickSearchHint),
            openThemePicker = ctx.getString(R.string.translation_theme_openPicker),
            customize = ctx.getString(R.string.translation_theme_customize),
            alertTitle = ctx.getString(R.string.translation_alerts_toast_title),
            viewAction = ctx.getString(R.string.translation_alerts_toast_view),
            notifications = ctx.getString(R.string.nav_group_notifications),
            loading = ctx.getString(R.string.translation_common_loading),
            stale = ctx.getString(R.string.translation_mqtt_stale),
            offline = ctx.getString(R.string.translation_common_offline),
            noVehiclesTitle = ctx.getString(R.string.translation_commands_noVehicles),
            noVehiclesMessage = ctx.getString(R.string.translation_common_noVehicleSelected_desc),
        )
    }

    private fun setChrome(
        vehicles: UiState<List<Vehicle>>,
        alerts: UiState<List<Alert>> = UiState(UiPhase.Content, data = emptyList(), fetchedAt = STAMP),
        onRetry: () -> Unit = {},
        content: @Composable () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    LayoutChrome(
                        vehicles = vehicles,
                        alerts = alerts,
                        isForwardAuth = true,
                        activeWebPath = "/charging",
                        strings = strings(),
                        onRetry = onRetry,
                        content = content,
                    )
                }
            }
        }
    }

    private fun present(nodes: () -> Int): Boolean = nodes() > 0

    @Test
    fun loadingRendersChromeAndAnnouncesLoading() {
        val labels = strings()
        setChrome(vehicles = UiState.loading(), alerts = UiState.loading())
        compose.onNodeWithTag(LAYOUT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithTag(LAYOUT_SIDEBAR_TEST_TAG).assertIsDisplayed()
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.loading).fetchSemanticsNodes().size })
    }

    @Test
    fun contentRendersSectionsAndTheRoutedSlot() {
        val labels = strings()
        setChrome(vehicles = fleet(), content = { BodyText(SLOT_TEXT) })
        compose.onNodeWithText(SLOT_TEXT).assertIsDisplayed()
        assertTrue(present { compose.onAllNodesWithText(labels.sections).fetchSemanticsNodes().size })
    }

    @Test
    fun emptyRendersTheNoVehiclesState() {
        val labels = strings()
        setChrome(vehicles = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = STAMP))
        compose.onNodeWithText(labels.noVehiclesTitle).assertIsDisplayed()
    }

    @Test
    fun errorOffersAWorkingRetry() {
        var retried = false
        setChrome(
            vehicles = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
            onRetry = { retried = true },
        )
        compose.onNodeWithText(RETRY_LABEL).assertIsDisplayed()
        compose.onNodeWithText(RETRY_LABEL).performClick()
        assertTrue(retried)
    }

    @Test
    fun staleStateShowsTheStaleChip() {
        val labels = strings()
        setChrome(
            vehicles = UiState(UiPhase.Content, data = listOf(vehicle()), fetchedAt = STAMP, stale = true, refreshing = true),
        )
        assertTrue(present { compose.onAllNodesWithText(labels.stale).fetchSemanticsNodes().size })
    }

    @Test
    fun offlineStateShowsTheOfflineChip() {
        val labels = strings()
        setChrome(
            vehicles = UiState(UiPhase.Content, data = listOf(vehicle()), fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network),
        )
        assertTrue(present { compose.onAllNodesWithText(labels.offline).fetchSemanticsNodes().size })
    }

    @Test
    fun chromeExposesAccessibilityLabels() {
        val labels = strings()
        setChrome(vehicles = fleet(), content = { BodyText(SLOT_TEXT) })
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.closeSidebar).fetchSemanticsNodes().size })
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.expandAll).fetchSemanticsNodes().size })
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.collapseAll).fetchSemanticsNodes().size })
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.openThemePicker).fetchSemanticsNodes().size })
        assertTrue(present { compose.onAllNodesWithContentDescription(labels.notifications).fetchSemanticsNodes().size })
    }

    @Test
    fun statefulLayoutBindsTheFleetFeed() {
        val source =
            object : LayoutSource {
                override fun vehicles(): Flow<Resource<List<Vehicle>>> =
                    MutableStateFlow(Resource.Success(listOf(vehicle()), fetchedAt = STAMP, stale = false))

                override fun alerts(): Flow<Resource<List<Alert>>> =
                    MutableStateFlow(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false))

                override fun isForwardAuth(): StateFlow<Boolean> = MutableStateFlow(false)
            }
        val vm = LayoutViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Layout(viewModel = vm, activeWebPath = "/charging", content = { BodyText(SLOT_TEXT) })
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(LAYOUT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(SLOT_TEXT).assertIsDisplayed()
    }

    private fun fleet(): UiState<List<Vehicle>> = UiState(UiPhase.Content, data = listOf(vehicle()), fetchedAt = STAMP)

    private fun vehicle(): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Garage Car",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = 1,
            teslaId = 1,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN1",
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_SERVER_ERROR = 503
        const val SLOT_TEXT = "Charging overview"
        const val RETRY_LABEL = "Retry"
    }
}
