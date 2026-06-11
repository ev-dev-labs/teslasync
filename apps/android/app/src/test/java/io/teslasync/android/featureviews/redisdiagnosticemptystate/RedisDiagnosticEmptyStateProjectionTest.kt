package io.teslasync.android.featureviews.redisdiagnosticemptystate

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the RedisDiagnosticEmptyState's pure projection — the native port of the
 * web component's error-precedence-then-meta `if` ladder, the per-branch tone/glyph mapping, the
 * "other vehicles" filter, the 7-day TTL check, and the PII-safe `view.opened` diagnostic. Mirrors the
 * web spec + its test (web/src/features/admin/components/RedisDiagnosticEmptyState[.test].tsx).
 */
class RedisDiagnosticEmptyStateProjectionTest {
    private companion object {
        const val SELF_VEHICLE_ID = 7
        const val FIXED_NOW = 1_800_000_000_000L
        const val DAY_MS = 24L * 60 * 60 * 1000
        const val HOUR_MS = 60L * 60 * 1000
    }

    private val tenDaysAgoIso = Instant.ofEpochMilli(FIXED_NOW - 10 * DAY_MS).toString()
    private val oneHourAgoIso = Instant.ofEpochMilli(FIXED_NOW - HOUR_MS).toString()

    // A fixtures builder whose parameters mirror the RedisSignalsMeta fields under test.
    @Suppress("LongParameterList")
    private fun baseMeta(
        mode: String = "hybrid",
        redisFieldCount: Int = 0,
        l1SignalCount: Int = 0,
        l1LastSeenAt: String? = null,
        l2LastSeenAt: String? = null,
        vehicleVin: String = "TESLA1234567890",
    ): RedisSignalsMeta =
        RedisSignalsMeta(
            liveSignalStoreMode = mode,
            redisKey = "vehicle:7:signals",
            redisFieldCount = redisFieldCount,
            l1SignalCount = l1SignalCount,
            l1LastSeenAt = l1LastSeenAt,
            l2LastSeenAt = l2LastSeenAt,
            vehicleVin = vehicleVin,
        )

    private fun project(
        meta: RedisSignalsMeta? = baseMeta(),
        error: DiagnosticError = DiagnosticError.None,
        keys: List<RedisSignalKeyEntry> = emptyList(),
        keysUnavailable: Boolean = false,
    ): RedisDiagnosticState =
        RedisDiagnosticProjection.project(
            vehicleId = SELF_VEHICLE_ID,
            meta = meta,
            error = error,
            otherVehicleKeys = keys,
            keysUnavailable = keysUnavailable,
            nowMs = FIXED_NOW,
        )

    private fun banner(state: RedisDiagnosticState): RedisDiagnosticState.Banner {
        assertTrue("expected a Banner but was $state", state is RedisDiagnosticState.Banner)
        return state as RedisDiagnosticState.Banner
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

    // ── Pre-meta fallback ─────────────────────────────────────────────────────────────────────────

    @Test
    fun legacyEmptyWhenMetaNullAndNoError() {
        assertEquals(RedisDiagnosticState.LegacyEmpty, project(meta = null))
    }

    // ── Meta-driven branches (web branches 1-4) ───────────────────────────────────────────────────

    @Test
    fun modeLocalBanner() {
        val result = banner(project(meta = baseMeta(mode = "local")))
        assertEquals(DiagnosticKind.ModeLocal, result.kind)
    }

    @Test
    fun mirrorBrokenWhenL1HasDataAndL2Empty() {
        val result =
            banner(project(meta = baseMeta(l1SignalCount = 42, redisFieldCount = 0, l1LastSeenAt = oneHourAgoIso)))
        assertEquals(DiagnosticKind.MirrorBroken, result.kind)
        assertEquals(42, result.meta?.l1SignalCount)
    }

    @Test
    fun noTelemetryWhenBothEmptyAndLastSeenAbsent() {
        val result = banner(project(meta = baseMeta(l1SignalCount = 0, redisFieldCount = 0, l1LastSeenAt = null)))
        assertEquals(DiagnosticKind.NoTelemetry, result.kind)
        assertEquals(null, result.meta?.l1LastSeenAt)
    }

    @Test
    fun noTelemetryWhenBothEmptyAndLastSeenOlderThanSevenDays() {
        val result = banner(project(meta = baseMeta(l1SignalCount = 0, redisFieldCount = 0, l1LastSeenAt = tenDaysAgoIso)))
        assertEquals(DiagnosticKind.NoTelemetry, result.kind)
    }

    @Test
    fun emptyFallthroughWhenBothEmptyButLastSeenRecent() {
        val result = banner(project(meta = baseMeta(l1SignalCount = 0, redisFieldCount = 0, l1LastSeenAt = oneHourAgoIso)))
        assertEquals(DiagnosticKind.Empty, result.kind)
    }

    // ── Error branches (web branches 0.A-0.D) take precedence ─────────────────────────────────────

    @Test
    fun cacheNotWiredWhen503NotAvailable() {
        val result = banner(project(meta = null, error = DiagnosticError.Server(503, "Redis signal cache is not available")))
        assertEquals(DiagnosticKind.CacheNotWired, result.kind)
    }

    @Test
    fun unreachableWhen503Unreachable() {
        val result = banner(project(meta = null, error = DiagnosticError.Server(503, "Redis is unreachable")))
        assertEquals(DiagnosticKind.Unreachable, result.kind)
    }

    @Test
    fun unreachableWhen502Upstream() {
        val result = banner(project(meta = null, error = DiagnosticError.Server(502, "upstream connect error")))
        assertEquals(DiagnosticKind.Unreachable, result.kind)
    }

    @Test
    fun requestFailedForGeneric500CarriesStatusAndMessage() {
        val result = banner(project(meta = null, error = DiagnosticError.Server(500, "database query failed")))
        assertEquals(DiagnosticKind.RequestFailed, result.kind)
        assertEquals(500, result.requestStatus)
        assertEquals("database query failed", result.requestMessage)
    }

    @Test
    fun networkErrorBanner() {
        val result = banner(project(meta = null, error = DiagnosticError.Network))
        assertEquals(DiagnosticKind.NetworkError, result.kind)
    }

    @Test
    fun errorBranchesTakePrecedenceOverMetaBranches() {
        val result =
            banner(
                project(
                    meta = baseMeta(l1SignalCount = 99, redisFieldCount = 0),
                    error = DiagnosticError.Server(503, "Redis signal cache is not available"),
                ),
            )
        assertEquals(DiagnosticKind.CacheNotWired, result.kind)
    }

    // ── "Other vehicles" filter (web keys query) ──────────────────────────────────────────────────

    private val sampleKeys =
        listOf(
            RedisSignalKeyEntry(vehicleId = 1, fieldCount = 230, vehicleVin = "VIN1", displayName = "Falcon"),
            RedisSignalKeyEntry(vehicleId = SELF_VEHICLE_ID, fieldCount = 0),
            RedisSignalKeyEntry(vehicleId = 12, fieldCount = 142, vehicleVin = "VIN12", displayName = "Phoenix"),
            RedisSignalKeyEntry(vehicleId = 99, fieldCount = 0),
        )

    @Test
    fun otherKeysFiltersSelfAndZeroFieldVehicles() {
        val result = RedisDiagnosticProjection.otherKeys(SELF_VEHICLE_ID, sampleKeys, keysUnavailable = false)
        assertEquals(listOf(1, 12), result.map { it.vehicleId })
    }

    @Test
    fun otherKeysEmptyWhenKeysUnavailable() {
        val result = RedisDiagnosticProjection.otherKeys(SELF_VEHICLE_ID, sampleKeys, keysUnavailable = true)
        assertTrue(result.isEmpty())
    }

    @Test
    fun otherKeysCarriedOnMetaDrivenBranches() {
        val result = banner(project(meta = baseMeta(l1LastSeenAt = null), keys = sampleKeys))
        assertEquals(DiagnosticKind.NoTelemetry, result.kind)
        assertEquals(listOf(1, 12), result.otherKeys.map { it.vehicleId })
    }

    @Test
    fun otherKeysNotCarriedOnErrorBranches() {
        val result = banner(project(error = DiagnosticError.Server(503, "not available"), keys = sampleKeys))
        assertTrue(result.otherKeys.isEmpty())
    }

    @Test
    fun otherKeysNotCarriedOnModeLocalBranch() {
        // web passes no otherKeys to the mode-local banner.
        val result = banner(project(meta = baseMeta(mode = "local"), keys = sampleKeys))
        assertEquals(DiagnosticKind.ModeLocal, result.kind)
        assertTrue(result.otherKeys.isEmpty())
    }

    // ── TTL suspicion (web SEVEN_DAYS_MS) ─────────────────────────────────────────────────────────

    @Test
    fun ttlSuspectedWhenLastSeenAbsent() {
        assertTrue(RedisDiagnosticProjection.ttlSuspected(null, FIXED_NOW))
    }

    @Test
    fun ttlSuspectedWhenLastSeenOlderThanSevenDays() {
        assertTrue(RedisDiagnosticProjection.ttlSuspected(tenDaysAgoIso, FIXED_NOW))
    }

    @Test
    fun ttlNotSuspectedWhenLastSeenRecent() {
        assertFalse(RedisDiagnosticProjection.ttlSuspected(oneHourAgoIso, FIXED_NOW))
    }

    @Test
    fun ttlSuspectedWhenLastSeenUnparseable() {
        assertTrue(RedisDiagnosticProjection.ttlSuspected("not-a-date", FIXED_NOW))
    }

    // ── Tone + glyph mapping (web per-branch tone/icon) ───────────────────────────────────────────

    @Test
    fun toneForEveryKindMatchesWeb() {
        assertEquals(DiagnosticTone.Danger, RedisDiagnosticProjection.toneFor(DiagnosticKind.CacheNotWired))
        assertEquals(DiagnosticTone.Danger, RedisDiagnosticProjection.toneFor(DiagnosticKind.Unreachable))
        assertEquals(DiagnosticTone.Danger, RedisDiagnosticProjection.toneFor(DiagnosticKind.ModeLocal))
        assertEquals(DiagnosticTone.Warning, RedisDiagnosticProjection.toneFor(DiagnosticKind.RequestFailed))
        assertEquals(DiagnosticTone.Warning, RedisDiagnosticProjection.toneFor(DiagnosticKind.NetworkError))
        assertEquals(DiagnosticTone.Warning, RedisDiagnosticProjection.toneFor(DiagnosticKind.MirrorBroken))
        assertEquals(DiagnosticTone.Info, RedisDiagnosticProjection.toneFor(DiagnosticKind.NoTelemetry))
        assertEquals(DiagnosticTone.Neutral, RedisDiagnosticProjection.toneFor(DiagnosticKind.Empty))
    }

    @Test
    fun glyphForEveryKindMatchesWeb() {
        assertEquals(DiagnosticGlyph.ServerCrash, RedisDiagnosticProjection.glyphFor(DiagnosticKind.CacheNotWired))
        assertEquals(DiagnosticGlyph.ServerCrash, RedisDiagnosticProjection.glyphFor(DiagnosticKind.Unreachable))
        assertEquals(DiagnosticGlyph.ServerCrash, RedisDiagnosticProjection.glyphFor(DiagnosticKind.ModeLocal))
        assertEquals(DiagnosticGlyph.AlertTriangle, RedisDiagnosticProjection.glyphFor(DiagnosticKind.RequestFailed))
        assertEquals(DiagnosticGlyph.AlertTriangle, RedisDiagnosticProjection.glyphFor(DiagnosticKind.NetworkError))
        assertEquals(DiagnosticGlyph.AlertTriangle, RedisDiagnosticProjection.glyphFor(DiagnosticKind.MirrorBroken))
        assertEquals(DiagnosticGlyph.Zap, RedisDiagnosticProjection.glyphFor(DiagnosticKind.NoTelemetry))
        assertEquals(DiagnosticGlyph.Radio, RedisDiagnosticProjection.glyphFor(DiagnosticKind.Empty))
    }

    @Test
    fun isHybridModeOnlyTrueForHybrid() {
        assertTrue(RedisDiagnosticProjection.isHybridMode("hybrid"))
        assertFalse(RedisDiagnosticProjection.isHybridMode("local"))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordRedisDiagnosticEmptyStateOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "RedisDiagnosticEmptyState"), opened.single().second)
    }
}
