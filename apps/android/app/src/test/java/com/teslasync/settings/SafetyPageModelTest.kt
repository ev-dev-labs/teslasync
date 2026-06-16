package io.teslasync.android.settings.safety

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device unit coverage of the pure [SafetyPageModel] declarations — the deterministic listing order (web
 * `SAFETY_ROWS`), the `/settings` document decode with the web `useSettings` defaults (web `settings ?? defaults`),
 * the per-row value projection (web `renderValue`), and the surface registration identity. No Android, UI, or network
 * in the loop, so the whole projection is exercised by the :app:testDebugUnitTest gate.
 */
class SafetyPageModelTest {
    // ── Defaults (web useSettings `defaults`) ────────────────────────────────────

    @Test
    fun defaultsMirrorWebUseSettingsDefaults() {
        val d = SafetySettings.DEFAULT
        assertEquals(false, d.quietHoursEnabled)
        assertEquals("22:00", d.quietHoursStart)
        assertEquals("07:00", d.quietHoursEnd)
        assertEquals("instant", d.alertDigestMode)
        assertEquals(true, d.criticalFlashEnabled)
        assertEquals(true, d.tabBadgeEnabled)
        assertEquals(false, d.apiSuspended)
    }

    // ── Decode (web `const raw = settings ?? defaults`) ──────────────────────────

    @Test
    fun fromDocumentNullYieldsDefaults() {
        assertEquals(SafetySettings.DEFAULT, SafetySettings.fromDocument(null))
    }

    @Test
    fun fromDocumentNonObjectYieldsDefaults() {
        assertEquals(SafetySettings.DEFAULT, SafetySettings.fromDocument(JsonPrimitive("not-an-object")))
    }

    @Test
    fun fromDocumentReadsLiveValues() {
        val doc =
            buildJsonObject {
                put("quiet_hours_enabled", JsonPrimitive(true))
                put("quiet_hours_start", JsonPrimitive("23:30"))
                put("quiet_hours_end", JsonPrimitive("06:15"))
                put("alert_digest_mode", JsonPrimitive("daily"))
                put("critical_flash_enabled", JsonPrimitive(false))
                put("tab_badge_enabled", JsonPrimitive(false))
                put("api_suspended", JsonPrimitive(true))
            }
        val s = SafetySettings.fromDocument(doc)
        assertEquals(
            SafetySettings(
                quietHoursEnabled = true,
                quietHoursStart = "23:30",
                quietHoursEnd = "06:15",
                alertDigestMode = "daily",
                criticalFlashEnabled = false,
                tabBadgeEnabled = false,
                apiSuspended = true,
            ),
            s,
        )
    }

    @Test
    fun fromDocumentDefaultsMissingFields() {
        // Only one field present; every other safety field falls back to its web default.
        val doc = buildJsonObject { put("api_suspended", JsonPrimitive(true)) }
        val s = SafetySettings.fromDocument(doc)
        assertEquals(true, s.apiSuspended)
        assertEquals(SafetySettings.DEFAULT.quietHoursStart, s.quietHoursStart)
        assertEquals(SafetySettings.DEFAULT.alertDigestMode, s.alertDigestMode)
        assertEquals(SafetySettings.DEFAULT.criticalFlashEnabled, s.criticalFlashEnabled)
    }

    // ── Listing (web SAFETY_ROWS order + set) ────────────────────────────────────

    @Test
    fun listingOrderMirrorsWeb() {
        assertEquals(
            listOf(
                "QuietHoursEnabled",
                "QuietHoursStart",
                "QuietHoursEnd",
                "AlertDigestMode",
                "CriticalFlashEnabled",
                "TabBadgeEnabled",
                "ApiSuspended",
            ),
            SafetySetting.entries.map { it.name },
        )
    }

    @Test
    fun docsAnchorsMirrorWeb() {
        assertEquals("/docs/notifications/quiet-hours.md", SafetySetting.QuietHoursEnabled.docsAnchor)
        assertEquals("/docs/notifications/quiet-hours.md", SafetySetting.QuietHoursStart.docsAnchor)
        assertEquals("/docs/notifications/quiet-hours.md", SafetySetting.QuietHoursEnd.docsAnchor)
        assertEquals("/docs/notifications/digest.md", SafetySetting.AlertDigestMode.docsAnchor)
        assertEquals("/docs/notifications/tab-signalling.md", SafetySetting.CriticalFlashEnabled.docsAnchor)
        assertEquals("/docs/notifications/tab-signalling.md", SafetySetting.TabBadgeEnabled.docsAnchor)
        assertEquals("/docs/operations/api-suspended.md", SafetySetting.ApiSuspended.docsAnchor)
    }

    // ── Per-row value projection (web renderValue) ───────────────────────────────

    @Test
    fun rowValuesProjectFromSettings() {
        val s =
            SafetySettings.DEFAULT.copy(
                quietHoursEnabled = true,
                quietHoursStart = "23:00",
                quietHoursEnd = "07:30",
                alertDigestMode = "hourly",
                criticalFlashEnabled = false,
                tabBadgeEnabled = true,
                apiSuspended = true,
            )
        assertEquals(SafetyRowValue.OnOff(true), SafetySetting.QuietHoursEnabled.value(s))
        assertEquals(SafetyRowValue.Plain("23:00"), SafetySetting.QuietHoursStart.value(s))
        assertEquals(SafetyRowValue.Plain("07:30"), SafetySetting.QuietHoursEnd.value(s))
        assertEquals(SafetyRowValue.Plain("hourly"), SafetySetting.AlertDigestMode.value(s))
        assertEquals(SafetyRowValue.OnOff(false), SafetySetting.CriticalFlashEnabled.value(s))
        assertEquals(SafetyRowValue.OnOff(true), SafetySetting.TabBadgeEnabled.value(s))
        assertEquals(SafetyRowValue.ApiState(true), SafetySetting.ApiSuspended.value(s))
    }

    // ── Registration identity (Destinations.kt) ──────────────────────────────────

    @Test
    fun registrationMirrorsDestination() {
        assertEquals("settingsSafety", SafetyPageRegistration.ROUTE_ID)
        assertEquals("/settings/safety", SafetyPageRegistration.WEB_PATH)
        assertEquals("SafetyPage", SafetyPageRegistration.SLUG)
    }
}
