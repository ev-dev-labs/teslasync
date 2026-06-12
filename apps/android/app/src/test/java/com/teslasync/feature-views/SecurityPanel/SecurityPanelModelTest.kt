// Off-device unit coverage for the SecurityPanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the snapshot -> display projection (the typed-field reads + the
// web `?? 'Closed'` door/window fallback + the typed `string | null` guard, the lock/sentry/user/remote-start
// tone logic, the truthy-`detail` guard, and the tri-state remote-start value), the security-primary
// two-feed merge (the data adapter: cached resources -> SecuritySnapshot, with first-load skeleton /
// offline-over-cache / hard-error / config-degrades-gracefully precedence), the empty-snapshot classifier
// the composable + view-model switch on (per-state coverage), the value/label routing through the supplied
// i18n strings (a11y label coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP
// — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitypanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityPanelModelTest {
    private val strings =
        SecurityPanelStrings(
            title = "Security",
            locked = "Locked",
            unlocked = "Unlocked",
            lockStatus = "Vehicle lock status",
            sentryMode = "Sentry Mode",
            active = "Active",
            inactive = "Inactive",
            doors = "Doors",
            windows = "Windows",
            closed = "Closed",
            userPresent = "User Present",
            yes = "Yes",
            no = "No",
            remoteStart = "Remote Start",
            enabled = "Enabled",
            disabled = "Disabled",
            noData = "No security data available",
        )

    // A fully-populated SecurityEvent: locked, sentry armed, an open door + vented window, a present user,
    // and a detail line.
    private val fullSecurity =
        buildJsonObject {
            put("locked", true)
            put("sentry_mode", true)
            put("doors_open", "Driver Front")
            put("windows_open", "Vented")
            put("user_present", true)
            put("detail", "Sentry event recorded")
        }
    private val configEnabled = buildJsonObject { put("remote_start_enabled", true) }
    private val configDisabled = buildJsonObject { put("remote_start_enabled", false) }

    private val boom = RuntimeException("network down")

    private fun snapshot(
        security: JsonElement? = null,
        config: JsonElement? = null,
    ) = SecuritySnapshot(security = security, config = config)

    private fun project(snapshot: SecuritySnapshot?) = SecurityPanelProjection.project(snapshot, strings)

    private fun loading() = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false)

    private fun success(
        value: JsonElement,
        fetchedAt: Long = 100L,
    ) = Resource.Success(value, fetchedAt, stale = false)

    private fun error(
        cached: JsonElement? = null,
        stale: Boolean = false,
    ) = Resource.Error(cached = cached, fetchedAt = if (cached != null) 50L else null, stale = stale, error = boom)

    // ── Projection: typed reads + tones (web field reads + green/amber/red/muted styling) ────────

    @Test
    fun projectsTypedSecurityReadings() {
        val display = project(snapshot(fullSecurity, configEnabled))
        assertTrue(display.hasData)
        assertTrue(display.hasSecurity)
        assertTrue(display.locked)
        assertEquals("Locked", display.lockText)
        assertEquals(ValueTone.Success, display.lockTone)
        assertTrue(display.sentryActive)
        assertEquals("Active", display.sentryText)
        assertEquals(ValueTone.Danger, display.sentryTone)
        assertEquals("Driver Front", display.doorsValue)
        assertEquals("Vented", display.windowsValue)
        assertEquals("Yes", display.userPresentText)
        assertEquals(ValueTone.Success, display.userPresentTone)
        assertEquals("Sentry event recorded", display.detail)
        assertEquals("Enabled", display.remoteStartText)
        assertEquals(ValueTone.Success, display.remoteStartTone)
    }

    @Test
    fun lockToneFollowsLockedState() {
        val unlocked = project(snapshot(buildJsonObject { put("locked", false) }))
        assertFalse(unlocked.locked)
        assertEquals("Unlocked", unlocked.lockText)
        assertEquals(ValueTone.Warning, unlocked.lockTone)
    }

    @Test
    fun sentryChipToneFollowsSentryMode() {
        val inactive = project(snapshot(buildJsonObject { put("sentry_mode", false) }))
        assertFalse(inactive.sentryActive)
        assertEquals("Inactive", inactive.sentryText)
        assertEquals(ValueTone.Neutral, inactive.sentryTone)
    }

    @Test
    fun doorsAndWindowsFallBackToClosedWhenAbsent() {
        // The web `doors_open ?? 'Closed'` / `windows_open ?? 'Closed'` fallback (absent string).
        val display = project(snapshot(buildJsonObject { put("locked", true) }))
        assertEquals("Closed", display.doorsValue)
        assertEquals("Closed", display.windowsValue)
    }

    @Test
    fun nonStringDoorsAndWindowsRejectedLikeTheWebTypedContract() {
        // A native-boolean door/window is not the typed `string | null` value → reads as missing → Closed.
        val display =
            project(
                snapshot(
                    buildJsonObject {
                        put("doors_open", false)
                        put("windows_open", true)
                    },
                ),
            )
        assertEquals("Closed", display.doorsValue)
        assertEquals("Closed", display.windowsValue)
    }

    @Test
    fun userPresentToneFollowsPresence() {
        val absent = project(snapshot(buildJsonObject { put("locked", true) }))
        assertEquals("No", absent.userPresentText)
        assertEquals(ValueTone.Neutral, absent.userPresentTone)
    }

    @Test
    fun detailShownOnlyForANonEmptyString() {
        // The web `securityData.detail && <div>{detail}</div>` truthy guard.
        val blankDetail =
            buildJsonObject {
                put("locked", true)
                put("detail", "")
            }
        val lockedOnly = buildJsonObject { put("locked", true) }
        assertEquals("Armed", project(snapshot(buildJsonObject { put("detail", "Armed") })).detail)
        assertNull(project(snapshot(blankDetail)).detail)
        assertNull(project(snapshot(lockedOnly)).detail)
    }

    @Test
    fun remoteStartIsTriStateFromConfig() {
        // The web `remoteStartEnabled == null ? '—' : enabled ? 'Enabled' : 'Disabled'`.
        val enabled = project(snapshot(fullSecurity, configEnabled))
        assertEquals("Enabled", enabled.remoteStartText)
        assertEquals(ValueTone.Success, enabled.remoteStartTone)

        val disabled = project(snapshot(fullSecurity, configDisabled))
        assertEquals("Disabled", disabled.remoteStartText)
        assertEquals(ValueTone.Neutral, disabled.remoteStartTone)

        val unknown = project(snapshot(fullSecurity, null))
        assertEquals(EM_DASH, unknown.remoteStartText)
        assertEquals(ValueTone.Neutral, unknown.remoteStartTone)
    }

    // ── hasData / empty-snapshot classifier (web `securityData != null || remoteStartEnabled != null`) ──

    @Test
    fun snapshotWithOnlyRemoteStartStillHasData() {
        // No SecurityEvent but a known remote-start flag → the panel renders (just the remote-start row).
        val display = project(snapshot(null, configEnabled))
        assertTrue(display.hasData)
        assertFalse(display.hasSecurity)
        assertEquals("Enabled", display.remoteStartText)
    }

    @Test
    fun emptySnapshotDetectedForNoSecurityAndNoRemoteStart() {
        val configWithoutRemoteStart = buildJsonObject { put("software_version", "2026.4") }
        val securityNotAnObject = SecuritySnapshot(JsonPrimitive("x"), configWithoutRemoteStart)
        assertTrue(SecurityPanelProjection.isEmptySnapshot(null))
        assertTrue(SecurityPanelProjection.isEmptySnapshot(SecuritySnapshot(JsonNull, JsonNull)))
        assertTrue(SecurityPanelProjection.isEmptySnapshot(securityNotAnObject))
        assertFalse(SecurityPanelProjection.isEmptySnapshot(snapshot(fullSecurity, null)))
        assertFalse(SecurityPanelProjection.isEmptySnapshot(snapshot(null, configEnabled)))
    }

    @Test
    fun emptySnapshotProjectsToNoData() {
        val display = project(SecuritySnapshot(JsonNull, JsonNull))
        assertFalse(display.hasData)
        assertFalse(display.hasSecurity)
        assertNull(display.detail)
        assertEquals(EM_DASH, display.remoteStartText)
    }

    // ── Data adapter: the security-primary two-feed merge (cached resources -> SecuritySnapshot) ──

    @Test
    fun mergeFirstLoadOnEitherFeedIsTheSkeleton() {
        val securityLoading = mergeSecurity(loading(), success(configEnabled))
        assertTrue(securityLoading is Resource.Loading)
        assertNull((securityLoading as Resource.Loading).cached)

        // Config still loading widens the first-load skeleton even when security has already arrived.
        val configLoading = mergeSecurity(success(fullSecurity), loading())
        assertTrue(configLoading is Resource.Loading)
    }

    @Test
    fun mergeSuccessCombinesSecurityAndConfig() {
        val merged = mergeSecurity(success(fullSecurity), success(configEnabled))
        assertTrue(merged is Resource.Success)
        val display = project((merged as Resource.Success).data)
        assertTrue(display.hasSecurity)
        assertEquals("Enabled", display.remoteStartText)
    }

    @Test
    fun mergeConfigErrorDegradesRemoteStartButKeepsSecurity() {
        // A config failure must not break the surface — security succeeds and the remote-start row shows "—".
        val merged = mergeSecurity(success(fullSecurity), error())
        assertTrue(merged is Resource.Success)
        val display = project((merged as Resource.Success).data)
        assertTrue(display.hasSecurity)
        assertEquals(EM_DASH, display.remoteStartText)
    }

    @Test
    fun mergeSecurityErrorWithNoCacheIsAHardError() {
        val merged = mergeSecurity(error(), success(configEnabled))
        assertTrue(merged is Resource.Error)
        assertNull((merged as Resource.Error).cached)
    }

    @Test
    fun mergeSecurityErrorWithCacheStaysOffline() {
        val merged = mergeSecurity(error(cached = fullSecurity), success(configEnabled))
        assertTrue(merged is Resource.Error)
        val error = merged as Resource.Error
        assertTrue(error.stale)
        assertTrue(project(error.cached).hasSecurity)
    }

    // ── Lifecycle surface states (per-state coverage) ────────────────────────────

    @Test
    fun perStateUiSurfacesClassifyCorrectly() {
        assertTrue(UiState.loading<SecuritySnapshot>().isLoading)

        val content = UiState(phase = UiPhase.Content, data = snapshot(fullSecurity, configEnabled), fetchedAt = 1L)
        assertTrue(content.isContent)
        assertTrue(project(content.data).hasData)

        val empty = UiState(phase = UiPhase.Empty, data = SecuritySnapshot(JsonNull, JsonNull), fetchedAt = 1L)
        assertTrue(empty.isEmpty)
        assertFalse(project(empty.data).hasData)

        val error = UiState<SecuritySnapshot>(phase = UiPhase.Error, errorKind = ErrorKind.Network)
        assertTrue(error.isError)
        assertFalse(error.hasData)
    }

    @Test
    fun offlineCachedStateStaysContentAndStillRendersTheBody() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = snapshot(fullSecurity, configEnabled),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertFalse(offline.isEmpty)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        // Cached data still renders the full security body while stale.
        assertTrue(project(offline.data!!).hasSecurity)
    }

    // ── i18n / a11y labels (web `t('telemetry.*' / 'common.*')`) ─────────────────

    @Test
    fun valuesRouteThroughTheSuppliedI18nStrings() {
        val localized =
            strings.copy(locked = "Verrouillé", active = "Actif", yes = "Oui", enabled = "Activé", closed = "Fermé")
        val security =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", true)
                put("user_present", true)
            }
        val display = SecurityPanelProjection.project(snapshot(security, configEnabled), localized)
        assertEquals("Verrouillé", display.lockText)
        assertEquals("Actif", display.sentryText)
        assertEquals("Oui", display.userPresentText)
        assertEquals("Activé", display.remoteStartText)
        // The absent-door fallback also routes through the localized "Closed".
        assertEquals("Fermé", display.doorsValue)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordSecurityPanelOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "SecurityPanel"), record.fields)
        assertEquals("SecurityPanel", SECURITY_PANEL_SLUG)
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
