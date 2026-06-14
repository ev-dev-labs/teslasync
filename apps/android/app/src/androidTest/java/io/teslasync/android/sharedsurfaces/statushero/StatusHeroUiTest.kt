package io.teslasync.android.sharedsurfaces.statushero

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [StatusHero] view — the parity port of the web `StatusHero`
 * (web/src/components/status/StatusHero.tsx). Covers what the offline model test cannot: each status tier
 * renders its localized default headline (the keys resolve through the P1/S10 catalog), a caller headline
 * overrides the default, the subline + inline "Live" label render, the CTA fires its handler, the status
 * region exposes a polite live region for screen readers, and the one-shot PII-safe `view.opened` diagnostic
 * fires on mount. The offline :android:testReleaseUnitTest gate covers the pure projection + diagnostics.
 */
class StatusHeroUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: each status tier renders its localized default headline (web STATUS_CONFIG.defaultHeadline)

    @Test
    fun healthyRendersItsLocalizedDefaultHeadline() {
        mount(HeroStatus.Healthy)
        compose.onNodeWithText(HEALTHY_HEADLINE, substring = true).assertExists()
    }

    @Test
    fun degradedRendersItsLocalizedDefaultHeadline() {
        mount(HeroStatus.Degraded)
        compose.onNodeWithText(DEGRADED_HEADLINE, substring = true).assertExists()
    }

    @Test
    fun unhealthyRendersItsLocalizedDefaultHeadline() {
        mount(HeroStatus.Unhealthy)
        compose.onNodeWithText(UNHEALTHY_HEADLINE, substring = true).assertExists()
    }

    @Test
    fun unknownColdStartRendersItsLocalizedDefaultHeadline() {
        // unknown is the not-yet-known / cold-start surface — it must still render a non-blank card.
        mount(HeroStatus.Unknown)
        compose.onNodeWithText(UNKNOWN_HEADLINE, substring = true).assertExists()
    }

    @Test
    fun maintenanceRendersItsLocalizedDefaultHeadline() {
        mount(HeroStatus.Maintenance)
        compose.onNodeWithText(MAINTENANCE_HEADLINE, substring = true).assertExists()
    }

    // ── Override: a caller headline replaces the per-status default (web `headline`) ───────────────────────

    @Test
    fun aCallerHeadlineOverridesTheDefault() {
        mount(HeroStatus.Healthy, headline = CUSTOM_HEADLINE)
        compose.onNodeWithText(CUSTOM_HEADLINE, substring = true).assertExists()
        compose.onNodeWithText(HEALTHY_HEADLINE, substring = true).assertDoesNotExist()
    }

    // ── Subline: the line beneath the headline renders (web `subline`) ─────────────────────────────────────

    @Test
    fun theSublineRendersWhenProvided() {
        mount(HeroStatus.Healthy, subline = SUBLINE)
        compose.onNodeWithText(SUBLINE, substring = true).assertExists()
    }

    // ── Live: the inline "Live" label renders next to the subline (web `live` + LiveIndicator dot) ─────────

    @Test
    fun theLiveLabelRendersNextToTheSubline() {
        // The stateful live dot binds the app live store; the stateless content takes it as a slot, so the
        // label branch is verified here without a DataContainer (the slot renders nothing).
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatusHeroContent(
                    projection = projectStatus(HeroStatus.Healthy),
                    heading = CUSTOM_HEADLINE,
                    subline = SUBLINE,
                    liveSlot = {},
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText(LIVE_LABEL, substring = true).assertExists()
    }

    // ── CTA: the refresh action fires its handler (web `cta.onClick`) ──────────────────────────────────────

    @Test
    fun theCtaFiresItsHandlerWhenClicked() {
        var clicks = 0
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatusHero(
                    status = HeroStatus.Healthy,
                    cta = StatusHeroCta(label = RUN_CHECK, onClick = { clicks++ }),
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText(RUN_CHECK, substring = true).assertHasClickAction().performClick()
        assertEquals(1, clicks)
    }

    // ── Accessibility: the status region is a polite live region (web `role="status" aria-live="polite"`) ──

    @Test
    fun theStatusRegionExposesAPoliteLiveRegion() {
        mount(HeroStatus.Degraded)

        compose
            .onNodeWithTag(STATUS_HERO_STATUS_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatusHero(status = HeroStatus.Healthy, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "StatusHero"), fields)
    }

    private fun mount(
        status: HeroStatus,
        headline: String? = null,
        subline: String? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatusHero(status = status, headline = headline, subline = subline, logger = RecordingLogger())
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
        // The en catalog values (instrumentation default locale) the surface speaks for each status.
        const val HEALTHY_HEADLINE = "Healthy"
        const val DEGRADED_HEADLINE = "Degraded"
        const val UNHEALTHY_HEADLINE = "Unhealthy"
        const val UNKNOWN_HEADLINE = "Unknown"
        const val MAINTENANCE_HEADLINE = "Scheduled maintenance"
        const val LIVE_LABEL = "Live"
        const val CUSTOM_HEADLINE = "Custom headline"
        const val RUN_CHECK = "Run check"
        const val SUBLINE = "Last checked 12s ago"
    }
}
