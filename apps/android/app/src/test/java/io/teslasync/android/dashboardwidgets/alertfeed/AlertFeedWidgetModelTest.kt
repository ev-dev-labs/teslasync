package io.teslasync.android.dashboardwidgets.alertfeed

import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.shared.core.presentation.notifications.Alert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure unit tests for the Alert Feed model + projection — the data adapter the prompt requires.
 * Covers newest-first sort + per-footprint cap, the wide/compact subtitle branch, severity
 * normalization, the em-dash title fallback, the drill-through map (+ fallback + encoding),
 * registry metadata/bounds, relative-time bucketing, and the TalkBack description builder.
 */
class AlertFeedWidgetModelTest {
    private fun alert(id: Long): Alert =
        Alert(
            id = id,
            severity = "info",
            title = "Title $id",
            message = "Message $id",
            createdAt = "2024-01-0${id}T00:00:00Z",
        )

    @Test
    fun projectSortsNewestFirst() {
        val rows =
            AlertFeedProjection.project(
                listOf(
                    alert(1),
                    alert(3),
                    alert(2),
                ),
                AlertFeedRegistration.DEFAULT_SIZE,
            )
        assertEquals(listOf(3L, 2L, 1L), rows.map { it.id })
    }

    @Test
    fun projectCapsToFootprintRowBudget() {
        val twenty = (1..20).map { alert(it.toLong()).copy(createdAt = "2024-02-%02dT00:00:00Z".format(it)) }
        assertEquals(5, AlertFeedProjection.project(twenty, AlertFeedSize(cols = 1, rows = 1)).size)
        assertEquals(8, AlertFeedProjection.project(twenty, AlertFeedSize(cols = 2, rows = 4)).size)
        assertEquals(12, AlertFeedProjection.project(twenty, AlertFeedSize(cols = 4, rows = 6)).size)
    }

    @Test
    fun wideLayoutUsesMessageSubtitleCompactUsesSeverityLabel() {
        val wide = AlertFeedProjection.project(listOf(alert(1).copy(message = "Low battery")), AlertFeedSize(4, 4)).first()
        assertEquals(AlertRowSubtitle.Message("Low battery"), wide.subtitle)

        val compact = AlertFeedProjection.project(listOf(alert(1)), AlertFeedSize(2, 4)).first()
        assertEquals(AlertRowSubtitle.SeverityLabel, compact.subtitle)

        val wideBlank = AlertFeedProjection.project(listOf(alert(1).copy(message = "")), AlertFeedSize(4, 4)).first()
        assertEquals(AlertRowSubtitle.None, wideBlank.subtitle)
    }

    @Test
    fun severityIsNormalizedAndTitleFallsBackToEmDash() {
        val rows =
            AlertFeedProjection
                .project(
                    listOf(
                        alert(1).copy(severity = "warning", title = ""),
                        alert(2).copy(severity = "error"),
                        alert(3).copy(severity = "bogus"),
                    ),
                    AlertFeedSize(2, 4),
                ).associateBy { it.id }
        assertEquals(Severity.Warn, rows.getValue(1).severity)
        assertEquals(ALERT_FEED_EM_DASH, rows.getValue(1).title)
        assertEquals(Severity.Critical, rows.getValue(2).severity)
        assertEquals(Severity.Info, rows.getValue(3).severity)
    }

    @Test
    fun drillthroughMapsKnownSignalToContextPageWithContextQuery() {
        val target =
            AlertDrillthrough.forAlert(
                alert(1).copy(vehicleId = 7, ruleSignal = "BatteryLevel"),
            )
        assertEquals("/battery", target.path)
        assertEquals(
            listOf("vehicle_id" to "7", "t" to "2024-01-01T00:00:00Z", "signal" to "BatteryLevel"),
            target.query,
        )
        assertEquals("/battery?vehicle_id=7&t=2024-01-01T00%3A00%3A00Z&signal=BatteryLevel", target.href)
    }

    @Test
    fun drillthroughFallsBackToSignalExplorerForUnknownOrMissingSignal() {
        val unknown = AlertDrillthrough.forAlert(alert(1).copy(vehicleId = 7, ruleSignal = "MysterySignal"))
        assertEquals(AlertDrillthrough.SIGNAL_EXPLORER_FALLBACK, unknown.path)
        assertTrue(unknown.query.contains("signal" to "MysterySignal"))

        val noSignal = AlertDrillthrough.forAlert(alert(1).copy(createdAt = ""))
        assertEquals(AlertDrillthrough.SIGNAL_EXPLORER_FALLBACK, noSignal.path)
        assertEquals(AlertDrillthrough.SIGNAL_EXPLORER_FALLBACK, noSignal.href)
        assertTrue(noSignal.query.isEmpty())
    }

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("alert-feed", AlertFeedRegistration.ID)
        assertEquals("alerts", AlertFeedRegistration.CATEGORY)
        assertEquals("AlertFeedWidget", AlertFeedRegistration.SLUG)
        assertEquals(AlertFeedSize(2, 4), AlertFeedRegistration.DEFAULT_SIZE)
        assertEquals(AlertFeedSize(2, 4), AlertFeedRegistration.MIN_SIZE)
        assertEquals(AlertFeedSize(4, 40), AlertFeedRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(AlertFeedRegistration.isWithinBounds(AlertFeedSize(3, 10)))
        assertTrue(!AlertFeedRegistration.isWithinBounds(AlertFeedSize(1, 4)))
        assertTrue(!AlertFeedRegistration.isWithinBounds(AlertFeedSize(2, 41)))
        assertEquals(AlertFeedSize(2, 4), AlertFeedRegistration.clamp(AlertFeedSize(1, 1)))
        assertEquals(AlertFeedSize(4, 40), AlertFeedRegistration.clamp(AlertFeedSize(9, 99)))
    }

    @Test
    fun sizeDerivesWideTallAndMaxItems() {
        assertTrue(AlertFeedSize(3, 1).isWide)
        assertTrue(!AlertFeedSize(2, 1).isWide)
        assertTrue(AlertFeedSize(2, 2).isTall)
        assertEquals(12, AlertFeedSize(3, 2).maxItems)
        assertEquals(8, AlertFeedSize(2, 2).maxItems)
        assertEquals(5, AlertFeedSize(2, 1).maxItems)
    }

    @Test
    fun parseTimestampToleratesZoneVariantsAndRejectsGarbage() {
        val expected = 1_704_067_200_000L
        assertEquals(expected, AlertFeedProjection.parseTimestampMillis("2024-01-01T00:00:00Z"))
        assertEquals(expected, AlertFeedProjection.parseTimestampMillis("2024-01-01T00:00:00+00:00"))
        assertEquals(expected, AlertFeedProjection.parseTimestampMillis("2024-01-01T00:00:00"))
        assertNull(AlertFeedProjection.parseTimestampMillis(""))
        assertNull(AlertFeedProjection.parseTimestampMillis("   "))
        assertNull(AlertFeedProjection.parseTimestampMillis("not-a-timestamp"))
        assertNull(AlertFeedProjection.parseTimestampMillis(null))
    }

    @Test
    fun relativeTimeLabelBucketsByAge() {
        val now = 1_704_067_200_000L

        fun label(ageMs: Long?) = alertRelativeTimeLabel(ageMs?.let { now - it }, now, justNow = "just now", ago = "ago")
        assertEquals("just now", label(30_000L))
        assertEquals("5m ago", label(5 * 60_000L))
        assertEquals("2h ago", label(2 * 3_600_000L))
        assertEquals("3d ago", label(3 * 86_400_000L))
        assertEquals(ALERT_FEED_EM_DASH, label(null))
    }

    @Test
    fun contentDescriptionComposesSeverityTitleAndTime() {
        val description = alertRowContentDescription("Critical", "Battery low", "5m ago")
        assertEquals("Critical: Battery low, 5m ago", description)
        assertTrue(description.isNotBlank())
    }
}
