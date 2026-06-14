package io.teslasync.android.sharedsurfaces.healthrow

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.sharedsurfaces.statushero.HeroStatus
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [HealthRow] view — the parity port of the web `HealthRow`
 * (web/src/components/status/HealthRow.tsx). Covers what the offline model test cannot: each status tier paints a
 * full, non-blank row (label + summary + dot); the four interaction branches fire the right side effect (an
 * internal link routes through the host navigator, an external link opens its URL, a clickable fires its handler,
 * a static row exposes no click action and hides the chevron); the interactive row is one actionable node a host
 * can name; and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
 * :android:testReleaseUnitTest gate covers the pure projection + interaction reduction + diagnostics.
 */
class HealthRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: each status tier paints a full, non-blank row (web DOT_FOR_STATUS / TEXT_FOR_STATUS) ─────

    @Test
    fun healthyRowRendersItsLabelSummaryAndDot() {
        mountStatic(HeroStatus.Healthy, label = VEHICLES, summary = HEALTHY_SUMMARY)
        compose.onNodeWithText(VEHICLES, substring = true).assertExists()
        compose.onNodeWithText(HEALTHY_SUMMARY, substring = true).assertExists()
        compose.onNodeWithTag(HEALTH_ROW_DOT_TAG, useUnmergedTree = true).assertExists()
    }

    @Test
    fun degradedRowRendersItsLabelAndSummary() {
        mountStatic(HeroStatus.Degraded, label = PIPELINE, summary = DEGRADED_SUMMARY)
        compose.onNodeWithText(PIPELINE, substring = true).assertExists()
        compose.onNodeWithText(DEGRADED_SUMMARY, substring = true).assertExists()
    }

    @Test
    fun unhealthyRowRendersItsLabelAndSummary() {
        mountStatic(HeroStatus.Unhealthy, label = BROKER, summary = OFFLINE_SUMMARY)
        compose.onNodeWithText(BROKER, substring = true).assertExists()
        compose.onNodeWithText(OFFLINE_SUMMARY, substring = true).assertExists()
    }

    @Test
    fun unknownColdRowStillRendersANonBlankRow() {
        // unknown is the not-yet-known / neutral tier — it must still paint a full row, never a hidden surface.
        mountStatic(HeroStatus.Unknown, label = FLEET, summary = IDLE_SUMMARY)
        compose.onNodeWithText(FLEET, substring = true).assertExists()
        compose.onNodeWithText(IDLE_SUMMARY, substring = true).assertExists()
    }

    @Test
    fun maintenanceRowRendersItsLabelAndSummary() {
        mountStatic(HeroStatus.Maintenance, label = WINDOW, summary = MAINTENANCE_SUMMARY)
        compose.onNodeWithText(WINDOW, substring = true).assertExists()
        compose.onNodeWithText(MAINTENANCE_SUMMARY, substring = true).assertExists()
    }

    // ── Interaction: the web to ? (external ? a : Link) : (onClick ? button : div) split ───────────────────

    @Test
    fun anInternalLinkRowRoutesToTheHostNavigatorWhenTapped() {
        var navigated: String? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Healthy,
                    label = VEHICLES,
                    summary = HEALTHY_SUMMARY,
                    to = ROUTE,
                    onNavigate = { navigated = it },
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HEALTH_ROW_ROOT_TAG).assertHasClickAction().performClick()
        assertEquals(ROUTE, navigated)
    }

    @Test
    fun anExternalLinkRowOpensTheUrlWhenTapped() {
        var opened: String? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Unhealthy,
                    label = BROKER,
                    summary = OFFLINE_SUMMARY,
                    to = EXTERNAL_URL,
                    external = true,
                    onOpenExternal = { opened = it },
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HEALTH_ROW_ROOT_TAG).performClick()
        assertEquals(EXTERNAL_URL, opened)
    }

    @Test
    fun aClickableRowFiresItsHandlerWhenTapped() {
        var clicks = 0
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Degraded,
                    label = PIPELINE,
                    summary = DEGRADED_SUMMARY,
                    onClick = { clicks++ },
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HEALTH_ROW_ROOT_TAG).performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun aStaticRowExposesNoClickActionAndHidesTheChevron() {
        var navigated: String? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Unknown,
                    label = FLEET,
                    summary = IDLE_SUMMARY,
                    onNavigate = { navigated = it },
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HEALTH_ROW_ROOT_TAG).assertHasNoClickAction()
        compose.onNodeWithTag(HEALTH_ROW_CHEVRON_TAG, useUnmergedTree = true).assertDoesNotExist()
        assertNull(navigated)
    }

    // ── Chevron: the web (to || onClick) trailing affordance only renders for an interactive row ───────────

    @Test
    fun anInteractiveRowShowsTheChevron() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Healthy,
                    label = VEHICLES,
                    summary = HEALTHY_SUMMARY,
                    to = ROUTE,
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HEALTH_ROW_CHEVRON_TAG, useUnmergedTree = true).assertExists()
    }

    // ── Accessibility: a host can name the interactive row (web link aria-label) ───────────────────────────

    @Test
    fun anExplicitContentDescriptionNamesTheInteractiveRow() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(
                    status = HeroStatus.Healthy,
                    label = VEHICLES,
                    summary = HEALTHY_SUMMARY,
                    to = ROUTE,
                    contentDescription = ACCESSIBLE_NAME,
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(ACCESSIBLE_NAME).assertExists().assertHasClickAction()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRow(status = HeroStatus.Healthy, label = VEHICLES, summary = HEALTHY_SUMMARY, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "HealthRow"), fields)
    }

    private fun mountStatic(
        status: HeroStatus,
        label: String,
        summary: String,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRowContent(status = status, label = label, summary = summary)
            }
        }
        compose.waitForIdle()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        // Sample labels / summaries (instrumentation copy — the surface itself owns no strings).
        const val VEHICLES = "Vehicles"
        const val PIPELINE = "Telemetry pipeline"
        const val BROKER = "MQTT broker"
        const val FLEET = "Fleet status"
        const val WINDOW = "Maintenance window"
        const val HEALTHY_SUMMARY = "12 / 12 healthy"
        const val DEGRADED_SUMMARY = "2 streams lagging"
        const val OFFLINE_SUMMARY = "offline"
        const val IDLE_SUMMARY = "0 vehicles idle"
        const val MAINTENANCE_SUMMARY = "starts in 2h"
        const val ROUTE = "/vehicles"
        const val EXTERNAL_URL = "https://status.example.com"
        const val ACCESSIBLE_NAME = "Vehicles, 12 of 12 healthy"
    }
}
