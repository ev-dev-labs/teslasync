package io.teslasync.android.dashboard.widgets.softwareupdatestatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Framework-free unit tests for the Software Update Status widget — the `updateStatus` threshold useMemo,
 * the `isCompact`/`isTall` size model, the registry constraints, the snapshot field parsing + render
 * projection (the `cached → projection` adapter), the percent/duration formatting and the active-vehicle
 * resolution. These run in the `:android:testReleaseUnitTest` gate and cover the behavior the composables
 * only render.
 */
class SoftwareUpdateStatusProjectionTest {
    // ── updateStatus (web useMemo: no version ⇒ up-to-date; install > download; ===100 ⇒ done) ───
    @Test
    fun statusMatchesWebThresholds() {
        assertEquals(UpdateStatus.UpToDate, SoftwareUpdateProjection.status(null, 100.0, 100.0))
        assertEquals(UpdateStatus.Installing, SoftwareUpdateProjection.status("v", 100.0, 50.0))
        assertEquals(UpdateStatus.Downloading, SoftwareUpdateProjection.status("v", 50.0, null))
        assertEquals(UpdateStatus.Installed, SoftwareUpdateProjection.status("v", 100.0, 100.0))
        assertEquals(UpdateStatus.Ready, SoftwareUpdateProjection.status("v", 100.0, null))
        assertEquals(UpdateStatus.Available, SoftwareUpdateProjection.status("v", null, null))
        assertEquals(UpdateStatus.Available, SoftwareUpdateProjection.status("v", 0.0, 0.0))
    }

    @Test
    fun statusPrefersInstallOverDownload() {
        // Both in flight: the install phase wins (web checks installPct before downloadPct).
        assertEquals(UpdateStatus.Installing, SoftwareUpdateProjection.status("v", 80.0, 20.0))
    }

    // ── size model (web isCompact / isTall) ──────────────────────────────────────────────────────
    @Test
    fun sizeFlagsMatchWeb() {
        assertTrue(SoftwareUpdateStatusSize(cols = 1, rows = 1).isCompact)
        assertFalse(SoftwareUpdateStatusSize(cols = 2, rows = 2).isCompact)
        assertFalse(SoftwareUpdateStatusSize(cols = 1, rows = 1).isTall)
        assertTrue(SoftwareUpdateStatusSize(cols = 2, rows = 2).isTall)
        assertTrue(SoftwareUpdateStatusSize(cols = 1, rows = 2).isTall)
    }

    // ── registry metadata (canonical vehicle.ts) ─────────────────────────────────────────────────
    @Test
    fun registrationMatchesRegistry() {
        assertEquals("software-update-status", SoftwareUpdateStatusRegistration.ID)
        assertEquals("vehicle", SoftwareUpdateStatusRegistration.CATEGORY)
        assertEquals("SoftwareUpdateStatusWidget", SoftwareUpdateStatusRegistration.SLUG)
        assertEquals(SoftwareUpdateStatusSize(cols = 2, rows = 2), SoftwareUpdateStatusRegistration.DEFAULT_SIZE)
        assertEquals(SoftwareUpdateStatusSize(cols = 1, rows = 2), SoftwareUpdateStatusRegistration.MIN_SIZE)
        assertEquals(SoftwareUpdateStatusSize(cols = 4, rows = 40), SoftwareUpdateStatusRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(SoftwareUpdateStatusRegistration.isWithinBounds(SoftwareUpdateStatusSize(cols = 2, rows = 10)))
        assertFalse(SoftwareUpdateStatusRegistration.isWithinBounds(SoftwareUpdateStatusSize(cols = 5, rows = 10)))
        assertFalse(SoftwareUpdateStatusRegistration.isWithinBounds(SoftwareUpdateStatusSize(cols = 1, rows = 1)))
        assertEquals(
            SoftwareUpdateStatusSize(cols = 4, rows = 40),
            SoftwareUpdateStatusRegistration.clamp(SoftwareUpdateStatusSize(cols = 9, rows = 99)),
        )
        assertEquals(
            SoftwareUpdateStatusSize(cols = 1, rows = 2),
            SoftwareUpdateStatusRegistration.clamp(SoftwareUpdateStatusSize(cols = 0, rows = 0)),
        )
    }

    // ── snapshot parsing (web state?.software_version + configData?.software_update_*) ────────────
    @Test
    fun snapshotFromParsesStateAndConfig() {
        val snapshot = SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), fullConfig())
        assertTrue(snapshot.hasState)
        assertEquals("2024.8.9", snapshot.currentVersion)
        assertEquals("2024.12.1", snapshot.updateVersion)
        assertEquals(40.0, snapshot.downloadPct)
        assertEquals(0.0, snapshot.installPct)
        assertEquals(15.0, snapshot.expectedDuration)
        assertEquals("Tonight 2:00 AM", snapshot.scheduledStart)
    }

    @Test
    fun snapshotFromTreatsMissingStateAsEmpty() {
        val snapshot = SoftwareUpdateSnapshot.from(envelope(null), fullConfig())
        assertFalse(snapshot.hasState)
        assertNull(snapshot.currentVersion)
        // The config still parses even when no state is present (matches the independent web hooks).
        assertEquals("2024.12.1", snapshot.updateVersion)
    }

    @Test
    fun snapshotFromTreatsAbsentConfigAsNoUpdate() {
        // web: configData undefined ⇒ every software_update_* read is null ⇒ "up to date".
        val snapshot = SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), JsonNull)
        assertTrue(snapshot.hasState)
        assertNull(snapshot.updateVersion)
        assertNull(snapshot.downloadPct)
        assertNull(snapshot.scheduledStart)
        assertEquals(
            UpdateStatus.UpToDate,
            SoftwareUpdateProjection.project(snapshot, SoftwareUpdateStatusRegistration.DEFAULT_SIZE).status,
        )
    }

    @Test
    fun snapshotFromTreatsBlankUpdateVersionAsNone() {
        val config = buildJsonObject { put("software_update_version", "") }
        val snapshot = SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), config)
        assertNull(snapshot.updateVersion)
    }

    // ── projection: up to date (no version) ──────────────────────────────────────────────────────
    @Test
    fun projectUpToDateHidesUpdateSection() {
        val display = projectFull(SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), JsonNull))
        assertTrue(display.hasState)
        assertEquals("2024.8.9", display.currentVersionText)
        assertEquals(UpdateStatus.UpToDate, display.status)
        assertFalse(display.showUpdateSection)
        assertTrue(display.showUpToDate)
        assertFalse(display.showDownloadBar)
    }

    @Test
    fun projectBlankVersionRendersEmDash() {
        val display = projectFull(SoftwareUpdateSnapshot.from(envelope(state("")), JsonNull))
        assertEquals(EM_DASH, display.currentVersionText)
    }

    // ── projection: downloading shows only the download bar ───────────────────────────────────────
    @Test
    fun projectDownloadingShowsDownloadBarOnly() {
        val config =
            buildJsonObject {
                put("software_update_version", "2024.12.1")
                put("software_update_download_pct", 47.0)
            }
        val display = projectFull(SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), config))
        assertEquals(UpdateStatus.Downloading, display.status)
        assertTrue(display.showUpdateSection)
        assertTrue(display.showDownloadBar)
        assertFalse(display.showInstallBar)
        assertFalse(display.showReady)
        assertFalse(display.showUpToDate)
    }

    // ── projection: installing shows the install bar; tall reveals est-time + scheduled ───────────
    @Test
    fun projectInstallingTallShowsBarAndDetails() {
        val config =
            buildJsonObject {
                put("software_update_version", "2024.12.1")
                put("software_update_download_pct", 100.0)
                put("software_update_install_pct", 62.0)
                put("software_update_expected_duration", 12.0)
                put("software_update_scheduled_start", "Tonight 2:00 AM")
            }
        val display = projectFull(SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), config))
        assertEquals(UpdateStatus.Installing, display.status)
        assertTrue(display.showInstallBar)
        assertTrue(display.showExpectedDuration)
        assertTrue(display.showScheduled)
    }

    @Test
    fun projectCompactHidesUpdateSectionDetails() {
        val config =
            buildJsonObject {
                put("software_update_version", "2024.12.1")
                put("software_update_install_pct", 62.0)
                put("software_update_expected_duration", 12.0)
            }
        val display =
            SoftwareUpdateProjection.project(
                SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), config),
                SoftwareUpdateStatusSize(cols = 1, rows = 1),
            )
        assertTrue(display.isCompact)
        assertFalse(display.isTall)
        // est-time/scheduled rows only appear in the tall full layout (web `isTall`).
        assertFalse(display.showExpectedDuration)
        assertFalse(display.showScheduled)
    }

    @Test
    fun projectReadyShowsReadyRow() {
        val config =
            buildJsonObject {
                put("software_update_version", "2024.12.1")
                put("software_update_download_pct", 100.0)
            }
        val display = projectFull(SoftwareUpdateSnapshot.from(envelope(state("2024.8.9")), config))
        assertEquals(UpdateStatus.Ready, display.status)
        assertTrue(display.showReady)
        assertFalse(display.showDownloadBar)
    }

    // ── formatting (web `${pct}%` / `~{minutes}`) ─────────────────────────────────────────────────
    @Test
    fun formatPercentTrimsWholeNumbers() {
        assertEquals("47%", SoftwareUpdateFormat.percent(47.0))
        assertEquals("47.5%", SoftwareUpdateFormat.percent(47.5))
        assertEquals("100%", SoftwareUpdateFormat.percent(100.0))
    }

    @Test
    fun formatDurationTrimsWholeNumbers() {
        assertEquals("12", SoftwareUpdateFormat.duration(12.0))
        assertEquals("12.5", SoftwareUpdateFormat.duration(12.5))
    }

    // ── active-vehicle resolution (web id = vehicleId ?? vehicles?.[0]?.id ?? 0) ──────────────────
    @Test
    fun resolveVehicleIdPrefersPropThenFirst() {
        assertEquals(5L, resolveVehicleId(5L, listOf(vehicle(9))))
        assertEquals(9L, resolveVehicleId(null, listOf(vehicle(9), vehicle(10))))
        assertEquals(9L, resolveVehicleId(0L, listOf(vehicle(9))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    @Test
    fun firstVehicleIdReadsFirstOrNull() {
        assertEquals(7L, firstVehicleId(listOf(vehicle(7), vehicle(8))))
        assertNull(firstVehicleId(emptyList()))
        assertNull(firstVehicleId(null))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────
    private fun projectFull(snapshot: SoftwareUpdateSnapshot): SoftwareUpdateDisplay =
        SoftwareUpdateProjection.project(snapshot, SoftwareUpdateStatusRegistration.DEFAULT_SIZE)

    private fun fullConfig(): JsonObject =
        buildJsonObject {
            put("software_update_version", "2024.12.1")
            put("software_update_download_pct", 40.0)
            put("software_update_install_pct", 0.0)
            put("software_update_expected_duration", 15.0)
            put("software_update_scheduled_start", "Tonight 2:00 AM")
        }

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun state(softwareVersion: String): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 350.0,
            sentryMode = false,
            softwareVersion = softwareVersion,
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
