package io.teslasync.android.featureviews.regionsettings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.TeslaRegionData
import io.teslasync.shared.core.presentation.user.TeslaRegionEnvelope
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [RegionSettingsContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the empty state (no resolved region),
 * the populated region grid (region code + Fleet API base URL), the stale/offline cached view, and the
 * always-visible header + Refresh affordance. Mirrors the web spec
 * (web/src/features/settings/components/RegionSettings.tsx).
 */
class RegionSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fleetUrl = "https://fleet-api.prd.na.vn.cloud.tesla.com"

    private fun envelope(
        region: String = "North America",
        fleetApiBaseUrl: String = fleetUrl,
        fetchedAt: String? = "2026-06-12T14:30:00Z",
    ): TeslaRegionEnvelope =
        TeslaConfigEnvelope(
            data = TeslaRegionData(region = region, fleetApiBaseUrl = fleetApiBaseUrl),
            fetchedAt = fetchedAt,
        )

    private fun setContent(
        state: UiState<TeslaRegionEnvelope>,
        refreshing: Boolean = false,
        onRefresh: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RegionSettingsContent(
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
        compose.onNodeWithText("Region & API").assertIsDisplayed()
        compose.onNodeWithText("Tesla account region and Fleet API endpoint").assertIsDisplayed()
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
    fun emptyShowsNoRegionDataYet() {
        setContent(UiState(UiPhase.Empty, data = envelope(region = "", fetchedAt = null)))
        compose.onNodeWithText("No region data yet. Click Refresh to fetch from Tesla.").assertIsDisplayed()
    }

    @Test
    fun contentRendersRegionCodeAndFleetApiUrl() {
        setContent(UiState(UiPhase.Content, data = envelope()))
        compose.onNodeWithText("Region").assertIsDisplayed()
        compose.onNodeWithText("North America").assertIsDisplayed()
        compose.onNodeWithText("Fleet API Base URL").assertIsDisplayed()
        compose.onNodeWithText(fleetUrl).assertIsDisplayed()
    }

    @Test
    fun contentFallsBackToEmDashForBlankUrl() {
        setContent(UiState(UiPhase.Content, data = envelope(region = "cn", fleetApiBaseUrl = "")))
        compose.onNodeWithText("cn").assertIsDisplayed()
        compose.onNodeWithText("\u2014").assertIsDisplayed()
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
                data = envelope(region = "Europe", fleetApiBaseUrl = "https://fleet-api.prd.eu.vn.cloud.tesla.com"),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Europe").assertIsDisplayed()
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
