package io.teslasync.android.dashboard.widgets.vehicleupgrades

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.sharing.ShareToken
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [VehicleUpgradesWidgetContent] across every state the
 * web component renders (loading skeleton; hard error + retry; standard upgrades list with title + refresh +
 * price/eligibility badges; the share-links summary; the compact upgrade-count hero; the friendly "all
 * applied" + "no share links" empties; stale/offline cached). Asserts the rendered i18n strings and the
 * per-row + hero + summary TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline `testReleaseUnitTest` gate covers the projection + state logic; this covers
 * render + a11y.
 */
class VehicleUpgradesWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = VehicleUpgradesRegistration.defaultSize
    private val compactSize = VehicleUpgradesSize(cols = 1, rows = 2)

    /** A snapshot with one eligible (priced) + one ineligible upgrade and one active (future) share link. */
    private fun populatedSnapshot(): VehicleUpgradesSnapshot =
        VehicleUpgradesSnapshot(
            upgradesData =
                buildJsonObject {
                    put(
                        "upgrades",
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("name", "Boost")
                                    put("price", "2000")
                                    put("eligible", true)
                                },
                            )
                            add(
                                buildJsonObject {
                                    put("name", "FSD")
                                    put("eligible", false)
                                },
                            )
                        },
                    )
                },
            shareLinks = listOf(shareToken(1, "2099-06-01")),
        )

    private fun setContent(
        state: UiState<VehicleUpgradesSnapshot>,
        size: VehicleUpgradesSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleUpgradesWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = NOW,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleRowsAndBadges() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Upgrades & Sharing").assertIsDisplayed()
        compose.onNodeWithText("Available Upgrades").assertIsDisplayed()
        // Each upgrade row folds name + price + eligibility into one TalkBack phrase.
        compose.onNodeWithContentDescription("Boost, $2000, Eligible", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("FSD, Not eligible", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentShowsShareLinkSummary() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Share Links").assertIsDisplayed()
        compose.onNodeWithContentDescription("Active links, 1", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Nearest expiry, Jun 1, 2099", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsUpgradeCountHero() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            size = compactSize,
        )
        // One eligible upgrade ⇒ the compact tile folds "1 available" into one phrase.
        compose.onNodeWithContentDescription("1 available", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsAllAppliedAndNoShareLinks() {
        setContent(UiState(UiPhase.Empty, data = VehicleUpgradesSnapshot.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("All upgrades applied").assertIsDisplayed()
        compose.onNodeWithText("No active share links").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedSnapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Boost", substring = true).assertIsDisplayed()
    }

    private fun shareToken(
        id: Long,
        expiresAt: String?,
    ): ShareToken =
        ShareToken(
            id = id,
            token = "tok$id",
            driveId = 1L,
            includeMap = true,
            includeTelemetry = false,
            includeSpeed = true,
            views = 0,
            expiresAt = expiresAt,
            createdAt = "2024-01-01T00:00:00Z",
        )

    private companion object {
        /** 2025-06-11T00:00:00Z — keeps the 2099 share link comfortably in the future. */
        const val NOW: Long = 1_749_600_000_000L
    }
}
