// Pure, framework-free model + projection for the PollingEngine shared surface — the native analogue of
// everything the web component derives before returning JSX
// (web/src/components/data-display/PollingEngine.tsx, driven by `getPollingStatus` + `getPollingSavings`).
// No Compose, no Android UI, no HTTP: every declaration here is exercised by the
// `:android:testReleaseUnitTest` gate so the composable stays a thin render layer.
//
// The web `PollingEnginePanel` polls two endpoints — `/polling/status` (the adaptive-polling engine's
// per-vehicle activity, refetched every 15s) and `/polling/savings` (the cost snapshot, every 30s) — and
// renders a savings card (percent saved, $ saved, polls made, credit left, plus a cost-attribution bar with
// a four-segment legend) followed by a per-vehicle activity list. When the engine is disabled
// (`!status?.enabled`) the whole panel renders nothing. This model reproduces that selection + formatting and
// folds the two feeds' cache-then-network lifecycle onto the prompt's loading / empty / error / stale /
// offline matrix without ever hiding a region.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent):
//   • The web titles the panel with the literal "Adaptive Polling Engine" and labels the list "Vehicle
//     Activity"; neither is a `t()` call and neither exists in the P1/S10 catalog. The render layer titles the
//     panel with the localized "Savings" key and the list with the localized "Vehicles" key (the panel's
//     tracked vocabulary — the eight `polling.*` keys — is the savings card), keeping the surface fully
//     localized with no English literal.
//   • The web per-vehicle row expands to the engine's raw decision internals (poll interval, consecutive-idle
//     count, reason strings, prediction). Those labels have no P1/S10 catalog keys, so reproducing them would
//     force English literals (this surface's allowed files cannot add catalog keys). The native row therefore
//     renders the localized collapsed row the web shows at rest (activity, profile, next-poll countdown) and
//     omits the expand-only diagnostic detail.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PollingEngine — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling Range / AIChargingDiagnosis surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pollingengine

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.OffsetDateTime
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the two REST paths the host wires the feeds from, and the SI/JSON field names are pinned
 * here so the native and web surfaces stay in lockstep.
 */
object PollingEngineRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PollingEngine"

    /** `GET /polling/status` — the adaptive-polling engine state (web `getPollingStatus`, refetch 15s). */
    const val STATUS_PATH: String = "/polling/status"

    /** `GET /polling/savings` — the cost snapshot (web `getPollingSavings`, refetch 30s). */
    const val SAVINGS_PATH: String = "/polling/savings"

    // ── status payload keys (web PollEngineStatus / VehiclePollingStatus) ──
    const val ENABLED_KEY: String = "enabled"
    const val VEHICLES_KEY: String = "vehicles"
    const val ACTIVITY_KEY: String = "activity"
    const val PROFILE_KEY: String = "profile"
    const val NEXT_POLL_AFTER_KEY: String = "next_poll_after"

    // ── savings payload keys (web CostSnapshot) ──
    const val SAVINGS_PERCENT_KEY: String = "savings_percent"
    const val ESTIMATED_SAVINGS_KEY: String = "estimated_savings"
    const val POLLS_MADE_KEY: String = "polls_made"
    const val REMAINING_CREDIT_KEY: String = "remaining_credit"
    const val SAVINGS_BREAKDOWN_KEY: String = "savings_breakdown"
    const val BREAKDOWN_FLEET_KEY: String = "fleet_telemetry"
    const val BREAKDOWN_IDLE_KEY: String = "idle_detection"
    const val BREAKDOWN_PREDICTION_KEY: String = "prediction"
    const val BREAKDOWN_SLEEP_KEY: String = "sleep_detection"

    /** The em dash rendered when a value (e.g. an unknown next-poll time) is missing. */
    const val EMPTY_VALUE: String = "\u2014"

    /** Last 8 VIN characters shown per row (web `vin.slice(-8)`). */
    const val VIN_TAIL_LENGTH: Int = 8
}

/**
 * The adaptive-polling engine state — the native port of the web `PollEngineStatus`
 * (`{ enabled, vehicles: Record<vin, VehiclePollingStatus> }`). The web keys its vehicles by VIN; this carries
 * each VIN inside the row so the projection stays a flat, order-stable list.
 */
data class PollingStatusData(
    val enabled: Boolean,
    val vehicles: List<VehiclePollingStatus>,
) {
    companion object {
        /** Builds the status from the raw `/polling/status` document; a null/non-object element yields a disabled, empty engine. */
        fun fromJson(element: JsonElement?): PollingStatusData {
            val obj = element as? JsonObject ?: return PollingStatusData(enabled = false, vehicles = emptyList())
            val enabled = (obj[PollingEngineRegistration.ENABLED_KEY] as? JsonPrimitive)?.booleanOrNull ?: false
            val vehiclesObj = obj[PollingEngineRegistration.VEHICLES_KEY] as? JsonObject
            val vehicles =
                vehiclesObj
                    ?.entries
                    ?.mapNotNull { (vin, value) -> (value as? JsonObject)?.let { vehicleFrom(vin, it) } }
                    .orEmpty()
            return PollingStatusData(enabled = enabled, vehicles = vehicles)
        }

        private fun vehicleFrom(
            vin: String,
            obj: JsonObject,
        ): VehiclePollingStatus =
            VehiclePollingStatus(
                vin = vin,
                activity = obj.string(PollingEngineRegistration.ACTIVITY_KEY),
                profile = obj.string(PollingEngineRegistration.PROFILE_KEY),
                nextPollAfterEpochMs = parseEpochMillis(obj.stringOrNull(PollingEngineRegistration.NEXT_POLL_AFTER_KEY)),
            )

        private fun JsonObject.string(key: String): String = stringOrNull(key).orEmpty()

        private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

        /** Parses an RFC-3339/ISO-8601 timestamp (web `next_poll_after`) to epoch millis; null/garbage ⇒ null. */
        private fun parseEpochMillis(value: String?): Long? {
            if (value.isNullOrBlank()) return null
            return runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
        }
    }
}

/**
 * One per-vehicle adaptive-polling row — the native narrowing of the web `VehiclePollingStatus` to the fields
 * the collapsed row renders: the VIN, the raw activity + profile, and the next-poll time. (The web row's
 * expand-only decision internals are documented as out of scope in this file's header.)
 */
data class VehiclePollingStatus(
    val vin: String,
    val activity: String,
    val profile: String,
    val nextPollAfterEpochMs: Long?,
)

/**
 * The cost snapshot — the native port of the web `CostSnapshot`, narrowed to the savings-card fields and the
 * cost-attribution breakdown the bar + legend render.
 */
data class PollingSavingsData(
    val savingsPercent: Double,
    val estimatedSavings: Double,
    val pollsMade: Double,
    val remainingCredit: Double,
    val breakdown: PollingBreakdown,
) {
    companion object {
        /** Builds the snapshot from the raw `/polling/savings` document; missing fields default to zero. */
        fun fromJson(element: JsonElement?): PollingSavingsData {
            val obj = element as? JsonObject ?: return empty()
            return PollingSavingsData(
                savingsPercent = obj.number(PollingEngineRegistration.SAVINGS_PERCENT_KEY),
                estimatedSavings = obj.number(PollingEngineRegistration.ESTIMATED_SAVINGS_KEY),
                pollsMade = obj.number(PollingEngineRegistration.POLLS_MADE_KEY),
                remainingCredit = obj.number(PollingEngineRegistration.REMAINING_CREDIT_KEY),
                breakdown = PollingBreakdown.fromJson(obj[PollingEngineRegistration.SAVINGS_BREAKDOWN_KEY]),
            )
        }

        private fun empty(): PollingSavingsData = PollingSavingsData(0.0, 0.0, 0.0, 0.0, PollingBreakdown(0.0, 0.0, 0.0, 0.0))

        private fun JsonObject.number(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0
    }
}

/**
 * The cost-attribution split (web `savings_breakdown`) — how the saved polls are distributed across the four
 * engine strategies. Drives the proportional bar and its legend.
 */
data class PollingBreakdown(
    val fleetTelemetry: Double,
    val idleDetection: Double,
    val prediction: Double,
    val sleep: Double,
) {
    /** Sum across strategies; the bar + legend render only when this is positive (web `total > 0`). */
    val total: Double get() = fleetTelemetry + idleDetection + prediction + sleep

    companion object {
        fun fromJson(element: JsonElement?): PollingBreakdown {
            val obj = element as? JsonObject ?: return PollingBreakdown(0.0, 0.0, 0.0, 0.0)
            return PollingBreakdown(
                fleetTelemetry = obj.number(PollingEngineRegistration.BREAKDOWN_FLEET_KEY),
                idleDetection = obj.number(PollingEngineRegistration.BREAKDOWN_IDLE_KEY),
                prediction = obj.number(PollingEngineRegistration.BREAKDOWN_PREDICTION_KEY),
                sleep = obj.number(PollingEngineRegistration.BREAKDOWN_SLEEP_KEY),
            )
        }

        private fun JsonObject.number(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0
    }
}

/** Activity intensity bucket (web `activity` string) → the icon + tone the row draws. */
enum class PollingActivityKind { Active, Moderate, Low, Idle, Sleeping, Unknown }

/** Engine profile bucket (web `profile` string) → the localized "Driving/Charging/Idle/Sleeping" label. */
enum class PollingProfileKind { Driving, Charging, Idle, Sleeping, Other }

/** One legend/bar strategy (web `savings_breakdown` keys) → a localized label + a stable palette color. */
enum class BreakdownKind { FleetTelemetry, IdleDetection, Prediction, Sleep }

/** One proportional bar segment: the [kind] and its share of the total (0..1). */
data class BreakdownSegment(
    val kind: BreakdownKind,
    val fraction: Float,
)

/**
 * The render-ready savings card — the native fold of the web `SavingsCard`: the four formatted stat values
 * and the cost-attribution [segments] (all four kinds, with a zero fraction when absent, so the legend always
 * lists them; the bar draws only the positive ones).
 */
data class PollingSavingsView(
    val savingsPercentText: String,
    val estimatedSavingsText: String,
    val pollsMadeText: String,
    val remainingCreditText: String,
    val hasBreakdown: Boolean,
    val segments: List<BreakdownSegment>,
)

/**
 * One render-ready per-vehicle row — the localized collapsed row the web shows at rest. [countdownText] is the
 * compact next-poll duration ("5s"/"3m"/"2h 5m"); when [isNow] the render layer shows the localized "Now"
 * label, and when both are absent it shows the em dash.
 */
data class VehicleRowView(
    val vinTail: String,
    val activityRaw: String,
    val activityKind: PollingActivityKind,
    val profileKind: PollingProfileKind,
    val profileRaw: String,
    val countdownText: String?,
    val isNow: Boolean,
)

/**
 * The mutually-exclusive render surface the panel draws. [Content]/[Empty] reproduce the web's visible
 * branches (the vehicle list vs the "no vehicles yet" hint); [Hidden] is the web `!status?.enabled` gate
 * (render nothing); [Loading]/[Error] surface the status feed's cold-start and hard-failure states.
 */
enum class PollingPhase {
    /** Resolved engine state with `enabled = false` — render nothing (web `return null`). */
    Hidden,

    /** First status load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** Engine enabled with at least one tracked vehicle — render the full panel. */
    Content,

    /** Engine enabled but no vehicles tracked yet — render the panel with a friendly empty hint. */
    Empty,

    /** Status failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * The immutable, render-ready projection the composable draws — everything the web panel folds together: the
 * resolved [phase] (the engine gate + list state), the optional [savings] card (web `{savings && …}`), the
 * per-vehicle [vehicles] rows, and the cache-then-network freshness envelope ([stale]/[offline]/[refreshing] +
 * [errorKind]) so the surface honestly flags last-known data instead of presenting it as live. Pure data, so
 * [PollingProjection] is unit-tested without a UI host.
 *
 * @property freshnessStamp the `fetchedAt` of the shown status; keys the stale auto-refresh effect.
 */
data class PollingDisplay(
    val phase: PollingPhase,
    val savings: PollingSavingsView? = null,
    val vehicles: List<VehicleRowView> = emptyList(),
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the cached panel. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == PollingPhase.Error
}

/**
 * Pure projection + selection logic for the PollingEngine surface — the native port of the web component's
 * `SavingsCard` derivation, the `VehicleActivity` mapping, and the `!status?.enabled` gate.
 */
object PollingProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    private const val PERCENT_DECIMALS = 1
    private const val CURRENCY_DECIMALS = 2
    private const val COUNT_DECIMALS = 0

    private const val MILLIS_PER_SECOND = 1_000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val MINUTES_PER_HOUR = 60L

    /**
     * Folds the status feed [status] (the engine gate + vehicle list), the savings feed [savings] (the cost
     * card), and the wall clock [now] (for the next-poll countdowns) into the render-ready [PollingDisplay].
     *
     * The [phase] honours both the web's gate/visible branches and the status document's async lifecycle: a
     * hard status failure with no cache → [PollingPhase.Error]; a first load with nothing cached →
     * [PollingPhase.Loading]; a resolved disabled engine → [PollingPhase.Hidden] (web `return null`); an
     * enabled engine with no vehicles → [PollingPhase.Empty]; otherwise [PollingPhase.Content]. The freshness
     * envelope is anchored on the status feed (the gate-deciding primary feed); the savings card renders
     * whenever the savings feed has any value, exactly like the web `{savings && …}`.
     */
    fun project(
        status: UiState<PollingStatusData>,
        savings: UiState<PollingSavingsData>,
        now: Long,
    ): PollingDisplay {
        val data = status.data
        val phase =
            when {
                status.isError -> PollingPhase.Error
                status.isLoading || data == null -> PollingPhase.Loading
                !data.enabled -> PollingPhase.Hidden
                data.vehicles.isEmpty() -> PollingPhase.Empty
                else -> PollingPhase.Content
            }
        return PollingDisplay(
            phase = phase,
            savings = savings.data?.let { savingsView(it) },
            vehicles = data?.vehicles.orEmpty().map { vehicleRow(it, now) },
            stale = status.stale && status.errorKind == null,
            offline = status.stale && status.hasData && status.errorKind != null,
            refreshing = status.refreshing,
            errorKind = status.errorKind,
            httpStatus = status.httpStatus,
            freshnessStamp = status.fetchedAt,
        )
    }

    /** Builds the savings card — the native port of the web `SavingsCard` formatting + breakdown split. */
    fun savingsView(data: PollingSavingsData): PollingSavingsView {
        val total = data.breakdown.total
        return PollingSavingsView(
            savingsPercentText = formatFixed(data.savingsPercent, PERCENT_DECIMALS),
            estimatedSavingsText = formatFixed(data.estimatedSavings, CURRENCY_DECIMALS),
            pollsMadeText = formatFixed(data.pollsMade, COUNT_DECIMALS),
            remainingCreditText = formatFixed(data.remainingCredit, CURRENCY_DECIMALS),
            hasBreakdown = total > 0.0,
            segments =
                listOf(
                    BreakdownSegment(BreakdownKind.FleetTelemetry, fractionOf(data.breakdown.fleetTelemetry, total)),
                    BreakdownSegment(BreakdownKind.IdleDetection, fractionOf(data.breakdown.idleDetection, total)),
                    BreakdownSegment(BreakdownKind.Prediction, fractionOf(data.breakdown.prediction, total)),
                    BreakdownSegment(BreakdownKind.Sleep, fractionOf(data.breakdown.sleep, total)),
                ),
        )
    }

    /** Maps one raw [VehiclePollingStatus] onto the localized collapsed [VehicleRowView]. */
    fun vehicleRow(
        vehicle: VehiclePollingStatus,
        now: Long,
    ): VehicleRowView {
        val countdown = countdownOf(vehicle.nextPollAfterEpochMs, now)
        return VehicleRowView(
            vinTail = vehicle.vin.takeLast(PollingEngineRegistration.VIN_TAIL_LENGTH),
            activityRaw = vehicle.activity,
            activityKind = activityKindOf(vehicle.activity),
            profileKind = profileKindOf(vehicle.profile),
            profileRaw = vehicle.profile,
            countdownText = countdown.text,
            isNow = countdown.isNow,
        )
    }

    /** Classifies the raw web `activity` string into the icon/tone bucket (web `activityIcon` switch). */
    fun activityKindOf(raw: String): PollingActivityKind =
        when (raw.trim().lowercase()) {
            "active", "critical" -> PollingActivityKind.Active
            "moderate" -> PollingActivityKind.Moderate
            "low" -> PollingActivityKind.Low
            "idle" -> PollingActivityKind.Idle
            "sleeping" -> PollingActivityKind.Sleeping
            else -> PollingActivityKind.Unknown
        }

    /** Classifies the raw web `profile` string into the localized label bucket (web `profileLabel` switch). */
    fun profileKindOf(raw: String): PollingProfileKind =
        when (raw.trim().lowercase()) {
            "driving" -> PollingProfileKind.Driving
            "charging" -> PollingProfileKind.Charging
            "idle" -> PollingProfileKind.Idle
            "sleeping" -> PollingProfileKind.Sleeping
            else -> PollingProfileKind.Other
        }

    /**
     * The next-poll countdown (web `formatTimeUntil` + `formatDuration`): a past/zero target is "now", a known
     * future target formats compactly, and an unknown target yields neither (the render layer shows the em
     * dash).
     */
    fun countdownOf(
        targetEpochMs: Long?,
        now: Long,
    ): PollingCountdown {
        val diff = targetEpochMs?.minus(now)
        return when {
            diff == null -> PollingCountdown(isNow = false, text = null)
            diff <= 0L -> PollingCountdown(isNow = true, text = null)
            else -> PollingCountdown(isNow = false, text = formatDuration(diff))
        }
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket: an open breaker →
     * [QueryErrorKind.Waiting]; a connectivity failure → [QueryErrorKind.Network]; a 401/403 →
     * [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound]; every other failure →
     * [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: PollingDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private fun fractionOf(
        value: Double,
        total: Double,
    ): Float = if (total > 0.0) (value / total).toFloat().coerceIn(0f, 1f) else 0f

    private fun formatDuration(ms: Long): String {
        val seconds = ms / MILLIS_PER_SECOND
        val minutes = seconds / SECONDS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        return when {
            seconds < SECONDS_PER_MINUTE -> "${seconds}s"
            minutes < MINUTES_PER_HOUR -> "${minutes}m"
            else -> "${hours}h ${minutes % MINUTES_PER_HOUR}m"
        }
    }

    /**
     * Locale-free fixed-precision formatter (the deterministic stand-in for the web `AnimatedNumber`'s
     * `toFixed`). Rounds half-up on the scaled magnitude so the fractional digits never carry incorrectly.
     */
    fun formatFixed(
        value: Double,
        decimals: Int,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        if (decimals <= 0) return safe.roundToLong().toString()
        var factor = 1L
        repeat(decimals) { factor *= 10L }
        val scaled = (abs(safe) * factor).roundToLong()
        val whole = scaled / factor
        val frac = scaled % factor
        val sign = if (safe < 0.0 && scaled != 0L) "-" else ""
        return sign + whole.toString() + "." + frac.toString().padStart(decimals, '0')
    }
}

/** A resolved next-poll countdown: either "Now" ([isNow]) or a compact [text] ("5s"/"3m"/"2h 5m"), or neither. */
data class PollingCountdown(
    val isNow: Boolean,
    val text: String?,
)
