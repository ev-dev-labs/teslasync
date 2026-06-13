package io.teslasync.android.sharedsurfaces.announcerregion

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [AnnouncerRegion] view — the parity port of the web `AnnouncerRegion`
 * component (web/src/components/a11y/AnnouncerRegion.tsx). Covers what the offline model test cannot: the two
 * live regions render with STATIC polite / assertive modes, each web state (empty on mount, polite populated,
 * assertive populated) reflects into the correct region, the surface exposes NO interactive node (it is
 * screen-reader-only), and the one-shot PII-safe `view.opened` diagnostic fires. The offline
 * `:android:testReleaseUnitTest` gate covers the pure [Announcer] + diagnostics.
 */
class AnnouncerRegionUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Render contract: two siblings, one polite + one assertive, both with static modes ─────────────

    @Test
    fun rendersBothLiveRegionsWithStaticPoliteAndAssertiveModes() {
        mount(Announcer())

        compose
            .onNodeWithTag(POLITE_TEST_TAG)
            .assertExists()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        compose
            .onNodeWithTag(ASSERTIVE_TEST_TAG)
            .assertExists()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Assertive))
    }

    // ── State: empty on mount (web `useState('')`) — both regions present, voicing nothing ────────────

    @Test
    fun bothRegionsStartEmptySoNothingIsVoicedOnMount() {
        mount(Announcer())

        assertEquals("", compose.onNodeWithTag(POLITE_TEST_TAG).announcedText())
        assertEquals("", compose.onNodeWithTag(ASSERTIVE_TEST_TAG).announcedText())
    }

    // ── State: polite populated — updates the polite region only (web `setPolite`) ────────────────────

    @Test
    fun aPoliteAnnouncementUpdatesOnlyThePoliteRegion() {
        val announcer = Announcer()
        mount(announcer)

        compose.runOnUiThread { announcer.announce("Filter applied") }
        compose.waitForIdle()

        compose.onNodeWithTag(POLITE_TEST_TAG).assertContentDescriptionContains("Filter applied", substring = true)
        assertEquals("", compose.onNodeWithTag(ASSERTIVE_TEST_TAG).announcedText())
    }

    // ── State: assertive populated — updates the assertive region only (web `setAssertive`) ───────────

    @Test
    fun anAssertiveAnnouncementUpdatesOnlyTheAssertiveRegion() {
        val announcer = Announcer()
        mount(announcer)

        compose.runOnUiThread { announcer.announce("Session expired", AnnouncerPriority.Assertive) }
        compose.waitForIdle()

        compose.onNodeWithTag(ASSERTIVE_TEST_TAG).assertContentDescriptionContains("Session expired", substring = true)
        assertEquals("", compose.onNodeWithTag(POLITE_TEST_TAG).announcedText())
    }

    // ── Accessibility: the surface is screen-reader-only — no interactive node exists ─────────────────

    @Test
    fun theSurfaceExposesNoInteractiveNode() {
        mount(Announcer())

        // Nothing to focus or tap — the only nodes are the two live regions, which carry their announced text
        // as contentDescription rather than any click affordance.
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnouncerRegion(announcer = Announcer(), logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AnnouncerRegion"), fields)
    }

    private fun mount(announcer: Announcer) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnouncerRegion(announcer = announcer, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
    }

    /** The region's announced text with the inaudible zero-width-space de-dup suffix stripped. */
    private fun SemanticsNodeInteraction.announcedText(): String =
        fetchSemanticsNode()
            .config
            .getOrNull(SemanticsProperties.ContentDescription)
            .orEmpty()
            .joinToString("")
            .replace(Announcer.ZERO_WIDTH_SPACE, "")

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
}
