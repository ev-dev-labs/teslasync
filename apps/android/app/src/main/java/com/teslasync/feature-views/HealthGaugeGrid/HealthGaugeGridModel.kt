// The pure, framework-free model + projection for the HealthGaugeGrid feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Drivetrain Health page) owns the
// `useDrivetrainHealth` + `useDrivingStats` queries, derives `overallHealth` (`health.overallHealth ?? 'good'`),
// `healthScore` (`HEALTH_SCORE[overallHealth]`), `motorStatus`, the four temperature `sensors`, and threads them
// plus `stats: DrivingStats | undefined` down as props. From those it renders a `grid-cols-1 md:grid-cols-3` of
// three GlassPanels: a health-score RadialGauge, a Motor Details KVList, and a Drive Statistics KVList that
// collapses to a four-line skeleton while `stats` is still loading (`stats ? <KVList> : <Skeleton lines={4}>`).
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10, and `useUnits`, mapped to the live S8 SettingsStore
// for the distance/speed units + grouping locale). The owning page computes the snapshot and threads it in
// through the shared state-holder layer as a [UiState], so this view also renders every lifecycle state that
// layer can carry — a loading skeleton chrome, a hard error with retry, a friendly empty state, content, and a
// stale/offline cached "last known" with a freshness chip + auto-refresh — without ever fetching, exactly like
// the sibling card-grid ports. Inside the content branch the Drive Statistics sub-panel reproduces the web's one
// internal branch verbatim (`stats ? rows : skeleton`).
//
// Unit handling floors on SI exactly as the web source does: the web feeds `stats.totalDistanceKm`,
// `stats.avgSpeedKmh`, and `stats.topSpeedKmh` straight into `convertDistanceFromSI` / `convertSpeedFromSI`,
// i.e. it treats those legacy-suffixed wire fields as SI metres and metres-per-second. This port keeps that
// truth: the wire keys `total_distance_km` / `avg_speed_kmh` / `top_speed_kmh` decode into SI-named fields
// (`totalDistanceM` / `avgSpeedMps` / `topSpeedMps`) and convert through the shared units lib at this boundary,
// never pre-baked. The conversion factors live in the shared lib, never here.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/HealthGaugeGrid — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthgaugegrid

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Web `HEALTH_SCORE.good` (constants.ts) — the score the gauge + KVList show for a healthy drivetrain. */
private const val HEALTH_SCORE_GOOD = 95

/** Web `HEALTH_SCORE.warning` — the score shown when temperatures are elevated. */
private const val HEALTH_SCORE_WARNING = 60

/** Web `HEALTH_SCORE.critical` — the score shown when temperatures are critical. */
private const val HEALTH_SCORE_CRITICAL = 25

/** The RadialGauge ceiling — web `<RadialGauge max={100} unit="%">`. */
const val GAUGE_MAX: Double = 100.0

/** Web `fmtInt` (0 fraction digits) for the Total Drives + Total Distance values. */
private const val INT_DECIMALS = 0

/** Web `fmtNumber(..., 1)` for the Avg Speed + Top Speed values. */
private const val SPEED_DECIMALS = 1

/** Web `%` suffix appended to the health-score KVList value. */
private const val PERCENT = "%"

/** Leading space joining a converted number to its unit label (web ``${value} ${unit}``). */
private const val UNIT_SPACE = " "

/** Em dash shown for a blank motor status (null-safety; the web shows the raw string). */
private const val EM_DASH = "\u2014"

/** Number-grouping locale fallback (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

// Wire keys — the `/drivetrain/health` response (internal/api/drivetrain/handler.go).
private const val KEY_OVERALL_HEALTH = "overall_health"
private const val KEY_MOTOR_STATUS = "motor_status"
private const val KEY_FRONT_MOTOR_TEMP_C = "front_motor_temp_c"
private const val KEY_REAR_MOTOR_TEMP_C = "rear_motor_temp_c"
private const val KEY_INVERTER_TEMP_C = "inverter_temp_c"
private const val KEY_BATTERY_TEMP_C = "battery_temp_c"

// Wire keys — the `/drives/stats` response (internal/api/drives/listing.go). The `_km`/`_kmh` suffixes are
// legacy: the values are SI (metres / metres-per-second), which is why the web feeds them to `*FromSI`.
private const val KEY_TOTAL_DRIVES = "total_drives"
private const val KEY_TOTAL_DISTANCE_M = "total_distance_km"
private const val KEY_AVG_SPEED_MPS = "avg_speed_kmh"
private const val KEY_TOP_SPEED_MPS = "top_speed_kmh"

// Wire enum literals — web `overall_health: 'good' | 'warning' | 'critical'`.
private const val HEALTH_WIRE_GOOD = "good"
private const val HEALTH_WIRE_WARNING = "warning"
private const val HEALTH_WIRE_CRITICAL = "critical"

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The drivetrain condition rating — the web `HealthStatus` union (`'good' | 'warning' | 'critical'`). Each
 * carries the web `HEALTH_SCORE` value the gauge + KVList show; the gauge accent color is resolved from the
 * status at the Compose boundary (web `HEALTH_COLOR[overallHealth]`).
 *
 * @property score the web `HEALTH_SCORE[status]` 0–100 rating.
 */
enum class HealthStatus(
    val score: Int,
) {
    Good(HEALTH_SCORE_GOOD),
    Warning(HEALTH_SCORE_WARNING),
    Critical(HEALTH_SCORE_CRITICAL),
    ;

    companion object {
        /**
         * Decodes the wire `overall_health` string, defaulting to [Good] for any missing/unknown value — the
         * web page's `health?.overallHealth ?? 'good'` guard.
         */
        fun fromWire(raw: String?): HealthStatus =
            when (raw?.trim()?.lowercase(Locale.ROOT)) {
                HEALTH_WIRE_CRITICAL -> Critical
                HEALTH_WIRE_WARNING -> Warning
                HEALTH_WIRE_GOOD -> Good
                else -> Good
            }
    }
}

/**
 * The four `/drives/stats` figures the web Drive Statistics panel reads off its `DrivingStats` prop, decoded
 * from the SI, snake_case wire payload. Every field defaults to `0.0` when missing or JSON-null, reproducing
 * the web `fmtInt`/`fmtNumber` `safeNumber` coercion.
 *
 * The `_km`/`_kmh` wire suffixes are legacy names for SI values (see file header): [totalDistanceM] is metres
 * and [avgSpeedMps]/[topSpeedMps] are metres-per-second, matching the web's `convertDistanceFromSI` /
 * `convertSpeedFromSI` calls.
 *
 * @property totalDrives drive count in the window (web `stats.totalDrives`).
 * @property totalDistanceM SI metres driven (web `stats.totalDistanceKm`, fed to `convertDistanceFromSI`).
 * @property avgSpeedMps SI metres-per-second average (web `stats.avgSpeedKmh`, fed to `convertSpeedFromSI`).
 * @property topSpeedMps SI metres-per-second maximum (web `stats.topSpeedKmh`, fed to `convertSpeedFromSI`).
 */
data class DrivingStatsSummary(
    val totalDrives: Double,
    val totalDistanceM: Double,
    val avgSpeedMps: Double,
    val topSpeedMps: Double,
) {
    companion object {
        /**
         * Decodes the raw `/drives/stats` [json] into a [DrivingStatsSummary], or `null` when the payload is
         * absent. `null` and a JSON-null collapse to `null` (the web `stats: DrivingStats | undefined` skeleton
         * branch); any JSON object — including an empty `{}` — decodes to a summary, because the web `stats ?`
         * truthiness renders the KVList for any present object. A missing/JSON-null field collapses to `0.0`.
         */
        fun fromJson(json: JsonElement?): DrivingStatsSummary? {
            val obj = json as? JsonObject ?: return null
            return DrivingStatsSummary(
                totalDrives = obj.double(KEY_TOTAL_DRIVES),
                totalDistanceM = obj.double(KEY_TOTAL_DISTANCE_M),
                avgSpeedMps = obj.double(KEY_AVG_SPEED_MPS),
                topSpeedMps = obj.double(KEY_TOP_SPEED_MPS),
            )
        }
    }
}

/**
 * The SI-canonical slice of the web `HealthGaugeGrid` props. The owning page only mounts the surface once its
 * `useDrivetrainHealth` query resolves (`{health ? … : <EmptyState>}`), so this snapshot always carries the
 * health figures; [stats] is nullable to mirror the web `stats: DrivingStats | undefined` skeleton branch.
 *
 * [sensorTempsC] holds the four temperature readings the page builds the `sensors` array from (front motor,
 * rear motor, inverter, battery); a `null` entry is an absent sensor. The surface reads only the count of
 * present sensors (web `sensors.filter((s) => s.value !== null).length`), exposed as [activeSensorCount].
 *
 * @property overallHealth the drivetrain condition rating (web `overallHealth`).
 * @property motorStatus the raw motor status text (web `motorStatus`); blank renders an em dash.
 * @property sensorTempsC the four sensor temperatures in SI Celsius; `null` = sensor absent.
 * @property stats the drive-statistics figures, or `null` while that query is in flight.
 */
data class HealthGaugeGridSnapshot(
    val overallHealth: HealthStatus,
    val motorStatus: String,
    val sensorTempsC: List<Double?>,
    val stats: DrivingStatsSummary?,
) {
    /** Web `healthScore = HEALTH_SCORE[overallHealth]`, the value the gauge + KVList show. */
    val healthScore: Int get() = overallHealth.score

    /** Web `sensors.filter((s) => s.value !== null).length` — the count of present temperature sensors. */
    val activeSensorCount: Int get() = sensorTempsC.count { it != null }

    companion object {
        /**
         * Decodes the raw `/drivetrain/health` [health] + `/drives/stats` [stats] payloads into a snapshot, or
         * `null` when [health] is absent (the web page's `!health` empty branch). The four sensor temperatures
         * decode as nullable doubles (a missing/JSON-null reading is an absent sensor), and [stats] decodes via
         * [DrivingStatsSummary.fromJson] (`null` drives the Drive Statistics skeleton).
         */
        fun fromJson(
            health: JsonElement?,
            stats: JsonElement?,
        ): HealthGaugeGridSnapshot? {
            val obj = health as? JsonObject ?: return null
            return HealthGaugeGridSnapshot(
                overallHealth = HealthStatus.fromWire(obj.stringOrNull(KEY_OVERALL_HEALTH)),
                motorStatus = obj.stringOrNull(KEY_MOTOR_STATUS).orEmpty(),
                sensorTempsC =
                    listOf(
                        obj.doubleOrNull(KEY_FRONT_MOTOR_TEMP_C),
                        obj.doubleOrNull(KEY_REAR_MOTOR_TEMP_C),
                        obj.doubleOrNull(KEY_INVERTER_TEMP_C),
                        obj.doubleOrNull(KEY_BATTERY_TEMP_C),
                    ),
                stats = DrivingStatsSummary.fromJson(stats),
            )
        }
    }
}

/**
 * The display preferences this surface resolves from the live `/settings` document — the native binding of the
 * web `useUnits` read (distance + speed display units + grouping locale, via [UnitPreferences.fromSettings]).
 * Unlike the sibling DriveStatCards surface, HealthGaugeGrid reads no `useFormatting` (currency) preference.
 *
 * @property units the SI -> display unit preferences (distance/speed labels + precision).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class HealthGaugeGridDisplayPrefs(
    val units: UnitPref,
    val locale: Locale,
) {
    companion object {
        /** The metric, en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: HealthGaugeGridDisplayPrefs = from(null)

        /** Resolves the unit + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): HealthGaugeGridDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            return HealthGaugeGridDisplayPrefs(units = units, locale = localeFor(units.locale))
        }
    }
}

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready rows carry no English literal. The `*` keys map 1:1 to the web `t('drivetrain.*')` calls; the
 * three `status*` strings localize the capitalized status value the web shows
 * (`overallHealth.charAt(0).toUpperCase() + overallHealth.slice(1)`); [noData] backs the friendly empty state.
 */
data class HealthGaugeGridStrings(
    val healthScore: String,
    val healthScoreDesc: String,
    val motorDetails: String,
    val driveStats: String,
    val motorStatus: String,
    val overallHealth: String,
    val healthScoreLabel: String,
    val sensorCount: String,
    val realTime: String,
    val totalDrives: String,
    val totalDistance: String,
    val avgSpeed: String,
    val topSpeed: String,
    val statusGood: String,
    val statusWarning: String,
    val statusCritical: String,
    val noData: String,
) {
    /** The localized capitalized status value the Overall Health row shows (web enum capitalize). */
    fun statusLabel(status: HealthStatus): String =
        when (status) {
            HealthStatus.Good -> statusGood
            HealthStatus.Warning -> statusWarning
            HealthStatus.Critical -> statusCritical
        }
}

/**
 * A fully resolved health-score gauge — the native analogue of the web `<RadialGauge>` invocation. Pure data
 * (no Compose types) so the projection is asserted off-device; the composable resolves the [status] to a
 * design-token color and draws the shared RadialGauge.
 *
 * @property value the score to sweep to (web `healthScore`).
 * @property max the gauge ceiling (web `max={100}`).
 * @property unit the gauge unit suffix (web `unit="%"`).
 * @property label the localized gauge label (web `t('drivetrain.healthScore')`).
 * @property description the localized caption below the gauge (web `t('drivetrain.healthScoreDesc')`).
 * @property status the condition rating selecting the gauge accent color.
 */
data class HealthGaugeModel(
    val value: Double,
    val max: Double,
    val unit: String,
    val label: String,
    val description: String,
    val status: HealthStatus,
)

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's
 * derivations, conversions, and formats. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings + the gauge accent color and draws what
 * these return.
 */
object HealthGaugeGridProjection {
    /** The number of Drive Statistics rows — also the skeleton line count (web `<Skeleton lines={4}>`). */
    const val STATS_ROW_COUNT: Int = 4

    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (the web page's `!health` no-data state). The host's stateful binding can
     * additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: HealthGaugeGridSnapshot?,
        isLoading: Boolean,
    ): UiState<HealthGaugeGridSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /** Builds the render-ready health-score gauge model (web `<RadialGauge value={healthScore} … />`). */
    fun gauge(
        snapshot: HealthGaugeGridSnapshot,
        strings: HealthGaugeGridStrings,
    ): HealthGaugeModel =
        HealthGaugeModel(
            value = snapshot.healthScore * 1.0,
            max = GAUGE_MAX,
            unit = PERCENT,
            label = strings.healthScore,
            description = strings.healthScoreDesc,
            status = snapshot.overallHealth,
        )

    /**
     * The Motor Details rows in web source order: Motor Status (raw, em dash when blank), Overall Health (the
     * localized capitalized status), Health Score (`${healthScore}%`), and Active Sensors (the present-sensor
     * count). Labels are already localized (resolved at the Compose boundary, handed in via [strings]).
     */
    fun motorRows(
        snapshot: HealthGaugeGridSnapshot,
        strings: HealthGaugeGridStrings,
    ): List<KVItem> =
        listOf(
            KVItem(strings.motorStatus, motorStatusText(snapshot.motorStatus)),
            KVItem(strings.overallHealth, strings.statusLabel(snapshot.overallHealth)),
            KVItem(strings.healthScoreLabel, "${snapshot.healthScore}$PERCENT"),
            KVItem(strings.sensorCount, snapshot.activeSensorCount.toString()),
        )

    /**
     * The Drive Statistics rows in web source order, each value formatted for [prefs]: Total Drives (`fmtInt`),
     * Total Distance (`fmtInt(convertDistanceFromSI(…)) + unit`), Avg Speed and Top Speed
     * (`fmtNumber(convertSpeedFromSI(…), 1) + unit`). The web renders these only when `stats` is present; the
     * composable shows a four-line skeleton otherwise.
     */
    fun statsRows(
        stats: DrivingStatsSummary,
        prefs: HealthGaugeGridDisplayPrefs,
        strings: HealthGaugeGridStrings,
    ): List<KVItem> {
        val units = prefs.units
        val locale = prefs.locale
        val distanceLabel = units.distance.label
        val speedLabel = units.speed.label
        val distance = convertDistanceFromSI(stats.totalDistanceM, units.distance)
        val avgSpeed = convertSpeedFromSI(stats.avgSpeedMps, units.speed)
        val topSpeed = convertSpeedFromSI(stats.topSpeedMps, units.speed)
        return listOf(
            KVItem(strings.totalDrives, fmt(stats.totalDrives, INT_DECIMALS, locale)),
            KVItem(strings.totalDistance, fmt(distance, INT_DECIMALS, locale) + UNIT_SPACE + distanceLabel),
            KVItem(strings.avgSpeed, fmt(avgSpeed, SPEED_DECIMALS, locale) + UNIT_SPACE + speedLabel),
            KVItem(strings.topSpeed, fmt(topSpeed, SPEED_DECIMALS, locale) + UNIT_SPACE + speedLabel),
        )
    }

    /** Web raw `motorStatus`, with a blank value rendered as an em dash for null-safety. */
    private fun motorStatusText(motorStatus: String): String = motorStatus.ifBlank { EM_DASH }

    /**
     * Web `fmtNumber(value, decimals)` — a locale-grouped number including the web `safeNumber` guard (a
     * non-finite value renders as `0`, never an em dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals.coerceAtLeast(0), locale)

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a health
 * score, motor status, sensor temperature, drive count, distance, or speed — so a diagnostics line can never
 * leak drivetrain telemetry or vehicle usage.
 */
object HealthGaugeGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "HealthGaugeGrid"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
