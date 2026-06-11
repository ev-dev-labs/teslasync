@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.solarproduction

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the SolarProduction off-device tests — tiny hand-built bodies shaped exactly
 * like the `/tesla/energy-sites` list + `/tesla/energy-sites/{id}/energy-history?period=day` payloads the
 * web hooks decode. Kept here so the projection + view-model tests build identical inputs.
 */

/** One `/tesla/energy-sites/{id}/energy-history` row; each field is omitted when `null`. */
internal data class SolarRow(
    val timestamp: String? = null,
    val solarWh: Double? = null,
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
 * A `/tesla/energy-sites/{id}/energy-history` array built from [rows]. `solar_energy_wh` is omitted when
 * `null` so the "missing field → 0" decode path is exercised; the `timestamp` is omitted when null.
 */
internal fun historyJson(rows: List<SolarRow>): JsonElement =
    buildJsonArray {
        rows.forEach { row ->
            add(
                buildJsonObject {
                    if (row.timestamp != null) put("timestamp", row.timestamp)
                    if (row.solarWh != null) put("solar_energy_wh", row.solarWh)
                },
            )
        }
    }

/** An empty `/tesla/energy-sites/{id}/energy-history` array (linked site, no rows). */
internal fun emptyHistoryJson(): JsonElement = buildJsonArray { }

/** An empty JSON object — the "not an array" history edge (`parseSolarDays` → empty list). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
