@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.softwareupdates

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device unit coverage for the framework-free SoftwareUpdatesPage projection (SoftwareUpdatesPageModel.kt).
 * Exercises the `safeArray` list parse (snake_case + camelCase alias + skip-malformed), the status classification,
 * the summary folds, the release-notes URL, and the date formatter — the native ports of the web page's
 * derivations — with no Compose/Android/HTTP in scope.
 */
class SoftwareUpdatesPageModelTest {
    @Test
    fun parse_readsSnakeCaseRows() {
        val payload =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 12)
                        put("vehicle_id", 3)
                        put("version", "2024.8.7")
                        put("status", "installed")
                        put("installed_at", "2024-06-01T10:00:00Z")
                        put("scheduled_at", JsonNull)
                        put("created_at", "2024-05-30T08:00:00Z")
                    },
                )
            }

        val updates = parseSoftwareUpdates(payload)

        assertEquals(1, updates.size)
        val update = updates.first()
        assertEquals(12L, update.id)
        assertEquals(3L, update.vehicleId)
        assertEquals("2024.8.7", update.version)
        assertEquals("installed", update.status)
        assertEquals("2024-06-01T10:00:00Z", update.installedAt)
        assertNull(update.scheduledAt)
        assertEquals("2024-05-30T08:00:00Z", update.createdAt)
    }

    @Test
    fun parse_acceptsCamelCaseAliasesAndSkipsMalformed() {
        val payload =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 5)
                        put("vehicleId", 9)
                        put("version", "2024.2.1")
                        put("status", "available")
                        put("scheduledAt", "2024-07-01T00:00:00Z")
                        put("createdAt", "2024-06-15T00:00:00Z")
                    },
                )
                add(JsonPrimitive("not-an-object"))
                add(buildJsonObject { put("version", "no-id") })
            }

        val updates = parseSoftwareUpdates(payload)

        assertEquals(1, updates.size)
        assertEquals(9L, updates.first().vehicleId)
        assertEquals("2024-07-01T00:00:00Z", updates.first().scheduledAt)
    }

    @Test
    fun parse_emptyOrNonArrayYieldsEmptyList() {
        assertTrue(parseSoftwareUpdates(null).isEmpty())
        assertTrue(parseSoftwareUpdates(buildJsonArray { }).isEmpty())
        assertTrue(parseSoftwareUpdates(buildJsonObject { put("x", 1) }).isEmpty())
    }

    @Test
    fun statusKind_mapsEveryStatusAndFallsBackToAvailable() {
        assertEquals(SoftwareUpdateStatusKind.Installed, statusKindOf("installed"))
        assertEquals(SoftwareUpdateStatusKind.Installing, statusKindOf("installing"))
        assertEquals(SoftwareUpdateStatusKind.Downloading, statusKindOf("downloading"))
        assertEquals(SoftwareUpdateStatusKind.Available, statusKindOf("available"))
        assertEquals(SoftwareUpdateStatusKind.Scheduled, statusKindOf("scheduled"))
        // Unknown status falls back to Available (web `STATUS_CONFIG[status] ?? STATUS_CONFIG.available`).
        assertEquals(SoftwareUpdateStatusKind.Available, statusKindOf("pending"))
    }

    @Test
    fun summaryFolds_matchWebDerivations() {
        val updates =
            listOf(
                softwareUpdate(id = 1, version = "2024.8.7", status = "installed"),
                softwareUpdate(id = 2, version = "2024.6.1", status = "installed"),
                softwareUpdate(id = 3, version = "2024.4.0", status = "available"),
            )

        assertEquals("2024.8.7", latestVersionOr(updates, "Unknown"))
        assertEquals(2, installedCount(updates))
        assertEquals(3, totalUpdateCount(updates))
    }

    @Test
    fun latestVersion_fallsBackToUnknownWhenEmpty() {
        assertEquals("Unknown", latestVersionOr(emptyList(), "Unknown"))
    }

    @Test
    fun releaseNotesUrl_matchesWebHref() {
        assertEquals(
            "https://www.notateslaapp.com/software-updates/version/2024.8.7/release-notes",
            releaseNotesUrl("2024.8.7"),
        )
    }

    @Test
    fun formatDate_handlesIsoBareAndNull() {
        val iso = formatSoftwareUpdateDate("2026-04-04T02:30:00Z", Locale.US)
        assertTrue(iso.contains("2026"))
        val bare = formatSoftwareUpdateDate("2026-04-04", Locale.US)
        assertTrue(bare.contains("2026"))
        assertEquals("", formatSoftwareUpdateDate(null, Locale.US))
        assertEquals("", formatSoftwareUpdateDate("   ", Locale.US))
        assertEquals("", formatSoftwareUpdateDate("garbage", Locale.US))
    }

    private fun softwareUpdate(
        id: Long,
        version: String,
        status: String,
    ): SoftwareUpdate =
        SoftwareUpdate(
            id = id,
            vehicleId = 1L,
            version = version,
            status = status,
            installedAt = null,
            scheduledAt = null,
            createdAt = "2024-05-30T08:00:00Z",
        )
}
