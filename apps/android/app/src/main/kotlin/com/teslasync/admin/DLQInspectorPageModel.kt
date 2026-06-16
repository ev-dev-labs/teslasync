// Pure, framework-free model + projection for the DLQInspectorPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/DLQInspectorPage.tsx,
// the dead-letter-queue inspector). No Compose, no Android framework, no HTTP lives here: every declaration is
// exercised off-device by the :android:testDebugUnitTest gate, keeping the composable a thin render layer.
//
// The page is an ASSEMBLY surface: it threads the shared `DlqStore` raw-JSON feeds (P1/S8) into the four
// already-built DLQ feature views (StatusHeader / EntriesTable / AuditPanel / EntryDrawer, the A6 component
// parity units), each of which owns its OWN render-ready model type in its OWN package. So this file owns the
// one derivation the web page performs that the components do not: parsing the verbatim `/system/dlq*` server
// JSON into those component types. The list feed (`useDLQList`) decodes both the StatusHeader summary response
// and the EntriesTable row list; the audit feed (`useDLQAudit`) decodes the AuditPanel rows; the entry feed
// (`useDLQEntry`) decodes the EntryDrawer full row; and the replay mutation (`useDLQReplay`) result code is
// read for the replay-blocked-banner branch (web `result === 'disabled'` / HTTP 403). The DLQ feeds are not
// unit-bearing, so there is no SI conversion here (ADR — display-only conversion is moot); values round-trip
// verbatim, exactly as the shared `DlqRepository` carries them.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/admin —
// the P3 prompt's allowed-files path) cannot form the `io.teslasync.android.*` package the rest of the app's
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling ApiLogsPage
// surface does. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.dlq

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import io.teslasync.android.featureviews.auditpanel.DLQReplayAuditRecord as AuditRecord
import io.teslasync.android.featureviews.entriestable.DLQEntrySummary as EntriesSummary
import io.teslasync.android.featureviews.statusheader.DlqListResponse as StatusListResponse
import io.teslasync.android.modalsdialogs.entrydrawer.DlqEntryFull as DrawerFull
import io.teslasync.android.modalsdialogs.entrydrawer.DlqEntrySummary as DrawerSummary

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11), and the audit feed [AUDIT_LIMIT] the web uses (`useDLQAudit(null, 50)`).
 */
object DLQInspectorPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminDlq", "/admin/dlq", …)`). */
    const val ROUTE_ID: String = "adminDlq"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/dlq"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DLQInspectorPage"

    /** Global replay-audit feed limit — the web `useDLQAudit(null, 50)` (`PAGINATION.DEFAULT_LIMIT`). */
    const val AUDIT_LIMIT: Int = 50

    /** Stable replay result codes the page branches on (web `DLQReplayResult`). */
    const val RESULT_OK: String = "ok"
    const val RESULT_DISABLED: String = "disabled"

    /** HTTP status the `DLQ_REPLAY_ENABLED=false` env gate returns (web `error.status === 403`). */
    const val STATUS_REPLAY_DISABLED: Int = 403
}

/**
 * The combined render-ready payload the page's list feed projects to — the native analogue of the web
 * `useDLQList().data`. It carries BOTH shapes the page threads downstream from the one `/system/dlq` response:
 * the [status] summary the StatusHeader reads (count + replayable filter + `replay_enabled`) and the full
 * [entries] row list the EntriesTable renders. [replayEnabled] is hoisted from [status] for the EntryDrawer's
 * Replay gate. [isEmpty] gates the EntriesTable empty phase — the server returned no dead-letter rows.
 */
data class DlqListView(
    val status: StatusListResponse,
    val entries: List<EntriesSummary>,
) {
    /** The server-side `replay_enabled` flag (web `list.data?.replay_enabled ?? false`). */
    val replayEnabled: Boolean get() = status.replayEnabled

    /** Whether the dead-letter queue is empty (web `list.data?.entries ?? []` is empty). */
    val isEmpty: Boolean get() = entries.isEmpty()

    internal companion object {
        val EMPTY: DlqListView = DlqListView(StatusListResponse(), emptyList())
    }
}

/**
 * Pure JSON parsers that turn the verbatim `DlqStore` raw-JSON feeds (P1/S8) into the four DLQ feature views'
 * render-ready types. Tolerant by construction (`ignoreUnknownKeys` + per-row `runCatching`) so a forward-
 * compatible server field or one malformed row never blanks the whole surface — the web's structural typing is
 * just as forgiving. No Compose, no Android: fully off-device testable.
 */
object DlqInspectorParsing {
    private val json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
            coerceInputValues = true
        }

    /**
     * Parses the `GET /system/dlq` response into the [DlqListView] the page threads into StatusHeader +
     * EntriesTable (web `useDLQList`). The summary response decodes the whole envelope (`count` /
     * `replay_enabled` / the replayable entry flags); the row list decodes each `entries[]` element into the
     * full EntriesTable summary, dropping any single unparseable row rather than failing the page.
     */
    fun listView(element: JsonElement): DlqListView {
        val status =
            runCatching { json.decodeFromJsonElement(StatusListResponse.serializer(), element) }
                .getOrDefault(StatusListResponse())
        val rows = (element as? JsonObject)?.get("entries") as? JsonArray ?: JsonArray(emptyList())
        val entries =
            rows.mapNotNull { row ->
                runCatching { json.decodeFromJsonElement(EntriesSummary.serializer(), row) }.getOrNull()
            }
        return DlqListView(status = status, entries = entries)
    }

    /**
     * Parses the `GET /system/dlq/audit` response `rows[]` into the AuditPanel records (web `useDLQAudit`).
     * The AuditPanel record is a plain (non-`@Serializable`) render projection, so each row is mapped field by
     * field from the wire object with the web `?? ''` empty-string fallbacks for the optional string columns.
     */
    fun auditRows(element: JsonElement): List<AuditRecord> {
        val rows = (element as? JsonObject)?.get("rows") as? JsonArray ?: return emptyList()
        return rows.mapNotNull { row -> (row as? JsonObject)?.let(::auditRecord) }
    }

    /**
     * Parses the `GET /system/dlq/{id}` response into the EntryDrawer full row (web `useDLQEntry`) — the summary
     * head plus the two base64 payload blobs. Returns null when the element is not an object so the drawer keeps
     * showing its cached summary instead of a half-parsed row.
     */
    fun entryFull(element: JsonElement): DrawerFull? {
        val obj = element as? JsonObject ?: return null
        return DrawerFull(
            summary = drawerSummary(obj),
            rawPayloadB64 = obj.string("raw_payload_b64") ?: "",
            innerPayloadB64 = obj.string("inner_payload_b64") ?: "",
        )
    }

    /**
     * Reads the replay mutation result code (web `DLQReplayResponse.result`) — `ok` / `disabled` / … — used by
     * the page to branch the success path (close the drawer on `ok`, raise the replay-blocked banner on
     * `disabled`). Defaults to an empty string when absent so an unexpected shape takes the neutral branch.
     */
    fun replayResult(element: JsonElement): String = (element as? JsonObject)?.string("result") ?: ""

    private fun auditRecord(obj: JsonObject): AuditRecord =
        AuditRecord(
            id = obj.long("id") ?: 0L,
            replayedAt = obj.string("replayed_at") ?: "",
            actor = obj.string("actor") ?: "",
            dlqId = obj.long("dlq_id") ?: 0L,
            result = obj.string("result") ?: "",
            dstTopic = obj.string("dst_topic") ?: "",
            error = obj.string("error") ?: "",
            traceId = obj.string("trace_id") ?: "",
        )

    private fun drawerSummary(obj: JsonObject): DrawerSummary =
        DrawerSummary(
            id = obj.long("id") ?: 0L,
            arrivedAt = obj.string("arrived_at") ?: "",
            dlqTopic = obj.string("dlq_topic") ?: "",
            parsedReason = obj.string("parsed_reason") ?: "",
            parsedVin = obj.string("parsed_vin"),
            parsedSourceTopic = obj.string("parsed_source_topic"),
            parsedRedeliveries = obj.long("parsed_redeliveries"),
            parseError = obj.string("parse_error"),
            replayable = obj.bool("replayable") ?: false,
            rawPayloadSize = obj.long("raw_payload_size") ?: 0L,
            innerPayloadSize = obj.long("inner_payload_size") ?: 0L,
            parsedVehicleId = obj.long("parsed_vehicle_id"),
            parsedTimestamp = obj.string("parsed_timestamp"),
        )

    // ── Tolerant readers over the raw feed element ──────────────────────────────────────────────────────────

    private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

    private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

    private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull ?: prim(key)?.intOrNull?.toLong()

    private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull
}

/**
 * Maps the EntriesTable row the user tapped (`onInspect`) into the EntryDrawer's summary head so the drawer can
 * render the row's known fields immediately while the full entry loads — the web `summary={selected}` prop.
 * The two types mirror the same Go DTO; this adapts the EntriesTable shape (redeliveries as `Int?`) to the
 * EntryDrawer shape (redeliveries as `Long?`), carrying every head field the drawer reads.
 */
fun EntriesSummary.toDrawerSummary(): DrawerSummary =
    DrawerSummary(
        id = id,
        arrivedAt = arrivedAt,
        dlqTopic = dlqTopic,
        parsedReason = parsedReason,
        parsedVin = parsedVin,
        parsedSourceTopic = parsedSourceTopic,
        parsedRedeliveries = parsedRedeliveries?.toLong(),
        parseError = parseError,
        replayable = replayable,
        rawPayloadSize = rawPayloadSize,
        innerPayloadSize = innerPayloadSize,
        parsedVehicleId = parsedVehicleId,
        parsedTimestamp = parsedTimestamp,
    )

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no DLQ content. */
internal fun recordDLQInspectorPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DLQInspectorPageRegistration.SLUG))
}
