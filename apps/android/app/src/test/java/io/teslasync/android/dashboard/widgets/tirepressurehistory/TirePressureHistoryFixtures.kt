@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.tirepressurehistory

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the TirePressureHistory off-device tests — tiny hand-built bodies shaped
 * exactly like the `GET /tire-pressure?vehicle_id=` payload the web hook decodes
 * (`internal/api/tirepressure/handler.go`): each row carries `front_left`/`front_right`/`rear_left`/
 * `rear_right` corner pressures in SI Pascals plus a `ts` timestamp (the handler also echoes it as
 * `created_at`). Kept here so the source + view-model tests build identical inputs.
 */

/** One `/tire-pressure` row; each field is omitted when `null` so the "missing field → null" path is exercised. */
internal data class TireRow(
    val ts: String? = null,
    val frontLeft: Double? = null,
    val frontRight: Double? = null,
    val rearLeft: Double? = null,
    val rearRight: Double? = null,
    /** When set, the timestamp is written under this key instead of `ts` (e.g. `created_at` / `timestamp`). */
    val timestampKey: String = "ts",
)

/** A `/tire-pressure` history array built from [rows]. Each corner / timestamp is omitted when `null`. */
internal fun tireHistoryJson(rows: List<TireRow>): JsonElement =
    buildJsonArray {
        rows.forEach { row ->
            add(
                buildJsonObject {
                    if (row.ts != null) put(row.timestampKey, row.ts)
                    if (row.frontLeft != null) put("front_left", row.frontLeft)
                    if (row.frontRight != null) put("front_right", row.frontRight)
                    if (row.rearLeft != null) put("rear_left", row.rearLeft)
                    if (row.rearRight != null) put("rear_right", row.rearRight)
                },
            )
        }
    }

/** An empty `/tire-pressure` history array (vehicle resolved, no rows). */
internal fun emptyTireHistoryJson(): JsonElement = buildJsonArray { }

/** An empty JSON object — the "not an array" edge (`parseTirePressurePoints` → empty list). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
