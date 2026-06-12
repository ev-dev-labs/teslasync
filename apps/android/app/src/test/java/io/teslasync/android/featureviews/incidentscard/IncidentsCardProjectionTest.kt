package io.teslasync.android.featureviews.incidentscard

import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import io.teslasync.shared.core.presentation.incidents.IncidentUpdateEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the IncidentsCard's pure logic — the native analogue of everything the web
 * component derives per row (web/src/features/system/components/status/IncidentsCard.tsx): the severity → tone
 * classification (web `SEVERITY_TONE`), the status → badge tone (web `STATUS_BADGE`), the relative "Started …"
 * bucket (web `relativeFrom`), the "Affects: …" join, the "· N updates" guard, the full projection field mapping,
 * the active-count, and the `t(key, default)` resolver. Runs in the :android:testReleaseUnitTest gate.
 */
class IncidentsCardProjectionTest {
    private val now: Instant = Instant.parse("2026-04-04T15:00:00Z")

    private fun baseIncident(): Incident =
        Incident(
            id = 1,
            title = "Wall connector restart",
            description = "Operator-reported restart.",
            severity = "major",
            status = "investigating",
            source = "manual",
            affectedComponents = listOf("tesla", "telemetry"),
            updates =
                listOf(
                    IncidentUpdateEntry(at = "2026-04-04T14:30:00Z", status = "investigating", message = "opened"),
                    IncidentUpdateEntry(at = "2026-04-04T14:45:00Z", status = "identified", message = "found"),
                ),
            startedAt = "2026-04-04T14:30:00Z",
            createdAt = "2026-04-04T14:30:00Z",
            updatedAt = "2026-04-04T14:45:00Z",
        )

    // ── Severity tone (web SEVERITY_TONE) ──────────────────────────────────────

    @Test
    fun severityToneMapsEveryWebKey() {
        assertEquals(IncidentSeverityTone.Minor, IncidentSeverityTone.fromSeverity("minor"))
        assertEquals(IncidentSeverityTone.Major, IncidentSeverityTone.fromSeverity("major"))
        assertEquals(IncidentSeverityTone.Critical, IncidentSeverityTone.fromSeverity("critical"))
    }

    @Test
    fun severityToneFoldsUnknownNullAndBlankToMinor() {
        assertEquals(IncidentSeverityTone.Minor, IncidentSeverityTone.fromSeverity("catastrophic"))
        assertEquals(IncidentSeverityTone.Minor, IncidentSeverityTone.fromSeverity(null))
        assertEquals(IncidentSeverityTone.Minor, IncidentSeverityTone.fromSeverity(""))
        assertEquals(IncidentSeverityTone.Minor, IncidentSeverityTone.fromSeverity("   "))
    }

    @Test
    fun severityToneIsCaseAndWhitespaceTolerant() {
        assertEquals(IncidentSeverityTone.Critical, IncidentSeverityTone.fromSeverity("  CRITICAL  "))
        assertEquals(IncidentSeverityTone.Major, IncidentSeverityTone.fromSeverity("Major"))
    }

    // ── Status tone (web STATUS_BADGE) ─────────────────────────────────────────

    @Test
    fun statusToneMapsEveryWebKey() {
        assertEquals(IncidentStatusTone.Danger, IncidentStatusTone.fromStatus("investigating"))
        assertEquals(IncidentStatusTone.Warning, IncidentStatusTone.fromStatus("identified"))
        assertEquals(IncidentStatusTone.Info, IncidentStatusTone.fromStatus("monitoring"))
        assertEquals(IncidentStatusTone.Success, IncidentStatusTone.fromStatus("resolved"))
    }

    @Test
    fun statusToneFoldsUnknownNullAndBlankToNeutral() {
        assertEquals(IncidentStatusTone.Neutral, IncidentStatusTone.fromStatus("postmortem"))
        assertEquals(IncidentStatusTone.Neutral, IncidentStatusTone.fromStatus(null))
        assertEquals(IncidentStatusTone.Neutral, IncidentStatusTone.fromStatus(""))
        assertEquals(IncidentStatusTone.Success, IncidentStatusTone.fromStatus("  RESOLVED "))
    }

    // ── Relative age (web relativeFrom) ────────────────────────────────────────

    @Test
    fun relativeFromBucketsJustNowUnderAMinute() {
        assertEquals(IncidentAge.JustNow, IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:59:30Z"))
        assertEquals(IncidentAge.JustNow, IncidentsCardProjection.relativeFrom(now, "2026-04-04T15:00:00Z"))
        assertEquals(IncidentAge.JustNow, IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:59:01Z"))
    }

    @Test
    fun relativeFromBucketsMinutesUnderAnHour() {
        assertEquals(IncidentAge.Minutes(30), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:30:00Z"))
        assertEquals(IncidentAge.Minutes(1), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:59:00Z"))
        assertEquals(IncidentAge.Minutes(59), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:01:00Z"))
    }

    @Test
    fun relativeFromBucketsHoursUnderADay() {
        assertEquals(IncidentAge.Hours(1), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:00:00Z"))
        assertEquals(IncidentAge.Hours(3), IncidentsCardProjection.relativeFrom(now, "2026-04-04T12:00:00Z"))
        assertEquals(IncidentAge.Hours(23), IncidentsCardProjection.relativeFrom(now, "2026-04-03T15:00:01Z"))
    }

    @Test
    fun relativeFromBucketsDaysFromADayOnwardWithNoWeekRollover() {
        assertEquals(IncidentAge.Days(1), IncidentsCardProjection.relativeFrom(now, "2026-04-03T15:00:00Z"))
        assertEquals(IncidentAge.Days(3), IncidentsCardProjection.relativeFrom(now, "2026-04-01T15:00:00Z"))
        assertEquals(IncidentAge.Days(30), IncidentsCardProjection.relativeFrom(now, "2026-03-05T15:00:00Z"))
    }

    @Test
    fun relativeFromClampsFutureTimestampsToJustNow() {
        assertEquals(IncidentAge.JustNow, IncidentsCardProjection.relativeFrom(now, "2026-04-04T15:30:00Z"))
    }

    @Test
    fun relativeFromReturnsNullForBlankOrUnparseableTimestamps() {
        assertNull(IncidentsCardProjection.relativeFrom(now, ""))
        assertNull(IncidentsCardProjection.relativeFrom(now, "   "))
        assertNull(IncidentsCardProjection.relativeFrom(now, "not-a-date"))
    }

    @Test
    fun relativeFromAcceptsOffsetAndZonelessTimestamps() {
        assertEquals(IncidentAge.Minutes(30), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:30:00+00:00"))
        assertEquals(IncidentAge.Minutes(30), IncidentsCardProjection.relativeFrom(now, "2026-04-04T14:30:00"))
    }

    // ── Full projection ────────────────────────────────────────────────────────

    @Test
    fun projectMapsEveryFieldForAMajorInvestigatingIncident() {
        val row = IncidentsCardProjection.project(baseIncident(), now)

        assertEquals(1L, row.id)
        assertEquals("Wall connector restart", row.title)
        assertEquals("major", row.severity)
        assertEquals(IncidentSeverityTone.Major, row.severityTone)
        assertEquals("investigating", row.status)
        assertEquals(IncidentStatusTone.Danger, row.statusTone)
        assertEquals("tesla, telemetry", row.affectedJoined)
        assertEquals(IncidentAge.Minutes(30), row.startedAge)
        assertEquals(2, row.updatesCount)
        assertTrue(row.showUpdates)
    }

    @Test
    fun projectJoinsAffectedComponentsAndNullsAnEmptyList() {
        val single = IncidentsCardProjection.project(baseIncident().copy(affectedComponents = listOf("tesla")), now)
        val none = IncidentsCardProjection.project(baseIncident().copy(affectedComponents = emptyList()), now)
        assertEquals("tesla", single.affectedJoined)
        assertNull(none.affectedJoined)
    }

    @Test
    fun projectGuardsTheUpdatesSuffixToMoreThanOne() {
        assertFalse(IncidentsCardProjection.project(baseIncident().copy(updates = emptyList()), now).showUpdates)
        assertEquals(0, IncidentsCardProjection.project(baseIncident().copy(updates = emptyList()), now).updatesCount)
        val single = listOf(IncidentUpdateEntry(at = "2026-04-04T14:30:00Z", status = "investigating", message = "x"))
        assertFalse(IncidentsCardProjection.project(baseIncident().copy(updates = single), now).showUpdates)
    }

    @Test
    fun projectLeavesAgeNullForUnparseableStartedAt() {
        assertNull(IncidentsCardProjection.project(baseIncident().copy(startedAt = "bad"), now).startedAge)
    }

    // ── List projection + active count ─────────────────────────────────────────

    @Test
    fun projectListMapsEveryIncidentInFeedOrder() {
        val response =
            IncidentListResponse(
                incidents =
                    listOf(
                        baseIncident().copy(id = 7, title = "First"),
                        baseIncident().copy(id = 9, title = "Second"),
                    ),
                count = 2,
            )
        val rows = IncidentsCardProjection.project(response, now)
        assertEquals(2, rows.size)
        assertEquals(7L, rows[0].id)
        assertEquals("First", rows[0].title)
        assertEquals(9L, rows[1].id)
    }

    @Test
    fun projectListYieldsEmptyForANullResponse() {
        assertTrue(IncidentsCardProjection.project(null, now).isEmpty())
    }

    @Test
    fun activeCountReflectsTheIncidentListSize() {
        assertEquals(0, IncidentsCardProjection.activeCount(null))
        assertEquals(0, IncidentsCardProjection.activeCount(IncidentListResponse()))
        val response = IncidentListResponse(incidents = listOf(baseIncident(), baseIncident().copy(id = 2)), count = 2)
        assertEquals(2, IncidentsCardProjection.activeCount(response))
    }

    // ── i18n resolver (web t(key, default)) ────────────────────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresentElseFallback() {
        val present: (String) -> String? = { "Localized" }
        assertEquals("Localized", resolveOptional(present, KEY_TITLE, IncidentsCardDefaults.TITLE))
        assertEquals(IncidentsCardDefaults.TITLE, resolveOptional({ null }, KEY_TITLE, IncidentsCardDefaults.TITLE))
        assertEquals(IncidentsCardDefaults.LOG, resolveOptional({ "   " }, KEY_LOG, IncidentsCardDefaults.LOG))
    }
}
