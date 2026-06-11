package io.teslasync.android.featureviews.securitystatuscards

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SecurityStatusCardsContent] across every state the
 * web component renders (loading skeletons, the six-card grid, empty → web default cards, hard error with
 * retry, stale/offline cached). Asserts the rendered i18n strings and the per-card merged TalkBack content
 * descriptions are present, and that the error-retry control fires. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this covers
 * the render + a11y.
 */
class SecurityStatusCardsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun secureSnapshot(): JsonElement =
        buildJsonObject {
            put("locked", true)
            put("sentry_mode", "On")
            put("door_state", "Closed")
            put("fd_window", "closed")
            put("fp_window", "closed")
            put("rd_window", "closed")
            put("rp_window", "closed")
            put("homelink_nearby", true)
            put("guest_mode", false)
        }

    @Composable
    private fun cardsStrings(): SecurityStatusCardsStrings =
        SecurityStatusCardsStrings(
            lockStatus = stringResource(R.string.translation_admin_security_card_lockStatus),
            lockDesc = stringResource(R.string.translation_admin_security_card_lockDesc),
            locked = stringResource(R.string.translation_admin_security_locked),
            unlocked = stringResource(R.string.translation_admin_security_unlocked),
            sentryMode = stringResource(R.string.translation_admin_security_card_sentryMode),
            sentryDesc = stringResource(R.string.translation_admin_security_card_sentryDesc),
            active = stringResource(R.string.translation_admin_security_active),
            inactive = stringResource(R.string.translation_admin_security_inactive),
            doors = stringResource(R.string.translation_admin_security_card_doors),
            doorsDesc = stringResource(R.string.translation_admin_security_card_doorsDesc),
            closed = stringResource(R.string.translation_admin_security_closed),
            open = stringResource(R.string.translation_admin_security_open),
            windows = stringResource(R.string.translation_admin_security_card_windows),
            windowsDesc = stringResource(R.string.translation_admin_security_card_windowsDesc),
            windowsAllClosed = stringResource(R.string.translation_widget_allClosed),
            homelink = stringResource(R.string.translation_admin_security_card_homelink),
            homelinkDesc = stringResource(R.string.translation_admin_security_card_homelinkDesc),
            nearby = stringResource(R.string.translation_admin_security_nearby),
            away = stringResource(R.string.translation_admin_security_away),
            guestMode = stringResource(R.string.translation_admin_security_card_guestMode),
            guestDesc = stringResource(R.string.translation_admin_security_card_guestDesc),
            enabled = stringResource(R.string.translation_admin_security_enabled),
            disabled = stringResource(R.string.translation_admin_security_disabled),
            snapshotLabel = stringResource(R.string.translation_admin_security_title),
        )

    private fun setCards(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SecurityStatusCardsContent(state = state, strings = cardsStrings(), onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = secureSnapshot(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCards() {
        setCards(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Lock Status").assertDoesNotExist()
        compose.onNodeWithText("Locked").assertDoesNotExist()
    }

    @Test
    fun contentShowsCardTitlesAndValues() {
        setCards(contentState())
        compose.onNodeWithText("Lock Status").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("All Closed").assertIsDisplayed()
        compose.onNodeWithText("Nearby").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
    }

    @Test
    fun cardsExposeMergedTalkBackLabels() {
        setCards(contentState())
        compose.onNodeWithContentDescription("Lock Status, Locked, Vehicle lock state").assertIsDisplayed()
        compose.onNodeWithContentDescription("HomeLink, Nearby, Garage door opener").assertIsDisplayed()
    }

    @Test
    fun emptyRendersWebDefaultCardsNotBlank() {
        setCards(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("Unlocked").assertIsDisplayed()
        compose.onNodeWithText("Inactive").assertIsDisplayed()
        compose.onNodeWithText("Away").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
    }

    @Test
    fun errorShowsQueryErrorWithRetry() {
        var refreshed = false
        setCards(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Lock Status").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCardsVisible() {
        setCards(
            UiState(
                phase = UiPhase.Content,
                data = secureSnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("All Closed").assertIsDisplayed()
    }
}
