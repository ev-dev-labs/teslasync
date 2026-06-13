package io.teslasync.android.featureviews.motorsection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [MotorSectionContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated eight-tile
 * grid, and the stale/offline cached view. Asserts the rendered i18n strings (resolved through the real catalog
 * via the default [motorSectionStrings]), each metric label + formatted value, the retry affordance, the
 * offline freshness chip's TalkBack label, and the loading announcement. The offline gate's `testReleaseUnitTest`
 * covers the pure projection; this covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx).
 */
class MotorSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun formatters(): MotorFormatters =
        MotorFormatters(
            number = { MotorSectionFormat.number(it, DEFAULT_DECIMAL_PRECISION, Locale.US) },
            integer = { MotorSectionFormat.integer(it, Locale.US) },
            temperature = { "${MotorSectionFormat.number(it, 1, Locale.US)}\u00B0C" },
        )

    private fun readout(): MotorReadout =
        MotorReadout(
            shiftState = "D",
            vbatFront = 396.0,
            vbatRear = 398.0,
            motorCurrentFront = 152.0,
            torqueNmFront = 180.0,
            torqueNmRear = 175.0,
            motorRpmFront = 1240.0,
            motorRpmRear = 1238.0,
            motorTempCFront = 48.0,
            motorTempCRear = 47.0,
        )

    private fun setContent(
        state: UiState<MotorReadout>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MotorSectionContent(state = state, onRetry = onRetry, formatters = formatters())
            }
        }
    }

    @Test
    fun loadingShowsTitleChromeAndAnnouncesLoadingNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertExists()
        // No metric label leaks while loading.
        compose.onNodeWithText("Shift State").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoMotorDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithText("No motor data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleEveryLocalizedLabelAndFormattedValues() {
        setContent(UiState(UiPhase.Content, data = readout()))
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        // Each web `t('vehicles.detail.*')` label resolves through the catalog (P1/S10).
        compose.onNodeWithText("Shift State").assertIsDisplayed()
        compose.onNodeWithText("Pack Voltage").assertIsDisplayed()
        compose.onNodeWithText("Motor Current (F)").assertIsDisplayed()
        compose.onNodeWithText("Front Torque").assertIsDisplayed()
        compose.onNodeWithText("Rear Torque").assertIsDisplayed()
        compose.onNodeWithText("Front RPM").assertIsDisplayed()
        compose.onNodeWithText("Rear RPM").assertIsDisplayed()
        compose.onNodeWithText("Motor Temp (peak)").assertIsDisplayed()
        // Web-parity formatted values (US locale, precision 2; RPM zero-suffix; peak temp).
        compose.onNodeWithText("D").assertIsDisplayed()
        compose.onNodeWithText("398.00 V").assertIsDisplayed()
        compose.onNodeWithText("152.00 A").assertIsDisplayed()
        compose.onNodeWithText("1,240").assertIsDisplayed()
        compose.onNodeWithText("48.0\u00B0C").assertIsDisplayed()
    }

    @Test
    fun missingFieldsRenderTheEmDashFallbackWithinAPresentSnapshot() {
        setContent(
            UiState(
                UiPhase.Content,
                data = readout().copy(shiftState = null, motorRpmFront = null),
            ),
        )
        // The grid still renders all labels; absent readings show the em-dash, never a blank.
        compose.onNodeWithText("Shift State").assertIsDisplayed()
        compose.onNodeWithText("Pack Voltage").assertIsDisplayed()
        compose.onAllNodesWithText("\u2014").onFirst().assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = readout(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithText("Pack Voltage").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = readout(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
