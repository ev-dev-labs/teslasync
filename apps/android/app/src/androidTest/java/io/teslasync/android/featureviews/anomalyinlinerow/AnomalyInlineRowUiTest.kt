package io.teslasync.android.featureviews.anomalyinlinerow

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of [AnomalyInlineRowContent] across every state the web
 * component resolves (loading skeleton, the content Health row, empty → "No anomalies", hard error with a
 * Retry control, stale/offline cached). Asserts the rendered i18n strings, the merged row TalkBack content
 * description, and that the error-retry control fires. Runs under `connectedAndroidTest` (a device/emulator)
 * — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this covers render + a11y.
 */
class AnomalyInlineRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val detectedAt = "2026-06-01T12:00:00Z"
    private val fixedNow: Long = Instant.parse("2026-06-01T12:05:00Z").toEpochMilli()

    private fun envelope(
        count: Int,
        severity: String,
        signal: String,
    ): JsonElement =
        buildJsonObject {
            put("anomalies_last_24h", count)
            putJsonArray("anomalies") {
                add(
                    buildJsonObject {
                        put("signal", signal)
                        put("severity", severity)
                        put("detected_at", detectedAt)
                    },
                )
            }
        }

    private fun setRow(
        state: UiState<JsonElement>,
        onOpen: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnomalyInlineRowContent(
                    state = state,
                    onOpen = onOpen,
                    onRetry = onRetry,
                    nowMs = { fixedNow },
                )
            }
        }
    }

    private fun contentState(): UiState<JsonElement> =
        UiState(phase = UiPhase.Content, data = envelope(3, "critical", "BatteryVoltage"), fetchedAt = 1L)

    @Test
    fun contentShowsLabelAndSummary() {
        setRow(contentState())
        compose.onNodeWithText("Anomalies").assertIsDisplayed()
        compose.onNodeWithText("active", substring = true).assertIsDisplayed()
        compose.onNodeWithText("BatteryVoltage", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentExposesMergedTalkBackLabel() {
        setRow(contentState())
        compose.onNodeWithContentDescription("Anomalies", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("BatteryVoltage", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentRowNavigatesOnClick() {
        var opened = false
        setRow(contentState(), onOpen = { opened = true })
        compose.onNodeWithContentDescription("Anomalies", substring = true).performClick()
        assertTrue(opened)
    }

    @Test
    fun emptyRendersNoAnomaliesNotBlank() {
        setRow(UiState(phase = UiPhase.Empty, data = envelope(0, "info", ""), fetchedAt = 1L))
        compose.onNodeWithText("Anomalies").assertIsDisplayed()
        compose.onNodeWithText("No anomalies").assertIsDisplayed()
    }

    @Test
    fun loadingShowsLabelNotSummary() {
        setRow(UiState.loading())
        compose.onNodeWithText("Anomalies").assertIsDisplayed()
        compose.onNodeWithText("active", substring = true).assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryControlThatFires() {
        var retried = false
        setRow(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithContentDescription("Retry").assertIsDisplayed()
        compose.onNodeWithContentDescription("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedSummaryWithChip() {
        setRow(
            UiState(
                phase = UiPhase.Content,
                data = envelope(2, "warning", "TirePressureFL"),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("active", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }
}
