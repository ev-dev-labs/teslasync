package io.teslasync.android.featureviews.backupactionscard

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the BackupActionsCard surface's pure logic — the native analogue of the web
 * parent computing the DefList rows from `getBackupConfigs` + `getBackupRuns`, the web `onError` 401/403-vs-
 * generic toast branch, and the freshness surface selection
 * (web/src/features/system/components/status/BackupActionsCard.tsx + the SystemStatusPage backup section). Also
 * pins the PII-safe diagnostics (surface slug only). Runs in the :android:testReleaseUnitTest gate.
 */
class BackupActionsCardProjectionTest {
    // ── parse(configs, runs) → BackupStatus (the "cached → projection" adapter test) ─────────────────

    @Test
    fun parseCountsSchedulesRunsAndFailures() {
        val configs =
            buildJsonArray {
                add(buildJsonObject { put("id", 1) })
                add(buildJsonObject { put("id", 2) })
            }
        val runs =
            buildJsonArray {
                add(buildJsonObject { put("status", RUN_STATUS_COMPLETED) })
                add(buildJsonObject { put("status", RUN_STATUS_FAILED) })
                add(buildJsonObject { put("status", "running") })
            }
        val status = BackupActionsCardProjection.parse(configs, runs)
        assertEquals(2, status.configuredSchedules)
        assertEquals(3, status.totalRuns)
        assertEquals(1, status.recentFailures)
    }

    @Test
    fun parsePicksTheFirstCompletedRunForLastSuccessful() {
        val runs =
            buildJsonArray {
                add(buildJsonObject { put("status", "running") })
                add(
                    buildJsonObject {
                        put("status", RUN_STATUS_COMPLETED)
                        put("completed_at", "2024-05-01T08:30:00Z")
                        put("file_size", 50_855_936L)
                    },
                )
                add(
                    buildJsonObject {
                        put("status", RUN_STATUS_COMPLETED)
                        put("completed_at", "2020-01-01T00:00:00Z")
                        put("file_size", 1L)
                    },
                )
            }
        val status = BackupActionsCardProjection.parse(JsonNull, runs)
        // The first completed run wins (web `backupRuns.find(r => r.status === 'completed')`).
        assertEquals(1_714_552_200_000L, status.lastSuccessfulAtMillis)
        assertEquals(50_855_936L, status.lastSuccessfulSizeBytes)
    }

    @Test
    fun parseTreatsNonArrayPayloadsAsEmpty() {
        val status = BackupActionsCardProjection.parse(JsonNull, JsonNull)
        assertEquals(0, status.configuredSchedules)
        assertEquals(0, status.totalRuns)
        assertEquals(0, status.recentFailures)
        assertNull(status.lastSuccessfulAtMillis)
        assertNull(status.lastSuccessfulSizeBytes)
        assertTrue(status.hasNothing)
    }

    @Test
    fun parseDropsNonPositiveFileSizeAndMissingCompletedAt() {
        val runs =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("status", RUN_STATUS_COMPLETED)
                        put("file_size", 0L)
                    },
                )
            }
        val status = BackupActionsCardProjection.parse(JsonNull, runs)
        assertNull(status.lastSuccessfulSizeBytes)
        assertNull(status.lastSuccessfulAtMillis)
    }

    // ── selectSurface (ADR-013 freshness contract) ───────────────────────────────────────────────────

    @Test
    fun selectSurfaceMapsEveryLifecycleState() {
        val sample = BackupStatus(2, 14, 1L, 1L, 1)
        assertEquals(BackupActionsSurface.Loading, BackupActionsCardProjection.selectSurface(UiState(UiPhase.Loading)))
        assertEquals(
            BackupActionsSurface.Error,
            BackupActionsCardProjection.selectSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(
            BackupActionsSurface.Empty,
            BackupActionsCardProjection.selectSurface(UiState(UiPhase.Empty, data = BackupStatus(0, 0, null, null, 0))),
        )
        assertEquals(
            BackupActionsSurface.Offline,
            BackupActionsCardProjection.selectSurface(
                UiState(UiPhase.Content, data = sample, stale = true, errorKind = ErrorKind.Network),
            ),
        )
        assertEquals(
            BackupActionsSurface.Stale,
            BackupActionsCardProjection.selectSurface(UiState(UiPhase.Content, data = sample, stale = true)),
        )
        assertEquals(
            BackupActionsSurface.Content,
            BackupActionsCardProjection.selectSurface(UiState(UiPhase.Content, data = sample)),
        )
    }

    // ── errorMessageKey (web onError 401/403 vs generic branch) ───────────────────────────────────────

    @Test
    fun errorMessageKeyRaisesPermissionForUnauthorizedAndForbidden() {
        assertEquals(BACKUP_PERMISSION_KEY, BackupActionsCardProjection.errorMessageKey(ApiError.Http(status = 401)))
        assertEquals(BACKUP_PERMISSION_KEY, BackupActionsCardProjection.errorMessageKey(ApiError.Http(status = 403)))
    }

    @Test
    fun errorMessageKeyRaisesGenericForEverythingElse() {
        assertEquals(BACKUP_FAILED_KEY, BackupActionsCardProjection.errorMessageKey(ApiError.Http(status = 500)))
        assertEquals(BACKUP_FAILED_KEY, BackupActionsCardProjection.errorMessageKey(IllegalStateException("disk full")))
        assertEquals(BACKUP_FAILED_KEY, BackupActionsCardProjection.errorMessageKey(null))
    }

    @Test
    fun isEmptyOnlyWhenNothingConfiguredAndNothingRan() {
        assertTrue(BackupActionsCardProjection.isEmpty(BackupStatus(0, 0, null, null, 0)))
        assertFalse(BackupActionsCardProjection.isEmpty(BackupStatus(1, 0, null, null, 0)))
        assertFalse(BackupActionsCardProjection.isEmpty(BackupStatus(0, 3, null, null, 0)))
    }

    // ── Diagnostics (P1/S11 — PII-safe, surface slug only) ────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        BackupActionsCardDiagnostics.recordViewOpened(logger)
        assertEquals("view.opened", logger.events.single().first)
        assertEquals(mapOf("surface" to "BackupActionsCard"), logger.events.single().second)
    }

    @Test
    fun recordRunQuickBackupEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        BackupActionsCardDiagnostics.recordRunQuickBackup(logger)
        assertEquals("backup.quickRun", logger.events.single().first)
        // PII-safe: only the surface slug is recorded — never a file name, size, or run id.
        assertEquals(mapOf("surface" to "BackupActionsCard"), logger.events.single().second)
    }

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
}
