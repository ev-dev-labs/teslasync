// Pure, framework-free model + projection for the TelemetryPipelineCard feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/system/components/status/TelemetryPipelineCard.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web card has TWO ingest paths and derives per-vehicle liveness from the UNION of the freshest
// of {last MQTT stream message, last REST poll}, applying the age ladder
//   < 5 min  -> sending (green)
//   5-30 min -> slow (amber)
//   > 30 min -> stale (red)
//   no signal-> offline (grey)
// plus a compact fleet rollup grid and the MQTT-broker / polling-engine connectivity chips. All of
// that logic lives here as pure functions so the KMP/web/native ports can never drift.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TelemetryPipelineCard — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path — exactly as the sibling
// BackendStatusSection / TelemetryErrorsPanel surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrypipelinecard

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN/payload. */
const val TELEMETRY_PIPELINE_CARD_SLUG: String = "TelemetryPipelineCard"

/** The em-dash shown wherever a value is unknown (matches the web `'—'` fallback). */
internal const val EM_DASH: String = "\u2014"

/** The masked VIN tail shown when a VIN is missing (web `'????'`). */
internal const val VIN_TAIL_UNKNOWN: String = "????"

/** Number of VIN characters shown in the masked tail (web `vin.slice(-4)`). */
internal const val VIN_TAIL_LENGTH: Int = 4

private const val MILLIS_PER_SECOND: Double = 1_000.0
private const val SECONDS_PER_MINUTE: Double = 60.0
private const val MINUTES_PER_HOUR: Double = 60.0
private const val HOURS_PER_DAY: Double = 24.0
private const val MILLIS_PER_MINUTE: Double = 60_000.0

/** Age (minutes) below which a vehicle is "sending" (web `< 5`). */
private const val SENDING_MAX_MINUTES: Double = 5.0

/** Age (minutes) below which a vehicle is "slow" (web `< 30`); at/above is "stale". */
private const val SLOW_MAX_MINUTES: Double = 30.0

private const val RELATIVE_SECOND_CUTOFF: Long = 60
private const val RELATIVE_MINUTE_CUTOFF: Long = 60
private const val RELATIVE_HOUR_CUTOFF: Long = 24

/** Battery percentage at/above which the bar is "good" (web `>= 50`). */
private const val BATTERY_GOOD_MIN: Int = 50

/** Battery percentage at/above which the bar is "warn" (web `>= 20`); below is "critical". */
private const val BATTERY_WARN_MIN: Int = 20

private const val BATTERY_PCT_MIN: Int = 0
private const val BATTERY_PCT_MAX: Int = 100

// ─── Wire models (ported from web `@/api/polling`) ───────────────────────────────────────────────

/**
 * `GET /polling/status` — the port of the web `PollEngineStatus`. [enabled] mirrors the web
 * `pollingStatus?.enabled !== false` default (a missing flag reads as enabled); [vehicles] is the
 * per-VIN polling map. The card reads only the liveness-relevant fields off each entry; the richer
 * `last_decision` envelope is ignored by the decoder (the client's JSON is `ignoreUnknownKeys`).
 */
@Serializable
data class PollEngineStatus(
    val enabled: Boolean = true,
    val vehicles: Map<String, VehiclePollingStatus> = emptyMap(),
)

/**
 * One vehicle's REST-polling status — the port of the web `VehiclePollingStatus`. Only the fields
 * the card renders are modelled: [lastPollTime] (liveness union), [nextPollAfter] (next scheduled
 * poll label), and [batteryLevel] (battery bar). A present entry always carries a battery reading
 * (defaulting to `0`), exactly as the web reads `ps?.battery_level ?? null` for a present `ps`.
 */
@Serializable
data class VehiclePollingStatus(
    @SerialName("last_poll_time") val lastPollTime: String = "",
    @SerialName("next_poll_after") val nextPollAfter: String = "",
    @SerialName("battery_level") val batteryLevel: Double = 0.0,
)

/**
 * The combined fetched feeds the view-model produces from the two cache-then-network streams: the
 * normalized MQTT [TelemetryStatus] (web `useMQTTStatus`) and the [PollEngineStatus] (web
 * `getPollingStatus`). Either may be `null` before its feed resolves; the projection folds both in
 * defensively (a missing feed simply degrades vehicles to the other path / offline).
 */
data class TelemetryPipelineFeeds(
    val mqtt: TelemetryStatus?,
    val polling: PollEngineStatus?,
)

// ─── Host inputs (the web props supplied by the parent page) ─────────────────────────────────────

/**
 * The lightweight per-vehicle identity the card lists — the native analogue of the web `Vehicle`
 * fields the component reads (`id`, `vin`, `display_name`, `state`). Supplied by the host page (the
 * web receives `vehicles` as a prop), so the surface stays decoupled from the full vehicle model.
 */
data class TelemetryPipelineVehicle(
    val id: Long,
    val vin: String,
    val displayName: String?,
    val state: String?,
)

/**
 * The fleet rollup counts the card grid shows — the native analogue of the web `positionCount` /
 * `drivesCount` / `chargingSessionsCount` / `signalLogCount` props. The latter two are nullable
 * (web `number | undefined`) and render as the em-dash when absent.
 */
data class FleetCounts(
    val positionCount: Long,
    val drivesCount: Long,
    val chargingSessionsCount: Long?,
    val signalLogCount: Long?,
)

// ─── Liveness logic (ported from the web `liveness()` derivation) ────────────────────────────────

/** Per-vehicle liveness severity bucket (web `Liveness`). */
enum class Liveness { Sending, Slow, Stale, Offline }

/** Which ingest path produced the freshest timestamp (web `LivenessSource`). */
enum class LivenessSource { Stream, Poll, None }

/** Battery-bar tone bucket (web `batteryColor`): good / warn / critical. */
enum class BatteryTone { Good, Warn, Critical }

/** Coarse relative-time unit; the render layer maps each to a localized template. */
enum class RelativeUnit { Seconds, Minutes, Hours, Days }

/** A bucketed relative time — [past] distinguishes "ago" from "in", with the [value] in [unit]. */
data class RelativeTime(
    val past: Boolean,
    val unit: RelativeUnit,
    val value: Long,
)

/** The outcome of [liveness]: the severity [level], its [source], and the chosen last-seen ISO. */
data class LivenessResult(
    val level: Liveness,
    val source: LivenessSource,
    val lastSeenIso: String?,
)

private data class FreshestSeen(
    val millis: Long,
    val source: LivenessSource,
    val iso: String?,
)

/**
 * Parse an ISO timestamp to epoch millis, tolerating `Z`, an explicit offset, or a zone-less local
 * time; blank/`null`/malformed input yields `null` (web `parseIso` returning `undefined`).
 */
fun parseIso(iso: String?): Long? {
    val value = iso?.trim().orEmpty()
    if (value.isEmpty()) return null
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
}

/**
 * Derive per-vehicle liveness from the UNION of both ingest paths (web `liveness`). Picks the
 * freshest of the poll/stream timestamps, then applies the < 5 min / < 30 min age ladder; with no
 * timestamp at all the vehicle is offline with no source.
 */
fun liveness(
    lastPollIso: String?,
    lastStreamIso: String?,
    nowMillis: Long,
): LivenessResult {
    val freshest =
        pickFreshest(parseIso(lastPollIso), parseIso(lastStreamIso), lastPollIso, lastStreamIso)
            ?: return LivenessResult(Liveness.Offline, LivenessSource.None, null)
    val ageMinutes = (nowMillis - freshest.millis) / MILLIS_PER_MINUTE
    val level =
        when {
            ageMinutes < SENDING_MAX_MINUTES -> Liveness.Sending
            ageMinutes < SLOW_MAX_MINUTES -> Liveness.Slow
            else -> Liveness.Stale
        }
    return LivenessResult(level, freshest.source, freshest.iso)
}

private fun pickFreshest(
    pollMs: Long?,
    streamMs: Long?,
    pollIso: String?,
    streamIso: String?,
): FreshestSeen? =
    when {
        pollMs != null && streamMs != null ->
            if (streamMs >= pollMs) {
                FreshestSeen(streamMs, LivenessSource.Stream, streamIso)
            } else {
                FreshestSeen(pollMs, LivenessSource.Poll, pollIso)
            }
        streamMs != null -> FreshestSeen(streamMs, LivenessSource.Stream, streamIso)
        pollMs != null -> FreshestSeen(pollMs, LivenessSource.Poll, pollIso)
        else -> null
    }

/**
 * Bucket an absolute/clock-skew-tolerant relative time (web `relativeTime`): `null` for an
 * absent/unparseable timestamp, else the largest whole unit under the s/min/h/d ladder, tagged
 * past-or-future so the render layer can pick "ago" vs "in".
 */
fun relativeTimeOf(
    iso: String?,
    nowMillis: Long,
): RelativeTime? {
    val target = parseIso(iso) ?: return null
    val diffMs = nowMillis - target
    val past = diffMs >= 0
    val absMs = abs(diffMs)
    val seconds = (absMs / MILLIS_PER_SECOND).roundToLong()
    val minutes = (seconds / SECONDS_PER_MINUTE).roundToLong()
    val hours = (minutes / MINUTES_PER_HOUR).roundToLong()
    val days = (hours / HOURS_PER_DAY).roundToLong()
    return when {
        seconds < RELATIVE_SECOND_CUTOFF -> RelativeTime(past, RelativeUnit.Seconds, seconds)
        minutes < RELATIVE_MINUTE_CUTOFF -> RelativeTime(past, RelativeUnit.Minutes, minutes)
        hours < RELATIVE_HOUR_CUTOFF -> RelativeTime(past, RelativeUnit.Hours, hours)
        else -> RelativeTime(past, RelativeUnit.Days, days)
    }
}

/** The masked VIN tail shown next to each vehicle (web `vinTail`): last 4 chars, else `'????'`. */
fun vinTail(vin: String?): String {
    val trimmed = vin?.trim().orEmpty()
    return when {
        trimmed.isEmpty() -> VIN_TAIL_UNKNOWN
        trimmed.length <= VIN_TAIL_LENGTH -> trimmed
        else -> trimmed.takeLast(VIN_TAIL_LENGTH)
    }
}

/**
 * Normalize a raw vehicle state to its display token (web `vehicleStateBadge`): the canonical
 * online/driving/charging/asleep/offline words pass through, sleeping collapses to asleep, an empty
 * state becomes the localized [unknownLabel], and anything else renders verbatim (lower-cased).
 */
fun vehicleStateBadge(
    state: String?,
    unknownLabel: String,
): String {
    val normalized = state?.trim()?.lowercase().orEmpty()
    return when {
        normalized.isEmpty() -> unknownLabel
        normalized == "online" || normalized == "driving" || normalized == "charging" -> normalized
        normalized == "asleep" || normalized == "sleeping" -> "asleep"
        normalized == "offline" -> "offline"
        else -> normalized
    }
}

/** Battery-bar tone bucket (web `batteryColor`): >= 50 good, >= 20 warn, else critical. */
fun batteryTone(percent: Int): BatteryTone =
    when {
        percent >= BATTERY_GOOD_MIN -> BatteryTone.Good
        percent >= BATTERY_WARN_MIN -> BatteryTone.Warn
        else -> BatteryTone.Critical
    }

/** Bar fill fraction in `[0,1]` for a battery [percent] (web clamps width to 0..100%). */
fun batteryFraction(percent: Int): Float = percent.coerceIn(BATTERY_PCT_MIN, BATTERY_PCT_MAX) / BATTERY_PCT_MAX.toFloat()

/** Format a fleet count: `null` (web non-finite) renders as the em-dash, else a grouped integer. */
fun fmtCount(
    count: Long?,
    locale: Locale,
): String = if (count == null) EM_DASH else ChartFormat.number(count * 1.0, 0, locale)

// ─── Localized strings (resolved at the Compose boundary; passed into the pure projection) ───────

/**
 * The already-localized strings + formatter lambda the projection folds into its render-ready
 * output. The web card is anonymous (it renders literals, not `t()` keys), so these arrive through
 * the P1/S10 i18n facade at the Compose boundary as key-as-default reproductions and are passed in,
 * keeping the projection a pure, locale-stable function. [formatRelativeTime] maps a bucketed
 * [RelativeTime] to its localized "N… ago" / "in N…" phrase.
 */
data class TelemetryPipelineStrings(
    val vehiclesLabel: String,
    val gpsPositionsLabel: String,
    val drivesLabel: String,
    val chargingSessionsLabel: String,
    val signalLogLabel: String,
    val vehiclesConnectedTemplate: String,
    val noneConfigured: String,
    val livenessTitle: String,
    val sending: String,
    val slow: String,
    val stale: String,
    val offline: String,
    val fleetTelemetryConnected: String,
    val mqttBrokerDisconnected: String,
    val pollingEngineOff: String,
    val pollingEngineDisabled: String,
    val noVehiclesMessage: String,
    val teslaAccountAction: String,
    val vinPrefix: String,
    val unknownState: String,
    val streamLabel: String,
    val pollLabel: String,
    val lastPrefix: String,
    val nextPrefix: String,
    val statusA11yPrefix: String,
    val batteryA11yPrefix: String,
    val vehicleFallbackNameTemplate: String,
    val openTelemetryCoverage: String,
    val mqttInspector: String,
    val allVehicles: String,
    val formatRelativeTime: (RelativeTime) -> String,
) {
    /** The localized label for a [Liveness] bucket (web `livenessClasses(l).label`). */
    fun livenessLabel(level: Liveness): String =
        when (level) {
            Liveness.Sending -> sending
            Liveness.Slow -> slow
            Liveness.Stale -> stale
            Liveness.Offline -> offline
        }
}

// ─── Render-ready projection output ──────────────────────────────────────────────────────────────

/** The compact fleet rollup grid (web's 5-column stats row), each value already formatted. */
data class RollupGrid(
    val vehiclesValue: String,
    val positionsValue: String,
    val drivesValue: String,
    val chargingValue: String,
    val signalLogValue: String,
)

/** One liveness summary chip (web `{count} {label}`), e.g. "3 sending". */
data class LivenessChip(
    val level: Liveness,
    val count: Int,
    val label: String,
)

/** The MQTT-broker connectivity chip (web "Fleet Telemetry connected" / "MQTT broker disconnected"). */
data class ConnectivityChip(
    val connected: Boolean,
    val label: String,
)

/** Which polling-engine chip to show when the engine is disabled. */
enum class PollingChipKind { OffStreamingOnly, Disabled }

/** The informational polling-engine chip (web's "off (streaming-only)" / "disabled" states). */
data class PollingChip(
    val kind: PollingChipKind,
    val label: String,
)

/** One rendered per-vehicle row — every visible string + a11y description precomputed. */
data class VehicleRow(
    val id: Long,
    val name: String,
    val vinLabel: String,
    val stateLabel: String,
    val level: Liveness,
    val livenessLabel: String,
    val source: LivenessSource,
    val sourceLabel: String?,
    val batteryPercent: Int?,
    val batteryText: String,
    val batteryFraction: Float,
    val batteryTone: BatteryTone?,
    val lastRelative: String,
    val nextRelative: String?,
    val statusContentDescription: String,
    val batteryContentDescription: String?,
)

/**
 * The fully projected, render-ready view of the card — the native analogue of everything the web
 * `TelemetryPipelineCard` computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. The liveness summary block (chips + MQTT/polling
 * chips) is shown only when [showLivenessSummary] (web `list.length > 0`).
 */
data class TelemetryPipelineDisplay(
    val rollup: RollupGrid,
    val showLivenessSummary: Boolean,
    val livenessChips: List<LivenessChip>,
    val mqttChip: ConnectivityChip,
    val pollingChip: PollingChip?,
    val hasVehicles: Boolean,
    val vehicles: List<VehicleRow>,
)

/**
 * The render config the projection threads through: the [nowMillis] clock the relative-time labels are
 * measured against, the localized [strings], and the [locale] that drives number grouping. Bundled so the
 * pure projection entry points stay within the parameter budget.
 */
data class TelemetryPipelineContext(
    val nowMillis: Long,
    val strings: TelemetryPipelineStrings,
    val locale: Locale,
)

/**
 * Pure projection from the fetched [TelemetryPipelineFeeds] + host inputs to the render-ready
 * [TelemetryPipelineDisplay] — a 1:1 port of the inline derivations in the web component (the
 * polling/stream join, the per-vehicle liveness union, the fleet rollup, and the connectivity
 * chips). Side-effect-free so the gate unit-tests it without a device. The [TelemetryPipelineContext]
 * carries the clock, the localized strings, and the locale.
 */
object TelemetryPipelineProjection {
    private val LIVENESS_ORDER = listOf(Liveness.Sending, Liveness.Slow, Liveness.Stale, Liveness.Offline)

    fun project(
        feeds: TelemetryPipelineFeeds,
        vehicles: List<TelemetryPipelineVehicle>,
        counts: FleetCounts,
        context: TelemetryPipelineContext,
    ): TelemetryPipelineDisplay {
        val strings = context.strings
        val pollingMap = feeds.polling?.vehicles ?: emptyMap()
        val pollingEnabled = feeds.polling?.enabled != false
        val streamMap = buildStreamMap(feeds.mqtt)
        val mqttConnected = feeds.mqtt?.connected == true

        val tally = tallyLiveness(vehicles, pollingMap, streamMap, context.nowMillis)
        val livenessChips =
            LIVENESS_ORDER
                .filter { (tally[it] ?: 0) > 0 }
                .map { level ->
                    val count = tally[level] ?: 0
                    LivenessChip(level, count, "$count ${strings.livenessLabel(level)}")
                }

        return TelemetryPipelineDisplay(
            rollup = buildRollup(vehicles.size, counts, context),
            showLivenessSummary = vehicles.isNotEmpty(),
            livenessChips = livenessChips,
            mqttChip = ConnectivityChip(mqttConnected, mqttChipLabel(mqttConnected, strings)),
            pollingChip = pollingChip(pollingEnabled, mqttConnected, strings),
            hasVehicles = vehicles.isNotEmpty(),
            vehicles = vehicles.map { buildRow(it, pollingMap[it.vin], streamMap[it.vin], context) },
        )
    }

    private fun buildRollup(
        vehicleCount: Int,
        counts: FleetCounts,
        context: TelemetryPipelineContext,
    ): RollupGrid {
        val strings = context.strings
        val locale = context.locale
        return RollupGrid(
            vehiclesValue =
                if (vehicleCount > 0) {
                    String.format(locale, strings.vehiclesConnectedTemplate, vehicleCount)
                } else {
                    strings.noneConfigured
                },
            positionsValue = fmtCount(counts.positionCount, locale),
            drivesValue = fmtCount(counts.drivesCount, locale),
            chargingValue = fmtCount(counts.chargingSessionsCount, locale),
            signalLogValue = fmtCount(counts.signalLogCount, locale),
        )
    }

    private fun buildRow(
        vehicle: TelemetryPipelineVehicle,
        polling: VehiclePollingStatus?,
        streamLastReceived: String?,
        context: TelemetryPipelineContext,
    ): VehicleRow {
        val nowMillis = context.nowMillis
        val strings = context.strings
        val result = liveness(polling?.lastPollTime, streamLastReceived, nowMillis)
        val livenessLabel = strings.livenessLabel(result.level)
        val batteryPercent = polling?.batteryLevel?.roundToInt()
        val name =
            vehicle.displayName?.takeIf { it.isNotBlank() }
                ?: String.format(context.locale, strings.vehicleFallbackNameTemplate, vehicle.id)
        return VehicleRow(
            id = vehicle.id,
            name = name,
            vinLabel = strings.vinPrefix + vinTail(vehicle.vin),
            stateLabel = vehicleStateBadge(vehicle.state, strings.unknownState),
            level = result.level,
            livenessLabel = livenessLabel,
            source = result.source,
            sourceLabel = sourceLabel(result.source, strings),
            batteryPercent = batteryPercent,
            batteryText = batteryPercent?.let { "$it%" } ?: EM_DASH,
            batteryFraction = batteryPercent?.let { batteryFraction(it) } ?: 0f,
            batteryTone = batteryPercent?.let { batteryTone(it) },
            lastRelative = relativeLabel(result.lastSeenIso, nowMillis, strings),
            nextRelative =
                polling?.nextPollAfter?.takeIf { it.isNotBlank() }?.let { relativeLabel(it, nowMillis, strings) },
            statusContentDescription = "${strings.statusA11yPrefix} $livenessLabel",
            batteryContentDescription = batteryPercent?.let { "${strings.batteryA11yPrefix} $it%" },
        )
    }

    private fun relativeLabel(
        iso: String?,
        nowMillis: Long,
        strings: TelemetryPipelineStrings,
    ): String = relativeTimeOf(iso, nowMillis)?.let { strings.formatRelativeTime(it) } ?: EM_DASH

    private fun sourceLabel(
        source: LivenessSource,
        strings: TelemetryPipelineStrings,
    ): String? =
        when (source) {
            LivenessSource.Stream -> strings.streamLabel
            LivenessSource.Poll -> strings.pollLabel
            LivenessSource.None -> null
        }

    private fun mqttChipLabel(
        connected: Boolean,
        strings: TelemetryPipelineStrings,
    ): String = if (connected) strings.fleetTelemetryConnected else strings.mqttBrokerDisconnected

    private fun pollingChip(
        pollingEnabled: Boolean,
        mqttConnected: Boolean,
        strings: TelemetryPipelineStrings,
    ): PollingChip? =
        when {
            pollingEnabled -> null
            mqttConnected -> PollingChip(PollingChipKind.OffStreamingOnly, strings.pollingEngineOff)
            else -> PollingChip(PollingChipKind.Disabled, strings.pollingEngineDisabled)
        }

    private fun buildStreamMap(mqtt: TelemetryStatus?): Map<String, String?> =
        mqtt
            ?.vehicles
            ?.filter { it.vin.isNotBlank() }
            ?.associate { it.vin to it.lastReceived }
            ?: emptyMap()

    private fun tallyLiveness(
        vehicles: List<TelemetryPipelineVehicle>,
        pollingMap: Map<String, VehiclePollingStatus>,
        streamMap: Map<String, String?>,
        nowMillis: Long,
    ): Map<Liveness, Int> {
        val tally = LIVENESS_ORDER.associateWith { 0 }.toMutableMap()
        vehicles.forEach { vehicle ->
            val level = liveness(pollingMap[vehicle.vin]?.lastPollTime, streamMap[vehicle.vin], nowMillis).level
            tally[level] = (tally[level] ?: 0) + 1
        }
        return tally
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TELEMETRY_PIPELINE_CARD_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it from its first-composition effect. Carries no VIN, broker, or fleet posture.
 */
fun recordTelemetryPipelineCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TELEMETRY_PIPELINE_CARD_SLUG))
}
