@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.wallconnector

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the WallConnector off-device tests — tiny hand-built bodies shaped exactly
 * like the `/tesla/energy-sites` list + `/tesla/energy-sites/{id}/charging-history?since=` payloads the
 * web hooks decode. Kept here so the projection + view-model tests build identical inputs.
 */

/** One `/tesla/energy-sites/{id}/charging-history` row; each rendered field is omitted when `null`. */
internal data class WcRow(
    val timestamp: String? = null,
    val energyWh: Double? = null,
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
 * A `/tesla/energy-sites/{id}/charging-history` array built from [rows]. `energy_wh` is omitted when
 * `null` so the "missing field → 0" decode path is exercised; the `timestamp` is omitted when null so the
 * "blank day key → skipped" path is exercised. The stable `id`/`energy_site_id`/`din`/`fetched_at` fields
 * mirror the real `TeslaWCChargingEntry` shape (the model ignores them).
 */
internal fun historyJson(rows: List<WcRow>): JsonElement =
    buildJsonArray {
        rows.forEachIndexed { index, row ->
            add(
                buildJsonObject {
                    put("id", index.toLong())
                    put("energy_site_id", 12345L)
                    put("din", "1234-ABC")
                    if (row.timestamp != null) put("timestamp", row.timestamp)
                    if (row.energyWh != null) put("energy_wh", row.energyWh)
                    put("fetched_at", "2024-06-11T12:00:00Z")
                },
            )
        }
    }

/** An empty `/tesla/energy-sites/{id}/charging-history` array (linked site, no sessions). */
internal fun emptyHistoryJson(): JsonElement = buildJsonArray { }

/** An empty JSON object — the "not an array" edge (`parseWallConnectorEntries` → empty list). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
