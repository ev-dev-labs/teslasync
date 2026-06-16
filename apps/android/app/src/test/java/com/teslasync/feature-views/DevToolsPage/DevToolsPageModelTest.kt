// Off-device unit coverage for the DevToolsPage feature view's pure model (P3 acceptance: tab catalog +
// key-resolution + diagnostics). Exercises the ordered [DevToolsTab] catalog and its stable web keys, the
// default-tab + `fromKey` clamp (the web `useUrlEnum(TAB_KEY, TAB_KEYS, DEFAULT_TAB)` analogue), the
// registration SLUG, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testDebugUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.devtoolspage

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

class DevToolsPageModelTest {
    // ── Tab catalog (web `TABS` / `TAB_KEYS`) ───────────────────────────────────

    @Test
    fun tabKeysMatchTheWebContractInOrder() {
        assertEquals(
            listOf("fleet-api", "telemetry", "infrastructure", "utilities", "reference"),
            DevToolsTab.entries.map { it.key },
        )
    }

    @Test
    fun defaultTabIsFleetApi() {
        assertEquals(DevToolsTab.FleetApi, DevToolsTab.DEFAULT)
        assertEquals("fleet-api", DevToolsTab.DEFAULT.key)
    }

    // ── Key resolution (web `useUrlEnum` clamp) ─────────────────────────────────

    @Test
    fun fromKeyResolvesEveryKnownKey() {
        DevToolsTab.entries.forEach { tab ->
            assertEquals(tab, DevToolsTab.fromKey(tab.key))
        }
    }

    @Test
    fun fromKeyFallsBackToDefaultForUnknownOrNull() {
        assertEquals(DevToolsTab.DEFAULT, DevToolsTab.fromKey(null))
        assertEquals(DevToolsTab.DEFAULT, DevToolsTab.fromKey(""))
        assertEquals(DevToolsTab.DEFAULT, DevToolsTab.fromKey("does-not-exist"))
        assertEquals(DevToolsTab.DEFAULT, DevToolsTab.fromKey("Fleet-API"))
    }

    // ── Registry + diagnostics (P1/S11 `view.opened`) ───────────────────────────

    @Test
    fun registrationSlugMatchesSurfaceContract() {
        assertEquals("DevToolsPage", DevToolsPageRegistration.SLUG)
    }

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordDevToolsOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "DevToolsPage"), record.fields)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
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
}
