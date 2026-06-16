// Pure, framework-free model + projection for the AuditLogPage notifications surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/notifications/pages/AuditLogPage.tsx,
// the searchable system-audit viewer). No Compose, no Android framework, no HTTP lives here: every type is
// exercised off-device, keeping the composable a thin render layer.
//
// The feed arrives as the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`GET /system/audit` ▸ auditLogs(), array-guarded). So this file owns the parse + the client-side
// derivation the web component does inline: the per-row mapping and the `useFilteredList` search predicate
// over the action / resource / details fields.
//
// Wire-shape note: the backend (`internal/api/audit/log_handler.go` → `internal/models/system.AuditLog`)
// serializes snake_case `ts` / `actor` / `action` / `entity_type` / `entity_id` / `detail`. The web
// `AuditLogEntry` interface names the same columns `createdAt` / `action` / `resource` / `details`, so this
// parser reads the real server keys and maps them onto the web's intended display semantics (ts → time,
// entity_type[+entity_id] → resource, detail → details), with the web aliases accepted as fallbacks. Values
// are plain strings the backend already formatted — none are unit-bearing — so there is no SI conversion here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/notifications — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling A7 surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.auditlog

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level notifications route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns
 * the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (matching the `notificationsAudit`
 * destination in Destinations.kt), and the diagnostics [SLUG] emitted with the one-shot `view.opened` event.
 */
object AuditLogPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsAudit", "/notifications/audit", …)`). */
    const val ROUTE_ID: String = "notificationsAudit"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/notifications/audit"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AuditLogPage"
}

/**
 * One audit-log row — the native mirror of the web `AuditLogEntry`. [resource] folds the server
 * `entity_type` and optional `entity_id` into the single "resource" column the web renders; blank wire
 * fields stay blank so the render boundary applies the web `?? '—'` fallback honestly rather than fabricating.
 */
data class AuditLogEntry(
    val id: Long,
    val createdAt: String,
    val action: String,
    val resource: String,
    val details: String,
    val actor: String,
) {
    internal companion object {
        fun from(
            obj: JsonObject?,
            index: Int,
        ): AuditLogEntry? {
            if (obj == null) return null
            return AuditLogEntry(
                id = obj.long("id") ?: index.toLong(),
                createdAt = obj.string("ts") ?: obj.string("created_at") ?: obj.string("createdAt") ?: "",
                action = obj.string("action") ?: "",
                resource = resourceOf(obj),
                details = obj.string("detail") ?: obj.string("details") ?: "",
                actor = obj.string("actor") ?: "",
            )
        }

        /** Web `resource` column = the acted-on entity: `entity_type` plus its `#id` when present. */
        private fun resourceOf(obj: JsonObject): String {
            val type = obj.string("entity_type") ?: obj.string("resource") ?: ""
            val id = obj.long("entity_id")
            return when {
                type.isEmpty() && id == null -> ""
                id == null -> type
                type.isEmpty() -> "#$id"
                else -> "$type #$id"
            }
        }
    }
}

/**
 * The render-ready payload the surface binds to: the parsed [entries]. [isEmpty] gates the native Empty phase
 * — the server returned no audit rows (web `auditLogs?.length` falsy).
 */
data class AuditLogData(
    val entries: List<AuditLogEntry>,
) {
    val isEmpty: Boolean get() = entries.isEmpty()

    internal companion object {
        val EMPTY: AuditLogData = AuditLogData(emptyList())

        /** Parse the raw array-guarded `/system/audit` element into the combined payload. */
        fun from(json: JsonElement?): AuditLogData {
            val array = json as? JsonArray ?: return EMPTY
            return AuditLogData(array.mapIndexedNotNull { i, el -> AuditLogEntry.from(el as? JsonObject, i) })
        }
    }
}

/**
 * The client-side search predicate — the native mirror of the web `useFilteredList(auditLogs, search,
 * ['action', 'resource', 'details'])`: a case-insensitive substring match across the action, resource, and
 * details fields. An empty/blank query returns every row unchanged.
 */
fun filterAuditLogs(
    entries: List<AuditLogEntry>,
    query: String,
): List<AuditLogEntry> {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return entries
    return entries.filter { entry ->
        entry.action.lowercase().contains(needle) ||
            entry.resource.lowercase().contains(needle) ||
            entry.details.lowercase().contains(needle)
    }
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no row content. */
internal fun recordAuditLogPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AuditLogPageRegistration.SLUG))
}

// ── JSON helpers (tolerant readers over the raw AdminStore element) ─────────────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull
