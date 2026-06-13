package io.teslasync.android.modalsdialogs.queuejobdrawer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueJobView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/**
 * Off-device coverage of the pure QueueJobDrawer projection — the parity-critical derivations the web
 * component performs before render (web/src/features/admin/components/QueueJobDrawer.tsx): the
 * `STATUS_TONE` taxonomy, the `title || id` row label, the `displayName` title selector, the
 * `durationLabel` branch (`duration_ms ?? finished - started` through `formatDurationMsLong`), the
 * tolerant ISO-8601 parse, and the PII-safe `view.opened` diagnostic. Run by the
 * `:app:testReleaseUnitTest` gate.
 */
class QueueJobDrawerModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private fun job(
        id: String = "j1",
        title: String = "Charge push",
        status: String = "sent",
    ): QueueJobView =
        QueueJobView(
            id = id,
            worker = "notification",
            status = status,
            title = title,
            startedAt = "2026-06-11T12:00:00Z",
        )

    @Test
    fun toneMatchesWebStatusToneRecord() {
        assertEquals(QueueJobTone.Success, QueueJobDrawerProjection.tone("sent"))
        assertEquals(QueueJobTone.Success, QueueJobDrawerProjection.tone("ready"))
        assertEquals(QueueJobTone.Success, QueueJobDrawerProjection.tone("success"))
        assertEquals(QueueJobTone.Warning, QueueJobDrawerProjection.tone("pending"))
        assertEquals(QueueJobTone.Warning, QueueJobDrawerProjection.tone("deferred_dnd"))
        assertEquals(QueueJobTone.Warning, QueueJobDrawerProjection.tone("queued"))
        assertEquals(QueueJobTone.Warning, QueueJobDrawerProjection.tone("partial"))
        assertEquals(QueueJobTone.Info, QueueJobDrawerProjection.tone("processing"))
        assertEquals(QueueJobTone.Info, QueueJobDrawerProjection.tone("running"))
        assertEquals(QueueJobTone.Danger, QueueJobDrawerProjection.tone("failed"))
        assertEquals(QueueJobTone.Muted, QueueJobDrawerProjection.tone("cancelled"))
        assertEquals(QueueJobTone.Muted, QueueJobDrawerProjection.tone("skipped"))
        // Unknown folds to neutral (web `?? 'text-[var(--text-primary)]'`).
        assertEquals(QueueJobTone.Neutral, QueueJobDrawerProjection.tone("something-else"))
    }

    @Test
    fun titleHasWorkerMatchesWebDisplayNameTruthiness() {
        assertEquals(true, QueueJobDrawerProjection.titleHasWorker("Notification worker"))
        assertEquals(false, QueueJobDrawerProjection.titleHasWorker(null))
        assertEquals(false, QueueJobDrawerProjection.titleHasWorker(""))
        assertEquals(false, QueueJobDrawerProjection.titleHasWorker("   "))
    }

    @Test
    fun rowTitleFallsBackToIdWhenBlank() {
        assertEquals("Charge push", QueueJobDrawerProjection.rowTitle(job(title = "Charge push")))
        assertEquals("job-42", QueueJobDrawerProjection.rowTitle(job(id = "job-42", title = "")))
        assertEquals("job-7", QueueJobDrawerProjection.rowTitle(job(id = "job-7", title = "   ")))
    }

    @Test
    fun durationLabelPrefersDurationMs() {
        assertEquals("1.2s", QueueJobDrawerProjection.durationLabel(1240L, "2026-06-11T12:00:00Z", null))
    }

    @Test
    fun durationLabelFallsBackToFinishedMinusStarted() {
        val label =
            QueueJobDrawerProjection.durationLabel(
                durationMs = null,
                startedAt = "2026-06-11T12:00:00Z",
                finishedAt = "2026-06-11T12:00:02Z",
            )
        assertEquals("2.0s", label)
    }

    @Test
    fun durationLabelNullWhenNoDurationAndNoFinish() {
        assertNull(QueueJobDrawerProjection.durationLabel(null, "2026-06-11T12:00:00Z", null))
        assertNull(QueueJobDrawerProjection.durationLabel(null, "2026-06-11T12:00:00Z", ""))
    }

    @Test
    fun durationLabelEmDashWhenFinishedPresentButUnparseable() {
        // Web: `new Date('garbage').getTime()` -> NaN -> formatDurationMsLong(NaN) -> '—' (not null).
        assertEquals(QUEUE_JOB_EM_DASH, QueueJobDrawerProjection.durationLabel(null, "2026-06-11T12:00:00Z", "garbage"))
        assertEquals(QUEUE_JOB_EM_DASH, QueueJobDrawerProjection.durationLabel(null, "garbage", "2026-06-11T12:00:02Z"))
    }

    @Test
    fun projectRowMapsEveryField() {
        val row =
            QueueJobDrawerProjection.projectRow(
                QueueJobView(
                    id = "job-9",
                    worker = "notification",
                    status = "failed",
                    title = "Weekly email",
                    startedAt = "2026-06-11T12:00:00Z",
                    finishedAt = "2026-06-11T12:00:03Z",
                    error = "SMTP timeout",
                ),
            )
        assertEquals("job-9", row.id)
        assertEquals("Weekly email", row.title)
        assertEquals("failed", row.statusWire)
        assertEquals(QueueJobTone.Danger, row.tone)
        assertEquals(Instant.parse("2026-06-11T12:00:00Z").toEpochMilli(), row.startedAtMillis)
        assertEquals("3.0s", row.durationLabel)
        assertEquals("SMTP timeout", row.error)
    }

    @Test
    fun projectRowDropsBlankErrorAndUnparseableStart() {
        val row =
            QueueJobDrawerProjection.projectRow(
                QueueJobView(
                    id = "j1",
                    worker = "notification",
                    status = "sent",
                    title = "Charge push",
                    startedAt = "not-a-date",
                    error = "   ",
                ),
            )
        assertNull(row.error)
        assertNull(row.startedAtMillis)
    }

    @Test
    fun projectRowsPreservesOrder() {
        val rows = QueueJobDrawerProjection.projectRows(listOf(job(id = "a"), job(id = "b"), job(id = "c")))
        assertEquals(listOf("a", "b", "c"), rows.map { it.id })
    }

    @Test
    fun formatDurationMsLongMatchesWebDateFormat() {
        assertEquals(QUEUE_JOB_EM_DASH, QueueJobDrawerProjection.formatDurationMsLong(0L))
        assertEquals(QUEUE_JOB_EM_DASH, QueueJobDrawerProjection.formatDurationMsLong(-5L))
        assertEquals("500ms", QueueJobDrawerProjection.formatDurationMsLong(500L))
        assertEquals("1.0s", QueueJobDrawerProjection.formatDurationMsLong(1_000L))
        assertEquals("45.0s", QueueJobDrawerProjection.formatDurationMsLong(45_000L))
        assertEquals("1m 30s", QueueJobDrawerProjection.formatDurationMsLong(90_000L))
        assertEquals("2m 5s", QueueJobDrawerProjection.formatDurationMsLong(125_000L))
    }

    @Test
    fun parseIsoMillisToleratesOffsetInstantAndGarbage() {
        val utc = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()
        assertEquals(utc, QueueJobDrawerProjection.parseIsoMillis("2026-06-11T12:00:00Z"))
        assertEquals(utc, QueueJobDrawerProjection.parseIsoMillis("2026-06-11T14:00:00+02:00"))
        assertNull(QueueJobDrawerProjection.parseIsoMillis(null))
        assertNull(QueueJobDrawerProjection.parseIsoMillis(""))
        assertNull(QueueJobDrawerProjection.parseIsoMillis("not-a-date"))
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSlug() {
        val logger = RecordingLogger()
        recordQueueJobDrawerViewOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "QueueJobDrawer"), opened.second)
    }
}
