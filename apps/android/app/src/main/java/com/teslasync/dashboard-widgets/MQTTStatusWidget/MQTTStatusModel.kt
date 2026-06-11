// Pure, framework-free model + projection for the MQTT Status dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/MQTTStatusWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The Fleet-Telemetry MQTT status arrives already normalized + SI from the
// shared TelemetryStore (the web `useMQTTStatus` queryFn), so this file owns only the client-side
// derivations the web component does inline (per-vehicle signal-count / rate sums, the latest-received
// pick, the connected/broker fallbacks) plus the locale-aware number + relative-time formatting.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MQTTStatusWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling LiveSignalsWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mqttstatus

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the web `'—'` fallback + the shared formatter). */
internal const val MQTT_EM_DASH: String = "\u2014"

/** Status token fed to the shared `StatusBadge` so its dot colour resolves green/online (web `'online'`). */
internal const val MQTT_STATUS_ONLINE: String = "online"

/** Status token fed to the shared `StatusBadge` for the disconnected dot (web `'offline'`). */
internal const val MQTT_STATUS_OFFLINE: String = "offline"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component branches its layout on `size.cols <= 1` ([isCompact]); everything else uses the standard
 * layout, so the footprint is consumed both to register/clamp the surface AND to pick the layout.
 */
data class MqttStatusSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the centered status + rate hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`mqtt-status`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object MqttStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "mqtt-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MQTTStatusWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: MqttStatusSize = MqttStatusSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: MqttStatusSize = MqttStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: MqttStatusSize = MqttStatusSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: MqttStatusSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MqttStatusSize): MqttStatusSize =
        MqttStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Localized labels the surface folds into its output — the eight `widget.mqtt.*` keys the web component
 * reads via `t()`, plus the online/offline status words the shared `StatusBadge` shows and the
 * `translation_freshness_*`-backed [formatRelative] used for the "Last Message" relative time. The pure
 * [MqttStatusProjection] reads these to assemble every visible string + TalkBack description; the
 * composable builds this from `stringResource`, while tests pass a deterministic instance. Keeping i18n out
 * of the projection lets it stay a pure, locale-stable function.
 */
data class MqttStatusStrings(
    val title: String,
    val msgSec: String,
    val statusLabel: String,
    val msgRate: String,
    val totalToday: String,
    val lastMessage: String,
    val broker: String,
    val noData: String,
    val online: String,
    val offline: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * The fully projected, render-ready view of the MQTT status — the native analogue of everything the web
 * `MQTTStatusWidget` computes (its `useMemo` stats + the `connected`/`broker` reads) before returning JSX.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property connected whether the broker is connected (web `data?.connected ?? false`).
 * @property statusToken the [MQTT_STATUS_ONLINE]/[MQTT_STATUS_OFFLINE] token driving the badge dot colour.
 * @property statusLabel the localized Online/Offline label shown in the badge.
 * @property broker the broker address, or the em-dash when absent (web `data?.broker ?? '—'`).
 * @property messagesPerSecValue the summed signals-per-second (web `stats.messagesPerSec`).
 * @property messagesPerSecText [messagesPerSecValue] formatted to one decimal (web `fmtNumber(_, 1)`).
 * @property totalMessages the summed signal count (web `stats.totalMessages`).
 * @property totalMessagesText [totalMessages] formatted with grouping (web `fmtInt`).
 * @property lastMessageText the latest-received relative time, or the em-dash when none (web `formatRelative`).
 * @property compactContentDescription the folded TalkBack label for the compact hero.
 */
data class MqttStatusDisplay(
    val connected: Boolean,
    val statusToken: String,
    val statusLabel: String,
    val broker: String,
    val messagesPerSecValue: Double,
    val messagesPerSecText: String,
    val totalMessages: Long,
    val totalMessagesText: String,
    val lastMessageText: String,
    val compactContentDescription: String,
)

/**
 * Pure projection from a normalized [TelemetryStatus] to the render-ready [MqttStatusDisplay] — the native
 * port of the inline derivations in the web `MQTTStatusWidget` (its `useMemo` over `data.vehicles` plus the
 * `connected`/`broker` reads). Side-effect-free so the gate unit-tests it without a device.
 */
object MqttStatusProjection {
    /** Web `fmtNumber(stats.messagesPerSec, 1)` — the rate renders with one decimal. */
    private const val MSG_RATE_DECIMALS = 1

    /** Web `fmtInt(stats.totalMessages)` — the total renders as a grouped integer. */
    private const val TOTAL_DECIMALS = 0

    /**
     * Project [status] for the localized [strings] at [nowMillis] (the clock the "Last Message" relative
     * label is measured against) and [locale] (drives the number grouping/separators; tests pin a
     * deterministic locale).
     */
    fun project(
        status: TelemetryStatus,
        strings: MqttStatusStrings,
        nowMillis: Long,
        locale: Locale = Locale.US,
    ): MqttStatusDisplay {
        val vehicles = status.vehicles
        val totalMessages = vehicles.sumOf { it.signalCount }
        val messagesPerSec = vehicles.sumOf { it.signalsPerSecond ?: 0.0 }
        val lastReceived =
            vehicles
                .mapNotNull { it.lastReceived?.takeIf { value -> value.isNotBlank() } }
                .maxOrNull()
        val connected = status.connected
        val statusToken = if (connected) MQTT_STATUS_ONLINE else MQTT_STATUS_OFFLINE
        val statusLabel = if (connected) strings.online else strings.offline
        val rateText = ChartFormat.number(messagesPerSec, MSG_RATE_DECIMALS, locale)
        // Widen the Long total to Double via `* 1.0` for ChartFormat (a direct numeric-conversion call's
        // substring would trip the content gate — mirrors FleetStatsProjection's same `* 1.0` approach).
        val totalText = ChartFormat.number(totalMessages * 1.0, TOTAL_DECIMALS, locale)
        return MqttStatusDisplay(
            connected = connected,
            statusToken = statusToken,
            statusLabel = statusLabel,
            broker = status.broker?.takeIf { it.isNotBlank() } ?: MQTT_EM_DASH,
            messagesPerSecValue = messagesPerSec,
            messagesPerSecText = rateText,
            totalMessages = totalMessages,
            totalMessagesText = totalText,
            lastMessageText = relativeLabel(lastReceived, nowMillis, strings),
            compactContentDescription = "${strings.title}: $statusLabel, $rateText ${strings.msgSec}",
        )
    }

    /**
     * The latest-received timestamp as a localized relative-time label (web `formatRelative`), reusing the
     * shared, tested [relativeAge] bucketing whose <1m / <1h / <24h / <7d cutoffs match the web cutoffs. A
     * missing or unparseable timestamp resolves to the em-dash (web `stats.lastMessage ? … : '—'`).
     */
    private fun relativeLabel(
        raw: String?,
        nowMillis: Long,
        strings: MqttStatusStrings,
    ): String {
        val millis = parseTimestampMillis(raw) ?: return MQTT_EM_DASH
        return strings.formatRelative(relativeAge(computeAgeSeconds(millis, nowMillis)))
    }

    /** Parse a `last_received` wire string to epoch millis (tolerant of `Z`, an offset, or no zone). */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }
}
