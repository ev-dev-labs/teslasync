// Pure, framework-free model + projections for the SoftwareUpdatesPage vehicle-systems surface (P3/A7) — the
// native analogue of everything web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx derives before it
// composes its panels. No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references
// only the shared-core SI [io.teslasync.shared.core.api.generated.Vehicle] DTO, kotlinx-serialization JSON, and
// java.time/java.net), so the composable stays a thin render layer and all of this stays unit-testable off-device
// by the :app:testDebugUnitTest gate.
//
// The web page reads one backend source — `request<SoftwareUpdate[]>('/software-updates?…')` — then renders three
// summary MetricCards (current version, updates installed, total updates) and a paginated GlassPanel "Update
// Timeline" of per-version cards (version + status chip + release-notes link + the resolved vehicle name + the
// installed/scheduled/created dates). Because the page inlines `request()` instead of the typed `useSoftwareUpdates`
// hook, the parity generator marked it "no API data sources"; the canonical KMP seam is nonetheless
// [io.teslasync.shared.core.data.repo.VehicleSystemsRepository.softwareUpdates] (`GET /software-updates`,
// `safeArray`-guarded), which the surface binds for genuine loading / empty / error / success states.
//
// This file ports the page's value derivations: parsing the raw SI JSON array into [SoftwareUpdate]s, the
// status→style classification (web `STATUS_CONFIG[status] ?? STATUS_CONFIG.available`), the latest-version /
// installed-count / total-count summary folds, the per-row date labels (web `formatDate`), the release-notes URL,
// and the vehicle-id→display-name map (web `vehicleMap`). The i18n labels stay at the Compose boundary, so this
// model produces only values + the framework-free [SoftwareUpdateStatusKind] the render layer maps to icon/colour.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.softwareupdates

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.net.URLEncoder
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SoftwareUpdatesPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("softwareUpdates", "/software-updates", NavGroup.VehicleSystems)`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/software-updates`
 * + `/vehicle-systems/software` deep links) without the nav module depending on it.
 */
object SoftwareUpdatesPageRegistration {
    /** The navigation destination id (Destinations.kt `page("softwareUpdates", "/software-updates", …)`). */
    const val ROUTE_ID: String = "softwareUpdates"

    /** The primary web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/software-updates"

    /** The secondary web route aliased to the same destination (RouteTable.kt `/vehicle-systems/software`). */
    const val WEB_PATH_ALT: String = "/vehicle-systems/software"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/update id. */
    const val SLUG: String = "SoftwareUpdatesPage"

    /** The notateslaapp release-notes deep-link prefix (web `href`), completed with the URL-encoded version. */
    const val RELEASE_NOTES_PREFIX: String = "https://www.notateslaapp.com/software-updates/version/"

    /** The notateslaapp release-notes deep-link suffix (web `href`). */
    const val RELEASE_NOTES_SUFFIX: String = "/release-notes"
}

/**
 * One firmware update row — the native mirror of the web `SoftwareUpdate` interface. Dates stay as raw ISO
 * strings (formatted at the display boundary by [formatSoftwareUpdateDate]); the backend sends snake_case keys
 * (Go JSON tags), and the parser also accepts the camelCase aliases the web `camelCaseKeys` transform would add.
 */
data class SoftwareUpdate(
    val id: Long,
    val vehicleId: Long,
    val version: String,
    val status: String,
    val installedAt: String?,
    val scheduledAt: String?,
    val createdAt: String?,
)

/**
 * The framework-free status classification — the web `STATUS_CONFIG` keys. The render layer maps each kind to a
 * badge variant + accent colour + icon + label resource; keeping the enum here lets the classification be unit
 * tested without Compose. An unknown status falls back to [Available] (web `STATUS_CONFIG[status] ?? …available`).
 */
enum class SoftwareUpdateStatusKind { Installed, Installing, Downloading, Available, Scheduled }

/** The exact backend status string for an installed update (web `u.status === 'installed'`). */
private const val STATUS_INSTALLED = "installed"

/** ISO date-prefix length (`yyyy-MM-dd`) used as the last-ditch parse fallback. */
private const val DATE_PREFIX_LENGTH = 10

/**
 * Parses the `GET /software-updates` body (a `safeArray`-guarded raw SI [JsonElement]) into the [SoftwareUpdate]
 * list the page renders. Mirrors the web flow where the array is consumed verbatim: each element that is an object
 * with a numeric id becomes a row; malformed entries are skipped rather than throwing (the web `safeArray` +
 * optional-field access never crashes the render). Snake_case keys are primary, camelCase aliases are accepted.
 */
fun parseSoftwareUpdates(json: JsonElement?): List<SoftwareUpdate> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val id = obj.longField("id") ?: return@mapNotNull null
        SoftwareUpdate(
            id = id,
            vehicleId = obj.longField("vehicle_id", "vehicleId") ?: 0L,
            version = obj.stringField("version") ?: "",
            status = obj.stringField("status") ?: "available",
            installedAt = obj.stringField("installed_at", "installedAt"),
            scheduledAt = obj.stringField("scheduled_at", "scheduledAt"),
            createdAt = obj.stringField("created_at", "createdAt"),
        )
    }
}

/** Classifies a raw backend status into its [SoftwareUpdateStatusKind] (web `getStatus`, unknown → Available). */
fun statusKindOf(status: String): SoftwareUpdateStatusKind =
    when (status.lowercase(Locale.ROOT)) {
        "installed" -> SoftwareUpdateStatusKind.Installed
        "installing" -> SoftwareUpdateStatusKind.Installing
        "downloading" -> SoftwareUpdateStatusKind.Downloading
        "scheduled" -> SoftwareUpdateStatusKind.Scheduled
        else -> SoftwareUpdateStatusKind.Available
    }

/** The current installed version label — web `updates?.[0]?.version ?? t('Unknown')`. */
fun latestVersionOr(
    updates: List<SoftwareUpdate>,
    unknown: String,
): String = updates.firstOrNull()?.version?.takeIf { it.isNotBlank() } ?: unknown

/** Count of installed updates — web `updates?.filter(u => u.status === 'installed').length ?? 0`. */
fun installedCount(updates: List<SoftwareUpdate>): Int = updates.count { it.status == STATUS_INSTALLED }

/** Total updates in the feed — web `updates?.length ?? 0`. */
fun totalUpdateCount(updates: List<SoftwareUpdate>): Int = updates.size

/**
 * The release-notes deep link for [version] — web
 * `https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(version)}/release-notes`.
 */
fun releaseNotesUrl(version: String): String =
    SoftwareUpdatesPageRegistration.RELEASE_NOTES_PREFIX +
        URLEncoder.encode(version, "UTF-8").replace("+", "%20") +
        SoftwareUpdatesPageRegistration.RELEASE_NOTES_SUFFIX

/**
 * The localized date label for a row timestamp — the native port of the web `formatDate(iso)` ("Apr 4, 2026").
 * Tolerates an offset-datetime, a bare date, or a date-prefixed string; returns "" for null/blank/unparseable so
 * the render layer can omit the line (the web only renders the date row when the value is present).
 */
fun formatSoftwareUpdateDate(
    raw: String?,
    locale: Locale,
): String {
    if (raw.isNullOrBlank()) return ""
    val parsed =
        runCatching { OffsetDateTime.parse(raw).toLocalDate() }
            .recoverCatching { LocalDate.parse(raw) }
            .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
            .getOrNull() ?: return ""
    return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
}

/** The vehicle-id → display-name map the timeline resolves each row's owner against (web `vehicleMap`). */
fun vehicleNameMap(vehicles: List<Vehicle>): Map<Long, String> =
    vehicles.associate { it.id to it.displayName }

// ---- JSON field helpers (snake_case primary, camelCase alias) ---------------------

private fun JsonObject.stringField(vararg keys: String): String? {
    for (key in keys) {
        val primitive = this[key] as? JsonPrimitive ?: continue
        val content = primitive.contentOrNull ?: continue
        if (content.isNotEmpty() && content != "null") return content
    }
    return null
}

private fun JsonObject.longField(vararg keys: String): Long? {
    for (key in keys) {
        val primitive = this[key] as? JsonPrimitive ?: continue
        (primitive.longOrNull ?: primitive.contentOrNull?.toLongOrNull())?.let { return it }
    }
    return null
}
