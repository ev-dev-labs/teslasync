// Off-device unit coverage for the IncidentForm feature view's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the title-length validator (web `t.length < 3`), the maxLength clamps
// (web `maxLength={200}` / `{4000}`), the comma-separated components parser
// (web `split(',').map(trim).filter(Boolean)`), the create-payload assembly (web `mutateAsync({...})` — trimmed
// title, blank-message -> null, always-present components array, no description), the severity/status wire
// vocabularies + reverse lookup, the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IncidentFormModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Title validation (web `t.length < 3`) -----------------------------------

    @Test
    fun isTitleValid_rejectsShortAndBlankTitles() {
        assertFalse(IncidentFormProjection.isTitleValid(""))
        assertFalse(IncidentFormProjection.isTitleValid("ab"))
        assertFalse(IncidentFormProjection.isTitleValid("  ab  "))
        assertFalse(IncidentFormProjection.isTitleValid("   "))
    }

    @Test
    fun isTitleValid_acceptsThreeOrMoreAfterTrim() {
        assertTrue(IncidentFormProjection.isTitleValid("abc"))
        assertTrue(IncidentFormProjection.isTitleValid("  abc  "))
        assertTrue(IncidentFormProjection.isTitleValid("Wall connector restart"))
    }

    // ---- maxLength clamps (web `maxLength` attributes) ---------------------------

    @Test
    fun clampTitle_truncatesToTwoHundred() {
        val long = "x".repeat(250)
        assertEquals(IncidentFormProjection.MAX_TITLE_LENGTH, IncidentFormProjection.clampTitle(long).length)
        assertEquals("short", IncidentFormProjection.clampTitle("short"))
    }

    @Test
    fun clampMessage_truncatesToFourThousand() {
        val long = "y".repeat(5000)
        assertEquals(IncidentFormProjection.MAX_MESSAGE_LENGTH, IncidentFormProjection.clampMessage(long).length)
        assertEquals("note", IncidentFormProjection.clampMessage("note"))
    }

    // ---- Components parsing (web split/trim/filter) ------------------------------

    @Test
    fun parseComponents_splitsTrimsAndDropsBlanks() {
        assertEquals(listOf("tesla", "telemetry"), IncidentFormProjection.parseComponents("tesla, telemetry"))
        assertEquals(listOf("a", "b"), IncidentFormProjection.parseComponents("  a ,, b ,"))
    }

    @Test
    fun parseComponents_emptyOrBlankYieldsEmptyList() {
        assertEquals(emptyList<String>(), IncidentFormProjection.parseComponents(""))
        assertEquals(emptyList<String>(), IncidentFormProjection.parseComponents("   ,  , "))
    }

    // ---- Create-payload assembly (web `mutateAsync({...})`) -----------------------

    @Test
    fun buildCreateInput_mapsEveryFieldAndTrimsTitle() {
        val draft =
            IncidentDraft(
                title = "  Wall connector down  ",
                severity = IncidentSeverity.Major,
                status = IncidentStatus.Identified,
                components = "tesla, telemetry",
                message = "  Restarted the unit  ",
            )
        val input = IncidentFormProjection.buildCreateInput(draft)
        assertEquals("Wall connector down", input.title)
        assertEquals("major", input.severity)
        assertEquals("identified", input.status)
        assertEquals(listOf("tesla", "telemetry"), input.affectedComponents)
        assertEquals("Restarted the unit", input.initialMessage)
        assertNull(input.description)
    }

    @Test
    fun buildCreateInput_blankMessageBecomesNullAndComponentsStayEmpty() {
        val draft = IncidentDraft(title = "Outage", message = "   ", components = "  ")
        val input = IncidentFormProjection.buildCreateInput(draft)
        assertNull(input.initialMessage)
        assertEquals(emptyList<String>(), input.affectedComponents)
        // Defaults mirror the web initial state.
        assertEquals("minor", input.severity)
        assertEquals("investigating", input.status)
    }

    // ---- Severity / status vocabularies + reverse lookup -------------------------

    @Test
    fun severityWireTokensMatchTheWebUnion() {
        assertEquals("minor", IncidentSeverity.Minor.wire)
        assertEquals("major", IncidentSeverity.Major.wire)
        assertEquals("critical", IncidentSeverity.Critical.wire)
    }

    @Test
    fun statusWireTokensMatchTheWebUnion() {
        assertEquals("investigating", IncidentStatus.Investigating.wire)
        assertEquals("identified", IncidentStatus.Identified.wire)
        assertEquals("monitoring", IncidentStatus.Monitoring.wire)
        assertEquals("resolved", IncidentStatus.Resolved.wire)
    }

    @Test
    fun fromWire_resolvesKnownTokensAndFallsBackOnUnknown() {
        assertEquals(IncidentSeverity.Critical, IncidentSeverity.fromWire("critical"))
        assertEquals(IncidentSeverity.Minor, IncidentSeverity.fromWire("nonsense"))
        assertEquals(IncidentStatus.Monitoring, IncidentStatus.fromWire("monitoring"))
        assertEquals(IncidentStatus.Investigating, IncidentStatus.fromWire("nonsense"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("incident-form", IncidentFormRegistration.ID)
        assertEquals("IncidentForm", IncidentFormRegistration.SLUG)
    }

    @Test
    fun recordIncidentFormOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordIncidentFormOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "IncidentForm"), fields)
    }
}
