package io.teslasync.android.featureviews.activeorderssection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.user.TeslaOrder
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [ActiveOrdersSectionContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the two empty states (fetched vs
 * never-fetched), the populated order grid (model, status badge, Order ID, VIN, Delivery Date, Upgradable),
 * the stale/offline cached view, and the always-visible header + Refresh affordance. Mirrors the web spec
 * (web/src/features/settings/components/ActiveOrdersSection.tsx).
 */
class ActiveOrdersSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Suppress("LongParameterList") // test data builder; production TeslaOrder is a data class
    private fun order(
        orderId: String = "RN123456789",
        model: String = "Model 3",
        status: String = "READY_FOR_TRANSPORT",
        deliveryDate: String? = "2026-07-15",
        vin: String? = "5YJ3E1EA7PF000000",
        isUpgradable: Boolean = true,
    ): TeslaOrder =
        TeslaOrder(
            id = 1,
            orderId = orderId,
            model = model,
            status = status,
            deliveryDate = deliveryDate,
            vin = vin,
            isUpgradable = isUpgradable,
            fetchedAt = "2026-06-12T14:30:00Z",
        )

    private fun envelope(
        orders: List<TeslaOrder> = listOf(order()),
        fetchedAt: String? = "2026-06-12T14:30:00Z",
    ): TeslaOrdersEnvelope = TeslaOrdersEnvelope(orders = orders, fetchedAt = fetchedAt)

    private fun setContent(
        state: UiState<TeslaOrdersEnvelope>,
        refreshing: Boolean = false,
        onRefresh: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ActiveOrdersSectionContent(
                    state = state,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    onRetry = onRetry,
                    zone = ZoneId.of("UTC"),
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun headerAlwaysRendersTitleSubtitleAndRefresh() {
        setContent(UiState(UiPhase.Content, data = envelope()))
        compose.onNodeWithText("Active Orders").assertIsDisplayed()
        compose.onNodeWithText("Vehicle orders and delivery tracking from Tesla").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyAfterFetchShowsNoOrdersFound() {
        setContent(UiState(UiPhase.Empty, data = envelope(orders = emptyList(), fetchedAt = "2026-06-12T14:30:00Z")))
        compose.onNodeWithText("No active orders found.").assertIsDisplayed()
    }

    @Test
    fun emptyBeforeFetchShowsNoDataYet() {
        setContent(UiState(UiPhase.Empty, data = envelope(orders = emptyList(), fetchedAt = null)))
        compose.onNodeWithText("No order data yet. Click Refresh to fetch from Tesla.").assertIsDisplayed()
    }

    @Test
    fun contentRendersModelStatusOrderIdVinDeliveryAndUpgradable() {
        setContent(UiState(UiPhase.Content, data = envelope()))
        compose.onNodeWithText("Model 3").assertIsDisplayed()
        compose.onNodeWithText("Ready For Transport").assertIsDisplayed()
        compose.onNodeWithText("Order ID").assertIsDisplayed()
        compose.onNodeWithText("RN123456789").assertIsDisplayed()
        compose.onNodeWithText("VIN").assertIsDisplayed()
        compose.onNodeWithText("5YJ3E1EA7PF000000").assertIsDisplayed()
        compose.onNodeWithText("Delivery Date").assertIsDisplayed()
        compose.onNodeWithText("Jul 15", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Upgradable").assertIsDisplayed()
    }

    @Test
    fun contentHidesOptionalRowsWhenAbsent() {
        setContent(
            UiState(
                UiPhase.Content,
                data = envelope(orders = listOf(order(vin = null, deliveryDate = null, isUpgradable = false))),
            ),
        )
        compose.onNodeWithText("Model 3").assertIsDisplayed()
        compose.onNodeWithText("VIN").assertDoesNotExist()
        compose.onNodeWithText("Delivery Date").assertDoesNotExist()
        compose.onNodeWithText("Upgradable").assertDoesNotExist()
    }

    @Test
    fun refreshButtonInvokesOnRefresh() {
        var refreshed = false
        setContent(state = UiState(UiPhase.Content, data = envelope()), onRefresh = { refreshed = true })
        compose.onNodeWithText("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = envelope(orders = listOf(order(model = "Cached Model S"))),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Cached Model S").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleNonErrorTriggersAutoRefresh() {
        var retried = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = envelope(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { retried = true },
        )
        compose.waitForIdle()
        assertTrue(retried)
    }
}
