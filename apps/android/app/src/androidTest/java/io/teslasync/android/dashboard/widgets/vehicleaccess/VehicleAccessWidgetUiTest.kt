package io.teslasync.android.dashboard.widgets.vehicleaccess

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [VehicleAccessWidgetContent] across every state the
 * web component renders (loading skeleton, standard mobile-badge + driver/invitation detail lists, compact
 * driver-count summary, no-data empty, no-drivers line, offline-cached). Asserts the rendered i18n strings
 * and the merged TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class VehicleAccessWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = VehicleAccessRegistration.DEFAULT_SIZE
    private val compact = VehicleAccessSize(cols = 1, rows = 2)

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("Vehicle Access").assertDoesNotExist()
        rule.onNodeWithText("No access data available").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoAccessData() {
        setContent(UiState(phase = UiPhase.Empty, data = VehicleAccessData.EMPTY, fetchedAt = NOW))
        rule.onNodeWithText("Vehicle Access").assertIsDisplayed()
        rule.onNodeWithText("No access data available").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleMobileBadgeAndDriverRows() {
        setContent(UiState(phase = UiPhase.Content, data = fullData(), fetchedAt = NOW))
        rule.onNodeWithText("Vehicle Access").assertIsDisplayed()
        rule.onNodeWithText("Mobile Access").assertIsDisplayed()
        rule.onNodeWithText("Enabled").assertIsDisplayed()
        rule.onNodeWithText("Authorized Drivers").assertIsDisplayed()
        // Each driver row folds its name + date + role into one TalkBack phrase.
        rule.onNodeWithContentDescription("Ada Lovelace", substring = true).assertIsDisplayed()
    }

    @Test
    fun pendingInvitationsSectionRendersWhenPresent() {
        setContent(UiState(phase = UiPhase.Content, data = fullData(), fetchedAt = NOW))
        rule.onNodeWithText("Pending Invitations").assertIsDisplayed()
        rule.onNodeWithContentDescription("owner@example.com", substring = true).assertIsDisplayed()
    }

    @Test
    fun driversEmptyShowsNoAuthorizedDriversLine() {
        // Mobile known (hasData) but no drivers ⇒ the drivers detail card shows its empty line.
        setContent(UiState(phase = UiPhase.Content, data = mobileOnlyData(), fetchedAt = NOW))
        rule.onNodeWithText("No authorized drivers").assertIsDisplayed()
    }

    @Test
    fun compactShowsDriverCountSummaryWithTitle() {
        setContent(UiState(phase = UiPhase.Content, data = fullData(), fetchedAt = NOW), size = compact)
        rule.onNodeWithText("Vehicle Access").assertIsDisplayed()
        rule.onNodeWithContentDescription("2 Drivers", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = fullData(),
                fetchedAt = NOW,
                stale = true,
                errorKind = io.teslasync.android.data.ErrorKind.Network,
            ),
        )
        rule.onNodeWithContentDescription("Ada Lovelace", substring = true).assertIsDisplayed()
    }

    @Test
    fun refreshControlExposesAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = fullData(), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<VehicleAccessData>,
        size: VehicleAccessSize = default,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleAccessWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun fullData(): VehicleAccessData =
        VehicleAccessData(
            drivers =
                listOf(
                    driver(id = 1, name = "Ada Lovelace", role = "owner"),
                    driver(id = 2, name = "Grace Hopper", role = "driver"),
                ),
            invitations =
                listOf(
                    VehicleInvitation(
                        id = 3,
                        vehicleId = 1,
                        invitationId = "inv-1",
                        status = "pending",
                        createdBy = "owner@example.com",
                        fetchedAt = "2024-05-12T10:00:00Z",
                        createdAt = "2024-05-12T10:00:00Z",
                    ),
                ),
            mobileEnabled = true,
        )

    private fun mobileOnlyData(): VehicleAccessData =
        VehicleAccessData(drivers = emptyList(), invitations = emptyList(), mobileEnabled = true)

    private fun driver(
        id: Long,
        name: String,
        role: String,
    ): VehicleDriver =
        VehicleDriver(
            id = id,
            vehicleId = 1,
            driverEmail = "driver$id@example.com",
            driverName = name,
            role = role,
            fetchedAt = "2024-05-10T09:00:00Z",
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
