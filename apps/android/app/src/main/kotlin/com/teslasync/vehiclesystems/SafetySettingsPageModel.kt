// Pure, framework-free model + projections for the SafetySettingsPage vehicle-systems surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/vehicle-systems/pages/
// SafetySettingsPage.tsx). No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only
// references the framework-free Resource + the shared-core SI units), so the composable stays a thin render layer and
// all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the three raw SI JSON envelopes the page reads —
// the `/safety/latest` ADAS snapshot, the `/safety?limit=100` history, and the live `/security/latest` seat-belt/lock
// signals (web `useSecurityLatest`) — into typed, null-safe models; (2) the safety-enum normalization choke point
// (web lib/safetyEnum.ts) so a value that arrives as boolean / number / typed-enum / stripped-suffix is rendered and
// classified identically; (3) the ADAS feature derivation, the 0..9 safety score, the per-snapshot step series the
// chart draws, and the history projection; and (4) the display-boundary distance conversion from the `/settings`
// document ([SafetyDisplayPrefs], web `useUnits`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the `*_miles_since_reset` fields are MISNAMED on the wire —
// their content is SI metres, which is exactly what the web `convertDistanceFromSI(latest.miles_since_reset, unit)`
// feeds the SI→display converter. They are bridged here through the same shared [convertDistanceFromSI] and never
// stored converted. Booleans/enums are raw on the wire and rendered verbatim, mirroring the web.
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web guards its body on the truthiness of
// the loaded `/safety/latest` payload (`!latest`). The native surface instead routes an absent / structurally-empty
// payload to the friendly empty surface via [SafetySnapshot.hasData] so the declared `empty` data state is genuinely
// reachable — the same gate the sibling DrivetrainHealthPage / StatisticsPage surfaces use.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehiclesystems.safetysettings

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The total ADAS features the safety score is computed against (web `TOTAL_FEATURES = 9`). */
const val TOTAL_FEATURES: Int = 9

/** The em dash shown for a missing value (web `'—'`). */
const val EM_DASH: String = "\u2014"

private const val DEFAULT_PRECISION = 2
private const val PERCENT = 100.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SafetySettingsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("safetySettings", "/safety-settings", …)`, so the host binds this surface to that destination (and its
 * `/safety-settings` deep link) without the nav module depending on it.
 */
object SafetySettingsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("safetySettings", "/safety-settings", …)`). */
    const val ROUTE_ID: String = "safetySettings"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/safety-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "SafetySettingsPage"
}

/**
 * The four Tesla raw-enum fields whose stringly value needs prefix-stripping for old `signal_log` rows (web
 * `SAFETY_ENUM_PREFIXES`). The [prefix] is sliced off so `"FollowDistance3"` renders as `"3"`.
 */
enum class SafetyEnumField(
    val prefix: String,
) {
    ForwardCollisionWarning("ForwardCollisionSensitivity"),
    LaneDepartureAvoidance("LaneAssistLevel"),
    SpeedLimitWarning("SpeedAssistLevel"),
    CruiseFollowDistance("FollowDistance"),
}

/** The nine ADAS features the cards + score iterate, in the web `buildFeatureCards` order. */
enum class SafetyFeatureId {
    Aeb,
    Bsc,
    Fcw,
    Lda,
    Cfd,
    Slw,
    PinToDrive,
    Bscw,
    Elda,
}

/**
 * One decoded ADAS feature card (web `FeatureCardDef`). [enabled] drives the on/off accent; [valueText] is the
 * already-resolved enum value string for the four stringly fields (FCW/LDA/SLW/CFD) or `null` for the boolean
 * features, where the render layer substitutes the localized Enabled/Disabled label.
 */
data class SafetyFeature(
    val id: SafetyFeatureId,
    val enabled: Boolean,
    val valueText: String?,
)

/**
 * The decoded `/safety/latest` ADAS snapshot — the native analogue of the web `SafetySnapshot` interface. The four
 * enum fields are kept as their raw [JsonElement] so the safety-enum normalization happens at one choke point
 * ([cleanSafetyEnum]/[isSafetyEnumActive]); the rest are null-safe primitives. [milesSinceReset] /
 * [selfDrivingMilesSinceReset] are SI **metres** despite the legacy field name (see file header), bridged at the
 * display boundary.
 */
data class SafetySnapshot(
    val id: Long?,
    val automaticEmergencyBrakingOff: Boolean,
    val automaticBlindSpotCamera: Boolean,
    val blindSpotCollisionWarning: Boolean,
    val emergencyLaneDepartureAvoidance: Boolean,
    val forwardCollisionWarning: JsonElement?,
    val laneDepartureAvoidance: JsonElement?,
    val speedLimitWarning: JsonElement?,
    val cruiseFollowDistance: JsonElement?,
    val pinToDriveEnabled: Boolean,
    val milesSinceReset: Double?,
    val selfDrivingMilesSinceReset: Double?,
    val createdAt: String?,
    val present: Boolean,
) {
    /**
     * Whether the snapshot carries any safety data. An absent / structurally-empty payload (or the no-vehicle scope)
     * routes to the friendly empty surface (web `!latest`) rather than a grid of all-disabled features.
     */
    val hasData: Boolean get() = present

    /** The nine ADAS toggle states, in the web `boolFeatures` order (AEB is inverted: `off=false` ⇒ enabled). */
    fun boolFeatures(): List<Boolean> =
        listOf(
            isAebEnabled(automaticEmergencyBrakingOff),
            automaticBlindSpotCamera,
            blindSpotCollisionWarning,
            emergencyLaneDepartureAvoidance,
            pinToDriveEnabled,
            isSafetyEnumActive(forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning),
            isSafetyEnumActive(laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance),
            isSafetyEnumActive(speedLimitWarning, SafetyEnumField.SpeedLimitWarning),
            isSafetyEnumActive(cruiseFollowDistance, SafetyEnumField.CruiseFollowDistance),
        )

    /** Count of enabled features (web `enabledCount`). */
    val enabledCount: Int get() = boolFeatures().count { it }

    /** Disabled features (web `TOTAL_FEATURES - enabled`). */
    val disabledCount: Int get() = TOTAL_FEATURES - enabledCount

    /** Safety score as a whole percentage 0..100 (web `(enabled / TOTAL_FEATURES) * 100`). */
    val scorePercent: Double get() = enabledCount * PERCENT / TOTAL_FEATURES

    /**
     * The nine ADAS feature cards in the web `buildFeatureCards` order. The four stringly fields carry their cleaned
     * value text; the boolean features carry `null` so the render layer substitutes Enabled/Disabled.
     */
    fun features(): List<SafetyFeature> =
        listOf(
            SafetyFeature(SafetyFeatureId.Aeb, isAebEnabled(automaticEmergencyBrakingOff), null),
            SafetyFeature(SafetyFeatureId.Bsc, automaticBlindSpotCamera, null),
            SafetyFeature(
                SafetyFeatureId.Fcw,
                isSafetyEnumActive(forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning),
                cleanSafetyEnum(forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning),
            ),
            SafetyFeature(
                SafetyFeatureId.Lda,
                isSafetyEnumActive(laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance),
                cleanSafetyEnum(laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance),
            ),
            SafetyFeature(
                SafetyFeatureId.Cfd,
                isSafetyEnumActive(cruiseFollowDistance, SafetyEnumField.CruiseFollowDistance),
                cleanSafetyEnum(cruiseFollowDistance, SafetyEnumField.CruiseFollowDistance),
            ),
            SafetyFeature(
                SafetyFeatureId.Slw,
                isSafetyEnumActive(speedLimitWarning, SafetyEnumField.SpeedLimitWarning),
                cleanSafetyEnum(speedLimitWarning, SafetyEnumField.SpeedLimitWarning),
            ),
            SafetyFeature(SafetyFeatureId.PinToDrive, pinToDriveEnabled, null),
            SafetyFeature(SafetyFeatureId.Bscw, blindSpotCollisionWarning, null),
            SafetyFeature(SafetyFeatureId.Elda, emergencyLaneDepartureAvoidance, null),
        )

    companion object {
        /** The absent snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: SafetySnapshot =
            SafetySnapshot(
                id = null,
                automaticEmergencyBrakingOff = false,
                automaticBlindSpotCamera = false,
                blindSpotCollisionWarning = false,
                emergencyLaneDepartureAvoidance = false,
                forwardCollisionWarning = null,
                laneDepartureAvoidance = null,
                speedLimitWarning = null,
                cruiseFollowDistance = null,
                pinToDriveEnabled = false,
                milesSinceReset = null,
                selfDrivingMilesSinceReset = null,
                createdAt = null,
                present = false,
            )
    }
}

/**
 * The decoded `/security/latest` live-signal snapshot the four SignalCards read (web `useSecurityLatest`). Each field
 * is a nullable [Boolean] so a missing signal renders the em dash rather than a guessed default (web `== null ? '—'`).
 */
data class SecurityLatest(
    val driverSeatBelt: Boolean?,
    val passengerSeatBelt: Boolean?,
    val driverSeatOccupied: Boolean?,
    val locked: Boolean?,
)

/** One `(time, aeb, bscw, elda)` step-series sample the safety-states chart plots (web `ChartPoint`, 0/1 values). */
data class SafetyChartPoint(
    val time: String,
    val aeb: Double,
    val bscw: Double,
    val elda: Double,
)

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from the `/settings`
 * document: the [distanceUnit] (the two driving-stat metrics), the [precision] (web `decimal_precision`, else 2), and
 * the [locale] used for grouped-number formatting.
 */
data class SafetyDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** SI metres → the user's display distance (web `convertDistanceFromSI(meters, unit)`). */
    fun distance(meters: Double): Double = convertDistanceFromSI(meters, distanceUnit)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = ChartFormat.number(value, precision, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: SafetyDisplayPrefs =
            SafetyDisplayPrefs(DistanceUnitPref.KM, DEFAULT_PRECISION, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): SafetyDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return SafetyDisplayPrefs(
                distanceUnit = unit.distance,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/** AEB uses inverted logic: `off = false` means the feature IS enabled (web `isAebEnabled`). */
fun isAebEnabled(off: Boolean): Boolean = !off

/**
 * Convert a raw safety-enum [value] into a human-renderable, prefix-stripped string (web `cleanSafetyEnum`). Booleans
 * render as "On" / "Off"; numbers render as their decimal form; the typed-enum prefix is sliced for old rows; a
 * `SpeedAssistLevelNone` collapses to "Off". A null / empty value returns [fallback].
 */
fun cleanSafetyEnum(
    value: JsonElement?,
    field: SafetyEnumField,
    fallback: String = EM_DASH,
): String {
    val primitive = value as? JsonPrimitive ?: return fallback
    primitive.booleanOrNull?.let { return if (it) "On" else "Off" }

    val num = if (!primitive.isString) primitive.doubleOrNull else null
    if (num != null) return formatEnumNumber(num)

    val raw = primitive.contentOrNull?.takeIf { it.isNotEmpty() } ?: return fallback
    val prefix = field.prefix
    if (raw.startsWith(prefix)) {
        val stripped = raw.substring(prefix.length)
        if (field == SafetyEnumField.SpeedLimitWarning && stripped == "None") return "Off"
        return stripped.ifEmpty { raw }
    }
    return raw
}

/**
 * Whether a safety-enum [value] represents an ENABLED feature (web `isSafetyEnumActive`). Centralizes the
 * "off / none / disabled / 0" classification so callers don't reinvent it via fragile string coercion.
 */
fun isSafetyEnumActive(
    value: JsonElement?,
    field: SafetyEnumField,
): Boolean {
    if (value == null || value is JsonNull) return false
    (value as? JsonPrimitive)?.booleanOrNull?.let { return it }
    val cleaned = cleanSafetyEnum(value, field, "")
    if (cleaned.isEmpty()) return false
    return when (cleaned.lowercase()) {
        "off", "none", "disabled", "0" -> false
        else -> true
    }
}

/** Numbers render as their decimal form, dropping a redundant `.0` (web `String(num)`). */
private fun formatEnumNumber(num: Double): String =
    if (num % 1.0 == 0.0) num.toLong().toString() else num.toString()

/**
 * Decodes the raw `/safety/latest` [json] (SI, snake_case on the wire) into a [SafetySnapshot]. A non-object input
 * collapses to [SafetySnapshot.EMPTY]; missing / JSON-null fields collapse to their null-safe defaults — reproducing
 * the web optional reads.
 */
fun parseSafetySnapshot(json: JsonElement?): SafetySnapshot {
    val obj = json as? JsonObject ?: return SafetySnapshot.EMPTY
    if (obj.isEmpty()) return SafetySnapshot.EMPTY
    return SafetySnapshot(
        id = obj.longField("id"),
        automaticEmergencyBrakingOff = obj.boolField("automatic_emergency_braking_off"),
        automaticBlindSpotCamera = obj.boolField("automatic_blind_spot_camera"),
        blindSpotCollisionWarning = obj.boolField("blind_spot_collision_warning"),
        emergencyLaneDepartureAvoidance = obj.boolField("emergency_lane_departure_avoidance"),
        forwardCollisionWarning = obj.rawField("forward_collision_warning"),
        laneDepartureAvoidance = obj.rawField("lane_departure_avoidance"),
        speedLimitWarning = obj.rawField("speed_limit_warning"),
        cruiseFollowDistance = obj.rawField("cruise_follow_distance"),
        pinToDriveEnabled = obj.boolField("pin_to_drive_enabled"),
        milesSinceReset = obj.doubleField("miles_since_reset"),
        selfDrivingMilesSinceReset = obj.doubleField("self_driving_miles_since_reset"),
        createdAt = obj.stringField("created_at"),
        present = true,
    )
}

/** Decodes the raw `/safety?limit=100` [json] array into [SafetySnapshot] rows (web `useQuery('/safety')`). */
fun parseSafetyHistory(json: JsonElement?): List<SafetySnapshot> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        (element as? JsonObject)?.let { parseSafetySnapshot(it) }?.takeIf { it.present }
    }
}

/** Decodes the raw `/security/latest` [json] into a [SecurityLatest] (web `useSecurityLatest`), null-safe per field. */
fun parseSecurityLatest(json: JsonElement?): SecurityLatest {
    val obj = json as? JsonObject
    return SecurityLatest(
        driverSeatBelt = obj.boolOrNull("driver_seat_belt"),
        passengerSeatBelt = obj.boolOrNull("passenger_seat_belt"),
        driverSeatOccupied = obj.boolOrNull("driver_seat_occupied"),
        locked = obj.boolOrNull("locked"),
    )
}

/**
 * Projects the decoded history into the step series the chart draws (web `toChartData`): sorted ascending by
 * `created_at`, each snapshot mapped to a `(time, aeb, bscw, elda)` 0/1 sample.
 */
fun toSafetyChartData(history: List<SafetySnapshot>): List<SafetyChartPoint> =
    history
        .sortedBy { epochMillisOf(it.createdAt) ?: Long.MIN_VALUE }
        .map { snap ->
            SafetyChartPoint(
                time = formatTimestamp(snap.createdAt),
                aeb = if (isAebEnabled(snap.automaticEmergencyBrakingOff)) 1.0 else 0.0,
                bscw = if (snap.blindSpotCollisionWarning) 1.0 else 0.0,
                elda = if (snap.emergencyLaneDepartureAvoidance) 1.0 else 0.0,
            )
        }

/** The history rows sorted newest-first for the table (web `sortedHistory`). */
fun sortedSafetyHistory(history: List<SafetySnapshot>): List<SafetySnapshot> =
    history.sortedByDescending { epochMillisOf(it.createdAt) ?: Long.MIN_VALUE }

/** Parses an ISO-8601 timestamp to epoch millis, or `null` when absent / unparseable. */
internal fun epochMillisOf(iso: String?): Long? =
    iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/** A compact `MM/dd HH:mm` label for an ISO timestamp (web `formatDateTime`); the raw string is the fallback. */
internal fun formatTimestamp(iso: String?): String {
    if (iso.isNullOrBlank()) return EM_DASH
    val millis = epochMillisOf(iso) ?: return iso
    return TIMESTAMP_FORMAT.format(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC))
}

private val TIMESTAMP_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("MM/dd HH:mm", Locale.US)

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags so the
 * view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SafetySettingsPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, signal, or distance payload.
 */
fun recordSafetySettingsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SafetySettingsPageRegistration.SLUG))
}

private fun JsonObject.rawField(key: String): JsonElement? = this[key]?.takeUnless { it is JsonNull }

private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

private fun JsonObject?.boolOrNull(key: String): Boolean? = (this?.get(key) as? JsonPrimitive)?.booleanOrNull

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.doubleOrNull?.toLong()

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
