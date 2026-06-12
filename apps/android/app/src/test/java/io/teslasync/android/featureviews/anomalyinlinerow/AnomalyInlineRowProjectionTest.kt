package io.teslasync.android.featureviews.anomalyinlinerow

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit cover for the pure [AnomalyInlineRowProjection] + the relative-time / ISO helpers — the
 * data adapter the web component derives before returning JSX (the `anomalies_last_24h` / `anomalies[0]` /
 * `SEVERITY_TO_STATUS` reads and the `formatRelative` buckets). Run by the `:android:testReleaseUnitTest`
 * gate; no Android, no coroutines, no UI host.
 */
class AnomalyInlineRowProjectionTest {
    // ── projection: the web's three null branches collapse to the benign empty display ──────────────
    @Test
    fun nullEnvelopeIsEmpty() {
        assertFalse(AnomalyInlineRowProjection.project(null).hasAnomaly)
        assertTrue(AnomalyInlineRowProjection.isEmpty(null))
        assertEquals(AnomalyInlineRowProjection.EMPTY, AnomalyInlineRowProjection.project(null))
    }

    @Test
    fun jsonNullEnvelopeIsEmpty() {
        assertTrue(AnomalyInlineRowProjection.isEmpty(JsonNull))
        assertEquals(HealthRowStatus.Healthy, AnomalyInlineRowProjection.project(JsonNull).status)
    }

    @Test
    fun zeroCountIsEmptyEvenWithEntries() {
        // Web `if (!data || anomalies_last_24h === 0) return null` short-circuits before reading anomalies[0].
        val envelope = envelope(count = 0, severity = "critical", signal = "BatteryVoltage")
        assertTrue(AnomalyInlineRowProjection.isEmpty(envelope))
    }

    @Test
    fun positiveCountWithNoTopEntryIsEmpty() {
        // Web `top = anomalies[0]; if (!top) return null` — a count with an empty array still renders empty.
        val envelope =
            buildJsonObject {
                put("anomalies_last_24h", 4)
                putJsonArray("anomalies") {}
            }
        assertTrue(AnomalyInlineRowProjection.isEmpty(envelope))
    }

    @Test
    fun criticalTopAnomalyProjectsUnhealthy() {
        val display = AnomalyInlineRowProjection.project(envelope(3, "critical", "BatteryVoltage"))
        assertTrue(display.hasAnomaly)
        assertEquals(3, display.count)
        assertEquals(HealthRowStatus.Unhealthy, display.status)
        assertEquals(AnomalyInlineSeverity.Critical, display.topSeverity)
        assertEquals("BatteryVoltage", display.topSignal)
        assertEquals("2026-06-01T12:00:00Z", display.detectedAtIso)
    }

    @Test
    fun warningTopAnomalyProjectsDegraded() {
        val display = AnomalyInlineRowProjection.project(envelope(1, "warning", "TirePressureFL"))
        assertEquals(HealthRowStatus.Degraded, display.status)
        assertEquals(AnomalyInlineSeverity.Warning, display.topSeverity)
    }

    @Test
    fun infoTopAnomalyProjectsUnknown() {
        val display = AnomalyInlineRowProjection.project(envelope(2, "info", "ChargeState"))
        assertEquals(HealthRowStatus.Unknown, display.status)
        assertEquals(AnomalyInlineSeverity.Info, display.topSeverity)
    }

    @Test
    fun unrecognisedSeverityFallsBackToInfo() {
        val display = AnomalyInlineRowProjection.project(envelope(1, "catastrophic", "Signal"))
        assertEquals(AnomalyInlineSeverity.Info, display.topSeverity)
        assertEquals(HealthRowStatus.Unknown, display.status)
    }

    @Test
    fun blankSignalIsNormalisedToNull() {
        assertNull(AnomalyInlineRowProjection.project(envelope(1, "warning", "")).topSignal)
    }

    @Test
    fun floatCountIsTruncatedToInt() {
        val envelope =
            buildJsonObject {
                put("anomalies_last_24h", 5.0)
                putJsonArray("anomalies") { add(anomaly("critical", "Signal")) }
            }
        assertEquals(5, AnomalyInlineRowProjection.project(envelope).count)
    }

    // ── severity wire mapping ────────────────────────────────────────────────────────────────────
    @Test
    fun severityFromWireNormalisesCaseAndWhitespace() {
        assertEquals(AnomalyInlineSeverity.Critical, AnomalyInlineSeverity.fromWire("critical"))
        assertEquals(AnomalyInlineSeverity.Warning, AnomalyInlineSeverity.fromWire(" WARNING "))
        assertEquals(AnomalyInlineSeverity.Info, AnomalyInlineSeverity.fromWire("info"))
        assertEquals(AnomalyInlineSeverity.Info, AnomalyInlineSeverity.fromWire("bogus"))
        assertEquals(AnomalyInlineSeverity.Info, AnomalyInlineSeverity.fromWire(null))
    }

    @Test
    fun severityToStatusMatchesWebRecord() {
        assertEquals(HealthRowStatus.Unhealthy, AnomalyInlineSeverity.Critical.toStatus())
        assertEquals(HealthRowStatus.Degraded, AnomalyInlineSeverity.Warning.toStatus())
        assertEquals(HealthRowStatus.Unknown, AnomalyInlineSeverity.Info.toStatus())
    }

    // ── relative-time buckets (web formatRelative) ─────────────────────────────────────────────────
    @Test
    fun relativeTimeBucketsBySecondsMinutesHoursDays() {
        val now = 1_000_000_000_000L
        assertEquals(RelativeUnit.Seconds, relativeTimeOf(now - 30_000L, now).unit)
        assertEquals(30L, relativeTimeOf(now - 30_000L, now).value)
        assertEquals(RelativeUnit.Minutes, relativeTimeOf(now - 5 * 60_000L, now).unit)
        assertEquals(5L, relativeTimeOf(now - 5 * 60_000L, now).value)
        assertEquals(RelativeUnit.Hours, relativeTimeOf(now - 3 * 3_600_000L, now).unit)
        assertEquals(3L, relativeTimeOf(now - 3 * 3_600_000L, now).value)
        assertEquals(RelativeUnit.Days, relativeTimeOf(now - 2 * 86_400_000L, now).unit)
        assertEquals(2L, relativeTimeOf(now - 2 * 86_400_000L, now).value)
    }

    @Test
    fun relativeTimeNullTimestampIsJustNow() {
        assertEquals(RelativeUnit.JustNow, relativeTimeOf(null, 1_000L).unit)
    }

    @Test
    fun relativeTimeFutureClampsToZeroElapsed() {
        val now = 1_000_000_000_000L
        val future = relativeTimeOf(now + 60_000L, now)
        assertEquals(RelativeUnit.Seconds, future.unit)
        assertEquals(0L, future.value)
    }

    // ── lenient ISO parse ──────────────────────────────────────────────────────────────────────────
    @Test
    fun parseIsoAcceptsInstantOffsetAndZoneless() {
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T00:00:00+00:00"))
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T00:00:00"))
    }

    @Test
    fun parseIsoReturnsNullForBlankOrGarbage() {
        assertNull(parseIsoToEpochMillis(null))
        assertNull(parseIsoToEpochMillis(""))
        assertNull(parseIsoToEpochMillis("not-a-date"))
    }

    // ── fixtures ─────────────────────────────────────────────────────────────────────────────────
    private fun envelope(
        count: Int,
        severity: String,
        signal: String,
    ): JsonElement =
        buildJsonObject {
            put("anomalies_last_24h", count)
            putJsonArray("anomalies") { add(anomaly(severity, signal)) }
        }

    private fun anomaly(
        severity: String,
        signal: String,
    ): JsonElement =
        buildJsonObject {
            put("signal", signal)
            put("severity", severity)
            put("detected_at", "2026-06-01T12:00:00Z")
        }
}
