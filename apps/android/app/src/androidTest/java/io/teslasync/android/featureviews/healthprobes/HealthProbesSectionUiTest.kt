package io.teslasync.android.featureviews.healthprobes

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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

/**
 * Instrumented Compose tests for the Health Probes surface: each state from the web source (content / empty
 * / error / stale) renders its copy on a device, the two probe cards expose their endpoint titles + KV
 * labels, the Live / Ready header badges render, the error surface's retry fires its callback, and the
 * loading + disclosure-toggle affordances expose accessible names. The framework-free logic is covered by
 * the no-device [HealthProbesProjectionTest] / [HealthProbesSectionViewModelTest]; this is the
 * connectedAndroidTest gate. Uses only resolvable finders (no assertExists/assertDoesNotExist).
 */
class HealthProbesSectionUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val strings = healthProbesFallbackStrings()

    private fun data(): HealthProbesData =
        HealthProbesData(
            livenessStatus = "ok",
            dbStatus = "healthy",
            goroutines = 148L,
            uptimeSeconds = 93_784L,
            dbLatencyMs = 2.4,
            poolTotalConns = 12L,
            resolved = true,
        )

    private fun contentState(stale: Boolean = false): UiState<HealthProbesData> =
        UiState(
            phase = UiPhase.Content,
            data = data(),
            fetchedAt = 1L,
            stale = stale,
            errorKind = if (stale) ErrorKind.Network else null,
        )

    @Test
    fun contentShowsProbeCardTitlesAndKvLabels() {
        rule.setContent {
            TeslaSyncTheme { HealthProbesSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.liveness).assertIsDisplayed()
        rule.onNodeWithText(strings.readiness).assertIsDisplayed()
        rule.onNodeWithText(strings.statusLabel).assertIsDisplayed()
        rule.onNodeWithText(strings.goroutines).assertIsDisplayed()
        rule.onNodeWithText(strings.uptime).assertIsDisplayed()
        rule.onNodeWithText(strings.database).assertIsDisplayed()
        rule.onNodeWithText(strings.latency).assertIsDisplayed()
        rule.onNodeWithText(strings.poolConnections).assertIsDisplayed()
    }

    @Test
    fun contentShowsLiveAndReadyHeaderBadges() {
        rule.setContent {
            TeslaSyncTheme { HealthProbesSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.live, useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithText(strings.ready, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsFormattedUptime() {
        rule.setContent {
            TeslaSyncTheme { HealthProbesSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText("1d 2h 3m").assertIsDisplayed()
    }

    @Test
    fun headerTitleIsDisplayedAndTogglable() {
        rule.setContent {
            TeslaSyncTheme { HealthProbesSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.title, substring = true).assertIsDisplayed()
        rule.onNodeWithText(strings.title, substring = true).performClick()
        rule.onNodeWithText(strings.title, substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsHint() {
        rule.setContent {
            TeslaSyncTheme {
                HealthProbesSectionContent(
                    state = UiState(phase = UiPhase.Empty, data = HealthProbesData.EMPTY, fetchedAt = 1L),
                    strings = strings,
                )
            }
        }

        rule.onNodeWithText(strings.emptyHint).assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                HealthProbesSectionContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    strings = strings,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun loadingExposesAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                HealthProbesSectionContent(state = UiState(phase = UiPhase.Loading), strings = strings)
            }
        }

        rule.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun staleContentStillRendersCards() {
        rule.setContent {
            TeslaSyncTheme { HealthProbesSectionContent(state = contentState(stale = true), strings = strings) }
        }

        rule.onNodeWithText(strings.liveness).assertIsDisplayed()
    }
}
