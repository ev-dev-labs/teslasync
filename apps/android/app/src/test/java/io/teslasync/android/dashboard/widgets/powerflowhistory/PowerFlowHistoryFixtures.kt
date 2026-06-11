@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.powerflowhistory

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the PowerFlowHistory off-device tests — tiny hand-built bodies shaped exactly
 * like the `/tesla/energy-sites` list + `/tesla/energy-sites/{id}/live-status/history` payloads the web
 * hooks decode. Kept here so the projection + view-model tests build identical inputs.
 */

/** One `/tesla/energy-sites/{id}/live-status/history` row; each field is omitted when `null`. */
internal data class HistoryRow(
    val timestamp: String? = null,
    val solar: Double? = null,
    val battery: Double? = null,
    val grid: Double? = null,
    val load: Double? = null,
)

/** A one-row `/tesla/energy-sites` list; [siteId] is omitted when `null` (the no-id edge). */
internal fun sitesJson(siteId: Long?): JsonElement =
    buildJsonArray {
        add(
            buildJsonObject {
                put("id", 1L)
                if (siteId != null) put("energy_site_id", siteId)
                put("site_name", "Home")
                put("resource_type", "battery")
            },
        )
    }

/** An empty `/tesla/energy-sites` list (no linked site). */
internal fun emptySitesJson(): JsonElement = buildJsonArray { }

/**
 * A `/tesla/energy-sites/{id}/live-status/history` array built from [rows]. Each power field is omitted
 * when `null` so the "missing field → 0" decode path is exercised; the `timestamp` is omitted when null.
 */
internal fun historyJson(rows: List<HistoryRow>): JsonElement =
    buildJsonArray {
        rows.forEach { row ->
            add(
                buildJsonObject {
                    if (row.timestamp != null) put("timestamp", row.timestamp)
                    if (row.solar != null) put("solar_power", row.solar)
                    if (row.battery != null) put("battery_power", row.battery)
                    if (row.grid != null) put("grid_power", row.grid)
                    if (row.load != null) put("load_power", row.load)
                },
            )
        }
    }

/** An empty `/tesla/energy-sites/{id}/live-status/history` array (linked site, no rows). */
internal fun emptyHistoryJson(): JsonElement = buildJsonArray { }

/** An empty JSON object — the "not an array" history edge (`parsePowerFlowSamples` → empty list). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
