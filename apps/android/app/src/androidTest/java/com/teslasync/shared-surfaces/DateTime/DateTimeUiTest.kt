// Instrumented Compose UI + accessibility verification of [DateTimeContent] across the states the web DateTime
// renders: the content state (the formatted timestamp + its timezone abbreviation), the empty state (the
// em-dash marker for a null value), the relative variant, and the zone feed's updating / stale / offline /
// hard-error states (each surfacing the freshness chip beside the always-rendered timestamp, with the
// offline/failed chip offering a Retry affordance). Also asserts the merged TalkBack content description.
// Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the
// pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class DateTimeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun state(
        phase: UiPhase,
        stale: Boolean = false,
        refreshing: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<DateTimeSettings> =
        UiState(
            phase = phase,
            data = if (phase == UiPhase.Error) null else DateTimeSettings.DEFAULTS,
            fetchedAt = 0L,
            stale = stale,
            refreshing = refreshing,
            errorKind = errorKind,
        )

    private fun setContent(
        value: String?,
        feedState: UiState<DateTimeSettings>,
        variant: DateTimeVariant = DateTimeVariant.Full,
        showTz: Boolean = false,
        nowMillis: Long = 0L,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DateTimeContent(
                    value = value,
                    state = feedState,
                    variant = variant,
                    explicitMode = TzMode.Utc,
                    showTz = showTz,
                    nowMillis = if (nowMillis == 0L) System.currentTimeMillis() else nowMillis,
                )
            }
        }
    }

    @Test
    fun contentStateRendersTheFormattedTimestamp() {
        setContent(value = VALUE, feedState = state(UiPhase.Content), showTz = true)
        compose.onNodeWithText(YEAR, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(YEAR, substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersTheEmDashMarker() {
        setContent(value = null, feedState = state(UiPhase.Content))
        compose.onNodeWithText(EM_DASH, substring = true).assertIsDisplayed()
    }

    @Test
    fun relativeVariantRendersTheLocalizedAgoPhrase() {
        val now = (parseInstant(VALUE)?.toEpochMilli() ?: 0L) + FIVE_MINUTES
        setContent(
            value = VALUE,
            feedState = state(UiPhase.Content),
            variant = DateTimeVariant.Relative,
            nowMillis = now,
        )
        compose.onNodeWithText(AGO, substring = true).assertIsDisplayed()
    }

    @Test
    fun updatingStateShowsTheUpdatingChip() {
        setContent(value = VALUE, feedState = state(UiPhase.Content, refreshing = true))
        compose.onNodeWithText(UPDATING, substring = true).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleChip() {
        setContent(value = VALUE, feedState = state(UiPhase.Content, stale = true))
        compose.onNodeWithText(STALE, substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineRetryChipBesideTheValue() {
        setContent(
            value = VALUE,
            feedState = state(UiPhase.Content, stale = true, errorKind = ErrorKind.Network),
        )
        compose.onNodeWithText(YEAR, substring = true).assertIsDisplayed()
        compose.onNodeWithText(OFFLINE, substring = true).assertIsDisplayed()
    }

    @Test
    fun hardErrorStateKeepsTheValueAndShowsTheOfflineChip() {
        setContent(value = VALUE, feedState = state(UiPhase.Error, errorKind = ErrorKind.Http))
        compose.onNodeWithText(YEAR, substring = true).assertIsDisplayed()
        compose.onNodeWithText(OFFLINE, substring = true).assertIsDisplayed()
    }

    private companion object {
        const val VALUE = "2026-04-04T14:30:00Z"
        const val YEAR = "2026"
        const val EM_DASH = "\u2014"
        const val AGO = "ago"

        // English catalog values resolved on-device.
        const val UPDATING = "updating"
        const val STALE = "Stale"
        const val OFFLINE = "Offline"

        const val FIVE_MINUTES = 5L * 60L * 1000L
    }
}
