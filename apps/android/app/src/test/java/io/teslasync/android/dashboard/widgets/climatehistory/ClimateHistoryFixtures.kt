@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.climatehistory

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the ClimateHistory off-device tests — tiny hand-built bodies shaped exactly
 * like the `GET /climate` history payload the web `useClimateHistory` hook decodes (each row carries
 * `created_at` + `timestamp` plus the SI `inside_temp` / `outside_temp` °C fields). Kept here so the
 * projection + view-model tests build identical inputs.
 */

/** One `GET /climate` history row; each field is omitted when `null` so the null-tolerant decode is exercised. */
internal data class ClimateRow(
    val createdAt: String? = null,
    val timestamp: String? = null,
    val insideTemp: Double? = null,
    val outsideTemp: Double? = null,
)

/** A `GET /climate` history array built from [rows]. */
internal fun climateHistoryJson(rows: List<ClimateRow>): JsonElement =
    buildJsonArray {
        rows.forEach { row ->
            add(
                buildJsonObject {
                    if (row.createdAt != null) put("created_at", row.createdAt)
                    if (row.timestamp != null) put("timestamp", row.timestamp)
                    if (row.insideTemp != null) put("inside_temp", row.insideTemp)
                    if (row.outsideTemp != null) put("outside_temp", row.outsideTemp)
                },
            )
        }
    }

/** An empty `GET /climate` history array (resolved, but no rows). */
internal fun emptyClimateHistoryJson(): JsonElement = buildJsonArray { }

/** An empty JSON object — the "not an array" history edge (`parseClimateSamples` → empty list). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
