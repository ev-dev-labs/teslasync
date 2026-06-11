package io.teslasync.android.dashboardwidgets

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import kotlin.math.floor
import kotlin.math.roundToLong

/*
 * Framework-free domain + projection for the BackupHistory dashboard widget — the native port of the
 * data the web `BackupHistoryWidget` (web/src/features/dashboard/widgets/BackupHistoryWidget.tsx)
 * computes before it renders JSX. Pure Kotlin (no Android, no Compose, no coroutines) so the parsing,
 * the `fmtDuration` / `totalOutages` / `avgDurationSec` / `sortedItems` math and the compact-vs-standard
 * branch are all unit-tested off device.
 */

/**
 * One Powerwall backup (grid-outage) event from `GET /tesla/energy-sites/{siteId}/backup-history`
 * (web `useTeslaBackupHistory`). Only the fields the widget renders are projected — the [id], the raw
 * wire [timestamp] (parsed on demand for ordering, exactly as the web keeps the string), and the outage
 * [durationSeconds]. Reads are null-tolerant so a partial row never throws (web `?? 0` parity).
 */
data class BackupEvent(
    val id: Long,
    val timestamp: String?,
    val durationSeconds: Double?,
)

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * logic: a single column shows one "Outages" stat and at most three rows; wider footprints show the
 * "Outages" + "Avg Duration" pair and at most ten rows (web `maxEvents = isCompact ? 3 : 10`).
 */
data class BackupHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** Maximum feed rows rendered for this footprint (web `maxEvents`). */
    val maxEvents: Int get() = if (isCompact) COMPACT_MAX_EVENTS else STANDARD_MAX_EVENTS

    companion object {
        /** A footprint of one column or fewer is the compact layout. */
        const val COMPACT_MAX_COLS: Int = 1

        /** Maximum feed rows in the compact (single-column) footprint (web `maxEvents = 3`). */
        const val COMPACT_MAX_EVENTS: Int = 3

        /** Maximum feed rows in the standard / wide footprint (web `maxEvents = 10`). */
        const val STANDARD_MAX_EVENTS: Int = 10
    }
}

/**
 * The parsed two-source payload backing the widget: whether a Tesla Energy site is linked ([hasSites] +
 * its [siteId]) and the outage [events] for that site over the trailing window. The web composes
 * `useTeslaEnergySites` (for the first site id) with `useTeslaBackupHistory`; this snapshot is the native
 * analogue of both resolved. [hasData] distinguishes a fetched payload (even one with no site / no
 * events) from the absent-body fallback used before anything has loaded.
 */
data class BackupHistorySnapshot(
    val hasData: Boolean,
    val hasSites: Boolean,
    val siteId: Long?,
    val events: List<BackupEvent>,
) {
    /** True when at least one outage event is present. */
    val hasEvents: Boolean get() = events.isNotEmpty()

    companion object {
        /** The absent-body fallback (nothing loaded yet) — flagged [hasData] = false. */
        val EMPTY: BackupHistorySnapshot =
            BackupHistorySnapshot(hasData = false, hasSites = false, siteId = null, events = emptyList())

        /** A fetched payload that resolved no linked Tesla Energy site (web `hasSites === false`). */
        val NO_SITES: BackupHistorySnapshot =
            BackupHistorySnapshot(hasData = true, hasSites = false, siteId = null, events = emptyList())

        /** A linked-site snapshot whose backup-history body resolved to no events. */
        fun siteWithoutEvents(siteId: Long): BackupHistorySnapshot =
            BackupHistorySnapshot(hasData = true, hasSites = true, siteId = siteId, events = emptyList())

        /** A linked-site snapshot from the resolved [siteId] and its (tolerantly parsed) events body. */
        fun fromSiteAndEvents(
            siteId: Long,
            eventsJson: JsonElement?,
        ): BackupHistorySnapshot = BackupHistorySnapshot(hasData = true, hasSites = true, siteId = siteId, events = parseEvents(eventsJson))

        /**
         * The first site's `energy_site_id` from the energy-sites array (web
         * `(sites ?? [])[0]?.energy_site_id`), or `null` when the list is empty, the first element is not
         * an object, or its id is absent — matching the web's first-element read exactly.
         */
        fun parseFirstSiteId(element: JsonElement?): Long? =
            (element as? JsonArray)
                ?.firstOrNull { it is JsonObject }
                ?.let { (it as JsonObject).longValue("energy_site_id") }

        /** Project a backup-history JSON array into a tolerant list of [BackupEvent] (web `safeArray`). */
        fun parseEvents(element: JsonElement?): List<BackupEvent> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toBackupEvent() }
                ?: emptyList()

        private fun JsonObject.toBackupEvent(): BackupEvent =
            BackupEvent(
                id = longValue("id") ?: 0L,
                timestamp = stringValue("timestamp"),
                durationSeconds = doubleValue("duration_seconds"),
            )

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

        private fun JsonObject.doubleValue(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/** One projected, render-ready outage row consumed by the Compose feed. Pure data — no Compose types. */
data class BackupEventRow(
    val id: Long,
    val timeText: String,
    val durationText: String,
    val accessibilityLabel: String,
)

/**
 * The fully projected, render-ready view of the backup history for one footprint — the native analogue
 * of everything the web component computes via `useMemo` before returning JSX: whether a site is linked,
 * the formatted total-outage count and average duration (over ALL events, web `totalOutages` /
 * `avgDurationSec`), and the newest-first, footprint-capped feed [rows]. Pure data so it is unit-tested
 * directly; [hasEvents] is derived so the type stays small.
 */
data class BackupHistoryDisplay(
    val isCompact: Boolean,
    val hasSites: Boolean,
    val outagesValue: String,
    val avgDurationValue: String,
    val rows: List<BackupEventRow>,
) {
    /** True when at least one outage row is present. */
    val hasEvents: Boolean get() = rows.isNotEmpty()
}

/**
 * Pure projection from a parsed [BackupHistorySnapshot] to the display model — the native port of the
 * `totalOutages` / `avgDurationSec` / `sortedItems` `useMemo` work plus the compact/standard branch in
 * the web source. Durations are dimensionless seconds (no SI conversion). Every label is supplied by the
 * caller (resolved through the i18n facade), and `formatTime` is injected so date formatting is
 * deterministic in tests.
 */
object BackupHistoryProjection {
    private const val SECONDS_PER_MINUTE: Double = 60.0
    private const val MINUTES_PER_HOUR: Long = 60L
    private const val ZERO_DURATION: String = "0s"

    /**
     * Format a seconds duration exactly as the web `fmtDuration` helper does: below a minute,
     * `{round(s)}s`; otherwise whole hours/minutes — `{h}h {m}m`, `{h}h` (no leftover minutes) or `{m}m`
     * (under an hour). Non-finite / non-positive inputs floor to `0s`.
     */
    fun formatDuration(seconds: Double): String =
        if (!seconds.isFinite() || seconds <= 0.0) ZERO_DURATION else formatPositiveDuration(seconds)

    /** Mean outage duration over ALL events (web `avgDurationSec`), zero when empty. */
    fun averageDurationSeconds(events: List<BackupEvent>): Double =
        if (events.isEmpty()) 0.0 else events.sumOf { it.durationSeconds ?: 0.0 } / events.size

    /** Project [snapshot] for [size] using the supplied [durationLabel] and [formatTime] boundary. */
    fun project(
        snapshot: BackupHistorySnapshot,
        size: BackupHistorySize,
        durationLabel: String,
        formatTime: (String?) -> String,
    ): BackupHistoryDisplay {
        val events = snapshot.events
        val rows =
            events
                .sortedByDescending { epochMillisOrMin(it.timestamp) }
                .take(size.maxEvents)
                .map { event -> event.toRow(durationLabel, formatTime) }
        return BackupHistoryDisplay(
            isCompact = size.isCompact,
            hasSites = snapshot.hasSites,
            outagesValue = events.size.toString(),
            avgDurationValue = formatDuration(averageDurationSeconds(events)),
            rows = rows,
        )
    }

    private fun BackupEvent.toRow(
        durationLabel: String,
        formatTime: (String?) -> String,
    ): BackupEventRow {
        val timeText = formatTime(timestamp)
        val durationText = formatDuration(durationSeconds ?: 0.0)
        return BackupEventRow(
            id = id,
            timeText = timeText,
            durationText = durationText,
            accessibilityLabel = "$timeText, $durationLabel: $durationText",
        )
    }

    private fun formatPositiveDuration(seconds: Double): String {
        if (seconds < SECONDS_PER_MINUTE) return "${seconds.roundToLong()}s"
        val totalMinutes = floor(seconds / SECONDS_PER_MINUTE).toLong()
        val hours = totalMinutes / MINUTES_PER_HOUR
        val minutes = totalMinutes % MINUTES_PER_HOUR
        return when {
            hours > 0 && minutes > 0 -> "${hours}h ${minutes}m"
            hours > 0 -> "${hours}h"
            else -> "${minutes}m"
        }
    }

    /** Parsed event instant in epoch millis for newest-first ordering; unparseable/absent sorts last. */
    private fun epochMillisOrMin(raw: String?): Long =
        raw?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: Long.MIN_VALUE
}
