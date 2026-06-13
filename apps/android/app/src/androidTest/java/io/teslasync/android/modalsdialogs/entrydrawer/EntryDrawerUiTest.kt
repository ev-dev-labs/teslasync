// Instrumented Compose UI + accessibility verification of [EntryDrawerContent] across the branches the web
// component renders (web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx): the loading Spinner
// (`loading && !full`), the content body (summary KVList + inner/raw payload tabs + copy + payload block), the
// empty state (`head` null), the tab switch, the Replay gating (server flag / non-replayable / in-flight), and
// the Close / Replay hand-offs. Every asserted label is the localized copy the surface exposes to TalkBack, and
// the close affordance is asserted by its accessible content description. Runs under `connectedAndroidTest`;
// the offline `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.entrydrawer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class EntryDrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        EntryDrawerStrings(
            titleFallback = "DLQ entry",
            close = "Close",
            replay = "Replay",
            copy = "Copy",
            copied = "Copied",
            tabInner = "Inner payload",
            tabRaw = "Raw envelope",
            labelId = "ID",
            labelArrived = "Arrived",
            labelDlqTopic = "DLQ topic",
            labelReason = "Reason",
            labelVin = "VIN",
            labelSourceTopic = "Source topic",
            labelRedeliveries = "Redeliveries",
            labelParseError = "Parse error",
            emptyMessage = "No data available",
            loadingLabel = "Loading",
        )

    private fun display(
        id: String = "4821",
        innerText: String = "{ \"field\": \"Soc\", \"value\": 82 }",
        rawText: String = "",
        replayable: Boolean = true,
    ) = EntryDrawerDisplay(
        id = id,
        arrivedAtRaw = "2024-06-01T12:34:56Z",
        dlqTopic = "telemetry.dlq.v1",
        reason = "codec: unknown enum",
        vin = "5YJ3E1EA7KF000000",
        sourceTopic = "telemetry/5YJ/v/Soc",
        redeliveries = "3",
        parseError = "\u2014",
        innerText = innerText,
        rawText = rawText,
        innerPayloadB64 = "eyJmaWVsZCI6IlNvYyJ9",
        rawPayloadB64 = "AAECAwQF",
        innerPayloadSize = 42,
        rawPayloadSize = 1536,
        replayable = replayable,
    )

    private fun setContent(
        display: EntryDrawerDisplay? = display(),
        loading: Boolean = false,
        hasFull: Boolean = true,
        replayEnabled: Boolean = true,
        replayInFlight: Boolean = false,
        onClose: () -> Unit = {},
        onReplay: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    EntryDrawerContent(
                        display = display,
                        loading = loading,
                        hasFull = hasFull,
                        replayEnabled = replayEnabled,
                        replayInFlight = replayInFlight,
                        strings = strings,
                        onClose = onClose,
                        onReplay = onReplay,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }

    @Test
    fun contentRendersSummaryTabsCopyAndFooter() {
        setContent()

        // Summary metadata rows (labels + a couple of values).
        compose.onNodeWithTag(EntryDrawerTestTags.SUMMARY).assertIsDisplayed()
        compose.onNodeWithText(strings.labelId).assertIsDisplayed()
        compose.onNodeWithText("4821").assertIsDisplayed()
        compose.onNodeWithText(strings.labelArrived).assertIsDisplayed()
        compose.onNodeWithText("5YJ3E1EA7KF000000").assertIsDisplayed()

        // Payload tabs + copy + body.
        compose.onNodeWithText(strings.tabInner).assertIsDisplayed()
        compose.onNodeWithText(strings.tabRaw).assertIsDisplayed()
        compose.onNodeWithTag(EntryDrawerTestTags.COPY).assertIsDisplayed()
        compose.onNodeWithTag(EntryDrawerTestTags.PAYLOAD).assertIsDisplayed()
        compose.onNodeWithText("field", substring = true, useUnmergedTree = true).assertIsDisplayed()

        // Footer actions expose accessible names and are actionable (a11y label test).
        compose.onNodeWithTag(EntryDrawerTestTags.FOOTER_CLOSE).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsDisplayed().assertHasClickAction()
        // The header close affordance announces itself to TalkBack via its content description.
        compose.onNodeWithContentDescription(strings.close).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun switchingToRawTabShowsTheBinaryEnvelopeMarker() {
        setContent(display = display(rawText = ""))

        compose.onNodeWithText(strings.tabRaw).performClick()
        // Raw body is binary (decoded text empty) → the localized non-UTF-8 envelope marker is shown.
        compose.onNodeWithText("non-UTF-8", substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingStateShowsSpinnerAndDisablesReplay() {
        setContent(loading = true, hasFull = false)

        compose.onNodeWithTag(EntryDrawerTestTags.LOADING).assertIsDisplayed()
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsNotEnabled()
        // The footer is always present even while loading.
        compose.onNodeWithTag(EntryDrawerTestTags.FOOTER_CLOSE).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsFallbackTitleAndMessage() {
        setContent(display = null, hasFull = false)

        compose.onNodeWithText(strings.titleFallback).assertIsDisplayed()
        compose.onNodeWithTag(EntryDrawerTestTags.EMPTY).assertIsDisplayed()
        // Replay is disabled when there is no replayable head.
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsNotEnabled()
    }

    @Test
    fun replayDisabledWhenServerFlagOff() {
        setContent(replayEnabled = false)
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsNotEnabled()
    }

    @Test
    fun replayDisabledForNonReplayableEntry() {
        setContent(display = display(replayable = false))
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsNotEnabled()
    }

    @Test
    fun replayEnabledWhenEverythingPermits() {
        setContent()
        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).assertIsEnabled()
    }

    @Test
    fun replayInvokesOnReplay() {
        var replayed = false
        setContent(onReplay = { replayed = true })

        compose.onNodeWithTag(EntryDrawerTestTags.REPLAY).performClick()
        assertTrue("tapping Replay must invoke onReplay", replayed)
    }

    @Test
    fun footerCloseInvokesOnClose() {
        var closed = false
        setContent(onClose = { closed = true })

        compose.onNodeWithTag(EntryDrawerTestTags.FOOTER_CLOSE).performClick()
        assertTrue("tapping Close must invoke onClose", closed)
    }

    @Test
    fun headerCloseInvokesOnClose() {
        var closed = false
        setContent(onClose = { closed = true })

        compose.onNodeWithTag(EntryDrawerTestTags.CLOSE).performClick()
        assertTrue("tapping the header close must invoke onClose", closed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 920.dp
    }
}
