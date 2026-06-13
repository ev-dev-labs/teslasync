// Off-device unit coverage for the UsageCard surface's pure model (P3 acceptance: adapter + per-state +
// a11y/diagnostics pieces). Exercises the registration slug the prompt mandates, every branch of the web
// `hasAnything` decision the surface reproduces ([UsageCardProjection.project] — the empty fallback, each
// region present on its own, the footer-only case that the web counts as content, and a fully-populated
// card), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the behaviour the web `UsageCard` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usagecard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageCardModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("usage-card", UsageCardRegistration.ID)
        assertEquals("UsageCard", UsageCardRegistration.SLUG)
    }

    // ── projection: the web `hasAnything` decision (every region) ─────────────────────

    @Test
    fun emptyCardHasNoContent() {
        assertFalse(UsageCardProjection.project(UsageCardRegions()).hasContent)
    }

    @Test
    fun budgetAloneIsContent() {
        assertTrue(UsageCardProjection.project(UsageCardRegions(hasBudget = true)).hasContent)
    }

    @Test
    fun bandsAloneAreContent() {
        assertTrue(UsageCardProjection.project(UsageCardRegions(bandCount = 3)).hasContent)
    }

    @Test
    fun detailsAloneAreContent() {
        assertTrue(UsageCardProjection.project(UsageCardRegions(detailCount = 4)).hasContent)
    }

    @Test
    fun topListsAloneAreContent() {
        assertTrue(UsageCardProjection.project(UsageCardRegions(topListCount = 1)).hasContent)
    }

    @Test
    fun bannerAloneIsContent() {
        assertTrue(UsageCardProjection.project(UsageCardRegions(hasBanner = true)).hasContent)
    }

    @Test
    fun footerAloneIsContent() {
        // Web `hasAnything` counts the footer, so a card carrying only footer links is content
        // (the surface suppresses the atomic's empty fallback in this case so the links still render).
        assertTrue(UsageCardProjection.project(UsageCardRegions(footerCount = 2)).hasContent)
    }

    @Test
    fun fullyPopulatedCardIsContent() {
        val regions =
            UsageCardRegions(
                hasBudget = true,
                bandCount = 3,
                detailCount = 4,
                topListCount = 2,
                hasBanner = true,
                footerCount = 2,
            )
        assertTrue(UsageCardProjection.project(regions).hasContent)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        UsageCardDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "UsageCard"), record.fields)
        // The record carries only the stable slug — never a rendered headline / value / banner line.
        assertTrue(record.fields.values.all { it == "UsageCard" })
    }
}
