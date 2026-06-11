// File hosts the AlertFeed surface's pure model + projection; named after the surface, not a
// single declaration, so the matching-name heuristic is intentionally relaxed.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.alertfeed

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.normalizeSeverity
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.notifications.Alert
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val ALERT_FEED_EM_DASH: String = "\u2014"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`
 * and the `isWide` / `isTall` / `maxItems` logic in
 * `web/src/features/dashboard/widgets/AlertFeedWidget.tsx`.
 */
data class AlertFeedSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at three or more columns (web `isWide`): show the alert message as the row subtitle. */
    val isWide: Boolean get() = cols >= WIDE_COLS

    /** True at two or more rows (web `isTall`). */
    val isTall: Boolean get() = rows >= TALL_ROWS

    /** Maximum rows rendered: wide → 12, tall → 8, otherwise 5 (verbatim web parity). */
    val maxItems: Int get() =
        if (isWide) {
            WIDE_MAX_ITEMS
        } else if (isTall) {
            TALL_MAX_ITEMS
        } else {
            COMPACT_MAX_ITEMS
        }

    private companion object {
        const val WIDE_COLS = 3
        const val TALL_ROWS = 2
        const val WIDE_MAX_ITEMS = 12
        const val TALL_MAX_ITEMS = 8
        const val COMPACT_MAX_ITEMS = 5
    }
}

/**
 * Canonical registry metadata for the Alert Feed surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/alerts.ts`. A dashboard host binds this
 * surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint constraints.
 */
object AlertFeedRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "alert-feed"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "alerts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertFeedWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: AlertFeedSize = AlertFeedSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val MIN_SIZE: AlertFeedSize = AlertFeedSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: AlertFeedSize = AlertFeedSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: AlertFeedSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: AlertFeedSize): AlertFeedSize =
        AlertFeedSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * A drill-through navigation target for an alert — the Android port of
 * `web/src/lib/alertDrillthrough.ts`. Maps the alert's `rule_signal` onto its context page (or the
 * Signal Explorer fallback) and forwards the alert context (`vehicle_id`, `t`, `signal`) as
 * snake_case query parameters. The surface raises this to its host, which performs navigation.
 *
 * @property path destination route WITHOUT query string (e.g. `/battery`), matching the web routes.
 * @property query ordered `vehicle_id` / `t` / `signal` context parameters (only the present ones).
 * @property href the single relative href (`path?k=v&…`), mirroring `getAlertDrillthroughHref`.
 */
data class AlertDrillthrough(
    val path: String,
    val query: List<Pair<String, String>>,
    val href: String,
) {
    companion object {
        /** Generic fallback page when no signal-specific page is registered. */
        const val SIGNAL_EXPLORER_FALLBACK: String = "/signal-explorer"

        /**
         * Telemetry signal name → destination route — a 1:1 port of `SIGNAL_TO_PAGE` in
         * `web/src/lib/alertDrillthrough.ts`. Keys mirror the `signal_name` column on `alert_rules`
         * (Tesla Fleet Telemetry PascalCase signal names).
         */
        val SIGNAL_TO_PAGE: Map<String, String> =
            mapOf(
                // Battery
                "BatteryLevel" to "/battery",
                "RatedRange" to "/battery",
                "ChargeLimitSoc" to "/battery",
                "EstBatteryRange" to "/battery",
                "IdealBatteryRange" to "/battery",
                // Charging
                "ChargeState" to "/charging",
                "DetailedChargeState" to "/charging",
                "DCChargingPower" to "/charging",
                "ACChargingPower" to "/charging",
                "ChargeAmps" to "/charging",
                "ChargerVoltage" to "/charging",
                "ChargerActualCurrent" to "/charging",
                "ChargingCableType" to "/charging",
                // Driving
                "Gear" to "/drives",
                "VehicleSpeed" to "/drives",
                "Power" to "/drives",
                "Odometer" to "/drives",
                // Climate
                "InsideTemp" to "/climate-control",
                "OutsideTemp" to "/climate-control",
                "HvacPower" to "/climate-control",
                "ClimateKeeperMode" to "/climate-control",
                // Tire pressure
                "TpmsPressureFl" to "/tire-pressure",
                "TpmsPressureFr" to "/tire-pressure",
                "TpmsPressureRl" to "/tire-pressure",
                "TpmsPressureRr" to "/tire-pressure",
                "TpmsHardWarnings" to "/tire-pressure",
                "TpmsSoftWarnings" to "/tire-pressure",
                "TpmsLastSeenPressureTimeFl" to "/tire-pressure",
                "TpmsLastSeenPressureTimeFr" to "/tire-pressure",
                "TpmsLastSeenPressureTimeRl" to "/tire-pressure",
                "TpmsLastSeenPressureTimeRr" to "/tire-pressure",
                // Security / access
                "Locked" to "/security-access",
                "SentryMode" to "/security-access",
                "DoorState" to "/security-access",
                "WindowState" to "/security-access",
                "SunroofInstalled" to "/security-access",
                // Software
                "SoftwareUpdateVersion" to "/software-updates",
                "SoftwareUpdateDownloadPercentComplete" to "/software-updates",
                "SoftwareUpdateInstallationPercentComplete" to "/software-updates",
                "SoftwareUpdateExpectedDurationMinutes" to "/software-updates",
                // Location / navigation
                "LocatedAtHome" to "/navigation",
                "LocatedAtWork" to "/navigation",
                "LocatedAtFavorite" to "/navigation",
                "DestinationName" to "/navigation",
                "DestinationLocation" to "/navigation",
            )

        /** Compute the drill-through target for [alert] (mirrors web `getAlertDrillthrough`). */
        fun forAlert(alert: Alert): AlertDrillthrough {
            val signal = alert.ruleSignal?.takeIf { it.isNotEmpty() }
            val query =
                buildList {
                    if (alert.vehicleId > 0) add("vehicle_id" to alert.vehicleId.toString())
                    if (alert.createdAt.isNotEmpty()) add("t" to alert.createdAt)
                    if (signal != null) add("signal" to signal)
                }
            val path = signal?.let { SIGNAL_TO_PAGE[it] } ?: SIGNAL_EXPLORER_FALLBACK
            return AlertDrillthrough(path = path, query = query, href = hrefOf(path, query))
        }

        private fun hrefOf(
            path: String,
            query: List<Pair<String, String>>,
        ): String =
            if (query.isEmpty()) {
                path
            } else {
                path + "?" + query.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }
            }

        private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
    }
}

/** The subtitle a row shows under its title — the web `subtitle: isWide ? a.message : LABEL` branch. */
sealed interface AlertRowSubtitle {
    /** No subtitle (wide layout with a blank message). */
    data object None : AlertRowSubtitle

    /** The alert message text (wide layout). */
    data class Message(
        val text: String,
    ) : AlertRowSubtitle

    /** The localized severity label (compact layout); the render layer resolves the i18n string. */
    data object SeverityLabel : AlertRowSubtitle
}

/**
 * One projected, display-ready alert row consumed by the Compose view. Pure data (no Compose types):
 * the resolved [severity], the localized-on-render [title]/[subtitle], the raw [timestampMillis] for
 * the relative-time label, and the [drillthrough] target.
 */
data class AlertFeedRow(
    val id: Long,
    val severity: Severity,
    val title: String,
    val subtitle: AlertRowSubtitle,
    val timestampMillis: Long?,
    val drillthrough: AlertDrillthrough,
)

/**
 * Pure projection from raw alerts to display rows — the Android port of the `useMemo` mapping in
 * `web/src/features/dashboard/widgets/AlertFeedWidget.tsx` plus `WidgetEventFeed`'s newest-first
 * sort and `maxItems` slice. Side-effect-free so the gate unit-tests it without a device.
 */
object AlertFeedProjection {
    /** Project + sort (newest first) + cap [alerts] to [size]'s row budget. */
    fun project(
        alerts: List<Alert>,
        size: AlertFeedSize,
    ): List<AlertFeedRow> =
        alerts
            .sortedByDescending { parseTimestampMillis(it.createdAt) ?: Long.MIN_VALUE }
            .take(size.maxItems)
            .map { alert -> rowOf(alert, size) }

    private fun rowOf(
        alert: Alert,
        size: AlertFeedSize,
    ): AlertFeedRow {
        val severity = normalizeSeverity(alert.severity)
        return AlertFeedRow(
            id = alert.id,
            severity = severity,
            title = alert.title.ifBlank { ALERT_FEED_EM_DASH },
            subtitle = subtitleOf(alert, size),
            timestampMillis = parseTimestampMillis(alert.createdAt),
            drillthrough = AlertDrillthrough.forAlert(alert),
        )
    }

    private fun subtitleOf(
        alert: Alert,
        size: AlertFeedSize,
    ): AlertRowSubtitle =
        if (size.isWide) {
            if (alert.message.isBlank()) AlertRowSubtitle.None else AlertRowSubtitle.Message(alert.message)
        } else {
            AlertRowSubtitle.SeverityLabel
        }

    /** Parse a `created_at` wire string to epoch millis (tolerant of `Z`, an offset, or no zone). */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }
}

/**
 * Maps a row's [timestampMillis] onto a localized relative-time label, reusing the shared, tested
 * [relativeAge] bucketing (whose <1m / <1h / <24h cutoffs match the web `WidgetEventFeed`
 * `formatRelativeTime`). The i18n words are injected so this stays pure + unit-testable; the
 * composable passes the resolved `just now` / `ago` strings.
 */
fun alertRelativeTimeLabel(
    timestampMillis: Long?,
    nowMillis: Long,
    justNow: String,
    ago: String,
): String =
    when (val age = relativeAge(computeAgeSeconds(timestampMillis, nowMillis))) {
        FreshnessAge.Unknown -> ALERT_FEED_EM_DASH
        FreshnessAge.JustNow -> justNow
        is FreshnessAge.Seconds -> justNow
        is FreshnessAge.Minutes -> "${age.value}m $ago"
        is FreshnessAge.Hours -> "${age.value}h $ago"
        is FreshnessAge.Days -> "${age.value}d $ago"
        is FreshnessAge.Weeks -> "${age.value}w $ago"
    }

/**
 * The Narrator/TalkBack description for an alert row — the Android port of the Windows
 * `AutomationName` (`"{severity}: {title}, {relativeTime}"`). Pure so label presence is unit-tested.
 */
fun alertRowContentDescription(
    severityLabel: String,
    title: String,
    relativeTime: String,
): String = "$severityLabel: $title, $relativeTime"
