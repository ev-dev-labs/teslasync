package io.teslasync.android.components.datadisplay

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the data-display family (metrics / cards / badges / timelines /
 * live-status). The pure label/severity/score math is covered by the no-device
 * [DataDisplayLogicTest]; these assert the composables actually render their text and expose the
 * accessibility summaries on a device (connectedDebugAndroidTest), closing the A9-0001 device-only
 * gap for this family.
 */
class DataDisplayInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun statCardShowsLabelAndValue() {
        rule.setContent { TeslaSyncTheme { StatCard(label = "Efficiency", value = "250", unit = "Wh") } }
        rule.onNodeWithText("Efficiency").assertIsDisplayed()
        rule.onNodeWithText("250").assertIsDisplayed()
    }

    @Test
    fun metricCardShowsLabelAndValue() {
        rule.setContent { TeslaSyncTheme { MetricCard(label = "Drives", value = "42") } }
        rule.onNodeWithText("Drives").assertIsDisplayed()
        rule.onNodeWithText("42").assertIsDisplayed()
    }

    @Test
    fun metricBarShowsLabelAndValueText() {
        rule.setContent {
            TeslaSyncTheme {
                MetricBar(value = 80.0, max = 100.0, label = "Battery", valueText = "80%")
            }
        }
        rule.onNodeWithText("Battery").assertIsDisplayed()
        rule.onNodeWithText("80%").assertIsDisplayed()
    }

    @Test
    fun timelineRendersEveryEntryTitle() {
        rule.setContent {
            TeslaSyncTheme {
                Timeline(
                    items =
                        listOf(
                            TimelineEntry(title = "Trip to work", time = "08:15"),
                            TimelineEntry(title = "Charge complete", time = "18:00"),
                        ),
                )
            }
        }
        rule.onNodeWithText("Trip to work").assertIsDisplayed()
        rule.onNodeWithText("Charge complete").assertIsDisplayed()
    }

    @Test
    fun kvListRendersEveryPair() {
        rule.setContent {
            TeslaSyncTheme {
                KVList(
                    items =
                        listOf(
                            KVItem(label = "Model", value = "Model Y"),
                            KVItem(label = "Color", value = "Pearl White"),
                        ),
                )
            }
        }
        rule.onNodeWithText("Model").assertIsDisplayed()
        rule.onNodeWithText("Pearl White").assertIsDisplayed()
    }

    @Test
    fun statusBadgeShowsHumanizedStatus() {
        rule.setContent { TeslaSyncTheme { StatusBadge(status = "online") } }
        rule.onNodeWithText("Online").assertIsDisplayed()
    }

    @Test
    fun liveIndicatorPillShowsConnectedLabel() {
        rule.setContent { TeslaSyncTheme { LiveIndicator(status = LiveConnectionStatus.Connected) } }
        rule.onNodeWithText(defaultLiveLabel(LiveConnectionStatus.Connected)).assertIsDisplayed()
    }

    @Test
    fun liveIndicatorPillShowsOfflineLabel() {
        rule.setContent { TeslaSyncTheme { LiveIndicator(status = LiveConnectionStatus.Disconnected) } }
        rule.onNodeWithText(defaultLiveLabel(LiveConnectionStatus.Disconnected)).assertIsDisplayed()
    }

    @Test
    fun liveIndicatorDotExposesAccessibleStatus() {
        rule.setContent {
            TeslaSyncTheme {
                LiveIndicator(status = LiveConnectionStatus.Reconnecting, variant = LiveIndicatorVariant.Dot)
            }
        }
        rule.onNodeWithContentDescription(defaultLiveLabel(LiveConnectionStatus.Reconnecting)).assertIsDisplayed()
    }

    @Test
    fun scoreBadgeExposesAccessibleSummary() {
        rule.setContent { TeslaSyncTheme { ScoreBadge(grade = ScoreGrade.A) } }
        rule.onNodeWithContentDescription("Score ${ScoreGrade.A.label}").assertIsDisplayed()
    }
}
