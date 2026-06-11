package io.teslasync.android.dashboard.widgets.livepowerflow

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Shared JSON fixtures for the LivePowerFlow off-device tests — tiny hand-built bodies shaped exactly
 * like the `/tesla/energy-sites` list + `/tesla/energy-sites/{id}/live-status` payloads the web hooks
 * decode. Kept here so the projection + view-model tests build identical inputs.
 */

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
 * A `/tesla/energy-sites/{id}/live-status` body. Each power field is omitted when `null` so the
 * "missing field → 0" decode path is exercised; the object is always non-empty (carries the ids) so
 * `parseLiveStatus` treats it as a resolved body.
 */
internal fun liveJson(
    solar: Double? = null,
    battery: Double? = null,
    grid: Double? = null,
    load: Double? = null,
): JsonElement =
    buildJsonObject {
        put("id", 1L)
        put("energy_site_id", 12345L)
        if (solar != null) put("solar_power", solar)
        if (battery != null) put("battery_power", battery)
        if (grid != null) put("grid_power", grid)
        if (load != null) put("load_power", load)
    }

/** An empty JSON object — the "resolved but no body" live-status edge (`parseLiveStatus` → null). */
internal fun emptyObjectJson(): JsonElement = buildJsonObject { }
