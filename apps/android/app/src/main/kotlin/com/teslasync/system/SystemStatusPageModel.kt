// Pure, framework-free model + projection for the SystemStatusPage system surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/system/pages/SystemStatusPage.tsx, the
// operator-grade health dashboard). No Compose, no Android framework, no HTTP lives here: every type is exercised
// off-device, keeping the composable a thin render layer.
//
// The seven reads the page binds arrive as the shared S8 holders' cache-then-network values: the Admin holder's
// raw verbatim server JSON (`GET /system/health` ▸ systemHealth(), `GET /admin/maintenance` ▸ maintenanceState(),
// `GET /backup/runs` ▸ backupRuns(), `GET /backup/configs` ▸ backupConfigs()), the Settings holder's typed
// `AuthStatus` (`GET /auth/status`), the Notifications holder's typed `NotificationStats`
// (`GET /notifications/stats`), and the Vehicles holder's typed `List<Vehicle>` (`GET /vehicles`). So this file
// owns the parse + the client-side derivations the web component does inline: the overall status roll-up
// (web `overallStatus`), the per-section status tones (web `dbStatus` / `teslaAuthStatus` / `workersStatus` /
// `notifStatus`), the component map filter (web drops the camelCase alias keys), the last-successful-backup pick
// (web `lastSuccessfulBackup`), and the backup-staleness arithmetic (web `backupStaleDays`). Values are plain
// counts / bytes / ISO timestamps / a token the backend already computed — none are unit-bearing — so there is no
// SI conversion here; locale number + byte formatting is applied at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling DiagnosticPage / CommandsPage
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.systemstatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.settings.AuthStatus
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Days threshold past which the last successful backup is "stale" — web `STALE_BACKUP_DAYS = 7`. */
internal const val STALE_BACKUP_DAYS: Long = 7

/**
 * Canonical metadata for this surface. The web page is a top-level routed surface (`/system-status`), so this
 * object carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host
 * wires (the pre-existing `Destinations.page("systemStatus", "/system-status", …)` row), and the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object SystemStatusPageRegistration {
    /** The navigation destination id (Destinations.kt `page("systemStatus", "/system-status", …)`). */
    const val ROUTE_ID: String = "systemStatus"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/system-status"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SystemStatusPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no health data. */
internal fun recordSystemStatusPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SystemStatusPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * The semantic health verdict a section maps to at the render boundary — the framework-free analogue of the web
 * `HeroStatus` union (`'healthy' | 'degraded' | 'unhealthy' | 'maintenance' | 'unknown'`). Kept Compose-free here
 * so the roll-up is unit-tested off-device; the page translates each verdict into its themed tone + badge + glyph.
 */
enum class HealthTone { Healthy, Degraded, Unhealthy, Maintenance, Unknown }

/** Maps a backend status token to its [HealthTone] — web `overallStatus`/`dbStatus` switch. */
fun healthToneOf(status: String?): HealthTone =
    when (status?.lowercase()) {
        "healthy", "ok" -> HealthTone.Healthy
        "degraded", "warning" -> HealthTone.Degraded
        "unhealthy", "down", "offline" -> HealthTone.Unhealthy
        else -> HealthTone.Unknown
    }

/** One component health row — the native mirror of an entry of the web `health.components` map. */
data class ComponentRow(
    val name: String,
    val tone: HealthTone,
)

/**
 * The render-ready projection of all seven reads the surface binds — every field the page draws, derived once in
 * one pure pass so the composable never re-derives. Nullable fields stay nullable so the render boundary applies
 * the web `?? '—'` fallbacks honestly rather than fabricating a zero. [isEmpty] gates the native Empty phase: the
 * health spine resolved but carried neither an overall status nor any components (an empty payload).
 */
data class SystemStatusData(
    val overallStatus: HealthTone,
    val maintenanceActive: Boolean,
    val healthStatusToken: String?,
    val components: List<ComponentRow>,
    val servicesOk: Int,
    val servicesTotal: Int,
    val dbStatus: HealthTone,
    val databaseSize: String?,
    val tableCount: Int?,
    val workersTotal: Int,
    val workersHealthy: Int,
    val vehicleCount: Int,
    val teslaConnected: Boolean,
    val teslaTokenExpiryDays: Long?,
    val teslaTokenExpired: Boolean,
    val notifEnabledChannels: Long?,
    val notifTotalChannels: Long?,
    val notifSent: Long?,
    val notifFailed: Long?,
    val notifPending: Long?,
    val backupConfigCount: Int,
    val backupTotalRuns: Int,
    val lastSuccessfulBackupAt: String?,
    val lastSuccessfulSizeBytes: Long?,
    val apiOverBudget: Boolean,
    val updateAvailable: Boolean,
) {
    /** Workers that are not healthy — web `workers.total - workers.healthy_count`. */
    val workersDown: Int get() = (workersTotal - workersHealthy).coerceAtLeast(0)

    /** Whether the operator has at least one backup schedule configured — web `(backupConfigs?.length ?? 0) > 0`. */
    val hasBackupConfig: Boolean get() = backupConfigCount > 0

    /** Whether any backup run has ever completed — web `lastSuccessfulBackup != null`. */
    val hasSuccessfulBackup: Boolean get() = lastSuccessfulBackupAt != null

    /** Notifications verdict — web `notifStatus` (failed > 0 ⇒ degraded, else healthy). */
    val notifTone: HealthTone
        get() =
            when {
                notifFailed == null -> HealthTone.Unknown
                notifFailed > 0 -> HealthTone.Degraded
                else -> HealthTone.Healthy
            }

    /** Background-workers verdict — web `workersStatus` (all healthy ⇒ healthy, some ⇒ degraded, none ⇒ down). */
    val workersTone: HealthTone
        get() =
            when {
                workersTotal == 0 -> HealthTone.Unknown
                workersHealthy == workersTotal -> HealthTone.Healthy
                workersHealthy > 0 -> HealthTone.Degraded
                else -> HealthTone.Unhealthy
            }

    /** Telemetry verdict — web `telemetrySummary` (≥1 vehicle ⇒ healthy, else idle/unknown). */
    val telemetryTone: HealthTone get() = if (vehicleCount > 0) HealthTone.Healthy else HealthTone.Unknown

    /** Tesla-auth verdict — web `teslaAuthStatus` (expired ⇒ unhealthy, expiring ⇒ degraded, connected ⇒ healthy). */
    val teslaAuthTone: HealthTone
        get() =
            when {
                teslaTokenExpired -> HealthTone.Unhealthy
                teslaTokenExpiryDays != null && teslaTokenExpiryDays <= STALE_BACKUP_DAYS -> HealthTone.Degraded
                teslaConnected -> HealthTone.Healthy
                else -> HealthTone.Unhealthy
            }

    /** The Empty-phase gate: the health spine resolved but carried nothing renderable. */
    val isEmpty: Boolean get() = healthStatusToken == null && components.isEmpty()

    companion object {
        val EMPTY: SystemStatusData =
            SystemStatusData(
                overallStatus = HealthTone.Unknown,
                maintenanceActive = false,
                healthStatusToken = null,
                components = emptyList(),
                servicesOk = 0,
                servicesTotal = 0,
                dbStatus = HealthTone.Unknown,
                databaseSize = null,
                tableCount = null,
                workersTotal = 0,
                workersHealthy = 0,
                vehicleCount = 0,
                teslaConnected = false,
                teslaTokenExpiryDays = null,
                teslaTokenExpired = false,
                notifEnabledChannels = null,
                notifTotalChannels = null,
                notifSent = null,
                notifFailed = null,
                notifPending = null,
                backupConfigCount = 0,
                backupTotalRuns = 0,
                lastSuccessfulBackupAt = null,
                lastSuccessfulSizeBytes = null,
                apiOverBudget = false,
                updateAvailable = false,
            )

        /**
         * Folds the seven cached reads into the render-ready model. [health] is the spine (drives the phase); the
         * remaining six fold in best-effort so a still-loading or failed sibling read never blanks the dashboard
         * (web `stats?.…` / `?? 0` semantics). [nowMs] is the injectable clock seam for the token-expiry +
         * backup-staleness arithmetic so the derivation is deterministic in tests.
         */
        @Suppress("LongParameterList")
        fun from(
            health: JsonElement?,
            maintenance: JsonElement?,
            backupRuns: JsonElement?,
            backupConfigs: JsonElement?,
            auth: AuthStatus?,
            notifications: NotificationStats?,
            vehicles: List<Vehicle>?,
            nowMs: Long,
        ): SystemStatusData {
            val healthObj = health as? JsonObject
            val statusToken = healthObj?.string("status")
            val components = parseComponents(healthObj)
            val okCount = components.count { it.tone == HealthTone.Healthy }

            val maintenanceMode = (maintenance as? JsonObject)?.string("mode")
            val maintenanceActive = maintenanceMode == "maintenance"

            val overall =
                if (maintenanceActive) {
                    HealthTone.Maintenance
                } else {
                    healthToneOf(statusToken)
                }

            // The DB component drives the Database section tone; fall back to the overall token when absent.
            val dbComponent = components.firstOrNull { it.name.contains("database", ignoreCase = true) || it.name == "db" }
            val dbStatus = dbComponent?.tone ?: healthToneOf(statusToken)

            // Workers are the component rows whose key names a background worker (web getWorkersHealth analogue).
            val workerRows = components.filter { it.name.contains("worker", ignoreCase = true) }
            val workersHealthy = workerRows.count { it.tone == HealthTone.Healthy }

            val runs = parseArray(backupRuns)
            val successfulRuns = runs.mapNotNull { it as? JsonObject }.filter { it.string("status") == "completed" }
            val lastSuccessful = successfulRuns.firstOrNull()
            val configs = parseArray(backupConfigs)

            val expiryDays = auth?.expiresAt?.let { daysUntil(it, nowMs) }

            return SystemStatusData(
                overallStatus = overall,
                maintenanceActive = maintenanceActive,
                healthStatusToken = statusToken,
                components = components,
                servicesOk = okCount,
                servicesTotal = components.size,
                dbStatus = dbStatus,
                databaseSize = healthObj?.string("database_size"),
                tableCount = healthObj?.int("table_count"),
                workersTotal = workerRows.size,
                workersHealthy = workersHealthy,
                vehicleCount = vehicles?.size ?: 0,
                teslaConnected = auth?.authenticated == true,
                teslaTokenExpiryDays = expiryDays,
                teslaTokenExpired = expiryDays != null && expiryDays < 0,
                notifEnabledChannels = notifications?.enabledChannels,
                notifTotalChannels = notifications?.totalChannels,
                notifSent = notifications?.sent,
                notifFailed = notifications?.failed,
                notifPending = notifications?.pending,
                backupConfigCount = configs.size,
                backupTotalRuns = runs.size,
                lastSuccessfulBackupAt = lastSuccessful?.string("completed_at"),
                lastSuccessfulSizeBytes = lastSuccessful?.long("file_size"),
                // The Tesla-API-usage + update-check feeds are not among the seven reads this surface binds, so
                // the web `apiOverBudget` / `hasUpdate` flags are structurally false here (their callouts stay
                // wired but unshown until a usage/update feed is bound) — never fabricated as true.
                apiOverBudget = false,
                updateAvailable = false,
            )
        }

        // The web filters out the camelCaseKeys() alias keys (anything with an uppercase letter); the Android
        // client receives the raw snake_case server JSON, but we keep the same guard so an aliasing client can't
        // double-count a component.
        private fun parseComponents(health: JsonObject?): List<ComponentRow> {
            val map = health?.get("components") as? JsonObject ?: return emptyList()
            return map.entries
                .filter { (k, _) -> k.none { it.isUpperCase() } }
                .map { (name, value) ->
                    ComponentRow(name = name, tone = healthToneOf((value as? JsonObject)?.string("status")))
                }
        }

        private fun parseArray(element: JsonElement?): List<JsonElement> =
            when (element) {
                is JsonArray -> element
                is JsonObject -> (element["data"] as? JsonArray).orEmptyList()
                else -> emptyList()
            }
    }
}

/**
 * Whole days from [nowMs] until the ISO-8601 [iso] instant — web
 * `Math.floor((exp - now) / (24*60*60*1000))`. Negative when already past. A malformed stamp yields `null` so the
 * Tesla-auth row falls back to its "connected" copy rather than throwing.
 */
fun daysUntil(
    iso: String,
    nowMs: Long,
): Long? {
    val expMs = parseIsoMillis(iso) ?: return null
    return Math.floorDiv(expMs - nowMs, DAY_MS)
}

/**
 * Whole days the last successful backup is old — web `backupStaleDays`. `null` when [iso] is absent/unparseable.
 */
fun backupAgeDays(
    iso: String?,
    nowMs: Long,
): Long? {
    if (iso == null) return null
    val ts = parseIsoMillis(iso) ?: return null
    return Math.floorDiv(nowMs - ts, DAY_MS).coerceAtLeast(0)
}

private const val DAY_MS = 24L * 60 * 60 * 1000

// Parses an ISO-8601 instant to epoch millis without pulling a date library into the model. Accepts the common
// `…Z` / `±hh:mm` offset forms the backend emits; returns null on anything it can't read.
private fun parseIsoMillis(iso: String): Long? =
    runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { java.time.Instant.parse(iso).toEpochMilli() }
        .getOrNull()

// ── JsonElement read helpers (mirroring the sibling ApiLogsPageModel accessors) ─────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.intOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

@Suppress("unused")
private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull

private fun JsonArray?.orEmptyList(): List<JsonElement> = this ?: emptyList()
